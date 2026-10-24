// Verificador de consistencia de los créditos de IA — SOLO LECTURA, siempre (nov-2026).
// No tiene modo de escritura. Se puede correr cuando se quiera, antes y después de cualquier
// cambio, para comprobar que el saldo, el registro de movimientos y el resumen por categoría
// cuentan la misma historia.
//
//   node seeds-db/verificar-creditos.js
//
// Credenciales: seeds-db/service-account.json si existe; si no, GOOGLE_APPLICATION_CREDENTIALS.
// Sale con código 1 si encuentra cualquier discrepancia NUEVA.
//
// Regla: saldo nuevo = saldo anterior − gasto + abono, fila por fila, en el orden en que cambió
// el saldo (`secuencia` desde nov-2026; fecha en los registros anteriores).
//
// Comprueba, por cuenta:
//   1. Saldo: la fila más reciente con saldo es igual a iaCreditos.saldo.
//   2. Cadena: entre dos filas con saldo, los importes intermedios suman exactamente la diferencia
//      (misma función que usa la pantalla: src/utils/movimientosCreditos.js → cortesDeCadena).
//      Los cortes históricos conocidos (anteriores al registro de movimientos, 21-oct-2026) se
//      informan aparte y NO cuentan como hallazgo: su origen no se puede recuperar.
//   3. Filas numeradas: saldoAntes + delta = saldoDespues; saldoAntes = saldo de la fila anterior;
//      la secuencia no tiene huecos ni repetidos y coincide con iaCreditos.secuenciaMovimientos.
//   4. Cobertura: todo consumo posterior al inicio del registro (21-oct-2026) tiene su fila, y sus
//      filas (la del consumo + su devolución aparte, si la hay) suman lo que de verdad se cobró.
//   5. Duplicados: un consumo, una compra o una bienvenida aparece a lo más una vez.
//   6. Categorías: la suma de consumoPorCategoria es igual a consumidoTotal.
//   7. Categoría de calificación: ningún cobro de «Calificar con IA» posterior a la corrección
//      (24-oct-2026) quedó en «Otros».
//   8. Reservas en vuelo de más de 2 horas (deberían haberse liquidado o expirado).
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const admin = require('firebase-admin')

const RUTA_SA = path.join(__dirname, 'service-account.json')
admin.initializeApp(fs.existsSync(RUTA_SA)
  ? { credential: admin.credential.cert(require(RUTA_SA)) }
  : { projectId: 'evalua-facil-app' })
const db = admin.firestore()

const INICIO_REGISTRO = Date.parse('2026-10-21T20:20:00Z')
const CORRECCION_CATEGORIAS = Date.parse('2026-10-24T04:31:00Z')
const OPS_CALIFICACION = new Set(['calificar_entregable_ia', 'calificar_entregable_ia_imagenes', 'calificar_entregable_ia_lote', 'calificar_entregable_ia_lote_imagenes'])
const round2 = (n) => Math.round(n * 100) / 100
const ms = (t) => (t?.toMillis ? t.toMillis() : Date.parse(t))

async function main() {
  const { cortesDeCadena, compararOrden } = await import(pathToFileURL(path.join(__dirname, '../src/utils/movimientosCreditos.js')).href)
  const [creditos, consumos, movs] = await Promise.all([
    db.collection('iaCreditos').get(), db.collection('iaConsumos').get(), db.collection('iaMovimientos').get(),
  ])
  const consumosPorId = new Map(consumos.docs.map((d) => [d.id, d.data()]))
  const movsPorUid = new Map()
  const movsPorId = new Map()
  for (const d of movs.docs) {
    const m = { id: d.id, ...d.data() }
    movsPorId.set(d.id, m)
    if (!movsPorUid.has(m.uid)) movsPorUid.set(m.uid, [])
    movsPorUid.get(m.uid).push(m)
  }
  const hallazgos = []
  const historicos = []
  const anotar = (uid, tipo, detalle) => hallazgos.push({ uid: String(uid).slice(0, 6), tipo, detalle })
  const ahora = Date.now()

  for (const cd of creditos.docs) {
    const uid = cd.id
    const cr = cd.data()
    const lista = (movsPorUid.get(uid) || []).slice().sort(compararOrden)
    // 1. Saldo actual
    const ultimoConSaldo = [...lista].reverse().find((m) => typeof m.saldoDespues === 'number')
    if (ultimoConSaldo && round2(ultimoConSaldo.saldoDespues) !== round2(cr.saldo || 0)) {
      anotar(uid, 'saldo', `última fila ${ultimoConSaldo.saldoDespues} ≠ saldo ${cr.saldo}`)
    }
    // 2. Cadena (cortes)
    for (const c of cortesDeCadena(lista)) {
      const texto = `${c.delta > 0 ? '+' : ''}${c.delta} entre ${new Date(c.desde).toISOString().slice(0, 16)} y ${new Date(c.hasta).toISOString().slice(0, 16)}`
      if (c.hasta < INICIO_REGISTRO) historicos.push({ uid: uid.slice(0, 6), texto })
      else anotar(uid, 'cadena', texto)
    }
    // 3. Filas numeradas
    const numeradas = lista.filter((m) => Number.isFinite(m.secuencia))
    numeradas.forEach((m, i) => {
      if (round2(m.saldoAntes + m.delta) !== round2(m.saldoDespues)) anotar(uid, 'fila', `${m.id}: ${m.saldoAntes} + ${m.delta} ≠ ${m.saldoDespues}`)
      const prev = i > 0 ? numeradas[i - 1] : [...lista].reverse().find((x) => !Number.isFinite(x.secuencia) && typeof x.saldoDespues === 'number')
      if (prev && round2(prev.saldoDespues) !== round2(m.saldoAntes)) anotar(uid, 'fila', `${m.id}: saldoAntes ${m.saldoAntes} ≠ fila anterior ${prev.saldoDespues}`)
      if (i > 0 && m.secuencia !== numeradas[i - 1].secuencia + 1) anotar(uid, 'secuencia', `${numeradas[i - 1].secuencia} → ${m.secuencia}`)
    })
    if (numeradas.length && numeradas.at(-1).secuencia !== cr.secuenciaMovimientos) {
      anotar(uid, 'secuencia', `última fila ${numeradas.at(-1).secuencia} ≠ contador ${cr.secuenciaMovimientos}`)
    }
    // 5. Duplicados (mismo origen dos veces)
    const claves = lista.map((m) => m.tipo === 'consumo' ? `c:${m.id}` : m.tipo === 'compra' ? `p:${m.ref || m.id}` : m.tipo === 'bienvenida' ? 'b' : m.tipo === 'devolucion' ? `d:${m.consumoId}` : null).filter(Boolean)
    if (claves.length !== new Set(claves).size) anotar(uid, 'duplicado', 'un mismo consumo, devolución, compra o bienvenida aparece más de una vez')
    // 6. Categorías vs total
    const sumaCat = round2(Object.values(cr.consumoPorCategoria || {}).reduce((a, b) => a + (Number(b) || 0), 0))
    if (sumaCat !== round2(cr.consumidoTotal || 0)) anotar(uid, 'categorias', `suma ${sumaCat} ≠ consumidoTotal ${cr.consumidoTotal}`)
  }
  // 4. Cobertura desde el inicio del registro
  for (const d of consumos.docs) {
    const c = d.data()
    if (ms(c.createdAt) < INICIO_REGISTRO) continue
    const m = movsPorId.get(d.id)
    if (!m) { anotar(c.uid, 'cobertura', `consumo ${d.id} sin movimiento`); continue }
    const dev = movsPorId.get(`${d.id}_devolucion`)
    const neto = round2((m.delta || 0) + (dev?.delta || 0))
    const esperado = c.estado === 'ejecutado' ? -c.creditosReales : c.estado === 'reservado' ? -c.creditosReservados : 0
    if (neto !== round2(esperado)) anotar(c.uid, 'cobertura', `${d.id}: filas ${neto} ≠ consumo ${esperado} (${c.estado})`)
    // 7. Categoría de calificación
    if (c.estado === 'ejecutado' && OPS_CALIFICACION.has(c.operacion) && ms(c.createdAt) >= CORRECCION_CATEGORIAS && c.categoria === 'Otros') {
      anotar(c.uid, 'categoria-calificacion', `${d.id} quedó en «Otros»`)
    }
    // 8. Reservas viejas
    if (c.estado === 'reservado' && ahora - ms(c.createdAt) > 2 * 3600 * 1000) anotar(c.uid, 'reserva-vieja', d.id)
  }
  for (const m of movsPorId.values()) {
    if (m.tipo === 'consumo' && !consumosPorId.has(m.id)) anotar(m.uid, 'cobertura', `movimiento ${m.id} sin su consumo`)
    if (m.tipo === 'devolucion' && !consumosPorId.has(m.consumoId)) anotar(m.uid, 'cobertura', `devolución ${m.id} sin su consumo`)
  }

  const porTipo = hallazgos.reduce((o, h) => ({ ...o, [h.tipo]: (o[h.tipo] || 0) + 1 }), {})
  console.log('=== VERIFICACIÓN DE CRÉDITOS (solo lectura) ===')
  console.log(`Cuentas: ${creditos.size} · consumos: ${consumos.size} · movimientos: ${movs.size}`)
  console.log(hallazgos.length ? `Hallazgos: ${hallazgos.length} ${JSON.stringify(porTipo)}` : 'Sin hallazgos: saldo, registro y categorías coinciden.')
  hallazgos.forEach((h) => console.log(`  [${h.tipo}] ${h.uid}: ${h.detalle}`))
  if (historicos.length) {
    console.log(`Cortes históricos conocidos (anteriores al registro; origen no recuperable, no son hallazgo): ${historicos.length}`)
    historicos.forEach((h) => console.log(`  ${h.uid}: ${h.texto}`))
  }
  process.exitCode = hallazgos.length ? 1 : 0
}
main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
