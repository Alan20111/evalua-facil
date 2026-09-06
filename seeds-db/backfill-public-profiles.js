#!/usr/bin/env node

/**
 * F-05 backfill — crea publicProfiles/{uid} para cada docente existente.
 *
 * POR QUÉ HACE FALTA: la nueva regla de Firestore restringe la lectura de
 * users/{uid} a su propio dueño y al admin. Los alumnos ahora leen los datos
 * de presentación del docente desde publicProfiles/{uid}, que solo contiene los
 * campos públicos autorizados. Este backfill inicializa esa colección para los
 * docentes que ya existían antes del despliegue de F-05.
 *
 * ORDEN OBLIGATORIO DE DESPLIEGUE:
 *   1. Ejecutar este backfill (crea publicProfiles para todos los docentes).
 *   2. Desplegar Firestore Rules (activa la restricción en users + habilita
 *      publicProfiles).
 *   3. Desplegar el cliente en Vercel (los alumnos leen de publicProfiles).
 *
 * CAMPOS COPIADOS (únicamente los públicos autorizados):
 *   - nombreMostrar  (alias/nombre visible para alumnos)
 *   - prefijo        (título: Profa., Ing., etc.)
 *   - nombre         (nombre real, fallback cuando no hay nombreMostrar)
 *   - photoURL       (foto de perfil del docente)
 *   - mostrarFotoAlumnos (preferencia de visibilidad de foto)
 *
 * CAMPOS NO COPIADOS (permanecen privados en users/{uid}):
 *   email, codigoPostal, apellidoPaterno, apellidoMaterno, provider,
 *   hasLocalPassword, role, username, escuelaId, schoolName, suscripcionHasta
 *   y cualquier otro campo interno.
 *
 * Uso:
 *   cd seeds-db && npm install
 *   node backfill-public-profiles.js --dry-run   # solo muestra qué haría
 *   node backfill-public-profiles.js             # escribe en Firestore
 *
 * Requiere Firebase Admin SDK (GOOGLE_APPLICATION_CREDENTIALS o
 * application-default credentials vía `firebase login`).
 */

const admin = require('firebase-admin')

const DRY_RUN = process.argv.includes('--dry-run')
const PUBLIC_FIELDS = ['nombreMostrar', 'prefijo', 'nombre', 'photoURL', 'mostrarFotoAlumnos']

if (!admin.apps.length) admin.initializeApp()
const db = admin.firestore()

function pickPublicFields(data) {
  const out = {}
  PUBLIC_FIELDS.forEach((f) => {
    if (Object.prototype.hasOwnProperty.call(data, f)) out[f] = data[f]
  })
  return out
}

async function run() {
  const usersSnap = await db.collection('users').where('role', '==', 'docente').get()
  console.log(`Found ${usersSnap.size} docente(s).`)

  let created = 0
  let skipped = 0
  let errors = 0

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id
    const data = userDoc.data()
    const publicFields = pickPublicFields(data)

    if (Object.keys(publicFields).length === 0) {
      console.log(`  [skip] ${uid} — no public fields to write`)
      skipped++
      continue
    }

    if (DRY_RUN) {
      console.log(`  [dry-run] Would write publicProfiles/${uid}:`, publicFields)
      created++
      continue
    }

    try {
      await db.collection('publicProfiles').doc(uid).set(publicFields, { merge: true })
      console.log(`  [ok] publicProfiles/${uid}`)
      created++
    } catch (err) {
      console.error(`  [error] ${uid}: ${err.message}`)
      errors++
    }
  }

  console.log(`\nDone. created/updated: ${created}, skipped: ${skipped}, errors: ${errors}`)
  if (DRY_RUN) console.log('(dry-run — nothing was written)')
  if (errors > 0) process.exit(1)
}

run().catch((err) => { console.error(err); process.exit(1) })
