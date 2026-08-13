// Apartado 2 de "Asistente IA": Diagnóstico del grupo (FASE 2-BIS del Plan
// Maestro de IA). Dos diagnósticos independientes, que se habilitan solo
// cuando ya existen fuentes iniciales generales (ver hayFuentesGenerales en
// utils/fuentesAsignatura.js). Ninguno de los dos es ya un reporte simulado
// — corrección de Kike, 12-ago-2026, Tanda 1 (conocimientos) y Tanda 2
// (contexto): ambos crean un cuestionario REAL (categoria 'cuestionario',
// sinCalificacion:true — no cuenta para la boleta), nacen como borrador para
// revisar/editar, los estudiantes lo contestan de verdad, y el diagnóstico
// se obtiene con el mecanismo ya existente "Analizar resultados con IA"
// (botón de EvaluacionManager, sin cambios):
//   · Conocimientos — el docente elige cuántas preguntas (5 a 20, opción
//     múltiple), CON puntos (ponderarReactivos:true — el resultado es "8 de
//     10", mide qué tanto saben, sin afectar su calificación).
//   · Contexto — la IA decide cuántas preguntas dentro de 10 a 15, mezcla
//     opción múltiple y respuesta breve, SIN puntos (ponderarReactivos:false
//     — es una encuesta: no hay "correcta", solo lo que cada quien contestó).
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
import { Sparkles, RotateCcw, ClipboardList, ExternalLink, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'

function millisDe(ts) {
  return ts?.toMillis?.() || 0
}

// Mismo shape que EVALUACION_DEFAULTS.cuestionario de EvaluacionEditor.jsx/
// CrearEvaluacionIAModal.jsx — se repite aquí a propósito (ver CLAUDE.md/
// plan: no tocar esos archivos), más `sinCalificacion`/`ponderarReactivos`
// (ver SinCalificacionConfig.jsx).
function evaluacionDiagnostico(ponderarReactivos) {
  return {
    numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'libre',
    tiempoLimiteMin: null, intentosPermitidos: null, conservar: 'mejor',
    publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
    publicarRespuestas: 'inmediato', publicarRespuestasFecha: null, respuestasPublicadas: false,
    mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
    sinCalificacion: true, ponderarReactivos,
  }
}

const MIN_PREGUNTAS_CONOCIMIENTOS = 5
const MAX_PREGUNTAS_CONOCIMIENTOS = 20

// Componente compartido — crea/lista los cuestionarios de un tipo de
// diagnóstico y navega al docente a su editor real (misma ruta que OP-03/
// OP-04, /activity/:id → EvaluacionManager) para que lo revise y publique.
function DiagnosticoActividadBloque({
  subjectId, docenteId, asignaturaNombre, existingActivitiesCountP1,
  diagnosticoTipo, titulo, descripcion, operacion, nombreBase, ponderarReactivos,
  mostrarCantidad, costoDefault, descripcionModal,
}) {
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
      where('diagnosticoTipo', '==', diagnosticoTipo)
    )
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      items.sort((a, b) => millisDe(b.createdAt) - millisDe(a.createdAt))
      setActividades(items)
      setLoaded(true)
    }, () => setLoaded(true))
    return unsub
  }, [subjectId, diagnosticoTipo])

  async function generar() {
    setGenerando(true)
    try {
      const numero = actividades.length + 1
      const ref = await addDoc(collection(db, 'activities'), {
        nombre: numero > 1 ? `${nombreBase} (${numero})` : nombreBase,
        categoria: 'cuestionario', tipo: 'evaluacion', diagnosticoTipo,
        instrucciones: '', archivosAdjuntos: [], fechaLimite: null, recibirTarde: false,
        oculta: true, publishAt: null, publishedAt: null, maxCalif: 10, notificarDocente: false,
        evaluacion: evaluacionDiagnostico(ponderarReactivos),
        parcial: 1, orden: existingActivitiesCountP1 + 1, asignaturaId: subjectId, docenteId,
        createdAt: serverTimestamp(),
      })
      const params = { actividadId: ref.id, subjectId, asignaturaId: subjectId, asignaturaNombre }
      if (mostrarCantidad) params.cantidad = cantidad
      await creditosIA.ejecutar(operacion, params)
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
          <h3 className="font-semibold text-on-surface text-sm">{titulo}</h3>
          <p className="text-xs text-muted mt-0.5">{descripcion}</p>
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
          titulo={titulo}
          descripcion={descripcionModal}
          costoMin={creditosIA.estimar(operacion) ?? costoDefault}
          ejecutando={generando}
          onCancelar={() => { if (!generando) setConfirmando(false) }}
          onContinuar={generar}
        >
          {mostrarCantidad && (
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={`diag-cantidad-${diagnosticoTipo}`} className="text-sm text-on-surface">¿Cuántas preguntas quieres?</label>
              <select
                id={`diag-cantidad-${diagnosticoTipo}`}
                value={cantidad}
                disabled={generando}
                onChange={(e) => setCantidad(Number(e.target.value))}
                className="px-2 py-1 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {Array.from({ length: MAX_PREGUNTAS_CONOCIMIENTOS - MIN_PREGUNTAS_CONOCIMIENTOS + 1 }, (_, i) => MIN_PREGUNTAS_CONOCIMIENTOS + i).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          )}
        </ConfirmacionCreditosModal>
      )}
    </div>
  )
}

// Generaciones del formato ANTERIOR (reporte simulado, antes de la
// corrección de Kike del 12-ago-2026) que hayan quedado guardadas en
// subjects/{id}/diagnosticosIA — ese flujo ya no genera nada nuevo (los dos
// diagnósticos de arriba ahora crean cuestionarios reales), así que esta
// sección es SOLO para que el docente pueda borrar de inmediato lo que
// quedó mal generado. Sin botón de "generar": aquí no se crea nada.
function DiagnosticosLegadoBloque({ subjectId }) {
  const toast = useToast()
  const [historial, setHistorial] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [abierto, setAbierto] = useState(false)
  const [borrando, setBorrando] = useState(null)
  const [eliminando, setEliminando] = useState(false)

  useEffect(() => {
    const q = query(collection(db, 'subjects', subjectId, 'diagnosticosIA'))
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      items.sort((a, b) => millisDe(b.generadoEn) - millisDe(a.generadoEn))
      setHistorial(items)
      setLoaded(true)
    }, () => setLoaded(true))
    return unsub
  }, [subjectId])

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

  if (!loaded || !historial.length) return null

  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-semibold text-on-surface"
      >
        {abierto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        Diagnósticos del formato anterior ({historial.length})
      </button>
      <p className="text-xs text-muted mt-0.5">
        Generaciones de antes de esta corrección — ya no se usan para nada, solo puedes borrarlas.
      </p>
      {abierto && (
        <div className="mt-2 space-y-1.5">
          {historial.map((h) => (
            <div key={h.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-outline-variant bg-surface text-sm">
              <span className="flex-1 min-w-0 truncate">
                {h.tipo === 'contexto' ? 'Diagnóstico de contexto' : 'Diagnóstico de conocimientos'}
                {h.generadoEn?.toDate && ` · ${h.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
              </span>
              <button
                type="button"
                onClick={() => setBorrando(h.id)}
                aria-label="Eliminar"
                data-tooltip="Eliminar"
                className="p-1 text-muted hover:text-red-500 flex-shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {borrando && (
        <ConfirmModal
          title="¿Eliminar este diagnóstico?"
          message="Se borra de inmediato y no se puede deshacer. Tus fuentes y tu Perfil IA no se tocan, pero si algo más dependía de esta generación en particular (como la Planeación Didáctica Inicial), dejará de estar disponible hasta que generes otro diagnóstico."
          confirmLabel="Eliminar"
          confirmingLabel="Eliminando…"
          danger
          busy={eliminando}
          onConfirm={() => borrarEntrada(borrando)}
          onCancel={() => { if (!eliminando) setBorrando(null) }}
        />
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
          Cada cuestionario lo contestan tus estudiantes de verdad — no cuenta para su calificación.
          Cuando tengas al menos 3 respuestas, analízalo con IA desde la propia actividad.
        </p>
      </div>
      <DiagnosticoActividadBloque
        subjectId={subjectId} docenteId={docenteId} asignaturaNombre={asignaturaNombre}
        existingActivitiesCountP1={existingActivitiesCountP1}
        diagnosticoTipo="contexto"
        titulo="Diagnóstico de contexto"
        descripcion="Un cuestionario real (opción múltiple y respuesta breve) que investiga el contexto, intereses y necesidades de tus estudiantes — sin puntos, es una encuesta."
        descripcionModal="La IA usa tu Perfil, tus fuentes y tus comentarios del grupo para diseñar entre 10 y 15 preguntas — las respuestas de tus estudiantes son las que después arman el diagnóstico real."
        operacion="diagnostico_contexto"
        nombreBase="Diagnóstico de contexto"
        ponderarReactivos={false}
        mostrarCantidad={false}
        costoDefault={5}
      />
      <DiagnosticoActividadBloque
        subjectId={subjectId} docenteId={docenteId} asignaturaNombre={asignaturaNombre}
        existingActivitiesCountP1={existingActivitiesCountP1}
        diagnosticoTipo="conocimientos"
        titulo="Diagnóstico de conocimientos"
        descripcion="Un cuestionario real que tus estudiantes contestan — no cuenta para su calificación, pero te deja ver qué conocimientos previos ya tienen."
        descripcionModal="La IA usa tu Perfil para IA y tus fuentes iniciales generales ya guardadas para armar un cuestionario real. Lo revisas y publicas cuando quieras."
        operacion="diagnostico_conocimientos"
        nombreBase="Diagnóstico de conocimientos"
        ponderarReactivos
        mostrarCantidad
        costoDefault={10}
      />
      <DiagnosticosLegadoBloque subjectId={subjectId} />
    </div>
  )
}
