import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { GraduationCap, Check } from 'lucide-react'
import { usePlanteles, findPlantel } from '../../data/usePlanteles'

export default function RegisterSchool() {
  const [cct, setCct] = useState('')
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  const { setUserProfile } = useAuth()
  const { planteles, loading: catalogLoading } = usePlanteles()

  const user = auth.currentUser

  // Guard: reaching this page without an active Google session is invalid.
  useEffect(() => {
    if (!user) navigate('/', { replace: true })
  }, [user, navigate])

  const cctMatch = useMemo(() => findPlantel(planteles, cct), [planteles, cct])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!user) {
      navigate('/', { replace: true })
      return
    }
    if (!cctMatch) {
      toast('CCT no encontrado. Verifica la clave de tu plantel.', 'error')
      return
    }
    setSaving(true)
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
          shortName: cctMatch.short,
          subsistema: cctMatch.sub,
          municipio: cctMatch.mun,
          estado: cctMatch.edo,
        })
        schoolId = newRef.id
      }

      const username = user.displayName || user.email.split('@')[0]
      const profile = {
        role: 'docente',
        username,
        nombre: username,
        email: user.email,
        escuelaId: schoolId,
        photoURL: user.photoURL || null,
      }
      await setDoc(doc(db, 'users', user.uid), profile)
      setUserProfile({
        ...profile,
        schoolName: cctMatch.nombre,
        claveSEP: cctMatch.cct,
      })
      navigate('/dashboard')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-slate-50 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Un último paso</h1>
          <p className="text-slate-500 text-sm mt-1">Indica tu plantel para continuar</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-5">
          <div className="bg-slate-50 rounded-xl px-4 py-3">
            <p className="text-xs text-slate-400 mb-0.5">Cuenta de Google</p>
            <p className="text-sm font-semibold text-slate-800">{user?.displayName}</p>
            <p className="text-xs text-slate-500">{user?.email}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                CCT de tu plantel
              </label>
              <input
                type="text"
                value={cct}
                onChange={(e) => setCct(e.target.value.toUpperCase())}
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
              ) : catalogLoading && cct.length >= 5 ? (
                <p className="text-slate-400 text-xs mt-1.5">Cargando catálogo de planteles…</p>
              ) : cct.length >= 5 ? (
                <p className="text-amber-600 text-xs mt-1.5">
                  CCT no encontrado. Verifica que sea correcto.
                </p>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={saving || !cctMatch}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {saving ? <Spinner size="sm" /> : null}
              {saving ? 'Guardando…' : 'Entrar al panel'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
