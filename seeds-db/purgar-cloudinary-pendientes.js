#!/usr/bin/env node

/**
 * La escoba de los archivos que se quedaron en Cloudinary.
 *
 * Cuando se elimina una cuenta, el servidor borra sus archivos. Si en ese
 * momento faltan las llaves de la API de Cloudinary —o si Cloudinary rechaza
 * alguno—, el archivo se queda ocupando cuota y los documentos que guardaban
 * su URL ya se borraron: sin un apunte, nadie podría volver a encontrarlo
 * nunca. Por eso `api/_lib/cloudinary.js` anota lo que no pudo borrar en la
 * colección `archivosPendientes`.
 *
 * Este script es la otra mitad: vacía esa lista cuando las llaves existen.
 *
 * Uso:
 *   cd seeds-db && npm install
 *   CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... CLOUDINARY_API_SECRET=... \
 *     node purgar-cloudinary-pendientes.js --dry-run   # solo dice qué haría
 *   ... node purgar-cloudinary-pendientes.js           # borra de verdad
 *
 * Requiere además credenciales del Admin SDK (GOOGLE_APPLICATION_CREDENTIALS),
 * igual que el resto de scripts de esta carpeta.
 *
 * Es seguro correrlo varias veces: Cloudinary responde 'not found' para lo que
 * ya no está, y eso cuenta como éxito.
 */

const crypto = require('crypto')
const admin = require('firebase-admin')

const SECO = process.argv.includes('--dry-run')
const CLOUD = process.env.CLOUDINARY_CLOUD_NAME
const KEY = process.env.CLOUDINARY_API_KEY
const SECRET = process.env.CLOUDINARY_API_SECRET

if (!CLOUD || !KEY || !SECRET) {
  console.error('Faltan CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY o CLOUDINARY_API_SECRET.')
  console.error('Son las llaves de la cuenta de Cloudinary (las tiene Alan).')
  process.exit(1)
}

if (!admin.apps.length) admin.initializeApp()
const db = admin.firestore()

// Cada apunte guarda "<tipo>/<public_id>", que es lo que necesita `destroy`.
// Ojo: en los `raw` la extensión ES parte del public_id, así que solo se
// separa por la PRIMERA barra.
function partir(entrada) {
  const i = entrada.indexOf('/')
  return { tipo: entrada.slice(0, i), publicId: entrada.slice(i + 1) }
}

// `invalidate: true` por la misma razón que en `api/_lib/cloudinary.js`: sin él
// el archivo sale del almacén pero el CDN lo sigue entregando un mes. La escoba
// existe justamente para que no quede nada, así que aquí importa igual.
// Parámetros firmados en orden alfabético.
async function destruir({ tipo, publicId }) {
  const timestamp = Math.floor(Date.now() / 1000)
  const firma = crypto.createHash('sha1')
    .update(`invalidate=true&public_id=${publicId}&timestamp=${timestamp}${SECRET}`)
    .digest('hex')
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/${tipo}/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_id: publicId, invalidate: true, api_key: KEY, timestamp, signature: firma }),
  })
  const data = await res.json().catch(() => ({}))
  return data.result === 'ok' || data.result === 'not found'
}

async function main() {
  const snap = await db.collection('archivosPendientes').where('purgado', '==', false).get()
  if (snap.empty) {
    console.log('No hay archivos pendientes. Nada que hacer.')
    return
  }

  console.log(`${snap.size} apuntes con archivos pendientes${SECO ? ' (simulacro)' : ''}:\n`)
  let totalArchivos = 0
  let totalBorrados = 0

  for (const doc of snap.docs) {
    const d = doc.data()
    const lista = d.pendientes || []
    totalArchivos += lista.length
    console.log(`· ${doc.id} — ${lista.length} archivo(s) · ${d.motivo} · ${d.origen || 'origen desconocido'}${d.uid ? ` · uid ${d.uid}` : ''}`)

    if (SECO) {
      lista.forEach((e) => console.log(`    ${e}`))
      continue
    }

    const quedan = []
    for (const entrada of lista) {
      const ok = await destruir(partir(entrada)).catch(() => false)
      console.log(`    ${ok ? 'borrado ' : 'FALLÓ   '} ${entrada}`)
      if (ok) totalBorrados++
      else quedan.push(entrada)
    }

    if (quedan.length) {
      // Se queda abierto con lo que falta, para volver a intentarlo.
      await doc.ref.update({ pendientes: quedan, ultimoIntento: new Date() })
    } else {
      await doc.ref.update({ purgado: true, pendientes: [], purgadoEn: new Date() })
    }
  }

  console.log(`\n${SECO ? 'Se borrarían' : 'Borrados'} ${SECO ? totalArchivos : totalBorrados} de ${totalArchivos} archivos.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
