// Escritores tardíos de IA y juegos (limpieza automática al eliminar actividades, functions/actividadLimpieza.js),
// contra el emulador de Firestore. Mismo patrón que tarifa-calificacion-emulador.test.mjs e ia-creditos.test.mjs:
// Anthropic falso y la lógica invocada con `.run()`.
//
// Tres escritores que terminan DESPUÉS de una espera (la IA o el armado del tablero) y que, si el docente borró la
// actividad mientras tanto, dejaban documentos huérfanos:
//   · calificar_entregable_ia → activities/{id}/iaSugerenciasEntregable/{entrega}   (functions/ia.js)
//   · generar_contenido_juego → activities/{id}/clave/contenido                    (functions/ia.js)
//   · construirJuego          → activities/{id}/clave/juego y clave/contenido      (functions/juego.js)
//
//   firebase emulators:exec --only firestore,auth --project demo-test "node test/limpieza-escritores-ia.test.mjs"
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { db, funciones, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'
import * as FX from './helpers/fixturesEvidencias.mjs'

const require = createRequire(import.meta.url)
const DOCENTE = 'docente-tardios'
const clave = () => crypto.randomUUID()
const existe = async (ruta) => (await db.doc(ruta).get()).exists
const tam = async (ruta) => (await db.collection(ruta).get()).size
const saldoDe = async () => (await db.doc(`iaCreditos/${DOCENTE}`).get()).data().saldo
async function falla(fn) { try { await fn() } catch (e) { return e } throw new Error('se esperaba un error') }

// ── Anthropic falso: responde según la operación y, si se pide, borra la actividad MIENTRAS «piensa» ──
const requireFn = createRequire(new URL('../functions/index.js', import.meta.url))
const rutaSdk = requireFn.resolve('@anthropic-ai/sdk')
requireFn(rutaSdk)
let borrarDurante = null // id de la actividad que se borra durante la llamada a la IA
const pedidosIA = []
require.cache[rutaSdk].exports = class AnthropicFalso {
  constructor() {
    this.messages = {
      create: async (req) => {
        pedidosIA.push(req)
        if (borrarDurante) { await db.doc(`activities/${borrarDurante}`).delete(); borrarDurante = null }
        const esJuego = JSON.stringify(req).includes('palabras')
        const texto = JSON.stringify(esJuego
          ? { palabras: ['ESCRITORIO', 'ICONOS', 'RELOJ', 'PAPELERA', 'VENTANA', 'MENU'].map((palabra) => ({ palabra, descripcion: `Pista de ${palabra}` })) }
          : { criterios: [{ n: 1, nivel: 0, evidencia: 'Cumple', sinEvidenciaSuficiente: false }], retroalimentacionGeneral: 'Buen trabajo.', confianza: 'alta' })
        return { content: [{ type: 'text', text: texto }], usage: { input_tokens: 10, output_tokens: 10 } }
      },
    }
  }
}
process.env.ANTHROPIC_API_KEY_PROD ||= 'sk-ant-prueba-' + 'x'.repeat(40)
const IA_FN = require('../functions/ia.js')
const JUEGO = require('../functions/juego.js')._pruebas
const L = require('../functions/actividadLimpieza.js')
const correr = (data) => IA_FN.ejecutarOperacionIA.run({ auth: { uid: DOCENTE }, data })

const TARIFAS = {
  version: 1,
  tarifas: { calificar_entregable_ia: 0.25, calificar_entregable_ia_imagenes: 0.5, generar_contenido_juego: 3 },
  categorias: { calificar_entregable_ia: 'Calificación de evidencias', generar_contenido_juego: 'Actividades' },
  modeloPorOperacion: { calificar_entregable_ia: 'claude-haiku-4-5', generar_contenido_juego: 'claude-haiku-4-5' },
}
const RUBRICA = {
  tipo: 'rubrica',
  criterios: [{ nombre: 'Criterio 1', puntos: [10, 5, 0], descriptores: ['Completo', 'Parcial', 'No cumple'] }],
  niveles: [{ nombre: 'Completo' }, { nombre: 'Parcial' }, { nombre: 'No cumple' }],
}
// Una entrega en PDF de texto (real, generado aquí), servida sin red.
const PDF_TEXTO = FX.pdf({ caracteresPorPagina: 600 })
const fetchReal = globalThis.fetch
function pincharArchivos() {
  globalThis.fetch = async (url, ...resto) => {
    const u = String(url)
    if (!u.startsWith('https://archivos.test/')) return fetchReal(url, ...resto)
    return new Response(PDF_TEXTO, { status: 200 })
  }
}

async function sembrarBase() {
  await limpiar()
  pincharArchivos()
  pedidosIA.length = 0
  borrarDurante = null
  require('../functions/evidenciasEntrega.js')._pruebas.limpiarCache()
  L.fijarPruebasLimpieza({})
  await db.doc(`users/${DOCENTE}`).set({ role: 'docente', nombre: 'Prueba', escuelaId: 'E1', perfilIA: { estiloClase: 'Participativo', habilidades: 'Proyectos', experiencia: '8 años' } })
  await db.doc('config/iaTarifas').set(TARIFAS)
  await db.doc(`iaCreditos/${DOCENTE}`).set({ saldo: 100, consumidoTotal: 0, consumoPorCategoria: {} })
  await db.doc('subjects/sub-t').set({ docenteId: DOCENTE, nombre: 'Informática', parciales: 2 })
}
async function sembrarEntregable(act) {
  await db.doc(`activities/${act}`).set({
    docenteId: DOCENTE, asignaturaId: 'sub-t', parcial: 1, categoria: 'entregable', nombre: 'Práctica',
    instrucciones: 'Entrega tu práctica', tiposArchivo: ['todos'], rubrica: RUBRICA,
  })
  await db.doc(`submissions/${act}_al1`).set({ actividadId: act, alumnoId: 'al1', calificacion: null, archivos: [{ url: `https://archivos.test/${act}-tarea.pdf`, nombre: 'tarea.pdf' }] })
}
async function calificar(act) {
  const sub = `${act}_al1`
  const costo = (await correr({ operacion: 'estimar_calificacion_evidencias', params: { modo: 'individual', actividadId: act, submissionId: sub } })).estimacion
  return correr({ operacion: 'calificar_entregable_ia', idempotencyKey: clave(), unidades: 1, params: { actividadId: act, submissionId: sub, costoConfirmado: costo } })
}
async function sembrarJuego(act, tipoJuego = 'crucigrama') {
  await db.doc(`activities/${act}`).set({
    nombre: '', categoria: 'juego', tipoJuego, asignaturaId: 'sub-t', docenteId: DOCENTE, parcial: 1, oculta: true,
    juego: { modalidad: 'descripcion', cantidadPalabras: 6, contenido: [], estado: null, estructura: null },
  })
}
const generarJuego = (act) => correr({
  operacion: 'generar_contenido_juego', idempotencyKey: clave(),
  params: { actividadId: act, asignaturaNombre: 'Informática', modalidad: 'descripcion', cantidadPalabras: 6, contexto: 'Partes del escritorio de Windows', fuentes: [] },
})
const datosDe = async (act) => (await db.doc(`activities/${act}`).get()).data()
const limpiarComoTrigger = (act, datos) => funciones.onActividadBorradaLimpiar.run({ params: { activityId: act }, data: { exists: true, data: () => datos } })

// ═════════════════════════════════════════════════════════════════════════════
grupo('calificar_entregable_ia → iaSugerenciasEntregable')
// ═════════════════════════════════════════════════════════════════════════════
await caso('con la actividad viva: la propuesta queda «pendiente» como siempre', async () => {
  await sembrarBase()
  await sembrarEntregable('ACT')
  const r = await calificar('ACT')
  assert.ok(r.resultado?.criterios?.length, 'devuelve la propuesta')
  const s = (await db.doc('activities/ACT/iaSugerenciasEntregable/ACT_al1').get()).data()
  assert.strictEqual(s.estado, 'pendiente')
  assert.strictEqual(s.sub, 'ACT_al1')
  assert.ok(s.rubricaFirma)
})

await caso('actividad borrada mientras la IA califica: no nace la propuesta huérfana; la otra actividad no se toca', async () => {
  await sembrarBase()
  await sembrarEntregable('ACT')
  await sembrarEntregable('OTRA')
  await calificar('OTRA')
  const otraAntes = (await db.doc('activities/OTRA/iaSugerenciasEntregable/OTRA_al1').get()).data()
  const datos = await datosDe('ACT')
  const saldoAntes = await saldoDe()
  borrarDurante = 'ACT'
  const r = await calificar('ACT')
  assert.ok(r.resultado?.criterios?.length, 'la operación termina igual que antes (mismo resultado y cobro)')
  assert.strictEqual(await saldoDe(), saldoAntes - 0.25, 'el cobro no cambia: la IA sí trabajó')
  assert.strictEqual(await existe('activities/ACT'), false)
  assert.strictEqual(await tam('activities/ACT/iaSugerenciasEntregable'), 0, 'sin propuesta huérfana')
  await limpiarComoTrigger('ACT', datos)
  assert.strictEqual(await tam('activities/ACT/iaSugerenciasEntregable'), 0)
  assert.deepStrictEqual((await db.doc('activities/OTRA/iaSugerenciasEntregable/OTRA_al1').get()).data(), otraAntes, 'la otra actividad intacta')
})

await caso('reintento después del borrado: se rechaza y no recrea nada', async () => {
  const e = await falla(() => calificar('ACT'))
  assert.ok(e, 'la actividad ya no existe')
  assert.strictEqual(await tam('activities/ACT/iaSugerenciasEntregable'), 0)
  assert.strictEqual(await existe('activities/ACT'), false, 'tampoco recrea la actividad')
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('generar_contenido_juego → clave/contenido')
// ═════════════════════════════════════════════════════════════════════════════
await caso('con la actividad viva: la clave del contenido se escribe y el juego avanza', async () => {
  await sembrarBase()
  await sembrarJuego('JG')
  const r = await generarJuego('JG')
  assert.strictEqual(r.resultado.contenido.length, 6)
  assert.strictEqual((await db.doc('activities/JG/clave/contenido').get()).data().contenido.length, 6)
  assert.strictEqual((await datosDe('JG')).juego.estado, 'contenido_generado')
})

await caso('actividad borrada mientras la IA genera: falla como antes, devuelve los créditos y no deja clave huérfana', async () => {
  await sembrarBase()
  await sembrarJuego('JG')
  await sembrarJuego('JG2')
  await generarJuego('JG2')
  const otraClave = (await db.doc('activities/JG2/clave/contenido').get()).data()
  const datos = await datosDe('JG')
  const saldoAntes = await saldoDe()
  borrarDurante = 'JG'
  const e = await falla(() => generarJuego('JG'))
  assert.ok(e, 'la operación falla (la actividad ya no existe), igual que antes del cambio')
  assert.strictEqual(await saldoDe(), saldoAntes, 'el apartado de créditos se devuelve como en cualquier falla')
  assert.strictEqual(await existe('activities/JG/clave/contenido'), false, 'sin clave huérfana')
  assert.strictEqual(await existe('activities/JG'), false, 'no recrea la actividad')
  await limpiarComoTrigger('JG', datos)
  assert.strictEqual(await tam('activities/JG/clave'), 0)
  assert.deepStrictEqual((await db.doc('activities/JG2/clave/contenido').get()).data(), otraClave, 'la otra actividad intacta')
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('construirJuego → clave/juego y clave/contenido')
// ═════════════════════════════════════════════════════════════════════════════
await caso('con la actividad viva: crucigrama y sopa de letras escriben las dos piezas de la clave', async () => {
  for (const tipo of ['crucigrama', 'sopa_letras']) {
    await sembrarBase()
    await sembrarJuego('JG', tipo)
    if (tipo === 'sopa_letras') await db.doc('activities/JG').update({ 'juego.tamanoSopa': 12 })
    await generarJuego('JG')
    await JUEGO.construirJuegoImpl({ auth: { uid: DOCENTE }, data: { actividadId: 'JG' } })
    assert.ok((await db.doc('activities/JG/clave/juego').get()).exists, `${tipo}: clave/juego`)
    assert.ok((await db.doc('activities/JG/clave/contenido').get()).exists, `${tipo}: clave/contenido`)
    assert.strictEqual((await datosDe('JG')).juego.estado, 'juego_generado')
  }
})

await caso('actividad borrada mientras se arma el tablero: falla como antes y no deja ninguna pieza de la clave', async () => {
  await sembrarBase()
  await sembrarJuego('JG')
  await sembrarJuego('JG2')
  await generarJuego('JG')
  await generarJuego('JG2')
  await JUEGO.construirJuegoImpl({ auth: { uid: DOCENTE }, data: { actividadId: 'JG2' } })
  const otra = { juego: (await db.doc('activities/JG2/clave/juego').get()).data(), contenido: (await db.doc('activities/JG2/clave/contenido').get()).data() }
  const datos = await datosDe('JG')
  // El generador de contenido ya dejó clave/contenido: el docente borra la actividad (el navegador no puede borrar la
  // clave); la limpieza del servidor la quita. Luego llega tarde el armado del tablero.
  let borrado = null
  L.fijarPruebasLimpieza({
    dentroDeTransaccion: async (id) => {
      if (id !== 'JG' || borrado) return
      borrado = db.doc('activities/JG').delete()
      await new Promise((r) => setTimeout(r, 300))
    },
  })
  try {
    const e = await falla(() => JUEGO.construirJuegoImpl({ auth: { uid: DOCENTE }, data: { actividadId: 'JG' } }))
    assert.ok(e, 'la operación falla (la actividad ya no existe), igual que antes del cambio')
  } finally {
    L.fijarPruebasLimpieza({})
  }
  await borrado
  await limpiarComoTrigger('JG', datos)
  assert.strictEqual(await existe('activities/JG'), false, 'no recrea la actividad')
  assert.strictEqual(await tam('activities/JG/clave'), 0, 'sin clave huérfana')
  assert.deepStrictEqual((await db.doc('activities/JG2/clave/juego').get()).data(), otra.juego, 'la otra actividad intacta')
  assert.deepStrictEqual((await db.doc('activities/JG2/clave/contenido').get()).data(), otra.contenido)
})

await caso('reintento del armado después del borrado: «la actividad no existe» y no escribe nada', async () => {
  const e = await falla(() => JUEGO.construirJuegoImpl({ auth: { uid: DOCENTE }, data: { actividadId: 'JG' } }))
  assert.match(String(e.code || ''), /not-found/)
  assert.strictEqual(await tam('activities/JG/clave'), 0)
})

await limpiar()
resumen('limpieza-escritores-ia.test.mjs')
