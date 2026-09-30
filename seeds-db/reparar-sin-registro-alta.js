#!/usr/bin/env node
/**
 * Reparación histórica de "sin registro" por alta tardía (Etapa 2).
 *
 * Qué arregla: un alumno dado de alta cuando su asignatura YA tenía columnas
 * de asistencia no recibió llave en `presentes` de esas columnas, así que las
 * sesiones posteriores a su alta no existen para él. Desde #1500 el trigger
 * onEstudianteAltaSinRegistro lo evita en altas nuevas; este script corrige
 * las que ocurrieron antes.
 *
 * Regla autorizada (30-sep-2026) — la misma que el trigger, importada de
 * functions/_shared/asistenciaResumen.js (correspondeSinRegistroPorAlta):
 *   · sesión ANTERIOR al día del alta (hora de México) → no se toca
 *   · sesión del MISMO día del alta                     → NO TOCAR
 *   · sesión POSTERIOR al día del alta y sin llave      → presentes.<id> = null
 * `null` = "le corresponde, sin registro". Nunca true ni false. Nunca toca
 * justificadas, motivos ni ningún otro campo.
 *
 * Seguridad:
 *   · Simulación por defecto. Solo escribe con --aplicar.
 *   · Antes de escribir guarda un respaldo JSON de cada columna a tocar.
 *   · Por columna: vuelve a leerla, recalcula qué llaves siguen faltando y
 *     escribe con FieldPath + precondición lastUpdateTime. Si la columna
 *     cambió entre la lectura y la escritura, NO escribe: la vuelve a leer y
 *     reintenta solo con las llaves que sigan sin existir. Una llave que haya
 *     aparecido (el docente marcó la celda) se reporta y jamás se sobrescribe.
 *   · Idempotente: una llave ya escrita (null) deja de ser candidata.
 *
 * Alcance por inscripción (--alcance <archivo.json>, ver
 * reparar-sin-registro-alta.alcance.json): la decisión de QUÉ inscripciones
 * se reparan vive en ese archivo, separada de la regla. Solo se escriben las
 * inscripciones con decision "incluir". "excluir", "pendiente" y cualquier
 * inscripción que no aparezca en el archivo nunca se escriben. Cada entrada se
 * valida contra students/{studentId}: si no existe, si su asignaturaId no
 * coincide, si se repite o si la decisión no es válida, el script se detiene.
 * --aplicar sin --alcance se rechaza.
 *
 * Uso (desde seeds-db/, con functions/_shared generado):
 *   node ../scripts/sync-functions-shared.mjs
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node reparar-sin-registro-alta.js --alcance reparar-sin-registro-alta.alcance.json
 *   ... --alcance reparar-sin-registro-alta.alcance.json --aplicar   # SOLO con autorización
 * Opciones: --alcance <archivo>, --salida <dir>.
 */

const fs = require('fs')
const path = require('path')
const admin = require('firebase-admin')
const { fechaHoyMexico, tieneLlave, correspondeSinRegistroPorAlta } = require('../functions/_shared/asistenciaResumen.js')

try { admin.initializeApp({ projectId: 'evalua-facil-app' }) } catch { /* ya inicializado */ }
const db = admin.firestore()
const { FieldPath } = admin.firestore

const argv = process.argv.slice(2)
const APLICAR = argv.includes('--aplicar')
const opcion = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const ALCANCE = opcion('--alcance')
const DECISIONES = new Set(['incluir', 'excluir', 'pendiente'])
const SALIDA = opcion('--salida') || path.join(__dirname, 'respaldos')
const PREFIJO_INFORMATIVA = 'sin-asistencia:' // src/utils/asistenciaInformativa.js
const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/
const MAX_INTENTOS = 5

const HOY = fechaHoyMexico()
const LUNES = (() => {
  const d = new Date(`${HOY}T12:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()
const tramoDe = (fecha) => (fecha > HOY ? 'futura' : fecha >= LUNES ? 'semana_actual' : 'historica')
const sello = new Date().toISOString().replace(/[:.]/g, '-')

// Motivos por los que una celda sin llave y posterior al alta NO se toca.
function motivoInseguro(col, studentId) {
  if (typeof col.id === 'string' && col.id.startsWith(PREFIJO_INFORMATIVA)) return 'columna informativa'
  if (!FECHA_OK.test(col.fecha || '')) return 'fecha con formato inválido'
  if (col.presentes != null && (typeof col.presentes !== 'object' || Array.isArray(col.presentes))) return 'presentes no es un mapa'
  if (col.justificadas && Object.prototype.hasOwnProperty.call(col.justificadas, studentId)) return 'tiene justificadas sin presentes'
  if (col.motivos && Object.prototype.hasOwnProperty.call(col.motivos, studentId)) return 'tiene motivos sin presentes'
  return null
}

// Lee y valida el archivo de alcance. Cualquier inconsistencia detiene el
// script: nunca se "adivina" qué inscripción quiso decir el archivo.
function cargarAlcance(archivo, studentsPorId) {
  const ruta = path.resolve(archivo)
  const json = JSON.parse(fs.readFileSync(ruta, 'utf8'))
  if (!Array.isArray(json.inscripciones)) throw new Error(`Alcance: ${ruta} no tiene "inscripciones"`)
  const porId = new Map()
  const errores = []
  json.inscripciones.forEach((e, i) => {
    const donde = `inscripciones[${i}] (${e?.username || e?.studentId || '?'})`
    if (!e?.studentId || !e?.asignaturaId) { errores.push(`${donde}: falta studentId o asignaturaId`); return }
    if (!DECISIONES.has(e.decision)) { errores.push(`${donde}: decision "${e.decision}" no es incluir/excluir/pendiente`); return }
    if (porId.has(e.studentId)) { errores.push(`${donde}: studentId repetido`); return }
    const s = studentsPorId.get(e.studentId)
    if (!s) { errores.push(`${donde}: students/${e.studentId} no existe`); return }
    if (s.asignaturaId !== e.asignaturaId) { errores.push(`${donde}: asignaturaId ${e.asignaturaId} no coincide con students/${e.studentId} (${s.asignaturaId})`); return }
    porId.set(e.studentId, e)
  })
  if (errores.length) throw new Error(`Alcance inválido (${ruta}):\n  ${errores.join('\n  ')}`)
  return { ruta, porId }
}

// Clasifica cada par (inscripción, columna de SU asignatura).
function clasificar(students, columnasPorAsig) {
  const c = {
    paresRevisados: 0, sinFechaAlta: [], yaRegistradas: 0, yaNull: 0,
    anteriores: 0, mismoDia: [], reparables: [], inseguras: [],
  }
  for (const s of students) {
    const cols = columnasPorAsig.get(s.asignaturaId) || []
    const altaDate = s.createdAt?.toDate?.() || null
    const altaISO = altaDate ? fechaHoyMexico(altaDate) : null
    for (const col of cols) {
      if (col.asignaturaId !== s.asignaturaId) continue // defensa: nunca otra asignatura
      c.paresRevisados++
      if (tieneLlave(col, s.id)) {
        if (col.presentes[s.id] === null) c.yaNull++
        else c.yaRegistradas++
        continue
      }
      if (!altaISO) { c.sinFechaAlta.push({ studentId: s.id, columna: col.id }); continue }
      if (col.fecha < altaISO) { c.anteriores++; continue }
      const celda = {
        columna: col.id, asignaturaId: s.asignaturaId, studentId: s.id, uid: s.uid || null,
        username: s.username || null, fecha: col.fecha, slot: col.slot ?? 1, altaISO,
        altaUTC: altaDate.toISOString(),
      }
      if (col.fecha === altaISO) { c.mismoDia.push({ ...celda, accion: 'NO TOCAR — mismo día del alta' }); continue }
      // fecha > altaISO y sin llave
      if (!correspondeSinRegistroPorAlta(col, s.id, altaISO)) throw new Error(`Regla inconsistente en ${col.id}/${s.id}`)
      const inseguro = motivoInseguro(col, s.id)
      if (inseguro) { c.inseguras.push({ ...celda, motivo: inseguro }); continue }
      c.reparables.push({ ...celda, tramo: tramoDe(col.fecha) })
    }
  }
  return c
}

function escribirJSON(nombre, datos) {
  fs.mkdirSync(SALIDA, { recursive: true })
  const archivo = path.join(SALIDA, `${nombre}-${sello}.json`)
  fs.writeFileSync(archivo, JSON.stringify(datos, null, 1))
  return archivo
}

const serial = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x.toDate === 'function' ? { __ts: x.toDate().toISOString() } : x)))

async function aplicar(reparables, columnasPorId, incluidos) {
  // Segunda barrera: aunque el llamador se equivoque, aquí solo pasan celdas
  // de inscripciones marcadas "incluir" en el alcance.
  const ajenas = reparables.filter((r) => !incluidos.has(r.studentId) || r.decision !== 'incluir')
  if (ajenas.length) throw new Error(`aplicar() recibió ${ajenas.length} celda(s) fuera del alcance "incluir" — no se escribe nada`)
  const porColumna = new Map()
  for (const r of reparables) {
    if (!porColumna.has(r.columna)) porColumna.set(r.columna, [])
    porColumna.get(r.columna).push(r)
  }
  // Respaldo ANTES de cualquier escritura: la columna completa + su versión.
  const respaldo = [...porColumna.keys()].map((id) => {
    const col = columnasPorId.get(id)
    return { id, updateTime: col._updateTime.toDate().toISOString(), data: serial(col._data) }
  })
  const archivoRespaldo = escribirJSON('respaldo-attendance-sin-registro', respaldo)
  console.log(`Respaldo: ${archivoRespaldo} (${respaldo.length} columnas)`)

  const resultado = { escritas: 0, celdasEscritas: 0, carreras: [], fallidas: [], columnasBorradas: [], bajas: [] }
  for (const [colId, celdas] of porColumna) {
    const ref = db.doc(`attendance/${colId}`)
    let pendientes = celdas
    for (let intento = 1; intento <= MAX_INTENTOS && pendientes.length; intento++) {
      const fresh = await ref.get()
      if (!fresh.exists) { resultado.columnasBorradas.push(colId); pendientes = []; break }
      const data = { id: colId, ...fresh.data() }
      // Solo las que SIGUEN cumpliendo la regla con la lectura fresca.
      const siguen = []
      for (const cel of pendientes) {
        if (!incluidos.has(cel.studentId)) throw new Error(`Fuera de alcance: ${cel.studentId}`)
        const alumno = await db.doc(`students/${cel.studentId}`).get()
        if (!alumno.exists || alumno.data().asignaturaId !== cel.asignaturaId) { resultado.bajas.push(cel); continue }
        if (data.asignaturaId !== cel.asignaturaId || !correspondeSinRegistroPorAlta(data, cel.studentId, cel.altaISO) || motivoInseguro(data, cel.studentId)) {
          resultado.carreras.push({ ...cel, valorActual: tieneLlave(data, cel.studentId) ? data.presentes[cel.studentId] : '(sin llave, ya no aplica)' })
          continue
        }
        siguen.push(cel)
      }
      if (!siguen.length) { pendientes = []; break }
      const args = []
      for (const cel of siguen) args.push(new FieldPath('presentes', cel.studentId), null)
      try {
        await ref.update(...args, { lastUpdateTime: fresh.updateTime })
        resultado.escritas++
        resultado.celdasEscritas += siguen.length
        pendientes = []
      } catch (e) {
        if (e.code === 9 || /FAILED_PRECONDITION/i.test(e.message)) {
          console.log(`  ${colId}: cambió entre lectura y escritura — se relee (intento ${intento})`)
          pendientes = siguen
          continue
        }
        resultado.fallidas.push({ columna: colId, error: e.message })
        pendientes = []
      }
    }
    if (pendientes.length) resultado.fallidas.push({ columna: colId, error: `sin completar tras ${MAX_INTENTOS} intentos`, celdas: pendientes.length })
  }
  return resultado
}

async function main() {
  if (APLICAR && !ALCANCE) throw new Error('--aplicar exige --alcance <archivo.json>: sin lista explícita no se escribe nada')
  console.log(APLICAR ? '— APLICAR: escribe en Firestore —' : '— SIMULACIÓN (dry-run): no escribe nada en Firestore —')
  console.log(`Hoy (México): ${HOY} · semana actual desde ${LUNES}`)

  const [attSnap, studSnap, subjSnap] = await Promise.all([
    db.collection('attendance').get(),
    db.collection('students').get(),
    db.collection('subjects').get(),
  ])
  const nombres = Object.fromEntries(subjSnap.docs.map((d) => [d.id, `${d.data().nombre || ''} (${d.data().grupo || ''})`]))
  const columnasPorAsig = new Map()
  const columnasPorId = new Map()
  for (const d of attSnap.docs) {
    const col = { id: d.id, ...d.data(), _updateTime: d.updateTime, _data: d.data() }
    columnasPorId.set(d.id, col)
    if (!columnasPorAsig.has(col.asignaturaId)) columnasPorAsig.set(col.asignaturaId, [])
    columnasPorAsig.get(col.asignaturaId).push(col)
  }
  const students = studSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const alcance = ALCANCE ? cargarAlcance(ALCANCE, new Map(students.map((s) => [s.id, s]))) : null
  if (alcance) console.log(`Alcance: ${alcance.ruta} (${alcance.porId.size} inscripciones válidas)`)

  // Duplicados (misma asignatura, fecha y sesión): se reportan y sus columnas no se tocan.
  const dup = new Map()
  for (const [asig, cols] of columnasPorAsig) for (const col of cols) {
    const k = `${asig}_${col.fecha}_${col.slot ?? 1}`
    dup.set(k, (dup.get(k) || 0) + 1)
  }
  const clavesDuplicadas = new Set([...dup].filter(([, n]) => n > 1).map(([k]) => k))

  const c = clasificar(students, columnasPorAsig)
  const duplicadas = c.reparables.filter((r) => clavesDuplicadas.has(`${r.asignaturaId}_${r.fecha}_${r.slot}`))
  const reparables = c.reparables.filter((r) => !clavesDuplicadas.has(`${r.asignaturaId}_${r.fecha}_${r.slot}`))

  // Verificación independiente de cada celda reparable contra el documento leído.
  for (const r of reparables) {
    const col = columnasPorId.get(r.columna)
    if (!(r.fecha > r.altaISO)) throw new Error(`Verificación: ${r.columna}/${r.studentId} no es posterior al alta`)
    if (tieneLlave(col, r.studentId)) throw new Error(`Verificación: ${r.columna} ya tiene la llave ${r.studentId}`)
    if (col.asignaturaId !== r.asignaturaId) throw new Error(`Verificación: ${r.columna} es de otra asignatura`)
  }

  // Decisión de alcance por celda. Sin archivo de alcance, todo queda
  // "sin_decision" (solo simulación). Una inscripción que no esté en el
  // archivo también es "sin_decision" y nunca se escribe.
  for (const r of reparables) {
    const e = alcance?.porId.get(r.studentId)
    if (e && e.asignaturaId !== r.asignaturaId) throw new Error(`Alcance: ${r.studentId} con asignatura distinta a la de la celda ${r.columna}`)
    r.decision = e ? e.decision : 'sin_decision'
  }
  const incluidas = reparables.filter((r) => r.decision === 'incluir')
  const incluidos = new Set(incluidas.map((r) => r.studentId))

  const cuenta = (lista, k) => lista.reduce((m, x) => (m[x[k]] = (m[x[k]] || 0) + 1, m), {})
  const porAsig = {}
  for (const r of reparables) {
    const a = (porAsig[r.asignaturaId] ||= { nombre: nombres[r.asignaturaId] || '?', inscripciones: new Set(), columnas: new Set(), historica: 0, semana_actual: 0, futura: 0, mismoDia: 0 })
    a.inscripciones.add(r.studentId); a.columnas.add(r.columna); a[r.tramo]++
  }
  for (const m of c.mismoDia) {
    (porAsig[m.asignaturaId] ||= { nombre: nombres[m.asignaturaId] || '?', inscripciones: new Set(), columnas: new Set(), historica: 0, semana_actual: 0, futura: 0, mismoDia: 0 }).mismoDia++
  }
  const tramos = cuenta(reparables, 'tramo')
  const resumen = {
    hoyMexico: HOY,
    semanaActualDesde: LUNES,
    paresRevisados: c.paresRevisados,
    candidatas: reparables.length + c.mismoDia.length + c.inseguras.length + duplicadas.length,
    reparables: reparables.length,
    porTramo: { historicas: tramos.historica || 0, semanaActual: tramos.semana_actual || 0, futuras: tramos.futura || 0 },
    excluidas: {
      mismoDiaDelAlta: c.mismoDia.length,
      anterioresAlAlta: c.anteriores,
      yaRegistradasTrueFalse: c.yaRegistradas,
      yaEnNull: c.yaNull,
      sinFechaDeAlta: c.sinFechaAlta.length,
      inseguras: c.inseguras.length,
      enColumnasDuplicadas: duplicadas.length,
    },
    inscripcionesAfectadas: new Set(reparables.map((r) => r.studentId)).size,
    personasAfectadas: new Set(reparables.map((r) => r.uid || `sin-uid:${r.studentId}`)).size,
    asignaturasAfectadas: Object.keys(porAsig).filter((k) => porAsig[k].columnas.size).length,
    columnasAfectadas: new Set(reparables.map((r) => r.columna)).size,
  }

  console.log('\n' + JSON.stringify(resumen, null, 2))
  console.log('\nPor asignatura:')
  for (const [id, a] of Object.entries(porAsig)) {
    console.log(`  ${id} | ${a.nombre} | inscripciones=${a.inscripciones.size} columnas=${a.columnas.size} | históricas=${a.historica} semanaActual=${a.semana_actual} futuras=${a.futura} | mismo día (NO TOCAR)=${a.mismoDia}`)
  }
  const porDecision = {}
  for (const r of reparables) {
    const d = (porDecision[r.decision] ||= { celdas: 0, historicas: 0, semanaActual: 0, futuras: 0 })
    d.celdas++
    d[r.tramo === 'historica' ? 'historicas' : r.tramo === 'semana_actual' ? 'semanaActual' : 'futuras']++
  }
  resumen.porDecision = porDecision
  console.log('\nPor decisión de alcance (solo "incluir" se escribe):')
  for (const [d, v] of Object.entries(porDecision)) console.log(`  ${d.padEnd(12)} celdas=${v.celdas} (históricas=${v.historicas} semanaActual=${v.semanaActual} futuras=${v.futuras})`)
  console.log('\nPor inscripción:')
  const porInscripcion = new Map()
  for (const r of reparables) {
    const x = porInscripcion.get(r.studentId) || { studentId: r.studentId, asignaturaId: r.asignaturaId, username: r.username, decision: r.decision, celdas: 0, historica: 0, semana_actual: 0, futura: 0, mismoDia: 0 }
    x.celdas++; x[r.tramo]++
    porInscripcion.set(r.studentId, x)
  }
  for (const m of c.mismoDia) { const x = porInscripcion.get(m.studentId); if (x) x.mismoDia++ }
  for (const x of [...porInscripcion.values()].sort((a, b) => a.decision.localeCompare(b.decision) || b.celdas - a.celdas)) {
    console.log(`  [${x.decision}] ${x.username} · ${nombres[x.asignaturaId] || x.asignaturaId} · students/${x.studentId} | celdas=${x.celdas} (hist=${x.historica} semana=${x.semana_actual} fut=${x.futura}) | mismo día NO TOCAR=${x.mismoDia}`)
  }
  if (alcance) {
    for (const e of alcance.porId.values()) {
      if (!porInscripcion.has(e.studentId)) console.log(`  AVISO: ${e.username} (students/${e.studentId}) está en el alcance como "${e.decision}" pero no tiene celdas reparables`)
    }
  }
  if (c.inseguras.length) console.log('\nInseguras (no se tocan):', cuenta(c.inseguras, 'motivo'))
  if (duplicadas.length) console.log(`\nEn columnas duplicadas (no se tocan): ${duplicadas.length}`)

  const plan = escribirJSON(APLICAR ? 'plan-aplicado-sin-registro' : 'plan-dry-run-sin-registro', {
    resumen,
    alcance: alcance ? alcance.ruta : null,
    incluidas,
    reparables,
    mismoDia: c.mismoDia,
    inseguras: c.inseguras,
    duplicadas,
    sinFechaAlta: c.sinFechaAlta,
  })
  console.log(`\nPlan detallado (archivo local, no Firestore): ${plan}`)

  if (!APLICAR) {
    console.log(`\nSimulación terminada. No se escribió nada. Con --aplicar se escribirían ${incluidas.length} celda(s) "incluir" en ${new Set(incluidas.map((r) => r.columna)).size} columna(s) (requiere autorización).`)
    return
  }
  const r = await aplicar(incluidas, columnasPorId, incluidos)
  const archivo = escribirJSON('resultado-sin-registro', r)
  console.log(`\nColumnas escritas: ${r.escritas} · celdas: ${r.celdasEscritas} · carreras (no sobrescritas): ${r.carreras.length} · bajas: ${r.bajas.length} · borradas: ${r.columnasBorradas.length} · fallidas: ${r.fallidas.length}`)
  console.log(`Resultado: ${archivo}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
