#!/usr/bin/env node
/**
 * Recalcula attendanceSummaries para todos los alumnos.
 *
 * Por qué hace falta: el CF onAttendanceEscrita solo corre cuando se escribe
 * un registro de attendance. Este script recalcula todos los resúmenes de una
 * vez para dejar docente y alumno sincronizados.
 *
 * La regla NO vive aquí: usa resumenAsistencia de src/utils/asistenciaResumen.js
 * (copiada a functions/_shared/), la misma función que la Cloud Function y la
 * tabla del docente — antes era una réplica y se desfasó (sep-2026).
 *   · presentes[id] === true  → PRESENTE  (contabiliza como asistencia)
 *   · justificadas[id] === true → JUSTIFICADA (contabiliza como asistencia)
 *   · presentes[id] === false → FALTA
 *   · sin llave del alumno en la columna → SIN REGISTRO (no cuenta; alta
 *     posterior a la columna)
 *   · Sesiones futuras (fecha > hoy en México) → excluidas del conteo y del resumen
 *
 * Uso:
 *   node scripts/sync-functions-shared.mjs   # genera functions/_shared/
 *   cd seeds-db && npm install
 *   node backfill-attendance-summaries.js --dry-run
 *   node backfill-attendance-summaries.js
 *
 * Requiere credenciales del Admin SDK (GOOGLE_APPLICATION_CREDENTIALS o
 * firebase login). En la máquina de Kike usa el Application Default Credential
 * generado por firebase CLI.
 */

const admin = require('firebase-admin')
const { resumenAsistencia, fechaHoyMexico } = require('../functions/_shared/asistenciaResumen.js')

try {
  admin.initializeApp({ projectId: 'evalua-facil-app' })
} catch {
  // ya inicializado
}
const db = admin.firestore()
const FieldValue = admin.firestore.FieldValue

const dryRun = process.argv.includes('--dry-run')

// ISO de hoy — sesiones futuras (fecha > todayISO) NO se contabilizan.
const todayISO = fechaHoyMexico()

async function recalcular(asignaturaId, studentId, parcialesFechas) {
  const snap = await db.collection('attendance').where('asignaturaId', '==', asignaturaId).get()
  return {
    asignaturaId,
    ...resumenAsistencia(snap.docs.map((d) => d.data()), studentId, parcialesFechas, todayISO),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

async function main() {
  console.log(dryRun ? '— DRY RUN (no escribe nada) —' : `— Backfill de attendanceSummaries (todayISO: ${todayISO}) —`)

  // Obtener todos los summaries existentes para saber qué alumnos/asignaturas procesar.
  const summarySnap = await db.collection('attendanceSummaries').get()
  console.log(`\nSummaries encontrados: ${summarySnap.size}`)

  if (!summarySnap.size) {
    console.log('Nada que hacer — no hay attendanceSummaries.')
    return
  }

  // Agrupar por asignaturaId para cargar attendance una sola vez por asignatura.
  const porAsignatura = {}
  for (const doc of summarySnap.docs) {
    const asignaturaId = doc.data().asignaturaId
    if (!asignaturaId) continue
    if (!porAsignatura[asignaturaId]) porAsignatura[asignaturaId] = []
    porAsignatura[asignaturaId].push(doc.id) // doc.id = studentId
  }

  console.log(`Asignaturas únicas: ${Object.keys(porAsignatura).length}`)

  let ok = 0, err = 0

  for (const [asignaturaId, studentIds] of Object.entries(porAsignatura)) {
    // Cargar parcialesFechas de la asignatura.
    const subjectSnap = await db.doc(`subjects/${asignaturaId}`).get()
    const parcialesFechas = subjectSnap.data()?.parcialesFechas ?? []

    for (const studentId of studentIds) {
      try {
        const summary = await recalcular(asignaturaId, studentId, parcialesFechas)

        // Antes de escribir: mostrar cuánto cambió el total.
        const oldSnap = await db.doc(`attendanceSummaries/${studentId}`).get()
        const old = oldSnap.data()?.total ?? {}
        const diff = {
          asistAntes: old.asist ?? '?',
          asistAhora: summary.total.asist,
          inasistAntes: old.inasist ?? '?',
          inasistAhora: summary.total.inasist,
        }

        console.log(`  ${studentId} (asig ${asignaturaId.slice(-6)}): asist ${diff.asistAntes}→${diff.asistAhora}, inasist ${diff.inasistAntes}→${diff.inasistAhora}`)

        if (!dryRun) {
          await db.doc(`attendanceSummaries/${studentId}`).set(summary)
        }
        ok++
      } catch (e) {
        console.error(`  ERROR ${studentId}: ${e.message}`)
        err++
      }
    }
  }

  console.log(`\n✅ ${ok} summaries ${dryRun ? 'calculados (dry-run)' : 'actualizados'}.${err ? ` ❌ ${err} errores.` : ''}`)
  if (dryRun) console.log('Corre sin --dry-run para aplicar los cambios.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
