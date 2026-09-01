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
import { addDoc, deleteDoc, setDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import ConfirmModal from '../ConfirmModal'
import useCreditosIA from '../../hooks/useCreditosIA'
import useDiagnosticoEstado from '../../hooks/useDiagnosticoEstado'
import AvisoPerfilIA from './AvisoPerfilIA'
import { Sparkles, ClipboardList, ExternalLink, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'

function millisDe(ts) {
  return ts?.toMillis?.() || 0
}

// Señal visual del estado real (ver useDiagnosticoEstado) — discreta,
// integrada en el bloque existente, sin pantalla ni botón nuevo.
const ESTADO_BADGE = {
  pendiente: { texto: 'Pendiente de respuestas', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  analizable: { texto: 'Resultados disponibles — analizar con IA', className: 'bg-orange-50 text-orange-700 border-orange-200' },
  completado: { texto: 'Completado — análisis disponible', className: 'bg-green-50 text-green-700 border-green-200' },
}

function EstadoDiagnosticoBadge({ estado }) {
  const info = ESTADO_BADGE[estado] || ESTADO_BADGE.pendiente
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${info.className}`}>
      {info.texto}
    </span>
  )
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

const RANGO_PREGUNTAS = {
  conocimientos: { min: 5, max: 20 },
  contexto: { min: 10, max: 15 },
}

// Componente compartido — crea/lista los cuestionarios de un tipo de
// diagnóstico y navega al docente a su editor real (misma ruta que OP-03/
// OP-04, /activity/:id → EvaluacionManager) para que lo revise y publique.
// Nombre e instrucciones los propone la IA (corrección de Kike, 13-ago-2026
// — toda actividad generada con IA debe traer ya su nombre y sus
// instrucciones, el docente decide después si los deja o los edita, mismo
// criterio que crear_actividad_ia/OP-05): la actividad nace con `nombre: ''`
// y el ejecutor del servidor la llena.
function DiagnosticoActividadBloque({
  subjectId, docenteId, asignaturaNombre, existingActivitiesCountP1,
  diagnosticoTipo, titulo, descripcion, operacion, ponderarReactivos,
  mostrarCantidad, mostrarPeticion, placeholderPeticion, costoDefault, descripcionModal,
  configKey, perfilIACompleto = false,
}) {
  const toast = useToast()
  const navigate = useNavigate()
  const creditosIA = useCreditosIA()
  const [actividades, setActividades] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const rango = RANGO_PREGUNTAS[diagnosticoTipo] || { min: 5, max: 20 }
  const [cantidad, setCantidad] = useState(rango.min)
  const [peticion, setPeticion] = useState('')
  const [generando, setGenerando] = useState(false)
  const { estado: estadoDiagnostico, cargado: estadoCargado } = useDiagnosticoEstado(subjectId, diagnosticoTipo)
  // Palomeado por el docente (Kike, 14-ago-2026): se marca aquí mismo, en la
  // tarjeta de cada diagnóstico — por omisión true.
  const [incluir, setIncluir] = useState(true)
  const [guardandoIncluir, setGuardandoIncluir] = useState(false)

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

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), (snap) => {
      setIncluir(snap.data()?.incluirEnPlaneacion?.[configKey] !== false)
    })
    return unsub
  }, [subjectId, configKey])

  async function toggleIncluir(checked) {
    setIncluir(checked)
    setGuardandoIncluir(true)
    try {
      await setDoc(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), {
        docenteId,
        incluirEnPlaneacion: { [configKey]: checked },
      }, { merge: true })
    } catch (err) {
      setIncluir(!checked)
      toast('No se pudo guardar: ' + err.message, 'error')
    } finally {
      setGuardandoIncluir(false)
    }
  }

  async function generar() {
    setGenerando(true)
    try {
      const ref = await addDoc(collection(db, 'activities'), {
        nombre: '', // la IA lo llena — ver ejecutarDiagnostico(Contexto|Conocimientos) en functions/ia.js
        categoria: 'cuestionario', tipo: 'evaluacion', diagnosticoTipo,
        instrucciones: '', archivosAdjuntos: [], fechaLimite: null, recibirTarde: false,
        oculta: true, publishAt: null, publishedAt: null, maxCalif: 10, notificarDocente: false,
        evaluacion: evaluacionDiagnostico(ponderarReactivos),
        parcial: 1, orden: existingActivitiesCountP1 + 1, asignaturaId: subjectId, docenteId,
        createdAt: serverTimestamp(),
      })
      const params = { actividadId: ref.id, subjectId, asignaturaId: subjectId, asignaturaNombre }
      if (mostrarCantidad) params.cantidad = cantidad
      if (mostrarPeticion && peticion.trim()) params.queQuieresIndagar = peticion.trim()
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
      } else if (err.codigo === 'SIN_PROGRAMA_ESTUDIOS') {
        toast('Sube primero el programa de estudios', 'error')
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
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {loaded && actividades.length > 0 && estadoCargado && (
            <EstadoDiagnosticoBadge estado={estadoDiagnostico} />
          )}
          <label className="flex items-center gap-1.5 text-xs text-on-surface cursor-pointer select-none">
            <input
              type="checkbox"
              checked={incluir}
              disabled={guardandoIncluir}
              onChange={(e) => toggleIncluir(e.target.checked)}
            />
            Incluir en la Planeación
          </label>
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

          {/* Es de una sola vez, al arrancar el curso — nunca "Generar otro"
              (decisión de Kike, 13-ago-2026 y reforzada 15-ago-2026: un
              segundo instrumento solo crea el estado ambiguo que el propio
              precheck de Planeación bloquea con "elimina los que no vayas a
              usar"). Con uno ya generado, aquí solo se ve su estado; si el
              docente quiere uno distinto, lo elimina desde Actividades y
              este botón reaparece solo. */}
          {actividades.length === 0 ? (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              disabled={generando || !perfilIACompleto}
              title={!perfilIACompleto ? 'Completa tu Perfil para IA del docente para generar los diagnósticos' : undefined}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
            >
              {generando ? <Spinner size="sm" /> : <Sparkles size={14} />}
              Generar cuestionario de diagnóstico
            </button>
          ) : estadoDiagnostico === 'completado' ? (
            <p className="text-xs text-green-700">
              Diagnóstico completado — este es el que usa la Planeación Didáctica Inicial.
            </p>
          ) : (
            <p className="text-xs text-muted">
              Ya lo generaste — publícalo y espera respuestas de tus estudiantes para poder usarlo en la
              Planeación. Si quieres uno distinto, elimínalo desde Actividades.
            </p>
          )}
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
            <div className="flex items-center justify-between gap-3 mb-2">
              <label htmlFor={`diag-cantidad-${diagnosticoTipo}`} className="text-sm text-on-surface">¿Cuántas preguntas quieres?</label>
              <select
                id={`diag-cantidad-${diagnosticoTipo}`}
                value={cantidad}
                disabled={generando}
                onChange={(e) => setCantidad(Number(e.target.value))}
                className="px-2 py-1 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {Array.from({ length: rango.max - rango.min + 1 }, (_, i) => rango.min + i).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          )}
          {mostrarPeticion && (
            <div>
              <label htmlFor={`diag-peticion-${diagnosticoTipo}`} className="block text-sm text-on-surface mb-1">
                ¿Qué quieres indagar en particular? <span className="text-muted font-normal">(opcional)</span>
              </label>
              <textarea
                id={`diag-peticion-${diagnosticoTipo}`}
                value={peticion}
                disabled={generando}
                rows={3}
                onChange={(e) => setPeticion(e.target.value)}
                placeholder={placeholderPeticion}
                className="w-full px-2.5 py-1.5 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
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

export default function DiagnosticoGrupoSection({ subjectId, docenteId, asignaturaNombre, habilitado, perfilIACompleto = false, existingActivitiesCountP1 = 0 }) {
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
        {/* Los dos diagnósticos se generan con IA, así que aquí sí hace falta
            el Perfil IA (el servidor lo revalida en precheckDiagnosticoBase).
            Antes esto lo cubría el candado de la pestaña entera; ahora vive
            junto a lo que de verdad lo necesita. */}
        {!perfilIACompleto && (
          <div className="mt-2">
            <AvisoPerfilIA que="generar los diagnósticos con Evalúa Fácil" />
          </div>
        )}
      </div>
      <DiagnosticoActividadBloque
        subjectId={subjectId} docenteId={docenteId} asignaturaNombre={asignaturaNombre}
        existingActivitiesCountP1={existingActivitiesCountP1}
        diagnosticoTipo="contexto"
        configKey="diagContexto"
        perfilIACompleto={perfilIACompleto}
        titulo="Diagnóstico de contexto"
        descripcion="Un cuestionario real (opción múltiple y respuesta breve) que investiga el contexto, intereses y necesidades de tus estudiantes — sin puntos, es una encuesta."
        descripcionModal="La IA usa tu Perfil, tus fuentes y tus comentarios del grupo para diseñar el instrumento — las respuestas de tus estudiantes son las que después arman el diagnóstico real."
        operacion="diagnostico_contexto"
        ponderarReactivos={false}
        mostrarCantidad
        mostrarPeticion
        placeholderPeticion="Ej: Me interesa saber si tienen computadora o internet en casa, y qué tanto usan el celular para estudiar."
        costoDefault={5}
      />
      <DiagnosticoActividadBloque
        subjectId={subjectId} docenteId={docenteId} asignaturaNombre={asignaturaNombre}
        existingActivitiesCountP1={existingActivitiesCountP1}
        diagnosticoTipo="conocimientos"
        configKey="diagConocimientos"
        perfilIACompleto={perfilIACompleto}
        titulo="Diagnóstico de conocimientos"
        descripcion="Un cuestionario real que tus estudiantes contestan — no cuenta para su calificación, pero te deja ver qué conocimientos previos ya tienen."
        descripcionModal="La IA usa tu Perfil para IA y tus fuentes iniciales generales ya guardadas para armar un cuestionario real. Lo revisas y publicas cuando quieras."
        operacion="diagnostico_conocimientos"
        ponderarReactivos
        mostrarCantidad
        costoDefault={10}
      />
      <DiagnosticosLegadoBloque subjectId={subjectId} />
    </div>
  )
}
