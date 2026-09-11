#!/usr/bin/env node

/**
 * Regenera attendanceSummaries con registros a nivel de sesión (slot).
 *
 * POR QUÉ HACE FALTA: la versión anterior de recalcularResumenAsistencia
 * colapsaba los slots del mismo día en un único registro ("peor estado del
 * día"), de modo que un alumno con dos clases en lunes solo veía una entrada.
 * El fix en functions/index.js corrige el cálculo en adelante; este script
 * regenera los resúmenes existentes para que el historial pasado también
 * refleje las sesiones individuales.
 *
 * SEGURO: lee de `attendance` (fuente de verdad) y sobreescribe
 * `attendanceSummaries` — el mismo efecto que dispara onAttendanceEscrita en
 * cada escritura. No toca ninguna otra colección.
 *
 * Uso:
 *   cd seeds-db && npm install
 *   node backfill-attendance-summaries.js --dry-run   # muestra pares, no escribe
 *   node backfill-attendance-summaries.js             # regenera todos
 *
 * Requiere Firebase Admin SDK (GOOGLE_APPLICATION_CREDENTIALS o
 * `firebase login` con firebase-cli).
 */

const admin = require('firebase-admin')

const DRY_RUN = process.argv.includes('--dry-run')

if (!admin.apps.length) admin.initializeApp()
const db = admin.firestore()
const FieldValue = admin.firestore.FieldValue

async function recalcularResumenAsistencia(asignaturaId, studentId) {
  const studentSnap = await db.doc(`students/${studentId}`).get()
  if (!studentSnap.exists) {
    if (!DRY_RUN) await db.doc(`attendanceSummaries/${studentId}`).delete()
    console.log(`  [DELETE] alumno ${studentId} ya no existe`)
    return
  }

  const createdAt = studentSnap.data().createdAt
  const enrolledFrom = createdAt?.toDate ? (() => {
    const d = createdAt.toDate()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })() : null

  const snap = await db.collection('attendance').where('asignaturaId', '==', asignaturaId).get()
  const records = snap.docs.map((d) => d.data())
    .map((r) => r.parcial != null ? r : { ...r, parcial: 1 })
    .filter((r) => !enrolledFrom || r.fecha >= enrolledFrom)
    .sort((a, b) => (a.fecha === b.fecha ? (a.slot ?? 1) - (b.slot ?? 1) : a.fecha.localeCompare(b.fecha)))

  const porParcial = {}
  let asistTotal = 0, inasistTotal = 0, justifTotal = 0
  const registros = []

  for (const r of records) {
    const presente = r.presentes?.[studentId] !== false
    const justificada = !!r.justificadas?.[studentId]
    const estado = presente ? 'presente' : justificada ? 'justificada' : 'falta'
    const p = String(r.parcial)
    if (!porParcial[p]) porParcial[p] = { asist: 0, inasist: 0, justif: 0, total: 0 }
    porParcial[p].total++
    if (estado === 'falta') { porParcial[p].inasist++; inasistTotal++ }
    else {
      porParcial[p].asist++; asistTotal++
      if (estado === 'justificada') { porParcial[p].justif++; justifTotal++ }
    }
    registros.push({
      fecha: r.fecha,
      slot: r.slot ?? 1,
      parcial: r.parcial,
      estado,
      motivo: r.motivos?.[studentId] || '',
    })
  }

  if (!DRY_RUN) {
    await db.doc(`attendanceSummaries/${studentId}`).set({
      asignaturaId,
      porParcial,
      total: { asist: asistTotal, inasist: inasistTotal, justif: justifTotal, total: records.length },
      registros,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
  return registros.length
}

async function run() {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (sin escrituras)' : 'ESCRITURA REAL'}`)

  const summariesSnap = await db.collection('attendanceSummaries').get()
  console.log(`Encontrados ${summariesSnap.size} resumen(es) existentes.`)

  // Pares únicos (asignaturaId, studentId) para regenerar
  const pares = summariesSnap.docs.map((d) => ({
    studentId: d.id,
    asignaturaId: d.data().asignaturaId,
  })).filter((p) => p.asignaturaId)

  console.log(`Pares a procesar: ${pares.length}`)

  let ok = 0, errores = 0
  for (const { asignaturaId, studentId } of pares) {
    try {
      const n = await recalcularResumenAsistencia(asignaturaId, studentId)
      console.log(`  [OK] ${studentId} / ${asignaturaId} — ${n ?? 'borrado'} registro(s)`)
      ok++
    } catch (err) {
      console.error(`  [ERR] ${studentId} / ${asignaturaId}: ${err.message}`)
      errores++
    }
  }

  console.log(`\nCompletado. OK: ${ok}  Errores: ${errores}`)
}

run().catch((err) => { console.error(err); process.exit(1) })
