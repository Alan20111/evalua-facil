#!/usr/bin/env node
// Crea el documento de `downloadLinks` que hace que /descargar sirva la
// versión recién publicada. Marcarlo como producción es lo que la vuelve
// vigente: obtenerLinkProduccion() se queda con la más reciente de las
// marcadas, así que el enlace que ya circula entre los docentes empieza a
// entregar el APK nuevo sin cambiar de URL.
//
//   node scripts/registrar-enlace-descarga.mjs <versionName> <urlDelApk>
//
// Acepta DOS credenciales, en este orden:
//
//   1. FIREBASE_SERVICE_ACCOUNT — JSON (o base64) de una cuenta de servicio,
//      el mismo secret que usan los endpoints de api/.
//   2. FIREBASE_TOKEN — el de `firebase login:ci`, que ya estaba configurado
//      para desplegar functions y reglas.
//
// La segunda existe para no obligar a dar de alta una credencial nueva solo
// por este paso: quien ya puede desplegar reglas y functions puede de sobra
// escribir un enlace de descarga.
const [version, url] = process.argv.slice(2)
if (!version || !url) {
  console.error('Uso: registrar-enlace-descarga.mjs <versionName> <urlDelApk>')
  process.exit(1)
}

const PROYECTO = 'evalua-facil-app'

// Mismo alfabeto que generarSlug() en src/utils/descargaLinks.js: sin vocales
// ni 0/1/l/o, para que no salgan palabras por accidente ni se confundan
// caracteres al dictarlo.
const ALFABETO = 'bcdfghjkmnpqrstvwxyz23456789'
const bytes = new Uint8Array(10)
crypto.getRandomValues(bytes)
const slug = Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('')

const fecha = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
const datos = {
  version,
  fecha,
  url,
  fileName: null,
  produccion: true,
  activo: true,
  createdBy: 'github-actions',
  createdAt: new Date().toISOString(),
}

// ── Camino 1: cuenta de servicio ────────────────────────────────────────────
const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (sa) {
  let cuenta
  try { cuenta = JSON.parse(sa) } catch { cuenta = JSON.parse(Buffer.from(sa, 'base64').toString('utf8')) }
  const { default: admin } = await import('firebase-admin')
  admin.initializeApp({ credential: admin.credential.cert(cuenta) })
  await admin.firestore().collection('downloadLinks').doc(slug).set(datos)
  console.log(`✓ Enlace registrado con la cuenta de servicio — /descarga/${slug}`)
  console.log('  /descargar ya sirve la ' + version)
  process.exit(0)
}

// ── Camino 2: token de la CLI de Firebase ───────────────────────────────────
const refresh = process.env.FIREBASE_TOKEN
if (!refresh) {
  console.error('✗ Falta FIREBASE_SERVICE_ACCOUNT o FIREBASE_TOKEN')
  process.exit(1)
}

// client_id/secret públicos de firebase-tools (van dentro del binario de la CLI).
const r = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
    refresh_token: refresh,
    grant_type: 'refresh_token',
  }),
})
if (!r.ok) {
  console.error('✗ FIREBASE_TOKEN no sirvió: ' + (await r.text()).slice(0, 300))
  process.exit(1)
}
const { access_token: token } = await r.json()

// Firestore REST quiere los valores tipados.
const campos = {}
for (const [k, v] of Object.entries(datos)) {
  if (v === null) campos[k] = { nullValue: null }
  else if (typeof v === 'boolean') campos[k] = { booleanValue: v }
  else campos[k] = { stringValue: String(v) }
}

const res = await fetch(
  `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents/downloadLinks?documentId=${slug}`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: campos }),
  }
)
if (!res.ok) {
  console.error('✗ Firestore rechazó la escritura: ' + (await res.text()).slice(0, 300))
  process.exit(1)
}

console.log(`✓ Enlace registrado con FIREBASE_TOKEN — /descarga/${slug}`)
console.log('  /descargar ya sirve la ' + version)
