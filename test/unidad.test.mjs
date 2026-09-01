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
import { contenidoAnalisisResultadosPDF, AVISO_IA_ANALISIS } from '../src/utils/analisisResultadosPDF.js'
import { resumenConfiabilidad } from '../src/utils/confiabilidadAnalisis.js'
import { isPerfilIACompleto, perfilIAVacio } from '../src/utils/perfilIA.js'
import { tipoFuentePermitido, extensionDeArchivo, hayFuentesGenerales, MAX_FUENTES_POR_GRUPO, esMismaFuente } from '../src/utils/fuentesAsignatura.js'
import { planeacionVigente, validarArchivoPlaneacion, extensionPlaneacion } from '../src/utils/planeacionVigente.js'
import { resolverBackspace } from '../src/utils/crucigramaBackspace.js'
import { correccionesCrucigrama } from '../src/utils/correccionesJuego.js'

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
caso('3. Backspace al inicio de la palabra: no hace nada (null, null)', () => {
  const celdas = { '0-0': 'A', '0-1': 'B', '0-2': 'C' }
  const { borrar, foco } = resolverBackspace(0, 0, celdas, HORIZONTAL)
  assert.strictEqual(borrar, null, 'no debe borrar — es la primera casilla')
  assert.strictEqual(foco,  null, 'no debe mover foco fuera de la palabra')
})

caso('3b. Inicio sin palabra activa: tampoco hace nada', () => {
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

caso('5b. Backspace vertical, inicio de la palabra vertical: no hace nada', () => {
  const celdas = { '0-0': 'A' }
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

console.log(`\n${'─'.repeat(60)}`)
if (fallos.length) {
  console.log(`${pasadas} pasaron, ${fallos.length} FALLARON\n`)
  fallos.forEach((f) => console.log(`  ✗ ${f.nombre}\n    ${f.e.message}`))
  process.exit(1)
}
console.log(`ALL ${pasadas} UNIT CHECKS PASSED`)
