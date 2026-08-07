// A12 · H5 · R22 — id determinista para `submissions`.
//
// Antes cada entrega se creaba con `addDoc` (id aleatorio), así que nada
// impedía crear una SEGUNDA submission para la misma pareja
// (alumnoId, actividadId): doble clic, dos pestañas, o un reintento de red
// bastaban. El docente veía una entrega al azar (según el orden, no
// garantizado, en que Firestore devolvía la consulta), los conteos del
// tablero sumaban de más, y en una evaluación se saltaba el límite de
// intentos por completo.
//
// Con este id, la pareja (alumnoId, actividadId) tiene UN SOLO documento
// posible por construcción: un segundo intento de "crear" en el mismo path
// es, para Firestore, un UPDATE del documento existente — sujeto a las
// mismas reglas que ya protegen una edición (el alumno no puede tocar su
// calificación), no una fila nueva. `firestore.rules` exige que todo
// `create` en `submissions` use exactamente este formato.
export function submissionDocId(actividadId, alumnoId) {
  return `${actividadId}_${alumnoId}`
}
