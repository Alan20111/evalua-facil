import { useState } from 'react'
import { ArrowLeft, Sparkles, Trash2, RotateCcw, Check } from 'lucide-react'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { reactivoValido } from '../../utils/reactivosIA'
import { Input, Button, IconButton, Radio } from '../ui'
import { ICONO } from '../../config/iconos'

const ETIQUETA_TIPO = {
  opcion_multiple: 'Opción múltiple',
  verdadero_falso: 'Verdadero / Falso',
  respuesta_corta: 'Respuesta corta',
  subir_archivo: 'Subir documento',
}

// Pantalla de revisión de la propuesta de OP-09 (reactivos con IA): el
// docente ve el aviso obligatorio, edita cada reactivo o lo descarta, y solo
// al confirmar se agregan a la evaluación — la IA nunca guarda nada por su
// cuenta (mismo principio que RubricaEditor/ListaCotejoEditor con iaGenerada).
export default function ReactivosIAReview({ reactivos: initial, onClose, onGuardar }) {
  const [reactivos, setReactivos] = useState(initial)
  const [guardando, setGuardando] = useState(false)

  useScrollLock(true)
  useBackHandler(onClose, true)

  function update(i, patch) {
    setReactivos((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  }
  function updateOpcion(i, j, texto) {
    setReactivos((prev) => prev.map((r, k) => (k !== i ? r : { ...r, opciones: r.opciones.map((o, oi) => (oi === j ? texto : o)) })))
  }
  function descartar(i) {
    setReactivos((prev) => prev.map((r, k) => (k === i ? { ...r, incluir: false } : r)))
  }
  function restaurar(i) {
    setReactivos((prev) => prev.map((r, k) => (k === i ? { ...r, incluir: true } : r)))
  }

  const incluidos = reactivos.filter((r) => r.incluir)
  const todosValidos = incluidos.length > 0 && incluidos.every(reactivoValido)

  async function confirmar() {
    setGuardando(true)
    try {
      await onGuardar(incluidos)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-menu bg-surface overflow-y-auto">
      <header className="sticky top-0 z-10 bg-accent text-white shadow-lg safe-top">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <IconButton icon={ArrowLeft} label="Volver" tooltip={false} variant="onColor" className="-ml-2" onClick={onClose} disabled={guardando} />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white/70 uppercase tracking-wide">Reactivos generados</p>
            <h1 className="text-xl font-extrabold text-white truncate">Revisa antes de agregarlos</h1>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-card">
          <Sparkles size={ICONO.sm} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">Asistente IA. </span>
            Esta propuesta fue generada con inteligencia artificial. Puede contener errores.
            Revísala cuidadosamente y apruébala antes de utilizarla.
          </p>
        </div>

        {reactivos.map((r, i) => (
          <div key={i} className={`bg-surface-card rounded-card shadow-card p-4 space-y-2 ${!r.incluir ? 'opacity-50' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-700">
                {ETIQUETA_TIPO[r.tipo] || r.tipo}
              </span>
              {r.incluir ? (
                <button type="button" onClick={() => descartar(i)} disabled={guardando}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted hover:text-red-600 rounded hover:bg-red-50 transition-colors">
                  <Trash2 size={ICONO.xs} /> Descartar
                </button>
              ) : (
                <button type="button" onClick={() => restaurar(i)} disabled={guardando}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-accent hover:underline">
                  <RotateCcw size={ICONO.xs} /> Restaurar
                </button>
              )}
            </div>

            <textarea value={r.enunciado} disabled={!r.incluir || guardando}
              onChange={(e) => update(i, { enunciado: e.target.value })}
              rows={2} aria-label="Enunciado del reactivo"
              className="w-full px-3 py-2 rounded-card border border-outline-variant text-sm bg-surface disabled:opacity-60" />

            {r.tipo === 'opcion_multiple' && (
              <div className="space-y-1.5">
                {r.opciones.map((texto, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <Radio name={`ia-correcta-${i}`} checked={r.correcta === j} disabled={!r.incluir || guardando}
                      onChange={() => update(i, { correcta: j })} wrapperClassName="flex-shrink-0" />
                    <input type="text" value={texto} disabled={!r.incluir || guardando}
                      onChange={(e) => updateOpcion(i, j, e.target.value)}
                      aria-label={`Opción ${String.fromCharCode(65 + j)}`}
                      className="flex-1 px-2 py-1 rounded-full border border-outline-variant text-sm bg-surface disabled:opacity-60" />
                  </div>
                ))}
                <p className="text-xs text-hint">Deja seleccionada la correcta</p>
              </div>
            )}

            {r.tipo === 'verdadero_falso' && (
              <div className="flex gap-3">
                {[['v', 'Verdadero'], ['f', 'Falso']].map(([val, label]) => (
                  <Radio key={val} name={`ia-vf-${i}`} checked={r.correcta === val} disabled={!r.incluir || guardando}
                    onChange={() => update(i, { correcta: val })} label={label} />
                ))}
              </div>
            )}

            {r.tipo === 'respuesta_corta' && (
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Respuesta esperada / criterio (guía para calificar — el alumno no la ve)
                </label>
                <Input type="text" value={r.respuestaEsperada || ''} disabled={!r.incluir || guardando}
                  onChange={(e) => update(i, { respuestaEsperada: e.target.value })}
                  className="py-1.5 disabled:opacity-60" />
              </div>
            )}

            {r.tipo === 'subir_archivo' && (
              <p className="text-sm text-hint italic">El alumno sube un documento — calificación manual.</p>
            )}
          </div>
        ))}

        <div className="h-2" />
        <Button fullWidth icon={Check} busy={guardando} onClick={confirmar} disabled={!todosValidos || guardando}>
          
          {guardando
            ? 'Agregando…'
            : `Agregar ${incluidos.length} reactivo${incluidos.length !== 1 ? 's' : ''} a la evaluación`}
        </Button>
        {!todosValidos && incluidos.length > 0 && (
          <p className="text-sm text-amber-700 text-center">Completa el enunciado (y al menos 2 opciones, si aplica) de cada reactivo antes de agregarlos.</p>
        )}
        {incluidos.length === 0 && (
          <p className="text-sm text-muted text-center">Descartaste todos los reactivos — no hay nada que agregar.</p>
        )}
        <Button variant="secondary" fullWidth onClick={onClose} disabled={guardando}>
          Cancelar
        </Button>
        <div className="h-6 safe-bottom" />
      </div>
    </div>
  )
}
