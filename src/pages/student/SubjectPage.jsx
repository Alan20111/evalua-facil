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
import { isActivityPublished } from '../../utils/activityVisibility'
import { subjectDisplayName } from '../../utils/subjectName'
import { getEnrollmentForSubject } from '../../utils/studentLookup'
import { getResourceIcon } from '../../utils/resourceTypes'
import { formatFileSize } from '../../utils/formatBytes'
import SubjectIcon from '../../components/SubjectIcon'
import {
  ArrowLeft, ChevronDown, ChevronUp, CheckCircle,
  Clock, Circle, Star, Download, FolderOpen, BookOpen, Paperclip,
} from 'lucide-react'
import { sanitizeHtml, richTextContentClass } from '../../utils/sanitizeHtml'
import StudentLayout from '../../components/StudentLayout'

function formatResourceDate(ts) {
  if (!ts?.toDate) return ''
  return ts.toDate().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

const TABS = ['Actividades', 'Calificaciones', 'Recursos']

const CATEGORIA_LABELS = { actividad: 'Actividad', tarea: 'Tarea', cuestionario: 'Cuestionario', examen: 'Examen' }

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
  const [submissions, setSubmissions] = useState({})
  const [resources, setResources] = useState([])
  const [materials, setMaterials] = useState([])
  const [teacherName, setTeacherName] = useState('')
  const [openParcial, setOpenParcial] = useState(1)
  const [activeTab, setActiveTab] = useState('Actividades')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => { loadAll() }, [subjectId])

  async function loadAll() {
    setLoading(true)
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
              setTeacherName(td.nombreMostrar || td.nombre || td.username || '')
            }
          })
          .catch(() => {})
      }

      const parcialesOcultos = subData.parcialesOcultos || []
      const acts = actsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
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
      if (!studData) return

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
    const grades = acts
      .map((a) => submissions[a.id])
      .filter((s) => s?.calificacion != null)
      .map((s) => {
        const act = activities.find((a) => a.id === s.actividadId)
        return (s.calificacion / (act?.maxCalif || 10)) * 10
      })
    return grades.length ? (grades.reduce((a, b) => a + b, 0) / grades.length).toFixed(1) : null
  }

  const PARCIALES = Array.from({ length: subject?.parciales || 3 }, (_, i) => i + 1)

  if (loading) return (
    <StudentLayout>
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    </StudentLayout>
  )

  return (
    <StudentLayout>
    <div className="bg-surface" data-subject-palette={subject?.colorPalette || 'default'}>

      {/* Page header */}
      <header className="bg-surface-card border-b border-outline-variant px-4 py-3 flex items-center gap-3 shadow-card">
        <button
          onClick={() => navigate('/alumno/dashboard')}
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
            <p className="text-slate-400 text-xs truncate">Profe {teacherName}</p>
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
        <div className="px-4 py-5 max-w-2xl mx-auto space-y-3">
          {PARCIALES.map((p) => {
            const acts = activities.filter((a) => a.parcial === p)
            const mats = materials.filter((m) => m.parcial === p)
            const avg = calcParcialAvg(p)
            const isOpen = openParcial === p
            return (
              <div key={p} className="bg-surface-card rounded-card overflow-hidden shadow-card">
                <button
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
                  <div className="border-t border-outline-variant px-4 py-2 space-y-1.5">
                    {acts.length === 0 && mats.length === 0 && (
                      <p className="text-slate-400 text-sm text-center py-2">Sin actividades</p>
                    )}
                    {acts.map((a) => {
                      const sub = submissions[a.id]
                      const graded = sub?.calificacion != null
                      const delivered = sub && !graded
                      const overdue = !graded && !delivered && isOverdue(a)
                      const fechaLimiteLabel = formatFechaLimite(a.fechaLimite)
                      return (
                        <button
                          key={a.id}
                          onClick={() => navigate(`/alumno/actividad/${a.id}`)}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-surface transition-colors border border-outline-variant text-left"
                        >
                          <div className="flex-shrink-0">
                            {graded ? (
                              <CheckCircle size={20} className="text-emerald-500" />
                            ) : delivered ? (
                              <Clock size={20} className="text-accent" />
                            ) : overdue ? (
                              <Circle size={20} className="text-red-400" />
                            ) : (
                              <Circle size={20} className="text-slate-300" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium leading-tight text-on-surface truncate">{a.nombre}</p>
                            <p className="text-xs text-slate-500 leading-tight truncate mt-0.5">
                              {CATEGORIA_LABELS[a.categoria] || 'Actividad'}
                              {fechaLimiteLabel && ` · Vence ${fechaLimiteLabel}`}
                            </p>
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
                          <div className={`px-3 pb-2 text-sm text-slate-600 ${richTextContentClass}`}
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.descripcion) }} />
                        )}
                        <div className="px-3 pb-2 space-y-1">
                          {(m.archivos || []).map((f, i) => {
                            const { icon: FileIconComp, color } = getResourceIcon(f.nombre)
                            return (
                              <a key={i} href={f.url} target="_blank" rel="noreferrer"
                                className="flex items-center gap-2 px-2 py-1.5 rounded border border-outline-variant hover:bg-surface transition-colors">
                                <FileIconComp size={17} className={`flex-shrink-0 ${color}`} />
                                <span className="text-sm text-on-surface truncate flex-1">{f.nombre}</span>
                                <span className="text-xs text-slate-400 flex-shrink-0">{formatFileSize(f.tamano)}</span>
                                <Download size={15} className="text-slate-400 flex-shrink-0" />
                              </a>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Tab: Calificaciones */}
      {activeTab === 'Calificaciones' && (
        <div className="px-4 py-5 max-w-2xl mx-auto space-y-3">
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
                            <p className="text-sm text-on-surface truncate">{a.nombre}</p>
                            <p className="text-xs text-slate-400 truncate">{CATEGORIA_LABELS[a.categoria] || 'Actividad'}</p>
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
        <div className="px-4 py-5 max-w-2xl mx-auto">
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
              <div className="px-4 py-2 space-y-1.5">
                {resources.map((r) => {
                  const { icon: Icon, color } = getResourceIcon(r.nombreArchivo)
                  return (
                    <a
                      key={r.id}
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 px-2 py-2 rounded hover:bg-surface transition-colors border border-outline-variant"
                    >
                      <Icon size={24} className={`flex-shrink-0 ${color}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">{r.nombre}</p>
                        {r.descripcion && (
                          <p className="text-sm text-slate-500 truncate">{r.descripcion}</p>
                        )}
                        <p className="text-xs text-slate-400 mt-0.5">
                          {formatFileSize(r.tamano)}{r.tamano ? ' · ' : ''}{formatResourceDate(r.fechaPublicacion)}
                        </p>
                      </div>
                      <Download size={18} className="text-slate-400 flex-shrink-0" />
                    </a>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
    </StudentLayout>
  )
}
