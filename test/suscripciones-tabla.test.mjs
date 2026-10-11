// Reglas de presentación de «Suscripciones (histórico)». Funciones puras: no
// necesita emulador ni red.
//
//   node test/suscripciones-tabla.test.mjs

import assert from 'node:assert'
import {
  nombreCompletoDocente, saldoIAVisible, compararNumerico, siguienteOrden,
} from '../src/utils/suscripcionesTabla.js'

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

if (fallos) { console.log(`\n${fallos} caso(s) fallaron`); process.exit(1) }
console.log('\nTodo bien')
