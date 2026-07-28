// Prórrogas por estudiante de una actividad.
//
// `activity.extensiones` es un mapa plano studentId → 'YYYY-MM-DDTHH:MM', sin
// metadatos de agrupación, y `activity.extensionesMotivo` otro mapa igual con
// el motivo. Una sola acción de "Nueva fecha límite" escribe la MISMA fecha y
// motivo a todos los estudiantes seleccionados, así que agrupar por (fecha,
// motivo) reconstruye "a quién se le dio esta prórroga" sin guardar un historial
// aparte.
//
// Vive aquí y no dentro de un editor porque lo usan los dos: entregables
// (EntregableEditor) y evaluaciones (EvaluacionEditor).

export function groupExtensions(extensiones, extensionesMotivo, students) {
  const byKey = new Map()
  Object.entries(extensiones || {}).forEach(([studentId, date]) => {
    if (!date) return
    const motivo = (extensionesMotivo || {})[studentId] || ''
    const key = `${date}|${motivo}`
    const student = (students || []).find((s) => s.id === studentId)
    const name = student
      ? `${student.apellidoPaterno} ${student.apellidoMaterno || ''} ${student.nombre}`.replace(/\s+/g, ' ').trim()
      : 'Estudiante'
    if (!byKey.has(key)) byKey.set(key, { date, motivo, names: [] })
    byKey.get(key).names.push(name)
  })
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date))
}
