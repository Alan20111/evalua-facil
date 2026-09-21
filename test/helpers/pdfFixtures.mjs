// Documentos de prueba para la lectura de fuentes de IA (17-sep-2026).
//
// Se fabrican al vuelo con jspdf (ya es dependencia del cliente) en vez de
// guardar binarios en el repo, y cubren las cuatro formas en que llega un PDF
// real: con capa de texto, con el contenido dentro de imágenes (escaneo,
// infografía), mixto, y en blanco. Más un Word mínimo.
//
// `servirDocumentos` reemplaza `fetch` SOLO para las URLs de fixtures —todo lo
// demás (el emulador, por ejemplo) pasa de largo al fetch de verdad—, igual
// que `pincharCloudinary` en entorno.mjs: el código bajo prueba descarga el
// documento exactamente como en producción, sin salir a la red.

import zlib from 'node:zlib'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { jsPDF } = require('jspdf')
const JSZip = require('jszip')

export const BASE_FIXTURES = 'https://res.cloudinary.com/demo-fixtures/image/upload/v1/fuentes-ia/'
export const urlFixture = (nombre) => BASE_FIXTURES + nombre

const PARRAFO =
  'La celula es la unidad basica de la vida. Todas las celulas provienen de otras celulas y ' +
  'contienen material genetico. La membrana plasmatica regula el paso de sustancias. '

// PNG RGB real hecho a mano (firma + IHDR + IDAT + IEND): jspdf lo incrusta
// como imagen, igual que un escaneo o una infografía exportada.
function crc32(buf) {
  let crc = 0xffffffff
  for (const b of buf) {
    let c = (crc ^ b) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunkPng(tipo, data) {
  const largo = Buffer.alloc(4)
  largo.writeUInt32BE(data.length)
  const cuerpo = Buffer.concat([Buffer.from(tipo), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(cuerpo))
  return Buffer.concat([largo, cuerpo, crc])
}
function png(ancho = 40, alto = 30) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(ancho, 0)
  ihdr.writeUInt32BE(alto, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const crudo = Buffer.alloc((ancho * 3 + 1) * alto)
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) crudo[y * (ancho * 3 + 1) + 1 + x * 3] = (x * 37) & 255
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunkPng('IHDR', ihdr), chunkPng('IDAT', zlib.deflateSync(crudo)), chunkPng('IEND', Buffer.alloc(0)),
  ])
}

function paginas(n, dibujar) {
  const doc = new jsPDF()
  for (let i = 0; i < n; i++) {
    if (i) doc.addPage()
    dibujar(doc, i)
  }
  return doc.output('arraybuffer')
}

/** PDF con capa de texto suficiente en cada página (>200 caracteres). */
export const pdfTexto = (n = 1, texto = PARRAFO) =>
  paginas(n, (doc, i) => doc.text(doc.splitTextToSize(`Tema ${i + 1}. ${texto.repeat(3)}`, 170), 20, 20))

/** PDF cuyo contenido está SOLO en imágenes (escaneo / infografía). */
export const pdfImagen = (n = 1) => paginas(n, (doc) => doc.addImage(png(), 'PNG', 10, 10, 190, 140))

/** PDF mixto: un encabezado de texto suelto sobre una imagen. */
export const pdfMixto = (n = 1) => paginas(n, (doc, i) => {
  doc.text(`Pagina ${i + 1}`, 20, 15)
  doc.addImage(png(), 'PNG', 10, 25, 190, 140)
})

/** PDF sin texto ni imágenes pero con dibujo vectorial (diagrama, texto en curvas). */
export const pdfVectorial = (n = 1) => paginas(n, (doc) => {
  doc.setFillColor(0, 0, 255)
  doc.rect(20, 40, 80, 50, 'F')
})

/** PDF realmente en blanco. */
export const pdfEnBlanco = (n = 1) => paginas(n, () => {})

/** Word (.docx) mínimo válido con un solo párrafo de texto. */
export async function docxTexto(texto) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>')
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>')
  zip.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    `<w:p><w:r><w:t>${texto}</w:t></w:r></w:p></w:body></w:document>`)
  const u8 = await zip.generateAsync({ type: 'uint8array' })
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
}

/**
 * Sirve `{ nombreArchivo: ArrayBuffer }` en BASE_FIXTURES. Devuelve la función
 * que restaura el fetch anterior. Un nombre que no está en el mapa responde
 * 404, como Cloudinary.
 */
export function servirDocumentos(mapa) {
  const anterior = globalThis.fetch
  globalThis.fetch = async (url, opciones) => {
    const u = String(url)
    if (!u.startsWith(BASE_FIXTURES)) return anterior(url, opciones)
    const bytes = mapa[u.slice(BASE_FIXTURES.length)]
    if (!bytes) return new Response('no existe', { status: 404 })
    return new Response(new Uint8Array(bytes.slice(0)), { status: 200 })
  }
  return () => { globalThis.fetch = anterior }
}
