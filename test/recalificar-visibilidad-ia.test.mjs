// "Recalificar con IA" solo debe verse cuando el instrumento (rúbrica/lista
// de cotejo) actual ya no es el que se usó para generar las evaluaciones de
// IA existentes (25-ago-2026, pedido de Kike). Prueba la huella
// (rubricaFirma, funciones/ia.js) y que quede persistida al generar, tanto
// individual como por lote.
import { db, iaFn, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'

const rubricaFirma = iaFn._pruebas.rubricaFirma

const RUBRICA_V1 = {
  tipo: 'rubrica',
  criterios: [{ nombre: 'Criterio 1', puntos: [0, 5, 10], descriptores: ['No', 'Parcial', 'Completo'] }],
  niveles: [{ nombre: 'No cumple', porcentaje: 0 }, { nombre: 'Parcial', porcentaje: 50 }, { nombre: 'Completo', porcentaje: 100 }],
}
const RUBRICA_V1_OTRO_TITULO = { ...RUBRICA_V1, titulo: 'Nombre distinto — no debe afectar la huella' }
const RUBRICA_V2_MAS_CRITERIO = {
  ...RUBRICA_V1,
  criterios: [...RUBRICA_V1.criterios, { nombre: 'Criterio 2', puntos: [0, 5, 10], descriptores: ['No', 'Parcial', 'Completo'] }],
}
const RUBRICA_V3_DESCRIPTOR_DISTINTO = {
  ...RUBRICA_V1,
  criterios: [{ ...RUBRICA_V1.criterios[0], descriptores: ['No', 'Parcial', 'Completo — cambiado'] }],
}
const COTEJO_V1 = {
  tipo: 'cotejo',
  criterios: [{ nombre: 'Indicador 1', puntos: [10], descriptores: [''] }],
  niveles: [{ nombre: 'Nivel de desempeño', porcentaje: 100 }],
}
const COTEJO_V2 = {
  ...COTEJO_V1,
  criterios: [{ nombre: 'Indicador 1 modificado', puntos: [10], descriptores: [''] }],
}

grupo('rubricaFirma — huella del instrumento (espejo cliente/servidor)')

await caso('misma rúbrica → misma huella', async () => {
  assert.strictEqual(rubricaFirma(RUBRICA_V1), rubricaFirma({ ...RUBRICA_V1 }))
})

await caso('cambiar el título de la rúbrica NO cambia la huella (no es parte del instrumento evaluable)', async () => {
  assert.strictEqual(rubricaFirma(RUBRICA_V1), rubricaFirma(RUBRICA_V1_OTRO_TITULO))
})

await caso('agregar un criterio SÍ cambia la huella', async () => {
  assert.notStrictEqual(rubricaFirma(RUBRICA_V1), rubricaFirma(RUBRICA_V2_MAS_CRITERIO))
})

await caso('cambiar un descriptor SÍ cambia la huella', async () => {
  assert.notStrictEqual(rubricaFirma(RUBRICA_V1), rubricaFirma(RUBRICA_V3_DESCRIPTOR_DISTINTO))
})

await caso('lista de cotejo: mismo criterio → misma huella', async () => {
  assert.strictEqual(rubricaFirma(COTEJO_V1), rubricaFirma({ ...COTEJO_V1 }))
})

await caso('lista de cotejo: modificar un indicador SÍ cambia la huella', async () => {
  assert.notStrictEqual(rubricaFirma(COTEJO_V1), rubricaFirma(COTEJO_V2))
})

await caso('sin rúbrica → huella vacía, nunca truena', async () => {
  assert.strictEqual(rubricaFirma(null), '')
  assert.strictEqual(rubricaFirma(undefined), '')
})

// ── Persistencia real: la huella queda guardada al generar ──────────────────
grupo('La huella queda persistida en iaSugerenciasEntregable al generar (individual y lote)')

const DOCENTE = 'docente-recalificar-vis'
const ACTIVIDAD = 'act-recalificar-vis'

async function sembrarActividad(rubrica) {
  await limpiar()
  await db.doc(`activities/${ACTIVIDAD}`).set({ docenteId: DOCENTE, categoria: 'entregable', nombre: 'Act', rubrica })
  await db.doc('submissions/subA').set({
    actividadId: ACTIVIDAD, alumnoId: 'subA', calificacion: null,
    archivos: [{ url: 'https://res.cloudinary.com/demo/image/upload/v1/subA.png', nombre: 'subA.png' }],
  })
}

await caso('precheckCalificarEntregableLote entrega la rúbrica ACTUAL en su contexto (lo que usa el executor para firmar)', async () => {
  await sembrarActividad(RUBRICA_V1)
  const ctx = await iaFn._pruebas.precheckCalificarEntregableLote({ uid: DOCENTE, params: { actividadId: ACTIVIDAD } })
  assert.strictEqual(rubricaFirma(ctx.rubrica), rubricaFirma(RUBRICA_V1))
})

await caso('precheckCalificarEntregable (individual) entrega la misma rúbrica actual', async () => {
  const ctx = await iaFn._pruebas.precheckCalificarEntregable({ uid: DOCENTE, params: { actividadId: ACTIVIDAD, submissionId: 'subA' } })
  assert.strictEqual(rubricaFirma(ctx.rubrica), rubricaFirma(RUBRICA_V1))
})

// ── Simulación de la regla de visibilidad del cliente (mismo criterio que ActivityPage.jsx) ──
grupo('Regla de visibilidad de "Recalificar con IA" — mismo criterio que el cliente')

function hayVersionDistinta(sugerencias, firmaActual) {
  return sugerencias.some((s) => s._rubricaFirma && s._rubricaFirma !== firmaActual)
}

await caso('A. evaluación existente con la MISMA huella que la rúbrica actual → oculto', async () => {
  const firmaActual = rubricaFirma(RUBRICA_V1)
  const sugerencias = [{ _estado: 'pendiente', _rubricaFirma: rubricaFirma(RUBRICA_V1) }]
  assert.strictEqual(hayVersionDistinta(sugerencias, firmaActual), false)
})

await caso('B. la rúbrica cambió desde que se generó la evaluación → visible', async () => {
  const firmaActual = rubricaFirma(RUBRICA_V2_MAS_CRITERIO) // el docente ya agregó un criterio
  const sugerencias = [{ _estado: 'aplicada', _rubricaFirma: rubricaFirma(RUBRICA_V1) }] // generada con la V1
  assert.strictEqual(hayVersionDistinta(sugerencias, firmaActual), true)
})

await caso('E/F. instrucciones/configuración no forman parte de rubricaFirma → nunca activan el botón por sí solas', async () => {
  // Simula "el docente cambió solo instrucciones": la rúbrica es la MISMA
  // instancia, así que su huella no cambia — ni siquiera hace falta un caso
  // aparte, ya lo cubre la huella misma no incluyendo esos campos.
  const firmaActual = rubricaFirma(RUBRICA_V1)
  const sugerencias = [{ _estado: 'pendiente', _rubricaFirma: rubricaFirma(RUBRICA_V1) }]
  assert.strictEqual(hayVersionDistinta(sugerencias, firmaActual), false)
})

await caso('evaluación SIN huella conocida (datos de antes de este cambio) → se ignora, no fuerza el botón', async () => {
  const firmaActual = rubricaFirma(RUBRICA_V1)
  const sugerencias = [{ _estado: 'aplicada', _rubricaFirma: '' }]
  assert.strictEqual(hayVersionDistinta(sugerencias, firmaActual), false)
})

await caso('I. después de recalificar, la nueva evaluación queda con la huella ACTUAL → vuelve a ocultarse', async () => {
  const firmaActual = rubricaFirma(RUBRICA_V2_MAS_CRITERIO)
  const sugerencias = [{ _estado: 'aplicada', _rubricaFirma: rubricaFirma(RUBRICA_V2_MAS_CRITERIO) }]
  assert.strictEqual(hayVersionDistinta(sugerencias, firmaActual), false)
})

await limpiar()
resumen('recalificar-visibilidad-ia.test.mjs')
