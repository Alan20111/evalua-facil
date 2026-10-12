// Reglas de presentación de la tabla «Registros» del panel de administración.
// Son funciones puras para poder probarlas sin navegador.
import { capitalizarNombre } from './nombres.js'
import { estadoRegaloIA } from './creditosHelpers.js'
import { claveDia } from './costosIA.js'
import { claveEstudiante, leerFechaAuth } from './resumenAdmin.js'

const limpio = (v) => String(v ?? '').trim()

// Nombre del docente tal como lo registró en su perfil. Cadena de respaldo:
//   1. nombre + apellido paterno (+ materno, si lo hay) — el nombre completo.
//      Cada parte se capitaliza POR SEPARADO: capturados en campos distintos,
//      uno puede venir en mayúsculas y otro no ("Laura" + "GARCÍA"), y unidos
//      parecerían escritos a propósito y se respetarían tal cual.
//   2. nombreMostrar (el alias libre que escribió al registrarse).
//   3. nombre suelto (es lo único que guardan las constancias de baja).
//   4. username, que es identificador y no se capitaliza.
// Nunca se deduce nada del correo ni se escribe en el perfil.
export function nombreCompletoDocente(teacher) {
  const nombre = limpio(teacher?.nombre)
  const paterno = limpio(teacher?.apellidoPaterno)
  const materno = limpio(teacher?.apellidoMaterno)
  if (nombre && paterno) {
    return [nombre, paterno, materno].map(capitalizarNombre).filter(Boolean).join(' ')
  }
  return (
    capitalizarNombre(teacher?.nombreMostrar) ||
    capitalizarNombre(teacher?.nombre) ||
    limpio(teacher?.username)
  )
}

// Qué mostrar en «Saldo IA». Devuelve el número a pintar o `null` (= guion).
//
// El guion significa «no hay saldo que afirmar»: la cuenta aún no activó sus
// créditos, o todavía no se sabe. Un 0 solo se pinta cuando está confirmado.
// Un saldo positivo nunca se oculta.
export function saldoIAVisible({
  uid,
  cuentaEliminada = false,
  creditosListos = false,
  regaloListo = false,
  regaloSinPermiso = false,
  registro,
  creditos,
  tieneComprasAcreditadas = false,
} = {}) {
  if (!uid || cuentaEliminada) return null
  // Sin la lectura de iaCreditos no hay nada confirmado.
  if (!creditosListos) return null
  const saldo = typeof creditos?.saldo === 'number' ? creditos.saldo : 0
  if (saldo > 0) return saldo
  // Sin la lectura del registro de regalo (y sin haber sido negada) todavía no
  // se puede saber si el cero es un cero real o una cuenta sin activar.
  if (!regaloListo && !regaloSinPermiso) return null
  if (!regaloSinPermiso && registro) {
    if (estadoRegaloIA({ registro, creditos, tieneComprasAcreditadas }).estado === 'sin_activar') return null
  }
  return saldo
}

// Comparador numérico con valores desconocidos (`null`) siempre al final,
// sea cual sea el sentido. `dir`: 'asc' (0, 1, 2…) o 'desc'.
export function compararNumerico(a, b, dir) {
  const aNulo = a === null || a === undefined
  const bNulo = b === null || b === undefined
  if (aNulo || bNulo) return aNulo === bNulo ? 0 : aNulo ? 1 : -1
  return dir === 'desc' ? b - a : a - b
}

// Ciclo del clic en un encabezado: sin orden → ascendente → descendente → sin
// orden (vuelve al predeterminado). Pulsar otra columna empieza de nuevo.
export function siguienteOrden(actual, key) {
  if (!actual || actual.key !== key) return { key, dir: 'asc' }
  if (actual.dir === 'asc') return { key, dir: 'desc' }
  return null
}

// ════════════════════════════════════════════════════════════════════════════
// Etapa 2C — la tabla «Registros» parte de `users`, no de las suscripciones.
// ════════════════════════════════════════════════════════════════════════════

// Un dato desconocido se escribe así. NUNCA se rellena con 0: un cero es una
// cifra confirmada («no tiene estudiantes»), «—» es «no lo sabemos».
export const SIN_DATO = '—'

const FORMATO_FECHA_MX = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City', day: 'numeric', month: 'short', year: 'numeric',
})

/** «11 oct 2026» en la zona de México; null si no es una fecha válida. */
export function formatoFechaMX(valor) {
  const d = leerFechaAuth(valor)
  return d ? FORMATO_FECHA_MX.format(d).split('.').join('') : null
}

/** Día 'AAAA-MM-DD' en la zona de México (para el filtro por fecha); '' si no hay fecha. */
export function diaMX(valor) {
  const d = leerFechaAuth(valor)
  return d ? claveDia(d) : ''
}

/**
 * Fecha de registro de un docente. Primero la de creación en Firebase
 * Authentication (la fecha real); si Auth no la trae, `users.createdAt`. NUNCA la
 * de una suscripción. null si no hay ninguna fecha válida.
 */
export function fechaDeRegistro({ creadoEnAuth, createdAt } = {}) {
  return leerFechaAuth(creadoEnAuth) || leerFechaAuth(createdAt)
}

/**
 * «Se registró con»: sale de `users.provider` tal cual. Cualquier otro valor
 * (o su ausencia) es desconocido: no se infiere del correo ni de Auth.
 */
export function metodoDeRegistro(provider) {
  if (provider === 'google') return 'Google'
  if (provider === 'password') return 'Correo y contraseña'
  return null
}

/**
 * Texto de la columna «Última compra de créditos»: «11 oct 2026 · 200 créditos»,
 * «— · 200 créditos» si esa compra no trae una fecha de resolución válida, o
 * «Sin compras» (tipo 'sin') cuando el docente no tiene ninguna completada.
 */
export function textoUltimaCompra(ultima) {
  if (!ultima || typeof ultima !== 'object') return { tipo: 'sin', texto: 'Sin compras' }
  const n = Number(ultima.creditos)
  const creditos = `${n.toLocaleString('es-MX')} ${n === 1 ? 'crédito' : 'créditos'}`
  return { tipo: 'compra', texto: `${formatoFechaMX(ultima.fecha) || SIN_DATO} · ${creditos}` }
}

/**
 * Personas ÚNICAS por docente. Cada asignatura es un documento aparte en
 * `students`, pero la persona (usuario + escuela) es la misma: quien está en
 * tres asignaturas del mismo docente cuenta una vez con ese docente. El docente
 * sale de la asignatura; el campo `docenteId` suelto solo es respaldo. La misma
 * persona SÍ cuenta con cada docente distinto con el que está, así que la suma de
 * esta columna puede superar el total de personas de la plataforma.
 */
export function estudiantesPorDocente(students, subjectsMap = {}) {
  const porDocente = new Map()
  ;(Array.isArray(students) ? students : []).forEach((s, i) => {
    if (s === null || typeof s !== 'object' || Array.isArray(s)) return
    const docenteId = (subjectsMap && subjectsMap[s.asignaturaId]?.docenteId) || s.docenteId
    if (!docenteId) return
    const persona = claveEstudiante(s) || `doc:${typeof s.id === 'string' ? s.id : `#${i}`}`
    let set = porDocente.get(docenteId)
    if (!set) porDocente.set(docenteId, (set = new Set()))
    set.add(persona)
  })
  const res = {}
  porDocente.forEach((set, docenteId) => { res[docenteId] = set.size })
  return res
}

/**
 * Correos que usan DOS O MÁS docentes (sin importar mayúsculas ni espacios). No
 * se fusiona ni se corrige nada: solo se señala para que alguien lo revise.
 */
export function correosDuplicados(docentes) {
  const grupos = new Map()
  ;(Array.isArray(docentes) ? docentes : []).forEach((d) => {
    if (!d || typeof d.email !== 'string') return
    const correo = d.email.trim().toLowerCase()
    if (!correo) return
    const g = grupos.get(correo) || { correo, ids: [] }
    g.ids.push(d.id)
    grupos.set(correo, g)
  })
  return [...grupos.values()]
    .filter((g) => g.ids.length >= 2)
    .map((g) => ({ correo: g.correo, cantidad: g.ids.length, ids: g.ids }))
    .sort((a, b) => (a.correo < b.correo ? -1 : a.correo > b.correo ? 1 : 0))
}

/**
 * Días completos desde el último acceso. null cuando no hay dato (nunca entró, o
 * la cuenta ya no está en Auth): no se convierte en 0.
 */
export function diasSinAcceso(fecha, ahora) {
  const d = leerFechaAuth(fecha)
  const ref = leerFechaAuth(ahora)
  if (!d || !ref) return null
  return Math.max(0, Math.floor((ref.getTime() - d.getTime()) / 86400000))
}

/**
 * Orden predeterminado de la tabla: el registro más NUEVO primero. Las filas sin
 * número (sin fecha de registro, o constancias de baja) van al final; entre sí
 * no se ordenan aquí (el desempate es el nombre).
 */
export function compararPorRegistro(a, b) {
  const ra = a.rank
  const rb = b.rank
  if (ra == null && rb == null) return 0
  if (ra == null) return 1
  if (rb == null) return -1
  return rb - ra
}

/**
 * Una fila por docente REGISTRADO (de `users`), más las constancias de baja.
 * Nada depende de que haya comprado créditos ni de que tenga o haya tenido una
 * suscripción.
 *
 * `rank` («No.») numera los docentes con fecha de registro: 1 = el más antiguo.
 * Quien no tiene fecha (y las constancias) lleva `rank: null` y se muestra «—»:
 * no se les inventa una posición.
 *
 * @param {object} p
 * @param {Array<object>} p.docentes   usuarios con role 'docente' (con `id`)
 * @param {Array<object>} [p.bajas]    constancias de `bajas` (id = uid, nombre, email, fechaBaja)
 * @param {object} [p.schoolsMap]
 * @param {object} [p.estudiantes]     { docenteId: personas únicas }
 * @param {object} [p.creadoEn]        { uid: fecha de creación en Auth }
 * @param {object} [p.accesos]         { uid: último acceso en Auth }
 * @param {object} [p.ultimaCompra]    { docenteId: { fecha, creditos } }
 * @param {Date|number} p.ahora
 */
export function construirFilasRegistros({
  docentes, bajas = [], schoolsMap = {}, estudiantes = {}, creadoEn = {}, accesos = {}, ultimaCompra = {}, ahora,
}) {
  const filasDocente = (Array.isArray(docentes) ? docentes : []).filter((t) => t && t.id).map((t) => {
    const school = schoolsMap[t.escuelaId]
    const registro = fechaDeRegistro({ creadoEnAuth: creadoEn[t.id], createdAt: t.createdAt })
    const compra = textoUltimaCompra(ultimaCompra[t.id])
    return {
      id: `docente-${t.id}`,
      uid: t.id,
      baja: false,
      docente: nombreCompletoDocente(t) || SIN_DATO,
      correo: t.email || SIN_DATO,
      // El CP no tiene respaldo (el catálogo de planteles no lo trae); estado y
      // ciudad caen a los de su escuela si el docente no capturó los suyos.
      codigoPostal: t.codigoPostal || SIN_DATO,
      estado: t.estado || school?.estado || SIN_DATO,
      ciudad: t.ciudad || t.municipio || school?.municipio || SIN_DATO,
      escuela: school?.shortName || school?.nombre || school?.claveSEP || SIN_DATO,
      // 0 es un cero confirmado: la lista de estudiantes completa ya se cargó.
      estudiantes: estudiantes[t.id] || 0,
      registroMs: registro ? registro.getTime() : null,
      registroTexto: formatoFechaMX(registro) || SIN_DATO,
      registroISO: diaMX(registro),
      metodo: metodoDeRegistro(t.provider) || SIN_DATO,
      ultimaCompraTipo: compra.tipo,
      ultimaCompra: compra.texto,
      sinAcceder: diasSinAcceso(accesos[t.id], ahora),
    }
  })

  const filasBaja = (Array.isArray(bajas) ? bajas : []).filter((b) => b && b.id).map((b) => {
    const cuando = formatoFechaMX(b.fechaBaja)
    return {
      id: `baja-${b.id}`,
      uid: b.id,
      baja: true,
      docente: nombreCompletoDocente({ nombre: b.nombre }) || SIN_DATO,
      correo: b.email || SIN_DATO,
      codigoPostal: SIN_DATO,
      estado: SIN_DATO,
      ciudad: SIN_DATO,
      escuela: SIN_DATO,
      estudiantes: null,
      // La fecha de baja NO es la de registro: se dice aparte.
      registroMs: null,
      registroTexto: SIN_DATO,
      registroISO: '',
      metodo: SIN_DATO,
      ultimaCompraTipo: 'baja',
      ultimaCompra: SIN_DATO,
      sinAcceder: null,
      bajaTexto: cuando ? `Cuenta eliminada el ${cuando}` : 'Cuenta eliminada',
    }
  })

  const conFecha = filasDocente.filter((f) => f.registroMs !== null)
    .sort((a, b) => a.registroMs - b.registroMs || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))
  const rankDe = new Map(conFecha.map((f, i) => [f.id, i + 1]))
  return [...filasDocente, ...filasBaja].map((f) => ({ ...f, rank: rankDe.get(f.id) ?? null }))
}
