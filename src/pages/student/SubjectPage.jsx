import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { isActivityPublished, formatPublishAt } from '../../utils/activityVisibility'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import { getEnrollmentForSubject } from '../../utils/studentLookup'
import { getResourceIcon } from '../../utils/resourceTypes'
import { formatFileSize } from '../../utils/formatBytes'
import { teacherDisplayName } from '../../utils/studentSearch'
import { IS_NATIVE_APP } from '../../utils/platform'
import SubjectIcon from '../../components/SubjectIcon'
import AttachmentList from '../../components/AttachmentList'
import {
  ArrowLeft, ChevronDown, ChevronUp, CheckCircle,
  Clock, Circle, Star, FolderOpen, BookOpen, Paperclip,
  GraduationCap, ListChecks, FileText, ClipboardCheck,
} from 'lucide-react'
import { sanitizeHtml, richTextContentClass } from '../../utils/sanitizeHtml'
import StudentLayout from '../../components/StudentLayout'
import { promedioParcial, ponderacionActivaEnParcial } from '../../utils/ponderacion'
import { STUDENT_CONTAINER } from '../../config/layout'
import { useBackHandler } from '../../hooks/useBackHandler'

function ResourceCard({ resource: r }) {
  const { icon: Icon, color } = getResourceIcon(r.nombreArchivo || r.nombre || '')
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
            {r.tamano != null ? formatFileSize(r.tamano) + ' · ' : ''}
            {formatResourceDate(r.fechaPublicacion)}
          </p>
        </div>
      </div>
      <div className="px-3 pb-2">
        <AttachmentList
          files={[{ url: r.url, nombre: r.nombreArchivo || r.nombre, tamano: r.tamano }]}
          title={null}
        />
      </div>
    </div>
  )
}

function formatResourceDate(ts) {
  if (!ts?.toDate) return ''
  return ts.toDate().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

const TABS = ['Actividades', 'Calificaciones', 'Recursos']

// 'actividad'/'tarea' are legacy categoria values from before they were
// merged into a single "Entregable" option — still mapped here so old
// activities keep showing a correct label without needing a data migration.
const CATEGORIA_LABELS = { actividad: 'Entregable', tarea: 'Entregable', entregable: 'Entregable', cuestionario: 'Cuestionario', examen: 'Examen', observacion: 'Observación' }

function formatFechaLimite(value) {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

function isOverdue(activity) {
  if (!activity.fechaLimite) return false
  const d = new Date(activity.fechaLimite)
  return !isNaN(d.getTime()) && d < new Date()
}

export default function StudentSubjectPage() {
  const { subjectId } = useParams()
  const { currentUser, userProfile } = useAuth()
  const [subject, setSubject] = useState(null)
  const [activities, setActivities] = useState([])
  const [activityLabels, setActivityLabels] = useState({})
  const [submissions, setSubmissions] = useState({})
  const [resources, setResources] = useState([])
  const [materials, setMaterials] = useState([])
  const [teacherName, setTeacherName] = useState('')
  const [openParcial, setOpenParcial] = useState(1)
  const [activeTab, setActiveTab] = useState('Actividades')
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

      const subData = { id: subSnap.id, ...subSnap.data() }
      setSubject(subData)

      // Fetch teacher name separately — best-effort
      if (subData.docenteId) {
        getDoc(doc(db, 'users', subData.docenteId))
          .then((snap) => {
            if (snap.exists()) {
              const td = snap.data()
              setTeacherName(teacherDisplayName(td))
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
      const isDraft = (a) => a.oculta && !a.publishedAt && !a.publishAt
      const labels = {}
      const countByParcial = {}
      allActs.filter((a) => !isDraft(a)).forEach((a) => {
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
      if (!studData) {
        toast('No se encontró tu inscripción en esta asignatura', 'error')
        return
      }

      const subsSnap = await getDocs(
        query(collection(db, 'submissions'), where('alumnoId', '==', studData.id))
      )
      const actIds = new Set(acts.map((a) => a.id))
      const subsMap = {}
      subsSnap.docs.forEach((d) => {
        const data = d.data()
        if (actIds.has(data.actividadId)) subsMap[data.actividadId] = { id: d.id, ...data }
      })
      setSubmissions(subsMap)
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
      return sub?.calificacion != null ? (sub.calificacion / (a.maxCalif || 10)) * 10 : null
    })
    // Same math as the teacher's table — weighted when THIS parcial uses ponderación
    const avg = promedioParcial(acts, grades, ponderacionActivaEnParcial(subject, parcial))
    return avg !== null ? avg.toFixed(1) : null
  }

  // Parciales hidden by the teacher must not appear AT ALL in student views —
  // not even as an empty card (their activities are already filtered out above).
  const PARCIALES = Array.from({ length: subject?.parciales || 3 }, (_, i) => i + 1)
    .filter((p) => !(subject?.parcialesOcultos || []).includes(p))

  if (loading) return (
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
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-on-surface truncate">{subjectDisplayName(subject)}</h1>
          {teacherName && (
            <p className="text-slate-500 text-sm font-medium truncate">{teacherName}</p>
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

      {/* Tab: Actividades */}
      {activeTab === 'Actividades' && (
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
                      const overdue = !graded && !delivered && isOverdue(a)
                      const fechaLimiteLabel = formatFechaLimite(a.fechaLimite)
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
                                  <span data-tooltip="Cierre" className={`text-xs flex items-center gap-0.5 ${overdue ? 'text-red-500' : 'text-amber-600'}`}>
                                    <Clock size={14} /> {fechaLimiteLabel}
                                  </span>
                                )}
                                {showPeso && (
                                  <span className="text-xs text-amber-700 font-semibold">Vale {a.pesoCalificacion} de 10</span>
                                )}
                              </div>
                            )}
                            {sub?.comentario && (
                              <p className="text-sm text-slate-500 leading-tight truncate mt-0.5">"{sub.comentario}"</p>
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
        </div>
      )}

      {/* Tab: Calificaciones */}
      {activeTab === 'Calificaciones' && (
        <div className={`px-4 py-5 space-y-3 ${STUDENT_CONTAINER}`}>
          {PARCIALES.length === 0 && (
            <div className="bg-surface-card rounded-card border border-outline-variant p-10 text-center">
              <p className="text-muted text-sm">El docente aún no ha publicado calificaciones.</p>
            </div>
          )}
          {PARCIALES.map((p) => {
            const acts = activities.filter((a) => a.parcial === p)
            const avg = calcParcialAvg(p)
            return (
              <div key={p} className="bg-surface-card rounded-card overflow-hidden shadow-card">
                {/* Parcial header with average */}
                <div className="px-4 py-3 flex items-center gap-3 border-b border-outline-variant">
                  <div className="w-9 h-9 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
                    <span className="text-accent font-bold text-sm">{p}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-on-surface">Parcial {p}</p>
                    <p className="text-xs text-slate-500">{acts.length} actividad{acts.length !== 1 ? 'es' : ''}</p>
                  </div>
                  {avg != null ? (
                    <div className="text-right flex-shrink-0">
                      <p className="text-2xl font-bold text-accent leading-none">{avg}</p>
                      <p className="text-xs text-slate-400">promedio</p>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400 flex-shrink-0">Sin calificar</p>
                  )}
                </div>

                {/* Activity grades list */}
                {acts.length === 0 ? (
                  <p className="text-slate-400 text-sm text-center py-4">Sin actividades</p>
                ) : (
                  <div className="divide-y divide-outline-variant">
                    {acts.map((a) => {
                      const sub = submissions[a.id]
                      const graded = sub?.calificacion != null
                      const delivered = sub && !graded
                      const overdue = !graded && !delivered && isOverdue(a)
                      return (
                        <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                          <div className="flex-shrink-0">
                            {graded ? (
                              <CheckCircle size={18} className="text-emerald-500" />
                            ) : delivered ? (
                              <Clock size={18} className="text-accent" />
                            ) : overdue ? (
                              <Circle size={18} className="text-red-400" />
                            ) : (
                              <Circle size={18} className="text-slate-300" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-on-surface truncate">
                              {activityLabels[a.id] && <span className="text-accent font-semibold">{activityLabels[a.id]} </span>}
                              {a.nombre}
                            </p>
                            <p className="text-xs text-slate-400 truncate">{CATEGORIA_LABELS[a.categoria] || 'Entregable'}</p>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            {graded ? (
                              <p className="text-sm font-bold text-emerald-600">
                                {sub.calificacion} <span className="font-normal text-slate-400">/ {a.maxCalif}</span>
                              </p>
                            ) : delivered ? (
                              <span className="text-xs text-accent font-medium">Entregada</span>
                            ) : overdue ? (
                              <span className="text-xs text-red-500 font-medium">Vencida</span>
                            ) : (
                              <span className="text-xs text-slate-400">Pendiente</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

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

    </div>
    </StudentLayout>
  )
}
