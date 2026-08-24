// "Calificar con IA" — analiza las evidencias de una entrega (hasta 5 fotos,
// o 1 PDF, o 1 Word — una entrega es siempre UN solo tipo, nunca mezcla, ver
// src/config/fileTypes.js) contra la rúbrica o lista de cotejo YA guardada en
// la actividad, y PROPONE un nivel por criterio con su justificación
// (OP-11, 21-ago-2026, decisión de Kike: función central de valor de la IA).
//
// La IA NUNCA asigna la calificación de forma definitiva: en cuanto la
// propuesta está lista se PRECARGA sola (vía onAplicar) en el mismo
// `rubricEval`/calificación/comentario que ya usa la calificación manual en
// ActivityPage.jsx — el docente la ve y la puede editar ahí mismo, y el
// guardado real en Firestore sigue siendo el botón "Guardar calificación"
// que ya existía (23-ago-2026, pedido de Kike: "que ya solo se aplique si
// se avanza"). "Descartar" revierte ese precargado a lo que había antes de
// abrir este modal — eso lo hace el padre (ver descartarPropuestaIA en
// ActivityPage.jsx), aquí solo se distingue onDescartar de onClose.
//
// TRES estados, no dos (23-ago-2026, "toda evaluación de IA debe quedar
// consultable sin volver a cobrar"):
//   'confirmar' — costo antes de ejecutar (solo si no hay nada generado ya).
//   'revisar'   — propuesta PENDIENTE, editable, precargada sola.
//   'consultar' — evaluación YA APLICADA (`soloLectura`): se muestra igual
//      que 'revisar' pero NUNCA llama a onAplicar (no toca la calificación
//      actual, pueda haber cambiado a mano desde entonces) y el único botón
//      es "Cerrar" — nada que aplicar ni que descartar.

import { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, CircleHelp, Lock } from 'lucide-react'
import useCreditosIA from '../../hooks/useCreditosIA'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import Modal from '../ui/Modal'
import ComprarCreditosModal from '../ComprarCreditosModal'
import ActivarCreditosModal from '../ActivarCreditosModal'
import { esCotejo, totalRubrica, RUBRICA_TOTAL } from '../../utils/rubrica'

const CONFIANZA_LABEL = {
  alta: { texto: 'Confianza alta', cls: 'bg-emerald-100 text-emerald-700' },
  media: { texto: 'Confianza media', cls: 'bg-amber-100 text-amber-700' },
  baja: { texto: 'Confianza baja', cls: 'bg-red-100 text-red-700' },
}

export default function CalificarConIAModal({
  open, onClose, actividadId, submissionId, rubrica, onAplicar,
  // "Descartar" — a diferencia de onClose, le pide al padre que revierta el
  // precargado a lo que había antes de abrir este modal. No aplica en modo
  // solo-lectura (una evaluación ya aplicada no tiene nada que descartar).
  onDescartar,
  // Propuesta/evaluación ya generada y persistida (lote o individual — ver
  // ActivityPage.jsx) — cuando llega, el modal se abre DIRECTO en 'revisar'
  // o 'consultar' (según `resultadoPersistido._estado`), sin volver a
  // cobrar. `_docId` viaja a onAplicar para que el padre marque 'aplicada'
  // solo cuando el docente de verdad GUARDE la calificación.
  resultadoPersistido = null,
}) {
  const c = useCreditosIA()
  const toast = useToast()
  const retroId = useId()
  // Solo-lectura: la evaluación ya fue aplicada — consultar jamás debe
  // reescribir la calificación actual (pudo cambiar a mano desde entonces).
  const soloLectura = resultadoPersistido?._estado === 'aplicada'
  const [paso, setPaso] = useState(resultadoPersistido ? (soloLectura ? 'consultar' : 'revisar') : 'confirmar')
  const [ejecutando, setEjecutando] = useState(false)
  const [resultado, setResultado] = useState(resultadoPersistido)
  const [retro, setRetro] = useState(resultadoPersistido?.retroalimentacionGeneral || '')
  const [comprarAbierto, setComprarAbierto] = useState(false)
  const [activarAbierto, setActivarAbierto] = useState(false)
  // Precarga automática UNA sola vez por propuesta mostrada — evita
  // reaplicar en cada render y evita reaplicar si el docente ya editó
  // retro/rubricEval a mano después de la precarga inicial. En modo
  // solo-lectura nunca se marca (nunca se llama a onAplicar).
  const precargada = useRef(false)

  const costo = c.estimar('calificar_entregable_ia') ?? 0.25
  const alcanza = c.saldo >= costo

  // Calificación propuesta: preferir el valor YA CALCULADO y persistido en
  // su momento (`calificacionPropuesta`) — así "Ver evaluación de IA" sigue
  // mostrando el número original aunque la rúbrica cambie después o el
  // docente ajuste la calificación real a mano. Solo si no existe (una
  // propuesta recién generada, todavía sin persistir) se calcula al vuelo.
  function calificacionPropuestaDe(res) {
    if (!res) return null
    if (typeof res.calificacionPropuesta === 'number') return res.calificacionPropuesta
    return totalRubrica(rubrica, res.criterios.map((c2) => c2.nivel))
  }

  useEffect(() => {
    if (resultadoPersistido && !soloLectura && !precargada.current) {
      precargada.current = true
      onAplicar({ ...resultadoPersistido, calificacionPropuesta: calificacionPropuestaDe(resultadoPersistido) }, resultadoPersistido._docId || null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function cerrarTodo() {
    setPaso(resultadoPersistido ? (soloLectura ? 'consultar' : 'revisar') : 'confirmar')
    setResultado(resultadoPersistido)
    setRetro(resultadoPersistido?.retroalimentacionGeneral || '')
    onClose()
  }

  function descartar() {
    setPaso(resultadoPersistido ? 'revisar' : 'confirmar')
    setResultado(resultadoPersistido)
    setRetro(resultadoPersistido?.retroalimentacionGeneral || '')
    onDescartar()
  }

  async function ejecutar() {
    setEjecutando(true)
    try {
      const data = await c.ejecutar('calificar_entregable_ia', { actividadId, submissionId }, 1)
      const res = data.resultado
      setResultado(res)
      setRetro(res.retroalimentacionGeneral || '')
      setPaso('revisar')
      // Se precarga sola en cuanto está lista — el docente la ve y la puede
      // ajustar directo en el formulario de calificación; la CALIFICACIÓN
      // DEFINITIVA no se guarda todavía (eso sigue siendo "Guardar
      // calificación"). La propuesta en sí YA quedó persistida por el
      // servidor como 'pendiente' en cuanto se generó (mismo doc,
      // id = submissionId, que ya usa el lote) — 24-ago-2026, pedido de
      // Kike: no debe perderse solo porque el docente no guardó todavía.
      precargada.current = true
      onAplicar({ ...res, calificacionPropuesta: calificacionPropuestaDe(res) }, submissionId)
    } catch (err) {
      toast(err.message || 'No se pudo calificar con IA', 'error')
      cerrarTodo()
    } finally {
      setEjecutando(false)
    }
  }

  const ignorados = (resultado?.ignoradosPorFormato || 0) + (resultado?.ignoradosPorTope || 0)
  const titulo = paso === 'consultar' ? 'Evaluación de IA' : 'Calificar con IA'

  return (
    <Modal open={open} onClose={cerrarTodo} title={titulo} variant="centered" size="md" busy={ejecutando}>
      {paso === 'confirmar' && (
        alcanza ? (
          <>
            <p className="text-sm text-on-surface mb-1">
              La IA analiza las evidencias que entregó el estudiante (hasta 5 fotos, o 1 PDF, o 1 Word) contra
              {esCotejo(rubrica) ? ' la lista de cotejo' : ' la rúbrica'} de esta actividad, y te propone un
              nivel por criterio con su justificación. Tú revisas, ajustas y confirmas — la IA nunca guarda la
              calificación.
            </p>
            <p className="text-sm text-on-surface mb-4">
              Esta acción usará <span className="font-semibold">{costo} crédito{costo !== 1 ? 's' : ''}</span> —
              tienes <span className="font-semibold tabular-nums">{c.saldo}</span> disponibles.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cerrarTodo} disabled={ejecutando}
                className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={ejecutar} disabled={ejecutando}
                className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors disabled:opacity-60 flex items-center gap-2">
                {ejecutando && <Spinner size="sm" />}
                {ejecutando ? 'Analizando…' : 'Calificar con IA'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-on-surface mb-1">No tienes suficientes créditos para esta acción.</p>
            <p className="text-sm text-muted mb-4">
              Calificar con IA requiere {costo} crédito{costo !== 1 ? 's' : ''} y tienes {c.saldo} disponibles.
              {c.mostrarCTAActivarBienvenida && ' Puedes comprar créditos o activar tus créditos de regalo.'}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={cerrarTodo}
                className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
                Cerrar
              </button>
              {c.mostrarCTAActivarBienvenida && (
                <button type="button" onClick={() => setActivarAbierto(true)}
                  className="px-4 py-2 border border-accent text-accent text-sm font-medium rounded hover:bg-[var(--accent-tint)] transition-colors">
                  Activar créditos de regalo
                </button>
              )}
              <button type="button" onClick={() => setComprarAbierto(true)}
                className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors">
                Comprar créditos
              </button>
            </div>
          </>
        )
      )}

      {(paso === 'revisar' || paso === 'consultar') && resultado && (
        <>
          {/* Aviso de IA permanente — regla del proyecto: todo contenido
              generado por IA se muestra como propuesta editable, nunca
              como un hecho consumado. En modo consulta, el aviso deja claro
              que esto es un registro histórico, ya aplicado. */}
          {soloLectura ? (
            <div className="flex items-start gap-2 bg-surface-container border border-outline-variant rounded-card px-3 py-2.5 mb-3 text-sm text-on-surface">
              <Lock size={16} className="flex-shrink-0 mt-0.5 text-muted" />
              <p>
                Esta es la evaluación de IA que ya se aplicó a esta entrega — solo consulta, gratis. No genera un
                nuevo análisis ni cambia la calificación actual.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-card px-3 py-2.5 mb-3 text-sm text-amber-800">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <p>
                Propuesta de la IA — ya se cargó en la calificación y el comentario de al lado, para que la
                revises y la ajustes ahí mismo antes de guardar. Los criterios sin evidencia suficiente se dejan
                sin marcar para que tú decidas.
              </p>
            </div>
          )}

          {resultado.confianza && (
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mb-3 mr-2 ${CONFIANZA_LABEL[resultado.confianza]?.cls || CONFIANZA_LABEL.media.cls}`}>
              {CONFIANZA_LABEL[resultado.confianza]?.texto || 'Confianza media'}
            </span>
          )}

          {/* Calificación propuesta — pedido explícito de Kike (23-ago-2026):
              debe verse claramente ANTES de aplicar, y como propuesta, nunca
              como calificación ya asignada. En modo consulta se rotula como
              histórica, no como algo por aplicar.
              Regla que NUNCA cambia (24-ago-2026, reafirmada): si falta
              evidencia en algún criterio, la IA NO inventa ni calcula un
              total parcial — se queda "pendiente". Lo único que mejora aquí
              es la claridad: decir QUÉ criterio(s) faltan y por qué, para
              que el docente sepa exactamente qué revisar. */}
          {(() => {
            const totalPropuesto = calificacionPropuestaDe(resultado)
            const etiqueta = soloLectura ? 'La IA propuso' : 'Calificación propuesta por IA'
            if (totalPropuesto != null) {
              return (
                <p className="text-sm font-semibold text-on-surface mb-3">
                  {etiqueta}: <span className="text-accent">{totalPropuesto} / {RUBRICA_TOTAL}</span>
                </p>
              )
            }
            const faltantes = resultado.criterios
              .map((crit, i) => ({ crit, nombre: rubrica.criterios[i]?.nombre || `Criterio ${i + 1}` }))
              .filter(({ crit }) => crit.sinEvidenciaSuficiente)
              .map(({ nombre }) => nombre)
            return (
              <p className="text-sm font-semibold text-on-surface mb-3">
                {etiqueta}: pendiente
                <span className="block text-xs font-normal text-muted mt-0.5">
                  {faltantes.length === 1
                    ? `No se puede calcular una calificación completa: falta evidencia suficiente en "${faltantes[0]}".`
                    : `No se puede calcular una calificación completa: falta evidencia suficiente en ${faltantes.length} criterios (${faltantes.join(', ')}).`}
                </span>
              </p>
            )
          })()}

          <ul className="space-y-2 mb-4">
            {resultado.criterios.map((crit, i) => {
              const nombreCriterio = rubrica.criterios[i]?.nombre || `Criterio ${i + 1}`
              const nombreNivel = crit.nivel != null ? rubrica.niveles[crit.nivel]?.nombre : null
              return (
                <li key={i} className="border border-outline-variant rounded-card px-3 py-2">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-on-surface">{nombreCriterio}</p>
                    {crit.sinEvidenciaSuficiente ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-amber-700 flex-shrink-0">
                        <CircleHelp size={13} /> Sin evidencia suficiente
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-accent flex-shrink-0">
                        {esCotejo(rubrica) ? 'Cumple' : nombreNivel}
                      </span>
                    )}
                  </div>
                  {crit.evidencia && <p className="text-xs text-muted">{crit.evidencia}</p>}
                </li>
              )
            })}
          </ul>

          <label htmlFor={retroId} className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">
            Retroalimentación para el estudiante
          </label>
          {soloLectura ? (
            <p id={retroId} className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface-container text-on-surface mb-3 whitespace-pre-wrap">
              {retro || '—'}
            </p>
          ) : (
            <textarea
              id={retroId}
              value={retro}
              onChange={(e) => {
                const next = e.target.value
                setRetro(next)
                // Editar aquí reescribe el mismo comentario ya precargado —
                // sin esto, un ajuste de último momento se quedaría solo en
                // el modal y "Guardar calificación" guardaría el texto viejo.
                // El docId es siempre submissionId para cualquier propuesta
                // que vino de la IA (lote o individual) — el servidor ya la
                // persistió con ese mismo id en cuanto se generó, así que no
                // depende de `resultadoPersistido` (que es null en una
                // propuesta recién generada, antes de cerrar/reabrir).
                onAplicar({ ...resultado, retroalimentacionGeneral: next, calificacionPropuesta: calificacionPropuestaDe(resultado) }, resultadoPersistido?._docId || submissionId)
              }}
              rows={3}
              className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface mb-3"
            />
          )}

          {ignorados > 0 && (
            <p className="text-xs text-muted mb-3">
              {ignorados} archivo{ignorados !== 1 ? 's' : ''} de la entrega no se analizó (formato no soportado
              todavía o por encima del máximo de 5 evidencias).
            </p>
          )}

          <div className="flex justify-end gap-2">
            {soloLectura ? (
              <button type="button" onClick={cerrarTodo}
                className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors">
                Cerrar
              </button>
            ) : (
              <>
                <button type="button" onClick={descartar}
                  className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
                  Descartar propuesta
                </button>
                <button type="button" onClick={cerrarTodo}
                  className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors">
                  Listo, seguir calificando
                </button>
              </>
            )}
          </div>
        </>
      )}

      <ComprarCreditosModal open={comprarAbierto} onClose={() => setComprarAbierto(false)} />
      <ActivarCreditosModal open={activarAbierto} onClose={() => setActivarAbierto(false)} />
    </Modal>
  )
}
