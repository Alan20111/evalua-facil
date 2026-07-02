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

// Cloudinary stores PDFs uploaded via /auto/upload as /image/upload/ which
// causes browsers to receive the wrong Content-Type. Swapping to /raw/upload/
// makes Cloudinary serve the file with application/pdf so viewers work.
function pdfUrl(url) {
  if (!url) return url
  return url.replace('/image/upload/', '/raw/upload/')
}

function FileRow({ f, onRemove, index }) {
  const [open, setOpen] = useState(false)
  const ext = resourceExtension(f.nombre)
  const isPdf = PDF_EXTS.includes(ext)
  const isOffice = OFFICE_EXTS.includes(ext)
  const isImage = IMAGE_EXTS.includes(ext)
  const canView = isPdf || isOffice || isImage
  const { icon: Icon, color } = getResourceIcon(f.nombre)

  const viewUrl = isPdf ? pdfUrl(f.url) : f.url
  const downloadUrl = isPdf ? pdfUrl(f.url) : f.url

  return (
    <div className="rounded border border-outline-variant bg-surface-card overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Icon size={18} className={`flex-shrink-0 ${color}`} />
        <span className="text-sm text-on-surface truncate flex-1">{f.nombre}</span>
        <span className="text-xs text-slate-400 flex-shrink-0">
          {f.tamano != null ? formatFileSize(f.tamano) : ''}
        </span>
        {f.url && canView && (
          <button type="button" onClick={() => setOpen((v) => !v)}
            className="p-1 text-slate-400 hover:text-accent rounded flex-shrink-0" data-tooltip="Ver archivo">
            <Eye size={15} />
          </button>
        )}
        {f.url && (isPdf || isOffice) && (
          <a href={docsViewerUrl(viewUrl)} target="_blank" rel="noreferrer"
            data-tooltip="Abrir en Google Docs"
            className="p-1 text-slate-400 hover:text-accent rounded flex-shrink-0">
            <ExternalLink size={15} />
          </a>
        )}
        {f.url && (
          <a href={downloadUrl} target="_blank" rel="noreferrer" data-tooltip="Descargar"
            className="p-1 text-slate-400 hover:text-accent rounded flex-shrink-0">
            <Download size={15} />
          </a>
        )}
        {onRemove && (
          <button type="button" onClick={() => onRemove(index)} data-tooltip="Quitar"
            className="p-1 text-slate-400 hover:text-red-500 rounded flex-shrink-0">
            <X size={15} />
          </button>
        )}
      </div>

      {open && f.url && (
        <div className="border-t border-outline-variant bg-surface">
          <FilePreview url={f.url} nombre={f.nombre} />
        </div>
      )}
    </div>
  )
}

// Standalone inline preview for a single file — same renderer FileRow uses.
// Exported so any view (materiales, recursos, entregas) can toggle a preview
// without adopting the whole AttachmentList row UI.
export function FilePreview({ url, nombre }) {
  const ext = resourceExtension(nombre)
  const isPdf = PDF_EXTS.includes(ext)
  const isImage = IMAGE_EXTS.includes(ext)
  const viewUrl = isPdf ? pdfUrl(url) : url
  if (!url) return null
  return isImage ? (
    <img src={url} alt={nombre} className="w-full max-h-[70vh] object-contain" />
  ) : isPdf ? (
    // Use <object> with explicit type so the browser applies application/pdf
    // regardless of what Content-Type the server returns.
    // Falls back to Google Docs Viewer iframe if the browser can't render it.
    <object
      data={viewUrl}
      type="application/pdf"
      className="w-full"
      style={{ height: '70vh', border: 'none' }}
    >
      <iframe
        src={docsViewerUrl(viewUrl)}
        title={`Vista previa: ${nombre}`}
        sandbox="allow-scripts allow-same-origin allow-popups"
        className="w-full h-full"
        style={{ border: 'none' }}
      />
    </object>
  ) : (
    <iframe
      src={docsViewerUrl(viewUrl)}
      title={`Vista previa: ${nombre}`}
      sandbox="allow-scripts allow-same-origin allow-popups"
      className="w-full h-[70vh]"
      style={{ border: 'none' }}
    />
  )
}

// True when FilePreview can render this file inline (image, PDF u Office).
export function canPreviewFile(nombre) {
  const ext = resourceExtension(nombre)
  return PDF_EXTS.includes(ext) || OFFICE_EXTS.includes(ext) || IMAGE_EXTS.includes(ext)
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
          <FileRow key={f.url || `${f.nombre}-${i}`} f={f} onRemove={onRemove} index={i} />
        ))}
      </div>
    </div>
  )
}
