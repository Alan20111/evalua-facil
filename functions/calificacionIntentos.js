// Fuente ÚNICA de verdad sobre "quién ganó" entre los intentos de una
// evaluación con reintentos (activity.evaluacion.conservar). La usan:
//   · onEvaluacionFinalizada (functions/index.js) — para fijar
//     submission.calificacion cada vez que se califica un intento nuevo;
//   · OP-10 (functions/ia.js) — para decidir qué entregas puede usar en el
//     detalle por reactivo (Capa 1) y, más adelante, qué snapshot de
//     `intentosRespuestas` leer (Capa 2).
//
// Antes vivían dos lógicas separadas: una que sabía la CALIFICACIÓN final
// (resolverCalificacionFinal, aquí sin cambios) y otra, nueva, que necesitaba
// saber además el NÚMERO DE INTENTO que la produjo. Para que nunca puedan
// decir cosas distintas, resolverIntentoGanador() está construida ENCIMA de
// resolverCalificacionFinal (le pide el valor final) y solo añade la
// identidad del intento — nunca reinterpreta qué significa cada política.

// `intentosPrevios` = [{ calificacion }, ...] SIN el intento que se acaba de
// calificar; `calificacionNueva` es la de ese intento nuevo. Se llama en el
// momento de calificar — antes de que exista el intento nuevo en `intentos[]`.
function resolverCalificacionFinal(intentosPrevios, calificacionNueva, conservar) {
  if (intentosPrevios.length === 0) return calificacionNueva
  const previas = intentosPrevios.map((i) => i.calificacion)
  switch (conservar) {
    case 'primero':
      return previas[0]
    case 'promedio':
      return Math.round((([...previas, calificacionNueva].reduce((a, b) => a + b, 0)) / (previas.length + 1)) * 10) / 10
    case 'mejor':
      return Math.max(...previas, calificacionNueva)
    case 'ultimo':
    default:
      return calificacionNueva
  }
}

// `intentos` = [{ numero, calificacion }, ...] el historial COMPLETO ya
// registrado (incluye el último, ya calificado) — es decir, lo que vive en
// `submission.intentos`.
//
// Devuelve:
//   · calificacionFinal — igual que resolverCalificacionFinal, recalculada
//     desde el arreglo completo (sirve también como verificación cruzada:
//     debe coincidir con `submission.calificacion`).
//   · numeroIntentoGanador — el número de intento cuyas respuestas, DE
//     EXISTIR, explican esa calificación — o `null` si no hay un único
//     intento que la represente.
//   · ambiguo — true cuando más de un intento podría explicar la
//     calificación final (empate en "mejor") o cuando por diseño ninguno lo
//     hace ("promedio" con más de un intento).
//   · representable — true solo si existe UN intento (y solo uno) cuyas
//     respuestas corresponderían a la calificación final. Falso para
//     "promedio" (>1 intento) y para empates de "mejor".
//
// Importante sobre empates en "mejor": el sistema actual (Math.max) nunca
// decidió cuál intento es "el" ganador cuando dos o más empatan en la
// calificación máxima — solo calculó el número. No existe ninguna regla de
// desempate que replicar, así que un empate real se declara `ambiguo: true`
// en vez de inventarse un criterio (p.ej. "el más reciente de los que
// empatan") que el producto nunca definió.
function resolverIntentoGanador(intentos, conservar) {
  if (!intentos || intentos.length === 0) {
    return { calificacionFinal: null, numeroIntentoGanador: null, ambiguo: true, representable: false }
  }

  const politica = conservar || 'ultimo'
  const ultimo = intentos[intentos.length - 1]
  const previas = intentos.slice(0, -1)
  const calificacionFinal = resolverCalificacionFinal(previas, ultimo.calificacion, politica)

  // Con un solo intento, las cuatro políticas coinciden: es a la vez el
  // primero, el último, el mejor y "el promedio" — sin ambigüedad posible.
  if (intentos.length === 1) {
    return { calificacionFinal, numeroIntentoGanador: ultimo.numero, ambiguo: false, representable: true }
  }

  switch (politica) {
    case 'ultimo':
      // El último SIEMPRE gana con esta política, por definición.
      return { calificacionFinal, numeroIntentoGanador: ultimo.numero, ambiguo: false, representable: true }

    case 'primero':
      // Gana por POSICIÓN, no por calificación — con más de un intento,
      // el primero nunca es el último. Que el último tenga la misma
      // calificación que el primero no los vuelve el mismo intento: sus
      // respuestas concretas pueden diferir. El ganador en sí no es
      // ambiguo (es siempre intentos[0]); lo que puede faltar es si sus
      // respuestas siguen disponibles — eso lo decide quien llame a esta
      // función (ver Capa 1/Capa 2), no esta función.
      return { calificacionFinal, numeroIntentoGanador: intentos[0].numero, ambiguo: false, representable: true }

    case 'promedio':
      // Ningún intento individual "es" un promedio de varios — por diseño
      // del producto, no existe un intento que represente esta calificación.
      return { calificacionFinal, numeroIntentoGanador: null, ambiguo: true, representable: false }

    case 'mejor': {
      const maximo = Math.max(...intentos.map((i) => i.calificacion))
      const ganadores = intentos.filter((i) => i.calificacion === maximo)
      if (ganadores.length === 1) {
        return { calificacionFinal, numeroIntentoGanador: ganadores[0].numero, ambiguo: false, representable: true }
      }
      // Empate real — ver nota arriba: no hay regla existente que desempatar.
      return { calificacionFinal, numeroIntentoGanador: null, ambiguo: true, representable: false }
    }

    default:
      // Política desconocida: nunca inventar un ganador.
      return { calificacionFinal, numeroIntentoGanador: null, ambiguo: true, representable: false }
  }
}

// Capa 1 (sin snapshots): ¿las respuestas que están VIVAS ahora mismo en
// `submissions/{id}/respuestas` (que siempre son las del intento MÁS
// RECIENTE — ver ActivityPage.jsx, se limpian y reescriben en cada intento
// nuevo) corresponden al intento que determinó la calificación final?
//
// Es un caso particular de resolverIntentoGanador: solo son confiables
// cuando el ganador, inequívoco, resulta ser justo el último intento.
function respuestasVivasSonDelIntentoGanador(intentos, conservar) {
  if (!intentos || intentos.length === 0) return false
  const r = resolverIntentoGanador(intentos, conservar)
  if (!r.representable) return false
  const ultimo = intentos[intentos.length - 1]
  return r.numeroIntentoGanador === ultimo.numero
}

module.exports = { resolverCalificacionFinal, resolverIntentoGanador, respuestasVivasSonDelIntentoGanador }
