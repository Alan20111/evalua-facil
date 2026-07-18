import {
  collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

// 'YYYY-MM' (o 'YYYY-MM-DD') → 'Julio 2026' — etiqueta de la celda de mes que
// agrupa todas las columnas de días de ese mes en el encabezado de Asistencias.
export function fmtAttMonth(fecha) {
  const [y, m] = fecha.split('-').map(Number)
  return `${MESES[m - 1] || ''} ${y}`
}

// 'YYYY-MM-DD' → { dia: '18', mes: 'jul', anio: '26' } — para el encabezado vertical
// de cada columna de asistencia (día/mes/año apilado, ya que la columna es angosta
// como las de Calificaciones).
export function fmtAttDateParts(fecha) {
  const [y, m, d] = fecha.split('-').map(Number)
  return {
    dia: String(d).padStart(2, '0'),
    mes: MESES_CORTOS[m - 1] || '',
    anio: String(y).slice(-2),
  }
}

// Trae toda la asistencia de una asignatura en una sola lectura (igual que
// loadGrades con submissions) — solo where('asignaturaId','==') para no
// necesitar un índice compuesto nuevo. Ordena en memoria por fecha y slot.
export async function loadAttendanceRecords(subjectId) {
  const snap = await getDocs(query(collection(db, 'attendance'), where('asignaturaId', '==', subjectId)))
  const records = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  records.sort((a, b) => a.fecha === b.fecha ? a.slot - b.slot : a.fecha.localeCompare(b.fecha))
  return records
}

// Crea `duracion` columnas (slots 1..duracion) para el mismo día, cada una con
// todos los estudiantes actuales marcados presentes — el docente solo quita la
// palomita de quienes faltaron.
export async function createAttendanceDay({ subjectId, docenteId, fecha, duracion, parcial, studentIds }) {
  const presentes = Object.fromEntries(studentIds.map((id) => [id, true]))
  const batch = writeBatch(db)
  const refs = []
  for (let slot = 1; slot <= duracion; slot++) {
    const ref = doc(collection(db, 'attendance'))
    refs.push(ref)
    batch.set(ref, {
      asignaturaId: subjectId,
      docenteId,
      fecha,
      slot,
      parcial,
      presentes,
      createdAt: serverTimestamp(),
    })
  }
  await batch.commit()
  return refs.map((r) => r.id)
}

// Cuenta asistencias/inasistencias de un alumno sobre un conjunto de registros
// (slots). Cada slot vale una asistencia; una FALTA JUSTIFICADA cuenta como
// asistencia (no como inasistencia) — solo la falta injustificada suma a inasist.
export function countPresence(records, studentId) {
  let asist = 0
  let inasist = 0
  for (const r of records) {
    if (isPresente(r, studentId)) asist++
    else if (r.justificadas?.[studentId]) asist++
    else inasist++
  }
  return { asist, inasist }
}

// Falta la llave (alumno inscrito después de creada la columna) → se trata como
// presente, igual que el resto de la columna cuando se creó.
export function isPresente(record, studentId) {
  return record.presentes?.[studentId] !== false
}

// Estado de asistencia de 3 valores: 'presente' | 'falta' | 'justificada'.
export function attendanceState(record, studentId) {
  if (isPresente(record, studentId)) return 'presente'
  if (record.justificadas?.[studentId]) return 'justificada'
  return 'falta'
}

// Ciclo al tocar la celda: Presente → Falta → Justificada → Presente.
const NEXT_STATE = { presente: 'falta', falta: 'justificada', justificada: 'presente' }
export function nextAttendanceState(state) {
  return NEXT_STATE[state] || 'presente'
}

// Escribe el estado en Firestore. `presentes` distingue presente/ausente;
// `justificadas` marca cuáles ausencias están justificadas.
export async function setAttendanceState(recordId, studentId, state) {
  const patch = {
    [`presentes.${studentId}`]: state === 'presente',
    [`justificadas.${studentId}`]: state === 'justificada',
  }
  await updateDoc(doc(db, 'attendance', recordId), patch)
}

export async function toggleAttendance(recordId, studentId, nextValue) {
  await updateDoc(doc(db, 'attendance', recordId), { [`presentes.${studentId}`]: nextValue })
}

export async function deleteAttendanceRecord(recordId) {
  await deleteDoc(doc(db, 'attendance', recordId))
}

// Borra TODAS las columnas (slots) de un mismo día — usado cuando el docente
// se equivocó de fecha/duración y prefiere rehacer el día completo.
export async function deleteAttendanceDay(records, fecha) {
  const targets = records.filter((r) => r.fecha === fecha)
  await Promise.all(targets.map((r) => deleteDoc(doc(db, 'attendance', r.id))))
}
