// Diagnóstico: margen real por operación de IA.
//
// Cruza iaConsumosInterno (costo Anthropic en tokens + creditosReales cobrados)
// contra config/iaTarifas (tipo de cambio) y muestra la tabla de rentabilidad
// por operación que adminChat.rentabilidad_creditos calcula en tiempo real
// pero aquí se imprime directamente para revisión offline.
//
// Uso: node seeds-db/diagnostico-margen-operaciones.js [--desde YYYY-MM-DD] [--hasta YYYY-MM-DD]
//
// Sin flags usa los últimos 30 días.

const admin = require('firebase-admin')

const sa = require('./service-account.json')
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

const args = process.argv.slice(2)
const idx = (flag) => args.indexOf(flag)
const hasta = idx('--hasta') >= 0 ? new Date(args[idx('--hasta') + 1] + 'T23:59:59Z') : new Date()
const desde = idx('--desde') >= 0 ? new Date(args[idx('--desde') + 1] + 'T00:00:00Z') : new Date(hasta.getTime() - 30 * 24 * 60 * 60 * 1000)

// Tarifas Anthropic por modelo (USD / 1M tokens)
const TARIFAS_MODELO = {
  'claude-haiku-4-5-20251001': { in: 0.80, out: 4.00 },
  'claude-haiku-4-5':          { in: 0.80, out: 4.00 },
  'claude-sonnet-4-5':         { in: 3.00, out: 15.00 },
  'claude-sonnet-4-5-20251001':{ in: 3.00, out: 15.00 },
}
const FALLBACK_MODELO = { in: 0.80, out: 4.00 } // Haiku como default conservador

function costoUSDDoc(d) {
  const modelo = d.modelo || d.model || 'claude-haiku-4-5'
  const t = TARIFAS_MODELO[modelo] || FALLBACK_MODELO
  const tokIn  = (d.inputTokens  || d.tokensEntrada || 0)
  const tokOut = (d.outputTokens || d.tokensSalida  || 0)
  return (tokIn / 1e6) * t.in + (tokOut / 1e6) * t.out
}

function fmt2(n) { return n === null || n === undefined ? 'N/A' : n.toFixed(2) }
function fmt4(n) { return n === null || n === undefined ? 'N/A' : n.toFixed(4) }

async function main() {
  const tarifasSnap = await db.doc('config/iaTarifas').get()
  const tipoCambio  = tarifasSnap.data()?.tipoCambioUsdMxn || 19.5

  console.log(`\n=== MARGEN REAL POR OPERACIÓN ===`)
  console.log(`Período : ${desde.toISOString().slice(0,10)} → ${hasta.toISOString().slice(0,10)}`)
  console.log(`USD/MXN : ${tipoCambio}`)
  console.log()

  // Leer todos los consumos del período (el índice de Firestore no permite
  // range + equality simultáneos, así que filtramos por fecha solamente).
  const snap = await db.collection('iaConsumosInterno')
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(desde))
    .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(hasta))
    .get()

  if (snap.empty) {
    console.log('Sin consumos en este período.')
    return
  }

  // Agrupar por operación
  const ops = {}
  let sinCreditosReales = 0

  for (const doc of snap.docs) {
    const d = doc.data()
    const op = d.operacion || 'desconocida'
    if (!ops[op]) ops[op] = { llamadas: 0, creditosTotal: 0, costoUSDTotal: 0, sinCreditos: 0 }
    const g = ops[op]
    g.llamadas++

    if (d.creditosReales == null) {
      g.sinCreditos++
      sinCreditosReales++
    } else {
      g.creditosTotal += d.creditosReales
    }
    g.costoUSDTotal += costoUSDDoc(d)
  }

  // Compras reales del período (para precio efectivo por crédito)
  const comprasSnap = await db.collection('creditPurchases')
    .where('status', '==', 'completado')
    .get()
  const comprasEnRango = comprasSnap.docs.filter(d => {
    const t = d.data().createdAt?.toDate?.()
    return t && t >= desde && t <= hasta
  })
  const ingresoMXN    = comprasEnRango.reduce((a, d) => a + (d.data().montoMXN || 0), 0)
  const creditosVendidos = comprasEnRango.reduce((a, d) => a + (d.data().creditos || 0), 0)
  const precioEfectivo = creditosVendidos > 0 ? ingresoMXN / creditosVendidos : null  // MXN / crédito

  console.log(`Compras completadas  : ${comprasEnRango.length}  |  Créditos vendidos: ${fmt2(creditosVendidos)}  |  Ingreso: $${fmt2(ingresoMXN)} MXN`)
  if (precioEfectivo) {
    console.log(`Precio efectivo      : $${fmt4(precioEfectivo)} MXN/crédito (vs precio lista $1.00 base)`)
  } else {
    console.log(`Precio efectivo      : sin compras en el período — usando $1.00 MXN/crédito como referencia`)
  }
  console.log()

  // Tabla por operación
  const colW = [34, 8, 12, 12, 10, 10, 8]
  const header = ['Operación', 'Llam.', 'Créditos', 'Costo MXN', 'MXN/cred', 'Margen%', 'Sin CR']
  const sep = colW.map(w => '-'.repeat(w)).join('-+-')
  const row = (cells) => cells.map((c, i) => String(c).padStart(colW[i])).join(' | ')

  console.log(row(header))
  console.log(sep)

  const precio = precioEfectivo || 1.0 // fallback a precio lista

  const sortedOps = Object.entries(ops).sort((a, b) => b[1].creditosTotal - a[1].creditosTotal)
  let totalCreditos = 0, totalCostoUSD = 0, totalLlamadas = 0

  for (const [op, g] of sortedOps) {
    const costoMXN   = g.costoUSDTotal * tipoCambio
    const ingresoOp  = g.creditosTotal * precio
    const margen     = ingresoOp > 0 ? ((ingresoOp - costoMXN) / ingresoOp * 100) : null
    const costoXcred = g.creditosTotal > 0 ? (costoMXN / g.creditosTotal) : null

    console.log(row([
      op.slice(0, 33),
      g.llamadas,
      fmt2(g.creditosTotal),
      fmt2(costoMXN),
      costoXcred !== null ? fmt4(costoXcred) : 'N/A',
      margen !== null ? fmt2(margen) + '%' : 'N/A',
      g.sinCreditos > 0 ? g.sinCreditos : '',
    ]))

    totalCreditos  += g.creditosTotal
    totalCostoUSD  += g.costoUSDTotal
    totalLlamadas  += g.llamadas
  }

  console.log(sep)
  const totalCostoMXN = totalCostoUSD * tipoCambio
  const ingresoTotal  = totalCreditos * precio
  const margenTotal   = ingresoTotal > 0 ? ((ingresoTotal - totalCostoMXN) / ingresoTotal * 100) : null
  console.log(row([
    'TOTAL',
    totalLlamadas,
    fmt2(totalCreditos),
    fmt2(totalCostoMXN),
    totalCreditos > 0 ? fmt4(totalCostoMXN / totalCreditos) : 'N/A',
    margenTotal !== null ? fmt2(margenTotal) + '%' : 'N/A',
    sinCreditosReales > 0 ? sinCreditosReales : '',
  ]))
  console.log()

  if (sinCreditosReales > 0) {
    console.log(`⚠  ${sinCreditosReales} llamadas sin creditosReales (liquidación diferida pendiente o juego no confirmado).`)
    console.log(`   Esas llamadas ESTÁN incluidas en Llam. pero excluidas del cálculo de créditos y margen.`)
    console.log()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
