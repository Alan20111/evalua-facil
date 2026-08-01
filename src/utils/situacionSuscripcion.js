import { calcDaysRemaining, effectiveVencimiento } from './subscriptionHelpers'

// A cuántos días de vencer se enciende el aviso naranja en el panel (Resumen,
// "por vencer"). No se pinta ya en la insignia de Situación —ver más abajo—
// pero sigue usándose para esos conteos.
export const DIAS_POR_VENCER = 10

// Situación de una suscripción — pedido explícito: solo estas 5 categorías
// (más "Cuenta eliminada" y "Sin suscripción", que no son una situación de LA
// SUSCRIPCIÓN sino la ausencia de una):
//   - Prueba
//   - Cancelada           (prueba vencida, plan sin pagar, cortesía vencida, o el docente la canceló — un solo bote)
//   - Depósito automático (domiciliada: se cobra sola cada mes vía Mercado Pago)
//   - Mes pagado          (pago manual — transferencia o PayPal de una sola vez — que hay que repetir cada mes)
//   - Cortesía
// "Pendiente de pago" NO es una situación de la suscripción sino del PAGO:
// vive en la pestaña Pagos, columna Verificación. Mientras un pago está en
// revisión, aquí se muestra lo que la suscripción YA era antes de ese pago
// (Prueba si todavía no vencía nada, Cancelada si ya no le quedaba nada).
const AZUL = '#2563eb'
const VERDE = '#16a34a'
const CIAN = '#0891b2'
const MORADO = '#9333ea'
const GRIS = '#64748b'
const NEGRO = '#1e293b'

const solido = (c) => ({ background: c, color: '#fff' })

// Todas las insignias, cada una con su etiqueta y su color, indexadas por
// clave. `situacionDe` las devuelve a partir de una suscripción; el Resumen
// las pide directo por clave, porque ahí un renglón no representa a una
// suscripción concreta sino a un conteo.
export const INSIGNIAS = {
  eliminada: { etiqueta: 'Cuenta eliminada', estilo: solido(NEGRO) },
  sin_suscripcion: { etiqueta: 'Sin suscripción', estilo: solido(GRIS) },
  cancelada: { etiqueta: 'Cancelada', estilo: solido(GRIS) },
  prueba: { etiqueta: 'Prueba', estilo: solido(AZUL) },
  mensual: { etiqueta: 'Depósito automático', estilo: solido(VERDE) },
  deposito: { etiqueta: 'Mes pagado', estilo: solido(CIAN) },
  cortesia: { etiqueta: 'Cortesía', estilo: solido(MORADO) },
}

const insignia = (clave) => ({ clave, ...INSIGNIAS[clave] })

// Por qué quedó cancelada — pedido explícito para distinguirlo de un vistazo
// sin abrir cada renglón. Tres motivos "reales" más la cortesía vencida, que
// entra en el mismo bote de Cancelada pero merece su propio texto.
export const MOTIVOS_CANCELACION = {
  prueba: 'venció la prueba',
  pago: 'venció el pago',
  cortesia: 'venció la cortesía',
  docente: 'la canceló el docente',
}

// clave 'cancelada' con su motivo pegado — `situacionDe` decide cuál aplica;
// aquí solo se arma el objeto para no repetir el spread en cada rama.
const cancelada = (motivo) => ({ ...insignia('cancelada'), motivo })

export function situacionDe(sub) {
  // Baja definitiva: el docente borró su cuenta. Queda solo la constancia
  // (nombre, correo y fecha), sin nada de su contenido.
  if (sub?.cuentaEliminada) return insignia('eliminada')
  if (!sub) return insignia('sin_suscripcion')

  const esCortesia = sub.planId === 'cortesia'
  // Una cortesía sin fecha de fin no vence nunca: no se le calculan días.
  const indefinida = esCortesia && sub.cortesiaIndefinida === true
  const dias = indefinida ? null : calcDaysRemaining(effectiveVencimiento(sub))
  const vencida = dias !== null && dias <= 0

  if (sub.status === 'cancelada') return cancelada('docente')

  // El pago (de cualquier tipo) todavía está en revisión: eso no cambia en
  // qué situación estaba la suscripción, así que se resuelve como si ese
  // pago no existiera todavía. Si ya estaba vencida antes de intentar pagar,
  // el motivo es el mismo que hubiera tenido sin ese intento.
  if (sub.status === 'pendiente_pago') {
    if (!vencida) return insignia('prueba')
    return cancelada(esCortesia ? 'cortesia' : 'pago')
  }

  if (esCortesia) return vencida ? cancelada('cortesia') : insignia('cortesia')

  if (sub.status === 'trial') return vencida ? cancelada('prueba') : insignia('prueba')

  // Resto: plan de pago contratado (activa, o vencida guardada explícita).
  if (sub.status === 'vencida' || vencida) return cancelada('pago')
  // Domiciliada (Mercado Pago cobra solo cada mes) vs. depósito manual que
  // el docente tiene que repetir cada mes (transferencia o PayPal de una
  // sola exhibición).
  return sub.mpPreapprovalId ? insignia('mensual') : insignia('deposito')
}

// Todas las etiquetas posibles, para llenar el desplegable de filtro sin
// depender de cuáles existan hoy en los datos.
export const SITUACIONES = [
  'Prueba', 'Depósito automático', 'Mes pagado', 'Cortesía', 'Cancelada',
  'Cuenta eliminada', 'Sin suscripción',
]
