import { useState, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import DOMPurify from 'dompurify'
import Spinner from './Spinner'

// Vista previa de Excel SIN depender de ningún visor externo.
//
// Se probaron dos visores de terceros y los dos fallaron en la práctica:
// - Google Docs Viewer: lee el archivo correctamente (su propia respuesta de
//   metadatos trae las celdas) pero devuelve "pages":0 y muestra "No se pudo
//   obtener una vista previa" de todos modos — limitación conocida del visor
//   viejo de Google con hojas de cálculo.
// - Microsoft Office Viewer (view.officeapps.live.com): en la práctica no se
//   ve NADA al incrustarlo — ni siquiera un error. Rechaza mostrarse dentro
//   de un sitio que no es de Microsoft.
//
// La solución robusta: bajar el archivo nosotros mismos (Cloudinary ya lo
// sirve con CORS abierto — verificado) y convertirlo a una tabla HTML con
// SheetJS, la misma librería que el proyecto ya usa para exportar
// calificaciones (ver utils/excel.js). Nada sale hacia Google ni Microsoft.
export default function SpreadsheetPreview({ url, nombre, fill = false }) {
  // wb y error viven en un solo estado (en vez de dos useState separados) para
  // que la carga sea una sola actualización, no dos renders encadenados. No
  // se reinician al cambiar `url` dentro del efecto (eso dispararía
  // react-hooks/set-state-in-effect): en la práctica este componente se monta
  // una vez por archivo, así que no hace falta.
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

  // sheet_to_html trae su propio <table> con estilos inline básicos —
  // sanitizado igual que cualquier HTML que no generamos nosotros mismos,
  // ya que el contenido de las celdas lo escribió el estudiante.
  const html = useMemo(() => {
    if (!wb) return ''
    const sheetName = wb.SheetNames[activeSheet]
    const sheet = wb.Sheets[sheetName]
    if (!sheet) return ''
    const raw = XLSX.utils.sheet_to_html(sheet, { editable: false })
    return DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: ['table', 'thead', 'tbody', 'tr', 'td', 'th', 'br', 'a'],
      ALLOWED_ATTR: ['colspan', 'rowspan', 'style', 'href', 'target'],
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
      <div
        className="flex-1 overflow-auto p-2 text-sm [&_table]:border-collapse [&_td]:border [&_td]:border-outline-variant [&_td]:px-2 [&_td]:py-1"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
