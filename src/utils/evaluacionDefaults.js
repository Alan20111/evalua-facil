// Defaults de configuración de una evaluación (Cuestionario/Examen) — sacado
// de EvaluacionEditor.jsx a su propio archivo para que tanto el editor
// manual como src/utils/accionesChat.js (Chat con Acciones) usen el mismo
// objeto sin duplicarlo. Vive fuera de EvaluacionEditor.jsx porque un
// componente solo puede exportar componentes (react-refresh/only-export-components).
export const EVALUACION_DEFAULTS = {
  cuestionario: {
    numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'libre',
    tiempoLimiteMin: null, intentosPermitidos: null, conservar: 'mejor',
    publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
    publicarRespuestas: 'inmediato', publicarRespuestasFecha: null, respuestasPublicadas: false,
    mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
  },
  examen: {
    numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'secuencial',
    tiempoLimiteMin: 30, intentosPermitidos: 1, conservar: 'ultimo',
    publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
    publicarRespuestas: 'inmediato', publicarRespuestasFecha: null, respuestasPublicadas: false,
    mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
  },
  // categoria: 'juego' (Crucigrama / Sopa de letras) — decisión de producto
  // #3 aprobada: sin límite de intentos, se conserva la mejor calificación,
  // 15 minutos de tiempo límite por default.
  juego: {
    tiempoLimiteMin: 15, intentosPermitidos: null, conservar: 'mejor',
  },
}
