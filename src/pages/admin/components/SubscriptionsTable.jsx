import { useState, useMemo } from 'react'
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { Plus, Pencil, Ban, Trash2, X, RotateCcw } from 'lucide-react'
import EFDateTimePicker from '../../../components/EFDateTimePicker'
import SearchInput from '../../../components/SearchInput'
import { db } from '../../../firebase'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import { useBackHandler } from '../../../hooks/useBackHandler'
import { useScrollLock } from '../../../hooks/useScrollLock'
import { useColumnWidths } from '../../../hooks/useColumnWidths'
import { normalizeName } from '../../../utils/schoolSelection'
import { subjectDisplayName } from '../../../utils/subjectName'
import {
  calcDaysRemaining,
  effectiveVencimiento,
  formatDate,
  getSubscriptionStatusColor,
  toDate,
  SUBSCRIPTION_STATUSES,
} from '../../../utils/subscriptionHelpers'

const inputCls =
  'w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface'

// Cuántas filas se pintan de golpe, igual que en el padrón de Estudiantes.
const PAGE = 100

// La tabla no estira la página: se queda de este alto y su interior se
// desplaza con los encabezados fijos arriba.
const ALTO_TABLA = 'calc(100vh - 290px)'

const WIDTHS_KEY = 'admin-suscripciones-cols-v1'

// Nombres que ve el administrador. `status` es el valor guardado en Firestore;
// esto es solo su etiqueta ("pendiente_pago" se lee fatal en una tabla).
const ESTADO_LABEL = {
  trial: 'Prueba',
  activa: 'Activa',
  pendiente_pago: 'Pendiente de pago',
  vencida: 'Vencida',
  cancelada: 'Cancelada',
}

// Columnas. `filtro` = tipo de caja bajo el título:
//   'texto' → se escribe y filtra, con sugerencias de los valores que todavía
//             cumplen (sirve con cientos de escuelas)
//   'fecha' → selector de día
//   'lista' → desplegable con los valores posibles (pocos y fijos)
// Orden fijo: del alta más nueva a la más antigua, igual que Estudiantes.
const COLS = [
  { key: 'num', label: 'Resultado del filtro', w: 145, align: 'right', wrap: true },
  { key: 'docente', label: 'Nombre del docente', w: 185 },
  { key: 'correo', label: 'Correo electrónico', w: 200 },
  { key: 'escuela', label: 'Escuela', filtro: 'texto', w: 150 },
  {
    key: 'asignatura',
    label: 'Asignatura',
    filtro: 'texto',
    w: 190,
    ayuda: 'La suscripción es del docente, no de una asignatura: aquí van todas las que tiene dadas de alta.',
  },
  {
    key: 'alta',
    label: 'Fecha de alta',
    filtro: 'fecha',
    w: 135,
    ayuda: 'Cuándo empezó esta suscripción (su fecha de inicio).',
  },
  {
    key: 'plan',
    label: 'Plan',
    filtro: 'lista',
    w: 165,
    ayuda: 'QUÉ contrató. Hoy solo existe la Suscripción mensual; quien está en prueba todavía no tiene plan.',
  },
  {
    key: 'estado',
    label: 'Estado',
    filtro: 'lista',
    w: 155,
    ayuda: 'CÓMO está hoy esa suscripción: en prueba, activa, pendiente de pago, vencida o cancelada.',
  },
  {
    key: 'vencimiento',
    label: 'Vencimiento',
    filtro: 'fecha',
    w: 135,
    ayuda: 'En las pruebas es siempre inicio + 30 días, se calcula al vuelo (no se lee de la fecha guardada, que en registros viejos trae ventanas de antes).',
  },
  { key: 'dias', label: 'Días', w: 95, align: 'right' },
  { key: 'acciones', label: 'Acciones', w: 120 },
]

const CAMPOS_TEXTO = ['escuela', 'asignatura']
const CAMPOS_LISTA = ['plan', 'estado']
const CAMPOS_FILTRO = COLS.filter((c) => c.filtro).map((c) => c.key)
const SIN_FILTROS = Object.fromEntries(CAMPOS_FILTRO.map((k) => [k, '']))

const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// El docente se muestra por su nombre real; si todavía no completó su perfil
// queda el usuario o el correo, que es lo único que hay.
function teacherName(teacher) {
  return teacher?.nombreMostrar || teacher?.nombre || teacher?.username || ''
}

function StatusBadge({ status }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getSubscriptionStatusColor(status)}`}>
      {ESTADO_LABEL[status] || status?.replace('_', ' ')}
    </span>
  )
}

// ¿Esta fila pasa los filtros? `excepto` deja fuera un campo a propósito, para
// calcular qué sugerir en ESA columna sin que su propio texto a medio escribir
// recorte la lista.
function pasaFiltros(r, filtros, search, excepto) {
  const t = (k) => (k === excepto ? '' : normalizeName(filtros[k]))
  if (t('escuela') && !r.buscarEscuela.includes(t('escuela'))) return false
  if (t('asignatura') && !r.buscarAsignatura.includes(t('asignatura'))) return false
  if (excepto !== 'alta' && filtros.alta && r.altaISO !== filtros.alta) return false
  if (excepto !== 'vencimiento' && filtros.vencimiento && r.vencimientoISO !== filtros.vencimiento) return false
  if (excepto !== 'plan' && filtros.plan && r.plan !== filtros.plan) return false
  if (excepto !== 'estado' && filtros.estado && r.estadoLabel !== filtros.estado) return false
  const q = normalizeName(search)
  if (q && ![r.buscarDocente, r.buscarCorreo].some((v) => v.includes(q))) return false
  return true
}

// Caja de filtro de una columna, con su "x" para quitarlo al instante.
function CeldaFiltro({ col, valor, onChange, sugerencias }) {
  const activo = valor !== ''
  const base = `w-full text-xs normal-case rounded border px-1.5 py-1 pr-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    activo
      ? 'border-accent bg-surface-card text-accent font-semibold'
      : 'border-outline-variant bg-surface-card text-muted'
  }`
  const listId = `sug-sub-${col.key}`
  return (
    <div className="relative mt-1">
      {col.filtro === 'fecha' && (
        <input
          type="date" value={valor} onChange={(e) => onChange(e.target.value)}
          aria-label={`Filtrar por ${col.label}`} className={base}
        />
      )}
      {col.filtro === 'lista' && (
        // Los valores posibles son pocos y fijos, así que un desplegable evita
        // escribir "pendiente de pago" completo para filtrar por él.
        <select
          value={valor} onChange={(e) => onChange(e.target.value)}
          aria-label={`Filtrar por ${col.label}`} className={base}
        >
          <option value="">Todos</option>
          {sugerencias.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      )}
      {col.filtro === 'texto' && (
        <>
          {/* <datalist> nativo: al escribir, el navegador sugiere los valores
              que todavía cumplen con lo demás que ya está filtrado. */}
          <input
            type="text" value={valor} onChange={(e) => onChange(e.target.value)}
            list={listId} placeholder="Buscar…" autoComplete="off"
            aria-label={`Filtrar por ${col.label}`} className={base}
          />
          <datalist id={listId}>
            {sugerencias.map((v) => <option key={v} value={v} />)}
          </datalist>
        </>
      )}
      {activo && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={`Quitar filtro de ${col.label}`}
          title="Quitar este filtro"
          className="absolute right-1 top-1/2 -translate-y-1/2 text-accent hover:text-accent-hover"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

export default function SubscriptionsTable({ stats, onRefresh }) {
  const toast = useToast()
  const [modal, setModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filtros, setFiltros] = useState(SIN_FILTROS)
  const [limit, setLimit] = useState(PAGE)
  const { containerRef, widths, total, dragKey, startResize, resetWidths, resetColumn, esRedimensionable } =
    useColumnWidths(WIDTHS_KEY, COLS)

  useBackHandler(() => setModal(null), !!modal)
  useScrollLock(!!modal)

  // Memoizados aunque parezcan triviales: el `|| []` crea un arreglo nuevo en
  // cada render y eso invalidaría los useMemo que dependen de ellos.
  const teachers = useMemo(() => stats?.teachers || [], [stats?.teachers])
  const plans = useMemo(() => stats?.plans || [], [stats?.plans])
  const teachersMap = useMemo(() => Object.fromEntries(teachers.map((t) => [t.id, t])), [teachers])
  const plansMap = useMemo(() => Object.fromEntries(plans.map((p) => [p.id, p])), [plans])

  // Asignaturas por docente: la suscripción es del docente, así que la columna
  // Asignatura junta todas las suyas (sin archivar primero, que son las vivas).
  const subjectsByTeacher = useMemo(() => {
    const map = {}
    ;(stats?.subjects || []).forEach((s) => {
      if (!s.docenteId) return
      ;(map[s.docenteId] ||= []).push(subjectDisplayName(s) || '—')
    })
    Object.values(map).forEach((list) => list.sort((a, b) => a.localeCompare(b, 'es')))
    return map
  }, [stats?.subjects])

  // Cada suscripción se "aplana" una sola vez a las columnas visibles: así el
  // filtro trabaja sobre texto ya resuelto en vez de volver a cruzar docente,
  // escuela y asignaturas en cada tecla.
  const rows = useMemo(() => {
    if (!stats) return []
    const { subscriptions = [], schoolsMap = {} } = stats
    return subscriptions.map((sub) => {
      const teacher = teachersMap[sub.docenteId]
      const school = schoolsMap[teacher?.escuelaId]
      const plan = plansMap[sub.planId]
      // El alta de la suscripción es su fecha de inicio; los documentos que no
      // la traen caen a cuándo se creó el registro.
      const altaValor = sub.fechaInicio || sub.createdAt
      const alta = toDate(altaValor)
      // Vencimiento REAL: en las pruebas se recalcula desde el inicio (ver
      // effectiveVencimiento) en vez de confiar en el campo guardado.
      const vencValor = effectiveVencimiento(sub)
      const venc = toDate(vencValor)
      const docente = teacherName(teacher) || '—'
      const correo = teacher?.email || '—'
      const escuela = school?.shortName || school?.nombre || school?.claveSEP || sub.schoolName || '—'
      const asignaturasLista = subjectsByTeacher[sub.docenteId] || []
      const asignatura = asignaturasLista.join(' · ') || '—'
      const planNombre = plan?.nombre || (sub.status === 'trial' ? 'Sin plan (prueba)' : '—')
      return {
        id: sub.id,
        sub,
        docente,
        correo,
        escuela,
        asignatura,
        asignaturasLista,
        buscarDocente: normalizeName(docente),
        buscarCorreo: normalizeName(correo),
        buscarEscuela: normalizeName(escuela),
        buscarAsignatura: normalizeName(asignatura),
        alta: formatDate(altaValor),
        altaISO: alta ? isoLocal(alta) : '',
        altaMs: alta ? alta.getTime() : 0,
        plan: planNombre,
        estado: sub.status,
        estadoLabel: ESTADO_LABEL[sub.status] || sub.status || '—',
        vencimiento: formatDate(vencValor),
        vencimientoISO: venc ? isoLocal(venc) : '',
        dias: calcDaysRemaining(vencValor),
      }
    })
  }, [stats, teachersMap, plansMap, subjectsByTeacher])

  // Orden fijo: la suscripción más reciente hasta arriba; dentro del mismo día
  // desempata el nombre del docente.
  const filtered = useMemo(
    () =>
      rows
        .filter((r) => pasaFiltros(r, filtros, search, null))
        .sort((a, b) => b.altaMs - a.altaMs || a.docente.localeCompare(b.docente, 'es')),
    [rows, filtros, search]
  )

  // Sugerencias por columna: los valores que TODAVÍA cumplen con lo demás que
  // ya está filtrado, no el catálogo completo.
  const sugerencias = useMemo(() => {
    const res = {}
    ;[...CAMPOS_TEXTO, ...CAMPOS_LISTA].forEach((campo) => {
      const set = new Set()
      rows.forEach((r) => {
        if (!pasaFiltros(r, filtros, search, campo)) return
        set.add(campo === 'estado' ? r.estadoLabel : r[campo])
      })
      res[campo] = [...set].filter((v) => v && v !== '—').sort((a, b) => a.localeCompare(b, 'es'))
    })
    return res
  }, [rows, filtros, search])

  const visible = filtered.slice(0, limit)
  const hayFiltro = search.trim() !== '' || CAMPOS_FILTRO.some((k) => filtros[k])

  function setFiltro(campo, valor) {
    setFiltros((f) => ({ ...f, [campo]: valor }))
    setLimit(PAGE)
  }

  function limpiarTodo() {
    setFiltros(SIN_FILTROS)
    setSearch('')
    setLimit(PAGE)
  }

  function openCreate() {
    setModal({
      mode: 'create',
      form: {
        docenteId: teachers[0]?.id || '',
        planId: plans[0]?.id || '',
        status: 'activa',
        fechaInicio: new Date().toISOString().slice(0, 10),
        fechaVencimiento: '',
      },
    })
  }

  function openEdit(sub) {
    const fi = sub.fechaInicio?.toDate?.()
    const fv = sub.fechaVencimiento?.toDate?.()
    setModal({
      mode: 'edit',
      id: sub.id,
      form: {
        docenteId: sub.docenteId,
        planId: sub.planId || '',
        status: sub.status,
        fechaInicio: fi ? fi.toISOString().slice(0, 10) : '',
        fechaVencimiento: fv ? fv.toISOString().slice(0, 10) : '',
      },
    })
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const teacher = teachersMap[modal.form.docenteId]
      const school = stats.schoolsMap[teacher?.escuelaId]
      const data = {
        docenteId: modal.form.docenteId,
        planId: modal.form.planId,
        escuelaId: teacher?.escuelaId || '',
        schoolName: school?.nombre || teacher?.schoolName || '',
        status: modal.form.status,
        updatedAt: serverTimestamp(),
      }
      const toTimestamp = (val) => {
        if (!val) return null
        const d = new Date(val)
        return Number.isNaN(d.getTime()) ? null : Timestamp.fromDate(d)
      }
      const tsInicio = toTimestamp(modal.form.fechaInicio)
      const tsVencimiento = toTimestamp(modal.form.fechaVencimiento)
      if (tsInicio) data.fechaInicio = tsInicio
      if (tsVencimiento) data.fechaVencimiento = tsVencimiento

      if (modal.mode === 'create') {
        await addDoc(collection(db, 'subscriptions'), { ...data, createdAt: serverTimestamp() })
        toast('Suscripción creada')
      } else {
        await updateDoc(doc(db, 'subscriptions', modal.id), data)
        toast('Suscripción actualizada')
      }
      setModal(null)
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleCancel(sub) {
    if (!confirm('¿Cancelar esta suscripción?')) return
    try {
      await updateDoc(doc(db, 'subscriptions', sub.id), {
        status: 'cancelada',
        updatedAt: serverTimestamp(),
      })
      toast('Suscripción cancelada')
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function handleDelete(sub) {
    if (!confirm('¿Eliminar esta suscripción? No se puede deshacer.')) return
    try {
      await deleteDoc(doc(db, 'subscriptions', sub.id))
      toast('Suscripción eliminada')
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  if (!stats) return null

  return (
    <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-outline-variant flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-on-surface">Suscripciones</h2>
          <p className="text-sm mt-0.5">
            {hayFiltro ? (
              <>
                <span className="font-bold text-accent">{filtered.length}</span>
                <span className="text-muted"> de {rows.length} registros</span>
              </>
            ) : (
              <span className="text-muted">{rows.length} registros</span>
            )}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            Una suscripción por docente. <strong>Plan</strong> es qué contrató; <strong>Estado</strong>, cómo está hoy.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 w-full sm:w-80">
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setLimit(PAGE) }}
            placeholder="Buscar por docente o correo…"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={limpiarTodo}
              disabled={!hayFiltro}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-accent text-accent hover:bg-[var(--accent-tint)]"
            >
              <X size={15} /> Quitar todos los filtros
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-hover"
            >
              <Plus size={16} /> Nueva
            </button>
          </div>
        </div>
      </div>

      {/* Scroll propio, vertical y horizontal, con los encabezados fijos. */}
      <div ref={containerRef} className="overflow-auto" style={{ maxHeight: ALTO_TABLA }}>
        {/* table-fixed + <colgroup> es lo que hace que los anchos arrastrados
            se respeten; sin ellos el navegador reparte el espacio a su gusto. */}
        <table className="text-sm table-fixed" style={{ width: total }}>
          <colgroup>
            {COLS.map((c) => (
              <col key={c.key} style={{ width: widths[c.key] }} />
            ))}
          </colgroup>
          <thead>
            <tr className="text-left text-xs uppercase">
              {COLS.map((col) => {
                const { key, label, filtro, align, ayuda, wrap } = col
                const filtrada = filtro && filtros[key] !== ''
                return (
                  <th
                    key={key}
                    className={`sticky top-0 z-10 relative px-3 py-2 align-top select-none transition-colors ${
                      filtrada ? 'bg-accent-light text-accent' : 'bg-surface text-muted'
                    }`}
                  >
                    <span
                      title={ayuda}
                      className={`block ${wrap ? 'whitespace-normal leading-tight' : 'truncate'} ${align === 'right' ? 'text-right' : ''} ${ayuda ? 'cursor-help underline decoration-dotted underline-offset-2' : ''}`}
                    >
                      {label}
                    </span>

                    {filtro && (
                      <CeldaFiltro
                        col={col}
                        valor={filtros[key]}
                        onChange={(v) => setFiltro(key, v)}
                        sugerencias={sugerencias[key] || []}
                      />
                    )}

                    {/* Tirador de ancho: lo que gana esta columna lo cede la de
                        su derecha, así el total nunca se pasa del área. */}
                    {esRedimensionable(key) && (
                      <span
                        onPointerDown={(e) => startResize(e, key)}
                        onDoubleClick={() => resetColumn(key)}
                        title="Arrastra para cambiar el ancho (doble clic para restablecer)"
                        className="absolute top-0 right-0 h-full w-2 cursor-col-resize flex justify-center group"
                      >
                        <span
                          className={`h-full transition-colors ${
                            dragKey === key
                              ? 'w-[2px] bg-accent'
                              : 'w-px bg-outline-variant group-hover:bg-accent'
                          }`}
                        />
                      </span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-8 text-center text-slate-400">
                  {rows.length === 0
                    ? 'Sin suscripciones'
                    : 'Ninguna suscripción cumple con lo que se está filtrando'}
                </td>
              </tr>
            ) : (
              visible.map((r, i) => (
                <tr key={r.id} className="hover:bg-[var(--accent-tint)]">
                  {/* Cuenta de lo que se está viendo, de mayor a menor: arriba
                      el total de las que cumplen y abajo el 1. */}
                  <td className="px-3 py-2 text-right text-slate-400 tabular-nums">
                    {filtered.length - i}
                  </td>
                  <td className="px-3 py-2 font-medium text-on-surface truncate" title={r.docente}>{r.docente}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.correo}>{r.correo}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.escuela}>{r.escuela}</td>
                  <td
                    className="px-3 py-2 text-muted truncate"
                    title={r.asignaturasLista.length ? r.asignaturasLista.join('\n') : undefined}
                  >
                    {r.asignatura}
                  </td>
                  <td className="px-3 py-2 text-muted truncate">{r.alta}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.plan}>{r.plan}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.estado} /></td>
                  <td className="px-3 py-2 text-muted truncate">{r.vencimiento}</td>
                  {/* Los días ya vencidos van en rojo: es lo que se busca al
                      barrer la tabla con la vista. */}
                  <td className={`px-3 py-2 text-right tabular-nums ${r.dias !== null && r.dias <= 0 ? 'text-red-600 font-semibold' : 'text-muted'}`}>
                    {r.dias !== null ? r.dias : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(r.sub)}
                        className="p-1.5 text-slate-400 hover:text-accent rounded"
                        data-tooltip="Editar"
                        aria-label="Editar"
                      >
                        <Pencil size={16} />
                      </button>
                      {r.estado !== 'cancelada' && (
                        <button
                          type="button"
                          onClick={() => handleCancel(r.sub)}
                          className="p-1.5 text-slate-400 hover:text-amber-600 rounded"
                          data-tooltip="Cancelar"
                          aria-label="Cancelar"
                        >
                          <Ban size={16} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(r.sub)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded"
                        data-tooltip="Eliminar"
                        aria-label="Eliminar"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-2.5 border-t border-outline-variant flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={resetWidths}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
        >
          <RotateCcw size={13} /> Restablecer ancho de columnas
        </button>
        {filtered.length > visible.length && (
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted">Mostrando {visible.length} de {filtered.length}</p>
            <button
              type="button"
              onClick={() => setLimit((l) => l + PAGE)}
              className="px-3 py-1.5 text-sm font-semibold text-accent border border-accent rounded hover:bg-[var(--accent-tint)] transition-colors"
            >
              Mostrar {Math.min(PAGE, filtered.length - visible.length)} más
            </button>
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
          <div className="bg-surface-card rounded-card p-5 w-[calc(100%-2rem)] max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-on-surface">
                {modal.mode === 'create' ? 'Nueva suscripción' : 'Editar suscripción'}
              </h3>
              <button type="button" onClick={() => setModal(null)} aria-label="Cerrar">
                <X size={20} className="text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label htmlFor="sub-docente" className="block text-xs font-medium text-muted mb-1">Docente</label>
                <select
                  id="sub-docente"
                  value={modal.form.docenteId}
                  onChange={(e) =>
                    setModal({ ...modal, form: { ...modal.form, docenteId: e.target.value } })
                  }
                  required
                  className={inputCls}
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.username || t.email} — {t.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sub-plan" className="block text-xs font-medium text-muted mb-1">
                  Plan <span className="font-normal">— qué contrató</span>
                </label>
                <select
                  id="sub-plan"
                  value={modal.form.planId}
                  onChange={(e) =>
                    setModal({ ...modal, form: { ...modal.form, planId: e.target.value } })
                  }
                  className={inputCls}
                >
                  <option value="">— Sin plan (prueba) —</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sub-status" className="block text-xs font-medium text-muted mb-1">
                  Estado <span className="font-normal">— cómo está hoy</span>
                </label>
                <select
                  id="sub-status"
                  value={modal.form.status}
                  onChange={(e) =>
                    setModal({ ...modal, form: { ...modal.form, status: e.target.value } })
                  }
                  className={inputCls}
                >
                  {SUBSCRIPTION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {ESTADO_LABEL[s] || s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <span className="block text-xs font-medium text-muted mb-1">Inicio</span>
                  <EFDateTimePicker
                    mode="date"
                    value={modal.form.fechaInicio}
                    onChange={v => setModal({ ...modal, form: { ...modal.form, fechaInicio: v } })}
                  />
                </div>
                <div>
                  <span className="block text-xs font-medium text-muted mb-1">Vencimiento</span>
                  <EFDateTimePicker
                    mode="date"
                    value={modal.form.fechaVencimiento}
                    onChange={v => setModal({ ...modal, form: { ...modal.form, fechaVencimiento: v } })}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2 bg-accent text-white font-semibold rounded text-sm disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size="sm" /> : null}
                Guardar
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
