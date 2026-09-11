import { useState, useEffect } from 'react'
import { collection, getDocs, updateDoc, doc } from 'firebase/firestore'
import { School, Save } from 'lucide-react'
import { db } from '../../../firebase'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import Input from '../../../components/ui/Input'

export default function EscuelasConfig() {
  const [schools, setSchools] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({}) // { [schoolId]: true }
  const [umbrales, setUmbrales] = useState({}) // { [schoolId]: string }
  const [search, setSearch] = useState('')
  const toast = useToast()

  useEffect(() => {
    getDocs(collection(db, 'schools')).then((snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'))
      setSchools(list)
      const init = {}
      list.forEach((s) => { init[s.id] = String(s.umbralInasistencia ?? 20) })
      setUmbrales(init)
    }).catch((e) => toast(e.message, 'error')).finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(schoolId) {
    const raw = parseInt(umbrales[schoolId], 10)
    if (isNaN(raw) || raw < 1 || raw > 100) {
      toast('El umbral debe estar entre 1 y 100', 'error')
      return
    }
    setSaving((p) => ({ ...p, [schoolId]: true }))
    try {
      await updateDoc(doc(db, 'schools', schoolId), { umbralInasistencia: raw })
      setSchools((p) => p.map((s) => s.id === schoolId ? { ...s, umbralInasistencia: raw } : s))
      toast('Umbral guardado')
    } catch (e) { toast(e.message, 'error') }
    finally { setSaving((p) => ({ ...p, [schoolId]: false })) }
  }

  const filtered = schools.filter((s) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (s.nombre || '').toLowerCase().includes(q) ||
      (s.shortName || '').toLowerCase().includes(q) ||
      (s.claveSEP || '').toLowerCase().includes(q)
  })

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Umbral de inasistencia institucional: si un alumno supera este porcentaje de faltas en un parcial, el indicador de riesgo se muestra en rojo.
      </p>
      <Input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nombre, clave o short name…"
      />
      {filtered.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-8">Sin resultados</p>
      )}
      <div className="space-y-2">
        {filtered.map((s) => (
          <div key={s.id} className="flex items-center gap-3 p-3 rounded-card border border-outline-variant bg-surface-card">
            <School size={18} className="text-accent flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-on-surface truncate">{s.nombre || s.id}</p>
              <p className="text-xs text-muted">{s.shortName} · {s.claveSEP}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Input
                id={`umbral-${s.id}`}
                label="Umbral %"
                type="number"
                min={1}
                max={100}
                value={umbrales[s.id] ?? '20'}
                onChange={(e) => setUmbrales((p) => ({ ...p, [s.id]: e.target.value }))}
                wrapperClassName="flex items-center gap-1.5"
                className="w-16 text-center"
              />
              <button
                type="button"
                onClick={() => handleSave(s.id)}
                disabled={saving[s.id]}
                className="p-1.5 rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-60 transition-colors"
                aria-label="Guardar umbral"
              >
                {saving[s.id] ? <Spinner size="sm" /> : <Save size={15} />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
