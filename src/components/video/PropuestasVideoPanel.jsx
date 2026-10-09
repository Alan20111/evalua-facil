import { useCallback, useEffect, useState } from 'react'
import { Check, Pencil, RotateCcw, Sparkles, X } from 'lucide-react'
import Spinner from '../Spinner'
import { useToast } from '../Toast'
import {
  ESTADO_PROPUESTA, cabeOtraPregunta, contarPorEstado, formatearMinuto, parsearMinuto, validarPropuesta,
} from '../../utils/propuestasVideo'
import {
  aprobarPropuesta, cargarPropuestas, editarPropuesta, rechazarPropuesta, restaurarPropuesta,
} from '../../utils/propuestasVideoDb'

const ETIQUETA_TIPO = { opcion_multiple: 'Opción múltiple', verdadero_falso: 'Verdadero / Falso', respuesta_corta: 'Respuesta abierta' }
const ESTADOS = {
  [ESTADO_PROPUESTA.PENDIENTE]: { texto: 'Pendiente', clase: 'bg-amber-100 text-amber-800' },
  [ESTADO_PROPUESTA.APROBADA]: { texto: 'Aprobada', clase: 'bg-green-100 text-green-800' },
  [ESTADO_PROPUESTA.RECHAZADA]: { texto: 'Rechazada', clase: 'bg-red-100 text-red-800' },
}
const FILTROS = [['todas', 'Todas'], [ESTADO_PROPUESTA.PENDIENTE, 'Pendientes'], [ESTADO_PROPUESTA.APROBADA, 'Aprobadas'], [ESTADO_PROPUESTA.RECHAZADA, 'Rechazadas']]
const BOTON = 'inline-flex items-center justify-center gap-1.5 min-h-[2.75rem] px-4 rounded-full text-sm font-semibold transition-colors'

// Revisión de las preguntas que PROPUSO la IA para un Video interactivo. La IA
// nunca agrega nada por su cuenta: una propuesta pasa a las preguntas de la
// evaluación solo cuando el docente la aprueba (propuestasVideoDb.aprobarPropuesta).
//   activas      preguntas que YA están en la evaluación (para repartir los puntos)
//   duracionSeg  duración del video, si se conoce
//   bloqueado    parcial cerrado: se puede leer, no aprobar
//   version      al cambiar (p. ej. tras recuperar una generación) se vuelve a leer la lista
//   onAprobada   (plan) → el editor suma la pregunta a la lista (no toca las demás)
export default function PropuestasVideoPanel({ activityId, activas, duracionSeg = null, bloqueado = false, version = 0, onAprobada }) {
  const toast = useToast()
  const [propuestas, setPropuestas] = useState(null)
  const [filtro, setFiltro] = useState(ESTADO_PROPUESTA.PENDIENTE)
  const [ocupada, setOcupada] = useState(null) // id de la propuesta con una operación en curso
  const [editandoId, setEditandoId] = useState(null)
  const [borrador, setBorrador] = useState(null)

  // Lectura única al montar (y al cambiar de actividad); `recargar` la repite tras un conflicto.
  const recargar = useCallback(() => cargarPropuestas(activityId).then(setPropuestas), [activityId])
  useEffect(() => {
    let vivo = true
    cargarPropuestas(activityId)
      .then((lista) => { if (vivo) setPropuestas(lista) })
      .catch((err) => { if (vivo) { toast('No se pudieron cargar las preguntas propuestas: ' + err.message, 'error'); setPropuestas([]) } })
    return () => { vivo = false }
  }, [activityId, toast, version])

  if (propuestas === null) return <div className="flex justify-center py-6"><Spinner /></div>
  if (propuestas.length === 0) return null

  const cuenta = contarPorEstado(propuestas)
  const visibles = filtro === 'todas' ? propuestas : propuestas.filter((p) => p.estado === filtro)
  const reemplazar = (id, cambios) => setPropuestas((prev) => prev.map((p) => (p.id === id ? { ...p, ...cambios } : p)))

  async function ejecutar(p, accion, exito) {
    if (ocupada) return
    setOcupada(p.id)
    try {
      await accion()
      if (exito) toast(exito)
    } catch (err) {
      toast(err.message?.includes('permission') ? 'Esta pregunta ya cambió en otra pantalla. Recarga la lista.' : (err.message || 'No se pudo completar la acción'), 'error')
      recargar().catch(() => {})
    } finally { setOcupada(null) }
  }

  const aprobar = (p) => {
    if (bloqueado) { toast('El parcial está cerrado: ya no se pueden agregar preguntas.', 'error'); return }
    if (!cabeOtraPregunta(activas)) { toast('El video ya tiene el máximo de preguntas.', 'error'); return }
    ejecutar(p, async () => {
      const plan = await aprobarPropuesta({ activityId, propuesta: p, activas, pendientes: cuenta.pendiente, duracionSeg })
      reemplazar(p.id, { estado: ESTADO_PROPUESTA.APROBADA, preguntaId: p.id })
      if (!plan.yaAprobada) onAprobada?.(plan)
    }, 'Pregunta aprobada: ya forma parte de la evaluación')
  }
  const rechazar = (p) => ejecutar(p, async () => { await rechazarPropuesta(activityId, p); reemplazar(p.id, { estado: ESTADO_PROPUESTA.RECHAZADA }) }, 'Pregunta rechazada: no se agregó a la evaluación')
  const restaurar = (p) => ejecutar(p, async () => { await restaurarPropuesta(activityId, p); reemplazar(p.id, { estado: ESTADO_PROPUESTA.PENDIENTE }) })

  function abrirEdicion(p) {
    setEditandoId(p.id)
    setBorrador({
      enunciado: p.enunciado, minuto: formatearMinuto(p.timestampSeg), retroalimentacion: p.retroalimentacion || '',
      opciones: (p.opciones || []).map((o) => ({ ...o })), respuestaCorrecta: p.respuestaCorrecta,
    })
  }
  function guardarEdicion(p) {
    const seg = parsearMinuto(borrador.minuto)
    const nueva = {
      enunciado: borrador.enunciado, timestampSeg: seg, retroalimentacion: borrador.retroalimentacion,
      ...(p.tipo === 'opcion_multiple' ? { opciones: borrador.opciones } : {}),
      ...(p.tipo !== 'respuesta_corta' ? { respuestaCorrecta: borrador.respuestaCorrecta } : {}),
    }
    const v = validarPropuesta({ ...p, ...nueva }, duracionSeg)
    if (!v.ok) { toast(v.errores[0], 'error'); return }
    ejecutar(p, async () => {
      const campos = await editarPropuesta(activityId, p, nueva)
      if (campos) reemplazar(p.id, campos)
      setEditandoId(null)
    }, 'Cambios guardados')
  }

  return (
    <section className="bg-surface-card rounded-card shadow-card p-4 space-y-3" aria-label="Preguntas propuestas por la IA">
      <div className="flex items-start gap-2">
        <Sparkles size={18} className="text-accent flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold">Preguntas propuestas por la IA</h3>
          <p className="text-sm text-muted">
            Revisa cada una, edítala si hace falta y apruébala. Solo las aprobadas llegan a tus alumnos; las pendientes y las rechazadas nunca se califican.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar propuestas">
        {FILTROS.map(([valor, etiqueta]) => {
          const n = valor === 'todas' ? propuestas.length : cuenta[valor]
          const activo = filtro === valor
          return (
            <button key={valor} type="button" role="tab" aria-selected={activo} onClick={() => setFiltro(valor)}
              className={`min-h-[2.75rem] px-3 rounded-full text-sm font-medium border transition-colors ${activo ? 'bg-accent text-white border-accent' : 'border-outline-variant text-muted hover:bg-surface-container'}`}>
              {etiqueta} ({n})
            </button>
          )
        })}
      </div>

      {visibles.length === 0 && <p className="text-sm text-muted py-2">No hay preguntas en esta lista.</p>}

      {visibles.map((p) => {
        const est = ESTADOS[p.estado] || ESTADOS[ESTADO_PROPUESTA.PENDIENTE]
        const editando = editandoId === p.id
        const trabajando = ocupada === p.id
        return (
          <article key={p.id} className="border border-outline-variant rounded-card p-3 space-y-2" data-estado={p.estado}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">{formatearMinuto(p.timestampSeg)}</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-surface-container text-muted">{ETIQUETA_TIPO[p.tipo] || p.tipo}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${est.clase}`}>{est.texto}</span>
              {p.editada && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-surface-container text-muted">Editada por ti</span>}
            </div>

            {!editando && (
              <>
                <p className="text-sm whitespace-pre-wrap">{p.enunciado}</p>
                {p.tipo === 'opcion_multiple' && (
                  <ul className="space-y-1 text-sm">
                    {p.opciones.map((o) => (
                      <li key={o.id} className={o.id === p.respuestaCorrecta ? 'font-semibold text-green-800' : 'text-muted'}>
                        {o.id === p.respuestaCorrecta ? '✓ ' : '• '}{o.texto}
                      </li>
                    ))}
                  </ul>
                )}
                {p.tipo === 'verdadero_falso' && <p className="text-sm font-semibold text-green-800">✓ {p.respuestaCorrecta === 'v' ? 'Verdadero' : 'Falso'}</p>}
                {p.tipo === 'respuesta_corta' && <p className="text-xs text-hint">Respuesta abierta: tú la calificas.</p>}
                {p.retroalimentacion && <p className="text-xs text-muted">Retroalimentación: {p.retroalimentacion}</p>}
              </>
            )}

            {editando && borrador && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-muted" htmlFor={`pv-enun-${p.id}`}>Pregunta</label>
                <textarea id={`pv-enun-${p.id}`} value={borrador.enunciado} rows={3} disabled={trabajando}
                  onChange={(e) => setBorrador((b) => ({ ...b, enunciado: e.target.value }))}
                  className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
                <label className="block text-xs font-medium text-muted" htmlFor={`pv-min-${p.id}`}>Minuto del video en que se pausa (m:ss)</label>
                <input id={`pv-min-${p.id}`} type="text" inputMode="numeric" value={borrador.minuto} disabled={trabajando}
                  onChange={(e) => setBorrador((b) => ({ ...b, minuto: e.target.value }))}
                  className="w-32 px-3 py-2 rounded-full border border-outline-variant text-sm bg-surface" />
                {p.tipo === 'opcion_multiple' && (
                  <div className="space-y-1.5">
                    {borrador.opciones.map((o, j) => (
                      <div key={o.id} className="flex items-center gap-2">
                        <input type="radio" name={`pv-ok-${p.id}`} checked={borrador.respuestaCorrecta === o.id} disabled={trabajando}
                          onChange={() => setBorrador((b) => ({ ...b, respuestaCorrecta: o.id }))} className="accent-[var(--accent)] flex-shrink-0 w-5 h-5"
                          aria-label={`Marcar la opción ${String.fromCharCode(65 + j)} como correcta`} />
                        <input type="text" value={o.texto} disabled={trabajando} aria-label={`Opción ${String.fromCharCode(65 + j)}`}
                          onChange={(e) => setBorrador((b) => ({ ...b, opciones: b.opciones.map((x) => (x.id === o.id ? { ...x, texto: e.target.value } : x)) }))}
                          className="flex-1 px-3 py-2 rounded-full border border-outline-variant text-sm bg-surface" />
                      </div>
                    ))}
                    <p className="text-xs text-hint">Deja seleccionada la opción correcta.</p>
                  </div>
                )}
                {p.tipo === 'verdadero_falso' && (
                  <div className="flex gap-4">
                    {[['v', 'Verdadero'], ['f', 'Falso']].map(([val, etiqueta]) => (
                      <label key={val} className="flex items-center gap-2 text-sm min-h-[2.75rem]">
                        <input type="radio" name={`pv-vf-${p.id}`} checked={borrador.respuestaCorrecta === val} disabled={trabajando}
                          onChange={() => setBorrador((b) => ({ ...b, respuestaCorrecta: val }))} className="accent-[var(--accent)] w-5 h-5" />
                        {etiqueta}
                      </label>
                    ))}
                  </div>
                )}
                <label className="block text-xs font-medium text-muted" htmlFor={`pv-retro-${p.id}`}>Retroalimentación (opcional)</label>
                <input id={`pv-retro-${p.id}`} type="text" value={borrador.retroalimentacion} disabled={trabajando}
                  onChange={(e) => setBorrador((b) => ({ ...b, retroalimentacion: e.target.value }))}
                  className="w-full px-3 py-2 rounded-full border border-outline-variant text-sm bg-surface" />
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" onClick={() => guardarEdicion(p)} disabled={trabajando} className={`${BOTON} bg-accent text-white`}>
                    {trabajando ? <Spinner size="sm" /> : <Check size={16} />} Guardar cambios
                  </button>
                  <button type="button" onClick={() => setEditandoId(null)} disabled={trabajando} className={`${BOTON} border border-outline-variant text-muted`}>Cancelar</button>
                </div>
              </div>
            )}

            {!editando && p.estado === ESTADO_PROPUESTA.PENDIENTE && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" onClick={() => aprobar(p)} disabled={!!ocupada} className={`${BOTON} bg-accent text-white`}>
                  {trabajando ? <Spinner size="sm" /> : <Check size={16} />} Aprobar
                </button>
                <button type="button" onClick={() => abrirEdicion(p)} disabled={!!ocupada} className={`${BOTON} border border-outline-variant text-on-surface`}>
                  <Pencil size={16} /> Editar
                </button>
                <button type="button" onClick={() => rechazar(p)} disabled={!!ocupada} className={`${BOTON} border border-outline-variant text-red-700`}>
                  <X size={16} /> Rechazar
                </button>
              </div>
            )}
            {!editando && p.estado === ESTADO_PROPUESTA.RECHAZADA && (
              <button type="button" onClick={() => restaurar(p)} disabled={!!ocupada} className={`${BOTON} border border-outline-variant text-accent`}>
                <RotateCcw size={16} /> Restaurar como pendiente
              </button>
            )}
            {!editando && p.estado === ESTADO_PROPUESTA.APROBADA && (
              <p className="text-xs text-muted">Ya forma parte de la evaluación. Para cambiarla, edítala en la lista de preguntas.</p>
            )}
          </article>
        )
      })}
    </section>
  )
}
