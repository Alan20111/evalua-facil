import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './components/Toast'

import TeacherLogin from './pages/teacher/Login'
import TeacherRegister from './pages/teacher/Register'
import RegisterSchool from './pages/teacher/RegisterSchool'
import TeacherDashboard from './pages/teacher/Dashboard'
import SubjectPage from './pages/teacher/SubjectPage'
import ActivityPage from './pages/teacher/ActivityPage'
import Profile from './pages/teacher/Profile'

import StudentActivation from './pages/student/Activation'
import StudentLogin from './pages/student/Login'
import StudentDashboard from './pages/student/Dashboard'
import StudentSubjectPage from './pages/student/SubjectPage'
import StudentActivityPage from './pages/student/ActivityPage'

// A teacher who signed up with email/password must verify their email before
// accessing the app. Google accounts are pre-verified; students use fake
// @evalua.local emails and are exempt from this check.
function isUnverifiedTeacher(user) {
  return !!user && !user.emailVerified && !user.email?.endsWith('@evalua.local')
}

function ProtectedTeacher({ children }) {
  const { currentUser, userProfile } = useAuth()
  if (!currentUser) return <Navigate to="/" replace />
  if (isUnverifiedTeacher(currentUser)) return <Navigate to="/" replace />
  if (userProfile && userProfile.role !== 'docente') return <Navigate to="/alumno" replace />
  return children
}

function ProtectedStudent({ children }) {
  const { currentUser, userProfile } = useAuth()
  if (!currentUser) return <Navigate to="/alumno" replace />
  return children
}

function RootRedirect() {
  const { currentUser, userProfile } = useAuth()
  if (!currentUser) return <TeacherLogin />
  // Authenticated but unverified email teacher: keep them on the login screen
  // (which offers the resend-verification path) rather than redirecting into the
  // protected app — this also prevents a redirect loop with ProtectedTeacher.
  if (isUnverifiedTeacher(currentUser)) return <TeacherLogin />
  if (userProfile?.role === 'docente') return <Navigate to="/dashboard" replace />
  // Student accounts use @evalua.local emails; a non-student with no profile is a
  // new Google sign-in waiting for handleGoogle to navigate to /register/school.
  if (!userProfile) {
    if (currentUser.email?.endsWith('@evalua.local')) return <Navigate to="/alumno/dashboard" replace />
    return null
  }
  return <Navigate to="/alumno/dashboard" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            {/* Public */}
            <Route path="/" element={<RootRedirect />} />
            <Route path="/docente" element={<RootRedirect />} />
            <Route path="/register" element={<TeacherRegister />} />
            <Route path="/register/school" element={<RegisterSchool />} />
            <Route path="/alumno" element={<StudentLogin />} />
            <Route path="/activate/:accessCode" element={<StudentActivation />} />

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
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
