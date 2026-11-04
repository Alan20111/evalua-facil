// Reto Exprés — etapa 0: lógica pura (src/utils/retoExpres.js). No necesita emulador ni red.
//
//   node test/reto-expres.test.mjs
//
// Cubre:
//   A. ventanas de tiempo: turnos de 4 s + 20 s, avance sin que nadie lo pida, pausa y reanudación, estabilidad
//      de lo ya aceptado al agregar pausas después;
//   B. puntuación: aciertos sin rapidez, ingreso tardío, duplicadas, fuera de tiempo, expulsados, resultados
//      deterministas y corrección completa por estudiante;
//   C. empates compartidos (1, 1, 3) sin usar la rapidez;
//   D. calificación propuesta con la misma función de las evaluaciones;
//   E. alias: longitud, caracteres, unicidad por sesión y el detector REAL de functions/moderacionSugerencias.js;
//   F. terminación anticipada: preguntas realizadas, interrumpida, sin resultados, calificación proporcional;
//   G. ingreso tardío, reconexión y expulsión (no vuelve a entrar ni a responder);
//   H. alias: roles reservados y nombres reales (también el propio), sin decir a quién se parece;
//   I. modalidades: un reto externo NUNCA es calificable; configuración y modalidad fijas;
//   J. acceso abierto/cerrado; K. tope de 40 externos (atómico, sin liberar lugares);
//   L. tokens y registro sin identidad académica; M. vista final del participante (top 10, sin claves en externo);
//   N. retención de 30 días (desde la finalización), pausas sin límite y resultado anonimizado;
//   O. etapa 2: compatibilidad de reactivos, copia sin tocar el original, propuesta de la IA, las 10 preguntas,
//      datos con los que nace un reto y qué se puede editar; P. copias excluidas y etiqueta «Reto Exprés»;
//   Q. etapa 5: notas propuestas de una sesión (solo inscritos calificable, sin retirados ni externos).

import assert from 'node:assert'
import { createRequire } from 'node:module'
import {
  RETO_CFG, TIPOS_RETO, FASES_RETO, ESTADOS_RETO,
  faseReto, aceptaRespuesta, tiempoEfectivoMs, momentoRealMs, pausasValidas, pausadaEn,
  iniciarReto, pausarReto, reanudarReto, puedeFinalizar,
  terminarReto, preguntasRealizadas, preguntaInterrumpida, puedeUnirse, puedeResponder,
  esAcierto, nombreVisible, asignarPosiciones, calcularResultadosReto, calificacionReto,
  normalizarAlias, claveAlias, variantesAlias, validarAlias, claveNombre, formasNombreReal,
  modalidadValida, esCalificable, validarConfiguracionReto, cambioModalidadPermitido, modoIdentidadDe, calificacionPropuestaReto,
  abrirAcceso, cerrarAcceso, reservarCupo, formatoTokenValido, idParticipante, registroParticipante, expulsarParticipante,
  vistaResultadosParticipante,
  reactivoCompatibleReto, MOTIVOS_INCOMPATIBLE, preguntaRetoDesdeReactivo, preguntaRetoDesdePropuestaIA, nuevoIdOpcion,
  estadoPreguntasReto, datosNuevoReto, cambiosDatosReto, propuestasCalificacionReto,
} from '../src/utils/retoExpres.js'
import { esCopiable } from '../src/utils/copiaActividad.js'
import { tituloMovimiento } from '../src/utils/movimientosCreditos.js'
import { TIPOS_OBJETIVOS, calcularPuntosPregunta } from '../src/utils/evaluacionGrading.js'

const require = createRequire(import.meta.url)
const { evaluarTexto } = require('../functions/moderacionSugerencias.js')
const esOfensivo = (t) => evaluarTexto(t).estado === 'retenida'
const OPC = { esOfensivo, nombresProtegidos: [] } // el servidor siempre pasa las dos cosas

let pasadas = 0
let fallos = 0
function caso(nombre, fn) {
  try { fn(); pasadas++; console.log(`  ✓ ${nombre}`) } catch (e) { fallos++; console.log(`  ✗ ${nombre}\n    ${e.message}`) }
}
function grupo(titulo) { console.log(`\n${titulo}`) }

const T0 = 1_000_000 // inicio de la competencia (ms del servidor)
const PREP = RETO_CFG.PREPARACION_MS
const RESP = RETO_CFG.TIEMPO_RESPUESTA_MS
const TURNO = PREP + RESP
const abre = (i) => T0 + i * TURNO + PREP // hora real de apertura de la pregunta i (sin pausas)
const cierra = (i) => T0 + (i + 1) * TURNO

function sesionEnCurso(extra = {}) {
  return { estado: ESTADOS_RETO.en_curso, inicioMs: T0, pausas: [], modoIdentidad: 'nombre', ...extra }
}
function aplicar(sesion, r) {
  assert.ok(r.ok, `transición rechazada: ${r.codigo}`)
  return r.patch ? { ...sesion, ...r.patch } : sesion
}

// ── A. Ventanas de tiempo ──────────────────────────────────────────────────
grupo('A. Ventanas de tiempo')

caso('configuración: 10 preguntas, 20 s y solo tipos de calificación automática', () => {
  assert.strictEqual(RETO_CFG.TOTAL_PREGUNTAS, 10)
  assert.strictEqual(RETO_CFG.TIEMPO_RESPUESTA_MS, 20000)
  assert.deepStrictEqual(TIPOS_RETO, TIPOS_OBJETIVOS)
})

caso('sala de espera hasta iniciar; iniciar fija la hora del servidor y repetirlo no cambia nada', () => {
  const espera = { estado: ESTADOS_RETO.espera }
  assert.strictEqual(faseReto(espera, T0).fase, FASES_RETO.espera)
  assert.strictEqual(aceptaRespuesta(espera, 0, T0), false)
  const r = iniciarReto(espera, T0)
  assert.deepStrictEqual(r.patch, { estado: ESTADOS_RETO.en_curso, inicioMs: T0, pausas: [] })
  const enCurso = aplicar(espera, r)
  assert.strictEqual(iniciarReto(enCurso, T0 + 5000).patch, null) // doble clic / dos pestañas
  assert.strictEqual(iniciarReto({ estado: ESTADOS_RETO.finalizada }, T0).codigo, 'NO_EN_ESPERA')
})

caso('cada pregunta: 4 s de preparación (sin poder responder) y 20 s abierta', () => {
  const s = sesionEnCurso()
  let f = faseReto(s, T0)
  assert.strictEqual(f.fase, FASES_RETO.preparando)
  assert.strictEqual(f.indice, 0)
  assert.strictEqual(f.faltaParaAbrirMs, PREP)
  assert.strictEqual(aceptaRespuesta(s, 0, T0 + PREP - 1), false)
  f = faseReto(s, abre(0))
  assert.strictEqual(f.fase, FASES_RETO.abierta)
  assert.strictEqual(f.restanteMs, RESP)
  assert.strictEqual(f.abreMs, abre(0))
  assert.strictEqual(f.cierraMs, cierra(0))
  assert.strictEqual(aceptaRespuesta(s, 0, abre(0)), true)
  assert.strictEqual(aceptaRespuesta(s, 0, cierra(0) - 1), true)
  assert.strictEqual(aceptaRespuesta(s, 0, cierra(0)), false) // el límite ya no cuenta
})

caso('avance automático: la pregunta en curso sale del reloj, sin que el proyector haga nada', () => {
  const s = sesionEnCurso()
  for (let i = 0; i < RETO_CFG.TOTAL_PREGUNTAS; i++) {
    assert.strictEqual(faseReto(s, abre(i) + 1000).indice, i)
    assert.strictEqual(aceptaRespuesta(s, i, abre(i) + 1000), true)
    assert.strictEqual(aceptaRespuesta(s, i + 1, abre(i) + 1000), false) // nunca otra pregunta
    if (i > 0) assert.strictEqual(aceptaRespuesta(s, i - 1, abre(i) + 1000), false) // ni una ya cerrada
  }
  // Nadie consultó durante minutos (proyector cerrado): igual se sabe exactamente dónde va.
  assert.strictEqual(faseReto(s, T0 + 7 * TURNO + PREP + 500).indice, 7)
  assert.strictEqual(faseReto(s, cierra(9) - 1).fase, FASES_RETO.abierta)
  assert.strictEqual(faseReto(s, cierra(9)).fase, FASES_RETO.terminada)
  assert.strictEqual(puedeFinalizar(s, cierra(9) - 1), false)
  assert.strictEqual(puedeFinalizar(s, cierra(9)), true)
})

caso('una sesión finalizada ya no acepta nada', () => {
  const s = sesionEnCurso({ estado: ESTADOS_RETO.finalizada })
  assert.strictEqual(faseReto(s, abre(0)).fase, FASES_RETO.finalizada)
  assert.strictEqual(aceptaRespuesta(s, 0, abre(0)), false)
})

caso('pausa con la pregunta abierta: congela el tiempo, no admite respuestas y conserva lo que faltaba', () => {
  let s = sesionEnCurso()
  const tPausa = abre(0) + 6000 // quedaban 14 s
  s = aplicar(s, pausarReto(s, tPausa))
  const enPausa = faseReto(s, tPausa + 60_000)
  assert.strictEqual(enPausa.fase, FASES_RETO.pausada)
  assert.strictEqual(enPausa.faseAlPausar, FASES_RETO.abierta)
  assert.strictEqual(enPausa.indice, 0)
  assert.strictEqual(enPausa.restanteMs, 14_000)
  assert.strictEqual(enPausa.cierraMs, null) // no se sabe cuándo se reanudará
  assert.strictEqual(aceptaRespuesta(s, 0, tPausa), false)
  assert.strictEqual(aceptaRespuesta(s, 0, tPausa + 60_000), false)
  // Lo que mide el tiempo efectivo es lo mismo antes de la pausa y un minuto después.
  assert.strictEqual(tiempoEfectivoMs(s, tPausa + 60_000), tiempoEfectivoMs(s, tPausa))

  const tReanuda = tPausa + 60_000
  s = aplicar(s, reanudarReto(s, tReanuda))
  const f = faseReto(s, tReanuda)
  assert.strictEqual(f.fase, FASES_RETO.abierta)
  assert.strictEqual(f.restanteMs, 14_000)
  assert.strictEqual(f.cierraMs, cierra(0) + 60_000)
  assert.strictEqual(f.abreMs, abre(0)) // la apertura ya había ocurrido: no se mueve
  // La siguiente pregunta se corre exactamente lo que duró la pausa.
  assert.strictEqual(faseReto(s, abre(1) + 60_000).fase, FASES_RETO.abierta)
  assert.strictEqual(faseReto(s, abre(1) + 60_000).indice, 1)
  assert.strictEqual(faseReto(s, cierra(9) + 60_000).fase, FASES_RETO.terminada)
})

caso('pausa en la preparación: al reanudar falta lo mismo para abrir', () => {
  let s = sesionEnCurso()
  const tPausa = T0 + TURNO + 1000 // pregunta 2, faltan 3 s para abrir
  s = aplicar(s, pausarReto(s, tPausa))
  assert.strictEqual(faseReto(s, tPausa + 5000).faseAlPausar, FASES_RETO.preparando)
  assert.strictEqual(faseReto(s, tPausa + 5000).faltaParaAbrirMs, 3000)
  s = aplicar(s, reanudarReto(s, tPausa + 5000))
  const f = faseReto(s, tPausa + 5000)
  assert.strictEqual(f.fase, FASES_RETO.preparando)
  assert.strictEqual(f.faltaParaAbrirMs, 3000)
  assert.strictEqual(f.abreMs, abre(1) + 5000)
})

caso('lo que ya se aceptó sigue aceptado aunque después haya pausas; lo recibido EN la pausa, nunca', () => {
  let s = sesionEnCurso()
  const antes = abre(0) + 2000
  assert.strictEqual(aceptaRespuesta(s, 0, antes), true)
  s = aplicar(s, pausarReto(s, abre(0) + 5000))
  const durante = abre(0) + 15_000 // llegó con la competencia en pausa
  s = aplicar(s, reanudarReto(s, abre(0) + 30_000))
  s = aplicar(s, pausarReto(s, abre(3)))
  s = aplicar(s, reanudarReto(s, abre(3) + 1000))
  assert.strictEqual(aceptaRespuesta(s, 0, antes), true)
  assert.strictEqual(pausadaEn(s, durante), true)
  assert.strictEqual(aceptaRespuesta(s, 0, durante), false)
})

caso('pausar o reanudar dos veces no hace nada; fuera de la competencia es un error', () => {
  let s = sesionEnCurso()
  s = aplicar(s, pausarReto(s, abre(0)))
  assert.strictEqual(pausarReto(s, abre(0) + 10).patch, null)
  s = aplicar(s, reanudarReto(s, abre(0) + 100))
  assert.strictEqual(reanudarReto(s, abre(0) + 200).patch, null)
  assert.strictEqual(pausarReto({ estado: ESTADOS_RETO.espera }, T0).codigo, 'NO_PAUSABLE')
  assert.strictEqual(pausarReto(sesionEnCurso(), cierra(9)).codigo, 'NO_PAUSABLE') // ya terminada
  assert.strictEqual(reanudarReto({ estado: ESTADOS_RETO.espera }, T0).codigo, 'NO_EN_CURSO')
  assert.strictEqual(pausarReto(sesionEnCurso({ pausas: [{ desdeMs: T0 + 10, hastaMs: T0 + 20 }] }), T0 + 15).codigo, 'HORA_INVALIDA')
})

caso('máximo de pausas', () => {
  const pausas = Array.from({ length: RETO_CFG.MAX_PAUSAS }, (_, i) => ({ desdeMs: T0 + i * 10, hastaMs: T0 + i * 10 + 5 }))
  const s = sesionEnCurso({ pausas })
  assert.strictEqual(pausasValidas(s), true)
  assert.strictEqual(pausarReto(s, T0 + 5000).codigo, 'MAX_PAUSAS')
})

caso('pausas incoherentes se detectan', () => {
  assert.strictEqual(pausasValidas(sesionEnCurso()), true)
  assert.strictEqual(pausasValidas(sesionEnCurso({ pausas: [{ desdeMs: T0 - 1, hastaMs: T0 + 5 }] })), false) // antes del inicio
  assert.strictEqual(pausasValidas(sesionEnCurso({ pausas: [{ desdeMs: T0 + 10, hastaMs: T0 + 50 }, { desdeMs: T0 + 40, hastaMs: T0 + 60 }] })), false) // traslape
  assert.strictEqual(pausasValidas(sesionEnCurso({ pausas: [{ desdeMs: T0 + 10, hastaMs: null }, { desdeMs: T0 + 40, hastaMs: T0 + 60 }] })), false) // abierta en medio
  assert.strictEqual(pausasValidas(sesionEnCurso({ pausas: [{ desdeMs: T0 + 10, hastaMs: T0 + 5 }] })), false) // termina antes de empezar
  assert.strictEqual(pausasValidas(sesionEnCurso({ pausas: [{ desdeMs: T0 + 10, hastaMs: T0 + 20 }, { desdeMs: T0 + 30, hastaMs: null }] })), true)
})

caso('momento real: se corre lo que duraron las pausas anteriores; null si está pausada', () => {
  const s = sesionEnCurso({ pausas: [{ desdeMs: T0 + 1000, hastaMs: T0 + 3000 }] })
  assert.strictEqual(momentoRealMs(s, 500), T0 + 500)
  assert.strictEqual(momentoRealMs(s, 1000), T0 + 1000)
  assert.strictEqual(momentoRealMs(s, 5000), T0 + 7000)
  assert.strictEqual(momentoRealMs(sesionEnCurso({ pausas: [{ desdeMs: T0 + 1000, hastaMs: null }] }), 5000), null)
})

// ── B. Puntuación ──────────────────────────────────────────────────────────
grupo('B. Puntuación')

// 10 preguntas: pares de opción múltiple (clave = id de opción) y nones de verdadero/falso (clave 'v'/'f').
const PREGUNTAS = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, tipo: i % 2 === 0 ? 'opcion_multiple' : 'verdadero_falso' }))
const CLAVES = Object.fromEntries(PREGUNTAS.map((p, i) => [p.id, { respuestaCorrecta: p.tipo === 'opcion_multiple' ? 'b' : (i % 4 === 1 ? 'v' : 'f') }]))
const correctaDe = (i) => CLAVES[`p${i}`].respuestaCorrecta
const incorrectaDe = (i) => (PREGUNTAS[i].tipo === 'opcion_multiple' ? 'c' : (correctaDe(i) === 'v' ? 'f' : 'v'))

let nResp = 0
function resp(participanteId, i, { correcta = true, offset = 1000, opcion } = {}) {
  return { id: `r${String(nResp++).padStart(4, '0')}`, participanteId, preguntaId: `p${i}`, opcionSeleccionada: opcion ?? (correcta ? correctaDe(i) : incorrectaDe(i)), recibidaMs: abre(i) + offset }
}

function escenario() {
  nResp = 0
  const participantes = [
    { id: 'est_ana', nombre: 'Ana Pérez', alias: 'Tigre', unidoMs: T0 - 5000 },
    { id: 'est_beto', nombre: 'Beto Ruiz', alias: 'Cometa', unidoMs: T0 - 5000 },
    { id: 'est_caro', nombre: 'Carolina Díaz', alias: 'Ámbar', unidoMs: abre(5) - 2000 }, // entró tarde (pregunta 6)
    { id: 'est_dani', nombre: 'Daniel Soto', alias: 'Nube', unidoMs: T0 - 5000 }, // nunca respondió
  ]
  const respuestas = []
  for (let i = 0; i < 10; i++) respuestas.push(resp('est_ana', i, { correcta: i < 7, offset: 19_000 })) // lenta: 7
  for (let i = 0; i < 10; i++) respuestas.push(resp('est_beto', i, { correcta: i !== 2 && i !== 5 && i !== 8, offset: 200 })) // rápido: 7
  for (let i = 5; i < 10; i++) respuestas.push(resp('est_caro', i)) // 5 de 5 posibles
  return { participantes, respuestas }
}
const sesionBase = () => sesionEnCurso({ estado: ESTADOS_RETO.finalizada })

caso('el acierto se decide igual que en las evaluaciones (opción múltiple y verdadero/falso)', () => {
  for (const [p, clave, elegida] of [
    [{ tipo: 'opcion_multiple', ponderacion: 1 }, 'b', 'b'], [{ tipo: 'opcion_multiple', ponderacion: 1 }, 'b', 'c'],
    [{ tipo: 'verdadero_falso', ponderacion: 1 }, 'v', 'v'], [{ tipo: 'verdadero_falso', ponderacion: 1 }, 'f', 'v'],
    [{ tipo: 'opcion_multiple', ponderacion: 1 }, 'b', null],
  ]) {
    const deEvaluacion = calcularPuntosPregunta({ ...p, respuestaCorrecta: clave }, { opcionSeleccionada: elegida }) === 1
    assert.strictEqual(esAcierto(p, clave, elegida), deEvaluacion)
  }
  assert.strictEqual(esAcierto({ tipo: 'respuesta_corta' }, 'x', 'x'), false)
})

caso('aciertos sin rapidez; ingreso tardío y preguntas sin responder valen 0', () => {
  const { participantes, respuestas } = escenario()
  const r = calcularResultadosReto({ sesion: sesionBase(), preguntas: PREGUNTAS, claves: CLAVES, participantes, respuestas })
  assert.ok(r.ok, r.codigo)
  const de = Object.fromEntries(r.clasificacion.map((f) => [f.participanteId, f]))
  assert.strictEqual(de.est_ana.aciertos, 7)
  assert.strictEqual(de.est_beto.aciertos, 7) // respondió en 0.2 s y Ana en 19 s: misma puntuación
  assert.strictEqual(de.est_caro.aciertos, 5)
  assert.strictEqual(de.est_caro.respondidas, 5)
  assert.strictEqual(de.est_dani.aciertos, 0)
  assert.strictEqual(de.est_dani.respondidas, 0)
  assert.deepStrictEqual(r.descartadas, { desconocidas: 0, noRealizada: 0, duplicadas: 0, fueraDeTiempo: 0 })
})

caso('respuesta duplicada: vale la primera que llegó, aunque la segunda sea correcta', () => {
  const { participantes, respuestas } = escenario()
  respuestas.push({ id: 'zzz-dup', participanteId: 'est_dani', preguntaId: 'p0', opcionSeleccionada: correctaDe(0), recibidaMs: abre(0) + 5000 })
  respuestas.push({ id: 'aaa-pri', participanteId: 'est_dani', preguntaId: 'p0', opcionSeleccionada: incorrectaDe(0), recibidaMs: abre(0) + 3000 })
  const r = calcularResultadosReto({ sesion: sesionBase(), preguntas: PREGUNTAS, claves: CLAVES, participantes, respuestas })
  assert.strictEqual(r.clasificacion.find((f) => f.participanteId === 'est_dani').aciertos, 0)
  assert.strictEqual(r.detalle.est_dani[0].opcionSeleccionada, incorrectaDe(0))
  assert.strictEqual(r.descartadas.duplicadas, 1)
})

caso('fuera de tiempo, antes del ingreso o de alguien desconocido: no cuenta', () => {
  const { participantes, respuestas } = escenario()
  respuestas.push({ id: 'x1', participanteId: 'est_dani', preguntaId: 'p1', opcionSeleccionada: correctaDe(1), recibidaMs: cierra(1) }) // en el límite
  respuestas.push({ id: 'x2', participanteId: 'est_dani', preguntaId: 'p2', opcionSeleccionada: correctaDe(2), recibidaMs: abre(3) }) // otra pregunta abierta
  respuestas.push({ id: 'x3', participanteId: 'est_caro', preguntaId: 'p4', opcionSeleccionada: correctaDe(4), recibidaMs: abre(4) + 1000 }) // antes de unirse
  respuestas.push({ id: 'x4', participanteId: 'intruso', preguntaId: 'p0', opcionSeleccionada: correctaDe(0), recibidaMs: abre(0) + 1000 })
  respuestas.push({ id: 'x5', participanteId: 'est_dani', preguntaId: 'p99', opcionSeleccionada: 'b', recibidaMs: abre(0) + 1000 })
  const r = calcularResultadosReto({ sesion: sesionBase(), preguntas: PREGUNTAS, claves: CLAVES, participantes, respuestas })
  assert.strictEqual(r.clasificacion.find((f) => f.participanteId === 'est_dani').aciertos, 0)
  assert.strictEqual(r.clasificacion.find((f) => f.participanteId === 'est_caro').aciertos, 5)
  assert.deepStrictEqual(r.descartadas, { desconocidas: 2, noRealizada: 0, duplicadas: 0, fueraDeTiempo: 3 })
})

caso('una respuesta recibida durante una pausa no cuenta', () => {
  const { participantes } = escenario()
  const sesion = sesionEnCurso({ estado: ESTADOS_RETO.finalizada, pausas: [{ desdeMs: abre(0) + 5000, hastaMs: abre(0) + 65_000 }] })
  const respuestas = [{ id: 'p', participanteId: 'est_dani', preguntaId: 'p0', opcionSeleccionada: correctaDe(0), recibidaMs: abre(0) + 30_000 }]
  const r = calcularResultadosReto({ sesion, preguntas: PREGUNTAS, claves: CLAVES, participantes, respuestas })
  assert.strictEqual(r.descartadas.fueraDeTiempo, 1)
})

caso('expulsado: fuera de la clasificación, pero sus resultados se conservan', () => {
  const { participantes, respuestas } = escenario()
  participantes.find((p) => p.id === 'est_beto').expulsado = true
  const r = calcularResultadosReto({ sesion: sesionBase(), preguntas: PREGUNTAS, claves: CLAVES, participantes, respuestas })
  assert.ok(!r.clasificacion.some((f) => f.participanteId === 'est_beto'))
  assert.deepStrictEqual(r.expulsados.map((f) => [f.participanteId, f.aciertos]), [['est_beto', 7]])
  assert.strictEqual(r.detalle.est_beto.length, 10)
  assert.strictEqual(r.clasificacion[0].posicion, 1) // Ana sube sola al primer lugar
})

caso('mismos datos en otro orden = mismo resultado (sin contadores acumulados)', () => {
  const { participantes, respuestas } = escenario()
  const a = calcularResultadosReto({ sesion: sesionBase(), preguntas: PREGUNTAS, claves: CLAVES, participantes, respuestas })
  const b = calcularResultadosReto({ sesion: sesionBase(), preguntas: PREGUNTAS, claves: CLAVES, participantes: [...participantes].reverse(), respuestas: [...respuestas].reverse() })
  assert.deepStrictEqual(a, b)
})

caso('se calcula igual con la sesión en curso que ya finalizada', () => {
  const { participantes, respuestas } = escenario()
  const a = calcularResultadosReto({ sesion: sesionEnCurso(), preguntas: PREGUNTAS, claves: CLAVES, participantes, respuestas })
  const b = calcularResultadosReto({ sesion: sesionBase(), preguntas: PREGUNTAS, claves: CLAVES, participantes, respuestas })
  assert.deepStrictEqual(a, b)
})

caso('corrección completa por estudiante: su respuesta, la correcta y si acertó', () => {
  const { participantes, respuestas } = escenario()
  const r = calcularResultadosReto({ sesion: sesionBase(), preguntas: PREGUNTAS, claves: CLAVES, participantes, respuestas })
  assert.deepStrictEqual(r.detalle.est_beto[2], { preguntaId: 'p2', opcionSeleccionada: incorrectaDe(2), respuestaCorrecta: correctaDe(2), acerto: false })
  assert.deepStrictEqual(r.detalle.est_caro[0], { preguntaId: 'p0', opcionSeleccionada: null, respuestaCorrecta: correctaDe(0), acerto: false })
  assert.strictEqual(r.detalle.est_ana.filter((d) => d.acerto).length, 7)
})

caso('sin las 10 preguntas, sin clave o con un tipo no automático: no se calcula', () => {
  const { participantes, respuestas } = escenario()
  const base = { sesion: sesionBase(), claves: CLAVES, participantes, respuestas }
  assert.strictEqual(calcularResultadosReto({ ...base, preguntas: PREGUNTAS.slice(0, 9) }).codigo, 'TOTAL_INVALIDO')
  assert.strictEqual(calcularResultadosReto({ ...base, preguntas: [...PREGUNTAS.slice(0, 9), { id: 'p9', tipo: 'respuesta_corta' }] }).codigo, 'TIPO_NO_COMPATIBLE')
  assert.strictEqual(calcularResultadosReto({ ...base, preguntas: [...PREGUNTAS.slice(0, 9), { id: 'p0', tipo: 'verdadero_falso' }] }).codigo, 'PREGUNTA_INVALIDA')
  const sinClave = { ...CLAVES }; delete sinClave.p4
  assert.strictEqual(calcularResultadosReto({ ...base, preguntas: PREGUNTAS, claves: sinClave }).codigo, 'SIN_CLAVE')
  assert.strictEqual(calcularResultadosReto({ ...base, preguntas: PREGUNTAS, sesion: { estado: 'finalizada' } }).codigo, 'SESION_INVALIDA')
})

caso('modo alias: la clasificación nunca lleva el nombre real', () => {
  const { participantes, respuestas } = escenario()
  const r = calcularResultadosReto({ sesion: { ...sesionBase(), modoIdentidad: 'alias' }, preguntas: PREGUNTAS, claves: CLAVES, participantes, respuestas })
  const texto = JSON.stringify({ c: r.clasificacion, e: r.expulsados })
  for (const p of participantes) assert.ok(!texto.includes(p.nombre), `se filtró ${p.nombre}`)
  assert.deepStrictEqual(r.clasificacion.map((f) => f.nombreVisible).sort(), ['Cometa', 'Nube', 'Tigre', 'Ámbar'].sort())
  assert.strictEqual(nombreVisible({ nombre: 'Ana Pérez', alias: '' }, 'alias'), 'Participante')
  assert.strictEqual(nombreVisible({ nombre: 'Ana Pérez', alias: 'Tigre' }, 'nombre'), 'Ana Pérez')
})

// ── C. Empates ─────────────────────────────────────────────────────────────
grupo('C. Empates')

caso('mismos aciertos = misma posición, y la siguiente salta (1, 1, 3, 4)', () => {
  const { participantes, respuestas } = escenario()
  const r = calcularResultadosReto({ sesion: sesionBase(), preguntas: PREGUNTAS, claves: CLAVES, participantes, respuestas })
  assert.deepStrictEqual(r.clasificacion.map((f) => [f.participanteId, f.posicion]), [
    ['est_ana', 1], ['est_beto', 1], ['est_caro', 3], ['est_dani', 4],
  ])
})

caso('dentro de un empate el orden es alfabético, nunca por rapidez', () => {
  const filas = asignarPosiciones([
    { participanteId: 'b', nombreVisible: 'Zoe', aciertos: 5 },
    { participanteId: 'a', nombreVisible: 'ámbar', aciertos: 5 },
    { participanteId: 'c', nombreVisible: 'Luis', aciertos: 9 },
    { participanteId: 'd', nombreVisible: 'Mia', aciertos: 5 },
    { participanteId: 'e', nombreVisible: 'Iván', aciertos: 0 },
  ])
  assert.deepStrictEqual(filas.map((f) => [f.nombreVisible, f.posicion]), [['Luis', 1], ['ámbar', 2], ['Mia', 2], ['Zoe', 2], ['Iván', 5]])
})

caso('todos empatados en cero comparten el primer lugar', () => {
  const filas = asignarPosiciones([{ participanteId: 'x', nombreVisible: 'B', aciertos: 0 }, { participanteId: 'y', nombreVisible: 'A', aciertos: 0 }])
  assert.deepStrictEqual(filas.map((f) => f.posicion), [1, 1])
  assert.deepStrictEqual(asignarPosiciones([]), [])
})

// ── D. Calificación propuesta ──────────────────────────────────────────────
grupo('D. Calificación propuesta')

caso('(aciertos / 10) × calificación máxima, para escala 10 y 100', () => {
  for (let a = 0; a <= 10; a++) {
    assert.strictEqual(calificacionReto(a, 10), a)
    assert.strictEqual(calificacionReto(a, 100), a * 10)
  }
  assert.strictEqual(calificacionReto(7), 7) // por omisión, escala 10
})

caso('datos inválidos no producen calificación', () => {
  for (const a of [-1, 11, 3.5, null, undefined, '7']) assert.strictEqual(calificacionReto(a, 10), null)
  assert.strictEqual(calificacionReto(5, 0), null)
  assert.strictEqual(calificacionReto(5, NaN), null)
})

// ── E. Alias ───────────────────────────────────────────────────────────────
grupo('E. Alias')

caso('se normalizan los espacios y se cuentan caracteres reales', () => {
  assert.strictEqual(normalizarAlias('   Ana    Luz  '), 'Ana Luz')
  assert.strictEqual(validarAlias('  Ana   Luz ', OPC).alias, 'Ana Luz')
  assert.strictEqual(validarAlias('Ñu', OPC).codigo, 'LONGITUD')
  assert.strictEqual(validarAlias('Ñus', OPC).ok, true)
  assert.strictEqual(validarAlias('a'.repeat(RETO_CFG.ALIAS_MAX), OPC).ok, true)
  assert.strictEqual(validarAlias('a'.repeat(RETO_CFG.ALIAS_MAX + 1), OPC).codigo, 'LONGITUD')
  assert.strictEqual(validarAlias('', OPC).codigo, 'LONGITUD')
  assert.strictEqual(validarAlias(null, OPC).codigo, 'LONGITUD')
})

caso('solo letras (con acentos y ñ), números, espacio, punto y guiones; al menos una letra', () => {
  for (const ok of ['Tigre 7', 'Peña', 'Ámbar_23', 'J.R.-2']) assert.strictEqual(validarAlias(ok, OPC).ok, true, ok)
  for (const mal of ['<b>hola</b>', 'ana😀', 'hola!', 'a@b.c', 'x​y']) assert.strictEqual(validarAlias(mal, OPC).codigo, 'CARACTERES', mal)
  assert.strictEqual(validarAlias('12345', OPC).codigo, 'SIN_LETRAS')
  assert.strictEqual(validarAlias('a.-.', OPC).codigo, 'SIN_LETRAS')
})

caso('único por sesión: mayúsculas, acentos, espacios y signos no lo hacen distinto', () => {
  const ocupados = new Set([claveAlias('Ana Luz')])
  for (const igual of ['ana luz', 'ANALUZ', 'Ana-Luz', 'Aná Lúz', 'ana_luz']) {
    assert.strictEqual(validarAlias(igual, { ...OPC, ocupados }).codigo, 'OCUPADO', igual)
  }
  assert.strictEqual(validarAlias('Ana Luz 2', { ...OPC, ocupados }).ok, true)
  assert.notStrictEqual(claveAlias('Peña'), claveAlias('Pena')) // la ñ es otra letra
  assert.strictEqual(validarAlias('Ana Luz', { ...OPC, ocupados: [claveAlias('Ana Luz')] }).codigo, 'OCUPADO') // también acepta arreglo
})

caso('el docente renombra: su propio alias anterior no cuenta como ocupado', () => {
  const tomados = [claveAlias('Tigre'), claveAlias('Cometa')]
  const sinElPropio = tomados.filter((c) => c !== claveAlias('Tigre'))
  assert.strictEqual(validarAlias('tigre', { ...OPC, ocupados: tomados }).codigo, 'OCUPADO')
  assert.strictEqual(validarAlias('tigre', { ...OPC, ocupados: sinElPropio }).ok, true)
  assert.strictEqual(validarAlias('Cometa', { ...OPC, ocupados: sinElPropio }).codigo, 'OCUPADO')
})

caso('palabras ofensivas con el detector real del servidor, también pegadas o con números', () => {
  for (const mal of ['pendejo', 'PENDEJO', 'p3nd3j0', 'El Pendejo', 'ElPendejo', 'el_pendejo', 'pendejo123', 'idiota', 'Estúpido']) {
    const r = validarAlias(mal, OPC)
    assert.strictEqual(r.codigo, 'OFENSIVO', mal)
    assert.ok(!r.error.toLowerCase().includes('pendejo') && !r.error.toLowerCase().includes('idiota'), 'el error no repite la palabra')
  }
})

caso('palabras inocentes que contienen una ofensiva no se marcan', () => {
  for (const ok of ['Computadora', 'Disputa', 'Pera', 'Tigre 7', 'Ana Luz']) assert.strictEqual(validarAlias(ok, OPC).ok, true, ok)
})

caso('sin detector de moderación el alias se rechaza (falla cerrada)', () => {
  assert.strictEqual(validarAlias('Tigre').codigo, 'SIN_MODERACION')
  assert.strictEqual(validarAlias('Tigre', { esOfensivo: null }).codigo, 'SIN_MODERACION')
})

caso('variantes que se revisan: original, separadores, mayúsculas internas y números', () => {
  assert.deepStrictEqual(variantesAlias('ElGrosero_99'), ['ElGrosero_99', 'ElGrosero 99', 'El Grosero 99'])
  const vistas = []
  validarAlias('Tigre2Rayo', { nombresProtegidos: [], esOfensivo: (t) => { vistas.push(t); return false } })
  assert.ok(vistas.includes('Tigre 2 Rayo'))
})

// ── F. Terminación anticipada ──────────────────────────────────────────────
grupo('F. Terminación anticipada')

const CONF = { confirmado: true }
const terminar = (s, t) => aplicar(s, terminarReto(s, t, CONF))
const resultados = (sesion, datos = escenario()) => calcularResultadosReto({ sesion, preguntas: PREGUNTAS, claves: CLAVES, ...datos })

caso('exige confirmación explícita', () => {
  assert.strictEqual(terminarReto(sesionEnCurso(), abre(2)).codigo, 'SIN_CONFIRMACION')
  assert.strictEqual(terminarReto(sesionEnCurso(), abre(2), { confirmado: 'si' }).codigo, 'SIN_CONFIRMACION')
})

caso('con una pregunta abierta: se cierra todo y esa pregunta no cuenta como realizada', () => {
  const tFin = abre(3) + 5000
  const s = terminar(sesionEnCurso(), tFin)
  assert.deepStrictEqual(s.terminadaMs, tFin)
  assert.strictEqual(preguntasRealizadas(s), 3)
  assert.strictEqual(preguntaInterrumpida(s), 3)
  assert.strictEqual(faseReto(s, tFin).fase, FASES_RETO.terminada)
  assert.strictEqual(aceptaRespuesta(s, 3, tFin), false)
  assert.strictEqual(aceptaRespuesta(s, 3, tFin + 1000), false)
  assert.strictEqual(aceptaRespuesta(s, 3, abre(3) + 1000), true) // lo anterior al cierre no cambia
  assert.strictEqual(puedeFinalizar(s, tFin), true)
  assert.strictEqual(pausarReto(s, tFin + 10).codigo, 'NO_PAUSABLE')
  assert.strictEqual(iniciarReto(s, tFin + 10).codigo, 'NO_EN_ESPERA')
  assert.strictEqual(terminarReto(s, tFin + 10, CONF).patch, null) // repetirlo no cambia nada
})

caso('resultados sobre las realizadas; las no realizadas no aparecen ni revelan su clave', () => {
  const s = terminar(sesionEnCurso(), abre(3) + 5000)
  const r = resultados({ ...s, estado: ESTADOS_RETO.finalizada })
  assert.ok(r.ok, r.codigo)
  assert.strictEqual(r.realizadas, 3)
  assert.strictEqual(r.interrumpida, 'p3')
  assert.strictEqual(r.sinResultados, false)
  const de = Object.fromEntries(r.clasificacion.map((f) => [f.participanteId, f]))
  assert.strictEqual(de.est_ana.aciertos, 3)
  assert.strictEqual(de.est_beto.aciertos, 2)
  assert.strictEqual(de.est_caro.aciertos, 0) // entró en la pregunta 6, que no se realizó
  assert.deepStrictEqual(r.clasificacion.map((f) => f.posicion), [1, 2, 3, 3])
  // Respuestas a la interrumpida y a las no abiertas: se cuentan, no se borran ni se califican.
  assert.strictEqual(r.descartadas.noRealizada, 7 + 7 + 5)
  for (const id of Object.keys(r.detalle)) {
    assert.deepStrictEqual(r.detalle[id].map((d) => d.preguntaId), ['p0', 'p1', 'p2'])
  }
  // Lo que llegará al estudiante (clasificación y detalle) no menciona ninguna pregunta no realizada.
  // `interrumpida` sí lleva el id de la p3: es para la auditoría del docente.
  const texto = JSON.stringify({ c: r.clasificacion, d: r.detalle, e: r.expulsados })
  for (let i = 3; i < 10; i++) assert.ok(!texto.includes(`"p${i}"`), `aparece p${i}`)
})

caso('calificación con terminación anticipada: misma proporción sobre las realizadas', () => {
  const s = terminar(sesionEnCurso(), abre(3) + 5000)
  const r = resultados({ ...s, estado: ESTADOS_RETO.finalizada })
  const nota = (id, max) => calificacionReto(r.clasificacion.find((f) => f.participanteId === id).aciertos, max, r.realizadas)
  assert.strictEqual(nota('est_ana', 10), 10) // 3 de 3
  assert.strictEqual(nota('est_beto', 10), 6.7) // 2 de 3
  assert.strictEqual(nota('est_beto', 100), 66.7)
  assert.strictEqual(nota('est_dani', 10), 0)
})

caso('fórmula: (aciertos / realizadas) × máxima para 1 a 10 preguntas, en escala 10 y 100', () => {
  for (let n = 1; n <= 10; n++) {
    for (let a = 0; a <= n; a++) {
      for (const max of [10, 100]) {
        assert.strictEqual(calificacionReto(a, max, n), Math.round((a / n) * max * 10) / 10, `${a}/${n} × ${max}`)
      }
    }
  }
  // Con las 10 preguntas es exactamente la fórmula original.
  for (let a = 0; a <= 10; a++) assert.strictEqual(calificacionReto(a, 10, 10), calificacionReto(a, 10))
  for (const n of [0, 11, 2.5, null]) assert.strictEqual(calificacionReto(1, 10, n), null)
  assert.strictEqual(calificacionReto(4, 10, 3), null) // más aciertos que preguntas realizadas
})

caso('terminar en la preparación: la pregunta que no se abrió no cuenta ni es «interrumpida»', () => {
  const s = terminar(sesionEnCurso(), T0 + 3 * TURNO + 1000)
  assert.strictEqual(preguntasRealizadas(s), 3)
  assert.strictEqual(preguntaInterrumpida(s), null)
})

caso('justo en el cierre de una pregunta, esa sí se realizó; un instante antes, no', () => {
  assert.strictEqual(preguntasRealizadas(terminar(sesionEnCurso(), cierra(2))), 3)
  const antes = terminar(sesionEnCurso(), cierra(2) - 1)
  assert.strictEqual(preguntasRealizadas(antes), 2)
  assert.strictEqual(preguntaInterrumpida(antes), 2)
})

caso('terminar en pausa: la pausa se cierra en ese instante y la pregunta pausada no cuenta', () => {
  let s = sesionEnCurso()
  s = aplicar(s, pausarReto(s, abre(3) + 2000))
  s = terminar(s, abre(3) + 62_000)
  assert.deepStrictEqual(s.pausas, [{ desdeMs: abre(3) + 2000, hastaMs: abre(3) + 62_000 }])
  assert.strictEqual(pausasValidas(s), true)
  assert.strictEqual(preguntasRealizadas(s), 3)
  assert.strictEqual(preguntaInterrumpida(s), 3)
  let p = aplicar(sesionEnCurso(), pausarReto(sesionEnCurso(), T0 + TURNO + 1000)) // pausada en la preparación
  p = terminar(p, T0 + TURNO + 90_000)
  assert.strictEqual(preguntasRealizadas(p), 1)
  assert.strictEqual(preguntaInterrumpida(p), null)
})

caso('terminar antes de abrir la primera pregunta: sin clasificación ni calificación', () => {
  const s = terminar(sesionEnCurso(), T0 + 1000)
  assert.strictEqual(preguntasRealizadas(s), 0)
  const r = resultados({ ...s, estado: ESTADOS_RETO.finalizada })
  assert.ok(r.ok)
  assert.strictEqual(r.sinResultados, true)
  assert.deepStrictEqual([r.clasificacion, r.expulsados, r.detalle], [[], [], {}])
  assert.strictEqual(calificacionReto(0, 10, r.realizadas), null)
})

caso('terminar desde la sala de espera: se conserva la sesión, sin resultados', () => {
  const espera = { estado: ESTADOS_RETO.espera, modoIdentidad: 'nombre' }
  const r0 = terminarReto(espera, T0, CONF)
  assert.deepStrictEqual(r0.patch, { terminadaMs: T0 })
  const s = aplicar(espera, r0)
  assert.strictEqual(faseReto(s, T0).fase, FASES_RETO.terminada)
  assert.strictEqual(iniciarReto(s, T0 + 1).codigo, 'NO_EN_ESPERA')
  const r = resultados(s)
  assert.ok(r.ok, r.codigo)
  assert.strictEqual(r.sinResultados, true)
})

caso('sin terminación anticipada todo sigue igual: 10 realizadas y ninguna interrumpida', () => {
  const s = sesionEnCurso()
  assert.strictEqual(preguntasRealizadas(s), 10)
  assert.strictEqual(preguntaInterrumpida(s), null)
  assert.strictEqual(terminarReto(s, cierra(9) + 5, CONF).patch, null) // ya terminó sola
  const r = resultados(sesionBase())
  assert.strictEqual(r.realizadas, 10)
  assert.strictEqual(r.interrumpida, null)
  assert.strictEqual(r.detalle.est_ana.length, 10)
})

caso('un registro con la terminación antes del inicio es inválido', () => {
  assert.strictEqual(resultados(sesionEnCurso({ terminadaMs: T0 - 1 })).codigo, 'SESION_INVALIDA')
})

// ── G. Ingreso y expulsión ─────────────────────────────────────────────────
grupo('G. Ingreso y expulsión')

caso('se puede entrar en la sala y ya empezada; un expulsado nunca vuelve; terminada no admite a nadie', () => {
  // Desde la etapa 0-bis el ingreso de alguien NUEVO exige modalidad y acceso abierto (ver grupo I).
  const abierta = { modalidad: 'inscritos', accesoAbierto: true }
  const espera = { estado: ESTADOS_RETO.espera, ...abierta }
  const enCurso = () => sesionEnCurso(abierta)
  assert.strictEqual(puedeUnirse(espera, null, T0).ok, true)
  assert.strictEqual(puedeUnirse(enCurso(), null, abre(6)).ok, true) // ingreso tardío
  assert.strictEqual(puedeUnirse(enCurso(), { id: 'est_ana' }, abre(6)).ok, true) // reconexión
  assert.strictEqual(puedeUnirse(espera, { id: 'x', expulsado: true }, T0).codigo, 'EXPULSADO')
  assert.strictEqual(puedeUnirse(enCurso(), { id: 'x', expulsado: true }, abre(1)).codigo, 'EXPULSADO')
  assert.strictEqual(puedeUnirse(enCurso(), null, cierra(9)).codigo, 'TERMINADA')
  assert.strictEqual(puedeUnirse(terminar(enCurso(), abre(2)), null, abre(2) + 1).codigo, 'TERMINADA')
})

caso('responder: solo un participante no expulsado, con la pregunta abierta y sin pausa', () => {
  const s = sesionEnCurso()
  const ana = { id: 'est_ana', unidoMs: T0 - 1 }
  assert.strictEqual(puedeResponder(s, ana, 2, abre(2) + 10).ok, true)
  assert.strictEqual(puedeResponder(s, null, 2, abre(2) + 10).codigo, 'NO_PARTICIPANTE')
  assert.strictEqual(puedeResponder(s, { ...ana, expulsado: true }, 2, abre(2) + 10).codigo, 'EXPULSADO')
  assert.strictEqual(puedeResponder(s, { ...ana, unidoMs: abre(2) + 500 }, 2, abre(2) + 10).codigo, 'NO_UNIDO')
  assert.strictEqual(puedeResponder(s, ana, 2, abre(2) - 10).codigo, 'FUERA_DE_TIEMPO') // en preparación
  assert.strictEqual(puedeResponder(s, ana, 1, abre(2) + 10).codigo, 'FUERA_DE_TIEMPO') // pregunta ya cerrada
  const pausada = aplicar(s, pausarReto(s, abre(2) + 100))
  assert.strictEqual(puedeResponder(pausada, ana, 2, abre(2) + 200).codigo, 'PAUSADA')
})

// ── H. Alias: roles reservados y nombres reales ────────────────────────────
grupo('H. Alias: roles reservados y nombres reales')

const ROSTER = [
  { nombre: 'Ana Sofía', apellidoPaterno: 'Pérez', apellidoMaterno: 'López' },
  { nombre: 'José', apellidoPaterno: 'Peña', apellidoMaterno: '' },
  'Luis Ángel Ruiz', // también acepta el nombre completo en texto
]
const conRoster = { esOfensivo, nombresProtegidos: ROSTER }

caso('roles reservados como palabra: bloqueados', () => {
  for (const mal of ['Docente', 'docente 2', 'Profe Juan', 'ElDocente', 'Admin7', 'la_maestra', 'Evalúa Fácil', 'EvaluaFacilOficial', 'Soporte.Tec']) {
    const r = validarAlias(mal, OPC)
    assert.strictEqual(r.codigo, 'RESERVADO', mal)
  }
})

caso('palabras que solo contienen un rol: permitidas', () => {
  for (const ok of ['Profeta', 'Sistemático', 'Administrar', 'Maestría', 'Directo']) assert.strictEqual(validarAlias(ok, OPC).ok, true, ok)
})

caso('nombre completo o nombre con cualquiera de los apellidos: bloqueados', () => {
  for (const mal of [
    'AnaSofíaPérezLópez', 'PérezLópez AnaSofía', 'ana perez', 'ANA LOPEZ', 'Sofia Perez', 'AnaSofíaPérez',
    'Pérez Ana', 'Ana Pérez 2', 'ana_perez', '  ana   pérez ', 'Jose Pena', 'josé peña', 'luis angel ruiz',
  ]) {
    assert.strictEqual(validarAlias(mal, conRoster).codigo, 'SUPLANTACION', mal)
  }
})

caso('nombre de pila solo u otras combinaciones no se bloquean', () => {
  for (const ok of ['Ana', 'Sofía', 'José', 'Luis', 'Ana Luz', 'Pérez López', 'Luis Ruiz']) {
    assert.strictEqual(validarAlias(ok, conRoster).ok, true, ok)
  }
})

caso('el propio nombre real también se bloquea (el servidor incluye al propio estudiante)', () => {
  const propio = [{ nombre: 'Carolina', apellidoPaterno: 'Díaz', apellidoMaterno: 'Mora' }]
  assert.strictEqual(validarAlias('Carolina Díaz', { esOfensivo, nombresProtegidos: propio }).codigo, 'SUPLANTACION')
  assert.strictEqual(validarAlias('Caro Ninja', { esOfensivo, nombresProtegidos: propio }).ok, true)
})

caso('el rechazo no dice a quién se parece', () => {
  const r = validarAlias('Ana Pérez', conRoster)
  for (const parte of ['Ana', 'Pérez', 'Perez', 'López', 'Sofía']) assert.ok(!r.error.includes(parte), `el error menciona ${parte}`)
})

caso('sin la lista de nombres el alias se rechaza (falla cerrada)', () => {
  assert.strictEqual(validarAlias('Tigre', { esOfensivo }).codigo, 'SIN_MODERACION')
  assert.strictEqual(validarAlias('Tigre', { esOfensivo, nombresProtegidos: null }).codigo, 'SIN_MODERACION')
})

caso('formas del nombre real normalizadas (mayúsculas, acentos, ñ, espacios)', () => {
  const f = formasNombreReal({ nombre: 'José', apellidoPaterno: 'Peña' })
  assert.deepStrictEqual([...f].sort(), ['josepena', 'penajose'])
  assert.strictEqual(claveNombre('  José   PEÑA '), 'josepena')
  assert.deepStrictEqual([...formasNombreReal({ nombre: 'Ana' })], []) // nombre de pila solo, sin apellidos
  assert.deepStrictEqual([...formasNombreReal('Ana')], [])
})

// ── I. Modalidades y candado de calificación ───────────────────────────────
grupo('I. Modalidades y candado de calificación')

const CFG_EXTERNO = { modalidad: 'externo', calificable: false, modoIdentidad: 'alias', sinCalificacion: true, oculta: true, publishAt: null }

caso('solo dos modalidades válidas; lo desconocido no cuenta como ninguna', () => {
  assert.strictEqual(modalidadValida('inscritos'), true)
  assert.strictEqual(modalidadValida('externo'), true)
  for (const m of ['Externo', 'grupo', '', null, undefined, 1]) assert.strictEqual(modalidadValida(m), false, String(m))
})

caso('un reto externo NUNCA es calificable, ni marcado como calificable', () => {
  assert.strictEqual(esCalificable({ modalidad: 'externo', calificable: true }), false)
  assert.strictEqual(esCalificable({ modalidad: 'externo', calificable: false }), false)
  assert.strictEqual(esCalificable({ modalidad: 'inscritos', calificable: true }), true)
  assert.strictEqual(esCalificable({ modalidad: 'inscritos', calificable: false }), false)
  assert.strictEqual(esCalificable({ modalidad: 'inscritos', calificable: 'true' }), false)
  assert.strictEqual(esCalificable({ calificable: true }), false) // sin modalidad: no
  assert.strictEqual(esCalificable(null), false)
})

caso('la calificación propuesta de un reto externo siempre es nula', () => {
  for (let a = 0; a <= 10; a++) {
    assert.strictEqual(calificacionPropuestaReto({ modalidad: 'externo', calificable: true }, { aciertos: a, maxCalif: 10, realizadas: 10 }), null)
  }
  assert.strictEqual(calificacionPropuestaReto({ modalidad: 'inscritos', calificable: true }, { aciertos: 7 }), 7)
  assert.strictEqual(calificacionPropuestaReto({ modalidad: 'inscritos', calificable: true }, { aciertos: 2, maxCalif: 100, realizadas: 3 }), 66.7)
  assert.strictEqual(calificacionPropuestaReto({ modalidad: 'inscritos', calificable: false }, { aciertos: 7 }), null)
  assert.strictEqual(calificacionPropuestaReto({ modalidad: 'desconocida', calificable: true }, { aciertos: 7 }), null)
})

caso('configuración de un reto externo: alias, sin nota, oculto y sin publicación programada', () => {
  assert.deepStrictEqual(validarConfiguracionReto(CFG_EXTERNO), { ok: true, config: { modalidad: 'externo', calificable: false, modoIdentidad: 'alias', sinCalificacion: true } })
  const mal = (cambio) => validarConfiguracionReto({ ...CFG_EXTERNO, ...cambio }).codigo
  assert.strictEqual(mal({ calificable: true }), 'EXTERNO_CALIFICABLE')
  assert.strictEqual(mal({ modoIdentidad: 'nombre' }), 'EXTERNO_SIN_ALIAS')
  assert.strictEqual(mal({ sinCalificacion: false }), 'EXTERNO_CON_NOTA')
  assert.strictEqual(mal({ sinCalificacion: undefined }), 'EXTERNO_CON_NOTA')
  assert.strictEqual(mal({ oculta: false }), 'EXTERNO_VISIBLE')
  assert.strictEqual(mal({ publishAt: '2026-11-01T08:00' }), 'EXTERNO_PROGRAMADO')
  assert.strictEqual(mal({ modalidad: 'publico' }), 'MODALIDAD_INVALIDA')
  assert.strictEqual(mal({ calificable: 'no' }), 'CALIFICABLE_INVALIDO')
})

caso('configuración de un reto de inscritos: nombre o alias, calificable o no, coherente', () => {
  assert.strictEqual(validarConfiguracionReto({ modalidad: 'inscritos', calificable: true, modoIdentidad: 'nombre', sinCalificacion: false }).ok, true)
  assert.strictEqual(validarConfiguracionReto({ modalidad: 'inscritos', calificable: false, modoIdentidad: 'alias', sinCalificacion: true }).ok, true)
  assert.strictEqual(validarConfiguracionReto({ modalidad: 'inscritos', calificable: true, modoIdentidad: 'nombre', sinCalificacion: true }).codigo, 'CALIFICABLE_INCONSISTENTE')
  assert.strictEqual(validarConfiguracionReto({ modalidad: 'inscritos', calificable: false, modoIdentidad: 'otro', sinCalificacion: true }).codigo, 'IDENTIDAD_INVALIDA')
})

caso('la modalidad no cambia nunca', () => {
  assert.strictEqual(cambioModalidadPermitido('externo', 'inscritos'), false)
  assert.strictEqual(cambioModalidadPermitido('inscritos', 'externo'), false)
  assert.strictEqual(cambioModalidadPermitido('externo', 'externo'), true)
  assert.strictEqual(cambioModalidadPermitido('inscritos', 'inscritos'), true)
  assert.strictEqual(cambioModalidadPermitido(undefined, 'externo'), false)
})

caso('en un reto externo la clasificación muestra siempre el alias, aunque el dato diga «nombre»', () => {
  const { participantes, respuestas } = escenario()
  const sesion = { ...sesionBase(), modalidad: 'externo', modoIdentidad: 'nombre' }
  const r = calcularResultadosReto({ sesion, preguntas: PREGUNTAS, claves: CLAVES, participantes, respuestas })
  const texto = JSON.stringify(r.clasificacion)
  for (const p of participantes) assert.ok(!texto.includes(p.nombre), `aparece ${p.nombre}`)
  assert.strictEqual(modoIdentidadDe({ modalidad: 'externo', modoIdentidad: 'nombre' }), 'alias')
  assert.strictEqual(modoIdentidadDe({ modalidad: 'inscritos', modoIdentidad: 'nombre' }), 'nombre')
})

// ── J. Acceso abierto y cerrado ────────────────────────────────────────────
grupo('J. Acceso abierto y cerrado')

caso('sin abrir el acceso nadie nuevo entra (en las dos modalidades)', () => {
  for (const modalidad of ['inscritos', 'externo']) {
    const s = { estado: ESTADOS_RETO.espera, modalidad }
    assert.strictEqual(puedeUnirse(s, null, T0, { cupo: null }).codigo, 'ACCESO_CERRADO', modalidad)
    assert.strictEqual(puedeUnirse({ ...s, accesoAbierto: false }, null, T0, { cupo: null }).codigo, 'ACCESO_CERRADO', modalidad)
  }
})

caso('abrir y cerrar: idempotentes; no se abre una competencia terminada', () => {
  const s = { estado: ESTADOS_RETO.espera, modalidad: 'externo' }
  const abierta = aplicar(s, abrirAcceso(s, T0))
  assert.strictEqual(abierta.accesoAbierto, true)
  assert.strictEqual(abrirAcceso(abierta, T0).patch, null)
  const cerrada = aplicar(abierta, cerrarAcceso(abierta))
  assert.strictEqual(cerrada.accesoAbierto, false)
  assert.strictEqual(cerrarAcceso(cerrada).patch, null)
  assert.strictEqual(abrirAcceso(sesionEnCurso(), cierra(9)).codigo, 'TERMINADA')
})

caso('cerrar el acceso no saca a nadie ni toca el reloj: el que ya está dentro reconecta y responde', () => {
  let s = sesionEnCurso({ modalidad: 'externo', accesoAbierto: true })
  s = aplicar(s, cerrarAcceso(s))
  assert.deepStrictEqual(cerrarAcceso({ ...s, accesoAbierto: true }).patch, { accesoAbierto: false }) // solo ese campo
  assert.strictEqual(faseReto(s, abre(4) + 10).fase, FASES_RETO.abierta)
  const dentro = { id: 'R_x1', unidoMs: T0 }
  assert.deepStrictEqual(puedeUnirse(s, dentro, abre(4) + 10), { ok: true, nuevo: false, cupoPatch: null })
  assert.strictEqual(puedeResponder(s, dentro, 4, abre(4) + 10).ok, true)
  assert.strictEqual(puedeUnirse(s, null, abre(4) + 10, { cupo: { ocupados: 3 } }).codigo, 'ACCESO_CERRADO')
})

caso('ingreso tardío mientras el acceso esté abierto (las anteriores valen 0)', () => {
  const s = sesionEnCurso({ modalidad: 'externo', accesoAbierto: true })
  const r = puedeUnirse(s, null, abre(6), { cupo: { ocupados: 5 } })
  assert.deepStrictEqual(r, { ok: true, nuevo: true, cupoPatch: { ocupados: 6 } })
})

// ── K. Tope de 40 participantes externos ───────────────────────────────────
grupo('K. Tope de 40 participantes externos')

const externaAbierta = () => ({ estado: ESTADOS_RETO.espera, modalidad: 'externo', accesoAbierto: true })

caso('el contador sube de uno en uno hasta 40 y después rechaza', () => {
  assert.deepStrictEqual(reservarCupo(null).patch, { ocupados: 1 }) // primer participante: el documento aún no existe
  assert.deepStrictEqual(reservarCupo({ ocupados: 39 }).patch, { ocupados: 40 })
  assert.strictEqual(reservarCupo({ ocupados: 40 }).codigo, 'CUPO_LLENO')
  assert.strictEqual(reservarCupo({ ocupados: 41 }).codigo, 'CUPO_LLENO')
  for (const malo of [{ ocupados: -1 }, { ocupados: 2.5 }, { ocupados: '3' }]) assert.strictEqual(reservarCupo(malo).codigo, 'CUPO_INVALIDO')
})

caso('60 entradas aplicadas una tras otra (como en transacciones): entran exactamente 40', () => {
  let cupo = null
  let entraron = 0
  let rechazados = 0
  for (let i = 0; i < 60; i++) {
    const r = puedeUnirse(externaAbierta(), null, T0, { cupo })
    if (r.ok) { cupo = { ...(cupo || {}), ...r.cupoPatch }; entraron++ } else { assert.strictEqual(r.codigo, 'CUPO_LLENO'); rechazados++ }
  }
  assert.deepStrictEqual([entraron, rechazados, cupo.ocupados], [40, 20, 40])
})

caso('un externo nuevo sin leer el contador se rechaza (el servidor no puede saltárselo)', () => {
  assert.strictEqual(puedeUnirse(externaAbierta(), null, T0).codigo, 'CUPO_SIN_LEER')
  assert.strictEqual(puedeUnirse(externaAbierta(), null, T0, { cupo: undefined }).codigo, 'CUPO_SIN_LEER')
})

caso('reconectar no gasta lugar; un reto de inscritos no usa cupos', () => {
  assert.deepStrictEqual(puedeUnirse(externaAbierta(), { id: 'R_x1' }, T0, { cupo: { ocupados: 40 } }), { ok: true, nuevo: false, cupoPatch: null })
  assert.deepStrictEqual(puedeUnirse({ ...externaAbierta(), modalidad: 'inscritos' }, null, T0), { ok: true, nuevo: true, cupoPatch: null })
})

caso('expulsar no libera el lugar: con 40 ocupados sigue lleno', () => {
  const r = expulsarParticipante({ id: 'R_x1' }, T0 + 5)
  assert.deepStrictEqual(r.patch, { expulsado: true, expulsadoMs: T0 + 5 })
  assert.ok(!('ocupados' in r.patch))
  assert.strictEqual(puedeUnirse(externaAbierta(), null, T0 + 6, { cupo: { ocupados: 40 } }).codigo, 'CUPO_LLENO')
  assert.strictEqual(expulsarParticipante({ id: 'R_x1', expulsado: true }, T0 + 9).patch, null) // dos veces: nada
  assert.strictEqual(expulsarParticipante(null, T0).codigo, 'NO_PARTICIPANTE')
})

// ── L. Tokens y participantes ──────────────────────────────────────────────
grupo('L. Tokens y participantes')

const HASH_A = 'a'.repeat(24) + '0123456789abcdef'.repeat(2) + 'b'.repeat(8)
const HASH_B = 'c'.repeat(64)

caso('formato del token y de su huella: 64 hexadecimales en minúsculas', () => {
  assert.strictEqual(formatoTokenValido(HASH_A), true)
  for (const malo of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), null, 123]) assert.strictEqual(formatoTokenValido(malo), false, String(malo))
})

caso('id del participante: inscrito por inscripción, externo por la huella; nunca mezclados', () => {
  assert.strictEqual(idParticipante({ codigo: 'COD', modalidad: 'inscritos', alumnoId: 'ST_JUAN' }), 'COD_ST_JUAN')
  assert.strictEqual(idParticipante({ codigo: 'COD', modalidad: 'externo', tokenHash: HASH_A }), `COD_x${HASH_A.slice(0, 40)}`)
  assert.notStrictEqual(idParticipante({ codigo: 'COD', modalidad: 'externo', tokenHash: HASH_A }), idParticipante({ codigo: 'COD', modalidad: 'externo', tokenHash: HASH_B }))
  // El mismo token siempre da el mismo id: mientras lo conserve, no se duplica.
  assert.strictEqual(idParticipante({ codigo: 'COD', modalidad: 'externo', tokenHash: HASH_A }), idParticipante({ codigo: 'COD', modalidad: 'externo', tokenHash: HASH_A }))
  assert.strictEqual(idParticipante({ codigo: 'COD', modalidad: 'externo', tokenHash: HASH_A, alumnoId: 'ST_JUAN' }), null)
  assert.strictEqual(idParticipante({ codigo: 'COD', modalidad: 'inscritos', alumnoId: 'ST_JUAN', tokenHash: HASH_A }), null)
  assert.strictEqual(idParticipante({ codigo: 'COD', modalidad: 'externo', tokenHash: 'corto' }), null)
  assert.strictEqual(idParticipante({ codigo: 'COD', modalidad: 'inscritos', alumnoId: 'a/b' }), null)
  assert.strictEqual(idParticipante({ codigo: 'COD', modalidad: 'otra', alumnoId: 'ST_JUAN' }), null)
})

caso('el registro de un externo no lleva ninguna identidad académica', () => {
  const r = registroParticipante({ codigo: 'COD', modalidad: 'externo', docenteId: 'T1', alias: 'Tigre', tokenHash: HASH_A, unidoMs: T0 })
  assert.deepStrictEqual(Object.keys(r).sort(), ['alias', 'docenteId', 'expulsado', 'id', 'modalidad', 'sesionId', 'tokenHash', 'unidoMs'])
  // Aunque el llamador pase nombre o inscripción, un externo no se registra con ellos.
  assert.strictEqual(registroParticipante({ codigo: 'COD', modalidad: 'externo', docenteId: 'T1', alias: 'Tigre', tokenHash: HASH_A, alumnoId: 'ST_JUAN', unidoMs: T0 }), null)
  const conNombre = registroParticipante({ codigo: 'COD', modalidad: 'externo', docenteId: 'T1', alias: 'Tigre', tokenHash: HASH_A, nombre: 'Juan Real', unidoMs: T0 })
  assert.ok(!('nombre' in conNombre) && !('alumnoId' in conNombre))
  assert.strictEqual(registroParticipante({ codigo: 'COD', modalidad: 'externo', docenteId: 'T1', tokenHash: HASH_A, unidoMs: T0 }), null) // sin alias
  const ins = registroParticipante({ codigo: 'COD', modalidad: 'inscritos', docenteId: 'T1', alumnoId: 'ST_JUAN', nombre: 'Juan Real', unidoMs: T0 })
  assert.strictEqual(ins.alumnoId, 'ST_JUAN')
  assert.ok(!('tokenHash' in ins))
  assert.strictEqual(registroParticipante({ codigo: 'COD', modalidad: 'inscritos', alumnoId: 'ST_JUAN', unidoMs: T0 }), null) // sin docente
})

caso('un token expulsado no vuelve a entrar ni a responder en esa sesión', () => {
  const s = sesionEnCurso({ modalidad: 'externo', accesoAbierto: true })
  const expulsado = { id: `COD_x${HASH_A.slice(0, 40)}`, expulsado: true, unidoMs: T0 }
  assert.strictEqual(puedeUnirse(s, expulsado, abre(2), { cupo: { ocupados: 1 } }).codigo, 'EXPULSADO')
  assert.strictEqual(puedeResponder(s, expulsado, 2, abre(2) + 10).codigo, 'EXPULSADO')
})

caso('alias de un externo: ofensivos, reservados y únicos (sin lista de nombres reales)', () => {
  const ocupados = [claveAlias('Tigre')]
  assert.strictEqual(validarAlias('Tigre', { esOfensivo, nombresProtegidos: [], ocupados }).codigo, 'OCUPADO')
  assert.strictEqual(validarAlias('pendejo', { esOfensivo, nombresProtegidos: [] }).codigo, 'OFENSIVO')
  assert.strictEqual(validarAlias('Docente', { esOfensivo, nombresProtegidos: [] }).codigo, 'RESERVADO')
  assert.strictEqual(validarAlias('Puma Veloz', { esOfensivo, nombresProtegidos: [], ocupados }).ok, true)
})

// ── M. Lo que ve cada participante al final ────────────────────────────────
grupo('M. Lo que ve cada participante al final')

function resultadosDe13() {
  const aciertos = [10, 9, 9, 8, 7, 7, 7, 6, 5, 5, 5, 3, 1]
  const clasificacion = asignarPosiciones(aciertos.map((a, i) => ({ participanteId: `R_${i}`, nombreVisible: `Alias ${String(i).padStart(2, '0')}`, aciertos: a, respondidas: 10 })))
  const detalle = Object.fromEntries(clasificacion.map((f) => [f.participanteId, [{ preguntaId: 'p0', opcionSeleccionada: 'b', respuestaCorrecta: 'b', acerto: true }]]))
  return { ok: true, realizadas: 10, interrumpida: null, sinResultados: false, clasificacion, expulsados: [], detalle }
}

caso('top: los puestos 1 a 10, con empates completos (aquí 11 filas)', () => {
  const v = vistaResultadosParticipante(resultadosDe13(), 'R_0', { modalidad: 'externo' })
  assert.deepStrictEqual(v.top.map((f) => f.posicion), [1, 2, 2, 4, 5, 5, 5, 8, 9, 9, 9])
  for (const f of v.top) assert.deepStrictEqual(Object.keys(f).sort(), ['aciertos', 'nombreVisible', 'posicion'])
})

caso('el participante ve su propia posición aunque quede fuera del top', () => {
  const v = vistaResultadosParticipante(resultadosDe13(), 'R_12', { modalidad: 'externo' })
  assert.deepStrictEqual(v.propia, { posicion: 13, nombreVisible: 'Alias 12', aciertos: 1 })
  assert.ok(!v.top.some((f) => f.posicion === 13))
})

caso('externo: nunca recibe la corrección ni las respuestas correctas', () => {
  const v = vistaResultadosParticipante(resultadosDe13(), 'R_3', { modalidad: 'externo' })
  assert.strictEqual('correccion' in v, false)
  const texto = JSON.stringify(v)
  assert.ok(!texto.includes('respuestaCorrecta') && !texto.includes('participanteId') && !texto.includes('R_3'))
})

caso('inscrito: recibe su corrección completa; sin modalidad, no', () => {
  const v = vistaResultadosParticipante(resultadosDe13(), 'R_3', { modalidad: 'inscritos' })
  assert.deepStrictEqual(v.correccion, [{ preguntaId: 'p0', opcionSeleccionada: 'b', respuestaCorrecta: 'b', acerto: true }])
  assert.strictEqual('correccion' in vistaResultadosParticipante(resultadosDe13(), 'R_3', {}), false)
})

caso('expulsado o terminado antes de empezar: sin posición propia', () => {
  const r = resultadosDe13()
  const expulsado = { ...r, clasificacion: r.clasificacion.filter((f) => f.participanteId !== 'R_5'), expulsados: [{ participanteId: 'R_5' }] }
  assert.strictEqual(vistaResultadosParticipante(expulsado, 'R_5', { modalidad: 'externo' }).propia, null)
  assert.deepStrictEqual(vistaResultadosParticipante({ ok: true, sinResultados: true, realizadas: 0 }, 'R_1', { modalidad: 'externo' }), { realizadas: 0, top: [], propia: null })
})

// ── N. Pausas, desconexión y fin de la competencia (sin caducidad) ─────────
// Los datos se conservan hasta que el docente borre el reto o la sesión: no hay barrido ni borrado automático.
grupo('N. Pausas, desconexión y fin de la competencia')

const DIA = 24 * 60 * 60 * 1000

caso('terminada (al concluir la última o por el docente): ya se pueden calcular resultados; en curso, no', () => {
  for (const modalidad of ['inscritos', 'externo']) {
    assert.strictEqual(puedeFinalizar(sesionEnCurso({ modalidad }), cierra(9)), true, modalidad)
    assert.strictEqual(puedeFinalizar(sesionEnCurso({ modalidad }), abre(3)), false, modalidad)
    assert.strictEqual(puedeFinalizar(terminar(sesionEnCurso({ modalidad }), abre(3)), abre(3) + 1), true, modalidad)
  }
})

caso('una pausa, por larga que sea, nunca termina ni finaliza la competencia: sigue pausada', () => {
  for (const modalidad of ['inscritos', 'externo']) {
    let s = sesionEnCurso({ modalidad })
    const P = abre(2) + 1000 // la pregunta 3 llevaba 1 s abierta
    s = aplicar(s, pausarReto(s, P))
    for (const espera of [DIA, 2 * DIA, 31 * DIA, 400 * DIA]) {
      assert.strictEqual(faseReto(s, P + espera).fase, FASES_RETO.pausada, `${modalidad} tras ${espera / DIA} días`)
      assert.strictEqual(puedeFinalizar(s, P + espera), false)
    }
  }
})

caso('tras una pausa larga el docente reanuda: continúa con el tiempo que faltaba', () => {
  let s = sesionEnCurso({ modalidad: 'externo' })
  const P = abre(2) + 1000
  s = aplicar(s, pausarReto(s, P))
  const R = P + 3 * DIA
  s = aplicar(s, reanudarReto(s, R))
  const f = faseReto(s, R)
  assert.strictEqual(f.fase, FASES_RETO.abierta)
  assert.strictEqual(f.indice, 2)
  assert.strictEqual(f.restanteMs, RETO_CFG.TIEMPO_RESPUESTA_MS - 1000)
  // Termina normalmente, corrida exactamente lo que duró la pausa.
  assert.strictEqual(puedeFinalizar(s, cierra(9) + 3 * DIA - 1), false)
  assert.strictEqual(puedeFinalizar(s, cierra(9) + 3 * DIA), true)
})

caso('tras una pausa larga el docente termina: la pregunta pausada no cuenta y ya se pueden calcular resultados', () => {
  let s = sesionEnCurso({ modalidad: 'externo' })
  const P = abre(2) + 1000
  s = aplicar(s, pausarReto(s, P))
  const t = P + 5 * DIA
  s = aplicar(s, terminarReto(s, t, CONF))
  assert.strictEqual(preguntasRealizadas(s), 2)
  assert.strictEqual(puedeFinalizar(s, t), true)
})

caso('desconexión del docente o del proyector: nadie consulta y la competencia sigue sola, sin terminar ni reiniciar', () => {
  const s = sesionEnCurso({ modalidad: 'inscritos' })
  // Sin ninguna llamada entre el inicio y la pregunta 8: el estado sale del reloj, no de quien lo consulta.
  assert.strictEqual(faseReto(s, abre(7) + 500).indice, 7)
  assert.strictEqual(puedeFinalizar(s, abre(7) + 500), false)
  assert.strictEqual(s.inicioMs, T0) // nada lo reinicia
})

caso('sin cierre por abandono ni caducidad: no existen reglas de borrado automático', () => {
  for (const nombre of ['PAUSA_ABANDONO_MS', 'RETENCION_EXTERNO_MS']) assert.strictEqual(nombre in RETO_CFG, false, nombre)
})

// ── O. Preguntas del reto (etapa 2) ────────────────────────────────────────
grupo('O. Preguntas del reto: compatibilidad, copia y las 10 preguntas')

const OM = { tipo: 'opcion_multiple', enunciado: '¿Cuál es el organelo de la respiración celular?', opciones: [{ id: 'a', texto: 'Núcleo' }, { id: 'b', texto: 'Mitocondria' }, { id: 'c', texto: 'Ribosoma' }], respuestaCorrecta: 'b', imagenUrl: null }
const VF = { tipo: 'verdadero_falso', enunciado: 'La célula vegetal tiene pared celular.', opciones: [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }], respuestaCorrecta: 'v' }

caso('compatibles: opción múltiple con respuesta correcta y verdadero/falso', () => {
  assert.deepStrictEqual(reactivoCompatibleReto(OM), { ok: true })
  assert.deepStrictEqual(reactivoCompatibleReto(VF), { ok: true })
})

caso('incompatibles, cada uno con su motivo (tipo, imagen, «Otra», opciones, clave, enunciado)', () => {
  const motivo = (r) => reactivoCompatibleReto(r).motivo
  assert.strictEqual(motivo({ ...OM, tipo: 'respuesta_corta' }), 'tipo')
  assert.strictEqual(motivo({ ...OM, tipo: 'subir_archivo' }), 'tipo')
  assert.strictEqual(motivo({ ...OM, imagenUrl: 'https://res.cloudinary.com/x.png' }), 'imagen')
  assert.strictEqual(motivo({ ...VF, imagenUrl: 'https://res.cloudinary.com/x.png' }), 'imagen')
  assert.strictEqual(motivo({ ...OM, opciones: [...OM.opciones, { id: 'o', texto: 'Otra', esOtra: true }] }), 'otra')
  assert.strictEqual(motivo({ ...OM, opciones: [{ id: 'a', texto: 'Solo una' }], respuestaCorrecta: 'a' }), 'opciones')
  assert.strictEqual(motivo({ ...OM, opciones: [{ id: 'a', texto: 'A' }, { id: 'a', texto: 'B' }], respuestaCorrecta: 'a' }), 'opciones')
  assert.strictEqual(motivo({ ...OM, respuestaCorrecta: 'z' }), 'clave')
  assert.strictEqual(motivo({ ...OM, respuestaCorrecta: null }), 'clave')
  assert.strictEqual(motivo({ ...VF, respuestaCorrecta: null }), 'clave')
  assert.strictEqual(motivo({ ...OM, enunciado: '   ' }), 'enunciado')
  for (const m of ['tipo', 'imagen', 'otra', 'opciones', 'clave', 'enunciado']) assert.ok(MOTIVOS_INCOMPATIBLE[m])
})

caso('copiar un reactivo existente: solo el contenido, sin tocar el original', () => {
  const original = JSON.parse(JSON.stringify(OM))
  const copia = preguntaRetoDesdeReactivo(OM, { orden: 4, origenBancoId: 'banco_1' })
  assert.deepStrictEqual(OM, original, 'el original no cambió')
  assert.deepStrictEqual(copia, {
    tipo: 'opcion_multiple', enunciado: OM.enunciado, ponderacion: 1, retroalimentacion: null, imagenUrl: null, orden: 4, origenBancoId: 'banco_1',
    opciones: [{ id: 'a', texto: 'Núcleo', esOtra: false }, { id: 'b', texto: 'Mitocondria', esOtra: false }, { id: 'c', texto: 'Ribosoma', esOtra: false }],
    respuestaCorrecta: 'b',
  })
  copia.opciones[0].texto = 'cambiado'
  assert.strictEqual(OM.opciones[0].texto, 'Núcleo', 'la copia no comparte objetos con el original')
  assert.deepStrictEqual(preguntaRetoDesdeReactivo(VF, { orden: 1 }).opciones, [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }])
  assert.strictEqual(preguntaRetoDesdeReactivo({ ...OM, imagenUrl: 'x' }), null)
  assert.strictEqual(preguntaRetoDesdeReactivo({ ...OM, tipo: 'respuesta_corta' }), null)
})

caso('la pregunta copiada se califica igual que en las evaluaciones (opción elegida contra la clave)', () => {
  const copia = preguntaRetoDesdeReactivo(OM, { orden: 1 })
  assert.strictEqual(esAcierto(copia, copia.respuestaCorrecta, 'b'), true)
  assert.strictEqual(esAcierto(copia, copia.respuestaCorrecta, 'a'), false)
  const vf = preguntaRetoDesdeReactivo(VF, { orden: 1 })
  assert.strictEqual(esAcierto(vf, vf.respuestaCorrecta, 'v'), true)
})

caso('propuesta de la IA → pregunta del reto (mismo armado que el editor de evaluaciones)', () => {
  let n = 0
  const nuevoId = () => `op${n++}`
  const om = preguntaRetoDesdePropuestaIA({ tipo: 'opcion_multiple', enunciado: ' ¿Organelo? ', opciones: ['Núcleo', 'Mitocondria', '', 'Ribosoma'], correcta: 1 }, { orden: 2, nuevoId })
  assert.deepStrictEqual(om.opciones.map((o) => o.texto), ['Núcleo', 'Mitocondria', 'Ribosoma'])
  assert.strictEqual(om.respuestaCorrecta, om.opciones[1].id)
  assert.strictEqual(om.enunciado, '¿Organelo?')
  assert.strictEqual(om.orden, 2)
  const vf = preguntaRetoDesdePropuestaIA({ tipo: 'verdadero_falso', enunciado: 'Afirmación', correcta: 'f' }, { orden: 3 })
  assert.strictEqual(vf.respuestaCorrecta, 'f')
  // La correcta quedó sin texto, o un tipo que el reto no admite: no se agrega.
  assert.strictEqual(preguntaRetoDesdePropuestaIA({ tipo: 'opcion_multiple', enunciado: 'X', opciones: ['A', '', 'C', 'D'], correcta: 1 }, { orden: 1 }), null)
  assert.strictEqual(preguntaRetoDesdePropuestaIA({ tipo: 'respuesta_corta', enunciado: 'X' }, { orden: 1 }), null)
  assert.match(nuevoIdOpcion(1_700_000_000_000, () => 0.123456789), /^o[0-9a-z]+$/)
})

caso('exactamente 10 preguntas compatibles para poder iniciar (D12)', () => {
  const diez = Array.from({ length: 10 }, (_, i) => ({ ...VF, id: `p${i}` }))
  assert.deepStrictEqual(estadoPreguntasReto(diez), { total: 10, faltan: 0, sobran: 0, incompatibles: 0, completo: true })
  assert.strictEqual(estadoPreguntasReto(diez.slice(0, 7)).faltan, 3)
  assert.strictEqual(estadoPreguntasReto(diez.slice(0, 7)).completo, false)
  assert.strictEqual(estadoPreguntasReto([...diez, { ...VF, id: 'p10' }]).sobran, 1)
  assert.strictEqual(estadoPreguntasReto([...diez.slice(0, 9), { ...OM, id: 'x', imagenUrl: 'img' }]).completo, false)
  assert.deepStrictEqual(estadoPreguntasReto(null), { total: 0, faltan: 10, sobran: 0, incompatibles: 0, completo: false })
})

caso('un reto nace en borrador, en un parcial, y en inscritos con «Calificable» apagado (S5, S6)', () => {
  const base = { nombre: '  Reto 1  ', parcial: 2, orden: 3, asignaturaId: 'S1', docenteId: 'T1' }
  const ins = datosNuevoReto({ ...base, modalidad: 'inscritos', modoIdentidad: 'nombre' })
  assert.ok(ins.ok)
  assert.deepStrictEqual(
    [ins.datos.nombre, ins.datos.categoria, ins.datos.oculta, ins.datos.publishAt, ins.datos.publishedAt, ins.datos.sinCalificacion, ins.datos.parcial, ins.datos.reto],
    ['Reto 1', 'reto', true, null, null, true, 2, { modalidad: 'inscritos', modoIdentidad: 'nombre', calificable: false }])
  const cal = datosNuevoReto({ ...base, modalidad: 'inscritos', modoIdentidad: 'alias', calificable: true })
  assert.deepStrictEqual([cal.datos.sinCalificacion, cal.datos.reto.calificable], [false, true])
  // Externo: aunque se pida calificable o nombre real, nace con alias, sin nota y no calificable.
  const ext = datosNuevoReto({ ...base, modalidad: 'externo', modoIdentidad: 'nombre', calificable: true })
  assert.ok(ext.ok)
  assert.deepStrictEqual([ext.datos.sinCalificacion, ext.datos.oculta, ext.datos.reto], [true, true, { modalidad: 'externo', modoIdentidad: 'alias', calificable: false }])
  assert.strictEqual(validarConfiguracionReto({ ...ext.datos.reto, sinCalificacion: ext.datos.sinCalificacion, oculta: ext.datos.oculta, publishAt: ext.datos.publishAt }).ok, true)
  assert.strictEqual(datosNuevoReto({ ...base, nombre: ' ', modalidad: 'inscritos', modoIdentidad: 'nombre' }).codigo, 'SIN_NOMBRE')
  assert.strictEqual(datosNuevoReto({ ...base, parcial: 0, modalidad: 'inscritos', modoIdentidad: 'nombre' }).codigo, 'SIN_PARCIAL')
  assert.strictEqual(datosNuevoReto({ ...base, modalidad: 'publico', modoIdentidad: 'nombre' }).codigo, 'MODALIDAD_INVALIDA')
})

caso('editar los datos: la modalidad nunca; un externo sigue con alias y sin calificación', () => {
  const ins = { reto: { modalidad: 'inscritos', modoIdentidad: 'nombre', calificable: false } }
  assert.deepStrictEqual(cambiosDatosReto(ins, { nombre: ' Nuevo ', calificable: true, modoIdentidad: 'alias' }).patch,
    { nombre: 'Nuevo', 'reto.modoIdentidad': 'alias', 'reto.calificable': true, sinCalificacion: false })
  assert.deepStrictEqual(cambiosDatosReto(ins, { calificable: false }).patch, { 'reto.calificable': false, sinCalificacion: true })
  assert.strictEqual(cambiosDatosReto(ins, { nombre: '' }).codigo, 'SIN_NOMBRE')
  const ext = { reto: { modalidad: 'externo', modoIdentidad: 'alias', calificable: false } }
  assert.deepStrictEqual(cambiosDatosReto(ext, { nombre: 'Práctica', instrucciones: 'Rápido' }).patch, { nombre: 'Práctica', instrucciones: 'Rápido' })
  assert.strictEqual(cambiosDatosReto(ext, { calificable: true }).codigo, 'EXTERNO_FIJO')
  assert.strictEqual(cambiosDatosReto(ext, { modoIdentidad: 'nombre' }).codigo, 'EXTERNO_FIJO')
  assert.strictEqual(cambiosDatosReto({}, { nombre: 'x' }).codigo, 'MODALIDAD_INVALIDA')
  assert.ok(!('modalidad' in cambiosDatosReto(ins, { nombre: 'x', modalidad: 'externo' }).patch))
})

// ── P. Copias y etiqueta de créditos ───────────────────────────────────────
grupo('P. Copias y etiqueta de créditos')

caso('ningún reto se copia ni se duplica (S2); las demás actividades, igual que antes', () => {
  assert.strictEqual(esCopiable({ categoria: 'reto', reto: { modalidad: 'inscritos' } }), false)
  assert.strictEqual(esCopiable({ categoria: 'reto', reto: { modalidad: 'externo' } }), false)
  assert.strictEqual(esCopiable({ categoria: 'participacion' }), false)
  for (const categoria of ['entregable', 'cuestionario', 'examen', 'observacion', undefined]) assert.strictEqual(esCopiable({ categoria }), true, String(categoria))
  assert.strictEqual(esCopiable({ categoria: 'juego', juego: { estado: 'juego_confirmado' } }), true)
  assert.strictEqual(esCopiable({ categoria: 'juego', juego: { estado: null } }), false)
})

caso('«Reto Exprés» solo con detalle.funcion === "reto"; los demás nombres no cambian', () => {
  assert.strictEqual(tituloMovimiento({ tipo: 'consumo', operacion: 'reactivos', detalle: { funcion: 'reto', reservado: 10 } }), 'Reto Exprés')
  assert.strictEqual(tituloMovimiento({ tipo: 'consumo', operacion: 'reactivos' }), 'Reactivos con IA')
  assert.strictEqual(tituloMovimiento({ tipo: 'consumo', operacion: 'reactivos', detalle: { funcion: 'otra' } }), 'Reactivos con IA')
  assert.strictEqual(tituloMovimiento({ tipo: 'consumo', operacion: 'crear_evaluacion_ia', detalle: { funcion: 'reto' } }), 'Evaluación creada con IA')
  assert.strictEqual(tituloMovimiento({ tipo: 'consumo', operacion: 'calificar_entregable_ia' }), 'Calificación de evidencias')
  assert.strictEqual(tituloMovimiento({ tipo: 'consumo', operacion: 'rubrica' }), 'Rúbrica con IA')
  assert.strictEqual(tituloMovimiento({ tipo: 'compra' }), 'Compra de créditos')
})

// ── Q. Etapa 5: notas propuestas de una sesión ──────────────────────────────
const RQ = { modalidad: 'inscritos', calificable: true }
const resQ = (extra = {}) => ({
  ok: true, realizadas: 10, sinResultados: false, modalidad: 'inscritos',
  clasificacion: [
    { participanteId: 'C_ana', posicion: 1, aciertos: 9 },
    { participanteId: 'C_beto', posicion: 2, aciertos: 6 },
    { participanteId: 'C_caro', posicion: 3, aciertos: 0 },
  ],
  expulsados: [{ participanteId: 'C_dani', aciertos: 10 }],
  ...extra,
})
const partQ = [
  { id: 'C_ana', alumnoId: 'ana' }, { id: 'C_beto', alumnoId: 'beto' }, { id: 'C_caro', alumnoId: 'caro' },
  { id: 'C_dani', alumnoId: 'dani', expulsado: true },
]

caso('Q · una nota por inscrito que participó: aciertos ÷ realizadas × máxima; el retirado no recibe nota', () => {
  const p = propuestasCalificacionReto({ reto: RQ, maxCalif: 10, resultados: resQ(), participantes: partQ })
  assert.deepStrictEqual(p.map((x) => [x.alumnoId, x.calificacion]), [['ana', 9], ['beto', 6], ['caro', 0]])
  assert.ok(!p.some((x) => x.alumnoId === 'dani'))
})

caso('Q · terminación anticipada: proporción sobre las realizadas, con la máxima de la actividad', () => {
  const p = propuestasCalificacionReto({ reto: RQ, maxCalif: 100, resultados: resQ({ realizadas: 4, clasificacion: [{ participanteId: 'C_ana', aciertos: 3 }] }), participantes: partQ })
  assert.deepStrictEqual(p, [{ alumnoId: 'ana', participanteId: 'C_ana', aciertos: 3, realizadas: 4, calificacion: 75 }])
})

caso('Q · nunca una nota: reto externo, de práctica, sin modalidad, sin clasificación o sin resultados', () => {
  const base = { maxCalif: 10, resultados: resQ(), participantes: partQ }
  assert.deepStrictEqual(propuestasCalificacionReto({ ...base, reto: { modalidad: 'externo', calificable: true } }), [])
  assert.deepStrictEqual(propuestasCalificacionReto({ ...base, reto: { modalidad: 'inscritos', calificable: false } }), [])
  assert.deepStrictEqual(propuestasCalificacionReto({ ...base, reto: {} }), [])
  assert.deepStrictEqual(propuestasCalificacionReto({ ...base, reto: RQ, resultados: resQ({ modalidad: 'externo' }) }), [])
  assert.deepStrictEqual(propuestasCalificacionReto({ ...base, reto: RQ, resultados: resQ({ realizadas: 0, sinResultados: true, clasificacion: [] }) }), [])
  assert.deepStrictEqual(propuestasCalificacionReto({ ...base, reto: RQ, resultados: null }), [])
})

caso('Q · sin inscripción conocida no hay nota (participante ausente de la lista o sin alumnoId)', () => {
  const p = propuestasCalificacionReto({ reto: RQ, resultados: resQ(), participantes: [{ id: 'C_ana', alumnoId: 'ana' }, { id: 'C_beto' }] })
  assert.deepStrictEqual(p.map((x) => x.alumnoId), ['ana'])
})

console.log(`\n${pasadas} pasaron, ${fallos} fallaron`)
if (fallos) process.exit(1)
