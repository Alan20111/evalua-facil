// Análisis integral de asignatura con IA — el PLAN del informe.
//
// Función PURA, sin imports que dependan del bundler (mismo criterio que
// analisisResultadosPDF.js): separa QUÉ lleva el informe de CÓMO se dibuja.
// La pantalla (components/analisis/InformeAsignatura.jsx) y el PDF
// (utils/pdf.js → exportAnalisisAsignaturaPDF) recorren este MISMO plan, así
// lo que el docente ve y lo que descarga no pueden desincronizarse.
//
// Todo sale del documento guardado en subjects/{id}/analisisIA/{clave}: los
// números los calculó el servidor, los textos los redactó la IA y los nombres
// son los de ese día. Aquí no se calcula, no se consulta y no se inventa nada.
import { capitalizarNombre } from './nombres.js'
import { etiquetaFuente } from './analisisAsignatura.js'

export const AVISO_IA_ASIGNATURA =
  'Este análisis fue generado con inteligencia artificial a partir de los datos de tu asignatura. Puede contener errores. Revísalo cuidadosamente antes de tomar decisiones pedagógicas.'

const millis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : null)

export function fechaAnalisis(generadoEn) {
  const ms = millis(generadoEn)
  if (ms == null) return ''
  return new Date(ms).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
}

export function nombreEstudianteAnalisis(e) {
  return [e?.apellidoPaterno, e?.apellidoMaterno, e?.nombre].map(capitalizarNombre).filter(Boolean).join(' ') || '(sin nombre)'
}

// "6. Cerda Puga Fernando": el número de lista es el "No." de la tabla de
// Calificaciones. Los informes guardados antes de que existiera ese campo no
// lo traen: se muestra solo el nombre, sin inventar un número.
export function estudianteConNumero(e) {
  const nombre = nombreEstudianteAnalisis(e)
  return Number.isFinite(e?.numeroLista) ? `${e.numeroLista}. ${nombre}` : nombre
}

// "1.4 — Cable cruzado": la etiqueta es la que usa la plataforma para esa
// actividad. Informes anteriores a este campo: solo el nombre.
export function actividadConEtiqueta(a) {
  return a?.etiqueta ? `${a.etiqueta} — ${a.nombre}` : (a?.nombre || '')
}

export function textoParciales(parciales) {
  const lista = parciales || []
  if (!lista.length) return ''
  return lista.length === 1 ? `Parcial ${lista[0]}` : `Parciales ${lista.join(', ')}`
}

export function textoFuentes(fuentes) {
  return (fuentes || []).map(etiquetaFuente).join(', ')
}

const ESTADO_PARCIAL = { abierto: 'Abierto', atencion: 'Atención de inquietudes', cerrado: 'Cerrado' }
const num = (v) => (v == null ? '—' : String(v))
const lista = (items, vacio) => (items?.length ? { tipo: 'lista', items } : { tipo: 'nota', texto: vacio })

// Devuelve { parciales, fuentes, generadoEn, aviso, secciones }. Cada sección:
// { titulo, tono: 'ia' | 'dato' | 'atencion', bloques: [parrafo|lista|tabla|nota] }.
// Las nueve secciones del informe son fijas y van siempre en este orden.
export function planInformeAsignatura(analisis) {
  const d = analisis?.datos || {}
  const inf = analisis?.informe || {}
  const atencion = analisis?.estudiantesAtencion || []
  const secciones = []

  // 1 · Resumen ejecutivo
  const resumen = [{ tipo: 'parrafo', texto: inf.resumenEjecutivo || '' }]
  if (d.parciales?.length) {
    resumen.push({
      tipo: 'tabla', titulo: 'Dato — resultados por parcial',
      head: ['Parcial', 'Estado', 'Actividades', 'Promedio del grupo', 'Aprobatorio', 'Por debajo', 'Sin calificaciones'],
      body: d.parciales.map((p) => [`Parcial ${p.parcial}`, ESTADO_PARCIAL[p.estado] || p.estado, num(p.actividades), num(p.promedioGrupo), num(p.aprobados), num(p.reprobados), num(p.sinCalificaciones)]),
    })
  }
  const pie = [`${num(d.totalEstudiantes)} estudiantes`]
  if (d.promedioGeneral != null) pie.push(`promedio general ${d.promedioGeneral}`)
  resumen.push({ tipo: 'nota', texto: pie.join(' · ') })
  if (d.rotuloPromedio) resumen.push({ tipo: 'nota', texto: d.rotuloPromedio })
  secciones.push({ titulo: 'Resumen ejecutivo', tono: 'ia', bloques: resumen })

  // 2 · Fortalezas del grupo
  const fortalezas = [lista(inf.fortalezas, 'Los datos analizados no permiten señalar fortalezas concretas.')]
  if (d.mejores?.length) {
    fortalezas.push({
      tipo: 'tabla', titulo: 'Dato — mayor promedio (ordenadas de mayor a menor promedio)',
      head: ['Actividad', 'Tipo', 'Parcial', 'Promedio'],
      body: d.mejores.map((a) => [actividadConEtiqueta(a), a.tipo, String(a.parcial), num(a.promedio)]),
    })
  }
  secciones.push({ titulo: 'Fortalezas del grupo', tono: 'ia', bloques: fortalezas })

  // 3 · Dificultades principales
  secciones.push({ titulo: 'Dificultades principales', tono: 'ia', bloques: [lista(inf.dificultades, 'Los datos analizados no muestran dificultades destacadas.')] })

  // 4 · Evolución
  const evolucion = []
  if (d.evolucion) {
    evolucion.push({ tipo: 'parrafo', texto: inf.evolucion || '' })
    evolucion.push({
      tipo: 'tabla', titulo: 'Dato — promedio del grupo por parcial',
      head: ['Parcial', 'Promedio del grupo'],
      body: d.evolucion.porParcial.map((p) => [`Parcial ${p.parcial}`, num(p.promedioGrupo)]),
    })
    evolucion.push({ tipo: 'nota', texto: `De ${d.evolucion.comparables} estudiantes con calificaciones en más de un parcial: ${d.evolucion.mejoraron} con mejora, ${d.evolucion.bajaron} con baja y ${d.evolucion.estables} sin cambio relevante (se cuenta un cambio de ${d.evolucion.cambioRelevante} punto o más).` })
  } else {
    evolucion.push({
      tipo: 'nota',
      texto: (analisis?.parciales || []).length < 2
        ? 'Se analizó un solo parcial: no hay evolución que comparar.'
        : 'No hay calificaciones en más de un parcial para comparar la evolución.',
    })
  }
  secciones.push({ titulo: 'Evolución', tono: 'ia', bloques: evolucion })

  // 5 · Actividades y áreas críticas
  const criticas = [lista(inf.areasCriticas, 'Los datos analizados no muestran áreas críticas.')]
  if (d.criticas?.length) {
    criticas.push({
      tipo: 'tabla', titulo: 'Dato — menor promedio (ordenadas de menor a mayor promedio)',
      head: ['Actividad', 'Tipo', 'Parcial', 'Promedio'],
      body: d.criticas.map((a) => [actividadConEtiqueta(a), a.tipo, String(a.parcial), num(a.promedio)]),
    })
  }
  if (d.asistencia) {
    const a = d.asistencia
    criticas.push({
      tipo: 'tabla', titulo: 'Dato — asistencia',
      head: ['Parcial', 'Asistencia', 'Faltas', 'Registros'],
      body: [
        ...a.porParcial.map((p) => [`Parcial ${p.parcial}`, `${num(p.pct)} %`, num(p.faltas), num(p.total)]),
        ['Total', `${num(a.pctGrupo)} %`, num(a.faltas), num(a.total)],
      ],
    })
    criticas.push({ tipo: 'nota', texto: `${a.debajoDelMinimo} de ${a.estudiantesConRegistro} estudiantes con registro están por debajo de ${a.minimo} % de asistencia. Las justificadas cuentan como asistencia; las sesiones sin registro no cuentan como falta.` })
  }
  if (d.sinEntrega) {
    const s = d.sinEntrega
    const conFaltas = s.actividades.filter((f) => f.noRealizadas || f.incompletas)
    if (conFaltas.length) {
      criticas.push({
        tipo: 'tabla', titulo: 'Dato — actividades vencidas sin realizar (en el orden de la plataforma)',
        head: ['Actividad', 'Tipo', 'Parcial', 'No realizadas', 'Sin terminar'],
        body: conFaltas.map((f) => [actividadConEtiqueta(f), f.tipo, String(f.parcial), num(f.noRealizadas), num(f.incompletas)]),
      })
    }
    criticas.push({ tipo: 'nota', texto: `${s.totalNoRealizadas} no realizadas y ${s.totalIncompletas} iniciadas sin terminar, de ${s.estudiantesConFaltantes} estudiantes. ${s.totalEnPlazo} siguen en plazo. ${s.actividadesSinFechaLimite} actividad(es) sin fecha límite no se cuentan como incumplimiento. Una actividad calificada sin archivo en la plataforma tampoco cuenta.` })
  }
  secciones.push({ titulo: 'Actividades y áreas críticas', tono: 'ia', bloques: criticas })

  // 6 · Estudiantes que requieren atención (los eligió la plataforma, no la IA)
  const estudiantes = []
  if (atencion.length) {
    if (d.patronGrupal) {
      estudiantes.push({ tipo: 'nota', texto: `${atencion.length} de ${num(d.totalEstudiantes)} estudiantes presentan alguna señal: más de la mitad del grupo. Conviene tratarlo como un patrón del grupo y no como casos individuales aislados.` })
    }
    estudiantes.push({
      tipo: 'tabla', titulo: 'Señales encontradas — no son un diagnóstico (por número de lista)',
      head: ['Estudiante', 'Señales'],
      body: atencion.map((e) => [estudianteConNumero(e), (e.senales || []).map((s) => s.texto).join('\n')]),
    })
  } else {
    estudiantes.push({ tipo: 'nota', texto: 'Con las fuentes analizadas, ningún estudiante presenta señales de atención.' })
  }
  secciones.push({ titulo: 'Estudiantes que requieren atención', tono: 'atencion', bloques: estudiantes })

  // 7 · Recomendaciones generales
  secciones.push({ titulo: 'Recomendaciones generales', tono: 'ia', bloques: [lista(inf.recomendacionesGenerales, 'No se generaron recomendaciones generales.')] })

  // 8 · Recomendaciones específicas por estudiante
  const conRec = atencion.filter((e) => e.recomendacion)
  secciones.push({
    titulo: 'Recomendaciones específicas',
    tono: 'ia',
    bloques: [conRec.length
      ? { tipo: 'tabla', titulo: 'Por número de lista', head: ['Estudiante', 'Recomendación'], body: conRec.map((e) => [estudianteConNumero(e), e.recomendacion]) }
      : { tipo: 'nota', texto: atencion.length ? 'No se generaron recomendaciones individuales.' : 'No hay estudiantes identificados que requieran una recomendación individual.' }],
  })

  // 9 · Conclusión general
  secciones.push({ titulo: 'Conclusión general', tono: 'ia', bloques: [{ tipo: 'parrafo', texto: inf.conclusion || '' }] })

  return {
    parciales: textoParciales(analisis?.parciales),
    fuentes: textoFuentes(analisis?.fuentes),
    generadoEn: fechaAnalisis(analisis?.generadoEn),
    aviso: AVISO_IA_ASIGNATURA,
    secciones,
  }
}
