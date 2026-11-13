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
let comportamiento = {} // { malosPorLlamada, maxValidos, borrarActividad, soloDocumentos, visual }
let usadas = new Set()
// Lectura visual (grupo G): la IA falsa «transcribe» cada página del PDF que recibe con oraciones únicas y las pone
// al frente del corpus de `comportamiento.visual.nombre`, para que la generación las use primero.
const transcripciones = []
let numeroLectura = 0
async function transcripcionFalsa(req) {
  const v = comportamiento.visual || {}
  transcripciones.push(req)
  if (v.falla) throw new Error('fallo simulado de la transcripción')
  const usage = { input_tokens: 2000, output_tokens: 300 }
  if (v.jsonMalo) return { content: [{ type: 'text', text: 'Aquí va la transcripción, pero no en JSON' }], usage }
  const sub = await requireFn('pdf-lib').PDFDocument.load(Buffer.from(req.messages[0].content[0].source.data, 'base64'))
  const nuevas = []
  const paginas = sub.getPages().map((_, i) => {
    if (v.vacio) return { numero: i + 1, texto: '' }
    const os = Array.from({ length: v.oraciones ?? 10 }, (_, j) => {
      numeroLectura += 1
      return `Lectura visual ${numeroLectura}, oracion ${j + 1}: la figura numero ${numeroLectura} muestra el cloroplasto ${j + 1}.`
    })
    nuevas.push(...os.map((texto) => ({ texto, pagina: null })))
    return { numero: i + 1, texto: os.join(' ') }
  })
  CORPUS[v.nombre].unshift(...nuevas)
  return { content: [{ type: 'text', text: JSON.stringify({ paginas }) }], usage }
}
require.cache[rutaSdk].exports = class AnthropicFalso {
  constructor() {
    this.messages = {
      create: async (req) => {
        pedidos.push(req)
        if (comportamiento.borrarActividad) await db.doc(`activities/${comportamiento.borrarActividad}`).delete()
        const contenido = req.messages[0].content
        if (contenido[0].type === 'document') return transcripcionFalsa(req)
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

// ═════════════════════════════════════════════════════════════════════════════
grupo('G · lectura visual de PDF: páginas escaneadas y con imágenes (decisión 21)')
// ═════════════════════════════════════════════════════════════════════════════
const V = require('../functions/ruletaPdfVisual.js')
const PDFLIB = requireFn('pdf-lib')
const oracionTexto = (doc, p, i) => `${doc} pagina ${p}, oracion ${i}: la vacuola numero ${i} de la hoja ${p} guarda agua.`
const A4 = [595, 842]
/** PDF armado con pdf-lib. Cada página: { texto: [oraciones], imagen: [ancho, alto] en puntos, diagrama: true }. */
async function pdfVisual(paginas) {
  const d = await PDFLIB.PDFDocument.create()
  const fuente = await d.embedFont(PDFLIB.StandardFonts.Helvetica)
  // `repetida`: la MISMA imagen en cada hoja (un membrete o un logotipo). Si no, cada hoja lleva la suya (un escaneo).
  const membrete = await d.embedPng(FX.png(64, 64))
  for (const p of paginas) {
    const hoja = d.addPage(A4)
    ;(p.texto || []).forEach((t, i) => hoja.drawText(t, { x: 30, y: 800 - i * 13, size: 9, font: fuente }))
    if (p.imagen) hoja.drawImage(p.repetida ? membrete : await d.embedPng(FX.png(64, 64)), { x: 30, y: 20, width: p.imagen[0], height: p.imagen[1] })
    if (p.diagrama) {
      hoja.drawRectangle({ x: 50, y: 400, width: 200, height: 100, borderColor: PDFLIB.rgb(0, 0, 0), borderWidth: 2 })
      hoja.drawLine({ start: { x: 250, y: 450 }, end: { x: 400, y: 450 }, thickness: 2 })
    }
  }
  return Buffer.from(await d.save())
}
const hojaTexto = (doc, p, extra = {}) => ({ texto: Array.from({ length: 12 }, (_, i) => oracionTexto(doc, p, i + 1)), ...extra })
const ESCANEO = { imagen: [595, 842] } // la hoja completa es una imagen, sin capa de texto
const LOGO = { imagen: [60, 30], repetida: true } // 0.4 % de la hoja
const FIGURA = { imagen: [320, 320] } // 20 % de la hoja
const MEMBRETE = { imagen: [595, 842], repetida: true } // un fondo de hoja completa, el mismo en todas
const corpusTexto = (doc, paginas) => paginas.flatMap((p) => Array.from({ length: 12 }, (_, i) => ({ texto: oracionTexto(doc, p, i + 1), pagina: p })))
Object.assign(ARCHIVOS, {
  'escaneo.pdf': await pdfVisual([ESCANEO, ESCANEO, ESCANEO]),
  'mixto.pdf': await pdfVisual([hojaTexto('Mixto', 1), hojaTexto('Mixto', 2, FIGURA), hojaTexto('Mixto', 3, LOGO)]),
  'logos.pdf': await pdfVisual([1, 2, 3].map((p) => hojaTexto('Logos', p, LOGO))),
  'membrete.pdf': await pdfVisual([1, 2, 3, 4].map((p) => hojaTexto('Membrete', p, MEMBRETE))),
  'diagramas.pdf': await pdfVisual([hojaTexto('Diagramas', 1), { diagrama: true }, ESCANEO, {}]),
  'escaneo15.pdf': await pdfVisual(Array.from({ length: 15 }, () => ESCANEO)),
  'escaneo16.pdf': await pdfVisual(Array.from({ length: 16 }, () => ESCANEO)),
  'escaneo31.pdf': await pdfVisual(Array.from({ length: 31 }, () => ESCANEO)),
})
const CORPUS_BASE = {
  'escaneo.pdf': [], 'escaneo15.pdf': [], 'escaneo16.pdf': [], 'escaneo31.pdf': [],
  'mixto.pdf': corpusTexto('Mixto', [1, 2, 3]),
  'logos.pdf': corpusTexto('Logos', [1, 2, 3]),
  'membrete.pdf': corpusTexto('Membrete', [1, 2, 3, 4]),
  'diagramas.pdf': corpusTexto('Diagramas', [1]),
}
async function prepararVisual(nombre, visual = {}) {
  await preparar()
  transcripciones.length = 0
  for (const [n, base] of Object.entries(CORPUS_BASE)) CORPUS[n] = [...base]
  comportamiento = { visual: { nombre, ...visual } }
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const leer = (n) => G._pruebas.leerArchivo({ ...archivo(n), ext: 'pdf' })
const tipos = (d) => (d.visuales || []).map((v) => `${v.indice + 1}:${v.tipo}`)

await caso('G · detección por contenido dibujado: los 8 casos de la prueba de concepto', async () => {
  // 1 texto · 2 escaneo · 3 mixta · 4 texto que DECLARA una imagen sin pintarla · 5 imagen anidada en una forma ·
  // 6 diagrama vectorial sin texto · 7 en blanco · 8 texto con bordes de tabla.
  const d = await PDFLIB.PDFDocument.create()
  const fuente = await d.embedFont(PDFLIB.StandardFonts.Helvetica)
  const foto = await d.embedPng(FX.png(64, 64))
  const escribir = (hoja, p) => hojaTexto('Casos', p).texto.forEach((t, i) => hoja.drawText(t, { x: 30, y: 800 - i * 13, size: 9, font: fuente }))
  escribir(d.addPage(A4), 1)
  d.addPage(A4).drawImage(foto, { x: 40, y: 300, width: 500, height: 500 })
  const p3 = d.addPage(A4); escribir(p3, 3); p3.drawImage(foto, { x: 40, y: 100, width: 300, height: 300 })
  const p4 = d.addPage(A4); escribir(p4, 4)
  const aux = await PDFLIB.PDFDocument.create()
  aux.addPage([300, 300]).drawImage(await aux.embedPng(FX.png(32, 32)), { x: 0, y: 0, width: 300, height: 300 })
  const [incrustada] = await d.embedPdf(await aux.save())
  d.addPage(A4).drawPage(incrustada, { x: 40, y: 300 })
  const p6 = d.addPage(A4)
  p6.drawRectangle({ x: 50, y: 400, width: 200, height: 100, borderColor: PDFLIB.rgb(0, 0, 0), borderWidth: 2 })
  d.addPage(A4)
  const p8 = d.addPage(A4); escribir(p8, 8)
  p8.drawRectangle({ x: 25, y: 640, width: 540, height: 175, borderColor: PDFLIB.rgb(0, 0, 0), borderWidth: 1 })
  p4.node.Resources().set(PDFLIB.PDFName.of('XObject'), p3.node.Resources().lookup(PDFLIB.PDFName.of('XObject'), PDFLIB.PDFDict))
  const bytes = Buffer.from(await d.save())
  const huella = sha(bytes)

  const dibujo = await V.analizarPaginas(bytes)
  assert.deepStrictEqual(dibujo.map((x) => x.imagenes), [0, 1, 1, 0, 1, 0, 0, 0], 'solo cuentan las imágenes que de verdad se pintan')
  assert.deepStrictEqual(dibujo.map((x) => x.vectorial), [false, false, false, false, false, true, false, true])
  assert.ok(Math.abs(dibujo[1].fraccionImagen - 250000 / (595 * 842)) < 0.001, 'el área sale de la matriz con que se pinta')
  assert.ok(Math.abs(dibujo[4].fraccionImagen - 90000 / (595 * 842)) < 0.001, 'también la de una imagen anidada')
  const textos = await leerTextos(bytes)
  assert.deepStrictEqual(V.clasificarPaginas(textos, dibujo), [
    { indice: 1, tipo: 'visual' }, { indice: 2, tipo: 'mixta' }, { indice: 4, tipo: 'visual' }, { indice: 5, tipo: 'visual' },
  ])
  // Separar páginas arma un PDF nuevo y deja el original tal cual.
  const sub = await V.separarPaginas(bytes, [1, 2, 5])
  assert.strictEqual((await PDFLIB.PDFDocument.load(sub)).getPageCount(), 3)
  assert.deepStrictEqual((await V.analizarPaginas(sub)).map((x) => [x.imagenes, x.vectorial]), [[1, false], [1, false], [0, true]])
  assert.strictEqual(sha(bytes), huella, 'el PDF original no se modifica')
  // Un archivo que pdf-lib no puede abrir no rompe nada: sin análisis, sin páginas visuales.
  assert.strictEqual(await V.analizarPaginas(FX.pdfDanado()), null)
  assert.deepStrictEqual(V.clasificarPaginas(['x'], null), [])
})
async function leerTextos(bytes) {
  ARCHIVOS['temporal.pdf'] = bytes
  pincharArchivos()
  try { return (await leer('temporal.pdf')).paginas } finally { delete ARCHIVOS['temporal.pdf'] }
}

await caso('G · clasificación de los documentos de prueba: escaneo, mixto, logotipos y diagramas', async () => {
  pincharArchivos()
  assert.deepStrictEqual(tipos(await leer('escaneo.pdf')), ['1:visual', '2:visual', '3:visual'])
  assert.deepStrictEqual(tipos(await leer('mixto.pdf')), ['2:mixta'], 'la hoja con logotipo y la de solo texto no se leen visualmente')
  const logos = await leer('logos.pdf')
  assert.deepStrictEqual([tipos(logos), 'bytes' in logos, 'visuales' in logos], [[], false, false], 'un PDF de texto con logotipos queda como hasta hoy')
  assert.deepStrictEqual(tipos(await leer('diagramas.pdf')), ['2:visual', '3:visual'], 'el diagrama y la imagen; la hoja en blanco no')
  // Un membrete o fondo de hoja completa, el mismo en todas las hojas, es decoración: el documento es de texto.
  assert.deepStrictEqual(tipos(await leer('membrete.pdf')), [])
  assert.deepStrictEqual((await V.analizarPaginas(ARCHIVOS['membrete.pdf'])).map((x) => x.imagenes), [0, 0, 0, 0])
  assert.deepStrictEqual([G._pruebas.maxPaginasVisuales(5), G._pruebas.maxPaginasVisuales(10)], [15, 30])
  assert.strictEqual(V.VISUAL.UMBRAL_IMAGEN, 0.15)
})

await caso('G · PDF escaneado (3 páginas sin texto): se transcribe, genera 25 exactos con sustento.visual y cobra 5', async () => {
  await prepararVisual('escaneo.pdf')
  const original = sha(ARCHIVOS['escaneo.pdf'])
  const r = await generar('ru5', [archivo('escaneo.pdf')])
  assert.strictEqual(r.resultado.total, 25)
  assert.strictEqual(transcripciones.length, 1, '3 páginas: un solo lote')
  const t = transcripciones[0]
  assert.strictEqual(t.model, 'claude-haiku-4-5', 'el mismo modelo de la operación')
  assert.deepStrictEqual([t.messages[0].content[0].source.type, t.messages[0].content[0].source.media_type], ['base64', 'application/pdf'])
  assert.strictEqual((await PDFLIB.PDFDocument.load(Buffer.from(t.messages[0].content[0].source.data, 'base64'))).getPageCount(), 3)
  assert.match(t.messages[0].content[1].text, /Página 3: transcribe todo el texto/)
  const rs = await reactivosDe('ru5')
  assert.strictEqual(rs.length, 25)
  for (const x of rs) {
    assert.strictEqual(x.sustento.visual, true)
    assert.ok([1, 2, 3].includes(x.sustento.pagina), 'la página es la del PDF original')
    assert.strictEqual(x.sustento.documento, 'escaneo.pdf')
  }
  assert.deepStrictEqual([...new Set(rs.map((x) => x.sustento.pagina))].sort(), [1, 2, 3])
  const b = await bancoDe('ru5')
  assert.deepStrictEqual([b.total, b.origen, b.aprobado], [25, 'ia', false])
  assert.strictEqual(await saldo(), 95, 'la tarifa no cambia: 5 créditos')
  assert.strictEqual(sha(ARCHIVOS['escaneo.pdf']), original, 'el PDF original no se modifica')
  // La generación recibe el texto transcrito como texto de cada página.
  const gen = pedidos.find((p) => p.messages[0].content[0].type === 'text')
  assert.match(gen.messages[0].content[0].text, /\[Página 2\]\nLectura visual \d+, oracion 1:/)
})

await caso('G · PDF mixto: solo viaja la página con imagen; conserva su texto y suma lo visual; visual solo donde corresponde', async () => {
  await prepararVisual('mixto.pdf')
  await generar('ru5', [archivo('mixto.pdf')])
  assert.strictEqual(transcripciones.length, 1)
  const t = transcripciones[0].messages[0].content
  assert.strictEqual((await PDFLIB.PDFDocument.load(Buffer.from(t[0].source.data, 'base64'))).getPageCount(), 1, 'no se manda el PDF completo')
  assert.match(t[1].text, /Página 1: ya se tiene su texto corrido\. Transcribe SOLO lo que está dentro de sus imágenes/)
  const gen = pedidos.find((p) => p.messages[0].content[0].type === 'text').messages[0].content[0].text
  const pagina2 = gen.split('[Página 2]')[1].split('[Página 3]')[0]
  assert.ok(pagina2.includes(oracionTexto('Mixto', 2, 7)) && /Lectura visual \d+, oracion 10:/.test(pagina2), 'texto extraído + lectura visual en la misma página')
  const rs = await reactivosDe('ru5')
  assert.strictEqual(rs.length, 25)
  const visuales = rs.filter((x) => x.sustento.visual === true)
  const deTexto = rs.filter((x) => !('visual' in x.sustento))
  assert.deepStrictEqual([visuales.length, deTexto.length], [10, 15])
  assert.ok(visuales.every((x) => x.sustento.pagina === 2 && x.sustento.cita.startsWith('la figura')))
  assert.ok(deTexto.some((x) => x.sustento.pagina === 2), 'un sustento del texto de la página mixta NO se marca visual')
  assert.ok(deTexto.every((x) => x.sustento.cita.startsWith('la vacuola')))
  assert.strictEqual(await saldo(), 95)
})

await caso('G · PDF con logotipos pequeños: sin lectura visual, mismo resultado que antes (sin campo visual)', async () => {
  await prepararVisual('logos.pdf')
  const r = await generar('ru5', [archivo('logos.pdf')])
  assert.strictEqual(r.resultado.total, 25)
  assert.strictEqual(transcripciones.length, 0, 'ninguna llamada de transcripción')
  assert.strictEqual(pedidos.length, 1, 'una sola llamada, como hasta hoy')
  for (const x of await reactivosDe('ru5')) assert.deepStrictEqual(Object.keys(x.sustento).sort(), ['cita', 'contexto', 'documento', 'pagina'])
  assert.strictEqual(await saldo(), 95)
  // Lo mismo con un membrete de hoja completa repetido en las 4 hojas.
  await prepararVisual('membrete.pdf')
  assert.strictEqual((await generar('ru5', [archivo('membrete.pdf')])).resultado.total, 25)
  assert.deepStrictEqual([transcripciones.length, pedidos.length], [0, 1])
  assert.ok((await reactivosDe('ru5')).every((x) => !('visual' in x.sustento)))
})

await caso('G · PDF con diagrama e imagen con texto: se leen esas dos páginas y se combinan con la de texto', async () => {
  await prepararVisual('diagramas.pdf')
  await generar('ru5', [archivo('diagramas.pdf')])
  assert.strictEqual(transcripciones.length, 1)
  assert.strictEqual((await PDFLIB.PDFDocument.load(Buffer.from(transcripciones[0].messages[0].content[0].source.data, 'base64'))).getPageCount(), 2)
  const rs = await reactivosDe('ru5')
  assert.strictEqual(rs.length, 25)
  assert.deepStrictEqual([...new Set(rs.filter((x) => x.sustento.visual).map((x) => x.sustento.pagina))].sort(), [2, 3])
  assert.ok(rs.filter((x) => !x.sustento.visual).every((x) => x.sustento.pagina === 1))
})

await caso('G · límite de páginas visuales: 15 con 5 preguntas y 30 con 10; al rebasarlo se rechaza ANTES de cobrar', async () => {
  await prepararVisual('escaneo16.pdf')
  const casos = [
    ['ru5', [archivo('escaneo16.pdf')], /tienen 16 páginas escaneadas o con imágenes.*partida de 5 preguntas el máximo es de 15/],
    ['ru5', [archivo('escaneo15.pdf'), archivo('mixto.pdf')], /tienen 16 páginas.*máximo es de 15/], // suman entre archivos
    ['ru10', [archivo('escaneo31.pdf')], /tienen 31 páginas.*partida de 10 preguntas el máximo es de 30/],
  ]
  for (const [act, archivos, mensaje] of casos) {
    const e = await falla(() => generar(act, archivos, { unidades: act === 'ru10' ? 10 : 5 }))
    assert.match(e.message, mensaje)
    assert.match(e.message, /No se descontaron créditos/)
    assert.match(codigo(e), /failed-precondition/)
  }
  assert.strictEqual(pedidos.length, 0, 'nunca se llamó a la IA')
  assert.strictEqual((await consumos()).length, 0, 'no se reservó nada')
  await sinCobroNiBanco('ru5')
  await sinCobroNiBanco('ru10')
})

await caso('G · justo en el límite (15 páginas, 5 preguntas) sí genera: 3 lotes de transcripción de 5 páginas', async () => {
  await prepararVisual('escaneo15.pdf')
  const r = await generar('ru5', [archivo('escaneo15.pdf')])
  assert.strictEqual(r.resultado.total, 25)
  assert.strictEqual(transcripciones.length, 3)
  assert.strictEqual(await saldo(), 95)
  // Y 16 páginas caben en una partida de 10 preguntas (tope 30).
  await prepararVisual('escaneo16.pdf')
  assert.strictEqual((await generar('ru10', [archivo('escaneo16.pdf')], { unidades: 10 })).resultado.total, 50)
  assert.strictEqual(transcripciones.length, 4)
  assert.strictEqual(await saldo(), 90, 'la tarifa no cambia: 10 créditos')
})

await caso('G · reembolso: la transcripción falla, responde algo ilegible o no encuentra texto', async () => {
  const casos = [
    [{ falla: true }, /No se pudieron leer las páginas escaneadas o con imágenes de «escaneo\.pdf»/],
    [{ jsonMalo: true }, /No se pudieron leer las páginas escaneadas o con imágenes de «escaneo\.pdf»/],
    [{ vacio: true }, /no se encontró texto suficiente, ni siquiera leyendo sus imágenes/],
  ]
  for (const [visual, mensaje] of casos) {
    await prepararVisual('escaneo.pdf', visual)
    const e = await falla(() => generar('ru5', [archivo('escaneo.pdf')]))
    assert.match(e.message, mensaje, JSON.stringify(visual))
    assert.match(e.message, /No se descontaron créditos/)
    assert.strictEqual(transcripciones.length, 1, 'sí se intentó leer (ya con la reserva hecha)')
    const cs = await consumos()
    assert.strictEqual(cs.length, 1, 'hubo una reserva')
    await sinCobroNiBanco('ru5')
  }
})

await caso('G · reembolso: la transcripción sale bien pero la generación no completa los 25', async () => {
  await prepararVisual('escaneo.pdf')
  comportamiento.maxValidos = 20
  const e = await falla(() => generar('ru5', [archivo('escaneo.pdf')]))
  assert.match(e.message, /se lograron 20/)
  assert.match(e.message, /No se descontaron créditos/)
  await sinCobroNiBanco('ru5')
})

await caso('G · regresión: los PDF de texto de siempre y el DOCX no pasan por la lectura visual', async () => {
  await prepararVisual('manual.pdf')
  const r = await generar('ru5', [archivo('manual.pdf'), archivo('apuntes.docx')])
  assert.strictEqual(r.resultado.total, 25)
  assert.strictEqual(transcripciones.length, 0)
  assert.ok((await reactivosDe('ru5')).every((x) => !('visual' in x.sustento)))
  // El PDF de imagen pequeña y sin texto se sigue rechazando antes de cobrar, con el mensaje de siempre.
  await prepararVisual('escaneado.pdf')
  const e = await falla(() => generar('ru5', [archivo('escaneado.pdf')]))
  assert.match(e.message, /no tiene texto que se pueda verificar/)
  assert.strictEqual(pedidos.length, 0)
  await sinCobroNiBanco('ru5')
})

globalThis.fetch = FETCH_REAL
await limpiar()
resumen('ruleta-generacion.test.mjs')
