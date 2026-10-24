// Archivos de prueba REALES para la clasificación por contenido de «Calificar
// con IA» (oct-2026): PDF de texto, escaneados, con fotografía o logotipo, en
// blanco o dañados, y Word con texto, fotografía o icono. Se generan aquí
// mismo (jspdf, jszip, zlib), sin red ni archivos de estudiantes.
import zlib from 'node:zlib'
import { jsPDF } from 'jspdf'
import JSZip from 'jszip'

// ── PNG de color sólido de w×h px ──────────────────────────────────────────
const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function trozo(tipo, datos) {
  const largo = Buffer.alloc(4)
  largo.writeUInt32BE(datos.length)
  const td = Buffer.concat([Buffer.from(tipo, 'latin1'), datos])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([largo, td, crc])
}
export function png(w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // 8 bits
  ihdr[9] = 2 // RGB
  const fila = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x80)])
  const crudo = Buffer.concat(Array.from({ length: h }, () => fila))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(crudo)), trozo('IEND', Buffer.alloc(0)),
  ])
}

const LOREM = 'La practica consistio en instalar la impresora, configurar el controlador y verificar la impresion de prueba. '
export const textoDe = (n) => LOREM.repeat(Math.ceil(n / LOREM.length)).slice(0, n)

// ── PDF ────────────────────────────────────────────────────────────────────
// `caracteresPorPagina`: texto real en cada página; `imagen`: [w, h] px de una
// imagen incrustada en cada página; `lineas`: trazos vectoriales (un dibujo).
export function pdf({ paginas = 1, caracteresPorPagina = 0, imagen = null, lineas = 0 } = {}) {
  const d = new jsPDF()
  for (let p = 0; p < paginas; p++) {
    if (p) d.addPage()
    if (imagen) d.addImage(new Uint8Array(png(imagen[0], imagen[1])), 'PNG', 10, 10, 60, (60 * imagen[1]) / imagen[0])
    if (caracteresPorPagina) d.setFontSize(8).text(d.splitTextToSize(textoDe(caracteresPorPagina), 180), 10, imagen ? 100 : 10)
    for (let i = 0; i < lineas; i++) d.line(10, 120 + i * 3, 200, 122 + i * 3)
  }
  return Buffer.from(d.output('arraybuffer'))
}
export const pdfDanado = () => Buffer.from('%PDF-1.4\n%esto no es un PDF valido\n' + 'x'.repeat(5000))

// ── Word (.docx) ───────────────────────────────────────────────────────────
// `imagen`: [w, h] px de una imagen insertada (PNG).
export async function docx({ texto = '', imagen = null } = {}) {
  const z = new JSZip()
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const dibujo = imagen
    ? '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="2000000" cy="2000000"/><wp:docPr id="1" name="Imagen 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="foto.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
    : ''
  const parrafo = texto ? `<w:p><w:r><w:t>${texto}</w:t></w:r></w:p>` : ''
  z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + parrafo + dibujo + '</w:body></w:document>')
  if (imagen) {
    z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>')
    z.file('word/media/image1.png', png(imagen[0], imagen[1]))
  }
  return z.generateAsync({ type: 'nodebuffer' })
}
