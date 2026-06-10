import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { GraduationCap, ArrowLeft, ArrowRight, Check } from 'lucide-react'

export default function TeacherRegister() {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    nombre: '',
    email: '',
    password: '',
    confirmPassword: '',
    claveSEP: '',
    schoolName: '',
  })
  const [schoolExists, setSchoolExists] = useState(null)
  const [schoolId, setSchoolId] = useState(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handleStep1 = async (e) => {
    e.preventDefault()
    if (form.password !== form.confirmPassword) {
      toast('Las contraseñas no coinciden', 'error')
      return
    }
    if (form.password.length < 6) {
      toast('La contraseña debe tener al menos 6 caracteres', 'error')
      return
    }
    setStep(2)
  }

  const checkSchool = async () => {
    if (!form.claveSEP.trim()) return
    setLoading(true)
    try {
      const q = query(
        collection(db, 'schools'),
        where('claveSEP', '==', form.claveSEP.trim().toUpperCase())
      )
      const snap = await getDocs(q)
      if (snap.empty) {
        setSchoolExists(false)
        setSchoolId(null)
      } else {
        setSchoolExists(true)
        setSchoolId(snap.docs[0].id)
        set('schoolName', snap.docs[0].data().nombre)
      }
    } catch {
      toast('Error al buscar la escuela', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    if (!schoolExists && !form.schoolName.trim()) {
      toast('Escribe el nombre de tu escuela', 'error')
      return
    }
    setLoading(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password)
      const uid = cred.user.uid

      let finalSchoolId = schoolId
      if (!schoolExists) {
        const newSchoolRef = doc(collection(db, 'schools'))
        await setDoc(newSchoolRef, {
          claveSEP: form.claveSEP.trim().toUpperCase(),
          nombre: form.schoolName.trim(),
        })
        finalSchoolId = newSchoolRef.id
      }

      await setDoc(doc(db, 'users', uid), {
        role: 'docente',
        nombre: form.nombre.trim(),
        email: form.email,
        escuelaId: finalSchoolId,
      })

      navigate('/dashboard')
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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-slate-50 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Crear cuenta</h1>
          <p className="text-slate-500 text-sm mt-1">Docente — Paso {step} de 2</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          {[1, 2].map((n) => (
            <div key={n} className="flex items-center gap-2 flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                  step > n
                    ? 'bg-emerald-500 text-white'
                    : step === n
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200 text-slate-400'
                }`}
              >
                {step > n ? <Check size={14} /> : n}
              </div>
              {n < 2 && <div className={`flex-1 h-0.5 ${step > n ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          {step === 1 ? (
            <form onSubmit={handleStep1} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Nombre completo
                </label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={(e) => set('nombre', e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50"
                  placeholder="Prof. Juan García López"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Correo electrónico
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50"
                  placeholder="nombre@correo.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Contraseña
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50"
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Confirmar contraseña
                </label>
                <input
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => set('confirmPassword', e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50"
                  placeholder="Repite tu contraseña"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                Siguiente <ArrowRight size={16} />
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Clave SEP de tu escuela
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.claveSEP}
                    onChange={(e) => {
                      set('claveSEP', e.target.value)
                      setSchoolExists(null)
                    }}
                    className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50"
                    placeholder="CBTis 255"
                  />
                  <button
                    type="button"
                    onClick={checkSchool}
                    disabled={loading || !form.claveSEP.trim()}
                    className="px-4 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {loading ? <Spinner size="sm" /> : 'Buscar'}
                  </button>
                </div>
                {schoolExists === true && (
                  <p className="text-emerald-600 text-xs mt-1 flex items-center gap-1">
                    <Check size={12} /> Escuela encontrada: <strong>{form.schoolName}</strong>
                  </p>
                )}
                {schoolExists === false && (
                  <p className="text-amber-600 text-xs mt-1">
                    Escuela no registrada — se creará una nueva.
                  </p>
                )}
              </div>

              {schoolExists === false && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Nombre de tu escuela
                  </label>
                  <input
                    type="text"
                    value={form.schoolName}
                    onChange={(e) => set('schoolName', e.target.value)}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50"
                    placeholder="Centro de Bachillerato 255"
                  />
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={16} /> Atrás
                </button>
                <button
                  type="submit"
                  disabled={loading || schoolExists === null}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner size="sm" /> : null}
                  {loading ? 'Creando…' : 'Registrarme'}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-slate-500 mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link to="/" className="text-indigo-600 font-semibold hover:underline">
            Inicia sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
