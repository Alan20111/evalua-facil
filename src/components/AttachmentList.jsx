import { useState } from 'react'
import { Download, X, Eye, ExternalLink } from 'lucide-react'
import { getResourceIcon, resourceExtension } from '../utils/resourceTypes'
import { formatFileSize } from '../utils/formatBytes'

const PDF_EXTS = ['pdf']
const OFFICE_EXTS = ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt']
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']

function docsViewerUrl(url) {
  return `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`
}

function FileRow({ f, onRemove, index }) {
  const [open, setOpen] = useState(false)
  const ext = resourceExtension(f.nombre)
  const isPdf = PDF_EXTS.includes(ext)
  const isOffice = OFFICE_EXTS.includes(ext)
  const isImage = IMAGE_EXTS.includes(ext)
  const canView = isPdf || isOffice || isImage
  const { icon: Icon, color } = getResourceIcon(f.nombre)

  return (
    <div className="rounded border border-outline-variant bg-surface-card overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Icon size={18} className={`flex-shrink-0 ${color}`} />
        <span className="text-sm text-on-surface truncate flex-1">{f.nombre}</span>
        <span className="text-xs text-slate-400 flex-shrink-0">
          {f.tamano != null ? formatFileSize(f.tamano) : ''}
        </span>
        {f.url && canView && (
          <button onClick={() => setOpen((v) => !v)}
            className="p-1 text-slate-400 hover:text-accent rounded flex-shrink-0" title="Ver archivo">
            <Eye size={15} />
          </button>
        )}
        {f.url && isOffice && (
          <a href={`https://docs.google.com/viewer?url=${encodeURIComponent(f.url)}`}
            target="_blank" rel="noreferrer" title="Abrir en Google Docs"
            className="p-1 text-slate-400 hover:text-accent rounded flex-shrink-0">
            <ExternalLink size={15} />
          </a>
        )}
        {f.url && (
          <a href={f.url} target="_blank" rel="noreferrer" title="Descargar"
            className="p-1 text-slate-400 hover:text-accent rounded flex-shrink-0">
            <Download size={15} />
          </a>
        )}
        {onRemove && (
          <button type="button" onClick={() => onRemove(index)} title="Quitar"
            className="p-1 text-slate-400 hover:text-red-500 rounded flex-shrink-0">
            <X size={15} />
          </button>
        )}
      </div>

      {open && f.url && (
        <div className="border-t border-outline-variant bg-surface">
          {isImage ? (
            <img src={f.url} alt={f.nombre} className="w-full max-h-[70vh] object-contain" />
          ) : (
            <iframe
              src={isPdf ? docsViewerUrl(f.url) : docsViewerUrl(f.url)}
              title={f.nombre}
              className="w-full h-[70vh]"
              style={{ border: 'none' }}
            />
          )}
        </div>
      )}
    </div>
  )
}

export default function AttachmentList({ files, onRemove, title = 'Archivos adjuntos' }) {
  if (!files || files.length === 0) return null
  const hasTitle = title != null
  return (
    <div className={hasTitle ? 'mt-3 pt-3 border-t border-outline-variant' : ''}>
      {hasTitle && (
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">{title}</p>
      )}
      <div className="space-y-1">
        {files.map((f, i) => (
          <FileRow key={i} f={f} onRemove={onRemove} index={i} />
        ))}
      </div>
    </div>
  )
}
