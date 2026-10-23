// Participación en vivo · PLAN del «Informe en PDF» de una sesión (qué va y en qué orden), sin Firebase ni jsPDF para poder
// probarlo solo. Lo dibuja construirPDFDeInforme (utils/pdf.js), el mismo motor de los otros informes de IA.
//
// Fuente ÚNICA: el informe final ya guardado (vivoInformes/{codigo}_final) y las notas guardadas por el docente. Aquí no se
// recalcula nada ni se llama a la IA, así que exportar no consume créditos ni cambia el informe.
import { ACCESOS_VIVO, PROPOSITOS_VIVO, esEncuesta, propositoDe } from './participacionVivo.js'

// Rótulos del siguiente paso: los mismos en pantalla (DiagnosticoDocente) y en el PDF.
export const PASO_INFORME_VIVO = { reexplicar: 'Volver a explicar', aclarar: 'Aclarar con un ejemplo', actividad: 'Hacer una actividad breve' }
// Encuesta: no hay aciertos ni errores; se habla de opiniones.
export const PASO_INFORME_VIVO_ENCUESTA = { reexplicar: 'Retomar el tema', aclarar: 'Conversar con el grupo', actividad: 'Hacer una actividad breve' }

// Tope de las notas del docente (el mismo que exige firestore.rules en vivoNotas).
export const MAX_NOTAS_VIVO = 5000

export const AVISO_IA_VIVO = 'Este informe lo preparó un asistente de IA a partir de las respuestas de la sesión. Es una orientación para el ' +
  'docente: revísalo con tu criterio. No es una calificación.'

const fecha = (ts) => {
  const d = ts?.toDate?.() ?? (ts instanceof Date ? ts : null)
  return d ? d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : ''
}

/** Rótulos de las listas del informe según el propósito (los mismos que en pantalla). */
export function rotulosInformeVivo(encuesta) {
  return {
    comprende: encuesta ? 'Opiniones en las que coinciden' : 'Lo que el grupo comprende',
    noComprende: encuesta ? 'Temas con división o sin consenso' : 'Lo que aún no comprende',
  }
}

/** Participantes distintos de la sesión (estudiante inscrito o navegador externo). */
export function participantesVivo(respuestas) {
  return new Set((respuestas || []).map((r) => r.participanteKey || r.alumnoId).filter(Boolean)).size
}

/**
 * @param {object} p
 * @param {object} p.sesion      documento de vivoSesiones (con `codigo`)
 * @param {object|null} p.informe documento vivoInformes/{codigo}_final, o null si no existe
 * @param {Array} p.respuestas   respuestas de la sesión (solo para contar)
 * @param {string} p.notas       notas del docente (texto plano, puede tener saltos de línea)
 * @param {Date} [p.ahora]
 * @returns {{ titulo, lineas, generadoEn, aviso, secciones }}  (secciones en el formato de construirPDFDeInforme)
 */
export function planInformeVivoPDF({ sesion, informe = null, respuestas = [], notas = '', ahora = new Date() }) {
  const encuesta = esEncuesta(sesion.proposito)
  const rot = rotulosInformeVivo(encuesta)
  const n = (sesion.preguntas || []).length
  const participantes = participantesVivo(respuestas)
  const lineas = [
    [`Sesión del ${fecha(sesion.creadaEn) || '—'}`, ACCESOS_VIVO[sesion.acceso] || '', PROPOSITOS_VIVO[propositoDe(sesion.proposito)] || ''].filter(Boolean).join(' · '),
    `${n} ${n === 1 ? 'pregunta' : 'preguntas'} · ${participantes} ${participantes === 1 ? 'participante' : 'participantes'} · ${respuestas.length} ${respuestas.length === 1 ? 'respuesta' : 'respuestas'}`,
    `Exportado el ${fecha(ahora)}`,
  ]

  const secciones = []
  let aviso = null
  let generadoEn = ''
  const inf = informe?.informe
  if (!sesion.analisisActivo) {
    secciones.push({ titulo: 'Informe de la sesión', tono: 'dato', bloques: [{ tipo: 'nota', texto: 'En esta sesión no se activó el análisis con IA, así que no hay informe.' }] })
  } else if (informe?.estado === 'listo' && inf) {
    aviso = AVISO_IA_VIVO
    generadoEn = fecha(informe.actualizadoEn)
    secciones.push({ titulo: 'Síntesis', tono: 'ia', bloques: [{ tipo: 'parrafo', texto: inf.sintesis || '' }] })
    const lista = (items) => (items?.length ? { tipo: 'lista', items } : { tipo: 'nota', texto: 'Sin elementos en este apartado.' })
    secciones.push({ titulo: rot.comprende, tono: 'ia', bloques: [lista(inf.comprende)] })
    secciones.push({ titulo: rot.noComprende, tono: 'ia', bloques: [lista(inf.noComprende)] })
    const paso = (encuesta ? PASO_INFORME_VIVO_ENCUESTA : PASO_INFORME_VIVO)[inf.siguientePaso?.tipo] || 'Siguiente paso'
    const bloquesPaso = [{ tipo: 'parrafo', texto: inf.siguientePaso?.texto || '' }]
    if (inf.actividadBreve) bloquesPaso.push({ tipo: 'parrafo', texto: `Actividad breve: ${inf.actividadBreve}` })
    secciones.push({ titulo: `Siguiente paso: ${paso}`, tono: 'ia', bloques: bloquesPaso })
    if (inf.limitaciones) secciones.push({ titulo: 'Limitaciones', tono: 'dato', bloques: [{ tipo: 'nota', texto: inf.limitaciones }] })
  } else if (!informe || informe.estado === 'insuficiente') {
    secciones.push({ titulo: 'Informe de la sesión', tono: 'dato', bloques: [{ tipo: 'nota', texto: `Muestra insuficiente: ${informe?.motivo || 'ninguna pregunta reunió datos suficientes para una síntesis.'}` }] })
  } else {
    secciones.push({ titulo: 'Informe de la sesión', tono: 'dato', bloques: [{ tipo: 'nota', texto: 'El informe no estaba disponible al exportar. Puedes actualizarlo y volver a exportar.' }] })
  }

  // Siempre al final y aparte: lo escrito por el docente, nunca mezclado con lo de la IA. Se respetan sus renglones.
  const texto = String(notas || '').trim()
  secciones.push({
    titulo: 'Notas del docente', tono: 'docente',
    bloques: texto
      ? texto.split(/\r?\n/).map((l) => (l.trim() ? { tipo: 'parrafo', texto: l } : { tipo: 'espacio' }))
      : [{ tipo: 'nota', texto: 'Sin notas del docente.' }],
  })

  return { titulo: sesion.titulo || 'Participación en vivo', lineas, generadoEn, aviso, secciones }
}
