import { useState } from 'react'
import { collection, doc, serverTimestamp } from 'firebase/firestore'
// Escrituras a través del candado de suscripción vencida (ver utils/firestoreGuard.js).
import { addDoc, updateDoc } from '../utils/firestoreGuard'
import { db } from '../firebase'
import { useToast } from './Toast'
import Spinner from './Spinner'
import VisibilitySelect from './VisibilitySelect'
import RichTextEditor from './RichTextEditor'
import FileTypeSelect from './FileTypeSelect'
import { uploadToCloudinary } from '../utils/cloudinary'
import { sanitizeHtml, htmlToPlainText, toRichHtml, richTextContentClass } from '../utils/sanitizeHtml'
import { DEFAULT_FILE_TYPE, CUSTOM_FILE_TYPE, normalizeFileTypeKeys, parseCustomExts, fileTypesInstructions } from '../config/fileTypes'
import { ArrowLeft, Plus, Pencil, CalendarDays, ClipboardList, ListChecks, Eye, EyeOff, X, Lock, LockOpen, ChevronRight, Trash2, Sparkles, Paperclip } from 'lucide-react'
import InfoDisclosure from './ui/InfoDisclosure'
import ConfirmModal from './ConfirmModal'
import RubricaPicker from './rubrica/RubricaPicker'
import RubricaEditor from './rubrica/RubricaEditor'
import ListaCotejoEditor from './rubrica/ListaCotejoEditor'
import RubricaTable from './rubrica/RubricaTable'
import {
  snapshotRubrica, esCotejo, instrumentoColors,
  rubricaDesdePropuesta, cotejoDesdePropuesta, validarRubrica, trazaIA,
  MIN_CRITERIOS, MAX_CRITERIOS, MIN_NIVELES, MAX_NIVELES,
} from '../utils/rubrica'
import ConfirmacionCreditosModal from './ConfirmacionCreditosModal'
import useCreditosIA from '../hooks/useCreditosIA'
import EFDateTimePicker from './EFDateTimePicker'
import { formatDeadline, isActivityPublished, resolveVisibilidad, isDraftActivity } from '../utils/activityVisibility'
import { minDeadline, isoLocalFromDate } from '../utils/nowIso'
import { groupExtensions } from '../utils/extensiones'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'
import { IS_NATIVE_APP } from '../utils/platform'

const MAX_ATTACH = 15 * 1024 * 1024

// Returns ISO datetime string for "now + 2 hours", used as smart default for scheduled publication
function computeScheduleDefault() {
  return isoLocalFromDate(new Date(Date.now() + 2 * 60 * 60 * 1000))
}

// Full-screen editor for Entregable activities (file submission / mark-complete)
// and Observación activities (no student submission — the teacher observes and
// grades directly: actitud, exposición, participación…). Mirrors the visual
// pattern of EvaluacionEditor so all activity creation/editing feels consistent.
export default function EntregableEditor({
  activityId,         // null = new, string = editing existing
  parcial,
  categoria,          // 'entregable', 'observacion' or legacy value
  subjectId,
  docenteId,
  existingActivities,
  activityLabel,      // e.g. "1.3" — null when creating new
  onClose,
  onActivityCreated,
  onActivityUpdated,
  initialForm,        // pre-filled when editing
  initialExistingFiles,
  contextLine,        // e.g. "Cultura digital I - 1A — Profe Kike Méndez"
  onNuevaFecha,       // ActivityPage only: opens the "Nueva fecha de entrega" modal (todos/algunos).
                      // Provided only once the activity is published; absent when creating.
  externalFechaLimite, // activity.fechaLimite from the parent — keeps the form in sync when
                      // the modal changes the group deadline while this editor stays open.
  students,           // full roster — resolves names for the extensiones list below
  extensiones,        // activity.extensiones — read-only display, never edited here
  extensionesMotivo,  // activity.extensionesMotivo — read-only display, never edited here
  onDeleteActivity,   // ActivityPage only: abre la confirmación de borrado — ausente al crear
}) {
  const toast = useToast()
  // La actividad puede nacer DENTRO de este editor: "Generar con IA" necesita
  // una actividad padre en Firestore, y la guarda como borrador sin cerrar la
  // pantalla (ver guardarBorradorParaIA). A partir de ahí este editor edita esa
  // actividad, no crea otra — por eso el id efectivo, y no el prop, manda en
  // todo lo que escribe.
  const [createdId, setCreatedId] = useState(null)
  const effectiveActivityId = activityId || createdId
  const isNew = !effectiveActivityId
  // Observación: no file submission → file types and deadline don't apply,
  // and instructions are optional (the name alone often says it all).
  const isObservacion = categoria === 'observacion'

  const [form, setForm] = useState(initialForm || {
    nombre: '', instrucciones: '', fechaLimite: '',
    tiposArchivo: [DEFAULT_FILE_TYPE], extensionesCustom: '',
    oculta: false, publishAt: '', publishedAt: '', visibilidadMode: 'show',
    cerrarEntregasEnFecha: true,
    rubrica: null, rubricaId: null,
    // Comportamiento previo a este campo (23-ago-2026): el estudiante SIEMPRE
    // veía la rúbrica — default true para no cambiar nada en actividades ya
    // existentes que nunca guardaron este campo.
    rubricaVisibleAlumno: true,
    notificarDocente: false,
  })
  const [existingFiles, setExistingFiles] = useState(initialExistingFiles || [])
  const [newFiles, setNewFiles] = useState([])
  const [saving, setSaving] = useState(false)
  // Rúbrica de evaluación (solo entregables): banco + creación directa + vista previa
  const [rubricaPickerOpen, setRubricaPickerOpen] = useState(false)
  const [rubricaEditorOpen, setRubricaEditorOpen] = useState(false)
  const [rubricaPreview, setRubricaPreview] = useState(false)
  const [preview, setPreview] = useState(false)

  // ── Generar el instrumento con IA (OP-06 rúbrica / OP-07 lista de cotejo) ──
  // La regla arquitectónica es que una rúbrica SIEMPRE se deriva de su
  // actividad padre, así que el botón vive aquí —dentro del entregable o de la
  // observación— y nunca en el banco de rúbricas, donde no habría de qué
  // derivarla. Lo único que viaja al servidor es el id de la actividad: el
  // contexto lo lee él de Firestore.
  const creditosIA = useCreditosIA()
  const [iaTipo, setIaTipo] = useState(null)              // 'rubrica' | 'cotejo'
  const [iaConfirmando, setIaConfirmando] = useState(false)
  const [iaTrabajando, setIaTrabajando] = useState(false)
  const [iaPropuesta, setIaPropuesta] = useState(null)    // instrumento listo para editar
  const [iaGuardarPrimero, setIaGuardarPrimero] = useState(null)
  // Cuántos criterios/niveles pide el docente — se elige ANTES de reservar
  // créditos (dentro del mismo modal de confirmación) y viaja al servidor;
  // rubricaDesdePropuesta/cotejoDesdePropuesta fuerzan ese número exacto
  // aunque la IA regrese de más o de menos. Default = el mínimo permitido.
  const [iaNumCriterios, setIaNumCriterios] = useState(MIN_CRITERIOS)
  const [iaNumNiveles, setIaNumNiveles] = useState(MIN_NIVELES)
  // Texto libre opcional del docente ("que cada respuesta sea un criterio",
  // etc.) — viaja tal cual al servidor, que lo mete al prompt como una
  // preferencia a respetar, nunca como una instrucción que reemplace el
  // contexto real de la actividad.
  const [iaConsideraciones, setIaConsideraciones] = useState('')
  // Evidencia opcional para que la IA la considere al construir los
  // criterios (23-ago-2026, pedido de Kike: "si subo las hojas en PDF de
  // los ejercicios los considere") — hasta 5 imágenes, o 1 PDF, o 1 Word;
  // mismo tope y mismos formatos que ya acepta "Calificar con IA"
  // (functions/evidenciasEntrega.js). Se sube a Cloudinary recién al
  // confirmar, nunca antes — cancelar aquí no sube nada.
  const [iaEvidenciaArchivos, setIaEvidenciaArchivos] = useState([])
  const [iaSubiendoEvidencia, setIaSubiendoEvidencia] = useState(false)
  // Datos de la generación, para dejar la traza (T.8) en la copia que guarda
  // la actividad. No viajan al banco de rúbricas.
  const [iaOrigen, setIaOrigen] = useState(null)          // { clase, generadoEn }
  // Confirmación de "regresar a borrador" — solo se pide cuando la actividad
  // ya estaba publicada (ver el botón "Guardar como borrador").
  const [confirmDraft, setConfirmDraft] = useState(false)

  // Physical Android back button: this component is only mounted while open
  // (the parent conditionally renders it), so it mirrors the "Volver" button
  // unconditionally; the two rúbrica overlays close first when they're open.
  useBackHandler(onClose, true)
  useBackHandler(() => setRubricaPickerOpen(false), rubricaPickerOpen)
  useBackHandler(() => setRubricaEditorOpen(false), rubricaEditorOpen)

  // Este componente solo se monta mientras está abierto (lo controla el padre).
  useScrollLock(true)

  // The "Nueva fecha de entrega" modal (in ActivityPage) writes the group deadline
  // straight to Firestore while this editor stays open. Mirror that change into the
  // form so a later "Guardar cambios" doesn't overwrite it with the stale value.
  // Adjusting state during render (React's recommended pattern) instead of an effect.
  const [prevExternalFecha, setPrevExternalFecha] = useState(externalFechaLimite)
  if (externalFechaLimite !== undefined && externalFechaLimite !== prevExternalFecha) {
    setPrevExternalFecha(externalFechaLimite)
    setForm((f) => (f.fechaLimite === externalFechaLimite ? f : { ...f, fechaLimite: externalFechaLimite || '' }))
  }

  // Editing a saved draft: primary button becomes "Guardar y publicar" and
  // the secondary keeps it as a draft.
  const wasDraft = !isNew && !!initialForm && isDraftActivity(initialForm)

  // Was this activity already visible to students BEFORE this edit started?
  // Used to warn the teacher, on save, that students already saw the old
  // version and should be told about the changes.
  const wasAlreadyPublished = !isNew && !!initialForm && isActivityPublished(initialForm)

  // Dirty check: save buttons stay disabled while nothing changed. Publishing
  // a draft is an action by itself, so "Guardar y publicar" ignores it.
  // notificarDocente se excluye a propósito: se guarda sola al tocarla (ver
  // handleToggleNotificar) — que ya no cuente aquí para no dejar el botón
  // "Guardar" habilitado por algo que no tiene nada pendiente.
  const isDirty = isNew
    || JSON.stringify({ ...form, notificarDocente: null }) !== JSON.stringify({ ...initialForm, notificarDocente: null })
    || newFiles.length > 0
    || existingFiles.length !== (initialExistingFiles || []).length

  function addFiles(files) {
    const tooBig = files.find((f) => f.size > MAX_ATTACH)
    if (tooBig) { toast(`"${tooBig.name}" supera el máximo de 15 MB`, 'error'); return }
    setNewFiles((prev) => [...prev, ...files])
  }

  function removeFile(index) {
    if (index < existingFiles.length) {
      setExistingFiles((prev) => prev.filter((_, i) => i !== index))
    } else {
      setNewFiles((prev) => prev.filter((_, i) => i !== index - existingFiles.length))
    }
  }

  // "Notificarme" se guarda SOLA, aparte del botón "Guardar" de todo el
  // formulario — pedido explícito tras un caso real: el docente la marcó,
  // nunca le dio "Guardar" y nunca supo que se quedó sin aplicar (no sonó
  // ninguna notificación de esa actividad). Solo aplica editando una
  // actividad que ya existe — una nueva todavía no tiene documento en
  // Firestore, así que ahí sigue viajando junto con la creación.
  const [savingNotificar, setSavingNotificar] = useState(false)
  async function handleToggleNotificar(checked) {
    setForm((f) => ({ ...f, notificarDocente: checked }))
    if (isNew) return
    setSavingNotificar(true)
    try {
      await updateDoc(doc(db, 'activities', effectiveActivityId), { notificarDocente: checked })
      onActivityUpdated?.({ id: effectiveActivityId, notificarDocente: checked })
    } catch (err) {
      toast('No se pudo guardar: ' + err.message, 'error')
      setForm((f) => ({ ...f, notificarDocente: !checked }))
    } finally {
      setSavingNotificar(false)
    }
  }

  // asDraft: save hidden with NO publication — a borrador. It only becomes
  // published when the teacher publishes it (here or via the card's eye icon).
  // `cerrar` en false deja la pantalla abierta: lo usa "Generar con IA", que
  // necesita que la actividad exista en Firestore pero no debe sacar al
  // docente de lo que está haciendo. Devuelve el id de la actividad (o null si
  // no se pudo guardar) para que quien la llamó sepa si puede seguir.
  async function handleSave(e, asDraft = false, { cerrar = true } = {}) {
    e?.preventDefault?.()
    const tiposArchivo = normalizeFileTypeKeys(form.tiposArchivo)
    if (tiposArchivo.includes(CUSTOM_FILE_TYPE) && parseCustomExts(form.extensionesCustom).length === 0) {
      toast('Escribe al menos una extensión para "Personalizado"', 'error'); return
    }
    if (!isObservacion && !htmlToPlainText(form.instrucciones)) {
      toast('Escribe las instrucciones de la actividad', 'error'); return
    }
    const resolved = resolveVisibilidad({
      visibilidadMode: form.visibilidadMode, publishedAt: form.publishedAt,
      publishAt: form.publishAt, fechaLimite: form.fechaLimite, asDraft,
    })
    if (!resolved.ok) { toast(resolved.error, 'error'); return }
    const { mode, oculta, publishAt: resolvedPublishAt, publishedAt: newPublishedAt } = resolved

    setSaving(true)
    // Id de la actividad guardada — lo espera "Generar con IA" para saber si
    // ya puede seguir. Queda sin valor si el guardado falla.
    let guardadoId
    try {
      const uploaded = await Promise.all(
        newFiles.map(async (file) => ({
          url: await uploadToCloudinary(file, 'evalua-facil/instrucciones-adjuntos'),
          nombre: file.name, tamano: file.size,
        }))
      )
      const payload = {
        nombre: form.nombre.trim(),
        categoria: categoria || 'entregable',
        maxCalif: 10,
        instrucciones: sanitizeHtml(form.instrucciones),
        archivosAdjuntos: [...existingFiles, ...uploaded],
        fechaLimite: isObservacion ? null : (form.fechaLimite || null),
        tiposArchivo,
        extensionesCustom: tiposArchivo.includes(CUSTOM_FILE_TYPE) ? (form.extensionesCustom || '').trim() : '',
        oculta,
        publishAt: resolvedPublishAt,
        publishedAt: newPublishedAt,
        // The checkbox is worded as "cerrar en la fecha programada" (positive framing),
        // but the field the student-facing page actually reads is the inverse: recibirTarde.
        recibirTarde: isObservacion ? null : !(form.cerrarEntregasEnFecha ?? true),
        // La rúbrica se guarda como COPIA dentro de la actividad — editar o
        // borrar la del banco después no afecta esta actividad ni sus calificaciones.
        rubrica: form.rubrica || null,
        rubricaId: form.rubricaId || null,
        rubricaVisibleAlumno: form.rubricaVisibleAlumno !== false,
        notificarDocente: !!form.notificarDocente,
      }
      const tipo = isObservacion ? 'observacion' : 'archivo'
      if (isNew) {
        const orden = existingActivities.filter((a) => a.parcial === parcial).length + 1
        const ref = await addDoc(collection(db, 'activities'), {
          ...payload, tipo, parcial, orden,
          asignaturaId: subjectId, docenteId, createdAt: serverTimestamp(),
        })
        setCreatedId(ref.id)
        guardadoId = ref.id
        onActivityCreated?.({ id: ref.id, ...payload, tipo, parcial, orden, asignaturaId: subjectId, docenteId })
        toast(asDraft ? 'Borrador guardado — oculto para estudiantes' : 'Actividad creada')
      } else {
        await updateDoc(doc(db, 'activities', effectiveActivityId), payload)
        onActivityUpdated?.({ id: effectiveActivityId, ...payload })
        toast(
          asDraft
            ? (wasAlreadyPublished
              ? 'Actividad regresada a borrador — ya no la ven tus estudiantes'
              : 'Borrador guardado — oculto para estudiantes')
            : wasDraft && mode === 'show' ? 'Actividad publicada para estudiantes' : 'Actividad actualizada'
        )
        if (!asDraft && wasAlreadyPublished) {
          toast('Esta actividad ya estaba publicada — avisa a tus estudiantes sobre estos cambios.', 'warning')
        }
        guardadoId = effectiveActivityId
      }
      if (cerrar) onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      guardadoId = null
    } finally {
      setSaving(false)
    }
    return guardadoId
  }

  // ── Generación con IA ──────────────────────────────────────────────────────
  // Sin actividad padre no hay operación: si todavía no existe el documento,
  // se ofrece guardarla como borrador (que es justo lo que falta) en vez de
  // enseñar un botón que reventaría por falta de id.
  function pedirIA(tipo) {
    if (!effectiveActivityId) { setIaGuardarPrimero(tipo); return }
    setIaNumCriterios(MIN_CRITERIOS)
    setIaNumNiveles(MIN_NIVELES)
    setIaEvidenciaArchivos([])
    setIaTipo(tipo)
    setIaConfirmando(true)
  }

  // Evidencia opcional para "Generar rúbrica/lista de cotejo con IA" — hasta
  // 5 imágenes O 1 PDF O 1 Word (categorías excluyentes, mismo criterio que
  // "Archivos aceptados" del entregable). Rechaza mezclar tipos o exceder el
  // tope en vez de recortar en silencio, para que el docente sepa por qué.
  const EVIDENCIA_IMG_EXTS = ['jpg', 'jpeg', 'png']
  function extensionArchivo(file) {
    return file.name.split('.').pop().toLowerCase()
  }
  function addEvidenciaIA(files) {
    const lista = Array.from(files)
    const tooBig = lista.find((f) => f.size > MAX_ATTACH)
    if (tooBig) { toast(`"${tooBig.name}" supera el máximo de 15 MB`, 'error'); return }
    const noSoportado = lista.find((f) => {
      const ext = extensionArchivo(f)
      return !EVIDENCIA_IMG_EXTS.includes(ext) && ext !== 'pdf' && ext !== 'docx'
    })
    if (noSoportado) { toast(`"${noSoportado.name}" no es un formato soportado (JPG, PNG, PDF o Word)`, 'error'); return }
    const nuevos = [...iaEvidenciaArchivos, ...lista]
    const soloImagenes = nuevos.every((f) => EVIDENCIA_IMG_EXTS.includes(extensionArchivo(f)))
    if (!soloImagenes && nuevos.length > 1) {
      toast('Un PDF o un Word van solos — o hasta 5 imágenes, pero no mezclados', 'error'); return
    }
    if (soloImagenes && nuevos.length > 5) {
      toast('Hasta 5 imágenes por evidencia', 'error'); return
    }
    setIaEvidenciaArchivos(nuevos)
  }
  function removeEvidenciaIA(index) {
    setIaEvidenciaArchivos((prev) => prev.filter((_, i) => i !== index))
  }

  async function guardarBorradorYSeguir(tipo) {
    const id = await handleSave(null, true, { cerrar: false })
    if (!id) return            // el guardado avisó del problema con su propio toast
    setIaGuardarPrimero(null)
    setIaNumCriterios(MIN_CRITERIOS)
    setIaNumNiveles(MIN_NIVELES)
    setIaTipo(tipo)
    setIaConfirmando(true)
  }

  async function generarConIA() {
    setIaTrabajando(true)
    try {
      // Evidencia (si el docente adjuntó algo) se sube a Cloudinary AQUÍ,
      // recién al confirmar — nunca antes, para no dejar archivos huérfanos
      // si cancela. El servidor la lee con el mismo motor que "Calificar con
      // IA" (evidenciasEntrega.js) y la agrega al mensaje como imagen/PDF
      // nativo o texto extraído (Word).
      let archivosEvidencia = []
      if (iaEvidenciaArchivos.length) {
        setIaSubiendoEvidencia(true)
        try {
          archivosEvidencia = await Promise.all(
            iaEvidenciaArchivos.map(async (file) => ({
              url: await uploadToCloudinary(file, 'evalua-facil/ia-rubrica-evidencia'),
              nombre: file.name,
            }))
          )
        } finally {
          setIaSubiendoEvidencia(false)
        }
      }
      const r = await creditosIA.ejecutar(iaTipo, {
        // El id + cuántos criterios/niveles pidió el docente (elegido ANTES de
        // esta llamada, que es la que reserva créditos). El servidor lee la
        // actividad, comprueba que es de este docente y arma el contexto con
        // lo que hay guardado.
        actividadId: effectiveActivityId,
        asignaturaId: subjectId,
        asignaturaNombre: contextLine || '',
        numCriterios: iaNumCriterios,
        ...(iaTipo === 'rubrica' ? { numNiveles: iaNumNiveles } : {}),
        consideraciones: iaConsideraciones.trim(),
        archivos: archivosEvidencia,
      })
      // La IA propuso solo el contenido pedagógico; los números los pone EF
      // aquí, con el mismo reparto del editor, forzando el número EXACTO que
      // pidió el docente, y se validan con la misma función de siempre antes
      // de presentárselos.
      const propuesta = r?.resultado?.propuesta
      const instrumento = iaTipo === 'cotejo'
        ? cotejoDesdePropuesta(propuesta, iaNumCriterios)
        : rubricaDesdePropuesta(propuesta, iaNumCriterios, iaNumNiveles)
      const error = validarRubrica(instrumento)
      if (error) {
        // Se abre igual —es un borrador editable— pero sin fingir que cuadra.
        toast(`La propuesta necesita un ajuste tuyo: ${error}`, 'warning')
      }
      setIaPropuesta(instrumento)
      setIaOrigen({ clase: r?.resultado?.clase || (isObservacion ? 'observacion' : 'entregable'), generadoEn: new Date().toISOString() })
      setIaConfirmando(false)
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setIaTrabajando(false)
    }
  }

  const tipoLabel = { actividad: 'Entregable', tarea: 'Entregable', entregable: 'Entregable', observacion: 'Observación' }[categoria] || 'Entregable'

  return (
    <div className="fixed inset-0 z-50 bg-surface overflow-y-auto">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-accent text-white shadow-lg safe-top">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={onClose} aria-label="Volver" className="p-2 -ml-2 rounded hover:bg-white/10 transition-colors flex-shrink-0">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            {contextLine && <p className="text-xl font-bold text-white truncate">{contextLine}</p>}
            <p className="text-xs text-white/70 uppercase tracking-wide">{tipoLabel} — Parcial {parcial}</p>
            {/* Big name + number (only published activities have a label; drafts don't) */}
            <h1 className="text-2xl font-extrabold text-white truncate flex items-baseline gap-2">
              {activityLabel && <span className="text-white/90">{activityLabel}</span>}
              <span className="truncate">{form.nombre || `${isNew ? 'Nueva actividad' : 'Editar actividad'}`}</span>
            </h1>
            {/* Aviso explícito de que se está configurando un borrador — sin
                esto no había forma de saberlo de un vistazo dentro del editor. */}
            {wasDraft && (
              <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-white/20 text-white text-xs font-semibold">
                (Borrador)
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
            <div>
              <label htmlFor="ent-nombre" className="block text-sm font-medium text-muted mb-1">Nombre de la actividad</label>
              <input id="ent-nombre" type="text" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                required
                placeholder={isObservacion ? 'Ej: Actitud, Exposición de tema, Participación' : 'Ej: Tarea 1, Proyecto final'}
                className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" />
            </div>

            {/* Default apagado: el docente elige, actividad por actividad,
                cuáles quiere que le avisen. El push solo llega al celular
                donde tenga instalada la app — se puede configurar desde
                aquí o desde ahí, da igual dónde se edite la actividad. */}
            <div className="flex items-start gap-3 p-3 bg-slate-50 rounded border border-outline-variant">
              <input
                type="checkbox"
                id="ent-notificar-docente"
                checked={form.notificarDocente ?? false}
                onChange={(e) => handleToggleNotificar(e.target.checked)}
                disabled={savingNotificar}
                className="mt-1"
              />
              <div className="flex-1">
                <label htmlFor="ent-notificar-docente" className="text-sm font-medium text-on-surface cursor-pointer">
                  Notificarme cuando entreguen esta actividad
                </label>
                <InfoDisclosure className="mt-0.5">
                  <span className="text-muted text-xs block">Aviso para el celular donde tengas instalada la app Evalúa Fácil, cada vez que un estudiante la entregue</span>
                </InfoDisclosure>
                {/* Se guarda sola en cuanto se toca (ver handleToggleNotificar)
                    — ya no depende del botón "Guardar" de abajo. Solo al crear
                    una actividad nueva viaja junto con el resto, porque el
                    documento todavía no existe. */}
                {isNew && (
                  <span className="text-muted text-xs block mt-1">Se guarda junto con el resto al crear la actividad</span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted mb-1">
                Instrucciones{isObservacion && <span className="text-slate-400 font-normal"> (opcional)</span>}
              </label>
              <RichTextEditor
                value={form.instrucciones}
                onChange={(html) => setForm((f) => ({ ...f, instrucciones: html }))}
                placeholder={isObservacion ? 'Describe qué vas a observar y cómo lo calificas…' : 'Describe la tarea para tus estudiantes…'}
                attachments={[
                  ...existingFiles,
                  ...newFiles.map((f) => ({ nombre: f.name, tamano: f.size })),
                ]}
                onAttachFiles={addFiles}
                onRemoveAttachment={removeFile}
                simple={IS_NATIVE_APP}
              />
            </div>

            {!isObservacion && (
              <div>
                <FileTypeSelect
                  value={form.tiposArchivo}
                  onChange={(v) => setForm((f) => ({ ...f, tiposArchivo: v }))}
                  customExts={form.extensionesCustom}
                  onCustomChange={(v) => setForm((f) => ({ ...f, extensionesCustom: v }))}
                />
              </div>
            )}
          </div>

          {/* Rúbrica de evaluación: reutilizable desde el banco del docente. La
              actividad guarda su propia copia. También en observación —
              actitud, exposición o participación son justo lo que más se presta
              a evaluarse por criterios, no con un número al aire. */}
          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-on-surface flex items-center gap-1.5">
                  <ClipboardList size={16} className="text-accent" /> Rúbrica de evaluación
                  <span className="text-slate-400 font-normal">(opcional)</span>
                </h2>
                <InfoDisclosure className="mt-0.5">
                  <p className="text-xs text-muted">
                    Con una rúbrica calificas tocando el nivel de cada criterio y la
                    calificación sobre 10 se calcula sola. Tus estudiantes la ven desde
                    el inicio, para saber cómo serán evaluados.
                  </p>
                </InfoDisclosure>
              </div>
              {form.rubrica ? (
                <>
                  <div className={`flex items-center gap-3 rounded border px-3 py-2.5 ${instrumentoColors(form.rubrica).border} ${instrumentoColors(form.rubrica).bg}`}>
                    {esCotejo(form.rubrica)
                      ? <ListChecks size={20} className={`${instrumentoColors(form.rubrica).icon} flex-shrink-0`} />
                      : <ClipboardList size={20} className={`${instrumentoColors(form.rubrica).icon} flex-shrink-0`} />}
                    <div className="flex-1 min-w-0">
                      <p className={`text-[10px] font-bold uppercase tracking-wide ${instrumentoColors(form.rubrica).text}`}>
                        {esCotejo(form.rubrica) ? 'Lista de cotejo' : 'Rúbrica'}
                      </p>
                      <p className="text-sm font-semibold text-on-surface truncate">{form.rubrica.titulo}</p>
                      <p className="text-xs text-muted">
                        {esCotejo(form.rubrica)
                          ? `${form.rubrica.criterios?.length} criterios · lista de cotejo · sobre 10`
                          : `${form.rubrica.criterios?.length} criterios · ${form.rubrica.niveles?.length} niveles · se califica sobre 10`}
                      </p>
                    </div>
                    <button type="button"
                      onClick={() => setForm((f) => ({ ...f, rubrica: null, rubricaId: null }))}
                      aria-label="Quitar rúbrica" data-tooltip="Quitar rúbrica"
                      className="p-2 text-slate-400 hover:text-red-500 rounded flex-shrink-0">
                      <X size={17} />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setRubricaPreview((v) => !v)}
                      className="flex-1 py-2 text-sm border border-outline-variant text-muted rounded hover:border-accent hover:text-accent transition-colors flex items-center justify-center gap-1.5">
                      {rubricaPreview ? <EyeOff size={15} /> : <Eye size={15} />}
                      {rubricaPreview ? 'Ocultar' : 'Ver rúbrica'}
                    </button>
                    <button type="button" onClick={() => setRubricaPickerOpen(true)}
                      className="flex-1 py-2 text-sm border border-outline-variant text-muted rounded hover:border-accent hover:text-accent transition-colors">
                      Cambiar rúbrica
                    </button>
                  </div>
                  {rubricaPreview && <RubricaTable rubrica={form.rubrica} compact={!IS_NATIVE_APP} />}
                  {/* Visibilidad para el estudiante (23-ago-2026, pedido de
                      Kike) — SOLO decide si el alumno la ve en su pantalla;
                      el docente y la IA la siguen usando igual para calificar
                      en cualquier caso, esto no las oculta ni las desactiva. */}
                  <label className="flex items-center gap-2 text-sm text-on-surface cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.rubricaVisibleAlumno !== false}
                      onChange={(e) => setForm((f) => ({ ...f, rubricaVisibleAlumno: e.target.checked }))}
                      className="w-4 h-4 rounded border-outline-variant text-accent focus:ring-accent"
                    />
                    Permitir que los estudiantes vean {esCotejo(form.rubrica) ? 'la lista de cotejo' : 'la rúbrica'}
                  </label>
                </>
              ) : (
                <div className="space-y-2">
                  {/* Generar con IA a partir de ESTA actividad — el único lugar
                      desde donde puede generarse (el banco no tiene actividad
                      padre de la cual derivar los criterios). Solo en la web,
                      igual que crear rúbricas a mano. */}
                  {!IS_NATIVE_APP && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button type="button" onClick={() => pedirIA('rubrica')}
                        className="w-full py-2.5 text-sm bg-accent text-white font-semibold rounded hover:bg-accent-hover transition-colors flex items-center justify-center gap-2">
                        <Sparkles size={16} /> Generar rúbrica con IA
                      </button>
                      <button type="button" onClick={() => pedirIA('cotejo')}
                        className="w-full py-2.5 text-sm border-2 border-accent text-accent font-semibold rounded hover:bg-[var(--accent-tint)] transition-colors flex items-center justify-center gap-2">
                        <Sparkles size={16} /> Generar lista de cotejo con IA
                      </button>
                    </div>
                  )}
                  {!IS_NATIVE_APP && (
                    <p className="text-xs text-muted text-center">
                      {isObservacion
                        ? 'La IA propone los criterios a partir de lo que escribiste que vas a observar. Tú los revisas y los ajustas.'
                        : 'La IA propone los criterios a partir de las instrucciones de esta actividad. Tú los revisas y los ajustas.'}
                    </p>
                  )}
                  {/* Crear directo (banco Y asignación en un paso): solo en la web */}
                  {!IS_NATIVE_APP && (
                    <button type="button" onClick={() => setRubricaEditorOpen(true)}
                      className="w-full py-2 text-sm border border-outline-variant text-muted rounded hover:border-accent hover:text-accent transition-colors flex items-center justify-center gap-2">
                      <Plus size={16} /> Crear rúbrica a mano
                    </button>
                  )}
                  <button type="button" onClick={() => setRubricaPickerOpen(true)}
                    className="w-full py-2 text-sm border border-accent text-accent rounded hover:bg-[var(--accent-tint)] transition-colors flex items-center justify-center gap-2">
                    <ClipboardList size={16} /> Usar una rúbrica de mi banco
                  </button>
                </div>
              )}
          </div>

          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
            <div>
              <p className="block text-sm font-medium text-muted mb-2">Visibilidad</p>
              <VisibilitySelect
                mode={form.visibilidadMode}
                publishAt={form.publishAt}
                publishedAt={form.publishedAt}
                wasScheduled={!isNew && !!initialForm?.publishAt && !initialForm?.publishedAt}
                isDraft={wasDraft}
                onModeChange={(mode) => setForm((f) => ({
                  ...f, visibilidadMode: mode,
                  // 9.1: auto-fill publishAt with now+2h when switching to schedule for the first time
                  publishAt: mode === 'schedule' ? (f.publishAt || computeScheduleDefault()) : '',
                  // hiding a never-published draft clears the deadline; a published
                  // activity keeps it (hide is temporary, deadline still applies)
                  fechaLimite: mode === 'hide' && !f.publishedAt ? '' : f.fechaLimite,
                }))}
                onPublishAtChange={(v) => setForm((f) => ({ ...f, publishAt: v }))}
              />
            </div>

            {!isObservacion && (form.visibilidadMode !== 'hide' || form.publishedAt) && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">{form.fechaLimite ? 'Fecha límite de entrega' : 'Fecha límite (opcional)'}</label>
                  {form.visibilidadMode === 'schedule' && !form.publishAt ? (
                    <p className="text-xs text-slate-400 px-1">Primero elige la fecha de publicación arriba.</p>
                  ) : (
                    <EFDateTimePicker
                      mode="datetime"
                      headerLabel="Fecha y hora límite"
                      value={form.fechaLimite}
                      onChange={v => setForm(f => ({ ...f, fechaLimite: v }))}
                      placeholder="Sin fecha límite…"
                      clearable
                      defaultTime="23:59"
                      defaultDate={
                        // 9.2: open on publish date when no fechaLimite yet; fall back to today
                        (form.publishAt || form.publishedAt || '').split('T')[0] || undefined
                      }
                      minDateTime={minDeadline(
                        form.visibilidadMode === 'schedule' ? form.publishAt : form.publishedAt
                      )}
                    />
                  )}
                  {/* Sub-opción de la fecha límite: va pegada al selector para que
                      se lea como parte de esa misma opción, no como una aparte. */}
                  {form.fechaLimite && (
                    <div className="flex items-start gap-3 px-3 py-2.5 ml-4 border-l-2 border-outline-variant">
                      <input
                        type="checkbox"
                        id="cerrarEntregasEnFecha"
                        checked={form.cerrarEntregasEnFecha ?? true}
                        onChange={(e) => setForm(f => ({ ...f, cerrarEntregasEnFecha: e.target.checked }))}
                        className="mt-0.5"
                        data-tooltip="Desactivar para recibir tarde"
                      />
                      <label htmlFor="cerrarEntregasEnFecha" className="text-sm text-on-surface cursor-pointer">
                        Cerrar entregas.
                        <span data-tooltip="Desactivar para recibir tarde" className="text-muted text-xs block mt-0.5">Desactivar para recibir entregas (se marcarán como entregadas tarde).</span>
                      </label>
                      {(form.cerrarEntregasEnFecha ?? true)
                        ? <Lock size={28} className="flex-shrink-0 self-stretch text-muted" strokeWidth={1.5} />
                        : <LockOpen size={28} className="flex-shrink-0 self-stretch text-muted" strokeWidth={1.5} />}
                    </div>
                  )}
                </div>

                {/* Read-only: who currently has a per-student extension, to when, and
                    why — grouped from `extensiones`/`extensionesMotivo` since a single
                    "Nueva fecha límite" action writes the same date+motivo to everyone
                    selected. Managed from the modal below; not editable here. Colapsado
                    en <details> para no ocupar espacio de entrada: solo se consulta. */}
                {(() => {
                  const grupos = groupExtensions(extensiones, extensionesMotivo, students)
                  if (!grupos.length) return null
                  return (
                    <details className="group">
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

                {/* Published activity: extend the deadline for the whole group or for
                    specific students who fell behind — opens the modal in ActivityPage. */}
                {onNuevaFecha && (
                  <button
                    type="button"
                    onClick={onNuevaFecha}
                    className="w-full py-2 text-sm border border-accent text-accent rounded hover:bg-[var(--accent-tint)] transition-colors flex items-center justify-center gap-2"
                  >
                    <CalendarDays size={16} /> Nueva fecha para prórroga
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Vista previa: la actividad exactamente como la verá el estudiante */}
          <button type="button" onClick={() => setPreview((v) => !v)}
            className="w-full py-2 text-sm text-accent font-medium flex items-center justify-center gap-1.5 hover:underline">
            {preview ? <EyeOff size={16} /> : <Eye size={16} />}
            {preview ? 'Ocultar vista del estudiante' : 'Ver cómo vería el estudiante esta actividad'}
          </button>
          {preview && (
            <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
              <h2 className="text-lg font-bold text-on-surface">{form.nombre || `${isObservacion ? 'Observación' : 'Entregable'} sin nombre`}</h2>
              {form.instrucciones && (
                <div>
                  <h3 className="text-sm font-semibold text-on-surface mb-1">Instrucciones</h3>
                  <div
                    className={`text-sm text-on-surface leading-relaxed break-words [overflow-wrap:anywhere] ${richTextContentClass}`}
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(toRichHtml(form.instrucciones)) }}
                  />
                </div>
              )}
              {!isObservacion && form.fechaLimite && (
                <p className="text-sm text-muted flex items-center gap-1.5">
                  <CalendarDays size={15} className="flex-shrink-0" /> Fecha límite: <span className="font-medium text-on-surface">{formatDeadline(form.fechaLimite)}</span>
                </p>
              )}
              {!isObservacion && (
                <div>
                  <h3 className="text-sm font-semibold text-on-surface mb-1">Archivos permitidos</h3>
                  <ul className="text-sm text-muted list-disc pl-5">
                    {fileTypesInstructions(form.tiposArchivo, form.extensionesCustom).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              {form.rubrica && <RubricaTable rubrica={form.rubrica} compact={!IS_NATIVE_APP} />}
            </div>
          )}

          {wasDraft && form.visibilidadMode === 'hide' ? (
            // Draft with "Borrador" selected: the only save action keeps it as draft
            <button type="button" onClick={(e) => handleSave(e, true)} disabled={saving || !isDirty}
              className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
              {saving ? <Spinner size="sm" /> : <Pencil size={18} />}
              {saving ? 'Guardando…' : 'Guardar borrador y salir'}
            </button>
          ) : (
            <>
              <button type="submit" disabled={saving || (!wasDraft && !isDirty)}
                className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? <Spinner size="sm" /> : isNew ? <Plus size={18} /> : <Pencil size={18} />}
                {saving ? 'Guardando…' : isNew ? 'Crear actividad' : wasDraft ? (form.visibilidadMode === 'schedule' ? 'Guardar con la fecha programada' : 'Guardar y publicar ahora') : 'Guardar cambios'}
              </button>
              {/* También cuando ya está publicada: una actividad se puede
                  regresar a borrador. Ahí sí se pregunta antes, porque deja de
                  verse para los estudiantes (ver confirmDraft). */}
              {!wasDraft && (
                <button
                  type="button"
                  onClick={(e) => { if (form.publishedAt) setConfirmDraft(true); else handleSave(e, true) }}
                  disabled={saving}
                  className="w-full py-2.5 border border-accent text-accent font-medium rounded-card hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                  Guardar como borrador
                </button>
              )}
            </>
          )}
          {!isNew && (
            // With no changes, exiting is the natural action — it takes the primary style
            <button type="button" onClick={onClose} disabled={saving}
              className={`w-full py-2.5 font-medium rounded-card transition-colors disabled:opacity-60 ${(!isDirty && (!wasDraft || form.visibilidadMode === 'hide'))
                ? 'bg-accent text-white font-semibold hover:bg-accent-hover'
                : 'border border-outline-variant text-muted hover:bg-surface-container'}`}>
              {isDirty ? 'Salir sin guardar cambios' : 'Salir'}
            </button>
          )}
          {!isNew && onDeleteActivity && (
            <button type="button" onClick={onDeleteActivity} disabled={saving}
              className="w-full py-2.5 text-error font-medium rounded-card hover:bg-red-50 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
              <Trash2 size={16} /> Eliminar actividad
            </button>
          )}
          <div className="h-6 safe-bottom" />
        </form>
      </div>

      {/* Banco de rúbricas: elegir/crear una guarda una COPIA en el form */}
      {rubricaPickerOpen && (
        <RubricaPicker
          docenteId={docenteId}
          currentRubricaId={form.rubricaId}
          onClose={() => setRubricaPickerOpen(false)}
          onSelect={(r) => {
            setForm((f) => ({ ...f, rubrica: snapshotRubrica(r), rubricaId: r.id }))
            setRubricaPickerOpen(false)
          }}
        />
      )}

      {/* Creación directa: guarda la rúbrica en el banco y la asigna a esta actividad */}
      {rubricaEditorOpen && (
        <RubricaEditor
          initial={null}
          docenteId={docenteId}
          onClose={() => setRubricaEditorOpen(false)}
          onSaved={(saved) => {
            setForm((f) => ({ ...f, rubrica: snapshotRubrica(saved), rubricaId: saved.id }))
          }}
        />
      )}

      {/* La actividad todavía no existe: lo que falta es guardarla, y eso es lo
          que se ofrece — nunca un botón que falle por no tener id. */}
      {iaGuardarPrimero && (
        <ConfirmModal
          title="Primero guardo la actividad"
          message={`La IA construye ${iaGuardarPrimero === 'cotejo' ? 'la lista de cotejo' : 'la rúbrica'} a partir de esta actividad, así que necesita que ya esté guardada. La guardo como borrador —oculta para tus estudiantes— y seguimos.`}
          confirmLabel="Guardar borrador y continuar"
          confirmingLabel="Guardando…"
          busy={saving}
          onConfirm={() => guardarBorradorYSeguir(iaGuardarPrimero)}
          onCancel={() => { if (!saving) setIaGuardarPrimero(null) }}
        />
      )}

      {iaConfirmando && (
        <ConfirmacionCreditosModal
          titulo={iaTipo === 'cotejo' ? 'Generar la lista de cotejo con IA' : 'Generar la rúbrica con IA'}
          descripcion={isObservacion
            ? 'El asistente propondrá criterios observables a partir de esta actividad; tú los revisas, los editas y decides.'
            : 'El asistente propondrá los criterios a partir de las instrucciones de esta actividad; tú los revisas, los editas y decides.'}
          costoMin={creditosIA.estimar(iaTipo) ?? 1}
          ejecutando={iaTrabajando}
          onCancelar={() => { if (!iaTrabajando) { setIaConfirmando(false); setIaTipo(null) } }}
          onContinuar={generarConIA}
        >
          {/* Se elige ANTES de tocar el botón Continuar, que es el que reserva
              créditos — cancelar aquí no cuesta nada. Controles mínimos: dos
              selects con el default ya puesto en el mínimo permitido. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="ia-num-criterios" className="text-sm text-on-surface">¿Cuántos criterios quieres?</label>
              <select
                id="ia-num-criterios"
                value={iaNumCriterios}
                disabled={iaTrabajando}
                onChange={(e) => setIaNumCriterios(Number(e.target.value))}
                className="px-2 py-1 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {Array.from({ length: MAX_CRITERIOS - MIN_CRITERIOS + 1 }, (_, i) => MIN_CRITERIOS + i).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            {iaTipo === 'rubrica' && (
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="ia-num-niveles" className="text-sm text-on-surface">¿Cuántos niveles de desempeño quieres?</label>
                <select
                  id="ia-num-niveles"
                  value={iaNumNiveles}
                  disabled={iaTrabajando}
                  onChange={(e) => setIaNumNiveles(Number(e.target.value))}
                  className="px-2 py-1 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {Array.from({ length: MAX_NIVELES - MIN_NIVELES + 1 }, (_, i) => MIN_NIVELES + i).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="ia-consideraciones" className="text-sm text-on-surface block mb-1">
                Consideraciones (opcional)
              </label>
              <textarea
                id="ia-consideraciones"
                value={iaConsideraciones}
                disabled={iaTrabajando}
                onChange={(e) => setIaConsideraciones(e.target.value)}
                placeholder="Por ejemplo: que cada respuesta del ejercicio sea un criterio de evaluación"
                rows={2}
                maxLength={400}
                className="w-full px-2 py-1.5 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none"
              />
            </div>
            <div>
              <span className="text-sm text-on-surface block mb-1">Evidencia (opcional)</span>
              <p className="text-xs text-muted mb-1.5">
                Por ejemplo las hojas del ejercicio en PDF — la IA las considera al proponer los criterios.
                Hasta 5 imágenes, o 1 PDF, o 1 Word.
              </p>
              {iaEvidenciaArchivos.length > 0 && (
                <ul className="space-y-1 mb-1.5">
                  {iaEvidenciaArchivos.map((file, i) => (
                    <li key={`${file.name}-${i}`} className="flex items-center justify-between gap-2 px-2 py-1 bg-surface-container rounded text-xs text-on-surface">
                      <span className="truncate">{file.name}</span>
                      <button type="button" onClick={() => removeEvidenciaIA(i)} disabled={iaTrabajando}
                        className="flex-shrink-0 text-muted hover:text-error disabled:opacity-60">
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <label className={`flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-dashed border-outline-variant rounded cursor-pointer hover:bg-surface-container transition-colors ${iaTrabajando ? 'opacity-60 pointer-events-none' : ''}`}>
                <Paperclip size={14} /> Adjuntar archivo
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf,.docx"
                  multiple
                  disabled={iaTrabajando}
                  onChange={(e) => { if (e.target.files.length) addEvidenciaIA(e.target.files); e.target.value = '' }}
                  className="hidden"
                />
              </label>
              {iaSubiendoEvidencia && <p className="text-xs text-muted mt-1">Subiendo evidencia…</p>}
            </div>
          </div>
        </ConfirmacionCreditosModal>
      )}

      {/* La propuesta entra al editor de siempre como borrador editable: la IA
          nunca guarda nada por su cuenta. Al guardarla va al banco y queda
          asignada a esta actividad por el mismo camino de siempre. */}
      {iaPropuesta && (() => {
        // La traza (T.8) se agrega a la COPIA de la actividad, nunca al banco:
        // el documento del banco lo escribe el propio editor y se queda igual
        // que cualquier rúbrica hecha a mano.
        const guardarConTraza = (saved) => setForm((f) => ({
          ...f,
          rubrica: {
            ...snapshotRubrica(saved),
            ia: trazaIA({
              operacion: iaTipo,
              actividadPadreId: effectiveActivityId,
              clase: iaOrigen?.clase || null,
              propuesta: iaPropuesta,
              guardada: saved,
              generadoEn: iaOrigen?.generadoEn || null,
            }),
          },
          rubricaId: saved.id,
        }))
        const cerrar = () => { setIaPropuesta(null); setIaTipo(null); setIaOrigen(null) }
        return iaTipo === 'cotejo' ? (
          <ListaCotejoEditor initial={iaPropuesta} docenteId={docenteId} onClose={cerrar} onSaved={guardarConTraza} iaGenerada />
        ) : (
          <RubricaEditor initial={iaPropuesta} docenteId={docenteId} onClose={cerrar} onSaved={guardarConTraza} iaGenerada />
        )
      })()}

      {/* Regresar a borrador algo ya publicado no es lo mismo que esconderlo
          con el ojito: pierde su fecha de publicación y su número, y deja de
          existir para el estudiante. Se pregunta antes, y se dice qué NO se
          pierde — lo que ya entregaron sigue ahí. */}
      {confirmDraft && (
        <ConfirmModal
          title="¿Regresar esta actividad a borrador?"
          message="Dejará de verse para tus estudiantes y perderá su fecha de publicación, como si nunca se hubiera publicado. Las entregas y calificaciones que ya tenga se conservan, y vuelven a verse cuando la publiques de nuevo."
          confirmLabel="Sí, guardar como borrador"
          busy={saving}
          onConfirm={() => { setConfirmDraft(false); handleSave({ preventDefault: () => {} }, true) }}
          onCancel={() => setConfirmDraft(false)}
        />
      )}
    </div>
  )
}
