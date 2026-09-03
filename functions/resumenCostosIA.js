// Resumen diario de costo de IA e ingresos por venta de créditos, para el
// apartado "Costos de IA" del panel de administración (3-sep-2026).
//
// Por qué es un callable y no una lectura del cliente:
//
//   1. SEGURIDAD. `iaConsumosInterno` es `allow read, write: if false` para
//      TODO cliente, admin incluido, y esa regla no se toca: cada documento
//      lleva el uid del docente junto a sus tokens. Aquí se lee con el Admin
//      SDK (que no pasa por las reglas) y solo salen totales POR DÍA — ni un
//      uid, ni un correo, ni un nombre, ni consumo individual.
//   2. VOLUMEN. Esa colección crece una fila por cada llamada de IA, sin
//      techo. Bajarla completa al navegador funciona con cientos de
//      documentos y es inviable con cientos de miles; la agregación pertenece
//      al servidor desde el primer día.
//
// El costo NO se recalcula con una fórmula propia: usa `calcularCostoUSD` de
// _shared/costosIA.js, la MISMA que usa la herramienta `consumo_ia` del Chat
// de Administración. Por eso los dos coinciden al centavo para el mismo
// periodo — es literalmente el mismo código, no dos implementaciones que
// esperamos que concuerden.
//
// Evolución futura (NO hace falta hoy, 354 documentos): si la colección
// crece hasta que un rango de 90 días sea caro de leer, el siguiente paso es
// una colección de totales diarios ya sumados que este callable consulte en
// vez de recorrer los consumos. La forma de la respuesta no tendría que
// cambiar, así que el panel no se enteraría.

const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getFirestore } = require('firebase-admin/firestore')
const logger = require('firebase-functions/logger')
const {
  calcularCostoUSD, claveDia, rangoDeDias,
  margenSobreCostoIA, costoPromedioDiario, RANGOS_DIAS,
} = require('./_shared/costosIA')

// Espejo de obtenerConfigCostos en adminChat.js. Se lee por invocación a
// propósito: una instancia tibia puede atender a admins distintos, y cachear
// a nivel de módulo serviría precios viejos hasta el siguiente arranque en
// frío.
async function obtenerConfigCostos(db) {
  const snap = await db.doc('config/iaTarifas').get()
  const data = snap.data() || {}
  return {
    costosPorModelo: data.costosAnthropicUSD || {},
    tipoCambioUsdMxn: typeof data.tipoCambioUsdMxn === 'number' ? data.tipoCambioUsdMxn : null,
  }
}

function filaVacia() {
  return {
    llamadas: 0, tokensEntrada: 0, tokensSalida: 0,
    costoUSD: 0, ingresosMXN: 0, comprasCompletadas: 0, creditosVendidos: 0,
    llamadasSinTarifa: 0,
  }
}

// Suma un documento de consumo (de docente o del Chat de Admin: las dos
// colecciones tienen la misma forma) en la fila de su día.
function acumularConsumo(filas, doc, costosPorModelo) {
  const c = doc.data()
  const dia = claveDia(c.createdAt?.toDate?.())
  const fila = dia && filas.get(dia)
  // Documento fuera del rango pedido o sin createdAt (los hay: registros
  // parciales de borradores cancelados). No se fuerza a ningún día: inventar
  // una fecha ensuciaría la serie.
  if (!fila) return
  fila.llamadas++
  fila.tokensEntrada += c.tokensEntrada || 0
  fila.tokensSalida += c.tokensSalida || 0
  const costo = calcularCostoUSD(c, costosPorModelo)
  // `null` = el modelo de ese registro no tiene tarifa configurada. Se cuenta
  // aparte y NO se suma como cero: el panel debe poder decir "hay llamadas
  // que no sé costear" en vez de reportar un costo callado a la baja.
  if (costo == null) fila.llamadasSinTarifa++
  else fila.costoUSD += costo
}

/**
 * Serie diaria de costo de IA e ingresos. Solo lectura.
 *
 * @param {number} dias  7, 30 o 90.
 * @returns filas por día + totales del periodo. Sin datos personales.
 */
async function resumenDiario({ db, dias, ahora = new Date() }) {
  const { claves, desde, hasta } = rangoDeDias(dias, ahora)
  const { costosPorModelo, tipoCambioUsdMxn } = await obtenerConfigCostos(db)

  const filas = new Map(claves.map((k) => [k, filaVacia()]))

  const [consumoDocentes, consumoAdmin, compras] = await Promise.all([
    db.collection('iaConsumosInterno').where('createdAt', '>=', desde).where('createdAt', '<=', hasta).get(),
    db.collection('adminChatConsumosInterno').where('createdAt', '>=', desde).where('createdAt', '<=', hasta).get(),
    // Ingresos: se acota por `resueltoEn` (cuándo se aprobó la compra, que es
    // cuando el dinero se reconoce) y NO por createdAt (cuándo el docente
    // subió su comprobante). Una transferencia enviada el día 1 y aprobada el
    // día 3 es ingreso del día 3.
    //
    // Rango sobre UN campo: se resuelve con el índice de campo único que
    // Firestore mantiene solo, sin índice compuesto que desplegar a mano. El
    // filtro de `status` se aplica en memoria sobre un conjunto ya acotado
    // por fecha — y las compras son de un volumen ínfimo comparado con las
    // llamadas de IA. Además, las compras sin resolver no tienen `resueltoEn`
    // y Firestore las excluye sola de un rango sobre ese campo: exactamente
    // lo que queremos.
    db.collection('creditPurchases').where('resueltoEn', '>=', desde).where('resueltoEn', '<=', hasta).get(),
  ])

  consumoDocentes.forEach((d) => acumularConsumo(filas, d, costosPorModelo))
  consumoAdmin.forEach((d) => acumularConsumo(filas, d, costosPorModelo))

  compras.forEach((d) => {
    const c = d.data()
    // SOLO 'completado' es ingreso. Una compra pendiente todavía no es
    // dinero, y una rechazada nunca lo fue.
    if (c.status !== 'completado') return
    const dia = claveDia(c.resueltoEn?.toDate?.())
    const fila = dia && filas.get(dia)
    if (!fila) return
    fila.ingresosMXN += c.montoMXN || 0
    fila.creditosVendidos += c.creditos || 0
    fila.comprasCompletadas++
  })

  const tc = tipoCambioUsdMxn
  const dias_ = claves.map((fecha) => {
    const f = filas.get(fecha)
    // El costo se expone en MXN solo si hay tipo de cambio configurado; sin
    // él, null — nunca un cero que se leería como "no costó nada".
    const costoIAMXN = tc != null ? Math.round(f.costoUSD * tc * 100) / 100 : null
    return {
      fecha,
      llamadas: f.llamadas,
      tokensEntrada: f.tokensEntrada,
      tokensSalida: f.tokensSalida,
      costoIAUSD: Math.round(f.costoUSD * 10000) / 10000,
      costoIAMXN,
      ingresosMXN: Math.round(f.ingresosMXN * 100) / 100,
      margenMXN: costoIAMXN == null ? null : margenSobreCostoIA(f.ingresosMXN, costoIAMXN),
      comprasCompletadas: f.comprasCompletadas,
      creditosVendidos: f.creditosVendidos,
      llamadasSinTarifa: f.llamadasSinTarifa,
    }
  })

  const suma = (campo) => dias_.reduce((a, d) => a + (d[campo] || 0), 0)
  const costoTotalUSD = Math.round(suma('costoIAUSD') * 10000) / 10000
  const costoTotalMXN = tc != null ? Math.round(costoTotalUSD * tc * 100) / 100 : null
  const ingresosTotalMXN = Math.round(suma('ingresosMXN') * 100) / 100

  return {
    dias: dias_,
    totales: {
      diasDelPeriodo: claves.length,
      llamadas: suma('llamadas'),
      tokensEntrada: suma('tokensEntrada'),
      tokensSalida: suma('tokensSalida'),
      costoIAUSD: costoTotalUSD,
      costoIAMXN: costoTotalMXN,
      ingresosMXN: ingresosTotalMXN,
      margenMXN: costoTotalMXN == null ? null : margenSobreCostoIA(ingresosTotalMXN, costoTotalMXN),
      costoPromedioDiarioMXN: costoTotalMXN == null ? null : costoPromedioDiario(costoTotalMXN, claves.length),
      comprasCompletadas: suma('comprasCompletadas'),
      creditosVendidos: suma('creditosVendidos'),
      llamadasSinTarifa: suma('llamadasSinTarifa'),
    },
    tipoCambioUsdMxnUsado: tc,
    // Nota que viaja CON los datos, no solo en la interfaz: el costo sale de
    // nuestros propios registros de tokens por la tarifa configurada, no de
    // la factura de Anthropic, y el margen es sobre el costo de IA
    // ÚNICAMENTE — sin Firebase, Vercel, Cloudinary ni comisiones de cobro.
    nota: 'costoIA es ESTIMADO a partir de los tokens que registramos y de config/iaTarifas.costosAnthropicUSD — no es la factura de Anthropic. margen = ingresos - costo de IA: es margen sobre el costo de IA únicamente, nunca ganancia neta (no incluye Firebase, Vercel, Cloudinary ni comisiones de cobro). ingresos son compras de creditPurchases con status completado, fechadas por resueltoEn.',
  }
}

exports.resumenCostosIA = onCall(async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para continuar')

  const db = getFirestore()
  // Rol verificado SIEMPRE server-side, igual que chatAdmin y
  // ajustarSaldoCreditosIA. Un docente que llame este callable directo,
  // saltándose la interfaz, se topa con esto ANTES de que se lea un solo
  // documento de métricas internas.
  const perfil = await db.doc(`users/${uid}`).get()
  if (!perfil.exists || perfil.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Este resumen es exclusivo del equipo administrador')
  }

  // El rango viene del cliente pero NO se confía en él: solo se aceptan los
  // tres valores que ofrece el panel, así que nadie puede pedir un rango
  // arbitrario que obligue a leer la colección entera.
  const pedido = Number(request.data?.dias)
  const dias = RANGOS_DIAS.includes(pedido) ? pedido : 30

  try {
    return await resumenDiario({ db, dias })
  } catch (e) {
    logger.error(`resumenCostosIA(${dias}):`, e.message)
    throw new HttpsError('internal', 'No se pudo calcular el resumen de costos')
  }
})

// Gancho de prueba: expone la agregación pura de Firestore para poder
// probarla contra el emulador sin pasar por el callable (mismo criterio que
// `__test` en adminChat.js). No lo usa producción.
exports.__test = { resumenDiario, obtenerConfigCostos }
