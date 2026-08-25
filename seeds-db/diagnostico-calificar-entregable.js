const admin = require('firebase-admin')

const sa = require('./service-account.json')
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

// Tarifas Haiku 4.5 (Anthropic, en USD)
const HAIKU_IN_PER_MTK = 0.80   // $0.80 / 1M input tokens
const HAIKU_OUT_PER_MTK = 4.00  // $4.00 / 1M output tokens
const USD_TO_MXN = 19.5         // tipo de cambio aproximado

function costoUSD(tokIn, tokOut) {
  return (tokIn / 1e6) * HAIKU_IN_PER_MTK + (tokOut / 1e6) * HAIKU_OUT_PER_MTK
}

async function main() {
  const snap = await db.collection('iaConsumosInterno')
    .where('operacion', '==', 'calificar_entregable_ia')
    .get()

  const docs = snap.docs.map(d => d.data())
  console.log(`Total docs: ${docs.length}`)

  // Check ALL fields present across ALL docs
  const allFields = new Set()
  docs.forEach(d => Object.keys(d).forEach(k => allFields.add(k)))
  console.log('\nTodos los campos encontrados en el conjunto:')
  console.log([...allFields].sort().join(', '))

  // Por-doc: tokens, evidencias, modelo, uid
  console.log('\n--- Por doc (ordenado por tokensEntrada desc) ---')
  console.log('tokIn\ttokOut\tevidencias\tMXN_calc\tuid\tfecha')

  const sorted = docs
    .map(d => ({
      tokIn: d.tokensEntrada || 0,
      tokOut: d.tokensSalida || 0,
      evidencias: d.evidencias,
      uid: (d.uid || '?').replace('zztest-docente-ui-check', 'zztest'),
      ts: d.createdAt?.toDate?.()?.toISOString?.() || '?',
      modelo: d.modelo || '?',
    }))
    .sort((a, b) => b.tokIn - a.tokIn)

  for (const r of sorted) {
    const mxn = (costoUSD(r.tokIn, r.tokOut) * USD_TO_MXN).toFixed(4)
    console.log(`${r.tokIn}\t${r.tokOut}\t${r.evidencias}\t\t$${mxn}\t\t${r.uid}\t${r.ts}`)
  }

  // Análisis por número de evidencias
  const byEv = {}
  for (const d of docs) {
    const ev = d.evidencias ?? 'null'
    if (!byEv[ev]) byEv[ev] = []
    byEv[ev].push({ tokIn: d.tokensEntrada || 0, tokOut: d.tokensSalida || 0 })
  }

  console.log('\n--- Agrupado por campo evidencias ---')
  console.log('evidencias\tN\ttokIn_avg\ttokOut_avg\tMXN_avg')
  for (const [ev, items] of Object.entries(byEv).sort()) {
    const avgIn = items.reduce((a, b) => a + b.tokIn, 0) / items.length
    const avgOut = items.reduce((a, b) => a + b.tokOut, 0) / items.length
    const mxn = (costoUSD(avgIn, avgOut) * USD_TO_MXN).toFixed(4)
    console.log(`${ev}\t\t${items.length}\t${avgIn.toFixed(0)}\t\t${avgOut.toFixed(0)}\t\t$${mxn}`)
  }

  // Costo total del conjunto
  const totalIn = docs.reduce((a, d) => a + (d.tokensEntrada || 0), 0)
  const totalOut = docs.reduce((a, d) => a + (d.tokensSalida || 0), 0)
  const totalMXN = costoUSD(totalIn, totalOut) * USD_TO_MXN
  console.log(`\nTotal tokens in: ${totalIn} | out: ${totalOut}`)
  console.log(`Costo total estimado (${docs.length} calificaciones): $${totalMXN.toFixed(4)} MXN`)
  console.log(`Costo promedio por calificación: $${(totalMXN / docs.length).toFixed(4)} MXN`)

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
