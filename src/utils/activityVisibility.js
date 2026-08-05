// Single source of truth for activity visibility.
// Used by teacher views (styling) and student views (filtering).
// Backward-compat: activities without `oculta` field are treated as visible.
// `parcialOculto` is the subject-level override (the whole parcial hidden from
// students) — when true it always wins over the activity's own `oculta` state.

import { formatHora12FromDate } from './formatHora'
import { nowIsoLocal } from './nowIso'

export function isActivityPublished(a, parcialOculto = false) {
  if (parcialOculto) return false
  if (!a?.oculta) return true
  if (a.publishAt) return new Date(a.publishAt).getTime() <= Date.now()
  return false
}

// Returns the display state for teacher UI.
// 'visible' | 'scheduled' | 'hidden'
export function activityVisibilityState(a, parcialOculto = false) {
  if (parcialOculto) return 'hidden'
  if (!a?.oculta) return 'visible'
  if (a.publishAt && new Date(a.publishAt).getTime() <= Date.now()) return 'visible'
  if (a.publishAt) return 'scheduled'
  return 'hidden'
}

// Un borrador es una actividad oculta que NUNCA se ha publicado (ni ahora ni
// programada) — distinto de "oculta" a secas, que puede ser una actividad ya
// publicada que el docente volvió a esconder. Antes este mismo predicado
// estaba copiado suelto en ~10 sitios (SubjectPage.jsx del docente lo tenía
// definido DOS veces distintas), cada uno con su propio nombre de variable.
export function isDraftActivity(a) {
  return !!a?.oculta && !a.publishedAt && !a.publishAt
}

// Una actividad SIN CALIFICACIÓN (un cuestionario de diagnóstico, una
// encuesta) se trabaja igual que cualquier otra —el estudiante la ve, la
// contesta, el docente ve sus respuestas— pero no vale para la boleta: no
// entra en la tabla de calificaciones, no entra en el promedio del parcial, no
// se exporta con las notas y NO LLEVA NÚMERO (el 1.1, 1.2… solo numera lo que
// sí cuenta).
//
// Este predicado es el que separa "aparece en Actividades" (todo lo publicado)
// de "cuenta para la calificación". Los borradores tampoco cuentan: todavía no
// existen para nadie.
// Hoy solo lo pueden marcar los cuestionarios/exámenes (vive en su
// configuración), pero se lee también en la raíz de la actividad por si algún
// día un entregable necesita lo mismo: quien pregunte, pregunta una sola vez.
export function sinCalificacion(a) {
  return a?.sinCalificacion === true || a?.evaluacion?.sinCalificacion === true
}

export function cuentaParaCalificacion(a) {
  return !isDraftActivity(a) && !sinCalificacion(a)
}

// Human-readable label for scheduled date
export function formatPublishAt(publishAt) {
  if (!publishAt) return ''
  const d = new Date(publishAt)
  return `${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, ${formatHora12FromDate(d)}`
}

// Una fecha puede llegar como 'YYYY-MM-DD' (legado, sin hora) o ya con hora
// ('...THH:MM[:SS]'). Antes este mismo "¿trae T? si no, pégale una hora por
// default" estaba repetido suelto en varios archivos (SubjectPage.jsx,
// ActivityPage.jsx), cada uno con su propio default copiado a mano — punto
// único aquí, cada llamada elige el default que le corresponde (inicio o
// fin del día) según para qué lo vaya a usar.
export function withDefaultTime(fecha, defaultTime = '00:00:00') {
  if (!fecha) return fecha
  return fecha.includes('T') ? fecha : `${fecha}T${defaultTime}`
}

// Human-readable label for the submission deadline. `fechaLimite` used to be
// a plain date (YYYY-MM-DD); default legacy values without a time component to
// 23:59:59 (end of day) — same default as `parseFechaLimite` below. Antes
// caía en '00:00:00': para una fecha límite legada sin hora, el badge de
// "Cierra" mostraba "12:00 am" mientras isOverdue/isDueToday (que sí usan
// parseFechaLimite) seguían aceptando entregas hasta las 11:59 pm de ESE
// MISMO día — la etiqueta contradecía la fecha en la que en verdad cerraba.
export function formatDeadline(fechaLimite) {
  if (!fechaLimite) return ''
  const d = new Date(withDefaultTime(fechaLimite, '23:59:59'))
  return `${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, ${formatHora12FromDate(d)}`
}

// ── Estado de entrega para el estudiante ────────────────────────────────
// Misma lógica graded/delivered/overdue que ya usa
// src/pages/student/SubjectPage.jsx (duplicada ahí dos veces) — centralizada
// aquí para que también la use la Agenda del estudiante.

// `fechaLimite` puede ser una fecha simple ('YYYY-MM-DD', legado) o traer hora
// ('...THH:MM'). Sin hora, `new Date(str)` la interpreta como medianoche UTC,
// lo que corre la fecha un día en zonas horarias al oeste de UTC — se ancla a
// las 23:59 hora LOCAL (fin del día) para que "vencida"/"hoy" coincidan con el
// calendario del estudiante, no con UTC.
export function parseFechaLimite(fechaLimite) {
  return new Date(withDefaultTime(fechaLimite, '23:59:59'))
}

export function isOverdue(activity) {
  if (!activity?.fechaLimite) return false
  const d = parseFechaLimite(activity.fechaLimite)
  return !isNaN(d.getTime()) && d < new Date()
}

export function isDueToday(activity) {
  if (!activity?.fechaLimite) return false
  const d = parseFechaLimite(activity.fechaLimite)
  if (isNaN(d.getTime())) return false
  const hoy = new Date()
  return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate()
}

// 'calificada' | 'entregada' | 'hoy' | 'vencida' | 'proxima'. Una actividad
// sin fecha límite (p.ej. el maestro aún no la captura) se trata como 'hoy'
// de forma persistente — sin esto, la Agenda la excluía por completo aunque
// ya fuera visible en "Actividades" (issue reportado: entregable nuevo, sin
// fecha límite, no aparecía en la agenda del día de publicación).
export function estadoAgenda(activity, submission) {
  const graded = submission?.calificacion != null
  const delivered = submission && !graded
  if (graded) return 'calificada'
  if (delivered) return 'entregada'
  if (!activity?.fechaLimite) return 'hoy'
  if (isDueToday(activity)) return 'hoy'
  if (isOverdue(activity)) return 'vencida'
  return 'proxima'
}

// ── Guardar una actividad: modo efectivo + validación ───────────────────
// Antes esta misma máquina de estados (resolver "hide" → "show" en un
// guardado real, exigir que lo programado sea futuro, exigir que la fecha
// límite sea posterior a la publicación efectiva, y calcular publishedAt de
// forma permanente) estaba copiada casi línea por línea en
// EntregableEditor.jsx y EvaluacionEditor.jsx — un solo punto aquí.
//
// `asDraft` sirve para dos cosas: guardar una actividad nueva sin publicarla y
// REGRESAR a borrador una que ya estaba publicada (le borra publishedAt).
//
// @param {{visibilidadMode: string, publishedAt: string|null, publishAt: string|null, fechaLimite: string|null, asDraft: boolean}} form
// @returns {{ok: true, mode: string, oculta: boolean, publishAt: string|null, publishedAt: string|null} | {ok: false, error: string}}
export function resolveVisibilidad({ visibilidadMode, publishedAt, publishAt, fechaLimite, asDraft }) {
  // Un guardado real (no borrador) de una actividad oculta que nunca se ha
  // publicado significa PUBLICAR AHORA — quedarse en borrador es el botón
  // secundario explícito.
  const mode = !asDraft && visibilidadMode === 'hide' && !publishedAt ? 'show' : visibilidadMode
  const ahora = nowIsoLocal()

  if (!asDraft && mode === 'schedule') {
    if (!publishAt) return { ok: false, error: 'Elige la fecha y hora de publicación' }
    if (publishAt <= ahora) return { ok: false, error: 'La fecha de publicación programada debe ser posterior a este momento' }
  }

  const effectivePublishAt = asDraft ? null :
    mode === 'show'      ? ahora :
    mode === 'published' ? (publishedAt || null) :
    mode === 'schedule'  ? (publishAt || null) :
    (publishedAt || null)  // hide: published-then-hidden still validates vs original date
  if (fechaLimite && effectivePublishAt && fechaLimite <= effectivePublishAt) {
    return { ok: false, error: 'La fecha límite debe ser posterior a la fecha de publicación' }
  }

  // `publishedAt` es permanente mientras la actividad siga publicada: ocultarla
  // con el ojito conserva su fecha de publicación original (esconder es
  // temporal). La ÚNICA forma de borrarla es guardar como borrador, que es
  // justo lo que distingue "borrador" de "publicada pero oculta" (ver
  // isDraftActivity): una actividad ya publicada puede regresar a borrador, y
  // al hacerlo deja de tener fecha de publicación — vuelve a ser algo que
  // nunca se publicó, no una actividad publicada escondida.
  const newPublishedAt = asDraft ? null : (mode === 'show' ? ahora : (publishedAt || null))
  return {
    ok: true,
    mode,
    oculta: asDraft || mode === 'schedule' || mode === 'hide',
    publishAt: !asDraft && mode === 'schedule' ? (publishAt || null) : null,
    publishedAt: newPublishedAt,
  }
}
