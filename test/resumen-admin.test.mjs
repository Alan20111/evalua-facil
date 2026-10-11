// Cálculos del Resumen del administrador sobre `creditPurchases`. Funciones
// puras: no necesita emulador ni red.
//
//   node test/resumen-admin.test.mjs

import assert from 'node:assert'
import {
  resumenCompras, creditosVendidos, ingresosTotales, ingresosPorMes,
  comprasPendientes, comprasCompletadas, posiblesDuplicados, MOTIVO, ESTADO,
} from '../src/utils/resumenAdmin.js'

let fallos = 0
function caso(nombre, fn) {
  try { fn(); console.log(`  ✓ ${nombre}`) } catch (e) { fallos++; console.log(`  ✗ ${nombre}\n    ${e.message}`) }
}

// Un Timestamp de Firestore (lo único que expone el SDK: toDate()).
const ts = (iso) => ({ toDate: () => new Date(iso) })

let n = 0
const compra = (extra = {}) => ({
  id: `c${++n}`,
  docenteId: 'D1',
  creditos: 200,
  montoMXN: 180,
  metodo: 'transferencia',
  referencia: `REF${n}`,
  status: 'completado',
  origen: 'creditos_adicionales',
  createdAt: ts('2026-10-10T15:00:00Z'),
  resueltoEn: ts('2026-10-11T15:00:00Z'),
  resueltoPor: 'ADMIN',
  ...extra,
})
const motivos = (r) => r.inconsistencias.map((i) => i.motivo)

console.log('ventas básicas')
caso('una compra completada', () => {
  const r = resumenCompras([compra()])
  assert.strictEqual(r.ingresosMXN, 180)
  assert.strictEqual(r.creditosVendidos, 200)
  assert.strictEqual(r.comprasCompletadas, 1)
  assert.deepStrictEqual(r.ingresosPorMes, [{ mes: '2026-10', ingresosMXN: 180, creditosVendidos: 200, compras: 1 }])
  assert.deepStrictEqual(r.inconsistencias, [])
})
caso('varias compras completadas', () => {
  const r = resumenCompras([compra(), compra({ creditos: 50, montoMXN: 50 }), compra({ creditos: 100, montoMXN: 90 })])
  assert.strictEqual(r.ingresosMXN, 320)
  assert.strictEqual(r.creditosVendidos, 350)
  assert.strictEqual(r.comprasCompletadas, 3)
})
caso('créditos vendidos e ingresos en pesos son cifras distintas', () => {
  const r = resumenCompras([compra({ creditos: 1600, montoMXN: 1440 })])
  assert.strictEqual(r.creditosVendidos, 1600)
  assert.strictEqual(r.ingresosMXN, 1440)
  assert.notStrictEqual(r.creditosVendidos, r.ingresosMXN)
})
caso('REGRESIÓN del informe: $180 y 200 créditos, sin los $99 históricos de payments', () => {
  const pagoHeredado = { id: 'p1', docenteId: 'D2', monto: 99, metodo: 'mercadopago', status: 'completado', createdAt: ts('2026-08-04T12:00:00Z') }
  const r = resumenCompras([compra({ id: 'real' }), pagoHeredado])
  assert.strictEqual(r.ingresosMXN, 180)
  assert.strictEqual(r.creditosVendidos, 200)
  assert.strictEqual(r.comprasCompletadas, 1)
  // El pago antiguo no cuenta, y además queda avisado en vez de desaparecer en silencio.
  assert.deepStrictEqual(r.inconsistencias, [{ id: 'p1', motivo: MOTIVO.ORIGEN_NO_VENTA, detalle: 'sin origen' }])
})
caso('los centavos se suman sin ruido de punto flotante', () => {
  const r = resumenCompras([compra({ montoMXN: 0.1, creditos: 1 }), compra({ montoMXN: 0.2, creditos: 1 })])
  assert.strictEqual(r.ingresosMXN, 0.3)
})

console.log('pendientes, rechazadas y otros estados')
caso('las pendientes y rechazadas se cuentan aparte y no suman', () => {
  const r = resumenCompras([
    compra(),
    compra({ status: 'pendiente', resueltoEn: undefined }),
    compra({ status: 'pendiente', resueltoEn: undefined }),
    compra({ status: 'rechazado' }),
  ])
  assert.strictEqual(r.ingresosMXN, 180)
  assert.strictEqual(r.creditosVendidos, 200)
  assert.strictEqual(r.comprasCompletadas, 1)
  assert.strictEqual(r.comprasPendientes, 2)
  assert.strictEqual(r.comprasRechazadas, 1)
  assert.deepStrictEqual(r.inconsistencias, [])
})
caso('un estado desconocido o con otra capitalización no es venta, y se avisa', () => {
  const r = resumenCompras([compra({ status: 'Completado' }), compra({ status: 'en_proceso' }), compra({ status: undefined })])
  assert.strictEqual(r.ingresosMXN, 0)
  assert.deepStrictEqual(motivos(r), [MOTIVO.ESTADO_DESCONOCIDO, MOTIVO.ESTADO_DESCONOCIDO, MOTIVO.ESTADO_DESCONOCIDO])
})

console.log('regalos y ajustes manuales no son ventas')
caso('un documento de regalo de bienvenida no suma', () => {
  const regalo = { id: 'g1', docenteId: 'D1', creditos: 30, montoMXN: 0, status: 'completado', origen: 'regalo_bienvenida', resueltoEn: ts('2026-10-01T10:00:00Z') }
  const r = resumenCompras([compra(), regalo])
  assert.strictEqual(r.creditosVendidos, 200)
  assert.strictEqual(r.ingresosMXN, 180)
  assert.deepStrictEqual(r.inconsistencias, [{ id: 'g1', motivo: MOTIVO.ORIGEN_NO_VENTA, detalle: 'regalo_bienvenida' }])
})
caso('un ajuste manual del administrador no suma, aunque traiga créditos', () => {
  const ajuste = { id: 'a1', docenteId: 'D1', creditos: 500, montoMXN: 500, status: 'completado', origen: 'ajuste_manual', resueltoEn: ts('2026-10-02T10:00:00Z') }
  const r = resumenCompras([ajuste])
  assert.strictEqual(r.creditosVendidos, 0)
  assert.strictEqual(r.ingresosMXN, 0)
  assert.strictEqual(r.comprasCompletadas, 0)
})
caso('el registro de regalo de iaTrialRegistro (sin status ni origen) tampoco', () => {
  const registro = { id: 'u1', bienvenidaActivada: true, creditosBienvenida: 30 }
  const r = resumenCompras([registro])
  assert.strictEqual(r.creditosVendidos, 0)
  assert.strictEqual(r.ingresosMXN, 0)
})

console.log('agrupación mensual por resueltoEn')
caso('el mes sale de resueltoEn, no de createdAt', () => {
  const r = resumenCompras([compra({ createdAt: ts('2026-09-30T20:00:00Z'), resueltoEn: ts('2026-10-02T20:00:00Z') })])
  assert.deepStrictEqual(r.ingresosPorMes.map((m) => m.mes), ['2026-10'])
})
caso('el mes se calcula en la zona de México, no en UTC', () => {
  // 05:30 UTC del 1-nov son las 23:30 del 31-oct en la Ciudad de México.
  const r = resumenCompras([compra({ resueltoEn: ts('2026-11-01T05:30:00Z') })])
  assert.deepStrictEqual(r.ingresosPorMes.map((m) => m.mes), ['2026-10'])
})
caso('compras de meses distintos: una fila por mes, en orden', () => {
  const r = resumenCompras([
    compra({ resueltoEn: ts('2026-10-05T18:00:00Z') }),
    compra({ resueltoEn: ts('2026-08-20T18:00:00Z'), creditos: 50, montoMXN: 50 }),
    compra({ resueltoEn: ts('2026-10-25T18:00:00Z'), creditos: 100, montoMXN: 90 }),
    compra({ resueltoEn: ts('2026-09-01T18:00:00Z'), creditos: 400, montoMXN: 360 }),
  ])
  assert.deepStrictEqual(r.ingresosPorMes, [
    { mes: '2026-08', ingresosMXN: 50, creditosVendidos: 50, compras: 1 },
    { mes: '2026-09', ingresosMXN: 360, creditosVendidos: 400, compras: 1 },
    { mes: '2026-10', ingresosMXN: 270, creditosVendidos: 300, compras: 2 },
  ])
  assert.strictEqual(r.ingresosMXN, 680)
})
caso('acepta también { seconds, nanoseconds } y Date', () => {
  const r = resumenCompras([
    compra({ resueltoEn: { seconds: Date.parse('2026-10-05T18:00:00Z') / 1000, nanoseconds: 0 } }),
    compra({ resueltoEn: new Date('2026-10-06T18:00:00Z') }),
  ])
  assert.deepStrictEqual(r.ingresosPorMes.map((m) => m.mes), ['2026-10'])
  assert.strictEqual(r.ingresosPorMes[0].compras, 2)
})

console.log('completadas sin fecha de resolución')
caso('entran en el total, no se asignan a ningún mes y se avisa', () => {
  const r = resumenCompras([compra(), compra({ resueltoEn: undefined, creditos: 50, montoMXN: 50 })])
  assert.strictEqual(r.ingresosMXN, 230)
  assert.strictEqual(r.creditosVendidos, 250)
  assert.deepStrictEqual(r.ingresosPorMes.map((m) => m.ingresosMXN), [180])
  assert.strictEqual(r.ingresosSinMesMXN, 50)
  assert.strictEqual(r.creditosSinMes, 50)
  assert.strictEqual(r.comprasSinMes, 1)
  assert.deepStrictEqual(motivos(r), [MOTIVO.SIN_FECHA_RESOLUCION])
})
caso('invariante: total = suma de la serie + lo que no tiene mes', () => {
  const r = resumenCompras([compra(), compra({ resueltoEn: null }), compra({ resueltoEn: 'ayer' }), compra({ resueltoEn: ts('2026-09-10T10:00:00Z') })])
  const serie = r.ingresosPorMes.reduce((a, m) => a + m.ingresosMXN, 0)
  assert.strictEqual(r.ingresosMXN, serie + r.ingresosSinMesMXN)
})

console.log('fechas e importes inválidos')
caso('fechas inválidas: texto, NaN, fuera de rango, objeto que falla → sin mes, con aviso', () => {
  const malas = ['2026-10-11', new Date('no es fecha'), { seconds: NaN }, 0, Date.UTC(2200, 0, 1), { toDate: () => { throw new Error('x') } }, {}]
  const r = resumenCompras(malas.map((v) => compra({ resueltoEn: v })))
  assert.strictEqual(r.ingresosPorMes.length, 0)
  assert.strictEqual(r.comprasSinMes, malas.length)
  assert.ok(motivos(r).every((m) => m === MOTIVO.FECHA_RESOLUCION_INVALIDA))
  assert.strictEqual(r.ingresosMXN, 180 * malas.length) // el dinero sigue contando
})
caso('importes inválidos no se convierten en ingreso', () => {
  const r = resumenCompras([
    compra({ montoMXN: '180' }), compra({ montoMXN: NaN }), compra({ montoMXN: -50 }),
    compra({ montoMXN: 0 }), compra({ montoMXN: Infinity }), compra({ montoMXN: null }), compra({ montoMXN: undefined }),
  ])
  assert.strictEqual(r.ingresosMXN, 0)
  assert.strictEqual(r.creditosVendidos, 0)
  assert.strictEqual(r.comprasCompletadas, 0)
  assert.strictEqual(r.completadasExcluidas, 7)
  assert.ok(motivos(r).every((m) => m === MOTIVO.IMPORTE_INVALIDO))
})
caso('créditos inválidos: la compra no cuenta ni en pesos ni en créditos', () => {
  const r = resumenCompras([compra({ creditos: '200' }), compra({ creditos: 0 }), compra({ creditos: -5 }), compra({ creditos: NaN }), compra({ creditos: undefined })])
  assert.strictEqual(r.ingresosMXN, 0)
  assert.strictEqual(r.creditosVendidos, 0)
  assert.ok(motivos(r).every((m) => m === MOTIVO.CREDITOS_INVALIDOS))
})
caso('documentos que no son objetos se apartan sin romper el cálculo', () => {
  const r = resumenCompras([null, undefined, 42, 'x', [], compra()])
  assert.strictEqual(r.ingresosMXN, 180)
  assert.deepStrictEqual(motivos(r), Array(5).fill(MOTIVO.DOCUMENTO_INVALIDO))
})

console.log('una vez por documento')
caso('el mismo id repetido cuenta una sola vez', () => {
  const c = compra({ id: 'unico' })
  const r = resumenCompras([c, { ...c }, c])
  assert.strictEqual(r.ingresosMXN, 180)
  assert.strictEqual(r.comprasCompletadas, 1)
  assert.deepStrictEqual(motivos(r), [MOTIVO.ID_REPETIDO, MOTIVO.ID_REPETIDO])
})
caso('sin id: se cuenta, pero se avisa que no se puede garantizar la unicidad', () => {
  const r = resumenCompras([compra({ id: undefined })])
  assert.strictEqual(r.ingresosMXN, 180)
  assert.deepStrictEqual(motivos(r), [MOTIVO.SIN_ID])
})

console.log('posibles duplicados (se señalan, no se descartan)')
caso('misma referencia, docente y créditos en dos completadas: se señala y SIGUEN contando', () => {
  const a = compra({ id: 'a', referencia: 'ABC123' })
  const b = compra({ id: 'b', referencia: 'ABC123' })
  const r = resumenCompras([a, b])
  assert.strictEqual(r.ingresosMXN, 360)
  assert.strictEqual(r.comprasCompletadas, 2)
  assert.strictEqual(r.posiblesDuplicados.length, 1)
  const g = r.posiblesDuplicados[0]
  assert.deepStrictEqual(g.compras.map((c) => c.id), ['a', 'b'])
  assert.strictEqual(g.completadas, 2)
  assert.strictEqual(g.requiereRevision, true)
})
caso('la referencia se compara sin importar mayúsculas ni espacios', () => {
  const r = resumenCompras([compra({ id: 'a', referencia: ' abc  123 ' }), compra({ id: 'b', referencia: 'ABC 123' })])
  assert.strictEqual(r.posiblesDuplicados.length, 1)
})
caso('documentos distintos con la misma referencia pero otro docente o distintos créditos NO son duplicados', () => {
  const r = resumenCompras([
    compra({ id: 'a', referencia: 'X1' }),
    compra({ id: 'b', referencia: 'X1', docenteId: 'D2' }),
    compra({ id: 'c', referencia: 'X1', creditos: 100, montoMXN: 90 }),
  ])
  assert.strictEqual(r.posiblesDuplicados.length, 0)
  assert.strictEqual(r.ingresosMXN, 450)
})
caso('un reenvío tras un rechazo se muestra, pero no exige revisión (solo hay una completada)', () => {
  const r = resumenCompras([compra({ id: 'a', referencia: 'R9', status: 'rechazado' }), compra({ id: 'b', referencia: 'R9' })])
  assert.strictEqual(r.posiblesDuplicados.length, 1)
  assert.strictEqual(r.posiblesDuplicados[0].completadas, 1)
  assert.strictEqual(r.posiblesDuplicados[0].requiereRevision, false)
  assert.strictEqual(r.ingresosMXN, 180)
})
caso('sin referencia no hay nada que comparar', () => {
  const r = resumenCompras([compra({ referencia: '' }), compra({ referencia: '   ' }), compra({ referencia: undefined })])
  assert.strictEqual(r.posiblesDuplicados.length, 0)
})
caso('los que requieren revisión van primero', () => {
  const r = resumenCompras([
    compra({ id: 'a', referencia: 'S1', status: 'rechazado' }), compra({ id: 'b', referencia: 'S1' }),
    compra({ id: 'c', referencia: 'S2' }), compra({ id: 'd', referencia: 'S2' }),
  ])
  assert.deepStrictEqual(r.posiblesDuplicados.map((g) => g.referencia), ['S2', 'S1'])
})

console.log('colecciones vacías y utilidades sueltas')
caso('vacías, nulas o indefinidas: ceros y listas vacías', () => {
  for (const entrada of [[], null, undefined]) {
    const r = resumenCompras(entrada)
    assert.strictEqual(r.ingresosMXN, 0)
    assert.strictEqual(r.creditosVendidos, 0)
    assert.strictEqual(r.comprasCompletadas, 0)
    assert.strictEqual(r.comprasPendientes, 0)
    assert.deepStrictEqual(r.ingresosPorMes, [])
    assert.deepStrictEqual(r.posiblesDuplicados, [])
    assert.deepStrictEqual(r.inconsistencias, [])
  }
})
caso('las funciones sueltas coinciden con el resumen', () => {
  const datos = [compra(), compra({ status: 'pendiente', resueltoEn: undefined }), compra({ creditos: 50, montoMXN: 50 })]
  const r = resumenCompras(datos)
  assert.strictEqual(creditosVendidos(datos), r.creditosVendidos)
  assert.strictEqual(ingresosTotales(datos), r.ingresosMXN)
  assert.deepStrictEqual(ingresosPorMes(datos), r.ingresosPorMes)
  assert.strictEqual(comprasPendientes(datos), 1)
  assert.strictEqual(comprasCompletadas(datos), 2)
  assert.deepStrictEqual(posiblesDuplicados(datos), r.posiblesDuplicados)
})
caso('el estado del módulo no cambia las entradas y el resultado es determinista', () => {
  const datos = [compra({ id: 'a' }), compra({ id: 'b', status: 'pendiente' })]
  datos.forEach((d) => Object.freeze(d))
  Object.freeze(datos)
  const uno = resumenCompras(datos)
  const dos = resumenCompras(datos)
  assert.deepStrictEqual(uno, dos)
})
caso('el origen de venta se puede ampliar de forma explícita', () => {
  const extra = { id: 'o1', docenteId: 'D1', creditos: 10, montoMXN: 10, status: 'completado', origen: 'otro_canal', resueltoEn: ts('2026-10-03T10:00:00Z') }
  assert.strictEqual(resumenCompras([extra]).ingresosMXN, 0)
  assert.strictEqual(resumenCompras([extra], { origenesVenta: ['creditos_adicionales', 'otro_canal'] }).ingresosMXN, 10)
})
caso('ESTADO expone los tres estados reconocidos', () => {
  assert.deepStrictEqual({ ...ESTADO }, { COMPLETADO: 'completado', PENDIENTE: 'pendiente', RECHAZADO: 'rechazado' })
})

if (fallos) { console.log(`\n${fallos} caso(s) fallaron`); process.exit(1) }
console.log('\nTodo bien')
