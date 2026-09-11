#!/usr/bin/env node

/**
 * Backfill de sesionesPorParcialEstimadas para asignaturas existentes.
 *
 * POR QUÉ HACE FALTA: el trigger `onSubjectEscrito` solo reacciona a ESCRITURAS
 * nuevas sobre `subjects`. Las asignaturas que ya existían antes del despliegue
 * nunca dispararían ese trigger, así que se quedarían sin este campo para siempre.
 *
 * CÓMO LO HACE: usa EXACTAMENTE la misma lógica que `recomputarSesionesEstimadas`
 * en `functions/index.js` — misma función `calcularSesionesReales`, mismos inputs
 * (asuetos, vacaciones, bloques cancelados). No hay una segunda ruta de cálculo.
 *
 * CRITERIOS DE ELEGIBILIDAD (una asignatura se procesa solo si cumple todos):
 *   - docenteId presente
 *   - horarioPatron es un array no vacío
 *   - fechaInicio y fechaFin presentes
 *   - parcialesFechas es un array no vacío
 * Si algún parcial dentro de parcialesFechas tiene inicio o fin vacío, ese parcial
 * recibe 0 sesiones estimadas (correcto — no se puede estimar un rango desconocido).
 *
 * SCOPE: todas las asignaturas (activas y archivadas) que cumplan los criterios,
 * porque el export de Excel también usa el denominador.
 *
 * Uso:
 *   cd seeds-db && npm install
 *   node backfill-sesiones-estimadas.js --dry-run   # solo reporta, no escribe
 *   node backfill-sesiones-estimadas.js             # calcula y escribe en Firestore
 *   node backfill-sesiones-estimadas.js --forzar    # incluye las que ya tienen el campo
 *
 * Requiere: GOOGLE_APPLICATION_CREDENTIALS apuntando al service account de Admin SDK.
 */

const admin = require('firebase-admin')
const path = require('path')

const { calcularSesionesReales } = require(path.join(__dirname, '../functions/_shared/sesionesReales.js'))
const { fechasVacacionParaClases } = require(path.join(__dirname, '../functions/_shared/vacaciones.js'))

try {
  admin.initializeApp({ projectId: 'evalua-facil-app' })
} catch (e) {
  // ya inicializado; ignora el error de app duplicada
  void e
}
const db = admin.firestore()

const dryRun = process.argv.includes('--dry-run')
const forzar = process.argv.includes('--forzar')

if (dryRun) console.log('\n🔍 MODO DRY-RUN — no se escribirá nada en Firestore\n')

async function calcularParaSubject(subjectId, subj) {
  const uid = subj.docenteId
  const [asuetosSnap, vacSnap, bloquesSnap] = await Promise.all([
    db.collection('asuetos').where('docenteId', '==', uid).get(),
    db.collection('vacaciones').where('docenteId', '==', uid).get(),
    db.collection('horarioBloques').where('docenteId', '==', uid)
      .where('asignaturaId', '==', subjectId).get(),
  ])

  const diasAsueto = [
    ...asuetosSnap.docs.map((d) => d.data()).filter((a) => a.clases).map((a) => a.fecha),
    ...fechasVacacionParaClases(vacSnap.docs.map((d) => d.data())),
  ]
  const sesionesCanceladas = bloquesSnap.docs
    .map((d) => d.data())
    .filter((b) => b.cancelada)
    .map((b) => ({ fecha: b.fecha, horaInicio: b.horaInicio }))

  const numParciales = Math.max(1, Number(subj.parciales) || 1)
  const sesionesPorParcialEstimadas = {}

  for (let p = 1; p <= numParciales; p++) {
    const { resumen } = calcularSesionesReales({
      fechaInicio:       subj.fechaInicio,
      fechaFin:          subj.fechaFin,
      parcialesFechas:   subj.parcialesFechas,
      horarioPatron:     subj.horarioPatron,
      diasAsueto,
      sesionesCanceladas,
      parcial:           p,
    })
    sesionesPorParcialEstimadas[String(p)] = resumen.sesionesTotales
  }

  return { sesionesPorParcialEstimadas, diasAsueto: diasAsueto.length, canceladas: sesionesCanceladas.length }
}

async function main() {
  const snap = await db.collection('subjects').get()

  const elegibles = []
  const omitidos = []

  snap.docs.forEach((d) => {
    const s = d.data()
    const tieneHorario  = Array.isArray(s.horarioPatron) && s.horarioPatron.length > 0
    const tieneParciales = Array.isArray(s.parcialesFechas) && s.parcialesFechas.length > 0
    const tieneFechas   = !!s.fechaInicio && !!s.fechaFin
    const tieneDocente  = !!s.docenteId
    const yaCalculado   = !!s.sesionesPorParcialEstimadas

    if (!tieneDocente || !tieneHorario || !tieneFechas || !tieneParciales) {
      const razones = []
      if (!tieneDocente)  razones.push('sin docenteId')
      if (!tieneHorario)  razones.push('sin horarioPatron')
      if (!tieneFechas)   razones.push('sin fechaInicio/fechaFin')
      if (!tieneParciales) razones.push('sin parcialesFechas')
      omitidos.push({ id: d.id, nombre: s.nombre, razones })
      return
    }

    if (yaCalculado && !forzar) {
      omitidos.push({ id: d.id, nombre: s.nombre, razones: ['ya tiene sesionesPorParcialEstimadas (usa --forzar para recalcular)'] })
      return
    }

    elegibles.push({ id: d.id, data: s })
  })

  console.log(`\n📊 Total subjects: ${snap.size}`)
  console.log(`✅ Elegibles para backfill: ${elegibles.length}`)
  console.log(`⏭  Omitidos: ${omitidos.length}\n`)

  if (omitidos.length) {
    console.log('─── Omitidos ───────────────────────────────────')
    omitidos.forEach(({ id, nombre, razones }) => {
      console.log(`  [${id.slice(0, 8)}] ${nombre || '(sin nombre)'}: ${razones.join(', ')}`)
    })
    console.log('')
  }

  if (!elegibles.length) {
    console.log('Nada que procesar.')
    return
  }

  console.log('─── Procesando ─────────────────────────────────')
  let ok = 0
  let errores = 0

  for (const { id, data: subj } of elegibles) {
    try {
      const { sesionesPorParcialEstimadas, diasAsueto, canceladas } = await calcularParaSubject(id, subj)

      const resumenStr = Object.entries(sesionesPorParcialEstimadas)
        .map(([p, n]) => `P${p}=${n}`).join(', ')

      console.log(`  [${id.slice(0, 8)}] ${subj.nombre || '(sin nombre)'}`)
      console.log(`           Horario: ${subj.horarioPatron.length} slot(s)/semana`)
      console.log(`           Asuetos/vacaciones: ${diasAsueto} días | Cancelaciones: ${canceladas}`)
      console.log(`           → ${resumenStr}`)

      // Verificar que ningún parcial con fechas completas tenga 0 sesiones
      subj.parcialesFechas.forEach((pf, i) => {
        const p = String(i + 1)
        if (pf.inicio && pf.fin && sesionesPorParcialEstimadas[p] === 0) {
          console.log(`           ⚠ ATENCIÓN: P${p} tiene fechas válidas pero 0 sesiones — revisar`)
        }
      })

      if (!dryRun) {
        await db.collection('subjects').doc(id).update({ sesionesPorParcialEstimadas })
        console.log(`           ✅ Escrito en Firestore`)
      } else {
        console.log(`           (dry-run — no escrito)`)
      }
      ok++
    } catch (e) {
      console.error(`  [${id.slice(0, 8)}] ERROR: ${e.message}`)
      errores++
    }
    console.log('')
  }

  console.log('─────────────────────────────────────────────────')
  console.log(`Completado: ${ok} OK, ${errores} errores${dryRun ? ' (dry-run)' : ''}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
