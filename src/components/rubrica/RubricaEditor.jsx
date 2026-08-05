import { useState, useRef } from 'react'
import { collection, doc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import { ArrowLeft, Trash2, Scale, Check, Eye, EyeOff } from 'lucide-react'
import {
  RUBRICA_TOTAL, MIN_CRITERIOS, MAX_CRITERIOS, MIN_NIVELES, MAX_NIVELES,
  pesosEquitativos, validarRubrica, round1,
} from '../../utils/rubrica'
import RubricaTable from './RubricaTable'
import { IS_NATIVE_APP } from '../../utils/platform'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { BotonMas, EDITOR_INPUT_CELL } from './editorShared'

// ── Estado del editor ────────────────────────────────────────────────────────
// La tabla se edita con strings (inputs numéricos sin pelear con decimales):
//   niveles:   [{ nombre, valor }]            valor en PUNTOS ('10' fijo el 1º)
//   criterios: [{ nombre, puntos: [str], descriptores: [str] }]
// Al guardar se normaliza a números y porcentaje (campo almacenado).

// Sin nombres de ejemplo (Excelente/Bueno/…) a propósito — pedido explícito:
// un docente que no sabe qué es una rúbrica veía la tabla ya "completa" con
// esos nombres y los descriptores que se generaban solos al nombrarlos, y
// pensaba que la rúbrica se armaba sola. Solo los puntos (10/8/6/5) traen un
// punto de partida — son números, no texto que se pueda confundir con
// contenido ya hecho. El nombre y el resumen de cada nivel los escribe el
// docente desde cero (placeholder "Editar" — ver el <input> más abajo).
const NIVELES_NUEVA = [
  { nombre: '', valor: '10' },
  { nombre: '', valor: '8' },
  { nombre: '', valor: '6' },
  { nombre: '', valor: '5' },
]

// Un ejemplo distinto por renglón (no el mismo repetido con solo el número
// cambiando) — pedido explícito, para que se note que son sugerencias y no
// texto copiado. Solo el placeholder: el valor sigue vacío (ver criterioNuevo).
const EJEMPLOS_CRITERIO = [
  'Ortografía y redacción', 'Autenticidad', 'Creatividad',
  'Cumplimiento de instrucciones', 'Puntualidad en la entrega', 'Presentación y orden',
]

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
// proporción a los puntos de cada criterio en ese nivel.
//
// Las CUATRO celdas de un mismo renglón vienen del mismo exc_i multiplicado
// por el valor (siempre descendente) de cada nivel, así que ANTES de
// redondear ya bajan solas de izquierda a derecha — redondear cada una por
// su cuenta a 0.1 nunca puede invertir ese orden (redondear es monótono).
// Antes el último renglón no seguía esta regla: le "caía" lo que le
// faltaba a cada columna para cuadrar, calculado por separado en cada
// columna sin comparar con sus propias celdas vecinas — y ese residuo sí
// podía salir mayor que la celda anterior del mismo renglón (o negativo),
// lo que disparaba errores de validación imposibles de arreglar editando
// cualquier otro campo (bug real, 2026-08-04). Si una columna no cuadra
// exacto por el redondeo, se ve en rojo en el subtotal — con su propio
// botón para repartirla — en vez de fabricar un renglón inválido.
function recalcularCeldas(niveles, criterios) {
  const excs = criterios.map((c) => parseFloat(c.puntos[0]) || 0)
  return criterios.map((c, i) => {
    const puntos = [...c.puntos]
    niveles.forEach((nv, j) => {
      if (j === 0) return
      const valor = parseFloat(nv.valor) || 0
      puntos[j] = String(round1((excs[i] * valor) / 10))
    })
    return { ...c, puntos }
  })
}

function criterioNuevo(niveles, exc) {
  return {
    nombre: '',
    puntos: filaDerivada(exc, niveles),
    // Sin texto generado — pedido explícito, ver comentario en NIVELES_NUEVA.
    descriptores: niveles.map(() => ''),
  }
}

function estadoInicial(initial) {
  if (!initial) {
    const niveles = NIVELES_NUEVA.map((n) => ({ ...n }))
    return {
      titulo: '',
      descripcion: '',
      tema: '',
      niveles,
      criterios: [criterioNuevo(niveles, '5'), criterioNuevo(niveles, '5')],
    }
  }
  return {
    titulo: initial.titulo || '',
    descripcion: initial.descripcion || '',
    tema: initial.tema || '',
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

// Editor de rúbricas del banco personal del docente — misma tabla que ve el
// estudiante, editable en el lugar (WYSIWYG). Pantalla completa por encima
// del banco (z-[70] > picker z-[60] > editor de entregables z-50).
// `initial` = { id, ...rubrica } para editar, null para crear.
export default function RubricaEditor({ initial, docenteId, onClose, onSaved }) {
  const toast = useToast()
  const isNew = !initial?.id
  const [r, setR] = useState(() => estadoInicial(initial))
  // Foto de cómo entró `r` — mismo patrón que EvaluacionEditor.jsx (configSnap/
  // preguntaEditSnap): JSON.stringify de ambos lados, tomado UNA vez al montar
  // (`initial` no cambia en la vida del editor). Solo aplica al editar: crear
  // siempre debe poder guardarse, no hay original con qué comparar.
  const editSnapshot = useRef(JSON.stringify(estadoInicial(initial)))
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false)
  // Anchos por columna (px), redimensionables arrastrando el borde derecho
  const [colW, setColW] = useState(() => ({
    crit: CRIT_W.def,
    niveles: (initial?.niveles || NIVELES_NUEVA).map(() => NIVEL_W.def),
  }))

  const { niveles, criterios } = r

  // Este componente solo se monta mientras está abierto (lo controla el padre).
  useScrollLock(true)

  // ── Salir con cambios sin guardar ──────────────────────────────────────────
  // Pedido explícito: antes "Cancelar"/la flecha de regresar cerraban directo
  // y se perdía todo lo escrito sin avisar. `editSnapshot` ya sirve para esto
  // tal cual (crear parte de la rúbrica en blanco, así que comparar contra
  // ese mismo snapshot cubre los dos casos sin duplicar lógica).
  const [confirmSalir, setConfirmSalir] = useState(false)
  const hayCambiosSinGuardar = JSON.stringify(r) !== editSnapshot.current
  function requestClose() {
    if (hayCambiosSinGuardar) setConfirmSalir(true)
    else onClose()
  }
  useBackHandler(() => (confirmSalir ? setConfirmSalir(false) : requestClose()), true)

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
  // Renombrar un nivel SOLO renombra el nivel — ya no genera ni toca ningún
  // descriptor solo. Antes escribía un texto fijo en cada descriptor que
  // siguiera "vacío" para ese nivel, y eso era justo lo que hacía parecer
  // que la rúbrica ya estaba completa sin que el docente hubiera escrito nada.
  function setNivelNombre(j, v) {
    setR((prev) => ({
      ...prev,
      niveles: prev.niveles.map((n, k) => (k === j ? { ...n, nombre: v } : n)),
    }))
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
  // los criterios. Mismo valor para todos (sin que ninguno absorba el
  // residuo) — así ningún renglón puede terminar con una celda mayor que la
  // de su propio nivel anterior solo por el redondeo (ver recalcularCeldas).
  function repartirColumna(j) {
    if (j === 0) { repartirPesos(); return }
    setR((prev) => {
      const n = prev.criterios.length
      const valor = round1(parseFloat(prev.niveles[j].valor) || 0)
      const base = round1(valor / n)
      const criterios = prev.criterios.map((c) => {
        const puntos = [...c.puntos]
        puntos[j] = String(base)
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
      tema: r.tema.trim() || null,
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

  // El botón de guardar nunca revisaba esto — se podía enviar con los
  // subtotales en rojo (y con cualquier otro hueco: nombre vacío, un nivel
  // sin nombre, puntos que no bajan de nivel a nivel…) y solo se enteraba al
  // hacer clic, cuando handleSave llama a validarRubrica y el toast avisa.
  // Correr la MISMA validación aquí, en cada tecla, deja "Guardar" apagado
  // mientras algo no cuadre — nunca deja nada útil que enviar. Barato:
  // niveles/criterios son arreglos chicos.
  const validationError = validarRubrica(normalizada())

  const inputCell = EDITOR_INPUT_CELL
  const anchoMinTabla = 44 + colW.crit + colW.niveles.reduce((s, w) => s + w, 0) + 48 + 130

  return (
    <div className="fixed inset-0 z-[70] bg-surface overflow-y-auto">
      <header className="sticky top-0 z-10 bg-accent text-white shadow-lg safe-top">
        <div className="px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={requestClose} aria-label="Volver" className="p-2 -ml-2 rounded hover:bg-white/10 transition-colors flex-shrink-0">
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
                placeholder="Ej: Ensayo escrito, Maqueta, Proyecto final"
                className="flex-1 min-w-0 px-2 py-1 border-b-2 border-outline-variant focus:border-accent focus:outline-none text-sm bg-transparent" />
            </div>
            <input type="text" value={r.descripcion}
              onChange={(e) => setR((prev) => ({ ...prev, descripcion: e.target.value }))}
              placeholder="Descripción de la tarea (opcional)…"
              className="w-full px-2 py-1 text-xs text-muted border-b border-outline-variant focus:border-accent focus:outline-none bg-transparent" />
            {/* Tema — etiqueta libre para encontrarla rápido en el banco
                (mismo patrón que el tema de los reactivos). */}
            <input type="text" value={r.tema}
              onChange={(e) => setR((prev) => ({ ...prev, tema: e.target.value }))}
              placeholder="Tema (opcional) — para buscarla rápido en tu banco"
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
                            placeholder="Editar"
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
                            placeholder={`Criterio ${i + 1} — ej: ${EJEMPLOS_CRITERIO[i] || EJEMPLOS_CRITERIO[EJEMPLOS_CRITERIO.length - 1]}`}
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
                              placeholder="Editar"
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
              <RubricaTable rubrica={normalizada()} compact={!IS_NATIVE_APP} />
            </div>
          )}

          {/* Por qué "Guardar" sigue apagado — antes se apagaba en silencio
              (el docente cambiaba la ponderación, el botón no reaccionaba, y
              no había ninguna pista de que el motivo real era otro campo,
              como un criterio sin nombre). Mismo texto que ya usaba el toast
              al intentar guardar sin poder — ahora visible todo el tiempo,
              se actualiza solo con cada tecla. */}
          {validationError && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-card px-3 py-2 text-center">
              {validationError}
            </p>
          )}
          <button type="submit" disabled={saving || !!validationError || (!isNew && JSON.stringify(r) === editSnapshot.current)}
            className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
            {saving ? <Spinner size="sm" /> : <Check size={18} />}
            {saving ? 'Guardando…' : isNew ? 'Guardar rúbrica en mi banco' : 'Guardar cambios'}
          </button>
          <button type="button" onClick={requestClose} disabled={saving}
            className="w-full py-2.5 border border-outline-variant text-muted font-medium rounded-card hover:bg-surface-container transition-colors disabled:opacity-60">
            Cancelar
          </button>
          <div className="h-6 safe-bottom" />
        </form>
      </div>

      {/* Confirmación al salir con cambios sin guardar */}
      {confirmSalir && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !saving && setConfirmSalir(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Guardar los cambios?</h3>
            <p className="text-sm text-muted mb-3">
              Tienes cambios sin guardar en esta rúbrica. Si sales sin guardar, se pierden.
            </p>
            {validationError && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-2 mb-3">
                Con lo que llevas todavía no se puede guardar: {validationError}
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmSalir(false)} disabled={saving}
                className="flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)] disabled:opacity-60">
                Seguir editando
              </button>
              <button type="button" onClick={handleSave} disabled={saving || !!validationError}
                className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? <Spinner size="sm" /> : <Check size={16} />}
                Guardar y salir
              </button>
            </div>
            <button type="button" onClick={onClose} disabled={saving}
              className="w-full mt-2 py-2 text-sm text-red-600 font-medium hover:bg-red-50 rounded transition-colors disabled:opacity-60">
              Salir sin guardar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
