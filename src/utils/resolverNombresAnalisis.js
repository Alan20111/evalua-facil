import { studentFullName } from './studentSearch'

// Resuelve anonId → nombre real usando `students` (solo en el cliente: la IA
// nunca vio estos nombres). La reutilizan tanto AnalisisResultadosIA.jsx como
// el botón "PDF" de la bitácora en EvaluacionManager, para no duplicar la
// traducción. En archivo aparte (no dentro de AnalisisResultadosIA.jsx) para
// que ese componente exporte solo el componente — mezclar una función
// exportada ahí rompe Fast Refresh (react-refresh/only-export-components).
export function resolverNombresAnalisis(resultado, students) {
  const nombrePorAnonId = new Map(
    (resultado.mapaAlumnos || []).map(({ anonId, alumnoId }) => {
      const st = students?.find((s) => s.id === alumnoId)
      return [anonId, st ? studentFullName(st) : anonId]
    })
  )
  return {
    nombrePorAnonId,
    resultado: {
      ...resultado,
      estudiantesAtencion: (resultado.estudiantesAtencion || []).map((e) => ({
        ...e, nombre: nombrePorAnonId.get(e.anonId) || e.anonId,
      })),
    },
  }
}
