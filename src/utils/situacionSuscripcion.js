import { calcDaysRemaining, effectiveVencimiento, toDate } from './creditosHelpers'

// A cuántos días de vencer se enciende el aviso naranja en el panel (Resumen,
// "por vencer"). No se pinta ya en la insignia de Plan —ver más abajo— pero
// sigue usándose para esos conteos.
export const DIAS_POR_VENCER = 10

// Plan de una suscripción — pedido explícito (2026-08-04, reemplaza a la
// antigua "Situación"): categorías fijas, sin combinar una insignia con un
// subtexto aparte como antes.
//   - Prueba
//   - 1 a 6 meses    (plan de pago vigente — por transferencia, ver
//                      MESES_DESCUENTO en subscriptionHelpers; el número sale
//                      de las fechas guardadas, ver mesesDe más abajo)
//   - Cortesía
//   - Cancelada por fin de prueba / por el usuario / por fin de pago
//   - Cuenta eliminada / Sin suscripción (no son un plan de LA SUSCRIPCIÓN
//     sino la ausencia de una)
// "Pendiente de pago" NO es un plan de la suscripción sino del PAGO: vive en
// la pestaña Pagos, columna Verificación. Mientras un pago está en revisión,
// aquí se muestra lo que la suscripción YA era antes de ese pago (Prueba si
// todavía no vencía nada, Cancelada por fin de pago si ya no le quedaba nada).
const AZUL = '#2563eb'
const VERDE = '#16a34a'
const MORADO = '#9333ea'
const GRIS = '#64748b'
const NEGRO = '#1e293b'

const solido = (c) => ({ background: c, color: '#fff' })

// Catálogo fijo de insignias, cada una con su etiqueta y su color, indexadas
// por clave. `planDe` las devuelve a partir de una suscripción; el Resumen
// las pide directo por clave, porque ahí un renglón no representa a una
// suscripción concreta sino a un conteo. Los 6 meses de plan pagado
// comparten un mismo verde — lo que distingue a cada uno ya va en el texto,
// no hacía falta un color distinto por cada uno.
export const INSIGNIAS = {
  eliminada: { etiqueta: 'Cuenta eliminada', estilo: solido(NEGRO) },
  sin_suscripcion: { etiqueta: 'Sin suscripción', estilo: solido(GRIS) },
  prueba: { etiqueta: 'Prueba', estilo: solido(AZUL) },
  cortesia: { etiqueta: 'Cortesía', estilo: solido(MORADO) },
  cancelada_prueba: { etiqueta: 'Cancelada por fin de prueba', estilo: solido(GRIS) },
  cancelada_usuario: { etiqueta: 'Cancelada por el usuario', estilo: solido(GRIS) },
  cancelada_pago: { etiqueta: 'Cancelada por fin de pago', estilo: solido(GRIS) },
  mes_1: { etiqueta: '1 mes', estilo: solido(VERDE) },
  mes_2: { etiqueta: '2 meses', estilo: solido(VERDE) },
  mes_3: { etiqueta: '3 meses', estilo: solido(VERDE) },
  mes_4: { etiqueta: '4 meses', estilo: solido(VERDE) },
  mes_5: { etiqueta: '5 meses', estilo: solido(VERDE) },
  mes_6: { etiqueta: '6 meses', estilo: solido(VERDE) },
}

const insignia = (clave) => ({ clave, ...INSIGNIAS[clave] })

// Un plan de pago fuera de 1-6 meses no debería existir hoy (MESES_DESCUENTO
// no pasa de 6), pero si algún día aparece uno — un vencimiento ajustado a
// mano en el modal de admin, o un plan anual heredado de antes de v1.0.1 —
// esto arma la insignia al vuelo en vez de mentir con el bote más cercano.
function insigniaMeses(n) {
  if (INSIGNIAS[`mes_${n}`]) return insignia(`mes_${n}`)
  return { clave: `mes_${n}`, etiqueta: `${n} meses`, estilo: solido(VERDE) }
}

// Cuántos meses cubre el plan de pago vigente. No hay un campo propio para
// esto en `subscriptions` — se deduce de fechaInicio/fechaVencimiento, que
// calcVencimiento ya deja separadas por exactamente esos meses de calendario
// (tanto al aprobar un pago, ver handleApprove en PaymentsTable.jsx, como al
// editar a mano en el modal de admin). Promediar los días entre ambas fechas
// y redondear recupera ese mismo número sin necesidad de guardarlo aparte.
// Mínimo 1 — nunca "0 meses".
function mesesDe(sub) {
  const ini = toDate(sub.fechaInicio)
  const fin = toDate(effectiveVencimiento(sub))
  if (!ini || !fin) return 1
  const dias = (fin - ini) / (1000 * 60 * 60 * 24)
  return Math.max(1, Math.round(dias / 30.4375))
}

// Claves que representan una cancelación — SubscriptionsTable las usa para
// decidir si todavía tiene sentido ofrecer el botón "Cancelar".
export const CLAVES_CANCELADA = ['cancelada_prueba', 'cancelada_usuario', 'cancelada_pago']

export function planDe(sub) {
  // Baja definitiva: el docente borró su cuenta. Queda solo la constancia
  // (nombre, correo y fecha), sin nada de su contenido.
  if (sub?.cuentaEliminada) return insignia('eliminada')
  if (!sub) return insignia('sin_suscripcion')

  const esCortesia = sub.planId === 'cortesia'
  // Una cortesía sin fecha de fin no vence nunca: no se le calculan días.
  const indefinida = esCortesia && sub.cortesiaIndefinida === true
  const dias = indefinida ? null : calcDaysRemaining(effectiveVencimiento(sub))
  // El día de vencimiento sigue vigente hasta las 23:59:59 — mismo criterio
  // que isSubscriptionExpired en subscriptionHelpers.js.
  const vencida = dias !== null && dias < 0

  if (sub.status === 'cancelada') return insignia('cancelada_usuario')

  // El pago (de cualquier tipo) todavía está en revisión: eso no cambia en
  // qué plan estaba la suscripción, así que se resuelve como si ese pago no
  // existiera todavía. Si ya estaba vencida antes de intentar pagar, el
  // motivo es el mismo que hubiera tenido sin ese intento.
  if (sub.status === 'pendiente_pago') {
    if (!vencida) return insignia('prueba')
    return insignia('cancelada_pago')
  }

  // Una cortesía vencida entra al mismo bote que un plan de pago vencido: no
  // es "por el usuario" ni "fin de prueba", y no hay una categoría propia
  // para ella en la lista pedida.
  if (esCortesia) return vencida ? insignia('cancelada_pago') : insignia('cortesia')

  if (sub.status === 'trial') return vencida ? insignia('cancelada_prueba') : insignia('prueba')

  // Resto: plan de pago contratado (activa, o vencida guardada explícita).
  if (sub.status === 'vencida' || vencida) return insignia('cancelada_pago')
  return insigniaMeses(mesesDe(sub))
}

// Todas las etiquetas posibles, para llenar el desplegable de filtro sin
// depender de cuáles existan hoy en los datos — mismo orden en que se piensa
// (de prueba a baja).
export const PLANES = [
  'Prueba', '1 mes', '2 meses', '3 meses', '4 meses', '5 meses', '6 meses', 'Cortesía',
  'Cancelada por fin de prueba', 'Cancelada por el usuario', 'Cancelada por fin de pago',
  'Cuenta eliminada', 'Sin suscripción',
]
