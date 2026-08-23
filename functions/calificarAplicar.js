// Aplicar evaluaciones de IA YA GENERADAS — callables SEPARADOS de
// ejecutarOperacionIA a propósito (23-ago-2026, pedido explícito de Kike):
// estas dos funciones nunca llaman a Anthropic ni tocan functions/
// creditosLedger.js — no declaran `secrets`, no reservan, no liquidan. Igual
// que juego.js con construirJuego/confirmarJuego, separar el archivo hace
// imposible que un cambio futuro en el flujo de IA "arrastre" un cobro aquí
// por accidente.
//
// Dos acciones, una regla en común — NUNCA modifican una calificación
// definitiva sin que el docente haya pedido explícitamente esa acción:
//   guardarEvaluacionIndividualAplicada — el docente ya generó UNA evaluación
//     con "Calificar con IA" (esa sí cobró, vía ejecutarOperacionIA) y la
//     acaba de aplicar/guardar; esto solo persiste el registro histórico en
//     iaSugerenciasEntregable para poder consultarlo después ("Ver
//     evaluación de IA"). NO toca `submissions` — esa escritura la hace el
//     cliente en el mismo persistGrade() de siempre.
//   aplicarEvaluacionesIAPendientes — "Aplicar calificaciones de IA a
//     todas": toma las sugerencias YA GENERADAS con estado 'pendiente' (de
//     un lote de "Calificar/Recalificar todas con IA" previo) y sí escribe
//     la calificación real en cada `submissions`, exactamente el mismo
//     conjunto de campos que la aplicación individual — pero sin generar
//     nada nuevo, así que no hay nada que cobrar.

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

// Recorta/valida lo mínimo del objeto que manda el cliente — el docente ya
// controla por completo la calificación de sus propios alumnos (la escribe
// directo en el formulario si quiere), así que esto no es una barrera de
// seguridad nueva: es solo higiene de datos para que el registro histórico
// no crezca sin límite ni rompa el mismo parseo que ya usa CalificarConIAModal.
function sanearSugerencia(sugerencia) {
  const criterios = Array.isArray(sugerencia?.criterios) ? sugerencia.criterios : []
  return {
    criterios: criterios.slice(0, 20).map((c) => ({
      n: Number.isInteger(c?.n) ? c.n : null,
      nivel: Number.isInteger(c?.nivel) ? c.nivel : null,
      evidencia: String(c?.evidencia || '').slice(0, 300),
      sinEvidenciaSuficiente: !!c?.sinEvidenciaSuficiente,
    })),
    retroalimentacionGeneral: String(sugerencia?.retroalimentacionGeneral || '').slice(0, 1000),
    confianza: ['alta', 'media', 'baja'].includes(sugerencia?.confianza) ? sugerencia.confianza : 'media',
    evidenciasAnalizadas: Array.isArray(sugerencia?.evidenciasAnalizadas) ? sugerencia.evidenciasAnalizadas.slice(0, 5) : [],
    ignoradosPorFormato: Number.isInteger(sugerencia?.ignoradosPorFormato) ? sugerencia.ignoradosPorFormato : 0,
    ignoradosPorTope: Number.isInteger(sugerencia?.ignoradosPorTope) ? sugerencia.ignoradosPorTope : 0,
    calificacionPropuesta: typeof sugerencia?.calificacionPropuesta === 'number' ? sugerencia.calificacionPropuesta : null,
  }
}

// ── "Calificar con IA" individual, ya aplicada — persiste el registro ──────
// El docente ya vio la propuesta y ya guardó la calificación (persistGrade,
// ActivityPage.jsx) ANTES de llamar aquí — esta función nunca escribe
// `submissions`, solo dEJA el registro para "Ver evaluación de IA".
async function guardarEvaluacionIndividualAplicadaImpl(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para usar esta función')

  const db = getFirestore()
  const actividadId = String(request.data?.actividadId || '')
  const submissionId = String(request.data?.submissionId || '')
  if (!submissionId) throw new HttpsError('invalid-argument', 'Falta la entrega')

  await verificarActividadDocente(db, uid, actividadId)

  const subSnap = await db.doc(`submissions/${submissionId}`).get()
  if (!subSnap.exists || subSnap.data().actividadId !== actividadId) {
    throw new HttpsError('failed-precondition', 'Esta entrega no pertenece a esta actividad')
  }

  const ref = db.doc(`activities/${actividadId}/iaSugerenciasEntregable/${submissionId}`)
  await ref.set({
    estado: 'aplicada',
    actividadId,
    sub: submissionId,
    sugerencia: sanearSugerencia(request.data?.sugerencia),
    actualizadoEn: FieldValue.serverTimestamp(),
  }, { merge: true })
  // `creadoEn` solo si el doc no existía todavía (no pisar la fecha real de
  // una sugerencia de lote que este mismo submissionId ya tuviera).
  const snap = await ref.get()
  if (!snap.data()?.creadoEn) await ref.set({ creadoEn: FieldValue.serverTimestamp() }, { merge: true })

  return { ok: true }
}
exports.guardarEvaluacionIndividualAplicada = onCall({ timeoutSeconds: 60 }, guardarEvaluacionIndividualAplicadaImpl)

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

exports._pruebas = {
  verificarActividadDocente, sanearSugerencia, totalInstrumento, esCotejo,
  guardarEvaluacionIndividualAplicadaImpl, aplicarEvaluacionesIAPendientesImpl,
}
