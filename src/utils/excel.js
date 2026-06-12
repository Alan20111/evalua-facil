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

export function exportSubjectGrades({ subject, group, activities, students, submissions }) {
  const PARCIALES = [1, 2, 3]

  // ── Column layout ────────────────────────────────────────────────
  // Fixed cols: #, Apellido Paterno, Apellido Materno, Nombre(s)
  // Per parcial: [act1, act2, ..., Prom Px]
  // Final: Promedio Final

  const FIXED = 4  // number of fixed left columns
  const parcialMeta = PARCIALES.map((p) => {
    const acts = activities.filter((a) => a.parcial === p)
    return { p, acts, cols: acts.length + 1 }  // +1 for avg column
  })

  const totalCols = FIXED + parcialMeta.reduce((s, m) => s + m.cols, 0) + 1

  // ── Row 0: Title ─────────────────────────────────────────────────
  const titleRow = Array(totalCols).fill('')
  titleRow[0] = `${subject.nombre}   ·   ${group.nombre}   (${group.ciclo})`

  // ── Row 1: Parcial headers (merged per block) ────────────────────
  const parcialRow = Array(totalCols).fill('')
  let col = FIXED
  const parcialRanges = {}
  PARCIALES.forEach((p, pi) => {
    const { cols } = parcialMeta[pi]
    parcialRanges[p] = { start: col, end: col + cols - 1 }
    parcialRow[col] = `PARCIAL ${p}`
    col += cols
  })
  parcialRow[col] = 'FINAL'

  // ── Row 2: Column names ──────────────────────────────────────────
  const nameRow = ['#', 'Apellido Paterno', 'Apellido Materno', 'Nombre(s)']
  PARCIALES.forEach((p, pi) => {
    const { acts } = parcialMeta[pi]
    acts.forEach((a) => nameRow.push(a.nombre))
    nameRow.push(`Prom. P${p}`)
  })
  nameRow.push('Promedio Final')

  // ── Data rows ────────────────────────────────────────────────────
  const sorted = [...students].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  const dataRows = sorted.map((s) => {
    const row = [s.orden, s.apellidoPaterno, s.apellidoMaterno, s.nombre]
    const finalGrades = []

    PARCIALES.forEach((p, pi) => {
      const { acts } = parcialMeta[pi]
      const parGrades = []
      acts.forEach((a) => {
        const sub = submissions.find(
          (sub) => sub.alumnoId === s.id && sub.actividadId === a.id
        )
        if (sub?.calificacion != null) {
          // Normalize to 0-10 scale regardless of maxCalif
          const norm = parseFloat(((sub.calificacion / (a.maxCalif || 10)) * 10).toFixed(2))
          row.push(norm)
          parGrades.push(norm)
        } else {
          row.push('')
        }
      })
      const parAvg = parGrades.length
        ? parseFloat((parGrades.reduce((a, b) => a + b, 0) / parGrades.length).toFixed(2))
        : ''
      row.push(parAvg)
      if (parAvg !== '') finalGrades.push(parAvg)
    })

    const final = finalGrades.length
      ? parseFloat((finalGrades.reduce((a, b) => a + b, 0) / finalGrades.length).toFixed(2))
      : ''
    row.push(final)
    return row
  })

  // ── Build sheet ──────────────────────────────────────────────────
  const allRows = [titleRow, [], parcialRow, nameRow, ...dataRows]
  const ws = XLSX.utils.aoa_to_sheet(allRows)

  // Merges: title spans all cols; each parcial header spans its block
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    ...PARCIALES.map((p) => ({
      s: { r: 2, c: parcialRanges[p].start },
      e: { r: 2, c: parcialRanges[p].end },
    })),
  ]

  // Column widths
  ws['!cols'] = [
    { wch: 4 },   // #
    { wch: 20 },  // apellidoPaterno
    { wch: 20 },  // apellidoMaterno
    { wch: 22 },  // nombre
    ...Array(totalCols - FIXED).fill({ wch: 13 }),
  ]

  // Row heights: title row taller
  ws['!rows'] = [{ hpt: 22 }, {}, { hpt: 18 }, { hpt: 18 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Calificaciones')
  const safeName = subject.nombre.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim().replace(/\s+/g, '_')
  XLSX.writeFile(wb, `calificaciones_${safeName}.xlsx`)
}
