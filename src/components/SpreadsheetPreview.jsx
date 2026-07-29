import { useState, useEffect, useMemo } from 'react'
import Spinner from './Spinner'

// Vista previa de Excel SIN depender de ningún visor externo (Google y
// Microsoft se probaron y fallaron — ver AttachmentList.jsx). Se descarga el
// archivo nosotros mismos (Cloudinary lo sirve con CORS abierto, verificado)
// y se lee con ExcelJS — no con "xlsx" (SheetJS), que es lo que usaba el
// primer intento de esto: SheetJS en su versión gratuita SOLO lee valores,
// nunca colores, negritas ni anchos de columna (verificado leyendo y
// releyendo un archivo de prueba: !cols volvía `undefined`). Por eso la
// primera versión se veía "genérica" — no había nada de formato que
// preservar, aunque quisiera. ExcelJS sí lee fill/font/ancho de columna
// (mismo paquete que ya usa utils/excel.js para exportar), así que esta
// versión sí muestra el documento como el estudiante lo entregó: colores,
// negritas, celdas combinadas.
//
// El ancho de columna original SÍ se respeta, pero con un mínimo (ver
// COL_MIN_PX): una columna de 3 caracteres con un nombre de 30 letras dentro
// necesita más espacio que el original para poder leerse, aunque eso ya no
// sea "pixel-perfecto" al archivo — leerse bien importa más que la réplica
// exacta.
const COL_MIN_PX = 70
const CHAR_TO_PX = 7.2 // aproximación estándar de Excel: ancho de columna × ancho de "0" en la fuente por defecto

function argbToCss(argb) {
  if (!argb || argb.length < 6) return undefined
  // ExcelJS entrega 8 dígitos (AARRGGBB); nos quedamos con RRGGBB.
  const hex = argb.length === 8 ? argb.slice(2) : argb
  return `#${hex}`
}

function cellText(cell) {
  const v = cell?.value
  if (v == null) return ''
  if (typeof v === 'object') {
    // Fórmulas (.result), texto enriquecido (.richText) o hipervínculos (.text)
    if ('result' in v) return v.result != null ? String(v.result) : ''
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('')
    if ('text' in v) return String(v.text)
    return ''
  }
  return String(v)
}

export default function SpreadsheetPreview({ url, nombre, fill = false }) {
  const [{ workbook, error }, setResult] = useState({ workbook: null, error: null })
  const [activeSheet, setActiveSheet] = useState(0)

  useEffect(() => {
    let cancelado = false
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`No se pudo descargar el archivo (${res.status})`)
        return res.arrayBuffer()
      })
      .then(async (buf) => {
        const ExcelJS = (await import('exceljs')).default
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(buf)
        if (cancelado) return
        setResult({ workbook: wb, error: null })
      })
      .catch((err) => {
        if (cancelado) return
        setResult({ workbook: null, error: err.message })
      })
    return () => { cancelado = true }
  }, [url])

  const sheetNames = useMemo(() => workbook?.worksheets.map((ws) => ws.name) || [], [workbook])

  const grid = useMemo(() => {
    const ws = workbook?.worksheets[activeSheet]
    if (!ws) return null

    // Rango de merges: para no repetir el valor en cada celda combinada
    // (solo la esquina superior-izquierda pinta, las demás se saltan) y para
    // saber cuánto colSpan/rowSpan darle.
    const mergeSpans = new Map() // "row,col" -> { colSpan, rowSpan }
    const mergedAway = new Set() // "row,col" que ya quedaron cubiertas por otra
    for (const range of ws.model.merges || []) {
      const [start, end] = range.split(':')
      const parse = (ref) => {
        const m = ref.match(/^([A-Z]+)(\d+)$/)
        const col = m[1].split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0)
        return { row: Number(m[2]), col }
      }
      const s = parse(start)
      const e = parse(end)
      mergeSpans.set(`${s.row},${s.col}`, { colSpan: e.col - s.col + 1, rowSpan: e.row - s.row + 1 })
      for (let r = s.row; r <= e.row; r++) {
        for (let c = s.col; c <= e.col; c++) {
          if (r === s.row && c === s.col) continue
          mergedAway.add(`${r},${c}`)
        }
      }
    }

    const colCount = ws.columnCount
    const colWidths = Array.from({ length: colCount }, (_, i) => {
      const w = ws.getColumn(i + 1).width
      return Math.max(COL_MIN_PX, Math.round((w || 8.43) * CHAR_TO_PX))
    })

    const rows = []
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells = []
      for (let c = 1; c <= colCount; c++) {
        if (mergedAway.has(`${rowNumber},${c}`)) continue
        const cell = row.getCell(c)
        const span = mergeSpans.get(`${rowNumber},${c}`)
        const fillArgb = cell.fill?.type === 'pattern' && cell.fill.pattern === 'solid'
          ? cell.fill.fgColor?.argb
          : null
        cells.push({
          key: `${rowNumber}-${c}`,
          text: cellText(cell),
          colSpan: span?.colSpan,
          rowSpan: span?.rowSpan,
          bg: argbToCss(fillArgb),
          color: argbToCss(cell.font?.color?.argb),
          bold: !!cell.font?.bold,
          italic: !!cell.font?.italic,
          align: cell.alignment?.horizontal,
        })
      }
      rows.push({ key: rowNumber, cells })
    })

    return { colWidths, rows }
  }, [workbook, activeSheet])

  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 text-slate-400 text-sm p-6 text-center ${fill ? 'h-full' : 'h-[70vh]'}`}>
        <p>No se pudo cargar la vista previa de {nombre}.</p>
        <p className="text-xs">{error}</p>
      </div>
    )
  }

  if (!grid) {
    return (
      <div className={`flex items-center justify-center ${fill ? 'h-full' : 'h-[70vh]'}`}>
        <Spinner size="md" />
      </div>
    )
  }

  return (
    <div className={`flex flex-col ${fill ? 'h-full' : 'max-h-[70vh]'}`}>
      {sheetNames.length > 1 && (
        <div className="flex gap-1 overflow-x-auto px-2 pt-2 pb-1 border-b border-outline-variant flex-shrink-0">
          {sheetNames.map((name, i) => (
            <button
              key={name}
              type="button"
              onClick={() => setActiveSheet(i)}
              className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors ${
                i === activeSheet ? 'bg-accent text-white' : 'bg-surface text-muted hover:bg-[var(--accent-tint)]'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto p-3">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            {grid.colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.key}>
                {row.cells.map((c) => (
                  <td
                    key={c.key}
                    colSpan={c.colSpan}
                    rowSpan={c.rowSpan}
                    className="border border-outline-variant px-2 py-1 align-top break-words"
                    style={{
                      backgroundColor: c.bg,
                      color: c.color,
                      fontWeight: c.bold ? 700 : 400,
                      fontStyle: c.italic ? 'italic' : 'normal',
                      textAlign: c.align,
                    }}
                  >
                    {c.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
