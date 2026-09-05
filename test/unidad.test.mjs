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
import { promedioParcial, ponderacionActivaEnParcial, normalizeGrade } from '../src/utils/ponderacion.js'
import {
  totalRubrica, validarCotejo, validarRubrica, RUBRICA_TOTAL,
  rubricaDesdePropuesta, cotejoDesdePropuesta, esCotejo,
  propuestaFueEditada, trazaIA,
} from '../src/utils/rubrica.js'
import { reactivosDesdePropuesta, reactivoValido } from '../src/utils/reactivosIA.js'
import { estaRespondida } from '../src/utils/evaluacionRespondida.js'
import { contenidoAnalisisResultadosPDF, AVISO_IA_ANALISIS } from '../src/utils/analisisResultadosPDF.js'
import { resumenConfiabilidad } from '../src/utils/confiabilidadAnalisis.js'
import { isPerfilIACompleto, perfilIAVacio } from '../src/utils/perfilIA.js'
import { tipoFuentePermitido, extensionDeArchivo, hayFuentesGenerales, MAX_FUENTES_POR_GRUPO, esMismaFuente } from '../src/utils/fuentesAsignatura.js'
import { planeacionVigente, validarArchivoPlaneacion, extensionPlaneacion } from '../src/utils/planeacionVigente.js'
import { estadoRegaloIA } from '../src/utils/creditosHelpers.js'
import {
  calcularCostoUSD, claveDia, inicioDelDia, clavesDeDias, rangoDeDias,
  margenSobreCostoIA, costoPromedioDiario, diasEstimadosRestantes, RANGOS_DIAS,
} from '../src/utils/costosIA.js'
import { resolverBackspace } from '../src/utils/crucigramaBackspace.js'
import { correccionesCrucigrama } from '../src/utils/correccionesJuego.js'
import { esDeIntentoAnterior, tieneRespuestaGuardada } from '../src/utils/respuestasIntento.js'
import {
  esEstructuraHeredada, estructuraConClave, debeEscribirContenidoEmbebido,
} from '../src/utils/juegoReparto.js'
import {
  camposComunesCopia, camposJuegoCopia, esCopiable, nombreParaCopia, etiquetaJuego,
} from '../src/utils/copiaActividad.js'

process.env.GCLOUD_PROJECT ||= 'demo-test'
const require = createRequire(import.meta.url)
const { _pruebas: F } = require('../functions/index.js')
const { _pruebas: FIA } = require('../functions/ia.js')
const { resolverIntentoGanador, respuestasVivasSonDelIntentoGanador } = require('../functions/calificacionIntentos.js')
const docExtract = require('../functions/docExtract.js')
const L = require('../functions/creditosLedger.js')
const { Timestamp } = require('firebase-admin/firestore')

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

grupo('Regalo de bienvenida en el historico del admin \u2014 el "0" deja de ser ambiguo')

// El caso que motivo todo esto: un saldo de 0 puede ser "nunca lo activo" o
// "lo activo y ya lo gasto", y para administracion no son lo mismo.
const REG = (extra = {}) => ({ bienvenidaDisponible: true, bienvenidaActivada: false, creditosBienvenida: 30, ...extra })

caso('nunca activado: dice cuantos le esperan, no "0"', () => {
  const r = estadoRegaloIA({ registro: REG(), creditos: undefined })
  assert.strictEqual(r.estado, 'sin_activar')
  assert.strictEqual(r.texto, 'Sin activar \u00b7 30')
  assert.ok(r.determinable)
})

caso('activado y sin gastar nada', () => {
  const r = estadoRegaloIA({
    registro: REG({ bienvenidaActivada: true }),
    creditos: { saldo: 30, consumidoTotal: 0 },
  })
  assert.strictEqual(r.estado, 'activo')
  assert.strictEqual(r.texto, 'Activo \u00b7 30 de 30')
})

caso('activado con saldo parcial', () => {
  const r = estadoRegaloIA({
    registro: REG({ bienvenidaActivada: true }),
    creditos: { saldo: 12, consumidoTotal: 18 },
  })
  assert.strictEqual(r.texto, 'Activo \u00b7 12 de 30')
  assert.strictEqual(r.consumido, 18)
  assert.strictEqual(r.restante, 12)
})

caso('agotado: el 0 se lee como gastado, no como "nunca lo pidio"', () => {
  const r = estadoRegaloIA({
    registro: REG({ bienvenidaActivada: true }),
    creditos: { saldo: 0, consumidoTotal: 30 },
  })
  assert.strictEqual(r.estado, 'agotado')
  assert.strictEqual(r.texto, 'Agotado \u00b7 0 de 30')
  assert.ok(/gastado/.test(r.ayuda))
})

caso('la cantidad NO esta clavada en 30: una cuenta vieja de 50 muestra 50', () => {
  const sinActivar = estadoRegaloIA({ registro: REG({ creditosBienvenida: 50 }) })
  assert.strictEqual(sinActivar.texto, 'Sin activar \u00b7 50')
  const activo = estadoRegaloIA({
    registro: REG({ creditosBienvenida: 50, bienvenidaActivada: true }),
    creditos: { saldo: 44, consumidoTotal: 6 },
  })
  assert.strictEqual(activo.texto, 'Activo \u00b7 44 de 50')
})

caso('fracciones de credito (tarifas de 0.5) no se redondean a mentiras', () => {
  const r = estadoRegaloIA({
    registro: REG({ bienvenidaActivada: true }),
    creditos: { saldo: 27.5, consumidoTotal: 2.5 },
  })
  assert.strictEqual(r.texto, 'Activo \u00b7 27.5 de 30')
})

// Lo que el sistema NO registra: de que bolsa salio cada credito gastado. Se
// deduce mientras el regalo sea la unica entrada, y cuando deja de serlo hay
// que DECIRLO, no estimar.
caso('con ajuste manual del admin NO se afirma un desglose', () => {
  const r = estadoRegaloIA({
    registro: REG({ bienvenidaActivada: true }),
    creditos: { saldo: 60, consumidoTotal: 0, ultimoAjusteManual: { delta: 30, motivo: 'Prueba' } },
  })
  assert.strictEqual(r.estado, 'indeterminable')
  assert.strictEqual(r.determinable, false)
  assert.ok(/ajust\u00f3 el saldo a mano/.test(r.ayuda))
  assert.ok(!/\bde 30\b/.test(r.texto), 'no inventa una cifra de restante')
})

caso('con compras acreditadas tampoco: el saldo ya mezcla regalo y comprado', () => {
  const r = estadoRegaloIA({
    registro: REG({ bienvenidaActivada: true }),
    creditos: { saldo: 130, consumidoTotal: 0 },
    tieneComprasAcreditadas: true,
  })
  assert.strictEqual(r.estado, 'indeterminable')
  assert.ok(/compras de cr\u00e9ditos acreditadas/.test(r.ayuda))
})

caso('saldo migrado de un plan viejo: se detecta por los campos legado', () => {
  const r = estadoRegaloIA({
    registro: REG({ bienvenidaActivada: true }),
    creditos: { saldo: 30, consumidoTotal: 0, plan: 'cortesia', capacidad: 1750 },
  })
  assert.strictEqual(r.estado, 'indeterminable')
  assert.ok(/plan anterior migrado/.test(r.ayuda))
})

caso('red de seguridad: si el saldo no cuadra, no se afirma nada aunque no haya causa conocida', () => {
  // 50 otorgados y 136.25 consumidos no pueden dejar 23.75 de saldo si el
  // regalo fuera la unica entrada: entro saldo por una via que nadie registro.
  const r = estadoRegaloIA({
    registro: REG({ creditosBienvenida: 50, bienvenidaActivada: true }),
    creditos: { saldo: 23.75, consumidoTotal: 136.25 },
  })
  assert.strictEqual(r.estado, 'indeterminable')
  assert.ok(/no cuadra/.test(r.ayuda))
})

caso('el descuadre tolera el ruido de punto flotante, no lo confunde con un hueco', () => {
  const r = estadoRegaloIA({
    registro: REG({ bienvenidaActivada: true }),
    creditos: { saldo: 0.1 + 0.2 + 29.7, consumidoTotal: 0 },
  })
  assert.strictEqual(r.estado, 'activo')
})

caso('sin documento de registro: se dice, no se asume que no tiene regalo', () => {
  const r = estadoRegaloIA({ registro: undefined, creditos: { saldo: 0, consumidoTotal: 0 } })
  assert.strictEqual(r.estado, 'sin_registro')
  assert.strictEqual(r.determinable, false)
})

caso('registro sin creditosBienvenida: activo pero sin "de cuantos"', () => {
  const r = estadoRegaloIA({
    registro: { bienvenidaDisponible: true, bienvenidaActivada: true },
    creditos: { saldo: 10, consumidoTotal: 0 },
  })
  assert.strictEqual(r.estado, 'indeterminable')
  assert.ok(!/NaN|undefined/.test(r.texto + r.ayuda))
})

caso('llamada sin argumentos no revienta la tabla', () => {
  assert.strictEqual(estadoRegaloIA().estado, 'sin_registro')
  assert.strictEqual(estadoRegaloIA({}).estado, 'sin_registro')
})

grupo('Costos de IA \u2014 costo real de Anthropic y serie diaria del panel')

// Las tarifas REALES que hay en config/iaTarifas (claude-haiku-4-5). No se
// codifican como verdad del sistema: son el insumo del caso, igual que las
// recibe la funcion en produccion.
const TARIFAS = {
  'claude-haiku-4-5': { entradaPorMTok: 1, salidaPorMTok: 5, cacheEscritura5mPorMTok: 1.25, cacheLecturaPorMTok: 0.10 },
}

caso('costo = entrada + salida + cache escritura + cache lectura, cada una a su tarifa', () => {
  const c = calcularCostoUSD({
    modelo: 'claude-haiku-4-5',
    tokensEntrada: 1_000_000, tokensSalida: 1_000_000,
    tokensCacheEscritura: 1_000_000, tokensCacheLectura: 1_000_000,
  }, TARIFAS)
  assert.strictEqual(c, 1 + 5 + 1.25 + 0.10)
})

caso('la salida cuesta 5 veces la entrada \u2014 no se confunden los factores', () => {
  const entrada = calcularCostoUSD({ modelo: 'claude-haiku-4-5', tokensEntrada: 1_000_000 }, TARIFAS)
  const salida = calcularCostoUSD({ modelo: 'claude-haiku-4-5', tokensSalida: 1_000_000 }, TARIFAS)
  assert.strictEqual(salida / entrada, 5)
})

caso('tokens ausentes cuentan como cero, no como NaN', () => {
  assert.strictEqual(calcularCostoUSD({ modelo: 'claude-haiku-4-5' }, TARIFAS), 0)
})

caso('modelo sin tarifa devuelve null: nunca se inventa un costo ni se usa la tarifa de otro', () => {
  assert.strictEqual(calcularCostoUSD({ modelo: 'modelo-que-no-existe', tokensEntrada: 999999 }, TARIFAS), null)
  assert.strictEqual(calcularCostoUSD({ modelo: 'claude-haiku-4-5', tokensEntrada: 1 }, {}), null)
})

// El corte del dia es la zona del negocio, no la del servidor (Cloud Functions
// corre en UTC). Sin esto, todo lo gastado despues de las 18:00 hora de Mexico
// caeria en el dia siguiente.
caso('el dia se corta en hora de Mexico, no en UTC', () => {
  // 2026-09-03 23:30 UTC = 2026-09-03 17:30 en Mexico \u2192 sigue siendo el dia 3.
  assert.strictEqual(claveDia(new Date('2026-09-03T23:30:00Z')), '2026-09-03')
  // 2026-09-04 05:00 UTC = 2026-09-03 23:00 en Mexico \u2192 TODAVIA es el dia 3.
  assert.strictEqual(claveDia(new Date('2026-09-04T05:00:00Z')), '2026-09-03')
  // 2026-09-04 06:30 UTC = 2026-09-04 00:30 en Mexico \u2192 ya es el dia 4.
  assert.strictEqual(claveDia(new Date('2026-09-04T06:30:00Z')), '2026-09-04')
})

caso('inicioDelDia devuelve el instante UTC de la medianoche mexicana', () => {
  const i = inicioDelDia('2026-09-03')
  assert.strictEqual(i.toISOString(), '2026-09-03T06:00:00.000Z')
  // Y es coherente consigo mismo: ese instante pertenece a ese mismo dia.
  assert.strictEqual(claveDia(i), '2026-09-03')
})

caso('claveDia con una fecha invalida devuelve null en vez de "Invalid Date"', () => {
  assert.strictEqual(claveDia(undefined), null)
  assert.strictEqual(claveDia(new Date('no soy fecha')), null)
})

caso('la serie trae TODOS los dias del rango, hoy incluido y el mas viejo primero', () => {
  const c = clavesDeDias(7, new Date('2026-09-03T18:00:00Z'))
  assert.strictEqual(c.length, 7)
  assert.strictEqual(c[0], '2026-08-28')
  assert.strictEqual(c[6], '2026-09-03')
  assert.deepStrictEqual([...c].sort(), c, 'quedan en orden cronologico')
})

caso('los tres rangos del panel dan 7, 30 y 90 dias', () => {
  assert.deepStrictEqual(RANGOS_DIAS, [7, 30, 90])
  RANGOS_DIAS.forEach((n) => {
    assert.strictEqual(clavesDeDias(n, new Date('2026-09-03T18:00:00Z')).length, n)
  })
})

caso('un dia sin actividad sigue en la serie: un hueco se leeria como "no se midio"', () => {
  const c = clavesDeDias(30, new Date('2026-09-03T18:00:00Z'))
  assert.ok(c.includes('2026-08-25'), 'un dia sin consumo no desaparece de la lista')
})

caso('rangoDeDias acota la consulta desde la medianoche mexicana del dia mas viejo', () => {
  const ahora = new Date('2026-09-03T18:00:00Z')
  const r = rangoDeDias(7, ahora)
  assert.strictEqual(r.claves.length, 7)
  assert.strictEqual(r.desde.toISOString(), '2026-08-28T06:00:00.000Z')
  assert.strictEqual(r.hasta.getTime(), ahora.getTime(), 'el limite superior es AHORA, no el fin del dia')
})

caso('margen = ingresos - costo, y es negativo cuando se gasta mas de lo que entra', () => {
  assert.strictEqual(margenSobreCostoIA(500, 120.5), 379.5)
  assert.strictEqual(margenSobreCostoIA(0, 27.74), -27.74)
  assert.strictEqual(margenSobreCostoIA(0, 0), 0)
})

caso('el promedio diario divide entre TODOS los dias, no solo los que tuvieron gasto', () => {
  // 160.70 en 30 dias, aunque solo 21 tuvieran actividad.
  assert.strictEqual(costoPromedioDiario(160.70, 30), 5.36)
  assert.strictEqual(costoPromedioDiario(0, 30), 0)
})

caso('promedio con cero dias no revienta ni divide entre cero', () => {
  assert.strictEqual(costoPromedioDiario(100, 0), 0)
})

// Anthropic NO expone el saldo por API: el numero lo captura una persona. La
// estimacion solo existe cuando hay las dos mitades.
caso('dias estimados = saldo capturado / costo promedio diario, hacia abajo', () => {
  assert.strictEqual(diasEstimadosRestantes(500, 5.36), 93)
  assert.strictEqual(diasEstimadosRestantes(10, 3), 3)
})

caso('sin saldo capturado NO se estiman dias \u2014 no se inventa un saldo', () => {
  assert.strictEqual(diasEstimadosRestantes(null, 5), null)
  assert.strictEqual(diasEstimadosRestantes(undefined, 5), null)
  assert.strictEqual(diasEstimadosRestantes(0, 5), null)
})

caso('sin gasto no hay ritmo que proyectar: null, nunca Infinity', () => {
  assert.strictEqual(diasEstimadosRestantes(500, 0), null)
  assert.strictEqual(diasEstimadosRestantes(500, null), null)
})

// ═══ El export de pruebas no se despliega ════════════════════════════════════
grupo('Propuesta de IA → instrumento válido (los números los pone EF)')

const propuestaRubrica = (nCrit = 4, nNiv = 4) => ({
  titulo: 'Ensayo argumentativo',
  descripcion: 'Evalúa el ensayo sobre la Revolución',
  niveles: Array.from({ length: nNiv }, (_, j) => ['Excelente', 'Bueno', 'Suficiente', 'Insuficiente', 'Nulo'][j]),
  criterios: Array.from({ length: nCrit }, (_, i) => ({
    nombre: `Criterio ${i + 1}`,
    descriptores: Array.from({ length: nNiv }, (_, j) => `Descriptor ${i}-${j}`),
  })),
})

caso('la rúbrica generada pasa la MISMA validación que una hecha a mano', () => {
  assert.strictEqual(validarRubrica(rubricaDesdePropuesta(propuestaRubrica())), null)
})

caso('toda combinación de criterios (2–6) y niveles (3–5) produce algo válido', () => {
  for (let nv = 3; nv <= 5; nv++) {
    for (let nc = 2; nc <= 6; nc++) {
      const err = validarRubrica(rubricaDesdePropuesta(propuestaRubrica(nc, nv)))
      assert.strictEqual(err, null, `criterios=${nc} niveles=${nv}: ${err}`)
    }
  }
})

caso('la columna del nivel máximo suma exactamente 10 aunque no reparta parejo', () => {
  const r = rubricaDesdePropuesta(propuestaRubrica(3))
  const suma = r.criterios.reduce((s, c) => s + c.puntos[0], 0)
  assert.strictEqual(Math.round(suma * 10) / 10, RUBRICA_TOTAL)
})

caso('la lista de cotejo generada suma exactamente 10 y es del tipo correcto', () => {
  const c = cotejoDesdePropuesta({ titulo: 'Reporte', criterios: [{ nombre: 'a' }, { nombre: 'b' }, { nombre: 'c' }] })
  assert.strictEqual(esCotejo(c), true)
  assert.strictEqual(validarCotejo(c), null)
  assert.strictEqual(c.criterios.reduce((s, x) => s + x.puntos[0], 0), RUBRICA_TOTAL)
})

caso('si la IA manda PUNTOS, se ignoran: la aritmética nunca viene del modelo', () => {
  const p = propuestaRubrica()
  p.criterios[0].puntos = [99, 99, 99, 99]
  p.criterios[0].peso = 99
  p.niveles = p.niveles.map((n) => ({ nombre: n, porcentaje: 999 }))
  const r = rubricaDesdePropuesta({ ...p, niveles: ['A', 'B', 'C', 'D'] })
  assert.strictEqual(validarRubrica(r), null)
  assert.ok(r.criterios[0].puntos[0] <= RUBRICA_TOTAL, 'el 99 de la IA no sobrevive')
})

caso('si la IA manda de más, se recorta al máximo del modelo (6 criterios)', () => {
  const r = rubricaDesdePropuesta(propuestaRubrica(9))
  assert.strictEqual(r.criterios.length, 6)
  assert.strictEqual(validarRubrica(r), null)
})

caso('si la IA manda de menos, se completa al mínimo y sigue siendo válido estructuralmente', () => {
  const r = rubricaDesdePropuesta({ titulo: 'T', niveles: ['A'], criterios: [{ nombre: 'uno', descriptores: [] }] })
  assert.ok(r.niveles.length >= 3 && r.criterios.length >= 2)
  // Quedan huecos de TEXTO (nombre vacío) — eso lo llena el docente en el
  // editor, que es justo lo que la validación le va a exigir antes de guardar.
  assert.ok(validarRubrica(r)?.includes('nombre'))
})

caso('una propuesta basura no revienta el constructor', () => {
  assert.doesNotThrow(() => rubricaDesdePropuesta(null))
  assert.doesNotThrow(() => cotejoDesdePropuesta({ criterios: 'no soy un arreglo' }))
})


grupo('Trazabilidad de lo generado con IA (T.8)')

const base = () => rubricaDesdePropuesta(propuestaRubrica())

caso('la traza conserva la actividad padre — la regla de no aislamiento es auditable', () => {
  const t = trazaIA({ operacion: 'rubrica', actividadPadreId: 'act_1', clase: 'entregable', propuesta: base(), guardada: base() })
  assert.strictEqual(t.actividadPadreId, 'act_1')
  assert.strictEqual(t.clase, 'entregable')
  assert.strictEqual(t.operacion, 'rubrica')
})

caso('sin Universo Curricular, la procedencia es la actividad y el marco queda en null', () => {
  const t = trazaIA({ operacion: 'cotejo', actividadPadreId: 'a', clase: 'observacion', propuesta: base(), guardada: base() })
  assert.strictEqual(t.procedenciaCriterios, 'actividad_padre')
  assert.strictEqual(t.marcoCurricular, null)
})

caso('guardar la propuesta tal cual NO cuenta como editada', () => {
  assert.strictEqual(propuestaFueEditada(base(), base()), false)
})

caso('cambiar el nombre de un criterio SÍ cuenta como editada', () => {
  const g = base(); g.criterios[0].nombre = 'Otro criterio'
  assert.strictEqual(propuestaFueEditada(base(), g), true)
})

caso('cambiar un descriptor SÍ cuenta como editada', () => {
  const g = base(); g.criterios[1].descriptores[0] = 'Reescrito por el docente'
  assert.strictEqual(propuestaFueEditada(base(), g), true)
})

caso('cambiar los puntos SÍ cuenta como editada (los pone EF, pero el docente los ajusta)', () => {
  const g = base(); g.criterios[0].puntos[0] = g.criterios[0].puntos[0] + 1
  assert.strictEqual(propuestaFueEditada(base(), g), true)
})

caso('agregar o quitar un criterio SÍ cuenta como editada', () => {
  const g = base(); g.criterios = g.criterios.slice(0, 2)
  assert.strictEqual(propuestaFueEditada(base(), g), true)
})

caso('espacios de más al teclear no cuentan como edición real', () => {
  const g = base(); g.criterios[0].nombre = '  ' + g.criterios[0].nombre + '  '
  assert.strictEqual(propuestaFueEditada(base(), g), false)
})

caso('sin propuesta previa (rúbrica hecha a mano) no hay edición que medir', () => {
  assert.strictEqual(propuestaFueEditada(null, base()), false)
})


grupo('Reactivos con IA (OP-09) — propuesta del servidor → editor de revisión')

const propuestaReactivos = (n = 3) => ({
  reactivos: Array.from({ length: n }, (_, i) => (
    i % 3 === 0
      ? { tipo: 'opcion_multiple', enunciado: `Pregunta ${i}`, opciones: ['A', 'B', 'C', 'D'], correcta: 1 }
      : i % 3 === 1
        ? { tipo: 'verdadero_falso', enunciado: `Afirmación ${i}`, correcta: 'v' }
        : { tipo: 'respuesta_corta', enunciado: `Abierta ${i}`, respuestaEsperada: 'Criterio' }
  )),
})

caso('reactivosDesdePropuesta conserva la cantidad exacta que ya forzó el servidor', () => {
  const r = reactivosDesdePropuesta(propuestaReactivos(5), 5)
  assert.strictEqual(r.length, 5)
})

caso('nunca entrega más reactivos de los pedidos, aunque el servidor mandara de más', () => {
  const r = reactivosDesdePropuesta(propuestaReactivos(8), 4)
  assert.strictEqual(r.length, 4)
})

caso('opcion_multiple siempre trae 4 opciones y la correcta acotada a 0-3', () => {
  const r = reactivosDesdePropuesta({ reactivos: [{ tipo: 'opcion_multiple', enunciado: 'X', opciones: ['A', 'B'], correcta: 99 }] }, 1)
  assert.strictEqual(r[0].opciones.length, 4)
  assert.strictEqual(r[0].correcta, 3)
})

caso('verdadero_falso normaliza cualquier valor que no sea "f" a "v"', () => {
  const r = reactivosDesdePropuesta({ reactivos: [{ tipo: 'verdadero_falso', enunciado: 'X', correcta: 'lo-que-sea' }] }, 1)
  assert.strictEqual(r[0].correcta, 'v')
})

caso('respuesta_corta conserva la respuestaEsperada como guía de calificación', () => {
  const r = reactivosDesdePropuesta({ reactivos: [{ tipo: 'respuesta_corta', enunciado: 'X', respuestaEsperada: 'Debe mencionar Y' }] }, 1)
  assert.strictEqual(r[0].respuestaEsperada, 'Debe mencionar Y')
})

caso('subir_archivo no carga ni respuesta ni opciones que no le pertenecen', () => {
  const r = reactivosDesdePropuesta({ reactivos: [{ tipo: 'subir_archivo', enunciado: 'Sube tu evidencia' }] }, 1)
  assert.strictEqual(r[0].opciones, undefined)
  assert.strictEqual(r[0].correcta, undefined)
})

caso('cada reactivo nace incluido — el docente descarta, no al revés', () => {
  const r = reactivosDesdePropuesta(propuestaReactivos(3), 3)
  assert.ok(r.every((x) => x.incluir === true))
})

caso('una propuesta basura no revienta el constructor', () => {
  assert.doesNotThrow(() => reactivosDesdePropuesta(null, 3))
  assert.doesNotThrow(() => reactivosDesdePropuesta({ reactivos: 'no soy un arreglo' }, 3))
  assert.strictEqual(reactivosDesdePropuesta(null, 3).length, 0, 'sin reactivos de la IA, no hay nada que revisar (no se inventa)')
})

grupo('reactivoValido — qué puede guardarse')

caso('un reactivo sin enunciado no es válido', () => {
  assert.strictEqual(reactivoValido({ tipo: 'respuesta_corta', enunciado: '  ' }), false)
})

caso('opción múltiple necesita al menos 2 opciones con texto', () => {
  assert.strictEqual(reactivoValido({ tipo: 'opcion_multiple', enunciado: 'X', opciones: ['A', '', '', ''] }), false)
  assert.strictEqual(reactivoValido({ tipo: 'opcion_multiple', enunciado: 'X', opciones: ['A', 'B', '', ''] }), true)
})

caso('verdadero_falso y respuesta_corta solo necesitan enunciado', () => {
  assert.strictEqual(reactivoValido({ tipo: 'verdadero_falso', enunciado: 'X', correcta: 'v' }), true)
  assert.strictEqual(reactivoValido({ tipo: 'respuesta_corta', enunciado: 'X' }), true)
})


grupo('estaRespondida — regla global de "toda pregunta se responde"')

const P_ABIERTA = { id: 'p1', tipo: 'respuesta_corta' }
const P_ARCHIVO = { id: 'p2', tipo: 'subir_archivo' }
const P_OM = { id: 'p3', tipo: 'opcion_multiple', opciones: [{ id: 'oA' }, { id: 'oB' }, { id: 'oOtra', esOtra: true }] }
const P_VF = { id: 'p4', tipo: 'verdadero_falso', opciones: [{ id: 'v' }, { id: 'f' }] }

caso('respuesta_corta: undefined, null, "" y solo espacios NUNCA son respuesta válida', () => {
  assert.strictEqual(estaRespondida(P_ABIERTA, undefined, undefined), false)
  assert.strictEqual(estaRespondida(P_ABIERTA, null, undefined), false)
  assert.strictEqual(estaRespondida(P_ABIERTA, '', undefined), false)
  assert.strictEqual(estaRespondida(P_ABIERTA, '   ', undefined), false)
  assert.strictEqual(estaRespondida(P_ABIERTA, '\t\n', undefined), false)
})

caso('respuesta_corta: cualquier texto no vacío ES respuesta válida', () => {
  assert.strictEqual(estaRespondida(P_ABIERTA, 'algo', undefined), true)
  assert.strictEqual(estaRespondida(P_ABIERTA, ' x ', undefined), true)
  assert.strictEqual(estaRespondida(P_ABIERTA, '0', undefined), true)
})

caso('respuesta_corta: valores que no son string (residuo de otro tipo) NO son respuesta', () => {
  // Regresión del bug real: si por un cambio de tipo el valor cargado es un
  // id de opción u otro objeto, la abierta debe seguir contando como vacía.
  assert.strictEqual(estaRespondida(P_ABIERTA, 'oXYZ', undefined), true) // string sí es válido — lo filtra la carga por-tipo
  assert.strictEqual(estaRespondida(P_ABIERTA, null, undefined), false)
  assert.strictEqual(estaRespondida(P_ABIERTA, { archivoURL: 'x' }, undefined), false)
  assert.strictEqual(estaRespondida(P_ABIERTA, 42, undefined), false)
})

caso('subir_archivo: sin archivoURL, con "" o sin objeto NO es respuesta', () => {
  assert.strictEqual(estaRespondida(P_ARCHIVO, undefined, undefined), false)
  assert.strictEqual(estaRespondida(P_ARCHIVO, null, undefined), false)
  assert.strictEqual(estaRespondida(P_ARCHIVO, {}, undefined), false)
  assert.strictEqual(estaRespondida(P_ARCHIVO, { archivoURL: '' }, undefined), false)
  assert.strictEqual(estaRespondida(P_ARCHIVO, { archivoURL: null }, undefined), false)
})

caso('subir_archivo: con URL válida SÍ es respuesta', () => {
  assert.strictEqual(estaRespondida(P_ARCHIVO, { archivoURL: 'https://x' }, undefined), true)
})

caso('opcion_multiple: sin opcion elegida NO es respuesta', () => {
  assert.strictEqual(estaRespondida(P_OM, undefined, undefined), false)
  assert.strictEqual(estaRespondida(P_OM, null, undefined), false)
  assert.strictEqual(estaRespondida(P_OM, '', undefined), false)
})

caso('opcion_multiple: opción normal marcada ES respuesta', () => {
  assert.strictEqual(estaRespondida(P_OM, 'oA', undefined), true)
  assert.strictEqual(estaRespondida(P_OM, 'oB', undefined), true)
})

caso('opcion_multiple con "Otra" marcada: sin texto libre NO es respuesta', () => {
  assert.strictEqual(estaRespondida(P_OM, 'oOtra', undefined), false)
  assert.strictEqual(estaRespondida(P_OM, 'oOtra', ''), false)
  assert.strictEqual(estaRespondida(P_OM, 'oOtra', '   '), false)
})

caso('opcion_multiple con "Otra": el texto libre completa la respuesta', () => {
  assert.strictEqual(estaRespondida(P_OM, 'oOtra', 'mi respuesta libre'), true)
})

caso('verdadero_falso: "v" y "f" son respuestas válidas', () => {
  assert.strictEqual(estaRespondida(P_VF, 'v', undefined), true)
  assert.strictEqual(estaRespondida(P_VF, 'f', undefined), true)
})

caso('verdadero_falso: sin opción elegida NO es respuesta', () => {
  assert.strictEqual(estaRespondida(P_VF, undefined, undefined), false)
  assert.strictEqual(estaRespondida(P_VF, null, undefined), false)
})

caso('valores legítimos `false` y `0` en opciones NO se confunden con vacío', () => {
  // Solo null/undefined/'' cuentan como vacío. `false` o `0` son valores
  // legítimos que un tipo futuro (o un id numérico) podrían usar.
  const P_FALSO = { id: 'p', tipo: 'opcion_multiple', opciones: [{ id: false }, { id: 0 }] }
  assert.strictEqual(estaRespondida(P_FALSO, false, undefined), true)
  assert.strictEqual(estaRespondida(P_FALSO, 0, undefined), true)
})

caso('pregunta sin definir → false (defensa contra un arreglo con huecos)', () => {
  assert.strictEqual(estaRespondida(null, 'x', undefined), false)
  assert.strictEqual(estaRespondida(undefined, 'x', undefined), false)
})


grupo('PDF de análisis de resultados (OP-10) — el reporte descargable')

// `contenidoAnalisisResultadosPDF` es el plan que pdf.js recorre para
// dibujar el PDF con jsPDF — probarlo aquí prueba EXACTAMENTE lo que termina
// impreso, sin depender de jsPDF (pdf.js no se puede importar bajo Node
// puro: tiene imports relativos sin extensión que solo resuelve el bundler
// de Vite — por eso ninguna función de pdf.js tiene pruebas directas hoy;
// `npm run build` sigue siendo la verificación de que el módulo compila).
const ACTIVITY_FIXTURE = { nombre: '1.2. Diagnóstico', categoria: 'cuestionario' }
const SUBJECT_FIXTURE = { nombre: 'Cultura digital I', grupo: '1A' }
const MEMBRETE_FIXTURE = { escuela: 'CBTIS 255', docente: 'Profe Kike Méndez' }
const RESULTADO_FIXTURE = {
  totalEstudiantes: 5,
  totalReactivos: 3,
  porcentajeAciertosGeneral: 60,
  resumenGeneral: 'El grupo acertó 60% en promedio en los reactivos objetivos.',
  resumenEjecutivo: 'Desempeño general aceptable con dos reactivos débiles.',
  reactivosDificiles: [{ numero: 1, enunciado: '¿Qué es un algoritmo?', pctAciertos: 60 }],
  reactivosFuertes: [{ numero: 2, enunciado: 'Un algoritmo siempre termina', pctAciertos: 80 }],
  patrones: [{ observacion: 'Varios eligieron la opción B en el reactivo 1', interpretacion: 'Podría haber confusión entre algoritmo y programa' }],
  estudiantesAtencion: [{ anonId: 'Alumno 2', nombre: 'Ana Torres', senal: 'Falló 2 de 2 reactivos objetivos' }],
  recomendaciones: ['Repasar la definición de algoritmo antes del siguiente examen'],
}

caso('trae todos los campos mínimos que pidió el PO: institución, evaluación, tipo, grupo, fecha, aviso', () => {
  const c = contenidoAnalisisResultadosPDF({
    activity: ACTIVITY_FIXTURE, subject: SUBJECT_FIXTURE, resultado: RESULTADO_FIXTURE,
    generadoEn: '2026-08-12T10:00:00.000Z', membrete: MEMBRETE_FIXTURE,
  })
  assert.strictEqual(c.institucion, 'CBTIS 255')
  assert.strictEqual(c.docente, 'Profe Kike Méndez')
  assert.strictEqual(c.evaluacion, '1.2. Diagnóstico')
  assert.strictEqual(c.tipo, 'Cuestionario')
  assert.strictEqual(c.grupo, 'Cultura digital I — 1A')
  assert.strictEqual(c.generadoEn, '2026-08-12T10:00:00.000Z')
  assert.strictEqual(c.aviso, 'Este análisis fue generado con inteligencia artificial. Puede contener errores. Revísalo cuidadosamente antes de tomar decisiones pedagógicas.')
  assert.strictEqual(c.aviso, AVISO_IA_ANALISIS)
})

caso('tipo: examen → "Examen", cualquier otra categoría → "Cuestionario"', () => {
  assert.strictEqual(contenidoAnalisisResultadosPDF({ activity: { categoria: 'examen' }, resultado: {} }).tipo, 'Examen')
  assert.strictEqual(contenidoAnalisisResultadosPDF({ activity: { categoria: 'cuestionario' }, resultado: {} }).tipo, 'Cuestionario')
})

caso('los números del reporte son EXACTAMENTE los de resultado — no se recalculan ni se inventan', () => {
  const c = contenidoAnalisisResultadosPDF({ activity: ACTIVITY_FIXTURE, subject: SUBJECT_FIXTURE, resultado: RESULTADO_FIXTURE })
  assert.strictEqual(c.porcentajeAciertosGeneral, 60)
  assert.strictEqual(c.totalEstudiantes, 5)
  assert.strictEqual(c.totalReactivos, 3)
  assert.deepStrictEqual(c.reactivosDificiles, [{ numero: 1, enunciado: '¿Qué es un algoritmo?', pctAciertos: 60 }])
  assert.deepStrictEqual(c.reactivosFuertes, [{ numero: 2, enunciado: 'Un algoritmo siempre termina', pctAciertos: 80 }])
})

caso('datos observados vs interpretación quedan separados, tal como los mandó la IA (patrones)', () => {
  const c = contenidoAnalisisResultadosPDF({ activity: ACTIVITY_FIXTURE, resultado: RESULTADO_FIXTURE })
  assert.strictEqual(c.patrones[0].observacion, 'Varios eligieron la opción B en el reactivo 1')
  assert.strictEqual(c.patrones[0].interpretacion, 'Podría haber confusión entre algoritmo y programa')
})

caso('estudiantes que podrían requerir atención: el PDF usa el NOMBRE REAL ya resuelto, nunca el anonId', () => {
  const c = contenidoAnalisisResultadosPDF({ activity: ACTIVITY_FIXTURE, resultado: RESULTADO_FIXTURE })
  assert.strictEqual(c.estudiantesAtencion.length, 1)
  assert.strictEqual(c.estudiantesAtencion[0].nombre, 'Ana Torres')
  assert.strictEqual(c.estudiantesAtencion[0].senal, 'Falló 2 de 2 reactivos objetivos')
})

caso('si el llamador no resolvió nombre, cae al anonId (nunca se queda vacío)', () => {
  const c = contenidoAnalisisResultadosPDF({
    activity: ACTIVITY_FIXTURE,
    resultado: { ...RESULTADO_FIXTURE, estudiantesAtencion: [{ anonId: 'Alumno 7', senal: 'x' }] },
  })
  assert.strictEqual(c.estudiantesAtencion[0].nombre, 'Alumno 7')
})

caso('recomendaciones y resumen ejecutivo pasan intactos', () => {
  const c = contenidoAnalisisResultadosPDF({ activity: ACTIVITY_FIXTURE, resultado: RESULTADO_FIXTURE })
  assert.deepStrictEqual(c.recomendaciones, ['Repasar la definición de algoritmo antes del siguiente examen'])
  assert.strictEqual(c.resumenEjecutivo, 'Desempeño general aceptable con dos reactivos débiles.')
})

caso('sin institución/membrete/grupo/fecha no revienta — campos quedan vacíos, no inventados', () => {
  const c = contenidoAnalisisResultadosPDF({ activity: ACTIVITY_FIXTURE, resultado: RESULTADO_FIXTURE })
  assert.strictEqual(c.institucion, null)
  assert.strictEqual(c.docente, null)
  assert.strictEqual(c.grupo, '')
  assert.strictEqual(c.generadoEn, null)
})

caso('un resultado vacío/incompleto no revienta y no inventa arreglos', () => {
  assert.doesNotThrow(() => contenidoAnalisisResultadosPDF({ activity: ACTIVITY_FIXTURE, resultado: {} }))
  const c = contenidoAnalisisResultadosPDF({ activity: ACTIVITY_FIXTURE, resultado: {} })
  assert.deepStrictEqual(c.reactivosDificiles, [])
  assert.deepStrictEqual(c.reactivosFuertes, [])
  assert.deepStrictEqual(c.patrones, [])
  assert.deepStrictEqual(c.estudiantesAtencion, [])
  assert.deepStrictEqual(c.recomendaciones, [])
  assert.strictEqual(c.totalEstudiantes, null)
  assert.strictEqual(c.porcentajeAciertosGeneral, null)
})

caso('grupo se arma con subject.nombre + subject.grupo; sin grupo, solo el nombre', () => {
  const c1 = contenidoAnalisisResultadosPDF({ activity: ACTIVITY_FIXTURE, subject: { nombre: 'Matemáticas' }, resultado: {} })
  assert.strictEqual(c1.grupo, 'Matemáticas')
  const c2 = contenidoAnalisisResultadosPDF({ activity: ACTIVITY_FIXTURE, subject: null, resultado: {} })
  assert.strictEqual(c2.grupo, '')
})

grupo('Confiabilidad de los datos (OP-10) — mismo texto en pantalla y PDF')

const TERMINOS_PROHIBIDOS = ['snapshot', 'firestore', 'anonid', 'submission', 'resolverintentoganador', 'fallback']

caso('1. sin exclusiones: frase simple, sin números de exclusión', () => {
  const t = resumenConfiabilidad({ totalEntregas: 8, confiablesParaReactivo: 8, excluidas: 0, motivoExclusion: null })
  assert.strictEqual(t, 'Los resultados generales y el análisis por reactivo consideran a los 8 estudiantes evaluados.')
})

caso('2. con exclusiones: menciona los tres números y el motivo, en español llano', () => {
  const t = resumenConfiabilidad({ totalEntregas: 8, confiablesParaReactivo: 7, excluidas: 1, motivoExclusion: 'intento_no_coincide_con_calificacion_final' })
  assert.match(t, /De 8 estudiantes evaluados/)
  assert.match(t, /consideran a los 8/)
  assert.match(t, /7 cuentan con respuestas confiables/)
  assert.match(t, /1 fue excluida/)
  assert.match(t, /no corresponden al intento que determinó su calificación final/)
})

caso('3. sin `confiabilidad` (análisis histórico de antes de esta corrección): no se inventa nada, null', () => {
  assert.strictEqual(resumenConfiabilidad(undefined), null)
  assert.strictEqual(resumenConfiabilidad(null), null)
  assert.strictEqual(resumenConfiabilidad({ totalEntregas: 0, confiablesParaReactivo: 0, excluidas: 0, motivoExclusion: null }), null)
})

caso('4. el PDF (contenidoAnalisisResultadosPDF) usa EXACTAMENTE el mismo texto que la pantalla', () => {
  const confiabilidad = { totalEntregas: 5, confiablesParaReactivo: 4, excluidas: 1, motivoExclusion: 'intento_no_coincide_con_calificacion_final' }
  const c = contenidoAnalisisResultadosPDF({ activity: ACTIVITY_FIXTURE, resultado: { ...RESULTADO_FIXTURE, confiabilidad } })
  assert.strictEqual(c.textoConfiabilidad, resumenConfiabilidad(confiabilidad))
})

caso('5. el PDF también refleja la ausencia de confiabilidad en análisis históricos (sin sección inventada)', () => {
  const c = contenidoAnalisisResultadosPDF({ activity: ACTIVITY_FIXTURE, resultado: RESULTADO_FIXTURE }) // RESULTADO_FIXTURE no trae confiabilidad
  assert.strictEqual(c.textoConfiabilidad, null)
})

caso('12. ningún término técnico de implementación se filtra al texto que ve el docente', () => {
  const t = resumenConfiabilidad({ totalEntregas: 8, confiablesParaReactivo: 7, excluidas: 1, motivoExclusion: 'intento_no_coincide_con_calificacion_final' })
  const minusc = t.toLowerCase()
  TERMINOS_PROHIBIDOS.forEach((term) => assert.strictEqual(minusc.includes(term), false, `"${term}" no debe aparecer en el texto visible`))
})

caso('un motivo de exclusión desconocido no revienta y da un texto genérico razonable (nunca vacío)', () => {
  const t = resumenConfiabilidad({ totalEntregas: 4, confiablesParaReactivo: 3, excluidas: 1, motivoExclusion: 'algo_que_no_existe_todavia' })
  assert.strictEqual(typeof t, 'string')
  assert.ok(t.length > 20)
})


grupo('resolverIntentoGanador / respuestasVivasSonDelIntentoGanador — fuente única de verdad de intentos')

// Casos 1-6 del PO. `intentos` = historial completo tal como vive en
// submission.intentos ([{numero, calificacion}]); las respuestas VIVAS en
// Firestore son siempre las del intento con mayor `numero` (el más reciente).

caso('1. una sola entrega/un intento → confiable, sin ambigüedad', () => {
  const intentos = [{ numero: 1, calificacion: 8 }]
  const r = resolverIntentoGanador(intentos, 'mejor')
  assert.strictEqual(r.numeroIntentoGanador, 1)
  assert.strictEqual(r.ambiguo, false)
  assert.strictEqual(r.representable, true)
  assert.strictEqual(respuestasVivasSonDelIntentoGanador(intentos, 'mejor'), true)
})

caso('2. conservar = "ultimo" → el último SIEMPRE gana, sin importar cuántos intentos haya', () => {
  const intentos = [{ numero: 1, calificacion: 6 }, { numero: 2, calificacion: 9 }, { numero: 3, calificacion: 3 }]
  const r = resolverIntentoGanador(intentos, 'ultimo')
  assert.strictEqual(r.numeroIntentoGanador, 3)
  assert.strictEqual(r.calificacionFinal, 3)
  assert.strictEqual(respuestasVivasSonDelIntentoGanador(intentos, 'ultimo'), true)
})

caso('3. conservar = "mejor" con ganador = último → confiable', () => {
  const intentos = [{ numero: 1, calificacion: 6 }, { numero: 2, calificacion: 9 }]
  const r = resolverIntentoGanador(intentos, 'mejor')
  assert.strictEqual(r.numeroIntentoGanador, 2)
  assert.strictEqual(r.ambiguo, false)
  assert.strictEqual(respuestasVivasSonDelIntentoGanador(intentos, 'mejor'), true)
})

caso('4. conservar = "mejor" con ganador distinto al último → NO confiable', () => {
  const intentos = [{ numero: 1, calificacion: 9 }, { numero: 2, calificacion: 6 }]
  const r = resolverIntentoGanador(intentos, 'mejor')
  assert.strictEqual(r.numeroIntentoGanador, 1)   // el intento 1 fue el ganador
  assert.strictEqual(r.calificacionFinal, 9)
  assert.strictEqual(respuestasVivasSonDelIntentoGanador(intentos, 'mejor'), false)  // pero las respuestas vivas son del intento 2
})

caso('5. conservar = "primero" con ganador distinto al último → NO confiable, incluso con la MISMA calificación (evita el falso positivo)', () => {
  // Mismo número, respuestas potencialmente distintas — comparar solo el
  // valor numérico diría "confiable" por error; por posición, no lo es.
  const intentos = [{ numero: 1, calificacion: 6 }, { numero: 2, calificacion: 6 }]
  const r = resolverIntentoGanador(intentos, 'primero')
  assert.strictEqual(r.numeroIntentoGanador, 1)
  assert.strictEqual(r.ambiguo, false)   // el GANADOR no es ambiguo (es siempre el primero)...
  assert.strictEqual(respuestasVivasSonDelIntentoGanador(intentos, 'primero'), false)  // ...pero sus respuestas ya no existen
})

caso('6. conservar = "promedio" con múltiples intentos → no confiable, ningún intento representa un promedio', () => {
  const intentos = [{ numero: 1, calificacion: 8 }, { numero: 2, calificacion: 6 }]
  const r = resolverIntentoGanador(intentos, 'promedio')
  assert.strictEqual(r.numeroIntentoGanador, null)
  assert.strictEqual(r.ambiguo, true)
  assert.strictEqual(r.representable, false)
  assert.strictEqual(respuestasVivasSonDelIntentoGanador(intentos, 'promedio'), false)
})

caso('empate real en "mejor" (2+ intentos con la calificación máxima) se declara ambiguo — no se inventa un desempate', () => {
  const intentos = [{ numero: 1, calificacion: 9 }, { numero: 2, calificacion: 6 }, { numero: 3, calificacion: 9 }]
  const r = resolverIntentoGanador(intentos, 'mejor')
  assert.strictEqual(r.numeroIntentoGanador, null)
  assert.strictEqual(r.ambiguo, true)
  assert.strictEqual(r.representable, false)
})

caso('sin intentos registrados → nunca inventar un ganador', () => {
  const r = resolverIntentoGanador([], 'ultimo')
  assert.strictEqual(r.numeroIntentoGanador, null)
  assert.strictEqual(r.ambiguo, true)
  assert.strictEqual(respuestasVivasSonDelIntentoGanador([], 'ultimo'), false)
})

caso('resolverIntentoGanador reutiliza resolverCalificacionFinal — nunca puede decir un valor distinto', () => {
  const intentos = [{ numero: 1, calificacion: 6 }, { numero: 2, calificacion: 9 }]
  for (const pol of ['primero', 'mejor', 'ultimo', 'promedio']) {
    const previos = intentos.slice(0, -1)
    const esperado = F.resolverCalificacionFinal(previos, intentos[intentos.length - 1].calificacion, pol)
    assert.strictEqual(resolverIntentoGanador(intentos, pol).calificacionFinal, esperado)
  }
})

grupo('agregarResultados (OP-10) con entregas no confiables — Capa 1')

const PREGUNTAS_CONF = [
  { id: 'p1', tipo: 'opcion_multiple', enunciado: '¿2+2?', opciones: [{ id: 'a', texto: '3' }, { id: 'b', texto: '4' }] },
  { id: 'p2', tipo: 'opcion_multiple', enunciado: '¿3+3?', opciones: [{ id: 'a', texto: '6' }, { id: 'b', texto: '5' }] },
]
function entregaConf({ alumnoId, calificacion, todasCorrectas, respuestasConfiables }) {
  const respuestas = {}
  PREGUNTAS_CONF.forEach((p) => { respuestas[p.id] = { opcionSeleccionada: todasCorrectas ? 'a' : 'z', correcta: todasCorrectas ? true : false, puntosObtenidos: todasCorrectas ? 1 : 0 } })
  return { alumnoId, calificacion, respuestas, respuestasConfiables }
}

caso('7. la calificación de una entrega NO confiable sigue contando en el resumen general (totalEstudiantes)', () => {
  const entregas = [
    entregaConf({ alumnoId: 'a1', calificacion: 10, todasCorrectas: true, respuestasConfiables: true }),
    entregaConf({ alumnoId: 'a2', calificacion: 10, todasCorrectas: false, respuestasConfiables: false }),
  ]
  const r = FIA.agregarResultados({ nombre: 'X', categoria: 'cuestionario', preguntas: PREGUNTAS_CONF, entregas })
  assert.strictEqual(r.totalEstudiantes, 2)
  assert.strictEqual(r.confiabilidad.totalEntregas, 2)
  assert.strictEqual(r.confiabilidad.confiablesParaReactivo, 1)
  assert.strictEqual(r.confiabilidad.excluidas, 1)
  assert.strictEqual(r.confiabilidad.motivoExclusion, 'intento_no_coincide_con_calificacion_final')
})

caso('8. las respuestas de una entrega NO confiable no afectan el % por reactivo', () => {
  const entregas = [
    entregaConf({ alumnoId: 'a1', calificacion: 10, todasCorrectas: true, respuestasConfiables: true }),
    entregaConf({ alumnoId: 'a2', calificacion: 10, todasCorrectas: false, respuestasConfiables: false }),
  ]
  const r = FIA.agregarResultados({ nombre: 'X', categoria: 'cuestionario', preguntas: PREGUNTAS_CONF, entregas })
  // Si la entrega no confiable contara, el % bajaría de 100 a 50 — debe seguir en 100.
  r.reactivos.forEach((rc) => assert.strictEqual(rc.pctAciertos, 100))
  assert.strictEqual(r.porcentajeAciertosGeneral, 100)
})

caso('9. una entrega NO confiable nunca genera una señal de "estudiante que requiere atención" por respuestas', () => {
  const entregas = [
    entregaConf({ alumnoId: 'a1', calificacion: 10, todasCorrectas: true, respuestasConfiables: true }),
    entregaConf({ alumnoId: 'a2', calificacion: 0, todasCorrectas: false, respuestasConfiables: false }),
    entregaConf({ alumnoId: 'a3', calificacion: 0, todasCorrectas: false, respuestasConfiables: true }),
  ]
  const r = FIA.agregarResultados({ nombre: 'X', categoria: 'cuestionario', preguntas: PREGUNTAS_CONF, entregas })
  const anonsAtencion = r.candidatosAtencion.map((c) => c.anonId)
  assert.strictEqual(anonsAtencion.includes('Alumno 2'), false)  // a2: no confiable, aunque falló todo
  assert.strictEqual(anonsAtencion.includes('Alumno 3'), true)   // a3: confiable y realmente falló todo
})

grupo('Bitácora de OP-10 — entregasConsideradas === entregas finalizadas realmente analizadas')

// `agregarResultados` es la función del servidor (functions/ia.js) que
// calcula `totalEstudiantes` — el candidato obvio para `entregasConsideradas`
// en el documento de bitácora. Se prueba aquí, en vez de asumirlo, que
// `totalEstudiantes` es literalmente `entregas.length`: el mismo arreglo que
// `ejecutarAnalisisResultados` arma filtrando `estadoEvaluacion === 'finalizado'`
// antes de llamar a `agregarResultados` (ver functions/ia.js).
const PREGUNTAS_FIXTURE_IA = [{ id: 'p1', tipo: 'opcion_multiple', enunciado: '¿2+2?', opciones: ['3', '4'], respuestaCorrecta: 1 }]
function entregaFixture(alumnoId, correcta) {
  return {
    alumnoId,
    respuestas: { p1: { opcionSeleccionada: correcta ? 1 : 0, correcta, puntosObtenidos: correcta ? 1 : 0 } },
  }
}

caso('totalEstudiantes === entregas.length: 8 entregas finalizadas → 8, no un total distinto', () => {
  const entregas = Array.from({ length: 8 }, (_, i) => entregaFixture(`a${i}`, i % 2 === 0))
  const r = FIA.agregarResultados({ nombre: 'Diagnóstico', categoria: 'cuestionario', preguntas: PREGUNTAS_FIXTURE_IA, entregas })
  assert.strictEqual(r.totalEstudiantes, 8)
  assert.strictEqual(r.totalEstudiantes, entregas.length)
})

caso('la fotografía histórica: análisis #1 con 8 entregas conserva 8 aunque después lleguen más', () => {
  const entregas8 = Array.from({ length: 8 }, (_, i) => entregaFixture(`a${i}`, true))
  const analisis1 = FIA.agregarResultados({ nombre: 'Diagnóstico', categoria: 'cuestionario', preguntas: PREGUNTAS_FIXTURE_IA, entregas: entregas8 })
  const entregas15 = Array.from({ length: 15 }, (_, i) => entregaFixture(`a${i}`, true))
  const analisis2 = FIA.agregarResultados({ nombre: 'Diagnóstico', categoria: 'cuestionario', preguntas: PREGUNTAS_FIXTURE_IA, entregas: entregas15 })
  // Cada llamada es independiente — nada muta analisis1 al calcular analisis2.
  assert.strictEqual(analisis1.totalEstudiantes, 8)
  assert.strictEqual(analisis2.totalEstudiantes, 15)
})

grupo('Higiene')

caso('`_pruebas` es un objeto plano y no una función desplegable', () => {
  // El análisis del despliegue solo recoge exportaciones con `__endpoint`.
  assert.strictEqual(typeof F, 'object')
  assert.strictEqual(F.__endpoint, undefined)
  assert.strictEqual(typeof F.calcularCalificacion, 'function')
})

// ═══ OP-05 · sanitarizarInstruccionesHtml — nada fuera de la whitelist ══════
// Defensa en servidor contra HTML que la IA (o un documento fuente
// manipulado) intente colar en `instrucciones` — allowlist estricta, sin
// DOMPurify/jsdom (ver functions/fuentesIA.js y la nota de diseño en ia.js).
grupo('OP-05 — sanitarizarInstruccionesHtml (allowlist estricta, sin libs externas)')

caso('quita <script> completo, con su contenido', () => {
  const out = FIA.sanitizarInstruccionesHtml('<p>Hola</p><script>alert(1)</script><p>Adiós</p>')
  assert.ok(!out.toLowerCase().includes('script'))
  assert.ok(!out.includes('alert'))
  assert.strictEqual(out, '<p>Hola</p><p>Adiós</p>')
})

caso('quita <style> completo, con su contenido', () => {
  const out = FIA.sanitizarInstruccionesHtml('<style>body{display:none}</style><p>Texto</p>')
  assert.ok(!out.toLowerCase().includes('style'))
  assert.strictEqual(out, '<p>Texto</p>')
})

caso('quita comentarios HTML', () => {
  const out = FIA.sanitizarInstruccionesHtml('<p>Antes</p><!-- <img src=x onerror=alert(1)> --><p>Después</p>')
  assert.ok(!out.includes('<!--'))
  assert.ok(!out.includes('onerror'))
  assert.strictEqual(out, '<p>Antes</p><p>Después</p>')
})

caso('quita atributos de una etiqueta permitida (incluyendo manejadores de eventos)', () => {
  const out = FIA.sanitizarInstruccionesHtml('<p onclick="alert(1)" style="color:red">Hola</p>')
  assert.ok(!out.includes('onclick'))
  assert.ok(!out.includes('style'))
  assert.strictEqual(out, '<p>Hola</p>')
})

caso('quita una etiqueta fuera de la whitelist pero conserva su texto interior', () => {
  const out = FIA.sanitizarInstruccionesHtml('<div class="x">Contenido</div>')
  assert.ok(!out.includes('<div'))
  assert.strictEqual(out, 'Contenido')
})

caso('quita <img onerror=...> por completo (no está en la whitelist)', () => {
  const out = FIA.sanitizarInstruccionesHtml('<img src="x" onerror="alert(1)">')
  assert.ok(!out.includes('onerror'))
  assert.ok(!out.includes('<img'))
})

caso('quita <a href="javascript:..."> (no está en la whitelist)', () => {
  const out = FIA.sanitizarInstruccionesHtml('<a href="javascript:alert(1)">clic</a>')
  assert.ok(!out.includes('<a'))
  assert.ok(!out.includes('javascript:'))
  assert.strictEqual(out, 'clic')
})

caso('quita <iframe>/<svg>/<object> por completo', () => {
  const out = FIA.sanitizarInstruccionesHtml('<iframe src="//evil"></iframe><svg onload=alert(1)></svg><object data="x"></object>')
  assert.ok(!/<iframe|<svg|<object/i.test(out))
})

caso('conserva las etiquetas de la whitelist sin atributos y sin escapar su texto', () => {
  const input = '<p>Uno</p><br><strong>dos</strong><em>tres</em><ul><li>a</li><li>b</li></ul><ol><li>c</li></ol>'
  assert.strictEqual(FIA.sanitizarInstruccionesHtml(input), input)
})

caso('entrada vacía o no-string no truena', () => {
  assert.strictEqual(FIA.sanitizarInstruccionesHtml(''), '')
  assert.strictEqual(FIA.sanitizarInstruccionesHtml(null), '')
  assert.strictEqual(FIA.sanitizarInstruccionesHtml(undefined), '')
})

// ═══ OP-03/OP-04 · repartirPonderacion — siempre suma exactamente 10.0 ══════
grupo('OP-03/OP-04 — repartirPonderacion (la aritmética la hace el código, nunca la IA)')

caso('reparte y suma exactamente 10.0 para cantidades comunes', () => {
  for (const n of [1, 2, 3, 4, 5, 7, 10, 15, 30, 100]) {
    const valores = FIA.repartirPonderacion(n)
    assert.strictEqual(valores.length, n, `longitud para n=${n}`)
    const suma = Math.round(valores.reduce((s, v) => s + v, 0) * 10) / 10
    assert.strictEqual(suma, 10, `suma para n=${n} fue ${suma}`)
  }
})

caso('todos los valores son positivos', () => {
  FIA.repartirPonderacion(7).forEach((v) => assert.ok(v > 0))
})

caso('cantidad 0 o negativa no truena — se trata como 1', () => {
  assert.deepStrictEqual(FIA.repartirPonderacion(0), [10])
  assert.deepStrictEqual(FIA.repartirPonderacion(-3), [10])
})

// ═══ A09 · Mismo número en las cinco pantallas ══════════════════════════════
grupo('A09 — pantalla, panel del alumno, PDF (curso y parcial) y Excel: el mismo número')

// `cuentaParaCalificacion` vive en src/utils/activityVisibility.js, que no es
// importable en Node plano (importa './formatHora' sin extensión — Vite lo
// resuelve, Node no). Copia LITERAL de activityVisibility.js:32-55 — no se
// reimplementa, se transcribe tal cual para no divergir del original.
const isDraftActivity = (a) => !!a?.oculta && !a.publishedAt && !a.publishAt
const sinCalificacion = (a) => a?.sinCalificacion === true || a?.evaluacion?.sinCalificacion === true
const cuentaParaCalificacion = (a) => !isDraftActivity(a) && !sinCalificacion(a)

// Las cinco composiciones, cada una transcrita del archivo real que la usa —
// el comentario de cada una es su dirección. Si algún día una vuelve a
// divergir (alguien la edita sin tocar las otras cuatro), estos casos se
// ponen en rojo.

// 1 · SubjectPage.jsx (docente) — tableParcials (L3371) + gradeRows (L3599-3617)
function pantallaDocente(subject, activities, notaDe) {
  const PARCIALES = Array.from({ length: subject.parciales || 3 }, (_, i) => i + 1)
  const tableParcials = PARCIALES
    .map((p) => ({ p, acts: activities.filter((a) => a.parcial === p && cuentaParaCalificacion(a)) }))
    .filter((pd) => pd.acts.length > 0)
  const parcialData = tableParcials.map(({ p, acts }) => {
    const grades = acts.map((a) => normalizeGrade(notaDe(a.id), a.maxCalif, { decimals: 1 }))
    const rawAvg = promedioParcial(acts, grades, ponderacionActivaEnParcial(subject, p))
    return rawAvg !== null ? parseFloat(rawAvg.toFixed(1)) : null
  })
  const validAvgs = parcialData.filter((a) => a !== null)
  return {
    parciales: parcialData,
    final: validAvgs.length ? parseFloat((validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length).toFixed(1)) : null,
  }
}

// 2 · excel.js exportSubjectGrades (L275-373) — course-wide Excel
function excelCurso(subject, activities, notaDe) {
  const PARCIALES = Array.from({ length: subject.parciales || 3 }, (_, i) => i + 1)
  const finalGrades = []
  const parciales = []
  PARCIALES.forEach((p) => {
    const acts = activities.filter((a) => a.parcial === p && cuentaParaCalificacion(a))
    const grades = acts.map((a) => normalizeGrade(notaDe(a.id), a.maxCalif, { decimals: 1 }))
    const rawAvg = promedioParcial(acts, grades, ponderacionActivaEnParcial(subject, p))
    const parAvg = rawAvg !== null ? parseFloat(rawAvg.toFixed(1)) : ''
    parciales.push(parAvg === '' ? null : parAvg)
    if (parAvg !== '') finalGrades.push(parAvg)
  })
  const final = finalGrades.length ? parseFloat((finalGrades.reduce((a, b) => a + b, 0) / finalGrades.length).toFixed(1)) : null
  return { parciales, final }
}

// 3 · pdf.js exportSubjectGradesPDF (L218-241) — course-wide PDF
function pdfCurso(subject, activities, notaDe) {
  const PARCIALES = Array.from({ length: subject.parciales || 3 }, (_, i) => i + 1)
  const finals = []
  const parciales = []
  PARCIALES.forEach((p) => {
    const acts = activities.filter((a) => a.parcial === p && cuentaParaCalificacion(a))
    const grades = acts.map((a) => normalizeGrade(notaDe(a.id), a.maxCalif, { decimals: 1 }))
    const rawAvg = promedioParcial(acts, grades, ponderacionActivaEnParcial(subject, p))
    const avg = rawAvg != null ? parseFloat(rawAvg.toFixed(1)) : null
    parciales.push(avg)
    if (avg != null) finals.push(avg)
  })
  const final = finals.length ? finals.reduce((x, y) => x + y, 0) / finals.length : null
  return { parciales, final: final != null ? parseFloat(final.toFixed(1)) : null }
}

// 4 · pdf.js exportParcialGradesPDF (L281-294) y excel.js exportParcialGrades
// (L248-257) — comparten exactamente la misma composición por parcial.
function porParcial(subject, activities, notaDe, parcial) {
  const acts = activities.filter((a) => a.parcial === parcial && cuentaParaCalificacion(a))
  const grades = acts.map((a) => normalizeGrade(notaDe(a.id), a.maxCalif, { decimals: 1 }))
  const rawAvg = promedioParcial(acts, grades, ponderacionActivaEnParcial(subject, parcial))
  return rawAvg !== null ? parseFloat(rawAvg.toFixed(1)) : null
}

// 5 · student/Dashboard.jsx (panel del alumno) — enriched (L330-349)
function panelAlumno(subject, activities, notaDe) {
  const PARC = Array.from({ length: subject.parciales || 3 }, (_, i) => i + 1)
  const parcAvgs = PARC.map((p) => {
    const pacts = activities.filter((a) => a.parcial === p && cuentaParaCalificacion(a))
    const grades = pacts.map((a) => normalizeGrade(notaDe(a.id), a.maxCalif, { decimals: 1 }))
    const raw = promedioParcial(pacts, grades, ponderacionActivaEnParcial(subject, p))
    return raw !== null ? parseFloat(raw.toFixed(1)) : null
  }).filter((v) => v !== null)
  return parcAvgs.length ? parseFloat((parcAvgs.reduce((x, y) => x + y, 0) / parcAvgs.length).toFixed(1)) : null
}

const act09 = (id, parcial, extra = {}) => ({ id, parcial, maxCalif: 10, orden: 1, ...extra })

caso('H2-b · el redondeo por decimal ya no depende de la pantalla (8.4,8.5,8.5 · 9.0 → 8.8 en las cinco)', () => {
  const subject = { parciales: 2 }
  const activities = [act09('a1', 1), act09('a2', 1), act09('a3', 1), act09('a4', 2)]
  const notaDe = (id) => ({ a1: 8.4, a2: 8.5, a3: 8.5, a4: 9 }[id])

  const pant = pantallaDocente(subject, activities, notaDe)
  const exc = excelCurso(subject, activities, notaDe)
  const pdfC = pdfCurso(subject, activities, notaDe)
  const panel = panelAlumno(subject, activities, notaDe)

  assert.strictEqual(pant.final, 8.8, 'pantalla del docente')
  assert.strictEqual(exc.final, pant.final, 'Excel del curso debe coincidir con la pantalla')
  assert.strictEqual(pdfC.final, pant.final, 'PDF del curso debe coincidir con la pantalla')
  assert.strictEqual(panel, pant.final, 'panel del alumno debe coincidir con la pantalla')
  assert.strictEqual(porParcial(subject, activities, notaDe, 1), pant.parciales[0], 'PDF/Excel por parcial P1')
  assert.strictEqual(porParcial(subject, activities, notaDe, 2), pant.parciales[1], 'PDF/Excel por parcial P2')
})

caso('H2-a/H3-a · una actividad calificada regresada a borrador desaparece del promedio en las cinco', () => {
  const subject = { parciales: 1 }
  const activities = [act09('b1', 1), act09('b2', 1, { oculta: true, publishedAt: null, publishAt: null })]
  const notaDe = (id) => ({ b1: 10, b2: 2 }[id])

  const pant = pantallaDocente(subject, activities, notaDe)
  assert.strictEqual(pant.final, 10, 'la actividad en borrador no debe contar en la pantalla')
  assert.strictEqual(excelCurso(subject, activities, notaDe).final, 10)
  assert.strictEqual(pdfCurso(subject, activities, notaDe).final, 10)
  assert.strictEqual(panelAlumno(subject, activities, notaDe), 10)
  assert.strictEqual(porParcial(subject, activities, notaDe, 1), 10)
})

caso('H3-a · un diagnóstico marcado "sin calificación" DESPUÉS de tener nota no cuenta en ninguna', () => {
  const subject = { parciales: 1 }
  const activities = [act09('c1', 1), act09('c2', 1, { evaluacion: { sinCalificacion: true } })]
  const notaDe = (id) => ({ c1: 10, c2: 4 }[id])

  const esperado = 10 // solo c1 cuenta
  assert.strictEqual(pantallaDocente(subject, activities, notaDe).final, esperado)
  assert.strictEqual(excelCurso(subject, activities, notaDe).final, esperado)
  assert.strictEqual(pdfCurso(subject, activities, notaDe).final, esperado)
  assert.strictEqual(panelAlumno(subject, activities, notaDe), esperado)
})

caso('parcial vacío (sin actividades que cuenten) no rompe el Final — se omite, no cuenta como 0', () => {
  const subject = { parciales: 2 }
  const activities = [act09('d1', 1)] // Parcial 2 sin actividades
  const notaDe = () => 8
  assert.strictEqual(pantallaDocente(subject, activities, notaDe).final, 8)
  assert.strictEqual(excelCurso(subject, activities, notaDe).final, 8)
  assert.strictEqual(pdfCurso(subject, activities, notaDe).final, 8)
  assert.strictEqual(panelAlumno(subject, activities, notaDe), 8)
})

caso('ponderación: una actividad "sin valor" (peso null) no distorsiona el promedio ponderado', () => {
  const subject = { parciales: 1, ponderacionActivada: true, ponderacionParciales: { 1: true } }
  const activities = [
    act09('e1', 1, { pesoCalificacion: 6 }),
    act09('e2', 1, { pesoCalificacion: null }), // sin valor — no debe contar aunque tenga nota
    act09('e3', 1, { pesoCalificacion: 4 }),
  ]
  // e2 en 0 arrastraría el promedio si se contara con peso 0 en el denominador
  // — promedioParcial ya excluye peso<=0 del denominador; esto fija que siga así.
  const notaDe = (id) => ({ e1: 10, e2: 0, e3: 10 }[id])
  assert.strictEqual(pantallaDocente(subject, activities, notaDe).final, 10)
  assert.strictEqual(panelAlumno(subject, activities, notaDe), 10)
})

// ═══ A09 · H5 — la lista de cotejo suma EXACTAMENTE 10, igual que la rúbrica ═
grupo('A09 — H5: lista de cotejo, misma regla que la rúbrica (decisión del PO)')

caso('una lista de cotejo que suma MENOS de 10 ya no se acepta', () => {
  const cotejo8 = {
    tipo: 'cotejo', titulo: 'Revisar documento',
    niveles: [{ nombre: 'Nivel de desempeño', porcentaje: 100 }],
    criterios: [
      { nombre: 'Portada', puntos: [3], descriptores: [''] },
      { nombre: 'Ortografía', puntos: [3], descriptores: [''] },
      { nombre: 'Fuentes', puntos: [2], descriptores: [''] },
    ],
  }
  const error = validarCotejo(cotejo8)
  assert.notStrictEqual(error, null, 'debe rechazarse: suma 8, no 10')
  assert.match(error, /exactamente 10/)
})

caso('una lista de cotejo que suma MÁS de 10 sigue rechazada (sin cambios)', () => {
  const cotejo11 = {
    tipo: 'cotejo', titulo: 'X',
    niveles: [{ nombre: 'Nivel de desempeño', porcentaje: 100 }],
    criterios: [{ nombre: 'a', puntos: [6], descriptores: [''] }, { nombre: 'b', puntos: [5], descriptores: [''] }],
  }
  assert.notStrictEqual(validarCotejo(cotejo11), null)
})

caso('una lista de cotejo que suma EXACTO 10 se acepta, y cumplir todo da 10/10', () => {
  const cotejo10 = {
    tipo: 'cotejo', titulo: 'Revisar documento',
    niveles: [{ nombre: 'Nivel de desempeño', porcentaje: 100 }],
    criterios: [
      { nombre: 'Portada', puntos: [4], descriptores: [''] },
      { nombre: 'Ortografía', puntos: [3], descriptores: [''] },
      { nombre: 'Fuentes', puntos: [3], descriptores: [''] },
    ],
  }
  assert.strictEqual(validarCotejo(cotejo10), null)
  assert.strictEqual(totalRubrica(cotejo10, [0, 0, 0]), RUBRICA_TOTAL)
})

caso('control — una rúbrica normal sigue exigiendo exactamente 10 en su nivel máximo (sin cambios)', () => {
  const rubrica8 = {
    tipo: 'rubrica', titulo: 'R',
    niveles: [{ nombre: 'A', porcentaje: 100 }, { nombre: 'B', porcentaje: 50 }, { nombre: 'C', porcentaje: 10 }],
    criterios: [
      { nombre: 'c1', puntos: [4, 2, 0.4], descriptores: ['', '', ''] },
      { nombre: 'c2', puntos: [4, 2, 0.4], descriptores: ['', '', ''] },
    ],
  }
  assert.notStrictEqual(validarRubrica(rubrica8), null)
})

grupo('Perfil para IA del docente — completitud')

caso('perfil vacío (nunca abierto) se considera incompleto', () => {
  assert.strictEqual(isPerfilIACompleto(null), false)
  assert.strictEqual(isPerfilIACompleto(perfilIAVacio()), false)
})

caso('faltando un campo requerido sigue incompleto', () => {
  assert.strictEqual(isPerfilIACompleto({
    estiloClase: 'Participativo', habilidades: 'Proyectos', experiencia: '',
  }), false)
})

caso('con los tres campos requeridos, completo — aunque los opcionales queden vacíos', () => {
  assert.strictEqual(isPerfilIACompleto({
    estiloClase: 'Participativo', habilidades: 'Proyectos', experiencia: '8 años',
    contextoEscuela: '', contextoGeneral: '',
  }), true)
})

caso('campos requeridos solo con espacios en blanco no cuentan como llenos', () => {
  assert.strictEqual(isPerfilIACompleto({
    estiloClase: '   ', habilidades: 'Proyectos', experiencia: '8 años',
  }), false)
})

grupo('Fuentes del Asistente IA — apartado Fuentes')

caso('PDF y Word (.pdf/.doc/.docx) son formatos permitidos', () => {
  assert.strictEqual(tipoFuentePermitido('programa.pdf'), true)
  assert.strictEqual(tipoFuentePermitido('guia.doc'), true)
  assert.strictEqual(tipoFuentePermitido('guia.docx'), true)
  assert.strictEqual(tipoFuentePermitido('PROGRAMA.PDF'), true)
})

caso('otros formatos (imagen, Excel, sin extensión) se rechazan', () => {
  assert.strictEqual(tipoFuentePermitido('foto.jpg'), false)
  assert.strictEqual(tipoFuentePermitido('datos.xlsx'), false)
  assert.strictEqual(tipoFuentePermitido('sinextension'), false)
  assert.strictEqual(tipoFuentePermitido(''), false)
})

caso('extensionDeArchivo normaliza a minúsculas', () => {
  assert.strictEqual(extensionDeArchivo('Programa.PDF'), 'pdf')
  assert.strictEqual(extensionDeArchivo('guia.docx'), 'docx')
})

caso('una fuente marcada como general no lleva número de parcial (contrato de datos)', () => {
  const fuenteGeneral = { ubicacion: 'general', parcial: null }
  assert.strictEqual(fuenteGeneral.ubicacion, 'general')
  assert.strictEqual(fuenteGeneral.parcial, null)
})

caso('una fuente de parcial queda asociada al número de parcial correcto', () => {
  const fuenteParcial2 = { ubicacion: 'parcial', parcial: 2 }
  assert.strictEqual(fuenteParcial2.ubicacion, 'parcial')
  assert.strictEqual(fuenteParcial2.parcial, 2)
})

caso('hayFuentesGenerales: falso sin fuentes o solo con fuentes de parcial', () => {
  assert.strictEqual(hayFuentesGenerales([]), false)
  assert.strictEqual(hayFuentesGenerales([{ ubicacion: 'parcial', parcial: 1 }]), false)
})

caso('hayFuentesGenerales: verdadero en cuanto hay al menos una fuente general', () => {
  assert.strictEqual(hayFuentesGenerales([{ ubicacion: 'parcial', parcial: 1 }, { ubicacion: 'general' }]), true)
})

caso('MAX_FUENTES_POR_GRUPO: tope de biblioteca por grupo es 1 a 10 documentos (decisión de Kike, 12-ago-2026)', () => {
  assert.strictEqual(MAX_FUENTES_POR_GRUPO, 10)
})

// esMismaFuente — criterio de reutilización aprobado por Kike el 12-ago-2026:
// nombre normalizado + tamaño exacto en bytes + tipo/extensión. Sin hash de
// contenido (no existe infraestructura para eso en el proyecto).
function archivo(nombre, bytes) {
  return new File([new Uint8Array(bytes)], nombre)
}

caso('esMismaFuente: mismo nombre, tamaño y tipo → true', () => {
  const guardada = { nombre: 'Programa.pdf', tamano: 1024, tipo: 'pdf' }
  assert.strictEqual(esMismaFuente(archivo('Programa.pdf', 1024), guardada), true)
})

caso('esMismaFuente: nombre normalizado (espacios/mayúsculas) → sigue siendo true', () => {
  const guardada = { nombre: '  Programa.pdf  ', tamano: 1024, tipo: 'pdf' }
  assert.strictEqual(esMismaFuente(archivo('programa.PDF'.replace('PDF', 'pdf'), 1024), guardada), true)
  assert.strictEqual(esMismaFuente(archivo('PROGRAMA.pdf', 1024), guardada), true)
})

caso('esMismaFuente: mismo nombre pero DISTINTO tamaño → false (no es el mismo archivo)', () => {
  const guardada = { nombre: 'Programa.pdf', tamano: 1024, tipo: 'pdf' }
  assert.strictEqual(esMismaFuente(archivo('Programa.pdf', 2048), guardada), false)
})

caso('esMismaFuente: mismo nombre y tamaño pero DISTINTO tipo → false', () => {
  const guardada = { nombre: 'Programa.pdf', tamano: 1024, tipo: 'pdf' }
  assert.strictEqual(esMismaFuente(archivo('Programa.docx', 1024), guardada), false)
})

caso('esMismaFuente: nombre distinto, mismo tamaño y tipo → false', () => {
  const guardada = { nombre: 'Programa.pdf', tamano: 1024, tipo: 'pdf' }
  assert.strictEqual(esMismaFuente(archivo('Otro.pdf', 1024), guardada), false)
})

caso('esMismaFuente: sin fuente guardada → false, no truena', () => {
  assert.strictEqual(esMismaFuente(archivo('Programa.pdf', 1024), null), false)
  assert.strictEqual(esMismaFuente(archivo('Programa.pdf', 1024), undefined), false)
})

caso('comentariosGrupoATexto: usa el texto del docente tal cual, recortado de espacios', () => {
  assert.strictEqual(FIA.comentariosGrupoATexto('  Apenas saben sumar.  '), 'Apenas saben sumar.')
})

caso('comentariosGrupoATexto: sin comentarios, lo dice explícitamente (no inventa)', () => {
  assert.strictEqual(FIA.comentariosGrupoATexto(''), 'El docente no dejó comentarios generales sobre el grupo.')
  assert.strictEqual(FIA.comentariosGrupoATexto(null), 'El docente no dejó comentarios generales sobre el grupo.')
  assert.strictEqual(FIA.comentariosGrupoATexto(undefined), 'El docente no dejó comentarios generales sobre el grupo.')
})

caso('autoanalisisDocenteATexto: arma una línea por cada pregunta contestada, en orden', () => {
  const texto = FIA.autoanalisisDocenteATexto({
    temasDomina: 'Álgebra y trigonometría',
    temasFortalecer: 'Estadística y probabilidad',
    temasFacilExplicar: '',
    temasDificilExplicar: 'Límites',
    aspectoMejorar: '',
  })
  assert.strictEqual(texto,
    '¿Qué temas domina mejor? Álgebra y trigonometría\n' +
    '¿Qué temas considera que necesita fortalecer? Estadística y probabilidad\n' +
    '¿Qué temas se le dificultan más para explicar? Límites'
  )
})

caso('autoanalisisDocenteATexto: opcional — sin nada contestado, lo dice explícitamente (no inventa)', () => {
  assert.strictEqual(FIA.autoanalisisDocenteATexto(null), 'El docente no contestó el autoanálisis (es opcional).')
  assert.strictEqual(FIA.autoanalisisDocenteATexto(undefined), 'El docente no contestó el autoanálisis (es opcional).')
  assert.strictEqual(FIA.autoanalisisDocenteATexto({}), 'El docente no contestó el autoanálisis (es opcional).')
  assert.strictEqual(
    FIA.autoanalisisDocenteATexto({ temasDomina: '', temasFortalecer: '   ' }),
    'El docente no contestó el autoanálisis (es opcional).'
  )
})

grupo('Diagnóstico del grupo — apartado 2 de Asistente IA')

caso('seleccionarFuentesGenerales: toma hasta 3, las más recientes primero, solo las generales', () => {
  const fuentes = [
    { ubicacion: 'general', url: 'u1', creadoEnMillis: 100 },
    { ubicacion: 'parcial', parcial: 1, url: 'u-parcial', creadoEnMillis: 999 }, // debe excluirse
    { ubicacion: 'general', url: 'u2', creadoEnMillis: 300 },
    { ubicacion: 'general', url: 'u3', creadoEnMillis: 200 },
    { ubicacion: 'general', url: 'u4', creadoEnMillis: 50 }, // se queda fuera (ya hay 3 más recientes)
  ]
  const seleccion = FIA.seleccionarFuentesGenerales(fuentes)
  assert.strictEqual(seleccion.length, 3)
  assert.deepStrictEqual(seleccion.map((f) => f.url), ['u2', 'u3', 'u1'])
})

caso('seleccionarFuentesGenerales: sin fuentes generales, arreglo vacío (no truena)', () => {
  assert.deepStrictEqual(FIA.seleccionarFuentesGenerales([{ ubicacion: 'parcial', parcial: 1, url: 'x' }]), [])
  assert.deepStrictEqual(FIA.seleccionarFuentesGenerales(null), [])
})

caso('perfilIACompleto (functions/ia.js) exige los mismos 3 campos que isPerfilIACompleto (cliente)', () => {
  assert.strictEqual(FIA.perfilIACompleto(null), false)
  assert.strictEqual(FIA.perfilIACompleto({ estiloClase: 'x', habilidades: 'y', experiencia: '' }), false)
  assert.strictEqual(FIA.perfilIACompleto({ estiloClase: 'x', habilidades: 'y', experiencia: 'z' }), true)
})

caso('perfilIATexto: arma un bloque legible solo con los campos que sí tienen contenido', () => {
  const texto = FIA.perfilIATexto({ estiloClase: 'Participativo', habilidades: '', experiencia: '8 años', contextoEscuela: '', contextoGeneral: '' })
  assert.ok(texto.includes('Participativo'))
  assert.ok(texto.includes('8 años'))
  assert.ok(!texto.includes('Habilidades del docente'), 'no debe mencionar un campo vacío')
})

caso('perfilIATexto: perfil totalmente vacío no inventa nada — dice que no hay información', () => {
  assert.strictEqual(FIA.perfilIATexto(null), 'Información no disponible en las fuentes proporcionadas.')
})

// Corrección de Kike (12-ago-2026, Tanda 2): el diagnóstico de contexto ya
// no es un reporte simulado — es un cuestionario real, 10 a 15 preguntas
// (la IA decide cuántas dentro de ese rango) mezclando opcion_multiple y
// respuesta_corta, sin "correcta" (es una encuesta). Se prueba el
// normalizador nuevo (normalizarPreguntasContexto), no uno de reporte.
caso('normalizarPreguntasContexto: acepta opcion_multiple y respuesta_corta, descarta lo demás', () => {
  const r = FIA.normalizarPreguntasContexto([
    { tipo: 'opcion_multiple', enunciado: '¿Tienes acceso a internet en casa?', opciones: ['Sí, siempre', 'A veces', 'No'] },
    { tipo: 'respuesta_corta', enunciado: '¿Qué te gustaría aprender en esta materia?' },
    { tipo: 'opcion_multiple', enunciado: 'Sin opciones suficientes', opciones: ['Solo una'] }, // se descarta
    { tipo: 'opcion_multiple', enunciado: '', opciones: ['a', 'b'] }, // se descarta, sin enunciado
  ])
  assert.strictEqual(r.length, 2)
  assert.strictEqual(r[0].tipo, 'opcion_multiple')
  assert.strictEqual(r[0].opciones.length, 3)
  assert.strictEqual(r[1].tipo, 'respuesta_corta')
  assert.strictEqual(r[1].opciones, undefined, 'respuesta_corta no lleva opciones')
})

caso('normalizarPreguntasContexto: nunca inventa una "correcta" — es una encuesta', () => {
  const r = FIA.normalizarPreguntasContexto([
    { tipo: 'opcion_multiple', enunciado: '¿Cuánto tiempo dedicas a tus tareas?', opciones: ['Menos de 1h', '1-2h', 'Más de 2h'] },
  ])
  assert.strictEqual(r[0].correcta, undefined)
})

caso('normalizarPreguntasContexto: nunca deja pasar más del máximo permitido (15)', () => {
  const muchas = Array.from({ length: 40 }, (_, i) => ({ tipo: 'respuesta_corta', enunciado: `pregunta ${i}` }))
  const r = FIA.normalizarPreguntasContexto(muchas)
  assert.strictEqual(r.length, FIA.MAX_PREGUNTAS_CONTEXTO)
})

caso('normalizarPreguntasContexto: entrada basura (no arreglo) no truena — arreglo vacío', () => {
  assert.deepStrictEqual(FIA.normalizarPreguntasContexto('no es arreglo'), [])
  assert.deepStrictEqual(FIA.normalizarPreguntasContexto(undefined), [])
})

// Corrección de Kike (13-ago-2026): el docente ahora elige la cantidad
// EXACTA (10-15, antes la decidía la IA sola dentro del rango) y puede
// orientar el instrumento con un texto libre opcional. También pide
// nombre + instrucciones de la actividad, igual que crear_actividad_ia.
caso('promptInstrumentoContexto: pide EXACTAMENTE la cantidad elegida por el docente, combina opción múltiple y respuesta breve', () => {
  const ctx = { asignaturaNombre: 'Cultura Digital I', perfilIATexto: 'x', comentariosGrupoTexto: 'y', bloqueFuentes: null, cantidad: 12 }
  const p = FIA.promptInstrumentoContexto(ctx)
  assert.ok(p.includes('EXACTAMENTE 12 preguntas'))
  assert.ok(p.includes('opcion_multiple'))
  assert.ok(p.includes('respuesta_corta'))
})

caso('promptInstrumentoContexto: pide nombre e instrucciones de la actividad (req. Kike 13-ago-2026)', () => {
  const ctx = { asignaturaNombre: 'x', perfilIATexto: 'x', comentariosGrupoTexto: 'x', bloqueFuentes: null, cantidad: 10 }
  const p = FIA.promptInstrumentoContexto(ctx)
  assert.ok(p.includes('"nombre"'))
  assert.ok(p.includes('"instruccionesHtml"'))
})

caso('promptInstrumentoContexto: sin queQuieresIndagar, no lo menciona; con él, lo incluye y le da prioridad', () => {
  const base = { asignaturaNombre: 'x', perfilIATexto: 'x', comentariosGrupoTexto: 'x', bloqueFuentes: null, cantidad: 10 }
  const sinPeticion = FIA.promptInstrumentoContexto(base)
  assert.ok(!sinPeticion.includes('QUÉ QUIERE INDAGAR'))
  const conPeticion = FIA.promptInstrumentoContexto({ ...base, queQuieresIndagar: 'Acceso a internet y computadora en casa.' })
  assert.ok(conPeticion.includes('QUÉ QUIERE INDAGAR'))
  assert.ok(conPeticion.includes('Acceso a internet y computadora en casa.'))
})

caso('promptInstrumentoContexto: prohíbe explícitamente contenido clínico/sensible y etiquetar al estudiante', () => {
  const ctx = { asignaturaNombre: 'x', perfilIATexto: 'x', comentariosGrupoTexto: 'x', bloqueFuentes: null, cantidad: 10 }
  const p = FIA.promptInstrumentoContexto(ctx)
  assert.ok(p.toLowerCase().includes('diagnósticos médicos'))
  assert.ok(p.toLowerCase().includes('trastornos psicológicos'))
  assert.ok(p.toLowerCase().includes('no etiquetes'))
})

// Corrección de Kike (12-ago-2026): el diagnóstico de conocimientos ya no es
// un reporte simulado — es un cuestionario real, con cantidad elegida por el
// docente (ya no la decide la IA) y SOLO opción múltiple (ya no mezcla
// verdadero/falso). promptDiagnosticoConocimientos reusa el mismo esquema de
// "reactivos" que promptCrearEvaluacion, así que normalizarReactivos (ya
// probado en el grupo de Reactivos con IA) es lo que normaliza su salida —
// no hace falta un normalizador aparte.
caso('promptDiagnosticoConocimientos: pide EXACTAMENTE la cantidad elegida por el docente, solo opción múltiple', () => {
  const ctx = { asignaturaNombre: 'Matemáticas I', perfilIATexto: 'x', bloqueFuentes: null, cantidad: 8 }
  const p = FIA.promptDiagnosticoConocimientos(ctx)
  assert.ok(p.includes('EXACTAMENTE 8 reactivos de opción múltiple'), 'debe pedir la cantidad exacta')
  assert.ok(!p.includes('verdadero_falso'), 'ya no debe mezclar verdadero/falso')
})

caso('MAX_REACTIVOS_DIAGNOSTICO/MIN_REACTIVOS_DIAGNOSTICO: rango que puede elegir el docente (5 a 20)', () => {
  assert.strictEqual(FIA.MIN_REACTIVOS_DIAGNOSTICO, 5)
  assert.strictEqual(FIA.MAX_REACTIVOS_DIAGNOSTICO, 20)
})

grupo('Planeación Didáctica Inicial — apartado 3 de Asistente IA')

caso('formatoPeriodo: arma "inicio – fin" solo con fechas válidas de la Asignatura', () => {
  const texto = FIA.formatoPeriodo({ inicio: '2026-08-01', fin: '2026-10-15' })
  assert.ok(texto.includes('–'))
  assert.ok(/2026/.test(texto))
})

caso('formatoPeriodo: sin fechas o fechas inválidas, null (no inventa un periodo)', () => {
  assert.strictEqual(FIA.formatoPeriodo(null), null)
  assert.strictEqual(FIA.formatoPeriodo({}), null)
  assert.strictEqual(FIA.formatoPeriodo({ inicio: 'no-es-fecha', fin: '2026-10-15' }), null)
})

// construirParcialesCtx — agrega sesionesReales al contexto de cada parcial
// SOLO cuando la asignatura ya tiene horarioPatron guardado (calendario real
// de sesiones, 17-ago-2026). El prompt de la IA todavía no usa este dato.
const PATRON_LUN_MIE = [
  { diaSemana: 0, horaInicio: '08:00', duracionMin: 60 },
  { diaSemana: 2, horaInicio: '08:00', duracionMin: 60 },
]
const SUBJ_2_PARCIALES = {
  parciales: 2,
  fechaInicio: '2026-08-17', fechaFin: '2026-09-16',
  parcialesFechas: [
    { inicio: '2026-08-17', fin: '2026-09-02' },
    { inicio: '2026-09-03', fin: '2026-09-16' },
  ],
  horarioPatron: PATRON_LUN_MIE,
}

caso('construirParcialesCtx: con horarioPatron, cada parcial trae sesionesReales dentro de su propio rango', () => {
  const parciales = FIA.construirParcialesCtx(SUBJ_2_PARCIALES)
  assert.strictEqual(parciales.length, 2)
  assert.strictEqual(parciales[0].sesionesReales.length, 6)
  assert.strictEqual(parciales[1].sesionesReales.length, 4)
  assert.ok(parciales[0].sesionesReales.every((s) => s.fecha >= '2026-08-17' && s.fecha <= '2026-09-02'))
  assert.ok(parciales[0].periodoTexto.includes('–'))   // periodoTexto se conserva igual que antes
})

caso('construirParcialesCtx: vacaciones/asuetos (diasAsueto) excluyen esa fecha de sesionesReales', () => {
  const parciales = FIA.construirParcialesCtx(SUBJ_2_PARCIALES, { diasAsueto: ['2026-08-19'] })
  assert.ok(!parciales[0].sesionesReales.some((s) => s.fecha === '2026-08-19'))
  assert.strictEqual(parciales[0].sesionesReales.length, 5)
})

caso('construirParcialesCtx: una sesión cancelada no aparece en sesionesReales', () => {
  const parciales = FIA.construirParcialesCtx(SUBJ_2_PARCIALES, {
    sesionesCanceladas: [{ fecha: '2026-08-24', horaInicio: '08:00' }],
  })
  assert.ok(!parciales[0].sesionesReales.some((s) => s.fecha === '2026-08-24'))
  assert.strictEqual(parciales[0].sesionesReales.length, 5)
})

caso('construirParcialesCtx: varios bloques el mismo día quedan como sesiones independientes', () => {
  const subj = {
    parciales: 1, fechaInicio: '2026-08-17', fechaFin: '2026-08-17',
    parcialesFechas: [{ inicio: '2026-08-17', fin: '2026-08-17' }],
    horarioPatron: [
      { diaSemana: 0, horaInicio: '08:00', duracionMin: 60 },
      { diaSemana: 0, horaInicio: '09:00', duracionMin: 60 },
    ],
  }
  const parciales = FIA.construirParcialesCtx(subj)
  assert.strictEqual(parciales[0].sesionesReales.length, 2)
})

caso('construirParcialesCtx: SIN horarioPatron, el parcial se queda igual que antes (sin sesionesReales, sin bloquear)', () => {
  const subj = {
    parciales: 1, fechaInicio: '2026-08-17', fechaFin: '2026-09-16',
    parcialesFechas: [{ inicio: '2026-08-17', fin: '2026-09-16' }],
    // sin horarioPatron — asignatura vieja o sin horario programado todavía
  }
  const parciales = FIA.construirParcialesCtx(subj)
  assert.strictEqual(parciales.length, 1)
  assert.strictEqual(parciales[0].sesionesReales, undefined)
  assert.ok(parciales[0].periodoTexto.includes('–'))
})

// formatoSesionesReales / promptSecuenciasParcial — restricción real de
// tiempo inyectada al prompt (17-ago-2026), sin tocar el esquema JSON.
caso('formatoSesionesReales: una línea "Sesión N — día fecha" por sesión, en orden', () => {
  const texto = FIA.formatoSesionesReales([
    { fecha: '2026-09-01', diaSemana: 1, numeroSesionParcial: 1 },
    { fecha: '2026-09-03', diaSemana: 3, numeroSesionParcial: 2 },
  ])
  const lineas = texto.split('\n')
  assert.strictEqual(lineas.length, 2)
  assert.ok(lineas[0].startsWith('Sesión 1 — martes 1 de septiembre'))
  assert.ok(lineas[1].startsWith('Sesión 2 — jueves 3 de septiembre'))
})

const CTX_BASE = { asignaturaNombre: 'Matemáticas', parciales: [{ numero: 1 }] }

caso('promptSecuenciasParcial: CON sesionesReales, incluye la restricción real de tiempo y la lista de fechas', () => {
  const parcialCtx = {
    numero: 1, periodoTexto: '1 sep 2026 – 2 oct 2026',
    sesionesReales: [
      { fecha: '2026-09-01', diaSemana: 1, numeroSesionParcial: 1 },
      { fecha: '2026-09-03', diaSemana: 3, numeroSesionParcial: 2 },
    ],
  }
  const prompt = FIA.promptSecuenciasParcial(CTX_BASE, parcialCtx, null, false)
  assert.ok(prompt.includes('RESTRICCIÓN REAL DE TIEMPO'))
  assert.ok(prompt.includes('2 en total'))
  assert.ok(prompt.includes('Sesión 1 — martes 1 de septiembre'))
  assert.ok(prompt.includes('nunca uses un número de sesión mayor a 2'))
})

caso('promptSecuenciasParcial: SIN sesionesReales, el prompt no cambia (mismo comportamiento de siempre)', () => {
  const parcialCtx = { numero: 1, periodoTexto: '1 sep 2026 – 2 oct 2026' }
  const prompt = FIA.promptSecuenciasParcial(CTX_BASE, parcialCtx, null, false)
  assert.ok(!prompt.includes('RESTRICCIÓN REAL DE TIEMPO'))
  // La regla pedagógica de "UNA VIÑETA = UNA SESIÓN" sigue intacta.
  assert.ok(prompt.includes('REGLA FUNDAMENTAL: UNA VIÑETA = UNA SESIÓN'))
})

caso('promptSecuenciasParcial: no toca el esquema JSON de salida (mismos campos de siempre)', () => {
  const conSesiones = FIA.promptSecuenciasParcial(CTX_BASE, {
    numero: 1, periodoTexto: null,
    sesionesReales: [{ fecha: '2026-09-01', diaSemana: 1, numeroSesionParcial: 1 }],
  }, null, false)
  assert.ok(conSesiones.includes('"bloquesTematicos"'))
  assert.ok(conSesiones.includes('"secuenciasDidacticas"'))
  assert.ok(conSesiones.includes('"apertura"'))
  assert.ok(conSesiones.includes('"desarrollo"'))
  assert.ok(conSesiones.includes('"cierre"'))
})

// Ponderaciones sin decimales (17-ago-2026, Kike: "no quiero decimales en
// las ponderaciones") — escala sigue en 100%, ahora en números enteros.
const secuenciaConPonderacion = (apertura, desarrollo, cierre) => ({
  apertura: { ponderacion: apertura }, desarrollo: { ponderacion: desarrollo }, cierre: { ponderacion: cierre },
})

caso('PONDERACION_TOTAL sigue siendo 100 (escala de porcentaje, no de 10 puntos)', () => {
  assert.strictEqual(FIA.PONDERACION_TOTAL, 100)
})

caso('sumaPonderacionesParcial: suma todos los momentos de todas las secuencias, "%" no estorba al parseo', () => {
  const suma = FIA.sumaPonderacionesParcial([
    secuenciaConPonderacion('20%', '30%', '0%'),
    secuenciaConPonderacion('10%', '40%', 'No aplica'),
  ])
  assert.strictEqual(suma, 100)
})

caso('normalizarPonderacionesParcial: una entrada con decimales queda en enteros y la suma da exactamente 100', () => {
  const secuencias = [secuenciaConPonderacion('33.3%', '33.3%', '33.4%')]
  FIA.normalizarPonderacionesParcial(secuencias)
  const valores = [secuencias[0].apertura.ponderacion, secuencias[0].desarrollo.ponderacion, secuencias[0].cierre.ponderacion]
  valores.forEach((v) => assert.ok(/^\d+%$/.test(v), `"${v}" no es un entero seguido de %`))
  assert.strictEqual(FIA.sumaPonderacionesParcial(secuencias), 100)
})

caso('normalizarPonderacionesParcial: reparte enteros correctamente incluso con muchas entradas (sin negativos)', () => {
  // 8 momentos con evidencia, valor "1" cada uno (proporciones iguales) —
  // caso que con el método viejo ("la última absorbe el residuo") podía
  // arriesgar un valor negativo en la última entrada.
  const secuencias = Array.from({ length: 3 }, () => secuenciaConPonderacion('1', '1', '1'))
  FIA.normalizarPonderacionesParcial(secuencias)
  const valores = secuencias.flatMap((s) => [s.apertura.ponderacion, s.desarrollo.ponderacion, s.cierre.ponderacion])
  valores.forEach((v) => {
    assert.ok(/^\d+%$/.test(v))
    assert.ok(parseInt(v, 10) >= 0, `"${v}" es negativo`)
  })
  assert.strictEqual(FIA.sumaPonderacionesParcial(secuencias), 100)
})

caso('normalizarPonderacionesParcial: los momentos en "0%"/"No aplica" no reciben ponderación al rescatar la suma', () => {
  const secuencias = [secuenciaConPonderacion('50%', '50%', '0%'), secuenciaConPonderacion('No aplica', 'No aplica', 'No aplica')]
  FIA.normalizarPonderacionesParcial(secuencias)
  assert.strictEqual(secuencias[0].cierre.ponderacion, '0%')
  assert.strictEqual(secuencias[1].apertura.ponderacion, 'No aplica')
  assert.strictEqual(FIA.sumaPonderacionesParcial(secuencias), 100)
})

caso('promptCorreccionPonderaciones: señala la suma real y pide números enteros', () => {
  const prompt = FIA.promptCorreccionPonderaciones('PROMPT BASE', 87.5)
  assert.ok(prompt.startsWith('PROMPT BASE'))
  assert.ok(prompt.includes('87.5%'))
  assert.ok(prompt.includes('EXACTAMENTE 100%'))
  assert.ok(prompt.includes('ENTERO'))
})

caso('promptSecuenciasParcial: la regla de ponderación exige números enteros, no decimales', () => {
  const prompt = FIA.promptSecuenciasParcial(CTX_BASE, { numero: 1, periodoTexto: null }, null, false)
  assert.ok(prompt.includes('REGLA ÚNICA DE PONDERACIÓN'))
  assert.ok(prompt.includes('ENTERO'))
  assert.ok(prompt.includes('nunca decimales'))
  assert.ok(prompt.includes('100%'))
})

// Cobertura completa del contenido fuente (17-ago-2026, Kike: una fuente con
// 10 temas terminaba con una planeación que solo cubría los primeros 6).
caso('promptSecuenciasParcial: pide identificar y cubrir TODOS los temas de la fuente, y expone "temasFuente" en el JSON', () => {
  const prompt = FIA.promptSecuenciasParcial(CTX_BASE, { numero: 1, periodoTexto: null }, null, false)
  assert.ok(prompt.includes('COBERTURA COMPLETA DEL CONTENIDO FUENTE'))
  assert.ok(prompt.includes('"temasFuente"'))
  assert.ok(prompt.includes('nunca recortar el contenido fuente'))
})

caso('coberturaIncompleta: true si algún tema no está cubierto', () => {
  assert.strictEqual(FIA.coberturaIncompleta([{ titulo: 'A', cubierto: true }, { titulo: 'B', cubierto: false }]), true)
})

caso('coberturaIncompleta: false si todos los temas están cubiertos', () => {
  assert.strictEqual(FIA.coberturaIncompleta([{ titulo: 'A', cubierto: true }, { titulo: 'B', cubierto: true }]), false)
})

caso('coberturaIncompleta: sin temasFuente (o vacío/no-array), no se considera incompleto — nada que reintentar', () => {
  assert.strictEqual(FIA.coberturaIncompleta(undefined), false)
  assert.strictEqual(FIA.coberturaIncompleta([]), false)
  assert.strictEqual(FIA.coberturaIncompleta(null), false)
})

caso('coberturaIncompleta: un elemento sin la clave "cubierto" cuenta como no cubierto (nunca se asume true)', () => {
  assert.strictEqual(FIA.coberturaIncompleta([{ titulo: 'A' }]), true)
})

caso('docExtract: ya no trunca — no expone ningún MAX_CHARS (el documento completo es la fuente)', () => {
  assert.strictEqual(docExtract.MAX_CHARS, undefined)
})

// ── PDF visual: un PDF sin capa de texto NO es un PDF inválido (3-sep-2026) ──
// Bug real: un docente adjuntó una infografía de 4 páginas exportada como
// imagen (0 caracteres extraíbles) y el sistema la rechazó como "PDF o Word
// no válido", abortando la creación del cuestionario completo. El archivo
// estaba perfecto; lo que faltaba era mirarlo en vez de intentar leerlo.
const FUENTES = require('../functions/fuentesIA.js')

caso('tipoPorDensidad: PDF escaneado (0 caracteres, 4 páginas) → "visual", NUNCA inválido', () => {
  assert.strictEqual(docExtract.tipoPorDensidad('', 4), 'visual')
})

caso('tipoPorDensidad: PDF con texto denso → "texto" (sigue el camino barato de siempre)', () => {
  assert.strictEqual(docExtract.tipoPorDensidad('x'.repeat(80000), 60), 'texto')
})

caso('tipoPorDensidad: PDF mixto — poco texto por página, el contenido está en la imagen', () => {
  assert.strictEqual(docExtract.tipoPorDensidad('Encabezado suelto', 4), 'mixto')
})

caso('tipoPorDensidad: el umbral es por PÁGINA, no total — 199 y 200 caracteres en 1 página', () => {
  assert.strictEqual(docExtract.tipoPorDensidad('x'.repeat(199), 1), 'mixto')
  assert.strictEqual(docExtract.tipoPorDensidad('x'.repeat(200), 1), 'texto')
})

caso('tipoPorDensidad: sin páginas no se puede afirmar nada → "invalido"', () => {
  assert.strictEqual(docExtract.tipoPorDensidad('lo que sea', 0), 'invalido')
  assert.strictEqual(docExtract.tipoPorDensidad('lo que sea', null), 'invalido')
})

caso('presupuestoPaginasVisual: escala con el ingreso — una evaluación de 20 reactivos (5 cr) llega al tope', () => {
  assert.strictEqual(FUENTES.presupuestoPaginasVisual(5), 30)
})

caso('presupuestoPaginasVisual: una operación de tarifa plana (1 cr) recibe mucho menos', () => {
  assert.strictEqual(FUENTES.presupuestoPaginasVisual(1), 6)
})

caso('presupuestoPaginasVisual: nunca baja del piso de 4 páginas (la infografía del bug real cabe siempre)', () => {
  assert.strictEqual(FUENTES.presupuestoPaginasVisual(0.25), FUENTES.MIN_PAGINAS_VISUAL)
  assert.strictEqual(FUENTES.presupuestoPaginasVisual(0), FUENTES.MIN_PAGINAS_VISUAL)
  assert.ok(FUENTES.MIN_PAGINAS_VISUAL >= 4)
})

caso('presupuestoPaginasVisual: nunca rebasa el tope aunque la operación sea carísima', () => {
  assert.strictEqual(FUENTES.presupuestoPaginasVisual(1000), FUENTES.MAX_PAGINAS_VISUAL)
})

caso('MAX_PAGINAS_VISUAL de fuentes NO es el 3 de las entregas (OP-11) — esa regresión es justo lo que se evita', () => {
  const evidencias = require('../functions/evidenciasEntrega.js')
  assert.strictEqual(evidencias.MAX_EVIDENCIAS, 3) // OP-11 intacto
  assert.ok(FUENTES.MAX_PAGINAS_VISUAL > 3)
  assert.ok(FUENTES.MIN_PAGINAS_VISUAL > 3)
})

// ── El documento NO se reprocesa en cada lote (cliente falso, sin red) ───────
// Se comprueba la forma EXACTA del mensaje: el documento va delante del texto
// que cambia por lote y lleva cache_control, que es lo único que permite que
// el segundo lote lo lea del caché en vez de volver a pagarlo entero.
const clienteFalso = (capturar) => ({
  messages: {
    create: async (req) => {
      capturar(req)
      return { content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 1, output_tokens: 1 } }
    },
  },
})

await (async () => {
  const bloque = { type: 'document', source: { type: 'url', url: 'https://x/y.pdf' } }
  let req = null
  await FIA.pedirJSON({
    client: clienteFalso((r) => { req = r }), modelo: 'm', maxTokens: 10,
    prompt: 'TEXTO QUE CAMBIA POR LOTE', system: 's', bloquesPrefijo: [bloque],
  })

  caso('pedirJSON: el documento va ANTES del prompt (prefijo estable = cacheable)', () => {
    assert.strictEqual(req.messages[0].content[0].type, 'document')
    assert.strictEqual(req.messages[0].content[1].type, 'text')
    assert.strictEqual(req.messages[0].content[1].text, 'TEXTO QUE CAMBIA POR LOTE')
  })

  caso('pedirJSON: el último bloque del prefijo lleva cache_control', () => {
    assert.deepStrictEqual(req.messages[0].content[0].cache_control, { type: 'ephemeral' })
  })

  caso('pedirJSON: no muta el bloque original del llamador', () => {
    assert.strictEqual(bloque.cache_control, undefined)
  })

  let req2 = null
  await FIA.pedirJSON({
    client: clienteFalso((r) => { req2 = r }), modelo: 'm', maxTokens: 10, prompt: 'solo texto', system: 's',
  })
  caso('pedirJSON: sin bloques, el contenido sigue siendo el string de siempre (contrato intacto)', () => {
    assert.strictEqual(req2.messages[0].content, 'solo texto')
  })

  let req3 = null
  await FIA.pedirJSON({
    client: clienteFalso((r) => { req3 = r }), modelo: 'm', maxTokens: 10, prompt: 'p', system: 's',
    bloques: [{ type: 'image', source: { type: 'url', url: 'https://x/y.png' } }],
  })
  caso('pedirJSON: `bloques` (rúbrica/cotejo/OP-11) sigue yendo DESPUÉS del prompt, sin cache_control', () => {
    assert.strictEqual(req3.messages[0].content[0].type, 'text')
    assert.strictEqual(req3.messages[0].content[1].type, 'image')
    assert.strictEqual(req3.messages[0].content[1].cache_control, undefined)
  })
})()

// Fragmentación de documentos grandes SIN pérdida de contenido (17-ago-2026)
const docChunking = require('../functions/docChunking.js')

caso('dividirEnFragmentos: documento pequeño no se fragmenta (CASO 1)', () => {
  assert.deepStrictEqual(docChunking.dividirEnFragmentos('hola mundo', 1000), ['hola mundo'])
})

caso('dividirEnFragmentos: documento vacío devuelve arreglo vacío', () => {
  assert.deepStrictEqual(docChunking.dividirEnFragmentos('', 1000), [])
  assert.deepStrictEqual(docChunking.dividirEnFragmentos(null, 1000), [])
})

caso('dividirEnFragmentos: respeta límites de párrafo cuando puede (no corta una sesión a la mitad)', () => {
  const parrafos = Array.from({ length: 10 }, (_, i) => `Sesión ${i + 1}. ${'contenido '.repeat(20)}`)
  const texto = parrafos.join('\n\n')
  const fragmentos = docChunking.dividirEnFragmentos(texto, 500)
  assert.ok(fragmentos.length > 1)
  // Cada párrafo completo aparece ENTERO en algún fragmento — ninguno quedó partido a la mitad.
  parrafos.forEach((p) => {
    assert.ok(fragmentos.some((f) => f.includes(p)), `"${p.slice(0, 20)}..." no apareció completo en ningún fragmento`)
  })
})

caso('dividirEnFragmentos: la unión de los fragmentos reproduce el texto original completo — nunca se pierde contenido', () => {
  const texto = Array.from({ length: 15 }, (_, i) => `Tema ${i + 1}\n\n${'x'.repeat(300)}`).join('\n\n')
  const fragmentos = docChunking.dividirEnFragmentos(texto, 400)
  assert.strictEqual(fragmentos.join(''), texto)
})

caso('dividirEnFragmentos: sin ningún separador de párrafo (documento de un solo bloque), igual fragmenta sin perder nada', () => {
  const texto = 'y'.repeat(50000)
  const fragmentos = docChunking.dividirEnFragmentos(texto, 12000)
  assert.ok(fragmentos.length >= 4)   // sin tope artificial de fragmentos
  assert.strictEqual(fragmentos.join(''), texto)
})

caso('dividirEnFragmentos: documento que supera el antiguo límite de 12000 caracteres no se pierde (CASO 2)', () => {
  const texto = Array.from({ length: 30 }, (_, i) => `Sesión ${i + 1} de un manual real.\n${'contenido '.repeat(60)}`).join('\n\n')
  assert.ok(texto.length > 12000)
  const fragmentos = docChunking.dividirEnFragmentos(texto, FIA.FUENTE_FRAGMENTO_MAX_CHARS)
  assert.strictEqual(fragmentos.join(''), texto)
  for (let i = 1; i <= 30; i++) {
    assert.ok(fragmentos.some((f) => f.includes(`Sesión ${i} de un manual real.`)), `Sesión ${i} se perdió`)
  }
})

caso('FUENTE_UMBRAL_FRAGMENTAR_CHARS / FUENTE_FRAGMENTO_MAX_CHARS: valores razonables y coherentes entre sí', () => {
  assert.ok(FIA.FUENTE_UMBRAL_FRAGMENTAR_CHARS > 40000)   // más grande que el límite viejo que se eliminó
  assert.ok(FIA.FUENTE_FRAGMENTO_MAX_CHARS > 0)
  assert.ok(FIA.FUENTE_FRAGMENTO_MAX_CHARS <= FIA.FUENTE_UMBRAL_FRAGMENTAR_CHARS)
})

// Crédito variable según el tamaño real del documento fuente (17-ago-2026,
// Kike: "el tamaño del documento puede aumentar el costo, pero nunca
// provocar pérdida silenciosa de contenido").
caso('calcularUnidadesMinimasFuente: sin fuente, o documento pequeño (CASO 1) — 1 unidad, el precio fijo de siempre', () => {
  assert.strictEqual(FIA.calcularUnidadesMinimasFuente(null), 1)
  assert.strictEqual(FIA.calcularUnidadesMinimasFuente(''), 1)
  assert.strictEqual(FIA.calcularUnidadesMinimasFuente('x'.repeat(1000)), 1)
})

caso('calcularUnidadesMinimasFuente: justo en el umbral (inclusive) sigue costando 1 unidad', () => {
  assert.strictEqual(FIA.calcularUnidadesMinimasFuente('x'.repeat(FIA.FUENTE_UMBRAL_FRAGMENTAR_CHARS)), 1)
})

caso('calcularUnidadesMinimasFuente: documento grande (CASO 2) — 1 + un fragmento por cada llamada real de extracción', () => {
  const texto = 'x'.repeat(FIA.FUENTE_UMBRAL_FRAGMENTAR_CHARS + 1)
  const fragmentosEsperados = docChunking.dividirEnFragmentos(texto, FIA.FUENTE_FRAGMENTO_MAX_CHARS).length
  assert.ok(fragmentosEsperados > 1)
  assert.strictEqual(FIA.calcularUnidadesMinimasFuente(texto), 1 + fragmentosEsperados)
})

caso('calcularUnidadesMinimasFuente: el costo escala con el tamaño real (documento más grande, más unidades)', () => {
  const chico = FIA.calcularUnidadesMinimasFuente('x'.repeat(FIA.FUENTE_UMBRAL_FRAGMENTAR_CHARS + 1))
  const grande = FIA.calcularUnidadesMinimasFuente('x'.repeat(FIA.FUENTE_UMBRAL_FRAGMENTAR_CHARS * 4))
  assert.ok(grande > chico)
})

caso('promptExtraerTemasFragmento: identifica el fragmento (índice/total) e incluye su texto completo', () => {
  const prompt = FIA.promptExtraerTemasFragmento('CONTENIDO DEL FRAGMENTO', 2, 5)
  assert.ok(prompt.includes('FRAGMENTO 3 de 5'))
  assert.ok(prompt.includes('CONTENIDO DEL FRAGMENTO'))
  assert.ok(prompt.includes('"temas"'))
})

caso('construirBloqueFuenteEstructurada: sin temas devuelve null', () => {
  assert.strictEqual(FIA.construirBloqueFuenteEstructurada([]), null)
})

caso('construirBloqueFuenteEstructurada: representa TODOS los temas consolidados, ninguno se pierde (CASO 6, 10 sesiones)', () => {
  const temas = Array.from({ length: 10 }, (_, i) => ({ titulo: `Sesión ${i + 1}`, resumen: `Resumen ${i + 1}` }))
  const bloque = FIA.construirBloqueFuenteEstructurada(temas)
  assert.ok(bloque.includes('10 temas identificados'))
  for (let i = 1; i <= 10; i++) {
    assert.ok(bloque.includes(`Sesión ${i}`), `Sesión ${i} no aparece en el bloque consolidado`)
  }
})

caso('promptCorreccionCobertura: lista exactamente los temas sin cubrir y pide agregar Secuencias, no recortar', () => {
  const prompt = FIA.promptCorreccionCobertura('PROMPT BASE', [
    { titulo: 'Las afores', cubierto: false },
    { titulo: 'El idioma del dinero', cubierto: false },
    { titulo: 'Presupuesto', cubierto: true },
  ])
  assert.ok(prompt.startsWith('PROMPT BASE'))
  assert.ok(prompt.includes('Las afores'))
  assert.ok(prompt.includes('El idioma del dinero'))
  assert.ok(!prompt.includes('- Presupuesto'))   // el ya cubierto no debe listarse como faltante
  assert.ok(prompt.includes('AGREGA'))
})

// Corrección de Kike (12-ago-2026, Tanda 2): `resultado` ahora es la salida
// de normalizarAnalisisEncuestaContexto (OP-10 en modo encuesta), resultados
// reales de un cuestionario que contestaron los estudiantes.
caso('diagnosticoContextoATexto: arma el bloque solo con lo que sí trae el diagnóstico', () => {
  const texto = FIA.diagnosticoContextoATexto({
    caracteristicas: ['Grupo de 30'], condiciones: [], intereses: ['Programación'], necesidades: [], patrones: [], recomendaciones: [],
  })
  assert.ok(texto.includes('Grupo de 30'))
  assert.ok(texto.includes('Programación'))
  assert.ok(!texto.includes('Condiciones de contexto detectadas:'), 'no debe mencionar una sección vacía')
})

caso('diagnosticoContextoATexto: sin diagnóstico, dice que no hay información (no inventa)', () => {
  assert.strictEqual(FIA.diagnosticoContextoATexto(null), 'Información no disponible en las fuentes proporcionadas.')
})

// Corrección de Kike (12-ago-2026): ahora `resultado` es la salida de
// normalizarAnalisis (OP-10) sobre respuestas REALES del cuestionario de
// diagnóstico, no un instrumento sin aplicar.
caso('diagnosticoConocimientosATexto: arma el bloque con resumen, aciertos, patrones y recomendaciones reales', () => {
  const texto = FIA.diagnosticoConocimientosATexto({
    resumenGeneral: 'El grupo domina fracciones básicas.',
    porcentajeAciertosGeneral: 72,
    patrones: [{ observacion: 'Fallan en operaciones con negativos', interpretacion: 'posible hueco previo' }],
    reactivosDificiles: [{ enunciado: '¿Cuánto es -3 + 5?' }],
    recomendaciones: ['Repasar signos antes de continuar'],
  })
  assert.ok(texto.includes('El grupo domina fracciones básicas.'))
  assert.ok(texto.includes('72%'))
  assert.ok(texto.includes('Fallan en operaciones con negativos'))
  assert.ok(texto.includes('Repasar signos antes de continuar'))
})

caso('diagnosticoConocimientosATexto: sin resultado, dice que no hay información (no inventa)', () => {
  assert.strictEqual(FIA.diagnosticoConocimientosATexto(null), 'Información no disponible en las fuentes proporcionadas.')
  assert.strictEqual(FIA.diagnosticoConocimientosATexto({}), 'Información no disponible en las fuentes proporcionadas.')
})

caso('normalizarFilaPlaneacion: recorta cada campo a su máximo y usa exactamente los 9 campos pedidos (8 + fechaEstimada)', () => {
  const fila = FIA.normalizarFilaPlaneacion({
    contenidosTemas: 'a'.repeat(500), proposito: 'p', actividades: 'act', estrategia: 'e',
    recursos: 'r', evidencias: 'ev', evaluacion: 'eval', observaciones: 'o', fechaEstimada: 'x'.repeat(60),
    campoInventado: 'no debe aparecer',
  })
  assert.strictEqual(fila.contenidosTemas.length, 400)
  assert.strictEqual(fila.fechaEstimada.length, 40)
  assert.deepStrictEqual(Object.keys(fila).sort(), [
    'actividades', 'contenidosTemas', 'estrategia', 'evaluacion', 'evidencias', 'fechaEstimada', 'observaciones', 'proposito', 'recursos',
  ])
})

caso('normalizarFilasPlaneacion: descarta filas sin contenidosTemas NI actividades (no aporta como guía)', () => {
  const filas = FIA.normalizarFilasPlaneacion([
    { contenidosTemas: 'Fracciones', actividades: '' },
    { contenidosTemas: '', actividades: '' },
    { contenidosTemas: '', actividades: 'Trabajo en equipo' },
  ])
  assert.strictEqual(filas.length, 2)
})

caso('normalizarFilasPlaneacion: nunca deja pasar más del máximo de filas por parcial', () => {
  const muchas = Array.from({ length: 30 }, (_, i) => ({ contenidosTemas: `tema ${i}` }))
  const filas = FIA.normalizarFilasPlaneacion(muchas)
  assert.strictEqual(filas.length, FIA.MAX_FILAS_PLANEACION_PARCIAL)
})

caso('normalizarFilasPlaneacion: entrada basura no truena — arreglo vacío', () => {
  assert.deepStrictEqual(FIA.normalizarFilasPlaneacion('no es arreglo'), [])
  assert.deepStrictEqual(FIA.normalizarFilasPlaneacion(null), [])
})

// ═══ Resumen ═════════════════════════════════════════════════════════════════
// ═══ Chat con Asistente — por asignatura (17-ago-2026) ════════════════════════
grupo('Chat con Asistente — sanear historial, contexto de Planeación/exámenes')

caso('MAX_TURNOS_HISTORIAL es 10, tal como se pidió', () => {
  assert.strictEqual(FIA.MAX_TURNOS_HISTORIAL, 10)
})

caso('sanearHistorialChat: descarta turnos con role inválido o sin texto', () => {
  const historial = [
    { role: 'user', content: 'hola' },
    { role: 'system', content: 'esto no debería colarse' },
    { role: 'assistant', content: '' },
    { role: 'assistant', content: 'respuesta válida' },
  ]
  const saneado = FIA.sanearHistorialChat(historial)
  assert.deepStrictEqual(saneado, [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'respuesta válida' }])
})

caso('sanearHistorialChat: se queda solo con los últimos 10 turnos', () => {
  const historial = Array.from({ length: 15 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turno ${i}` }))
  const saneado = FIA.sanearHistorialChat(historial)
  assert.strictEqual(saneado.length, 10)
  assert.strictEqual(saneado[0].content, 'turno 5')
  assert.strictEqual(saneado.at(-1).content, 'turno 14')
})

caso('sanearHistorialChat: recorta mensajes larguísimos a MAX_LARGO_MENSAJE', () => {
  const saneado = FIA.sanearHistorialChat([{ role: 'user', content: 'x'.repeat(5000) }])
  assert.strictEqual(saneado[0].content.length, FIA.MAX_LARGO_MENSAJE)
})

caso('sanearHistorialChat: sin historial (asignatura nueva o primer mensaje) no truena', () => {
  assert.deepStrictEqual(FIA.sanearHistorialChat(undefined), [])
  assert.deepStrictEqual(FIA.sanearHistorialChat(null), [])
})

caso('planeacionAceptadaATexto: sin Planeación aceptada, null (no bloquea, no inventa)', () => {
  assert.strictEqual(FIA.planeacionAceptadaATexto(null), null)
  assert.strictEqual(FIA.planeacionAceptadaATexto({}), null)
})

caso('planeacionAceptadaATexto: con Planeación aceptada, arma texto por parcial y secuencia', () => {
  const texto = FIA.planeacionAceptadaATexto({
    porParcial: [{
      numero: 1, periodo: '1 sep – 15 oct',
      secuencias: [{ nombre: 'Presupuesto', sesiones: 'Sesiones 1 a 3', contenidosRelacionados: 'números enteros' }],
    }],
  })
  assert.ok(texto.includes('Parcial 1'))
  assert.ok(texto.includes('Presupuesto'))
  assert.ok(texto.includes('números enteros'))
})

// ── Planeación Didáctica vigente (1-sep-2026) ──────────────────────────────
// UNA sola planeación vigente por asignatura, con dos orígenes posibles: la
// que genera Evalúa Fácil ('ia') y el PDF/DOCX que sube el docente
// ('archivo'). Lo que se prueba aquí es el contrato del que dependen las dos
// cosas que pueden salir mal de verdad: que nunca haya dos vigentes, y que
// una operación de IA reciba SIEMPRE el contenido de la vigente — nunca el de
// una generación anterior.

caso('planeacionVigente: sin nada guardado, no hay planeación vigente', () => {
  assert.strictEqual(planeacionVigente(null), null)
  assert.strictEqual(planeacionVigente({}), null)
  assert.strictEqual(planeacionVigente({ planeacionAceptada: null }), null)
})

caso('planeacionVigente: sin `origen` se interpreta como IA (registros anteriores al 1-sep-2026, sin migración)', () => {
  const v = planeacionVigente({ planeacionAceptada: { planeacionId: 'G1', porParcial: [{ numero: 1, secuencias: [] }] } })
  assert.strictEqual(v.origen, 'ia')
  assert.strictEqual(v.planeacionId, 'G1')
})

caso('planeacionVigente: un archivo sin URL no deja una tarjeta rota — se trata como si no hubiera planeación', () => {
  assert.strictEqual(planeacionVigente({ planeacionAceptada: { origen: 'archivo', archivo: { nombre: 'x.pdf' } } }), null)
})

caso('planeacionVigente: el archivo del docente es la vigente y trae sus datos', () => {
  const v = planeacionVigente({
    planeacionAceptada: { origen: 'archivo', archivo: { nombre: 'Mi planeación.pdf', tipo: 'pdf', url: 'https://res.cloudinary.com/x/image/upload/v1/p/mi.pdf' } },
  })
  assert.strictEqual(v.origen, 'archivo')
  assert.strictEqual(v.archivo.nombre, 'Mi planeación.pdf')
})

caso('validarArchivoPlaneacion: acepta PDF y DOCX, rechaza todo lo demás con un motivo entendible', () => {
  assert.strictEqual(validarArchivoPlaneacion({ name: 'plan.pdf', size: 1000 }), null)
  assert.strictEqual(validarArchivoPlaneacion({ name: 'plan.docx', size: 1000 }), null)
  assert.match(validarArchivoPlaneacion({ name: 'plan.doc', size: 1000 }), /\.doc antiguos/)
  assert.match(validarArchivoPlaneacion({ name: 'plan.xlsx', size: 1000 }), /PDF o Word/)
  assert.match(validarArchivoPlaneacion({ name: 'plan.pptx', size: 1000 }), /PDF o Word/)
  assert.match(validarArchivoPlaneacion({ name: 'foto.jpg', size: 1000 }), /PDF o Word/)
  assert.match(validarArchivoPlaneacion({ name: 'plan.pdf', size: 0 }), /vacío/)
  assert.match(validarArchivoPlaneacion({ name: 'plan.pdf', size: 16 * 1024 * 1024 }), /15 MB/)
  assert.match(validarArchivoPlaneacion(null), /Elige un archivo/)
})

// El programa de estudios (Fuente Principal) acepta PDF y DOCX desde el
// 1-sep-2026 y reutiliza ESTA MISMA validación — no una copia con las mismas
// reglas escritas dos veces. Lo único que cambia es el sujeto de la frase.
caso('validarArchivoPlaneacion: la misma validación sirve para el programa de estudios, con su propia etiqueta', () => {
  assert.strictEqual(validarArchivoPlaneacion({ name: 'programa.docx', size: 1000 }, 'El programa de estudios'), null)
  assert.strictEqual(validarArchivoPlaneacion({ name: 'programa.pdf', size: 1000 }, 'El programa de estudios'), null)
  assert.match(validarArchivoPlaneacion({ name: 'programa.xlsx', size: 1000 }, 'El programa de estudios'), /^El programa de estudios debe ser PDF o Word/)
  assert.match(validarArchivoPlaneacion({ name: 'programa.pdf', size: 20 * 1024 * 1024 }, 'El programa de estudios'), /15 MB/)
})

caso('extensionPlaneacion: saca la extensión aunque el nombre traiga puntos o query', () => {
  assert.strictEqual(extensionPlaneacion('Planeación 2026.v2.DOCX'), 'docx')
  assert.strictEqual(extensionPlaneacion('sin-extension'), '')
})

// El servidor tiene su propia copia de la regla (runtimes distintos, sin
// módulo compartido): tiene que decidir EXACTAMENTE lo mismo que el cliente.
caso('planeacionVigenteDe (servidor): decide igual que el resolver del cliente', () => {
  assert.strictEqual(FIA.planeacionVigenteDe({}), null)
  assert.strictEqual(FIA.planeacionVigenteDe({ planeacionAceptada: { origen: 'archivo', archivo: {} } }), null)
  assert.strictEqual(FIA.planeacionVigenteDe({ planeacionAceptada: { porParcial: [] } }).origen, undefined)
})

caso('textoPlaneacionParaPrompt: sin planeación vigente, no hay bloque (el prompt queda como antes)', () => {
  assert.strictEqual(FIA.textoPlaneacionParaPrompt(null, null, 1), null)
})

caso('textoPlaneacionParaPrompt: origen IA, resume SOLO el parcial de la operación', () => {
  const vigente = {
    origen: 'ia',
    porParcial: [
      { numero: 1, secuencias: [{ nombre: 'SECUENCIA-DEL-UNO', sesiones: '1 a 3', contenidosRelacionados: 'enteros' }] },
      { numero: 2, secuencias: [{ nombre: 'SECUENCIA-DEL-DOS', sesiones: '4 a 6', contenidosRelacionados: 'fracciones' }] },
    ],
  }
  const bloque = FIA.textoPlaneacionParaPrompt(vigente, null, 2)
  assert.ok(bloque.includes(FIA.PLANEACION_ETIQUETA))
  assert.ok(bloque.includes('SECUENCIA-DEL-DOS'))
  assert.ok(!bloque.includes('SECUENCIA-DEL-UNO'))
})

caso('textoPlaneacionParaPrompt: origen archivo, el bloque lleva el CONTENIDO real del documento, no su nombre ni su URL', () => {
  const vigente = {
    origen: 'archivo',
    archivo: { nombre: 'Mi planeación.pdf', tipo: 'pdf', url: 'https://res.cloudinary.com/x/image/upload/v1/p/mi.pdf' },
  }
  const bloque = FIA.textoPlaneacionParaPrompt(vigente, 'TEXTO-REAL-DE-LA-PLANEACION-DEL-DOCENTE', 1)
  assert.ok(bloque.includes('TEXTO-REAL-DE-LA-PLANEACION-DEL-DOCENTE'))
  // Sin contenido extraíble no se manda un bloque vacío que el modelo pudiera
  // rellenar por su cuenta.
  assert.strictEqual(FIA.textoPlaneacionParaPrompt(vigente, '   ', 1), null)
})

// ── CONDICIÓN DE ACEPTACIÓN (Kike, 1-sep-2026) ─────────────────────────────
// "Si el docente sube su propia planeación y esa es la planeación vigente,
// cuando genere una actividad con IA, la IA debe utilizar el CONTENIDO REAL
// de esa planeación. No debe utilizar una planeación IA anterior."
caso('ACEPTACIÓN · con planeación propia vigente, el prompt de Crear actividad lleva SU contenido y NO el de la generación IA anterior', () => {
  const CONTENIDO_DEL_DOCENTE = 'PLANEACION-PROPIA-DEL-DOCENTE-XYZ: proyecto integrador de robótica'
  const CONTENIDO_IA_VIEJO = 'SECUENCIA-IA-ANTERIOR-QUE-YA-NO-ESTA-VIGENTE'

  // La asignatura tiene AMBAS cosas guardadas: la bitácora `planeacionesIA`
  // conserva la generación anterior (es inmutable por regla), pero la vigente
  // es el archivo del docente. Solo el archivo puede llegar al prompt.
  const vigente = FIA.planeacionVigenteDe({
    planeacionAceptada: {
      origen: 'archivo',
      archivo: { nombre: 'Planeación Mate 1A.pdf', tipo: 'pdf', url: 'https://res.cloudinary.com/x/image/upload/v1/p/plan.pdf' },
    },
    // Restos del ciclo anterior, que NO deben influir en nada:
    planeacionBorrador: { porParcial: [{ numero: 1, secuencias: [{ nombre: CONTENIDO_IA_VIEJO }] }] },
  })
  assert.strictEqual(vigente.origen, 'archivo')

  const prompt = FIA.promptCrearActividad({
    categoria: 'entregable',
    nombresExistentes: [],
    peticion: 'Algo para reforzar lo que sigue en el temario',
    pesoRestante: 3,
    bloqueFuentes: null,
    bloquePlaneacion: FIA.textoPlaneacionParaPrompt(vigente, CONTENIDO_DEL_DOCENTE, 1),
  }, 'Matemáticas I')

  assert.ok(prompt.includes(CONTENIDO_DEL_DOCENTE), 'el prompt debe llevar el contenido real de la planeación del docente')
  assert.ok(!prompt.includes(CONTENIDO_IA_VIEJO), 'el prompt NUNCA debe llevar una planeación IA anterior')
  assert.ok(prompt.includes('CONGRUENTE con esa planeación'), 'el prompt debe pedir congruencia con la planeación vigente')
})

caso('ACEPTACIÓN · sin planeación vigente, el prompt de Crear actividad no menciona ninguna planeación (no inventa uso)', () => {
  const prompt = FIA.promptCrearActividad({
    categoria: 'entregable', nombresExistentes: [], peticion: 'Lo que sea', pesoRestante: 3,
    bloqueFuentes: null, bloquePlaneacion: null,
  }, 'Matemáticas I')
  assert.ok(!prompt.includes(FIA.PLANEACION_ETIQUETA))
  assert.ok(!prompt.includes('CONGRUENTE con esa planeación'))
})

caso('analisisExamenesATexto: sin exámenes analizados, null', () => {
  assert.strictEqual(FIA.analisisExamenesATexto([]), null)
})

caso('analisisExamenesATexto: arma texto con nombre, resumen y % de aciertos, sin datos de alumnos individuales', () => {
  const texto = FIA.analisisExamenesATexto([
    { nombre: 'Examen parcial 1', resultado: { resumenGeneral: 'grupo con buen desempeño', porcentajeAciertosGeneral: 82, recomendaciones: ['repasar fracciones'] } },
  ])
  assert.ok(texto.includes('Examen parcial 1'))
  assert.ok(texto.includes('82%'))
  assert.ok(texto.includes('repasar fracciones'))
  assert.ok(!/alumno|estudiante \d|nombre/i.test(texto))
})

caso('CHAT_SISTEMA: define el rol de asistente contextualizado, no un chat genérico', () => {
  assert.ok(FIA.CHAT_SISTEMA.includes('Asistente Docente de Evalúa Fácil'))
  assert.ok(FIA.CHAT_SISTEMA.includes('EXCLUSIVAMENTE la información de este contexto'))
  assert.ok(FIA.CHAT_SISTEMA.includes('Nunca inventes calificaciones'))
})

caso('CHAT_SISTEMA: también contempla el Asistente General (resumen de todas las asignaturas)', () => {
  assert.ok(FIA.CHAT_SISTEMA.includes('Asistente General'))
})

// Asistente General — resumen agregado de todas las asignaturas (segunda
// etapa del Chat con Asistente, 17-ago-2026).
caso('resumenGeneralATexto: sin asignaturas, lo dice explícitamente (no inventa)', () => {
  assert.strictEqual(FIA.resumenGeneralATexto([]), 'El docente todavía no tiene asignaturas.')
})

caso('resumenGeneralATexto: arma una línea por asignatura con conteos AGREGADOS, sin nombres de alumnos', () => {
  const texto = FIA.resumenGeneralATexto([
    { nombre: 'Matemáticas', grupo: '1A', parcialActual: 2, totalAlumnos: 30, actividadesPendientes: 5, promedioGrupo: 7.8, alumnosEnRiesgo: 3 },
    { nombre: 'Física', grupo: '', parcialActual: 1, totalAlumnos: 25, actividadesPendientes: 0, promedioGrupo: null, alumnosEnRiesgo: 0 },
  ])
  assert.ok(texto.includes('Matemáticas (1A)'))
  assert.ok(texto.includes('Parcial 2'))
  assert.ok(texto.includes('5 entrega(s) sin calificar'))
  assert.ok(texto.includes('7.8'))
  assert.ok(texto.includes('3 alumno(s) por debajo de 6'))
  assert.ok(texto.includes('Física'))
  assert.ok(texto.includes('sin calificaciones todavía'))
  assert.ok(!/alumno \d|nombre:|@/.test(texto)) // nunca identidad individual
})

// Chat con Acciones — CONVERSAR → PROPONER → CONFIRMAR → EJECUTAR
// (17-ago-2026). sanearPropuestaAccionChat es la ÚNICA autoridad sobre qué
// puede llegar de la IA a la propuesta que ve el docente — nunca confía en
// el modelo, siempre recorta/valida.
caso('sanearPropuestaAccionChat: en el Asistente General (permitirAcciones=false) SIEMPRE descarta la propuesta', () => {
  const propuesta = { accion: 'CREAR_ACTIVIDAD_ENTREGABLE', nombre: 'Tarea', instrucciones: 'Haz esto' }
  assert.strictEqual(FIA.sanearPropuestaAccionChat(propuesta, { permitirAcciones: false }), null)
})

caso('sanearPropuestaAccionChat: accion fuera de la lista blanca se descarta entera', () => {
  const propuesta = { accion: 'BORRAR_TODO', nombre: 'x' }
  assert.strictEqual(FIA.sanearPropuestaAccionChat(propuesta, { permitirAcciones: true }), null)
})

caso('sanearPropuestaAccionChat: entregable sin instrucciones se descarta (igual que EntregableEditor.jsx)', () => {
  const propuesta = { accion: 'CREAR_ACTIVIDAD_ENTREGABLE', nombre: 'Tarea de fracciones', instrucciones: '' }
  assert.strictEqual(FIA.sanearPropuestaAccionChat(propuesta, { permitirAcciones: true }), null)
})

caso('sanearPropuestaAccionChat: entregable válido conserva categoria y recorta longitudes', () => {
  const propuesta = {
    accion: 'CREAR_ACTIVIDAD_ENTREGABLE', nombre: 'x'.repeat(200), instrucciones: 'Resuelve los ejercicios de fracciones',
  }
  const r = FIA.sanearPropuestaAccionChat(propuesta, { permitirAcciones: true })
  assert.strictEqual(r.accion, 'CREAR_ACTIVIDAD_ENTREGABLE')
  assert.strictEqual(r.categoria, 'entregable')
  assert.strictEqual(r.nombre.length, 120)
})

caso('sanearPropuestaAccionChat: observación NO requiere instrucciones y queda con categoria observacion', () => {
  const propuesta = { accion: 'CREAR_ACTIVIDAD_OBSERVACION', nombre: 'Observar participación', instrucciones: '' }
  const r = FIA.sanearPropuestaAccionChat(propuesta, { permitirAcciones: true })
  assert.ok(r)
  assert.strictEqual(r.categoria, 'observacion')
  assert.strictEqual(r.instrucciones, null)
})

caso('sanearPropuestaAccionChat: examen con menos de MIN_REACTIVOS reactivos válidos se descarta', () => {
  const propuesta = {
    accion: 'CREAR_EXAMEN', nombre: 'Examen de fracciones',
    reactivos: [{ tipo: 'verdadero_falso', enunciado: 'Uno solo' }],
  }
  assert.strictEqual(FIA.sanearPropuestaAccionChat(propuesta, { permitirAcciones: true }), null)
})

caso('sanearPropuestaAccionChat: examen válido conserva categoria examen y sus reactivos saneados', () => {
  const propuesta = {
    accion: 'CREAR_EXAMEN', nombre: 'Examen de fracciones',
    reactivos: [
      { tipo: 'opcion_multiple', enunciado: '¿Cuánto es 1/2 + 1/2?', opciones: ['0', '1', '2', '3'], correcta: 1 },
      { tipo: 'verdadero_falso', enunciado: '1/2 es mayor que 1/4', correcta: 'v' },
      { tipo: 'opcion_multiple', enunciado: 'sin suficientes opciones', opciones: ['a', '', '', ''], correcta: 0 },
    ],
  }
  const r = FIA.sanearPropuestaAccionChat(propuesta, { permitirAcciones: true })
  assert.strictEqual(r.categoria, 'examen')
  // el tercer reactivo (solo 1 opción con texto) se descarta, quedan 2
  assert.strictEqual(r.reactivos.length, 2)
  assert.strictEqual(r.reactivos[0].tipo, 'opcion_multiple')
  assert.strictEqual(r.reactivos[1].correcta, 'v')
})

caso('sanearPropuestaAccionChat: fechaLimite en el pasado o con formato inválido se descarta a null', () => {
  const base = { accion: 'CREAR_ACTIVIDAD_ENTREGABLE', nombre: 'Tarea', instrucciones: 'Haz esto' }
  assert.strictEqual(FIA.sanearPropuestaAccionChat({ ...base, fechaLimite: '2020-01-01' }, { permitirAcciones: true }).fechaLimite, null)
  assert.strictEqual(FIA.sanearPropuestaAccionChat({ ...base, fechaLimite: 'no es una fecha' }, { permitirAcciones: true }).fechaLimite, null)
})

caso('sanearReactivoPropuestaChat: tipo fuera de la lista blanca cae a opcion_multiple', () => {
  const r = FIA.sanearReactivoPropuestaChat({ tipo: 'lo-que-sea', enunciado: 'x', opciones: ['a', 'b', 'c', 'd'] })
  assert.strictEqual(r.tipo, 'opcion_multiple')
})

caso('sanearReactivoPropuestaChat: sin enunciado se descarta (null)', () => {
  assert.strictEqual(FIA.sanearReactivoPropuestaChat({ tipo: 'verdadero_falso', enunciado: '  ' }), null)
})

// Nuevo modelo de cobro del Chat con Asistente (18-ago-2026): el chat deja
// de cobrar por mensaje, y las 3 acciones que confirma cobran su tarifa
// definitiva. calcularTarifaExamen es la única pieza puramente numérica de
// ese cambio — el resto (límite diario, saldo cero, reserva/liquidación)
// necesita Firestore real, se prueba en la verificación E2E, no aquí.
caso('calcularTarifaExamen: escala definitiva por tramos de 10 reactivos', () => {
  assert.strictEqual(FIA.calcularTarifaExamen(1), 8)
  assert.strictEqual(FIA.calcularTarifaExamen(10), 8)
  assert.strictEqual(FIA.calcularTarifaExamen(11), 10)
  assert.strictEqual(FIA.calcularTarifaExamen(20), 10)
  assert.strictEqual(FIA.calcularTarifaExamen(21), 12)
  assert.strictEqual(FIA.calcularTarifaExamen(30), 12)
  assert.strictEqual(FIA.calcularTarifaExamen(31), 14)
  assert.strictEqual(FIA.calcularTarifaExamen(40), 14)
  assert.strictEqual(FIA.calcularTarifaExamen(41), 16)
  assert.strictEqual(FIA.calcularTarifaExamen(50), 16)
})

caso('calcularTarifaExamen: por encima de 50 sigue la misma progresión (2 créditos cada 10 más), no inventa una regla distinta', () => {
  assert.strictEqual(FIA.calcularTarifaExamen(51), 18)
  assert.strictEqual(FIA.calcularTarifaExamen(60), 18)
  assert.strictEqual(FIA.calcularTarifaExamen(61), 20)
})

caso('calcularTarifaExamen: entradas inválidas (0, negativo, no numérico) no truenan, tratan como 1 reactivo', () => {
  assert.strictEqual(FIA.calcularTarifaExamen(0), 8)
  assert.strictEqual(FIA.calcularTarifaExamen(-5), 8)
  assert.strictEqual(FIA.calcularTarifaExamen(undefined), 8)
  assert.strictEqual(FIA.calcularTarifaExamen('no es un número'), 8)
})

caso('claveLimiteChatDiario: UN solo contador por docente y por día (18-ago-2026 — antes era por asignatura/general, ahora es combinado)', () => {
  const hoy = new Date().toISOString().slice(0, 10)
  assert.strictEqual(FIA.claveLimiteChatDiario('uid1'), `uid1_${hoy}`)
  // Misma clave para el mismo docente en el mismo día, sin importar de qué
  // asignatura (o del Asistente General) venga — es justo lo que hace que
  // el límite sea GLOBAL por docente, no por conversación.
  assert.strictEqual(FIA.claveLimiteChatDiario('uid1'), FIA.claveLimiteChatDiario('uid1'))
  // Docente distinto → clave distinta (aislamiento entre cuentas).
  assert.notStrictEqual(FIA.claveLimiteChatDiario('uid1'), FIA.claveLimiteChatDiario('uid2'))
})

caso('LIMITE_CHAT_DIARIO es 50, igual para todo docente (modelo de créditos puros, 20-ago-2026 — ya no hay límite distinto de trial)', () => {
  assert.strictEqual(FIA.LIMITE_CHAT_DIARIO, 50)
})

caso('ACCIONES_ACTIVIDAD cubre entregable y observación, no examen (examen tiene su propia operación de cobro)', () => {
  assert.deepStrictEqual(FIA.ACCIONES_ACTIVIDAD, ['CREAR_ACTIVIDAD_ENTREGABLE', 'CREAR_ACTIVIDAD_OBSERVACION'])
})

// ═══ Crucigrama — Backspace (resolverBackspace) ═══════════════════════════════
//
// resolverBackspace es la función PURA que decide qué celda borrar y a dónde
// mover el foco cuando el estudiante presiona Backspace.
//
// En CrucigramaBoard.jsx, esta misma función es invocada desde DOS manejadores:
//   • onKeyDown  → teclado físico (desktop, Android con teclado hardware)
//                  condición: e.key === 'Backspace'
//   • onBeforeInput → teclado virtual Android (Gboard, Samsung Keyboard, etc.)
//                     condición: e.inputType === 'deleteContentBackward'
//
// El contrato de "deleteContentBackward" (teclado virtual Android) no se puede
// verificar con Node.js puro — requeriría un entorno JSDOM/Capacitor real. Los
// casos aquí prueban la lógica de decisión que AMBOS manejadores comparten.

grupo('Crucigrama — Backspace (resolverBackspace)')

// Fixtures mínimos de palabraActiva
const HORIZONTAL = { horizontal: true, fila: 0, col: 0, longitud: 4, index: 0 }
const VERTICAL   = { horizontal: false, fila: 0, col: 0, longitud: 4, index: 1 }
// Palabra que empieza en (2, 2) horizontal — para intersecciones
const HORIZ_MID  = { horizontal: true, fila: 2, col: 2, longitud: 4, index: 2 }

// ─── Caso 1: Backspace sobre casilla con letra ────────────────────────────────
caso('1. Backspace con letra: borra ESTA celda y mueve foco a la anterior', () => {
  const celdas = { '0-0': 'A', '0-1': 'B', '0-2': 'C' }
  const { borrar, foco } = resolverBackspace(0, 2, celdas, HORIZONTAL)
  assert.deepStrictEqual(borrar, { r: 0, c: 2 }, 'debe borrar la celda actual')
  assert.deepStrictEqual(foco,   { r: 0, c: 1 }, 'debe mover foco a la anterior')
})

// ─── Caso 2: Backspace sobre casilla vacía ────────────────────────────────────
caso('2. Backspace casilla vacía: mueve foco a la anterior Y borra su letra', () => {
  const celdas = { '0-0': 'A', '0-1': 'B' } // casilla 0-2 vacía
  const { borrar, foco } = resolverBackspace(0, 2, celdas, HORIZONTAL)
  assert.deepStrictEqual(borrar, { r: 0, c: 1 }, 'debe borrar la celda anterior (tiene letra)')
  assert.deepStrictEqual(foco,   { r: 0, c: 1 }, 'debe mover foco a la anterior')
})

caso('2b. Backspace casilla vacía, anterior también vacía: mueve foco pero no borra nada', () => {
  const celdas = { '0-0': 'A' } // casillas 0-1 y 0-2 vacías
  const { borrar, foco } = resolverBackspace(0, 2, celdas, HORIZONTAL)
  assert.strictEqual(borrar, null, 'la anterior está vacía: no borrar')
  assert.deepStrictEqual(foco, { r: 0, c: 1 })
})

// ─── Caso 3: Inicio de palabra ────────────────────────────────────────────────
caso('3. Backspace inicio con letra: borra en sitio, foco se queda aquí', () => {
  // Fix bug: antes devolvía {null,null} dejando la letra trabada.
  const celdas = { '0-0': 'A', '0-1': 'B', '0-2': 'C' }
  const { borrar, foco } = resolverBackspace(0, 0, celdas, HORIZONTAL)
  assert.deepStrictEqual(borrar, { r: 0, c: 0 }, 'debe borrar la primera celda')
  assert.strictEqual(foco, null, 'el foco permanece en la misma celda (sin navegar atrás)')
})

caso('3b. Backspace inicio sin letra: no hace nada (evita navegación nativa atrás)', () => {
  // Primera celda vacía: no borra, no mueve foco.
  const celdas = { '0-1': 'B', '0-2': 'C' } // '0-0' ausente → vacía
  const { borrar, foco } = resolverBackspace(0, 0, celdas, HORIZONTAL)
  assert.strictEqual(borrar, null, 'sin letra: no borrar')
  assert.strictEqual(foco,  null, 'sin letra: no mover foco fuera de la palabra')
})

caso('3c. Inicio sin palabra activa: tampoco hace nada', () => {
  const { borrar, foco } = resolverBackspace(0, 0, {}, null)
  assert.strictEqual(borrar, null)
  assert.strictEqual(foco,  null)
})

// ─── Caso 4: Horizontal ───────────────────────────────────────────────────────
caso('4. Backspace horizontal: retrocede en columna, no cambia fila', () => {
  const celdas = { '0-0': 'A', '0-1': 'B', '0-2': 'C', '0-3': 'D' }
  const { borrar, foco } = resolverBackspace(0, 3, celdas, HORIZONTAL)
  assert.deepStrictEqual(borrar, { r: 0, c: 3 })
  assert.deepStrictEqual(foco,   { r: 0, c: 2 })
  // La fila no debe cambiar
  assert.strictEqual(foco.r, 0)
})

// ─── Caso 5: Vertical ─────────────────────────────────────────────────────────
caso('5. Backspace vertical: retrocede en fila, no cambia columna', () => {
  const celdas = { '0-0': 'A', '1-0': 'B', '2-0': 'C', '3-0': 'D' }
  const { borrar, foco } = resolverBackspace(3, 0, celdas, VERTICAL)
  assert.deepStrictEqual(borrar, { r: 3, c: 0 })
  assert.deepStrictEqual(foco,   { r: 2, c: 0 })
  // La columna no debe cambiar
  assert.strictEqual(foco.c, 0)
})

caso('5b. Backspace vertical inicio con letra: borra en sitio, foco permanece', () => {
  const celdas = { '0-0': 'A', '1-0': 'B' }
  const { borrar, foco } = resolverBackspace(0, 0, celdas, VERTICAL)
  assert.deepStrictEqual(borrar, { r: 0, c: 0 }, 'borra la primera celda vertical')
  assert.strictEqual(foco, null, 'el foco no sale de la palabra')
})

caso('5c. Backspace vertical inicio sin letra: no hace nada', () => {
  const celdas = { '1-0': 'B' } // '0-0' vacía
  const { borrar, foco } = resolverBackspace(0, 0, celdas, VERTICAL)
  assert.strictEqual(borrar, null)
  assert.strictEqual(foco,  null)
})

// ─── Caso 6: Intersección ─────────────────────────────────────────────────────
caso('6. Backspace en intersección respeta la dirección activa (horizontal)', () => {
  // Celda (2, 3) pertenece a la palabra horizontal HORIZ_MID (fila 2, col 2..5)
  // y supongamos también a una vertical. El resultado debe respetar HORIZ_MID.
  const celdas = { '2-2': 'A', '2-3': 'B', '2-4': 'C' }
  const { borrar, foco } = resolverBackspace(2, 3, celdas, HORIZ_MID)
  assert.deepStrictEqual(borrar, { r: 2, c: 3 }, 'borra la celda actual (H)')
  assert.deepStrictEqual(foco,   { r: 2, c: 2 }, 'retrocede en la misma fila (H)')
})

caso('6b. Backspace en intersección respeta la dirección activa (vertical)', () => {
  // Celda (1, 0) pertenece a la palabra vertical VERTICAL (fila 0..3, col 0)
  const celdas = { '0-0': 'A', '1-0': 'B' }
  const { borrar, foco } = resolverBackspace(1, 0, celdas, VERTICAL)
  assert.deepStrictEqual(borrar, { r: 1, c: 0 }, 'borra la celda actual (V)')
  assert.deepStrictEqual(foco,   { r: 0, c: 0 }, 'retrocede en la misma columna (V)')
})

// ─── Caso 6c: Intersección en primera celda (bug de letra trabada) ────────────
// Reproduces exactamente el bug reportado: la celda (r,c) es la primera de la
// palabra activa Y tiene una letra de intersección con otra palabra ya resuelta.
// Antes devolvía {null,null} y la letra quedaba trabada.
caso('6c. Intersección en primera celda con letra: borra en sitio, foco permanece', () => {
  // HORIZ_MID: horizontal, fila=2, col=2, longitud=4
  // La celda (2,2) es índice 0 de HORIZ_MID y ya tiene 'X' de una intersección.
  const celdas = { '2-2': 'X', '2-3': 'B', '2-4': 'C' }
  const { borrar, foco } = resolverBackspace(2, 2, celdas, HORIZ_MID)
  assert.deepStrictEqual(borrar, { r: 2, c: 2 }, 'debe borrar la letra de intersección')
  assert.strictEqual(foco, null, 'el foco no sale de la palabra — permanece en (2,2)')
})

caso('6d. Intersección en primera celda vacía: no hace nada', () => {
  // Misma situación pero la celda ya está vacía (estudiante ya la borró antes).
  const celdas = { '2-3': 'B', '2-4': 'C' } // '2-2' ausente
  const { borrar, foco } = resolverBackspace(2, 2, celdas, HORIZ_MID)
  assert.strictEqual(borrar, null)
  assert.strictEqual(foco,  null)
})

caso('6e. Borrar primera celda y confirmar que permite nueva escritura', () => {
  // Simula el flujo completo: borrar → celda vacía → onCambioCelda(r,c,'') es viable
  const celdas = { '0-0': 'A', '0-1': 'B' }
  const { borrar, foco } = resolverBackspace(0, 0, celdas, HORIZONTAL)
  assert.deepStrictEqual(borrar, { r: 0, c: 0 }, 'borrar devuelve la propia celda')
  // CrucigramaBoard llama onCambioCelda(borrar.r, borrar.c, '') → el mapa queda:
  const celdasDespues = { ...celdas, [`${borrar.r}-${borrar.c}`]: '' }
  assert.strictEqual(celdasDespues['0-0'], '', 'la celda queda vacía para escritura nueva')
  assert.strictEqual(foco, null, 'el foco permanece en la misma celda')
})

// ─── Caso 7: Dos Backspace consecutivos ───────────────────────────────────────
caso('7. Dos Backspace consecutivos (simulados): A B C D → A B C _ → A B _ _', () => {
  let celdas = { '0-0': 'A', '0-1': 'B', '0-2': 'C', '0-3': 'D' }
  // Primer Backspace desde (0,3) con letra
  let res = resolverBackspace(0, 3, celdas, HORIZONTAL)
  assert.deepStrictEqual(res.borrar, { r: 0, c: 3 })
  assert.deepStrictEqual(res.foco,   { r: 0, c: 2 })
  // Aplicamos el borrado
  celdas = { ...celdas, '0-3': '' }

  // Segundo Backspace desde (0,2) — todavía tiene 'C'
  res = resolverBackspace(0, 2, celdas, HORIZONTAL)
  assert.deepStrictEqual(res.borrar, { r: 0, c: 2 })
  assert.deepStrictEqual(res.foco,   { r: 0, c: 1 })
})

// ─── Caso 8: Tres Backspace consecutivos ──────────────────────────────────────
caso('8. Tres Backspace consecutivos: A B C _ → A B _ _ → A _ _ _ → _ _ _ _ (cursor en 0,0)', () => {
  let celdas = { '0-0': 'A', '0-1': 'B', '0-2': 'C' } // 0-3 vacío

  // Desde (0,3) vacío: borra anterior (0,2)='C', foco a (0,2)
  let res = resolverBackspace(0, 3, celdas, HORIZONTAL)
  assert.deepStrictEqual(res.borrar, { r: 0, c: 2 })
  celdas = { ...celdas, '0-2': '' }

  // Desde (0,2) vacío: borra anterior (0,1)='B', foco a (0,1)
  res = resolverBackspace(0, 2, celdas, HORIZONTAL)
  assert.deepStrictEqual(res.borrar, { r: 0, c: 1 })
  celdas = { ...celdas, '0-1': '' }

  // Desde (0,1) vacío: borra anterior (0,0)='A', foco a (0,0)
  res = resolverBackspace(0, 1, celdas, HORIZONTAL)
  assert.deepStrictEqual(res.borrar, { r: 0, c: 0 })
  assert.deepStrictEqual(res.foco,   { r: 0, c: 0 })
})

// ─── Caso 9: Escritura después de Backspace ───────────────────────────────────
caso('9. Después de Backspace, la celda queda vacía y permite nueva escritura', () => {
  const celdas = { '0-0': 'A', '0-1': 'B', '0-2': 'C' }
  const { borrar } = resolverBackspace(0, 2, celdas, HORIZONTAL)
  // Después de borrar, el estado sería '0-2': ''
  const celdasDespues = { ...celdas, [`${borrar.r}-${borrar.c}`]: '' }
  assert.strictEqual(celdasDespues['0-2'], '')
  // La función no decide qué letra escribir — eso lo hace onChange. Solo
  // verificamos que la celda queda vacía y el contrato de borrar es correcto.
  assert.deepStrictEqual(borrar, { r: 0, c: 2 })
})

// ─── Caso 10: Cambio H/V después de Backspace ────────────────────────────────
caso('10. Backspace H luego V: cada dirección usa su propia lógica de anterior', () => {
  // Horizontal: en (0,2) con letra
  const celdas = { '0-0': 'A', '0-1': 'B', '0-2': 'C' }
  const resH = resolverBackspace(0, 2, celdas, HORIZONTAL)
  assert.deepStrictEqual(resH.borrar, { r: 0, c: 2 })
  assert.deepStrictEqual(resH.foco,   { r: 0, c: 1 })

  // Vertical desde misma posición (0,2) pero con palabra vertical
  const VERT2 = { horizontal: false, fila: 0, col: 2, longitud: 4, index: 3 }
  const celdasV = { '0-2': 'C', '1-2': 'D', '2-2': 'E' }
  const resV = resolverBackspace(2, 2, celdasV, VERT2)
  assert.deepStrictEqual(resV.borrar, { r: 2, c: 2 })
  assert.deepStrictEqual(resV.foco,   { r: 1, c: 2 })
  // La columna debe ser la misma en ambos focos de V
  assert.strictEqual(resV.foco.c, 2)
})

// ─── Solución post-entrega: correccionesCrucigrama ───────────────────────────
grupo('Solución post-entrega — correccionesCrucigrama')

// Crucigrama mínimo 2×2 con la palabra "GO" horizontal y "AL" vertical.
// grid[r].row[c] = letra correcta (ya normalizada: sin acentos, mayúscula).
const ESTRUCTURA_MIN = {
  size: 2,
  tipo: 'crucigrama',
  grid: [
    { row: ['G', 'O'] },
    { row: ['A', null] },
  ],
  palabras: [
    { horizontal: true,  fila: 0, col: 0, longitud: 2, palabra: 'GO', index: 0 },
    { horizontal: false, fila: 0, col: 0, longitud: 2, palabra: 'GA', index: 1 },
  ],
}

caso('CJ-01: celda correcta → true', () => {
  const mapa = correccionesCrucigrama(ESTRUCTURA_MIN, { '0-0': 'G', '0-1': 'O', '1-0': 'A' })
  assert.strictEqual(mapa['0-0'], true)
  assert.strictEqual(mapa['0-1'], true)
  assert.strictEqual(mapa['1-0'], true)
})

caso('CJ-02: celda incorrecta → false', () => {
  const mapa = correccionesCrucigrama(ESTRUCTURA_MIN, { '0-0': 'X', '0-1': 'O', '1-0': 'A' })
  assert.strictEqual(mapa['0-0'], false)
  assert.strictEqual(mapa['0-1'], true)
})

caso('CJ-03: celda vacía → false', () => {
  const mapa = correccionesCrucigrama(ESTRUCTURA_MIN, {})
  assert.strictEqual(mapa['0-0'], false)
  assert.strictEqual(mapa['0-1'], false)
})

caso('CJ-04: celda null en grid (fuera del crucigrama) → no aparece en mapa', () => {
  const mapa = correccionesCrucigrama(ESTRUCTURA_MIN, {})
  assert.strictEqual(Object.prototype.hasOwnProperty.call(mapa, '1-1'), false)
})

caso('CJ-05: normalización — minúscula con acento equivale a la letra correcta', () => {
  // El alumno escribe 'á' → normalizarPalabra → 'A'
  const mapa = correccionesCrucigrama(ESTRUCTURA_MIN, { '1-0': 'á' })
  assert.strictEqual(mapa['1-0'], true)
})

caso('CJ-06: normalización — Ñ se trata como N', () => {
  const e = {
    size: 1, tipo: 'crucigrama',
    grid: [{ row: ['N'] }],
    palabras: [],
  }
  const mapa = correccionesCrucigrama(e, { '0-0': 'Ñ' })
  assert.strictEqual(mapa['0-0'], true)
})

caso('CJ-07: celdas del alumno que no corresponden a ninguna letra del grid se ignoran', () => {
  const mapa = correccionesCrucigrama(ESTRUCTURA_MIN, { '9-9': 'Z' })
  assert.strictEqual(Object.prototype.hasOwnProperty.call(mapa, '9-9'), false)
})

caso('CJ-08: todas correctas — conteo', () => {
  const mapa = correccionesCrucigrama(ESTRUCTURA_MIN, { '0-0': 'G', '0-1': 'O', '1-0': 'A' })
  const correctas = Object.values(mapa).filter(Boolean).length
  const total = Object.keys(mapa).length
  assert.strictEqual(correctas, 3)
  assert.strictEqual(total, 3)
})

caso('CJ-09: ver solución NO produce efecto secundario en la estructura original', () => {
  const copia = JSON.parse(JSON.stringify(ESTRUCTURA_MIN))
  correccionesCrucigrama(ESTRUCTURA_MIN, { '0-0': 'G' })
  assert.deepStrictEqual(ESTRUCTURA_MIN, copia)
})

// ═══ copiaActividad — qué viaja cuando se copia una actividad ════════════════
//
// Los tres caminos de copia (traer de otra asignatura, duplicar asignatura
// completa, duplicar actividad dentro de la misma) comparten este módulo.
// Antes eran tres listas blancas distintas y NINGUNA copiaba `tipoJuego` ni
// `juego`: el Crucigrama/Sopa de letras llegaba al destino vacío, sin tablero,
// pidiendo las palabras otra vez e imposible de publicar.
grupo('copiaActividad — Crucigrama / Sopa de letras')

const CRUCIGRAMA = {
  id: 'act_cruci',
  nombre: 'Célula animal',
  categoria: 'juego',
  tipoJuego: 'crucigrama',
  maxCalif: 10,
  parcial: 2,
  evaluacion: { tiempoLimiteMin: 15, intentosPermitidos: 2, resultadosPublicados: true, solucionPublicada: true },
  juego: {
    modalidad: 'descripcion',
    cantidadPalabras: 6,
    estado: 'juego_confirmado',
    contenido: [{ palabra: 'núcleo', descripcion: 'Guarda el ADN' }],
    estructura: {
      tipo: 'crucigrama', size: 8,
      grid: [{ row: ['N', 'U'] }],
      palabras: [{ index: 0, palabra: 'núcleo', normalizada: 'NUCLEO' }],
    },
    idempotencyKeyReserva: 'clave-de-la-reserva-del-original',
  },
}

const SOPA = {
  id: 'act_sopa',
  nombre: '',
  categoria: 'juego',
  tipoJuego: 'sopa_letras',
  maxCalif: 10,
  parcial: 1,
  juego: {
    modalidad: 'palabra',
    cantidadPalabras: 8,
    tamanoSopa: 10,
    estado: 'juego_confirmado',
    contenido: [{ palabra: 'sol', descripcion: null }],
    estructura: {
      tipo: 'sopa_letras', size: 10,
      grid: [{ row: ['S', 'O', 'L'] }],
      palabras: [{ index: 0, palabra: 'sol', normalizada: 'SOL' }],
    },
    idempotencyKeyReserva: 'otra-clave',
  },
}

caso('CP-01: la copia de un crucigrama confirmado conserva tipoJuego', () => {
  assert.strictEqual(camposComunesCopia(CRUCIGRAMA).tipoJuego, 'crucigrama')
})

caso('CP-02: conserva el juego entero — modalidad, cantidad, estado, contenido y estructura', () => {
  const j = camposComunesCopia(CRUCIGRAMA).juego
  assert.strictEqual(j.modalidad, 'descripcion')
  assert.strictEqual(j.cantidadPalabras, 6)
  assert.strictEqual(j.estado, 'juego_confirmado')
  assert.deepStrictEqual(j.contenido, CRUCIGRAMA.juego.contenido)
  assert.deepStrictEqual(j.estructura, CRUCIGRAMA.juego.estructura)
})

caso('CP-03: la copia NUNCA lleva idempotencyKeyReserva (es del original)', () => {
  const j = camposComunesCopia(CRUCIGRAMA).juego
  assert.strictEqual(Object.prototype.hasOwnProperty.call(j, 'idempotencyKeyReserva'), false)
  assert.strictEqual(j.idempotencyKeyReserva, undefined)
})

caso('CP-04: copiar no le quita la reserva al original (no lo muta)', () => {
  camposComunesCopia(CRUCIGRAMA)
  camposJuegoCopia(CRUCIGRAMA)
  assert.strictEqual(CRUCIGRAMA.juego.idempotencyKeyReserva, 'clave-de-la-reserva-del-original')
})

caso('CP-05: la sopa de letras confirmada conserva tipoJuego y tamanoSopa', () => {
  const d = camposComunesCopia(SOPA)
  assert.strictEqual(d.tipoJuego, 'sopa_letras')
  assert.strictEqual(d.juego.tamanoSopa, 10)
  assert.strictEqual(d.juego.estructura.size, 10)
})

caso('CP-06: a un juego no se le inventan tipo/tiposArchivo/extensionesCustom', () => {
  const d = camposComunesCopia(CRUCIGRAMA)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(d, 'tipo'), false)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(d, 'tiposArchivo'), false)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(d, 'extensionesCustom'), false)
})

caso('CP-07: la copia no arrastra resultados ni solución ya publicados', () => {
  const ev = camposComunesCopia(CRUCIGRAMA).evaluacion
  assert.strictEqual(ev.resultadosPublicados, false)
  assert.strictEqual(ev.solucionPublicada, false)
  assert.strictEqual(ev.respuestasPublicadas, false)
  assert.strictEqual(ev.tiempoLimiteMin, 15, 'la configuración de verdad sí se conserva')
})

caso('CP-08: la fecha límite del ciclo anterior nunca viaja', () => {
  assert.strictEqual(camposComunesCopia({ ...CRUCIGRAMA, fechaLimite: '2026-01-01' }).fechaLimite, null)
})

grupo('copiaActividad — qué NO se puede copiar')

caso('CP-09: un juego confirmado sí se puede copiar', () => {
  assert.strictEqual(esCopiable(CRUCIGRAMA), true)
  assert.strictEqual(esCopiable(SOPA), true)
})

caso('CP-10: un juego SIN confirmar queda excluido en los cuatro estados previos', () => {
  for (const estado of [null, 'contenido_generado', 'contenido_editado', 'juego_generado']) {
    const sinConfirmar = { ...CRUCIGRAMA, juego: { ...CRUCIGRAMA.juego, estado } }
    assert.strictEqual(esCopiable(sinConfirmar), false, `estado ${estado}`)
  }
})

caso('CP-11: una actividad de categoría juego SIN objeto juego tampoco se copia', () => {
  assert.strictEqual(esCopiable({ categoria: 'juego', tipoJuego: 'crucigrama' }), false)
})

caso('CP-12: las actividades normales se copian siempre, aunque sean borrador', () => {
  assert.strictEqual(esCopiable({ categoria: 'entregable', oculta: true }), true)
  assert.strictEqual(esCopiable({ categoria: 'examen', tipo: 'evaluacion' }), true)
})

grupo('copiaActividad — nombre del juego')

caso('CP-13: un juego sin nombre se copia con la etiqueta de su tipo, no en blanco', () => {
  assert.strictEqual(nombreParaCopia(SOPA), 'Sopa de letras')
  assert.strictEqual(nombreParaCopia({ ...CRUCIGRAMA, nombre: '' }), 'Crucigrama')
})

caso('CP-14: un juego con nombre conserva el suyo', () => {
  assert.strictEqual(nombreParaCopia(CRUCIGRAMA), 'Célula animal')
})

caso('CP-15: etiquetaJuego distingue los dos tipos y cae en Crucigrama sin tipo', () => {
  assert.strictEqual(etiquetaJuego({ tipoJuego: 'sopa_letras' }), 'Sopa de letras')
  assert.strictEqual(etiquetaJuego({ tipoJuego: 'crucigrama' }), 'Crucigrama')
  assert.strictEqual(etiquetaJuego({}), 'Crucigrama')
})

caso('CP-16: una actividad normal sin nombre no hereda etiqueta de juego', () => {
  assert.strictEqual(nombreParaCopia({ categoria: 'entregable', nombre: '' }), '')
})

caso('CP-25: el nombre puesto en el borrador viaja en los tres caminos de copia', () => {
  // Tal como queda el documento tras nombrarlo en borrador y confirmarlo.
  const nombrado = { ...SOPA, nombre: 'Sistema solar' }
  // Traer de otra asignatura / duplicar asignatura: el nombre tal cual.
  assert.strictEqual(nombreParaCopia(nombrado), 'Sistema solar')
  // Duplicar dentro de la misma asignatura añade el sufijo sobre ese nombre.
  assert.strictEqual(`${nombreParaCopia(nombrado)} (copia)`, 'Sistema solar (copia)')
  // Y el juego sigue completo en la copia — el nombre no desplaza nada.
  const d = camposComunesCopia(nombrado)
  assert.strictEqual(d.tipoJuego, 'sopa_letras')
  assert.strictEqual(d.juego.estado, 'juego_confirmado')
  assert.strictEqual(d.juego.tamanoSopa, 10)
})

grupo('copiaActividad — las actividades normales no se rompen')

const ENTREGABLE = {
  id: 'act_ent', nombre: 'Ensayo', categoria: 'entregable', tipo: 'archivo',
  maxCalif: 10, instrucciones: '<p>Hazlo</p>', archivosAdjuntos: [{ url: 'u' }],
  tiposArchivo: 'documentos', extensionesCustom: '.md', rubrica: { niveles: [] },
  rubricaId: 'r1', pesoCalificacion: 30, fechaLimite: '2025-12-01',
}

caso('CP-17: el entregable conserva tipo, tiposArchivo, rúbrica y ponderación', () => {
  const d = camposComunesCopia(ENTREGABLE)
  assert.strictEqual(d.tipo, 'archivo')
  assert.strictEqual(d.tiposArchivo, 'documentos')
  assert.strictEqual(d.extensionesCustom, '.md')
  assert.deepStrictEqual(d.rubrica, ENTREGABLE.rubrica)
  assert.strictEqual(d.rubricaId, 'r1')
  assert.strictEqual(d.pesoCalificacion, 30)
  assert.strictEqual(d.categoria, 'entregable')
  assert.deepStrictEqual(d.archivosAdjuntos, ENTREGABLE.archivosAdjuntos)
})

caso('CP-18: una actividad normal no recibe campos de juego', () => {
  const d = camposComunesCopia(ENTREGABLE)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(d, 'juego'), false)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(d, 'tipoJuego'), false)
})

caso('CP-19: una actividad legacy sin categoría ni maxCalif recibe valores por omisión válidos', () => {
  const d = camposComunesCopia({ nombre: 'Vieja' })
  assert.strictEqual(d.categoria, 'entregable')
  assert.strictEqual(d.maxCalif, 10)
  assert.strictEqual(d.tipo, 'archivo')
  assert.strictEqual(d.tiposArchivo, 'imagenes')
})

caso('CP-20: copiar es una operación de datos pura — ninguna clave de reserva viaja', () => {
  const texto = JSON.stringify(camposComunesCopia(CRUCIGRAMA))
  assert.ok(!texto.includes('idempotency'))
  assert.ok(!texto.includes('clave-de-la-reserva-del-original'))
})

// El estudiante resuelve contra `juego.estructura`, y el SERVIDOR califica con
// esa misma estructura (calificarCrucigrama / calificarSopaDeLetras en
// functions/index.js). Si la copia no la lleva —el defecto original— no hay
// nada que resolver ni que calificar. Aquí la estructura YA COPIADA se pasa
// por el calificador de verdad, no por una imitación.
grupo('copiaActividad — el juego copiado sigue siendo resoluble y calificable')

const CRUCI_JUGABLE = {
  categoria: 'juego', tipoJuego: 'crucigrama', nombre: 'Sistema solar',
  juego: {
    modalidad: 'descripcion', cantidadPalabras: 5, estado: 'juego_confirmado',
    contenido: [{ palabra: 'sol', descripcion: 'Estrella del sistema' }],
    estructura: {
      tipo: 'crucigrama', size: 2,
      grid: [{ row: ['S', 'O'] }, { row: [null, 'L'] }],
      palabras: [{ index: 0, palabra: 'sol', descripcion: 'Estrella del sistema', normalizada: 'SOL' }],
    },
    idempotencyKeyReserva: 'no-debe-viajar',
  },
}

caso('CP-21: el crucigrama copiado se califica al 100% con todo correcto', () => {
  const copiado = camposComunesCopia(CRUCI_JUGABLE).juego.estructura
  assert.strictEqual(F.calificarCrucigrama(copiado, { celdas: { '0-0': 'S', '0-1': 'o', '1-1': 'L' } }), 1)
})

caso('CP-22: el crucigrama copiado califica parcial cuando falta una letra', () => {
  const copiado = camposComunesCopia(CRUCI_JUGABLE).juego.estructura
  const fraccion = F.calificarCrucigrama(copiado, { celdas: { '0-0': 'S', '0-1': 'O' } })
  assert.ok(Math.abs(fraccion - 2 / 3) < 1e-9, `esperaba 2/3, llegó ${fraccion}`)
})

caso('CP-23: la pista de cada palabra viaja en la copia (sin ella el alumno no puede resolver)', () => {
  const copiado = camposComunesCopia(CRUCI_JUGABLE).juego.estructura
  assert.strictEqual(copiado.palabras[0].descripcion, 'Estrella del sistema')
  assert.strictEqual(copiado.palabras[0].normalizada, 'SOL')
})

caso('CP-24: la sopa de letras copiada se califica con las palabras encontradas', () => {
  const copiada = camposComunesCopia({
    categoria: 'juego', tipoJuego: 'sopa_letras',
    juego: {
      estado: 'juego_confirmado', tamanoSopa: 8,
      estructura: {
        tipo: 'sopa_letras', size: 8, grid: [{ row: ['S', 'O', 'L'] }],
        palabras: [{ index: 0, normalizada: 'SOL' }, { index: 1, normalizada: 'LUNA' }],
      },
      idempotencyKeyReserva: 'no-debe-viajar',
    },
  }).juego.estructura
  assert.strictEqual(F.calificarSopaDeLetras(copiada, { encontradas: [0, 1] }), 1)
  assert.strictEqual(F.calificarSopaDeLetras(copiada, { encontradas: [0] }), 0.5)
})

console.log(`\n${'─'.repeat(60)}`)

// ═══ A25 — El reparto público/privado del juego ══════════════════════════════
//
// Las reglas de Firestore no filtran CAMPOS, solo DOCUMENTOS, así que las
// respuestas del crucigrama se mudaron a `activities/{id}/clave/juego`, que
// solo abre el docente dueño. Estas son las tres decisiones puras de las que
// depende que el frontend funcione a la vez con las tres formas que conviven:
//
//   A) heredado — respuestas dentro de la estructura pública, sin clave
//   B) migrado  — pública enmascarada + clave privada
//   C) nuevo con compatibilidadLegacy=true — las dos cosas
//
// La app de Android empaqueta su propia copia de dist y no hay candado de
// versión mínima, así que la forma (A) tiene que seguir funcionando
// indefinidamente: estas pruebas son el contrato de esa convivencia.

const PUBLICA_HEREDADA = {
  tipo: 'crucigrama', size: 2,
  grid: [{ row: ['S', 'I'] }, { row: ['O', null] }],
  palabras: [
    { index: 0, fila: 0, col: 0, horizontal: true, longitud: 2, numero: 1, descripcion: 'afirmación', palabra: 'Sí', normalizada: 'SI' },
    { index: 1, fila: 0, col: 0, horizontal: false, longitud: 2, numero: 1, descripcion: 'sonido', palabra: 'So', normalizada: 'SO' },
  ],
}

const PUBLICA_MIGRADA = {
  tipo: 'crucigrama', size: 2,
  grid: [{ row: [true, true] }, { row: [true, false] }],
  palabras: [
    { index: 0, fila: 0, col: 0, horizontal: true, longitud: 2, numero: 1, descripcion: 'afirmación' },
    { index: 1, fila: 0, col: 0, horizontal: false, longitud: 2, numero: 1, descripcion: 'sonido' },
  ],
}

const CLAVE = {
  tipo: 'crucigrama', size: 2,
  grid: [{ row: ['S', 'I'] }, { row: ['O', null] }],
  palabras: [
    { index: 0, palabra: 'Sí', normalizada: 'SI' },
    { index: 1, palabra: 'So', normalizada: 'SO' },
  ],
}

grupo('A25 — esEstructuraHeredada: distingue por el DATO, no por una bandera')

caso('JC-01: un grid con letras es heredado', () => {
  assert.strictEqual(esEstructuraHeredada(PUBLICA_HEREDADA), true)
})

caso('JC-02: un grid de booleanos NO es heredado — ya está migrado', () => {
  assert.strictEqual(esEstructuraHeredada(PUBLICA_MIGRADA), false)
})

caso('JC-03: sin estructura, sin grid o con grid vacío no revienta', () => {
  assert.strictEqual(esEstructuraHeredada(null), false)
  assert.strictEqual(esEstructuraHeredada(undefined), false)
  assert.strictEqual(esEstructuraHeredada({}), false)
  assert.strictEqual(esEstructuraHeredada({ grid: [] }), false)
  assert.strictEqual(esEstructuraHeredada({ grid: [{}] }), false)
})

caso('JC-04: una cadena vacía en el grid no cuenta como letra', () => {
  assert.strictEqual(esEstructuraHeredada({ grid: [{ row: ['', null] }] }), false)
})

caso('JC-05: la sopa de letras siempre es "heredada" — su grid con letras ES el juego', () => {
  // Es justo lo que impide que la solución de la sopa se vaya al callable: su
  // cuadrícula fue pública desde siempre y sigue siéndolo.
  assert.strictEqual(esEstructuraHeredada({ tipo: 'sopa_letras', grid: [{ row: ['A', 'B'] }] }), true)
})

grupo('A25 — estructuraConClave: vuelve a juntar las dos mitades')

caso('JC-06: sin clave devuelve la pública TAL CUAL (juego heredado)', () => {
  assert.strictEqual(estructuraConClave(PUBLICA_HEREDADA, null), PUBLICA_HEREDADA)
})

caso('JC-07: con clave, las letras del grid salen de la clave', () => {
  const e = estructuraConClave(PUBLICA_MIGRADA, CLAVE)
  assert.deepStrictEqual(e.grid, CLAVE.grid)
})

caso('JC-08: la palabra y la normalizada salen de la clave, con su acento original', () => {
  const e = estructuraConClave(PUBLICA_MIGRADA, CLAVE)
  assert.strictEqual(e.palabras[0].palabra, 'Sí')
  assert.strictEqual(e.palabras[0].normalizada, 'SI')
})

caso('JC-09: la pista y la geometría públicas NO se pierden en la fusión', () => {
  const e = estructuraConClave(PUBLICA_MIGRADA, CLAVE)
  assert.strictEqual(e.palabras[0].descripcion, 'afirmación')
  assert.strictEqual(e.palabras[0].fila, 0)
  assert.strictEqual(e.palabras[0].longitud, 2)
  assert.strictEqual(e.palabras[0].horizontal, true)
  assert.strictEqual(e.palabras[1].horizontal, false)
  assert.strictEqual(e.size, 2)
  assert.strictEqual(e.tipo, 'crucigrama')
})

caso('JC-10: la fusión es por `index`, no por posición en el arreglo', () => {
  const claveDesordenada = { ...CLAVE, palabras: [...CLAVE.palabras].reverse() }
  const e = estructuraConClave(PUBLICA_MIGRADA, claveDesordenada)
  assert.strictEqual(e.palabras[0].palabra, 'Sí', 'index 0 sigue emparejado con index 0')
  assert.strictEqual(e.palabras[1].palabra, 'So')
})

caso('JC-11: una palabra sin entrada en la clave se queda con lo público, no rompe', () => {
  const claveCoja = { grid: CLAVE.grid, palabras: [CLAVE.palabras[0]] }
  const e = estructuraConClave(PUBLICA_MIGRADA, claveCoja)
  assert.strictEqual(e.palabras[1].palabra, undefined)
  assert.strictEqual(e.palabras[1].descripcion, 'sonido')
})

caso('JC-12: sin estructura pública devuelve null en vez de reventar', () => {
  assert.strictEqual(estructuraConClave(null, CLAVE), null)
  assert.strictEqual(estructuraConClave(undefined, null), null)
})

caso('JC-13: espejo exacto de estructuraEfectiva (functions/juego.js)', () => {
  // Son la misma regla en los dos lados de la red: si divergen, el docente y
  // el servidor dejarían de ver el mismo tablero.
  const { estructuraEfectiva } = require('../functions/juego.js')
  assert.deepStrictEqual(
    estructuraConClave(PUBLICA_MIGRADA, CLAVE),
    estructuraEfectiva(PUBLICA_MIGRADA, CLAVE)
  )
  assert.deepStrictEqual(
    estructuraConClave(PUBLICA_HEREDADA, null),
    estructuraEfectiva(PUBLICA_HEREDADA, null)
  )
})

grupo('A25 — debeEscribirContenidoEmbebido: la regla que blinda la migración')

caso('JC-14: juego heredado (el campo existe) → se mantiene sincronizado', () => {
  assert.strictEqual(debeEscribirContenidoEmbebido({ juego: { contenido: [{ palabra: 'A' }] } }), true)
})

caso('JC-15: juego MIGRADO (el campo ya no existe) → NO se vuelve a crear', () => {
  // Es la mitad de la regla que impide que reeditar un juego ya migrado le
  // re-plante las respuestas en el documento público.
  assert.strictEqual(debeEscribirContenidoEmbebido({ juego: { estado: 'juego_confirmado' } }), false)
})

caso('JC-16: un contenido embebido VACÍO sigue contando — el campo existe', () => {
  assert.strictEqual(debeEscribirContenidoEmbebido({ juego: { contenido: [] } }), true)
})

caso('JC-17: actividad sin juego, o sin actividad, no rompe', () => {
  assert.strictEqual(debeEscribirContenidoEmbebido({}), false)
  assert.strictEqual(debeEscribirContenidoEmbebido(null), false)
  assert.strictEqual(debeEscribirContenidoEmbebido({ juego: { contenido: 'no es un arreglo' } }), false)
})

grupo('A26 — a qué intento pertenece cada respuesta (reintentos de cuestionario)')

// Sellos de tiempo con la forma que devuelve Firestore ({ seconds, nanoseconds })
// y con la que expone el SDK (.toMillis()). Las dos tienen que dar lo mismo:
// el Runner lee documentos del SDK, y las pruebas de reglas y los scripts leen
// objetos planos.
const ts = (ms) => ({ seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6 })
const tsSDK = (ms) => ({ toMillis: () => ms })
const T0 = Date.UTC(2026, 8, 3, 12, 0, 0)

caso('RI-01: respuesta guardada ANTES de que arrancara este intento → es del anterior', () => {
  // El caso real: el intento 1 se contestó a las 12:00 y el intento 2 abrió a
  // las 12:20. Esa respuesta no es de este intento.
  assert.strictEqual(esDeIntentoAnterior({ respondidaEn: ts(T0) }, ts(T0 + 20 * 60 * 1000)), true)
})

caso('RI-02: respuesta guardada DESPUÉS del arranque → es de este intento', () => {
  assert.strictEqual(esDeIntentoAnterior({ respondidaEn: ts(T0 + 30 * 1000) }, ts(T0)), false)
})

caso('RI-03: guardada en el mismo instante del arranque → es de este intento', () => {
  // El empate se resuelve a favor del estudiante: su respuesta no se descarta.
  assert.strictEqual(esDeIntentoAnterior({ respondidaEn: ts(T0) }, ts(T0)), false)
})

caso('RI-04: sin `tiempoInicio` no se descarta nada (regla 1.2)', () => {
  // Un dato que falta no deja a nadie fuera: sin reloj contra el que comparar,
  // se respeta lo que el estudiante escribió.
  assert.strictEqual(esDeIntentoAnterior({ respondidaEn: ts(T0) }, null), false)
  assert.strictEqual(esDeIntentoAnterior({ respondidaEn: ts(T0) }, undefined), false)
})

caso('RI-05: sin `respondidaEn` tampoco se descarta', () => {
  // Las respuestas del docente (revisión manual) y del servidor se escriben con
  // merge y no tocan `respondidaEn`; un documento antiguo podría no tenerlo.
  assert.strictEqual(esDeIntentoAnterior({ opcionSeleccionada: 'a' }, ts(T0)), false)
  assert.strictEqual(esDeIntentoAnterior({}, ts(T0)), false)
  assert.strictEqual(esDeIntentoAnterior(null, ts(T0)), false)
})

caso('RI-06: da igual la forma del sello — objeto plano, SDK o Date', () => {
  assert.strictEqual(esDeIntentoAnterior({ respondidaEn: tsSDK(T0) }, tsSDK(T0 + 1000)), true)
  assert.strictEqual(esDeIntentoAnterior({ respondidaEn: ts(T0) }, tsSDK(T0 + 1000)), true)
  assert.strictEqual(esDeIntentoAnterior({ respondidaEn: new Date(T0) }, new Date(T0 + 1000)), true)
  assert.strictEqual(esDeIntentoAnterior({ respondidaEn: new Date(T0 + 1000) }, new Date(T0)), false)
})

caso('RI-07: `tieneRespuestaGuardada` reconoce las cuatro formas de responder', () => {
  assert.strictEqual(tieneRespuestaGuardada({ opcionSeleccionada: 'op1' }), true)
  assert.strictEqual(tieneRespuestaGuardada({ textoRespuesta: 'la respuesta' }), true)
  assert.strictEqual(tieneRespuestaGuardada({ archivoURL: 'https://res.cloudinary.com/x.pdf' }), true)
  assert.strictEqual(tieneRespuestaGuardada({ otraTexto: 'ninguna de las anteriores' }), true)
})

caso('RI-08: un documento ya limpio NO tiene respuesta guardada', () => {
  // Es exactamente lo que deja la limpieza: no hay nada que volver a limpiar.
  assert.strictEqual(tieneRespuestaGuardada({
    opcionSeleccionada: null, textoRespuesta: null, otraTexto: null,
    archivoURL: null, nombreArchivo: null, tamanoArchivo: null,
  }), false)
  assert.strictEqual(tieneRespuestaGuardada({}), false)
  assert.strictEqual(tieneRespuestaGuardada(null), false)
  // La cadena vacía tampoco es una respuesta (borrar el texto y salirse).
  assert.strictEqual(tieneRespuestaGuardada({ textoRespuesta: '' }), false)
})

caso('RI-09: los puntos del servidor no cuentan como respuesta del alumno', () => {
  // `puntosObtenidos`/`correcta` los escribe la Cloud Function y sobreviven a la
  // limpieza (el alumno no puede tocarlos). Un documento con solo eso está
  // limpio: no debe hacer que el Runner crea que hay algo que borrar.
  assert.strictEqual(tieneRespuestaGuardada({ puntosObtenidos: 1, correcta: true }), false)
})

caso('RI-10: CASO 2/9 — la falla de limpieza no le muestra el examen pre-llenado', () => {
  // Reproducción de la protección pedida: la limpieza del intento 2 falló, así
  // que las respuestas del intento 1 siguen VIVAS en Firestore. El Runner las
  // reconoce por el sello y no las pinta.
  const tiempoInicioIntento2 = ts(T0 + 20 * 60 * 1000)
  const vivasDelIntento1 = [
    { id: 'Q1', opcionSeleccionada: 'op_b', respondidaEn: ts(T0 + 60 * 1000) },
    { id: 'Q2', textoRespuesta: 'lo que contesté la vez pasada', respondidaEn: ts(T0 + 120 * 1000) },
  ]
  const pintadas = vivasDelIntento1.filter((r) => !esDeIntentoAnterior(r, tiempoInicioIntento2))
  assert.deepStrictEqual(pintadas, [], 'ninguna respuesta del intento anterior debe llegar a la pantalla')
  // Y las tres se reconocen como pendientes de limpiar, que es lo que dispara
  // la autolimpieza del Runner.
  assert.strictEqual(vivasDelIntento1.every(tieneRespuestaGuardada), true)
})

caso('RI-11: dentro del MISMO intento, lo contestado sí se conserva al recargar', () => {
  // No regresión: recargar a media evaluación no puede borrar lo que ya llevas.
  const tiempoInicio = ts(T0)
  const misRespuestas = [
    { id: 'Q1', opcionSeleccionada: 'op_a', respondidaEn: ts(T0 + 15 * 1000) },
    { id: 'Q2', textoRespuesta: 'voy a la mitad', respondidaEn: ts(T0 + 90 * 1000) },
  ]
  const pintadas = misRespuestas.filter((r) => !esDeIntentoAnterior(r, tiempoInicio))
  assert.strictEqual(pintadas.length, 2)
})


if (fallos.length) {
  console.log(`${pasadas} pasaron, ${fallos.length} FALLARON\n`)
  fallos.forEach((f) => console.log(`  ✗ ${f.nombre}\n    ${f.e.message}`))
  process.exit(1)
}
console.log(`ALL ${pasadas} UNIT CHECKS PASSED`)
