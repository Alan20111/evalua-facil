import { useState } from 'react'
import { collection, doc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import { ArrowLeft, Plus, Trash2, Scale, Eye, EyeOff } from 'lucide-react'
import {
  RUBRICA_TOTAL, MIN_CRITERIOS, MAX_CRITERIOS, MIN_NIVELES, MAX_NIVELES,
  rubricaNueva, nuevoCriterio, puntosDerivados, sumaPesos, pesosEquitativos,
  normalizarRubrica, validarRubrica, round1,
} from '../../utils/rubrica'
import RubricaTable from './RubricaTable'

// Editor de rúbricas del banco personal del docente. Pantalla completa por
// encima del editor de entregables (z-[70] > picker z-[60] > editor z-50).
// `initial` = { id, ...rubrica } para editar, null para crear.
export default function RubricaEditor({ initial, docenteId, onClose, onSaved }) {
  const toast = useToast()
  const isNew = !initial?.id
  const [r, setR] = useState(() => {
    if (!initial) return rubricaNueva()
    // Copia profunda editable de la rúbrica existente
    return {
      titulo: initial.titulo || '',
      descripcion: initial.descripcion || '',
      niveles: (initial.niveles || []).map((n) => ({ ...n })),
      criterios: (initial.criterios || []).map((c) => ({
        ...c,
        puntos: [...(c.puntos || [])],
        descriptores: [...(c.descriptores || [])],
      })),
    }
  })
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false)

  const suma = sumaPesos(r.criterios)
  const sumaOk = Math.abs(suma - RUBRICA_TOTAL) <= 0.01

  // ── Niveles ──────────────────────────────────────────────────────────────
  // Cambiar el porcentaje de un nivel recalcula esa columna de puntos en TODOS
  // los criterios (el docente puede volver a afinar celdas después).
  function setNivel(ni, field, value) {
    setR((prev) => {
      const niveles = prev.niveles.map((n, i) => (i === ni ? { ...n, [field]: value } : n))
      if (field !== 'porcentaje') return { ...prev, niveles }
      const pct = parseFloat(value) || 0
      const criterios = prev.criterios.map((c) => {
        const puntos = [...c.puntos]
        puntos[ni] = round1(((parseFloat(c.peso) || 0) * pct) / 100)
        return { ...c, puntos }
      })
      return { ...prev, niveles, criterios }
    })
  }

  function addNivel() {
    setR((prev) => {
      if (prev.niveles.length >= MAX_NIVELES) return prev
      const last = parseFloat(prev.niveles[prev.niveles.length - 1]?.porcentaje) || 50
      const pct = Math.max(5, Math.round(last - 10))
      const niveles = [...prev.niveles, { nombre: '', porcentaje: pct }]
      const criterios = prev.criterios.map((c) => ({
        ...c,
        puntos: [...c.puntos, round1(((parseFloat(c.peso) || 0) * pct) / 100)],
        descriptores: [...c.descriptores, ''],
      }))
      return { ...prev, niveles, criterios }
    })
  }

  function removeNivel(ni) {
    setR((prev) => {
      if (prev.niveles.length <= MIN_NIVELES) return prev
      return {
        ...prev,
        niveles: prev.niveles.filter((_, i) => i !== ni),
        criterios: prev.criterios.map((c) => ({
          ...c,
          puntos: c.puntos.filter((_, i) => i !== ni),
          descriptores: c.descriptores.filter((_, i) => i !== ni),
        })),
      }
    })
  }

  // ── Criterios ────────────────────────────────────────────────────────────
  function setCriterio(ci, patch) {
    setR((prev) => ({
      ...prev,
      criterios: prev.criterios.map((c, i) => (i === ci ? { ...c, ...patch } : c)),
    }))
  }

  // Cambiar el peso recalcula automáticamente los puntos de todos los niveles
  // de ese criterio (el docente puede afinar celdas individuales después).
  function setPeso(ci, value) {
    setR((prev) => ({
      ...prev,
      criterios: prev.criterios.map((c, i) =>
        i === ci ? { ...c, peso: value, puntos: puntosDerivados(value, prev.niveles) } : c
      ),
    }))
  }

  function setPunto(ci, ni, value) {
    setR((prev) => ({
      ...prev,
      criterios: prev.criterios.map((c, i) => {
        if (i !== ci) return c
        const puntos = [...c.puntos]
        puntos[ni] = value
        return { ...c, puntos }
      }),
    }))
  }

  function setDescriptor(ci, ni, value) {
    setR((prev) => ({
      ...prev,
      criterios: prev.criterios.map((c, i) => {
        if (i !== ci) return c
        const descriptores = [...c.descriptores]
        descriptores[ni] = value
        return { ...c, descriptores }
      }),
    }))
  }

  function addCriterio() {
    setR((prev) => {
      if (prev.criterios.length >= MAX_CRITERIOS) return prev
      // El criterio nuevo nace con los puntos que faltan para llegar a 10
      const restante = Math.max(0, round1(RUBRICA_TOTAL - sumaPesos(prev.criterios)))
      return { ...prev, criterios: [...prev.criterios, nuevoCriterio(prev.niveles, restante)] }
    })
  }

  function removeCriterio(ci) {
    setR((prev) => {
      if (prev.criterios.length <= MIN_CRITERIOS) return prev
      return { ...prev, criterios: prev.criterios.filter((_, i) => i !== ci) }
    })
  }

  function repartirPesos() {
    setR((prev) => {
      const pesos = pesosEquitativos(prev.criterios.length)
      return {
        ...prev,
        criterios: prev.criterios.map((c, i) => ({
          ...c, peso: pesos[i], puntos: puntosDerivados(pesos[i], prev.niveles),
        })),
      }
    })
  }

  async function handleSave(e) {
    e.preventDefault()
    const normalizada = normalizarRubrica(r)
    const error = validarRubrica(normalizada)
    if (error) { toast(error, 'error'); return }
    setSaving(true)
    try {
      if (isNew) {
        const ref = await addDoc(collection(db, 'bancoRubricas'), {
          ...normalizada, docenteId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
        onSaved?.({ id: ref.id, ...normalizada, docenteId })
        toast('Rúbrica guardada en tu banco')
      } else {
        await updateDoc(doc(db, 'bancoRubricas', initial.id), {
          ...normalizada, updatedAt: serverTimestamp(),
        })
        onSaved?.({ id: initial.id, ...normalizada, docenteId })
        toast('Rúbrica actualizada — las actividades que ya la usan no cambian')
      }
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const normalizadaPreview = normalizarRubrica(r)

  return (
    <div className="fixed inset-0 z-[70] bg-surface overflow-y-auto">
      <header className="sticky top-0 z-10 bg-accent text-white shadow-lg">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={onClose} aria-label="Volver" className="p-2 -ml-2 rounded hover:bg-white/10 transition-colors flex-shrink-0">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white/70 uppercase tracking-wide">Banco de rúbricas</p>
            <h1 className="text-2xl font-extrabold text-white truncate">
              {r.titulo || (isNew ? 'Nueva rúbrica' : 'Editar rúbrica')}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        <form onSubmit={handleSave} className="space-y-4">

          {/* Título + descripción */}
          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
            <div>
              <label htmlFor="rub-titulo" className="block text-sm font-medium text-muted mb-1">Título de la rúbrica</label>
              <input id="rub-titulo" type="text" value={r.titulo}
                onChange={(e) => setR((prev) => ({ ...prev, titulo: e.target.value }))}
                required autoFocus placeholder="Ej: Ensayo escrito, Maqueta, Proyecto final"
                className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
            </div>
            <div>
              <label htmlFor="rub-desc" className="block text-sm font-medium text-muted mb-1">
                Descripción de la tarea <span className="text-slate-400 font-normal">(opcional)</span>
              </label>
              <textarea id="rub-desc" value={r.descripcion}
                onChange={(e) => setR((prev) => ({ ...prev, descripcion: e.target.value }))}
                rows={2} placeholder="Qué se evalúa con esta rúbrica…"
                className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface resize-none" />
            </div>
            <p className="text-sm text-muted">Calificación total de la rúbrica: <span className="font-semibold text-on-surface">{RUBRICA_TOTAL}</span></p>
          </div>

          {/* Niveles de desempeño */}
          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-on-surface">Niveles de desempeño</h2>
              <p className="text-xs text-muted mt-0.5">
                De mejor a peor. El porcentaje define cuántos puntos de cada criterio vale ese nivel — los puntos se calculan solos y puedes afinarlos abajo.
              </p>
            </div>
            <div className="space-y-2">
              {r.niveles.map((nv, ni) => (
                <div key={ni} className="flex items-center gap-2">
                  <input type="text" value={nv.nombre}
                    onChange={(e) => setNivel(ni, 'nombre', e.target.value)}
                    placeholder={`Nivel ${ni + 1}`}
                    aria-label={`Nombre del nivel ${ni + 1}`}
                    className="flex-1 min-w-0 px-3 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
                  {ni === 0 ? (
                    <span data-tooltip="El primer nivel siempre vale el 100%" className="w-20 text-center text-sm font-semibold text-on-surface flex-shrink-0">100%</span>
                  ) : (
                    <div className="w-20 relative flex-shrink-0">
                      <input type="number" value={nv.porcentaje} min="1" max="99" step="1"
                        onChange={(e) => setNivel(ni, 'porcentaje', e.target.value)}
                        aria-label={`Porcentaje del nivel ${ni + 1}`}
                        className="w-full pl-2 pr-6 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm text-center bg-surface" />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">%</span>
                    </div>
                  )}
                  <button type="button" onClick={() => removeNivel(ni)}
                    disabled={ni === 0 || r.niveles.length <= MIN_NIVELES}
                    aria-label={`Eliminar nivel ${ni + 1}`} data-tooltip="Eliminar nivel"
                    className="p-2 text-slate-400 hover:text-red-500 rounded disabled:opacity-30 disabled:hover:text-slate-400 flex-shrink-0">
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </div>
            {r.niveles.length < MAX_NIVELES && (
              <button type="button" onClick={addNivel}
                className="w-full py-2 text-sm border border-dashed border-outline-variant text-muted rounded hover:border-accent hover:text-accent transition-colors flex items-center justify-center gap-1.5">
                <Plus size={16} /> Agregar nivel ({r.niveles.length}/{MAX_NIVELES})
              </button>
            )}
          </div>

          {/* Suma de pesos — visible antes de los criterios para guiar al docente */}
          <div className={`rounded-card px-4 py-3 flex items-center justify-between gap-3 border ${
            sumaOk ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-300'
          }`}>
            <p className={`text-sm font-medium ${sumaOk ? 'text-emerald-700' : 'text-amber-800'}`}>
              Los criterios suman <span className="font-bold">{suma}</span> de {RUBRICA_TOTAL} puntos
              {!sumaOk && ' — ajusta los pesos para llegar exactamente a 10'}
            </p>
            <button type="button" onClick={repartirPesos}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-outline-variant rounded bg-surface-card text-muted hover:text-accent hover:border-accent transition-colors">
              <Scale size={14} /> Repartir en partes iguales
            </button>
          </div>

          {/* Criterios */}
          {r.criterios.map((c, ci) => (
            <div key={ci} className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold flex-shrink-0" style={{ color: 'var(--accent)' }}>Criterio {ci + 1}</h3>
                <div className="flex-1" />
                <button type="button" onClick={() => removeCriterio(ci)}
                  disabled={r.criterios.length <= MIN_CRITERIOS}
                  aria-label={`Eliminar criterio ${ci + 1}`} data-tooltip="Eliminar criterio"
                  className="p-1.5 text-slate-400 hover:text-red-500 rounded disabled:opacity-30 disabled:hover:text-slate-400">
                  <Trash2 size={17} />
                </button>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <label htmlFor={`rub-cnombre-${ci}`} className="block text-xs font-medium text-muted mb-1">Aspecto a evaluar</label>
                  <input id={`rub-cnombre-${ci}`} type="text" value={c.nombre}
                    onChange={(e) => setCriterio(ci, { nombre: e.target.value })}
                    placeholder="Ej: Ortografía y redacción, Contenido, Presentación"
                    className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
                </div>
                <div className="w-24 flex-shrink-0">
                  <label htmlFor={`rub-cpeso-${ci}`} className="block text-xs font-medium text-muted mb-1">Peso (pts)</label>
                  <input id={`rub-cpeso-${ci}`} type="number" value={c.peso} min="0.5" max={RUBRICA_TOTAL} step="0.1"
                    onChange={(e) => setPeso(ci, e.target.value)}
                    className="w-full px-2 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm font-semibold text-center bg-surface" />
                </div>
              </div>

              {/* Un renglón por nivel: puntos (auto, editables) + descriptor */}
              <div className="space-y-2">
                {r.niveles.map((nv, ni) => (
                  <div key={ni} className="flex gap-2 items-start">
                    <div className="w-28 flex-shrink-0 pt-1.5">
                      <p className="text-xs font-semibold text-on-surface truncate">{nv.nombre || `Nivel ${ni + 1}`}</p>
                      {ni === 0 ? (
                        <p data-tooltip="El nivel máximo siempre vale el peso completo" className="text-sm font-bold mt-0.5" style={{ color: 'var(--accent)' }}>
                          {round1(parseFloat(c.peso) || 0)} pts
                        </p>
                      ) : (
                        <div className="flex items-center gap-1 mt-0.5">
                          <input type="number" value={c.puntos[ni]} min="0" max={parseFloat(c.peso) || 0} step="0.1"
                            onChange={(e) => setPunto(ci, ni, e.target.value)}
                            aria-label={`Puntos de ${nv.nombre || `nivel ${ni + 1}`} en criterio ${ci + 1}`}
                            className="w-14 px-1 py-1 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-xs font-semibold text-center bg-surface" />
                          <span className="text-[11px] text-slate-400">pts</span>
                        </div>
                      )}
                    </div>
                    <textarea value={c.descriptores[ni]}
                      onChange={(e) => setDescriptor(ci, ni, e.target.value)}
                      rows={2}
                      placeholder={`¿Cómo se ve este criterio en el nivel "${nv.nombre || `Nivel ${ni + 1}`}"?`}
                      aria-label={`Descriptor de ${nv.nombre || `nivel ${ni + 1}`} en criterio ${ci + 1}`}
                      className="flex-1 min-w-0 px-3 py-1.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-xs bg-surface resize-none" />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {r.criterios.length < MAX_CRITERIOS && (
            <button type="button" onClick={addCriterio}
              className="w-full py-2.5 text-sm border border-dashed border-outline-variant text-muted rounded-card hover:border-accent hover:text-accent transition-colors flex items-center justify-center gap-1.5">
              <Plus size={17} /> Agregar criterio ({r.criterios.length}/{MAX_CRITERIOS})
            </button>
          )}

          {/* Vista previa como la verán los estudiantes */}
          <button type="button" onClick={() => setPreview((v) => !v)}
            className="w-full py-2 text-sm text-accent font-medium flex items-center justify-center gap-1.5 hover:underline">
            {preview ? <EyeOff size={16} /> : <Eye size={16} />}
            {preview ? 'Ocultar vista previa' : 'Ver cómo la verán tus estudiantes'}
          </button>
          {preview && (
            <div className="bg-surface-card rounded-card shadow-card p-3">
              <RubricaTable rubrica={normalizadaPreview} />
            </div>
          )}

          <button type="submit" disabled={saving}
            className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
            {saving ? <Spinner size="sm" /> : <Plus size={18} />}
            {saving ? 'Guardando…' : isNew ? 'Guardar rúbrica en mi banco' : 'Guardar cambios'}
          </button>
          <button type="button" onClick={onClose} disabled={saving}
            className="w-full py-2.5 border border-outline-variant text-muted font-medium rounded-card hover:bg-surface-container transition-colors disabled:opacity-60">
            Cancelar
          </button>
          <div className="h-6" />
        </form>
      </div>
    </div>
  )
}
