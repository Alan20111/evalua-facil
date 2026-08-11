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

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY')

// Operaciones conectadas por autorización del PO:
//   · C-03 'aviso' (9-ago-2026) · C-02 'calificar_abierta' (9-ago-2026)
//   · OP-06 'rubrica' y OP-07 'cotejo' (10-ago-2026) · OP-09 'reactivos' (10-ago-2026).
const OPERACIONES = {
  aviso: ejecutarAviso,
  calificar_abierta: ejecutarCalificarAbierta,
  rubrica: ejecutarRubrica,
  cotejo: ejecutarCotejo,
  reactivos: ejecutarReactivos,
}

// Comprobaciones que corren ANTES de reservar créditos. Una operación con
// precheck no llega al ledger si el contexto no da: el docente recibe un
// mensaje que le dice qué le falta y su saldo queda intacto (no hay reserva
// que reembolsar porque nunca existió). Lo que devuelve el precheck viaja al
// ejecutor, que así no vuelve a leer nada de Firestore.
const PRECHECKS = { rubrica: precheckInstrumento, cotejo: precheckInstrumento, reactivos: precheckReactivos }

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

  return {
    clase,
    nombre: String(act.nombre || act.titulo || '').trim().slice(0, 200),
    tema: String(params?.tema || '').trim().slice(0, 120),
    quiereEvaluar,
    cantidad,
    tipoSolicitado,
    tipos: tiposParaLote(tipoSolicitado, cantidad),
  }
}

const REACTIVOS_SISTEMA =
  'Eres el asistente pedagógico de Evalúa Fácil y trabajas dentro de la asignatura de un ' +
  'docente de bachillerato mexicano. Tu papel es PROPONER: el docente siempre revisa, edita y decide. ' +
  'Construye los reactivos EXCLUSIVAMENTE a partir de lo que el docente describe en "qué quiere ' +
  'evaluar" — no agregues conceptos, temas ni aprendizajes que no haya mencionado, y no completes ' +
  'con conocimiento general más allá de lo que pidió. La cantidad y el tipo de cada reactivo los fija ' +
  'Evalúa Fácil: genera EXACTAMENTE los reactivos pedidos, uno por cada tipo indicado y en ese orden. ' +
  'Escribe en español, claro y breve. Responde únicamente con el JSON válido del esquema indicado, ' +
  'sin texto adicional.'

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
    `\nQUÉ QUIERE EVALUAR EL DOCENTE (única fuente del contenido):\n"""${ctx.quiereEvaluar}"""\n\n` +
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
    client, modelo, maxTokens: 2200, system: REACTIVOS_SISTEMA,
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
}
