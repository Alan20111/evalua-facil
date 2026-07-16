import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import { Plus, BookOpen, ChevronRight, X, ArrowUp, ArrowDown } from 'lucide-react'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectPeriodLabel } from '../../utils/dateRange'
import PaletteSelect from '../../components/PaletteSelect'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import EFDateTimePicker from '../../components/EFDateTimePicker'
import IconSelect from '../../components/IconSelect'
import SubjectIcon from '../../components/SubjectIcon'
import { useSubscription } from '../../hooks/useSubscription'
import { canCreateContent } from '../../utils/subscriptionHelpers'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { IS_NATIVE_APP } from '../../utils/platform'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'

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

  const navigate = useNavigate()
  const toast = useToast()

  // Dashboard es raíz (sin flecha "Volver") — el botón físico atrás solo debe
  // cerrar el modal "Nueva asignatura" cuando está abierto; si no hay nada
  // abierto, cae al comportamiento default (doble tap para salir).
  useBackHandler(() => setShowSubjectModal(false), showSubjectModal)
  useScrollLock(showSubjectModal)

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
      let subList = subSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

      // Subjects predate manual ordering — the first time we see one without an
      // `orden`, assign one from its current alphabetical position and persist it,
      // so the list has a stable order the teacher can then rearrange by hand.
      if (subList.some((s) => s.orden == null)) {
        subList = subList.sort((a, b) => {
          const nc = (a.nombre || '').localeCompare(b.nombre || '', 'es')
          if (nc !== 0) return nc
          return (a.grupo || '').localeCompare(b.grupo || '', 'es')
        })
        const batch = writeBatch(db)
        subList = subList.map((s, i) => {
          const orden = i + 1
          if (s.orden !== orden) batch.update(doc(db, 'subjects', s.id), { orden })
          return { ...s, orden }
        })
        batch.commit().catch(() => {}) // best-effort; the in-memory order is already correct
      } else {
        subList = subList.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      }
      setSubjects(subList)
    } catch (err) {
      toast('Error al cargar: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function moveSubject(index, direction) {
    const newList = [...subjects]
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= newList.length) return
    ;[newList[index], newList[targetIndex]] = [newList[targetIndex], newList[index]]
    setSubjects(newList.map((s, i) => ({ ...s, orden: i + 1 })))
    try {
      const batch = writeBatch(db)
      newList.forEach((s, i) => batch.update(doc(db, 'subjects', s.id), { orden: i + 1 }))
      await batch.commit()
    } catch (err) {
      toast('No se pudo reordenar: ' + err.message, 'error')
      loadAll()
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
        escuelaId: userProfile.escuelaId || 'sin-escuela',
        parciales: newSubjectParciales,
        fechaInicio: newSubjectFechaInicio || '',
        fechaFin: newSubjectFechaFin || '',
        colorPalette: newSubjectPalette,
        icon: newSubjectIcon,
        accessCode: generateAccessCode(),
        archived: false,
        orden: subjects.length + 1,
        createdAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'subjects'), subData)
      setSubjects((prev) => [...prev, { id: ref.id, ...subData }])
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

  const teacherApellidos = [userProfile?.apellidoPaterno, userProfile?.apellidoMaterno].filter(Boolean).join(' ')
  const teacherGivenName = userProfile?.nombre || userProfile?.nombreMostrar || 'Docente'
  const teacherGreetingName = userProfile?.prefijo ? `${userProfile.prefijo} ${teacherGivenName}` : teacherGivenName

  return (
    <TeacherLayout>
      <div className={`px-4 sm:px-5 lg:px-6 py-4 ${TEACHER_CONTAINER_NARROW}`}>

        {/* Greeting — "Bienvenido" en su renglón, "{prefijo} {nombre} {apellidos}"
            junto debajo, mismo tamaño. Igual que el estudiante
            (userProfile.nombre/apellidoPaterno/apellidoMaterno); si un
            docente aún no tiene esos campos, cae de vuelta al alias
            nombreMostrar mientras la migración de AuthContext lo resuelve. El
            prefijo es el mismo elegido en Perfil > Nombre visible (el que ven
            sus alumnos). */}
        <div className="mb-4">
          <h1 className="text-lg font-bold text-on-surface truncate">Bienvenido</h1>
          <p className="text-lg font-bold text-on-surface truncate">
            {teacherGreetingName}{teacherApellidos ? ` ${teacherApellidos}` : ''}
          </p>
          {userProfile?.schoolName && (
            <p className="text-slate-400 text-xs mt-0.5 truncate">{userProfile.schoolName}</p>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <>
            {/* ── Mis asignaturas ── */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
              <h2 className="text-lg font-semibold text-on-surface">Mis asignaturas</h2>
              <span className="text-sm text-slate-500">{subjects.length} asignatura{subjects.length !== 1 ? 's' : ''}</span>
            </div>

            {subjects.length === 0 ? (
              <div className="bg-surface-card rounded-card border border-outline-variant p-8 text-center mb-4">
                <div className="w-14 h-14 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-2">
                  <BookOpen size={28} className="text-accent" />
                </div>
                <p className="text-muted font-medium mb-2">Aún no tienes asignaturas</p>
                <button
                  type="button"
                  onClick={openSubjectModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white font-semibold text-sm rounded transition-colors"
                >
                  <Plus size={18} />
                  Crear mi primera asignatura
                </button>
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                {subjects.map((s, i) => (
                  <div
                    key={s.id}
                    {...subjectPaletteProps(s.colorPalette)}
                    className="w-full bg-surface-card rounded-card p-1.5 shadow-card hover:shadow-md hover:bg-[var(--accent-tint)] transition-all duration-200 flex items-center gap-1"
                  >
                    {/* Reordenar asignaturas: solo en la web */}
                    {!IS_NATIVE_APP && (
                      <div className="flex flex-col flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => moveSubject(i, -1)}
                          disabled={i === 0}
                          data-tooltip="Subir"
                          aria-label="Subir"
                          className="p-1 text-slate-400 hover:text-accent hover:bg-[var(--accent-tint)] disabled:opacity-40 rounded"
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSubject(i, 1)}
                          disabled={i === subjects.length - 1}
                          data-tooltip="Bajar"
                          aria-label="Bajar"
                          className="p-1 text-slate-400 hover:text-accent hover:bg-[var(--accent-tint)] disabled:opacity-40 rounded"
                        >
                          <ArrowDown size={16} />
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => navigate(`/subject/${s.id}`)}
                      className="flex-1 min-w-0 text-left flex items-center gap-2"
                    >
                      <div className="w-11 h-11 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
                        <SubjectIcon iconKey={s.icon} size={21} className="text-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-on-surface truncate">{subjectDisplayName(s)}</p>
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
                      <ChevronRight size={20} className="text-slate-300 flex-shrink-0" />
                    </button>
                  </div>
                ))}
              </div>
            )}

          </>
        )}
      </div>

      {/* FAB — create subject (mobile only; on web use the sidebar's "Nueva asignatura") */}
      <button
        type="button"
        onClick={openSubjectModal}
        aria-label="Nueva asignatura"
        className="md:hidden fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 w-14 h-14 bg-accent hover:bg-accent-hover text-white rounded-full shadow-lg flex items-center justify-center transition-colors z-20"
      >
        <Plus size={26} />
      </button>

      {/* ── Nueva asignatura modal ── */}
      {showSubjectModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setShowSubjectModal(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full sm:w-[calc(100%-2rem)] max-w-lg rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[92vh] overflow-y-auto overflow-x-hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-on-surface">Nueva asignatura</h3>
              <button type="button" onClick={() => setShowSubjectModal(false)} aria-label="Cerrar" className="p-2 text-slate-400 hover:text-muted rounded">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateSubject} className="space-y-2">
              {/* Nombre de la asignatura */}
              <div>
                <label htmlFor="dash-asignatura" className="block text-sm font-medium text-muted mb-1">Asignatura</label>
                <input
                  id="dash-asignatura"
                  type="text"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  required
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Ej: Matemáticas, Física, Historia"
                />
              </div>
              {/* Grupo */}
              <div>
                <label htmlFor="dash-grupo" className="block text-sm font-medium text-muted mb-1">Grupo</label>
                <input
                  id="dash-grupo"
                  type="text"
                  value={newSubjectGrupo}
                  onChange={(e) => setNewSubjectGrupo(e.target.value)}
                  required
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Ej: 1A, 2B, 3C"
                />
              </div>

              {/* Fechas (opcionales) */}
              <div>
                <p className="block text-sm font-medium text-muted mb-1">
                  Fechas <span className="text-slate-400 font-normal text-xs">(opcional)</span>
                </p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <span className="block text-sm text-slate-500 mb-1">Inicio</span>
                    <EFDateTimePicker mode="date" value={newSubjectFechaInicio} onChange={setNewSubjectFechaInicio} />
                  </div>
                  <div className="flex-1">
                    <span className="block text-sm text-slate-500 mb-1">Fin</span>
                    <EFDateTimePicker mode="date" value={newSubjectFechaFin} onChange={setNewSubjectFechaFin} />
                  </div>
                </div>
              </div>

              {/* Parciales */}
              <div>
                <p className="block text-sm font-medium text-muted mb-1">
                  Calificaciones parciales <span className="text-slate-400 font-normal text-xs">(por defecto 3)</span>
                </p>
                <div className="grid grid-cols-6 gap-1.5">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNewSubjectParciales(n)}
                      className={`py-2 rounded text-sm font-bold transition-colors ${
                        newSubjectParciales === n
                          ? 'bg-accent text-white'
                          : 'bg-surface-container text-muted hover:bg-[var(--accent-tint)]'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Paleta de color */}
              <div>
                <p className="block text-sm font-medium text-muted mb-2">
                  Color de la asignatura <span className="text-slate-400 font-normal text-xs">(elige el color base que identificará a la asignatura)</span>
                </p>
                <PaletteSelect value={newSubjectPalette} onChange={setNewSubjectPalette} />
              </div>

              {/* Icono */}
              <div {...subjectPaletteProps(newSubjectPalette)}>
                <p className="block text-sm font-medium text-muted mb-2">
                  Icono de la asignatura
                </p>
                <IconSelect value={newSubjectIcon} onChange={setNewSubjectIcon} />
              </div>

              <button
                type="submit"
                disabled={creatingSubject}
                className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {creatingSubject ? <Spinner size="sm" /> : <Plus size={18} />}
                {creatingSubject ? 'Creando…' : 'Crear asignatura'}
              </button>
            </form>
          </div>
        </div>
      )}

    </TeacherLayout>
  )
}
