// Lado de la PANTALLA del estudiante para lo que el servidor le entrega por
// /api/student/mis-entregas (ver api/_lib/entregasAlumno.js).
//
// Módulo PURO (sin Firebase ni React). Aquí no hay fórmulas de promedio: las
// pantallas siguen calculando con las mismas funciones de siempre
// (utils/ponderacion.js). Esto solo decide cuándo se usa el número que calculó
// el servidor en lugar del local —porque al estudiante le falta la nota de
// alguna actividad que el docente ocultó— y cuándo se enmascara.

// «Calificada» ya no se deduce de `calificacion != null`: con la nota oculta el
// servidor quita ese campo y manda la bandera `calificada`. Sin bandera (una
// entrega leída por otro camino) se cae a la deducción de siempre.
export function estaCalificada(sub) {
  if (!sub) return false
  return sub.calificada ?? (sub.calificacion != null)
}

export const notaEstaOculta = (sub) => sub?.notaOculta === true

/**
 * Promedio de UN parcial tal como se le muestra al estudiante.
 *
 * @param {string|null} valorLocal  lo que calculó la pantalla con sus propias notas (ya con 1 decimal)
 * @param {{valor: number|null, oculto: boolean, conOcultas: boolean}|undefined} servidor
 *   bloque `promedios[asignatura].parciales[p]` del servidor
 * @returns {{valor: string|null, oculto: boolean}}
 *   · sin bloque del servidor → el local, como hoy;
 *   · el docente ocultó este promedio → `oculto` y sin número;
 *   · hay notas ocultas dentro del parcial → el del servidor (el local saldría
 *     mal: al estudiante le falta esa nota);
 *   · si no, el local.
 */
export function promedioParcialVisible(valorLocal, servidor) {
  if (!servidor) return { valor: valorLocal, oculto: false }
  if (servidor.oculto) return { valor: null, oculto: true }
  if (servidor.conOcultas) return { valor: servidor.valor == null ? null : servidor.valor.toFixed(1), oculto: false }
  return { valor: valorLocal, oculto: false }
}

/**
 * Promedio de la asignatura (el «final» del Dashboard). Misma lógica que
 * `promedioParcialVisible`; además conserva el «pendiente» (parcial ponderado
 * sin publicar) que ya calculaba la pantalla.
 *
 * @param {{valor: string|null, pendiente: boolean}} local
 * @param {{valor: number|null, pendiente: boolean, oculto: boolean, conOcultas: boolean}|undefined} servidor
 * @returns {{valor: string|null, pendiente: boolean, oculto: boolean}}
 */
export function promedioFinalVisible(local, servidor) {
  if (!servidor) return { valor: local.valor, pendiente: local.pendiente, oculto: false }
  if (servidor.oculto) return { valor: null, pendiente: false, oculto: true }
  if (servidor.conOcultas) {
    return { valor: servidor.valor == null ? null : servidor.valor.toFixed(1), pendiente: !!servidor.pendiente, oculto: false }
  }
  return { valor: local.valor, pendiente: local.pendiente, oculto: false }
}
