import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { db, auth } from '../firebase'
import { useToast } from './Toast'
import Spinner from './Spinner'
import { subjectDisplayName } from '../utils/subjectName'
import { uploadToCloudinary } from '../utils/cloudinary'
import EFDateTimePicker from './EFDateTimePicker'
import {
  calcularEstadisticasGrupo, calcularCalificacion, resolverPendienteRevision, resolverCalificacionFinal,
} from '../utils/evaluacionGrading'
import { ArrowLeft, Plus, Trash2, Library, Star, Users, Search, Pencil, Copy, X, Image as ImageIcon, ChevronUp, ChevronDown } from 'lucide-react'

const TIPOS_PREGUNTA = [
  { value: 'opcion_multiple', label: 'Opción múltiple' },
  { value: 'verdadero_falso', label: 'Verdadero / Falso' },
  { value: 'respuesta_corta', label: 'Respuesta corta' },
]
const OPCION_IDS = ['a', 'b', 'c', 'd']
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
export default function EvaluacionManager({ activity, subject, activityId, activityLabel, contextLine, students, submissions, onActivityChange, resultadosOnly = false }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState(resultadosOnly ? 'resultados' : 'preguntas')
  const [preguntas, setPreguntas] = useState([])
  const [loadingPreguntas, setLoadingPreguntas] = useState(true)
  const [showPreguntaForm, setShowPreguntaForm] = useState(false)
  const [preguntaForm, setPreguntaForm] = useState(EMPTY_PREGUNTA)
  const [saving, setSaving] = useState(false)
  const [banco, setBanco] = useState([])
  const [bancoLoaded, setBancoLoaded] = useState(false)
  const [showBanco, setShowBanco] = useState(false)
  const [editingPreguntaId, setEditingPreguntaId] = useState(null)
  const [preguntaEditForm, setPreguntaEditForm] = useState(null)
  const [bancoSearch, setBancoSearch] = useState('')
  const [bancoTemaFilter, setBancoTemaFilter] = useState('')
  const [bancoMateriaFilter, setBancoMateriaFilter] = useState('')
  const [editingBancoId, setEditingBancoId] = useState(null)
  const [bancoEditForm, setBancoEditForm] = useState(null)
  const [configForm, setConfigForm] = useState(activity.evaluacion)
  const [savingConfig, setSavingConfig] = useState(false)
  const [reviewing, setReviewing] = useState(null) // { student, submission, items: [{pregunta, respuesta}] }
  const [reviewForm, setReviewForm] = useState({}) // preguntaId -> { puntos, comentario }
  const [savingReview, setSavingReview] = useState(false)

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
  useEffect(() => { setConfigForm(activity.evaluacion) }, [activity.evaluacion])

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
    setSavingConfig(true)
    try {
      await updateDoc(doc(db, 'activities', activityId), { evaluacion: configForm })
      onActivityChange((prev) => ({ ...prev, evaluacion: configForm }))
      toast('Configuración guardada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingConfig(false)
    }
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

  // ── Revisión manual de respuesta_corta ──
  function estadoEstudiante(sub) {
    if (!sub) return 'No iniciado'
    if (sub.estadoEvaluacion === 'en_progreso') return 'En proceso'
    if (sub.pendienteRevision) return 'Finalizado'
    return 'Calificado'
  }

  async function handleOpenRevision(student, sub) {
    try {
      const respSnap = await getDocs(collection(db, 'submissions', sub.id, 'respuestas'))
      const respMap = {}
      respSnap.docs.forEach((d) => { respMap[d.id] = d.data() })
      const items = preguntas
        .filter((p) => p.tipo === 'respuesta_corta')
        .map((p) => ({ pregunta: p, respuesta: respMap[p.id] || {} }))
      const initialForm = {}
      items.forEach(({ pregunta, respuesta }) => {
        initialForm[pregunta.id] = {
          puntos: respuesta.puntosObtenidos != null ? String(respuesta.puntosObtenidos) : '',
          comentario: respuesta.comentarioDocente || '',
        }
      })
      setReviewForm(initialForm)
      setReviewing({ student, submission: sub, items, allRespuestas: respMap })
    } catch (err) {
      toast('Error al cargar respuestas: ' + err.message, 'error')
    }
  }

  async function handleSaveRevision() {
    if (!reviewing) return
    setSavingReview(true)
    try {
      const { submission, items, allRespuestas } = reviewing
      const updatedRespuestas = { ...allRespuestas }
      for (const { pregunta } of items) {
        const entry = reviewForm[pregunta.id]
        const puntos = entry?.puntos === '' ? null : Math.max(0, Math.min(pregunta.ponderacion, parseFloat(entry.puntos) || 0))
        await updateDoc(doc(db, 'submissions', submission.id, 'respuestas', pregunta.id), {
          puntosObtenidos: puntos,
          comentarioDocente: entry?.comentario?.trim() || null,
        })
        updatedRespuestas[pregunta.id] = { ...updatedRespuestas[pregunta.id], puntosObtenidos: puntos, comentarioDocente: entry?.comentario?.trim() || null }
      }
      const pendiente = resolverPendienteRevision(preguntas, updatedRespuestas)
      const calificacionIntento = calcularCalificacion(preguntas, updatedRespuestas, activity.maxCalif || 10)
      // Recompute the final score across all attempts, replacing this attempt's entry with the corrected score.
      const intentosPrevios = (submission.intentos || []).filter((i) => i.numero !== submission.intentoActual)
      const calificacionFinal = resolverCalificacionFinal(intentosPrevios, calificacionIntento, activity.evaluacion?.conservar)
      const intentosActualizados = [
        ...intentosPrevios,
        { numero: submission.intentoActual || (intentosPrevios.length + 1), calificacion: calificacionIntento },
      ]
      await updateDoc(doc(db, 'submissions', submission.id), {
        calificacion: calificacionFinal,
        pendienteRevision: pendiente,
        estado: pendiente ? 'entregado' : 'calificado',
        intentos: intentosActualizados,
      })
      toast('Revisión guardada')
      setReviewing(null)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingReview(false)
    }
  }

  const calificaciones = Object.values(submissions)
    .filter((s) => s.estadoEvaluacion === 'finalizado' && s.calificacion != null)
    .map((s) => s.calificacion)
  const stats = calcularEstadisticasGrupo(calificaciones, activity.maxCalif || 10)

  return (
    <div>
      <div className="bg-surface-card border-b border-outline-variant px-4 py-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate(`/subject/${activity.asignaturaId}`)} className="p-2 -ml-2 text-slate-400 hover:text-muted rounded">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            {contextLine && <p className="text-xl font-bold text-on-surface truncate mb-0.5">{contextLine}</p>}
            <h1 className="text-xl font-bold text-on-surface flex items-baseline gap-2 truncate">
              {activityLabel && <span className="text-2xl font-extrabold text-accent">{activityLabel}</span>}
              <span className="truncate">{activity.nombre}</span>
            </h1>
            <p className="text-slate-400 text-xs">Parcial {activity.parcial} · {activity.categoria === 'examen' ? 'Examen' : 'Cuestionario'}</p>
          </div>
        </div>
        {!resultadosOnly && (
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

      <div className="p-4 max-w-2xl mx-auto">
        {tab === 'preguntas' && (
          <div>
            {loadingPreguntas ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : (
              <div className="space-y-2 mb-3">
                {preguntas.length === 0 && <p className="text-sm text-slate-400 text-center py-6">Aún no hay preguntas</p>}
                {preguntas.map((p, i) => (
                  <div key={p.id} className="bg-surface-card rounded-card shadow-card p-3">
                    {editingPreguntaId === p.id ? (
                      <form onSubmit={(e) => handleSavePreguntaEdit(e, p.id)} className="space-y-2">
                        <div>
                          <label className="block text-sm font-medium text-muted mb-1">Tipo de pregunta</label>
                          <select value={preguntaEditForm.tipo} onChange={(e) => setPreguntaEditForm((f) => ({ ...f, tipo: e.target.value }))}
                            className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                            {TIPOS_PREGUNTA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </div>
                        <textarea value={preguntaEditForm.enunciado} onChange={(e) => setPreguntaEditForm((f) => ({ ...f, enunciado: e.target.value }))}
                          rows={2} required className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
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
                          <label className="block text-sm font-medium text-muted mb-1">Retroalimentación opcional</label>
                          <textarea value={preguntaEditForm.retroalimentacion} onChange={(e) => setPreguntaEditForm((f) => ({ ...f, retroalimentacion: e.target.value }))}
                            rows={2} className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-muted mb-1">Ponderación</label>
                          <input type="number" min="0.1" step="0.1" value={preguntaEditForm.ponderacion}
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
                          <button type="button" onClick={() => setEditingPreguntaId(null)} className="flex-1 py-2 text-sm text-muted">Cancelar</button>
                          <button type="submit" disabled={saving} className="flex-1 py-2 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">
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
                            <button type="button" onClick={() => handleMovePregunta(p.id, 'up')} disabled={i === 0}
                              className="p-1 text-slate-400 hover:text-accent disabled:opacity-20 rounded"><ChevronUp size={15} /></button>
                            <button type="button" onClick={() => handleMovePregunta(p.id, 'down')} disabled={i === preguntas.length - 1}
                              className="p-1 text-slate-400 hover:text-accent disabled:opacity-20 rounded"><ChevronDown size={15} /></button>
                            <button type="button" onClick={() => openEditPregunta(p)} className="p-1 text-slate-400 hover:text-accent rounded"><Pencil size={15} /></button>
                            <button type="button" onClick={() => handleDuplicatePregunta(p)} className="p-1 text-slate-400 hover:text-accent rounded"><Copy size={15} /></button>
                            <button type="button" onClick={() => handleDeletePregunta(p.id)} className="p-1 text-slate-400 hover:text-error rounded"><Trash2 size={15} /></button>
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
                        <p className="text-xs text-slate-400 mt-1">Ponderación: {p.ponderacion}{p.retroalimentacion ? ' · con retroalimentación' : ''}</p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!showPreguntaForm ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowPreguntaForm(true)} className="flex-1 flex items-center justify-center gap-1 py-2 bg-accent text-white text-sm font-medium rounded">
                  <Plus size={17} /> Agregar pregunta
                </button>
                <button type="button" onClick={() => setShowBanco(true)} className="flex items-center justify-center gap-1 px-3 py-2 border border-accent text-accent text-sm font-medium rounded">
                  <Library size={17} /> Mi banco
                </button>
              </div>
            ) : (
              <form onSubmit={handleAddPregunta} className="bg-surface-card rounded-card shadow-card p-3 space-y-2">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">Tipo de pregunta</label>
                  <select value={preguntaForm.tipo} onChange={(e) => setPreguntaForm((f) => ({ ...f, tipo: e.target.value }))}
                    className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                    {TIPOS_PREGUNTA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">Enunciado</label>
                  <textarea value={preguntaForm.enunciado} onChange={(e) => setPreguntaForm((f) => ({ ...f, enunciado: e.target.value }))}
                    rows={2} required autoFocus
                    className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
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
                      className="flex-1 px-3 py-1.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
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

                <div>
                  <label className="block text-sm font-medium text-muted mb-1">Retroalimentación opcional</label>
                  <textarea value={preguntaForm.retroalimentacion} onChange={(e) => setPreguntaForm((f) => ({ ...f, retroalimentacion: e.target.value }))}
                    rows={2} placeholder="Se muestra al alumno después de finalizar, si la configuración lo permite"
                    className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">Ponderación</label>
                  <input type="number" min="0.1" step="0.1" value={preguntaForm.ponderacion}
                    onChange={(e) => setPreguntaForm((f) => ({ ...f, ponderacion: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
                </div>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={preguntaForm.guardarEnBanco}
                    onChange={(e) => setPreguntaForm((f) => ({ ...f, guardarEnBanco: e.target.checked }))} className="accent-[var(--accent)]" />
                  Guardar también en mi banco de reactivos
                </label>
                {preguntaForm.guardarEnBanco && (
                  <input type="text" value={preguntaForm.tema} onChange={(e) => setPreguntaForm((f) => ({ ...f, tema: e.target.value }))}
                    placeholder="Tema (opcional, ej. Fracciones)"
                    className="w-full px-3 py-1.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
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
                <div className="absolute inset-0 bg-black/40" onClick={() => { setShowBanco(false); setEditingBancoId(null) }} />
                <div className="relative bg-surface-card w-full max-w-lg rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[85vh] overflow-y-auto">
                  <h3 className="text-base font-semibold mb-2">Mi banco de reactivos</h3>
                  <div className="flex gap-2 mb-3">
                    <div className="flex-1 relative">
                      <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="text" value={bancoSearch} onChange={(e) => setBancoSearch(e.target.value)}
                        placeholder="Buscar…" className="w-full pl-8 pr-3 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
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
                        <div key={item.id} className="rounded border p-2"
                          style={editingBancoId === item.id
                            ? { borderColor: 'var(--accent)', background: 'var(--accent-light)', borderWidth: 2 }
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
                                <button type="button" onClick={() => setEditingBancoId(null)} className="flex-1 py-1.5 text-sm text-muted">Cancelar</button>
                                <button type="button" onClick={() => handleSaveBancoEdit(item.id)} disabled={saving}
                                  className="flex-1 py-1.5 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">Guardar</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2">
                              <button type="button" onClick={() => handleAddFromBanco(item)} disabled={saving}
                                className="flex-1 text-left text-sm hover:text-accent transition-colors disabled:opacity-50">
                                {item.enunciado}
                                {(item.materia || item.tema) && (
                                  <span className="block text-xs text-slate-400 mt-0.5">
                                    {item.materia && <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded mr-1.5">{item.materia}</span>}
                                    {item.tema}
                                  </span>
                                )}
                              </button>
                              <div className="flex gap-1 flex-shrink-0">
                                <button type="button" onClick={() => openEditBanco(item)} className="p-1 text-slate-400 hover:text-accent rounded"><Pencil size={14} /></button>
                                <button type="button" onClick={() => handleDuplicateBancoItem(item)} className="p-1 text-slate-400 hover:text-accent rounded"><Copy size={14} /></button>
                                <button type="button" onClick={() => handleDeleteBancoItem(item.id)} className="p-1 text-slate-400 hover:text-error rounded"><Trash2 size={14} /></button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <button type="button" onClick={() => { setShowBanco(false); setEditingBancoId(null) }} className="w-full mt-3 py-2 text-sm text-muted">Cerrar</button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'config' && configForm && (
          <form onSubmit={handleSaveConfig} className="bg-surface-card rounded-card shadow-card p-3 space-y-3">
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Orden de las preguntas</label>
              <select value={configForm.ordenPreguntas} onChange={(e) => setConfigForm((f) => ({ ...f, ordenPreguntas: e.target.value }))}
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
              <label className="block text-sm font-medium text-muted mb-1">Navegación</label>
              <select value={configForm.navegacion} onChange={(e) => setConfigForm((f) => ({ ...f, navegacion: e.target.value }))}
                className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                <option value="libre">Libre — puede regresar</option>
                <option value="secuencial">Secuencial — no puede regresar</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Tiempo límite (minutos)</label>
              <input type="number" min="1" value={configForm.tiempoLimiteMin ?? ''}
                onChange={(e) => setConfigForm((f) => ({ ...f, tiempoLimiteMin: e.target.value ? parseInt(e.target.value, 10) : null }))}
                placeholder="Sin límite" className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Intentos permitidos</label>
              <input type="number" min="1" value={configForm.intentosPermitidos ?? ''}
                onChange={(e) => setConfigForm((f) => ({ ...f, intentosPermitidos: e.target.value ? parseInt(e.target.value, 10) : null }))}
                placeholder="Ilimitados" className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Si hay varios intentos, conservar</label>
              <select value={configForm.conservar} onChange={(e) => setConfigForm((f) => ({ ...f, conservar: e.target.value }))}
                className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                <option value="primero">El primer intento</option>
                <option value="ultimo">El último intento</option>
                <option value="mejor">La calificación más alta</option>
                <option value="promedio">El promedio de todos los intentos</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Publicar resultados</label>
              <select value={configForm.publicarResultados} onChange={(e) => setConfigForm((f) => ({ ...f, publicarResultados: e.target.value }))}
                className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                <option value="inmediato">Inmediatamente al terminar</option>
                <option value="fecha">En una fecha específica</option>
                <option value="manual">Manualmente (yo decido cuándo)</option>
              </select>
            </div>
            {configForm.publicarResultados === 'fecha' && (
              <EFDateTimePicker
                mode="datetime"
                headerLabel="Fecha y hora de publicación de resultados"
                value={configForm.publicarResultadosFecha || ''}
                onChange={v => setConfigForm(f => ({ ...f, publicarResultadosFecha: v }))}
                placeholder="Elegir fecha de publicación…"
                clearable={false}
              />
            )}
            <div className="pt-1 border-t border-outline-variant">
              <p className="text-xs font-medium text-muted uppercase tracking-wide pt-2 mb-2">Qué ve el alumno en sus resultados</p>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={!!configForm.mostrarRespuestasCorrectas}
                  onChange={(e) => setConfigForm((f) => ({ ...f, mostrarRespuestasCorrectas: e.target.checked }))} className="accent-[var(--accent)]" />
                Mostrar cuál era la respuesta correcta
              </label>
            </div>
            <button type="submit" disabled={savingConfig} className="w-full py-2 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">
              {savingConfig ? 'Guardando…' : 'Guardar configuración'}
            </button>
          </form>
        )}

        {tab === 'resultados' && (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {[
                { label: 'Promedio', value: stats.promedio },
                { label: 'Máxima', value: stats.maxima },
                { label: 'Mínima', value: stats.minima },
                { label: '% Aprobados', value: `${stats.porcentajeAprobados}%` },
              ].map((s) => (
                <div key={s.label} className="bg-accent-light rounded p-3 text-center">
                  <Star size={18} className="text-accent mx-auto mb-1" />
                  <p className="text-xl font-bold text-on-surface">{s.value}</p>
                  <p className="text-xs text-muted">{s.label}</p>
                </div>
              ))}
            </div>
            {configForm?.publicarResultados === 'manual' && !configForm.resultadosPublicados && (
              <button type="button" onClick={handlePublicarResultados} className="w-full mb-3 py-2 bg-accent text-white text-sm font-medium rounded">
                Publicar resultados a tus estudiantes
              </button>
            )}
            <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
              {students.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-8 flex items-center justify-center gap-2"><Users size={16} /> Sin estudiantes</p>
              ) : (
                students.map((s, i) => {
                  const sub = submissions[s.id]
                  const estado = estadoEstudiante(sub)
                  return (
                    <div key={s.id} className={`px-3 py-2 ${i > 0 ? 'border-t border-outline-variant' : ''}`}>
                      <div className="flex items-center gap-2">
                        <p className="flex-1 text-sm text-on-surface truncate">{s.apellidoPaterno} {s.apellidoMaterno} {s.nombre}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                          estado === 'Calificado' ? 'bg-emerald-100 text-emerald-700' :
                          estado === 'Finalizado' ? 'bg-amber-100 text-amber-700' :
                          estado === 'En proceso' ? 'bg-blue-100 text-blue-700' : 'bg-surface-container text-muted'
                        }`}>{estado}</span>
                        {sub?.estadoEvaluacion === 'finalizado' && (
                          <span className="text-xs font-semibold text-on-surface flex-shrink-0">{sub.calificacion}/{activity.maxCalif || 10}</span>
                        )}
                      </div>
                      {sub && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          {fmtHora(sub.tiempoInicio)} → {fmtHora(sub.fechaEntrega)} · {fmtDuracion(sub.tiempoInicio, sub.fechaEntrega)} · intento {sub.intentoActual || 1}
                        </p>
                      )}
                      {estado === 'Finalizado' && (
                        <button type="button" onClick={() => handleOpenRevision(s, sub)} className="mt-1 text-xs font-medium text-accent hover:underline">
                          Revisar respuestas abiertas
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      {reviewing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setReviewing(null)} />
          <div className="relative bg-surface-card w-full max-w-lg rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold">
                Revisar — {reviewing.student.apellidoPaterno} {reviewing.student.nombre}
              </h3>
              <button type="button" onClick={() => setReviewing(null)} className="p-1 text-slate-400 rounded"><X size={18} /></button>
            </div>
            {reviewing.items.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">Esta evaluación no tiene preguntas de respuesta corta.</p>
            ) : (
              <div className="space-y-3">
                {reviewing.items.map(({ pregunta, respuesta }) => (
                  <div key={pregunta.id} className="rounded border border-outline-variant p-3">
                    <p className="text-sm font-medium text-on-surface mb-1">{pregunta.enunciado}</p>
                    <p className="text-sm text-muted bg-surface rounded p-2 mb-2 whitespace-pre-wrap">{respuesta.textoRespuesta || '(sin respuesta)'}</p>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs text-muted flex-shrink-0">Puntos (máx {pregunta.ponderacion})</label>
                      <input type="number" min="0" max={pregunta.ponderacion} step="0.1"
                        value={reviewForm[pregunta.id]?.puntos ?? ''}
                        onChange={(e) => setReviewForm((f) => ({ ...f, [pregunta.id]: { ...f[pregunta.id], puntos: e.target.value } }))}
                        className="w-20 px-2 py-1 rounded border border-outline-variant text-sm bg-surface" />
                    </div>
                    <textarea value={reviewForm[pregunta.id]?.comentario ?? ''}
                      onChange={(e) => setReviewForm((f) => ({ ...f, [pregunta.id]: { ...f[pregunta.id], comentario: e.target.value } }))}
                      placeholder="Comentario opcional" rows={2}
                      className="w-full px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                  </div>
                ))}
                <button type="button" onClick={handleSaveRevision} disabled={savingReview}
                  className="w-full py-2 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">
                  {savingReview ? 'Guardando…' : 'Guardar revisión'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
