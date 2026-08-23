// "Calificar con IA" — analiza las evidencias de una entrega (JPG/PNG/PDF/
// Word, hasta 5) contra la rúbrica o lista de cotejo YA guardada en la
// actividad, y PROPONE un nivel por criterio con su justificación
// (OP-11, 21-ago-2026, decisión de Kike: función central de valor de la IA).
//
// La IA NUNCA asigna la calificación: "Aplicar propuesta" solo PRELLENA el
// mismo `rubricEval`/comentario que ya usa la calificación manual en
// ActivityPage.jsx — el docente sigue viendo la rúbrica de siempre, puede
// cambiar cualquier nivel, y el guardado real sigue siendo el botón
// "Guardar calificación" que ya existía. Sin estructuras de datos nuevas.
//
// Dos pasos en un solo componente, mismo patrón que ConfirmacionCreditosModal:
//   1. 'confirmar' — costo (1 crédito fijo) antes de ejecutar.
//   2. 'revisar'   — la propuesta, editable, con el aviso de IA siempre
//      visible (regla del proyecto: todo contenido de IA es editable).

import { useId, useState } from 'react'
import { AlertTriangle, CircleHelp } from 'lucide-react'
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
  // Propuesta ya generada y pagada por el lote "Calificar todas con IA"
  // (ver ActivityPage.jsx) — cuando llega, el modal se abre DIRECTO en
  // 'revisar', sin volver a cobrar. `onAplicado(docId)` marca esa sugerencia
  // persistida como 'aplicada' cuando el docente confirma.
  resultadoPersistido = null, onAplicado = null,
}) {
  const c = useCreditosIA()
  const toast = useToast()
  const retroId = useId()
  const [paso, setPaso] = useState(resultadoPersistido ? 'revisar' : 'confirmar')
  const [ejecutando, setEjecutando] = useState(false)
  const [resultado, setResultado] = useState(resultadoPersistido)
  const [retro, setRetro] = useState(resultadoPersistido?.retroalimentacionGeneral || '')
  const [comprarAbierto, setComprarAbierto] = useState(false)
  const [activarAbierto, setActivarAbierto] = useState(false)

  const costo = c.estimar('calificar_entregable_ia') ?? 0.25
  const alcanza = c.saldo >= costo

  function cerrarTodo() {
    setPaso(resultadoPersistido ? 'revisar' : 'confirmar')
    setResultado(resultadoPersistido)
    setRetro(resultadoPersistido?.retroalimentacionGeneral || '')
    onClose()
  }

  async function ejecutar() {
    setEjecutando(true)
    try {
      const data = await c.ejecutar('calificar_entregable_ia', { actividadId, submissionId }, 1)
      setResultado(data.resultado)
      setRetro(data.resultado.retroalimentacionGeneral || '')
      setPaso('revisar')
    } catch (err) {
      toast(err.message || 'No se pudo calificar con IA', 'error')
      cerrarTodo()
    } finally {
      setEjecutando(false)
    }
  }

  function aplicar() {
    onAplicar(resultado.criterios, retro)
    if (resultadoPersistido?._docId) onAplicado?.(resultadoPersistido._docId)
    cerrarTodo()
  }

  const ignorados = (resultado?.ignoradosPorFormato || 0) + (resultado?.ignoradosPorTope || 0)

  return (
    <Modal open={open} onClose={cerrarTodo} title="Calificar con IA" variant="centered" size="md" busy={ejecutando}>
      {paso === 'confirmar' && (
        alcanza ? (
          <>
            <p className="text-sm text-on-surface mb-1">
              La IA analiza las evidencias que entregó el estudiante (fotos, PDF o Word — hasta 5) contra
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

      {paso === 'revisar' && resultado && (
        <>
          {/* Aviso de IA permanente — regla del proyecto: todo contenido
              generado por IA se muestra como propuesta editable, nunca
              como un hecho consumado. */}
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-card px-3 py-2.5 mb-3 text-sm text-amber-800">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <p>
              Propuesta de la IA — revísala antes de guardar, puede contener errores. Los criterios sin
              evidencia suficiente se dejan sin marcar para que tú decidas.
            </p>
          </div>

          {resultado.confianza && (
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mb-3 mr-2 ${CONFIANZA_LABEL[resultado.confianza]?.cls || CONFIANZA_LABEL.media.cls}`}>
              {CONFIANZA_LABEL[resultado.confianza]?.texto || 'Confianza media'}
            </span>
          )}

          {/* Calificación propuesta — pedido explícito de Kike (23-ago-2026):
              debe verse claramente ANTES de aplicar, y como propuesta, nunca
              como calificación ya asignada. */}
          {(() => {
            const niveles = resultado.criterios.map((c) => c.nivel)
            const totalPropuesto = totalRubrica(rubrica, niveles)
            return (
              <p className="text-sm font-semibold text-on-surface mb-3">
                {totalPropuesto != null
                  ? <>Calificación propuesta por IA: <span className="text-accent">{totalPropuesto} / {RUBRICA_TOTAL}</span></>
                  : 'Calificación propuesta por IA: pendiente — hay criterios sin evidencia suficiente, complétalos antes de guardar.'}
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
          <textarea
            id={retroId}
            value={retro}
            onChange={(e) => setRetro(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface mb-3"
          />

          {ignorados > 0 && (
            <p className="text-xs text-muted mb-3">
              {ignorados} archivo{ignorados !== 1 ? 's' : ''} de la entrega no se analizó (formato no soportado
              todavía o por encima del máximo de 5 evidencias).
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={cerrarTodo}
              className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
              Descartar
            </button>
            <button type="button" onClick={aplicar}
              className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors">
              Aplicar propuesta
            </button>
          </div>
        </>
      )}

      <ComprarCreditosModal open={comprarAbierto} onClose={() => setComprarAbierto(false)} />
      <ActivarCreditosModal open={activarAbierto} onClose={() => setActivarAbierto(false)} />
    </Modal>
  )
}
