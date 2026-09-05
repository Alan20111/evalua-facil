#!/usr/bin/env node
// Comprueba que el APK que se va a publicar está FIRMADO y trae la versión
// que el workflow cree que trae. Sin esto, un fallo silencioso de la firma
// (secret vacío, alias equivocado) se publicaría igual y nadie podría
// instalarlo encima de la versión anterior.
//
//   node scripts/verificar-apk.mjs <ruta.apk> <versionCode> <versionName>
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const [apk, codeEsperado, nameEsperado] = process.argv.slice(2)
if (!apk || !existsSync(apk)) {
  console.error(`✗ No existe el APK: ${apk}`)
  process.exit(1)
}

// Un APK firmado solo con los esquemas v2/v3 —lo normal desde minSdk 24— NO
// lleva certificados en META-INF: la firma vive en el "APK Signing Block",
// un bloque binario antes del directorio central del zip, identificado por
// esta cadena mágica. Buscar META-INF/*.RSA daba falso negativo sobre un APK
// perfectamente firmado (comprobado en local).
const MAGIA = Buffer.from('APK Sig Block 42', 'utf8')
const bytes = readFileSync(apk)
const firmadoV2 = bytes.includes(MAGIA)

// v1 (firma JAR clásica) para APKs con minSdk bajo.
const listado = execFileSync('unzip', ['-l', apk], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const firmadoV1 = /META-INF\/[^/]+\.(RSA|EC|DSA)\b/.test(listado)

if (!firmadoV2 && !firmadoV1) {
  console.error('✗ El APK NO está firmado — revisa los secrets de la llave')
  process.exit(1)
}

// El manifiesto binario guarda el versionName como texto plano; el
// versionCode va codificado, así que se comprueba contra el build.gradle que
// acaba de escribir bump-android-version.mjs.
const gradle = readFileSync('android/app/build.gradle', 'utf8')
const code = gradle.match(/versionCode\s+(\d+)/)?.[1]
const name = gradle.match(/versionName\s+"([^"]+)"/)?.[1]

if (code !== String(codeEsperado) || name !== nameEsperado) {
  console.error(`✗ Descuadre de versión — gradle dice ${code}/${name}, el workflow esperaba ${codeEsperado}/${nameEsperado}`)
  process.exit(1)
}

console.log(`✓ APK firmado (${firmadoV2 ? 'v2/v3' : 'v1'}), versionCode ${code}, versionName ${name}`)
