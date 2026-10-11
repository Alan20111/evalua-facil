import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import Spinner from '../../components/Spinner'
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { useBackHandler } from '../../hooks/useBackHandler'
import { Button } from '../../components/ui'
import { ICONO } from '../../config/iconos'

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { currentUser, loading: authLoading, setUserProfile } = useAuth()
  const [status, setStatus] = useState('loading')

  // Botón físico de Android: se llega aquí desde el enlace del correo, y si el
  // token viene mal la pantalla se queda en el error sin salida. Atrás lleva al
  // panel (o al inicio de sesión si no hay sesión abierta).
  useBackHandler(() => navigate(currentUser ? '/dashboard' : '/docente', { replace: true }))

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
            <span aria-hidden="true" className="size-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3 animate-pop motion-reduce:animate-none">
              <CheckCircle2 size={ICONO.xl} className="text-emerald-500" />
            </span>
            <h2 className="text-xl font-bold text-on-surface mb-2">¡Cuenta activada!</h2>
            <p className="text-muted text-sm">Tu cuenta está verificada. Redirigiendo…</p>
          </>
        )}

        {status === 'error' && (
          <>
            <span aria-hidden="true" className="size-20 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3 animate-aparece motion-reduce:animate-none">
              <XCircle size={ICONO.xl} className="text-red-500" />
            </span>
            <h2 className="text-xl font-bold text-on-surface mb-2">Enlace no válido</h2>
            <p className="text-muted text-sm mb-4">
              El enlace ya fue utilizado o expiró.<br/>
              Puedes pedir uno nuevo desde el dashboard.
            </p>
            <Button size="lg" onClick={() => navigate('/dashboard', { replace: true })}>Ir al dashboard</Button>
          </>
        )}

        {status === 'wrongUser' && (
          <>
            <span aria-hidden="true" className="size-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3 animate-aparece motion-reduce:animate-none">
              <AlertTriangle size={ICONO.xl} className="text-amber-500" />
            </span>
            <h2 className="text-xl font-bold text-on-surface mb-2">Cuenta incorrecta</h2>
            <p className="text-muted text-sm mb-4">
              Este enlace es para otra cuenta.<br/>
              Inicia sesión con la cuenta correcta.
            </p>
            <Button size="lg" onClick={() => navigate('/docente', { replace: true })}>Iniciar sesión</Button>
          </>
        )}

      </div>
    </div>
  )
}
