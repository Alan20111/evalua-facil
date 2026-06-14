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

export function exportSubjectGrades({
  subject,
  activities,
  students,
  submissions,
  attendanceSessions = [],
}) {
  const PARCIALES = Array.from({ length: subject.parciales || 3 }, (_, i) => i + 1)

  const FIXED = 4
  const parcialMeta = PARCIALES.map((p) => {
    const acts = activities.filter((a) => a.parcial === p)
    return { p, acts, cols: acts.length + 1 }
  })

  const hasAttendance = attendanceSessions.length > 0
  const gradeCols = FIXED + parcialMeta.reduce((s, m) => s + m.cols, 0) + 1
  const attColCount = PARCIALES.length + 1  // one col per parcial + total
  const totalCols = hasAttendance ? gradeCols + attColCount : gradeCols

  // Attendance counts per student per parcial
  const sessionCounts = {}
  PARCIALES.forEach((p) => { sessionCounts[p] = 0 })
  attendanceSessions.forEach((s) => {
    if (s.parcial && sessionCounts[s.parcial] !== undefined) sessionCounts[s.parcial]++
  })

  const attMap = {}
  students.forEach((s) => {
    attMap[s.id] = {}
    PARCIALES.forEach((p) => { attMap[s.id][p] = 0 })
  })
  attendanceSessions.forEach((session) => {
    Object.entries(session.asistencias || {}).forEach(([sId, present]) => {
      if (present && attMap[sId] && attMap[sId][session.parcial] !== undefined) {
        attMap[sId][session.parcial]++
      }
    })
  })

  // Row 0: Title
  const titleRow = Array(totalCols).fill('')
  titleRow[0] = `${subject.nombre}   (${subject.ciclo})`

  // Row 2: Section headers
  const sectionRow = Array(totalCols).fill('')
  let col = FIXED
  const parcialRanges = {}
  PARCIALES.forEach((p, pi) => {
    const { cols } = parcialMeta[pi]
    parcialRanges[p] = { start: col, end: col + cols - 1 }
    sectionRow[col] = `PARCIAL ${p}`
    col += cols
  })
  sectionRow[col] = 'FINAL'
  if (hasAttendance) sectionRow[col + 1] = 'ASISTENCIAS'

  // Row 3: Column names
  const nameRow = ['#', 'Apellido Paterno', 'Apellido Materno', 'Nombre(s)']
  PARCIALES.forEach((p, pi) => {
    const { acts } = parcialMeta[pi]
    acts.forEach((a) => nameRow.push(a.nombre))
    nameRow.push(`Prom. P${p}`)
  })
  nameRow.push('Promedio Final')
  if (hasAttendance) {
    PARCIALES.forEach((p) => nameRow.push(`Asist. P${p}`))
    nameRow.push('Total Asist.')
  }

  // Data rows
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

    if (hasAttendance) {
      const att = attMap[s.id] || {}
      PARCIALES.forEach((p) => { row.push(sessionCounts[p] ? (att[p] || 0) : '') })
      row.push(PARCIALES.reduce((sum, p) => sum + (att[p] || 0), 0))
    }

    return row
  })

  // Footer row with total session counts
  const footerRow = Array(totalCols).fill('')
  if (hasAttendance) {
    footerRow[0] = 'Total de clases por parcial:'
    PARCIALES.forEach((p, i) => { footerRow[gradeCols + i] = sessionCounts[p] || '' })
    footerRow[gradeCols + PARCIALES.length] = attendanceSessions.length
  }

  const allRows = [titleRow, [], sectionRow, nameRow, ...dataRows]
  if (hasAttendance) allRows.push([], footerRow)
  const ws = XLSX.utils.aoa_to_sheet(allRows)

  // Merges: title spans all + each parcial header + attendance header
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    ...PARCIALES.map((p) => ({
      s: { r: 2, c: parcialRanges[p].start },
      e: { r: 2, c: parcialRanges[p].end },
    })),
  ]
  if (hasAttendance) {
    merges.push({ s: { r: 2, c: gradeCols }, e: { r: 2, c: totalCols - 1 } })
  }
  ws['!merges'] = merges

  ws['!cols'] = [
    { wch: 4 },
    { wch: 20 },
    { wch: 20 },
    { wch: 22 },
    ...Array(gradeCols - FIXED).fill({ wch: 13 }),
    ...(hasAttendance ? Array(attColCount).fill({ wch: 10 }) : []),
  ]
  ws['!rows'] = [{ hpt: 22 }, {}, { hpt: 18 }, { hpt: 18 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Calificaciones')
  const safeName = subject.nombre.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim().replace(/\s+/g, '_')
  XLSX.writeFile(wb, `calificaciones_${safeName}.xlsx`)
}
