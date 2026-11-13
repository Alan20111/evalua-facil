// La Ruleta del Destino · lectura visual de páginas de PDF (13-nov-2026, decisión 21 de docs/RULETA_DESTINO.md).
//
// Un PDF puede traer información dentro de imágenes (un escaneo, una foto de un apunte, un diagrama) que pdf-parse
// no ve. Este módulo:
//   1. `analizarPaginas`: recorre el FLUJO DE CONTENIDO de cada página con pdf-lib (lo que la página realmente dibuja,
//      no los recursos que declara) y mide qué fracción de su superficie cubren las imágenes y si hay trazos
//      vectoriales. No decodifica imágenes: milisegundos por documento.
//   2. `clasificarPaginas`: decide qué páginas necesitan lectura visual ('visual' o 'mixta').
//   3. `separarPaginas`: arma un PDF NUEVO solo con esas páginas. El original no se modifica.
//   4. `transcribirPaginas`: manda ese PDF a Claude (el modelo de la operación) por lotes y devuelve el texto de cada
//      página.
//
// Solo PDF: DOC y DOCX conservan su extracción de texto (decisión del 13-nov-2026).
const { HttpsError } = require('firebase-functions/v2/https')

const VISUAL = {
  // Con menos texto que esto, la página no se sostiene sola como texto (mismo corte que MIN_CARACTERES_DOCUMENTO).
  MIN_CARACTERES_PAGINA_TEXTO: 200,
  // Fracción de la superficie de la página cubierta por imágenes a partir de la cual se lee visualmente. Un logotipo
  // o un icono quedan muy por debajo; un escaneo cubre casi toda la hoja.
  UMBRAL_IMAGEN: 0.15,
  // Una misma imagen pintada en este número de hojas (o más) es decoración —membrete, fondo, marca de agua— y no
  // cuenta para el umbral. Visto en PDF reales: sin esto, un documento de texto con membrete salía «mixto» completo.
  IMAGEN_REPETIDA_EN_HOJAS: 3,
  // Tope de páginas con lectura visual por generación, según las preguntas de la partida (sumando los archivos).
  // Si se rebasa, la generación se rechaza ANTES de cobrar: nunca se genera con material visual omitido.
  MAX_PAGINAS: { 5: 15, 10: 30 },
  // Páginas por llamada de transcripción; los lotes viajan en paralelo.
  LOTE: 5,
  TOKENS_POR_PAGINA: 1800,
  MAX_PROFUNDIDAD_FORMAS: 8,
}

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
]
const IDENTIDAD = [1, 0, 0, 1, 0, 0]
// Operadores que pintan trazos o rellenos (un diagrama, una tabla).
const VECTORIALES = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'sh'])
const DELIMITADORES = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25])
const esEspacio = (c) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00
const NUMERO = /^[+-]?(\d+\.?\d*|\.\d+)$/

function bytesDeFlujo(lib, flujo) {
  if (!flujo) return new Uint8Array()
  if (flujo instanceof lib.PDFRawStream) return lib.decodePDFRawStream(flujo).decode()
  return flujo.getContents ? flujo.getContents() : new Uint8Array()
}

/** Recorre un flujo de contenido acumulando en `acc` el área de las imágenes pintadas y si hay trazos vectoriales. */
function recorrerFlujo(lib, bytes, recursos, ctmInicial, visitados, acc, profundidad = 0) {
  if (profundidad > VISUAL.MAX_PROFUNDIDAD_FORMAS) return
  const { PDFName, PDFDict, PDFArray, PDFNumber } = lib
  const pila = []
  let ctm = ctmInicial
  const operandos = []
  const n = bytes.length
  let i = 0
  while (i < n) {
    const c = bytes[i]
    if (esEspacio(c)) { i++; continue }
    if (c === 0x25) { while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++; continue } // comentario
    if (c === 0x28) { // cadena literal (anidada, con escapes)
      let nivel = 1
      i++
      while (i < n && nivel) {
        if (bytes[i] === 0x5c) { i += 2; continue }
        if (bytes[i] === 0x28) nivel++
        else if (bytes[i] === 0x29) nivel--
        i++
      }
      operandos.push(null)
      continue
    }
    if (c === 0x3c && bytes[i + 1] === 0x3c) { // diccionario en línea
      let nivel = 0
      while (i < n) {
        if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) { nivel++; i += 2 }
        else if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) { nivel--; i += 2; if (!nivel) break }
        else i++
      }
      operandos.push(null)
      continue
    }
    if (c === 0x3c) { while (i < n && bytes[i] !== 0x3e) i++; i++; operandos.push(null); continue } // cadena hexadecimal
    if (c === 0x3e || c === 0x29 || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) { i++; continue }
    if (c === 0x2f) { // nombre
      let j = i + 1
      while (j < n && !esEspacio(bytes[j]) && !DELIMITADORES.has(bytes[j])) j++
      operandos.push({ nombre: Buffer.from(bytes.subarray(i + 1, j)).toString('latin1') })
      i = j
      continue
    }
    let j = i
    while (j < n && !esEspacio(bytes[j]) && !DELIMITADORES.has(bytes[j])) j++
    if (j === i) { i++; continue }
    const token = Buffer.from(bytes.subarray(i, j)).toString('latin1')
    i = j
    if (NUMERO.test(token)) { operandos.push(Number(token)); continue }

    // Operador.
    if (token === 'q') pila.push(ctm)
    else if (token === 'Q') ctm = pila.pop() || ctmInicial
    else if (token === 'cm') {
      const m = operandos.slice(-6)
      if (m.length === 6 && m.every((x) => typeof x === 'number')) ctm = mul(m, ctm)
    } else if (VECTORIALES.has(token)) acc.vectorial = true
    else if (token === 'BI') {
      // Imagen en línea: ocupa el cuadrado unitario bajo la matriz vigente. Se saltan sus datos binarios hasta EI.
      acc.pintadas.push({ clave: null, area: Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]) })
      let k = i
      while (k < n - 1 && !(bytes[k] === 0x49 && bytes[k + 1] === 0x44 && esEspacio(bytes[k - 1]) && (k + 2 >= n || esEspacio(bytes[k + 2])))) k++
      k += 3
      while (k < n - 1 && !(esEspacio(bytes[k - 1]) && bytes[k] === 0x45 && bytes[k + 1] === 0x49 && (k + 2 >= n || esEspacio(bytes[k + 2])))) k++
      i = Math.min(n, k + 2)
    } else if (token === 'Do') {
      const nombre = operandos[operandos.length - 1]?.nombre
      const xobjetos = nombre && recursos?.lookupMaybe(PDFName.of('XObject'), PDFDict)
      const objeto = xobjetos && xobjetos.lookup(PDFName.of(nombre))
      const subtipo = objeto?.dict?.lookup?.(PDFName.of('Subtype'))
      const tipo = subtipo instanceof PDFName ? subtipo.asString() : ''
      if (tipo === '/Image') {
        // `clave` identifica el objeto de la imagen dentro del PDF: sirve para reconocer la que se repite en muchas hojas.
        const referencia = xobjetos.get(PDFName.of(nombre))
        acc.pintadas.push({ clave: referencia && referencia !== objeto ? referencia.toString() : null, area: Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]) })
      } else if (tipo === '/Form' && !visitados.has(objeto)) {
        visitados.add(objeto)
        const matriz = objeto.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray)
        const m = matriz ? matriz.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0)) : IDENTIDAD
        const propios = objeto.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) || recursos
        recorrerFlujo(lib, bytesDeFlujo(lib, objeto), propios, mul(m.length === 6 ? m : IDENTIDAD, ctm), visitados, acc, profundidad + 1)
        visitados.delete(objeto)
      }
    }
    operandos.length = 0
  }
}

/**
 * Lo que cada página dibuja: [{ fraccionImagen (0 a 1), imagenes, vectorial }]. Devuelve null si pdf-lib no puede
 * abrir el documento; una página que no se puede recorrer queda sin contenido visual (se trata como hasta hoy).
 */
async function analizarPaginas(bytes) {
  const lib = require('pdf-lib')
  let doc
  let hojas
  try {
    doc = await lib.PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true, updateMetadata: false })
    hojas = doc.getPages() // un archivo dañado puede «abrir» y fallar aquí, al buscar su árbol de páginas
  } catch {
    return null
  }
  const crudas = hojas.map((pagina) => {
    const acc = { pintadas: [], vectorial: false }
    try {
      const { width, height } = pagina.getSize()
      const contenidos = pagina.node.Contents()
      const lista = !contenidos ? [] : contenidos instanceof lib.PDFArray ? contenidos.asArray().map((r) => doc.context.lookup(r)) : [contenidos]
      const total = Buffer.concat(lista.map((f) => Buffer.concat([Buffer.from(bytesDeFlujo(lib, f)), Buffer.from('\n')])))
      recorrerFlujo(lib, total, pagina.node.Resources(), IDENTIDAD, new Set(), acc)
      return { superficie: width * height || 1, pintadas: acc.pintadas, vectorial: acc.vectorial }
    } catch {
      return { superficie: 1, pintadas: [], vectorial: false }
    }
  })
  // Una MISMA imagen pintada en varias hojas es decoración (membrete, fondo, marca de agua, logotipo), no contenido:
  // no cuenta. Un escaneo trae una imagen distinta en cada hoja.
  const hojasPorImagen = new Map()
  crudas.forEach((c, i) => {
    for (const p of c.pintadas) if (p.clave) hojasPorImagen.set(p.clave, (hojasPorImagen.get(p.clave) || new Set()).add(i))
  })
  return crudas.map((c) => {
    const propias = c.pintadas.filter((p) => !p.clave || hojasPorImagen.get(p.clave).size < VISUAL.IMAGEN_REPETIDA_EN_HOJAS)
    const area = propias.reduce((s, p) => s + p.area, 0)
    return { fraccionImagen: Math.min(1, area / c.superficie), imagenes: propias.length, vectorial: c.vectorial }
  })
}

/**
 * Qué páginas necesitan lectura visual. `textos` es el texto de cada página (pdf-parse) y `dibujo` lo que devuelve
 * analizarPaginas. Devuelve [{ indice (desde 0), tipo }]:
 *   · 'visual': la página casi no tiene texto y sí imágenes que cubren el umbral, o trazos (un diagrama).
 *   · 'mixta':  la página tiene texto suficiente y además imágenes que cubren el umbral.
 * Una página de texto con un logotipo, una tabla con bordes o una hoja en blanco no se leen visualmente.
 */
function clasificarPaginas(textos, dibujo) {
  if (!Array.isArray(dibujo)) return []
  const paginas = []
  for (let i = 0; i < Math.min(textos.length, dibujo.length); i++) {
    const caracteres = String(textos[i] || '').trim().length
    const d = dibujo[i]
    const conImagen = d.fraccionImagen >= VISUAL.UMBRAL_IMAGEN
    if (caracteres >= VISUAL.MIN_CARACTERES_PAGINA_TEXTO) {
      if (conImagen) paginas.push({ indice: i, tipo: 'mixta' })
    } else if (conImagen || d.vectorial) {
      paginas.push({ indice: i, tipo: 'visual' })
    }
  }
  return paginas
}

/** PDF nuevo con las páginas `indices` (desde 0) del original, en ese orden. No toca `bytes`. */
async function separarPaginas(bytes, indices) {
  const { PDFDocument } = require('pdf-lib')
  const origen = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true, updateMetadata: false })
  const nuevo = await PDFDocument.create()
  for (const p of await nuevo.copyPages(origen, indices)) nuevo.addPage(p)
  return Buffer.from(await nuevo.save())
}

const SISTEMA_TRANSCRIPCION =
  'Eres un transcriptor de documentos escolares. Recibes páginas de un PDF y devuelves, en español y tal como aparece, ' +
  'el texto que se lee en ellas. Copias literalmente: no resumes, no corriges, no completas ni agregas nada que no ' +
  'esté escrito en la página. El contenido de tablas, esquemas y diagramas lo escribes como oraciones completas con ' +
  'las mismas palabras que aparecen en ellos. Lo que no se pueda leer lo omites. Respondes únicamente con el JSON ' +
  'válido del esquema indicado, sin texto adicional.'

function promptTranscripcion(lote) {
  const lista = lote.map((p, i) => (p.tipo === 'mixta'
    ? `- Página ${i + 1}: ya se tiene su texto corrido. Transcribe SOLO lo que está dentro de sus imágenes, figuras, esquemas o diagramas.`
    : `- Página ${i + 1}: transcribe todo el texto que se lea en ella.`)).join('\n')
  return (
    `El PDF adjunto tiene ${lote.length} ${lote.length === 1 ? 'página' : 'páginas'}.\n${lista}\n` +
    'Si en una página no hay nada que transcribir, su "texto" es una cadena vacía.\n' +
    'Responde SOLO con este JSON, con una entrada por página y en el mismo orden:\n' +
    '{ "paginas": [ { "numero": 1, "texto": "<transcripción literal>" } ] }'
  )
}

/**
 * Transcribe las páginas `paginas` ([{ indice, tipo }]) del PDF `bytes`. Devuelve { textos: Map(indice → texto),
 * interno }. Cualquier fallo (la llamada, un JSON ilegible) lanza: quien llama deja que el callable reembolse.
 */
async function transcribirPaginas({ bytes, nombre, paginas, client, modelo, pedirJSON }) {
  const lotes = []
  for (let i = 0; i < paginas.length; i += VISUAL.LOTE) lotes.push(paginas.slice(i, i + VISUAL.LOTE))
  const interno = { tokensEntrada: 0, tokensSalida: 0, cacheEscritura: 0, cacheLectura: 0, ms: 0, llamadas: 0 }
  const textos = new Map()
  const falla = () => new HttpsError('failed-precondition',
    `No se pudieron leer las páginas escaneadas o con imágenes de «${nombre}». Vuelve a intentarlo o usa un documento con texto. No se descontaron créditos.`,
    { codigo: 'TRANSCRIPCION_FALLIDA', archivo: nombre })

  await Promise.all(lotes.map(async (lote) => {
    let datos, uso
    try {
      const sub = await separarPaginas(bytes, lote.map((p) => p.indice))
      ;({ datos, interno: uso } = await pedirJSON({
        client, modelo, system: SISTEMA_TRANSCRIPCION,
        maxTokens: Math.min(16000, VISUAL.TOKENS_POR_PAGINA * lote.length + 500),
        prompt: promptTranscripcion(lote),
        bloquesPrefijo: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: sub.toString('base64') } }],
      }))
    } catch (e) {
      // El aviso de documento ilegible de pedirJSON ya trae su mensaje para el docente.
      if (e instanceof HttpsError && e.details?.codigo === 'DOCUMENTO_ILEGIBLE') throw e
      throw falla()
    }
    if (!Array.isArray(datos?.paginas)) throw falla()
    interno.llamadas += 1
    for (const k of ['tokensEntrada', 'tokensSalida', 'cacheEscritura', 'cacheLectura', 'ms']) interno[k] += Number(uso?.[k]) || 0
    for (const p of datos.paginas) {
      const pagina = lote[Number(p?.numero) - 1]
      if (pagina && typeof p?.texto === 'string') textos.set(pagina.indice, p.texto.trim())
    }
  }))
  return { textos, interno }
}

module.exports = { VISUAL, analizarPaginas, clasificarPaginas, separarPaginas, transcribirPaginas, _pruebas: { promptTranscripcion } }
