import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import Spinner from '../../components/Spinner'
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'

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
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps -- mount-only intencional
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
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="bg-surface-card rounded-card shadow-card p-8 max-w-sm w-full text-center">

        {status === 'loading' && (
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <p className="text-muted text-sm">Verificando tu enlace…</p>
          </div>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 size={32} className="text-emerald-500" />
            </div>
            <h2 className="text-xl font-bold text-on-surface mb-2">¡Cuenta activada!</h2>
            <p className="text-muted text-sm">Tu cuenta está verificada. Redirigiendo…</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <XCircle size={32} className="text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-on-surface mb-2">Enlace no válido</h2>
            <p className="text-muted text-sm mb-5">
              El enlace ya fue utilizado o expiró.<br/>
              Puedes pedir uno nuevo desde el dashboard.
            </p>
            <button
              type="button"
              onClick={() => navigate('/dashboard', { replace: true })}
              className="px-5 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-hover transition-colors"
            >
              Ir al dashboard
            </button>
          </>
        )}

        {status === 'wrongUser' && (
          <>
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <AlertTriangle size={32} className="text-amber-500" />
            </div>
            <h2 className="text-xl font-bold text-on-surface mb-2">Cuenta incorrecta</h2>
            <p className="text-muted text-sm mb-5">
              Este enlace es para otra cuenta.<br/>
              Inicia sesión con la cuenta correcta.
            </p>
            <button
              type="button"
              onClick={() => navigate('/docente', { replace: true })}
              className="px-5 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-hover transition-colors"
            >
              Iniciar sesión
            </button>
          </>
        )}

      </div>
    </div>
  )
}
