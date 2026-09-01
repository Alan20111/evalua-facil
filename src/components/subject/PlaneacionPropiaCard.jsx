// Planeación propia del docente — el archivo PDF/DOCX que subió y que ES la
// planeación vigente de la asignatura (1-sep-2026, autorizado por Kike).
//
// Este archivo NO decide vigencia: eso vive en un solo lugar
// (src/utils/planeacionVigente.js) y lo maneja PlaneacionInicialSection, que
// es quien escribe en Firestore. Aquí solo hay dos cosas:
//
//   · PlaneacionPropiaCard      → cómo se VE la planeación propia vigente.
//   · SelectorArchivoPlaneacion → cómo se ELIGE y valida un archivo.
//
// Nada de esto consume créditos: subir, ver, descargar o reemplazar la
// planeación propia es almacenamiento, no una operación de IA.
//
// Reutiliza los visores que ya existen (FilePreviewModal: PDF página a
// página, Word con el visor de Google Docs) y el forzado de descarga de
// Cloudinary (downloadUrl) — no se construye ningún visor ni descargador nuevo.
import { useRef, useState } from 'react'
import { Upload, Eye, Download, FileText, Sparkles, RefreshCw } from 'lucide-react'
import { FilePreviewModal } from '../AttachmentList'
import { downloadUrl } from '../../utils/cloudinary'
import { formatFileSize } from '../../utils/formatBytes'
import Spinner from '../Spinner'
import { PLANEACION_ACCEPT, validarArchivoPlaneacion } from '../../utils/planeacionVigente'

// Botón + input oculto para elegir la planeación propia. Valida ANTES de
// devolver el archivo, así que el componente padre solo recibe archivos que
// ya pasaron formato, tamaño y "no está vacío" — nunca sube algo inválido ni
// abre una confirmación que después tendría que cancelar.
export function SelectorArchivoPlaneacion({ label, icono = 'upload', disabled, ocupado, onElegido, onInvalido }) {
  const inputRef = useRef(null)
  const Icono = icono === 'refresh' ? RefreshCw : Upload

  function alCambiar(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const error = validarArchivoPlaneacion(file)
    if (error) { onInvalido?.(error); return }
    onElegido(file)
  }

  return (
    <>
      <input ref={inputRef} type="file" accept={PLANEACION_ACCEPT} className="hidden" onChange={alCambiar} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || ocupado}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
      >
        {ocupado ? <Spinner size="sm" /> : <Icono size={14} />}
        {label}
      </button>
    </>
  )
}

// La planeación propia vigente. Muestra SOLO esta: mientras exista, no hay
// ninguna otra planeación que el docente pueda ver o usar.
export default function PlaneacionPropiaCard({
  archivo, aceptadaEn, subiendo, onElegirReemplazo, onArchivoInvalido, onGenerarIA,
}) {
  const [verArchivo, setVerArchivo] = useState(false)
  const fecha = aceptadaEn?.toDate ? aceptadaEn.toDate() : (archivo?.subidoEn?.toDate ? archivo.subidoEn.toDate() : null)

  return (
    <div>
      <p className="text-xs text-muted mb-2">
        Estado: <span className="font-medium text-green-700">Vigente: tu planeación</span>
        {fecha && ` · ${fecha.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
      </p>

      <div className="flex items-center gap-2 p-2.5 rounded border border-green-200 bg-green-50 text-sm">
        <FileText size={16} className="text-muted flex-shrink-0" />
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-on-surface">{archivo?.nombre}</strong>
          <span className="text-xs text-muted uppercase">
            {archivo?.tipo}{archivo?.tamano ? ` · ${formatFileSize(archivo.tamano)}` : ''}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button
          type="button"
          onClick={() => setVerArchivo(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-on-surface text-sm hover:bg-[var(--accent-tint)]"
        >
          <Eye size={14} />
          Ver
        </button>
        <a
          href={downloadUrl(archivo?.url, archivo?.nombre)}
          download={archivo?.nombre}
          rel="noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-on-surface text-sm hover:bg-[var(--accent-tint)]"
        >
          <Download size={14} />
          Descargar
        </a>
        <SelectorArchivoPlaneacion
          label="Reemplazar archivo"
          icono="refresh"
          ocupado={subiendo}
          onElegido={onElegirReemplazo}
          onInvalido={onArchivoInvalido}
        />
        <button
          type="button"
          onClick={onGenerarIA}
          disabled={subiendo}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-accent text-sm hover:bg-[var(--accent-tint)] disabled:opacity-60"
        >
          <Sparkles size={14} />
          Generar planeación con Evalúa Fácil
        </button>
      </div>

      <p className="text-xs text-muted mt-2">
        Evalúa Fácil guarda tu archivo tal como lo subiste. No lo lee ni lo analiza, y subirlo no consume créditos.
      </p>

      {verArchivo && (
        <FilePreviewModal url={archivo?.url} nombre={archivo?.nombre} onClose={() => setVerArchivo(false)} />
      )}
    </div>
  )
}
