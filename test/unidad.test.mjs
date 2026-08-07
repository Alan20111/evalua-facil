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
import { totalRubrica, validarCotejo, validarRubrica, RUBRICA_TOTAL } from '../src/utils/rubrica.js'

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

// ═══ Resumen ═════════════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(60)}`)
if (fallos.length) {
  console.log(`${pasadas} pasaron, ${fallos.length} FALLARON\n`)
  fallos.forEach((f) => console.log(`  ✗ ${f.nombre}\n    ${f.e.message}`))
  process.exit(1)
}
console.log(`ALL ${pasadas} UNIT CHECKS PASSED`)
