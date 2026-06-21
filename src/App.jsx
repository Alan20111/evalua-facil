import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './components/Toast'

import TeacherLogin from './pages/teacher/Login'
import TeacherRegister from './pages/teacher/Register'
import RegisterSchool from './pages/teacher/RegisterSchool'
import TeacherDashboard from './pages/teacher/Dashboard'
import SubjectPage from './pages/teacher/SubjectPage'
import ActivityPage from './pages/teacher/ActivityPage'
import Profile from './pages/teacher/Profile'
import VerifyEmail from './pages/teacher/VerifyEmail'
import PagoResultado from './pages/teacher/PagoResultado'

import StudentActivation from './pages/student/Activation'
import StudentLogin from './pages/student/Login'
import StudentDashboard from './pages/student/Dashboard'
import StudentSubjectPage from './pages/student/SubjectPage'
import StudentActivityPage from './pages/student/ActivityPage'

import AdminDashboard from './pages/admin/Dashboard'

function ProtectedAdmin({ children }) {
  const { currentUser, userProfile, loading } = useAuth()
  if (loading) return null
  if (!currentUser) return <Navigate to="/" replace />
  if (userProfile?.role !== 'admin') return <Navigate to="/" replace />
  return children
}

function ProtectedTeacher({ children }) {
  const { currentUser, userProfile, loading } = useAuth()
  if (loading) return null
  if (!currentUser) return <Navigate to="/" replace />
  if (userProfile?.role === 'admin') return <Navigate to="/Admin" replace />
  if (userProfile && userProfile.role !== 'docente') return <Navigate to="/alumno" replace />
  return children
}

function ProtectedStudent({ children }) {
  const { currentUser } = useAuth()
  if (!currentUser) return <Navigate to="/alumno" replace />
  return children
}

function RootRedirect() {
  const { currentUser, userProfile, loading } = useAuth()
  if (loading) return null
  if (!currentUser) return <TeacherLogin />
  if (userProfile?.role === 'admin') return <Navigate to="/Admin" replace />
  if (userProfile?.role === 'docente') return <Navigate to="/dashboard" replace />
  if (!userProfile) {
    if (currentUser.email?.endsWith('@evalua.local')) return <Navigate to="/alumno/dashboard" replace />
    return null
  }
  return <Navigate to="/alumno/dashboard" replace />
}

// Sets the accent theme by role: orange for students (incl. pre-auth /alumno and
// /activate routes), blue for everyone else. Identity elements read --accent.
function RoleWrapper({ children }) {
  const { userProfile } = useAuth()
  const { pathname } = useLocation()
  const isStudentRoute = pathname.startsWith('/alumno') || pathname.startsWith('/activate')
  const role = userProfile?.role === 'alumno' || isStudentRoute ? 'alumno' : 'docente'
  return <div data-role={role}>{children}</div>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <RoleWrapper>
          <Routes>
            {/* Public */}
            <Route path="/" element={<RootRedirect />} />
            <Route path="/docente" element={<RootRedirect />} />
            <Route path="/register" element={<TeacherRegister />} />
            <Route path="/register/school" element={<RegisterSchool />} />
            <Route path="/alumno" element={<StudentLogin />} />
            <Route path="/activate/:accessCode" element={<StudentActivation />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/pago-resultado" element={<PagoResultado />} />

            {/* Admin protected */}
            <Route path="/Admin" element={<ProtectedAdmin><AdminDashboard /></ProtectedAdmin>} />

            {/* Teacher protected */}
            <Route path="/dashboard" element={<ProtectedTeacher><TeacherDashboard /></ProtectedTeacher>} />
            <Route path="/subject/:subjectId" element={<ProtectedTeacher><SubjectPage /></ProtectedTeacher>} />
            <Route path="/activity/:activityId" element={<ProtectedTeacher><ActivityPage /></ProtectedTeacher>} />
            <Route path="/profile" element={<ProtectedTeacher><Profile /></ProtectedTeacher>} />

            {/* Student protected */}
            <Route path="/alumno/dashboard" element={<ProtectedStudent><StudentDashboard /></ProtectedStudent>} />
            <Route path="/alumno/materia/:subjectId" element={<ProtectedStudent><StudentSubjectPage /></ProtectedStudent>} />
            <Route path="/alumno/actividad/:activityId" element={<ProtectedStudent><StudentActivityPage /></ProtectedStudent>} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </RoleWrapper>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
