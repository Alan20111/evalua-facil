import { useState, useMemo, useEffect } from 'react'
import {
  collection,
  doc,
  deleteDoc,
  getDocs,
} from 'firebase/firestore'
import { Trash2, X, RotateCcw, Zap } from 'lucide-react'
import { httpsCallable } from 'firebase/functions'
import SearchInput from '../../../components/SearchInput'
import { db, functions } from '../../../firebase'
import { useAuth } from '../../../context/AuthContext'
import { apiUrl } from '../../../utils/apiBase'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import { useBackHandler } from '../../../hooks/useBackHandler'
import { useScrollLock } from '../../../hooks/useScrollLock'
import { useColumnWidths } from '../../../hooks/useColumnWidths'
import { normalizeName } from '../../../utils/schoolSelection'
import { capitalizarNombre } from '../../../utils/nombres'
import {
  calcDaysRemaining,
  effectiveVencimiento,
  formatCurrency,
  formatDate,
  toDate,
} from '../../../utils/creditosHelpers'

const inputCls =
  'w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface'

// Cuántas filas se pintan de golpe, igual que en el padrón de Estudiantes.
const PAGE = 100

// La tabla no estira la página: se queda de este alto y su interior se
// desplaza con los encabezados fijos arriba.
const ALTO_TABLA = 'calc(100vh - 290px)'

const WIDTHS_KEY = 'admin-suscripciones-cols-v4'

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
    ayuda: 'Entidad del docente (no la situación de la suscripción, que es la columna Plan). Si el docente no capturó su código postal, se toma la de su escuela.',
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
    key: 'creditos',
    label: 'Créditos',
    w: 110,
    align: 'right',
    ayuda: 'Saldo actual de créditos de IA del docente (leído de iaCreditos en tiempo de carga). Un guion indica que el docente aún no tiene registro de créditos.',
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
    key: 'sinAcceder',
    label: 'Días sin accesar',
    w: 120,
    align: 'right',
    wrap: true,
    ayuda: 'Cuántos días lleva el docente sin iniciar sesión (lo que Firebase Auth registra como su último acceso, no una fecha que guardemos nosotros). En ámbar a partir de 30 días y en rojo a partir de 60. Guion: nunca ha entrado, o su cuenta ya no existe.',
  },
  {
    key: 'ultimoPago',
    label: 'Último pago',
    w: 165,
    ayuda: 'Monto y fecha del pago más reciente de ese docente. Venía de la pestaña Usuarios, que se retiró.',
  },
  { key: 'acciones', label: 'Acciones', w: 120 },
]

const CAMPOS_TEXTO = ['codigoPostal', 'estado', 'ciudad', 'escuela']
const CAMPOS_FILTRO = COLS.filter((c) => c.filtro).map((c) => c.key)
const SIN_FILTROS = Object.fromEntries(CAMPOS_FILTRO.map((k) => [k, '']))

// Días completos transcurridos desde el último acceso. `null` cuando no hay
// dato (nunca entró, o la cuenta ya no existe en Auth).
function diasSinAccesar(fechaISO) {
  if (!fechaISO) return null
  const d = new Date(fechaISO)
  if (Number.isNaN(d.getTime())) return null
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)))
}

const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// El docente se muestra por su nombre real; si todavía no completó su perfil
// queda el usuario o el correo, que es lo único que hay.
function teacherName(teacher) {
  // El username va sin capitalizar: es identificador (CBTIS255-01), no nombre.
  return capitalizarNombre(teacher?.nombreMostrar || teacher?.nombre) || teacher?.username || ''
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
  // font-normal explícito: Tailwind le pone `font-weight: inherit` a los
  // controles de formulario, y aquí el contenedor es un <th>, que el navegador
  // pinta en negritas. Sin esto el "Todos" de los desplegables y el
  // "dd/mm/aaaa" de las fechas salían en 700 — más gruesos incluso que el
  // título de su columna. Que un filtro esté puesto ya se ve por el borde y el
  // color guinda; no hacía falta engrosarlo además.
  const base = `w-full text-xs normal-case font-normal rounded border px-1.5 py-1 pr-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    activo
      ? 'border-accent bg-surface-card text-accent'
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
  const { currentUser } = useAuth()
  const [ajusteModal, setAjusteModal] = useState(null)
  const [search, setSearch] = useState('')
  const [filtros, setFiltros] = useState(SIN_FILTROS)
  const [limit, setLimit] = useState(PAGE)
  const { containerRef, widths, total, dragKey, startResize, resetWidths, resetColumn, esRedimensionable } =
    useColumnWidths(WIDTHS_KEY, COLS)

  useBackHandler(() => setAjusteModal(null), !!ajusteModal)
  useScrollLock(!!ajusteModal)

  // Memoizados aunque parezcan triviales: el `|| []` crea un arreglo nuevo en
  // cada render y eso invalidaría los useMemo que dependen de ellos.
  // Último acceso de cada docente (Firebase Auth) — se pide una vez por carga
  // del panel a api/admin/last-access, porque solo el Admin SDK puede leer la
  // metadata de OTRO usuario. Si falla, la columna se queda en guion: es un
  // dato de apoyo, no debe tumbar la tabla.
  const [accesos, setAccesos] = useState({})
  const [creditosMap, setCreditosMap] = useState({})
  const teachers = useMemo(() => stats?.teachers || [], [stats?.teachers])
  const teachersMap = useMemo(() => Object.fromEntries(teachers.map((t) => [t.id, t])), [teachers])

  // Se pide con los uid que ya están en pantalla; el endpoint responde un mapa
  // { uid: fecha ISO del último acceso }.
  useEffect(() => {
    if (!currentUser || teachers.length === 0) return undefined
    let cancelado = false
    currentUser.getIdToken()
      .then((token) => fetch(apiUrl('/api/admin/last-access'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ uids: teachers.map((t) => t.id) }),
      }))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelado && data?.accesos) setAccesos(data.accesos) })
      .catch(() => {})
    return () => { cancelado = true }
  }, [currentUser, teachers])

  // Saldo de créditos IA por docente — se carga una vez por sesión del panel.
  useEffect(() => {
    if (!teachers.length) return
    getDocs(collection(db, 'iaCreditos'))
      .then((snap) => {
        const m = {}
        snap.forEach((d) => { m[d.id] = d.data().saldo ?? 0 })
        setCreditosMap(m)
      })
      .catch(() => {})
  }, [teachers])

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
      const altaTexto = sub ? formatDate(altaValor) : '—'
      const vencTexto = sub ? formatDate(vencValor) : '—'
      return {
        // Bug real (19-ago-2026): las bajas arman un `sub` de constancia SIN
        // `.id` (no hay documento de suscripción que borrar — nunca existió
        // o ya se borró junto con la cuenta), así que `sub.id` daba
        // `undefined` para TODAS las bajas — la key de React quedaba
        // repetida (`undefined`) en cada una, y por eso se veían como filas
        // "duplicadas" que no se distinguían entre sí.
        id: sub ? (sub.id ?? `baja-${teacher?.id}`) : `sin-suscripcion-${teacher?.id}`,
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
            altaTexto, vencTexto, ultimoPago].join(' ')
        ),
        alta: altaTexto,
        altaISO: alta ? isoLocal(alta) : '',
        altaMs: alta ? alta.getTime() : 0,
        vencimiento: vencTexto,
        vencimientoISO: venc ? isoLocal(venc) : '',
        dias: sub ? calcDaysRemaining(vencValor) : null,
        // Días completos desde el último inicio de sesión. null = nunca ha
        // entrado o su cuenta ya no está en Auth (una baja, por ejemplo).
        sinAcceder: diasSinAccesar(accesos[teacher?.id]),
        uid: teacher?.id || null,
      }
    }

    const conSuscripcion = subscriptions.map((sub) => construir(sub, teachersMap[sub.docenteId]))
    const conSub = new Set(subscriptions.map((s) => s.docenteId))
    const sinSuscripcion = teachers.filter((t) => !conSub.has(t.id)).map((t) => construir(null, t))
    // Cuentas dadas de baja: su docente ya no existe, así que se arma el
    // renglón con la constancia. Van al final por su fecha de baja.
    const bajas = (stats.bajas || []).map((b) =>
      construir(
        // `docenteId` (19-ago-2026): hace falta para poder borrar la
        // CONSTANCIA (`bajas/{docenteId}`) — sin esto `handleDeleteBaja` no
        // tenía de dónde sacar el id del documento a borrar.
        { cuentaEliminada: true, fechaInicio: b.fechaBaja, status: 'eliminada', docenteId: b.docenteId },
        { id: b.docenteId, nombre: b.nombre, email: b.email }
      )
    )
    return [...conSuscripcion, ...sinSuscripcion, ...bajas]
  }, [stats, teachers, teachersMap, accesos])

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
    CAMPOS_TEXTO.forEach((campo) => {
      const set = new Set()
      rows.forEach((r) => {
        if (!pasaFiltros(r, filtros, search, campo)) return
        set.add(r[campo])
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

  // Borra la CONSTANCIA de una cuenta eliminada (colección `bajas`, doc id =
  // uid del docente — ver api/account/delete.js) — un documento totalmente
  // distinto al de `handleDelete` (que borra `subscriptions`). Corrección
  // 19-ago-2026: antes el botón de esta fila intentaba borrar de
  // `subscriptions` con un `sub.id` que nunca existió ahí (truena en el SDK
  // de Firestore) — por eso la fila no desaparecía sin importar cuántas
  // veces se intentara. `firestore.rules` necesita `allow delete: if
  // isAdmin()` en `match /bajas/{docenteId}` para que esto funcione — antes
  // solo tenía `allow read`.
  async function handleDeleteBaja(docenteId) {
    if (!confirm('¿Eliminar esta constancia de cuenta eliminada? No se puede deshacer.')) return
    try {
      await deleteDoc(doc(db, 'bajas', docenteId))
      toast('Constancia eliminada')
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  function openAjuste(sub, docente) {
    setAjusteModal({ docenteId: sub.docenteId, subId: sub.id, docente, cantidad: '', motivo: '', saving: false })
  }

  async function handleAjusteSubmit(e) {
    e.preventDefault()
    const delta = parseInt(ajusteModal.cantidad, 10)
    if (!Number.isFinite(delta) || delta === 0) {
      toast('Ingresa un número distinto de cero', 'error')
      return
    }
    setAjusteModal((m) => ({ ...m, saving: true }))
    try {
      const ajustar = httpsCallable(functions, 'ajustarSaldoCreditosIA')
      const { data } = await ajustar({ docenteId: ajusteModal.docenteId, delta, motivo: ajusteModal.motivo || null })
      toast(`Saldo ajustado: ${data.saldo} créditos`)
      setAjusteModal(null)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      setAjusteModal((m) => ({ ...m, saving: false }))
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
            Una suscripción por docente. <strong>Créditos</strong> es el saldo actual de IA.
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
                  <td className="px-3 py-2 text-right tabular-nums text-on-surface">
                    {r.uid && !r.sub?.cuentaEliminada && creditosMap[r.uid] !== undefined
                      ? creditosMap[r.uid].toLocaleString('es-MX')
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-muted truncate">{r.vencimiento}</td>
                  {/* Los días ya vencidos van en rojo: es lo que se busca al
                      barrer la tabla con la vista. */}
                  <td className={`px-3 py-2 text-right tabular-nums ${r.dias !== null && r.dias < 0 ? 'text-red-600 font-semibold' : 'text-muted'}`}>
                    {r.dias !== null ? r.dias : '—'}
                  </td>
                  {/* Mismo criterio de lectura rápida que la columna Días:
                      lo que hay que cazar de un vistazo va en color. A los 60
                      días es cuando el docente-dueño decide si elimina la
                      cuenta o intenta traer de vuelta a esa persona. */}
                  <td className={`px-3 py-2 text-right tabular-nums ${
                    r.sinAcceder === null ? 'text-slate-400'
                      : r.sinAcceder >= 60 ? 'text-red-600 font-semibold'
                      : r.sinAcceder >= 30 ? 'text-amber-600 font-semibold'
                      : 'text-muted'
                  }`}>
                    {r.sinAcceder === null ? '—' : r.sinAcceder}
                  </td>
                  <td className="px-3 py-2 text-muted truncate" title={r.ultimoPago}>{r.ultimoPago}</td>
                  <td className="px-3 py-2">
                    {!r.sub ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : r.sub.cuentaEliminada ? (
                      <button
                        type="button"
                        onClick={() => handleDeleteBaja(r.sub.docenteId)}
                        className="p-2 text-slate-400 hover:text-red-600 rounded"
                        data-tooltip="Eliminar constancia"
                        aria-label="Eliminar constancia"
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openAjuste(r.sub, r.docente)}
                        disabled={ajusteModal?.subId === r.sub.id && ajusteModal?.saving}
                        className="p-1.5 text-slate-400 hover:text-accent rounded disabled:opacity-40"
                        data-tooltip="Ajustar créditos de IA"
                        aria-label="Ajustar créditos de IA"
                      >
                        <Zap size={16} />
                      </button>
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

      {ajusteModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
          <div className="bg-surface-card rounded-card p-5 w-[calc(100%-2rem)] max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-on-surface">Ajustar créditos de IA</h3>
              <button type="button" onClick={() => setAjusteModal(null)} aria-label="Cerrar">
                <X size={20} className="text-slate-400" />
              </button>
            </div>
            <p className="text-sm text-muted mb-4 truncate" title={ajusteModal.docente}>
              Docente: <strong className="text-on-surface">{ajusteModal.docente}</strong>
            </p>
            <form onSubmit={handleAjusteSubmit} className="space-y-4">
              <div>
                <label htmlFor="ajuste-cantidad" className="block text-xs font-medium text-muted mb-1">
                  Cantidad de créditos
                </label>
                <input
                  id="ajuste-cantidad"
                  type="number"
                  value={ajusteModal.cantidad}
                  onChange={(e) => setAjusteModal((m) => ({ ...m, cantidad: e.target.value }))}
                  required
                  placeholder="Ej. 50 para agregar, -20 para descontar"
                  className={inputCls}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Número <strong>positivo</strong> para agregar créditos. Número <strong>negativo</strong> para descontarlos.
                </p>
              </div>
              <div>
                <label htmlFor="ajuste-motivo" className="block text-xs font-medium text-muted mb-1">
                  Motivo <span className="text-red-500">*</span>
                </label>
                <input
                  id="ajuste-motivo"
                  type="text"
                  value={ajusteModal.motivo}
                  onChange={(e) => setAjusteModal((m) => ({ ...m, motivo: e.target.value }))}
                  required
                  placeholder="Ej. Cuenta de prueba, bonificación por falla…"
                  className={inputCls}
                />
              </div>
              <button
                type="submit"
                disabled={ajusteModal.saving || !ajusteModal.cantidad || !ajusteModal.motivo.trim()}
                className="w-full py-2 bg-accent text-white font-semibold rounded text-sm disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {ajusteModal.saving ? <Spinner size="sm" /> : null}
                Aplicar ajuste
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
