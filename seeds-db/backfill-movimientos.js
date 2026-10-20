// Backfill del registro de movimientos de créditos (iaMovimientos) con el historial que SÍ
// se puede demostrar con los datos que ya existen.
//
//   node seeds-db/backfill-movimientos.js                # SIMULACIÓN (no escribe nada)
//   node seeds-db/backfill-movimientos.js --detalle      # además lista cada movimiento (sin uids)
//   node seeds-db/backfill-movimientos.js --ejecutar     # ESCRIBE. Solo con autorización expresa de Kike.
//
// Por defecto es SOLO LECTURA. Para escribir hay que pasar --ejecutar
// explícitamente; sin esa bandera, ninguna ruta de este archivo llama a
// .set()/.commit().
//
// Qué importa (cada movimiento queda con origen:'historico' y SIN saldoDespues:
// ese dato nunca se guardó y no se reconstruye ni se inventa):
//   · consumos de iaConsumos: 'ejecutado' → cobro real; 'fallido', 'expirado',
//     'cancelado', 'reembolsado' → «sin cobro» (delta 0). Los 'reservado' se
//     saltan: están en vuelo y los cerrará el ledger.
//   · bienvenida: iaTrialRegistro con bienvenidaActivada, fecha activadaEn y el
//     monto GUARDADO en el registro (hubo 50 y luego 30).
//   · compras: creditPurchases en 'completado', fecha resueltoEn.
//   · último ajuste manual de iaCreditos.ultimoAjusteManual SOLO si fue positivo
//     (un ajuste negativo pudo recortarse en cero y el monto efectivo no se
//     puede demostrar; los ajustes anteriores al último se sobrescribieron).
// Qué NO importa (se reporta): reservas en vuelo, ajustes negativos, la
// devolución manual guardada en iaConsumos.devolucion (no pasó por el ledger),
// registros sin fecha o sin monto.
//
// IDs idénticos a los que usa el ledger (clave del consumo, bienvenida_{uid},
// compra_{id}), así que lo que el ledger ya escribió se detecta como duplicado
// y no se toca, y un movimiento posterior del ledger sobre la misma clave lo
// completa con merge.

const admin = require('firebase-admin')

const sa = require('./service-account.json')
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()
const { Timestamp } = admin.firestore

const args = process.argv.slice(2)
const EJECUTAR = args.includes('--ejecutar')
const DETALLE = args.includes('--detalle')

const round2 = (n) => Math.round(n * 100) / 100

// Mismo cálculo que functions/creditosLedger.js → periodoDe (hora de México).
function periodoDe(fecha) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit' }).formatToParts(fecha)
  return `${p.find((x) => x.type === 'year').value}-${p.find((x) => x.type === 'month').value}`
}

const cuenta = (o, k) => { o[k] = (o[k] || 0) + 1 }

async function main() {
  const [consumos, registros, compras, creditos, existentes] = await Promise.all([
    db.collection('iaConsumos').get(),
    db.collection('iaTrialRegistro').get(),
    db.collection('creditPurchases').get(),
    db.collection('iaCreditos').get(),
    db.collection('iaMovimientos').get(),
  ])
  const yaExisten = new Set(existentes.docs.map((d) => d.id))

  // Cuentas que SIGUEN existiendo (users/{uid}). Los registros de una cuenta ya
  // eliminada no se importan: borrar la cuenta no debe dejar residuos, y la
  // registro de movimientos de alguien que ya no existe no la va a leer nadie.
  const uids = new Set([
    ...consumos.docs.map((d) => d.data().uid),
    ...registros.docs.map((d) => d.id),
    ...compras.docs.map((d) => d.data().docenteId),
    ...creditos.docs.map((d) => d.id),
  ].filter(Boolean))
  const cuentasVivas = new Set()
  const lista = [...uids]
  for (let i = 0; i < lista.length; i += 200) {
    const snaps = await db.getAll(...lista.slice(i, i + 200).map((u) => db.doc(`users/${u}`)))
    snaps.forEach((sn) => { if (sn.exists) cuentasVivas.add(sn.id) })
  }

  const aImportar = [] // { id, datos }
  const omitidos = {} // razón → cantidad
  const porTipo = {}
  const deltaPorUid = {} // para conciliar contra el saldo actual
  const sumar = (uid, delta) => { deltaPorUid[uid] = round2((deltaPorUid[uid] || 0) + delta) }

  const agregar = (id, uid, datos) => {
    if (!cuentasVivas.has(uid)) { cuenta(omitidos, 'registro de una cuenta que ya no existe (users/{uid} ausente)'); return false }
    if (yaExisten.has(id)) { cuenta(omitidos, 'duplicado: ya existe en iaMovimientos (lo escribió el ledger)'); return false }
    aImportar.push({ id, datos: { uid, ...datos, origen: 'historico' } })
    cuenta(porTipo, datos.tipo + (datos.estado === 'sin_cobro' ? ' (sin cobro)' : ''))
    return true
  }

  // ── Consumos ────────────────────────────────────────────────────────────
  for (const d of consumos.docs) {
    const c = d.data()
    const fecha = c.createdAt?.toDate?.()
    if (c.devolucion) cuenta(omitidos, 'devolución manual en iaConsumos.devolucion (no pasó por el ledger; requiere decisión)')
    if (!fecha) { cuenta(omitidos, 'consumo sin createdAt'); continue }
    if (c.estado === 'reservado') { cuenta(omitidos, 'consumo en vuelo (reservado): lo cerrará el ledger'); continue }
    const base = {
      tipo: 'consumo', operacion: c.operacion, categoria: c.categoria || 'Otros',
      fecha: c.createdAt, periodo: periodoDe(fecha),
    }
    if (c.estado === 'ejecutado') {
      if (typeof c.creditosReales !== 'number') { cuenta(omitidos, 'consumo ejecutado sin creditosReales'); continue }
      if (agregar(d.id, c.uid, { ...base, delta: -c.creditosReales, estado: 'aplicado' })) sumar(c.uid, -c.creditosReales)
    } else if (['fallido', 'expirado', 'cancelado', 'reembolsado'].includes(c.estado)) {
      agregar(d.id, c.uid, { ...base, delta: 0, estado: 'sin_cobro', motivoCodigo: c.estado === 'reembolsado' ? 'fallido' : c.estado })
    } else {
      cuenta(omitidos, `consumo con estado desconocido "${c.estado}"`)
    }
  }

  // ── Bienvenida ──────────────────────────────────────────────────────────
  for (const d of registros.docs) {
    const r = d.data()
    if (!r.bienvenidaActivada) continue
    const fecha = r.activadaEn?.toDate?.()
    if (!fecha || typeof r.creditosBienvenida !== 'number') { cuenta(omitidos, 'bienvenida activada sin fecha o sin monto'); continue }
    if (agregar(`bienvenida_${d.id}`, d.id, { tipo: 'bienvenida', delta: r.creditosBienvenida, estado: 'aplicado', fecha: r.activadaEn, periodo: periodoDe(fecha) })) sumar(d.id, r.creditosBienvenida)
  }

  // ── Compras aprobadas ───────────────────────────────────────────────────
  for (const d of compras.docs) {
    const c = d.data()
    if (c.status !== 'completado') { cuenta(omitidos, `compra "${c.status}": no abonó créditos`); continue }
    const fecha = c.resueltoEn?.toDate?.()
    if (!fecha || typeof c.creditos !== 'number') { cuenta(omitidos, 'compra completada sin fecha o sin monto'); continue }
    if (agregar(`compra_${d.id}`, c.docenteId, { tipo: 'compra', delta: c.creditos, estado: 'aplicado', ref: d.id, fecha: c.resueltoEn, periodo: periodoDe(fecha) })) sumar(c.docenteId, c.creditos)
  }

  // ── Último ajuste manual (solo si fue positivo) ─────────────────────────
  for (const d of creditos.docs) {
    const a = d.data().ultimoAjusteManual
    if (!a) continue
    const fecha = a.en?.toDate?.()
    if (!fecha || typeof a.delta !== 'number') { cuenta(omitidos, 'ajuste manual sin fecha o sin monto'); continue }
    if (a.delta < 0) { cuenta(omitidos, 'ajuste manual negativo: el monto efectivo no se puede demostrar (pudo recortarse en cero)'); continue }
    // Sin motivo ni adminUid: el docente solo ve «Ajuste de Evalúa Fácil».
    if (agregar(`ajuste_hist_${d.id}`, d.id, { tipo: 'ajuste', delta: a.delta, estado: 'aplicado', fecha: a.en, periodo: periodoDe(fecha) })) sumar(d.id, a.delta)
  }

  // ── Conciliación: movimientos importados vs saldo actual ────────────────
  let cuadran = 0
  const noCuadran = []
  for (const d of creditos.docs) {
    const saldo = d.data().saldo || 0
    const suma = deltaPorUid[d.id] || 0
    const dif = round2(saldo - suma)
    if (Math.abs(dif) < 0.01) cuadran += 1
    else noCuadran.push({ dif, tieneAjusteManual: !!d.data().ultimoAjusteManual, camposViejos: ['plan', 'capacidad', 'cicloFin'].some((k) => k in d.data()) })
  }
  const sinCuenta = Object.keys(deltaPorUid).filter((u) => !creditos.docs.some((d) => d.id === u)).length

  // ── Reporte ─────────────────────────────────────────────────────────────
  console.log(EJECUTAR ? '=== BACKFILL (EJECUCIÓN REAL) ===' : '=== BACKFILL — SIMULACIÓN (no se escribe nada) ===')
  console.log(`Leídos: iaConsumos=${consumos.size} iaTrialRegistro=${registros.size} creditPurchases=${compras.size} iaCreditos=${creditos.size} iaMovimientos existentes=${existentes.size}`)
  console.log(`\nSe importarían ${aImportar.length} movimientos:`)
  Object.entries(porTipo).sort().forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`))
  console.log('\nNo se importan:')
  if (!Object.keys(omitidos).length) console.log('  (nada)')
  Object.entries(omitidos).sort().forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`))
  const ids = aImportar.map((m) => m.id)
  console.log(`\nDuplicados dentro del propio lote: ${ids.length - new Set(ids).size}`)
  console.log(`\nConciliación (suma de los movimientos importados vs saldo actual, por cuenta):`)
  console.log(`  cuadran: ${cuadran}   no cuadran: ${noCuadran.length}   movimientos de cuentas sin iaCreditos: ${sinCuenta}`)
  noCuadran.forEach((x) => console.log(`  diferencia ${x.dif}  ${x.tieneAjusteManual ? '[tiene ajuste manual]' : ''}${x.camposViejos ? '[campos del modelo anterior]' : ''}`))
  console.log('  (una diferencia significa créditos que movieron el saldo sin dejar rastro demostrable: ajustes anteriores al último, devoluciones manuales, saldos del modelo anterior. Esos NO se inventan.)')
  if (DETALLE) {
    console.log('\nDetalle (sin uids):')
    aImportar.forEach((m) => console.log(`  ${m.datos.periodo} ${m.datos.tipo.padEnd(10)} ${String(m.datos.delta).padStart(7)}  ${m.datos.operacion || ''} ${m.datos.estado}${m.datos.motivoCodigo ? '/' + m.datos.motivoCodigo : ''}`))
  }

  if (!EJECUTAR) {
    console.log('\nSimulación terminada. NO se escribió nada. Para escribir: --ejecutar (requiere autorización expresa).')
    return
  }

  let escritos = 0
  for (let i = 0; i < aImportar.length; i += 400) {
    const lote = db.batch()
    aImportar.slice(i, i + 400).forEach((m) => lote.create(db.doc(`iaMovimientos/${m.id}`), { ...m.datos, actualizadoEn: Timestamp.now() }))
    await lote.commit() // create(): falla si el id ya existe, nunca pisa un movimiento del ledger
    escritos += Math.min(400, aImportar.length - i)
  }
  console.log(`\nEscritos ${escritos} movimientos.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
