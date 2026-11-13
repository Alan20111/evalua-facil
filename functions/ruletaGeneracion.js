// La Ruleta del Destino · generación del banco con IA (9-nov-2026, decisión 19 de docs/RULETA_DESTINO.md).
//
// El docente adjunta de 1 a 3 archivos de apoyo (PDF, DOC o DOCX, hasta 15 MB cada uno) y la IA genera el banco
// COMPLETO de la ruleta: exactamente 25 reactivos para partidas de 5 preguntas o 50 para partidas de 10 (decisión 18),
// cada uno de opción múltiple con 4 opciones y una sola correcta, sustentado en los documentos.
//
//   · «¿Qué quieres evaluar?» (`params.quiereEvaluar`, 12-nov-2026, decisión 20): lo que el docente pide evaluar, el
//     mismo campo de Reto Exprés y Crear evaluación con IA (mínimo 40 y máximo 4000 caracteres). Es el criterio
//     principal del prompt: TODOS los reactivos evalúan ese contenido, sustentados en los documentos.
//   · precheckGenerarBancoRuleta (ANTES de cobrar): dueño, ruleta, qué quiere evaluar, banco VACÍO, archivos (cantidad, formato, tamaño,
//     origen) y lectura de cada documento. Un documento que no se puede leer, o que no tiene texto ni páginas que se
//     puedan leer visualmente, detiene la operación sin reservar créditos. Fija las unidades a cobrar: 1 por pregunta
//     de la partida (5 o 10 créditos con la tarifa `generar_banco_ruleta = 1`).
//   · Lectura visual de PDF (13-nov-2026, decisión 21; functions/ruletaPdfVisual.js): las páginas escaneadas o con
//     imágenes se detectan en el precheck (sin IA). Si suman más del tope (15 con 5 preguntas, 30 con 10) se rechaza
//     ANTES de cobrar. Ya con la reserva hecha, esas páginas se transcriben con el mismo modelo y su texto se une al
//     del documento; si la transcripción falla, el callable devuelve la reserva. La tarifa no cambia.
//   · ejecutarGenerarBancoRuleta: pide los reactivos a la IA por lotes y verifica cada uno contra los documentos
//     (forma, sin repetir, cita y contexto literales en una sola página; ver «Sustento documental» en el documento).
//     Si no se reúne la cantidad exacta de reactivos válidos, falla y el callable devuelve la reserva: nunca se guarda
//     un banco parcial. Con la cantidad exacta, los guarda en una transacción que relee la actividad y exige el banco
//     todavía vacío (functions/actividadLimpieza.js: una generación que termina tarde no escribe nada). El banco
//     queda con origen `ia` y SIN aprobar: el docente lo revisa, edita y aprueba como uno manual. No publica la
//     ruleta ni crea partidas.
//
// Las constantes de cantidades, archivos y normalización son las mismas que src/utils/ruletaDestino.js y
// api/_lib/ruletaBanco.js (huella del enunciado); test/ruleta-generacion.test.mjs comprueba que coincidan.
const crypto = require('crypto')
const { HttpsError } = require('firebase-functions/v2/https')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { escribirSiActividadExiste } = require('./actividadLimpieza')
const pdfVisual = require('./ruletaPdfVisual')

const RULETA_IA = {
  CATEGORIA: 'ruleta',
  PREGUNTAS_POR_PARTIDA: [5, 10],
  REACTIVOS_POR_PREGUNTA: 5,
  MIN_ARCHIVOS: 1,
  MAX_ARCHIVOS: 3,
  MAX_BYTES: 15 * 1024 * 1024,
  EXTENSIONES: ['pdf', 'doc', 'docx'],
  // Un documento con menos texto no alcanza para sustentar reactivos (p. ej. un PDF escaneado: solo imágenes).
  MIN_CARACTERES_DOCUMENTO: 200,
  // Tope del texto que viaja a la IA (los tres documentos juntos): ~90 000 tokens.
  MAX_CARACTERES_TOTALES: 300000,
  OPCIONES: 4,
  MAX_ENUNCIADO: 500,
  MAX_OPCION: 200,
  MAX_CITA: 500,
  MAX_CONTEXTO: 1000,
  // «¿Qué quieres evaluar?»: los mismos límites que `reactivos` y `crear_evaluacion_ia` (functions/ia.js).
  MIN_QUIERE_EVALUAR: 40,
  MAX_QUIERE_EVALUAR: 4000,
  // Lotes de reactivos por llamada a la IA y cuántos de más se piden para cubrir los que no pasen la verificación.
  LOTE: 25,
  MARGEN: 5,
  // Llamadas extra permitidas para completar los que faltan; después, la generación falla y se reembolsa.
  LLAMADAS_EXTRA: 2,
}

const idValido = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
const reactivosExactos = (n) => n * RULETA_IA.REACTIVOS_POR_PREGUNTA

// ── Normalización (misma que src/utils/ruletaDestino.js → normalizarTexto y api/_lib/ruletaBanco.js → huella) ──

function normalizarTexto(t) {
  return String(t ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim()
}

function huellaEnunciado(enunciado) {
  return crypto.createHash('sha256').update(normalizarTexto(enunciado)).digest('hex').slice(0, 32)
}

/** Para comparar citas: comillas tipográficas unificadas y los cortes de línea con guion unidos, luego normalizarTexto. */
function normalizarCita(t) {
  return normalizarTexto(String(t ?? '')
    .replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'")
    .replace(/-\s*\n\s*/g, ''))
}

const limpio = (t) => (typeof t === 'string' ? t.trim().replace(/\s+/g, ' ') : '')

function contarApariciones(texto, buscado) {
  if (!buscado) return 0
  let n = 0
  for (let i = texto.indexOf(buscado); i !== -1; i = texto.indexOf(buscado, i + buscado.length)) n += 1
  return n
}

/** Oraciones de un texto: los signos de cierre seguidos de espacio o del final. */
const oraciones = (t) => (String(t).trim().match(/[.!?…](?=\s|$)/g) || []).length

// ── Archivos ────────────────────────────────────────────────────────────────

function extensionDe(nombre, url) {
  const de = (t) => {
    const base = String(t || '').split(/[?#]/)[0].split('/').pop() || ''
    const i = base.lastIndexOf('.')
    return i > 0 ? base.slice(i + 1).toLowerCase() : ''
  }
  return de(nombre) || de(url)
}

/**
 * Revisa la lista que manda el navegador: de 1 a 3 archivos { url, nombre }, PDF, DOC o DOCX, subidos a Cloudinary
 * (la única forma en que la pantalla los sube). Lanza HttpsError con el mensaje para el docente; nada se ha cobrado.
 */
function validarArchivos(archivos) {
  const lista = Array.isArray(archivos) ? archivos : []
  if (lista.length < RULETA_IA.MIN_ARCHIVOS || lista.length > RULETA_IA.MAX_ARCHIVOS) {
    throw new HttpsError('invalid-argument', 'Adjunta de 1 a 3 archivos de apoyo (PDF, DOC o DOCX). No se descontaron créditos.')
  }
  return lista.map((a) => {
    const url = typeof a?.url === 'string' ? a.url.trim() : ''
    const nombre = limpio(a?.nombre).slice(0, 200) || 'documento'
    let host
    try { const u = new URL(url); host = u.protocol === 'https:' ? u.hostname : '' } catch { host = '' }
    if (host !== 'res.cloudinary.com') {
      throw new HttpsError('invalid-argument', `No se pudo usar «${nombre}»: vuelve a adjuntarlo. No se descontaron créditos.`)
    }
    const ext = extensionDe(nombre, url)
    if (!RULETA_IA.EXTENSIONES.includes(ext)) {
      throw new HttpsError('invalid-argument', `«${nombre}» no es PDF, DOC ni DOCX. No se descontaron créditos.`)
    }
    return { url, nombre, ext }
  })
}

// Texto de cada página de un PDF, en orden (pdf-parse recorre las páginas una tras otra).
async function paginasPdf(bytes) {
  const pdfParse = require('pdf-parse')
  const paginas = []
  const render = (pageData) => pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    .then((tc) => {
      let ultimoY
      let texto = ''
      for (const item of tc.items) {
        texto += (ultimoY === undefined || ultimoY === item.transform[5]) ? item.str : `\n${item.str}`
        ultimoY = item.transform[5]
      }
      paginas.push(texto)
      return texto
    })
  // Uint8Array y no Buffer: con un Buffer pequeño pdf.js leía bytes de otro documento (ver functions/docExtract.js).
  await pdfParse(new Uint8Array(bytes.slice(0)), { pagerender: render })
  return paginas
}

/** Descarga y lee un archivo. { nombre, ext, paginas: [texto], porPaginas, normalizadas }. Lanza HttpsError. */
async function leerArchivo({ url, nombre, ext }) {
  const falla = (motivo) => new HttpsError('failed-precondition', `${motivo} No se descontaron créditos.`, { archivo: nombre })
  let res
  try { res = await fetch(url) } catch { throw falla(`No se pudo descargar «${nombre}».`) }
  if (!res.ok) throw falla(`No se pudo descargar «${nombre}».`)
  const declarado = Number(res.headers?.get?.('content-length'))
  if (Number.isFinite(declarado) && declarado > RULETA_IA.MAX_BYTES) throw falla(`«${nombre}» pesa más de 15 MB.`)
  const bytes = await res.arrayBuffer()
  if (bytes.byteLength > RULETA_IA.MAX_BYTES) throw falla(`«${nombre}» pesa más de 15 MB.`)

  let paginas
  let visuales = []
  try {
    if (ext === 'pdf') {
      paginas = await paginasPdf(bytes)
      // Páginas que necesitan lectura visual. Si el análisis falla, el PDF se trata como hasta hoy (solo su texto).
      try { visuales = pdfVisual.clasificarPaginas(paginas, await pdfVisual.analizarPaginas(bytes)) } catch { visuales = [] }
    } else if (ext === 'docx') {
      const mammoth = require('mammoth')
      paginas = [(await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value || '']
    } else {
      const WordExtractor = require('word-extractor')
      paginas = [(await new WordExtractor().extract(Buffer.from(bytes))).getBody() || '']
    }
  } catch {
    throw falla(`«${nombre}» está dañado o protegido y no se puede leer.`)
  }
  const caracteres = paginas.reduce((s, p) => s + p.trim().length, 0)
  if (caracteres < RULETA_IA.MIN_CARACTERES_DOCUMENTO && !visuales.length) {
    throw falla(`«${nombre}» no tiene texto que se pueda verificar (por ejemplo, un PDF escaneado o de imágenes). Usa un PDF con texto, un DOC o un DOCX.`)
  }
  const documento = { nombre, ext, paginas, porPaginas: ext === 'pdf', normalizadas: paginas.map(normalizarCita) }
  // Solo los PDF con páginas por leer visualmente cargan sus bytes hasta la generación.
  return visuales.length ? { ...documento, visuales, bytes } : documento
}

/** Tope de páginas con lectura visual para una partida de `n` preguntas. */
const maxPaginasVisuales = (n) => pdfVisual.VISUAL.MAX_PAGINAS[n] || 0
const paginasVisualesDe = (documentos) => documentos.reduce((s, d) => s + (d.visuales?.length || 0), 0)

/**
 * Transcribe las páginas visuales de los documentos (ya con la reserva hecha) y une su texto al del documento:
 * una página 'visual' queda con su transcripción; una 'mixta' conserva su texto y suma lo que dicen sus imágenes.
 * Devuelve { documentos, interno }. Lanza HttpsError si algo falla: el callable reembolsa.
 */
async function leerPaginasVisuales(documentos, { client, modelo, pedirJSON }) {
  const interno = { tokensEntrada: 0, tokensSalida: 0, cacheEscritura: 0, cacheLectura: 0, ms: 0, llamadas: 0, paginas: 0 }
  const listos = []
  for (const d of documentos) {
    if (!d.visuales?.length) { listos.push(d); continue }
    const { textos, interno: i } = await pdfVisual.transcribirPaginas({ bytes: d.bytes, nombre: d.nombre, paginas: d.visuales, client, modelo, pedirJSON })
    for (const k of ['tokensEntrada', 'tokensSalida', 'cacheEscritura', 'cacheLectura', 'ms', 'llamadas']) interno[k] += i[k]
    interno.paginas += d.visuales.length
    const paginas = [...d.paginas]
    for (const { indice, tipo } of d.visuales) {
      const leido = textos.get(indice) || ''
      paginas[indice] = tipo === 'mixta' ? [d.paginas[indice].trim(), leido].filter(Boolean).join('\n') : leido
    }
    if (paginas.reduce((s, p) => s + p.trim().length, 0) < RULETA_IA.MIN_CARACTERES_DOCUMENTO) {
      throw new HttpsError('failed-precondition',
        `En «${d.nombre}» no se encontró texto suficiente, ni siquiera leyendo sus imágenes. Usa un documento más legible. No se descontaron créditos.`,
        { codigo: 'DOCUMENTO_ILEGIBLE', archivo: d.nombre })
    }
    listos.push({
      nombre: d.nombre, ext: d.ext, paginas, porPaginas: true, normalizadas: paginas.map(normalizarCita),
      // Para saber si un sustento salió de la transcripción: el texto que el PDF ya traía, por página.
      normalizadasTexto: d.normalizadas, paginasVisuales: new Set(d.visuales.map((v) => v.indice + 1)),
    })
  }
  const caracteres = listos.reduce((s, d) => s + d.paginas.reduce((t, p) => t + p.length, 0), 0)
  if (caracteres > RULETA_IA.MAX_CARACTERES_TOTALES) {
    throw new HttpsError('failed-precondition',
      'Los documentos son demasiado extensos para generar el banco. Adjunta solo las secciones del tema. No se descontaron créditos.')
  }
  return { documentos: listos, interno }
}

// ── Verificación de un reactivo ─────────────────────────────────────────────

/**
 * Verifica un reactivo propuesto por la IA contra los documentos. `huellas` son las de los reactivos ya aceptados.
 * Devuelve { ok: true, reactivo } o { ok: false, motivo } con los motivos de docs/RULETA_DESTINO.md.
 */
function verificarReactivo(r, documentos, huellas = new Set()) {
  const enunciado = limpio(r?.enunciado)
  const opciones = Array.isArray(r?.opciones) ? r.opciones.map(limpio) : null
  const correcta = r?.correcta
  const formaValida = enunciado && enunciado.length <= RULETA_IA.MAX_ENUNCIADO &&
    opciones && opciones.length === RULETA_IA.OPCIONES && opciones.every((o) => o && o.length <= RULETA_IA.MAX_OPCION) &&
    new Set(opciones.map(normalizarTexto)).size === RULETA_IA.OPCIONES &&
    Number.isInteger(correcta) && correcta >= 0 && correcta < RULETA_IA.OPCIONES
  if (!formaValida) return { ok: false, motivo: 'reactivo_invalido' }

  const huella = huellaEnunciado(enunciado)
  if (huellas.has(huella)) return { ok: false, motivo: 'duplicado' }

  const doc = documentos[Number(r?.documento) - 1]
  if (!doc) return { ok: false, motivo: 'cita_inexistente' }
  const cita = limpio(r?.cita)
  const contexto = limpio(r?.contexto)
  if (!cita || !contexto || cita.length > RULETA_IA.MAX_CITA || contexto.length > RULETA_IA.MAX_CONTEXTO) return { ok: false, motivo: 'cita_no_verificable' }
  const nc = normalizarCita(cita)
  const nx = normalizarCita(contexto)
  if (!nx.includes(nc) || oraciones(contexto) > 2) return { ok: false, motivo: 'cita_no_verificable' }

  let pagina = null
  if (doc.porPaginas) {
    const conContexto = doc.normalizadas.map((t, i) => (t.includes(nx) ? i + 1 : 0)).filter(Boolean)
    if (conContexto.length > 1) return { ok: false, motivo: 'cita_ambigua' }
    if (conContexto.length === 0) {
      // La cita existe pero su contexto no está completo en una sola página (cruza dos o no es literal).
      return { ok: false, motivo: doc.normalizadas.join(' ').includes(nc) ? 'cita_no_verificable' : 'cita_inexistente' }
    }
    pagina = conContexto[0]
  } else {
    const veces = contarApariciones(doc.normalizadas[0], nx)
    if (veces > 1) return { ok: false, motivo: 'cita_ambigua' }
    if (veces === 0) return { ok: false, motivo: doc.normalizadas[0].includes(nc) ? 'cita_no_verificable' : 'cita_inexistente' }
  }
  const sustento = { documento: doc.nombre, pagina, cita, contexto }
  // El contexto no está en el texto que el PDF ya traía: salió de la lectura visual de esa página.
  if (pagina && doc.paginasVisuales?.has(pagina) && !doc.normalizadasTexto[pagina - 1].includes(nx)) sustento.visual = true
  return { ok: true, reactivo: { enunciado, opciones, correcta, huella, sustento } }
}

// ── Precheck (antes de cobrar) ──────────────────────────────────────────────

async function precheckGenerarBancoRuleta({ uid, params }) {
  const db = getFirestore()
  const actividadId = String(params?.actividadId || '')
  if (!idValido(actividadId)) throw new HttpsError('invalid-argument', 'Falta la ruleta. No se descontaron créditos.')
  const actSnap = await db.doc(`activities/${actividadId}`).get()
  if (!actSnap.exists) throw new HttpsError('not-found', 'La ruleta no existe. No se descontaron créditos.')
  const act = actSnap.data()
  if (act.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta ruleta no es tuya.')
  if (act.categoria !== RULETA_IA.CATEGORIA) throw new HttpsError('failed-precondition', 'Esta actividad no es una Ruleta del Destino.')
  const n = act.ruleta?.preguntasPorPartida
  if (!RULETA_IA.PREGUNTAS_POR_PARTIDA.includes(n)) {
    throw new HttpsError('failed-precondition', 'La ruleta no tiene 5 ni 10 preguntas por partida. No se descontaron créditos.')
  }
  // Qué quiere evaluar el docente: se revisa antes que nada que cueste (leer archivos, llamar a la IA, reservar).
  const quiereEvaluar = typeof params?.quiereEvaluar === 'string' ? params.quiereEvaluar.trim() : ''
  if (quiereEvaluar.length < RULETA_IA.MIN_QUIERE_EVALUAR) {
    throw new HttpsError('invalid-argument',
      `Describe con más detalle qué quieres evaluar (mínimo ${RULETA_IA.MIN_QUIERE_EVALUAR} caracteres) para que la IA pueda generar los reactivos. No se descontaron créditos.`,
      { codigo: 'QUIERE_EVALUAR_CORTO' })
  }
  if (quiereEvaluar.length > RULETA_IA.MAX_QUIERE_EVALUAR) {
    throw new HttpsError('invalid-argument',
      `Lo que quieres evaluar puede tener como máximo ${RULETA_IA.MAX_QUIERE_EVALUAR} caracteres. No se descontaron créditos.`,
      { codigo: 'QUIERE_EVALUAR_LARGO' })
  }

  // La IA genera solo con el banco VACÍO (decisión 10): nunca completa ni reemplaza un banco con reactivos.
  const [banco, reactivos] = await Promise.all([
    db.doc(`ruletaBancos/${actividadId}`).get(),
    db.collection('ruletaReactivos').where('actividadId', '==', actividadId).where('docenteId', '==', uid).limit(1).get(),
  ])
  if ((banco.exists && banco.data().total > 0) || !reactivos.empty) {
    throw new HttpsError('failed-precondition',
      'El banco ya tiene reactivos: la IA solo genera con el banco vacío. Complétalo a mano o quita sus reactivos para generarlo con IA. No se descontaron créditos.',
      { codigo: 'BANCO_CON_REACTIVOS' })
  }

  const archivos = validarArchivos(params?.archivos)
  const documentos = []
  for (const a of archivos) documentos.push(await leerArchivo(a))
  // Lectura visual: todas las páginas que la necesitan tienen que caber en el tope; nunca se omite una parte.
  const visuales = paginasVisualesDe(documentos)
  if (visuales > maxPaginasVisuales(n)) {
    throw new HttpsError('failed-precondition',
      `Tus archivos tienen ${visuales} páginas escaneadas o con imágenes que hay que leer, y para una partida de ${n} preguntas el máximo es de ${maxPaginasVisuales(n)}. ` +
      'Adjunta solo las páginas del tema o un documento con texto. No se descontaron créditos.',
      { codigo: 'EXCEDE_PAGINAS_VISUALES', paginas: visuales, maximo: maxPaginasVisuales(n) })
  }
  const caracteres = documentos.reduce((s, d) => s + d.paginas.reduce((t, p) => t + p.length, 0), 0)
  if (caracteres > RULETA_IA.MAX_CARACTERES_TOTALES) {
    throw new HttpsError('failed-precondition',
      'Los documentos son demasiado extensos para generar el banco. Adjunta solo las secciones del tema. No se descontaron créditos.')
  }

  return {
    actividadId,
    n,
    cantidad: reactivosExactos(n),
    nombre: String(act.nombre || '').slice(0, 120),
    tema: String(act.tema || '').slice(0, 500),
    quiereEvaluar,
    documentos,
    // Se cobra 1 unidad por pregunta de la partida (5 o 10 créditos con la tarifa 1): ni el cliente la baja.
    unidadesMinimas: n,
  }
}

// ── Generación ──────────────────────────────────────────────────────────────

const SISTEMA =
  'Eres el asistente pedagógico de Evalúa Fácil y preparas el banco de reactivos de «La Ruleta del Destino», una ' +
  'actividad de bachillerato mexicano en la que cada estudiante contesta preguntas de opción múltiple que salen al azar. ' +
  'Generas reactivos ÚNICAMENTE a partir de los documentos de apoyo del docente: nada que no esté en ellos. El docente ' +
  'indica qué quiere evaluar y ese es el criterio principal: TODOS los reactivos evalúan ese contenido; no preguntes otras ' +
  'partes de los documentos que no tengan que ver con él. Cada reactivo ' +
  'tiene 4 opciones, una sola correcta y 3 distractores plausibles del mismo tema; sin preguntas repetidas ni paráfrasis ' +
  'de otra. Cada reactivo trae su sustento: "cita" es un fragmento copiado LITERALMENTE del documento que demuestra la ' +
  'respuesta correcta, y "contexto" son una o dos oraciones contiguas copiadas literalmente del documento que contienen ' +
  'la cita, dentro de una sola página. Respondes únicamente con el JSON válido del esquema indicado, sin texto adicional.'

function bloqueDocumentos(documentos) {
  return 'DOCUMENTOS DE APOYO DEL DOCENTE (única fuente permitida):\n\n' + documentos.map((d, i) => {
    const cuerpo = d.porPaginas
      ? d.paginas.map((p, j) => `[Página ${j + 1}]\n${p.trim()}`).join('\n\n')
      : d.paginas[0].trim()
    return `=== DOCUMENTO ${i + 1}: «${d.nombre}» (${d.ext.toUpperCase()}) ===\n${cuerpo}`
  }).join('\n\n')
}

function promptLote(ctx, pedir, yaGenerados) {
  return (
    `Ruleta: «${ctx.nombre || 'La Ruleta del Destino'}». Tema general de la ruleta: ${ctx.tema || 'el de los documentos'}.\n` +
    `\nQUÉ QUIERE EVALUAR EL DOCENTE (criterio principal: TODOS los reactivos deben evaluar este contenido):\n"""${ctx.quiereEvaluar}"""\n\n` +
    `Genera EXACTAMENTE ${pedir} reactivos nuevos de opción múltiple, en español, que evalúen lo que pide el docente y estén sustentados en los documentos.\n` +
    (yaGenerados.length
      ? `Ya existen estos enunciados: NO los repitas ni los parafrasees; pregunta otras ideas de los documentos.\n${yaGenerados.map((e) => `- ${e}`).join('\n')}\n`
      : '') +
    `Reglas: enunciado de máximo ${RULETA_IA.MAX_ENUNCIADO} caracteres; exactamente 4 opciones distintas de máximo ${RULETA_IA.MAX_OPCION} caracteres; ` +
    '"correcta" es el índice (0 a 3) de la opción correcta; "documento" es el número del documento; "pagina" es el número ' +
    'de página del PDF donde está el contexto (null en DOC o DOCX); "cita" y "contexto" se copian tal cual del documento.\n' +
    'Responde SOLO con este JSON:\n' +
    '{ "reactivos": [ { "enunciado": "<pregunta>", "opciones": ["<A>", "<B>", "<C>", "<D>"], "correcta": 0, ' +
    '"documento": 1, "pagina": 1, "cita": "<fragmento literal>", "contexto": "<1 o 2 oraciones literales que contienen la cita>" } ] }'
  )
}

async function ejecutarGenerarBancoRuleta({ params, modelo, apiKey, pedirJSON }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const ctx = params.__contexto // lo puso el precheck; el cliente no puede tocarlo
  const uid = params.__uid
  const objetivo = ctx.cantidad
  // Primero se leen las páginas escaneadas o con imágenes; desde aquí todo trabaja con el texto ya unido.
  const lectura = await leerPaginasVisuales(ctx.documentos, { client, modelo, pedirJSON })
  const documentos = lectura.documentos
  const prefijo = [{ type: 'text', text: bloqueDocumentos(documentos) }]

  const aceptados = []
  const huellas = new Set()
  const rechazos = {}
  const interno = { modelo, tokensEntrada: 0, tokensSalida: 0, cacheEscritura: 0, cacheLectura: 0, ms: 0, llamadas: 0 }
  for (const k of ['tokensEntrada', 'tokensSalida', 'cacheEscritura', 'cacheLectura', 'ms']) interno[k] += lectura.interno[k]
  const maxLlamadas = Math.ceil(objetivo / RULETA_IA.LOTE) + RULETA_IA.LLAMADAS_EXTRA

  while (aceptados.length < objetivo && interno.llamadas < maxLlamadas) {
    const pedir = Math.min(RULETA_IA.LOTE, objetivo - aceptados.length) + RULETA_IA.MARGEN
    const { datos, interno: i } = await pedirJSON({
      client, modelo, system: SISTEMA, maxTokens: Math.min(16000, 320 * pedir + 600),
      prompt: promptLote(ctx, pedir, aceptados.map((a) => a.enunciado)),
      bloquesPrefijo: prefijo,
    })
    interno.llamadas += 1
    for (const k of ['tokensEntrada', 'tokensSalida', 'cacheEscritura', 'cacheLectura', 'ms']) interno[k] += Number(i?.[k]) || 0
    for (const r of Array.isArray(datos?.reactivos) ? datos.reactivos : []) {
      if (aceptados.length >= objetivo) break
      const v = verificarReactivo(r, documentos, huellas)
      if (!v.ok) { rechazos[v.motivo] = (rechazos[v.motivo] || 0) + 1; continue }
      huellas.add(v.reactivo.huella)
      aceptados.push(v.reactivo)
    }
  }

  // Sin la cantidad exacta no se guarda nada (nunca un banco parcial): el callable reembolsa la reserva.
  if (aceptados.length < objetivo) {
    throw new HttpsError('failed-precondition',
      `Los documentos no alcanzaron para generar ${objetivo} reactivos verificables (se lograron ${aceptados.length}). ` +
      'Adjunta más material del tema o captura el banco a mano. No se descontaron créditos.',
      { codigo: 'DOCUMENTO_INSUFICIENTE', logrados: aceptados.length, objetivo, rechazos })
  }

  const db = getFirestore()
  const bancoRef = db.doc(`ruletaBancos/${ctx.actividadId}`)
  const resultado = await escribirSiActividadExiste(ctx.actividadId, async (tx, actSnap) => {
    const act = actSnap.data()
    // Lo que dio el precheck tiene que seguir siendo cierto en el momento de escribir.
    if (act.docenteId !== uid || act.categoria !== RULETA_IA.CATEGORIA || act.ruleta?.preguntasPorPartida !== ctx.n) {
      throw new HttpsError('failed-precondition', 'La ruleta cambió mientras se generaba el banco. Vuelve a intentarlo. No se descontaron créditos.')
    }
    const banco = await tx.get(bancoRef)
    if (banco.exists && banco.data().total > 0) {
      throw new HttpsError('failed-precondition',
        'Mientras se generaba, el banco recibió reactivos: no se reemplazan. No se descontaron créditos.', { codigo: 'BANCO_CON_REACTIVOS' })
    }
    const huellasBanco = {}
    for (const r of aceptados) {
      const id = `${ctx.actividadId}_${crypto.randomBytes(8).toString('hex')}`
      huellasBanco[r.huella] = id
      tx.create(db.doc(`ruletaReactivos/${id}`), {
        docenteId: uid, actividadId: ctx.actividadId,
        enunciado: r.enunciado, opciones: r.opciones, correcta: r.correcta, huella: r.huella,
        sustento: r.sustento, creadoEn: FieldValue.serverTimestamp(),
      })
    }
    // Misma forma que guarda api/_lib/ruletaBanco.js (datosBanco), con origen 'ia' y sin aprobar.
    tx.set(bancoRef, {
      docenteId: uid, actividadId: ctx.actividadId, origen: 'ia', total: aceptados.length, huellas: huellasBanco,
      aprobado: false, aprobadoEn: null, version: ((banco.exists && banco.data().version) || 0) + 1,
      actualizadoEn: FieldValue.serverTimestamp(),
    })
    return true
  })
  if (!resultado) throw new HttpsError('not-found', 'La ruleta ya no existe: se eliminó mientras la IA trabajaba. No se descontaron créditos.')

  return {
    resultado: { actividadId: ctx.actividadId, total: aceptados.length, rechazados: rechazos },
    unidadesReales: ctx.n, // 1 por pregunta de la partida: 5 o 10 créditos
    interno: {
      ...interno, reactivos: aceptados.length, rechazados: Object.values(rechazos).reduce((s, x) => s + x, 0),
      ...(lectura.interno.paginas && { paginasVisuales: lectura.interno.paginas, llamadasTranscripcion: lectura.interno.llamadas }),
    },
  }
}

module.exports = {
  RULETA_IA,
  precheckGenerarBancoRuleta,
  ejecutarGenerarBancoRuleta,
  _pruebas: { normalizarTexto, normalizarCita, huellaEnunciado, verificarReactivo, validarArchivos, leerArchivo, extensionDe, oraciones, leerPaginasVisuales, maxPaginasVisuales },
}
