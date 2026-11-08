// La Ruleta del Destino — limpieza al borrar una ruleta (fase 2, decisión C2/F2-2; paso 3, 7-nov-2026;
// docs/RULETA_DESTINO.md). Al borrar la actividad (el docente, el borrado de su asignatura o el de su cuenta) se borra
// TODO lo que cuelga de ella, como en Reto Exprés (functions/retoLimpieza.js):
//   · su banco (`ruletaReactivos`, un documento por reactivo) y su estado (`ruletaBancos/{actividadId}`);
//   · las partidas (`ruletaParticipantes`) y sus respuestas (`ruletaRespuestas`);
//   · las entregas que quedaran (`submissions` con ese actividadId), con lo que cuelgue de ellas (su historial de
//     notas). Normalmente ya las borró el navegador antes de borrar la actividad; esto cubre una partida que terminó
//     justo en ese instante y escribió su nota.
// Solo documentos con ESE actividadId: nunca los de otra actividad ni los de otro docente. Idempotente: si ya no hay
// nada, no hace nada.
const { getFirestore } = require('firebase-admin/firestore')

const idValido = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)

// Colecciones planas de la ruleta, con un documento por reactivo, partida o respuesta (se buscan por actividadId).
const POR_ACTIVIDAD = ['ruletaReactivos', 'ruletaParticipantes', 'ruletaRespuestas']

async function limpiarRuletaDeActividad({ activityId }) {
  if (!idValido(activityId)) return { borrados: 0 }
  const db = getFirestore()
  const escritor = db.bulkWriter()
  let borrados = 0
  for (const coleccion of POR_ACTIVIDAD) {
    const snap = await db.collection(coleccion).where('actividadId', '==', activityId).get()
    snap.docs.forEach((d) => { escritor.delete(d.ref); borrados += 1 })
  }
  const banco = db.doc(`ruletaBancos/${activityId}`)
  if ((await banco.get()).exists) { escritor.delete(banco); borrados += 1 }
  // Entregas que quedaran: con recursiveDelete, para no dejar su historial de notas huérfano.
  const entregas = await db.collection('submissions').where('actividadId', '==', activityId).get()
  await Promise.all(entregas.docs.map((d) => db.recursiveDelete(d.ref, escritor)))
  borrados += entregas.size
  await escritor.close()
  return { borrados }
}

module.exports = { limpiarRuletaDeActividad }
