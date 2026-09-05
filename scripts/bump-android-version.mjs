#!/usr/bin/env node
// Sube la versión de android/app/build.gradle y publica los valores nuevos
// como salidas del step (GITHUB_OUTPUT), para que el resto del workflow los
// use sin volver a leer el archivo.
//
//   node scripts/bump-android-version.mjs [versionName]
//
// El versionCode SIEMPRE sube en uno: Play rechaza uno repetido y Android no
// deja instalar encima una versión con código menor. El versionName se puede
// fijar a mano; si no, sube el último dígito (1.0.6 → 1.0.7).
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'

const RUTA = 'android/app/build.gradle'
const gradle = readFileSync(RUTA, 'utf8')

const codeActual = Number(gradle.match(/versionCode\s+(\d+)/)?.[1])
const nameActual = gradle.match(/versionName\s+"([^"]+)"/)?.[1]
if (!Number.isInteger(codeActual) || !nameActual) {
  console.error('✗ No pude leer versionCode/versionName de ' + RUTA)
  process.exit(1)
}

const code = codeActual + 1
const pedido = (process.argv[2] || '').trim()
let name
if (pedido) {
  if (!/^\d+\.\d+\.\d+$/.test(pedido)) {
    console.error(`✗ "${pedido}" no tiene forma de versión (se espera 1.2.3)`)
    process.exit(1)
  }
  name = pedido
} else {
  const partes = nameActual.split('.')
  partes[partes.length - 1] = String(Number(partes[partes.length - 1]) + 1)
  name = partes.join('.')
}

writeFileSync(RUTA, gradle
  .replace(/versionCode\s+\d+/, `versionCode ${code}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${name}"`))

console.log(`${codeActual} / ${nameActual}  →  ${code} / ${name}`)
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `versionCode=${code}\nversionName=${name}\n`)
}
