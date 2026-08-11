// OP-10 · Texto de "confiabilidad" del análisis de resultados con IA —
// UNA sola función para pantalla (AnalisisResultadosIA.jsx) y PDF
// (analisisResultadosPDF.js), para que nunca digan cosas distintas.
//
// `resultado.confiabilidad` ya viene calculada por el servidor
// (functions/ia.js, agregarResultados) — este archivo NO recalcula nada,
// solo redacta esos números en español llano, sin ningún término de
// implementación (nada de "snapshot", "intento ganador", "Firestore", etc.):
// el docente solo necesita saber qué se usó y qué no, y por qué.
//
// Análisis generados ANTES de esta corrección no traen `confiabilidad` —
// para esos, `resumenConfiabilidad` devuelve `null` y la pantalla/PDF
// simplemente no muestran la sección (no se inventa retroactivamente).

const MOTIVOS_EXCLUSION = {
  intento_no_coincide_con_calificacion_final:
    'las respuestas disponibles no corresponden al intento que determinó su calificación final',
}

function textoMotivo(motivo) {
  return MOTIVOS_EXCLUSION[motivo]
    || 'no se pudo confirmar que sus respuestas disponibles correspondan al intento que determinó su calificación final'
}

// Devuelve `null` si no hay nada que mostrar (sin `confiabilidad`, o sin
// entregas). Si no hubo exclusiones, el mensaje es una sola frase neutra —
// nada de alertas para una situación que no lo amerita.
export function resumenConfiabilidad(confiabilidad) {
  if (!confiabilidad || !confiabilidad.totalEntregas) return null
  const { totalEntregas, confiablesParaReactivo, excluidas, motivoExclusion } = confiabilidad
  const plural = totalEntregas !== 1

  if (excluidas > 0) {
    return `De ${totalEntregas} estudiante${plural ? 's' : ''} evaluado${plural ? 's' : ''}, los resultados generales `
      + `consideran a los ${totalEntregas}. Para el análisis por reactivo, ${confiablesParaReactivo} `
      + `${confiablesParaReactivo === 1 ? 'cuenta' : 'cuentan'} con respuestas confiables y `
      + `${excluidas} ${excluidas === 1 ? 'fue excluida' : 'fueron excluidas'} porque ${textoMotivo(motivoExclusion)}.`
  }

  return `Los resultados generales y el análisis por reactivo consideran a los ${totalEntregas} `
    + `estudiante${plural ? 's' : ''} evaluado${plural ? 's' : ''}.`
}
