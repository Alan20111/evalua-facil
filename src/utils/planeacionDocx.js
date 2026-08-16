// Genera el .docx de la Planeación Didáctica Inicial DESDE CERO — decisión
// de Kike, 16-ago-2026: la Planeación es una estructura propia de Evalúa
// Fácil (secuenciasDidacticas[]), el Word es solo su representación
// descargable, nunca la fuente de la verdad ni algo que haya que "llenar".
// No depende de ninguna plantilla externa ni de una plantilla bundleada:
// arma el paquete OOXML mínimo (Content_Types + _rels + document.xml) con
// PizZip, el mismo mecanismo de bajo nivel que ya se usaba para escribir
// celdas de Word antes de hoy.

// Mismo orden y etiquetas que CAMPOS_SECUENCIA en functions/ia.js — se
// duplica aquí (cliente) a propósito: son runtimes distintos (navegador vs.
// Cloud Function) sin un módulo compartido entre ambos en este proyecto.
export const CAMPOS_SECUENCIA = [
  { clave: 'nombre', etiqueta: 'Nombre o tema' },
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
  return String(texto || '').split('\n').map((linea, i) => (
    (i > 0 ? '<w:br/>' : '') + `<w:t xml:space="preserve">${escaparXml(linea)}</w:t>`
  )).map((t) => `<w:r>${props}${t}</w:r>`).join('')
}

function parrafo(contenidoXml, propsParrafo = '') {
  return `<w:p>${propsParrafo}${contenidoXml}</w:p>`
}

function parrafoTitulo(texto) {
  return parrafo(
    `<w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r>`
  )
}

function parrafoEncabezadoSecuencia(texto) {
  return parrafo(
    `<w:r><w:rPr><w:b/><w:sz w:val="26"/></w:rPr><w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r>`,
    '<w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>'
  )
}

function parrafoCampo(etiqueta, valor) {
  if (!String(valor || '').trim()) return ''
  const runEtiqueta = `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escaparXml(etiqueta)}: </w:t></w:r>`
  return parrafo(runEtiqueta + runsConSaltos(valor, false), '<w:pPr><w:spacing w:after="80"/></w:pPr>')
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
// recursos} — mismos campos que CAMPOS_SECUENCIA, en cualquier orden de
// llaves (se recorren con CAMPOS_SECUENCIA, no con Object.keys). `titulo`:
// encabezado del documento, p. ej. "Planeación Didáctica Inicial — Parcial 1".
export async function construirDocumentoPlaneacion(secuencias, titulo) {
  const PizZip = await cargarPizZip()
  const zip = new PizZip()

  const cuerpo = [parrafoTitulo(titulo || 'Planeación Didáctica Inicial')]
  secuencias.forEach((s, i) => {
    cuerpo.push(parrafoEncabezadoSecuencia(`Secuencia Didáctica ${i + 1}${s.nombre ? ` — ${s.nombre}` : ''}`))
    for (const { clave, etiqueta } of CAMPOS_SECUENCIA) {
      if (clave === 'nombre') continue // ya va en el encabezado de arriba
      cuerpo.push(parrafoCampo(etiqueta, s[clave]))
    }
  })

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
