import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth'
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { GraduationCap, Check, Mail } from 'lucide-react'
import { planteles } from '../../data/planteles'

export default function TeacherRegister() {
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

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const cctMatch = useMemo(() => {
    const val = form.cct.trim().toUpperCase()
    if (val.length < 5) return null
    return planteles.find((p) => p.cct === val) || null
  }, [form.cct])

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
          municipio: cctMatch.municipio,
          estado: cctMatch.estado,
        })
        schoolId = newRef.id
      }

      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password)
      await sendEmailVerification(cred.user)

      const username = `${form.apellidoPaterno.trim()} ${form.apellidoMaterno.trim()} ${form.nombrePropio.trim()}`.replace(/\s+/g, ' ').trim()
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

      // Sign out so they verify email before accessing the dashboard
      await auth.currentUser?.reload()
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
              <strong>{form.email}</strong>. Ábrelo antes de iniciar sesión.
            </p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors"
            >
              Ir a iniciar sesión
            </button>
          </div>
        </div>
      </div>
    )
  }

  const inputCls = 'w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-slate-50 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Crear cuenta</h1>
          <p className="text-slate-500 text-sm mt-1">Docente</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
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
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
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
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
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
                    : 'border-slate-200 focus:ring-indigo-500 bg-slate-50'
                }`}
                placeholder="Ej. 11ECT0001X"
              />
              {cctMatch ? (
                <p className="text-emerald-600 text-xs mt-1.5 flex items-start gap-1">
                  <Check size={12} className="mt-0.5 flex-shrink-0" />
                  <span>{cctMatch.nombre} — {cctMatch.municipio}, {cctMatch.estado}</span>
                </p>
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
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? <Spinner size="sm" /> : null}
              {loading ? 'Creando cuenta…' : 'Registrarme'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-slate-500 mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link to="/" className="text-indigo-600 font-semibold hover:underline">
            Iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
