import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { GraduationCap, Check } from 'lucide-react'

export default function RegisterSchool() {
  const [claveSEP, setClaveSEP] = useState('')
  const [schoolName, setSchoolName] = useState('')
  const [schoolExists, setSchoolExists] = useState(null)
  const [schoolId, setSchoolId] = useState(null)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  const { setUserProfile } = useAuth()

  const user = auth.currentUser

  const checkSchool = async () => {
    if (!claveSEP.trim()) return
    setSearching(true)
    try {
      const snap = await getDocs(
        query(collection(db, 'schools'), where('claveSEP', '==', claveSEP.trim().toUpperCase()))
      )
      if (snap.empty) {
        setSchoolExists(false)
        setSchoolId(null)
      } else {
        setSchoolExists(true)
        setSchoolId(snap.docs[0].id)
        setSchoolName(snap.docs[0].data().nombre)
      }
    } catch {
      toast('Error al buscar la escuela', 'error')
    } finally {
      setSearching(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!schoolExists && !schoolName.trim()) {
      toast('Escribe el nombre de tu escuela', 'error')
      return
    }
    setSaving(true)
    try {
      let finalSchoolId = schoolId
      if (!schoolExists) {
        const newRef = doc(collection(db, 'schools'))
        await setDoc(newRef, {
          claveSEP: claveSEP.trim().toUpperCase(),
          nombre: schoolName.trim(),
        })
        finalSchoolId = newRef.id
      }
      const profile = {
        role: 'docente',
        nombre: user.displayName || user.email.split('@')[0],
        email: user.email,
        escuelaId: finalSchoolId,
      }
      await setDoc(doc(db, 'users', user.uid), profile)
      // Set the enriched profile in memory so the dashboard shows the school right away.
      setUserProfile({
        ...profile,
        schoolName: schoolName.trim(),
        claveSEP: claveSEP.trim().toUpperCase(),
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
          <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Un último paso</h1>
          <p className="text-slate-500 text-sm mt-1">Indica tu escuela para continuar</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-5">
          {/* Google account info */}
          <div className="bg-slate-50 rounded-xl px-4 py-3">
            <p className="text-xs text-slate-400 mb-0.5">Cuenta de Google</p>
            <p className="text-sm font-semibold text-slate-800">{user?.displayName}</p>
            <p className="text-xs text-slate-500">{user?.email}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Clave SEP de tu escuela
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={claveSEP}
                  onChange={(e) => {
                    setClaveSEP(e.target.value)
                    setSchoolExists(null)
                  }}
                  className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50"
                  placeholder="CBTis 255"
                />
                <button
                  type="button"
                  onClick={checkSchool}
                  disabled={searching || !claveSEP.trim()}
                  className="px-4 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {searching ? <Spinner size="sm" /> : 'Buscar'}
                </button>
              </div>
              {schoolExists === true && (
                <p className="text-emerald-600 text-xs mt-1 flex items-center gap-1">
                  <Check size={12} /> Escuela encontrada: <strong>{schoolName}</strong>
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
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50"
                  placeholder="Centro de Bachillerato 255"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={saving || schoolExists === null}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
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
