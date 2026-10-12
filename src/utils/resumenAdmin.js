// Cálculos del Resumen del administrador sobre las compras de créditos de IA.
//
// Funciones PURAS: reciben los documentos de `creditPurchases` como argumento y
// devuelven resultados deterministas. No consultan Firebase, no tocan la red,
// no modifican lo que reciben y no dependen del estado de la aplicación.
//
// Modelo vigente: la plataforma base es gratuita y el único ingreso son los
// créditos de IA comprados. Reglas de este módulo:
//
//   · Solo las compras de `creditPurchases` con status 'completado' son venta.
//     Los pagos antiguos (`payments`) y las suscripciones NO entran aquí.
//   · Ingresos = suma de `montoMXN`. Créditos vendidos = suma de `creditos`.
//     Son dos cifras distintas (un paquete de 200 créditos cuesta $180).
//   · Las pendientes y las rechazadas se cuentan aparte y nunca suman.
//   · Los créditos de regalo y los ajustes manuales NO son ventas: no viven en
//     `creditPurchases`, y si un documento trae un `origen` que no es de venta
//     se aparta y se avisa, no se suma.
//   · Cada documento cuenta UNA vez (por id).
//   · El mes de un ingreso es el de `resueltoEn` (cuándo se aprobó), en la zona
//     de México — la misma que ya usa el panel de Costos de IA (costosIA.js).
//   · Lo que no se puede tomar como válido NO se convierte en ingreso: se aparta
//     y se reporta en `inconsistencias`, sin modificar el documento original.
//   · Las coincidencias de referencia + docente + créditos se señalan como
//     POSIBLES duplicados; no se descarta nada: pueden ser legítimas.
//
// LIMITACIÓN (documentada, no resuelta aquí): esto mide ventas registradas. No
// concilia el saldo de los docentes. Al comparar regalos, compras, saldo y
// consumo quedaron ~627.75 créditos sin explicar (ajustes manuales, saldos de
// planes anteriores, reembolsos…). Ninguna cifra de este módulo debe
// presentarse como «saldo conciliado».

import { claveDia } from './costosIA.js'

export const ALCANCE =
  'Ventas registradas en creditPurchases (compras completadas). No concilia saldo, ' +
  'créditos de regalo, ajustes manuales ni consumo.'

export const ESTADO = Object.freeze({
  COMPLETADO: 'completado',
  PENDIENTE: 'pendiente',
  RECHAZADO: 'rechazado',
})

// Único `origen` que hoy produce una venta (lo exige firestore.rules al crear).
export const ORIGEN_VENTA = 'creditos_adicionales'

export const MOTIVO = Object.freeze({
  DOCUMENTO_INVALIDO: 'documento_invalido',
  SIN_ID: 'sin_id',
  ID_REPETIDO: 'id_repetido',
  ORIGEN_NO_VENTA: 'origen_no_venta',
  ESTADO_DESCONOCIDO: 'estado_desconocido',
  IMPORTE_INVALIDO: 'importe_invalido',
  CREDITOS_INVALIDOS: 'creditos_invalidos',
  SIN_FECHA_RESOLUCION: 'sin_fecha_resolucion',
  FECHA_RESOLUCION_INVALIDA: 'fecha_resolucion_invalida',
})

// Una fecha fuera de este rango no es una fecha de compra creíble (p. ej. un 0
// que se vuelve 1970): se trata como inválida en vez de crear un mes absurdo.
const FECHA_MIN = Date.UTC(2000, 0, 1)
const FECHA_MAX = Date.UTC(2100, 0, 1)

// Acepta lo que de verdad llega de Firestore (Timestamp), un Date, el objeto
// plano { seconds, nanoseconds } o milisegundos. Todo lo demás (texto, NaN,
// objetos raros) es inválido: no se adivina.
function leerFecha(valor) {
  if (valor === null || valor === undefined) return { estado: 'ausente' }
  let d = null
  try {
    if (valor instanceof Date) d = valor
    else if (typeof valor === 'object' && typeof valor.toDate === 'function') d = valor.toDate()
    else if (typeof valor === 'object' && typeof valor.seconds === 'number') {
      const ms = typeof valor.nanoseconds === 'number' ? Math.floor(valor.nanoseconds / 1e6) : 0
      d = new Date(valor.seconds * 1000 + ms)
    } else if (typeof valor === 'number') d = new Date(valor)
  } catch {
    d = null
  }
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return { estado: 'invalida' }
  if (d.getTime() < FECHA_MIN || d.getTime() >= FECHA_MAX) return { estado: 'invalida' }
  return { estado: 'ok', fecha: d }
}

const esPositivo = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0

// Pesos a centavos enteros: sumar enteros evita que 0.1 + 0.2 ensucie el total.
const aCentavos = (pesos) => Math.round(pesos * 100)
const aPesos = (centavos) => centavos / 100

const textoLimpio = (v) => (typeof v === 'string' ? v.trim() : '')

// Misma referencia aunque cambien mayúsculas o espacios.
const normalizarReferencia = (v) => textoLimpio(v).replace(/\s+/g, ' ').toLowerCase()

// ── Paso común: clasifica cada documento una sola vez ──────────────────────
// Devuelve los documentos aceptables (sin duplicar por id, con origen de venta
// y estado conocido) más todo lo que se apartó y por qué.
function prepararCompras(compras, { origenesVenta = [ORIGEN_VENTA] } = {}) {
  const lista = Array.isArray(compras) ? compras : []
  const inconsistencias = []
  const aceptadas = []
  const idsVistos = new Set()
  const apartar = (id, motivo, detalle) => inconsistencias.push({ id: id ?? null, motivo, ...(detalle ? { detalle } : {}) })

  lista.forEach((c) => {
    if (c === null || typeof c !== 'object' || Array.isArray(c)) {
      apartar(null, MOTIVO.DOCUMENTO_INVALIDO)
      return
    }
    const id = typeof c.id === 'string' && c.id ? c.id : null
    if (id === null) {
      // Sin id no se puede garantizar «una vez por documento»: se cuenta, pero
      // queda avisado.
      apartar(null, MOTIVO.SIN_ID)
    } else if (idsVistos.has(id)) {
      apartar(id, MOTIVO.ID_REPETIDO)
      return
    } else {
      idsVistos.add(id)
    }

    if (!origenesVenta.includes(c.origen)) {
      apartar(id, MOTIVO.ORIGEN_NO_VENTA, c.origen === undefined ? 'sin origen' : String(c.origen))
      return
    }
    const estado = c.status
    if (estado !== ESTADO.COMPLETADO && estado !== ESTADO.PENDIENTE && estado !== ESTADO.RECHAZADO) {
      apartar(id, MOTIVO.ESTADO_DESCONOCIDO, estado === undefined ? 'sin estado' : String(estado))
      return
    }
    aceptadas.push({ id, doc: c, estado })
  })
  return { aceptadas, inconsistencias }
}

/**
 * Resumen completo de ventas de créditos.
 *
 * @param {Array<object>} compras  documentos de `creditPurchases` (con `id`).
 * @param {{ origenesVenta?: string[] }} [opciones]
 */
export function resumenCompras(compras, opciones = {}) {
  const { aceptadas, inconsistencias } = prepararCompras(compras, opciones)

  let pendientes = 0
  let rechazadas = 0
  let completadasExcluidas = 0
  let centavosTotal = 0
  let creditosTotal = 0
  let contables = 0
  const meses = new Map()
  let centavosSinMes = 0
  let creditosSinMes = 0
  let comprasSinMes = 0

  aceptadas.forEach(({ id, doc, estado }) => {
    if (estado === ESTADO.PENDIENTE) { pendientes++; return }
    if (estado === ESTADO.RECHAZADO) { rechazadas++; return }

    // Completada: solo es venta contable si importe y créditos son válidos. Se
    // exigen los dos para que ingresos y créditos salgan del mismo conjunto.
    if (!esPositivo(doc.montoMXN)) {
      inconsistencias.push({ id, motivo: MOTIVO.IMPORTE_INVALIDO })
      completadasExcluidas++
      return
    }
    if (!esPositivo(doc.creditos)) {
      inconsistencias.push({ id, motivo: MOTIVO.CREDITOS_INVALIDOS })
      completadasExcluidas++
      return
    }

    const centavos = aCentavos(doc.montoMXN)
    contables++
    centavosTotal += centavos
    creditosTotal += doc.creditos

    const resolucion = leerFecha(doc.resueltoEn)
    if (resolucion.estado !== 'ok') {
      // Es dinero real: entra en el total, pero no se le inventa un mes.
      inconsistencias.push({
        id,
        motivo: resolucion.estado === 'ausente' ? MOTIVO.SIN_FECHA_RESOLUCION : MOTIVO.FECHA_RESOLUCION_INVALIDA,
      })
      centavosSinMes += centavos
      creditosSinMes += doc.creditos
      comprasSinMes++
      return
    }
    const mes = claveDia(resolucion.fecha).slice(0, 7)
    const fila = meses.get(mes) || { mes, centavos: 0, creditosVendidos: 0, compras: 0 }
    fila.centavos += centavos
    fila.creditosVendidos += doc.creditos
    fila.compras++
    meses.set(mes, fila)
  })

  const ingresosPorMes = [...meses.values()]
    .sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0))
    .map((f) => ({ mes: f.mes, ingresosMXN: aPesos(f.centavos), creditosVendidos: f.creditosVendidos, compras: f.compras }))

  return {
    alcance: ALCANCE,
    ingresosMXN: aPesos(centavosTotal),
    creditosVendidos: creditosTotal,
    comprasCompletadas: contables,
    comprasPendientes: pendientes,
    comprasRechazadas: rechazadas,
    completadasExcluidas,
    ingresosPorMes,
    // Completadas sin un mes asignable: dentro de los totales, fuera de la serie.
    // ingresosMXN === suma(ingresosPorMes) + ingresosSinMesMXN.
    ingresosSinMesMXN: aPesos(centavosSinMes),
    creditosSinMes,
    comprasSinMes,
    posiblesDuplicados: agruparDuplicados(aceptadas),
    inconsistencias,
  }
}

// Mismo docente + mismos créditos + misma referencia (normalizada). Se miran
// todos los estados: reenviar tras un rechazo es legítimo y se muestra, pero
// `requiereRevision` solo se activa si hay DOS O MÁS completadas — ahí es donde
// un ingreso podría estar contado dos veces. Nada se elimina de los totales.
function agruparDuplicados(aceptadas) {
  const grupos = new Map()
  aceptadas.forEach(({ id, doc, estado }) => {
    const referencia = normalizarReferencia(doc.referencia)
    const docenteId = textoLimpio(doc.docenteId)
    if (!referencia || !docenteId || !esPositivo(doc.creditos)) return
    const clave = `${docenteId}|${doc.creditos}|${referencia}`
    const g = grupos.get(clave) || { clave, referencia: textoLimpio(doc.referencia), docenteId, creditos: doc.creditos, compras: [] }
    g.compras.push({ id, status: estado })
    grupos.set(clave, g)
  })
  return [...grupos.values()]
    .filter((g) => g.compras.length >= 2)
    .map((g) => {
      const completadas = g.compras.filter((c) => c.status === ESTADO.COMPLETADO).length
      return { ...g, completadas, requiereRevision: completadas >= 2 }
    })
    .sort((a, b) => Number(b.requiereRevision) - Number(a.requiereRevision))
}

// ── Cifras sueltas (cada una sale del mismo análisis) ─────────────────────
export const creditosVendidos = (compras, opciones) => resumenCompras(compras, opciones).creditosVendidos
export const ingresosTotales = (compras, opciones) => resumenCompras(compras, opciones).ingresosMXN
export const ingresosPorMes = (compras, opciones) => resumenCompras(compras, opciones).ingresosPorMes
export const comprasPendientes = (compras, opciones) => resumenCompras(compras, opciones).comprasPendientes
export const comprasCompletadas = (compras, opciones) => resumenCompras(compras, opciones).comprasCompletadas
export const posiblesDuplicados = (compras, opciones) => resumenCompras(compras, opciones).posiblesDuplicados

// ════════════════════════════════════════════════════════════════════════════
// Etapa 2B — estudiantes, registros, meses, indicadores y avisos del Resumen.
// Siguen siendo funciones puras: reciben los datos y la fecha actual como
// argumentos (nada de `new Date()` aquí dentro, para que sean deterministas).
// ════════════════════════════════════════════════════════════════════════════

// ── Meses (zona de México, la del resto del panel) ─────────────────────────

const aDate = (v) => {
  const l = leerFecha(v)
  return l.estado === 'ok' ? l.fecha : null
}

/** 'YYYY-MM' de un instante, en la zona de México; null si no es una fecha válida. */
export function mesDe(fecha) {
  const d = aDate(fecha)
  return d ? claveDia(d).slice(0, 7) : null
}

/** Mes en curso ('YYYY-MM') a partir de `ahora`, que se inyecta. */
export const mesActual = (ahora) => mesDe(ahora)

/** Los `cantidad` meses que terminan en el de `ahora`, del más viejo al más nuevo. */
export function ultimosMeses(cantidad, ahora) {
  const actual = mesActual(ahora)
  if (!actual || !Number.isInteger(cantidad) || cantidad < 1) return []
  let [y, m] = actual.split('-').map(Number)
  const meses = []
  for (let i = 0; i < cantidad; i++) {
    meses.unshift(`${y}-${String(m).padStart(2, '0')}`)
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
  }
  return meses
}

/** Una fila por mes pedido; los meses sin movimiento valen 0 (dato confirmado, no ausente). */
export function rellenarMeses(meses, filas, campo) {
  const lista = Array.isArray(filas) ? filas : []
  return (Array.isArray(meses) ? meses : []).map((mes) => {
    const fila = lista.find((f) => f && f.mes === mes)
    const valor = fila && typeof fila[campo] === 'number' ? fila[campo] : 0
    return { mes, valor }
  })
}

// ── Estudiantes: personas, no inscripciones ────────────────────────────────

/**
 * Identidad de una persona: usuario + escuela, en minúsculas. Es la misma regla
 * de la tabla de Registros (contarEstudiantesPorDocente): cada asignatura es
 * un documento aparte de `students`, pero la persona es la misma.
 */
export function claveEstudiante(s) {
  if (!s || typeof s !== 'object' || typeof s.username !== 'string' || !s.username.trim()) return null
  return `${s.username.trim().toLowerCase()}|${String(s.escuelaId || '').trim().toLowerCase()}`
}

/**
 * Cuenta personas distintas. Una persona está «activada» si tiene AL MENOS una
 * inscripción activada; las que tienen unas sí y otras no se cuentan como
 * activadas y se identifican en `mixtas`. Quien solo está ligado a un docente
 * que ya no existe se CUENTA y se identifica en `soloDeDocenteInexistente`.
 *
 * @param {Array<object>} students  documentos de `students`
 * @param {{ subjectsMap?: object, docentesIds?: Set<string>|string[] }} [opciones]
 */
export function estudiantesUnicos(students, { subjectsMap = {}, docentesIds = null } = {}) {
  const lista = Array.isArray(students) ? students : []
  const existentes = docentesIds ? new Set(docentesIds) : null
  const personas = new Map()
  let inscripciones = 0
  let documentosInvalidos = 0

  lista.forEach((s, i) => {
    if (s === null || typeof s !== 'object' || Array.isArray(s)) { documentosInvalidos++; return }
    inscripciones++
    // Sin usuario no hay identidad común: cada documento es una persona, como ya
    // hace la tabla de Registros.
    const clave = claveEstudiante(s) || `doc:${typeof s.id === 'string' ? s.id : `#${i}`}`
    const docente = (subjectsMap && subjectsMap[s.asignaturaId]?.docenteId) || s.docenteId || null
    const p = personas.get(clave) || { clave, inscripciones: 0, activadas: 0, docentes: [] }
    p.inscripciones++
    if (s.activado === true) p.activadas++
    p.docentes.push(docente)
    personas.set(clave, p)
  })

  let activadas = 0
  const mixtas = []
  const soloDeDocenteInexistente = []
  let sinDocenteResoluble = 0
  personas.forEach((p) => {
    if (p.activadas > 0) activadas++
    if (p.activadas > 0 && p.activadas < p.inscripciones) {
      mixtas.push({ clave: p.clave, inscripciones: p.inscripciones, activadas: p.activadas })
    }
    const conocidos = p.docentes.filter(Boolean)
    if (conocidos.length === 0) sinDocenteResoluble++
    else if (existentes && conocidos.every((d) => !existentes.has(d))) {
      soloDeDocenteInexistente.push({ clave: p.clave })
    }
  })

  return {
    inscripciones,
    personas: personas.size,
    activadas,
    sinActivar: personas.size - activadas,
    mixtas,
    soloDeDocenteInexistente,
    sinDocenteResoluble,
    documentosInvalidos,
  }
}

// ── Registros: fecha de creación de Firebase Authentication ───────────────

// Auth entrega la fecha como TEXTO (p. ej. «Tue, 11 Aug 2026 14:03:00 GMT»).
// Para compras se exige un Timestamp (leerFecha); aquí se acepta además texto
// que JavaScript sepa leer y que caiga en un rango creíble.
function leerFechaAuth(valor) {
  if (typeof valor === 'string') {
    const t = valor.trim()
    if (!t) return null
    return aDate(new Date(t))
  }
  return aDate(valor)
}

/**
 * Registros de docentes por mes de creación en Auth. `creadoEn` es el mapa
 * { uid: fecha } que devuelve /api/admin/last-access. Solo se cuentan los
 * `docentesIds`; los que no traen una fecha válida van en `sinFecha` y NO se
 * asignan a ningún mes.
 */
export function registrosPorMes(creadoEn, docentesIds) {
  const mapa = creadoEn && typeof creadoEn === 'object' ? creadoEn : {}
  const meses = new Map()
  let conFecha = 0
  let sinFecha = 0
  ;(Array.isArray(docentesIds) ? docentesIds : []).forEach((id) => {
    const d = leerFechaAuth(mapa[id])
    if (!d) { sinFecha++; return }
    conFecha++
    const mes = claveDia(d).slice(0, 7)
    meses.set(mes, (meses.get(mes) || 0) + 1)
  })
  const porMes = [...meses.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([mes, registros]) => ({ mes, registros }))
  return { porMes, conFecha, sinFecha }
}

// ── Indicadores y avisos del Resumen ───────────────────────────────────────

const MOTIVOS_DE_DOCUMENTO = [
  MOTIVO.DOCUMENTO_INVALIDO, MOTIVO.SIN_ID, MOTIVO.ID_REPETIDO, MOTIVO.ORIGEN_NO_VENTA, MOTIVO.ESTADO_DESCONOCIDO,
]

const plural = (n, uno, varios) => (n === 1 ? uno : varios)

const FORMATO_HORA = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false })
const FORMATO_DIA_CORTO = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'short' })

/**
 * Cuándo se hizo la última consulta correcta a Firebase Authentication, para
 * decirlo en un aviso («…a la consulta de las 14:35»): «de las 14:35» si fue hoy
 * (hora de México) o «del 11 oct a las 14:35» si fue otro día. null si no hay una
 * fecha válida: nunca se inventa una hora.
 */
export function cuandoConsultaAuth(actualizadoEn, ahora) {
  const d = aDate(actualizadoEn)
  if (!d) return null
  const hora = FORMATO_HORA.format(d)
  const hoy = mesDe(ahora) !== null && claveDia(aDate(ahora)) === claveDia(d)
  return hoy ? `de las ${hora}` : `del ${FORMATO_DIA_CORTO.format(d).replace('.', '')} a las ${hora}`
}

/**
 * Todo lo que pinta el Resumen, calculado de una vez.
 *
 * Lo que depende de Firebase Authentication (registros) vale `null` mientras no
 * haya un dato confirmado — la pantalla debe mostrar «—», nunca un 0.
 *
 * @param {object} p
 * @param {Array<object>} p.docentes     usuarios con role 'docente' (con `id`)
 * @param {Array<object>} p.students     documentos de `students`
 * @param {object}        [p.subjectsMap]
 * @param {Array<object>} p.compras      documentos de `creditPurchases`
 * @param {object|null}   p.creadoEn     { uid: fecha } de Auth
 * @param {boolean}       p.authDisponible  ¿hay datos de Auth confirmados?
 * @param {string}        [p.authEstado] 'cargando' | 'listo' | 'agotado' | 'error'
 * @param {boolean}       [p.authObsoleto]  la última consulta falló (o se agotó) DESPUÉS de
 *                        una correcta: se conservan los datos anteriores y se avisa
 * @param {Date|number|null} [p.authActualizadoEn] cuándo terminó la última consulta correcta
 * @param {Date|number}   p.ahora        instante actual (se inyecta)
 * @param {number}        [p.cantidadMeses=6]
 */
export function kpisResumen({
  docentes, students, subjectsMap = {}, compras, creadoEn = null,
  authDisponible = false, authEstado = 'cargando', authObsoleto = false, authActualizadoEn = null,
  ahora, cantidadMeses = 6,
}) {
  const listaDocentes = Array.isArray(docentes) ? docentes : []
  const idsDocentes = listaDocentes.map((d) => d && d.id).filter((id) => typeof id === 'string' && id)
  const ventas = resumenCompras(compras)
  const est = estudiantesUnicos(students, { subjectsMap, docentesIds: idsDocentes })
  const mes = mesActual(ahora)
  const meses = ultimosMeses(cantidadMeses, ahora)
  const reg = authDisponible ? registrosPorMes(creadoEn, idsDocentes) : null
  const filaMes = ventas.ingresosPorMes.find((f) => f.mes === mes)

  const avisos = []
  const aviso = (id, nivel, texto, detalle) => avisos.push({ id, nivel, texto, ...(detalle && detalle.length ? { detalle } : {}) })

  const dupes = ventas.posiblesDuplicados.filter((g) => g.requiereRevision)
  if (dupes.length) {
    aviso('duplicados', 'revisar',
      `${dupes.length} ${plural(dupes.length, 'posible compra duplicada', 'posibles compras duplicadas')}: misma referencia, docente y créditos en 2 o más compras completadas. Ninguna se descartó; revísalas en «Compras de créditos».`,
      dupes.map((g) => `${g.referencia} · ${g.creditos} créditos`))
  }
  if (ventas.completadasExcluidas > 0) {
    aviso('excluidas', 'revisar',
      `${ventas.completadasExcluidas} ${plural(ventas.completadasExcluidas, 'compra completada', 'compras completadas')} con importe o créditos no válidos no ${plural(ventas.completadasExcluidas, 'cuenta', 'cuentan')} en las ventas.`)
  }
  if (ventas.comprasSinMes > 0) {
    aviso('sin-mes', 'revisar',
      `${ventas.comprasSinMes} ${plural(ventas.comprasSinMes, 'compra completada', 'compras completadas')} sin fecha de resolución válida: ${plural(ventas.comprasSinMes, 'cuenta', 'cuentan')} en el total ($${ventas.ingresosSinMesMXN}) pero en ningún mes.`)
  }
  const apartados = ventas.inconsistencias.filter((i) => MOTIVOS_DE_DOCUMENTO.includes(i.motivo)).length
  if (apartados > 0) {
    aviso('apartados', 'revisar',
      `${apartados} ${plural(apartados, 'documento de compras apartado', 'documentos de compras apartados')} por origen, estado o identificador no reconocido; no ${plural(apartados, 'suma', 'suman')} a las ventas.`)
  }
  if (!authDisponible && (authEstado === 'agotado' || authEstado === 'error')) {
    aviso('auth', 'revisar',
      'No se pudo consultar la fecha de registro en Firebase Authentication; los indicadores de registros se muestran como «—».')
  }
  if (authDisponible && authObsoleto) {
    const cuando = cuandoConsultaAuth(authActualizadoEn, ahora)
    aviso('auth-obsoleto', 'revisar',
      `No se pudo actualizar Firebase Authentication: las fechas de registro y los últimos accesos que se muestran corresponden a la consulta ${cuando || 'anterior'}. Se conservan hasta que una nueva consulta termine bien.`)
  }
  if (reg && reg.sinFecha > 0) {
    aviso('registros-sin-fecha', 'revisar',
      `${reg.sinFecha} ${plural(reg.sinFecha, 'docente', 'docentes')} sin fecha de registro en Firebase Authentication: ${plural(reg.sinFecha, 'no entra', 'no entran')} en ningún mes.`)
  }
  if (est.soloDeDocenteInexistente.length) {
    const n = est.soloDeDocenteInexistente.length
    aviso('docente-inexistente', 'revisar',
      `${n} ${plural(n, 'estudiante vinculado solo a un docente que ya no existe', 'estudiantes vinculados solo a docentes que ya no existen')}; ${plural(n, 'se cuenta', 'se cuentan')} en el total.`,
      est.soloDeDocenteInexistente.slice(0, 10).map((p) => p.clave))
  }
  if (est.mixtas.length) {
    const n = est.mixtas.length
    aviso('mixtas', 'info',
      `${n} ${plural(n, 'estudiante tiene', 'estudiantes tienen')} inscripciones activadas y no activadas a la vez; ${plural(n, 'se cuenta', 'se cuentan')} como ${plural(n, 'activado', 'activados')}.`,
      est.mixtas.slice(0, 10).map((p) => `${p.clave} (${p.activadas} de ${p.inscripciones})`))
  }
  if (est.sinDocenteResoluble > 0) {
    aviso('sin-docente', 'info',
      `${est.sinDocenteResoluble} ${plural(est.sinDocenteResoluble, 'estudiante sin docente identificable', 'estudiantes sin docente identificable')}; ${plural(est.sinDocenteResoluble, 'se cuenta', 'se cuentan')} en el total.`)
  }
  avisos.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'revisar' ? -1 : 1))

  return {
    alcance: ALCANCE,
    mes,
    docentes: idsDocentes.length,
    estudiantes: {
      inscripciones: est.inscripciones,
      personas: est.personas,
      activadas: est.activadas,
      sinActivar: est.sinActivar,
    },
    ventas: {
      creditosVendidos: ventas.creditosVendidos,
      ingresosMXN: ventas.ingresosMXN,
      completadas: ventas.comprasCompletadas,
      pendientes: ventas.comprasPendientes,
      rechazadas: ventas.comprasRechazadas,
    },
    delMes: {
      mes,
      // null = todavía sin dato confirmado de Auth; la pantalla pone «—».
      registros: reg && mes ? (reg.porMes.find((f) => f.mes === mes)?.registros ?? 0) : null,
      compras: filaMes ? filaMes.compras : 0,
      ingresosMXN: filaMes ? filaMes.ingresosMXN : 0,
      creditosVendidos: filaMes ? filaMes.creditosVendidos : 0,
    },
    series: {
      meses,
      registros: reg ? rellenarMeses(meses, reg.porMes, 'registros') : null,
      ingresos: rellenarMeses(meses, ventas.ingresosPorMes, 'ingresosMXN'),
    },
    avisos,
  }
}
