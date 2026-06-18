import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import Spinner from '../../components/Spinner'

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { currentUser, loading: authLoading, setUserProfile } = useAuth()
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    if (authLoading) return

    const uid = searchParams.get('uid')
    const token = searchParams.get('token')

    if (!uid || !token) {
      setStatus('error')
      return
    }

    if (!currentUser) {
      localStorage.setItem('pendingVerify', JSON.stringify({ uid, token }))
      navigate('/docente', { replace: true })
      return
    }

    if (currentUser.uid !== uid) {
      setStatus('wrongUser')
      return
    }

    verify(uid, token)
  }, [authLoading, currentUser])

  async function verify(uid, token) {
    try {
      const snap = await getDoc(doc(db, 'users', uid))
      if (!snap.exists()) { setStatus('error'); return }

      const data = snap.data()
      if (data.verifyToken !== token) { setStatus('error'); return }

      await updateDoc(doc(db, 'users', uid), { cuentaActivada: true, verifyToken: null })
      setUserProfile(prev => ({ ...prev, cuentaActivada: true, verifyToken: null }))
      setStatus('success')
      setTimeout(() => navigate('/dashboard', { replace: true }), 2500)
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 max-w-sm w-full text-center">

        {status === 'loading' && (
          <div className="flex flex-col items-center gap-4">
            <Spinner size="lg" />
            <p className="text-slate-500 text-sm">Verificando tu enlace…</p>
          </div>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">¡Cuenta activada!</h2>
            <p className="text-slate-500 text-sm">Tu cuenta está verificada. Redirigiendo…</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Enlace no válido</h2>
            <p className="text-slate-500 text-sm mb-5">
              El enlace ya fue utilizado o expiró.<br/>
              Puedes pedir uno nuevo desde el dashboard.
            </p>
            <button
              onClick={() => navigate('/dashboard', { replace: true })}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
            >
              Ir al dashboard
            </button>
          </>
        )}

        {status === 'wrongUser' && (
          <>
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Cuenta incorrecta</h2>
            <p className="text-slate-500 text-sm mb-5">
              Este enlace es para otra cuenta.<br/>
              Inicia sesión con la cuenta correcta.
            </p>
            <button
              onClick={() => navigate('/docente', { replace: true })}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
            >
              Iniciar sesión
            </button>
          </>
        )}

      </div>
    </div>
  )
}
