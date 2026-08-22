// Crucigrama / Sopa de letras — editor de contenido (22-ago-2026).
//
// Lista editable de { palabra, descripcion } (5-20 elementos). El docente
// agrega/edita/elimina a mano; "Confirmar contenido" dispara `construirJuego`
// (callable determinista, GRATIS, no toca créditos) que arma la cuadrícula.
// Reintentos de construcción (fallo geométrico) tampoco cobran — decisión de
// producto #5.

import { useState } from 'react'
import { Plus, Trash2, Wand2 } from 'lucide-react'
import { doc, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../../firebase'
import { useToast } from '../Toast'

const MIN_PALABRAS = 5
const MAX_PALABRAS = 20

export default function ContenidoJuegoEditor({ activity, onConstruido }) {
  const toast = useToast()
  const modalidad = activity.juego?.modalidad || 'palabra'
  const [contenido, setContenido] = useState(
    (activity.juego?.contenido || []).map((it) => ({ palabra: it.palabra || '', descripcion: it.descripcion || '' }))
  )
  const [guardando, setGuardando] = useState(false)
  const [construyendo, setConstruyendo] = useState(false)

  function actualizar(i, campo, valor) {
    setContenido((prev) => prev.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)))
  }
  function eliminar(i) {
    setContenido((prev) => prev.filter((_, idx) => idx !== i))
  }
  function agregar() {
    if (contenido.length >= MAX_PALABRAS) { toast(`Máximo ${MAX_PALABRAS} palabras`, 'error'); return }
    setContenido((prev) => [...prev, { palabra: '', descripcion: '' }])
  }

  async function guardarContenido(nuevoContenido) {
    setGuardando(true)
    try {
      await updateDoc(doc(db, 'activities', activity.id), {
        'juego.contenido': nuevoContenido,
        'juego.estado': 'contenido_editado',
      })
    } finally {
      setGuardando(false)
    }
  }

  async function handleConstruir() {
    const limpio = contenido
      .map((it) => ({ palabra: it.palabra.trim(), descripcion: it.descripcion?.trim() || null }))
      .filter((it) => it.palabra.length >= 2)

    if (limpio.length < MIN_PALABRAS) {
      toast(`Necesitas al menos ${MIN_PALABRAS} palabras`, 'error'); return
    }
    const vistos = new Set()
    for (const it of limpio) {
      const clave = it.palabra.toUpperCase()
      if (vistos.has(clave)) { toast(`Hay palabras repetidas ("${it.palabra}")`, 'error'); return }
      vistos.add(clave)
    }

    setConstruyendo(true)
    try {
      await guardarContenido(limpio)
      const construirJuego = httpsCallable(functions, 'construirJuego')
      await construirJuego({ actividadId: activity.id })
      toast('Juego construido')
      onConstruido?.()
    } catch (err) {
      toast(err.message || 'No se pudo construir el juego', 'error')
    } finally {
      setConstruyendo(false)
    }
  }

  const trabajando = guardando || construyendo

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Revisa y edita las palabras {modalidad === 'descripcion' ? 'y sus pistas' : ''} antes de construir
        el juego ({contenido.length}/{MAX_PALABRAS}, mínimo {MIN_PALABRAS}).
      </p>

      <div className="space-y-2">
        {contenido.map((it, i) => (
          <div key={i} className="flex items-start gap-2">
            <input value={it.palabra} disabled={trabajando}
              onChange={(e) => actualizar(i, 'palabra', e.target.value)}
              placeholder="Palabra"
              className="w-32 sm:w-40 px-2.5 py-1.5 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
            {modalidad === 'descripcion' && (
              <input value={it.descripcion} disabled={trabajando}
                onChange={(e) => actualizar(i, 'descripcion', e.target.value)}
                placeholder="Pista / descripción"
                className="flex-1 px-2.5 py-1.5 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
            )}
            <button type="button" onClick={() => eliminar(i)} disabled={trabajando}
              aria-label={`Eliminar ${it.palabra || 'palabra'}`}
              className="p-1.5 text-muted hover:text-red-500 flex-shrink-0"><Trash2 size={16} /></button>
          </div>
        ))}
      </div>

      <button type="button" onClick={agregar} disabled={trabajando || contenido.length >= MAX_PALABRAS}
        className="flex items-center gap-1.5 text-sm text-accent hover:underline disabled:opacity-40 disabled:no-underline">
        <Plus size={16} /> Agregar palabra
      </button>

      <div className="flex justify-end pt-2">
        <button type="button" onClick={handleConstruir} disabled={trabajando}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors disabled:opacity-60">
          <Wand2 size={16} />
          {construyendo ? 'Construyendo…' : 'Confirmar contenido y construir juego'}
        </button>
      </div>
      <p className="text-xs text-muted text-right">Este paso no consume créditos de IA.</p>
    </div>
  )
}
