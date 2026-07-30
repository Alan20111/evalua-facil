import { useState, useEffect } from 'react'
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
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { isActivityPublished, formatPublishAt, formatDeadline, isOverdue, isDraftActivity } from '../../utils/activityVisibility'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import { getEnrollmentForSubject } from '../../utils/studentLookup'
import { fmtAttMonth } from '../../utils/attendance'
import { toDateStr } from '../../utils/horarioBloques'
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
  CheckCircle2, Circle, Bookmark,
} from 'lucide-react'
import { sanitizeHtml, richTextContentClass } from '../../utils/sanitizeHtml'
import StudentLayout from '../../components/StudentLayout'
import { promedioParcial, ponderacionActivaEnParcial, normalizeGrade } from '../../utils/ponderacion'
import { STUDENT_CONTAINER } from '../../config/layout'
import { useBackHandler } from '../../hooks/useBackHandler'
import { avisoEmoji, formatAvisoFecha, guardadoDocId } from '../../utils/avisos'

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

const DIAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

// Arma TODAS las fechas (lunes a domingo) entre la primera y la última fecha
// con registro, para dibujar la cuadrícula semanal — pedido explícito: un
// renglón por semana con encabezado L-D, en blanco cuando no hubo clase ese
// día (el caso típico es sábado/domingo, pero aplica a cualquier día sin
// registro). Al ser un solo grid-cols-7 continuo, las semanas intermedias
// "caen" solas sin necesidad de armarlas por separado.
function buildAttendanceWeeks(fechas) {
  if (!fechas.length) return []
  const parse = (f) => new Date(`${f}T12:00:00`) // mediodía: evita saltos de día por zona horaria
  const ordenadas = fechas.map(parse).sort((a, b) => a - b)
  const primerLunes = new Date(ordenadas[0])
  primerLunes.setDate(primerLunes.getDate() - ((primerLunes.getDay() + 6) % 7))
  const ultimo = ordenadas[ordenadas.length - 1]
  const ultimoDomingo = new Date(ultimo)
  ultimoDomingo.setDate(ultimoDomingo.getDate() + (6 - (ultimo.getDay() + 6) % 7))

  const dias = []
  for (const d = new Date(primerLunes); d <= ultimoDomingo; d.setDate(d.getDate() + 1)) {
    dias.push(toDateStr(d))
  }
  return dias
}

// 'actividad'/'tarea' are legacy categoria values from before they were
// merged into a single "Entregable" option — still mapped here so old
// activities keep showing a correct label without needing a data migration.
const CATEGORIA_LABELS = { actividad: 'Entregable', tarea: 'Entregable', entregable: 'Entregable', cuestionario: 'Cuestionario', examen: 'Examen', observacion: 'Observación' }

export default function StudentSubjectPage() {
  const { subjectId } = useParams()
  const { currentUser, userProfile } = useAuth()
  const [subject, setSubject] = useState(null)
  // El id de ESTA inscripción — es la llave con la que `activity.extensiones`
  // guarda las prórrogas individuales. Sin guardarlo, la lista de abajo no
  // tenía forma de saber si ESTE alumno tiene una prórroga vigente.
  const [studentId, setStudentId] = useState(null)
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
  const [soloAvisosGuardados, setSoloAvisosGuardados] = useState(false)
  const [attendanceSummary, setAttendanceSummary] = useState(null)
  const [teacherName, setTeacherName] = useState('')
  const [teacherPhoto, setTeacherPhoto] = useState(null)
  const [openParcial, setOpenParcial] = useState(1)
  const routerLocation = useLocation()
  const [activeTab, setActiveTab] = useState(routerLocation.state?.tab || 'Actividades y calificaciones')
  // Descarga de sus propias entregas — su trabajo es suyo y debe poder
  // llevárselo sin depender de que su maestro se lo pase.
  const [zipping, setZipping] = useState(false)
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const toast = useToast()
  const goBack = () => navigate('/alumno/dashboard')
  useBackHandler(goBack)

  useEffect(() => {
    // `currentUser` can still be null on first mount while Firebase Auth restores the
    // session (most visible in incognito/fresh sessions, no cached auth state) — firing
    // the Firestore query before then gets rejected by security rules and, since this
    // effect didn't depend on `currentUser`, never retried once auth was ready.
    if (currentUser) loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps -- mount-only intencional
  }, [subjectId, currentUser])

  // Avisos en tiempo real — a diferencia del resto de esta pantalla (una sola
  // lectura al entrar), un aviso que el docente publica/edita/borra mientras
  // el alumno ya tiene la materia abierta debe aparecer/desaparecer solo, sin
  // que recargue la página. `onSnapshot` en vez de `getDocs`, ver pedido
  // explícito de sincronización en tiempo real.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reinicia el gate de "listo" al cambiar de asignatura, antes de suscribirse
    setAvisosReady(false)
    const unsub = onSnapshot(
      query(collection(db, 'avisos'), where('asignaturaId', '==', subjectId)),
      (snap) => {
        setAvisos(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }))
            .filter((a) => a.activo !== false)
            .sort((a, b) => (b.fechaCreacion?.seconds ?? 0) - (a.fechaCreacion?.seconds ?? 0))
        )
        setAvisosReady(true)
      },
      () => setAvisosReady(true)
    )
    return unsub
  }, [subjectId])

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

  async function loadAll() {
    setLoading(true)
    // Default view for every subject: only the first parcial expanded. This same
    // component is reused (not remounted) when switching subjects, so reset it here.
    setOpenParcial(1)
    try {
      const [subSnap, studData, actsSnap, resSnap] = await Promise.all([
        getDoc(doc(db, 'subjects', subjectId)),
        getEnrollmentForSubject(currentUser, userProfile, subjectId),
        getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', subjectId))),
        getDocs(query(collection(db, 'resources'), where('asignaturaId', '==', subjectId))),
      ])
      const matsSnap = await getDocs(
        query(collection(db, 'materials'), where('asignaturaId', '==', subjectId))
      ).catch(() => ({ docs: [] }))

      // Sin inscripción no hay nada que mostrar: subjects/activities son de lectura
      // pública (necesario para la activación por QR), así que sin este guard
      // cualquier estudiante con la URL vería el contenido completo de la asignatura.
      if (!studData) {
        toast('No estás inscrito en esta asignatura', 'error')
        navigate('/alumno/dashboard')
        return
      }

      const subData = { id: subSnap.id, ...subSnap.data() }
      setSubject(subData)
      setStudentId(studData.id)

      // Fetch teacher name separately — best-effort
      if (subData.docenteId) {
        getDoc(doc(db, 'users', subData.docenteId))
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
      const allActs = actsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      // Same "Actividad" numbering as the teacher's view: position within the
      // parcial over ALL non-draft activities — computed before the visibility
      // filter so numbers match the teacher's even when a scheduled or hidden
      // activity isn't visible to the student yet.
      const labels = {}
      const countByParcial = {}
      allActs.filter((a) => !isDraftActivity(a)).forEach((a) => {
        countByParcial[a.parcial] = (countByParcial[a.parcial] || 0) + 1
        labels[a.id] = `${a.parcial}.${countByParcial[a.parcial]}.`
      })
      setActivityLabels(labels)
      const acts = allActs
        .filter((a) => isActivityPublished(a, parcialesOcultos.includes(a.parcial)))
      setActivities(acts)

      setResources(
        resSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.fechaPublicacion?.seconds ?? 0) - (a.fechaPublicacion?.seconds ?? 0))
      )
      setMaterials(
        matsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .filter((m) => isActivityPublished(m, parcialesOcultos.includes(m.parcial)))
          .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      )
      const [subsSnap, attSummarySnap] = await Promise.all([
        getDocs(query(collection(db, 'submissions'), where('alumnoId', '==', studData.id))),
        // Resumen propio (nunca la asistencia compartida del grupo) — lo
        // mantiene la Cloud Function onAttendanceEscrita; puede no existir
        // todavía si el docente nunca ha tomado asistencia.
        getDoc(doc(db, 'attendanceSummaries', studData.id)).catch(() => null),
      ])
      const actIds = new Set(acts.map((a) => a.id))
      const subsMap = {}
      subsSnap.docs.forEach((d) => {
        const data = d.data()
        if (actIds.has(data.actividadId)) subsMap[data.actividadId] = { id: d.id, ...data }
      })
      setSubmissions(subsMap)
      setAttendanceSummary(attSummarySnap?.exists() ? attSummarySnap.data() : null)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  function calcParcialAvg(parcial) {
    const acts = activities.filter((a) => a.parcial === parcial)
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
      </header>

      {/* Tabs */}
      <div className="bg-surface-card border-b border-outline-variant px-4 flex gap-1 overflow-x-auto">
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
                    {acts.length === 0 && mats.length === 0 && (
                      <p className="text-slate-400 text-sm text-center py-2">Sin actividades</p>
                    )}
                    {acts.map((a) => {
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
                    })}

                    {mats.map((m) => (
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
                    ))}
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

      {/* Tab: Asistencias — mismo lenguaje visual que Calificaciones (tarjeta
          por parcial con % arriba a la derecha); en vez de una lista de
          actividades, chips por día (uno por fecha, no por hora de clase). */}
      {activeTab === 'Asistencias' && (() => {
        const now = new Date()
        const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
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
              // Los días futuros (generados solos desde el horario del docente,
              // ver utils/attendanceAuto.js) llegan ya marcados "presente" por
              // defecto — al estudiante no deben aparecérsele hasta que
              // realmente sucedan, así que se filtran aquí antes de mostrar
              // celdas, conteos y el % del encabezado (pedido explícito).
              const registrosParcial = (attendanceSummary.registros || [])
                .filter((r) => r.parcial === p && r.fecha <= todayISO)
              const stat = registrosParcial.reduce((acc, r) => {
                acc.total++
                if (r.estado === 'falta') acc.inasist++
                else { acc.asist++; if (r.estado === 'justificada') acc.justif++ }
                return acc
              }, { asist: 0, inasist: 0, justif: 0, total: 0 })
              if (stat.total === 0) return null
              const pct = stat.total > 0 ? Math.round((stat.asist / stat.total) * 100) : null
              const registrosPorFecha = Object.fromEntries(registrosParcial.map((r) => [r.fecha, r]))
              const semanas = buildAttendanceWeeks(registrosParcial.map((r) => r.fecha))
              return (
                <div key={p} className="bg-surface-card rounded-card overflow-hidden shadow-card">
                  <div className="px-4 py-3 flex items-center gap-3 border-b border-outline-variant">
                    <div className="w-9 h-9 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
                      <span className="text-accent font-bold text-sm">{p}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-on-surface">Parcial {p}</p>
                      <p className="text-xs text-slate-500">
                        {stat.asist} de {stat.total} clases
                        {stat.justif > 0 ? ` (${stat.justif} justificada${stat.justif !== 1 ? 's' : ''})` : ''}
                      </p>
                    </div>
                    {pct != null && (
                      <div className="text-right flex-shrink-0">
                        <p className={`text-2xl font-bold leading-none ${pct < 80 ? 'text-red-500' : 'text-accent'}`}>{pct}%</p>
                        <p className="text-xs text-slate-400">asistencia</p>
                      </div>
                    )}
                  </div>
                  {/* Cuadrícula semanal (L a D) — un renglón por semana, en vez
                      de una lista de chips en fila. Los días sin clase (el
                      típico caso de sábado/domingo, pero también cualquier
                      día sin registro) quedan en blanco. Celdas bajas
                      (altura fija, NO aspect-square: en escritorio la columna
                      es ancha y un cuadrado se ve altísimo) con esquinas
                      apenas redondeadas (rounded-md, NO rounded-card: ese
                      radio es para tarjetas grandes — en una celda tan chica
                      terminaba pareciendo un círculo). Un renglón con el mes
                      aparece arriba de cada semana en la que cambia. */}
                  {/* Grid con 10 columnas: SEMANA + L-D + Asistencias + Faltas
                      (pedido explícito) — grid-template-columns fijo en vez de
                      grid-cols-N de Tailwind porque las columnas de conteo
                      necesitan más ancho que un día. Cada celda fija su columna
                      con gridColumn para que el auto-flow no la desalinee en
                      los renglones de mes (que solo ocupan la zona de días). */}
                  <div className="p-3 overflow-x-auto">
                    <div className="grid gap-1.5 min-w-[420px]" style={{ gridTemplateColumns: '2.5rem repeat(7, 1fr) 4.5rem 4.5rem' }}>
                      <span className="text-[9px] font-semibold text-slate-400 uppercase text-center" style={{ gridColumn: 1 }}>Semana</span>
                      {DIAS_SEMANA.map((d, i) => (
                        <span key={i} className="text-[10px] font-semibold text-slate-400 uppercase text-center" style={{ gridColumn: i + 2 }}>{d}</span>
                      ))}
                      <span className="text-[9px] font-semibold text-slate-400 uppercase text-center" style={{ gridColumn: 9 }}>Asistencias</span>
                      <span className="text-[9px] font-semibold text-slate-400 uppercase text-center" style={{ gridColumn: 10 }}>Faltas</span>
                    </div>
                    <div className="grid gap-1.5 mt-1.5 min-w-[420px]" style={{ gridTemplateColumns: '2.5rem repeat(7, 1fr) 4.5rem 4.5rem' }}>
                      {(() => {
                        let mesActual = null
                        let semanaNum = 0
                        const celdas = []
                        for (let i = 0; i < semanas.length; i += 7) {
                          const semana = semanas.slice(i, i + 7)
                          const mesSemana = fmtAttMonth(semana[0])
                          if (mesSemana !== mesActual) {
                            mesActual = mesSemana
                            celdas.push(
                              <p key={`mes-${semana[0]}`} className={`text-xs font-semibold text-muted capitalize ${i === 0 ? '' : 'mt-2'}`} style={{ gridColumn: '2 / span 7' }}>
                                {mesSemana}
                              </p>
                            )
                          }
                          semanaNum++
                          let semAsist = 0
                          let semInasist = 0
                          celdas.push(
                            <span key={`sem-${semana[0]}`} className="h-8 flex items-center justify-center text-[11px] font-semibold text-slate-400" style={{ gridColumn: 1 }}>
                              {semanaNum}
                            </span>
                          )
                          semana.forEach((fecha, dIdx) => {
                            const r = registrosPorFecha[fecha]
                            if (!r) { celdas.push(<div key={fecha} style={{ gridColumn: dIdx + 2 }} />); return }
                            if (r.estado === 'falta') semInasist++
                            else semAsist++
                            const tieneMotivo = r.estado === 'justificada' && r.motivo
                            celdas.push(
                              <button
                                type="button"
                                key={fecha}
                                style={{ gridColumn: dIdx + 2 }}
                                disabled={!tieneMotivo}
                                onClick={() => tieneMotivo && toast(r.motivo)}
                                data-tooltip={tieneMotivo ? r.motivo : undefined}
                                className={`h-8 rounded-md flex items-center justify-center text-xs font-semibold transition-colors ${
                                  r.estado === 'presente' ? 'bg-emerald-100 text-emerald-700'
                                  : r.estado === 'justificada' ? `bg-amber-100 text-amber-700 ${tieneMotivo ? 'hover:bg-amber-200 cursor-pointer' : ''}`
                                  : 'bg-red-100 text-red-600'
                                }`}
                              >
                                {Number(fecha.slice(8, 10))}
                              </button>
                            )
                          })
                          celdas.push(
                            <span key={`sa-${semana[0]}`} className="h-8 flex items-center justify-center text-xs font-semibold text-emerald-700" style={{ gridColumn: 9 }}>
                              {semAsist}
                            </span>
                          )
                          celdas.push(
                            <span key={`si-${semana[0]}`} className="h-8 flex items-center justify-center text-xs font-semibold text-red-600" style={{ gridColumn: 10 }}>
                              {semInasist}
                            </span>
                          )
                        }
                        return celdas
                      })()}
                      {/* Total del parcial — bajo la columna de Domingo, con las
                          sumas en Asistencias/Faltas (mismos números que
                          el resumen de arriba, stat.asist/stat.inasist). */}
                      <span className="text-xs font-semibold text-muted text-right pr-1 mt-1" style={{ gridColumn: 8 }}>Total</span>
                      <span className="h-8 flex items-center justify-center text-sm font-bold text-emerald-700 mt-1" style={{ gridColumn: 9 }}>
                        {stat.asist}
                      </span>
                      <span className="h-8 flex items-center justify-center text-sm font-bold text-red-600 mt-1" style={{ gridColumn: 10 }}>
                        {stat.inasist}
                      </span>
                    </div>
                  </div>
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
        const guardadosList = avisos.filter((a) => avisosGuardados[a.id])
        const avisosMostrados = soloAvisosGuardados ? guardadosList : avisos.filter((a) => !avisosGuardados[a.id])
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
                      <button type="button" onClick={() => toggleAvisoGuardado(a)} aria-label={guardado ? 'Quitar de guardados' : 'Guardar'}
                        data-tooltip={guardado ? 'Quitar de guardados' : 'Guardar'}
                        className={`p-2 -m-1 rounded transition-colors flex-shrink-0 ${guardado ? 'text-accent' : 'text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)]'}`}>
                        <Bookmark size={18} className={guardado ? 'fill-current' : ''} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        )
      })()}

    </div>
    </StudentLayout>
  )
}
