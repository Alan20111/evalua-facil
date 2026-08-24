// Operaciones de IA — el ÚNICO lugar donde Evalúa Fácil llama a un modelo.
//
// La clave del proveedor vive en un secret de Functions (jamás en el
// cliente). El flujo completo por operación:
//
//   estimación (cliente, informativa) → confirmación del docente →
//   RESERVA (transacción, ledger) → ejecución IA → consumo real →
//   LIQUIDACIÓN (transacción, ledger) → la barra se actualiza por snapshot.
//
// Reglas que este archivo hace cumplir (aprobadas por el PO, 9-ago-2026):
//   · la IA nunca decide cuánto se descuenta: los costos salen de
//     config/iaTarifas y las cuentas las hace creditosLedger.js;
//   · una operación fallida reembolsa su reserva;
//   · un reintento con la misma clave de idempotencia no cobra dos veces y
//     entrega el resultado ya generado;
//   · piloto: SOLO la operación 'aviso' (C-03). Las demás operaciones del
//     inventario se conectarán por fases con autorización del PO.
//
// Los tokens reales y el modelo usado se guardan en iaConsumosInterno (sin
// acceso del cliente): el docente piensa en créditos, no en nuestro costo.

const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { defineSecret } = require('firebase-functions/params')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { logger } = require('firebase-functions')
const ledger = require('./creditosLedger')
const { resolverIntentoGanador, respuestasVivasSonDelIntentoGanador } = require('./calificacionIntentos')
const fuentesIA = require('./fuentesIA')
const { dividirEnFragmentos } = require('./docChunking')
const { prepararEvidenciasEntrega } = require('./evidenciasEntrega')
// Lógica PURA de calendario/sesiones, compartida con el cliente — ver
// src/utils/sesionesReales.js (fuente real) y scripts/sync-functions-shared.mjs
// (genera esta copia en cada predeploy; también hay que correrlo a mano antes
// de `npm run test:unit/test:server/test:ia`, ya cubierto por los pretest:*
// de package.json).
const { calcularSesionesReales } = require('./_shared/sesionesReales.js')
const { fechasVacacionParaClases } = require('./_shared/vacaciones.js')
const { parcialForDate } = require('./_shared/parciales.js')
const { promedioParcial, normalizeGrade, ponderacionActivaEnParcial } = require('./_shared/ponderacion.js')
const { resolveVisibilidad } = require('./_shared/activityVisibility.js')
const { EVALUACION_DEFAULTS } = require('./_shared/evaluacionDefaults.js')
const { calcularTarifaExamen } = require('./_shared/tarifaExamen.js')

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY')

// Extensiones que de verdad se pueden leer como texto (mismo criterio que
// tipoFuentePermitido en src/utils/fuentesAsignatura.js, mas los formatos de
// Office que también acepta docExtract). "Material de apoyo" no restringe
// tipo de archivo (puede ser una imagen, un video, un enlace) — filtrar aquí
// evita gastar una descarga+extracción en algo que nunca iba a servir de
// contexto de texto; lo que de todos modos no se pueda leer se ignora en
// silencio más abajo (prepararBloqueFuentesGenerales), así que este filtro
// es una optimización, no una validación indispensable.
const EXTENSIONES_LEGIBLES = /\.(pdf|docx?|pptx?|xlsx?)$/i

// Fuentes PERMANENTES que se incluyen SIEMPRE en OP-03/04/05/09, sin el tope
// de 3 (ese tope solo aplica a lo que el docente adjunta a mano en la
// operación puntual) y sin que el docente tenga que volver a adjuntarlas
// aquí. Son dos grupos, con dueños distintos a propósito:
//   · TODAS las fuentes GENERALES guardadas en Config Asistente IA → Fuentes
//     (`fuentesAsignatura`, ubicacion:'general' — programa oficial y
//     documentos del curso completo, PDF/Word únicamente).
//   · Los archivos de "Material de apoyo" (`materials`, tab Actividades por
//     parcial) cuyo `parcial` sea EXACTAMENTE el de esta operación — nunca
//     los de otro parcial. Corrección de Kike (13-ago-2026): antes existía
//     un segundo bucket "Fuentes del Parcial N" en Config Asistente IA,
//     duplicado con Material de apoyo (que YA es donde el docente sube
//     documentos específicos de cada parcial) — se quitó el bucket
//     duplicado, esta función ahora lee directo de Material de apoyo.
// Devuelve también las URLs incluidas (para que el llamador pueda excluirlas
// de lo que el docente adjuntó a mano y no aparezca duplicado en el prompt).
async function bloqueFuentesPermanentes(db, asignaturaId, parcial) {
  if (!asignaturaId) return { texto: null, urls: [] } // actividad de prueba/legacy — no truena la query
  const [generalesSnap, materialesSnap] = await Promise.all([
    db.collection('fuentesAsignatura')
      .where('asignaturaId', '==', asignaturaId)
      .where('ubicacion', '==', 'general')
      .get(),
    parcial
      ? db.collection('materials')
        .where('asignaturaId', '==', asignaturaId)
        .where('parcial', '==', parcial)
        .get()
      : Promise.resolve({ docs: [] }),
  ])
  const urlsGenerales = generalesSnap.docs.map((d) => d.data().url).filter(Boolean)
  const urlsMateriales = materialesSnap.docs
    .flatMap((d) => Array.isArray(d.data().archivos) ? d.data().archivos : [])
    .map((a) => a?.url)
    .filter((url) => url && EXTENSIONES_LEGIBLES.test(url))
  const urls = [...urlsGenerales, ...urlsMateriales]
  const texto = await fuentesIA.prepararBloqueFuentesGenerales(urls)
  return { texto, urls }
}

// Quita de lo que el docente adjuntó a mano cualquier URL que ya entró por
// la biblioteca permanente — evita que la misma fuente aparezca dos veces en
// el prompt cuando FuentesIAInput reutilizó una ya guardada (mismo criterio
// de identidad: la URL, porque reutilizar significa apuntar a la MISMA URL
// almacenada — ver esMismaFuente en src/utils/fuentesAsignatura.js). Función
// pura, sin red, para poder probarla directo.
function excluirUrlsPermanentes(fuentesManual, permanentesUrls) {
  const yaIncluidas = new Set(permanentesUrls || [])
  return (Array.isArray(fuentesManual) ? fuentesManual : []).filter((url) => url && !yaIncluidas.has(url))
}

// Arma el bloque final de fuentes de una operación: permanentes (generales +
// parcial correspondiente) + lo que el docente adjuntó a mano, SIN duplicar
// una fuente que ya entró por la biblioteca permanente.
async function bloqueFuentesOperacion(db, { asignaturaId, parcial, fuentesManual }) {
  const permanentes = await bloqueFuentesPermanentes(db, asignaturaId, parcial)
  const manualSinDuplicar = excluirUrlsPermanentes(fuentesManual, permanentes.urls)
  return fuentesIA.combinarBloquesFuentes(
    permanentes.texto,
    await fuentesIA.prepararBloqueFuentes(manualSinDuplicar)
  )
}

// Operaciones conectadas por autorización del PO:
//   · C-03 'aviso' (9-ago-2026) · C-02 'calificar_abierta' (9-ago-2026)
//   · OP-06 'rubrica' y OP-07 'cotejo' (10-ago-2026) · OP-09 'reactivos' (10-ago-2026)
//   · OP-10 'analizar_resultados' (11-ago-2026) · OP-03/OP-04 'crear_evaluacion_ia'
//     (11-ago-2026, autorizado en conversación con el PO) · OP-05
//     'crear_actividad_ia' (11-ago-2026, misma autorización) · OP-11
//     'calificar_entregable_ia' (21-ago-2026, autorizado por Kike en esta
//     conversación — función CENTRAL de valor de la IA, no secundaria).
const OPERACIONES = {
  aviso: ejecutarAviso,
  calificar_abierta: ejecutarCalificarAbierta,
  rubrica: ejecutarRubrica,
  cotejo: ejecutarCotejo,
  calificar_entregable_ia: ejecutarCalificarEntregableIA,
  calificar_entregable_ia_lote: ejecutarCalificarEntregableIALote,
  reactivos: ejecutarReactivos,
  analizar_resultados: ejecutarAnalisisResultados,
  crear_evaluacion_ia: ejecutarCrearEvaluacion,
  crear_actividad_ia: ejecutarCrearActividad,
  // Diagnóstico del grupo (FASE 2-BIS, 12-ago-2026, autorizado por Kike en
  // esta conversación — tarifas fijas: contexto 5, conocimientos 10).
  diagnostico_contexto: ejecutarDiagnosticoContexto,
  diagnostico_conocimientos: ejecutarDiagnosticoConocimientos,
  // Planeación Didáctica Inicial (FASE 2-BIS, 12-ago-2026, autorizado por
  // Kike en esta conversación — tarifa fija: 20 créditos).
  planeacion_didactica_inicial: ejecutarPlaneacionDidacticaInicial,
  // Chat con Asistente (17-ago-2026, 18-ago-2026): la conversación ya no
  // cobra (tarifa 0) — solo cobran las acciones que confirma, abajo.
  chat_asistente: ejecutarChatAsistente,
  // Confirmar/ejecutar una acción del Chat con Acciones (18-ago-2026) —
  // tarifas definitivas: actividad (entregable/observación) 4 créditos fijos;
  // examen por tramos de 10 reactivos (ver calcularTarifaExamen).
  chat_crear_actividad: ejecutarChatCrearActividad,
  chat_crear_examen: ejecutarChatCrearExamen,
  // Crucigrama / Sopa de letras (22-ago-2026, decisión de producto #2
  // aprobada): SOLO genera el contenido (palabras + descripciones), tarifa
  // fija 0.5 crédito sin importar cantidad/modalidad/documento. La
  // construcción de la cuadrícula es aparte (functions/juego.js,
  // construirJuego) y esa NUNCA pasa por aquí ni por el ledger.
  generar_contenido_juego: ejecutarGenerarContenidoJuego,
}

// Comprobaciones que corren ANTES de reservar créditos. Una operación con
// precheck no llega al ledger si el contexto no da: el docente recibe un
// mensaje que le dice qué le falta y su saldo queda intacto (no hay reserva
// que reembolsar porque nunca existió). Lo que devuelve el precheck viaja al
// ejecutor, que así no vuelve a leer nada de Firestore.
const PRECHECKS = {
  rubrica: precheckInstrumento, cotejo: precheckInstrumento,
  calificar_entregable_ia: precheckCalificarEntregable,
  calificar_entregable_ia_lote: precheckCalificarEntregableLote,
  reactivos: precheckReactivos,
  analizar_resultados: precheckAnalisisResultados, crear_evaluacion_ia: precheckCrearEvaluacion,
  crear_actividad_ia: precheckCrearActividad,
  diagnostico_contexto: precheckDiagnosticoContexto, diagnostico_conocimientos: precheckDiagnosticoConocimientos,
  planeacion_didactica_inicial: precheckPlaneacionInicial,
  chat_asistente: precheckChatAsistente,
  chat_crear_actividad: precheckChatCrearActividad,
  chat_crear_examen: precheckChatCrearExamen,
  generar_contenido_juego: precheckGenerarContenidoJuego,
}

// ── Piloto C-03 · Redactar aviso ────────────────────────────────────────────
// Entrada: tipo de aviso (los 12 del producto) + datos del docente + nombre
// de la asignatura. Salida: { titulo, mensaje } que el cliente coloca en el
// editor de avisos — el docente edita y publica como siempre; la IA nunca
// publica.
async function ejecutarAviso({ params, modelo, apiKey }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })

  const tipo = String(params?.tipo || 'OTRO').slice(0, 40)
  const datos = String(params?.datos || '').slice(0, 1500)
  const asignatura = String(params?.asignaturaNombre || '').slice(0, 120)
  // El cliente manda datos = tipo cuando el docente no escribió nada: ambos
  // casos cuentan como "sin detalles" y producen un borrador genérico.
  const sinDetalles = !datos.trim() || datos.trim().toLowerCase() === tipo.trim().toLowerCase()

  const inicio = Date.now()
  const msg = await client.messages.create({
    model: modelo,
    max_tokens: 400,
    system:
      'Eres el asistente pedagógico de Evalúa Fácil dentro de la asignatura de un docente de ' +
      'bachillerato mexicano. Tu papel es PROPONER: el docente siempre revisa y decide. ' +
      'SIEMPRE entregas un borrador; nunca pides información, nunca dices que no puedes y nunca ' +
      'explicas qué te faltó. Si no hay detalles, redacta en términos generales ("próximamente", ' +
      '"en la fecha indicada en clase") sin inventar datos concretos (fechas, horas, lugares, nombres) ' +
      'y sin huecos por rellenar tipo [fecha]. ' +
      'Escribe en español, claro y breve. Responde únicamente con el JSON pedido, sin texto adicional.',
    messages: [{
      role: 'user',
      content:
        `Redacta un aviso de tipo ${tipo} para el grupo` +
        (asignatura ? ` de la asignatura "${asignatura}"` : '') +
        (sinDetalles
          ? '. El docente no dio detalles: redacta un borrador genérico y útil de este tipo de aviso, listo para que él lo edite.\n\n'
          : ` con estos datos del docente:\n"""${datos}"""\n\n`) +
        'Claro y completo (qué, cuándo y qué deben hacer), tono cercano y respetuoso, breve. ' +
        'Responde SOLO con este JSON: {"titulo": "<máx 60 caracteres>", "mensaje": "<2-5 frases>"}',
    }],
  })

  let texto = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
  if (texto.startsWith('```')) texto = texto.replace(/^```(json)?\n?/, '').replace(/```$/, '').trim()
  let salida
  try {
    salida = JSON.parse(texto)
  } catch {
    // Respuesta no-JSON: se aprovecha como mensaje plano antes que fallar.
    salida = { titulo: '', mensaje: texto.slice(0, 1000) }
  }
  return {
    resultado: {
      titulo: String(salida.titulo || '').slice(0, 120),
      mensaje: String(salida.mensaje || '').slice(0, 2000),
    },
    unidadesReales: 1, // un aviso redactado = una unidad cobrada
    interno: {
      modelo,
      tokensEntrada: msg.usage?.input_tokens ?? null,
      tokensSalida: msg.usage?.output_tokens ?? null,
      ms: Date.now() - inicio,
    },
  }
}

// ── Piloto C-02 · Sugerir calificación de respuestas abiertas ───────────────
// Prompt y formato de salida COMPACTO validados en las pruebas reales con
// Haiku 4.5 (9-ago-2026) — no modificar sin autorización del PO. Reglas:
//   · la IA NO entrega total: EF suma los criterios (aquí, el criterio único
//     de la pregunta cuando el docente no definió criterios — decisión PO);
//   · requiere_revision_humana lo fija EF por código, siempre true;
//   · solo sugiere: JAMÁS escribe la calificación (O3) — el cliente la
//     muestra y el docente decide;
//   · lote: 1 crédito por respuesta REALMENTE sugerida; vacías, de archivo o
//     fallidas no se cobran (la liquidación devuelve la diferencia).
// El servidor lee las respuestas de Firestore por ID (el cliente no manda
// textos): verifica que la actividad sea del docente y solo procesa
// respuestas de texto pendientes de calificar.
//
// CANDADO POR RESPUESTA + PERSISTENCIA (endurecimiento del PO, 9-ago-2026):
// cada sugerencia vive en activities/{id}/iaSugerencias/{subId_pregId}. El
// create() atómico de ese documento ('procesando') es el derecho a procesar
// la respuesta: dos lotes concurrentes se reparten las respuestas sin cobrar
// ni llamar a Haiku dos veces por la misma. Al terminar, el documento guarda
// la sugerencia ('pendiente') y el cliente la recupera aunque cierre la
// pestaña — verla de nuevo JAMÁS cobra. El docente la aplica/edita/guarda y
// su guardado la marca 'aplicada'. Un candado 'procesando' huérfano (crash)
// se puede retomar pasados 10 minutos (el doble del timeout de la función).

const C02_SISTEMA =
  'Eres el asistente pedagógico de Evalúa Fácil y trabajas dentro de la asignatura de un ' +
  'docente de bachillerato mexicano. Tu papel es PROPONER: el docente siempre revisa y decide. ' +
  'Usa exclusivamente la información del contexto; no inventes nada que no esté en la evidencia. ' +
  'Escribe en español. Sé BREVE: frases cortas, sin repetir la respuesta del alumno. ' +
  'Responde únicamente con el JSON válido del esquema indicado, sin texto adicional.'

// Máximo de caracteres de una respuesta que se envía a la IA (≈1.5× la
// respuesta extensa validada de ~5 páginas). Más largas → se omiten sin
// cobro y el docente las califica a mano.
const C02_MAX_CHARS = 40000
// Concurrencia limitada dentro del lote: suficiente para 150 respuestas en
// ~2 min sin rozar los límites de peticiones/minuto del proveedor.
const C02_CONCURRENCIA = 4

function c02Prompt({ asignatura, categoria, titulo, enunciado, ponderacion, texto }) {
  return (
    `Asignatura: ${asignatura || 'la asignatura del docente'} (bachillerato).\n` +
    `Actividad: ${categoria} "${titulo}", pregunta de respuesta corta. Puntos posibles: ${ponderacion}.\n\n` +
    `PREGUNTA:\n${enunciado}\n\n` +
    `CRITERIOS DE EVALUACIÓN (los puntos suman ${ponderacion}):\n` +
    `1. Responde correcta y completamente lo planteado en la pregunta (${ponderacion} pts).\n\n` +
    `RESPUESTA DEL ALUMNO:\n"""${texto}"""\n\n` +
    'Evalúa la respuesta contra los criterios. NO calcules ni incluyas el total: Evalúa Fácil lo suma.\n' +
    'Sé compacto: evidencias de máximo 12 palabras, máximo 3 fortalezas y máximo 4 errores (los más importantes).\n\n' +
    'Responde SOLO con este JSON:\n' +
    '{\n' +
    `  "criterios": [\n    {"n": 1, "puntos": <0-${ponderacion}, un decimal>, "evidencia": "<máx 12 palabras>"}\n  ],\n` +
    '  "fortalezas": ["<máx 12 palabras>", "..."],\n' +
    '  "errores": [{"error": "<máx 10 palabras>", "evidencia": "<cita/referencia máx 12 palabras>"}],\n' +
    '  "retroalimentacion": "<2-3 frases breves al alumno>",\n' +
    '  "requiere_revision_humana": true\n' +
    '}'
  )
}

async function ejecutarCalificarAbierta({ params, modelo, apiKey, unidades }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const db = getFirestore()
  const uid = params.__uid // inyectado por el callable, jamás por el cliente

  const actividadId = String(params?.actividadId || '')
  if (!actividadId) throw new HttpsError('invalid-argument', 'Falta la actividad a calificar')

  const actSnap = await db.doc(`activities/${actividadId}`).get()
  if (!actSnap.exists) throw new HttpsError('not-found', 'La actividad no existe')
  const act = actSnap.data()
  if (act.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta actividad no es tuya')

  const categoria = act.categoria === 'examen' ? 'examen' : 'cuestionario'
  const titulo = String(act.titulo || act.nombre || 'evaluación').slice(0, 120)
  const asignatura = String(params?.asignaturaNombre || '').slice(0, 120)

  // Preguntas de respuesta corta del instrumento (el enunciado y su
  // ponderación son la base del criterio único).
  const pregSnap = await db.collection(`activities/${actividadId}/preguntas`).get()
  const abiertas = new Map()
  pregSnap.docs.forEach((d) => {
    const p = d.data()
    if (p.tipo === 'respuesta_corta') abiertas.set(d.id, p)
  })
  if (!abiertas.size) throw new HttpsError('failed-precondition', 'Esta evaluación no tiene preguntas de respuesta corta')

  // Entregas finalizadas pendientes de revisión → respuestas de texto sin
  // calificar. (Consulta de UNA igualdad + filtros en memoria, regla del
  // proyecto sobre índices.)
  const subsSnap = await db.collection('submissions').where('actividadId', '==', actividadId).get()
  const pendientes = subsSnap.docs.filter((d) => {
    const s = d.data()
    return s.estadoEvaluacion === 'finalizado' && s.pendienteRevision === true
  })

  const items = []
  let omitidas = 0
  for (const subDoc of pendientes) {
    const respSnap = await db.collection(`submissions/${subDoc.id}/respuestas`).get()
    for (const r of respSnap.docs) {
      const preg = abiertas.get(r.id)
      if (!preg) continue
      const resp = r.data()
      if (resp.puntosObtenidos != null) continue // ya calificada por el docente
      const texto = String(resp.textoRespuesta || '').trim()
      if (!texto) { omitidas++; continue } // sin respuesta: no hay nada que evaluar ni cobrar
      if (texto.length > C02_MAX_CHARS) { omitidas++; continue } // fuera del rango validado
      items.push({ sub: subDoc.id, preg: r.id, pregunta: preg, texto })
    }
  }

  if (!items.length) throw new HttpsError('failed-precondition', 'No hay respuestas de texto pendientes de calificar')
  if (items.length > unidades) {
    throw new HttpsError('failed-precondition',
      `Hay ${items.length} respuestas pendientes pero la estimación fue de ${unidades}. Vuelve a intentarlo para re-estimar.`)
  }

  // ── Candado por respuesta: adquirir el derecho a procesar cada una ────────
  // create() atómico: solo UN lote puede crear el documento de una respuesta.
  // Si ya existe: 'pendiente'/'aplicada' → ya fue procesada y cobrada antes
  // (no se cobra ni se llama a Haiku de nuevo); 'procesando' → otro lote la
  // tiene en este momento (se le deja), salvo que sea un huérfano viejo.
  const adquiridos = []
  let yaProcesadas = 0
  for (const item of items) {
    const ref = db.doc(`activities/${actividadId}/iaSugerencias/${item.sub}_${item.preg}`)
    try {
      await ref.create({
        estado: 'procesando', actividadId, sub: item.sub, preg: item.preg,
        consumoKey: params.__idempotencyKey || null, creadoEn: FieldValue.serverTimestamp(),
      })
      adquiridos.push({ ...item, ref })
    } catch {
      // Ya existe: decidir en transacción (evita que dos lotes retomen el
      // mismo huérfano a la vez).
      const tomado = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref)
        if (!s.exists) return false // borrado en el intervalo: raro; se deja
        const d = s.data()
        const edadMs = d.creadoEn?.toDate ? Date.now() - d.creadoEn.toDate().getTime() : 0
        if (d.estado === 'procesando' && edadMs > 10 * 60 * 1000) {
          tx.update(ref, { consumoKey: params.__idempotencyKey || null, creadoEn: FieldValue.serverTimestamp() })
          return true // huérfano retomado
        }
        return false
      })
      if (tomado) adquiridos.push({ ...item, ref })
      else yaProcesadas++
    }
  }

  if (!adquiridos.length) {
    // Todo el lote ya tiene sugerencia (o está en manos de otro lote): no se
    // cobra nada — el callable reembolsa la reserva completa.
    throw new HttpsError('failed-precondition',
      'Estas respuestas ya tienen sugerencia de IA o se están procesando en este momento. No se descontaron créditos.')
  }

  const inicio = Date.now()
  let tokensEntrada = 0
  let tokensSalida = 0
  let fallidas = 0
  const sugerencias = []

  // Cola con concurrencia limitada — sin dependencias externas.
  let cursor = 0
  async function trabajador() {
    while (cursor < adquiridos.length) {
      const item = adquiridos[cursor++]
      const max = Number(item.pregunta.ponderacion) || 0
      try {
        const msg = await client.messages.create({
          model: modelo,
          max_tokens: 800,
          system: C02_SISTEMA,
          messages: [{
            role: 'user',
            content: c02Prompt({
              asignatura, categoria, titulo,
              enunciado: String(item.pregunta.enunciado || '').slice(0, 2000),
              ponderacion: max, texto: item.texto,
            }),
          }],
        })
        tokensEntrada += msg.usage?.input_tokens || 0
        tokensSalida += msg.usage?.output_tokens || 0
        let texto = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
        if (texto.startsWith('```')) texto = texto.replace(/^```(json)?\n?/, '').replace(/```$/, '').trim()
        const datos = JSON.parse(texto)
        // EF calcula el total: cada criterio acotado a su máximo y la suma a
        // la ponderación de la pregunta. La IA no es fuente del total.
        const criterios = (Array.isArray(datos.criterios) ? datos.criterios : []).map((c, i) => ({
          n: Number(c.n) || i + 1,
          puntos: Math.min(max, Math.max(0, Number(c.puntos) || 0)),
          evidencia: String(c.evidencia || '').slice(0, 200),
        }))
        if (!criterios.length) throw new Error('sin criterios en la salida')
        const total = Math.min(max, Math.round(criterios.reduce((s, c) => s + c.puntos, 0) * 10) / 10)
        const sugerencia = {
          sub: item.sub,
          preg: item.preg,
          puntos: total, // calculado por EF, jamás por la IA
          criterios,
          fortalezas: (Array.isArray(datos.fortalezas) ? datos.fortalezas : []).slice(0, 3).map((f) => String(f).slice(0, 200)),
          errores: (Array.isArray(datos.errores) ? datos.errores : []).slice(0, 4).map((e) => ({
            error: String(e?.error || '').slice(0, 150),
            evidencia: String(e?.evidencia || '').slice(0, 200),
          })),
          retroalimentacion: String(datos.retroalimentacion || '').slice(0, 1000),
          requiere_revision_humana: true, // lo fija EF por código, siempre
        }
        // Persistir ANTES de contar como cobrable: si esta escritura falla,
        // la respuesta cae al catch (candado liberado, sin cobro).
        await item.ref.set({
          estado: 'pendiente', sugerencia, actualizadoEn: FieldValue.serverTimestamp(),
        }, { merge: true })
        sugerencias.push(sugerencia)
      } catch (e) {
        // Esta respuesta no se cobra y su candado se libera para reintentos.
        fallidas++
        logger.warn(`C-02: respuesta ${item.sub}/${item.preg} falló: ${String(e.message || e).slice(0, 200)}`)
        await item.ref.delete().catch((err) => logger.error('C-02: liberar candado falló:', err))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(C02_CONCURRENCIA, adquiridos.length) }, trabajador))

  if (!sugerencias.length) {
    // Nada utilizable: el callable reembolsa la reserva completa.
    throw new HttpsError('unavailable', 'El asistente de IA no pudo calificar ninguna respuesta. No se descontaron créditos.')
  }

  return {
    resultado: { sugerencias, omitidas, fallidas, yaProcesadas },
    unidadesReales: sugerencias.length, // 1 crédito por respuesta realmente sugerida
    interno: {
      modelo,
      tokensEntrada,
      tokensSalida,
      ms: Date.now() - inicio,
      respuestas: sugerencias.length,
      fallidas,
      omitidas,
      yaProcesadas,
    },
  }
}

// ── OP-06 / OP-07 · Rúbrica y lista de cotejo ───────────────────────────────
// REGLA ARQUITECTÓNICA (PO, 10-ago-2026): una rúbrica o lista de cotejo NO es
// una operación independiente. Siempre se deriva de una ACTIVIDAD PADRE, que
// solo puede ser de dos clases:
//
//   Entregable            → rúbrica/cotejo → evidencia del estudiante → calificación
//   Actividad de observación → rúbrica/cotejo → observación del docente → calificación
//
// De ahí salen las tres reglas que este bloque hace cumplir:
//
//  1. CONTEXTO DEL SERVIDOR. La operación recibe `actividadId`, nunca el texto
//     de la actividad. El servidor lee activities/{id}, comprueba que es del
//     docente que llama y arma el contexto con lo que hay en Firestore. Lo que
//     mande el cliente como contenido pedagógico se ignora.
//  2. NO AISLAMIENTO. Sin actividad padre no hay operación. El banco de
//     rúbricas no puede generar: ahí no hay de qué derivar los criterios.
//  3. INFORMACIÓN INSUFICIENTE. Si la actividad no da para fundamentar
//     criterios, la operación se detiene ANTES de reservar créditos y le dice
//     al docente qué le falta. No se inventa nada ni se rellena con
//     conocimiento general.
//
// La IA propone SOLO contenido pedagógico: nombres de criterios, nombres de
// niveles y descriptores. Los números (pesos, puntos, totales) los pone
// Evalúa Fácil en el cliente con `rubricaDesdePropuesta`/`cotejoDesdePropuesta`
// y los valida con `validarRubrica` — mismo principio que C-02: la IA nunca es
// fuente de verdad de la aritmética.

// Categorías que SÍ pueden ser padre. 'actividad' y 'tarea' son los nombres
// viejos del entregable (ver SubjectPage.jsx, que los normaliza al abrir).
const PADRES_VALIDOS = { entregable: 'entregable', actividad: 'entregable', tarea: 'entregable', observacion: 'observacion' }

// Mínimo de texto útil en las instrucciones para poder fundamentar criterios.
// Es un umbral de CÓDIGO a propósito: preguntarle al modelo si el contexto
// alcanza costaría una llamada y lo empujaría a "esforzarse" e inventar, que
// es justo lo que la regla prohíbe.
const MIN_INSTRUCCIONES = 40

// Rango de criterios/niveles que el docente puede pedir — mismo rango que
// utils/rubrica.js en el cliente (MIN_CRITERIOS..MAX_NIVELES). Se repite aquí
// porque el servidor no puede confiar en lo que mande el cliente: si pide un
// número fuera de rango, se acota en silencio en vez de rechazar la operación.
const MIN_CRITERIOS = 2
const MAX_CRITERIOS = 6
const MIN_NIVELES = 3
const MAX_NIVELES = 5

function clampInt(v, def, min, max) {
  const n = Number.isInteger(v) ? v : parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}

// Las instrucciones se guardan como HTML enriquecido; para el prompt sirve el
// texto pelón. Sin dependencias: quitar etiquetas y devolver las entidades
// más comunes a su carácter.
function textoPlano(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Arma el contexto REAL de la actividad padre a partir del documento de
// Firestore, y dice qué falta si no alcanza. Función pura sobre `act` para
// poder probarla sin emulador (ver _pruebas al final del archivo).
function contextoDeActividad(act) {
  const clase = PADRES_VALIDOS[act.categoria] || null
  const nombre = String(act.nombre || act.titulo || '').trim().slice(0, 200)
  const instrucciones = textoPlano(act.instrucciones).slice(0, 4000)
  const adjuntos = (Array.isArray(act.archivosAdjuntos) ? act.archivosAdjuntos : [])
    .map((a) => String(a?.nombre || '').trim()).filter(Boolean).slice(0, 10)

  const faltantes = []
  if (nombre.length < 3) faltantes.push('el nombre de la actividad')
  if (instrucciones.length < MIN_INSTRUCCIONES) {
    faltantes.push(clase === 'observacion'
      ? 'la descripción de qué vas a observar (en las instrucciones de la actividad)'
      : 'las instrucciones de la actividad — qué debe hacer y entregar el estudiante')
  }

  return { clase, nombre, instrucciones, adjuntos, faltantes }
}

// El "producto o evidencia" solicitada y las condiciones del entregable salen
// de campos reales de la actividad, no de una suposición. En una observación
// no existen: no hay archivo que entregar ni fecha de entrega que cumplir, y
// por eso NO se le pasan al modelo (regla 4 del PO).
function condicionesEntregable(act) {
  const partes = []
  const tipos = Array.isArray(act.tiposArchivo) ? act.tiposArchivo.filter(Boolean) : []
  if (tipos.length) partes.push(`Tipos de archivo que debe subir: ${tipos.join(', ')}`)
  const custom = String(act.extensionesCustom || '').trim()
  if (custom) partes.push(`Extensiones aceptadas: ${custom}`)
  if (act.fechaLimite) partes.push('La actividad tiene fecha límite de entrega')
  if (act.recibirTarde === false) partes.push('No se aceptan entregas después de la fecha límite')
  return partes
}

// Precheck: todo lo que puede rechazar la operación SIN gastar un crédito.
// Corre en el callable antes de `ledger.reservar` (ver más abajo).
async function precheckInstrumento({ uid, params }) {
  const db = getFirestore()
  const actividadId = String(params?.actividadId || '')
  if (!actividadId) {
    throw new HttpsError('invalid-argument',
      'Guarda primero la actividad: la rúbrica se construye a partir de ella.')
  }

  const snap = await db.doc(`activities/${actividadId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'La actividad no existe')
  const act = snap.data()
  if (act.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta actividad no es tuya')

  const ctx = contextoDeActividad(act)
  if (!ctx.clase) {
    throw new HttpsError('failed-precondition',
      'Solo un entregable o una actividad de observación pueden tener rúbrica o lista de cotejo.')
  }
  if (ctx.faltantes.length) {
    // Ni reserva ni llamada al modelo: aquí no se descuenta nada.
    throw new HttpsError('failed-precondition',
      `No hay información suficiente en la actividad para construir una rúbrica fundamentada. Falta ${ctx.faltantes.join(' y ')}. Complétala y vuelve a intentarlo — no se descontaron créditos.`,
      { codigo: 'CONTEXTO_INSUFICIENTE', faltantes: ctx.faltantes })
  }

  return {
    ...ctx,
    condiciones: ctx.clase === 'entregable' ? condicionesEntregable(act) : [],
  }
}

const INSTRUMENTO_SISTEMA =
  'Eres el asistente pedagógico de Evalúa Fácil y trabajas dentro de la asignatura de un ' +
  'docente de bachillerato mexicano. Tu papel es PROPONER: el docente siempre revisa, edita y decide. ' +
  'Construye los criterios EXCLUSIVAMENTE a partir de la actividad que se te describe. ' +
  'No agregues criterios que no puedan justificarse con esa actividad, y no completes con ' +
  'conocimiento general del tema. No incluyas puntos, pesos, porcentajes ni totales: ' +
  'Evalúa Fácil calcula toda la aritmética. Escribe en español, claro y breve. ' +
  'Responde únicamente con el JSON válido del esquema indicado, sin texto adicional.'

// Bloque de contexto común a las cuatro combinaciones (rúbrica/cotejo ×
// entregable/observación). Solo con datos leídos de Firestore.
function bloqueContexto(ctx, asignatura) {
  const esObs = ctx.clase === 'observacion'
  let t = `Asignatura: ${asignatura || 'la asignatura del docente'} (bachillerato).\n`
  t += esObs
    ? `ACTIVIDAD DE OBSERVACIÓN (sin entrega de archivos): "${ctx.nombre}".\n\n`
    : `ACTIVIDAD ENTREGABLE: "${ctx.nombre}".\n\n`
  t += esObs
    ? `LO QUE EL DOCENTE VA A OBSERVAR:\n"""${ctx.instrucciones}"""\n`
    : `INSTRUCCIONES PARA EL ESTUDIANTE:\n"""${ctx.instrucciones}"""\n`
  if (ctx.adjuntos.length) t += `\nMateriales que el docente adjuntó: ${ctx.adjuntos.join(', ')}\n`
  if (ctx.condiciones.length) t += `\nCONDICIONES DE LA ENTREGA:\n- ${ctx.condiciones.join('\n- ')}\n`
  t += esObs
    ? '\nLos criterios deben ser conductas o desempeños OBSERVABLES durante la actividad. ' +
      'No menciones archivos, entregas, formatos de documento ni fechas límite: en una ' +
      'actividad de observación no existe nada de eso.\n'
    : '\nLos criterios deben evaluar lo que se le pide entregar al estudiante y las ' +
      'condiciones establecidas arriba.\n'
  return t
}

// Llamada + lectura del JSON, común a rúbrica/cotejo/reactivos. `bloques`
// (opcional) son content blocks adicionales — imagen/PDF nativo o texto de
// Word ya preparados por evidenciasEntrega.js — que se agregan DESPUÉS del
// prompt de texto, mismo patrón que evaluarEntregaConIA en "Calificar con IA".
async function pedirJSON({ client, modelo, maxTokens, prompt, system = INSTRUMENTO_SISTEMA, bloques = [] }) {
  const inicio = Date.now()
  const content = bloques.length ? [{ type: 'text', text: prompt }, ...bloques] : prompt
  const msg = await client.messages.create({
    model: modelo,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
  })
  let texto = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
  if (texto.startsWith('```')) texto = texto.replace(/^```(json)?\n?/, '').replace(/```$/, '').trim()
  return {
    datos: JSON.parse(texto), // un JSON ilegible cae al catch del callable → reembolso
    interno: {
      modelo,
      tokensEntrada: msg.usage?.input_tokens ?? null,
      tokensSalida: msg.usage?.output_tokens ?? null,
      ms: Date.now() - inicio,
    },
  }
}

const MAX_CONSIDERACIONES_CHARS = 400

// Preferencia libre del docente para generar rúbrica/lista de cotejo (p.ej.
// "que cada respuesta del ejercicio sea un criterio") — se agrega al prompt
// como algo A RESPETAR, nunca como reemplazo del contexto real leído de la
// actividad (ese sigue siendo bloqueContexto). Cadena vacía → sin bloque.
function bloqueConsideraciones(params) {
  const texto = String(params?.consideraciones || '').trim().slice(0, MAX_CONSIDERACIONES_CHARS)
  if (!texto) return ''
  return `\nCONSIDERACIONES DEL DOCENTE — tómalas en cuenta al proponer los criterios:\n"""${texto}"""\n`
}

// Evidencia opcional que el docente adjunta al generar rúbrica/lista de
// cotejo (23-ago-2026, pedido de Kike: "si subo las hojas en PDF de los
// ejercicios los considere") — hasta 5 imágenes, o 1 PDF, o 1 Word. Mismo
// motor que "Calificar con IA" (evidenciasEntrega.js): imagen/PDF nativo,
// Word como texto extraído. `params.archivos` = [{url, nombre}], igual que
// una entrega de estudiante.
async function evidenciaInstrumento(params) {
  const archivos = Array.isArray(params?.archivos) ? params.archivos : []
  if (!archivos.length) return { bloques: [], textoIntro: '' }
  const { bloques, detalle } = await prepararEvidenciasEntrega(archivos)
  if (!bloques.length) return { bloques: [], textoIntro: '' }
  return {
    bloques,
    textoIntro: `\nEl docente adjuntó ${detalle.length} archivo(s) como evidencia (por ejemplo, las hojas del ` +
      'ejercicio) — considéralos junto con las instrucciones de arriba al proponer los criterios.\n',
  }
}

// La propuesta que sale de aquí trae SOLO texto. Los números los pone el
// cliente con las funciones del modelo de rúbricas (utils/rubrica.js).
async function ejecutarRubrica({ params, modelo, apiKey }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const ctx = params.__contexto // lo puso el precheck; el cliente no puede tocarlo
  const asignatura = String(params?.asignaturaNombre || '').slice(0, 120)
  // El docente elige cuántos criterios y niveles quiere (utils/rubrica.js
  // clampea igual del lado del cliente); aquí se vuelve a acotar porque el
  // servidor no puede confiar en el número que mande el cliente.
  const numCriterios = clampInt(params?.numCriterios, MIN_CRITERIOS, MIN_CRITERIOS, MAX_CRITERIOS)
  const numNiveles = clampInt(params?.numNiveles, MIN_NIVELES, MIN_NIVELES, MAX_NIVELES)
  const nivelesEjemplo = Array.from({ length: numNiveles }, (_, i) => {
    if (i === 0) return '"<nivel más alto>"'
    if (i === numNiveles - 1) return '"<nivel más bajo>"'
    return '"<...>"'
  }).join(', ')
  const descriptoresEjemplo = Array.from({ length: numNiveles }, (_, i) => `"<nivel ${i + 1}>"`).join(', ')
  const evidencia = await evidenciaInstrumento(params)

  const { datos, interno } = await pedirJSON({
    client, modelo, maxTokens: 1500,
    prompt: bloqueContexto(ctx, asignatura) +
      bloqueConsideraciones(params) +
      evidencia.textoIntro +
      `\nPropón una RÚBRICA de ${numCriterios} criterios y ${numNiveles} niveles de desempeño ` +
      '(del mejor al peor), con un descriptor por cada criterio en cada nivel.\n' +
      'Los descriptores describen QUÉ se observa en ese nivel, en máximo 20 palabras, ' +
      'sin mencionar puntos ni calificaciones.\n\n' +
      'Responde SOLO con este JSON:\n' +
      '{\n' +
      '  "titulo": "<nombre de la rúbrica, máx 60 caracteres>",\n' +
      '  "descripcion": "<una frase sobre qué evalúa>",\n' +
      `  "niveles": [${nivelesEjemplo}],\n` +
      '  "criterios": [\n' +
      `    {"nombre": "<criterio, máx 8 palabras>", "descriptores": [${descriptoresEjemplo}]}\n` +
      '  ]\n' +
      '}',
    bloques: evidencia.bloques,
  })

  return {
    resultado: {
      propuesta: {
        titulo: String(datos.titulo || '').slice(0, 120),
        descripcion: String(datos.descripcion || '').slice(0, 300),
        niveles: (Array.isArray(datos.niveles) ? datos.niveles : []).map((n) => String(n).slice(0, 40)),
        criterios: (Array.isArray(datos.criterios) ? datos.criterios : []).map((c) => ({
          nombre: String(c?.nombre || '').slice(0, 200),
          descriptores: (Array.isArray(c?.descriptores) ? c.descriptores : []).map((d) => String(d).slice(0, 300)),
        })),
      },
      clase: ctx.clase,
    },
    unidadesReales: 1,
    interno,
  }
}

async function ejecutarCotejo({ params, modelo, apiKey }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const ctx = params.__contexto
  const asignatura = String(params?.asignaturaNombre || '').slice(0, 120)
  const numCriterios = clampInt(params?.numCriterios, MIN_CRITERIOS, MIN_CRITERIOS, MAX_CRITERIOS)
  const evidencia = await evidenciaInstrumento(params)

  const { datos, interno } = await pedirJSON({
    client, modelo, maxTokens: 800,
    prompt: bloqueContexto(ctx, asignatura) +
      bloqueConsideraciones(params) +
      evidencia.textoIntro +
      `\nPropón una LISTA DE COTEJO de ${numCriterios} indicadores. Cada indicador se marca ` +
      'cumple / no cumple, así que debe ser VERIFICABLE de un vistazo y sin ' +
      'grados intermedios (nada de "adecuadamente" o "de manera suficiente").\n\n' +
      'Responde SOLO con este JSON:\n' +
      '{\n' +
      '  "titulo": "<nombre de la lista, máx 60 caracteres>",\n' +
      '  "descripcion": "<una frase sobre qué verifica>",\n' +
      '  "criterios": [{"nombre": "<indicador verificable, máx 12 palabras>"}]\n' +
      '}',
    bloques: evidencia.bloques,
  })

  return {
    resultado: {
      propuesta: {
        titulo: String(datos.titulo || '').slice(0, 120),
        descripcion: String(datos.descripcion || '').slice(0, 300),
        criterios: (Array.isArray(datos.criterios) ? datos.criterios : []).map((c) => ({
          nombre: String(c?.nombre || '').slice(0, 200),
        })),
      },
      clase: ctx.clase,
    },
    unidadesReales: 1,
    interno,
  }
}

// ── OP-11 · Calificar entrega con IA (evidencias contra rúbrica/cotejo) ─────
// FUNCIÓN CENTRAL de valor de la IA (21-ago-2026, decisión explícita de
// Kike — NO es secundaria ni opcional). Analiza las evidencias que el
// estudiante entregó (JPG/PNG/PDF/DOCX, hasta MAX_EVIDENCIAS — ver
// evidenciasEntrega.js) contra la rúbrica o lista de cotejo YA GUARDADA en
// la actividad, y PROPONE un nivel por criterio con su justificación.
//
// MISMO MOTOR para los tres tipos de evidencia: evidenciasEntrega.js
// convierte cada archivo en su content block correspondiente y aquí se arma
// UN solo mensaje multimodal — no hay tres rutas de código por tipo, ni tres
// prompts distintos. Lo único que cambia entre rúbrica y lista de cotejo es
// cómo se describen los criterios en el prompt (bloqueCriteriosInstrumento);
// el esquema de salida es idéntico en ambos casos.
//
// La IA NUNCA asigna ni guarda la calificación (regla transversal del
// proyecto): el resultado entra al MISMO arreglo `rubricaEval` que ya usa la
// calificación manual (ver ActivityPage.jsx, mismo formato: índice de nivel
// por criterio, null = sin evidencia suficiente para proponer) — no se crea
// ninguna estructura de datos nueva en `submissions`. El docente revisa,
// ajusta y confirma con el botón "Guardar calificación" que ya existía.
//
// Tarifa FIJA de 1 crédito por entrega evaluada (config/iaTarifas), sin
// importar cuántas evidencias trajo (tope MAX_EVIDENCIAS) — decisión
// explícita de Kike, para que el docente piense en "evaluar una entrega",
// no en cuántas fotos tomó.

const CALIFICAR_ENTREGABLE_SISTEMA =
  'Eres el asistente pedagógico de Evalúa Fácil y trabajas dentro de la asignatura de un ' +
  'docente de bachillerato mexicano. Tu papel es PROPONER: el docente siempre revisa, ajusta y ' +
  'confirma la calificación — tú nunca la asignas de forma definitiva. ' +
  'Evalúa EXCLUSIVAMENTE lo que puedas observar en las evidencias adjuntas (fotografías, PDF o ' +
  'documento Word entregados por el estudiante) contra cada criterio del instrumento de ' +
  'evaluación. Si una evidencia no permite determinar un criterio con certeza (ilegible, ' +
  'incompleta, no corresponde a lo pedido, o simplemente no aparece), NO INVENTES ni asumas: ' +
  'marca ese criterio con sinEvidenciaSuficiente=true y dilo en su evidencia. Nunca completes ' +
  'con conocimiento general del tema — solo lo que de verdad observaste. Escribe en español, ' +
  'claro y breve. Responde únicamente con el JSON válido del esquema indicado, sin texto adicional.\n\n' +
  // AÑADIDO 23-ago-2026 (pedido explícito de Kike, tras detectar evaluaciones
  // reales que decían "falta la página" o "no se encuentra" ante una
  // fotografía HORIZONTAL que sí contenía la evidencia): la orientación de
  // una foto (vertical, horizontal, cuadrada, o el teléfono girado al
  // tomarla) NUNCA es indicio de que falte evidencia — es solo cómo el
  // estudiante sostuvo el teléfono. Distingue explícitamente "no puedo
  // verificarlo" (imagen presente pero ilegible) de "no existe" (no hay
  // ninguna imagen que corresponda a ese criterio).
  'REGLA ESTRICTA de ORIENTACIÓN Y LEGIBILIDAD: las fotografías pueden venir en cualquier ' +
  'orientación — vertical, horizontal, cuadrada, o giradas porque el estudiante sostuvo el teléfono ' +
  'de lado al fotografiar una hoja. Analiza el contenido visual real de cada imagen sin importar su ' +
  'orientación; una imagen horizontal es tan válida como una vertical y NUNCA debe tratarse como ' +
  'ausente, inválida o irrelevante solo por su forma. Antes de afirmar que falta una evidencia, ' +
  'confirma que de verdad no hay ninguna imagen que corresponda a ese criterio. Si la imagen SÍ está ' +
  'presente pero no logras leerla o interpretarla con suficiente confianza (borrosa, muy oscura, muy ' +
  'reducida, corte de la hoja, etc.), NO digas "no se encuentra", "no entregó" ni "falta la página" — ' +
  'en su lugar dilo tal cual: no pudiste verificar esa parte porque la imagen no es suficientemente ' +
  'legible. "No pude verificarlo" NUNCA es lo mismo que "no existe": solo afirma que falta una ' +
  'evidencia cuando realmente confirmaste que no hay ninguna imagen para ese criterio.\n\n' +
  // CORRECCIÓN 23-ago-2026 (pedido explícito de Kike): la retroalimentación
  // comenta el trabajo YA ENTREGADO — nunca insinúa que existe una segunda
  // oportunidad dentro de esta misma actividad. Si el docente quiere que el
  // estudiante rehaga el trabajo, el mecanismo correcto es crear una nueva
  // actividad entregable — eso lo decide él, no la IA.
  'REGLA ESTRICTA para "retroalimentacionGeneral": evalúa y comenta la evidencia tal como está — ' +
  'nunca sugieras, insinúes ni des a entender que el estudiante puede corregir, modificar, volver a ' +
  'entregar, subir una nueva versión o tener una segunda oportunidad en esta actividad. Prohibido ' +
  'usar frases como "corrige...", "vuelve a entregar...", "puedes mejorar y volver a subir...", ' +
  '"reentrega...", "sube una nueva versión...", "haz los cambios y entrega nuevamente..." o ' +
  'cualquier variante que implique una reentrega. En vez de eso, describe lo que falta u observas ' +
  'como una observación sobre el trabajo ya realizado — por ejemplo "Faltó incluir X y Y." o "El ' +
  'trabajo cumple con A y B; sin embargo, no se observa C." — nunca "Agrega C y vuelve a entregar."\n\n' +
  // CORRECCIÓN 25-ago-2026 (pedido explícito de Kike, tras un ejemplo real de
  // retroalimentación que sonaba a reporte de auditoría, no a un docente
  // hablándole a su estudiante — reescrita con la especificación completa
  // que dio Kike, con su mismo ejemplo de referencia).
  'REGLA ESTRICTA de VOZ y TONO para "retroalimentacionGeneral": debe sentirse como un comentario que ' +
  'REALMENTE escribiría el docente después de revisar el trabajo — nunca como un reporte técnico, un ' +
  'análisis de evidencias o un texto generado por IA.\n' +
  'PRIORIDAD DE ESTILO (por encima de cualquier otra consideración de forma): BREVE + HUMANA + ' +
  'CONCRETA + ÚTIL. Si 2-3 frases comunican con claridad lo importante, NO agregues más — no busques ' +
  'llenar espacio ni resumir todo el trabajo. Menciona solo los 1-3 aspectos más relevantes que el ' +
  'estudiante necesita conocer; si una idea no le aporta directamente, elimínala. Evita párrafos ' +
  'largos — una retroalimentación corta, clara y humana es preferible a una extensa.\n' +
  '- Habla directamente al estudiante, en segunda persona, con un tono natural, humano y docente.\n' +
  '- Usa su nombre de pila (viene en el prompt como "Nombre del estudiante") SOLO cuando resulte ' +
  'natural — no en cada frase, no como fórmula fija.\n' +
  '- Sé breve, clara y concreta; la extensión depende de cuántos aspectos realmente importantes ' +
  'encontraste — no la alargues artificialmente ni le pongas relleno.\n' +
  '- Reconoce primero lo positivo y después señala qué necesita mejorar.\n' +
  '- Prioriza lo más importante para el aprendizaje y ligado a los criterios de evaluación — no ' +
  'intentes mencionar todos los criterios de la rúbrica ni describir sistemáticamente todo lo que hay ' +
  'en las imágenes o archivos. No enumeres características de los archivos (formato, número de ' +
  'páginas, en cuántas hojas aparece el nombre, etc.) salvo que sea necesario para explicar una ' +
  'observación puntual.\n' +
  '- Prohibido el lenguaje de informe: nunca "el estudiante entregó...", "se observa que...", "las ' +
  'evidencias muestran...", "el estudiante presenta...", "los cálculos son mayoritariamente ' +
  'correctos..." ni ninguna variante en tercera persona o de auditoría.\n' +
  '- Nunca menciones a la IA, la revisión automática ni cómo se obtuvo la calificación.\n' +
  '- No inventes información ni afirmes algo que no esté respaldado por el trabajo revisado.\n' +
  'Ejemplo de lo que SÍ se espera (mismo caso, dos formas de decirlo):\n' +
  'MAL: "El estudiante Damneli Álvara Andrade entregó 5 imágenes resueltas de forma legible y ' +
  'organizada; sin embargo, falta la página 6 completa con sus ejercicios resueltos. El nombre ' +
  'completo aparece únicamente en una página cuando debería estar en todas. Los cálculos matemáticos ' +
  'son mayoritariamente correctos, incluyendo operaciones con signos y totales en tablas de ' +
  'presupuesto y deudas. Las respuestas a preguntas reflexivas existen pero resultan breves."\n' +
  'BIEN: "Damneli, tu trabajo está bien organizado y la mayoría de los ejercicios están correctamente ' +
  'resueltos. Te faltó completar la página 6 y sería importante que coloques tu nombre completo en ' +
  'todas las hojas. También revisa con más detalle las respuestas reflexivas, ya que algunas podrían ' +
  'estar mejor desarrolladas. Vas bien; solo necesitas cuidar esos aspectos."\n' +
  'LA IA DEBE PROPONER UNA RETROALIMENTACIÓN QUE PAREZCA ESCRITA POR EL DOCENTE PARA SU ESTUDIANTE, ' +
  'NO UNA DESCRIPCIÓN DE LO QUE LA IA ENCONTRÓ EN LAS EVIDENCIAS.'

// Espejo mínimo de esCotejo (src/utils/rubrica.js) — no vale la pena meter
// este archivo entero al mecanismo de _shared/ (scripts/sync-functions-
// shared.mjs) por una comparación de un campo.
const esCotejo = (r) => r?.tipo === 'cotejo'

// Espejo mínimo de totalRubrica (src/utils/rubrica.js) — SOLO lo usa
// "Recalificar todas con IA" para escribir la calificación real (ver
// ejecutarCalificarEntregableIALote). null = no se puede calcular un total
// definitivo (algún criterio sin evidencia suficiente); en ese caso NO se
// sobrescribe nada, la regla de "nunca inventar" gana sobre "recalificar
// sobrescribe" — el docente revisa esa entrega a mano, como antes.
function totalInstrumento(rubrica, seleccion) {
  if (!rubrica?.criterios?.length || !Array.isArray(seleccion)) return null
  if (esCotejo(rubrica)) {
    let total = 0
    for (let i = 0; i < rubrica.criterios.length; i++) {
      if (seleccion[i] === 0) total += rubrica.criterios[i].puntos?.[0] ?? 0
    }
    return Math.round(total * 10) / 10
  }
  let total = 0
  for (let i = 0; i < rubrica.criterios.length; i++) {
    const nivel = seleccion[i]
    if (nivel == null) return null
    total += rubrica.criterios[i].puntos?.[nivel] ?? 0
  }
  return Math.round(total * 10) / 10
}

// Espejo mínimo de rubricaFirma (src/utils/rubrica.js) — huella de la
// versión del instrumento usada para generar una evaluación de IA. Solo lo
// que AFECTA la evaluación entra (tipo, niveles, criterios con puntos y
// descriptores); título/descripción de la actividad quedan fuera a propósito
// (25-ago-2026, "Recalificar con IA" solo debe aparecer si el instrumento
// realmente cambió, nunca por instrucciones/fechas/configuración).
function rubricaFirma(rubrica) {
  if (!rubrica) return ''
  const huella = JSON.stringify({
    tipo: rubrica.tipo || 'rubrica',
    niveles: (rubrica.niveles || []).map((n) => ({ nombre: n?.nombre || '', porcentaje: n?.porcentaje ?? null })),
    criterios: (rubrica.criterios || []).map((c) => ({
      nombre: c?.nombre || '',
      puntos: (c?.puntos || []).map((p) => Math.round((parseFloat(p) || 0) * 10) / 10),
      descriptores: (c?.descriptores || []).map((d) => d || ''),
    })),
  })
  let h = 5381
  for (let i = 0; i < huella.length; i++) h = ((h * 33) ^ huella.charCodeAt(i)) >>> 0
  return h.toString(36)
}

// Describe los criterios del instrumento en el prompt — única diferencia
// real entre rúbrica y lista de cotejo (ver comentario del bloque arriba).
function bloqueCriteriosInstrumento(rubrica) {
  if (esCotejo(rubrica)) {
    const lista = rubrica.criterios.map((c, i) =>
      `${i + 1}. "${c.nombre}" — se marca CUMPLE (nivel 0) o NO CUMPLE (nivel null), sin términos intermedios.`
    ).join('\n')
    return `LISTA DE COTEJO — indicadores a verificar (cumple/no cumple):\n${lista}`
  }
  const niveles = rubrica.niveles.map((n, i) => `${i}=${n.nombre}`).join(', ')
  const lista = rubrica.criterios.map((c, i) => {
    const descriptores = c.descriptores
      .map((d, ni) => `  nivel ${ni} (${rubrica.niveles[ni]?.nombre || ''}): ${d || '(sin descriptor)'}`)
      .join('\n')
    return `${i + 1}. "${c.nombre}"\n${descriptores}`
  }).join('\n\n')
  return `RÚBRICA — niveles disponibles (${niveles}; 0 es el nivel más alto):\n\n${lista}`
}

// Solo el nombre de pila, capitalizado — para que la retroalimentación de
// la IA pueda usarlo con naturalidad ("Damneli, tu trabajo...") sin exponer
// apellidos que no aportan calidez al comentario. Espejo mínimo de
// capitalizarNombre (src/utils/nombres.js): mismo criterio "todo MAYÚSCULA
// o todo minúscula se corrige; una mezcla ya decidida se respeta tal cual".
function capitalizarPila(texto) {
  const limpio = String(texto ?? '').trim().replace(/\s+/g, ' ')
  if (!limpio) return ''
  if (/\p{Lu}/u.test(limpio) && /\p{Ll}/u.test(limpio)) return limpio
  return limpio.toLocaleLowerCase('es').replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('es'))
}
async function nombrePilaDeEstudiante(db, alumnoId) {
  if (!alumnoId) return ''
  try {
    const snap = await db.doc(`students/${alumnoId}`).get()
    return capitalizarPila(snap.data()?.nombre)
  } catch {
    return ''
  }
}

async function precheckCalificarEntregable({ uid, params }) {
  const db = getFirestore()
  const actividadId = String(params?.actividadId || '')
  const submissionId = String(params?.submissionId || '')
  if (!actividadId || !submissionId) {
    throw new HttpsError('invalid-argument', 'Falta la actividad o la entrega a calificar')
  }

  const actSnap = await db.doc(`activities/${actividadId}`).get()
  if (!actSnap.exists) throw new HttpsError('not-found', 'La actividad no existe')
  const act = actSnap.data()
  if (act.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta actividad no es tuya')
  if (PADRES_VALIDOS[act.categoria] !== 'entregable') {
    throw new HttpsError('failed-precondition', 'Solo un entregable con evidencia se puede calificar así.')
  }
  const rubrica = act.rubrica
  if (!rubrica?.criterios?.length) {
    throw new HttpsError('failed-precondition',
      'Esta actividad todavía no tiene rúbrica ni lista de cotejo guardada — créala primero. No se descontaron créditos.')
  }

  const subSnap = await db.doc(`submissions/${submissionId}`).get()
  if (!subSnap.exists) throw new HttpsError('not-found', 'La entrega no existe')
  const sub = subSnap.data()
  if (sub.actividadId !== actividadId) throw new HttpsError('permission-denied', 'Esta entrega no es de esta actividad')

  // Mismo respaldo legacy archivoURL/nombreArchivo que usa submissionFiles()
  // en el cliente (ActivityPage.jsx) — entregas viejas de un solo archivo.
  const archivos = Array.isArray(sub.archivos) && sub.archivos.length
    ? sub.archivos
    : (sub.archivoURL ? [{ url: sub.archivoURL, nombre: sub.nombreArchivo }] : [])

  const evidencias = await prepararEvidenciasEntrega(archivos)
  if (!evidencias.bloques.length) {
    throw new HttpsError('failed-precondition',
      'Esta entrega no tiene evidencias en un formato que la IA pueda leer todavía (JPG, PNG, PDF o Word). No se descontaron créditos.')
  }

  const nombreEstudiante = await nombrePilaDeEstudiante(db, sub.alumnoId)

  return {
    clase: 'entregable',
    nombre: String(act.nombre || act.titulo || '').trim().slice(0, 200),
    instrucciones: textoPlano(act.instrucciones).slice(0, 4000),
    rubrica,
    nombreEstudiante,
    evidenciasBloques: evidencias.bloques,
    evidenciasDetalle: evidencias.detalle,
    ignoradosPorFormato: evidencias.ignoradosPorFormato,
    ignoradosPorTope: evidencias.ignoradosPorTope,
  }
}

// Motor ÚNICO de evaluación — lo usan tanto la calificación de UNA entrega
// (ejecutarCalificarEntregableIA) como el lote de "Calificar todas con IA"
// (ejecutarCalificarEntregableIALote). Un solo prompt, un solo parseo, un
// solo esquema de salida — nada de tres rutas de código por tipo de
// evidencia ni por individual/lote.
async function evaluarEntregaConIA({ client, modelo, rubrica, nombre, instrucciones, nombreEstudiante, evidenciasBloques, evidenciasDetalle }) {
  const numCriterios = rubrica.criterios.length
  const promptTexto =
    'Asignatura: bachillerato mexicano.\n' +
    `ACTIVIDAD ENTREGABLE: "${nombre}".\n` +
    `Nombre del estudiante: "${nombreEstudiante || 'sin nombre registrado'}".\n\n` +
    `INSTRUCCIONES PARA EL ESTUDIANTE:\n"""${instrucciones}"""\n\n` +
    `${bloqueCriteriosInstrumento(rubrica)}\n\n` +
    `A continuación se adjuntan las evidencias que entregó el estudiante (${evidenciasDetalle.length} archivo(s)). ` +
    `Analízalas y propón, para CADA UNO de los ${numCriterios} criterios de arriba, el nivel que corresponde según lo que observes.\n\n` +
    'Responde SOLO con este JSON:\n' +
    '{\n' +
    '  "criterios": [\n' +
    '    {"n": 1, "nivel": <índice de nivel de la lista de arriba, o null si no hay evidencia suficiente>, ' +
    '"evidencia": "<qué observaste, máx 25 palabras — o por qué no alcanza la evidencia>", "sinEvidenciaSuficiente": <true|false>}\n' +
    '  ],\n' +
    '  "retroalimentacionGeneral": "<retroalimentación breve para el estudiante — ver REGLA ESTRICTA de VOZ y TONO>",\n' +
    '  "confianza": "alta" | "media" | "baja"\n' +
    '}'

  const content = [{ type: 'text', text: promptTexto }, ...evidenciasBloques]

  const inicio = Date.now()
  const msg = await client.messages.create({
    model: modelo,
    // Salida corta a propósito (regla del PO, 21-ago-2026): evidencias
    // concisas por criterio + una retroalimentación breve, nunca un ensayo.
    // Hasta MAX_CRITERIOS (6) criterios × ~40 tokens + retro ~120 cabe
    // holgado en 900; se deja margen sin regalar tokens de salida de más.
    max_tokens: 900,
    system: CALIFICAR_ENTREGABLE_SISTEMA,
    messages: [{ role: 'user', content }],
  })
  let texto = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
  if (texto.startsWith('```')) texto = texto.replace(/^```(json)?\n?/, '').replace(/```$/, '').trim()
  const datos = JSON.parse(texto)

  // EF valida/acota cada campo — la IA nunca es fuente de verdad de la
  // estructura, y "sin evidencia suficiente" siempre gana sobre un nivel
  // propuesto: si la IA lo marca, el nivel se descarta aunque haya venido.
  const porIndice = new Map((Array.isArray(datos.criterios) ? datos.criterios : []).map((c) => [Number(c?.n) - 1, c]))
  const maxNivel = rubrica.niveles.length - 1
  const criterios = rubrica.criterios.map((c, i) => {
    const d = porIndice.get(i) || {}
    const sinEvidencia = !Number.isInteger(d.nivel) || !!d.sinEvidenciaSuficiente
    const nivel = sinEvidencia ? null : Math.min(maxNivel, Math.max(0, d.nivel))
    return {
      n: i + 1,
      nivel,
      evidencia: String(d.evidencia || '').slice(0, 300),
      sinEvidenciaSuficiente: sinEvidencia,
    }
  })

  const CONFIANZA_VALIDAS = new Set(['alta', 'media', 'baja'])
  const confianza = CONFIANZA_VALIDAS.has(datos.confianza) ? datos.confianza : 'media'

  return {
    sugerencia: {
      criterios, // [{n, nivel, evidencia, sinEvidenciaSuficiente}] — mismo orden que rubrica.criterios
      retroalimentacionGeneral: String(datos.retroalimentacionGeneral || '').slice(0, 1000),
      confianza,
      evidenciasAnalizadas: evidenciasDetalle,
    },
    tokensEntrada: msg.usage?.input_tokens ?? null,
    tokensSalida: msg.usage?.output_tokens ?? null,
    ms: Date.now() - inicio,
  }
}

async function ejecutarCalificarEntregableIA({ params, modelo, apiKey }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const ctx = params.__contexto // lo puso el precheck; el cliente no puede tocarlo

  const { sugerencia, tokensEntrada, tokensSalida, ms } = await evaluarEntregaConIA({
    client, modelo, rubrica: ctx.rubrica, nombre: ctx.nombre, instrucciones: ctx.instrucciones,
    nombreEstudiante: ctx.nombreEstudiante,
    evidenciasBloques: ctx.evidenciasBloques, evidenciasDetalle: ctx.evidenciasDetalle,
  })

  const resultado = {
    ...sugerencia,
    ignoradosPorFormato: ctx.ignoradosPorFormato,
    ignoradosPorTope: ctx.ignoradosPorTope,
    calificacionPropuesta: totalInstrumento(ctx.rubrica, sugerencia.criterios.map((c) => c.nivel)),
  }

  // Persistir como 'pendiente' EN CUANTO se genera — mismo mecanismo y
  // misma colección que ya usa "Calificar todas con IA" (nunca un sistema
  // de almacenamiento aparte). 24-ago-2026, pedido explícito de Kike: la
  // propuesta no debe depender de que el docente guarde la calificación
  // definitiva para sobrevivir — si sale de la entrega sin aplicarla, debe
  // seguir disponible como "Ver propuesta de IA", sin volver a cobrar. Esto
  // NUNCA toca `submissions.calificacion` — la IA propone, el docente
  // dispone; aplicar sigue siendo un paso aparte y explícito.
  const actividadId = String(params?.actividadId || '')
  const submissionId = String(params?.submissionId || '')
  await getFirestore().doc(`activities/${actividadId}/iaSugerenciasEntregable/${submissionId}`).set({
    estado: 'pendiente',
    actividadId, sub: submissionId,
    sugerencia: resultado,
    // Huella de la rúbrica/lista de cotejo usada AHORA para generar esta
    // propuesta — es lo que permite decidir después si "Recalificar con IA"
    // debe aparecer (25-ago-2026): se compara contra la huella de la rúbrica
    // ACTUAL de la actividad, nunca contra el estado local del navegador.
    rubricaFirma: rubricaFirma(ctx.rubrica),
    creadoEn: FieldValue.serverTimestamp(),
    actualizadoEn: FieldValue.serverTimestamp(),
  })

  return {
    resultado,
    unidadesReales: 1, // tarifa fija por entrega evaluada — nunca por número de evidencias
    interno: { modelo, tokensEntrada, tokensSalida, ms, evidencias: ctx.evidenciasDetalle.length },
  }
}

// ── OP-11-BIS · "Calificar todas con IA" — lote de una actividad completa ──
// Mismo motor (evaluarEntregaConIA) que la operación individual de arriba;
// el lote solo agrega la orquestación: qué entregas entran, el candado por
// entrega para no cobrar dos veces, y la persistencia de cada propuesta para
// que sobreviva un cierre de pestaña — MISMO patrón que ya usa C-02
// (ejecutarCalificarAbierta/activities/{id}/iaSugerencias) para respuestas
// abiertas, aquí aplicado a activities/{id}/iaSugerenciasEntregable/{subId}
// (una sugerencia POR ENTREGA, no por pregunta — aquí no hay preguntas).
//
// Alcance decidido por Kike (21-ago-2026): solo entregas PENDIENTES (sin
// calificar) — nunca pisa una calificación que el docente ya puso a mano.
// Revisión: una por una, como la individual — el lote NO aplica ni guarda
// ninguna calificación, solo dEJA LISTAS las propuestas para que el docente
// las revise/edite/confirme al calificar a cada estudiante (regla O3).

const CALIFICAR_ENTREGABLE_LOTE_CONCURRENCIA = 4

async function precheckCalificarEntregableLote({ uid, params }) {
  const db = getFirestore()
  const actividadId = String(params?.actividadId || '')
  if (!actividadId) throw new HttpsError('invalid-argument', 'Falta la actividad a calificar')

  const actSnap = await db.doc(`activities/${actividadId}`).get()
  if (!actSnap.exists) throw new HttpsError('not-found', 'La actividad no existe')
  const act = actSnap.data()
  if (act.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta actividad no es tuya')
  if (PADRES_VALIDOS[act.categoria] !== 'entregable') {
    throw new HttpsError('failed-precondition', 'Solo un entregable con evidencia se puede calificar así.')
  }
  const rubrica = act.rubrica
  if (!rubrica?.criterios?.length) {
    throw new HttpsError('failed-precondition',
      'Esta actividad todavía no tiene rúbrica ni lista de cotejo guardada — créala primero. No se descontaron créditos.')
  }

  // Solo entregas PENDIENTES (sin calificar) — mismo criterio que la
  // pestaña "Pendientes" del docente, nunca pisa una calificación ya dada.
  // EXCEPCIÓN (23-ago-2026, pedido de Kike): "Recalificar todas con IA" se
  // dispara cuando el docente YA CAMBIÓ la rúbrica/lista de cotejo y quiere
  // propuestas nuevas con el instrumento actual — ahí sí interesan también
  // las que ya tienen calificación, porque esa calificación fue puesta con
  // el instrumento VIEJO. Solo genera PROPUESTAS nuevas; nunca toca
  // `submissions.calificacion` directamente (eso lo sigue aplicando el
  // docente a mano, igual que el lote normal).
  const recalificar = params?.recalificar === true
  const subsSnap = await db.collection('submissions').where('actividadId', '==', actividadId).get()
  let candidatas = recalificar ? subsSnap.docs : subsSnap.docs.filter((d) => d.data().calificacion == null)

  // Sin recalificar: excluir las que YA tienen una propuesta 'pendiente' —
  // mismo filtro que ya aplica el cliente al contar (contarEntregasIA en
  // ActivityPage.jsx) para no volver a cobrarlas ni recontarlas. Sin este
  // filtro aquí, el conteo del servidor podía salir MAYOR que la estimación
  // que ya vio y aceptó el docente (24-ago-2026, bug real reportado por
  // Kike: "Hay 3 entregas... pero la estimación fue de 2"). Recalificar SÍ
  // las quiere todas, por diseño — no se toca ese caso.
  if (!recalificar) {
    const pendSnap = await db.collection(`activities/${actividadId}/iaSugerenciasEntregable`)
      .where('estado', '==', 'pendiente').get()
    const yaConPropuesta = new Set(pendSnap.docs.map((d) => d.data().sub || d.id))
    candidatas = candidatas.filter((d) => !yaConPropuesta.has(d.id))
  }

  const items = []
  let sinEvidencia = 0
  for (const subDoc of candidatas) {
    const sub = subDoc.data()
    const archivos = Array.isArray(sub.archivos) && sub.archivos.length
      ? sub.archivos
      : (sub.archivoURL ? [{ url: sub.archivoURL, nombre: sub.nombreArchivo }] : [])
    const evidencias = await prepararEvidenciasEntrega(archivos)
    if (!evidencias.bloques.length) { sinEvidencia++; continue }
    const nombreEstudiante = await nombrePilaDeEstudiante(db, sub.alumnoId)
    items.push({ submissionId: subDoc.id, evidencias, nombreEstudiante })
  }

  if (!items.length) {
    throw new HttpsError('failed-precondition',
      'No hay entregas pendientes con evidencia en un formato legible (JPG, PNG, PDF o Word). No se descontaron créditos.')
  }

  return {
    clase: 'entregable',
    nombre: String(act.nombre || act.titulo || '').trim().slice(0, 200),
    instrucciones: textoPlano(act.instrucciones).slice(0, 4000),
    rubrica,
    items,
    sinEvidencia,
    recalificar,
  }
}

async function ejecutarCalificarEntregableIALote({ params, modelo, apiKey, unidades }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const db = getFirestore()
  const ctx = params.__contexto
  const actividadId = String(params?.actividadId || '')

  if (ctx.items.length > unidades) {
    throw new HttpsError('failed-precondition',
      `Hay ${ctx.items.length} entregas pendientes con evidencia pero la estimación fue de ${unidades}. Vuelve a intentarlo para re-estimar.`)
  }

  // ── Candado por entrega: adquirir el derecho a procesarla (mismo patrón
  // que C-02) — un create() atómico es el único que puede ganarlo; ya
  // 'pendiente'/'aplicada' → ya tiene sugerencia, se recupera gratis.
  // EXCEPCIÓN recalificar=true: la sugerencia existente quedó calculada con
  // la rúbrica/lista de cotejo VIEJA — hay que REGENERARLA, no saltarla como
  // "ya procesada" (eso dejaría al docente viendo una propuesta obsoleta).
  const adquiridos = []
  let yaProcesadas = 0
  for (const item of ctx.items) {
    const ref = db.doc(`activities/${actividadId}/iaSugerenciasEntregable/${item.submissionId}`)
    if (ctx.recalificar) {
      await ref.set({
        estado: 'procesando', actividadId, sub: item.submissionId,
        consumoKey: params.__idempotencyKey || null, creadoEn: FieldValue.serverTimestamp(),
      })
      adquiridos.push({ ...item, ref })
      continue
    }
    try {
      await ref.create({
        estado: 'procesando', actividadId, sub: item.submissionId,
        consumoKey: params.__idempotencyKey || null, creadoEn: FieldValue.serverTimestamp(),
      })
      adquiridos.push({ ...item, ref })
    } catch {
      const tomado = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref)
        if (!s.exists) return false
        const d = s.data()
        const edadMs = d.creadoEn?.toDate ? Date.now() - d.creadoEn.toDate().getTime() : 0
        if (d.estado === 'procesando' && edadMs > 10 * 60 * 1000) {
          tx.update(ref, { consumoKey: params.__idempotencyKey || null, creadoEn: FieldValue.serverTimestamp() })
          return true
        }
        return false
      })
      if (tomado) adquiridos.push({ ...item, ref })
      else yaProcesadas++
    }
  }

  if (!adquiridos.length) {
    throw new HttpsError('failed-precondition',
      'Estas entregas ya tienen propuesta de IA o se están procesando en este momento. No se descontaron créditos.')
  }

  let tokensEntrada = 0
  let tokensSalida = 0
  let fallidas = 0
  let generadas = 0
  let aplicadasAuto = 0

  let cursor = 0
  async function trabajador() {
    while (cursor < adquiridos.length) {
      const item = adquiridos[cursor++]
      try {
        const { sugerencia, tokensEntrada: te, tokensSalida: ts } = await evaluarEntregaConIA({
          client, modelo, rubrica: ctx.rubrica, nombre: ctx.nombre, instrucciones: ctx.instrucciones,
          nombreEstudiante: item.nombreEstudiante,
          evidenciasBloques: item.evidencias.bloques, evidenciasDetalle: item.evidencias.detalle,
        })
        tokensEntrada += te || 0
        tokensSalida += ts || 0
        // Recalificar todas con IA (23-ago-2026, pedido explícito de Kike:
        // "si se deben de cambiar las ya revisadas, por supuesto que sí") —
        // a diferencia del lote normal (solo propone), aquí la calificación
        // real SÍ se sobrescribe sola con la propuesta, sin que el docente
        // tenga que entrar entrega por entrega. Único freno: si algún
        // criterio quedó sin evidencia suficiente, totalInstrumento regresa
        // null y esa entrega se deja como propuesta pendiente en vez de
        // escribir una calificación inventada — la regla de "nunca inventar"
        // sigue ganando en ese caso puntual.
        // calificacionPropuesta se calcula y persiste SIEMPRE (no solo al
        // recalificar) — 23-ago-2026, pedido de Kike: "Ver evaluación de IA"
        // debe seguir mostrando la calificación que la IA propuso originalmente
        // aunque después el docente cambie la calificación a mano o incluso
        // cambie la rúbrica; sin este número fijo, reconstruirlo más tarde
        // recalculando contra la rúbrica ACTUAL daría un valor distinto.
        const niveles = sugerencia.criterios.map((c) => c.nivel)
        const total = totalInstrumento(ctx.rubrica, niveles)
        const sugerenciaCompleta = {
          ...sugerencia,
          ignoradosPorFormato: item.evidencias.ignoradosPorFormato,
          ignoradosPorTope: item.evidencias.ignoradosPorTope,
          calificacionPropuesta: total,
        }
        // Misma huella que el flujo individual (25-ago-2026) — con esto
        // "Recalificar con IA" desaparece justo después de completar, porque
        // ya no hay ninguna propuesta generada con una rúbrica distinta a la
        // actual.
        const firmaGeneracion = rubricaFirma(ctx.rubrica)
        if (ctx.recalificar && total != null) {
          await db.doc(`submissions/${item.submissionId}`).update({
            calificacion: total,
            comentario: sugerencia.retroalimentacionGeneral || '',
            rubricaEval: niveles.some((v) => v != null) ? niveles : null,
            estado: 'calificado',
          })
          await item.ref.set({
            estado: 'aplicada',
            aplicadaAutomaticamente: true,
            sugerencia: sugerenciaCompleta,
            rubricaFirma: firmaGeneracion,
            actualizadoEn: FieldValue.serverTimestamp(),
          }, { merge: true })
          aplicadasAuto++
        } else {
          // Persistir ANTES de contar como cobrable — si esta escritura
          // falla, la entrega cae al catch (candado liberado, sin cobro).
          await item.ref.set({
            estado: 'pendiente',
            sugerencia: sugerenciaCompleta,
            rubricaFirma: firmaGeneracion,
            actualizadoEn: FieldValue.serverTimestamp(),
          }, { merge: true })
        }
        generadas++
      } catch (e) {
        fallidas++
        logger.warn(`OP-11-lote: entrega ${item.submissionId} falló: ${String(e.message || e).slice(0, 200)}`)
        await item.ref.delete().catch((err) => logger.error('OP-11-lote: liberar candado falló:', err))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CALIFICAR_ENTREGABLE_LOTE_CONCURRENCIA, adquiridos.length) }, trabajador))

  if (!generadas) {
    throw new HttpsError('unavailable', 'El asistente de IA no pudo calificar ninguna entrega. No se descontaron créditos.')
  }

  return {
    resultado: { generadas, fallidas, yaProcesadas, sinEvidencia: ctx.sinEvidencia, aplicadasAuto },
    unidadesReales: generadas, // 1 crédito por entrega REALMENTE evaluada
    interno: { modelo, tokensEntrada, tokensSalida, entregas: generadas, fallidas, yaProcesadas, aplicadasAuto },
  }
}

// ── OP-09 · Reactivos de un cuestionario o examen ───────────────────────────
// REGLA (PO, 10-ago-2026, ficha aprobada): los reactivos se derivan de lo que
// el docente escribe en "¿Qué quieres evaluar?" — es la fuente inmediata del
// contenido. La actividad padre (el cuestionario o examen ya guardado) solo
// aporta contexto (nombre, si es examen o cuestionario). El Universo
// Curricular, la Planeación Didáctica, las fuentes del curso, el contexto del
// docente y el diagnóstico del grupo NO participan todavía — llegan en una
// fase posterior de los planes de pago.
//
// Evalúa Fácil fija la CANTIDAD exacta y el TIPO exacto de cada reactivo (el
// reparto de "Mixto" lo decide el código, nunca la IA — ver `tiposParaLote`);
// la IA solo redacta el contenido pedagógico de cada uno, en el orden pedido.

const REACTIVOS_PADRES_VALIDOS = { cuestionario: 'cuestionario', examen: 'examen' }
const MIN_QUIERE_EVALUAR = 40
const MAX_QUIERE_EVALUAR = 4000
const MIN_REACTIVOS = 2
const MAX_REACTIVOS = 10
const TIPOS_REACTIVO = ['opcion_multiple', 'verdadero_falso', 'respuesta_corta', 'subir_archivo']

// 'Mixto' reparte los tipos EN CÓDIGO, round-robin sobre los 4 disponibles —
// la IA nunca decide la estructura, ni siquiera cuando el docente pide mezcla.
function tiposParaLote(tipoSolicitado, cantidad) {
  if (TIPOS_REACTIVO.includes(tipoSolicitado)) return Array.from({ length: cantidad }, () => tipoSolicitado)
  return Array.from({ length: cantidad }, (_, i) => TIPOS_REACTIVO[i % TIPOS_REACTIVO.length])
}

// Precheck: todo lo que puede rechazar la operación SIN gastar un crédito.
async function precheckReactivos({ uid, params }) {
  const db = getFirestore()
  const actividadId = String(params?.actividadId || '')
  if (!actividadId) {
    throw new HttpsError('invalid-argument',
      'Guarda primero el cuestionario o examen: los reactivos se generan a partir de él.')
  }

  const snap = await db.doc(`activities/${actividadId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'La actividad no existe')
  const act = snap.data()
  if (act.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta actividad no es tuya')

  const clase = REACTIVOS_PADRES_VALIDOS[act.categoria] || null
  if (!clase) {
    throw new HttpsError('failed-precondition',
      'Solo un cuestionario o un examen pueden generar reactivos con IA.')
  }

  // La fuente del contenido es lo que escribió el docente AQUÍ, no algo que
  // el precheck tenga que ir a leer — pero si no alcanza, se detiene igual
  // que la regla de contexto insuficiente de rúbrica/cotejo: ni reserva ni
  // llamada al modelo.
  const quiereEvaluar = String(params?.quiereEvaluar || '').trim().slice(0, MAX_QUIERE_EVALUAR)
  if (quiereEvaluar.length < MIN_QUIERE_EVALUAR) {
    throw new HttpsError('failed-precondition',
      `Describe con más detalle qué quieres evaluar (mínimo ${MIN_QUIERE_EVALUAR} caracteres) para que la IA pueda generar reactivos fundamentados. No se descontaron créditos.`,
      { codigo: 'CONTEXTO_INSUFICIENTE' })
  }

  const cantidad = clampInt(params?.cantidad, 5, MIN_REACTIVOS, MAX_REACTIVOS)
  const tipoSolicitado = TIPOS_REACTIVO.includes(params?.tipoSolicitado) ? params.tipoSolicitado : 'mixto'

  // Fuentes permanentes de la asignatura (generales + las del parcial de esta
  // actividad, nunca las de otro parcial) + hasta 3 PDF/Word que el docente
  // adjuntó a mano aquí — mismo mecanismo que crear_evaluacion_ia: fuente
  // ADICIONAL, "qué quiere evaluar" sigue siendo la fuente principal (ver
  // REACTIVOS_SISTEMA/promptReactivos más abajo).
  const bloqueFuentes = await bloqueFuentesOperacion(db, {
    asignaturaId: act.asignaturaId, parcial: act.parcial, fuentesManual: params?.fuentes,
  })

  return {
    clase,
    nombre: String(act.nombre || act.titulo || '').trim().slice(0, 200),
    tema: String(params?.tema || '').trim().slice(0, 120),
    quiereEvaluar,
    cantidad,
    tipoSolicitado,
    tipos: tiposParaLote(tipoSolicitado, cantidad),
    bloqueFuentes,
  }
}

// El texto base NO menciona fuentes (caso normal, sin adjuntos): se mantiene
// EXACTAMENTE igual que antes de las fuentes opcionales para no cambiar el
// comportamiento de nadie que no las use. Cuando SÍ hay `ctx.bloqueFuentes`,
// promptReactivos agrega el bloque de documentos y este sistema se completa
// con una frase que autoriza usarlos como fuente adicional.
const REACTIVOS_SISTEMA_BASE =
  'Eres el asistente pedagógico de Evalúa Fácil y trabajas dentro de la asignatura de un ' +
  'docente de bachillerato mexicano. Tu papel es PROPONER: el docente siempre revisa, edita y decide. ' +
  'Construye los reactivos EXCLUSIVAMENTE a partir de lo que el docente describe en "qué quiere ' +
  'evaluar"{fuentesClausula} — no agregues conceptos, temas ni aprendizajes que no haya mencionado{fuentesClausula2}, y no completes ' +
  'con conocimiento general más allá de lo que pidió. La cantidad y el tipo de cada reactivo los fija ' +
  'Evalúa Fácil: genera EXACTAMENTE los reactivos pedidos, uno por cada tipo indicado y en ese orden. ' +
  'Escribe en español, claro y breve. Responde únicamente con el JSON válido del esquema indicado, ' +
  'sin texto adicional.'

const REACTIVOS_SISTEMA = REACTIVOS_SISTEMA_BASE
  .replace('{fuentesClausula}', '')
  .replace('{fuentesClausula2}', '')

function reactivosSistemaConFuentes() {
  return REACTIVOS_SISTEMA_BASE
    .replace('{fuentesClausula}', ' y, si se te dan, de los documentos de referencia que adjuntó')
    .replace('{fuentesClausula2}', ' ni estén en esos documentos')
}

const ETIQUETA_TIPO_REACTIVO = {
  opcion_multiple: 'opción múltiple',
  verdadero_falso: 'verdadero/falso',
  respuesta_corta: 'respuesta corta',
  subir_archivo: 'subir archivo (el alumno entrega un documento; sin respuesta correcta)',
}

function promptReactivos(ctx, asignatura) {
  const listaTipos = ctx.tipos.map((t, i) => `${i + 1}. ${ETIQUETA_TIPO_REACTIVO[t] || t}`).join('\n')
  return (
    `Asignatura: ${asignatura || 'la asignatura del docente'} (bachillerato).\n` +
    `${ctx.clase === 'examen' ? 'EXAMEN' : 'CUESTIONARIO'}: "${ctx.nombre}".\n` +
    (ctx.tema ? `Tema: ${ctx.tema}\n` : '') +
    `\nQUÉ QUIERE EVALUAR EL DOCENTE (${ctx.bloqueFuentes ? 'fuente principal' : 'única fuente'} del contenido):\n"""${ctx.quiereEvaluar}"""\n` +
    (ctx.bloqueFuentes ? `\n${ctx.bloqueFuentes}\n` : '\n') +
    `Genera EXACTAMENTE ${ctx.cantidad} reactivos, uno por cada tipo, EN ESTE ORDEN:\n${listaTipos}\n\n` +
    'Reglas por tipo:\n' +
    '- opcion_multiple: enunciado + 4 opciones + el índice (0-3) de la opción correcta.\n' +
    '- verdadero_falso: un enunciado afirmativo evaluable + "v" o "f".\n' +
    '- respuesta_corta: enunciado + una respuesta esperada breve o criterio de respuesta correcta ' +
    '(es una guía para que el docente califique a mano; el alumno nunca la ve).\n' +
    '- subir_archivo: enunciado con la instrucción de qué debe subir el alumno (sin respuesta).\n\n' +
    'Responde SOLO con este JSON:\n' +
    '{\n  "reactivos": [\n' +
    '    {"tipo": "<tipo exacto de la lista>", "enunciado": "<máx 400 caracteres>", ' +
    '"opciones": ["<solo si opcion_multiple>", "..."], "correcta": "<índice 0-3 si opcion_multiple, ' +
    '\'v\'/\'f\' si verdadero_falso>", "respuestaEsperada": "<solo si respuesta_corta, máx 200 caracteres>"}\n' +
    '  ]\n}'
  )
}

// La IA propone SOLO contenido; el tipo y el orden de cada reactivo los fija
// `ctx.tipos` (calculado en el precheck) — se fuerza aquí índice por índice,
// sin confiar en lo que el modelo devuelva como campo "tipo".
function normalizarReactivos(datos, ctx) {
  const crudos = Array.isArray(datos?.reactivos) ? datos.reactivos : []
  return ctx.tipos.map((tipo, i) => {
    const r = crudos[i] || {}
    const enunciado = String(r.enunciado || '').trim().slice(0, 500)
    if (tipo === 'opcion_multiple') {
      const opciones = (Array.isArray(r.opciones) ? r.opciones : []).slice(0, 4).map((o) => String(o || '').trim().slice(0, 300))
      while (opciones.length < 4) opciones.push('')
      const idx = Number.isInteger(r.correcta) ? r.correcta : parseInt(r.correcta, 10)
      return { tipo, enunciado, opciones, correcta: Number.isInteger(idx) ? Math.min(3, Math.max(0, idx)) : 0 }
    }
    if (tipo === 'verdadero_falso') {
      return { tipo, enunciado, correcta: r.correcta === 'f' ? 'f' : 'v' }
    }
    if (tipo === 'respuesta_corta') {
      return { tipo, enunciado, respuestaEsperada: String(r.respuestaEsperada || '').trim().slice(0, 300) }
    }
    return { tipo, enunciado } // subir_archivo: sin respuesta
  })
}

async function ejecutarReactivos({ params, modelo, apiKey }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const ctx = params.__contexto // lo puso el precheck; el cliente no puede tocarlo
  const asignatura = String(params?.asignaturaNombre || '').slice(0, 120)

  const { datos, interno } = await pedirJSON({
    client, modelo, maxTokens: 2200, system: ctx.bloqueFuentes ? reactivosSistemaConFuentes() : REACTIVOS_SISTEMA,
    prompt: promptReactivos(ctx, asignatura),
  })

  // Tarifa comercial (decisión PO, 23-ago-2026): 0.5 crédito por reactivo
  // REALMENTE generado — mismo criterio que crear_evaluacion_ia, ya no es
  // una tarifa fija por llamada. Se descarta lo no aprovechable (regla de
  // no invención, T.7) ANTES de contar, para no cobrar por reactivos vacíos.
  const reactivos = normalizarReactivos(datos, ctx).filter((r) => r.enunciado)
  if (!reactivos.length) {
    throw new Error('El asistente de IA no generó reactivos utilizables')
  }

  return {
    resultado: { reactivos, clase: ctx.clase },
    unidadesReales: reactivos.length,
    interno,
  }
}

// ── OP-10 · Análisis de resultados de un cuestionario o examen ──────────────
// REGLA (PO, 11-ago-2026, ficha aprobada): la IA analiza SOLO los resultados
// reales ya aplicados de un cuestionario/examen — nunca Universo Curricular,
// Planeación, fuentes del curso, contexto del docente ni diagnóstico del
// grupo (fase posterior). Evalúa Fácil hace TODA la aritmética (porcentajes,
// ranking de reactivos, quién entra a "requiere atención") ANTES de llamar al
// modelo; la IA solo redacta la interpretación y las recomendaciones sobre
// esos números — nunca los inventa ni los recalcula. Los estudiantes viajan
// anonimizados ("Alumno N"): el modelo no ve nombres ni ningún otro dato que
// no sea imprescindible para el análisis.

const ANALISIS_PADRES_VALIDOS = { cuestionario: 'cuestionario', examen: 'examen' }
const MIN_ENTREGAS_ANALISIS = 3
const TIPOS_OBJETIVOS_ANALISIS = ['opcion_multiple', 'verdadero_falso']

// Agrega, en código, los resultados reales de una evaluación ya aplicada.
// Función PURA (sin Firestore) para poder probarla sin emulador — el precheck
// solo lee documentos y le pasa el resultado a esta función.
//
// `preguntas` = [{id, tipo, enunciado, opciones}]
// `entregas`  = [{ alumnoId, calificacion, respuestas, respuestasConfiables }]
//   `respuestas` = {preguntaId: {opcionSeleccionada, correcta, puntosObtenidos}}
//   `respuestasConfiables` (bool) — la decide el llamador (ejecutarAnalisisResultados)
//   con respuestasVivasSonDelIntentoGanador/intentosRespuestas (calificacionIntentos.js).
//   Aquí NUNCA se reinterpreta ni se recalcula esa bandera — solo se respeta.
//
// Regla central de esta corrección: la calificación de CADA entrega ya es un
// dato válido (Evalúa Fácil la calculó) y siempre entra al resumen general.
// Pero el detalle por reactivo (aciertos, distribución de errores,
// candidatos a atención) solo puede construirse con `respuestas` que
// demostrablemente correspondan al intento que produjo esa calificación — así
// que las entregas con `respuestasConfiables: false` quedan FUERA del detalle
// por reactivo, nunca silenciosamente: se cuentan en `confiabilidad`.
function agregarResultados({ nombre, categoria, preguntas, entregas }) {
  const totalEstudiantes = entregas.length
  const entregasConfiables = entregas.filter((e) => e.respuestasConfiables !== false)
  const entregasExcluidas = totalEstudiantes - entregasConfiables.length

  // Por reactivo: % de acierto y los distractores más elegidos — SOLO para
  // tipos objetivos (calificación automática) y SOLO con entregas confiables.
  // Las de revisión manual (respuesta_corta/subir_archivo) no aportan %
  // confiable ni distribución: ni su contenido de texto se lee aquí ni se
  // manda nunca al modelo.
  const reactivos = preguntas.map((p, i) => {
    const esObjetivo = TIPOS_OBJETIVOS_ANALISIS.includes(p.tipo)
    const respuestas = entregasConfiables.map((e) => e.respuestas?.[p.id]).filter(Boolean)
    const calificadas = respuestas.filter((r) => r.correcta != null)
    const aciertos = calificadas.filter((r) => r.correcta === true).length
    const pctAciertos = esObjetivo && calificadas.length ? Math.round((aciertos / calificadas.length) * 100) : null

    let distribucionErrores = []
    if (esObjetivo && p.opciones?.length) {
      const falladas = calificadas.filter((r) => r.correcta === false)
      const conteoOpcion = {}
      falladas.forEach((r) => {
        if (r.opcionSeleccionada != null) conteoOpcion[r.opcionSeleccionada] = (conteoOpcion[r.opcionSeleccionada] || 0) + 1
      })
      distribucionErrores = Object.entries(conteoOpcion)
        .map(([optId, n]) => ({
          texto: String(p.opciones.find((o) => o.id === optId)?.texto || 'Otra').slice(0, 200),
          pct: falladas.length ? Math.round((n / falladas.length) * 100) : 0,
        }))
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3)
    }

    return {
      numero: i + 1,
      id: p.id,
      enunciado: String(p.enunciado || '').trim().slice(0, 300),
      tipo: p.tipo,
      calificable: esObjetivo,
      calificadas: calificadas.length,
      pendientes: respuestas.length - calificadas.length,
      pctAciertos,
      distribucionErrores,
    }
  })

  const objetivosCalificados = reactivos.filter((r) => r.calificable && r.pctAciertos != null)
  const porcentajeAciertosGeneral = objetivosCalificados.length
    ? Math.round(objetivosCalificados.reduce((s, r) => s + r.pctAciertos, 0) / objetivosCalificados.length)
    : null

  const ranking = [...objetivosCalificados].sort((a, b) => a.pctAciertos - b.pctAciertos)
  const reactivosDificiles = ranking.slice(0, 3)
  const reactivosFuertes = ranking.slice(-3).reverse().filter((r) => !reactivosDificiles.includes(r))

  // Estudiantes anonimizados — orden de llegada de las entregas (TODAS,
  // confiables o no: la numeración de anonId no depende de esta corrección),
  // sin relación con ninguna lista real. El cliente traduce anonId → nombre
  // con `mapaAlumnos`, que el modelo NUNCA recibe (se arma después de llamarlo).
  const objetivas = preguntas.filter((p) => TIPOS_OBJETIVOS_ANALISIS.includes(p.tipo))
  const estudiantes = entregas.map((e, i) => {
    const anonId = `Alumno ${i + 1}`
    const confiable = e.respuestasConfiables !== false
    const fallados = confiable ? objetivas.filter((p) => e.respuestas?.[p.id]?.correcta === false).length : null
    return { anonId, alumnoId: e.alumnoId, calificacion: e.calificacion ?? null, respuestasConfiables: confiable, fallados, totalObjetivas: objetivas.length }
  })

  // Candidatos a "requiere atención": desempeño objetivamente bajo (<60% de
  // aciertos en reactivos objetivos) según datos REALES — un umbral de
  // código, nunca una elección de la IA. Es la única lista de estudiantes que
  // el modelo puede mencionar (ver `normalizarAnalisis`). Sin respuestas
  // confiables no hay señal que evaluar: la IA jamás recibe ni infiere una.
  const candidatosAtencion = estudiantes
    .filter((e) => e.respuestasConfiables && e.totalObjetivas > 0 && (e.totalObjetivas - e.fallados) / e.totalObjetivas < 0.6)
    .map((e) => ({ anonId: e.anonId, calificacion: e.calificacion, reactivosFallados: e.fallados, totalObjetivas: e.totalObjetivas }))

  return {
    nombre, categoria, totalEstudiantes, totalReactivos: preguntas.length,
    porcentajeAciertosGeneral, reactivos, reactivosDificiles, reactivosFuertes,
    candidatosAtencion,
    mapaAlumnos: estudiantes.map((e) => ({ anonId: e.anonId, alumnoId: e.alumnoId })),
    // Transparencia obligatoria (nunca exclusión silenciosa): cuántas
    // entregas se usaron para el resumen general vs. cuántas, de esas,
    // tienen respuestas demostrablemente del intento que ganó la
    // calificación final — y cuántas quedaron fuera del detalle por reactivo.
    confiabilidad: {
      totalEntregas: totalEstudiantes,
      confiablesParaReactivo: entregasConfiables.length,
      excluidas: entregasExcluidas,
      motivoExclusion: entregasExcluidas > 0 ? 'intento_no_coincide_con_calificacion_final' : null,
    },
  }
}

// Agrega, en código, las respuestas de una ENCUESTA (evaluacion.ponderar
// Reactivos === false — sin "correcta", ver diagnóstico de contexto, Tanda 2
// 12-ago-2026) — mismo principio que agregarResultados: la IA nunca ve una
// respuesta individual sin que ESTA función la haya agregado antes, ya sea
// como distribución (opcion_multiple) o como lista TRUNCADA de textos
// (respuesta_corta) sin ningún alumnoId/anonId adjunto — no hay
// "candidatos a atención" en una encuesta, el resultado es siempre grupal.
// Función PURA (sin Firestore) para poder probarla sin emulador.
function agregarResultadosEncuesta({ nombre, preguntas, entregas }) {
  const totalEstudiantes = entregas.length
  const entregasConfiables = entregas.filter((e) => e.respuestasConfiables !== false)
  const entregasExcluidas = totalEstudiantes - entregasConfiables.length

  const preguntasAgregadas = preguntas.map((p, i) => {
    const respuestas = entregasConfiables.map((e) => e.respuestas?.[p.id]).filter(Boolean)
    if (p.tipo === 'opcion_multiple') {
      const conteo = {}
      respuestas.forEach((r) => {
        if (r.opcionSeleccionada != null) conteo[r.opcionSeleccionada] = (conteo[r.opcionSeleccionada] || 0) + 1
      })
      const distribucion = Object.entries(conteo)
        .map(([optId, n]) => ({
          texto: String(p.opciones?.find((o) => o.id === optId)?.texto || 'Otra').slice(0, 200),
          n, pct: respuestas.length ? Math.round((n / respuestas.length) * 100) : 0,
        }))
        .sort((a, b) => b.n - a.n)
      return {
        numero: i + 1, id: p.id, tipo: p.tipo,
        enunciado: String(p.enunciado || '').trim().slice(0, 300),
        totalRespuestas: respuestas.length, distribucion,
      }
    }
    // respuesta_corta: solo el TEXTO va a la IA, nunca a qué alumno
    // pertenece — tope razonable para no disparar el prompt con grupos grandes.
    const textos = respuestas
      .map((r) => String(r.textoRespuesta || '').trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 60)
    return {
      numero: i + 1, id: p.id, tipo: p.tipo,
      enunciado: String(p.enunciado || '').trim().slice(0, 300),
      totalRespuestas: respuestas.length, textos,
    }
  })

  return {
    nombre, totalEstudiantes, totalPreguntas: preguntas.length,
    preguntas: preguntasAgregadas,
    confiabilidad: {
      totalEntregas: totalEstudiantes,
      confiablesParaDetalle: entregasConfiables.length,
      excluidas: entregasExcluidas,
      motivoExclusion: entregasExcluidas > 0 ? 'intento_no_coincide_con_calificacion_final' : null,
    },
  }
}

// Precheck: todo lo que puede rechazar la operación SIN gastar un crédito.
async function precheckAnalisisResultados({ uid, params }) {
  const db = getFirestore()
  const actividadId = String(params?.actividadId || '')
  if (!actividadId) {
    throw new HttpsError('invalid-argument',
      'Guarda primero el cuestionario o examen: el análisis se genera a partir de sus resultados.')
  }

  const snap = await db.doc(`activities/${actividadId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'La actividad no existe')
  const act = snap.data()
  if (act.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta actividad no es tuya')

  const clase = ANALISIS_PADRES_VALIDOS[act.categoria] || null
  if (!clase) {
    throw new HttpsError('failed-precondition', 'Solo un cuestionario o un examen tienen resultados que analizar.')
  }

  const [pregSnap, subsSnap] = await Promise.all([
    db.collection(`activities/${actividadId}/preguntas`).get(),
    db.collection('submissions').where('actividadId', '==', actividadId).get(),
  ])
  const preguntas = pregSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  if (!preguntas.length) {
    throw new HttpsError('failed-precondition', 'Esta evaluación todavía no tiene reactivos.')
  }

  const entregasDocs = subsSnap.docs.filter((d) => d.data().estadoEvaluacion === 'finalizado')
  if (entregasDocs.length < MIN_ENTREGAS_ANALISIS) {
    throw new HttpsError('failed-precondition',
      `Se necesitan al menos ${MIN_ENTREGAS_ANALISIS} entregas finalizadas para un análisis significativo (hay ${entregasDocs.length}). No se descontaron créditos.`,
      { codigo: 'CONTEXTO_INSUFICIENTE' })
  }

  // Capa 2 primero, Capa 1 como respaldo — nunca al revés, y nunca inventar:
  //
  //  1. `resolverIntentoGanador` (fuente única de verdad, calificacionIntentos.js)
  //     dice CUÁL número de intento determina la calificación final. Si no es
  //     `representable` (p.ej. "promedio" con varios intentos, o empate real
  //     en "mejor"), no hay ningún intento que represente la calificación —
  //     la entrega queda fuera del detalle por reactivo, punto.
  //  2. Si es representable, se busca `intentosRespuestas/{numeroGanador}`
  //     (Capa 2). Si existe, ES la fotografía exacta de ese intento —
  //     confiable siempre, sin importar si el ganador es o no el último.
  //  3. Si no existe snapshot (evaluación de antes de esta corrección), cae a
  //     Capa 1: las respuestas VIVAS de `respuestas` (siempre del intento más
  //     reciente) solo sirven si ese intento reciente ES el ganador.
  //  4. Nunca se usan respuestas de un intento que no sea el ganador solo
  //     porque son las únicas disponibles.
  const conservar = act.evaluacion?.conservar
  const entregas = await Promise.all(entregasDocs.map(async (d) => {
    const s = d.data()
    const ganador = resolverIntentoGanador(s.intentos, conservar)
    let respuestas = {}
    let respuestasConfiables = false

    if (ganador.representable && ganador.numeroIntentoGanador != null) {
      const snapDoc = await db.doc(`submissions/${d.id}/intentosRespuestas/${ganador.numeroIntentoGanador}`).get()
      if (snapDoc.exists) {
        respuestas = snapDoc.data().respuestas || {}
        respuestasConfiables = true
      } else {
        const respSnap = await db.collection(`submissions/${d.id}/respuestas`).get()
        respSnap.docs.forEach((r) => { respuestas[r.id] = r.data() })
        respuestasConfiables = respuestasVivasSonDelIntentoGanador(s.intentos, conservar)
      }
    }

    return { alumnoId: s.alumnoId, calificacion: s.calificacion ?? null, respuestas, respuestasConfiables }
  }))

  // Encuesta (diagnóstico de contexto, Tanda 2 12-ago-2026) vs. evaluación
  // calificable (todo lo demás, incluyendo el diagnóstico de conocimientos):
  // se decide por `ponderarReactivos`, el MISMO flag que ya usa
  // SinCalificacionConfig.jsx — no uno nuevo. Sin cambio de comportamiento
  // para ninguna evaluación existente (ponderarReactivos !== false de
  // sobra, incluyendo cuando el campo no existe).
  const modoEncuesta = act.evaluacion?.ponderarReactivos === false
  const nombre = String(act.nombre || act.titulo || '').trim().slice(0, 200)
  const agregado = modoEncuesta
    ? agregarResultadosEncuesta({ nombre, preguntas, entregas })
    : agregarResultados({ nombre, categoria: clase, preguntas, entregas })

  return { ...agregado, modoEncuesta, asignaturaNombre: String(params?.asignaturaNombre || '').trim().slice(0, 120) }
}

const ANALISIS_SISTEMA =
  'Eres el asistente pedagógico de Evalúa Fácil y trabajas dentro de la asignatura de un docente de bachillerato ' +
  'mexicano. Analizas EXCLUSIVAMENTE la agregación de resultados reales que se te entrega — no inventes ' +
  'porcentajes, estudiantes, errores, dificultades ni causas que no estén en esos datos. Si los datos no alcanzan ' +
  'para una conclusión, dilo explícitamente en vez de inferir. Distingue siempre tres capas: dato observado (viene ' +
  'de la agregación, tú no lo calculas), interpretación (tu lectura pedagógica de ese dato) y recomendación (una ' +
  'acción concreta) — nunca presentes una interpretación como si fuera un dato. Sobre "estudiantes que podrían ' +
  'requerir atención": SOLO puedes mencionar los anonId de la lista de candidatos que se te da, nunca uno fuera de ' +
  'esa lista, y siempre como señal a revisar, jamás como diagnóstico. Escribe en español, claro y breve. Responde ' +
  'únicamente con el JSON del esquema indicado, sin texto adicional.'

function promptAnalisis(ctx) {
  const reactivosTxt = ctx.reactivos.map((r) =>
    `${r.numero}. [${r.tipo}] "${r.enunciado}" — ` +
    (r.calificable
      ? `${r.pctAciertos}% de acierto (${r.calificadas} calificadas${r.pendientes ? `, ${r.pendientes} pendientes` : ''})` +
        (r.distribucionErrores.length
          ? `. Errores más comunes: ${r.distribucionErrores.map((e) => `"${e.texto}" (${e.pct}%)`).join(', ')}`
          : '')
      : `de revisión manual (${r.calificadas} calificadas, ${r.pendientes} pendientes) — sin % automático confiable`)
  ).join('\n')

  const candidatosTxt = ctx.candidatosAtencion.length
    ? ctx.candidatosAtencion.map((c) => `${c.anonId}: calificación ${c.calificacion ?? 's/d'}, falló ${c.reactivosFallados} de ${c.totalObjetivas} reactivos objetivos`).join('\n')
    : '(ningún estudiante con desempeño objetivamente bajo en esta agregación — no propongas ninguno)'

  return (
    `${ctx.categoria === 'examen' ? 'EXAMEN' : 'CUESTIONARIO'}: "${ctx.nombre}".\n` +
    `${ctx.totalEstudiantes} estudiantes con entrega finalizada. ${ctx.totalReactivos} reactivos.\n` +
    (ctx.porcentajeAciertosGeneral != null
      ? `% de aciertos general (reactivos objetivos): ${ctx.porcentajeAciertosGeneral}%.\n`
      : 'No hay reactivos objetivos calificados para un % general.\n') +
    `\nREACTIVOS:\n${reactivosTxt}\n\n` +
    `CANDIDATOS A "requiere atención" (ya filtrados por Evalúa Fácil por bajo desempeño objetivo — SOLO puedes hablar de estos):\n${candidatosTxt}\n\n` +
    'Responde SOLO con este JSON:\n' +
    '{\n' +
    '  "resumenGeneral": "<3-5 frases, apoyado SOLO en los datos de arriba>",\n' +
    '  "patrones": [{"observacion": "<qué se observa, máx 20 palabras>", "interpretacion": "<posible explicación pedagógica, máx 30 palabras>"}],\n' +
    '  "estudiantesAtencion": [{"anonId": "<debe ser EXACTAMENTE uno de los candidatos de arriba>", "senal": "<por qué, como señal, no diagnóstico>"}],\n' +
    '  "recomendaciones": ["<recomendación concreta de intervención o refuerzo>"],\n' +
    '  "resumenEjecutivo": "<2-3 frases>"\n' +
    '}'
  )
}

// La IA propone SOLO texto (resúmenes, patrones, recomendaciones); TODOS los
// números (porcentaje general, ranking de reactivos) los pone `ctx`, ya
// calculado por `agregarResultados` — nunca lo que devuelva el modelo. Y
// `estudiantesAtencion` se filtra estrictamente contra `candidatosAtencion`:
// un anonId que la IA se inventara fuera de esa lista se descarta aquí.
function normalizarAnalisis(datos, ctx) {
  const anonValidos = new Set(ctx.candidatosAtencion.map((c) => c.anonId))
  const estudiantesAtencion = (Array.isArray(datos?.estudiantesAtencion) ? datos.estudiantesAtencion : [])
    .filter((e) => anonValidos.has(e?.anonId))
    .slice(0, 10)
    .map((e) => ({ anonId: e.anonId, senal: String(e.senal || '').trim().slice(0, 300) }))

  return {
    resumenGeneral: String(datos?.resumenGeneral || '').trim().slice(0, 1500),
    porcentajeAciertosGeneral: ctx.porcentajeAciertosGeneral,
    reactivosDificiles: ctx.reactivosDificiles.map((r) => ({ numero: r.numero, enunciado: r.enunciado, pctAciertos: r.pctAciertos })),
    reactivosFuertes: ctx.reactivosFuertes.map((r) => ({ numero: r.numero, enunciado: r.enunciado, pctAciertos: r.pctAciertos })),
    patrones: (Array.isArray(datos?.patrones) ? datos.patrones : []).slice(0, 6).map((p) => ({
      observacion: String(p?.observacion || '').trim().slice(0, 200),
      interpretacion: String(p?.interpretacion || '').trim().slice(0, 300),
    })),
    estudiantesAtencion,
    recomendaciones: (Array.isArray(datos?.recomendaciones) ? datos.recomendaciones : []).slice(0, 8).map((r) => String(r || '').trim().slice(0, 300)),
    resumenEjecutivo: String(datos?.resumenEjecutivo || '').trim().slice(0, 500),
    mapaAlumnos: ctx.mapaAlumnos, // el cliente traduce anonId → nombre real; la IA nunca lo vio
    totalEstudiantes: ctx.totalEstudiantes,
    totalReactivos: ctx.totalReactivos,
    // Transparencia de Capa 1 — la IA nunca vio ni decidió esto, viene tal
    // cual de agregarResultados. Ver AnalisisResultadosIA.jsx/PDF.
    confiabilidad: ctx.confiabilidad,
  }
}

// Encuesta (diagnóstico de contexto, Tanda 2 12-ago-2026) — regla de
// evidencia de Kike, explícita y crítica: la IA NUNCA presenta como hecho
// algo que las respuestas no sustenten; distingue SIEMPRE dato/patrón/
// interpretación/recomendación; nunca convierte una respuesta individual en
// característica del grupo; jamás infiere causas ni datos sensibles.
const ENCUESTA_CONTEXTO_SISTEMA =
  'Eres el asistente pedagógico de Evalúa Fácil y trabajas dentro de la asignatura de un docente de ' +
  'bachillerato mexicano. Vas a construir el DIAGNÓSTICO DE CONTEXTO a partir de las respuestas REALES ' +
  'que dieron los estudiantes a un cuestionario — nunca a partir del perfil del docente ni de fuentes, ' +
  'esas ya cumplieron su papel al diseñar las preguntas. No inventes respuestas ni patrones que los ' +
  'datos no sustenten. Busca SIEMPRE patrones COLECTIVOS: una sola respuesta individual (o unas pocas) ' +
  'NUNCA es una característica de todo el grupo — dilo explícitamente cuando el número de respuestas ' +
  'sea pequeño, y evita cualquier generalización que los datos no sostengan. Distingue en TODO momento ' +
  'cuatro capas y NUNCA las mezcles: (1) dato observado — algo que literalmente aparece en las ' +
  'respuestas o su conteo; (2) patrón encontrado — una tendencia o coincidencia entre varias respuestas; ' +
  '(3) interpretación razonable — tu lectura pedagógica de ese patrón, marcada como tal; ' +
  '(4) recomendación pedagógica — una acción concreta derivada de lo anterior. Nunca presentes una ' +
  'interpretación como si fuera un dato, y nunca afirmes una causa que los datos no demuestran (por ' +
  'ejemplo, nunca digas que "los estudiantes tienen problemas familiares" salvo que eso aparezca ' +
  'explícita y repetidamente en sus respuestas, ni generalices "el grupo es desmotivado" a partir de ' +
  'solo algunas respuestas). Nunca infieras ni menciones diagnósticos médicos, trastornos psicológicos, ' +
  'información sexual, política, religiosa, antecedentes legales, ni identifiques a ningún estudiante en ' +
  'particular — el resultado es SIEMPRE agregado y grupal, jamás individual. Escribe en español, claro y ' +
  'breve. Responde únicamente con el JSON del esquema indicado, sin texto adicional.'

function promptAnalisisEncuestaContexto(ctx) {
  const preguntasTxt = ctx.preguntas.map((p) => {
    if (p.tipo === 'opcion_multiple') {
      const dist = p.distribucion.map((d) => `"${d.texto}": ${d.n} (${d.pct}%)`).join(', ')
      return `${p.numero}. [opción múltiple] "${p.enunciado}" — ${p.totalRespuestas} respuestas. Distribución: ${dist || 'sin respuestas'}`
    }
    const textos = p.textos.length ? p.textos.map((t) => `  - ${t}`).join('\n') : '  (sin respuestas de texto)'
    return `${p.numero}. [respuesta breve] "${p.enunciado}" — ${p.totalRespuestas} respuestas:\n${textos}`
  }).join('\n\n')

  return (
    `Asignatura: ${ctx.asignaturaNombre || 'la asignatura del docente'}.\n` +
    `${ctx.totalEstudiantes} estudiantes contestaron el diagnóstico de contexto. ${ctx.totalPreguntas} preguntas.\n\n` +
    `RESPUESTAS AGREGADAS POR PREGUNTA:\n${preguntasTxt}\n\n` +
    (ctx.totalEstudiantes < 10
      ? `AVISO: solo ${ctx.totalEstudiantes} estudiantes contestaron — con tan pocas respuestas, evita ` +
        'generalizar y dilo explícitamente en tu resumen.\n\n'
      : '') +
    'Responde SOLO con este JSON (usa arreglos vacíos si una lista no aplica):\n' +
    '{\n' +
    '  "caracteristicas": ["<característica relevante del grupo QUE LAS RESPUESTAS SUSTENTEN, máx 200 caracteres>"],\n' +
    '  "condiciones": ["<condición o factor de contexto detectado, máx 200 caracteres>"],\n' +
    '  "intereses": ["<interés o motivador que aparece en las respuestas, máx 200 caracteres>"],\n' +
    '  "necesidades": ["<necesidad pedagógicamente relevante y sostenible con los datos, máx 200 caracteres>"],\n' +
    '  "patrones": [{"observacion": "<tendencia o coincidencia encontrada>", "interpretacion": "<tu lectura pedagógica, marcada como interpretación>"}],\n' +
    '  "recomendaciones": ["<recomendación pedagógica concreta derivada de los datos>"],\n' +
    '  "resumenGeneral": "<3-5 frases, proporcional a la evidencia disponible>"\n' +
    '}'
  )
}

// La IA propone SOLO texto; los conteos/distribuciones ya vienen calculados
// por agregarResultadosEncuesta en `ctx` — igual principio que
// normalizarAnalisis: la IA nunca decide un número, solo lo interpreta.
function normalizarAnalisisEncuestaContexto(datos, ctx) {
  return {
    tipo: 'encuesta_contexto',
    caracteristicas: normalizarListaTexto(datos?.caracteristicas, 10, 220),
    condiciones: normalizarListaTexto(datos?.condiciones, 10, 220),
    intereses: normalizarListaTexto(datos?.intereses, 10, 220),
    necesidades: normalizarListaTexto(datos?.necesidades, 10, 220),
    patrones: (Array.isArray(datos?.patrones) ? datos.patrones : []).slice(0, 8).map((p) => ({
      observacion: String(p?.observacion || '').trim().slice(0, 220),
      interpretacion: String(p?.interpretacion || '').trim().slice(0, 300),
    })),
    recomendaciones: (Array.isArray(datos?.recomendaciones) ? datos.recomendaciones : []).slice(0, 8).map((r) => String(r || '').trim().slice(0, 300)),
    resumenGeneral: String(datos?.resumenGeneral || '').trim().slice(0, 1500),
    totalEstudiantes: ctx.totalEstudiantes,
    totalPreguntas: ctx.totalPreguntas,
    confiabilidad: ctx.confiabilidad,
  }
}

async function ejecutarAnalisisEncuestaContexto({ params, modelo, apiKey }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const ctx = params.__contexto

  const { datos, interno } = await pedirJSON({
    client, modelo, maxTokens: 2500, system: ENCUESTA_CONTEXTO_SISTEMA,
    prompt: promptAnalisisEncuestaContexto(ctx),
  })

  const resultado = normalizarAnalisisEncuestaContexto(datos, ctx)
  // Regla de no invención (T.7): sin resumen no hay nada aprovechable — esto
  // NO se cobra, cae al catch del callable y reembolsa.
  if (!resultado.resumenGeneral) {
    throw new Error('El asistente de IA no generó un diagnóstico de contexto utilizable')
  }

  return { resultado, unidadesReales: 1, interno }
}

async function ejecutarAnalisisResultados({ params, modelo, apiKey }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const ctx = params.__contexto // lo puso el precheck; el cliente no puede tocarlo

  // Encuesta (ponderarReactivos:false, ver precheckAnalisisResultados) vs.
  // evaluación calificable — misma bandera, ramas separadas de aquí en
  // adelante; ninguna evaluación existente cambia de comportamiento.
  if (ctx.modoEncuesta) return ejecutarAnalisisEncuestaContexto({ params, modelo, apiKey })

  const { datos, interno } = await pedirJSON({
    client, modelo, maxTokens: 2500, system: ANALISIS_SISTEMA,
    prompt: promptAnalisis(ctx),
  })

  const resultado = normalizarAnalisis(datos, ctx)
  // Regla de no invención (T.7): sin resumen ni resumen ejecutivo no hay nada
  // aprovechable — esto NO se cobra, cae al catch del callable y reembolsa.
  if (!resultado.resumenGeneral && !resultado.resumenEjecutivo) {
    throw new Error('El asistente de IA no generó un análisis utilizable')
  }

  return { resultado, unidadesReales: 1, interno }
}

// ── OP-03/OP-04 · Crear examen o cuestionario completo con IA ───────────────
// REGLA (PO, 11-ago-2026, ficha aprobada): en vez de duplicar OP-03 (examen) y
// OP-04 (cuestionario) — que solo difieren en la categoría de la actividad
// padre, ya validada por REACTIVOS_PADRES_VALIDOS — es UNA operación
// parametrizada. Mismo principio de fuente de contenido que OP-09: lo que el
// docente escribe en "¿Qué quieres evaluar?" es la fuente inmediata; hasta 3
// documentos (PDF/Word) que el docente adjunte son fuente ADICIONAL opcional.
// El Universo Curricular, la Planeación Didáctica y el resto de fuentes del
// curso NO participan todavía (fase posterior de los planes de pago).
//
// A diferencia de OP-09 (el docente revisa antes de guardar), aquí la IA
// escribe DIRECTO en activities/{id}/preguntas + clave — por eso el ejecutor
// usa el Admin SDK con el mismo reparto público/privado de
// utils/evaluacionClave.js (el cliente no puede llamar esa función: usa el
// SDK web con el candado de suscripción, que no aplica al servidor).
//
// La cantidad y el tipo de cada reactivo los fija Evalúa Fácil (igual que
// OP-09); la PONDERACIÓN también: `repartirPonderacion` reparte los 10 puntos
// en código, nunca la IA.

// Tope único de reactivos generables, igual para todos los docentes — sin
// variantes por plan (modelo de créditos puros, decisión del PO, 20-ago-2026).
const MAX_REACTIVOS_EVALUACION = 100
const LOTE_MAX_REACTIVOS = 15 // tamaño de lote por llamada al modelo, para no exceder max_tokens

// Reparte 10 puntos entre `cantidad` reactivos en partes iguales a un
// decimal; el último absorbe el residuo del redondeo para que la suma dé
// SIEMPRE exactamente 10.0 (función pura, ver test/ia-creditos.test.mjs).
function repartirPonderacion(cantidad) {
  const n = Math.max(1, cantidad)
  const base = Math.round((10 / n) * 10) / 10
  const valores = Array.from({ length: n }, () => base)
  const suma = Math.round(valores.reduce((s, v) => s + v, 0) * 10) / 10
  const residuo = Math.round((10 - suma) * 10) / 10
  valores[n - 1] = Math.round((valores[n - 1] + residuo) * 10) / 10
  return valores
}

// Precheck: todo lo que puede rechazar la operación SIN gastar un crédito.
async function precheckCrearEvaluacion({ uid, params }) {
  const db = getFirestore()
  const actividadId = String(params?.actividadId || '')
  if (!actividadId) {
    throw new HttpsError('invalid-argument',
      'Guarda primero el cuestionario o examen: la evaluación se genera a partir de él.')
  }

  const snap = await db.doc(`activities/${actividadId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'La actividad no existe')
  const act = snap.data()
  if (act.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta actividad no es tuya')

  const clase = REACTIVOS_PADRES_VALIDOS[act.categoria] || null
  if (!clase) {
    throw new HttpsError('failed-precondition',
      'Solo un cuestionario o un examen pueden generarse completos con IA.')
  }

  const quiereEvaluar = String(params?.quiereEvaluar || '').trim().slice(0, MAX_QUIERE_EVALUAR)
  if (quiereEvaluar.length < MIN_QUIERE_EVALUAR) {
    throw new HttpsError('failed-precondition',
      `Describe con más detalle qué quieres evaluar (mínimo ${MIN_QUIERE_EVALUAR} caracteres) para que la IA pueda generar la evaluación fundamentada. No se descontaron créditos.`,
      { codigo: 'CONTEXTO_INSUFICIENTE' })
  }

  const cantidad = clampInt(params?.cantidad, 10, MIN_REACTIVOS, MAX_REACTIVOS_EVALUACION)
  const tipoSolicitado = TIPOS_REACTIVO.includes(params?.tipoSolicitado) ? params.tipoSolicitado : 'mixto'

  // Documentos de referencia: fuentes permanentes (generales + las del
  // parcial de esta actividad, nunca las de otro parcial) + hasta 3 que el
  // docente adjuntó a mano aquí — lógica compartida con reactivos (OP-09) y
  // crear_actividad_ia (OP-05): ver fuentesIA.js.
  const bloqueFuentes = await bloqueFuentesOperacion(db, {
    asignaturaId: act.asignaturaId, parcial: act.parcial, fuentesManual: params?.fuentes,
  })

  return {
    clase,
    nombre: String(act.nombre || act.titulo || '').trim().slice(0, 200),
    quiereEvaluar,
    cantidad,
    tipoSolicitado,
    tipos: tiposParaLote(tipoSolicitado, cantidad),
    bloqueFuentes,
  }
}

const CREAR_EVAL_SISTEMA =
  'Eres el asistente pedagógico de Evalúa Fácil y trabajas dentro de la asignatura de un ' +
  'docente de bachillerato mexicano. Tu papel es PROPONER: el docente siempre revisa el resultado. ' +
  'Construye los reactivos a partir de lo que el docente describe en "qué quiere evaluar" y, si se ' +
  'te dan, de los documentos de referencia que adjuntó — no agregues conceptos, temas ni aprendizajes ' +
  'que no estén ahí, y no completes con conocimiento general más allá de eso. La cantidad y el tipo de ' +
  'cada reactivo los fija Evalúa Fácil: genera EXACTAMENTE los reactivos pedidos, uno por cada tipo ' +
  'indicado y en ese orden. No repartas puntos ni calcules ponderaciones: Evalúa Fácil las calcula. ' +
  'Escribe en español, claro y breve. Responde únicamente con el JSON válido del esquema indicado, ' +
  'sin texto adicional.'

// `tiposLote`/`offset`: el prompt de cada lote pide solo SU tramo de
// reactivos, pero la numeración que se le muestra al modelo es la GLOBAL
// (offset + posición) para que la referencia a "reactivo N" tenga sentido si
// el docente la lee — el tipo real de cada uno lo sigue forzando `ctx.tipos`
// en `normalizarReactivos`, nunca lo que el modelo devuelva.
//
// `pedirInstrucciones`: las instrucciones generales del examen/cuestionario
// (lo que ve el estudiante antes de responder) se piden UNA sola vez, en el
// primer lote — pedirlas en cada lote generaría varias versiones distintas
// que se pisarían entre sí sin ganar nada.
function promptCrearEvaluacion(ctx, asignatura, tiposLote, offset, pedirInstrucciones) {
  const listaTipos = tiposLote.map((t, i) => `${offset + i + 1}. ${ETIQUETA_TIPO_REACTIVO[t] || t}`).join('\n')
  const fuentesBloque = ctx.bloqueFuentes ? `\n\n${ctx.bloqueFuentes}\n` : ''
  return (
    `Asignatura: ${asignatura || 'la asignatura del docente'} (bachillerato).\n` +
    `${ctx.clase === 'examen' ? 'EXAMEN' : 'CUESTIONARIO'}: "${ctx.nombre}".\n` +
    `\nQUÉ QUIERE EVALUAR EL DOCENTE (fuente principal del contenido):\n"""${ctx.quiereEvaluar}"""\n` +
    fuentesBloque +
    `\nGenera EXACTAMENTE ${tiposLote.length} reactivos, uno por cada tipo, EN ESTE ORDEN:\n${listaTipos}\n\n` +
    'Reglas por tipo:\n' +
    '- opcion_multiple: enunciado + 4 opciones + el índice (0-3) de la opción correcta.\n' +
    '- verdadero_falso: un enunciado afirmativo evaluable + "v" o "f".\n' +
    '- respuesta_corta: enunciado + una respuesta esperada breve o criterio de respuesta correcta ' +
    '(es una guía para que el docente califique a mano; el alumno nunca la ve).\n' +
    '- subir_archivo: enunciado con la instrucción de qué debe subir el alumno (sin respuesta).\n\n' +
    (pedirInstrucciones
      ? 'Además, escribe las INSTRUCCIONES GENERALES que verá el estudiante antes de responder ' +
        `este ${ctx.clase === 'examen' ? 'examen' : 'cuestionario'}: qué se le pide, cómo debe trabajar, ` +
        'cualquier indicación relevante (2-4 frases, HTML simple con <p>/<strong>/<ul>/<li>, sin inventar ' +
        'reglas que Evalúa Fácil ya aplica como el tiempo límite o los intentos).\n\n'
      : '') +
    'Responde SOLO con este JSON:\n' +
    '{\n  "reactivos": [\n' +
    '    {"tipo": "<tipo exacto de la lista>", "enunciado": "<máx 400 caracteres>", ' +
    '"opciones": ["<solo si opcion_multiple>", "..."], "correcta": "<índice 0-3 si opcion_multiple, ' +
    '\'v\'/\'f\' si verdadero_falso>", "respuestaEsperada": "<solo si respuesta_corta, máx 200 caracteres>"}\n' +
    '  ]' +
    (pedirInstrucciones ? ',\n  "instruccionesHtml": "<instrucciones generales, HTML simple>"\n' : '\n') +
    '}'
  )
}

// Ids únicos por opción, mismo criterio que makeOption() del cliente
// (EvaluacionEditor.jsx) — no letras fijas, así se puede reordenar/editar sin
// arrastrar el id.
function idOpcion() {
  return `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

async function ejecutarCrearEvaluacion({ params, modelo, apiKey }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const ctx = params.__contexto // lo puso el precheck; el cliente no puede tocarlo
  const asignatura = String(params?.asignaturaNombre || '').slice(0, 120)
  const actividadId = String(params?.actividadId || '')

  // Lotes de máximo LOTE_MAX_REACTIVOS para no exceder max_tokens en
  // evaluaciones grandes (hasta 100 reactivos en planes de pago); el offset
  // mantiene el round-robin de tipos global entre lotes.
  const lotes = []
  for (let i = 0; i < ctx.tipos.length; i += LOTE_MAX_REACTIVOS) lotes.push(ctx.tipos.slice(i, i + LOTE_MAX_REACTIVOS))

  let reactivos = []
  let instruccionesHtml = ''
  let tokensEntrada = 0
  let tokensSalida = 0
  let ms = 0
  let offset = 0
  for (const [i, tiposLote] of lotes.entries()) {
    const primerLote = i === 0
    const { datos, interno } = await pedirJSON({
      client, modelo,
      maxTokens: Math.min(8000, 350 * tiposLote.length + 400 + (primerLote ? 400 : 0)),
      system: CREAR_EVAL_SISTEMA,
      prompt: promptCrearEvaluacion(ctx, asignatura, tiposLote, offset, primerLote),
    })
    reactivos = reactivos.concat(normalizarReactivos(datos, { tipos: tiposLote }))
    // Instrucciones generales: solo se piden en el primer lote (ver
    // promptCrearEvaluacion) — si la IA no las trae, la actividad se queda
    // sin instrucciones en vez de inventarlas (regla de no invención, T.7).
    if (primerLote) instruccionesHtml = sanitizarInstruccionesHtml(datos?.instruccionesHtml)
    tokensEntrada += interno.tokensEntrada || 0
    tokensSalida += interno.tokensSalida || 0
    ms += interno.ms || 0
    offset += tiposLote.length
  }

  // Regla de no invención (T.7): lo que no trajo enunciado no es aprovechable
  // y se descarta — si no queda nada, esto NO se cobra (cae al catch del
  // callable, que reembolsa la reserva).
  reactivos = reactivos.filter((r) => r.enunciado)
  if (!reactivos.length) throw new Error('El asistente de IA no generó reactivos utilizables')

  const ponderaciones = repartirPonderacion(reactivos.length)
  const db = getFirestore()
  const batch = db.batch()
  reactivos.forEach((r, i) => {
    const pregRef = db.collection(`activities/${actividadId}/preguntas`).doc()
    const claveRef = db.collection(`activities/${actividadId}/clave`).doc(pregRef.id)
    const base = {
      tipo: r.tipo, enunciado: r.enunciado, ponderacion: ponderaciones[i],
      retroalimentacion: null, imagenUrl: null, orden: i, origenBancoId: null,
    }
    if (r.tipo === 'opcion_multiple') {
      const opciones = r.opciones.map((texto) => ({ id: idOpcion(), texto }))
      batch.set(pregRef, { ...base, opciones })
      batch.set(claveRef, { respuestaCorrecta: opciones[r.correcta]?.id ?? opciones[0]?.id ?? null, respuestaEsperada: null })
    } else if (r.tipo === 'verdadero_falso') {
      batch.set(pregRef, { ...base, opciones: [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }] })
      batch.set(claveRef, { respuestaCorrecta: r.correcta === 'f' ? 'f' : 'v', respuestaEsperada: null })
    } else if (r.tipo === 'respuesta_corta') {
      batch.set(pregRef, { ...base, opciones: null })
      batch.set(claveRef, { respuestaCorrecta: null, respuestaEsperada: r.respuestaEsperada || null })
    } else { // subir_archivo: sin clave
      batch.set(pregRef, { ...base, opciones: null })
      batch.set(claveRef, { respuestaCorrecta: null, respuestaEsperada: null })
    }
  })
  await batch.commit()
  // El contador que muestran las pantallas del editor — mismo campo que
  // syncNumPreguntas actualiza desde el cliente en el flujo manual/OP-09.
  const updateActividad = { evaluacion: { numPreguntas: reactivos.length } }
  // Solo se sobrescribe si la IA sí trajo instrucciones — nunca se pisa con
  // vacío lo que ya hubiera (aunque al nacer la actividad siempre es '').
  if (instruccionesHtml) updateActividad.instrucciones = instruccionesHtml
  await db.doc(`activities/${actividadId}`).set(updateActividad, { merge: true })

  return {
    resultado: { cantidad: reactivos.length, clase: ctx.clase },
    unidadesReales: reactivos.length, // 1 crédito por reactivo realmente generado
    interno: { modelo, tokensEntrada, tokensSalida, ms },
  }
}

// ── OP-05 · Crear actividad (entregable/observación) completa con IA ───────
// REGLA (11-ago-2026, misma línea que unificó OP-03/OP-04 en una sola
// operación): 'crear_actividad_ia' está parametrizada por
// `params.categoria: 'entregable'|'observacion'` en vez de duplicarse. La IA
// propone nombre, instrucciones, producto esperado, tipos de archivo
// sugeridos y un peso — el docente siempre revisa antes de publicar (la
// actividad nace oculta, igual que OP-03/OP-04).
//
// El peso sugerido NUNCA puede rebasar lo que le queda al parcial: el
// precheck replica en el servidor la MISMA fórmula que ya usa el cliente
// (SubjectPage.jsx `pesoRestante`, ~línea 3564) sin tocar ese archivo — dos
// implementaciones de la misma regla, a propósito, porque el cliente no
// puede confiar en un número que mandara el servidor sin recalcularlo, y
// viceversa.

const CATEGORIAS_ACTIVIDAD_IA = { entregable: 'entregable', observacion: 'observacion' }
const MIN_PETICION_ACTIVIDAD = 20
const MAX_PETICION_ACTIVIDAD = 2000
const TIPOS_ARCHIVO_VALIDOS = ['imagenes', 'pdf', 'word', 'powerpoint', 'excel', 'zip']

// Precheck: todo lo que puede rechazar la operación SIN gastar un crédito.
async function precheckCrearActividad({ uid, params }) {
  const db = getFirestore()
  const categoria = CATEGORIAS_ACTIVIDAD_IA[params?.categoria] || null
  if (!categoria) {
    throw new HttpsError('invalid-argument', 'Categoría de actividad no válida para crear con IA')
  }

  const asignaturaId = String(params?.asignaturaId || '')
  if (!asignaturaId) throw new HttpsError('invalid-argument', 'Falta la asignatura')
  const subSnap = await db.doc(`subjects/${asignaturaId}`).get()
  if (!subSnap.exists) throw new HttpsError('not-found', 'La asignatura no existe')
  const subj = subSnap.data()
  if (subj.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta asignatura no es tuya')

  const parcial = clampInt(params?.parcial, 1, 1, Number(subj.parciales) || 1)
  if (!Number.isInteger(params?.parcial) || params.parcial < 1 || params.parcial > (Number(subj.parciales) || 1)) {
    throw new HttpsError('invalid-argument', 'El parcial indicado no existe en esta asignatura')
  }

  const peticion = String(params?.peticion || '').trim().slice(0, MAX_PETICION_ACTIVIDAD)
  if (peticion.length < MIN_PETICION_ACTIVIDAD) {
    throw new HttpsError('failed-precondition',
      `Describe con más detalle qué quieres trabajar (mínimo ${MIN_PETICION_ACTIVIDAD} caracteres) para que la IA pueda proponer una actividad fundamentada. No se descontaron créditos.`,
      { codigo: 'CONTEXTO_INSUFICIENTE' })
  }

  // Actividades ya existentes de ese parcial: nombres (para que la IA no
  // proponga uno duplicado) y peso restante — misma fórmula que
  // SubjectPage.jsx `pesoRestante`/`pesoTotalVivo` (suma de pesoCalificacion,
  // acotada a 10), replicada aquí porque el servidor no puede confiar en el
  // número que mandara el cliente ni viceversa.
  const actsSnap = await db.collection('activities')
    .where('asignaturaId', '==', asignaturaId).where('parcial', '==', parcial).get()
  const existentes = actsSnap.docs.map((d) => d.data())
  const nombresExistentes = existentes.map((a) => String(a.nombre || a.titulo || '').trim()).filter(Boolean).slice(0, 50)
  const pesoUsado = existentes.reduce((s, a) => {
    const v = parseFloat(a.pesoCalificacion)
    return s + (isNaN(v) || v < 0 ? 0 : v)
  }, 0)
  const pesoRestante = Math.max(0, Math.round((10 - pesoUsado) * 10) / 10)

  // Fuentes permanentes (generales + las del parcial de esta actividad,
  // nunca las de otro parcial) + hasta 3 que el docente adjuntó a mano aquí.
  const bloqueFuentes = await bloqueFuentesOperacion(db, { asignaturaId, parcial, fuentesManual: params?.fuentes })

  return {
    categoria,
    asignaturaId,
    parcial,
    peticion,
    nombresExistentes,
    pesoRestante,
    bloqueFuentes,
  }
}

// REGLA ESTRICTA (pedido explícito de Kike, 14-ago-2026, tras ver una
// Planeación real que proponía "diálogo sobre experiencias propias de
// dinero en casa" como actividad de grupo): ninguna actividad generada por
// IA debe exponer a un estudiante frente a sus compañeros, ni pedirle que
// hable en público de su situación económica o familiar — o cualquier otro
// dato privado que pueda avergonzarlo o denigrarlo. Se antepone a TODO
// prompt que pueda proponer actividades de clase (Planeación y Crear
// actividad) — no es negociable ni depende del tema de la asignatura.
const REGLA_ACTIVIDADES_NO_DENIGRANTES =
  'REGLA ESTRICTA E INQUEBRANTABLE, sin excepción posible: nunca propongas una actividad que exponga en ' +
  'público (frente al grupo, en un diálogo abierto, una presentación personal, una dinámica donde cada ' +
  'quien comparte lo suyo, etc.) información privada o sensible de los estudiantes o sus familias — su ' +
  'situación económica o financiera, ingresos, carencias, situación migratoria, salud, conflictos ' +
  'familiares, religión u orientación. Puede avergonzarlos o denigrarlos frente a sus compañeros. Si el ' +
  'tema de la asignatura toca dinero, finanzas o economía familiar, usa SIEMPRE un ejemplo hipotético o de ' +
  'un tercero (una familia inventada, un caso de estudio, una empresa ficticia) — jamás pidas que el ' +
  'estudiante comparta, exponga o hable en clase de su propia situación económica o la de su familia. '

const CREAR_ACTIVIDAD_SISTEMA =
  REGLA_ACTIVIDADES_NO_DENIGRANTES +
  'Eres el asistente pedagógico de Evalúa Fácil y trabajas dentro de la asignatura de un ' +
  'docente de bachillerato mexicano. Tu papel es PROPONER: el docente siempre revisa, edita y decide ' +
  'antes de publicar la actividad. Construye la propuesta a partir de lo que el docente describe en ' +
  '"qué quiere trabajar" y, si se te dan, de los documentos de referencia que adjuntó — no agregues ' +
  'contenidos que no estén ahí. No propongas un nombre igual o casi igual a uno de los nombres ya ' +
  'existentes que se te dan, para no duplicar actividades del mismo parcial. El campo ' +
  '"instruccionesHtml" debe usar ÚNICAMENTE estas etiquetas HTML simples: <p>, <br>, <strong>, <em>, ' +
  '<ul>, <ol>, <li> — nada de estilos, clases, atributos ni otras etiquetas. Escribe en español, claro ' +
  'y breve. Responde únicamente con el JSON válido del esquema indicado, sin texto adicional.'

function promptCrearActividad(ctx, asignatura) {
  const esObs = ctx.categoria === 'observacion'
  const nombresBloque = ctx.nombresExistentes.length
    ? `\nActividades que YA existen en este parcial (no propongas un nombre igual o muy parecido):\n- ${ctx.nombresExistentes.join('\n- ')}\n`
    : ''
  const fuentesBloque = ctx.bloqueFuentes ? `\n${ctx.bloqueFuentes}\n` : ''
  return (
    `Asignatura: ${asignatura || 'la asignatura del docente'} (bachillerato).\n` +
    `Vas a proponer ${esObs ? 'una ACTIVIDAD DE OBSERVACIÓN (sin entrega de archivos: el docente observa y califica en clase, ej. actitud, exposición, participación)' : 'un ENTREGABLE (el estudiante sube uno o varios archivos)'}.\n` +
    nombresBloque +
    `\nQUÉ QUIERE TRABAJAR EL DOCENTE:\n"""${ctx.peticion}"""\n` +
    fuentesBloque +
    `\nEl peso de calificación que propongas ("pesoSugerido") debe ser un número entre 0 y ${ctx.pesoRestante} ` +
    `(lo que le queda disponible a este parcial de un total de 10).\n\n` +
    'Responde SOLO con este JSON:\n' +
    '{\n' +
    '  "nombre": "<nombre de la actividad, máx 120 caracteres>",\n' +
    '  "instruccionesHtml": "<' + (esObs ? 'qué vas a observar y cómo se evaluará' : 'instrucciones para el estudiante: qué debe hacer y entregar') + ', HTML simple>",\n' +
    '  "productoEsperado": "<en una frase, qué se espera obtener de esta actividad, máx 200 caracteres>",\n' +
    (esObs ? '' : `  "tiposArchivoSugeridos": ["<subconjunto de: ${TIPOS_ARCHIVO_VALIDOS.join(', ')}>"],\n`) +
    `  "pesoSugerido": <número entre 0 y ${ctx.pesoRestante}, un decimal>\n` +
    '}'
  )
}

// Sanitizador HTML mínimo para el servidor (Node no tiene DOM — sin
// DOMPurify/jsdom en functions/, y no vale la pena sumarlos solo para esto).
// Whitelist estricta por regex: solo las etiquetas de ALLOWED_TAGS_ACTIVIDAD,
// SIN atributos (ninguno de estos tags los necesita en el modelo de datos de
// `instrucciones`), y elimina cualquier otra cosa — <script>, <img onerror=…>,
// comentarios, etc. — por diseño (allowlist, no blocklist): lo que no está en
// la lista desaparece, no se intenta "limpiar" atributo por atributo.
const ALLOWED_TAGS_ACTIVIDAD = ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li']
function sanitizarInstruccionesHtml(html) {
  let s = String(html || '')
  // Fuera de inmediato: contenido de <script>/<style> (con su texto interior,
  // que si no se quitara quedaría como texto plano inyectado).
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
  // Comentarios HTML (pueden usarse para ocultar payloads en navegadores viejos).
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  // Cualquier etiqueta: si su nombre está en la whitelist, se deja SIN
  // atributos (abre o cierra); si no, se elimina por completo (el texto que
  // rodeaba se conserva, solo desaparece el tag).
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tag) => {
    const t = tag.toLowerCase()
    if (!ALLOWED_TAGS_ACTIVIDAD.includes(t)) return ''
    const cierre = match.startsWith('</') ? '/' : ''
    return `<${cierre}${t}>`
  })
  return s.trim()
}

async function ejecutarCrearActividad({ params, modelo, apiKey }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const ctx = params.__contexto // lo puso el precheck; el cliente no puede tocarlo
  const asignatura = String(params?.asignaturaNombre || '').slice(0, 120)
  const actividadId = String(params?.actividadId || '')
  if (!actividadId) throw new HttpsError('invalid-argument', 'Falta la actividad ya creada')

  const { datos, interno } = await pedirJSON({
    client, modelo, maxTokens: 1200, system: CREAR_ACTIVIDAD_SISTEMA,
    prompt: promptCrearActividad(ctx, asignatura),
  })

  const nombre = String(datos?.nombre || '').trim().slice(0, 120)
  const instruccionesHtml = sanitizarInstruccionesHtml(datos?.instruccionesHtml)
  const productoEsperado = String(datos?.productoEsperado || '').trim().slice(0, 200)
  if (!nombre && !instruccionesHtml) {
    throw new Error('El asistente de IA no generó una actividad utilizable')
  }

  let tiposArchivoSugeridos = (Array.isArray(datos?.tiposArchivoSugeridos) ? datos.tiposArchivoSugeridos : [])
    .filter((t) => TIPOS_ARCHIVO_VALIDOS.includes(t))
  if (ctx.categoria === 'entregable' && !tiposArchivoSugeridos.length) tiposArchivoSugeridos = ['imagenes']

  // El número lo acota SIEMPRE el código, nunca lo que devolvió el modelo:
  // entre 0 y ctx.pesoRestante (calculado por el precheck a partir de datos
  // reales de Firestore), redondeado a 1 decimal.
  const pesoSugerido = Math.round(Math.min(ctx.pesoRestante, Math.max(0, Number(datos?.pesoSugerido) || 0)) * 10) / 10

  const db = getFirestore()
  const update = {
    nombre: nombre || 'Actividad generada con IA',
    instrucciones: instruccionesHtml,
    productoEsperado,
    pesoCalificacion: pesoSugerido,
    // NO se toca `oculta` aquí — mismo criterio que ejecutarCrearEvaluacion
    // (OP-03/04): la actividad nació oculta:true al crearla (ver
    // CrearActividadIAModal), y sigue así hasta que el docente la revise y
    // publique manualmente desde el editor, igual que un borrador normal.
  }
  if (ctx.categoria === 'entregable') update.tiposArchivo = tiposArchivoSugeridos
  await db.doc(`activities/${actividadId}`).update(update)

  return {
    resultado: { actividadId, categoria: ctx.categoria },
    unidadesReales: 1,
    interno,
  }
}

// ── Crucigrama / Sopa de letras · generar_contenido_juego ─────────────────
// Decisión de producto #2 (aprobada): SÍ usa IA (claude-haiku-4-5), tarifa
// FIJA 0.5 crédito por ejecución sin importar cantidad de palabras,
// modalidad ni si trae documento — se registra igual que las demás
// operaciones (ledger.reservar/liquidar/reembolsar vía ejecutarOperacionIA).
// El resultado se guarda en activities/{id}.juego.contenido — el docente lo
// edita en ContenidoJuegoEditor.jsx antes de confirmar (construirJuego, que
// es gratis y no usa IA).
const MIN_PALABRAS_JUEGO = 5
const MAX_PALABRAS_JUEGO = 20
const MODALIDADES_JUEGO = ['palabra', 'descripcion']
const MAX_CONTEXTO_JUEGO = 1500

async function precheckGenerarContenidoJuego({ uid, params }) {
  const db = getFirestore()
  const actividadId = String(params?.actividadId || '')
  if (!actividadId) throw new HttpsError('invalid-argument', 'Falta la actividad')
  const snap = await db.doc(`activities/${actividadId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'La actividad no existe')
  const act = snap.data()
  if (act.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta actividad no es tuya')
  if (act.categoria !== 'juego' || !['crucigrama', 'sopa_letras'].includes(act.tipoJuego)) {
    throw new HttpsError('failed-precondition', 'Esta actividad no es un Crucigrama ni una Sopa de letras')
  }

  const modalidad = MODALIDADES_JUEGO.includes(params?.modalidad) ? params.modalidad : 'palabra'
  const cantidad = clampInt(params?.cantidadPalabras, 10, MIN_PALABRAS_JUEGO, MAX_PALABRAS_JUEGO)
  const contexto = String(params?.contexto || '').trim().slice(0, MAX_CONTEXTO_JUEGO)

  // Documento opcional (máx 1, PDF o .docx — FuentesIAInput ya lo limita en
  // el cliente; aquí solo se toma el primero por si acaso).
  const urls = Array.isArray(params?.fuentes) ? params.fuentes.slice(0, 1) : []
  const bloqueFuentes = await fuentesIA.prepararBloqueFuentes(urls)

  return {
    tipoJuego: act.tipoJuego,
    modalidad,
    cantidad,
    contexto,
    bloqueFuentes,
  }
}

const CONTENIDO_JUEGO_SISTEMA =
  'Eres el asistente pedagógico de Evalúa Fácil y trabajas dentro de la asignatura de un docente de ' +
  'bachillerato mexicano. Tu papel es PROPONER una lista de palabras para un juego educativo (crucigrama ' +
  'o sopa de letras) que el docente va a revisar y editar antes de usar. Las palabras deben ser en ' +
  'español, relacionadas con el tema que describe el docente (y con los documentos de referencia, si se ' +
  'te dan) — términos, conceptos o nombres propios del tema, sin repetir ninguna. Conserva acentos y la ' +
  'Ñ donde corresponda (el sistema normaliza por su cuenta para construir la cuadrícula). Responde ' +
  'únicamente con el JSON válido del esquema indicado, sin texto adicional.'

function promptContenidoJuego(ctx, asignatura) {
  const conDescripcion = ctx.modalidad === 'descripcion'
  const fuentesBloque = ctx.bloqueFuentes ? `\n${ctx.bloqueFuentes}\n` : ''
  return (
    `Asignatura: ${asignatura || 'la asignatura del docente'} (bachillerato).\n` +
    `Vas a proponer exactamente ${ctx.cantidad} palabras para un ${ctx.tipoJuego === 'crucigrama' ? 'crucigrama' : 'sopa de letras'}.\n` +
    `TEMA / CONTEXTO QUE DESCRIBE EL DOCENTE:\n"""${ctx.contexto || 'Sin contexto adicional: usa el tema general de la asignatura.'}"""\n` +
    fuentesBloque +
    (conDescripcion
      ? '\nModalidad "descripcion": cada palabra debe venir con una pista/descripción breve (sin decir la palabra), como en un crucigrama.\n'
      : '\nModalidad "palabra": solo la lista de palabras, sin descripción.\n') +
    `\nCada palabra: una sola palabra (sin espacios), entre 3 y 15 letras, en español (con acentos/Ñ si aplica).\n\n` +
    'Responde SOLO con este JSON:\n' +
    '{\n' +
    `  "palabras": [\n` +
    `    { "palabra": "<palabra>"${conDescripcion ? ', "descripcion": "<pista breve, máx 140 caracteres>"' : ''} }\n` +
    `  ]  // exactamente ${ctx.cantidad} elementos\n` +
    '}'
  )
}

async function ejecutarGenerarContenidoJuego({ params, modelo, apiKey }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const ctx = params.__contexto
  const asignatura = String(params?.asignaturaNombre || '').slice(0, 120)
  const actividadId = String(params?.actividadId || '')
  if (!actividadId) throw new HttpsError('invalid-argument', 'Falta la actividad')
  const idempotencyKey = String(params?.__idempotencyKey || '')

  async function pedir() {
    return pedirJSON({
      client, modelo, maxTokens: 1500, system: CONTENIDO_JUEGO_SISTEMA,
      prompt: promptContenidoJuego(ctx, asignatura),
    })
  }

  let { datos, interno } = await pedir()
  let palabras = normalizarListaContenidoJuego(datos?.palabras, ctx)

  // Si vino corto, un único reintento (mismo patrón que Planeación/OP-09) —
  // nunca se cobra dos veces: la tarifa de esta operación es fija por
  // ejecución completa, no por intento.
  if (palabras.length < ctx.cantidad) {
    const segundo = await pedir()
    interno = segundo.interno
    const combinadas = normalizarListaContenidoJuego(segundo.datos?.palabras, ctx)
    if (combinadas.length > palabras.length) palabras = combinadas
  }

  if (palabras.length < MIN_PALABRAS_JUEGO) {
    throw new Error('El asistente de IA no generó suficientes palabras utilizables para este juego')
  }

  const db = getFirestore()
  await db.doc(`activities/${actividadId}`).update({
    'juego.contenido': palabras,
    'juego.estado': 'contenido_generado',
    'juego.modalidad': ctx.modalidad,
    'juego.cantidadPalabras': ctx.cantidad,
    // CORRECCIÓN 23-ago-2026 (flujo de vista previa/edición/regeneración,
    // decisión de Kike): el crédito de esta generación se RESERVA aquí pero
    // ya NO se liquida en esta misma llamada (ver `diferirLiquidacion` más
    // abajo) — se guarda la clave de la reserva en la propia actividad para
    // que `confirmarJuego`/`cancelarBorradorJuego` (functions/juego.js) la
    // recuperen cuando el docente confirme o cancele el borrador, sin
    // depender de que el cliente la reenvíe (no se puede confiar en eso).
    'juego.idempotencyKeyReserva': idempotencyKey || null,
  })

  return {
    resultado: { actividadId, contenido: palabras },
    unidadesReales: 1,
    interno,
    // El ejecutor genérico (ejecutarOperacionIA) NO debe liquidar esta
    // reserva — se liquida hasta que el docente confirme el juego terminado
    // (functions/juego.js → confirmarJuego). Ninguna otra operación usa este
    // campo, así que el resto del ledger queda exactamente igual.
    diferirLiquidacion: true,
  }
}

// Valida/recorta lo que devolvió el modelo a la forma { palabra, descripcion }
// esperada, quitando duplicados y palabras inválidas (vacías, con espacios,
// demasiado cortas/largas) — nunca se confía ciegamente en el JSON del
// modelo. Se acota a ctx.cantidad como máximo (nunca se guardan de más).
function normalizarListaContenidoJuego(lista, ctx) {
  const vistos = new Set()
  const out = []
  for (const it of (Array.isArray(lista) ? lista : [])) {
    const palabra = String(it?.palabra || '').trim().replace(/\s+/g, '')
    if (palabra.length < 2 || palabra.length > 20) continue
    const clave = palabra.toUpperCase()
    if (vistos.has(clave)) continue
    vistos.add(clave)
    const descripcion = ctx.modalidad === 'descripcion'
      ? String(it?.descripcion || '').trim().slice(0, 140) || null
      : null
    out.push({ palabra, descripcion })
    if (out.length >= ctx.cantidad) break
  }
  return out
}

// ── Diagnóstico del grupo (FASE 2-BIS del Plan Maestro de IA, apartado 2 de
// Asistente IA, 12-ago-2026) — dos operaciones independientes: diagnóstico
// de CONTEXTO (interpretativo, sin reactivos) y diagnóstico de CONOCIMIENTOS
// (instrumento aplicable, con reactivos). Ambas comparten el mismo precheck
// (mismo contexto de entrada: Perfil IA del docente + Asignatura + hasta 3
// fuentes iniciales generales, reusando fuentesIA.prepararBloqueFuentes —
// nunca se vuelve a subir un archivo). Ninguna de las dos ve nombres de
// estudiantes: el precheck nunca lee `students` ni `submissions`, así que no
// hay nada de eso que pudiera llegarle al modelo.
//
// Tarifas (Kike, 12-ago-2026): diagnostico_contexto = 5 créditos fijos,
// diagnostico_conocimientos = 10 créditos fijos — ver seeds-db/seed-ia-tarifas.js.

// 12-ago-2026 (corrección de Kike): el diagnóstico de conocimientos dejó de
// ser un reporte simulado — ahora es un cuestionario REAL que contestan los
// estudiantes, y el docente elige cuántas preguntas quiere (antes las
// decidía la IA sola, entre 5 y 15). Se sube el tope a 20 porque ahora es
// una elección consciente del docente, no un límite para no pasarse.
const MAX_REACTIVOS_DIAGNOSTICO = 20
const MIN_REACTIVOS_DIAGNOSTICO = 5

// Hasta 3 fuentes GENERALES (nunca de parcial), las más recientes primero —
// mismo tope que fuentesIA.MAX_FUENTES. Función pura: recibe ya leídos los
// docs de `fuentesAsignatura` (con `creadoEnMillis` calculado por el
// llamador, porque un Timestamp de Firestore no es comparable en una función
// pura de pruebas).
function seleccionarFuentesGenerales(fuentes) {
  return (Array.isArray(fuentes) ? fuentes : [])
    .filter((f) => f?.ubicacion === 'general' && f?.url)
    .sort((a, b) => (b.creadoEnMillis || 0) - (a.creadoEnMillis || 0))
    .slice(0, fuentesIA.MAX_FUENTES)
}

// Mismo criterio de "completo" que src/utils/perfilIA.js (isPerfilIACompleto)
// — se repite aquí porque functions/ no importa código de src/ (entornos
// distintos, cliente vs. servidor). Si ese criterio cambia, hay que
// actualizar los dos lados.
function perfilIACompleto(perfilIA) {
  return Boolean(perfilIA?.estiloClase?.trim() && perfilIA?.habilidades?.trim() && perfilIA?.experiencia?.trim())
}

function perfilIATexto(perfilIA) {
  const partes = []
  if (perfilIA?.estiloClase?.trim()) partes.push(`Estilo de facilitar clase: ${perfilIA.estiloClase.trim()}`)
  if (perfilIA?.habilidades?.trim()) partes.push(`Habilidades del docente: ${perfilIA.habilidades.trim()}`)
  if (perfilIA?.experiencia?.trim()) partes.push(`Experiencia y características relevantes: ${perfilIA.experiencia.trim()}`)
  if (perfilIA?.contextoEscuela?.trim()) partes.push(`Contexto de la escuela: ${perfilIA.contextoEscuela.trim()}`)
  if (perfilIA?.contextoGeneral?.trim()) partes.push(`Otro contexto de trabajo: ${perfilIA.contextoGeneral.trim()}`)
  return partes.length ? partes.join('\n') : 'Información no disponible en las fuentes proporcionadas.'
}

// "Comentarios generales del grupo y su entorno" — texto libre que el
// docente escribe directamente (no lo genera la IA), p. ej. "apenas saben
// sumar", "nunca han usado más tecnología que el celular". Es la pieza que
// más debe pesar en la Planeación, junto con los diagnósticos — más que las
// fuentes. Opcional: si el docente no lo llenó, se dice explícitamente que
// no hay observación (nunca se inventa una).
function comentariosGrupoATexto(comentarios) {
  const texto = String(comentarios || '').trim()
  return texto || 'El docente no dejó comentarios generales sobre el grupo.'
}

// "Autoanálisis Docente (opcional)" — Asistente IA (13-ago-2026, pedido
// explícito de Kike). A diferencia de "Comentarios generales del grupo",
// esto es sobre el DOCENTE mismo (qué domina, qué le cuesta explicar, qué
// quiere mejorar de su forma de enseñar), no sobre el grupo — por eso solo
// alimenta Planeación (no los Diagnósticos, que son sobre el grupo).
// Totalmente opcional: si el docente no contestó nada, se dice
// explícitamente que no hay autoanálisis (nunca se inventa uno).
function autoanalisisDocenteATexto(autoanalisis) {
  const preguntas = [
    ['temasDomina', '¿Qué temas domina mejor?'],
    ['temasFortalecer', '¿Qué temas considera que necesita fortalecer?'],
    ['temasFacilExplicar', '¿Qué temas se le facilitan más para explicar?'],
    ['temasDificilExplicar', '¿Qué temas se le dificultan más para explicar?'],
  ]
  const partes = preguntas
    .map(([campo, pregunta]) => {
      const respuesta = String(autoanalisis?.[campo] || '').trim()
      return respuesta ? `${pregunta} ${respuesta}` : null
    })
    .filter(Boolean)
  return partes.length ? partes.join('\n') : 'El docente no contestó el autoanálisis (es opcional).'
}

// "Consideraciones (opcional)" — Asistente IA (14-ago-2026, pedido de Kike:
// se separó de Autoanálisis Docente porque no es sobre el docente ni sobre
// el grupo, sino sobre cómo quiere que la Planeación sea realmente
// utilizable durante el curso). Tiene su propia tarjeta y su propio
// checkbox de inclusión — ver ConsideracionesSection.jsx.
function consideracionesATexto(consideraciones) {
  const texto = String(consideraciones || '').trim()
  return texto || 'El docente no dejó consideraciones (es opcional).'
}

// Precheck compartido por los dos diagnósticos — todo lo que puede rechazar
// la operación SIN gastar un crédito: dueño de la asignatura, Perfil IA
// completo, al menos una fuente inicial general. Extraído a función pura
// (recibe `subjectId` ya resuelto) porque a partir del 12-ago-2026 el de
// conocimientos también necesita validar una actividad (ver
// precheckDiagnosticoConocimientos) antes de llegar a este punto común.
// El programa de estudios es la BASE de todo el Asistente IA (decisión de
// Kike, 15-ago-2026: "un programa de estudios es la base de todo, de la
// planeación, de los temas, de los tiempos, de todo") — requisito aparte de
// "Fuentes del curso" (fuentesAsignatura ubicacion:'general', que sigue
// existiendo pero ahora es solo material COMPLEMENTARIO, ya no obligatorio).
// El programa vive en asistenteIA/config.programaEstudios. `configSnap` se
// puede pasar ya leído para no repetir
// la lectura si el llamador ya lo tenía.
async function requerirProgramaEstudios(db, subjectId, configSnap) {
  const config = (configSnap || await db.doc(`subjects/${subjectId}/asistenteIA/config`).get()).data()
  const programaEstudios = config?.programaEstudios
  if (!programaEstudios?.url) {
    throw new HttpsError('failed-precondition',
      'Sube primero la Fuente Principal en PDF (arriba, en Fuente Principal / programa de estudios) — nada ' +
      'pesa más que ella en todo lo que hace el Asistente IA. No se descontaron créditos.',
      { codigo: 'SIN_PROGRAMA_ESTUDIOS' })
  }
  return programaEstudios
}

async function precheckDiagnosticoBase({ uid, subjectId }) {
  const db = getFirestore()
  if (!subjectId) throw new HttpsError('invalid-argument', 'Falta la asignatura.')

  const subjSnap = await db.doc(`subjects/${subjectId}`).get()
  if (!subjSnap.exists) throw new HttpsError('not-found', 'La asignatura no existe')
  const subj = subjSnap.data()
  if (subj.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta asignatura no es tuya')

  const perfilSnap = await db.doc(`users/${uid}`).get()
  const perfilIA = perfilSnap.data()?.perfilIA || null
  if (!perfilIACompleto(perfilIA)) {
    throw new HttpsError('failed-precondition',
      'Completa primero tu Perfil para IA del docente. No se descontaron créditos.',
      { codigo: 'PERFIL_IA_INCOMPLETO' })
  }

  const configSnap = await db.doc(`subjects/${subjectId}/asistenteIA/config`).get()
  const programaEstudios = await requerirProgramaEstudios(db, subjectId, configSnap)

  // Fuentes del curso: opcionales, complementarias al programa (que ya es
  // obligatorio y se manda primero — ver requerirProgramaEstudios).
  const fuentesSnap = await db.collection('fuentesAsignatura')
    .where('asignaturaId', '==', subjectId)
    .where('ubicacion', '==', 'general')
    .get()
  const fuentes = fuentesSnap.docs.map((d) => {
    const data = d.data()
    return { id: d.id, ...data, creadoEnMillis: data.creadoEn?.toMillis?.() || 0 }
  })
  const seleccionadas = seleccionarFuentesGenerales(fuentes)
  const bloqueFuentes = await fuentesIA.prepararBloqueFuentes([programaEstudios.url, ...seleccionadas.map((f) => f.url)])
  const comentariosGrupoTexto = comentariosGrupoATexto(configSnap.data()?.comentariosGrupo)

  return {
    asignaturaNombre: String(subj.nombre || '').trim().slice(0, 120),
    perfilIATexto: perfilIATexto(perfilIA),
    comentariosGrupoTexto,
    bloqueFuentes,
    fuentesUsadas: [{ id: 'programa', nombre: programaEstudios.nombre }, ...seleccionadas.map((f) => ({ id: f.id, nombre: String(f.nombre || '').slice(0, 200) }))],
  }
}

// Diagnóstico de CONTEXTO (corrección de Kike, 12-ago-2026, Tanda 2): igual
// que conocimientos — ya no es un reporte simulado. El cliente crea PRIMERO
// una actividad real (categoria 'cuestionario', sinCalificacion:true,
// diagnosticoTipo:'contexto', evaluacion.ponderarReactivos:false — es una
// ENCUESTA, sin "correcta") y esta operación llena su instrumento
// (10 a 15 preguntas, la IA decide cuántas dentro de ese rango).
async function precheckDiagnosticoContexto({ uid, params }) {
  const db = getFirestore()
  const actividadId = String(params?.actividadId || '')
  if (!actividadId) throw new HttpsError('invalid-argument', 'Falta la actividad ya creada')

  const snap = await db.doc(`activities/${actividadId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'La actividad no existe')
  const act = snap.data()
  if (act.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta actividad no es tuya')
  if (act.categoria !== 'cuestionario' || act.diagnosticoTipo !== 'contexto') {
    throw new HttpsError('failed-precondition', 'Esta actividad no es un diagnóstico de contexto')
  }

  const base = await precheckDiagnosticoBase({ uid, subjectId: act.asignaturaId })
  // Corrección de Kike (12-ago-2026): ahora el docente SÍ elige cuántas
  // preguntas (10-15, antes las decidía la IA sola) y puede orientar el
  // instrumento con un texto libre opcional — mismo principio que "¿qué
  // quieres evaluar?" en crear_evaluacion_ia, pero opcional: sin él, la IA
  // se guía solo por Perfil/fuentes/comentarios como hasta ahora.
  const cantidad = clampInt(params?.cantidad, MIN_PREGUNTAS_CONTEXTO, MIN_PREGUNTAS_CONTEXTO, MAX_PREGUNTAS_CONTEXTO)
  const queQuieresIndagar = String(params?.queQuieresIndagar || '').trim().slice(0, 500)
  return { ...base, actividadId, cantidad, queQuieresIndagar }
}

// Diagnóstico de CONOCIMIENTOS (corrección de Kike, 12-ago-2026): ya no es
// un reporte — el cliente crea PRIMERO una actividad real (categoria
// 'cuestionario', sinCalificacion:true, diagnosticoTipo:'conocimientos',
// borrador) y esta operación llena sus preguntas/clave, igual que
// crear_evaluacion_ia. `cantidad` la elige el docente (antes la decidía la
// IA sola).
async function precheckDiagnosticoConocimientos({ uid, params }) {
  const db = getFirestore()
  const actividadId = String(params?.actividadId || '')
  if (!actividadId) throw new HttpsError('invalid-argument', 'Falta la actividad ya creada')

  const snap = await db.doc(`activities/${actividadId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'La actividad no existe')
  const act = snap.data()
  if (act.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta actividad no es tuya')
  if (act.categoria !== 'cuestionario' || act.diagnosticoTipo !== 'conocimientos') {
    throw new HttpsError('failed-precondition', 'Esta actividad no es un diagnóstico de conocimientos')
  }

  const base = await precheckDiagnosticoBase({ uid, subjectId: act.asignaturaId })
  const cantidad = clampInt(params?.cantidad, MIN_REACTIVOS_DIAGNOSTICO, MIN_REACTIVOS_DIAGNOSTICO, MAX_REACTIVOS_DIAGNOSTICO)

  return { ...base, actividadId, cantidad }
}

const DIAGNOSTICO_SISTEMA =
  'Eres el asistente pedagógico de Evalúa Fácil y trabajas dentro de la asignatura de un ' +
  'docente de bachillerato mexicano. Tu papel en ESTE paso es informar, NUNCA planear: no ' +
  'propongas actividades, evaluaciones, calificaciones ni planeación didáctica — eso ocurre en ' +
  'un paso posterior distinto. Usa EXCLUSIVAMENTE el perfil del docente y los documentos de ' +
  'fuente que se te dan; no inventes información del grupo que no esté ahí. Si algo no está ' +
  'disponible, dilo con la frase exacta "Información no disponible en las fuentes ' +
  'proporcionadas." en vez de inventarlo. Escribe en español, claro y breve. Responde ' +
  'únicamente con el JSON del esquema indicado, sin texto adicional.'

function normalizarListaTexto(arr, max = 10, maxLen = 220) {
  return (Array.isArray(arr) ? arr : [])
    .map((s) => String(s || '').trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, max)
}

// Rango dentro del cual el docente elige cantidad (corrección de Kike,
// 12-ago-2026): antes la decidía la IA sola; ahora es exacta, como en
// conocimientos — ver precheckDiagnosticoContexto.
const MIN_PREGUNTAS_CONTEXTO = 10
const MAX_PREGUNTAS_CONTEXTO = 15

// El instrumento combina opcion_multiple (detecta patrones estructurados) y
// respuesta_corta (el estudiante se expresa con sus palabras) — SIN
// "correcta": es una encuesta, no algo calificable. Mismo campo
// `textoRespuesta` que ya usa el proyecto para respuesta_corta
// (EvaluacionRunner.jsx) — no se inventa un tipo de reactivo nuevo. También
// pide nombre + instrucciones de la actividad (corrección de Kike,
// 13-ago-2026: toda actividad generada con IA debe traer su nombre y sus
// instrucciones ya escritos — el docente decide después si los deja o los
// edita, mismo criterio que OP-05/crear_actividad_ia).
function promptInstrumentoContexto(ctx) {
  return (
    `Asignatura: ${ctx.asignaturaNombre || 'la asignatura del docente'} (educación media superior mexicana).\n\n` +
    `PERFIL DEL DOCENTE (para dar tono y enfoque a las preguntas — no es fuente de respuestas):\n${ctx.perfilIATexto}\n\n` +
    `COMENTARIOS DEL DOCENTE SOBRE EL GRUPO Y SU ENTORNO (para orientar qué preguntar, no para ` +
    `responder por los estudiantes):\n${ctx.comentariosGrupoTexto}\n\n` +
    (ctx.bloqueFuentes ? `${ctx.bloqueFuentes}\n\n` : '') +
    (ctx.queQuieresIndagar
      ? `QUÉ QUIERE INDAGAR EL DOCENTE EN PARTICULAR (dale prioridad, pero sin descuidar las 5 áreas ` +
        `de abajo):\n"""${ctx.queQuieresIndagar}"""\n\n`
      : '') +
    'Vas a construir un INSTRUMENTO DE DIAGNÓSTICO DE CONTEXTO: un cuestionario que los propios ' +
    'estudiantes van a contestar sobre sí mismos y su entorno. TÚ NO conoces sus respuestas — tu única ' +
    'tarea aquí es diseñar buenas preguntas, no inventar ni asumir lo que van a responder.\n\n' +
    `Genera EXACTAMENTE ${ctx.cantidad} preguntas que investiguen:\n` +
    '1. Características relevantes del grupo.\n' +
    '2. Condiciones del contexto que puedan afectar su aprendizaje (acceso a recursos, tiempo, etc.).\n' +
    '3. Intereses y motivadores.\n' +
    '4. Necesidades o situaciones que el docente debería considerar.\n' +
    '5. Aspectos del entorno que puedan influir en su participación.\n\n' +
    'Reglas de redacción:\n' +
    '- Lenguaje apropiado para estudiantes de bachillerato: cercano y claro, NUNCA como encuesta administrativa.\n' +
    '- Combina opción múltiple (para detectar patrones) con ALGUNAS de respuesta breve (para que el ' +
    'estudiante se exprese con sus palabras) — no conviertas todas en preguntas abiertas.\n' +
    '- PROHIBIDO preguntar o inferir diagnósticos médicos, trastornos psicológicos, información sexual, ' +
    'política, religiosa, antecedentes legales, el monto exacto de ingresos o carencias económicas de la ' +
    'familia, o cualquier dato sensible sin utilidad pedagógica directa. Si necesitas saber sobre acceso a ' +
    'recursos (internet, computadora, tiempo), pregúntalo en términos de disponibilidad ("¿tienes acceso ' +
    'a...?"), nunca pidiendo cifras de ingresos o gastos familiares.\n' +
    '- No etiquetes al estudiante ni asumas problemas — pregunta siempre de forma neutral y respetuosa.\n\n' +
    'Además, escribe un NOMBRE breve para esta actividad y unas INSTRUCCIONES GENERALES cortas que verá ' +
    'el estudiante antes de contestar (qué se le pide, y que no hay respuestas correctas o incorrectas — ' +
    'que conteste con honestidad).\n\n' +
    'Responde SOLO con este JSON:\n' +
    '{\n' +
    '  "nombre": "<máx 120 caracteres>",\n' +
    '  "instruccionesHtml": "<instrucciones generales, HTML simple>",\n' +
    '  "preguntas": [\n' +
    '    {"tipo": "opcion_multiple o respuesta_corta", "enunciado": "<máx 300 caracteres>", ' +
    '"opciones": ["<solo si opcion_multiple, 3 a 4 opciones>", "..."]}\n' +
    '  ]\n}'
  )
}

// Sin `ctx.tipos` fijo (a diferencia de normalizarReactivos): aquí la IA
// decide, por pregunta, opcion_multiple o respuesta_corta, y CUÁNTAS
// preguntas en total (dentro del rango que ya acota el prompt) — se
// normaliza tal cual vino y se descarta lo inválido. Nunca hay "correcta":
// es una encuesta.
function normalizarPreguntasContexto(crudos) {
  return (Array.isArray(crudos) ? crudos : [])
    .slice(0, MAX_PREGUNTAS_CONTEXTO)
    .map((r) => {
      const tipo = r?.tipo === 'respuesta_corta' ? 'respuesta_corta' : 'opcion_multiple'
      const enunciado = String(r?.enunciado || '').trim().slice(0, 300)
      if (tipo === 'opcion_multiple') {
        const opciones = (Array.isArray(r.opciones) ? r.opciones : [])
          .map((o) => String(o || '').trim().slice(0, 200))
          .filter(Boolean)
          .slice(0, 4)
        return { tipo, enunciado, opciones }
      }
      return { tipo, enunciado }
    })
    .filter((r) => r.enunciado && (r.tipo !== 'opcion_multiple' || r.opciones.length >= 2))
}

// Escribe DIRECTO en activities/{id}/preguntas + clave (Admin SDK), mismo
// patrón que ejecutarDiagnosticoConocimientos/ejecutarCrearEvaluacion — la
// actividad ya existe (la creó el cliente, ver precheckDiagnosticoContexto)
// y nace oculta: el docente la revisa/edita/publica como cualquier
// cuestionario. `clave.respuestaCorrecta` SIEMPRE null: es una encuesta.
async function ejecutarDiagnosticoContexto({ params, modelo, apiKey }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const ctx = params.__contexto // lo puso el precheck; el cliente no puede tocarlo
  const actividadId = ctx.actividadId

  const { datos, interno } = await pedirJSON({
    client, modelo, maxTokens: 6000, system: DIAGNOSTICO_SISTEMA,
    prompt: promptInstrumentoContexto(ctx),
  })

  const preguntas = normalizarPreguntasContexto(datos?.preguntas)
  // Regla de no invención (T.7) + requisito de Kike: menos de 10 preguntas
  // utilizables no es un instrumento aceptable — esto NO se cobra (cae al
  // catch del callable, que reembolsa la reserva).
  if (preguntas.length < MIN_PREGUNTAS_CONTEXTO) {
    throw new Error('El asistente de IA no generó un instrumento de diagnóstico de contexto utilizable')
  }

  const ponderaciones = repartirPonderacion(preguntas.length)
  const db = getFirestore()
  const batch = db.batch()
  preguntas.forEach((r, i) => {
    const pregRef = db.collection(`activities/${actividadId}/preguntas`).doc()
    const claveRef = db.collection(`activities/${actividadId}/clave`).doc(pregRef.id)
    const base = {
      tipo: r.tipo, enunciado: r.enunciado, ponderacion: ponderaciones[i],
      retroalimentacion: null, imagenUrl: null, orden: i, origenBancoId: null,
    }
    if (r.tipo === 'opcion_multiple') {
      batch.set(pregRef, { ...base, opciones: r.opciones.map((texto) => ({ id: idOpcion(), texto })) })
    } else {
      batch.set(pregRef, { ...base, opciones: null })
    }
    batch.set(claveRef, { respuestaCorrecta: null, respuestaEsperada: null })
  })
  await batch.commit()
  // Nombre + instrucciones también los propone la IA (corrección de Kike,
  // 13-ago-2026) — solo se sobrescriben si sí vinieron, nunca se pisa con
  // vacío lo que ya hubiera.
  const nombre = String(datos?.nombre || '').trim().slice(0, 120)
  const instruccionesHtml = sanitizarInstruccionesHtml(datos?.instruccionesHtml)
  const updateActividad = { evaluacion: { numPreguntas: preguntas.length } }
  if (nombre) updateActividad.nombre = nombre
  if (instruccionesHtml) updateActividad.instrucciones = instruccionesHtml
  await db.doc(`activities/${actividadId}`).set(updateActividad, { merge: true })

  return {
    resultado: { actividadId, cantidad: preguntas.length },
    unidadesReales: 1, // tarifa FIJA (5 créditos), sin importar cuántas preguntas elija el docente (10-15)
    interno,
  }
}

// Corrección de Kike (12-ago-2026): la cantidad la elige el docente
// (`ctx.cantidad`, validada por precheckDiagnosticoConocimientos), ya no la
// decide la IA sola — y son SIEMPRE opcion_multiple (antes también podía
// meter verdadero_falso). Mismo esquema de "reactivos" que
// promptCrearEvaluacion, a propósito: así se reutiliza normalizarReactivos
// tal cual, sin duplicar esa lógica.
function promptDiagnosticoConocimientos(ctx) {
  return (
    `Asignatura: ${ctx.asignaturaNombre || 'la asignatura del docente'} (bachillerato).\n\n` +
    `PERFIL DEL DOCENTE:\n${ctx.perfilIATexto}\n\n` +
    (ctx.bloqueFuentes ? `${ctx.bloqueFuentes}\n\n` : '') +
    'Con base ÚNICAMENTE en los documentos de fuente (programa/materiales de la asignatura), ' +
    'construye un DIAGNÓSTICO DE CONOCIMIENTOS: un cuestionario breve que el docente aplicará al ' +
    'grupo antes de empezar, para saber qué conocimientos previos ya tienen — es una fotografía ' +
    'inicial, no un examen grande. No inventes temas que no estén en los documentos de fuente.\n\n' +
    `Genera EXACTAMENTE ${ctx.cantidad} reactivos de opción múltiple (4 opciones cada uno, una sola ` +
    'correcta), cubriendo la mayor variedad posible de los temas encontrados en las fuentes.\n\n' +
    'Además, escribe un NOMBRE breve para esta actividad y unas INSTRUCCIONES GENERALES cortas que verá ' +
    'el estudiante antes de contestar (qué se le pide y que es un diagnóstico inicial, no un examen).\n\n' +
    'Responde SOLO con este JSON:\n' +
    '{\n' +
    '  "nombre": "<máx 120 caracteres>",\n' +
    '  "instruccionesHtml": "<instrucciones generales, HTML simple>",\n' +
    '  "reactivos": [\n' +
    '    {"tipo": "opcion_multiple", "enunciado": "<máx 400 caracteres>", ' +
    '"opciones": ["<opción>", "..."], "correcta": "<índice 0-3 de la opción correcta>"}\n' +
    '  ]\n}'
  )
}

// Escribe DIRECTO en activities/{id}/preguntas + clave (Admin SDK), mismo
// patrón que ejecutarCrearEvaluacion — la actividad ya existe (la creó el
// cliente antes de llamar, ver precheckDiagnosticoConocimientos) y nace
// oculta: el docente la revisa/edita/publica como cualquier cuestionario.
async function ejecutarDiagnosticoConocimientos({ params, modelo, apiKey }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const ctx = params.__contexto // lo puso el precheck; el cliente no puede tocarlo
  const actividadId = ctx.actividadId

  const tipos = Array.from({ length: ctx.cantidad }, () => 'opcion_multiple')
  const { datos, interno } = await pedirJSON({
    client, modelo, maxTokens: Math.min(8000, 350 * ctx.cantidad + 400), system: DIAGNOSTICO_SISTEMA,
    prompt: promptDiagnosticoConocimientos(ctx),
  })

  const reactivos = normalizarReactivos(datos, { tipos }).filter((r) => r.enunciado)
  // Regla de no invención (T.7): sin reactivos aprovechables, esto NO se
  // cobra (cae al catch del callable, que reembolsa la reserva).
  if (!reactivos.length) {
    throw new Error('El asistente de IA no generó un diagnóstico de conocimientos utilizable')
  }

  const ponderaciones = repartirPonderacion(reactivos.length)
  const db = getFirestore()
  const batch = db.batch()
  reactivos.forEach((r, i) => {
    const pregRef = db.collection(`activities/${actividadId}/preguntas`).doc()
    const claveRef = db.collection(`activities/${actividadId}/clave`).doc(pregRef.id)
    const opciones = r.opciones.map((texto) => ({ id: idOpcion(), texto }))
    batch.set(pregRef, {
      tipo: 'opcion_multiple', enunciado: r.enunciado, ponderacion: ponderaciones[i],
      retroalimentacion: null, imagenUrl: null, orden: i, origenBancoId: null, opciones,
    })
    batch.set(claveRef, { respuestaCorrecta: opciones[r.correcta]?.id ?? opciones[0]?.id ?? null, respuestaEsperada: null })
  })
  await batch.commit()
  // Nombre + instrucciones también los propone la IA (corrección de Kike,
  // 13-ago-2026) — solo se sobrescriben si sí vinieron.
  const nombre = String(datos?.nombre || '').trim().slice(0, 120)
  const instruccionesHtml = sanitizarInstruccionesHtml(datos?.instruccionesHtml)
  const updateActividad = { evaluacion: { numPreguntas: reactivos.length } }
  if (nombre) updateActividad.nombre = nombre
  if (instruccionesHtml) updateActividad.instrucciones = instruccionesHtml
  await db.doc(`activities/${actividadId}`).set(updateActividad, { merge: true })

  return {
    resultado: { actividadId, cantidad: reactivos.length },
    unidadesReales: 1, // tarifa FIJA (Kike, 12-ago-2026), sin importar la cantidad elegida
    interno,
  }
}

// ── Planeación Didáctica Inicial (FASE 2-BIS, apartado 3 de Asistente IA,
// 12-ago-2026) — última pieza de la secuencia: Perfil IA → Fuentes generales
// → Diagnóstico de contexto → Diagnóstico de conocimientos → Planeación.
// Genera una PROPUESTA llenando una plantilla Word real, una vez por cada
// parcial de la asignatura (decisión de Kike, 15-ago-2026 — antes eran 9
// campos fijos armados en un .xlsx; ver src/utils/planeacionWord.js para el
// .docx bundleado que usa esta operación cuando no hay plantilla oficial) —
// no sustituye el formato oficial de la escuela, no crea
// actividades/exámenes/cuestionarios, y no se aprueba automáticamente.
// Tarifa (Kike, 12-ago-2026): 20 créditos fijos, una sola operación cubre
// TODOS los parciales reales de la asignatura (aunque sean N llamadas).

const DIAS_SEMANA_LARGO = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

// Texto legible de las sesiones reales de un parcial (una línea por sesión,
// "Sesión N — día fecha"), para inyectar como restricción temporal en el
// prompt de promptSecuenciasParcial. NO recalcula nada — `sesionesReales` ya
// viene resuelta por calcularSesionesReales() vía construirParcialesCtx();
// esto solo la formatea para el modelo.
function formatoSesionesReales(sesionesReales) {
  return sesionesReales.map((s) => {
    const d = new Date(s.fecha + 'T12:00:00')
    const fechaTexto = Number.isNaN(d.getTime())
      ? s.fecha
      : `${DIAS_SEMANA_LARGO[s.diaSemana] || ''} ${d.getDate()} de ${d.toLocaleDateString('es-MX', { month: 'long' })}`.trim()
    return `Sesión ${s.numeroSesionParcial} — ${fechaTexto}`
  }).join('\n')
}

function formatoPeriodo(fechas) {
  if (!fechas?.inicio || !fechas?.fin) return null
  const fmt = (iso) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const ini = fmt(fechas.inicio)
  const fin = fmt(fechas.fin)
  return ini && fin ? `${ini} – ${fin}` : null
}

// Corrección de Kike (12-ago-2026, Tanda 2): el diagnóstico de contexto ya
// es un cuestionario REAL que contestan los estudiantes — `resultado` ahora
// es la salida de normalizarAnalisisEncuestaContexto (OP-10 en modo
// encuesta), resultados de verdad sobre el grupo, no un reporte inferido
// solo de fuentes/Perfil.
function diagnosticoContextoATexto(resultado) {
  if (!resultado) return 'Información no disponible en las fuentes proporcionadas.'
  const bloque = (titulo, items) => (items?.length ? `${titulo}:\n- ${items.join('\n- ')}` : null)
  const partes = [
    bloque('Características relevantes del grupo', resultado.caracteristicas),
    bloque('Condiciones de contexto detectadas', resultado.condiciones),
    bloque('Intereses y motivadores', resultado.intereses),
    bloque('Necesidades identificadas', resultado.necesidades),
    resultado.patrones?.length
      ? `Patrones relevantes:\n- ${resultado.patrones.map((p) => `${p.observacion}${p.interpretacion ? ` — ${p.interpretacion}` : ''}`).join('\n- ')}`
      : null,
    bloque('Recomendaciones pedagógicas', resultado.recomendaciones),
  ].filter(Boolean)
  return partes.length ? partes.join('\n\n') : 'Información no disponible en las fuentes proporcionadas.'
}

// Corrección de Kike (12-ago-2026): el diagnóstico de conocimientos ya es un
// cuestionario REAL que contestan los estudiantes — `resultado` ahora es la
// salida de normalizarAnalisis (OP-10, ver ejecutarAnalisisResultados),
// resultados de verdad del grupo, no un instrumento sin aplicar.
function diagnosticoConocimientosATexto(resultado) {
  if (!resultado) return 'Información no disponible en las fuentes proporcionadas.'
  const partes = []
  if (resultado.resumenGeneral) partes.push(`Resumen: ${resultado.resumenGeneral}`)
  if (Number.isFinite(resultado.porcentajeAciertosGeneral)) {
    partes.push(`Aciertos generales del grupo en el diagnóstico: ${resultado.porcentajeAciertosGeneral}%`)
  }
  if (resultado.patrones?.length) {
    partes.push(`Patrones detectados:\n- ${resultado.patrones.map((p) => `${p.observacion}${p.interpretacion ? ` — ${p.interpretacion}` : ''}`).join('\n- ')}`)
  }
  if (resultado.reactivosDificiles?.length) {
    partes.push(`Temas con más dificultad para el grupo:\n- ${resultado.reactivosDificiles.map((r) => r.enunciado).join('\n- ')}`)
  }
  if (resultado.recomendaciones?.length) {
    partes.push(`Recomendaciones del diagnóstico:\n- ${resultado.recomendaciones.join('\n- ')}`)
  }
  return partes.length ? partes.join('\n\n') : 'Información no disponible en las fuentes proporcionadas.'
}

// Cuenta cuántas actividades de diagnóstico de un tipo tiene la asignatura
// (revisadas o no, publicadas o no — cualquiera con ese `diagnosticoTipo`).
// Regla de Kike (13-ago-2026): el docente puede generar y revisar varios
// diagnósticos, pero para Planeación debe quedar UNO SOLO de cada tipo — si
// hay más de uno, Planeación se detiene hasta que borre los que sobran.
async function contarActividadesDiagnostico(db, subjectId, tipo) {
  const snap = await db.collection('activities')
    .where('asignaturaId', '==', subjectId)
    .where('diagnosticoTipo', '==', tipo)
    .get()
  return snap.size
}

// Busca la actividad de diagnóstico (marcada `diagnosticoTipo`) más reciente
// de la asignatura que YA tenga un análisis de IA (activities/{id}/analisisIA
// — mismo lugar donde OP-10 guarda su bitácora, ver EvaluacionManager.jsx).
// Sin análisis, no hay nada real que leer todavía: Planeación se detiene
// hasta que el docente publique el cuestionario, sus estudiantes lo
// contesten, y lo analice con IA — nunca se inventa un resultado.
async function analisisDiagnosticoMasReciente(db, subjectId, tipo) {
  const actsSnap = await db.collection('activities')
    .where('asignaturaId', '==', subjectId)
    .where('diagnosticoTipo', '==', tipo)
    .get()
  const actividades = actsSnap.docs
    .map((d) => ({ id: d.id, createdAtMillis: d.data().createdAt?.toMillis?.() || 0 }))
    .sort((a, b) => b.createdAtMillis - a.createdAtMillis)
  for (const act of actividades) {
    const analisisSnap = await db.collection(`activities/${act.id}/analisisIA`).get()
    if (analisisSnap.empty) continue
    const masReciente = analisisSnap.docs
      .map((d) => ({ ...d.data(), generadoEnMillis: d.data().generadoEn?.toMillis?.() || 0 }))
      .sort((a, b) => b.generadoEnMillis - a.generadoEnMillis)[0]
    if (masReciente) return masReciente.resultado
  }
  return null
}

// Detalle por alumno (nombre, quién entregó cada actividad y su calificación)
// — SOLO para el Chat por asignatura, nunca para el Asistente General ni para
// el análisis con IA (OP-10), que se quedan agregados/anónimos. Decisión
// explícita de Kike (19-ago-2026): esto no es un dato privado frente al
// propio docente — es exactamente lo que ya ve en su pestaña Actividades, así
// que el chat debe poder contestarlo igual, con nombre.
// Tope de 20 actividades más recientes para no disparar el contexto en
// asignaturas con muchas actividades — si hay más, se avisa en el texto en
// vez de recortar en silencio.
const MAX_ACTIVIDADES_DETALLE_ALUMNO = 20
function nombreAlumno(s) {
  return [s?.apellidoPaterno, s?.apellidoMaterno, s?.nombre].filter(Boolean).join(' ').trim() || s?.username || '(sin nombre)'
}
async function detalleAlumnosTexto(db, subjectId) {
  const studentsSnap = await db.collection('students').where('asignaturaId', '==', subjectId).get()
  const alumnos = studentsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => !s.ocultaPorAlumno)
  if (!alumnos.length) return ''

  const rosterTexto = `Alumnos inscritos (${alumnos.length}): ` +
    alumnos.map((s) => `${nombreAlumno(s)} (usuario ${s.username}, ${s.activado ? 'cuenta activa' : 'sin activar todavía'})`).join('; ') + '.'

  const actividadesSnap = await db.collection('activities').where('asignaturaId', '==', subjectId).get()
  const todasActividades = actividadesSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
  if (!todasActividades.length) return rosterTexto

  const truncado = todasActividades.length > MAX_ACTIVIDADES_DETALLE_ALUMNO
  const actividades = todasActividades.slice(0, MAX_ACTIVIDADES_DETALLE_ALUMNO)

  const submissionsPorActividad = await Promise.all(
    actividades.map((act) => db.collection('submissions').where('actividadId', '==', act.id).get())
  )

  const lineasActividades = actividades.map((act, i) => {
    const subsPorAlumno = {}
    submissionsPorActividad[i].docs.forEach((d) => { subsPorAlumno[d.data().alumnoId] = d.data() })
    const detalle = alumnos.map((al) => {
      const sub = subsPorAlumno[al.id]
      if (!sub) return `${nombreAlumno(al)}: sin entregar`
      if (Number.isFinite(sub.calificacion)) {
        return `${nombreAlumno(al)}: entregó, calificación ${sub.calificacion}${act.maxCalif ? `/${act.maxCalif}` : ''}`
      }
      return `${nombreAlumno(al)}: entregó, sin calificar todavía`
    }).join('; ')
    return `"${act.nombre || '(sin nombre)'}"${act.diagnosticoTipo ? ` [diagnóstico de ${act.diagnosticoTipo}]` : ''} — ${detalle}`
  })

  return rosterTexto + '\n\n' +
    `Detalle por actividad, quién entregó y quién no (con nombre y calificación cuando aplica)` +
    (truncado ? ` — se muestran solo las ${MAX_ACTIVIDADES_DETALLE_ALUMNO} actividades más recientes de ${todasActividades.length} totales` : '') +
    `:\n${lineasActividades.join('\n\n')}`
}

// CONSULTA para el Asistente con Acciones (26-ago-2026, MVP): cuántas
// evaluaciones de IA YA GENERADAS siguen 'pendiente' de aplicarse como
// calificación real — el mismo dato que ya calcula "Aplicar calificaciones
// de IA a todas" en el panel de la actividad, aquí resumido por asignatura
// para que el Asistente pueda RESPONDER la pregunta sin proponer nada
// todavía (proponer ejecutar viene después, solo si el docente lo pide — ver
// INSTRUCCION_ACCIONES_CHAT). Nunca se usa este texto para decidir qué se
// aplica al confirmar — eso se recalcula desde cero en
// confirmarChatAplicarEvaluacionesIA, contra Firestore, en ese momento.
async function pendientesEvaluacionesIATexto(db, subjectId) {
  const actsSnap = await db.collection('activities')
    .where('asignaturaId', '==', subjectId).where('categoria', '==', 'entregable').get()
  if (actsSnap.empty) return 'No hay evaluaciones de IA pendientes de aplicar en esta asignatura.'
  // Mismo tope que detalleAlumnosTexto — mismo orden de magnitud de
  // actividades por asignatura, mismo criterio de costo aceptado ahí.
  const actividades = actsSnap.docs.slice(0, MAX_ACTIVIDADES_DETALLE_ALUMNO)
  const porActividad = await Promise.all(actividades.map(async (d) => {
    const pendSnap = await db.collection(`activities/${d.id}/iaSugerenciasEntregable`)
      .where('estado', '==', 'pendiente').get()
    return { nombre: String(d.data().nombre || '').trim() || '(sin nombre)', cantidad: pendSnap.size }
  }))
  const conPendientes = porActividad.filter((a) => a.cantidad > 0)
  const total = conPendientes.reduce((s, a) => s + a.cantidad, 0)
  if (!total) return 'No hay evaluaciones de IA pendientes de aplicar en esta asignatura.'
  return `Evaluaciones de IA ya generadas y pendientes de aplicar como calificación real (${total} en total, ` +
    `esto es SOLO información — la cantidad exacta se recalcula al confirmar): ` +
    conPendientes.map((a) => `"${a.nombre}" — ${a.cantidad}`).join('; ') + '.'
}

// Cuántas Secuencias Didácticas puede pedir el docente explícitamente antes
// de generar (ver PlaneacionInicialSection.jsx) — un tope razonable para no
// disparar el gasto de tokens ni pedirle a la IA algo absurdo.
const MAX_SECUENCIAS_SOLICITADAS = 12

function validarCantidadSolicitada(params) {
  const n = Number(params?.cantidadSecuencias)
  if (!Number.isFinite(n) || n < 1) return null
  return Math.min(Math.round(n), MAX_SECUENCIAS_SOLICITADAS)
}

// Lista de parciales reales de la asignatura con su periodo en texto —
// compartida por ambas operaciones: cada parcial genera SU PROPIO documento
// (misma plantilla, contenido distinto), decisión de Kike, 15-ago-2026.
// `diasAsueto`/`sesionesCanceladas` ya vienen combinados por quien llama
// (precheckPlaneacionInicial) — misma responsabilidad que ya tienen esos dos
// parámetros en calcularSesionesReales(), esta función no lee Firestore.
//
// `sesionesReales` solo se agrega cuando la asignatura YA tiene horarioPatron
// guardado — si no, el parcial se queda igual que antes (solo periodoTexto):
// sin horario no hay nada que calcular, y no se bloquea ni se inventa uno.
// El prompt (promptSecuenciasParcial) NO usa todavía este dato — queda
// disponible en el contexto para una integración posterior.
function construirParcialesCtx(subj, { diasAsueto = [], sesionesCanceladas = [] } = {}) {
  const numParciales = Math.max(1, Number(subj.parciales) || 1)
  const parcialesFechas = Array.isArray(subj.parcialesFechas) ? subj.parcialesFechas : []
  const horarioPatron = Array.isArray(subj.horarioPatron) ? subj.horarioPatron : []
  const parciales = []
  for (let p = 1; p <= numParciales; p++) {
    const ctx = { numero: p, periodoTexto: formatoPeriodo(parcialesFechas[p - 1]) }
    if (horarioPatron.length && subj.fechaInicio && subj.fechaFin) {
      const { sesiones } = calcularSesionesReales({
        fechaInicio: subj.fechaInicio, fechaFin: subj.fechaFin,
        parcialesFechas, horarioPatron, diasAsueto, sesionesCanceladas, parcial: p,
      })
      if (sesiones.length) ctx.sesionesReales = sesiones
    }
    parciales.push(ctx)
  }
  return parciales
}

// Precheck: valida la secuencia completa SIN gastar un crédito y arma el
// contexto por parcial (fuentes generales + fuentes específicas de CADA
// parcial, según §5 del apartado). Comparte perfilIACompleto/perfilIATexto/
// seleccionarFuentesGenerales con el precheck de Diagnóstico del grupo.
async function precheckPlaneacionInicial({ uid, params }) {
  const db = getFirestore()
  const subjectId = String(params?.subjectId || '').trim()
  if (!subjectId) throw new HttpsError('invalid-argument', 'Falta la asignatura.')

  const subjSnap = await db.doc(`subjects/${subjectId}`).get()
  if (!subjSnap.exists) throw new HttpsError('not-found', 'La asignatura no existe')
  const subj = subjSnap.data()
  if (subj.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta asignatura no es tuya')

  // El ÚNICO insumo obligatorio es el programa de estudios (fuentes
  // generales) — todo lo demás (Perfil IA, comentarios del grupo,
  // autoanálisis, ambos diagnósticos) es opcional: el docente marca en
  // pantalla cuáles quiere incluir, y si marca uno, ese sí tiene que estar
  // listo (si no, se detiene con el mismo error de siempre). Lo que NO marca
  // simplemente no se manda a la IA — decisión de Kike, 14-ago-2026.
  const incluir = {
    comentarios: params?.incluir?.comentarios === true,
    autoanalisis: params?.incluir?.autoanalisis === true,
    consideraciones: params?.incluir?.consideraciones === true,
    diagContexto: params?.incluir?.diagContexto === true,
    diagConocimientos: params?.incluir?.diagConocimientos === true,
  }

  // El Perfil IA del docente SIEMPRE se incluye (ya no es opcional vía
  // casilla, decisión de Kike, 15-ago-2026): acceder a "Config Asistente
  // IA" de cualquier asignatura ya exige tenerlo completo (ver
  // perfilIACompleto en SubjectPage.jsx, que oculta la pestaña entera si
  // falta), así que no tiene sentido dejarlo desmarcar aquí — es
  // imprescindible para una buena planeación. Esta revalidación server-side
  // es la que de verdad protege contra que se haya vuelto incompleto entre
  // que se abrió la pestaña y se generó.
  const perfilSnap = await db.doc(`users/${uid}`).get()
  const perfilIA = perfilSnap.data()?.perfilIA || null
  if (!perfilIACompleto(perfilIA)) {
    throw new HttpsError('failed-precondition',
      'Completa primero tu Perfil para IA del docente — es indispensable para generar la Planeación. ' +
      'No se descontaron créditos.',
      { codigo: 'PERFIL_IA_INCOMPLETO' })
  }
  const perfilIATextoVal = perfilIATexto(perfilIA)

  const programaEstudiosGen = await requerirProgramaEstudios(db, subjectId)

  const fuentesSnap = await db.collection('fuentesAsignatura').where('asignaturaId', '==', subjectId).get()
  const fuentes = fuentesSnap.docs.map((d) => {
    const data = d.data()
    return { id: d.id, ...data, creadoEnMillis: data.creadoEn?.toMillis?.() || 0 }
  })
  const generales = fuentes.filter((f) => f.ubicacion === 'general')

  // Diagnóstico de CONTEXTO (corrección de Kike, 12-ago-2026, Tanda 2): ya es
  // un cuestionario real — igual que conocimientos, el resultado que cuenta
  // es su análisis de IA sobre respuestas reales de los estudiantes
  // (activities/{id}/analisisIA, OP-10), NO el reporte simulado descartado
  // de subjects/{id}/diagnosticosIA.
  //
  // Regla de Kike (13-ago-2026): el docente puede generar y revisar varios
  // diagnósticos de contexto, pero para Planeación debe quedar UNO SOLO —
  // si hay más de uno (revisado o no), se detiene hasta que borre los que
  // sobran, para no dejarle a la IA ambigüedad sobre cuál usar. Esta
  // validación de "uno solo" aplica siempre que exista algún diagnóstico,
  // aunque el docente no lo haya marcado para incluir (evita que se le
  // acumulen diagnósticos ambiguos sin darse cuenta).
  const countContexto = await contarActividadesDiagnostico(db, subjectId, 'contexto')
  if (countContexto > 1) {
    throw new HttpsError('failed-precondition',
      `Tienes ${countContexto} Diagnósticos de contexto generados. Elimina los que no vayas a usar y deja ` +
      'solo uno antes de generar la Planeación Didáctica Inicial (Config Asistente IA → Diagnóstico del ' +
      'grupo). No se descontaron créditos.',
      { codigo: 'MULTIPLES_DIAGNOSTICO_CONTEXTO' })
  }
  let resultadoContexto = null
  if (incluir.diagContexto) {
    resultadoContexto = await analisisDiagnosticoMasReciente(db, subjectId, 'contexto')
    if (!resultadoContexto) {
      throw new HttpsError('failed-precondition',
        'Marcaste incluir el Diagnóstico de contexto, pero todavía no tiene resultados analizados — genera ' +
        'el instrumento, publícalo y analízalo con IA (Config Asistente IA → Diagnóstico del grupo), o ' +
        'desmarca esa casilla. No se descontaron créditos.',
        { codigo: 'SIN_DIAGNOSTICO_CONTEXTO' })
    }
  }

  // Diagnóstico de CONOCIMIENTOS (corrección de Kike, 12-ago-2026): ya es un
  // cuestionario real — el resultado que cuenta es su análisis de IA sobre
  // respuestas reales (activities/{id}/analisisIA, OP-10), no un reporte
  // simulado a partir de fuentes. Misma regla de "uno solo" que contexto.
  const countConocimientos = await contarActividadesDiagnostico(db, subjectId, 'conocimientos')
  if (countConocimientos > 1) {
    throw new HttpsError('failed-precondition',
      `Tienes ${countConocimientos} Diagnósticos de conocimientos generados. Elimina los que no vayas a usar ` +
      'y deja solo uno antes de generar la Planeación Didáctica Inicial (Config Asistente IA → Diagnóstico ' +
      'del grupo). No se descontaron créditos.',
      { codigo: 'MULTIPLES_DIAGNOSTICO_CONOCIMIENTOS' })
  }
  let resultadoConocimientos = null
  if (incluir.diagConocimientos) {
    resultadoConocimientos = await analisisDiagnosticoMasReciente(db, subjectId, 'conocimientos')
    if (!resultadoConocimientos) {
      throw new HttpsError('failed-precondition',
        'Marcaste incluir el Diagnóstico de conocimientos, pero todavía no tiene resultados analizados — ' +
        'genera el cuestionario, publícalo y analízalo con IA (Config Asistente IA → Diagnóstico del grupo), ' +
        'o desmarca esa casilla. No se descontaron créditos.',
        { codigo: 'SIN_DIAGNOSTICO_CONOCIMIENTOS' })
    }
  }

  const bloqueFuentesGenerales = await fuentesIA.prepararBloqueFuentes(
    [programaEstudiosGen.url, ...seleccionarFuentesGenerales(generales).map((f) => f.url)]
  )
  const configSnap = await db.doc(`subjects/${subjectId}/asistenteIA/config`).get()
  const comentariosGrupoTexto = incluir.comentarios
    ? comentariosGrupoATexto(configSnap.data()?.comentariosGrupo)
    : ''
  const autoanalisisDocenteTexto = incluir.autoanalisis
    ? autoanalisisDocenteATexto(configSnap.data()?.autoanalisisDocente)
    : ''
  const consideracionesTexto = incluir.consideraciones
    ? consideracionesATexto(configSnap.data()?.consideraciones)
    : ''

  // La Planeación Inicial vive como estructura propia de Evalúa Fácil —
  // decisión de Kike, 16-ago-2026: ya no depende de ninguna plantilla que
  // haya que leer ni llenar, "secuenciasDidacticas[]" por cada parcial es
  // la fuente de la verdad; el Word solo se genera al descargar, aparte.
  const cantidadSolicitada = validarCantidadSolicitada(params)

  // Sesiones reales por parcial (calendario real de sesiones) — SOLO si la
  // asignatura ya tiene horarioPatron guardado, para no pagar lecturas de más
  // en cursos viejos sin horario programado (fallback: construirParcialesCtx
  // los deja igual que siempre, solo con periodoTexto). docenteId, no
  // asignaturaId: asuetos/vacaciones son del calendario del docente, aplican
  // a todas sus asignaturas — mismo criterio que ya usa el cliente
  // (CalendarPage.jsx/attendanceAuto.js).
  let diasAsueto = []
  let sesionesCanceladas = []
  if (Array.isArray(subj.horarioPatron) && subj.horarioPatron.length) {
    const [asuetosSnap, vacacionesSnap, bloquesSnap] = await Promise.all([
      db.collection('asuetos').where('docenteId', '==', uid).get(),
      db.collection('vacaciones').where('docenteId', '==', uid).get(),
      db.collection('horarioBloques').where('docenteId', '==', uid).where('asignaturaId', '==', subjectId).get(),
    ])
    diasAsueto = [
      ...asuetosSnap.docs.map((d) => d.data()).filter((a) => a.clases).map((a) => a.fecha),
      ...fechasVacacionParaClases(vacacionesSnap.docs.map((d) => d.data())),
    ]
    sesionesCanceladas = bloquesSnap.docs.map((d) => d.data()).filter((b) => b.cancelada)
      .map((b) => ({ fecha: b.fecha, horaInicio: b.horaInicio }))
  }

  // Las fuentes YA NO se agrupan por parcial (se quitó esa sección de la UI
  // el 13-ago-2026 — Diagnóstico y Planeación son eventos de una sola vez, al
  // arrancar el curso, antes de que exista ningún parcial cursado; un grupo
  // de fuentes "por parcial" nunca tuvo sentido ahí). Cada parcial usa el
  // mismo contexto general (fuentes + diagnósticos) — solo cambia su periodo.
  const parciales = construirParcialesCtx(subj, { diasAsueto, sesionesCanceladas })

  const unidadesMinimas = calcularUnidadesMinimasFuente(bloqueFuentesGenerales)

  return {
    asignaturaNombre: String(subj.nombre || '').trim().slice(0, 120),
    perfilIATexto: perfilIATextoVal,
    comentariosGrupoTexto,
    autoanalisisDocenteTexto,
    consideracionesTexto,
    bloqueFuentesGenerales,
    diagnosticoContextoTexto: incluir.diagContexto ? diagnosticoContextoATexto(resultadoContexto) : '',
    diagnosticoConocimientosTexto: incluir.diagConocimientos ? diagnosticoConocimientosATexto(resultadoConocimientos) : '',
    parciales,
    cantidadSolicitada,
    unidadesMinimas,
    fuentesUsadas: {
      generales: seleccionarFuentesGenerales(generales).map((f) => ({ id: f.id, nombre: String(f.nombre || '').slice(0, 200) })),
    },
  }
}

const PLANEACION_SISTEMA =
  REGLA_ACTIVIDADES_NO_DENIGRANTES +
  'Eres el asistente pedagógico de Evalúa Fácil y trabajas dentro de la asignatura de un ' +
  'docente de bachillerato mexicano. Tu papel es PROPONER una GUÍA DE TRABAJO sencilla y ' +
  'práctica — el docente siempre la revisa y decide qué usar; esto NO sustituye el formato ' +
  'oficial de su escuela ni se publica en ningún lado automáticamente. Usa el perfil del ' +
  'docente (su estilo de facilitar clase y sus habilidades deben notarse en la propuesta — no ' +
  'generes algo genérico que le serviría igual a cualquier profesor), los documentos de fuente ' +
  'y los diagnósticos ya generados. Basa el contenido (temas, aprendizajes, actividades reales) ' +
  'EXCLUSIVAMENTE en lo que aparece en las fuentes; si haces una propuesta pedagógica razonable ' +
  'que NO está respaldada literalmente por las fuentes, escríbela empezando con "Propuesta de ' +
  'IA:" para que quede claro que no es contenido oficial. Si algo no está disponible, usa la ' +
  'frase exacta "Información no disponible en las fuentes proporcionadas." en vez de inventarlo. ' +
  'El diagnóstico de conocimientos es solo un INSTRUMENTO aún sin aplicar: nunca afirmes que el ' +
  'grupo tiene una debilidad real que el diagnóstico no reportó como hallazgo. Los COMENTARIOS ' +
  'GENERALES DEL DOCENTE sobre el grupo y su entorno (cuando los haya) son observación directa ' +
  'suya, no una fuente documental — junto con los diagnósticos, son lo que MÁS debe pesar al ' +
  'decidir la estrategia, las actividades y el nivel de las propuestas (más que las fuentes): si ' +
  'el docente dice que el grupo apenas sabe sumar o casi no ha usado tecnología, la propuesta ' +
  'tiene que reflejarlo, no ignorarlo. El AUTOANÁLISIS DOCENTE (opcional, cuando lo haya) es sobre ' +
  'el docente mismo, no sobre el grupo: en los temas que domina o que se le facilita explicar, ' +
  'puedes proponer estrategias más ambiciosas o profundas; en los que necesita fortalecer o se le ' +
  'dificulta explicar, sugiere apoyos concretos (ejemplos más guiados, recursos de repaso para él ' +
  'mismo, actividades con pasos más explícitos) — nunca lo señales como una debilidad del docente, ' +
  'trátalo como información útil para ajustar el nivel de detalle de la propuesta. Escribe en ' +
  'español, claro y breve. Responde únicamente con el JSON del esquema indicado, sin texto adicional.'

// Campos de CADA Secuencia Didáctica — estructura propia de Evalúa Fácil
// que reproduce EXACTAMENTE el formato de referencia que Kike proporcionó
// (Planeacion_Didactica_Universal.docx, analizado 16-ago-2026): identidad
// de la secuencia + TRES momentos (Apertura/Desarrollo/Cierre), cada uno
// con su PROPIO juego completo de actividades/recursos/evaluación — no uno
// compartido por toda la Secuencia. Mismas listas en
// src/utils/planeacionDocx.js (el generador del Word) — se duplican a
// propósito, son runtimes distintos sin módulo compartido en este proyecto.
const CAMPOS_IDENTIDAD_SECUENCIA = [
  { clave: 'nombre', etiqueta: 'Nombre o tema' },
  { clave: 'aprendizajesEsperados', etiqueta: 'Aprendizajes esperados' },
  { clave: 'proposito', etiqueta: 'Propósito' },
  { clave: 'sesiones', etiqueta: 'Sesiones que abarca' },
  { clave: 'contenidosRelacionados', etiqueta: 'Contenidos relacionados' },
]
const MOMENTOS = ['apertura', 'desarrollo', 'cierre']
// Escala única de ponderación de un parcial completo — PORCENTAJE, en
// puntos ENTEROS, sin decimales (Kike, 17-ago-2026: "no quiero decimales
// en las ponderaciones" — la escala sigue siendo 100%, solo se corrigieron
// los decimales).
const PONDERACION_TOTAL = 100
const CAMPOS_MOMENTO = [
  { clave: 'actividades', etiqueta: 'Actividades de enseñanza-aprendizaje' },
  { clave: 'recursos', etiqueta: 'Recursos y materiales' },
  { clave: 'estrategiaEvaluacion', etiqueta: 'Estrategia de evaluación' },
  { clave: 'evidencias', etiqueta: 'Evidencias' },
  { clave: 'tipoInstrumento', etiqueta: 'Tipo de evaluación / instrumento' },
  { clave: 'ponderacion', etiqueta: 'Ponderación (%, número entero)' },
]
const FUENTES_INFORMACION_VACIAS = ['', '', '', '', '']

// ─── Documentos fuente grandes — REGLA DE ORO (Kike, 17-ago-2026): el ──────
// tamaño del documento fuente nunca debe provocar pérdida silenciosa de
// contenido. docExtract.js ya no trunca nada — extrae el documento COMPLETO,
// sin importar cuántas páginas tenga. Lo que se resuelve aquí es distinto:
// una sola llamada al modelo tiene un límite real de contexto (los modelos
// Claude usados en Evalúa Fácil soportan ~200k tokens de entrada), y meter
// el texto completo de un documento enorme en CADA llamada por parcial,
// además de ser potencialmente imposible, sería carísimo (se repetiría N
// veces, una por parcial). La solución NO es truncar — es fragmentar,
// procesar TODOS los fragmentos y consolidar, UNA SOLA VEZ (no por parcial).
//
// FUENTE_UMBRAL_FRAGMENTAR_CHARS decide la ESTRATEGIA, no un contenido
// máximo: por debajo, el texto completo se manda tal cual (como ya hacía
// antes de esta pieza) — arriba, se fragmenta y se extraen sus temas por
// partes, pero NINGÚN contenido se descarta en ningún caso. ~150000
// caracteres (~37500 tokens) deja margen generoso para que el resto del
// prompt (perfil docente, diagnósticos, instrucciones) quepa cómodo dentro
// de la ventana de contexto sin fragmentar.
const FUENTE_UMBRAL_FRAGMENTAR_CHARS = 150000
// Tamaño de cada fragmento que sí se manda a extracción — generoso pero muy
// por debajo de la ventana de contexto del modelo, para dejar margen a la
// instrucción del prompt y a la respuesta.
const FUENTE_FRAGMENTO_MAX_CHARS = 80000

// Cuántas unidades hace falta RESERVAR de crédito para procesar el
// documento fuente completo (Kike, 17-ago-2026: "el sistema debe poder
// consumir los créditos adicionales necesarios... el tamaño del documento
// puede aumentar el costo, pero nunca provocar pérdida silenciosa de
// contenido"). Documento normal: 1 (la tarifa fija de siempre, sin
// cambio). Documento que necesita fragmentarse: 1 + un fragmento extra por
// cada llamada real de extracción que va a hacer falta — mismo cálculo
// (dividirEnFragmentos) que usa extraerTemasDeDocumentoGrande, así que el
// número de unidades reservadas siempre coincide con el trabajo real que
// se va a hacer. Puro — no llama a la IA, no cuesta nada calcularlo.
function calcularUnidadesMinimasFuente(bloqueFuentesGenerales) {
  const largo = bloqueFuentesGenerales?.length || 0
  if (largo <= FUENTE_UMBRAL_FRAGMENTAR_CHARS) return 1
  return 1 + dividirEnFragmentos(bloqueFuentesGenerales, FUENTE_FRAGMENTO_MAX_CHARS).length
}

function promptExtraerTemasFragmento(fragmento, indice, totalFragmentos) {
  return (
    `Este es el FRAGMENTO ${indice + 1} de ${totalFragmentos} de un documento fuente más grande (programa de ` +
    'estudios, manual o material similar de una asignatura de bachillerato) — los demás fragmentos se procesan ' +
    'por separado, tú solo ves este pedazo. Identifica TODOS los temas, unidades, sesiones o apartados ' +
    'distintos que aparezcan en ESTE fragmento, sin importar si el documento los numera explícitamente o no. ' +
    'No omitas ninguno por parecer poco importante o repetido — si dos partes de este fragmento son de verdad ' +
    'la misma unidad temática, repórtalas juntas; si no estás seguro, repórtalas por separado (es preferible un ' +
    'tema de más que uno perdido). Para cada uno, escribe también un resumen breve (2-4 líneas) del contenido ' +
    'real de esa unidad — ese resumen es la única referencia a este fragmento que tendrá el siguiente paso, así ' +
    'que debe bastar para escribir actividades sobre ese tema sin volver a leer el documento completo.\n\n' +
    `"""${fragmento}"""\n\n` +
    'Responde SOLO con este JSON:\n' +
    '{\n  "temas": [\n    { "titulo": "<tal como se llame en el documento, o un título breve si no tiene ' +
    'nombre propio>", "resumen": "<2-4 líneas>" },\n    { ... una entrada más por cada tema/unidad/apartado ' +
    'adicional de este fragmento ... }\n  ]\n}\n' +
    'Si este fragmento no contiene ningún tema identificable (p. ej. es una portada o un índice), responde ' +
    '{"temas": []} — no inventes uno para rellenar.'
  )
}

// Fragmenta `texto`, extrae los temas de CADA fragmento (en paralelo, sin
// tope artificial de cuántos fragmentos se procesan — ver docChunking.js) y
// consolida todo en una sola lista. Se llama UNA VEZ por generación de
// Planeación (no una vez por parcial) — el resultado se reutiliza en todos
// los parciales, así que el documento grande solo se manda a extracción una
// vez, sin importar cuántos parciales tenga la asignatura.
//
// Si CUALQUIER fragmento falla (JSON ilegible, error de red, lo que sea),
// esta función misma falla — nunca se arma una Planeación "aparentemente
// completa" a partir de una extracción parcial en silencio (Kike,
// 17-ago-2026: "nunca ocultar una pérdida de información").
async function extraerTemasDeDocumentoGrande({ texto, client, modelo }) {
  const fragmentos = dividirEnFragmentos(texto, FUENTE_FRAGMENTO_MAX_CHARS)
  let tokensEntrada = 0, tokensSalida = 0, ms = 0

  const resultados = await Promise.all(fragmentos.map((fragmento, i) => (
    pedirJSON({
      client, modelo, maxTokens: 4000, system: PLANEACION_SISTEMA,
      prompt: promptExtraerTemasFragmento(fragmento, i, fragmentos.length),
    }).catch((err) => {
      throw new Error(
        `No se pudo procesar por completo el documento fuente (fragmento ${i + 1} de ${fragmentos.length}): ` +
        `${err.message || err}`
      )
    })
  )))

  const temas = []
  for (const { datos, interno } of resultados) {
    tokensEntrada += interno.tokensEntrada || 0
    tokensSalida += interno.tokensSalida || 0
    ms += interno.ms || 0
    for (const t of Array.isArray(datos?.temas) ? datos.temas : []) {
      const titulo = String(t?.titulo || '').trim().slice(0, 200)
      if (!titulo) continue
      temas.push({ titulo, resumen: String(t?.resumen || '').trim().slice(0, 600) })
    }
  }
  return { temas, fragmentosProcesados: fragmentos.length, interno: { tokensEntrada, tokensSalida, ms } }
}

// Texto compacto (proporcional a la CANTIDAD de temas, no al tamaño
// original del documento — por eso sí cabe en el prompt de cada parcial)
// que representa el documento completo cuando fue demasiado grande para
// mandarlo tal cual. Deja explícito que es un documento grande ya
// procesado por partes, para que la IA no espere el texto crudo completo.
function construirBloqueFuenteEstructurada(temas) {
  if (!temas.length) return null
  const lista = temas.map((t, i) => `${i + 1}. ${t.titulo}${t.resumen ? ` — ${t.resumen}` : ''}`).join('\n')
  return (
    `Documento(s) de referencia del docente — documento GRANDE, procesado por partes y consolidado aquí ` +
    `(${temas.length} temas identificados en total; esta lista representa el documento COMPLETO, no un ` +
    'resumen parcial):\n' + lista
  )
}

// Genera el contenido de UN parcial específico — se llama una vez por
// parcial real de la asignatura, así que el resultado es una Planeación
// distinta por parcial, no una sola con todo mezclado (decisión de Kike,
// 15-ago-2026). `cantidadSolicitada` (1–12) es una orden dura del docente;
// si es null, la IA decide y reporta su propio conteo en "bloquesTematicos"
// para que el llamador pueda exigirle consistencia (ver
// generarSecuenciasPorParciales).
function promptSecuenciasParcial(ctx, parcialCtx, cantidadSolicitada, pedirBibliografia) {
  const totalParciales = ctx.parciales?.length || 1
  const camposIdentidadJSON = CAMPOS_IDENTIDAD_SECUENCIA.map((c) => `"${c.clave}": "<${c.etiqueta}>"`).join(', ')
  const camposMomentoJSON = CAMPOS_MOMENTO.map((c) => `"${c.clave}": "<${c.etiqueta}>"`).join(', ')
  return (
    `Asignatura: ${ctx.asignaturaNombre || 'la asignatura del docente'} (bachillerato).\n` +
    `PARCIAL ${parcialCtx.numero} de ${totalParciales}${parcialCtx.periodoTexto ? ` (periodo: ${parcialCtx.periodoTexto})` : ''} — ` +
    'esta Planeación se genera UNA VEZ POR CADA PARCIAL: todo el contenido que propongas debe corresponder ' +
    'específicamente a este parcial, no al curso completo.\n\n' +
    (totalParciales > 1
      ? 'COBERTURA DEL PROGRAMA DE ESTUDIOS (obligatorio, pedido explícito de Kike, 15-ago-2026): si el docente ' +
        'subió su programa de estudios (fuentes generales, abajo), TODO su contenido debe quedar cubierto al ' +
        `sumar los ${totalParciales} parciales del curso — nada del programa puede quedarse sin planear en ` +
        `ninguno. Como esta llamada es solo para el parcial ${parcialCtx.numero} de ${totalParciales} (no ves lo ` +
        'que se generó para los demás, cada uno se decide por separado con el mismo criterio), divide el ' +
        `programa en ${totalParciales} partes proporcionales y consecutivas por orden de aparición en el ` +
        `programa, y cubre en ESTE parcial exactamente la parte que le corresponde a la posición ` +
        `${parcialCtx.numero} de ${totalParciales} — ni repitas temas de partes anteriores ni te adelantes a ` +
        'temas de partes posteriores.\n\n'
      : '') +
    (cantidadSolicitada
      ? `CANTIDAD DE SECUENCIAS DIDÁCTICAS: el docente pidió EXACTAMENTE ${cantidadSolicitada} Secuencia(s) ` +
        `Didáctica(s) para este parcial — genera exactamente ${cantidadSolicitada}, ni más ni menos, ` +
        'distribuyendo el contenido real del parcial entre ellas de forma coherente.\n\n'
      : 'CUÁNTAS SECUENCIAS DIDÁCTICAS HACEN FALTA (Kike, 16-ago-2026 — la IA seguía entregando una sola ' +
        'Secuencia Didáctica para parciales que en realidad cubren varias semanas y varios temas, y eso está ' +
        'mal): un parcial normal dura semanas y cubre varios bloques temáticos del programa de estudios — casi ' +
        'NUNCA se resuelve con una sola Secuencia Didáctica. Cuenta cuántos bloques temáticos distintos te toca ' +
        'cubrir en este parcial (ver COBERTURA DEL PROGRAMA DE ESTUDIOS arriba, si aplica) y crea AL MENOS una ' +
        'Secuencia Didáctica por cada bloque temático coherente — nunca comprimas varias semanas de contenido ' +
        'distinto en una sola Secuencia Didáctica. La cantidad de Secuencias NO la determina el número de ' +
        'sesiones disponibles — agrupa por coherencia temática, no dividiendo sesiones de forma arbitraria.\n' +
        'EJEMPLO: un parcial de 5 semanas que cubre 3 temas distintos del programa necesita normalmente 3 ' +
        'Secuencias Didácticas (una por tema), no 1.\n' +
        'AUTO-VERIFICACIÓN antes de responder: cuenta cuántas Secuencias Didácticas vas a entregar en ' +
        '"secuenciasDidacticas" y repórtalo también en "bloquesTematicos". Si es una sola, confirma primero que ' +
        'el parcial de verdad cubre un único bloque temático breve — si cubre más de uno (lo más común), ' +
        'agrega más Secuencias Didácticas antes de responder, no te quedes en 1 por costumbre.\n\n') +
    'CADA SECUENCIA DIDÁCTICA ES UNA UNIDAD COMPLETA E INDEPENDIENTE (Kike, 16-ago-2026): con su propia ' +
    'identidad (nombre/tema, aprendizajes esperados, propósito, sesiones que abarca, contenidos relacionados) ' +
    'y sus TRES momentos (Apertura, Desarrollo, Cierre) — nunca compartas estos campos entre varias Secuencias ' +
    'ni los agrupes en uno solo para toda la Planeación.\n' +
    'CADA MOMENTO (Apertura, Desarrollo y Cierre) TIENE SU PROPIO JUEGO COMPLETO — no uno compartido para toda ' +
    'la Secuencia: actividades de enseñanza-aprendizaje, recursos y materiales, estrategia de evaluación, ' +
    'evidencias y tipo de evaluación/instrumento. La Apertura tiene su propia evidencia, distinta de las del ' +
    'Desarrollo y de las del Cierre — igual que en un formato real de planeación, donde cada momento se evalúa ' +
    'por separado.\n' +
    'REGLA ÚNICA DE PONDERACIÓN (Kike, 16-ago-2026 — "simplificar la evaluación, el docente NO debe hacer ' +
    'cálculos"; ajustada a números enteros el 17-ago-2026): existe UNA SOLA escala de ponderación, la del ' +
    `PARCIAL completo = ${PONDERACION_TOTAL}% — y cada valor individual debe ser un número ENTERO, nunca ` +
    'decimales (1%, 2%, 3%... nunca 1.5%, 2.5%, 0.5%). Ni la Secuencia ni sus momentos ' +
    '(Apertura/Desarrollo/Cierre) tienen porcentaje propio — Apertura, Desarrollo y Cierre son la METODOLOGÍA de ' +
    'la Secuencia, no niveles de evaluación independientes. Lo que se pondera es la EVIDENCIA que cada momento ' +
    'produce: si un momento no genera una evidencia que de verdad se evalúe, su "ponderacion" es "0%" o "No ' +
    'aplica" — nunca inventes un porcentaje solo por rellenar el campo.\n' +
    'La suma de TODAS las "ponderacion" de TODOS los momentos (Apertura + Desarrollo + Cierre) de TODAS las ' +
    `Secuencias Didácticas de este parcial debe dar EXACTAMENTE ${PONDERACION_TOTAL}% — ni más ni menos, y cada ` +
    'valor individual debe ser un número ENTERO (por ejemplo: 20% + 30% + 10% + 40% = 100% es válido; 15.5% + ' +
    '24.5% + 30% + 30% = 100% NO es válido porque tiene decimales). NUNCA repartas ' +
    `${PONDERACION_TOTAL}% dentro de cada Secuencia por separado (eso sumaría varias veces ` +
    `${PONDERACION_TOTAL}% en el parcial, que es justo lo que se debe evitar). Antes de responder, suma ` +
    'mentalmente todas las ponderaciones enteras que vas a entregar en este parcial y ajústalas para que el ' +
    `total dé exactamente ${PONDERACION_TOTAL}%.\n` +
    'EXTENSIÓN DEL TEXTO — breve, claro y conciso, sin párrafos largos, explicaciones pedagógicas extensas, ' +
    'justificaciones ni descripciones innecesarias. Estos son máximos orientativos, no metas a alcanzar (si se ' +
    'puede decir con menos palabras, usa menos):\n' +
    '- Actividades de Apertura: máximo 2 acciones concretas, ~30 a 50 palabras.\n' +
    '- Actividades de Desarrollo: máximo 3 acciones concretas, ~50 a 80 palabras.\n' +
    '- Actividades de Cierre: máximo 1 o 2 acciones concretas, ~20 a 40 palabras.\n' +
    '- El resto de los campos de cada momento (estrategia de evaluación, evidencias, tipo/instrumento, ' +
    'recursos): directos, sin relleno — una frase corta basta.\n' +
    'La redacción de "actividades" describe QUÉ HARÁ EL DOCENTE Y/O QUÉ HARÁ EL ESTUDIANTE, de forma directa y ' +
    'ejecutable.\n' +
    'REGLA FUNDAMENTAL: UNA VIÑETA = UNA SESIÓN (Kike, 16-ago-2026). Dentro del campo "actividades" de cada ' +
    'momento (Apertura, Desarrollo y Cierre), cada viñeta representa EXACTAMENTE una sesión (una hora de clase) ' +
    '— nunca agrupes dos o más sesiones dentro de la misma viñeta ni escribas "Sesiones: 2" o "Sesiones: 3" al ' +
    'final de un solo bloque de texto. Si una actividad requiere varias sesiones, DIVÍDELA en una viñeta por ' +
    'cada sesión, cada una describiendo específicamente qué se hace en ESA sesión (puede ser continuación de ' +
    'la misma actividad — no hace falta que cada sesión sea un tema distinto, pero cada una es su propia ' +
    'viñeta):\n' +
    '"• Sesión 1: ...\\n• Sesión 2: ...\\n• Sesión 3: ..."\n' +
    'El campo "sesiones" de cada Secuencia debe indicar en texto breve cuáles sesiones abarca (p. ej. ' +
    '"Sesiones 1 a 3" o "Sesión 4"), y la cantidad de viñetas en las "actividades" de Apertura+Desarrollo+Cierre ' +
    'debe coincidir EXACTAMENTE con esas sesiones — no asignes sesiones por costumbre, cuenta cuántas hay ' +
    'realmente disponibles y numera las viñetas en consecuencia.\n' +
    'Formato: viñetas separadas por un salto de línea real "\\n" dentro del texto — nunca un párrafo corrido.\n' +
    'EJEMPLO CORRECTO (Desarrollo, secuencia con Sesiones 2 y 3):\n' +
    '"• Sesión 2: Guiar el cálculo del presupuesto mensual de la familia, identificando ingresos, gastos y ' +
    'balance financiero.\\n• Sesión 3: Resolver ejercicios de presupuesto familiar aplicando operaciones con ' +
    'números enteros y verificar los resultados."\n' +
    'EJEMPLO INCORRECTO (nunca hagas esto): "• Guiar el cálculo del presupuesto mensual de la familia y ' +
    'resolver ejercicios de operaciones con números enteros. Sesiones: 2."\n' +
    (parcialCtx.sesionesReales?.length
      ? 'RESTRICCIÓN REAL DE TIEMPO — SESIONES DISPONIBLES para este parcial (Kike, 17-ago-2026): estas son las ' +
        'ÚNICAS sesiones de clase que existen de verdad en este parcial — ya se descontaron vacaciones, asuetos, ' +
        `días inhábiles y clases canceladas — ${parcialCtx.sesionesReales.length} en total:\n` +
        `${formatoSesionesReales(parcialCtx.sesionesReales)}\n` +
        'Sigues decidiendo TÚ, pedagógicamente, cómo agrupar y repartir el contenido — puedes dedicar varias ' +
        'sesiones a una sola actividad, combinar actividades, o cerrar una Secuencia antes de tiempo si el tema ' +
        `lo permite. Pero el número de sesión que uses (en el campo "sesiones" y en cada viñeta "Sesión N:") ` +
        'tiene que corresponder EXACTAMENTE a esta lista: "Sesión 1" es la primera fecha de arriba, "Sesión 2" ' +
        `la segunda, y así sucesivamente — nunca uses un número de sesión mayor a ` +
        `${parcialCtx.sesionesReales.length} ni inventes que hay clase en una fecha que no aparece en la lista. ` +
        'Si una actividad ocupa varias sesiones, tienen que ser sesiones CONSECUTIVAS de esta lista (p. ej. ' +
        'Sesión 2 y Sesión 3), nunca fechas de calendario consecutivas que no estén ambas en la lista (el ' +
        'ejemplo de arriba puede saltarse días por vacaciones o porque ese día no hay clase). Al escribir cada ' +
        'viñeta, agrega la fecha real entre paréntesis junto al número de sesión, por ejemplo "• Sesión 2 ' +
        '(miércoles 3 de septiembre): ...".\n\n'
      : '') +
    'NUNCA escribas en el contenido que fue generado por inteligencia artificial, por IA, por un asistente, ni ' +
    'nada similar — el docente es el autor de esta planeación, la IA es solo su herramienta de redacción.\n\n' +
    (ctx.perfilIATexto ? `PERFIL DEL DOCENTE:\n${ctx.perfilIATexto}\n\n` : '') +
    (ctx.comentariosGrupoTexto ? `COMENTARIOS GENERALES DEL DOCENTE SOBRE EL GRUPO Y SU ENTORNO (pesan mucho, ` +
      `junto con los diagnósticos — pero nada pesa más que la FUENTE PRINCIPAL, el programa de estudios, que ` +
      `es la base de todo):\n${ctx.comentariosGrupoTexto}\n\n` : '') +
    (ctx.autoanalisisDocenteTexto ? `AUTOANÁLISIS DOCENTE (opcional, sobre el docente mismo, no sobre el ` +
      `grupo):\n${ctx.autoanalisisDocenteTexto}\n\n` : '') +
    (ctx.consideracionesTexto ? `CONSIDERACIONES DEL DOCENTE PARA QUE LA PLANEACIÓN SEA REALMENTE ` +
      `UTILIZABLE DURANTE EL CURSO:\n${ctx.consideracionesTexto}\n\n` : '') +
    (ctx.diagnosticoContextoTexto ? `DIAGNÓSTICO DE CONTEXTO DEL GRUPO:\n${ctx.diagnosticoContextoTexto}\n\n` : '') +
    (ctx.diagnosticoConocimientosTexto ? `DIAGNÓSTICO DE CONOCIMIENTOS (instrumento, sin resultados ` +
      `todavía):\n${ctx.diagnosticoConocimientosTexto}\n\n` : '') +
    (ctx.bloqueFuentesGenerales ? `FUENTES GENERALES DE LA ASIGNATURA:\n${ctx.bloqueFuentesGenerales}\n\n` : '') +
    'CONGRUENCIA OBLIGATORIA entre sesiones y contenido (error grave encontrado el 15-ago-2026: una propuesta ' +
    'que decía cubrir 10 horas pero cuyas actividades sumaban apenas hora y media, y que además solo cubría el ' +
    'primer tema del manual, dejando el resto sin planear):\n' +
    '- Las Secuencias que propongas para este parcial deben cubrir TODOS los temas relevantes de las fuentes ' +
    'que correspondan a este periodo — no te quedes en el primer tema o subtema y dejes el resto del manual ' +
    'sin usar. Si el tiempo disponible no alcanza para cubrir todo el material con profundidad, repártelo en ' +
    'más Secuencias/sesiones dentro del mismo parcial en vez de cubrir menos temas.\n' +
    '- Esto aplica más aún cuando el docente indicó fechas reales del periodo (arriba, si las hay): la duración ' +
    'del periodo y el contenido cubierto deben cuadrar entre sí — no propongas una fracción de plan para un ' +
    'periodo de varios días o semanas.\n' +
    '- Nada de lo que escribas es de adorno: cada Secuencia, actividad, recurso, evidencia y evaluación debe ' +
    'conectarse con contenido real del programa de estudios (o del manual/fuente que haga sus veces) — tu ' +
    'papel es ser el PEGAMENTO que conecta temas, tiempo y actividades entre sí, siempre anclado a esa fuente, ' +
    'no relleno genérico que serviría igual para cualquier tema. Si una fuente no tiene información suficiente ' +
    'para algún campo, usa la frase exacta "Información no disponible en las fuentes proporcionadas." en vez ' +
    'de inventar contenido.\n\n' +
    'COBERTURA COMPLETA DEL CONTENIDO FUENTE (Kike, 17-ago-2026 — error encontrado: una fuente con 10 temas, ' +
    'unidades o apartados, y la planeación final solo cubría los primeros 6): antes de escribir las Secuencias, ' +
    'identifica en el texto de la fuente TODOS los temas, unidades, sesiones o apartados distintos que ' +
    'correspondan a la parte de este parcial (ver COBERTURA DEL PROGRAMA DE ESTUDIOS arriba, si aplica) — sin ' +
    'importar si la fuente los numera explícitamente o no. Ninguno de esos temas puede quedar fuera de la ' +
    'Planeación por ninguna de estas razones: te pareció poco importante, "ya quedó cubierto" dentro de otro, ' +
    'lo fusionaste con otro sin decirlo, te pareció redundante con otro, o simplemente se te acabó el espacio ' +
    'de Secuencias que ibas a usar. Si el contenido no cabe en la cantidad de Secuencias que tenías pensada, ' +
    'la solución es SIEMPRE agregar más Secuencias Didácticas (no hay límite fijo) o repartir un tema entre ' +
    'varias sesiones de clase — nunca recortar el contenido fuente. Puedes combinar dos temas dentro de la ' +
    'misma Secuencia solo si de verdad son la misma unidad temática — nunca para ahorrar espacio.\n' +
    'Reporta esta identificación en el campo "temasFuente" del JSON (ver esquema abajo): un elemento por cada ' +
    'tema/unidad/apartado que identificaste, con "cubierto": true SOLO si alguna Secuencia lo desarrolla de ' +
    'verdad — nunca marques "cubierto": true por descuido o para que la lista se vea completa; si al final NO ' +
    'lo cubriste, repórtalo como false, no lo omitas de la lista.\n\n' +
    (pedirBibliografia
      ? 'FUENTES DE INFORMACIÓN / BIBLIOGRAFÍA (Kike, 16-ago-2026 — no la dejes vacía): propón hasta 5 fuentes ' +
        'para la Planeación completa (no solo este parcial), citando primero el programa de estudios y las ' +
        'demás fuentes generales que se te compartieron arriba (si las hay) — usa el nombre real del documento ' +
        'tal como se llame la fuente. Si conoces con certeza autor/institución y año de una fuente, inclúyelos; ' +
        'si no los conoces con certeza, usa solo el nombre del documento o del tema, sin inventar autor ni año. ' +
        'Puedes agregar además 1 o 2 referencias bibliográficas GENERALES y ampliamente conocidas del tema de ' +
        'la asignatura (p. ej. un libro de texto estándar de la materia) solo si estás seguro de que existen y ' +
        'de sus datos — nunca inventes una referencia que no conozcas con certeza. Dejar un elemento como "" es ' +
        'preferible a inventar.\n\n'
      : '') +
    'Responde SOLO con este JSON:\n' +
    '{\n' +
    '  "bloquesTematicos": <número entero — cuántos bloques temáticos distintos del programa decidiste que ' +
    'cubre este parcial, ANTES de escribir las secuencias>,\n' +
    '  "temasFuente": [\n' +
    '    { "titulo": "<tema/unidad/apartado identificado en la fuente, tal como se llame ahí>", "cubierto": <true o false> },\n' +
    '    { ... una entrada más por cada tema/unidad/apartado adicional que identificaste ... }\n' +
    '  ],\n' +
    '  "secuenciasDidacticas": [\n' +
    `    {${camposIdentidadJSON},\n` +
    `      "apertura": {${camposMomentoJSON}},\n` +
    `      "desarrollo": {${camposMomentoJSON}},\n` +
    `      "cierre": {${camposMomentoJSON}}\n` +
    '    },\n' +
    '    { ... una entrada más por cada Secuencia Didáctica adicional, misma forma ... }\n' +
    '  ]' +
    (pedirBibliografia ? ',\n  "fuentesInformacion": ["<fuente 1>", "<fuente 2>", "<fuente 3 — deja \'\' si no aplica>", "<fuente 4 — deja \'\' si no aplica>", "<fuente 5 — deja \'\' si no aplica>"]\n' : '\n') +
    '}\n' +
    'Cada campo de texto: máximo 2000 caracteres, nunca lo cortes a media palabra ni a media idea. ' +
    '"bloquesTematicos" y "secuenciasDidacticas" deben tener el MISMO número de elementos — es tu propio ' +
    'conteo, así que tiene que cuadrar; si no cuadra, es que te faltó una secuencia. Los objetos "apertura", ' +
    '"desarrollo" y "cierre" son OBLIGATORIOS en cada Secuencia, cada uno con sus 6 campos completos. TODOS los ' +
    'elementos de "temasFuente" deben traer "cubierto": true — si alguno queda en false, tu respuesta está ' +
    'incompleta, agrega la(s) Secuencia(s) que le falten antes de responder.'
  )
}

// Prompt de corrección cuando la cantidad de Secuencias entregadas no
// cuadra con la exigida — no es solo repetir la instrucción con otras
// palabras, es señalar la inconsistencia exacta (Kike, 16-ago-2026: "dale
// otra vuelta de una vez, y asegúrala" — el refuerzo de texto en el prompt
// no basta como garantía, hace falta un reintento automático que de verdad
// corrija el resultado).
function promptCorreccionSecuencias(promptOriginal, objetivo, entregadas) {
  return (
    promptOriginal +
    `\n\nCORRECCIÓN OBLIGATORIA: se necesitan EXACTAMENTE ${objetivo} Secuencia(s) Didáctica(s) para este ` +
    `parcial, pero tu respuesta anterior solo trajo ${entregadas} en "secuenciasDidacticas" — eso es ` +
    `insuficiente. Vuelve a responder el JSON COMPLETO con EXACTAMENTE ${objetivo} elementos en ` +
    '"secuenciasDidacticas", sin comprimir contenido de varias Secuencias en una sola.'
  )
}

// ¿Algún elemento de "temasFuente" quedó sin cubrir? No confiamos en que la
// IA "crea" que cubrió todo — se valida por código, igual que cantidad de
// Secuencias y ponderaciones (Kike, 17-ago-2026: "la validación debe
// hacerse mediante código/reglas, no depender únicamente de que la IA crea
// que cubrió todo"). Sin "temasFuente" en la respuesta (nada que validar,
// p. ej. si el modelo no devolvió el campo) no se considera incompleto —
// eso ya lo cubre el reintento de cantidad de Secuencias.
function coberturaIncompleta(temasFuente) {
  return Array.isArray(temasFuente) && temasFuente.some((t) => t?.cubierto !== true)
}

// Mismo patrón que promptCorreccionSecuencias/Ponderaciones: señala
// exactamente qué temas quedaron sin cubrir, en vez de repetir la
// instrucción general — y deja explícito que la solución es agregar
// Secuencias, nunca recortar contenido de la fuente.
function promptCorreccionCobertura(promptOriginal, temasFuente) {
  const faltantes = (Array.isArray(temasFuente) ? temasFuente : [])
    .filter((t) => t?.cubierto !== true)
    .map((t) => `- ${String(t?.titulo || '(sin título)').slice(0, 200)}`)
    .join('\n')
  return (
    promptOriginal +
    `\n\nCORRECCIÓN OBLIGATORIA: tu respuesta anterior dejó estos temas de la fuente SIN CUBRIR (marcados o ` +
    `implícitos como "cubierto": false en "temasFuente"):\n${faltantes}\n` +
    'Vuelve a responder el JSON COMPLETO, conservando el contenido y las Secuencias que ya estaban bien, y ' +
    'AGREGA las Secuencias Didácticas adicionales que hagan falta para cubrir cada uno de esos temas — no los ' +
    'fusiones ni los recortes para que quepan en las Secuencias que ya tenías. Actualiza también ' +
    '"bloquesTematicos" y todos los "cubierto" de "temasFuente" para que reflejen la respuesta corregida ' +
    '(todos deben quedar en true).'
  )
}

// Suma las "ponderacion" de TODOS los momentos de TODAS las Secuencias de
// un parcial — "0"/"No aplica"/vacío cuentan como 0. Regla única de
// ponderación (Kike, 16-ago-2026, ajustada a puntos enteros el
// 17-ago-2026): esa suma debe dar exactamente PONDERACION_TOTAL, la escala
// es el PARCIAL completo, no cada Secuencia por separado.
function numeroPonderacion(v) {
  const m = String(v || '').match(/-?\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : 0
}
function sumaPonderacionesParcial(secuencias) {
  return (Array.isArray(secuencias) ? secuencias : []).reduce((total, s) => (
    total + MOMENTOS.reduce((sub, momento) => sub + numeroPonderacion(s?.[momento]?.ponderacion), 0)
  ), 0)
}

// Mismo patrón que promptCorreccionSecuencias: no basta reforzar la
// instrucción con otras palabras, hay que señalar la suma exacta que dio
// mal para que la IA la corrija de verdad.
function promptCorreccionPonderaciones(promptOriginal, sumaActual) {
  return (
    promptOriginal +
    `\n\nCORRECCIÓN OBLIGATORIA: la suma de TODAS las "ponderacion" de TODOS los momentos de TODAS las ` +
    `Secuencias de este parcial dio ${sumaActual}%, y debe dar EXACTAMENTE ${PONDERACION_TOTAL}% — cada valor ` +
    'individual tiene que ser además un número ENTERO, sin decimales. Vuelve a responder el JSON COMPLETO, con ' +
    'las mismas Secuencias y contenido, ajustando SOLO los valores de "ponderacion" (de los momentos que sí ' +
    `tienen evidencia evaluable, todos enteros) para que la suma total del parcial dé exactamente ` +
    `${PONDERACION_TOTAL}% — no repartas ${PONDERACION_TOTAL}% dentro de cada Secuencia por separado.`
  )
}

// Garantía DURA de la regla única de ponderación — no basta con pedírselo
// a la IA (el reintento de arriba ayuda, pero un modelo puede seguir sin
// dar exactamente PONDERACION_TOTAL, o seguir usando decimales). Mismo
// principio que ya regía en el resto de Evalúa Fácil (ver
// repartirPonderacion, más arriba en este archivo): "la IA no reparte
// puntos, los calcula el código" — así que aquí se reparte
// matemáticamente PONDERACION_TOTAL en partes ENTERAS, proporcional a lo
// que la IA propuso, sin depender de que el docente lo revise (Kike,
// 16-ago-2026: "es muy probable que los docentes no revisen mucho y dejen
// todo como lo genera la IA"). Los momentos en "0%"/"No aplica" se quedan
// tal cual — nunca se les asigna ponderación por rescatar la suma.
//
// Método del resto mayor (Hare quota), no "la última absorbe el residuo del
// redondeo" que había antes: ese truco podía dejar valores con un solo
// decimal (33.3%) — exactamente el bug que reportó Kike (17-ago-2026). El
// resto mayor reparte los puntos enteros sobrantes (siempre menos que el
// número de entradas) a quienes tenían el residuo más alto, así que la
// suma da 100 exacto, en enteros, sin arriesgar un valor negativo aunque
// haya muchas Secuencias/momentos.
function normalizarPonderacionesParcial(secuencias) {
  const entradas = []
  for (const s of Array.isArray(secuencias) ? secuencias : []) {
    for (const momento of MOMENTOS) {
      const m = s?.[momento]
      const valor = numeroPonderacion(m?.ponderacion)
      if (m && valor > 0) entradas.push({ m, valor })
    }
  }
  const total = entradas.reduce((suma, e) => suma + e.valor, 0)
  if (!entradas.length || total <= 0) return
  const cuotas = entradas.map((e) => (e.valor / total) * PONDERACION_TOTAL)
  const bases = cuotas.map((c) => Math.floor(c))
  const sobrante = PONDERACION_TOTAL - bases.reduce((suma, b) => suma + b, 0)
  const ordenPorResiduo = cuotas
    .map((c, i) => ({ i, residuo: c - bases[i] }))
    .sort((a, b) => b.residuo - a.residuo)
  const asignado = [...bases]
  for (let k = 0; k < sobrante; k++) asignado[ordenPorResiduo[k % ordenPorResiduo.length].i]++
  entradas.forEach((e, i) => { e.m.ponderacion = `${asignado[i]}%` })
}

// Ejecuta una llamada a la IA por CADA parcial real — de ahí sale una
// Planeación distinta por parcial, no una sola con todo mezclado (decisión
// de Kike, 15-ago-2026).
async function generarSecuenciasPorParciales({ ctx, modelo, apiKey, cantidadSolicitada }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const porParcial = []
  let tokensEntrada = 0, tokensSalida = 0, ms = 0
  let reintentos = 0 // cuántos parciales necesitaron el reintento de cantidad — se cobra aparte (ver unidadesReales)
  let fragmentosProcesados = 0 // documento fuente grande: cuántos fragmentos se procesaron — también se cobra aparte
  // La bibliografía es de la Planeación completa, no de cada parcial — solo
  // se pide en la llamada del primer parcial (mismo programa de estudios
  // para todos, no tiene caso repetir la pregunta y gastar tokens de más).
  let fuentesInformacion = FUENTES_INFORMACION_VACIAS.slice()

  // Documento(s) fuente demasiado grandes para una sola llamada: se
  // fragmentan y se extraen sus temas UNA SOLA VEZ aquí (no una vez por
  // parcial), y ese resultado consolidado sustituye el texto crudo en el
  // contexto que ve cada parcial — ver comentario de FUENTE_UMBRAL_
  // FRAGMENTAR_CHARS más arriba. Si la extracción de algún fragmento falla,
  // esto se propaga y toda la generación falla (se reembolsa el crédito
  // reservado, igual que cualquier otro error de esta función) — nunca se
  // continúa con una fuente incompleta en silencio.
  if ((ctx.bloqueFuentesGenerales?.length || 0) > FUENTE_UMBRAL_FRAGMENTAR_CHARS) {
    const { temas, fragmentosProcesados: n, interno } = await extraerTemasDeDocumentoGrande({
      texto: ctx.bloqueFuentesGenerales, client, modelo,
    })
    fragmentosProcesados = n
    tokensEntrada += interno.tokensEntrada || 0
    tokensSalida += interno.tokensSalida || 0
    ms += interno.ms || 0
    logger.info(`Planeación: documento fuente grande fragmentado en ${fragmentosProcesados} partes, ${temas.length} temas consolidados`)
    ctx = { ...ctx, bloqueFuentesGenerales: construirBloqueFuenteEstructurada(temas) }
  }

  const limpiarCampo = (s) => String(s || '').trim().slice(0, 2000)
  const limpiarMomento = (m) => {
    const out = {}
    for (const { clave } of CAMPOS_MOMENTO) out[clave] = limpiarCampo(m?.[clave])
    return out
  }
  const limpiarSecuencia = (s) => {
    const out = {}
    for (const { clave } of CAMPOS_IDENTIDAD_SECUENCIA) out[clave] = limpiarCampo(s?.[clave])
    for (const momento of MOMENTOS) out[momento] = limpiarMomento(s?.[momento])
    return out
  }

  for (const parcialCtx of ctx.parciales) {
    // Presupuesto de tokens por Secuencia esperada — si el docente pidió un
    // número, se usa ese; si no, un estimado generoso por si la IA decide
    // varias. Cada Secuencia trae 23 campos (5 de identidad + 3 momentos ×
    // 6 campos cada uno, ver CAMPOS_IDENTIDAD_SECUENCIA/CAMPOS_MOMENTO) —
    // bastante más que el modelo plano anterior (11 campos), así que el
    // presupuesto anterior (800 + 900/secuencia) se quedaba corto y la
    // respuesta se cortaba a media cadena (bug real, 16-ago-2026: los
    // logs de producción mostraban "SyntaxError: Unterminated string in
    // JSON" — la generación truena, se reembolsa el crédito, y el docente
    // se queda con la Planeación anterior sin darse cuenta de por qué).
    const esPrimerParcial = parcialCtx === ctx.parciales[0]
    const secuenciasEstimadas = cantidadSolicitada || 4
    // La bibliografía suma ~5 fuentes cortas al presupuesto — margen extra
    // solo en la llamada que la pide.
    const maxTokens = Math.min(16000, (esPrimerParcial ? 3000 : 2500) + secuenciasEstimadas * 3200)
    const promptBase = promptSecuenciasParcial(ctx, parcialCtx, cantidadSolicitada, esPrimerParcial)
    let { datos, interno } = await pedirJSON({
      client, modelo, maxTokens, system: PLANEACION_SISTEMA, prompt: promptBase,
    })
    tokensEntrada += interno.tokensEntrada || 0
    tokensSalida += interno.tokensSalida || 0
    ms += interno.ms || 0

    let entregadas = Array.isArray(datos?.secuenciasDidacticas) ? datos.secuenciasDidacticas.length : 0
    // Aseguramiento real (no solo instrucción de texto): si la cantidad
    // entregada no cuadra con lo exigido (el número que pidió el docente, o
    // el propio conteo de bloques temáticos que reportó la IA), se manda UN
    // reintento automático señalando exactamente esa inconsistencia antes
    // de aceptar el resultado (Kike, 16-ago-2026).
    const bloques = Number(datos?.bloquesTematicos)
    const objetivo = cantidadSolicitada || (Number.isFinite(bloques) ? bloques : null)
    const necesitaReintento = objetivo != null &&
      (cantidadSolicitada ? entregadas !== objetivo : entregadas < objetivo)
    if (necesitaReintento) {
      const reintento = await pedirJSON({
        client, modelo, maxTokens, system: PLANEACION_SISTEMA,
        prompt: promptCorreccionSecuencias(promptBase, objetivo, entregadas),
      })
      tokensEntrada += reintento.interno.tokensEntrada || 0
      tokensSalida += reintento.interno.tokensSalida || 0
      ms += reintento.interno.ms || 0
      const entregadasReintento = Array.isArray(reintento.datos?.secuenciasDidacticas) ? reintento.datos.secuenciasDidacticas.length : 0
      // Solo se usa el reintento si de verdad mejoró (más cerca del
      // objetivo que antes) — si no, se sigue con la respuesta original en
      // vez de arriesgar un JSON peor o vacío.
      if (Math.abs(entregadasReintento - objetivo) < Math.abs(entregadas - objetivo)) {
        datos = reintento.datos
        reintentos++
      }
    }

    // Aseguramiento real de COBERTURA COMPLETA DEL CONTENIDO FUENTE (Kike,
    // 17-ago-2026 — error encontrado: una fuente con 10 temas, la
    // planeación final solo cubría los primeros 6). Igual que cantidad de
    // Secuencias y ponderaciones: no basta con pedírselo en el prompt, se
    // valida por código el propio reporte de "temasFuente" que la IA
    // entregó, y si algo quedó sin cubrir se manda un reintento señalando
    // exactamente qué temas faltan — nunca se resuelve recortando la
    // fuente, solo agregando las Secuencias que hagan falta.
    if (coberturaIncompleta(datos?.temasFuente)) {
      const temasAntes = datos.temasFuente
      const reintentoCobertura = await pedirJSON({
        client, modelo, maxTokens, system: PLANEACION_SISTEMA,
        prompt: promptCorreccionCobertura(promptBase, temasAntes),
      })
      tokensEntrada += reintentoCobertura.interno.tokensEntrada || 0
      tokensSalida += reintentoCobertura.interno.tokensSalida || 0
      ms += reintentoCobertura.interno.ms || 0
      // Solo se usa el reintento si de verdad mejoró (menos temas sin
      // cubrir que antes, y sin perder Secuencias que ya estaban bien) — si
      // no, se sigue con la respuesta original en vez de arriesgar un JSON
      // peor o vacío.
      const sinCubrir = (temas) => (Array.isArray(temas) ? temas.filter((t) => t?.cubierto !== true).length : Infinity)
      const entregadasAntes = Array.isArray(datos?.secuenciasDidacticas) ? datos.secuenciasDidacticas.length : 0
      const entregadasReintentoCobertura = Array.isArray(reintentoCobertura.datos?.secuenciasDidacticas) ? reintentoCobertura.datos.secuenciasDidacticas.length : 0
      if (sinCubrir(reintentoCobertura.datos?.temasFuente) < sinCubrir(temasAntes) &&
          entregadasReintentoCobertura >= entregadasAntes) {
        datos = reintentoCobertura.datos
        reintentos++
      }
    }

    // Aseguramiento real de la REGLA ÚNICA DE PONDERACIÓN (Kike,
    // 16-ago-2026, ajustada a números enteros el 17-ago-2026): la suma de
    // ponderaciones de todo el parcial debe dar exactamente
    // PONDERACION_TOTAL — igual que con la cantidad de Secuencias, un
    // reintento automático que señala la suma exacta que salió mal, no
    // solo repetir la instrucción.
    const sumaInicial = sumaPonderacionesParcial(datos?.secuenciasDidacticas)
    if (Math.abs(sumaInicial - PONDERACION_TOTAL) > 0.5) {
      const reintentoPonderacion = await pedirJSON({
        client, modelo, maxTokens, system: PLANEACION_SISTEMA,
        prompt: promptCorreccionPonderaciones(promptBase, sumaInicial),
      })
      tokensEntrada += reintentoPonderacion.interno.tokensEntrada || 0
      tokensSalida += reintentoPonderacion.interno.tokensSalida || 0
      ms += reintentoPonderacion.interno.ms || 0
      const sumaReintento = sumaPonderacionesParcial(reintentoPonderacion.datos?.secuenciasDidacticas)
      // Solo se usa el reintento si de verdad mejoró (más cerca de
      // PONDERACION_TOTAL que antes) — si no, se sigue con la respuesta
      // original en vez de arriesgar un JSON peor.
      if (Math.abs(sumaReintento - PONDERACION_TOTAL) < Math.abs(sumaInicial - PONDERACION_TOTAL)) {
        datos = reintentoPonderacion.datos
        reintentos++
      }
    }

    const secuenciasCrudas = Array.isArray(datos?.secuenciasDidacticas) ? datos.secuenciasDidacticas : []
    const tieneContenido = (s) => (
      CAMPOS_IDENTIDAD_SECUENCIA.some(({ clave }) => String(s?.[clave] || '').trim()) ||
      MOMENTOS.some((momento) => CAMPOS_MOMENTO.some(({ clave }) => String(s?.[momento]?.[clave] || '').trim()))
    )
    // Garantía dura de la regla única de ponderación (ver comentario en
    // normalizarPonderacionesParcial) — corre SIEMPRE, sin importar si el
    // reintento de arriba ya acercó la suma a 100 o no.
    normalizarPonderacionesParcial(secuenciasCrudas)
    const secuencias = secuenciasCrudas
      .filter((s) => s && tieneContenido(s))
      .map((s) => ({ id: crypto.randomUUID(), ...limpiarSecuencia(s) }))

    if (esPrimerParcial && Array.isArray(datos?.fuentesInformacion)) {
      const limpias = datos.fuentesInformacion.map((f) => limpiarCampo(f)).filter(Boolean).slice(0, 5)
      if (limpias.length) fuentesInformacion = [...limpias, ...FUENTES_INFORMACION_VACIAS].slice(0, 5)
    }

    porParcial.push({ numero: parcialCtx.numero, periodo: parcialCtx.periodoTexto, secuencias })
  }

  return { porParcial, fuentesInformacion, reintentos, fragmentosProcesados, interno: { modelo, tokensEntrada, tokensSalida, ms } }
}

async function ejecutarPlaneacionDidacticaInicial({ params, modelo, apiKey }) {
  const ctx = params.__contexto // lo puso el precheck; el cliente no puede tocarlo
  const { porParcial, fuentesInformacion, reintentos, fragmentosProcesados, interno } = await generarSecuenciasPorParciales({
    ctx, modelo, apiKey, cantidadSolicitada: ctx.cantidadSolicitada,
  })

  // Regla de no invención (T.7): si NINGÚN parcial produjo una Secuencia
  // aprovechable, esto NO se cobra (cae al catch del callable, que
  // reembolsa la reserva).
  if (!porParcial.some((p) => p.secuencias.length)) {
    throw new Error('El asistente de IA no generó una planeación utilizable')
  }

  // Tabla "DATOS DE IDENTIFICACIÓN INSTITUCIONAL" del Word de referencia
  // (Kike, 16-ago-2026) — la IA NO inventa datos administrativos que no
  // sabe (plantel, CCT, docente, etc. — mismo criterio que ya regía para
  // celdas de plantilla): se deja en blanco para que el docente las llene
  // él mismo en la propia Planeación, igual que cualquier otro campo
  // editable. Lo único que sí se puede prellenar sin inventar nada es el
  // nombre de la asignatura, que ya se conoce.
  const datosIdentificacion = {
    plantel: '', cct: '', carrera: '', modulo: ctx.asignaturaNombre || '', docente: '',
    semestre: '', grupo: '', periodo: '', horasTotales: '', horasSemana: '', competencias: '',
  }

  // Sección "VALIDACIÓN" del Word de referencia (Kike, 16-ago-2026) —
  // igual que datosIdentificacion, pertenece a PERSONALIZAR: la IA NUNCA
  // inventa nombres de personas. Solo el cargo trae un valor por default
  // (mismo texto de CAMPOS_VALIDACION en src/utils/planeacionDocx.js — se
  // duplica a propósito, runtimes distintos sin módulo compartido).
  const validacion = {
    elaboradoPor: '\nDocente',
    avaladoPor1: '\nJefe de servicios docentes',
    avaladoPor2: '\nPresidente de academia correspondiente',
  }

  // El servidor guarda la bitácora ÉL MISMO, no el cliente (a diferencia del
  // resto de operaciones, que devuelven el resultado y dejan el addDoc del
  // lado del cliente): una llamada por parcial puede tardar más que el
  // timeout del cliente, y sin esto la Planeación se generaba, se cobraba y
  // se perdía — el docente tenía que gastar créditos otra vez para
  // recuperarla (incidente de Kike, 15-ago-2026). Al escribir aquí, el
  // listener onSnapshot de PlaneacionInicialSection.jsx la recibe en cuanto
  // se guarda, sin depender de que la llamada del cliente siga viva.
  await getFirestore().collection('subjects').doc(String(params.subjectId || '').trim())
    .collection('planeacionesIA').add({
      porParcial,
      datosIdentificacion,
      fuentesInformacion,
      validacion,
      cantidadSolicitada: ctx.cantidadSolicitada || null,
      docenteId: params.__uid,
      generadoEn: FieldValue.serverTimestamp(),
    })

  return {
    resultado: { porParcial, datosIdentificacion, fuentesInformacion, validacion },
    // Tarifa fija (20 créditos) + 1 unidad extra por cada parcial que
    // necesitó algún reintento (cantidad, ponderaciones o cobertura de
    // contenido fuente — ver generarSecuenciasPorParciales) + 1 unidad
    // extra por cada fragmento que hizo falta procesar de un documento
    // fuente grande (Kike, 17-ago-2026: "el tamaño del documento puede
    // aumentar el costo, pero nunca provocar pérdida silenciosa de
    // contenido"). Cada uno de estos es una llamada real a la IA además de
    // las de siempre, así que se refleja en lo que se cobra — nunca más de
    // lo que ya se reservó (ver ledger.liquidar: Math.min(unidadesReales,
    // unidadesReservadas)).
    unidadesReales: 1 + reintentos + fragmentosProcesados,
    interno,
  }
}

// ── Chat con Asistente — por asignatura (17-ago-2026) ───────────────────────
//
// Un chat conversacional contextualizado a UNA asignatura. NO es un
// "ChatGPT genérico": el contexto se reconstruye desde Firestore en CADA
// turno (nunca se reutiliza entre asignaturas ni se cachea entre mensajes),
// usando EXCLUSIVAMENTE información que ya existe en la plataforma — nada
// se inventa. Reutiliza el mismo patrón OPERACIONES/PRECHECKS/ledger que ya
// usa el resto de Evalúa Fácil; no es un sistema de IA paralelo.
//
// Alcance de esta primera versión (Kike, 17-ago-2026): solo por asignatura.
// El Asistente General, memoria permanente entre conversaciones, y
// agregaciones nuevas (promedio de grupo, alumnos en riesgo, asistencia
// agregada, pendientes de calificar) quedan fuera — quedan reportadas como
// mejora futura, no implementadas aquí.

const MAX_TURNOS_HISTORIAL = 10
const MAX_LARGO_MENSAJE = 2000

// Últimos MAX_TURNOS_HISTORIAL turnos válidos — nunca se confía en lo que
// mande el cliente sin sanear: solo roles 'user'/'assistant', solo texto,
// recortado. Evita que un historial corrupto o larguísimo dispare un costo
// de tokens fuera de control.
function sanearHistorialChat(historial) {
  return (Array.isArray(historial) ? historial : [])
    .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim())
    .map((h) => ({ role: h.role, content: h.content.trim().slice(0, MAX_LARGO_MENSAJE) }))
    .slice(-MAX_TURNOS_HISTORIAL)
}

// Texto compacto de la Planeación Inicial ACEPTADA (si existe) — mismo
// campo que ya usa el cliente (subjects/{id}.planeacionAceptada, ver
// PlaneacionInicialSection.jsx), no una consulta nueva. Sin aceptar
// todavía, no hay nada real que dar de la Planeación — no se inventa.
function planeacionAceptadaATexto(planeacionAceptada) {
  const porParcial = planeacionAceptada?.porParcial
  if (!Array.isArray(porParcial) || !porParcial.length) return null
  return porParcial.map((p) => {
    const secuencias = (p.secuencias || []).map((s) => (
      `  - ${s.nombre || '(sin nombre)'} (${s.sesiones || 'sesiones no especificadas'}): ${s.contenidosRelacionados || ''}`
    )).join('\n')
    return `Parcial ${p.numero}${p.periodo ? ` (${p.periodo})` : ''}:\n${secuencias || '  (sin secuencias)'}`
  }).join('\n\n')
}

// Análisis IA (OP-10) de los exámenes/cuestionarios YA calificados de esta
// asignatura — hasta 3 más recientes, para no inflar el prompt. Excluye los
// de diagnóstico (esos ya se incluyen aparte, con su propio texto) para no
// duplicar la misma información dos veces. Mismo patrón de lectura que
// analisisDiagnosticoMasReciente, generalizado a cualquier examen/cuestionario.
async function analisisExamenesRecientes(db, subjectId, limite = 3) {
  const actsSnap = await db.collection('activities').where('asignaturaId', '==', subjectId).get()
  const candidatas = actsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => (a.categoria === 'examen' || a.categoria === 'cuestionario') && !a.diagnosticoTipo)
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))

  const resultados = []
  for (const act of candidatas) {
    if (resultados.length >= limite) break
    const analisisSnap = await db.collection(`activities/${act.id}/analisisIA`).get()
    if (analisisSnap.empty) continue
    const masReciente = analisisSnap.docs
      .map((d) => d.data())
      .sort((a, b) => (b.generadoEn?.toMillis?.() || 0) - (a.generadoEn?.toMillis?.() || 0))[0]
    if (masReciente?.resultado) resultados.push({ nombre: act.nombre, resultado: masReciente.resultado })
  }
  return resultados
}

function analisisExamenesATexto(lista) {
  if (!lista.length) return null
  return lista.map(({ nombre, resultado: r }) => {
    const partes = [`"${nombre}"`]
    if (r.resumenGeneral) partes.push(r.resumenGeneral)
    if (Number.isFinite(r.porcentajeAciertosGeneral)) partes.push(`Aciertos generales: ${r.porcentajeAciertosGeneral}%`)
    if (r.recomendaciones?.length) partes.push(`Recomendaciones: ${r.recomendaciones.join('; ')}`)
    return partes.join(' — ')
  }).join('\n')
}

// ── Asistente General — resumen agregado de TODAS las asignaturas ──────────
//
// Segunda etapa del Chat con Asistente (17-ago-2026), autorizada por Kike
// después de validar la primera (por asignatura). Reutiliza el MISMO
// operacion 'chat_asistente' — solo cambia el precheck según venga o no
// `subjectId`: sin asignatura → Asistente General.
//
// Agregaciones nuevas (no existían en ningún lado del proyecto, confirmado
// en el análisis previo): actividades pendientes de calificar, promedio del
// grupo y alumnos en riesgo, del PARCIAL ACTUAL de cada asignatura. Se
// calculan aquí mismo, reutilizando promedioParcial/normalizeGrade/
// ponderacionActivaEnParcial (ya existían en src/utils/ponderacion.js, solo
// se usaban del lado cliente) — nunca se expone nombre ni identidad de
// ningún alumno a la IA, solo conteos y promedios agregados.
async function resumenAsignaturaParaGeneral(db, subjectId, subj) {
  const hoy = new Date().toISOString().slice(0, 10)
  const parcialesFechas = Array.isArray(subj.parcialesFechas) ? subj.parcialesFechas : []
  const parcialActual = parcialForDate(parcialesFechas, hoy) || Math.max(1, Number(subj.parciales) || 1)

  const [actsSnap, studentsSnap] = await Promise.all([
    db.collection('activities').where('asignaturaId', '==', subjectId).where('parcial', '==', parcialActual).get(),
    db.collection('students').where('asignaturaId', '==', subjectId).get(),
  ])
  const actividades = actsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const actIds = actividades.map((a) => a.id)

  const submissions = []
  for (let i = 0; i < actIds.length; i += 30) {
    const chunk = actIds.slice(i, i + 30)
    if (!chunk.length) continue
    const snap = await db.collection('submissions').where('actividadId', 'in', chunk).get()
    submissions.push(...snap.docs.map((d) => d.data()))
  }
  const actividadesPendientes = submissions.filter((s) => s.estado && s.estado !== 'calificado').length

  const subMap = {}
  submissions.forEach((s) => { subMap[`${s.alumnoId}-${s.actividadId}`] = s })

  const ponderacionOn = ponderacionActivaEnParcial(subj, parcialActual)
  const promedios = studentsSnap.docs.map((alumnoDoc) => {
    const grades = actividades.map((a) => {
      const sub = subMap[`${alumnoDoc.id}-${a.id}`]
      return sub?.calificacion != null ? normalizeGrade(sub.calificacion, a.maxCalif || 10) : null
    })
    return promedioParcial(actividades, grades, ponderacionOn)
  }).filter((p) => p != null)

  const promedioGrupo = promedios.length ? promedios.reduce((s, p) => s + p, 0) / promedios.length : null
  const alumnosEnRiesgo = promedios.filter((p) => p < 6).length // 6/10 — mínimo aprobatorio SEP

  return {
    nombre: String(subj.nombre || '').trim() || '(sin nombre)', grupo: subj.grupo || '',
    parcialActual, totalAlumnos: studentsSnap.size, actividadesPendientes, promedioGrupo, alumnosEnRiesgo,
  }
}

function resumenGeneralATexto(resumenes) {
  if (!resumenes.length) return 'El docente todavía no tiene asignaturas.'
  return resumenes.map((r) => (
    `- ${r.nombre}${r.grupo ? ` (${r.grupo})` : ''}, Parcial ${r.parcialActual}: ${r.totalAlumnos} alumnos, ` +
    `${r.actividadesPendientes} entrega(s) sin calificar, promedio del grupo ` +
    `${r.promedioGrupo != null ? r.promedioGrupo.toFixed(1) : 'sin calificaciones todavía'}, ` +
    `${r.alumnosEnRiesgo} alumno(s) por debajo de 6.`
  )).join('\n')
}

// ── Límite de interacciones del Chat con Asistente (18-ago-2026, reestructuración
// de precios) ────────────────────────────────────────────────────────────────
// El chat no cobra créditos por mensaje — el candado real es este límite
// diario de interacciones, igual para todo docente (modelo de créditos
// puros, sin distinción por plan, decisión del PO 20-ago-2026). UNA
// interacción = UN mensaje enviado por el docente (nunca la respuesta del
// modelo, nunca abrir el chat). El contador es COMBINADO entre el Asistente
// General y TODAS las asignaturas (la clave es solo `uid_fecha`, así que
// cambiar de conversación o de asignatura NUNCA da interacciones frescas).
// Expira solo con el cambio de día (fecha en la clave:
// `new Date().toISOString().slice(0,10)`, sin inventar zona horaria).
//
// RESERVA, no solo verificación: `reservarInteraccionChat` corre en una
// TRANSACCIÓN que lee y aumenta el contador en el mismo paso, ANTES de
// llamar a Anthropic — así dos solicitudes simultáneas (doble clic, dos
// pestañas) nunca pueden leer ambas "49 de 50" y las dos pasar: Firestore
// serializa la transacción, la segunda relee el valor YA incrementado por la
// primera. Si Anthropic falla después, `liberarInteraccionChat` decrementa —
// la interacción reservada nunca se pierde silenciosamente ni se cuenta de más.
const LIMITE_CHAT_DIARIO = 50

function claveLimiteChatDiario(uid) {
  return `${uid}_${new Date().toISOString().slice(0, 10)}`
}

// Se llama al inicio del precheck — ANTES de llamar a Anthropic. Devuelve
// { ref, max, usadas } para que el cliente pueda mostrar "X de Y
// interacciones" y para que ejecutarChatAsistente pueda liberar la reserva
// si Anthropic falla.
async function reservarInteraccionChat(db, uid) {
  const ref = db.doc(`chatInteraccionesDiarias/${claveLimiteChatDiario(uid)}`)
  const max = LIMITE_CHAT_DIARIO
  const usadas = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const actuales = snap.data()?.contador || 0
    if (actuales >= max) {
      throw new HttpsError('resource-exhausted',
        'Has alcanzado el límite diario de 50 interacciones con el Chat con Asistente. Podrás continuar mañana.',
        { codigo: 'LIMITE_DIARIO_CHAT' })
    }
    tx.set(ref, { contador: actuales + 1, actualizadoEn: FieldValue.serverTimestamp() }, { merge: true })
    return actuales + 1
  })
  return { ref, max, usadas }
}

// Solo se llama si Anthropic NO respondió de verdad (error de red/API, o
// respuesta vacía) — devuelve la interacción reservada. Fire-and-forget,
// mismo criterio que el resto de escrituras de métricas: si esta escritura
// fallara, no debe tirar abajo el manejo del error original.
function liberarInteraccionChat(reserva) {
  if (!reserva) return
  reserva.ref.set({ contador: FieldValue.increment(-1), actualizadoEn: FieldValue.serverTimestamp() }, { merge: true })
    .catch((err) => logger.error('liberarInteraccionChat:', err))
}

// Saldo = 0 → el chat entero queda bloqueado (pedido explícito, 18-ago-2026):
// no es que "cada mensaje cueste 0" — es que el saldo funciona como condición
// de ACCESO al chat completo. Sin `iaCreditos/{uid}` (docente que nunca ha
// usado la IA) se deja pasar: ese documento nace con el saldo lleno de su
// plan en su primer uso real (ver creditosLedger.reservar) — no existir
// todavía no es lo mismo que estar en cero.
async function verificarSaldoChat(db, uid) {
  const snap = await db.doc(`iaCreditos/${uid}`).get()
  if (snap.exists && (snap.data()?.saldo || 0) <= 0) {
    throw new HttpsError('failed-precondition',
      'Necesitas créditos disponibles para seguir usando el Chat con Asistente.',
      { codigo: 'SIN_CREDITOS_CHAT' })
  }
}

// Ayuda contextual de la plataforma (18-ago-2026) — SOLO para el Asistente
// General: además de resolver dudas de trabajo docente, debe poder responder
// CUALQUIER pregunta de uso de Evalúa Fácil (navegación, asignaturas,
// estudiantes, actividades, asistencia, evaluaciones, planeación, chat) y de
// planes/créditos/pagos, sin inventar nada. Los números de planes/créditos
// salen de config/iaTarifas (misma fuente que PlanComparisonTable/
// ComprarCreditosModal en el cliente) — cero precios duplicados. La parte de
// navegación/módulos está tomada literal de las mismas 4 guías reales de
// GettingStartedPage.jsx ("Ayuda para comenzar", /manual) — no se inventa
// nada que no exista ya documentado ahí. No se listan datos bancarios
// (cambian y viven en config/paymentConfig, no en un texto estático del
// prompt); se remite al flujo real ("Comprar créditos" en el perfil).
async function bloqueAyudaPlataforma() {
  const tarifas = await ledger.cargarTarifas()
  const paquetes = tarifas.paquetesCreditos || []
  const listaPaquetes = paquetes.map((p) => `${p.creditos} créditos = $${p.precioMXN} MXN`).join(', ')
  return 'AYUDA DE EVALÚA FÁCIL — usa esto tal cual para CUALQUIER pregunta sobre cómo usar la plataforma, sus créditos o pagos (no son temas ajenos a ti, son parte de tu trabajo como Asistente General). Nunca inventes datos, funciones o proveedores de pago que no estén aquí; si algo no está cubierto, dilo con claridad y remite a "Ayuda para comenzar" (menú lateral) o al administrador.\n\n' +
    'NAVEGACIÓN Y MÓDULOS: cada asignatura es su propio espacio, con pestañas propias — Estudiantes, Actividades, Asistencia, entre otras — accesible desde el Dashboard tocándola. Para crear cualquier elemento (asignatura, actividad, estudiante) se busca dónde se administra ese tipo de elemento y se usa su botón de crear/agregar. Toda la gestión de la plataforma (asignaturas, estudiantes, actividades, calificaciones, avisos) es gratuita.\n' +
    '· Crear una asignatura: desde el Dashboard, botón "Nueva asignatura" — nombre, grupo y fechas de inicio/fin son obligatorios (con las fechas se arman horario, agenda y asistencias).\n' +
    '· Agregar estudiantes: dentro de la asignatura, pestaña "Estudiantes" — uno por uno con el ícono de agregar, o un grupo completo con "Plantilla Excel" (descargar, llenar, subir). Cada estudiante activado tiene su propio usuario para entrar.\n' +
    '· Crear una actividad: dentro de la asignatura, pestaña "Actividades", botón "Nueva actividad" — tipo "Entregable" (le pide algo al estudiante, con instrucciones y tipos de archivo permitidos) u "Observación". Al publicar, los estudiantes ya la ven y pueden entregar; las entregas se revisan y califican en esa misma actividad.\n' +
    '· Pasar asistencia: dentro de la asignatura, pestaña "Asistencia", se elige el día — cada estudiante empieza "presente" y se toca su celda para rotar entre presente/falta/justificada, se guarda solo. Asistencia es GRATUITA: no consume créditos ni requiere tener saldo — funciona siempre, con saldo o sin él.\n' +
    '· Evaluaciones/exámenes y diagnósticos, Planeación Didáctica Inicial, y rúbricas/listas de cotejo: se generan con IA desde la pestaña "Asistente IA" de cada asignatura. Este mismo Chat también puede crear una actividad o un examen directamente si el docente lo pide con suficiente detalle.\n\n' +
    `CRÉDITOS: toda cuenta nueva recibe 50 créditos de bienvenida gratis, sin fecha de vencimiento — se usan cuando el docente quiera. Los créditos se comparten entre TODAS las funciones de IA (diagnósticos, planeación, actividades, exámenes, rúbricas/listas de cotejo y este Chat) — no hay bolsas separadas por función. El saldo se ve tocando la barra de créditos o en "Créditos" dentro de Perfil. ` +
    'Los créditos NUNCA caducan, se usen o no. Si el saldo llega a cero, las funciones de IA siguen visibles pero se bloquean hasta comprar más créditos; el resto de la plataforma sigue funcionando gratis.\n' +
    (listaPaquetes
      ? `COMPRAR CRÉDITOS: se hace desde "Comprar créditos" en Perfil — paquetes: ${listaPaquetes}. El pago es por depósito o transferencia bancaria directa; los datos de la cuenta se muestran ahí mismo al elegir el paquete. IMPORTANTE: los créditos comprados se agregan al saldo SOLO después de que el administrador confirma el pago recibido — nunca de inmediato al hacer el depósito.`
      : '')
}

async function precheckAsistenteGeneral({ uid, params }) {
  const db = getFirestore()
  const mensaje = String(params?.mensaje || '').trim().slice(0, MAX_LARGO_MENSAJE)
  if (!mensaje) throw new HttpsError('invalid-argument', 'Falta el mensaje.')
  await verificarSaldoChat(db, uid)

  const perfilSnap = await db.doc(`users/${uid}`).get()
  const perfilIA = perfilSnap.data()?.perfilIA || null
  if (!perfilIACompleto(perfilIA)) {
    throw new HttpsError('failed-precondition',
      'Completa primero tu Perfil para IA del docente — es indispensable para usar el Chat con Asistente. ' +
      'No se descontaron créditos.',
      { codigo: 'PERFIL_IA_INCOMPLETO' })
  }

  // La reserva de la interacción va AL FINAL de las validaciones — justo
  // antes de construir el contexto y llamar a Anthropic — para que un
  // rechazo por saldo/perfil incompleto nunca consuma una interacción real.
  const reservaLimiteChat = await reservarInteraccionChat(db, uid)

  const subjectsSnap = await db.collection('subjects').where('docenteId', '==', uid).get()
  const subjects = subjectsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => !s.archived)
  const resumenes = await Promise.all(subjects.map((s) => resumenAsignaturaParaGeneral(db, s.id, s)))

  const bloques = [
    `PERFIL DEL DOCENTE:\n${perfilIATexto(perfilIA)}`,
    `RESUMEN DE TODAS LAS ASIGNATURAS DEL DOCENTE (parcial actual de cada una):\n${resumenGeneralATexto(resumenes)}`,
    await bloqueAyudaPlataforma(),
  ]

  return {
    contextoSistema: bloques.join('\n\n'),
    mensaje,
    historial: sanearHistorialChat(params?.historial),
    // Chat con Acciones (17-ago-2026): el Asistente General NUNCA propone
    // crear nada — "ACCIONES = SOLO CONTEXTO DE ASIGNATURA" (pedido
    // explícito). ejecutarChatAsistente descarta cualquier propuesta si esto
    // es false, sin importar lo que haya devuelto el modelo.
    permitirAcciones: false,
    reservaLimiteChat,
  }
}

// Precheck: arma TODO el contexto de la asignatura desde Firestore — nunca
// desde lo que mande el cliente (asignaturaId es lo único que se confía, y
// solo para leer, tras validar dueño). Mismo criterio que
// precheckPlaneacionInicial: si el docente no tiene Perfil IA completo, se
// detiene aquí (antes de reservar créditos), porque toda la pestaña
// Asistente IA ya exige tenerlo.
//
// SIN `subjectId` → Asistente General (precheckAsistenteGeneral), no un
// error: es la forma en que el cliente pide el contexto transversal.
async function precheckChatAsistente({ uid, params }) {
  const db = getFirestore()
  const subjectId = String(params?.subjectId || '').trim()
  if (!subjectId) return precheckAsistenteGeneral({ uid, params })
  const mensaje = String(params?.mensaje || '').trim().slice(0, MAX_LARGO_MENSAJE)
  if (!mensaje) throw new HttpsError('invalid-argument', 'Falta el mensaje.')
  await verificarSaldoChat(db, uid)

  const subjSnap = await db.doc(`subjects/${subjectId}`).get()
  if (!subjSnap.exists) throw new HttpsError('not-found', 'La asignatura no existe')
  const subj = subjSnap.data()
  if (subj.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta asignatura no es tuya')

  const perfilSnap = await db.doc(`users/${uid}`).get()
  const perfilIA = perfilSnap.data()?.perfilIA || null
  if (!perfilIACompleto(perfilIA)) {
    throw new HttpsError('failed-precondition',
      'Completa primero tu Perfil para IA del docente — es indispensable para usar el Chat con Asistente. ' +
      'No se descontaron créditos.',
      { codigo: 'PERFIL_IA_INCOMPLETO' })
  }

  const configSnap = await db.doc(`subjects/${subjectId}/asistenteIA/config`).get()
  const comentariosGrupoTexto = comentariosGrupoATexto(configSnap.data()?.comentariosGrupo)
  const autoanalisisDocenteTexto = autoanalisisDocenteATexto(configSnap.data()?.autoanalisisDocente)
  const consideracionesTexto = consideracionesATexto(configSnap.data()?.consideraciones)

  // Fuente Principal / programa de estudios (18-ago-2026, bug real: el Chat
  // nunca la incluía — el docente preguntaba por "el manual" y el modelo
  // respondía que no tenía acceso, aunque Planeación/Diagnóstico SÍ la usan
  // vía requerirProgramaEstudios+fuentesIA.prepararBloqueFuentes). Se
  // reutiliza EXACTAMENTE el mismo extractor que ya usan esas operaciones —
  // nada de una segunda copia del documento. A diferencia de Planeación
  // (donde requerirProgramaEstudios truena si no existe, porque ahí es
  // obligatoria), el Chat no debe morir si el docente aún no la subió o si
  // por lo que sea no se pudo leer — sigue funcionando con el resto del
  // contexto, solo sin ese bloque.
  let programaTexto = null
  const programaEstudios = configSnap.data()?.programaEstudios
  if (programaEstudios?.url) {
    try {
      programaTexto = await fuentesIA.prepararBloqueFuentes([programaEstudios.url])
    } catch (e) {
      logger.warn(`precheckChatAsistente: no se pudo leer la Fuente Principal de ${subjectId}: ${String(e.message || e).slice(0, 200)}`)
    }
  }

  // Mismo bloque que precheckPlaneacionInicial: sesiones reales SOLO si ya
  // hay horarioPatron, sin bloquear ni inventar horario si no lo hay.
  let diasAsueto = []
  let sesionesCanceladas = []
  if (Array.isArray(subj.horarioPatron) && subj.horarioPatron.length) {
    const [asuetosSnap, vacacionesSnap, bloquesSnap] = await Promise.all([
      db.collection('asuetos').where('docenteId', '==', uid).get(),
      db.collection('vacaciones').where('docenteId', '==', uid).get(),
      db.collection('horarioBloques').where('docenteId', '==', uid).where('asignaturaId', '==', subjectId).get(),
    ])
    diasAsueto = [
      ...asuetosSnap.docs.map((d) => d.data()).filter((a) => a.clases).map((a) => a.fecha),
      ...fechasVacacionParaClases(vacacionesSnap.docs.map((d) => d.data())),
    ]
    sesionesCanceladas = bloquesSnap.docs.map((d) => d.data()).filter((b) => b.cancelada)
      .map((b) => ({ fecha: b.fecha, horaInicio: b.horaInicio }))
  }
  const parciales = construirParcialesCtx(subj, { diasAsueto, sesionesCanceladas })

  const [resultadoContexto, resultadoConocimientos, examenesRecientes, alumnosTexto, pendientesIATexto] = await Promise.all([
    analisisDiagnosticoMasReciente(db, subjectId, 'contexto'),
    analisisDiagnosticoMasReciente(db, subjectId, 'conocimientos'),
    analisisExamenesRecientes(db, subjectId),
    detalleAlumnosTexto(db, subjectId),
    pendientesEvaluacionesIATexto(db, subjectId),
  ])

  const bloques = [
    `ASIGNATURA: ${String(subj.nombre || '').trim() || '(sin nombre)'}${subj.grupo ? ` — Grupo ${subj.grupo}` : ''}.`,
    subj.fechaInicio && subj.fechaFin ? `Periodo del curso: ${subj.fechaInicio} a ${subj.fechaFin}.` : null,
    programaTexto ? `FUENTE PRINCIPAL DE LA ASIGNATURA (programa de estudios que el docente subió — la base de la Planeación y de las demás funciones de IA de esta asignatura):\n${programaTexto}` : null,
    `PERFIL DEL DOCENTE:\n${perfilIATexto(perfilIA)}`,
    comentariosGrupoTexto ? `COMENTARIOS DEL DOCENTE SOBRE EL GRUPO Y SU ENTORNO:\n${comentariosGrupoTexto}` : null,
    autoanalisisDocenteTexto ? `AUTOANÁLISIS DOCENTE (sobre el docente mismo, no sobre el grupo):\n${autoanalisisDocenteTexto}` : null,
    consideracionesTexto ? `CONSIDERACIONES DEL DOCENTE:\n${consideracionesTexto}` : null,
    `PARCIALES DE LA ASIGNATURA (con sus fechas y, cuando exista horario configurado, sus sesiones reales):\n` +
      parciales.map((p) => (
        `Parcial ${p.numero}${p.periodoTexto ? ` (${p.periodoTexto})` : ''}` +
        (p.sesionesReales?.length ? ` — ${p.sesionesReales.length} sesiones reales de clase` : '')
      )).join('\n'),
    (() => {
      const texto = planeacionAceptadaATexto(subj.planeacionAceptada)
      return texto ? `PLANEACIÓN DIDÁCTICA INICIAL ACEPTADA (referencia de lo que el docente planeó para el curso):\n${texto}` : null
    })(),
    resultadoContexto ? `DIAGNÓSTICO DE CONTEXTO DEL GRUPO:\n${diagnosticoContextoATexto(resultadoContexto)}` : null,
    resultadoConocimientos ? `DIAGNÓSTICO DE CONOCIMIENTOS DEL GRUPO:\n${diagnosticoConocimientosATexto(resultadoConocimientos)}` : null,
    (() => {
      const texto = analisisExamenesATexto(examenesRecientes)
      return texto ? `ANÁLISIS DE EXÁMENES/CUESTIONARIOS RECIENTES YA CALIFICADOS (agregado del grupo):\n${texto}` : null
    })(),
    // Detalle con nombre (19-ago-2026, pedido explícito de Kike): esto es
    // exactamente lo que el docente ya ve en su pestaña Actividades — no es
    // un dato nuevo ni privado frente a él, solo lo hace consultable por
    // chat. Ver detalleAlumnosTexto: nunca se usa en el Asistente General ni
    // en el análisis con IA (OP-10), que se quedan agregados/anónimos.
    alumnosTexto ? `ESTUDIANTES DE ESTA ASIGNATURA — DETALLE INDIVIDUAL (con nombre, quién entregó cada actividad y su calificación; SOLO para este chat, el docente ya ve exactamente esto en su panel):\n${alumnosTexto}` : null,
    `EVALUACIONES DE IA PENDIENTES DE APLICAR:\n${pendientesIATexto}`,
    // CORRECCIÓN 23-ago-2026 (prueba de estrés real): este bloque SOLO se
    // incluía en precheckAsistenteGeneral — el chat dentro de una
    // asignatura no tenía acceso a él y por eso respondía vago/remitía al
    // administrador ante preguntas de créditos/pagos/uso de la plataforma,
    // contradiciendo la instrucción explícita de CHAT_SISTEMA de "nunca
    // remitir a otro lugar" en esos temas. Es la MISMA función (sin
    // duplicar contenido, ya lee tarifas/paquetes en vivo), solo que ahora
    // también se agrega aquí.
    await bloqueAyudaPlataforma(),
  ].filter(Boolean)

  // Igual que en precheckAsistenteGeneral: la reserva de la interacción va al
  // final, justo antes de devolver el contexto a ejecutarChatAsistente — un
  // rechazo anterior (saldo, perfil, asignatura ajena) nunca consume una
  // interacción real.
  const reservaLimiteChat = await reservarInteraccionChat(db, uid)

  return {
    contextoSistema: bloques.join('\n\n'),
    mensaje,
    historial: sanearHistorialChat(params?.historial),
    // Con subjectId (asignatura verificada arriba, subj.docenteId === uid) sí
    // se permite proponer una acción — ver precheckAsistenteGeneral, que
    // siempre la deja en false.
    permitirAcciones: true,
    subjectId,
    reservaLimiteChat,
  }
}

// ── Chat con Acciones — CONVERSAR → PROPONER → CONFIRMAR → EJECUTAR ────────
//
// Alcance (Kike, 17-ago-2026): solo estas tres acciones, solo por
// asignatura. La IA JAMÁS escribe Firestore ni decide el subjectId — aquí
// solo se valida/recorta la propuesta que devolvió el modelo dentro del
// mismo turno de chat_asistente (mismo crédito, ninguna operación nueva). La
// creación real la hace el CLIENTE, con la función existente de creación de
// actividades/exámenes, usando el subjectId que YA validó el precheck de
// este turno — nunca uno que la IA haya podido mencionar en el texto.
// APLICAR_EVALUACIONES_IA_PENDIENTES (26-ago-2026, MVP del Asistente con
// acciones) — a propósito NO está en OPERACIONES/PRECHECKS de arriba: esta
// acción nunca debe reservar ni liquidar créditos, ni siquiera a tarifa 0
// (eso seguiría siendo "una reserva"). Se confirma con un callable APARTE,
// fuera del ledger — ver confirmarChatAplicarEvaluacionesIA en
// functions/calificarAplicar.js, mismo patrón de aislamiento que ya usa esa
// función para el botón "Aplicar calificaciones de IA a todas".
const ACCIONES_CHAT_PERMITIDAS = [
  'CREAR_ACTIVIDAD_ENTREGABLE', 'CREAR_ACTIVIDAD_OBSERVACION', 'CREAR_EXAMEN',
  'APLICAR_EVALUACIONES_IA_PENDIENTES',
]

function sanearReactivoPropuestaChat(r) {
  const tipo = TIPOS_REACTIVO.includes(r?.tipo) ? r.tipo : 'opcion_multiple'
  const enunciado = String(r?.enunciado || '').trim().slice(0, 500)
  if (!enunciado) return null
  const base = { tipo, enunciado }
  if (tipo === 'opcion_multiple') {
    const opciones = Array.from({ length: 4 }, (_, i) => String(r?.opciones?.[i] || '').trim().slice(0, 300))
    if (opciones.filter(Boolean).length < 2) return null
    const correcta = Number.isInteger(r?.correcta) ? Math.min(3, Math.max(0, r.correcta)) : 0
    return { ...base, opciones, correcta }
  }
  if (tipo === 'verdadero_falso') return { ...base, correcta: r?.correcta === 'f' ? 'f' : 'v' }
  if (tipo === 'respuesta_corta') return { ...base, respuestaEsperada: String(r?.respuestaEsperada || '').trim().slice(0, 300) }
  return base // subir_archivo — sin datos adicionales
}

// Nunca confía en lo que "dijo" el modelo más allá de content — accion viene
// de una lista blanca, cada campo se recorta a un máximo, y una propuesta
// incompleta (sin lo que el editor manual exige) se descarta entera en vez
// de dejar que el cliente intente crear algo inválido.
function sanearPropuestaAccionChat(propuesta, { permitirAcciones }) {
  if (!permitirAcciones || !propuesta || typeof propuesta !== 'object') return null
  const accion = ACCIONES_CHAT_PERMITIDAS.includes(propuesta.accion) ? propuesta.accion : null
  if (!accion) return null

  // Sin campos propios — a propósito. Cuántas entregas se van a aplicar y
  // cuáles NUNCA se decide con nada que haya dicho el modelo; se recalcula
  // desde cero en confirmarChatAplicarEvaluacionesIA (calificarAplicar.js)
  // en el momento de confirmar, directo contra Firestore.
  if (accion === 'APLICAR_EVALUACIONES_IA_PENDIENTES') return { accion }

  const nombre = String(propuesta.nombre || '').trim().slice(0, 120)
  if (!nombre) return null
  const instrucciones = String(propuesta.instrucciones || '').trim().slice(0, 3000)
  const fechaLimiteRaw = String(propuesta.fechaLimite || '').trim()
  const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(fechaLimiteRaw) && new Date(`${fechaLimiteRaw}T23:59:59`) > new Date()
  const fechaLimite = fechaValida ? fechaLimiteRaw : null

  if (accion === 'CREAR_ACTIVIDAD_ENTREGABLE') {
    // Mismo requisito que EntregableEditor.jsx: instrucciones obligatorias
    // para un entregable (no para observación).
    if (!instrucciones) return null
    return { accion, categoria: 'entregable', nombre, instrucciones, fechaLimite }
  }
  if (accion === 'CREAR_ACTIVIDAD_OBSERVACION') {
    return { accion, categoria: 'observacion', nombre, instrucciones: instrucciones || null }
  }
  // CREAR_EXAMEN
  const reactivos = (Array.isArray(propuesta.reactivos) ? propuesta.reactivos : [])
    .map(sanearReactivoPropuestaChat).filter(Boolean).slice(0, MAX_REACTIVOS)
  if (reactivos.length < MIN_REACTIVOS) return null
  return { accion, categoria: 'examen', nombre, instrucciones: instrucciones || null, fechaLimite, reactivos }
}

const CHAT_SISTEMA =
  REGLA_ACTIVIDADES_NO_DENIGRANTES +
  'Eres el Asistente Docente de Evalúa Fácil, conversando con un docente de bachillerato mexicano. Si el ' +
  'contexto que sigue es de UNA asignatura específica, todo lo que respondas gira en torno a ella; si es un ' +
  'resumen de TODAS sus asignaturas (Asistente General), ayúdalo a decidir en qué enfocarse y a organizarse ' +
  'entre ellas, comparándolas cuando haga sentido — Y ADEMÁS (18-ago-2026: esto es parte central de tu trabajo ' +
  'en el Asistente General, no un tema fuera de tu área) responde con naturalidad cualquier pregunta sobre CÓMO ' +
  'USAR EVALÚA FÁCIL, sus créditos de IA, compra de créditos y pagos, usando la ' +
  'sección "AYUDA DE EVALÚA FÁCIL" de tu contexto — nunca digas que esos temas "no son tu área" ni remitas al ' +
  'docente a otro lugar cuando la respuesta ya está en ese bloque. Responde en español, breve y práctico, como ' +
  'un colega pedagógico con el que se conversa, no como un reporte. Usa EXCLUSIVAMENTE la información de este ' +
  'contexto — si el docente pregunta algo que no puedes responder con lo que tienes (por ejemplo, si falta un ' +
  'diagnóstico, la Planeación no está aceptada, no hay horario configurado, o pregunta un procedimiento de la ' +
  'plataforma que tu contexto no cubre), dilo en UNA sola oración corta y realista sobre el estado actual (ej. ' +
  '"El diagnóstico de la asignatura todavía no se da por terminado" o "Aún no hay resultados que analizar"), SIN ' +
  'lista de lo que sí/no ves ni menú de pasos a seguir — eso solo si el docente insiste o pregunta explícitamente ' +
  'qué puede hacer al respecto; ahí sí sugiere qué le falta generar/configurar o a dónde más puede consultarlo ' +
  '(la sección "Ayuda para comenzar" del menú, o el administrador). ' +
  'Nunca inventes calificaciones, nombres de estudiantes ni resultados que no estén en el contexto. Si tu ' +
  'contexto trae el bloque "ESTUDIANTES DE ESTA ASIGNATURA — DETALLE INDIVIDUAL", SÍ puedes (y debes, cuando te ' +
  'lo pidan) nombrar estudiantes específicos, decir quién entregó o no cada actividad y su calificación — no es un dato ' +
  'privado frente al propio docente, es exactamente lo que él ya ve en su panel; nunca lo compartas con nadie ' +
  'más que él. Cuando un diagnóstico (contexto o conocimientos) SÍ está en tu contexto, apóyate en TODO lo que ' +
  'aplique de él (características, condiciones, intereses, necesidades, patrones, recomendaciones) para dar un ' +
  'análisis con sustancia — no te quedes en un solo dato suelto si hay más evidencia ahí que responde la ' +
  'pregunta. Y nunca le pidas al docente que te copie/pegue reactivos o resultados para "analizarlos": si algo no ' +
  'está en tu contexto es porque ese diagnóstico o esa actividad todavía no tiene análisis o entregas — dilo (ver ' +
  'arriba) y remite a generarlo/analizarlo con IA desde Diagnóstico del grupo o Análisis de resultados, nunca ' +
  'invites a mandarlo aquí. No repitas ' +
  'todo el contexto en cada respuesta — ve directo a lo que te preguntan, y usa el historial de la conversación ' +
  'para entender preguntas de seguimiento (p. ej. "¿y qué actividad?" se refiere a tu respuesta anterior). Nunca ' +
  'escribas que fuiste generado por IA o por un asistente — eres una herramienta del docente, él es quien decide.'

// CORRECCIÓN 23-ago-2026 (prueba de estrés real): "próximo viernes" preguntado
// en domingo se calculó como sábado — el modelo estaba adivinando la fecha de
// hoy y haciendo aritmética de calendario él solo, sin ningún ancla real. La
// fecha/hora del servidor SÍ es un dato confiable (no depende de lo que diga
// el docente ni de lo que "recuerde" el modelo), así que el cálculo
// determinista lo hace el código — el modelo solo tiene que sumar/restar días
// a partir de un punto de partida ya correcto, no adivinarlo. Reutiliza
// DIAS_SEMANA_LARGO (mismo texto que ya se usa para sesiones/parciales) para
// no inventar una segunda lista de nombres de días. Zona horaria fija
// América/Ciudad de México: es la única zona con la que trabaja la app
// (docentes SEP en México), y el servidor de Firebase Functions corre en UTC,
// así que sin esto la fecha podía adelantarse un día en la tarde/noche.
//
// CORRECCIÓN 23-ago-2026 (segunda ronda): dar solo el ancla ("hoy es...") no
// bastó — la prueba de estrés en producción encontró "mañana" y "próximo
// viernes" calculados mal en algunas corridas, aunque el ancla en sí siempre
// fue correcta. El problema no es la fecha de hoy, es delegarle al modelo la
// ARITMÉTICA de calendario — no es 100% determinista de una corrida a otra.
// Ahora el servidor calcula un pequeño calendario (ayer/mañana/pasado
// mañana/dentro de 7 y 14 días/próximo lunes..domingo) y se lo entrega YA
// resuelto: el modelo pasa de "sumar días" a "citar el valor correcto que ya
// le dieron", que es una tarea mucho más confiable para un LLM.
//
// Aritmética segura contra DST/cambio de mes/año/bisiestos: se ancla la
// fecha civil de CDMX (año/mes/día, sin hora) a mediodía UTC — Date.UTC
// nunca tiene horario de verano, así que sumar/restar días con
// `setUTCDate` nunca se ve afectado por un salto de reloj; JS ya maneja
// correctamente el desborde de mes/año/bisiestos con setUTCDate.
const DIAS_EN_DOMINGO0 = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
// nombre (sin acentos, para no repetir claves) → índice domingo=0..sábado=6
const NOMBRE_DIA_A_DOMINGO0 = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
}

function bloqueFechaActualChat() {
  const zona = 'America/Mexico_City'
  const ahora = new Date()
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
  }).formatToParts(ahora)
  const get = (tipo) => partes.find((p) => p.type === tipo)?.value || ''
  const anio = Number(get('year'))
  const mes = Number(get('month'))
  const dia = Number(get('day'))
  const idxHoyDomingo0 = DIAS_EN_DOMINGO0.indexOf(get('weekday').toLowerCase())
  const diaSemanaHoy = idxHoyDomingo0 >= 0 ? DIAS_SEMANA_LARGO[(idxHoyDomingo0 + 6) % 7] : ''
  const fechaIso = `${get('year')}-${get('month')}-${get('day')}`

  // Ancla a mediodía UTC de la fecha civil de CDMX — ver comentario arriba.
  const ancla = new Date(Date.UTC(anio, mes - 1, dia, 12))
  function fechaOffset(deltaDias) {
    const d = new Date(ancla)
    d.setUTCDate(d.getUTCDate() + deltaDias)
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    const idxDomingo0 = ((idxHoyDomingo0 + deltaDias) % 7 + 7) % 7
    const diaSemana = DIAS_SEMANA_LARGO[(idxDomingo0 + 6) % 7]
    return `${diaSemana} ${iso}`
  }
  // "próximo <día>" = la SIGUIENTE ocurrencia de ese día posterior a hoy —
  // si hoy mismo es ese día, es el de la semana que sigue (nunca hoy).
  function proximoDiaSemana(objetivoDomingo0) {
    const delta = ((objetivoDomingo0 - idxHoyDomingo0 + 7) % 7) || 7
    return fechaOffset(delta)
  }

  const proximos = Object.entries(NOMBRE_DIA_A_DOMINGO0)
    .map(([nombre, dom0]) => `próximo ${nombre} → ${proximoDiaSemana(dom0)}`)
    .join('\n')

  return (
    `FECHA Y HORA ACTUAL (dato real del sistema, hora de Ciudad de México): ` +
    `hoy es ${diaSemanaHoy ? `${diaSemanaHoy} ` : ''}${fechaIso}.\n\n` +
    `REFERENCIAS DE CALENDARIO YA CALCULADAS por el servidor (úsalas TAL CUAL, nunca las recalcules tú — son ` +
    `exactas; "próximo <día>" siempre significa la SIGUIENTE ocurrencia de ese día después de hoy, nunca hoy ` +
    `mismo aunque hoy sea ese día):\n` +
    `ayer → ${fechaOffset(-1)}\n` +
    `hoy → ${diaSemanaHoy} ${fechaIso}\n` +
    `mañana → ${fechaOffset(1)}\n` +
    `pasado mañana → ${fechaOffset(2)}\n` +
    `dentro de 7 días / dentro de una semana → ${fechaOffset(7)}\n` +
    `dentro de 14 días / dentro de dos semanas → ${fechaOffset(14)}\n` +
    `${proximos}\n\n` +
    `Para cualquier otra fecha relativa que no esté en esta lista, calcula sumando/restando días exactos a ` +
    `partir de la fecha de hoy de arriba. Cuando propongas una fechaLimite, usa siempre el formato YYYY-MM-DD.`
  )
}

// Instrucción de Chat con Acciones, agregada SOLO cuando ctx.permitirAcciones
// (nunca en el Asistente General). Fuerza al modelo a responder siempre con
// el mismo JSON {respuesta, propuesta} — un solo formato de salida, nunca
// texto libre mezclado con JSON.
const INSTRUCCION_ACCIONES_CHAT =
  '\n\nADEMÁS: si en este turno el docente te pide EXPLÍCITAMENTE crear una actividad entregable, una ' +
  'actividad de observación, o un examen — y ya tienes info suficiente (nombre/tema y, si aplica, ' +
  'instrucciones; para examen, además los reactivos) — incluye una propuesta. Si NO tienes info suficiente ' +
  '(falta el tema, o pidió examen sin decir cuántos reactivos ni de qué trata), NO propongas nada todavía: ' +
  'pregunta lo que falta. Si solo está conversando o pidiendo ideas sin pedir crear, tampoco propongas nada. ' +
  'NUNCA propongas una acción que el docente no pidió crear. ' +
  // MVP 26-ago-2026: la única acción que no crea nada nuevo, solo aplica
  // evaluaciones de IA YA GENERADAS como calificación real. Se apoya en el
  // bloque "EVALUACIONES DE IA PENDIENTES DE APLICAR" de tu contexto — ese
  // número es solo para que sepas si hay algo que ofrecer aplicar, la
  // cantidad EXACTA que en verdad se aplique la calcula el servidor al
  // confirmar, nunca la calcules tú ni la repitas como si fuera definitiva.
  'Si el docente pregunta si hay evaluaciones de IA pendientes de aplicar, respóndele con el número real de tu ' +
  'contexto (o que no hay, si no hay). SOLO propón APLICAR_EVALUACIONES_IA_PENDIENTES cuando el docente pida ' +
  'explícitamente aplicarlas/confirmarlas y tu contexto muestre que SÍ hay al menos una pendiente — nunca la ' +
  'propongas si el contexto dice que no hay ninguna, ni la propongas solo porque preguntó cuántas hay. ' +
  'CORRECCIÓN 23-ago-2026 (prueba de estrés real): si el ' +
  'docente responde con algo elíptico que depende de tu ÚLTIMA propuesta o respuesta ("haz otra", "haz otra ' +
  'versión", "cambia esta", "otra igual pero más sencilla/difícil", "modifica la anterior", "esa no me convence", ' +
  'y similares), por default interprétalo como referido a esa última propuesta/respuesta — no como pedir algo ' +
  'nuevo sin relación — y arma la propuesta corregida o alternativa a partir de ella. Solo pregunta en vez de ' +
  'asumir cuando de verdad sea ambiguo a qué se refiere (p. ej. si hay más de una propuesta reciente distinta, o ' +
  'el mensaje también podría leerse como un tema nuevo); si no hay ambigüedad real, no le devuelvas la pregunta ' +
  'solo por precaución.\n\n' +
  'Responde SIEMPRE con este JSON exacto, sin bloques de código ni ```, nada de texto fuera de él:\n' +
  '{"respuesta": "<tu respuesta conversacional en español>", "propuesta": null}\n' +
  'o, solo cuando corresponda proponer:\n' +
  '{"respuesta": "<mensaje breve confirmando qué vas a proponer, invitando a revisar la tarjeta>", ' +
  '"propuesta": {"accion": "CREAR_ACTIVIDAD_ENTREGABLE" | "CREAR_ACTIVIDAD_OBSERVACION" | "CREAR_EXAMEN" | "APLICAR_EVALUACIONES_IA_PENDIENTES", ' +
  '"nombre": "<máx 120 caracteres — OMITIR para APLICAR_EVALUACIONES_IA_PENDIENTES>", ' +
  '"instrucciones": "<qué debe hacer o qué vas a observar — OMITIR para APLICAR_EVALUACIONES_IA_PENDIENTES>", ' +
  '"fechaLimite": "YYYY-MM-DD" | null, ' +
  '"reactivos": [ /* SOLO para examen, entre 2 y 10 */ {"tipo": "opcion_multiple"|"verdadero_falso"|"respuesta_corta"|"subir_archivo", ' +
  '"enunciado": "...", "opciones": ["...","...","...","..."], "correcta": 0, "respuestaEsperada": "..."} ]}}\n' +
  'Para APLICAR_EVALUACIONES_IA_PENDIENTES, la propuesta es solo {"accion": "APLICAR_EVALUACIONES_IA_PENDIENTES"} — sin ningún otro campo.'

// Instrucción de formato para el Asistente General (sin acciones) — igual
// necesita responder JSON, para que el parseo del lado del servidor sea uno
// solo en los dos casos.
const INSTRUCCION_FORMATO_SIN_ACCIONES =
  '\n\nResponde SIEMPRE con este JSON exacto, sin bloques de código ni ```, nada de texto fuera de él: ' +
  '{"respuesta": "<tu respuesta conversacional en español>", "propuesta": null}'

function repararSaltosLiteralesEnJson(s) {
  let dentroDeString = false
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '"' && s[i - 1] !== '\\') dentroDeString = !dentroDeString
    if (dentroDeString && (c === '\n' || c === '\r')) {
      out += c === '\n' ? '\\n' : '\\r'
    } else {
      out += c
    }
  }
  return out
}

// Causa raíz real (18-ago-2026, corrección de la corrección anterior): el
// modelo a veces termina su turno con basura DESPUÉS del `}` que en verdad
// cierra el objeto — por ejemplo `...null}` seguido de un `"}` sobrante
// (visto en producción: 1 sola `{` pero 2 `}` en el texto crudo). El
// extractor anterior usaba `indexOf('{')`/`lastIndexOf('}')` — con basura
// al final, `lastIndexOf` agarra la ÚLTIMA `}` (la de la basura, no la que
// de verdad cierra el objeto), el slice queda inválido y TODO el texto
// crudo (con llaves, comillas, "respuesta":, etc.) caía al modo de
// respaldo — literal a la vista del docente. Un ajuste al prompt no
// arregla esto: por más que se le pida al modelo no agregar basura, sigue
// siendo un modelo de lenguaje, no un serializador — el extractor tiene
// que ser tolerante a lo que de verdad llega.
//
// `extraerObjetoJsonBalanceado` no confía en la ÚLTIMA `}` del texto: desde
// la PRIMERA `{`, cuenta profundidad de llaves/corchetes respetando strings
// y escapes, y corta exactamente donde la profundidad regresa a cero — ahí
// está el verdadero cierre del objeto de nivel superior, sin importar qué
// venga después.
function extraerObjetoJsonBalanceado(texto) {
  const inicio = texto.indexOf('{')
  if (inicio === -1) return null
  let profundidad = 0
  let dentroDeString = false
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i]
    if (dentroDeString) {
      if (c === '\\') { i++; continue } // salta el carácter escapado completo
      if (c === '"') dentroDeString = false
      continue
    }
    if (c === '"') { dentroDeString = true; continue }
    if (c === '{' || c === '[') profundidad++
    else if (c === '}' || c === ']') {
      profundidad--
      if (profundidad === 0) return texto.slice(inicio, i + 1)
    }
  }
  return null // nunca volvió a profundidad 0 — objeto incompleto/cortado
}

// Causa raíz real del "Chat muestra JSON/Markdown crudo a mitad de
// respuesta" (19-ago-2026): `max_tokens` del Chat cortaba la generación de
// Anthropic ANTES de que el modelo terminara de cerrar el JSON — el string
// de "respuesta" queda sin comillas de cierre, `extraerObjetoJsonBalanceado`
// nunca vuelve a profundidad 0 (correcto: el objeto de verdad está
// incompleto) y el único respaldo que existía volcaba el texto crudo
// COMPLETO (con `{"respuesta":"`, `###`, `**` sin interpretar, y cortado a
// media palabra) directo a la pantalla del docente. Subir `max_tokens` (ver
// más abajo) reduce cuánto pasa esto, pero no lo puede eliminar del todo —
// cualquier respuesta pedida lo bastante extensa puede seguir topando el
// límite del modelo. Este extractor es la pieza que faltaba: a diferencia
// de JSON.parse, no exige que el string cierre con comillas — recupera todo
// lo que el modelo alcanzó a escribir dentro de "respuesta" aunque el JSON
// se haya cortado a la mitad, y avisa (`completo: false`) para que quien
// llama pueda decírselo al docente en vez de fingir que esa es toda la
// respuesta.
function extraerRespuestaParcial(texto) {
  const clave = texto.indexOf('"respuesta"')
  if (clave === -1) return null
  const dosPuntos = texto.indexOf(':', clave)
  if (dosPuntos === -1) return null
  const comillaInicio = texto.indexOf('"', dosPuntos)
  if (comillaInicio === -1) return null
  let out = ''
  for (let i = comillaInicio + 1; i < texto.length; i++) {
    const c = texto[i]
    if (c === '\\') {
      const sig = texto[i + 1]
      if (sig === 'n') out += '\n'
      else if (sig === 't') out += '\t'
      else if (sig === '"' || sig === '\\' || sig === '/') out += sig
      else if (sig !== undefined) out += sig
      i++
      continue
    }
    if (c === '"') return { texto: out, completo: true }
    out += c
  }
  return { texto: out, completo: false } // se acabó el texto sin comilla de cierre — sí estaba cortado
}

// Prompt caching de Anthropic (18-ago-2026) — el Chat es la única operación
// conversacional: cada turno reenvía TODO el historial + el system prompt
// completo, y ambos son casi siempre idénticos al turno anterior de la
// MISMA conversación (nada en precheckChatAsistente depende del número de
// turno — perfil, planeación, manual, diagnósticos, etc. no cambian entre
// mensajes seguidos). Eso los vuelve candidatos perfectos para el
// mecanismo OFICIAL de Anthropic (cache_control: 'ephemeral', TTL 5 min,
// GA desde el SDK actual — sin header beta) en vez de inventar una caché
// propia (expresamente pedido: no duplicar lo que Anthropic ya resuelve).
//
// Dos breakpoints (tope de Anthropic: 4 por request, aquí solo hacen falta 2):
//   1. Al final del `system` completo (instrucciones + contextoSistema) —
//      es el bloque más grande y el más estable: mismo contenido en CADA
//      turno de la conversación mientras el docente no cambie de
//      asignatura ni pase suficiente tiempo para que cambien sus datos.
//   2. Al final del último mensaje YA EXISTENTE del historial (si lo hay)
//      — cachea toda la conversación previa, dejando SOLO el mensaje que
//      el docente acaba de escribir fuera del caché (nunca se cachea lo
//      dinámico: mensaje actual, saldo, propuestas — ninguno de esos vive
//      aquí). Si el modelo es Haiku, Anthropic ignora silenciosamente el
//      breakpoint cuando el bloque no llega al mínimo de tokens cacheables
//      — no es un error, simplemente no cachea esa vez (fallback natural:
//      la llamada sigue funcionando igual, sin caché, sin cobro doble).
//
// Aislamiento (nunca se comparte caché entre docentes/asignaturas): el
// cache de Anthropic es puramente por CONTENIDO — su clave interna es un
// hash del prefijo exacto de tokens enviado. Dos conversaciones con texto
// distinto (asignatura distinta, docente distinto, perfil distinto) jamás
// generan el mismo prefijo, así que nunca pueden compartir una entrada de
// caché entre sí — no hace falta (ni existe) una "clave de caché" que se
// pudiera filtrar de un docente a otro.
function bloqueConCache(texto) {
  return [{ type: 'text', text: texto, cache_control: { type: 'ephemeral' } }]
}

async function ejecutarChatAsistente({ params, modelo, apiKey }) {
  const ctx = params.__contexto // lo puso el precheck; el cliente no puede tocarlo
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })

  const historialPrevio = ctx.historial.map((h) => ({ role: h.role, content: h.content }))
  // El breakpoint va en el ÚLTIMO mensaje YA EXISTENTE (nunca en el mensaje
  // nuevo del docente, que es lo único dinámico de `messages`).
  if (historialPrevio.length) {
    const ultimo = historialPrevio[historialPrevio.length - 1]
    ultimo.content = bloqueConCache(ultimo.content)
  }
  const messages = [...historialPrevio, { role: 'user', content: ctx.mensaje }]
  const systemTexto = CHAT_SISTEMA +
    (ctx.permitirAcciones ? INSTRUCCION_ACCIONES_CHAT : INSTRUCCION_FORMATO_SIN_ACCIONES) +
    '\n\n' + bloqueFechaActualChat() +
    '\n\n' + ctx.contextoSistema
  const system = bloqueConCache(systemTexto)

  const inicio = Date.now()
  // La interacción ya quedó RESERVADA (incrementada) en el precheck, antes
  // de llegar aquí — si algo de lo que sigue falla (Anthropic no responde,
  // o responde vacío), hay que LIBERARLA: no fue una interacción real, no
  // debe contar contra el límite del docente.
  let msg
  try {
    // 1400 → 4096 (19-ago-2026, causa raíz real del "Chat corta la
    // respuesta a mitad de una sección"): el modelo (claude-haiku-4-5)
    // acepta hasta 8192 tokens de salida, muy por encima del tope de 1400
    // que tenía este endpoint — un plan de clase completo con varias
    // secciones desarrolladas (contextualización, apertura, desarrollo,
    // cierre, evaluación, observaciones...) pedido explícitamente por el
    // docente supera 1400 tokens con facilidad. 4096 deja margen amplio
    // para una respuesta extensa real sin acercarse al techo del modelo;
    // no es "sin límite" — sigue acotado, solo que a un número calculado
    // para lo que este endpoint de verdad necesita, no arbitrario.
    msg = await client.messages.create({ model: modelo, max_tokens: 4096, system, messages })
  } catch (e) {
    liberarInteraccionChat(ctx.reservaLimiteChat)
    throw e
  }
  const texto = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()

  // El modelo a veces no obedece el formato JSON al pie de la letra: texto
  // antes del bloque, o (visto en producción) basura DESPUÉS del `}` real.
  // `extraerObjetoJsonBalanceado` encuentra el cierre VERDADERO del objeto
  // de nivel superior (por profundidad de llaves, no por "la última `}` del
  // texto") — tolera basura al final sin caer al modo de respaldo.
  let datos
  let truncado = false
  const bloqueJson = extraerObjetoJsonBalanceado(texto)
  try {
    if (!bloqueJson) throw new Error('sin JSON')
    // Bug real (18-ago-2026): cuando "respuesta" es un párrafo largo con
    // listas/saltos de línea, el modelo a veces mete el salto de línea REAL
    // dentro del string en vez de escaparlo como \n — JSON no permite
    // control characters sin escapar dentro de un string, así que
    // JSON.parse tronaba. `repararSaltosLiteralesEnJson` escapa esos saltos
    // SOLO cuando están dentro de comillas — fuera de un string un salto de
    // línea es solo espacio en blanco, válido en JSON tal cual.
    datos = JSON.parse(repararSaltosLiteralesEnJson(bloqueJson))
  } catch {
    // No parseó — lo más probable (y lo confirmado en producción) es que
    // `max_tokens` cortó al modelo a media generación, dejando el string de
    // "respuesta" sin cerrar. Ya NO se vuelca el texto crudo completo (eso
    // era lo que el docente veía como "{"respuesta":"### ...", JSON y
    // Markdown sin interpretar): se recupera solo el CONTENIDO de
    // "respuesta" con `extraerRespuestaParcial` (tolerante a que falte la
    // comilla de cierre) y se avisa con `truncado` para que el docente sepa
    // que eso no es toda la respuesta — nunca se le hace creer que sí lo es.
    const parcial = extraerRespuestaParcial(texto)
    truncado = msg.stop_reason === 'max_tokens' || !!(parcial && !parcial.completo)
    datos = { respuesta: parcial ? parcial.texto : texto, propuesta: null }
  }

  let respuesta = String(datos?.respuesta || '').trim()
  if (!respuesta) {
    liberarInteraccionChat(ctx.reservaLimiteChat)
    throw new Error('El asistente de IA no generó una respuesta utilizable')
  }
  if (truncado) {
    respuesta += '\n\nLa respuesta se cortó por ser muy extensa — pídeme que continúe donde me quedé.'
  }
  // Una propuesta que viene de un JSON que NO se pudo parsear podría estar
  // incompleta o corrupta (p. ej. cortada a media lista de reactivos) — con
  // `datos.propuesta` ya forzado a null arriba en ese caso, nunca llega
  // ninguna a sanearPropuestaAccionChat.
  const propuesta = sanearPropuestaAccionChat(datos?.propuesta, { permitirAcciones: ctx.permitirAcciones })

  return {
    resultado: {
      respuesta,
      propuesta,
      // Info del límite diario de interacciones — para que el cliente pueda
      // mostrar "X de Y interacciones" y avisar antes de bloquear. Un único
      // límite para todos los docentes (modelo de créditos puros, sin
      // distinción por plan).
      limiteChat: {
        usadas: ctx.reservaLimiteChat.usadas,
        max: ctx.reservaLimiteChat.max,
      },
    },
    unidadesReales: 1, // tarifa fija por turno — cada mensaje es su propia operación, con o sin propuesta
    interno: {
      modelo,
      // `stopReason` (19-ago-2026): antes de esto no había forma de saber,
      // ante un reporte de "respuesta cortada", si Anthropic de verdad
      // truncó por `max_tokens` o si el corte pasaba en otro punto del
      // flujo — quedar sin esta pista fue justo lo que obligó a razonar por
      // eliminación en vez de comprobar. 'end_turn' = respuesta completa,
      // 'max_tokens' = cortada por el techo de salida.
      stopReason: msg.stop_reason ?? null,
      tokensEntrada: msg.usage?.input_tokens ?? null,
      tokensSalida: msg.usage?.output_tokens ?? null,
      // Prompt caching (18-ago-2026): tokens de escritura de caché (turno
      // que crea el prefijo, cuesta 1.25x) y de lectura de caché (turnos
      // siguientes que lo reutilizan, cuestan 0.1x) — se guardan para medir
      // el ahorro real, no solo asumirlo.
      tokensCacheEscritura: msg.usage?.cache_creation_input_tokens ?? null,
      tokensCacheLectura: msg.usage?.cache_read_input_tokens ?? null,
      ms: Date.now() - inicio,
    },
  }
}

// ── Confirmar/ejecutar una acción del Chat con Acciones (18-ago-2026) ──────
//
// Nuevo modelo de cobro (Kike, 18-ago-2026): la conversación y la propuesta
// del chat ya NO cobran nada (chat_asistente pasó a tarifa 0) — el único
// cobro ocurre aquí, al confirmar, y es UNA sola operación de crédito que
// ya representa económicamente toda la conversación que llevó a ella. La
// IA no vuelve a llamarse: la propuesta ya trae el contenido completo
// (generado en un turno gratis de chat_asistente); esto solo la vuelve a
// validar contra la MISMA lista blanca del servidor (nunca confía en lo que
// mande el cliente) y hace la escritura real en Firestore con el Admin SDK
// — mismo patrón ya usado por ejecutarCrearEvaluacion (OP-03/04) para
// reactivos, no un mecanismo nuevo. Al ejecutarse aquí dentro del ejecutor
// de una operación de créditos, un fallo en la escritura reembolsa la
// reserva automáticamente (mismo catch genérico de ejecutarOperacionIA) —
// así el cobro y la creación quedan atómicos: nunca se cobra sin crear.
//
// El subjectId SIEMPRE es el que YA validó este precheck (subj.docenteId
// === uid) — nunca el que la IA pudo mencionar en el texto de la propuesta,
// ni el que mande el cliente sin verificar.

async function precalcularParcialYOrden(db, subjectId, subj) {
  const hoy = new Date().toISOString().slice(0, 10)
  const parcial = parcialForDate(subj.parcialesFechas, hoy) || Math.max(1, Number(subj.parciales) || 1)
  const existentesSnap = await db.collection('activities')
    .where('asignaturaId', '==', subjectId).where('parcial', '==', parcial).get()
  return { parcial, orden: existentesSnap.size + 1 }
}

// Propuestas duplicadas (18-ago-2026, corrección de Kike): cuando el
// docente refina una propuesta varias veces, cada turno guarda su PROPIO
// mensaje con su PROPIA propuesta — sin esto, cualquiera de esas tarjetas
// más viejas seguía siendo ejecutable, y el docente podía confirmar por
// accidente una versión ya superada. La regla es simple y no necesita un
// campo "invalidada" nuevo ni un sistema de versiones: en cada contexto
// (una asignatura) solo la propuesta PENDIENTE (sin ejecutar) más reciente
// es válida — cualquier otra, aunque el cliente la mande explícitamente,
// se rechaza aquí. "Más reciente" se decide con `creadoEn` (serverTimestamp,
// lo puso el servidor al guardarse — nunca el reloj del cliente), nunca con
// lo que diga la solicitud entrante.
//
// Además, la propuesta NUNCA viaja en `params` — el cliente solo manda
// `mensajeId`; el contenido real siempre se lee de `chatMensajes/{mensajeId}`
// (fuente única de verdad), así que no hay forma de "ejecutar" un contenido
// que el cliente haya alterado en memoria.
async function precheckAccionChat({ uid, params, accionesEsperadas }) {
  const db = getFirestore()
  const subjectId = String(params?.subjectId || '').trim()
  if (!subjectId) throw new HttpsError('invalid-argument', 'Falta la asignatura de esta acción.')
  const mensajeId = String(params?.mensajeId || '').trim()
  if (!mensajeId) throw new HttpsError('invalid-argument', 'Falta la propuesta a confirmar.')

  const subjSnap = await db.doc(`subjects/${subjectId}`).get()
  if (!subjSnap.exists) throw new HttpsError('not-found', 'La asignatura no existe')
  const subj = subjSnap.data()
  if (subj.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta asignatura no es tuya')

  const msgSnap = await db.doc(`chatMensajes/${mensajeId}`).get()
  if (!msgSnap.exists) throw new HttpsError('not-found', 'Esta propuesta ya no existe.')
  const msgData = msgSnap.data()
  if (msgData.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta propuesta no es tuya.')
  if (msgData.subjectId !== subjectId) {
    throw new HttpsError('invalid-argument', 'Esta propuesta pertenece a otra asignatura.')
  }
  if (!msgData.propuesta) throw new HttpsError('invalid-argument', 'Este mensaje no tiene una propuesta.')
  if (msgData.propuesta.ejecutada) {
    throw new HttpsError('failed-precondition', 'Esta propuesta ya fue creada.', { codigo: 'PROPUESTA_YA_EJECUTADA' })
  }

  // Solo equality en la consulta (regla del proyecto) — el orden se decide
  // en memoria con `creadoEn`.
  const pendientesSnap = await db.collection('chatMensajes')
    .where('docenteId', '==', uid).where('subjectId', '==', subjectId).where('role', '==', 'assistant').get()
  const pendientes = pendientesSnap.docs
    .map((d) => ({ id: d.id, ms: d.data().creadoEn?.toMillis?.() || 0, propuesta: d.data().propuesta }))
    .filter((m) => m.propuesta && !m.propuesta.ejecutada)
    .sort((a, b) => a.ms - b.ms)
  const masReciente = pendientes[pendientes.length - 1]
  if (!masReciente || masReciente.id !== mensajeId) {
    throw new HttpsError('failed-precondition',
      'Esta propuesta ya no está vigente — hay una más reciente en la conversación.',
      { codigo: 'PROPUESTA_SUPERADA' })
  }

  // Se vuelve a saneear la propuesta LEÍDA DE FIRESTORE — es exactamente el
  // mismo saneamiento que ya corrió al proponerla (defensa en profundidad,
  // nunca se confía en un contenido ya guardado sin volver a validarlo).
  const propuesta = sanearPropuestaAccionChat(msgData.propuesta, { permitirAcciones: true })
  if (!propuesta) throw new HttpsError('invalid-argument', 'La propuesta no es válida o está incompleta.')
  if (!accionesEsperadas.includes(propuesta.accion)) {
    throw new HttpsError('invalid-argument', 'Esta propuesta no corresponde a esta acción.')
  }

  const { parcial, orden } = await precalcularParcialYOrden(db, subjectId, subj)
  return { subjectId, docenteId: uid, parcial, orden, propuesta, mensajeId }
}

const ACCIONES_ACTIVIDAD = ['CREAR_ACTIVIDAD_ENTREGABLE', 'CREAR_ACTIVIDAD_OBSERVACION']

async function precheckChatCrearActividad({ uid, params }) {
  return precheckAccionChat({ uid, params, accionesEsperadas: ACCIONES_ACTIVIDAD })
}

async function precheckChatCrearExamen({ uid, params }) {
  const ctx = await precheckAccionChat({ uid, params, accionesEsperadas: ['CREAR_EXAMEN'] })
  // Tarifa DEFINITIVA por tramos de 10 reactivos (Kike, 18-ago-2026) — el
  // cliente nunca puede bajarla: `unidadesMinimas` la fija aquí, a partir
  // del número REAL de reactivos ya saneados, y ejecutarOperacionIA nunca
  // deja reservar menos de esto (ver el comentario junto a `unidadesMinimas`
  // en el callable).
  return { ...ctx, unidadesMinimas: calcularTarifaExamen(ctx.propuesta.reactivos.length) }
}

async function ejecutarChatCrearActividad({ params }) {
  const ctx = params.__contexto
  const db = getFirestore()
  const p = ctx.propuesta
  const isObservacion = p.categoria === 'observacion'
  const resolved = resolveVisibilidad({
    visibilidadMode: 'show', publishedAt: '', publishAt: '',
    fechaLimite: isObservacion ? null : p.fechaLimite, asDraft: false,
  })
  if (!resolved.ok) throw new Error(resolved.error)

  const ref = db.collection('activities').doc()
  await ref.set({
    nombre: p.nombre,
    categoria: isObservacion ? 'observacion' : 'entregable',
    tipo: isObservacion ? 'observacion' : 'archivo',
    maxCalif: 10,
    instrucciones: p.instrucciones || '',
    archivosAdjuntos: [],
    fechaLimite: isObservacion ? null : (p.fechaLimite || null),
    tiposArchivo: [],
    extensionesCustom: '',
    oculta: resolved.oculta,
    publishAt: resolved.publishAt,
    publishedAt: resolved.publishedAt,
    recibirTarde: isObservacion ? null : false,
    rubrica: null,
    rubricaId: null,
    notificarDocente: false,
    parcial: ctx.parcial,
    orden: ctx.orden,
    asignaturaId: ctx.subjectId,
    docenteId: ctx.docenteId,
    createdAt: FieldValue.serverTimestamp(),
  })

  // Marca la propuesta como ejecutada AQUÍ, en el servidor — no depende de
  // que el cliente haga una segunda escritura después de esta respuesta
  // (si esa segunda escritura fallara por red, un reintento del docente
  // habría encontrado la MISMA propuesta todavía "pendiente" y la habría
  // vuelto a cobrar y crear). Con esto, el marcado y la creación quedan en
  // la misma operación atómica del ledger.
  await db.doc(`chatMensajes/${ctx.mensajeId}`).update({
    'propuesta.ejecutada': true, 'propuesta.activityId': ref.id,
  })

  return { resultado: { activityId: ref.id }, unidadesReales: 1, interno: null }
}

function idOpcionExamenChat() {
  return `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

// CORRECCIÓN 23-ago-2026 (prueba de estrés real, "LA CORRECCIÓN MÁS
// IMPORTANTE" — Kike): la prueba encontró 2 de 5 claves verdadero/falso
// objetivamente incorrectas en un examen generado en vivo. No existe una
// regla lingüística determinista confiable para decidir si un enunciado es
// verdadero o falso (depende del CONTENIDO, no de la forma de la frase), así
// que la validación real solo puede venir de una segunda revisión de IA,
// ciega a lo que propuso la primera (para no arrastrar el mismo sesgo/error):
// se le da SOLO el enunciado, nunca la clave propuesta, y se compara. Si no
// coincide, se corrige la clave en memoria ANTES de escribirla a Firestore —
// nunca se publica una clave ya identificada como incorrecta. Si la
// verificación misma falla (red, JSON inválido), se conserva la clave
// original: no es peor que el comportamiento previo a esta corrección, y no
// hay forma honesta de "corregir" sin una respuesta válida del verificador.
// No agrega costo al docente: mismo modelo que ya se usa para
// chat_crear_examen (tarifas/modeloPorOperacion sin cambios), sin unidad de
// cobro adicional — el costo de esta llamada lo absorbe el margen de la
// tarifa por examen, igual que cualquier otro costo interno de calidad.
//
// CORRECCIÓN 23-ago-2026 (segunda ronda, con logging ya instrumentado): el
// diagnóstico anterior encontró la causa exacta con evidencia real —
// Anthropic a veces antepone/agrega texto fuera del JSON ("Claro, aquí
// está: {...}"), y `JSON.parse()` estricto de `pedirJSON` truena con eso,
// cayendo al catch (silencioso antes, ahora logueado) que conserva la
// clave original — el bug NO es de lógica, es de tolerancia de parsing.
// `extraerJsonVeredictos` intenta el parse estricto primero (caso normal) y
// SOLO si falla, recorta el primer '{' al último '}' de la respuesta e
// intenta de nuevo — nunca interpreta texto libre ni adivina veredictos por
// fuera de un objeto JSON real. Esta función usa su PROPIA llamada a
// Anthropic (no pedirJSON) precisamente para tener el texto crudo
// disponible en caso de que el parse estricto falle — pedirJSON descarta el
// texto en cuanto JSON.parse truena, así que reusarlo aquí habría requerido
// tocar una función compartida por todas las demás operaciones de IA, fuera
// del alcance de esta corrección.
function extraerJsonVeredictos(texto) {
  try {
    return { datos: JSON.parse(texto), tolerante: false }
  } catch {
    // sigue abajo con el intento tolerante
  }
  const inicio = texto.indexOf('{')
  const fin = texto.lastIndexOf('}')
  if (inicio === -1 || fin === -1 || fin <= inicio) return { datos: null, tolerante: true }
  try {
    return { datos: JSON.parse(texto.slice(inicio, fin + 1)), tolerante: true }
  } catch {
    return { datos: null, tolerante: true }
  }
}

async function validarClavesVerdaderoFalso({ reactivos, client, modelo }) {
  const objetivo = reactivos.filter((r) => r.tipo === 'verdadero_falso' && r.enunciado)
  // DIAGNÓSTICO temporal (23-ago-2026, prueba de estrés post-deploy): el
  // catch de abajo era completamente silencioso — sin esto no había forma
  // de saber si la segunda verificación de claves V/F no se llamaba, fallaba
  // la llamada a Anthropic, fallaba el JSON, o la estructura de veredictos
  // no cuadraba. Nunca registra prompt/respuesta completos ni el secreto —
  // solo conteos y el tipo/código de error. Quitar una vez diagnosticada la
  // causa raíz.
  if (!objetivo.length) {
    logger.info('validarClavesVerdaderoFalso: sin reactivos V/F, no se verifica nada')
    return
  }
  logger.info(`validarClavesVerdaderoFalso: verificando ${objetivo.length} reactivo(s) V/F`)

  const lista = objetivo.map((r, idx) => `${idx + 1}. ${r.enunciado}`).join('\n')
  const system =
    'Eres un verificador factual estricto. Para cada enunciado numerado, decide si es VERDADERO o FALSO ' +
    'como afirmación objetiva, sin ningún contexto adicional más que el propio enunciado. No te importa quién ' +
    'lo escribió ni para qué se usará — solo si el enunciado, tomado literalmente, es cierto o no. Responde ' +
    'ÚNICAMENTE con el objeto JSON pedido, nada de texto antes o después: ' +
    '{"veredictos": ["v"|"f", ...]} en el MISMO orden y con la MISMA cantidad de elementos que los enunciados ' +
    'recibidos.'
  const prompt = `Enunciados a verificar:\n${lista}`

  let texto
  try {
    const msg = await client.messages.create({
      model: modelo, max_tokens: 600, system, messages: [{ role: 'user', content: prompt }],
    })
    texto = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
    if (texto.startsWith('```')) texto = texto.replace(/^```(json)?\n?/, '').replace(/```$/, '').trim()
  } catch (e) {
    // Error real de la llamada a Anthropic (trae .status, típico de
    // @anthropic-ai/sdk) — nunca el mensaje completo del SDK (puede traer
    // fragmentos del prompt/respuesta), solo nombre/status/código.
    logger.warn('validarClavesVerdaderoFalso: la llamada a Anthropic falló, se conserva la clave original', {
      tipoError: e?.name || typeof e,
      status: e?.status ?? null,
    })
    return // verificación no disponible: se conserva la clave original, sin marcarla como incorrecta
  }

  const { datos, tolerante } = extraerJsonVeredictos(texto)
  if (datos === null) {
    logger.warn('validarClavesVerdaderoFalso: la respuesta no contiene un JSON válido, se conservan las claves originales')
    return
  }
  if (tolerante) logger.info('validarClavesVerdaderoFalso: el parseo estricto falló pero el parseo tolerante extrajo un JSON válido')

  const veredictos = Array.isArray(datos?.veredictos) ? datos.veredictos : null
  const veredictosValidos = veredictos?.length === objetivo.length
    && veredictos.every((v) => v === 'v' || v === 'f')
  if (!veredictosValidos) {
    logger.warn('validarClavesVerdaderoFalso: respuesta con estructura inesperada, se conservan las claves originales', {
      recibioArray: Array.isArray(veredictos),
      cantidadEsperada: objetivo.length,
      cantidadRecibida: Array.isArray(veredictos) ? veredictos.length : null,
      valoresValidos: Array.isArray(veredictos) ? veredictos.every((v) => v === 'v' || v === 'f') : null,
    })
    return // respuesta no confiable (longitud distinta o algún valor fuera de 'v'/'f'): no se corrige a ciegas
  }

  let corregidos = 0
  objetivo.forEach((r, idx) => {
    const veredicto = veredictos[idx]
    if (veredicto !== r.correcta) {
      logger.warn(`V/F corregido por segunda verificación: "${r.enunciado.slice(0, 80)}" ${r.correcta} → ${veredicto}`)
      r.correcta = veredicto
      corregidos += 1
    }
  })
  logger.info(`validarClavesVerdaderoFalso: verificación completada, ${corregidos}/${objetivo.length} clave(s) corregida(s)`)
}

async function ejecutarChatCrearExamen({ params, modelo, apiKey }) {
  const ctx = params.__contexto
  const db = getFirestore()
  const p = ctx.propuesta

  if (p.reactivos.some((r) => r.tipo === 'verdadero_falso')) {
    // DIAGNÓSTICO temporal (23-ago-2026) — ver comentario en
    // validarClavesVerdaderoFalso: confirma que la llamada realmente se
    // hizo desde aquí, para descartar que el guard nunca entre.
    logger.info('ejecutarChatCrearExamen: invocando validarClavesVerdaderoFalso')
    const Anthropic = require('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })
    await validarClavesVerdaderoFalso({ reactivos: p.reactivos, client, modelo })
  }
  const resolved = resolveVisibilidad({
    visibilidadMode: 'show', publishedAt: '', publishAt: '', fechaLimite: p.fechaLimite, asDraft: false,
  })
  if (!resolved.ok) throw new Error(resolved.error)

  const ref = db.collection('activities').doc()
  await ref.set({
    nombre: p.nombre,
    categoria: 'examen',
    instrucciones: p.instrucciones || '',
    archivosAdjuntos: [],
    fechaLimite: p.fechaLimite || null,
    recibirTarde: false,
    oculta: resolved.oculta,
    publishAt: resolved.publishAt,
    publishedAt: resolved.publishedAt,
    maxCalif: 10,
    notificarDocente: false,
    tipo: 'evaluacion',
    evaluacion: EVALUACION_DEFAULTS.examen,
    parcial: ctx.parcial,
    orden: ctx.orden,
    asignaturaId: ctx.subjectId,
    docenteId: ctx.docenteId,
    createdAt: FieldValue.serverTimestamp(),
  })

  // Mismo reparto público/clave que crearPreguntasEnLote (utils/evaluacionClave.js)
  // ya hace del lado del cliente para "Agregar desde el Banco" — aquí con
  // el Admin SDK porque la creación completa vive en el servidor.
  const batch = db.batch()
  p.reactivos.forEach((r, i) => {
    const pregRef = db.collection(`activities/${ref.id}/preguntas`).doc()
    const claveRef = db.collection(`activities/${ref.id}/clave`).doc(pregRef.id)
    const base = { tipo: r.tipo, enunciado: r.enunciado, ponderacion: 1, retroalimentacion: null, imagenUrl: null, orden: i, origenBancoId: null }
    if (r.tipo === 'opcion_multiple') {
      const opciones = r.opciones.filter(Boolean).map((texto) => ({ id: idOpcionExamenChat(), texto: texto.trim() }))
      const idx = Math.min(opciones.length - 1, Math.max(0, r.correcta ?? 0))
      batch.set(pregRef, { ...base, opciones })
      batch.set(claveRef, { respuestaCorrecta: opciones[idx]?.id ?? opciones[0]?.id ?? null, respuestaEsperada: null })
    } else if (r.tipo === 'verdadero_falso') {
      batch.set(pregRef, { ...base, opciones: [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }] })
      batch.set(claveRef, { respuestaCorrecta: r.correcta === 'f' ? 'f' : 'v', respuestaEsperada: null })
    } else if (r.tipo === 'respuesta_corta') {
      batch.set(pregRef, { ...base, opciones: null })
      batch.set(claveRef, { respuestaCorrecta: null, respuestaEsperada: r.respuestaEsperada || null })
    } else { // subir_archivo
      batch.set(pregRef, { ...base, opciones: null })
      batch.set(claveRef, { respuestaCorrecta: null, respuestaEsperada: null })
    }
  })
  await batch.commit()
  await ref.update({ 'evaluacion.numPreguntas': p.reactivos.length })
  // Mismo criterio que ejecutarChatCrearActividad: marcar ejecutada aquí
  // evita que un reintento del cliente pueda volver a cobrar/crear.
  await db.doc(`chatMensajes/${ctx.mensajeId}`).update({
    'propuesta.ejecutada': true, 'propuesta.activityId': ref.id,
  })

  // unidadesReales = EXACTAMENTE lo que ya fijó el precheck (unidadesMinimas)
  // — el ejecutor no puede ni subirlo ni bajarlo por su cuenta.
  return { resultado: { activityId: ref.id, numReactivos: p.reactivos.length }, unidadesReales: ctx.unidadesMinimas, interno: null }
}

// ── Traducción de errores del ledger a HttpsError ───────────────────────────
function comoHttpsError(e) {
  if (e instanceof HttpsError) return e
  if (e instanceof ledger.ErrorCreditos) {
    const codigos = {
      SALDO_INSUFICIENTE: 'failed-precondition',
      OPERACION_DESCONOCIDA: 'invalid-argument',
      CLAVE_INVALIDA: 'invalid-argument',
      SIN_TARIFAS: 'failed-precondition',
    }
    return new HttpsError(codigos[e.codigo] || 'failed-precondition', e.message, { codigo: e.codigo, ...e.datos })
  }
  logger.error('ejecutarOperacionIA: error inesperado', e)
  return new HttpsError('internal', 'No se pudo completar la operación. No se descontaron créditos.')
}

// timeoutSeconds 300: los lotes de C-02 (p. ej. 50 estudiantes × 3 abiertas)
// toman ~2 min con la concurrencia limitada; las operaciones unitarias no
// cambian. El cliente ajusta su propio timeout al llamar (useCreditosIA).
exports.ejecutarOperacionIA = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 300 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para usar la IA')

    const db = getFirestore()
    const perfil = await db.doc(`users/${uid}`).get()
    if (!perfil.exists || perfil.data().role !== 'docente') {
      throw new HttpsError('permission-denied', 'La IA de Evalúa Fácil es para docentes')
    }

    const { operacion, idempotencyKey, params = {}, unidades = 1 } = request.data || {}
    const ejecutor = OPERACIONES[operacion]
    if (!ejecutor) {
      throw new HttpsError('unimplemented', 'Esta operación de IA aún no está disponible')
    }
    const unidadesCliente = Number.isInteger(unidades) && unidades > 0 && unidades <= 500 ? unidades : 1

    // Comprobaciones previas a CUALQUIER cobro: propiedad de la actividad,
    // categoría válida y suficiencia del contexto. Si algo de esto falla, el
    // docente se entera sin que se haya reservado ni descontado un crédito
    // (no hay reserva que reembolsar porque nunca llegó a existir).
    let precontexto = null
    if (PRECHECKS[operacion]) {
      precontexto = await PRECHECKS[operacion]({ uid, params })
    }

    // El precheck puede saber, ANTES de reservar, que esta operación va a
    // necesitar más unidades que las que pidió el cliente — p. ej. Planeación
    // Inicial con un documento fuente grande que requiere fragmentarse
    // (Kike, 17-ago-2026: "el tamaño del documento puede aumentar el costo,
    // pero nunca provocar pérdida silenciosa de contenido"). El cliente
    // nunca puede BAJAR lo que el precheck determinó necesario — solo
    // puede pedir más (unidades > 1 en operaciones que sí lo usan así).
    const unidadesMinimas = Number.isInteger(precontexto?.unidadesMinimas) && precontexto.unidadesMinimas > 0
      ? Math.min(precontexto.unidadesMinimas, 500)
      : 0
    const n = Math.max(unidadesCliente, unidadesMinimas)

    let tarifas
    let reserva
    try {
      tarifas = await ledger.cargarTarifas()
      reserva = await ledger.reservar({ uid, operacion, idempotencyKey, unidades: n, asignaturaId: params.asignaturaId || null, tarifas })
    } catch (e) {
      throw comoHttpsError(e)
    }

    // Reintento de una clave ya vista: no se cobra de nuevo.
    if (reserva.repetida) {
      const c = reserva.consumo
      if (c.estado === 'ejecutado') {
        const creditos = await db.doc(`iaCreditos/${uid}`).get()
        return { repetida: true, resultado: c.resultado, creditosReales: c.creditosReales, saldo: creditos.data()?.saldo ?? null }
      }
      if (c.estado === 'reservado') {
        throw new HttpsError('aborted', 'Esta operación ya está en proceso. Espera un momento.')
      }
      throw new HttpsError('failed-precondition', 'Esta operación falló antes. Intenta de nuevo.', { estadoPrevio: c.estado })
    }

    // Ejecución de la IA. Cualquier fallo → reembolso íntegro de la reserva.
    let salida
    try {
      const modelo = tarifas.modeloPorOperacion?.[operacion]
      if (!modelo) throw new HttpsError('failed-precondition', 'La operación no tiene modelo configurado')
      // __uid, __idempotencyKey y __contexto los pone el servidor — cualquier
      // valor que mandara el cliente se sobreescribe aquí. En particular
      // __contexto es el contenido REAL de la actividad, leído de Firestore
      // por el precheck: el ejecutor nunca usa texto pedagógico del cliente.
      salida = await ejecutor({
        params: { ...params, __uid: uid, __idempotencyKey: idempotencyKey, __contexto: precontexto },
        modelo, apiKey: ANTHROPIC_API_KEY.value(), unidades: n,
      })
    } catch (e) {
      await ledger.reembolsar({ uid, idempotencyKey, motivo: String(e.message || e).slice(0, 300) })
        .catch((err) => logger.error(`reembolso(${idempotencyKey}) falló:`, err))
      if (e instanceof HttpsError) throw e
      logger.error(`IA(${operacion}) falló:`, e)
      throw new HttpsError('unavailable', 'El asistente de IA no está disponible en este momento. No se descontaron créditos.')
    }

    // Consumo REAL: unidades procesadas × tarifa — lo calcula el código,
    // jamás la IA.
    //
    // Se computa AQUÍ, antes de la métrica interna (26-ago-2026): antes vivía
    // después del `.set()`, así que `iaConsumosInterno` guardaba tokens pero
    // NO cuántas unidades se procesaron ni cuántos créditos se cobraron. Sin
    // esos tres campos no se puede calcular el margen de las operaciones que
    // cobran POR UNIDAD (`reactivos` y `crear_evaluacion_ia` cobran por
    // reactivo generado; `calificar_entregable_ia_lote`, por entrega) — el
    // registro decía cuánto costó, pero no cuánto se cobró por ello. Es
    // también lo que necesita `rentabilidad_creditos` en adminChat.js para
    // sacar el costo por crédito.
    const porUso = tarifas.tarifas[operacion]
    // Defensivo: hoy TODOS los ejecutores devuelven `unidadesReales` (ver
    // OPERACIONES arriba). Si uno nuevo lo olvidara, `unidadesRealesMetrica`
    // se registra como null (dato ausente, que las herramientas saben
    // excluir) — pero el COBRO nunca puede caer en ese hueco: `Math.max(null,
    // 0)` se evalúa a 0 en JS, así que pasar null a ledger.liquidar cobraría
    // 0 créditos EN SILENCIO por una operación que sí se ejecutó (peor que un
    // NaN visible, que era el comportamiento anterior). Por eso el cobro usa
    // `unidadesParaCobro`, que cae a `n` (el tope ya reservado) en vez de a
    // cero — el docente paga lo que reservó, nunca menos por un defecto.
    const unidadesRealesMetrica = Number.isFinite(salida.unidadesReales) ? salida.unidadesReales : null
    if (unidadesRealesMetrica == null) {
      logger.error(`ejecutarOperacionIA(${operacion}): el ejecutor no devolvió unidadesReales — se cobra el tope reservado (${n})`)
    }
    const unidadesParaCobro = unidadesRealesMetrica ?? n
    const creditosReales = Math.min(unidadesParaCobro, n) * porUso

    // Métricas internas (tokens, modelo, unidades y créditos): fuera del
    // alcance del cliente.
    db.doc(`iaConsumosInterno/${idempotencyKey}`)
      .set({
        uid, operacion, ...salida.interno,
        // Lo que de verdad se procesó (reactivos generados, entregas
        // evaluadas, respuestas sugeridas…). Es el denominador del costo
        // unitario real. null si el ejecutor no lo reportó (ver arriba) —
        // nunca se rellena con el tope reservado aquí, a diferencia del cobro.
        unidadesReales: unidadesRealesMetrica,
        // El tope que se reservó. `n` puede ser mayor que `unidadesReales`
        // (se reserva la estimación máxima y se liquida lo real), así que
        // guardar ambos deja ver cuánto se sobre-reserva por operación.
        unidadesCobradas: n,
        // Lo que se cobró en créditos. En el camino diferido todavía no se
        // sabe: lo liquida `confirmarJuego` (functions/juego.js), que
        // completa este mismo documento al hacerlo.
        // Se completa en functions/juego.js: `creditosReales` real cuando el
        // docente confirma (confirmarJuego), o 0 si cancela el borrador
        // (cancelarBorradorJuego). HUECO CONOCIDO: si la reserva expira SOLA
        // (limpiarReservasHuerfanas en creditosLedger.js, sin que el docente
        // confirme ni cancele) este registro se queda en null para siempre —
        // no se tocó esa limpieza porque es infraestructura compartida por
        // TODAS las operaciones, no solo el juego, y expandirla ahí es un
        // cambio aparte.
        creditosReales: salida.diferirLiquidacion ? null : creditosReales,
        liquidacionDiferida: !!salida.diferirLiquidacion,
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch((err) => logger.error('iaConsumosInterno:', err))

    // CORRECCIÓN 23-ago-2026 (Crucigrama/Sopa de letras, decisión de Kike):
    // si el ejecutor pide diferir la liquidación (hoy solo
    // generar_contenido_juego), la reserva se queda EN 'reservado' —
    // ninguna otra operación toca este camino. El docente ya vio descontado
    // su saldo (reservar() ya lo restó), pero el cobro definitivo espera a
    // que confirme el juego terminado (functions/juego.js → confirmarJuego)
    // o se libera si cancela/expira. Sin esto, cada regeneración de
    // contenido tendría que cobrar de nuevo para poder "deshacer" un cobro
    // ya liquidado — con la reserva viva, no hace falta deshacer nada.
    if (salida.diferirLiquidacion) {
      return { resultado: salida.resultado, reservado: true, idempotencyKey }
    }

    let liquidacion
    try {
      liquidacion = await ledger.liquidar({ uid, idempotencyKey, creditosReales, resultado: salida.resultado })
    } catch (e) {
      // El resultado existe pero la liquidación falló: NO se reembolsa (el
      // trabajo se hizo). La reserva quedará 'reservada' y con el resultado
      // en mano del cliente; la limpieza la expira y devuelve la diferencia.
      logger.error(`liquidar(${idempotencyKey}) falló:`, e)
      return { resultado: salida.resultado, creditosReales, saldo: null, advertencia: 'liquidacion-pendiente' }
    }

    return {
      resultado: salida.resultado,
      creditosReales: liquidacion.repetida ? liquidacion.consumo.creditosReales : liquidacion.creditosReales,
      saldo: liquidacion.repetida ? null : liquidacion.saldo,
    }
  }
)

// Mantenimiento diario: en créditos puros ya no hay ciclos que renovar ni
// trials que cerrar por tiempo — solo queda recuperar reservas huérfanas
// (proceso que murió entre reservar() y liquidar()/reembolsar()).
exports.mantenimientoCreditosIA = onSchedule('every 24 hours', async () => {
  try {
    // generar_contenido_juego (23-ago-2026): su reserva queda abierta
    // mientras el docente edita/reconstruye el tablero (Crucigrama/Sopa de
    // letras) — un ciclo de minutos u horas reales, no segundos como el
    // resto. 2 horas le da margen de sobra sin tener que crear un segundo
    // scheduled job.
    const lim = await ledger.limpiarReservasHuerfanas({
      minutos: 15,
      minutosPorOperacion: { generar_contenido_juego: 120 },
    })
    logger.info(`mantenimientoCreditosIA: ${lim.recuperadas} reserva(s) recuperada(s)`)
  } catch (e) {
    logger.error('mantenimientoCreditosIA:', e)
  }
})

// Lógica pura expuesta para las pruebas (test/ia-creditos.test.mjs): el
// armado del contexto de la actividad padre y su regla de suficiencia, que es
// donde vive la decisión de "no alcanza, no se cobra".
exports._pruebas = {
  contextoDeActividad, condicionesEntregable, textoPlano, precheckInstrumento, PADRES_VALIDOS, MIN_INSTRUCCIONES,
  precheckReactivos, tiposParaLote, normalizarReactivos, TIPOS_REACTIVO, MIN_QUIERE_EVALUAR, MIN_REACTIVOS, MAX_REACTIVOS,
  agregarResultados, normalizarAnalisis, precheckAnalisisResultados, MIN_ENTREGAS_ANALISIS, TIPOS_OBJETIVOS_ANALISIS,
  agregarResultadosEncuesta, normalizarAnalisisEncuestaContexto, promptAnalisisEncuestaContexto, ENCUESTA_CONTEXTO_SISTEMA,
  repartirPonderacion, precheckCrearEvaluacion, MAX_REACTIVOS_EVALUACION,
  promptCrearEvaluacion,
  precheckCrearActividad, sanitizarInstruccionesHtml, TIPOS_ARCHIVO_VALIDOS, MIN_PETICION_ACTIVIDAD, MAX_PETICION_ACTIVIDAD,
  precheckDiagnosticoBase, precheckDiagnosticoContexto, precheckDiagnosticoConocimientos, seleccionarFuentesGenerales, perfilIACompleto, perfilIATexto,
  promptInstrumentoContexto, normalizarPreguntasContexto, promptDiagnosticoConocimientos,
  MAX_REACTIVOS_DIAGNOSTICO, MIN_REACTIVOS_DIAGNOSTICO, MIN_PREGUNTAS_CONTEXTO, MAX_PREGUNTAS_CONTEXTO,
  precheckPlaneacionInicial, formatoPeriodo, construirParcialesCtx, formatoSesionesReales, diagnosticoContextoATexto, diagnosticoConocimientosATexto,
  analisisDiagnosticoMasReciente,
  comentariosGrupoATexto, autoanalisisDocenteATexto,
  bloqueFuentesPermanentes, bloqueFuentesOperacion, excluirUrlsPermanentes,
  promptSecuenciasParcial, CAMPOS_IDENTIDAD_SECUENCIA, CAMPOS_MOMENTO,
  sumaPonderacionesParcial, normalizarPonderacionesParcial, promptCorreccionPonderaciones, PONDERACION_TOTAL,
  coberturaIncompleta, promptCorreccionCobertura,
  promptExtraerTemasFragmento, construirBloqueFuenteEstructurada, extraerTemasDeDocumentoGrande,
  FUENTE_UMBRAL_FRAGMENTAR_CHARS, FUENTE_FRAGMENTO_MAX_CHARS, calcularUnidadesMinimasFuente,
  precheckChatAsistente, sanearHistorialChat, planeacionAceptadaATexto, analisisExamenesATexto,
  CHAT_SISTEMA, MAX_TURNOS_HISTORIAL, MAX_LARGO_MENSAJE,
  resumenGeneralATexto, precheckAsistenteGeneral,
  sanearPropuestaAccionChat, sanearReactivoPropuestaChat, ACCIONES_CHAT_PERMITIDAS,
  reservarInteraccionChat, liberarInteraccionChat, claveLimiteChatDiario,
  LIMITE_CHAT_DIARIO,
  verificarSaldoChat, calcularTarifaExamen, precheckChatCrearActividad, precheckChatCrearExamen,
  ACCIONES_ACTIVIDAD,
  precheckCalificarEntregable, bloqueCriteriosInstrumento, precheckCalificarEntregableLote, rubricaFirma,
  pendientesEvaluacionesIATexto,
  validarClavesVerdaderoFalso, bloqueFechaActualChat, extraerJsonVeredictos,
  CALIFICAR_ENTREGABLE_SISTEMA,
}
