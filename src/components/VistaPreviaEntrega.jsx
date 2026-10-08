import { useEffect, useRef, useState } from 'react'
import PdfCanvasPreview from './PdfCanvasPreview'
import ZoomableImage from './ZoomableImage'

// Vista previa de lo que el estudiante eligió, ANTES de entregar. Todo ocurre
// en el navegador con el archivo local (URL de objeto): no se sube nada y no
// se crea ninguna entrega. La entrega real la hace handleUpload al confirmar.
//
// · Imágenes → miniatura que se amplía al tocarla (ZoomableImage).
// · PDF      → visor propio (pdf.js), todas las páginas con scroll.
// · DOCX     → docx-preview, cargado solo si hace falta.
// · DOC      → binario antiguo: ningún visor de navegador lo abre. Se avisa
//              y el archivo se entrega igual, sin tocarlo.
// · Otros    → sin vista previa (PowerPoint, Excel, ZIP): el aviso lo dice.

const ext = (f) => (f.name.split('.').pop() || '').toLowerCase()
const esImagen = (f) => (f.type || '').startsWith('image/') || /^(jpe?g|png|webp|gif|heic|heif)$/.test(ext(f))
const esPdf = (f) => f.type === 'application/pdf' || ext(f) === 'pdf'
const esDocx = (f) => ext(f) === 'docx'
const esDoc = (f) => ext(f) === 'doc'

function useObjectUrl(file) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    const u = URL.createObjectURL(file)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- la URL de objeto se crea y se libera junto con el archivo
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return url
}

function Aviso({ children }) {
  return (
    <p className="text-xs text-muted bg-surface rounded border border-outline-variant px-3 py-2">{children}</p>
  )
}

function VistaImagen({ file }) {
  const url = useObjectUrl(file)
  if (!url) return null
  return (
    <ZoomableImage
      src={url}
      alt={file.name}
      className="block w-full"
      imgClassName="w-full max-h-72 object-contain rounded border border-outline-variant bg-surface"
    />
  )
}

function VistaDocx({ file }) {
  const ref = useRef(null)
  const [estado, setEstado] = useState('cargando') // cargando | listo | error
  useEffect(() => {
    let cancelado = false
    const cont = ref.current
    ;(async () => {
      try {
        const { renderAsync } = await import('docx-preview')
        if (cancelado || !cont) return
        cont.innerHTML = ''
        await renderAsync(file, cont, undefined, { inWrapper: true, ignoreWidth: true, ignoreHeight: true })
        if (!cancelado) setEstado('listo')
      } catch {
        if (!cancelado) setEstado('error')
      }
    })()
    return () => { cancelado = true; if (cont) cont.innerHTML = '' }
  }, [file])

  return (
    <>
      {estado === 'error' && <Aviso>No se pudo mostrar la vista previa de este documento. Puedes entregarlo de todos modos.</Aviso>}
      {estado === 'cargando' && <p className="text-xs text-muted text-center py-2">Cargando vista previa…</p>}
      <div
        ref={ref}
        className={`max-h-[60dvh] overflow-auto rounded border border-outline-variant bg-neutral-100 ${estado === 'error' ? 'hidden' : ''}`}
      />
    </>
  )
}

function VistaPdf({ file }) {
  const url = useObjectUrl(file)
  const [paginas, setPaginas] = useState(null)
  if (!url) return null
  return (
    <div>
      {paginas > 1 && <p className="text-xs text-muted mb-1">{paginas} páginas — desplázate para verlas todas</p>}
      <div className="rounded overflow-hidden border border-outline-variant">
        <PdfCanvasPreview key={url} url={url} nombre={file.name} onCountKnown={setPaginas} />
      </div>
    </div>
  )
}

export default function VistaPreviaEntrega({ files }) {
  if (!files?.length) return null
  return (
    <div className="space-y-3" data-testid="vista-previa-entrega">
      <p className="text-xs font-medium text-muted">Vista previa — revisa tu archivo antes de entregar</p>
      {files.map((f, i) => (
        <div key={`${f.name}-${f.size}-${i}`} className="space-y-1">
          {files.length > 1 && <p className="text-xs text-hint truncate">{i + 1}. {f.name}</p>}
          {esImagen(f) ? <VistaImagen file={f} />
            : esPdf(f) ? <VistaPdf file={f} />
            : esDocx(f) ? <VistaDocx file={f} />
            : esDoc(f) ? <Aviso>Los documentos .doc (formato antiguo de Word) no se pueden mostrar aquí. Tu archivo se entregará tal cual.</Aviso>
            : <Aviso>Este tipo de archivo no tiene vista previa. Se entregará tal cual.</Aviso>}
        </div>
      ))}
    </div>
  )
}
