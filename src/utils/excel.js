import * as XLSX from 'xlsx'
import { subjectDisplayName } from './subjectName'
import { subjectPeriodLabel } from './dateRange'
import { promedioParcial, pesoDe, ponderacionActivaEnParcial, normalizeGrade } from './ponderacion'
import { attendanceState, countPresence, fmtAttDateParts } from './attendance'
import { studentFullName } from './studentSearch'
import { isDraftActivity } from './activityVisibility'

// Loaded dynamically (only when actually downloading the template) because
// it's needed for one feature `xlsx` can't do: writing real sheet protection
// so Excel itself blocks editing outside columns A/B — `xlsx` (the free
// SheetJS build used elsewhere in this file for reading/exporting) can only
// read protection, not write it.
export async function downloadStudentTemplate() {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Estudiantes')

  // Column 1: list number. Column 2: full name in a SINGLE cell, in the order
  // Apellido Paterno · Apellido Materno · Nombre(s) (separated by spaces).
  sheet.getColumn(1).width = 6
  sheet.getColumn(2).width = 46
  sheet.addRow(['#', 'Nombre completo (Apellido Paterno  Apellido Materno  Nombre)'])
  sheet.addRow([1, 'García López Juan Carlos'])
  sheet.addRow([2, 'Hernández Ruiz María Fernanda'])

  // Protect the sheet but leave columns A/B unlocked for a generous number of
  // rows, so teachers can paste a full class list but can't add stray
  // columns the importer would silently ignore.
  const EDITABLE_ROWS = 500
  for (let r = 1; r <= EDITABLE_ROWS; r++) {
    sheet.getCell(r, 1).protection = { locked: false }
    sheet.getCell(r, 2).protection = { locked: false }
  }
  await sheet.protect('', { selectLockedCells: true, selectUnlockedCells: true })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'plantilla-estudiantes.xlsx'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Splits a natural full-name string by spaces: 1st word = apellido paterno,
// 2nd = apellido materno, the rest = nombre(s).
function splitFullName(full) {
  const parts = String(full).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length === 1) return { apellidoPaterno: parts[0], apellidoMaterno: '', nombre: '' }
  if (parts.length === 2) return { apellidoPaterno: parts[0], apellidoMaterno: parts[1], nombre: '' }
  return { apellidoPaterno: parts[0], apellidoMaterno: parts[1], nombre: parts.slice(2).join(' ') }
}

// Devuelve { valid, invalid } en vez de solo un arreglo — pedido explícito:
// antes una fila mal capturada simplemente desaparecía sin explicación.
// `invalid` trae la fila de Excel real (encabezado = fila 1) y el texto tal
// cual se leyó, para que el docente pueda ubicarla y corregirla. Filas
// realmente vacías (sin ningún contenido) no cuentan como inválidas — son
// el relleno normal de cualquier hoja de cálculo, no un error de captura.
export function parseStudentExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })
        const valid = []
        const invalid = []
        rows.slice(1).forEach((r, i) => {
          const c0 = String(r[0] ?? '').trim()
          const c1 = String(r[1] ?? '').trim()
          const c2 = String(r[2] ?? '').trim()
          let student
          // Backward-compat: old 3-column template (Paterno | Materno | Nombre),
          // where the first cell is a surname (not a list number).
          if (c0 && c1 && c2 && Number.isNaN(Number(c0))) {
            student = { apellidoPaterno: c0, apellidoMaterno: c1, nombre: c2 }
          } else {
            // New template: [#, "Apellido Paterno Apellido Materno Nombre(s)"].
            // The full name is the first cell that has text beyond a plain number.
            const full = c1 || (Number.isNaN(Number(c0)) ? c0 : '')
            student = splitFullName(full)
          }
          if (student && (student.apellidoPaterno || student.nombre)) {
            valid.push(student)
          } else if (c0 || c1 || c2) {
            invalid.push({ fila: i + 2, texto: [c0, c1, c2].filter(Boolean).join(' — ') })
          }
        })
        resolve({ valid, invalid })
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsArrayBuffer(file)
  })
}


// One-parcial grades export — triggered from the EXPORTAR button in the
// grades table header. Same format as the full export but a single parcial
// and no Final column. When ponderación is active the caller must have
// validated the weights sum 10 before calling.
// Ranking export: estudiantes ordenados por promedio (mayor a menor).
// Columnas: LUGAR, No., NOMBRE, PROMEDIO. `rows` = [{ lugar, orden, nombre,
// promedio }] YA ordenado; `label` = "Parcial N" o "Promedio final".
export function exportRankingExcel({ subject, rows, label }) {
  const periodo = subjectPeriodLabel(subject)
  const titleRow = ['', '', '']
  titleRow[0] = `${subjectDisplayName(subject)} — Ranking · ${label}${periodo ? `   (${periodo})` : ''}`
  const nameRow = ['LUGAR', 'NOMBRE', label]
  const dataRows = rows.map((r) => [r.lugar, r.nombre, r.promedio != null ? r.promedio : '—'])
  const allRows = [titleRow, [], nameRow, ...dataRows]
  const ws = XLSX.utils.aoa_to_sheet(allRows)
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]
  ws['!cols'] = [{ wch: 7 }, { wch: 42 }, { wch: 14 }]
  ws['!rows'] = [{ hpt: 22 }, {}, { hpt: 18 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Ranking')
  const safeName = subjectDisplayName(subject).replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim().replace(/\s+/g, '_')
  const safeLabel = label.toLowerCase().replace(/\s+/g, '')
  XLSX.writeFile(wb, `ranking_${safeLabel}_${safeName}.xlsx`)
}

export function exportParcialGrades({ subject, activities, students, submissions, parcial }) {
  const acts = activities
    .filter((a) => a.parcial === parcial && !isDraftActivity(a))
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))

  const totalCols = 2 + acts.length + 1

  const titleRow = Array(totalCols).fill('')
  const periodo = subjectPeriodLabel(subject)
  titleRow[0] = `${subjectDisplayName(subject)} — Parcial ${parcial}${periodo ? `   (${periodo})` : ''}`

  const nameRow = ['#', 'NOMBRE']
  acts.forEach((a, ai) => nameRow.push(`${parcial}.${ai + 1}.`))
  nameRow.push(`Prom. P${parcial}`)

  // PONDERACIÓN row — mirrors the on-screen weights strip (no buttons)
  const pondOn = ponderacionActivaEnParcial(subject, parcial)
  const pesoRow = ['', 'PONDERACIÓN']
  if (pondOn) {
    let totalPesos = 0
    acts.forEach((a) => { const w = pesoDe(a); totalPesos += w; pesoRow.push(w) })
    pesoRow.push(parseFloat(totalPesos.toFixed(2)))
  }

  const sorted = [...students].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  const dataRows = sorted.map((s) => {
    const row = [s.orden, studentFullName(s)]
    const grades = acts.map((a) => {
      const sub = submissions.find((x) => x.alumnoId === s.id && x.actividadId === a.id)
      return normalizeGrade(sub?.calificacion, a.maxCalif, { decimals: 2 })
    })
    grades.forEach((g) => row.push(g !== null ? g : ''))
    const rawAvg = promedioParcial(acts, grades, pondOn)
    row.push(rawAvg !== null ? parseFloat(rawAvg.toFixed(2)) : '')
    return row
  })

  const allRows = pondOn
    ? [titleRow, [], pesoRow, nameRow, ...dataRows]
    : [titleRow, [], nameRow, ...dataRows]
  const ws = XLSX.utils.aoa_to_sheet(allRows)
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } }]
  ws['!cols'] = [{ wch: 4 }, { wch: 42 }, ...Array(totalCols - 2).fill({ wch: 10 })]
  ws['!rows'] = [{ hpt: 22 }, {}, { hpt: 18 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `Parcial ${parcial}`)
  const safeName = subjectDisplayName(subject).replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim().replace(/\s+/g, '_')
  XLSX.writeFile(wb, `calificaciones_parcial${parcial}_${safeName}.xlsx`)
}

export function exportSubjectGrades({
  subject,
  activities,
  students,
  submissions,
}) {
  const PARCIALES = Array.from({ length: subject.parciales || 3 }, (_, i) => i + 1)

  const FIXED = 2
  // Drafts are excluded — same as the on-screen grades table
  const parcialMeta = PARCIALES.map((p) => {
    const acts = activities
      .filter((a) => a.parcial === p && !isDraftActivity(a))
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    return { p, acts, cols: acts.length + 1 }
  })

  const gradeCols = FIXED + parcialMeta.reduce((s, m) => s + m.cols, 0) + 1
  const totalCols = gradeCols

  // Row 0: Title
  const titleRow = Array(totalCols).fill('')
  const periodo = subjectPeriodLabel(subject)
  titleRow[0] = periodo ? `${subjectDisplayName(subject)}   (${periodo})` : subjectDisplayName(subject)

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

  // PONDERACIÓN row — mirrors the on-screen weights strip (no buttons).
  // Per-parcial: parciales without ponderación show blanks in this row.
  const anyPond = PARCIALES.some((p) => ponderacionActivaEnParcial(subject, p))
  const pesoRowFull = ['', 'PONDERACIÓN']
  if (anyPond) {
    PARCIALES.forEach((p, pi) => {
      const { acts } = parcialMeta[pi]
      if (!ponderacionActivaEnParcial(subject, p)) {
        acts.forEach(() => pesoRowFull.push(''))
        pesoRowFull.push('')
        return
      }
      let totalPesos = 0
      acts.forEach((a) => { const w = pesoDe(a); totalPesos += w; pesoRowFull.push(w) })
      pesoRowFull.push(parseFloat(totalPesos.toFixed(2)))
    })
    pesoRowFull.push('')
  }

  // Row 3: Column names — activities as their number only (1.1, 1.2…)
  const nameRow = ['#', 'NOMBRE']
  PARCIALES.forEach((p, pi) => {
    const { acts } = parcialMeta[pi]
    acts.forEach((a, ai) => nameRow.push(`${p}.${ai + 1}.`))
    nameRow.push(`Prom. P${p}`)
  })
  nameRow.push('Promedio Final')

  // Data rows
  const sorted = [...students].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  const dataRows = sorted.map((s) => {
    const row = [s.orden, studentFullName(s)]
    const finalGrades = []

    PARCIALES.forEach((p, pi) => {
      const { acts } = parcialMeta[pi]
      const parGrades = []
      acts.forEach((a) => {
        const sub = submissions.find(
          (sub) => sub.alumnoId === s.id && sub.actividadId === a.id
        )
        const norm = normalizeGrade(sub?.calificacion, a.maxCalif, { decimals: 2 })
        row.push(norm !== null ? norm : '')
        parGrades.push(norm)
      })
      const rawAvg = promedioParcial(acts, parGrades, ponderacionActivaEnParcial(subject, p))
      const parAvg = rawAvg !== null ? parseFloat(rawAvg.toFixed(2)) : ''
      row.push(parAvg)
      if (parAvg !== '') finalGrades.push(parAvg)
    })

    const final = finalGrades.length
      ? parseFloat((finalGrades.reduce((a, b) => a + b, 0) / finalGrades.length).toFixed(2))
      : ''
    row.push(final)

    return row
  })

  const allRows = anyPond
    ? [titleRow, [], sectionRow, pesoRowFull, nameRow, ...dataRows]
    : [titleRow, [], sectionRow, nameRow, ...dataRows]
  const ws = XLSX.utils.aoa_to_sheet(allRows)

  // Merges: title spans all + each parcial header
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    ...PARCIALES.map((p) => ({
      s: { r: 2, c: parcialRanges[p].start },
      e: { r: 2, c: parcialRanges[p].end },
    })),
  ]
  ws['!merges'] = merges

  ws['!cols'] = [
    { wch: 4 },
    { wch: 42 },
    ...Array(gradeCols - FIXED).fill({ wch: 10 }),
  ]
  ws['!rows'] = [{ hpt: 22 }, {}, { hpt: 18 }, { hpt: 18 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Calificaciones')
  const safeName = subjectDisplayName(subject).replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim().replace(/\s+/g, '_')
  XLSX.writeFile(wb, `calificaciones_${safeName}.xlsx`)
}

// ── Asistencia — un botón por número (1 = asistió o justificó, 0 = faltó,
// igual que countPresence): una columna por sesión (slot) tomada tal cual de
// la tabla en pantalla, más Asist./Faltas por parcial (igual que las columnas
// verde/roja que ya se ven ahí). `attendanceParciales` = el mismo dato que ya
// arma SubjectPage.jsx para pintar la tabla (uno por parcial CON días
// registrados — no hace falta filtrar de nuevo aquí).
function attendanceColumnHeaders(days) {
  const headers = []
  days.forEach(({ fecha, records }) => {
    const { dia, mes } = fmtAttDateParts(fecha)
    records.forEach((r) => {
      headers.push(records.length > 1 ? `${dia}-${mes} (${r.slot})` : `${dia}-${mes}`)
    })
  })
  return headers
}

function attendanceRowCells(days, studentId) {
  const cells = []
  days.forEach(({ records }) => {
    records.forEach((r) => {
      cells.push(attendanceState(r, studentId) === 'falta' ? 0 : 1)
    })
  })
  return cells
}

export function exportParcialAttendance({ subject, students, attendanceParciales, parcial }) {
  const g = attendanceParciales.find((x) => x.parcial === parcial)
  const days = g?.days || []
  const dayHeaders = attendanceColumnHeaders(days)
  const FIXED = 2
  const totalCols = FIXED + dayHeaders.length + 2

  const titleRow = Array(totalCols).fill('')
  const periodo = subjectPeriodLabel(subject)
  titleRow[0] = `${subjectDisplayName(subject)} — Asistencia · Parcial ${parcial}${periodo ? `   (${periodo})` : ''}`

  const nameRow = ['#', 'NOMBRE', ...dayHeaders, 'Asist.', 'Faltas']

  const sorted = [...students].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  const dataRows = sorted.map((s) => {
    const row = [s.orden, studentFullName(s)]
    row.push(...attendanceRowCells(days, s.id))
    const { asist, inasist } = countPresence(g?.records || [], s.id)
    row.push(asist, inasist)
    return row
  })

  const allRows = [titleRow, [], nameRow, ...dataRows]
  const ws = XLSX.utils.aoa_to_sheet(allRows)
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } }]
  ws['!cols'] = [{ wch: 4 }, { wch: 42 }, ...Array(totalCols - FIXED).fill({ wch: 9 })]
  ws['!rows'] = [{ hpt: 22 }, {}, { hpt: 18 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `Parcial ${parcial}`)
  const safeName = subjectDisplayName(subject).replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim().replace(/\s+/g, '_')
  XLSX.writeFile(wb, `asistencia_parcial${parcial}_${safeName}.xlsx`)
}

export function exportSubjectAttendance({ subject, students, attendanceParciales }) {
  const FIXED = 2
  const parcialMeta = attendanceParciales.map((g) => {
    const dayHeaders = attendanceColumnHeaders(g.days)
    return { ...g, dayHeaders, cols: dayHeaders.length + 2 }
  })

  const totalCols = FIXED + parcialMeta.reduce((s, m) => s + m.cols, 0) + 2

  const titleRow = Array(totalCols).fill('')
  const periodo = subjectPeriodLabel(subject)
  titleRow[0] = periodo ? `${subjectDisplayName(subject)} — Asistencia   (${periodo})` : `${subjectDisplayName(subject)} — Asistencia`

  const sectionRow = Array(totalCols).fill('')
  let col = FIXED
  const parcialRanges = {}
  parcialMeta.forEach((m) => {
    parcialRanges[m.parcial] = { start: col, end: col + m.cols - 1 }
    sectionRow[col] = `PARCIAL ${m.parcial}`
    col += m.cols
  })
  sectionRow[col] = 'TOTAL'

  const nameRow = ['#', 'NOMBRE']
  parcialMeta.forEach((m) => { nameRow.push(...m.dayHeaders, 'Asist.', 'Faltas') })
  nameRow.push('Total Asist.', 'Total Faltas')

  const sorted = [...students].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  const dataRows = sorted.map((s) => {
    const row = [s.orden, studentFullName(s)]
    let totalAsist = 0
    let totalInasist = 0
    parcialMeta.forEach((m) => {
      row.push(...attendanceRowCells(m.days, s.id))
      const { asist, inasist } = countPresence(m.records, s.id)
      row.push(asist, inasist)
      totalAsist += asist
      totalInasist += inasist
    })
    row.push(totalAsist, totalInasist)
    return row
  })

  const allRows = [titleRow, [], sectionRow, nameRow, ...dataRows]
  const ws = XLSX.utils.aoa_to_sheet(allRows)

  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    ...parcialMeta.map((m) => ({
      s: { r: 2, c: parcialRanges[m.parcial].start },
      e: { r: 2, c: parcialRanges[m.parcial].end },
    })),
  ]
  ws['!merges'] = merges
  ws['!cols'] = [{ wch: 4 }, { wch: 42 }, ...Array(totalCols - FIXED).fill({ wch: 9 })]
  ws['!rows'] = [{ hpt: 22 }, {}, { hpt: 18 }, { hpt: 18 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Asistencia')
  const safeName = subjectDisplayName(subject).replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim().replace(/\s+/g, '_')
  XLSX.writeFile(wb, `asistencia_${safeName}.xlsx`)
}
