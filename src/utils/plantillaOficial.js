// Plantilla oficial de la escuela para la Planeación Didáctica Inicial: el
// docente sube el formato REAL de su plantel (Word o Excel, vacío, con su
// logo), marca en pantalla qué casilla corresponde a qué dato, y la IA
// llena esa plantilla en el mismo formato — en vez de generar un Excel
// genérico. Ver PlantillaOficialSection.jsx para la UI de mapeo.
//
// Word no tiene "celdas" como Excel; solo se pueden marcar casillas DENTRO
// de una tabla (la inmensa mayoría de formatos institucionales de
// planeación son tablas). Al marcar una celda de Word se le inyecta una
// etiqueta {campoN} en su texto (docxtemplater la reemplaza después) —
// el archivo con etiquetas se guarda aparte, nunca se le muestra al
// docente ni se sube como "su" plantilla.
// Las tres librerías son pesadas y solo las usa este apartado — se cargan
// dinámicamente (mismo patrón que excel.js/planeacionExcel.js con
// ExcelJS) para no engordar el bundle principal de la asignatura, que se
// carga para TODOS los docentes aunque la mayoría no use plantilla oficial.
async function cargarExcelJS() {
  return (await import('exceljs')).default
}
async function cargarPizZip() {
  return (await import('pizzip')).default
}
async function cargarDocxtemplater() {
  return (await import('docxtemplater')).default
}

export const TIPOS_PLANTILLA = { xlsx: 'xlsx', docx: 'docx' }

export function tipoDePlantilla(nombreArchivo) {
  const ext = (nombreArchivo || '').split('.').pop().toLowerCase()
  if (ext === 'xlsx' || ext === 'xls') return TIPOS_PLANTILLA.xlsx
  if (ext === 'docx' || ext === 'doc') return TIPOS_PLANTILLA.docx
  return null
}

// ── Excel ────────────────────────────────────────────────────────────────
// Lee la primera hoja y la devuelve como cuadrícula de texto — para
// dibujarla en pantalla y que el docente haga clic en una celda.
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

// Abre el archivo ORIGINAL (sin modificar) y escribe cada dato generado en
// la celda que el docente marcó — conserva formato, logo y todo lo demás
// intacto, porque solo se tocan las celdas mapeadas.
export async function llenarPlantillaExcel(arrayBuffer, mapeo, datosPorCampo) {
  const ExcelJS = await cargarExcelJS()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  const hoja = wb.worksheets[0]
  for (const m of mapeo) {
    const valor = datosPorCampo[m.campo]
    if (valor == null) continue
    hoja.getRow(m.fila).getCell(m.columna).value = valor
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

// Recorre document.xml y devuelve cada <w:tbl> como cuadrícula de texto —
// mismo propósito que leerCuadriculaExcel pero para tablas de Word. La
// mayoría de formatos institucionales de planeación SON una tabla; texto
// fuera de tablas no se puede marcar (no hay una "celda" que etiquetar).
export async function leerTablasWord(arrayBuffer) {
  const PizZip = await cargarPizZip()
  const zip = new PizZip(arrayBuffer)
  const xml = zip.file('word/document.xml').asText()
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const tablas = Array.from(doc.getElementsByTagNameNS(W_NS, 'tbl')).map((tbl, tablaIndex) => {
    const filas = Array.from(tbl.getElementsByTagNameNS(W_NS, 'tr')).map((tr, fila) => {
      // Las celdas son hijas directas de <w:tr> (evita contar tablas anidadas).
      const celdas = Array.from(tr.childNodes).filter(
        (n) => n.nodeType === 1 && n.localName === 'tc' && n.namespaceURI === W_NS
      )
      return celdas.map((tc, columna) => ({ texto: textoDeCelda(tc), fila, columna, tablaIndex }))
    })
    return { filas }
  })
  return tablas
}

// Devuelve un nuevo ArrayBuffer con la etiqueta {campoKey} escrita en el
// primer <w:t> de la celda indicada (o insertado si la celda no tenía
// texto) — el resto del documento (logo, formato, otras celdas) queda
// intacto. Se llama una vez por cada casilla que el docente marca.
export async function marcarCeldaWord(arrayBuffer, tablaIndex, filaIdx, columnaIdx, campoKey) {
  const PizZip = await cargarPizZip()
  const zip = new PizZip(arrayBuffer)
  const xml = zip.file('word/document.xml').asText()
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const tbl = doc.getElementsByTagNameNS(W_NS, 'tbl')[tablaIndex]
  if (!tbl) throw new Error('No se encontró la tabla')
  const tr = tbl.getElementsByTagNameNS(W_NS, 'tr')[filaIdx]
  if (!tr) throw new Error('No se encontró la fila')
  const celdas = Array.from(tr.childNodes).filter(
    (n) => n.nodeType === 1 && n.localName === 'tc' && n.namespaceURI === W_NS
  )
  const tc = celdas[columnaIdx]
  if (!tc) throw new Error('No se encontró la celda')

  const runs = tc.getElementsByTagNameNS(W_NS, 't')
  const etiqueta = `{${campoKey}}`
  if (runs.length > 0) {
    // Se limpian los demás <w:t> de la celda (si el texto original estaba
    // repartido en varios runs) y se deja la etiqueta en el primero.
    runs[0].textContent = etiqueta
    for (let i = 1; i < runs.length; i++) runs[i].textContent = ''
  } else {
    // Celda vacía: se arma un <w:p><w:r><w:t> mínimo con la etiqueta.
    const p = doc.createElementNS(W_NS, 'w:p')
    const r = doc.createElementNS(W_NS, 'w:r')
    const t = doc.createElementNS(W_NS, 'w:t')
    t.textContent = etiqueta
    r.appendChild(t)
    p.appendChild(r)
    tc.appendChild(p)
  }

  const xmlFinal = new XMLSerializer().serializeToString(doc)
  zip.file('word/document.xml', xmlFinal)
  return zip.generate({ type: 'arraybuffer' })
}

// Llena el archivo YA ETIQUETADO (con {campoKey} en cada celda marcada) con
// los datos generados — docxtemplater reemplaza cada etiqueta por su valor
// y conserva absolutamente todo el resto del documento.
export async function llenarPlantillaWordEtiquetada(arrayBufferEtiquetado, datosPorCampoKey) {
  const [PizZip, Docxtemplater] = await Promise.all([cargarPizZip(), cargarDocxtemplater()])
  const zip = new PizZip(arrayBufferEtiquetado)
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })
  doc.render(datosPorCampoKey)
  const buffer = doc.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  return buffer
}
