import { Timestamp } from 'firebase/firestore'

// ── Trial policy — single source of truth ──────────────────────────────────
// Any change to the trial's length or warning windows happens here, nowhere
// else. Built so future paid plans plug into the same `isSubscriptionExpired`
// / `canCreateContent` checks instead of each page inventing its own rule.
export const TRIAL_DURATION_DAYS = 30
// Warning notice starts when this many days (or fewer) are left — day 25 of 30.
export const TRIAL_WARNING_DAYS = 6

// ── Commercial model — single source of truth ──────────────────────────────
// Dos ofertas: mensual y anual (paga 10 meses, disfruta 12). No tiers ni
// nombres de nivel ("Pro"/"Básico"/"Premium"/"Enterprise") en el producto —
// solo la periodicidad cambia.
export const CURRENCY = 'MXN'
// Precio de lanzamiento — $99 en vez de los $116 normales, mientras dure la
// promoción de arranque (ligada al lanzamiento de la app Android). Sin fecha
// de reversión automática a propósito: el docente-dueño avisa cuando quiera
// subirlo, y ese día se edita este archivo otra vez, igual que ahora.
export const MONTHLY_PRICE_MXN = 99
export const MONTHLY_PRICE_LABEL = '$99 MXN al mes'
export const LAUNCH_PRICE_NOTE = 'Precio de lanzamiento'
export const SUBSCRIPTION_NAME = 'Suscripción mensual'
// Must match the id of the single Firestore `plans/{id}` doc that
// api/_lib/billing.js reads server-side to charge via Mercado Pago/PayPal —
// the price always comes from there, never from the client. Keep that
// document's `precio` in sync with MONTHLY_PRICE_MXN via seeds-db/seed-plans.js.
export const MONTHLY_PLAN_ID = 'pro'

// Plan anual — pago único (no domiciliación: Mercado Pago cobra $990 una vez
// y ya, el docente decide si renueva el año que sigue). Igual que arriba,
// `precio` en el doc `plans/anual` de Firestore es lo que de verdad cobran
// las pasarelas; mantenerlo sincronizado con ANNUAL_PRICE_MXN.
export const ANNUAL_PLAN_ID = 'anual'
export const ANNUAL_PRICE_MXN = 990
export const ANNUAL_PRICE_LABEL = '$990 MXN al año'
export const ANNUAL_SUBSCRIPTION_NAME = 'Suscripción anual'
// Derivado de MONTHLY_PRICE_MXN a propósito, no un número suelto — si el
// precio mensual cambia, el ahorro que se anuncia sigue siendo cierto.
export const ANNUAL_SAVINGS_MXN = MONTHLY_PRICE_MXN * 12 - ANNUAL_PRICE_MXN

// ── v1.0.1: solo transferencia ──────────────────────────────────────────────
// Mercado Pago y PayPal implican demasiados detalles para esta primera
// versión (validación de tarjeta, domiciliación, webhooks...) — se retoman en
// 1.0.2. Mientras tanto el único incentivo para pagar varios meses de un
// golpe (antes era el plan anual) es este descuento por transferencia.
// `pagas` es la decisión de negocio (editar a mano si cambia); `pagarias` y
// `ahorras` se derivan de MONTHLY_PRICE_MXN para que nunca queden
// desincronizados si el precio mensual cambia.
export const MESES_DESCUENTO = [
  { meses: 1, pagas: MONTHLY_PRICE_MXN },
  { meses: 2, pagas: 190 },
  { meses: 3, pagas: 273 },
  { meses: 4, pagas: 348 },
  { meses: 5, pagas: 415 },
  { meses: 6, pagas: 474 },
].map((r) => ({
  ...r,
  pagarias: r.meses * MONTHLY_PRICE_MXN,
  ahorras: r.meses * MONTHLY_PRICE_MXN - r.pagas,
}))

export function mesesDescuentoDe(meses) {
  return MESES_DESCUENTO.find((r) => r.meses === meses) || MESES_DESCUENTO[0]
}

// ── Retención tras vencer ────────────────────────────────────────────────
// Cuántos días se conserva la información de una cuenta vencida (prueba sin
// convertir o suscripción sin renovar) antes de que se elimine definitiva.
// Mismo número que usa api/cron/reminders.js para los correos de aviso — si
// cambia aquí, cambiar también allá (api/ no puede importar de src/).
// NOTA: el borrado automático al llegar a este plazo TODAVÍA NO EXISTE, solo
// el aviso. Ver [[project_borrado_de_cuenta]] — hoy solo se borra a mano.
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

// Date.setMonth()/setFullYear() se desbordan al mes siguiente cuando el día
// de inicio no cabe en el mes destino: sumar 1 mes al 31 de enero da 3 de
// marzo (el 31 "no cabe" en febrero), no el 28. Aquí se resuelve el mes/año
// destino primero (con día 1, que siempre existe) y recién después se pone
// el día real, recortado al último día de ESE mes si hace falta — mismo
// criterio que cualquier billing mensual (el aniversario de quien empezó en
// 31 "se recorta", nunca se pasa de mes).
function addMonthsClamped(date, meses) {
  const d = new Date(date)
  const candidate = new Date(d.getFullYear(), d.getMonth() + meses, 1)
  const ultimoDia = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate()
  candidate.setDate(Math.min(d.getDate(), ultimoDia))
  candidate.setHours(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds())
  return candidate
}

// `cantidad`: cuántos periodos de golpe (meses pagados por transferencia en
// un solo folio) — default 1 para todo el resto de llamadas (prueba, pago
// único, aprobación normal). Un año se trata como 12 meses para reusar el
// mismo recorte de fin de mes (afecta a quien haya empezado un 29 de
// febrero).
export function calcVencimiento(fechaInicio, periodicidad, cantidad = 1) {
  const start = toDate(fechaInicio) || new Date()
  const meses = periodicidad === 'anual' ? cantidad * 12 : cantidad
  return addMonthsClamped(start, meses)
}

export function calcVencimientoTimestamp(fechaInicio, periodicidad, cantidad = 1) {
  return Timestamp.fromDate(calcVencimiento(fechaInicio, periodicidad, cantidad))
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
  // Sin `planId` nunca hubo un pago APROBADO — sin importar a qué status
  // haya llegado (pendiente_pago, cancelada…), lo único real que tiene es su
  // periodo de prueba. `planId` solo lo pone una aprobación de verdad (ver
  // PaymentsTable.jsx handleApprove); createTeacherAccount crea la prueba
  // con `planId: ''`. Pedido explícito tras un caso real: una cuenta que
  // pidió transferencia y nunca fue aprobada mostraba "Pagaste el X" usando
  // fechaVencimiento, que para ella seguía siendo el de su prueba —
  // calculado siempre aquí, nunca confiando en el campo guardado, que para
  // este caso es justo ese mismo dato de prueba sin serlo de un pago.
  if (subscription.status === 'trial' || !subscription.planId) return calcTrialEnd(subscription.fechaInicio)
  if (subscription.fechaVencimiento) return subscription.fechaVencimiento
  // Cortesía indefinida no vence nunca a propósito — no rellenar nada ahí.
  if (subscription.planId === 'cortesia' && subscription.cortesiaIndefinida) return null
  // Vencimiento faltante (documento viejo o incompleto, guardado antes de que
  // el modal de admin lo autocompletara) pero sí hay fecha de inicio: se
  // calcula inicio + 1 mes en vez de dejarlo en blanco — un plan pagado
  // siempre dura un mes desde que arrancó.
  if (subscription.fechaInicio) return calcVencimiento(subscription.fechaInicio, 'mensual')
  return null
}

// Vencida = su ventana efectiva ya pasó, sin importar en qué estado esté
// guardada. Una sola regla para todos los casos, que es lo único que la
// mantiene coherente: antes solo caducaban las pruebas y una suscripción
// pagada seguía contando como vigente para siempre después de su fecha
// (nada en el cliente ni en el servidor la marca `vencida`), así que quien
// pagaba un mes y dejaba de pagar nunca se topaba con ningún límite.
// Sin fecha de vencimiento no se bloquea a nadie: dato faltante nunca debe
// dejar a un docente fuera de su propio trabajo.
//
// El DÍA de vencimiento sigue vigente completo, hasta las 23:59:59 — por
// eso `< 0` y no `<= 0`: calcDaysRemaining da 0 mientras hoy sea ese día
// (con las horas truncadas a medianoche), y recién da -1 al día siguiente.
// Usar `<= 0` aquí cortaba el acceso desde las 00:00 del propio día pagado.
export function isSubscriptionExpired(subscription) {
  if (!subscription) return false
  if (subscription.status === 'vencida') return true
  const days = calcDaysRemaining(effectiveVencimiento(subscription))
  return days !== null && days < 0
}

// Días que faltan para que se cumplan los RETENTION_DAYS desde que venció,
// o null si la suscripción no está vencida (no aplica el conteo). Puede dar
// negativo si ya se pasó de los 90 días — hoy eso no borra nada solo, es la
// señal de que el borrado manual ya debería haber pasado.
export function diasParaEliminacion(subscription) {
  if (!isSubscriptionExpired(subscription)) return null
  const diasVencida = -calcDaysRemaining(effectiveVencimiento(subscription))
  return RETENTION_DAYS - diasVencida
}

// Fecha exacta en que se cumplen los RETENTION_DAYS desde que venció (o
// null si no aplica). Complementa a diasParaEliminacion: un día se cuenta
// distinto según cuándo se mire la pantalla, pero la fecha calendario es
// siempre la misma — es lo que de verdad le importa a quien decide si
// vuelve o no.
export function fechaEliminacion(subscription) {
  const venc = toDate(effectiveVencimiento(subscription))
  if (!venc) return null
  const fin = new Date(venc)
  fin.setDate(fin.getDate() + RETENTION_DAYS)
  return fin
}

// Consultar, exportar y todo lo ya creado sigue disponible siempre. Esto
// gatea el TRABAJO: crear, editar, calificar, pasar lista, publicar… (ver
// utils/firestoreGuard.js, que lo aplica sobre las escrituras mismas).
export function canCreateContent(subscription) {
  return !isSubscriptionExpired(subscription)
}

// Whether to offer "renovar/activar" — no plan at all, ya vencida (sin
// importar si venció por falta de pago o porque el docente la canceló y se
// le acabaron los días que tenía cubiertos), en prueba, o un plan pagado que
// está por vencer (7 días o menos).
// Solo se retira la oferta cuando de verdad hay un comprobante esperando al
// administrador (`transferenciaEnRevision`): reabrir el checkout ahí sí
// confundiría. Antes bastaba con `status === 'pendiente_pago'`, que el
// servidor ponía con solo ABRIR la pasarela — así, un docente que presionaba
// "Pagar con Mercado Pago" y se arrepentía se quedaba sin botón para pagar,
// esperando una aprobación que nunca iba a llegar porque nunca hubo pago.
// Single source of truth — antes Profile.jsx volvía a calcular esta misma
// regla por su cuenta en vez de leerla de aquí.
export function canRenew(subscription, { transferenciaEnRevision = false } = {}) {
  if (transferenciaEnRevision) return false
  if (!subscription) return true
  if (isSubscriptionExpired(subscription)) return true
  // Pedido explícito: el docente debe poder pagar en CUALQUIER momento, no
  // solo en los últimos días — a veces tiene el dinero hoy y no lo tendrá
  // más adelante. Pagar antes de tiempo no pierde nada: CheckoutModal ya
  // extiende desde donde termina lo vigente (trial, activa o cancelada con
  // gracia), nunca recorta ni empalma días.
  return true
}

// Trial banner copy — the day counter is always visible from day 1 of the
// trial; a warning notice is added only for the last stretch. Continuity-first
// wording throughout: never implies lost work, always a clear next step
// (activate the subscription) instead of an alarm.
//
// Returns { counter, notice, tone } or null when there's no trial to report.
// El día de vencimiento sigue vigente completo hasta las 23:59:59 — mismo
// criterio que isSubscriptionExpired, por eso "expirado" es days < 0 y el
// día 0 (vence hoy) es el de "último día", no el día 1.
//   - days 1-24 (days >= 7): counter only, tone 'neutral', no notice.
//   - days 1-6 (días restantes): counter + amber notice, tone 'warning'.
//   - day 0 (vence hoy): notice only ("Último día…"), tone 'warning'.
//   - expired (days < 0): notice only, tone 'expired'.
export function getTrialBannerMessage(subscription) {
  if (subscription?.status !== 'trial') return null
  const vencimiento = effectiveVencimiento(subscription)
  const days = calcDaysRemaining(vencimiento)
  if (days === null) return null

  if (days < 0) {
    return {
      counter: null,
      notice: `Tu período de prueba terminó y tu cuenta pasó a “Suscripción cancelada”. Tu información sigue segura — la guardamos ${RETENTION_DAYS} días. Activa tu suscripción mensual para seguir creando.`,
      tone: 'expired',
    }
  }
  if (days === 0) {
    return {
      counter: null,
      notice: `Último día de tu período de prueba — termina hoy a las 23:59. Si no activas tu suscripción, tu cuenta pasará a “Suscripción cancelada”.`,
      tone: 'warning',
    }
  }
  const counter = `Período de prueba · Te quedan ${days} días`
  if (days <= TRIAL_WARNING_DAYS) {
    return {
      counter,
      notice: `Tu período de prueba termina el ${formatDate(vencimiento)}. Si no activas tu suscripción mensual por solo $${MONTHLY_PRICE_MXN} MXN, ese día tu cuenta pasará a “Suscripción cancelada” (conservas tus grupos, estudiantes, actividades y calificaciones, solo no puedes seguir creando).`,
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
    // Trial no es un estado semántico (éxito/alerta/error) sino informativo,
    // así que usa el acento del rol: guinda en el panel admin, azul en el
    // perfil del docente. Los demás SÍ son semánticos y no se tocan.
    trial: 'bg-accent-light text-accent',
  }
  return colors[status] || 'bg-slate-100 text-slate-600'
}

// ── Ciclo de vida de un pago — espejo de api/_lib/billing.js ───────────────
// Un pago solo se presenta como pagado cuando la pasarela confirmó el
// depósito. Abrir un checkout ('iniciado') y una pasarela que todavía
// liquida ('en_proceso') NO son pagos, y nunca deben redactarse como si el
// dinero se hubiera movido o como si alguien los estuviera revisando.
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

// Un pago que el admin de verdad tiene que verificar a mano: una
// transferencia que el docente declara. Los cobros por pasarela se confirman
// solos vía webhook — ahí no hay nada que revisar ni nadie a quién esperar.
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

// Documentos "limpios" (sin marca de agua) — únicamente una suscripción
// pagada y vigente los obtiene. Trial, vencida, cancelada y pendiente_pago
// caen todos del lado de "marca de agua", tal cual el pedido: "si el usuario
// NO tiene una suscripción activa". Ver src/utils/exportWatermark.js.
export function hasCleanExports(subscription) {
  return subscription?.status === 'activa' && !isSubscriptionExpired(subscription)
}
