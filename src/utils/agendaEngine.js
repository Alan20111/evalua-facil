// Motor de la Agenda del estudiante — organiza por PRIORIDAD/CONTEXTO en vez
// de una lista cronológica agrupada por fecha (Hoy/Ayer/Viernes…). Reutiliza
// los mismos `items` (actividad + entrega resueltos) que ya arma
// src/pages/student/Agenda.jsx; agrega bloques de horario y eventos.

import { timeToMinutes, toDateStr } from './horarioBloques'
import { addDays, startOfWeekMon } from './calendarGrid'

const MS_MIN = 60 * 1000
const MS_HORA = 60 * MS_MIN
const MS_DIA = 24 * MS_HORA

// ── Tiempo restante — nunca solo la fecha ────────────────────────────────
export function tiempoRestante(fecha, ahora = new Date()) {
  const diffMs = fecha.getTime() - ahora.getTime()
  if (diffMs <= 0) {
    const vencidoMs = -diffMs
    const dias = Math.floor(vencidoMs / MS_DIA)
    if (dias >= 1) return `Vencida hace ${dias} día${dias === 1 ? '' : 's'}`
    return 'Vencida hoy'
  }
  const dias = Math.floor(diffMs / MS_DIA)
  if (dias >= 1) return `Faltan ${dias} día${dias === 1 ? '' : 's'}`
  const horas = Math.floor(diffMs / MS_HORA)
  if (horas >= 1) return `Faltan ${horas} hora${horas === 1 ? '' : 's'}`
  const minutos = Math.max(1, Math.floor(diffMs / MS_MIN))
  return `Faltan ${minutos} minuto${minutos === 1 ? '' : 's'}`
}

// Colores por estado/tipo — convención única en toda la plataforma (pedido
// explícito): rojo vencida, naranja vence hoy, amarillo próxima, verde
// entregada/completada, azul examen, morado evento.
export const ESTADO_ESTILO = {
  vencida:    { bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500' },
  hoy:        { bg: 'bg-orange-50',  text: 'text-orange-700',  dot: 'bg-orange-500' },
  proxima:    { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  entregada:  { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  calificada: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  examen:     { bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  evento:     { bg: 'bg-purple-50',  text: 'text-purple-700',  dot: 'bg-purple-500' },
}

const COMPLETADO = new Set(['entregada', 'calificada'])
const PENDIENTE = new Set(['hoy', 'proxima', 'vencida'])

// ── Horario del día: "Ahora" y "Próxima clase" ──────────────────────────
// `bloquesHoy` = horarioBloques de hoy del alumno (ya filtrados por materia
// inscrita), cada uno enriquecido con `subject`/`teacherName`.
export function getAhora(bloquesHoy, ahora = new Date()) {
  const nowMin = ahora.getHours() * 60 + ahora.getMinutes()
  return bloquesHoy.find((b) => {
    const ini = timeToMinutes(b.horaInicio)
    const fin = timeToMinutes(b.horaFin)
    return nowMin >= ini && nowMin < fin
  }) || null
}

export function getProximaClase(bloquesHoy, ahora = new Date()) {
  const nowMin = ahora.getHours() * 60 + ahora.getMinutes()
  const futuros = bloquesHoy
    .filter((b) => timeToMinutes(b.horaInicio) > nowMin)
    .sort((a, b) => timeToMinutes(a.horaInicio) - timeToMinutes(b.horaInicio))
  return futuros[0] || null
}

// ── Prioridad de hoy ──────────────────────────────────────────────────────
// Orden exacto del pedido: 1) vence hoy, 2) exámenes de hoy, 3) eventos
// académicos de hoy, 4) eventos personales de hoy. `eventosHoy` ya viene
// filtrado a los de hoy (académicos + personales, con `tipo`).
export function getPrioridadHoy(items, eventosHoy, todayStr) {
  const deHoy = items.filter((it) => it.estado === 'hoy' && toDateStr(it.fecha) === todayStr)
  const examenesHoy = deHoy.filter((it) => it.activity.categoria === 'examen').sort((a, b) => a.fecha - b.fecha)
  const otrasHoy = deHoy.filter((it) => it.activity.categoria !== 'examen').sort((a, b) => a.fecha - b.fecha)
  const academicosHoy = eventosHoy.filter((e) => e.tipo === 'academico')
  const personalesHoy = eventosHoy.filter((e) => e.tipo === 'personal')
  return [
    ...otrasHoy.map((item) => ({ tipo: 'actividad', item })),
    ...examenesHoy.map((item) => ({ tipo: 'examen', item })),
    ...academicosHoy.map((evento) => ({ tipo: 'evento_academico', evento })),
    ...personalesHoy.map((evento) => ({ tipo: 'evento_personal', evento })),
  ]
}

// ── Pendientes — nunca mezcla entregadas, ordenadas por vencimiento ──────
export function getPendientes(items) {
  return items.filter((it) => PENDIENTE.has(it.estado)).sort((a, b) => a.fecha - b.fecha)
}

// ── Completadas ───────────────────────────────────────────────────────────
export function getCompletadas(items) {
  return items.filter((it) => COMPLETADO.has(it.estado)).sort((a, b) => b.fecha - a.fecha)
}

// ── Próximos 7 días — actividades/exámenes pendientes + eventos, mezclados
// cronológicamente (no se separan por tipo, a diferencia de las demás
// secciones — el pedido es una sola línea de tiempo). No incluye lo ya
// vencido: eso ya vive en "Pendientes"/rojo, mostrarlo aquí también sería
// duplicar la misma tarjeta en dos secciones.
export function getProximos7Dias(items, eventos, ahora = new Date()) {
  const limite = new Date(ahora.getTime() + 7 * MS_DIA)
  const actividades = items
    .filter((it) => PENDIENTE.has(it.estado) && it.estado !== 'vencida' && it.fecha <= limite)
    .map((item) => ({ tipo: item.activity.categoria === 'examen' ? 'examen' : 'actividad', fecha: item.fecha, item }))
  const eventosEnRango = eventos
    .filter((e) => e.fechaInicio >= ahora && e.fechaInicio <= limite)
    .map((evento) => ({ tipo: evento.tipo === 'academico' ? 'evento_academico' : 'evento_personal', fecha: evento.fechaInicio, evento }))
  return [...actividades, ...eventosEnRango].sort((a, b) => a.fecha - b.fecha)
}

// ── Progreso semanal — actividades con vencimiento esta semana (lunes a
// domingo) que ya están entregadas/calificadas, sobre el total de esa
// semana. Solo cuenta lo que YA tenía que entregarse en la semana en curso,
// no lo de semanas futuras.
export function getProgresoSemanal(items, ahora = new Date()) {
  const inicio = startOfWeekMon(ahora)
  const fin = addDays(inicio, 7)
  const deLaSemana = items.filter((it) => it.fecha >= inicio && it.fecha < fin)
  const completadas = deLaSemana.filter((it) => COMPLETADO.has(it.estado))
  return { completadas: completadas.length, total: deLaSemana.length }
}

// ── Mensaje inteligente — un resumen de una línea del estado del día ─────
export function getMensajeInteligente(prioridadHoy, todayStr, items) {
  const pendientesHoy = prioridadHoy.filter((p) => p.tipo === 'actividad').length
  const examenesHoy = prioridadHoy.filter((p) => p.tipo === 'examen').length
  const eventosAcademicosHoy = prioridadHoy.filter((p) => p.tipo === 'evento_academico').length
  const eventosPersonalesHoy = prioridadHoy.filter((p) => p.tipo === 'evento_personal').length

  if (examenesHoy > 0) return `Hoy tienes ${examenesHoy === 1 ? 'un examen' : `${examenesHoy} exámenes`}.`
  if (pendientesHoy > 0) return `Hoy tienes ${pendientesHoy} actividad${pendientesHoy === 1 ? '' : 'es'} pendiente${pendientesHoy === 1 ? '' : 's'}.`
  if (eventosAcademicosHoy > 0) return 'Hoy tienes un evento académico.'
  if (eventosPersonalesHoy > 0) return 'Hoy tienes un evento personal.'
  const hayVencidas = items.some((it) => it.estado === 'vencida')
  if (hayVencidas) return 'Tienes actividades vencidas sin entregar.'
  const hayPendientesFuturas = items.some((it) => it.estado === 'proxima')
  if (hayPendientesFuturas) return 'Todo está al corriente por ahora.'
  return 'No tienes actividades para hoy.'
}
