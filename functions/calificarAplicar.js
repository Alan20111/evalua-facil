// Aplicar evaluaciones de IA YA GENERADAS — callable SEPARADO de
// ejecutarOperacionIA a propósito (23-ago-2026, pedido explícito de Kike):
// esta función nunca llama a Anthropic ni toca functions/creditosLedger.js —
// no declara `secrets`, no reserva, no liquida. Igual que juego.js con
// construirJuego/confirmarJuego, separar el archivo hace imposible que un
// cambio futuro en el flujo de IA "arrastre" un cobro aquí por accidente.
//
// aplicarEvaluacionesIAPendientes ("Aplicar calificaciones de IA a todas",
// Modo 1) — toma las sugerencias YA GENERADAS con estado 'pendiente' (de un
// lote de "Calificar/Recalificar todas con IA", o de "Calificar con IA"
// individual — desde 24-ago-2026 ambos flujos persisten en el mismo lugar,
// ver ejecutarCalificarEntregableIA en ia.js) y escribe la calificación real
// en cada `submissions` — pero sin generar nada nuevo, así que no hay nada
// que cobrar.
//
// (El registro histórico de "Ver evaluación de IA" para el flujo individual
// ya no necesita un callable aparte: ejecutarCalificarEntregableIA en ia.js
// persiste la propuesta EN CUANTO se genera, en el mismo doc que usa el
// lote — así que persistGrade() en ActivityPage.jsx solo necesita marcarla
// 'aplicada' con un updateDoc directo del cliente, igual que ya hacía para
// el flujo por lote.)
//
// confirmarChatAplicarEvaluacionesIA (26-ago-2026) — el MVP del Asistente de
// IA con acciones: confirma la propuesta "Aplicar evaluaciones de IA
// pendientes" que el chat pudo haber ofrecido (ver ACCIONES_CHAT_PERMITIDAS
// en ia.js), y por dentro solo llama a aplicarEvaluacionesIAPendientesImpl
// de arriba, una vez por cada actividad de la asignatura que tenga algo
// pendiente. Vive en este mismo archivo, no en ia.js, por la MISMA razón de
// aislamiento del párrafo de arriba.

const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { logger } = require('firebase-functions')

// Espejo mínimo de esCotejo/totalRubrica (src/utils/rubrica.js, también
// duplicado en ia.js) — no vale la pena acoplar este archivo a ia.js por dos
// funciones puras de una línea.
const esCotejo = (r) => r?.tipo === 'cotejo'
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

async function verificarActividadDocente(db, uid, actividadId) {
  if (!actividadId) throw new HttpsError('invalid-argument', 'Falta la actividad')
  const snap = await db.doc(`activities/${actividadId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'La actividad no existe')
  const act = snap.data()
  if (act.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta actividad no es tuya')
  return act
}

// ── "Aplicar calificaciones de IA a todas" (Modo 1) ─────────────────────────
// Solo trabaja con sugerencias YA GENERADAS y 'pendiente' — nunca llama a
// Anthropic, nunca genera una evaluación nueva. Escribe en lotes atómicos
// (WriteBatch): para cada entrega, la calificación en `submissions` y el
// cambio de estado en `iaSugerenciasEntregable` viajan en el MISMO batch, así
// que nunca queda una sugerencia 'aplicada' con la calificación sin guardar
// (o viceversa) — si el batch falla, ninguna de las dos escrituras de esa
// entrega se aplicó.
const APLICAR_TODAS_TAMANO_LOTE = 200 // ×2 escrituras = 400, bajo el máximo de 500 de un WriteBatch

async function aplicarEvaluacionesIAPendientesImpl(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para usar esta función')

  const db = getFirestore()
  const actividadId = String(request.data?.actividadId || '')
  const act = await verificarActividadDocente(db, uid, actividadId)
  const rubrica = act.rubrica

  // where('estado','==','pendiente') es la única fuente — una sugerencia ya
  // 'aplicada' nunca puede volver a aplicarse por aquí (regla H: no tratar
  // una ya aplicada como si fuera pendiente). Ejecutar esto dos veces seguidas
  // la segunda vez no encuentra nada que aplicar (idempotente).
  const pendSnap = await db.collection(`activities/${actividadId}/iaSugerenciasEntregable`)
    .where('estado', '==', 'pendiente').get()

  if (pendSnap.empty) {
    return { aplicadas: 0, noAplicadas: 0, motivos: [] }
  }

  let aplicadas = 0
  const motivos = []
  const docs = pendSnap.docs

  for (let i = 0; i < docs.length; i += APLICAR_TODAS_TAMANO_LOTE) {
    const chunk = docs.slice(i, i + APLICAR_TODAS_TAMANO_LOTE)
    // Releer cada submission — defensa contra IDs manipulados: el campo `sub`
    // del documento de sugerencia debe apuntar a una entrega que de verdad
    // pertenece a ESTA actividad, nunca se confía en el id a ciegas.
    const subRefs = chunk.map((d) => db.doc(`submissions/${d.data().sub || d.id}`))
    const subSnaps = await db.getAll(...subRefs)

    const batch = db.batch()
    chunk.forEach((sugDoc, idx) => {
      const data = sugDoc.data()
      const submissionId = data.sub || sugDoc.id
      const subSnap = subSnaps[idx]
      if (!subSnap.exists || subSnap.data().actividadId !== actividadId) {
        motivos.push({ submissionId, motivo: 'La entrega ya no existe o no pertenece a esta actividad' })
        return
      }
      const niveles = (data.sugerencia?.criterios || []).map((c) => c.nivel)
      const total = typeof data.sugerencia?.calificacionPropuesta === 'number'
        ? data.sugerencia.calificacionPropuesta
        : totalInstrumento(rubrica, niveles)
      if (total == null) {
        motivos.push({ submissionId, motivo: 'Sin evidencia suficiente para calcular una calificación' })
        return
      }
      batch.update(subSnap.ref, {
        calificacion: total,
        comentario: data.sugerencia?.retroalimentacionGeneral || '',
        rubricaEval: niveles.some((v) => v != null) ? niveles : null,
        estado: 'calificado',
      })
      batch.update(sugDoc.ref, {
        estado: 'aplicada',
        aplicadaAutomaticamente: true,
        actualizadoEn: FieldValue.serverTimestamp(),
      })
      aplicadas++
    })
    try {
      await batch.commit()
    } catch (e) {
      logger.error(`aplicarEvaluacionesIAPendientes(${actividadId}): batch falló:`, e)
      // Ninguna escritura de ESTE batch se aplicó (WriteBatch es todo-o-nada) —
      // se reportan como no aplicadas en vez de contarlas ya hechas.
      chunk.forEach((sugDoc) => {
        const submissionId = sugDoc.data().sub || sugDoc.id
        if (!motivos.some((m) => m.submissionId === submissionId)) {
          motivos.push({ submissionId, motivo: 'No se pudo escribir en este intento, vuelve a intentar' })
          aplicadas--
        }
      })
    }
  }

  return { aplicadas, noAplicadas: motivos.length, motivos }
}
exports.aplicarEvaluacionesIAPendientes = onCall({ timeoutSeconds: 120 }, aplicarEvaluacionesIAPendientesImpl)
// Export real (no solo _pruebas) — confirmarChatAplicarEvaluacionesIA, más
// abajo, la reutiliza TAL CUAL para cada actividad con pendientes; nunca se
// reimplementa la lógica de aplicar.
exports.aplicarEvaluacionesIAPendientesImpl = aplicarEvaluacionesIAPendientesImpl

// ── Confirmar la propuesta del Asistente: "Aplicar evaluaciones de IA
// pendientes" (26-ago-2026, MVP del Asistente con acciones) ────────────────
// Mismo patrón CONSULTA → PROPUESTA → CONFIRMACIÓN → EJECUCIÓN que ya usan
// chat_crear_actividad/chat_crear_examen (functions/ia.js), y MISMA regla de
// revalidación (identidad, propiedad de la asignatura, la propuesta releída
// de Firestore por mensajeId, que sea la más reciente sin ejecutar) — pero
// espejada aquí en vez de importada de ia.js A PROPÓSITO: ia.js requiere el
// SDK de Anthropic y el ledger de créditos, y este archivo existe
// precisamente para que eso sea IMPOSIBLE de arrastrar por accidente (mismo
// principio que ya protege a aplicarEvaluacionesIAPendientes, arriba). Esta
// acción NUNCA pasa por ejecutarOperacionIA ni por creditosLedger — ni
// siquiera a tarifa 0 — así que no hay ninguna reserva de créditos que
// pueda aparecer. Tampoco llama a Anthropic en ningún punto: solo relee
// Firestore y aplica sugerencias YA GENERADAS, exactamente como el botón
// "Aplicar calificaciones de IA a todas".
async function verificarSubjectDocente(db, uid, subjectId) {
  if (!subjectId) throw new HttpsError('invalid-argument', 'Falta la asignatura de esta acción.')
  const snap = await db.doc(`subjects/${subjectId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'La asignatura no existe')
  const subj = snap.data()
  if (subj.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta asignatura no es tuya')
  return subj
}

// Espejo mínimo de precheckAccionChat (functions/ia.js) — mismas reglas,
// acotadas a esta única acción (que no trae contenido generado por la IA
// que resanear, a diferencia de crear actividad/examen).
async function revalidarPropuestaAplicarIA(db, uid, subjectId, mensajeId) {
  await verificarSubjectDocente(db, uid, subjectId)
  if (!mensajeId) throw new HttpsError('invalid-argument', 'Falta la propuesta a confirmar.')

  const msgSnap = await db.doc(`chatMensajes/${mensajeId}`).get()
  if (!msgSnap.exists) throw new HttpsError('not-found', 'Esta propuesta ya no existe.')
  const msgData = msgSnap.data()
  if (msgData.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta propuesta no es tuya.')
  if (msgData.subjectId !== subjectId) {
    throw new HttpsError('invalid-argument', 'Esta propuesta pertenece a otra asignatura.')
  }
  if (!msgData.propuesta || msgData.propuesta.accion !== 'APLICAR_EVALUACIONES_IA_PENDIENTES') {
    throw new HttpsError('invalid-argument', 'Este mensaje no tiene esta propuesta.')
  }
  if (msgData.propuesta.ejecutada) {
    throw new HttpsError('failed-precondition', 'Esta propuesta ya fue aplicada.', { codigo: 'PROPUESTA_YA_EJECUTADA' })
  }

  // Solo equality en la consulta (regla del proyecto) — el orden se decide
  // en memoria con `creadoEn`, igual que precheckAccionChat.
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
}

async function confirmarChatAplicarEvaluacionesIAImpl(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para usar esta función')

  const db = getFirestore()
  const subjectId = String(request.data?.subjectId || '').trim()
  const mensajeId = String(request.data?.mensajeId || '').trim()
  // Nunca se confía en nada que mande el cliente más allá de estos dos IDs —
  // ni cantidades, ni actividades, ni nombres.
  await revalidarPropuestaAplicarIA(db, uid, subjectId, mensajeId)

  // Recalcular desde cero, AHORA — no lo que decía el contexto cuando se
  // propuso (regla 5 del pedido: si cambió el número de pendientes entre la
  // propuesta y la confirmación, se aplica lo que de verdad sigue pendiente
  // en este momento, nunca lo que se mencionó antes).
  const actsSnap = await db.collection('activities')
    .where('asignaturaId', '==', subjectId).where('categoria', '==', 'entregable').get()

  let aplicadas = 0
  let noAplicadas = 0
  const motivos = []
  const actividadesAfectadas = []

  for (const actDoc of actsSnap.docs) {
    const pendSnap = await db.collection(`activities/${actDoc.id}/iaSugerenciasEntregable`)
      .where('estado', '==', 'pendiente').get()
    if (pendSnap.empty) continue // nada pendiente en esta actividad — no se toca

    // Reutiliza TAL CUAL la función existente, con la misma forma de
    // `request` que ya espera (uid + actividadId) — mismos candados de
    // propiedad, mismo WriteBatch atómico, mismo "nunca inventar" si falta
    // evidencia suficiente.
    const resultado = await aplicarEvaluacionesIAPendientesImpl({
      auth: { uid }, data: { actividadId: actDoc.id },
    })
    aplicadas += resultado.aplicadas
    noAplicadas += resultado.noAplicadas
    motivos.push(...resultado.motivos)
    if (resultado.aplicadas > 0) {
      actividadesAfectadas.push({ actividadId: actDoc.id, nombre: actDoc.data().nombre || '(sin nombre)', aplicadas: resultado.aplicadas })
    }
  }

  // Se marca ejecutada SIEMPRE que se llegó hasta aquí (aunque hayan sido 0
  // aplicadas porque ya no quedaba nada pendiente) — evita que el docente
  // pueda confirmar la misma tarjeta dos veces esperando algo distinto; el
  // resultado real ya se le devuelve para que sepa exactamente qué pasó.
  await db.doc(`chatMensajes/${mensajeId}`).update({ 'propuesta.ejecutada': true })

  return { aplicadas, noAplicadas, motivos, actividadesAfectadas }
}
exports.confirmarChatAplicarEvaluacionesIA = onCall({ timeoutSeconds: 120 }, confirmarChatAplicarEvaluacionesIAImpl)

exports._pruebas = {
  verificarActividadDocente, totalInstrumento, esCotejo,
  aplicarEvaluacionesIAPendientesImpl, confirmarChatAplicarEvaluacionesIAImpl,
  verificarSubjectDocente, revalidarPropuestaAplicarIA,
}
