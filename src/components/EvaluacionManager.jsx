import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, query, where, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { db, auth } from '../firebase'
import { useToast } from './Toast'
import Spinner from './Spinner'
import { sanitizeHtml, richTextContentClass, toRichHtml } from '../utils/sanitizeHtml'
import { formatDeadline, formatPublishAt } from '../utils/activityVisibility'
import { matchesStudentSearch, studentFullName } from '../utils/studentSearch'
import { IS_NATIVE_APP } from '../utils/platform'
import { uploadToCloudinary } from '../utils/cloudinary'
import EFDateTimePicker from './EFDateTimePicker'
import SearchInput from './SearchInput'
import { TEACHER_CONTAINER_NARROW } from '../config/layout'
import {
  calcularEstadisticasGrupo, calcularCalificacion, resolverPendienteRevision,
  resolverCalificacionFinal, TIPOS_REVISION_MANUAL,
} from '../utils/evaluacionGrading'
import { ArrowLeft, Plus, Trash2, Library, Users, Pencil, Copy, Image as ImageIcon, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Clock, CalendarDays, Star } from 'lucide-react'
import EvaluacionAnswerList from './EvaluacionAnswerList'
import EvaluacionStatsPanel from './EvaluacionStatsPanel'
import EvaluacionGraficas from './EvaluacionGraficas'
import PublicacionScheduler from './PublicacionScheduler'
import EvaluacionEditor from './EvaluacionEditor'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'

const TIPOS_PREGUNTA = [
  { value: 'opcion_multiple', label: 'Opción múltiple' },
  { value: 'verdadero_falso', label: 'Verdadero / Falso' },
  { value: 'respuesta_corta', label: 'Respuesta corta' },
  { value: 'subir_archivo', label: 'Subir documento' },
]
const OPCION_IDS = ['a', 'b', 'c', 'd']

function toIsoNow() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}
const EMPTY_PREGUNTA = {
  tipo: 'opcion_multiple', enunciado: '', opciones: { a: '', b: '', c: '', d: '' }, respuestaCorrecta: 'a',
  vfRespuesta: 'v', ponderacion: 1, retroalimentacion: '', imagenFile: null, guardarEnBanco: false, tema: '',
}

const TABS = [
  { key: 'preguntas', label: 'Preguntas' },
  { key: 'config', label: 'Configuración' },
  { key: 'resultados', label: 'Resultados' },
]

function fmtHora(ts) {
  if (!ts?.seconds) return '—'
  return new Date(ts.seconds * 1000).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
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
export default function EvaluacionManager({ activity, subject, activityId, activityLabel, contextLine, students, submissions, onActivityChange, onSubmissionRemoved = null, onSubmissionUpdated = null, resultadosOnly = false, backState = null, openStudentId = null }) {
  const navigate = useNavigate()
  const toast = useToast()
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
  const [preguntaForm, setPreguntaForm] = useState(EMPTY_PREGUNTA)
  const [saving, setSaving] = useState(false)
  const [banco, setBanco] = useState([])
  const [bancoLoaded, setBancoLoaded] = useState(false)
  const [showBanco, setShowBanco] = useState(false)
  useBackHandler(() => setShowBanco(false), showBanco)
  useScrollLock(showBanco)
  // Per-reactivo pie charts overlay — owns its own useBackHandler/useScrollLock
  // (same pattern as ZoomableImage's overlay), so just a flag here.
  const [showGraficas, setShowGraficas] = useState(false)
  const [editingPreguntaId, setEditingPreguntaId] = useState(null)
  const [preguntaEditForm, setPreguntaEditForm] = useState(null)
  const [bancoSearch, setBancoSearch] = useState('')
  const [bancoTemaFilter, setBancoTemaFilter] = useState('')
  const [bancoMateriaFilter, setBancoMateriaFilter] = useState('')
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
      const snap = await getDocs(collection(db, 'activities', activityId, 'preguntas'))
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
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
      return { ...base, opciones: OPCION_IDS.map((id) => ({ id, texto: form.opciones[id].trim() })), respuestaCorrecta: form.respuestaCorrecta }
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
    if (form.tipo === 'opcion_multiple' && OPCION_IDS.some((id) => !form.opciones[id].trim())) {
      toast('Completa las 4 opciones', 'error'); return false
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
      const orden = preguntas.length === 0 ? 0 : Math.max(...preguntas.map((p) => p.orden ?? 0)) + 1
      const data = { ...buildPreguntaData(preguntaForm), imagenUrl, orden, origenBancoId: null }
      const ref = await addDoc(collection(db, 'activities', activityId, 'preguntas'), data)
      setPreguntas((prev) => [...prev, { id: ref.id, ...data }])
      setGlowId(ref.id)
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
      setPreguntaForm(EMPTY_PREGUNTA)
      setShowPreguntaForm(false)
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
      const orden = preguntas.length === 0 ? 0 : Math.max(...preguntas.map((p) => p.orden ?? 0)) + 1
      const data = {
        tipo: item.tipo, enunciado: item.enunciado, opciones: item.opciones || null,
        respuestaCorrecta: item.respuestaCorrecta || null, ponderacion: 1, retroalimentacion: null,
        imagenUrl: null, orden, origenBancoId: item.id,
      }
      const ref = await addDoc(collection(db, 'activities', activityId, 'preguntas'), data)
      setPreguntas((prev) => [...prev, { id: ref.id, ...data }])
      setGlowId(ref.id)
      await syncNumPreguntas(preguntas.length + 1)
      toast('Pregunta agregada desde tu banco')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeletePregunta(id) {
    if (!confirm('¿Eliminar esta pregunta?')) return
    try {
      await deleteDoc(doc(db, 'activities', activityId, 'preguntas', id))
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
    setPreguntaEditForm({
      tipo: p.tipo,
      enunciado: p.enunciado,
      opciones: p.tipo === 'opcion_multiple'
        ? { a: p.opciones?.[0]?.texto || '', b: p.opciones?.[1]?.texto || '', c: p.opciones?.[2]?.texto || '', d: p.opciones?.[3]?.texto || '' }
        : { a: '', b: '', c: '', d: '' },
      respuestaCorrecta: p.tipo === 'opcion_multiple' ? (p.respuestaCorrecta || 'a') : 'a',
      vfRespuesta: p.tipo === 'verdadero_falso' ? (p.respuestaCorrecta || 'v') : 'v',
      ponderacion: p.ponderacion ?? 1,
      retroalimentacion: p.retroalimentacion || '',
      imagenFile: null,
    })
    setGlowId(null)
    // Bring the chosen reactivo to the top so the edit form is fully visible
    setTimeout(() => document.getElementById(`preg-item-${p.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60)
    preguntaEditSnap.current = JSON.stringify({
      tipo: p.tipo,
      enunciado: p.enunciado,
      opciones: p.tipo === 'opcion_multiple'
        ? { a: p.opciones?.[0]?.texto || '', b: p.opciones?.[1]?.texto || '', c: p.opciones?.[2]?.texto || '', d: p.opciones?.[3]?.texto || '' }
        : { a: '', b: '', c: '', d: '' },
      respuestaCorrecta: p.tipo === 'opcion_multiple' ? (p.respuestaCorrecta || 'a') : 'a',
      vfRespuesta: p.tipo === 'verdadero_falso' ? (p.respuestaCorrecta || 'v') : 'v',
      ponderacion: p.ponderacion ?? 1,
      retroalimentacion: p.retroalimentacion || '',
      imagenFile: null,
    })
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
      const data = { ...buildPreguntaData({ ...preguntaEditForm }), imagenUrl }
      await updateDoc(doc(db, 'activities', activityId, 'preguntas', id), data)
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
      const orden = preguntas.length === 0 ? 0 : Math.max(...preguntas.map((x) => x.orden ?? 0)) + 1
      const data = {
        tipo: p.tipo, enunciado: `${p.enunciado} (copia)`, opciones: p.opciones || null,
        respuestaCorrecta: p.respuestaCorrecta || null, ponderacion: p.ponderacion,
        retroalimentacion: p.retroalimentacion || null, imagenUrl: p.imagenUrl || null,
        orden, origenBancoId: null,
      }
      const ref = await addDoc(collection(db, 'activities', activityId, 'preguntas'), data)
      setPreguntas((prev) => [...prev, { id: ref.id, ...data }])
      setGlowId(ref.id)
      await syncNumPreguntas(preguntas.length + 1)
      toast('Pregunta duplicada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function handleMovePregunta(id, direction) {
    const idx = preguntas.findIndex((p) => p.id === id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= preguntas.length) return
    const a = preguntas[idx]
    const b = preguntas[swapIdx]
    const newOrdenA = b.orden ?? swapIdx
    const newOrdenB = a.orden ?? idx
    try {
      await Promise.all([
        updateDoc(doc(db, 'activities', activityId, 'preguntas', a.id), { orden: newOrdenA }),
        updateDoc(doc(db, 'activities', activityId, 'preguntas', b.id), { orden: newOrdenB }),
      ])
      setPreguntas((prev) => {
        const next = [...prev]
        next[idx] = { ...a, orden: newOrdenA }
        next[swapIdx] = { ...b, orden: newOrdenB }
        return next.sort((x, y) => (x.orden ?? 0) - (y.orden ?? 0))
      })
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
    setBancoEditForm({
      tipo: item.tipo, enunciado: item.enunciado,
      opciones: item.tipo === 'opcion_multiple'
        ? { a: item.opciones?.[0]?.texto || '', b: item.opciones?.[1]?.texto || '', c: item.opciones?.[2]?.texto || '', d: item.opciones?.[3]?.texto || '' }
        : { a: '', b: '', c: '', d: '' },
      respuestaCorrecta: item.tipo === 'opcion_multiple' ? (item.respuestaCorrecta || 'a') : 'a',
      vfRespuesta: item.tipo === 'verdadero_falso' ? (item.respuestaCorrecta || 'v') : 'v',
      tema: item.tema || '',
    })
    setGlowId(null)
    // Bring the chosen reactivo to the top so the edit form is fully visible
    setTimeout(() => document.getElementById(`banco-item-${item.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60)
    bancoEditSnap.current = JSON.stringify({
      tipo: item.tipo, enunciado: item.enunciado,
      opciones: item.tipo === 'opcion_multiple'
        ? { a: item.opciones?.[0]?.texto || '', b: item.opciones?.[1]?.texto || '', c: item.opciones?.[2]?.texto || '', d: item.opciones?.[3]?.texto || '' }
        : { a: '', b: '', c: '', d: '' },
      respuestaCorrecta: item.tipo === 'opcion_multiple' ? (item.respuestaCorrecta || 'a') : 'a',
      vfRespuesta: item.tipo === 'verdadero_falso' ? (item.respuestaCorrecta || 'v') : 'v',
      tema: item.tema || '',
    })
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
      const ref = await addDoc(collection(db, 'bancoReactivos'), {
        docenteId: auth.currentUser.uid, tipo: item.tipo, enunciado: `${item.enunciado} (copia)`,
        opciones: item.opciones || null, respuestaCorrecta: item.respuestaCorrecta || null,
        tema: item.tema || null, materia: item.materia || null, createdAt: serverTimestamp(),
      })
      setBanco((prev) => [...prev, { id: ref.id, docenteId: auth.currentUser.uid, tipo: item.tipo, enunciado: `${item.enunciado} (copia)`, opciones: item.opciones, respuestaCorrecta: item.respuestaCorrecta, tema: item.tema }])
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
  const hasManual = preguntas.some((p) => TIPOS_REVISION_MANUAL.includes(p.tipo))

  function estadoEstudiante(sub) {
    if (!sub) return 'No iniciado'
    if (sub.estadoEvaluacion === 'en_progreso') return 'En proceso'
    if (sub.pendienteRevision) return 'Por calificar'
    return hasManual ? 'Calificado' : 'Realizado'
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
      toast(pendiente
        ? 'Puntos guardados — aún hay reactivos por calificar'
        : `Puntos guardados — calificación final: ${calFinal}/${activity.maxCalif || 10}`)
    } catch (err) {
      toast('Error al guardar puntos: ' + err.message, 'error')
    } finally {
      setSavingGradeId(null)
    }
  }

  // "Modificar fecha de entrega para este estudiante" — per-student deadline
  // extension (activity.extensiones), same shape entregables use.
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
      {/* El fondo de la barra ocupa todo el ancho, pero su contenido queda
          acotado al mismo contenedor que el cuerpo de abajo (mismo ancho que
          EVALUAR) — si no, el título queda pegado a la izquierda mientras el
          cuerpo se ve centrado, dos alineaciones que no combinan. */}
      <div className="bg-surface-card border-b border-outline-variant px-4 py-2">
        <div className={TEACHER_CONTAINER_NARROW}>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Volver" onClick={() => navigate(`/subject/${activity.asignaturaId}`, backState ? { state: backState } : undefined)} className="p-2 -ml-2 text-slate-400 hover:text-muted rounded">
              <ArrowLeft size={22} />
            </button>
            <div className="flex-1 min-w-0">
              {contextLine && <p className="text-sm font-medium text-muted truncate">{contextLine}</p>}
              <p className="text-sm font-bold uppercase tracking-wide text-accent">Evaluación</p>
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
                  className="p-1 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0"
                >
                  <Pencil size={18} />
                </button>
              </div>
              <p className="text-sm font-medium text-muted">Parcial {activity.parcial} · {activity.categoria === 'examen' ? 'Examen' : 'Cuestionario'}</p>
            </div>
          </div>
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
            {loadingPreguntas ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : (
              <div className="space-y-2 mb-3">
                {preguntas.length === 0 && <p className="text-sm text-slate-400 text-center py-6">Aún no hay preguntas</p>}
                {preguntas.map((p, i) => (
                  <div key={p.id} id={`preg-item-${p.id}`} className="bg-surface-card rounded-card shadow-card p-3"
                    style={editingPreguntaId === p.id
                      ? { border: '2px solid var(--accent)', background: 'var(--accent-light)' }
                      : p.id === glowId
                        ? { border: '1px solid var(--accent)', background: 'var(--accent-light)' }
                        : undefined}>
                    {editingPreguntaId === p.id ? (
                      <form onSubmit={(e) => handleSavePreguntaEdit(e, p.id)} className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>Editando · Pregunta {i + 1}</p>
                        <div>
                          <label htmlFor={`preg-edit-tipo-${p.id}`} className="block text-sm font-medium text-muted mb-1">Tipo de pregunta</label>
                          <select id={`preg-edit-tipo-${p.id}`} value={preguntaEditForm.tipo} onChange={(e) => setPreguntaEditForm((f) => ({ ...f, tipo: e.target.value }))}
                            className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                            {TIPOS_PREGUNTA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </div>
                        <textarea value={preguntaEditForm.enunciado} onChange={(e) => setPreguntaEditForm((f) => ({ ...f, enunciado: e.target.value }))}
                          rows={2} required className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" />
                        {preguntaEditForm.tipo === 'opcion_multiple' && OPCION_IDS.map((id) => (
                          <div key={id} className="flex items-center gap-2">
                            <input type="radio" name={`edit-p-${p.id}`} checked={preguntaEditForm.respuestaCorrecta === id}
                              onChange={() => setPreguntaEditForm((f) => ({ ...f, respuestaCorrecta: id }))} className="accent-[var(--accent)] flex-shrink-0" />
                            <input type="text" value={preguntaEditForm.opciones[id]}
                              onChange={(e) => setPreguntaEditForm((f) => ({ ...f, opciones: { ...f.opciones, [id]: e.target.value } }))}
                              placeholder={`Opción ${id.toUpperCase()}`} required
                              className="flex-1 px-3 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                          </div>
                        ))}
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
                            <p className="text-sm font-medium text-on-surface">{i + 1}. {p.enunciado}</p>
                          </div>
                          <div className="flex gap-0.5 flex-shrink-0">
                            <button type="button" aria-label="Mover arriba" onClick={() => handleMovePregunta(p.id, 'up')} disabled={i === 0}
                              className="p-1 text-slate-400 hover:text-accent disabled:opacity-40 rounded"><ChevronUp size={15} /></button>
                            <button type="button" aria-label="Mover abajo" onClick={() => handleMovePregunta(p.id, 'down')} disabled={i === preguntas.length - 1}
                              className="p-1 text-slate-400 hover:text-accent disabled:opacity-40 rounded"><ChevronDown size={15} /></button>
                            <button type="button" aria-label="Editar pregunta" onClick={() => openEditPregunta(p)} className="p-1 text-slate-400 hover:text-accent rounded"><Pencil size={15} /></button>
                            <button type="button" aria-label="Duplicar pregunta" onClick={() => handleDuplicatePregunta(p)} className="p-1 text-slate-400 hover:text-accent rounded"><Copy size={15} /></button>
                            <button type="button" aria-label="Eliminar pregunta" onClick={() => handleDeletePregunta(p.id)} className="p-1 text-slate-400 hover:text-error rounded"><Trash2 size={15} /></button>
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
            )}

            {!showPreguntaForm ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => { setGlowId(null); setShowPreguntaForm(true) }} className="flex-1 flex items-center justify-center gap-1 py-2 bg-accent text-white text-sm font-medium rounded">
                  <Plus size={17} /> Agregar pregunta
                </button>
                <button type="button" onClick={() => setShowBanco(true)} className="flex items-center justify-center gap-1 px-3 py-2 border border-accent text-accent text-sm font-medium rounded">
                  <Library size={17} /> Mi banco
                </button>
              </div>
            ) : (
              <form onSubmit={handleAddPregunta} className="rounded-card shadow-card p-3 space-y-2"
                style={{ border: '2px solid var(--accent)', background: 'var(--accent-light)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>Creando · Pregunta {preguntas.length + 1}</p>
                <div>
                  <label htmlFor="preg-nueva-tipo" className="block text-sm font-medium text-muted mb-1">Tipo de pregunta</label>
                  <select id="preg-nueva-tipo" value={preguntaForm.tipo} onChange={(e) => setPreguntaForm((f) => ({ ...f, tipo: e.target.value }))}
                    className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                    {TIPOS_PREGUNTA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
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

                {preguntaForm.tipo === 'opcion_multiple' && OPCION_IDS.map((id) => (
                  <div key={id} className="flex items-center gap-2">
                    <input type="radio" name="respuestaCorrecta" checked={preguntaForm.respuestaCorrecta === id}
                      onChange={() => setPreguntaForm((f) => ({ ...f, respuestaCorrecta: id }))} className="accent-[var(--accent)] flex-shrink-0" />
                    <input type="text" value={preguntaForm.opciones[id]}
                      onChange={(e) => setPreguntaForm((f) => ({ ...f, opciones: { ...f.opciones, [id]: e.target.value } }))}
                      placeholder={`Opción ${id.toUpperCase()}`} required
                      className="flex-1 px-3 py-1.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" />
                  </div>
                ))}
                {preguntaForm.tipo === 'opcion_multiple' && <p className="text-xs text-slate-400">Selecciona el radio de la opción correcta.</p>}

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
                  <button type="button" onClick={() => { setShowPreguntaForm(false); setPreguntaForm(EMPTY_PREGUNTA) }}
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
                <div className="relative bg-surface-card w-full max-w-lg rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[85vh] overflow-y-auto">
                  <h3 className="text-base font-semibold mb-2">Mi banco de reactivos</h3>
                  <div className="flex gap-2 mb-3">
                    <div className="flex-1">
                      <SearchInput value={bancoSearch} onChange={setBancoSearch} placeholder="Buscar…" />
                    </div>
                    {materias.length > 0 && (
                      <select value={bancoMateriaFilter} onChange={(e) => setBancoMateriaFilter(e.target.value)}
                        className="px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface">
                        <option value="">Todas las materias</option>
                        {materias.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    )}
                    {temas.length > 0 && (
                      <select value={bancoTemaFilter} onChange={(e) => setBancoTemaFilter(e.target.value)}
                        className="px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface">
                        <option value="">Todos los temas</option>
                        {temas.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    )}
                  </div>
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
                              <select value={bancoEditForm.tipo} onChange={(e) => setBancoEditForm((f) => ({ ...f, tipo: e.target.value }))}
                                className="w-full px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface">
                                {TIPOS_PREGUNTA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                              </select>
                              <textarea value={bancoEditForm.enunciado} onChange={(e) => setBancoEditForm((f) => ({ ...f, enunciado: e.target.value }))}
                                rows={2} className="w-full px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                              {bancoEditForm.tipo === 'opcion_multiple' && (
                                <p className="text-xs text-muted">Marca el círculo de la respuesta correcta:</p>
                              )}
                              {bancoEditForm.tipo === 'opcion_multiple' && OPCION_IDS.map((id) => (
                                <div key={id} className="flex items-center gap-2">
                                  <input type="radio" name={`edit-correcta-${item.id}`} checked={bancoEditForm.respuestaCorrecta === id}
                                    onChange={() => setBancoEditForm((f) => ({ ...f, respuestaCorrecta: id }))} className="accent-[var(--accent)]" />
                                  <input type="text" value={bancoEditForm.opciones[id]}
                                    onChange={(e) => setBancoEditForm((f) => ({ ...f, opciones: { ...f.opciones, [id]: e.target.value } }))}
                                    placeholder={`Opción ${id.toUpperCase()}`}
                                    className="flex-1 px-2 py-1 rounded border border-outline-variant text-sm bg-surface" />
                                  {bancoEditForm.respuestaCorrecta === id && (
                                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded flex-shrink-0">Correcta</span>
                                  )}
                                </div>
                              ))}
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
                                <button type="button" aria-label="Editar" onClick={() => openEditBanco(item)} className="p-1 text-slate-400 hover:text-accent rounded"><Pencil size={14} /></button>
                                <button type="button" aria-label="Duplicar" onClick={() => handleDuplicateBancoItem(item)} className="p-1 text-slate-400 hover:text-accent rounded"><Copy size={14} /></button>
                                <button type="button" aria-label="Eliminar" onClick={() => handleDeleteBancoItem(item.id)} className="p-1 text-slate-400 hover:text-error rounded"><Trash2 size={14} /></button>
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
            <div>
              <label htmlFor="config-orden" className="block text-sm font-medium text-muted mb-1">Orden de las preguntas</label>
              <select id="config-orden" value={configForm.ordenPreguntas} onChange={(e) => setConfigForm((f) => ({ ...f, ordenPreguntas: e.target.value }))}
                className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                <option value="creacion">Orden de creación</option>
                <option value="aleatorio">Aleatorio</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={!!configForm.barajarRespuestas}
                onChange={(e) => setConfigForm((f) => ({ ...f, barajarRespuestas: e.target.checked }))} className="accent-[var(--accent)]" />
              Barajar el orden de las opciones dentro de cada pregunta
            </label>
            <div>
              <label htmlFor="config-navegacion" className="block text-sm font-medium text-muted mb-1">Navegación</label>
              <select id="config-navegacion" value={configForm.navegacion} onChange={(e) => setConfigForm((f) => ({ ...f, navegacion: e.target.value }))}
                className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                <option value="libre">Libre — puede regresar</option>
                <option value="secuencial">Secuencial — no puede regresar</option>
              </select>
            </div>
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
              <div>
                <label htmlFor="config-conservar" className="block text-sm font-medium text-muted mb-1">Si hay varios intentos, conservar</label>
                <select id="config-conservar" value={configForm.conservar} onChange={(e) => setConfigForm((f) => ({ ...f, conservar: e.target.value }))}
                  className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                  <option value="primero">El primer intento</option>
                  <option value="ultimo">El último intento</option>
                  <option value="mejor">La calificación más alta</option>
                  <option value="promedio">El promedio de todos los intentos</option>
                </select>
              </div>
            )}
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
            {/* Dates + instrucciones — the teacher needs the context of what is
                being graded, same treatment as a regular activity */}
            {(activity.publishedAt || activity.publishAt || activity.fechaLimite) && (
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {activity.publishedAt && (
                  <span data-tooltip="Publicado" className="text-xs text-emerald-600 flex items-center gap-0.5">
                    <Clock size={14} /> {formatPublishAt(activity.publishedAt)}
                  </span>
                )}
                {activity.publishAt && (
                  <span data-tooltip="Publicación programada" className="text-xs text-accent flex items-center gap-0.5">
                    <Clock size={14} /> {formatPublishAt(activity.publishAt)}
                  </span>
                )}
                {activity.fechaLimite && (
                  <span data-tooltip="Cierre" className="text-xs text-amber-600 flex items-center gap-0.5">
                    <Clock size={14} /> {formatDeadline(activity.fechaLimite)}
                  </span>
                )}
              </div>
            )}
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
                <div className="mb-3 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-card flex items-center gap-2 text-sm text-amber-800">
                  <span className="flex-1">
                    <strong>{resultCounts.porCalificar}</strong> entrega{resultCounts.porCalificar !== 1 ? 's' : ''} con reactivos de respuesta escrita o documentos que debes calificar.
                  </span>
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
              </div>
              {/* Lista por estudiante — cada fila abre la revisión de pantalla
                  completa (openReview), donde se ve la entrega y, si hay
                  reactivos de respuesta breve o de archivo, se pueden calificar. */}
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
                  {contextLine && <p className="text-sm font-medium text-muted truncate">{contextLine}</p>}
                  <p className="text-sm font-bold uppercase tracking-wide text-accent">Evaluación</p>
                  <h1 className="text-xl font-bold text-on-surface truncate">
                    {activityLabel && <span className="text-accent">{activityLabel} </span>}{activity.nombre}
                  </h1>
                  <p className="text-sm font-medium text-muted">Parcial {activity.parcial} · {activity.categoria === 'examen' ? 'Examen' : 'Cuestionario'}</p>
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Body: answer sheet (main) + actions sidebar (right).
              min-h-0 en main es necesario para que flex-1 respete el alto
              disponible del padre en vez de crecer con el contenido — sin
              esto el alto de esta zona variaba según el estudiante/aside. */}
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            <main className="flex-1 min-h-0 overflow-y-auto p-4">
              <div className="max-w-3xl mx-auto">
                {done ? (
                  <EvaluacionAnswerList
                    preguntas={preguntas}
                    respuestas={reviewing.allRespuestas}
                    mostrarCorrectas
                    mostrarRetro
                    renderGrading={(p, respuesta) => {
                      const draft = gradeDrafts[p.id] || { puntos: '', comentario: '' }
                      const savedPuntos = respuesta.puntosObtenidos ?? ''
                      const savedComent = respuesta.comentarioDocente || ''
                      const dirty = String(draft.puntos) !== String(savedPuntos) || (draft.comentario || '') !== savedComent
                      const saving = savingGradeId === p.id
                      return (
                        <div className="mt-1 p-3 rounded border border-accent/40 bg-[var(--accent-tint)] space-y-2">
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
            </main>

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
                        <button type="button" onClick={saveReviewExtension} disabled={!extendDate || savingExtension}
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
              <button type="button" onClick={saveReviewExtension} disabled={!extendDate || savingExtension}
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

      {showGraficas && (
        <EvaluacionGraficas
          activity={activity}
          activityLabel={activityLabel}
          subject={subject}
          preguntas={preguntas}
          submissions={submissions}
          onClose={() => setShowGraficas(false)}
        />
      )}
    </div>
  )
}
