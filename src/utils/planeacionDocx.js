// Genera el .docx de la Planeación Didáctica Inicial DESDE CERO — decisión
// de Kike, 16-ago-2026: la Planeación es una estructura propia de Evalúa
// Fácil, nunca depende de una plantilla externa. Su estructura visual
// reproduce EXACTAMENTE el formato de referencia que Kike proporcionó
// (Planeacion_Didactica_Universal.docx, analizado el 16-ago-2026): página
// carta apaisada, mismas tablas, mismos anchos de columna, mismos colores.
// La única diferencia estructural es que la cantidad de Secuencias
// Didácticas es dinámica (el Word de referencia es un ejemplo con 2).

// ── Estructura de datos (mismo orden y claves en functions/ia.js — se
// duplica aquí a propósito: son runtimes distintos sin módulo compartido en
// este proyecto) ────────────────────────────────────────────────────────
export const CAMPOS_IDENTIFICACION = [
  { clave: 'plantel', etiqueta: 'Plantel' },
  { clave: 'cct', etiqueta: 'Clave del centro de trabajo' },
  { clave: 'carrera', etiqueta: 'Programa educativo / Carrera' },
  { clave: 'modulo', etiqueta: 'Módulo / Submódulo o Asignatura' },
  { clave: 'docente', etiqueta: 'Docente' },
  { clave: 'semestre', etiqueta: 'Semestre' },
  { clave: 'grupo', etiqueta: 'Grupo(s)' },
  { clave: 'periodo', etiqueta: 'Periodo escolar' },
  { clave: 'horasTotales', etiqueta: 'Horas totales de la asignatura' },
  { clave: 'horasSemana', etiqueta: 'Horas por semana' },
  { clave: 'competencias', etiqueta: 'Competencias profesionales / genéricas' },
]

// Campos de identidad de CADA Secuencia Didáctica (una tabla de 2 columnas
// por Secuencia, aparte de sus 3 momentos).
export const CAMPOS_IDENTIDAD_SECUENCIA = [
  { clave: 'nombre', etiqueta: 'Nombre o tema' },
  { clave: 'aprendizajesEsperados', etiqueta: 'Aprendizajes esperados' },
  { clave: 'proposito', etiqueta: 'Propósito' },
  { clave: 'sesiones', etiqueta: 'Sesiones que abarca' },
  { clave: 'contenidosRelacionados', etiqueta: 'Contenidos relacionados' },
]

// Apertura, Desarrollo y Cierre cada uno con su PROPIO juego completo (no
// uno compartido por Secuencia) — así es el Word de referencia.
export const MOMENTOS = [
  { clave: 'apertura', etiqueta: 'APERTURA' },
  { clave: 'desarrollo', etiqueta: 'DESARROLLO' },
  { clave: 'cierre', etiqueta: 'CIERRE' },
]
export const CAMPOS_MOMENTO = [
  { clave: 'actividades', etiqueta: 'ACTIVIDADES DE ENSEÑANZA - APRENDIZAJE' },
  { clave: 'recursos', etiqueta: 'RECURSOS Y MATERIALES' },
  { clave: 'estrategiaEvaluacion', etiqueta: 'ESTRATEGIA DE EVALUACIÓN' },
  { clave: 'evidencias', etiqueta: 'EVIDENCIAS' },
  { clave: 'tipoInstrumento', etiqueta: 'TIPO DE EVALUACIÓN / INSTRUMENTO' },
  { clave: 'ponderacion', etiqueta: 'PONDERACIÓN (%)' },
]

async function cargarPizZip() {
  return (await import('pizzip')).default
}

function escaparXml(texto) {
  return String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Colores y anchos EXACTOS del Word de referencia (16-ago-2026) ───────
const AZUL_MARINO = '011649' // encabezados de tabla completos (identificación, identidad de secuencia... es decir el nivel más alto)
const AZUL = '0967F0'        // encabezado "SECUENCIA DIDÁCTICA N" y "APERTURA/DESARROLLO/CIERRE"
const TURQUESA = '1CD3BB'    // sub-encabezados "EVIDENCIAS / TIPO / PONDERACIÓN"
const CELDA_ETIQUETA = 'DCEBFC' // fondo de las celdas de etiqueta (columna izquierda)

const ANCHO_IDENTIFICACION = [2200, 5000, 2200, 5000]
const ANCHO_IDENTIDAD_SECUENCIA = [3200, 11200]
const ANCHO_MOMENTO = [5040, 5760, 3600]
const ANCHO_BIBLIOGRAFIA = [700, 13700]

function runTexto(texto, { negrita, color, sz, blanco } = {}) {
  const props = []
  if (negrita) props.push('<w:b/>')
  if (blanco) props.push('<w:color w:val="FFFFFF"/>')
  else if (color) props.push(`<w:color w:val="${color}"/>`)
  if (sz) props.push(`<w:sz w:val="${sz}"/>`)
  props.push('<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>')
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''
  const lineas = String(texto || '').split('\n')
  return lineas.map((linea, i) => (
    (i > 0 ? '<w:br/>' : '') + `<w:t xml:space="preserve">${escaparXml(linea)}</w:t>`
  )).map((t) => `<w:r>${rPr}${t}</w:r>`).join('')
}

function parrafo(contenidoXml, propsParrafo = '') {
  return `<w:p>${propsParrafo}${contenidoXml}</w:p>`
}

function parrafoTitulo(texto) {
  return parrafo(runTexto(texto, { negrita: true, sz: 32 }), '<w:pPr><w:spacing w:after="200"/></w:pPr>')
}

// Cada fila de tabla trae `cantSplit` — nunca se corta una fila a la mitad
// entre dos páginas, pero la tabla SÍ puede seguir en la página siguiente
// entre una fila y otra (regla de paginación de Kike, 16-ago-2026: nunca
// forzar una Secuencia completa a cambiar de página, pero tampoco partir
// una fila).
function celda(anchoTwips, contenidoXml, { fill, spanCols } = {}) {
  const span = spanCols > 1 ? `<w:gridSpan w:val="${spanCols}"/>` : ''
  const sombra = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''
  return `<w:tc><w:tcPr><w:tcW w:w="${anchoTwips}" w:type="dxa"/>${span}${sombra}<w:vAlign w:val="center"/></w:tcPr>${contenidoXml}</w:tc>`
}

function filaTr(contenidoXml) {
  return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${contenidoXml}</w:tr>`
}

// Fila de encabezado que ocupa TODO el ancho de la tabla (una sola celda
// con gridSpan = número de columnas) — el patrón de "DATOS DE
// IDENTIFICACIÓN INSTITUCIONAL" / "SECUENCIA DIDÁCTICA N" / "APERTURA".
function filaEncabezadoCompleto(anchos, texto, fill) {
  const anchoTotal = anchos.reduce((a, b) => a + b, 0)
  const p = parrafo(runTexto(texto, { negrita: true, blanco: true }))
  return filaTr(celda(anchoTotal, p, { fill, spanCols: anchos.length }))
}

// Fila etiqueta (fondo CELDA_ETIQUETA, negritas) | valor (editable, texto
// normal) — el patrón de casi todas las filas de datos del Word.
function filaEtiquetaValor(anchoEtiqueta, anchoValor, etiqueta, valor) {
  const pEtiqueta = parrafo(runTexto(etiqueta, { negrita: true, sz: 17 }))
  const pValor = parrafo(runTexto(valor || ' ', { sz: 17 }))
  return filaTr(celda(anchoEtiqueta, pEtiqueta, { fill: CELDA_ETIQUETA }) + celda(anchoValor, pValor, {}))
}

// ── Tabla "DATOS DE IDENTIFICACIÓN INSTITUCIONAL" — 4 columnas, pares
// etiqueta|valor, la última fila (Competencias) con el valor ocupando las
// 3 columnas restantes.
function tablaIdentificacion(datos) {
  const [c0, c1, c2, c3] = ANCHO_IDENTIFICACION
  const pares = []
  for (let i = 0; i < CAMPOS_IDENTIFICACION.length - 1; i += 2) {
    const a = CAMPOS_IDENTIFICACION[i]
    const b = CAMPOS_IDENTIFICACION[i + 1]
    pares.push(filaTr(
      celda(c0, parrafo(runTexto(a.etiqueta, { negrita: true, sz: 17 })), { fill: CELDA_ETIQUETA }) +
      celda(c1, parrafo(runTexto(datos?.[a.clave] || ' ', { sz: 17 })), {}) +
      celda(c2, parrafo(runTexto(b.etiqueta, { negrita: true, sz: 17 })), { fill: CELDA_ETIQUETA }) +
      celda(c3, parrafo(runTexto(datos?.[b.clave] || ' ', { sz: 17 })), {})
    ))
  }
  const competencias = CAMPOS_IDENTIFICACION[CAMPOS_IDENTIFICACION.length - 1]
  const filaCompetencias = filaTr(
    celda(c0, parrafo(runTexto(competencias.etiqueta, { negrita: true, sz: 17 })), { fill: CELDA_ETIQUETA }) +
    celda(c1 + c2 + c3, parrafo(runTexto(datos?.[competencias.clave] || ' ', { sz: 17 })), { spanCols: 3 })
  )
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${ANCHO_IDENTIFICACION.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${TABLA_BORDES}<w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${ANCHO_IDENTIFICACION.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    filaEncabezadoCompleto(ANCHO_IDENTIFICACION, 'DATOS DE IDENTIFICACIÓN INSTITUCIONAL', AZUL_MARINO) +
    pares.join('') + filaCompetencias +
    '</w:tbl>'
  )
}

// ── Tabla de identidad de UNA Secuencia Didáctica — 2 columnas, encabezado
// "SECUENCIA DIDÁCTICA N", luego 5 filas etiqueta|valor.
function tablaIdentidadSecuencia(secuencia, numero) {
  const [c0, c1] = ANCHO_IDENTIDAD_SECUENCIA
  const filas = CAMPOS_IDENTIDAD_SECUENCIA.map(({ clave, etiqueta }) => (
    filaEtiquetaValor(c0, c1, etiqueta, secuencia?.[clave])
  ))
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${c0 + c1}" w:type="dxa"/>${TABLA_BORDES}<w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${ANCHO_IDENTIDAD_SECUENCIA.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    filaEncabezadoCompleto(ANCHO_IDENTIDAD_SECUENCIA, `SECUENCIA DIDÁCTICA ${numero}`, AZUL) +
    filas.join('') +
    '</w:tbl>'
  )
}

// ── Tabla de UN momento (Apertura/Desarrollo/Cierre) — 3 columnas:
// fila0 encabezado del momento (azul, 3 cols)
// fila1 "ACTIVIDADES..." (span 2, navy) | "RECURSOS..." (navy)
// fila2 contenido actividades (span 2) | contenido recursos
// fila3 "ESTRATEGIA DE EVALUACIÓN" (span 3, navy)
// fila4 contenido estrategia (span 3)
// fila5 "EVIDENCIAS" | "TIPO..." | "PONDERACIÓN (%)" (turquesa, 3 celdas)
// fila6 contenido evidencias | contenido tipo | contenido ponderación
function tablaMomento(momentoEtiqueta, datos) {
  const [c0, c1, c2] = ANCHO_MOMENTO
  const anchoTotal = c0 + c1 + c2
  const camposPorClave = Object.fromEntries(CAMPOS_MOMENTO.map((c) => [c.clave, c]))
  const val = (clave) => datos?.[clave] || ' '

  const filaSub1 = filaTr(
    celda(c0 + c1, parrafo(runTexto(camposPorClave.actividades.etiqueta, { negrita: true, blanco: true, sz: 16 })), { fill: AZUL_MARINO, spanCols: 2 }) +
    celda(c2, parrafo(runTexto(camposPorClave.recursos.etiqueta, { negrita: true, blanco: true, sz: 16 })), { fill: AZUL_MARINO })
  )
  const filaContenido1 = filaTr(
    celda(c0 + c1, parrafo(runTexto(val('actividades'), { sz: 17 })), { spanCols: 2 }) +
    celda(c2, parrafo(runTexto(val('recursos'), { sz: 17 })), {})
  )
  const filaSub2 = filaEncabezadoCompleto(ANCHO_MOMENTO, camposPorClave.estrategiaEvaluacion.etiqueta, AZUL_MARINO)
  const filaContenido2 = filaTr(celda(anchoTotal, parrafo(runTexto(val('estrategiaEvaluacion'), { sz: 17 })), { spanCols: 3 }))
  const filaSub3 = filaTr(
    celda(c0, parrafo(runTexto(camposPorClave.evidencias.etiqueta, { negrita: true, blanco: true, sz: 16 })), { fill: TURQUESA }) +
    celda(c1, parrafo(runTexto(camposPorClave.tipoInstrumento.etiqueta, { negrita: true, blanco: true, sz: 16 })), { fill: TURQUESA }) +
    celda(c2, parrafo(runTexto(camposPorClave.ponderacion.etiqueta, { negrita: true, blanco: true, sz: 16 })), { fill: TURQUESA })
  )
  const filaContenido3 = filaTr(
    celda(c0, parrafo(runTexto(val('evidencias'), { sz: 17 })), {}) +
    celda(c1, parrafo(runTexto(val('tipoInstrumento'), { sz: 17 })), {}) +
    celda(c2, parrafo(runTexto(val('ponderacion'), { sz: 17 })), {})
  )

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${anchoTotal}" w:type="dxa"/>${TABLA_BORDES}<w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${ANCHO_MOMENTO.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    filaEncabezadoCompleto(ANCHO_MOMENTO, momentoEtiqueta, AZUL) +
    filaSub1 + filaContenido1 + filaSub2 + filaContenido2 + filaSub3 + filaContenido3 +
    '</w:tbl>'
  )
}

// ── Tabla "FUENTES DE INFORMACIÓN / BIBLIOGRAFÍA" — 2 columnas, 5 filas
// numeradas.
function tablaBibliografia(fuentes) {
  const [c0, c1] = ANCHO_BIBLIOGRAFIA
  const filas = Array.from({ length: 5 }, (_, i) => filaTr(
    celda(c0, parrafo(runTexto(String(i + 1), { negrita: true, sz: 17 })), { fill: CELDA_ETIQUETA }) +
    celda(c1, parrafo(runTexto(fuentes?.[i], { sz: 17 })), {})
  ))
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${c0 + c1}" w:type="dxa"/>${TABLA_BORDES}<w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${ANCHO_BIBLIOGRAFIA.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    filaEncabezadoCompleto(ANCHO_BIBLIOGRAFIA, 'FUENTES DE INFORMACIÓN / BIBLIOGRAFÍA', AZUL_MARINO) +
    filas.join('') +
    '</w:tbl>'
  )
}

function parrafoVacio() {
  return '<w:p/>'
}

const TABLA_BORDES =
  '<w:tblBorders>' +
  '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '</w:tblBorders>'

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>'

const RELS_RAIZ =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>'

// Página carta apaisada, márgenes de 0.5" — EXACTO al Word de referencia.
const SECT_PR =
  '<w:sectPr>' +
  '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>' +
  '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="708" w:footer="708" w:gutter="0"/>' +
  '</w:sectPr>'

// `datosIdentificacion`: {plantel, cct, carrera, modulo, docente, semestre,
// grupo, periodo, horasTotales, horasSemana, competencias}.
// `secuencias`: array de {nombre, aprendizajesEsperados, proposito,
// sesiones, contenidosRelacionados, apertura, desarrollo, cierre} — cada
// momento un objeto con {actividades, recursos, estrategiaEvaluacion,
// evidencias, tipoInstrumento, ponderacion}.
// `fuentesInformacion`: array de hasta 5 strings.
export async function construirDocumentoPlaneacion(datosIdentificacion, secuencias, fuentesInformacion, titulo) {
  const PizZip = await cargarPizZip()
  const zip = new PizZip()

  const cuerpo = [parrafoTitulo(titulo || 'Planeación Didáctica Inicial')]
  cuerpo.push(tablaIdentificacion(datosIdentificacion))
  cuerpo.push(parrafoVacio())
  secuencias.forEach((s) => {
    if (cuerpo.length > 2) cuerpo.push(parrafoVacio())
    cuerpo.push(tablaIdentidadSecuencia(s, secuencias.indexOf(s) + 1))
    for (const { clave, etiqueta } of MOMENTOS) {
      cuerpo.push(parrafoVacio())
      cuerpo.push(tablaMomento(etiqueta, s[clave]))
    }
  })
  cuerpo.push(parrafoVacio())
  cuerpo.push(tablaBibliografia(fuentesInformacion))

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${cuerpo.join('')}${SECT_PR}</w:body>` +
    '</w:document>'

  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', RELS_RAIZ)
  zip.file('word/document.xml', documentXml)

  const buffer = zip.generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  return buffer
}
