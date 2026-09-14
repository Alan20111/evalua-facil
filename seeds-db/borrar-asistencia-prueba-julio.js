#!/usr/bin/env node
/**
 * Borra las 6 columnas de asistencia de prueba de "Cultura Digital I 1A"
 * (5JoDsdz83oJuRglfvkOV), creadas el 18/19-jul-2026 — antes de que existiera el
 * curso real. Aparecían como falta para los 49 alumnos vigentes.
 *
 * Solo borra un registro si cumple TODAS las condiciones (se revalidan aquí):
 *   · su id está en la lista explícita de abajo
 *   · fecha anterior a subjects.fechaInicio
 *   · no hay bloque de horario de la asignatura en esa fecha
 *   · ninguna llave de `presentes` es un alumno vigente de la asignatura
 *   · ninguna llave corresponde a un documento existente de students
 * Respaldo JSON en seeds-db/respaldos/ antes de borrar.
 *
 * Uso: node borrar-asistencia-prueba-julio.js [--aplicar]
 */
const fs = require('fs')
const path = require('path')
const admin = require('firebase-admin')
admin.initializeApp({ credential: admin.credential.cert(require('./service-account.json')) })
const db = admin.firestore()
const APLICAR = process.argv.includes('--aplicar')
const SUBJ = '5JoDsdz83oJuRglfvkOV'
const IDS = ['lK6nPkf13iwmvpIXHCBK', 'Al01M6sljRHI6iN8hSee', 'FLz327Wk9md0oXG3T023', 'pmg4RF9CljTO42SMu2Rm', 'oez77TlzNOJXxxAIsvY0', 'xe7QE49eu3FVlhyV3GTr']

;(async () => {
  const [sub, st, bl] = await Promise.all([
    db.doc(`subjects/${SUBJ}`).get(),
    db.collection('students').where('asignaturaId', '==', SUBJ).get(),
    db.collection('horarioBloques').where('asignaturaId', '==', SUBJ).get(),
  ])
  const { fechaInicio } = sub.data()
  const roster = new Set(st.docs.map((d) => d.id))
  const fechasBloque = new Set(bl.docs.map((d) => d.data().fecha))
  const snaps = await db.getAll(...IDS.map((id) => db.doc(`attendance/${id}`)))
  const validos = []
  for (const s of snaps) {
    if (!s.exists) { console.log(`${s.id}: ya no existe`); continue }
    const r = s.data()
    const llaves = Object.keys(r.presentes || {})
    const existentes = (await db.getAll(...llaves.map((k) => db.doc(`students/${k}`)))).filter((x) => x.exists).length
    const motivos = []
    if (r.asignaturaId !== SUBJ) motivos.push('otra asignatura')
    if (!(r.fecha < fechaInicio)) motivos.push(`fecha ${r.fecha} no es anterior a ${fechaInicio}`)
    if (fechasBloque.has(r.fecha)) motivos.push('hay clase en el horario ese día')
    if (llaves.some((k) => roster.has(k))) motivos.push('tiene alumnos vigentes')
    if (existentes) motivos.push(`${existentes} llaves son alumnos existentes`)
    console.log(`${s.id} ${r.fecha}/${r.slot}: ${motivos.length ? 'NO SE BORRA — ' + motivos.join('; ') : 'inválido, se borra'}`)
    if (!motivos.length) validos.push({ id: s.id, ...r, createdAt: r.createdAt?.toDate?.()?.toISOString() ?? null })
  }
  if (!APLICAR) { console.log(`SIMULACIÓN · se borrarían ${validos.length}`); process.exit(0) }
  if (!validos.length) process.exit(0)
  const dir = path.join(__dirname, 'respaldos')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `attendance-prueba-julio-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(file, JSON.stringify(validos, null, 1))
  console.log(`Respaldo: ${file}`)
  const batch = db.batch()
  validos.forEach((r) => batch.delete(db.doc(`attendance/${r.id}`)))
  await batch.commit()
  console.log(`APLICADO · borrados ${validos.length}`)
  process.exit(0)
})()
