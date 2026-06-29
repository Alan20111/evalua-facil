import { Download, X } from 'lucide-react'
import { getResourceIcon } from '../utils/resourceTypes'
import { formatFileSize } from '../utils/formatBytes'

// Read-only-by-default list of attached files (icon by extension, name, size,
// download link) — shared by the rich-text editor's "Archivos adjuntos"
// block (docente, with a remove button) and the plain instructions display
// (docente's "Evaluación de alumnos" screen and the student's activity view,
// both read-only: pass no `onRemove`).
export default function AttachmentList({ files, onRemove, title = 'Archivos adjuntos' }) {
  if (!files || files.length === 0) return null
  return (
    <div className="mt-3 pt-3 border-t border-outline-variant">
      <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">{title}</p>
      <div className="space-y-1">
        {files.map((f, i) => {
          const { icon: Icon, color } = getResourceIcon(f.nombre)
          return (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded border border-outline-variant bg-surface-card">
              <Icon size={18} className={`flex-shrink-0 ${color}`} />
              <span className="text-sm text-on-surface truncate flex-1">{f.nombre}</span>
              <span className="text-xs text-slate-400 flex-shrink-0">
                {f.tamano != null ? formatFileSize(f.tamano) : 'Pendiente de guardar'}
              </span>
              {f.url && (
                <a href={f.url} target="_blank" rel="noreferrer" title="Descargar"
                  className="p-1 text-slate-400 hover:text-accent rounded flex-shrink-0">
                  <Download size={16} />
                </a>
              )}
              {onRemove && (
                <button type="button" onClick={() => onRemove(i)} title="Quitar"
                  className="p-1 text-slate-400 hover:text-red-500 rounded flex-shrink-0">
                  <X size={15} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
