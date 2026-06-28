import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import { Plus, BookOpen, ChevronRight, X, ArrowUpDown } from 'lucide-react'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectPeriodLabel } from '../../utils/dateRange'
import PaletteSelect from '../../components/PaletteSelect'
import IconSelect from '../../components/IconSelect'
import SubjectIcon from '../../components/SubjectIcon'
import { useSubscription } from '../../hooks/useSubscription'
import { canCreateContent } from '../../utils/subscriptionHelpers'

function generateAccessCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

export default function TeacherDashboard() {
  const { currentUser, userProfile } = useAuth()
  const location = useLocation()
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)

  // Whether the trial (or subscription) is expired — only gates NEW creation;
  // everything already in the account stays fully visible/exportable.
  const { subscription } = useSubscription()
  const canCreate = canCreateContent(subscription)

  // Subject creation modal
  const [showSubjectModal, setShowSubjectModal] = useState(location.state?.openCreate === true)
  const [newSubjectName, setNewSubjectName] = useState('')
  const [newSubjectGrupo, setNewSubjectGrupo] = useState('')
  const [newSubjectParciales, setNewSubjectParciales] = useState(3)
  const [newSubjectPalette, setNewSubjectPalette] = useState('default')
  const [newSubjectIcon, setNewSubjectIcon] = useState('book')
  const [newSubjectFechaInicio, setNewSubjectFechaInicio] = useState('')
  const [newSubjectFechaFin, setNewSubjectFechaFin] = useState('')
  const [creatingSubject, setCreatingSubject] = useState(false)

  // Subject list display order toggle (persists across sessions)
  const [nameOrder, setNameOrder] = useState(() => localStorage.getItem('subjectNameOrder') || 'normal')
  function toggleNameOrder() {
    const next = nameOrder === 'normal' ? 'reverse' : 'normal'
    setNameOrder(next)
    localStorage.setItem('subjectNameOrder', next)
  }

  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    if (!currentUser) return
    loadAll()
  }, [currentUser])

  // Open the "Nueva asignatura" modal when navigated here with openCreate — including
  // when ALREADY on /dashboard (sidebar button), where the useState initializer above
  // does not re-run. location.key changes on every navigation, so this fires each time.
  useEffect(() => {
    if (location.state?.openCreate) {
      openSubjectModal()
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  function openSubjectModal() {
    if (!canCreate) {
      toast('Activa tu suscripción mensual para crear nuevas asignaturas — toda tu información sigue disponible')
      return
    }
    setShowSubjectModal(true)
  }

  async function loadAll() {
    setLoading(true)
    try {
      const subSnap = await getDocs(
        query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid))
      )
      const subList = subSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const nc = (a.nombre || '').localeCompare(b.nombre || '', 'es')
          if (nc !== 0) return nc
          return (a.grupo || '').localeCompare(b.grupo || '', 'es')
        })
      setSubjects(subList)
    } catch (err) {
      toast('Error al cargar: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateSubject(e) {
    e.preventDefault()
    if (!newSubjectName.trim() || !newSubjectGrupo.trim()) return
    if (!canCreate) {
      toast('Activa tu suscripción mensual para crear nuevas asignaturas — toda tu información sigue disponible')
      return
    }
    setCreatingSubject(true)
    try {
      const subData = {
        nombre: newSubjectName.trim(),
        grupo: newSubjectGrupo.trim(),
        docenteId: currentUser.uid,
        escuelaId: userProfile.escuelaId,
        parciales: newSubjectParciales,
        fechaInicio: newSubjectFechaInicio || '',
        fechaFin: newSubjectFechaFin || '',
        colorPalette: newSubjectPalette,
        icon: newSubjectIcon,
        accessCode: generateAccessCode(),
        archived: false,
        createdAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'subjects'), subData)
      setSubjects((prev) =>
        [...prev, { id: ref.id, ...subData }]
          .sort((a, b) => {
            const nc = (a.nombre || '').localeCompare(b.nombre || '', 'es')
            if (nc !== 0) return nc
            return (a.grupo || '').localeCompare(b.grupo || '', 'es')
          })
      )
      setShowSubjectModal(false)
      setNewSubjectName('')
      setNewSubjectGrupo('')
      setNewSubjectParciales(3)
      setNewSubjectPalette('default')
      setNewSubjectIcon('book')
      setNewSubjectFechaInicio('')
      setNewSubjectFechaFin('')
      toast('Asignatura creada')
      navigate(`/subject/${ref.id}`)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setCreatingSubject(false)
    }
  }

  return (
    <TeacherLayout>
      <div className="px-4 py-6 max-w-2xl mx-auto">

        {/* Greeting */}
        <div className="mb-6">
          <p className="text-muted text-sm">Bienvenido,</p>
          <h1 className="text-2xl font-bold text-on-surface truncate">
            {userProfile?.nombreMostrar || 'Docente'}
          </h1>
          {userProfile?.schoolName && (
            <p className="text-slate-400 text-xs mt-0.5 truncate">{userProfile.schoolName}</p>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <>
            {/* ── Mis asignaturas ── */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
              <h2 className="text-lg font-semibold text-on-surface">Mis asignaturas</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleNameOrder}
                  title={nameOrder === 'normal' ? 'Mostrar Grupo + Asignatura' : 'Mostrar Asignatura + Grupo'}
                  className="flex items-center gap-1 text-sm text-slate-500 hover:text-blue-600 transition-colors px-2 py-1 rounded hover:bg-blue-50"
                >
                  <ArrowUpDown size={13} />
                  {nameOrder === 'normal' ? 'Asignatura · Grupo' : 'Grupo · Asignatura'}
                </button>
                <span className="text-xs text-slate-300">·</span>
                <span className="text-sm text-slate-500">{subjects.length} asignatura{subjects.length !== 1 ? 's' : ''}</span>
              </div>
            </div>

            {subjects.length === 0 ? (
              <div className="bg-surface-card rounded-card border border-outline-variant p-8 text-center mb-6">
                <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-3">
                  <BookOpen size={28} className="text-blue-400" />
                </div>
                <p className="text-muted font-medium mb-3">Aún no tienes asignaturas</p>
                <button
                  type="button"
                  onClick={openSubjectModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded transition-colors"
                >
                  <Plus size={16} />
                  Crear mi primera asignatura
                </button>
              </div>
            ) : (
              <div className="space-y-2 mb-8">
                {subjects.map((s) => (
                  <button
                    key={s.id}
                    data-subject-palette={s.colorPalette || 'default'}
                    onClick={() => navigate(`/subject/${s.id}`)}
                    className="w-full bg-surface-card rounded-card p-4 text-left shadow-card hover:shadow-md transition-shadow flex items-center gap-4"
                  >
                    <div className="w-11 h-11 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
                      <SubjectIcon iconKey={s.icon} size={19} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-on-surface truncate">{subjectDisplayName(s, nameOrder === 'reverse')}</p>
                        {s.archived && (
                          <span className="text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
                            archivada
                          </span>
                        )}
                      </div>
                      {subjectPeriodLabel(s) && (
                        <p className="text-sm text-slate-500 mt-0.5">{subjectPeriodLabel(s)}</p>
                      )}
                    </div>
                    <ChevronRight size={18} className="text-slate-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}

          </>
        )}
      </div>

      {/* FAB — create subject (mobile only; on web use the sidebar's "Nueva asignatura") */}
      <button
        onClick={openSubjectModal}
        className="md:hidden fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors z-20"
      >
        <Plus size={24} />
      </button>

      {/* ── Nueva asignatura modal ── */}
      {showSubjectModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSubjectModal(false)} />
          <div className="relative bg-surface-card w-full sm:w-[calc(100%-2rem)] max-w-sm rounded-t-card sm:rounded-card p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-on-surface">Nueva asignatura</h3>
              <button onClick={() => setShowSubjectModal(false)} className="p-2 text-slate-400 hover:text-muted rounded">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateSubject} className="space-y-4">
              {/* Nombre de la asignatura */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Asignatura</label>
                <input
                  type="text"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  required
                  autoFocus
                  className="w-full px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                  placeholder="Ej: Matemáticas, Física, Historia"
                />
              </div>
              {/* Grupo */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Grupo</label>
                <input
                  type="text"
                  value={newSubjectGrupo}
                  onChange={(e) => setNewSubjectGrupo(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                  placeholder="Ej: 1A, 2B, 3C"
                />
              </div>

              {/* Fechas (opcionales) */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1">
                  Fechas <span className="text-slate-400 font-normal text-xs">(opcional)</span>
                </label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <span className="block text-sm text-slate-500 mb-1">Inicio</span>
                    <input
                      type="date"
                      value={newSubjectFechaInicio}
                      onChange={(e) => setNewSubjectFechaInicio(e.target.value)}
                      className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                    />
                  </div>
                  <div className="flex-1">
                    <span className="block text-sm text-slate-500 mb-1">Fin</span>
                    <input
                      type="date"
                      value={newSubjectFechaFin}
                      onChange={(e) => setNewSubjectFechaFin(e.target.value)}
                      className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                    />
                  </div>
                </div>
              </div>

              {/* Parciales */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1">
                  Calificaciones parciales <span className="text-slate-400 font-normal text-xs">(por defecto 3)</span>
                </label>
                <div className="grid grid-cols-6 gap-1.5">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNewSubjectParciales(n)}
                      className={`py-2.5 rounded text-sm font-bold transition-colors ${
                        newSubjectParciales === n
                          ? 'bg-blue-600 text-white'
                          : 'bg-surface-container text-muted hover:bg-surface-dim'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Paleta de color */}
              <div>
                <label className="block text-sm font-medium text-muted mb-2">
                  Color de la asignatura
                </label>
                <PaletteSelect value={newSubjectPalette} onChange={setNewSubjectPalette} />
              </div>

              {/* Icono */}
              <div data-subject-palette={newSubjectPalette}>
                <label className="block text-sm font-medium text-muted mb-2">
                  Icono de la asignatura
                </label>
                <IconSelect value={newSubjectIcon} onChange={setNewSubjectIcon} />
              </div>

              <button
                type="submit"
                disabled={creatingSubject}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {creatingSubject ? <Spinner size="sm" /> : <Plus size={16} />}
                {creatingSubject ? 'Creando…' : 'Crear asignatura'}
              </button>
            </form>
          </div>
        </div>
      )}

    </TeacherLayout>
  )
}
