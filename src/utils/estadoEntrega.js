// Estado de la entrega de UN estudiante en UNA actividad entregable. Fuente
// única para la lista de Entregas (filtros, contadores, insignias) y para la
// celda de la tabla de Calificaciones. Es un cálculo derivado: nunca se
// escribe en `submissions` y NO toca los promedios (ver notasParaPromedio).
//
//   calificado    · la entrega tiene `calificacion` (un 0 numérico cuenta).
//   por_calificar · hay entrega real (tieneEntregaReal) y aún no hay nota.
//   prorroga      · sin entrega real y con prórroga propia que no ha vencido.
//   no_entregado  · todo lo demás: sin entrega real y sin prórroga vigente
//                   (incluida una prórroga ya vencida).
//
// En un juego, iniciar no es entregar: el intento en curso cae a prórroga /
// no entregado igual que el de un cuestionario.
// Una entrega real nunca vuelve a «no entregado» por vencer su fecha. Los
// intentos en curso y el «no entregó» del docente sin nota no son entrega real
// (tieneEntregaReal), así que caen en prórroga / no entregado.
import { tieneEntregaReal } from './extensiones.js'
import { plazoProrrogaMs } from './ponderacion.js'

export const ESTADO_ENTREGA = {
  NO_ENTREGADO: 'noentregado',
  PRORROGA: 'prorroga',
  POR_CALIFICAR: 'entregado',
  CALIFICADO: 'calificado',
}

// Crucigrama y sopa de letras: el documento nace al INICIAR el juego (pendiente,
// en_progreso, sin nota), y `tieneEntregaReal` lo cuenta como entrega a propósito
// (protege la prórroga). Para el estado «Por calificar» eso no basta: la entrega
// llega cuando el alumno termina (`finalizado`) y aún no hay nota (el servidor la
// pone en onJuegoFinalizado).
function entregaPendienteDeNota(activity, sub) {
  if (!tieneEntregaReal(sub, activity)) return false
  if (activity?.categoria === 'juego') return sub.estadoEvaluacion === 'finalizado'
  return true
}

export function estadoEntrega(activity, sub, alumnoId, ahora = Date.now()) {
  if (sub && sub.calificacion != null) return ESTADO_ENTREGA.CALIFICADO
  if (entregaPendienteDeNota(activity, sub)) return ESTADO_ENTREGA.POR_CALIFICAR
  const fin = plazoProrrogaMs(activity, alumnoId)
  if (fin != null && ahora < fin) return ESTADO_ENTREGA.PRORROGA
  return ESTADO_ENTREGA.NO_ENTREGADO
}
