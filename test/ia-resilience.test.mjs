/**
 * Tests de resiliencia ante respuestas de IA malformadas — I-01 / I-02
 *
 * I-01: CalificarConIAModal — guard en calificacionPropuestaDe / criterios.map()
 * I-02: AdminChatMensaje    — guard en b.items.map()
 *
 * Estos tests verifican la lógica de los guards sin necesitar React ni un
 * emulador. El proyecto no tiene un framework de tests de UI; aquí se testea
 * directamente la lógica pura de los guards añadidos (Node.js + assert).
 *
 * Ejecución: node test/ia-resilience.test.mjs
 */

import assert from 'node:assert'

// ─── I-01: calificacionPropuestaDe guard ────────────────────────────────────
// Espejo exacto del guard añadido en CalificarConIAModal.jsx (sin dependencia
// de React ni de rubrica): se testea solo la lógica del guard en sí.

function calificacionPropuestaDe(res, totalRubricaFn) {
  if (!res) return null
  if (typeof res.calificacionPropuesta === 'number') return res.calificacionPropuesta
  if (!Array.isArray(res.criterios)) return null   // ← guard añadido (I-01)
  return totalRubricaFn(res.criterios.map((c2) => c2.nivel))
}

const sumarNiveles = (niveles) => niveles.reduce((a, b) => a + (Number(b) || 0), 0)
const noLlamar = () => { throw new Error('totalRubrica NO debe llamarse con criterios inválidos') }

// 1. criterios válido → funciona
{
  const res = { criterios: [{ nivel: 2 }, { nivel: 3 }] }
  assert.strictEqual(calificacionPropuestaDe(res, sumarNiveles), 5, 'I-01-1: criterios válido debe retornar suma')
}

// 2. criterios = undefined → no crash, retorna null
{
  const res = { criterios: undefined }
  assert.strictEqual(calificacionPropuestaDe(res, noLlamar), null, 'I-01-2: criterios=undefined debe retornar null')
}

// 3. criterios = null → no crash, retorna null
{
  const res = { criterios: null }
  assert.strictEqual(calificacionPropuestaDe(res, noLlamar), null, 'I-01-3: criterios=null debe retornar null')
}

// 4. criterios = {} → no crash, retorna null
{
  const res = { criterios: {} }
  assert.strictEqual(calificacionPropuestaDe(res, noLlamar), null, 'I-01-4: criterios={} debe retornar null')
}

// 5. criterios = "texto" → no crash, retorna null
{
  const res = { criterios: 'texto' }
  assert.strictEqual(calificacionPropuestaDe(res, noLlamar), null, 'I-01-5: criterios="texto" debe retornar null')
}

// 6. calificacionPropuesta numérica ya existente → no toca criterios
{
  const res = { calificacionPropuesta: 8.5, criterios: undefined }
  assert.strictEqual(calificacionPropuestaDe(res, noLlamar), 8.5, 'I-01-6: calificacionPropuesta precalculada no debe tocar criterios')
}

console.log('I-01 ✓ (6/6 casos)')

// ─── I-02: AdminChatMensaje — guard en b.items ──────────────────────────────
// Espejo exacto del guard añadido: Array.isArray(b.items) ? b.items : []

function renderListItems(b) {
  const items = Array.isArray(b.items) ? b.items : []   // ← guard añadido (I-02)
  return items.map((it) => String(it))
}

// 1. items válido → funciona igual
{
  const b = { tipo: 'ul', items: ['uno', 'dos', 'tres'] }
  assert.deepStrictEqual(renderListItems(b), ['uno', 'dos', 'tres'], 'I-02-1: items válido debe retornar los elementos')
}

// 2. items = undefined → no crash, lista vacía
{
  const b = { tipo: 'ul', items: undefined }
  assert.deepStrictEqual(renderListItems(b), [], 'I-02-2: items=undefined debe retornar []')
}

// 3. items = null → no crash, lista vacía
{
  const b = { tipo: 'ol', items: null }
  assert.deepStrictEqual(renderListItems(b), [], 'I-02-3: items=null debe retornar []')
}

// 4. items = {} → no crash, lista vacía
{
  const b = { tipo: 'ul', items: {} }
  assert.deepStrictEqual(renderListItems(b), [], 'I-02-4: items={} debe retornar []')
}

// 5. items = "texto" → no crash, lista vacía (string no es Array)
{
  const b = { tipo: 'ol', items: 'texto' }
  assert.deepStrictEqual(renderListItems(b), [], 'I-02-5: items="texto" debe retornar []')
}

// 6. items vacío [] → lista vacía (caso normal sin elementos)
{
  const b = { tipo: 'ul', items: [] }
  assert.deepStrictEqual(renderListItems(b), [], 'I-02-6: items=[] debe retornar []')
}

console.log('I-02 ✓ (6/6 casos)')
console.log('Todos los tests de resiliencia IA pasaron.')
