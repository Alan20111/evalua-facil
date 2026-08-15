// Plantilla oficial de la escuela para la Planeación Didáctica Inicial: el
// docente sube el formato REAL de su plantel (Word o Excel, vacío, con su
// logo) y la IA decide sola qué casillas llenar y con qué — sin que el
// docente tenga que marcar nada a mano. Ver PlantillaOficialSection.jsx
// (subida) y PlaneacionInicialSection.jsx (generación).
//
// Cómo funciona: se lee la plantilla completa como cuadrícula de texto
// (leerCuadriculaExcel / leerTablasWord) y esa cuadrícula se manda tal cual
// a la IA junto con el contexto pedagógico — la IA ve los encabezados
// ("Semana", "Tema", "Actividad"...) y decide qué celdas están vacías y
// deben llenarse, y devuelve una lista de {fila, columna, texto} (o
// {tablaIndex, fila, columna, texto} en Word) que se escribe DIRECTO en el
// archivo original — logo, formato y todo lo demás quedan intactos porque
// solo se tocan esas celdas.
//
// Word no tiene "celdas" fuera de una tabla — solo se puede escribir dentro
// de una tabla (la inmensa mayoría de formatos institucionales de
// planeación son tablas); texto suelto del documento no se toca.

// Las librerías son pesadas y solo las usa este apartado — se cargan
// dinámicamente (mismo patrón que excel.js/planeacionExcel.js con
// ExcelJS) para no engordar el bundle principal de la asignatura, que se
// carga para TODOS los docentes aunque la mayoría no use plantilla oficial.
async function cargarExcelJS() {
  return (await import('exceljs')).default
}
async function cargarPizZip() {
  return (await import('pizzip')).default
}

export const TIPOS_PLANTILLA = { xlsx: 'xlsx', docx: 'docx' }

export function tipoDePlantilla(nombreArchivo) {
  const ext = (nombreArchivo || '').split('.').pop().toLowerCase()
  if (ext === 'xlsx' || ext === 'xls') return TIPOS_PLANTILLA.xlsx
  if (ext === 'docx' || ext === 'doc') return TIPOS_PLANTILLA.docx
  return null
}

// ── Excel ────────────────────────────────────────────────────────────────
// Lee la primera hoja como cuadrícula de texto — esto es lo que la IA ve
// para entender la estructura de la plantilla y decidir qué llenar.
export async function leerCuadriculaExcel(arrayBuffer) {
  const ExcelJS = await cargarExcelJS()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  const hoja = wb.worksheets[0]
  if (!hoja) throw new Error('El archivo no tiene ninguna hoja')
  const filas = []
  const maxFila = Math.min(hoja.rowCount, 200)
  const maxCol = Math.min(hoja.columnCount, 60)
  for (let f = 1; f <= maxFila; f++) {
    const fila = []
    for (let c = 1; c <= maxCol; c++) {
      const celda = hoja.getRow(f).getCell(c)
      fila.push({ texto: celda.text || '', fila: f, columna: c })
    }
    filas.push(fila)
  }
  return { hojaNombre: hoja.name, filas }
}

// Abre el archivo ORIGINAL (sin modificar) y escribe cada celda que la IA
// decidió llenar — conserva formato, logo y todo lo demás intacto, porque
// solo se tocan esas celdas.
export async function llenarPlantillaExcel(arrayBuffer, celdas) {
  const ExcelJS = await cargarExcelJS()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  const hoja = wb.worksheets[0]
  for (const c of celdas) {
    if (!c.texto) continue
    hoja.getRow(c.fila).getCell(c.columna).value = c.texto
  }
  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// ── Word ─────────────────────────────────────────────────────────────────
// Namespace de WordprocessingML — todas las etiquetas de tabla/fila/celda/
// texto de un .docx viven ahí.
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function textoDeCelda(tc) {
  return Array.from(tc.getElementsByTagNameNS(W_NS, 't'))
    .map((t) => t.textContent)
    .join('')
}

function celdasDeFila(tr) {
  // Las celdas son hijas directas de <w:tr> (evita contar tablas anidadas).
  return Array.from(tr.childNodes).filter(
    (n) => n.nodeType === 1 && n.localName === 'tc' && n.namespaceURI === W_NS
  )
}

// Recorre document.xml y devuelve cada <w:tbl> como cuadrícula de texto —
// mismo propósito que leerCuadriculaExcel pero para tablas de Word.
export async function leerTablasWord(arrayBuffer) {
  const PizZip = await cargarPizZip()
  const zip = new PizZip(arrayBuffer)
  const xml = zip.file('word/document.xml').asText()
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const tablas = Array.from(doc.getElementsByTagNameNS(W_NS, 'tbl')).map((tbl, tablaIndex) => {
    const filas = Array.from(tbl.getElementsByTagNameNS(W_NS, 'tr')).map((tr, fila) =>
      celdasDeFila(tr).map((tc, columna) => ({ texto: textoDeCelda(tc), fila, columna, tablaIndex }))
    )
    return { filas }
  })
  return tablas
}

// Escribe texto en una celda de tabla de Word — reemplaza su contenido de
// texto sin tocar el resto del documento (logo, formato, otras celdas).
function escribirEnCelda(doc, tablaIndex, filaIdx, columnaIdx, texto) {
  const tbl = doc.getElementsByTagNameNS(W_NS, 'tbl')[tablaIndex]
  if (!tbl) return false
  const tr = tbl.getElementsByTagNameNS(W_NS, 'tr')[filaIdx]
  if (!tr) return false
  const tc = celdasDeFila(tr)[columnaIdx]
  if (!tc) return false

  const runs = tc.getElementsByTagNameNS(W_NS, 't')
  if (runs.length > 0) {
    // Se limpian los demás <w:t> de la celda (si el texto original estaba
    // repartido en varios runs) y se deja el texto nuevo en el primero.
    runs[0].textContent = texto
    for (let i = 1; i < runs.length; i++) runs[i].textContent = ''
  } else {
    // Celda vacía: se arma un <w:p><w:r><w:t> mínimo con el texto.
    const p = doc.createElementNS(W_NS, 'w:p')
    const r = doc.createElementNS(W_NS, 'w:r')
    const t = doc.createElementNS(W_NS, 'w:t')
    t.textContent = texto
    r.appendChild(t)
    p.appendChild(r)
    tc.appendChild(p)
  }
  return true
}

// Abre el archivo ORIGINAL y escribe cada celda que la IA decidió llenar —
// una sola pasada, sin etiquetas intermedias.
export async function llenarPlantillaWord(arrayBuffer, celdas) {
  const PizZip = await cargarPizZip()
  const zip = new PizZip(arrayBuffer)
  const xml = zip.file('word/document.xml').asText()
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  for (const c of celdas) {
    if (!c.texto) continue
    escribirEnCelda(doc, c.tablaIndex, c.fila, c.columna, c.texto)
  }
  const xmlFinal = new XMLSerializer().serializeToString(doc)
  zip.file('word/document.xml', xmlFinal)
  const buffer = zip.generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  return buffer
}

// Aplana la cuadrícula (Excel: una tabla implícita; Word: varias <w:tbl>) a
// una lista compacta — lo que de verdad se manda a la IA como estructura de
// la plantilla, y lo que ella devuelve para llenar.
export function aplanarCuadricula(tablas) {
  return tablas.flatMap((t) => t.filas.flat())
}
