import { useState } from 'react'
import { collection, doc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import { ArrowLeft, Plus, Trash2, Scale, Check } from 'lucide-react'
import {
  RUBRICA_TOTAL, MIN_CRITERIOS, MAX_CRITERIOS, MIN_NIVELES, MAX_NIVELES,
  pesosEquitativos, validarRubrica, round1,
} from '../../utils/rubrica'

// ── Estado del editor ────────────────────────────────────────────────────────
// La tabla se edita con strings (inputs numéricos sin pelear con decimales):
//   niveles:   [{ nombre, valor }]            valor en PUNTOS ('10' fijo el 1º)
//   criterios: [{ nombre, puntos: [str], descriptores: [str] }]
// Al guardar se normaliza a números y porcentaje (campo almacenado).

const NIVELES_NUEVA = [
  { nombre: 'Excelente', valor: '10' },
  { nombre: 'Bueno', valor: '8' },
  { nombre: 'Suficiente', valor: '6' },
  { nombre: 'Insuficiente', valor: '5' },
]

// Celdas de un renglón derivadas de sus puntos en el nivel máximo:
// puntos_j = exc × (valor_j / 10)
function filaDerivada(exc, niveles) {
  const e = parseFloat(exc) || 0
  return niveles.map((nv, j) => (j === 0 ? String(round1(e)) : String(round1((e * (parseFloat(nv.valor) || 0)) / 10))))
}

// Recalcula TODAS las celdas (excepto la columna del nivel máximo) en
// proporción a los puntos de cada criterio en ese nivel. El último renglón
// absorbe el residuo de redondeo para que cada columna sume exacto.
function recalcularCeldas(niveles, criterios) {
  const n = criterios.length
  const excs = criterios.map((c) => parseFloat(c.puntos[0]) || 0)
  return criterios.map((c, i) => {
    const puntos = [...c.puntos]
    niveles.forEach((nv, j) => {
      if (j === 0) return
      const valor = parseFloat(nv.valor) || 0
      if (i < n - 1) {
        puntos[j] = String(round1((excs[i] * valor) / 10))
      } else {
        const otros = excs.slice(0, n - 1).reduce((s, e) => s + round1((e * valor) / 10), 0)
        puntos[j] = String(round1(valor - otros))
      }
    })
    return { ...c, puntos }
  })
}

function criterioNuevo(niveles, exc) {
  return {
    nombre: '',
    puntos: filaDerivada(exc, niveles),
    descriptores: niveles.map(() => ''),
  }
}

function estadoInicial(initial) {
  if (!initial) {
    const niveles = NIVELES_NUEVA.map((n) => ({ ...n }))
    return {
      titulo: '',
      descripcion: '',
      niveles,
      criterios: [criterioNuevo(niveles, '5'), criterioNuevo(niveles, '5')],
    }
  }
  return {
    titulo: initial.titulo || '',
    descripcion: initial.descripcion || '',
    niveles: (initial.niveles || []).map((n) => ({
      nombre: n.nombre || '',
      valor: String(round1((parseFloat(n.porcentaje) || 0) / 10)),
    })),
    criterios: (initial.criterios || []).map((c) => ({
      nombre: c.nombre || '',
      puntos: (c.puntos || []).map((p) => String(p)),
      descriptores: [...(c.descriptores || [])],
    })),
  }
}

// Botón circular "+" (agregar criterios hacia abajo / niveles a la derecha)
function BotonMas({ onClick, label }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} data-tooltip={label}
      className="w-9 h-9 rounded-full border-2 border-on-surface bg-surface-card text-on-surface flex items-center justify-center hover:border-accent hover:text-accent transition-colors flex-shrink-0 shadow-card">
      <Plus size={20} />
    </button>
  )
}

// Editor de rúbricas del banco personal del docente — misma tabla que ve el
// estudiante, editable en el lugar (WYSIWYG). Pantalla completa por encima
// del banco (z-[70] > picker z-[60] > editor de entregables z-50).
// `initial` = { id, ...rubrica } para editar, null para crear.
export default function RubricaEditor({ initial, docenteId, onClose, onSaved }) {
  const toast = useToast()
  const isNew = !initial?.id
  const [r, setR] = useState(() => estadoInicial(initial))
  const [saving, setSaving] = useState(false)

  const { niveles, criterios } = r

  // ── Niveles (columnas) ────────────────────────────────────────────────────
  function setNivelNombre(j, v) {
    setR((prev) => ({ ...prev, niveles: prev.niveles.map((n, k) => (k === j ? { ...n, nombre: v } : n)) }))
  }

  // Cambiar los puntos de un nivel recalcula sus celdas en proporción
  function setNivelValor(j, v) {
    setR((prev) => {
      const nvs = prev.niveles.map((n, k) => (k === j ? { ...n, valor: v } : n))
      return { ...prev, niveles: nvs, criterios: recalcularCeldas(nvs, prev.criterios) }
    })
  }

  function addNivel() {
    setR((prev) => {
      if (prev.niveles.length >= MAX_NIVELES) return prev
      const ultimo = parseFloat(prev.niveles[prev.niveles.length - 1]?.valor) || 2
      const valor = String(Math.max(1, round1(ultimo - 1)))
      const nvs = [...prev.niveles, { nombre: '', valor }]
      const crs = prev.criterios.map((c) => ({
        ...c,
        puntos: [...c.puntos, '0'],
        descriptores: [...c.descriptores, ''],
      }))
      return { ...prev, niveles: nvs, criterios: recalcularCeldas(nvs, crs) }
    })
  }

  function removeNivel(j) {
    setR((prev) => {
      if (prev.niveles.length <= MIN_NIVELES) return prev
      return {
        ...prev,
        niveles: prev.niveles.filter((_, k) => k !== j),
        criterios: prev.criterios.map((c) => ({
          ...c,
          puntos: c.puntos.filter((_, k) => k !== j),
          descriptores: c.descriptores.filter((_, k) => k !== j),
        })),
      }
    })
  }

  // ── Criterios (renglones) ─────────────────────────────────────────────────
  function setCriterioNombre(i, v) {
    setR((prev) => ({ ...prev, criterios: prev.criterios.map((c, k) => (k === i ? { ...c, nombre: v } : c)) }))
  }

  // Los puntos del nivel máximo son el "peso" del criterio: cambiarlos
  // recalcula el resto del renglón (y el ajuste del último renglón por columna)
  function setExc(i, v) {
    setR((prev) => {
      const crs = prev.criterios.map((c, k) => {
        if (k !== i) return c
        const puntos = [...c.puntos]
        puntos[0] = v
        return { ...c, puntos }
      })
      return { ...prev, criterios: recalcularCeldas(prev.niveles, crs) }
    })
  }

  // Celdas de niveles intermedios: edición directa — el subtotal en vivo
  // avisa si la columna deja de sumar los puntos del nivel
  function setPunto(i, j, v) {
    setR((prev) => ({
      ...prev,
      criterios: prev.criterios.map((c, k) => {
        if (k !== i) return c
        const puntos = [...c.puntos]
        puntos[j] = v
        return { ...c, puntos }
      }),
    }))
  }

  function setDescriptor(i, j, v) {
    setR((prev) => ({
      ...prev,
      criterios: prev.criterios.map((c, k) => {
        if (k !== i) return c
        const descriptores = [...c.descriptores]
        descriptores[j] = v
        return { ...c, descriptores }
      }),
    }))
  }

  function addCriterio() {
    setR((prev) => {
      if (prev.criterios.length >= MAX_CRITERIOS) return prev
      // El criterio nuevo nace con los puntos que faltan para llegar a 10
      const sumaExc = prev.criterios.reduce((s, c) => s + (parseFloat(c.puntos[0]) || 0), 0)
      const restante = Math.max(0, round1(RUBRICA_TOTAL - sumaExc))
      const crs = [...prev.criterios, criterioNuevo(prev.niveles, String(restante))]
      return { ...prev, criterios: recalcularCeldas(prev.niveles, crs) }
    })
  }

  function removeCriterio(i) {
    setR((prev) => {
      if (prev.criterios.length <= MIN_CRITERIOS) return prev
      return { ...prev, criterios: prev.criterios.filter((_, k) => k !== i) }
    })
  }

  function repartirPesos() {
    setR((prev) => {
      const pesos = pesosEquitativos(prev.criterios.length)
      const crs = prev.criterios.map((c, i) => {
        const puntos = [...c.puntos]
        puntos[0] = String(pesos[i])
        return { ...c, puntos }
      })
      return { ...prev, criterios: recalcularCeldas(prev.niveles, crs) }
    })
  }

  // ── Guardar ───────────────────────────────────────────────────────────────
  function normalizada() {
    return {
      titulo: r.titulo.trim(),
      descripcion: r.descripcion.trim(),
      niveles: r.niveles.map((n) => ({
        nombre: n.nombre.trim(),
        // porcentaje es el campo almacenado (compatibilidad): 10 pts → 100%
        porcentaje: round1((parseFloat(n.valor) || 0) * 10),
      })),
      criterios: r.criterios.map((c) => {
        const puntos = c.puntos.map((p) => round1(parseFloat(p) || 0))
        return {
          nombre: c.nombre.trim(),
          peso: puntos[0],
          puntos,
          descriptores: c.descriptores.map((d) => (d || '').trim()),
        }
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
        toast('Rúbrica guardada en tu banco')
      } else {
        await updateDoc(doc(db, 'bancoRubricas', initial.id), {
          ...norm, updatedAt: serverTimestamp(),
        })
        onSaved?.({ id: initial.id, ...norm, docenteId })
        toast('Rúbrica actualizada — las actividades que ya la usan no cambian')
      }
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // Subtotales en vivo por columna (la retro inmediata que guía al docente)
  const subtotales = niveles.map((nv, j) => {
    const target = j === 0 ? RUBRICA_TOTAL : round1(parseFloat(nv.valor) || 0)
    const suma = round1(criterios.reduce((s, c) => s + (parseFloat(c.puntos[j]) || 0), 0))
    return { suma, target, ok: Math.abs(suma - target) <= 0.01 }
  })
  const todoOk = subtotales.every((s) => s.ok)

  const inputCell = 'bg-transparent focus:outline-none focus:ring-2 focus:ring-accent rounded px-1'

  return (
    <div className="fixed inset-0 z-[70] bg-surface overflow-y-auto">
      <header className="sticky top-0 z-10 bg-accent text-white shadow-lg">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
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

      <div className="max-w-6xl mx-auto px-4 py-6">
        <form onSubmit={handleSave} className="space-y-4">

          {/* Nombre — como el encabezado de la imagen: etiqueta + línea */}
          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
              <label htmlFor="rub-titulo" className="text-sm font-bold text-on-surface uppercase tracking-wide flex-shrink-0">
                Nombre de la rúbrica:
              </label>
              <input id="rub-titulo" type="text" value={r.titulo}
                onChange={(e) => setR((prev) => ({ ...prev, titulo: e.target.value }))}
                required autoFocus placeholder="Ej: Ensayo escrito, Maqueta, Proyecto final"
                className="flex-1 min-w-0 px-2 py-1 border-b-2 border-outline-variant focus:border-accent focus:outline-none text-sm bg-transparent" />
            </div>
            <input type="text" value={r.descripcion}
              onChange={(e) => setR((prev) => ({ ...prev, descripcion: e.target.value }))}
              placeholder="Descripción de la tarea (opcional)…"
              className="w-full px-2 py-1 text-xs text-muted border-b border-outline-variant focus:border-accent focus:outline-none bg-transparent" />
          </div>

          {/* Tabla editable — espejo de la vista del estudiante */}
          <div className="bg-surface-card rounded-card shadow-card p-3">
            <div className="overflow-x-auto pb-1">
              <table className="border-collapse text-sm" style={{ minWidth: `${220 + niveles.length * 168 + 48 + 136}px`, width: '100%' }}>
                <thead>
                  <tr>
                    <th colSpan={2} className="border-0"></th>
                    <th colSpan={niveles.length} className="px-3 py-1.5 text-sm font-semibold text-emerald-800 bg-emerald-100 border border-outline-variant">
                      Niveles de desempeño
                    </th>
                    <th className="border-0 w-12"></th>
                    <th rowSpan={2} className="px-2 py-2 border border-outline-variant bg-[var(--accent-light)] w-36 align-middle">
                      <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>PUNTOS</p>
                      <p className="text-[10px] font-normal text-muted mt-1 leading-snug">Al calificar, se elige un nivel por criterio y aquí cae su valor</p>
                    </th>
                  </tr>
                  <tr>
                    <th className="w-9 px-1 py-2 border border-outline-variant bg-surface-container text-xs font-semibold text-muted align-bottom">Num</th>
                    <th className="w-44 px-2 py-2 border border-outline-variant bg-surface-container text-xs font-semibold text-muted text-left align-bottom">Criterio</th>
                    {niveles.map((nv, j) => (
                      <th key={j} className="border border-outline-variant bg-[var(--accent-light)] px-2 py-2 align-top" style={{ minWidth: '160px' }}>
                        <div className="flex items-center gap-1">
                          <input type="text" value={nv.nombre}
                            onChange={(e) => setNivelNombre(j, e.target.value)}
                            placeholder={`Nivel ${j + 1}`}
                            aria-label={`Nombre del nivel ${j + 1}`}
                            className={`w-full min-w-0 text-center text-sm font-bold ${inputCell}`}
                            style={{ color: 'var(--accent)' }} />
                          {j > 0 && niveles.length > MIN_NIVELES && (
                            <button type="button" onClick={() => removeNivel(j)}
                              aria-label={`Eliminar nivel ${nv.nombre || j + 1}`} data-tooltip="Eliminar nivel"
                              className="p-1 text-slate-400 hover:text-red-500 rounded flex-shrink-0">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                        {j === 0 ? (
                          <p data-tooltip="El nivel máximo siempre vale 10 puntos — fijo" className="text-xs font-normal text-muted mt-1">
                            <span className="font-bold text-on-surface">10 puntos</span> (fijo)
                          </p>
                        ) : (
                          <div className="flex items-center justify-center gap-1 mt-1">
                            <input type="number" value={nv.valor} min="0.5" max="9.9" step="0.1"
                              onChange={(e) => setNivelValor(j, e.target.value)}
                              aria-label={`Puntos del nivel ${nv.nombre || j + 1}`}
                              data-tooltip="Menor que el nivel anterior, mayor que 0"
                              className="w-14 px-1 py-0.5 text-center text-xs font-bold text-on-surface border border-outline-variant rounded bg-surface focus:outline-none focus:ring-2 focus:ring-accent" />
                            <span className="text-[10px] font-normal text-muted">puntos</span>
                          </div>
                        )}
                      </th>
                    ))}
                    {/* "+" a la derecha: agrega niveles de desempeño */}
                    <th className="border-0 px-1 align-middle">
                      {niveles.length < MAX_NIVELES && (
                        <BotonMas onClick={addNivel} label={`Agregar nivel de desempeño (${niveles.length}/${MAX_NIVELES})`} />
                      )}
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
                            rows={2} placeholder={`Criterio ${i + 1} — ej: Ortografía y redacción`}
                            aria-label={`Nombre del criterio ${i + 1}`}
                            className={`w-full min-w-0 text-xs font-semibold text-on-surface resize-none ${inputCell}`} />
                          {criterios.length > MIN_CRITERIOS && (
                            <button type="button" onClick={() => removeCriterio(i)}
                              aria-label={`Eliminar criterio ${i + 1}`} data-tooltip="Eliminar criterio"
                              className="p-1 text-slate-400 hover:text-red-500 rounded flex-shrink-0">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                      {niveles.map((nv, j) => (
                        <td key={j} className="border border-outline-variant px-2 py-2 align-top">
                          <textarea value={c.descriptores[j]}
                            onChange={(e) => setDescriptor(i, j, e.target.value)}
                            rows={3}
                            placeholder={`¿Cómo se ve "${c.nombre || `el criterio ${i + 1}`}" en este nivel?`}
                            aria-label={`Descriptor de ${nv.nombre || `nivel ${j + 1}`} en criterio ${i + 1}`}
                            className={`w-full text-xs text-muted resize-none ${inputCell}`} />
                          <div className="flex items-center justify-end gap-1 mt-1">
                            <input type="number" value={c.puntos[j]} min="0" max={RUBRICA_TOTAL} step="0.1"
                              onChange={(e) => (j === 0 ? setExc(i, e.target.value) : setPunto(i, j, e.target.value))}
                              aria-label={`Puntos de ${nv.nombre || `nivel ${j + 1}`} en criterio ${i + 1}`}
                              data-tooltip={j === 0 ? 'Lo que vale este criterio (recalcula el renglón)' : 'Editable — la columna debe sumar los puntos del nivel'}
                              className="w-14 px-1 py-0.5 text-center text-xs font-bold border border-outline-variant rounded bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
                              style={j === 0 ? { color: 'var(--accent)' } : undefined} />
                            <span className="text-[10px] text-slate-400">pts</span>
                          </div>
                        </td>
                      ))}
                      <td className="border-0"></td>
                      <td className="border border-outline-variant px-2 py-2 text-[10px] text-slate-400 italic align-middle leading-snug">
                        Aquí caerán los puntos del nivel que elijas al calificar
                      </td>
                    </tr>
                  ))}

                  {/* "+" hacia abajo: agrega criterios */}
                  {criterios.length < MAX_CRITERIOS && (
                    <tr>
                      <td colSpan={2} className="border-0 pt-2 pb-1">
                        <div className="flex items-center gap-2">
                          <BotonMas onClick={addCriterio} label={`Agregar criterio (${criterios.length}/${MAX_CRITERIOS})`} />
                          <span className="text-xs text-muted">Agregar criterio ({criterios.length}/{MAX_CRITERIOS})</span>
                        </div>
                      </td>
                      <td colSpan={niveles.length + 2} className="border-0"></td>
                    </tr>
                  )}

                  {/* SUBTOTAL por columna — la guía en vivo del docente */}
                  <tr>
                    <td colSpan={2} className="border-0 px-2 py-2 text-right text-xs font-bold text-on-surface align-top">SUBTOTAL</td>
                    {subtotales.map((s, j) => (
                      <td key={j} className="border-0 px-2 py-2 text-center align-top">
                        <p className={`text-sm font-bold ${s.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                          {s.suma} / {s.target}
                        </p>
                        <p className="text-[10px] text-muted leading-snug mt-0.5">
                          {j === 0 ? 'Deben sumar 10 forzosamente' : 'Deben sumar los puntos del nivel'}
                        </p>
                      </td>
                    ))}
                    <td className="border-0"></td>
                    <td className="border-0 px-2 py-2 text-[10px] text-muted align-top leading-snug">
                      La suma de los puntos elegidos es la <span className="font-semibold">calificación</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Barra de estado + ayuda para cuadrar pesos */}
            <div className={`mt-2 rounded px-3 py-2 flex items-center justify-between gap-3 border ${
              todoOk ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-300'
            }`}>
              <p className={`text-xs font-medium ${todoOk ? 'text-emerald-700' : 'text-amber-800'}`}>
                {todoOk
                  ? 'Todas las columnas cuadran — la rúbrica califica sobre 10.'
                  : 'Hay columnas que no suman los puntos de su nivel (en rojo). Ajusta las celdas o reparte de nuevo.'}
              </p>
              <button type="button" onClick={repartirPesos}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-outline-variant rounded bg-surface-card text-muted hover:text-accent hover:border-accent transition-colors">
                <Scale size={14} /> Repartir en partes iguales
              </button>
            </div>
          </div>

          <button type="submit" disabled={saving}
            className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
            {saving ? <Spinner size="sm" /> : <Check size={18} />}
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
