/**
 * verificar-version-app.js — SOLO LECTURA.
 *
 * Responde, con números, a la pregunta que decide cuándo se puede cerrar la
 * lectura directa de Firestore para los estudiantes: ¿cuántos alumnos que SÍ
 * entran a la plataforma lo hacen todavía con un cliente que no avisa su versión?
 *
 * Cruza dos fuentes:
 *   · Auth: último acceso de cada estudiante activado (lastRefreshTime).
 *   · `clientesAlumno/{uid}`: la versión que reporta el cliente nuevo cuando
 *     llama a /api/student/cliente-ping.
 *
 * Un cliente viejo nunca llama a cliente-ping: un alumno ACTIVO sin registro es
 * un alumno con un cliente viejo (o que no ha abierto ninguna pantalla desde que
 * salió la versión nueva — por eso se mira por ventanas de días).
 *
 * Imprime únicamente CONTEOS por plataforma y versión. Ningún nombre, usuario,
 * uid ni dato personal sale por pantalla ni se guarda.
 *
 * Uso:
 *   node verificar-version-app.js                 # ventanas de 7, 14 y 30 días
 *   node verificar-version-app.js --dias=7,60
 *
 * Credenciales: GOOGLE_APPLICATION_CREDENTIALS, o seeds-db/service-account.json.
 */

const admin = require('firebase-admin')
const fs = require('fs')
const path = require('path')

const argDias = process.argv.find((a) => a.startsWith('--dias='))
const VENTANAS = (argDias ? argDias.slice('--dias='.length).split(',') : ['7', '14', '30'])
  .map((n) => parseInt(n, 10))
  .filter((n) => Number.isInteger(n) && n > 0)

const claveLocal = path.join(__dirname, 'service-account.json')
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'evalua-facil-app' })
} else if (fs.existsSync(claveLocal)) {
  admin.initializeApp({ credential: admin.credential.cert(require(claveLocal)) })
} else {
  console.error('Falta GOOGLE_APPLICATION_CREDENTIALS o seeds-db/service-account.json')
  process.exit(1)
}
const db = admin.firestore()
const auth = admin.auth()

const DIA_MS = 24 * 60 * 60 * 1000

async function ultimosAccesos(uids) {
  const mapa = new Map()
  for (let i = 0; i < uids.length; i += 100) {
    const lote = uids.slice(i, i + 100).map((uid) => ({ uid }))
    const { users } = await auth.getUsers(lote)
    users.forEach((u) => {
      const t = Date.parse(u.metadata.lastRefreshTime || u.metadata.lastSignInTime || '')
      if (!Number.isNaN(t)) mapa.set(u.uid, t)
    })
  }
  return mapa
}

function sumar(mapa, clave) {
  mapa.set(clave, (mapa.get(clave) || 0) + 1)
}

function imprimirMapa(titulo, mapa) {
  console.log(`  ${titulo}`)
  if (!mapa.size) { console.log('    (ninguno)'); return }
  ;[...mapa.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`    ${String(n).padStart(5)}  ${k}`))
}

;(async () => {
  const estudiantes = await db.collection('students').where('activado', '==', true).get()
  const uids = [...new Set(estudiantes.docs.map((d) => d.data().uid).filter(Boolean))]
  const accesos = await ultimosAccesos(uids)

  const clientes = new Map()
  ;(await db.collection('clientesAlumno').get()).docs.forEach((d) => clientes.set(d.id, d.data()))

  const ahora = Date.now()
  console.log(`Estudiantes activados con cuenta: ${uids.length}`)
  console.log(`Clientes que ya reportan su versión (clientesAlumno): ${clientes.size}`)

  for (const dias of VENTANAS) {
    const corte = ahora - dias * DIA_MS
    const activos = uids.filter((uid) => (accesos.get(uid) || 0) >= corte)
    const porVersion = new Map()
    let sinRegistro = 0
    activos.forEach((uid) => {
      const c = clientes.get(uid)
      if (!c) { sinRegistro++; return }
      sumar(porVersion, `${c.plataforma} ${c.versionName || '(web)'}${c.buildId ? ` · build ${c.buildId}` : ''}`)
    })
    const conRegistro = activos.length - sinRegistro
    const pct = activos.length ? Math.round((conRegistro / activos.length) * 100) : 0
    console.log(`\n── Con acceso en los últimos ${dias} días: ${activos.length} alumnos`)
    console.log(`   Con versión reportada: ${conRegistro} (${pct} %)   ·   SIN registro (cliente viejo o sin abrir una pantalla nueva): ${sinRegistro}`)
    imprimirMapa('Por plataforma y versión (solo los que reportan):', porVersion)
  }

  console.log('\nLectura: la lectura directa de Firestore solo se puede cerrar cuando el número «SIN registro» de una ventana')
  console.log('razonable (p. ej. 30 días) sea cero o cuentas que ya nadie usa. La fecha de corte la decide el dueño del proyecto.')
  process.exit(0)
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
