import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  EmailAuthProvider,
  linkWithCredential,
} from 'firebase/auth'
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { GraduationCap, Check, ChevronDown, Search, X } from 'lucide-react'
import PasswordInput from '../../components/PasswordInput'
import { usePlanteles } from '../../data/usePlanteles'

function generateTeacherUsername(cct, count) {
  const state = cct.slice(0, 2)
  const school = cct.slice(5, 9)
  return `${state}${school}-${String(count + 1).padStart(2, '0')}`
}

export default function RegisterSchool() {
  const [selectedPlantel, setSelectedPlantel] = useState(null)
  const [showPicker, setShowPicker] = useState(false)
  const [search, setSearch] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  const { setUserProfile } = useAuth()
  const { planteles, loading: catalogLoading } = usePlanteles()

  const user = auth.currentUser

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return planteles.slice(0, 60)
    return planteles
      .filter((p) =>
        p.nombre?.toLowerCase().includes(q) ||
        p.short?.toLowerCase().includes(q) ||
        p.cct?.toLowerCase().includes(q) ||
        p.mun?.toLowerCase().includes(q)
      )
      .slice(0, 80)
  }, [planteles, search])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!user) { navigate('/', { replace: true }); return }
    if (!selectedPlantel) { toast('Selecciona tu escuela', 'error'); return }
    if (password !== confirmPassword) { toast('Las contraseñas no coinciden', 'error'); return }
    if (password.length < 6) { toast('Mínimo 6 caracteres', 'error'); return }
    setSaving(true)
    try {
      // 1. Find or create school
      const schoolSnap = await getDocs(
        query(collection(db, 'schools'), where('claveSEP', '==', selectedPlantel.cct))
      )
      let schoolId
      if (!schoolSnap.empty) {
        schoolId = schoolSnap.docs[0].id
      } else {
        const newRef = doc(collection(db, 'schools'))
        await setDoc(newRef, {
          claveSEP: selectedPlantel.cct,
          nombre: selectedPlantel.nombre,
          shortName: selectedPlantel.short,
          subsistema: selectedPlantel.sub,
          municipio: selectedPlantel.mun,
          estado: selectedPlantel.edo,
        })
        schoolId = newRef.id
      }

      // 2. Count teachers to generate username
      const teacherSnap = await getDocs(
        query(collection(db, 'users'), where('escuelaId', '==', schoolId))
      )
      const username = generateTeacherUsername(selectedPlantel.cct, teacherSnap.size)

      // 3. Link email/password to Google account so teacher can log in either way
      try {
        const credential = EmailAuthProvider.credential(user.email, password)
        await linkWithCredential(user, credential)
      } catch (linkErr) {
        // auth/provider-already-linked = already linked, continue
        if (linkErr.code !== 'auth/provider-already-linked') throw linkErr
      }

      // 4. Create Firestore profile
      const profile = {
        role: 'docente',
        username,
        email: user.email,
        escuelaId: schoolId,
        photoURL: user.photoURL || null,
      }
      await setDoc(doc(db, 'users', user.uid), profile)
      setUserProfile({
        ...profile,
        schoolName: selectedPlantel.nombre,
        claveSEP: selectedPlantel.cct,
      })
      navigate('/dashboard')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!user) return null

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-slate-50 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Un último paso</h1>
          <p className="text-slate-500 text-sm mt-1">Indica tu plantel y crea una contraseña</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          {/* Google account info */}
          <div className="bg-slate-50 rounded-xl px-4 py-3 mb-4">
            <p className="text-xs text-slate-400 mb-0.5">Cuenta de Google</p>
            <p className="text-sm font-semibold text-slate-800">{user.displayName || user.email}</p>
            <p className="text-xs text-slate-500">{user.email}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* School picker */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Escuela</label>
              <button
                type="button"
                onClick={() => { setShowPicker(true); setSearch('') }}
                className={`w-full px-4 py-3 rounded-xl border text-sm text-left flex items-center justify-between gap-2 transition-colors ${
                  selectedPlantel
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-slate-200 bg-slate-50 hover:border-blue-400'
                }`}
              >
                <span className={`truncate ${selectedPlantel ? 'text-slate-900 font-medium' : 'text-slate-400'}`}>
                  {selectedPlantel ? (selectedPlantel.short || selectedPlantel.nombre) : 'Seleccionar escuela…'}
                </span>
                {selectedPlantel
                  ? <Check size={16} className="text-emerald-600 flex-shrink-0" />
                  : <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
                }
              </button>
              {selectedPlantel && (
                <p className="text-xs text-emerald-700 mt-1 ml-1 truncate">
                  {selectedPlantel.cct} · {selectedPlantel.mun}, {selectedPlantel.edo}
                </p>
              )}
            </div>

            {/* Password — to allow username+password login as well */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Contraseña del sistema
              </label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                placeholder="Mínimo 6 caracteres"
              />
              <p className="text-xs text-slate-400 mt-1">
                Te permitirá entrar también con usuario y contraseña.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Confirmar contraseña</label>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                placeholder="Repite la contraseña"
              />
            </div>

            <button
              type="submit"
              disabled={saving || !selectedPlantel}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {saving ? <Spinner size="sm" /> : null}
              {saving ? 'Guardando…' : 'Entrar al panel'}
            </button>
          </form>
        </div>
      </div>

      {/* School picker overlay */}
      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowPicker(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col" style={{ maxHeight: '80vh' }}>
            <div className="flex items-center gap-2 p-3 border-b border-slate-100">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nombre, CCT o municipio…"
                  className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <button onClick={() => setShowPicker(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <X size={17} />
              </button>
            </div>
            {catalogLoading ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : (
              <ul className="overflow-y-auto flex-1 divide-y divide-slate-100">
                {filtered.length === 0 && (
                  <li className="text-center text-slate-400 text-sm py-10">Sin resultados</li>
                )}
                {filtered.map((p) => (
                  <li key={p.cct}>
                    <button
                      type="button"
                      onClick={() => { setSelectedPlantel(p); setShowPicker(false) }}
                      className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors"
                    >
                      <p className="text-sm font-medium text-slate-900 leading-tight">{p.short || p.nombre}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{p.cct} · {p.mun}, {p.edo}</p>
                    </button>
                  </li>
                ))}
                {filtered.length >= 80 && search.trim() && (
                  <li className="text-center text-xs text-slate-400 py-3 px-4">
                    Hay más resultados — escribe más para filtrar
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
