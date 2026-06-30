import { Timestamp } from 'firebase/firestore'

// ── Trial policy — single source of truth ──────────────────────────────────
// Any change to the trial's length or warning windows happens here, nowhere
// else. Built so future paid plans plug into the same `isSubscriptionExpired`
// / `canCreateContent` checks instead of each page inventing its own rule.
export const TRIAL_DURATION_DAYS = 30
// Warning notice starts when this many days (or fewer) are left — day 25 of 30.
export const TRIAL_WARNING_DAYS = 6

// ── Commercial model — single source of truth ──────────────────────────────
// Exactly one paid offering exists: a monthly subscription. No tiers, no
// plan names ("Pro"/"Básico"/"Premium"/"Enterprise") anywhere in the product.
export const CURRENCY = 'MXN'
export const MONTHLY_PRICE_MXN = 116
export const MONTHLY_PRICE_LABEL = '$116 MXN al mes'
export const SUBSCRIPTION_NAME = 'Suscripción mensual'
// Must match the id of the single Firestore `plans/{id}` doc that
// api/_lib/billing.js reads server-side to charge via Mercado Pago/PayPal —
// the price always comes from there, never from the client. Keep that
// document's `precio` in sync with MONTHLY_PRICE_MXN via seeds-db/seed-plans.js.
export const MONTHLY_PLAN_ID = 'pro'

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

// A trial's real end is always `fechaInicio + TRIAL_DURATION_DAYS` — never
// whatever happens to be stored in `fechaVencimiento`. Older/seeded
// subscription docs can carry windows from before the 30-day policy (e.g.
// 60 days), so trial day counts are always recomputed here instead of
// trusting that field, the one place the trial length is allowed to live.
export function effectiveVencimiento(subscription) {
  if (!subscription) return null
  if (subscription.status === 'trial') return calcTrialEnd(subscription.fechaInicio)
  return subscription.fechaVencimiento
}

// A subscription stops allowing new content the moment it's expired — a
// trial past its real end, or a paid plan marked `vencida`. This is the one
// place that decides "expired"; everything else (banners, create buttons)
// reads from here instead of re-deriving the rule.
export function isSubscriptionExpired(subscription) {
  if (!subscription) return false
  if (subscription.status === 'vencida') return true
  if (subscription.status === 'trial') {
    const days = calcDaysRemaining(effectiveVencimiento(subscription))
    return days !== null && days <= 0
  }
  return false
}

// Viewing, exporting and everything already created stays available forever.
// Only NEW content (subjects, activities, grades) is gated by this check.
export function canCreateContent(subscription) {
  return !isSubscriptionExpired(subscription)
}

// Trial banner copy — the day counter is always visible from day 1 of the
// trial; a warning notice is added only for the last stretch. Continuity-first
// wording throughout: never implies lost work, always a clear next step
// (activate the subscription) instead of an alarm.
//
// Returns { counter, notice, tone } or null when there's no trial to report.
//   - days 1-24 (days >= 7): counter only, tone 'neutral', no notice.
//   - days 25-29 (2-6 días restantes): counter + amber notice, tone 'warning'.
//   - day 30 (1 día restante): notice only ("Último día…"), tone 'warning'.
//   - expired (days <= 0): notice only, tone 'expired'.
export function getTrialBannerMessage(subscription) {
  if (subscription?.status !== 'trial') return null
  const days = calcDaysRemaining(effectiveVencimiento(subscription))
  if (days === null) return null

  if (days <= 0) {
    return {
      counter: null,
      notice: 'Tu período de prueba terminó. Tu información sigue segura — activa tu suscripción mensual para seguir creando.',
      tone: 'expired',
    }
  }
  if (days === 1) {
    return {
      counter: null,
      notice: 'Último día de tu período de prueba.',
      tone: 'warning',
    }
  }
  const counter = `Período de prueba · Te quedan ${days} días`
  if (days <= TRIAL_WARNING_DAYS) {
    return {
      counter,
      notice: `Tu período de prueba está por terminar. Conserva tus grupos, estudiantes, actividades y calificaciones activando tu suscripción mensual por solo $${MONTHLY_PRICE_MXN} MXN.`,
      tone: 'warning',
    }
  }
  return { counter, notice: null, tone: 'neutral' }
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
