#!/usr/bin/env node

/**
 * Respaldo inicial de `rastroEntregas` (limpieza automática al eliminar actividades, 8-nov-2026;
 * functions/actividadLimpieza.js).
 *
 * Desde el despliegue, cada entrega nueva deja su rastro `rastroEntregas/{submissionId}` = { actividadId, alumnoId,
 * submissionId }, y al borrar una actividad la Cloud Function `onActividadBorradaLimpiar` usa ese rastro para borrar
 * lo que cuelga de cada entrega (historial de notas, respuestas, avance del video…), incluso de estudiantes ya
 * eliminados. Las entregas que ya existían ANTES del despliegue no tienen rastro: este script se lo pone.
 *
 * Qué recorre: `submissions.listDocuments()`, que devuelve también las rutas cuyo documento ya no existe pero que
 * conservan subcolecciones (las de estudiantes eliminados o entregas anuladas).
 *   · Entrega que existe → su `actividadId` y `alumnoId` salen de sus datos (el id debe ser `{actividad}_{alumno}`).
 *   · Ruta sin documento → la actividad es el prefijo del id que corresponde a una actividad QUE EXISTE.
 *       – Ninguna actividad existe → huérfano viejo: SOLO se reporta, no se borra ni se registra.
 *       – Más de una posible → ambigua: SOLO se reporta.
 * Cada rastro se escribe en una transacción que comprueba que la actividad sigue existiendo (la misma regla que la
 * función). Un rastro que ya exista no se toca. Repetible: correrlo dos veces no cambia nada.
 *
 * NO borra nada. NO toca entregas, estudiantes ni actividades.
 *
 * Orden de despliegue: functions (con onEntregaCreadaRastro y onActividadBorradaLimpiar) → este script.
 *
 * Uso (requiere AUTORIZACIÓN de Kike para escribir en producción):
 *   cd seeds-db && npm install
 *   node backfill-rastro-entregas.js --dry-run     # solo dice qué haría (también es lo que hace sin opciones)
 *   node backfill-rastro-entregas.js --escribir    # escribe los rastros
 *
 * Requiere credenciales del Admin SDK (GOOGLE_APPLICATION_CREDENTIALS o `firebase login`), igual que el resto de
 * scripts de esta carpeta. Con FIRESTORE_EMULATOR_HOST y GCLOUD_PROJECT apunta al emulador (así lo usan las pruebas).
 */

const admin = require('firebase-admin')

try {
  admin.initializeApp({ projectId: process.env.FIRESTORE_EMULATOR_HOST && process.env.GCLOUD_PROJECT ? process.env.GCLOUD_PROJECT : 'evalua-facil-app' })
} catch {
  // ya inicializado
}

const db = admin.firestore()
const ESCRIBIR = process.argv.includes('--escribir') && !process.argv.includes('--dry-run')
const RASTRO = 'rastroEntregas'
const idValido = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)

const existeActividad = new Map()
async function actividadExiste(id) {
  if (!idValido(id)) return false
  if (!existeActividad.has(id)) existeActividad.set(id, (await db.collection('activities').doc(id).get()).exists)
  return existeActividad.get(id)
}

// Para una ruta sin documento: los cortes `{actividad}_{alumno}` cuya actividad existe.
async function candidatos(submissionId) {
  const r = []
  for (let i = submissionId.indexOf('_'); i > 0; i = submissionId.indexOf('_', i + 1)) {
    const actividadId = submissionId.slice(0, i)
    const alumnoId = submissionId.slice(i + 1)
    if (idValido(alumnoId) && await actividadExiste(actividadId)) r.push({ actividadId, alumnoId })
  }
  return r
}

async function registrar(submissionId, actividadId, alumnoId) {
  const rastro = db.collection(RASTRO).doc(submissionId)
  return db.runTransaction(async (tx) => {
    const [act, previo] = await Promise.all([tx.get(db.collection('activities').doc(actividadId)), tx.get(rastro)])
    if (!act.exists) return 'sin_actividad'
    if (previo.exists) return 'existia'
    tx.create(rastro, { actividadId, alumnoId, submissionId, registradoEn: admin.firestore.FieldValue.serverTimestamp(), origen: 'backfill' })
    return 'registrada'
  })
}

async function main() {
  console.log(ESCRIBIR ? 'MODO ESCRITURA: se crearán los rastros que falten.' : 'MODO SIMULACIÓN (--dry-run): no se escribe nada.')
  const refs = await db.collection('submissions').listDocuments()
  const cuenta = { rutas: refs.length, vivas: 0, sinDocumento: 0, yaTenian: 0, porRegistrar: 0, registradas: 0, huerfanasViejas: 0, ambiguas: 0, idsIrregulares: 0 }
  const ejemplos = { huerfanasViejas: [], ambiguas: [], idsIrregulares: [] }
  const anotar = (tipo, id) => { cuenta[tipo] += 1; if (ejemplos[tipo].length < 10) ejemplos[tipo].push(id) }

  for (let i = 0; i < refs.length; i += 300) {
    const tramo = refs.slice(i, i + 300)
    const [snaps, rastros] = await Promise.all([db.getAll(...tramo), db.getAll(...tramo.map((r) => db.collection(RASTRO).doc(r.id)))])
    for (let j = 0; j < tramo.length; j += 1) {
      const id = tramo[j].id
      if (rastros[j].exists) { cuenta.yaTenian += 1; continue }
      let destino
      if (snaps[j].exists) {
        cuenta.vivas += 1
        const { actividadId, alumnoId } = snaps[j].data()
        if (idValido(actividadId) && idValido(alumnoId) && id === `${actividadId}_${alumnoId}`) destino = { actividadId, alumnoId }
        else { anotar('idsIrregulares', id); continue }
        if (!(await actividadExiste(actividadId))) { anotar('huerfanasViejas', id); continue }
      } else {
        cuenta.sinDocumento += 1
        const c = await candidatos(id)
        if (c.length === 0) { anotar('huerfanasViejas', id); continue }
        if (c.length > 1) { anotar('ambiguas', id); continue }
        destino = c[0]
      }
      cuenta.porRegistrar += 1
      if (ESCRIBIR && (await registrar(id, destino.actividadId, destino.alumnoId)) === 'registrada') cuenta.registradas += 1
    }
  }

  console.log(JSON.stringify(cuenta, null, 2))
  for (const [tipo, ids] of Object.entries(ejemplos)) if (ids.length) console.log(`${tipo} (primeros ${ids.length}):`, ids.join(', '))
  if (cuenta.huerfanasViejas) console.log('Huérfanos viejos: su actividad ya no existe. Este script NO los borra; limpiarlos requiere otra autorización.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
