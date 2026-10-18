// Pruebas de "Recalificar todas con IA" (23-ago-2026) — verifica el filtro
// de entregas candidatas en `precheckCalificarEntregableLote` cuando
// `params.recalificar === true`, y que la seguridad por dueño se mantiene.
// No llama a Anthropic (precheck no lo toca) — cero costo, cero red.
import { db, iaFn, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'
import { readFileSync } from 'node:fs'

const DOCENTE_A = 'docenteA-recal'
const DOCENTE_B = 'docenteB-recal'
const ACTIVIDAD = 'act-recal-1'

const RUBRICA = {
  tipo: 'rubrica',
  criterios: [{ nombre: 'Criterio 1', puntos: [0, 5, 10] }],
  niveles: [{ nombre: 'No cumple' }, { nombre: 'Parcial' }, { nombre: 'Completo' }],
}

async function sembrar() {
  await db.doc(`activities/${ACTIVIDAD}`).set({
    docenteId: DOCENTE_A, categoria: 'entregable', nombre: 'Actividad de prueba',
    instrucciones: 'Sube tu evidencia', rubrica: RUBRICA,
  })
  // sub1: pendiente (sin calificar), con evidencia soportada
  await db.doc('submissions/sub1').set({
    actividadId: ACTIVIDAD, alumnoId: 'al1', calificacion: null,
    archivos: [{ url: 'https://res.cloudinary.com/demo/image/upload/v1/foo.png', nombre: 'foo.png' }],
  })
  // sub2: YA calificada, con evidencia soportada — solo debe entrar si recalificar=true
  await db.doc('submissions/sub2').set({
    actividadId: ACTIVIDAD, alumnoId: 'al2', calificacion: 8,
    archivos: [{ url: 'https://res.cloudinary.com/demo/image/upload/v1/bar.png', nombre: 'bar.png' }],
  })
  // sub3: sin evidencia (sin archivos) — nunca debe entrar
  await db.doc('submissions/sub3').set({
    actividadId: ACTIVIDAD, alumnoId: 'al3', calificacion: null, archivos: [],
  })
}

grupo('precheckCalificarEntregableLote — recalificar=false (comportamiento existente, sin tocar)')
await limpiar()
await sembrar()

await caso('sin recalificar: solo cuenta la entrega pendiente (sub1), no la ya calificada (sub2)', async () => {
  const ctx = await iaFn._pruebas.precheckCalificarEntregableLote({ uid: DOCENTE_A, params: { actividadId: ACTIVIDAD } })
  const ids = ctx.items.map((i) => i.submissionId).sort()
  assert.deepStrictEqual(ids, ['sub1'])
  assert.strictEqual(ctx.recalificar, false)
})

grupo('precheckCalificarEntregableLote — recalificar=true (nuevo)')

await caso('con recalificar=true: cuenta TODAS las entregas con evidencia, incluida la ya calificada', async () => {
  const ctx = await iaFn._pruebas.precheckCalificarEntregableLote({ uid: DOCENTE_A, params: { actividadId: ACTIVIDAD, recalificar: true } })
  const ids = ctx.items.map((i) => i.submissionId).sort()
  assert.deepStrictEqual(ids, ['sub1', 'sub2'])
  assert.strictEqual(ctx.recalificar, true)
})

await caso('con recalificar=true: la entrega sin evidencia (sub3) sigue sin contar', async () => {
  const ctx = await iaFn._pruebas.precheckCalificarEntregableLote({ uid: DOCENTE_A, params: { actividadId: ACTIVIDAD, recalificar: true } })
  const ids = ctx.items.map((i) => i.submissionId)
  assert.ok(!ids.includes('sub3'))
})

grupo('Seguridad — un docente ajeno no puede recalificar la actividad de otro')

await caso('docente que no es dueño: permission-denied, tanto en modo normal como recalificar', async () => {
  await assert.rejects(
    iaFn._pruebas.precheckCalificarEntregableLote({ uid: DOCENTE_B, params: { actividadId: ACTIVIDAD } }),
    /permission-denied|no es tuya/,
  )
  await assert.rejects(
    iaFn._pruebas.precheckCalificarEntregableLote({ uid: DOCENTE_B, params: { actividadId: ACTIVIDAD, recalificar: true } }),
    /permission-denied|no es tuya/,
  )
})

grupo('Redacción evaluativa en los prompts de calificación con IA')

await caso('CALIFICAR_ENTREGABLE_SISTEMA exige valoración basada en evidencia y prohíbe instrucciones de corrección', async () => {
  const sistema = iaFn._pruebas.CALIFICAR_ENTREGABLE_SISTEMA || ''
  assert.ok(sistema.length > 0, 'CALIFICAR_ENTREGABLE_SISTEMA debe estar exportado en _pruebas para esta prueba')
  assert.match(sistema, /valoración profesional, objetiva y clara sustentada en las evidencias y criterios/i)
  assert.match(sistema, /No .*órdenes.*recomendaciones/i)
  assert.match(sistema, /corrige.*mejora.*debes.*completa.*revisa/i)
  assert.match(sistema, /vuelve a entregar|reentrega|segunda oportunidad/i)
})

await caso('C-02 para respuestas abiertas exige valoración evidenciada y prohíbe órdenes al estudiante', async () => {
  const fuente = readFileSync(new URL('../functions/ia.js', import.meta.url), 'utf8')
  const inicio = fuente.indexOf('const C02_SISTEMA =')
  const fin = fuente.indexOf('// Máximo de caracteres', inicio)
  const sistema = fuente.slice(inicio, fin)
  assert.ok(inicio >= 0 && fin > inicio, 'debe existir el prompt C02 de respuestas abiertas')
  assert.match(sistema, /valoración del trabajo presentado/i)
  assert.match(sistema, /evidencias concretas/i)
  assert.match(sistema, /No des órdenes, recomendaciones ni instrucciones/i)
  assert.match(sistema, /corrige[\s\S]*mejora[\s\S]*completa[\s\S]*debes[\s\S]*revisa[\s\S]*haz/i)
  assert.match(sistema, /vuelve a intentarlo.*vuelve a entregar/i)
})

await limpiar()
resumen('recalificar-ia.test.mjs')
