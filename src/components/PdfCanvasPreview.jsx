import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
// `?worker` (no `?url`) para que Vite lo empaquete como Web Worker real — con
// `?url` pdf.js no logra instanciarlo (es un módulo .mjs) y cae en su
// "fake worker" de un solo hilo, mucho más lento y con el riesgo de
// bloquearse en páginas grandes.
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import ZoomableImage from './ZoomableImage'

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker()

// Visor de PDF propio: dibuja cada página a un <canvas> con pdf.js y la
// muestra como imagen dentro de ZoomableImage — el MISMO componente de zoom
// que ya usan las imágenes de entregas (confirmado que funciona por el
// docente). Reemplaza al <object> nativo del navegador porque ese visor
// aísla los eventos táctiles como si fuera un plugin aparte y nunca deja
// pellizcar/acercar.
//
// El caller debe pasar `key={url}` para forzar un remount (y así reiniciar
// `pages`/`error`) cuando cambia el archivo — este componente nunca resetea
// su propio estado dentro del efecto.
export default function PdfCanvasPreview({ url, nombre, fill }) {
  const [pages, setPages] = useState([])
  const [error, setError] = useState(false)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    async function render() {
      try {
        const doc = await pdfjsLib.getDocument(url).promise
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelledRef.current) return
          const page = await doc.getPage(i)
          // Escala 2x para que se vea nítido incluso acercando con el zoom.
          const viewport = page.getViewport({ scale: 2 })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
          if (cancelledRef.current) return
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
          setPages((prev) => [...prev, dataUrl])
        }
      } catch {
        if (!cancelledRef.current) setError(true)
      }
    }
    render()

    return () => { cancelledRef.current = true }
  }, [url])

  if (error) {
    return (
      <div className={`w-full flex items-center justify-center bg-neutral-800 text-slate-300 text-sm ${fill ? 'h-full' : 'max-h-[70vh]'}`}>
        No se pudo mostrar la vista previa de este PDF.
      </div>
    )
  }

  return (
    <div className={`w-full overflow-auto bg-neutral-800 ${fill ? 'h-full' : 'max-h-[70vh]'}`}>
      {pages.map((src, i) => (
        <ZoomableImage
          key={i}
          src={src}
          alt={`${nombre} — página ${i + 1}`}
          className="block w-full mb-1"
          imgClassName="w-full h-auto"
        />
      ))}
      {pages.length === 0 && (
        <div className="text-center text-slate-300 text-sm p-6">Cargando…</div>
      )}
    </div>
  )
}
