import { useState, useEffect, useRef } from 'react'
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
  Search, Image as ImageIcon, CalendarDays,
} from 'lucide-react'
import EFDateTimePicker from './EFDateTimePicker'
import PublicacionScheduler from './PublicacionScheduler'
import NuevaFechaEntregaModal from './NuevaFechaEntregaModal'
import { minDeadline } from '../utils/nowIso'

function toIsoNow() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function computeScheduleDefault() {
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

const TIPOS_PREGUNTA = [
  { value: 'opcion_multiple', label: 'Opción múltiple' },
  { value: 'verdadero_falso', label: 'Verdadero / Falso' },
  { value: 'respuesta_corta', label: 'Respuesta corta' },
  { value: 'subir_archivo', label: 'Subir documento' },
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
    publicarRespuestas: 'inmediato', publicarRespuestasFecha: null, respuestasPublicadas: false,
    mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
  },
  examen: {
    numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'secuencial',
    tiempoLimiteMin: 30, intentosPermitidos: 1, conservar: 'ultimo',
    publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
    publicarRespuestas: 'inmediato', publicarRespuestasFecha: null, respuestasPublicadas: false,
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
  students,        // roster del grupo — para "Nueva fecha de entrega" (todos/algunos)
  onClose,
  onActivityCreated,
  onActivityUpdated,
}) {
  const toast = useToast()
  // "Nueva fecha de entrega" (grupo completo o estudiantes específicos)
  const [newDateOpen, setNewDateOpen] = useState(false)
  // ── Basic info state ──────────────────────────────────────────────
  const [infoForm, setInfoForm] = useState({
    nombre: '', instrucciones: '', fechaLimite: '', oculta: false, publishAt: '', publishedAt: '', visibilidadMode: 'show',
  })
  const [savingInfo, setSavingInfo] = useState(false)
  const [currentActivityId, setCurrentActivityId] = useState(activityId)
  // True when the loaded activity was scheduled but not yet published —
  // the schedule option then reads "Reprogramar publicación"
  const [wasScheduled, setWasScheduled] = useState(false)
  // True when the loaded activity is a saved draft (hidden, never published,
  // not scheduled) — primary button becomes "Guardar y publicar"
  const [wasDraft, setWasDraft] = useState(false)
  // Snapshot taken after load — save buttons stay disabled while nothing changed
  const loadedSnapshot = useRef(null)
  const loadedAttachCount = useRef(0)
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
  const configSnap = useRef(JSON.stringify(EVALUACION_DEFAULTS[categoria] || EVALUACION_DEFAULTS.cuestionario))
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
        const loaded = {
          nombre: d.nombre || '',
          instrucciones: toRichHtml(d.instrucciones || ''),
          fechaLimite: d.fechaLimite
            ? (d.fechaLimite.includes('T') ? d.fechaLimite : `${d.fechaLimite}T00:00`)
            : '',
          oculta: d.oculta || false,
          publishAt: d.publishAt || '',
          publishedAt: d.publishedAt || '',
          visibilidadMode: !d.oculta ? 'published' : d.publishAt ? 'schedule' : 'hide',
        }
        setInfoForm(loaded)
        loadedSnapshot.current = JSON.stringify(loaded)
        loadedAttachCount.current = (d.archivosAdjuntos || []).length
        setWasScheduled(!!d.publishAt && !d.publishedAt)
        setWasDraft(!!d.oculta && !d.publishedAt && !d.publishAt)
        setAttachExisting(d.archivosAdjuntos || [])
        if (d.evaluacion) {
          const merged = { ...EVALUACION_DEFAULTS[categoria], ...d.evaluacion }
          // El modo legado 'manual' se muestra como 'ahora' (guardar para que
          // se publique) — mismo comportamiento gated-by-flag, nombre claro.
          if (merged.publicarResultados === 'manual') merged.publicarResultados = 'ahora'
          if (merged.publicarRespuestas === 'manual') merged.publicarRespuestas = 'ahora'
          setConfigForm(merged)
          configSnap.current = JSON.stringify(merged)
        }
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
  // asDraft: save hidden with NO publication — a borrador. It only becomes
  // published when the teacher publishes it (here or via the card's eye icon).
  async function handleSaveInfo(e, asDraft = false, exitAfter = true) {
    e.preventDefault()
    if (!htmlToPlainText(infoForm.instrucciones) && !infoForm.nombre.trim()) {
      toast('Escribe al menos el nombre de la evaluación', 'error'); return
    }
    // Effective mode: a non-draft save of a never-published hidden evaluación
    // means PUBLISH NOW — keeping it draft is the explicit secondary button.
    const mode = !asDraft && infoForm.visibilidadMode === 'hide' && !infoForm.publishedAt
      ? 'show' : infoForm.visibilidadMode
    // A scheduled publication must be in the future
    if (!asDraft && mode === 'schedule') {
      if (!infoForm.publishAt) { toast('Elige la fecha y hora de publicación', 'error'); return }
      if (infoForm.publishAt <= toIsoNow()) {
        toast('La fecha de publicación programada debe ser posterior a este momento', 'error'); return
      }
    }
    // Backend validation: fechaLimite must be strictly after the effective publish datetime
    const effectivePublishAt = asDraft ? null :
      mode === 'show'      ? toIsoNow() :
      mode === 'published' ? (infoForm.publishedAt || null) :
      mode === 'schedule'  ? (infoForm.publishAt || null) :
      (infoForm.publishedAt || null)  // hide: published-then-hidden still validates vs original date
    if (infoForm.fechaLimite && effectivePublishAt) {
      if (infoForm.fechaLimite <= effectivePublishAt) {
        toast('La fecha límite debe ser posterior a la fecha de publicación', 'error'); return
      }
    }

    setSavingInfo(true)
    try {
      const uploaded = await Promise.all(
        attachNew.map(async (file) => ({
          url: await uploadToCloudinary(file, 'evalua-facil/instrucciones-adjuntos'),
          nombre: file.name, tamano: file.size,
        }))
      )
      // publishedAt is permanent once set — hiding keeps the original date
      const newPublishedAt =
        !asDraft && mode === 'show' ? toIsoNow() : (infoForm.publishedAt || null)
      const payload = {
        nombre: infoForm.nombre.trim(),
        categoria,
        instrucciones: sanitizeHtml(infoForm.instrucciones),
        archivosAdjuntos: [...attachExisting, ...uploaded],
        fechaLimite: infoForm.fechaLimite || null,
        oculta: asDraft || mode === 'schedule' || mode === 'hide',
        publishAt: !asDraft && mode === 'schedule' ? (infoForm.publishAt || null) : null,
        publishedAt: newPublishedAt,
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
        toast(asDraft ? 'Borrador guardado — oculto para estudiantes' : 'Evaluación guardada')
        loadPreguntas(ref.id)
      } else {
        await updateDoc(doc(db, 'activities', currentActivityId), payload)
        setAttachNew([])
        onActivityUpdated?.({ id: currentActivityId, ...payload })
        toast(asDraft ? 'Borrador guardado — oculto para estudiantes' : wasDraft && mode === 'show' ? 'Evaluación publicada para estudiantes' : 'Cambios guardados')
      }
      if (exitAfter) {
        onClose()
      } else {
        // Stay editing: absorb uploads into the existing list and reset the dirty baseline
        setAttachExisting((prev) => [...prev, ...uploaded])
        loadedSnapshot.current = JSON.stringify(infoForm)
        loadedAttachCount.current = attachExisting.length + uploaded.length
      }
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
    // "Ahora (guardar para que se publique)" enciende la bandera al guardar para
    // que el estudiante lo vea de inmediato; la bandera es permanente.
    const toSave = { ...configForm }
    toSave.publicarResultados = toSave.publicarResultados || 'inmediato'
    toSave.publicarRespuestas = toSave.publicarRespuestas || 'inmediato'
    if (toSave.publicarResultados === 'ahora') toSave.resultadosPublicados = true
    if (toSave.publicarRespuestas === 'ahora') toSave.respuestasPublicadas = true
    setSavingConfig(true)
    try {
      await updateDoc(doc(db, 'activities', currentActivityId), { evaluacion: toSave })
      configSnap.current = JSON.stringify(toSave)
      setConfigForm(toSave)
      onActivityUpdated?.({ id: currentActivityId, evaluacion: toSave })
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
    // Tema is required whenever the reactivo is saved to the bank — the bank is
    // organized by tema, so an untagged entry is unusable. Global rule, not per subject.
    if (form.guardarEnBanco && !form.tema.trim()) {
      toast('Escribe el tema para guardar el reactivo en tu banco', 'error'); return false
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
      setGlowId(ref.id)
      await syncNumPreguntas(updated.length)
      if (preguntaForm.guardarEnBanco) {
        // already imported at top
        await addDoc(collection(db, 'bancoReactivos'), {
          docenteId: auth.currentUser.uid, tipo: data.tipo, enunciado: data.enunciado,
          opciones: data.opciones, respuestaCorrecta: data.respuestaCorrecta,
          tema: preguntaForm.tema.trim() || null,
          // Bank is organized by materia (auto, from the subject) + tema —
          // NOT by parcial: a question is reusable across parciales/ciclos
          materia: subject?.nombre || null, asignaturaId: subjectId || null,
          createdAt: serverTimestamp(),
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
    setGlowId(null)
    // Bring the chosen reactivo to the top so the edit form is fully visible
    setTimeout(() => document.getElementById(`preg-item-${p.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60)
    preguntaEditSnap.current = JSON.stringify({
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
      setEditingPreguntaId(null); setGlowId(id); toast('Pregunta actualizada')
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
    setGlowId(ref.id)
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
    setGlowId(ref.id)
    await syncNumPreguntas(updated.length)
    toast('Pregunta agregada desde tu banco')
  }

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
      tipo: item.tipo, enunciado: item.enunciado, tema: item.tema || '',
      opciones: item.tipo === 'opcion_multiple'
        ? { a: item.opciones?.[0]?.texto || '', b: item.opciones?.[1]?.texto || '', c: item.opciones?.[2]?.texto || '', d: item.opciones?.[3]?.texto || '' }
        : { a: '', b: '', c: '', d: '' },
      respuestaCorrecta: item.tipo === 'opcion_multiple' ? (item.respuestaCorrecta || 'a') : 'a',
      vfRespuesta: item.tipo === 'verdadero_falso' ? (item.respuestaCorrecta || 'v') : 'v',
    })
    setGlowId(null)
    // Bring the chosen reactivo to the top so the edit form is fully visible
    setTimeout(() => document.getElementById(`banco-item-${item.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60)
    bancoEditSnap.current = JSON.stringify({
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
    setEditingBancoId(null); setGlowId(id); toast('Pregunta del banco actualizada')
  }

  async function handleDeleteBancoItem(id) {
    if (!confirm('¿Eliminar esta pregunta de tu banco?')) return
    await deleteDoc(doc(db, 'bancoReactivos', id))
    setBanco((prev) => prev.filter((b) => b.id !== id)); toast('Eliminada de tu banco')
  }

  async function handleDuplicateBancoItem(item) {
    const ref = await addDoc(collection(db, 'bancoReactivos'), { docenteId: auth.currentUser.uid, tipo: item.tipo, enunciado: `${item.enunciado} (copia)`, opciones: item.opciones || null, respuestaCorrecta: item.respuestaCorrecta || null, tema: item.tema || null, materia: item.materia || null, asignaturaId: item.asignaturaId || null, createdAt: serverTimestamp() })
    setBanco((prev) => [...prev, { id: ref.id, docenteId: auth.currentUser.uid, tipo: item.tipo, enunciado: `${item.enunciado} (copia)`, opciones: item.opciones, respuestaCorrecta: item.respuestaCorrecta, tema: item.tema, materia: item.materia || null, asignaturaId: item.asignaturaId || null }])
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
        materia: subject?.nombre || null,
        asignaturaId: subjectId || null,
        createdAt: serverTimestamp(),
      })
      toast('Pregunta guardada en tu banco')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  const tipoLabel = categoria === 'cuestionario' ? 'Cuestionario' : 'Examen'

  // Dirty check for the info form: save buttons stay disabled while nothing
  // changed. Publishing a draft is an action by itself, so "Guardar y
  // publicar" ignores it. (Config and preguntas save separately.)
  const isDirty = isNew
    || attachNew.length > 0
    || (loadedSnapshot.current !== null && (
      JSON.stringify(infoForm) !== loadedSnapshot.current ||
      attachExisting.length !== loadedAttachCount.current
    ))

  return (
    <div className="fixed inset-0 z-50 bg-surface overflow-y-auto">
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 bg-accent text-white shadow-lg">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" aria-label="Volver" onClick={onClose} className="p-2 -ml-2 rounded hover:bg-white/10 transition-colors flex-shrink-0">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            {contextLine && <p className="text-xl font-bold text-white truncate">{contextLine}</p>}
            <p className="text-xs text-white/70 uppercase tracking-wide">{tipoLabel} — Parcial {parcial}</p>
            {/* Big name + number (only published activities have a label; drafts don't) */}
            <h1 className="text-2xl font-extrabold text-white truncate flex items-baseline gap-2">
              {activityLabel && <span className="text-white/90">{activityLabel} ·</span>}
              <span className="truncate">{infoForm.nombre || `Nuevo ${tipoLabel}`}</span>
            </h1>
          </div>
          <span className="text-xs text-white/60 flex-shrink-0">{preguntas.length} pregunta{preguntas.length !== 1 ? 's' : ''}</span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {/* ── Sección 1: Información general — always expanded, no collapse toggle ── */}
        <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
          <div className="w-full flex items-center px-4 py-3">
            <span className="font-semibold text-on-surface">Información general</span>
          </div>
          {(
            <form onSubmit={handleSaveInfo} className="px-4 pb-4 space-y-3 border-t border-outline-variant pt-3">
              <div>
                <label htmlFor="info-nombre" className="block text-sm font-medium text-muted mb-1">Nombre</label>
                <input id="info-nombre" type="text" value={infoForm.nombre} onChange={(e) => setInfoForm((f) => ({ ...f, nombre: e.target.value }))}
                  required autoFocus placeholder={`Ej: ${tipoLabel} parcial 1`}
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" />
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
                <label className="block text-sm font-medium text-muted mb-2">Visibilidad</label>
                <VisibilitySelect
                  mode={infoForm.visibilidadMode}
                  publishAt={infoForm.publishAt}
                  publishedAt={infoForm.publishedAt}
                  wasScheduled={wasScheduled}
                  isDraft={wasDraft}
                  onModeChange={(mode) => setInfoForm((f) => ({
                    ...f, visibilidadMode: mode,
                    publishAt: mode === 'schedule' ? (f.publishAt || computeScheduleDefault()) : '',
                    // hiding a never-published draft clears the deadline; a published
                    // activity keeps it (hide is temporary, deadline still applies)
                    fechaLimite: mode === 'hide' && !f.publishedAt ? '' : f.fechaLimite,
                  }))}
                  onPublishAtChange={(v) => setInfoForm((f) => ({ ...f, publishAt: v }))}
                />
              </div>
              {(infoForm.visibilidadMode !== 'hide' || infoForm.publishedAt) && (
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">{infoForm.fechaLimite ? 'Fecha límite de entrega' : 'Fecha límite de entrega (opcional)'}</label>
                  {infoForm.visibilidadMode === 'schedule' && !infoForm.publishAt ? (
                    <p className="text-xs text-slate-400 px-1">Primero elige la fecha de publicación arriba.</p>
                  ) : (
                    <EFDateTimePicker
                      mode="datetime"
                      headerLabel="Fecha y hora límite"
                      value={infoForm.fechaLimite}
                      onChange={v => setInfoForm(f => ({ ...f, fechaLimite: v }))}
                      placeholder="Sin fecha límite…"
                      clearable
                      defaultTime="23:59"
                      defaultDate={
                        (infoForm.publishAt || infoForm.publishedAt || '').split('T')[0] || undefined
                      }
                      minDateTime={minDeadline(
                        infoForm.visibilidadMode === 'schedule' ? infoForm.publishAt : infoForm.publishedAt
                      )}
                    />
                  )}
                  {/* Evaluación publicada: prorrogar la fecha para todo el grupo o
                      para estudiantes específicos — mismo modal que un entregable. */}
                  {!isNew && infoForm.publishedAt && (
                    <button
                      type="button"
                      onClick={() => setNewDateOpen(true)}
                      className="w-full mt-2 py-2 text-sm border border-accent text-accent rounded hover:bg-[var(--accent-tint)] transition-colors flex items-center justify-center gap-2"
                    >
                      <CalendarDays size={16} /> Nueva fecha límite de entrega
                    </button>
                  )}
                </div>
              )}
            </form>
          )}
        </div>

        {/* ── Acciones de la información general — arriba de Configuración:
            Configuración tiene su propio guardar y los reactivos se guardan
            individualmente ── */}
        <div className="space-y-2">
          {wasDraft && infoForm.visibilidadMode === 'hide' ? (
            // Draft with "Borrador" selected: save-and-keep-editing or save-and-exit
            <>
              <button type="button" disabled={savingInfo || !isDirty}
                onClick={() => handleSaveInfo({ preventDefault: () => {} }, true, false)}
                className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
                {savingInfo ? <Spinner size="sm" /> : null}
                {savingInfo ? 'Guardando…' : 'Guardar borrador y seguir editando'}
              </button>
              <button type="button" disabled={savingInfo || !isDirty}
                onClick={() => handleSaveInfo({ preventDefault: () => {} }, true, true)}
                className="w-full py-2.5 border border-accent text-accent font-medium rounded-card hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                Guardar borrador y salir
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={savingInfo || (!wasDraft && !isNew && !isDirty)}
                onClick={() => handleSaveInfo({ preventDefault: () => {} })}
                className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
                {savingInfo ? <Spinner size="sm" /> : null}
                {savingInfo ? 'Guardando…' : wasDraft ? (infoForm.visibilidadMode === 'schedule' ? 'Guardar con la fecha programada' : 'Guardar y publicar ahora') : 'Guardar y regresar a la asignatura'}
              </button>
              {!infoForm.publishedAt && !wasDraft && (
                <button type="button" disabled={savingInfo}
                  onClick={() => handleSaveInfo({ preventDefault: () => {} }, true, false)}
                  className="w-full py-2.5 border border-accent text-accent font-medium rounded-card hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                  Guardar como borrador
                </button>
              )}
            </>
          )}
          {!isNew && (
            // With no changes, exiting is the natural action — it takes the primary style
            <button type="button" onClick={onClose} disabled={savingInfo}
              className={`w-full py-2.5 font-medium rounded-card transition-colors disabled:opacity-60 ${(!isDirty && (!wasDraft || infoForm.visibilidadMode === 'hide'))
                ? 'bg-accent text-white font-semibold hover:bg-accent-hover'
                : 'border border-outline-variant text-muted hover:bg-surface-container'}`}>
              {isDirty ? 'Salir sin guardar cambios' : 'Salir'}
            </button>
          )}
        </div>

        {/* ── Sección 2: Configuración — same accent container as Preguntas ── */}
        <div className="bg-surface-card rounded-card shadow-card overflow-hidden" style={{ border: '1px solid var(--accent)' }}>
          <div className="px-4 py-3" style={{ background: 'var(--accent-light)', borderBottom: '1px solid var(--accent)' }}>
            <h2 className="font-semibold" style={{ color: 'var(--accent)' }}>Configuración</h2>
          </div>
          <form onSubmit={handleSaveConfig} className="px-4 py-4 space-y-3">
            <div>
              <label htmlFor="config-orden-preguntas" className="block text-sm font-medium text-muted mb-1">Orden de las preguntas</label>
              <select id="config-orden-preguntas" value={configForm.ordenPreguntas} onChange={(e) => setConfigForm((f) => ({ ...f, ordenPreguntas: e.target.value }))}
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
              <label htmlFor="config-tiempo-limite" className="block text-sm font-medium text-muted mb-1">Tiempo límite (minutos)</label>
              <input id="config-tiempo-limite" type="number" min="1" value={configForm.tiempoLimiteMin ?? ''}
                onChange={(e) => setConfigForm((f) => ({ ...f, tiempoLimiteMin: e.target.value ? parseInt(e.target.value, 10) : null }))}
                placeholder="Sin límite" className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
            </div>
            <div>
              <label htmlFor="config-intentos" className="block text-sm font-medium text-muted mb-1">Intentos permitidos</label>
              <input id="config-intentos" type="number" min="1" value={configForm.intentosPermitidos ?? ''}
                onChange={(e) => setConfigForm((f) => ({ ...f, intentosPermitidos: e.target.value ? parseInt(e.target.value, 10) : null }))}
                placeholder="Ilimitados" className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
            </div>
            {/* La política de varios intentos solo importa con más de un intento —
                con un único intento "conservar la mejor/última" es ruido. */}
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
            {/* La publicación de la calificación y la de las respuestas son
                independientes: se puede liberar la calificación ya y las
                respuestas después (o nunca). */}
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
            <button type="submit" disabled={savingConfig || !currentActivityId || JSON.stringify(configForm) === configSnap.current}
              className={`w-full py-2 text-sm font-medium rounded disabled:opacity-60 flex items-center justify-center gap-2 ${JSON.stringify(configForm) !== configSnap.current ? 'bg-accent text-white' : 'bg-surface-container text-on-surface'}`}>
              {savingConfig ? <Spinner size="sm" /> : null}
              {savingConfig ? 'Guardando…' : 'Guardar configuración'}
            </button>
            {!currentActivityId && (
              <p className="text-xs text-muted text-center">Guarda la información general primero para poder guardar la configuración.</p>
            )}
          </form>
        </div>

        {/* ── Sección 3: Preguntas ── */}
        <div className="bg-surface-card rounded-card shadow-card overflow-hidden" style={{ border: '1px solid var(--accent)' }}>
          <div className="px-4 py-3 flex items-center justify-between"
            style={{ background: 'var(--accent-light)', borderBottom: '1px solid var(--accent)' }}>
            <h2 className="font-semibold" style={{ color: 'var(--accent)' }}>Preguntas</h2>
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
                  <div key={p.id} id={`preg-item-${p.id}`} className="border rounded-card"
                    style={editingPreguntaId === p.id
                      ? { borderColor: 'var(--accent)', background: 'var(--accent-light)', borderWidth: 2 }
                      : p.id === glowId
                        ? { borderColor: 'var(--accent)', background: 'var(--accent-light)' }
                        : { borderColor: 'var(--outline-variant)' }}>
                    {editingPreguntaId === p.id ? (
                      <form onSubmit={(e) => handleSavePreguntaEdit(e, p.id)} className="p-4 space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>Editando · Pregunta {i + 1}</p>
                        <div>
                          <label htmlFor="preg-edit-tipo" className="block text-sm font-medium text-muted mb-1">Tipo de pregunta</label>
                          <select id="preg-edit-tipo" value={preguntaEditForm.tipo} onChange={(e) => setPreguntaEditForm((f) => ({ ...f, tipo: e.target.value }))}
                            className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                            {TIPOS_PREGUNTA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="preg-edit-enunciado" className="block text-sm font-medium text-muted mb-1">Enunciado</label>
                          <textarea id="preg-edit-enunciado" value={preguntaEditForm.enunciado} onChange={(e) => setPreguntaEditForm((f) => ({ ...f, enunciado: e.target.value }))}
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
                            <label htmlFor="preg-edit-ponderacion" className="text-sm font-medium text-muted">Ponderación</label>
                            {(() => {
                              const otras = preguntas.filter((x) => x.id !== p.id).reduce((s, x) => s + (parseFloat(x.ponderacion) || 0), 0)
                              const disp = Math.max(0, parseFloat((10 - otras).toFixed(2)))
                              return <span className={`text-xs font-medium ${disp <= 0 ? 'text-error' : 'text-slate-400'}`}>Disponible: {disp} / 10</span>
                            })()}
                          </div>
                          <input id="preg-edit-ponderacion" type="number" min="0.1" max={Math.max(0, parseFloat((10 - preguntas.filter((x) => x.id !== p.id).reduce((s, x) => s + (parseFloat(x.ponderacion) || 0), 0)).toFixed(2)))} step="0.1" value={preguntaEditForm.ponderacion}
                            onChange={(e) => setPreguntaEditForm((f) => ({ ...f, ponderacion: e.target.value }))}
                            className="w-full px-3 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button type="button" onClick={() => { setEditingPreguntaId(null); setGlowId(p.id) }} className="flex-1 py-2 text-sm text-muted">Cancelar</button>
                          <button type="submit" disabled={savingPregunta || JSON.stringify(preguntaEditForm) === preguntaEditSnap.current} className="flex-1 py-2 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">
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
                            <button type="button" aria-label="Guardar en mi banco" onClick={() => handleGuardarEnBanco(p)} className="p-1.5 text-slate-400 hover:text-accent rounded" data-tooltip="Guardar en mi banco"><Library size={18} /></button>
                            <button type="button" aria-label="Editar" onClick={() => openEditPregunta(p)} className="p-1.5 text-slate-400 hover:text-accent rounded" data-tooltip="Editar"><Pencil size={18} /></button>
                            <button type="button" aria-label="Duplicar" onClick={() => handleDuplicatePregunta(p)} className="p-1.5 text-slate-400 hover:text-accent rounded" data-tooltip="Duplicar"><Copy size={18} /></button>
                            <button type="button" aria-label="Eliminar" onClick={() => handleDeletePregunta(p.id)} className="p-1.5 text-slate-400 hover:text-error rounded" data-tooltip="Eliminar"><Trash2 size={18} /></button>
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
                        {p.tipo === 'subir_archivo' && <p className="text-sm text-slate-400 mt-2 italic">El alumno sube un documento — se califica manualmente</p>}
                        <p className="text-sm text-slate-400 mt-2">Ponderación: {p.ponderacion}</p>
                      </div>
                    )}
                  </div>
                ))}

                {showPreguntaForm ? (
                  <form onSubmit={handleAddPregunta} className="border-2 border-accent rounded-card p-4 space-y-3"
                    style={{ background: 'var(--accent-light)' }}>
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>Creando · Pregunta {preguntas.length + 1}</p>
                    <div>
                      <label htmlFor="preg-new-tipo" className="block text-sm font-medium text-muted mb-1">Tipo de pregunta</label>
                      <select id="preg-new-tipo" value={preguntaForm.tipo} onChange={(e) => setPreguntaForm((f) => ({ ...f, tipo: e.target.value }))}
                        className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                        {TIPOS_PREGUNTA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="preg-new-enunciado" className="block text-sm font-medium text-muted mb-1">Enunciado</label>
                      <textarea id="preg-new-enunciado" value={preguntaForm.enunciado} onChange={(e) => setPreguntaForm((f) => ({ ...f, enunciado: e.target.value }))}
                        rows={2} required autoFocus className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" />
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
                    {preguntaForm.tipo === 'subir_archivo' && <p className="text-xs text-slate-400 italic">El alumno sube un documento (PDF, Word, imágenes, etc.). Tú asignas los puntos al revisar.</p>}
                    <div>
                      <label htmlFor="preg-new-retro" className="block text-sm font-medium text-muted mb-1">Retroalimentación opcional</label>
                      <textarea id="preg-new-retro" value={preguntaForm.retroalimentacion} onChange={(e) => setPreguntaForm((f) => ({ ...f, retroalimentacion: e.target.value }))}
                        rows={1} placeholder="Se muestra al alumno al finalizar, si la config lo permite"
                        className="w-full px-3 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label htmlFor="preg-new-ponderacion" className="text-sm font-medium text-muted">Ponderación</label>
                        <span className={`text-xs font-medium ${ponderacionRestante <= 0 ? 'text-error' : 'text-slate-400'}`}>
                          Disponible: {ponderacionRestante} / 10
                        </span>
                      </div>
                      <input id="preg-new-ponderacion" type="number" min="0.1" max={ponderacionRestante} step="0.1" value={preguntaForm.ponderacion}
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
                        required placeholder="Tema (obligatorio, ej. Fracciones)"
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
                      <button type="button" onClick={() => { setGlowId(null); setShowPreguntaForm(true) }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm bg-accent text-white font-medium rounded-card">
                        <Plus size={15} /> Crear reactivo nuevo
                      </button>
                      <button type="button" onClick={() => { setShowBanco(true); loadBanco() }}
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
          <div className="absolute inset-0 bg-black/40" onClick={() => { setShowBanco(false); setEditingBancoId(null); setGlowId(null) }} />
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
                {materias.length > 0 && (
                  <select value={bancoMateriaFilter} onChange={(e) => setBancoMateriaFilter(e.target.value)}
                    className="px-2 py-2 rounded border border-outline-variant text-sm bg-surface">
                    <option value="">Todas las materias</option>
                    {materias.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
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
                    <div key={item.id} id={`banco-item-${item.id}`} className="rounded border p-3"
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
                              <input type="radio" name={`be-${item.id}`} checked={bancoEditForm.respuestaCorrecta === id}
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
                          <input type="text" value={bancoEditForm.tema} onChange={(e) => setBancoEditForm((f) => ({ ...f, tema: e.target.value }))}
                            placeholder="Tema para agrupar en el banco (opcional, ej. Fracciones)" className="w-full px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface" />
                          <div className="flex gap-2">
                            <button type="button" onClick={() => { setEditingBancoId(null); setGlowId(item.id) }} className="flex-1 py-1.5 text-sm text-muted">Cancelar</button>
                            <button type="button" onClick={() => handleSaveBancoEdit(item.id)}
                              disabled={JSON.stringify(bancoEditForm) === bancoEditSnap.current}
                              className="flex-1 py-1.5 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">Guardar</button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-start gap-2">
                            <div className="flex-1">
                              <span className="inline-block text-[10px] font-semibold uppercase tracking-wide text-accent bg-accent-light px-1.5 py-0.5 rounded mb-1">
                                {TIPOS_PREGUNTA.find((t) => t.value === item.tipo)?.label}
                              </span>
                              {item.materia && <span className="ml-2 text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">{item.materia}</span>}
                              {item.tema && <span className="ml-2 text-[10px] text-slate-400">{item.tema}</span>}
                              <p className="text-sm font-semibold text-on-surface">{item.enunciado}</p>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              <button type="button" aria-label="Editar" onClick={() => openEditBanco(item)} className="p-1 text-slate-400 hover:text-accent rounded"><Pencil size={13} /></button>
                              <button type="button" aria-label="Duplicar" onClick={() => handleDuplicateBancoItem(item)} className="p-1 text-slate-400 hover:text-accent rounded"><Copy size={13} /></button>
                              <button type="button" aria-label="Eliminar" onClick={() => handleDeleteBancoItem(item.id)} className="p-1 text-slate-400 hover:text-error rounded"><Trash2 size={13} /></button>
                            </div>
                          </div>
                          {item.opciones && Array.isArray(item.opciones) && (
                            <div className="mt-2 grid grid-cols-2 gap-1">
                              {item.opciones.map((o) => (
                                <p key={o.id} className={`text-xs px-2 py-1 rounded ${o.id === item.respuestaCorrecta ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'bg-surface-container text-muted'}`}>
                                  {o.texto}
                                </p>
                              ))}
                            </div>
                          )}
                          {item.tipo === 'verdadero_falso' && item.respuestaCorrecta && (
                            <p className="mt-1.5 text-xs">
                              Correcta: <span className="font-semibold text-emerald-700">{item.respuestaCorrecta === 'v' ? 'Verdadero' : 'Falso'}</span>
                            </p>
                          )}
                          <button type="button" onClick={() => { handleAddFromBanco(item); setShowBanco(false) }}
                            className="mt-2 w-full py-1.5 text-xs font-medium bg-accent text-white rounded">
                            + Agregar a la evaluación
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer fijo */}
            <div className="p-3 border-t border-outline-variant flex-shrink-0">
              <button type="button" onClick={() => { setShowBanco(false); setEditingBancoId(null); setGlowId(null) }}
                className="w-full py-2.5 bg-accent text-white text-sm font-semibold rounded-card hover:bg-accent-hover transition-colors">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* "Nueva fecha de entrega" — z-[60] para quedar sobre el editor (z-50) */}
      {newDateOpen && currentActivityId && (
        <NuevaFechaEntregaModal
          activityId={currentActivityId}
          students={students || []}
          onClose={() => setNewDateOpen(false)}
          onSaved={(result) => {
            if (result.mode === 'todos') {
              // El modal ya escribió la nueva fecha en Firestore — reflejarla en el
              // formulario Y en la línea base para que no cuente como cambio sin guardar.
              setInfoForm((f) => {
                const next = { ...f, fechaLimite: result.date }
                loadedSnapshot.current = JSON.stringify(next)
                return next
              })
              onActivityUpdated?.({ id: currentActivityId, fechaLimite: result.date })
            }
          }}
        />
      )}
    </div>
  )
}
