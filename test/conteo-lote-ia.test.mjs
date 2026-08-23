// Bug real reportado por Kike (24-ago-2026): "Calificar todas con IA" podía
// fallar con "Hay N entregas... pero la estimación fue de M" porque el
// precheck del servidor no excluía las entregas que YA tenían una propuesta
// 'pendiente' (el cliente sí las excluye al contar). Verifica que ahora
// cuentan igual.
import { db, iaFn, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'

const DOCENTE = 'docente-conteo-lote'
const ACTIVIDAD = 'act-conteo-lote'

const RUBRICA = {
  tipo: 'rubrica',
  criterios: [{ nombre: 'Criterio 1', puntos: [0, 5, 10] }],
  niveles: [{ nombre: 'No cumple' }, { nombre: 'Parcial' }, { nombre: 'Completo' }],
}

async function sembrar() {
  await db.doc(`activities/${ACTIVIDAD}`).set({
    docenteId: DOCENTE, categoria: 'entregable', nombre: 'Actividad de prueba', rubrica: RUBRICA,
  })
  // 3 entregas sin calificar, todas con evidencia soportada.
  for (const id of ['sub1', 'sub2', 'sub3']) {
    await db.doc(`submissions/${id}`).set({
      actividadId: ACTIVIDAD, alumnoId: id, calificacion: null,
      archivos: [{ url: `https://res.cloudinary.com/demo/image/upload/v1/${id}.png`, nombre: `${id}.png` }],
    })
  }
  // sub1 YA tiene una propuesta pendiente de un lote anterior — el cliente
  // la excluiría al contar (contarEntregasIA); el servidor debe hacer lo mismo.
  await db.doc(`activities/${ACTIVIDAD}/iaSugerenciasEntregable/sub1`).set({
    estado: 'pendiente', actividadId: ACTIVIDAD, sub: 'sub1',
    sugerencia: { criterios: [{ n: 1, nivel: 2, sinEvidenciaSuficiente: false }], retroalimentacionGeneral: '', calificacionPropuesta: 10 },
  })
}

grupo('precheckCalificarEntregableLote — conteo igual al del cliente (sin recalificar)')
await limpiar()
await sembrar()

await caso('excluye la entrega que ya tiene propuesta pendiente — mismo criterio que contarEntregasIA del cliente', async () => {
  const ctx = await iaFn._pruebas.precheckCalificarEntregableLote({ uid: DOCENTE, params: { actividadId: ACTIVIDAD } })
  const ids = ctx.items.map((i) => i.submissionId).sort()
  // El cliente, viendo sugerenciasLoteIA={sub1:{...}}, habría contado solo sub2 y sub3.
  assert.deepStrictEqual(ids, ['sub2', 'sub3'], 'debe coincidir exactamente con lo que el docente ya vio y aceptó pagar')
})

grupo('precheckCalificarEntregableLote — recalificar=true SÍ incluye las que ya tienen propuesta')
await caso('con recalificar=true, sub1 (con propuesta pendiente) también se recalifica', async () => {
  const ctx = await iaFn._pruebas.precheckCalificarEntregableLote({ uid: DOCENTE, params: { actividadId: ACTIVIDAD, recalificar: true } })
  const ids = ctx.items.map((i) => i.submissionId).sort()
  assert.deepStrictEqual(ids, ['sub1', 'sub2', 'sub3'])
})

await limpiar()
resumen('conteo-lote-ia.test.mjs')
