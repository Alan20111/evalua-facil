import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Cloud, FileText, Image as ImageIcon, Trash2, Upload } from 'lucide-react'
import StudentLayout from '../../components/StudentLayout'
import Spinner from '../../components/Spinner'
import ConfirmModal from '../../components/ConfirmModal'
import BotonDescargarArchivo from '../../components/BotonDescargarArchivo'
import { Button, Input } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { STUDENT_CONTAINER_NARROW } from '../../config/layout'
import {
  MI_ESPACIO_ACCEPT, MI_ESPACIO_CUOTA_BYTES, MI_ESPACIO_ENLACE_MS, motivoRechazoMiEspacio,
} from '../../config/miEspacio'
import { formatFileSize } from '../../utils/formatBytes'
import { listarMiEspacio, subirAMiEspacio, borrarDeMiEspacio } from '../../utils/miEspacio'

// Mi espacio — almacenamiento personal del estudiante (29-sep-2026).
// Una sola pantalla con un solo propósito: ver cuánto espacio queda, subir,
// descargar y borrar. Sin carpetas. Ver src/config/miEspacio.js.
//
// Solo en la web (escritorio: barra lateral; teléfono: desde Perfil). La app
// nativa no tiene acceso a propósito.

// "23 MB" en vez de "23.0 MB" — así se lee en el indicador de uso.
const tamano = (bytes) => (bytes > 0 ? formatFileSize(bytes).replace('.0 ', ' ') : '0 MB')

const fecha = (ms) => (ms
  ? new Date(ms).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
  : '')

const esImagen = (tipo) => (tipo || '').startsWith('image/')

export default function MiEspacio() {
  const navigate = useNavigate()
  const toast = useToast()
  const inputRef = useRef(null)
  const [datos, setDatos] = useState(null) // { archivos, usadoBytes, cuotaBytes }
  const [error, setError] = useState('')
  const [progreso, setProgreso] = useState(null) // null = sin subida en curso
  const [porBorrar, setPorBorrar] = useState(null)
  const [borrando, setBorrando] = useState(false)

  const cargar = useCallback(() => listarMiEspacio().then(
    (d) => { setDatos(d); setError('') },
    (err) => setError(err.message),
  ), [])

  // Los enlaces de descarga caducan (MI_ESPACIO_ENLACE_MS): se renuevan a la
  // mitad de su vida mientras la pantalla siga abierta.
  useEffect(() => {
    cargar()
    const t = setInterval(cargar, MI_ESPACIO_ENLACE_MS / 2)
    return () => clearInterval(t)
  }, [cargar])

  const usado = datos?.usadoBytes ?? 0
  const porcentaje = Math.min(100, (usado / MI_ESPACIO_CUOTA_BYTES) * 100)
  const subiendo = progreso !== null

  async function alElegir(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo
    if (!file) return
    const motivo = motivoRechazoMiEspacio(file, usado)
    if (motivo) { toast(motivo, 'error'); return }
    setProgreso(0)
    try {
      await subirAMiEspacio(file, setProgreso)
      toast('Archivo guardado en Mi espacio')
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setProgreso(null)
      cargar()
    }
  }

  async function confirmarBorrado() {
    setBorrando(true)
    try {
      await borrarDeMiEspacio(porBorrar.id)
      toast('Archivo eliminado')
      setPorBorrar(null)
      await cargar()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBorrando(false)
    }
  }

  function regresar() {
    // Si se llegó desde otra pantalla, se vuelve a ella (Perfil en el
    // teléfono); si se entró directo, al inicio.
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/alumno/dashboard')
  }

  return (
    <StudentLayout>
      <Input ref={inputRef} type="file" accept={MI_ESPACIO_ACCEPT} onChange={alElegir}
        wrapperClassName="hidden" aria-label="Elegir archivo" tabIndex={-1} />

      <div className={`px-4 py-6 ${STUDENT_CONTAINER_NARROW}`}>
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={regresar}
            className="p-2 -ml-2 rounded hover:bg-[var(--accent-tint)] text-muted hover:text-accent transition-colors flex-shrink-0"
            aria-label="Regresar"
          >
            <ArrowLeft size={20} />
          </button>
          <Cloud size={22} className="text-accent flex-shrink-0" />
          <h1 className="text-xl font-bold text-on-surface">Mi espacio</h1>
        </div>

        {/* Uso + subir */}
        <div className="bg-surface-card rounded-card shadow-card p-5 mb-4">
          <p className="text-sm text-on-surface">
            <span className="font-semibold">{tamano(usado)}</span> de {tamano(MI_ESPACIO_CUOTA_BYTES)}
          </p>
          <progress
            value={usado}
            max={MI_ESPACIO_CUOTA_BYTES}
            aria-label="Espacio usado"
            className={`block w-full h-2 mt-2 appearance-none rounded-full overflow-hidden bg-surface [&::-webkit-progress-bar]:bg-surface ${
              porcentaje >= 90
                ? '[&::-webkit-progress-value]:bg-red-600 [&::-moz-progress-bar]:bg-red-600'
                : '[&::-webkit-progress-value]:bg-accent [&::-moz-progress-bar]:bg-accent'
            }`}
          />
          <Button
            className="mt-4"
            fullWidth
            onClick={() => inputRef.current?.click()}
            disabled={subiendo || !datos}
            busy={subiendo}
          >
            {!subiendo && <Upload size={18} />}
            {subiendo ? `Subiendo… ${Math.round(progreso * 100)}%` : 'Subir archivo'}
          </Button>
        </div>

        {/* Archivos */}
        {!datos && !error ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : error && !datos ? (
          <div className="bg-surface-card rounded-card shadow-card p-5 text-center">
            <p className="text-sm text-muted mb-3">{error}</p>
            <Button variant="secondary" className="mx-auto" onClick={cargar}>Reintentar</Button>
          </div>
        ) : datos.archivos.length === 0 ? (
          <p className="text-sm text-muted text-center py-8">Todavía no tienes archivos en Mi espacio.</p>
        ) : (
          <ul className="bg-surface-card rounded-card shadow-card divide-y divide-outline-variant">
            {datos.archivos.map((a) => {
              const Icono = esImagen(a.tipo) ? ImageIcon : FileText
              return (
                <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                  <Icono size={20} className="text-accent flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-on-surface break-words">{a.nombre}</p>
                    <p className="text-xs text-muted mt-0.5">{tamano(a.tamano)} · {fecha(a.creado)}</p>
                  </div>
                  <BotonDescargarArchivo
                    url={a.url}
                    nombre={a.nombre}
                    etiqueta=""
                    iconSize={22}
                    title="Descargar"
                    onError={(m) => toast(m, 'error')}
                    className="p-3 rounded text-muted hover:text-accent hover:bg-[var(--accent-tint)] transition-colors inline-flex items-center justify-center flex-shrink-0"
                  />
                  <button
                    type="button"
                    onClick={() => setPorBorrar(a)}
                    aria-label={`Eliminar ${a.nombre}`}
                    title="Eliminar"
                    className="p-3 rounded text-muted hover:text-red-600 hover:bg-red-50 transition-colors inline-flex items-center justify-center flex-shrink-0"
                  >
                    <Trash2 size={22} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {porBorrar && (
        <ConfirmModal
          title="¿Eliminar este archivo?"
          message={`Se borrará «${porBorrar.nombre}» de Mi espacio. No se puede recuperar.`}
          confirmLabel="Sí, eliminar"
          confirmingLabel="Eliminando…"
          danger
          busy={borrando}
          onConfirm={confirmarBorrado}
          onCancel={() => setPorBorrar(null)}
        />
      )}
    </StudentLayout>
  )
}
