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

// Celdas combinadas (Kike, 15-ago-2026: "es el problema más común" en
// formatos reales de escuela) — ExcelJS expone los rangos fusionados como
// strings tipo "B2:D2" en `hoja.model.merges`, sin relación directa con
// cada celda. Se traduce una sola vez por hoja a dos estructuras:
// `master` (celda ancla → cuántas columnas/filas ocupa, para el colSpan
// visual) y `slave` (el resto de celdas del rango, que se omiten de la
// cuadrícula — ya están cubiertas por el colSpan de su ancla).
function colLetraANumero(letras) {
  return letras.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0)
}

function excelMergesInfo(hoja) {
  const master = new Map()
  const slave = new Set()
  for (const rango of hoja.model?.merges || []) {
    const [ini, fin] = rango.split(':')
    const pIni = ini.match(/^([A-Z]+)(\d+)$/)
    const pFin = fin.match(/^([A-Z]+)(\d+)$/)
    if (!pIni || !pFin) continue
    const c1 = colLetraANumero(pIni[1]), f1 = parseInt(pIni[2], 10)
    const c2 = colLetraANumero(pFin[1]), f2 = parseInt(pFin[2], 10)
    master.set(`${f1}_${c1}`, { colSpan: c2 - c1 + 1 })
    for (let f = f1; f <= f2; f++) {
      for (let c = c1; c <= c2; c++) {
        if (f === f1 && c === c1) continue
        slave.add(`${f}_${c}`)
      }
    }
  }
  return { master, slave }
}

// ── Excel ────────────────────────────────────────────────────────────────
// Lee la primera hoja como cuadrícula de texto — esto es lo que la IA ve
// para entender la estructura de la plantilla y decidir qué llenar. Las
// celdas cubiertas por una combinada se omiten (la ancla ya trae su
// colSpan) para no repetir la misma celda varias veces en la cuadrícula.
export async function leerCuadriculaExcel(arrayBuffer) {
  const ExcelJS = await cargarExcelJS()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  const hoja = wb.worksheets[0]
  if (!hoja) throw new Error('El archivo no tiene ninguna hoja')
  const { master, slave } = excelMergesInfo(hoja)
  const filas = []
  const maxFila = Math.min(hoja.rowCount, 200)
  const maxCol = Math.min(hoja.columnCount, 60)
  for (let f = 1; f <= maxFila; f++) {
    const fila = []
    for (let c = 1; c <= maxCol; c++) {
      const clave = `${f}_${c}`
      if (slave.has(clave)) continue
      const celda = hoja.getRow(f).getCell(c)
      fila.push({ texto: celda.text || '', fila: f, columna: c, colSpan: master.get(clave)?.colSpan || 1 })
    }
    filas.push(fila)
  }
  return { hojaNombre: hoja.name, filas }
}

// Abre el archivo ORIGINAL (sin modificar) y escribe cada celda que la IA
// decidió llenar — conserva formato, logo y todo lo demás intacto, porque
// solo se tocan esas celdas. Si la celda de destino es parte de un rango
// combinado, ExcelJS solo acepta el valor en la celda ancla (`.master`) —
// escribir en cualquier otra del rango se pierde o revienta, así que
// siempre se apunta a la ancla.
export async function llenarPlantillaExcel(arrayBuffer, celdas) {
  const ExcelJS = await cargarExcelJS()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  const hoja = wb.worksheets[0]
  for (const c of celdas) {
    if (!c.texto) continue
    const celda = hoja.getRow(c.fila).getCell(c.columna)
    const destino = celda.master || celda
    destino.value = c.texto
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

// Celdas combinadas horizontalmente en Word (Kike, 15-ago-2026: "es el
// problema más común"): una celda con <w:gridSpan w:val="N"/> ocupa N
// columnas de la cuadrícula, pero en el XML sigue siendo UN SOLO <w:tc> —
// si se numeran las columnas por posición en el array (como antes), una
// fila con una celda combinada tiene menos <w:tc> que una fila sin
// combinar, y la columna 3 de una fila deja de ser la columna 3 de otra.
// Se lee/escribe por COLUMNA LÓGICA (arrastrando el span acumulado) en vez
// de por índice crudo, para que la misma columna lógica siempre sea la
// misma columna real sin importar qué filas tengan celdas combinadas.
function gridSpanDe(tc) {
  const tcPr = tc.getElementsByTagNameNS(W_NS, 'tcPr')[0]
  if (!tcPr) return 1
  const el = tcPr.getElementsByTagNameNS(W_NS, 'gridSpan')[0]
  if (!el) return 1
  const val = parseInt(el.getAttribute('w:val'), 10)
  return val > 0 ? val : 1
}

// Celdas combinadas VERTICALMENTE en Word (encontrado 15-ago-2026, plantilla
// SEP de Kike: 3 casos rompían el mapeo de la Vista previa editable): la
// celda de arriba trae <w:vMerge w:val="restart"/> (o simplemente no trae
// vMerge, si nunca se combina); las de abajo traen <w:vMerge/> SIN val, que
// por especificación OOXML significa "continúa la de arriba" — siguen
// siendo un <w:tc> real en el XML, con texto vacío casi siempre, pero
// Word/docx-preview NO las dibuja como celda propia (usan rowSpan en la de
// arriba) — si se cuentan aquí como si fueran una celda normal, las demás
// celdas de esa fila quedan una columna corridas respecto a como se ve/
// renderiza de verdad.
function esVMergeContinuacion(tc) {
  const tcPr = tc.getElementsByTagNameNS(W_NS, 'tcPr')[0]
  if (!tcPr) return false
  const vMerge = tcPr.getElementsByTagNameNS(W_NS, 'vMerge')[0]
  if (!vMerge) return false
  const val = vMerge.getAttribute('w:val')
  return !val || val === 'continue'
}

// Recorre document.xml y devuelve cada <w:tbl> como cuadrícula de texto —
// mismo propósito que leerCuadriculaExcel pero para tablas de Word. Las
// celdas que son continuación de una combinada verticalmente se saltan (no
// son una celda real que se pueda llenar) pero SÍ avanzan la columna
// lógica, para que las celdas reales de esa fila queden en la posición que
// de verdad ocupan.
export async function leerTablasWord(arrayBuffer) {
  const PizZip = await cargarPizZip()
  const zip = new PizZip(arrayBuffer)
  const xml = zip.file('word/document.xml').asText()
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const tablas = Array.from(doc.getElementsByTagNameNS(W_NS, 'tbl')).map((tbl, tablaIndex) => {
    const filas = Array.from(tbl.getElementsByTagNameNS(W_NS, 'tr')).map((tr, fila) => {
      let columnaLogica = 0
      const entradas = []
      for (const tc of celdasDeFila(tr)) {
        const span = gridSpanDe(tc)
        if (!esVMergeContinuacion(tc)) {
          entradas.push({ texto: textoDeCelda(tc), fila, columna: columnaLogica, colSpan: span, tablaIndex })
        }
        columnaLogica += span
      }
      return entradas
    })
    return { filas }
  })
  return tablas
}

// Busca, dentro de una fila, el <w:tc> cuyo rango de columnas lógicas
// (arrastrando gridSpan, saltando continuaciones de vMerge) cubre la
// columna pedida — reemplaza el acceso directo por índice, que se
// desalineaba en cuanto una fila tenía una celda combinada.
function celdaEnColumnaLogica(tr, columnaObjetivo) {
  let columnaLogica = 0
  for (const tc of celdasDeFila(tr)) {
    const span = gridSpanDe(tc)
    if (!esVMergeContinuacion(tc) && columnaObjetivo >= columnaLogica && columnaObjetivo < columnaLogica + span) return tc
    columnaLogica += span
  }
  return null
}

// Escribe texto en una celda de tabla de Word — reemplaza su contenido de
// texto sin tocar el resto del documento (logo, formato, otras celdas).
function escribirEnCelda(doc, tablaIndex, filaIdx, columnaLogica, texto) {
  const tbl = doc.getElementsByTagNameNS(W_NS, 'tbl')[tablaIndex]
  if (!tbl) return false
  const tr = tbl.getElementsByTagNameNS(W_NS, 'tr')[filaIdx]
  if (!tr) return false
  const tc = celdaEnColumnaLogica(tr, columnaLogica)
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
