#!/usr/bin/env node
/**
 * Recalcula attendanceSummaries para todos los alumnos usando la semántica
 * corregida de isPresente: presentes[studentId] === true (no !== false).
 *
 * Por qué hace falta: el CF onAttendanceEscrita solo corre cuando se escribe
 * un registro de attendance. Los summaries existentes fueron calculados con la
 * semántica antigua (undefined → presente). Este script los recalcula todos de
 * una vez para dejar docente y alumno sincronizados.
 *
 * Criterios aplicados (REGLA DEFINITIVA):
 *   · presentes[id] === true  → PRESENTE  (contabiliza como asistencia)
 *   · presentes[id] === false + justificadas[id] === true → JUSTIFICADA
 *   · presentes[id] === false, sin justificada → FALTA
 *   · presentes[id] === undefined → FALTA  (sin estado explícito = falta)
 *   · Sesiones futuras (fecha > hoy) → excluidas del conteo y del resumen
 *   · Sesiones pasadas de alumnos inscritos tardíamente → cuentan (no hay
 *     filtro enrolledFrom)
 *
 * Uso:
 *   cd seeds-db && npm install
 *   node backfill-attendance-summaries.js --dry-run
 *   node backfill-attendance-summaries.js
 *
 * Requiere credenciales del Admin SDK (GOOGLE_APPLICATION_CREDENTIALS o
 * firebase login). En la máquina de Kike usa el Application Default Credential
 * generado por firebase CLI.
 */

const admin = require('firebase-admin')

try {
  admin.initializeApp({ projectId: 'evalua-facil-app' })
} catch {
  // ya inicializado
}
const db = admin.firestore()
const FieldValue = admin.firestore.FieldValue

const dryRun = process.argv.includes('--dry-run')

// ISO de hoy — sesiones futuras (fecha > todayISO) NO se contabilizan.
const now = new Date()
const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

// Replica de parcialForDate de functions/_shared/parciales.js.
function parcialForDate(parcialesFechas, fecha) {
  if (!Array.isArray(parcialesFechas)) return null
  for (let i = 0; i < parcialesFechas.length; i++) {
    const { inicio, fin } = parcialesFechas[i] || {}
    if (inicio && fin && fecha >= inicio && fecha <= fin) return i + 1
  }
  return null
}

// Replica exacta de recalcularResumenAsistencia con la semántica === true.
async function recalcular(asignaturaId, studentId, parcialesFechas) {
  const snap = await db.collection('attendance').where('asignaturaId', '==', asignaturaId).get()

  const records = snap.docs.map((d) => d.data())
    .map((r) => {
      const parcialActual = parcialForDate(parcialesFechas, r.fecha) ?? r.parcial ?? 1
      return parcialActual === r.parcial ? r : { ...r, parcial: parcialActual }
    })
    // Excluir sesiones futuras — igual que countPresence(maxDate=todayISO) del docente.
    .filter((r) => r.fecha <= todayISO)
    .sort((a, b) => (a.fecha === b.fecha ? a.slot - b.slot : a.fecha.localeCompare(b.fecha)))

  const porParcial = {}
  let asistTotal = 0, inasistTotal = 0, justifTotal = 0
  const registros = []

  for (const r of records) {
    const presente = r.presentes?.[studentId] === true   // semántica corregida
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

  return {
    asignaturaId,
    porParcial,
    total: { asist: asistTotal, inasist: inasistTotal, justif: justifTotal, total: records.length },
    registros,
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
