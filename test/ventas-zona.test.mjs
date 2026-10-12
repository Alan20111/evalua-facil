// Ventas por zona: agrupación por estado y municipio sobre creditPurchases.
// Funciones puras: no necesita emulador ni red.
//
//   node test/ventas-zona.test.mjs

import assert from 'node:assert'
import { ventasPorZona, claveZona, nombreCanonico, mesesConVentas, indiceCoordenadas, esMesValido, MOTIVO_ZONA } from '../src/utils/ventasZona.js'
import { resumenCompras, comprasContables, MOTIVO } from '../src/utils/resumenAdmin.js'

let fallos = 0
function caso(nombre, fn) {
  try { fn(); console.log(`  ✓ ${nombre}`) } catch (e) { fallos++; console.log(`  ✗ ${nombre}\n    ${e.message}`) }
}

const ts = (iso) => ({ toDate: () => new Date(iso) })
let n = 0
const compra = (extra = {}) => ({
  id: `c${++n}`, docenteId: 'D1', creditos: 200, montoMXN: 180, referencia: `REF${n}`,
  status: 'completado', origen: 'creditos_adicionales',
  createdAt: ts('2026-10-10T15:00:00Z'), resueltoEn: ts('2026-10-11T15:00:00Z'), ...extra,
})
const docente = (id, estado, municipio) => ({ id, role: 'docente', estado, municipio })
const DOCS = [
  docente('D1', 'Guanajuato', 'León'),
  docente('D2', 'Guanajuato', 'Irapuato'),
  docente('D3', 'Colima', 'Colima'),
  docente('D4', 'Jalisco', undefined), // estado sin municipio
  docente('D5', undefined, undefined), // sin estado
]
const zona = (r, nombre) => r.porEstado.find((z) => z.estado === nombre)
const total = (compras, mes) => ventasPorZona({ docentes: DOCS, compras, mes })

// El invariante principal, comprobado con el resumen general.
function invariante(compras, mes) {
  const r = total(compras, mes)
  const g = resumenCompras(compras)
  const esperado = mes === null ? g.ingresosMXN : (g.ingresosPorMes.find((m) => m.mes === mes)?.ingresosMXN || 0)
  const centavos = Math.round(r.atribuido.ingresosMXN * 100) + Math.round(r.noAtribuible.ingresosMXN * 100)
  assert.strictEqual(centavos, Math.round(esperado * 100), `atribuido + no atribuible (${centavos / 100}) ≠ resumen (${esperado})`)
  assert.strictEqual(Math.round(r.total.ingresosMXN * 100), Math.round(esperado * 100))
  return r
}

console.log('Ventas por zona\n')

// ── Estados de la compra ──
caso('solo las completadas cuentan: pendientes y rechazadas no son ingreso, compra ni comprador', () => {
  const cs = [compra({ docenteId: 'D1' }), compra({ docenteId: 'D2', status: 'pendiente' }), compra({ docenteId: 'D3', status: 'rechazado' })]
  const r = invariante(cs, null)
  assert.strictEqual(r.total.compras, 1)
  assert.strictEqual(r.atribuido.compradores, 1)
  assert.strictEqual(zona(r, 'Guanajuato').compradores, 1)
  assert.strictEqual(zona(r, 'Colima').compras, 0)
  assert.strictEqual(zona(r, 'Colima').ingresosMXN, 0)
})

caso('importe o créditos inválidos: no son venta contable en ninguna zona', () => {
  const cs = [
    compra({ montoMXN: 0 }), compra({ montoMXN: -5 }), compra({ montoMXN: '180' }), compra({ montoMXN: NaN }),
    compra({ creditos: 0 }), compra({ creditos: undefined }), compra(), // solo esta es válida
  ]
  const r = invariante(cs, null)
  assert.strictEqual(r.total.compras, 1)
  assert.strictEqual(r.total.ingresosMXN, 180)
  assert.strictEqual(r.inconsistencias, 6)
})

caso('misma regla que el resumen: comprasContables ≡ ventas del resumen general', () => {
  const cs = [compra(), compra({ status: 'pendiente' }), compra({ montoMXN: 0 }), compra({ origen: 'otro' }), compra({ docenteId: 'D2', montoMXN: 99.9, creditos: 100 })]
  const lista = comprasContables(cs)
  const g = resumenCompras(cs)
  assert.strictEqual(lista.length, g.comprasCompletadas)
  assert.strictEqual(lista.reduce((a, c) => a + c.centavos, 0), Math.round(g.ingresosMXN * 100))
  assert.strictEqual(lista.reduce((a, c) => a + c.creditos, 0), g.creditosVendidos)
})

caso('origen que no es venta: no cuenta', () => {
  const r = invariante([compra({ origen: 'regalo' }), compra({ origen: undefined }), compra()], null)
  assert.strictEqual(r.total.compras, 1)
})

caso('id repetido: el documento repetido no se cuenta dos veces; se reporta', () => {
  const a = compra({ id: 'X' })
  const r = invariante([a, { ...a }], null)
  assert.strictEqual(r.total.compras, 1)
  assert.strictEqual(r.total.ingresosMXN, 180)
  assert.ok(r.inconsistencias >= 1)
})

caso('duplicados candidatos (mismo docente, créditos y referencia): ambos cuentan y se avisa', () => {
  const r = invariante([compra({ referencia: 'abc 1' }), compra({ referencia: 'ABC  1' })], null)
  assert.strictEqual(r.total.compras, 2)
  assert.strictEqual(r.total.ingresosMXN, 360)
  assert.strictEqual(r.posiblesDuplicados, 1)
  const sinDup = total([compra({ referencia: 'A' }), compra({ referencia: 'B' })], null)
  assert.strictEqual(sinDup.posiblesDuplicados, 0)
})

// ── Atribución a zonas ──
caso('una compra se atribuye al estado y municipio del docente comprador', () => {
  const r = invariante([compra({ docenteId: 'D1' }), compra({ docenteId: 'D2', montoMXN: 90, creditos: 100 })], null)
  const gto = zona(r, 'Guanajuato')
  assert.strictEqual(gto.ingresosMXN, 270)
  assert.strictEqual(gto.compras, 2)
  assert.strictEqual(gto.municipios.find((m) => m.municipio === 'León').ingresosMXN, 180)
  assert.strictEqual(gto.municipios.find((m) => m.municipio === 'Irapuato').ingresosMXN, 90)
  assert.strictEqual(r.noAtribuible.compras, 0)
})

caso('docente comprador inexistente: no atribuible, con su motivo, y sigue en el total', () => {
  const r = invariante([compra({ docenteId: 'FANTASMA' }), compra({ docenteId: undefined }), compra()], null)
  const nb = r.noAtribuible.porMotivo[MOTIVO_ZONA.DOCENTE_INEXISTENTE]
  assert.strictEqual(nb.compras, 2)
  assert.strictEqual(nb.ingresosMXN, 360)
  assert.strictEqual(r.atribuido.ingresosMXN, 180)
  assert.strictEqual(r.total.ingresosMXN, 540)
})

caso('docente sin estado: no atribuible (no se inventa zona ni se usa la escuela)', () => {
  const docs = [{ ...docente('D5', undefined, undefined), escuelaId: 'E1', escuela: { estado: 'GUANAJUATO' } }]
  const r = ventasPorZona({ docentes: docs, compras: [compra({ docenteId: 'D5' })], mes: null })
  assert.strictEqual(r.noAtribuible.porMotivo[MOTIVO_ZONA.ESTADO_FALTANTE].compras, 1)
  assert.strictEqual(r.porEstado.length, 0)
  assert.strictEqual(r.atribuido.ingresosMXN, 0)
})

caso('estado sin municipio: va a su estado; se informa aparte y no se duplica', () => {
  const r = invariante([compra({ docenteId: 'D4' })], null)
  const jal = zona(r, 'Jalisco')
  assert.strictEqual(jal.ingresosMXN, 180)
  assert.strictEqual(jal.municipios.length, 0)
  assert.strictEqual(r.sinMunicipio.ingresosMXN, 180)
  assert.strictEqual(r.noAtribuible.ingresosMXN, 0)
  assert.strictEqual(r.atribuido.ingresosMXN, 180)
})

caso('compradores únicos: varias compras del mismo docente cuentan un comprador', () => {
  const r = invariante([compra({ docenteId: 'D1' }), compra({ docenteId: 'D1' }), compra({ docenteId: 'D1' }), compra({ docenteId: 'D2' })], null)
  const gto = zona(r, 'Guanajuato')
  assert.strictEqual(gto.compras, 4)
  assert.strictEqual(gto.compradores, 2)
  assert.strictEqual(gto.municipios.find((m) => m.municipio === 'León').compradores, 1)
  assert.strictEqual(r.atribuido.compradores, 2)
})

caso('zonas sin compras: aparecen con docentes y ceros; sin compras en absoluto no truena', () => {
  const r = invariante([], null)
  assert.strictEqual(r.total.compras, 0)
  assert.strictEqual(r.total.ingresosMXN, 0)
  assert.strictEqual(zona(r, 'Colima').docentes, 1)
  assert.strictEqual(zona(r, 'Colima').compradores, 0)
  const vacio = ventasPorZona({ docentes: [], compras: [], mes: null })
  assert.deepStrictEqual(vacio.porEstado, [])
  assert.strictEqual(ventasPorZona({ docentes: null, compras: undefined, mes: null }).total.compras, 0)
})

caso('docentes registrados: cada uno cuenta una vez; sin estado y sin municipio se cuentan aparte', () => {
  const r = total([], null)
  assert.strictEqual(r.docentes.total, 5)
  assert.strictEqual(r.docentes.sinEstado, 1)
  assert.strictEqual(r.docentes.conEstadoSinMunicipio, 1)
  assert.strictEqual(r.porEstado.reduce((a, z) => a + z.docentes, 0), 4)
})

// ── Normalización ──
caso('claveZona: mayúsculas, acentos y espacios', () => {
  assert.strictEqual(claveZona('MÉXICO'), claveZona('México'))
  assert.strictEqual(claveZona('  mexico  '), 'mexico')
  assert.strictEqual(claveZona('San  Luis  Potosí'), claveZona('SAN LUIS POTOSI'))
  assert.strictEqual(claveZona(undefined), '')
  assert.strictEqual(claveZona(5), '')
})

caso('«MÉXICO» y «México» se agrupan y se muestra el nombre más usado, no el de todo mayúsculas', () => {
  const docs = [docente('A', 'MÉXICO', 'LERMA'), docente('B', 'México', 'Lerma'), docente('C', 'México', 'Toluca')]
  const r = ventasPorZona({ docentes: docs, compras: [compra({ docenteId: 'A' }), compra({ docenteId: 'B' })], mes: null })
  assert.strictEqual(r.porEstado.length, 1)
  assert.strictEqual(r.porEstado[0].estado, 'México')
  assert.strictEqual(r.porEstado[0].docentes, 3)
  assert.strictEqual(r.porEstado[0].compradores, 2)
  const lerma = r.porEstado[0].municipios.find((m) => m.clave === 'lerma')
  assert.strictEqual(lerma.municipio, 'Lerma')
  assert.strictEqual(lerma.compradores, 2)
})

caso('nombreCanonico: empate → la que no está toda en mayúsculas; nunca inventa un nombre', () => {
  assert.strictEqual(nombreCanonico(['MÉXICO', 'México']), 'México')
  assert.strictEqual(nombreCanonico(['México', 'México', 'MÉXICO']), 'México')
  assert.strictEqual(nombreCanonico(['MÉXICO']), 'MÉXICO')
  assert.strictEqual(nombreCanonico([]), '')
  assert.strictEqual(nombreCanonico([undefined, '  ']), '')
})

caso('indiceCoordenadas: encuentra el municipio aunque cambien mayúsculas o acentos', () => {
  const idx = indiceCoordenadas({ 'México|Lerma': { lat: 1, lng: 2 }, 'Ciudad de México|Álvaro Obregón': { lat: 3, lng: 4 } })
  assert.strictEqual(idx.get(`${claveZona('MÉXICO')}|${claveZona('LERMA')}`).clave, 'México|Lerma')
  assert.strictEqual(idx.get(`${claveZona('Ciudad de Mexico')}|${claveZona('Alvaro Obregon')}`).lat, 3)
  assert.strictEqual(idx.get('x|y'), undefined)
})

// ── Periodos (America/Mexico_City) ──
caso('límites de mes en hora de México: 30-sep 23:59:59 es septiembre; 1-oct 00:00:00 es octubre', () => {
  const sep = compra({ resueltoEn: ts('2026-10-01T05:59:59Z') }) // 23:59:59 del 30-sep en México
  const oct = compra({ resueltoEn: ts('2026-10-01T06:00:00Z') }) // 00:00:00 del 1-oct en México
  const rSep = invariante([sep, oct], '2026-09')
  const rOct = invariante([sep, oct], '2026-10')
  assert.strictEqual(rSep.total.compras, 1)
  assert.strictEqual(rOct.total.compras, 1)
  assert.strictEqual(invariante([sep, oct], null).total.compras, 2)
})

caso('un mes sin compras: ceros, y los docentes siguen contando', () => {
  const r = invariante([compra()], '2026-01')
  assert.strictEqual(r.total.compras, 0)
  assert.strictEqual(r.total.ingresosMXN, 0)
  assert.strictEqual(r.docentes.total, 5)
  assert.strictEqual(zona(r, 'Guanajuato').compradores, 0)
})

caso('sin resueltoEn: cuenta en «Todo el tiempo» y en su zona, pero no se asigna a ningún mes', () => {
  const sin = compra({ resueltoEn: undefined, docenteId: 'D3' })
  const mala = compra({ resueltoEn: 'ayer', docenteId: 'D3' })
  const con = compra({ docenteId: 'D1' }) // octubre
  const todo = invariante([sin, mala, con], null)
  assert.strictEqual(todo.total.compras, 3)
  assert.strictEqual(zona(todo, 'Colima').ingresosMXN, 360)
  assert.strictEqual(todo.sinFechaValida.compras, 0)
  const oct = invariante([sin, mala, con], '2026-10')
  assert.strictEqual(oct.total.compras, 1)
  assert.strictEqual(zona(oct, 'Colima').ingresosMXN, 0)
  assert.strictEqual(oct.sinFechaValida.compras, 2)
  assert.strictEqual(oct.sinFechaValida.ingresosMXN, 360)
  // No están dentro del total del mes, pero el resumen general sí las tiene.
  assert.strictEqual(resumenCompras([sin, mala, con]).ingresosMXN, 540)
  assert.strictEqual(resumenCompras([sin, mala, con]).comprasSinMes, 2)
})

caso('fechas de resolución con motivo distinto: ausente e inválida se distinguen', () => {
  const l = comprasContables([compra({ resueltoEn: undefined }), compra({ resueltoEn: 'x' }), compra()])
  assert.deepStrictEqual(l.map((c) => c.motivoSinFecha), [MOTIVO.SIN_FECHA_RESOLUCION, MOTIVO.FECHA_RESOLUCION_INVALIDA, null])
})

caso('el mes se toma de resueltoEn, no de createdAt', () => {
  const c = compra({ createdAt: ts('2026-08-01T12:00:00Z'), resueltoEn: ts('2026-10-11T15:00:00Z') })
  assert.strictEqual(invariante([c], '2026-08').total.compras, 0)
  assert.strictEqual(invariante([c], '2026-10').total.compras, 1)
})

caso('mesesConVentas: meses con ventas contables (más reciente primero) más el mes actual', () => {
  const cs = [compra({ resueltoEn: ts('2026-08-15T15:00:00Z') }), compra({ resueltoEn: ts('2026-10-11T15:00:00Z') }), compra({ status: 'pendiente', resueltoEn: ts('2026-05-01T15:00:00Z') })]
  assert.deepStrictEqual(mesesConVentas(cs, new Date('2026-11-05T15:00:00Z')), ['2026-11', '2026-10', '2026-08'])
  assert.deepStrictEqual(mesesConVentas([], new Date('2026-11-05T15:00:00Z')), ['2026-11'])
})

caso('mes inválido: se rechaza en vez de adivinar', () => {
  assert.throws(() => ventasPorZona({ docentes: [], compras: [], mes: '2026-13' }))
  assert.throws(() => ventasPorZona({ docentes: [], compras: [], mes: 'octubre' }))
  assert.ok(esMesValido('2026-10') && !esMesValido('2026-1') && !esMesValido(undefined))
})

// ── Invariante en escenarios mixtos y de redondeo ──
caso('invariante con mezcla de ubicadas, no ubicadas, sin fecha y varios meses (todos los periodos)', () => {
  const cs = [
    compra({ docenteId: 'D1', montoMXN: 180.1, resueltoEn: ts('2026-08-03T15:00:00Z') }),
    compra({ docenteId: 'D2', montoMXN: 0.2, creditos: 1, resueltoEn: ts('2026-08-20T15:00:00Z') }),
    compra({ docenteId: 'D3', montoMXN: 0.1, creditos: 1, resueltoEn: ts('2026-09-10T15:00:00Z') }),
    compra({ docenteId: 'D4', montoMXN: 333.33, creditos: 300, resueltoEn: ts('2026-09-30T15:00:00Z') }),
    compra({ docenteId: 'D5', montoMXN: 50, creditos: 50, resueltoEn: ts('2026-09-11T15:00:00Z') }),
    compra({ docenteId: 'NADIE', montoMXN: 70, creditos: 70, resueltoEn: ts('2026-09-12T15:00:00Z') }),
    compra({ docenteId: 'D1', montoMXN: 1000, creditos: 1100 }), // sin fecha
    compra({ docenteId: 'D2', status: 'pendiente', montoMXN: 999 }),
    compra({ docenteId: 'D2', status: 'rechazado', montoMXN: 888 }),
  ]
  for (const mes of [null, '2026-08', '2026-09', '2026-10']) invariante(cs, mes)
  const ago = total(cs, '2026-08')
  assert.strictEqual(ago.total.ingresosMXN, 180.3) // 180.1 + 0.2 sin deriva de coma flotante
  assert.strictEqual(total(cs, null).total.ingresosMXN, 1633.73)
})

caso('no modifica sus entradas', () => {
  const docs = JSON.parse(JSON.stringify(DOCS))
  const cs = [compra(), compra({ docenteId: 'D4' })]
  const antes = JSON.stringify([docs, cs])
  ventasPorZona({ docentes: docs, compras: cs, mes: '2026-10' })
  assert.strictEqual(JSON.stringify([docs, cs]), antes)
})

console.log(fallos ? `\n${fallos} caso(s) fallaron` : '\nTodo bien')
process.exit(fallos ? 1 : 0)
