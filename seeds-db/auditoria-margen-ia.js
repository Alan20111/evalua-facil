// Auditoría de margen IA — lee config/iaTarifas y los últimos 50 iaConsumosInterno
// y calcula si cada operación genera ganancia o pérdida.
//
// Uso: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node auditoria-margen-ia.js

const admin = require('firebase-admin')
const sa = require('./service-account.json')
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

const USD_MXN = 18.5

// Tarifas Anthropic por modelo (USD / 1M tokens)
const MODELOS = {
  'claude-haiku-4-5-20251001': { in: 0.80,  out: 4.00  },
  'claude-haiku-4-5':          { in: 0.80,  out: 4.00  },
  'claude-sonnet-4-5-20251001':{ in: 3.00,  out: 15.00 },
  'claude-sonnet-4-5':         { in: 3.00,  out: 15.00 },
  'claude-sonnet-4-6':         { in: 3.00,  out: 15.00 },
}
const FALLBACK = { in: 0.80, out: 4.00 }

function costoUSD(d) {
  const t = MODELOS[d.modelo || d.model] || FALLBACK
  return ((d.inputTokens || d.tokensEntrada || 0) / 1e6) * t.in
       + ((d.outputTokens || d.tokensSalida || 0) / 1e6) * t.out
}

function pct(num, den) {
  if (!den || den === 0) return null
  return (num / den * 100).toFixed(1) + '%'
}
function mxn(n) { return n == null ? 'N/A' : '$' + n.toFixed(4) }
// eslint-disable-next-line no-unused-vars
function cr(n)  { return n == null ? 'N/A' : n.toFixed(3) }

async function main() {
  // 1 — Tarifas vigentes
  const tarifasSnap = await db.doc('config/iaTarifas').get()
  const tarifasData = tarifasSnap.data()
  const tarifas = tarifasData?.tarifas || {}
  const version = tarifasData?.version || '?'

  console.log(`\n=== TARIFAS VIGENTES (config/iaTarifas v${version}) ===`)
  console.log('Operación'.padEnd(38) + 'Créditos')
  console.log('-'.repeat(50))
  for (const [op, cr] of Object.entries(tarifas).sort()) {
    console.log(op.padEnd(38) + cr)
  }

  // 2 — Últimos 50 iaConsumosInterno
  const snap = await db.collection('iaConsumosInterno')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()

  if (snap.empty) { console.log('\nSin documentos en iaConsumosInterno.'); return }

  console.log(`\n=== ÚLTIMOS ${snap.size} REGISTROS DE iaConsumosInterno ===`)
  console.log(`USD/MXN: $${USD_MXN}\n`)

  // Agrupar por operación
  const grupos = {}
  let sinCreditosReales = 0

  for (const doc of snap.docs) {
    const d = doc.data()
    const op = d.operacionEfectiva || d.operacion || 'desconocida'
    if (!grupos[op]) grupos[op] = {
      llamadas: 0, costoUSDTotal: 0,
      creditosTotal: 0, sinCR: 0,
      modelos: new Set()
    }
    const g = grupos[op]
    g.llamadas++
    g.costoUSDTotal += costoUSD(d)
    if (d.modelo || d.model) g.modelos.add(d.modelo || d.model)

    if (d.creditosReales == null) { g.sinCR++; sinCreditosReales++ }
    else g.creditosTotal += d.creditosReales
  }

  // 3 — Tabla comparativa
  // Precio de referencia: $1.00 MXN / crédito (precio lista sin descuento)
  const PRECIO_CR_MXN = 1.0

  const cols = [36, 7, 10, 10, 10, 9, 7]
  const head = ['Operación', 'Llam.', 'Costo MXN', 'Ingr. MXN', 'MXN/CR', 'Margen', 'Sin CR']
  const sep  = cols.map(w => '-'.repeat(w)).join('-+-')
  const row  = cells => cells.map((c, i) => String(c).padStart(cols[i])).join(' | ')

  console.log(row(head))
  console.log(sep)

  const alertas = []
  let totCosto = 0, totIngreso = 0, totLlamadas = 0

  for (const [op, g] of Object.entries(grupos).sort((a,b) => b[1].costoUSDTotal - a[1].costoUSDTotal)) {
    const costoMXN   = g.costoUSDTotal * USD_MXN
    const ingresoMXN = g.creditosTotal * PRECIO_CR_MXN
    const margenPct  = g.creditosTotal > 0 ? pct(ingresoMXN - costoMXN, ingresoMXN) : null
    const costoPorCr = g.creditosTotal > 0 ? costoMXN / g.creditosTotal : null
    const tarifaVigente = tarifas[op]

    // Señal de alerta
    const margenNum = g.creditosTotal > 0 ? (ingresoMXN - costoMXN) / ingresoMXN * 100 : null
    if (margenNum !== null && margenNum < 50) {
      alertas.push({ op, margenNum, costoMXN, ingresoMXN, tarifaVigente, costoPorCr })
    }
    if (g.sinCR === g.llamadas && tarifaVigente > 0) {
      alertas.push({ op, sinCR: true, tarifaVigente })
    }

    console.log(row([
      op.slice(0, 35),
      g.llamadas,
      mxn(costoMXN / g.llamadas) + '/c',
      g.creditosTotal > 0 ? mxn(ingresoMXN / g.llamadas) + '/c' : 'N/A',
      costoPorCr !== null ? mxn(costoPorCr) : 'N/A',
      margenPct || 'N/A',
      g.sinCR > 0 ? g.sinCR : '',
    ]))

    totCosto   += costoMXN
    totIngreso += ingresoMXN
    totLlamadas += g.llamadas
  }

  console.log(sep)
  console.log(row([
    'TOTAL',
    totLlamadas,
    mxn(totCosto / totLlamadas) + '/c',
    totIngreso > 0 ? mxn(totIngreso / totLlamadas) + '/c' : 'N/A',
    '',
    totIngreso > 0 ? pct(totIngreso - totCosto, totIngreso) : 'N/A',
    sinCreditosReales > 0 ? sinCreditosReales : '',
  ]))

  if (sinCreditosReales > 0) {
    console.log(`\n⚠  ${sinCreditosReales}/${snap.size} registros sin creditosReales`)
    console.log('   (operaciones anteriores al commit #1303 o liquidación diferida pendiente)')
    console.log('   El ingreso y el margen de esas filas no pueden calcularse.')
  }

  // 4 — Alertas
  if (alertas.length) {
    console.log('\n=== ALERTAS (margen < 50% o sin datos suficientes) ===')
    for (const a of alertas) {
      if (a.sinCR) {
        console.log(`  ⚠  ${a.op}: tarifa ${a.tarifaVigente} cr — todos los registros sin creditosReales (no se puede medir margen)`)
      } else {
        const signo = a.margenNum < 0 ? '🔴' : '🟡'
        console.log(`  ${signo} ${a.op}: margen ${a.margenNum.toFixed(1)}% — costo $${(a.costoMXN/1).toFixed(4)} MXN/cr vs ingreso $${(a.ingresoMXN/1).toFixed(4)} MXN/cr (tarifa: ${a.tarifaVigente} cr)`)
      }
    }
  } else {
    console.log('\n✅ Sin alertas — todas las operaciones con datos tienen margen ≥ 50%.')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
