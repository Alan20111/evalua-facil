// Reto Exprés — limpieza cuando el DOCENTE borra (etapa 3). Nada se borra solo: no hay barrido ni caducidad
// (decisión del 3-nov-2026). Mismo mecanismo que Participación en vivo (limpiarVivoDeActividad / limpiarVivoDeSesion):
//   · borrar el reto (o la asignatura, o la cuenta, que borran sus actividades) → todas sus sesiones y sus datos;
//   · borrar UNA sesión → solo los datos de esa sesión; el reto, sus preguntas y las demás sesiones quedan.
// Idempotente: si ya no hay nada, no hace nada.
const { getFirestore } = require('firebase-admin/firestore')

// Colecciones con un documento por participante, respuesta, alias o lugar del cupo (se buscan por campo).
const POR_CAMPO = ['retoParticipantes', 'retoRespuestas', 'retoAlias', 'retoCupos'] // retoCupos: un lugar numerado por externo
// Colecciones con UN documento por sesión, cuyo id es el código.
const POR_CODIGO = ['retoSesiones', 'retoClaves', 'retoResultados', 'retoParcial'] // retoParcial: clasificación provisional

const codigoValido = (c) => typeof c === 'string' && /^[A-HJ-KM-NP-Z2-9]{10}$/.test(c)

async function limpiarRetoDeSesion({ sesionId }) {
  if (!codigoValido(sesionId)) return { borrados: 0 }
  const db = getFirestore()
  const escritor = db.bulkWriter()
  let borrados = 0
  for (const coleccion of POR_CAMPO) {
    const snap = await db.collection(coleccion).where('sesionId', '==', sesionId).get()
    snap.docs.forEach((d) => { escritor.delete(d.ref); borrados += 1 })
  }
  for (const coleccion of POR_CODIGO) {
    if (coleccion === 'retoSesiones') continue // es la que el docente acaba de borrar
    escritor.delete(db.doc(`${coleccion}/${sesionId}`))
  }
  await escritor.close()
  return { borrados }
}

async function limpiarRetoDeActividad({ activityId }) {
  if (typeof activityId !== 'string' || !activityId || activityId.includes('/')) return { borrados: 0 }
  const db = getFirestore()
  const escritor = db.bulkWriter()
  let borrados = 0
  for (const coleccion of [...POR_CAMPO, ...POR_CODIGO]) {
    const snap = await db.collection(coleccion).where('actividadId', '==', activityId).get()
    snap.docs.forEach((d) => { escritor.delete(d.ref); borrados += 1 })
  }
  await escritor.close()
  await db.recursiveDelete(db.doc(`activities/${activityId}`)) // sus subcolecciones preguntas/ y clave/
  return { borrados }
}

module.exports = { limpiarRetoDeSesion, limpiarRetoDeActividad }
