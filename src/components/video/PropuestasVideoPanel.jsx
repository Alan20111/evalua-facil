import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Eye, Pencil, RotateCcw, Sparkles, X } from 'lucide-react'
import Spinner from '../Spinner'
import { useToast } from '../Toast'
import {
  ESTADO_PROPUESTA, cabeOtraPregunta, validarPropuesta,
} from '../../utils/propuestasVideo'
import {
  aprobarPropuesta, cargarPropuestas, editarPropuesta, rechazarPropuesta, restaurarPropuesta,
} from '../../utils/propuestasVideoDb'
import { actualizarPregunta } from '../../utils/evaluacionClave'
import RecomendacionesVideo from './RecomendacionesVideo'
import ControlTiempoVideo from './ControlTiempoVideo'
import EvidenciaVideo from './EvidenciaVideo'
import VistaPreviaDocenteVideo from './VistaPreviaDocenteVideo'
import {
  ESTADO_REVISION, construirItems, contarPorEstadoRevision, formatearMinuto, inicioDePrueba, requiereConfirmacion, validarTiempo,
} from './revisionVideo'

const ETIQUETA_TIPO = { opcion_multiple: 'Opción múltiple', verdadero_falso: 'Verdadero / Falso', respuesta_corta: 'Respuesta abierta' }
const ESTADOS = {
  [ESTADO_REVISION.PENDIENTE]: { texto: 'Pendiente de tu revisión', clase: 'bg-amber-100 text-amber-800' },
  [ESTADO_REVISION.APROBADA]: { texto: 'Aprobada por ti', clase: 'bg-green-100 text-green-800' },
  [ESTADO_REVISION.DESCARTADA]: { texto: 'Descartada', clase: 'bg-red-100 text-red-800' },
}
const FILTROS = [['todas', 'Todas'], [ESTADO_REVISION.PENDIENTE, 'Pendientes'], [ESTADO_REVISION.APROBADA, 'Aprobadas'], [ESTADO_REVISION.DESCARTADA, 'Descartadas']]
const BOTON = 'inline-flex items-center justify-center gap-1.5 min-h-[2.75rem] px-4 rounded-full text-sm font-semibold transition-colors disabled:opacity-60'

// Revisión de las preguntas de un Video interactivo: las que PROPUSO la IA (pendientes, descartadas) y las que ya están
// aprobadas en la evaluación. LA IA PROPONE; EL DOCENTE REVISA, CORRIGE, PRUEBA, APRUEBA O DESCARTA. Aprobar es una decisión
// del docente, no una verificación del sistema.
//
// Los cambios (texto, opciones, respuesta, momento de aparición) son un BORRADOR: se ven de inmediato aquí y en la vista previa,
// pero no se guardan hasta que el docente pulsa «Guardar» en esa pregunta. Una propuesta pasa a las preguntas de la evaluación
// solo al aprobarla (propuestasVideoDb.aprobarPropuesta); las descartadas y las pendientes nunca se publican.
//
//   activas      preguntas que YA están en la evaluación, con su clave (también reparten los puntos)
//   activasListas  el editor ya terminó de leerlas (sin eso no se sabe si una aprobada sigue en la evaluación)
//   duracionSeg  duración del video, si se conoce
//   bloqueado    parcial cerrado: se puede leer y probar, no aprobar ni cambiar preguntas ya aprobadas
//   version      al cambiar (p. ej. tras recuperar una generación) se vuelve a leer la lista
//   videoId / nombreActividad   para la vista previa docente
//   onAprobada   (plan) → el editor suma la pregunta a la lista (no toca las demás)
//   onPreguntaActualizada  (id, campos) → el editor refleja el cambio guardado en una pregunta ya aprobada
export default function PropuestasVideoPanel({
  activityId, activas, activasListas = true, duracionSeg = null, bloqueado = false, version = 0, onAprobada, onPreguntaActualizada, videoId = null, nombreActividad = '',
}) {
  const toast = useToast()
  const [propuestas, setPropuestas] = useState(null)
  const [borradores, setBorradores] = useState({})
  const [filtro, setFiltro] = useState(null) // null = el que corresponda según lo que haya
  const [ocupada, setOcupada] = useState(null)
  const [editandoId, setEditandoId] = useState(null)
  const [confirmados, setConfirmados] = useState({})
  const [vistaPrevia, setVistaPrevia] = useState(null) // { inicioSeg, reproducir }

  const recargar = useCallback(() => cargarPropuestas(activityId).then(setPropuestas), [activityId])
  useEffect(() => {
    let vivo = true
    cargarPropuestas(activityId)
      .then((lista) => { if (vivo) setPropuestas(lista) })
      .catch((err) => { if (vivo) { toast('No se pudieron cargar las preguntas propuestas: ' + err.message, 'error'); setPropuestas([]) } })
    return () => { vivo = false }
  }, [activityId, toast, version])

  const items = useMemo(() => construirItems({ propuestas: propuestas || [], activas: activas || [], borradores, activasListas }), [propuestas, activas, borradores, activasListas])
  const cuenta = useMemo(() => contarPorEstadoRevision(items), [items])

  if (propuestas === null || !activasListas) return <div className="flex justify-center py-6"><Spinner /></div>
  if (items.length === 0) return null

  const filtroActivo = filtro ?? (cuenta.pendiente > 0 ? ESTADO_REVISION.PENDIENTE : 'todas')
  const visibles = filtroActivo === 'todas' ? items : items.filter((it) => it.estado === filtroActivo)
  const persistida = (id) => (propuestas || []).find((p) => p.id === id)
  const reemplazar = (id, cambios) => setPropuestas((prev) => prev.map((p) => (p.id === id ? { ...p, ...cambios } : p)))
  const setCampos = (id, campos) => setBorradores((b) => ({ ...b, [id]: { ...b[id], ...campos } }))
  const quitarBorrador = (id) => setBorradores((b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== id)))

  async function ejecutar(it, accion, exito) {
    if (ocupada) return
    setOcupada(it.id)
    try {
      await accion()
      if (exito) toast(exito)
    } catch (err) {
      toast(err.message?.includes('permission') ? 'Esta pregunta ya cambió en otra pantalla. Recarga la lista.' : (err.message || 'No se pudo completar la acción'), 'error')
      recargar().catch(() => {})
    } finally { setOcupada(null) }
  }

  // Lo que el docente cambió y no ha guardado, solo los campos que difieren de lo guardado.
  function camposCambiados(it) {
    const c = {}
    for (const k of ['enunciado', 'opciones', 'respuestaCorrecta', 'retroalimentacion', 'timestampSeg']) {
      if (JSON.stringify(it[k]) !== JSON.stringify(it.guardado[k])) c[k] = it[k]
    }
    return c
  }

  function problema(it) {
    const t = validarTiempo(it.timestampSeg, duracionSeg)
    if (!t.ok) return t.error
    const v = validarPropuesta({ tipo: it.tipo, enunciado: it.enunciado, opciones: it.opciones, respuestaCorrecta: it.respuestaCorrecta, retroalimentacion: it.retroalimentacion, timestampSeg: it.timestampSeg }, duracionSeg)
    return v.ok ? null : v.errores[0]
  }

  // Guarda el borrador de una pregunta. Devuelve la propuesta guardada (para aprobar con lo último).
  async function guardarBorrador(it) {
    const campos = camposCambiados(it)
    const err = problema(it)
    if (err) throw new Error(err)
    if (!Object.keys(campos).length) return persistida(it.id)
    if (it.estado === ESTADO_REVISION.APROBADA) {
      if (bloqueado) throw new Error('El parcial está cerrado: ya no se pueden cambiar preguntas aprobadas.')
      const publicos = { ...campos }
      if ('retroalimentacion' in publicos) publicos.retroalimentacion = String(publicos.retroalimentacion || '').trim() || null
      await actualizarPregunta(activityId, it.id, publicos)
      onPreguntaActualizada?.(it.id, publicos)
      quitarBorrador(it.id)
      return null
    }
    const escrito = await editarPropuesta(activityId, persistida(it.id), campos)
    if (escrito) reemplazar(it.id, escrito)
    quitarBorrador(it.id)
    return { ...persistida(it.id), ...(escrito || {}) }
  }

  const guardar = (it) => ejecutar(it, async () => { await guardarBorrador(it); setEditandoId(null) }, 'Cambios guardados')

  function aprobar(it) {
    if (bloqueado) { toast('El parcial está cerrado: ya no se pueden agregar preguntas.', 'error'); return }
    if (!cabeOtraPregunta(activas)) { toast('El video ya tiene el máximo de preguntas.', 'error'); return }
    if (requiereConfirmacion(it) && !confirmados[it.id]) { toast('Confirma primero que revisaste esta pregunta contra el video.', 'error'); return }
    ejecutar(it, async () => {
      const propuesta = (await guardarBorrador(it)) || persistida(it.id)
      const plan = await aprobarPropuesta({ activityId, propuesta, activas, pendientes: cuenta.pendiente, duracionSeg })
      reemplazar(it.id, { estado: ESTADO_PROPUESTA.APROBADA, preguntaId: it.id })
      if (!plan.yaAprobada) onAprobada?.(plan)
    }, 'Pregunta aprobada: ya forma parte de la evaluación')
  }
  const descartar = (it) => ejecutar(it, async () => { await rechazarPropuesta(activityId, persistida(it.id)); reemplazar(it.id, { estado: ESTADO_PROPUESTA.RECHAZADA }); quitarBorrador(it.id) }, 'Pregunta descartada: no se publicará')
  const restaurar = (it) => ejecutar(it, async () => { await restaurarPropuesta(activityId, persistida(it.id)); reemplazar(it.id, { estado: ESTADO_PROPUESTA.PENDIENTE }) })

  const abrirVista = (inicioSeg = 0, reproducir = false) => {
    if (!videoId) { toast('Esta actividad no tiene un video para reproducir.', 'error'); return }
    setVistaPrevia({ inicioSeg, reproducir })
  }
  const hayPreguntasParaProbar = items.some((it) => it.estado !== ESTADO_REVISION.DESCARTADA)

  return (
    <section className="bg-surface-card rounded-card shadow-card p-4 space-y-3" aria-label="Revisión de las preguntas del video" data-testid="panel-revision-video">
      <div className="flex items-start gap-2">
        <Sparkles size={18} className="text-accent flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold">Revisión de las preguntas del video</h3>
          <p className="text-sm text-muted">
            Revisa cada pregunta, corrígela, elige cuándo aparece, pruébala en el video y apruébala o descártala. Solo las aprobadas llegan a tus alumnos.
          </p>
        </div>
      </div>

      <RecomendacionesVideo />

      <div className="rounded-card bg-surface px-3 py-2 space-y-1.5" data-testid="resumen-antes-de-publicar">
        <p className="text-sm font-semibold text-on-surface">Antes de publicar</p>
        <ul className="text-sm text-on-surface space-y-0.5">
          <li><span className="font-semibold text-green-800">{cuenta.aprobada}</span> {cuenta.aprobada === 1 ? 'aprobada: se publicará' : 'aprobadas: se publicarán'}</li>
          <li><span className="font-semibold text-amber-800">{cuenta.pendiente}</span> {cuenta.pendiente === 1 ? 'pendiente: NO se publica hasta que la apruebes' : 'pendientes: NO se publican hasta que las apruebes'}</li>
          <li><span className="font-semibold text-red-800">{cuenta.descartada}</span> {cuenta.descartada === 1 ? 'descartada: no se publica' : 'descartadas: no se publican'}</li>
        </ul>
        {items.some((it) => it.sinGuardar) && <p className="text-xs font-semibold text-amber-900">Tienes cambios sin guardar. Guárdalos en cada pregunta para que cuenten al publicar.</p>}
        <button type="button" onClick={() => abrirVista(0, false)} disabled={!hayPreguntasParaProbar || !videoId} data-testid="abrir-vista-previa"
          className={`${BOTON} border border-accent text-accent hover:bg-[var(--accent-tint)]`}>
          <Eye size={16} /> Vista previa docente (probar la actividad completa)
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar preguntas">
        {FILTROS.map(([valor, etiqueta]) => {
          const n = valor === 'todas' ? items.length : cuenta[valor]
          const activo = filtroActivo === valor
          return (
            <button key={valor} type="button" role="tab" aria-selected={activo} onClick={() => setFiltro(valor)}
              className={`min-h-[2.75rem] px-3 rounded-full text-sm font-medium border transition-colors ${activo ? 'bg-accent text-white border-accent' : 'border-outline-variant text-muted hover:bg-surface-container'}`}>
              {etiqueta} ({n})
            </button>
          )
        })}
      </div>

      {visibles.length === 0 && <p className="text-sm text-muted py-2">No hay preguntas en esta lista.</p>}

      {visibles.map((it) => {
        const est = ESTADOS[it.estado]
        const editando = editandoId === it.id
        const trabajando = ocupada === it.id
        const esAprobada = it.estado === ESTADO_REVISION.APROBADA
        const sinPermiso = esAprobada && bloqueado
        const err = problema(it)
        return (
          <article key={it.id} className="border border-outline-variant rounded-card p-3 space-y-2" data-estado={it.estado} data-testid="tarjeta-pregunta">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 tabular-nums">{Number.isInteger(it.timestampSeg) ? formatearMinuto(it.timestampSeg) : 'Al final'}</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-surface-container text-muted">{ETIQUETA_TIPO[it.tipo] || it.tipo}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${est.clase}`}>{it.fueraDeLaEvaluacion ? 'Eliminada de la evaluación' : est.texto}</span>
              {it.origen === 'manual' && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-surface-container text-muted">Creada por ti</span>}
              {it.editada && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-surface-container text-muted">Editada por ti</span>}
              {it.sinGuardar && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900">Cambios sin guardar</span>}
            </div>

            {!editando && (
              <>
                <p className="text-sm whitespace-pre-wrap">{it.enunciado}</p>
                {it.tipo === 'opcion_multiple' && (
                  <ul className="space-y-1 text-sm">
                    {(it.opciones || []).map((o) => (
                      <li key={o.id} className={o.id === it.respuestaCorrecta ? 'font-semibold text-green-800' : 'text-muted'}>
                        {o.id === it.respuestaCorrecta ? '✓ ' : '• '}{o.texto}{o.id === it.respuestaCorrecta ? ' (respuesta marcada como correcta)' : ''}
                      </li>
                    ))}
                  </ul>
                )}
                {it.tipo === 'verdadero_falso' && <p className="text-sm font-semibold text-green-800">✓ {it.respuestaCorrecta === 'v' ? 'Verdadero' : 'Falso'} (respuesta marcada como correcta)</p>}
                {it.tipo === 'respuesta_corta' && <p className="text-xs text-hint">Respuesta abierta: tú la calificas.</p>}
                {it.retroalimentacion && <p className="text-xs text-muted">Retroalimentación: {it.retroalimentacion}</p>}
                {it.estado === ESTADO_REVISION.PENDIENTE && <p className="text-xs text-hint">La respuesta marcada la propone la IA. Compruébala con el video antes de aprobar.</p>}
              </>
            )}

            {editando && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-muted" htmlFor={`pv-enun-${it.id}`}>Pregunta</label>
                <textarea id={`pv-enun-${it.id}`} value={it.enunciado} rows={3} disabled={trabajando || sinPermiso}
                  onChange={(e) => setCampos(it.id, { enunciado: e.target.value })}
                  className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
                {it.tipo === 'opcion_multiple' && (
                  <div className="space-y-1.5">
                    {(it.opciones || []).map((o, j) => (
                      <div key={o.id} className="flex items-center gap-2">
                        <input type="radio" name={`pv-ok-${it.id}`} checked={it.respuestaCorrecta === o.id} disabled={trabajando || sinPermiso}
                          onChange={() => setCampos(it.id, { respuestaCorrecta: o.id })} className="accent-[var(--accent)] flex-shrink-0 w-5 h-5"
                          aria-label={`Marcar la opción ${String.fromCharCode(65 + j)} como correcta`} />
                        <input type="text" value={o.texto} disabled={trabajando || sinPermiso} aria-label={`Opción ${String.fromCharCode(65 + j)}`}
                          onChange={(e) => setCampos(it.id, { opciones: it.opciones.map((x) => (x.id === o.id ? { ...x, texto: e.target.value } : x)) })}
                          className="flex-1 px-3 py-2 rounded-full border border-outline-variant text-sm bg-surface" />
                      </div>
                    ))}
                    <p className="text-xs text-hint">Deja seleccionada la opción correcta.</p>
                  </div>
                )}
                {it.tipo === 'verdadero_falso' && (
                  <div className="flex gap-4">
                    {[['v', 'Verdadero'], ['f', 'Falso']].map(([val, etiqueta]) => (
                      <label key={val} className="flex items-center gap-2 text-sm min-h-[2.75rem]">
                        <input type="radio" name={`pv-vf-${it.id}`} checked={it.respuestaCorrecta === val} disabled={trabajando || sinPermiso}
                          onChange={() => setCampos(it.id, { respuestaCorrecta: val })} className="accent-[var(--accent)] w-5 h-5" />
                        {etiqueta}
                      </label>
                    ))}
                  </div>
                )}
                <label className="block text-xs font-medium text-muted" htmlFor={`pv-retro-${it.id}`}>Retroalimentación (opcional)</label>
                <input id={`pv-retro-${it.id}`} type="text" value={it.retroalimentacion} disabled={trabajando || sinPermiso}
                  onChange={(e) => setCampos(it.id, { retroalimentacion: e.target.value })}
                  className="w-full px-3 py-2 rounded-full border border-outline-variant text-sm bg-surface" />
              </div>
            )}

            <ControlTiempoVideo
              item={it} items={items} duracionSeg={duracionSeg} disabled={trabajando || sinPermiso || it.estado === ESTADO_REVISION.DESCARTADA}
              onCambiar={(seg) => setCampos(it.id, { timestampSeg: seg })}
              onProbar={() => abrirVista(inicioDePrueba(it.timestampSeg, duracionSeg), true)}
              puedeProbar={!!videoId && Number.isInteger(it.timestampSeg) && it.estado !== ESTADO_REVISION.DESCARTADA}
            />
            <EvidenciaVideo item={it} />
            {sinPermiso && <p className="text-xs text-amber-900">El parcial está cerrado: puedes probar esta pregunta, pero ya no se puede cambiar.</p>}
            {err && it.estado !== ESTADO_REVISION.DESCARTADA && <p role="alert" className="text-xs text-error">{err}</p>}

            {requiereConfirmacion(it) && it.estado === ESTADO_REVISION.PENDIENTE && (
              <label className="flex items-start gap-2 text-xs text-amber-950 bg-amber-50 rounded px-2 py-2">
                <input type="checkbox" checked={!!confirmados[it.id]} onChange={(e) => setConfirmados((c) => ({ ...c, [it.id]: e.target.checked }))} className="mt-0.5 accent-[var(--accent)]" />
                Vi el video y comprobé que esta pregunta y su respuesta corresponden a lo que se explica antes de este minuto.
              </label>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {it.sinGuardar && (
                <>
                  <button type="button" onClick={() => guardar(it)} disabled={!!ocupada || sinPermiso || !!err} className={`${BOTON} bg-accent text-white`} data-testid="guardar-cambios">
                    {trabajando ? <Spinner size="sm" /> : <Check size={16} />} Guardar cambios
                  </button>
                  <button type="button" onClick={() => quitarBorrador(it.id)} disabled={!!ocupada} className={`${BOTON} border border-outline-variant text-muted`}>Deshacer cambios</button>
                </>
              )}
              {it.estado !== ESTADO_REVISION.DESCARTADA && (
                <button type="button" onClick={() => setEditandoId(editando ? null : it.id)} disabled={!!ocupada || sinPermiso} className={`${BOTON} border border-outline-variant text-on-surface`}>
                  <Pencil size={16} /> {editando ? 'Cerrar edición' : 'Editar texto y respuesta'}
                </button>
              )}
              {it.estado === ESTADO_REVISION.PENDIENTE && (
                <>
                  <button type="button" onClick={() => aprobar(it)} disabled={!!ocupada || !!err || (requiereConfirmacion(it) && !confirmados[it.id])} className={`${BOTON} bg-accent text-white`} data-testid="aprobar">
                    {trabajando ? <Spinner size="sm" /> : <Check size={16} />} Aprobar
                  </button>
                  <button type="button" onClick={() => descartar(it)} disabled={!!ocupada} className={`${BOTON} border border-outline-variant text-red-700`} data-testid="descartar">
                    <X size={16} /> Descartar
                  </button>
                </>
              )}
              {it.estado === ESTADO_REVISION.DESCARTADA && !it.fueraDeLaEvaluacion && (
                <button type="button" onClick={() => restaurar(it)} disabled={!!ocupada} className={`${BOTON} border border-outline-variant text-accent`}>
                  <RotateCcw size={16} /> Restaurar como pendiente
                </button>
              )}
            </div>
            {it.fueraDeLaEvaluacion && <p className="text-xs text-muted">La aprobaste y después la eliminaste de la lista de preguntas: ya no se publica ni se reproduce en la vista previa. Para volver a usarla, agrégala a mano en la lista de preguntas.</p>}
            {esAprobada && !it.sinGuardar && <p className="text-xs text-muted">Aprobada por ti: ya forma parte de la evaluación. Para quitarla usa «Eliminar» en la lista de preguntas.</p>}
          </article>
        )
      })}

      {vistaPrevia && (
        <VistaPreviaDocenteVideo
          videoId={videoId} duracionSeg={duracionSeg} nombre={nombreActividad} items={items}
          inicioSeg={vistaPrevia.inicioSeg} reproducirAlAbrir={vistaPrevia.reproducir}
          onCerrar={() => setVistaPrevia(null)}
        />
      )}
    </section>
  )
}
