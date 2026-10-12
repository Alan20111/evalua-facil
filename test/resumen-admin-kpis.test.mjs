// Etapa 2B — estudiantes, registros, meses, indicadores y avisos del Resumen.
// Funciones puras: no necesita emulador ni red.
//
//   node test/resumen-admin-kpis.test.mjs

import assert from 'node:assert'
import {
  mesDe, mesActual, ultimosMeses, rellenarMeses, claveEstudiante, estudiantesUnicos,
  registrosPorMes, kpisResumen, cuandoConsultaAuth,
} from '../src/utils/resumenAdmin.js'

let fallos = 0
function caso(nombre, fn) {
  try { fn(); console.log(`  ✓ ${nombre}`) } catch (e) { fallos++; console.log(`  ✗ ${nombre}\n    ${e.message}`) }
}
const ts = (iso) => ({ toDate: () => new Date(iso) })
const AHORA = new Date('2026-10-11T18:00:00Z')

console.log('meses (zona de México)')
caso('mesActual usa la zona de México, no UTC', () => {
  assert.strictEqual(mesActual(new Date('2026-11-01T05:30:00Z')), '2026-10') // 23:30 del 31-oct en CDMX
  assert.strictEqual(mesActual(new Date('2026-11-01T07:00:00Z')), '2026-11')
})
caso('mesDe acepta Timestamp y rechaza lo inválido', () => {
  assert.strictEqual(mesDe(ts('2026-10-05T18:00:00Z')), '2026-10')
  assert.strictEqual(mesDe('2026-10-05'), null)
  assert.strictEqual(mesDe(null), null)
  assert.strictEqual(mesDe(new Date('x')), null)
})
caso('ultimosMeses: seis meses que terminan en el actual', () => {
  assert.deepStrictEqual(ultimosMeses(6, AHORA), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
})
caso('ultimosMeses cruza el cambio de año', () => {
  assert.deepStrictEqual(ultimosMeses(6, new Date('2026-01-15T18:00:00Z')), ['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01'])
})
caso('ultimosMeses con fecha o cantidad inválidas → vacío', () => {
  assert.deepStrictEqual(ultimosMeses(6, 'hoy'), [])
  assert.deepStrictEqual(ultimosMeses(0, AHORA), [])
  assert.deepStrictEqual(ultimosMeses(2.5, AHORA), [])
})
caso('rellenarMeses: los meses sin movimiento valen 0, los demás conservan su valor', () => {
  const r = rellenarMeses(['2026-08', '2026-09', '2026-10'], [{ mes: '2026-09', registros: 31 }], 'registros')
  assert.deepStrictEqual(r, [{ mes: '2026-08', valor: 0 }, { mes: '2026-09', valor: 31 }, { mes: '2026-10', valor: 0 }])
})

console.log('estudiantes: personas, no inscripciones')
const insc = (username, extra = {}) => ({ id: `s${Math.random()}`, username, escuelaId: 'E1', asignaturaId: 'A1', activado: false, ...extra })
caso('claveEstudiante normaliza usuario y escuela', () => {
  assert.strictEqual(claveEstudiante({ username: ' ABCD ', escuelaId: 'E1' }), 'abcd|e1')
  assert.strictEqual(claveEstudiante({ username: '', escuelaId: 'E1' }), null)
  assert.strictEqual(claveEstudiante(null), null)
})
caso('la misma persona en tres asignaturas cuenta una sola vez', () => {
  const r = estudiantesUnicos([insc('abcd'), insc('ABCD', { asignaturaId: 'A2' }), insc('abcd', { asignaturaId: 'A3' })])
  assert.strictEqual(r.inscripciones, 3)
  assert.strictEqual(r.personas, 1)
})
caso('activada = al menos una inscripción activada; las mixtas se cuentan y se identifican', () => {
  const r = estudiantesUnicos([
    insc('uno', { activado: true }), insc('uno', { activado: false, asignaturaId: 'A2' }),
    insc('dos', { activado: true }), insc('dos', { activado: true, asignaturaId: 'A2' }),
    insc('tres'), insc('tres', { asignaturaId: 'A2' }),
  ])
  assert.strictEqual(r.personas, 3)
  assert.strictEqual(r.activadas, 2)
  assert.strictEqual(r.sinActivar, 1)
  assert.deepStrictEqual(r.mixtas, [{ clave: 'uno|e1', inscripciones: 2, activadas: 1 }])
})
caso('sin usuario cada documento es una persona', () => {
  const r = estudiantesUnicos([{ id: 'x1', activado: true }, { id: 'x2', activado: false }])
  assert.strictEqual(r.personas, 2)
  assert.strictEqual(r.activadas, 1)
})
caso('REGRESIÓN del informe: 957 inscripciones → 609 personas, 221 activadas (219 + 2 mixtas), 388 sin activar', () => {
  const lista = []
  let n = 0
  const persona = (k, inscs, activadasN) => { for (let i = 0; i < inscs; i++) lista.push({ id: `i${++n}`, username: `u${k}`, escuelaId: 'E1', asignaturaId: 'A1', activado: i < activadasN }) }
  let k = 0
  for (let i = 0; i < 219; i++) persona(k++, 1, 1)   // todas activadas
  for (let i = 0; i < 2; i++) persona(k++, 2, 1)     // mixtas
  for (let i = 0; i < 388; i++) persona(k++, 1, 0)   // ninguna activada
  // El resto de las inscripciones son de personas que ya cuentan (más asignaturas).
  while (lista.length < 957) lista.push({ id: `i${++n}`, username: 'u0', escuelaId: 'E1', asignaturaId: 'A9', activado: true })
  const r = estudiantesUnicos(lista)
  assert.strictEqual(r.inscripciones, 957)
  assert.strictEqual(r.personas, 609)
  assert.strictEqual(r.activadas, 221)
  assert.strictEqual(r.sinActivar, 388)
  assert.strictEqual(r.mixtas.length, 2)
})
caso('la persona ligada solo a un docente inexistente SE CUENTA y se identifica', () => {
  const subjectsMap = { A1: { docenteId: 'D1' }, A2: { docenteId: 'DBAJA' } }
  const r = estudiantesUnicos([insc('ok'), insc('huerfano', { asignaturaId: 'A2' }), insc('mixto', { asignaturaId: 'A2' }), insc('mixto')], { subjectsMap, docentesIds: ['D1'] })
  assert.strictEqual(r.personas, 3)
  assert.deepStrictEqual(r.soloDeDocenteInexistente, [{ clave: 'huerfano|e1' }])
})
caso('docente tomado de la asignatura, con el campo viejo como respaldo; sin ninguno → sin docente identificable', () => {
  const r = estudiantesUnicos([
    insc('a', { asignaturaId: 'NO_EXISTE', docenteId: 'D1' }),
    insc('b', { asignaturaId: 'NO_EXISTE' }),
  ], { subjectsMap: {}, docentesIds: ['D1'] })
  assert.strictEqual(r.sinDocenteResoluble, 1)
  assert.deepStrictEqual(r.soloDeDocenteInexistente, [])
})
caso('vacío, nulo y documentos inválidos', () => {
  for (const e of [[], null, undefined]) assert.deepStrictEqual({ p: estudiantesUnicos(e).personas, i: estudiantesUnicos(e).inscripciones }, { p: 0, i: 0 })
  const r = estudiantesUnicos([null, 4, 'x', [], insc('ok')])
  assert.strictEqual(r.personas, 1)
  assert.strictEqual(r.documentosInvalidos, 4)
})

console.log('registros por mes (Firebase Authentication)')
caso('lee el texto que devuelve Auth y agrupa por mes de México', () => {
  const r = registrosPorMes({
    d1: 'Tue, 11 Aug 2026 14:03:00 GMT',
    d2: 'Sat, 31 Oct 2026 23:00:00 GMT',  // 17:00 del 31-oct en México → octubre
    d3: 'Sun, 01 Nov 2026 05:30:00 GMT',  // 23:30 del 31-oct en México → octubre
    d4: 'Sun, 01 Nov 2026 07:00:00 GMT',  // 01:00 del 1-nov en México → noviembre
  }, ['d1', 'd2', 'd3', 'd4'])
  assert.deepStrictEqual(r.porMes, [{ mes: '2026-08', registros: 1 }, { mes: '2026-10', registros: 2 }, { mes: '2026-11', registros: 1 }])
  assert.strictEqual(r.conFecha, 4)
  assert.strictEqual(r.sinFecha, 0)
})
caso('sin fecha, vacía o inválida: se cuenta aparte y no cae en ningún mes', () => {
  const r = registrosPorMes({ d1: null, d2: '', d3: 'no es fecha', d4: '1970-01-01T00:00:00Z', d5: 'Tue, 11 Aug 2026 14:03:00 GMT' }, ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'])
  assert.strictEqual(r.sinFecha, 5)
  assert.strictEqual(r.conFecha, 1)
  assert.deepStrictEqual(r.porMes, [{ mes: '2026-08', registros: 1 }])
})
caso('solo cuenta a los docentes pedidos, no a cualquier uid del mapa', () => {
  const r = registrosPorMes({ d1: 'Tue, 11 Aug 2026 14:03:00 GMT', admin: 'Tue, 11 Aug 2026 14:03:00 GMT' }, ['d1'])
  assert.strictEqual(r.conFecha, 1)
})
caso('mapa vacío o nulo: todos sin fecha, ninguno en un mes', () => {
  for (const m of [{}, null, undefined]) {
    const r = registrosPorMes(m, ['d1', 'd2'])
    assert.deepStrictEqual({ s: r.sinFecha, c: r.conFecha, p: r.porMes }, { s: 2, c: 0, p: [] })
  }
})

// ── Escenario del informe de la auditoría ──────────────────────────────────
function escenarioInforme() {
  const docentes = Array.from({ length: 69 }, (_, i) => ({ id: `D${i}` }))
  const distribucion = [['2026-06', 3], ['2026-07', 8], ['2026-08', 14], ['2026-09', 31], ['2026-10', 13]]
  const creadoEn = {}
  let i = 0
  distribucion.forEach(([mes, n]) => { for (let k = 0; k < n; k++) creadoEn[`D${i++}`] = `${mes}-15T18:00:00Z` })
  // creationTime de Auth viene como texto RFC 1123
  Object.keys(creadoEn).forEach((id) => { creadoEn[id] = new Date(creadoEn[id]).toUTCString() })
  const compras = [
    { id: 'c1', docenteId: 'D0', creditos: 200, montoMXN: 180, status: 'completado', origen: 'creditos_adicionales', referencia: 'A1B2C3', createdAt: ts('2026-10-10T15:00:00Z'), resueltoEn: ts('2026-10-11T15:00:00Z') },
    { id: 'c2', docenteId: 'D1', creditos: 50, montoMXN: 50, status: 'rechazado', origen: 'creditos_adicionales', referencia: 'Z9Y8X7', createdAt: ts('2026-08-10T15:00:00Z'), resueltoEn: ts('2026-08-11T15:00:00Z') },
  ]
  const students = [
    { id: 's1', username: 'ana1', escuelaId: 'E1', asignaturaId: 'A1', activado: true },
    { id: 's2', username: 'ana1', escuelaId: 'E1', asignaturaId: 'A2', activado: false },
    { id: 's3', username: 'beto', escuelaId: 'E1', asignaturaId: 'A1', activado: false },
    { id: 's4', username: 'cris', escuelaId: 'E1', asignaturaId: 'ABAJA', activado: false },
  ]
  const subjectsMap = { A1: { docenteId: 'D0' }, A2: { docenteId: 'D0' }, ABAJA: { docenteId: 'DINEXISTENTE' } }
  return { docentes, creadoEn, compras, students, subjectsMap }
}

console.log('indicadores del Resumen')
caso('REGRESIÓN del informe: 69 docentes, $180, 200 créditos, 13 registros de octubre', () => {
  const e = escenarioInforme()
  const k = kpisResumen({ ...e, authDisponible: true, authEstado: 'listo', ahora: AHORA })
  assert.strictEqual(k.docentes, 69)
  assert.strictEqual(k.mes, '2026-10')
  assert.deepStrictEqual(k.ventas, { creditosVendidos: 200, ingresosMXN: 180, completadas: 1, pendientes: 0, rechazadas: 1 })
  assert.deepStrictEqual(k.delMes, { mes: '2026-10', registros: 13, compras: 1, ingresosMXN: 180, creditosVendidos: 200 })
  assert.deepStrictEqual(k.series.meses, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
  assert.deepStrictEqual(k.series.registros.map((f) => f.valor), [0, 3, 8, 14, 31, 13])
  assert.deepStrictEqual(k.series.ingresos.map((f) => f.valor), [0, 0, 0, 0, 0, 180])
})
caso('los $99 históricos de payments no entran: solo se leen compras de créditos', () => {
  const e = escenarioInforme()
  const pagoViejo = { id: 'p1', docenteId: 'D3', monto: 99, status: 'completado', metodo: 'mercadopago' }
  const k = kpisResumen({ ...e, compras: [...e.compras, pagoViejo], authDisponible: true, authEstado: 'listo', ahora: AHORA })
  assert.strictEqual(k.ventas.ingresosMXN, 180)
})
caso('estudiantes del escenario: personas, activadas y avisos de mixtas y de docente inexistente', () => {
  const e = escenarioInforme()
  const k = kpisResumen({ ...e, authDisponible: true, authEstado: 'listo', ahora: AHORA })
  assert.deepStrictEqual(k.estudiantes, { inscripciones: 4, personas: 3, activadas: 1, sinActivar: 2 })
  const ids = k.avisos.map((a) => a.id)
  assert.deepStrictEqual(ids, ['docente-inexistente', 'mixtas']) // «revisar» antes que «info»
  assert.deepStrictEqual(k.avisos.find((a) => a.id === 'mixtas').detalle, ['ana1|e1 (1 de 2)'])
  assert.deepStrictEqual(k.avisos.find((a) => a.id === 'docente-inexistente').detalle, ['cris|e1'])
})
caso('mientras Auth no está confirmado, los registros son null (no 0) y no hay aviso si solo está cargando', () => {
  const e = escenarioInforme()
  const k = kpisResumen({ ...e, authDisponible: false, authEstado: 'cargando', ahora: AHORA })
  assert.strictEqual(k.delMes.registros, null)
  assert.strictEqual(k.series.registros, null)
  assert.ok(!k.avisos.some((a) => a.id === 'auth'))
  // Lo que no depende de Auth sigue disponible.
  assert.strictEqual(k.ventas.ingresosMXN, 180)
  assert.strictEqual(k.docentes, 69)
})
caso('si Auth se agota o falla, los registros siguen en null y se avisa', () => {
  for (const estado of ['agotado', 'error']) {
    const k = kpisResumen({ ...escenarioInforme(), authDisponible: false, authEstado: estado, ahora: AHORA })
    assert.strictEqual(k.delMes.registros, null)
    assert.ok(k.avisos.some((a) => a.id === 'auth' && a.nivel === 'revisar'))
  }
})
caso('un 0 de registros solo aparece cuando Auth está confirmado y de verdad no hubo registros en el mes', () => {
  const k = kpisResumen({ docentes: [{ id: 'D1' }], students: [], compras: [], creadoEn: { D1: 'Tue, 11 Aug 2026 14:03:00 GMT' }, authDisponible: true, authEstado: 'listo', ahora: AHORA })
  assert.strictEqual(k.delMes.registros, 0)
})
caso('con ahora inválido no hay mes ni se inventa un 0', () => {
  const k = kpisResumen({ ...escenarioInforme(), authDisponible: true, authEstado: 'listo', ahora: 'hoy' })
  assert.strictEqual(k.mes, null)
  assert.strictEqual(k.delMes.registros, null)
  assert.deepStrictEqual(k.series.meses, [])
})
caso('pendientes y rechazadas se muestran aparte y no suman a ventas', () => {
  const e = escenarioInforme()
  const extra = { id: 'c3', docenteId: 'D2', creditos: 100, montoMXN: 90, status: 'pendiente', origen: 'creditos_adicionales', referencia: 'P1', createdAt: ts('2026-10-11T10:00:00Z') }
  const k = kpisResumen({ ...e, compras: [...e.compras, extra], authDisponible: true, authEstado: 'listo', ahora: AHORA })
  assert.strictEqual(k.ventas.pendientes, 1)
  assert.strictEqual(k.ventas.rechazadas, 1)
  assert.strictEqual(k.ventas.ingresosMXN, 180)
  assert.strictEqual(k.ventas.creditosVendidos, 200)
})
caso('compras de otro mes no cuentan en «del mes» pero sí en el total y en su mes de la serie', () => {
  const e = escenarioInforme()
  const sep = { id: 'c9', docenteId: 'D4', creditos: 100, montoMXN: 90, status: 'completado', origen: 'creditos_adicionales', referencia: 'S1', createdAt: ts('2026-09-01T10:00:00Z'), resueltoEn: ts('2026-09-02T10:00:00Z') }
  const k = kpisResumen({ ...e, compras: [...e.compras, sep], authDisponible: true, authEstado: 'listo', ahora: AHORA })
  assert.strictEqual(k.ventas.ingresosMXN, 270)
  assert.strictEqual(k.delMes.ingresosMXN, 180)
  assert.deepStrictEqual(k.series.ingresos.map((f) => f.valor), [0, 0, 0, 0, 90, 180])
})

console.log('avisos de revisión')
caso('sin nada que revisar no hay avisos', () => {
  const k = kpisResumen({ docentes: [{ id: 'D1' }], students: [{ id: 's', username: 'a', escuelaId: 'E', asignaturaId: 'A1', activado: true }], subjectsMap: { A1: { docenteId: 'D1' } },
    compras: [], creadoEn: { D1: 'Tue, 11 Aug 2026 14:03:00 GMT' }, authDisponible: true, authEstado: 'listo', ahora: AHORA })
  assert.deepStrictEqual(k.avisos, [])
})
caso('posibles duplicados con 2 completadas: aviso «revisar», sin descartar ninguna', () => {
  const base = { docenteId: 'D1', creditos: 200, montoMXN: 180, status: 'completado', origen: 'creditos_adicionales', referencia: 'IGUAL', createdAt: ts('2026-10-01T10:00:00Z'), resueltoEn: ts('2026-10-02T10:00:00Z') }
  const k = kpisResumen({ docentes: [{ id: 'D1' }], students: [], compras: [{ ...base, id: 'a' }, { ...base, id: 'b' }], authDisponible: true, creditos: null, creadoEn: { D1: 'Tue, 11 Aug 2026 14:03:00 GMT' }, ahora: AHORA })
  assert.strictEqual(k.ventas.ingresosMXN, 360)
  const a = k.avisos.find((x) => x.id === 'duplicados')
  assert.ok(a && a.nivel === 'revisar')
  assert.deepStrictEqual(a.detalle, ['IGUAL · 200 créditos'])
})
caso('un reenvío tras un rechazo no genera aviso', () => {
  const base = { docenteId: 'D1', creditos: 200, montoMXN: 180, origen: 'creditos_adicionales', referencia: 'REENVIO', createdAt: ts('2026-10-01T10:00:00Z'), resueltoEn: ts('2026-10-02T10:00:00Z') }
  const k = kpisResumen({ docentes: [{ id: 'D1' }], students: [], compras: [{ ...base, id: 'a', status: 'rechazado' }, { ...base, id: 'b', status: 'completado' }], authDisponible: true, creadoEn: { D1: 'Tue, 11 Aug 2026 14:03:00 GMT' }, ahora: AHORA })
  assert.ok(!k.avisos.some((x) => x.id === 'duplicados'))
})
caso('completadas con datos no válidos, sin fecha de resolución y documentos apartados se avisan', () => {
  const ok = { origen: 'creditos_adicionales', docenteId: 'D1', creditos: 200, montoMXN: 180, status: 'completado', createdAt: ts('2026-10-01T10:00:00Z') }
  const k = kpisResumen({
    docentes: [{ id: 'D1' }], students: [], authDisponible: true, creadoEn: { D1: 'Tue, 11 Aug 2026 14:03:00 GMT' }, ahora: AHORA,
    compras: [
      { ...ok, id: 'a', montoMXN: 'x', resueltoEn: ts('2026-10-02T10:00:00Z') },        // importe inválido
      { ...ok, id: 'b', referencia: 'R1' },                                              // sin resueltoEn
      { id: 'c', status: 'completado', creditos: 30, montoMXN: 0, origen: 'regalo' },    // no es venta
    ],
  })
  const ids = k.avisos.map((a) => a.id)
  assert.ok(ids.includes('excluidas') && ids.includes('sin-mes') && ids.includes('apartados'))
  assert.strictEqual(k.ventas.ingresosMXN, 180) // la de b entra en el total aunque no tenga mes
  assert.strictEqual(k.delMes.ingresosMXN, 0)
})
caso('docentes sin fecha de registro en Auth se avisan', () => {
  const k = kpisResumen({ docentes: [{ id: 'D1' }, { id: 'D2' }], students: [], compras: [], creadoEn: { D1: 'Tue, 11 Aug 2026 14:03:00 GMT' }, authDisponible: true, authEstado: 'listo', ahora: AHORA })
  assert.ok(k.avisos.some((a) => a.id === 'registros-sin-fecha'))
})
caso('los avisos «revisar» van antes que los «info»', () => {
  const e = escenarioInforme()
  const k = kpisResumen({ ...e, authDisponible: true, authEstado: 'listo', ahora: AHORA })
  const niveles = k.avisos.map((a) => a.nivel)
  assert.deepStrictEqual(niveles, [...niveles].sort((a, b) => (a === b ? 0 : a === 'revisar' ? -1 : 1)))
})

console.log('datos de Auth desactualizados (una consulta falló después de una correcta)')
const OK_AUTH = { authDisponible: true, authEstado: 'listo' }
caso('cuandoConsultaAuth: hoy dice solo la hora (hora de México); otro día incluye la fecha', () => {
  const ahora = new Date('2026-10-11T20:00:00Z')
  assert.strictEqual(cuandoConsultaAuth(new Date('2026-10-11T19:35:00Z'), ahora), 'de las 13:35')
  assert.strictEqual(cuandoConsultaAuth(new Date('2026-10-09T15:05:00Z'), ahora), 'del 9 oct a las 09:05')
})
caso('cuandoConsultaAuth usa la zona de México para decidir si es «hoy»', () => {
  // 05:30 UTC del 12-oct son las 23:30 del 11-oct en México: el mismo día que `ahora`.
  assert.strictEqual(cuandoConsultaAuth(new Date('2026-10-12T05:30:00Z'), new Date('2026-10-11T20:00:00Z')), 'de las 23:30')
})
caso('cuandoConsultaAuth no inventa una hora', () => {
  for (const v of [null, undefined, 'ayer', new Date('x'), {}]) assert.strictEqual(cuandoConsultaAuth(v, AHORA), null)
})
caso('con datos desactualizados se avisa, con la hora de la consulta anterior', () => {
  const k = kpisResumen({ ...escenarioInforme(), ...OK_AUTH, authObsoleto: true, authActualizadoEn: new Date('2026-10-11T19:35:00Z'), ahora: new Date('2026-10-11T20:00:00Z') })
  const a = k.avisos.find((x) => x.id === 'auth-obsoleto')
  assert.ok(a && a.nivel === 'revisar')
  assert.ok(a.texto.includes('a la consulta de las 13:35'), a.texto)
  assert.ok(/fechas de registro y los últimos accesos/.test(a.texto))
})
caso('los datos anteriores se conservan: los registros siguen con su valor, no pasan a —', () => {
  const k = kpisResumen({ ...escenarioInforme(), ...OK_AUTH, authObsoleto: true, authActualizadoEn: new Date('2026-10-11T19:35:00Z'), ahora: AHORA })
  assert.strictEqual(k.delMes.registros, 13)
  assert.deepStrictEqual(k.series.registros.map((f) => f.valor), [0, 3, 8, 14, 31, 13])
})
caso('sin consulta correcta previa NO es «desactualizado»: es «sin datos» (—) y avisa distinto', () => {
  const k = kpisResumen({ ...escenarioInforme(), authDisponible: false, authEstado: 'error', authObsoleto: false, ahora: AHORA })
  assert.strictEqual(k.delMes.registros, null)
  assert.ok(k.avisos.some((a) => a.id === 'auth'))
  assert.ok(!k.avisos.some((a) => a.id === 'auth-obsoleto'))
})
caso('cuando una consulta nueva termina bien el aviso desaparece', () => {
  const k = kpisResumen({ ...escenarioInforme(), ...OK_AUTH, authObsoleto: false, authActualizadoEn: new Date('2026-10-11T19:50:00Z'), ahora: AHORA })
  assert.ok(!k.avisos.some((a) => a.id === 'auth-obsoleto' || a.id === 'auth'))
})
caso('si no se conoce la hora de la consulta anterior se dice «anterior», sin inventar una', () => {
  const k = kpisResumen({ ...escenarioInforme(), ...OK_AUTH, authObsoleto: true, authActualizadoEn: null, ahora: AHORA })
  const a = k.avisos.find((x) => x.id === 'auth-obsoleto')
  assert.ok(a.texto.includes('consulta anterior'))
  assert.ok(!/\d{2}:\d{2}/.test(a.texto))
})

console.log('determinismo')
caso('mismas entradas → mismo resultado, y las entradas no se modifican', () => {
  const e = escenarioInforme()
  const congelar = (x) => { Object.freeze(x); if (x && typeof x === 'object') Object.values(x).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) congelar(v) }); return x }
  congelar(e)
  const a = kpisResumen({ ...e, authDisponible: true, authEstado: 'listo', ahora: AHORA })
  const b = kpisResumen({ ...e, authDisponible: true, authEstado: 'listo', ahora: AHORA })
  assert.deepStrictEqual(a, b)
})

if (fallos) { console.log(`\n${fallos} caso(s) fallaron`); process.exit(1) }
console.log('\nTodo bien')
