import { Timestamp, serverTimestamp } from 'firebase/firestore'

// Créditos puros sin caducidad (20-ago-2026, migración — ver
// docs/ia/PLAN_TECNICO_CREDITOS_PUROS.md). Este módulo reemplaza a
// subscriptionHelpers.js: ya NO hay planes mensuales, trial de 30 días,
// candado de suscripción ni marca de agua en las exportaciones (21-ago-2026,
// decisión de Kike) — todo lo que no es IA es gratis para cualquier docente
// autenticado. Lo que queda:
//   · Formato/estado de PAGOS (histórico — subscriptions/payments se
//     conservan como infraestructura, sin controlar acceso).
//   · Compra de créditos (única vía de pago activa hoy).

// ── Compra de créditos (paquetes de config/iaTarifas.paquetesCreditos) ─────
export const COMPROBANTE_MAX_MB = 10

export function validarComprobante(file) {
  if (!file) return null
  if (!file.type?.startsWith('image/')) {
    return 'El comprobante debe ser una imagen (foto o captura de pantalla).'
  }
  if (file.size > COMPROBANTE_MAX_MB * 1024 * 1024) {
    return `La imagen pesa demasiado (máximo ${COMPROBANTE_MAX_MB} MB). Tómala de nuevo o recórtala.`
  }
  return null
}

// Un solo armador del documento de compra — firestore.rules revalida la
// pareja (creditos, montoMXN) contra montoOficialCredito de todos modos, esto
// es solo para no duplicar el cálculo en el componente.
export function datosDeCompraCreditos({ docenteId, paquete, referencia, comprobanteUrl = null }) {
  return {
    docenteId,
    creditos: paquete.creditos,
    montoMXN: paquete.precioMXN,
    metodo: 'transferencia',
    referencia: (referencia || '').trim(),
    status: PAYMENT_STATUS.PENDIENTE,
    origen: 'creditos_adicionales',
    createdAt: serverTimestamp(),
    ...(comprobanteUrl ? { comprobanteUrl } : {}),
  }
}

// ── Retención tras vencer (histórico — ver [[project_borrado_de_cuenta]]) ──
export const RETENTION_DAYS = 90

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

function addMonthsClamped(date, meses) {
  const d = new Date(date)
  const candidate = new Date(d.getFullYear(), d.getMonth() + meses, 1)
  const ultimoDia = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate()
  candidate.setDate(Math.min(d.getDate(), ultimoDia))
  candidate.setHours(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds())
  return candidate
}

export function calcVencimiento(fechaInicio, periodicidad, cantidad = 1) {
  const start = toDate(fechaInicio) || new Date()
  const meses = periodicidad === 'anual' ? cantidad * 12 : cantidad
  return addMonthsClamped(start, meses)
}

export function calcVencimientoTimestamp(fechaInicio, periodicidad, cantidad = 1) {
  return Timestamp.fromDate(calcVencimiento(fechaInicio, periodicidad, cantidad))
}

// Sigue viva solo para el histórico/edición manual del admin en
// SubscriptionsTable.jsx (suscripciones de prueba/desarrollo, ver plan §7) —
// ya no define ningún periodo de prueba real para docentes nuevos.
export function calcTrialEnd(fechaInicio) {
  const start = toDate(fechaInicio) || new Date()
  const end = new Date(start)
  end.setDate(end.getDate() + 30)
  return end
}

// Sigue existiendo por compatibilidad con datos históricos (`subscriptions`
// de docentes de prueba de desarrollo, sin usuarios reales que compensar —
// ver plan §7-8): calcula el vencimiento efectivo de una suscripción vieja
// para mostrarla en el histórico del admin. NO gatea nada — el candado de
// suscripción se eliminó.
export function effectiveVencimiento(subscription) {
  if (!subscription) return null
  if (subscription.status === 'trial' || !subscription.planId) {
    const start = toDate(subscription.fechaInicio) || new Date()
    const end = new Date(start)
    end.setDate(end.getDate() + 30)
    return end
  }
  if (subscription.fechaVencimiento) return subscription.fechaVencimiento
  if (subscription.planId === 'cortesia' && subscription.cortesiaIndefinida) return null
  if (subscription.fechaInicio) return calcVencimiento(subscription.fechaInicio, 'mensual')
  return null
}

function isSubscriptionExpiredHistorico(subscription) {
  if (!subscription) return false
  if (subscription.status === 'vencida') return true
  const days = calcDaysRemaining(effectiveVencimiento(subscription))
  return days !== null && days < 0
}

export function diasParaEliminacion(subscription) {
  if (!isSubscriptionExpiredHistorico(subscription)) return null
  const diasVencida = -calcDaysRemaining(effectiveVencimiento(subscription))
  return RETENTION_DAYS - diasVencida
}

export function fechaEliminacion(subscription) {
  const venc = toDate(effectiveVencimiento(subscription))
  if (!venc) return null
  const fin = new Date(venc)
  fin.setDate(fin.getDate() + RETENTION_DAYS)
  return fin
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount || 0)
}

export function formatDate(value) {
  const d = toDate(value)
  if (!d) return '—'
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(value) {
  const d = toDate(value)
  if (!d) return '—'
  const fecha = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  return `${fecha}, ${hora}`
}

export function getSubscriptionStatusColor(status) {
  const colors = {
    activa: 'bg-emerald-100 text-emerald-700',
    vencida: 'bg-red-100 text-red-700',
    cancelada: 'bg-slate-100 text-slate-600',
    pendiente_pago: 'bg-amber-100 text-amber-700',
    trial: 'bg-accent-light text-accent',
  }
  return colors[status] || 'bg-slate-100 text-slate-600'
}

// ── Ciclo de vida de un pago — espejo de api/_lib/billing.js ───────────────
export const PAYMENT_STATUS = {
  INICIADO: 'iniciado',
  EN_PROCESO: 'en_proceso',
  PENDIENTE: 'pendiente',
  COMPLETADO: 'completado',
  RECHAZADO: 'rechazado',
}

const PAYMENT_STATUS_LABELS = {
  iniciado: 'sin completar',
  en_proceso: 'en proceso',
  pendiente: 'en revisión',
  completado: 'pagado',
  rechazado: 'rechazado',
}

export function getPaymentStatusLabel(status) {
  return PAYMENT_STATUS_LABELS[status] || status || '—'
}

export function esTransferenciaEnRevision(payment) {
  return payment?.status === PAYMENT_STATUS.PENDIENTE && payment?.metodo === 'transferencia'
}

export function getPaymentStatusColor(status) {
  const colors = {
    iniciado: 'bg-slate-100 text-slate-600',
    en_proceso: 'bg-amber-100 text-amber-700',
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
