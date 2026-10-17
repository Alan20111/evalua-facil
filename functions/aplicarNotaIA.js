// Escribir la nota que propuso la IA en una entrega — el ÚNICO lugar donde las
// dos rutas que lo hacen (ia.js «Recalificar todas con IA» y calificarAplicar.js
// «Aplicar calificaciones de IA a todas») tocan `submissions.calificacion`.
//
// Antes cada ruta hacía un `update` a ciegas: reemplazaba la calificación que el
// docente hubiera puesto a mano, sin avisar y sin guardar la anterior. Ahora:
//   · la entrega se relee DENTRO de una transacción y la decisión (¿puede la IA
//     escribir aquí?) se toma con lo que hay en ese momento — una calificación
//     que el docente puso entre que se generó la propuesta y se aplicó ya no se
//     pisa;
//   · por omisión la IA solo escribe en una entrega sin nota o sobre una nota
//     que es de la propia IA; reemplazar la del docente exige
//     `sobrescribirCalificadas: true` (la casilla expresa del diálogo);
//   · la nota nace con `ultimaCalificacionPor` ('ia_recalificar' | 'ia_aplicar'),
//     y el valor anterior queda en submissions/{id}/calificacionHistorial
//     (trigger onCalificacionCambiada), así que ningún reemplazo es silencioso.
//
// La decisión es una función pura compartida con el navegador
// (src/utils/evaluacionGrading.js → decidirAplicacionIA), que es la que cuenta
// cuántas notas del docente va a tocar el diálogo ANTES de que se confirme.
//
// Este archivo no requiere el SDK de Anthropic ni el ledger de créditos (lo
// verifica una prueba estática de calificarAplicar.js).
const { decidirAplicacionIA } = require('./_shared/evaluacionGrading.js')

// datos: { calificacion, comentario, rubricaEval }
// sugerenciaNueva: lo que se guarda en el documento de la sugerencia al aplicar
// (estado 'aplicada', etc.); sugerenciaPrevia: la sugerencia tal como estaba
// ANTES de esta pasada (la regeneración de «recalificar» la reemplaza), para
// reconocer una nota que la propia IA puso antes.
// Devuelve { aplicada, motivo }.
async function aplicarNotaIA(db, { subRef, sugRef = null, datos, origen, sobrescribirCalificadas = false, sugerenciaPrevia = null, sugerenciaNueva = null }) {
  return db.runTransaction(async (tx) => {
    const subSnap = await tx.get(subRef)
    if (!subSnap.exists) return { aplicada: false, motivo: 'sin_entrega' }
    let previa = sugerenciaPrevia
    if (!previa && sugRef) {
      const sugSnap = await tx.get(sugRef)
      previa = sugSnap.exists ? sugSnap.data() : null
    }
    const decision = decidirAplicacionIA({ sub: subSnap.data(), sugerencia: previa, sobrescribirCalificadas })
    if (!decision.aplicar) return { aplicada: false, motivo: decision.motivo }
    tx.update(subRef, {
      calificacion: datos.calificacion,
      comentario: datos.comentario,
      rubricaEval: datos.rubricaEval,
      estado: 'calificado',
      ultimaCalificacionPor: origen,
    })
    if (sugRef && sugerenciaNueva) tx.set(sugRef, sugerenciaNueva, { merge: true })
    return { aplicada: true, motivo: decision.motivo }
  })
}

module.exports = { aplicarNotaIA }
