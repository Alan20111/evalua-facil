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
// Lógica PURA de calendario/sesiones, compartida con el cliente — ver
// src/utils/sesionesReales.js (fuente real) y scripts/sync-functions-shared.mjs
// (genera esta copia en cada predeploy; también hay que correrlo a mano antes
// de `npm run test:unit/test:server/test:ia`, ya cubierto por los pretest:*
// de package.json).
const { calcularSesionesReales } = require('./_shared/sesionesReales.js')
const { fechasVacacionParaClases } = require('./_shared/vacaciones.js')

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
//     'crear_actividad_ia' (11-ago-2026, misma autorización).
const OPERACIONES = {
  aviso: ejecutarAviso,
  calificar_abierta: ejecutarCalificarAbierta,
  rubrica: ejecutarRubrica,
  cotejo: ejecutarCotejo,
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
}

// Comprobaciones que corren ANTES de reservar créditos. Una operación con
// precheck no llega al ledger si el contexto no da: el docente recibe un
// mensaje que le dice qué le falta y su saldo queda intacto (no hay reserva
// que reembolsar porque nunca existió). Lo que devuelve el precheck viaja al
// ejecutor, que así no vuelve a leer nada de Firestore.
const PRECHECKS = {
  rubrica: precheckInstrumento, cotejo: precheckInstrumento, reactivos: precheckReactivos,
  analizar_resultados: precheckAnalisisResultados, crear_evaluacion_ia: precheckCrearEvaluacion,
  crear_actividad_ia: precheckCrearActividad,
  diagnostico_contexto: precheckDiagnosticoContexto, diagnostico_conocimientos: precheckDiagnosticoConocimientos,
  planeacion_didactica_inicial: precheckPlaneacionInicial,
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

// Llamada + lectura del JSON, común a rúbrica/cotejo/reactivos.
async function pedirJSON({ client, modelo, maxTokens, prompt, system = INSTRUMENTO_SISTEMA }) {
  const inicio = Date.now()
  const msg = await client.messages.create({
    model: modelo,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
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

  const { datos, interno } = await pedirJSON({
    client, modelo, maxTokens: 1500,
    prompt: bloqueContexto(ctx, asignatura) +
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

  const { datos, interno } = await pedirJSON({
    client, modelo, maxTokens: 800,
    prompt: bloqueContexto(ctx, asignatura) +
      `\nPropón una LISTA DE COTEJO de ${numCriterios} indicadores. Cada indicador se marca ` +
      'cumple / no cumple, así que debe ser VERIFICABLE de un vistazo y sin ' +
      'grados intermedios (nada de "adecuadamente" o "de manera suficiente").\n\n' +
      'Responde SOLO con este JSON:\n' +
      '{\n' +
      '  "titulo": "<nombre de la lista, máx 60 caracteres>",\n' +
      '  "descripcion": "<una frase sobre qué verifica>",\n' +
      '  "criterios": [{"nombre": "<indicador verificable, máx 12 palabras>"}]\n' +
      '}',
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

  const reactivos = normalizarReactivos(datos, ctx)
  // Regla de no invención (T.7): si el modelo no devolvió nada aprovechable,
  // esto NO se cobra — cae al catch del callable, que reembolsa la reserva.
  if (!reactivos.some((r) => r.enunciado)) {
    throw new Error('El asistente de IA no generó reactivos utilizables')
  }

  return {
    resultado: { reactivos, clase: ctx.clase },
    unidadesReales: 1,
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

const MAX_REACTIVOS_EVALUACION_TRIAL = 10
const MAX_REACTIVOS_EVALUACION_PAGO = 100
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

  // Tope de reactivos según el plan del docente — mismo criterio que
  // creditosLedger.reservar para saber su nivel (la suscripción más reciente).
  const subsSnap = await db.collection('subscriptions').where('docenteId', '==', uid).get()
  let sub = null
  const ms = (s) => s.updatedAt?.toMillis?.() || 0
  subsSnap.docs.forEach((d) => { if (!sub || ms(d.data()) > ms(sub)) sub = d.data() })
  const nivel = ledger.nivelDeSuscripcion(sub)
  const tope = nivel === 'trial' ? MAX_REACTIVOS_EVALUACION_TRIAL : MAX_REACTIVOS_EVALUACION_PAGO

  const cantidad = clampInt(params?.cantidad, 10, MIN_REACTIVOS, tope)
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
const CAMPOS_MOMENTO = [
  { clave: 'actividades', etiqueta: 'Actividades de enseñanza-aprendizaje' },
  { clave: 'recursos', etiqueta: 'Recursos y materiales' },
  { clave: 'estrategiaEvaluacion', etiqueta: 'Estrategia de evaluación' },
  { clave: 'evidencias', etiqueta: 'Evidencias' },
  { clave: 'tipoInstrumento', etiqueta: 'Tipo de evaluación / instrumento' },
  { clave: 'ponderacion', etiqueta: 'Ponderación (%)' },
]
const FUENTES_INFORMACION_VACIAS = ['', '', '', '', '']

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
    'cálculos"): existe UNA SOLA escala de ponderación, la del PARCIAL completo = 100%. Ni la Secuencia ni sus ' +
    'momentos (Apertura/Desarrollo/Cierre) tienen porcentaje propio — Apertura, Desarrollo y Cierre son la ' +
    'METODOLOGÍA de la Secuencia, no niveles de evaluación independientes. Lo que se pondera es la EVIDENCIA que ' +
    'cada momento produce: si un momento no genera una evidencia que de verdad se evalúe, su "ponderacion" es ' +
    '"0%" o "No aplica" — nunca inventes un porcentaje solo por rellenar el campo.\n' +
    'La suma de TODAS las "ponderacion" de TODOS los momentos (Apertura + Desarrollo + Cierre) de TODAS las ' +
    'Secuencias Didácticas de este parcial debe dar EXACTAMENTE 100% — ni más ni menos. NUNCA repartas 100% ' +
    'dentro de cada Secuencia por separado (eso sumaría muchas veces 100% en el parcial, que es justo lo que se ' +
    'debe evitar). Antes de responder, suma mentalmente todas las ponderaciones que vas a entregar en este ' +
    'parcial y ajústalas para que el total dé exactamente 100%.\n' +
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
    '"desarrollo" y "cierre" son OBLIGATORIOS en cada Secuencia, cada uno con sus 6 campos completos.'
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

// Suma las "ponderacion" de TODOS los momentos de TODAS las Secuencias de
// un parcial — "0%"/"No aplica"/vacío cuentan como 0. Regla única de
// ponderación (Kike, 16-ago-2026): esa suma debe dar exactamente 100, la
// escala es el PARCIAL completo, no cada Secuencia por separado.
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
    `Secuencias de este parcial dio ${sumaActual}%, y debe dar EXACTAMENTE 100%. Vuelve a responder el JSON ` +
    'COMPLETO, con las mismas Secuencias y contenido, ajustando SOLO los valores de "ponderacion" (de los ' +
    'momentos que sí tienen evidencia evaluable) para que la suma total del parcial dé exactamente 100% — no ' +
    'repartas 100% dentro de cada Secuencia por separado.'
  )
}

// Garantía DURA de la regla única de ponderación — no basta con pedírselo
// a la IA (el reintento de arriba ayuda, pero un modelo puede seguir sin
// dar exactamente 100). Mismo principio que ya regía en el resto de
// Evalúa Fácil (ver repartirPonderacion, más arriba en este archivo): "la
// IA no reparte puntos, los calcula el código" — así que aquí se
// reescala matemáticamente cada "ponderacion" no-cero, proporcional a lo
// que la IA propuso, para que la suma del parcial dé EXACTAMENTE 100 sin
// depender de que el docente lo revise (Kike, 16-ago-2026: "es muy
// probable que los docentes no revisen mucho y dejen todo como lo genera
// la IA"). Los momentos en "0%"/"No aplica" se quedan tal cual — nunca se
// les asigna ponderación por rescatar la suma.
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
  let acumulado = 0
  entradas.forEach((e, i) => {
    if (i === entradas.length - 1) {
      // La última absorbe el residuo del redondeo — así la suma da
      // exactamente 100, nunca 99.9 ni 100.1.
      e.m.ponderacion = `${Math.round((100 - acumulado) * 10) / 10}%`
    } else {
      const escalado = Math.round((e.valor / total) * 1000) / 10
      acumulado += escalado
      e.m.ponderacion = `${escalado}%`
    }
  })
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
  // La bibliografía es de la Planeación completa, no de cada parcial — solo
  // se pide en la llamada del primer parcial (mismo programa de estudios
  // para todos, no tiene caso repetir la pregunta y gastar tokens de más).
  let fuentesInformacion = FUENTES_INFORMACION_VACIAS.slice()

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

    // Aseguramiento real de la REGLA ÚNICA DE PONDERACIÓN (Kike,
    // 16-ago-2026): la suma de ponderaciones de todo el parcial debe dar
    // exactamente 100 — igual que con la cantidad de Secuencias, un
    // reintento automático que señala la suma exacta que salió mal, no
    // solo repetir la instrucción.
    const sumaInicial = sumaPonderacionesParcial(datos?.secuenciasDidacticas)
    if (Math.abs(sumaInicial - 100) > 0.5) {
      const reintentoPonderacion = await pedirJSON({
        client, modelo, maxTokens, system: PLANEACION_SISTEMA,
        prompt: promptCorreccionPonderaciones(promptBase, sumaInicial),
      })
      tokensEntrada += reintentoPonderacion.interno.tokensEntrada || 0
      tokensSalida += reintentoPonderacion.interno.tokensSalida || 0
      ms += reintentoPonderacion.interno.ms || 0
      const sumaReintento = sumaPonderacionesParcial(reintentoPonderacion.datos?.secuenciasDidacticas)
      // Solo se usa el reintento si de verdad mejoró (más cerca de 100 que
      // antes) — si no, se sigue con la respuesta original en vez de
      // arriesgar un JSON peor.
      if (Math.abs(sumaReintento - 100) < Math.abs(sumaInicial - 100)) {
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

  return { porParcial, fuentesInformacion, reintentos, interno: { modelo, tokensEntrada, tokensSalida, ms } }
}

async function ejecutarPlaneacionDidacticaInicial({ params, modelo, apiKey }) {
  const ctx = params.__contexto // lo puso el precheck; el cliente no puede tocarlo
  const { porParcial, fuentesInformacion, reintentos, interno } = await generarSecuenciasPorParciales({
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
    // necesitó el reintento de cantidad (ver generarSecuenciasPorParciales)
    // — ese reintento duplica el gasto real de tokens de ese parcial, así
    // que se refleja en lo que se cobra (Kike, 16-ago-2026: "cóbrale más
    // créditos al usuario por hacerla").
    unidadesReales: 1 + reintentos,
    interno,
  }
}

// ── Traducción de errores del ledger a HttpsError ───────────────────────────
function comoHttpsError(e) {
  if (e instanceof HttpsError) return e
  if (e instanceof ledger.ErrorCreditos) {
    const codigos = {
      SALDO_INSUFICIENTE: 'failed-precondition',
      CORTESIA_PENDIENTE: 'failed-precondition',
      SUSCRIPCION_VENCIDA: 'permission-denied',
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
    const n = Number.isInteger(unidades) && unidades > 0 && unidades <= 500 ? unidades : 1

    // Comprobaciones previas a CUALQUIER cobro: propiedad de la actividad,
    // categoría válida y suficiencia del contexto. Si algo de esto falla, el
    // docente se entera sin que se haya reservado ni descontado un crédito
    // (no hay reserva que reembolsar porque nunca llegó a existir).
    let precontexto = null
    if (PRECHECKS[operacion]) {
      precontexto = await PRECHECKS[operacion]({ uid, params })
    }

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

    // Métricas internas (tokens, modelo): fuera del alcance del cliente.
    db.doc(`iaConsumosInterno/${idempotencyKey}`)
      .set({ uid, operacion, ...salida.interno, createdAt: FieldValue.serverTimestamp() })
      .catch((err) => logger.error('iaConsumosInterno:', err))

    // Consumo REAL: unidades procesadas × tarifa — lo calcula el código,
    // jamás la IA.
    const porUso = tarifas.tarifas[operacion]
    const creditosReales = Math.min(salida.unidadesReales, n) * porUso

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

// Mantenimiento diario: renueva ciclos vencidos de quienes no usaron la IA
// (la renovación perezosa cubre a quienes sí) y recupera reservas huérfanas.
exports.mantenimientoCreditosIA = onSchedule('every 24 hours', async () => {
  try {
    const tarifas = await ledger.cargarTarifas()
    const ren = await ledger.renovarCiclosVencidos({ tarifas })
    const lim = await ledger.limpiarReservasHuerfanas({ minutos: 15 })
    const tri = await ledger.cerrarTrialsVencidos({})
    logger.info(`mantenimientoCreditosIA: ${ren.renovados} renovado(s), ${lim.recuperadas} reserva(s) recuperada(s), ${tri.cerrados} trial(es) cerrados por tiempo`)
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
  repartirPonderacion, precheckCrearEvaluacion, MAX_REACTIVOS_EVALUACION_TRIAL, MAX_REACTIVOS_EVALUACION_PAGO,
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
}
