#!/usr/bin/env node
// Crea el documento de `downloadLinks` que hace que /descargar sirva la
// versión recién publicada. Marcarlo como producción es lo que la vuelve
// vigente: obtenerLinkProduccion() se queda con la más reciente de las
// marcadas, así que el enlace que ya circula entre los docentes empieza a
// entregar el APK nuevo sin cambiar de URL.
//
//   node scripts/registrar-enlace-descarga.mjs <versionName> <urlDelApk>
//
// Usa FIREBASE_SERVICE_ACCOUNT (el mismo secret que los endpoints de api/),
// en JSON o en base64.
const [version, url] = process.argv.slice(2)
if (!version || !url) {
  console.error('Uso: registrar-enlace-descarga.mjs <versionName> <urlDelApk>')
  process.exit(1)
}

const raw = process.env.FIREBASE_SERVICE_ACCOUNT
if (!raw) {
  console.error('✗ Falta el secret FIREBASE_SERVICE_ACCOUNT')
  process.exit(1)
}
let cuenta
try { cuenta = JSON.parse(raw) } catch { cuenta = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) }

const { default: admin } = await import('firebase-admin')
admin.initializeApp({ credential: admin.credential.cert(cuenta) })
const db = admin.firestore()

// Mismo alfabeto que generarSlug() en src/utils/descargaLinks.js: sin vocales
// ni 0/1/l/o, para que no salgan palabras por accidente ni se confundan
// caracteres al dictarlo.
const ALFABETO = 'bcdfghjkmnpqrstvwxyz23456789'
const bytes = new Uint8Array(10)
crypto.getRandomValues(bytes)
const slug = Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('')

const fecha = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })

await db.collection('downloadLinks').doc(slug).set({
  version,
  fecha,
  url,
  fileName: null,
  produccion: true,
  activo: true,
  createdBy: 'github-actions',
  createdAt: new Date().toISOString(),
})

console.log(`✓ Enlace registrado — /descarga/${slug}`)
console.log('  /descargar ya sirve la ' + version)
