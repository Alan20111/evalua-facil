// Genera el .docx de la Planeación Didáctica Inicial DESDE CERO — decisión
// de Kike, 16-ago-2026: la Planeación es una estructura propia de Evalúa
// Fácil (secuenciasDidacticas[]), nunca depende de una plantilla externa.
// Pedido de Kike (16-ago-2026, tras dos vueltas): la edición debe sentirse
// como editar el documento Word REAL — se genera un .docx con una tabla
// (etiqueta | contenido) por Secuencia, igual que un formato de planeación
// típico, se renderiza con docx-preview, y se edita directo sobre esas
// celdas (ver activarEdicionSecuencias en PlaneacionInicialSection.jsx).
//
// Como el documento lo genera la propia app (nunca una plantilla subida por
// el docente), la posición de cada celda es 100% predecible: una tabla por
// Secuencia, en el MISMO orden que `secuencias`, con una fila por campo de
// CAMPOS_SECUENCIA en ese mismo orden — no hace falta ningún mecanismo de
// verificación de mapeo (el que sí hacía falta antes de hoy, cuando el
// documento podía ser cualquier plantilla ajena).

// Mismo orden y etiquetas que CAMPOS_SECUENCIA en functions/ia.js — se
// duplica aquí (cliente) a propósito: son runtimes distintos (navegador vs.
// Cloud Function) sin un módulo compartido entre ambos en este proyecto.
export const CAMPOS_SECUENCIA = [
  { clave: 'nombre', etiqueta: 'Secuencia Didáctica — nombre o tema' },
  { clave: 'aprendizajesEsperados', etiqueta: 'Aprendizajes esperados' },
  { clave: 'proposito', etiqueta: 'Propósito' },
  { clave: 'sesiones', etiqueta: 'Sesiones que abarca' },
  { clave: 'apertura', etiqueta: 'Apertura' },
  { clave: 'desarrollo', etiqueta: 'Desarrollo' },
  { clave: 'cierre', etiqueta: 'Cierre' },
  { clave: 'evidencia', etiqueta: 'Evidencia de aprendizaje' },
  { clave: 'estrategiaEvaluacion', etiqueta: 'Estrategia de evaluación' },
  { clave: 'instrumento', etiqueta: 'Instrumento de evaluación' },
  { clave: 'recursos', etiqueta: 'Recursos y materiales' },
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

// Un párrafo con runs alternando texto/salto de línea real (<w:br/>) por
// cada "\n" — mismo criterio que ya se usaba para las viñetas de sesión
// (Kike, 15-ago-2026: un "\n" suelto dentro de <w:t> Word lo ignora).
function runsConSaltos(texto, negrita) {
  const props = negrita ? '<w:rPr><w:b/></w:rPr>' : ''
  const lineas = String(texto || '').split('\n')
  return lineas.map((linea, i) => (
    (i > 0 ? '<w:br/>' : '') + `<w:t xml:space="preserve">${escaparXml(linea)}</w:t>`
  )).map((t) => `<w:r>${props}${t}</w:r>`).join('')
}

function parrafo(contenidoXml, propsParrafo = '') {
  return `<w:p>${propsParrafo}${contenidoXml}</w:p>`
}

function parrafoTitulo(texto) {
  return parrafo(
    `<w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r>`,
    '<w:pPr><w:spacing w:after="200"/></w:pPr>'
  )
}

// Bordes finos en las 4 direcciones + entre celdas — el look de "formato de
// planeación" que se espera de una tabla real, no de texto corrido.
const TABLA_BORDES =
  '<w:tblBorders>' +
  '<w:top w:val="single" w:sz="4" w:color="999999"/>' +
  '<w:left w:val="single" w:sz="4" w:color="999999"/>' +
  '<w:bottom w:val="single" w:sz="4" w:color="999999"/>' +
  '<w:right w:val="single" w:sz="4" w:color="999999"/>' +
  '<w:insideH w:val="single" w:sz="4" w:color="999999"/>' +
  '<w:insideV w:val="single" w:sz="4" w:color="999999"/>' +
  '</w:tblBorders>'

// Ancho de página tipo carta con márgenes normales, en twips (1440/pulgada).
const ANCHO_TABLA = 9350
const ANCHO_ETIQUETA = 2500
const ANCHO_VALOR = ANCHO_TABLA - ANCHO_ETIQUETA

function celda(anchoTwips, contenidoXml, sombreado) {
  const sombra = sombreado ? '<w:shd w:val="clear" w:fill="F2F2F2"/>' : ''
  return `<w:tc><w:tcPr><w:tcW w:w="${anchoTwips}" w:type="dxa"/>${sombra}<w:vAlign w:val="top"/></w:tcPr>${contenidoXml}</w:tc>`
}

// Una fila etiqueta | valor — la celda de VALOR es la que se vuelve
// editable en pantalla (ver activarEdicionSecuencias).
function filaCampo(etiqueta, valor) {
  const pEtiqueta = parrafo(`<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escaparXml(etiqueta)}</w:t></w:r>`)
  const pValor = parrafo(runsConSaltos(valor, false) || '<w:r><w:t xml:space="preserve"> </w:t></w:r>')
  return `<w:tr>${celda(ANCHO_ETIQUETA, pEtiqueta, true)}${celda(ANCHO_VALOR, pValor, false)}</w:tr>`
}

// Una tabla completa — una Secuencia Didáctica, una fila por cada campo de
// CAMPOS_SECUENCIA en ESE orden exacto (incluyendo "nombre", como primera
// fila) — el orden es lo que permite mapear cada celda de vuelta a su
// campo sin ambigüedad.
function tablaSecuencia(secuencia) {
  const filas = CAMPOS_SECUENCIA.map(({ clave, etiqueta }) => filaCampo(etiqueta, secuencia[clave]))
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${ANCHO_TABLA}" w:type="dxa"/>${TABLA_BORDES}<w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${ANCHO_ETIQUETA}"/><w:gridCol w:w="${ANCHO_VALOR}"/></w:tblGrid>` +
    filas.join('') +
    '</w:tbl>'
  )
}

// Párrafo vacío — separación visual entre la tabla de una Secuencia y la
// etiqueta/tabla de la siguiente (mismo criterio que ya se usaba antes de
// hoy: nunca pegar dos Secuencias sin espacio).
function parrafoVacio() {
  return '<w:p/>'
}

function parrafoEtiquetaSecuencia(numero) {
  return parrafo(
    `<w:r><w:rPr><w:b/><w:sz w:val="22"/><w:color w:val="1F5FBF"/></w:rPr><w:t xml:space="preserve">SECUENCIA DIDÁCTICA ${numero}</w:t></w:r>`,
    '<w:pPr><w:spacing w:before="120" w:after="80"/></w:pPr>'
  )
}

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

// `secuencias`: array de {nombre, aprendizajesEsperados, proposito, sesiones,
// apertura, desarrollo, cierre, evidencia, estrategiaEvaluacion, instrumento,
// recursos} — mismos campos que CAMPOS_SECUENCIA. `titulo`: encabezado del
// documento, p. ej. "Planeación Didáctica Inicial — Parcial 1".
export async function construirDocumentoPlaneacion(secuencias, titulo) {
  const PizZip = await cargarPizZip()
  const zip = new PizZip()

  const cuerpo = [parrafoTitulo(titulo || 'Planeación Didáctica Inicial')]
  secuencias.forEach((s, i) => {
    if (i > 0) cuerpo.push(parrafoVacio())
    cuerpo.push(parrafoEtiquetaSecuencia(i + 1))
    cuerpo.push(tablaSecuencia(s))
  })
  cuerpo.push(parrafoVacio())

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${cuerpo.join('')}<w:sectPr/></w:body>` +
    '</w:document>'

  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', RELS_RAIZ)
  zip.file('word/document.xml', documentXml)

  const buffer = zip.generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  return buffer
}
