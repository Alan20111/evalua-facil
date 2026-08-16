import * as XLSX from 'xlsx'
import { subjectDisplayName } from './subjectName'
import { subjectPeriodLabel } from './dateRange'
import { promedioParcial, pesoDe, ponderacionActivaEnParcial, normalizeGrade } from './ponderacion'
import { attendanceState, countPresence, fmtAttDateParts, enrolledFromDate } from './attendance'
import { studentFullName } from './studentSearch'
import { cuentaParaCalificacion } from './activityVisibility'
import { saveBlob } from './exportGuard'
// Plantilla en blanco (sin datos reales que "llevarse") — exenta a propósito
// del candado de descarga en trial, ver exportGuard.js.
import { saveBlob as saveBlobSinCandado } from './nativeSave'
import { addExcelWatermarkIfNeeded } from './exportWatermark'
import { membreteLinea } from './membrete'
import { estadoEvaluacionLabel } from './evaluacionGrading'
import {
  esGraficable, filasDeReactivo, totalRespuestas, textoRespuestaAlumno, aciertosDeAlumno,
} from './evaluacionRespuestas'

// Fecha y hora de un Timestamp de Firestore, ya como texto para una celda —
// se escribe como texto (y no como fecha de Excel) para que se vea igual que
// en pantalla sin depender del formato regional de quien abra el archivo.
function fechaHoraCell(ts) {
  if (!ts?.seconds) return ''
  return new Date(ts.seconds * 1000).toLocaleString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

// Minutos entre dos Timestamps — cuánto tardó el estudiante en resolverlo.
function minutosEntre(inicio, fin) {
  if (!inicio?.seconds || !fin?.seconds) return ''
  return Math.max(0, Math.round((fin.seconds - inicio.seconds) / 60))
}

// Leyenda de "Versión de evaluación" para el docente en periodo de prueba —
// pedido explícito, ver src/utils/exportWatermark.js (que también pone la
// marca gráfica, ver addExcelWatermarkIfNeeded). Migradas de `xlsx` a
// `exceljs` porque la librería `xlsx` (SheetJS free) usada antes no tiene
// ninguna API para insertar imágenes (esa función es exclusiva de su build
// de paga) — `exceljs` sí soporta imágenes (ver downloadStudentTemplate).
const WATERMARK_LEGEND = 'Este archivo fue generado con Evalúa Fácil (Versión de evaluación) · evaluafacil.mx'

function safeExcelName(subject) {
  return subjectDisplayName(subject).replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim().replace(/\s+/g, '_')
}

// Arma una hoja a partir de un arreglo de arreglos (mismo modelo que se usaba
// con XLSX.utils.aoa_to_sheet), aplicando merges/anchos/alturas — mantiene el
// resto del archivo con la misma forma de construir tablas que antes.
function addSheetFromRows(workbook, sheetName, rows, { merges = [], colWidths = [], rowHeights = [] } = {}) {
  const ws = workbook.addWorksheet(sheetName)
  if (colWidths.length) ws.columns = colWidths.map((width) => ({ width }))
  rows.forEach((r) => ws.addRow(r))
  merges.forEach(([r1, c1, r2, c2]) => ws.mergeCells(r1, c1, r2, c2))
  rowHeights.forEach(([r, h]) => { ws.getRow(r).height = h })
  return ws
}

async function finalizeWorkbook(workbook, filename, watermark) {
  await addExcelWatermarkIfNeeded(workbook, watermark)
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  await saveBlob(blob, filename)
}

// Todas las hojas de abajo dejan un renglón vacío entre el título y los
// encabezados de columna — se reutiliza ESE mismo renglón para la leyenda en
// vez de insertar uno nuevo, así ningún merge que apunte a números de fila
// fijos (título en fila 1, secciones en fila 3, etc.) se corre.
function spacerRow(watermark) {
  return watermark ? [WATERMARK_LEGEND] : []
}

// Los tres renglones con que abre TODA hoja exportada:
//   1  Cultura Digital I — 1A   (Ago 2025 – Ene 2026)   ← título del reporte
//   2  CBTIS 255 · Docente: Ing. Ana Ruiz               ← membrete
//   3  (separador; en periodo de prueba, la leyenda de marca de agua)
// Siempre son TRES, aunque el docente no tenga escuela o el membrete venga
// vacío: los encabezados de columna quedan en la fila 4 y los datos en la 5 en
// todas las hojas, así que los merges y los altos de fila no tienen que
// calcularse caso por caso.
const HEADER_ROWS = 3
function headerRows(titulo, membrete, watermark, totalCols) {
  const titleRow = Array(totalCols).fill('')
  titleRow[0] = titulo
  const membreteRow = Array(totalCols).fill('')
  membreteRow[0] = membreteLinea(membrete)
  return [titleRow, membreteRow, spacerRow(watermark)]
}

// Merges de esos dos renglones de texto (título y membrete) a lo ancho de la
// hoja — van juntos en todas las exportaciones.
function headerMerges(totalCols) {
  return [[1, 1, 1, totalCols], [2, 1, 2, totalCols]]
}

// Loaded dynamically (only when actually downloading the template) because
// it's needed for one feature `xlsx` can't do: writing real sheet protection
// so Excel itself blocks editing outside columns A/B — `xlsx` (the free
// SheetJS build used elsewhere in this file for reading uploaded rosters) can
// only read protection, not write it.
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
  await saveBlobSinCandado(blob, 'plantilla-estudiantes.xlsx')
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
          // Se exigen AMBOS apellido paterno y nombre — una fila con una sola
          // palabra (ej. solo "García") pasaba antes como válida porque el
          // apellido solo ya era suficiente, y terminaba generando una cuenta
          // con username roto (generateUsername cae a "x" cuando el nombre
          // viene vacío: "garcia.x").
          if (student && student.apellidoPaterno && student.nombre) {
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
export async function exportRankingExcel({ subject, rows, label, membrete = null, watermark = false }) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()

  const periodo = subjectPeriodLabel(subject)
  const titulo = `${subjectDisplayName(subject)} — Ranking · ${label}${periodo ? `   (${periodo})` : ''}`
  const nameRow = ['LUGAR', 'NOMBRE', label]
  const dataRows = rows.map((r) => [r.lugar, r.nombre, r.promedio != null ? r.promedio : '—'])
  const allRows = [...headerRows(titulo, membrete, watermark, 3), nameRow, ...dataRows]

  addSheetFromRows(workbook, 'Ranking', allRows, {
    merges: headerMerges(3),
    colWidths: [7, 42, 14],
    rowHeights: [[1, 22], [HEADER_ROWS + 1, 18]],
  })

  const safeName = safeExcelName(subject)
  const safeLabel = label.toLowerCase().replace(/\s+/g, '')
  await finalizeWorkbook(workbook, `ranking_${safeLabel}_${safeName}.xlsx`, watermark)
}

export async function exportParcialGrades({ subject, activities, students, submissions, parcial, membrete = null, watermark = false }) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()

  const acts = activities
    .filter((a) => a.parcial === parcial && cuentaParaCalificacion(a))
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))

  const totalCols = 2 + acts.length + 1

  const periodo = subjectPeriodLabel(subject)
  const titulo = `${subjectDisplayName(subject)} — Parcial ${parcial}${periodo ? `   (${periodo})` : ''}`

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
      return normalizeGrade(sub?.calificacion, a.maxCalif, { decimals: 1 })
    })
    grades.forEach((g) => row.push(g !== null ? g : ''))
    const rawAvg = promedioParcial(acts, grades, pondOn)
    row.push(rawAvg !== null ? parseFloat(rawAvg.toFixed(1)) : '')
    return row
  })

  const cabecera = headerRows(titulo, membrete, watermark, totalCols)
  const allRows = pondOn
    ? [...cabecera, pesoRow, nameRow, ...dataRows]
    : [...cabecera, nameRow, ...dataRows]

  addSheetFromRows(workbook, `Parcial ${parcial}`, allRows, {
    merges: headerMerges(totalCols),
    colWidths: [4, 42, ...Array(totalCols - 2).fill(10)],
    rowHeights: [[1, 22], [HEADER_ROWS + 1, 18]],
  })

  const safeName = safeExcelName(subject)
  await finalizeWorkbook(workbook, `calificaciones_parcial${parcial}_${safeName}.xlsx`, watermark)
}

export async function exportSubjectGrades({
  subject,
  activities,
  students,
  submissions,
  membrete = null,
  watermark = false,
}) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()

  const PARCIALES = Array.from({ length: subject.parciales || 3 }, (_, i) => i + 1)

  const FIXED = 2
  // Drafts are excluded — same as the on-screen grades table
  const parcialMeta = PARCIALES.map((p) => {
    const acts = activities
      .filter((a) => a.parcial === p && cuentaParaCalificacion(a))
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    return { p, acts, cols: acts.length + 1 }
  })

  const gradeCols = FIXED + parcialMeta.reduce((s, m) => s + m.cols, 0) + 1
  const totalCols = gradeCols

  // Row 1: Title
  const periodo = subjectPeriodLabel(subject)
  const titulo = periodo ? `${subjectDisplayName(subject)}   (${periodo})` : subjectDisplayName(subject)

  // Row 4: Section headers (después de los tres renglones de encabezado)
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

  // Row 4: Column names — activities as their number only (1.1, 1.2…)
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
        const norm = normalizeGrade(sub?.calificacion, a.maxCalif, { decimals: 1 })
        row.push(norm !== null ? norm : '')
        parGrades.push(norm)
      })
      const rawAvg = promedioParcial(acts, parGrades, ponderacionActivaEnParcial(subject, p))
      const parAvg = rawAvg !== null ? parseFloat(rawAvg.toFixed(1)) : ''
      row.push(parAvg)
      if (parAvg !== '') finalGrades.push(parAvg)
    })

    const final = finalGrades.length
      ? parseFloat((finalGrades.reduce((a, b) => a + b, 0) / finalGrades.length).toFixed(1))
      : ''
    row.push(final)

    return row
  })

  const cabecera = headerRows(titulo, membrete, watermark, totalCols)
  const allRows = anyPond
    ? [...cabecera, sectionRow, pesoRowFull, nameRow, ...dataRows]
    : [...cabecera, sectionRow, nameRow, ...dataRows]

  // Merges: los dos renglones de texto del encabezado + el nombre de cada
  // parcial sobre sus columnas (la fila de secciones va justo después).
  const SECTION_ROW = HEADER_ROWS + 1
  const merges = [
    ...headerMerges(totalCols),
    ...PARCIALES.map((p) => [SECTION_ROW, parcialRanges[p].start + 1, SECTION_ROW, parcialRanges[p].end + 1]),
  ]

  addSheetFromRows(workbook, 'Calificaciones', allRows, {
    merges,
    colWidths: [4, 42, ...Array(gradeCols - FIXED).fill(10)],
    rowHeights: [[1, 22], [SECTION_ROW, 18], [SECTION_ROW + 1, 18]],
  })

  const safeName = safeExcelName(subject)
  await finalizeWorkbook(workbook, `calificaciones_${safeName}.xlsx`, watermark)
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

// `enrolledFrom` ('YYYY-MM-DD', opcional): días anteriores al alta del
// alumno se dejan en blanco en vez de 0/1 — no aplica, no es una falta.
function attendanceRowCells(days, studentId, enrolledFrom) {
  const cells = []
  days.forEach(({ fecha, records }) => {
    records.forEach((r) => {
      if (enrolledFrom && fecha < enrolledFrom) { cells.push(''); return }
      cells.push(attendanceState(r, studentId) === 'falta' ? 0 : 1)
    })
  })
  return cells
}

// Resultados de UN cuestionario/examen — el gemelo en Excel de
// exportEvaluacionResultadosPDF. Cuatro hojas, porque son cuatro preguntas
// distintas que el docente le hace a los mismos datos:
//   Resumen        — las métricas del panel de análisis, tal cual.
//   Calificaciones — una fila por estudiante: estado, calificación, aciertos,
//                    a qué hora entregó y cuánto tardó.
//   Respuestas     — la matriz completa: qué contestó cada quien en cada
//                    reactivo (aquí se ve el patrón que ninguna gráfica
//                    muestra: quién copió a quién, dónde se atoró el grupo).
//   Por reactivo   — el resumen por opción, el mismo del PDF y las gráficas.
export async function exportEvaluacionResultadosExcel({
  activity, subject, students, submissions, preguntas, counts, porAlumno, stats, hasManual = false,
  membrete = null, watermark = false,
}) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()

  const maxCalif = activity.maxCalif || 10
  const esExamen = activity.categoria === 'examen'
  const periodo = subjectPeriodLabel(subject)
  const tituloBase = `${subjectDisplayName(subject)} — ${esExamen ? 'Examen' : 'Cuestionario'}: ${activity.nombre || ''}`
  const titulo = periodo ? `${tituloBase}   (${periodo})` : tituloBase
  const sorted = [...students].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  const graficables = (preguntas || []).filter(esGraficable)

  // ── Hoja 1: Resumen ──
  const entregas = Object.values(submissions || {}).filter((s) => s?.estadoEvaluacion === 'finalizado').length
  addSheetFromRows(workbook, 'Resumen', [
    ...headerRows(titulo, membrete, watermark, 2),
    ['MÉTRICA', 'VALOR'],
    ['Promedio', stats?.promedio ?? 0],
    ['Calificación máxima', stats?.maxima ?? 0],
    ['Calificación mínima', stats?.minima ?? 0],
    ['Escala', `sobre ${maxCalif}`],
    ['% de aprobación', `${stats?.porcentajeAprobados ?? 0}%`],
    ['Total de estudiantes', students.length],
    ['Total de entregas', entregas],
    ['Total pendientes', students.length - entregas],
    ['Reactivos', (preguntas || []).length],
  ], { merges: headerMerges(2), colWidths: [30, 26], rowHeights: [[1, 22], [HEADER_ROWS + 1, 18]] })

  // ── Hoja 2: Calificaciones ──
  const califHead = ['#', 'NOMBRE', 'ESTADO', 'CALIFICACIÓN', `ACIERTOS (de ${graficables.length})`, 'ENTREGADO', 'DURACIÓN (min)', 'INTENTO']
  const califRows = sorted.map((s) => {
    const sub = submissions?.[s.id]
    const done = sub?.estadoEvaluacion === 'finalizado'
    const aciertos = aciertosDeAlumno(preguntas, porAlumno?.[s.id])
    return [
      s.orden,
      studentFullName(s),
      estadoEvaluacionLabel(sub, hasManual),
      done && sub.calificacion != null ? sub.calificacion : '',
      aciertos && done ? aciertos.correctas : '',
      fechaHoraCell(sub?.fechaEntrega),
      minutosEntre(sub?.tiempoInicio, sub?.fechaEntrega),
      done ? (sub.intentoActual || 1) : '',
    ]
  })
  addSheetFromRows(workbook, 'Calificaciones', [
    ...headerRows(titulo, membrete, watermark, califHead.length), califHead, ...califRows,
  ], {
    merges: headerMerges(califHead.length),
    colWidths: [4, 42, 15, 14, 16, 20, 15, 9],
    rowHeights: [[1, 22], [HEADER_ROWS + 1, 18]],
  })

  // ── Hoja 3: Respuestas (matriz estudiante × reactivo) ──
  const respHead = ['#', 'NOMBRE', ...(preguntas || []).map((p, i) => `${i + 1}. ${p.enunciado || ''}`)]
  const respRows = sorted.map((s) => [
    s.orden,
    studentFullName(s),
    ...(preguntas || []).map((p) => textoRespuestaAlumno(p, porAlumno?.[s.id]?.[p.id])),
  ])
  addSheetFromRows(workbook, 'Respuestas', [
    ...headerRows(titulo, membrete, watermark, respHead.length), respHead, ...respRows,
  ], {
    merges: headerMerges(respHead.length),
    colWidths: [4, 42, ...(preguntas || []).map(() => 30)],
    rowHeights: [[1, 22], [HEADER_ROWS + 1, 18]],
  })

  // ── Hoja 4: Por reactivo ──
  const porReactivo = [...headerRows(titulo, membrete, watermark, 4)]
  if (!graficables.length) {
    porReactivo.push(['Este cuestionario/examen no tiene reactivos de opción múltiple ni de verdadero/falso.'])
  }
  graficables.forEach((p, i) => {
    const preguntaCounts = counts?.[p.id] || {}
    const total = totalRespuestas(preguntaCounts)
    porReactivo.push([`${i + 1}. ${p.enunciado || ''}`])
    // La sección viaja en el propio reactivo: es lo que permitirá, más
    // adelante, agrupar resultados por sección o por aprendizaje sin cruzar
    // con la configuración de la actividad.
    if (p.seccionNombre) porReactivo.push([`Sección: ${p.seccionNombre}`])
    porReactivo.push([`${total} ${total === 1 ? 'respuesta' : 'respuestas'} en total`])
    porReactivo.push(['OPCIÓN', 'CORRECTA', 'RESPUESTAS', 'PORCENTAJE'])
    filasDeReactivo(p, preguntaCounts).forEach((f) => {
      porReactivo.push([f.texto, f.correcta ? 'Sí' : '', f.count, `${f.pct}%`])
    })
    porReactivo.push([])
  })
  addSheetFromRows(workbook, 'Por reactivo', porReactivo, {
    merges: headerMerges(4),
    colWidths: [60, 11, 13, 13],
    rowHeights: [[1, 22], [HEADER_ROWS + 1, 18]],
  })

  const safeActivity = (activity.nombre || 'evaluacion')
    .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim().replace(/\s+/g, '_') || 'evaluacion'
  await finalizeWorkbook(workbook, `resultados_${safeActivity}_${safeExcelName(subject)}.xlsx`, watermark)
}

export async function exportParcialAttendance({ subject, students, attendanceParciales, parcial, membrete = null, watermark = false }) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()

  const g = attendanceParciales.find((x) => x.parcial === parcial)
  const days = g?.days || []
  const dayHeaders = attendanceColumnHeaders(days)
  const FIXED = 2
  const totalCols = FIXED + dayHeaders.length + 2

  const periodo = subjectPeriodLabel(subject)
  const titulo = `${subjectDisplayName(subject)} — Asistencia · Parcial ${parcial}${periodo ? `   (${periodo})` : ''}`

  const nameRow = ['#', 'NOMBRE', ...dayHeaders, 'Asist.', 'Faltas']

  const sorted = [...students].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  const dataRows = sorted.map((s) => {
    const enrolledFrom = enrolledFromDate(s)
    const row = [s.orden, studentFullName(s)]
    row.push(...attendanceRowCells(days, s.id, enrolledFrom))
    const { asist, inasist } = countPresence(g?.records || [], s.id, enrolledFrom)
    row.push(asist, inasist)
    return row
  })

  const allRows = [...headerRows(titulo, membrete, watermark, totalCols), nameRow, ...dataRows]

  addSheetFromRows(workbook, `Parcial ${parcial}`, allRows, {
    merges: headerMerges(totalCols),
    colWidths: [4, 42, ...Array(totalCols - FIXED).fill(9)],
    rowHeights: [[1, 22], [HEADER_ROWS + 1, 18]],
  })

  const safeName = safeExcelName(subject)
  await finalizeWorkbook(workbook, `asistencia_parcial${parcial}_${safeName}.xlsx`, watermark)
}

export async function exportSubjectAttendance({ subject, students, attendanceParciales, membrete = null, watermark = false }) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()

  const FIXED = 2
  const parcialMeta = attendanceParciales.map((g) => {
    const dayHeaders = attendanceColumnHeaders(g.days)
    return { ...g, dayHeaders, cols: dayHeaders.length + 2 }
  })

  const totalCols = FIXED + parcialMeta.reduce((s, m) => s + m.cols, 0) + 2

  const periodo = subjectPeriodLabel(subject)
  const titulo = periodo ? `${subjectDisplayName(subject)} — Asistencia   (${periodo})` : `${subjectDisplayName(subject)} — Asistencia`

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
    const enrolledFrom = enrolledFromDate(s)
    const row = [s.orden, studentFullName(s)]
    let totalAsist = 0
    let totalInasist = 0
    parcialMeta.forEach((m) => {
      row.push(...attendanceRowCells(m.days, s.id, enrolledFrom))
      const { asist, inasist } = countPresence(m.records, s.id, enrolledFrom)
      row.push(asist, inasist)
      totalAsist += asist
      totalInasist += inasist
    })
    row.push(totalAsist, totalInasist)
    return row
  })

  const allRows = [...headerRows(titulo, membrete, watermark, totalCols), sectionRow, nameRow, ...dataRows]

  const SECTION_ROW = HEADER_ROWS + 1
  const merges = [
    ...headerMerges(totalCols),
    ...parcialMeta.map((m) => [SECTION_ROW, parcialRanges[m.parcial].start + 1, SECTION_ROW, parcialRanges[m.parcial].end + 1]),
  ]

  addSheetFromRows(workbook, 'Asistencia', allRows, {
    merges,
    colWidths: [4, 42, ...Array(totalCols - FIXED).fill(9)],
    rowHeights: [[1, 22], [SECTION_ROW, 18], [SECTION_ROW + 1, 18]],
  })

  const safeName = safeExcelName(subject)
  await finalizeWorkbook(workbook, `asistencia_${safeName}.xlsx`, watermark)
}
