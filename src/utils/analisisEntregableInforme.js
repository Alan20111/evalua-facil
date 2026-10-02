// Análisis con IA de UNA actividad entregable («solo resultados») — el PLAN
// del informe. Función PURA: la pantalla y el PDF recorren este mismo plan.
//
// Todo sale del documento guardado en activities/{id}/analisisActividadIA:
// los números los calculó el servidor, los nombres son los de ese día. El
// texto de la IA puede haber sido corregido por el docente: si hay `edicion`,
// esa es la versión que se muestra (el original sigue guardado intacto).
import { estudianteConNumero, fechaAnalisis, actividadConEtiqueta } from './analisisAsignaturaInforme.js'

export const AVISO_IA_ACTIVIDAD =
  'Este análisis fue generado con inteligencia artificial a partir de los resultados de esta actividad. Puede contener errores. Revísalo cuidadosamente antes de tomar decisiones pedagógicas.'

export const CAMPOS_TEXTO_ENTREGABLE = ['resumenEjecutivo', 'fortalezas', 'dificultades', 'recomendaciones']

export const MODALIDADES_ENTREGABLE = { resultados: 'Solo resultados' }

// El texto vigente: lo editado por el docente gana campo por campo sobre el
// original de la IA.
export function textoVigenteEntregable(analisis) {
  const original = analisis?.informe || {}
  const edicion = analisis?.edicion || null
  const vigente = {}
  for (const k of CAMPOS_TEXTO_ENTREGABLE) {
    const v = edicion && Object.prototype.hasOwnProperty.call(edicion, k) ? edicion[k] : original[k]
    vigente[k] = k === 'resumenEjecutivo' ? String(v || '') : (Array.isArray(v) ? v.filter((x) => String(x || '').trim()) : [])
  }
  return vigente
}

export function fueEditadoEntregable(analisis) {
  return !!(analisis?.edicion && typeof analisis.edicion === 'object' && Object.keys(analisis.edicion).length)
}

const num = (v) => (v == null ? '—' : String(v))
const lista = (items, vacio) => (items?.length ? { tipo: 'lista', items } : { tipo: 'nota', texto: vacio })

// "6. Cerda Puga Fernando — No entregó; actividad vencida."
export function lineaEstudianteRevisar(e) {
  const senales = (e?.senales || []).map((s) => s.texto).join('; ')
  return `${estudianteConNumero(e)} — ${senales}.`
}

export function planInformeEntregable(analisis) {
  const d = analisis?.datos || {}
  const a = d.actividad || {}
  const r = d.resultados || {}
  const c = d.calificaciones || {}
  const t = textoVigenteEntregable(analisis)
  const secciones = []

  secciones.push({ titulo: 'Resumen ejecutivo', tono: 'ia', bloques: [{ tipo: 'parrafo', texto: t.resumenEjecutivo }] })

  secciones.push({
    titulo: 'Resultados generales', tono: 'dato',
    bloques: [
      {
        tipo: 'tabla', head: ['Dato', 'Estudiantes'],
        body: [
          ['Estudiantes de la asignatura', num(r.estudiantes)],
          ['Entregaron en la plataforma', `${num(r.entregaron)}${r.porcentajeEntrega != null ? ` (${r.porcentajeEntrega} %)` : ''}`],
          ['— en plazo', num(r.entregasEnPlazo)],
          ['— tarde', num(r.entregasTardias)],
          ['Calificados sin archivo en la plataforma', num(r.calificadasSinArchivo)],
          ['No entregaron (actividad vencida)', num(r.noEntregaron)],
          ['Aún en plazo', num(r.pendientesEnPlazo)],
          ['Pendientes sin fecha límite', num(r.pendientesSinFechaLimite)],
          ['Entregas sin calificar', num(r.sinCalificar)],
        ],
      },
      { tipo: 'nota', texto: 'El porcentaje de entrega cuenta solo las entregas hechas en la plataforma. Una calificación sin archivo no es un incumplimiento.' },
    ],
  })

  secciones.push({
    titulo: 'Distribución de calificaciones', tono: 'dato',
    bloques: c.calificados
      ? [
          { tipo: 'tabla', head: ['Calificados', 'Promedio', 'Mediana', 'Mínimo', 'Máximo'], body: [[num(c.calificados), num(c.promedio), num(c.mediana), num(c.minimo), num(c.maximo)]] },
          { tipo: 'tabla', titulo: 'Por rango (escala de 10)', head: ['Rango', 'Estudiantes'], body: (c.rangos || []).map((x) => [x.rango, num(x.estudiantes)]) },
        ]
      : [{ tipo: 'nota', texto: 'Todavía no hay calificaciones en esta actividad.' }],
  })

  if (d.instrumento) {
    const ins = d.instrumento
    secciones.push({
      titulo: ins.tipo, tono: 'dato',
      bloques: ins.criterios?.length
        ? [{
            tipo: 'tabla',
            titulo: ins.tipo === 'Lista de cotejo' ? 'Cumplimiento por criterio' : 'Distribución por nivel',
            head: ins.tipo === 'Lista de cotejo' ? ['Criterio', 'Cumplen'] : ['Criterio', 'Niveles'],
            body: ins.criterios.map((k) => [k.nombre, k.niveles ? k.niveles.map((n) => `${n.nivel}: ${n.estudiantes}`).join('\n') : `${k.cumplen} de ${k.evaluados}`]),
          }]
        : [{ tipo: 'nota', texto: `La actividad tiene ${ins.tipo.toLowerCase()}, pero todavía no hay evaluaciones por criterio.` }],
    })
  }

  secciones.push({ titulo: 'Fortalezas', tono: 'ia', bloques: [lista(t.fortalezas, 'Los resultados no permiten señalar fortalezas concretas.')] })
  secciones.push({ titulo: 'Dificultades', tono: 'ia', bloques: [lista(t.dificultades, 'Los resultados no muestran dificultades destacadas.')] })

  const revisar = analisis?.estudiantesRevisar || []
  secciones.push({
    titulo: 'Estudiantes a revisar', tono: 'atencion',
    bloques: revisar.length
      ? [{ tipo: 'nota', texto: 'Por número de lista. Son señales a revisar, no un diagnóstico.' }, { tipo: 'lista', items: revisar.map(lineaEstudianteRevisar) }]
      : [{ tipo: 'nota', texto: 'Ningún estudiante presenta señales en esta actividad.' }],
  })

  secciones.push({ titulo: 'Recomendaciones', tono: 'ia', bloques: [lista(t.recomendaciones, 'No se generaron recomendaciones.')] })

  return {
    actividad: actividadConEtiqueta(a),
    modalidad: MODALIDADES_ENTREGABLE[analisis?.modalidad] || 'Solo resultados',
    generadoEn: fechaAnalisis(analisis?.generadoEn),
    editado: fueEditadoEntregable(analisis),
    aviso: AVISO_IA_ACTIVIDAD,
    secciones,
  }
}
