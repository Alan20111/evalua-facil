import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './components/Toast'
import AndroidBackButton from './components/AndroidBackButton'
import EscKeyHandler from './components/EscKeyHandler'
import PwaInstallPrompt from './components/PwaInstallPrompt'
import UpdateChecker from './components/UpdateChecker'
import { needsPasswordSetup } from './utils/authLinking'
import { installDraggableOverlays } from './utils/draggableOverlays'
import { installFollowTooltips } from './utils/followTooltip'
import { installWheelStep } from './utils/wheelStep'
import TeacherLayout from './components/Layout'
import { EsqueletoSesion } from './components/esqueletos'
import { esqueletoDeContenidoDocente, esqueletoDeSesion } from './components/esqueletos/porRuta'
import { CargaFallida, Espera } from './components/carga/Espera'

import Landing from './pages/Landing'
import TeacherLogin from './pages/teacher/Login'

import StudentLogin from './pages/student/Login'

import { docenteSinEscuela } from './utils/escuela'

// Cada página es su propio archivo de JS y se descarga al entrar a ella
// (antes todo iba en un solo paquete de 4 MB / 1.1 MB comprimido: en un
// teléfono con 4G tardaba ~7 s solo en llegar, oct-2026). Login y portada
// siguen en el paquete inicial porque son la primera pantalla de quien no
// tiene sesión. Tras entrar, precargarPaginas() baja en segundo plano las
// del rol para que navegar siga siendo instantáneo.
const paginas = {
  TeacherRegister: () => import('./pages/teacher/Register'),
  ResetPassword: () => import('./pages/teacher/ResetPassword'),
  Onboarding: () => import('./pages/teacher/Onboarding'),
  ProtectAccount: () => import('./pages/teacher/ProtectAccount'),
  TeacherDashboard: () => import('./pages/teacher/Dashboard'),
  SubjectPage: () => import('./pages/teacher/SubjectPage'),
  ActivityPage: () => import('./pages/teacher/ActivityPage'),
  Profile: () => import('./pages/teacher/Profile'),
  PerfilIA: () => import('./pages/teacher/PerfilIA'),
  CalendarPage: () => import('./pages/teacher/CalendarPage'),
  VerifyEmail: () => import('./pages/teacher/VerifyEmail'),
  Privacidad: () => import('./pages/Privacidad'),
  DescargaApp: () => import('./pages/DescargaApp'),
  TeacherNotificationSettings: () => import('./pages/teacher/NotificationSettings'),
  AyudaPage: () => import('./pages/teacher/AyudaPage'),
  StudentActivation: () => import('./pages/student/Activation'),
  StudentDashboard: () => import('./pages/student/Dashboard'),
  StudentSubjectPage: () => import('./pages/student/SubjectPage'),
  StudentActivityPage: () => import('./pages/student/ActivityPage'),
  EvaluacionRunner: () => import('./pages/student/EvaluacionRunner'),
  JuegoRunner: () => import('./pages/student/JuegoRunner'),
  EvaluacionRevision: () => import('./pages/student/EvaluacionRevision'),
  NotificationSettings: () => import('./pages/student/NotificationSettings'),
  StudentAgenda: () => import('./pages/student/Agenda'),
  StudentProfile: () => import('./pages/student/Profile'),
  StudentTipsPage: () => import('./pages/student/TipsPage'),
  StudentMiEspacio: () => import('./pages/student/MiEspacio'),
  AdminDashboard: () => import('./pages/admin/Dashboard'),
}
// La página de la URL con la que se abrió la app se pide YA, a la par de la
// sesión. Si se esperara a que React llegue a la ruta, su código no saldría
// hasta resolver Auth + perfil (~6 s en 4G) y luego aún habría que bajarlo.
const PAGINA_INICIAL = [
  [/^\/dashboard$/, 'TeacherDashboard'],
  [/^\/subject\//, 'SubjectPage'],
  [/^\/activity\//, 'ActivityPage'],
  [/^\/calendario$/, 'CalendarPage'],
  [/^\/profile$/, 'Profile'],
  [/^\/ayuda$/, 'AyudaPage'],
  [/^\/Admin$/, 'AdminDashboard'],
  [/^\/register$/, 'TeacherRegister'],
  [/^\/activate\//, 'StudentActivation'],
  [/^\/alumno\/dashboard$/, 'StudentDashboard'],
  [/^\/alumno\/materia\//, 'StudentSubjectPage'],
  [/^\/alumno\/actividad\//, 'StudentActivityPage'],
  [/^\/alumno\/agenda$/, 'StudentAgenda'],
  [/^\/alumno\/perfil$/, 'StudentProfile'],
].find(([re]) => re.test(window.location.pathname))?.[1]
if (PAGINA_INICIAL) paginas[PAGINA_INICIAL]().catch(() => {})
const TeacherRegister = lazy(paginas.TeacherRegister)
const ResetPassword = lazy(paginas.ResetPassword)
const Onboarding = lazy(paginas.Onboarding)
const ProtectAccount = lazy(paginas.ProtectAccount)
const TeacherDashboard = lazy(paginas.TeacherDashboard)
const SubjectPage = lazy(paginas.SubjectPage)
const ActivityPage = lazy(paginas.ActivityPage)
const Profile = lazy(paginas.Profile)
const PerfilIA = lazy(paginas.PerfilIA)
const CalendarPage = lazy(paginas.CalendarPage)
const VerifyEmail = lazy(paginas.VerifyEmail)
const Privacidad = lazy(paginas.Privacidad)
const DescargaApp = lazy(paginas.DescargaApp)
const TeacherNotificationSettings = lazy(paginas.TeacherNotificationSettings)
const AyudaPage = lazy(paginas.AyudaPage)
const StudentActivation = lazy(paginas.StudentActivation)
const StudentDashboard = lazy(paginas.StudentDashboard)
const StudentSubjectPage = lazy(paginas.StudentSubjectPage)
const StudentActivityPage = lazy(paginas.StudentActivityPage)
const EvaluacionRunner = lazy(paginas.EvaluacionRunner)
const JuegoRunner = lazy(paginas.JuegoRunner)
const EvaluacionRevision = lazy(paginas.EvaluacionRevision)
const NotificationSettings = lazy(paginas.NotificationSettings)
const StudentAgenda = lazy(paginas.StudentAgenda)
const StudentProfile = lazy(paginas.StudentProfile)
const StudentTipsPage = lazy(paginas.StudentTipsPage)
const StudentMiEspacio = lazy(paginas.StudentMiEspacio)
const AdminDashboard = lazy(paginas.AdminDashboard)

function ProtectedAdmin({ children }) {
  const { currentUser, userProfile, loading } = useAuth()
  if (loading) return <EsqueletoSesion />
  if (!currentUser) return <Navigate to="/" replace />
  if (userProfile?.role !== 'admin') return <Navigate to="/" replace />
  return children
}

// Shown when the user is authenticated but their Firestore profile could not be
// loaded (e.g. a network error hit the getDoc in AuthContext). Gives a recovery
// path without a blank screen, a redirect loop, or a forced logout.
function ProfileErrorScreen() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-surface px-4">
      <div className="bg-surface-card rounded-card shadow-card p-8 max-w-sm w-full text-center">
        <p className="text-on-surface font-semibold mb-2">Error al cargar tu perfil</p>
        <p className="text-muted text-sm mb-4">
          No pudimos conectar con el servidor.<br />
          Revisa tu conexión e intenta de nuevo.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 bg-accent text-white text-sm font-semibold rounded-full hover:bg-accent-hover transition-colors"
        >
          Recargar
        </button>
      </div>
    </div>
  )
}

function ProtectedTeacher({ children }) {
  const { currentUser, userProfile, loading } = useAuth()
  if (loading) return <EsqueletoSesion />
  if (!currentUser) return <Navigate to="/" replace />
  if (userProfile?.role === 'admin') return <Navigate to="/Admin" replace />
  if (userProfile && userProfile.role !== 'docente') return <Navigate to="/alumno" replace />
  if (!userProfile) return <ProfileErrorScreen />
  if (
    needsPasswordSetup(currentUser) &&
    sessionStorage.getItem('protectAccountSkipped') !== '1'
  ) {
    return <Navigate to="/protect-account" replace />
  }
  if (userProfile.profileComplete === false) {
    return <Navigate to="/onboarding" replace />
  }
  // TODO DOCENTE PERTENECE A UNA ESCUELA (regla de negocio, 30-ago-2026 — ver
  // utils/escuela.js). Las cuentas de antes pudieron quedarse sin escuela real
  // (el centinela compartido `sin-escuela`, o sin el campo siquiera), y de ahí
  // salían asignaturas y estudiantes que ningún compañero de plantel podía
  // encontrar. No se les adivina la escuela ni se les toca el dato: se les
  // pide, una sola vez, en la misma pantalla del alta.
  if (docenteSinEscuela(userProfile)) {
    return <Navigate to="/onboarding" replace />
  }
  return children
}

// Same auth/role checks as ProtectedTeacher but WITHOUT the profileComplete
// redirect — used only by /onboarding itself, to avoid a redirect loop.
function ProtectedTeacherOnboarding({ children }) {
  const { currentUser, userProfile, loading } = useAuth()
  if (loading) return <EsqueletoSesion />
  if (!currentUser) return <Navigate to="/" replace />
  if (userProfile?.role === 'admin') return <Navigate to="/Admin" replace />
  if (userProfile && userProfile.role !== 'docente') return <Navigate to="/alumno" replace />
  if (!userProfile) return <ProfileErrorScreen />
  return children
}

// Same auth/role checks as ProtectedTeacher but WITHOUT the password-setup
// redirect — used only by /protect-account itself, to avoid a redirect loop.
function ProtectedTeacherProtectAccount({ children }) {
  const { currentUser, userProfile, loading } = useAuth()
  if (loading) return <EsqueletoSesion />
  if (!currentUser) return <Navigate to="/" replace />
  if (userProfile?.role === 'admin') return <Navigate to="/Admin" replace />
  if (userProfile && userProfile.role !== 'docente') return <Navigate to="/alumno" replace />
  if (!userProfile) return <ProfileErrorScreen />
  return children
}

// Layout compartido de las rutas del docente: se monta UNA sola vez y
// persiste mientras se navega entre /dashboard, /subject/:id, /calendario…
// (el <Outlet/> es lo único que cambia). Antes cada página envolvía su propio
// <TeacherLayout>, así que React lo desmontaba y volvía a montar en cada
// navegación — el sidebar se vaciaba y se volvía a llenar (spinner, refetch
// de asignaturas, banner de prueba) en cada clic, el parpadeo reportado.
function TeacherLayoutRoute() {
  const { pathname } = useLocation()
  return (
    <TeacherLayout>
      {/* Mientras llega el código de la página, su esqueleto DENTRO del layout
          (las barras ya están pintadas y no parpadean). */}
      <CargaFallida key={pathname}>
        <Suspense fallback={<Espera>{esqueletoDeContenidoDocente(pathname)}</Espera>}>
          <Outlet />
        </Suspense>
      </CargaFallida>
    </TeacherLayout>
  )
}

// Fuera del layout del docente (alumno, admin, registro…): pantalla completa.
function EsperaPagina() {
  const { pathname } = useLocation()
  const esqueleto = esqueletoDeSesion(pathname)
  return esqueleto ? <Espera>{esqueleto}</Espera> : null
}

// Ya con sesión, baja en segundo plano las páginas de su rol (cuando el
// navegador está desocupado) para que el primer clic a cada una no espere red.
const PAGINAS_POR_ROL = {
  docente: ['TeacherDashboard', 'SubjectPage', 'ActivityPage', 'CalendarPage', 'Profile', 'AyudaPage', 'TeacherNotificationSettings', 'PerfilIA'],
  alumno: ['StudentDashboard', 'StudentSubjectPage', 'StudentActivityPage', 'StudentAgenda', 'StudentProfile', 'EvaluacionRunner', 'NotificationSettings', 'StudentMiEspacio', 'StudentTipsPage'],
  admin: ['AdminDashboard'],
}
function PrecargaPaginas() {
  const { userProfile } = useAuth()
  const rol = userProfile?.role
  useEffect(() => {
    const lista = PAGINAS_POR_ROL[rol]
    if (!lista) return
    // 4 s de gracia: que la página actual termine de traer SUS datos antes de
    // gastar red en las demás (en 4G compiten por el mismo ancho de banda).
    let idle
    const t = setTimeout(() => {
      const enReposo = window.requestIdleCallback || ((fn) => setTimeout(fn, 0))
      idle = enReposo(() => { for (const n of lista) paginas[n]().catch(() => {}) })
    }, 4000)
    return () => { clearTimeout(t); if (idle != null) (window.cancelIdleCallback || clearTimeout)(idle) }
  }, [rol])
  return null
}

function ProtectedStudent({ children }) {
  const { currentUser, userProfile, loading } = useAuth()
  if (loading) return <EsqueletoSesion />
  if (!currentUser) return <Navigate to="/alumno" replace />
  if (userProfile && userProfile.role !== 'alumno') return <Navigate to="/dashboard" replace />
  return children
}

// Redirects an authenticated user to their dashboard; otherwise renders `guest`.
function RootRedirect({ guest = <TeacherLogin /> }) {
  const { currentUser, userProfile, loading } = useAuth()
  if (loading) return null
  if (!currentUser) return guest
  if (userProfile?.role === 'admin') return <Navigate to="/Admin" replace />
  if (userProfile?.role === 'docente') return <Navigate to="/dashboard" replace />
  if (!userProfile) {
    if (currentUser.email?.endsWith('@evalua.local')) return <Navigate to="/alumno/dashboard" replace />
    return <ProfileErrorScreen />
  }
  return <Navigate to="/alumno/dashboard" replace />
}

// Same idea as RootRedirect but for /alumno: a student who's already signed in
// (e.g. bounced here from the "ya está en tu cuenta" edge case while joining a
// subject they're already enrolled in) should land on their dashboard instead
// of a confusing login form that makes it look like they got signed out.
function StudentRootRedirect() {
  const { currentUser, userProfile, loading } = useAuth()
  if (loading) return null
  if (!currentUser) return <StudentLogin />
  if (userProfile?.role === 'alumno') return <Navigate to="/alumno/dashboard" replace />
  if (!userProfile && currentUser.email?.endsWith('@evalua.local')) return <Navigate to="/alumno/dashboard" replace />
  return <StudentLogin />
}

// Sets the accent theme by role: orange for students (incl. pre-auth /alumno and
// /activate routes), guinda for admins, blue for everyone else. Identity
// elements read --accent (ver [data-role] en src/index.css).
function RoleWrapper({ children }) {
  const { userProfile } = useAuth()
  const { pathname } = useLocation()
  const isStudentRoute = pathname.startsWith('/alumno') || pathname.startsWith('/activate')
  const role = userProfile?.role === 'alumno' || isStudentRoute
    ? 'alumno'
    : userProfile?.role === 'admin'
      ? 'admin'
      : 'docente'
  return <div data-role={role}>{children}</div>
}

// Every popup in the app becomes draggable (mouse) — installed once, module-level guard
installDraggableOverlays()
// Cursor-following tooltips for wide triggers ([data-tooltip-follow])
installFollowTooltips()
// Wheel-steps numeric inputs ([data-wheel-step]) without scrolling the page
installWheelStep()

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <RoleWrapper>
          <AndroidBackButton />
          <EscKeyHandler />
          <UpdateChecker />
          <PrecargaPaginas />
          <CargaFallida>
          <Suspense fallback={<EsperaPagina />}>
          <Routes>
            {/* Public */}
            <Route path="/" element={<RootRedirect guest={<Landing />} />} />
            <Route path="/docente" element={<RootRedirect />} />
            <Route path="/register" element={<TeacherRegister />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/alumno" element={<StudentRootRedirect />} />
            <Route path="/activate/:accessCode" element={<StudentActivation />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/privacidad" element={<Privacidad />} />
            <Route path="/privacy" element={<Privacidad />} />

            {/* Descarga directa del APK de Android — ruta NO listada, a propósito.
                Los slugs se generan desde el panel de admin (pestaña Descargas);
                no la enlaces desde ningún menú ni la publiques. Si el link se filtra,
                basta con cambiar el slug de aquí abajo para invalidarlo. */}
            <Route path="/descarga/:slug" element={<DescargaApp />} />
            {/* Ruta FIJA que resuelve sola a la versión de producción vigente.
                Es la que se enlaza desde el login del docente, para no tener que
                editar código cada vez que se publica una versión nueva. */}
            <Route path="/descargar" element={<DescargaApp />} />

            {/* Admin protected */}
            <Route path="/Admin" element={<ProtectedAdmin><AdminDashboard /></ProtectedAdmin>} />

            {/* Teacher protected */}
            <Route path="/onboarding" element={<ProtectedTeacherOnboarding><Onboarding /></ProtectedTeacherOnboarding>} />
            <Route path="/protect-account" element={<ProtectedTeacherProtectAccount><ProtectAccount /></ProtectedTeacherProtectAccount>} />
            {/* Layout compartido — un solo TeacherLayout montado para las 6 rutas;
                ver TeacherLayoutRoute arriba. */}
            <Route element={<ProtectedTeacher><TeacherLayoutRoute /></ProtectedTeacher>}>
              <Route path="/dashboard" element={<TeacherDashboard />} />
              <Route path="/subject/:subjectId" element={<SubjectPage />} />
              <Route path="/activity/:activityId" element={<ActivityPage />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/perfil-ia" element={<PerfilIA />} />
              <Route path="/calendario" element={<CalendarPage />} />
              <Route path="/notificaciones" element={<TeacherNotificationSettings />} />
              <Route path="/ayuda" element={<AyudaPage />} />
              <Route path="/manual" element={<Navigate to="/ayuda" replace />} />
            </Route>

            {/* Student protected */}
            <Route path="/alumno/dashboard" element={<ProtectedStudent><StudentDashboard /></ProtectedStudent>} />
            <Route path="/alumno/materia/:subjectId" element={<ProtectedStudent><StudentSubjectPage /></ProtectedStudent>} />
            <Route path="/alumno/actividad/:activityId" element={<ProtectedStudent><StudentActivityPage /></ProtectedStudent>} />
            <Route path="/alumno/evaluacion/:activityId" element={<ProtectedStudent><EvaluacionRunner /></ProtectedStudent>} />
            <Route path="/alumno/evaluacion/:activityId/revision" element={<ProtectedStudent><EvaluacionRevision /></ProtectedStudent>} />
            <Route path="/alumno/juego/:activityId" element={<ProtectedStudent><JuegoRunner /></ProtectedStudent>} />
            <Route path="/alumno/notificaciones" element={<ProtectedStudent><NotificationSettings /></ProtectedStudent>} />
            <Route path="/alumno/agenda" element={<ProtectedStudent><StudentAgenda /></ProtectedStudent>} />
            <Route path="/alumno/perfil" element={<ProtectedStudent><StudentProfile /></ProtectedStudent>} />
            <Route path="/alumno/tips" element={<ProtectedStudent><StudentTipsPage /></ProtectedStudent>} />
            <Route path="/alumno/mi-espacio" element={<ProtectedStudent><StudentMiEspacio /></ProtectedStudent>} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
          </CargaFallida>
          <PwaInstallPrompt />
          </RoleWrapper>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
