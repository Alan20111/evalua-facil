import { collection, getDocs, query, where, writeBatch, doc, serverTimestamp } from 'firebase/firestore'
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

// Crea automáticamente los días de asistencia que falten para las fechas en
// que la asignatura YA tiene clase programada (colección `horarioBloques`,
// generada desde Calendario), asignando el parcial según `parcialesFechas`.
// Todos los alumnos quedan presentes por defecto — el docente solo corrige
// las faltas, igual que con un día agregado a mano. No toca fechas que
// caigan fuera de todos los parciales (curso sin fechas configuradas aún, o
// bloque fuera de rango).
export async function syncAutoAttendanceDays({ subjectId, docenteId, parcialesFechas, existingFechas, studentIds }) {
  if (!parcialesFechas?.length || !studentIds?.length) return { created: 0, diasSemana: new Set() }

  const bloquesSnap = await getDocs(query(collection(db, 'horarioBloques'), where('asignaturaId', '==', subjectId)))
  const porFecha = {}
  const diasSemana = new Set()
  bloquesSnap.docs.forEach((d) => {
    const b = d.data()
    if (!b.fecha) return
    porFecha[b.fecha] = (porFecha[b.fecha] || 0) + 1
    if (typeof b.diaSemana === 'number') diasSemana.add(b.diaSemana)
  })

  const existing = new Set(existingFechas)
  const presentes = Object.fromEntries(studentIds.map((id) => [id, true]))
  const writes = [] // { fecha, slot, parcial }
  Object.keys(porFecha).forEach((fecha) => {
    if (existing.has(fecha)) return
    const parcial = parcialForDate(parcialesFechas, fecha)
    if (!parcial) return
    for (let slot = 1; slot <= porFecha[fecha]; slot++) writes.push({ fecha, slot, parcial })
  })

  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db)
    writes.slice(i, i + BATCH_LIMIT).forEach(({ fecha, slot, parcial }) => {
      const ref = doc(collection(db, 'attendance'))
      batch.set(ref, { asignaturaId: subjectId, docenteId, fecha, slot, parcial, presentes, createdAt: serverTimestamp() })
    })
    await batch.commit()
  }

  return { created: writes.length, diasSemana }
}

// Días dentro de [fechaInicio, fechaFin] en los que, por caer en el mismo día
// de la semana que las clases de esta asignatura (`diasSemana`, de
// syncAutoAttendanceDays), NO hay bloque porque el docente marcó asueto o
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
      if (esAsuetoPara(asuetoMap, fecha, 'clases')) dias.push({ fecha, tipo: 'asueto' })
      else if (esAsuetoPara(vacacionMap, fecha, 'clases')) dias.push({ fecha, tipo: 'vacaciones' })
    }
    cur.setDate(cur.getDate() + 1)
  }
  return dias
}
