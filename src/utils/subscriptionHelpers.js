import { Timestamp } from 'firebase/firestore'

// ── Trial policy — single source of truth ──────────────────────────────────
// Any change to the trial's length or warning windows happens here, nowhere
// else. Built so future paid plans plug into the same `isSubscriptionExpired`
// / `canCreateContent` checks instead of each page inventing its own rule.
export const TRIAL_DURATION_DAYS = 30
// No mention of expiration before this many days are left (day 25 of 30).
export const TRIAL_WARNING_DAYS = 5
// Last stretch of the trial — same banner slot, just more visible styling.
export const TRIAL_URGENT_DAYS = 2

export function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (value.toDate) return value.toDate()
  return new Date(value)
}

export function calcDaysRemaining(fechaVencimiento) {
  const end = toDate(fechaVencimiento)
  if (!end) return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  return Math.ceil((end - now) / (1000 * 60 * 60 * 24))
}

export function calcVencimiento(fechaInicio, periodicidad) {
  const start = toDate(fechaInicio) || new Date()
  const end = new Date(start)
  if (periodicidad === 'anual') {
    end.setFullYear(end.getFullYear() + 1)
  } else {
    end.setMonth(end.getMonth() + 1)
  }
  return end
}

export function calcVencimientoTimestamp(fechaInicio, periodicidad) {
  return Timestamp.fromDate(calcVencimiento(fechaInicio, periodicidad))
}

export function calcTrialEnd(fechaInicio) {
  const start = toDate(fechaInicio) || new Date()
  const end = new Date(start)
  end.setDate(end.getDate() + TRIAL_DURATION_DAYS)
  return end
}

export function calcTrialEndTimestamp(fechaInicio) {
  return Timestamp.fromDate(calcTrialEnd(fechaInicio))
}

// A subscription stops allowing new content the moment it's expired — a
// trial past its `fechaVencimiento`, or a paid plan marked `vencida`. This is
// the one place that decides "expired"; everything else (banners, create
// buttons) reads from here instead of re-deriving the rule.
export function isSubscriptionExpired(subscription) {
  if (!subscription) return false
  if (subscription.status === 'vencida') return true
  if (subscription.status === 'trial') {
    const days = calcDaysRemaining(subscription.fechaVencimiento)
    return days !== null && days <= 0
  }
  return false
}

// Viewing, exporting and everything already created stays available forever.
// Only NEW content (subjects, activities, grades) is gated by this check.
export function canCreateContent(subscription) {
  return !isSubscriptionExpired(subscription)
}

// Trial banner copy — null means "say nothing" (days 1-24 of the trial).
// Continuity-first wording throughout: never implies lost work, always a
// clear next step (activate a plan) instead of an alarm.
export function getTrialBannerMessage(subscription) {
  if (subscription?.status !== 'trial') return null
  const days = calcDaysRemaining(subscription.fechaVencimiento)
  if (days === null) return null

  if (days <= 0) {
    return {
      text: 'Tu período de prueba terminó. Tu información sigue segura — activa tu suscripción para seguir creando.',
      urgent: true,
      expired: true,
    }
  }
  if (days > TRIAL_WARNING_DAYS) return null
  if (days <= TRIAL_URGENT_DAYS) {
    return {
      text: 'Tu período de prueba está por terminar. Conserva tus grupos, alumnos, actividades y calificaciones activando tu suscripción.',
      urgent: true,
      expired: false,
    }
  }
  return {
    text: days === 1 ? 'Te queda 1 día de prueba' : `Te quedan ${days} días de prueba`,
    urgent: false,
    expired: false,
  }
}

export function formatPlanLabel(plan) {
  if (!plan) return '—'
  const period = plan.periodicidad === 'anual' ? 'año' : 'mes'
  return `${plan.nombre} — $${plan.precio}/${period}`
}

export function formatLimit(value, label) {
  if (value === -1) return `${label} ilimitados`
  return `${value} ${label}`
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount || 0)
}

export function formatDate(value) {
  const d = toDate(value)
  if (!d) return '—'
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function getSubscriptionStatusColor(status) {
  const colors = {
    activa: 'bg-emerald-100 text-emerald-700',
    vencida: 'bg-red-100 text-red-700',
    cancelada: 'bg-slate-100 text-slate-600',
    pendiente_pago: 'bg-amber-100 text-amber-700',
    trial: 'bg-blue-100 text-blue-700',
  }
  return colors[status] || 'bg-slate-100 text-slate-600'
}

export function getPaymentStatusColor(status) {
  const colors = {
    pendiente: 'bg-amber-100 text-amber-700',
    completado: 'bg-emerald-100 text-emerald-700',
    rechazado: 'bg-red-100 text-red-700',
  }
  return colors[status] || 'bg-slate-100 text-slate-600'
}

export function getDaysLabel(days) {
  if (days === null || days === undefined) return ''
  if (days > 0) return `Te quedan ${days} día${days === 1 ? '' : 's'}`
  if (days === 0) return 'Vence hoy'
  return `Venció hace ${Math.abs(days)} día${Math.abs(days) === 1 ? '' : 's'}`
}

export const SUBSCRIPTION_STATUSES = ['activa', 'vencida', 'cancelada', 'pendiente_pago', 'trial']
