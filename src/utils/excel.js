import * as XLSX from 'xlsx'

export function downloadStudentTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Apellido Paterno', 'Apellido Materno', 'Nombre(s)'],
    ['García', 'López', 'Juan Carlos'],
  ])
  ws['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 25 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Alumnos')
  XLSX.writeFile(wb, 'plantilla-alumnos.xlsx')
}

export function parseStudentExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })
        // Skip header row, expect: ApellidoPaterno | ApellidoMaterno | Nombre
        const students = rows
          .slice(1)
          .filter((r) => r[0] && r[1] && r[2])
          .map((r) => ({
            apellidoPaterno: String(r[0]).trim(),
            apellidoMaterno: String(r[1]).trim(),
            nombre: String(r[2]).trim(),
          }))
        resolve(students)
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

export function exportStudentListExcel(students) {
  const rows = [
    ['#', 'Apellido Paterno', 'Apellido Materno', 'Nombre', 'Username', 'Contraseña Reset'],
    ...students.map((s) => [
      s.orden,
      s.apellidoPaterno,
      s.apellidoMaterno,
      s.nombre,
      s.username,
      s.passwordReset,
    ]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Lista')
  XLSX.writeFile(wb, 'lista_alumnos.xlsx')
}

export function exportGradesExcel(students, activities, submissions) {
  const parciales = [1, 2, 3]
  const header = ['#', 'Alumno']
  parciales.forEach((p) => {
    const acts = activities.filter((a) => a.parcial === p)
    acts.forEach((a) => header.push(`P${p} - ${a.nombre}`))
    header.push(`Promedio P${p}`)
  })
  header.push('Promedio Final')

  const rows = students.map((s) => {
    const row = [s.orden, `${s.apellidoPaterno} ${s.apellidoMaterno} ${s.nombre}`]
    let totalCalifs = []
    parciales.forEach((p) => {
      const acts = activities.filter((a) => a.parcial === p)
      const parcialCalifs = []
      acts.forEach((a) => {
        const sub = submissions.find(
          (sub) => sub.alumnoId === s.id && sub.actividadId === a.id
        )
        const grade =
          sub?.calificacion != null ? sub.calificacion : ''
        row.push(grade)
        if (grade !== '') parcialCalifs.push(grade)
      })
      const avg =
        parcialCalifs.length
          ? (parcialCalifs.reduce((a, b) => a + b, 0) / parcialCalifs.length).toFixed(1)
          : ''
      row.push(avg)
      if (avg !== '') totalCalifs.push(parseFloat(avg))
    })
    const final =
      totalCalifs.length
        ? (totalCalifs.reduce((a, b) => a + b, 0) / totalCalifs.length).toFixed(1)
        : ''
    row.push(final)
    return row
  })

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Calificaciones')
  XLSX.writeFile(wb, 'calificaciones.xlsx')
}
