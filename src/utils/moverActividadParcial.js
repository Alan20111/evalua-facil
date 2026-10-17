// Mover una actividad a otro parcial de la MISMA asignatura — decisiones puras.
//
// Qué cambia en la actividad (y SOLO esto): `parcial`, `orden` y su estado, que
// pasa a BORRADOR. Mismo documento, mismo id: las entregas (`submissions`, ligadas
// por `actividadId`), los intentos, las calificaciones y las subcolecciones de la
// actividad no se tocan. Nada de ello guarda el parcial, así que no hay nada que
// reapuntar. Lo que sí cambia es lo que se calcula al leer (promedios, tabla de
// calificaciones, exportes): una actividad en borrador no cuenta para la
// calificación (`cuentaParaCalificacion`), y vuelve a contar al publicarla.
//
// Por qué a borrador: el docente la revisa en su nuevo parcial (fechas, peso,
// instrucciones) antes de que los estudiantes la vean. Es el mismo estado que
// produce «guardar como borrador» (`resolveVisibilidad` con `asDraft`): oculta, sin
// fecha de publicación y sin programación. NO se toca `notificadoNuevaActividad`.
//
// `pesoCalificacion`, `fechaLimite`, la rúbrica y el resto se conservan tal cual.
import { cuentaParaCalificacion, isDraftActivity } from './activityVisibility.js'
import { estadoParcial, ponderacionActivaEnParcial, pesoDe, calificacionMostradaAlumno } from './ponderacion.js'

const porOrden = (x, y) => (x.orden ?? 0) - (y.orden ?? 0)

// Lo que se escribe en la actividad movida, además de `parcial` y `orden`.
export const ESTADO_BORRADOR = { oculta: true, publishedAt: null, publishAt: null }

// Parciales a los que se puede mandar: los de la misma asignatura, sin el actual y
// sin los cerrados definitivamente (ahí un borrador entraría, pero luego no se
// podría publicar: las reglas y la pantalla lo impiden). Sin tope fijo de parciales.
export function parcialesDestino(subject, actividad) {
  const total = Math.max(1, Number(subject?.parciales) || 3)
  const res = []
  for (let p = 1; p <= total; p++) {
    if (p === actividad?.parcial) continue
    if (estadoParcial(subject, p) === 'cerrado') continue
    res.push({ parcial: p, estado: estadoParcial(subject, p) })
  }
  return res
}

// Por qué no se puede mover (texto del tooltip del menú), o null si se puede.
export function motivoNoSePuedeMover(subject, actividad) {
  if (!actividad) return 'Actividad no disponible'
  if (estadoParcial(subject, actividad.parcial) === 'cerrado') {
    return `El Parcial ${actividad.parcial} está cerrado definitivamente — reábrelo para mover esta actividad`
  }
  if (parcialesDestino(subject, actividad).length > 0) return null
  return (Number(subject?.parciales) || 3) <= 1
    ? 'Esta asignatura solo tiene un parcial'
    : 'No hay otro parcial abierto al que mover la actividad'
}

// El «1.2.» solo numera lo que cuenta para la calificación, en orden.
function etiquetas(lista, parcial) {
  const map = {}
  lista.filter((x) => cuentaParaCalificacion(x)).forEach((x, i) => { map[x.id] = `${parcial}.${i + 1}.` })
  return map
}

// Plan completo del movimiento. No escribe nada.
//   cambios        → campos a escribir en la actividad movida (`parcial`, `orden`, borrador).
//   ordenesOrigen  → { id: orden } de las hermanas del parcial de origen que se renumeran a 1..n
//                    (al crear, `orden` sale de «cuántas hay + 1»: un hueco duplicaría un orden).
//   renumeradas    → las que cambian de número visible en el origen (solo si la movida lo tenía).
//   avisos         → { resultadosVisiblesOrigen, peso } para la confirmación.
export function planMoverActividad({ subject, activities, actividad, destino }) {
  const origen = actividad.parcial
  const hermanasOrigen = activities.filter((x) => x.parcial === origen).sort(porOrden)
  const restantes = hermanasOrigen.filter((x) => x.id !== actividad.id)

  const ordenesOrigen = {}
  restantes.forEach((x, i) => { if (x.orden !== i + 1) ordenesOrigen[x.id] = i + 1 })

  const enDestino = activities.filter((x) => x.parcial === destino)
  const maxOrden = enDestino.reduce((m, x) => Math.max(m, Number(x.orden) || 0), 0)
  const orden = Math.max(enDestino.length, maxOrden) + 1

  const antes = etiquetas(hermanasOrigen, origen)
  const despues = etiquetas(restantes, origen)
  const renumeradas = restantes
    .filter((x) => antes[x.id] && antes[x.id] !== despues[x.id])
    .map((x) => ({ id: x.id, nombre: x.nombre, de: antes[x.id], hacia: despues[x.id], publicada: !!x.publishedAt }))

  const cuentaHoy = cuentaParaCalificacion(actividad)
  const ponderaOrigen = ponderacionActivaEnParcial(subject, origen)
  const ponderaDestino = ponderacionActivaEnParcial(subject, destino)
  const conPeso = pesoDe(actividad) > 0 && (ponderaOrigen || ponderaDestino)

  return {
    cambios: { parcial: destino, orden, ...ESTADO_BORRADOR },
    ordenesOrigen,
    renumeradas,
    yaEraBorrador: isDraftActivity(actividad),
    avisos: {
      // Los estudiantes ya ven la calificación ponderada del parcial de origen:
      // cambiará al quitar la actividad.
      resultadosVisiblesOrigen: cuentaHoy && ponderaOrigen && calificacionMostradaAlumno(subject, origen),
      peso: conPeso ? pesoDe(actividad) : null,
      // Dónde el peso tiene efecto: solo en los parciales con ponderación activa.
      pesoEnOrigen: conPeso && ponderaOrigen,
      pesoEnDestino: conPeso && ponderaDestino,
    },
  }
}
