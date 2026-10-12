// Reglas de presentación de la tabla «Registros». Funciones puras: no necesita
// emulador ni red.
//
//   node test/registros-tabla.test.mjs

import assert from 'node:assert'
import {
  nombreCompletoDocente, saldoIAVisible, compararNumerico, siguienteOrden,
  fechaDeRegistro, formatoFechaMX, diaMX, metodoDeRegistro, textoUltimaCompra, estudiantesPorDocente,
  correosDuplicados, diasSinAcceso, compararPorRegistro, construirFilasRegistros,
} from '../src/utils/registrosTabla.js'
import { ultimaCompraPorDocente } from '../src/utils/resumenAdmin.js'

let fallos = 0
function caso(nombre, fn) {
  try { fn(); console.log(`  ✓ ${nombre}`) } catch (e) { fallos++; console.log(`  ✗ ${nombre}\n    ${e.message}`) }
}

console.log('nombreCompletoDocente')
caso('nombre + paterno + materno', () =>
  assert.strictEqual(nombreCompletoDocente({ nombre: 'Laura', apellidoPaterno: 'García', apellidoMaterno: 'López', nombreMostrar: 'Profa. Laura' }), 'Laura García López'))
caso('sin materno', () =>
  assert.strictEqual(nombreCompletoDocente({ nombre: 'Laura', apellidoPaterno: 'García', apellidoMaterno: '  ' }), 'Laura García'))
caso('todo en mayúsculas se endereza', () =>
  assert.strictEqual(nombreCompletoDocente({ nombre: 'LAURA', apellidoPaterno: 'GARCÍA' }), 'Laura García'))
caso('cada parte se capitaliza por separado (una en mayúsculas, otra no)', () =>
  assert.strictEqual(nombreCompletoDocente({ nombre: 'Laura', apellidoPaterno: 'GARCÍA', apellidoMaterno: 'lópez' }), 'Laura García López'))
caso('respeta la mezcla que alguien tecleó a propósito dentro de una parte', () =>
  assert.strictEqual(nombreCompletoDocente({ nombre: 'MARÍA', apellidoPaterno: 'de la Cruz', apellidoMaterno: 'McDonald' }), 'María de la Cruz McDonald'))
caso('falta el paterno → nombreMostrar', () =>
  assert.strictEqual(nombreCompletoDocente({ nombre: 'Laura', nombreMostrar: 'Profa. Laura G.', username: 'X-01' }), 'Profa. Laura G.'))
caso('sin nombreMostrar → nombre suelto (constancia de baja)', () =>
  assert.strictEqual(nombreCompletoDocente({ nombre: 'Laura Pérez' }), 'Laura Pérez'))
caso('sin nada → username tal cual', () =>
  assert.strictEqual(nombreCompletoDocente({ username: 'CBTIS255-01' }), 'CBTIS255-01'))
caso('sin nada de nada → vacío (el llamador pone el guion)', () =>
  assert.strictEqual(nombreCompletoDocente({ email: 'a@b.mx' }), ''))
caso('no toca el objeto ni deduce del correo', () => {
  const t = Object.freeze({ email: 'laura.garcia@x.mx' })
  assert.strictEqual(nombreCompletoDocente(t), '')
})

console.log('saldoIAVisible')
const listo = { uid: 'u1', creditosListos: true, regaloListo: true }
const sinActivar = { bienvenidaDisponible: true, bienvenidaActivada: false, creditosBienvenida: 30 }
const activada = { bienvenidaDisponible: true, bienvenidaActivada: true, creditosBienvenida: 30 }
caso('sin activar y sin doc de créditos → guion', () =>
  assert.strictEqual(saldoIAVisible({ ...listo, registro: sinActivar }), null))
caso('activada con saldo 0 → 0', () =>
  assert.strictEqual(saldoIAVisible({ ...listo, registro: activada, creditos: { saldo: 0 } }), 0))
caso('activada con saldo → saldo real', () =>
  assert.strictEqual(saldoIAVisible({ ...listo, registro: activada, creditos: { saldo: 12.5 } }), 12.5))
caso('sin activar pero con saldo positivo → no se oculta', () =>
  assert.strictEqual(saldoIAVisible({ ...listo, registro: sinActivar, creditos: { saldo: 5 } }), 5))
caso('sin registro → 0 (como hoy)', () =>
  assert.strictEqual(saldoIAVisible({ ...listo, registro: undefined }), 0))
caso('sin regalo (no disponible) → 0', () =>
  assert.strictEqual(saldoIAVisible({ ...listo, registro: { bienvenidaDisponible: false, bienvenidaActivada: false } }), 0))
caso('sin permiso para leer el regalo → 0', () =>
  assert.strictEqual(saldoIAVisible({ uid: 'u1', creditosListos: true, regaloListo: false, regaloSinPermiso: true }), 0))
caso('creditos aún cargando → guion, no 0', () =>
  assert.strictEqual(saldoIAVisible({ uid: 'u1', creditosListos: false, regaloListo: true, registro: activada }), null))
caso('registro de regalo aún cargando → guion, no 0', () =>
  assert.strictEqual(saldoIAVisible({ uid: 'u1', creditosListos: true, regaloListo: false }), null))
caso('saldo positivo se muestra aunque el registro siga cargando', () =>
  assert.strictEqual(saldoIAVisible({ uid: 'u1', creditosListos: true, regaloListo: false, creditos: { saldo: 30 } }), 30))
caso('cuenta eliminada o sin uid → guion', () => {
  assert.strictEqual(saldoIAVisible({ ...listo, cuentaEliminada: true, creditos: { saldo: 9 } }), null)
  assert.strictEqual(saldoIAVisible({ ...listo, uid: null }), null)
})

console.log('compararNumerico / siguienteOrden')
const ordenar = (xs, dir) => [...xs].sort((a, b) => compararNumerico(a, b, dir))
caso('ascendente numérico (no alfabético) y empieza en cero', () =>
  assert.deepStrictEqual(ordenar([10, 2, 0, 1, 33, 9], 'asc'), [0, 1, 2, 9, 10, 33]))
caso('descendente', () =>
  assert.deepStrictEqual(ordenar([10, 2, 0, 1, 33, 9], 'desc'), [33, 10, 9, 2, 1, 0]))
caso('null siempre al final, ascendente', () =>
  assert.deepStrictEqual(ordenar([3, null, 0, null, 1], 'asc'), [0, 1, 3, null, null]))
caso('null siempre al final, descendente', () =>
  assert.deepStrictEqual(ordenar([3, null, 0, null, 1], 'desc'), [3, 1, 0, null, null]))
caso('null no se confunde con 0', () =>
  assert.ok(compararNumerico(null, 0, 'asc') > 0 && compararNumerico(0, null, 'desc') < 0))
caso('empate devuelve 0 para que mande el desempate de la tabla', () => {
  assert.strictEqual(compararNumerico(4, 4, 'asc'), 0)
  assert.strictEqual(compararNumerico(null, null, 'desc'), 0)
})
caso('ciclo de clics: asc → desc → sin orden', () => {
  const a = siguienteOrden(null, 'sinAcceder')
  assert.deepStrictEqual(a, { key: 'sinAcceder', dir: 'asc' })
  const b = siguienteOrden(a, 'sinAcceder')
  assert.deepStrictEqual(b, { key: 'sinAcceder', dir: 'desc' })
  assert.strictEqual(siguienteOrden(b, 'sinAcceder'), null)
})
caso('otra columna reinicia en ascendente', () =>
  assert.deepStrictEqual(siguienteOrden({ key: 'a', dir: 'desc' }, 'b'), { key: 'b', dir: 'asc' }))

// ════════════════════════════════════════════════════════════════════════════
// Etapa 2C — «Registros» parte de `users`
// ════════════════════════════════════════════════════════════════════════════
const ts = (iso) => ({ toDate: () => new Date(iso) })
const AHORA = new Date('2026-10-11T18:00:00Z')

console.log('fecha de registro (Auth primero, nunca una suscripción)')
caso('gana la fecha de creación de Auth sobre users.createdAt', () => {
  const f = fechaDeRegistro({ creadoEnAuth: 'Tue, 11 Aug 2026 14:03:00 GMT', createdAt: ts('2026-09-01T10:00:00Z') })
  assert.strictEqual(f.toISOString(), '2026-08-11T14:03:00.000Z')
})
caso('sin dato de Auth cae a users.createdAt', () => {
  const f = fechaDeRegistro({ creadoEnAuth: undefined, createdAt: ts('2026-09-01T10:00:00Z') })
  assert.strictEqual(f.toISOString(), '2026-09-01T10:00:00.000Z')
})
caso('un texto de Auth inválido también cae a users.createdAt, no se inventa nada', () => {
  assert.ok(fechaDeRegistro({ creadoEnAuth: 'no es fecha', createdAt: ts('2026-09-01T10:00:00Z') }))
  assert.strictEqual(fechaDeRegistro({ creadoEnAuth: 'no es fecha' }), null)
})
caso('sin ninguna fecha válida → null', () => {
  for (const e of [undefined, {}, { creadoEnAuth: null, createdAt: null }, { creadoEnAuth: '', createdAt: '1970-01-01' }]) assert.strictEqual(fechaDeRegistro(e), null)
})
caso('la fecha se escribe en la zona de México (no la del navegador)', () => {
  assert.strictEqual(formatoFechaMX('Sun, 01 Nov 2026 05:30:00 GMT'), '31 oct 2026')
  assert.strictEqual(diaMX('Sun, 01 Nov 2026 05:30:00 GMT'), '2026-10-31')
  assert.strictEqual(diaMX('Sun, 01 Nov 2026 07:00:00 GMT'), '2026-11-01')
  assert.strictEqual(formatoFechaMX('x'), null)
  assert.strictEqual(diaMX(null), '')
})

console.log('método de registro (solo users.provider)')
caso('google y password; todo lo demás es desconocido, no se infiere', () => {
  assert.strictEqual(metodoDeRegistro('google'), 'Google')
  assert.strictEqual(metodoDeRegistro('password'), 'Correo y contraseña')
  for (const v of [undefined, null, '', 'facebook', 'Google', 42]) assert.strictEqual(metodoDeRegistro(v), null)
})

console.log('última compra de créditos')
const compra = (extra = {}) => ({
  id: `c${Math.random()}`, docenteId: 'D1', creditos: 200, montoMXN: 180, status: 'completado', origen: 'creditos_adicionales',
  referencia: `R${Math.random()}`, createdAt: ts('2026-10-01T10:00:00Z'), resueltoEn: ts('2026-10-02T18:00:00Z'), ...extra,
})
caso('docente con compra completada → fecha y créditos de la compra', () => {
  const u = ultimaCompraPorDocente([compra({ id: 'a' })])
  assert.strictEqual(u.D1.id, 'a')
  assert.strictEqual(u.D1.creditos, 200)
  assert.strictEqual(u.D1.fecha.toISOString(), '2026-10-02T18:00:00.000Z')
  assert.deepStrictEqual(textoUltimaCompra(u.D1), { tipo: 'compra', texto: '2 oct 2026 · 200 créditos' })
})
caso('docente sin compras → «Sin compras»', () => {
  const u = ultimaCompraPorDocente([compra()])
  assert.strictEqual(u.D2, undefined)
  assert.deepStrictEqual(textoUltimaCompra(u.D2), { tipo: 'sin', texto: 'Sin compras' })
  assert.deepStrictEqual(textoUltimaCompra(undefined), { tipo: 'sin', texto: 'Sin compras' })
})
caso('varias compras: gana la de resolución más reciente', () => {
  const u = ultimaCompraPorDocente([
    compra({ id: 'vieja', creditos: 50, montoMXN: 50, resueltoEn: ts('2026-08-01T18:00:00Z') }),
    compra({ id: 'nueva', creditos: 400, montoMXN: 360, resueltoEn: ts('2026-10-09T18:00:00Z') }),
    compra({ id: 'media', creditos: 100, montoMXN: 90, resueltoEn: ts('2026-09-01T18:00:00Z') }),
  ])
  assert.strictEqual(u.D1.id, 'nueva')
  assert.strictEqual(u.D1.creditos, 400)
})
caso('solo cuentan las COMPLETADAS: pendientes y rechazadas no son «una compra»', () => {
  const u = ultimaCompraPorDocente([compra({ status: 'pendiente', resueltoEn: undefined }), compra({ status: 'rechazado' })])
  assert.deepStrictEqual(u, {})
})
caso('regalos, ajustes y datos no válidos no cuentan (mismas reglas que las ventas del Resumen)', () => {
  const u = ultimaCompraPorDocente([
    compra({ origen: 'regalo_bienvenida' }), compra({ origen: 'ajuste_manual' }), compra({ montoMXN: 0 }), compra({ creditos: 'x' }),
    { id: 'p1', docenteId: 'D1', monto: 99, status: 'completado', metodo: 'mercadopago' }, // pago heredado de payments
  ])
  assert.deepStrictEqual(u, {})
})
caso('una compra completada sin fecha de resolución válida se muestra «— · N créditos», sin inventar fecha', () => {
  const u = ultimaCompraPorDocente([compra({ id: 'sf', resueltoEn: undefined })])
  assert.strictEqual(u.D1.fecha, null)
  assert.deepStrictEqual(textoUltimaCompra(u.D1), { tipo: 'compra', texto: '— · 200 créditos' })
})
caso('una compra con fecha gana a una sin fecha, y entre dos sin fecha la primera', () => {
  const u = ultimaCompraPorDocente([compra({ id: 'sf1', resueltoEn: undefined }), compra({ id: 'cf', resueltoEn: ts('2026-09-01T18:00:00Z') }), compra({ id: 'sf2', resueltoEn: undefined })])
  assert.strictEqual(u.D1.id, 'cf')
  assert.strictEqual(ultimaCompraPorDocente([compra({ id: 'sf1', resueltoEn: undefined }), compra({ id: 'sf2', resueltoEn: undefined })]).D1.id, 'sf1')
})
caso('«1 crédito» en singular; cada docente su propia última compra', () => {
  assert.strictEqual(textoUltimaCompra({ fecha: new Date('2026-10-02T18:00:00Z'), creditos: 1 }).texto, '2 oct 2026 · 1 crédito')
  const u = ultimaCompraPorDocente([compra({ id: 'a', docenteId: 'D1' }), compra({ id: 'b', docenteId: 'D2', creditos: 50, montoMXN: 50 })])
  assert.strictEqual(u.D1.creditos, 200)
  assert.strictEqual(u.D2.creditos, 50)
})
caso('colecciones vacías o inválidas → sin compras, y las entradas no se modifican', () => {
  for (const e of [[], null, undefined]) assert.deepStrictEqual(ultimaCompraPorDocente(e), {})
  const datos = Object.freeze([Object.freeze(compra({ id: 'x' }))])
  assert.doesNotThrow(() => ultimaCompraPorDocente(datos))
})

console.log('estudiantes únicos por docente')
const insc = (u, asig, extra = {}) => ({ id: `s${Math.random()}`, username: u, escuelaId: 'E1', asignaturaId: asig, ...extra })
caso('la misma persona en tres asignaturas del mismo docente cuenta UNA vez', () => {
  const r = estudiantesPorDocente([insc('ana', 'A1'), insc('ANA', 'A2'), insc('ana', 'A3')], { A1: { docenteId: 'D1' }, A2: { docenteId: 'D1' }, A3: { docenteId: 'D1' } })
  assert.deepStrictEqual(r, { D1: 1 })
})
caso('la misma persona con dos docentes cuenta con cada uno (por eso la suma puede superar el total)', () => {
  const r = estudiantesPorDocente([insc('ana', 'A1'), insc('ana', 'A2'), insc('beto', 'A2')], { A1: { docenteId: 'D1' }, A2: { docenteId: 'D2' } })
  assert.deepStrictEqual(r, { D1: 1, D2: 2 })
  assert.ok(Object.values(r).reduce((a, b) => a + b, 0) > new Set(['ana', 'beto']).size)
})
caso('docente por la asignatura; el campo viejo docenteId solo de respaldo; sin docente → se ignora', () => {
  const r = estudiantesPorDocente([insc('a', 'NO_EXISTE', { docenteId: 'D9' }), insc('b', 'NO_EXISTE'), insc('c', 'A1')], { A1: { docenteId: 'D1' } })
  assert.deepStrictEqual(r, { D9: 1, D1: 1 })
})
caso('sin usuario cada documento es una persona; vacío y basura no truenan', () => {
  assert.deepStrictEqual(estudiantesPorDocente([{ id: 'x1', asignaturaId: 'A1' }, { id: 'x2', asignaturaId: 'A1' }], { A1: { docenteId: 'D1' } }), { D1: 2 })
  for (const e of [[], null, undefined, [null, 4, 'x']]) assert.deepStrictEqual(estudiantesPorDocente(e), {})
})

console.log('correos duplicados (solo se señalan)')
caso('detecta el mismo correo aunque cambien mayúsculas o espacios, sin fusionar a nadie', () => {
  const docentes = [{ id: 'D1', email: 'Ana@X.mx ' }, { id: 'D2', email: 'ana@x.mx' }, { id: 'D3', email: 'otro@x.mx' }]
  assert.deepStrictEqual(correosDuplicados(docentes), [{ correo: 'ana@x.mx', cantidad: 2, ids: ['D1', 'D2'] }])
  assert.strictEqual(docentes.length, 3)
})
caso('sin duplicados → lista vacía; sin correo no cuenta', () => {
  assert.deepStrictEqual(correosDuplicados([{ id: 'D1', email: 'a@x.mx' }, { id: 'D2', email: 'b@x.mx' }]), [])
  assert.deepStrictEqual(correosDuplicados([{ id: 'D1' }, { id: 'D2', email: '' }, { id: 'D3', email: '  ' }]), [])
  assert.deepStrictEqual(correosDuplicados(null), [])
})

console.log('último acceso')
caso('días completos; hoy es 0 confirmado; sin dato es null, nunca 0', () => {
  assert.strictEqual(diasSinAcceso('2026-10-09T10:00:00Z', AHORA), 2)
  assert.strictEqual(diasSinAcceso('2026-10-11T10:00:00Z', AHORA), 0)
  for (const v of [null, undefined, '', 'x']) assert.strictEqual(diasSinAcceso(v, AHORA), null)
  assert.strictEqual(diasSinAcceso('2026-10-09T10:00:00Z', 'hoy'), null)
})

console.log('filas de Registros')
const docente = (id, extra = {}) => ({ id, role: 'docente', email: `${id}@x.mx`, nombre: 'Doc', apellidoPaterno: id, escuelaId: 'E1', provider: 'password', codigoPostal: '37000', estado: 'Guanajuato', ciudad: 'León', ...extra })
const esc = { E1: { shortName: 'ESC', estado: 'Jalisco', municipio: 'Zapopan' } }
caso('una fila por docente, aunque no haya comprado créditos ni tenga o haya tenido suscripción', () => {
  const filas = construirFilasRegistros({ docentes: [docente('D1'), docente('D2')], schoolsMap: esc, ultimaCompra: { D1: { fecha: new Date('2026-10-02T18:00:00Z'), creditos: 200 } }, ahora: AHORA })
  assert.strictEqual(filas.length, 2)
  assert.strictEqual(filas.find((f) => f.uid === 'D1').ultimaCompra, '2 oct 2026 · 200 créditos')
  const sin = filas.find((f) => f.uid === 'D2')
  assert.strictEqual(sin.ultimaCompra, 'Sin compras')
  assert.strictEqual(sin.ultimaCompraTipo, 'sin')
})
caso('«No.» por fecha de registro real (Auth): 1 = el más antiguo; sin fecha → null y «—»', () => {
  const filas = construirFilasRegistros({
    docentes: [docente('D1'), docente('D2'), docente('D3'), docente('D4', { createdAt: ts('2026-01-10T10:00:00Z') })],
    creadoEn: { D1: 'Tue, 11 Aug 2026 14:03:00 GMT', D2: 'Mon, 01 Jun 2026 14:03:00 GMT', D3: 'no es fecha' }, ahora: AHORA,
  })
  const por = Object.fromEntries(filas.map((f) => [f.uid, f]))
  assert.strictEqual(por.D4.rank, 1)   // users.createdAt (enero) como respaldo
  assert.strictEqual(por.D2.rank, 2)   // junio
  assert.strictEqual(por.D1.rank, 3)   // agosto
  assert.strictEqual(por.D3.rank, null)
  assert.strictEqual(por.D3.registroTexto, '—')
  assert.strictEqual(por.D2.registroTexto, '1 jun 2026')
  assert.strictEqual(por.D2.registroISO, '2026-06-01')
})
caso('la fecha de registro no sale de ninguna suscripción aunque venga en los datos', () => {
  const t = docente('D1', { fechaInicio: ts('2026-01-01T00:00:00Z') })
  const [f] = construirFilasRegistros({ docentes: [t], creadoEn: { D1: 'Tue, 11 Aug 2026 14:03:00 GMT' }, ahora: AHORA, subscriptions: [{ docenteId: 'D1', fechaInicio: ts('2026-01-01T00:00:00Z') }] })
  assert.strictEqual(f.registroISO, '2026-08-11')
})
caso('método de registro desde users.provider; sin él, «—»', () => {
  const filas = construirFilasRegistros({ docentes: [docente('D1', { provider: 'google' }), docente('D2'), docente('D3', { provider: undefined })], ahora: AHORA })
  assert.deepStrictEqual(filas.map((f) => f.metodo), ['Google', 'Correo y contraseña', '—'])
})
caso('datos incompletos: «—», no 0 ni vacío; 0 estudiantes sí es un cero confirmado', () => {
  const [f] = construirFilasRegistros({ docentes: [{ id: 'D1', role: 'docente', email: '' }], ahora: AHORA })
  assert.deepStrictEqual({ d: f.docente, c: f.correo, cp: f.codigoPostal, e: f.estado, ci: f.ciudad, es: f.escuela, ac: f.sinAcceder }, { d: '—', c: '—', cp: '—', e: '—', ci: '—', es: '—', ac: null })
  assert.strictEqual(f.estudiantes, 0)
})
caso('estado y ciudad caen a los de la escuela; el código postal no tiene respaldo', () => {
  const [f] = construirFilasRegistros({ docentes: [docente('D1', { estado: undefined, ciudad: undefined, codigoPostal: undefined })], schoolsMap: esc, ahora: AHORA })
  assert.deepStrictEqual({ e: f.estado, c: f.ciudad, cp: f.codigoPostal, es: f.escuela }, { e: 'Jalisco', c: 'Zapopan', cp: '—', es: 'ESC' })
})
caso('con y sin último acceso: 0 días confirmado frente a null (—)', () => {
  const filas = construirFilasRegistros({ docentes: [docente('D1'), docente('D2'), docente('D3')], accesos: { D1: '2026-10-11T10:00:00Z', D2: '2026-10-01T10:00:00Z' }, ahora: AHORA })
  assert.deepStrictEqual(filas.map((f) => f.sinAcceder), [0, 10, null])
})
caso('estudiantes únicos por docente se toman del mapa recibido', () => {
  const filas = construirFilasRegistros({ docentes: [docente('D1'), docente('D2')], estudiantes: { D1: 12 }, ahora: AHORA })
  assert.deepStrictEqual(filas.map((f) => f.estudiantes), [12, 0])
})
caso('constancia de baja: se conserva, dice «Cuenta eliminada» con su fecha de baja y NO la presenta como fecha de registro', () => {
  const filas = construirFilasRegistros({ docentes: [docente('D1')], bajas: [{ id: 'B1', nombre: 'MARÍA PÉREZ', email: 'm@x.mx', fechaBaja: ts('2026-09-20T18:00:00Z') }], creadoEn: { D1: 'Tue, 11 Aug 2026 14:03:00 GMT' }, ahora: AHORA })
  const b = filas.find((f) => f.baja)
  assert.strictEqual(b.uid, 'B1')
  assert.strictEqual(b.docente, 'María Pérez')
  assert.strictEqual(b.correo, 'm@x.mx')
  assert.strictEqual(b.bajaTexto, 'Cuenta eliminada el 20 sep 2026')
  assert.strictEqual(b.registroTexto, '—')
  assert.strictEqual(b.registroISO, '')
  assert.strictEqual(b.rank, null)
  assert.strictEqual(b.estudiantes, null)
  assert.strictEqual(b.sinAcceder, null)
})
caso('constancia sin fecha de baja válida → «Cuenta eliminada» a secas; ids de fila distintos entre docentes y bajas', () => {
  const filas = construirFilasRegistros({ docentes: [docente('X1')], bajas: [{ id: 'X1', nombre: 'Ex', fechaBaja: 'x' }], ahora: AHORA })
  assert.strictEqual(filas.find((f) => f.baja).bajaTexto, 'Cuenta eliminada')
  assert.strictEqual(new Set(filas.map((f) => f.id)).size, 2)
})
caso('orden predeterminado: el registro más nuevo primero; las filas sin número al final', () => {
  const filas = construirFilasRegistros({
    docentes: [docente('D1'), docente('D2'), docente('D3')], bajas: [{ id: 'B1', nombre: 'Ex' }],
    creadoEn: { D1: 'Mon, 01 Jun 2026 14:03:00 GMT', D2: 'Tue, 11 Aug 2026 14:03:00 GMT' }, ahora: AHORA,
  })
  const ordenadas = [...filas].sort(compararPorRegistro).map((f) => f.uid)
  assert.deepStrictEqual(ordenadas.slice(0, 2), ['D2', 'D1'])
  assert.deepStrictEqual(new Set(ordenadas.slice(2)), new Set(['D3', 'B1']))
})
caso('el número («No.») no cambia con los filtros: depende solo de los datos', () => {
  const entradas = { docentes: [docente('D1'), docente('D2')], creadoEn: { D1: 'Mon, 01 Jun 2026 14:03:00 GMT', D2: 'Tue, 11 Aug 2026 14:03:00 GMT' }, ahora: AHORA }
  const a = construirFilasRegistros(entradas)
  const b = construirFilasRegistros({ ...entradas, docentes: [...entradas.docentes].reverse() })
  assert.deepStrictEqual(Object.fromEntries(a.map((f) => [f.uid, f.rank])), Object.fromEntries(b.map((f) => [f.uid, f.rank])))
})
caso('es determinista y no modifica nada de lo que recibe (ni compras, ni saldos, ni permisos)', () => {
  const congelar = (x) => { Object.freeze(x); if (x && typeof x === 'object') Object.values(x).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) congelar(v) }); return x }
  const entradas = congelar({ docentes: [docente('D1'), docente('D2')], bajas: [{ id: 'B1', nombre: 'Ex', fechaBaja: ts('2026-09-20T18:00:00Z') }], schoolsMap: esc, estudiantes: { D1: 3 }, creadoEn: { D1: 'Tue, 11 Aug 2026 14:03:00 GMT' }, accesos: { D1: '2026-10-10T10:00:00Z' }, ultimaCompra: { D1: { fecha: new Date('2026-10-02T18:00:00Z'), creditos: 200 } }, ahora: AHORA })
  assert.deepStrictEqual(construirFilasRegistros(entradas), construirFilasRegistros(entradas))
})

if (fallos) { console.log(`\n${fallos} caso(s) fallaron`); process.exit(1) }
console.log('\nTodo bien')
