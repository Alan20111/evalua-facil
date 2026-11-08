// Limpieza automática al eliminar una actividad (8-nov-2026).
//
// Problema: el navegador borra las entregas de una actividad, pero NO puede borrar lo que cuelga de ellas
// (`calificacionHistorial`, `respuestas`, `progresoVideo`, `intentosRespuestas`: las reglas lo reservan al servidor),
// y Firestore no borra subcolecciones al borrar el documento padre. Quedaban huérfanas.
//
// Tres piezas, que se encuentran todas en el documento de la actividad:
//
//   1. `rastroEntregas/{submissionId}` = { actividadId, alumnoId, submissionId }. Lo crea `registrarEntrega` al nacer
//      cada entrega y NADIE lo borra al anular la entrega ni al borrar al estudiante. Así la ruta de la entrega se
//      puede encontrar aunque ya no existan ni la entrega ni el estudiante. Sin `match` en firestore.rules: el cliente
//      no lo lee ni lo escribe (lo mismo que `eliminacionesAsignatura`).
//
//   2. Escritores tardíos del servidor (`escribirSiActividadExiste`, `crearUnaVezSiActividadExiste`): escriben dentro
//      de una transacción que PRIMERO lee la actividad. El Admin SDK bloquea lo que la transacción lee, así que la
//      escritura y el borrado de la actividad quedan en un orden: si la escritura confirma antes, la limpieza (que
//      arranca después del borrado) la encuentra; si va después, ve la actividad ausente y no escribe. No depende de
//      ninguna espera.
//
//   3. `limpiarActividadBorrada`: al borrar la actividad, borra con `recursiveDelete` el árbol de cada entrega suya
//      (rastro + entregas que sigan existiendo + estudiantes actuales como red de seguridad) y el árbol de la propia
//      actividad. Las entradas del rastro se borran AL FINAL: si la función falla a la mitad, el reintento
//      (`retry: true`) vuelve a encontrar lo pendiente. Todo es repetible: borrar dos veces no hace daño.
//
// Lo que NO hace: anular una entrega no dispara nada de esto (el historial se conserva, como siempre); nunca toca una
// entrega cuyo id no sea exactamente `{actividadId}_{alumnoId}` de ESTA actividad.
const { getFirestore, FieldValue } = require('firebase-admin/firestore')

const RASTRO = 'rastroEntregas'
const idValido = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
// La entrega pertenece a la actividad solo si su id es exactamente `{actividadId}_{alumnoId}` (submissionDocId).
const esEntregaDe = (submissionId, actividadId, alumnoId) =>
  idValido(submissionId) && idValido(actividadId) && idValido(alumnoId) && submissionId === `${actividadId}_${alumnoId}`

// Ganchos para las pruebas (nunca se usan en producción).
const pruebas = { dentroDeTransaccion: null, fallarLimpieza: null }
function fijarPruebasLimpieza(opciones = {}) {
  pruebas.dentroDeTransaccion = opciones.dentroDeTransaccion || null
  pruebas.fallarLimpieza = opciones.fallarLimpieza || null
}

// Corre `escribir(tx, actSnap)` solo si la actividad existe, en la misma transacción que la lee.
// Devuelve lo que devuelva `escribir`, o `false` si la actividad ya no existe.
async function escribirSiActividadExiste(actividadId, escribir) {
  if (!idValido(actividadId)) return false
  const db = getFirestore()
  return db.runTransaction(async (tx) => {
    const act = await tx.get(db.collection('activities').doc(actividadId))
    if (pruebas.dentroDeTransaccion) await pruebas.dentroDeTransaccion(actividadId)
    if (!act.exists) return false
    return escribir(tx, act)
  })
}

// Igual que `crearUnaVez` (id del evento: un reintento no duplica), pero solo si la actividad existe.
// 'creado' | 'existia' | 'sin_actividad'.
async function crearUnaVezSiActividadExiste(actividadId, ref, datos) {
  const r = await escribirSiActividadExiste(actividadId, async (tx) => {
    if ((await tx.get(ref)).exists) return 'existia'
    tx.create(ref, datos)
    return 'creado'
  })
  return r || 'sin_actividad'
}

// Al crear una entrega: deja su rastro. Si la actividad ya no existe (la entrega llegó tarde), no hay rastro que dejar
// y la limpieza ya pasó: se borra aquí mismo el árbol de esa entrega.
async function registrarEntrega(submissionId, datos) {
  const actividadId = datos?.actividadId
  const alumnoId = datos?.alumnoId
  if (!esEntregaDe(submissionId, actividadId, alumnoId)) return 'ignorada'
  const db = getFirestore()
  const rastro = db.collection(RASTRO).doc(submissionId)
  const r = await escribirSiActividadExiste(actividadId, async (tx) => {
    if ((await tx.get(rastro)).exists) return 'existia'
    tx.create(rastro, { actividadId, alumnoId, submissionId, registradoEn: FieldValue.serverTimestamp() })
    return 'registrada'
  })
  if (r) return r
  await db.recursiveDelete(db.collection('submissions').doc(submissionId))
  return 'sin_actividad'
}

// Al borrar una actividad: borra el árbol de cada entrega suya y el de la propia actividad.
// `datosActividad` es lo que tenía el documento borrado (para buscar a los estudiantes de su asignatura).
async function limpiarActividadBorrada(activityId, datosActividad = {}) {
  if (!idValido(activityId)) return { omitida: 'id' }
  const db = getFirestore()
  const actRef = db.collection('activities').doc(activityId)
  // La actividad existe otra vez (no debería pasar: los ids no se reutilizan): no se toca nada.
  if ((await actRef.get()).exists) return { omitida: 'existe' }

  const rutas = new Set()
  const rastros = await db.collection(RASTRO).where('actividadId', '==', activityId).get()
  rastros.docs.forEach((d) => {
    const { alumnoId, submissionId } = d.data()
    if (submissionId === d.id && esEntregaDe(d.id, activityId, alumnoId)) rutas.add(d.id)
  })
  const vivas = await db.collection('submissions').where('actividadId', '==', activityId).get()
  vivas.docs.forEach((d) => { if (esEntregaDe(d.id, activityId, d.data().alumnoId)) rutas.add(d.id) })
  const asignaturaId = datosActividad?.asignaturaId
  if (idValido(asignaturaId)) {
    const estudiantes = await db.collection('students').where('asignaturaId', '==', asignaturaId).select().get()
    estudiantes.docs.forEach((d) => { if (esEntregaDe(`${activityId}_${d.id}`, activityId, d.id)) rutas.add(`${activityId}_${d.id}`) })
  }

  const escritor = db.bulkWriter()
  let entregas = 0
  for (const id of rutas) {
    const ref = db.collection('submissions').doc(id)
    const snap = await ref.get()
    // Un documento con ese id pero de OTRA actividad no es nuestro (no debería existir: las reglas fijan el id).
    if (snap.exists && snap.data().actividadId !== activityId) continue
    await db.recursiveDelete(ref, escritor)
    entregas += 1
  }
  if (pruebas.fallarLimpieza) await pruebas.fallarLimpieza(activityId)
  // El árbol de la actividad (el documento ya no existe: solo sus subcolecciones).
  await db.recursiveDelete(actRef, escritor)
  await escritor.close()
  // Al final: con todo ya limpio, el rastro deja de hacer falta.
  const lotes = []
  for (let i = 0; i < rastros.docs.length; i += 400) {
    const lote = db.batch()
    rastros.docs.slice(i, i + 400).forEach((d) => lote.delete(d.ref))
    lotes.push(lote.commit())
  }
  await Promise.all(lotes)
  return { entregas, rastros: rastros.size }
}

module.exports = {
  RASTRO,
  escribirSiActividadExiste,
  crearUnaVezSiActividadExiste,
  registrarEntrega,
  limpiarActividadBorrada,
  fijarPruebasLimpieza,
}
