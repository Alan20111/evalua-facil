// La Ruleta del Destino — fase 0: lógica pura (src/utils/ruletaDestino.js). No necesita emulador ni red.
//
//   node test/ruleta-destino.test.mjs
//
// Cubre:
//   A. configuración: 5/10 preguntas (las de 20 se eliminaron el 7-nov-2026); banco manual 50–100 / 100–200;
//   B. reactivos y bancos: 4 opciones, una correcta, ids y enunciados sin repetir, datos inválidos;
//   C. sorteo: sin repetir, tamaño exacto, determinista con semilla, no modifica el banco, azar inválido;
//   D. partida: girar, responder, vencer; sin giros extra, sin respuestas duplicadas, estados inválidos;
//   E. tiempo: 15 s del servidor, fuera de tiempo y sin respuesta = incorrecta, margen opcional;
//   F. calificación: 5/5=10, 4/5=8, 8/10=8, el tiempo no la cambia;
//   G. ranking: más correctas, luego menor tiempo SOLO en correctas, empates exactos consistentes.

import assert from 'node:assert'
import {
  RULETA_CFG, ESTADOS_PARTIDA, MOTIVOS_RESPUESTA,
  normalizarTexto, preguntasPorPartidaValida, tamanoBanco, validarReactivo, validarBanco,
  generadorDeterminista, sortearPreguntas, ordenPerteneceAlBanco,
  crearPartida, validarPartida, girar, responder, vencerPregunta, tiempoRestanteMs,
  calificacionRuleta, resumenPartida, compararResultados, clasificarResultados,
} from '../src/utils/ruletaDestino.js'

let pasadas = 0
let fallos = 0
function caso(nombre, fn) {
  try { fn(); pasadas++; console.log(`  ✓ ${nombre}`) } catch (e) { fallos++; console.log(`  ✗ ${nombre}\n    ${e.message}`) }
}
function grupo(titulo) { console.log(`\n${titulo}`) }

const T = RULETA_CFG.TIEMPO_RESPUESTA_MS
const T0 = 1_000_000 // hora del servidor (ms)

const reactivo = (i, extra = {}) => ({
  id: `r${i}`, enunciado: `Pregunta número ${i}`, opciones: [`A${i}`, `B${i}`, `C${i}`, `D${i}`], correcta: i % 4, ...extra,
})
const banco = (n) => Array.from({ length: n }, (_, i) => reactivo(i))
const idsBanco = (n) => banco(n).map((r) => r.id)
const claveDe = (id) => Number(id.slice(1)) % 4 // la clave del reactivo de prueba r{i}

function ok(r) {
  assert.ok(r.ok, `rechazada: ${r.codigo}`)
  return r
}
function partidaNueva(n, semilla = 7) {
  const orden = sortearPreguntas(idsBanco(tamanoBanco(n)), n, generadorDeterminista(semilla))
  return ok(crearPartida({ orden, preguntasPorPartida: n })).partida
}
/**
 * Juega una partida completa. `plan[i]` = { acierta: bool, ms } o { vence: true }. Cada pregunta se abre 1 s después
 * de cerrar la anterior.
 */
function jugar(n, plan, semilla = 7) {
  let p = partidaNueva(n, semilla)
  let ahora = T0
  for (let i = 0; i < n; i++) {
    const g = ok(girar(p, ahora))
    p = g.partida
    const paso = plan[i] ?? { acierta: false, ms: 1000 }
    if (paso.vence) {
      ahora += T + 1
      p = ok(vencerPregunta(p, ahora)).partida
    } else {
      const correcta = claveDe(g.reactivoId)
      const opcion = paso.acierta ? correcta : (correcta + 1) % 4
      ahora += paso.ms
      p = ok(responder(p, { indice: g.indice, opcion, ahoraMs: ahora, correcta })).partida
    }
    ahora += 1000
  }
  return p
}
const aciertos = (n, k, ms = 1000) => Array.from({ length: n }, (_, i) => ({ acierta: i < k, ms }))

// ── A. Configuración ─────────────────────────────────────────────────────────
grupo('A · configuración')

caso('A · solo 5 o 10 preguntas por partida; 20 ya no existe', () => {
  for (const n of [5, 10]) assert.strictEqual(preguntasPorPartidaValida(n), true)
  for (const n of [20, 0, 1, 4, 6, 15, 21, 25, 50, -5, 5.5, '5', '10', null, undefined, NaN]) assert.strictEqual(preguntasPorPartidaValida(n), false, String(n))
  assert.deepStrictEqual(RULETA_CFG.PREGUNTAS_POR_PARTIDA, [5, 10])
})

caso('A · banco MANUAL de 10 reactivos por pregunta: 5→50, 10→100; 20 lanza RangeError', () => {
  assert.strictEqual(RULETA_CFG.REACTIVOS_POR_PREGUNTA, 10)
  assert.strictEqual(tamanoBanco(5), 50)
  assert.strictEqual(tamanoBanco(10), 100)
  assert.throws(() => tamanoBanco(20), RangeError)
  assert.throws(() => tamanoBanco(7), RangeError)
})

caso('A · 15 s por pregunta y calificación máxima 10', () => {
  assert.strictEqual(RULETA_CFG.TIEMPO_RESPUESTA_MS, 15000)
  assert.strictEqual(RULETA_CFG.CALIFICACION_MAXIMA, 10)
  assert.strictEqual(RULETA_CFG.OPCIONES_POR_REACTIVO, 4)
})

// ── B. Reactivos y bancos ────────────────────────────────────────────────────
grupo('B · reactivos y bancos')

caso('B · un reactivo válido tiene 4 opciones y una correcta (0 a 3)', () => {
  assert.deepStrictEqual(validarReactivo(reactivo(1)), { ok: true, errores: [] })
  for (const c of [0, 1, 2, 3]) assert.ok(validarReactivo(reactivo(1, { correcta: c })).ok)
})

caso('B · rechaza opciones de más o de menos, vacías o repetidas', () => {
  assert.deepStrictEqual(validarReactivo(reactivo(1, { opciones: ['a', 'b', 'c'] })).errores, ['opciones_cantidad'])
  assert.deepStrictEqual(validarReactivo(reactivo(1, { opciones: ['a', 'b', 'c', 'd', 'e'] })).errores, ['opciones_cantidad'])
  assert.deepStrictEqual(validarReactivo(reactivo(1, { opciones: ['a', ' ', 'c', 'd'] })).errores, ['opcion_vacia'])
  // Repetidas aunque cambien mayúsculas, acentos o espacios.
  assert.deepStrictEqual(validarReactivo(reactivo(1, { opciones: ['Célula', 'celula ', 'b', 'c'] })).errores, ['opciones_repetidas'])
})

caso('B · rechaza clave fuera de 0..3, sin id o sin enunciado', () => {
  for (const c of [-1, 4, 1.5, '1', null, undefined]) assert.deepStrictEqual(validarReactivo(reactivo(1, { correcta: c })).errores, ['correcta'], String(c))
  assert.deepStrictEqual(validarReactivo(reactivo(1, { id: '' })).errores, ['id'])
  assert.deepStrictEqual(validarReactivo(reactivo(1, { enunciado: '   ' })).errores, ['enunciado'])
  assert.deepStrictEqual(validarReactivo(null).errores, ['reactivo_invalido'])
})

caso('B · bancos manuales de 50 y 100 completos para 5 y 10', () => {
  for (const n of [5, 10]) {
    const v = validarBanco(banco(n * 10), n)
    assert.deepStrictEqual(v, { ok: true, errores: [], total: n * 10, requerido: n * 10, completo: true })
  }
})

caso('B · banco manual mínimo = 10 por pregunta: debajo se rechaza con banco_incompleto; igual o más se acepta', () => {
  const casos = [
    [5, 49, false], [5, 50, true], [5, 80, true],
    [10, 99, false], [10, 100, true], [10, 150, true],
    [5, 4, false], [10, 12, false], [10, 0, false],
  ]
  for (const [n, tam, inicia] of casos) {
    const v = validarBanco(banco(tam), n)
    const etiqueta = `${n} preguntas con ${tam} reactivos`
    assert.strictEqual(v.ok, inicia, etiqueta)
    assert.strictEqual(v.completo, inicia, etiqueta)
    assert.strictEqual(v.total, tam, etiqueta)
    assert.strictEqual(v.requerido, n * 10, etiqueta)
    assert.deepStrictEqual(v.errores, inicia ? [] : ['banco_incompleto'], etiqueta)
  }
})

caso('B · un banco con más del mínimo no se recorta y se sortea de TODO el banco, sin repetir', () => {
  const b = banco(80)
  const copia = JSON.parse(JSON.stringify(b))
  assert.ok(validarBanco(b, 5).ok)
  assert.deepStrictEqual(b, copia) // validar no quita reactivos
  const ids = b.map((r) => r.id)
  const vistos = new Set()
  for (let s = 0; s < 400; s++) {
    const orden = sortearPreguntas(ids, 5, generadorDeterminista(s))
    assert.strictEqual(new Set(orden).size, 5)
    orden.forEach((id) => vistos.add(id))
  }
  assert.strictEqual(vistos.size, 80) // también salen los reactivos más allá de los 50
})

caso('B · completo pero con errores de estructura: rechazado, y completo sigue diciendo que alcanza el mínimo', () => {
  const b = banco(50)
  b[7] = reactivo(7, { opciones: ['a', 'b', 'c'] })
  const v = validarBanco(b, 5)
  assert.strictEqual(v.ok, false)
  assert.strictEqual(v.completo, true)
  assert.deepStrictEqual(v.errores, ['reactivo_invalido:7'])
  // Incompleto y con errores: se informan los dos.
  const c = banco(24)
  c[0] = reactivo(0, { correcta: 7 })
  assert.deepStrictEqual(validarBanco(c, 5).errores, ['reactivo_invalido:0', 'banco_incompleto'])
})

caso('B · banco con ids o enunciados repetidos, reactivo inválido o tamaño de partida inválido: rechazado', () => {
  const b = banco(50)
  b[10] = reactivo(10, { id: 'r3' })
  assert.ok(validarBanco(b, 5).errores.includes('id_repetido:10'))
  const c = banco(50)
  c[20] = reactivo(20, { enunciado: '  PREGUNTA número 3 ' })
  assert.ok(validarBanco(c, 5).errores.includes('enunciado_repetido:20'))
  const d = banco(50)
  d[5] = reactivo(5, { correcta: 9 })
  assert.ok(validarBanco(d, 5).errores.includes('reactivo_invalido:5'))
  assert.ok(validarBanco(banco(50), 6).errores.includes('preguntas_por_partida'))
  assert.strictEqual(validarBanco('no', 5).ok, false)
})

caso('B · normalizar texto ignora mayúsculas, acentos y espacios', () => {
  assert.strictEqual(normalizarTexto('  Fotosíntesis   EN  plantas '), 'fotosintesis en plantas')
})

// ── C. Sorteo ────────────────────────────────────────────────────────────────
grupo('C · sorteo de preguntas')

caso('C · nunca repite preguntas y entrega exactamente las autorizadas (1 000 semillas × 2 tamaños)', () => {
  for (const n of [5, 10]) {
    const ids = idsBanco(tamanoBanco(n))
    for (let s = 0; s < 1000; s++) {
      const orden = sortearPreguntas(ids, n, generadorDeterminista(s))
      assert.strictEqual(orden.length, n)
      assert.strictEqual(new Set(orden).size, n, `repetida con semilla ${s}`)
      assert.ok(ordenPerteneceAlBanco(orden, ids))
    }
  }
})

caso('C · determinista: misma semilla, mismo orden; semillas distintas, órdenes distintos', () => {
  const ids = idsBanco(50)
  assert.deepStrictEqual(sortearPreguntas(ids, 10, generadorDeterminista(42)), sortearPreguntas(ids, 10, generadorDeterminista(42)))
  const distintos = new Set(Array.from({ length: 50 }, (_, s) => sortearPreguntas(ids, 10, generadorDeterminista(s)).join(',')))
  assert.ok(distintos.size > 45, `solo ${distintos.size} órdenes distintos de 50`)
})

caso('C · cada participante recibe una combinación distinta y todo el banco puede salir', () => {
  const ids = idsBanco(50)
  const vistos = new Set()
  for (let s = 0; s < 300; s++) sortearPreguntas(ids, 5, generadorDeterminista(s)).forEach((id) => vistos.add(id))
  assert.strictEqual(vistos.size, 50)
})

caso('C · con azar en los extremos [0 y casi 1] sigue sin repetir', () => {
  const ids = idsBanco(50)
  for (const x of [0, 0.999999999]) {
    const orden = sortearPreguntas(ids, 5, () => x)
    assert.strictEqual(new Set(orden).size, 5)
  }
})

caso('C · no modifica el banco recibido', () => {
  const ids = idsBanco(50)
  const copia = ids.slice()
  sortearPreguntas(ids, 5, generadorDeterminista(1))
  assert.deepStrictEqual(ids, copia)
})

caso('C · rechaza datos inválidos', () => {
  const ids = idsBanco(50)
  assert.throws(() => sortearPreguntas(ids, 6, generadorDeterminista(1)), RangeError) // tamaño no autorizado
  assert.throws(() => sortearPreguntas(idsBanco(4), 5, generadorDeterminista(1)), RangeError) // banco insuficiente
  assert.throws(() => sortearPreguntas(['r1', 'r1', 'r2', 'r3', 'r4', 'r5'], 5, generadorDeterminista(1)), RangeError)
  assert.throws(() => sortearPreguntas(['r1', '', 'r2', 'r3', 'r4'], 5, generadorDeterminista(1)), TypeError)
  assert.throws(() => sortearPreguntas(ids, 5), TypeError) // sin fuente de azar
  for (const x of [1, -0.1, NaN, Infinity, '0.5']) assert.throws(() => sortearPreguntas(ids, 5, () => x), RangeError, String(x))
  for (const s of [-1, 1.5, 2 ** 32, 'a']) assert.throws(() => generadorDeterminista(s), RangeError, String(s))
})

caso('C · el orden deja de ser válido si el docente borra un reactivo sorteado', () => {
  const ids = idsBanco(50)
  const orden = sortearPreguntas(ids, 5, generadorDeterminista(3))
  assert.strictEqual(ordenPerteneceAlBanco(orden, ids.filter((id) => id !== orden[2])), false)
})

// ── D. Partida ───────────────────────────────────────────────────────────────
grupo('D · avance de la partida')

caso('D · nace lista, sin respuestas, con el orden recibido (copiado)', () => {
  const orden = ['a', 'b', 'c', 'd', 'e']
  const { partida } = ok(crearPartida({ orden, preguntasPorPartida: 5 }))
  assert.strictEqual(partida.estado, ESTADOS_PARTIDA.lista)
  assert.strictEqual(partida.indice, 0)
  assert.deepStrictEqual(partida.respuestas, [])
  orden.push('f')
  assert.strictEqual(partida.orden.length, 5)
  assert.ok(validarPartida(partida).ok)
})

caso('D · crear rechaza tamaño no autorizado, orden de otro tamaño, repetidos o ids vacíos', () => {
  assert.strictEqual(crearPartida({ orden: ['a', 'b', 'c', 'd', 'e', 'f'], preguntasPorPartida: 6 }).codigo, 'preguntas_por_partida')
  assert.strictEqual(crearPartida({ orden: ['a', 'b', 'c', 'd'], preguntasPorPartida: 5 }).codigo, 'orden_tamano')
  assert.strictEqual(crearPartida({ orden: ['a', 'b', 'c', 'd', 'a'], preguntasPorPartida: 5 }).codigo, 'orden_repetido')
  assert.strictEqual(crearPartida({ orden: ['a', 'b', '', 'd', 'e'], preguntasPorPartida: 5 }).codigo, 'orden_id_invalido')
  assert.strictEqual(crearPartida().ok, false)
})

caso('D · girar abre la siguiente pregunta del orden y no modifica la partida anterior', () => {
  const p = partidaNueva(5)
  const g = ok(girar(p, T0))
  assert.strictEqual(g.indice, 0)
  assert.strictEqual(g.reactivoId, p.orden[0])
  assert.strictEqual(g.partida.estado, ESTADOS_PARTIDA.pregunta)
  assert.deepStrictEqual(g.partida.abierta, { indice: 0, reactivoId: p.orden[0], abiertaMs: T0 })
  assert.strictEqual(p.estado, ESTADOS_PARTIDA.lista) // la original no cambió
  assert.strictEqual(p.abierta, null)
})

caso('D · no se puede girar con una pregunta abierta (giro no autorizado)', () => {
  const g = ok(girar(partidaNueva(5), T0))
  assert.strictEqual(girar(g.partida, T0 + 100).codigo, 'pregunta_abierta')
})

caso('D · no se excede el número autorizado: tras la última no hay más giros', () => {
  for (const n of [5, 10]) {
    const p = jugar(n, aciertos(n, n))
    assert.strictEqual(p.estado, ESTADOS_PARTIDA.terminada)
    assert.strictEqual(p.respuestas.length, n)
    assert.strictEqual(girar(p, T0 + 10 ** 7).codigo, 'partida_terminada')
    assert.strictEqual(responder(p, { indice: n - 1, opcion: 0, ahoraMs: T0 + 10 ** 7, correcta: 0 }).codigo, 'partida_terminada')
  }
})

caso('D · nunca se repite una pregunta en la partida jugada', () => {
  for (const n of [5, 10]) {
    const p = jugar(n, aciertos(n, 2), 99)
    const jugadas = p.respuestas.map((r) => r.reactivoId)
    assert.strictEqual(new Set(jugadas).size, n)
    assert.deepStrictEqual(jugadas, p.orden)
  }
})

caso('D · una respuesta duplicada o atrasada se rechaza (índice distinto)', () => {
  const g = ok(girar(partidaNueva(5), T0))
  const r1 = ok(responder(g.partida, { indice: 0, opcion: 1, ahoraMs: T0 + 2000, correcta: 1 }))
  // El doble toque llega con el índice 0 cuando ya no hay pregunta abierta.
  assert.strictEqual(responder(r1.partida, { indice: 0, opcion: 2, ahoraMs: T0 + 2100, correcta: 1 }).codigo, 'sin_pregunta_abierta')
  // Con la siguiente abierta, una respuesta de la anterior tampoco cuenta.
  const g2 = ok(girar(r1.partida, T0 + 3000))
  assert.strictEqual(responder(g2.partida, { indice: 0, opcion: 2, ahoraMs: T0 + 3100, correcta: 1 }).codigo, 'indice_distinto')
  assert.strictEqual(responder(g2.partida, { indice: 2, opcion: 2, ahoraMs: T0 + 3100, correcta: 1 }).codigo, 'indice_distinto')
})

caso('D · responder sin pregunta abierta se rechaza', () => {
  assert.strictEqual(responder(partidaNueva(5), { indice: 0, opcion: 0, ahoraMs: T0, correcta: 0 }).codigo, 'sin_pregunta_abierta')
})

caso('D · datos de respuesta inválidos se rechazan', () => {
  const { partida } = ok(girar(partidaNueva(5), T0))
  for (const opcion of [-1, 4, 1.5, '1', null, undefined]) {
    assert.strictEqual(responder(partida, { indice: 0, opcion, ahoraMs: T0 + 1, correcta: 0 }).codigo, 'opcion_invalida', String(opcion))
  }
  assert.strictEqual(responder(partida, { indice: 0, opcion: 0, ahoraMs: T0 + 1, correcta: 4 }).codigo, 'clave_invalida')
  assert.strictEqual(responder(partida, { indice: 0, opcion: 0, ahoraMs: -5, correcta: 0 }).codigo, 'hora_invalida')
  assert.strictEqual(responder(partida, { indice: 0, opcion: 0, ahoraMs: T0 - 1, correcta: 0 }).codigo, 'hora_anterior_apertura')
  assert.strictEqual(responder(partida, { indice: 0, opcion: 0, ahoraMs: T0 + 1, correcta: 0 }, { margenMs: -1 }).codigo, 'margen_invalido')
  assert.strictEqual(girar(partidaNueva(5), 1.5).codigo, 'hora_invalida')
})

caso('D · una partida manipulada o incoherente se rechaza en cualquier transición', () => {
  const p = partidaNueva(5)
  const alteradas = [
    { ...p, orden: [...p.orden.slice(0, 4), p.orden[0]] }, // pregunta repetida
    { ...p, orden: [...p.orden, 'extra'] }, // más preguntas de las autorizadas
    { ...p, preguntasPorPartida: 7 },
    { ...p, indice: 2 }, // avance sin respuestas
    { ...p, estado: 'ganada' },
    { ...p, estado: ESTADOS_PARTIDA.pregunta, abierta: null },
    { ...p, estado: ESTADOS_PARTIDA.terminada },
    null,
  ]
  for (const a of alteradas) {
    assert.strictEqual(validarPartida(a).ok, false)
    assert.strictEqual(girar(a, T0).ok, false)
  }
  // Una respuesta registrada con tiempo de más o «correcta» sin respuesta.
  const jugada = jugar(5, aciertos(5, 5))
  const conTrampa = { ...jugada, respuestas: jugada.respuestas.map((r, i) => (i === 0 ? { ...r, tiempoMs: T + 1 } : r)) }
  assert.strictEqual(validarPartida(conTrampa).ok, false)
  const sinResp = { ...jugada, respuestas: jugada.respuestas.map((r, i) => (i === 0 ? { ...r, motivo: MOTIVOS_RESPUESTA.sin_respuesta } : r)) }
  assert.strictEqual(validarPartida(sinResp).ok, false)
  assert.throws(() => resumenPartida(conTrampa), RangeError)
})

caso('D · al reconstruir la partida desde sus datos (reingreso) sigue donde se quedó', () => {
  const g = ok(girar(partidaNueva(10), T0))
  const r = ok(responder(g.partida, { indice: 0, opcion: 0, ahoraMs: T0 + 3000, correcta: 0 })).partida
  const releida = JSON.parse(JSON.stringify(r)) // como si se leyera de la base de datos
  assert.ok(validarPartida(releida).ok)
  const g2 = ok(girar(releida, T0 + 60_000))
  assert.strictEqual(g2.indice, 1)
  assert.strictEqual(g2.reactivoId, r.orden[1])
})

// ── E. Tiempo ────────────────────────────────────────────────────────────────
grupo('E · tiempo (15 s del servidor)')

caso('E · dentro de 15 s cuenta acierto y tiempo; justo a los 15 s todavía cuenta', () => {
  const { partida } = ok(girar(partidaNueva(5), T0))
  const a = ok(responder(partida, { indice: 0, opcion: 2, ahoraMs: T0 + 4321, correcta: 2 })).respuesta
  assert.deepStrictEqual({ correcta: a.correcta, tiempoMs: a.tiempoMs, motivo: a.motivo }, { correcta: true, tiempoMs: 4321, motivo: 'respondida' })
  const b = ok(responder(partida, { indice: 0, opcion: 2, ahoraMs: T0 + T, correcta: 2 })).respuesta
  assert.strictEqual(b.correcta, true)
  assert.strictEqual(b.tiempoMs, T)
})

caso('E · después de 15 s es incorrecta aunque elija la correcta, y no suma tiempo', () => {
  const { partida } = ok(girar(partidaNueva(5), T0))
  const r = ok(responder(partida, { indice: 0, opcion: 2, ahoraMs: T0 + T + 1, correcta: 2 }))
  assert.deepStrictEqual({ correcta: r.respuesta.correcta, tiempoMs: r.respuesta.tiempoMs, motivo: r.respuesta.motivo },
    { correcta: false, tiempoMs: null, motivo: 'fuera_de_tiempo' })
  assert.strictEqual(r.partida.estado, ESTADOS_PARTIDA.lista) // avanza: no hay segunda oportunidad
})

caso('E · pregunta sin respuesta = incorrecta (vencida por el servidor)', () => {
  const { partida } = ok(girar(partidaNueva(5), T0))
  const antes = ok(vencerPregunta(partida, T0 + T))
  assert.strictEqual(antes.vencida, false) // a los 15 s exactos todavía se puede responder
  assert.strictEqual(antes.partida, partida)
  const v = ok(vencerPregunta(partida, T0 + T + 1))
  assert.strictEqual(v.vencida, true)
  assert.deepStrictEqual({ opcion: v.respuesta.opcion, correcta: v.respuesta.correcta, tiempoMs: v.respuesta.tiempoMs, motivo: v.respuesta.motivo },
    { opcion: null, correcta: false, tiempoMs: null, motivo: 'sin_respuesta' })
  // La respuesta que llega tarde después de vencer ya no cuenta.
  assert.strictEqual(responder(v.partida, { indice: 0, opcion: 0, ahoraMs: T0 + T + 2, correcta: 0 }).codigo, 'sin_pregunta_abierta')
  // Vencer sin pregunta abierta no hace nada.
  const lista = partidaNueva(5)
  assert.strictEqual(ok(vencerPregunta(lista, T0)).vencida, false)
})

caso('E · partida entera sin responder = 0 en todas', () => {
  const p = jugar(5, Array(5).fill({ vence: true }))
  const r = resumenPartida(p)
  assert.deepStrictEqual({ correctas: r.correctas, sinRespuesta: r.sinRespuesta, calificacion: r.calificacion, tiempo: r.tiempoCorrectasMs },
    { correctas: 0, sinRespuesta: 5, calificacion: 0, tiempo: 0 })
})

caso('E · margen opcional: amplía el límite pero el tiempo registrado nunca pasa de 15 s', () => {
  const { partida } = ok(girar(partidaNueva(5), T0))
  const r = ok(responder(partida, { indice: 0, opcion: 1, ahoraMs: T0 + T + 800, correcta: 1 }, { margenMs: 1000 })).respuesta
  assert.strictEqual(r.correcta, true)
  assert.strictEqual(r.tiempoMs, T)
  assert.strictEqual(ok(vencerPregunta(partida, T0 + T + 800, { margenMs: 1000 })).vencida, false)
})

caso('E · tiempo restante para el contador', () => {
  const { partida } = ok(girar(partidaNueva(5), T0))
  assert.strictEqual(tiempoRestanteMs(partida, T0), T)
  assert.strictEqual(tiempoRestanteMs(partida, T0 + 10_000), 5000)
  assert.strictEqual(tiempoRestanteMs(partida, T0 + 99_000), 0)
  assert.strictEqual(tiempoRestanteMs(partidaNueva(5), T0), null)
})

// ── F. Calificación ──────────────────────────────────────────────────────────
grupo('F · calificación sobre 10')

caso('F · 5 preguntas: 5 aciertos = 10', () => assert.strictEqual(resumenPartida(jugar(5, aciertos(5, 5))).calificacion, 10))
caso('F · 5 preguntas: 4 aciertos = 8', () => assert.strictEqual(resumenPartida(jugar(5, aciertos(5, 4))).calificacion, 8))
caso('F · 10 preguntas: 8 aciertos = 8', () => assert.strictEqual(resumenPartida(jugar(10, aciertos(10, 8))).calificacion, 8))
caso('F · 10 preguntas: 7 aciertos = 7', () => assert.strictEqual(resumenPartida(jugar(10, aciertos(10, 7))).calificacion, 7))

caso('F · tabla completa: (correctas ÷ total) × 10 para 5 y 10; 20 preguntas ya no se califican', () => {
  for (const n of [5, 10]) {
    for (let k = 0; k <= n; k++) assert.strictEqual(calificacionRuleta(k, n), Math.round((k / n) * 100) / 10, `${k}/${n}`)
  }
  assert.throws(() => calificacionRuleta(18, 20), RangeError)
  assert.strictEqual(calificacionRuleta(3, 5), 6)
})

caso('F · el tiempo no aumenta la calificación: rápido y lento con los mismos aciertos sacan lo mismo', () => {
  const rapido = resumenPartida(jugar(10, aciertos(10, 7, 500)))
  const lento = resumenPartida(jugar(10, aciertos(10, 7, 14_900)))
  assert.strictEqual(rapido.calificacion, lento.calificacion)
  assert.ok(rapido.tiempoCorrectasMs < lento.tiempoCorrectasMs)
  // Y un acierto lento vale más que un error rápido.
  assert.ok(resumenPartida(jugar(5, aciertos(5, 3, 14_000))).calificacion > resumenPartida(jugar(5, aciertos(5, 2, 100))).calificacion)
})

caso('F · las preguntas no jugadas cuentan como incorrectas (se divide entre el total autorizado)', () => {
  let p = partidaNueva(5)
  let g = ok(girar(p, T0))
  p = ok(responder(g.partida, { indice: 0, opcion: claveDe(g.reactivoId), ahoraMs: T0 + 1000, correcta: claveDe(g.reactivoId) })).partida
  const r = resumenPartida(p)
  assert.deepStrictEqual({ jugadas: r.jugadas, correctas: r.correctas, terminada: r.terminada, calificacion: r.calificacion },
    { jugadas: 1, correctas: 1, terminada: false, calificacion: 2 })
})

caso('F · rechaza datos inválidos', () => {
  assert.throws(() => calificacionRuleta(6, 5), RangeError)
  assert.throws(() => calificacionRuleta(-1, 5), RangeError)
  assert.throws(() => calificacionRuleta(2.5, 5), RangeError)
  assert.throws(() => calificacionRuleta(3, 7), RangeError)
  assert.throws(() => calificacionRuleta(3, 0), RangeError)
})

// ── G. Ranking ───────────────────────────────────────────────────────────────
grupo('G · ranking y desempate')

const res = (id, correctas, tiempoCorrectasMs) => ({ id, correctas, tiempoCorrectasMs })

caso('G · más correctas va primero, aunque sea más lento', () => {
  const c = clasificarResultados([res('rapido', 6, 1000), res('lento', 7, 90_000)])
  assert.deepStrictEqual(c.map((r) => [r.id, r.puesto]), [['lento', 1], ['rapido', 2]])
})

caso('G · a iguales correctas, gana el menor tiempo acumulado en correctas', () => {
  const c = clasificarResultados([res('b', 8, 40_000), res('a', 8, 39_999), res('c', 8, 50_000)])
  assert.deepStrictEqual(c.map((r) => [r.id, r.puesto]), [['a', 1], ['b', 2], ['c', 3]])
})

caso('G · el tiempo de respuestas incorrectas o vencidas no cuenta para desempatar', () => {
  // Los dos aciertan las mismas 2 en 2 s cada una; uno tarda mucho en las que falla y el otro vence 3.
  const plan1 = [{ acierta: true, ms: 2000 }, { acierta: true, ms: 2000 }, { acierta: false, ms: 14_000 }, { acierta: false, ms: 14_000 }, { acierta: false, ms: 14_000 }]
  const plan2 = [{ acierta: true, ms: 2000 }, { acierta: true, ms: 2000 }, { vence: true }, { vence: true }, { vence: true }]
  const a = resumenPartida(jugar(5, plan1))
  const b = resumenPartida(jugar(5, plan2))
  assert.strictEqual(a.tiempoCorrectasMs, 4000)
  assert.strictEqual(b.tiempoCorrectasMs, 4000)
  const c = clasificarResultados([{ id: 'a', ...a }, { id: 'b', ...b }])
  assert.deepStrictEqual(c.map((r) => r.puesto), [1, 1])
})

caso('G · empate exacto: comparten puesto y el siguiente salta (1, 1, 3), siempre en el mismo orden', () => {
  const entrada = [res('zoe', 5, 20_000), res('ana', 5, 20_000), res('luis', 4, 1000), res('eva', 5, 10_000)]
  const c = clasificarResultados(entrada)
  assert.deepStrictEqual(c.map((r) => [r.id, r.puesto, r.empatado]), [['eva', 1, false], ['ana', 2, true], ['zoe', 2, true], ['luis', 4, false]])
  // Cualquier orden de entrada da exactamente la misma clasificación.
  const permutaciones = [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]]
  for (const orden of permutaciones) assert.deepStrictEqual(clasificarResultados(orden.map((i) => entrada[i])), c)
  // Tres empatados en primero.
  assert.deepStrictEqual(clasificarResultados([res('a', 3, 9), res('b', 3, 9), res('c', 3, 9), res('d', 1, 0)]).map((r) => r.puesto), [1, 1, 1, 4])
})

caso('G · compararResultados es antisimétrica y 0 solo para el mismo id', () => {
  const a = res('a', 5, 1000)
  const b = res('b', 5, 1000)
  assert.ok(compararResultados(a, b) < 0)
  assert.ok(compararResultados(b, a) > 0)
  assert.strictEqual(compararResultados(a, { ...a }), 0)
})

caso('G · no modifica la lista recibida', () => {
  const entrada = [res('b', 1, 5), res('a', 2, 5)]
  const copia = JSON.parse(JSON.stringify(entrada))
  clasificarResultados(entrada)
  assert.deepStrictEqual(entrada, copia)
})

caso('G · rechaza datos inválidos', () => {
  assert.throws(() => clasificarResultados('x'), TypeError)
  assert.throws(() => clasificarResultados([res('a', 1, 0), res('a', 2, 0)]), RangeError)
  assert.throws(() => clasificarResultados([res('', 1, 0)]), TypeError)
  assert.throws(() => clasificarResultados([res('a', -1, 0)]), RangeError)
  assert.throws(() => clasificarResultados([res('a', 1, -5)]), RangeError)
  assert.throws(() => clasificarResultados([res('a', 1.5, 0)]), RangeError)
  assert.throws(() => clasificarResultados([{ id: 'a', correctas: 1 }]), RangeError)
  assert.deepStrictEqual(clasificarResultados([]), [])
})

caso('G · de punta a punta: partidas reales → resumen → ranking', () => {
  const jugadores = [
    { id: 'p1', plan: aciertos(10, 9, 3000) }, // 9 correctas, 27 s
    { id: 'p2', plan: aciertos(10, 9, 2000) }, // 9 correctas, 18 s
    { id: 'p3', plan: aciertos(10, 10, 14_000) }, // 10 correctas, 140 s
    { id: 'p4', plan: aciertos(10, 9, 2000) }, // empata exacto con p2
  ]
  const resultados = jugadores.map((j, i) => ({ id: j.id, ...resumenPartida(jugar(10, j.plan, i + 1)) }))
  const c = clasificarResultados(resultados)
  assert.deepStrictEqual(c.map((r) => [r.id, r.puesto, r.calificacion]), [['p3', 1, 10], ['p2', 2, 9], ['p4', 2, 9], ['p1', 4, 9]])
})

// ══ Fase 2: actividad y banco ═════════════════════════════════════════════════
// (import en el nivel superior del módulo; se agrupa aquí con las pruebas que lo usan)
import {
  maximoBanco, datosNuevaRuleta, avanceBanco, normalizarReactivo, bancoVacio, guardarEnBanco, quitarDeBanco,
  evaluarAprobacion, puedeCambiarPreguntas, MOTIVOS_REACTIVO,
  reactivosGeneracionIA, minimoBanco, origenBanco, ORIGENES_BANCO,
} from '../src/utils/ruletaDestino.js'

grupo('H · fase 2: límites del banco')

caso('H · banco manual: mínimos 50/100 y máximos 100/200 (10 por pregunta, máximo el doble); 20 lanza RangeError', () => {
  assert.deepStrictEqual([5, 10].map(tamanoBanco), [50, 100])
  assert.deepStrictEqual([5, 10].map(maximoBanco), [100, 200])
  assert.strictEqual(RULETA_CFG.REACTIVOS_MAXIMOS_POR_PREGUNTA, 20)
  assert.throws(() => maximoBanco(20), RangeError)
  assert.throws(() => maximoBanco(7), RangeError)
})

caso('H · 20 preguntas se rechazan en todas las entradas: banco, sorteo, partida, alta del banco y avance', () => {
  assert.deepStrictEqual(validarBanco(banco(200), 20).errores, ['preguntas_por_partida'])
  assert.throws(() => sortearPreguntas(idsBanco(200), 20, generadorDeterminista(1)), RangeError)
  assert.strictEqual(crearPartida({ orden: idsBanco(20), preguntasPorPartida: 20 }).codigo, 'preguntas_por_partida')
  assert.strictEqual(guardarEnBanco(bancoVacio(), { id: 'a', huella: 'h', nuevo: true }, 20).codigo, 'preguntas_por_partida')
  assert.throws(() => avanceBanco(0, 20), RangeError)
})

caso('H · validarBanco: debajo del mínimo, exacto, entre mínimo y máximo, en el máximo y sobre el máximo', () => {
  for (const [n, tam, ok, error] of [
    [5, 0, false, 'banco_incompleto'], [5, 49, false, 'banco_incompleto'], [5, 50, true], [5, 77, true], [5, 100, true], [5, 101, false, 'banco_excedido'],
    [10, 0, false, 'banco_incompleto'], [10, 99, false, 'banco_incompleto'], [10, 100, true], [10, 150, true], [10, 200, true], [10, 201, false, 'banco_excedido'],
  ]) {
    const v = validarBanco(banco(tam), n)
    assert.strictEqual(v.ok, ok, `${n}/${tam}`)
    assert.deepStrictEqual(v.errores, ok ? [] : [error], `${n}/${tam}`)
  }
})

caso('H · reactivo: textos demasiado largos se rechazan; el límite exacto se acepta', () => {
  const largo = (k) => 'x'.repeat(k)
  assert.ok(validarReactivo(reactivo(1, { enunciado: largo(RULETA_CFG.MAX_ENUNCIADO) })).ok)
  assert.deepStrictEqual(validarReactivo(reactivo(1, { enunciado: largo(RULETA_CFG.MAX_ENUNCIADO + 1) })).errores, ['enunciado_largo'])
  assert.ok(validarReactivo(reactivo(1, { opciones: [largo(RULETA_CFG.MAX_OPCION), 'b', 'c', 'd'] })).ok)
  assert.deepStrictEqual(validarReactivo(reactivo(1, { opciones: [largo(RULETA_CFG.MAX_OPCION + 1), 'b', 'c', 'd'] })).errores, ['opcion_larga'])
  for (const codigo of ['enunciado', 'enunciado_largo', 'opciones_cantidad', 'opcion_vacia', 'opcion_larga', 'opciones_repetidas', 'correcta']) {
    assert.ok(MOTIVOS_REACTIVO[codigo], `sin mensaje para ${codigo}`)
  }
})

caso('H · normalizar un reactivo: quita espacios de más sin cambiar el contenido', () => {
  assert.deepStrictEqual(normalizarReactivo({ enunciado: '  ¿Qué  es?  ', opciones: [' A ', 'B  b', 'C', 'D'], correcta: 2, extra: 1 }),
    { enunciado: '¿Qué es?', opciones: ['A', 'B b', 'C', 'D'], correcta: 2 })
})

grupo('I · fase 2: alta de la actividad')

const altaBase = { nombre: 'Ruleta del parcial', tema: 'La célula', modalidad: 'vivo', acceso: 'interno', preguntasPorPartida: 10, ranking: true, parcial: 1, orden: 3, asignaturaId: 'S1', docenteId: 'D1' }

caso('I · las cuatro combinaciones de modalidad y acceso nacen ocultas y bien formadas', () => {
  for (const modalidad of ['vivo', 'individual']) {
    for (const acceso of ['interno', 'externo']) {
      const r = datosNuevaRuleta({ ...altaBase, modalidad, acceso })
      assert.ok(r.ok, `${modalidad}/${acceso}: ${r.codigo}`)
      const d = r.datos
      assert.strictEqual(d.categoria, 'ruleta')
      assert.strictEqual(d.oculta, true)
      assert.strictEqual(d.publishAt, null)
      assert.strictEqual(d.publishedAt, null)
      assert.strictEqual(d.sinCalificacion, acceso === 'externo')
      assert.strictEqual(d.tema, 'La célula')
      assert.ok(!('tema' in d.ruleta))
      assert.deepStrictEqual(Object.keys(d.ruleta).sort(), modalidad === 'vivo' ? ['acceso', 'modalidad', 'preguntasPorPartida', 'ranking'] : ['acceso', 'modalidad', 'preguntasPorPartida'])
      assert.ok(!('preguntasCongeladas' in d.ruleta))
    }
  }
})

caso('I · el ranking solo existe en vivo (y siempre booleano)', () => {
  assert.strictEqual(datosNuevaRuleta({ ...altaBase, ranking: true }).datos.ruleta.ranking, true)
  assert.strictEqual(datosNuevaRuleta({ ...altaBase, ranking: 'si' }).datos.ruleta.ranking, false)
  assert.ok(!('ranking' in datosNuevaRuleta({ ...altaBase, modalidad: 'individual', ranking: true }).datos.ruleta))
})

caso('I · datos inválidos se rechazan con un mensaje para el docente', () => {
  for (const [cambio, codigo] of [
    [{ nombre: '  ' }, 'nombre'], [{ nombre: 'x'.repeat(RULETA_CFG.MAX_NOMBRE + 1) }, 'nombre_largo'],
    [{ tema: '' }, 'tema'], [{ tema: 'x'.repeat(RULETA_CFG.MAX_TEMA + 1) }, 'tema_largo'],
    [{ modalidad: 'equipos' }, 'modalidad'], [{ acceso: 'publico' }, 'acceso'],
    [{ preguntasPorPartida: 6 }, 'preguntas'], [{ preguntasPorPartida: '10' }, 'preguntas'], [{ preguntasPorPartida: 20 }, 'preguntas'],
    [{ asignaturaId: '' }, 'asignatura'], [{ parcial: 0 }, 'parcial'],
  ]) {
    const r = datosNuevaRuleta({ ...altaBase, ...cambio })
    assert.strictEqual(r.ok, false, JSON.stringify(cambio))
    assert.strictEqual(r.codigo, codigo)
    assert.ok(r.error)
  }
  assert.strictEqual(datosNuevaRuleta({ ...altaBase, preguntasPorPartida: 20 }).error, 'Elige 5 o 10 preguntas por partida.')
  for (const n of [5, 10]) assert.strictEqual(datosNuevaRuleta({ ...altaBase, preguntasPorPartida: n }).datos.ruleta.preguntasPorPartida, n)
})

grupo('J · fase 2: avance del banco')

caso('J · «32 de 50 reactivos. Faltan 18.», completo, en el máximo y sobre el máximo (banco manual)', () => {
  const a = avanceBanco(32, 5)
  assert.deepStrictEqual([a.conteo, a.mensaje, a.faltan, a.completo, a.lleno], ['32 de 50 reactivos.', 'Faltan 18.', 18, false, false])
  const b = avanceBanco(50, 5)
  assert.deepStrictEqual([b.conteo, b.mensaje, b.completo], ['50 de 50 reactivos.', 'Banco completo. Puedes aprobarlo.', true])
  const c = avanceBanco(100, 5)
  assert.deepStrictEqual([c.completo, c.lleno, c.sobran], [true, true, 0])
  const d = avanceBanco(103, 5)
  assert.deepStrictEqual([d.completo, d.sobran, d.mensaje], [false, 3, 'Pasaste el máximo de 100: quita 3.'])
  assert.strictEqual(avanceBanco(0, 10).mensaje, 'Faltan 100.')
  assert.deepStrictEqual([avanceBanco(200, 10).completo, avanceBanco(200, 10).lleno, avanceBanco(201, 10).sobran], [true, true, 1])
  assert.throws(() => avanceBanco(-1, 5), RangeError)
  assert.throws(() => avanceBanco(5, 6), RangeError)
})

grupo('K · fase 2: estado del banco (guardar, borrar, aprobar)')

caso('K · guardar nuevos suma, registra la huella y retira la aprobación', () => {
  let b = { ...bancoVacio(), aprobado: true }
  const r1 = guardarEnBanco(b, { id: 'a', huella: 'h1', nuevo: true }, 5)
  assert.ok(r1.ok)
  b = r1.banco
  assert.deepStrictEqual([b.total, b.huellas, b.aprobado, b.version], [1, { h1: 'a' }, false, 1])
  const r2 = guardarEnBanco(b, { id: 'b', huella: 'h2', nuevo: true }, 5)
  assert.deepStrictEqual([r2.banco.total, r2.banco.huellas], [2, { h1: 'a', h2: 'b' }])
  assert.deepStrictEqual(b.huellas, { h1: 'a' }) // no modifica el anterior
})

caso('K · un enunciado repetido se rechaza (nuevo o al editar otro), el mismo reactivo puede volver a guardarse', () => {
  const b = { total: 2, huellas: { h1: 'a', h2: 'b' }, aprobado: false, version: 2 }
  assert.strictEqual(guardarEnBanco(b, { id: 'c', huella: 'h1', nuevo: true }, 5).codigo, 'duplicado')
  assert.strictEqual(guardarEnBanco(b, { id: 'b', huella: 'h1', huellaAnterior: 'h2', nuevo: false }, 5).codigo, 'duplicado')
  const mismo = guardarEnBanco(b, { id: 'a', huella: 'h1', huellaAnterior: 'h1', nuevo: false }, 5)
  assert.ok(mismo.ok)
  assert.deepStrictEqual([mismo.banco.total, mismo.banco.huellas], [2, { h1: 'a', h2: 'b' }])
})

caso('K · editar el enunciado cambia la huella sin cambiar el total', () => {
  const b = { total: 2, huellas: { h1: 'a', h2: 'b' }, aprobado: true, version: 2 }
  const r = guardarEnBanco(b, { id: 'a', huella: 'h9', huellaAnterior: 'h1', nuevo: false }, 5)
  assert.deepStrictEqual([r.banco.total, r.banco.huellas, r.banco.aprobado], [2, { h2: 'b', h9: 'a' }, false])
})

caso('K · con el banco lleno (el doble del mínimo) no entra uno nuevo; editar sí', () => {
  const huellas = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`h${i}`, `r${i}`]))
  const lleno = { total: 100, huellas, aprobado: false, version: 100 }
  assert.strictEqual(guardarEnBanco(lleno, { id: 'nuevo', huella: 'hx', nuevo: true }, 5).codigo, 'banco_lleno')
  assert.ok(guardarEnBanco(lleno, { id: 'r3', huella: 'hz', huellaAnterior: 'h3', nuevo: false }, 5).ok)
  assert.ok(guardarEnBanco(lleno, { id: 'nuevo', huella: 'hx', nuevo: true }, 10).ok) // con 10 preguntas el máximo es 200
  const lleno10 = { total: 200, huellas: { ...huellas }, aprobado: false, version: 200 }
  assert.strictEqual(guardarEnBanco(lleno10, { id: 'nuevo', huella: 'hx', nuevo: true }, 10).codigo, 'banco_lleno')
})

caso('K · borrar resta, libera la huella y retira la aprobación; nunca baja de cero', () => {
  const b = { total: 2, huellas: { h1: 'a', h2: 'b' }, aprobado: true, version: 2 }
  const r = quitarDeBanco(b, { id: 'a', huella: 'h1' })
  assert.deepStrictEqual([r.banco.total, r.banco.huellas, r.banco.aprobado, r.banco.version], [1, { h2: 'b' }, false, 3])
  assert.strictEqual(quitarDeBanco({ ...bancoVacio() }, { id: 'a', huella: 'h1' }).banco.total, 0)
  // Una huella que apunta a OTRO reactivo no se toca.
  assert.deepStrictEqual(quitarDeBanco(b, { id: 'a', huella: 'h2' }).banco.huellas, { h1: 'a', h2: 'b' })
})

caso('K · aprobar: solo con el banco completo, válido, sin duplicados y coherente con su estado', () => {
  const completo = banco(50)
  const estado = { total: 50, huellas: {}, aprobado: false, version: 50 }
  const ok = evaluarAprobacion(estado, completo, 5)
  assert.ok(ok.ok)
  assert.strictEqual(ok.banco.aprobado, true)
  assert.strictEqual(evaluarAprobacion({ ...estado, total: 49 }, banco(49), 5).codigo, 'banco_incompleto')
  assert.strictEqual(evaluarAprobacion({ ...estado, total: 101 }, banco(101), 5).codigo, 'banco_excedido')
  assert.ok(evaluarAprobacion({ ...estado, total: 100 }, banco(100), 5).ok)
  assert.ok(evaluarAprobacion({ ...estado, total: 100 }, banco(100), 10).ok)
  assert.strictEqual(evaluarAprobacion({ ...estado, total: 99 }, banco(99), 10).codigo, 'banco_incompleto')
  assert.ok(evaluarAprobacion({ ...estado, total: 200 }, banco(200), 10).ok)
  assert.strictEqual(evaluarAprobacion({ ...estado, total: 201 }, banco(201), 10).codigo, 'banco_excedido')
  const dup = banco(50)
  dup[9] = reactivo(9, { enunciado: dup[3].enunciado })
  assert.strictEqual(evaluarAprobacion(estado, dup, 5).codigo, 'banco_con_errores')
  const malo = banco(50)
  malo[2] = reactivo(2, { opciones: ['a', 'a', 'b', 'c'] })
  assert.strictEqual(evaluarAprobacion(estado, malo, 5).codigo, 'banco_con_errores')
  assert.strictEqual(evaluarAprobacion({ ...estado, total: 51 }, completo, 5).codigo, 'banco_desfasado')
  assert.strictEqual(evaluarAprobacion(null, completo, 5).codigo, 'banco_invalido')
})

caso('K · aprobar y perder la aprobación: cualquier cambio posterior la retira', () => {
  let b = evaluarAprobacion({ total: 50, huellas: { h0: 'r0' }, aprobado: false, version: 50 }, banco(50), 5).banco
  assert.strictEqual(b.aprobado, true)
  b = guardarEnBanco(b, { id: 'r0', huella: 'h0', huellaAnterior: 'h0', nuevo: false }, 5).banco
  assert.strictEqual(b.aprobado, false)
  b = { ...b, aprobado: true }
  b = quitarDeBanco(b, { id: 'r0', huella: 'h0' }).banco
  assert.strictEqual(b.aprobado, false)
})

caso('K · datos inválidos en las transiciones se rechazan', () => {
  assert.strictEqual(guardarEnBanco(null, { id: 'a', huella: 'h', nuevo: true }, 5).codigo, 'banco_invalido')
  assert.strictEqual(guardarEnBanco(bancoVacio(), { id: '', huella: 'h', nuevo: true }, 5).codigo, 'datos_invalidos')
  assert.strictEqual(guardarEnBanco(bancoVacio(), { id: 'a', huella: '', nuevo: true }, 5).codigo, 'datos_invalidos')
  assert.strictEqual(guardarEnBanco(bancoVacio(), { id: 'a', huella: 'h', nuevo: true }, 7).codigo, 'preguntas_por_partida')
  assert.strictEqual(guardarEnBanco({ total: -1, huellas: {} }, { id: 'a', huella: 'h', nuevo: true }, 5).codigo, 'banco_invalido')
  assert.strictEqual(quitarDeBanco(bancoVacio(), { id: '' }).codigo, 'datos_invalidos')
})

grupo('L · fase 2: cambiar preguntas por partida (R6, F2-6)')

caso('L · solo sin sesiones, a 5 o 10, distinto del actual y con el banco entre el nuevo mínimo y máximo', () => {
  const ruleta = { modalidad: 'vivo', acceso: 'interno', preguntasPorPartida: 5 }
  const diez = { ...ruleta, preguntasPorPartida: 10 }
  assert.deepStrictEqual(puedeCambiarPreguntas({ ruleta, total: 100, nuevo: 10 }), { ok: true })
  assert.deepStrictEqual(puedeCambiarPreguntas({ ruleta: diez, total: 100, nuevo: 5 }), { ok: true })
  assert.deepStrictEqual(puedeCambiarPreguntas({ ruleta: diez, total: 50, nuevo: 5 }), { ok: true })
  assert.strictEqual(puedeCambiarPreguntas({ ruleta, total: 99, nuevo: 10 }).codigo, 'banco_incompleto')
  assert.strictEqual(puedeCambiarPreguntas({ ruleta: diez, total: 49, nuevo: 5 }).codigo, 'banco_incompleto')
  assert.strictEqual(puedeCambiarPreguntas({ ruleta: diez, total: 101, nuevo: 5 }).codigo, 'banco_excedido')
  assert.strictEqual(puedeCambiarPreguntas({ ruleta: { ...ruleta, preguntasCongeladas: true }, total: 100, nuevo: 10 }).codigo, 'congeladas')
  assert.strictEqual(puedeCambiarPreguntas({ ruleta, total: 100, nuevo: 7 }).codigo, 'preguntas_por_partida')
  assert.strictEqual(puedeCambiarPreguntas({ ruleta, total: 100, nuevo: 20 }).codigo, 'preguntas_por_partida')
  assert.strictEqual(puedeCambiarPreguntas({ ruleta, total: 100, nuevo: 5 }).codigo, 'sin_cambio')
  assert.strictEqual(puedeCambiarPreguntas({ ruleta: null, total: 100, nuevo: 10 }).codigo, 'actividad_invalida')
  // Con un banco de origen IA, el mínimo del nuevo tamaño es el de IA (25 o 50); el máximo, el mismo.
  assert.deepStrictEqual(puedeCambiarPreguntas({ ruleta, total: 50, nuevo: 10, origen: 'ia' }), { ok: true })
  assert.strictEqual(puedeCambiarPreguntas({ ruleta, total: 49, nuevo: 10, origen: 'ia' }).codigo, 'banco_incompleto')
  assert.deepStrictEqual(puedeCambiarPreguntas({ ruleta: diez, total: 25, nuevo: 5, origen: 'ia' }), { ok: true })
  assert.strictEqual(puedeCambiarPreguntas({ ruleta: diez, total: 101, nuevo: 5, origen: 'ia' }).codigo, 'banco_excedido')
})

// ══ Generación con IA y origen del banco (7-nov-2026) ═════════════════════════
grupo('M · generación con IA separada del banco manual; mínimo según el origen')

caso('M · la IA genera EXACTAMENTE 25 (5 preguntas) o 50 (10); 20 y otros tamaños lanzan RangeError', () => {
  assert.strictEqual(RULETA_CFG.REACTIVOS_IA_POR_PREGUNTA, 5)
  assert.strictEqual(reactivosGeneracionIA(5), 25)
  assert.strictEqual(reactivosGeneracionIA(10), 50)
  for (const n of [20, 7, 0, '5', null, undefined]) assert.throws(() => reactivosGeneracionIA(n), RangeError, String(n))
})

caso('M · matriz completa: generación IA, mínimo y máximo manual, mínimo de un banco IA, y las dos cantidades nunca coinciden', () => {
  const matriz = [5, 10].map((n) => [n, reactivosGeneracionIA(n), tamanoBanco(n), maximoBanco(n), minimoBanco(n, 'ia'), minimoBanco(n, 'manual'), minimoBanco(n)])
  assert.deepStrictEqual(matriz, [[5, 25, 50, 100, 25, 50, 50], [10, 50, 100, 200, 50, 100, 100]])
  for (const n of [5, 10]) assert.notStrictEqual(reactivosGeneracionIA(n), tamanoBanco(n))
  assert.throws(() => minimoBanco(20, 'ia'), RangeError)
  assert.throws(() => minimoBanco(20, 'manual'), RangeError)
})

caso('M · origen: solo el valor exacto «ia» es IA; ausente, «IA», «manual» o basura = manual; un banco nuevo nace manual', () => {
  assert.deepStrictEqual(ORIGENES_BANCO, { manual: 'manual', ia: 'ia' })
  assert.strictEqual(origenBanco({ origen: 'ia' }), 'ia')
  for (const b of [{}, { origen: 'manual' }, { origen: 'IA' }, { origen: ' ia' }, { origen: true }, null, undefined]) assert.strictEqual(origenBanco(b), 'manual', JSON.stringify(b))
  assert.strictEqual(bancoVacio().origen, 'manual')
  assert.strictEqual(minimoBanco(5, 'IA'), 50) // un origen mal escrito nunca baja el mínimo
})

caso('M · validarBanco con origen IA: 5 → 24 ✗, 25 ✓, 100 ✓, 101 ✗; 10 → 49 ✗, 50 ✓, 200 ✓, 201 ✗', () => {
  for (const [n, tam, ok, error] of [
    [5, 24, false, 'banco_incompleto'], [5, 25, true], [5, 100, true], [5, 101, false, 'banco_excedido'],
    [10, 49, false, 'banco_incompleto'], [10, 50, true], [10, 200, true], [10, 201, false, 'banco_excedido'],
  ]) {
    const v = validarBanco(banco(tam), n, { origen: 'ia' })
    assert.strictEqual(v.ok, ok, `${n}/${tam}`)
    assert.deepStrictEqual(v.errores, ok ? [] : [error], `${n}/${tam}`)
    assert.strictEqual(v.requerido, reactivosGeneracionIA(n))
  }
})

caso('M · aprobar según el origen: IA 25/5 ✓, 50/10 ✓, 24/5 ✗, 49/10 ✗; manual 49/5 ✗, 50/5 ✓, 99/10 ✗, 100/10 ✓; ninguno pasa su máximo', () => {
  const estado = (origen, total) => ({ total, huellas: {}, aprobado: false, version: total, ...(origen ? { origen } : {}) })
  const aprobar = (origen, total, n) => evaluarAprobacion(estado(origen, total), banco(total), n)
  assert.ok(aprobar('ia', 25, 5).ok)
  assert.ok(aprobar('ia', 50, 10).ok)
  assert.strictEqual(aprobar('ia', 24, 5).codigo, 'banco_incompleto')
  assert.strictEqual(aprobar('ia', 49, 10).codigo, 'banco_incompleto')
  assert.strictEqual(aprobar('manual', 49, 5).codigo, 'banco_incompleto')
  assert.ok(aprobar('manual', 50, 5).ok)
  assert.strictEqual(aprobar('manual', 99, 10).codigo, 'banco_incompleto')
  assert.ok(aprobar('manual', 100, 10).ok)
  assert.strictEqual(aprobar(null, 25, 5).codigo, 'banco_incompleto') // sin origen guardado = manual
  for (const origen of ['ia', 'manual']) {
    assert.strictEqual(aprobar(origen, 101, 5).codigo, 'banco_excedido', origen)
    assert.strictEqual(aprobar(origen, 201, 10).codigo, 'banco_excedido', origen)
  }
  assert.strictEqual(aprobar('ia', 25, 5).banco.origen, 'ia') // aprobar conserva el origen
})

caso('M · editar, agregar o borrar en un banco IA conserva el origen; borrar por debajo de 25 impide aprobar', () => {
  const huellas = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`h${i}`, `r${i}`]))
  let b = { total: 25, huellas, aprobado: true, version: 25, origen: 'ia' }
  b = guardarEnBanco(b, { id: 'r3', huella: 'h3b', huellaAnterior: 'h3', nuevo: false }, 5).banco // editar
  assert.deepStrictEqual([b.origen, b.total, b.aprobado], ['ia', 25, false])
  b = guardarEnBanco(b, { id: 'r99', huella: 'h99', nuevo: true }, 5).banco // agregar a mano
  assert.deepStrictEqual([b.origen, b.total], ['ia', 26])
  b = quitarDeBanco(b, { id: 'r99', huella: 'h99' }).banco
  b = quitarDeBanco(b, { id: 'r0', huella: 'h0' }).banco // queda en 24
  assert.deepStrictEqual([b.origen, b.total], ['ia', 24])
  const reactivos = banco(25).slice(1)
  assert.strictEqual(evaluarAprobacion(b, reactivos, 5).codigo, 'banco_incompleto')
  assert.strictEqual(avanceBanco(24, 5, 'ia').faltan, 1)
  assert.deepStrictEqual([avanceBanco(25, 5, 'ia').completo, avanceBanco(25, 5).completo], [true, false])
})

grupo('N · banco vaciado: el origen vuelve a manual SOLO al llegar a 0')

const estadoIA = (total, origen = 'ia') => ({
  total, huellas: Object.fromEntries(Array.from({ length: total }, (_, i) => [`h${i}`, `r${i}`])), aprobado: true, version: total, origen,
})

caso('N · IA 25 → borrar uno → 24 y sigue «ia»', () => {
  const b = quitarDeBanco(estadoIA(25), { id: 'r0', huella: 'h0' }).banco
  assert.deepStrictEqual([b.total, b.origen, b.aprobado], [24, 'ia', false])
})

caso('N · IA 2 → borrar uno → 1 y sigue «ia»', () => {
  const b = quitarDeBanco(estadoIA(2), { id: 'r0', huella: 'h0' }).banco
  assert.deepStrictEqual([b.total, b.origen], [1, 'ia'])
})

caso('N · IA 1 → borrar el último → 0 y pasa a «manual» (sin huellas, sin aprobar)', () => {
  const b = quitarDeBanco(estadoIA(1), { id: 'r0', huella: 'h0' }).banco
  assert.deepStrictEqual([b.total, b.origen, b.aprobado, b.huellas], [0, 'manual', false, {}])
  assert.strictEqual(origenBanco(b), 'manual')
})

caso('N · banco manual que llega a 0 sigue «manual»; uno sin origen guardado también queda «manual»', () => {
  assert.strictEqual(quitarDeBanco(estadoIA(1, 'manual'), { id: 'r0', huella: 'h0' }).banco.origen, 'manual')
  const { origen: _sinOrigen, ...viejo } = estadoIA(1)
  assert.strictEqual(quitarDeBanco(viejo, { id: 'r0', huella: 'h0' }).banco.origen, 'manual')
})

caso('N · solo cambia en 0: de 24 a 1, cada borrado conserva «ia»; el siguiente lo deja en «manual»', () => {
  let b = estadoIA(24)
  for (let i = 0; i < 23; i++) {
    b = quitarDeBanco(b, { id: `r${i}`, huella: `h${i}` }).banco
    assert.strictEqual(b.origen, 'ia', `quedan ${b.total}`)
  }
  assert.strictEqual(b.total, 1)
  b = quitarDeBanco(b, { id: 'r23', huella: 'h23' }).banco
  assert.deepStrictEqual([b.total, b.origen], [0, 'manual'])
})

caso('N · vaciado y recapturado a mano: 25 en una de 5 y 50 en una de 10 NO se aprueban; 50 y 100 sí', () => {
  for (const [n, minIA, minManual] of [[5, 25, 50], [10, 50, 100]]) {
    let b = quitarDeBanco(estadoIA(1), { id: 'r0', huella: 'h0' }).banco
    for (let i = 0; i < minIA; i++) b = guardarEnBanco(b, { id: `n${i}`, huella: `hn${i}`, nuevo: true }, n).banco
    assert.deepStrictEqual([b.total, b.origen], [minIA, 'manual'], `n=${n}`)
    assert.strictEqual(evaluarAprobacion(b, banco(minIA), n).codigo, 'banco_incompleto', `n=${n}`)
    assert.strictEqual(avanceBanco(b.total, n, origenBanco(b)).minimo, minManual)
    for (let i = minIA; i < minManual; i++) b = guardarEnBanco(b, { id: `n${i}`, huella: `hn${i}`, nuevo: true }, n).banco
    assert.ok(evaluarAprobacion(b, banco(minManual), n).ok, `n=${n}`)
  }
})

caso('N · el banco vacío nunca se aprueba (manual ni IA)', () => {
  const vacio = quitarDeBanco(estadoIA(1), { id: 'r0', huella: 'h0' }).banco
  for (const n of [5, 10]) {
    assert.strictEqual(evaluarAprobacion(vacio, [], n).codigo, 'banco_incompleto')
    assert.strictEqual(evaluarAprobacion({ ...bancoVacio(), origen: 'ia' }, [], n).codigo, 'banco_incompleto')
  }
})

caso('N · editar y agregar NO cambian el origen; borrar en un banco ya vacío lo deja en 0 «manual»', () => {
  const ed = guardarEnBanco(estadoIA(1), { id: 'r0', huella: 'h0b', huellaAnterior: 'h0', nuevo: false }, 5).banco
  assert.deepStrictEqual([ed.total, ed.origen], [1, 'ia'])
  const ag = guardarEnBanco(estadoIA(1), { id: 'r1', huella: 'h1', nuevo: true }, 5).banco
  assert.deepStrictEqual([ag.total, ag.origen], [2, 'ia'])
  const cero = quitarDeBanco({ ...bancoVacio(), origen: 'ia' }, { id: 'rx', huella: null }).banco
  assert.deepStrictEqual([cero.total, cero.origen], [0, 'manual'])
})

console.log(`\n${pasadas} pasaron, ${fallos} fallaron`)
if (fallos) process.exit(1)
