// Datos de PRUEBA para el emulador local (project demo-esqueletos). Nunca toca producción.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
const admin = require('../../seeds-db/node_modules/firebase-admin')
admin.initializeApp({ projectId: 'demo-esqueletos' })
const auth = admin.auth(), db = admin.firestore()
const CLAVE = 'PruebaEmu-2026!'
;(async () => {
  const doc = await auth.createUser({ email: 'docente.prueba@evalua.test', password: CLAVE, emailVerified: true, displayName: 'Docente Prueba' })
  const uid = doc.uid
  await db.doc(`users/${uid}`).set({
    role: 'docente', username: 'PRUEBA-01', email: 'docente.prueba@evalua.test', nombre: 'Alan', apellidoPaterno: 'Prueba',
    escuelaId: 'CBTIS255', schoolName: 'CECYTE', profileComplete: true, mostrarFotoAlumnos: true,
  })
  const paletas = ['default', 'default', 'default']
  const nombres = [['Matemáticas', '3B', 'landmark'], ['erdr', 'vy', 'book'], ['Física', '3B', 'leaf']]
  const ids = []
  for (let i = 0; i < 3; i++) {
    const r = await db.collection('subjects').add({
      nombre: nombres[i][0], grupo: nombres[i][1], docenteId: uid, escuelaId: 'CBTIS255', parciales: 3, colorPalette: paletas[i],
      icon: nombres[i][2], accessCode: ['8SU0JB', 'K3P9QX', 'M2N7ZT'][i], archived: false, order: i,
      mostrarAsistenciasEstudiantes: true, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    ids.push(r.id)
  }
  // una actividad en la primera materia
  const a = await db.collection('activities').add({
    asignaturaId: ids[0], docenteId: uid, parcial: 1, tipo: 'tarea', titulo: 'Tarea 1', nombre: 'Tarea 1', maxCalif: 10,
    descripcion: '<p>Resuelve los ejercicios.</p>', publicado: true, createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  // estudiantes de la primera materia
  for (const [n, ap] of [['Ana', 'López'], ['Luis', 'Pérez'], ['Eva', 'Ruiz']]) {
    await db.collection('students').add({ asignaturaId: ids[0], docenteId: uid, escuelaId: 'CBTIS255', nombre: n, apellidoPaterno: ap, username: (n.slice(0,2)+ap.slice(0,2)).toUpperCase(), activado: false, orden: 1 })
  }
  console.log(JSON.stringify({ uid, ids, actividad: a.id }))
})().catch((e) => { console.error(e); process.exit(1) })
