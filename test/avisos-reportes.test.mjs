// Avisos por correo de Reportes de IA y Sugerencias a Evalúa Fácil
// (functions/avisosReportes.js) — pruebas contra el emulador de Firestore.
//
//   firebase emulators:exec --only firestore,auth --project demo-test \
//     "node test/avisos-reportes.test.mjs"
//
// Se llama la LÓGICA directamente (sin emulador de Functions) con un Brevo
// falso. Nunca sale un correo de verdad. Cubre:
//   A. el correo: asunto, filas, enlace, escape de HTML, sin la respuesta de la IA;
//   B. la llamada a Brevo: sin clave, error HTTP, red, éxito — sin filtrar la clave;
//   C. el contexto que resuelve el servidor (y lo que NO resuelve);
//   D. fallos, reintentos, reclamos muertos, intentos agotados;
//   E. duplicados, límite por persona, tope diario y concurrencia;
//   F. registros históricos y separación de colecciones.

import { createRequire } from 'node:module'
import { dbFn as db, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'

const require = createRequire(import.meta.url)
const requireFn = createRequire(new URL('../functions/index.js', import.meta.url))
const { Timestamp } = requireFn('firebase-admin/firestore')
const AV = require('../functions/avisosReportes.js')._pruebas

const DOCENTE = 'docente_rep'
const OTRO = 'docente_ajeno'
const ALUMNO = 'alumno_rep'
const ADMIN = 'admin_rep'
const AHORA = Date.UTC(2026, 9, 24, 18, 0, 0) // 24-oct-2026 12:00 en CDMX
const MIN = 60 * 1000
// Sugerencia que el detector ya dio por limpia (para armar correos a mano).
const LIMPIA = { estado: 'limpia', motivos: [], version: 1 }

function brevoFalso(respuestas = [], { demoraMs = 0 } = {}) {
  const llamadas = []
  const fn = async (correo) => {
    llamadas.push(correo)
    if (demoraMs) await new Promise((r) => setTimeout(r, demoraMs))
    const r = respuestas.length ? respuestas.shift() : { ok: true, messageId: `<msg-${llamadas.length}@brevo>` }
    if (r instanceof Error) throw r
    return r
  }
  fn.llamadas = llamadas
  return fn
}

async function sembrarBase() {
  await Promise.all([
    db.collection('users').doc(DOCENTE).set({ role: 'docente', nombre: 'Ana', apellidoPaterno: 'López', email: 'ana@escuela.mx', username: 'CBTIS1-01' }),
    db.collection('users').doc(OTRO).set({ role: 'docente', nombre: 'Beto', apellidoPaterno: 'Ruiz', email: 'beto@escuela.mx' }),
    db.collection('users').doc(ADMIN).set({ role: 'admin', email: 'admin@evaluafacil.mx' }),
    db.collection('subjects').doc('S1').set({ docenteId: DOCENTE, nombre: 'Mantenimiento de impresoras', grupo: '3D' }),
    db.collection('subjects').doc('S_AJENA').set({ docenteId: OTRO, nombre: 'Materia ajena', grupo: '1A' }),
    db.collection('activities').doc('A1').set({ docenteId: DOCENTE, asignaturaId: 'S1', nombre: 'Diagrama: instalar impresora' }),
    db.collection('activities').doc('A_AJENA').set({ docenteId: OTRO, asignaturaId: 'S_AJENA', nombre: 'Actividad secreta' }),
    db.collection('students').doc('ST1').set({ asignaturaId: 'S1', uid: ALUMNO, username: 'GUAD', nombre: 'Guadalupe', apellidoPaterno: 'Pérez' }),
    db.collection('submissions').doc('SUB1').set({ actividadId: 'A1', alumnoId: 'ST1' }),
  ])
}

function reporteIA(extra = {}) {
  return {
    uid: DOCENTE, rol: 'docente', operacion: 'calificar_entregable_ia', contextoId: 'SUB1',
    texto: 'RESPUESTA-PRIVADA-DE-LA-IA con la calificación de Guadalupe', motivo: 'incorrecto',
    comentario: 'La calificación no corresponde', estado: 'nuevo', creadoEn: Timestamp.fromMillis(AHORA - MIN),
    ...extra,
  }
}

function sugerencia(extra = {}) {
  return {
    uid: DOCENTE, rol: 'docente', categoria: 'error_tecnico', descripcion: 'No carga la lista de asistencia',
    ruta: '/subject/:id', pantalla: 'Asignatura', modulo: 'Docente', estado: 'nuevo', creadoEn: Timestamp.fromMillis(AHORA - MIN),
    ...extra,
  }
}

async function crear(coleccion, id, datos) {
  const ref = db.collection(coleccion).doc(id)
  await ref.set(datos)
  return ref
}

async function leer(ref) {
  return (await ref.get()).data()
}

async function antes() {
  await limpiar()
  await sembrarBase()
}

// ── A. El correo ────────────────────────────────────────────────────────────
grupo('A. Contenido del correo')

await caso('Sugerencia: asunto con [Sugerencia a Evalúa Fácil], categoría, pantalla, ruta, descripción y enlace al caso', async () => {
  const c = AV.construirCorreo({
    coleccion: 'sugerencias', id: 'G1', datos: sugerencia({ moderacion: LIMPIA }),
    contexto: { reportante: { rol: 'docente', nombre: 'Ana López', correo: 'ana@escuela.mx' } },
  })
  assert.strictEqual(c.asunto, '[Sugerencia a Evalúa Fácil] Error técnico')
  for (const t of ['Sugerencia a Evalúa Fácil', 'Error técnico', 'Asignatura', '/subject/:id', 'No carga la lista de asistencia', 'Ana López · Docente · ana@escuela.mx']) {
    assert.ok(c.html.includes(t) && c.texto.includes(t), `falta «${t}»`)
  }
  assert.ok(c.html.includes('https://www.evaluafacil.mx/Admin?tab=sugerencias&amp;caso=G1'))
  assert.ok(c.texto.includes('https://www.evaluafacil.mx/Admin?tab=sugerencias&caso=G1'))
  assert.ok(!/reporte/i.test(c.asunto + c.html + c.texto), 'la sugerencia no se llama «reporte»')
})

await caso('Comentario sobre la IA: asunto con [Comentario sobre la IA], motivo y operación legible; NO lleva la respuesta de la IA', async () => {
  const c = AV.construirCorreo({
    coleccion: 'reportesIA', id: 'R1', datos: reporteIA({ ubicacion: 'revision_entrega', ruta: '/activity/:id' }),
    contexto: {
      reportante: { rol: 'docente', nombre: 'Ana López', correo: 'ana@escuela.mx' },
      asignatura: { id: 'S1', nombre: 'Mantenimiento de impresoras', grupo: '3D' },
      actividad: { id: 'A1', nombre: 'Diagrama: instalar impresora' },
      entrega: { id: 'SUB1', alumno: 'Guadalupe Pérez' },
    },
  })
  assert.strictEqual(c.asunto, '[Comentario sobre la IA] Incorrecto o inventado · Calificación de entregable con IA')
  for (const t of ['Comentario sobre la IA', 'Nuevo comentario sobre una respuesta de la IA', 'Incorrecto o inventado', 'Calificación de entregable con IA', 'Evaluación de actividades',
    'Revisión de una entrega', '/activity/:id', 'Mantenimiento de impresoras · Grupo 3D', 'Diagrama: instalar impresora',
    'Hay una entrega relacionada', 'Ana López · Docente · ana@escuela.mx', 'Quien envió el comentario escribió detalles', 'tab=reportesIA&caso=R1']) {
    assert.ok(c.texto.includes(t), `falta «${t}»`)
  }
  assert.ok(!c.html.includes('RESPUESTA-PRIVADA') && !c.texto.includes('RESPUESTA-PRIVADA'))
  assert.ok(!c.texto.includes('calificar_entregable_ia'), 'el id técnico se cambia por el nombre legible')
})

await caso('Reporte de IA (privacidad): ni el comentario libre ni el nombre del alumno viajan en el correo', async () => {
  const c = AV.construirCorreo({
    coleccion: 'reportesIA', id: 'R1',
    datos: reporteIA({ comentario: 'La IA le puso 10 a Guadalupe Pérez y merecía 6; su tel es 5512345678' }),
    contexto: { entrega: { id: 'SUB1', alumno: 'Guadalupe Pérez' }, reportante: { rol: 'docente', nombre: 'Ana López' } },
  })
  for (const dato of ['Guadalupe', 'Pérez', 'merecía 6', '5512345678']) {
    assert.ok(!c.html.includes(dato) && !c.texto.includes(dato) && !c.asunto.includes(dato), `el correo no lleva «${dato}»`)
  }
  assert.ok(c.texto.includes('Quien envió el comentario escribió detalles') && c.texto.includes('panel de administración'))
  // Sin comentario: lo dice, sin inventar uno.
  const sin = AV.construirCorreo({ coleccion: 'reportesIA', id: 'R3', datos: reporteIA({ comentario: '' }), contexto: {} })
  assert.ok(sin.texto.includes('(sin detalles)') && !sin.texto.includes('escribió detalles'))
})

await caso('Comentario sobre la IA: ningún texto visible del correo dice «reporte» ni «reportar»', async () => {
  const c = AV.construirCorreo({
    coleccion: 'reportesIA', id: 'R1', datos: reporteIA({ ubicacion: 'revision_entrega', ruta: '/activity/:id' }),
    contexto: { reportante: { rol: 'docente', nombre: 'Ana López' }, actividad: { id: 'A1', nombre: 'Diagrama' }, entrega: { id: 'SUB1', alumno: 'X' }, aviso: 'Los ids del comentario no corresponden a datos de quien lo envió o ya no existen.' },
  })
  // El enlace lleva el parámetro técnico `tab=reportesIA` (no se cambia): se quita antes de revisar.
  const visible = [c.asunto, c.texto, c.html].join('\n').replace(/https?:\/\/\S+/g, '')
  assert.ok(!/report/i.test(visible), `quedó texto visible con «report»: ${visible.match(/.{0,30}report.{0,30}/i)?.[0]}`)
})

await caso('Reporte viejo sin ubicación: no se inventan módulo ni pantalla', async () => {
  const c = AV.construirCorreo({ coleccion: 'reportesIA', id: 'R2', datos: reporteIA({ operacion: 'rubrica', contextoId: '' }), contexto: {} })
  assert.ok(!c.texto.includes('Módulo:') && !c.texto.includes('Pantalla:') && !c.texto.includes('Actividad:'))
  assert.ok(c.texto.includes('Rúbrica con IA'))
})

await caso('El texto del usuario se escapa en el HTML', async () => {
  const c = AV.construirCorreo({ coleccion: 'sugerencias', id: 'G2', datos: sugerencia({ descripcion: '<script>alert(1)</script> & <b>', moderacion: LIMPIA }), contexto: {} })
  assert.ok(!c.html.includes('<script>') && c.html.includes('&lt;script&gt;') && c.html.includes('&amp;'))
})

// ── B. Brevo ────────────────────────────────────────────────────────────────
grupo('B. Llamada a Brevo (simulada)')

const CLAVE = 'xkeysib-clave-de-prueba-0123456789abcdef'

await caso('Sin clave: no llama a Brevo y devuelve sin_clave', async () => {
  let llamado = false
  const r = await AV.enviarConBrevo({ apiKey: '', asunto: 'a', html: 'h', texto: 't', fetchImpl: async () => { llamado = true } })
  assert.deepStrictEqual(r, { ok: false, codigo: 'sin_clave' })
  assert.strictEqual(llamado, false)
  const r2 = await AV.enviarConBrevo({ apiKey: 'x', asunto: 'a', html: 'h', texto: 't', fetchImpl: async () => { llamado = true } })
  assert.strictEqual(r2.codigo, 'clave_mal_formada')
  assert.strictEqual(llamado, false)
})

await caso('Éxito: remitente soporte@, destinatario admin.evaluafacil@gmail.com, devuelve el messageId', async () => {
  let pedido
  const r = await AV.enviarConBrevo({
    apiKey: CLAVE, asunto: 'Asunto', html: '<p>h</p>', texto: 't',
    fetchImpl: async (url, init) => { pedido = { url, init }; return new Response(JSON.stringify({ messageId: '<abc@brevo>' }), { status: 201 }) },
  })
  assert.deepStrictEqual(r, { ok: true, messageId: '<abc@brevo>' })
  const cuerpo = JSON.parse(pedido.init.body)
  assert.strictEqual(pedido.url, 'https://api.brevo.com/v3/smtp/email')
  assert.strictEqual(cuerpo.sender.email, 'soporte@evaluafacil.mx')
  assert.deepStrictEqual(cuerpo.to.map((t) => t.email), ['admin.evaluafacil@gmail.com'])
  assert.strictEqual(pedido.init.headers['api-key'], CLAVE)
})

await caso('Error HTTP y de red: código corto, sin la clave ni el mensaje crudo', async () => {
  const r = await AV.enviarConBrevo({
    apiKey: CLAVE, asunto: 'a', html: 'h', texto: 't',
    fetchImpl: async () => new Response(JSON.stringify({ code: 'unauthorized', message: `Key not found ${CLAVE}` }), { status: 401 }),
  })
  assert.deepStrictEqual(r, { ok: false, codigo: 'http_401_unauthorized' })
  assert.ok(!JSON.stringify(r).includes(CLAVE))
  const r2 = await AV.enviarConBrevo({ apiKey: CLAVE, asunto: 'a', html: 'h', texto: 't', fetchImpl: async () => { throw new TypeError('fetch failed') } })
  assert.deepStrictEqual(r2, { ok: false, codigo: 'red' })
})

// ── C. Contexto ─────────────────────────────────────────────────────────────
grupo('C. Contexto que resuelve el servidor')

await caso('Reporte con ids: se manda UN correo y el documento guarda quién, asignatura, actividad y alumno', async () => {
  await antes()
  const ref = await crear('reportesIA', 'R1', reporteIA({ ubicacion: 'revision_entrega', ruta: '/activity/:id', actividadId: 'A1', entregaId: 'SUB1' }))
  const enviar = brevoFalso()
  const r = await AV.procesarAviso({ coleccion: 'reportesIA', ref, enviar, ahora: AHORA })
  assert.strictEqual(r.resultado, 'enviado')
  assert.strictEqual(enviar.llamadas.length, 1)
  const d = await leer(ref)
  assert.strictEqual(d.notificacion.estado, 'enviado')
  assert.strictEqual(d.notificacion.intentos, 1)
  assert.strictEqual(d.notificacion.proveedorId, '<msg-1@brevo>')
  assert.deepStrictEqual(d.contexto.reportante, { rol: 'docente', nombre: 'Ana López', correo: 'ana@escuela.mx', usuario: 'CBTIS1-01' })
  assert.deepStrictEqual(d.contexto.asignatura, { id: 'S1', nombre: 'Mantenimiento de impresoras', grupo: '3D' })
  assert.deepStrictEqual(d.contexto.actividad, { id: 'A1', nombre: 'Diagrama: instalar impresora' })
  assert.deepStrictEqual(d.contexto.entrega, { id: 'SUB1', alumno: 'Guadalupe Pérez' })
  assert.strictEqual(d.texto, reporteIA().texto, 'el contenido reportado no se toca')
  assert.strictEqual(d.comentario, 'La calificación no corresponde', 'el comentario se queda en el registro para el panel')
  assert.ok(enviar.llamadas[0].texto.includes('Diagrama: instalar impresora'))
  assert.ok(!enviar.llamadas[0].texto.includes('Guadalupe') && !enviar.llamadas[0].texto.includes('La calificación no corresponde'),
    'el correo no lleva ni el alumno de la entrega ni el comentario')
})

await caso('Ids de OTRO docente: no se revela ningún nombre, el aviso igual sale', async () => {
  await antes()
  const ref = await crear('reportesIA', 'R2', reporteIA({ operacion: 'analizar_resultados', contextoId: 'A_AJENA', actividadId: 'A_AJENA', asignaturaId: 'S_AJENA' }))
  const enviar = brevoFalso()
  await AV.procesarAviso({ coleccion: 'reportesIA', ref, enviar, ahora: AHORA })
  const d = await leer(ref)
  assert.ok(!d.contexto.actividad && !d.contexto.asignatura && !d.contexto.entrega)
  assert.ok(d.contexto.aviso)
  assert.ok(!enviar.llamadas[0].texto.includes('Actividad secreta') && !enviar.llamadas[0].texto.includes('Materia ajena'))
  assert.strictEqual(d.notificacion.estado, 'enviado')
})

await caso('Cliente viejo (solo contextoId de la entrega): se resuelve igual, verificando que sea del docente', async () => {
  await antes()
  const ref = await crear('reportesIA', 'R3', reporteIA())
  await AV.procesarAviso({ coleccion: 'reportesIA', ref, enviar: brevoFalso(), ahora: AHORA })
  const d = await leer(ref)
  assert.strictEqual(d.contexto.actividad?.nombre, 'Diagrama: instalar impresora')
  assert.strictEqual(d.contexto.entrega?.alumno, 'Guadalupe Pérez')
})

await caso('Operación sin contexto conocido (rúbrica): no se adivina nada', async () => {
  await antes()
  const ref = await crear('reportesIA', 'R4', reporteIA({ operacion: 'rubrica', contextoId: 'A1' }))
  await AV.procesarAviso({ coleccion: 'reportesIA', ref, enviar: brevoFalso(), ahora: AHORA })
  const d = await leer(ref)
  assert.ok(!d.contexto.actividad && !d.contexto.asignatura)
})

await caso('Sugerencia de un estudiante: se identifica por su inscripción (nombre y usuario, sin correo)', async () => {
  await antes()
  const ref = await crear('sugerencias', 'G1', sugerencia({ uid: ALUMNO, rol: 'alumno', categoria: 'mejora' }))
  const enviar = brevoFalso()
  await AV.procesarAviso({ coleccion: 'sugerencias', ref, enviar, ahora: AHORA })
  const d = await leer(ref)
  assert.deepStrictEqual(d.contexto.reportante, { rol: 'alumno', nombre: 'Guadalupe Pérez', correo: '', usuario: 'GUAD' })
  assert.ok(enviar.llamadas[0].texto.includes('Guadalupe Pérez · Estudiante · usuario GUAD'))
  assert.strictEqual(enviar.llamadas[0].asunto, '[Sugerencia a Evalúa Fácil] Sugerencia de mejora')
})

// ── D. Fallos y reintentos ──────────────────────────────────────────────────
grupo('D. Fallos, reintentos y reclamos')

await caso('Brevo falla: el registro se queda, queda «fallido» con un código; el barrido lo reintenta y sale', async () => {
  await antes()
  const ref = await crear('sugerencias', 'G2', sugerencia())
  const enviar = brevoFalso([{ ok: false, codigo: 'http_500' }])
  const r1 = await AV.procesarAviso({ coleccion: 'sugerencias', ref, enviar, ahora: AHORA })
  assert.strictEqual(r1.resultado, 'fallido')
  let d = await leer(ref)
  assert.strictEqual(d.descripcion, 'No carga la lista de asistencia', 'el registro sigue completo')
  assert.strictEqual(d.notificacion.estado, 'fallido')
  assert.strictEqual(d.notificacion.ultimoError, 'http_500')
  const resumenBarrido = await AV.barrerPendientes({ enviar, ahora: AHORA + 15 * MIN })
  assert.deepStrictEqual(resumenBarrido, { enviado: 1 })
  d = await leer(ref)
  assert.strictEqual(d.notificacion.estado, 'enviado')
  assert.strictEqual(d.notificacion.intentos, 2)
  assert.strictEqual(enviar.llamadas.length, 2)
  const cuota = (await db.collection('avisosReportesCuota').doc('2026-10-24').get()).data()
  assert.strictEqual(cuota.enviados, 1, 'un reintento no cuenta como un correo nuevo en el tope')
})

await caso('Una excepción del envío también deja «fallido», sin tumbar la función', async () => {
  await antes()
  const ref = await crear('sugerencias', 'G3', sugerencia())
  const r = await AV.procesarAviso({ coleccion: 'sugerencias', ref, enviar: brevoFalso([new Error('boom')]), ahora: AHORA })
  assert.strictEqual(r.resultado, 'fallido')
  assert.strictEqual((await leer(ref)).notificacion.ultimoError, 'error_inesperado')
})

await caso(`Tras ${AV.CONFIG.maxIntentos} intentos fallidos queda «agotado» y no se vuelve a intentar`, async () => {
  await antes()
  const ref = await crear('sugerencias', 'G4', sugerencia())
  const enviar = brevoFalso(Array.from({ length: 10 }, () => ({ ok: false, codigo: 'http_503' })))
  await AV.procesarAviso({ coleccion: 'sugerencias', ref, enviar, ahora: AHORA })
  for (let i = 1; i <= 6; i++) await AV.barrerPendientes({ enviar, ahora: AHORA + i * 15 * MIN })
  const d = await leer(ref)
  assert.strictEqual(d.notificacion.estado, 'agotado')
  assert.strictEqual(enviar.llamadas.length, AV.CONFIG.maxIntentos)
})

await caso('Reclamo muerto («enviando» de hace 11 min) se reintenta; uno reciente (1 min) no', async () => {
  await antes()
  const muerto = await crear('sugerencias', 'G5', sugerencia({ descripcion: 'uno', notificacion: { estado: 'enviando', intentos: 1, reclamadoEn: Timestamp.fromMillis(AHORA - 11 * MIN) } }))
  const vivo = await crear('sugerencias', 'G6', sugerencia({ descripcion: 'dos', notificacion: { estado: 'enviando', intentos: 1, reclamadoEn: Timestamp.fromMillis(AHORA - MIN) } }))
  const enviar = brevoFalso()
  await AV.barrerPendientes({ enviar, ahora: AHORA })
  assert.strictEqual((await leer(muerto)).notificacion.estado, 'enviado')
  assert.strictEqual((await leer(vivo)).notificacion.estado, 'enviando')
  assert.strictEqual(enviar.llamadas.length, 1)
})

await caso('El barrido atiende lo que el disparador nunca tocó (hace 15 min), no lo recién creado (2 min)', async () => {
  await antes()
  const viejo = await crear('reportesIA', 'R5', reporteIA({ creadoEn: Timestamp.fromMillis(AHORA - 15 * MIN) }))
  const reciente = await crear('reportesIA', 'R6', reporteIA({ texto: 'otro', creadoEn: Timestamp.fromMillis(AHORA - 2 * MIN) }))
  const enviar = brevoFalso()
  await AV.barrerPendientes({ enviar, ahora: AHORA })
  assert.strictEqual((await leer(viejo)).notificacion.estado, 'enviado')
  assert.strictEqual((await leer(reciente)).notificacion, undefined)
})

// ── E. Duplicados y límites ─────────────────────────────────────────────────
grupo('E. Duplicados, límites y concurrencia')

await caso('Dos ejecuciones a la vez sobre el mismo aviso: un solo correo', async () => {
  await antes()
  const ref = await crear('reportesIA', 'R7', reporteIA())
  // Brevo tarda: mientras el primero manda, los demás llegan y encuentran
  // el aviso reclamado («enviando»).
  const enviar = brevoFalso([], { demoraMs: 1500 })
  const primero = AV.procesarAviso({ coleccion: 'reportesIA', ref, enviar, ahora: AHORA })
  while (!enviar.llamadas.length) await new Promise((r) => setTimeout(r, 20))
  const resultados = await Promise.all([
    primero,
    AV.procesarAviso({ coleccion: 'reportesIA', ref, enviar, ahora: AHORA }),
    AV.procesarAviso({ coleccion: 'reportesIA', ref, enviar, ahora: AHORA }),
    AV.barrerPendientes({ enviar, ahora: AHORA + 2 * MIN }),
  ])
  assert.strictEqual(enviar.llamadas.length, 1)
  assert.strictEqual(resultados.filter((r) => r.resultado === 'enviado').length, 1)
  assert.strictEqual(resultados[1].resultado, 'sin_reclamo')
  const otra = await AV.procesarAviso({ coleccion: 'reportesIA', ref, enviar, ahora: AHORA + MIN })
  assert.strictEqual(otra.resultado, 'ya_atendido')
  assert.strictEqual(enviar.llamadas.length, 1)
})

await caso('El mismo contenido de la misma persona en 10 min: se guarda, pero no repite correo', async () => {
  await antes()
  const a = await crear('sugerencias', 'G7', sugerencia({ creadoEn: Timestamp.fromMillis(AHORA - 3 * MIN) }))
  const b = await crear('sugerencias', 'G8', sugerencia({ descripcion: '  no carga la LISTA de asistencia ', creadoEn: Timestamp.fromMillis(AHORA - MIN) }))
  const enviar = brevoFalso()
  await AV.procesarAviso({ coleccion: 'sugerencias', ref: a, enviar, ahora: AHORA })
  const r = await AV.procesarAviso({ coleccion: 'sugerencias', ref: b, enviar, ahora: AHORA })
  assert.deepStrictEqual(r, { resultado: 'omitido', motivo: 'duplicado' })
  const d = await leer(b)
  assert.strictEqual(d.notificacion.referencia, 'G7')
  assert.strictEqual(d.estado, 'nuevo', 'sigue en el panel como nuevo')
  assert.strictEqual(enviar.llamadas.length, 1)
  // Otra persona con el mismo texto sí avisa.
  const c = await crear('sugerencias', 'G9', sugerencia({ uid: ALUMNO, rol: 'alumno' }))
  assert.strictEqual((await AV.procesarAviso({ coleccion: 'sugerencias', ref: c, enviar, ahora: AHORA })).resultado, 'enviado')
})

await caso(`Límite por persona: el ${AV.CONFIG.topePorPersonaHora + 1}º en una hora se guarda sin correo`, async () => {
  await antes()
  const enviar = brevoFalso()
  const tope = AV.CONFIG.topePorPersonaHora
  for (let i = 0; i < tope; i++) {
    const ref = await crear('sugerencias', `L${i}`, sugerencia({ descripcion: `tema ${i}`, creadoEn: Timestamp.fromMillis(AHORA - (30 - i) * MIN) }))
    assert.strictEqual((await AV.procesarAviso({ coleccion: 'sugerencias', ref, enviar, ahora: AHORA })).resultado, 'enviado')
  }
  const extra = await crear('sugerencias', 'L_EXTRA', sugerencia({ descripcion: 'uno más' }))
  assert.deepStrictEqual(await AV.procesarAviso({ coleccion: 'sugerencias', ref: extra, enviar, ahora: AHORA }), { resultado: 'omitido', motivo: 'limite_por_persona' })
  assert.strictEqual(enviar.llamadas.length, tope)
  // En la otra colección la cuenta es aparte.
  const ia = await crear('reportesIA', 'R8', reporteIA())
  assert.strictEqual((await AV.procesarAviso({ coleccion: 'reportesIA', ref: ia, enviar, ahora: AHORA })).resultado, 'enviado')
})

await caso('Tope diario: con el día lleno se guarda sin correo; al día siguiente vuelve a avisar', async () => {
  await antes()
  await db.collection('avisosReportesCuota').doc('2026-10-24').set({ enviados: AV.CONFIG.topeDiario })
  const enviar = brevoFalso()
  const ref = await crear('sugerencias', 'G10', sugerencia())
  assert.deepStrictEqual(await AV.procesarAviso({ coleccion: 'sugerencias', ref, enviar, ahora: AHORA }), { resultado: 'omitido', motivo: 'tope_diario' })
  assert.strictEqual(enviar.llamadas.length, 0)
  const manana = AHORA + 24 * 60 * MIN
  const ref2 = await crear('sugerencias', 'G11', sugerencia({ descripcion: 'otro día', creadoEn: Timestamp.fromMillis(manana - MIN) }))
  assert.strictEqual((await AV.procesarAviso({ coleccion: 'sugerencias', ref: ref2, enviar, ahora: manana })).resultado, 'enviado')
  assert.strictEqual((await db.collection('avisosReportesCuota').doc('2026-10-25').get()).data().enviados, 1)
})

await caso('Varias personas a la vez: cada quien su correo y el contador del día cuadra', async () => {
  await antes()
  const enviar = brevoFalso()
  const refs = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    crear('sugerencias', `P${i}`, sugerencia({ uid: `persona_${i}`, descripcion: `asunto ${i}` }))))
  await Promise.all(refs.map((ref) => AV.procesarAviso({ coleccion: 'sugerencias', ref, enviar, ahora: AHORA })))
  assert.strictEqual(enviar.llamadas.length, 6)
  assert.strictEqual((await db.collection('avisosReportesCuota').doc('2026-10-24').get()).data().enviados, 6)
})

// ── F. Históricos y separación ──────────────────────────────────────────────
grupo('F. Registros históricos y separación')

await caso('Reportes históricos (de antes de los avisos) no generan correo ni se modifican', async () => {
  await antes()
  const historico = {
    uid: DOCENTE, rol: 'docente', operacion: 'rubrica', contextoId: '', texto: 'x', motivo: 'otro',
    comentario: '', estado: 'nuevo', creadoEn: Timestamp.fromMillis(AHORA - 10 * 24 * 60 * MIN),
  }
  const ref = await crear('reportesIA', 'R_HIST', historico)
  const revisado = await crear('reportesIA', 'R_HIST2', { ...historico, estado: 'revisado' })
  const enviar = brevoFalso()
  await AV.barrerPendientes({ enviar, ahora: AHORA })
  assert.strictEqual(enviar.llamadas.length, 0)
  assert.deepStrictEqual(await leer(ref), historico)
  assert.strictEqual((await leer(revisado)).estado, 'revisado')
})

await caso('Una sugerencia no toca reportesIA y viceversa', async () => {
  await antes()
  const g = await crear('sugerencias', 'G12', sugerencia())
  const r = await crear('reportesIA', 'R9', reporteIA())
  const enviar = brevoFalso()
  await AV.procesarAviso({ coleccion: 'sugerencias', ref: g, enviar, ahora: AHORA })
  assert.strictEqual((await leer(r)).notificacion, undefined)
  assert.strictEqual((await db.collection('reportesIA').get()).size, 1)
  assert.strictEqual((await db.collection('sugerencias').get()).size, 1)
  assert.ok(enviar.llamadas[0].asunto.startsWith('[Sugerencia a Evalúa Fácil]'))
})

// ── G. Moderación de sugerencias (PR 3) ─────────────────────────────────────
grupo('G. Moderación automática de sugerencias')

await caso('Sugerencia respetuosa o crítica: queda «limpia» y el correo lleva la descripción', async () => {
  await antes()
  const enviar = brevoFalso()
  const textos = ['Esta plataforma es pésima, la calificación es injusta y no sirve para nada', 'Me gustaría poder ver mis calificaciones en una gráfica']
  for (const [i, descripcion] of textos.entries()) {
    const ref = await crear('sugerencias', `M_OK${i}`, sugerencia({ uid: `persona_ok_${i}`, descripcion }))
    await AV.procesarAviso({ coleccion: 'sugerencias', ref, enviar, ahora: AHORA })
    const d = await leer(ref)
    assert.strictEqual(d.moderacion.estado, 'limpia')
    assert.deepStrictEqual(d.moderacion.motivos, [])
    assert.ok(enviar.llamadas[i].texto.includes(descripcion), 'la descripción va en el correo')
    assert.ok(!enviar.llamadas[i].asunto.includes('Retenida'))
  }
})

await caso('Insulto: se guarda completo, queda retenida y el correo NO lleva la descripción', async () => {
  await antes()
  const enviar = brevoFalso()
  const ofensa = 'el maestro es un p3nd3j0 y un imbécil'
  const ref = await crear('sugerencias', 'M_INS', sugerencia({ uid: ALUMNO, rol: 'alumno', descripcion: ofensa }))
  const r = await AV.procesarAviso({ coleccion: 'sugerencias', ref, enviar, ahora: AHORA })
  assert.strictEqual(r.resultado, 'enviado')
  const d = await leer(ref)
  assert.strictEqual(d.descripcion, ofensa, 'no se borra ni se altera')
  assert.strictEqual(d.estado, 'nuevo', 'no se descarta solo')
  assert.strictEqual(d.moderacion.estado, 'retenida')
  assert.deepStrictEqual(d.moderacion.motivos, ['insulto'])
  const c = enviar.llamadas[0]
  assert.strictEqual(c.asunto, '[Sugerencia a Evalúa Fácil] Retenida para revisión · posible insulto')
  for (const pedazo of ['p3nd3j0', 'imbécil', 'maestro es']) {
    assert.ok(!c.html.includes(pedazo) && !c.texto.includes(pedazo) && !c.asunto.includes(pedazo), `el correo no reproduce «${pedazo}»`)
  }
  assert.ok(c.texto.includes('Guadalupe Pérez · Estudiante · usuario GUAD'), 'sí dice quién la envió')
  assert.ok(c.texto.includes('tab=sugerencias&caso=M_INS'))
})

await caso('Amenaza: retenida con «posible amenaza» en el asunto', async () => {
  await antes()
  const enviar = brevoFalso()
  const ref = await crear('sugerencias', 'M_AME', sugerencia({ descripcion: 'te voy a matar, sé dónde vives' }))
  await AV.procesarAviso({ coleccion: 'sugerencias', ref, enviar, ahora: AHORA })
  assert.deepStrictEqual((await leer(ref)).moderacion.motivos, ['amenaza'])
  assert.ok(enviar.llamadas[0].asunto.endsWith('posible amenaza'))
  assert.ok(!enviar.llamadas[0].texto.includes('matar'))
})

await caso('Si el detector falla: «sin_revisar», el registro se guarda y el correo sale sin la descripción', async () => {
  await antes()
  const enviar = brevoFalso()
  const ref = await crear('sugerencias', 'M_ERR', sugerencia({ descripcion: 'texto cualquiera' }))
  const r = await AV.procesarAviso({ coleccion: 'sugerencias', ref, enviar, ahora: AHORA, evaluar: () => { throw new Error('detector roto') } })
  assert.strictEqual(r.resultado, 'enviado')
  const d = await leer(ref)
  assert.strictEqual(d.moderacion.estado, 'sin_revisar')
  assert.strictEqual(d.descripcion, 'texto cualquiera')
  assert.ok(enviar.llamadas[0].asunto.includes('sin revisión automática'))
  assert.ok(!enviar.llamadas[0].texto.includes('texto cualquiera'))
  // Una respuesta sin forma válida también cuenta como falla.
  const ref2 = await crear('sugerencias', 'M_ERR2', sugerencia({ uid: 'otra_persona', descripcion: 'otro texto' }))
  await AV.procesarAviso({ coleccion: 'sugerencias', ref: ref2, enviar, ahora: AHORA, evaluar: () => ({ estado: 'quizas' }) })
  assert.strictEqual((await leer(ref2)).moderacion.estado, 'sin_revisar')
})

await caso('La moderación se decide una vez: un reintento no la recalcula ni la cambia', async () => {
  await antes()
  const ref = await crear('sugerencias', 'M_RE', sugerencia({ descripcion: 'eres un idiota' }))
  await AV.procesarAviso({ coleccion: 'sugerencias', ref, enviar: brevoFalso([{ ok: false, codigo: 'http_500' }]), ahora: AHORA })
  const antesReintento = (await leer(ref)).moderacion
  assert.strictEqual(antesReintento.estado, 'retenida')
  let llamadasDetector = 0
  const enviar = brevoFalso()
  await AV.procesarAviso({ coleccion: 'sugerencias', ref, enviar, ahora: AHORA + 15 * MIN, evaluar: () => { llamadasDetector++; return { estado: 'limpia', motivos: [] } } })
  assert.strictEqual(llamadasDetector, 0)
  assert.deepStrictEqual((await leer(ref)).moderacion, antesReintento)
  assert.ok(enviar.llamadas[0].asunto.includes('Retenida'))
})

await caso('Spam de insultos: el límite por persona sigue aplicando y todo queda guardado', async () => {
  await antes()
  const enviar = brevoFalso()
  for (let i = 0; i < AV.CONFIG.topePorPersonaHora + 2; i++) {
    const ref = await crear('sugerencias', `M_SP${i}`, sugerencia({ descripcion: `idiota ${i}`, creadoEn: Timestamp.fromMillis(AHORA - (30 - i) * MIN) }))
    await AV.procesarAviso({ coleccion: 'sugerencias', ref, enviar, ahora: AHORA })
  }
  assert.strictEqual(enviar.llamadas.length, AV.CONFIG.topePorPersonaHora)
  assert.strictEqual((await db.collection('sugerencias').get()).size, AV.CONFIG.topePorPersonaHora + 2)
  assert.ok(enviar.llamadas.every((c) => !/idiota/.test(c.texto)))
})

await caso('Los Reportes de IA no pasan por la moderación; su comentario se guarda y no va en el correo', async () => {
  await antes()
  const enviar = brevoFalso()
  const ref = await crear('reportesIA', 'M_IA', reporteIA({ comentario: 'la IA es una idiota' }))
  let llamadasDetector = 0
  await AV.procesarAviso({ coleccion: 'reportesIA', ref, enviar, ahora: AHORA, evaluar: () => { llamadasDetector++; return { estado: 'retenida', motivos: ['insulto'] } } })
  assert.strictEqual(llamadasDetector, 0)
  assert.strictEqual((await leer(ref)).moderacion, undefined)
  assert.ok(enviar.llamadas[0].asunto.startsWith('[Comentario sobre la IA]'))
  assert.ok(!enviar.llamadas[0].texto.includes('la IA es una idiota'), 'el comentario no viaja en el correo (opción B)')
  assert.ok(enviar.llamadas[0].texto.includes('Quien envió el comentario escribió detalles'))
  assert.strictEqual((await leer(ref)).comentario, 'la IA es una idiota', 'el comentario se conserva en el registro')
})

await limpiar()
resumen('AVISOS-REPORTES CHECKS')
