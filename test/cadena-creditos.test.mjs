// Cadena de saldos del registro de movimientos (nov-2026). Funciones puras: no
// necesita emulador ni red.
//
//   node test/cadena-creditos.test.mjs
//
// Filas con la forma real de producción (historial importado sin saldo, ajustes
// con saldo registrado, filas del ledger con saldo y, desde nov-2026, con
// `secuencia`). Los importes reproducen los dos cortes reales de la cuenta
// auditada: +170 (inicio del modelo nuevo → 16-sep) y +120 (16-sep → 5-oct).

import assert from 'node:assert'
import {
  cortesDeCadena, insertarCortes, textoCorte, compararOrden, prepararMovimientos, tituloMovimiento,
  detalleMovimiento, saldoMovimiento, importeMovimiento, avisosMovimientos, esModeloAnterior,
} from '../src/utils/movimientosCreditos.js'

let pasadas = 0
let fallos = 0
function caso(nombre, fn) {
  try { fn(); pasadas++; console.log(`  ✓ ${nombre}`) } catch (e) { fallos++; console.log(`  ✗ ${nombre}\n    ${e.message}`) }
}
const ts = (iso) => ({ toMillis: () => Date.parse(iso) })
const r2 = (n) => Math.round(n * 100) / 100

// Historia representativa (orden cronológico).
function historia() {
  return [
    // Agosto, modelo anterior: nunca entra en la cadena del modelo nuevo.
    { id: 'a0', fecha: ts('2026-08-15T18:00:00Z'), periodo: '2026-08', tipo: 'consumo', delta: -20, estado: 'aplicado', origen: 'historico' },
    // Agosto, modelo nuevo: bienvenida y cobros sin saldo.
    { id: 'a1', fecha: ts('2026-08-21T04:20:27Z'), periodo: '2026-08', tipo: 'bienvenida', delta: 50, estado: 'aplicado', origen: 'historico' },
    { id: 'a2', fecha: ts('2026-08-23T23:32:00Z'), periodo: '2026-08', tipo: 'consumo', delta: -150, estado: 'aplicado', origen: 'historico' },
    { id: 'a3', fecha: ts('2026-08-25T18:00:00Z'), periodo: '2026-08', tipo: 'consumo', delta: 0, estado: 'sin_cobro', motivoCodigo: 'fallido', origen: 'historico' },
    // Septiembre: un cobro oculto (Chat) también mueve el saldo; ajuste con saldo registrado.
    { id: 's1', fecha: ts('2026-09-10T18:00:00Z'), periodo: '2026-09', tipo: 'consumo', delta: -56.5, estado: 'aplicado', origen: 'historico', operacion: 'rubrica' },
    { id: 's2', fecha: ts('2026-09-12T18:00:00Z'), periodo: '2026-09', tipo: 'consumo', delta: -0, estado: 'aplicado', origen: 'historico', operacion: 'chat_asistente' },
    { id: 's3', fecha: ts('2026-09-16T22:33:54Z'), periodo: '2026-09', tipo: 'ajuste', delta: 7.75, saldoDespues: 21.25, estado: 'aplicado', origen: 'historico' },
    { id: 's4', fecha: ts('2026-09-23T01:45:00Z'), periodo: '2026-09', tipo: 'consumo', delta: -140.75, estado: 'aplicado', origen: 'historico' },
    // Octubre: el ajuste que revela el segundo corte, luego la cadena completa.
    { id: 'o1', fecha: ts('2026-10-06T03:33:24Z'), periodo: '2026-10', tipo: 'ajuste', delta: 30, saldoDespues: 30.5, estado: 'aplicado', origen: 'historico' },
    { id: 'o2', fecha: ts('2026-10-06T03:36:00Z'), periodo: '2026-10', tipo: 'consumo', delta: -3, saldoDespues: 27.5, estado: 'aplicado', origen: 'historico' },
    { id: 'o3', fecha: ts('2026-10-24T15:44:46Z'), periodo: '2026-10', tipo: 'ajuste', delta: 15, saldoDespues: 42.5, estado: 'aplicado', origen: 'ledger' },
  ]
}

caso('cortes · detecta exactamente los dos cortes (+170 al inicio, +120 entre 16-sep y 5-oct)', () => {
  const c = cortesDeCadena(historia())
  assert.strictEqual(c.length, 2)
  assert.deepStrictEqual(c.map((x) => [x.delta, x.antesDe, x.inicio]), [[170, 's3', true], [120, 'o1', false]])
  assert.strictEqual(c[0].desde, Date.parse('2026-08-21T04:20:00Z'), 'el primero arranca en el inicio del modelo nuevo')
  assert.strictEqual(c[1].desde, Date.parse('2026-09-16T22:33:54Z'))
  assert.strictEqual(c[1].hasta, Date.parse('2026-10-06T03:33:24Z'))
})

caso('cortes · después del 5-oct la cadena cuadra: ningún corte más', () => {
  const c = cortesDeCadena(historia())
  assert.ok(c.every((x) => x.hasta <= Date.parse('2026-10-06T03:33:24Z')))
  // Romper la cadena después del 5-oct SÍ se detecta.
  const h = historia()
  h.at(-1).saldoDespues = 43.5
  assert.deepStrictEqual(cortesDeCadena(h).map((x) => x.delta), [170, 120, 1])
})

caso('cortes · cuenta nacida con el registro actual (todo con saldo): sin cortes', () => {
  const l = [
    { id: 'b', fecha: ts('2026-10-01T10:00:00Z'), tipo: 'bienvenida', delta: 50, saldoDespues: 50 },
    { id: 'c', fecha: ts('2026-10-02T10:00:00Z'), tipo: 'consumo', delta: -4, saldoDespues: 46 },
    { id: 'd', fecha: ts('2026-10-03T10:00:00Z'), tipo: 'consumo', delta: 0, saldoDespues: 46, estado: 'sin_cobro' },
  ]
  assert.deepStrictEqual(cortesDeCadena(l), [])
  assert.deepStrictEqual(cortesDeCadena([]), [])
  assert.deepStrictEqual(cortesDeCadena(undefined), [])
})

caso('cortes · el límite exacto del corte: lo anterior al modelo nuevo no cuenta, lo de las 04:20:00Z sí', () => {
  const l = [
    { id: 'x', fecha: ts('2026-08-21T04:19:59Z'), tipo: 'consumo', delta: -999 },
    { id: 'y', fecha: ts('2026-08-21T04:20:00Z'), tipo: 'bienvenida', delta: 50, saldoDespues: 50 },
  ]
  assert.deepStrictEqual(cortesDeCadena(l), [])
  assert.strictEqual(esModeloAnterior(l[0]), true)
  assert.strictEqual(esModeloAnterior(l[1]), false)
})

caso('cortes · bienvenida activada minutos antes del corte (migración escalonada): es modelo nuevo, sin corte falso', () => {
  // Caso real: bienvenida 04:12:01Z, saldo 50; siguiente movimiento sin cobro, saldo 50.
  const l = [
    { id: 'w', fecha: ts('2026-08-21T04:12:01Z'), tipo: 'bienvenida', delta: 50, saldoDespues: 50, origen: 'historico' },
    { id: 'f', fecha: ts('2026-09-24T23:27:06Z'), tipo: 'consumo', delta: 0, saldoDespues: 50, estado: 'sin_cobro', origen: 'historico' },
  ]
  assert.deepStrictEqual(cortesDeCadena(l), [])
  assert.strictEqual(esModeloAnterior(l[0]), false, 'la bienvenida nunca es «Modelo anterior»')
  assert.strictEqual(esModeloAnterior({ ...l[0], tipo: 'consumo' }), true, 'un cobro a esa hora sí lo es')
})

caso('cortes · campos opcionales ausentes o raros no rompen el cálculo', () => {
  const l = [
    { id: 'a', fecha: { seconds: Date.parse('2026-09-01T00:00:00Z') / 1000 }, tipo: 'consumo' }, // sin delta
    { id: 'b', fecha: ts('2026-09-02T00:00:00Z'), tipo: 'ajuste', delta: 10, saldoDespues: 10 },
    { id: 'c', fecha: null, tipo: 'consumo', delta: -5 }, // sin fecha: fuera del modelo nuevo
    { id: 'd', fecha: ts('2026-09-03T00:00:00Z'), tipo: 'consumo', delta: -2, saldoDespues: 'x' }, // saldo inválido = sin saldo
    { id: 'e', fecha: ts('2026-09-04T00:00:00Z'), tipo: 'consumo', delta: -1, saldoDespues: 7 },
  ]
  assert.deepStrictEqual(cortesDeCadena(l), [])
})

caso('cortes · un descuento sin registro también se detecta (diferencia negativa)', () => {
  const l = [
    { id: 'a', fecha: ts('2026-10-01T00:00:00Z'), tipo: 'ajuste', delta: 10, saldoDespues: 10 },
    { id: 'b', fecha: ts('2026-10-02T00:00:00Z'), tipo: 'consumo', delta: -1, saldoDespues: 4 },
  ]
  const c = cortesDeCadena(l)
  assert.deepStrictEqual(c.map((x) => x.delta), [-5])
  assert.match(textoCorte(c[0]).periodo, /^Descuentos sin registro/)
})

caso('cortes · se insertan justo debajo de la fila que los revela, en su mes; sin fecha ni saldo', () => {
  const h = historia()
  const cortes = cortesDeCadena(h)
  const septiembre = prepararMovimientos(h.filter((m) => m.periodo === '2026-09'))
  const filas = insertarCortes(septiembre, cortes)
  assert.deepStrictEqual(filas.map((m) => m.id), ['s4', 's3', 'corte_s3', 's1'], 'el Chat oculto no se muestra')
  const corte = filas[2]
  assert.strictEqual(saldoMovimiento(corte), '—')
  assert.strictEqual(importeMovimiento(corte.delta).texto, '+170.00')
  const t = textoCorte(corte)
  assert.strictEqual(t.titulo, 'Créditos sin registro')
  assert.match(t.periodo, /^Saldo con el que inició el modelo nuevo o abonos sin registro, entre el 20 ago 2026 y el 16 sep 2026\.$/)
  assert.match(t.nota, /comprobada/)
  const octubre = insertarCortes(prepararMovimientos(h.filter((m) => m.periodo === '2026-10')), cortes)
  assert.deepStrictEqual(octubre.map((m) => m.id), ['o3', 'o2', 'o1', 'corte_o1'])
  assert.match(textoCorte(octubre[3]).periodo, /^Abonos sin registro, entre el 16 sep 2026 y el 5 oct 2026\.$/)
  const agosto = insertarCortes(prepararMovimientos(h.filter((m) => m.periodo === '2026-08')), cortes)
  assert.ok(agosto.every((m) => m.tipo !== 'corte'), 'agosto no muestra cortes')
  assert.strictEqual(insertarCortes(septiembre, []), septiembre)
})

caso('cortes · los avisos del mes se calculan sin las filas de corte (no las cuentan como «sin saldo»)', () => {
  const octubreConSaldo = [{ id: 'o1', fecha: ts('2026-10-06T03:33:24Z'), saldoDespues: 30.5, delta: 30 }]
  assert.deepStrictEqual(avisosMovimientos(octubreConSaldo), { sinSaldo: false, modeloAnterior: false })
})

caso('orden · con `secuencia` manda el orden real del saldo, aunque la reserva sea más vieja', () => {
  const reserva = { id: 'A', fecha: ts('2026-11-01T10:00:00Z'), secuencia: 1, tipo: 'consumo', delta: -10, saldoDespues: 90, saldoAntes: 100 }
  const otra = { id: 'B', fecha: ts('2026-11-01T10:00:05Z'), secuencia: 2, tipo: 'consumo', delta: -5, saldoDespues: 85, saldoAntes: 90 }
  const devolucion = { id: 'A_devolucion', fecha: ts('2026-11-01T10:00:03Z'), secuencia: 3, tipo: 'devolucion', delta: 4, saldoDespues: 89, saldoAntes: 85, operacion: 'rubrica' }
  const asc = [devolucion, otra, reserva].sort(compararOrden)
  assert.deepStrictEqual(asc.map((m) => m.id), ['A', 'B', 'A_devolucion'])
  for (let i = 1; i < asc.length; i++) assert.strictEqual(r2(asc[i - 1].saldoDespues + asc[i].delta), asc[i].saldoDespues)
  assert.deepStrictEqual(prepararMovimientos([reserva, otra, devolucion]).map((m) => m.id), ['A_devolucion', 'B', 'A'])
  // Con la bienvenida registrada antes, la cadena completa no tiene ningún corte.
  const bienvenida = { id: 'W', fecha: ts('2026-10-31T10:00:00Z'), tipo: 'bienvenida', delta: 100, saldoDespues: 100 }
  assert.deepStrictEqual(cortesDeCadena([reserva, otra, devolucion, bienvenida]), [])
})

caso('orden · sin `secuencia` (registros anteriores) manda la fecha; empate por id', () => {
  const a = { id: 'a', fecha: ts('2026-10-01T00:00:00Z') }
  const b = { id: 'b', fecha: ts('2026-10-01T00:00:00Z') }
  const c = { id: 'c', fecha: ts('2026-09-01T00:00:00Z') }
  assert.deepStrictEqual([b, a, c].sort(compararOrden).map((m) => m.id), ['c', 'a', 'b'])
})

caso('devolución en fila aparte · título, detalle y filtro «Recargas y ajustes»', () => {
  const dev = { id: 'k_devolucion', tipo: 'devolucion', operacion: 'calificar_entregable_ia_lote', delta: 4, estado: 'aplicado' }
  assert.strictEqual(tituloMovimiento(dev), 'Devolución de créditos no usados')
  assert.strictEqual(detalleMovimiento(dev), 'Calificación de evidencias')
  const reservaCobrada = { tipo: 'consumo', operacion: 'rubrica', estado: 'aplicado', devolucionAparte: true }
  assert.strictEqual(detalleMovimiento(reservaCobrada), 'Reservado · lo no usado se devolvió en otra fila')
  const reservaFallida = { tipo: 'consumo', operacion: 'rubrica', estado: 'sin_cobro', motivoCodigo: 'fallido', devolucionAparte: true }
  assert.strictEqual(detalleMovimiento(reservaFallida), 'La operación no se completó · Se devolvió todo en otra fila')
  assert.deepStrictEqual(prepararMovimientos([dev, { id: 'x', tipo: 'consumo', fecha: ts('2026-11-01T00:00:00Z') }], { filtro: 'recargas' }).map((m) => m.id), ['k_devolucion'])
  assert.strictEqual(importeMovimiento(dev.delta).tono, 'abono')
})

caso('títulos existentes no cambian', () => {
  assert.strictEqual(tituloMovimiento({ tipo: 'consumo', operacion: 'calificar_entregable_ia' }), 'Calificación de evidencias')
  assert.strictEqual(tituloMovimiento({ tipo: 'consumo', operacion: 'rubrica' }), 'Rúbrica con IA')
  assert.strictEqual(tituloMovimiento({ tipo: 'consumo', operacion: 'nueva_x', categoria: 'Planeación' }), 'Planeación')
  assert.strictEqual(tituloMovimiento({ tipo: 'compra' }), 'Compra de créditos')
  assert.strictEqual(detalleMovimiento({ tipo: 'consumo', estado: 'sin_cobro', motivoCodigo: 'expirado' }), 'La operación expiró · No se descontó nada')
  assert.strictEqual(detalleMovimiento({ tipo: 'consumo', estado: 'en_proceso' }), 'En proceso')
  assert.strictEqual(detalleMovimiento({ tipo: 'consumo', estado: 'aplicado' }), null)
})

console.log(`\n${pasadas} pasaron, ${fallos} fallaron`)
if (fallos) process.exit(1)
