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
//   · C-03 'aviso' (9-ago-2026) · C-02 'calificar_abierta' (9-ago-2026).
const OPERACIONES = { aviso: ejecutarAviso, calificar_abierta: ejecutarCalificarAbierta }

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

  const inicio = Date.now()
  let tokensEntrada = 0
  let tokensSalida = 0
  let fallidas = 0
  const sugerencias = []

  // Cola con concurrencia limitada — sin dependencias externas.
  let cursor = 0
  async function trabajador() {
    while (cursor < items.length) {
      const item = items[cursor++]
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
        sugerencias.push({
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
        })
      } catch (e) {
        // Esta respuesta no se cobra; el resto del lote continúa.
        fallidas++
        logger.warn(`C-02: respuesta ${item.sub}/${item.preg} falló: ${String(e.message || e).slice(0, 200)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(C02_CONCURRENCIA, items.length) }, trabajador))

  if (!sugerencias.length) {
    // Nada utilizable: el callable reembolsa la reserva completa.
    throw new HttpsError('unavailable', 'El asistente de IA no pudo calificar ninguna respuesta. No se descontaron créditos.')
  }

  return {
    resultado: { sugerencias, omitidas, fallidas },
    unidadesReales: sugerencias.length, // 1 crédito por respuesta realmente sugerida
    interno: {
      modelo,
      tokensEntrada,
      tokensSalida,
      ms: Date.now() - inicio,
      respuestas: sugerencias.length,
      fallidas,
      omitidas,
    },
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
      // __uid lo pone el servidor desde la sesión autenticada — cualquier
      // valor que mandara el cliente se sobreescribe aquí.
      salida = await ejecutor({ params: { ...params, __uid: uid }, modelo, apiKey: ANTHROPIC_API_KEY.value(), unidades: n })
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
