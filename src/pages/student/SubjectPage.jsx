import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { isActivityPublished, formatPublishAt, formatDeadline, isOverdue, isDraftActivity, cuentaParaCalificacion } from '../../utils/activityVisibility'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import { getEnrollmentForSubject } from '../../utils/studentLookup'
import { fetchContent } from '../../utils/apiContent'
import { getResourceIcon, getLinkResourceIcon } from '../../utils/resourceTypes'
import { formatFileSize } from '../../utils/formatBytes'
import { teacherDisplayName } from '../../utils/studentSearch'
import { buildJobsForStudent, downloadSubmissionsZip } from '../../utils/downloadSubmissions'
import { IS_NATIVE_APP } from '../../utils/platform'
import SubjectIcon from '../../components/SubjectIcon'
import AttachmentList from '../../components/AttachmentList'
import {
  ArrowLeft, ChevronDown, ChevronUp,
  Clock, Star, FolderOpen, BookOpen, Paperclip,
  GraduationCap, ListChecks, FileText, ClipboardCheck, ExternalLink, Download, Megaphone,
  CheckCircle2, Circle, Bookmark, ChevronRight, Trash2, LogOut, MoreVertical, RotateCcw, Sparkles,
} from 'lucide-react'
import { sanitizeHtml, richTextContentClass } from '../../utils/sanitizeHtml'
import StudentLayout from '../../components/StudentLayout'
import { promedioParcial, ponderacionActivaEnParcial, normalizeGrade } from '../../utils/ponderacion'
import { STUDENT_CONTAINER } from '../../config/layout'
import { useBackHandler } from '../../hooks/useBackHandler'
import { avisoEmoji, formatAvisoFecha, guardadoDocId, ocultoDocId, avisosDesde } from '../../utils/avisos'
import Table from '../../components/ui/Table'

// Builds a unified ordered list of activities + positioned materials for one
// parcial, mirroring the teacher view so both render in the same order.
// Activities sit at integer `orden` slots; materials with ordenManual:true
// occupy fractional slots between them; unpositioned materials go at the end.
function buildUnifiedParcial(acts, mats) {
  const positioned = mats.filter((m) => m.ordenManual)
  const unpositioned = mats
    .filter((m) => !m.ordenManual)
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))

  const items = [
    ...acts.map((a) => ({ type: 'activity', item: a })),
    ...positioned.map((m) => ({ type: 'material', item: m })),
  ].sort((a, b) => {
    const ka = a.item.orden ?? 0, kb = b.item.orden ?? 0
    if (ka !== kb) return ka - kb
    return a.type === 'activity' ? -1 : 1
  })

  return [...items, ...unpositioned.map((m) => ({ type: 'material', item: m }))]
}

function ResourceCard({ resource: r }) {
  const isLink = r.tipo === 'link'
  const { icon: Icon, color } = isLink ? getLinkResourceIcon(r.url) : getResourceIcon(r.nombreArchivo || r.nombre || '')
  return (
    <div className="border border-outline-variant rounded">
      <div className="flex items-start gap-3 px-3 py-2.5">
        <Icon size={22} className={`flex-shrink-0 mt-0.5 ${color}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-on-surface">{r.nombre}</p>
          {r.descripcion && (
            <p className="text-xs text-slate-500 mt-0.5">{r.descripcion}</p>
          )}
          <p className="text-xs text-slate-400 mt-0.5">
            {isLink ? 'Enlace · ' : (r.tamano != null ? formatFileSize(r.tamano) + ' · ' : '')}
            {formatResourceDate(r.fechaPublicacion)}
          </p>
        </div>
      </div>
      {isLink ? (
        <div className="px-3 pb-2.5">
          <a href={r.url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-accent font-medium hover:underline">
            Abrir enlace <ExternalLink size={14} />
          </a>
        </div>
      ) : (
        <div className="px-3 pb-2">
          <AttachmentList
            files={[{ url: r.url, nombre: r.nombreArchivo || r.nombre, tamano: r.tamano }]}
            title={null}
          />
        </div>
      )}
    </div>
  )
}

function formatResourceDate(ts) {
  if (!ts?.toDate) return ''
  return ts.toDate().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

const TABS = ['Actividades y calificaciones', 'Asistencias', 'Recursos', 'Avisos']



// 'actividad'/'tarea' are legacy categoria values from before they were
// merged into a single "Entregable" option — still mapped here so old
// activities keep showing a correct label without needing a data migration.
const CATEGORIA_LABELS = { actividad: 'Entregable', tarea: 'Entregable', entregable: 'Entregable', cuestionario: 'Cuestionario', examen: 'Examen', observacion: 'Observación', juego: 'Juego' }

export default function StudentSubjectPage() {
  const { subjectId } = useParams()
  const { currentUser, userProfile } = useAuth()
  const [subject, setSubject] = useState(null)
  // El id de ESTA inscripción — es la llave con la que `activity.extensiones`
  // guarda las prórrogas individuales. Sin guardarlo, la lista de abajo no
  // tenía forma de saber si ESTE alumno tiene una prórroga vigente.
  const [studentId, setStudentId] = useState(null)
  // Segundos (epoch) desde que el docente dio de alta al alumno en esta
  // asignatura — un aviso publicado antes de esa fecha no le corresponde,
  // aunque siga activo. `null` mientras no se sabe aún (no filtra).
  const [enrollmentSince, setEnrollmentSince] = useState(null)
  const [activities, setActivities] = useState([])
  const [activityLabels, setActivityLabels] = useState({})
  const [submissions, setSubmissions] = useState({})
  const [resources, setResources] = useState([])
  const [materials, setMaterials] = useState([])
  const [avisos, setAvisos] = useState([])
  const [avisosReady, setAvisosReady] = useState(false)
  const [lecturas, setLecturas] = useState({}) // { [avisoId]: true }
  const [lecturasReady, setLecturasReady] = useState(false)
  const [avisosGuardados, setAvisosGuardados] = useState({}) // { [avisoId]: true }
  const [avisosOcultos, setAvisosOcultos] = useState({}) // { [avisoId]: true } — "eliminados" del lado del alumno
  const [soloAvisosGuardados, setSoloAvisosGuardados] = useState(false)
  const [deleteAvisoConfirm, setDeleteAvisoConfirm] = useState(null) // el aviso que se está por eliminar
  const [deletingAviso, setDeletingAviso] = useState(false)
  const [attendanceSummary, setAttendanceSummary] = useState(null)
  const [umbralInasistencia, setUmbralInasistencia] = useState(20)
  const [teacherName, setTeacherName] = useState('')
  const [teacherPhoto, setTeacherPhoto] = useState(null)
  const [openParcial, setOpenParcial] = useState(1)
  const routerLocation = useLocation()
  const [activeTab, setActiveTab] = useState(routerLocation.state?.tab || 'Actividades y calificaciones')
  // Pista de que la barra de pestañas se puede deslizar — con 4 pestañas y
  // "Actividades y calificaciones" de nombre largo, en un celular angosto
  // "Avisos" queda cortado fuera de la vista sin ningún indicio de que hay
  // más a la derecha (pedido explícito: el estudiante no se daba cuenta).
  const tabsScrollRef = useRef(null)
  const [tabsOverflow, setTabsOverflow] = useState(false)
  // Descarga de sus propias entregas — su trabajo es suyo y debe poder
  // llevárselo sin depender de que su maestro se lo pase.
  const [zipping, setZipping] = useState(false)
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const toast = useToast()
  const goBack = () => navigate('/alumno/dashboard')
  useBackHandler(goBack)

  // Suscripciones en tiempo real — se cancelan al desmontar o al cambiar de asignatura.
  const attSummaryUnsubRef = useRef(null)
  const subjectTotalUnsubRef = useRef(null)

  // Listener en tiempo real para el resumen de asistencias del alumno.
  useEffect(() => {
    if (!studentId) return
    attSummaryUnsubRef.current?.()
    attSummaryUnsubRef.current = onSnapshot(
      doc(db, 'attendanceSummaries', studentId),
      (snap) => setAttendanceSummary(snap.exists() ? snap.data() : null),
      () => {},
    )
    return () => { attSummaryUnsubRef.current?.(); attSummaryUnsubRef.current = null }
  }, [studentId])

  // Listener en tiempo real para campos de denominador y cierre de parciales.
  useEffect(() => {
    if (!subjectId) return
    subjectTotalUnsubRef.current?.()
    subjectTotalUnsubRef.current = onSnapshot(
      doc(db, 'subjects', subjectId),
      (snap) => {
        if (!snap.exists()) return
        const d = snap.data()
        setSubject((prev) => prev ? {
          ...prev,
          totalOficialPorParcial: d.totalOficialPorParcial ?? null,
          sesionesPorParcialEstimadas: d.sesionesPorParcialEstimadas ?? null,
          parcialesCerrados: d.parcialesCerrados ?? null,
        } : prev)
      },
      () => {},
    )
    return () => { subjectTotalUnsubRef.current?.(); subjectTotalUnsubRef.current = null }
  }, [subjectId])

  // Umbral institucional de inasistencia — lectura única al montar.
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

  // "Salir de esta asignatura" — mismo ocultamiento de siempre (ocultaPorAlumno,
  // ver Dashboard.jsx), no borra nada: el docente sigue viendo al alumno igual
  // en su lista, con sus entregas/faltas tal cual. Pedido explícito: si tiene
  // actividades entregables pendientes, se advierte antes de dejarlo salir.
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [showSubjectMenu, setShowSubjectMenu] = useState(false)
  useBackHandler(() => setShowLeaveConfirm(false), showLeaveConfirm)
  useBackHandler(() => setShowSubjectMenu(false), showSubjectMenu)

  const pendingActivitiesCount = activities.filter((a) => {
    if (isDraftActivity(a) || !isActivityPublished(a, (subject?.parcialesOcultos || []).includes(a.parcial))) return false
    if (a.categoria === 'observacion') return false // no la entrega el alumno, la captura el docente
    return !submissions[a.id]
  }).length

  async function handleLeaveSubject() {
    if (!studentId) return
    setLeaving(true)
    try {
      await updateDoc(doc(db, 'students', studentId), { ocultaPorAlumno: true, ocultaPorAlumnoAt: serverTimestamp() })
      toast('Saliste de esta asignatura')
      navigate('/alumno/dashboard')
    } catch (err) {
      toast('No se pudo salir: ' + err.message, 'error')
      setLeaving(false)
    }
  }

  useEffect(() => {
    // `currentUser` can still be null on first mount while Firebase Auth restores the
    // session (most visible in incognito/fresh sessions, no cached auth state) — firing
    // the Firestore query before then gets rejected by security rules and, since this
    // effect didn't depend on `currentUser`, never retried once auth was ready.
    if (currentUser) loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only intencional
  }, [subjectId, currentUser])

  // Avisos — carga inicial + sondeo cada 60 s (F-09: ya no hay onSnapshot
  // directo a Firestore; el servidor verifica la inscripción del alumno).
  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reinicia el gate de "listo" al cambiar de asignatura, antes de suscribirse
    setAvisosReady(false)

    async function loadAvisos() {
      try {
        const avs = await fetchContent(subjectId, 'avisos')
        if (cancelled) return
        setAvisos(
          avs.filter((a) => a.activo !== false)
             .sort((a, b) => (b.fechaCreacion?.seconds ?? 0) - (a.fechaCreacion?.seconds ?? 0))
        )
        setAvisosReady(true)
      } catch {
        if (!cancelled) setAvisosReady(true)
      }
    }

    loadAvisos()
    const timer = setInterval(loadAvisos, 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [subjectId, currentUser])

  // Sus propias confirmaciones de lectura — también en vivo: si confirma un
  // aviso en un dispositivo, no debe volver a pedírselo en otro donde tenga
  // la sesión abierta al mismo tiempo. Espera a `studentId` (llega de
  // loadAll) porque `avisoLecturas.estudianteId` es el id de SU inscripción,
  // no su uid de Firebase Auth.
  useEffect(() => {
    if (!studentId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reinicia el gate de "listo" al cambiar de asignatura, antes de suscribirse
    setLecturasReady(false)
    const unsub = onSnapshot(
      query(collection(db, 'avisoLecturas'), where('estudianteId', '==', studentId)),
      (snap) => {
        const map = {}
        snap.docs.forEach((d) => { map[d.data().avisoId] = true })
        setLecturas(map)
        setLecturasReady(true)
      },
      () => setLecturasReady(true)
    )
    return unsub
  }, [studentId])

  // Guardados del alumno — personal, ver avisoGuardados en firestore.rules
  // (a diferencia de avisoLecturas, sí se puede borrar: guardar es una
  // preferencia, no un registro de auditoría).
  useEffect(() => {
    if (!studentId) return undefined
    const unsub = onSnapshot(
      query(collection(db, 'avisoGuardados'), where('estudianteId', '==', studentId)),
      (snap) => {
        const map = {}
        snap.docs.forEach((d) => { map[d.data().avisoId] = true })
        setAvisosGuardados(map)
      },
      () => {}
    )
    return unsub
  }, [studentId])

  // Eliminados del lado del alumno — mismo patrón que avisoGuardados, pero
  // para ocultar en vez de guardar (ver avisoOcultos en firestore.rules). El
  // aviso real no se toca: solo deja de aparecer en la lista de ESTE alumno.
  useEffect(() => {
    if (!studentId) return undefined
    const unsub = onSnapshot(
      query(collection(db, 'avisoOcultos'), where('estudianteId', '==', studentId)),
      (snap) => {
        const map = {}
        snap.docs.forEach((d) => { map[d.data().avisoId] = true })
        setAvisosOcultos(map)
      },
      () => {}
    )
    return unsub
  }, [studentId])

  // Muestra el desvanecido/flecha solo si de verdad hay más pestañas fuera
  // de vista, y lo quita en cuanto el estudiante ya deslizó hasta el final —
  // no tiene caso seguir insistiendo una vez que ya lo descubrió.
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

  async function toggleAvisoGuardado(aviso) {
    const id = guardadoDocId(aviso.id, studentId)
    try {
      if (avisosGuardados[aviso.id]) {
        await deleteDoc(doc(db, 'avisoGuardados', id))
      } else {
        await setDoc(doc(db, 'avisoGuardados', id), {
          avisoId: aviso.id, asignaturaId: subjectId, estudianteId: studentId,
        })
      }
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  // Ver avisoOcultos en firestore.rules: no borra el aviso real (es del
  // docente, y lo comparten sus compañeros), solo marca que este alumno ya
  // no lo quiere ver — ni en Todos ni en Guardados (ver avisosVisibles).
  async function handleEliminarAviso() {
    if (!deleteAvisoConfirm) return
    setDeletingAviso(true)
    try {
      await setDoc(doc(db, 'avisoOcultos', ocultoDocId(deleteAvisoConfirm.id, studentId)), {
        avisoId: deleteAvisoConfirm.id, asignaturaId: subjectId, estudianteId: studentId,
      })
      setDeleteAvisoConfirm(null)
      toast('Aviso eliminado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setDeletingAviso(false)
    }
  }

  async function loadAll() {
    setLoading(true)
    // Default view for every subject: only the first parcial expanded. This same
    // component is reused (not remounted) when switching subjects, so reset it here.
    setOpenParcial(1)
    try {
      const [subSnap, studData] = await Promise.all([
        getDoc(doc(db, 'subjects', subjectId)),
        getEnrollmentForSubject(currentUser, userProfile, subjectId),
      ])

      // Sin inscripción no hay nada que mostrar — el endpoint de contenido
      // también deniega si no hay inscripción, pero conviene abortar antes.
      if (!studData) {
        toast('No estás inscrito en esta asignatura', 'error')
        navigate('/alumno/dashboard')
        return
      }

      // Contenido protegido: el servidor verifica inscripción (F-09)
      const [actsDocs, resDocs, matsDocs] = await Promise.all([
        fetchContent(subjectId, 'activities'),
        fetchContent(subjectId, 'resources'),
        fetchContent(subjectId, 'materials').catch(() => []),
      ])

      const subData = { id: subSnap.id, ...subSnap.data() }
      setSubject(subData)
      setStudentId(studData.id)
      setEnrollmentSince(avisosDesde(studData))

      // Fetch teacher name separately — best-effort
      if (subData.docenteId) {
        getDoc(doc(db, 'publicProfiles', subData.docenteId))
          .then((snap) => {
            if (snap.exists()) {
              const td = snap.data()
              setTeacherName(teacherDisplayName(td))
              // Ausente/true = visible (opt-out) — mismo criterio que el
              // resto de interruptores de la app, ver Profile.jsx (docente).
              if (td.mostrarFotoAlumnos !== false) setTeacherPhoto(td.photoURL || null)
            }
          })
          .catch(() => {})
      }

      const parcialesOcultos = subData.parcialesOcultos || []
      const allActs = actsDocs.slice().sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      // Same "Actividad" numbering as the teacher's view: position within the
      // parcial over ALL non-draft activities — computed before the visibility
      // filter so numbers match the teacher's even when a scheduled or hidden
      // activity isn't visible to the student yet.
      const labels = {}
      const countByParcial = {}
      allActs.filter((a) => cuentaParaCalificacion(a)).forEach((a) => {
        countByParcial[a.parcial] = (countByParcial[a.parcial] || 0) + 1
        labels[a.id] = `${a.parcial}.${countByParcial[a.parcial]}.`
      })
      setActivityLabels(labels)
      const acts = allActs
        .filter((a) => isActivityPublished(a, parcialesOcultos.includes(a.parcial)))
      setActivities(acts)

      setResources(
        resDocs.slice().sort((a, b) => (b.fechaPublicacion?.seconds ?? 0) - (a.fechaPublicacion?.seconds ?? 0))
      )
      setMaterials(
        matsDocs
          .filter((m) => isActivityPublished(m, parcialesOcultos.includes(m.parcial)))
          .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      )
      const subsSnap = await getDocs(query(collection(db, 'submissions'), where('alumnoId', '==', studData.id)))
      const actIds = new Set(acts.map((a) => a.id))
      const subsMap = {}
      subsSnap.docs.forEach((d) => {
        const data = d.data()
        if (actIds.has(data.actividadId)) subsMap[data.actividadId] = { id: d.id, ...data }
      })
      setSubmissions(subsMap)
      // attendanceSummary se carga vía onSnapshot (efecto separado) una vez que studentId queda asignado
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  function calcParcialAvg(parcial) {
    // Las actividades sin calificación (un diagnóstico, una encuesta) no entran
    // en el promedio — misma regla que la tabla del docente.
    const acts = activities.filter((a) => a.parcial === parcial && cuentaParaCalificacion(a))
    const grades = acts.map((a) => {
      const sub = submissions[a.id]
      return normalizeGrade(sub?.calificacion, a.maxCalif)
    })
    // Same math as the teacher's table — weighted when THIS parcial uses ponderación
    const avg = promedioParcial(acts, grades, ponderacionActivaEnParcial(subject, parcial))
    return avg !== null ? avg.toFixed(1) : null
  }

  // Parciales hidden by the teacher must not appear AT ALL in student views —
  // not even as an empty card (their activities are already filtered out above).
  const PARCIALES = Array.from({ length: subject?.parciales || 3 }, (_, i) => i + 1)
    .filter((p) => !(subject?.parcialesOcultos || []).includes(p))

  // Sus entregas con archivo. Se calcula aquí para poder ocultar el botón
  // cuando no hay nada que descargar: un botón que baja un ZIP vacío nomás
  // hace dudar de si funcionó.
  const misArchivos = buildJobsForStudent({ subject, activities, submissions })

  async function descargarMisEntregas() {
    setZipping(true)
    setZipProgress({ done: 0, total: misArchivos.length })
    try {
      const { escritos, errores } = await downloadSubmissionsZip({
        zipName: `Mis entregas - ${subjectDisplayName(subject)}`,
        jobs: misArchivos,
        onProgress: (done, total) => setZipProgress({ done, total }),
      })
      toast(errores
        ? `Se descargaron ${escritos} de ${escritos + errores} archivos`
        : `Listo, ${escritos} ${escritos === 1 ? 'archivo' : 'archivos'} en tu ZIP`)
    } catch (err) {
      toast('No se pudo descargar: ' + err.message, 'error')
    } finally {
      setZipping(false)
      setZipProgress({ done: 0, total: 0 })
    }
  }

  if (loading || !avisosReady || (studentId && !lecturasReady)) return (
    <StudentLayout>
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    </StudentLayout>
  )

  return (
    <StudentLayout>
    <div className="bg-surface" {...subjectPaletteProps(subject?.colorPalette)}>

      {/* Page header */}
      <header className="bg-surface-card border-b border-outline-variant px-4 py-3 flex items-center gap-3 shadow-card">
        <button
          type="button"
          aria-label="Volver"
          onClick={goBack}
          className="md:hidden p-2 -ml-2 text-slate-400 hover:text-muted rounded flex-shrink-0"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="w-9 h-9 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
          <SubjectIcon iconKey={subject?.icon} size={20} className="text-accent" />
        </div>
        <div className="min-w-0 flex items-center gap-2 flex-wrap">
          <h1 className="text-lg font-bold text-on-surface truncate">{subjectDisplayName(subject)}</h1>
          {teacherName && (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="text-slate-500 text-sm font-medium truncate">{teacherName}</span>
              {teacherPhoto && (
                <img src={teacherPhoto} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
              )}
            </span>
          )}
        </div>
        {/* Menú "···" en vez de un ícono de salida — con el mismo ícono que
            "Cerrar sesión" del sidebar se confundía con cerrar sesión.
            Pedido explícito: que quede sin ambigüedad. */}
        <div className="relative ml-auto flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowSubjectMenu((v) => !v)}
            aria-label="Más opciones de esta asignatura"
            className="p-2 text-slate-400 hover:text-on-surface hover:bg-surface-container rounded transition-colors"
          >
            <MoreVertical size={19} />
          </button>
          {showSubjectMenu && (
            <>
              <button type="button" className="fixed inset-0 z-30 bg-transparent border-none cursor-default" onClick={() => setShowSubjectMenu(false)} aria-label="Cerrar menú" />
              <div className="absolute right-0 top-10 z-40 bg-surface-card border border-outline-variant rounded-card shadow-lg py-1 w-56 text-left">
                <button
                  type="button"
                  onClick={() => { setShowSubjectMenu(false); setShowLeaveConfirm(true) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-error hover:bg-red-50 transition-colors"
                >
                  <LogOut size={16} /> Salir de esta asignatura
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Salir de la asignatura — no borra nada, solo la oculta de sus
          listas; el docente la sigue viendo igual (ver Dashboard.jsx
          handleRemoveArchived, mismo campo ocultaPorAlumno). */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !leaving && setShowLeaveConfirm(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Salir de esta asignatura?</h3>
            <p className="text-sm text-muted mb-2">
              Dejará de aparecer en tu lista de asignaturas y en tu Agenda. Tu maestro(a) sí ve que saliste, pero te sigue viendo inscrito, con tus entregas y calificaciones intactas, tal cual están ahora.
            </p>
            {pendingActivitiesCount > 0 && (
              <p className="text-sm text-amber-700 mb-2">
                Tienes <strong>{pendingActivitiesCount}</strong> {pendingActivitiesCount === 1 ? 'actividad pendiente' : 'actividades pendientes'} de entregar aquí — si sales, no te van a seguir apareciendo como pendientes hasta que regreses.
              </p>
            )}
            <p className="text-sm text-error mb-4">
              No podrás volver a entrar tú solo con el código — tendrás que pedirle a tu maestro(a) que te dé permiso de reingresar.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowLeaveConfirm(false)} disabled={leaving}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)] disabled:opacity-60">Cancelar</button>
              <button type="button" onClick={handleLeaveSubject} disabled={leaving}
                className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {leaving ? <Spinner size="sm" /> : <LogOut size={16} />}
                {leaving ? 'Saliendo…' : 'Salir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs — con 4 pestañas y nombres largos, en un celular angosto
          "Avisos" queda fuera de vista sin ningún indicio de que hay más a
          la derecha. El desvanecido + flecha avisan que se puede deslizar, y
          desaparecen solos en cuanto el estudiante ya llegó al final. */}
      <div className="relative bg-surface-card border-b border-outline-variant">
        <div ref={tabsScrollRef} className="px-4 flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-on-surface hover:bg-[var(--accent-tint)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        {tabsOverflow && (
          <div className="absolute right-0 top-0 bottom-0 flex items-center pointer-events-none bg-gradient-to-l from-surface-card via-surface-card to-transparent pl-6 pr-1">
            <ChevronRight size={16} className="text-accent animate-pulse" />
          </div>
        )}
      </div>

      {/* Tab: Actividades y calificaciones */}
      {activeTab === 'Actividades y calificaciones' && (
        <div className={`px-4 py-5 space-y-3 ${STUDENT_CONTAINER}`}>
          {PARCIALES.length === 0 && (
            <div className="bg-surface-card rounded-card border border-outline-variant p-10 text-center">
              <p className="text-muted text-sm">El docente aún no ha publicado contenido.</p>
            </div>
          )}
          {PARCIALES.map((p) => {
            const acts = activities.filter((a) => a.parcial === p)
            const mats = materials.filter((m) => m.parcial === p)
            const unified = buildUnifiedParcial(acts, mats)
            const avg = calcParcialAvg(p)
            const isOpen = openParcial === p
            return (
              <div key={p} className="bg-surface-card rounded-card overflow-hidden shadow-card">
                <button
                  type="button"
                  onClick={() => setOpenParcial(isOpen ? 0 : p)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-surface transition-colors"
                >
                  <div className="w-9 h-9 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
                    <span className="text-accent font-bold text-sm">{p}</span>
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="font-semibold text-on-surface truncate">Parcial {p}</p>
                    <p className="text-sm text-slate-500">{acts.length} actividad{acts.length !== 1 ? 'es' : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {avg != null && (
                      <span className="text-lg font-bold text-accent">{avg}</span>
                    )}
                    {isOpen ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-outline-variant pr-4 py-2">
                    <div className="ml-3 pl-3 border-l-2 border-accent space-y-1.5">
                    {unified.length === 0 && (
                      <p className="text-slate-400 text-sm text-center py-2">Sin actividades</p>
                    )}
                    {unified.map(({ type, item }) => {
                      if (type === 'activity') {
                        const a = item
                        const sub = submissions[a.id]
                        const graded = sub?.calificacion != null
                        const delivered = sub && !graded
                        // Prórroga individual de ESTE alumno: solo cuenta si la
                        // actividad tiene fecha límite propia (misma regla que
                        // ActivityPage.jsx — una prórroga no inventa un plazo
                        // donde no había). Sin esto, un alumno con prórroga
                        // vigente veía su actividad marcada "vencida" en rojo
                        // aquí aunque su página de detalle, correctamente, la
                        // mostrara abierta.
                        const extendedDate = a.fechaLimite ? a.extensiones?.[studentId] : null
                        const displayDeadline = extendedDate || a.fechaLimite
                        const overdue = !graded && !delivered && isOverdue({ ...a, fechaLimite: displayDeadline })
                        const fechaLimiteLabel = formatDeadline(displayDeadline)
                        const showPeso = ponderacionActivaEnParcial(subject, a.parcial) && subject?.ponderacionVisibleAlumnos && a.pesoCalificacion != null
                        // Scheduled activities may only carry `publishAt` (already in the
                        // past — this list is filtered to visible ones), so that IS their
                        // publication date when `publishedAt` is absent.
                        const publishDate = a.publishedAt || a.publishAt
                        // Same icon-per-type as the teacher's list so both views read alike
                        const ActIcon = a.categoria === 'examen' ? GraduationCap
                          : a.categoria === 'cuestionario' ? ListChecks
                          : a.categoria === 'observacion' ? ClipboardCheck
                          : a.categoria === 'juego' ? Sparkles
                          : FileText
                        return (
                          <button
                            type="button"
                            key={a.id}
                            onClick={() => navigate(`/alumno/actividad/${a.id}`)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded border border-outline-variant bg-surface-card hover:border-accent hover:bg-[var(--accent-tint)] transition-colors duration-200 text-left"
                          >
                            <ActIcon size={20} className={`flex-shrink-0 ${a.categoria === 'examen' ? 'text-accent' : a.categoria === 'cuestionario' ? 'text-emerald-600' : a.categoria === 'observacion' ? 'text-amber-600' : 'text-slate-400'}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-base font-medium leading-tight text-on-surface truncate">
                                {activityLabels[a.id] && <span className="text-accent font-semibold">{activityLabels[a.id]} </span>}
                                {a.nombre}
                                <span className="text-xs font-normal text-slate-400"> ({CATEGORIA_LABELS[a.categoria] || 'Entregable'})</span>
                              </p>
                              {((!IS_NATIVE_APP && (publishDate || fechaLimiteLabel)) || showPeso) && (
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {!IS_NATIVE_APP && publishDate && (
                                    <span data-tooltip="Publicado" className="text-xs text-emerald-600 flex items-center gap-0.5">
                                      <Clock size={14} /> {formatPublishAt(publishDate)}
                                    </span>
                                  )}
                                  {!IS_NATIVE_APP && fechaLimiteLabel && (
                                    <span data-tooltip={extendedDate ? 'Cierre (con prórroga)' : 'Cierre'} className={`text-xs flex items-center gap-0.5 ${overdue ? 'text-red-500' : 'text-amber-600'}`}>
                                      <Clock size={14} /> {fechaLimiteLabel}{extendedDate && ' (extendida)'}
                                    </span>
                                  )}
                                  {showPeso && (
                                    <span className="text-xs text-amber-700 font-semibold">Vale {a.pesoCalificacion} de 10</span>
                                  )}
                                </div>
                              )}
                              {sub?.comentario && (
                                sub.comentarioVisibleAlumno !== undefined
                                  ? sub.comentarioVisibleAlumno !== false
                                  : a.comentarioVisibleAlumno !== false
                              ) && (
                                <p className="text-sm text-slate-500 leading-tight truncate mt-0.5">&ldquo;{sub.comentario}&rdquo;</p>
                              )}
                            </div>
                            <div className="flex-shrink-0 text-right">
                              {graded ? (
                                <div>
                                  <p className="text-sm font-bold text-emerald-600 flex items-center gap-0.5">
                                    <Star size={13} /> {sub.calificacion}
                                  </p>
                                  <p className="text-xs text-slate-500">/{a.maxCalif}</p>
                                </div>
                              ) : delivered ? (
                                <span className="text-xs bg-accent-light text-accent px-2 py-1 rounded-full">Entregada</span>
                              ) : overdue ? (
                                <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full">Vencida</span>
                              ) : (
                                <span className="text-xs bg-surface-container text-muted px-2 py-1 rounded-full">Pendiente</span>
                              )}
                            </div>
                          </button>
                        )
                      }
                      // type === 'material'
                      const m = item
                      return (
                        <div key={m.id} className="w-full rounded border border-outline-variant overflow-hidden">
                          <div className="flex items-center gap-3 px-3 py-2">
                            <BookOpen size={20} className="text-amber-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium leading-tight text-on-surface truncate">{m.nombre}</p>
                              <p className="text-xs text-slate-500 flex items-center gap-0.5">
                                <Paperclip size={11} /> {(m.archivos || []).length} archivo{(m.archivos || []).length !== 1 ? 's' : ''}
                              </p>
                            </div>
                          </div>
                          {m.descripcion && (
                            <div className={`px-3 pb-2 ml-9 text-sm text-slate-600 ${richTextContentClass}`}
                              dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.descripcion) }} />
                          )}
                          <div className="px-3 pb-2 ml-9">
                            <AttachmentList files={(m.archivos || []).map((f) => ({ url: f.url, nombre: f.nombre, tamano: f.tamano }))} title={null} />
                          </div>
                        </div>
                      )
                    })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Llevarse su trabajo. Va al final de la lista, no arriba: primero
              interesa ver sus calificaciones.
              Dos condiciones, las dos a propósito:
               · que haya archivos — un botón que baja un ZIP vacío nomás hace
                 dudar de si funcionó;
               · que el docente YA haya archivado la asignatura. Con el ciclo
                 abierto el alumno sigue entregando y el ZIP sería una foto a
                 medias que envejece sola. La descarga es el cierre: aparece
                 cuando el maestro cierra el ciclo, que es también cuando el
                 alumno puede quitarse la materia de sus archivadas — de ahí que
                 sea justo el momento de llevarse el trabajo completo. */}
          {subject?.archived && misArchivos.length > 0 && (
            <div className="bg-surface-card rounded-card shadow-card p-4">
              <p className="text-sm font-semibold text-on-surface mb-1">Guardar mi trabajo</p>
              <p className="text-xs text-muted mb-3 leading-relaxed">
                Tu maestro archivó esta asignatura.{' '}
                {misArchivos.length === 1
                  ? 'Descarga el archivo que entregaste.'
                  : `Descarga en un ZIP los ${misArchivos.length} archivos que entregaste, ordenados por parcial.`}
                {' '}Es tu trabajo — guárdalo donde quieras.
              </p>
              <button
                type="button"
                onClick={descargarMisEntregas}
                disabled={zipping}
                className="w-full py-2.5 rounded border border-accent text-accent text-sm font-semibold hover:bg-accent-light transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {zipping ? <Spinner size="sm" /> : <Download size={16} />}
                {zipping
                  ? `Descargando ${zipProgress.done}/${zipProgress.total}…`
                  : 'Descargar mis entregas'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab: Asistencias — una tarjeta por parcial; dentro, una fila por sesión
          (slot) agrupadas bajo su encabezado de fecha. La unidad de asistencia
          es la sesión, no el día. */}
      {activeTab === 'Asistencias' && (() => {
        const now = new Date()
        const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

        // Formatea "2025-09-08" → "Lun 8 sep"
        const fmtDia = (fecha) => {
          const d = new Date(`${fecha}T12:00:00`)
          const diaNombre = d.toLocaleDateString('es-MX', { weekday: 'short' })
          const diaNum = d.getDate()
          const mes = d.toLocaleDateString('es-MX', { month: 'short' })
          return `${diaNombre.charAt(0).toUpperCase()}${diaNombre.slice(1, 3)} ${diaNum} ${mes}`
        }

        return (
        <div className={`px-4 py-5 space-y-3 ${STUDENT_CONTAINER}`}>
          {PARCIALES.length === 0 || !attendanceSummary || attendanceSummary.total?.total === 0 ? (
            <div className="bg-surface-card rounded-card border border-outline-variant p-10 text-center">
              <p className="text-muted text-sm">Tu maestro aún no ha registrado asistencia.</p>
            </div>
          ) : (
            PARCIALES.map((p) => {
              const statCompleto = attendanceSummary.porParcial?.[String(p)]
              if (!statCompleto) return null
              // Filtrar sesiones futuras (auto-generadas como "presente") —
              // el alumno no debe verlas hasta que sucedan.
              const registrosParcial = (attendanceSummary.registros || [])
                .filter((r) => r.parcial === p && r.fecha <= todayISO)
              const stat = registrosParcial.reduce((acc, r) => {
                acc.total++
                if (r.estado === 'falta') acc.inasist++
                else { acc.asist++; if (r.estado === 'justificada') acc.justif++ }
                return acc
              }, { asist: 0, inasist: 0, justif: 0, total: 0 })
              if (stat.total === 0) return null

              // Denominador: si el parcial está cerrado usa el total oficial confirmado;
              // si no, usa la estimación calculada por el servidor (misma fuente que el docente).
              const cerrado = subject?.parcialesCerrados?.[String(p)]
              const denominador = cerrado
                ? (subject?.totalOficialPorParcial?.[String(p)] ?? null)
                : (subject?.sesionesPorParcialEstimadas?.[String(p)] ?? subject?.totalOficialPorParcial?.[String(p)] ?? null)
              const pct = (denominador != null && denominador > 0)
                ? Math.round((stat.asist / denominador) * 100)
                : null
              const pctInasist = (denominador != null && denominador > 0)
                ? Math.round((stat.inasist / denominador) * 100)
                : null
              const riesgo = pctInasist == null ? null
                : pctInasist >= umbralInasistencia ? '🔴'
                : pctInasist >= umbralInasistencia * 0.75 ? '🟠'
                : '🟢'

              const attColumns = [
                {
                  key: 'fecha',
                  header: 'Fecha',
                  render: (r) => <span className="whitespace-nowrap">{fmtDia(r.fecha)}</span>,
                },
                {
                  key: 'slot',
                  header: 'Clase',
                  render: (r) => <span className="whitespace-nowrap">Clase {r.slot ?? 1}</span>,
                },
                {
                  key: 'estado',
                  header: 'Estado',
                  render: (r) => {
                    const esPresente = r.estado === 'presente'
                    const esJustificada = r.estado === 'justificada'
                    return (
                      <span className={`inline-flex items-center gap-1 font-medium whitespace-nowrap ${esPresente ? 'text-emerald-700' : esJustificada ? 'text-amber-700' : 'text-red-600'}`}>
                        {esPresente ? '✅' : esJustificada ? '🟡' : '❌'}
                        {esPresente ? 'Presente' : esJustificada ? 'Justificada' : 'Falta'}
                      </span>
                    )
                  },
                },
                {
                  key: 'motivo',
                  header: 'Motivo',
                  render: (r) => (
                    <span className="text-slate-500 text-xs">
                      {(r.estado === 'justificada' && r.motivo) ? r.motivo : '—'}
                    </span>
                  ),
                },
              ]

              return (
                <div key={p} className="space-y-1.5">
                  {/* Encabezado del parcial */}
                  <div className="px-1 flex items-center gap-3">
                    <div className="w-9 h-9 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
                      <span className="text-accent font-bold text-sm">{p}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-on-surface">Parcial {p}</p>
                      <p className="text-xs text-slate-500">
                        {stat.asist - stat.justif} presente{stat.asist - stat.justif !== 1 ? 's' : ''} · {stat.inasist} falta{stat.inasist !== 1 ? 's' : ''}
                        {stat.justif > 0 ? ` · ${stat.justif} justificada${stat.justif !== 1 ? 's' : ''}` : ''}
                      </p>
                      {pct != null && (
                        <p className="text-xs mt-0.5">
                          {riesgo && <span className="mr-1">{riesgo}</span>}
                          <span className={`font-semibold ${pctInasist != null && pctInasist >= umbralInasistencia ? 'text-red-500' : 'text-accent'}`}>{pct}% asistencia</span>
                          {pctInasist != null && pctInasist > 0 && (
                            <span className="text-slate-400"> · {pctInasist}% inasistencia</span>
                          )}
                          {!cerrado && denominador != null && (
                            <span className="text-slate-400"> · {denominador} sesiones del periodo</span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Tabla — una fila por sesión individual, sin agrupar por fecha */}
                  <Table
                    columns={attColumns}
                    data={registrosParcial}
                    rowKey={(r) => `${r.fecha}-${r.slot ?? 1}`}
                    emptyMessage="Sin sesiones en este parcial"
                    minWidth={360}
                  />
                </div>
              )
            })
          )}
        </div>
        )
      })()}

      {/* Tab: Recursos */}
      {activeTab === 'Recursos' && (
        <div className={`px-4 py-5 ${STUDENT_CONTAINER}`}>
          {resources.length === 0 ? (
            <div className="bg-surface-card rounded-card border border-outline-variant p-10 text-center">
              <FolderOpen size={32} className="text-slate-300 mx-auto mb-3" />
              <p className="text-muted text-sm">El docente no ha compartido recursos aún.</p>
            </div>
          ) : (
            <div className="bg-surface-card rounded-card overflow-hidden shadow-card">
              <div className="px-4 py-3 flex items-center gap-2 border-b border-outline-variant">
                <FolderOpen size={18} className="text-accent flex-shrink-0" />
                <p className="font-semibold text-on-surface">Recursos de la asignatura</p>
              </div>
              <div className="px-4 py-2 space-y-2">
                {resources.map((r) => (
                  <ResourceCard key={r.id} resource={r} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Avisos — solo lectura, sin responder/comentar/reaccionar. Sí
          puede guardar los suyos, con Todos/Guardados igual que la app del
          docente: guardar "mueve" el aviso, deja de verse en Todos. */}
      {activeTab === 'Avisos' && (() => {
        // Solo avisos publicados a partir de que la asignatura quedó activa
        // para este alumno (alta o activación, lo que ocurra después — ver
        // avisosDesde): uno anterior no le corresponde. Los que el alumno
        // eliminó tampoco: ni en Todos ni en Guardados (ver avisoOcultos más
        // arriba).
        const avisosVisibles = (enrollmentSince == null
          ? avisos
          : avisos.filter((a) => (a.fechaCreacion?.seconds ?? 0) >= enrollmentSince)
        ).filter((a) => !avisosOcultos[a.id])
        const guardadosList = avisosVisibles.filter((a) => avisosGuardados[a.id])
        const avisosMostrados = soloAvisosGuardados ? guardadosList : avisosVisibles.filter((a) => !avisosGuardados[a.id])
        return (
        <div className={`px-4 py-5 ${STUDENT_CONTAINER}`}>
          <div className="flex gap-1 bg-surface-container p-1 rounded w-fit mb-3">
            <button type="button" onClick={() => setSoloAvisosGuardados(false)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${!soloAvisosGuardados ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-tint)]'}`}>
              Todos
            </button>
            <button type="button" onClick={() => setSoloAvisosGuardados(true)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${soloAvisosGuardados ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-tint)]'}`}>
              <Bookmark size={13} /> Guardados{guardadosList.length > 0 ? ` (${guardadosList.length})` : ''}
            </button>
          </div>
          {avisosMostrados.length === 0 ? (
            <div className="bg-surface-card rounded-card border border-outline-variant p-10 text-center">
              <Megaphone size={32} className="text-slate-300 mx-auto mb-3" />
              <p className="text-muted text-sm">{soloAvisosGuardados ? 'No has guardado ningún aviso.' : 'El docente no ha publicado avisos aún.'}</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {avisosMostrados.map((a) => {
                const emoji = avisoEmoji(a)
                const leido = !!lecturas[a.id]
                const guardado = !!avisosGuardados[a.id]
                return (
                  <div key={a.id} className="bg-surface-card rounded-card border border-outline-variant shadow-card px-4 py-3">
                    <div className="flex items-start gap-3">
                      <span className="text-xl leading-none flex-shrink-0 mt-0.5" aria-hidden="true">{emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-on-surface">{a.titulo}</p>
                          {leido ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                              <CheckCircle2 size={13} /> Leído
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-accent font-medium">
                              <Circle size={8} className="fill-current" /> Nuevo
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {formatAvisoFecha(a.fechaCreacion)}{teacherName ? ` · ${teacherName}` : ''}
                        </p>
                        {a.mensaje && <p className="text-sm text-on-surface mt-1.5 whitespace-pre-wrap">{a.mensaje}</p>}
                      </div>
                      <div className="flex items-center flex-shrink-0">
                        {/* Eliminar solo vive en "Guardados" — pedido
                            explícito. En "Todos" solo se ofrece Guardar; no
                            borra el aviso real (es del docente, y lo
                            comparten sus compañeros), solo lo quita de la
                            lista de este alumno (ver avisoOcultos). */}
                        {guardado ? (
                          <>
                            <button type="button" onClick={() => toggleAvisoGuardado(a)} aria-label="Regresar a Todos" data-tooltip="Regresar a Todos" data-tooltip-pos="bottom"
                              className="p-2 -m-1 rounded transition-colors text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)]">
                              <RotateCcw size={18} />
                            </button>
                            <button type="button" onClick={() => setDeleteAvisoConfirm(a)} aria-label="Eliminar" data-tooltip="Eliminar" data-tooltip-pos="bottom"
                              className="p-2 -m-1 rounded transition-colors text-slate-400 hover:text-red-500 hover:bg-red-50">
                              <Trash2 size={18} />
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => toggleAvisoGuardado(a)} aria-label="Guardar" data-tooltip="Guardar" data-tooltip-pos="bottom"
                            className="p-2 -m-1 rounded transition-colors text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)]">
                            <Bookmark size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Eliminar aviso — deja claro que es personal: el docente y los
              compañeros lo siguen viendo igual, solo desaparece de aquí. */}
          {deleteAvisoConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
              <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !deletingAviso && setDeleteAvisoConfirm(null)} aria-label="Cerrar" />
              <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
                <h3 className="text-base font-semibold text-on-surface mb-1">¿Eliminar este aviso?</h3>
                <p className="text-sm text-muted mb-4">
                  Ya no lo verás en tu lista, ni en Todos ni en Guardados. Tu docente y tus compañeros lo siguen viendo normal — esto solo lo quita de tu vista.
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setDeleteAvisoConfirm(null)} disabled={deletingAviso}
                    className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)] disabled:opacity-60">Cancelar</button>
                  <button type="button" onClick={handleEliminarAviso} disabled={deletingAviso}
                    className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
                    {deletingAviso ? <Spinner size="sm" /> : <Trash2 size={16} />}
                    {deletingAviso ? 'Eliminando…' : 'Eliminar'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        )
      })()}

    </div>
    </StudentLayout>
  )
}
