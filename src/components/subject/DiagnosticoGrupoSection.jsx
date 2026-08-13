// Apartado 2 de "Asistente IA": Diagnóstico del grupo (FASE 2-BIS del Plan
// Maestro de IA). Dos diagnósticos independientes, que se habilitan solo
// cuando ya existen fuentes iniciales generales (ver hayFuentesGenerales en
// utils/fuentesAsignatura.js):
//
//   · Diagnóstico de conocimientos (corrección de Kike, 12-ago-2026): YA NO
//     es un reporte simulado — el docente elige cuántas preguntas quiere (5
//     a 20, opción múltiple), la IA arma un cuestionario REAL
//     (categoria 'cuestionario', sinCalificacion:true — no cuenta para la
//     boleta), lo publica cuando esté listo, sus estudiantes lo contestan, y
//     luego se analiza con IA como cualquier evaluación (botón "Analizar
//     resultados con IA" ya existente en EvaluacionManager, sin cambios).
//   · Diagnóstico de contexto: por ahora sigue como reporte de IA a partir
//     de fuentes/Perfil/comentarios — pendiente de la misma conversión
//     (siguiente bloque de trabajo).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, onSnapshot, serverTimestamp, doc } from 'firebase/firestore'
import { addDoc, deleteDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import ConfirmModal from '../ConfirmModal'
import useCreditosIA from '../../hooks/useCreditosIA'
import { Sparkles, RotateCcw, ChevronDown, ChevronUp, ClipboardList, ExternalLink, Trash2 } from 'lucide-react'

function ListaTexto({ items, vacioTexto }) {
  if (!items?.length) return <p className="text-xs text-muted italic">{vacioTexto}</p>
  return (
    <ul className="text-sm space-y-1 list-disc pl-4">
      {items.map((t, i) => <li key={i}>{t}</li>)}
    </ul>
  )
}

function ResultadoContexto({ resultado }) {
  return (
    <div className="space-y-3 mt-2">
      <div>
        <h4 className="text-xs font-semibold text-muted uppercase mb-1">Datos encontrados</h4>
        <ListaTexto items={resultado.datosEncontrados} vacioTexto="Información no disponible en las fuentes proporcionadas." />
      </div>
      <div>
        <h4 className="text-xs font-semibold text-muted uppercase mb-1">Interpretación</h4>
        <ListaTexto items={resultado.interpretacion} vacioTexto="Sin interpretación adicional." />
      </div>
      <div>
        <h4 className="text-xs font-semibold text-muted uppercase mb-1">Aspectos que requieren atención</h4>
        <ListaTexto items={resultado.aspectosAtencion} vacioTexto="Nada que destacar." />
      </div>
      <div>
        <h4 className="text-xs font-semibold text-muted uppercase mb-1">Información faltante</h4>
        <ListaTexto items={resultado.informacionFaltante} vacioTexto="Sin información faltante detectada." />
      </div>
    </div>
  )
}

function millisDe(ts) {
  return ts?.toMillis?.() || 0
}

// Diagnóstico de CONTEXTO — sin cambios: mismo mecanismo de reporte de IA de
// siempre (bitácora en subjects/{id}/diagnosticosIA).
function DiagnosticoContextoBloque({ subjectId, docenteId, asignaturaNombre }) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const [historial, setHistorial] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [verHistorial, setVerHistorial] = useState(false)
  const [borrando, setBorrando] = useState(null) // id de la entrada a confirmar/borrar
  const [eliminando, setEliminando] = useState(false)

  useEffect(() => {
    const q = query(
      collection(db, 'subjects', subjectId, 'diagnosticosIA'),
      where('tipo', '==', 'contexto')
    )
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      items.sort((a, b) => millisDe(b.generadoEn) - millisDe(a.generadoEn))
      setHistorial(items)
      setLoaded(true)
    }, () => setLoaded(true))
    return unsub
  }, [subjectId])

  async function generar() {
    setGenerando(true)
    try {
      const data = await creditosIA.ejecutar('diagnostico_contexto', { subjectId, asignaturaId: subjectId, asignaturaNombre })
      setConfirmando(false)
      if (data?.resultado) {
        await addDoc(collection(db, 'subjects', subjectId, 'diagnosticosIA'), {
          tipo: 'contexto',
          resultado: data.resultado,
          docenteId,
          generadoEn: serverTimestamp(),
        })
        toast(data.repetida ? 'Se recuperó la generación ya hecha (sin costo adicional)' : 'Diagnóstico generado')
      }
    } catch (err) {
      setConfirmando(false)
      if (err.codigo === 'SALDO_INSUFICIENTE') {
        toast('No tienes suficientes créditos de IA para esta acción', 'error')
      } else if (err.codigo === 'PERFIL_IA_INCOMPLETO') {
        toast('Completa primero tu Perfil para IA del docente', 'error')
      } else if (err.codigo === 'SIN_FUENTES_GENERALES') {
        toast('Agrega primero un documento en Fuentes para todo el curso', 'error')
      } else {
        toast(err.message || 'El asistente de IA no está disponible en este momento', 'error')
      }
    } finally {
      setGenerando(false)
    }
  }

  const actual = historial[0] || null
  const anteriores = historial.slice(1)

  async function borrarEntrada(id) {
    setEliminando(true)
    try {
      await deleteDoc(doc(db, 'subjects', subjectId, 'diagnosticosIA', id))
      toast('Diagnóstico eliminado')
    } catch (err) {
      toast('No se pudo eliminar: ' + err.message, 'error')
    } finally {
      setEliminando(false)
      setBorrando(null)
    }
  }

  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-on-surface text-sm">Diagnóstico de contexto</h3>
          <p className="text-xs text-muted mt-0.5">
            Qué características del grupo son relevantes para tu trabajo docente — a partir de tu
            Perfil IA y tus fuentes iniciales.
          </p>
        </div>
      </div>

      {!loaded ? (
        <div className="flex justify-center py-4"><Spinner size="sm" /></div>
      ) : (
        <div className="mt-3">
          {!actual ? (
            <p className="text-xs text-muted mb-2">Estado: <span className="font-medium">No generado</span></p>
          ) : (
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs text-muted">
                Estado: <span className="font-medium text-green-700">Generado</span>
                {actual.generadoEn?.toDate && ` · ${actual.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
              </p>
              <button
                type="button"
                onClick={() => setBorrando(actual.id)}
                aria-label="Eliminar este diagnóstico"
                data-tooltip="Eliminar"
                className="p-1 text-muted hover:text-red-500 flex-shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setConfirmando(true)}
            disabled={generando}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
          >
            {generando ? <Spinner size="sm" /> : actual ? <RotateCcw size={14} /> : <Sparkles size={14} />}
            {actual ? 'Generar de nuevo' : 'Generar diagnóstico'}
          </button>

          {actual && <ResultadoContexto resultado={actual.resultado} />}

          {anteriores.length > 0 && (
            <div className="mt-3 pt-2 border-t border-outline-variant">
              <button
                type="button"
                onClick={() => setVerHistorial((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted hover:text-on-surface"
              >
                {verHistorial ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {anteriores.length} generación{anteriores.length > 1 ? 'es' : ''} anterior{anteriores.length > 1 ? 'es' : ''}
              </button>
              {verHistorial && (
                <div className="mt-2 space-y-3">
                  {anteriores.map((h) => (
                    <div key={h.id} className="opacity-70 border-t border-outline-variant pt-2">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-xs text-muted">
                          {h.generadoEn?.toDate && h.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
                        </p>
                        <button
                          type="button"
                          onClick={() => setBorrando(h.id)}
                          aria-label="Eliminar esta generación anterior"
                          data-tooltip="Eliminar"
                          className="p-1 text-muted hover:text-red-500 flex-shrink-0"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <ResultadoContexto resultado={h.resultado} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {borrando && (
        <ConfirmModal
          title="¿Eliminar este diagnóstico?"
          message="Se borra de inmediato y no se puede deshacer. No afecta tus fuentes ni tu Perfil IA."
          confirmLabel="Eliminar"
          confirmingLabel="Eliminando…"
          danger
          busy={eliminando}
          onConfirm={() => borrarEntrada(borrando)}
          onCancel={() => { if (!eliminando) setBorrando(null) }}
        />
      )}

      {confirmando && (
        <ConfirmacionCreditosModal
          titulo="Diagnóstico de contexto"
          descripcion="La IA usa tu Perfil para IA y tus fuentes iniciales generales ya guardadas — no necesitas subir nada de nuevo."
          costoMin={creditosIA.estimar('diagnostico_contexto') ?? 5}
          ejecutando={generando}
          onCancelar={() => { if (!generando) setConfirmando(false) }}
          onContinuar={generar}
        />
      )}
    </div>
  )
}

// Mismo shape que EVALUACION_DEFAULTS.cuestionario de EvaluacionEditor.jsx/
// CrearEvaluacionIAModal.jsx — se repite aquí a propósito (ver CLAUDE.md/
// plan: no tocar esos archivos), más `sinCalificacion`/`ponderarReactivos`
// (ver SinCalificacionConfig.jsx): el cuestionario de diagnóstico se
// contesta como cualquier otro, pero nunca cuenta para la boleta.
const EVALUACION_DIAGNOSTICO_CONOCIMIENTOS = {
  numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'libre',
  tiempoLimiteMin: null, intentosPermitidos: null, conservar: 'mejor',
  publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
  publicarRespuestas: 'inmediato', publicarRespuestasFecha: null, respuestasPublicadas: false,
  mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
  sinCalificacion: true, ponderarReactivos: true,
}

const MIN_PREGUNTAS_DIAG = 5
const MAX_PREGUNTAS_DIAG = 20

// Diagnóstico de CONOCIMIENTOS (corrección de Kike, 12-ago-2026) — crea un
// cuestionario real y navega al docente a su editor (misma ruta que OP-03/
// OP-04, /activity/:id → EvaluacionManager) para que lo revise y publique.
function DiagnosticoConocimientosBloque({ subjectId, docenteId, asignaturaNombre, existingActivitiesCountP1 }) {
  const toast = useToast()
  const navigate = useNavigate()
  const creditosIA = useCreditosIA()
  const [actividades, setActividades] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [cantidad, setCantidad] = useState(10)
  const [generando, setGenerando] = useState(false)

  useEffect(() => {
    const q = query(
      collection(db, 'activities'),
      where('asignaturaId', '==', subjectId),
      where('diagnosticoTipo', '==', 'conocimientos')
    )
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      items.sort((a, b) => millisDe(b.createdAt) - millisDe(a.createdAt))
      setActividades(items)
      setLoaded(true)
    }, () => setLoaded(true))
    return unsub
  }, [subjectId])

  async function generar() {
    setGenerando(true)
    try {
      const numero = actividades.length + 1
      const ref = await addDoc(collection(db, 'activities'), {
        nombre: numero > 1 ? `Diagnóstico de conocimientos (${numero})` : 'Diagnóstico de conocimientos',
        categoria: 'cuestionario', tipo: 'evaluacion', diagnosticoTipo: 'conocimientos',
        instrucciones: '', archivosAdjuntos: [], fechaLimite: null, recibirTarde: false,
        oculta: true, publishAt: null, publishedAt: null, maxCalif: 10, notificarDocente: false,
        evaluacion: EVALUACION_DIAGNOSTICO_CONOCIMIENTOS,
        parcial: 1, orden: existingActivitiesCountP1 + 1, asignaturaId: subjectId, docenteId,
        createdAt: serverTimestamp(),
      })
      await creditosIA.ejecutar('diagnostico_conocimientos', {
        actividadId: ref.id, subjectId, asignaturaId: subjectId, asignaturaNombre, cantidad,
      })
      setConfirmando(false)
      toast('Cuestionario de diagnóstico generado — revísalo y publícalo cuando esté listo')
      navigate(`/activity/${ref.id}`)
    } catch (err) {
      setConfirmando(false)
      if (err.codigo === 'SALDO_INSUFICIENTE') {
        toast('No tienes suficientes créditos de IA para esta acción', 'error')
      } else if (err.codigo === 'PERFIL_IA_INCOMPLETO') {
        toast('Completa primero tu Perfil para IA del docente', 'error')
      } else if (err.codigo === 'SIN_FUENTES_GENERALES') {
        toast('Agrega primero un documento en Fuentes para todo el curso', 'error')
      } else {
        toast(err.message || 'El asistente de IA no está disponible en este momento', 'error')
      }
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-on-surface text-sm">Diagnóstico de conocimientos</h3>
          <p className="text-xs text-muted mt-0.5">
            Un cuestionario real que tus estudiantes contestan — no cuenta para su calificación,
            pero te deja ver qué conocimientos previos ya tienen.
          </p>
        </div>
      </div>

      {!loaded ? (
        <div className="flex justify-center py-4"><Spinner size="sm" /></div>
      ) : (
        <div className="mt-3 space-y-2">
          {actividades.length === 0 ? (
            <p className="text-xs text-muted">Estado: <span className="font-medium">No generado</span></p>
          ) : (
            <div className="space-y-1.5">
              {actividades.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => navigate(`/activity/${a.id}`)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded border border-outline-variant bg-surface text-sm text-left hover:border-accent"
                >
                  <ClipboardList size={14} className="text-accent flex-shrink-0" />
                  <span className="flex-1 min-w-0 truncate">{a.nombre}</span>
                  <span className="text-xs text-muted flex-shrink-0">{a.oculta ? 'Borrador' : 'Publicado'}</span>
                  <ExternalLink size={13} className="text-muted flex-shrink-0" />
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setConfirmando(true)}
            disabled={generando}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
          >
            {generando ? <Spinner size="sm" /> : actividades.length ? <RotateCcw size={14} /> : <Sparkles size={14} />}
            {actividades.length ? 'Generar otro' : 'Generar cuestionario de diagnóstico'}
          </button>
        </div>
      )}

      {confirmando && (
        <ConfirmacionCreditosModal
          titulo="Diagnóstico de conocimientos"
          descripcion="La IA usa tu Perfil para IA y tus fuentes iniciales generales ya guardadas para armar un cuestionario real. Lo revisas y publicas cuando quieras."
          costoMin={creditosIA.estimar('diagnostico_conocimientos') ?? 10}
          ejecutando={generando}
          onCancelar={() => { if (!generando) setConfirmando(false) }}
          onContinuar={generar}
        >
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="diag-cantidad" className="text-sm text-on-surface">¿Cuántas preguntas quieres?</label>
            <select
              id="diag-cantidad"
              value={cantidad}
              disabled={generando}
              onChange={(e) => setCantidad(Number(e.target.value))}
              className="px-2 py-1 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {Array.from({ length: MAX_PREGUNTAS_DIAG - MIN_PREGUNTAS_DIAG + 1 }, (_, i) => MIN_PREGUNTAS_DIAG + i).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </ConfirmacionCreditosModal>
      )}
    </div>
  )
}

export default function DiagnosticoGrupoSection({ subjectId, docenteId, asignaturaNombre, habilitado, existingActivitiesCountP1 = 0 }) {
  if (!habilitado) {
    return (
      <div className="bg-surface-card rounded-card shadow-card p-3">
        <h2 className="font-bold text-on-surface">Diagnóstico del grupo</h2>
        <p className="text-sm text-muted mt-1">
          Agrega primero al menos un documento (arriba, en &ldquo;Fuentes para todo el curso&rdquo;)
          para poder generar los diagnósticos de este grupo.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-on-surface">Diagnóstico del grupo</h2>
        <p className="text-sm text-muted mt-0.5">
          Genera cada diagnóstico cuando quieras; puedes volver a generarlo si el resultado no
          te parece adecuado.
        </p>
      </div>
      <DiagnosticoContextoBloque subjectId={subjectId} docenteId={docenteId} asignaturaNombre={asignaturaNombre} />
      <DiagnosticoConocimientosBloque
        subjectId={subjectId} docenteId={docenteId} asignaturaNombre={asignaturaNombre}
        existingActivitiesCountP1={existingActivitiesCountP1}
      />
    </div>
  )
}
