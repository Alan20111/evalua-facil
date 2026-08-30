import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LogOut, ChevronRight, CalendarDays, Plus, Archive } from 'lucide-react'
import { signOut } from 'firebase/auth'
import { getDoc, doc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import Spinner from './Spinner'
import SubjectIcon from './SubjectIcon'
import { subjectDisplayName } from '../utils/subjectName'
import { getEnrollments, visibleEnrollments } from '../utils/studentLookup'
import PortalBadge from './PortalBadge'
import EFLogo from './EFLogo'
import AppQRButton from './AppQRButton'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'
import StudentBottomNav from './StudentBottomNav'
import PushPermissionPrimer from './PushPermissionPrimer'
import AvisosGate from './AvisosGate'
import SkipLink from './SkipLink'
import { IS_NATIVE_APP } from '../utils/platform'
import { capitalizarNombre } from '../utils/nombres'

// `refreshKey`: el Dashboard del alumno reordena sus asignaturas (flechas
// subir/bajar o arrastrar) SIN desmontar este layout — a diferencia del
// docente, que recarga su barra vía un listener onSnapshot en tiempo real, la
// del alumno usa una consulta puntual, así que el reacomodo no se reflejaba
// hasta navegar a otra pantalla y volver. El Dashboard incrementa este número
// después de cada reorden confirmado; solo necesita cambiar, su valor no se usa.
export default function StudentLayout({ children, refreshKey = 0 }) {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const [subjects, setSubjects] = useState([])
  const [loadingSidebar, setLoadingSidebar] = useState(true)
  const [schoolName, setSchoolName] = useState('')
  const [studentInfo, setStudentInfo] = useState(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showFullLogo, setShowFullLogo] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  useBackHandler(() => setShowLogoutConfirm(false), showLogoutConfirm)
  useScrollLock(showLogoutConfirm)
  useScrollLock(showFullLogo)

  useEffect(() => {
    if (!currentUser) return
    async function run() {
      try {
        const enrollments = await getEnrollments(currentUser, userProfile)
        // `userProfile` (from AuthContext) can fail to resolve the student doc in some
        // edge cases — `getEnrollments` looks it up by `uid` first and is more reliable,
        // so use whichever enrollment it found as a fallback source for name/photo.
        setStudentInfo(enrollments[0] || null)
        // Antes, aquí se detectaba que el correo de la cuenta ya no era el
        // @evalua.local falso y se sellaba el flag para mandar al estudiante a
        // entrar con su correo. Eso se fue: el correo del estudiante NUNCA es
        // su cuenta. Su acceso es siempre el usuario que le dio su maestro, y
        // el correo es un dato aparte para recuperar la contraseña.
        // visibleEnrollments: las que el alumno quitó de sus archivadas no
        // vuelven por la barra lateral.
        const visible = visibleEnrollments(enrollments)
        const subjectIds = [...new Set(visible.map((e) => e.asignaturaId).filter(Boolean))]
        if (subjectIds.length === 0) { setSubjects([]); return }
        // `alumnoOrden` vive en la inscripción (students/{id}), no en la
        // asignatura — es donde el alumno la reordena desde el Dashboard con
        // las flechas subir/bajar. Sin este orden, la barra lateral mostraba
        // las asignaturas en el orden en que llegó la consulta, que no
        // cambiaba al reordenar: se veía "como si no hiciera nada".
        const ordenPorAsignatura = {}
        visible.forEach((e) => { if (e.asignaturaId) ordenPorAsignatura[e.asignaturaId] = e.alumnoOrden })
        const snaps = await Promise.all(subjectIds.map((id) => getDoc(doc(db, 'subjects', id))))
        const loaded = snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }))
        loaded.sort((a, b) => (ordenPorAsignatura[a.id] ?? 0) - (ordenPorAsignatura[b.id] ?? 0))
        setSubjects(loaded)
      } catch {
        setSubjects([])
      } finally {
        setLoadingSidebar(false)
      }
    }
    run()
  }, [currentUser, userProfile, refreshKey])

  useEffect(() => {
    // The student's own `escuelaId` is copied onto their `students` doc at creation
    // time and never updated again — if the teacher later changes their school in
    // Profile, old students keep pointing at the stale one, showing a different
    // name than the teacher's own header. Resolve through the subject's teacher
    // instead, which always reflects their CURRENT school.
    const docenteId = subjects[0]?.docenteId
    if (docenteId) {
      getDoc(doc(db, 'users', docenteId))
        .then((snap) => { if (snap.exists()) setSchoolName(snap.data().schoolName || '') })
        .catch(() => {})
      return
    }
    const eid = userProfile?.escuelaId || studentInfo?.escuelaId
    if (!eid) return
    getDoc(doc(db, 'schools', eid))
      .then((snap) => { if (snap.exists()) setSchoolName(snap.data().shortName || snap.data().nombre || '') })
      .catch(() => {})
  }, [subjects, userProfile?.escuelaId, studentInfo?.escuelaId])

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/alumno')
  }

  // El username va SIN capitalizar (es identificador, no nombre).
  const displayName =
    [userProfile?.nombre, userProfile?.apellidoPaterno, userProfile?.apellidoMaterno].map(capitalizarNombre).filter(Boolean).join(' ')
    || [studentInfo?.nombre, studentInfo?.apellidoPaterno, studentInfo?.apellidoMaterno].map(capitalizarNombre).filter(Boolean).join(' ')
    || userProfile?.username
    || studentInfo?.username
    || 'Estudiante'
  const initials = displayName.charAt(0).toUpperCase()
  const photoURL = userProfile?.photoURL || studentInfo?.photoURL
  // Las archivadas ya no se mezclan con las activas en la lista de arriba:
  // tienen su propia sección al fondo, como en el sidebar del docente.
  const activeSubjects = subjects.filter((s) => !s.archived)
  const archivedSubjects = subjects.filter((s) => s.archived)

  return (
    <div className="min-h-screen bg-surface">
      <SkipLink />
      <PushPermissionPrimer />
      <AvisosGate />
      {/* Mobile top bar */}
      {/* IS_NATIVE_APP: el WebView de Android a veces reporta viewport ≥768px
          activando md:hidden — con IS_NATIVE_APP forzamos el comportamiento
          móvil en la app nativa igual que en Layout.jsx del docente. */}
      <header className={`${IS_NATIVE_APP ? '' : 'md:hidden'} sticky top-0 z-30 bg-surface-card border-b border-outline-variant px-4 py-2.5 flex items-center justify-between shadow-card safe-top`}>
        <button
          type="button"
          onClick={() => setShowFullLogo((v) => !v)}
          aria-label="Ver logo de Evalúa Fácil"
          className="flex items-center gap-2 min-w-0 -ml-1 p-1 rounded hover:bg-accent-tint transition-colors"
        >
          <EFLogo subtitle={false} className="h-8 w-auto flex-shrink-0" />
          {/* eslint-disable-next-line jsx-a11y/aria-role -- role aquí es la prop propia de PortalBadge, no un atributo ARIA */}
          <PortalBadge role="alumno" />
        </button>
        <button
          type="button"
          onClick={() => setShowLogoutConfirm(true)}
          aria-label="Cerrar sesión"
          className="p-2 text-muted hover:text-error rounded transition-colors"
        >
          <LogOut size={20} />
        </button>
      </header>

      {/* Desktop: sidebar + content.
          App nativa: sin flex row (causa franja derecha en Samsung S23). */}
      <div className={IS_NATIVE_APP ? '' : 'flex'}>
        {/* Sidebar — desktop only. data-role="docente" forces the institutional
            blue regardless of the parent's data-role="alumno" accent override. */}
        <aside
          data-role="docente"
          className={`${IS_NATIVE_APP ? 'hidden' : 'hidden md:flex'} flex-col w-[300px] h-screen sticky top-0 bg-accent text-white flex-shrink-0 z-20`}
        >
          {/* Logo — siempre sobre blanco: recuadro blanco sobre el azul del sidebar. */}
          <div className="px-3 pt-2 pb-1">
            <div className="bg-white rounded-card px-3 py-2.5 shadow-card">
              <EFLogo className="w-full h-auto" />
            </div>
            {/* Versión y etiqueta de rol comparten renglón: versión a la izquierda,
                rol a la derecha. La versión es solo de la web — en la app vive en
                Perfil, debajo del aviso de privacidad, y la etiqueta se queda sola.
                data-role="alumno" reafirma el naranja del alumno solo para esta
                insignia — el resto del sidebar se queda en el azul institucional. */}
            <div className="flex items-center gap-2 pt-1" data-role="alumno">
              {!IS_NATIVE_APP && (
                <p className="text-metadata text-white/50 pl-1">v.1.0.1</p>
              )}
              {/* eslint-disable-next-line jsx-a11y/aria-role -- role aquí es la prop propia de PortalBadge, no un atributo ARIA */}
              <PortalBadge role="alumno" className="ml-auto" />
            </div>
          </div>

          {/* Identidad → clic = Mi perfil (la foto se cambia DENTRO del perfil —
              una sola casa por función, Don't Make Me Think). Pegado al logo
              (sin mt-1), mismo criterio que el panel del docente (Layout.jsx),
              para que el nombre y la foto suban y aprovechen mejor el espacio. */}
          <button
            type="button"
            onClick={() => navigate('/alumno/perfil')}
            className="flex items-center gap-3 px-3 py-2 mx-2 rounded text-left hover:bg-white/10 transition-colors focus:outline-none"
            data-tooltip="Mi perfil"
          >
            {/* 65px pedido explícito. */}
            <div className="w-[65px] h-[65px] rounded-full bg-white overflow-hidden flex items-center justify-center flex-shrink-0">
              {photoURL ? (
                <img src={photoURL} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-accent">{initials}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              {/* Mismos tamaños que el nombre del docente y de la escuela en
                  el panel del docente (Layout.jsx) — pedido explícito. */}
              <p className="text-[18px] font-semibold text-white truncate">{displayName}</p>
              {schoolName && (
                <p className="text-[16px] text-white/70 truncate">{schoolName}</p>
              )}
            </div>
            <ChevronRight size={14} className="text-white/50 flex-shrink-0" />
          </button>

          {/* Agenda — debajo del perfil, único enlace fijo del sidebar (sin
              Notificaciones aquí: en la web solo vive en la barra inferior
              cuando se navega desde un móvil; la escritorio no le da casa). */}
          <NavLink
            to="/alumno/agenda"
            className={({ isActive }) =>
              `flex items-center gap-2.5 mx-2 mt-1.5 px-3 py-2.5 rounded-card text-base font-semibold transition-colors ${
                isActive
                  ? 'bg-white text-accent shadow-card'
                  : 'bg-white/15 text-white hover:bg-white/25 ring-1 ring-white/30'
              }`
            }
          >
            <CalendarDays size={20} className="flex-shrink-0" />
            Agenda
          </NavLink>

          {/* Subjects heading — links to dashboard */}
          <NavLink
            to="/alumno/dashboard"
            className="mx-2 px-2 pt-4 pb-1 flex items-center justify-between rounded hover:bg-white/10 transition-colors group"
          >
            {/* Mismo tamaño y tratamiento que "Asignaturas" en el panel del
                docente (Layout.jsx): 22px, sin `uppercase` — "Asignaturas"
                con A mayúscula y el resto en minúsculas, no en mayúsculas
                sostenidas. */}
            <span className="text-[22px] font-bold text-white/70 group-hover:text-white transition-colors">
              Asignaturas
            </span>
            <ChevronRight size={18} className="text-white/50 group-hover:text-white transition-colors flex-shrink-0" />
          </NavLink>

          {/* Subject list */}
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {loadingSidebar ? (
              <div className="flex justify-center py-3">
                <Spinner size="sm" />
              </div>
            ) : activeSubjects.length === 0 ? (
              <p className="text-body-sm text-white/70 px-3 py-2">Sin asignaturas aún</p>
            ) : (
              activeSubjects.map((s) => (
                <NavLink
                  key={s.id}
                  to={`/alumno/materia/${s.id}`}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-1.5 rounded text-body-sm transition-colors ${
                      isActive ? 'bg-white text-accent font-semibold' : 'text-white/90 hover:bg-white/10'
                    }`
                  }
                >
                  <SubjectIcon iconKey={s.icon} size={17} className="flex-shrink-0" />
                  <span className="truncate">{subjectDisplayName(s)}</span>
                </NavLink>
              ))
            )}

            {/* Unirme a otra asignatura — gemelo del "Nueva asignatura…" del
                docente, y por lo mismo NO abre el modal aquí: navega al
                dashboard con `openJoin` para que el modal viva en un solo
                lugar. En la app este botón ya estaba en el dashboard; a la web
                le faltaba porque el sidebar es su casa natural en escritorio. */}
            <button
              type="button"
              onClick={() => navigate('/alumno/dashboard', { state: { openJoin: true } })}
              className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-body-sm font-medium text-white hover:bg-white/10 transition-colors mt-1"
            >
              <Plus size={17} />
              Unirme a otra asignatura…
            </button>
          </div>

          {/* QR de descarga de la app — arriba de Archivadas, igual que en el
              panel del docente. Fuera de cualquier asignatura porque el QR es
              el mismo para todas: la app es una sola y el perfil se elige al
              abrirla. */}
          <div className="px-2 pt-2 border-t border-white/15">
            <AppQRButton
              className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-body-sm font-medium text-white/80 hover:bg-white/10 transition-colors disabled:opacity-60"
            >
              QR para descargar la app
            </AppQRButton>
          </div>

          {/* Archivadas — al fondo, arriba de "Cerrar sesión", igual que en el
              sidebar del docente. Solo si el maestro ya archivó alguna; el
              alumno nunca archiva por su cuenta. Aquí solo se navega: quitarlas
              de su lista se hace en el dashboard, que es donde vive esa acción. */}
          {archivedSubjects.length > 0 && (
            <div className="px-2 pt-2 max-h-48 overflow-y-auto">
              {/* Mismo tratamiento que en el panel del docente (Layout.jsx):
                  flecha a la DERECHA de la palabra, que gira al desplegar. */}
              <button
                type="button"
                onClick={() => setShowArchived((a) => !a)}
                aria-expanded={showArchived}
                className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-body-sm text-white/60 hover:bg-white/10 transition-colors"
              >
                <Archive size={15} className="flex-shrink-0" />
                <span className="flex-1 text-left">Archivadas ({archivedSubjects.length})</span>
                <ChevronRight size={14} className={`flex-shrink-0 transition-transform ${showArchived ? 'rotate-90' : ''}`} />
              </button>
              {showArchived &&
                archivedSubjects.map((s) => (
                  // pl-10: mismo sangrado que en el docente — el nombre debe
                  // empezar más a la derecha de donde arranca la palabra
                  // "Archivadas" en el botón de arriba, para leerse "dentro".
                  <NavLink
                    key={s.id}
                    to={`/alumno/materia/${s.id}`}
                    className={({ isActive }) =>
                      `flex items-center gap-2 pl-10 pr-3 py-2 rounded text-body-sm transition-colors ${
                        isActive ? 'bg-white text-accent font-semibold' : 'text-white/70 hover:bg-white/15'
                      }`
                    }
                  >
                    <SubjectIcon iconKey={s.icon} size={17} className="flex-shrink-0" />
                    <span className="truncate">{subjectDisplayName(s)}</span>
                  </NavLink>
                ))}
            </div>
          )}

          {/* Logout */}
          <div className="px-2 py-2 border-t border-white/15">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-body-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              <LogOut size={17} />
              Cerrar sesión
            </button>
          </div>
        </aside>

        {/* Main content — pb reserva el alto de la barra inferior (5rem) MÁS el
            inset de seguridad de Android que ya se le suma a esa barra
            (.safe-bottom en <nav> abajo); si no, el último contenido de cada
            página queda tapado detrás de la barra. Mismo estándar que el docente. */}
        <main
          id="main-content"
          tabIndex={-1}
          className={`${IS_NATIVE_APP ? 'w-full overflow-x-hidden' : 'flex-1 min-w-0'} min-h-screen pb-[calc(5rem+env(safe-area-inset-bottom,0px))] ${IS_NATIVE_APP ? '' : 'md:pb-0'} focus:outline-none`}
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom nav — mismo estándar que la App del docente */}
      <StudentBottomNav />

      {/* Confirmación antes de cerrar sesión (header móvil) */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/40 border-none cursor-default"
            onClick={() => setShowLogoutConfirm(false)}
            aria-label="Cancelar"
          />
          <div className="relative bg-surface-card w-[calc(100%-2rem)] max-w-sm rounded-card p-4 shadow-2xl">
            <h3 className="text-base font-semibold text-on-surface">¿Cerrar sesión?</h3>
            <p className="text-sm text-muted mt-2">
              Vas a salir de tu cuenta. Puedes volver a entrar cuando quieras con tu usuario y contraseña.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => { setShowLogoutConfirm(false); handleLogout() }}
                className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
              >
                Sí, cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logo completo — se abre al tocar el ícono de la barra superior, se cierra tocando el fondo */}
      {showFullLogo && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60">
          <button
            type="button"
            className="absolute inset-0 border-none cursor-default"
            onClick={() => setShowFullLogo(false)}
            aria-label="Cerrar logo"
          />
          <div className="relative bg-white rounded-card px-6 py-5 shadow-2xl pointer-events-none">
            <EFLogo className="w-56 sm:w-72 h-auto" />
          </div>
        </div>
      )}
    </div>
  )
}
