import { useState, useEffect } from 'react'
import {
  collection, query, where, doc, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp, getDoc,
} from 'firebase/firestore'
import { db, auth } from '../firebase'
import { useToast } from './Toast'
import Spinner from './Spinner'
import VisibilitySelect from './VisibilitySelect'
import RichTextEditor from './RichTextEditor'
import { uploadToCloudinary } from '../utils/cloudinary'
import { sanitizeHtml, toRichHtml, htmlToPlainText } from '../utils/sanitizeHtml'
import {
  ArrowLeft, Plus, Trash2, Library, Pencil, Copy,
  Search, Image as ImageIcon, X, ChevronDown as CollapseIcon,
} from 'lucide-react'

const TIPOS_PREGUNTA = [
  { value: 'opcion_multiple', label: 'Opción múltiple' },
  { value: 'verdadero_falso', label: 'Verdadero / Falso' },
  { value: 'respuesta_corta', label: 'Respuesta corta' },
]
const OPCION_IDS = ['a', 'b', 'c', 'd']
const EMPTY_PREGUNTA = {
  tipo: 'opcion_multiple', enunciado: '', opciones: { a: '', b: '', c: '', d: '' },
  respuestaCorrecta: 'a', vfRespuesta: 'v', ponderacion: 1, retroalimentacion: '',
  imagenFile: null, guardarEnBanco: false, tema: '',
}
const EVALUACION_DEFAULTS = {
  cuestionario: {
    numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'libre',
    tiempoLimiteMin: null, intentosPermitidos: null, conservar: 'mejor',
    publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
    mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
  },
  examen: {
    numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'secuencial',
    tiempoLimiteMin: 30, intentosPermitidos: 1, conservar: 'ultimo',
    publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
    mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
  },
}

// Full-screen evaluación editor (Cuestionario / Examen). Handles both creating
// a new evaluación and editing an existing one — basic info and questions in a
// single scrollable screen so the teacher never loses context.
export default function EvaluacionEditor({
  activityId,      // null = creating new; string = editing existing
  parcial,
  categoria,       // 'cuestionario' | 'examen'
  activityLabel,   // e.g. "1.3" — shown in the header
  contextLine,     // e.g. "Cultura digital I - 1A — Profe Kike Méndez"
  subjectId,
  docenteId,
  subject,
  existingActivities,
  onClose,
  onActivityCreated,
  onActivityUpdated,
}) {
  const toast = useToast()

  // ── Basic info state ──────────────────────────────────────────────
  const [infoForm, setInfoForm] = useState({
    nombre: '', instrucciones: '', fechaLimite: '', oculta: false, publishAt: '', visibilidadMode: 'show',
  })
  const [infoCollapsed, setInfoCollapsed] = useState(false)
  const [savingInfo, setSavingInfo] = useState(false)
  const [currentActivityId, setCurrentActivityId] = useState(activityId)
  const [attachExisting, setAttachExisting] = useState([])
  const [attachNew, setAttachNew] = useState([])

  // ── Configuración state ───────────────────────────────────────────
  const [configForm, setConfigForm] = useState(EVALUACION_DEFAULTS[categoria] || EVALUACION_DEFAULTS.cuestionario)
  const [savingConfig, setSavingConfig] = useState(false)

  // ── Preguntas state ───────────────────────────────────────────────
  const [preguntas, setPreguntas] = useState([])
  const [loadingPreguntas, setLoadingPreguntas] = useState(false)
  const [showPreguntaForm, setShowPreguntaForm] = useState(false)
  const [preguntaForm, setPreguntaForm] = useState(EMPTY_PREGUNTA)
  const [editingPreguntaId, setEditingPreguntaId] = useState(null)
  const [preguntaEditForm, setPreguntaEditForm] = useState(null)
  const [savingPregunta, setSavingPregunta] = useState(false)
  const [banco, setBanco] = useState([])
  const [bancoLoaded, setBancoLoaded] = useState(false)
  const [showBanco, setShowBanco] = useState(false)
  const [bancoSearch, setBancoSearch] = useState('')
  const [bancoTemaFilter, setBancoTemaFilter] = useState('')
  const [editingBancoId, setEditingBancoId] = useState(null)
  const [bancoEditForm, setBancoEditForm] = useState(null)

  const isNew = !currentActivityId

  useEffect(() => {
    if (activityId) loadExisting()
  }, [activityId])

  async function loadExisting() {
    try {
      const snap = await getDoc(doc(db, 'activities', activityId))
      if (snap.exists()) {
        const d = snap.data()
        setInfoForm({
          nombre: d.nombre || '',
          instrucciones: toRichHtml(d.instrucciones || ''),
          fechaLimite: d.fechaLimite
            ? (d.fechaLimite.includes('T') ? d.fechaLimite : `${d.fechaLimite}T00:00`)
            : '',
          oculta: d.oculta || false,
          publishAt: d.publishAt || '',
          visibilidadMode: !d.oculta ? 'show' : d.publishAt ? 'schedule' : 'hide',
        })
        setAttachExisting(d.archivosAdjuntos || [])
        setInfoCollapsed(false)
        if (d.evaluacion) setConfigForm({ ...EVALUACION_DEFAULTS[categoria], ...d.evaluacion })
      }
      loadPreguntas(activityId)
    } catch (err) {
      toast('Error al cargar: ' + err.message, 'error')
    }
  }

  async function loadPreguntas(aId) {
    setLoadingPreguntas(true)
    try {
      const snap = await getDocs(collection(db, 'activities', aId, 'preguntas'))
      setPreguntas(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)))
    } catch (err) {
      toast('Error al cargar preguntas: ' + err.message, 'error')
    } finally {
      setLoadingPreguntas(false)
    }
  }

  async function loadBanco() {
    if (bancoLoaded) return
    try {
      const snap = await getDocs(query(collection(db, 'bancoReactivos'), where('docenteId', '==', auth.currentUser.uid)))
      setBanco(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setBancoLoaded(true)
    } catch (err) { toast('Error al cargar banco: ' + err.message, 'error') }
  }

  // ── Save basic info (create or update) ───────────────────────────
  async function handleSaveInfo(e) {
    e.preventDefault()
    if (!htmlToPlainText(infoForm.instrucciones) && !infoForm.nombre.trim()) {
      toast('Escribe al menos el nombre de la evaluación', 'error'); return
    }
    setSavingInfo(true)
    try {
      const uploaded = await Promise.all(
        attachNew.map(async (file) => ({
          url: await uploadToCloudinary(file, 'evalua-facil/instrucciones-adjuntos'),
          nombre: file.name, tamano: file.size,
        }))
      )
      const payload = {
        nombre: infoForm.nombre.trim(),
        categoria,
        instrucciones: sanitizeHtml(infoForm.instrucciones),
        archivosAdjuntos: [...attachExisting, ...uploaded],
        fechaLimite: infoForm.fechaLimite || null,
        oculta: infoForm.oculta || !!infoForm.publishAt,
        publishAt: infoForm.publishAt || null,
        maxCalif: 10,
      }
      if (isNew) {
        const orden = existingActivities.filter((a) => a.parcial === parcial).length + 1
        const ref = await addDoc(collection(db, 'activities'), {
          ...payload, tipo: 'evaluacion',
          evaluacion: EVALUACION_DEFAULTS[categoria],
          parcial, orden, asignaturaId: subjectId,
          docenteId, createdAt: serverTimestamp(),
        })
        setCurrentActivityId(ref.id)
        setAttachNew([])
        onActivityCreated?.({ id: ref.id, ...payload, tipo: 'evaluacion', evaluacion: EVALUACION_DEFAULTS[categoria], parcial, orden, asignaturaId: subjectId, docenteId })
        toast('Evaluación guardada')
        loadPreguntas(ref.id)
      } else {
        await updateDoc(doc(db, 'activities', currentActivityId), payload)
        setAttachNew([])
        onActivityUpdated?.({ id: currentActivityId, ...payload })
        toast('Cambios guardados')
      }
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingInfo(false)
    }
  }

  // ── Save config ───────────────────────────────────────────────────
  async function handleSaveConfig(e) {
    e.preventDefault()
    if (!currentActivityId) { toast('Guarda la información general primero', 'error'); return }
    setSavingConfig(true)
    try {
      await updateDoc(doc(db, 'activities', currentActivityId), { evaluacion: configForm })
      toast('Configuración guardada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingConfig(false)
    }
  }

  // ── Preguntas helpers ─────────────────────────────────────────────
  function buildPreguntaData(form) {
    const base = {
      tipo: form.tipo, enunciado: form.enunciado.trim(),
      ponderacion: parseFloat(form.ponderacion) || 1,
      retroalimentacion: form.retroalimentacion.trim() || null,
    }
    if (form.tipo === 'opcion_multiple')
      return { ...base, opciones: OPCION_IDS.map((id) => ({ id, texto: form.opciones[id].trim() })), respuestaCorrecta: form.respuestaCorrecta }
    if (form.tipo === 'verdadero_falso')
      return { ...base, opciones: [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }], respuestaCorrecta: form.vfRespuesta }
    return { ...base, opciones: null, respuestaCorrecta: null }
  }

  function validatePregunta(form) {
    if (!form.enunciado.trim()) { toast('Escribe el enunciado', 'error'); return false }
    if (form.tipo === 'opcion_multiple' && OPCION_IDS.some((id) => !form.opciones[id].trim())) {
      toast('Completa las 4 opciones', 'error'); return false
    }
    return true
  }

  async function syncNumPreguntas(total) {
    if (!currentActivityId) return
    await updateDoc(doc(db, 'activities', currentActivityId), { 'evaluacion.numPreguntas': total })
  }

  const ponderacionUsada = preguntas.reduce((s, p) => s + (parseFloat(p.ponderacion) || 0), 0)
  const ponderacionRestante = Math.max(0, parseFloat((10 - ponderacionUsada).toFixed(2)))

  async function handleAddPregunta(e) {
    e.preventDefault()
    if (!currentActivityId) { toast('Guarda la información antes de agregar preguntas', 'error'); return }
    if (!validatePregunta(preguntaForm)) return
    const nueva = parseFloat(preguntaForm.ponderacion) || 1
    if (ponderacionUsada + nueva > 10.001) {
      toast(`La ponderación excede 10. Disponible: ${ponderacionRestante}`, 'error'); return
    }
    setSavingPregunta(true)
    try {
      let imagenUrl = null
      if (preguntaForm.imagenFile) imagenUrl = await uploadToCloudinary(preguntaForm.imagenFile, 'evalua-facil/preguntas')
      const orden = preguntas.length === 0 ? 0 : Math.max(...preguntas.map((p) => p.orden ?? 0)) + 1
      const data = { ...buildPreguntaData(preguntaForm), imagenUrl, orden, origenBancoId: null }
      const ref = await addDoc(collection(db, 'activities', currentActivityId, 'preguntas'), data)
      const updated = [...preguntas, { id: ref.id, ...data }]
      setPreguntas(updated)
      await syncNumPreguntas(updated.length)
      if (preguntaForm.guardarEnBanco) {
        // already imported at top
        await addDoc(collection(db, 'bancoReactivos'), {
          docenteId: auth.currentUser.uid, tipo: data.tipo, enunciado: data.enunciado,
          opciones: data.opciones, respuestaCorrecta: data.respuestaCorrecta,
          tema: preguntaForm.tema.trim() || null, createdAt: serverTimestamp(),
        })
      }
      setPreguntaForm(EMPTY_PREGUNTA); setShowPreguntaForm(false)
      toast('Pregunta agregada')
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setSavingPregunta(false) }
  }

  function openEditPregunta(p) {
    setEditingPreguntaId(p.id)
    setPreguntaEditForm({
      tipo: p.tipo, enunciado: p.enunciado, retroalimentacion: p.retroalimentacion || '',
      opciones: p.tipo === 'opcion_multiple'
        ? { a: p.opciones?.[0]?.texto || '', b: p.opciones?.[1]?.texto || '', c: p.opciones?.[2]?.texto || '', d: p.opciones?.[3]?.texto || '' }
        : { a: '', b: '', c: '', d: '' },
      respuestaCorrecta: p.tipo === 'opcion_multiple' ? (p.respuestaCorrecta || 'a') : 'a',
      vfRespuesta: p.tipo === 'verdadero_falso' ? (p.respuestaCorrecta || 'v') : 'v',
      ponderacion: p.ponderacion ?? 1, imagenFile: null,
    })
  }

  async function handleSavePreguntaEdit(e, id) {
    e.preventDefault()
    if (!validatePregunta(preguntaEditForm)) return
    const otrasPonderacion = preguntas.filter((p) => p.id !== id).reduce((s, p) => s + (parseFloat(p.ponderacion) || 0), 0)
    const nueva = parseFloat(preguntaEditForm.ponderacion) || 1
    if (otrasPonderacion + nueva > 10.001) {
      toast(`La ponderación excede 10. Disponible para este reactivo: ${Math.max(0, parseFloat((10 - otrasPonderacion).toFixed(2)))}`, 'error'); return
    }
    setSavingPregunta(true)
    try {
      let imagenUrl = preguntas.find((p) => p.id === id)?.imagenUrl || null
      if (preguntaEditForm.imagenFile) imagenUrl = await uploadToCloudinary(preguntaEditForm.imagenFile, 'evalua-facil/preguntas')
      const data = { ...buildPreguntaData(preguntaEditForm), imagenUrl }
      await updateDoc(doc(db, 'activities', currentActivityId, 'preguntas', id), data)
      setPreguntas((prev) => prev.map((p) => p.id === id ? { ...p, ...data } : p))
      setEditingPreguntaId(null); toast('Pregunta actualizada')
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setSavingPregunta(false) }
  }

  async function handleDeletePregunta(id) {
    if (!confirm('¿Eliminar esta pregunta?')) return
    await deleteDoc(doc(db, 'activities', currentActivityId, 'preguntas', id))
    const updated = preguntas.filter((p) => p.id !== id)
    setPreguntas(updated)
    await syncNumPreguntas(updated.length)
    toast('Pregunta eliminada')
  }

  async function handleDuplicatePregunta(p) {
    const orden = preguntas.length === 0 ? 0 : Math.max(...preguntas.map((x) => x.orden ?? 0)) + 1
    const data = { ...p, enunciado: `${p.enunciado} (copia)`, orden, origenBancoId: null }
    delete data.id
    const ref = await addDoc(collection(db, 'activities', currentActivityId, 'preguntas'), data)
    const updated = [...preguntas, { id: ref.id, ...data }]
    setPreguntas(updated)
    await syncNumPreguntas(updated.length)
    toast('Pregunta duplicada')
  }

  async function handleMovePregunta(id, direction) {
    const idx = preguntas.findIndex((p) => p.id === id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= preguntas.length) return
    const a = preguntas[idx], b = preguntas[swapIdx]
    await Promise.all([
      updateDoc(doc(db, 'activities', currentActivityId, 'preguntas', a.id), { orden: b.orden ?? swapIdx }),
      updateDoc(doc(db, 'activities', currentActivityId, 'preguntas', b.id), { orden: a.orden ?? idx }),
    ])
    setPreguntas((prev) => {
      const next = [...prev]
      next[idx] = { ...a, orden: b.orden ?? swapIdx }
      next[swapIdx] = { ...b, orden: a.orden ?? idx }
      return next.sort((x, y) => (x.orden ?? 0) - (y.orden ?? 0))
    })
  }

  async function handleAddFromBanco(item) {
    if (!currentActivityId) { toast('Guarda la información antes de agregar preguntas', 'error'); return }
    const orden = preguntas.length === 0 ? 0 : Math.max(...preguntas.map((p) => p.orden ?? 0)) + 1
    const data = { tipo: item.tipo, enunciado: item.enunciado, opciones: item.opciones || null,
      respuestaCorrecta: item.respuestaCorrecta || null, ponderacion: 1, retroalimentacion: null,
      imagenUrl: null, orden, origenBancoId: item.id }
    const ref = await addDoc(collection(db, 'activities', currentActivityId, 'preguntas'), data)
    const updated = [...preguntas, { id: ref.id, ...data }]
    setPreguntas(updated)
    await syncNumPreguntas(updated.length)
    toast('Pregunta agregada desde tu banco')
  }

  const temas = [...new Set(banco.map((b) => b.tema).filter(Boolean))]
  const bancoFiltrado = banco.filter((b) =>
    (!bancoSearch.trim() || b.enunciado.toLowerCase().includes(bancoSearch.trim().toLowerCase())) &&
    (!bancoTemaFilter || b.tema === bancoTemaFilter)
  )

  function openEditBanco(item) {
    setEditingBancoId(item.id)
    setBancoEditForm({
      tipo: item.tipo, enunciado: item.enunciado, tema: item.tema || '',
      opciones: item.tipo === 'opcion_multiple'
        ? { a: item.opciones?.[0]?.texto || '', b: item.opciones?.[1]?.texto || '', c: item.opciones?.[2]?.texto || '', d: item.opciones?.[3]?.texto || '' }
        : { a: '', b: '', c: '', d: '' },
      respuestaCorrecta: item.tipo === 'opcion_multiple' ? (item.respuestaCorrecta || 'a') : 'a',
      vfRespuesta: item.tipo === 'verdadero_falso' ? (item.respuestaCorrecta || 'v') : 'v',
    })
  }

  async function handleSaveBancoEdit(id) {
    if (!validatePregunta(bancoEditForm)) return
    const data = buildPreguntaData({ ...bancoEditForm, ponderacion: 1, retroalimentacion: '' })
    await updateDoc(doc(db, 'bancoReactivos', id), { tipo: data.tipo, enunciado: data.enunciado, opciones: data.opciones, respuestaCorrecta: data.respuestaCorrecta, tema: bancoEditForm.tema.trim() || null })
    setBanco((prev) => prev.map((b) => b.id === id ? { ...b, tipo: data.tipo, enunciado: data.enunciado, opciones: data.opciones, respuestaCorrecta: data.respuestaCorrecta, tema: bancoEditForm.tema.trim() || null } : b))
    setEditingBancoId(null); toast('Pregunta del banco actualizada')
  }

  async function handleDeleteBancoItem(id) {
    if (!confirm('¿Eliminar esta pregunta de tu banco?')) return
    await deleteDoc(doc(db, 'bancoReactivos', id))
    setBanco((prev) => prev.filter((b) => b.id !== id)); toast('Eliminada de tu banco')
  }

  async function handleDuplicateBancoItem(item) {
    const ref = await addDoc(collection(db, 'bancoReactivos'), { docenteId: auth.currentUser.uid, tipo: item.tipo, enunciado: `${item.enunciado} (copia)`, opciones: item.opciones || null, respuestaCorrecta: item.respuestaCorrecta || null, tema: item.tema || null, createdAt: serverTimestamp() })
    setBanco((prev) => [...prev, { id: ref.id, docenteId: auth.currentUser.uid, tipo: item.tipo, enunciado: `${item.enunciado} (copia)`, opciones: item.opciones, respuestaCorrecta: item.respuestaCorrecta, tema: item.tema }])
    toast('Pregunta duplicada')
  }

  async function handleGuardarEnBanco(p) {
    try {
      await addDoc(collection(db, 'bancoReactivos'), {
        docenteId: auth.currentUser.uid,
        tipo: p.tipo,
        enunciado: p.enunciado,
        opciones: p.opciones || null,
        respuestaCorrecta: p.respuestaCorrecta || null,
        tema: null,
        createdAt: serverTimestamp(),
      })
      toast('Pregunta guardada en tu banco')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  const tipoLabel = categoria === 'cuestionario' ? 'Cuestionario' : 'Examen'

  return (
    <div className="fixed inset-0 z-50 bg-surface overflow-y-auto">
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 bg-accent text-white shadow-lg">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={onClose} className="p-2 -ml-2 rounded hover:bg-white/10 transition-colors flex-shrink-0">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            {contextLine && <p className="text-xl font-bold text-white truncate">{contextLine}</p>}
            <p className="text-xs text-white/70 uppercase tracking-wide">{tipoLabel} — Parcial {parcial}</p>
            <h1 className="font-bold text-white truncate flex items-baseline gap-2">
              {activityLabel && <span className="text-2xl font-extrabold text-white/90">{activityLabel}</span>}
              <span>{infoForm.nombre || `Nuevo ${tipoLabel}`}</span>
            </h1>
          </div>
          <span className="text-xs text-white/60 flex-shrink-0">{preguntas.length} pregunta{preguntas.length !== 1 ? 's' : ''}</span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {/* ── Sección 1: Información general ── */}
        <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
          <button type="button" onClick={() => setInfoCollapsed((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--accent-tint)] transition-colors">
            <span className="font-semibold text-on-surface">Información general</span>
            <CollapseIcon size={18} className={`text-muted transition-transform ${infoCollapsed ? '' : 'rotate-180'}`} />
          </button>
          {!infoCollapsed && (
            <form onSubmit={handleSaveInfo} className="px-4 pb-4 space-y-3 border-t border-outline-variant pt-3">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Nombre</label>
                <input type="text" value={infoForm.nombre} onChange={(e) => setInfoForm((f) => ({ ...f, nombre: e.target.value }))}
                  required autoFocus placeholder={`Ej: ${tipoLabel} parcial 1`}
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Instrucciones</label>
                <RichTextEditor
                  value={infoForm.instrucciones}
                  onChange={(html) => setInfoForm((f) => ({ ...f, instrucciones: html }))}
                  placeholder="Describe la evaluación para tus estudiantes…"
                  attachments={[...attachExisting, ...attachNew.map((f) => ({ nombre: f.name, tamano: f.size }))]}
                  onAttachFiles={(files) => setAttachNew((prev) => [...prev, ...files])}
                  onRemoveAttachment={(i) => {
                    if (i < attachExisting.length) setAttachExisting((prev) => prev.filter((_, x) => x !== i))
                    else setAttachNew((prev) => prev.filter((_, x) => x !== i - attachExisting.length))
                  }}
                />
              </div>
              <p className="text-sm text-muted">Calificación máxima: <span className="font-semibold text-on-surface">10</span></p>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Fecha límite (opcional)</label>
                <input type="datetime-local" value={infoForm.fechaLimite}
                  onChange={(e) => setInfoForm((f) => ({ ...f, fechaLimite: e.target.value }))}
                  className="w-full px-4 py-2 rounded border border-outline-variant text-sm bg-surface" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-2">Visibilidad</label>
                <VisibilitySelect
                  mode={infoForm.visibilidadMode}
                  publishAt={infoForm.publishAt}
                  onModeChange={(mode) => setInfoForm((f) => ({ ...f, visibilidadMode: mode, oculta: mode !== 'show', publishAt: mode === 'schedule' ? f.publishAt : '' }))}
                  onPublishAtChange={(v) => setInfoForm((f) => ({ ...f, publishAt: v }))}
                />
              </div>
              <button type="submit" disabled={savingInfo}
                className="w-full py-2 bg-accent text-white font-semibold rounded disabled:opacity-60 flex items-center justify-center gap-2">
                {savingInfo ? <Spinner size="sm" /> : null}
                {savingInfo ? 'Guardando…' : 'Guardar y regresar a la asignatura'}
              </button>
            </form>
          )}
          {infoCollapsed && (
            <div className="px-4 pb-3 text-sm text-muted">
              {infoForm.nombre || <span className="italic">Sin nombre</span>}
              <span className="text-slate-300 mx-2">·</span>
              <button type="button" onClick={() => setInfoCollapsed(false)} className="text-accent hover:underline text-xs">Editar</button>
            </div>
          )}
        </div>

        {/* ── Sección 2: Configuración ── */}
        <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-outline-variant">
            <h2 className="font-semibold text-on-surface">Configuración</h2>
          </div>
          <form onSubmit={handleSaveConfig} className="px-4 py-4 space-y-3">
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
              <input type="datetime-local" value={configForm.publicarResultadosFecha || ''}
                onChange={(e) => setConfigForm((f) => ({ ...f, publicarResultadosFecha: e.target.value }))}
                className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
            )}
            <div className="pt-1 border-t border-outline-variant">
              <p className="text-xs font-medium text-muted uppercase tracking-wide pt-2 mb-2">Qué ve el alumno en sus resultados</p>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={!!configForm.mostrarRespuestasCorrectas}
                  onChange={(e) => setConfigForm((f) => ({ ...f, mostrarRespuestasCorrectas: e.target.checked }))} className="accent-[var(--accent)]" />
                Mostrar cuál era la respuesta correcta
              </label>
            </div>
            <button type="submit" disabled={savingConfig || !currentActivityId}
              className="w-full py-2 bg-surface-container text-on-surface text-sm font-medium rounded disabled:opacity-60 flex items-center justify-center gap-2">
              {savingConfig ? <Spinner size="sm" /> : null}
              {savingConfig ? 'Guardando…' : 'Guardar configuración'}
            </button>
            {!currentActivityId && (
              <p className="text-xs text-muted text-center">Guarda la información general primero para poder guardar la configuración.</p>
            )}
          </form>
        </div>

        {/* ── Sección 3: Preguntas ── */}
        <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-outline-variant flex items-center justify-between">
            <h2 className="font-semibold text-on-surface">Preguntas</h2>
            {preguntas.length > 0 && (
              <span className={`text-sm font-semibold ${Math.abs(ponderacionUsada - 10) < 0.01 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {parseFloat(ponderacionUsada.toFixed(2))} / 10 pts
              </span>
            )}
          </div>

          <div className="p-4 space-y-3">
            {!currentActivityId ? (
              <p className="text-sm text-muted text-center py-4">Guarda la información de arriba para empezar a agregar preguntas.</p>
            ) : loadingPreguntas ? (
              <div className="flex justify-center py-6"><Spinner /></div>
            ) : (
              <>
                {preguntas.length === 0 && !showPreguntaForm && (
                  <p className="text-sm text-slate-400 text-center py-4">Aún no hay reactivos.</p>
                )}

                {preguntas.map((p, i) => (
                  <div key={p.id} className="border border-outline-variant rounded-card">
                    {editingPreguntaId === p.id ? (
                      <form onSubmit={(e) => handleSavePreguntaEdit(e, p.id)} className="p-4 space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-muted mb-1">Tipo de pregunta</label>
                          <select value={preguntaEditForm.tipo} onChange={(e) => setPreguntaEditForm((f) => ({ ...f, tipo: e.target.value }))}
                            className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                            {TIPOS_PREGUNTA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-muted mb-1">Enunciado</label>
                          <textarea value={preguntaEditForm.enunciado} onChange={(e) => setPreguntaEditForm((f) => ({ ...f, enunciado: e.target.value }))}
                            rows={2} required className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
                        </div>
                        {preguntaEditForm.tipo === 'opcion_multiple' && OPCION_IDS.map((id) => (
                          <div key={id} className="flex items-center gap-2">
                            <input type="radio" name={`ep-${p.id}`} checked={preguntaEditForm.respuestaCorrecta === id}
                              onChange={() => setPreguntaEditForm((f) => ({ ...f, respuestaCorrecta: id }))} className="accent-[var(--accent)]" />
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
                                <input type="radio" name={`evf-${p.id}`} checked={preguntaEditForm.vfRespuesta === id}
                                  onChange={() => setPreguntaEditForm((f) => ({ ...f, vfRespuesta: id }))} className="accent-[var(--accent)]" />
                                {label}
                              </label>
                            ))}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-sm font-medium text-muted">Ponderación</label>
                            {(() => {
                              const otras = preguntas.filter((x) => x.id !== p.id).reduce((s, x) => s + (parseFloat(x.ponderacion) || 0), 0)
                              const disp = Math.max(0, parseFloat((10 - otras).toFixed(2)))
                              return <span className={`text-xs font-medium ${disp <= 0 ? 'text-error' : 'text-slate-400'}`}>Disponible: {disp} / 10</span>
                            })()}
                          </div>
                          <input type="number" min="0.1" max={Math.max(0, parseFloat((10 - preguntas.filter((x) => x.id !== p.id).reduce((s, x) => s + (parseFloat(x.ponderacion) || 0), 0)).toFixed(2)))} step="0.1" value={preguntaEditForm.ponderacion}
                            onChange={(e) => setPreguntaEditForm((f) => ({ ...f, ponderacion: e.target.value }))}
                            className="w-full px-3 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button type="button" onClick={() => setEditingPreguntaId(null)} className="flex-1 py-2 text-sm text-muted">Cancelar</button>
                          <button type="submit" disabled={savingPregunta} className="flex-1 py-2 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">
                            {savingPregunta ? 'Guardando…' : 'Guardar cambios'}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <span className="inline-block text-xs font-semibold uppercase tracking-wide text-accent bg-accent-light px-2 py-0.5 rounded mb-2">
                              {TIPOS_PREGUNTA.find((t) => t.value === p.tipo)?.label}
                            </span>
                            <p className="text-base font-semibold text-on-surface">{i + 1}. {p.enunciado}</p>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => handleGuardarEnBanco(p)} className="p-1.5 text-slate-400 hover:text-accent rounded" title="Guardar en mi banco"><Library size={18} /></button>
                            <button onClick={() => openEditPregunta(p)} className="p-1.5 text-slate-400 hover:text-accent rounded" title="Editar"><Pencil size={18} /></button>
                            <button onClick={() => handleDuplicatePregunta(p)} className="p-1.5 text-slate-400 hover:text-accent rounded" title="Duplicar"><Copy size={18} /></button>
                            <button onClick={() => handleDeletePregunta(p.id)} className="p-1.5 text-slate-400 hover:text-error rounded" title="Eliminar"><Trash2 size={18} /></button>
                          </div>
                        </div>
                        {p.imagenUrl && <img src={p.imagenUrl} alt="" className="mt-2 max-h-36 rounded border border-outline-variant" />}
                        {p.opciones && (
                          <div className="mt-2 grid grid-cols-2 gap-1.5">
                            {p.opciones.map((o) => (
                              <p key={o.id} className={`text-sm px-3 py-1.5 rounded ${o.id === p.respuestaCorrecta ? 'bg-emerald-50 text-emerald-700 font-medium' : 'bg-surface-container text-muted'}`}>{o.texto}</p>
                            ))}
                          </div>
                        )}
                        {p.tipo === 'respuesta_corta' && <p className="text-sm text-slate-400 mt-2 italic">Respuesta de texto libre — se califica manualmente</p>}
                        <p className="text-sm text-slate-400 mt-2">Ponderación: {p.ponderacion}</p>
                      </div>
                    )}
                  </div>
                ))}

                {showPreguntaForm ? (
                  <form onSubmit={handleAddPregunta} className="border-2 border-accent rounded-card p-4 space-y-3">
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
                        rows={2} required autoFocus className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
                      <ImageIcon size={15} /> Imagen opcional
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => setPreguntaForm((f) => ({ ...f, imagenFile: e.target.files?.[0] || null }))} />
                      {preguntaForm.imagenFile && <span className="text-xs text-accent">{preguntaForm.imagenFile.name}</span>}
                    </label>
                    {preguntaForm.tipo === 'opcion_multiple' && OPCION_IDS.map((id) => (
                      <div key={id} className="flex items-center gap-2">
                        <input type="radio" name="rc" checked={preguntaForm.respuestaCorrecta === id}
                          onChange={() => setPreguntaForm((f) => ({ ...f, respuestaCorrecta: id }))} className="accent-[var(--accent)] flex-shrink-0" />
                        <input type="text" value={preguntaForm.opciones[id]}
                          onChange={(e) => setPreguntaForm((f) => ({ ...f, opciones: { ...f.opciones, [id]: e.target.value } }))}
                          placeholder={`Opción ${id.toUpperCase()}`} required
                          className="flex-1 px-3 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                      </div>
                    ))}
                    {preguntaForm.tipo === 'opcion_multiple' && <p className="text-xs text-slate-400">Selecciona el radio de la opción correcta.</p>}
                    {preguntaForm.tipo === 'verdadero_falso' && (
                      <div className="flex gap-3">
                        {[['v', 'Verdadero'], ['f', 'Falso']].map(([id, label]) => (
                          <label key={id} className="flex items-center gap-2 text-sm">
                            <input type="radio" name="vf" checked={preguntaForm.vfRespuesta === id}
                              onChange={() => setPreguntaForm((f) => ({ ...f, vfRespuesta: id }))} className="accent-[var(--accent)]" />
                            {label}
                          </label>
                        ))}
                      </div>
                    )}
                    {preguntaForm.tipo === 'respuesta_corta' && <p className="text-xs text-slate-400 italic">El alumno responde con texto libre. Tú asignas los puntos al revisar.</p>}
                    <div>
                      <label className="block text-sm font-medium text-muted mb-1">Retroalimentación opcional</label>
                      <textarea value={preguntaForm.retroalimentacion} onChange={(e) => setPreguntaForm((f) => ({ ...f, retroalimentacion: e.target.value }))}
                        rows={1} placeholder="Se muestra al alumno al finalizar, si la config lo permite"
                        className="w-full px-3 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-sm font-medium text-muted">Ponderación</label>
                        <span className={`text-xs font-medium ${ponderacionRestante <= 0 ? 'text-error' : 'text-slate-400'}`}>
                          Disponible: {ponderacionRestante} / 10
                        </span>
                      </div>
                      <input type="number" min="0.1" max={ponderacionRestante} step="0.1" value={preguntaForm.ponderacion}
                        onChange={(e) => setPreguntaForm((f) => ({ ...f, ponderacion: e.target.value }))}
                        className="w-full px-3 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-muted">
                      <input type="checkbox" checked={preguntaForm.guardarEnBanco}
                        onChange={(e) => setPreguntaForm((f) => ({ ...f, guardarEnBanco: e.target.checked }))} className="accent-[var(--accent)]" />
                      Guardar también en mi banco de reactivos
                    </label>
                    {preguntaForm.guardarEnBanco && (
                      <input type="text" value={preguntaForm.tema} onChange={(e) => setPreguntaForm((f) => ({ ...f, tema: e.target.value }))}
                        placeholder="Tema (opcional, ej. Fracciones)"
                        className="w-full px-3 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                    )}
                    <div className="flex gap-2 pt-1">
                      <button type="button" onClick={() => { setShowPreguntaForm(false); setPreguntaForm(EMPTY_PREGUNTA) }}
                        className="flex-1 py-2 text-sm text-muted">Cancelar</button>
                      <button type="submit" disabled={savingPregunta} className="flex-1 py-2 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">
                        {savingPregunta ? 'Guardando…' : 'Guardar pregunta'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="pt-2 mt-2 border-t border-outline-variant">
                    <div className="flex gap-2">
                      <button onClick={() => setShowPreguntaForm(true)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm bg-accent text-white font-medium rounded-card">
                        <Plus size={15} /> Crear reactivo nuevo
                      </button>
                      <button onClick={() => { setShowBanco(true); loadBanco() }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm border border-accent text-accent font-medium rounded-card">
                        <Library size={15} /> Agregar desde el Banco
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="h-6" />
      </div>

      {/* ── Banco modal ── */}
      {showBanco && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setShowBanco(false); setEditingBancoId(null) }} />
          <div className="relative bg-surface-card w-full max-w-3xl rounded-t-card sm:rounded-card shadow-2xl flex flex-col" style={{height: 'min(90vh, 700px)'}}>
            {/* Header fijo */}
            <div className="p-4 border-b border-outline-variant flex-shrink-0">
              <h3 className="text-base font-semibold mb-3">Mi banco de reactivos</h3>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={bancoSearch} onChange={(e) => setBancoSearch(e.target.value)}
                    placeholder="Buscar…" className="w-full pl-8 pr-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
                </div>
                {temas.length > 0 && (
                  <select value={bancoTemaFilter} onChange={(e) => setBancoTemaFilter(e.target.value)}
                    className="px-2 py-2 rounded border border-outline-variant text-sm bg-surface">
                    <option value="">Todos los temas</option>
                    {temas.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
              </div>
            </div>

            {/* Lista con scroll */}
            <div className="flex-1 overflow-y-auto p-4">
              {bancoFiltrado.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-10">{banco.length === 0 ? 'Aún no tienes preguntas en tu banco' : 'Sin resultados'}</p>
              ) : (
                <div className="space-y-2">
                  {bancoFiltrado.map((item) => (
                    <div key={item.id} className="rounded border border-outline-variant p-3">
                      {editingBancoId === item.id ? (
                        <div className="space-y-2">
                          <select value={bancoEditForm.tipo} onChange={(e) => setBancoEditForm((f) => ({ ...f, tipo: e.target.value }))}
                            className="w-full px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface">
                            {TIPOS_PREGUNTA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                          <textarea value={bancoEditForm.enunciado} onChange={(e) => setBancoEditForm((f) => ({ ...f, enunciado: e.target.value }))}
                            rows={2} className="w-full px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                          {bancoEditForm.tipo === 'opcion_multiple' && OPCION_IDS.map((id) => (
                            <div key={id} className="flex items-center gap-2">
                              <input type="radio" name={`be-${item.id}`} checked={bancoEditForm.respuestaCorrecta === id}
                                onChange={() => setBancoEditForm((f) => ({ ...f, respuestaCorrecta: id }))} className="accent-[var(--accent)]" />
                              <input type="text" value={bancoEditForm.opciones[id]}
                                onChange={(e) => setBancoEditForm((f) => ({ ...f, opciones: { ...f.opciones, [id]: e.target.value } }))}
                                placeholder={`Opción ${id.toUpperCase()}`}
                                className="flex-1 px-2 py-1 rounded border border-outline-variant text-sm bg-surface" />
                            </div>
                          ))}
                          <input type="text" value={bancoEditForm.tema} onChange={(e) => setBancoEditForm((f) => ({ ...f, tema: e.target.value }))}
                            placeholder="Tema (opcional)" className="w-full px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setEditingBancoId(null)} className="flex-1 py-1.5 text-sm text-muted">Cancelar</button>
                            <button type="button" onClick={() => handleSaveBancoEdit(item.id)}
                              className="flex-1 py-1.5 bg-accent text-white text-sm font-medium rounded">Guardar</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2">
                          <button onClick={() => { handleAddFromBanco(item); setShowBanco(false) }}
                            className="flex-1 text-left text-sm hover:text-accent transition-colors">
                            {item.enunciado}
                            {item.tema && <span className="block text-xs text-slate-400 mt-0.5">{item.tema}</span>}
                          </button>
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => openEditBanco(item)} className="p-1 text-slate-400 hover:text-accent rounded"><Pencil size={13} /></button>
                            <button onClick={() => handleDuplicateBancoItem(item)} className="p-1 text-slate-400 hover:text-accent rounded"><Copy size={13} /></button>
                            <button onClick={() => handleDeleteBancoItem(item.id)} className="p-1 text-slate-400 hover:text-error rounded"><Trash2 size={13} /></button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer fijo */}
            <div className="p-3 border-t border-outline-variant flex-shrink-0">
              <button onClick={() => { setShowBanco(false); setEditingBancoId(null) }} className="w-full py-2 text-sm text-muted">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
