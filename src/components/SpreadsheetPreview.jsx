import { useState, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import DOMPurify from 'dompurify'
import Spinner from './Spinner'

// Vista previa de Excel SIN depender de ningún visor externo (Google y
// Microsoft se probaron y fallaron — ver AttachmentList.jsx). Se descarga el
// archivo nosotros mismos (Cloudinary lo sirve con CORS abierto, verificado)
// y se convierte a una tabla HTML con SheetJS, la misma librería que el
// proyecto ya usa para exportar calificaciones.
//
// sheet_to_html copia los anchos de columna y alto de fila EXACTOS del Excel
// original en pixeles fijos. Con plantillas decorativas (renglones tipo "hoja
// rayada", columnas angostas) eso dejaba el contenido real apachurrado en una
// esquina y el resto como espacio "vacío" sin sentido fuera de Excel — el bug
// del primer intento. Se descarta TODO estilo/ancho/alto heredado a
// propósito: se prioriza que se lea proporcional al panel, no una réplica
// pixel-perfecta del archivo original.
export default function SpreadsheetPreview({ url, nombre, fill = false }) {
  const [{ wb, error }, setResult] = useState({ wb: null, error: null })
  const [activeSheet, setActiveSheet] = useState(0)

  useEffect(() => {
    let cancelado = false
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`No se pudo descargar el archivo (${res.status})`)
        return res.arrayBuffer()
      })
      .then((buf) => {
        if (cancelado) return
        setResult({ wb: XLSX.read(buf, { type: 'array' }), error: null })
      })
      .catch((err) => {
        if (cancelado) return
        setResult({ wb: null, error: err.message })
      })
    return () => { cancelado = true }
  }, [url])

  const html = useMemo(() => {
    if (!wb) return ''
    const sheetName = wb.SheetNames[activeSheet]
    const sheet = wb.Sheets[sheetName]
    if (!sheet) return ''
    const raw = XLSX.utils.sheet_to_html(sheet, { editable: false })
    // El contenido de las celdas lo escribió el estudiante — se sanitiza
    // igual que cualquier HTML ajeno. FORBID_ATTR es lo que realmente
    // resuelve el bug de columnas apachurradas: sin `style`/`width`/`height`,
    // el navegador dimensiona la tabla por su propia cuenta.
    return DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: ['table', 'thead', 'tbody', 'tr', 'td', 'th', 'br', 'a'],
      ALLOWED_ATTR: ['colspan', 'rowspan', 'href', 'target'],
      FORBID_ATTR: ['style', 'width', 'height'],
    })
  }, [wb, activeSheet])

  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 text-slate-400 text-sm p-6 text-center ${fill ? 'h-full' : 'h-[70vh]'}`}>
        <p>No se pudo cargar la vista previa de {nombre}.</p>
        <p className="text-xs">{error}</p>
      </div>
    )
  }

  if (!wb) {
    return (
      <div className={`flex items-center justify-center ${fill ? 'h-full' : 'h-[70vh]'}`}>
        <Spinner size="md" />
      </div>
    )
  }

  return (
    <div className={`flex flex-col ${fill ? 'h-full' : 'max-h-[70vh]'}`}>
      {wb.SheetNames.length > 1 && (
        <div className="flex gap-1 overflow-x-auto px-2 pt-2 pb-1 border-b border-outline-variant flex-shrink-0">
          {wb.SheetNames.map((name, i) => (
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
      {/* table-auto + w-full: la tabla se dimensiona por su contenido real,
          no por los anchos del Excel original (ya descartados arriba). */}
      <div
        className="flex-1 overflow-auto p-3 text-sm [&_table]:table-auto [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-outline-variant [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_td]:whitespace-normal"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
