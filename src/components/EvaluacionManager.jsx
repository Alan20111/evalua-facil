import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, query, where, getDocs, getDoc, doc, serverTimestamp, onSnapshot,
} from 'firebase/firestore'
// Escrituras a través del candado de suscripción vencida (ver utils/firestoreGuard.js).
import { addDoc, setDoc, updateDoc, deleteDoc, writeBatch } from '../utils/firestoreGuard'
import { db, auth } from '../firebase'
import { useToast } from './Toast'
import Spinner from './Spinner'
import { sanitizeHtml, richTextContentClass, toRichHtml } from '../utils/sanitizeHtml'
import { formatDeadline, formatPublishAt } from '../utils/activityVisibility'
import { nowIsoLocal as toIsoNow } from '../utils/nowIso'
import { matchesStudentSearch, studentFullName } from '../utils/studentSearch'
import { IS_NATIVE_APP } from '../utils/platform'
import { uploadToCloudinary } from '../utils/cloudinary'
import EFDateTimePicker from './EFDateTimePicker'
import SearchInput from './SearchInput'
import Select from './ui/Select'
import { TEACHER_CONTAINER_NARROW } from '../config/layout'
import {
  calcularEstadisticasGrupo, calcularCalificacion, resolverPendienteRevision,
  resolverCalificacionFinal, TIPOS_REVISION_MANUAL, repartirPonderacionParejo,
} from '../utils/evaluacionGrading'
import {
  ArrowLeft, Plus, Trash2, Library, Users, Pencil, Copy, Image as ImageIcon, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Clock, CalendarDays, Star,
  Scale, CheckSquare, Square, X, FileSpreadsheet, FileText, Sparkles,
} from 'lucide-react'
import useCreditosIA from '../hooks/useCreditosIA'
import ConfirmacionCreditosModal from './ConfirmacionCreditosModal'
import { estadoEvaluacionLabel } from '../utils/evaluacionGrading'
import { cargarRespuestasEvaluacion, esGraficable } from '../utils/evaluacionRespuestas'
import { exportEvaluacionResultadosExcel } from '../utils/excel'
import { exportEvaluacionResultadosPDF, exportAnalisisResultadosPDF } from '../utils/pdf'
import { descargaSoloWeb } from '../utils/descargaSoloWeb'
import { membreteDe } from '../utils/membrete'
import { useAuth } from '../context/AuthContext'
import { useSubscription } from '../hooks/useSubscription'
import { hasCleanExports } from '../utils/subscriptionHelpers'
import ConfirmModal from './ConfirmModal'
import EvaluacionAnswerList from './EvaluacionAnswerList'
import EvaluacionStatsPanel from './EvaluacionStatsPanel'
import EvaluacionGraficas from './EvaluacionGraficas'
import PublicacionScheduler from './PublicacionScheduler'
import SinCalificacionConfig from './SinCalificacionConfig'
import { SeccionForm, SeccionHeader, ConfirmarBorrarSeccion, BotonAgregarSeccion, SelectorSeccion } from './SeccionesEditor'
import { useSecciones } from '../hooks/useSecciones'
import { agruparPreguntas, preguntasEnOrden, siguienteOrden } from '../utils/secciones'
import {
  crearPregunta, actualizarPregunta, borrarPregunta, crearPreguntasEnLote,
  cargarPreguntasConClave,
} from '../utils/evaluacionClave'
import EvaluacionEditor from './EvaluacionEditor'
import AnalisisResultadosIA from './evaluacion/AnalisisResultadosIA'
import { resolverNombresAnalisis } from '../utils/resolverNombresAnalisis'
import { MIN_ENTREGAS_ANALISIS } from '../utils/analisisResultados'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'
import { formatHora12FromDate } from '../utils/formatHora'

const TIPOS_PREGUNTA = [
  { value: 'opcion_multiple', label: 'Opción múltiple' },
  { value: 'verdadero_falso', label: 'Verdadero / Falso' },
  { value: 'respuesta_corta', label: 'Respuesta corta' },
  { value: 'subir_archivo', label: 'Subir documento' },
]
// Ver el comentario homónimo en EvaluacionEditor.jsx — mismo patrón, este
// archivo tiene su propia copia del formulario de preguntas (pestaña
// "Preguntas" de Administrar, alcanzable aparte del editor de pantalla
// completa), así que necesita el mismo cambio por separado.
function makeOption(texto = '', esOtra = false) {
  return { id: `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, texto, esOtra }
}
function emptyOpciones() {
  return [makeOption(), makeOption(), makeOption(), makeOption()]
}
function emptyPregunta() {
  const opciones = emptyOpciones()
  return {
    tipo: 'opcion_multiple', enunciado: '', opciones,
    respuestaCorrecta: opciones[0].id, vfRespuesta: 'v', ponderacion: 1, retroalimentacion: '',
    imagenFile: null, guardarEnBanco: false, tema: '',
  }
}
function opcionesFromExisting(p) {
  if (p.tipo !== 'opcion_multiple' || !p.opciones?.length) return emptyOpciones()
  return p.opciones.map((o) => ({ id: o.id, texto: o.texto || '', esOtra: !!o.esOtra }))
}

const TABS = [
  { key: 'preguntas', label: 'Preguntas' },
  { key: 'config', label: 'Configuración' },
  { key: 'resultados', label: 'Resultados' },
]

function fmtHora(ts) {
  if (!ts?.seconds) return '—'
  const d = new Date(ts.seconds * 1000)
  return `${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, ${formatHora12FromDate(d)}`
}
function fmtDuracion(inicio, fin) {
  if (!inicio?.seconds || !fin?.seconds) return '—'
  const min = Math.round((fin.seconds - inicio.seconds) / 60)
  return `${min} min`
}

// Manages everything specific to `activity.tipo === 'evaluacion'`: questions,
// the question bank, evaluación settings, group results, and manual review
// of open-ended (respuesta_corta) answers. Lives outside teacher/ActivityPage.jsx
// (already very large) and is rendered in its place whenever the activity is
// an evaluación.
// `backState` (optional): router state for the back arrow — e.g. { tab: 'calificaciones' }
// when the teacher arrived from a grades-table cell, so going back lands there.
// `openStudentId` (optional): scroll to and highlight that student's result row
// (set when the teacher clicked that student's cell in the grades table).

// Ver el comentario homónimo en EvaluacionEditor.jsx.
function OpcionesEditor({ opciones, respuestaCorrecta, onChange, onChangeCorrecta, radioName, compact }) {
  const inputPad = compact ? 'px-2 py-1' : 'px-3 py-1.5'
  return (
    <div className="space-y-1.5">
      {opciones.map((o, idx) => (
        <div key={o.id} className="flex items-center gap-2">
          {o.esOtra ? (
            <>
              <span className="w-3.5 flex-shrink-0" />
              <span className={`flex-1 ${inputPad} rounded border border-dashed border-outline-variant text-sm text-muted italic`}>
                Otra: el alumno escribe su propia respuesta
              </span>
            </>
          ) : (
            <>
              <input type="radio" name={radioName} checked={respuestaCorrecta === o.id}
                onChange={() => onChangeCorrecta(o.id)} className="accent-[var(--accent)] flex-shrink-0" />
              <input type="text" value={o.texto}
                onChange={(e) => onChange(opciones.map((x) => x.id === o.id ? { ...x, texto: e.target.value } : x))}
                placeholder={`Opción ${String.fromCharCode(65 + idx)}`} required={idx < 2}
                className={`flex-1 ${inputPad} rounded border border-outline-variant text-sm bg-surface`} />
            </>
          )}
          {idx >= 2 && (
            <button type="button" aria-label={`Quitar opción ${String.fromCharCode(65 + idx)}`}
              onClick={() => {
                const next = opciones.filter((x) => x.id !== o.id)
                onChange(next)
                if (respuestaCorrecta === o.id) onChangeCorrecta(next.find((x) => !x.esOtra)?.id ?? null)
              }}
              className="p-2 text-slate-400 hover:text-error rounded flex-shrink-0">
              <X size={16} />
            </button>
          )}
        </div>
      ))}
      <div className="flex gap-3 pt-0.5">
        <button type="button" onClick={() => onChange([...opciones, makeOption()])}
          className="text-xs font-medium text-accent hover:underline flex items-center gap-1">
          <Plus size={13} /> Agregar opción
        </button>
        {!opciones.some((o) => o.esOtra) && (
          <button type="button" onClick={() => onChange([...opciones, makeOption('Otra', true)])}
            className="text-xs font-medium text-accent hover:underline flex items-center gap-1">
            <Plus size={13} /> Agregar opción Otra
          </button>
        )}
      </div>
    </div>
  )
}
// Bitácora de OP-10: `generadoEn` es un Timestamp de Firestore en los docs
// recién leídos del servidor, o un Date de JS en la entrada optimista que se
// agrega localmente justo después de generar un análisis nuevo.
function millisDeGeneradoEn(x) {
  if (!x) return 0
  if (typeof x.toMillis === 'function') return x.toMillis()
  if (x instanceof Date) return x.getTime()
  return new Date(x).getTime() || 0
}

export default function EvaluacionManager({ activity, subject, activityId, activityLabel, contextLine, students, submissions, onActivityChange, onSubmissionRemoved = null, onSubmissionUpdated = null, resultadosOnly = false, backState = null, openStudentId = null, onDeleteActivity = null }) {
  const navigate = useNavigate()
  const toast = useToast()
  // Sin suscripción activa, todo lo que se exporta lleva marca de agua —
  // mismo criterio que las exportaciones de la asignatura.
  const { subscription } = useSubscription()
  const exportsWatermarked = !hasCleanExports(subscription)
  // Créditos de IA — estimación y ejecución del piloto C-02.
  const creditosIA = useCreditosIA()
  // Escuela + docente para encabezar los documentos que se descargan de aquí.
  const { userProfile } = useAuth()
  const membrete = membreteDe(userProfile)
  // Full-screen EvaluacionEditor — the SAME editor "editar" opens from the
  // parcial list; the header pencil opens it here too.
  const [showEvalEditor, setShowEvalEditor] = useState(false)
  // Reuses `closeEvalEditor` (defined below, hoisted) — same close path as
  // the editor's own "Volver" button.
  useBackHandler(closeEvalEditor, showEvalEditor)
  const editingTabsVisible = !resultadosOnly
  const [tab, setTab] = useState(resultadosOnly ? 'resultados' : 'preguntas')
  // Cancel a student's submission (delete the intento + its answers)
  const [cancelConfirm, setCancelConfirm] = useState(null) // { student, sub } | null
  useBackHandler(() => setCancelConfirm(null), !!cancelConfirm)
  useScrollLock(!!cancelConfirm)
  const [cancelling, setCancelling] = useState(false)
  const [preguntas, setPreguntas] = useState([])
  const [loadingPreguntas, setLoadingPreguntas] = useState(true)
  const [showPreguntaForm, setShowPreguntaForm] = useState(false)
  const [preguntaForm, setPreguntaForm] = useState(emptyPregunta)
  const [saving, setSaving] = useState(false)
  const [banco, setBanco] = useState([])
  const [bancoLoaded, setBancoLoaded] = useState(false)
  const [showBanco, setShowBanco] = useState(false)
  useBackHandler(() => setShowBanco(false), showBanco)
  useScrollLock(showBanco)
  // Per-reactivo pie charts overlay — owns its own useBackHandler/useScrollLock
  // (same pattern as ZoomableImage's overlay), so just a flag here.
  const [showGraficas, setShowGraficas] = useState(false)
  // Exportación de los resultados de ESTA evaluación (Excel / PDF). `null`
  // cuando no se está generando nada; 'excel' | 'pdf' mientras corre, para
  // desactivar solo el botón que se tocó. `pendingExport` es el aviso ÚNICO
  // de "exportación en periodo de prueba" para TODAS las descargas de esta
  // pantalla (resultados, Excel/PDF, y los PDF de OP-10) — guarda `{ run }`,
  // la descarga concreta a ejecutar si el docente continúa; si cancela, no
  // se genera nada.
  const [exportingResultados, setExportingResultados] = useState(null)
  const [pendingExport, setPendingExport] = useState(null)
  const [editingPreguntaId, setEditingPreguntaId] = useState(null)
  const [preguntaEditForm, setPreguntaEditForm] = useState(null)
  const [bancoSearch, setBancoSearch] = useState('')
  const [bancoTemaFilter, setBancoTemaFilter] = useState('')
  const [bancoMateriaFilter, setBancoMateriaFilter] = useState('')
  // Selección múltiple para agregar varios reactivos del banco de un jalón
  // (pedido explícito) — mismo patrón que EvaluacionEditor.jsx.
  const [selectedBancoIds, setSelectedBancoIds] = useState(() => new Set())
  // Single afterglow: at most ONE reactivo (bank or preguntas list) keeps
  // the accent highlight — the most recently edited/created one. Starting a
  // new edit/creation moves the focus there.
  const [glowId, setGlowId] = useState(null)
  // Snapshots taken when an edit form opens — Guardar stays disabled until
  // something actually changed
  const bancoEditSnap = useRef(null)
  const preguntaEditSnap = useRef(null)
  // Config baseline — the save button only lights up when something changed
  const configSnap = useRef(JSON.stringify(activity.evaluacion))
  const [editingBancoId, setEditingBancoId] = useState(null)
  const [bancoEditForm, setBancoEditForm] = useState(null)
  const [configForm, setConfigForm] = useState(activity.evaluacion)
  const [savingConfig, setSavingConfig] = useState(false)
  const [filtroResultados, setFiltroResultados] = useState('todos')
  const [searchResultados, setSearchResultados] = useState('')
  // Full-screen answer review. submission is null when "No realizado".
  const [reviewing, setReviewing] = useState(null) // { student, submission, allRespuestas }
  // Same conditional as the review's own "Regresar" button: if we arrived from
  // a grades-table cell (backState present), go straight back there instead of
  // just closing the review — never leave the teacher stranded on Resultados.
  function goBackFromReview() {
    if (backState) navigate(`/subject/${activity.asignaturaId}`, { state: backState })
    else setReviewing(null)
  }
  useBackHandler(goBackFromReview, !!reviewing)
  useScrollLock(!!reviewing)
  // Calificación manual de reactivos (respuesta corta / subir documento):
  // borrador por pregunta { puntos, comentario } mientras el docente edita.
  const [gradeDrafts, setGradeDrafts] = useState({})
  const [savingGradeId, setSavingGradeId] = useState(null)
  // C-02 · Sugerir calificación con IA (piloto). Las sugerencias PERSISTEN en
  // activities/{id}/iaSugerencias (las escribe el servidor al cobrarlas): el
  // snapshot las recupera aunque el docente cierre o recargue la pestaña, y
  // verlas de nuevo jamás cobra. La IA no escribe calificaciones (O3): el
  // docente aplica/edita cada sugerencia y su guardado la marca 'aplicada'.
  const [iaSugerencias, setIaSugerencias] = useState({}) // { [subId]: { [pregId]: sugerencia } }
  useEffect(() => {
    const actId = activityId || activity?.id
    if (!actId) return undefined
    const q = query(collection(db, 'activities', actId, 'iaSugerencias'), where('estado', '==', 'pendiente'))
    const unsub = onSnapshot(q, (snap) => {
      const mapa = {}
      snap.docs.forEach((d) => {
        const x = d.data()
        if (!mapa[x.sub]) mapa[x.sub] = {}
        mapa[x.sub][x.preg] = { ...x.sugerencia, _docId: d.id }
      })
      setIaSugerencias(mapa)
    }, () => { /* sin permiso u offline: sin sugerencias que recuperar */ })
    return unsub
  }, [activityId, activity?.id])
  const [iaContando, setIaContando] = useState(false)
  const [iaConteo, setIaConteo] = useState(null)         // { estudiantes, respuestas } → abre el modal
  const [iaTrabajando, setIaTrabajando] = useState(false)
  // ── OP-10 · Analizar resultados con IA ──────────────────────────────────
  const [analisisConfirmando, setAnalisisConfirmando] = useState(false)
  const [analisisTrabajando, setAnalisisTrabajando] = useState(false)
  const [analisisResultado, setAnalisisResultado] = useState(null)
  const [analisisGeneradoEn, setAnalisisGeneradoEn] = useState(null) // ISO string — solo para mostrar/imprimir
  const [analisisId, setAnalisisId] = useState(null) // doc en activities/{id}/analisisIA que se está viendo — null = todavía no persistido
  const [analisisHistorial, setAnalisisHistorial] = useState([]) // bitácora de OP-10: un doc por generación, ver activities/{id}/analisisIA
  const [analisisDescargandoId, setAnalisisDescargandoId] = useState(null)
  const [reviewFilter, setReviewFilter] = useState('todos') // review tab: todos|pendiente|calificado|porCalificar
  const [reviewNav, setReviewNav] = useState([])            // frozen student order for Anterior/Siguiente
  // Per-student deadline extension ("Modificar fecha de entrega") — en
  // Android es una ventana flotante (igual que ActivityPage.jsx) en vez de
  // un formulario en línea, para que el alto del aside no varíe.
  const [extendMode, setExtendMode] = useState(false)
  const [extendDate, setExtendDate] = useState('')
  const [extendMotivo, setExtendMotivo] = useState('')
  const [savingExtension, setSavingExtension] = useState(false)
  useBackHandler(() => setExtendMode(false), IS_NATIVE_APP && extendMode)
  // Student to open on arrival from a grades-table cell
  const [pendingOpenId, setPendingOpenId] = useState(openStudentId)
  // Mientras se abre esa revisión se muestra SOLO un spinner — sin esto, la
  // pantalla de resultados se alcanza a ver un instante (flashazo) antes de
  // que la revisión a pantalla completa termine de cargar.
  const [openingFromGrades, setOpeningFromGrades] = useState(!!openStudentId)
  useScrollLock(openingFromGrades)

  // Arriving from a grades-table cell: open that student's answer review directly
  // (even with no submission → "No realizado"), once questions are loaded.
  useEffect(() => {
    if (!pendingOpenId || loadingPreguntas) return
    const st = students.find((s) => s.id === pendingOpenId)
    setPendingOpenId(null)
    if (st) openReview(st, 'todos').finally(() => setOpeningFromGrades(false))
    else setOpeningFromGrades(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenId, loadingPreguntas, students])

  async function loadPreguntas() {
    setLoadingPreguntas(true)
    try {
      // Con su clave, que solo el docente dueño puede leer (A08).
      const list = (await cargarPreguntasConClave(activityId)).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      setPreguntas(list)
    } catch (err) {
      toast('Error al cargar preguntas: ' + err.message, 'error')
    } finally {
      setLoadingPreguntas(false)
    }
  }

  useEffect(() => { loadPreguntas() }, [activityId])
  useEffect(() => {
    setConfigForm(activity.evaluacion)
    configSnap.current = JSON.stringify(activity.evaluacion)
  }, [activity.evaluacion])

  // Bitácora de OP-10 — cargarla es gratis (leerla no cobra créditos), así
  // que se trae completa una sola vez por actividad. Se ordena en memoria:
  // no lleva orderBy en la query (ver convención del proyecto en CLAUDE.md).
  useEffect(() => {
    const aid = activityId || activity?.id
    if (!aid) return
    let cancelado = false
    ;(async () => {
      try {
        const snap = await getDocs(collection(db, 'activities', aid, 'analisisIA'))
        if (cancelado) return
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => millisDeGeneradoEn(b.generadoEn) - millisDeGeneradoEn(a.generadoEn))
        setAnalisisHistorial(items)
      } catch {
        // La bitácora es un complemento de la pantalla de resultados, no un
        // requisito para verlos: si falla, simplemente no se muestra.
      }
    })()
    return () => { cancelado = true }
  }, [activityId, activity?.id])

  async function loadBanco() {
    if (bancoLoaded) return
    try {
      const snap = await getDocs(query(collection(db, 'bancoReactivos'), where('docenteId', '==', auth.currentUser.uid)))
      setBanco(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setBancoLoaded(true)
    } catch (err) {
      toast('Error al cargar tu banco: ' + err.message, 'error')
    }
  }

  async function syncNumPreguntas(nuevoTotal) {
    const nextEvaluacion = { ...activity.evaluacion, numPreguntas: nuevoTotal }
    await updateDoc(doc(db, 'activities', activityId), { evaluacion: nextEvaluacion })
    onActivityChange((prev) => ({ ...prev, evaluacion: nextEvaluacion }))
  }

  function buildPreguntaData(form) {
    const base = {
      tipo: form.tipo,
      enunciado: form.enunciado.trim(),
      ponderacion: parseFloat(form.ponderacion) || 1,
      retroalimentacion: form.retroalimentacion.trim() || null,
    }
    if (form.tipo === 'opcion_multiple') {
      return {
        ...base,
        opciones: form.opciones.map((o) => o.esOtra ? { id: o.id, texto: 'Otra', esOtra: true } : { id: o.id, texto: o.texto.trim() }),
        respuestaCorrecta: form.respuestaCorrecta,
      }
    }
    if (form.tipo === 'verdadero_falso') {
      return {
        ...base,
        opciones: [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }],
        respuestaCorrecta: form.vfRespuesta,
      }
    }
    return { ...base, opciones: null, respuestaCorrecta: null }
  }

  function validatePreguntaForm(form) {
    if (!form.enunciado.trim()) { toast('Escribe el enunciado de la pregunta', 'error'); return false }
    if (form.tipo === 'opcion_multiple') {
      const reales = form.opciones.filter((o) => !o.esOtra)
      if (reales.length < 2 || reales.some((o) => !o.texto.trim())) {
        toast('Completa al menos 2 opciones de respuesta', 'error'); return false
      }
    }
    // Tema is required whenever the reactivo is saved to the bank — the bank is
    // organized by tema, so an untagged entry is unusable. Global rule, not per subject.
    if (form.guardarEnBanco && !form.tema.trim()) {
      toast('Escribe el tema para guardar el reactivo en tu banco', 'error'); return false
    }
    return true
  }

  async function handleAddPregunta(e) {
    e.preventDefault()
    if (!validatePreguntaForm(preguntaForm)) return
    setSaving(true)
    try {
      let imagenUrl = null
      if (preguntaForm.imagenFile) {
        imagenUrl = await uploadToCloudinary(preguntaForm.imagenFile, 'evalua-facil/preguntas')
      }
      // El orden se cuenta DENTRO de su sección: reordenar en una no depende
      // de cuántos reactivos haya en las otras.
      const orden = siguienteOrden(preguntas, seccionDestino)
      const data = {
        ...buildPreguntaData(preguntaForm), imagenUrl, orden, origenBancoId: null,
        ...seccionesCtl.camposDeSeccion(seccionDestino),
      }
      const nuevoId = await crearPregunta(activityId, data)
      setPreguntas((prev) => [...prev, { id: nuevoId, ...data }])
      setGlowId(nuevoId)
      await syncNumPreguntas(preguntas.length + 1)
      if (preguntaForm.guardarEnBanco) {
        await addDoc(collection(db, 'bancoReactivos'), {
          docenteId: auth.currentUser.uid, tipo: data.tipo, enunciado: data.enunciado,
          opciones: data.opciones, respuestaCorrecta: data.respuestaCorrecta,
          tema: preguntaForm.tema.trim() || null,
          // materia = subject name only (no grupo) — reusable across ciclos
          materia: subject?.nombre || null, asignaturaId: activity?.asignaturaId || null,
          createdAt: serverTimestamp(),
        })
      }
      setPreguntaForm(emptyPregunta())
      setShowPreguntaForm(false)
      setSeccionDestino(null)
      toast('Pregunta agregada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddFromBanco(item) {
    setSaving(true)
    try {
      const orden = siguienteOrden(preguntas, seccionDestino)
      const data = {
        ...seccionesCtl.camposDeSeccion(seccionDestino),
        tipo: item.tipo, enunciado: item.enunciado, opciones: item.opciones || null,
        respuestaCorrecta: item.respuestaCorrecta || null, ponderacion: 1, retroalimentacion: null,
        imagenUrl: null, orden, origenBancoId: item.id,
      }
      const nuevoId = await crearPregunta(activityId, data)
      setPreguntas((prev) => [...prev, { id: nuevoId, ...data }])
      setGlowId(nuevoId)
      await syncNumPreguntas(preguntas.length + 1)
      toast('Pregunta agregada desde tu banco')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // Agregar varios reactivos del banco de un jalón (pedido explícito) — un
  // solo writeBatch en vez de un addDoc por pregunta. Mismo patrón que
  // EvaluacionEditor.jsx.
  async function handleAddFromBancoMultiple(items) {
    if (!items.length) return
    setSaving(true)
    try {
      let orden = siguienteOrden(preguntas, seccionDestino)
      const lista = items.map((item) => ({
        tipo: item.tipo, enunciado: item.enunciado, opciones: item.opciones || null,
        respuestaCorrecta: item.respuestaCorrecta || null, ponderacion: 1, retroalimentacion: null,
        imagenUrl: null, orden: orden++, origenBancoId: item.id,
      }))
      // Sigue siendo un solo writeBatch (reactivo y clave van juntos dentro).
      const ids = await crearPreguntasEnLote(activityId, lista)
      const nuevas = lista.map((data, i) => ({ id: ids[i], ...data }))
      setPreguntas((prev) => [...prev, ...nuevas])
      await syncNumPreguntas(preguntas.length + nuevas.length)
      setSelectedBancoIds(new Set())
      toast(`${items.length} pregunta${items.length > 1 ? 's' : ''} agregada${items.length > 1 ? 's' : ''} desde tu banco`)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // "Repartir parejo" — pedido explícito: reparte los 10 puntos entre todas
  // las preguntas existentes en partes iguales. Mismo cálculo compartido
  // (repartirPonderacionParejo) que usa EvaluacionEditor.jsx.
  async function handleRepartirParejo() {
    if (!preguntas.length) return
    const values = repartirPonderacionParejo(preguntas.length)
    setSaving(true)
    try {
      const batch = writeBatch(db)
      preguntas.forEach((p, i) => batch.update(doc(db, 'activities', activityId, 'preguntas', p.id), { ponderacion: values[i] }))
      await batch.commit()
      setPreguntas((prev) => prev.map((p, i) => ({ ...p, ponderacion: values[i] })))
      toast('Ponderación repartida en partes iguales')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeletePregunta(id) {
    if (!confirm('¿Eliminar esta pregunta?')) return
    try {
      await borrarPregunta(activityId, id)
      setPreguntas((prev) => prev.filter((p) => p.id !== id))
      await syncNumPreguntas(Math.max(0, preguntas.length - 1))
      toast('Pregunta eliminada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  // ── Editar pregunta dentro de la evaluación ──
  function openEditPregunta(p) {
    setEditingPreguntaId(p.id)
    const opciones = opcionesFromExisting(p)
    const base = {
      tipo: p.tipo,
      enunciado: p.enunciado,
      opciones,
      respuestaCorrecta: p.tipo === 'opcion_multiple' ? (p.respuestaCorrecta || opciones[0]?.id || null) : 'a',
      vfRespuesta: p.tipo === 'verdadero_falso' ? (p.respuestaCorrecta || 'v') : 'v',
      ponderacion: p.ponderacion ?? 1,
      retroalimentacion: p.retroalimentacion || '',
      imagenFile: null,
      seccionId: p.seccionId || null,
    }
    setPreguntaEditForm(base)
    setGlowId(null)
    // Bring the chosen reactivo to the top so the edit form is fully visible
    setTimeout(() => document.getElementById(`preg-item-${p.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60)
    preguntaEditSnap.current = JSON.stringify(base)
  }

  async function handleSavePreguntaEdit(e, id) {
    e.preventDefault()
    if (!validatePreguntaForm(preguntaEditForm)) return
    setSaving(true)
    try {
      let imagenUrl = preguntas.find((p) => p.id === id)?.imagenUrl || null
      if (preguntaEditForm.imagenFile) {
        imagenUrl = await uploadToCloudinary(preguntaEditForm.imagenFile, 'evalua-facil/preguntas')
      }
      // Mover de sección: `orden` es relativo a su grupo, así que al cambiar
      // de sección hay que darle uno nuevo — el último del grupo destino — o
      // quedaría empatado con algún reactivo que ya estaba ahí.
      const antes = preguntas.find((p) => p.id === id)
      const seccionNueva = preguntaEditForm.seccionId || null
      const cambioDeSeccion = (antes?.seccionId || null) !== seccionNueva
      const camposSeccion = cambioDeSeccion
        ? { ...seccionesCtl.camposDeSeccion(seccionNueva), orden: siguienteOrden(preguntas.filter((p) => p.id !== id), seccionNueva) }
        : {}
      const data = { ...buildPreguntaData({ ...preguntaEditForm }), imagenUrl, ...camposSeccion }
      await actualizarPregunta(activityId, id, data)
      setPreguntas((prev) => prev.map((p) => p.id === id ? { ...p, ...data } : p))
      setEditingPreguntaId(null)
      setGlowId(id)
      toast('Pregunta actualizada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDuplicatePregunta(p) {
    try {
      const orden = siguienteOrden(preguntas, p.seccionId || null)
      const data = {
        seccionId: p.seccionId || null, seccionNombre: p.seccionNombre || null,
        tipo: p.tipo, enunciado: `${p.enunciado} (copia)`, opciones: p.opciones || null,
        respuestaCorrecta: p.respuestaCorrecta || null, ponderacion: p.ponderacion,
        retroalimentacion: p.retroalimentacion || null, imagenUrl: p.imagenUrl || null,
        orden, origenBancoId: null,
      }
      const nuevoId = await crearPregunta(activityId, data)
      setPreguntas((prev) => [...prev, { id: nuevoId, ...data }])
      setGlowId(nuevoId)
      await syncNumPreguntas(preguntas.length + 1)
      toast('Pregunta duplicada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function handleMovePregunta(id, direction) {
    // Se mueve dentro de SU grupo (su sección, o el bloque suelto): un reactivo
    // nunca cambia de sección con las flechas — para eso está el selector de
    // sección en su formulario de edición.
    const actual = preguntas.find((p) => p.id === id)
    const hermanas = preguntas
      .filter((p) => (p.seccionId || null) === (actual?.seccionId || null))
      .sort((x, y) => (x.orden ?? 0) - (y.orden ?? 0))
    const idx = hermanas.findIndex((p) => p.id === id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || swapIdx < 0 || swapIdx >= hermanas.length) return
    const a = hermanas[idx]
    const b = hermanas[swapIdx]
    const newOrdenA = b.orden ?? swapIdx
    const newOrdenB = a.orden ?? idx
    try {
      await Promise.all([
        updateDoc(doc(db, 'activities', activityId, 'preguntas', a.id), { orden: newOrdenA }),
        updateDoc(doc(db, 'activities', activityId, 'preguntas', b.id), { orden: newOrdenB }),
      ])
      setPreguntas((prev) => prev
        .map((p) => (p.id === a.id ? { ...p, orden: newOrdenA } : p.id === b.id ? { ...p, orden: newOrdenB } : p))
        .sort((x, y) => (x.orden ?? 0) - (y.orden ?? 0)))
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  // ── Banco de reactivos: buscar/filtrar/editar/eliminar/duplicar ──
  const temas = [...new Set(banco.map((b) => b.tema).filter(Boolean))]
  const materias = [...new Set(banco.map((b) => b.materia).filter(Boolean))]
  const bancoFiltrado = banco.filter((b) =>
    (!bancoSearch.trim() || b.enunciado.toLowerCase().includes(bancoSearch.trim().toLowerCase())) &&
    (!bancoTemaFilter || b.tema === bancoTemaFilter) &&
    (!bancoMateriaFilter || b.materia === bancoMateriaFilter)
  )

  function openEditBanco(item) {
    setEditingBancoId(item.id)
    const opciones = opcionesFromExisting(item)
    const base = {
      tipo: item.tipo, enunciado: item.enunciado,
      opciones,
      respuestaCorrecta: item.tipo === 'opcion_multiple' ? (item.respuestaCorrecta || opciones[0]?.id || null) : 'a',
      vfRespuesta: item.tipo === 'verdadero_falso' ? (item.respuestaCorrecta || 'v') : 'v',
      tema: item.tema || '',
    }
    setBancoEditForm(base)
    setGlowId(null)
    // Bring the chosen reactivo to the top so the edit form is fully visible
    setTimeout(() => document.getElementById(`banco-item-${item.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60)
    bancoEditSnap.current = JSON.stringify(base)
  }

  async function handleSaveBancoEdit(id) {
    if (!validatePreguntaForm(bancoEditForm)) return
    setSaving(true)
    try {
      const data = buildPreguntaData({ ...bancoEditForm, ponderacion: 1, retroalimentacion: '' })
      await updateDoc(doc(db, 'bancoReactivos', id), {
        tipo: data.tipo, enunciado: data.enunciado, opciones: data.opciones,
        respuestaCorrecta: data.respuestaCorrecta, tema: bancoEditForm.tema.trim() || null,
      })
      setBanco((prev) => prev.map((b) => b.id === id ? { ...b, tipo: data.tipo, enunciado: data.enunciado, opciones: data.opciones, respuestaCorrecta: data.respuestaCorrecta, tema: bancoEditForm.tema.trim() || null } : b))
      setEditingBancoId(null)
      setGlowId(id)
      toast('Pregunta del banco actualizada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteBancoItem(id) {
    if (!confirm('¿Eliminar esta pregunta de tu banco? No afecta evaluaciones donde ya la usaste.')) return
    try {
      await deleteDoc(doc(db, 'bancoReactivos', id))
      setBanco((prev) => prev.filter((b) => b.id !== id))
      toast('Eliminada de tu banco')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function handleDuplicateBancoItem(item) {
    try {
      // asignaturaId debe copiarse igual que en EvaluacionEditor.jsx — sin
      // esto, la copia perdía la materia con la que el banco filtra/organiza
      // (bug real encontrado al comparar ambas copias de esta función).
      const ref = await addDoc(collection(db, 'bancoReactivos'), {
        docenteId: auth.currentUser.uid, tipo: item.tipo, enunciado: `${item.enunciado} (copia)`,
        opciones: item.opciones || null, respuestaCorrecta: item.respuestaCorrecta || null,
        tema: item.tema || null, materia: item.materia || null, asignaturaId: item.asignaturaId || null, createdAt: serverTimestamp(),
      })
      setBanco((prev) => [...prev, { id: ref.id, docenteId: auth.currentUser.uid, tipo: item.tipo, enunciado: `${item.enunciado} (copia)`, opciones: item.opciones, respuestaCorrecta: item.respuestaCorrecta, tema: item.tema, materia: item.materia, asignaturaId: item.asignaturaId }])
      toast('Pregunta duplicada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  // ── Configuración ──
  async function handleSaveConfig(e) {
    e.preventDefault()
    // Anything scheduled for a specific date must be in the future
    if (configForm.publicarResultados === 'fecha') {
      if (!configForm.publicarResultadosFecha) { toast('Elige la fecha de publicación de resultados', 'error'); return }
      if (configForm.publicarResultadosFecha <= toIsoNow()) {
        toast('La fecha de publicación de resultados debe ser posterior a este momento', 'error'); return
      }
    }
    if (configForm.publicarRespuestas === 'fecha') {
      if (!configForm.publicarRespuestasFecha) { toast('Elige la fecha de publicación de respuestas', 'error'); return }
      if (configForm.publicarRespuestasFecha <= toIsoNow()) {
        toast('La fecha de publicación de respuestas debe ser posterior a este momento', 'error'); return
      }
    }
    // "Ahora (guardar para que se publique)" flips the published flag on save so the
    // student sees it immediately; the flag is sticky (once published, stays published).
    const toSave = { ...configForm }
    // Existing evaluaciones predate the answers-publication field — normalize so we
    // never persist undefined (which would read as "not published" for the student).
    toSave.publicarResultados = toSave.publicarResultados || 'inmediato'
    toSave.publicarRespuestas = toSave.publicarRespuestas || 'inmediato'
    if (toSave.publicarResultados === 'ahora') toSave.resultadosPublicados = true
    if (toSave.publicarRespuestas === 'ahora') toSave.respuestasPublicadas = true
    setSavingConfig(true)
    try {
      await updateDoc(doc(db, 'activities', activityId), { evaluacion: toSave })
      configSnap.current = JSON.stringify(toSave)
      setConfigForm(toSave)
      onActivityChange((prev) => ({ ...prev, evaluacion: toSave }))
      toast('Configuración guardada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingConfig(false)
    }
  }

  // Cerrar el editor completo: recargar preguntas y refrescar la actividad
  // (el editor guarda directo en Firestore — nombre, fechas, config, reactivos).
  async function closeEvalEditor() {
    setShowEvalEditor(false)
    loadPreguntas()
    try {
      const snap = await getDoc(doc(db, 'activities', activityId))
      if (snap.exists()) {
        const fresh = snap.data()
        onActivityChange((prev) => ({ ...prev, ...fresh }))
        if (fresh.evaluacion) {
          setConfigForm(fresh.evaluacion)
          configSnap.current = JSON.stringify(fresh.evaluacion)
        }
      }
    } catch { /* la vista sigue con los datos previos */ }
  }

  async function handlePublicarResultados() {
    const nextEvaluacion = { ...activity.evaluacion, resultadosPublicados: true }
    try {
      await updateDoc(doc(db, 'activities', activityId), { evaluacion: nextEvaluacion })
      onActivityChange((prev) => ({ ...prev, evaluacion: nextEvaluacion }))
      toast('Resultados publicados a tus estudiantes')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  // ── Revisión manual (respuesta corta / subir documento) ──
  // Un cuestionario/examen "se realiza o no" — el vocabulario de calificar solo
  // aplica cuando hay reactivos que el docente debe calificar a mano.
  // ── Secciones (opcionales) ──────────────────────────────────────────────
  // Viven en activity.evaluacion.secciones; cada reactivo guarda su seccionId.
  // Sin secciones, `grupos` es un solo grupo suelto y todo se ve igual que antes.
  const seccionesCtl = useSecciones({
    activityId,
    evaluacion: activity.evaluacion,
    preguntas,
    setPreguntas,
    onCambio: (secciones) => {
      onActivityChange((prev) => ({ ...prev, evaluacion: { ...prev.evaluacion, secciones } }))
      setConfigForm((f) => ({ ...f, secciones }))
    },
  })
  // A qué sección se agregará el próximo reactivo (la del botón que se tocó).
  const [seccionDestino, setSeccionDestino] = useState(null)
  const grupos = agruparPreguntas(preguntas, seccionesCtl.secciones)
  // El número que ve el docente es el del ORDEN FINAL (con las secciones ya
  // aplicadas), no la posición en la lista cruda.
  // `orden` es RELATIVO a su sección, así que la lista plana ordenada por ese
  // campo mezclaría secciones. Esta es la lista en el orden real, la que ven la
  // revisión, las gráficas y las exportaciones.
  const preguntasOrdenadas = preguntasEnOrden(preguntas, seccionesCtl.secciones)
  const numeroDePregunta = {}
  preguntasOrdenadas.forEach((p, i) => { numeroDePregunta[p.id] = i + 1 })

  const hasManual = preguntas.some((p) => TIPOS_REVISION_MANUAL.includes(p.tipo))

  // Misma etiqueta que sale en la columna ESTADO del Excel de resultados — la
  // lógica vive en evaluacionGrading.js para que no puedan discrepar.
  function estadoEstudiante(sub) {
    return estadoEvaluacionLabel(sub, hasManual)
  }

  // Filter buckets: Pendientes (not finished), Calificados/Realizados,
  // Por calificar (finished, manual questions awaiting review)
  function estadoFiltroKey(sub) {
    const e = estadoEstudiante(sub)
    return (e === 'Calificado' || e === 'Realizado') ? 'calificado' : e === 'Por calificar' ? 'porCalificar' : 'pendiente'
  }

  // Tab labels shared by the Entregas list and the review sidebar: grading
  // vocabulary only when the teacher actually has something to grade.
  const FILTRO_TABS = [
    ['todos', 'Todos'],
    ['pendiente', 'Pendientes'],
    ['calificado', hasManual ? 'Calificados' : 'Realizados'],
    ['porCalificar', hasManual ? 'Por calificar' : 'Por realizar'],
  ]

  // Students for a review tab, in list order (students prop is already sorted).
  function studentsForFilter(filtro) {
    return students.filter((x) => filtro === 'todos' || estadoFiltroKey(submissions[x.id]) === filtro)
  }

  // Open the full-screen answer review for a student. Works even with no submission
  // (shows "No realizado"). Freezes the Anterior/Siguiente order to `filtro`.
  async function openReview(student, filtro = reviewFilter) {
    const nav = studentsForFilter(filtro)
    setReviewFilter(filtro)
    setReviewNav(nav.length ? nav : [student])
    setExtendMode(false)
    setExtendDate(activity?.extensiones?.[student.id] || '')
    setExtendMotivo(activity?.extensionesMotivo?.[student.id] || '')
    const sub = submissions[student.id]
    let allRespuestas = {}
    if (sub?.estadoEvaluacion === 'finalizado') {
      try {
        const respSnap = await getDocs(collection(db, 'submissions', sub.id, 'respuestas'))
        respSnap.docs.forEach((d) => { allRespuestas[d.id] = d.data() })
      } catch (err) {
        toast('Error al cargar respuestas: ' + err.message, 'error'); return
      }
    }
    // Borradores de calificación manual, pre-llenados con lo ya guardado
    const drafts = {}
    preguntas.filter((p) => TIPOS_REVISION_MANUAL.includes(p.tipo)).forEach((p) => {
      const r = allRespuestas[p.id] || {}
      drafts[p.id] = { puntos: r.puntosObtenidos ?? '', comentario: r.comentarioDocente || '' }
    })
    setGradeDrafts(drafts)
    setReviewing({ student, submission: sub || null, allRespuestas })
  }

  // Anterior/Siguiente through the frozen nav list (wraps around).
  function goReview(offset) {
    if (!reviewing || reviewNav.length < 2) return
    const idx = reviewNav.findIndex((s) => s.id === reviewing.student.id)
    if (idx < 0) return
    const next = reviewNav[(idx + offset + reviewNav.length) % reviewNav.length]
    if (next) openReview(next, reviewFilter)
  }

  // Review filter tabs — re-freeze the nav and jump to its first student if the
  // current one no longer belongs to the selected tab.
  function changeReviewFilter(filtro) {
    const nav = studentsForFilter(filtro)
    setReviewFilter(filtro)
    setReviewNav(nav)
    if (nav.length && !nav.some((s) => s.id === reviewing?.student.id)) openReview(nav[0], filtro)
  }

  // ── Calificación manual de un reactivo (respuesta corta / subir documento) ──
  // Guarda los puntos + comentario del reactivo y recalcula en cascada: la
  // calificación del intento, la calificación final según la política
  // `conservar`, y si la evaluación sigue pendiente de revisión.
  async function saveGrade(pregunta) {
    const sub = reviewing?.submission
    if (!sub) return
    const draft = gradeDrafts[pregunta.id] || {}
    const puntos = parseFloat(draft.puntos)
    const max = parseFloat(pregunta.ponderacion) || 0
    if (!Number.isFinite(puntos) || puntos < 0 || puntos > max + 1e-9) {
      toast(`Los puntos deben estar entre 0 y ${max}`, 'error'); return
    }
    setSavingGradeId(pregunta.id)
    try {
      const comentario = (draft.comentario || '').trim() || null
      await setDoc(
        doc(db, 'submissions', sub.id, 'respuestas', pregunta.id),
        { puntosObtenidos: puntos, comentarioDocente: comentario },
        { merge: true }
      )
      const allResp = {
        ...reviewing.allRespuestas,
        [pregunta.id]: { ...(reviewing.allRespuestas[pregunta.id] || {}), puntosObtenidos: puntos, comentarioDocente: comentario },
      }
      // Recalcular: intento actual (las respuestas guardadas son del último
      // intento), calificación final según `conservar`, y estado.
      const calIntento = calcularCalificacion(preguntas, allResp, activity.maxCalif || 10)
      const pendiente = resolverPendienteRevision(preguntas, allResp)
      const intentos = [...(sub.intentos || [])]
      if (intentos.length) intentos[intentos.length - 1] = { ...intentos[intentos.length - 1], calificacion: calIntento }
      const previas = intentos.slice(0, -1)
      const calFinal = resolverCalificacionFinal(previas, calIntento, activity.evaluacion?.conservar)
      const patch = {
        calificacion: calFinal,
        pendienteRevision: pendiente,
        estado: pendiente ? 'entregado' : 'calificado',
        intentos,
      }
      await updateDoc(doc(db, 'submissions', sub.id), patch)
      const updatedSub = { ...sub, ...patch }
      setReviewing((r) => r && ({ ...r, submission: updatedSub, allRespuestas: allResp }))
      onSubmissionUpdated?.(reviewing.student.id, updatedSub)
      // C-02: el guardado del docente cierra la sugerencia persistida de este
      // reactivo (queda 'aplicada' y sale del snapshot de pendientes). Mejor
      // esfuerzo: si falla, la sugerencia solo sigue visible — sin costo.
      const sugPersistida = iaSugerencias[sub.id]?.[pregunta.id]
      if (sugPersistida?._docId) {
        updateDoc(doc(db, 'activities', activityId || activity.id, 'iaSugerencias', sugPersistida._docId),
          { estado: 'aplicada', actualizadoEn: serverTimestamp() }).catch(() => {})
      }
      toast(pendiente
        ? 'Puntos guardados — aún hay reactivos por calificar'
        : `Puntos guardados — calificación final: ${calFinal}/${activity.maxCalif || 10}`)
    } catch (err) {
      toast('Error al guardar puntos: ' + err.message, 'error')
    } finally {
      setSavingGradeId(null)
    }
  }

  // ── C-02 · Sugerir calificación de respuestas abiertas (piloto IA) ─────────
  // Cuenta EXACTAMENTE las respuestas que el lote va a calificar (regla del
  // PO: la estimación debe reflejar la cantidad real). Lee las respuestas de
  // los estudiantes pendientes — las mismas lecturas que abrir su revisión.
  // Solo texto (respuesta_corta); documentos y respuestas vacías no cuentan.
  async function contarRespuestasIA() {
    setIaContando(true)
    try {
      const abiertas = preguntas.filter((p) => p.tipo === 'respuesta_corta')
      const pendientes = students.filter((s) => {
        const sub = submissions[s.id]
        return sub?.estadoEvaluacion === 'finalizado' && sub.pendienteRevision
      })
      let respuestas = 0
      let estudiantes = 0
      for (const s of pendientes) {
        const snap = await getDocs(collection(db, 'submissions', submissions[s.id].id, 'respuestas'))
        const porId = {}
        snap.docs.forEach((d) => { porId[d.id] = d.data() })
        let deEste = 0
        for (const p of abiertas) {
          const r = porId[p.id]
          if (!r || r.puntosObtenidos != null) continue
          // Con sugerencia persistida pendiente: recuperable gratis, no se
          // vuelve a cobrar ni a pedir.
          if (iaSugerencias[submissions[s.id].id]?.[p.id]) continue
          const texto = (r.textoRespuesta || '').trim()
          if (!texto || texto.length > 40000) continue
          deEste++
        }
        if (deEste) { estudiantes++; respuestas += deEste }
      }
      if (!respuestas) {
        const pendientesIA = Object.values(iaSugerencias).reduce((n, m) => n + Object.keys(m).length, 0)
        toast(pendientesIA
          ? 'Todas las respuestas pendientes ya tienen sugerencia de IA — ábrelas al calificar, sin costo adicional'
          : 'No hay respuestas de texto pendientes de calificar', 'error')
        return
      }
      setIaConteo({ estudiantes, respuestas })
    } catch (err) {
      toast('Error al contar respuestas: ' + err.message, 'error')
    } finally {
      setIaContando(false)
    }
  }

  // Ejecuta el lote tras la confirmación del docente en el modal de créditos.
  // El servidor relee todo por ID (no confía en textos del cliente), reserva
  // el lote, cobra solo lo realmente sugerido y reembolsa el resto. Las
  // sugerencias NUNCA se guardan como calificación (O3): quedan en el estado
  // de la sesión y el docente las aplica una por una si le convencen.
  async function ejecutarSugerenciasIA() {
    setIaTrabajando(true)
    try {
      const data = await creditosIA.ejecutar('calificar_abierta', {
        actividadId: activityId || activity.id,
        asignaturaId: activity.asignaturaId,
        asignaturaNombre: subject?.nombre || '',
      }, iaConteo.respuestas, { timeoutMs: 300000 })
      // El servidor persistió cada sugerencia en iaSugerencias — el snapshot
      // llena el estado solo; aquí únicamente se informa el resultado.
      setIaConteo(null)
      const n = data?.resultado?.sugerencias?.length || 0
      const previas = data?.resultado?.yaProcesadas || 0
      toast(`${n} sugerencia${n !== 1 ? 's' : ''} de calificación lista${n !== 1 ? 's' : ''}${previas ? ` (${previas} ya existían y no se cobraron)` : ''} — revísalas al calificar a cada estudiante. Tú decides.`)
    } catch (err) {
      toast(err.codigo === 'SALDO_INSUFICIENTE'
        ? 'No tienes créditos suficientes para este lote'
        : 'No se pudo completar: ' + err.message, 'error')
    } finally {
      setIaTrabajando(false)
    }
  }

  // ── OP-10 · Analizar resultados con IA ──────────────────────────────────
  // El servidor relee preguntas + entregas por actividadId (el cliente no
  // manda ningún dato pedagógico) y hace TODA la agregación y la aritmética
  // ahí — aquí solo se confirma el gasto de créditos y se muestra el
  // resultado. Los estudiantes viajan anonimizados al modelo; el mapa
  // anonId→alumnoId que regresa el servidor se usa SOLO para mostrar nombres
  // reales en pantalla, nunca se lo mandamos de vuelta a la IA.
  //
  // Bitácora (ver activities/{id}/analisisIA): cada generación exitosa se
  // persiste con addDoc — nunca se sobrescribe una anterior. `resultado` se
  // guarda completo, tal cual lo agregó el servidor (agregarResultados en
  // functions/ia.js), así que un PDF descargado después sigue mostrando la
  // fotografía exacta de esa generación aunque después lleguen más entregas.
  // `entregasConsideradas` = resultado.totalEstudiantes: es literalmente
  // `entregas.length` con estadoEvaluacion==='finalizado' en el servidor
  // (agregarResultados), no un conteo aparte.
  async function generarAnalisisIA() {
    setAnalisisTrabajando(true)
    try {
      const data = await creditosIA.ejecutar('analizar_resultados', {
        actividadId: activityId || activity.id,
        asignaturaId: activity.asignaturaId,
        asignaturaNombre: subject?.nombre || '',
      })
      const resultado = data?.resultado || null
      setAnalisisResultado(resultado)
      const generadoEnLocal = new Date()
      setAnalisisGeneradoEn(generadoEnLocal.toISOString())
      setAnalisisConfirmando(false)
      if (resultado) {
        try {
          const ref = await addDoc(collection(db, 'activities', activityId || activity.id, 'analisisIA'), {
            resultado,
            generadoEn: serverTimestamp(),
            docenteId: auth.currentUser.uid,
            entregasConsideradas: resultado.totalEstudiantes ?? 0,
          })
          setAnalisisId(ref.id)
          setAnalisisHistorial((prev) => [
            { id: ref.id, resultado, generadoEn: generadoEnLocal, docenteId: auth.currentUser.uid, entregasConsideradas: resultado.totalEstudiantes ?? 0 },
            ...prev,
          ])
        } catch (err) {
          toast('El análisis se generó, pero no se pudo guardar en la bitácora: ' + err.message, 'error')
        }
      }
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setAnalisisTrabajando(false)
    }
  }

  // Ver un análisis histórico o descargar su PDF cuestan 0 créditos: son
  // solo lectura de lo ya persistido en la bitácora, no vuelven a llamar a
  // la IA ni recalculan nada con las entregas actuales.
  function verAnalisisHistorico(entrada) {
    setAnalisisResultado(entrada.resultado)
    setAnalisisGeneradoEn(new Date(millisDeGeneradoEn(entrada.generadoEn)).toISOString())
    setAnalisisId(entrada.id)
  }

  // El docente puede corregir el texto del análisis (es una propuesta de la
  // IA, no un dato inmutable) — se guarda en el MISMO doc de la bitácora,
  // sin tocar `generadoEn` ni `entregasConsideradas` (pedido de Kike,
  // 16-ago-2026: todo lo que genera la IA debe poder editarse).
  async function guardarAnalisisEditado(resultadoEditado) {
    await updateDoc(doc(db, 'activities', activityId || activity.id, 'analisisIA', analisisId), { resultado: resultadoEditado })
    setAnalisisResultado(resultadoEditado)
    setAnalisisHistorial((prev) => prev.map((h) => (h.id === analisisId ? { ...h, resultado: resultadoEditado } : h)))
  }

  async function ejecutarDescargaAnalisisHistoricoPDF(entrada) {
    setAnalisisDescargandoId(entrada.id)
    try {
      const { resultado: resultadoConNombres } = resolverNombresAnalisis(entrada.resultado, students)
      await exportAnalisisResultadosPDF({
        activity, subject, membrete,
        watermark: exportsWatermarked,
        generadoEn: new Date(millisDeGeneradoEn(entrada.generadoEn)).toISOString(),
        resultado: resultadoConNombres,
      })
    } catch (err) {
      toast('Error al generar el PDF: ' + err.message, 'error')
    } finally {
      setAnalisisDescargandoId(null)
    }
  }

  // Descargar el PDF sigue siendo gratis (no pasa por creditosIA): el único
  // gate aquí es el mismo aviso de "exportación en periodo de prueba" que
  // usan el resto de las descargas de esta pantalla — ver `pendingExport`.
  function descargarAnalisisHistoricoPDF(entrada) {
    if (descargaSoloWeb(toast)) return
    if (exportsWatermarked) { setPendingExport({ run: () => ejecutarDescargaAnalisisHistoricoPDF(entrada) }); return }
    ejecutarDescargaAnalisisHistoricoPDF(entrada)
  }

  // "Modificar fecha de entrega para este estudiante" — per-student deadline
  // extension (activity.extensiones), same shape entregables use.
  //
  // El botón "Guardar" se apaga si lo tecleado es igual a la prórroga que ya
  // tenía este alumno: openReview() precarga extendDate/extendMotivo con la
  // prórroga existente, así que reabrir el panel de un alumno YA extendido
  // mostraba el botón activo sin que se hubiera tocado nada.
  const reviewExtensionUnchanged = !!reviewing &&
    extendDate === (activity?.extensiones?.[reviewing.student.id] || '') &&
    extendMotivo.trim() === (activity?.extensionesMotivo?.[reviewing.student.id] || '')

  async function saveReviewExtension() {
    if (!reviewing || !extendDate) return
    setSavingExtension(true)
    try {
      const motivo = extendMotivo.trim()
      await updateDoc(doc(db, 'activities', activityId), {
        [`extensiones.${reviewing.student.id}`]: extendDate,
        [`extensionesMotivo.${reviewing.student.id}`]: motivo,
      })
      onActivityChange((prev) => ({
        ...prev,
        extensiones: { ...(prev.extensiones || {}), [reviewing.student.id]: extendDate },
        extensionesMotivo: { ...(prev.extensionesMotivo || {}), [reviewing.student.id]: motivo },
      }))
      toast('Fecha de entrega actualizada para este estudiante')
      setExtendMode(false)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingExtension(false)
    }
  }

  // Anular la entrega actual: delete the intento (+ answers) so the student is back
  // to "No realizado" and can present again. Only this student is affected.
  async function handleCancelSubmission() {
    if (!cancelConfirm) return
    setCancelling(true)
    try {
      const sub = cancelConfirm.sub
      const respSnap = await getDocs(collection(db, 'submissions', sub.id, 'respuestas'))
      await Promise.all(respSnap.docs.map((d) => deleteDoc(doc(db, 'submissions', sub.id, 'respuestas', d.id))))
      await deleteDoc(doc(db, 'submissions', sub.id))
      onSubmissionRemoved?.(cancelConfirm.student.id)
      // Stay in the review, now showing "No realizado" for this student.
      if (reviewing?.student?.id === cancelConfirm.student.id) {
        setReviewing((r) => r && ({ ...r, submission: null, allRespuestas: {} }))
      }
      setCancelConfirm(null)
      toast('Entrega anulada — el estudiante puede volver a presentar')
    } catch (err) {
      toast('Error al anular: ' + err.message, 'error')
    } finally {
      setCancelling(false)
    }
  }

  const calificaciones = Object.values(submissions)
    .filter((s) => s.estadoEvaluacion === 'finalizado' && s.calificacion != null)
    .map((s) => s.calificacion)
  const stats = calcularEstadisticasGrupo(calificaciones, activity.maxCalif || 10)

  // ── Exportar los resultados de ESTA evaluación ──
  // Excel: cuatro hojas (resumen, calificaciones, matriz de respuestas y
  // resumen por reactivo). PDF: el reporte por reactivo con la tabla de
  // opción / respuestas / porcentaje. Las gráficas se descargan aparte, desde
  // la pantalla de Gráficas.
  //
  // Las respuestas de cada estudiante viven en una subcolección por entrega:
  // se leen aquí, al momento de exportar, y no al abrir la pestaña — abrir
  // Resultados no tiene por qué costar una lectura por alumno.
  async function runExportResultados(kind) {
    setExportingResultados(kind)
    try {
      const { porAlumno, counts } = await cargarRespuestasEvaluacion(submissions, preguntas)
      if (kind === 'excel') {
        await exportEvaluacionResultadosExcel({
          activity, subject, students, submissions, preguntas, counts, porAlumno, stats, hasManual,
          membrete, watermark: exportsWatermarked,
        })
      } else {
        await exportEvaluacionResultadosPDF({
          activity, subject, preguntas: preguntas.filter(esGraficable), counts,
          membrete, watermark: exportsWatermarked,
        })
      }
    } catch (err) {
      toast('Error al exportar: ' + err.message, 'error')
    } finally {
      setExportingResultados(null)
    }
  }

  function handleExportResultados(kind) {
    if (descargaSoloWeb(toast)) return
    if (exportsWatermarked) { setPendingExport({ run: () => runExportResultados(kind) }); return }
    runExportResultados(kind)
  }

  // Llegando desde una celda de Calificaciones: spinner hasta que la revisión
  // del estudiante esté abierta — nunca se alcanza a ver la pantalla de resultados.
  if (openingFromGrades) {
    return (
      <div className="fixed inset-0 z-40 bg-surface flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div>
      {/* Encabezado calcado al de EVALUAR (teacher/ActivityPage.jsx): sin barra
          blanca ni línea inferior, directo sobre el lienzo. Antes era una franja
          `bg-surface-card border-b` y, con el lienzo azul, el corte blanco/azul
          partía en dos lo que es una sola cabecera — el tipo de actividad de un
          lado y sus fechas del otro. Su contenido queda acotado al mismo
          contenedor que el cuerpo de abajo: si no, el título se pega a la
          izquierda mientras el cuerpo se ve centrado. */}
      <div className="px-4 py-2">
        <div className={TEACHER_CONTAINER_NARROW}>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Volver" onClick={() => navigate(`/subject/${activity.asignaturaId}`, backState ? { state: backState } : undefined)} className="p-2 -ml-2 text-slate-400 hover:text-muted rounded">
              <ArrowLeft size={22} />
            </button>
            <div className="flex-1 min-w-0">
              {IS_NATIVE_APP ? (
                <>
                  {contextLine && <p className="text-sm font-medium text-muted truncate">{contextLine}</p>}
                  <p className="text-[1.75rem] leading-tight font-bold uppercase tracking-wide text-accent">Evaluación</p>
                </>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-[1.75rem] leading-tight font-bold uppercase tracking-wide text-accent flex-shrink-0">Evaluación</p>
                  {contextLine && <p className="text-[1.75rem] leading-tight font-medium text-muted truncate">{contextLine}</p>}
                </div>
              )}
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-on-surface flex items-baseline gap-2 truncate">
                  {activityLabel && <span className="text-accent">{activityLabel}</span>}
                  <span className="truncate">{activity.nombre}</span>
                </h1>
                {/* Mismo botón editar que un entregable: lápiz inmediato al nombre.
                    Abre el MISMO editor completo que "editar" desde el parcial.
                    Disponible en web y app. */}
                <button
                  type="button"
                  onClick={() => setShowEvalEditor(true)}
                  data-tooltip="Editar actividad"
                  aria-label="Editar actividad"
                  className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0"
                >
                  <Pencil size={18} />
                </button>
              </div>
              <p className="text-base font-medium text-muted">Parcial {activity.parcial} · {activity.categoria === 'examen' ? 'Examen' : 'Cuestionario'}</p>
            </div>
          </div>
          {/* Fechas — aquí, pegadas al título, y no allá abajo dentro de la
              pestaña Resultados: son contexto de la actividad, no un resultado.
              Mismo tamaño y separación que en EVALUAR. */}
          {(activity.publishedAt || activity.publishAt || activity.fechaLimite) && (
            <div className="flex items-center gap-3 mt-2.5 flex-wrap">
              {activity.publishedAt && (
                <span data-tooltip="Publicado" className="text-sm text-emerald-600 flex items-center gap-1">
                  <Clock size={15} /> {formatPublishAt(activity.publishedAt)}
                </span>
              )}
              {activity.publishAt && (
                <span data-tooltip="Publicación programada" className="text-sm text-accent flex items-center gap-1">
                  <Clock size={15} /> {formatPublishAt(activity.publishAt)}
                </span>
              )}
              {activity.fechaLimite && (
                <span data-tooltip="Cierre" className="text-sm text-amber-600 flex items-center gap-1">
                  <Clock size={15} /> {formatDeadline(activity.fechaLimite)}
                </span>
              )}
            </div>
          )}
          {editingTabsVisible && (
            <div className="flex gap-1 mt-2 bg-surface-container p-1 rounded">
              {TABS.map((t) => (
                <button type="button" key={t.key} onClick={() => { setTab(t.key); if (t.key === 'preguntas') loadBanco() }}
                  className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${tab === t.key ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={`p-4 ${TEACHER_CONTAINER_NARROW}`}>
        {tab === 'preguntas' && (
          <div>
            {!loadingPreguntas && preguntas.length > 0 && (() => {
              const ponderacionUsada = preguntas.reduce((s, p) => s + (parseFloat(p.ponderacion) || 0), 0)
              return (
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className={`text-sm font-semibold ${Math.abs(ponderacionUsada - 10) < 0.01 ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {parseFloat(ponderacionUsada.toFixed(2))} / 10 pts
                  </span>
                  {/* Repartir parejo — pedido explícito. */}
                  {preguntas.length > 1 && Math.abs(ponderacionUsada - 10) >= 0.01 && (
                    <button
                      type="button"
                      onClick={handleRepartirParejo}
                      disabled={saving}
                      className="flex items-center gap-1.5 py-1.5 px-3 rounded border border-accent text-accent text-xs font-medium hover:bg-accent-tint transition-colors disabled:opacity-60"
                    >
                      <Scale size={14} /> Repartir parejo
                    </button>
                  )}
                </div>
              )
            })()}
            {loadingPreguntas ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : (
              <div className="space-y-2 mb-3">
                {preguntas.length === 0 && <p className="text-sm text-slate-400 text-center py-6">Aún no hay preguntas</p>}
                {grupos.map((grupo) => (
                  <div key={grupo.seccion?.id || 'sueltas'} className="space-y-3">
                    {grupo.seccion && (
                      <SeccionHeader
                        seccion={grupo.seccion}
                        total={grupo.preguntas.length}
                        primera={seccionesCtl.secciones[0]?.id === grupo.seccion.id}
                        ultima={seccionesCtl.secciones[seccionesCtl.secciones.length - 1]?.id === grupo.seccion.id}
                        disabled={saving || seccionesCtl.guardando}
                        onMover={(dir) => seccionesCtl.mover(grupo.seccion.id, dir)}
                        onEditar={() => seccionesCtl.setEditando(grupo.seccion)}
                        onEliminar={() => seccionesCtl.setPorBorrar(grupo.seccion)}
                        onAgregarReactivo={() => { setSeccionDestino(grupo.seccion.id); setShowPreguntaForm(true) }}
                      />
                    )}
                {grupo.preguntas.map((p) => (
                  <div key={p.id} id={`preg-item-${p.id}`} className="bg-surface-card rounded-card shadow-card p-3"
                    style={editingPreguntaId === p.id
                      ? { border: '2px solid var(--accent)', background: 'var(--accent-light)' }
                      : p.id === glowId
                        ? { border: '1px solid var(--accent)', background: 'var(--accent-light)' }
                        : undefined}>
                    {editingPreguntaId === p.id ? (
                      <form onSubmit={(e) => handleSavePreguntaEdit(e, p.id)} className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>Editando · Pregunta {numeroDePregunta[p.id]}</p>
                        <SelectorSeccion
                          id={`preg-edit-seccion-${p.id}`}
                          secciones={seccionesCtl.secciones}
                          valor={preguntaEditForm.seccionId}
                          onChange={(v) => setPreguntaEditForm((f) => ({ ...f, seccionId: v }))}
                        />
                        <Select
                          id={`preg-edit-tipo-${p.id}`}
                          label="Tipo de pregunta"
                          value={preguntaEditForm.tipo}
                          onChange={(v) => setPreguntaEditForm((f) => ({ ...f, tipo: v }))}
                          options={TIPOS_PREGUNTA}
                        />
                        <textarea value={preguntaEditForm.enunciado} onChange={(e) => setPreguntaEditForm((f) => ({ ...f, enunciado: e.target.value }))}
                          rows={2} required className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" />
                        {preguntaEditForm.tipo === 'opcion_multiple' && (
                          <OpcionesEditor
                            opciones={preguntaEditForm.opciones}
                            respuestaCorrecta={preguntaEditForm.respuestaCorrecta}
                            onChange={(next) => setPreguntaEditForm((f) => ({ ...f, opciones: next }))}
                            onChangeCorrecta={(id) => setPreguntaEditForm((f) => ({ ...f, respuestaCorrecta: id }))}
                            radioName={`edit-p-${p.id}`}
                          />
                        )}
                        {preguntaEditForm.tipo === 'opcion_multiple' && <p className="text-xs text-slate-400">Deja seleccionada la correcta</p>}
                        {preguntaEditForm.tipo === 'verdadero_falso' && (
                          <div className="flex gap-3">
                            {[['v', 'Verdadero'], ['f', 'Falso']].map(([id, label]) => (
                              <label key={id} className="flex items-center gap-2 text-sm">
                                <input type="radio" name={`edit-vf-${p.id}`} checked={preguntaEditForm.vfRespuesta === id}
                                  onChange={() => setPreguntaEditForm((f) => ({ ...f, vfRespuesta: id }))} className="accent-[var(--accent)]" />
                                {label}
                              </label>
                            ))}
                          </div>
                        )}
                        <div>
                          <label htmlFor={`preg-edit-retro-${p.id}`} className="block text-sm font-medium text-muted mb-1">Retroalimentación opcional</label>
                          <textarea id={`preg-edit-retro-${p.id}`} value={preguntaEditForm.retroalimentacion} onChange={(e) => setPreguntaEditForm((f) => ({ ...f, retroalimentacion: e.target.value }))}
                            rows={2} className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
                        </div>
                        <div>
                          <label htmlFor={`preg-edit-pond-${p.id}`} className="block text-sm font-medium text-muted mb-1">Ponderación</label>
                          <input id={`preg-edit-pond-${p.id}`} type="number" min="0.1" step="0.1" value={preguntaEditForm.ponderacion}
                            onChange={(e) => setPreguntaEditForm((f) => ({ ...f, ponderacion: e.target.value }))}
                            className="w-full px-3 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                        </div>
                        <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
                          <ImageIcon size={16} /> Cambiar imagen (opcional)
                          <input type="file" accept="image/*" className="hidden"
                            onChange={(e) => setPreguntaEditForm((f) => ({ ...f, imagenFile: e.target.files?.[0] || null }))} />
                          {preguntaEditForm.imagenFile && <span className="text-xs text-accent">{preguntaEditForm.imagenFile.name}</span>}
                        </label>
                        <div className="flex gap-2 pt-1">
                          <button type="button" onClick={() => { setEditingPreguntaId(null); setGlowId(p.id) }} className="flex-1 py-2 text-sm text-muted">Cancelar</button>
                          <button type="submit" disabled={saving || JSON.stringify(preguntaEditForm) === preguntaEditSnap.current} className="flex-1 py-2 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">
                            {saving ? 'Guardando…' : 'Guardar cambios'}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <span className="inline-block text-[10px] font-semibold uppercase tracking-wide text-accent bg-accent-light px-1.5 py-0.5 rounded mb-1">
                              {TIPOS_PREGUNTA.find((t) => t.value === p.tipo)?.label || p.tipo}
                            </span>
                            <p className="text-sm font-medium text-on-surface">{numeroDePregunta[p.id]}. {p.enunciado}</p>
                          </div>
                          <div className="flex gap-0.5 flex-shrink-0">
                            <button type="button" aria-label="Mover arriba" onClick={() => handleMovePregunta(p.id, 'up')} disabled={grupo.preguntas[0]?.id === p.id}
                              className="p-2 text-slate-400 hover:text-accent disabled:opacity-40 rounded"><ChevronUp size={15} /></button>
                            <button type="button" aria-label="Mover abajo" onClick={() => handleMovePregunta(p.id, 'down')} disabled={grupo.preguntas[grupo.preguntas.length - 1]?.id === p.id}
                              className="p-2 text-slate-400 hover:text-accent disabled:opacity-40 rounded"><ChevronDown size={15} /></button>
                            <button type="button" aria-label="Editar pregunta" onClick={() => openEditPregunta(p)} className="p-2 text-slate-400 hover:text-accent rounded"><Pencil size={15} /></button>
                            <button type="button" aria-label="Duplicar pregunta" onClick={() => handleDuplicatePregunta(p)} className="p-2 text-slate-400 hover:text-accent rounded"><Copy size={15} /></button>
                            <button type="button" aria-label="Eliminar pregunta" onClick={() => handleDeletePregunta(p.id)} className="p-2 text-slate-400 hover:text-error rounded"><Trash2 size={15} /></button>
                          </div>
                        </div>
                        {p.imagenUrl && <img src={p.imagenUrl} alt="" className="mt-2 max-h-32 rounded border border-outline-variant" />}
                        {p.opciones && (
                          <div className="mt-1 grid grid-cols-2 gap-1">
                            {p.opciones.map((o) => (
                              <p key={o.id} className={`text-xs px-2 py-1 rounded ${o.id === p.respuestaCorrecta ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-muted'}`}>
                                {o.texto}
                              </p>
                            ))}
                          </div>
                        )}
                        {p.tipo === 'respuesta_corta' && <p className="text-xs text-slate-400 mt-1 italic">Respuesta de texto libre — se califica manualmente</p>}
                        {p.tipo === 'subir_archivo' && <p className="text-xs text-slate-400 mt-1 italic">El alumno sube un documento — se califica manualmente</p>}
                        <p className="text-xs text-slate-400 mt-1">Ponderación: {p.ponderacion}{p.retroalimentacion ? ' · con retroalimentación' : ''}</p>
                      </>
                    )}
                  </div>
                ))}
                  </div>
                ))}
              </div>
            )}

            {/* Alta/edición de una sección — mismo lugar que el formulario de
                un reactivo, para que no compitan por la atención. */}
            {seccionesCtl.editando && (
              <SeccionForm
                inicial={seccionesCtl.editando === 'nueva' ? null : seccionesCtl.editando}
                guardando={seccionesCtl.guardando}
                onGuardar={seccionesCtl.guardar}
                onCancelar={() => seccionesCtl.setEditando(null)}
              />
            )}
            {!showPreguntaForm && !seccionesCtl.editando && (
              <BotonAgregarSeccion
                onClick={() => seccionesCtl.setEditando('nueva')}
                disabled={!activityId}
              />
            )}
            {!showPreguntaForm ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => { setGlowId(null); setSeccionDestino(null); setShowPreguntaForm(true) }} className="flex-1 flex items-center justify-center gap-1 py-2 bg-accent text-white text-sm font-medium rounded">
                  <Plus size={17} /> Agregar pregunta
                </button>
                <button type="button" onClick={() => { setShowBanco(true); setSelectedBancoIds(new Set()) }} className="flex items-center justify-center gap-1 px-3 py-2 border border-accent text-accent text-sm font-medium rounded">
                  <Library size={17} /> Mi banco
                </button>
              </div>
            ) : (
              <form onSubmit={handleAddPregunta} className="rounded-card shadow-card p-3 space-y-2"
                style={{ border: '2px solid var(--accent)', background: 'var(--accent-light)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>Creando · Pregunta {preguntas.length + 1}</p>
                <SelectorSeccion
                  id="preg-nueva-seccion"
                  secciones={seccionesCtl.secciones}
                  valor={seccionDestino}
                  onChange={setSeccionDestino}
                />
                <Select
                  id="preg-nueva-tipo"
                  label="Tipo de pregunta"
                  value={preguntaForm.tipo}
                  onChange={(v) => setPreguntaForm((f) => ({ ...f, tipo: v }))}
                  options={TIPOS_PREGUNTA}
                />
                <div>
                  <label htmlFor="preg-nueva-enunciado" className="block text-sm font-medium text-muted mb-1">Enunciado</label>
                  <textarea id="preg-nueva-enunciado" value={preguntaForm.enunciado} onChange={(e) => setPreguntaForm((f) => ({ ...f, enunciado: e.target.value }))}
                    rows={2} required
                    className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
                    <ImageIcon size={16} /> Imagen opcional
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(e) => setPreguntaForm((f) => ({ ...f, imagenFile: e.target.files?.[0] || null }))} />
                    <span className="text-xs text-accent">{preguntaForm.imagenFile ? preguntaForm.imagenFile.name : 'Elegir archivo'}</span>
                  </label>
                </div>

                {preguntaForm.tipo === 'opcion_multiple' && (
                  <OpcionesEditor
                    opciones={preguntaForm.opciones}
                    respuestaCorrecta={preguntaForm.respuestaCorrecta}
                    onChange={(next) => setPreguntaForm((f) => ({ ...f, opciones: next }))}
                    onChangeCorrecta={(id) => setPreguntaForm((f) => ({ ...f, respuestaCorrecta: id }))}
                    radioName="respuestaCorrecta"
                  />
                )}
                {preguntaForm.tipo === 'opcion_multiple' && <p className="text-xs text-slate-400">Deja seleccionada la correcta</p>}

                {preguntaForm.tipo === 'verdadero_falso' && (
                  <div className="flex gap-3">
                    {[['v', 'Verdadero'], ['f', 'Falso']].map(([id, label]) => (
                      <label key={id} className="flex items-center gap-2 text-sm text-on-surface">
                        <input type="radio" name="vfRespuesta" checked={preguntaForm.vfRespuesta === id}
                          onChange={() => setPreguntaForm((f) => ({ ...f, vfRespuesta: id }))} className="accent-[var(--accent)]" />
                        {label}
                      </label>
                    ))}
                  </div>
                )}

                {preguntaForm.tipo === 'respuesta_corta' && (
                  <p className="text-xs text-slate-400 italic">El alumno responderá con texto libre. Tú asignas los puntos al revisar su entrega.</p>
                )}
                {preguntaForm.tipo === 'subir_archivo' && (
                  <p className="text-xs text-slate-400 italic">El alumno subirá un documento (PDF, Word, imágenes, etc.). Tú asignas los puntos al revisar su entrega.</p>
                )}

                <div>
                  <label htmlFor="preg-nueva-retro" className="block text-sm font-medium text-muted mb-1">Retroalimentación opcional</label>
                  <textarea id="preg-nueva-retro" value={preguntaForm.retroalimentacion} onChange={(e) => setPreguntaForm((f) => ({ ...f, retroalimentacion: e.target.value }))}
                    rows={2} placeholder="Se muestra al alumno después de finalizar, si la configuración lo permite"
                    className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" />
                </div>
                <div>
                  <label htmlFor="preg-nueva-pond" className="block text-sm font-medium text-muted mb-1">Ponderación</label>
                  <input id="preg-nueva-pond" type="number" min="0.1" step="0.1" value={preguntaForm.ponderacion}
                    onChange={(e) => setPreguntaForm((f) => ({ ...f, ponderacion: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" />
                </div>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={preguntaForm.guardarEnBanco}
                    onChange={(e) => setPreguntaForm((f) => ({ ...f, guardarEnBanco: e.target.checked }))} className="accent-[var(--accent)]" />
                  Guardar también en mi banco de reactivos
                </label>
                {preguntaForm.guardarEnBanco && (
                  <input type="text" value={preguntaForm.tema} onChange={(e) => setPreguntaForm((f) => ({ ...f, tema: e.target.value }))}
                    required placeholder="Tema (obligatorio, ej. Fracciones)"
                    className="w-full px-3 py-1.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" />
                )}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => { setShowPreguntaForm(false); setPreguntaForm(emptyPregunta()) }}
                    className="flex-1 py-2 text-sm text-muted">Cancelar</button>
                  <button type="submit" disabled={saving} className="flex-1 py-2 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">
                    {saving ? 'Guardando…' : 'Agregar'}
                  </button>
                </div>
              </form>
            )}

            {showBanco && (
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
                <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => { setShowBanco(false); setEditingBancoId(null); setGlowId(null) }} aria-label="Cerrar" />
                <div className="relative bg-surface-card w-full max-w-lg rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[85vh] overflow-y-auto">
                  <h3 className="text-base font-semibold mb-2">Mi banco de reactivos</h3>
                  <div className="flex gap-2 mb-3">
                    <div className="flex-1">
                      <SearchInput value={bancoSearch} onChange={setBancoSearch} placeholder="Buscar…" />
                    </div>
                    {materias.length > 0 && (
                      <Select
                        value={bancoMateriaFilter}
                        onChange={setBancoMateriaFilter}
                        options={[{ value: '', label: 'Todas las materias' }, ...materias.map((m) => ({ value: m, label: m }))]}
                        wrapperClassName="shrink-0 w-36"
                      />
                    )}
                    {temas.length > 0 && (
                      <Select
                        value={bancoTemaFilter}
                        onChange={setBancoTemaFilter}
                        options={[{ value: '', label: 'Todos los temas' }, ...temas.map((t) => ({ value: t, label: t }))]}
                        wrapperClassName="shrink-0 w-36"
                      />
                    )}
                  </div>
                  {/* Barra de selección múltiple — pedido explícito, para
                      agregar varios reactivos de un jalón. */}
                  {selectedBancoIds.size > 0 && (
                    <div className="flex items-center gap-2 mb-3 -mt-1.5">
                      <span className="text-xs text-muted flex-1">{selectedBancoIds.size} seleccionada{selectedBancoIds.size > 1 ? 's' : ''}</span>
                      <button type="button" onClick={() => setSelectedBancoIds(new Set())} className="text-xs text-muted px-2 py-1.5">
                        Quitar selección
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleAddFromBancoMultiple(bancoFiltrado.filter((b) => selectedBancoIds.has(b.id)))}
                        className="text-xs font-medium bg-accent text-white rounded px-3 py-1.5 disabled:opacity-60"
                      >
                        Agregar {selectedBancoIds.size} a la evaluación
                      </button>
                    </div>
                  )}
                  {bancoFiltrado.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6">
                      {banco.length === 0 ? 'Aún no tienes preguntas guardadas en tu banco' : 'Sin resultados'}
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {bancoFiltrado.map((item) => (
                        <div key={item.id} id={`banco-item-${item.id}`} className="rounded border p-2"
                          style={editingBancoId === item.id
                            ? { borderColor: 'var(--accent)', background: 'var(--accent-light)', borderWidth: 2 }
                            : glowId === item.id
                              ? { borderColor: 'var(--accent)', background: 'var(--accent-light)' }
                              : { borderColor: 'var(--outline-variant)' }}>
                          {editingBancoId === item.id ? (
                            <div className="space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>Editando este reactivo</p>
                              <Select
                                value={bancoEditForm.tipo}
                                onChange={(v) => setBancoEditForm((f) => ({ ...f, tipo: v }))}
                                options={TIPOS_PREGUNTA}
                              />
                              <textarea value={bancoEditForm.enunciado} onChange={(e) => setBancoEditForm((f) => ({ ...f, enunciado: e.target.value }))}
                                rows={2} className="w-full px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                              {bancoEditForm.tipo === 'opcion_multiple' && (
                                <p className="text-xs text-muted">Marca el círculo de la respuesta correcta:</p>
                              )}
                              {bancoEditForm.tipo === 'opcion_multiple' && (
                                <OpcionesEditor
                                  opciones={bancoEditForm.opciones}
                                  respuestaCorrecta={bancoEditForm.respuestaCorrecta}
                                  onChange={(next) => setBancoEditForm((f) => ({ ...f, opciones: next }))}
                                  onChangeCorrecta={(id) => setBancoEditForm((f) => ({ ...f, respuestaCorrecta: id }))}
                                  radioName={`edit-correcta-${item.id}`}
                                  compact
                                />
                              )}
                              {bancoEditForm.tipo === 'verdadero_falso' && (
                                <div className="flex gap-3">
                                  {[['v', 'Verdadero'], ['f', 'Falso']].map(([id, label]) => (
                                    <label key={id} className="flex items-center gap-1.5 text-sm">
                                      <input type="radio" name={`edit-vf-${item.id}`} checked={bancoEditForm.vfRespuesta === id}
                                        onChange={() => setBancoEditForm((f) => ({ ...f, vfRespuesta: id }))} className="accent-[var(--accent)]" />
                                      {label}
                                    </label>
                                  ))}
                                </div>
                              )}
                              <input type="text" value={bancoEditForm.tema} onChange={(e) => setBancoEditForm((f) => ({ ...f, tema: e.target.value }))}
                                placeholder="Tema para agrupar en el banco (opcional, ej. Fracciones)" className="w-full px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                              <div className="flex gap-2">
                                <button type="button" onClick={() => { setEditingBancoId(null); setGlowId(item.id) }} className="flex-1 py-1.5 text-sm text-muted">Cancelar</button>
                                <button type="button" onClick={() => handleSaveBancoEdit(item.id)} disabled={saving || JSON.stringify(bancoEditForm) === bancoEditSnap.current}
                                  className="flex-1 py-1.5 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">Guardar</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2">
                              <button
                                type="button"
                                aria-label={selectedBancoIds.has(item.id) ? 'Quitar de la selección' : 'Seleccionar'}
                                onClick={() => setSelectedBancoIds((prev) => {
                                  const next = new Set(prev)
                                  next.has(item.id) ? next.delete(item.id) : next.add(item.id)
                                  return next
                                })}
                                className="mt-0.5 flex-shrink-0 text-accent"
                              >
                                {selectedBancoIds.has(item.id) ? <CheckSquare size={16} /> : <Square size={16} className="text-slate-300" />}
                              </button>
                              <button type="button" onClick={() => handleAddFromBanco(item)} disabled={saving}
                                className="flex-1 text-left text-sm hover:text-accent transition-colors disabled:opacity-60">
                                {item.enunciado}
                                {(item.materia || item.tema) && (
                                  <span className="block text-xs text-slate-400 mt-0.5">
                                    {item.materia && <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded mr-1.5">{item.materia}</span>}
                                    {item.tema}
                                  </span>
                                )}
                              </button>
                              <div className="flex gap-1 flex-shrink-0">
                                <button type="button" aria-label="Editar" onClick={() => openEditBanco(item)} className="p-2 text-slate-400 hover:text-accent rounded"><Pencil size={14} /></button>
                                <button type="button" aria-label="Duplicar" onClick={() => handleDuplicateBancoItem(item)} className="p-2 text-slate-400 hover:text-accent rounded"><Copy size={14} /></button>
                                <button type="button" aria-label="Eliminar" onClick={() => handleDeleteBancoItem(item.id)} className="p-2 text-slate-400 hover:text-error rounded"><Trash2 size={14} /></button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <button type="button" onClick={() => { setShowBanco(false); setEditingBancoId(null); setGlowId(null) }}
                    className="w-full mt-3 py-2.5 bg-accent text-white text-sm font-semibold rounded-card hover:bg-accent-hover transition-colors">Cerrar</button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'config' && configForm && (
          <form onSubmit={handleSaveConfig} className="bg-surface-card rounded-card shadow-card p-3 space-y-3">
            <Select
              id="config-orden"
              label="Orden de las preguntas"
              value={configForm.ordenPreguntas}
              onChange={(v) => setConfigForm((f) => ({ ...f, ordenPreguntas: v }))}
              options={[
                { value: 'creacion', label: 'Orden de creación' },
                { value: 'aleatorio', label: 'Aleatorio' },
              ]}
            />
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={!!configForm.barajarRespuestas}
                onChange={(e) => setConfigForm((f) => ({ ...f, barajarRespuestas: e.target.checked }))} className="accent-[var(--accent)]" />
              Barajar el orden de las opciones dentro de cada pregunta
            </label>
            {/* Solo tiene sentido cuando el instrumento usa secciones. Apagarlo
                las oculta por completo: el estudiante ve una lista continua,
                aunque por dentro los reactivos sigan agrupados (y el orden
                aleatorio siga barajando dentro de cada sección). */}
            {seccionesCtl.secciones.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={configForm.mostrarSecciones !== false}
                  onChange={(e) => setConfigForm((f) => ({ ...f, mostrarSecciones: e.target.checked }))} className="accent-[var(--accent)]" />
                Mostrar al estudiante el nombre de las secciones
              </label>
            )}
            <Select
              id="config-navegacion"
              label="Navegación"
              value={configForm.navegacion}
              onChange={(v) => setConfigForm((f) => ({ ...f, navegacion: v }))}
              options={[
                { value: 'libre', label: 'Libre — puede regresar' },
                { value: 'secuencial', label: 'Secuencial — no puede regresar' },
              ]}
            />
            <div>
              <label htmlFor="config-tiempo" className="block text-sm font-medium text-muted mb-1">Tiempo límite (minutos)</label>
              <input id="config-tiempo" type="number" min="1" value={configForm.tiempoLimiteMin ?? ''}
                onChange={(e) => setConfigForm((f) => ({ ...f, tiempoLimiteMin: e.target.value ? parseInt(e.target.value, 10) : null }))}
                placeholder="Sin límite" className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
            </div>
            <div>
              <label htmlFor="config-intentos" className="block text-sm font-medium text-muted mb-1">Intentos permitidos</label>
              <input id="config-intentos" type="number" min="1" value={configForm.intentosPermitidos ?? ''}
                onChange={(e) => setConfigForm((f) => ({ ...f, intentosPermitidos: e.target.value ? parseInt(e.target.value, 10) : null }))}
                placeholder="Ilimitados" className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
            </div>
            {/* Multi-attempt policy only matters with more than one attempt — with a
                single attempt "conservar la mejor/última" is noise (Don't Make Me Think). */}
            {configForm.intentosPermitidos !== 1 && (
              <Select
                id="config-conservar"
                label="Si hay varios intentos, conservar"
                value={configForm.conservar}
                onChange={(v) => setConfigForm((f) => ({ ...f, conservar: v }))}
                options={[
                  { value: 'primero', label: 'El primer intento' },
                  { value: 'ultimo', label: 'El último intento' },
                  { value: 'mejor', label: 'La calificación más alta' },
                  { value: 'promedio', label: 'El promedio de todos los intentos' },
                ]}
              />
            )}
            {/* Un diagnóstico o una encuesta: se contesta y se revisa, pero no
                vale para la boleta. Va aquí arriba porque cambia el sentido de
                todo lo de abajo (si no hay calificación, publicarla no aplica). */}
            <SinCalificacionConfig
              sinCalificacion={configForm.sinCalificacion}
              ponderarReactivos={configForm.ponderarReactivos}
              onChange={(cambio) => setConfigForm((f) => ({ ...f, ...cambio }))}
            />
            {/* Grade publication and answer publication are independent: a teacher can
                release the score now and the answers later (or never). */}
            <div className="pt-1 border-t border-outline-variant space-y-3">
              <p className="text-xs font-medium text-muted uppercase tracking-wide pt-2">Publicación al estudiante</p>
              <PublicacionScheduler
                id="config-publicar-resultados"
                label="Publicar resultados (calificación)"
                mode={configForm.publicarResultados}
                fecha={configForm.publicarResultadosFecha}
                onModeChange={(v) => setConfigForm((f) => ({ ...f, publicarResultados: v }))}
                onFechaChange={(v) => setConfigForm((f) => ({ ...f, publicarResultadosFecha: v }))}
              />
              <PublicacionScheduler
                id="config-publicar-respuestas"
                label="Publicar respuestas"
                hint="El alumno verá sus respuestas, las respuestas correctas y la retroalimentación (si existe)."
                mode={configForm.publicarRespuestas}
                fecha={configForm.publicarRespuestasFecha}
                onModeChange={(v) => setConfigForm((f) => ({ ...f, publicarRespuestas: v }))}
                onFechaChange={(v) => setConfigForm((f) => ({ ...f, publicarRespuestasFecha: v }))}
              />
            </div>
            <button type="submit" disabled={savingConfig || JSON.stringify(configForm) === configSnap.current}
              className={`w-full py-2 text-sm font-medium rounded disabled:opacity-60 ${JSON.stringify(configForm) !== configSnap.current ? 'bg-accent text-white' : 'bg-surface-container text-on-surface'}`}>
              {savingConfig ? 'Guardando…' : 'Guardar configuración'}
            </button>
          </form>
        )}

        {tab === 'resultados' && (
          <div>
            {/* Las fechas ya NO van aquí: subieron al encabezado, junto al
                título, como en EVALUAR. Abajo se queda solo lo que sí es de
                esta pestaña. */}
            {activity.instrucciones && (
              <div className="mb-3 rounded-card overflow-hidden bg-surface-card" style={{ border: '1px solid var(--accent)' }}>
                <div className="px-4 py-2" style={{ background: 'var(--accent-light)', borderBottom: '1px solid var(--accent)' }}>
                  <h2 className="font-semibold text-sm" style={{ color: 'var(--accent)' }}>Instrucciones</h2>
                </div>
                <div
                  className={`text-sm text-on-surface p-4 ${richTextContentClass}`}
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(toRichHtml(activity.instrucciones)) }}
                />
              </div>
            )}
            <EvaluacionStatsPanel
              stats={stats}
              totalEstudiantes={students.length}
              totalEntregas={Object.values(submissions).filter((s) => s.estadoEvaluacion === 'finalizado').length}
              totalPendientes={students.filter((x) => submissions[x.id]?.estadoEvaluacion !== 'finalizado').length}
              maxCalif={activity.maxCalif || 10}
              onGraficas={() => setShowGraficas(true)}
            />
            {/* OP-10: solo aparece cuando hay entregas suficientes para un
                análisis significativo — mismo umbral que valida el servidor. */}
            {Object.values(submissions).filter((s) => s.estadoEvaluacion === 'finalizado').length >= MIN_ENTREGAS_ANALISIS && (
              <button type="button" onClick={() => setAnalisisConfirmando(true)}
                className="w-full mb-3 flex items-center justify-center gap-1.5 py-2.5 text-sm border-2 border-accent text-accent font-semibold rounded-card hover:bg-[var(--accent-tint)] transition-colors">
                <Sparkles size={15} /> Analizar resultados con IA
              </button>
            )}
            {/* Bitácora de OP-10: ver un análisis anterior o descargar su PDF
                es gratis; solo generar uno NUEVO cuesta créditos (botón de
                arriba). Cada renglón es la fotografía exacta de esa
                generación, no se recalcula con las entregas actuales. */}
            {analisisHistorial.length > 0 && (
              <div className="mb-3 bg-surface-card rounded-card shadow-card p-3 space-y-1">
                <p className="text-xs font-bold uppercase tracking-wide text-muted px-1">Bitácora de análisis con IA</p>
                <ul className="divide-y divide-outline-variant">
                  {analisisHistorial.map((h) => (
                    <li key={h.id} className="py-2 px-1 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-on-surface font-medium truncate">
                          {new Date(millisDeGeneradoEn(h.generadoEn)).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
                        </p>
                        <p className="text-xs text-muted">
                          {h.entregasConsideradas} entrega{h.entregasConsideradas !== 1 ? 's' : ''} considerada{h.entregasConsideradas !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button type="button" onClick={() => verAnalisisHistorico(h)}
                          className="px-2.5 py-1 text-xs font-semibold border border-outline-variant rounded hover:bg-surface-container transition-colors">
                          Ver
                        </button>
                        <button type="button" onClick={() => descargarAnalisisHistoricoPDF(h)}
                          disabled={analisisDescargandoId === h.id}
                          className="px-2.5 py-1 text-xs font-semibold border border-outline-variant rounded hover:bg-surface-container transition-colors disabled:opacity-60">
                          {analisisDescargandoId === h.id ? '…' : 'PDF'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {analisisConfirmando && (
              <ConfirmacionCreditosModal
                titulo="Analizar resultados con IA"
                descripcion="El asistente analiza los resultados reales de esta evaluación (aciertos por reactivo, patrones y estudiantes con desempeño bajo) y propone un resumen con recomendaciones. Es una propuesta: tú decides qué hacer con ella."
                costoMin={creditosIA.estimar('analizar_resultados') ?? 5}
                ejecutando={analisisTrabajando}
                onCancelar={() => { if (!analisisTrabajando) setAnalisisConfirmando(false) }}
                onContinuar={generarAnalisisIA}
              />
            )}
            {analisisResultado && (
              <AnalisisResultadosIA
                resultado={analisisResultado}
                students={students}
                activity={activity}
                subject={subject}
                membrete={membrete}
                watermark={exportsWatermarked}
                generadoEn={analisisGeneradoEn}
                onClose={() => { setAnalisisResultado(null); setAnalisisGeneradoEn(null); setAnalisisId(null) }}
                onGuardar={analisisId ? guardarAnalisisEditado : null}
                onPedirDescarga={(ejecutar) => {
                  if (exportsWatermarked) { setPendingExport({ run: ejecutar }); return }
                  ejecutar()
                }}
              />
            )}
            {/* Descargar los resultados de este cuestionario/examen. Van aquí,
                pegados al análisis de resultados, porque es justo lo que el
                docente acaba de ver en pantalla: el Excel para trabajarlo y el
                PDF para archivarlo o entregarlo. Las gráficas se descargan
                desde su propia pantalla (botón "Gráficas" de arriba). */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-muted flex-shrink-0">Descargar resultados:</span>
              {[['excel', 'Excel', FileSpreadsheet], ['pdf', 'PDF', FileText]].map(([kind, label, Icon]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => handleExportResultados(kind)}
                  disabled={exportingResultados != null}
                  data-tooltip={kind === 'excel'
                    ? 'Calificaciones, respuestas de cada estudiante y resumen por reactivo'
                    : 'Resumen por reactivo: opción, respuestas y porcentaje'}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-accent text-accent text-xs font-semibold hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-60"
                >
                  {exportingResultados === kind ? <Spinner size="sm" /> : <Icon size={14} />}
                  {exportingResultados === kind ? 'Generando…' : label}
                </button>
              ))}
            </div>
            {configForm?.publicarResultados === 'manual' && !configForm.resultadosPublicados && (
              <button type="button" onClick={handlePublicarResultados} className="w-full mb-3 py-2 bg-accent text-white text-sm font-medium rounded">
                Publicar resultados a tus estudiantes
              </button>
            )}
            {/* ── Entregas — same treatment as a regular activity ── */}
            {(() => {
              const resultCounts = {
                todos: students.length,
                pendiente: students.filter((x) => estadoFiltroKey(submissions[x.id]) === 'pendiente').length,
                calificado: students.filter((x) => estadoFiltroKey(submissions[x.id]) === 'calificado').length,
                porCalificar: students.filter((x) => estadoFiltroKey(submissions[x.id]) === 'porCalificar').length,
              }
              const visibles = students.filter((x) =>
                (filtroResultados === 'todos' || estadoFiltroKey(submissions[x.id]) === filtroResultados) &&
                (!searchResultados.trim() || matchesStudentSearch(x, searchResultados))
              )
              return (
            <>
              {/* Con reactivos de respuesta escrita / subir documento, el docente
                  debe intervenir: aviso + salto directo a la primera por calificar. */}
              {hasManual && resultCounts.porCalificar > 0 && (
                <div className="mb-3 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-card flex items-center gap-2 text-sm text-amber-800 flex-wrap">
                  <span className="flex-1 min-w-[12rem]">
                    <strong>{resultCounts.porCalificar}</strong> entrega{resultCounts.porCalificar !== 1 ? 's' : ''} con reactivos de respuesta escrita o documentos que debes calificar.
                    {(() => {
                      const pendIA = Object.values(iaSugerencias).reduce((n, m) => n + Object.keys(m).length, 0)
                      return pendIA > 0 ? (
                        <span className="block text-xs text-accent mt-0.5">
                          <Sparkles size={11} className="inline mr-1" aria-hidden="true" />
                          {pendIA} sugerencia{pendIA !== 1 ? 's' : ''} de IA pendiente{pendIA !== 1 ? 's' : ''} de aplicar — ábrelas al calificar, sin costo adicional.
                        </span>
                      ) : null
                    })()}
                  </span>
                  {/* C-02: sugerencias de calificación por IA para TODOS los
                      pendientes con respuestas de texto. Estimación previa
                      obligatoria; la IA solo sugiere, el docente decide. */}
                  {preguntas.some((p) => p.tipo === 'respuesta_corta') && (
                    <button
                      type="button"
                      onClick={contarRespuestasIA}
                      disabled={iaContando || iaTrabajando}
                      className="flex-shrink-0 px-3 py-1.5 bg-accent text-white text-xs font-semibold rounded hover:bg-accent-hover transition-colors flex items-center gap-1.5 disabled:opacity-60"
                    >
                      <Sparkles size={13} />
                      {iaContando ? 'Contando…' : iaTrabajando ? 'Trabajando…' : 'Sugerir con IA'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const first = studentsForFilter('porCalificar')[0]
                      if (first) openReview(first, 'porCalificar')
                    }}
                    className="flex-shrink-0 px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded hover:bg-amber-600 transition-colors"
                  >
                    Calificar ahora
                  </button>
                </div>
              )}
              {iaConteo && (
                <ConfirmacionCreditosModal
                  titulo="Sugerir calificaciones con IA"
                  descripcion={`Se sugerirá calificación para ${iaConteo.respuestas} respuesta${iaConteo.respuestas !== 1 ? 's' : ''} de texto de ${iaConteo.estudiantes} estudiante${iaConteo.estudiantes !== 1 ? 's' : ''}. La IA solo sugiere: tú revisas y decides cada calificación.`}
                  costoMin={creditosIA.estimar('calificar_abierta', iaConteo.respuestas) ?? iaConteo.respuestas}
                  ejecutando={iaTrabajando}
                  onCancelar={() => { if (!iaTrabajando) setIaConteo(null) }}
                  onContinuar={ejecutarSugerenciasIA}
                />
              )}
            <div className="rounded-card overflow-hidden bg-surface-card shadow-card" style={{ border: '1px solid var(--accent)' }}>
              <div className="px-4 py-3" style={{ background: 'var(--accent-light)', borderBottom: '1px solid var(--accent)' }}>
                <h2 className="font-semibold" style={{ color: 'var(--accent)' }}>Entregas</h2>
              </div>
              <div className="p-3 pb-2 space-y-2">
                <div className={IS_NATIVE_APP ? 'grid grid-cols-2 gap-1 bg-surface-container p-1 rounded' : 'flex gap-1 bg-surface-container p-1 rounded'}>
                  {FILTRO_TABS.map(([k, lbl]) => (
                    <button type="button" key={k} onClick={() => setFiltroResultados(k)}
                      className={`${IS_NATIVE_APP ? '' : 'flex-1'} py-1.5 text-xs font-medium rounded transition-colors ${
                        filtroResultados === k ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'
                      }`}>
                      {lbl} ({resultCounts[k]})
                    </button>
                  ))}
                </div>
                <SearchInput
                  value={searchResultados}
                  onChange={setSearchResultados}
                  placeholder="Buscar por nombre o por número de lista…"
                  autoFocus={!IS_NATIVE_APP}
                />
                <p className="text-xs text-red-600 text-center mt-1.5">Presiona un nombre para ver resultado</p>
              </div>
              {/* Lista por estudiante — cada fila abre la revisión de pantalla
                  completa (openReview), donde se ve la entrega y, si hay
                  reactivos de respuesta breve o de archivo, se pueden calificar.
                  Altura acotada con scroll propio (rueda del mouse) para que
                  los filtros y la búsqueda de arriba no se muevan de lugar. */}
              <div className="max-h-[60vh] overflow-y-auto">
              {visibles.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-8 flex items-center justify-center gap-2"><Users size={16} /> {students.length === 0 ? 'Sin estudiantes' : 'Sin estudiantes en esta categoría'}</p>
              ) : (
                visibles.map((s, i) => {
                  const sub = submissions[s.id]
                  const estado = estadoEstudiante(sub)
                  const hasExtension = !!activity?.extensiones?.[s.id]
                  // Every row opens the full-screen review — even with no submission
                  // it shows "No realizado".
                  return (
                    <button type="button" key={s.id} id={`resultado-${s.id}`}
                      onClick={() => openReview(s, filtroResultados)}
                      className={`w-full text-left py-2 cursor-pointer hover:bg-[var(--accent-tint)] ${IS_NATIVE_APP ? 'pl-1 pr-3' : 'px-3'} ${i > 0 ? 'border-t border-outline-variant' : ''}`}>
                      <div className={`flex items-center ${IS_NATIVE_APP ? 'gap-1' : 'gap-2'}`}>
                        <span className={`${IS_NATIVE_APP ? 'text-[0.7rem]' : 'text-sm'} text-accent flex-shrink-0 whitespace-nowrap`}>{s.orden}.&nbsp;</span>
                        {/* Sin tooltip en el nombre: el aviso "Presiona un nombre para
                            ver resultado", justo arriba de la lista, ya lo dice una vez
                            para toda la lista — repetirlo en cada renglón solo estorbaba.
                            Aquí dice "ver resultado" y no "evaluar" (como en el aviso
                            gemelo de ActivityPage) porque esta lista es de evaluaciones:
                            el renglón abre la revisión de respuestas, no la calificación. */}
                        <div className="flex-1 min-w-0">
                          <p className={`${IS_NATIVE_APP ? 'text-[0.7rem]' : 'text-sm'} font-medium text-on-surface truncate`}>{studentFullName(s)}</p>
                        </div>
                        {!IS_NATIVE_APP && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                            estado === 'Calificado' || estado === 'Realizado' ? 'bg-emerald-100 text-emerald-700' :
                            estado === 'Por calificar' ? 'bg-amber-100 text-amber-700' :
                            estado === 'En proceso' ? 'bg-blue-100 text-blue-700' : 'bg-surface-container text-muted'
                          }`}>{estado}</span>
                        )}
                        {IS_NATIVE_APP && hasExtension && <CalendarDays size={15} className="text-orange-400 flex-shrink-0" />}
                        {sub?.estadoEvaluacion === 'finalizado' && (
                          IS_NATIVE_APP ? (
                            <span className="text-xs font-bold text-emerald-600 flex items-center gap-0.5 flex-shrink-0">
                              <Star size={14} /> {sub.calificacion}/{activity.maxCalif || 10}
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-on-surface flex-shrink-0">{sub.calificacion}/{activity.maxCalif || 10}</span>
                          )
                        )}
                      </div>
                    </button>
                  )
                })
              )}
              </div>
            </div>
            </>
              )
            })()}
          </div>
        )}
      </div>

      {/* ── Full-screen answer review ──────────────────────────────────────────
          Deliberately NOT the accent/blue entregable grading layout: neutral header,
          answer sheet on the main area, actions in a right sidebar (Anterior/Siguiente,
          read-only grade, Anular, Modificar fecha). Read-only — no grading, no comments. */}
      {reviewing && (() => {
        const sub = reviewing.submission
        const st = reviewing.student
        const done = sub?.estadoEvaluacion === 'finalizado'
        const nombre = studentFullName(st)
        const reviewCounts = {
          todos: students.length,
          pendiente: students.filter((x) => estadoFiltroKey(submissions[x.id]) === 'pendiente').length,
          calificado: students.filter((x) => estadoFiltroKey(submissions[x.id]) === 'calificado').length,
          porCalificar: students.filter((x) => estadoFiltroKey(submissions[x.id]) === 'porCalificar').length,
        }
        const REVIEW_TABS = FILTRO_TABS
        return (
        <div className="fixed inset-0 z-50 bg-surface flex flex-col">
          {/* Mismo patrón que el encabezado "Evaluar" de ActivityPage.jsx.
              Cerrar aquí, si se llegó desde una celda de Calificaciones (backState
              presente), regresa directo ahí — no se queda a medias en Resultados,
              que el docente nunca pidió ver.
              md:pr-[380px] reserva el mismo ancho que el <aside> de la derecha
              (md:w-[380px] — igual que el panel de calificación de
              ActivityPage.jsx, para que ambas ventanas ocupen el mismo ancho)
              para que el grupo botón+título se centre en la MISMA franja que el
              cuerpo de abajo (main, también flex-1 junto al mismo aside) — y el
              botón vive DENTRO de ese grupo centrado, pegado al título, en vez
              de quedar solo en el borde izquierdo de la pantalla. */}
          {IS_NATIVE_APP ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-surface-card border-b border-outline-variant flex-shrink-0 safe-top">
              <button type="button" onClick={goBackFromReview} aria-label="Regresar"
                className="p-2 -ml-1 text-muted hover:text-accent rounded flex-shrink-0 transition-colors">
                <ArrowLeft size={20} />
              </button>
              <h3 className="text-sm font-semibold text-on-surface truncate flex-1 min-w-0">{activityLabel}{activity.nombre}</h3>
            </div>
          ) : (
          <div className="flex items-center px-4 py-2.5 bg-surface-card border-b border-outline-variant flex-shrink-0 safe-top">
            <div className="flex-1 min-w-0 md:pr-[380px]">
              <div className="max-w-3xl mx-auto flex items-start gap-3">
                <button
                  type="button"
                  onClick={goBackFromReview}
                  className="flex items-center gap-1 p-2 -ml-2 mt-0.5 text-muted hover:text-accent rounded text-sm font-medium flex-shrink-0 transition-colors"
                >
                  <ArrowLeft size={20} /> Regresar
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="text-[1.75rem] leading-tight font-bold uppercase tracking-wide text-accent flex-shrink-0">Evaluación</p>
                    {contextLine && <p className="text-[1.75rem] leading-tight font-medium text-muted truncate">{contextLine}</p>}
                  </div>
                  {/* h2, no h1: esta superposición (fixed inset-0) cubre
                      visualmente el header de arriba (line ~1011, su propio
                      h1) pero no lo desmonta del DOM — un lector de pantalla
                      vería dos h1 a la vez. Semánticamente es correcto de
                      todos modos: revisar la entrega de un alumno es una
                      sub-vista de la página de la Evaluación, no una página
                      nueva. docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 2,
                      paso 2.7. */}
                  <h2 className="text-xl font-bold text-on-surface truncate">
                    {activityLabel && <span className="text-accent">{activityLabel} </span>}{activity.nombre}
                  </h2>
                  {/* text-base, igual que en la página de la actividad: las
                      cuatro variantes de este encabezado (EVALUAR y EVALUACIÓN,
                      página y pantalla completa) llevan la misma escala. */}
                  <p className="text-base font-medium text-muted">Parcial {activity.parcial} · {activity.categoria === 'examen' ? 'Examen' : 'Cuestionario'}</p>
                  {/* Fechas, iguales que en la página. Van DENTRO de la columna
                      del título (no sueltas abajo) para que arranquen a la misma
                      altura que el nombre, en vez de meterse bajo el botón
                      Regresar. */}
                  {(activity.publishedAt || activity.publishAt || activity.fechaLimite) && (
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {activity.publishedAt && (
                        <span data-tooltip="Publicado" className="text-sm text-emerald-600 flex items-center gap-1">
                          <Clock size={15} /> {formatPublishAt(activity.publishedAt)}
                        </span>
                      )}
                      {activity.publishAt && (
                        <span data-tooltip="Publicación programada" className="text-sm text-accent flex items-center gap-1">
                          <Clock size={15} /> {formatPublishAt(activity.publishAt)}
                        </span>
                      )}
                      {activity.fechaLimite && (
                        <span data-tooltip="Cierre" className="text-sm text-amber-600 flex items-center gap-1">
                          <Clock size={15} /> {formatDeadline(activity.fechaLimite)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Body: answer sheet (main) + actions sidebar (right). No es un
              <main> real — ya vive dentro del <main> del layout de página, y
              un segundo landmark <main> anidado es inválido (HTML/ARIA solo
              permiten uno por documento). min-h-0 sigue siendo necesario
              para que flex-1 respete el alto disponible del padre en vez de
              crecer con el contenido — sin esto el alto de esta zona variaba
              según el estudiante/aside. */}
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <div className="max-w-3xl mx-auto">
                {done ? (
                  <EvaluacionAnswerList
                    preguntas={preguntasOrdenadas}
                    respuestas={reviewing.allRespuestas}
                    mostrarSecciones={seccionesCtl.secciones.length > 0}
                    mostrarCorrectas
                    mostrarRetro
                    renderGrading={(p, respuesta) => {
                      const draft = gradeDrafts[p.id] || { puntos: '', comentario: '' }
                      const savedPuntos = respuesta.puntosObtenidos ?? ''
                      const savedComent = respuesta.comentarioDocente || ''
                      const dirty = String(draft.puntos) !== String(savedPuntos) || (draft.comentario || '') !== savedComent
                      const saving = savingGradeId === p.id
                      // C-02: sugerencia de IA para este reactivo (si el docente
                      // corrió el lote en esta sesión). Solo se muestra — nada
                      // se guarda hasta que él la aplique y presione Guardar.
                      const sug = iaSugerencias[reviewing.submission?.id]?.[p.id]
                      return (
                        <div className="mt-1 p-3 rounded border border-accent/40 bg-[var(--accent-tint)] space-y-2">
                          {sug && (
                            <div className="p-2.5 rounded border border-accent/40 bg-surface-card space-y-1.5">
                              <div className="flex items-center gap-1.5">
                                <Sparkles size={14} className="text-accent flex-shrink-0" />
                                <p className="text-xs font-semibold text-accent">Sugerencia de IA — tú decides</p>
                                <span className="ml-auto text-sm font-bold text-on-surface tabular-nums">{sug.puntos} / {p.ponderacion}</span>
                              </div>
                              {sug.criterios?.length > 1 ? (
                                <ul className="text-xs text-muted list-disc pl-4">
                                  {sug.criterios.map((cr) => <li key={cr.n}>{cr.puntos} pts — {cr.evidencia}</li>)}
                                </ul>
                              ) : sug.criterios?.[0]?.evidencia ? (
                                <p className="text-xs text-muted">Evidencia: {sug.criterios[0].evidencia}</p>
                              ) : null}
                              {sug.fortalezas?.length > 0 && (
                                <p className="text-xs text-emerald-700">✓ {sug.fortalezas.join(' · ')}</p>
                              )}
                              {sug.errores?.length > 0 && (
                                <ul className="text-xs text-red-700/80 list-disc pl-4">
                                  {sug.errores.map((e, ei) => <li key={ei}>{e.error}{e.evidencia ? ` — “${e.evidencia}”` : ''}</li>)}
                                </ul>
                              )}
                              {sug.retroalimentacion && (
                                <p className="text-xs text-muted italic">“{sug.retroalimentacion}”</p>
                              )}
                              <button
                                type="button"
                                onClick={() => setGradeDrafts((d) => ({
                                  ...d,
                                  [p.id]: { puntos: String(sug.puntos), comentario: sug.retroalimentacion || '' },
                                }))}
                                className="w-full py-1.5 border border-accent text-accent text-xs font-semibold rounded hover:bg-[var(--accent-medium)] transition-colors"
                              >
                                Usar sugerencia (puedes editarla antes de guardar)
                              </button>
                            </div>
                          )}
                          <div className="flex items-center gap-2 flex-wrap">
                            <label htmlFor={`grade-${p.id}`} className="text-sm font-medium text-on-surface">Puntos</label>
                            <input
                              id={`grade-${p.id}`}
                              type="number" min="0" max={p.ponderacion} step="0.1"
                              value={draft.puntos}
                              onChange={(e) => setGradeDrafts((d) => ({ ...d, [p.id]: { ...draft, puntos: e.target.value } }))}
                              placeholder="0"
                              className="w-24 px-3 py-1.5 rounded border border-outline-variant text-sm bg-surface-card"
                            />
                            <span className="text-sm text-muted">/ {p.ponderacion}</span>
                            {respuesta.puntosObtenidos == null && (
                              <span className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">Pendiente de calificar</span>
                            )}
                          </div>
                          <textarea
                            value={draft.comentario}
                            onChange={(e) => setGradeDrafts((d) => ({ ...d, [p.id]: { ...draft, comentario: e.target.value } }))}
                            rows={2}
                            placeholder="Comentario para el estudiante (opcional)…"
                            className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface-card resize-none"
                          />
                          <button
                            type="button"
                            onClick={() => saveGrade(p)}
                            disabled={saving || !dirty || draft.puntos === ''}
                            className="w-full py-1.5 bg-accent text-white text-sm font-medium rounded disabled:opacity-60 flex items-center justify-center gap-2"
                          >
                            {saving ? <Spinner size="sm" /> : null}
                            {saving ? 'Guardando…' : 'Guardar puntos'}
                          </button>
                        </div>
                      )
                    }}
                  />
                ) : (
                  <div className="text-center py-20">
                    <p className="text-2xl font-bold text-slate-400">No realizado</p>
                    <p className="text-sm text-slate-400 mt-1">Este estudiante aún no ha realizado la evaluación.</p>
                  </div>
                )}
              </div>
            </div>

            <aside className="w-full md:w-[380px] flex-shrink-0 border-t md:border-t-0 md:border-l border-outline-variant bg-surface-card overflow-y-auto p-4 space-y-3">
              {/* Filter tabs — 2×2 grid en web. En Android estas 4 se
                  reducen a las dos etiquetas "Todos"/"Por calificar" junto a
                  la calificación (mismo patrón que Evaluar), no van aquí arriba. */}
              {!IS_NATIVE_APP && (
                <div className="grid grid-cols-2 gap-1.5 bg-surface-container p-1.5 rounded-card">
                  {REVIEW_TABS.map(([k, lbl]) => (
                    <button type="button" key={k} onClick={() => changeReviewFilter(k)}
                      className={`py-2 px-2 text-sm font-semibold rounded transition-colors ${
                        reviewFilter === k
                          ? 'bg-accent text-white shadow-card'
                          : 'bg-surface-card text-muted hover:text-accent hover:bg-[var(--accent-medium)]'
                      }`}>
                      {lbl} ({k === 'todos' ? reviewCounts.todos : reviewCounts[k]})
                    </button>
                  ))}
                </div>
              )}

              <div>
                <p className={`font-semibold text-on-surface leading-tight truncate ${IS_NATIVE_APP ? 'text-[0.8rem]' : ''}`}>
                  {st.orden != null && <span className="text-on-surface">{st.orden}. </span>}
                  {nombre}
                </p>
                {/* Reserve the line even when not done so Anterior/Siguiente never move (web only — en Android no se muestran fechas/intentos) */}
                {!IS_NATIVE_APP && (
                  <p className={`text-xs text-slate-400 mt-0.5 min-h-4 ${done ? '' : 'invisible'}`}>
                    {done
                      ? `${fmtDuracion(sub.tiempoInicio, sub.fechaEntrega)} · Enviado ${fmtHora(sub.fechaEntrega)} · Intento ${sub.intentoActual || 1}`
                      : ' '}
                  </p>
                )}
              </div>

              {/* Anterior / Siguiente — mismo tamaño y jerarquía (Siguiente
                  relleno = acción principal, Anterior con borde) que el panel
                  de calificación de ActivityPage.jsx, para que ambos paneles
                  ocupen el mismo espacio y se sientan del mismo peso visual.
                  En Android, ~30% menos alto (py-1.5 text-sm en vez de
                  py-2.5 text-base). */}
              <div className="flex gap-2">
                <button type="button" onClick={() => goReview(-1)} disabled={reviewNav.length < 2}
                  className={`flex-1 flex items-center justify-center gap-1 rounded border border-accent text-accent font-semibold hover:bg-[var(--accent-medium)] disabled:opacity-60 transition-colors ${IS_NATIVE_APP ? 'py-1 text-sm' : 'py-2.5 text-base'}`}>
                  <ChevronLeft size={IS_NATIVE_APP ? 16 : 20} /> Anterior
                </button>
                <button type="button" onClick={() => goReview(1)} disabled={reviewNav.length < 2}
                  className={`flex-1 flex items-center justify-center gap-1 rounded bg-accent text-white font-semibold hover:bg-accent-hover disabled:opacity-60 transition-colors ${IS_NATIVE_APP ? 'py-1 text-sm' : 'py-2.5 text-base'}`}>
                  Siguiente <ChevronRight size={IS_NATIVE_APP ? 16 : 20} />
                </button>
              </div>

              {IS_NATIVE_APP ? (
                /* Calificación de SOLO LECTURA — es el resultado obtenido por
                   el estudiante al presentar (más los puntos que el docente
                   asigne a los reactivos manuales vía "Guardar puntos" en la
                   lista de respuestas, que ya recalculan este valor), nunca
                   algo que el docente ajuste aquí directamente. Mismo layout
                   de 3 zonas que la fila de calificación de ActivityPage.jsx:
                   Todos/Por calificar "abrazando" el borde izquierdo, la
                   calificación al centro (con el mismo subrayado de acento
                   que tenía el input editable, para que siga notándose
                   distinta al resto del texto), Modificar fecha/Anular
                   abrazando el borde derecho. El ícono de Anular reserva su
                   espacio con `invisible` en vez de desmontarse, para que
                   esta fila nunca cambie de alto al avanzar/retroceder entre
                   estudiantes con y sin calificación. */
                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-2 flex-shrink-0 -ml-3">
                    <button type="button" onClick={() => changeReviewFilter('todos')}
                      className={`h-9 min-w-[104px] pl-3 pr-2 rounded-r border text-left text-[11px] font-semibold whitespace-nowrap transition-colors flex items-center ${
                        reviewFilter === 'todos' ? 'border-accent bg-accent-light text-accent' : 'border-outline-variant text-muted hover:bg-[var(--accent-medium)]'
                      }`}>
                      Todos ({reviewCounts.todos})
                    </button>
                    <button type="button" onClick={() => changeReviewFilter('porCalificar')}
                      className={`h-9 min-w-[104px] pl-3 pr-2 rounded-r border text-left text-[11px] font-semibold whitespace-nowrap transition-colors flex items-center ${
                        reviewFilter === 'porCalificar' ? 'border-accent bg-accent-light text-accent' : 'border-outline-variant text-muted hover:bg-[var(--accent-medium)]'
                      }`}>
                      {FILTRO_TABS.find(([k]) => k === 'porCalificar')[1]} ({reviewCounts.porCalificar})
                    </button>
                  </div>
                  <div className="flex-1 flex items-center justify-center min-w-0">
                    <p className="text-[2.7rem] font-bold text-on-surface leading-none border-b-2 border-accent px-2 pb-1">
                      {done ? `${sub.calificacion}/${activity.maxCalif || 10}` : '—'}
                    </p>
                  </div>
                  <div className="w-px h-9 bg-outline-variant flex-shrink-0" />
                  <div className="flex flex-col gap-2 flex-shrink-0 -mr-3">
                    <button type="button" onClick={() => setExtendMode(true)} aria-label="Modificar fecha de entrega" data-tooltip="Modificar fecha de entrega"
                      className="h-9 pl-2 pr-3 rounded-l border border-outline-variant text-muted hover:text-accent hover:border-accent flex items-center justify-center transition-colors">
                      <CalendarDays size={17} />
                    </button>
                    <button type="button" onClick={() => setCancelConfirm({ student: st, sub })} aria-label="Anular la entrega" data-tooltip="Anular la entrega"
                      className={`h-9 pl-2 pr-3 rounded-l border border-outline-variant text-muted hover:text-red-600 hover:border-red-300 flex items-center justify-center transition-colors ${done ? '' : 'invisible'}`}>
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Read-only obtained grade */}
                  <div className="rounded border border-outline-variant p-3 text-center">
                    <p className="text-sm font-medium text-muted">Calificación obtenida</p>
                    <p className="text-2xl font-bold text-on-surface">{done ? `${sub.calificacion}/${activity.maxCalif || 10}` : '—'}</p>
                  </div>

                  {/* Anular la entrega actual */}
                  {done && (
                    <button type="button" onClick={() => setCancelConfirm({ student: st, sub })}
                      className="w-full text-sm text-slate-500 hover:text-red-600 transition-colors py-1">
                      Anular la entrega actual para este estudiante
                    </button>
                  )}

                  {/* Modificar fecha de entrega para este estudiante */}
                  {!extendMode ? (
                    <button type="button" onClick={() => setExtendMode(true)}
                      className="w-full text-sm text-slate-500 hover:text-muted transition-colors py-1">
                      Modificar fecha de entrega para este estudiante
                    </button>
                  ) : (
                    <div className="space-y-2 pt-1 border-t border-outline-variant">
                      <p className="text-sm font-medium text-on-surface flex items-center gap-1.5"><CalendarDays size={15} className="text-accent" /> Nueva fecha y hora</p>
                      <EFDateTimePicker mode="datetime" value={extendDate} onChange={setExtendDate} clearable={false} defaultTime="23:59" minDateTime={toIsoNow()} />
                      <textarea value={extendMotivo} onChange={(e) => setExtendMotivo(e.target.value)} rows={2}
                        placeholder="Motivo (opcional)…"
                        className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface resize-none" />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setExtendMode(false)} className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors">Cancelar</button>
                        <button type="button" onClick={saveReviewExtension} disabled={!extendDate || savingExtension || reviewExtensionUnchanged}
                          className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold disabled:opacity-60 transition-colors">
                          {savingExtension ? 'Guardando…' : 'Guardar'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
              <div className="h-2 safe-bottom" />
            </aside>
          </div>
        </div>
        )
      })()}

      {/* "Modificar fecha" en Android — ventana flotante en vez de formulario
          en línea (mismo patrón que ActivityPage.jsx), para que el alto del
          aside — y por lo tanto el de la zona de respuestas — no varíe. */}
      {reviewing && IS_NATIVE_APP && extendMode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setExtendMode(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-sm p-4 space-y-2">
            <p className="text-sm font-medium text-on-surface flex items-center gap-1.5"><CalendarDays size={15} className="text-accent" /> Nueva fecha y hora límite para este estudiante</p>
            <EFDateTimePicker mode="datetime" value={extendDate} onChange={setExtendDate} clearable={false} defaultTime="23:59" minDateTime={toIsoNow()} />
            <div>
              <label htmlFor="eval-extend-motivo-native" className="block text-sm font-medium text-muted mb-1">Motivo</label>
              <textarea
                id="eval-extend-motivo-native"
                value={extendMotivo}
                onChange={(e) => setExtendMotivo(e.target.value)}
                rows={2}
                placeholder="Motivo de la extensión…"
                className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setExtendMode(false)} className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={saveReviewExtension} disabled={!extendDate || savingExtension || reviewExtensionUnchanged}
                className="flex-1 py-2 bg-accent text-white text-sm font-semibold rounded disabled:opacity-60 transition-colors">
                {savingExtension ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Editor completo del cuestionario/examen — el mismo que abre "editar"
          desde el parcial en la asignatura */}
      {showEvalEditor && (
        <EvaluacionEditor
          activityId={activityId}
          parcial={activity.parcial}
          categoria={activity.categoria}
          activityLabel={activityLabel}
          contextLine={contextLine}
          subjectId={activity.asignaturaId}
          docenteId={activity.docenteId}
          subject={subject}
          existingActivities={[]}
          students={students}
          onClose={closeEvalEditor}
          onActivityUpdated={(act) => onActivityChange((prev) => ({ ...prev, ...act }))}
          onDeleteActivity={onDeleteActivity}
        />
      )}

      {/* Anular-entrega confirmation */}
      {cancelConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !cancelling && setCancelConfirm(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-[calc(100%-2rem)] max-w-sm rounded-card p-4 shadow-2xl">
            <h3 className="text-base font-semibold text-on-surface">¿Anular la entrega?</h3>
            <p className="text-sm text-muted mt-2">
              Se eliminará la entrega de <strong>{studentFullName(cancelConfirm.student)}</strong> y sus respuestas.
              Volverá a quedar sin entrega y podrá presentar de nuevo.
            </p>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setCancelConfirm(null)} disabled={cancelling}
                className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors">No, conservar</button>
              <button type="button" onClick={handleCancelSubmission} disabled={cancelling}
                className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors">
                {cancelling ? 'Anulando…' : 'Sí, anular entrega'}</button>
            </div>
          </div>
        </div>
      )}

      {seccionesCtl.porBorrar && (
        <ConfirmarBorrarSeccion
          seccion={seccionesCtl.porBorrar}
          total={preguntas.filter((p) => p.seccionId === seccionesCtl.porBorrar.id).length}
          borrando={seccionesCtl.borrando}
          onConfirm={seccionesCtl.confirmarBorrado}
          onCancel={() => seccionesCtl.setPorBorrar(null)}
        />
      )}

      {showGraficas && (
        <EvaluacionGraficas
          activity={activity}
          activityLabel={activityLabel}
          subject={subject}
          preguntas={preguntasOrdenadas}
          submissions={submissions}
          onClose={() => setShowGraficas(false)}
        />
      )}

      {/* Mismo aviso que en el resto de las exportaciones del docente: en
          periodo de prueba los archivos salen con marca de agua, y se le dice
          antes de generarlos, no después.
          `z={90}`: el PDF del análisis de OP-10 se pide desde dentro de
          AnalisisResultadosIA, que es una pantalla completa a z-[60] — con
          el z-index por defecto (50) este aviso quedaba TAPADO detrás de esa
          pantalla, invisible aunque técnicamente estuviera montado. */}
      {pendingExport && (
        <ConfirmModal
          z={90}
          title="Exportación en periodo de prueba"
          message="Los documentos generados durante el periodo de prueba incluyen una marca de agua de Evalúa Fácil. Al activar tu suscripción, todas las exportaciones se generarán sin marca de agua."
          confirmLabel="Continuar"
          onConfirm={() => { const p = pendingExport; setPendingExport(null); p.run() }}
          onCancel={() => setPendingExport(null)}
        />
      )}
    </div>
  )
}
