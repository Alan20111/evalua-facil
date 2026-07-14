import { useState } from 'react'
import { collection, doc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import { ArrowLeft, Plus, Trash2, Scale, Check, Eye, EyeOff } from 'lucide-react'
import {
  RUBRICA_TOTAL, MIN_CRITERIOS, MAX_CRITERIOS, MIN_NIVELES, MAX_NIVELES,
  pesosEquitativos, validarRubrica, round1,
} from '../../utils/rubrica'
import RubricaTable from './RubricaTable'

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

// Concordancia con "de forma …" (femenino): Bueno → buena, Destacado → destacada
function adjetivoNivel(nombre) {
  const n = (nombre || '').trim().toLowerCase()
  if (!n) return ''
  return n.endsWith('o') ? n.slice(0, -1) + 'a' : n
}

// Texto fijo inicial de cada cruce criterio×nivel — editable por el docente.
// Vacío mientras el nivel no tenga nombre (se llena al nombrarlo).
function descriptorDefault(nombreNivel) {
  const adj = adjetivoNivel(nombreNivel)
  return adj ? `El estudiante cumplió de forma ${adj} este criterio` : ''
}

// Anchos de columna redimensionables con el mouse — con límites para no
// exagerarlas ni encogerlas de más
const CRIT_W = { def: 280, min: 180, max: 480 }
const NIVEL_W = { def: 175, min: 130, max: 340 }

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
    descriptores: niveles.map((nv) => descriptorDefault(nv.nombre)),
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
  const [preview, setPreview] = useState(false)
  // Anchos por columna (px), redimensionables arrastrando el borde derecho
  const [colW, setColW] = useState(() => ({
    crit: CRIT_W.def,
    niveles: (initial?.niveles || NIVELES_NUEVA).map(() => NIVEL_W.def),
  }))

  const { niveles, criterios } = r

  // ── Redimensionar columnas con el mouse ───────────────────────────────────
  function startResize(e, tipo, idx) {
    e.preventDefault()
    const startX = e.clientX
    const startW = tipo === 'crit' ? colW.crit : colW.niveles[idx]
    const lim = tipo === 'crit' ? CRIT_W : NIVEL_W
    function onMove(ev) {
      const w = Math.min(lim.max, Math.max(lim.min, startW + (ev.clientX - startX)))
      setColW((prev) => tipo === 'crit'
        ? { ...prev, crit: w }
        : { ...prev, niveles: prev.niveles.map((x, k) => (k === idx ? w : x)) })
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Agarradera de redimensionado (borde derecho de la columna) — función
  // simple, no componente, para no recrear componentes en cada render
  function resizeHandle(tipo, idx) {
    const lim = tipo === 'crit' ? CRIT_W : NIVEL_W
    const current = tipo === 'crit' ? colW.crit : colW.niveles[idx]
    // Equivalente por teclado del arrastre con mouse (rol "slider" ARIA —
    // ajusta un valor de ancho entre un mínimo y un máximo — + flechas
    // izquierda/derecha), para que la agarradera sea operable sin mouse.
    function onKeyDown(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const delta = e.key === 'ArrowRight' ? 8 : -8
      setColW((prev) => {
        const cur = tipo === 'crit' ? prev.crit : prev.niveles[idx]
        const w = Math.min(lim.max, Math.max(lim.min, cur + delta))
        return tipo === 'crit'
          ? { ...prev, crit: w }
          : { ...prev, niveles: prev.niveles.map((x, k) => (k === idx ? w : x)) }
      })
    }
    return (
      <span
        role="slider"
        aria-orientation="vertical"
        aria-valuemin={lim.min}
        aria-valuemax={lim.max}
        aria-valuenow={current}
        aria-label="Ancho de columna"
        tabIndex={0}
        onMouseDown={(e) => startResize(e, tipo, idx)}
        onKeyDown={onKeyDown}
        title="Arrastra para cambiar el ancho"
        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-[var(--accent)] opacity-60"
      />
    )
  }

  // ── Niveles (columnas) ────────────────────────────────────────────────────
  // Renombrar un nivel también actualiza los descriptores que sigan siendo el
  // texto fijo generado (los editados por el docente no se tocan).
  function setNivelNombre(j, v) {
    setR((prev) => {
      const anterior = descriptorDefault(prev.niveles[j].nombre)
      const nuevo = descriptorDefault(v)
      const nvs = prev.niveles.map((n, k) => (k === j ? { ...n, nombre: v } : n))
      const crs = prev.criterios.map((c) => {
        const d = c.descriptores[j]
        if (d !== anterior && d !== '') return c
        const descriptores = [...c.descriptores]
        descriptores[j] = nuevo
        return { ...c, descriptores }
      })
      return { ...prev, niveles: nvs, criterios: crs }
    })
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
    setColW((prev) => ({ ...prev, niveles: [...prev.niveles, NIVEL_W.def] }))
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
    setColW((prev) => ({ ...prev, niveles: prev.niveles.filter((_, k) => k !== j) }))
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

  // Reparte los 10 puntos entre criterios (columna del nivel máximo) y
  // recalcula el resto de las celdas en proporción
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

  // Reparte SOLO una columna: los puntos de ese nivel en partes iguales entre
  // los criterios (el último absorbe el residuo para que la suma sea exacta)
  function repartirColumna(j) {
    if (j === 0) { repartirPesos(); return }
    setR((prev) => {
      const n = prev.criterios.length
      const valor = round1(parseFloat(prev.niveles[j].valor) || 0)
      const base = round1(valor / n)
      const criterios = prev.criterios.map((c, i) => {
        const puntos = [...c.puntos]
        puntos[j] = String(i < n - 1 ? base : round1(valor - base * (n - 1)))
        return { ...c, puntos }
      })
      return { ...prev, criterios }
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

  // Subtotales en vivo por columna: solo se acepta que cada columna sume
  // exactamente los puntos de su nivel (verde cuadra, rojo no — como las
  // ponderaciones que deben sumar 10)
  const subtotales = niveles.map((nv, j) => {
    const target = j === 0 ? RUBRICA_TOTAL : round1(parseFloat(nv.valor) || 0)
    const suma = round1(criterios.reduce((s, c) => s + (parseFloat(c.puntos[j]) || 0), 0))
    return { suma, target, ok: Math.abs(suma - target) <= 0.01 }
  })
  const todoOk = subtotales.every((s) => s.ok)

  const inputCell = 'bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1'
  const anchoMinTabla = 44 + colW.crit + colW.niveles.reduce((s, w) => s + w, 0) + 48 + 130

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
              {r.titulo || (isNew ? 'Nueva rúbrica' : 'Editar rúbrica')}
            </h1>
          </div>
        </div>
      </header>

      {/* Pantalla completa: la tabla aprovecha todo el ancho disponible */}
      <div className="px-4 py-6">
        <form onSubmit={handleSave} className="space-y-4">

          {/* Nombre — como el encabezado de la imagen: etiqueta + línea */}
          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
              <label htmlFor="rub-titulo" className="text-sm font-bold text-on-surface uppercase tracking-wide flex-shrink-0">
                Nombre de la rúbrica:
              </label>
              <input id="rub-titulo" type="text" value={r.titulo}
                onChange={(e) => setR((prev) => ({ ...prev, titulo: e.target.value }))}
                required
                /* autofocus: primer campo de esta pantalla completa (equivalente a un modal) */
                autoFocus placeholder="Ej: Ensayo escrito, Maqueta, Proyecto final"
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
              <table className="border-collapse text-sm" style={{ minWidth: `${anchoMinTabla}px`, width: '100%', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '44px' }} />
                  <col style={{ width: `${colW.crit}px` }} />
                  {niveles.map((_, j) => <col key={j} style={{ width: `${colW.niveles[j]}px` }} />)}
                  <col style={{ width: '48px' }} />
                  <col style={{ width: '130px' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th colSpan={2} className="border-0"></th>
                    <th colSpan={niveles.length} className="px-3 py-1.5 text-sm font-semibold text-emerald-800 bg-emerald-100 border border-outline-variant">
                      Niveles de desempeño
                    </th>
                    <th className="border-0"></th>
                    <th rowSpan={2} className="px-2 py-2 border border-outline-variant bg-[var(--accent-light)] align-middle"
                      data-tooltip="Al calificar, se elige un nivel por criterio y aquí cae su valor en puntos. La suma de los puntos elegidos es la calificación.">
                      <p className="text-sm font-bold text-accent">PUNTOS</p>
                    </th>
                  </tr>
                  <tr>
                    <th className="px-1 py-2 border border-outline-variant bg-surface-container text-xs font-semibold text-muted align-bottom">Num</th>
                    <th className="relative px-2 py-2 border border-outline-variant bg-surface-container text-xs font-semibold text-muted text-left align-bottom">
                      Criterio
                      {resizeHandle('crit')}
                    </th>
                    {niveles.map((nv, j) => (
                      <th key={j} className="relative border border-outline-variant bg-[var(--accent-light)] px-2 py-2 align-top">
                        <div className="flex items-center gap-1">
                          <input type="text" value={nv.nombre}
                            onChange={(e) => setNivelNombre(j, e.target.value)}
                            placeholder={`Nivel ${j + 1}`}
                            aria-label={`Nombre del nivel ${j + 1}`}
                            className={`w-full min-w-0 text-center text-sm font-bold text-accent ${inputCell}`} />
                          {/* Los primeros 3 niveles son el mínimo — no se pueden eliminar */}
                          {j >= MIN_NIVELES && (
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
                            <input type="number" value={nv.valor} min="0" max="9.9" step="0.1"
                              onChange={(e) => setNivelValor(j, e.target.value)}
                              aria-label={`Puntos del nivel ${nv.nombre || j + 1}`}
                              data-tooltip="Menor que el nivel anterior — el nivel más bajo puede ser 0 (para quien no entrega nada)"
                              className="w-14 px-1 py-0.5 text-center text-xs font-bold text-on-surface border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
                            <span className="text-[10px] font-normal text-muted">puntos</span>
                          </div>
                        )}
                        {resizeHandle('nivel', j)}
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
                      {/* height:1px + h-full: truco para que el textarea del criterio
                          aproveche toda la altura del renglón */}
                      <td className="border border-outline-variant bg-surface-container px-2 py-2 align-top" style={{ height: '1px' }}>
                        <div className="flex items-start gap-1 h-full">
                          <textarea value={c.nombre}
                            onChange={(e) => setCriterioNombre(i, e.target.value)}
                            placeholder={`Criterio ${i + 1} — ej: Ortografía y redacción`}
                            aria-label={`Nombre del criterio ${i + 1}`}
                            className={`w-full min-w-0 h-full text-base font-semibold text-on-surface resize-none ${inputCell}`}
                            style={{ minHeight: '110px' }} />
                          {/* Los primeros 2 criterios son el mínimo — no se pueden eliminar */}
                          {i >= MIN_CRITERIOS && (
                            <button type="button" onClick={() => removeCriterio(i)}
                              aria-label={`Eliminar criterio ${i + 1}`} data-tooltip="Eliminar criterio"
                              className="p-1 text-slate-400 hover:text-red-500 rounded flex-shrink-0">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                      {niveles.map((nv, j) => (
                        /* height:1px + h-full: la caja de texto llena la celda y los
                           puntos quedan hasta abajo, arribita de la raya */
                        <td key={j} className="border border-outline-variant p-0 align-top" style={{ height: '1px' }}>
                          <div className="h-full flex flex-col px-2 py-2">
                            <textarea value={c.descriptores[j]}
                              onChange={(e) => setDescriptor(i, j, e.target.value)}
                              rows={4}
                              placeholder={`¿Cómo se ve "${c.nombre || `el criterio ${i + 1}`}" en este nivel?`}
                              aria-label={`Descriptor de ${nv.nombre || `nivel ${j + 1}`} en criterio ${i + 1}`}
                              className={`w-full flex-1 text-sm text-muted resize-none ${inputCell}`} />
                            <div className="flex items-center justify-end gap-1 mt-auto pt-1.5 flex-shrink-0">
                              <input type="number" value={c.puntos[j]} min="0" max={RUBRICA_TOTAL} step="0.1"
                                onChange={(e) => (j === 0 ? setExc(i, e.target.value) : setPunto(i, j, e.target.value))}
                                aria-label={`Puntos de ${nv.nombre || `nivel ${j + 1}`} en criterio ${i + 1}`}
                                data-tooltip={j === 0 ? 'Lo que vale este criterio (recalcula el renglón)' : 'Editable — la columna debe sumar los puntos del nivel'}
                                className={`w-14 px-1 py-0.5 text-center text-xs font-bold border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${j === 0 ? 'text-accent' : ''}`} />
                              <span className="text-[10px] text-slate-400">pts</span>
                            </div>
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

                  {/* SUBTOTAL por columna — verde cuadra, rojo no (la regla vive en
                      el tooltip; el guardado solo se acepta con todo en verde) */}
                  <tr>
                    <td colSpan={2} className="border-0 px-2 py-2 text-right text-xs font-bold text-on-surface align-top">SUBTOTAL</td>
                    {subtotales.map((s, j) => (
                      <td key={j} className="border-0 px-2 py-2 text-center align-top">
                        <p
                          data-tooltip={j === 0
                            ? 'Deben sumar 10 forzosamente'
                            : `Deben sumar los puntos del nivel (${s.target})`}
                          className={`text-sm font-bold ${s.ok ? 'text-emerald-600' : 'text-red-600'}`}
                        >
                          {s.suma} / {s.target}
                        </p>
                        <button type="button" onClick={() => repartirColumna(j)}
                          aria-label={`Repartir los ${s.target} puntos de esta columna en partes iguales`}
                          data-tooltip={`Repartir los ${s.target} puntos de esta columna en partes iguales`}
                          className="mt-1 p-1.5 rounded border border-outline-variant text-muted hover:text-accent hover:border-accent transition-colors">
                          <Scale size={14} />
                        </button>
                      </td>
                    ))}
                    <td className="border-0"></td>
                    <td className="border-0 px-2 py-2 text-center align-top">
                      <span data-tooltip="La suma de los puntos elegidos es la calificación"
                        className="text-xs font-semibold text-muted cursor-default">= Calificación</span>
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
                  : 'Hay columnas que no suman los puntos de su nivel (en rojo). Ajusta las celdas o usa la balanza de cada columna.'}
              </p>
              <button type="button" onClick={repartirPesos}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-outline-variant rounded bg-surface-card text-muted hover:text-accent hover:border-accent transition-colors">
                <Scale size={14} /> Repartir en partes iguales
              </button>
            </div>
          </div>

          {/* Vista previa: la rúbrica exactamente como la verá el estudiante */}
          <button type="button" onClick={() => setPreview((v) => !v)}
            className="w-full py-2 text-sm text-accent font-medium flex items-center justify-center gap-1.5 hover:underline">
            {preview ? <EyeOff size={16} /> : <Eye size={16} />}
            {preview ? 'Ocultar vista del estudiante' : 'Ver cómo vería el estudiante esta rúbrica'}
          </button>
          {preview && (
            <div className="bg-surface-card rounded-card shadow-card p-3">
              <RubricaTable rubrica={normalizada()} />
            </div>
          )}

          <button type="submit" disabled={saving}
            className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
            {saving ? <Spinner size="sm" /> : <Check size={18} />}
            {saving ? 'Guardando…' : isNew ? 'Guardar rúbrica en mi banco' : 'Guardar cambios'}
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
