import { Timestamp } from 'firebase/firestore'

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
