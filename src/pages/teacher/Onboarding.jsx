import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import { resolveSchoolSelection } from '../../utils/schoolSelection'
import { usePlanteles } from '../../data/usePlanteles'
import Spinner from '../../components/Spinner'
import { GraduationCap, ChevronDown, Search, Check, X, Plus } from 'lucide-react'

export default function Onboarding() {
  const { currentUser, setUserProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [nombre, setNombre] = useState('')
  const [selectedPlantel, setSelectedPlantel] = useState(null)
  const [showPicker, setShowPicker] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const { planteles, loading: catalogLoading } = usePlanteles()

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

  async function finish(plantel) {
    if (!nombre.trim()) { toast('Escribe tu nombre completo', 'error'); return }
    setSaving(true)
    try {
      const updates = { nombreMostrar: nombre.trim(), profileComplete: true }
      if (plantel) {
        const { escuelaId, schoolName } = await resolveSchoolSelection(plantel)
        updates.escuelaId = escuelaId
        updates.schoolName = schoolName
      }
      await updateDoc(doc(db, 'users', currentUser.uid), updates)
      setUserProfile((p) => ({ ...p, ...updates }))
      navigate('/dashboard')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-card bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-on-surface">Un último paso</h1>
          <p className="text-muted text-sm mt-1">Así te verán tus alumnos</p>
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-6">
          <form onSubmit={(e) => { e.preventDefault(); finish(selectedPlantel) }} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Nombre completo</label>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
                autoFocus
                className="w-full px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                placeholder="Ej. Profa. García Pérez"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted mb-1">Escuela (opcional)</label>
              <button
                type="button"
                onClick={() => { setShowPicker(true); setSearch('') }}
                className={`w-full px-4 py-3 rounded border text-sm text-left flex items-center justify-between gap-2 transition-colors ${
                  selectedPlantel
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-outline-variant bg-surface hover:border-blue-400'
                }`}
              >
                <span className={`truncate ${selectedPlantel ? 'text-on-surface font-medium' : 'text-slate-400'}`}>
                  {selectedPlantel ? (selectedPlantel.short || selectedPlantel.nombre) : 'Seleccionar escuela…'}
                </span>
                {selectedPlantel
                  ? <Check size={16} className="text-emerald-600 flex-shrink-0" />
                  : <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
                }
              </button>
              {selectedPlantel && !selectedPlantel.custom && (
                <p className="text-xs text-emerald-700 mt-1 ml-1 truncate">
                  {selectedPlantel.cct} · {selectedPlantel.mun}, {selectedPlantel.edo}
                </p>
              )}
              <p className="text-xs text-slate-400 mt-2 ml-1">Podrás asignarla o cambiarla después desde tu perfil.</p>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
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
          <div className="relative bg-surface-card w-full sm:w-[calc(100%-2rem)] max-w-sm rounded-t-card sm:rounded-card shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center gap-2 p-3 border-b border-outline-variant">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nombre, CCT o municipio…"
                  className="w-full pl-8 pr-3 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <button onClick={() => setShowPicker(false)} className="p-2 text-slate-400 hover:text-muted rounded">
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
                      <p className="text-sm font-medium text-on-surface leading-tight">{p.short || p.nombre}</p>
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
            {search.trim() && (
              <div className="border-t border-outline-variant p-2">
                <button
                  type="button"
                  onClick={() => { setSelectedPlantel({ custom: true, nombre: search.trim(), short: search.trim() }); setShowPicker(false) }}
                  className="w-full flex items-center gap-2 px-4 py-3 rounded text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                >
                  <Plus size={16} className="flex-shrink-0" />
                  <span className="truncate">¿No la encuentras? Agregar «{search.trim()}»</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
