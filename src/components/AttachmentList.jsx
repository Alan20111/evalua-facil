import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Download, X, FileSearch, ExternalLink } from 'lucide-react'
import { getResourceIcon, resourceExtension } from '../utils/resourceTypes'
import { formatFileSize } from '../utils/formatBytes'
import { downloadUrl, isImageDeliveredPdf, pdfPageImageUrl } from '../utils/cloudinary'
import { useBackHandler } from '../hooks/useBackHandler'

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

  const isImgPdf = isPdf && isImageDeliveredPdf(f.url)
  const viewUrl = isPdf && !isImgPdf ? pdfUrl(f.url) : f.url
  const downloadHref = downloadUrl(f.url, f.nombre)
  // "Open in a new tab": image-delivered PDFs can't go through Google Docs
  // (their raw URL is blocked), so open page 1 as an image instead.
  const openInTabUrl = isImgPdf
    ? pdfPageImageUrl(f.url, 1)
    : (isPdf || isOffice) ? docsViewerUrl(viewUrl) : null

  return (
    <div className="rounded border border-outline-variant bg-surface-card">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Icon size={18} className={`flex-shrink-0 ${color}`} />
        <span className="text-sm text-on-surface truncate flex-1">{f.nombre}</span>
        <span className="text-xs text-slate-400 flex-shrink-0">
          {f.tamano != null ? formatFileSize(f.tamano) : ''}
        </span>
        {f.url && canView && (
          <button type="button" onClick={() => setOpen(true)} aria-label="Vista previa"
            className="p-1 text-slate-400 hover:text-accent rounded flex-shrink-0" data-tooltip="Vista previa">
            <FileSearch size={15} />
          </button>
        )}
        {f.url && openInTabUrl && (
          <a href={openInTabUrl} target="_blank" rel="noreferrer"
            data-tooltip={isImgPdf ? 'Abrir página 1 en pestaña nueva' : 'Abrir en Google Docs'}
            aria-label={isImgPdf ? 'Abrir página 1 en pestaña nueva' : 'Abrir en Google Docs'}
            className="p-1 text-slate-400 hover:text-accent rounded flex-shrink-0">
            <ExternalLink size={15} />
          </a>
        )}
        {f.url && (
          <a href={downloadHref} download={f.nombre} rel="noreferrer" data-tooltip="Descargar" aria-label="Descargar"
            className="p-1 text-slate-400 hover:text-accent rounded flex-shrink-0">
            <Download size={15} />
          </a>
        )}
        {onRemove && (
          <button type="button" onClick={() => onRemove(index)} data-tooltip="Quitar" aria-label="Quitar"
            className="p-1 text-slate-400 hover:text-red-500 rounded flex-shrink-0">
            <X size={15} />
          </button>
        )}
      </div>

      {open && f.url && (
        <FilePreviewModal url={f.url} nombre={f.nombre} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}

// Standalone inline preview for a single file — same renderer FileRow uses.
// Exported so any view (materiales, recursos, entregas) can toggle a preview
// without adopting the whole AttachmentList row UI.
// `fill` makes the preview take the full height of its container (used by the
// fullscreen grading view); default keeps the inline 70vh behavior.
export function FilePreview({ url, nombre, fill = false }) {
  const ext = resourceExtension(nombre)
  const isPdf = PDF_EXTS.includes(ext)
  const isImage = IMAGE_EXTS.includes(ext)
  const viewUrl = isPdf ? pdfUrl(url) : url
  if (!url) return null
  // PDFs uploaded as an image resource → render their pages as JPGs. This works
  // even when the Cloudinary account has PDF delivery disabled.
  if (isPdf && isImageDeliveredPdf(url)) {
    return <PdfPagesPreview url={url} nombre={nombre} fill={fill} />
  }
  return isImage ? (
    <img src={url} alt={nombre} className={`w-full object-contain ${fill ? 'h-full' : 'max-h-[70vh]'}`} />
  ) : isPdf ? (
    // Use <object> with explicit type so the browser applies application/pdf
    // regardless of what Content-Type the server returns.
    // Falls back to Google Docs Viewer iframe if the browser can't render it.
    <object
      data={viewUrl}
      type="application/pdf"
      className="w-full"
      style={{ height: fill ? '100%' : '70vh', border: 'none' }}
    >
      <iframe
        src={docsViewerUrl(viewUrl)}
        title={`Vista previa: ${nombre}`}
        sandbox="allow-same-origin allow-popups"
        className="w-full h-full"
        style={{ border: 'none' }}
      />
    </object>
  ) : (
    <iframe
      src={docsViewerUrl(viewUrl)}
      title={`Vista previa: ${nombre}`}
      sandbox="allow-same-origin allow-popups"
      className={`w-full ${fill ? 'h-full' : 'h-[70vh]'}`}
      style={{ border: 'none' }}
    />
  )
}

// Renders a PDF (uploaded as an image resource) page by page as JPGs. Loads
// pages progressively: when the last shown page loads, it asks for the next;
// when a page 404s (past the end) it stops. Works with PDF delivery disabled.
function PdfPagesPreview({ url, nombre, fill }) {
  const [count, setCount] = useState(1)
  const [ended, setEnded] = useState(false)
  const [anyLoaded, setAnyLoaded] = useState(false)
  const pages = Array.from({ length: count }, (_, i) => i + 1)
  return (
    <div className={`w-full overflow-auto bg-neutral-800 ${fill ? 'h-full' : 'max-h-[70vh]'}`}>
      {pages.map((p) => (
        <img
          key={p}
          src={pdfPageImageUrl(url, p)}
          alt={`${nombre} — página ${p}`}
          className="w-full block mx-auto mb-1 bg-white"
          onLoad={() => { setAnyLoaded(true); if (p === count && !ended) setCount((c) => c + 1) }}
          onError={(e) => { e.currentTarget.style.display = 'none'; setEnded(true) }}
        />
      ))}
      {ended && !anyLoaded && (
        <div className="text-center text-slate-300 text-sm p-6">
          No se pudo mostrar la vista previa de este PDF.
        </div>
      )}
    </div>
  )
}

// Windowed (modal) preview — opens the file in a centered overlay with a header
// that shows the name, a download button and a close button. Used by materiales
// and recursos in both the teacher and student shells. Distinct from the
// visibility eye (mostrar/ocultar a estudiantes).
export function FilePreviewModal({ url, nombre, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Physical Android back button: both callers (FileRow's internal `open`
  // state and SubjectPage's `previewResourceId`-driven state) only render this
  // component while it's open, so `active=true` mirrors the NuevaFechaEntregaModal pattern.
  useBackHandler(onClose, true)
  if (!url) return null
  const downloadHref = downloadUrl(url, nombre)
  // Image-delivered PDFs can't be opened directly (raw URL blocked) → open the
  // first page as an image instead.
  const openInTabUrl = isImageDeliveredPdf(url) ? pdfPageImageUrl(url, 1) : url
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/50 border-none cursor-default" onClick={onClose} aria-label="Cerrar" />
      <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-outline-variant flex-shrink-0">
          <span className="flex-1 text-sm font-medium text-on-surface truncate">{nombre}</span>
          <a href={openInTabUrl} target="_blank" rel="noreferrer" data-tooltip="Abrir en pestaña nueva" aria-label="Abrir en pestaña nueva"
            className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
            <ExternalLink size={18} />
          </a>
          <a href={downloadHref} download={nombre} rel="noreferrer" data-tooltip="Descargar" aria-label="Descargar"
            className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
            <Download size={18} />
          </a>
          <button type="button" onClick={onClose} data-tooltip="Cerrar" aria-label="Cerrar"
            className="p-2 text-slate-400 hover:text-on-surface hover:bg-surface rounded transition-colors flex-shrink-0">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-surface">
          <FilePreview url={url} nombre={nombre} fill />
        </div>
      </div>
    </div>,
    document.body
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
