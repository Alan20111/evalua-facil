import { useState } from 'react'
import { collection, doc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import { ArrowLeft, Plus, Trash2, Scale, Check } from 'lucide-react'
import {
  RUBRICA_TOTAL, MIN_CRITERIOS, MAX_CRITERIOS, COTEJO_NIVEL,
  pesosEquitativos, validarRubrica, round1,
} from '../../utils/rubrica'
import { useScrollLock } from '../../hooks/useScrollLock'

// Editor de LISTA DE COTEJO — variante simple de la rúbrica: solo 3 columnas
// (Num, Criterio, Nivel de desempeño con sus puntos). Al calificar cada criterio
// será una casilla (cumple → suma sus puntos, vacío → 0). La suma de puntos no
// puede pasar de 10. Se guarda como rúbrica con `tipo: 'cotejo'`.
// `initial` = { id, ...cotejo } para editar, null para crear.

function estadoInicial(initial) {
  if (!initial) {
    return { titulo: '', descripcion: '', criterios: [{ nombre: '', puntos: '5' }, { nombre: '', puntos: '5' }] }
  }
  return {
    titulo: initial.titulo || '',
    descripcion: initial.descripcion || '',
    criterios: (initial.criterios || []).map((c) => ({
      nombre: c.nombre || '',
      puntos: String(c.puntos?.[0] ?? c.peso ?? ''),
    })),
  }
}

function BotonMas({ onClick, label }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} data-tooltip={label}
      className="w-9 h-9 rounded-full border-2 border-on-surface bg-surface-card text-on-surface flex items-center justify-center hover:border-accent hover:text-accent transition-colors flex-shrink-0 shadow-card">
      <Plus size={20} />
    </button>
  )
}

export default function ListaCotejoEditor({ initial, docenteId, onClose, onSaved }) {
  const toast = useToast()
  const isNew = !initial?.id
  const [r, setR] = useState(() => estadoInicial(initial))
  const [saving, setSaving] = useState(false)
  const { criterios } = r

  useScrollLock(true)

  function setCriterioNombre(i, v) {
    setR((prev) => ({ ...prev, criterios: prev.criterios.map((c, k) => (k === i ? { ...c, nombre: v } : c)) }))
  }
  function setCriterioPuntos(i, v) {
    setR((prev) => ({ ...prev, criterios: prev.criterios.map((c, k) => (k === i ? { ...c, puntos: v } : c)) }))
  }
  function addCriterio() {
    setR((prev) => {
      if (prev.criterios.length >= MAX_CRITERIOS) return prev
      const suma = prev.criterios.reduce((s, c) => s + (parseFloat(c.puntos) || 0), 0)
      const restante = Math.max(0, round1(RUBRICA_TOTAL - suma))
      return { ...prev, criterios: [...prev.criterios, { nombre: '', puntos: String(restante) }] }
    })
  }
  function removeCriterio(i) {
    setR((prev) => {
      if (prev.criterios.length <= MIN_CRITERIOS) return prev
      return { ...prev, criterios: prev.criterios.filter((_, k) => k !== i) }
    })
  }
  // Reparte los 10 puntos en partes iguales entre los criterios
  function repartir() {
    setR((prev) => {
      const pesos = pesosEquitativos(prev.criterios.length)
      return { ...prev, criterios: prev.criterios.map((c, i) => ({ ...c, puntos: String(pesos[i]) })) }
    })
  }

  const suma = round1(criterios.reduce((s, c) => s + (parseFloat(c.puntos) || 0), 0))
  const sumaOk = suma > 0 && suma <= RUBRICA_TOTAL

  function normalizada() {
    return {
      tipo: 'cotejo',
      titulo: r.titulo.trim(),
      descripcion: r.descripcion.trim(),
      niveles: [{ nombre: COTEJO_NIVEL, porcentaje: 100 }],
      criterios: r.criterios.map((c) => {
        const pts = round1(parseFloat(c.puntos) || 0)
        return { nombre: c.nombre.trim(), peso: pts, puntos: [pts], descriptores: [''] }
      }),
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    const norm = normalizada()
    const error = validarRubrica(norm)
    if (error) { toast(error, 'error'); return }
    setSaving(true)
    try {
      if (isNew) {
        const ref = await addDoc(collection(db, 'bancoRubricas'), {
          ...norm, docenteId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
        onSaved?.({ id: ref.id, ...norm, docenteId })
        toast('Lista de cotejo guardada en tu banco')
      } else {
        await updateDoc(doc(db, 'bancoRubricas', initial.id), { ...norm, updatedAt: serverTimestamp() })
        onSaved?.({ id: initial.id, ...norm, docenteId })
        toast('Lista de cotejo actualizada — las actividades que ya la usan no cambian')
      }
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const inputCell = 'bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1'

  return (
    <div className="fixed inset-0 z-[70] bg-surface overflow-y-auto">
      <header className="sticky top-0 z-10 bg-accent text-white shadow-lg safe-top">
        <div className="px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={onClose} aria-label="Volver" className="p-2 -ml-2 rounded hover:bg-white/10 transition-colors flex-shrink-0">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white/70 uppercase tracking-wide">Banco de rúbricas</p>
            <h1 className="text-2xl font-extrabold text-white truncate">
              {r.titulo || (isNew ? 'Nueva lista de cotejo' : 'Editar lista de cotejo')}
            </h1>
          </div>
        </div>
      </header>

      <div className="px-4 py-6">
        <form onSubmit={handleSave} className="space-y-4 max-w-3xl mx-auto">
          {/* Nombre de la lista de cotejo */}
          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
              <label htmlFor="cot-titulo" className="text-sm font-bold text-on-surface uppercase tracking-wide flex-shrink-0">
                Nombre de la lista de cotejo:
              </label>
              <input id="cot-titulo" type="text" value={r.titulo}
                onChange={(e) => setR((prev) => ({ ...prev, titulo: e.target.value }))}
                required
                placeholder="Ej: Reporte de práctica, Exposición, Portafolio"
                className="flex-1 min-w-0 px-2 py-1 border-b-2 border-outline-variant focus:border-accent focus:outline-none text-sm bg-transparent" />
            </div>
            <input type="text" value={r.descripcion}
              onChange={(e) => setR((prev) => ({ ...prev, descripcion: e.target.value }))}
              placeholder="Descripción de la tarea (opcional)…"
              className="w-full px-2 py-1 text-xs text-muted border-b border-outline-variant focus:border-accent focus:outline-none bg-transparent" />
          </div>

          {/* Tabla editable — 3 columnas */}
          <div className="bg-surface-card rounded-card shadow-card p-3">
            <table className="w-full border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '44px' }} />
                <col />
                <col style={{ width: '160px' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="px-1 py-2 border border-outline-variant bg-surface-container text-xs font-semibold text-muted align-bottom">Num</th>
                  <th className="px-2 py-2 border border-outline-variant bg-surface-container text-xs font-semibold text-muted text-left align-bottom">Criterio</th>
                  <th className="px-2 py-2 border border-outline-variant bg-[var(--accent-light)] align-middle">
                    <p className="text-sm font-bold text-accent">{COTEJO_NIVEL}</p>
                    <p className="text-[11px] font-normal text-muted">Máximo {RUBRICA_TOTAL} puntos</p>
                  </th>
                </tr>
              </thead>
              <tbody>
                {criterios.map((c, i) => (
                  <tr key={i}>
                    <td className="border border-outline-variant bg-surface-container text-center text-xs text-muted align-middle">{i + 1}</td>
                    <td className="border border-outline-variant bg-surface-container px-2 py-2 align-top">
                      <div className="flex items-start gap-1">
                        <textarea value={c.nombre}
                          onChange={(e) => setCriterioNombre(i, e.target.value)}
                          rows={2}
                          placeholder={`Criterio ${i + 1} — ej: Entregó a tiempo`}
                          aria-label={`Nombre del criterio ${i + 1}`}
                          className={`w-full min-w-0 text-base font-semibold text-on-surface resize-none ${inputCell}`} />
                        {i >= MIN_CRITERIOS && (
                          <button type="button" onClick={() => removeCriterio(i)}
                            aria-label={`Eliminar criterio ${i + 1}`} data-tooltip="Eliminar criterio"
                            className="p-1 text-slate-400 hover:text-red-500 rounded flex-shrink-0">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="border border-outline-variant align-middle px-2 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <input type="number" value={c.puntos} min="0" max={RUBRICA_TOTAL} step="0.1"
                          onChange={(e) => setCriterioPuntos(i, e.target.value)}
                          aria-label={`Puntos del criterio ${i + 1}`}
                          data-tooltip="Puntos que suma si el estudiante cumple este criterio"
                          className="w-16 px-1 py-0.5 text-center text-sm font-bold text-accent border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
                        <span className="text-[10px] text-slate-400">pts</span>
                      </div>
                    </td>
                  </tr>
                ))}

                {criterios.length < MAX_CRITERIOS && (
                  <tr>
                    <td colSpan={3} className="border-0 pt-2 pb-1">
                      <div className="flex items-center gap-2">
                        <BotonMas onClick={addCriterio} label={`Agregar criterio (${criterios.length}/${MAX_CRITERIOS})`} />
                        <span className="text-xs text-muted">Agregar criterio ({criterios.length}/{MAX_CRITERIOS})</span>
                      </div>
                    </td>
                  </tr>
                )}

                {/* SUBTOTAL — la suma no puede pasar de 10 */}
                <tr>
                  <td colSpan={2} className="border-0 px-2 py-2 text-right text-xs font-bold text-on-surface align-middle">SUMA DE PUNTOS</td>
                  <td className="border-0 px-2 py-2 text-center align-middle">
                    <p data-tooltip={`La suma no puede pasar de ${RUBRICA_TOTAL}`}
                      className={`text-sm font-bold ${sumaOk ? 'text-emerald-600' : 'text-red-600'}`}>
                      {suma} / {RUBRICA_TOTAL}
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>

            <div className={`mt-2 rounded px-3 py-2 flex items-center justify-between gap-3 border ${
              sumaOk ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-300'
            }`}>
              <p className={`text-xs font-medium ${sumaOk ? 'text-emerald-700' : 'text-amber-800'}`}>
                {suma > RUBRICA_TOTAL
                  ? `Los puntos suman ${suma} — no pueden pasar de ${RUBRICA_TOTAL}.`
                  : `Al calificar marcarás cada criterio cumplido; su suma es la calificación (sobre ${RUBRICA_TOTAL}).`}
              </p>
              <button type="button" onClick={repartir}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-outline-variant rounded bg-surface-card text-muted hover:text-accent hover:border-accent transition-colors">
                <Scale size={14} /> Repartir en partes iguales
              </button>
            </div>
          </div>

          <button type="submit" disabled={saving}
            className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
            {saving ? <Spinner size="sm" /> : <Check size={18} />}
            {saving ? 'Guardando…' : isNew ? 'Guardar lista de cotejo en mi banco' : 'Guardar cambios'}
          </button>
          <button type="button" onClick={onClose} disabled={saving}
            className="w-full py-2.5 border border-outline-variant text-muted font-medium rounded-card hover:bg-surface-container transition-colors disabled:opacity-60">
            Cancelar
          </button>
          <div className="h-6 safe-bottom" />
        </form>
      </div>
    </div>
  )
}
