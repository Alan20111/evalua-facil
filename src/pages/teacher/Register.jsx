import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth'
import { collection, doc, getDocs, getDoc, query, setDoc, where } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { GraduationCap, Check, Mail, ArrowLeft, Monitor, Smartphone } from 'lucide-react'
import { usePlanteles, findPlantel } from '../../data/usePlanteles'

function GoogleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.705A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.705V4.963H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.037l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.963L3.964 7.295C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

export default function TeacherRegister() {
  const [method, setMethod] = useState(null) // null | 'email'
  const [form, setForm] = useState({
    apellidoPaterno: '',
    apellidoMaterno: '',
    nombrePropio: '',
    cct: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  const { planteles, loading: catalogLoading } = usePlanteles()

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const cctMatch = useMemo(
    () => findPlantel(planteles, form.cct),
    [planteles, form.cct]
  )

  const handleGoogleRegister = async () => {
    setLoading(true)
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      const snap = await getDoc(doc(db, 'users', result.user.uid))
      if (snap.exists()) {
        navigate('/dashboard')
      } else {
        navigate('/register/school')
      }
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        if (auth.currentUser) await signOut(auth).catch(() => {})
        toast('Error al registrar con Google', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!cctMatch) {
      toast('CCT no encontrado. Verifica la clave de tu plantel.', 'error')
      return
    }
    if (form.password !== form.confirmPassword) {
      toast('Las contraseñas no coinciden', 'error')
      return
    }
    if (form.password.length < 6) {
      toast('La contraseña debe tener al menos 6 caracteres', 'error')
      return
    }
    setLoading(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password)

      const schoolSnap = await getDocs(
        query(collection(db, 'schools'), where('claveSEP', '==', cctMatch.cct))
      )
      let schoolId
      if (!schoolSnap.empty) {
        schoolId = schoolSnap.docs[0].id
      } else {
        const newRef = doc(collection(db, 'schools'))
        await setDoc(newRef, {
          claveSEP: cctMatch.cct,
          nombre: cctMatch.nombre,
          shortName: cctMatch.short,
          subsistema: cctMatch.sub,
          municipio: cctMatch.mun,
          estado: cctMatch.edo,
        })
        schoolId = newRef.id
      }

      const username = `${form.apellidoPaterno.trim()} ${form.apellidoMaterno.trim()} ${form.nombrePropio.trim()}`
        .replace(/\s+/g, ' ')
        .trim()
      await setDoc(doc(db, 'users', cred.user.uid), {
        role: 'docente',
        apellidoPaterno: form.apellidoPaterno.trim().toUpperCase(),
        apellidoMaterno: form.apellidoMaterno.trim().toUpperCase(),
        nombrePropio: form.nombrePropio.trim(),
        username,
        nombre: username,
        email: form.email,
        escuelaId: schoolId,
        photoURL: null,
      })

      await sendEmailVerification(cred.user)
      await signOut(auth)
      setDone(true)
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        toast('Ese correo ya está registrado', 'error')
      } else {
        toast('Error al registrar: ' + err.message, 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-slate-50">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <Mail size={24} className="text-emerald-500" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">¡Cuenta creada!</h2>
            <p className="text-sm text-slate-500 mb-6">
              Enviamos un correo de verificación a{' '}
              <strong>{form.email}</strong>. Ábrelo y verifica tu cuenta antes de iniciar sesión.
            </p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
            >
              Ir a iniciar sesión
            </button>
          </div>
        </div>
      </div>
    )
  }

  const inputCls =
    'w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm bg-slate-50'

  /* ── Selector de método ── */
  if (method === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-slate-50 py-8">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
              <GraduationCap size={32} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Crear cuenta</h1>
            <p className="text-slate-500 text-sm mt-1">Elige cómo quieres registrarte</p>
          </div>

          <div className="space-y-3">
            {/* Opción correo — varios equipos */}
            <button
              type="button"
              onClick={() => setMethod('email')}
              className="w-full bg-white border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50 rounded-2xl p-5 text-left transition-all shadow-sm"
            >
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Monitor size={20} className="text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900 mb-1">Registro con correo electrónico</p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    ¿Utilizarás esta plataforma en <strong>diversos equipos</strong>? Regístrate aquí.{' '}
                    Podrás entrar desde cualquier equipo con tu nombre de usuario y contraseña.
                  </p>
                </div>
              </div>
            </button>

            {/* Opción Google — un solo equipo */}
            <button
              type="button"
              onClick={handleGoogleRegister}
              disabled={loading}
              className="w-full bg-white border-2 border-slate-200 hover:border-slate-400 hover:bg-slate-50 rounded-2xl p-5 text-left transition-all shadow-sm disabled:opacity-60"
            >
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  {loading ? <Spinner size="sm" /> : <GoogleIcon />}
                </div>
                <div>
                  <p className="font-semibold text-slate-900 mb-1">Registro con Google</p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    ¿Utilizarás esta plataforma en <strong>un solo equipo</strong> con una cuenta de Google?
                    {' '}Se usará siempre tu acceso mediante tu cuenta de Google de forma directa,
                    sin necesidad de recordar una contraseña.
                  </p>
                </div>
              </div>
            </button>
          </div>

          <p className="text-center text-sm text-slate-500 mt-6">
            ¿Ya tienes cuenta?{' '}
            <Link to="/" className="text-blue-600 font-semibold hover:underline">
              Iniciar sesión
            </Link>
          </p>
        </div>
      </div>
    )
  }

  /* ── Formulario de registro con correo ── */
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-slate-50 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Crear cuenta</h1>
          <p className="text-slate-500 text-sm mt-1">Registro con correo electrónico</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <button
            type="button"
            onClick={() => setMethod(null)}
            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-600 text-sm mb-4 -mt-1"
          >
            <ArrowLeft size={15} /> Volver
          </button>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Apellido paterno <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.apellidoPaterno}
                  onChange={(e) => set('apellidoPaterno', e.target.value)}
                  required
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                  placeholder="García"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Apellido materno
                </label>
                <input
                  type="text"
                  value={form.apellidoMaterno}
                  onChange={(e) => set('apellidoMaterno', e.target.value)}
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                  placeholder="López"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Nombre(s) <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.nombrePropio}
                onChange={(e) => set('nombrePropio', e.target.value)}
                required
                className={inputCls}
                placeholder="Juan Carlos"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                CCT del plantel <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.cct}
                onChange={(e) => set('cct', e.target.value.toUpperCase())}
                required
                className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 text-sm font-mono transition-colors ${
                  cctMatch
                    ? 'border-emerald-300 focus:ring-emerald-500 bg-emerald-50'
                    : 'border-slate-200 focus:ring-blue-500 bg-slate-50'
                }`}
                placeholder="Ej. 11DCT0010U"
              />
              {cctMatch ? (
                <p className="text-emerald-600 text-xs mt-1.5 flex items-start gap-1">
                  <Check size={12} className="mt-0.5 flex-shrink-0" />
                  <span>
                    <strong>{cctMatch.short}</strong> · {cctMatch.nombre} — {cctMatch.mun}, {cctMatch.edo}
                  </span>
                </p>
              ) : catalogLoading && form.cct.length >= 5 ? (
                <p className="text-slate-400 text-xs mt-1.5">Cargando catálogo de planteles…</p>
              ) : form.cct.length >= 5 ? (
                <p className="text-amber-600 text-xs mt-1.5">
                  CCT no encontrado en el catálogo. Verifica que sea correcto.
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Correo electrónico <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                required
                autoComplete="email"
                className={inputCls}
                placeholder="nombre@correo.com"
              />
              <p className="text-xs text-slate-400 mt-1">
                Te enviaremos un correo de verificación a esta dirección.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Contraseña <span className="text-red-400">*</span>
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                required
                className={inputCls}
                placeholder="Mínimo 6 caracteres"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Confirmar contraseña <span className="text-red-400">*</span>
              </label>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={(e) => set('confirmPassword', e.target.value)}
                required
                className={`${inputCls} ${
                  form.confirmPassword && form.confirmPassword !== form.password
                    ? 'border-red-300 focus:ring-red-400'
                    : ''
                }`}
                placeholder="Repite tu contraseña"
              />
              {form.confirmPassword && form.confirmPassword !== form.password && (
                <p className="text-red-500 text-xs mt-1">Las contraseñas no coinciden</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? <Spinner size="sm" /> : null}
              {loading ? 'Creando cuenta…' : 'Registrarme'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-slate-500 mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link to="/" className="text-blue-600 font-semibold hover:underline">
            Iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
