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
