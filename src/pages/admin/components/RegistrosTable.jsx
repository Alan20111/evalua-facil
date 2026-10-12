import { useState, useMemo, useEffect } from 'react'
import {
  collection,
  doc,
  deleteDoc,
  getDocs,
} from 'firebase/firestore'
import { Trash2, X, RotateCcw, Zap, UserX, ArrowUp, ArrowDown, ArrowUpDown, AlertTriangle } from 'lucide-react'
import { httpsCallable } from 'firebase/functions'
import SearchInput from '../../../components/SearchInput'
import { db, functions } from '../../../firebase'
import { useAuth } from '../../../context/AuthContext'
import { apiUrl } from '../../../utils/apiBase'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import { SkeletonTable } from '../../../components/ui'
import { useBackHandler } from '../../../hooks/useBackHandler'
import { useScrollLock } from '../../../hooks/useScrollLock'
import { useColumnWidths } from '../../../hooks/useColumnWidths'
import { normalizeName } from '../../../utils/schoolSelection'
import { cuandoConsultaAuth, ultimaCompraPorDocente } from '../../../utils/resumenAdmin'
import {
  saldoIAVisible,
  compararNumerico,
  compararPorRegistro,
  siguienteOrden,
  construirFilasRegistros,
  estudiantesPorDocente,
  correosDuplicados,
} from '../../../utils/registrosTabla'
import {
  PAYMENT_STATUS,
  estadoRegaloIA,
  formatCreditos,
} from '../../../utils/creditosHelpers'

const inputCls =
  'w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface'

// Cuántas filas se pintan de golpe, igual que en el padrón de Estudiantes.
const PAGE = 100

// La tabla no estira la página: se queda de este alto y su interior se
// desplaza con los encabezados fijos arriba.
const ALTO_TABLA = 'calc(100vh - 290px)'

// v7: la tabla cambió de columnas (Registros); los anchos guardados con la
// versión anterior ya no corresponden y se descartan una sola vez.
const WIDTHS_KEY = 'admin-registros-cols-v7'

// Mapa vacío compartido: conserva la misma identidad entre renders (es
// dependencia de useMemo) mientras no hay datos de Auth.
const SIN_DATOS = Object.freeze({})

// Columnas. `filtro` = tipo de caja bajo el título:
//   'texto' → se escribe y filtra, con sugerencias de los valores que todavía
//             cumplen (sirve con cientos de escuelas)
//   'fecha' → selector de día
//   'lista' → desplegable con los valores posibles (pocos y fijos)
// Orden predeterminado: del registro más nuevo al más antiguo.
const COLS = [
  { key: 'num', label: 'No.', w: 65, align: 'right' },
  { key: 'docente', label: 'Nombre del docente', w: 185 },
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
    ayuda: 'Entidad del docente. Si no la capturó en su perfil, se toma la de su escuela.',
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
    key: 'estudiantes',
    label: 'Estudiantes',
    w: 105,
    align: 'right',
    wrap: true,
    ayuda: 'Cuántas PERSONAS distintas tiene inscritas el docente. Quien está en varias de sus asignaturas cuenta una sola vez, así que no es el número de inscripciones. Una persona inscrita con dos docentes cuenta con cada uno: la suma de la columna puede superar el total de estudiantes de la plataforma. Un 0 es un cero confirmado.',
  },
  {
    key: 'registro',
    label: 'Fecha de registro',
    filtro: 'fecha',
    w: 135,
    ayuda: 'Cuándo se registró el docente: la fecha de creación de su cuenta en Firebase Authentication (hora de México). Si Auth no la trae, la de su perfil; si no hay ninguna, guion. El número de la primera columna sigue este mismo orden (1 = el registro más antiguo).',
  },
  {
    key: 'metodo',
    label: 'Se registró con',
    w: 140,
    wrap: true,
    ayuda: 'Cómo creó su cuenta, según el perfil del docente (users.provider). No dice con qué métodos entra hoy: quien se registró con Google puede haber agregado después una contraseña. Guion: el perfil no lo trae.',
  },
  {
    key: 'regalo',
    label: 'Regalo IA',
    w: 165,
    wrap: true,
    ayuda: 'Qué pasó con los créditos de IA de regalo de ese docente: si todavía no los activa, cuántos le quedan, o si ya los gastó. La cantidad regalada sale del registro de cada quien (hoy son 30; las cuentas anteriores al 25-ago-2026 recibieron 50). Cuando el reparto entre regalo y créditos comprados no puede afirmarse con certeza, lo dice en vez de estimar.',
  },
  {
    key: 'creditos',
    label: 'Saldo IA',
    w: 110,
    align: 'right',
    ayuda: 'Saldo TOTAL de créditos de IA del docente hoy — regalo, compras y ajustes juntos, no solo el regalo (leído de iaCreditos en tiempo de carga). Guion: el docente todavía no activa sus créditos de bienvenida, la información aún se está cargando, o la cuenta ya no existe. Un 0 significa saldo cero confirmado.',
  },
  {
    key: 'sinAcceder',
    label: 'Días sin accesar',
    w: 120,
    align: 'right',
    wrap: true,
    ordenable: true,
    ayuda: 'Cuántos días lleva el docente sin iniciar sesión (lo que Firebase Auth registra como su último acceso, no una fecha que guardemos nosotros). En ámbar a partir de 30 días y en rojo a partir de 60. Guion: nunca ha entrado, o su cuenta ya no existe. Clic en el título para ordenar: de menos a más días, de más a menos, y otro clic quita el orden.',
  },
  {
    key: 'ultimaCompra',
    label: 'Última compra de créditos',
    w: 175,
    wrap: true,
    ayuda: 'La compra de créditos completada más reciente de ese docente: fecha en que se aprobó y créditos comprados. «Sin compras» si no tiene ninguna completada. No incluye los créditos de regalo ni los ajustes manuales, ni los pagos del modelo anterior.',
  },
  { key: 'acciones', label: 'Acciones', w: 120 },
]

const CAMPOS_TEXTO = ['codigoPostal', 'estado', 'ciudad', 'escuela']
const CAMPOS_FILTRO = COLS.filter((c) => c.filtro).map((c) => c.key)
const SIN_FILTROS = Object.fromEntries(CAMPOS_FILTRO.map((k) => [k, '']))

// ¿Esta fila pasa los filtros? `excepto` deja fuera un campo a propósito, para
// calcular qué sugerir en ESA columna sin que su propio texto a medio escribir
// recorte la lista.
function pasaFiltros(r, filtros, search, excepto) {
  const t = (k) => (k === excepto ? '' : normalizeName(filtros[k]))
  if (t('codigoPostal') && !r.buscarCodigoPostal.includes(t('codigoPostal'))) return false
  if (t('estado') && !r.buscarEstado.includes(t('estado'))) return false
  if (t('ciudad') && !r.buscarCiudad.includes(t('ciudad'))) return false
  if (t('escuela') && !r.buscarEscuela.includes(t('escuela'))) return false
  // El día se compara en la zona de México (r.registroISO ya viene calculado así).
  if (excepto !== 'registro' && filtros.registro && r.registroISO !== filtros.registro) return false
  // La caja de arriba busca en TODO el renglón (docente, correo, ubicación,
  // escuela, fecha de registro, método, última compra…), no solo en el nombre:
  // quien escribe "guanajuato" o "google" ahí espera encontrarlo.
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
            list={listId} autoComplete="off"
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

// La insignia se PARTE en varios renglones en vez de truncarse. Con quince
// columnas repartiéndose el ancho del área, "Activo · 12.5 de 30" no cabe de un
// tirón en una pantalla mediana, y truncada se lee igual que "Activo · sin
// desglose" — que es justo lo que esta columna existe para distinguir. En un
// monitor ancho cabe en un solo renglón y no se parte nada.
const INSIGNIA_REGALO =
  'inline-block max-w-full whitespace-normal leading-tight px-2 py-0.5 rounded text-xs font-medium cursor-help'

// Colores por estado del regalo, con las mismas parejas que ya usa el resto
// del panel para las insignias de situación (ver getSubscriptionStatusColor):
// verde lo que está bien, ámbar lo que pide atención, gris lo que solo informa.
const TONO_REGALO = {
  sin_activar: 'bg-amber-100 text-amber-700',
  activo: 'bg-emerald-100 text-emerald-700',
  agotado: 'bg-slate-100 text-slate-600',
  indeterminable: 'bg-surface text-muted border border-outline-variant',
  sin_registro: 'bg-slate-100 text-slate-500',
  no_disponible: 'bg-slate-100 text-slate-500',
}

// Qué pasó con los créditos de regalo de este docente. Toda la decisión vive
// en estadoRegaloIA (utils/creditosHelpers.js), que es pura y está probada;
// aquí solo se le pone color y tooltip.
function CeldaRegalo({ uid, cuentaEliminada, registro, creditos, tieneComprasAcreditadas, sinPermiso }) {
  // Una cuenta dada de baja ya no tiene nada que contar: sus documentos de
  // créditos se borraron con ella (ver api/admin/delete-account).
  if (!uid || cuentaEliminada) return <span className="text-hint">&mdash;</span>

  // Las reglas negaron la lectura. Se dice, no se disimula: la alternativa
  // sería pintar a todo el padrón como "sin registro" y que nadie se entere de
  // que falta correr `npm run deploy:rules`.
  if (sinPermiso) {
    return (
      <span
        title="El panel no pudo leer el registro de créditos de regalo. Falta desplegar las reglas de Firestore (npm run deploy:rules) para que el administrador pueda consultarlo."
        className={`${INSIGNIA_REGALO} bg-amber-100 text-amber-700`}
      >
        Sin permiso
      </span>
    )
  }

  const r = estadoRegaloIA({ registro, creditos, tieneComprasAcreditadas })
  return (
    <span
      title={r.ayuda}
      className={`${INSIGNIA_REGALO} ${TONO_REGALO[r.estado] || TONO_REGALO.sin_registro}`}
    >
      {r.texto}
    </span>
  )
}

export default function RegistrosTable({ stats, onRefresh }) {
  const toast = useToast()
  const { currentUser } = useAuth()
  const [ajusteModal, setAjusteModal] = useState(null)
  const [deleteModal, setDeleteModal] = useState(null)
  const [search, setSearch] = useState('')
  const [filtros, setFiltros] = useState(SIN_FILTROS)
  const [limit, setLimit] = useState(PAGE)
  const { containerRef, widths, total, dragKey, startResize, resetWidths, resetColumn, esRedimensionable } =
    useColumnWidths(WIDTHS_KEY, COLS)

  useBackHandler(() => setAjusteModal(null), !!ajusteModal)
  useBackHandler(() => setDeleteModal(null), !!deleteModal)
  useScrollLock(!!ajusteModal || !!deleteModal)

  // Memoizados aunque parezcan triviales: el `|| []` crea un arreglo nuevo en
  // cada render y eso invalidaría los useMemo que dependen de ellos.
  // Último acceso y fecha de alta de cada docente (Firebase Auth). Los pide UNA
  // sola vez useAdminStats a api/admin/last-access (el Resumen también los usa)
  // y los comparte aquí en stats.authInfo, porque solo el Admin SDK puede leer
  // la metadata de OTRO usuario. Si fallan, la columna se queda en guion: es un
  // dato de apoyo, no debe tumbar la tabla.
  const authInfo = stats?.authInfo
  const accesos = authInfo?.accesos ?? SIN_DATOS
  const creadoEnMap = authInfo?.creadoEn ?? SIN_DATOS
  const [orden, setOrden] = useState(null)
  const [creditosMap, setCreditosMap] = useState({})
  const [creditosListos, setCreditosListos] = useState(false)
  const [regaloMap, setRegaloMap] = useState({})
  const [regaloListo, setRegaloListo] = useState(false)
  // `true` solo cuando las reglas negaron la lectura, para que la columna lo
  // diga en vez de fingir que nadie tiene regalo.
  const [regaloSinPermiso, setRegaloSinPermiso] = useState(false)
  const teachers = useMemo(() => stats?.teachers || [], [stats?.teachers])

  // `authInfo.resuelto` es true cuando la petición de Auth TERMINÓ (con éxito,
  // con fallo o por tope de tiempo). El orden de la tabla depende de las fechas
  // de alta que trae esa respuesta; pintar filas antes mostraba un orden
  // provisional que luego se reacomodaba. Una vez resuelta, nunca vuelve a
  // "cargando": «Actualizar» conserva la tabla en pantalla mientras llegan los
  // datos nuevos. Sin docentes o sin sesión no hay nada que esperar.
  const accesosListos = !!authInfo?.resuelto || teachers.length === 0 || !currentUser

  // Créditos de IA por docente — una lectura por sesión del panel, igual que
  // el resto de los datos de apoyo de la tabla. Se guarda el documento
  // COMPLETO, no solo el saldo: el estado del regalo necesita además el
  // consumo histórico y las señales que delatan un desglose no confiable
  // (ajustes manuales del admin, saldo migrado de un plan viejo).
  useEffect(() => {
    if (!teachers.length) return
    getDocs(collection(db, 'iaCreditos'))
      .then((snap) => {
        const m = {}
        snap.forEach((d) => { m[d.id] = d.data() })
        setCreditosMap(m)
        setCreditosListos(true)
      })
      .catch(() => {})
  }, [teachers])

  // Estado del regalo de bienvenida por docente (iaTrialRegistro).
  //
  // Este fallo NO se traga en silencio, a diferencia del de arriba: la lectura
  // del admin sobre esta colección depende de un despliegue MANUAL de
  // firestore.rules (`npm run deploy:rules`). Si se olvida, la columna debe
  // DECIR que le falta permiso; quedarse en blanco pintaría a todo el padrón
  // como "sin registro", que es justo la confusión que esta columna existe
  // para eliminar.
  useEffect(() => {
    if (!teachers.length) return
    getDocs(collection(db, 'iaTrialRegistro'))
      .then((snap) => {
        const m = {}
        snap.forEach((d) => { m[d.id] = d.data() })
        setRegaloMap(m)
        setRegaloSinPermiso(false)
        setRegaloListo(true)
      })
      .catch(() => { setRegaloSinPermiso(true); setRegaloListo(true) })
  }, [teachers])

  // Docentes con al menos una compra de créditos ya acreditada: a partir de
  // ahí su saldo mezcla regalo y compras, y cuánto queda del regalo deja de
  // poder deducirse. Hoy no hay ninguna, pero el día que la haya la columna
  // tiene que dejar de afirmar un desglose en vez de empezar a mentir.
  const comprasAcreditadas = useMemo(() => {
    const set = new Set()
    ;(stats?.creditPurchases || []).forEach((c) => {
      if (c.status === PAYMENT_STATUS.COMPLETADO && c.docenteId) set.add(c.docenteId)
    })
    return set
  }, [stats?.creditPurchases])

  // Personas únicas por docente, en UNA sola pasada sobre el padrón que el panel
  // ya tiene cargado (stats.students y stats.subjectsMap): ni una consulta más a
  // Firestore. Solo se rehace cuando cambian esos datos, no al escribir en los
  // filtros ni al pintar cada fila. La regla vive en utils/registrosTabla.js.
  const estudiantesMap = useMemo(
    () => estudiantesPorDocente(stats?.students || [], stats?.subjectsMap || {}),
    [stats?.students, stats?.subjectsMap]
  )

  // Última compra de créditos COMPLETADA de cada docente (creditPurchases, con
  // las mismas reglas de venta que el Resumen). Los pagos históricos (payments)
  // no entran.
  const ultimaCompra = useMemo(
    () => ultimaCompraPorDocente(stats?.creditPurchases || []),
    [stats?.creditPurchases]
  )

  // Correos que usan dos o más docentes: solo se señalan, no se corrigen.
  const duplicados = useMemo(() => correosDuplicados(teachers), [teachers])

  // Una fila por docente REGISTRADO (de `users`) más las constancias de baja:
  // nada depende de que haya comprado créditos ni de suscripciones. Se "aplana"
  // una sola vez a las columnas visibles, así el filtro trabaja sobre texto ya
  // resuelto en vez de volver a cruzar docente, escuela y ubicación en cada tecla.
  const rows = useMemo(() => {
    if (!stats) return []
    const filas = construirFilasRegistros({
      docentes: teachers,
      bajas: stats.bajas || [],
      schoolsMap: stats.schoolsMap || {},
      estudiantes: estudiantesMap,
      creadoEn: creadoEnMap,
      accesos,
      ultimaCompra,
      ahora: new Date(),
    })
    return filas.map((r) => ({
      ...r,
      buscarCodigoPostal: normalizeName(r.codigoPostal),
      buscarEstado: normalizeName(r.estado),
      buscarCiudad: normalizeName(r.ciudad),
      buscarEscuela: normalizeName(r.escuela),
      // Todo el renglón en una sola cadena para la caja de búsqueda de arriba,
      // que busca por cualquier motivo (ciudad, escuela, nombre…).
      buscarTodo: normalizeName(
        [r.docente, r.correo, r.codigoPostal, r.estado, r.ciudad, r.escuela,
          r.estudiantes === null ? '' : String(r.estudiantes), r.registroTexto, r.metodo,
          r.ultimaCompra, r.bajaTexto || ''].join(' ')
      ),
    }))
  }, [stats, teachers, estudiantesMap, creadoEnMap, accesos, ultimaCompra])

  // Orden predeterminado: el registro más reciente hasta arriba (las filas sin
  // fecha de registro, y las constancias de baja, al final); desempata el nombre.
  // Si se ordena por una columna, ese criterio manda y el predeterminado queda
  // como desempate.
  const filtered = useMemo(
    () =>
      rows
        .filter((r) => pasaFiltros(r, filtros, search, null))
        .sort((a, b) =>
          (orden ? compararNumerico(a[orden.key], b[orden.key], orden.dir) : 0) ||
          compararPorRegistro(a, b) ||
          a.docente.localeCompare(b.docente, 'es')),
    [rows, filtros, search, orden]
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

  function alternarOrden(key) {
    setOrden((o) => siguienteOrden(o, key))
    setLimit(PAGE)
  }

  function limpiarTodo() {
    setFiltros(SIN_FILTROS)
    setSearch('')
    setLimit(PAGE)
  }

  // Borra la CONSTANCIA de una cuenta eliminada (colección `bajas`, doc id =
  // uid del docente — ver api/account/delete.js). Es un documento totalmente
  // distinto al de la cuenta. `firestore.rules` necesita `allow delete: if
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

  function openDeleteModal(uid, docente, correo) {
    setDeleteModal({ uid, docente, correo, saving: false })
  }

  async function handleDeleteAccount() {
    if (!deleteModal) return
    setDeleteModal((m) => ({ ...m, saving: true }))
    try {
      const token = await currentUser.getIdToken()
      const res = await fetch(apiUrl('/api/admin/delete-account'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetUid: deleteModal.uid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al eliminar la cuenta')
      toast('Cuenta eliminada')
      setDeleteModal(null)
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      setDeleteModal((m) => ({ ...m, saving: false }))
    }
  }

  // Se identifica al docente por su uid, no por su suscripción: desde el modelo
  // de créditos puros (20-ago-2026) los docentes nuevos ya no tienen documento
  // en `subscriptions`, y `ajustarSaldoCreditosIA` solo necesita el docenteId.
  function openAjuste(docenteId, docente) {
    setAjusteModal({ docenteId, docente, cantidad: '', motivo: '', saving: false })
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
          <h2 className="font-semibold text-on-surface">Registros</h2>
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
          <p className="text-sm text-hint mt-0.5">
            Una fila por docente registrado. <strong>Regalo IA</strong> es qué pasó con los
            créditos de bienvenida; <strong>Saldo IA</strong> es el saldo total de hoy.
          </p>
          {/* La última consulta a Firebase Authentication falló o se agotó DESPUÉS
              de una correcta: se conservan esos datos (la tabla no pierde su orden
              ni parpadea), pero no se presentan como recién confirmados. */}
          {authInfo?.obsoleto && (
            <output className="flex items-start gap-1.5 text-xs text-amber-800 mt-1.5">
              <AlertTriangle size={14} className="mt-px flex-shrink-0" aria-hidden="true" />
              <span>
                Fecha de registro y días sin accesar de la consulta {cuandoConsultaAuth(authInfo.actualizadoEn, stats?.cargadoEn) || 'anterior'}:
                no se pudo actualizar Firebase Authentication.
              </span>
            </output>
          )}
          {/* Solo si de verdad hay correos repetidos entre docentes. Nada se
              fusiona ni se corrige: se señala para que alguien lo revise. */}
          {duplicados.length > 0 && (
            <output className="flex items-start gap-1.5 text-xs text-amber-800 mt-1.5">
              <AlertTriangle size={14} className="mt-px flex-shrink-0" aria-hidden="true" />
              <span>
                {duplicados.length === 1 ? '1 correo lo usan' : `${duplicados.length} correos los usan`} varios docentes
                {' '}({duplicados.slice(0, 3).map((d) => `${d.correo} · ${d.cantidad}`).join('; ')}
                {duplicados.length > 3 ? '…' : ''}). Revísalos: no se unieron ni se corrigieron.
              </span>
            </output>
          )}
        </div>

        <div className="flex flex-col items-stretch gap-2 w-full sm:w-80">
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setLimit(PAGE) }}
            etiqueta="Buscar por cualquier dato…"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={limpiarTodo}
              disabled={!hayFiltro}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-full border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-accent text-accent hover:bg-[var(--accent-tint)]"
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
                const { key, label, filtro, align, ayuda, wrap, ordenable } = col
                const ordenActivo = ordenable && orden?.key === key ? orden.dir : null
                const filtrada = filtro && filtros[key] !== ''
                return (
                  <th
                    key={key}
                    aria-sort={ordenable ? (ordenActivo === 'asc' ? 'ascending' : ordenActivo === 'desc' ? 'descending' : 'none') : undefined}
                    className={`sticky top-0 z-10 relative px-3 py-2 align-top select-none transition-colors ${
                      filtrada ? 'bg-accent-light text-accent' : 'bg-surface text-accent'
                    }`}
                  >
                    {(() => {
                      const titulo = (
                        <span
                          title={ayuda}
                          className={`block font-semibold ${wrap ? 'whitespace-normal leading-tight' : 'truncate'} ${align === 'right' ? 'text-right' : ''} ${ayuda ? 'cursor-help underline decoration-dotted underline-offset-2' : ''}`}
                        >
                          {label}
                        </span>
                      )
                      if (!ordenable) return titulo
                      const Flecha = ordenActivo === 'asc' ? ArrowUp : ordenActivo === 'desc' ? ArrowDown : ArrowUpDown
                      return (
                        <button
                          type="button"
                          onClick={() => alternarOrden(key)}
                          aria-label={`Ordenar por ${label}`}
                          className="flex w-full items-start gap-1 text-left uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                        >
                          <span className="min-w-0 flex-1">{titulo}</span>
                          <Flecha size={14} className={`mt-px shrink-0 ${ordenActivo ? '' : 'opacity-50'}`} aria-hidden="true" />
                        </button>
                      )
                    })()}

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
            {!accesosListos ? (
              // Las fechas de alta (y con ellas el orden y la columna No.)
              // llegan de la petición de último acceso: hasta que termina no se
              // pintan filas, para no enseñar un orden provisional.
              <tr>
                <td colSpan={COLS.length} className="px-4 py-4">
                  <SkeletonTable rows={8} cols={7} etiqueta="Cargando registros…" />
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-8 text-center text-hint">
                  {rows.length === 0
                    ? 'Sin registros'
                    : 'Ningún registro cumple con lo que se está filtrando'}
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--accent-tint)]">
                  <td className="px-3 py-2 text-right text-hint tabular-nums">
                    {r.rank ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-medium text-on-surface truncate" title={r.docente}>
                    {r.docente}
                    {/* La fecha de baja NO es la de registro: se dice aparte. */}
                    {r.baja && <span className="block text-xs font-normal text-red-600 truncate">{r.bajaTexto}</span>}
                  </td>
                  <td className="px-3 py-2 text-muted truncate" title={r.correo}>{r.correo}</td>
                  <td className="px-3 py-2 text-muted truncate tabular-nums">{r.codigoPostal}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.estado}>{r.estado}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.ciudad}>{r.ciudad}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.escuela}>{r.escuela}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-on-surface">
                    {r.estudiantes === null ? '—' : r.estudiantes.toLocaleString('es-MX')}
                  </td>
                  <td className="px-3 py-2 text-muted truncate">{r.registroTexto}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.metodo}>{r.metodo}</td>
                  <td className="px-3 py-2">
                    <CeldaRegalo
                      uid={r.uid}
                      cuentaEliminada={r.baja}
                      registro={regaloMap[r.uid]}
                      creditos={creditosMap[r.uid]}
                      tieneComprasAcreditadas={comprasAcreditadas.has(r.uid)}
                      sinPermiso={regaloSinPermiso}
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-on-surface">
                    {(() => {
                      const saldo = saldoIAVisible({
                        uid: r.uid,
                        cuentaEliminada: r.baja,
                        creditosListos,
                        regaloListo,
                        regaloSinPermiso,
                        registro: regaloMap[r.uid],
                        creditos: creditosMap[r.uid],
                        tieneComprasAcreditadas: comprasAcreditadas.has(r.uid),
                      })
                      return saldo === null ? '—' : formatCreditos(saldo)
                    })()}
                  </td>
                  {/* Mismo criterio de lectura rápida que la columna Días:
                      lo que hay que cazar de un vistazo va en color. A los 60
                      días es cuando el docente-dueño decide si elimina la
                      cuenta o intenta traer de vuelta a esa persona. */}
                  <td className={`px-3 py-2 text-right tabular-nums ${
                    r.sinAcceder === null ? 'text-hint'
                      : r.sinAcceder >= 60 ? 'text-red-600 font-semibold'
                      : r.sinAcceder >= 30 ? 'text-amber-600 font-semibold'
                      : 'text-muted'
                  }`}>
                    {r.sinAcceder === null ? '—' : r.sinAcceder}
                  </td>
                  <td className="px-3 py-2 truncate" title={r.ultimaCompra}>
                    {r.ultimaCompraTipo === 'sin'
                      ? <span className="text-hint">{r.ultimaCompra}</span>
                      : <span className="text-muted">{r.ultimaCompra}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {r.baja ? (
                      <button
                        type="button"
                        onClick={() => handleDeleteBaja(r.uid)}
                        className="p-2 text-hint hover:text-red-600 rounded-full"
                        aria-label="Eliminar constancia"
                        title="Eliminar constancia"
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : (
                      <div className="flex items-center gap-0.5">
                        {r.uid && (
                          <button
                            type="button"
                            onClick={() => openAjuste(r.uid, r.docente)}
                            disabled={ajusteModal?.docenteId === r.uid && ajusteModal?.saving}
                            className="p-1.5 text-hint hover:text-accent rounded-full disabled:opacity-40"
                            aria-label="Ajustar créditos de IA"
                            title="Ajustar créditos de IA"
                          >
                            <Zap size={16} />
                          </button>
                        )}
                        {r.uid && (
                          <button
                            type="button"
                            onClick={() => openDeleteModal(r.uid, r.docente, r.correo)}
                            className="p-1.5 text-hint hover:text-red-600 rounded-full"
                            aria-label="Eliminar cuenta"
                            title="Eliminar cuenta del docente"
                          >
                            <UserX size={16} />
                          </button>
                        )}
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
              className="px-3 py-2 text-sm font-semibold text-accent border border-accent rounded-full hover:bg-[var(--accent-tint)] transition-colors"
            >
              Mostrar {Math.min(PAGE, filtered.length - visible.length)} más
            </button>
          </div>
        )}
      </div>

      {deleteModal && (
        <div className="fixed inset-0 z-50 bg-black/40 animate-velo flex items-center justify-center px-4">
          <div className="bg-surface-card rounded-card p-5 w-[calc(100%-2rem)] max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-on-surface">Eliminar cuenta</h3>
              <button type="button" onClick={() => !deleteModal.saving && setDeleteModal(null)} aria-label="Cerrar">
                <X size={20} className="text-hint" />
              </button>
            </div>
            <p className="text-sm text-muted mb-0.5">
              Docente: <strong className="text-on-surface">{deleteModal.docente}</strong>
            </p>
            <p className="text-sm text-muted mb-4 truncate">{deleteModal.correo}</p>
            <div className="text-sm bg-red-50 border border-red-200 rounded p-3 mb-4 space-y-1.5">
              <p className="font-semibold text-red-700">Esta acción es permanente e irreversible:</p>
              <ul className="list-disc list-inside space-y-0.5 text-red-600">
                <li>Se elimina la cuenta de Firebase Auth</li>
                <li>Se borran todos sus datos de Firestore</li>
                <li>Se eliminan sus archivos en Cloudinary</li>
                <li>Sus alumnos sin otras clases también se eliminan</li>
              </ul>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => !deleteModal.saving && setDeleteModal(null)}
                disabled={deleteModal.saving}
                className="flex-1 py-2.5 border border-outline-variant text-muted font-semibold rounded-full text-sm disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleteModal.saving}
                className="flex-1 py-2 bg-red-600 text-white font-semibold rounded-full text-sm disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {deleteModal.saving ? <Spinner size="sm" /> : null}
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {ajusteModal && (
        <div className="fixed inset-0 z-50 bg-black/40 animate-velo flex items-center justify-center px-4">
          <div className="bg-surface-card rounded-card p-5 w-[calc(100%-2rem)] max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-on-surface">Ajustar créditos de IA</h3>
              <button type="button" onClick={() => setAjusteModal(null)} aria-label="Cerrar">
                <X size={20} className="text-hint" />
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
                  className={inputCls}
                />
                <p className="text-sm text-slate-500 mt-1">
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
                  className={inputCls}
                />
              </div>
              <button
                type="submit"
                disabled={ajusteModal.saving || !ajusteModal.cantidad || !ajusteModal.motivo.trim()}
                className="w-full py-2.5 bg-accent text-white font-semibold rounded-full text-sm disabled:opacity-60 flex items-center justify-center gap-2"
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
