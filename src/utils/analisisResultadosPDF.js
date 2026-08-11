// OP-10 · Contenido del PDF de "Análisis de resultados con IA".
//
// Función PURA (sin imports) a propósito: separa QUÉ va en el reporte de
// CÓMO se dibuja con jsPDF (eso vive en pdf.js, que sí depende de un
// bundler — sus imports relativos sin extensión no resuelven bajo Node
// puro, así que ninguna función de pdf.js se puede probar directo con
// `node test/unidad.test.mjs`). Aquí se arma el "plan" del reporte; pdf.js
// solo lo recorre y lo dibuja — así lo que se prueba aquí es EXACTAMENTE lo
// que termina en el PDF, no una copia paralela que se pueda desincronizar.
//
// Todos los números (porcentajes, ranking de reactivos) vienen de
// `resultado`, que ya los calculó Evalúa Fácil (ver functions/ia.js,
// agregarResultados) — este archivo no inventa ni recalcula nada, solo
// acomoda lo que ya existe para imprimirlo.
export const AVISO_IA_ANALISIS =
  'Este análisis fue generado con inteligencia artificial. Puede contener errores. Revísalo cuidadosamente antes de tomar decisiones pedagógicas.'

// `resultado.estudiantesAtencion[].nombre` ya debe venir resuelto por el
// llamador (el componente de pantalla, que es quien tiene `students`) — este
// archivo nunca traduce anonId → nombre, y la IA nunca vio esos nombres.
export function contenidoAnalisisResultadosPDF({ activity, subject, resultado, generadoEn = null, membrete = null }) {
  return {
    institucion: membrete?.escuela || null,
    docente: membrete?.docente || null,
    evaluacion: activity?.nombre || '',
    tipo: activity?.categoria === 'examen' ? 'Examen' : 'Cuestionario',
    grupo: [subject?.nombre, subject?.grupo].filter(Boolean).join(' — '),
    generadoEn,
    totalEstudiantes: resultado?.totalEstudiantes ?? null,
    totalReactivos: resultado?.totalReactivos ?? null,
    porcentajeAciertosGeneral: resultado?.porcentajeAciertosGeneral ?? null,
    resumenGeneral: resultado?.resumenGeneral || '',
    resumenEjecutivo: resultado?.resumenEjecutivo || '',
    reactivosDificiles: (resultado?.reactivosDificiles || []).map((r) => ({ numero: r.numero, enunciado: r.enunciado, pctAciertos: r.pctAciertos })),
    reactivosFuertes: (resultado?.reactivosFuertes || []).map((r) => ({ numero: r.numero, enunciado: r.enunciado, pctAciertos: r.pctAciertos })),
    patrones: (resultado?.patrones || []).map((p) => ({ observacion: p.observacion, interpretacion: p.interpretacion })),
    estudiantesAtencion: (resultado?.estudiantesAtencion || []).map((e) => ({ nombre: e.nombre || e.anonId, senal: e.senal })),
    recomendaciones: resultado?.recomendaciones || [],
    aviso: AVISO_IA_ANALISIS,
  }
}
