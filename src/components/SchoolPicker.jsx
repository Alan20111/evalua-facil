import { useState, useMemo, useEffect } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { usePlanteles } from '../data/usePlanteles'
import { normalizeName, findSimilarSchools } from '../utils/schoolSelection'
import { Plus } from 'lucide-react'
import Spinner from './Spinner'
import SearchInput from './SearchInput'
import Modal from './ui/Modal'
import { useToast } from './Toast'
import { useBackHandler } from '../hooks/useBackHandler'

// Selector de escuela — la MISMA pantalla en los tres lugares donde un docente
// elige la suya: el registro (Register), el paso final del alta con Google o de
// una cuenta vieja sin escuela (Onboarding) y el perfil (Profile). Antes vivía
// solo dentro de Profile.jsx; al volverse obligatoria en el registro se extrajo
// aquí para no tener tres copias del mismo flujo (catálogo → ¿es esta escuela
// parecida? → alta manual).
//
// NO existe una opción "Sin escuela": todo docente pertenece a una escuela
// (regla de negocio, 30-ago-2026 — ver utils/escuela.js). Si la suya no está en
// el catálogo, la da de alta aquí mismo — y la Clave del Centro de Trabajo es
// OPCIONAL a propósito: muchos docentes no se la saben, y no puede ser una
// barrera de entrada.
//
// `onSelect(plantel)` recibe lo elegido en el formato que espera
// resolveSchoolSelection(): un plantel del catálogo, `{ existingId, nombre }`
// para una escuela que alguien más ya creó, o `{ custom: true, … }` para una
// nueva. Quien llama es el que persiste — este componente no escribe nada.
//
// En el REGISTRO todavía no hay sesión, así que la lista de escuelas creadas a
// mano (que vive en Firestore y exige estar autenticado) sale vacía y solo se
// busca en el catálogo estático. No genera duplicados: resolveSchoolSelection
// reconcilia por CCT y por nombre+municipio al momento de guardar.
export default function SchoolPicker({ onSelect, onClose, saving = false }) {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [addingCustom, setAddingCustom] = useState(false)
  // 'form' (capturando los datos) → 'similar' (encontramos parecidas, se
  // pregunta si es alguna) → 'confirm' (revisión final antes de crearla).
  const [customStep, setCustomStep] = useState('form')
  const [similares, setSimilares] = useState([])
  const [customName, setCustomName] = useState('')
  const [customCCT, setCustomCCT] = useState('')
  const [customCity, setCustomCity] = useState('')
  const [customState, setCustomState] = useState('')
  const [customSchools, setCustomSchools] = useState([])
  const [customSchoolsLoaded, setCustomSchoolsLoaded] = useState(false)
  const { planteles, loading: catalogLoading } = usePlanteles()

  useBackHandler(() => { if (!saving) onClose() })

  // Las escuelas agregadas a mano (fuera del catálogo estático) viven en
  // Firestore — se cargan una vez para que también se puedan buscar.
  useEffect(() => {
    if (customSchoolsLoaded) return
    getDocs(query(collection(db, 'schools'), where('custom', '==', true)))
      .then((snap) => setCustomSchools(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
      .finally(() => setCustomSchoolsLoaded(true))
  }, [customSchoolsLoaded])

  const filteredPlanteles = useMemo(() => {
    const q = normalizeName(search)
    if (!q) return []
    return planteles.filter((p) =>
      normalizeName(p.nombre || '').includes(q) || normalizeName(p.short || '').includes(q) ||
      normalizeName(p.cct || '').includes(q) || normalizeName(p.mun || '').includes(q)
    ).slice(0, 80)
  }, [planteles, search])

  const filteredCustomSchools = useMemo(() => {
    const q = normalizeName(search)
    if (!q) return []
    return customSchools.filter((s) => normalizeName(s.nombre || '').includes(q))
  }, [customSchools, search])

  function openCustomForm() {
    setCustomName(search.trim())
    setCustomCCT('')
    setCustomCity('')
    setCustomState('')
    setCustomStep('form')
    setSimilares([])
    setAddingCustom(true)
  }

  // Atrapa basura evidente (vacío, demasiado corto, sin una sola letra) sin
  // bloquear nombres reales que el catálogo estático no conoce — no puede
  // verificar que la escuela exista, solo que lo escrito parezca un nombre.
  function looksLikeText(value, minLen) {
    const v = value.trim()
    return v.length >= minLen && /[a-zA-ZÀ-ÖØ-öø-ÿ]/.test(v)
  }

  function reviewCustom(e) {
    e.preventDefault()
    if (!looksLikeText(customName, 4)) { toast('Escribe el nombre completo de la escuela', 'error'); return }
    if (!looksLikeText(customCity, 2)) { toast('Escribe la ciudad o municipio', 'error'); return }
    if (!looksLikeText(customState, 2)) { toast('Escribe el estado', 'error'); return }
    if (customCCT.trim() && !/^[a-zA-Z0-9]+$/.test(customCCT.trim())) {
      toast('La clave del centro de trabajo solo debe tener letras y números', 'error')
      return
    }
    const name = customName.trim()
    const mun = customCity.trim()
    const edo = customState.trim()
    const candidates = [
      ...customSchools.map((s) => ({
        kind: 'custom', id: s.id, nombre: s.nombre, municipio: s.municipio, estado: s.estado, claveSEP: s.claveSEP,
      })),
      ...planteles.map((p) => ({
        kind: 'catalog', plantel: p, nombre: p.nombre || p.short, municipio: p.mun, estado: p.edo, claveSEP: p.cct,
      })),
    ]
    const matches = findSimilarSchools(name, mun, edo, candidates)
    if (matches.length) {
      setSimilares(matches.slice(0, 5))
      setCustomStep('similar')
    } else {
      setCustomStep('confirm')
    }
  }

  function chooseSimilar(candidate) {
    if (candidate.kind === 'custom') onSelect({ existingId: candidate.id, nombre: candidate.nombre })
    else onSelect(candidate.plantel)
  }

  function submitCustom() {
    onSelect({
      custom: true,
      nombre: customName.trim(),
      short: customName.trim(),
      cct: customCCT.trim(),
      mun: customCity.trim(),
      edo: customState.trim(),
    })
  }

  const btnSec = 'flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60'
  const btnPri = 'flex-1 py-2 rounded bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2'

  return (
    <Modal
      open
      onClose={onClose}
      title="Elige tu escuela"
      variant="centered"
      size="sm"
      busy={saving}
      closeOnBackdrop={!saving}
    >
      {addingCustom && customStep === 'similar' ? (
        <div className="space-y-3 max-h-[70dvh] overflow-y-auto">
          <p className="text-sm text-muted">
            Encontramos escuelas parecidas — ¿es alguna de estas la misma que quieres agregar?
          </p>
          <ul className="space-y-2">
            {similares.map((c, i) => (
              <li key={`${c.claveSEP || c.nombre}-${i}`}>
                <button type="button" onClick={() => chooseSimilar(c)} disabled={saving}
                  className="w-full text-left px-3 py-2 rounded border border-outline-variant hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                  <p className="text-sm font-medium text-on-surface leading-tight">{c.nombre}</p>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {[c.claveSEP, [c.municipio, c.estado].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" onClick={() => setCustomStep('form')} disabled={saving} className={btnSec}>Volver</button>
            <button type="button" onClick={() => setCustomStep('confirm')} disabled={saving}
              className="flex-1 py-2 rounded bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors disabled:opacity-60">
              Ninguna, es nueva
            </button>
          </div>
        </div>
      ) : addingCustom && customStep === 'confirm' ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">¿Confirmas que la escuela a agregar es esta?</p>
          <div className="bg-surface rounded p-3 border border-outline-variant space-y-1">
            <p className="text-sm font-semibold text-on-surface">{customName.trim()}</p>
            {customCCT.trim() && <p className="text-sm text-slate-500">CCT: {customCCT.trim()}</p>}
            <p className="text-sm text-slate-500">{customCity.trim()}, {customState.trim()}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setCustomStep(similares.length ? 'similar' : 'form')} disabled={saving} className={btnSec}>Volver</button>
            <button type="button" onClick={submitCustom} disabled={saving} className={btnPri}>
              {saving ? <Spinner size="sm" /> : null}
              {saving ? 'Guardando…' : 'Confirmar y agregar'}
            </button>
          </div>
        </div>
      ) : addingCustom ? (
        <form onSubmit={reviewCustom} className="space-y-3 max-h-[70dvh] overflow-y-auto">
          <div>
            <label htmlFor="escuela-nombre" className="block text-sm font-medium text-muted mb-1">Nombre oficial de la escuela</label>
            <input
              id="escuela-nombre"
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              required
              className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
              placeholder="Ej. Escuela Secundaria Técnica N.° 12"
            />
          </div>
          <div>
            <label htmlFor="escuela-cct" className="block text-sm font-medium text-muted mb-1">
              Clave del centro de trabajo (CCT) <span className="text-slate-500 font-normal text-xs">(opcional)</span>
            </label>
            <input
              id="escuela-cct"
              type="text"
              value={customCCT}
              onChange={(e) => setCustomCCT(e.target.value)}
              className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
              placeholder="Ej. 15ECT0001H"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="escuela-ciudad" className="block text-sm font-medium text-muted mb-1">Ciudad / municipio</label>
              <input
                id="escuela-ciudad"
                type="text"
                value={customCity}
                onChange={(e) => setCustomCity(e.target.value)}
                required
                className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                placeholder="Ej. Celaya"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="escuela-estado" className="block text-sm font-medium text-muted mb-1">Estado</label>
              <input
                id="escuela-estado"
                type="text"
                value={customState}
                onChange={(e) => setCustomState(e.target.value)}
                required
                className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                placeholder="Ej. Guanajuato"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAddingCustom(false)} disabled={saving} className={btnSec}>Cancelar</button>
            <button type="submit" disabled={saving} className={btnPri}>Continuar</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col">
          <div className="pb-3 -mx-4 sm:-mx-5 px-4 sm:px-5 border-b border-outline-variant">
            <SearchInput value={search} onChange={setSearch} placeholder="Nombre, CCT o municipio…" />
          </div>
          {!search.trim() ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Escribe el nombre de tu escuela, su municipio o su clave (CCT) para buscarla.
            </p>
          ) : catalogLoading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : (
            <ul className="max-h-[50dvh] overflow-y-auto divide-y divide-slate-100 -mx-4 sm:-mx-5">
              {filteredPlanteles.length === 0 && filteredCustomSchools.length === 0 && (
                <li className="text-center text-slate-500 text-sm py-10">Sin resultados</li>
              )}
              {filteredCustomSchools.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => onSelect({ existingId: s.id, nombre: s.nombre })} disabled={saving}
                    className="w-full text-left px-4 sm:px-5 py-2.5 hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                    <p className="text-sm font-medium text-on-surface leading-tight">{s.nombre}</p>
                    {(s.claveSEP || s.municipio || s.estado) && (
                      <p className="text-sm text-slate-500 mt-0.5">
                        {[s.claveSEP, [s.municipio, s.estado].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </button>
                </li>
              ))}
              {filteredPlanteles.map((p) => (
                <li key={p.cct}>
                  <button type="button" onClick={() => onSelect(p)} disabled={saving}
                    className="w-full text-left px-4 sm:px-5 py-2.5 hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                    <p className="text-sm font-medium text-on-surface leading-tight">{p.short || p.nombre}</p>
                    <p className="text-sm text-slate-500 mt-0.5">{p.cct} · {p.mun}, {p.edo}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {search.trim() && (
            <div className="border-t border-outline-variant pt-2 -mx-4 sm:-mx-5 px-4 sm:px-5">
              <button
                type="button"
                disabled={saving}
                onClick={openCustomForm}
                className="w-full flex items-center gap-2 px-4 py-2 rounded text-sm font-medium text-accent hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60"
              >
                <Plus size={18} className="flex-shrink-0" />
                <span className="truncate">¿No la encuentras? Agregar «{search.trim()}»</span>
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
