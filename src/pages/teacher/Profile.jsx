import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import TeacherLayout from '../../components/Layout'
import { User, School, LogOut, BookOpen } from 'lucide-react'

export default function Profile() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/')
  }

  return (
    <TeacherLayout>
      <div className="max-w-xl mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-slate-900 mb-6">Mi perfil</h1>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {/* Avatar */}
          <div className="bg-indigo-600 p-6 flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mb-3">
              <User size={28} className="text-white" />
            </div>
            <p className="text-white font-bold text-lg">{userProfile?.nombre}</p>
            <p className="text-indigo-200 text-sm mt-0.5">Docente</p>
          </div>

          {/* Info */}
          <div className="divide-y divide-slate-100">
            <div className="px-5 py-4 flex items-center gap-3">
              <BookOpen size={18} className="text-slate-400" />
              <div>
                <p className="text-xs text-slate-400">Correo</p>
                <p className="text-sm font-medium text-slate-900">{userProfile?.email}</p>
              </div>
            </div>
            <div className="px-5 py-4 flex items-center gap-3">
              <School size={18} className="text-slate-400" />
              <div>
                <p className="text-xs text-slate-400">Escuela</p>
                <p className="text-sm font-medium text-slate-900">{userProfile?.schoolName || '—'}</p>
                {userProfile?.claveSEP && (
                  <p className="text-xs text-slate-400 mt-0.5">Clave SEP: {userProfile.claveSEP}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full mt-6 py-3 border border-red-200 text-red-500 rounded-xl font-semibold hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
        >
          <LogOut size={18} /> Cerrar sesión
        </button>
      </div>
    </TeacherLayout>
  )
}
