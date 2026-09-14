#!/usr/bin/env node
/**
 * Fusiona registros de asistencia duplicados para el mismo (asignatura, fecha, slot).
 *
 * Origen del problema (sep-2026): "Diseña red LAN 5D" tenía DOS registros por
 * sesión — uno del 30-ago con los IDs de un roster que después se reimportó, y
 * otro del 11-sep con los alumnos vigentes. El docente marcó faltas y
 * justificadas en ambos. La tabla elegía uno al azar y mostraba faltas falsas.
 *
 * Regla de fusión, por grupo duplicado:
 *   · Se CONSERVA el registro que cubre más alumnos vigentes de la asignatura.
 *   · De los demás se copian las marcas EXPLÍCITAS (falta / justificada / presente
 *     puesto a mano) de alumnos vigentes, solo donde el conservado tiene el
 *     presente por defecto. Si dos registros se contradicen (F vs J), el grupo
 *     NO se toca y se reporta.
 *   · Los demás registros se borran.
 *
 * Uso:
 *   cd seeds-db && node fusionar-asistencias-duplicadas.js            # simulación
 *   cd seeds-db && node fusionar-asistencias-duplicadas.js --aplicar  # escribe
 * Antes de aplicar guarda respaldo JSON en seeds-db/respaldos/.
 */
const fs = require('fs')
const path = require('path')
const admin = require('firebase-admin')

admin.initializeApp({ credential: admin.credential.cert(require('./service-account.json')) })
const db = admin.firestore()
const APLICAR = process.argv.includes('--aplicar')

const estado = (r, id) => r.justificadas?.[id] ? 'J' : r.presentes?.[id] === false ? 'F' : r.presentes?.[id] === true ? 'P' : '-'

;(async () => {
  const [attSnap, stSnap] = await Promise.all([db.collection('attendance').get(), db.collection('students').get()])
  const roster = new Map()
  stSnap.docs.forEach((d) => {
    const a = d.data().asignaturaId
    if (!roster.has(a)) roster.set(a, new Set())
    roster.get(a).add(d.id)
  })
  const grupos = new Map()
  attSnap.docs.forEach((d) => {
    const r = { id: d.id, ...d.data() }
    const k = `${r.asignaturaId}|${r.fecha}|${r.slot}`
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k).push(r)
  })
  const dups = [...grupos].filter(([, rs]) => rs.length > 1)
  console.log(`Registros: ${attSnap.size} · grupos duplicados: ${dups.length}`)
  if (!dups.length) process.exit(0)

  if (APLICAR) {
    const dir = path.join(__dirname, 'respaldos')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `attendance-duplicados-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    const data = dups.flatMap(([, rs]) => rs).map((r) => ({ ...r, createdAt: r.createdAt?.toDate?.()?.toISOString() ?? null }))
    fs.writeFileSync(file, JSON.stringify(data, null, 1))
    console.log(`Respaldo: ${file}`)
  }

  let fusionados = 0, borrados = 0, marcas = 0, saltados = 0
  for (const [k, rs] of dups) {
    const cur = roster.get(rs[0].asignaturaId) || new Set()
    const cobertura = (r) => Object.keys(r.presentes || {}).filter((id) => cur.has(id)).length
    const marcasDe = (r) => [...cur].filter((id) => ['F', 'J'].includes(estado(r, id))).length
    const [keep, ...otros] = [...rs].sort((a, b) => cobertura(b) - cobertura(a) || marcasDe(b) - marcasDe(a))
    const patch = {}
    let conflicto = false
    for (const id of cur) {
      const e = estado(keep, id)
      for (const o of otros) {
        const eo = estado(o, id)
        if (eo === '-' || eo === e) continue
        if (e === 'F' || e === 'J') { conflicto = true; console.log(`  CONFLICTO ${k} alumno ${id}: conservado=${e} otro=${eo}`); continue }
        patch[`presentes.${id}`] = eo === 'P'
        patch[`justificadas.${id}`] = eo === 'J'
        patch[`motivos.${id}`] = eo === 'J' ? (o.motivos?.[id] || '') : ''
      }
    }
    if (conflicto) { saltados++; continue }
    const n = Object.keys(patch).length / 3
    console.log(`${k}: conserva ${keep.id}, borra ${otros.map((o) => o.id).join(', ')}, marcas copiadas ${n}`)
    marcas += n
    if (APLICAR) {
      const batch = db.batch()
      if (n) batch.update(db.doc(`attendance/${keep.id}`), patch)
      otros.forEach((o) => batch.delete(db.doc(`attendance/${o.id}`)))
      await batch.commit()
    }
    fusionados++
    borrados += otros.length
  }
  console.log(`${APLICAR ? 'APLICADO' : 'SIMULACIÓN'} · grupos fusionados ${fusionados} · registros borrados ${borrados} · marcas copiadas ${marcas} · grupos con conflicto (sin tocar) ${saltados}`)
  process.exit(0)
})()
