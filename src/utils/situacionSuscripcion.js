import { calcDaysRemaining, effectiveVencimiento } from './subscriptionHelpers'

// A cuántos días de vencer se enciende el aviso naranja en el panel.
// Es distinto de TRIAL_WARNING_DAYS (subscriptionHelpers), que controla el
// aviso que ve el DOCENTE en su barra lateral: son dos públicos distintos y
// no tienen por qué cambiar juntos.
export const DIAS_POR_VENCER = 10

// Situación de una suscripción, ya resuelta para mostrarse.
//
// La regla de color tiene dos ejes, y por eso las combinaciones no se
// enumeran a mano:
//   - el COLOR BASE dice QUÉ es      (azul prueba · verde pagada · morada cortesía)
//   - el LADO DERECHO en naranja dice que está POR VENCER
//   - rojo entero dice que YA VENCIÓ
// Así, "pagada pero por vencer" se lee de un vistazo como media verde y media
// naranja: sigue estando pagada, pero hay que cobrar la renovación.
const AZUL = '#2563eb'
const VERDE = '#16a34a'
const MORADO = '#9333ea'
const NARANJA = '#f97316'
const ROJO = '#dc2626'
const GRIS = '#64748b'
const NEGRO = '#1e293b'

const solido = (c) => ({ background: c, color: '#fff' })
// Mitad y mitad, con corte limpio: el color base a la izquierda y el naranja
// de "por vencer" a la derecha.
const mitades = (izq) => ({
  background: `linear-gradient(90deg, ${izq} 0 50%, ${NARANJA} 50% 100%)`,
  color: '#fff',
})

export function situacionDe(sub) {
  // Baja definitiva: el docente borró su cuenta. Queda solo la constancia
  // (nombre, correo y fecha), sin nada de su contenido.
  if (sub?.cuentaEliminada) return { clave: 'eliminada', etiqueta: 'Cuenta eliminada', estilo: solido(NEGRO) }
  if (!sub) return { clave: 'sin_suscripcion', etiqueta: 'Sin suscripción', estilo: solido(GRIS) }
  if (sub.status === 'cancelada') return { clave: 'cancelada', etiqueta: 'Cancelada', estilo: solido(GRIS) }
  if (sub.status === 'pendiente_pago') return { clave: 'pendiente_pago', etiqueta: 'Pendiente de pago', estilo: solido(NARANJA) }

  const esCortesia = sub.planId === 'cortesia'
  // Una cortesía sin fecha de fin no vence nunca: no se le calculan días.
  const indefinida = esCortesia && sub.cortesiaIndefinida === true
  const dias = indefinida ? null : calcDaysRemaining(effectiveVencimiento(sub))
  const vencida = dias !== null && dias <= 0
  const porVencer = dias !== null && dias > 0 && dias <= DIAS_POR_VENCER

  if (esCortesia) {
    if (vencida) return { clave: 'cortesia_vencida', etiqueta: 'Cortesía vencida', estilo: solido(ROJO) }
    if (porVencer) return { clave: 'cortesia_por_vencer', etiqueta: 'Cortesía por vencer', estilo: mitades(MORADO) }
    return { clave: 'cortesia', etiqueta: indefinida ? 'Cortesía sin vencimiento' : 'Cortesía', estilo: solido(MORADO) }
  }

  if (sub.status === 'trial') {
    if (vencida) return { clave: 'prueba_vencida', etiqueta: 'Prueba vencida', estilo: solido(ROJO) }
    if (porVencer) return { clave: 'prueba_por_vencer', etiqueta: 'Prueba por vencer', estilo: solido(NARANJA) }
    return { clave: 'prueba', etiqueta: 'Prueba', estilo: solido(AZUL) }
  }

  // Resto: plan de pago contratado.
  if (sub.status === 'vencida' || vencida) return { clave: 'vencida', etiqueta: 'Vencida', estilo: solido(ROJO) }
  if (porVencer) return { clave: 'por_cobrar', etiqueta: 'Por cobrar renovación', estilo: mitades(VERDE) }
  return { clave: 'pagada', etiqueta: 'Pagada', estilo: solido(VERDE) }
}

// Todas las etiquetas posibles, para llenar el desplegable de filtro sin
// depender de cuáles existan hoy en los datos.
export const SITUACIONES = [
  'Prueba', 'Prueba por vencer', 'Prueba vencida',
  'Pagada', 'Por cobrar renovación', 'Vencida',
  'Cortesía', 'Cortesía sin vencimiento', 'Cortesía por vencer', 'Cortesía vencida',
  'Pendiente de pago', 'Cancelada', 'Cuenta eliminada', 'Sin suscripción',
]
