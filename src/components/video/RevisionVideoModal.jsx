import { useEffect, useMemo, useState } from 'react'
import FocusLock from 'react-focus-lock'
import { Check, ChevronLeft, ChevronRight, Eye, Pencil, RotateCcw, X } from 'lucide-react'
import Spinner from '../Spinner'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import RecomendacionesVideo from './RecomendacionesVideo'
import ColumnaVideoRevision from './ColumnaVideoRevision'
import EvidenciaVideo from './EvidenciaVideo'
import {
  ESTADO_REVISION, FILTRO_REVISION, coincideFiltro, contarSinGuardar, leerEvidencia, moverId, ordenRevision, primeraParaRevisar,
  requiereConfirmacion, visiblesRevision,
} from './revisionVideo'

const ESTADOS = {
  [ESTADO_REVISION.PENDIENTE]: { texto: 'Pendiente', clase: 'bg-amber-100 text-amber-800', punto: 'bg-amber-400' },
  [ESTADO_REVISION.APROBADA]: { texto: 'Aprobada por ti', clase: 'bg-green-100 text-green-800', punto: 'bg-emerald-500' },
  [ESTADO_REVISION.DESCARTADA]: { texto: 'Descartada', clase: 'bg-red-100 text-red-800', punto: 'bg-red-300' },
}
const FILTROS = [[FILTRO_REVISION.ACTIVAS, 'Todas'], [FILTRO_REVISION.PENDIENTES, 'Pendientes'], [FILTRO_REVISION.DESCARTADAS, 'Descartadas']]
const BOTON = 'inline-flex items-center justify-center gap-1.5 min-h-[2.75rem] px-4 rounded-full text-sm font-semibold transition-colors disabled:opacity-60'

// LA ventana de revisión de las preguntas del video: una pregunta a la vez («Pregunta X de N»), con su video, su línea de tiempo y
// sus acciones, sin salir de aquí. Los cambios (momento, texto, opciones, respuesta) son un BORRADOR que vive en PropuestasVideoPanel:
// al ir y volver entre preguntas no se pierde nada, y no se escribe en Firestore hasta guardar o aprobar.
//
// Este archivo no importa Firebase: las escrituras salen por los manejadores que recibe del panel (los mismos de siempre:
// guardar, aprobar, descartar, restaurar), así hay una sola copia de esa lógica.
//   items         elementos de revisión con el borrador aplicado (revisionVideo.construirItems)
//   ocupada       id de la pregunta con una operación en curso
//   problema      (item) → texto del primer error de validación, o null
//   pausarVideo   la vista previa está abierta encima: se desmonta el reproductor de esta ventana (no puede haber dos)
export default function RevisionVideoModal({
  items, duracionSeg, videoId, bloqueado, ocupada, confirmados, onConfirmar, setCampos, quitarBorrador, problema,
  onGuardar, onGuardarTodos, onDeshacerTodo, onAprobar, onDescartar, onRestaurar, onVistaPrevia, onCerrar, pausarVideo = false,
}) {
  const porId = useMemo(() => Object.fromEntries(items.map((it) => [it.id, it])), [items])
  const [orden] = useState(() => ordenRevision(items)) // fijo mientras la ventana está abierta
  const [filtro, setFiltro] = useState(FILTRO_REVISION.ACTIVAS)
  const [actualId, setActualId] = useState(() => primeraParaRevisar(ordenRevision(items), Object.fromEntries(items.map((it) => [it.id, it]))))
  const [editando, setEditando] = useState(false)
  const [cerrando, setCerrando] = useState(false)

  const visibles = visiblesRevision(orden, porId, filtro, actualId)
  const item = porId[actualId] || null
  const sinGuardar = contarSinGuardar(items)

  function intentarCerrar() { if (sinGuardar > 0) setCerrando(true); else onCerrar() }
  useScrollLock(true)
  useBackHandler(() => { if (cerrando) setCerrando(false); else intentarCerrar() }, true)
  useEffect(() => {
    const alTeclear = (e) => { if (e.key === 'Escape') { if (cerrando) setCerrando(false); else intentarCerrar() } }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  })

  if (!item) return null
  const pos = Math.max(0, visibles.indexOf(actualId)) + 1
  const est = ESTADOS[item.estado]
  const trabajando = ocupada === item.id
  const sinPermiso = item.estado === ESTADO_REVISION.APROBADA && bloqueado
  const err = item.estado === ESTADO_REVISION.DESCARTADA ? null : problema(item)
  const antes = moverId(orden, porId, filtro, actualId, -1)
  const despues = moverId(orden, porId, filtro, actualId, 1)

  const ir = (id) => { if (id) { setActualId(id); setEditando(false) } }
  function cambiarFiltro(f) {
    setFiltro(f)
    if (!coincideFiltro(item, f)) ir(orden.find((id) => coincideFiltro(porId[id], f)) ?? actualId)
  }
  // Tras aprobar/descartar/restaurar con éxito, sigue la siguiente (o la anterior si era la última).
  async function resolver(accion) {
    const ok = await accion(item)
    if (ok) ir(despues ?? antes)
  }

  return (
    <FocusLock returnFocus>
      {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role --
          role="dialog" + aria-modal es el patrón de la guía WAI-ARIA para diálogos propios, el mismo de ui/Modal.jsx; esta ventana ocupa
          toda la pantalla (lleva el video) y por eso no puede ser el Modal de max-w-3xl. */}
      <div role="dialog" aria-modal="true" aria-label="Revisión de las preguntas del video" data-testid="ventana-revision"
        className="fixed top-0 left-0 w-full h-dvh z-[70] bg-surface flex flex-col">
        <header className="px-3 py-2 border-b border-outline-variant bg-surface-card space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-on-surface" data-testid="indicador-pregunta">Pregunta {pos} de {visibles.length}</h2>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${est.clase}`}>{item.fueraDeLaEvaluacion ? 'Eliminada de la evaluación' : est.texto}</span>
            {item.editada && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-surface-container text-muted">Editada por ti</span>}
            {item.sinGuardar && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900" data-testid="sin-guardar">● Sin guardar</span>}
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={() => ir(antes)} disabled={!antes} data-testid="anterior" aria-label="Pregunta anterior" className={`${BOTON} border border-outline-variant text-on-surface max-sm:px-3`}>
                <ChevronLeft size={16} /> <span className="max-sm:hidden">Anterior</span>
              </button>
              <button type="button" onClick={() => ir(despues)} disabled={!despues} data-testid="siguiente" aria-label="Pregunta siguiente" className={`${BOTON} border border-outline-variant text-on-surface max-sm:px-3`}>
                <span className="max-sm:hidden">Siguiente</span> <ChevronRight size={16} />
              </button>
              <button type="button" onClick={() => onVistaPrevia(0, false)} data-testid="vista-previa-desde-ventana"
                className={`${BOTON} border border-outline-variant text-accent`} aria-label="Vista previa docente"><Eye size={16} /><span className="max-sm:hidden">Vista previa</span></button>
              <button type="button" onClick={intentarCerrar} data-testid="cerrar-ventana" aria-label="Cerrar la revisión"
                className="w-11 h-11 rounded-full border border-outline-variant text-muted flex items-center justify-center hover:bg-surface-container"><X size={18} /></button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTROS.map(([valor, etiqueta]) => {
              const n = items.filter((it) => coincideFiltro(it, valor)).length
              return (
                <button key={valor} type="button" onClick={() => cambiarFiltro(valor)} aria-pressed={filtro === valor} data-testid={`filtro-${valor}`}
                  className={`min-h-[2.5rem] px-3 rounded-full text-xs font-semibold border ${filtro === valor ? 'bg-accent text-white border-accent' : 'border-outline-variant text-muted hover:bg-surface-container'}`}>
                  {etiqueta} ({n})
                </button>
              )
            })}
            <fieldset className="flex items-center gap-1 ml-1 min-w-0 border-0 p-0 m-0">
              <legend className="sr-only">Ir a una pregunta</legend>
              {visibles.map((id, i) => (
                <button key={id} type="button" onClick={() => ir(id)} aria-label={`Pregunta ${i + 1}${porId[id].sinGuardar ? ', con cambios sin guardar' : ''}`} aria-current={id === actualId}
                  className={`relative w-3.5 h-3.5 rounded-full ${ESTADOS[porId[id].estado].punto} ${id === actualId ? 'ring-2 ring-accent ring-offset-1' : 'opacity-70'}`}>
                  {porId[id].sinGuardar && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-accent border border-white" />}
                </button>
              ))}
            </fieldset>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)] [@media(orientation:landscape)_and_(max-height:500px)]:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]">
            {pausarVideo
              ? <div className="min-w-0 rounded-card bg-surface-container p-6 text-sm text-muted text-center">La vista previa está abierta. Ciérrala para volver al video.</div>
              : (
                <ColumnaVideoRevision videoId={videoId} duracionSeg={duracionSeg} item={item} items={items}
                  disabled={trabajando || sinPermiso || item.estado === ESTADO_REVISION.DESCARTADA}
                  onCambiar={(seg) => setCampos(item.id, { timestampSeg: seg })} />
              )}

            <div className="min-w-0 space-y-2" data-testid="pregunta-actual">
              {!editando && (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-on-surface whitespace-pre-wrap">{item.enunciado}</p>
                  {item.tipo === 'opcion_multiple' && (
                    <ul className="space-y-0.5 text-sm">
                      {(item.opciones || []).map((o) => (
                        <li key={o.id} className={o.id === item.respuestaCorrecta ? 'font-semibold text-green-800' : 'text-muted'}>
                          {o.id === item.respuestaCorrecta ? '✓ ' : '• '}{o.texto}
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.tipo === 'verdadero_falso' && <p className="text-sm font-semibold text-green-800">✓ {item.respuestaCorrecta === 'v' ? 'Verdadero' : 'Falso'}</p>}
                  {item.tipo === 'respuesta_corta' && <p className="text-xs text-hint">Respuesta abierta: tú la calificas.</p>}
                  {item.retroalimentacion && <p className="text-xs text-muted">Retroalimentación: {item.retroalimentacion}</p>}
                </div>
              )}

              {editando && (
                <div className="space-y-2 rounded-card border border-outline-variant bg-surface-card p-3" data-testid="panel-edicion">
                  <label className="block text-xs font-medium text-muted" htmlFor="rv-enun">Pregunta</label>
                  <textarea id="rv-enun" value={item.enunciado} rows={3} disabled={trabajando || sinPermiso}
                    onChange={(e) => setCampos(item.id, { enunciado: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
                  {item.tipo === 'opcion_multiple' && (
                    <div className="space-y-1.5">
                      {(item.opciones || []).map((o, j) => (
                        <div key={o.id} className="flex items-center gap-2">
                          <input type="radio" name="rv-ok" checked={item.respuestaCorrecta === o.id} disabled={trabajando || sinPermiso}
                            onChange={() => setCampos(item.id, { respuestaCorrecta: o.id })} className="accent-[var(--accent)] flex-shrink-0 w-5 h-5"
                            aria-label={`Marcar la opción ${String.fromCharCode(65 + j)} como correcta`} />
                          <input type="text" value={o.texto} disabled={trabajando || sinPermiso} aria-label={`Opción ${String.fromCharCode(65 + j)}`}
                            onChange={(e) => setCampos(item.id, { opciones: item.opciones.map((x) => (x.id === o.id ? { ...x, texto: e.target.value } : x)) })}
                            className="flex-1 px-3 py-2 rounded-full border border-outline-variant text-sm bg-surface" />
                        </div>
                      ))}
                      <p className="text-xs text-hint">Deja seleccionada la opción correcta.</p>
                    </div>
                  )}
                  {item.tipo === 'verdadero_falso' && (
                    <div className="flex gap-4">
                      {[['v', 'Verdadero'], ['f', 'Falso']].map(([val, etiqueta]) => (
                        <label key={val} className="flex items-center gap-2 text-sm min-h-[2.75rem]">
                          <input type="radio" name="rv-vf" checked={item.respuestaCorrecta === val} disabled={trabajando || sinPermiso}
                            onChange={() => setCampos(item.id, { respuestaCorrecta: val })} className="accent-[var(--accent)] w-5 h-5" />
                          {etiqueta}
                        </label>
                      ))}
                    </div>
                  )}
                  <label className="block text-xs font-medium text-muted" htmlFor="rv-retro">Retroalimentación (opcional)</label>
                  <input id="rv-retro" type="text" value={item.retroalimentacion} disabled={trabajando || sinPermiso}
                    onChange={(e) => setCampos(item.id, { retroalimentacion: e.target.value })}
                    className="w-full px-3 py-2 rounded-full border border-outline-variant text-sm bg-surface" />
                </div>
              )}

              {item.estado !== ESTADO_REVISION.DESCARTADA && (
                <button type="button" onClick={() => setEditando((v) => !v)} disabled={trabajando || sinPermiso} aria-expanded={editando} data-testid="alternar-edicion"
                  className="inline-flex items-center gap-1.5 min-h-[2.5rem] px-3 rounded-full border border-outline-variant text-xs font-semibold text-on-surface hover:bg-surface-container disabled:opacity-60">
                  <Pencil size={14} /> {editando ? 'Cerrar edición' : 'Editar pregunta'}
                </button>
              )}

              {leerEvidencia(item.respaldo)
                ? <EvidenciaVideo item={item} />
                : <p className="text-xs text-muted" data-testid="sin-evidencia">Sin evidencia guardada de dónde salió esta pregunta: comprueba el momento viendo el video.</p>}
              {sinPermiso && <p className="text-xs text-amber-900">El parcial está cerrado: puedes verla y probarla, pero ya no se puede cambiar.</p>}
              {item.fueraDeLaEvaluacion && <p className="text-xs text-muted">La aprobaste y después la eliminaste de la lista de preguntas: ya no se publica. Para volver a usarla, agrégala a mano en la lista de preguntas.</p>}
              {err && <p role="alert" className="text-xs text-error">{err}</p>}
              {requiereConfirmacion(item) && item.estado === ESTADO_REVISION.PENDIENTE && (
                <label className="flex items-start gap-2 text-xs text-amber-950 bg-amber-50 rounded px-2 py-2">
                  <input type="checkbox" checked={!!confirmados[item.id]} onChange={(e) => onConfirmar(item.id, e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
                  Vi el video y comprobé que esta pregunta y su respuesta corresponden a lo que se explica antes de este minuto.
                </label>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-outline-variant">
                {item.sinGuardar && (
                  <>
                    <button type="button" onClick={() => onGuardar(item)} disabled={!!ocupada || sinPermiso || !!err} className={`${BOTON} bg-accent text-white`} data-testid="guardar-actual">
                      {trabajando ? <Spinner size="sm" /> : <Check size={16} />} Guardar
                    </button>
                    <button type="button" onClick={() => quitarBorrador(item.id)} disabled={!!ocupada} className={`${BOTON} border border-outline-variant text-muted`}>Deshacer</button>
                  </>
                )}
                {sinGuardar > (item.sinGuardar ? 1 : 0) && (
                  <button type="button" onClick={onGuardarTodos} disabled={!!ocupada} className={`${BOTON} border border-accent text-accent`} data-testid="guardar-todo">
                    Guardar todo ({sinGuardar})
                  </button>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {item.estado === ESTADO_REVISION.PENDIENTE && (
                    <>
                      <button type="button" onClick={() => resolver(onDescartar)} disabled={!!ocupada} className={`${BOTON} border border-outline-variant text-red-700`} data-testid="descartar">
                        <X size={16} /> Descartar
                      </button>
                      <button type="button" onClick={() => resolver(onAprobar)} disabled={!!ocupada || !!err || (requiereConfirmacion(item) && !confirmados[item.id])} className={`${BOTON} bg-accent text-white`} data-testid="aprobar">
                        {trabajando ? <Spinner size="sm" /> : <Check size={16} />} Aprobar
                      </button>
                    </>
                  )}
                  {item.estado === ESTADO_REVISION.DESCARTADA && !item.fueraDeLaEvaluacion && (
                    <button type="button" onClick={() => resolver(onRestaurar)} disabled={!!ocupada} className={`${BOTON} border border-outline-variant text-accent`} data-testid="restaurar">
                      <RotateCcw size={16} /> Restaurar como pendiente
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="px-3 pb-3"><RecomendacionesVideo compacto /></div>
        </div>

        {cerrando && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 px-4" data-testid="confirmar-cierre">
            <div role="alertdialog" aria-modal="true" aria-label="Cambios sin guardar" className="bg-surface-card rounded-card shadow-2xl p-5 max-w-sm w-full space-y-3">
              <h3 className="text-base font-bold text-on-surface">Tienes cambios sin guardar</h3>
              <p className="text-sm text-muted">{sinGuardar === 1 ? 'Hay 1 pregunta con cambios' : `Hay ${sinGuardar} preguntas con cambios`} que todavía no se guardaron.</p>
              <div className="flex flex-col gap-2">
                <button type="button" className={`${BOTON} bg-accent text-white`} data-testid="cierre-guardar" disabled={!!ocupada}
                  onClick={async () => { if (await onGuardarTodos()) onCerrar(); else setCerrando(false) }}>Guardar y cerrar</button>
                <button type="button" className={`${BOTON} border border-outline-variant text-red-700`} data-testid="cierre-descartar" disabled={!!ocupada}
                  onClick={() => { onDeshacerTodo(); onCerrar() }}>Descartar los cambios y cerrar</button>
                <button type="button" className={`${BOTON} border border-outline-variant text-on-surface`} data-testid="cierre-seguir" onClick={() => setCerrando(false)}>Seguir editando</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </FocusLock>
  )
}
