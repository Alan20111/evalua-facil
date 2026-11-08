// La Ruleta del Destino — limpieza al borrar una ruleta (fase 2, decisión C2/F2-2; docs/RULETA_DESTINO.md).
// Al borrar la actividad (el docente, el borrado de su asignatura o el de su cuenta) se borran su banco
// (`ruletaReactivos`, un documento por reactivo) y su estado (`ruletaBancos/{actividadId}`). Solo documentos con ESE
// actividadId: nunca los de otra actividad ni los de otro docente. Idempotente: si ya no hay nada, no hace nada.
// Las sesiones y sus datos (fase 4 en adelante) los limpiará el procedimiento del servidor de la fase 8.
const { getFirestore } = require('firebase-admin/firestore')

const idValido = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)

async function limpiarRuletaDeActividad({ activityId }) {
  if (!idValido(activityId)) return { borrados: 0 }
  const db = getFirestore()
  const escritor = db.bulkWriter()
  let borrados = 0
  const snap = await db.collection('ruletaReactivos').where('actividadId', '==', activityId).get()
  snap.docs.forEach((d) => { escritor.delete(d.ref); borrados += 1 })
  const banco = db.doc(`ruletaBancos/${activityId}`)
  if ((await banco.get()).exists) { escritor.delete(banco); borrados += 1 }
  await escritor.close()
  return { borrados }
}

module.exports = { limpiarRuletaDeActividad }
