// Qué opciones de «Configuración» tienen sentido en un Video interactivo.
//
// El Video interactivo es una evaluación (`modalidad: 'video_interactivo'`) y por eso su
// pantalla de configuración nació con todas las opciones de un cuestionario. Revisando lo que
// cada una HACE realmente en el reproductor, el motor y las reglas (8-oct-2026):
//
//   · Orden de las preguntas      → sin efecto: VideoInteractivoRunner reordena SIEMPRE por minuto
//                                   del video (ordenarPreguntasVideo); el barajado de
//                                   EvaluacionRunner se pierde. Se OCULTA.
//   · Tiempo límite               → INCOMPATIBLE: el cronómetro del runner sigue corriendo con el
//                                   video en pausa y con la sesión cerrada, autoenvía en blanco al
//                                   llegar a 0 y las reglas dejan de aceptar el progreso del video
//                                   vencido el plazo; con un límite menor que el video la actividad
//                                   es imposible de terminar. Se OCULTA… salvo que la actividad ya
//                                   tenga uno guardado: entonces sigue aplicando y el docente debe
//                                   poder verlo y quitarlo (no se borra ni se ignora en silencio).
//   · Barajar opciones            → funciona: EvaluacionRunner baraja las opciones de cada pregunta
//                                   con semilla fija y VideoInteractivoRunner las pinta tal cual.
//   · Navegación                  → funciona, pero significa otra cosa: en libre se puede reabrir y
//                                   cambiar una pregunta ya contestada; en secuencial las
//                                   respondidas quedan cerradas (el video siempre se puede
//                                   repasar). Se conserva con etiquetas que dicen eso.
//   · Intentos / conservar        → funcionan: cada intento tiene su propio progreso
//                                   (`progresoVideo/{intento}`) y la nota final la resuelve
//                                   calificacionIntentos igual que en un cuestionario.
//   · Sin calificación            → funciona: es de la evaluación, no del reproductor.
//   · Publicar resultados/respuestas → funcionan: ActivityPage y EvaluacionRevision son los mismos.
//
// Ocultar un control NUNCA toca el valor guardado: `configForm` conserva el objeto entero y
// «Guardar configuración» lo escribe tal cual. Este módulo solo decide qué se pinta.
import { esVideoInteractivo } from './videoInteractivo.js'

export function opcionesConfigVisibles({ esVideo, config } = {}) {
  const c = config || {}
  const video = !!esVideo
  return {
    ordenPreguntas: !video,
    barajarRespuestas: true,
    navegacion: true,
    // Con un límite ya guardado hay que poder verlo (y quitarlo): sigue aplicando.
    tiempoLimite: !video || (c.tiempoLimiteMin != null && c.tiempoLimiteMin !== ''),
    intentos: true,
    conservar: c.intentosPermitidos !== 1,
    sinCalificacion: true,
    publicacion: true,
  }
}

// Mismo `value` que siempre (lo que se guarda no cambia); solo el texto describe lo que pasa.
export function opcionesNavegacion(esVideo) {
  return esVideo
    ? [
      { value: 'libre', label: 'Libre — puede cambiar sus respuestas' },
      { value: 'secuencial', label: 'Secuencial — las respuestas dadas ya no se cambian' },
    ]
    : [
      { value: 'libre', label: 'Libre — puede regresar' },
      { value: 'secuencial', label: 'Secuencial — no puede regresar' },
    ]
}

// Para el resumen que ve el estudiante (y la vista previa del docente).
export function textoNavegacionResumen(esVideo, navegacion, { alumno = false } = {}) {
  const secuencial = navegacion === 'secuencial'
  if (esVideo) return secuencial ? 'Secuencial — no cambias respuestas ya dadas' : 'Libre — puedes cambiar tus respuestas'
  if (alumno) return secuencial ? 'Secuencial — no puedes regresar' : 'Libre'
  return secuencial ? 'Secuencial — no puede regresar' : 'Libre'
}

// ¿Se muestra la fila «Tiempo disponible» del resumen? En un video sin límite no aporta nada.
export function mostrarFilaTiempo(actividad, evaluacion) {
  const tiene = evaluacion?.tiempoLimiteMin != null && evaluacion?.tiempoLimiteMin !== ''
  return !esVideoInteractivo(actividad) || tiene
}
