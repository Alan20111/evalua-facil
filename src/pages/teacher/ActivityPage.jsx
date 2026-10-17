import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore'
// Escrituras a través del candado de suscripción vencida (ver utils/firestoreGuard.js).
import { updateDoc, deleteDoc, writeBatch } from '../../utils/firestoreGuard'
import { deleteSubmissionsByActivity } from '../../utils/deleteSubjectCascade'
import { httpsCallable } from 'firebase/functions'
import { db, auth, functions } from '../../firebase'
import { submissionDocId } from '../../utils/submissionId'
import { ORIGEN_DOCENTE, calificacionEsDeIA } from '../../utils/evaluacionGrading'
import Checkbox from '../../components/ui/Checkbox'
import { EntregaCambio, crearSiNoExiste, actualizarSiNoCambio, borrarSiNoCambio, datosTrazaAnulacionDocente } from '../../utils/submissionGuard'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import { Trash2 } from 'lucide-react'
import { buildJobsForActivity, downloadSubmissionsZip } from '../../utils/downloadSubmissions'
import { subjectDisplayName } from '../../utils/subjectName'
import { IS_NATIVE_APP } from '../../utils/platform'
import { descargaSoloWeb } from '../../utils/descargaSoloWeb'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import EFDateTimePicker from '../../components/EFDateTimePicker'
import { nowIsoLocal } from '../../utils/nowIso'
import { fechaLimiteTimestamp } from '../../utils/deadline'
import { estadoEntrega } from '../../utils/estadoEntrega'
import { tieneEntregaReal, leerEntregasReales, MENSAJE_PRORROGA_CON_ENTREGA } from '../../utils/extensiones'
import { withDefaultTime, cuentaParaCalificacion } from '../../utils/activityVisibility'
import { parcialCerrado as esParcialCerrado, mensajeParcialCerrado } from '../../utils/ponderacion'
import { normalizeFileTypeKeys } from '../../config/fileTypes'
import { matchesStudentSearch, studentFullName } from '../../utils/studentSearch'
import EntregableEditor from '../../components/EntregableEditor'
import NuevaFechaEntregaModal from '../../components/NuevaFechaEntregaModal'
import RubricaGradeTable from '../../components/rubrica/RubricaGradeTable'
import CalificarConIAModal from '../../components/rubrica/CalificarConIAModal'
import ConfirmacionCreditosModal from '../../components/ConfirmacionCreditosModal'
import ConfirmModal from '../../components/ConfirmModal'
import { ClipboardList, ListChecks, X } from 'lucide-react'
import { totalRubrica, RUBRICA_TOTAL, esCotejo, instrumentoColors } from '../../utils/rubrica'
import useCreditosIA from '../../hooks/useCreditosIA'
import { useBackHandler } from '../../hooks/useBackHandler'
import useTelefonoWeb from '../../hooks/useTelefonoWeb'
import { useScrollLock } from '../../hooks/useScrollLock'
import { EsqueletoActividadDocente } from '../../components/esqueletos'
import { Button, IconButton, Modal } from '../../components/ui'
import { ICONO } from '../../config/iconos'


import { isEvidenciaSoportada, isImageFile, normRubricaEval, submissionFiles } from './activity/utilidades'
import ListaEntregas from './activity/ListaEntregas'
import PanelCalificar from './activity/PanelCalificar'
import PanelCalificarMovil from './activity/PanelCalificarMovil'
import { ContextoActividad } from './activity/contexto'
export default function ActivityPage() {
  const { activityId } = useParams()
  // Teléfono abierto en el navegador (siempre false en la app y en escritorio):
  // ahí Evaluar muestra el resultado/estado de cada estudiante, sin la entrega.
  const telefonoWeb = useTelefonoWeb()
  const [activity, setActivity] = useState(null)
  const [activityLabel, setActivityLabel] = useState(null)
  // "Nueva fecha de entrega" modal, offered from within the activity editor
  const [newDateOpen, setNewDateOpen] = useState(false)
  // Eliminar actividad — disponible desde la propia edición, para entregable/
  // observación y evaluación por igual, incluidos borradores. Pedido explícito.
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deletingActivity, setDeletingActivity] = useState(false)
  const [subject, setSubject] = useState(null)
  const [students, setStudents] = useState([])
  const [submissions, setSubmissions] = useState({})
  // Entregas que el estudiante anuló por su cuenta, por alumnoId (trazabilidad)
  const [anuladasPorAlumno, setAnuladasPorAlumno] = useState({})
  const [filter, setFilter] = useState('todos')
  const [selected, setSelected] = useState(null)
  // Full grading view overlay: locks background scroll while it's open.
  useScrollLock(selected)
  // Navigation order frozen when the grading view opens — autosaving a grade can
  // remove the student from the active filter (e.g. "Por calificar"), which would
  // otherwise reshuffle Anterior/Siguiente mid-session.
  const [navList, setNavList] = useState([])
  // Which file of a multi-photo submission is showing in the preview pane.
  // -1 = ALL images stacked (scrollable) — the default overview.
  const [previewIdx, setPreviewIdx] = useState(-1)
  // Real page count of the PDF currently shown in the WEB grading overlay.
  // null = not yet determined (PDF still loading or file is not a PDF).
  // Only set by FilePreview → PdfPagesPreview/PdfCanvasPreview callbacks;
  // never stored in Firestore. Reset whenever the displayed file changes.
  const [pdfPageCount, setPdfPageCount] = useState(null)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPdfPageCount(null) }, [selected?.sub?.id, previewIdx])
  // ZIP of the current student's files only
  const [studentZipDownloading, setStudentZipDownloading] = useState(false)
  const [gradeForm, setGradeForm] = useState({ calificacion: '', comentario: '', comentarioVisibleAlumno: true })
  // GLOBAL = default, INDIVIDUAL = excepción, la individual gana (26-ago-2026,
  // corrección explícita de Kike). true mientras el docente no haya tocado el
  // checkbox de ESTE estudiante y la entrega no traiga ya un valor propio
  // guardado — en ese caso, al guardar NO se escribe el campo en la
  // submission (sigue heredando el default de la actividad, incluso si
  // cambia después). En cuanto se toca, o si la entrega ya traía una
  // excepción propia, se guarda el valor explícito siempre.
  const comentarioVisibleEsExcepcionRef = useRef(false)
  // Momento en que se abrió la página: el render debe ser puro (sin
  // Date.now()), y «ya publicada» no necesita cambiar mientras está abierta.
  const [abiertaEn] = useState(() => Date.now())
  // Nivel elegido por criterio cuando la actividad tiene rúbrica (null = sin elegir)
  const [rubricEval, setRubricEval] = useState(null)
  // "Ver rúbrica": ventana flotante sobrepuesta que abre abajo del botón,
  // hacia la izquierda hasta media pantalla — la entrega sigue visible detrás
  const [rubricaViewOpen, setRubricaViewOpen] = useState(false)
  const [rubricaWinTop, setRubricaWinTop] = useState(120)
  // En Android la rúbrica se abre hacia ARRIBA del botón (en vez de hacia
  // abajo como en la web) — se ancla por `bottom` en vez de por `top`.
  const [rubricaWinBottom, setRubricaWinBottom] = useState(80)
  const rubricaBtnRef = useRef(null)
  // "Calificar con IA" (OP-11, 21-ago-2026) — abre CalificarConIAModal, que
  // PRELLENA rubricEval/comentario con la propuesta; el guardado sigue
  // siendo el mismo botón "Guardar calificación" de siempre.
  const [calificarIAAbierto, setCalificarIAAbierto] = useState(false)
  // Snapshot de rubricEval/gradeForm tomado justo ANTES de abrir "Calificar
  // con IA" — la propuesta se precarga sola en cuanto llega (ver
  // aplicarPropuestaIA), así que "Descartar" necesita a qué volver. Solo
  // vive mientras el modal está abierto.
  const [previoAntesDeIA, setPrevioAntesDeIA] = useState(null)
  // Id de la sugerencia de lote (activities/{id}/iaSugerenciasEntregable/{x})
  // que quedó precargada en el formulario. 24-ago-2026 (pedido de Kike, tras
  // un reporte real): el flujo individual ahora persiste su propuesta EN EL
  // SERVIDOR en cuanto se genera (mismo doc, mismo id = submissionId, que ya
  // usa el lote) — así que este id nunca es null para una propuesta recién
  // generada, solo para el estado inicial antes de calificar. Se marca
  // 'aplicada' cuando el docente de verdad GUARDA la calificación
  // (persistGrade), nunca por solo verla o precargarla.
  const [iaPropuestaDocId, setIaPropuestaDocId] = useState(null)
  function abrirCalificarIA() {
    if (parcialCerrado) { toast(mensajeParcialCerrado(activity.parcial), 'error'); return }
    setPrevioAntesDeIA({ rubricEval, gradeForm })
    setCalificarIAAbierto(true)
  }
  function cerrarCalificarIA() {
    // Cierre "normal" (X, backdrop, Escape, o el botón Cerrar del modal):
    // la propuesta ya precargada en el formulario se CONSERVA — el docente
    // pudo haberla editado y seguir queriendo guardarla después.
    setPrevioAntesDeIA(null)
    setCalificarIAAbierto(false)
  }
  function descartarPropuestaIA() {
    if (previoAntesDeIA) {
      setRubricEval(previoAntesDeIA.rubricEval)
      setGradeForm(previoAntesDeIA.gradeForm)
    }
    setIaPropuestaDocId(null)
    setPrevioAntesDeIA(null)
    setCalificarIAAbierto(false)
  }
  const creditosIA = useCreditosIA()
  // "Calificar todas con IA" (lote) — mismo patrón que C-02 en
  // EvaluacionManager.jsx: el servidor persiste cada propuesta en
  // activities/{id}/iaSugerenciasEntregable/{submissionId} (estado
  // 'pendiente') y este snapshot las recupera solo — sobreviven un cierre de
  // pestaña, y verlas de nuevo jamás cobra. Al aplicar una se marca
  // 'aplicada' (ver aplicarPropuestaIA).
  const [sugerenciasLoteIA, setSugerenciasLoteIA] = useState({}) // { [submissionId]: sugerencia }
  const [loteIAConteo, setLoteIAConteo] = useState(null) // { entregas } → abre el modal de costo
  // Casilla expresa de «Recalificar todas con IA»: sin ella la IA NO reemplaza las calificaciones del docente.
  const [sobrescribirCalificadas, setSobrescribirCalificadas] = useState(false)
  const [loteIATrabajando, setLoteIATrabajando] = useState(false)
  // La ventana se ancla DEBAJO del renglón de la calificación oficial, para
  // que ésta quede siempre a la vista mientras se marca la rúbrica
  const califRowRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [searchStudents, setSearchStudents] = useState('')
  // Per-student deadline extension
  const [extendMode, setExtendMode] = useState(false)
  const [extendDate, setExtendDate] = useState('')
  const [extendMotivo, setExtendMotivo] = useState('')
  const [savingExtension, setSavingExtension] = useState(false)
  // Annul the current submission (student sent the wrong thing → back to Pendiente)
  const [annulMode, setAnnulMode] = useState(false)
  const [annulling, setAnnulling] = useState(false)
  // Grade a student who has no submission (e.g. handed the file on a USB stick)
  const [sinEntregaMode, setSinEntregaMode] = useState(false)
  const [sinEntregaGrade, setSinEntregaGrade] = useState('')
  const [sinEntregaMotivo, setSinEntregaMotivo] = useState('')
  const [savingSinEntrega, setSavingSinEntrega] = useState(false)
  // ZIP download
  const [zipDownloading, setZipDownloading] = useState(false)
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 })
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const { currentUser } = useAuth()
  // Grade-table cells navigate here with the student to open right away —
  // and closing the grading view must land back on that Calificaciones screen.
  const [pendingOpenId, setPendingOpenId] = useState(location.state?.openStudentId || null)
  const returnToGrades = location.state?.returnTo === 'calificaciones'
  // Llegó aquí desde un clic en el evento de la actividad en Horario y
  // agenda: al cerrar el editor debe regresar directo al calendario (que ya
  // conserva su vista/fecha en localStorage), no quedarse en esta pantalla.
  const returnToCalendar = location.state?.returnTo === 'calendario'
  // Modelo de créditos puros (20-ago-2026): crear/editar contenido ya no
  // depende de ninguna suscripción — todo lo no-IA es gratis para cualquier
  // docente.
  const canCreate = true
  // Observación: no student submission — the teacher observes and grades directly,
  // so the grade form is always available and saving creates the submission doc.
  const isObservacion = activity?.tipo === 'observacion' || activity?.categoria === 'observacion'
  // Evaluación (cuestionario/examen): the grade comes from the student's attempt;
  // the grading panel allows a manual override but no prefill/annul/extension.
  const isEvaluacion = activity?.tipo === 'evaluacion'
  // Crucigrama / Sopa de letras: flujo propio (contenido → construcción →
  // confirmación) en JuegoManager, ver comentario de esa página.
  const esJuego = activity?.categoria === 'juego'
  // Rúbrica: solo entregables (nunca observación ni evaluación)
  // La observación también puede llevar rúbrica: no tiene entrega, pero sí
  // criterios que calificar (actitud, exposición, participación). El resto del
  // flujo ya sabe calificar sin entrega, así que basta con no excluirla aquí.
  const hasRubrica = !!activity?.rubrica?.criterios?.length && !isEvaluacion
  // Etiqueta según el instrumento (rúbrica o lista de cotejo) para los botones.
  const instrumentoLabel = esCotejo(activity?.rubrica) ? 'lista de cotejo' : 'rúbrica'
  // Edit activity modal — el calendario navega aquí con openEditActivity para
  // abrir el editor de una vez (clic en el evento de fecha límite/publicación).
  const [editingActivity, setEditingActivity] = useState(!!location.state?.openEditActivity)
  // Parcial cerrado: no grade can be changed until the teacher reverts the close.
  const parcialCerrado = activity?.parcial != null && esParcialCerrado(subject, activity.parcial)

  // Evaluaciones de IA persistidas por el servidor — tanto 'pendiente' (de
  // un lote sin aplicar todavía) como 'aplicada' (23-ago-2026, pedido de
  // Kike: "toda evaluación realizada por IA debe quedar consultable
  // posteriormente sin volver a cobrar" — ya no se pierden de la interfaz
  // una vez aplicadas). `_estado` decide la etiqueta del botón: 'pendiente'
  // → "Ver propuesta de IA", 'aplicada' → "Ver evaluación de IA". Mismo
  // patrón que iaSugerencias de C-02 (EvaluacionManager.jsx).
  useEffect(() => {
    if (!activityId) return undefined
    const q = query(
      collection(db, 'activities', activityId, 'iaSugerenciasEntregable'),
      where('estado', 'in', ['pendiente', 'aplicada']),
    )
    const unsub = onSnapshot(q, (snap) => {
      const mapa = {}
      snap.docs.forEach((d) => { mapa[d.data().sub] = { ...d.data().sugerencia, _docId: d.id, _estado: d.data().estado, _rubricaFirma: d.data().rubricaFirma || '', _aplicadaAuto: d.data().aplicadaAutomaticamente === true } })
      setSugerenciasLoteIA(mapa)
    }, () => { /* sin permiso u offline: sin sugerencias que recuperar */ })
    return unsub
  }, [activityId])


  async function loadAll() {
    setLoading(true)
    try {
      const actSnap = await getDoc(doc(db, 'activities', activityId))
      // Una actividad ajena jamás se muestra — mismo guard que en SubjectPage:
      // sin él, cualquier cuenta con la URL vería las entregas del grupo.
      if (!actSnap.exists() || actSnap.data().docenteId !== currentUser.uid) {
        toast('Esta actividad no pertenece a tu cuenta', 'error')
        navigate('/dashboard')
        return
      }
      const actData = { id: actSnap.id, ...actSnap.data() }
      setActivity(actData)
      const subSnap = await getDoc(doc(db, 'subjects', actData.asignaturaId))
      const subData = { id: subSnap.id, ...subSnap.data() }
      setSubject(subData)
      const [studsSnap, subsSnap, siblingActsSnap] = await Promise.all([
        getDocs(query(collection(db, 'students'), where('asignaturaId', '==', actData.asignaturaId))),
        getDocs(query(collection(db, 'submissions'), where('actividadId', '==', activityId))),
        getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', actData.asignaturaId), where('docenteId', '==', currentUser.uid))),
      ])
      // "Actividad" (1.1, 1.2…) is presentation, derived from this activity's
      // position among its parcial siblings — never trusted from the stored
      // field, so it always matches what the subject page currently shows.
      // Drafts are EXCLUDED from the numbering, same rule as the subject page
      // (otherwise clicking "1.6" in the grades table lands on a page titled
      // "1.9" when drafts sit earlier in the orden).
      const siblings = siblingActsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => a.parcial === actData.parcial && cuentaParaCalificacion(a))
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      const idx = siblings.findIndex((a) => a.id === activityId)
      setActivityLabel(idx >= 0 ? `${actData.parcial}.${idx + 1}.` : null)
      const studList = studsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      setStudents(studList)
      const subsMap = {}
      subsSnap.docs.forEach((d) => { subsMap[d.data().alumnoId] = { id: d.id, ...d.data() } })
      setSubmissions(subsMap)
      // Solo informativo: si esta lectura falla, la pantalla funciona igual.
      try {
        const anSnap = await getDocs(query(collection(db, 'entregasAnuladas'), where('actividadId', '==', activityId)))
        const porAlumno = {}
        anSnap.docs.forEach((d) => { if (d.data().anuladaPor === 'docente') return; (porAlumno[d.data().alumnoId] ||= []).push({ id: d.id, ...d.data() }) })
        setAnuladasPorAlumno(porAlumno)
      } catch { setAnuladasPorAlumno({}) }
    } catch (err) {
      toast('Error al cargar: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  function getStatus(studentId) {
    const sub = submissions[studentId]
    return estadoEntrega(activity, sub, studentId)
  }

  function openGrade(student) {
    const sub = submissions[student.id]
    setSelected({ student, sub })
    // Cambiar de estudiante deja atrás cualquier propuesta de IA precargada
    // sin guardar — nunca debe seguir "colgada" y aplicarse sobre otro alumno.
    setIaPropuestaDocId(null)
    setPrevioAntesDeIA(null)
    setGradeForm({
      calificacion: sub?.calificacion != null ? String(sub.calificacion) : '',
      comentario: sub?.comentario || '',
      // Individual (excepción, si esta entrega ya tiene una) o si no, el
      // default/global de la actividad — nunca al revés. Se recarga aquí
      // cada vez que se abre a un estudiante distinto, para no arrastrar por
      // accidente el valor del alumno anterior (26-ago-2026).
      comentarioVisibleAlumno: sub?.comentarioVisibleAlumno !== undefined
        ? sub.comentarioVisibleAlumno !== false
        : activity?.comentarioVisibleAlumno !== false,
    })
    // Ya tiene su propia excepción → se re-guarda igual aunque no se toque.
    // Si no, empieza heredando el global — solo se vuelve excepción si el
    // docente toca el checkbox (ver su onChange, más abajo).
    comentarioVisibleEsExcepcionRef.current = sub?.comentarioVisibleAlumno !== undefined
    // Con rúbrica: cargar la evaluación guardada; si aún no hay calificación,
    // prellenar la rúbrica en nivel máximo para que el docente solo ajuste las
    // excepciones. gradeForm.calificacion permanece '' — el input aparece vacío
    // hasta que el docente toque un nivel o use "Aplicar y guardar calificación".
    if (activity?.rubrica?.criterios?.length && !isEvaluacion) {
      const n = activity.rubrica.criterios.length
      const previa = Array.isArray(sub?.rubricaEval) && sub.rubricaEval.length === n ? [...sub.rubricaEval] : null
      // En observación nunca hay entrega, así que `sub` falta hasta la primera
      // calificación: sin contarla aquí, la rúbrica arrancaría vacía y no
      // prellenada al máximo como en un entregable ya entregado.
      const sinCalificar = (sub || isObservacion) && sub?.calificacion == null
      const prefill = previa || (sinCalificar ? Array(n).fill(0) : Array(n).fill(null))
      setRubricEval(prefill)
    } else {
      setRubricEval(null)
    }
    setExtendMode(false)
    setExtendDate(activity?.extensiones?.[student.id] || '')
    setExtendMotivo(activity?.extensionesMotivo?.[student.id] || '')
    setPreviewIdx(-1)
    setAnnulMode(false)
    setSinEntregaMode(false)
    setSinEntregaGrade('')
    setSinEntregaMotivo('')
  }

  // Entry point from the student list: freezes the navigation order.
  // Guard on currentUser + depend on it — mismo patrón que SubjectPage: en un
  // cold load Firebase Auth puede no haber restaurado la sesión todavía y el
  // guard de propiedad (docenteId !== currentUser.uid) expulsaría a un docente
  // legítimo antes de tiempo.
  // Va DESPUÉS de loadAll y openGrade: el React Compiler pide declarar una
  // función antes de usarla en un efecto.
  // loadAll arranca una lectura de Firestore (sistema externo) y marca
  // `loading` al empezar: es el caso que la regla sí admite.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { if (currentUser) loadAll() }, [activityId, currentUser])

  // Coming from a grade-table cell: open that student's grading view once the
  // data is committed (openGrade reads `submissions`/`activity` from state).
  // While pendingOpenId is set we keep showing the spinner (see the loading
  // guard below) so the list never flashes before the grading view opens.
  // Evaluaciones are excluded: EvaluacionManager owns opening that student's
  // answer review itself (via its own `openStudentId` prop) — calling
  // openGrade here too would ALSO mount this page's generic grading overlay
  // (the "Evaluación — la calificación proviene del intento…" panel), which
  // briefly flashes before EvaluacionManager's own review view covers it.
  useEffect(() => {
    if (loading || !pendingOpenId) return
    const st = students.find((s) => s.id === pendingOpenId)
    // Clear it in the same commit that opens the grading view, so pendingOpenId
    // turning false and `selected` turning true happen together (no list flash).
    // Intencional: limpiar la intención de abrir en el MISMO commit que abre
    // la vista de calificar (no es estado derivable — viene de la navegación).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingOpenId(null)
    if (st && !isEvaluacion && !esJuego) {
      setNavList(students)
      openGrade(st)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, pendingOpenId, students])

  function openGradeFromList(student) {
    setNavList(filtered)
    openGrade(student)
  }

  // Header back arrow — also reused by the physical Android back button.
  function goBack() {
    if (returnToCalendar) { navigate('/calendario'); return }
    navigate(`/subject/${activity?.asignaturaId}`, returnToGrades ? { state: { tab: 'calificaciones' } } : undefined)
  }

  // Eliminar la actividad desde su propia pantalla — entregable, observación
  // o evaluación, publicada o borrador, todas por igual. Mismo criterio de
  // cascada y reindexado de `orden` que el borrado desde el listado del
  // parcial en SubjectPage.jsx (ver deleteSubmissionsByActivity).
  async function handleDeleteActivity() {
    if (!activity) return
    // Una actividad que cuenta no sale de un parcial cerrado definitivamente.
    if (parcialCerrado && cuentaParaCalificacion(activity)) {
      toast(mensajeParcialCerrado(activity.parcial), 'error')
      setDeleteConfirm(false)
      return
    }
    setDeletingActivity(true)
    try {
      await deleteSubmissionsByActivity(activity.id)
      await deleteDoc(doc(db, 'activities', activity.id))
      const siblingsSnap = await getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', activity.asignaturaId), where('docenteId', '==', currentUser.uid)))
      const remaining = siblingsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => a.id !== activity.id && a.parcial === activity.parcial)
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      const batch = writeBatch(db)
      remaining.forEach((a, i) => {
        const orden = i + 1
        if (a.orden !== orden) batch.update(doc(db, 'activities', a.id), { orden })
      })
      await batch.commit()
      toast('Actividad eliminada')
      navigate(`/subject/${activity.asignaturaId}`, returnToGrades ? { state: { tab: 'calificaciones' } } : undefined)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      setDeletingActivity(false)
    }
  }

  function closeModal() {
    setSelected(null)
    setExtendMode(false)
    setExtendDate('')
    // Opened from a Calificaciones cell → Regresar goes back to that screen
    if (returnToGrades) {
      navigate(`/subject/${activity?.asignaturaId}`, { state: { tab: 'calificaciones' } })
    }
  }

  // True when the form differs from what's stored — this is what makes
  // Siguiente/Anterior save without duplicating the Guardar logic.
  // Con el parcial cerrado solo se guarda el comentario: ¿cambió él (o su
  // visibilidad) respecto a la entrega guardada?
  function comentarioDirty() {
    if (!selected?.sub) return false
    const comChanged = gradeForm.comentario.trim() !== (selected.sub.comentario || '')
    const visibleGuardado = selected.sub.comentarioVisibleAlumno !== undefined
      ? selected.sub.comentarioVisibleAlumno !== false
      : activity?.comentarioVisibleAlumno !== false
    return comChanged || (gradeForm.comentarioVisibleAlumno !== false) !== visibleGuardado
  }

  function isDirty() {
    if (!selected) return false
    if (!selected.sub) {
      // Sin entrega: solo observación (siempre), entregable con rúbrica
      // (rubricar a quien no entregó), o en Android cualquier entregable —
      // ahí la calificación grande siempre está disponible, sin necesidad
      // de una entrega o una rúbrica (es el estándar de esa vista).
      if (!isObservacion && !hasRubrica && !(IS_NATIVE_APP && !isEvaluacion)) return false
      const cal = parseFloat(gradeForm.calificacion)
      return !isNaN(cal) || !!gradeForm.comentario.trim()
    }
    const cal = parseFloat(gradeForm.calificacion)
    const calChanged = !isNaN(cal) && cal !== selected.sub.calificacion
    const comChanged = gradeForm.comentario.trim() !== (selected.sub.comentario || '')
    const rubChanged = hasRubrica &&
      JSON.stringify(normRubricaEval(rubricEval)) !== JSON.stringify(normRubricaEval(selected.sub.rubricaEval))
    // Mismo criterio individual-o-global que openGrade — comparar contra el
    // valor RAW del sub (undefined ≠ true) reportaría "cambiado" a diario
    // cuando el global es false y el checkbox simplemente lo refleja.
    const comentarioVisibleResuelto = selected.sub.comentarioVisibleAlumno !== undefined
      ? selected.sub.comentarioVisibleAlumno !== false
      : activity?.comentarioVisibleAlumno !== false
    const visChanged = (gradeForm.comentarioVisibleAlumno !== false) !== comentarioVisibleResuelto
    // rubChanged solo habilita el botón Guardar cuando ya hay una calificación
    // en el campo — de lo contrario los niveles preseleccionados en la rúbrica
    // (nivel máximo por defecto) habilitarían el botón sin que haya nota real.
    // "Aplicar y guardar calificación" de la rúbrica maneja el caso de input vacío.
    const rubDirty = rubChanged && !isNaN(cal)
    return calChanged || comChanged || rubDirty || visChanged
  }

  // Tocar un nivel en la rúbrica: guarda la elección y, cuando todos los
  // criterios tienen nivel, escribe el total calculado en la calificación.
  function selectRubricaNivel(ci, ni) {
    if (parcialCerrado) return
    setRubricEval((prev) => {
      const next = [...(prev || Array(activity.rubrica.criterios.length).fill(null))]
      next[ci] = ni
      const total = totalRubrica(activity.rubrica, next)
      if (total != null) setGradeForm((f) => ({ ...f, calificacion: String(total) }))
      return next
    })
  }

  // Aplicar la propuesta de "Calificar con IA": PRELLENA rubricEval y el
  // comentario con lo que propuso la IA — exactamente el mismo estado que
  // llena selectRubricaNivel a mano. No guarda nada por sí sola: el docente
  // sigue viendo la rúbrica de siempre, puede ajustar cualquier nivel, y el
  // guardado real sigue siendo el botón "Guardar calificación" existente.
  function aplicarPropuestaIA(resultado, docId = null) {
    const next = resultado.criterios.map((c) => c.nivel)
    setRubricEval(next)
    const total = totalRubrica(activity.rubrica, next)
    setGradeForm((f) => ({
      ...f,
      calificacion: total != null ? String(total) : f.calificacion,
      comentario: resultado.retroalimentacionGeneral || f.comentario,
    }))
    // docId = submissionId siempre que la propuesta viene de IA (individual
    // o lote) — el servidor ya la persistió con ese mismo id en cuanto se
    // generó. persistGrade() la marca 'aplicada' cuando el docente guarde.
    setIaPropuestaDocId(docId)
  }

  // ── "Calificar todas con IA" (lote) — mismo patrón que contarRespuestasIA
  // de C-02 en EvaluacionManager.jsx. Cuenta EXACTAMENTE las entregas
  // pendientes (sin calificar) con evidencia en un formato legible que
  // TODAVÍA no tienen propuesta persistida — esas se recuperan gratis, sin
  // volver a contarlas ni cobrarlas.
  function contarEntregasIA() {
    if (parcialCerrado) { toast(mensajeParcialCerrado(activity.parcial), 'error'); return }
    // "Por calificar" (la pestaña) sigue contando TODA entrega sin
    // calificación — el docente la puede calificar a mano aunque no sea
    // elegible para IA. `totalPorCalificar` es solo para que el modal
    // explique la diferencia si la hay (25-ago-2026, reporte de Kike: el
    // modal decía "3" mientras la pestaña decía "Por calificar (4)" sin
    // explicación — el número de cobro/proceso no cambia, solo el texto).
    const totalPorCalificar = students.filter((s) => getStatus(s.id) === 'entregado').length
    const elegibles = students.filter((s) => {
      const sub = submissions[s.id]
      if (!sub || sub.calificacion != null) return false
      if (sugerenciasLoteIA[sub.id]) return false
      return submissionFiles(sub).some((f) => isEvidenciaSoportada(f.nombre, f.url))
    })
    if (!elegibles.length) {
      const yaListas = Object.keys(sugerenciasLoteIA).length
      toast(yaListas
        ? 'Todas las entregas pendientes con evidencia ya tienen propuesta de IA — ábrelas al calificar, sin costo adicional'
        : 'No hay entregas pendientes con evidencia en un formato legible (JPG, PNG, PDF o Word)', 'error')
      return
    }
    setLoteIAConteo({ entregas: elegibles.length, totalPorCalificar, recalificar: false })
  }

  // "Recalificar todas con IA" — para cuando el docente YA cambió la
  // rúbrica/lista de cotejo y quiere propuestas nuevas con el instrumento
  // actual. A diferencia de "Calificar todas con IA", cuenta TODA entrega
  // con evidencia legible sin importar si ya tiene calificación o propuesta
  // — el servidor regenera cada propuesta desde cero (ver recalificar=true
  // en precheckCalificarEntregableLote/ejecutarCalificarEntregableIALote).
  // No crea entregas nuevas, no toca archivos ni calificaciones existentes:
  // solo dEJA LISTAS propuestas nuevas para que el docente las revise.
  function contarRecalificarIA() {
    if (parcialCerrado) { toast(mensajeParcialCerrado(activity.parcial), 'error'); return }
    const elegibles = students.filter((s) => {
      const sub = submissions[s.id]
      if (!sub) return false
      return submissionFiles(sub).some((f) => isEvidenciaSoportada(f.nombre, f.url))
    })
    if (!elegibles.length) {
      toast('No hay entregas con evidencia en un formato legible (JPG, PNG, PDF o Word)', 'error')
      return
    }
    // Cuántas de esas entregas tienen una calificación puesta por el docente
    // (la IA no la reemplaza salvo que marque la casilla del diálogo). Misma
    // decisión que toma el servidor (evaluacionGrading.calificacionEsDeIA).
    const yaCalificadas = elegibles.filter((st) => {
      const sub = submissions[st.id]
      const s = sugerenciasLoteIA[sub.id]
      const sug = s ? { aplicadaAutomaticamente: s._aplicadaAuto === true, sugerencia: { calificacionPropuesta: s.calificacionPropuesta } } : null
      return sub.calificacion != null && !calificacionEsDeIA(sub, sug)
    }).length
    setSobrescribirCalificadas(false)
    setLoteIAConteo({ entregas: elegibles.length, recalificar: true, yaCalificadas })
  }

  // Ejecuta el lote tras la confirmación del docente. El servidor relee todo
  // por ID (nunca confía en el cliente), persiste cada propuesta y cobra
  // solo lo realmente generado — las sugerencias NUNCA se guardan como
  // calificación (regla O3): el snapshot de arriba las entrega y el docente
  // las aplica una por una si le convencen.
  async function ejecutarLoteIA() {
    const recalificar = loteIAConteo?.recalificar === true
    setLoteIATrabajando(true)
    try {
      const data = await creditosIA.ejecutar(
        claveOperacionLote,
        { actividadId: activityId, recalificar, sobrescribirCalificadas: recalificar && sobrescribirCalificadas },
        loteIAConteo.entregas,
        { timeoutMs: 300000 },
      )
      setLoteIAConteo(null)
      const n = data?.resultado?.generadas || 0
      const previas = data?.resultado?.yaProcesadas || 0
      const fallidas = data?.resultado?.fallidas || 0
      const aplicadas = data?.resultado?.aplicadasAuto || 0
      const omitidas = data?.resultado?.omitidasCalificadas || 0
      // Recalificar reescribe `submissions.calificacion` directo en el
      // servidor — sin esto el docente seguiría viendo las calificaciones
      // viejas hasta recargar la página. Solo submissions (no loadAll
      // completo): no queremos el parpadeo de "cargando" ni perder dónde
      // estaba parado el docente en la lista.
      if (recalificar && aplicadas > 0) {
        const subsSnap = await getDocs(query(collection(db, 'submissions'), where('actividadId', '==', activityId)))
        const subsMap = {}
        subsSnap.docs.forEach((d) => { subsMap[d.data().alumnoId] = { id: d.id, ...d.data() } })
        setSubmissions(subsMap)
        setSelected((sel) => (sel?.sub && subsMap[sel.student.id]) ? { ...sel, sub: subsMap[sel.student.id] } : sel)
      }
      toast(recalificar
        // Recalificar escribe sola la calificación real (23-ago-2026, pedido
        // de Kike) — salvo la que el docente puso a mano (si no marcó la
        // casilla) y la entrega que quedó sin evidencia suficiente para un
        // total: esas quedan como propuesta a revisar.
        ? `${aplicadas} calificaci${aplicadas !== 1 ? 'ones' : 'ón'} actualizada${aplicadas !== 1 ? 's' : ''} con la IA` +
          `${omitidas > 0 ? ` — ${omitidas} ya tenían tu calificación y no se tocaron: quedaron como propuesta para que las revises` : ''}` +
          `${n - aplicadas - omitidas > 0 ? ` (${n - aplicadas - omitidas} quedaron como propuesta — revísalas a mano, falta evidencia clara en algún criterio)` : ''}` +
          `${fallidas ? ` — ${fallidas} no se pudo${fallidas !== 1 ? 'ieron' : ''} procesar` : ''}`
        : `${n} propuesta${n !== 1 ? 's' : ''} de IA lista${n !== 1 ? 's' : ''}` +
          `${previas ? ` (${previas} ya existían y no se cobraron)` : ''}` +
          `${fallidas ? ` — ${fallidas} no se pudo${fallidas !== 1 ? 'ieron' : ''} procesar` : ''}` +
          ' — revísalas al calificar a cada estudiante. Tú decides.',
      )
    } catch (err) {
      toast(err.codigo === 'SALDO_INSUFICIENTE' ? 'No tienes créditos suficientes para este lote' : 'No se pudo completar: ' + err.message, 'error')
    } finally {
      setLoteIATrabajando(false)
    }
  }

  // ── "Aplicar calificaciones de IA a todas" (Modo 1, 23-ago-2026) ───────────
  // Trabaja SOLO con sugerencias que YA EXISTEN y están 'pendiente' — nunca
  // llama a Anthropic, nunca pasa por ejecutarOperacionIA ni por el ledger de
  // créditos. Útil cuando el docente ya afinó la rúbrica y confía en que la
  // IA está evaluando bien: en vez de abrir entrega por entrega, aplica todas
  // las propuestas pendientes de un solo golpe. Distinto de "Recalificar
  // todas con IA", que sí genera evaluaciones NUEVAS y sí cobra.
  const [aplicarTodasConteo, setAplicarTodasConteo] = useState(null) // { entregas } → confirmación sin costo
  const [aplicarTodasTrabajando, setAplicarTodasTrabajando] = useState(false)

  function contarAplicarTodasIA() {
    if (parcialCerrado) { toast(mensajeParcialCerrado(activity.parcial), 'error'); return }
    const pendientes = Object.values(sugerenciasLoteIA).filter((s) => s._estado === 'pendiente')
    if (!pendientes.length) {
      toast('No hay propuestas de IA pendientes por aplicar', 'error')
      return
    }
    setAplicarTodasConteo({ entregas: pendientes.length })
  }

  async function ejecutarAplicarTodasIA() {
    setAplicarTodasTrabajando(true)
    try {
      const aplicar = httpsCallable(functions, 'aplicarEvaluacionesIAPendientes', { timeout: 120000 })
      const { data } = await aplicar({ actividadId: activityId })
      setAplicarTodasConteo(null)
      const aplicadas = data?.aplicadas || 0
      const noAplicadas = data?.noAplicadas || 0
      if (aplicadas > 0) {
        const subsSnap = await getDocs(query(collection(db, 'submissions'), where('actividadId', '==', activityId)))
        const subsMap = {}
        subsSnap.docs.forEach((d) => { subsMap[d.data().alumnoId] = { id: d.id, ...d.data() } })
        setSubmissions(subsMap)
        setSelected((sel) => (sel?.sub && subsMap[sel.student.id]) ? { ...sel, sub: subsMap[sel.student.id] } : sel)
      }
      // Las que el docente ya calificó mientras la propuesta esperaba no se
      // tocan: siguen como propuesta pendiente para revisarlas a mano.
      const yaCalificadas = (data?.motivos || []).filter((m) => m.codigo === 'ya_calificada_por_docente').length
      const otras = noAplicadas - yaCalificadas
      toast(
        `${aplicadas} calificaci${aplicadas !== 1 ? 'ones' : 'ón'} aplicada${aplicadas !== 1 ? 's' : ''}` +
        `${yaCalificadas ? ` — ${yaCalificadas} ya tenía${yaCalificadas !== 1 ? 'n' : ''} tu calificación y no se ${yaCalificadas !== 1 ? 'tocaron' : 'tocó'} (la propuesta sigue pendiente)` : ''}` +
        `${otras > 0 ? ` — ${otras} no se pudo${otras !== 1 ? 'ieron' : ''} aplicar` : ''}`,
      )
    } catch (err) {
      toast('No se pudo completar: ' + err.message, 'error')
    } finally {
      setAplicarTodasTrabajando(false)
    }
  }

  // Single save path shared by the Guardar button and Anterior/Siguiente.
  // Updates local state in place (no reload) so navigation stays fluid.
  // For observación, the first grade CREATES the submission doc (there is no
  // student delivery to attach to).
  // calOverride: ÚNICAMENTE para el botón "Aplicar y guardar calificación" de
  // la rúbrica, cuando el docente no pasó por el input y el campo está vacío.
  // Nunca se usa desde el botón normal "Guardar calificación".
  // Una escritura protegida (utils/submissionGuard.js) se detuvo porque la
  // entrega ya no es la que el docente tenía en pantalla. Se actualiza SOLO
  // la entrega de ese estudiante — en el mapa y en el panel abierto — sin
  // pasar por openGrade(): el formulario, la rúbrica, el alumno seleccionado
  // y la navegación se quedan exactamente como estaban, con lo que el
  // docente ya escribió.
  // `mensajeCambio`: texto propio de la acción cuando la entrega cambió (Anular
  // no "guarda" nada); sin él se usa el de guardar.
  function mostrarEntregaActual(studentId, err, mensajeCambio = null) {
    const actual = err.actual || undefined
    setSubmissions((prev) => {
      const next = { ...prev }
      if (actual) next[studentId] = actual
      else delete next[studentId]
      return next
    })
    setSelected((sel) => (sel && sel.student.id === studentId ? { ...sel, sub: actual } : sel))
    // La confirmación de "Anular" se cierra: lo que había que confirmar ya no
    // es lo que hay. "Evaluar sin entrega" conserva lo tecleado (su sección
    // solo se muestra mientras no hay entrega).
    setAnnulMode(false)
    if (err.motivo === 'no-existe') {
      toast('Esta entrega ya no existe: el estudiante quedó como Pendiente. Lo que escribiste se conservó.')
    } else if (err.motivo === 'ya-existe') {
      toast(actual?.sinEntrega
        ? 'Este estudiante ya tiene una calificación sin entrega. Se muestra la actual; lo que escribiste se conservó.'
        : 'Este estudiante acaba de entregar. Revisa su entrega; lo que escribiste se conservó.', 'error')
    } else {
      toast(mensajeCambio || 'La entrega de este estudiante cambió desde que la abriste. Se muestra la versión actual; lo que escribiste se conservó y no se guardó nada.', 'error')
    }
  }

  async function persistGrade(calOverride = null) {
    if (!selected || !canCreate) return false
    try {
      return await persistGradeProtegido(calOverride)
    } catch (err) {
      if (!(err instanceof EntregaCambio)) throw err
      mostrarEntregaActual(selected.student.id, err)
      return false
    }
  }

  async function persistGradeProtegido(calOverride) {
    // Parcial cerrado definitivamente: la calificación queda congelada, pero el
    // comentario no la cambia — se guarda solo eso (firestore.rules ·
    // soloComentarioDocente).
    if (parcialCerrado) {
      if (!selected.sub) return false
      const comentarioCerrado = gradeForm.comentario.trim()
      const visibleCerrado = comentarioVisibleEsExcepcionRef.current
        ? { comentarioVisibleAlumno: gradeForm.comentarioVisibleAlumno !== false }
        : {}
      await actualizarSiNoCambio(db, doc(db, 'submissions', selected.sub.id), selected.sub, { comentario: comentarioCerrado, ...visibleCerrado })
      const actualizado = { ...selected.sub, comentario: comentarioCerrado, ...visibleCerrado }
      setSubmissions((prev) => ({ ...prev, [selected.student.id]: actualizado }))
      setSelected((sel) => (sel && sel.student.id === selected.student.id ? { ...sel, sub: actualizado } : sel))
      return true
    }
    // Sin entrega solo se puede calificar en observación, rubricando (la
    // rúbrica permite evaluar en cero o en lo que corresponda a quien no
    // entregó), o en Android para cualquier entregable — mismo estándar
    // que isDirty() de arriba.
    if (!selected.sub && !isObservacion && !hasRubrica && !(IS_NATIVE_APP && !isEvaluacion)) return false
    const calRaw = calOverride != null ? String(calOverride) : gradeForm.calificacion
    const cal = parseFloat(calRaw)
    if (isNaN(cal) || cal < 0 || cal > (activity?.maxCalif ?? 10)) return false
    const comentario = gradeForm.comentario.trim()
    // Solo se escribe el campo en la submission si esta entrega YA tenía su
    // propia excepción o si el docente tocó el checkbox ahora (ver su
    // onChange) — GLOBAL = default, INDIVIDUAL = excepción, la individual
    // gana; si nunca hubo excepción, no se copia el valor global a la
    // entrega, para que ese estudiante siga heredando cualquier cambio
    // futuro del default de la actividad (26-ago-2026).
    const comentarioVisiblePayload = comentarioVisibleEsExcepcionRef.current
      ? { comentarioVisibleAlumno: gradeForm.comentarioVisibleAlumno !== false }
      : {}
    // La rúbrica evaluada viaja junto con la calificación (null si no se tocó)
    const rubricaEvalPayload = hasRubrica ? { rubricaEval: normRubricaEval(rubricEval) } : {}
    let updated
    if (selected.sub) {
      // Solo si sigue siendo la entrega que el docente está viendo: con la
      // pantalla vieja, esta nota y este comentario caerían sobre una entrega
      // nueva que nunca revisó (submissionGuard.js).
      await actualizarSiNoCambio(db, doc(db, 'submissions', selected.sub.id), selected.sub, {
        calificacion: cal,
        comentario,
        estado: 'calificado',
        // Quién puso la nota: la IA solo reemplaza notas que son suyas (la
        // marca viaja con la calificación; ver decidirAplicacionIA).
        ultimaCalificacionPor: ORIGEN_DOCENTE,
        ...comentarioVisiblePayload,
        ...rubricaEvalPayload,
      })
      updated = { ...selected.sub, calificacion: cal, comentario, estado: 'calificado', ultimaCalificacionPor: ORIGEN_DOCENTE, ...comentarioVisiblePayload, ...rubricaEvalPayload }
    } else {
      const data = {
        actividadId: activityId,
        alumnoId: selected.student.id,
        calificacion: cal,
        comentario,
        estado: 'calificado',
        ultimaCalificacionPor: ORIGEN_DOCENTE,
        sinEntrega: true,
        fechaEntrega: serverTimestamp(),
        ...comentarioVisiblePayload,
        ...rubricaEvalPayload,
      }
      // Id determinista (A12 · H5 · R22). Solo se CREA: si mientras tanto el
      // estudiante entregó, antes un setDoc(merge) convertía esa entrega en
      // sinEntrega:true (caso real, sep-2026) — ahora se detiene y se muestra.
      const id = submissionDocId(activityId, selected.student.id)
      updated = await crearSiNoExiste(db, doc(db, 'submissions', id), data)
    }
    setSubmissions((prev) => ({ ...prev, [selected.student.id]: updated }))
    setSelected((sel) => (sel && sel.student.id === selected.student.id ? { ...sel, sub: updated } : sel))
    // La calificación que se acaba de guardar venía precargada de una
    // propuesta de lote — hasta AHORA, con el guardado real ya hecho, se
    // marca 'aplicada' (nunca antes, para no cobrar de más ni perder la
    // recuperación gratis de "Ver propuesta de IA" si el docente no guarda).
    if (iaPropuestaDocId) {
      updateDoc(doc(db, 'activities', activityId, 'iaSugerenciasEntregable', iaPropuestaDocId), { estado: 'aplicada' }).catch(() => {})
      setIaPropuestaDocId(null)
    }
    return true
  }

  async function saveGrade(e) {
    e.preventDefault()
    if (!selected?.sub && !isObservacion && !hasRubrica) return
    if (!canCreate) {
      toast('Necesitas Créditos IA para registrar calificaciones — toda tu información sigue disponible')
      return
    }
    setSaving(true)
    try {
      if (await persistGrade()) toast(parcialCerrado ? 'Comentario guardado' : 'Calificación guardada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // ZIP with just the current student's files, named "1.3 Actividad - Alumno.zip"
  async function downloadStudentZip() {
    if (descargaSoloWeb(toast)) return
    if (!selected || selFiles.length < 2) return
    setStudentZipDownloading(true)
    try {
      const studentName = studentFullName(selected.student)
      const jobs = selFiles.map((f, i) => ({
        path: [],
        fileBaseName: `${studentName} ${String(i + 1).padStart(2, '0')}`,
        url: f.url,
        nombreArchivo: f.nombre,
      }))
      const { escritos, errores } = await downloadSubmissionsZip({
        zipName: [activityLabel, activity?.nombre, '-', studentName].filter(Boolean).join(' '),
        jobs,
      })
      toast(errores > 0
        ? `Descargadas ${escritos} de ${escritos + errores} imágenes (${errores} con error)`
        : `${escritos} imágenes en ZIP`)
    } catch (err) {
      toast('Error al generar ZIP: ' + err.message, 'error')
    } finally {
      setStudentZipDownloading(false)
    }
  }

  // Deletes the current submission doc: the student goes back to "Pendiente"
  // and can submit again (any grade it had is removed with it).
  async function annulSubmission() {
    if (!selected?.sub) return
    if (parcialCerrado) {
      toast('El parcial está cerrado. Primero reabre el parcial.', 'error')
      return
    }
    setAnnulling(true)
    const quedarPendiente = () => {
      setSubmissions((prev) => {
        const next = { ...prev }
        delete next[selected.student.id]
        return next
      })
      setSelected((sel) => (sel && sel.student.id === selected.student.id ? { ...sel, sub: undefined } : sel))
      setGradeForm({ calificacion: '', comentario: '' })
      setAnnulMode(false)
    }
    try {
      // Se borra SOLO si sigue siendo la entrega que el docente está viendo:
      // con el id fijo, un deleteDoc a ciegas borraba la entrega nueva que el
      // estudiante subió después (submissionGuard.js). La ausencia del
      // documento ES "no entregada" en toda la plataforma: no se crea ningún
      // sinEntrega ni se toca la actividad (su prórroga sigue intacta).
      // La traza (entregasAnuladas, anuladaPor 'docente') se escribe en la misma
      // transacción: quién anuló, cuándo, y la nota, el estado y la evidencia
      // que tenía. El archivo en Cloudinary no se toca.
      await borrarSiNoCambio(db, doc(db, 'submissions', selected.sub.id), selected.sub, {
        traza: {
          ref: doc(collection(db, 'entregasAnuladas')),
          construir: (actual) => datosTrazaAnulacionDocente(actual, {
            actividadId: activityId, alumnoId: selected.student.id, uid: auth.currentUser?.uid,
          }),
        },
      })
      quedarPendiente()
      toast('Entrega anulada — el estudiante queda en Pendiente y puede volver a entregar')
    } catch (err) {
      if (err instanceof EntregaCambio && err.motivo === 'no-existe') {
        quedarPendiente()
        toast('Esta entrega ya no existía: el estudiante queda en Pendiente')
      } else if (err instanceof EntregaCambio) {
        mostrarEntregaActual(selected.student.id, err, 'Esta entrega cambió mientras la estabas revisando. No se anuló nada. Revisa la entrega actualizada.')
      } else {
        toast('Error al anular: ' + err.message, 'error')
      }
    } finally {
      setAnnulling(false)
    }
  }

  // Grade a student with no submission (e.g. handed it in on a USB stick).
  // Creates a submission marked sinEntrega with the reason, so it counts and
  // shows in the grades. NOT cierreParcial → it stays as a manual (black) grade.
  async function saveSinEntrega() {
    if (!selected || selected.sub) return
    if (parcialCerrado) {
      toast('El parcial está cerrado. Primero reabre el parcial.', 'error')
      return
    }
    if (!canCreate) {
      toast('Necesitas Créditos IA para registrar calificaciones — toda tu información sigue disponible')
      return
    }
    const cal = parseFloat(sinEntregaGrade)
    if (isNaN(cal) || cal < 0 || cal > (activity?.maxCalif ?? 10)) {
      toast(`Escribe una calificación válida (0 a ${activity?.maxCalif ?? 10})`, 'error')
      return
    }
    setSavingSinEntrega(true)
    try {
      const data = {
        actividadId: activityId,
        alumnoId: selected.student.id,
        calificacion: cal,
        comentario: '',
        motivoSinEntrega: sinEntregaMotivo.trim(),
        estado: 'calificado',
        ultimaCalificacionPor: ORIGEN_DOCENTE,
        sinEntrega: true,
        fechaEntrega: serverTimestamp(),
      }
      // Id determinista; solo se CREA — ver persistGrade() más arriba.
      const id = submissionDocId(activityId, selected.student.id)
      const updated = await crearSiNoExiste(db, doc(db, 'submissions', id), data)
      setSubmissions((prev) => ({ ...prev, [selected.student.id]: updated }))
      setSelected((sel) => (sel && sel.student.id === selected.student.id ? { ...sel, sub: updated } : sel))
      setGradeForm({ calificacion: String(cal), comentario: '' })
      setSinEntregaMode(false)
      toast('Calificación sin entrega guardada')
    } catch (err) {
      if (err instanceof EntregaCambio) mostrarEntregaActual(selected.student.id, err)
      else toast('Error: ' + err.message, 'error')
    } finally {
      setSavingSinEntrega(false)
    }
  }

  // El botón "Guardar" de la prórroga se apaga si lo tecleado es igual a la
  // que ya tenía este alumno: openGrade() precarga extendDate/extendMotivo
  // con la prórroga existente, así que reabrir el panel de un alumno YA
  // extendido mostraba el botón activo sin que se hubiera tocado nada.
  const extensionUnchanged = !!selected &&
    extendDate === (activity?.extensiones?.[selected.student.id] || '') &&
    extendMotivo.trim() === (activity?.extensionesMotivo?.[selected.student.id] || '')

  // Prórroga solo sin entrega real (ver tieneEntregaReal en utils/extensiones).
  const prorrogaBloqueada = !!selected && tieneEntregaReal(selected.sub, activity)

  async function saveExtension() {
    if (!selected || !extendDate) return
    // Una prórroga reabriría la actividad en un parcial cerrado definitivamente.
    if (parcialCerrado) { toast(mensajeParcialCerrado(activity.parcial), 'error'); return }
    if (prorrogaBloqueada) { toast(MENSAJE_PRORROGA_CON_ENTREGA, 'error'); return }
    setSavingExtension(true)
    try {
      // Las entregas se leyeron al abrir la página: se vuelve a preguntar justo
      // antes de escribir, por si el alumno entregó con el panel abierto.
      const actual = (await leerEntregasReales(db, activityId, activity, selected.student.id)).get(selected.student.id)
      if (actual) {
        setSubmissions((prev) => ({ ...prev, [selected.student.id]: actual }))
        setSelected((sel) => (sel && sel.student.id === selected.student.id ? { ...sel, sub: actual } : sel))
        setExtendMode(false)
        toast('Este estudiante acaba de entregar. No se modificó su fecha: para hacerlo, primero anula la entrega.', 'error')
        return
      }
      const motivo = extendMotivo.trim()
      // `extensionesTS` es el espejo en Timestamp y es lo ÚNICO que
      // firestore.rules mira (actividadVencidaParaAlumno). Sin él la prórroga
      // era decorativa: la UI y el alumno mostraban la fecha nueva, pero el
      // servidor seguía comparando contra `fechaLimiteTS` y rechazaba la
      // entrega — justo al rezagado para quien existe la prórroga. Los tres
      // campos se escriben SIEMPRE juntos, igual que en NuevaFechaEntregaModal.
      await updateDoc(doc(db, 'activities', activityId), {
        [`extensiones.${selected.student.id}`]: extendDate,
        [`extensionesTS.${selected.student.id}`]: fechaLimiteTimestamp(extendDate),
        [`extensionesMotivo.${selected.student.id}`]: motivo,
      })
      setActivity((prev) => ({
        ...prev,
        extensiones: { ...(prev.extensiones || {}), [selected.student.id]: extendDate },
        extensionesMotivo: { ...(prev.extensionesMotivo || {}), [selected.student.id]: motivo },
      }))
      toast('Fecha de entrega actualizada')
      setExtendMode(false)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingExtension(false)
    }
  }

  // Already published? The "Nueva fecha límite de entrega" action lives in the
  // editor and is offered once the activity is published (a student may fall
  // behind the group deadline and need their own extension).
  const isPublished = !!activity?.publishedAt && new Date(withDefaultTime(activity.publishedAt, '00:00:00')).getTime() <= abiertaEn

  // Merges the result of NuevaFechaEntregaModal into local activity state.
  function applyNewDateResult(result) {
    setActivity((prev) => {
      if (result.mode === 'todos') return { ...prev, fechaLimite: result.date, cerradaManual: false }
      const ext = { ...(prev.extensiones || {}) }
      const em = { ...(prev.extensionesMotivo || {}) }
      result.ids.forEach((id) => { ext[id] = result.date; em[id] = result.motivo })
      return { ...prev, extensiones: ext, extensionesMotivo: em }
    })
  }

  const counts = {
    noentregado: students.filter((s) => getStatus(s.id) === 'noentregado').length,
    prorroga: students.filter((s) => getStatus(s.id) === 'prorroga').length,
    entregado: students.filter((s) => getStatus(s.id) === 'entregado').length,
    calificado: students.filter((s) => getStatus(s.id) === 'calificado').length,
  }

  // Shared by the list page and the fullscreen grading view (its filter tabs
  // need the would-be list for a filter BEFORE the state re-renders).
  function applyStudentFilters(f) {
    let list = f === 'todos' ? students : students.filter((s) => getStatus(s.id) === f)
    if (searchStudents.trim()) {
      list = list.filter((s) => matchesStudentSearch(s, searchStudents))
    }
    return list
  }
  const filtered = applyStudentFilters(filter)

  async function handleZipDownload() {
    setZipDownloading(true)
    setZipProgress({ done: 0, total: 0 })
    try {
      const submissionsArr = Object.values(submissions)
      const jobs = buildJobsForActivity({ students, submissions: submissionsArr })
      if (jobs.length === 0) { toast('No hay archivos entregados para descargar'); return }
      const { escritos, errores } = await downloadSubmissionsZip({
        zipName: [activityLabel, activity?.nombre || 'Entregas'].filter(Boolean).join(' '),
        jobs,
        onProgress: (done, total) => setZipProgress({ done, total }),
      })
      toast(errores > 0
        ? `Descargadas ${escritos} de ${escritos + errores} entregas (${errores} con error)`
        : `${escritos} entrega${escritos !== 1 ? 's' : ''} en ZIP`)
    } catch (err) {
      toast('Error al generar ZIP: ' + err.message, 'error')
    } finally {
      setZipDownloading(false)
      setZipProgress({ done: 0, total: 0 })
    }
  }

  const curIdx = selected ? navList.findIndex((s) => s.id === selected.student.id) : -1
  // Files of the submission being graded (multi-photo entregas have several)
  const selFiles = selected ? submissionFiles(selected.sub) : []
  // Para el aviso de zoom en la web (ver "Left: file preview" más abajo):
  // qué se está mostrando ahora mismo, sea la lista completa o un solo
  // archivo (selFiles.length<=1 cae al archivo de selected.sub).
  const previewFiles = selFiles.length > 0
    ? selFiles
    : (selected?.sub?.archivoURL ? [{ nombre: selected.sub.nombreArchivo, url: selected.sub.archivoURL }] : [])
  const previewHasImage = previewFiles.some((f) => isImageFile(f.nombre, f.url))
  const previewHasPdf = previewFiles.some((f) => f.nombre?.toLowerCase().endsWith('.pdf'))
  // Propuesta del lote "Calificar todas con IA" ya lista para esta entrega
  // (gratis de revisar, ya se cobró al generarla).
  const sugerenciaPersistidaIA = selected?.sub ? sugerenciasLoteIA[selected.sub.id] : null
  // "Calificar con IA": visible si hay rúbrica/cotejo guardado, y (a) ya hay
  // una propuesta persistida esperando (no cuesta nada verla), o (b) al
  // menos una evidencia en formato soportado y saldo de créditos.
  // Se oculta también si la actividad solo acepta tipos que la IA no soporta
  // todavía (ZIP, Excel, PowerPoint, personalizado sin jpg/png/pdf/docx).
  const actividadAdmiteIA = normalizeFileTypeKeys(activity?.tiposArchivo)
    .some((k) => ['imagenes', 'pdf', 'word', 'todos'].includes(k))
  // Operación efectiva según el tipo de la actividad — determina la tarifa
  // que ve el docente en el modal y que usa el servidor al cobrar.
  const claveOperacionLote = normalizeFileTypeKeys(activity?.tiposArchivo).includes('imagenes')
    ? 'calificar_entregable_ia_lote_imagenes'
    : 'calificar_entregable_ia_lote'
  const puedeCalificarConIA = hasRubrica && actividadAdmiteIA && (
    !!sugerenciaPersistidaIA ||
    (creditosIA.saldoPositivo && selFiles.some((f) => isEvidenciaSoportada(f.nombre, f.url)))
  )
  // Tres estados, tres etiquetas — nunca cobra ver algo que ya se generó
  // (pendiente o aplicada), solo generar algo nuevo cobra.
  const labelCalificarConIA = !sugerenciaPersistidaIA
    ? 'Calificar'
    : sugerenciaPersistidaIA._estado === 'aplicada' ? 'Ver evaluación' : 'Ver propuesta'
  // Clamp while typing: never above maxCalif, never below 0, at most 1 decimal.
  // Partial input like "9." is left alone so decimals can still be typed.
  function onCalifChange(e) {
    let raw = e.target.value
    const max = activity?.maxCalif ?? 10
    const n = parseFloat(raw)
    if (!isNaN(n)) {
      if (n > max) raw = String(max)
      else if (n < 0) raw = '0'
      else {
        const m = raw.match(/^(\d+\.\d)\d+$/)
        if (m) raw = m[1]
      }
    }
    setGradeForm((f) => ({ ...f, calificacion: raw }))
  }

  // Botones +/- de la calificación grande en Android — saltos de 0.5,
  // acotados entre 0 y el máximo de la actividad. Partiendo de vacío (sin
  // calificar aún) el + salta directo al máximo y el - a la mitad — de ahí
  // en adelante ya suman/restan de 0.5 en 0.5 normalmente.
  function stepCalif(delta) {
    const max = activity?.maxCalif ?? 10
    const current = parseFloat(gradeForm.calificacion)
    if (isNaN(current)) {
      setGradeForm((f) => ({ ...f, calificacion: String(delta > 0 ? max : max / 2) }))
      return
    }
    const next = Math.min(max, Math.max(0, Math.round((current + delta) * 2) / 2))
    setGradeForm((f) => ({ ...f, calificacion: String(next) }))
  }

  function changeFilterInView(f) {
    const list = applyStudentFilters(f)
    setFilter(f)
    setNavList(list)
    if (list.length && !list.some((s) => s.id === selected.student.id)) {
      openGrade(list[0])
    }
  }

  function goToOffset(off) {
    if (navList.length < 2 || curIdx < 0) return
    const nextIdx = (curIdx + off + navList.length) % navList.length
    const next = navList[nextIdx]
    if (!next) return
    openGrade(next)
  }

  // Navigate submissions with the keyboard arrows while the grading view is open.
  useEffect(() => {
    if (!selected) return
    function onKey(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      // Don't hijack the caret while typing in the grade/comment fields
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      goToOffset(e.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, navList, gradeForm, submissions])

  // Physical Android back button: mirrors the on-screen back arrow / close
  // buttons already wired above. Order doesn't matter here — the module-level
  // stack in useBackHandler only activates whichever of these is actually open.
  useBackHandler(goBack)
  useBackHandler(() => (returnToCalendar ? navigate('/calendario') : setEditingActivity(false)), editingActivity)
  useBackHandler(closeModal, !!selected)
  useBackHandler(() => setNewDateOpen(false), newDateOpen)
  // Ventanas flotantes de anular/modificar fecha en la vista de evaluar de
  // Android — el botón atrás las cierra primero, antes de cerrar toda la vista.
  useBackHandler(() => setAnnulMode(false), IS_NATIVE_APP && annulMode)
  useBackHandler(() => setExtendMode(false), IS_NATIVE_APP && extendMode)

  // Keep the spinner while a grades-table cell is about to open a student, so the
  // list never flashes before the grading view opens.
  if (loading || pendingOpenId) return (
      <EsqueletoActividadDocente />
  )

  // Eliminar actividad — un solo nodo, reutilizado en las dos ramas del
  // ternario de abajo (evaluación y entregable/observación) para que
  // funcione desde cualquiera de los dos tipos.
  const deleteActivityModal = deleteConfirm && activity && (
    <Modal open onClose={() => setDeleteConfirm(false)} variant="centered" z={60} padding="p-4" ariaLabel="¿Eliminar actividad?">
        <h3 className="text-base font-semibold text-on-surface mb-1">¿Eliminar actividad?</h3>
        <p className="text-sm text-muted mb-4">
          &ldquo;<strong>{activity.nombre}</strong>&rdquo; se eliminará permanentemente, junto con las entregas que tenga.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setDeleteConfirm(false)}>Cancelar</Button>
          <Button variant="danger" icon={Trash2} iconEffect="balanceo" busy={deletingActivity} className="flex-1" onClick={handleDeleteActivity} disabled={deletingActivity}>
            
            {deletingActivity ? 'Eliminando…' : 'Eliminar'}
          </Button>
        </div>
      </Modal>
  )

  return (
      <ContextoActividad.Provider value={{ abrirCalificarIA, activity, activityId, activityLabel, annulMode, annulSubmission, annulling, anuladasPorAlumno, aplicarPropuestaIA, califRowRef, calificarIAAbierto, canCreate, cerrarCalificarIA, changeFilterInView, closeModal, comentarioDirty, comentarioVisibleEsExcepcionRef, contarAplicarTodasIA, contarEntregasIA, contarRecalificarIA, counts, curIdx, deleteActivityModal, descartarPropuestaIA, downloadStudentZip, esJuego, extendDate, extendMode, extendMotivo, extensionUnchanged, filter, filtered, getStatus, goBack, goToOffset, gradeForm, handleZipDownload, hasRubrica, instrumentoLabel, isDirty, isEvaluacion, isObservacion, labelCalificarConIA, location, navList, onCalifChange, openGradeFromList, parcialCerrado, pdfPageCount, previewHasImage, previewHasPdf, previewIdx, prorrogaBloqueada, puedeCalificarConIA, returnToGrades, rubricEval, rubricaBtnRef, rubricaViewOpen, saveExtension, saveGrade, saveSinEntrega, saving, savingExtension, savingSinEntrega, searchStudents, selFiles, selected, setActivity, setAnnulMode, setDeleteConfirm, setEditingActivity, setExtendDate, setExtendMode, setExtendMotivo, setFilter, setGradeForm, setPdfPageCount, setPreviewIdx, setRubricaViewOpen, setRubricaWinBottom, setRubricaWinTop, setSearchStudents, setSinEntregaGrade, setSinEntregaMode, setSinEntregaMotivo, setSubmissions, sinEntregaGrade, sinEntregaMode, sinEntregaMotivo, stepCalif, studentZipDownloading, students, subject, submissions, sugerenciaPersistidaIA, sugerenciasLoteIA, telefonoWeb, toast, zipDownloading, zipProgress }}>
    <div {...subjectPaletteProps(subject?.colorPalette)}>
      {/* Evaluaciones render their manager as the page body, but share the
          fullscreen per-student grading overlay below (so a grades-table cell
          opens the SAME panel for every activity type). */}
      <ListaEntregas />

      {/* Fullscreen grading view — preview left (full height), grading panel right.
          Android has its own single-column layout below (IS_NATIVE_APP) — this one
          is web/desktop only. */}
      <PanelCalificar />

      {/* App nativa: sin columnas (pantalla completa), se conserva el panel
          flotante de CalificarConIAModal tal cual (sin `inline`). */}
      {calificarIAAbierto && IS_NATIVE_APP && selected?.sub && hasRubrica && (
        <CalificarConIAModal
          open={calificarIAAbierto}
          onClose={cerrarCalificarIA}
          onDescartar={descartarPropuestaIA}
          actividadId={activityId}
          submissionId={selected.sub.id}
          rubrica={activity.rubrica}
          onAplicar={aplicarPropuestaIA}
          resultadoPersistido={sugerenciaPersistidaIA}
          tiposArchivo={activity?.tiposArchivo}
        />
      )}

      {/* Vista de evaluar en Android — compacta, pensada para que quepa
          completa en una sola pantalla sin necesidad de bajar (docente
          experimentado calificando muchas entregas seguidas). Orden:
          encabezado mínimo (flecha + nombre de actividad) → entrega, tan
          alta como el resto de la pantalla lo permita (mismo tamaño haya o
          no archivos; varias imágenes se navegan hacia abajo, en la misma
          zona) → tabs Todos/Por calificar → número+nombre del alumno (sin
          descripción de archivo) → checkbox + Anterior/Siguiente → rúbrica
          (abre hacia arriba) → calificación grande (arranca en el máximo)
          con pasos de 0.5; anular/modificar fecha son íconos separados que
          abren ventanas flotantes, no empujan el contenido → Guardar
          calificación → historial. Sin comentarios ni "Evaluar sin
          entrega". */}
      <PanelCalificarMovil />

      {/* Anular entrega / Modificar fecha — ventanas flotantes centradas
          (Android), no empujan el contenido de la vista de evaluar. */}
      {selected && IS_NATIVE_APP && annulMode && selected.sub && (
        <Modal open onClose={() => setAnnulMode(false)} variant="centered" padding="p-4" className="space-y-2">
            <p className="text-sm text-red-700">
              ¿Anular la entrega de <strong>{studentFullName(selected.student)}</strong>?
              Volverá a quedar <strong>Pendiente</strong> y podrá entregar de nuevo.
              {selected.sub.calificacion != null && ' La calificación actual se eliminará.'}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1"
                onClick={() => setAnnulMode(false)}
                disabled={annulling}>
                Cancelar
              </Button>
              <Button variant="danger" className="flex-1"
                onClick={annulSubmission}
                disabled={annulling}>
                {annulling ? 'Anulando…' : 'Anular entrega'}
              </Button>
            </div>
          </Modal>
      )}

      {selected && IS_NATIVE_APP && extendMode && !prorrogaBloqueada && (
        <Modal open onClose={() => setExtendMode(false)} variant="centered" padding="p-4" className="space-y-2">
            <p className="text-sm font-medium text-on-surface">Nueva fecha y hora límite para este estudiante</p>
            <EFDateTimePicker
              mode="datetime"
              value={extendDate}
              onChange={setExtendDate}
              clearable={false}
              minDateTime={nowIsoLocal()}
            />
            <div>
              <label htmlFor="act-extend-motivo-native" className="block text-sm font-medium text-muted mb-1">Motivo</label>
              <textarea
                id="act-extend-motivo-native"
                value={extendMotivo}
                onChange={(e) => setExtendMotivo(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-card border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1"
                onClick={() => setExtendMode(false)}>
                Cancelar
              </Button>
              <Button className="flex-1"
                onClick={saveExtension}
                disabled={!extendDate || savingExtension || extensionUnchanged}>
                {savingExtension ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </Modal>
      )}

      {/* Ventana flotante de la rúbrica: inicia abajo del botón "Ver rúbrica" y
          se extiende hacia la izquierda hasta media pantalla, SOBREPUESTA a todo
          — la entrega sigue visible detrás para no perder contexto. Se cierra
          con el mismo botón, con la X o con "Aplicar calificación". */}
      {rubricaViewOpen && hasRubrica && selected && (() => {
        const totalR = totalRubrica(activity.rubrica, rubricEval)
        const faltan = activity.rubrica.criterios.filter((_, i) => rubricEval?.[i] == null).length
        return (
          <div
            // Una lista de cotejo es angosta (Num + Criterio + ¿Cumple? +
            // PUNTOS): estirada de la mitad al borde dejaba una franja blanca
            // enorme a la derecha y tapaba de más el área de trabajos. Se ciñe
            // al ancho de la tabla y se pega al borde DERECHO, dejando libre
            // toda la izquierda, que es donde está la lista por revisar.
            // La rúbrica completa NO: tiene una columna por nivel y sí
            // aprovecha el ancho, así que conserva el anclaje a la mitad.
            //
            // El `md:left-*` va en una sola rama y no repetido en la base: dos
            // utilidades del mismo grupo (left-1/2 y left-auto) tienen la misma
            // especificidad y ganaría la que Tailwind emita después, no la que
            // se escriba al final de la cadena.
            className={`fixed left-2 right-2 z-50 bg-surface-card border border-outline-variant rounded-card shadow-2xl flex flex-col overflow-hidden ${
              esCotejo(activity.rubrica)
                ? 'md:left-auto md:w-[610px] md:max-w-[calc(100vw_-_1rem)]'
                : 'md:left-1/2'
            }`}
            // En Android se ancla por `bottom` y crece hacia arriba (pedido
            // explícitamente); en web sigue anclada por `top`, hacia abajo.
            style={IS_NATIVE_APP
              ? { bottom: rubricaWinBottom, maxHeight: `calc(100vh - ${rubricaWinBottom + 60}px)` }
              : { top: rubricaWinTop, maxHeight: `calc(100vh - ${rubricaWinTop + 10}px)` }}
          >
            {/* Mismo par de colores que la etiqueta del banco: azul = rúbrica,
                violeta = lista de cotejo (ver instrumentoColors). */}
            <div className={`flex items-center gap-2 px-3 py-2 border-b border-outline-variant flex-shrink-0 ${instrumentoColors(activity.rubrica).bg}`}>
              {esCotejo(activity.rubrica)
                ? <ListChecks size={ICONO.sm} className={`${instrumentoColors(activity.rubrica).icon} flex-shrink-0`} />
                : <ClipboardList size={ICONO.sm} className={`${instrumentoColors(activity.rubrica).icon} flex-shrink-0`} />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-on-surface truncate">
                  <span className={instrumentoColors(activity.rubrica).text}>{esCotejo(activity.rubrica) ? 'Lista de cotejo' : 'Rúbrica'}</span>: {activity.rubrica.titulo}
                </p>
                <p className="text-[11px] text-muted truncate">
                  {esCotejo(activity.rubrica)
                    ? 'Marca los criterios que cumple — la calificación se calcula sola'
                    : 'Marca una opción por renglón — la calificación se calcula sola'}
                </p>
              </div>
              <IconButton icon={X} label="Cerrar rúbrica" tooltip={false} onClick={() => setRubricaViewOpen(false)}
               
                data-tooltip="Cerrar rúbrica" />
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-3">
              <RubricaGradeTable
                rubrica={activity.rubrica}
                seleccion={rubricEval}
                onSelect={selectRubricaNivel}
                disabled={parcialCerrado}
                compact={!IS_NATIVE_APP}
              />
            </div>
            <div className="p-2 border-t border-outline-variant flex-shrink-0">
              <Button fullWidth
                disabled={saving || parcialCerrado || totalR == null}
                onClick={async () => {
                  // Acción explícita del docente: convierte el total de la
                  // rúbrica en calificación definitiva. Si el docente no
                  // había tocado ningún nivel manualmente (gradeForm.calificacion
                  // sigue vacío), se pasa como override para no depender de
                  // setState async. Luego se sincroniza el input para coherencia.
                  const override = !gradeForm.calificacion && totalR != null ? totalR : null
                  if (await persistGrade(override)) {
                    if (override != null) setGradeForm((f) => ({ ...f, calificacion: String(override) }))
                    toast('Calificación guardada')
                  }
                  setRubricaViewOpen(false)
                }}>
                Aplicar y guardar calificación{totalR != null ? ` — ${totalR} / ${RUBRICA_TOTAL}` : ` (faltan ${faltan})`}
              </Button>
            </div>
          </div>
        )
      })()}


      {loteIAConteo && (
        <ConfirmacionCreditosModal
          titulo={loteIAConteo.recalificar ? 'Recalificar todas con IA' : 'Calificar todas con IA'}
          descripcion={loteIAConteo.recalificar
            ? `Se generará una propuesta NUEVA de calificación (con la rúbrica/lista de cotejo actual) para ${loteIAConteo.entregas} entrega${loteIAConteo.entregas !== 1 ? 's' : ''} con evidencia. Las que no tienen calificación, o cuya calificación puso antes la IA, se ACTUALIZAN solas con la propuesta nueva.` +
              (loteIAConteo.yaCalificadas > 0
                ? ` ${loteIAConteo.yaCalificadas} de ellas ya tienen una calificación tuya: por omisión NO se tocan, quedan como propuesta para que las revises.`
                : '') +
              ' El valor anterior de cada calificación que cambie queda guardado en el historial de la entrega. No se toca ninguna entrega ni archivo.'
            : (loteIAConteo.totalPorCalificar > loteIAConteo.entregas
                ? `Se generará una propuesta de calificación con IA para ${loteIAConteo.entregas} de las ${loteIAConteo.totalPorCalificar} entregas por calificar. La IA solo propone: tú revisas y confirmas cada una al calificar a ese estudiante.`
                : `Se generará una propuesta de calificación para ${loteIAConteo.entregas} entrega${loteIAConteo.entregas !== 1 ? 's' : ''} pendiente${loteIAConteo.entregas !== 1 ? 's' : ''}. La IA solo propone: tú revisas y confirmas cada una al calificar a ese estudiante.`)}
          costoMin={creditosIA.estimar(claveOperacionLote, loteIAConteo.entregas) ?? loteIAConteo.entregas * 0.5}
          ejecutando={loteIATrabajando}
          onCancelar={() => { if (!loteIATrabajando) setLoteIAConteo(null) }}
          onContinuar={ejecutarLoteIA}
        >
          {loteIAConteo.recalificar && loteIAConteo.yaCalificadas > 0 && (
            <Checkbox
              checked={sobrescribirCalificadas}
              onChange={(e) => setSobrescribirCalificadas(e.target.checked)}
              disabled={loteIATrabajando}
              label={`Reemplazar también mis ${loteIAConteo.yaCalificadas} calificaci${loteIAConteo.yaCalificadas !== 1 ? 'ones' : 'ón'} con las de la IA`}
              hint="Sin marcar, esas entregas no cambian. Marcada, cada calificación anterior queda en el historial."
            />
          )}
          {!loteIAConteo.recalificar && loteIAConteo.totalPorCalificar > loteIAConteo.entregas && (
            <p
              className="text-sm text-muted"
              data-tooltip="Puede quedar fuera porque ya tiene una propuesta de IA pendiente, o porque no tiene evidencia en un formato compatible (JPG, PNG, PDF o Word)."
            >
              {loteIAConteo.totalPorCalificar - loteIAConteo.entregas === 1
                ? '1 entrega no es elegible para IA en este momento.'
                : `${loteIAConteo.totalPorCalificar - loteIAConteo.entregas} entregas no son elegibles para IA en este momento.`}
            </p>
          )}
        </ConfirmacionCreditosModal>
      )}

      {/* "Aplicar calificaciones de IA a todas" (Modo 1) — confirmación SIN
          costo, deliberadamente distinta de ConfirmacionCreditosModal (que
          siempre habla de créditos): esta acción no genera IA nueva, así que
          no debe insinuar ningún cobro. */}
      {aplicarTodasConteo && (
        <ConfirmModal
          title="Aplicar calificaciones de IA a todas"
          message={`Se aplicará la calificación propuesta por la IA a ${aplicarTodasConteo.entregas} entrega${aplicarTodasConteo.entregas !== 1 ? 's' : ''} que ya tienen una propuesta pendiente. Si alguna ya tiene una calificación tuya, no se reemplaza. No se hará ninguna evaluación nueva con IA y no se consumirán créditos.`}
          confirmLabel="Aplicar a todas"
          confirmingLabel="Aplicando…"
          busy={aplicarTodasTrabajando}
          onConfirm={ejecutarAplicarTodasIA}
          onCancel={() => { if (!aplicarTodasTrabajando) setAplicarTodasConteo(null) }}
        />
      )}

      {editingActivity && activity && (
        <EntregableEditor
          activityId={activityId}
          parcial={activity.parcial}
          parcialCerrado={parcialCerrado}
          categoria={activity.categoria || 'entregable'}
          subjectId={activity.asignaturaId}
          docenteId={activity.docenteId}
          existingActivities={[]}
          activityLabel={activityLabel}
          onDeleteActivity={() => setDeleteConfirm(true)}
          onClose={() => (returnToCalendar ? navigate('/calendario') : setEditingActivity(false))}
          onActivityUpdated={(updated) => {
            setActivity((prev) => ({ ...prev, ...updated }))
            if (returnToCalendar) { navigate('/calendario'); return }
            setEditingActivity(false)
          }}
          initialForm={{
            nombre: activity.nombre || '',
            instrucciones: activity.instrucciones || '',
            fechaLimite: activity.fechaLimite || '',
            tiposArchivo: activity.tiposArchivo || ['todos'],
            extensionesCustom: activity.extensionesCustom || '',
            oculta: activity.oculta ?? false,
            publishAt: activity.publishAt || '',
            publishedAt: activity.publishedAt || '',
            // 'published', no 'show': 'show' significa "publicar AHORA MISMO" y
            // resolveVisibilidad valida la fecha límite contra ese instante de
            // guardado (no contra publishedAt) — en una actividad ya publicada
            // eso comparaba la fecha límite contra la hora de editar, no contra
            // la hora real de publicación, y rechazaba fechas límite válidas.
            visibilidadMode: activity.publishedAt ? 'published' : (activity.publishAt ? 'schedule' : 'hide'),
            // Checkbox reads the positive framing ("cerrar en fecha"); the real DB field
            // (recibirTarde) is the inverse — see EntregableEditor's save payload.
            cerrarEntregasEnFecha: !activity.recibirTarde,
            rubrica: activity.rubrica || null,
            rubricaId: activity.rubricaId || null,
            rubricaVisibleAlumno: activity.rubricaVisibleAlumno !== false,
            comentarioVisibleAlumno: activity.comentarioVisibleAlumno !== false,
            notificarDocente: activity.notificarDocente || false,
          }}
          initialExistingFiles={activity.archivosAdjuntos || []}
          contextLine={subjectDisplayName(subject)}
          onNuevaFecha={isPublished && !parcialCerrado ? () => setNewDateOpen(true) : undefined}
          externalFechaLimite={activity.fechaLimite || ''}
          students={students}
          extensiones={activity.extensiones || {}}
          extensionesMotivo={activity.extensionesMotivo || {}}
        />
      )}

      {/* Nueva fecha de entrega: for the whole group or for selected students.
          Renders above the EntregableEditor (its z-aviso > editor's z-50) when opened from it. */}
      {newDateOpen && (
        <NuevaFechaEntregaModal
          activityId={activityId}
          students={students}
          onClose={() => setNewDateOpen(false)}
          onSaved={applyNewDateResult}
        />
      )}

      {/* Eliminar actividad — desde su propia edición, entregable/observación
          o evaluación, publicada o borrador. */}
      {deleteActivityModal}

      </div>
    </ContextoActividad.Provider>
  )
}
