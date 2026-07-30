import { useState } from 'react'
import { avisoEmoji, formatAvisoFecha } from '../../utils/avisos'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'

// Lectura obligatoria de avisos pendientes — pedido explícito: nada de cerrar,
// omitir, "más tarde", X, deslizar o botón atrás. La única salida es leer el
// mensaje y tocar "Entendido", uno por uno hasta que no quede ninguno
// pendiente. Por eso useBackHandler recibe un no-op (no un cierre): consume
// el botón físico de Android sin dejarlo pasar a la pantalla de atrás, en vez
// de simplemente no engancharse (que dejaría "atrás" navegar libre).
// `teacherNames`/`subjectNames` son mapas ({docenteId: nombre} / {asignaturaId:
// nombre}) — este gate es GLOBAL (ver AvisosGate.jsx, montado en
// StudentLayout), así que un aviso pendiente puede venir de cualquiera de
// las materias del alumno, no solo la que tiene abierta.
export default function AvisoLecturaModal({ avisos, teacherNames = {}, subjectNames = {}, onConfirm, confirming }) {
  const [idx, setIdx] = useState(0)
  useBackHandler(() => {}, avisos.length > 0)
  useScrollLock(avisos.length > 0)

  if (avisos.length === 0) return null
  const aviso = avisos[Math.min(idx, avisos.length - 1)]
  const emoji = avisoEmoji(aviso)
  const teacherName = teacherNames[aviso.docenteId]
  const subjectName = subjectNames[aviso.asignaturaId]

  async function handleEntendido() {
    await onConfirm(aviso)
    setIdx((i) => i + 1)
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center px-4">
      <div className="bg-surface-card rounded-card shadow-2xl w-full max-w-md p-6 text-center">
        {avisos.length > 1 && (
          <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-2">
            Aviso {idx + 1} de {avisos.length}
          </p>
        )}
        <span className="text-4xl leading-none block mb-3" aria-hidden="true">{emoji}</span>
        {subjectName && <p className="text-xs font-semibold text-accent mb-1">{subjectName}</p>}
        <h2 className="text-lg font-bold text-on-surface mb-2">{aviso.titulo}</h2>
        {aviso.mensaje && (
          <p className="text-sm text-on-surface whitespace-pre-wrap text-left mb-4">{aviso.mensaje}</p>
        )}
        <p className="text-xs text-slate-400 mb-6">
          {formatAvisoFecha(aviso.fechaCreacion)}{teacherName ? ` · ${teacherName}` : ''}
        </p>
        <button type="button" onClick={handleEntendido} disabled={confirming}
          className="w-full px-4 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-hover transition-colors disabled:opacity-50">
          {confirming ? 'Guardando…' : 'Entendido'}
        </button>
      </div>
    </div>
  )
}
