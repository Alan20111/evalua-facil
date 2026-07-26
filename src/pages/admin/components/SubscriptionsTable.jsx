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
import { situacionDe, SITUACIONES } from '../../../utils/situacionSuscripcion'
import {
  calcDaysRemaining,
  effectiveVencimiento,
  formatCurrency,
  formatDate,
  toDate,
} from '../../../utils/subscriptionHelpers'

const inputCls =
  'w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface'

// Cuántas filas se pintan de golpe, igual que en el padrón de Estudiantes.
const PAGE = 100

// La tabla no estira la página: se queda de este alto y su interior se
// desplaza con los encabezados fijos arriba.
const ALTO_TABLA = 'calc(100vh - 290px)'

const WIDTHS_KEY = 'admin-suscripciones-cols-v3'

// Columnas. `filtro` = tipo de caja bajo el título:
//   'texto' → se escribe y filtra, con sugerencias de los valores que todavía
//             cumplen (sirve con cientos de escuelas)
//   'fecha' → selector de día
//   'lista' → desplegable con los valores posibles (pocos y fijos)
// Orden fijo: del alta más nueva a la más antigua, igual que Estudiantes.
const COLS = [
  { key: 'num', label: 'Resultado del filtro', w: 145, align: 'right', wrap: true },
  { key: 'docente', label: 'Nombre del docente', w: 185 },
  { key: 'usuario', label: 'Usuario', w: 130 },
  { key: 'correo', label: 'Correo electrónico', w: 200 },
  // Ubicación del DOCENTE (no de la escuela): se resuelve desde su código
  // postal al completar el perfil y se guarda ya desglosada en users/{uid}
  // — ver Onboarding.jsx, "para poder agrupar por zona".
  {
    key: 'codigoPostal',
    label: 'Código postal',
    filtro: 'texto',
    w: 125,
    ayuda: 'Se captura en el perfil del docente. Queda en guion mientras no lo complete: el catálogo de planteles no incluye código postal, así que no hay de dónde deducirlo.',
  },
  {
    key: 'estado',
    label: 'Estado',
    filtro: 'texto',
    w: 150,
    ayuda: 'Entidad del docente (no la situación de la suscripción, que es la columna Situación). Si el docente no capturó su código postal, se toma la de su escuela.',
  },
  {
    key: 'ciudad',
    label: 'Ciudad',
    filtro: 'texto',
    w: 150,
    ayuda: 'Ciudad del docente; si no capturó su código postal, se toma el municipio de su escuela.',
  },
  { key: 'escuela', label: 'Escuela', filtro: 'texto', w: 150 },
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
    // Antes se llamaba "Estado", que ahora es la entidad federativa del
    // docente. Esta columna es el estatus de la suscripción, de ahí el
    // cambio a "Situación": dos columnas "Estado" no se podían distinguir.
    key: 'situacion',
    label: 'Situación',
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
  {
    key: 'ultimoPago',
    label: 'Último pago',
    w: 165,
    ayuda: 'Monto y fecha del pago más reciente de ese docente. Venía de la pestaña Usuarios, que se retiró.',
  },
  { key: 'acciones', label: 'Acciones', w: 120 },
]

const CAMPOS_TEXTO = ['codigoPostal', 'estado', 'ciudad', 'escuela']
const CAMPOS_LISTA = ['plan', 'situacion']
const CAMPOS_FILTRO = COLS.filter((c) => c.filtro).map((c) => c.key)
const SIN_FILTROS = Object.fromEntries(CAMPOS_FILTRO.map((k) => [k, '']))

const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// El docente se muestra por su nombre real; si todavía no completó su perfil
// queda el usuario o el correo, que es lo único que hay.
function teacherName(teacher) {
  return teacher?.nombreMostrar || teacher?.nombre || teacher?.username || ''
}

// Etiqueta del docente en la lista desplegable. Se arma con las partes que
// EXISTEN y sin repetir ninguna: antes era `{username || email} — {email}`, así
// que a quien no tiene usuario le salía el correo dos veces.
function etiquetaDocente(t) {
  const partes = []
  const nombre = t?.nombreMostrar || t?.nombre || ''
  if (nombre) partes.push(nombre)
  if (t?.username && t.username !== nombre) partes.push(t.username)
  if (t?.email && !partes.includes(t.email)) partes.push(t.email)
  return partes.join(' — ') || '(docente sin datos)'
}

// "Cortesía" no es un documento de `plans`: es un plan sin cobro que el
// administrador otorga por un número de días. Se guarda como este valor
// literal en `planId`, junto con `cortesiaDias`.
const PLAN_CORTESIA = 'cortesia'

// Fecha en que termina una cortesía. Los días se cuentan desde el inicio, o
// desde el vencimiento vigente cuando se pide extender — así extender no
// regala de más ni recorta lo que al docente le quedaba.
// El mediodía evita que "2026-07-25" se corra un día por zona horaria.
function calcFinCortesia(form, vencimientoActual) {
  if (form.cortesiaIndefinida) return null   // sin fecha de fin
  const dias = parseInt(form.cortesiaDias, 10)
  if (!Number.isFinite(dias) || dias <= 0) return null
  const base = form.extender && vencimientoActual
    ? new Date(vencimientoActual)
    : (form.fechaInicio ? new Date(`${form.fechaInicio}T12:00:00`) : null)
  if (!base || Number.isNaN(base.getTime())) return null
  const fin = new Date(base)
  fin.setDate(fin.getDate() + dias)
  return fin
}

// La situación NO la elige el administrador: es consecuencia. Prueba la
// determina el registro del docente, Activa el tener plan o cortesía, y
// Vencida el calendario. Lo único que sí es decisión suya es CANCELAR.
function situacionCalculada(form, statusPrevio) {
  if (form.cancelada) return 'cancelada'
  if (form.planId) return 'activa'
  // Sin plan conserva lo que ya traía (prueba / pendiente de pago / vencida);
  // si venía cancelada y se descancela, vuelve a ser una prueba.
  return statusPrevio && statusPrevio !== 'cancelada' ? statusPrevio : 'trial'
}

// Cómo quedaría la suscripción con lo que hay escrito ahora en el formulario,
// para pintar la insignia de vista previa con la misma regla que la tabla.
function previsualizarSuscripcion(modal) {
  const status = situacionCalculada(modal.form, modal.statusPrevio)
  const fin = calcFinCortesia(modal.form, modal.vencimientoActual)
  return {
    status,
    planId: modal.form.planId,
    cortesiaIndefinida: modal.form.cortesiaIndefinida === true,
    fechaVencimiento: modal.form.planId === PLAN_CORTESIA
      ? fin
      : (modal.form.fechaVencimiento ? new Date(`${modal.form.fechaVencimiento}T12:00:00`) : null),
    fechaInicio: modal.form.fechaInicio ? new Date(`${modal.form.fechaInicio}T12:00:00`) : null,
  }
}

function vencimientoCortesia(modal) {
  if (modal.form.cortesiaIndefinida) return 'sin fecha de fin'
  const fin = calcFinCortesia(modal.form, modal.vencimientoActual)
  return fin ? formatDate(fin) : null
}

// Etiqueta de estado, no botón. Lo que la hacía competir con el contenido de
// las celdas era la NEGRITA, no el tamaño: a 12 px de peso normal se lee bien
// sin gritar. El relleno acompaña al tamaño para que la píldora no quede
// apretada.
function StatusBadge({ situacion }) {
  return (
    <span
      style={situacion.estilo}
      className="inline-block text-[12px] font-normal leading-tight px-2 py-[3px] rounded-full whitespace-nowrap"
    >
      {situacion.etiqueta}
    </span>
  )
}

// ¿Esta fila pasa los filtros? `excepto` deja fuera un campo a propósito, para
// calcular qué sugerir en ESA columna sin que su propio texto a medio escribir
// recorte la lista.
function pasaFiltros(r, filtros, search, excepto) {
  const t = (k) => (k === excepto ? '' : normalizeName(filtros[k]))
  if (t('codigoPostal') && !r.buscarCodigoPostal.includes(t('codigoPostal'))) return false
  if (t('estado') && !r.buscarEstado.includes(t('estado'))) return false
  if (t('ciudad') && !r.buscarCiudad.includes(t('ciudad'))) return false
  if (t('escuela') && !r.buscarEscuela.includes(t('escuela'))) return false
  if (excepto !== 'alta' && filtros.alta && r.altaISO !== filtros.alta) return false
  if (excepto !== 'vencimiento' && filtros.vencimiento && r.vencimientoISO !== filtros.vencimiento) return false
  if (excepto !== 'plan' && filtros.plan && r.plan !== filtros.plan) return false
  if (excepto !== 'situacion' && filtros.situacion && r.situacionLabel !== filtros.situacion) return false
  // La caja de arriba busca en TODO el renglón (docente, usuario, correo,
  // ciudad, escuela, plan, situación, fechas…), no solo en el nombre:
  // quien escribe "guanajuato" o "vencida" ahí espera encontrarlo.
  const q = normalizeName(search)
  if (q && !r.buscarTodo.includes(q)) return false
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

  // Cada suscripción se "aplana" una sola vez a las columnas visibles: así el
  // filtro trabaja sobre texto ya resuelto en vez de volver a cruzar docente,
  // escuela y ubicación en cada tecla.
  const rows = useMemo(() => {
    if (!stats) return []
    const { subscriptions = [], schoolsMap = {}, payments = [] } = stats

    // Último pago por docente. Lo aportaba la pestaña Usuarios, que se retiró
    // por redundante: 4 de sus 6 columnas ya estaban aquí.
    const ultimoPagoPorDocente = {}
    payments.forEach((p) => {
      const prev = ultimoPagoPorDocente[p.docenteId]
      if (!prev || (p.createdAt?.toMillis?.() || 0) > (prev.createdAt?.toMillis?.() || 0)) {
        ultimoPagoPorDocente[p.docenteId] = p
      }
    })

    // `sub` puede venir null: son los docentes que no tienen ninguna
    // suscripción. Antes solo se veían en Usuarios y al quitar esa pestaña
    // habrían desaparecido del panel, que es justo lo que no debe pasar.
    const construir = (sub, teacher) => {
      const school = schoolsMap[teacher?.escuelaId]
      const plan = sub ? plansMap[sub.planId] : null
      // El alta de la suscripción es su fecha de inicio; los documentos que no
      // la traen caen a cuándo se creó el registro.
      const altaValor = sub ? (sub.fechaInicio || sub.createdAt) : null
      const alta = toDate(altaValor)
      // Vencimiento REAL: en las pruebas se recalcula desde el inicio (ver
      // effectiveVencimiento) en vez de confiar en el campo guardado.
      const vencValor = sub ? effectiveVencimiento(sub) : null
      const venc = toDate(vencValor)
      const docente = teacherName(teacher) || '—'
      const usuario = teacher?.username || '—'
      const correo = teacher?.email || '—'
      const pago = ultimoPagoPorDocente[teacher?.id]
      const ultimoPago = pago
        ? `${formatCurrency(pago.monto)} — ${formatDate(pago.createdAt)}`
        : '—'
      // Ubicación del docente. Primero la suya (desglosada desde su código
      // postal al completar el perfil); si no la ha capturado, se cae a la de
      // su escuela, que el catálogo de planteles sí trae. Sin ese respaldo la
      // columna quedaría vacía para todo docente que no pasó por el perfil.
      // El CP no tiene respaldo: el catálogo de planteles no lo incluye.
      const codigoPostal = teacher?.codigoPostal || '—'
      const estadoUbicacion = teacher?.estado || school?.estado || '—'
      const ciudad = teacher?.ciudad || teacher?.municipio || school?.municipio || '—'
      const escuela = school?.shortName || school?.nombre || school?.claveSEP || sub?.schoolName || '—'
      const planNombre = !sub
        ? '—'
        : sub.planId === PLAN_CORTESIA
          ? `Cortesía${sub.cortesiaIndefinida ? ' (sin vencimiento)' : sub.cortesiaDias ? ` (${sub.cortesiaDias} días)` : ''}`
          : (plan?.nombre || (sub.status === 'trial' ? 'Sin plan (prueba)' : '—'))
      const situacion = situacionDe(sub)
      const situacionLabel = situacion.etiqueta
      const altaTexto = sub ? formatDate(altaValor) : '—'
      const vencTexto = sub ? formatDate(vencValor) : '—'
      return {
        id: sub ? sub.id : `sin-suscripcion-${teacher?.id}`,
        sub,
        docente,
        usuario,
        correo,
        codigoPostal,
        estado: estadoUbicacion,
        ciudad,
        escuela,
        ultimoPago,
        buscarCodigoPostal: normalizeName(codigoPostal),
        buscarEstado: normalizeName(estadoUbicacion),
        buscarCiudad: normalizeName(ciudad),
        buscarEscuela: normalizeName(escuela),
        // Todo el renglón en una sola cadena para la caja de búsqueda de
        // arriba, que busca por cualquier motivo (ciudad, escuela, nombre…).
        buscarTodo: normalizeName(
          [docente, usuario, correo, codigoPostal, estadoUbicacion, ciudad, escuela,
            altaTexto, planNombre, situacionLabel, vencTexto, ultimoPago].join(' ')
        ),
        alta: altaTexto,
        altaISO: alta ? isoLocal(alta) : '',
        altaMs: alta ? alta.getTime() : 0,
        plan: planNombre,
        situacion,
        situacionLabel,
        vencimiento: vencTexto,
        vencimientoISO: venc ? isoLocal(venc) : '',
        dias: sub ? calcDaysRemaining(vencValor) : null,
      }
    }

    const conSuscripcion = subscriptions.map((sub) => construir(sub, teachersMap[sub.docenteId]))
    const conSub = new Set(subscriptions.map((s) => s.docenteId))
    const sinSuscripcion = teachers.filter((t) => !conSub.has(t.id)).map((t) => construir(null, t))
    // Cuentas dadas de baja: su docente ya no existe, así que se arma el
    // renglón con la constancia. Van al final por su fecha de baja.
    const bajas = (stats.bajas || []).map((b) =>
      construir(
        { cuentaEliminada: true, fechaInicio: b.fechaBaja, status: 'eliminada' },
        { id: b.docenteId, nombre: b.nombre, email: b.email }
      )
    )
    return [...conSuscripcion, ...sinSuscripcion, ...bajas]
  }, [stats, teachers, teachersMap, plansMap])

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
        set.add(campo === 'situacion' ? r.situacionLabel : r[campo])
      })
      res[campo] = campo === 'situacion'
        // Catálogo completo y en su orden natural (de prueba a baja), no solo
        // las situaciones que hoy existen en los datos.
        ? SITUACIONES.filter((v) => set.has(v))
        : [...set].filter((v) => v && v !== '—').sort((a, b) => a.localeCompare(b, 'es'))
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
      statusPrevio: null,
      form: {
        docenteId: teachers[0]?.id || '',
        planId: plans[0]?.id || '',
        cancelada: false,
        fechaInicio: new Date().toISOString().slice(0, 10),
        fechaVencimiento: '',
        cortesiaDias: '30',
        cortesiaIndefinida: false,
        extender: false,
      },
    })
  }

  function openEdit(sub) {
    const fi = sub.fechaInicio?.toDate?.()
    const fv = sub.fechaVencimiento?.toDate?.()
    setModal({
      mode: 'edit',
      id: sub.id,
      // El vencimiento vigente se guarda aparte del formulario: es la base
      // sobre la que se extiende una cortesía, y no debe cambiar mientras el
      // administrador teclea.
      vencimientoActual: effectiveVencimiento(sub) ? toDate(effectiveVencimiento(sub)) : null,
      statusPrevio: sub.status,
      form: {
        docenteId: sub.docenteId,
        planId: sub.planId || '',
        cancelada: sub.status === 'cancelada',
        fechaInicio: fi ? fi.toISOString().slice(0, 10) : '',
        fechaVencimiento: fv ? fv.toISOString().slice(0, 10) : '',
        cortesiaDias: sub.cortesiaDias ? String(sub.cortesiaDias) : '30',
        cortesiaIndefinida: sub.cortesiaIndefinida === true,
        extender: false,
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
        status: situacionCalculada(modal.form, modal.statusPrevio),
        updatedAt: serverTimestamp(),
      }
      const toTimestamp = (val) => {
        if (!val) return null
        const d = new Date(val)
        return Number.isNaN(d.getTime()) ? null : Timestamp.fromDate(d)
      }
      const tsInicio = toTimestamp(modal.form.fechaInicio)
      if (tsInicio) data.fechaInicio = tsInicio

      if (modal.form.planId === PLAN_CORTESIA) {
        // En cortesía el vencimiento SIEMPRE sale de los días concedidos: no
        // se toma la fecha tecleada, que podría no cuadrar con esos días.
        data.cortesiaIndefinida = modal.form.cortesiaIndefinida === true
        if (data.cortesiaIndefinida) {
          // Sin fecha de fin: se borra el vencimiento para que nada lo
          // interprete como vencida (ver effectiveVencimiento).
          data.fechaVencimiento = null
          data.cortesiaDias = null
        } else {
          const fin = calcFinCortesia(modal.form, modal.vencimientoActual)
          if (!fin) {
            toast('Indica cuántos días de cortesía', 'error')
            return
          }
          data.fechaVencimiento = Timestamp.fromDate(fin)
          data.cortesiaDias = parseInt(modal.form.cortesiaDias, 10)
        }
      } else {
        const tsVencimiento = toTimestamp(modal.form.fechaVencimiento)
        if (tsVencimiento) data.fechaVencimiento = tsVencimiento
      }

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
            Una suscripción por docente. <strong>Plan</strong> es qué contrató; <strong>Situación</strong>, cómo está hoy.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 w-full sm:w-80">
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setLimit(PAGE) }}
            placeholder="Buscar por cualquier dato…"
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
            <tr className="text-left text-[11.5px] tracking-wide uppercase">
              {COLS.map((col) => {
                const { key, label, filtro, align, ayuda, wrap } = col
                const filtrada = filtro && filtros[key] !== ''
                return (
                  <th
                    key={key}
                    className={`sticky top-0 z-10 relative px-3 py-2 align-top select-none transition-colors ${
                      filtrada ? 'bg-accent-light text-accent' : 'bg-surface text-accent'
                    }`}
                  >
                    <span
                      title={ayuda}
                      className={`block font-semibold ${wrap ? 'whitespace-normal leading-tight' : 'truncate'} ${align === 'right' ? 'text-right' : ''} ${ayuda ? 'cursor-help underline decoration-dotted underline-offset-2' : ''}`}
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
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-on-surface truncate">{r.usuario}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.correo}>{r.correo}</td>
                  <td className="px-3 py-2 text-muted truncate tabular-nums">{r.codigoPostal}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.estado}>{r.estado}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.ciudad}>{r.ciudad}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.escuela}>{r.escuela}</td>
                  <td className="px-3 py-2 text-muted truncate">{r.alta}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.plan}>{r.plan}</td>
                  <td className="px-3 py-2"><StatusBadge situacion={r.situacion} /></td>
                  <td className="px-3 py-2 text-muted truncate">{r.vencimiento}</td>
                  {/* Los días ya vencidos van en rojo: es lo que se busca al
                      barrer la tabla con la vista. */}
                  <td className={`px-3 py-2 text-right tabular-nums ${r.dias !== null && r.dias <= 0 ? 'text-red-600 font-semibold' : 'text-muted'}`}>
                    {r.dias !== null ? r.dias : '—'}
                  </td>
                  <td className="px-3 py-2 text-muted truncate" title={r.ultimoPago}>{r.ultimoPago}</td>
                  {/* Sin suscripción no hay nada que editar, cancelar ni
                      eliminar: a ese docente se le crea una con "Nueva". */}
                  <td className="px-3 py-2">
                    {!r.sub ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
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
                      {r.situacion.clave !== 'cancelada' && (
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
                    )}
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
        // Es el FONDO el que se desplaza (overflow-y-auto + items-start), no la
        // tarjeta: con la tarjeta centrada y de alto limitado, en pantallas
        // bajas el final del formulario quedaba fuera de alcance. Así siempre
        // se llega al botón Guardar, por largo que sea el contenido.
        <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto flex items-start justify-center px-4 py-6">
          <div className="bg-surface-card rounded-card p-5 w-[calc(100%-2rem)] max-w-md shadow-xl my-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-on-surface">
                {modal.mode === 'create' ? 'Nueva suscripción' : 'Editar suscripción'}
              </h3>
              <button type="button" onClick={() => setModal(null)} aria-label="Cerrar">
                <X size={20} className="text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              {/* La ventana va en cuatro tramos, en el orden en que se piensa:
                  a quién, qué se le da, desde cuándo y cómo queda. */}
              {/* Al EDITAR el docente se muestra, no se elige: ya se entró
                  desde SU renglón, y poder cambiarlo aquí solo servía para
                  reasignarle la suscripción a otra persona por error. Al crear
                  sí hay que escogerlo. */}
              <div>
                <span className="block text-xs font-medium text-muted mb-1">Docente</span>
                {modal.mode === 'edit' ? (
                  <p className="px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface">
                    {etiquetaDocente(teachersMap[modal.form.docenteId])}
                  </p>
                ) : (
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
                        {etiquetaDocente(t)}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="border-t border-outline-variant pt-3 space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-accent">Qué se le otorga</p>
                <div>
                  <label htmlFor="sub-plan" className="block text-xs font-medium text-muted mb-1">Plan</label>
                  <select
                    id="sub-plan"
                    value={modal.form.planId}
                    onChange={(e) =>
                      setModal({ ...modal, form: { ...modal.form, planId: e.target.value } })
                    }
                    className={inputCls}
                  >
                    <option value="">&mdash; Sin plan (prueba) &mdash;</option>
                    <option value={PLAN_CORTESIA}>Cortesía (sin cobro)</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              {/* Cortesía: se otorga por días, no por una fecha suelta. El
                  vencimiento se calcula solo, así que no hay forma de teclear
                  una fecha que no corresponda con los días concedidos. */}
              {modal.form.planId === PLAN_CORTESIA && (
                <div className="rounded border border-accent bg-[var(--accent-tint)] p-3 space-y-2">
                  <label className="flex items-start gap-2 text-sm text-on-surface cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modal.form.cortesiaIndefinida}
                      onChange={(e) =>
                        setModal({ ...modal, form: { ...modal.form, cortesiaIndefinida: e.target.checked } })
                      }
                      className="mt-1"
                    />
                    <span>
                      Sin fecha de finalización
                      <span className="block text-xs text-slate-500">
                        No vence nunca. Para cuentas propias de prueba.
                      </span>
                    </span>
                  </label>
                  <div className={modal.form.cortesiaIndefinida ? 'hidden' : ''}>
                    <label htmlFor="sub-cortesia-dias" className="block text-xs font-medium text-muted mb-1">
                      Días de cortesía
                    </label>
                    <input
                      id="sub-cortesia-dias"
                      type="number"
                      min="1"
                      max="3650"
                      value={modal.form.cortesiaDias}
                      onChange={(e) =>
                        setModal({ ...modal, form: { ...modal.form, cortesiaDias: e.target.value } })
                      }
                      required={!modal.form.cortesiaIndefinida}
                      className={inputCls}
                    />
                  </div>
                  {/* Solo tiene sentido al editar algo que ya tiene vencimiento:
                      extender suma los días a la fecha que ya vencía, sin
                      regalar de más ni recortar lo que le quedaba. */}
                  {!modal.form.cortesiaIndefinida && modal.mode === 'edit' && modal.vencimientoActual && (
                    <label className="flex items-start gap-2 text-xs text-on-surface cursor-pointer">
                      <input
                        type="checkbox"
                        checked={modal.form.extender}
                        onChange={(e) =>
                          setModal({ ...modal, form: { ...modal.form, extender: e.target.checked } })
                        }
                        className="mt-0.5"
                      />
                      <span>
                        Extender el plazo actual (vence el {formatDate(modal.vencimientoActual)})
                        en lugar de contar desde el inicio
                      </span>
                    </label>
                  )}
                  <p className="text-xs text-accent font-semibold">
                    Nuevo vencimiento: {vencimientoCortesia(modal) || '—'}
                  </p>
                </div>
              )}
              </div>

              <div className="border-t border-outline-variant pt-3 space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-accent">Vigencia</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="block text-xs font-medium text-muted mb-1">Fecha de inicio</span>
                    <EFDateTimePicker
                      mode="date"
                      value={modal.form.fechaInicio}
                      onChange={v => setModal({ ...modal, form: { ...modal.form, fechaInicio: v } })}
                    />
                  </div>
                  {modal.form.planId !== PLAN_CORTESIA && (
                    <div>
                      <span className="block text-xs font-medium text-muted mb-1">Vencimiento</span>
                      <EFDateTimePicker
                        mode="date"
                        value={modal.form.fechaVencimiento}
                        onChange={v => setModal({ ...modal, form: { ...modal.form, fechaVencimiento: v } })}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Situación: se MUESTRA, no se elige. Antes era una lista libre y
                  permitía dejar contradicciones (marcar "Activa" algo ya vencido,
                  o "Prueba" a quien tiene plan). */}
              <div className="border-t border-outline-variant pt-3 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-accent">Situación</p>
                <div className="flex items-center gap-2">
                  <StatusBadge situacion={situacionDe(previsualizarSuscripcion(modal))} />
                  <span className="text-xs text-slate-400">se calcula sola</span>
                </div>
                <p className="text-xs text-slate-400 leading-snug">
                  Depende del docente y del calendario: Prueba al registrarse, Activa
                  cuando tiene plan o cortesía, Vencida al pasar la fecha.
                </p>
                <label className="flex items-start gap-2 text-sm text-on-surface cursor-pointer">
                  <input
                    type="checkbox"
                    checked={modal.form.cancelada}
                    onChange={(e) =>
                      setModal({ ...modal, form: { ...modal.form, cancelada: e.target.checked } })
                    }
                    className="mt-1"
                  />
                  <span>
                    Cancelar esta suscripción
                    <span className="block text-xs text-slate-400">
                      Por ejemplo, si diste una cortesía y no la están usando.
                    </span>
                  </span>
                </label>
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
