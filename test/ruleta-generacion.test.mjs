// La Ruleta del Destino · generación del banco con IA (functions/ruletaGeneracion.js) contra el emulador de Firestore,
// sin red ni costo: Anthropic falso y archivos REALES (PDF de 3 páginas, DOCX y un .doc de Word 97-2003) servidos por
// un `fetch` falso como si vinieran de Cloudinary.
//
//   firebase emulators:exec --only firestore,auth --project demo-test "node test/ruleta-generacion.test.mjs"
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { db, limpiar, caso, grupo, resumen, assert, llamar, sesion } from './helpers/entorno.mjs'
import * as FX from './helpers/fixturesEvidencias.mjs'
import { handleRuletaBanco, huellaEnunciado as huellaApi } from '../api/_lib/ruletaBanco.js'
import { RULETA_ARCHIVOS, RULETA_QUIERE_EVALUAR, datosNuevaRuleta, normalizarTexto, reactivosGeneracionIA, validarArchivosRuleta, validarQuiereEvaluar, tamanoBanco } from '../src/utils/ruletaDestino.js'

const require = createRequire(import.meta.url)
const { jsPDF } = require('jspdf')
const DOC = 'doc_gen'
const OTRO = 'doc_gen_otro'
const S = 'sub_gen'
const clave = () => crypto.randomUUID()
const codigo = (e) => String(e?.code || '')
async function falla(fn) { try { await fn() } catch (e) { return e } throw new Error('se esperaba un error') }

// ── Documentos de apoyo REALES ──────────────────────────────────────────────
// Cada oración es única; la IA falsa toma de aquí sus citas (literales) y sus contextos (la oración completa).
const oracionPdf = (p, i) => `Pagina ${p} del manual, oracion ${i}: la membrana numero ${i} de la seccion ${p} protege a la celula.`
const oracionDocx = (i) => `Documento moderno, oracion ${i}: el ribosoma numero ${i} fabrica la proteina ${i} del tejido.`
const oracionDoc = (i) => `Word antiguo, oracion ${i}: el organelo numero ${i} cumple la funcion ${i} dentro de la celula.`

function pdfConTexto(paginas) {
  const d = new jsPDF()
  paginas.forEach((oraciones, p) => {
    if (p) d.addPage()
    d.setFontSize(9).text(d.splitTextToSize(oraciones.join(' '), 180), 10, 12)
  })
  return Buffer.from(d.output('arraybuffer'))
}
const PDF_PAGINAS = [1, 2, 3].map((p) => Array.from({ length: 12 }, (_, i) => oracionPdf(p, i + 1)))
const ARCHIVOS = {
  'manual.pdf': pdfConTexto(PDF_PAGINAS), // 36 oraciones en 3 páginas
  'apuntes.docx': await FX.docx({ texto: Array.from({ length: 20 }, (_, i) => oracionDocx(i + 1)).join(' ') }),
  'antiguo.doc': readFileSync(new URL('./fixtures/ruleta-apoyo.doc', import.meta.url)), // 15 oraciones (Word 97-2003)
  'escaneado.pdf': FX.pdf({ imagen: [800, 1000] }), // sin capa de texto
  'danado.pdf': FX.pdfDanado(),
  // La misma oración en dos páginas: su contexto es ambiguo.
  'repetido.pdf': pdfConTexto([[oracionPdf(9, 1), 'Relleno uno de la primera hoja para que tenga texto suficiente y se pueda leer bien.'.repeat(3)],
    [oracionPdf(9, 1), 'Relleno dos de la segunda hoja para que tenga texto suficiente y se pueda leer bien.'.repeat(3)]]),
}
const CORPUS = {
  'manual.pdf': PDF_PAGINAS.flatMap((os, p) => os.map((texto) => ({ texto, pagina: p + 1 }))),
  'apuntes.docx': Array.from({ length: 20 }, (_, i) => ({ texto: oracionDocx(i + 1), pagina: null })),
  'antiguo.doc': Array.from({ length: 15 }, (_, i) => ({ texto: oracionDoc(i + 1), pagina: null })),
}
const URL_BASE = 'https://res.cloudinary.com/demo/raw/upload/v1/evalua-facil/ia-fuentes/'
const archivo = (nombre) => ({ url: `${URL_BASE}${nombre}`, nombre })
let pesoDeclarado = null // para simular un archivo que declara pesar más de 15 MB
const descargas = []
const FETCH_REAL = globalThis.fetch
function pincharArchivos() {
  globalThis.fetch = async (url, ...resto) => {
    const u = String(url)
    if (!u.startsWith(URL_BASE)) return FETCH_REAL(url, ...resto)
    const nombre = decodeURIComponent(u.slice(URL_BASE.length))
    descargas.push(nombre)
    const bytes = ARCHIVOS[nombre]
    if (!bytes) return new Response('no existe', { status: 404 })
    // grande.pdf no declara su tamaño: el servidor tiene que medir lo que descargó.
    return new Response(bytes, { status: 200, headers: nombre === 'grande.pdf' ? {} : { 'content-length': String(pesoDeclarado ?? bytes.length) } })
  }
}

// ── Anthropic falso: arma reactivos con oraciones reales de los documentos que recibió ──
const requireFn = createRequire(new URL('../functions/index.js', import.meta.url))
const rutaSdk = requireFn.resolve('@anthropic-ai/sdk')
requireFn(rutaSdk)
const pedidos = []
let comportamiento = {} // { malosPorLlamada, maxValidos, borrarActividad, soloDocumentos }
let usadas = new Set()
require.cache[rutaSdk].exports = class AnthropicFalso {
  constructor() {
    this.messages = {
      create: async (req) => {
        pedidos.push(req)
        if (comportamiento.borrarActividad) await db.doc(`activities/${comportamiento.borrarActividad}`).delete()
        const contenido = req.messages[0].content
        const docsTexto = contenido[0].text
        const prompt = contenido[1].text
        const pedir = Number(prompt.match(/EXACTAMENTE (\d+)/)[1])
        const nombres = [...docsTexto.matchAll(/=== DOCUMENTO (\d+): «([^»]+)»/g)].map((m) => ({ num: Number(m[1]), nombre: m[2] }))
        const reactivos = []
        // Primero los inválidos que pida la prueba (se rechazan y la generación tiene que pedir más).
        for (let i = 0; i < (comportamiento.malosPorLlamada || 0); i++) {
          const o = CORPUS[nombres[0].nombre][0]
          reactivos.push(i % 2
            ? { enunciado: `Pregunta inventada ${pedidos.length}-${i}`, opciones: ['a', 'b', 'c', 'd'], correcta: 0, documento: 1, pagina: 1, cita: 'esto no esta en ningun documento', contexto: 'Esto no esta en ningun documento del docente.' }
            : { enunciado: `Mala forma ${pedidos.length}-${i}`, opciones: ['a', 'b', 'c'], correcta: 0, documento: 1, cita: o.texto, contexto: o.texto })
        }
        for (const { num, nombre } of nombres) {
          for (const o of CORPUS[nombre] || []) {
            if (reactivos.length >= pedir) break
            if (comportamiento.maxValidos != null && usadas.size >= comportamiento.maxValidos) break
            if (usadas.has(o.texto)) continue
            usadas.add(o.texto)
            const cita = o.texto.split(': ')[1].replace(/\.$/, '')
            reactivos.push({
              enunciado: `¿Qué afirma el documento «${nombre}» en «${o.texto.split(':')[0]}»?`,
              opciones: [`Que ${cita}`, `Que no ${cita}`, `Que solo a veces ${cita}`, `Ninguna de las anteriores (${usadas.size})`],
              correcta: 0, documento: num, pagina: o.pagina, cita, contexto: o.texto,
            })
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify({ reactivos }) }], usage: { input_tokens: 100, output_tokens: 50 } }
      },
    }
  }
}
process.env.ANTHROPIC_API_KEY_PROD ||= 'sk-ant-prueba-' + 'x'.repeat(40)
const IA_FN = require('../functions/ia.js')
const G = require('../functions/ruletaGeneracion.js')

const TARIFAS = {
  version: 1, tarifas: { generar_banco_ruleta: 1 }, categorias: { generar_banco_ruleta: 'Actividades' },
  modeloPorOperacion: { generar_banco_ruleta: 'claude-haiku-4-5' },
}
const saldo = async () => (await db.doc(`iaCreditos/${DOC}`).get()).data().saldo
const consumos = async () => (await db.collection('iaConsumos').get()).docs.map((d) => d.data())
const reactivosDe = async (act) => (await db.collection('ruletaReactivos').where('actividadId', '==', act).get()).docs.map((d) => ({ id: d.id, ...d.data() }))
const bancoDe = async (act) => { const s = await db.doc(`ruletaBancos/${act}`).get(); return s.exists ? s.data() : null }

async function crearRuleta(id, { n = 5, docenteId = DOC } = {}) {
  const r = datosNuevaRuleta({ nombre: `Ruleta ${id}`, tema: 'La célula', acceso: 'interno', preguntasPorPartida: n, parcial: 1, orden: 1, asignaturaId: S, docenteId })
  assert.ok(r.ok, r.codigo)
  await db.doc(`activities/${id}`).set(r.datos)
}
async function preparar({ tarifas = TARIFAS } = {}) {
  await limpiar()
  pincharArchivos()
  pedidos.length = 0
  descargas.length = 0
  comportamiento = {}
  usadas = new Set()
  pesoDeclarado = null
  await db.doc(`users/${DOC}`).set({ role: 'docente', nombre: 'Docente', escuelaId: 'E1' })
  await db.doc(`subjects/${S}`).set({ docenteId: DOC, nombre: 'Biología' })
  if (tarifas) await db.doc('config/iaTarifas').set(tarifas)
  await db.doc(`iaCreditos/${DOC}`).set({ saldo: 100, consumidoTotal: 0, consumoPorCategoria: {} })
  await crearRuleta('ru5', { n: 5 })
  await crearRuleta('ru10', { n: 10 })
}
// «¿Qué quieres evaluar?» (decisión 20): todas las generaciones lo llevan; el grupo F prueba sus límites.
// `quiereEvaluar: null` = el navegador no manda el campo.
const QUIERE = 'Las funciones de las membranas y los organelos de la célula, según el manual de la unidad 2.'
const generar = (actividadId, archivos, { uid = DOC, unidades, quiereEvaluar = QUIERE } = {}) => IA_FN.ejecutarOperacionIA.run({
  auth: { uid },
  data: { operacion: 'generar_banco_ruleta', idempotencyKey: clave(), unidades: unidades ?? 5, params: { actividadId, asignaturaId: S, archivos, ...(quiereEvaluar !== null && { quiereEvaluar }) } },
})
async function sinCobroNiBanco(act, saldoEsperado = 100) {
  assert.strictEqual(await saldo(), saldoEsperado, 'el saldo no cambia')
  assert.ok((await consumos()).every((c) => c.estado !== 'ejecutado'), 'nada liquidado')
  assert.strictEqual((await reactivosDe(act)).length, 0, 'ningún reactivo guardado')
  const b = await bancoDe(act)
  assert.ok(!b || b.total === 0, 'banco sin reactivos')
}

// ═════════════════════════════════════════════════════════════════════════════
grupo('A · reglas compartidas cliente / servidor')
// ═════════════════════════════════════════════════════════════════════════════
await caso('A · cantidades, archivos, normalización y huella son las mismas en el cliente, el servidor de la API y functions', () => {
  assert.deepStrictEqual([G.RULETA_IA.REACTIVOS_POR_PREGUNTA * 5, G.RULETA_IA.REACTIVOS_POR_PREGUNTA * 10], [reactivosGeneracionIA(5), reactivosGeneracionIA(10)])
  assert.deepStrictEqual([reactivosGeneracionIA(5), reactivosGeneracionIA(10)], [tamanoBanco(5), tamanoBanco(10)])
  assert.deepStrictEqual([G.RULETA_IA.MIN_ARCHIVOS, G.RULETA_IA.MAX_ARCHIVOS, G.RULETA_IA.MAX_BYTES, G.RULETA_IA.EXTENSIONES],
    [RULETA_ARCHIVOS.MIN, RULETA_ARCHIVOS.MAX, RULETA_ARCHIVOS.MAX_BYTES, [...RULETA_ARCHIVOS.EXTENSIONES]])
  assert.strictEqual(RULETA_ARCHIVOS.ACCEPT, '.pdf,.doc,.docx')
  for (const t of ['¿Qué es la CÉLULA?  ', 'Ñandú  y  pingüino', 'Mitocondria\n\tde la célula']) {
    assert.strictEqual(G._pruebas.normalizarTexto(t), normalizarTexto(t))
    assert.strictEqual(G._pruebas.huellaEnunciado(t), huellaApi(t))
  }
})

await caso('A · validarArchivosRuleta (cliente): 1 a 3, PDF/DOC/DOCX, 15 MB', () => {
  const f = (name, size = 1000) => ({ name, size })
  assert.ok(validarArchivosRuleta([f('a.pdf')]).ok)
  assert.ok(validarArchivosRuleta([f('a.PDF'), f('b.doc'), f('c.Docx')]).ok)
  assert.strictEqual(validarArchivosRuleta([]).codigo, 'sin_archivos')
  assert.ok(validarArchivosRuleta([], { completa: false }).ok)
  assert.strictEqual(validarArchivosRuleta([f('a.pdf'), f('b.pdf'), f('c.pdf'), f('d.pdf')]).codigo, 'demasiados')
  for (const n of ['a.txt', 'a.pptx', 'a.odt', 'a', 'pdf']) assert.strictEqual(validarArchivosRuleta([f(n)]).codigo, 'formato', n)
  assert.ok(validarArchivosRuleta([f('a.pdf', 15 * 1024 * 1024)]).ok)
  assert.strictEqual(validarArchivosRuleta([f('a.pdf', 15 * 1024 * 1024 + 1)]).codigo, 'tamano')
  assert.ok(validarArchivosRuleta([{ nombre: 'b.docx', tamano: 10 }]).ok)
})

await caso('A · validarArchivos (servidor): cantidad, formato y origen; mensajes para el docente', () => {
  const v = G._pruebas.validarArchivos
  assert.deepStrictEqual(v([archivo('x.pdf')]).map((a) => a.ext), ['pdf'])
  assert.deepStrictEqual(v([archivo('a.pdf'), archivo('b.DOC'), archivo('c.docx')]).map((a) => a.ext), ['pdf', 'doc', 'docx'])
  for (const malo of [[], null, [1, 2, 3, 4].map((i) => archivo(`${i}.pdf`))]) assert.match(codigo(captura(() => v(malo))), /invalid-argument/)
  assert.match(captura(() => v([archivo('notas.txt')])).message, /no es PDF, DOC ni DOCX/)
  assert.match(captura(() => v([{ url: 'https://otro.com/a.pdf', nombre: 'a.pdf' }])).message, /vuelve a adjuntarlo/)
  assert.match(captura(() => v([{ url: 'http://res.cloudinary.com/a.pdf', nombre: 'a.pdf' }])).message, /vuelve a adjuntarlo/)
})
function captura(fn) { try { fn() } catch (e) { return e } throw new Error('se esperaba un error') }

// ═════════════════════════════════════════════════════════════════════════════
grupo('B · verificación de cada reactivo contra los documentos')
// ═════════════════════════════════════════════════════════════════════════════
const docsLeidos = await (async () => {
  pincharArchivos()
  const lee = (n) => G._pruebas.leerArchivo({ ...archivo(n), ext: G._pruebas.extensionDe(n) })
  return { pdf: await lee('manual.pdf'), docx: await lee('apuntes.docx'), doc: await lee('antiguo.doc'), repetido: await lee('repetido.pdf') }
})()

await caso('B · los tres formatos se leen: el PDF por páginas, DOCX y DOC completos', () => {
  assert.strictEqual(docsLeidos.pdf.paginas.length, 3)
  assert.ok(docsLeidos.pdf.normalizadas[1].includes(normalizarTexto(oracionPdf(2, 5))))
  assert.ok(!docsLeidos.pdf.normalizadas[0].includes(normalizarTexto(oracionPdf(2, 5))))
  assert.ok(docsLeidos.docx.normalizadas[0].includes(normalizarTexto(oracionDocx(7))))
  assert.ok(docsLeidos.doc.normalizadas[0].includes(normalizarTexto(oracionDoc(15))), 'el .doc antiguo se lee')
  assert.deepStrictEqual([docsLeidos.docx.porPaginas, docsLeidos.doc.porPaginas, docsLeidos.pdf.porPaginas], [false, false, true])
})

const bueno = (extra = {}) => ({
  enunciado: '¿Qué protege la membrana 5?', opciones: ['La célula', 'El núcleo', 'El tejido', 'Nada'], correcta: 0,
  documento: 1, pagina: 2, cita: 'la membrana numero 5 de la seccion 2 protege a la celula', contexto: oracionPdf(2, 5), ...extra,
})
await caso('B · un reactivo bien sustentado se acepta con la página del PDF (la que sale del documento, no la de la IA)', () => {
  const v = G._pruebas.verificarReactivo(bueno({ pagina: 3 }), [docsLeidos.pdf])
  assert.ok(v.ok, v.motivo)
  assert.deepStrictEqual(v.reactivo.sustento, { documento: 'manual.pdf', pagina: 2, cita: 'la membrana numero 5 de la seccion 2 protege a la celula', contexto: oracionPdf(2, 5) })
  assert.strictEqual(v.reactivo.huella, huellaApi('¿Qué protege la membrana 5?'))
  // En DOC/DOCX la página queda vacía.
  const d = G._pruebas.verificarReactivo(bueno({ documento: 2, cita: 'el organelo numero 4 cumple la funcion 4', contexto: oracionDoc(4) }), [docsLeidos.pdf, docsLeidos.doc])
  assert.ok(d.ok, d.motivo)
  assert.strictEqual(d.reactivo.sustento.pagina, null)
})

await caso('B · motivos de rechazo: forma, duplicado, cita inexistente, ambigua y no verificable', () => {
  const ver = (r, docs = [docsLeidos.pdf], huellas) => G._pruebas.verificarReactivo(r, docs, huellas).motivo
  assert.strictEqual(ver(bueno({ opciones: ['a', 'b', 'c'] })), 'reactivo_invalido')
  assert.strictEqual(ver(bueno({ opciones: ['a', 'A', 'b', 'c'] })), 'reactivo_invalido')
  assert.strictEqual(ver(bueno({ correcta: 4 })), 'reactivo_invalido')
  assert.strictEqual(ver(bueno({ correcta: '0' })), 'reactivo_invalido')
  assert.strictEqual(ver(bueno({ enunciado: '' })), 'reactivo_invalido')
  assert.strictEqual(ver(bueno(), [docsLeidos.pdf], new Set([huellaApi(' ¿QUÉ protege la membrana 5? ')])), 'duplicado')
  assert.strictEqual(ver(bueno({ documento: 7 })), 'cita_inexistente')
  assert.strictEqual(ver(bueno({ cita: 'texto que no existe', contexto: 'Texto que no existe en el documento.' })), 'cita_inexistente')
  assert.strictEqual(ver(bueno({ cita: 'otra cosa' })), 'cita_no_verificable') // el contexto no contiene la cita
  assert.strictEqual(ver(bueno({ contexto: '' })), 'cita_no_verificable')
  assert.strictEqual(ver(bueno({ contexto: `${oracionPdf(2, 5)} ${oracionPdf(2, 6)} ${oracionPdf(2, 7)}` })), 'cita_no_verificable') // 3 oraciones
  // Contexto que cruza dos páginas: la cita existe, pero el contexto no está completo en ninguna.
  assert.strictEqual(ver(bueno({ cita: 'la membrana numero 12 de la seccion 1', contexto: `${oracionPdf(1, 12)} ${oracionPdf(2, 1)}` })), 'cita_no_verificable')
  // La misma oración en dos páginas: ambigua.
  assert.strictEqual(ver(bueno({ cita: 'la membrana numero 1 de la seccion 9', contexto: oracionPdf(9, 1) }), [docsLeidos.repetido]), 'cita_ambigua')
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('C · generación completa (callable real, IA falsa)')
// ═════════════════════════════════════════════════════════════════════════════
await caso('C · 5 preguntas + PDF y DOCX: EXACTAMENTE 25 reactivos, origen ia, sin aprobar; cobra 5; no publica ni crea partidas', async () => {
  await preparar()
  const antes = (await db.doc('activities/ru5').get()).data()
  const r = await generar('ru5', [archivo('manual.pdf'), archivo('apuntes.docx')])
  assert.strictEqual(r.resultado.total, 25)
  const rs = await reactivosDe('ru5')
  assert.strictEqual(rs.length, 25)
  for (const x of rs) {
    assert.strictEqual(x.opciones.length, 4)
    assert.ok(Number.isInteger(x.correcta) && x.correcta >= 0 && x.correcta <= 3)
    assert.strictEqual(x.docenteId, DOC)
    assert.ok(['manual.pdf', 'apuntes.docx'].includes(x.sustento.documento))
    assert.strictEqual(x.huella, huellaApi(x.enunciado))
  }
  assert.strictEqual(new Set(rs.map((x) => x.huella)).size, 25, 'sin repetidos')
  const b = await bancoDe('ru5')
  assert.deepStrictEqual([b.total, b.origen, b.aprobado, Object.keys(b.huellas).length], [25, 'ia', false, 25])
  assert.strictEqual(await saldo(), 95, 'cobra 5 créditos (1 por pregunta de la partida)')
  const act = (await db.doc('activities/ru5').get()).data()
  assert.deepStrictEqual([act.oculta, act.publishedAt, act.ruleta], [antes.oculta, antes.publishedAt, antes.ruleta], 'la ruleta no se publica ni cambia')
  assert.strictEqual((await db.collection('ruletaParticipantes').where('actividadId', '==', 'ru5').get()).size, 0, 'no se crean partidas')
})

await caso('C · el docente aprueba el banco generado con el servidor de siempre (25 exactos)', async () => {
  const tk = await sesion(DOC, { email: 'docgen@prueba.test' })
  const a = await llamar(handleRuletaBanco, { cuerpo: { operacion: 'aprobar', actividadId: 'ru5' }, token: tk })
  assert.strictEqual(a.statusCode, 200, JSON.stringify(a.cuerpo))
  assert.deepStrictEqual([a.cuerpo.banco.origen, a.cuerpo.banco.total, a.cuerpo.banco.aprobado], ['ia', 25, true])
})

await caso('C · 10 preguntas + PDF, DOCX y DOC: EXACTAMENTE 50 reactivos en varios lotes; cobra 10', async () => {
  await preparar()
  const r = await generar('ru10', [archivo('manual.pdf'), archivo('apuntes.docx'), archivo('antiguo.doc')], { unidades: 10 })
  assert.strictEqual(r.resultado.total, 50)
  const rs = await reactivosDe('ru10')
  assert.strictEqual(rs.length, 50)
  assert.ok(pedidos.length >= 2, 'más de un lote')
  assert.strictEqual(await saldo(), 90)
  const b = await bancoDe('ru10')
  assert.deepStrictEqual([b.total, b.origen, b.aprobado], [50, 'ia', false])
})

await caso('C · el .doc antiguo se lee y se manda a la IA; solo, con 15 oraciones, no alcanza para 25: se rechaza sin cobrar', async () => {
  await preparar()
  const e = await falla(() => generar('ru5', [archivo('antiguo.doc')]))
  // 15 oraciones únicas no alcanzan para 25: se rechaza sin cobrar (documento insuficiente).
  assert.match(codigo(e), /failed-precondition/)
  assert.match(e.message, /no alcanzaron para generar 25/)
  await sinCobroNiBanco('ru5')
  assert.ok(pedidos.length >= 1, 'sí se leyó y se pidió a la IA')
})

await caso('C · reactivos inválidos de la IA se descartan y se piden más hasta completar exactamente 25', async () => {
  await preparar()
  comportamiento = { malosPorLlamada: 4 }
  const r = await generar('ru5', [archivo('manual.pdf'), archivo('apuntes.docx')])
  assert.strictEqual(r.resultado.total, 25)
  assert.ok((r.resultado.rechazados.reactivo_invalido || 0) > 0 && (r.resultado.rechazados.cita_inexistente || 0) > 0, JSON.stringify(r.resultado.rechazados))
  assert.strictEqual((await reactivosDe('ru5')).length, 25)
  assert.strictEqual(await saldo(), 95)
})

await caso('C · documentos insuficientes (la IA solo logra 20 válidos): no se guarda nada y se devuelven los créditos', async () => {
  await preparar()
  comportamiento = { maxValidos: 20 }
  const e = await falla(() => generar('ru5', [archivo('manual.pdf')]))
  assert.match(e.message, /se lograron 20/)
  await sinCobroNiBanco('ru5')
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('D · rechazos ANTES de cobrar (sin reservar créditos ni llamar a la IA)')
// ═════════════════════════════════════════════════════════════════════════════
await caso('D · cantidad de archivos, formato, origen, PDF escaneado, dañado, inexistente o de más de 15 MB', async () => {
  await preparar()
  const casos = [
    [[], /de 1 a 3 archivos/],
    [[archivo('a.pdf'), archivo('b.pdf'), archivo('c.pdf'), archivo('d.pdf')], /de 1 a 3 archivos/],
    [[archivo('notas.txt')], /no es PDF, DOC ni DOCX/],
    [[{ url: 'https://evil.example/manual.pdf', nombre: 'manual.pdf' }], /vuelve a adjuntarlo/],
    [[archivo('escaneado.pdf')], /no tiene texto que se pueda verificar/],
    [[archivo('danado.pdf')], /dañado o protegido/],
    [[archivo('no-existe.pdf')], /No se pudo descargar/],
  ]
  for (const [archivos, mensaje] of casos) {
    const e = await falla(() => generar('ru5', archivos))
    assert.match(e.message, mensaje, JSON.stringify(archivos))
    assert.match(e.message, /No se descontaron créditos/)
  }
  pesoDeclarado = 15 * 1024 * 1024 + 1
  assert.match((await falla(() => generar('ru5', [archivo('manual.pdf')]))).message, /pesa más de 15 MB/)
  pesoDeclarado = null
  ARCHIVOS['grande.pdf'] = Buffer.alloc(15 * 1024 * 1024 + 1, 32) // sin cabecera de tamaño: se mide al descargar
  assert.match((await falla(() => generar('ru5', [archivo('grande.pdf')]))).message, /pesa más de 15 MB/)
  delete ARCHIVOS['grande.pdf']
  assert.strictEqual(pedidos.length, 0, 'nunca se llamó a la IA')
  assert.strictEqual((await consumos()).length, 0, 'no se reservó nada')
  await sinCobroNiBanco('ru5')
})

await caso('D · el banco ya tiene reactivos: no se genera ni se cobra (la IA nunca completa un banco)', async () => {
  await preparar()
  const tk = await sesion(DOC, { email: 'docgen@prueba.test' })
  const g = await llamar(handleRuletaBanco, { cuerpo: { operacion: 'guardar', actividadId: 'ru5', reactivo: { enunciado: '¿Uno a mano?', opciones: ['a', 'b', 'c', 'd'], correcta: 1 } }, token: tk })
  assert.strictEqual(g.statusCode, 200)
  const e = await falla(() => generar('ru5', [archivo('manual.pdf')]))
  assert.match(e.message, /El banco ya tiene reactivos/)
  assert.strictEqual(pedidos.length, 0)
  assert.strictEqual(await saldo(), 100)
  assert.strictEqual((await reactivosDe('ru5')).length, 1, 'el reactivo manual sigue intacto')
})

await caso('D · otro docente, una actividad que no es ruleta o inexistente: rechazados sin cobrar', async () => {
  await preparar()
  await db.doc(`users/${OTRO}`).set({ role: 'docente', escuelaId: 'E1' })
  await db.doc(`iaCreditos/${OTRO}`).set({ saldo: 100, consumidoTotal: 0, consumoPorCategoria: {} })
  assert.match(codigo(await falla(() => generar('ru5', [archivo('manual.pdf')], { uid: OTRO }))), /permission-denied/)
  await db.doc('activities/act_normal').set({ docenteId: DOC, asignaturaId: S, categoria: 'cuestionario', nombre: 'X' })
  assert.match((await falla(() => generar('act_normal', [archivo('manual.pdf')]))).message, /no es una Ruleta/)
  assert.match(codigo(await falla(() => generar('no_existe', [archivo('manual.pdf')]))), /not-found/)
  assert.strictEqual(pedidos.length, 0)
  assert.strictEqual(await saldo(), 100)
})

await caso('D · sin tarifa configurada: se rechaza sin cobrar (la captura manual no depende de esto)', async () => {
  await preparar({ tarifas: { version: 1, tarifas: {}, categorias: {}, modeloPorOperacion: {} } })
  const e = await falla(() => generar('ru5', [archivo('manual.pdf')]))
  assert.ok(e)
  assert.strictEqual(pedidos.length, 0)
  await sinCobroNiBanco('ru5')
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('E · escrituras tardías y concurrencia')
// ═════════════════════════════════════════════════════════════════════════════
await caso('E · la ruleta se borra mientras la IA genera: no se guarda nada, no se recrea y se devuelven los créditos', async () => {
  await preparar()
  comportamiento = { borrarActividad: 'ru5' }
  const e = await falla(() => generar('ru5', [archivo('manual.pdf'), archivo('apuntes.docx')]))
  assert.match(codigo(e), /not-found/)
  assert.strictEqual((await db.doc('activities/ru5').get()).exists, false, 'no se recrea')
  await sinCobroNiBanco('ru5')
})

await caso('E · el docente captura un reactivo mientras la IA genera: no se reemplaza su banco y no se cobra', async () => {
  await preparar()
  const tk = await sesion(DOC, { email: 'docgen@prueba.test' })
  // La IA falsa, en su primera llamada, deja que el docente guarde un reactivo a mano.
  const crearOriginal = require.cache[rutaSdk].exports
  let una = false
  require.cache[rutaSdk].exports = class extends crearOriginal {
    constructor() {
      super()
      const base = this.messages.create
      this.messages.create = async (req) => {
        if (!una) {
          una = true
          const g = await llamar(handleRuletaBanco, { cuerpo: { operacion: 'guardar', actividadId: 'ru5', reactivo: { enunciado: '¿A mano a mitad?', opciones: ['a', 'b', 'c', 'd'], correcta: 2 } }, token: tk })
          assert.strictEqual(g.statusCode, 200)
        }
        return base(req)
      }
    }
  }
  try {
    const e = await falla(() => generar('ru5', [archivo('manual.pdf')]))
    assert.match(e.message, /el banco recibió reactivos/)
  } finally {
    require.cache[rutaSdk].exports = crearOriginal
  }
  assert.strictEqual(await saldo(), 100)
  const rs = await reactivosDe('ru5')
  assert.deepStrictEqual(rs.map((x) => x.enunciado), ['¿A mano a mitad?'], 'solo queda el reactivo del docente')
  assert.strictEqual((await bancoDe('ru5')).origen, 'manual')
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('F · «¿Qué quieres evaluar?» (decisión 20)')
// ═════════════════════════════════════════════════════════════════════════════
await caso('F · mismos límites en el cliente y en el servidor (40 y 4000, los de la plataforma)', () => {
  assert.deepStrictEqual([RULETA_QUIERE_EVALUAR.MIN, RULETA_QUIERE_EVALUAR.MAX], [G.RULETA_IA.MIN_QUIERE_EVALUAR, G.RULETA_IA.MAX_QUIERE_EVALUAR])
  assert.deepStrictEqual([RULETA_QUIERE_EVALUAR.MIN, RULETA_QUIERE_EVALUAR.MAX], [40, 4000])
})

await caso('F · validarQuiereEvaluar (cliente): cuenta los caracteres que faltan; 40 y 4000 pasan; 4001 no; se recorta', () => {
  assert.deepStrictEqual(validarQuiereEvaluar(''), validarQuiereEvaluar('   '))
  assert.strictEqual(validarQuiereEvaluar('').faltan, 40)
  const v = validarQuiereEvaluar('La célula')
  assert.deepStrictEqual([v.ok, v.codigo, v.faltan], [false, 'corto', 31])
  assert.match(v.mensaje, /faltan 31 caracteres/)
  assert.strictEqual(validarQuiereEvaluar('x'.repeat(39)).faltan, 1)
  assert.match(validarQuiereEvaluar('x'.repeat(39)).mensaje, /falta 1 carácter|faltan 1 carácter/)
  assert.ok(validarQuiereEvaluar('x'.repeat(40)).ok)
  assert.ok(validarQuiereEvaluar(`  ${'x'.repeat(40)}  `).ok)
  assert.strictEqual(validarQuiereEvaluar(`  ${'x'.repeat(39)}  `).faltan, 1, 'los espacios no cuentan')
  assert.ok(validarQuiereEvaluar('x'.repeat(4000)).ok)
  assert.deepStrictEqual([validarQuiereEvaluar('x'.repeat(4001)).ok, validarQuiereEvaluar('x'.repeat(4001)).codigo], [false, 'largo'])
})

await caso('F · sin texto, con menos de 40 o con más de 4000: rechazado ANTES de descargar, llamar a la IA o reservar', async () => {
  await preparar()
  for (const [quiereEvaluar, mensaje] of [
    [null, /mínimo 40 caracteres/], ['', /mínimo 40 caracteres/], ['La célula', /mínimo 40 caracteres/],
    [`   ${'x'.repeat(39)}   `, /mínimo 40 caracteres/], [12345, /mínimo 40 caracteres/],
    ['x'.repeat(4001), /máximo 4000 caracteres/],
  ]) {
    const e = await falla(() => generar('ru5', [archivo('manual.pdf'), archivo('apuntes.docx')], { quiereEvaluar }))
    assert.match(codigo(e), /invalid-argument/, String(quiereEvaluar).slice(0, 20))
    assert.match(e.message, mensaje)
    assert.match(e.message, /No se descontaron créditos/)
  }
  assert.strictEqual(descargas.length, 0, 'no se descargó ningún archivo')
  assert.strictEqual(pedidos.length, 0, 'no se llamó a la IA')
  assert.strictEqual((await consumos()).length, 0, 'no se reservó nada')
  await sinCobroNiBanco('ru5')
})

await caso('F · con exactamente 40 caracteres genera los 25; el texto llega al prompt como criterio principal', async () => {
  await preparar()
  const cuarenta = 'Funciones de la membrana de la celula 12'
  assert.strictEqual(cuarenta.length, 40)
  const r = await generar('ru5', [archivo('manual.pdf'), archivo('apuntes.docx')], { quiereEvaluar: `  ${cuarenta}  ` })
  assert.strictEqual(r.resultado.total, 25)
  const prompt = pedidos[0].messages[0].content[1].text
  assert.ok(prompt.includes(`QUÉ QUIERE EVALUAR EL DOCENTE (criterio principal: TODOS los reactivos deben evaluar este contenido):\n"""${cuarenta}"""`), 'llega recortado y entre comillas')
  assert.ok(prompt.indexOf('QUÉ QUIERE EVALUAR') < prompt.indexOf('Genera EXACTAMENTE'), 'va antes del pedido')
  assert.match(prompt, /que evalúen lo que pide el docente y estén sustentados en los documentos/)
  assert.match(pedidos[0].system, /El docente indica qué quiere evaluar y ese es el criterio principal: TODOS los reactivos evalúan ese contenido/)
  // Los documentos siguen siendo la fuente: van en el prefijo (en caché) y cada reactivo trae su cita verificada.
  assert.match(pedidos[0].messages[0].content[0].text, /=== DOCUMENTO 1: «manual\.pdf»/)
  assert.ok(pedidos[0].messages[0].content[0].cache_control, 'el prefijo de documentos sigue en caché')
  assert.ok(!pedidos[0].messages[0].content[0].text.includes(cuarenta), 'la instrucción no se mezcla con los documentos')
  for (const x of await reactivosDe('ru5')) assert.ok(['manual.pdf', 'apuntes.docx'].includes(x.sustento.documento))
  assert.strictEqual(await saldo(), 95)
})

await caso('F · con exactamente 4000 caracteres: 50 reactivos, 4 opciones y una correcta; el texto va en CADA lote', async () => {
  await preparar()
  const largo = `Evaluar las membranas y los organelos. ${'Detalle del contenido. '.repeat(400)}`.slice(0, 4000)
  assert.strictEqual(largo.length, 4000)
  const r = await generar('ru10', [archivo('manual.pdf'), archivo('apuntes.docx'), archivo('antiguo.doc')], { unidades: 10, quiereEvaluar: largo })
  assert.strictEqual(r.resultado.total, 50)
  assert.ok(pedidos.length >= 2)
  for (const pq of pedidos) assert.ok(pq.messages[0].content[1].text.includes(`"""${largo}"""`), 'cada lote lleva la instrucción completa')
  const rs = await reactivosDe('ru10')
  assert.strictEqual(rs.length, 50)
  for (const x of rs) assert.ok(x.opciones.length === 4 && Number.isInteger(x.correcta) && x.correcta >= 0 && x.correcta <= 3)
  const b = await bancoDe('ru10')
  assert.deepStrictEqual([b.total, b.origen, b.aprobado], [50, 'ia', false], 'queda sin aprobar')
  assert.strictEqual(await saldo(), 90)
})

await caso('F · el tema guardado de la ruleta no cambia: la instrucción solo viaja en esta generación', async () => {
  await preparar()
  const antes = (await db.doc('activities/ru5').get()).data()
  await generar('ru5', [archivo('manual.pdf'), archivo('apuntes.docx')], { quiereEvaluar: 'Otra cosa distinta del tema: solo las funciones de los ribosomas del tejido.' })
  const despues = (await db.doc('activities/ru5').get()).data()
  assert.strictEqual(despues.tema, antes.tema)
  assert.deepStrictEqual(despues, antes, 'la actividad queda idéntica')
  assert.ok(pedidos[0].messages[0].content[1].text.includes(`Tema general de la ruleta: ${antes.tema}`), 'el tema sigue como referencia general')
  assert.ok(!JSON.stringify((await reactivosDe('ru5'))[0]).includes('ribosomas del tejido.'), 'no se guarda la instrucción en los reactivos')
  assert.ok(!('quiereEvaluar' in (await bancoDe('ru5'))), 'ni en el banco')
})

globalThis.fetch = FETCH_REAL
await limpiar()
resumen('ruleta-generacion.test.mjs')
