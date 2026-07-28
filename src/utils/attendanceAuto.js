import { collection, getDocs, query, where, doc, serverTimestamp } from 'firebase/firestore'
// Escrituras a través del candado de suscripción vencida (ver ./firestoreGuard.js).
import { writeBatch } from './firestoreGuard'
import { db } from '../firebase'
import { toDateStr, diaSemanaLunes } from './horarioBloques'
import { buildAsuetoMap, esAsuetoPara } from './asuetos'
import { buildVacacionMap } from './vacaciones'

// Firestore batches cap at 500 writes; leave margin for chunking.
const BATCH_LIMIT = 400

// Índice del parcial (1-based) cuyo rango [inicio, fin] contiene `fecha`, o
// null si no cae en ninguno (fechas fuera del curso, o parcialesFechas vacío).
export function parcialForDate(parcialesFechas, fecha) {
  if (!Array.isArray(parcialesFechas)) return null
  for (let i = 0; i < parcialesFechas.length; i++) {
    const { inicio, fin } = parcialesFechas[i] || {}
    if (inicio && fin && fecha >= inicio && fecha <= fin) return i + 1
  }
  return null
}

// Consulta horarioBloques UNA vez — separada de syncAutoAttendanceDays para
// poder correrla en PARALELO con ensureGroupStudents/loadAttendanceRecords
// en vez de en secuencia (antes: 5-6 lecturas de Firestore una tras otra en
// cada apertura de la pestaña Asistencias, cada una pagando su propio
// round-trip — la causa real de la lentitud, no el volumen de datos).
export async function fetchClaseDiasSemana({ subjectId, docenteId }) {
  // Filtra también por docenteId (no solo asignaturaId) porque la regla de
  // Firestore de horarioBloques exige resource.data.docenteId == auth.uid —
  // mismo patrón que ya usa CalendarPage.jsx. Doble igualdad, sin índice
  // compuesto nuevo (regla del proyecto: solo where('==') encadenados).
  const bloquesSnap = await getDocs(query(
    collection(db, 'horarioBloques'),
    where('docenteId', '==', docenteId),
    where('asignaturaId', '==', subjectId),
  ))
  const porFecha = {}
  const diasSemana = new Set()
  bloquesSnap.docs.forEach((d) => {
    const b = d.data()
    if (!b.fecha) return
    porFecha[b.fecha] = (porFecha[b.fecha] || 0) + 1
    if (typeof b.diaSemana === 'number') diasSemana.add(b.diaSemana)
  })
  return { porFecha, diasSemana }
}

// Crea automáticamente los días de asistencia que falten para las fechas en
// que la asignatura YA tiene clase programada (`porFecha`, de
// fetchClaseDiasSemana), asignando el parcial según `parcialesFechas`. Todos
// los alumnos quedan presentes por defecto — el docente solo corrige las
// faltas, igual que con un día agregado a mano. No toca fechas que caigan
// fuera de todos los parciales (curso sin fechas configuradas aún, o bloque
// fuera de rango).
//
// Devuelve los registros recién creados (`nuevos`) para que el llamador los
// agregue en memoria en vez de volver a descargar TODA la asistencia de la
// asignatura — antes, cada vez que se creaba algo, se repetía la consulta
// completa de attendance por segunda vez.
export async function syncAutoAttendanceDays({ subjectId, docenteId, parcialesFechas, existingFechas, excludedFechas, studentIds, porFecha }) {
  if (!parcialesFechas?.length || !studentIds?.length || !porFecha) return { created: 0, missing: [], nuevos: [] }

  const existing = new Set(existingFechas)
  // Fechas que el docente borró a propósito — no se regeneran solas, pero se
  // reportan en `missing` para que el docente las restaure si quiere.
  const excluded = new Set(excludedFechas)
  const presentes = Object.fromEntries(studentIds.map((id) => [id, true]))
  const writes = [] // { fecha, slot, parcial }
  const missing = [] // { fecha, duracion, parcial } — excluidas pero aún válidas
  Object.keys(porFecha).forEach((fecha) => {
    if (existing.has(fecha)) return
    const parcial = parcialForDate(parcialesFechas, fecha)
    if (!parcial) return
    if (excluded.has(fecha)) { missing.push({ fecha, duracion: porFecha[fecha], parcial }); return }
    for (let slot = 1; slot <= porFecha[fecha]; slot++) writes.push({ fecha, slot, parcial })
  })

  const nuevos = []
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db)
    writes.slice(i, i + BATCH_LIMIT).forEach(({ fecha, slot, parcial }) => {
      const ref = doc(collection(db, 'attendance'))
      const data = { asignaturaId: subjectId, docenteId, fecha, slot, parcial, presentes, createdAt: serverTimestamp() }
      batch.set(ref, data)
      // createdAt local queda null (aún no resuelto por el servidor) — nada
      // en la UI de asistencias depende de esa marca de tiempo para pintar.
      nuevos.push({ id: ref.id, ...data, createdAt: null })
    })
    await batch.commit()
  }

  missing.sort((a, b) => a.fecha.localeCompare(b.fecha))
  return { created: writes.length, missing, nuevos }
}

// Días dentro de [fechaInicio, fechaFin] en los que, por caer en el mismo día
// de la semana que las clases de esta asignatura (`diasSemana`, de
// fetchClaseDiasSemana), NO hay bloque porque el docente marcó asueto o
// periodo vacacional — para mostrarlos en el área de asistencias en vez de
// que simplemente "falten" sin explicación.
export async function loadAsuetoVacacionDiasClase({ docenteId, fechaInicio, fechaFin, diasSemana }) {
  if (!fechaInicio || !fechaFin || !diasSemana?.size) return []

  const [asuetosSnap, vacacionesSnap] = await Promise.all([
    getDocs(query(collection(db, 'asuetos'), where('docenteId', '==', docenteId))),
    getDocs(query(collection(db, 'vacaciones'), where('docenteId', '==', docenteId))),
  ])
  const asuetoMap = buildAsuetoMap(asuetosSnap.docs.map((d) => d.data()))
  const vacacionMap = buildVacacionMap(vacacionesSnap.docs.map((d) => d.data()))

  const dias = []
  const inicio = new Date(fechaInicio + 'T12:00:00')
  const fin = new Date(fechaFin + 'T12:00:00')
  if (Number.isNaN(+inicio) || Number.isNaN(+fin) || fin < inicio) return dias
  const cur = new Date(inicio)
  let guard = 0
  while (cur <= fin && guard < 400) {
    guard++
    if (diasSemana.has(diaSemanaLunes(cur))) {
      const fecha = toDateStr(cur)
      // Se pregunta por 'asistencias', no por 'clases': ahora el docente puede
      // suspender las clases pero seguir pasando lista (o al revés). En los
      // asuetos guardados antes de que existiera esa opción, 'asistencias'
      // hereda el valor de 'clases', así que estos días no cambian.
      if (esAsuetoPara(asuetoMap, fecha, 'asistencias')) dias.push({ fecha, tipo: 'asueto' })
      else if (esAsuetoPara(vacacionMap, fecha, 'asistencias')) dias.push({ fecha, tipo: 'vacaciones' })
    }
    cur.setDate(cur.getDate() + 1)
  }
  return dias
}
