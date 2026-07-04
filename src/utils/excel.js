import * as XLSX from 'xlsx'
import { subjectDisplayName } from './subjectName'
import { subjectPeriodLabel } from './dateRange'
import { promedioParcial } from './ponderacion'

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
          .map((r) => {
            const c0 = String(r[0] ?? '').trim()
            const c1 = String(r[1] ?? '').trim()
            const c2 = String(r[2] ?? '').trim()
            // Backward-compat: old 3-column template (Paterno | Materno | Nombre),
            // where the first cell is a surname (not a list number).
            if (c0 && c1 && c2 && Number.isNaN(Number(c0))) {
              return { apellidoPaterno: c0, apellidoMaterno: c1, nombre: c2 }
            }
            // New template: [#, "Apellido Paterno Apellido Materno Nombre(s)"].
            // The full name is the first cell that has text beyond a plain number.
            const full = c1 || (Number.isNaN(Number(c0)) ? c0 : '')
            return splitFullName(full)
          })
          .filter((s) => s && (s.apellidoPaterno || s.nombre))
        resolve(students)
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsArrayBuffer(file)
  })
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
  const isDraft = (a) => a.oculta && !a.publishedAt && !a.publishAt
  const parcialMeta = PARCIALES.map((p) => {
    const acts = activities
      .filter((a) => a.parcial === p && !isDraft(a))
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

  // Row 3: Column names — activities as their number only (1.1, 1.2…)
  const nameRow = ['#', 'NOMBRE']
  PARCIALES.forEach((p, pi) => {
    const { acts } = parcialMeta[pi]
    acts.forEach((a, ai) => nameRow.push(`${p}.${ai + 1}`))
    nameRow.push(`Prom. P${p}`)
  })
  nameRow.push('Promedio Final')

  // Data rows
  const sorted = [...students].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  const dataRows = sorted.map((s) => {
    const row = [s.orden, [s.apellidoPaterno, s.apellidoMaterno, s.nombre].filter(Boolean).join(' ')]
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
          parGrades.push(null)
        }
      })
      const rawAvg = promedioParcial(acts, parGrades, !!subject.ponderacionActivada)
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

  const allRows = [titleRow, [], sectionRow, nameRow, ...dataRows]
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
