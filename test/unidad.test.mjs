// Nivel 0 — funciones puras. NO necesita emulador ni red.
//
//   node test/unidad.test.mjs
//
// Cubre las dos piezas de las que dependen los peores fallos posibles del
// sistema y que hasta hoy no tenían un solo caso:
//
//   · `extraerAssets` decide QUÉ archivos se borran cuando alguien elimina su
//     cuenta. Si no encuentra una URL, ese archivo se queda en Cloudinary para
//     siempre. Es exhaustivo por construcción (recorre el JSON con una
//     expresión regular), y estos casos son los que fijan ese contrato.
//   · La aritmética de calificación es el número que llega a la escuela. Es lo
//     que audita la Fase 3.

import assert from 'node:assert'
import { createRequire } from 'node:module'
import { extraerAssets } from '../api/_lib/cloudinary.js'

process.env.GCLOUD_PROJECT ||= 'demo-test'
const require = createRequire(import.meta.url)
const { _pruebas: F } = require('../functions/index.js')

let pasadas = 0
const fallos = []
const caso = (nombre, fn) => {
  try { fn(); console.log('  ✓', nombre); pasadas++ }
  catch (e) { console.log('  ✗', nombre); console.log('     ', e.message.split('\n')[0]); fallos.push({ nombre, e }) }
}
const grupo = (t) => console.log(`\n── ${t}`)

const ids = (objeto) => [...extraerAssets(objeto).values()].map((a) => `${a.tipo}/${a.publicId}`).sort()
const URL = (tipo, id, ext = '.png') => `https://res.cloudinary.com/demo/${tipo}/upload/v1712345678/${id}${ext}`

// ═══ extraerAssets ═══════════════════════════════════════════════════════════
grupo('extraerAssets — de dónde saca las URLs')

caso('la encuentra en un campo suelto', () => {
  assert.deepStrictEqual(ids({ photoURL: URL('image', 'evalua-facil/avatars/abc') }),
    ['image/evalua-facil/avatars/abc'])
})

caso('la encuentra DENTRO del HTML de las instrucciones', () => {
  assert.deepStrictEqual(
    ids({ instrucciones: `<p>Miren</p><img src="${URL('image', 'evalua-facil/uploads/xyz')}" alt="x">` }),
    ['image/evalua-facil/uploads/xyz'])
})

caso('la encuentra dentro de un arreglo anidado', () => {
  assert.deepStrictEqual(
    ids({ adjuntos: [{ nombre: 'a.png', url: URL('image', 'evalua-facil/adj/n1') }] }),
    ['image/evalua-facil/adj/n1'])
})

caso('un campo NUEVO que nadie previó también se limpia', () => {
  // Este es el contrato que hace que `extraerAssets` sea exhaustivo por
  // construcción: no hay lista de campos que mantener.
  assert.deepStrictEqual(ids({ campoInventadoEn2027: URL('image', 'evalua-facil/x/nuevo') }),
    ['image/evalua-facil/x/nuevo'])
})

caso('en `raw` la extensión ES parte del public_id; en imagen NO', () => {
  assert.deepStrictEqual(ids({
    a: URL('raw', 'evalua-facil/recursos/doc', '.docx'),
    b: URL('image', 'evalua-facil/fotos/img', '.png'),
  }), ['image/evalua-facil/fotos/img', 'raw/evalua-facil/recursos/doc.docx'])
})

caso('las transformaciones antes de la versión no entran en el public_id', () => {
  assert.deepStrictEqual(
    ids({ u: 'https://res.cloudinary.com/demo/image/upload/w_200,h_200,c_fill/v1712345678/evalua-facil/a/b.png' }),
    ['image/evalua-facil/a/b'])
})

caso('una URL que no es de Cloudinary se ignora', () => {
  assert.deepStrictEqual(ids({ u: 'https://ejemplo.com/foto.png', v: 'no soy una url' }), [])
})

caso('la misma URL dos veces cuenta una sola', () => {
  const u = URL('image', 'evalua-facil/a/dup')
  assert.deepStrictEqual(ids({ a: u, b: u, c: { d: u } }), ['image/evalua-facil/a/dup'])
})

caso('un documento sin URLs no devuelve nada, y no revienta con null', () => {
  assert.deepStrictEqual(ids({ nombre: 'x', n: 3, nulo: null, f: false }), [])
  assert.deepStrictEqual(ids(null), [])
  assert.deepStrictEqual(ids(undefined), [])
})

caso('acumula sobre el mismo mapa a lo largo de varios documentos', () => {
  const mapa = new Map()
  extraerAssets({ a: URL('image', 'evalua-facil/a/1') }, mapa)
  extraerAssets({ b: URL('image', 'evalua-facil/a/2') }, mapa)
  assert.strictEqual(mapa.size, 2)
})

// ═══ Calificación ════════════════════════════════════════════════════════════
grupo('Calificación — el número que llega a la escuela')

caso('pondera y redondea a un decimal', () => {
  const preguntas = [{ id: 'a', ponderacion: 1 }, { id: 'b', ponderacion: 1 }, { id: 'c', ponderacion: 1 }]
  const respuestas = { a: { puntosObtenidos: 1 }, b: { puntosObtenidos: 1 }, c: { puntosObtenidos: 0 } }
  assert.strictEqual(F.calcularCalificacion(preguntas, respuestas, 10), 6.7)
})

caso('respeta maxCalif distinto de 10', () => {
  const preguntas = [{ id: 'a', ponderacion: 1 }, { id: 'b', ponderacion: 1 }]
  assert.strictEqual(F.calcularCalificacion(preguntas, { a: { puntosObtenidos: 1 } }, 100), 50)
})

caso('ponderación total 0 da 0 y no divide entre cero', () => {
  assert.strictEqual(F.calcularCalificacion([{ id: 'a', ponderacion: 0 }], { a: { puntosObtenidos: 5 } }, 10), 0)
  assert.strictEqual(F.calcularCalificacion([], {}, 10), 0)
})

caso('una pregunta sin responder cuenta 0, no rompe la suma', () => {
  const preguntas = [{ id: 'a', ponderacion: 1 }, { id: 'b', ponderacion: 1 }]
  assert.strictEqual(F.calcularCalificacion(preguntas, { a: { puntosObtenidos: 1 } }, 10), 5)
})

caso('solo las preguntas objetivas se califican solas', () => {
  const p = { tipo: 'opcion_multiple', ponderacion: 3, respuestaCorrecta: 2 }
  assert.strictEqual(F.calcularPuntosPregunta(p, { opcionSeleccionada: 2 }), 3)
  assert.strictEqual(F.calcularPuntosPregunta(p, { opcionSeleccionada: 1 }), 0)
  // Abierta: devuelve null = "no la puedo calificar yo"
  assert.strictEqual(F.calcularPuntosPregunta({ tipo: 'respuesta_corta', ponderacion: 3 }, { texto: 'algo' }), null)
})

caso('no contestar NO es acertar (opción 0 es una opción válida)', () => {
  const p = { tipo: 'verdadero_falso', ponderacion: 2, respuestaCorrecta: 0 }
  assert.strictEqual(F.calcularPuntosPregunta(p, {}), 0)
  assert.strictEqual(F.calcularPuntosPregunta(p, { opcionSeleccionada: null }), 0)
  assert.strictEqual(F.calcularPuntosPregunta(p, { opcionSeleccionada: 0 }), 2)
})

caso('queda pendiente de revisión si falta calificar una abierta', () => {
  const preguntas = [{ id: 'a', tipo: 'opcion_multiple' }, { id: 'b', tipo: 'respuesta_corta' }]
  assert.strictEqual(F.resolverPendienteRevision(preguntas, { a: { puntosObtenidos: 1 } }), true)
  assert.strictEqual(F.resolverPendienteRevision(preguntas, { a: { puntosObtenidos: 1 }, b: { puntosObtenidos: 0 } }), false)
  assert.strictEqual(F.resolverPendienteRevision([{ id: 'a', tipo: 'verdadero_falso' }], {}), false)
})

caso('con varios intentos, cada política conserva lo que dice', () => {
  const previos = [{ calificacion: 6 }, { calificacion: 9 }]
  assert.strictEqual(F.resolverCalificacionFinal(previos, 7, 'primero'), 6)
  assert.strictEqual(F.resolverCalificacionFinal(previos, 7, 'mejor'), 9)
  assert.strictEqual(F.resolverCalificacionFinal(previos, 7, 'ultimo'), 7)
  assert.strictEqual(F.resolverCalificacionFinal(previos, 7, 'promedio'), 7.3)
  assert.strictEqual(F.resolverCalificacionFinal(previos, 7, undefined), 7)
})

caso('el primer intento vale, sea cual sea la política', () => {
  for (const pol of ['primero', 'mejor', 'ultimo', 'promedio'])
    assert.strictEqual(F.resolverCalificacionFinal([], 8, pol), 8)
})

// ═══ Asistencia y visibilidad ════════════════════════════════════════════════
grupo('Asistencia y visibilidad')

caso('al borrarse una columna, todos sus alumnos quedan afectados', () => {
  assert.deepStrictEqual(F.idsAfectados({ presentes: { a: true, b: false } }, null).sort(), ['a', 'b'])
})

caso('una columna nueva afecta a todos los que trae', () => {
  assert.deepStrictEqual(F.idsAfectados(null, { presentes: { a: true } }), ['a'])
})

caso('cambiar solo el MOTIVO de una justificación también cuenta', () => {
  // Fue un fallo real: sin esto el resumen del alumno se quedaba con el
  // motivo viejo para siempre.
  const antes = { presentes: { a: false }, justificadas: { a: true }, motivos: { a: 'cita' } }
  const despues = { presentes: { a: false }, justificadas: { a: true }, motivos: { a: 'enfermedad' } }
  assert.deepStrictEqual(F.idsAfectados(antes, despues), ['a'])
})

caso('si no cambió nada, no se recalcula a nadie', () => {
  const x = { presentes: { a: true, b: false }, justificadas: { b: true }, motivos: { b: 'm' } }
  assert.deepStrictEqual(F.idsAfectados(x, { ...x }), [])
})

caso('una actividad de un parcial oculto no es visible aunque no esté oculta', () => {
  assert.strictEqual(F.actividadVisible({ oculta: false }, true), false)
  assert.strictEqual(F.actividadVisible({ oculta: false }, false), true)
})

caso('una actividad programada se hace visible al llegar su hora', () => {
  const ayer = new Date(Date.now() - 86400000).toISOString()
  const manana = new Date(Date.now() + 86400000).toISOString()
  assert.strictEqual(F.actividadVisible({ oculta: true, publishAt: ayer }, false), true)
  assert.strictEqual(F.actividadVisible({ oculta: true, publishAt: manana }, false), false)
  assert.strictEqual(F.actividadVisible({ oculta: true }, false), false)
})

// ═══ Vigencia ════════════════════════════════════════════════════════════════
grupo('Vigencia de la suscripción')

caso('"vencida" corta de inmediato', () => {
  assert.strictEqual(F.vigenciaDe({ status: 'vencida', planId: 'mensual' }).getTime(), 0)
})

caso('cancelada conserva hasta la fecha ya pagada', () => {
  const venc = new Date('2026-12-31T00:00:00Z')
  assert.strictEqual(F.vigenciaDe({ status: 'cancelada', planId: 'mensual', fechaVencimiento: venc }).getTime(), venc.getTime())
})

caso('la cortesía indefinida no vence', () => {
  assert.ok(F.vigenciaDe({ status: 'activa', planId: 'cortesia', cortesiaIndefinida: true }).getFullYear() > 2900)
})

caso('sin suscripción no hay vigencia (y no revienta)', () => {
  assert.strictEqual(F.vigenciaDe(null), null)
  assert.strictEqual(F.vigenciaDe({ status: 'trial' }), null)
})

// ═══ El export de pruebas no se despliega ════════════════════════════════════
grupo('Higiene')

caso('`_pruebas` es un objeto plano y no una función desplegable', () => {
  // El análisis del despliegue solo recoge exportaciones con `__endpoint`.
  assert.strictEqual(typeof F, 'object')
  assert.strictEqual(F.__endpoint, undefined)
  assert.strictEqual(typeof F.calcularCalificacion, 'function')
})

// ═══ Resumen ═════════════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(60)}`)
if (fallos.length) {
  console.log(`${pasadas} pasaron, ${fallos.length} FALLARON\n`)
  fallos.forEach((f) => console.log(`  ✗ ${f.nombre}\n    ${f.e.message}`))
  process.exit(1)
}
console.log(`ALL ${pasadas} UNIT CHECKS PASSED`)
