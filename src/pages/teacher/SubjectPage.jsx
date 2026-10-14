import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  collection, query, where, getDocs, getDoc,
  doc, serverTimestamp, deleteField, arrayUnion, arrayRemove,
} from 'firebase/firestore'
// Las escrituras pasan por el candado de suscripción vencida (mismos nombres y
// firmas que 'firebase/firestore'); leer sigue siendo directo.
import { addDoc, updateDoc, deleteDoc, writeBatch } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import Select from '../../components/ui/Select'
import { exportSubjectGrades, exportParcialGrades, exportRankingExcel, exportSubjectAttendance, exportParcialAttendance, parseStudentExcel } from '../../utils/excel'
import { importActivitiesToSubject } from '../../utils/importActivities'
import { camposComunesCopia, nombreParaCopia, esCopiable, esJuego } from '../../utils/copiaActividad'
import { copiarClaveJuego } from '../../utils/juegoClave'
import { exportSubjectGradesPDF, exportParcialGradesPDF, exportRankingPDF, exportCredentialsPDF } from '../../utils/pdf'
import { membreteDe } from '../../utils/membrete'
import { buildJobsForSubject, downloadSubmissionsZip } from '../../utils/downloadSubmissions'
import { deleteSubjectCascade, deleteSubjectStudents, deleteSubmissionsByStudent, deleteSubmissionsByActivity } from '../../utils/deleteSubjectCascade'
import { copySubject } from '../../utils/copySubject'
import { fmtAttDateParts, loadAttendanceRecords, createAttendanceDay, attendanceState, nextAttendanceState, setAttendanceState, countPresence, deleteAttendanceDay } from '../../utils/attendance'
import { diasInformativosAsistencia, esSesionInformativa } from '../../utils/asistenciaInformativa'
import { cargarObservacionesAsistencia, crearObservacionAsistencia, editarObservacionAsistencia, eliminarObservacionAsistencia, eliminarObservacionesDeAlumno, imprimirBitacora } from '../../utils/observacionesAsistencia'
import { ordenarBitacora, etiquetaFechaObservacion, observacionId, llaveCeldaObservacion } from '../../utils/observacionesBitacora'
import MenuContextualAsistencia from '../../components/asistencia/MenuContextualAsistencia'
import ObservacionModal from '../../components/asistencia/ObservacionModal'
import BitacoraObservacionesModal from '../../components/asistencia/BitacoraObservacionesModal'
import { syncAutoAttendanceDays, diasSinAsistenciaEnCurso, fetchAsuetosVacaciones, fetchClaseDiasSemana, parcialForDate } from '../../utils/attendanceAuto'
import { calcularSesionesReales } from '../../utils/sesionesReales'
import { diaSemanaLunes, DIAS_SEMANA, derivarPatrones, tramosFaltantes, generarBloques } from '../../utils/horarioBloques'
import { escuelaValida } from '../../utils/escuela'
import { buildAsuetoMap, esAsuetoPara } from '../../utils/asuetos'
import { buildVacacionMap, fechasVacacionParaClases } from '../../utils/vacaciones'
import { lockLandscape, lockPortrait } from '../../utils/orientation'
import { hideStatusBar, showStatusBar } from '../../utils/statusBar'
import { withDefaultTime, isDraftActivity, cuentaParaCalificacion } from '../../utils/activityVisibility'
import { pesoDe, promedioParcial, ponderacionActivaEnParcial, normalizeGrade, puedeIniciarAtencion, parcialCerrado, mensajeParcialCerrado, esNotaAutomaticaDeCierre } from '../../utils/ponderacion'
import { playAlertSound } from '../../utils/notify'
import { subjectDisplayName } from '../../utils/subjectName'
import { formatShortDate, formatShortDateRange } from '../../utils/dateRange'
import { IS_NATIVE_APP } from '../../utils/platform'
import useTelefonoWeb from '../../hooks/useTelefonoWeb'
import { descargaSoloWeb } from '../../utils/descargaSoloWeb'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import SubjectIcon from '../../components/SubjectIcon'
import EFDateTimePicker from '../../components/EFDateTimePicker'
import { normalizeParcialesFechas } from '../../components/ParcialesFechas'
import { fechaLimiteTimestamp } from '../../utils/deadline'
import { submissionDocId } from '../../utils/submissionId'
import { EntregaCambio, tieneEvidencia, elegibleSinEntrega, crearSiNoExiste, actualizarSiNoCambio, sinEntregaEnLote } from '../../utils/submissionGuard'
import { htmlToPlainText, sanitizeHtml, toRichHtml } from '../../utils/sanitizeHtml'
import { CUSTOM_FILE_TYPE, normalizeFileTypeKeys, parseCustomExts } from '../../config/fileTypes'
import { TEACHER_CONTAINER } from '../../config/layout'
import { uploadToCloudinary } from '../../utils/cloudinary'
import { isResourceFileAllowed } from '../../utils/resourceTypes'
import { ArrowLeft, X, Pencil, Trash2, Archive, ArchiveRestore, ChevronRight, Check as CheckIcon, Copy, BookOpen, CalendarPlus, AlertTriangle } from 'lucide-react'
import { generateUsername, generateResetPassword } from '../../utils/generate'
import { findStudentIdentity, findSimilarIdentity, studentNameKey } from '../../utils/studentIdentity'
import { matchesStudentSearch, studentFullName } from '../../utils/studentSearch'
import { capitalizarNombre, sinAcentos } from '../../utils/nombres'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import AvisosTab from '../../components/subject/AvisosTab'
import PlaneacionDidacticaTab from '../../components/subject/PlaneacionDidacticaTab'
import { isPerfilIACompleto } from '../../utils/perfilIA'
import { Button, IconButton, Modal } from '../../components/ui'
import { EsqueletoAsignaturaDocente } from '../../components/esqueletos'
import { ICONO } from '../../config/iconos'


import { AttendanceTable } from './subject/piezas'
import { EMPTY_FORM, EMPTY_MATERIAL_FORM, ETIQUETA_SECCION, EVALUACION_DEFAULTS, GRUPOS_SECCIONES, MAX_ATTACHMENT_FILE_SIZE, MAX_RESOURCE_SIZE, buildDenominadoresPorParcial, buildUnifiedParcial, computeMaterialOrdenes, fetchSubmissionsForActivities, nombresBreves } from './subject/utilidades'
import TabActividades from './subject/TabActividades'
import TabCalificaciones from './subject/TabCalificaciones'
import TabAsistencia from './subject/TabAsistencia'
import TabLista from './subject/TabLista'
import TabRecursos from './subject/TabRecursos'
import ModalesAsignatura from './subject/ModalesAsignatura'
import EditoresAsignatura from './subject/EditoresAsignatura'
import { ContextoAsignatura } from './subject/contexto'
import { fetchApi } from '../../utils/apiBase'
export default function SubjectPage() {
  const { subjectId } = useParams()
  const { currentUser, userProfile } = useAuth()
  // Modelo de créditos puros (20-ago-2026): crear contenido ya no depende de
  // ninguna suscripción — todo lo no-IA es gratis para cualquier docente. Las
  // exportaciones ya NO llevan marca de agua (no existe suscripción/trial que
  // gatee eso) — ver [[project_modelo_precios_ia_complemento]].
  const canCreate = true
  // Asistencia es GRATUITA (26-ago-2026): pasar lista no consume créditos y
  // tampoco los exige. El candado anterior por saldo — banner, modales, el
  // `saldoIAPositivo` de firestore.rules y el `useCreditosIA` que los
  // alimentaba — se retiró completo. Las funciones de IA de esta pantalla
  // consultan el saldo por su cuenta, cada una en su propio componente.
  // Asistente IA (FASE 2-BIS del Plan Maestro de IA) solo aparece si el
  // docente ya completó su Perfil para IA — mismo contexto para todas sus
  // asignaturas, capturado una sola vez (ver /perfil-ia).
  const perfilIACompleto = isPerfilIACompleto(userProfile?.perfilIA)
  // Escuela + docente que encabezan cada PDF/Excel que se descarga de aquí.
  const membrete = membreteDe(userProfile)
  // Diálogo de "Analizar asignatura con IA" (pestaña Calificaciones).
  const [analisisAsignaturaAbierto, setAnalisisAsignaturaAbierto] = useState(false)
  const [subject, setSubject] = useState(null)
  // Lectura única del umbral institucional de inasistencia al montar.
  useEffect(() => {
    const escuelaId = userProfile?.escuelaId
    if (!escuelaId) return
    getDoc(doc(db, 'schools', escuelaId)).then((snap) => {
      if (snap.exists()) {
        const u = snap.data().umbralInasistencia
        if (typeof u === 'number' && u > 0) setUmbralInasistencia(u)
      }
    }).catch(() => {})
  }, [userProfile?.escuelaId])
  const [activities, setActivities] = useState([])
  const [submissionCounts, setSubmissionCounts] = useState({})
  // Conteo de estudiantes que trajo loadAll(). No se usa directo: ver
  // `totalStudents` más abajo, que es el que manda una vez cargada la lista.
  const [studentCountAtLoad, setStudentCountAtLoad] = useState(0)
  const [openParcial, setOpenParcial] = useState(1)
  // Filtro de presentación por parcial ({ 1: true, … }); solo en memoria.
  const [soloCalificables, setSoloCalificables] = useState({})

  // Activity modal
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [modalParcial, setModalParcial] = useState(1)
  const [editActivityId, setEditActivityId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  // null = showing the tipo picker, 'entregable'|'cuestionario'|'examen' = form visible
  const [tipoActividad, setTipoActividad] = useState(null)
  // Navegación del picker "Nueva actividad" (reorganización 23-ago-2026):
  // null (raíz: 4 categorías) | 'entregable' | 'evaluacion' (2do nivel:
  // Cuestionario/Examen) | 'cuestionario' | 'examen' | 'observacion' |
  // 'interactiva' (Crucigrama/Sopa de letras). Puramente de navegación —
  // las acciones de cada hoja llaman los mismos setters que ya existían
  // (setEntregableEditor/setCrearActividadIA/setCrearEvalIA/setCrearJuegoIA),
  // sin tocar el modelo de datos: "con IA" nunca fue un valor guardado en
  // `categoria`, siempre fue solo la llave de este menú.
  const [menuPaso, setMenuPaso] = useState(null)
  // OP-03/OP-04 · Examen/Cuestionario con IA: null | { categoria }
  const [crearEvalIA, setCrearEvalIA] = useState(null)
  // OP-05 · Entregable/Observación con IA: null | { categoria }
  const [crearActividadIA, setCrearActividadIA] = useState(null)
  // Crucigrama/Sopa de letras con IA: null | { tipoJuego }
  const [crearJuegoIA, setCrearJuegoIA] = useState(null)
  // Video interactivo con IA: false | true
  const [crearVideoIA, setCrearVideoIA] = useState(false)
  // Full-screen evaluación editor (cuestionario / examen)
  const [evalEditor, setEvalEditor] = useState(null) // null | { activityId, categoria, parcial }
  // Full-screen entregable editor
  const [entregableEditor, setEntregableEditor] = useState(null) // null | { activityId, parcial, categoria, activityLabel, initialForm, initialExistingFiles }
  // "Nueva fecha de entrega" modal, offered from within entregableEditor once published
  const [newDateOpen, setNewDateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [publishDraftConfirm, setPublishDraftConfirm] = useState(null) // draft activity | null
  const [duplicateConfirm, setDuplicateConfirm] = useState(null) // activity | null
  const [duplicating, setDuplicating] = useState(false)
  // Cambiar de lugar una actividad dentro de su parcial: null | { a, newList, changes }
  // `changes` = actividades cuyo número (1.2., 1.3.…) cambia con el movimiento.
  const [moveConfirm, setMoveConfirm] = useState(null)
  const [moving, setMoving] = useState(false)
  // PONDERACIÓN: in-progress weight edits per activity id (committed on blur)
  const [pesoEdits, setPesoEdits] = useState({})
  // Anchored confirmation panel for reverting to simple average
  const [confirmRevertPonderacion, setConfirmRevertPonderacion] = useState(false)
  const [confirmRevertParcial, setConfirmRevertParcial] = useState(null) // parcial number | null
  // Cerrar parcial: null | { p, missing: [{s, a}], ungraded }
  const [closeParcialConfirm, setCloseParcialConfirm] = useState(null)
  const [closingParcial, setClosingParcial] = useState(false)
  // Grade applied to all no-entregas when closing a parcial (default 5)
  const [closeParcialGrade, setCloseParcialGrade] = useState('5')
  // Número de sesiones confirmado por el docente al cerrar — pre-llenado con la estimación del servidor
  const [closeParcialSesiones, setCloseParcialSesiones] = useState('')
  // Umbral institucional de inasistencia (%) leído del documento de la escuela; por defecto 20 si no existe
  const [umbralInasistencia, setUmbralInasistencia] = useState(20)
  // Orden de la tabla de Asistencias — clon del patrón de Calificaciones
  const [attSortOn, setAttSortOn] = useState(false)
  const [attSortParcial, setAttSortParcial] = useState(null) // null = general
  const [revertParcialConfirm, setRevertParcialConfirm] = useState(null) // parcial number | null
  const [revertingParcial, setRevertingParcial] = useState(false)
  // Iniciar atención de inquietudes: null | parcial number
  const [atencionParcialConfirm, setAtencionParcialConfirm] = useState(null)
  const [iniciandoAtencion, setIniciandoAtencion] = useState(false)
  // Kebab menu per parcial header: null | { p, x, y } (fixed coords from the ⋮ button)
  const [parcialMenu, setParcialMenu] = useState(null)
  // Asistencia — Excel split-button ⋮ dropdown (por parcial): boolean
  const [attExportMenu, setAttExportMenu] = useState(false)
  const [exportingAttendance, setExportingAttendance] = useState(false)
  // Activity-name tooltip over the grades-table number headers: null | { text, x, y }
  const [actTip, setActTip] = useState(null)
  // Per-activity ⋮ menu (Duplicar / Eliminar): null | { a, x, y }
  const [activityMenu, setActivityMenu] = useState(null)
  // "Traer actividad de otra asignatura" flow
  const [importFor, setImportFor] = useState(null)        // target parcial | null (modal open)
  const [importSubjects, setImportSubjects] = useState([]) // teacher's other subjects
  const [importSrc, setImportSrc] = useState(null)         // chosen source subject
  const [importSrcActs, setImportSrcActs] = useState([])   // that subject's activities
  const [importSel, setImportSel] = useState(new Set())    // selected activity ids
  const [importLoading, setImportLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [archiving, setArchiving] = useState(false)
  // Files attached to the activity's instructions (RichTextEditor's "Adjuntar
  // archivo" button) — support material for the alumno, NOT evidence: kept
  // entirely separate from `submissions`, never required, never graded.
  const [activityExistingFiles, setActivityExistingFiles] = useState([]) // [{url,nombre,tamano}]
  const [activityNewFiles, setActivityNewFiles] = useState([]) // File[] pending upload

  // Materials ("Material de apoyo") — independent of Activity: scoped per
  // parcial like activities, but never creates a submission/grade. Loaded
  // together with activities in loadAll() (not lazily, since it lives
  // inline in the Actividades tab, not behind its own tab).
  const [materials, setMaterials] = useState([])
  const [showMaterialModal, setShowMaterialModal] = useState(false)
  const [materialModalMode, setMaterialModalMode] = useState('create')
  const [materialParcial, setMaterialParcial] = useState(1)
  const [editMaterialId, setEditMaterialId] = useState(null)
  const [materialForm, setMaterialForm] = useState(EMPTY_MATERIAL_FORM)
  const [materialNewFiles, setMaterialNewFiles] = useState([]) // File[] pending upload
  const [materialExistingFiles, setMaterialExistingFiles] = useState([]) // [{url,nombre,tamano}] kept on edit
  const [savingMaterial, setSavingMaterial] = useState(false)
  const [deleteMaterialConfirm, setDeleteMaterialConfirm] = useState(null)
  const [deletingMaterial, setDeletingMaterial] = useState(false)
  const [expandedMaterialId, setExpandedMaterialId] = useState(null)
  const [dragMatId, setDragMatId] = useState(null)          // id of material being dragged
  const [dragDraftId, setDragDraftId] = useState(null)      // id of draft activity being dragged (mismas zonas de soltar)
  const [dropZoneActive, setDropZoneActive] = useState(null) // {parcial, idx} of highlighted drop zone

  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportingGradesPdf, setExportingGradesPdf] = useState(false)
  const [generatingCredentials, setGeneratingCredentials] = useState(false)
  const [showCredentialsModal, setShowCredentialsModal] = useState(false)
  const [zipDownloading, setZipDownloading] = useState(false)
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 })

  // Activity visibility

  // Navigation state: puede pedir una pestaña concreta (al volver de calificar)
  // o abrir el modal de editar asignatura (al venir de "Programar bloques").
  const routerLocation = useLocation()

  // Subject CRUD
  // Arranca abierto si se llegó con `openEditSubject`: "Programar bloques" de
  // una asignatura SIN fechas ya no las pide allá, manda aquí, que es donde
  // viven (y de donde salen los periodos de cada parcial). Se inicializa aquí
  // y no en un efecto para no encadenar un render de más.
  const [showEditSubjectModal, setShowEditSubjectModal] = useState(
    () => !!routerLocation.state?.openEditSubject,
  )
  const [editSubjectForm, setEditSubjectForm] = useState({ nombre: '', grupo: '', fechaInicio: '', fechaFin: '', parciales: '3', colorPalette: 'default', icon: 'book' })
  const [editingSubject, setEditingSubject] = useState(false)
  const [showDeleteSubjectConfirm, setShowDeleteSubjectConfirm] = useState(false)
  const [deleteSubjectConfirmText, setDeleteSubjectConfirmText] = useState('')
  const [deletingSubject, setDeletingSubject] = useState(false)
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [copyForm, setCopyForm] = useState({ nombre: '', grupo: '', keepStudents: false, colorPalette: 'default', icon: 'book' })
  const [copyFechas, setCopyFechas] = useState({ fechaInicio: '', fechaFin: '' })
  const [copyingSubject, setCopyingSubject] = useState(false)

  // Unarchive modal
  const [showUnarchiveModal, setShowUnarchiveModal] = useState(false)
  const [unarchiveStudents, setUnarchiveStudents] = useState('keep') // 'keep' | 'reset'
  const [unarchiveActivities, setUnarchiveActivities] = useState('keep') // 'keep' | 'show' | 'hide'
  const [unarchiveEdits, setUnarchiveEdits] = useState({ nombre: '', grupo: '', fechaInicio: '', fechaFin: '', parciales: '3', colorPalette: 'default', icon: 'book' })
  const [unarchivedSaving, setUnarchivedSaving] = useState(false)
  // Archive flow
  const [showArchiveModal, setShowArchiveModal] = useState(false)
  // Respaldo ZIP al archivar: opcional y apagado por omisión. Antes era una
  // disyuntiva obligada ("guardar" o "sin guardar") porque las entregas se
  // borraban; ya no se borran, así que dejarla sería preguntar por nada.
  const [archiveConZip, setArchiveConZip] = useState(false)

  // Tomar lista en el TELÉFONO desde el navegador — vista simplificada a
  // pantalla completa (ver el bloque "TAB: ASISTENCIA"). En la app nativa
  // useTelefonoWeb siempre da false: la app sigue con su propia vista.
  const telefonoWeb = useTelefonoWeb()
  // Calificaciones y Planeación Didáctica no están disponibles en el teléfono
  // (web): si se llega con una de esas pestañas ya puesta (p. ej. state.tab al
  // volver de una actividad), se arranca en Actividades.
  const [activeTab, setActiveTab] = useState(() => {
    const tab = routerLocation.state?.tab || 'actividades'
    return telefonoWeb.telefono && (tab === 'calificaciones' || tab === 'asistente-ia') ? 'actividades' : tab
  })
  const tomarListaMovil = telefonoWeb.telefono && activeTab === 'asistencia'
  // Modales de asistencia (Agregar día, Motivo) en su versión horizontal: la
  // de la app y, en el teléfono girado (web), la misma — la versión apilada no
  // cabe en ~360px de alto.
  const modalAsistenciaHorizontal = IS_NATIVE_APP || (tomarListaMovil && telefonoWeb.horizontal)

  // Pista de que la barra de pestañas se puede deslizar — en la App, con 6
  // pestañas angostas, algunas quedan fuera de vista sin ningún indicio de
  // que hay más a la derecha (pedido explícito, mismo criterio que la barra
  // del alumno).
  const tabsScrollRef = useRef(null)
  const [tabsOverflow, setTabsOverflow] = useState(false)
  // Depende de `loading` (igual que la barra del alumno) y no de []: mientras
  // la asignatura carga, esta pantalla devuelve solo el spinner y la barra de
  // pestañas todavía no existe en el DOM. Con [] el efecto corría una única
  // vez contra un ref vacío, se salía por el `if (!el)` y ya nunca volvía a
  // correr — la flecha estaba programada pero no aparecía jamás.
  useEffect(() => {
    const el = tabsScrollRef.current
    if (!el) return undefined
    function check() {
      setTabsOverflow(el.scrollWidth - el.clientWidth - el.scrollLeft > 4)
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => {
      el.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
  }, [loading])

  // Shared students (used by calificaciones + alumnos tab)
  const [groupStudents, setGroupStudents] = useState([])
  const [groupStudentsLoaded, setGroupStudentsLoaded] = useState(false)

  // Cuántos estudiantes tiene la asignatura AHORA MISMO. Derivado, no estado:
  // mientras no se haya abierto la pestaña Estudiantes vale el conteo que trajo
  // loadAll(); en cuanto esa lista existe en memoria, manda ella. Antes esto era
  // un useState que solo se llenaba en loadAll(), así que agregar estudiantes
  // (a mano o por Excel) actualizaba la lista pero NO el conteo: el aviso de
  // "aún no tienes estudiantes" seguía ahí hasta recargar la página.
  const totalStudents = groupStudentsLoaded ? groupStudents.length : studentCountAtLoad
  // Agrupación de las secciones en tres cabeceras (oct-2026, opción B):
  // Actividades · Estudiantes (Lista, Asistencias, Calificaciones) · Clase
  // (Recursos, Avisos, Planeación). Se filtran por lo que cada plataforma
  // permite ver; una cabecera sin secciones visibles no se muestra.
  const seccionesVisibles = IS_NATIVE_APP
    ? ['actividades', 'asistencia', 'alumnos', 'recursos', 'avisos', 'asistente-ia']
    : telefonoWeb.telefono
      ? ['actividades', 'asistencia', 'alumnos', 'recursos', 'avisos']
      : ['actividades', 'calificaciones', 'asistencia', 'alumnos', 'recursos', 'avisos', 'asistente-ia']
  const gruposVisibles = GRUPOS_SECCIONES
    .map((g) => ({ ...g, tabs: g.tabs.filter((t) => seccionesVisibles.includes(t)) }))
    .filter((g) => g.tabs.length > 0)
  const grupoActivo = gruposVisibles.find((g) => g.tabs.includes(activeTab))
  // Píldora blanca que se DESLIZA a la cabecera elegida, igual que ui/Tabs
  // (Perfil, Notificaciones). La barra sigue hecha a mano porque marca en rojo
  // las cabeceras que requieren atención; solo la píldora es compartida. La
  // primera medición la coloca sin animar; después, se desliza.
  const botonesGrupo = useRef({})
  const [pildoraGrupo, setPildoraGrupo] = useState(null)
  const [animarPildora, setAnimarPildora] = useState(false)
  const grupoActivoId = grupoActivo?.id
  const clavesGrupos = gruposVisibles.map((g) => g.id).join(',')
  useLayoutEffect(() => {
    const barra = tabsScrollRef.current
    if (!barra) return undefined
    const medir = () => {
      const el = botonesGrupo.current[grupoActivoId]
      if (el) setPildoraGrupo({ x: el.offsetLeft, w: el.offsetWidth })
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(barra)
    return () => ro.disconnect()
  }, [grupoActivoId, clavesGrupos, loading])
  useEffect(() => {
    if (!pildoraGrupo || animarPildora) return undefined
    const id = requestAnimationFrame(() => setAnimarPildora(true))
    return () => cancelAnimationFrame(id)
  }, [pildoraGrupo, animarPildora])
  // Parciales que ya se abrieron alguna vez: su contenido se queda montado para
  // poder animar el cierre (ver «Abrir/cerrar animado»).
  const parcialesVistos = useRef(new Set())
  if (openParcial) parcialesVistos.current.add(openParcial)
  // Todas las secciones miden lo mismo que el encabezado (config/layout.js,
  // oct-2026): sus bordes coinciden con los de la tarjeta de arriba.
  const anchoSeccion = TEACHER_CONTAINER
  // Al volver a una cabecera se abre la última sección que usaste en ella.
  const ultimaDeGrupo = useRef({})
  if (grupoActivo) ultimaDeGrupo.current[grupoActivo.id] = activeTab

  // Pestañas que piden atención (se marcan en rojo con un punto) y QUÉ hay que
  // hacer en ellas. Añade aquí otra pestaña con su motivo y el diseño es el
  // mismo (ver DESIGN_SYSTEM §6.4 «Pestaña que requiere atención»).
  const atencionPestanas = {
    alumnos: totalStudents === 0
      ? `Aún no hay estudiantes. Agrégalos aquí${IS_NATIVE_APP ? ' (la plantilla de Excel se usa desde la web)' : ' a mano o con la plantilla de Excel'} para poder compartir el código de acceso.`
      : null,
  }

  // Copy feedback
  const [copiedCode, setCopiedCode] = useState(false)

  // Student management (Alumnos tab)
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [studentToDelete, setStudentToDelete] = useState(null)
  const [studentToEdit, setStudentToEdit] = useState(null)
  const [editStudentForm, setEditStudentForm] = useState({ apellidoPaterno: '', apellidoMaterno: '', nombre: '', comentarios: '' })
  const [studentLastAccess, setStudentLastAccess] = useState(null)
  const [studentToReset, setStudentToReset] = useState(null)
  const [resetPwdResult, setResetPwdResult] = useState(null) // { student }
  const [linkCandidate, setLinkCandidate] = useState(null) // { person, identity, schoolDocs }
  const [newStudent, setNewStudent] = useState({ apellidoPaterno: '', apellidoMaterno: '', nombre: '' })
  const [savingStudent, setSavingStudent] = useState(false)
  const [searchAlumnos, setSearchAlumnos] = useState('')
  // Filtro por estado de activación en la lista de estudiantes — pedido
  // explícito: con grupos grandes no había forma de ver de un vistazo quién
  // ya se activó y quién todavía no.
  const [filtroActivacion, setFiltroActivacion] = useState('todos') // 'todos' | 'activo' | 'sin_activar'
  const [estadoFiltroOpen, setEstadoFiltroOpen] = useState(false)
  // Vista previa antes de importar el Excel de estudiantes — pedido
  // explícito: antes se subía directo a Firestore sin mostrar qué se iba a
  // crear ni avisar de filas mal capturadas.
  const [excelPreview, setExcelPreview] = useState(null) // { rows, invalid, schoolDocs, taken }
  const [parsingExcel, setParsingExcel] = useState(false)
  const [importingExcel, setImportingExcel] = useState(false)
  useBackHandler(() => !importingExcel && setExcelPreview(null), !!excelPreview)
  useScrollLock(!!excelPreview)

  // Resources (Recursos tab) — independent entity scoped by asignaturaId,
  // not tied to activities (see the `resources` collection in firestore.rules).
  const [resources, setResources] = useState([])
  const [resourcesLoaded, setResourcesLoaded] = useState(false)
  const [previewResourceId, setPreviewResourceId] = useState(null)
  const [loadingResources, setLoadingResources] = useState(false)
  const [showResourceModal, setShowResourceModal] = useState(false)
  const [resourceModalMode, setResourceModalMode] = useState('create') // 'create' | 'edit'
  // tipo: 'archivo' | 'link' — origTipo remembers what the doc was when the
  // edit modal opened, so we know a file is still required if the teacher
  // switches a link-type resource back to an uploaded file.
  const [resourceForm, setResourceForm] = useState({ id: null, nombre: '', descripcion: '', tipo: 'archivo', enlace: '', origTipo: 'archivo' })
  const [resourceFile, setResourceFile] = useState(null)
  const [savingResource, setSavingResource] = useState(false)
  const [deleteResourceConfirm, setDeleteResourceConfirm] = useState(null)
  const [deletingResource, setDeletingResource] = useState(false)

  // Calificaciones
  const [gradeSubMap, setGradeSubMap] = useState({})
  const [gradesLoaded, setGradesLoaded] = useState(false)
  const [loadingGrades, setLoadingGrades] = useState(false)
  // Clic derecho en una celda YA calificada: popover pegado al cursor para
  // corregir el número sin navegar a la actividad (clic izquierdo sigue
  // llevando ahí — necesario para calificar por primera vez / revisar la
  // entrega). { x, y, subId, activityId, studentId, maxCalif, value }
  const [gradeQuickEdit, setGradeQuickEdit] = useState(null)
  const [savingQuickGrade, setSavingQuickGrade] = useState(false)
  // Calificación masiva de no entregadas por actividad (clic derecho en <th>).
  // activityContextMenu: { x, y, activity, missingCount }
  // bulkGradeModal: { activity, missingCount }
  const [activityContextMenu, setActivityContextMenu] = useState(null)
  const [bulkGradeModal, setBulkGradeModal] = useState(null)
  const [bulkGradeValue, setBulkGradeValue] = useState('')
  const [savingBulkGrade, setSavingBulkGrade] = useState(false)
  // Calificaciones view state persists across the round-trip to a student's
  // activity/review (which fully navigates away and remounts this page). Saved
  // to sessionStorage on navigate-away, restored here so search + scroll survive.
  const califStateKey = `ef-calif-state-${subjectId}`
  const [searchGrade, setSearchGrade] = useState(() => {
    // Only rehydrate when we actually returned from a student's activity/review
    // (backState carries tab: 'calificaciones'); a fresh visit starts clean.
    if (routerLocation.state?.tab !== 'calificaciones') return ''
    try { return JSON.parse(sessionStorage.getItem(`ef-calif-state-${subjectId}`) || '{}').search || '' } catch { return '' }
  })
  const califScrollRestored = useRef(false)
  // Column/row hover tracking for the grades table cross-highlight — set via
  // event delegation on the table (see handleGradeTableHover below) instead
  // of one handler per cell.
  const [hoverGradeCell, setHoverGradeCell] = useState({ row: null, col: null })

  // Asistencias — un documento por hora de clase (fecha + slot), ver utils/attendance.js
  const [attendanceRecords, setAttendanceRecords] = useState([])
  const [attendanceLoaded, setAttendanceLoaded] = useState(false)
  const [loadingAttendance, setLoadingAttendance] = useState(false)
  const [searchAttendance, setSearchAttendance] = useState('')
  const [showAddAttendance, setShowAddAttendance] = useState(false)
  const [newAttendanceForm, setNewAttendanceForm] = useState({ fecha: '', duracion: 1, parcial: 1 })
  // Asuetos/vacaciones del docente — se cargan solo al abrir "Agregar día"
  // (alta manual; con fechas de curso configuradas este modal ni se usa, ver
  // autoAttendanceReady) para avisar sin bloquear si el día elegido coincide
  // con uno marcado, en vez de importar en silencio a un día "sin clases".
  const [attAsuetoMaps, setAttAsuetoMaps] = useState(null)
  const [savingAttendance, setSavingAttendance] = useState(false)
  const [deleteAttendanceConfirm, setDeleteAttendanceConfirm] = useState(null) // { fecha }
  const [deletingAttendance, setDeletingAttendance] = useState(false)
  // Motivo de justificación — { recordId, studentId, fecha, studentName }
  const [reasonModal, setReasonModal] = useState(null)
  const [reasonText, setReasonText] = useState('')
  // "recordId:studentId" de la última celda de asistencia revisada/modificada
  // — se resalta persistente en la tabla hasta que se toque otra.
  const [lastEditedAttCell, setLastEditedAttCell] = useState(null)
  // Días dentro del periodo del curso sin clase por asueto/vacaciones (solo
  // informativo, no genera filas de asistencia) — ver utils/attendanceAuto.js
  const [attendanceNoClaseDias, setAttendanceNoClaseDias] = useState([])
  // Datos para calcularSesionesReales client-side (parciales abiertos).
  // Cargados en loadAttendance; vacíos antes de abrir la pestaña.
  const [diasAsueto, setDiasAsueto] = useState([])
  const [sesionesCanceladas, setSesionesCanceladas] = useState([])
  // Horario de ESTA asignatura: { porFecha, diasSemana }. Lo llena
  // loadAttendance y sirve para no dejar agregar un día sin clase.
  const [claseDias, setClaseDias] = useState(null)
  // Días de clase automáticos que el docente borró a propósito (quedan en
  // subject.attendanceExcluded para que la sincronización no los regenere
  // solos) y siguen siendo válidos — se pueden restaurar uno por uno.
  const [attendanceMissingAutoDias, setAttendanceMissingAutoDias] = useState([]) // [{fecha, duracion, parcial}]
  const [showRestoreAttendance, setShowRestoreAttendance] = useState(false)
  const [restoringFecha, setRestoringFecha] = useState(null)

  // Cálculo dinámico de sesiones por parcial (parciales ABIERTOS).
  // Reactivo a cambios en fechas, horario, asuetos y cancelaciones.
  // Para parciales CERRADOS se usa totalOficialPorParcial en su lugar.
  const sesionesPorParcialCliente = useMemo(() => {
    if (!subject?.horarioPatron?.length || !subject?.fechaInicio || !subject?.fechaFin) return {}
    const numParciales = Math.max(1, Number(subject.parciales) || 1)
    const result = {}
    for (let p = 1; p <= numParciales; p++) {
      const { resumen } = calcularSesionesReales({
        fechaInicio: subject.fechaInicio,
        fechaFin: subject.fechaFin,
        parcialesFechas: subject.parcialesFechas || [],
        horarioPatron: subject.horarioPatron,
        diasAsueto,
        sesionesCanceladas,
        parcial: p,
      })
      result[String(p)] = resumen.sesionesTotales
    }
    return result
  }, [subject?.fechaInicio, subject?.fechaFin, subject?.parcialesFechas, subject?.horarioPatron, subject?.parciales, diasAsueto, sesionesCanceladas])

  const navigate = useNavigate()
  const toast = useToast()

  // Same reference used by the header's back arrow AND the physical Android
  // back button (useBackHandler below) — must stay the exact same function.
  function goBack() {
    navigate('/dashboard')
  }

  // Botón físico "atrás" (Android/Capacitor): la pila global en useBackHandler
  // siempre ejecuta el handler de más arriba — el modal/menú abierto más
  // reciente, o si no hay ninguno, la flecha "Volver" de la pantalla (goBack).
  // Cada línea replica exactamente el cierre que ya usa el botón Cancelar/X/backdrop
  // de ese modal (mismos guards de "saving en progreso" donde aplica).
  useBackHandler(() => setShowModal(false), showModal)
  useBackHandler(() => setDuplicateConfirm(null), !!duplicateConfirm)
  useBackHandler(() => !moving && setMoveConfirm(null), !!moveConfirm)
  useBackHandler(() => setPublishDraftConfirm(null), !!publishDraftConfirm)
  useBackHandler(() => setDeleteConfirm(null), !!deleteConfirm)
  useBackHandler(() => setShowMaterialModal(false), showMaterialModal)
  useBackHandler(() => setDeleteMaterialConfirm(null), !!deleteMaterialConfirm)
  useBackHandler(() => setShowAddStudent(false), showAddStudent)
  useBackHandler(() => setStudentToEdit(null), !!studentToEdit)
  useBackHandler(() => setStudentToReset(null), !!studentToReset)
  useBackHandler(() => !generatingCredentials && setShowCredentialsModal(false), showCredentialsModal)
  useBackHandler(() => setActivityMenu(null), !!activityMenu)
  useBackHandler(() => !importing && setImportFor(null), !!importFor)
  useBackHandler(() => setParcialMenu(null), !!parcialMenu)
  useBackHandler(() => setConfirmRevertPonderacion(false), confirmRevertPonderacion)
  useBackHandler(() => setConfirmRevertParcial(null), !!confirmRevertParcial)
  useBackHandler(() => !closingParcial && setCloseParcialConfirm(null), !!closeParcialConfirm)
  useBackHandler(() => !revertingParcial && setRevertParcialConfirm(null), !!revertParcialConfirm)
  useBackHandler(() => !iniciandoAtencion && setAtencionParcialConfirm(null), atencionParcialConfirm != null)
  useBackHandler(() => !savingStudent && setLinkCandidate(null), !!linkCandidate)
  useBackHandler(() => setResetPwdResult(null), !!resetPwdResult)
  useBackHandler(() => setStudentToDelete(null), !!studentToDelete)
  useBackHandler(() => setShowEditSubjectModal(false), showEditSubjectModal)
  useBackHandler(() => setShowCopyModal(false), showCopyModal)
  useBackHandler(() => { setShowDeleteSubjectConfirm(false); setDeleteSubjectConfirmText('') }, showDeleteSubjectConfirm)
  useBackHandler(() => !archiving && setShowArchiveModal(false), showArchiveModal)
  useBackHandler(() => setShowUnarchiveModal(false), showUnarchiveModal)
  useBackHandler(() => setShowResourceModal(false), showResourceModal)
  useBackHandler(() => setDeleteResourceConfirm(null), !!deleteResourceConfirm)
  useBackHandler(() => setEntregableEditor(null), !!entregableEditor)
  useBackHandler(() => setEvalEditor(null), !!evalEditor)
  useBackHandler(() => setNewDateOpen(false), !!(entregableEditor && newDateOpen))
  // Screen-level: only runs when no modal/menu above is open.
  useBackHandler(goBack)

  // Scroll lock — this page never unmounts while a modal/confirm overlay is
  // open, so each overlay needs its own lock tied to the same condition that
  // controls its render below (one call per overlay, not a blanket lock).
  useScrollLock(showModal)
  useScrollLock(duplicateConfirm)
  useScrollLock(moveConfirm)
  useScrollLock(publishDraftConfirm)
  useScrollLock(deleteConfirm)
  useScrollLock(showMaterialModal)
  useScrollLock(deleteMaterialConfirm)
  useScrollLock(showAddStudent)
  useScrollLock(studentToEdit)
  useScrollLock(studentToReset)
  useScrollLock(showCredentialsModal)
  useScrollLock(importFor != null)
  useScrollLock(confirmRevertPonderacion)
  useScrollLock(confirmRevertParcial != null)
  useScrollLock(closeParcialConfirm)
  useScrollLock(revertParcialConfirm != null)
  useScrollLock(atencionParcialConfirm != null)
  useScrollLock(linkCandidate)
  useScrollLock(resetPwdResult)
  useScrollLock(studentToDelete)
  useScrollLock(showEditSubjectModal)
  useScrollLock(showCopyModal)
  useScrollLock(showDeleteSubjectConfirm)
  useScrollLock(showArchiveModal)
  useScrollLock(showUnarchiveModal)
  useScrollLock(showResourceModal)
  useScrollLock(deleteResourceConfirm)

  // Snapshot the calificaciones search + scroll right before leaving to a student's
  // activity, so returning (backState { tab: 'calificaciones' }) restores them.
  function saveCalifState() {
    try { sessionStorage.setItem(califStateKey, JSON.stringify({ search: searchGrade, scrollY: window.scrollY })) } catch { /* ignore quota */ }
  }
  function goToActivityFromGrades(path, state) {
    saveCalifState()
    navigate(path, state)
  }

  // Clic derecho sobre cualquier celda de Calificaciones: abre el popover de
  // calificación rápida, sin salir a la actividad. El clic izquierdo sigue
  // llevando ahí (necesario para revisar la entrega). Funciona tanto para
  // corregir una ya puesta como para calificar directo a quien no entregó
  // nada (mismo caso que "sin entrega" en la pantalla de la actividad).
  function openGradeQuickEdit(e, sub, activity, student) {
    e.preventDefault()
    if (parcialCerrado(subject, activity.parcial)) {
      toast(mensajeParcialCerrado(activity.parcial), 'error')
      return
    }
    if (!sub && !canCreate) {
      toast('Necesitas Créditos IA para registrar calificaciones — toda tu información sigue disponible')
      return
    }
    const popW = 200, popH = 130
    setGradeQuickEdit({
      x: Math.min(e.clientX, window.innerWidth - popW - 8),
      y: Math.min(e.clientY, window.innerHeight - popH - 8),
      subId: sub?.id || null,
      activityId: activity.id,
      studentId: student.id,
      maxCalif: activity.maxCalif || 10,
      value: sub?.calificacion != null ? String(sub.calificacion) : '',
    })
  }

  // La edición rápida se detuvo porque la celda ya no es lo que hay en
  // Firestore (submissionGuard.js): se actualiza SOLO esa celda y la ventanita
  // sigue abierta con el valor que el docente tecleó.
  function mostrarCeldaActual(key, err) {
    const actual = err.actual || null
    setGradeSubMap((prev) => {
      const next = { ...prev }
      if (actual) next[key] = actual
      else delete next[key]
      return next
    })
    setGradeQuickEdit((q) => q && ({ ...q, subId: actual?.id || null }))
    toast(err.motivo === 'no-existe'
      ? 'Esta entrega ya no existe (fue anulada). La celda se actualizó; tu valor sigue en la ventanita.'
      : err.motivo === 'ya-existe' && !actual?.sinEntrega
        ? 'Este estudiante ya tiene una entrega o intento. Ábrela en la actividad para calificarla; no se guardó nada.'
        : 'Esta celda cambió desde que cargaste la tabla. Se actualizó; revisa y vuelve a guardar.', 'error')
  }

  async function saveGradeQuickEdit() {
    if (!gradeQuickEdit) return
    const { subId, activityId, studentId, maxCalif, value } = gradeQuickEdit
    const n = parseFloat(value)
    if (isNaN(n) || n < 0 || n > maxCalif) {
      toast(`La calificación debe estar entre 0 y ${maxCalif}`, 'error')
      return
    }
    setSavingQuickGrade(true)
    const key = `${studentId}-${activityId}`
    try {
      if (subId) {
        // Solo si la celda sigue siendo la entrega que se cargó en la tabla.
        await actualizarSiNoCambio(db, doc(db, 'submissions', subId), gradeSubMap[key], { calificacion: n })
        setGradeSubMap((prev) => ({ ...prev, [key]: { ...prev[key], calificacion: n } }))
      } else {
        // Igual que "Calificar sin entrega" en la actividad: crea la
        // submission directo. NO cierreParcial — queda como calificación
        // manual, no como las asignadas al cerrar el parcial en bloque.
        const data = {
          actividadId: activityId,
          alumnoId: studentId,
          calificacion: n,
          comentario: '',
          motivoSinEntrega: '',
          estado: 'calificado',
          sinEntrega: true,
          fechaEntrega: serverTimestamp(),
        }
        // Id determinista (A12 · H5 · R22). Solo se CREA: si mientras tanto
        // el estudiante entregó o empezó un intento, se detiene en vez de
        // convertirlo en "sin entrega" (submissionGuard.js).
        const id = submissionDocId(activityId, studentId)
        const creado = await crearSiNoExiste(db, doc(db, 'submissions', id), data)
        setGradeSubMap((prev) => ({ ...prev, [key]: creado }))
      }
      toast('Calificación guardada')
      setGradeQuickEdit(null)
    } catch (err) {
      if (err instanceof EntregaCambio) mostrarCeldaActual(key, err)
      else toast('Error: ' + err.message, 'error')
    } finally {
      setSavingQuickGrade(false)
    }
  }

  async function clearGradeQuickEdit() {
    if (!gradeQuickEdit?.subId) return
    const { subId, activityId, studentId } = gradeQuickEdit
    setSavingQuickGrade(true)
    const key = `${studentId}-${activityId}`
    try {
      await actualizarSiNoCambio(db, doc(db, 'submissions', subId), gradeSubMap[key], { calificacion: deleteField() })
      setGradeSubMap((prev) => {
        const updated = { ...prev[key] }
        delete updated.calificacion
        return { ...prev, [key]: updated }
      })
      toast('Calificación eliminada')
      setGradeQuickEdit(null)
    } catch (err) {
      if (err instanceof EntregaCambio) mostrarCeldaActual(key, err)
      else toast('Error: ' + err.message, 'error')
    } finally {
      setSavingQuickGrade(false)
    }
  }

  // ── Calificación masiva de no entregadas por actividad ──────────────────────
  // Clic derecho sobre el <th> de una actividad en la tabla de calificaciones.
  // Abre un menú contextual con la opción de asignar una nota a todos los
  // estudiantes que no tienen ningún submission para esa actividad.
  function openActivityContextMenu(e, activity) {
    e.preventDefault()
    // Guard: parcial cerrado — misma lógica que openGradeQuickEdit.
    if (parcialCerrado(subject, activity.parcial)) {
      toast(mensajeParcialCerrado(activity.parcial), 'error')
      return
    }
    // Guard: actividad que no genera calificación (diagnóstico, encuesta).
    if (!cuentaParaCalificacion(activity)) return

    // Guard: solo tiene sentido asignar masivamente si la fecha límite ya venció.
    const fechaLimite = activity.fechaLimite
    if (!fechaLimite) return
    const deadlineMs = new Date(
      fechaLimite.includes('T') ? fechaLimite : `${fechaLimite}T23:59:59`
    ).getTime()
    if (Date.now() < deadlineMs) return

    const now = Date.now()
    const missingCount = groupStudents.filter((s) => {
      // Excluir estudiantes con prórroga individual vigente.
      const extDate = activity.extensiones?.[s.id]
      if (extDate) {
        const extMs = new Date(extDate.includes('T') ? extDate : `${extDate}T23:59:59`).getTime()
        if (extMs > now) return false
      }
      // Sin documento, o documento sin evidencia y sin calificación (un
      // cuestionario/juego en curso sigue contando, como siempre). Una entrega
      // real sin calificar NO es "no entregada": antes contaba aquí y la
      // escritura masiva le borraba el archivo (submissionGuard.js).
      return elegibleSinEntrega(gradeSubMap[`${s.id}-${activity.id}`])
    }).length

    const popW = 280
    setActivityContextMenu({
      x: Math.min(e.clientX, window.innerWidth - popW - 8),
      y: Math.min(e.clientY, window.innerHeight - 80),
      activity,
      missingCount,
    })
  }

  // Vuelve a leer de Firestore las entregas de estas actividades y reemplaza
  // SOLO sus celdas en la tabla.
  async function refrescarCalificacionesDe(actIds) {
    const docs = await fetchSubmissionsForActivities(actIds)
    const ids = new Set(actIds)
    setGradeSubMap((prev) => {
      const next = {}
      Object.entries(prev).forEach(([k, v]) => { if (!ids.has(v?.actividadId)) next[k] = v })
      docs.forEach((d) => { const x = { id: d.id, ...d.data() }; next[`${x.alumnoId}-${x.actividadId}`] = x })
      return next
    })
  }

  async function confirmBulkGradeNoEntregadas() {
    if (!bulkGradeModal) return
    const { activity } = bulkGradeModal
    const maxCalif = activity.maxCalif ?? 10

    // Validación: número presente, en rango y múltiplo de 0.5.
    const n = parseFloat(bulkGradeValue)
    if (bulkGradeValue === '' || isNaN(n)) {
      toast('Escribe una calificación válida', 'error')
      return
    }
    if (n < 0 || n > maxCalif) {
      toast(`La calificación debe estar entre 0 y ${maxCalif}`, 'error')
      return
    }
    // Verificar múltiplo de 0.5: Math.round(n*2)/2 === n.
    if (Math.round(n * 2) / 2 !== n) {
      toast('La calificación debe ser múltiplo de 0.5 (ej. 7, 7.5, 8…)', 'error')
      return
    }

    setSavingBulkGrade(true)
    try {
      // Reverificación FRESCA contra Firestore para capturar entregas que
      // llegaron mientras el modal estaba abierto.
      const freshDocs = await fetchSubmissionsForActivities([activity.id])
      const freshSubByStudent = new Map(freshDocs.map((d) => [d.data().alumnoId, d.data()]))
      const now = Date.now()
      const pendientes = groupStudents.filter((s) => {
        // Excluir estudiantes con prórroga vigente al momento de confirmar.
        const extDate = activity.extensiones?.[s.id]
        if (extDate) {
          const extMs = new Date(extDate.includes('T') ? extDate : `${extDate}T23:59:59`).getTime()
          if (extMs > now) return false
        }
        return elegibleSinEntrega(freshSubByStudent.get(s.id))
      })
      // Entregaron y esperan calificación: no son "no entregadas" y no se
      // tocan — se nombran para que el docente sepa por qué no entraron.
      const yaEntregaron = groupStudents
        .filter((s) => { const d = freshSubByStudent.get(s.id); return tieneEvidencia(d) && d.calificacion == null })
        .map((s) => s.id)
      const avisoEntregaron = yaEntregaron.length
        ? `${yaEntregaron.length} ya ${yaEntregaron.length !== 1 ? 'entregaron y esperan' : 'entregó y espera'} tu calificación (no se tocaron): ${nombresBreves(yaEntregaron, groupStudents)}`
        : ''

      if (pendientes.length === 0) {
        toast(avisoEntregaron ? `Ya no hay estudiantes sin entrega. ${avisoEntregaron}` : 'Ya no hay estudiantes sin entrega para esta actividad', avisoEntregaron ? 'warning' : undefined)
        setBulkGradeModal(null)
        setBulkGradeValue('')
        return
      }

      const data = {
        actividadId: activity.id,
        // alumnoId se rellena individualmente en el loop
        calificacion: n,
        comentario: '',
        motivoSinEntrega: '',
        estado: 'calificado',
        sinEntrega: true,
        // Previene notificación falsa al docente de "alumno entregó"
        // cuando en realidad es el docente quien asignó la nota.
        notificadoEntregaDocente: true,
        fechaEntrega: serverTimestamp(),
      }

      // Cada bloque es una transacción que vuelve a revisar a cada estudiante
      // y escribe SOLO a los que siguen elegibles (mismo set y mismo contenido
      // que antes): si alguien entrega en este instante, queda fuera en vez
      // de perder su archivo (submissionGuard.js).
      const { escritos, omitidos } = await sinEntregaEnLote(db, pendientes.map((s) => ({
        ref: doc(db, 'submissions', submissionDocId(activity.id, s.id)),
        alumnoId: s.id,
        data: { ...data, alumnoId: s.id },
      })), elegibleSinEntrega)

      // La tabla se relee de Firestore (fechas reales, no el serverTimestamp
      // local) para que la siguiente edición compare contra lo guardado.
      await refrescarCalificacionesDe([activity.id])
      const savedCount = escritos.length
      const guardadas = `${savedCount} calificación${savedCount !== 1 ? 'es' : ''} guardada${savedCount !== 1 ? 's' : ''}`
      const avisoOmitidos = omitidos.length
        ? `${omitidos.length} ${omitidos.length !== 1 ? 'entregaron o se calificaron' : 'entregó o se calificó'} mientras guardabas y no se ${omitidos.length !== 1 ? 'tocaron' : 'tocó'}: ${nombresBreves(omitidos.map((o) => o.alumnoId), groupStudents)}`
        : ''
      const avisos = [avisoEntregaron, avisoOmitidos].filter(Boolean)
      toast(avisos.length ? `${guardadas}. ${avisos.join('. ')}` : guardadas, avisos.length ? 'warning' : undefined)
      setBulkGradeModal(null)
      setBulkGradeValue('')
    } catch (err) {
      toast(`Error al guardar: ${err.message}`, 'error')
    } finally {
      setSavingBulkGrade(false)
    }
  }

  // Guard on currentUser + depend on it: on a cold load the Firestore reads in loadAll()
  // (activities, students, submissions, materials) must not fire before Firebase Auth
  // restores the session, or the rules reject them and the effect never retries — the same
  // auth race that hid activities from students. Re-runs once currentUser is ready.
  useEffect(() => { if (currentUser) loadAll() }, [subjectId, currentUser])

  // Restore the calificaciones scroll position once, after the grades table has
  // rendered on return from a student's activity. Search is restored via initial state.
  useEffect(() => {
    if (califScrollRestored.current) return
    if (routerLocation.state?.tab !== 'calificaciones') return
    if (activeTab !== 'calificaciones' || !gradesLoaded) return
    califScrollRestored.current = true
    try {
      const saved = JSON.parse(sessionStorage.getItem(califStateKey) || '{}')
      if (saved.scrollY != null) requestAnimationFrame(() => window.scrollTo(0, saved.scrollY))
      // Consume it so a later plain visit to this subject doesn't jump unexpectedly.
      sessionStorage.removeItem(califStateKey)
    } catch { /* ignore */ }
  }, [activeTab, gradesLoaded, califStateKey, routerLocation.state])

  async function loadAll() {
    setLoading(true)
    // Navigating from one subject straight to another (e.g. via the sidebar) re-renders
    // this same component with a new subjectId instead of remounting it — without this,
    // the Alumnos/Calificaciones tabs would keep showing the PREVIOUS subject's roster,
    // since `groupStudentsLoaded`/`gradesLoaded` would already be true.
    setGroupStudents([])
    setGroupStudentsLoaded(false)
    setGradeSubMap({})
    setGradesLoaded(false)
    setResources([])
    setResourcesLoaded(false)
    // Default view for every subject: only the first parcial expanded. This same
    // component is reused (not remounted) when switching subjects, so reset it here
    // — otherwise the previously-open parcial would carry over to the new subject.
    setOpenParcial(1)
    try {
      // `materials` is fetched separately (not inside this Promise.all): if its
      // Firestore rules aren't deployed yet, getDocs() rejects with
      // permission-denied — that must never take down the subject/activities
      // load with it (it did once: the whole page fell back to defaults —
      // generic icon, blue palette, 3 parciales — because setSubject() was
      // never reached).
      // Todo lo que no depende de las actividades va en la MISMA vuelta de red
      // (antes eran tres en fila; en datos móviles cada vuelta cuesta ~0.6 s).
      // materials y students llevan su propio .catch: una lectura denegada en
      // una asignatura ajena no debe tapar el aviso de «no pertenece».
      const [subSnap, actsSnap, matsSnap, studSnap] = await Promise.all([
        getDoc(doc(db, 'subjects', subjectId)),
        getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', subjectId), where('docenteId', '==', currentUser.uid))),
        getDocs(query(collection(db, 'materials'), where('asignaturaId', '==', subjectId), where('docenteId', '==', currentUser.uid))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId))).catch(() => ({ size: 0 })),
      ])
      // Una asignatura ajena jamás se muestra: subjects es de lectura pública
      // (activación por QR) así que sin este guard cualquier cuenta con la URL
      // vería el grupo completo con sus calificaciones.
      if (!subSnap.exists() || subSnap.data().docenteId !== currentUser.uid) {
        toast('Esta asignatura no pertenece a tu cuenta', 'error')
        navigate('/dashboard')
        return
      }
      let subData = { id: subSnap.id, ...subSnap.data() }
      if (!subData.accessCode) {
        const newCode = Math.random().toString(36).slice(2, 8).toUpperCase()
        await updateDoc(doc(db, 'subjects', subjectId), { accessCode: newCode })
        subData = { ...subData, accessCode: newCode }
      }
      setSubject(subData)
      // Firestore doesn't guarantee document order without orderBy (not allowed
      // per this project's query constraints), so `orden` is the only thing that
      // determines display order. Activities created before this field existed
      // self-heal here: fall back to `createdAt`/id for a stable order, assign
      // `orden` from that position, and persist it — same pattern already used
      // for subjects/students.
      let acts = actsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      if (acts.some((a) => a.orden == null)) {
        const byParcial = {}
        acts.forEach((a) => { (byParcial[a.parcial] ||= []).push(a) })
        const batch = writeBatch(db)
        acts = Object.values(byParcial).flatMap((list) => {
          list.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0) || a.id.localeCompare(b.id))
          return list.map((a, i) => {
            const orden = i + 1
            if (a.orden !== orden) batch.update(doc(db, 'activities', a.id), { orden })
            return { ...a, orden }
          })
        })
        batch.commit().catch(() => {}) // best-effort; in-memory order is already correct
      }
      acts = acts.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      setActivities(acts)

      setMaterials(
        matsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      )

      const subDocs = await fetchSubmissionsForActivities(acts.map((a) => a.id))
      setStudentCountAtLoad(studSnap.size)

      const counts = {}
      acts.forEach((a) => { counts[a.id] = { delivered: 0, graded: 0 } })
      subDocs.forEach((d) => {
        const data = d.data()
        const c = counts[data.actividadId]
        if (!c) return
        if (data.estado !== 'pendiente') c.delivered++
        if (data.calificacion != null) c.graded++
      })
      setSubmissionCounts(counts)

      // Re-fetch whichever tab is currently open for the NEW subject — `force: true`
      // because groupStudentsLoaded was just reset above but this function's own
      // closure still has the stale value from before that reset took effect.
      if (activeTab === 'alumnos') await ensureGroupStudents(true)
      if (activeTab === 'calificaciones') await loadGrades(true, acts)
      if (activeTab === 'recursos') await ensureResources(true)
      if (activeTab === 'asistencia') await loadAttendance(true)
    } catch (err) {
      toast('Error al cargar: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── Students (shared) ──────────────────────────────────────────────
  // `force` bypasses the groupStudentsLoaded cache check — needed right after loadAll()
  // resets it, since this function's own closure (captured at the start of the same
  // render that triggered loadAll) still holds the PREVIOUS subject's stale `true`.
  async function ensureGroupStudents(force = false) {
    if (groupStudentsLoaded && !force) return groupStudents
    const snap = await getDocs(
      query(collection(db, 'students'), where('asignaturaId', '==', subjectId))
    )
    const students = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    setGroupStudents(students)
    setGroupStudentsLoaded(true)
    return students
  }

  // ── Resources (Recursos tab) ───────────────────────────────────────
  async function ensureResources(force = false) {
    if (resourcesLoaded && !force) return resources
    setLoadingResources(true)
    try {
      const snap = await getDocs(query(collection(db, 'resources'), where('asignaturaId', '==', subjectId), where('docenteId', '==', currentUser.uid)))
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        // Most-recent-first by publish date — sorted in memory since this
        // project's Firestore queries can't use orderBy (see CLAUDE.md).
        .sort((a, b) => (b.fechaPublicacion?.seconds ?? 0) - (a.fechaPublicacion?.seconds ?? 0))
      setResources(list)
      setResourcesLoaded(true)
      return list
    } catch (err) {
      toast('Error al cargar recursos: ' + err.message, 'error')
      return []
    } finally {
      setLoadingResources(false)
    }
  }

  function openAddResource() {
    setResourceModalMode('create')
    setResourceForm({ id: null, nombre: '', descripcion: '', tipo: 'archivo', enlace: '', origTipo: 'archivo' })
    setResourceFile(null)
    setShowResourceModal(true)
  }

  function openEditResource(r) {
    setResourceModalMode('edit')
    const tipo = r.tipo === 'link' ? 'link' : 'archivo'
    setResourceForm({ id: r.id, nombre: r.nombre, descripcion: r.descripcion || '', tipo, enlace: tipo === 'link' ? (r.url || '') : '', origTipo: tipo })
    setResourceFile(null)
    setShowResourceModal(true)
  }

  // "Guardar recurso" se apaga sin cambios, solo en modo edit. El enlace se
  // compara ya normalizado (con https:// al frente) porque el guardado se lo
  // agrega solo si falta — sin esto, escribir la misma URL sin "https://"
  // se veía como un cambio aunque el recurso guardado fuera a quedar igual.
  const editingResource = resourceModalMode === 'edit' ? resources.find((r) => r.id === resourceForm.id) : null
  const resourceEnlaceNormalizado = resourceForm.enlace.trim() && !/^https?:\/\//i.test(resourceForm.enlace.trim())
    ? `https://${resourceForm.enlace.trim()}`
    : resourceForm.enlace.trim()
  const resourceChanged = resourceModalMode === 'create' || (
    resourceForm.nombre.trim() !== (editingResource?.nombre || '') ||
    resourceForm.descripcion.trim() !== (editingResource?.descripcion || '') ||
    resourceForm.tipo !== resourceForm.origTipo ||
    !!resourceFile ||
    (resourceForm.tipo === 'link' && resourceEnlaceNormalizado !== (editingResource?.url || ''))
  )

  async function handleSaveResource(e) {
    e.preventDefault()
    if (!resourceForm.nombre.trim()) { toast('Escribe un nombre', 'error'); return }
    const isLink = resourceForm.tipo === 'link'
    let enlaceUrl = ''
    if (isLink) {
      enlaceUrl = resourceForm.enlace.trim()
      if (!enlaceUrl) { toast('Escribe un enlace', 'error'); return }
      if (!/^https?:\/\//i.test(enlaceUrl)) enlaceUrl = `https://${enlaceUrl}`
    } else {
      const needsFile = resourceModalMode === 'create' || resourceForm.origTipo === 'link'
      if (needsFile && !resourceFile) { toast('Selecciona un archivo', 'error'); return }
      if (resourceFile) {
        if (!isResourceFileAllowed(resourceFile)) { toast('Tipo de archivo no permitido', 'error'); return }
        if (resourceFile.size > MAX_RESOURCE_SIZE) { toast('El archivo no puede superar 15 MB', 'error'); return }
      }
    }
    setSavingResource(true)
    try {
      if (resourceModalMode === 'create') {
        if (isLink) {
          await addDoc(collection(db, 'resources'), {
            asignaturaId: subjectId,
            docenteId: currentUser.uid,
            nombre: resourceForm.nombre.trim(),
            descripcion: resourceForm.descripcion.trim(),
            tipo: 'link',
            url: enlaceUrl,
            fechaPublicacion: serverTimestamp(),
          })
        } else {
          const url = await uploadToCloudinary(resourceFile, 'evalua-facil/recursos')
          await addDoc(collection(db, 'resources'), {
            asignaturaId: subjectId,
            docenteId: currentUser.uid,
            nombre: resourceForm.nombre.trim(),
            descripcion: resourceForm.descripcion.trim(),
            tipo: 'archivo',
            url,
            nombreArchivo: resourceFile.name,
            tamano: resourceFile.size,
            fechaPublicacion: serverTimestamp(),
          })
        }
        toast('Recurso agregado')
      } else {
        const patch = {
          nombre: resourceForm.nombre.trim(),
          descripcion: resourceForm.descripcion.trim(),
          tipo: isLink ? 'link' : 'archivo',
        }
        if (isLink) {
          patch.url = enlaceUrl
          patch.nombreArchivo = deleteField()
          patch.tamano = deleteField()
        } else if (resourceFile) {
          patch.url = await uploadToCloudinary(resourceFile, 'evalua-facil/recursos')
          patch.nombreArchivo = resourceFile.name
          patch.tamano = resourceFile.size
        }
        await updateDoc(doc(db, 'resources', resourceForm.id), patch)
        toast('Recurso actualizado')
      }
      setShowResourceModal(false)
      await ensureResources(true)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingResource(false)
    }
  }

  async function handleDeleteResource() {
    if (!deleteResourceConfirm) return
    setDeletingResource(true)
    try {
      await deleteDoc(doc(db, 'resources', deleteResourceConfirm.id))
      setDeleteResourceConfirm(null)
      await ensureResources(true)
      toast('Recurso eliminado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setDeletingResource(false)
    }
  }

  // ── Calificaciones ─────────────────────────────────────────────────
  // `actsOverride` lets loadAll() pass the just-fetched activities directly — the
  // component's own `activities` state hasn't re-rendered yet inside that same call,
  // so reading it here would still see the PREVIOUS subject's activities.
  async function loadGrades(force = false, actsOverride = null) {
    setLoadingGrades(true)
    try {
      await ensureGroupStudents(force)
      const subDocs = await fetchSubmissionsForActivities((actsOverride || activities).map((a) => a.id))
      const map = {}
      subDocs.forEach((d) => {
        const data = { id: d.id, ...d.data() }
        map[`${data.alumnoId}-${data.actividadId}`] = data
      })
      setGradeSubMap(map)
      setGradesLoaded(true)
    } catch (err) {
      toast('Error al cargar calificaciones: ' + err.message, 'error')
    } finally {
      setLoadingGrades(false)
    }
  }

  function switchTab(tab) {
    setActiveTab(tab)
    if (tab === 'calificaciones' && !gradesLoaded) loadGrades()
    if (tab === 'alumnos' && !groupStudentsLoaded) ensureGroupStudents()
    if (tab === 'recursos' && !resourcesLoaded) ensureResources()
    if (tab === 'asistencia' && !attendanceLoaded) loadAttendance()
  }


  // En la app nativa, la pestaña Asistencias se ve en HORIZONTAL (para caber más
  // columnas); el resto de la app queda en vertical.
  //
  // Antes, mover el teléfono de vuelta a vertical (sin que el docente lo
  // pidiera) sacaba solo de esta vista — la pantalla está BLOQUEADA en
  // horizontal (lockLandscape), pero un listener nativo aparte
  // (MainActivity.java, OrientationEventListener → CustomEvent
  // "fisicaorientacion") detectaba la orientación FÍSICA del teléfono e
  // igual navegaba fuera. Pedido explícito: tomar asistencia con el
  // teléfono en la mano implica moverlo — eso no debe regresar a vertical.
  // Única salida ahora: el botón "Regresar" (ver onBack/stableAttBack) o el
  // botón físico atrás de Android.
  useEffect(() => {
    if (!IS_NATIVE_APP || activeTab !== 'asistencia') return undefined
    lockLandscape()
    return () => { lockPortrait() }
  }, [activeTab])

  // Oculta los íconos del sistema (barra de estado) mientras se agrega un día,
  // para que no estorben en el modal de la vista horizontal (app).
  useEffect(() => {
    if (!IS_NATIVE_APP || !showAddAttendance) return undefined
    hideStatusBar()
    return () => { showStatusBar() }
  }, [showAddAttendance])

  useEffect(() => {
    if (!showAddAttendance || attAsuetoMaps) return
    (async () => {
      const [asuetosSnap, vacacionesSnap] = await Promise.all([
        getDocs(query(collection(db, 'asuetos'), where('docenteId', '==', currentUser.uid))),
        getDocs(query(collection(db, 'vacaciones'), where('docenteId', '==', currentUser.uid))),
      ])
      setAttAsuetoMaps({
        asuetoMap: buildAsuetoMap(asuetosSnap.docs.map((d) => d.data())),
        vacacionMap: buildVacacionMap(vacacionesSnap.docs.map((d) => d.data())),
      })
    })()
  }, [showAddAttendance, attAsuetoMaps, currentUser.uid])

  // ── Asistencias ────────────────────────────────────────────────────
  // `subjectOverride`: cuando el llamador acaba de escribir un cambio en
  // `subjects/{id}` (p. ej. attendanceExcluded) y llama a loadAttendance en
  // la misma función, el `subject` del estado de React TODAVÍA no lo
  // refleja (setState es asíncrono) — pasar el valor ya actualizado evita
  // que esta sincronización lea el dato viejo y deshaga ese cambio.
  async function loadAttendance(force = false, subjectOverride = null) {
    const subj = subjectOverride || subject
    setLoadingAttendance(true)
    try {
      // Antes esto era 5-6 lecturas de Firestore EN SECUENCIA (estudiantes →
      // asistencia → bloques → [reintento de asistencia] → asuetos/
      // vacaciones), cada una pagando su propio round-trip — la causa real de
      // la lentitud al abrir la pestaña, no el volumen de datos. Las tres
      // primeras no dependen entre sí, así que corren en paralelo.
      // El horario se consulta SIEMPRE, no solo cuando el curso tiene fechas
      // de parciales: además de generar los días automáticos, es con lo que se
      // valida que no se agregue un día en el que esta asignatura no tiene
      // clase (ver motivoSinClase más abajo). Antes venía null justo en el
      // caso del alta manual, que es donde hace falta.
      // Asuetos/vacaciones van en este mismo lote: deciden qué columnas se
      // crean (un asueto que afecta asistencias no genera columna aunque el
      // bloque de clase siga en el horario), así que tienen que estar antes
      // de sincronizar. Solo hacen falta con fechas de parciales.
      const [students, records, bloquesInfo, calendarioDocente] = await Promise.all([
        ensureGroupStudents(force),
        loadAttendanceRecords(subjectId),
        fetchClaseDiasSemana({ subjectId, docenteId: subj.docenteId }).catch(() => null),
        subj?.parcialesFechas?.length ? fetchAsuetosVacaciones({ docenteId: subj.docenteId }) : null,
      ])
      setClaseDias(bloquesInfo)
      if (bloquesInfo?.sesionesCanceladas) setSesionesCanceladas(bloquesInfo.sesionesCanceladas)
      let finalRecords = records
      if (subj?.parcialesFechas?.length && bloquesInfo) {
        const { dias: noClase, diasAsueto: diasAsuetoLoaded } = diasSinAsistenciaEnCurso({
          ...calendarioDocente,
          fechaInicio: subj.fechaInicio,
          fechaFin: subj.fechaFin,
          diasSemana: bloquesInfo.diasSemana,
        })
        const { created, missing, nuevos } = await syncAutoAttendanceDays({
          subjectId,
          docenteId: subj.docenteId,
          parcialesFechas: subj.parcialesFechas,
          existingSlots: new Set(records.map((r) => `${r.fecha}_${r.slot}`)),
          excludedFechas: subj.attendanceExcluded || [],
          sinAsistencia: diasAsuetoLoaded,
          studentIds: (students || groupStudents).map((s) => s.id),
          porFecha: bloquesInfo.porFecha,
        })
        // Los recién creados se agregan en memoria — ya no se vuelve a
        // descargar TODA la asistencia por segunda vez para incluirlos.
        if (created > 0) {
          finalRecords = [...records, ...nuevos].sort((a, b) =>
            a.fecha === b.fecha ? a.slot - b.slot : a.fecha.localeCompare(b.fecha))
        }
        setAttendanceMissingAutoDias(missing)
        setAttendanceNoClaseDias(noClase)
        setDiasAsueto(diasAsuetoLoaded)
      }
      setAttendanceRecords(finalRecords)
      setAttendanceLoaded(true)
    } catch (err) {
      toast('Error al cargar asistencias: ' + err.message, 'error')
    } finally {
      setLoadingAttendance(false)
    }
  }

  // ¿Por qué NO se puede pasar lista ese día? null = sí se puede.
  //
  // Deliberadamente conservadora: solo bloquea cuando hay certeza de que ese
  // día de la semana no lleva clase de esta asignatura. Si no hay horario
  // capturado no hay con qué comparar, y si la fecha exacta sí tiene bloque
  // (aunque sea de reposición) se permite. Bloquear de más sería peor que el
  // problema: dejaría al docente sin poder registrar una clase que sí dio.
  function motivoSinClase(fecha) {
    if (!fecha) return null
    const diasConClase = claseDias?.diasSemana
    if (!diasConClase || diasConClase.size === 0) return null
    if (claseDias.porFecha?.[fecha]) return null
    const [anio, mes, dia] = fecha.split('-').map(Number)
    const diaSemana = diaSemanaLunes(new Date(anio, mes - 1, dia))
    if (diasConClase.has(diaSemana)) return null
    const conClase = [...diasConClase].sort().map((d) => DIAS_SEMANA[d]).join(', ')
    return `Los ${DIAS_SEMANA[diaSemana].toLowerCase()} no tienes clase de ${subjectDisplayName(subject)} — la das ${conClase}. Si de verdad hubo clase ese día, agrégala primero a tu horario.`
  }
  const avisoSinClase = motivoSinClase(newAttendanceForm.fecha)
  // Aviso aparte (no bloquea, a diferencia de avisoSinClase): el docente
  // marcó ese día como asueto/vacaciones, pero a diferencia de crear un
  // evento (que sí se bloquea del todo, ver bloqueadoPorAsueto en
  // CalendarPage.jsx), pasar lista es documentar algo que YA pasó — una
  // reposición de clase en un día de asueto es legítima y debe poder
  // registrarse, solo con el aviso de que es inusual. Chequeo directo por
  // fecha (no depende de diasSemana/fechas de curso, a diferencia de
  // diasSinAsistenciaEnCurso) — este modal solo existe precisamente
  // cuando la asignatura NO tiene fechas de curso configuradas.
  const avisoAsueto = newAttendanceForm.fecha && attAsuetoMaps && (
    // Por 'asistencias' y no por 'clases': el docente puede marcar un día sin
    // clases pero en el que sí se pasa lista, y ahí el aviso sobra.
    esAsuetoPara(attAsuetoMaps.asuetoMap, newAttendanceForm.fecha, 'asistencias') ? 'asueto'
      : esAsuetoPara(attAsuetoMaps.vacacionMap, newAttendanceForm.fecha, 'asistencias') ? 'vacaciones'
        : null
  )

  async function handleCreateAttendanceDay(e) {
    e.preventDefault()
    if (!newAttendanceForm.fecha) return
    // Se revisa otra vez aquí y no solo en el botón: el formulario también se
    // envía con Enter.
    const aviso = motivoSinClase(newAttendanceForm.fecha)
    if (aviso) { toast(aviso, 'error'); return }
    // Unicidad (asignaturaId, fecha, slot): bloquear si ya existe algún slot del
    // rango que se va a crear. Permite coexistencia de slot 1 y slot 2 el mismo día.
    const duracion = Number(newAttendanceForm.duracion)
    const haySolapamiento = attendanceRecords.some(
      (r) => r.fecha === newAttendanceForm.fecha && r.slot >= 1 && r.slot <= duracion
    )
    if (haySolapamiento) {
      toast(`El ${formatShortDate(newAttendanceForm.fecha)} ya tiene sesiones registradas. Para rehacerlo con diferente duración, elimina el día primero.`, 'error')
      return
    }
    setSavingAttendance(true)
    try {
      await createAttendanceDay({
        subjectId,
        docenteId: currentUser.uid,
        fecha: newAttendanceForm.fecha,
        duracion,
        parcial: Number(newAttendanceForm.parcial),
        studentIds: groupStudents.map((s) => s.id),
      })
      setShowAddAttendance(false)
      setNewAttendanceForm({ fecha: '', duracion: 1, parcial: Number(newAttendanceForm.parcial) })
      await loadAttendance(true)
      toast('Asistencia agregada')
    } catch (err) {
      if (err.message === 'ALREADY_EXISTS') {
        toast(`El ${formatShortDate(newAttendanceForm.fecha)} ya tiene sesiones registradas. Para rehacerlo con diferente duración, elimina el día primero.`, 'error')
      } else {
        toast('Error: ' + err.message, 'error')
      }
    } finally {
      setSavingAttendance(false)
    }
  }

  // Un toque/clic cicla el estado: Presente → Falta → Justificada → Presente.
  // Igual en web y app (pedido explícito): el tercer toque (el que saldría de
  // Justificada) NO vuelve a Presente directo — abre la ventana de motivo.
  // Mismo camino para revisar/editar una falta que YA tenía motivo (un clic
  // más sobre su "J con puntito") — ya no hay clic derecho ni mantener
  // presionado como atajo aparte (pedido explícito, se quitaron por
  // completo). Cancelar se comporta distinto según de dónde venía:
  //  · sin motivo todavía (se estaba completando la justificación por
  //    primera vez) → Cancelar completa el ciclo, vuelve a Presente.
  //  · ya tenía motivo (solo se estaba revisando/editando) → Cancelar no
  //    toca nada, se queda en Justificada con el motivo que ya tenía.
  // La última celda revisada/modificada queda resaltada de forma persistente
  // (anillo azul + fondo) hasta que se toque otra celda — el foco del teclado
  // se pierde al mover el mouse, así que esto va por estado, no por :focus
  // (pedido explícito: que se NOTE cuál fue la que se acaba de ver).
  function avisoSesionInformativa(record) {
    return record?.tipoSinAsistencia === 'vacaciones'
      ? 'Periodo vacacional: ese día no se registra asistencia'
      : 'Día de asueto: ese día no se registra asistencia'
  }
  async function handleCycleAttendance(record, student) {
    // Columna informativa de asueto/vacaciones: no hay sesión que registrar.
    // Se corta ANTES del cambio optimista (la celda no tiene clic, pero esto no
    // depende de eso). attendance.js vuelve a rechazarla al escribir.
    if (esSesionInformativa(record)) {
      toast(avisoSesionInformativa(record), 'error')
      return
    }
    const now = new Date()
    const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    if (record.fecha > todayISO) {
      toast('Este día aún no llega — la asistencia se generó automáticamente y se podrá editar cuando llegue la fecha', 'error')
      return
    }
    const studentId = student.id
    setLastEditedAttCell(`${record.id}:${studentId}`)
    if (attendanceState(record, studentId) === 'justificada') {
      const yaTieneMotivo = !!(record.motivos?.[studentId] || '').trim()
      openReasonModal(record, student, { revertOnCancel: !yaTieneMotivo })
      return
    }
    const next = nextAttendanceState(attendanceState(record, studentId))
    setAttendanceRecords((prev) => prev.map((r) => {
      if (r.id !== record.id) return r
      return {
        ...r,
        presentes: { ...r.presentes, [studentId]: next === 'presente' },
        justificadas: { ...(r.justificadas || {}), [studentId]: next === 'justificada' },
      }
    }))
    try {
      await setAttendanceState(record.id, studentId, next)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      await loadAttendance(true)
    }
  }

  // `revertOnCancel` decide qué hace Cancelar en el modal — ver el comentario
  // de handleCycleAttendance arriba, la única que ahora abre esta ventana.
  function openReasonModal(record, student, { revertOnCancel = false } = {}) {
    if (esSesionInformativa(record)) return
    const current = record.motivos?.[student.id] || ''
    setReasonText(current)
    setReasonModal({ recordId: record.id, studentId: student.id, fecha: record.fecha, studentName: studentFullName(student), original: current, revertOnCancel })
  }
  async function cancelReasonModal() {
    const modal = reasonModal
    setReasonModal(null)
    if (!modal?.revertOnCancel) return
    await markPresenteFrom(modal)
  }
  // Botón "Salir": cierra el modal sin tocar nada — para solo ver el motivo
  // guardado y no hacer nada más (pedido explícito).
  function closeReasonModal() {
    setReasonModal(null)
  }
  // Botón "Asistencia" del modal: siempre deja la celda en Presente
  // (palomita), venga de donde venga — completa el ciclo J → Presente sin
  // pasos extra (pedido explícito, reemplaza al viejo "Cancelar").
  async function markPresenteFromModal() {
    const modal = reasonModal
    setReasonModal(null)
    await markPresenteFrom(modal)
  }
  async function markPresenteFrom(modal) {
    if (!modal || esSesionInformativa(modal.recordId)) return
    const { recordId, studentId } = modal
    setAttendanceRecords((prev) => prev.map((r) => r.id === recordId ? {
      ...r,
      presentes: { ...r.presentes, [studentId]: true },
      justificadas: { ...(r.justificadas || {}), [studentId]: false },
      motivos: { ...(r.motivos || {}), [studentId]: '' },
    } : r))
    try {
      await setAttendanceState(recordId, studentId, 'presente')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      await loadAttendance(true)
    }
  }
  function cellClick(record, student) {
    handleCycleAttendance(record, student)
  }

  // Wrapper de identidad ESTABLE para AttendanceTable (React.memo): cierra
  // sobre `subjectId`/`attendanceRecords` (vía handleCycleAttendance/
  // loadAttendance) que SÍ cambian si el docente pasa a otra asignatura sin
  // recargar la página (useParams no desmonta el componente) — congelarlo
  // con useCallback([]) directamente sería incorrecto (clausura obsoleta).
  // Este patrón de "ref a la última implementación" da una función que NUNCA
  // cambia de identidad (lo que React.memo necesita para saltarse el
  // re-render) pero siempre ejecuta la versión más reciente.
  const cellClickRef = useRef(); cellClickRef.current = cellClick
  const stableCellClick = useCallback((record, student) => cellClickRef.current(record, student), [])
  // setDeleteAttendanceConfirm/setActiveTab/setShowAddAttendance son setters
  // de useState — React los garantiza estables, así que estos SÍ pueden
  // llevar deps vacías sin riesgo de obsolescencia.
  const stableDeleteDay = useCallback((fecha) => setDeleteAttendanceConfirm({ fecha }), [])
  const stableAttBack = useCallback(() => setActiveTab('actividades'), [])
  // Botón físico "atrás" de Android: única forma de salir de Asistencias en
  // la app nativa (además del botón "Regresar" en pantalla) — pedido
  // explícito, ya no se sale solo por mover el teléfono a vertical (ver el
  // efecto de lockLandscape/lockPortrait más arriba).
  useBackHandler(stableAttBack, IS_NATIVE_APP && activeTab === 'asistencia')

  // Tomar lista en el TELÉFONO (web). En el navegador el botón/gesto atrás es
  // un history.back(): sin una entrada propia en el historial sacaría de la
  // asignatura entera. Al entrar se apila una entrada (misma URL, marcada con
  // efTomarLista) y su popstate regresa a Actividades — o, si hay un modal de
  // asistencia abierto, solo lo cierra (sin tocar datos, como "Salir") y
  // vuelve a apilar la entrada para seguir tomando lista. Nada de esto corre
  // en la app: ahí tomarListaMovil siempre es false.
  const tomarListaPopRef = useRef()
  tomarListaPopRef.current = () => {
    // Observaciones: atrás cierra SOLO la ventana de hasta arriba (menú →
    // observación → bitácora) y se queda en Tomar lista.
    if (menuAsistencia || observacionModal || bitacoraStudent) {
      if (menuAsistencia) setMenuAsistencia(null)
      else if (observacionModal) setObservacionModal(null)
      else setBitacoraStudent(null)
      window.history.pushState({ ...window.history.state, efTomarLista: true }, '')
      return
    }
    if (reasonModal || showAddAttendance || showRestoreAttendance || deleteAttendanceConfirm) {
      setReasonModal(null)
      setShowAddAttendance(false)
      setShowRestoreAttendance(false)
      setDeleteAttendanceConfirm(null)
      window.history.pushState({ ...window.history.state, efTomarLista: true }, '')
      return
    }
    setActiveTab('actividades')
  }
  useEffect(() => {
    if (!tomarListaMovil) return undefined
    // Revisar la marca evita apilar dos entradas (StrictMode monta dos veces
    // en desarrollo, o se recargó la página estando ya en esta entrada).
    if (!window.history.state?.efTomarLista) {
      window.history.pushState({ ...window.history.state, efTomarLista: true }, '')
    }
    const onPop = () => tomarListaPopRef.current()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [tomarListaMovil])
  // "Regresar" en pantalla: consume la entrada propia (su popstate regresa a
  // Actividades), así el historial queda igual que antes de entrar.
  const stableTomarListaBack = useCallback(() => {
    if (window.history.state?.efTomarLista) window.history.back()
    else setActiveTab('actividades')
  }, [])
  // Con fechas de curso configuradas, todo es automático: "Agregar día" pasa
  // a ser "Restaurar día" (solo fechas que el docente borró y siguen siendo
  // válidas) — sin fechas de curso, sigue siendo el alta manual de siempre.
  const autoAttendanceReady = !!(subject?.fechaInicio && subject?.fechaFin)
  const addDayLabel = !autoAttendanceReady
    ? 'Agregar día'
    : (attendanceMissingAutoDias.length > 0 ? 'Restaurar día' : null)
  function handleAddDayClick() {
    if (!autoAttendanceReady) {
      // El día de hoy ya viene puesto (PLAN_NORMALIZACION_UI §5.2): casi
      // siempre se agrega la clase que se está dando. El parcial se queda en
      // el último que se usó. Si ya había un día elegido, se respeta.
      const d = new Date()
      const hoy = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      setNewAttendanceForm((f) => (f.fecha ? f : { ...f, fecha: hoy }))
      setShowAddAttendance(true)
      return
    }
    setShowRestoreAttendance(true)
  }
  const addDayClickRef = useRef(); addDayClickRef.current = handleAddDayClick
  const stableAddDay = useCallback(() => addDayClickRef.current(), [])

  // ── Observaciones y bitácora ──────────────────────────────────────
  // Registros escritos del docente sobre una celda de asistencia, en su propia
  // colección (utils/observacionesAsistencia.js): no tocan `attendance`, sus
  // conteos ni onAttendanceEscrita, y se conservan aunque el día se elimine.
  // Disponibles en las cuatro experiencias del docente: escritorio, tablet,
  // teléfono (web) y app nativa — misma lógica, mismos datos, mismas reglas.
  const [observaciones, setObservaciones] = useState([])
  const [observacionesDe, setObservacionesDe] = useState(null) // subjectId ya cargado
  const [menuAsistencia, setMenuAsistencia] = useState(null)
  const [observacionModal, setObservacionModal] = useState(null) // { id, record?, student, fecha, original, sobreBitacora }
  const [bitacoraStudent, setBitacoraStudent] = useState(null)
  // Asistencias se ve a pantalla completa (capa fija z-menu) en la app nativa y
  // en Tomar lista del teléfono: ahí estas ventanas tienen que ir por encima.
  const modalesSobreCapaCompleta = IS_NATIVE_APP || tomarListaMovil
  // Esc (EscKeyHandler) y el botón atrás cierran la ventana de hasta arriba;
  // sin registrarlas aquí, Esc sacaría de la asignatura además de cerrarla.
  useBackHandler(() => setBitacoraStudent(null), !!bitacoraStudent)
  useBackHandler(() => setObservacionModal(null), !!observacionModal)

  useEffect(() => {
    if (!attendanceLoaded || observacionesDe === subjectId) return undefined
    let vivo = true
    cargarObservacionesAsistencia(subjectId, currentUser.uid)
      .then((lista) => { if (vivo) { setObservaciones(lista); setObservacionesDe(subjectId) } })
      // Un fallo aquí no debe estorbar el pase de lista: la tabla sigue igual.
      .catch((err) => { if (vivo) console.warn('No se pudieron cargar las observaciones:', err) })
    return () => { vivo = false }
  }, [attendanceLoaded, observacionesDe, subjectId, currentUser.uid])

  const observacionesPorCelda = useMemo(
    () => Object.fromEntries(observaciones.map((o) => [llaveCeldaObservacion(o.fecha, o.slot, o.alumnoId), o.texto])),
    [observaciones],
  )

  // Fechas que hoy tienen más de una hora de clase: ahí la bitácora escribe la hora.
  function fechasVariasHoras() {
    const cuenta = {}
    attendanceRecords.forEach((r) => { if (!esSesionInformativa(r)) cuenta[r.fecha] = (cuenta[r.fecha] || 0) + 1 })
    return new Set(Object.keys(cuenta).filter((f) => cuenta[f] > 1))
  }
  function etiquetaObs(obs, delAlumno) {
    return etiquetaFechaObservacion(obs, { fechasVariasHoras: fechasVariasHoras(), observaciones: delAlumno })
  }

  // `info` llega ya resuelto por AttendanceTable, venga del clic derecho, del
  // teclado o de la pulsación larga: { x, y, trigger, tactil }.
  // En táctil (sin hover) el menú de una celda con observación muestra el
  // texto resumido: es la forma de consultarla sin robarle el toque a P/F/J.
  function cellContextMenu(info, record, student) {
    if (esSesionInformativa(record)) return
    const id = observacionId(subjectId, record.fecha, record.slot, student.id)
    const existente = observaciones.find((o) => o.id === id)
    setMenuAsistencia({
      ...info,
      resumen: info.tactil ? existente?.texto : undefined,
      ariaLabel: `Observación de ${studentFullName(student)}`,
      items: [{
        label: existente ? 'Ver / editar observación' : 'Agregar observación',
        icon: Pencil,
        onSelect: () => {
          const delAlumno = observaciones.filter((o) => o.alumnoId === student.id)
          setObservacionModal({
            id,
            record,
            student,
            fecha: etiquetaObs(existente || { fecha: record.fecha, slot: record.slot }, existente ? delAlumno : [...delAlumno, { fecha: record.fecha, slot: record.slot }]),
            original: existente?.texto || '',
            sobreBitacora: false,
          })
        },
      }],
    })
  }
  function nameContextMenu(info, student) {
    setMenuAsistencia({
      ...info,
      ariaLabel: `Opciones de ${studentFullName(student)}`,
      items: [{
        label: 'Ver bitácora',
        tooltip: 'Ver e imprimir las observaciones registradas de este estudiante',
        icon: BookOpen,
        onSelect: () => setBitacoraStudent(student),
      }],
    })
  }
  const cellContextMenuRef = useRef(); cellContextMenuRef.current = cellContextMenu
  const stableCellContextMenu = useCallback((info, record, student) => cellContextMenuRef.current(info, record, student), [])
  const nameContextMenuRef = useRef(); nameContextMenuRef.current = nameContextMenu
  const stableNameContextMenu = useCallback((info, student) => nameContextMenuRef.current(info, student), [])
  const cerrarMenuAsistencia = useCallback(() => setMenuAsistencia(null), [])

  // Guardar: crea, edita, o —con el texto vacío— quita la observación.
  async function guardarObservacion(texto) {
    const modal = observacionModal
    if (!modal) return
    const existente = observaciones.find((o) => o.id === modal.id)
    try {
      if (!texto) {
        if (existente) {
          await eliminarObservacionAsistencia(modal.id)
          setObservaciones((prev) => prev.filter((o) => o.id !== modal.id))
          toast('Observación eliminada')
        }
      } else if (existente) {
        await editarObservacionAsistencia(modal.id, texto)
        setObservaciones((prev) => prev.map((o) => o.id === modal.id ? { ...o, texto } : o))
        toast('Observación guardada')
      } else {
        const nueva = await crearObservacionAsistencia({
          asignaturaId: subjectId,
          docenteId: currentUser.uid,
          alumnoId: modal.student.id,
          record: modal.record,
          texto,
        })
        setObservaciones((prev) => [...prev, nueva])
        toast('Observación guardada')
      }
      setObservacionModal(null)
    } catch (err) {
      toast('Error al guardar la observación: ' + err.message, 'error')
    }
  }

  const bitacoraFilas = bitacoraStudent
    ? (() => {
        const delAlumno = observaciones.filter((o) => o.alumnoId === bitacoraStudent.id)
        return ordenarBitacora(delAlumno).map((o) => ({ id: o.id, fecha: etiquetaObs(o, delAlumno), texto: o.texto }))
      })()
    : []
  function editarDesdeBitacora(id) {
    const obs = observaciones.find((o) => o.id === id)
    if (!obs || !bitacoraStudent) return
    const delAlumno = observaciones.filter((o) => o.alumnoId === bitacoraStudent.id)
    setObservacionModal({ id, student: bitacoraStudent, fecha: etiquetaObs(obs, delAlumno), original: obs.texto, sobreBitacora: true })
  }
  function imprimirBitacoraActual() {
    if (!bitacoraStudent) return
    try {
      imprimirBitacora({
        estudiante: studentFullName(bitacoraStudent),
        asignatura: subjectDisplayName(subject),
        docente: membrete.docente,
        filas: bitacoraFilas,
      })
    } catch (err) {
      toast('No se pudo imprimir: ' + err.message, 'error')
    }
  }

  // Guarda el motivo y deja la celda en "justificada".
  async function handleSaveReason() {
    if (!reasonModal) return
    const { recordId, studentId } = reasonModal
    if (esSesionInformativa(recordId)) { setReasonModal(null); return }
    const motivo = reasonText.trim()
    setAttendanceRecords((prev) => prev.map((r) => r.id === recordId ? {
      ...r,
      presentes: { ...r.presentes, [studentId]: false },
      justificadas: { ...(r.justificadas || {}), [studentId]: true },
      motivos: { ...(r.motivos || {}), [studentId]: motivo },
    } : r))
    setReasonModal(null)
    try {
      await setAttendanceState(recordId, studentId, 'justificada', motivo)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      await loadAttendance(true)
    }
  }

  async function handleDeleteAttendanceDay() {
    if (!deleteAttendanceConfirm) return
    const fecha = deleteAttendanceConfirm.fecha
    // Un día informativo de asueto/vacaciones no tiene registros que borrar, y
    // agregarlo a attendanceExcluded no tendría sentido.
    if (!attendanceRecords.some((r) => r.fecha === fecha && !esSesionInformativa(r))) {
      setDeleteAttendanceConfirm(null)
      return
    }
    setDeletingAttendance(true)
    try {
      await deleteAttendanceDay(attendanceRecords, fecha)
      // Si el curso ya tiene fechas configuradas, este día pudo haberse
      // generado solo (horarioBloques) — sin esto, loadAttendance(true) de
      // abajo lo volvería a crear de inmediato al re-sincronizar. Se pasa
      // el subject YA actualizado (subjectOverride): setSubject es
      // asíncrono, así que el `subject` del estado todavía no lo refleja
      // en este mismo tick.
      let subjectForSync = subject
      if (subject?.fechaInicio && subject?.fechaFin) {
        subjectForSync = { ...subject, attendanceExcluded: [...(subject.attendanceExcluded || []), fecha] }
        await updateDoc(doc(db, 'subjects', subjectId), { attendanceExcluded: arrayUnion(fecha) })
        setSubject(subjectForSync)
      }
      setDeleteAttendanceConfirm(null)
      await loadAttendance(true, subjectForSync)
      toast('Día de asistencia eliminado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setDeletingAttendance(false)
    }
  }

  // Restaura UN día que el docente había borrado (sigue siendo válido según
  // el horario y las fechas del curso) — lo quita de attendanceExcluded y
  // vuelve a crear sus columnas, igual que uno agregado a mano.
  async function handleRestoreAttendanceDay(dia) {
    setRestoringFecha(dia.fecha)
    try {
      await createAttendanceDay({
        subjectId,
        docenteId: subject.docenteId,
        fecha: dia.fecha,
        duracion: dia.duracion,
        parcial: dia.parcial,
        studentIds: groupStudents.map((s) => s.id),
      })
      const subjectForSync = { ...subject, attendanceExcluded: (subject.attendanceExcluded || []).filter((f) => f !== dia.fecha) }
      await updateDoc(doc(db, 'subjects', subjectId), { attendanceExcluded: arrayRemove(dia.fecha) })
      setSubject(subjectForSync)
      setShowRestoreAttendance(false)
      await loadAttendance(true, subjectForSync)
      toast('Día de asistencia restaurado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setRestoringFecha(null)
    }
  }

  // ── Student management (Alumnos tab) ──────────────────────────────
  // All `students` docs of the school (every enrollment of every person). Used both to
  // dedupe usernames for brand-new people and to detect existing identities (same person
  // re-enrolled) so we can reuse their username/uid instead of forking a second account.
  // La UNIÓN de dos búsquedas, y las dos hacen falta:
  //
  //  (a) TODA la escuela del docente. El alumno existe a nivel de ESCUELA, no
  //      de docente: si el maestro de Historia da de alta a alguien que el de
  //      Cultura Digital ya tenía, tiene que encontrarlo para reutilizar su
  //      cuenta en vez de forjarle una segunda. Sin esto, que no se duplicara
  //      dependía de que `generateUsername` (apellido.nombre) coincidiera por
  //      casualidad — y en cuanto hacía falta un sufijo por colisión, o el
  //      nombre venía escrito distinto, salía una cuenta paralela. Pasó de
  //      verdad en producción (mendez.enrique / mendez.enrique01).
  //
  //  (b) Sus PROPIAS asignaturas, aunque la escuela ya no coincida. Cambiar de
  //      escuela en Profile.jsx "solo aplica a asignaturas y estudiantes
  //      nuevos": los alumnos dados de alta antes conservan la escuela vieja y
  //      (a) no los alcanzaría. El docenteId nunca cambia, así que este lado
  //      es estable ante cualquier cambio de escuela.
  //
  // Encontrar a alguien aquí NO fusiona nada por su cuenta: solo habilita la
  // pregunta "¿es el mismo estudiante?" que decide el docente (ver
  // resolveLinkCandidate). Dos personas distintas con el mismo nombre siguen
  // pudiendo tener cuentas separadas.
  async function fetchSchoolStudents() {
    const escuelaId = userProfile?.escuelaId
    const subjSnap = await getDocs(query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid)))
    const subjectIds = subjSnap.docs.map((d) => d.id)
    const chunks = []
    for (let i = 0; i < subjectIds.length; i += 30) chunks.push(subjectIds.slice(i, i + 30))
    const snaps = await Promise.all([
      escuelaValida(escuelaId)
        ? getDocs(query(collection(db, 'students'), where('escuelaId', '==', escuelaId)))
        : Promise.resolve({ docs: [] }),
      ...chunks.map((ids) => getDocs(query(collection(db, 'students'), where('asignaturaId', 'in', ids)))),
    ])
    // Un mismo doc puede venir por los dos lados — se deduplica por id.
    const porId = new Map()
    snaps.forEach((snap) => snap.docs.forEach((d) => porId.set(d.id, { id: d.id, ...d.data() })))
    return [...porId.values()]
  }

  function uniqueFrom(person, schoolDocs) {
    const taken = new Set(schoolDocs.map((d) => d.username))
    return uniqueUsername(
      generateUsername(person.apellidoPaterno, person.apellidoMaterno, person.nombre),
      taken
    )
  }

  async function refreshGroupStudents() {
    const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
    setGroupStudents(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)))
    // La lista recién traída es la buena: marcarla como cargada es lo que hace
    // que `totalStudents` deje de usar el conteo viejo de loadAll().
    setGroupStudentsLoaded(true)
  }

  // Al agregar estudiantes a una asignatura con parciales YA cerrados
  // (confirmCloseParcial más abajo), sus actividades de esos parciales
  // quedan bloqueadas para calificar (mismo candado que usa parcialCerrado)
  // y promedioParcial las excluye en silencio en vez de tratarlas como "sin
  // entrega" igual que a sus compañeros — un alta tardía nunca recibía esa
  // misma cobertura. Esto la replica para los estudiantes recién agregados,
  // con la MISMA calificación que ya se usó para el resto del grupo en ese
  // cierre (0 si ese parcial se cerró sin ninguna falta que rellenar).
  async function backfillClosedParcialesFor(studentIds) {
    const parcialesCerrados = subject?.parcialesCerrados || {}
    const closedParciales = Object.keys(parcialesCerrados).map(Number)
    if (closedParciales.length === 0 || studentIds.length === 0) return
    const entries = []
    for (const p of closedParciales) {
      const acts = activities.filter((a) => a.parcial === p && cuentaParaCalificacion(a))
      if (acts.length === 0) continue
      const subDocs = await fetchSubmissionsForActivities(acts.map((a) => a.id))
      const cierreDoc = subDocs.find((d) => esNotaAutomaticaDeCierre(d.data()))
      const grade = cierreDoc ? cierreDoc.data().calificacion : 0
      acts.forEach((a) => entries.push({ a, grade }))
    }
    if (entries.length === 0) return
    // Un lote por actividad: con el parcial ya cerrado, cada escritura hace que
    // firestore.rules lea la actividad y su asignatura (notaAutomaticaDeCierre),
    // y un lote no puede consultar más de 20 documentos distintos.
    for (const { a, grade } of entries) {
      for (let i = 0; i < studentIds.length; i += 400) {
        const batch = writeBatch(db)
        studentIds.slice(i, i + 400).forEach((sid) => {
          // Id determinista (A12 · H5 · R22).
          const ref = doc(db, 'submissions', submissionDocId(a.id, sid))
          batch.set(ref, {
            alumnoId: sid,
            actividadId: a.id,
            calificacion: grade,
            comentario: '',
            estado: 'calificado',
            sinEntrega: true,
            cierreParcial: true,
            fechaEntrega: serverTimestamp(),
          })
        })
        await batch.commit()
      }
    }
  }

  // Creates one enrollment doc. If `identity` is given (re-enrolling an existing person),
  // the new doc inherits that person's username/uid/activado so all their subjects share a
  // single account — and an already-activated student gets the new subject instantly.
  async function createEnrollment(person, identity, schoolDocs) {
    const username = identity ? identity.username : uniqueFrom(person, schoolDocs)
    const ref = await addDoc(collection(db, 'students'), {
      // Se guarda TAL CUAL lo escribió el docente — la capitalización es solo
      // de cara a la pantalla (ver capitalizarNombre en utils/nombres.js), no
      // se le corrige el dato a quien sí lo escribió con cuidado.
      apellidoPaterno: person.apellidoPaterno.trim(),
      apellidoMaterno: person.apellidoMaterno.trim(),
      nombre: person.nombre.trim(),
      username,
      resetPassword: identity ? (identity.resetPassword || null) : generateResetPassword(),
      // Identidad ya conocida → su MISMA escuela (ver identity.escuelaId en
      // studentIdentity.js), no la escuela actual del docente.
      // Identidad ya conocida → su MISMA escuela; si es alguien nuevo, la del
      // docente, que SIEMPRE es una escuela real (el guard de rutas no deja
      // operar sin ella — ver utils/escuela.js). Nunca un centinela.
      escuelaId: identity ? identity.escuelaId : userProfile.escuelaId,
      asignaturaId: subjectId,
      activado: identity ? identity.activado : false,
      uid: identity ? (identity.uid || null) : null,
      orden: groupStudents.length + 1,
      createdAt: serverTimestamp(),
    })
    await backfillClosedParcialesFor([ref.id])
  }

  // Duplicate names get a zero-padded suffix: garcia.juan, garcia.juan01,
  // garcia.juan02… (dedupe is school-wide — usernames are the account id)
  function uniqueUsername(base, taken) {
    if (!taken.has(base)) return base
    let i = 1
    while (taken.has(`${base}${String(i).padStart(2, '0')}`)) i++
    return `${base}${String(i).padStart(2, '0')}`
  }

  async function addStudent(e) {
    e.preventDefault()
    setSavingStudent(true)
    try {
      const schoolDocs = await fetchSchoolStudents()
      const identity = findStudentIdentity(schoolDocs, newStudent)
      // Already enrolled in THIS subject → don't create a duplicate.
      if (identity && identity.matches.some((m) => m.asignaturaId === subjectId)) {
        toast('Ese estudiante ya está en esta asignatura', 'error')
        return
      }
      // Same full name elsewhere in the school → ask the teacher if it's the same person
      // before reusing (linking) their account.
      if (identity) {
        setLinkCandidate({ person: { ...newStudent }, identity, schoolDocs })
        return
      }
      // Nombre PARECIDO (una letra, un nombre de pila de más, el materno que
      // falta): tampoco se crea en silencio. Es el caso que partió en dos a
      // una alumna real — ver findSimilarIdentity en utils/studentIdentity.js.
      const parecida = findSimilarIdentity(schoolDocs, newStudent)
      if (parecida) {
        setLinkCandidate({ person: { ...newStudent }, identity: parecida, schoolDocs })
        return
      }
      await createEnrollment(newStudent, null, schoolDocs)
      setNewStudent({ apellidoPaterno: '', apellidoMaterno: '', nombre: '' })
      setShowAddStudent(false)
      toast('Estudiante agregado')
      await refreshGroupStudents()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
    }
  }

  // Resolves the "same name found" confirmation: link to the existing account or create new.
  async function resolveLinkCandidate(isSamePerson) {
    if (!linkCandidate) return
    const { person, identity, schoolDocs } = linkCandidate
    setSavingStudent(true)
    try {
      // "Es la misma persona" y esa persona YA está en esta asignatura (solo
      // puede pasar por la vía del nombre parecido: el camino exacto se corta
      // antes, en addStudent). Vincular aquí crearía una segunda fila de la
      // misma alumna en la misma lista, que es justo lo contrario de lo que
      // se pidió.
      if (isSamePerson && identity.matches?.some((m) => m.asignaturaId === subjectId)) {
        setNewStudent({ apellidoPaterno: '', apellidoMaterno: '', nombre: '' })
        setShowAddStudent(false)
        toast(`Ya está en esta asignatura, escrita como ${studentFullName(identity.matches.find((m) => m.asignaturaId === subjectId))}`)
        return
      }
      await createEnrollment(person, isSamePerson ? identity : null, schoolDocs)
      setNewStudent({ apellidoPaterno: '', apellidoMaterno: '', nombre: '' })
      setShowAddStudent(false)
      toast(isSamePerson ? 'Asignatura vinculada a su cuenta' : 'Estudiante agregado (cuenta nueva)')
      await refreshGroupStudents()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
      setLinkCandidate(null)
    }
  }

  // Paso 1: leer el archivo y armar la vista previa — pedido explícito, NO
  // se escribe nada en Firestore todavía. Cada fila se clasifica (nueva /
  // vinculada a una cuenta existente / ya inscrita) para que el docente vea
  // exactamente qué va a pasar, y las filas que no se pudieron leer se
  // muestran aparte con su número de fila real de Excel para poder
  // corregirlas — antes desaparecían en silencio.
  async function handleExcelFileSelected(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setParsingExcel(true)
    try {
      const { valid, invalid } = await parseStudentExcel(file)
      if (valid.length === 0 && invalid.length === 0) {
        toast('El archivo está vacío', 'error')
        return
      }
      const schoolDocs = await fetchSchoolStudents()
      const taken = new Set(schoolDocs.map((d) => d.username))
      const rows = valid.map((row) => {
        const identity = findStudentIdentity(schoolDocs, row)
        if (identity && identity.matches.some((m) => m.asignaturaId === subjectId)) {
          return { row, status: 'skip', identity }
        }
        // decision: la propuesta del clasificador, pero el docente la puede
        // voltear en la vista previa (ver toggleImportLinkDecision) — antes
        // una coincidencia de nombre se vinculaba de una vez, sin preguntar,
        // a diferencia del alta manual (arriba), que SIEMPRE pregunta "¿es
        // el mismo estudiante?" antes de reutilizar una cuenta. Con nombres
        // comunes (dos "Juan Pérez García" distintos en la misma escuela) eso
        // fusionaba en silencio a dos personas reales en una sola cuenta.
        if (identity) return { row, status: 'link', decision: 'link', identity }
        // Nombre PARECIDO — la misma duda, pero al revés: aquí la propuesta
        // por default es CUENTA NUEVA. Un parecido no basta para unir a dos
        // personas sin que nadie lo mire, y unir por error a dos hermanas
        // sería mucho peor que dejar dos cuentas. Lo que no puede pasar es
        // que la fila sea invisible: se marca en ámbar y se puede voltear.
        const parecida = findSimilarIdentity(schoolDocs, row)
        if (parecida) return { row, status: 'link', decision: 'new', identity: parecida, parecido: true }
        return { row, status: 'new', decision: 'new' }
      })
      // Dos filas del MISMO archivo con el mismo nombre (captura repetida,
      // copiar-pegar de más) antes generaban dos cuentas nuevas para la misma
      // persona. Solo la primera aparición se procesa normal; las siguientes
      // se marcan aparte y se omiten al confirmar.
      const seenKeys = new Set()
      rows.forEach((item) => {
        const key = studentNameKey(item.row)
        if (seenKeys.has(key)) { item.status = 'duplicate' }
        else seenKeys.add(key)
      })
      setExcelPreview({ rows, invalid, schoolDocs, taken })
    } catch (err) {
      toast('Error leyendo el Excel: ' + err.message, 'error')
    } finally {
      setParsingExcel(false)
    }
  }

  // El docente voltea la decisión de una fila "coincide con alguien más" en
  // la vista previa: de vincularla a esa cuenta, a crearle una cuenta nueva
  // (es una persona distinta que solo comparte el nombre). Solo aplica a
  // filas 'link' — 'skip' (ya inscrito en ESTA asignatura) y 'new' (nadie
  // coincide) no tienen nada que decidir.
  function toggleImportLinkDecision(i) {
    setExcelPreview((prev) => {
      if (!prev) return prev
      const rows = prev.rows.map((item, idx) => {
        if (idx !== i || item.status !== 'link') return item
        return { ...item, decision: item.decision === 'link' ? 'new' : 'link' }
      })
      return { ...prev, rows }
    })
  }

  // Paso 2: el docente ya revisó la vista previa y confirma — aquí sí se
  // escribe en Firestore, igual que antes.
  async function confirmExcelImport() {
    if (!excelPreview) return
    setImportingExcel(true)
    try {
      const { rows, taken } = excelPreview
      const batch = writeBatch(db)
      let nextOrden = groupStudents.length + 1
      let created = 0
      let linked = 0
      let skipped = 0
      let duplicated = 0
      const newIds = []
      for (const item of rows) {
        if (item.status === 'skip') { skipped++; continue }
        if (item.status === 'duplicate') { duplicated++; continue }
        const row = item.row
        let username, uid = null, activado = false, escuelaId = userProfile.escuelaId
        // "Es la misma" por parecido, y esa persona ya está en esta
        // asignatura: no se agrega nada. Vincularla crearía una segunda fila
        // de la misma alumna en la misma lista.
        if (item.status === 'link' && item.decision === 'link'
            && item.identity?.matches?.some((m) => m.asignaturaId === subjectId)) {
          skipped++
          continue
        }
        if (item.status === 'link' && item.decision === 'link') {
          // Same person elsewhere, y el docente lo confirmó en la vista previa
          // (o lo dejó tal cual, que es la propuesta por default) → se vincula
          // a su cuenta existente. Su MISMA escuela, no la actual del docente
          // (ver identity.escuelaId en studentIdentity.js).
          username = item.identity.username; uid = item.identity.uid || null; activado = item.identity.activado
          escuelaId = item.identity.escuelaId
          linked++
        } else {
          username = uniqueUsername(generateUsername(row.apellidoPaterno, row.apellidoMaterno, row.nombre), taken)
          taken.add(username)
          created++
        }
        const ref = doc(collection(db, 'students'))
        newIds.push(ref.id)
        batch.set(ref, {
          // Tal cual venía en el Excel, igual que un alta manual: si la lista
          // trae MAYÚSCULAS, la pantalla se encarga de mostrarlas bien.
          ...row,
          username,
          resetPassword: (item.status === 'link' && item.identity)
            ? (item.identity.resetPassword || null)
            : generateResetPassword(),
          uid,
          escuelaId,
          asignaturaId: subjectId,
          activado,
          orden: nextOrden++,
          createdAt: serverTimestamp(),
        })
      }
      await batch.commit()
      await backfillClosedParcialesFor(newIds)
      const parts = [`${created} estudiantes importados`]
      if (linked) parts.push(`${linked} vinculados a cuentas existentes`)
      if (skipped) parts.push(`${skipped} ya estaban en la asignatura`)
      if (duplicated) parts.push(`${duplicated} repetidos en el archivo — se omitieron`)
      toast(parts.join(' · '))
      setExcelPreview(null)
      await refreshGroupStudents()
    } catch (err) {
      toast('Error importando Excel: ' + err.message, 'error')
    } finally {
      setImportingExcel(false)
    }
  }

  // Restablece la contraseña del alumno aplicando en Firebase Auth la contraseña
  // de reset que se generó al crear al alumno (UNA SOLA VEZ, permanente).
  // El docente no ve ni copia ningún valor — solo pulsa el botón.
  async function confirmResetStudentPassword() {
    if (!studentToReset) return
    try {
      const token = await currentUser.getIdToken()
      const resp = await fetchApi('/api/student/reset-student-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ studentId: studentToReset.id }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        toast(data.error || 'Error al restablecer la contraseña', 'error')
        return
      }
      setGroupStudents((prev) =>
        prev.map((s) => s.id === studentToReset.id ? { ...s, activado: false } : s)
      )
      setResetPwdResult({ student: studentToReset })
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setStudentToReset(null)
    }
  }

  async function confirmDeleteStudent() {
    if (!studentToDelete) return
    setSavingStudent(true)
    try {
      // Igual para sus prórrogas por actividad — sin esto, activities.extensiones
      // se quedaba con la llave del estudiante borrado para siempre (dato
      // muerto, nunca vuelve a leerse porque ningún id nuevo la reutiliza,
      // pero se acumula sin necesidad).
      const conExtension = activities.filter((a) =>
        a.extensiones?.[studentToDelete.id] !== undefined || a.extensionesMotivo?.[studentToDelete.id] !== undefined)
      if (conExtension.length > 0) {
        const extBatch = writeBatch(db)
        conExtension.forEach((a) => {
          extBatch.update(doc(db, 'activities', a.id), {
            [`extensiones.${studentToDelete.id}`]: deleteField(),
            [`extensionesTS.${studentToDelete.id}`]: deleteField(),
            [`extensionesMotivo.${studentToDelete.id}`]: deleteField(),
          })
        })
        await extBatch.commit()
        setActivities((prev) => prev.map((a) => {
          if (!conExtension.some((c) => c.id === a.id)) return a
          const extensiones = { ...a.extensiones }; delete extensiones[studentToDelete.id]
          const extensionesMotivo = { ...a.extensionesMotivo }; delete extensionesMotivo[studentToDelete.id]
          return { ...a, extensiones, extensionesMotivo }
        }))
      }
      // Primero la inscripción y DESPUÉS sus entregas: un parcial cerrado
      // definitivamente no deja borrar calificaciones de un estudiante que
      // sigue inscrito (firestore.rules), y eliminar a un estudiante es una
      // operación administrativa que debe poder hacerse igual.
      // Sus observaciones de Asistencias también se van: eliminar a un
      // estudiante no debe dejar residuos (a diferencia de eliminar un día de
      // asistencia, que las conserva a propósito).
      const obsBorradas = await eliminarObservacionesDeAlumno(subjectId, currentUser.uid, studentToDelete.id)
      if (obsBorradas.length) setObservaciones((prev) => prev.filter((o) => o.alumnoId !== studentToDelete.id))
      await deleteDoc(doc(db, 'students', studentToDelete.id))
      await deleteSubmissionsByStudent(studentToDelete.id, activities.map((a) => a.id))
      const remaining = groupStudents.filter((s) => s.id !== studentToDelete.id)
      const batch = writeBatch(db)
      remaining.forEach((s, i) => batch.update(doc(db, 'students', s.id), { orden: i + 1 }))
      await batch.commit()
      toast(`${studentToDelete.username} eliminado`)
      setStudentToDelete(null)
      setGroupStudents(remaining.map((s, i) => ({ ...s, orden: i + 1 })))
    } catch (err) {
      toast('Error al eliminar: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
    }
  }

  function openEditStudent(s) {
    setStudentToEdit(s)
    setStudentLastAccess(null)
    // Capitalizado, para que el formulario muestre el MISMO nombre que la lista
    // (un registro viejo guardado en MAYÚSCULAS se ve aquí ya corregido) y para
    // que el docente pueda dejarlo exactamente como lo quiere ver.
    setEditStudentForm({
      apellidoPaterno: capitalizarNombre(s.apellidoPaterno),
      apellidoMaterno: capitalizarNombre(s.apellidoMaterno),
      nombre: capitalizarNombre(s.nombre),
      comentarios: s.comentarios || '',
    })
    if (s.uid && s.id) {
      currentUser.getIdToken().then((token) =>
        fetchApi('/api/student/last-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ studentId: s.id }),
        })
          .then((r) => r.json())
          .then((data) => { if (data.lastAccess) setStudentLastAccess(data.lastAccess) })
          .catch(() => {})
      ).catch(() => {})
    }
  }

  // "Guardar cambios" de Editar estudiante se apaga sin cambios — compara
  // contra studentToEdit, el mismo registro con el que openEditStudent llenó
  // el formulario.
  // Se compara capitalizado de los dos lados: si el registro venía en
  // MAYÚSCULAS, abrir el modal no debe encender "Guardar cambios" solo por eso.
  const editStudentChanged =
    capitalizarNombre(editStudentForm.apellidoPaterno) !== capitalizarNombre(studentToEdit?.apellidoPaterno) ||
    capitalizarNombre(editStudentForm.apellidoMaterno) !== capitalizarNombre(studentToEdit?.apellidoMaterno) ||
    capitalizarNombre(editStudentForm.nombre) !== capitalizarNombre(studentToEdit?.nombre) ||
    editStudentForm.comentarios.trim() !== (studentToEdit?.comentarios || '')

  // Permitir reingreso a un alumno que salió por su cuenta (ocultaPorAlumno)
  // — pedido explícito: no se reactiva solo con el código, requiere que el
  // docente se lo permita explícitamente desde aquí.
  async function handleAllowRejoin(s) {
    try {
      await updateDoc(doc(db, 'students', s.id), { ocultaPorAlumno: deleteField(), ocultaPorAlumnoAt: deleteField() })
      setGroupStudents((prev) => prev.map((x) => (x.id === s.id ? { ...x, ocultaPorAlumno: false, ocultaPorAlumnoAt: null } : x)))
      toast('Ahora puede volver a entrar con su código')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function handleDeleteStudentPhoto() {
    if (!studentToEdit?.photoURL) return
    try {
      await updateDoc(doc(db, 'students', studentToEdit.id), { photoURL: deleteField() })
      setGroupStudents((prev) => prev.map((s) => (s.id === studentToEdit.id ? { ...s, photoURL: null } : s)))
      setStudentToEdit((s) => (s ? { ...s, photoURL: null } : s))
      toast('Foto eliminada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function saveEditStudent(e) {
    e.preventDefault()
    if (!studentToEdit) return
    setSavingStudent(true)
    try {
      // Como lo deja el docente al editar: si escribe "de la Cruz", así se
      // guarda y así se ve. El formulario ya venía lleno con lo que muestra la
      // lista (ver openEditStudent), así que lo que quede aquí es su decisión.
      const updated = {
        apellidoPaterno: editStudentForm.apellidoPaterno.trim(),
        apellidoMaterno: editStudentForm.apellidoMaterno.trim(),
        nombre: editStudentForm.nombre.trim(),
        comentarios: editStudentForm.comentarios.trim(),
      }
      await updateDoc(doc(db, 'students', studentToEdit.id), updated)
      setGroupStudents((prev) => prev.map((s) => (s.id === studentToEdit.id ? { ...s, ...updated } : s)))
      toast('Estudiante actualizado')
      setStudentToEdit(null)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
    }
  }

  // Hands off to the existing reset-password / delete-confirmation modals, kept out of
  // the row itself (the teacher kept clicking it by accident, prompting students to ask
  // for a reset they didn't need) so the cascade-delete and orden re-index stay in one place.
  function requestResetFromEdit() {
    setStudentToReset(studentToEdit)
    setStudentToEdit(null)
  }

  function requestDeleteFromEdit() {
    setStudentToDelete(studentToEdit)
    setStudentToEdit(null)
  }

  async function sortStudentsAlphabetically() {
    const newList = [...groupStudents].sort((a, b) =>
      studentFullName(a).localeCompare(studentFullName(b), 'es')
    )
    try {
      const batch = writeBatch(db)
      newList.forEach((s, i) => batch.update(doc(db, 'students', s.id), { orden: i + 1 }))
      await batch.commit()
      setGroupStudents(newList.map((s, i) => ({ ...s, orden: i + 1 })))
      toast('Estudiantes ordenados alfabéticamente')
    } catch (err) {
      toast('No se pudo ordenar: ' + err.message, 'error')
    }
  }

  function copyAccessCode() {
    if (!subject?.accessCode) return
    navigator.clipboard.writeText(subject.accessCode).then(() => {
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    })
  }

  // ── Nueva actividad: hoja del picker (reorganización 23-ago-2026) ──
  // `tipo`: 'entregable'|'cuestionario'|'examen'|'observacion'.
  // `metodo`: 'manual'|'ia'. Reutiliza EXACTAMENTE los mismos setters que
  // ya abrían cada modal antes de la reorganización — "con IA" nunca fue
  // un tipo de actividad guardado, solo decide qué modal de creación abrir.
  // Video interactivo: la actividad la crea el modal (oculta). Se relee y se suma a la lista local
  // para que se vea sin recargar, tanto al terminar la generación como si falló y quedó borrador.
  async function anexarActividadVideo(activityId) {
    try {
      const snap = await getDoc(doc(db, 'activities', activityId))
      if (!snap.exists()) return
      const activity = { id: snap.id, ...snap.data() }
      setActivities((prev) => prev.some((a) => a.id === activity.id) ? prev : [...prev, activity])
      setSubmissionCounts((prev) => ({ ...prev, [activity.id]: { delivered: 0, graded: 0 } }))
    } catch { /* si falla, aparece al recargar */ }
  }

  function elegirCreacion(tipo, metodo) {
    setShowModal(false)
    if (metodo === 'ia') {
      if (tipo === 'entregable' || tipo === 'observacion') {
        setCrearActividadIA({ categoria: tipo })
      } else {
        setCrearEvalIA({ categoria: tipo })
      }
      return
    }
    if (tipo === 'entregable' || tipo === 'observacion') {
      setEntregableEditor({ activityId: null, parcial: modalParcial, categoria: tipo, activityLabel: null, initialForm: null, initialExistingFiles: null })
    } else {
      setEvalEditor({ activityId: null, categoria: tipo, parcial: modalParcial, activityLabel: `${modalParcial}.${activities.filter((a) => a.parcial === modalParcial).length + 1}.` })
    }
  }

  // ── Activity actions ───────────────────────────────────────────────
  function openAdd(parcial) {
    if (parcialCerrado(subject, parcial)) { toast(mensajeParcialCerrado(parcial), 'error'); return }
    if (!canCreate) {
      toast('Necesitas Créditos IA para crear nuevas actividades — toda tu información sigue disponible')
      return
    }
    setModalMode('create'); setModalParcial(parcial); setEditActivityId(null)
    setForm(EMPTY_FORM)
    setActivityExistingFiles([]); setActivityNewFiles([])
    setTipoActividad(null)
    setMenuPaso(null)
    setShowModal(true)
  }

  // ── Traer actividad de otra asignatura ─────────────────────────────
  async function openImport(parcial) {
    if (parcialCerrado(subject, parcial)) { toast(mensajeParcialCerrado(parcial), 'error'); return }
    if (!canCreate) {
      toast('Necesitas Créditos IA para crear nuevas actividades — toda tu información sigue disponible')
      return
    }
    setImportFor(parcial)
    setImportSrc(null); setImportSrcActs([]); setImportSel(new Set())
    setImportLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid)))
      const subs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.id !== subjectId)
        .sort((a, b) => subjectDisplayName(a).localeCompare(subjectDisplayName(b), 'es'))
      setImportSubjects(subs)
    } catch (err) {
      toast('Error al cargar tus asignaturas: ' + err.message, 'error')
    } finally {
      setImportLoading(false)
    }
  }

  async function pickImportSubject(sub) {
    setImportSrc(sub)
    setImportSel(new Set())
    setImportLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', sub.id), where('docenteId', '==', currentUser.uid)))
      const acts = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        // Un juego sin confirmar no se ofrece: la copia quedaría imposible de
        // confirmar y de publicar (ver esCopiable en utils/copiaActividad.js).
        .filter((a) => !isDraftActivity(a) && esCopiable(a))
        .sort((a, b) => (a.parcial - b.parcial) || ((a.orden ?? 0) - (b.orden ?? 0)))
      setImportSrcActs(acts)
    } catch (err) {
      toast('Error al cargar las actividades: ' + err.message, 'error')
    } finally {
      setImportLoading(false)
    }
  }

  function toggleImportSel(id) {
    setImportSel((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function confirmImport() {
    if (!importSel.size) return
    setImporting(true)
    try {
      const chosen = importSrcActs.filter((a) => importSel.has(a.id))
      const startOrden = activities.filter((a) => a.parcial === importFor).length + 1
      const created = await importActivitiesToSubject({
        sourceActivities: chosen,
        targetSubjectId: subjectId,
        targetParcial: importFor,
        docenteId: currentUser.uid,
        startOrden,
      })
      setActivities((prev) => [...prev, ...created])
      created.forEach((a) => setSubmissionCounts((prev) => ({ ...prev, [a.id]: { delivered: 0, graded: 0 } })))
      toast(`${created.length} actividad${created.length !== 1 ? 'es' : ''} traída${created.length !== 1 ? 's' : ''} como borrador al Parcial ${importFor}`)
      setImportFor(null)
    } catch (err) {
      toast('Error al traer las actividades: ' + err.message, 'error')
    } finally {
      setImporting(false)
    }
  }

  function openEdit(activity, labelOverride) {
    if (activity.tipo === 'evaluacion') {
      // Roster for "Nueva fecha → Para algunos" inside EvaluacionEditor —
      // same reason as the entregable branch below.
      ensureGroupStudents()
      setEvalEditor({ activityId: activity.id, categoria: activity.categoria, parcial: activity.parcial, activityLabel: labelOverride || null })
      return
    }
    // Roster for the editor's read-only "prórrogas" list (Nueva fecha límite → Para
    // algunos) — load it now instead of waiting for the teacher to visit Alumnos first.
    ensureGroupStudents()
    // Entregable (and legacy actividad/tarea) → full-screen editor
    const cat = ['actividad', 'tarea'].includes(activity.categoria) ? 'entregable' : (activity.categoria || 'entregable')
    setEntregableEditor({
      activityId: activity.id,
      parcial: activity.parcial,
      categoria: cat,
      activityLabel: labelOverride || null,
      initialExistingFiles: activity.archivosAdjuntos || [],
      initialForm: {
        nombre: activity.nombre || '',
        instrucciones: toRichHtml(activity.instrucciones || ''),
        fechaLimite: activity.fechaLimite ? withDefaultTime(activity.fechaLimite, '00:00') : '',
        tiposArchivo: normalizeFileTypeKeys(activity.tiposArchivo),
        extensionesCustom: activity.extensionesCustom || '',
        oculta: activity.oculta || false,
        publishAt: activity.publishAt || '',
        publishedAt: activity.publishedAt || '',
        visibilidadMode: !activity.oculta ? 'published' : activity.publishAt ? 'schedule' : 'hide',
        // Checkbox reads the positive framing ("cerrar en fecha"); the real DB field
        // (recibirTarde) is the inverse — see EntregableEditor's save payload.
        cerrarEntregasEnFecha: !activity.recibirTarde,
        rubrica: activity.rubrica || null,
        rubricaId: activity.rubricaId || null,
        notificarDocente: activity.notificarDocente || false,
      },
    })
  }

  // Published entregable being edited? Only then does the editor offer "Nueva
  // fecha límite de entrega" — same group/per-student extension ActivityPage uses.
  const editorIsPublished = !!entregableEditor?.initialForm?.publishedAt
    && new Date(withDefaultTime(entregableEditor.initialForm.publishedAt, '00:00:00')).getTime() <= Date.now()

  // Live copy of the activity being edited — used to show its current
  // extensiones/extensionesMotivo (per-student prórrogas) in the editor,
  // since entregableEditor.initialForm doesn't carry those fields.
  const editingActivityData = activities.find((a) => a.id === entregableEditor?.activityId)

  // "Para algunos" needs the group roster — load it if the teacher never
  // visited the Alumnos tab this session.
  async function openNewDateForEditor() {
    await ensureGroupStudents()
    setNewDateOpen(true)
  }

  // Merges the modal's result into the activities list AND the currently open
  // editor's form (so its own fecha límite field reflects the change right away).
  function applyNewDateResult(result) {
    setActivities((prev) => prev.map((a) => {
      if (a.id !== entregableEditor?.activityId) return a
      if (result.mode === 'todos') return { ...a, fechaLimite: result.date, cerradaManual: false }
      const ext = { ...(a.extensiones || {}) }
      const em = { ...(a.extensionesMotivo || {}) }
      result.ids.forEach((id) => { ext[id] = result.date; em[id] = result.motivo })
      return { ...a, extensiones: ext, extensionesMotivo: em }
    }))
    if (result.mode === 'todos') {
      setEntregableEditor((prev) => prev && ({ ...prev, initialForm: { ...prev.initialForm, fechaLimite: result.date } }))
    }
  }

  function addInstructionFiles(files) {
    const tooBig = files.find((f) => f.size > MAX_ATTACHMENT_FILE_SIZE)
    if (tooBig) { toast(`"${tooBig.name}" supera el máximo de 15 MB`, 'error'); return }
    setActivityNewFiles((prev) => [...prev, ...files])
  }

  // `index` is into the combined [existing..., new...] list rendered by
  // RichTextEditor's AttachmentList — split it back into the two arrays.
  function removeInstructionFile(index) {
    if (index < activityExistingFiles.length) {
      setActivityExistingFiles((prev) => prev.filter((_, i) => i !== index))
    } else {
      const newIndex = index - activityExistingFiles.length
      setActivityNewFiles((prev) => prev.filter((_, i) => i !== newIndex))
    }
  }

  async function handleSaveActivity(e, asDraft = false) {
    e.preventDefault()
    if (modalMode === 'create' && !canCreate) {
      toast('Necesitas Créditos IA para crear nuevas actividades — toda tu información sigue disponible')
      return
    }
    const tiposArchivo = normalizeFileTypeKeys(form.tiposArchivo)
    if (tiposArchivo.includes(CUSTOM_FILE_TYPE) && parseCustomExts(form.extensionesCustom).length === 0) {
      toast('Escribe al menos una extensión para "Personalizado"', 'error')
      return
    }
    if (!htmlToPlainText(form.instrucciones)) {
      toast('Escribe las instrucciones de la actividad', 'error')
      return
    }
    // fechaLimite must be strictly after the effective publish datetime
    const now = new Date()
    const nowIso = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    if (!asDraft) {
      // A scheduled publication must be in the future
      if (form.visibilidadMode === 'schedule') {
        if (!form.publishAt) { toast('Elige la fecha y hora de publicación', 'error'); return }
        if (form.publishAt <= nowIso) {
          toast('La fecha de publicación programada debe ser posterior a este momento', 'error'); return
        }
      }
      const effectivePublishAt =
        form.visibilidadMode === 'show'     ? nowIso :
        form.visibilidadMode === 'schedule' ? (form.publishAt || null) :
        (form.publishedAt || null)
      if (form.fechaLimite && effectivePublishAt && form.fechaLimite <= effectivePublishAt) {
        toast('La fecha límite debe ser posterior a la fecha de publicación', 'error')
        return
      }
    }
    setSaving(true)
    try {
      const uploaded = await Promise.all(
        activityNewFiles.map(async (file) => ({
          url: await uploadToCloudinary(file, 'evalua-facil/instrucciones-adjuntos'),
          nombre: file.name,
          tamano: file.size,
        }))
      )
      const payload = {
        nombre: form.nombre.trim(),
        categoria: form.categoria,
        maxCalif: 10,
        instrucciones: sanitizeHtml(form.instrucciones),
        archivosAdjuntos: [...activityExistingFiles, ...uploaded],
        fechaLimite: form.fechaLimite || null,
        // Timestamp mirror of fechaLimite — see src/utils/deadline.js. This is
        // what firestore.rules actually enforces (A12 H3); the string above is
        // display-only from here on.
        fechaLimiteTS: fechaLimiteTimestamp(form.fechaLimite),
        // Keep receiving submissions after the deadline (marked as "tarde")
        recibirTarde: form.fechaLimite ? !!form.recibirTarde : false,
        tiposArchivo,
        extensionesCustom: tiposArchivo.includes(CUSTOM_FILE_TYPE) ? (form.extensionesCustom || '').trim() : '',
        oculta: asDraft ? true : form.visibilidadMode !== 'show',
        publishAt: !asDraft && form.visibilidadMode === 'schedule' ? (form.publishAt || null) : null,
        // publishedAt es permanente mientras siga publicada; guardarla como
        // borrador es lo único que la borra, y es justo lo que la regresa a
        // borrador de verdad en vez de dejarla "publicada pero oculta"
        // (mismo criterio que resolveVisibilidad, ver utils/activityVisibility).
        publishedAt: asDraft ? null : (form.visibilidadMode === 'show' ? nowIso : (form.publishedAt || null)),
      }
      if (modalMode === 'create') {
        // `orden` is only a sort key (Firestore gives no ordering guarantee
        // without it). The "Actividad" label (1.1, 1.2…) is presentation —
        // computed fresh from position within the parcial wherever it's shown
        // (see `activityLabelById` below) — never stored, so it can't drift.
        const orden = activities.filter((a) => a.parcial === modalParcial).length + 1
        // orden-1 = the max activity orden BEFORE this new activity is added.
        // Used below to detect materials currently positioned at the end.
        const previousLastActOrden = orden - 1
        const esEvaluacion = tipoActividad === 'cuestionario' || tipoActividad === 'examen'
        const tipo = esEvaluacion ? 'evaluacion' : 'archivo'
        const extra = esEvaluacion ? { evaluacion: EVALUACION_DEFAULTS[form.categoria] } : {}
        const ref = await addDoc(collection(db, 'activities'), {
          ...payload, ...extra, tipo, parcial: modalParcial, orden,
          asignaturaId: subjectId, docenteId: currentUser.uid, createdAt: serverTimestamp(),
        })
        setActivities((prev) => [...prev, { id: ref.id, ...payload, ...extra, tipo, parcial: modalParcial, orden, asignaturaId: subjectId, docenteId: currentUser.uid }])
        setSubmissionCounts((prev) => ({ ...prev, [ref.id]: { delivered: 0, graded: 0 } }))
        // Keep materials that were positioned "at the end" still at the end.
        // Our formula gives end materials orden values strictly in
        // (prevLastActOrden, prevLastActOrden+1), so any material with
        // m.orden > previousLastActOrden was there. Push them past the new
        // activity (orden) with fresh clean values.
        const matsAtEnd = materials.filter((m) =>
          m.parcial === modalParcial && m.ordenManual === true && m.orden > previousLastActOrden
        )
        if (matsAtEnd.length > 0) {
          const sorted = [...matsAtEnd].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
          const k = sorted.length
          const matBatch = writeBatch(db)
          const updatedMats = sorted.map((m, j) => {
            const newOrden = orden + (j + 1) / (k + 1)
            matBatch.update(doc(db, 'materials', m.id), { orden: newOrden })
            return { ...m, orden: newOrden }
          })
          matBatch.commit().catch(() => {}) // best-effort; visual state is correct already
          setMaterials((prev) => prev.map((m) => {
            const upd = updatedMats.find((u) => u.id === m.id)
            return upd || m
          }))
        }
        if (esEvaluacion) {
          toast('Evaluación creada — agrega tus preguntas')
          setShowModal(false); setForm(EMPTY_FORM)
          setActivityExistingFiles([]); setActivityNewFiles([])
          navigate(`/activity/${ref.id}`)
          return
        }
        toast(asDraft ? 'Borrador guardado — oculto para estudiantes' : 'Actividad creada')
      } else {
        await updateDoc(doc(db, 'activities', editActivityId), payload)
        setActivities((prev) => prev.map((a) => a.id === editActivityId ? { ...a, ...payload } : a))
        toast(asDraft ? 'Borrador guardado — oculto para estudiantes' : 'Actividad actualizada')
      }
      setShowModal(false); setForm(EMPTY_FORM)
      setActivityExistingFiles([]); setActivityNewFiles([])
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setSaving(false) }
  }

  async function handleDeleteActivity() {
    if (!deleteConfirm) return
    // Una actividad que cuenta no sale de un parcial cerrado definitivamente.
    if (parcialCerrado(subject, deleteConfirm.parcial) && cuentaParaCalificacion(deleteConfirm)) {
      toast(mensajeParcialCerrado(deleteConfirm.parcial), 'error')
      setDeleteConfirm(null)
      return
    }
    setDeleting(true)
    try {
      // Remove this activity's submissions first so none are orphaned.
      await deleteSubmissionsByActivity(deleteConfirm.id)
      await deleteDoc(doc(db, 'activities', deleteConfirm.id))
      // Re-index `orden` for the remaining activities of the SAME parcial so the
      // sort key stays contiguous (1, 2, 3…) — the displayed "Actividad" label
      // is derived from this position wherever it's shown, never stored.
      const remaining = activities
        .filter((a) => a.id !== deleteConfirm.id && a.parcial === deleteConfirm.parcial)
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      const batch = writeBatch(db)
      const renumbered = remaining.map((a, i) => {
        const orden = i + 1
        batch.update(doc(db, 'activities', a.id), { orden })
        return { ...a, orden }
      })
      await batch.commit()
      setActivities((prev) => {
        const others = prev.filter((a) => a.id !== deleteConfirm.id && a.parcial !== deleteConfirm.parcial)
        return [...others, ...renumbered]
      })
      toast('Actividad eliminada'); setDeleteConfirm(null)
      // Si se borró desde dentro de su propio editor (borrador), ciérralo —
      // seguir mostrando el formulario de algo que ya no existe permitiría
      // intentar "Guardar cambios" sobre un doc borrado.
      if (entregableEditor?.activityId === deleteConfirm.id) setEntregableEditor(null)
      if (evalEditor?.activityId === deleteConfirm.id) setEvalEditor(null)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setDeleting(false) }
  }

  // ── Material de apoyo actions ───────────────────────────────────────
  // Independent entity from Activity: no maxCalif, no tiposArchivo, no
  // fechaLimite, no submissions — only a name, an optional rich-text
  // description and one or more downloadable files. Reuses the same
  // visibilidadMode/oculta/publishAt shape (and VisibilitySelect component)
  // as activities so the "show now / hide / schedule" behavior is identical.
  function openAddMaterial(parcial) {
    if (!canCreate) {
      toast('Necesitas Créditos IA para crear nuevo material de apoyo — toda tu información sigue disponible')
      return
    }
    setMaterialModalMode('create'); setMaterialParcial(parcial); setEditMaterialId(null)
    setMaterialForm(EMPTY_MATERIAL_FORM)
    setMaterialNewFiles([]); setMaterialExistingFiles([])
    setShowMaterialModal(true)
  }

  function openEditMaterial(material) {
    setMaterialModalMode('edit'); setMaterialParcial(material.parcial); setEditMaterialId(material.id)
    setMaterialForm({
      nombre: material.nombre || '',
      descripcion: material.descripcion || '',
      oculta: material.oculta || false,
      publishAt: material.publishAt || '',
      visibilidadMode: !material.oculta ? 'show' : material.publishAt ? 'schedule' : 'hide',
    })
    setMaterialNewFiles([])
    setMaterialExistingFiles(material.archivos || [])
    setShowMaterialModal(true)
  }

  // "Guardar cambios" de Editar material se apaga sin cambios. Solo aplica en
  // modo edit — crear siempre debe poder enviarse (no hay original con qué
  // comparar). visibilidadMode se compara aparte de oculta/publishAt: pasar
  // de "Oculto" a "Programado" sin elegir fecha todavía deja oculta=true y
  // publishAt='' en AMBOS casos — sin este campo aparte, ese cambio de modo
  // pasaría desapercibido.
  const editingMaterial = materialModalMode === 'edit' ? materials.find((m) => m.id === editMaterialId) : null
  const materialChanged = materialModalMode === 'create' || (
    materialForm.nombre.trim() !== (editingMaterial?.nombre || '') ||
    materialForm.descripcion !== (editingMaterial?.descripcion || '') ||
    materialForm.visibilidadMode !== (!editingMaterial?.oculta ? 'show' : editingMaterial?.publishAt ? 'schedule' : 'hide') ||
    materialForm.publishAt !== (editingMaterial?.publishAt || '') ||
    materialNewFiles.length > 0 ||
    JSON.stringify(materialExistingFiles) !== JSON.stringify(editingMaterial?.archivos || [])
  )

  function addMaterialFiles(files) {
    const tooBig = files.find((f) => f.size > MAX_ATTACHMENT_FILE_SIZE)
    if (tooBig) { toast(`"${tooBig.name}" supera el máximo de 15 MB`, 'error'); return }
    setMaterialNewFiles((prev) => [...prev, ...files])
  }

  async function handleSaveMaterial(e) {
    e.preventDefault()
    if (materialModalMode === 'create' && !canCreate) {
      toast('Necesitas Créditos IA para crear nuevo material de apoyo — toda tu información sigue disponible')
      return
    }
    if (!materialForm.nombre.trim()) { toast('Escribe un nombre para el material', 'error'); return }
    if (materialExistingFiles.length === 0 && materialNewFiles.length === 0) {
      toast('Agrega al menos un archivo', 'error'); return
    }
    // Misma regla que las actividades (handleSaveActivity más arriba): sin
    // esto, "Programar publicación" sin elegir fecha se guardaba con
    // oculta=true y publishAt=null — un material oculto para siempre sin
    // ningún aviso.
    if (materialForm.visibilidadMode === 'schedule') {
      if (!materialForm.publishAt) { toast('Elige la fecha y hora de publicación', 'error'); return }
      const now = new Date()
      const nowIso = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
      if (materialForm.publishAt <= nowIso) {
        toast('La fecha de publicación programada debe ser posterior a este momento', 'error'); return
      }
    }
    setSavingMaterial(true)
    try {
      const uploaded = await Promise.all(
        materialNewFiles.map(async (file) => ({
          url: await uploadToCloudinary(file, 'evalua-facil/materiales'),
          nombre: file.name,
          tamano: file.size,
        }))
      )
      const archivos = [...materialExistingFiles, ...uploaded]
      const payload = {
        nombre: materialForm.nombre.trim(),
        descripcion: sanitizeHtml(materialForm.descripcion),
        archivos,
        oculta: materialForm.oculta || !!materialForm.publishAt,
        publishAt: materialForm.publishAt || null,
      }
      if (materialModalMode === 'create') {
        const orden = materials.filter((m) => m.parcial === materialParcial).length + 1
        // ordenManual:false marks this material as "unpositioned" — it will appear
        // at the end of the parcial list until the teacher drags it into place.
        const ref = await addDoc(collection(db, 'materials'), {
          ...payload, parcial: materialParcial, orden, ordenManual: false,
          asignaturaId: subjectId, docenteId: currentUser.uid, createdAt: serverTimestamp(),
        })
        setMaterials((prev) => [...prev, { id: ref.id, ...payload, parcial: materialParcial, orden, ordenManual: false, asignaturaId: subjectId, docenteId: currentUser.uid }])
        toast('Material agregado')
      } else {
        await updateDoc(doc(db, 'materials', editMaterialId), payload)
        setMaterials((prev) => prev.map((m) => m.id === editMaterialId ? { ...m, ...payload } : m))
        toast('Material actualizado')
      }
      setShowMaterialModal(false); setMaterialForm(EMPTY_MATERIAL_FORM)
      setMaterialNewFiles([]); setMaterialExistingFiles([])
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setSavingMaterial(false) }
  }

  async function handleDeleteMaterial() {
    if (!deleteMaterialConfirm) return; setDeletingMaterial(true)
    try {
      await deleteDoc(doc(db, 'materials', deleteMaterialConfirm.id))
      setMaterials((prev) => prev.filter((m) => m.id !== deleteMaterialConfirm.id))
      toast('Material eliminado'); setDeleteMaterialConfirm(null)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setDeletingMaterial(false) }
  }

  // Repositions a material within its parcial by dropping at a visual zone index.
  // ALL materials in the parcial are reindexed to clean fractional values after
  // each drop — no midpoint-averaging, no precision accumulation.
  async function handleMaterialDrop(materialId, parcial, vizIdx) {
    const parcialActs = activities
      .filter((a) => a.parcial === parcial)
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    const parcialMats = materials.filter((m) => m.parcial === parcial)
    const draggedMat = parcialMats.find((m) => m.id === materialId)
    if (!draggedMat) return

    // Build the unified list without the dragged material, then insert at the
    // target index (converting from visual drop-zone index to unifiedWithout index).
    const unifiedWithout = buildUnifiedParcial(parcialActs, parcialMats.filter((m) => m.id !== materialId))
    const origIdx = buildUnifiedParcial(parcialActs, parcialMats)
      .findIndex((i) => i.type === 'material' && i.item.id === materialId)
    // Visual zone idx → insert index in unifiedWithout (compensate for removed item)
    const targetIdx = vizIdx <= origIdx ? vizIdx : vizIdx - 1

    const newUnified = [
      ...unifiedWithout.slice(0, targetIdx),
      { type: 'material', item: draggedMat },
      ...unifiedWithout.slice(targetIdx),
    ]

    const ordenByMatId = computeMaterialOrdenes(newUnified)

    const batch = writeBatch(db)
    parcialMats.forEach((m) => {
      batch.update(doc(db, 'materials', m.id), { orden: ordenByMatId.get(m.id), ordenManual: true })
    })
    try {
      await batch.commit()
      setMaterials((prev) => prev.map((m) =>
        m.parcial === parcial
          ? { ...m, orden: ordenByMatId.get(m.id), ordenManual: true }
          : m
      ))
    } catch (err) { toast('Error al guardar posición: ' + err.message, 'error') }
  }

  // Arrastrar un BORRADOR a cualquier punto de la lista de su parcial (mismas
  // zonas de soltar que los materiales). Solo se mueve el borrador: el orden
  // relativo de las demás actividades y de los materiales queda igual. Como las
  // actividades viven en `orden` enteros y los materiales en fraccionarios
  // ENTRE ellas, se recalculan a partir de la lista visual final: actividades
  // 1..n en el orden en que aparecen y materiales con computeMaterialOrdenes.
  // Solo se escribe lo que cambia, en un solo batch. La numeración (1.1., 1.2.…)
  // no se toca: se sigue derivando de la posición, y un borrador no lleva número.
  async function handleDraftDrop(activityId, parcial, vizIdx) {
    const parcialActs = activities
      .filter((a) => a.parcial === parcial)
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    const parcialMats = materials.filter((m) => m.parcial === parcial)
    const draft = parcialActs.find((a) => a.id === activityId)
    if (!draft || !isDraftActivity(draft)) return

    const unified = buildUnifiedParcial(parcialActs, parcialMats)
    const origIdx = unified.findIndex((i) => i.type === 'activity' && i.item.id === activityId)
    const targetIdx = vizIdx <= origIdx ? vizIdx : vizIdx - 1
    if (origIdx < 0 || targetIdx === origIdx) return // soltado en su mismo lugar

    const unifiedWithout = unified.filter((_, i) => i !== origIdx)
    const newUnified = [
      ...unifiedWithout.slice(0, targetIdx),
      unified[origIdx],
      ...unifiedWithout.slice(targetIdx),
    ]

    let n = 0
    const ordenByActId = new Map()
    const renumberedUnified = newUnified.map((it) => {
      if (it.type !== 'activity') return it
      n += 1
      ordenByActId.set(it.item.id, n)
      return { ...it, item: { ...it.item, orden: n } }
    })
    const ordenByMatId = computeMaterialOrdenes(renumberedUnified)

    const actsChanged = parcialActs.filter((a) => a.orden !== ordenByActId.get(a.id))
    const matsChanged = parcialMats.filter((m) => m.orden !== ordenByMatId.get(m.id) || m.ordenManual !== true)
    if (actsChanged.length === 0 && matsChanged.length === 0) return

    const prevActivities = activities
    const prevMaterials = materials
    // Optimista (como applyMoveActivities): se pinta de inmediato y se revierte si falla.
    const newParcialActs = renumberedUnified.filter((it) => it.type === 'activity').map((it) => it.item)
    setActivities((prev) => [...prev.filter((a) => a.parcial !== parcial), ...newParcialActs])
    setMaterials((prev) => prev.map((m) =>
      m.parcial === parcial ? { ...m, orden: ordenByMatId.get(m.id), ordenManual: true } : m
    ))
    try {
      const batch = writeBatch(db)
      actsChanged.forEach((a) => batch.update(doc(db, 'activities', a.id), { orden: ordenByActId.get(a.id) }))
      matsChanged.forEach((m) => batch.update(doc(db, 'materials', m.id), { orden: ordenByMatId.get(m.id), ordenManual: true }))
      await batch.commit()
    } catch (err) {
      setActivities(prevActivities)
      setMaterials(prevMaterials)
      toast('Error al guardar posición: ' + err.message, 'error')
    }
  }

  // Same visibility toggle activities already have ("Activar para alumnos" /
  // "Ocultar para alumnos" without opening the full edit form).
  async function hideMaterial(m) {
    const payload = { oculta: true, publishAt: null }
    await updateDoc(doc(db, 'materials', m.id), payload)
    setMaterials((prev) => prev.map((x) => x.id === m.id ? { ...x, ...payload } : x))
  }
  async function showMaterialNow(m) {
    const payload = { oculta: false, publishAt: null }
    await updateDoc(doc(db, 'materials', m.id), payload)
    setMaterials((prev) => prev.map((x) => x.id === m.id ? { ...x, ...payload } : x))
  }

  function handleToggleArchive() {
    if (!subject) return
    if (subject.archived) {
      // Unarchiving → open restore modal (edit data + palette + options)
      setUnarchiveStudents('keep')
      setUnarchiveActivities('keep')
      setUnarchiveEdits({
        nombre: subject.nombre || '',
        grupo: subject.grupo || '',
        fechaInicio: subject.fechaInicio || '',
        fechaFin: subject.fechaFin || '',
        parcialesFechas: subject.parcialesFechas || [],
        parciales: String(subject.parciales || 3),
        colorPalette: subject.colorPalette || 'default',
        icon: subject.icon || 'book',
      })
      setShowUnarchiveModal(true)
    } else {
      // Archivar ya no borra nada, así que el respaldo ZIP viene apagado:
      // es una comodidad, no un rescate.
      setArchiveConZip(false)
      setShowArchiveModal(true)
    }
  }

  // Archiva la asignatura SIN borrar nada.
  //
  // Antes, archivar borraba las entregas de todos los estudiantes (por espacio)
  // y solo dejaba el esqueleto. Se quitó: borraba el trabajo del alumno —lo
  // único de aquí que de verdad es suyo— y ni siquiera ahorraba el espacio que
  // pretendía, porque los archivos seguían en Cloudinary con su URL viva; solo
  // se destruía el documento que apuntaba a ellos. Lo peor de los dos mundos.
  //
  // Ahora archivar es un cambio de estado y nada más: la asignatura sale de las
  // activas del docente y se va a "Asignaturas archivadas" del estudiante, con
  // todo completo. El ZIP sigue disponible como respaldo opcional.
  async function handleArchiveConfirm() {
    setArchiving(true)
    try {
      if (archiveConZip) {
        setZipDownloading(true)
        setZipProgress({ done: 0, total: 0 })
        try {
          const students = await ensureGroupStudents()
          const rawDocs = await fetchSubmissionsForActivities(activities.map((a) => a.id))
          const submissions = rawDocs.map((d) => ({ id: d.id, ...d.data() }))
          const jobs = buildJobsForSubject({ subject, activities, submissions, students })
          if (jobs.length > 0) {
            await downloadSubmissionsZip({
              zipName: subjectDisplayName(subject),
              jobs,
              onProgress: (done, total) => setZipProgress({ done, total }),
            })
          }
        } finally {
          setZipDownloading(false)
          setZipProgress({ done: 0, total: 0 })
        }
      }
      await updateDoc(doc(db, 'subjects', subjectId), { archived: true })
      setSubject((s) => ({ ...s, archived: true }))
      setShowArchiveModal(false)
      toast(archiveConZip ? 'Asignatura archivada (respaldo descargado)' : 'Asignatura archivada')
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setArchiving(false) }
  }

  async function handleUnarchiveConfirm() {
    const newParciales = parseInt(unarchiveEdits.parciales) || 3
    // "Empezar de cero" libera los parciales cerrados antes (deleteSubjectStudents).
    const cerradoFuera = unarchiveStudents === 'reset' ? null
      : [1, 2, 3, 4, 5, 6].find((p) => p > newParciales && parcialCerrado(subject, p))
    if (cerradoFuera) { toast(mensajeParcialCerrado(cerradoFuera), 'error'); return }
    if (activities.some((a) => a.parcial > newParciales)) {
      toast(`Hay actividades en parciales superiores a ${newParciales}. Elimínalas primero.`, 'error')
      return
    }
    setUnarchivedSaving(true)
    try {
      if (unarchiveStudents === 'reset') {
        await deleteSubjectStudents(subjectId)
        setGroupStudents([])
        setGroupStudentsLoaded(false)
        setGradesLoaded(false)
        setGradeSubMap({})
      }
      const updates = {
        archived: false,
        nombre: unarchiveEdits.nombre.trim() || subject.nombre,
        grupo: unarchiveEdits.grupo.trim(),
        fechaInicio: unarchiveEdits.fechaInicio || '',
        fechaFin: unarchiveEdits.fechaFin || '',
        parcialesFechas: (unarchiveEdits.fechaInicio && unarchiveEdits.fechaFin)
          ? normalizeParcialesFechas(unarchiveEdits.fechaInicio, unarchiveEdits.fechaFin, newParciales, unarchiveEdits.parcialesFechas)
          : [],
        parciales: newParciales,
        colorPalette: unarchiveEdits.colorPalette || 'default',
        icon: unarchiveEdits.icon || 'book',
      }
      if (unarchiveActivities !== 'keep') {
        const batch = writeBatch(db)
        activities.forEach((a) => batch.update(doc(db, 'activities', a.id), {
          oculta: unarchiveActivities === 'hide',
          publishAt: null,
        }))
        await batch.commit()
        setActivities((prev) => prev.map((a) => ({ ...a, oculta: unarchiveActivities === 'hide', publishAt: null })))
      }
      await updateDoc(doc(db, 'subjects', subjectId), updates)
      setSubject((s) => ({ ...s, ...updates }))
      toast('Asignatura restaurada')
      setShowUnarchiveModal(false)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setUnarchivedSaving(false) }
  }

  // ── Activity visibility ────────────────────────────────────────────
  async function hideActivity(a) {
    try {
      await updateDoc(doc(db, 'activities', a.id), { oculta: true, publishAt: null })
      setActivities((prev) => prev.map((act) => act.id === a.id ? { ...act, oculta: true, publishAt: null } : act))
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // ── Parcial visibility (hides every activity in it from students at once) ──
  async function toggleParcialVisibility(p) {
    const hidden = subject?.parcialesOcultos || []
    const next = hidden.includes(p) ? hidden.filter((x) => x !== p) : [...hidden, p]
    try {
      await updateDoc(doc(db, 'subjects', subjectId), { parcialesOcultos: next })
      setSubject((s) => ({ ...s, parcialesOcultos: next }))
      toast(next.includes(p) ? `Parcial ${p} oculto para estudiantes` : `Parcial ${p} visible para estudiantes`)
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // Eye toggle: show a hidden (already published) activity immediately —
  // no modal, mirror of hideActivity.
  async function showActivityNow(act) {
    try {
      await updateDoc(doc(db, 'activities', act.id), { oculta: false, publishAt: null })
      setActivities((prev) => prev.map((a) => a.id === act.id ? { ...a, oculta: false, publishAt: null } : a))
      // If the whole parcial is hidden, publishing the activity isn't enough —
      // students still won't see it until the parcial is shown.
      const parcialOculto = (subject?.parcialesOcultos || []).includes(act.parcial)
      toast(parcialOculto
        ? `Actividad publicada, pero el Parcial ${act.parcial} está oculto a estudiantes — muéstralo para que la vean`
        : 'Actividad visible para estudiantes')
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // Duplicate an activity as a DRAFT copy: same instructions, file types,
  // attachments, rubric, grading weight and evaluación config/preguntas — but
  // hidden, unpublished, unnumbered and without deadline, ready to rename and
  // publish later.
  async function handleDuplicateActivity() {
    if (!duplicateConfirm) return
    setDuplicating(true)
    try {
      const src = duplicateConfirm
      if (parcialCerrado(subject, src.parcial)) {
        toast(mensajeParcialCerrado(src.parcial), 'error')
        setDuplicateConfirm(null)
        return
      }
      // Un juego sin confirmar no se duplica (ver esCopiable): sin la reserva
      // de créditos del original —que nunca se copia— la copia quedaría
      // imposible de confirmar y de publicar. El menú ⋮ ya no lo ofrece.
      if (!esCopiable(src)) {
        toast('Termina y confirma este juego antes de duplicarlo', 'error')
        setDuplicateConfirm(null)
        return
      }
      const orden = activities.filter((a) => a.parcial === src.parcial).length + 1
      const copy = {
        nombre: `${nombreParaCopia(src)} (copia)`,
        // Qué campos viajan (incluidos `tipoJuego` y `juego`): compartido con
        // los otros dos caminos de copia en utils/copiaActividad.js.
        ...camposComunesCopia(src),
        // Un entregable duplicado conserva el vacío que ya tenía aquí (`[]`,
        // no el 'imagenes' que usan los otros dos caminos) — duplicar dentro
        // de la misma asignatura no es momento de cambiarle los tipos de
        // archivo aceptados a una actividad vieja sin el campo.
        ...(src.categoria === 'juego' ? {} : { tiposArchivo: src.tiposArchivo || [] }),
        oculta: true, publishAt: null, publishedAt: null,
        parcial: src.parcial, orden,
        asignaturaId: subjectId, docenteId: currentUser.uid, createdAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'activities'), copy)
      // A25 — Las respuestas del juego viven en la subcolección `clave` y no
      // viajan con los campos: sin esto, la copia de un juego migrado nacería
      // imposible de calificar (ver utils/juegoClave.js).
      if (esJuego(src)) await copiarClaveJuego(src.id, ref.id)
      // Evaluaciones: also clone the question bank of this activity
      if (src.tipo === 'evaluacion') {
        const snap = await getDocs(collection(db, 'activities', src.id, 'preguntas'))
        await Promise.all(snap.docs.map((d) => addDoc(collection(db, 'activities', ref.id, 'preguntas'), d.data())))
      }
      setActivities((prev) => [...prev, { id: ref.id, ...copy, createdAt: null }])
      setSubmissionCounts((prev) => ({ ...prev, [ref.id]: { delivered: 0, graded: 0 } }))
      toast('Copia creada como borrador — edítala para cambiarle el nombre')
      setDuplicateConfirm(null)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setDuplicating(false) }
  }

  // ── Cambiar de lugar una actividad dentro de su parcial ─────────────
  // El número visible (1.2., 1.3.…) SIEMPRE se deriva de la posición, nunca se
  // guarda — así que mover una actividad renumera también a las que quedan en
  // medio. Los estudiantes ya vieron esos números en lo que está publicado, por
  // eso el docente confirma primero, viendo exactamente qué números cambian.
  // Solo en la web: el ⋮ de la actividad no existe en la app nativa.
  function activityLabelsFor(list, parcial) {
    const map = {}
    list.filter((x) => cuentaParaCalificacion(x)).forEach((x, i) => { map[x.id] = `${parcial}.${i + 1}.` })
    return map
  }

  function requestMoveActivity(a, direction) {
    const list = activities
      .filter((x) => x.parcial === a.parcial)
      .sort((x, y) => (x.orden ?? 0) - (y.orden ?? 0))
    const from = list.findIndex((x) => x.id === a.id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= list.length) return
    const newList = [...list]
    ;[newList[from], newList[to]] = [newList[to], newList[from]]
    const before = activityLabelsFor(list, a.parcial)
    const after = activityLabelsFor(newList, a.parcial)
    const changes = newList
      .filter((x) => before[x.id] !== after[x.id])
      .map((x) => ({ id: x.id, nombre: x.nombre, de: before[x.id], hacia: after[x.id], publicada: !!x.publishedAt }))
    // Intercambiar con un borrador (que todavía no lleva número) no renumera
    // nada y no hay nada que avisarle al grupo: se mueve directo.
    if (changes.length === 0) { applyMoveActivities(a.parcial, newList); return }
    setMoveConfirm({ a, newList, changes })
  }

  async function applyMoveActivities(parcial, newList) {
    const prevActivities = activities
    const renumbered = newList.map((x, i) => ({ ...x, orden: i + 1 }))
    // Optimista: el orden nuevo se pinta de inmediato y se revierte si falla el commit.
    setActivities((prev) => [...prev.filter((x) => x.parcial !== parcial), ...renumbered])
    setMoving(true)
    try {
      const batch = writeBatch(db)
      renumbered.forEach((x) => batch.update(doc(db, 'activities', x.id), { orden: x.orden }))
      await batch.commit()
      setMoveConfirm(null)
      toast('Actividad movida')
    } catch (err) {
      setActivities(prevActivities)
      toast('No se pudo mover: ' + err.message, 'error')
    } finally { setMoving(false) }
  }

  // First publication of a draft (no publishedAt yet): the eye asks for
  // confirmation and stamps the publication datetime.
  async function publishDraftNow() {
    if (!publishDraftConfirm) return
    // Publicar un borrador lo haría contar en la calificación del parcial.
    if (parcialCerrado(subject, publishDraftConfirm.parcial)) {
      toast(mensajeParcialCerrado(publishDraftConfirm.parcial), 'error')
      setPublishDraftConfirm(null)
      return
    }
    const d = new Date()
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    try {
      await updateDoc(doc(db, 'activities', publishDraftConfirm.id), { oculta: false, publishAt: null, publishedAt: iso })
      setActivities((prev) => prev.map((a) => a.id === publishDraftConfirm.id ? { ...a, oculta: false, publishAt: null, publishedAt: iso } : a))
      toast('Actividad publicada para estudiantes')
      setPublishDraftConfirm(null)
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // ── Subject CRUD ───────────────────────────────────────────────────
  // "Guardar cambios" de Editar asignatura se apaga sin cambios — compara
  // contra `subject` en vivo, que es exactamente de donde openEditSubject()
  // rellena el formulario cada vez que se abre, así que no hace falta guardar
  // una copia aparte. parciales es string en el form y number en el doc;
  // parcialesFechas es un arreglo de objetos, se compara por JSON.
  const editSubjectChanged =
    editSubjectForm.nombre.trim() !== (subject?.nombre || '') ||
    editSubjectForm.grupo.trim() !== (subject?.grupo || '') ||
    editSubjectForm.fechaInicio !== (subject?.fechaInicio || '') ||
    editSubjectForm.fechaFin !== (subject?.fechaFin || '') ||
    editSubjectForm.parciales !== String(subject?.parciales || 3) ||
    editSubjectForm.colorPalette !== (subject?.colorPalette || 'default') ||
    editSubjectForm.icon !== (subject?.icon || 'book') ||
    JSON.stringify(editSubjectForm.parcialesFechas || []) !== JSON.stringify(subject?.parcialesFechas || [])

  function openEditSubject() {
    setEditSubjectForm({
      nombre: subject?.nombre || '',
      grupo: subject?.grupo || '',
      fechaInicio: subject?.fechaInicio || '',
      fechaFin: subject?.fechaFin || '',
      parcialesFechas: subject?.parcialesFechas || [],
      parciales: String(subject?.parciales || 3),
      colorPalette: subject?.colorPalette || 'default',
      icon: subject?.icon || 'book',
    })
    setShowEditSubjectModal(true)
  }

  async function handleEditSubject(e) {
    e.preventDefault()
    const newParciales = parseInt(editSubjectForm.parciales) || 3
    const cerradoFuera = [1, 2, 3, 4, 5, 6].find((p) => p > newParciales && parcialCerrado(subject, p))
    if (cerradoFuera) { toast(mensajeParcialCerrado(cerradoFuera), 'error'); return }
    const hasActsAbove = activities.some((a) => a.parcial > newParciales)
    if (hasActsAbove) {
      toast(`Hay actividades en parciales superiores a ${newParciales}. Elimínalas primero.`, 'error')
      return
    }
    setEditingSubject(true)
    try {
      const subjUpdates = {
        nombre: editSubjectForm.nombre.trim(),
        grupo: editSubjectForm.grupo.trim(),
        fechaInicio: editSubjectForm.fechaInicio || '',
        fechaFin: editSubjectForm.fechaFin || '',
        parcialesFechas: (editSubjectForm.fechaInicio && editSubjectForm.fechaFin)
          ? normalizeParcialesFechas(editSubjectForm.fechaInicio, editSubjectForm.fechaFin, newParciales, editSubjectForm.parcialesFechas)
          : [],
        parciales: newParciales,
        colorPalette: editSubjectForm.colorPalette || 'default',
        icon: editSubjectForm.icon || 'book',
      }
      await updateDoc(doc(db, 'subjects', subjectId), subjUpdates)
      setSubject((s) => ({ ...s, ...subjUpdates }))
      const fechasCambiaron = subjUpdates.fechaInicio !== (subject?.fechaInicio || '')
        || subjUpdates.fechaFin !== (subject?.fechaFin || '')
      if (fechasCambiaron && subjUpdates.fechaInicio && subjUpdates.fechaFin) {
        await sincronizarBloquesConFechas(subjUpdates.fechaInicio, subjUpdates.fechaFin)
      }
      toast('Asignatura actualizada')
      setShowEditSubjectModal(false)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setEditingSubject(false) }
  }

  // Las fechas del curso (Editar asignatura) son ahora la única fuente de
  // verdad: si se alargan, esto extiende el patrón semanal ya programado para
  // cubrir el tramo nuevo — así los bloques (y con ellos la asistencia
  // automática, que sale de los bloques) nunca se quedan atrás de la fecha que
  // el docente acaba de poner. No borra ni toca bloques existentes; solo
  // rellena huecos, igual que "Faltan clases" en el calendario, pero sin que
  // el docente tenga que ir a buscarlo.
  async function sincronizarBloquesConFechas(fechaInicio, fechaFin) {
    // Una asignatura archivada está fuera del horario vigente: cambiarle las
    // fechas no debe materializarle clases nuevas.
    if (subject?.archived) return
    try {
      const bloquesSnap = await getDocs(query(
        collection(db, 'horarioBloques'),
        where('docenteId', '==', currentUser.uid),
        where('asignaturaId', '==', subjectId),
      ))
      const bloquesAsignatura = bloquesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      // Días de clase reales de ESTA asignatura (patrón guardado o, en cursos
      // viejos, el derivado de sus bloques). Nunca se supone lunes a viernes.
      const patronesGuardados = subject?.horarioPatron
      const patrones = patronesGuardados?.length ? patronesGuardados : derivarPatrones(bloquesAsignatura)
      if (patrones.length === 0) return

      const [asuetosSnap, vacacionesSnap] = await Promise.all([
        getDocs(query(collection(db, 'asuetos'), where('docenteId', '==', currentUser.uid))),
        getDocs(query(collection(db, 'vacaciones'), where('docenteId', '==', currentUser.uid))),
      ])
      const diasAsueto = [
        ...asuetosSnap.docs.map(d => d.data()).filter(a => a.clases).map(a => a.fecha),
        ...fechasVacacionParaClases(vacacionesSnap.docs.map(d => d.data())),
      ]
      // El tramo se mide contra esos días: si al alargar el curso no cae
      // ninguna clase de la asignatura, no hay nada que extender.
      const tramos = tramosFaltantes(bloquesAsignatura, fechaInicio, fechaFin, { patrones, diasAsueto })
      if (tramos.length === 0) return
      const nuevos = tramos.flatMap(t => generarBloques({
        fechaInicio: t.desde,
        fechaFin: t.hasta,
        diasAsueto,
        duracionMin: patrones[0].duracionMin || 60,
        patrones,
        color: patrones[0].color,
        alarma: patrones[0].alarma,
      }))
      if (nuevos.length === 0) return

      const meta = {
        docenteId: currentUser.uid,
        programacionId: crypto.randomUUID(),
        asignaturaId: subjectId,
        createdAt: serverTimestamp(),
      }
      for (let i = 0; i < nuevos.length; i += 450) {
        const batch = writeBatch(db)
        nuevos.slice(i, i + 450).forEach(b => batch.set(doc(collection(db, 'horarioBloques')), { ...b, ...meta }))
        await batch.commit()
      }
      toast(`Se extendieron ${nuevos.length} bloque(s) de clase para cubrir las nuevas fechas`)
    } catch (err) {
      toast('La asignatura se guardó, pero no se pudieron extender los bloques de clase: ' + err.message, 'warning')
    }
  }

  async function handleDeleteSubject() {
    if (deleteSubjectConfirmText !== subject?.nombre) {
      toast('El nombre no coincide', 'error'); return
    }
    setDeletingSubject(true)
    try {
      await deleteSubjectCascade(subjectId, subject?.docenteId)
      toast('Asignatura eliminada')
      navigate('/dashboard')
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setDeletingSubject(false) }
  }

  function openCopyModal() {
    if (!canCreate) {
      toast('Necesitas Créditos IA para crear nuevas asignaturas — toda tu información sigue disponible')
      return
    }
    setCopyForm({ nombre: subject?.nombre || '', grupo: subject?.grupo || '', keepStudents: false, colorPalette: subject?.colorPalette || 'default', icon: subject?.icon || 'book' })
    setCopyFechas({ fechaInicio: subject?.fechaInicio || '', fechaFin: subject?.fechaFin || '' })
    setShowCopyModal(true)
  }

  async function handleCopySubject(e) {
    e.preventDefault()
    setCopyingSubject(true)
    try {
      const newId = await copySubject({
        sourceSubjectId: subjectId,
        nombre: copyForm.nombre.trim(),
        grupo: copyForm.grupo.trim(),
        fechaInicio: copyFechas.fechaInicio || '',
        fechaFin: copyFechas.fechaFin || '',
        parciales: subject?.parciales || 3,
        colorPalette: copyForm.colorPalette || 'default',
        icon: copyForm.icon || 'book',
        keepStudents: copyForm.keepStudents,
        docenteId: currentUser.uid,
        escuelaId: userProfile.escuelaId,
      })
      toast('Asignatura duplicada')
      setShowCopyModal(false)
      navigate(`/subject/${newId}`)
    } catch (err) { toast('Error al duplicar: ' + err.message, 'error') }
    finally { setCopyingSubject(false) }
  }

  // PONDERACIÓN gate: while capturing, partial sums are fine — but grades
  // can only be GENERATED when every weighted parcial adds up to exactly 10.
  // Only parciales where the teacher already assigned some weight are
  // validated; untouched parciales fall back to simple average.
  function ponderacionIncompleta() {
    const PARC = Array.from({ length: subject?.parciales || 3 }, (_, i) => i + 1)
    for (const p of PARC) {
      if (!ponderacionActivaEnParcial(subject, p)) continue
      const acts = activities.filter((a) => a.parcial === p && cuentaParaCalificacion(a))
      if (!acts.length || !acts.some((a) => pesoDe(a) > 0)) continue
      const total = parseFloat(acts.reduce((t, a) => t + pesoDe(a), 0).toFixed(2))
      if (total !== 10) return { p, total }
    }
    return null
  }

  async function handleExport() {
    if (descargaSoloWeb(toast)) return
    if (!subject) return
    const falta = ponderacionIncompleta()
    if (falta) {
      toast(`La ponderación del Parcial ${falta.p} suma ${falta.total} de 10 — complétala antes de generar las calificaciones`, 'warning')
      return
    }
    setExporting(true)
    try {
      let students = groupStudents
      let subMap = gradeSubMap
      if (!groupStudentsLoaded) {
        const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
        students = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        setGroupStudents(students); setGroupStudentsLoaded(true)
      }
      if (!gradesLoaded) {
        const subDocs = await fetchSubmissionsForActivities(activities.map((a) => a.id))
        subMap = {}
        subDocs.forEach((d) => { const data = { id: d.id, ...d.data() }; subMap[`${data.alumnoId}-${data.actividadId}`] = data })
        setGradeSubMap(subMap); setGradesLoaded(true)
      }
      await exportSubjectGrades({
        subject, activities, students,
        submissions: Object.values(subMap),
        membrete,
      })
    } catch (err) { toast('Error al exportar: ' + err.message, 'error') }
    finally { setExporting(false) }
  }

  // ── CERRAR PARCIAL ──
  // To close, EVERYTHING must be graded. The dialog then adapts:
  //  · ponderación that doesn't sum 10 blocks closing (shown in the dialog; a
  //    tooltip on the "Cerrar" menu item previews it — no fleeting toast)
  //  · delivered-but-ungraded submissions block closing (grade them manually first)
  //  · no-entregas (no submission) are set to 0 only if the teacher proceeds
  function requestCloseParcial(p) {
    const acts = activities.filter((a) => a.parcial === p && cuentaParaCalificacion(a))
    let pondError = null
    if (ponderacionActivaEnParcial(subject, p)) {
      const total = pesoTotalVivo(acts)
      if (Math.abs(total - 10) > 0.001) pondError = { total }
    }
    const missing = []
    let ungraded = 0
    groupStudents.forEach((s) => {
      acts.forEach((a) => {
        const sub = gradeSubMap[`${s.id}-${a.id}`]
        if (!sub) missing.push({ s, a })
        else if (sub.calificacion == null) ungraded++
      })
    })
    // A09 · Tope de la calificación del cierre. Es el único camino que escribía
    // notas SIN límite por arriba —y en bloque, a todo el que no entregó—,
    // mientras que calificar una por una, el arreglo rápido de la tabla y el
    // panel de la actividad topan todos contra `maxCalif`. Un 50 en escala de
    // 10 envenenaba el promedio del parcial, el final y lo exportado.
    // Se toma la escala MÁS BAJA del parcial para que el mismo número sirva
    // para todas; al escribir se vuelve a acotar contra la de cada actividad.
    const topeCalif = acts.length ? Math.min(...acts.map((a) => a.maxCalif ?? 10)) : 10
    playAlertSound()
    setCloseParcialGrade(String(Math.min(5, topeCalif)))
    const calculado = sesionesPorParcialCliente?.[String(p)]
    setCloseParcialSesiones(calculado != null ? String(calculado) : '')
    setCloseParcialConfirm({ p, missing, ungraded, pondError, topeCalif })
  }

  // Revert a close: delete the 0-grades created by the close (cierreParcial=true)
  // so those no-entregas go back to just "sin entrega". Manual grades are kept.
  async function revertCloseParcial() {
    if (revertParcialConfirm == null) return
    const p = revertParcialConfirm
    setRevertingParcial(true)
    try {
      // CERRADO → ATENCIÓN DE INQUIETUDES, nunca de vuelta a abierto: el
      // estudiante ya conoció el resultado. Una sola escritura, así que no hay
      // un instante en que el parcial quede "abierto" y se le oculte. La fecha
      // de publicación es la de la atención si la hubo; si se cerró directo,
      // la del cierre, que fue cuando se publicó.
      const publicadoEn = subject?.parcialesAtencion?.[p] || subject?.parcialesCerrados?.[p] || new Date().toISOString()
      await updateDoc(doc(db, 'subjects', subjectId), {
        [`parcialesCerrados.${p}`]: deleteField(),
        [`parcialesAtencion.${p}`]: publicadoEn,
      })
      setSubject((s) => {
        const nextClosed = { ...(s.parcialesCerrados || {}) }
        delete nextClosed[p]
        return { ...s, parcialesCerrados: nextClosed, parcialesAtencion: { ...(s.parcialesAtencion || {}), [p]: publicadoEn } }
      })
      // Ya en atención (mientras el parcial seguía cerrado las reglas no dejaban
      // borrar nada), las notas automáticas del cierre — y SOLO las que siguen
      // siendo automáticas (esNotaAutomaticaDeCierre). Un documento marcado
      // `cierreParcial` que ya trae trabajo real del estudiante (un intento
      // presentado sobre la nota automática) nunca se borra: se le quita la
      // marca y queda como la calificación real que es. Un lote por actividad
      // por el límite de lecturas de firestore.rules.
      const acts = activities.filter((a) => a.parcial === p && cuentaParaCalificacion(a))
      const snaps = await fetchSubmissionsForActivities(acts.map((a) => a.id))
      const porActividad = new Map()
      snaps.filter((d) => d.data().cierreParcial === true).forEach((d) => {
        const actId = d.data().actividadId
        if (!porActividad.has(actId)) porActividad.set(actId, [])
        porActividad.get(actId).push(d)
      })
      const removedKeys = []
      const conservadas = []
      for (const grupo of porActividad.values()) {
        for (let i = 0; i < grupo.length; i += 400) {
          const batch = writeBatch(db)
          grupo.slice(i, i + 400).forEach((d) => {
            const data = d.data()
            const key = `${data.alumnoId}-${data.actividadId}`
            if (esNotaAutomaticaDeCierre(data)) {
              batch.delete(doc(db, 'submissions', d.id))
              removedKeys.push(key)
            } else {
              batch.update(doc(db, 'submissions', d.id), { cierreParcial: deleteField(), sinEntrega: deleteField() })
              conservadas.push(key)
            }
          })
          await batch.commit()
        }
      }
      setGradeSubMap((prev) => {
        const next = { ...prev }
        removedKeys.forEach((k) => delete next[k])
        conservadas.forEach((k) => {
          if (!next[k]) return
          const real = { ...next[k] }
          delete real.cierreParcial
          delete real.sinEntrega
          next[k] = real
        })
        return next
      })
      toast(`Parcial ${p} reabierto para atención de inquietudes — ${removedKeys.length} no entrega${removedKeys.length !== 1 ? 's volvieron' : ' volvió'} a quedar sin calificar`)
      setRevertParcialConfirm(null)
    } catch (err) {
      toast('Error al reabrir el parcial: ' + err.message, 'error')
    } finally {
      setRevertingParcial(false)
    }
  }

  // ABIERTO → ATENCIÓN DE INQUIETUDES. Publica al estudiante el resultado del
  // parcial (y, si es ponderado, sus pesos); no toca ninguna calificación.
  // Solo con la ponderación guardada y sumando exactamente 10 — la misma regla
  // con la que el estudiante ve el resultado (utils/ponderacion.js).
  async function confirmIniciarAtencion() {
    const p = atencionParcialConfirm
    if (p == null) return
    if (Object.keys(pesoEdits).length > 0 || !puedeIniciarAtencion(subject, p, activities)) {
      toast(`La ponderación del Parcial ${p} debe estar guardada y sumar exactamente 10 para iniciar la atención de inquietudes`, 'warning')
      setAtencionParcialConfirm(null)
      return
    }
    setIniciandoAtencion(true)
    try {
      const inicio = new Date().toISOString()
      await updateDoc(doc(db, 'subjects', subjectId), { [`parcialesAtencion.${p}`]: inicio })
      setSubject((s) => ({ ...s, parcialesAtencion: { ...(s.parcialesAtencion || {}), [p]: inicio } }))
      toast(`Parcial ${p} en atención de inquietudes`)
      setAtencionParcialConfirm(null)
    } catch (err) {
      toast('Error al iniciar la atención de inquietudes: ' + err.message, 'error')
    } finally {
      setIniciandoAtencion(false)
    }
  }

  async function confirmCloseParcial() {
    if (!closeParcialConfirm) return
    const { p, topeCalif = 10 } = closeParcialConfirm
    // Grade to assign to every no-entrega (default 0 if the field is left
    // blank), acotada contra la escala del parcial — ver topeCalif arriba.
    const grade = Math.min(Math.max(0, parseFloat(closeParcialGrade) || 0), topeCalif)
    setClosingParcial(true)
    try {
      // La lista del aviso salió de la tabla tal como se cargó, que puede
      // tener horas: se vuelve a leer ANTES de escribir nada. Misma regla que
      // el aviso (una entrega o intento sin calificar impide cerrar), pero
      // contra lo que hay AHORA — antes, una entrega llegada después se
      // pisaba con la nota de cierre (submissionGuard.js).
      const acts = activities.filter((a) => a.parcial === p && cuentaParaCalificacion(a))
      const actIds = acts.map((a) => a.id)
      const frescas = await fetchSubmissionsForActivities(actIds)
      const actualPorClave = new Map(frescas.map((d) => [`${d.data().alumnoId}-${d.data().actividadId}`, d.data()]))
      const missing = []
      let sinCalificar = 0
      groupStudents.forEach((s) => {
        acts.forEach((a) => {
          const sub = actualPorClave.get(`${s.id}-${a.id}`)
          if (!sub) missing.push({ s, a })
          else if (sub.calificacion == null) sinCalificar++
        })
      })
      if (sinCalificar > 0) {
        await refrescarCalificacionesDe(actIds)
        toast(`No se cerró el Parcial ${p}: llegaron entregas o intentos nuevos y hay ${sinCalificar} sin calificar. Califícalos y vuelve a cerrarlo.`, 'error')
        setCloseParcialConfirm(null)
        return
      }
      // Un lote por actividad — mismo límite de lecturas de firestore.rules
      // que la reapertura y las altas tardías. Solo se escribe a quien SIGUE
      // sin documento al momento de escribir (transacción): quien entregue en
      // este instante conserva su entrega y el parcial no se cierra.
      const faltantesPorActividad = new Map()
      missing.forEach((m) => {
        if (!faltantesPorActividad.has(m.a.id)) faltantesPorActividad.set(m.a.id, [])
        faltantesPorActividad.get(m.a.id).push(m)
      })
      const omitidos = []
      for (const faltantes of faltantesPorActividad.values()) {
        const items = faltantes.map(({ s, a }) => {
          // Id determinista (A12 · H5 · R22).
          const ref = doc(db, 'submissions', submissionDocId(a.id, s.id))
          const data = {
            alumnoId: s.id,
            actividadId: a.id,
            // Segundo acotado, contra la escala de ESTA actividad: `grade` ya
            // viene topado por la más baja del parcial, pero si algún día
            // conviven escalas distintas cada nota respeta la suya.
            calificacion: Math.min(grade, a.maxCalif ?? 10),
            comentario: '',
            estado: 'calificado',
            sinEntrega: true,
            cierreParcial: true,
            fechaEntrega: serverTimestamp(),
          }
          return { ref, alumnoId: s.id, data }
        })
        const r = await sinEntregaEnLote(db, items, (sub) => !sub)
        omitidos.push(...r.omitidos)
      }
      await refrescarCalificacionesDe(actIds)
      if (omitidos.length) {
        toast(`No se cerró el Parcial ${p}: ${omitidos.length} ${omitidos.length !== 1 ? 'estudiantes entregaron' : 'estudiante entregó'} mientras se cerraba y se ${omitidos.length !== 1 ? 'conservaron sus entregas' : 'conservó su entrega'} (${nombresBreves([...new Set(omitidos.map((o) => o.alumnoId))], groupStudents)}). Califica y vuelve a cerrarlo.`, 'error')
        setCloseParcialConfirm(null)
        return
      }
      const sesionesConfirmadas = parseInt(closeParcialSesiones, 10)
      const closeTs = new Date().toISOString()
      await updateDoc(doc(db, 'subjects', subjectId), {
        [`parcialesCerrados.${p}`]: closeTs,
        ...(sesionesConfirmadas > 0 ? { [`totalOficialPorParcial.${p}`]: sesionesConfirmadas } : {}),
      })
      setSubject((s) => ({
        ...s,
        parcialesCerrados: { ...(s.parcialesCerrados || {}), [p]: closeTs },
        ...(sesionesConfirmadas > 0 ? {
          totalOficialPorParcial: { ...(s.totalOficialPorParcial || {}), [String(p)]: sesionesConfirmadas },
        } : {}),
      }))
      toast(`Parcial ${p} cerrado — ${missing.length} no entrega${missing.length !== 1 ? 's quedaron' : ' quedó'} en ${grade}`)
      setCloseParcialConfirm(null)
    } catch (err) {
      toast('Error al cerrar el parcial: ' + err.message, 'error')
    } finally {
      setClosingParcial(false)
    }
  }

  // Loads students + grades if not already in state, returns them for export.
  async function ensureGradesData() {
    let students = groupStudents
    let subMap = gradeSubMap
    if (!groupStudentsLoaded) {
      const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
      students = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      setGroupStudents(students); setGroupStudentsLoaded(true)
    }
    if (!gradesLoaded) {
      const subDocs = await fetchSubmissionsForActivities(activities.map((a) => a.id))
      subMap = {}
      subDocs.forEach((d) => { const data = { id: d.id, ...d.data() }; subMap[`${data.alumnoId}-${data.actividadId}`] = data })
      setGradeSubMap(subMap); setGradesLoaded(true)
    }
    return { students, submissions: Object.values(subMap) }
  }

  // Ungated per-parcial exports (used by the top Excel/PDF ⋮ menus for a
  // "progress" print at any time).
  async function doExportParcialExcel(p) {
    if (descargaSoloWeb(toast)) return
    if (!subject) return
    setExporting(true)
    try {
      const { students, submissions } = await ensureGradesData()
      await exportParcialGrades({ subject, activities, students, submissions, parcial: p, membrete })
    } catch (err) { toast('Error al exportar: ' + err.message, 'error') }
    finally { setExporting(false) }
  }
  async function doExportParcialPDF(p) {
    if (descargaSoloWeb(toast)) return
    if (!subject) return
    setExportingGradesPdf(true)
    try {
      const { students, submissions } = await ensureGradesData()
      await exportParcialGradesPDF({ subject, activities, students, submissions, parcial: p, membrete })
    } catch (err) { toast('Error al exportar PDF: ' + err.message, 'error') }
    finally { setExportingGradesPdf(false) }
  }

  // Asistencia — TODO y por parcial (⋮), mismo patrón que Calificaciones. Sin
  // PDF: en una hoja de asistencia (muchas columnas angostas por día) no
  // tiene caso, Excel es el formato natural. groupStudents/attendanceParciales
  // ya están cargados porque el botón solo se ve con la pestaña abierta.
  async function handleExportAttendance() {
    if (descargaSoloWeb(toast)) return
    if (!subject) return
    setExportingAttendance(true)
    try {
      // Exportar SIEMPRE es del curso completo, sin importar el interruptor
      // "Parcial actual / Todo el curso" (ese es solo para lo que se pinta
      // en pantalla) — por eso usa attendanceParcialesAll, no la variable
      // filtrada attendanceParciales.
      const denominadoresPorParcial = buildDenominadoresPorParcial(subject, sesionesPorParcialCliente)
      await exportSubjectAttendance({ subject, students: groupStudents, attendanceParciales: attendanceParcialesAll, membrete, denominadoresPorParcial })
    } catch (err) { toast('Error al exportar: ' + err.message, 'error') }
    finally { setExportingAttendance(false) }
  }
  async function doExportParcialAttendance(p) {
    if (descargaSoloWeb(toast)) return
    if (!subject) return
    setExportingAttendance(true)
    try {
      const denominadoresPorParcial = buildDenominadoresPorParcial(subject, sesionesPorParcialCliente)
      await exportParcialAttendance({ subject, students: groupStudents, attendanceParciales: attendanceParcialesAll, parcial: p, membrete, denominadoresPorParcial })
    } catch (err) { toast('Error al exportar: ' + err.message, 'error') }
    finally { setExportingAttendance(false) }
  }


  // R12: grades as PDF (same data as the Excel export).
  async function handleExportGradesPDF() {
    if (descargaSoloWeb(toast)) return
    if (!subject) return
    const falta = ponderacionIncompleta()
    if (falta) {
      toast(`La ponderación del Parcial ${falta.p} suma ${falta.total} de 10 — complétala antes de generar las calificaciones`, 'warning')
      return
    }
    setExportingGradesPdf(true)
    try {
      let students = groupStudents
      let subMap = gradeSubMap
      if (!groupStudentsLoaded) {
        const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
        students = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        setGroupStudents(students); setGroupStudentsLoaded(true)
      }
      if (!gradesLoaded) {
        const subDocs = await fetchSubmissionsForActivities(activities.map((a) => a.id))
        subMap = {}
        subDocs.forEach((d) => { const data = { id: d.id, ...d.data() }; subMap[`${data.alumnoId}-${data.actividadId}`] = data })
        setGradeSubMap(subMap); setGradesLoaded(true)
      }
      await exportSubjectGradesPDF({ subject, activities, students, submissions: Object.values(subMap), membrete })
    } catch (err) { toast('Error al exportar PDF: ' + err.message, 'error') }
    finally { setExportingGradesPdf(false) }
  }

  // R16: download the access list (#, name, username + the class access code). No temp
  // passwords — each student sets their own password on first sign-in.
  async function handleGenerateCredentials() {
    if (descargaSoloWeb(toast)) return
    if (!subject) return
    setGeneratingCredentials(true)
    try {
      let students = groupStudents
      if (!groupStudentsLoaded) {
        const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
        students = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        setGroupStudents(students); setGroupStudentsLoaded(true)
      }
      if (students.length === 0) { toast('No hay estudiantes en esta asignatura', 'error'); return }

      const docenteNombre = capitalizarNombre(userProfile?.nombreMostrar || userProfile?.nombre)
      await exportCredentialsPDF({ subject, students, docenteNombre, membrete })
      toast('Lista de acceso descargada')
      setShowCredentialsModal(false)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setGeneratingCredentials(false) }
  }

  // ── Computed ───────────────────────────────────────────────────────
  const PARCIALES = useMemo(() => Array.from({ length: subject?.parciales || 3 }, (_, i) => i + 1), [subject?.parciales])

  // "Actividad" labels (1.1, 1.2…) are presentation, not stored data — always
  // derived from each activity's position within its parcial in the current
  // `activities` list (kept sorted by `orden`). Computing this fresh on every
  // render means the displayed sequence can never drift out of order/gapped,
  // regardless of creation order, deletions, or stale stored values.
  // Drafts (hidden, never published, not scheduled) get NO number until they
  // are published — the sequence belongs to published activities only, so a
  // deleted publication's number passes to the next thing published.
  const activityLabelById = {}
  PARCIALES.forEach((p) => {
    activities.filter((a) => a.parcial === p && cuentaParaCalificacion(a)).forEach((a, i) => {
      // Trailing dot is part of the label everywhere: "1.2." (project-wide convention)
      activityLabelById[a.id] = `${p}.${i + 1}.`
    })
  })

  // Posición de la actividad del ⋮ abierto dentro de su parcial — para
  // deshabilitar "Subir"/"Bajar" cuando ya está en un extremo.
  const activityMenuSiblings = activityMenu ? activities.filter((x) => x.parcial === activityMenu.a.parcial) : []
  const activityMenuIdx = activityMenu ? activityMenuSiblings.findIndex((x) => x.id === activityMenu.a.id) : -1

  // Preview of the auto-assigned "Actividad" label shown (read-only) in the modal.
  const previewActividad = modalMode === 'create'
    ? `${modalParcial}.${activities.filter((a) => a.parcial === modalParcial && cuentaParaCalificacion(a)).length + 1}.`
    : (activityLabelById[editActivityId] || '—')

  const filteredGradeStudents = groupStudents.filter((s) => matchesStudentSearch(s, searchGrade))
  // Memoizados: la tabla de Asistencias puede tener miles de celdas, y sin
  // esto se recalculaba (y la tabla completa se reconstruía) en CADA cambio
  // de estado del componente — incluyendo escribir en el modal de
  // Justificación o cerrarlo, lo que se sentía como el propio modal
  // trabado. Ahora solo se recalcula cuando sus datos de verdad cambian.
  const filteredAttendanceStudents = useMemo(
    () => groupStudents.filter((s) => matchesStudentSearch(s, searchAttendance)),
    [groupStudents, searchAttendance]
  )
  // Un "día" agrupa sus slots consecutivos (1..duracion) — usado tanto para el
  // encabezado (mostrar la fecha una sola vez, con su duración) como para borrar
  // el día completo de una sola vez.
  // Cada "día" (fecha) agrupa sus slots; su parcial es el de sus registros
  // (todos se crean juntos). Registros viejos sin parcial → Parcial 1.
  const attendanceDays = useMemo(() => {
    // Deduplicar por (fecha, slot) antes de agrupar en días.
    // Razón: si Firestore contiene registros duplicados para el mismo slot
    // (datos históricos escritos antes de que existiera el guard en
    // handleCreateAttendanceDay), la tabla mostraría "1 1 2 2" en vez de "1 2".
    // Esta deduplicación es solo de presentación — NO borra datos de Firestore.
    // Cuando hay duplicados, gana el registro que cubre a MÁS alumnos vigentes.
    // Antes ganaba el de más faltas y, en empate, el primero por ID de
    // documento: así ganaba a veces un registro viejo con los IDs de un roster
    // reimportado, y todos los alumnos actuales aparecían con falta (sep-2026,
    // "Diseña red LAN 5D"). Los datos se fusionaron con
    // seeds-db/fusionar-asistencias-duplicadas.js; esto queda como red.
    const vigentes = new Set(groupStudents.map((s) => s.id))
    const cobertura = (rec) => Object.keys(rec.presentes || {}).filter((id) => vigentes.has(id)).length
    const marcas = (rec) => [...vigentes].filter((id) => rec.presentes?.[id] === false || rec.justificadas?.[id]).length
    const slotMap = new Map()
    for (const r of attendanceRecords) {
      const key = `${r.fecha}-${r.slot}`
      const prev = slotMap.get(key)
      if (!prev || cobertura(r) > cobertura(prev) || (cobertura(r) === cobertura(prev) && marcas(r) > marcas(prev))) {
        slotMap.set(key, r)
      }
    }
    const deduped = [...slotMap.values()]
    deduped.sort((a, b) => a.fecha === b.fecha ? a.slot - b.slot : a.fecha.localeCompare(b.fecha))
    const reales = [...new Set(deduped.map((r) => r.fecha))]
      .map((fecha) => {
        const records = deduped.filter((r) => r.fecha === fecha)
        // Derivar el parcial de las fechas actuales — si el docente cambia los
        // rangos, la sesión se mueve al parcial correcto en tiempo real.
        // Fallback: parcial almacenado en el registro (o 1 para datos muy viejos).
        const parcial = parcialForDate(subject?.parcialesFechas ?? [], fecha)
          ?? (records[0]?.parcial || 1)
        return { fecha, parcial, records }
      })
    // Días de asueto/vacaciones SIN ningún registro real: columna informativa
    // en memoria ("—", sin clic, no suma). Una fecha con registros reales
    // (reposición o histórico) se queda tal cual — ver asistenciaInformativa.js.
    const informativos = diasInformativosAsistencia({
      diasSinAsistencia: attendanceNoClaseDias,
      fechasConRegistro: reales.map((d) => d.fecha),
      parcialesFechas: subject?.parcialesFechas ?? [],
      porFecha: claseDias?.porFecha,
      horarioPatron: subject?.horarioPatron,
      todayISO: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })(),
    })
    if (!informativos.length) return reales
    return [...reales, ...informativos].sort((a, b) => a.fecha.localeCompare(b.fecha))
  }, [attendanceRecords, groupStudents, subject?.parcialesFechas, subject?.horarioPatron, attendanceNoClaseDias, claseDias])

  // Agrupa días consecutivos por mes (YYYY-MM) → celda "Mes Año" que abarca sus días.
  const groupDaysByMonth = (days) => days.reduce((acc, day) => {
    const ym = day.fecha.slice(0, 7)
    const last = acc[acc.length - 1]
    if (last && last.ym === ym) last.days.push(day)
    else acc.push({ ym, days: [day] })
    return acc
  }, [])

  // Agrupa por parcial (nivel superior, arriba del mes). Cada grupo lleva sus meses,
  // todos sus registros (para contar asistencias) y cuántas columnas de día ocupa.
  // TODOS los parciales con días — la tabla real solo pinta un subconjunto
  // de esto (ver attendanceParciales abajo), pero se necesita completo para
  // calcular cuál es "el parcial actual".
  const attendanceParcialesAll = useMemo(() => PARCIALES
    .map((p) => ({ parcial: p, days: attendanceDays.filter((d) => d.parcial === p) }))
    .filter((g) => g.days.length > 0)
    .map((g) => ({
      ...g,
      months: groupDaysByMonth(g.days),
      records: g.days.flatMap((d) => d.records),
      slotCount: g.days.reduce((n, d) => n + d.records.length, 0),
    })), [PARCIALES, attendanceDays])

  // El parcial "actual" — el que contiene la fecha de hoy según
  // subject.parcialesFechas. Si el curso no tiene fechas configuradas, o hoy
  // cae fuera de todos los rangos (antes de empezar / ya terminó), cae al
  // primero o último parcial CON días de asistencia (nunca a uno vacío).
  const attendanceParcialActual = useMemo(() => {
    const hoy = new Date().toISOString().slice(0, 10)
    const pf = subject?.parcialesFechas
    if (pf?.length) {
      const parcial = parcialForDate(pf, hoy)
      if (parcial) return parcial
      if (pf[0]?.inicio && hoy < pf[0].inicio) return 1
      return pf.length
    }
    if (!attendanceParcialesAll.length) return 1
    return attendanceParcialesAll[attendanceParcialesAll.length - 1].parcial
  }, [subject?.parcialesFechas, attendanceParcialesAll])

  // Pedido explícito: por defecto (y siempre en la App) solo se pinta el
  // parcial actual — antes se armaba TODA la tabla del curso completo de
  // una sola vez, la causa real de que la pestaña se sintiera pesada con un
  // semestre entero de días. En la web, un interruptor deja ver el curso
  // completo cuando de verdad se necesita.
  const [showAllParciales, setShowAllParciales] = useState(false)
  const attendanceParciales = useMemo(() => (
    // En el teléfono (web) tampoco hay "Todo el curso", igual que en la App.
    !IS_NATIVE_APP && !telefonoWeb.telefono && showAllParciales
      ? attendanceParcialesAll
      : attendanceParcialesAll.filter((g) => g.parcial === attendanceParcialActual)
  ), [attendanceParcialesAll, attendanceParcialActual, showAllParciales, telefonoWeb.telefono])

  // Registros mostrados (unión de los parciales visibles) — base de los totales.
  const attendanceAllRecords = useMemo(() => attendanceParciales.flatMap((g) => g.records), [attendanceParciales])

  // Tomar lista en el teléfono (web): al entrar, lleva la tabla a la sesión
  // de HOY si existe — sin esto, con 4-5 columnas visibles en vertical se
  // veían las primeras sesiones del parcial y había que buscar la de hoy a
  // mano. Una vez por orientación: al girar cambian los anchos de columna, así
  // que se vuelve a llevar a hoy; tocar celdas (que re-arma attendanceParciales)
  // no mueve la tabla.
  const tomarListaScrollRef = useRef(null)
  const tomarListaHoyRef = useRef(null)
  useEffect(() => {
    if (!tomarListaMovil) { tomarListaHoyRef.current = null; return }
    const box = tomarListaScrollRef.current
    if (loadingAttendance || !box || !attendanceParciales.length) return
    const orientacion = telefonoWeb.horizontal ? 'h' : 'v'
    if (tomarListaHoyRef.current === orientacion) return
    tomarListaHoyRef.current = orientacion
    const now = new Date()
    const hoy = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    // Mismo orden de columnas (data-col) que arma AttendanceTable.
    let col = 0
    let colHoy = null
    attendanceParciales.forEach((g) => g.days.forEach(({ fecha, records }) => records.forEach(() => {
      if (colHoy == null && fecha === hoy) colHoy = col
      col++
    })))
    if (colHoy == null) return
    const celda = box.querySelector(`tbody tr td[data-col="${colHoy}"]`)
    const fila = celda?.parentElement
    if (!celda || !fila) return
    // Nº + nombre son sticky: la sesión de hoy queda justo a su derecha.
    const anchoFijo = fila.children[0].offsetWidth + fila.children[1].offsetWidth
    box.scrollLeft = Math.max(0, celda.offsetLeft - anchoFijo)
  }, [tomarListaMovil, telefonoWeb.horizontal, loadingAttendance, attendanceParciales])

  // Drafts don't grade anything — keep them out of the Calificaciones table
  const tableParcials = PARCIALES.map((p) => ({
    p, acts: activities.filter((a) => a.parcial === p && cuentaParaCalificacion(a)),
  })).filter((pd) => pd.acts.length > 0)

  // Sequential index per real grade column (activities + parcial averages +
  // final average), shared by header and body cells via data-col so
  // handleGradeTableHover can tell which column is under the cursor.
  let _colIdx = 0
  const colIndexByKey = {}
  tableParcials.forEach(({ p, acts }) => {
    acts.forEach((a) => { colIndexByKey[`act-${a.id}`] = _colIdx++ })
    colIndexByKey[`avg-${p}`] = _colIdx++
  })
  colIndexByKey.final = _colIdx++

  // Event delegation: one listener on the table instead of one per cell.
  // Reads data-row/data-col off the hovered element (or its closest
  // ancestor that has them) and only updates state when they actually
  // change, so moving within the same cell doesn't re-render.
  const handleGradeTableHover = (e) => {
    const cell = e.target.closest('[data-col]')
    const row = e.target.closest('[data-row]')
    const col = cell ? Number(cell.getAttribute('data-col')) : null
    const rowIdx = row ? Number(row.getAttribute('data-row')) : null
    setHoverGradeCell((prev) => (prev.row === rowIdx && prev.col === col ? prev : { row: rowIdx, col }))
  }
  const handleGradeTableLeave = () => setHoverGradeCell({ row: null, col: null })
  const gradeHeaderColBg = (colIdx) => (hoverGradeCell.col === colIdx ? 'bg-[var(--accent-tint)]' : '')
  const gradeBodyCellBg = (colIdx, rowIdx) => {
    if (hoverGradeCell.col !== colIdx) return ''
    return hoverGradeCell.row === rowIdx
      ? 'bg-[var(--accent-tint-strong)] ring-1 ring-inset ring-[var(--accent)]'
      : 'bg-[var(--accent-tint)]'
  }

  // ── PONDERACIÓN (optional per-activity weights, per PARCIAL) ────────
  // A teacher may weight only some parciales (e.g. simple average in P1,
  // weighted in P2). `ponderacionParciales` holds the per-parcial switches;
  // the legacy subject-wide flag is the fallback for old subjects.
  const pondParcial = (p) => ponderacionActivaEnParcial(subject, p)
  const ALL_PARCIALES = Array.from({ length: subject?.parciales || 3 }, (_, i) => i + 1)
  const anyPonderacionOn = ALL_PARCIALES.some(pondParcial)
  // Parciales that actually have activities — offered in the per-parcial export menus
  const parcialesConActividades = ALL_PARCIALES.filter((p) => activities.some((a) => a.parcial === p && cuentaParaCalificacion(a)))

  // Global button: turns EVERY parcial on/off at once
  function togglePonderacion() {
    const next = !anyPonderacionOn
    // Going BACK to simple average when weights already exist needs an
    // explicit confirmation — shown in a panel anchored to the button
    // (the browser's native confirm() always appears top-center)
    const conPeso = activities.filter((a) => pesoDe(a) > 0)
    if (!next && conPeso.length > 0) {
      setConfirmRevertPonderacion(true)
      playAlertSound()
      return
    }
    applyPonderacion(next)
  }

  async function applyPonderacion(next) {
    setConfirmRevertPonderacion(false)
    // Un parcial cerrado definitivamente conserva su ponderación y sus pesos:
    // el botón global solo mueve los parciales abiertos o en atención.
    const cerrados = ALL_PARCIALES.filter((p) => parcialCerrado(subject, p))
    const conPeso = activities.filter((a) => pesoDe(a) > 0 && !parcialCerrado(subject, a.parcial))
    try {
      const map = {}
      ALL_PARCIALES.forEach((p) => { map[p] = cerrados.includes(p) ? pondParcial(p) : next })
      // Qué ven los estudiantes ya no se decide aquí: depende del estado de
      // cada parcial (resultadoPublicadoAlumno en utils/ponderacion.js).
      const updates = { ponderacionActivada: Object.values(map).some(Boolean), ponderacionParciales: map }
      await updateDoc(doc(db, 'subjects', subjectId), updates)
      // On activation weights start at 0 — the teacher types them. Only clear
      // existing weights when going back to simple average.
      if (!next && conPeso.length > 0) {
        const batch = writeBatch(db)
        conPeso.forEach((a) => batch.update(doc(db, 'activities', a.id), { pesoCalificacion: null }))
        await batch.commit()
        setActivities((prev) => prev.map((x) => x.pesoCalificacion != null && !parcialCerrado(subject, x.parcial) ? { ...x, pesoCalificacion: null } : x))
        setPesoEdits({})
      }
      setSubject((s) => ({ ...s, ...updates }))
      toast(next
        ? 'Ponderación activada — escribe el peso de cada actividad (deben sumar 10 para exportar)'
        : 'Promedio simple activado — los pesos se borraron')
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // Per-parcial switch (the button in the amber weights row)
  function toggleParcialPonderacion(p) {
    if (parcialCerrado(subject, p)) { toast(mensajeParcialCerrado(p), 'error'); return }
    const next = !pondParcial(p)
    const conPeso = activities.filter((a) => a.parcial === p && pesoDe(a) > 0)
    if (!next && conPeso.length > 0) {
      setConfirmRevertParcial(p)
      playAlertSound()
      return
    }
    applyParcialPonderacion(p, next)
  }

  async function applyParcialPonderacion(p, next) {
    setConfirmRevertParcial(null)
    if (parcialCerrado(subject, p)) { toast(mensajeParcialCerrado(p), 'error'); return }
    try {
      // Materialize the whole map so every parcial's state is explicit from now on
      const map = {}
      ALL_PARCIALES.forEach((pp) => { map[pp] = pp === p ? next : pondParcial(pp) })
      const any = Object.values(map).some(Boolean)
      const updates = { ponderacionParciales: map, ponderacionActivada: any }
      await updateDoc(doc(db, 'subjects', subjectId), updates)
      // On activation weights start at 0 — the teacher types them. Only clear
      // this parcial's weights when going back to simple average.
      if (!next) {
        const conPeso = activities.filter((a) => a.parcial === p && pesoDe(a) > 0)
        if (conPeso.length) {
          const batch = writeBatch(db)
          conPeso.forEach((a) => batch.update(doc(db, 'activities', a.id), { pesoCalificacion: null }))
          await batch.commit()
          setActivities((prev) => prev.map((x) => x.parcial === p && x.pesoCalificacion != null ? { ...x, pesoCalificacion: null } : x))
        }
      }
      setSubject((s) => ({ ...s, ...updates }))
      toast(next
        ? `Ponderación activada en el Parcial ${p} — escribe los pesos (deben sumar 10 para exportar)`
        : `Parcial ${p} con promedio simple — sus pesos se borraron`)
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // Aviso push cuando un estudiante se activa (o se reactiva tras un reinicio
  // de contraseña) en ESTA asignatura — a diferencia de otras categorías, no
  // vive en Ajustes > Notificaciones (un ajuste global), sino aquí: es una
  // decisión por asignatura. La Cloud Function (onEstudianteActivado) lee
  // este campo directo del documento de la asignatura. Activado por
  // defecto (campo ausente = true) — este checkbox es para APAGARLO en una
  // asignatura puntual, no para prenderlo.
  async function toggleNotificarActivacion() {
    const next = subject?.notificarActivacion === false
    try {
      await updateDoc(doc(db, 'subjects', subjectId), { notificarActivacion: next })
      setSubject((s) => ({ ...s, notificarActivacion: next }))
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // "Mostrar asistencias a estudiantes" — mismo patrón que el de arriba: por
  // asignatura, guardado inmediato, campo ausente = true. Solo decide si el
  // ESTUDIANTE ve su pestaña Asistencias (lo hace valer firestore.rules en
  // attendanceSummaries); el docente sigue viendo y registrando igual, y no
  // se borra ni se recalcula nada.
  async function toggleMostrarAsistenciasEstudiantes() {
    const next = subject?.mostrarAsistenciasEstudiantes === false
    try {
      await updateDoc(doc(db, 'subjects', subjectId), { mostrarAsistenciasEstudiantes: next })
      setSubject((s) => ({ ...s, mostrarAsistenciasEstudiantes: next }))
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }


  // Points still available in the parcial (10 − sum of the OTHER activities),
  // using in-progress edits. Used ONLY to cap each box so the total can never
  // exceed 10 — NOT to pre-fill or suggest a value (the teacher types freely,
  // any sum ≤ 10 is fine; exactly 10 is required only to export).
  function pesoRestante(acts, exceptId) {
    const sum = acts.reduce((t, x) => {
      if (x.id === exceptId) return t
      const edit = pesoEdits[x.id]
      const v = edit !== undefined ? parseFloat(edit) : parseFloat(x.pesoCalificacion)
      return t + (isNaN(v) || v < 0 ? 0 : v)
    }, 0)
    return Math.max(0, parseFloat((10 - sum).toFixed(2)))
  }

  // Live parcial total: includes the in-progress edits (typing), so the 10
  // indicator reacts on every keystroke, not only after blur
  function pesoTotalVivo(acts) {
    const sum = acts.reduce((t, x) => {
      const edit = pesoEdits[x.id]
      const v = edit !== undefined ? parseFloat(edit) : parseFloat(x.pesoCalificacion)
      return t + (isNaN(v) || v < 0 ? 0 : v)
    }, 0)
    return parseFloat(sum.toFixed(2))
  }

  // Auto-commit: wheel adjustments never blur the input, so pending edits
  // are clamped+saved shortly after the last change (typing still commits
  // on blur immediately). This is what guarantees the parcial can't stay
  // above 10.
  useEffect(() => {
    const ids = Object.keys(pesoEdits)
    if (!ids.length) return
    const t = setTimeout(() => {
      ids.forEach((id) => {
        const act = activities.find((x) => x.id === id)
        if (act) savePeso(act)
      })
    }, 800)
    return () => clearTimeout(t)
  }, [pesoEdits]) // eslint-disable-line react-hooks/exhaustive-deps

  async function savePeso(a) {
    const raw = pesoEdits[a.id]
    if (raw === undefined) return
    // Parcial cerrado definitivamente: los pesos quedan congelados.
    if (parcialCerrado(subject, a.parcial)) {
      setPesoEdits((f) => { const n = { ...f }; delete n[a.id]; return n })
      return
    }
    let num = parseFloat(raw)
    if (isNaN(num) || num < 0) num = null
    // Cap so the parcial total can NEVER exceed 10 (the teacher can go under —
    // exactly 10 is only required to export). No auto-fill or suggestions.
    if (num !== null) {
      const actsParcial = activities.filter((x) => x.parcial === a.parcial && cuentaParaCalificacion(x))
      const restante = pesoRestante(actsParcial, a.id)
      if (num > restante) num = restante
    }
    setPesoEdits((f) => { const n = { ...f }; delete n[a.id]; return n })
    if ((a.pesoCalificacion ?? null) === num) return
    try {
      await updateDoc(doc(db, 'activities', a.id), { pesoCalificacion: num })
      setActivities((prev) => prev.map((x) => x.id === a.id ? { ...x, pesoCalificacion: num } : x))
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // Pre-compute grade rows
  // Orden por promedio (mayor a menor) con columna LUGAR — opcional, por parcial
  // o general. El número de lista del estudiante (No.) NO cambia; LUGAR es su
  // posición en el ranking.
  const [gradeSortOn, setGradeSortOn] = useState(false)
  const [gradeSortParcial, setGradeSortParcial] = useState(null) // null = general
  const [gradeSortMenuOpen, setGradeSortMenuOpen] = useState(false)
  const [rankingExportMenu, setRankingExportMenu] = useState(null) // null | 'excel' | 'pdf'

  const gradeRows = filteredGradeStudents.map((s) => {
    const parcialData = tableParcials.map(({ p, acts }) => {
      const grades = acts.map((a) => {
        const sub = gradeSubMap[`${s.id}-${a.id}`]
        return normalizeGrade(sub?.calificacion, a.maxCalif, { decimals: 1 })
      })
      // Which grades were auto-assigned by closing the parcial (shown in red)
      const gradesCierre = acts.map((a) => {
        const sub = gradeSubMap[`${s.id}-${a.id}`]
        return !!(sub && sub.cierreParcial)
      })
      const rawAvg = promedioParcial(acts, grades, pondParcial(p))
      const avg = rawAvg !== null ? parseFloat(rawAvg.toFixed(1)) : null
      return { p, grades, gradesCierre, avg }
    })
    const validAvgs = parcialData.map((pd) => pd.avg).filter((a) => a !== null)
    const finalAvg = validAvgs.length
      ? parseFloat((validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length).toFixed(1))
      : null
    return { s, parcialData, finalAvg }
  })

  // Valor por el que se ordena (promedio del parcial elegido o el general).
  const gradeSortValue = (row) => gradeSortParcial == null
    ? row.finalAvg
    : (row.parcialData.find((pd) => pd.p === gradeSortParcial)?.avg ?? null)
  const sortedGradeRows = gradeSortOn
    ? [...gradeRows].sort((a, b) => {
        const av = gradeSortValue(a)
        const bv = gradeSortValue(b)
        if (av == null && bv == null) return 0
        if (av == null) return 1      // sin promedio → al final
        if (bv == null) return -1
        return bv - av                // mayor a menor
      })
    : gradeRows

  // Al ordenar por un parcial específico, se ocultan los demás parciales y el
  // Final (queda solo LUGAR, Nombre y ese parcial). Con "General" se ven todos.
  const soloParcial = gradeSortOn && gradeSortParcial != null
  const visibleParcials = soloParcial ? tableParcials.filter((tp) => tp.p === gradeSortParcial) : tableParcials
  const showFinalCol = !soloParcial

  // Al ordenar: n = PARTE ENTERA del 20% del total. Los n PRIMEROS del ranking
  // (mayor promedio) → verde; los n ÚLTIMOS (menor desempeño; los que no han
  // entregado nada quedan al final) → naranja. Sin ordenar, n = 0 y no se
  // resalta nada (ojo: slice(-0) devolvería TODO, por eso el guard de n > 0).
  const gradeHlCount = gradeSortOn ? Math.floor(sortedGradeRows.length * 0.2) : 0
  const gradeTopIds = new Set(gradeHlCount > 0 ? sortedGradeRows.slice(0, gradeHlCount).map((r) => r.s.id) : [])
  // El naranja excluye a quienes ya son verdes (grupos chicos donde se traslapan).
  const gradeBottomIds = new Set(
    gradeHlCount > 0
      ? sortedGradeRows.slice(-gradeHlCount).map((r) => r.s.id).filter((id) => !gradeTopIds.has(id))
      : []
  )

  // Filas del ranking (LUGAR, Nombre, Promedio) ordenadas por el parcial
  // elegido (null = general) — para exportar a Excel/PDF.
  function rankingRowsFor(parcial) {
    const list = gradeRows.map(({ s, parcialData, finalAvg }) => ({
      orden: s.orden,
      nombre: studentFullName(s),
      promedio: parcial == null ? finalAvg : (parcialData.find((pd) => pd.p === parcial)?.avg ?? null),
    }))
    list.sort((a, b) => {
      if (a.promedio == null && b.promedio == null) return 0
      if (a.promedio == null) return 1
      if (b.promedio == null) return -1
      return b.promedio - a.promedio
    })
    return list.map((r, i) => ({ lugar: i + 1, ...r }))
  }
  async function doExportRanking(kind, parcial) {
    if (descargaSoloWeb(toast)) return
    setRankingExportMenu(null)
    const rows = rankingRowsFor(parcial)
    const label = parcial == null ? 'Promedio final' : `Parcial ${parcial}`
    try {
      if (kind === 'excel') await exportRankingExcel({ subject, rows, label, membrete })
      else await exportRankingPDF({ subject, rows, label, membrete })
    } catch (err) { toast('Error al exportar: ' + err.message, 'error') }
  }

  const filteredAlumnos = groupStudents
    .filter((s) =>
      matchesStudentSearch(s, searchAlumnos) ||
      // El username nunca trae acentos (generateUsername los quita), así que la
      // búsqueda también se los quita: escribir "garcía" encuentra garcia.juan.
      sinAcentos(s.username).includes(sinAcentos(searchAlumnos).trim())
    )
    .filter((s) =>
      filtroActivacion === 'activo' ? s.activado :
      filtroActivacion === 'sin_activar' ? !s.activado :
      true
    )

  // totalOficialDebounceRef conservado pero handleSaveTotalOficial eliminado:
  // el total oficial solo se guarda al CERRAR el parcial (modal confirmCloseParcial),
  // no mediante un input inline en la tabla. El ref se conserva para no romper
  // el patrón si se necesita recuperar en el futuro.
  const totalOficialDebounceRef = useRef({})

  // Fecha de hoy en formato ISO 'YYYY-MM-DD' — sesiones con fecha posterior no
  // son asistencias reales todavía, se excluyen del conteo y del ordenamiento.
  const todayISOComp = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()

  // Orden de la tabla de Asistencias por porcentaje de inasistencia — clon del
  // patrón de Calificaciones. Para el valor de ordenación por parcial específico
  // usamos los registros de ese parcial; para "general" usamos todos los registros.
  const attSortValue = (s) => {
    const records = attSortParcial != null
      ? (attendanceParciales.find((g) => g.parcial === attSortParcial)?.records ?? [])
      : attendanceAllRecords
    const { asist, inasist } = countPresence(records, s.id, null, todayISOComp)
    const total = asist + inasist
    return total > 0 ? inasist / total : null
  }
  const sortedAttStudents = attSortOn
    ? [...filteredAttendanceStudents].sort((a, b) => {
        const av = attSortValue(a), bv = attSortValue(b)
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return bv - av
      })
    : filteredAttendanceStudents

  // Tabla de asistencias — ver componente AttendanceTable (memo) arriba.
  const attendanceTableJsx = (
    <AttendanceTable
      attendanceParciales={attendanceParciales}
      filteredAttendanceStudents={sortedAttStudents}
      attendanceAllRecords={attendanceAllRecords}
      onCellClick={stableCellClick}
      onDeleteDay={stableDeleteDay}
      onBack={tomarListaMovil ? stableTomarListaBack : stableAttBack}
      onAddDay={stableAddDay}
      addDayLabel={addDayLabel}
      lastEditedCell={lastEditedAttCell}
      // Fecha bajo "Parcial N": web de escritorio y app, como antes de #1465.
      // En el teléfono (web) se quitó a pedido explícito.
      parcialesFechas={telefonoWeb.telefono ? undefined : subject?.parcialesFechas}
      totalOficialPorParcial={subject?.totalOficialPorParcial}
      sesionesPorParcialCliente={sesionesPorParcialCliente}
      parcialesCerrados={subject?.parcialesCerrados}
      umbralInasistencia={umbralInasistencia}
      observaciones={observacionesPorCelda}
      onCellContextMenu={stableCellContextMenu}
      onNameContextMenu={stableNameContextMenu}
      variante={IS_NATIVE_APP ? 'app' : tomarListaMovil ? (telefonoWeb.horizontal ? 'movil-h' : 'movil-v') : 'web'}
    />
  )

  // Lista de estudiantes de solo lectura para Asistencias — visible SIEMPRE
  // (aunque todavía no haya días agregados), para que el docente vea quién
  // está inscrito en vez de una pestaña que parece vacía o rota.
  const attendanceStudentsRosterJsx = (
    <ul className="divide-y divide-outline-variant rounded-card border border-outline-variant bg-surface-card overflow-hidden">
      {filteredAttendanceStudents.map((s) => (
        <li key={s.id} className="px-3 py-2 text-sm text-on-surface flex items-center gap-2">
          <span className="text-muted tabular-nums w-6 flex-shrink-0">{s.orden ?? ''}</span>
          {studentFullName(s)}
        </li>
      ))}
    </ul>
  )

  // Leyenda de estados de asistencia (compartida web/app) — en la web el
  // texto queda solo un poco más grande que los nombres de la tabla (text-sm),
  // y los íconos del mismo tamaño que tienen en las celdas (w-6 h-6, 14px);
  // la app se queda como estaba. Ya no hay clic derecho/mantener presionado
  // como atajo aparte (se quitó por completo) — un clic/toque más sobre la
  // "J con puntito" abre lo mismo para revisar/editar el motivo.
  const attendanceLegend = (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 px-1 text-muted ${IS_NATIVE_APP ? 'text-[11px]' : 'text-base'}`}>
      <span className="inline-flex items-center gap-1">
        <span className={`inline-flex items-center justify-center rounded bg-green-100 text-green-600 ${IS_NATIVE_APP ? 'w-4 h-4' : 'w-6 h-6'}`}><CheckIcon size={IS_NATIVE_APP ? 11 : 14} /></span>
        Asistencia
      </span>
      <span className="inline-flex items-center gap-1">
        <span className={`inline-flex items-center justify-center rounded bg-red-100 text-red-500 ${IS_NATIVE_APP ? 'w-4 h-4' : 'w-6 h-6'}`}><X size={IS_NATIVE_APP ? 11 : 14} /></span>
        Falta
      </span>
      <span className="inline-flex items-center gap-1">
        <span className={`inline-flex items-center justify-center rounded bg-amber-100 text-amber-600 font-bold leading-none ${IS_NATIVE_APP ? 'w-4 h-4 text-[10px]' : 'w-6 h-6 text-[12px]'}`}>J</span>
        Justificada sin motivo (cuenta como asistencia)
      </span>
      <span className="inline-flex items-center gap-1">
        <span className={`relative inline-flex items-center justify-center rounded bg-amber-100 text-amber-600 font-bold leading-none ${IS_NATIVE_APP ? 'w-4 h-4 text-[10px]' : 'w-6 h-6 text-[12px]'}`}>
          J
          <span className={`absolute -top-0.5 -right-0.5 rounded-full bg-amber-500 ${IS_NATIVE_APP ? 'w-1.5 h-1.5' : 'w-2 h-2'}`} />
        </span>
        Justificada con motivo
      </span>
      <span className="text-hint">· Toca para cambiar el estado</span>
    </div>
  )

  // Ayuda de observaciones, debajo de la leyenda de estados y claramente por
  // debajo de ella (más chica y más clara, sin íconos, para no competir con
  // los cuadritos de color). Se pinta donde se pinta la leyenda: la vista
  // estándar (escritorio y tablet). El texto nombra el gesto de cada aparato:
  // con mouse, clic derecho; en pantalla táctil, pulsación larga — solo cambia
  // la redacción, la interacción es la misma en ambos casos.
  const CONSEJOS_OBSERVACIONES = [
    ['Clic derecho en la celda para agregar observación', 'Mantén presionada la celda para agregar observación'],
    ['Clic derecho en el nombre para ver bitácora de observaciones', 'Mantén presionado el nombre para ver bitácora de observaciones'],
  ]
  const attendanceLegendObservaciones = (
    <div className="mt-1 px-1 text-sm text-hint leading-snug">
      {CONSEJOS_OBSERVACIONES.map(([conMouse, conDedo]) => (
        <p key={conMouse}>
          <span className="hidden [@media(hover:hover)_and_(pointer:fine)]:inline">{conMouse}</span>
          <span className="[@media(hover:hover)_and_(pointer:fine)]:hidden">{conDedo}</span>
        </p>
      ))}
    </div>
  )

  // Motivos rápidos para justificar una falta (botones de un toque).
  const QUICK_MOTIVOS = [
    { emoji: '🤒', label: 'Salud' },
    { emoji: '👨‍👩‍👧', label: 'Familiar' },
    { emoji: '🏫', label: 'Escolar' },
    { emoji: '📅', label: 'Cita o trámite' },
  ]
  // compact = tamaño de la app (columna angosta de 16rem); la web usa texto e
  // iconos más grandes porque ahí sobra espacio horizontal de sobra.
  const renderQuickMotivo = (compact) => (
    <div className="grid grid-cols-2 gap-2">
      {QUICK_MOTIVOS.map((m) => (
        <button key={m.label} type="button" onClick={() => setReasonText(m.label)}
          className={`rounded-full border font-medium whitespace-nowrap transition-colors ${compact ? 'px-1.5 py-2 text-[10px]' : 'px-3 py-2.5 text-sm'} ${
            reasonText.trim() === m.label
              ? 'border-amber-500 bg-amber-50 text-amber-700'
              : 'border-outline-variant text-on-surface hover:bg-[var(--accent-tint)]'
          }`}>
          <span className={compact ? '' : 'text-base'}>{m.emoji}</span> {m.label}
        </button>
      ))}
    </div>
  )
  const quickMotivoButtons = renderQuickMotivo(true)
  const quickMotivoButtonsLg = renderQuickMotivo(false)

  // Barra simple para la vista horizontal (app) SOLO en estados sin tabla
  // (cargando / sin alumnos / sin días). Con datos, los controles van en la
  // esquina superior izquierda de la tabla (ver attendanceTableJsx).
  const nativeAttBar = (
    <div className="flex items-center gap-2 px-2 py-1 bg-accent-light border-b border-outline-variant">
      {/* Mismo botón verde fosforescente que en la tabla con datos — igual
          color y tamaño en cualquier asignatura */}
      <button type="button" onClick={() => switchTab('actividades')} aria-label="Regresar"
        className="flex-none px-2.5 py-1 rounded bg-[#39FF14] text-black hover:bg-[#2ee510] transition-colors">
        <ArrowLeft size={ICONO.md} />
      </button>
      <span className="text-sm font-bold text-on-surface uppercase tracking-wide">Asistencias</span>
      {addDayLabel && totalStudents > 0 && (
        <Button icon={CalendarPlus} className="ml-auto" onClick={handleAddDayClick}>
           {addDayLabel}
        </Button>
      )}
    </div>
  )

  // Misma barra para Tomar lista en el teléfono (web): en vertical siempre (la
  // esquina de la tabla no cabe junto al nombre de 130px) y en horizontal solo
  // en los estados sin tabla. Regresar pasa por el historial (ver
  // stableTomarListaBack) para que el botón atrás del navegador quede en orden.
  const tomarListaMovilBar = (
    <div className="flex items-center gap-2 px-2 py-1 bg-accent-light border-b border-outline-variant">
      <button type="button" onClick={stableTomarListaBack} aria-label="Regresar"
        className="flex-none px-2.5 py-1 rounded bg-[#39FF14] text-black hover:bg-[#2ee510] transition-colors">
        <ArrowLeft size={ICONO.md} />
      </button>
      {/* Indicación (no botón) solo en vertical: debajo de ASISTENCIAS, así la
          barra crece ~4px en vez de agregar una franja propia. */}
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-bold text-on-surface uppercase tracking-wide">Asistencias</span>
        {!telefonoWeb.horizontal && (
          <span className="text-[11px] leading-tight text-muted">Girar para mejorar vista</span>
        )}
      </div>
      {addDayLabel && totalStudents > 0 && (
        <Button icon={CalendarPlus} className="ml-auto" onClick={handleAddDayClick}>
           {addDayLabel}
        </Button>
      )}
    </div>
  )

  if (loading) return (
    <EsqueletoAsignaturaDocente />
  )

  // Botones de acción del encabezado, en dos grupos reutilizables (izquierda:
  // QR/link/código — derecha: editar/duplicar/archivar/eliminar). Se renderizan
  // en DOS layouts distintos más abajo (móvil apilado / escritorio en fila) en
  // vez de un solo flex-wrap responsivo: varios intentos de hacerlo con un
  // único contenedor (spacer flex-1, flex-shrink-0, basis-full, w-max — todos
  // fallaron) tropezaron con una ambigüedad conocida de flexbox cuando un div
  // es a la vez flex-item de la fila exterior Y flex-container con su propio
  // wrap para sus botones — el navegador terminaba encogiéndolo por debajo de
  // su contenido real (o reportando un scrollWidth "fantasma"), desbordando
  // toda la página. Con display:none/flex (hidden/flex) en vez de shrink/basis
  // no hay ambigüedad posible: cada layout es una fila plana normal.
  // Solo el CÓDIGO. El QR y el link de activación se quitaron a propósito: le
  // resolvían al alumno el paso de escribir el código, y así nunca se enteraba
  // de que su asignatura tiene uno. Eso lo dejaba varado después, cuando en la
  // app —que no trae lector de QR— unirse a otra materia exige teclearlo. Una
  // sola forma de entrar, la misma en web y en app.
  const subjectHeaderLeftIcons = (
    <>
      <button type="button" onClick={copyAccessCode}
        data-tooltip={IS_NATIVE_APP ? 'Copiar código de acceso para estudiantes' : 'Copiar'}
        className={`flex items-center gap-2 px-3 min-h-control rounded-full transition duration-estandar flex-shrink-0 font-mono font-bold text-2xl ${copiedCode ? 'text-emerald-600 bg-emerald-50' : 'text-accent hover:bg-[var(--accent-medium)]'}`}>
        {copiedCode
          ? <><CheckIcon size={ICONO.md} className="animate-pop motion-reduce:animate-none flex-shrink-0" /><span>Copiado</span></>
          : <span>{subject?.accessCode}</span>}
      </button>
      {/* Leyenda del código: solo en la web de ESCRITORIO. En la app nunca
          existió y en el teléfono (web) se quitó a pedido explícito
          (sep-2026): ahí su lugar lo ocupa el botón "Editar". */}
      {!IS_NATIVE_APP && !telefonoWeb.telefono && (
        <span className="text-sm font-medium text-muted flex-shrink-0">Código de acceso a este curso para estudiantes</span>
      )}
    </>
  )
  // Teléfono (web) (sep-2026, pedido explícito): solo "Editar" (lápiz + texto)
  // junto al código, y "Restaurar" si la asignatura está archivada. Duplicar,
  // archivar y eliminar NO se muestran en el teléfono, pero sus handlers y
  // modales siguen intactos (escritorio y App los usan tal cual).
  const subjectHeaderRightIconsWeb = (
    <>
      <button type="button" onClick={openEditSubject}
        aria-label="Editar los datos de la asignatura (nombre, grupo, color, icono…)"
        data-tooltip="Editar los datos de la asignatura (nombre, grupo, color, icono…)"
        className="flex items-center gap-1.5 px-3 min-h-control text-sm font-medium text-muted hover:text-accent hover:bg-[var(--accent-medium)] rounded-full transition-colors flex-shrink-0">
        <Pencil size={ICONO.md} /> Editar
      </button>
      {subject?.archived && (
        <button type="button" onClick={handleToggleArchive} disabled={archiving}
          aria-label="Restaurar asignatura (vuelve a tus asignaturas activas)"
          data-tooltip="Restaurar asignatura (vuelve a tus asignaturas activas)"
          className="flex items-center gap-1.5 px-3 min-h-control text-sm font-medium text-muted hover:text-accent hover:bg-[var(--accent-medium)] rounded-full transition-colors disabled:opacity-40 flex-shrink-0">
          <ArchiveRestore size={ICONO.md} /> Restaurar
        </button>
      )}
    </>
  )
  // App y web de ESCRITORIO: los cuatro (editar, duplicar, archivar,
  // eliminar), sin cambios. Solo el teléfono (web) usa la versión reducida.
  const subjectHeaderRightIcons = (IS_NATIVE_APP || !telefonoWeb.telefono) ? (
    <>
      {/* ml-auto en el PRIMER botón de este grupo: empuja editar/duplicar/
          archivar/eliminar hasta la orilla derecha del renglón, comiéndose
          todo el espacio libre. Va en un botón suelto (hijo plano del
          flex-wrap), no en un div contenedor — así se conserva la fila plana
          que evita el desbordamiento descrito arriba. Si la fila envuelve,
          el grupo simplemente queda alineado a la derecha del renglón nuevo. */}
      <IconButton icon={Pencil} label="Editar los datos de la asignatura (nombre, grupo, color, icono…)" tooltip={false} className="ml-auto" onClick={openEditSubject}
       
        data-tooltip="Editar los datos de la asignatura (nombre, grupo, color, icono…)" data-tooltip-pos="left" />
      <IconButton icon={Copy} label="Duplicar esta asignatura (con o sin la lista de estudiantes)" tooltip={false} onClick={openCopyModal}
       
        data-tooltip="Duplicar esta asignatura (con o sin la lista de estudiantes)" data-tooltip-pos="left" />
      <button type="button" onClick={handleToggleArchive} disabled={archiving}
        aria-label={subject?.archived ? 'Restaurar asignatura (vuelve a tus asignaturas activas)' : 'Archivar asignatura (la guarda completa; sale de tus asignaturas activas)'}
        data-tooltip={subject?.archived ? 'Restaurar asignatura (vuelve a tus asignaturas activas)' : 'Archivar asignatura (la guarda completa; sale de tus asignaturas activas)'} data-tooltip-pos="left"
        className="size-control inline-flex items-center justify-center text-hint hover:text-accent hover:bg-[var(--accent-medium)] rounded-full transition-colors disabled:opacity-40 flex-shrink-0">
        {subject?.archived ? <ArchiveRestore size={ICONO.md} /> : <Archive size={ICONO.md} />}
      </button>
      <IconButton icon={Trash2} effect="balanceo" label="Eliminar la asignatura permanentemente (no se puede deshacer)" variant="danger" tooltip={false} onClick={() => { setDeleteSubjectConfirmText(''); setShowDeleteSubjectConfirm(true) }}
       
        data-tooltip="Eliminar la asignatura permanentemente (no se puede deshacer)" data-tooltip-pos="left" />
    </>
  ) : subjectHeaderRightIconsWeb

  return (
    <ContextoAsignatura.Provider value={{ PARCIALES, actTip, activeTab, activities, activityContextMenu, activityExistingFiles, activityLabelById, activityMenu, activityMenuIdx, activityMenuSiblings, activityNewFiles, addDayLabel, addInstructionFiles, addMaterialFiles, addStudent, analisisAsignaturaAbierto, anexarActividadVideo, anyPonderacionOn, applyMoveActivities, applyNewDateResult, applyParcialPonderacion, applyPonderacion, archiveConZip, archiving, atencionParcialConfirm, atencionPestanas, attExportMenu, attSortOn, attSortParcial, attendanceLegend, attendanceLegendObservaciones, attendanceNoClaseDias, attendanceParciales, attendanceParcialesAll, attendanceRecords, attendanceStudentsRosterJsx, attendanceTableJsx, bulkGradeModal, bulkGradeValue, canCreate, clearGradeQuickEdit, closeParcialConfirm, closeParcialGrade, closeParcialSesiones, closingParcial, colIndexByKey, confirmBulkGradeNoEntregadas, confirmCloseParcial, confirmDeleteStudent, confirmExcelImport, confirmImport, confirmIniciarAtencion, confirmResetStudentPassword, confirmRevertParcial, confirmRevertPonderacion, copyFechas, copyForm, copyingSubject, crearActividadIA, crearEvalIA, crearJuegoIA, crearVideoIA, currentUser, deleteConfirm, deleteMaterialConfirm, deleteResourceConfirm, deleteSubjectConfirmText, deleting, deletingMaterial, deletingResource, deletingSubject, doExportParcialAttendance, doExportParcialExcel, doExportParcialPDF, doExportRanking, dragDraftId, dragMatId, dropZoneActive, duplicateConfirm, duplicating, editStudentChanged, editStudentForm, editSubjectChanged, editSubjectForm, editingActivityData, editingMaterial, editingSubject, editorIsPublished, elegirCreacion, entregableEditor, estadoFiltroOpen, evalEditor, excelPreview, expandedMaterialId, exporting, exportingAttendance, exportingGradesPdf, filteredAlumnos, filteredAttendanceStudents, filteredGradeStudents, filtroActivacion, form, generatingCredentials, goToActivityFromGrades, gradeBodyCellBg, gradeBottomIds, gradeHeaderColBg, gradeQuickEdit, gradeSortMenuOpen, gradeSortOn, gradeSortParcial, gradeSubMap, gradeTopIds, groupStudents, groupStudentsLoaded, handleAddDayClick, handleAllowRejoin, handleArchiveConfirm, handleCopySubject, handleDeleteActivity, handleDeleteMaterial, handleDeleteResource, handleDeleteStudentPhoto, handleDeleteSubject, handleDraftDrop, handleDuplicateActivity, handleEditSubject, handleExcelFileSelected, handleExport, handleExportAttendance, handleExportGradesPDF, handleGenerateCredentials, handleGradeTableHover, handleGradeTableLeave, handleMaterialDrop, handleSaveActivity, handleSaveMaterial, handleSaveResource, handleUnarchiveConfirm, hideActivity, hideMaterial, importFor, importLoading, importSel, importSrc, importSrcActs, importSubjects, importing, importingExcel, iniciandoAtencion, linkCandidate, loadingAttendance, loadingGrades, loadingResources, materialChanged, materialExistingFiles, materialForm, materialModalMode, materialNewFiles, materialParcial, materials, membrete, menuPaso, modalMode, modalParcial, moveConfirm, moving, nativeAttBar, navigate, newDateOpen, newStudent, openActivityContextMenu, openAdd, openAddMaterial, openAddResource, openEdit, openEditMaterial, openEditResource, openEditStudent, openGradeQuickEdit, openImport, openNewDateForEditor, openParcial, parcialMenu, parcialesConActividades, parcialesVistos, parsingExcel, pesoEdits, pesoRestante, pesoTotalVivo, pickImportSubject, pondParcial, previewActividad, previewResourceId, publishDraftConfirm, publishDraftNow, rankingExportMenu, removeInstructionFile, requestCloseParcial, requestDeleteFromEdit, requestMoveActivity, requestResetFromEdit, resetPwdResult, resolveLinkCandidate, resourceChanged, resourceForm, resourceModalMode, resources, resourcesLoaded, revertCloseParcial, revertParcialConfirm, revertingParcial, saveEditStudent, saveGradeQuickEdit, savePeso, saving, savingBulkGrade, savingMaterial, savingQuickGrade, savingResource, savingStudent, searchAlumnos, searchAttendance, searchGrade, setActTip, setActivities, setActivityContextMenu, setActivityMenu, setAnalisisAsignaturaAbierto, setArchiveConZip, setAtencionParcialConfirm, setAttExportMenu, setAttSortOn, setAttSortParcial, setBulkGradeModal, setBulkGradeValue, setCloseParcialConfirm, setCloseParcialGrade, setCloseParcialSesiones, setConfirmRevertParcial, setConfirmRevertPonderacion, setCopyFechas, setCopyForm, setCrearActividadIA, setCrearEvalIA, setCrearJuegoIA, setCrearVideoIA, setDeleteConfirm, setDeleteMaterialConfirm, setDeleteResourceConfirm, setDeleteSubjectConfirmText, setDragDraftId, setDragMatId, setDropZoneActive, setDuplicateConfirm, setEditStudentForm, setEditSubjectForm, setEntregableEditor, setEstadoFiltroOpen, setEvalEditor, setExcelPreview, setExpandedMaterialId, setFiltroActivacion, setForm, setGradeQuickEdit, setGradeSortMenuOpen, setGradeSortOn, setGradeSortParcial, setImportFor, setImportSel, setImportSrc, setImportSrcActs, setLinkCandidate, setMaterialExistingFiles, setMaterialForm, setMaterialNewFiles, setMenuPaso, setMoveConfirm, setNewDateOpen, setNewStudent, setOpenParcial, setParcialMenu, setPesoEdits, setPreviewResourceId, setPublishDraftConfirm, setRankingExportMenu, setResetPwdResult, setResourceFile, setResourceForm, setRevertParcialConfirm, setSearchAlumnos, setSearchAttendance, setSearchGrade, setShowAddStudent, setShowAllParciales, setShowArchiveModal, setShowCopyModal, setShowCredentialsModal, setShowDeleteSubjectConfirm, setShowEditSubjectModal, setShowMaterialModal, setShowModal, setShowResourceModal, setShowUnarchiveModal, setSoloCalificables, setStudentToDelete, setStudentToEdit, setStudentToReset, setSubmissionCounts, setTipoActividad, setUnarchiveActivities, setUnarchiveEdits, setUnarchiveStudents, showActivityNow, showAddStudent, showAllParciales, showArchiveModal, showCopyModal, showCredentialsModal, showDeleteSubjectConfirm, showEditSubjectModal, showFinalCol, showMaterialModal, showMaterialNow, showModal, showResourceModal, showUnarchiveModal, soloCalificables, sortStudentsAlphabetically, sortedGradeRows, studentLastAccess, studentToDelete, studentToEdit, studentToReset, subject, subjectId, submissionCounts, tableParcials, telefonoWeb, tipoActividad, toggleImportLinkDecision, toggleImportSel, toggleMostrarAsistenciasEstudiantes, toggleNotificarActivacion, toggleParcialPonderacion, toggleParcialVisibility, togglePonderacion, tomarListaMovil, tomarListaMovilBar, tomarListaScrollRef, totalStudents, unarchiveActivities, unarchiveEdits, unarchiveStudents, unarchivedSaving, visibleParcials, zipDownloading, zipProgress }}>
    <>
      <div {...subjectPaletteProps(subject?.colorPalette)}>


        {/* ── Header ──
            A TODO EL ANCHO del área de contenido (sin importar la pantalla) y con
            esquinas de ABAJO redondeadas (arriba no: ahí topa con la barra
            superior). Con el lienzo azul, este bloque blanco pasó a leerse como
            una tarjeta, y una tarjeta que termina en canto recto se ve cortada,
            no terminada. */}
        {/* Encabezado a TODO lo ancho (patrón Classroom); el contenido, abajo,
            va limitado y centrado (anchoSeccion). Antes:
            gutter (px-4): sus bordes izquierdo y derecho coinciden en cualquier
            pantalla (antes el encabezado iba a todo lo ancho y la lista era
            más angosta). */}
        <div className="px-4 pt-2">
        <div data-esq="subj-doc-encabezado" className="bg-surface-card rounded-card">
          <div data-esq="subj-doc-encabezado-interior" className="px-4 py-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={goBack} aria-label="Volver" className="size-control inline-flex items-center justify-center -ml-2 text-hint hover:text-muted rounded-full flex-shrink-0">
              <ArrowLeft size={ICONO.md} />
            </button>
            <div className="w-9 h-9 rounded-full bg-accent-light flex items-center justify-center flex-shrink-0">
              <SubjectIcon iconKey={subject?.icon} size={ICONO.md} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-xl font-bold text-on-surface truncate min-w-0">
                  {subjectDisplayName(subject)}
                  {/* Fechas solo en la web de ESCRITORIO: en la app y en el
                      teléfono (web) el renglón es angosto y el rango cortaba
                      el nombre de la asignatura, que es lo que hay que leer. */}
                  {!IS_NATIVE_APP && !telefonoWeb.telefono && subject?.fechaInicio && subject?.fechaFin && (
                    <span className="text-xs font-medium text-hint ml-1.5 tabular-nums align-middle">
                      ({formatShortDateRange(subject.fechaInicio, subject.fechaFin)})
                    </span>
                  )}
                </h1>
                {subject?.archived && (
                  <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full flex-shrink-0">Archivada</span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons — UNA sola fila plana con flex-wrap, sin grupos
              anidados: cada intento de agrupar visualmente "izquierda" y
              "derecha" (spacer flex-1, flex-shrink-0, basis-full, w-max,
              incluso dos layouts hidden/flex separados) fallaba en algún
              ancho de pantalla por una ambigüedad de flexbox anidado — un div
              que es a la vez flex-item de la fila exterior Y flex-container
              con su propio wrap terminaba encogiéndose por debajo de su
              contenido real (o reportando un scrollWidth "fantasma"),
              desbordando toda la página. Con los botones como hijos PLANOS de
              un solo flex-wrap no hay nada anidado que ambigüe: el navegador
              envuelve la fila en tantos renglones como haga falta, en
              cualquier ancho, sin excepción. Se pierde el espacio extra entre
              el grupo de "compartir" y el de "administrar", pero la fila
              nunca vuelve a desbordar la página. */}
          {/* SIN overflow-hidden: los tooltips de estos botones se dibujan
              ARRIBA del botón, o sea fuera de esta caja, y con overflow-hidden
              quedaban recortados — invisibles. Antes no se notaba porque la
              fila traía dos botones más (QR y link) y se partía en dos
              renglones: los del segundo sí tenían espacio arriba, dentro de la
              caja. Al quedar todo en un renglón se recortaron todos.
              Quitarlo es seguro para el desbordamiento que arreglaba el #499:
              lo que de verdad lo resolvió fue que estos botones sean hijos
              PLANOS de un solo flex-wrap (ver el comentario de arriba), no el
              recorte. */}
          <div className="flex flex-wrap items-center gap-1 mt-2">
            {subjectHeaderLeftIcons}
            {subjectHeaderRightIcons}
          </div>

          {/* Tabs — Calificaciones/Estudiantes solo en la web; Asistencia en ambos
              (en nativo va entre Actividades y Recursos, único hueco disponible). */}
          {/* overflow-x-auto + sin flex-1 forzado en móvil (mismo patrón que
              la barra de pestañas del alumno): 5 pestañas a ancho igual no
              caben legibles en 375px ("Calificaciones"/"Estudiantes" se
              recortaban), forzando overflow de TODA la página en vez de solo
              esta fila. sm:flex-1 restaura el ancho igual de siempre en
              escritorio, donde sí caben cómodas. */}
          <div className="relative">
            {/* Tres cabeceras (oct-2026): Actividades · Estudiantes · Clase. Cada
                cabecera con más de una sección muestra su submenú debajo. Las
                pestañas internas (activeTab) no cambian: solo se agrupan. Qué
                sección cabe en cada plataforma sigue igual (sin Calificaciones
                en el teléfono ni en la app; sin Planeación en el teléfono web). */}
            <div data-esq="subj-doc-pestanas" ref={tabsScrollRef} className="relative flex gap-1 mt-2 bg-surface-container p-1 rounded-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Secciones de la asignatura">
              {pildoraGrupo && (
                <span aria-hidden="true"
                  className={`absolute top-1 bottom-1 left-0 rounded-full bg-surface-card shadow-card ${animarPildora ? 'transition-[transform,width] duration-estandar ease-firma motion-reduce:transition-none' : ''}`}
                  style={{ transform: `translateX(${pildoraGrupo.x}px)`, width: pildoraGrupo.w }} />
              )}
              {gruposVisibles.map((g) => {
                const activo = g.tabs.includes(activeTab)
                const atencion = g.tabs.some((t) => atencionPestanas[t])
                const motivo = g.tabs.map((t) => atencionPestanas[t]).find(Boolean)
                return (
                  <button data-esq="subj-doc-pestana" type="button" key={g.id} ref={(el) => { botonesGrupo.current[g.id] = el }} role="tab" aria-selected={activo}
                    onClick={() => switchTab(activo ? activeTab : (ultimaDeGrupo.current[g.id] && g.tabs.includes(ultimaDeGrupo.current[g.id]) ? ultimaDeGrupo.current[g.id] : g.tabs[0]))}
                    data-tooltip={motivo || undefined}
                    className={`relative flex-1 whitespace-nowrap px-3 h-[calc(var(--control)-0.5rem)] text-sm font-medium rounded-full transition-colors ${
                      activo ? '' : 'hover:bg-[var(--accent-medium)]'
                    } ${
                      atencion
                        ? (activo ? 'text-red-700 font-semibold' : 'text-red-700 font-semibold bg-red-50')
                        : activo ? 'text-on-surface' : 'text-muted'
                    }`}>
                    <span className="inline-flex items-center justify-center gap-1.5">
                      {atencion && <span aria-hidden="true" className="w-2 h-2 rounded-full bg-red-600 flex-shrink-0 animate-atencion motion-reduce:animate-none" />}
                      {g.label}
                    </span>
                    {atencion && <span className="sr-only">: requiere atención. {motivo}</span>}
                  </button>
                )
              })}
            </div>
            {/* Submenú de la cabecera activa (si tiene más de una sección) */}
            {grupoActivo && grupoActivo.tabs.length > 1 && (
              <div className="flex justify-center gap-1 mt-2 animate-aparece motion-reduce:animate-none" role="tablist" aria-label={`Secciones de ${grupoActivo.label}`}>
                {grupoActivo.tabs.map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={activeTab === t} onClick={() => switchTab(t)}
                    data-tooltip={atencionPestanas[t] || undefined}
                    className={`h-control-sm px-4 text-sm font-medium rounded-full transition-colors ${
                      activeTab === t
                        ? (atencionPestanas[t] ? 'bg-red-600 text-white' : 'bg-accent text-white')
                        : atencionPestanas[t] ? 'text-red-700 font-semibold bg-red-50 hover:bg-red-100' : 'text-muted hover:bg-[var(--accent-tint)]'
                    }`}>
                    {ETIQUETA_SECCION[t]}
                    {atencionPestanas[t] && <span className="sr-only">: requiere atención. {atencionPestanas[t]}</span>}
                  </button>
                ))}
              </div>
            )}
            {/* Desvanecido + flecha: mismo indicio que la barra del alumno,
                solo aparece si de verdad hay pestañas fuera de vista y
                desaparece en cuanto el docente ya deslizó hasta el final. */}
            {tabsOverflow && (
              <div className="absolute right-0 top-2 bottom-0 flex items-center pointer-events-none bg-gradient-to-l from-surface-container via-surface-container to-transparent pl-6 pr-1 rounded-full">
                <ChevronRight size={ICONO.sm} className="text-accent animate-pulse" />
              </div>
            )}
          </div>
          {/* Aviso simple y permanente (no solo cuando no hay estudiantes,
              ver arriba) de por qué Calificaciones no aparece en la App —
              pedido explícito: es un área compleja para usar en móvil,
              mejor decirlo claro que dejarla sin explicación. Estudiantes sí
              aparece en la App, pero en versión simplificada (ver abajo). */}
          {IS_NATIVE_APP && (
            <p className="text-[11px] text-muted mt-1.5 text-center">
              Para ver Calificaciones, usa la web.
            </p>
          )}
          </div>
        </div>
        </div>

        {/* key=activeTab: cada sección entra con un fundido (solo opacidad). */}
        <div key={activeTab} className={`${anchoSeccion} animate-pagina motion-reduce:animate-none`}>

        {/* ══════════════════════════════════════════════════════════
            TAB: ACTIVIDADES
        ══════════════════════════════════════════════════════════ */}
        <TabActividades />

        {/* ══════════════════════════════════════════════════════════
            TAB: CALIFICACIONES
        ══════════════════════════════════════════════════════════ */}
        <TabCalificaciones />

      {/* ══════════════════════════════════════════════════════════
          TAB: ASISTENCIA
      ══════════════════════════════════════════════════════════ */}
      <TabAsistencia />

      {/* Agregar día de asistencia — el nº de sesiones crea esa misma cantidad
          de columnas (una asistencia por sesión de clase). */}
      {showAddAttendance && (
        <div className={`fixed inset-0 z-pantalla flex justify-center px-4 ${modalAsistenciaHorizontal ? 'items-start pt-1' : 'items-center'}`}>
          <button type="button" className="absolute inset-0 bg-black/40 animate-velo border-none cursor-default" onClick={() => setShowAddAttendance(false)} aria-label="Cerrar" />
          <form onSubmit={handleCreateAttendanceDay} className={`relative bg-surface-card rounded-card shadow-2xl w-full ${modalAsistenciaHorizontal ? 'max-w-3xl p-3 space-y-2' : 'max-w-sm p-4 space-y-3'}`}>
            <h3 className={`font-semibold text-on-surface ${modalAsistenciaHorizontal ? 'text-sm' : 'text-base'}`}>Agregar día de asistencia</h3>
            {/* En la app (y en el teléfono horizontal, web): campos en fila y
                modal pegado arriba, así el calendario del selector de día tiene
                espacio para abrirse sin recortarse. */}
            <div className={modalAsistenciaHorizontal ? 'flex items-start gap-3' : 'space-y-3'}>
              <div className={modalAsistenciaHorizontal ? 'flex-1 min-w-0' : undefined}>
                <Select
                  id="att-parcial"
                  label="Parcial"
                  value={newAttendanceForm.parcial}
                  onChange={(v) => setNewAttendanceForm((f) => ({ ...f, parcial: v }))}
                  options={PARCIALES.map((p) => ({ value: p, label: `Parcial ${p}` }))}
                />
              </div>
              <div className={modalAsistenciaHorizontal ? 'flex-1 min-w-0' : undefined}>
                <label htmlFor="att-fecha" className="block text-sm font-medium text-muted mb-1">Día</label>
                <EFDateTimePicker mode="date" value={newAttendanceForm.fecha}
                  onChange={(v) => setNewAttendanceForm((f) => ({ ...f, fecha: v }))}
                  etiqueta="Elige el día" clearable={false}
                  shortcutLabels={modalAsistenciaHorizontal ? ['Hoy', 'Mañana', 'Pasado mañana'] : undefined} />
              </div>
              <div className={modalAsistenciaHorizontal ? 'flex-1 min-w-0' : undefined}>
                <Select
                  id="att-sesiones"
                  label="Número de sesiones"
                  value={newAttendanceForm.duracion}
                  onChange={(v) => setNewAttendanceForm((f) => ({ ...f, duracion: v }))}
                  options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: `${n} ${n !== 1 ? 'sesiones' : 'sesión'} (${n} asistencia${n !== 1 ? 's' : ''})` }))}
                />
              </div>
            </div>
            {/* Se avisa al elegir el día, no al intentar guardar: enterarse
                después de darle a "Agregar" obliga a volver a empezar. */}
            {avisoSinClase && (
              <div className="rounded-card border border-amber-200 bg-amber-50 p-2.5 flex items-start gap-2">
                <AlertTriangle size={ICONO.sm} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">{avisoSinClase}</p>
              </div>
            )}
            {!avisoSinClase && avisoAsueto && (
              <div className="rounded-card border border-amber-200 bg-amber-50 p-2.5 flex items-start gap-2">
                <AlertTriangle size={ICONO.sm} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  Ese día lo marcaste como {avisoAsueto === 'asueto' ? 'día de asueto' : 'periodo vacacional'} — si hubo clase de reposición, puedes seguir y agregarlo de todas formas.
                </p>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1" onClick={() => setShowAddAttendance(false)}>
                Cancelar
              </Button>
              <Button icon={CalendarPlus} busy={savingAttendance} className="flex-1" type="submit" disabled={savingAttendance || !newAttendanceForm.fecha || !!avisoSinClase}>
                 Agregar
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Restaurar día(s) de asistencia borrados — solo aparece cuando el
          curso ya tiene fechas (todo automático) y hay días que el docente
          quitó pero siguen siendo válidos según el horario. */}
      {showRestoreAttendance && (
        <Modal open onClose={() => setShowRestoreAttendance(false)} variant="centered" z={80} padding="p-4" ariaLabel="Restaurar día de asistencia">
            <h3 className="text-base font-semibold text-on-surface mb-1">Restaurar día de asistencia</h3>
            <p className="text-sm text-muted mb-3">
              Estos días se generan solos según el horario y las fechas del curso — los borraste antes, pero siguen siendo válidos. Elige cuál restaurar.
            </p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {attendanceMissingAutoDias.map((dia) => {
                const { dia: d, mes, anio } = fmtAttDateParts(dia.fecha)
                return (
                  <Button variant="secondary" fullWidth className="justify-between min-h-control-sm" key={dia.fecha} onClick={() => handleRestoreAttendanceDay(dia)}
                    disabled={restoringFecha === dia.fecha}>
                    <span>{d}/{mes}/{anio} — Parcial {dia.parcial}</span>
                    {restoringFecha === dia.fecha ? <Spinner size="sm" /> : <CalendarPlus size={ICONO.sm} className="text-accent" />}
                  </Button>
                )
              })}
            </div>
            <button type="button" onClick={() => setShowRestoreAttendance(false)}
              className="w-full mt-3 py-2.5 rounded-card border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors">
              Cerrar
            </button>
          </Modal>
      )}

      {/* Confirmar borrado de un día completo (todas sus horas/slots) */}
      {deleteAttendanceConfirm && (
        <Modal open onClose={() => setDeleteAttendanceConfirm(null)} variant="centered" z={80} padding="p-4" ariaLabel="¿Eliminar este día de asistencia?">
            <h3 className="text-base font-semibold text-on-surface mb-2">¿Eliminar este día de asistencia?</h3>
            <p className="text-sm text-muted mb-4">
              Se borrará permanentemente la asistencia del{' '}
              <strong>{(() => { const { dia, mes, anio } = fmtAttDateParts(deleteAttendanceConfirm.fecha); return `${dia}/${mes}/${anio}` })()}</strong>
              {' '}y todas sus horas. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDeleteAttendanceConfirm(null)}
                className="flex-1 py-2.5 rounded-card border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors">
                Cancelar
              </button>
              <Button variant="danger" icon={Trash2} iconEffect="balanceo" busy={deletingAttendance} className="flex-1" onClick={handleDeleteAttendanceDay} disabled={deletingAttendance}>
                 Eliminar
              </Button>
            </div>
          </Modal>
      )}

      {/* Motivo de la justificación — se abre con un clic/toque más sobre una
          celda ya en "J" (mismo camino sin motivo o con motivo ya puesto).
          Cancelar: si no tenía motivo, completa el ciclo y vuelve a Presente;
          si ya tenía motivo (se estaba revisando/editando), no toca nada,
          se queda en Justificada con su motivo. Igual en web y app. En la
          app va ANCHO y pegado arriba para seguir usable con el teclado (que
          en horizontal tapa la mitad inferior). */}
      {/* Menú, observación y bitácora — las cuatro experiencias del docente.
          Sobre la capa de pantalla completa de Asistencias (app y teléfono
          web, z-menu) los modales necesitan ir más arriba. */}
      <>
        <MenuContextualAsistencia menu={menuAsistencia} onClose={cerrarMenuAsistencia} />
        {bitacoraStudent && (
          <BitacoraObservacionesModal
            estudiante={studentFullName(bitacoraStudent)}
            asignatura={subjectDisplayName(subject)}
            docente={membrete.docente}
            filas={bitacoraFilas}
            onEditar={editarDesdeBitacora}
            onImprimir={imprimirBitacoraActual}
            // El WebView de Android no abre el diálogo de impresión del
            // sistema: en la app el botón no se muestra (en web sigue igual).
            mostrarImprimir={!IS_NATIVE_APP}
            // Con la observación abierta encima, Esc cierra solo esa ventana.
            onClose={() => { if (!observacionModal) setBitacoraStudent(null) }}
            z={modalesSobreCapaCompleta ? 90 : 50}
          />
        )}
        {observacionModal && (
          <ObservacionModal
            key={observacionModal.id}
            estudiante={studentFullName(observacionModal.student)}
            fecha={observacionModal.fecha}
            original={observacionModal.original}
            onGuardar={guardarObservacion}
            onClose={() => setObservacionModal(null)}
            z={modalesSobreCapaCompleta ? (observacionModal.sobreBitacora ? 110 : 90) : (observacionModal.sobreBitacora ? 60 : 50)}
          />
        )}
      </>
      {reasonModal && (
        <div className={`fixed inset-0 z-pantalla flex justify-center ${modalAsistenciaHorizontal ? 'items-start safe-top px-2' : 'items-center px-4'}`}>
          <button type="button" className="absolute inset-0 bg-black/40 animate-velo border-none cursor-default" onClick={cancelReasonModal} aria-label="Cerrar" />
          <div className={`relative bg-surface-card rounded-card shadow-2xl w-full ${modalAsistenciaHorizontal ? 'max-w-none p-3 space-y-1.5' : 'max-w-lg p-5 space-y-4'}`}>
            {modalAsistenciaHorizontal ? null : (
              // Web: nombre del estudiante en su propio renglón (evita truncar
              // nombres largos) y textos más grandes que en la app, donde el
              // modal comparte columna angosta con el teclado en horizontal.
              <div>
                <h3 className="text-lg font-bold text-on-surface">Justificar falta</h3>
                <p className="text-sm text-muted mt-0.5">
                  {reasonModal.studentName} ·{' '}
                  {(() => { const { dia, mes, anio } = fmtAttDateParts(reasonModal.fecha); return `${dia}/${mes}/${anio}` })()}
                </p>
              </div>
            )}
            {modalAsistenciaHorizontal ? (
              /* App horizontal: columna izquierda (título + nombre a la
                 izquierda, motivos rápidos, motivo) y columna derecha con los
                 3 botones apilados — Guardar / Asistencia / Salir. El nombre
                 va pegado a la izquierda para dejarle ese espacio a los
                 botones (pedido explícito). */
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-base font-semibold text-on-surface whitespace-nowrap">Justificar falta</h3>
                    <p className="text-sm text-muted truncate">
                      {reasonModal.studentName} ·{' '}
                      {(() => { const { dia, mes, anio } = fmtAttDateParts(reasonModal.fecha); return `${dia}/${mes}/${anio}` })()}
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-64 flex-none">
                      <p className="text-[9px] font-medium text-muted mb-1">Motivo rápido</p>
                      {quickMotivoButtons}
                    </div>
                    <div className="flex-1 min-w-0">
                      <label htmlFor="att-motivo" className="block text-[9px] font-medium text-muted mb-1">Motivo ✍️</label>
                      <textarea id="att-motivo" value={reasonText} rows={2}
                        onChange={(e) => setReasonText(e.target.value)}
                        className="w-full px-3 py-2 rounded-card border border-outline-variant text-sm bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none" />
                    </div>
                  </div>
                </div>
                <div className="w-32 flex-none flex flex-col gap-2">
                  <button type="button" onClick={handleSaveReason}
                    disabled={reasonText.trim() === (reasonModal.original || '').trim()}
                    className="min-h-control py-2 rounded-full bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
                    Guardar
                  </button>
                  <button type="button" onClick={markPresenteFromModal}
                    className="min-h-control py-2 rounded-full bg-green-700 text-white text-sm font-semibold hover:bg-green-800 transition-colors flex items-center justify-center gap-1">
                    <CheckIcon size={ICONO.sm} /> Asistencia
                  </button>
                  <button type="button" onClick={closeReasonModal}
                    className="min-h-control py-2 rounded-full border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors">
                    Salir
                  </button>
                </div>
              </div>
            ) : (
              /* Web: vertical — motivos rápidos, luego caja de motivo, luego acciones */
              <>
                <div>
                  <p className="text-sm font-medium text-muted mb-1.5">Motivo rápido</p>
                  {quickMotivoButtonsLg}
                </div>
                <div>
                  <label htmlFor="att-motivo" className="block text-sm font-medium text-muted mb-1.5">Motivo ✍️</label>
                  <textarea id="att-motivo" value={reasonText} rows={3}
                    onChange={(e) => setReasonText(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-card border border-outline-variant text-base bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none" />
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={closeReasonModal}
                    className="flex-1 min-h-control py-2.5 rounded-full border border-outline-variant text-muted text-base font-semibold hover:bg-[var(--accent-tint)] transition-colors">
                    Salir
                  </button>
                  <button type="button" onClick={markPresenteFromModal}
                    className="flex-1 min-h-control py-2.5 rounded-full bg-green-700 text-white text-base font-semibold hover:bg-green-800 transition-colors flex items-center justify-center gap-1.5">
                    <CheckIcon size={ICONO.sm} /> Asistencia
                  </button>
                  <button type="button" onClick={handleSaveReason}
                    disabled={reasonText.trim() === (reasonModal.original || '').trim()}
                    className="flex-1 min-h-control py-2.5 rounded-full bg-amber-700 text-white text-base font-semibold hover:bg-amber-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
                    Guardar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: ALUMNOS
      ══════════════════════════════════════════════════════════ */}
      <TabLista />

      {/* ══════════════════════════════════════════════════════════
          TAB: RECURSOS
      ══════════════════════════════════════════════════════════ */}
      <TabRecursos />

      {/* ══════════════════════════════════════════════════════════
          TAB: AVISOS
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'avisos' && (
        <div>
          <AvisosTab
            subjectId={subjectId}
            docenteId={currentUser.uid}
            canCreate={canCreate && totalStudents > 0}
            blockedTooltip={!canCreate ? 'Necesitas Créditos IA para publicar avisos' : 'Necesitas al menos un estudiante inscrito para publicar un aviso'}
            onBlockedCreate={() => toast(
              !canCreate
                ? 'Necesitas Créditos IA para publicar avisos'
                : 'Necesitas al menos un estudiante inscrito para publicar un aviso',
              'error'
            )}
          />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: PLANEACIÓN DIDÁCTICA — programa de estudios (obligatorio),
          la planeación vigente con sus dos caminos, y los insumos de IA.
          La clave interna sigue siendo 'asistente-ia': renombrarla no
          aportaría nada y sí rompería cualquier enlace guardado.
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'asistente-ia' && (
        // Mismo margen que las demás pestañas: bordes alineados con el encabezado.
        <div className="px-4 py-2">
          <PlaneacionDidacticaTab
            subjectId={subjectId}
            docenteId={currentUser.uid}
            asignaturaNombre={subject?.nombre || ''}
            subject={subject}
            perfilIACompleto={perfilIACompleto}
            existingActivitiesCountP1={activities.filter((a) => a.parcial === 1).length}
          />
        </div>
      )}
      </div>

      <ModalesAsignatura />
      </div>

      <EditoresAsignatura />
    </>
    </ContextoAsignatura.Provider>
  )
}
