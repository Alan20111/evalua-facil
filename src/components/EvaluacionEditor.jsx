import { useState, useEffect, useRef } from 'react'
import {
  collection, query, where, doc, getDocs, serverTimestamp, getDoc,
} from 'firebase/firestore'
// Escrituras a través del candado de suscripción vencida (ver utils/firestoreGuard.js).
import { addDoc, updateDoc, deleteDoc, writeBatch } from '../utils/firestoreGuard'
import { db, auth } from '../firebase'
import { useToast } from './Toast'
import Spinner from './Spinner'
import VisibilitySelect from './VisibilitySelect'
import Select from './ui/Select'
import RichTextEditor from './RichTextEditor'
import { uploadToCloudinary } from '../utils/cloudinary'
import { sanitizeHtml, toRichHtml, htmlToPlainText, richTextContentClass } from '../utils/sanitizeHtml'
import { repartirPonderacionParejo } from '../utils/evaluacionGrading'
import {
  ArrowLeft, Plus, Trash2, Library, Pencil, Copy, Scale, CheckSquare, Square,
  Image as ImageIcon, CalendarDays, Eye, EyeOff, ListChecks, Timer, RotateCcw, X, Lock, LockOpen, ChevronRight, ChevronUp, ChevronDown,
} from 'lucide-react'
import EFDateTimePicker from './EFDateTimePicker'
import PublicacionScheduler from './PublicacionScheduler'
import SinCalificacionConfig from './SinCalificacionConfig'
import { SeccionForm, SeccionHeader, ConfirmarBorrarSeccion, BotonAgregarSeccion, SelectorSeccion } from './SeccionesEditor'
import { useSecciones } from '../hooks/useSecciones'
import { agruparPreguntas, preguntasEnOrden, siguienteOrden } from '../utils/secciones'
import {
  crearPregunta, actualizarPregunta, borrarPregunta, crearPreguntasEnLote,
  cargarPreguntasConClave,
} from '../utils/evaluacionClave'
import NuevaFechaEntregaModal from './NuevaFechaEntregaModal'
import ConfirmModal from './ConfirmModal'
import SearchInput from './SearchInput'
import { minDeadline, nowIsoLocal, isoLocalFromDate } from '../utils/nowIso'
import { isActivityPublished, resolveVisibilidad, isDraftActivity, formatDeadline } from '../utils/activityVisibility'
import { groupExtensions } from '../utils/extensiones'
import { IS_NATIVE_APP } from '../utils/platform'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'

function toIsoNow() {
  return nowIsoLocal()
}

function computeScheduleDefault() {
  return isoLocalFromDate(new Date(Date.now() + 2 * 60 * 60 * 1000))
}

const TIPOS_PREGUNTA = [
  { value: 'opcion_multiple', label: 'Opción múltiple' },
  { value: 'verdadero_falso', label: 'Verdadero / Falso' },
  { value: 'respuesta_corta', label: 'Respuesta corta' },
  { value: 'subir_archivo', label: 'Subir documento' },
]
// Antes eran exactamente 4 opciones fijas (a-d), las 4 obligatorias. Pedido
// explícito: por default solo A y B son obligatorias; C y D aparecen ya
// listas pero se pueden quitar con una tachita, se pueden agregar tantas
// opciones más como se quiera, y se puede agregar una opción "Otra:" para
// que el alumno escriba su propia respuesta (ver EvaluacionRunner.jsx).
// Los ids ya no son letras fijas — son únicos por opción, generados una vez
// al crearla; la letra que se le muestra al docente (A, B, C…) es solo la
// posición actual en la lista, se recalcula en cada render.
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
// Convierte las opciones YA guardadas (array) de una pregunta existente al
// shape del formulario — usado al abrir "Editar" (aquí y en el banco).
function opcionesFromExisting(p) {
  if (p.tipo !== 'opcion_multiple' || !p.opciones?.length) return emptyOpciones()
  return p.opciones.map((o) => ({ id: o.id, texto: o.texto || '', esOtra: !!o.esOtra }))
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

// Lista editable de opciones de un reactivo de opción múltiple — compartida
// por los tres formularios (crear, editar, banco). A/B (índices 0 y 1) son
// obligatorias y no se pueden quitar; el resto (C, D, y cualquiera agregada
// después) lleva su propia tachita. La opción "Otra" no tiene radio (no se
// puede marcar como correcta — no hay forma de calificarla en automático) ni
// campo de texto: el alumno escribe su respuesta al responder.
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
              className="p-1 text-slate-400 hover:text-error rounded flex-shrink-0">
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
  onDeleteActivity,   // EvaluacionManager only: abre la confirmación de borrado — ausente al crear
}) {
  const toast = useToast()
  // This component is only mounted while open — same close path as its own
  // "Volver" button.
  useBackHandler(onClose, true)
  useScrollLock(true)
  // "Nueva fecha de entrega" (grupo completo o estudiantes específicos)
  const [newDateOpen, setNewDateOpen] = useState(false)
  useBackHandler(() => setNewDateOpen(false), newDateOpen)
  // ── Basic info state ──────────────────────────────────────────────
  const [infoForm, setInfoForm] = useState({
    nombre: '', instrucciones: '', fechaLimite: '', oculta: false, publishAt: '', publishedAt: '', visibilidadMode: 'show',
    notificarDocente: false, cerrarEntregasEnFecha: true,
  })
  const [savingInfo, setSavingInfo] = useState(false)
  // Confirmación de "regresar a borrador" — solo cuando ya estaba publicada.
  const [confirmDraft, setConfirmDraft] = useState(false)
  // Prórrogas por estudiante — se muestran igual que en un entregable. Sin
  // esto, "Nueva fecha límite → Para algunos" escribía en Firestore y en
  // pantalla no cambiaba nada, así que parecía que no se guardaba.
  const [extensiones, setExtensiones] = useState({})
  const [extensionesMotivo, setExtensionesMotivo] = useState({})
  const [currentActivityId, setCurrentActivityId] = useState(activityId)
  // True when the loaded activity was scheduled but not yet published —
  // the schedule option then reads "Reprogramar publicación"
  const [wasScheduled, setWasScheduled] = useState(false)
  // True when the loaded activity is a saved draft (hidden, never published,
  // not scheduled) — primary button becomes "Guardar y publicar"
  const [wasDraft, setWasDraft] = useState(false)
  // True when the loaded activity was already visible to students before this
  // edit started — used to warn the teacher, on save, to tell them about changes.
  const [wasAlreadyPublished, setWasAlreadyPublished] = useState(false)
  // Snapshot taken after load — save buttons stay disabled while nothing changed
  const loadedSnapshot = useRef(null)
  const loadedAttachCount = useRef(0)
  const [attachExisting, setAttachExisting] = useState([])
  const [attachNew, setAttachNew] = useState([])
  const [preview, setPreview] = useState(false)

  // ── Configuración state ───────────────────────────────────────────
  const [configForm, setConfigForm] = useState(EVALUACION_DEFAULTS[categoria] || EVALUACION_DEFAULTS.cuestionario)
  const [savingConfig, setSavingConfig] = useState(false)

  // ── Preguntas state ───────────────────────────────────────────────
  const [preguntas, setPreguntas] = useState([])
  const [loadingPreguntas, setLoadingPreguntas] = useState(false)
  const [showPreguntaForm, setShowPreguntaForm] = useState(false)
  const [preguntaForm, setPreguntaForm] = useState(emptyPregunta)
  const [editingPreguntaId, setEditingPreguntaId] = useState(null)
  const [preguntaEditForm, setPreguntaEditForm] = useState(null)
  const [savingPregunta, setSavingPregunta] = useState(false)
  const [banco, setBanco] = useState([])
  const [bancoLoaded, setBancoLoaded] = useState(false)
  const [showBanco, setShowBanco] = useState(false)
  useBackHandler(() => setShowBanco(false), showBanco)
  useScrollLock(showBanco)
  const [bancoSearch, setBancoSearch] = useState('')
  const [bancoTemaFilter, setBancoTemaFilter] = useState('')
  const [bancoMateriaFilter, setBancoMateriaFilter] = useState('')
  // Selección múltiple para agregar varios reactivos del banco de un jalón
  // (pedido explícito) — antes solo se podía agregar uno a la vez, cada uno
  // con su propio viaje de red.
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
  const configSnap = useRef(JSON.stringify(EVALUACION_DEFAULTS[categoria] || EVALUACION_DEFAULTS.cuestionario))
  // Baseline de los reactivos, tomada al cargarlos (ver loadPreguntas)
  const preguntasSnap = useRef(null)
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
          notificarDocente: d.notificarDocente || false,
          cerrarEntregasEnFecha: !(d.recibirTarde ?? false),
        }
        setInfoForm(loaded)
        setExtensiones(d.extensiones || {})
        setExtensionesMotivo(d.extensionesMotivo || {})
        loadedSnapshot.current = JSON.stringify(loaded)
        loadedAttachCount.current = (d.archivosAdjuntos || []).length
        setWasScheduled(!!d.publishAt && !d.publishedAt)
        setWasDraft(isDraftActivity(d))
        setWasAlreadyPublished(isActivityPublished(d))
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
      // Con su clave: la lee de `activities/{id}/clave`, que solo abre el
      // docente dueño. El alumno no tiene forma de pedirla (A08).
      const list = (await cargarPreguntasConClave(aId)).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      setPreguntas(list)
      // Punto de partida para saber si el docente tocó los reactivos (ver
      // `preguntasTocadas` abajo). Se toma aquí, con la lista recién cargada,
      // así que al abrir el editor siempre arranca "sin tocar".
      preguntasSnap.current = JSON.stringify(list)
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

  // "Notificarme" se guarda SOLA, aparte del botón "Guardar" de la
  // información general — pedido explícito tras un caso real: el docente la
  // marcó, nunca le dio "Guardar" y nunca supo que se quedó sin aplicar (no
  // sonó ninguna notificación de esa evaluación). Solo aplica editando una
  // evaluación que ya existe — una nueva todavía no tiene documento en
  // Firestore, así que ahí sigue viajando junto con la creación.
  const [savingNotificar, setSavingNotificar] = useState(false)
  async function handleToggleNotificar(checked) {
    setInfoForm((f) => ({ ...f, notificarDocente: checked }))
    if (isNew) return
    setSavingNotificar(true)
    try {
      await updateDoc(doc(db, 'activities', currentActivityId), { notificarDocente: checked })
      onActivityUpdated?.({ id: currentActivityId, notificarDocente: checked })
      // Ya quedó guardado — que el botón "Guardar" de abajo no se vea
      // habilitado por este cambio, que no tiene nada pendiente.
      if (loadedSnapshot.current !== null) {
        loadedSnapshot.current = JSON.stringify({ ...JSON.parse(loadedSnapshot.current), notificarDocente: checked })
      }
    } catch (err) {
      toast('No se pudo guardar: ' + err.message, 'error')
      setInfoForm((f) => ({ ...f, notificarDocente: !checked }))
    } finally {
      setSavingNotificar(false)
    }
  }

  // ── Save basic info (create or update) ───────────────────────────
  // asDraft: save hidden with NO publication — a borrador. It only becomes
  // published when the teacher publishes it (here or via the card's eye icon).
  async function handleSaveInfo(e, asDraft = false, exitAfter = true) {
    e.preventDefault()
    if (!htmlToPlainText(infoForm.instrucciones) && !infoForm.nombre.trim()) {
      toast('Escribe al menos el nombre de la evaluación', 'error'); return
    }
    const resolved = resolveVisibilidad({
      visibilidadMode: infoForm.visibilidadMode, publishedAt: infoForm.publishedAt,
      publishAt: infoForm.publishAt, fechaLimite: infoForm.fechaLimite, asDraft,
    })
    if (!resolved.ok) { toast(resolved.error, 'error'); return }
    const { mode, oculta, publishAt: resolvedPublishAt, publishedAt: newPublishedAt } = resolved

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
        recibirTarde: infoForm.fechaLimite ? !(infoForm.cerrarEntregasEnFecha ?? true) : false,
        oculta,
        publishAt: resolvedPublishAt,
        publishedAt: newPublishedAt,
        maxCalif: 10,
        notificarDocente: !!infoForm.notificarDocente,
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
        toast(
          asDraft
            ? (wasAlreadyPublished
              ? 'Evaluación regresada a borrador — ya no la ven tus estudiantes'
              : 'Borrador guardado — oculto para estudiantes')
            : wasDraft && mode === 'show' ? 'Evaluación publicada para estudiantes' : 'Cambios guardados'
        )
        if (!asDraft && wasAlreadyPublished) {
          toast('Esta evaluación ya estaba publicada — avisa a tus estudiantes sobre estos cambios.', 'warning')
        }
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
      return {
        ...base,
        opciones: form.opciones.map((o) => o.esOtra ? { id: o.id, texto: 'Otra', esOtra: true } : { id: o.id, texto: o.texto.trim() }),
        respuestaCorrecta: form.respuestaCorrecta,
      }
    if (form.tipo === 'verdadero_falso')
      return { ...base, opciones: [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }], respuestaCorrecta: form.vfRespuesta }
    return { ...base, opciones: null, respuestaCorrecta: null }
  }

  function validatePregunta(form) {
    if (!form.enunciado.trim()) { toast('Escribe el enunciado', 'error'); return false }
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

  async function syncNumPreguntas(total) {
    if (!currentActivityId) return
    await updateDoc(doc(db, 'activities', currentActivityId), { 'evaluacion.numPreguntas': total })
  }

  // ── Secciones (opcionales) ──────────────────────────────────────────────
  const seccionesCtl = useSecciones({
    activityId: currentActivityId,
    evaluacion: configForm,
    preguntas,
    setPreguntas,
    onCambio: (secciones) => setConfigForm((f) => ({ ...f, secciones })),
  })
  const [seccionDestino, setSeccionDestino] = useState(null)
  const grupos = agruparPreguntas(preguntas, seccionesCtl.secciones)
  const numeroDePregunta = {}
  preguntasEnOrden(preguntas, seccionesCtl.secciones).forEach((p, i) => { numeroDePregunta[p.id] = i + 1 })

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
      // El orden se cuenta DENTRO de su sección (ver utils/secciones.js).
      const orden = siguienteOrden(preguntas, seccionDestino)
      const data = {
        ...buildPreguntaData(preguntaForm), imagenUrl, orden, origenBancoId: null,
        ...seccionesCtl.camposDeSeccion(seccionDestino),
      }
      const nuevoId = await crearPregunta(currentActivityId, data)
      const updated = [...preguntas, { id: nuevoId, ...data }]
      setPreguntas(updated)
      setGlowId(nuevoId)
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
      setPreguntaForm(emptyPregunta()); setShowPreguntaForm(false)
      toast('Pregunta agregada')
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setSavingPregunta(false) }
  }

  function openEditPregunta(p) {
    setEditingPreguntaId(p.id)
    const opciones = opcionesFromExisting(p)
    const base = {
      tipo: p.tipo, enunciado: p.enunciado, retroalimentacion: p.retroalimentacion || '',
      opciones,
      respuestaCorrecta: p.tipo === 'opcion_multiple' ? (p.respuestaCorrecta || opciones[0]?.id || null) : 'a',
      vfRespuesta: p.tipo === 'verdadero_falso' ? (p.respuestaCorrecta || 'v') : 'v',
      ponderacion: p.ponderacion ?? 1, imagenFile: null,
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
      // Mover de sección: `orden` es relativo a su grupo, así que al cambiar
      // de sección hay que darle uno nuevo — el último del grupo destino — o
      // quedaría empatado con algún reactivo que ya estaba ahí.
      const antes = preguntas.find((p) => p.id === id)
      const seccionNueva = preguntaEditForm.seccionId || null
      const cambioDeSeccion = (antes?.seccionId || null) !== seccionNueva
      const camposSeccion = cambioDeSeccion
        ? { ...seccionesCtl.camposDeSeccion(seccionNueva), orden: siguienteOrden(preguntas.filter((p) => p.id !== id), seccionNueva) }
        : {}
      const data = { ...buildPreguntaData(preguntaEditForm), imagenUrl, ...camposSeccion }
      await actualizarPregunta(currentActivityId, id, data)
      setPreguntas((prev) => prev.map((p) => p.id === id ? { ...p, ...data } : p))
      setEditingPreguntaId(null); setGlowId(id); toast('Pregunta actualizada')
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setSavingPregunta(false) }
  }

  // Sube o baja un reactivo DENTRO de su grupo (su sección, o el bloque
  // suelto): con las flechas nunca cambia de sección — para eso está el
  // selector de sección de su formulario.
  async function handleMovePregunta(id, direction) {
    const actual = preguntas.find((p) => p.id === id)
    const hermanas = preguntas
      .filter((p) => (p.seccionId || null) === (actual?.seccionId || null))
      .sort((x, y) => (x.orden ?? 0) - (y.orden ?? 0))
    const idx = hermanas.findIndex((p) => p.id === id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || swapIdx < 0 || swapIdx >= hermanas.length) return
    const a = hermanas[idx]
    const b = hermanas[swapIdx]
    const ordenA = b.orden ?? swapIdx
    const ordenB = a.orden ?? idx
    try {
      await Promise.all([
        updateDoc(doc(db, 'activities', currentActivityId, 'preguntas', a.id), { orden: ordenA }),
        updateDoc(doc(db, 'activities', currentActivityId, 'preguntas', b.id), { orden: ordenB }),
      ])
      setPreguntas((prev) => prev
        .map((p) => (p.id === a.id ? { ...p, orden: ordenA } : p.id === b.id ? { ...p, orden: ordenB } : p))
        .sort((x, y) => (x.orden ?? 0) - (y.orden ?? 0)))
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function handleDeletePregunta(id) {
    if (!confirm('¿Eliminar esta pregunta?')) return
    // Se lleva también su clave: si se quedara, sería un huérfano invisible.
    await borrarPregunta(currentActivityId, id)
    const updated = preguntas.filter((p) => p.id !== id)
    setPreguntas(updated)
    await syncNumPreguntas(updated.length)
    toast('Pregunta eliminada')
  }

  async function handleDuplicatePregunta(p) {
    const orden = siguienteOrden(preguntas, p.seccionId || null)
    const data = { ...p, enunciado: `${p.enunciado} (copia)`, orden, origenBancoId: null }
    delete data.id
    const nuevoId = await crearPregunta(currentActivityId, data)
    const updated = [...preguntas, { id: nuevoId, ...data }]
    setPreguntas(updated)
    setGlowId(nuevoId)
    await syncNumPreguntas(updated.length)
    toast('Pregunta duplicada')
  }

  async function handleAddFromBanco(item) {
    if (!currentActivityId) { toast('Guarda la información antes de agregar preguntas', 'error'); return }
    const orden = siguienteOrden(preguntas, seccionDestino)
    const data = { tipo: item.tipo, enunciado: item.enunciado, opciones: item.opciones || null,
      respuestaCorrecta: item.respuestaCorrecta || null, ponderacion: 1, retroalimentacion: null,
      imagenUrl: null, orden, origenBancoId: item.id }
    const nuevoId = await crearPregunta(currentActivityId, data)
    const updated = [...preguntas, { id: nuevoId, ...data }]
    setPreguntas(updated)
    setGlowId(nuevoId)
    await syncNumPreguntas(updated.length)
    toast('Pregunta agregada desde tu banco')
  }

  // Agregar varias reactivos del banco de un jalón (pedido explícito) — un
  // solo writeBatch en vez de un addDoc por pregunta.
  async function handleAddFromBancoMultiple(items) {
    if (!currentActivityId || !items.length) return
    setSavingPregunta(true)
    try {
      let orden = siguienteOrden(preguntas, seccionDestino)
      const lista = items.map((item) => ({
        tipo: item.tipo, enunciado: item.enunciado, opciones: item.opciones || null,
        respuestaCorrecta: item.respuestaCorrecta || null, ponderacion: 1, retroalimentacion: null,
        imagenUrl: null, orden: orden++, origenBancoId: item.id,
      }))
      // Sigue siendo un solo writeBatch (reactivo y clave van juntos dentro).
      const ids = await crearPreguntasEnLote(currentActivityId, lista)
      const nuevas = lista.map((data, i) => ({ id: ids[i], ...data }))
      const updated = [...preguntas, ...nuevas]
      setPreguntas(updated)
      await syncNumPreguntas(updated.length)
      setSelectedBancoIds(new Set())
      toast(`${items.length} pregunta${items.length > 1 ? 's' : ''} agregada${items.length > 1 ? 's' : ''} desde tu banco`)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setSavingPregunta(false) }
  }

  // "Repartir parejo" — pedido explícito: reparte los 10 puntos entre todas
  // las preguntas existentes en partes iguales, en vez de tener que calcular
  // y escribir la ponderación de cada una a mano.
  async function handleRepartirParejo() {
    if (!preguntas.length) return
    const values = repartirPonderacionParejo(preguntas.length)
    setSavingPregunta(true)
    try {
      const batch = writeBatch(db)
      preguntas.forEach((p, i) => batch.update(doc(db, 'activities', currentActivityId, 'preguntas', p.id), { ponderacion: values[i] }))
      await batch.commit()
      setPreguntas((prev) => prev.map((p, i) => ({ ...p, ponderacion: values[i] })))
      toast('Ponderación repartida en partes iguales')
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setSavingPregunta(false) }
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
    const opciones = opcionesFromExisting(item)
    const base = {
      tipo: item.tipo, enunciado: item.enunciado, tema: item.tema || '',
      opciones,
      respuestaCorrecta: item.tipo === 'opcion_multiple' ? (item.respuestaCorrecta || opciones[0]?.id || null) : 'a',
      vfRespuesta: item.tipo === 'verdadero_falso' ? (item.respuestaCorrecta || 'v') : 'v',
    }
    setBancoEditForm(base)
    setGlowId(null)
    // Bring the chosen reactivo to the top so the edit form is fully visible
    setTimeout(() => document.getElementById(`banco-item-${item.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60)
    bancoEditSnap.current = JSON.stringify(base)
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

  // Cada reactivo es su propio documento y se guarda solo (agregar, editar,
  // borrar, reordenar, traer del banco…), pero eso no se ve en pantalla: si
  // después de trabajar en las preguntas el botón grande sigue apagado, la
  // sensación es que nada se guardó. Con esto se enciende en cuanto la lista
  // cambia — presionarlo confirma y regresa a la asignatura. Se compara
  // contra la lista tal como se cargó, así que basta con deshacer un cambio
  // para que vuelva a apagarse.
  const preguntasTocadas = preguntasSnap.current !== null
    && JSON.stringify(preguntas) !== preguntasSnap.current

  return (
    <div className="fixed inset-0 z-50 bg-surface overflow-y-auto">
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 bg-accent text-white shadow-lg safe-top">
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
            {/* Aviso explícito de que se está configurando un borrador — sin
                esto no había forma de saberlo de un vistazo dentro del editor. */}
            {wasDraft && (
              <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-white/20 text-white text-xs font-semibold">
                (Borrador)
              </span>
            )}
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
                  required placeholder={`Ej: ${tipoLabel} parcial 1`}
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" />
              </div>
              {/* Default apagado: el docente elige, actividad por actividad,
                  cuáles quiere que le avisen. El push solo llega al celular
                  donde tenga instalada la app — se puede configurar desde
                  aquí o desde ahí, da igual dónde se edite la actividad. */}
              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded border border-outline-variant">
                <input
                  type="checkbox"
                  id="eval-notificar-docente"
                  checked={infoForm.notificarDocente ?? false}
                  onChange={(e) => handleToggleNotificar(e.target.checked)}
                  disabled={savingNotificar}
                  className="mt-1"
                />
                <label htmlFor="eval-notificar-docente" className="text-sm font-medium text-on-surface cursor-pointer flex-1">
                  Notificarme cuando entreguen esta evaluación
                  <span className="text-muted text-xs block mt-0.5">Aviso para el celular donde tengas instalada la app Evalúa Fácil, cada vez que un estudiante la finalice</span>
                  {/* Se guarda sola en cuanto se toca (ver handleToggleNotificar)
                      — ya no depende del botón "Guardar" de abajo. Solo al
                      crear una evaluación nueva viaja junto con el resto,
                      porque el documento todavía no existe. */}
                  {isNew && (
                    <span className="text-muted text-xs block mt-1">Se guarda junto con el resto al crear la evaluación</span>
                  )}
                </label>
              </div>

              <div>
                <p className="block text-sm font-medium text-muted mb-1">Instrucciones</p>
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
                  simple={IS_NATIVE_APP}
                />
              </div>
              <div>
                <p className="block text-sm font-medium text-muted mb-2">Visibilidad</p>
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
                  {/* Sub-opción de la fecha límite: va pegada al selector para que
                      se lea como parte de esa misma opción, no como una aparte. */}
                  {infoForm.fechaLimite && (
                    <div className="flex items-start gap-3 px-3 py-2.5 ml-4 border-l-2 border-outline-variant">
                      <input
                        type="checkbox"
                        id="cerrarEntregasEnFechaEval"
                        checked={infoForm.cerrarEntregasEnFecha ?? true}
                        onChange={(e) => setInfoForm(f => ({ ...f, cerrarEntregasEnFecha: e.target.checked }))}
                        className="mt-0.5"
                        data-tooltip="Desactivar para recibir tarde"
                      />
                      <label htmlFor="cerrarEntregasEnFechaEval" className="text-sm text-on-surface cursor-pointer">
                        Cerrar entregas.
                        <span data-tooltip="Desactivar para recibir tarde" className="text-muted text-xs block mt-0.5">Desactivar para recibir entregas (se marcarán como entregadas tarde).</span>
                      </label>
                      {(infoForm.cerrarEntregasEnFecha ?? true)
                        ? <Lock size={28} className="flex-shrink-0 self-stretch text-muted" strokeWidth={1.5} />
                        : <LockOpen size={28} className="flex-shrink-0 self-stretch text-muted" strokeWidth={1.5} />}
                    </div>
                  )}
                  {/* Prórrogas por estudiante ya otorgadas — mismo resumen que en
                      un entregable. Es la confirmación en pantalla de que
                      "Nueva fecha límite → Para algunos" quedó guardada. Colapsado
                      en <details> para no ocupar espacio de entrada: solo se consulta. */}
                  {(() => {
                    const grupos = groupExtensions(extensiones, extensionesMotivo, students)
                    if (!grupos.length) return null
                    return (
                      <details className="group mt-2">
                        <summary className="flex items-center gap-1 text-sm text-accent cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                          <ChevronRight size={14} className="flex-shrink-0 transition-transform group-open:rotate-90" />
                          Prórrogas otorgadas ({grupos.length})
                        </summary>
                        <div className="mt-2 space-y-2">
                          {grupos.map((g, i) => (
                            <div key={i} className="p-3 bg-amber-50 rounded border border-amber-200 text-sm">
                              <p className="font-medium text-on-surface flex items-center gap-1.5">
                                <CalendarDays size={14} className="text-amber-600 flex-shrink-0" />
                                Prórroga hasta {formatDeadline(g.date)}
                              </p>
                              <p className="text-xs text-muted mt-1">Para: {g.names.join(', ')}</p>
                              {g.motivo && <p className="text-xs text-muted mt-0.5">Motivo: {g.motivo}</p>}
                            </div>
                          ))}
                        </div>
                      </details>
                    )
                  })()}
                  {/* Evaluación publicada: prorrogar la fecha para todo el grupo o
                      para estudiantes específicos — mismo modal que un entregable. */}
                  {!isNew && infoForm.publishedAt && (
                    <button
                      type="button"
                      onClick={() => setNewDateOpen(true)}
                      className="w-full mt-2 py-2 text-sm border border-accent text-accent rounded hover:bg-[var(--accent-tint)] transition-colors flex items-center justify-center gap-2"
                    >
                      <CalendarDays size={16} /> Nueva fecha para prórroga
                    </button>
                  )}
                </div>
              )}
            </form>
          )}
        </div>

        {/* Vista previa: la evaluación exactamente como la verá el estudiante
            antes de empezarla (resumen — no un simulacro de cada reactivo). */}
        <button type="button" onClick={() => setPreview((v) => !v)}
          className="w-full py-2 text-sm text-accent font-medium flex items-center justify-center gap-1.5 hover:underline">
          {preview ? <EyeOff size={16} /> : <Eye size={16} />}
          {preview ? 'Ocultar vista del estudiante' : 'Ver cómo vería el estudiante esta evaluación'}
        </button>
        {preview && (
          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
            <h2 className="text-lg font-bold text-on-surface">{infoForm.nombre || 'Evaluación sin nombre'}</h2>
            {infoForm.instrucciones && (
              <div>
                <h3 className="text-sm font-semibold text-on-surface mb-1">Instrucciones</h3>
                <div
                  className={`text-sm text-on-surface leading-relaxed break-words [overflow-wrap:anywhere] ${richTextContentClass}`}
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(toRichHtml(infoForm.instrucciones)) }}
                />
              </div>
            )}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-on-surface">Resumen</h3>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted flex items-center gap-1.5"><ListChecks size={16} /> Número de preguntas</span>
                <span className="font-semibold text-on-surface">{configForm.numPreguntas || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted flex items-center gap-1.5"><Timer size={16} /> Tiempo disponible</span>
                <span className="font-semibold text-on-surface">{configForm.tiempoLimiteMin ? `${configForm.tiempoLimiteMin} min` : 'Sin límite'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted flex items-center gap-1.5"><RotateCcw size={16} /> Intentos</span>
                <span className="font-semibold text-on-surface">{configForm.intentosPermitidos ? configForm.intentosPermitidos : 'Ilimitados'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Navegación</span>
                <span className="font-semibold text-on-surface">{configForm.navegacion === 'secuencial' ? 'Secuencial — no puede regresar' : 'Libre'}</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Acciones de la información general — arriba de Configuración:
            Configuración tiene su propio guardar y los reactivos se guardan
            individualmente ── */}
        <div className="space-y-2">
          {wasDraft && infoForm.visibilidadMode === 'hide' ? (
            // Draft with "Borrador" selected: save-and-keep-editing or save-and-exit
            <>
              <button type="button" disabled={savingInfo || (!isDirty && !preguntasTocadas)}
                onClick={() => handleSaveInfo({ preventDefault: () => {} }, true, false)}
                className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
                {savingInfo ? <Spinner size="sm" /> : null}
                {savingInfo ? 'Guardando…' : 'Guardar borrador y seguir editando'}
              </button>
              <button type="button" disabled={savingInfo || (!isDirty && !preguntasTocadas)}
                onClick={() => handleSaveInfo({ preventDefault: () => {} }, true, true)}
                className="w-full py-2.5 border border-accent text-accent font-medium rounded-card hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                Guardar borrador y salir
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={savingInfo || (!wasDraft && !isNew && !isDirty && !preguntasTocadas)}
                onClick={() => handleSaveInfo({ preventDefault: () => {} })}
                className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
                {savingInfo ? <Spinner size="sm" /> : null}
                {savingInfo ? 'Guardando…' : wasDraft ? (infoForm.visibilidadMode === 'schedule' ? 'Guardar con la fecha programada' : 'Guardar y publicar ahora') : 'Guardar y regresar a la asignatura'}
              </button>
              {/* También cuando ya está publicada: una evaluación se puede
                  regresar a borrador. Ahí sí se pregunta antes, porque deja de
                  verse para los estudiantes (ver confirmDraft). */}
              {!wasDraft && (
                <button type="button" disabled={savingInfo}
                  onClick={() => {
                    if (infoForm.publishedAt) setConfirmDraft(true)
                    else handleSaveInfo({ preventDefault: () => {} }, true, false)
                  }}
                  className="w-full py-2.5 border border-accent text-accent font-medium rounded-card hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                  Guardar como borrador
                </button>
              )}
            </>
          )}
          {/* Aclaración corta, solo cuando el botón se encendió por las
              preguntas: lo que se trabajó ya está a salvo, el botón solo
              cierra el ciclo. */}
          {preguntasTocadas && !isDirty && !savingInfo && (
            <p className="text-xs text-muted text-center px-2">
              Tus preguntas ya quedaron guardadas — el botón te regresa a la asignatura.
            </p>
          )}
          {!isNew && (
            // With no changes, exiting is the natural action — it takes the primary style
            <button type="button" onClick={onClose} disabled={savingInfo}
              className={`w-full py-2.5 font-medium rounded-card transition-colors disabled:opacity-60 ${(!isDirty && !preguntasTocadas && (!wasDraft || infoForm.visibilidadMode === 'hide'))
                ? 'bg-accent text-white font-semibold hover:bg-accent-hover'
                : 'border border-outline-variant text-muted hover:bg-surface-container'}`}>
              {isDirty ? 'Salir sin guardar cambios' : 'Salir'}
            </button>
          )}
          {!isNew && onDeleteActivity && (
            <button type="button" onClick={onDeleteActivity} disabled={savingInfo}
              className="w-full py-2.5 text-error font-medium rounded-card hover:bg-red-50 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
              <Trash2 size={16} /> Eliminar actividad
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
              <Select
                id="config-orden-preguntas"
                label="Orden de las preguntas"
                value={configForm.ordenPreguntas}
                onChange={(v) => setConfigForm((f) => ({ ...f, ordenPreguntas: v }))}
                options={[
                  { value: 'creacion', label: 'Orden de creación' },
                  { value: 'aleatorio', label: 'Aleatorio' },
                ]}
              />
            </div>
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
            <div>
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
              </div>
            )}
            {/* Un diagnóstico o una encuesta: se contesta y se revisa, pero no
                vale para la boleta. Va aquí arriba porque cambia el sentido de
                todo lo de abajo (si no hay calificación, publicarla no aplica). */}
            <SinCalificacionConfig
              sinCalificacion={configForm.sinCalificacion}
              ponderarReactivos={configForm.ponderarReactivos}
              onChange={(cambio) => setConfigForm((f) => ({ ...f, ...cambio }))}
            />
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
            {/* Repartir parejo — pedido explícito: evita calcular a mano la
                ponderación de cada pregunta cuando se quiere el mismo peso
                para todas. */}
            {preguntas.length > 1 && Math.abs(ponderacionUsada - 10) >= 0.01 && (
              <button
                type="button"
                onClick={handleRepartirParejo}
                disabled={savingPregunta}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded border border-accent text-accent text-sm font-medium hover:bg-accent-tint transition-colors disabled:opacity-60"
              >
                <Scale size={15} /> Repartir 10 pts parejo entre las {preguntas.length} preguntas
              </button>
            )}
            {!currentActivityId ? (
              <p className="text-sm text-muted text-center py-4">Guarda la información de arriba para empezar a agregar preguntas.</p>
            ) : loadingPreguntas ? (
              <div className="flex justify-center py-6"><Spinner /></div>
            ) : (
              <>
                {preguntas.length === 0 && !showPreguntaForm && (
                  <p className="text-sm text-slate-400 text-center py-4">Aún no hay reactivos.</p>
                )}

                {grupos.map((grupo) => (
                  <div key={grupo.seccion?.id || 'sueltas'} className="space-y-3">
                    {grupo.seccion && (
                      <SeccionHeader
                        seccion={grupo.seccion}
                        total={grupo.preguntas.length}
                        primera={seccionesCtl.secciones[0]?.id === grupo.seccion.id}
                        ultima={seccionesCtl.secciones[seccionesCtl.secciones.length - 1]?.id === grupo.seccion.id}
                        disabled={savingPregunta || seccionesCtl.guardando}
                        onMover={(dir) => seccionesCtl.mover(grupo.seccion.id, dir)}
                        onEditar={() => seccionesCtl.setEditando(grupo.seccion)}
                        onEliminar={() => seccionesCtl.setPorBorrar(grupo.seccion)}
                        onAgregarReactivo={() => { setSeccionDestino(grupo.seccion.id); setShowPreguntaForm(true) }}
                      />
                    )}
                {grupo.preguntas.map((p) => (
                  <div key={p.id} id={`preg-item-${p.id}`} className="border rounded-card"
                    style={editingPreguntaId === p.id
                      ? { borderColor: 'var(--accent)', background: 'var(--accent-light)', borderWidth: 2 }
                      : p.id === glowId
                        ? { borderColor: 'var(--accent)', background: 'var(--accent-light)' }
                        : { borderColor: 'var(--outline-variant)' }}>
                    {editingPreguntaId === p.id ? (
                      <form onSubmit={(e) => handleSavePreguntaEdit(e, p.id)} className="p-4 space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>Editando · Pregunta {numeroDePregunta[p.id]}</p>
                        <SelectorSeccion
                          id={`preg-edit-seccion-${p.id}`}
                          secciones={seccionesCtl.secciones}
                          valor={preguntaEditForm.seccionId}
                          onChange={(v) => setPreguntaEditForm((f) => ({ ...f, seccionId: v }))}
                        />
                        <div>
                          <Select
                            id="preg-edit-tipo"
                            label="Tipo de pregunta"
                            value={preguntaEditForm.tipo}
                            onChange={(v) => setPreguntaEditForm((f) => ({ ...f, tipo: v }))}
                            options={TIPOS_PREGUNTA}
                          />
                        </div>
                        <div>
                          <label htmlFor="preg-edit-enunciado" className="block text-sm font-medium text-muted mb-1">Enunciado</label>
                          <textarea id="preg-edit-enunciado" value={preguntaEditForm.enunciado} onChange={(e) => setPreguntaEditForm((f) => ({ ...f, enunciado: e.target.value }))}
                            rows={2} required className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
                        </div>
                        {preguntaEditForm.tipo === 'opcion_multiple' && (
                          <OpcionesEditor
                            opciones={preguntaEditForm.opciones}
                            respuestaCorrecta={preguntaEditForm.respuestaCorrecta}
                            onChange={(next) => setPreguntaEditForm((f) => ({ ...f, opciones: next }))}
                            onChangeCorrecta={(id) => setPreguntaEditForm((f) => ({ ...f, respuestaCorrecta: id }))}
                            radioName={`ep-${p.id}`}
                          />
                        )}
                        {preguntaEditForm.tipo === 'opcion_multiple' && <p className="text-xs text-slate-400">Deja seleccionada la correcta</p>}
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
                            <p className="text-base font-semibold text-on-surface">{numeroDePregunta[p.id]}. {p.enunciado}</p>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button type="button" aria-label="Mover arriba" onClick={() => handleMovePregunta(p.id, 'up')} disabled={grupo.preguntas[0]?.id === p.id}
                              className="p-1.5 text-slate-400 hover:text-accent rounded disabled:opacity-40" data-tooltip="Mover arriba"><ChevronUp size={18} /></button>
                            <button type="button" aria-label="Mover abajo" onClick={() => handleMovePregunta(p.id, 'down')} disabled={grupo.preguntas[grupo.preguntas.length - 1]?.id === p.id}
                              className="p-1.5 text-slate-400 hover:text-accent rounded disabled:opacity-40" data-tooltip="Mover abajo"><ChevronDown size={18} /></button>
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
                  </div>
                ))}

                {showPreguntaForm ? (
                  <form onSubmit={handleAddPregunta} className="border-2 border-accent rounded-card p-4 space-y-3"
                    style={{ background: 'var(--accent-light)' }}>
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>Creando · Pregunta {preguntas.length + 1}</p>
                    <SelectorSeccion
                      id="preg-new-seccion"
                      secciones={seccionesCtl.secciones}
                      valor={seccionDestino}
                      onChange={setSeccionDestino}
                    />
                    <div>
                      <Select
                        id="preg-new-tipo"
                        label="Tipo de pregunta"
                        value={preguntaForm.tipo}
                        onChange={(v) => setPreguntaForm((f) => ({ ...f, tipo: v }))}
                        options={TIPOS_PREGUNTA}
                      />
                    </div>
                    <div>
                      <label htmlFor="preg-new-enunciado" className="block text-sm font-medium text-muted mb-1">Enunciado</label>
                      <textarea id="preg-new-enunciado" value={preguntaForm.enunciado} onChange={(e) => setPreguntaForm((f) => ({ ...f, enunciado: e.target.value }))}
                        rows={2} required className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
                      <ImageIcon size={15} /> Imagen opcional
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => setPreguntaForm((f) => ({ ...f, imagenFile: e.target.files?.[0] || null }))} />
                      {preguntaForm.imagenFile && <span className="text-xs text-accent">{preguntaForm.imagenFile.name}</span>}
                    </label>
                    {preguntaForm.tipo === 'opcion_multiple' && (
                      <OpcionesEditor
                        opciones={preguntaForm.opciones}
                        respuestaCorrecta={preguntaForm.respuestaCorrecta}
                        onChange={(next) => setPreguntaForm((f) => ({ ...f, opciones: next }))}
                        onChangeCorrecta={(id) => setPreguntaForm((f) => ({ ...f, respuestaCorrecta: id }))}
                        radioName="rc"
                      />
                    )}
                    {preguntaForm.tipo === 'opcion_multiple' && <p className="text-xs text-slate-400">Deja seleccionada la correcta</p>}
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
                      <button type="button" onClick={() => { setShowPreguntaForm(false); setSeccionDestino(null); setPreguntaForm(emptyPregunta()) }}
                        className="flex-1 py-2 text-sm text-muted">Cancelar</button>
                      <button type="submit" disabled={savingPregunta} className="flex-1 py-2 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">
                        {savingPregunta ? 'Guardando…' : 'Guardar pregunta'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="pt-2 mt-2 border-t border-outline-variant space-y-2">
                    {seccionesCtl.editando ? (
                      <SeccionForm
                        inicial={seccionesCtl.editando === 'nueva' ? null : seccionesCtl.editando}
                        guardando={seccionesCtl.guardando}
                        onGuardar={seccionesCtl.guardar}
                        onCancelar={() => seccionesCtl.setEditando(null)}
                      />
                    ) : (
                      <BotonAgregarSeccion
                        onClick={() => seccionesCtl.setEditando('nueva')}
                        disabled={!currentActivityId}
                      />
                    )}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setGlowId(null); setSeccionDestino(null); setShowPreguntaForm(true) }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm bg-accent text-white font-medium rounded-card">
                        <Plus size={15} /> Crear reactivo nuevo
                      </button>
                      <button type="button" onClick={() => { setShowBanco(true); loadBanco(); setSelectedBancoIds(new Set()) }}
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

        <div className="h-6 safe-bottom" />
      </div>

      {/* ── Banco modal ── */}
      {showBanco && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => { setShowBanco(false); setEditingBancoId(null); setGlowId(null) }} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-3xl rounded-t-card sm:rounded-card shadow-2xl flex flex-col" style={{height: 'min(90vh, 700px)'}}>
            {/* Header fijo */}
            <div className="p-4 border-b border-outline-variant flex-shrink-0">
              <h3 className="text-base font-semibold mb-3">Mi banco de reactivos</h3>
              <div className="flex gap-2">
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
              {/* Barra de selección múltiple — pedido explícito: agregar
                  varios reactivos de un jalón. */}
              {selectedBancoIds.size > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-muted flex-1">{selectedBancoIds.size} seleccionada{selectedBancoIds.size > 1 ? 's' : ''}</span>
                  <button type="button" onClick={() => setSelectedBancoIds(new Set())} className="text-xs text-muted px-2 py-1.5">
                    Quitar selección
                  </button>
                  <button
                    type="button"
                    disabled={savingPregunta}
                    onClick={() => {
                      const items = bancoFiltrado.filter((b) => selectedBancoIds.has(b.id))
                      handleAddFromBancoMultiple(items)
                      setShowBanco(false)
                    }}
                    className="text-xs font-medium bg-accent text-white rounded px-3 py-1.5 disabled:opacity-60"
                  >
                    Agregar {selectedBancoIds.size} a la evaluación
                  </button>
                </div>
              )}
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
                              radioName={`be-${item.id}`}
                              compact
                            />
                          )}
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
                            {/* Selección múltiple — pedido explícito, para
                                agregar varios reactivos de un jalón en vez
                                de uno a la vez. */}
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
                              {selectedBancoIds.has(item.id) ? <CheckSquare size={18} /> : <Square size={18} className="text-slate-300" />}
                            </button>
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

      {seccionesCtl.porBorrar && (
        <ConfirmarBorrarSeccion
          seccion={seccionesCtl.porBorrar}
          total={preguntas.filter((p) => p.seccionId === seccionesCtl.porBorrar.id).length}
          borrando={seccionesCtl.borrando}
          onConfirm={seccionesCtl.confirmarBorrado}
          onCancel={() => seccionesCtl.setPorBorrar(null)}
        />
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
            } else if (result.mode === 'algunos') {
              // Antes esta rama no existía: el modal escribía las prórrogas en
              // Firestore, se cerraba, y el editor seguía mostrando lo mismo.
              const nextExt = { ...extensiones }
              const nextMot = { ...extensionesMotivo }
              result.ids.forEach((id) => {
                nextExt[id] = result.date
                nextMot[id] = result.motivo || ''
              })
              setExtensiones(nextExt)
              setExtensionesMotivo(nextMot)
              onActivityUpdated?.({ id: currentActivityId, extensiones: nextExt, extensionesMotivo: nextMot })
            }
          }}
        />
      )}

      {/* Regresar a borrador algo ya publicado no es lo mismo que esconderlo
          con el ojito: pierde su fecha de publicación y su número, y deja de
          existir para el estudiante. Se pregunta antes, y se dice qué NO se
          pierde — los intentos y calificaciones siguen ahí. */}
      {confirmDraft && (
        <ConfirmModal
          title="¿Regresar esta evaluación a borrador?"
          message="Dejará de verse para tus estudiantes y perderá su fecha de publicación, como si nunca se hubiera publicado. Los intentos y calificaciones que ya tenga se conservan, y vuelven a verse cuando la publiques de nuevo."
          confirmLabel="Sí, guardar como borrador"
          busy={savingInfo}
          onConfirm={() => { setConfirmDraft(false); handleSaveInfo({ preventDefault: () => {} }, true, false) }}
          onCancel={() => setConfirmDraft(false)}
        />
      )}
    </div>
  )
}
