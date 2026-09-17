import { useEffect, useRef, useState } from 'react'
import Modal from '../ui/Modal'
import Spinner from '../Spinner'
import { MAX_TEXTO_OBSERVACION } from '../../utils/observacionesBitacora'

// Ventana pequeña para agregar, ver o editar la observación de UNA celda de
// asistencia (estudiante + fecha + hora). Guardar con el texto vacío quita la
// observación existente.
//
// Props:
//   estudiante  nombre completo
//   fecha       etiqueta ya formateada (con la hora si hace falta)
//   original    texto guardado ('' si es nueva)
//   onGuardar   async (texto) => void
//   onClose     () => void
//   z           z-index del Modal (más alto encima de la bitácora y en Tomar lista del teléfono)
export default function ObservacionModal({ estudiante, fecha, original = '', onGuardar, onClose, z = 50 }) {
  const [texto, setTexto] = useState(original)
  const [guardando, setGuardando] = useState(false)
  const sinCambios = texto.trim() === original.trim()
  const esNueva = !original
  const textoRef = useRef(null)

  // El foco va directo al texto (no a la X del encabezado) y el cursor al final.
  useEffect(() => {
    const t = textoRef.current
    if (!t) return
    t.focus()
    t.setSelectionRange(t.value.length, t.value.length)
  }, [])

  async function guardar() {
    if (sinCambios || guardando) return
    setGuardando(true)
    try {
      await onGuardar(texto.trim())
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open onClose={onClose} variant="centered" size="md" z={z} busy={guardando}
      title={esNueva ? 'Agregar observación' : 'Observación'}>
      <p className="text-sm text-muted -mt-2 mb-3">{estudiante} · {fecha}</p>
      <label htmlFor="obs-asistencia-texto" className="sr-only">Observación</label>
      <textarea
        id="obs-asistencia-texto"
        value={texto}
        rows={4}
        maxLength={MAX_TEXTO_OBSERVACION}
        ref={textoRef}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); guardar() } }}
        placeholder="Escribe lo que observaste…"
        className="w-full px-3 py-2.5 rounded border border-outline-variant text-base bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent resize-y"
      />
      {!esNueva && (
        <p className="text-xs text-muted mt-1">Para quitar la observación, borra el texto y guarda.</p>
      )}
      <div className="flex gap-2 mt-4">
        <button type="button" onClick={onClose} disabled={guardando}
          className="flex-1 py-2.5 rounded border border-outline-variant text-muted text-base font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
          Salir
        </button>
        <button type="button" onClick={guardar} disabled={sinCambios || guardando}
          className="flex-1 py-2.5 rounded bg-accent text-white text-base font-semibold hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
          {guardando && <Spinner size="sm" />} Guardar
        </button>
      </div>
    </Modal>
  )
}
