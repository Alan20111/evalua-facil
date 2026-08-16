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

  const normales = celdas.filter((c) => !Array.isArray(c.texto))
  const conSecuencias = celdas.filter((c) => Array.isArray(c.texto) && c.texto.length)

  // Celdas normales primero, con los números de fila ORIGINALES — antes de
  // duplicar ninguna fila (mismo motivo que en Word, ver llenarPlantillaWord).
  for (const c of normales) {
    if (!c.texto) continue
    const celda = hoja.getRow(c.fila).getCell(c.columna)
    const destino = celda.master || celda
    destino.value = c.texto
  }

  // Apertura/Desarrollo/Cierre con varias Secuencias Didácticas: igual que
  // en Word (ver llenarPlantillaWord/duplicarBloqueWord), NO basta con
  // duplicar cada fila por separado — si Apertura, Desarrollo y Cierre son
  // filas distintas de la hoja, duplicar cada una por su cuenta deja el
  // documento leyéndose "Apertura [todo] / Desarrollo [todo] / Cierre
  // [todo]" en vez de una sección completa por secuencia. Se duplica el
  // BLOQUE de filas [inicio..fin] como una unidad, con una etiqueta
  // "SECUENCIA DIDÁCTICA N" antes de cada copia.
  if (conSecuencias.length) {
    const filas = conSecuencias.map((c) => c.fila)
    const filaInicio = Math.min(...filas)
    const filaFin = Math.max(...filas)
    const alto = filaFin - filaInicio + 1
    const total = Math.max(...conSecuencias.map((c) => c.texto.length))
    // Espacio en blanco OBLIGATORIO entre el Cierre/evaluación de una
    // Secuencia Didáctica y el encabezado de la siguiente (Kike, 16-ago-
    // 2026: "nunca debe pegar dos secuencias consecutivas sin espacio de
    // separación") — 2 filas vacías antes de cada etiqueta, incluida la
    // primera.
    const ESPACIO = 2
    const inicioBloque = [] // fila real donde empieza el contenido de cada secuencia, en orden

    hoja.spliceRows(filaInicio, 0, ...Array(ESPACIO).fill([]))
    const etiqueta1 = filaInicio + ESPACIO
    hoja.spliceRows(etiqueta1, 0, [])
    hoja.getRow(etiqueta1).getCell(1).value = 'SECUENCIA DIDÁCTICA 1'
    hoja.getRow(etiqueta1).getCell(1).font = { bold: true }
    inicioBloque.push(etiqueta1 + 1) // el bloque original (contenido real) sigue justo después
    let cursor = etiqueta1 + alto // última fila del bloque original tras los corrimientos

    for (let v = 1; v < total; v++) {
      hoja.spliceRows(cursor + 1, 0, ...Array(ESPACIO).fill([]))
      const filaEtiqueta = cursor + ESPACIO + 1
      hoja.spliceRows(filaEtiqueta, 0, [])
      hoja.getRow(filaEtiqueta).getCell(1).value = `SECUENCIA DIDÁCTICA ${v + 1}`
      hoja.getRow(filaEtiqueta).getCell(1).font = { bold: true }

      hoja.spliceRows(filaEtiqueta + 1, 0, ...Array(alto).fill([]))
      const filaContenido = filaEtiqueta + 1
      inicioBloque.push(filaContenido)
      for (let f = 0; f < alto; f++) {
        const origen = hoja.getRow(inicioBloque[0] + f) // siempre copia desde el primer bloque real
        const destino = hoja.getRow(filaContenido + f)
        destino.values = origen.values
        destino.height = origen.height
        origen.eachCell({ includeEmpty: true }, (celda, colNum) => {
          destino.getCell(colNum).style = celda.style
        })
      }
      cursor = filaContenido + alto - 1
    }

    for (let i = 0; i < total; i++) {
      const filaDestino = inicioBloque[i]
      for (const c of conSecuencias) {
        const texto = c.texto[i]
        if (!texto) continue
        const offset = c.fila - filaInicio
        const celda = hoja.getRow(filaDestino + offset).getCell(c.columna)
        const destino = celda.master || celda
        destino.value = texto
      }
    }
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

  // Texto con varios renglones (p. ej. una viñeta por Sesión) necesita
  // <w:br/> reales entre líneas — un "\n" suelto dentro de <w:t> lo ignora
  // Word y todo sale corrido en una sola línea (Kike lo detectó en
  // producción, 15-ago-2026: "usa una viñeta por cada Sesión"). Se arma UN
  // <w:r> con <w:t>/<w:br/> alternados por cada línea.
  const lineas = texto.split('\n')
  const runNuevo = doc.createElementNS(W_NS, 'w:r')
  lineas.forEach((linea, i) => {
    if (i > 0) runNuevo.appendChild(doc.createElementNS(W_NS, 'w:br'))
    const t = doc.createElementNS(W_NS, 'w:t')
    t.setAttribute('xml:space', 'preserve')
    t.textContent = linea
    runNuevo.appendChild(t)
  })

  const primerRun = tc.getElementsByTagNameNS(W_NS, 'r')[0]
  if (primerRun) {
    // Se reemplaza el primer <w:r> (conserva su <w:rPr> de formato si lo
    // copiamos) y se limpian los <w:t> de los demás runs de la celda para
    // no dejar texto viejo repetido.
    const rPr = primerRun.getElementsByTagNameNS(W_NS, 'rPr')[0]
    if (rPr) runNuevo.insertBefore(rPr.cloneNode(true), runNuevo.firstChild)
    primerRun.parentNode.replaceChild(runNuevo, primerRun)
    const runsRestantes = tc.getElementsByTagNameNS(W_NS, 't')
    for (let i = 0; i < runsRestantes.length; i++) {
      if (!runNuevo.contains(runsRestantes[i])) runsRestantes[i].textContent = ''
    }
  } else {
    // Celda vacía: se arma un <w:p><w:r> mínimo con el texto.
    const p = doc.createElementNS(W_NS, 'w:p')
    p.appendChild(runNuevo)
    tc.appendChild(p)
  }
  return true
}

// Párrafo con un solo run en negritas — se usa como etiqueta visible antes
// de cada bloque clonado (ver duplicarBloqueWord), para que el documento se
// lea "SECUENCIA DIDÁCTICA 1 / Apertura / Desarrollo / Cierre, SECUENCIA
// DIDÁCTICA 2 / ..." y no una lista ambigua de bloques repetidos sin nombre.
function parrafoEtiquetaWord(doc, texto) {
  const p = doc.createElementNS(W_NS, 'w:p')
  const r = doc.createElementNS(W_NS, 'w:r')
  const rPr = doc.createElementNS(W_NS, 'w:rPr')
  rPr.appendChild(doc.createElementNS(W_NS, 'w:b'))
  r.appendChild(rPr)
  const t = doc.createElementNS(W_NS, 'w:t')
  t.textContent = texto
  r.appendChild(t)
  p.appendChild(r)
  return p
}

// Párrafo vacío — separación visual OBLIGATORIA entre el Cierre/evaluación
// de una Secuencia Didáctica y el encabezado de la siguiente (Kike,
// 16-ago-2026: "nunca debe pegar dos secuencias consecutivas sin espacio de
// separación"). Dos párrafos vacíos dan un espacio claramente visible sin
// depender de estilos que la plantilla del docente podría no traer.
function parrafoVacioWord(doc) {
  return doc.createElementNS(W_NS, 'w:p')
}

// Clona el BLOQUE COMPLETO de tablas [inicioTablaIdx..finTablaIdx] (todos
// los nodos hermanos entre la primera y la última tabla, inclusive)
// `veces - 1` veces más, insertando las copias en secuencia — y antepone a
// cada copia (y al bloque original) una etiqueta "SECUENCIA DIDÁCTICA N".
//
// Por qué un bloque de TABLAS y no solo una fila (corrección de Kike,
// 16-ago-2026, tras revisar el documento real generado): en la plantilla
// simple, Apertura, Desarrollo y Cierre NO son tres celdas de una misma
// tabla — son TRES TABLAS SEPARADAS y consecutivas en el documento
// ("APERTURA" tabla 3, "DESARROLLO" tabla 4, "CIERRE" tabla 5, cada una con
// su propio encabezado y su fila de evidencias/evaluación). Duplicar solo
// la fila de contenido dentro de cada tabla por separado (lo que hacía
// antes) sí generaba el texto correcto por secuencia, pero el documento
// seguía leyéndose "APERTURA [todo] / DESARROLLO [todo] / CIERRE [todo]"
// porque las tres tablas nunca se repetían juntas — había que clonar las
// TRES tablas como una unidad repetible, no cada una por separado.
function duplicarBloqueWord(doc, inicioTablaIdx, finTablaIdx, veces) {
  const tablas = Array.from(doc.getElementsByTagNameNS(W_NS, 'tbl'))
  const tInicio = tablas[inicioTablaIdx]
  const tFin = tablas[finTablaIdx]
  if (!tInicio || !tFin || tInicio.parentNode !== tFin.parentNode) return
  const parent = tInicio.parentNode

  const rango = []
  for (let n = tInicio; n; n = n.nextSibling) {
    rango.push(n)
    if (n === tFin) break
  }
  if (rango[rango.length - 1] !== tFin) return // tFin no es hermano de tInicio en orden — no se toca nada

  parent.insertBefore(parrafoVacioWord(doc), tInicio)
  parent.insertBefore(parrafoVacioWord(doc), tInicio)
  parent.insertBefore(parrafoEtiquetaWord(doc, 'SECUENCIA DIDÁCTICA 1'), tInicio)

  let ancla = tFin
  for (let i = 1; i < veces; i++) {
    parent.insertBefore(parrafoVacioWord(doc), ancla.nextSibling)
    ancla = ancla.nextSibling
    parent.insertBefore(parrafoVacioWord(doc), ancla.nextSibling)
    ancla = ancla.nextSibling
    const etiqueta = parrafoEtiquetaWord(doc, `SECUENCIA DIDÁCTICA ${i + 1}`)
    parent.insertBefore(etiqueta, ancla.nextSibling)
    ancla = etiqueta
    for (const nodo of rango) {
      const copia = nodo.cloneNode(true)
      parent.insertBefore(copia, ancla.nextSibling)
      ancla = copia
    }
  }
}

// Abre el archivo ORIGINAL y escribe cada celda que la IA decidió llenar —
// una sola pasada, sin etiquetas intermedias. Las celdas de Apertura/
// Desarrollo/Cierre llegan con `texto` como ARRAY (una Secuencia Didáctica
// por elemento, ver promptPlantillaParcial en functions/ia.js) — el bloque
// de tablas que las contiene se clona completo por cada elemento del array,
// ver duplicarBloqueWord.
export async function llenarPlantillaWord(arrayBuffer, celdas) {
  const PizZip = await cargarPizZip()
  const zip = new PizZip(arrayBuffer)
  const xml = zip.file('word/document.xml').asText()
  const doc = new DOMParser().parseFromString(xml, 'application/xml')

  const normales = celdas.filter((c) => !Array.isArray(c.texto))
  const conSecuencias = celdas.filter((c) => Array.isArray(c.texto) && c.texto.length)

  // Primero las celdas normales, con los índices ORIGINALES — antes de
  // clonar ningún bloque, o quedarían desalineadas.
  for (const c of normales) {
    if (!c.texto) continue
    escribirEnCelda(doc, c.tablaIndex, c.fila, c.columna, c.texto)
  }

  if (conSecuencias.length) {
    const tablasImplicadas = conSecuencias.map((c) => c.tablaIndex ?? 0)
    const inicioTabla = Math.min(...tablasImplicadas)
    const finTabla = Math.max(...tablasImplicadas)
    const anchoBloque = finTabla - inicioTabla + 1
    const totalSecuencias = Math.max(...conSecuencias.map((c) => c.texto.length))

    duplicarBloqueWord(doc, inicioTabla, finTabla, totalSecuencias)

    // Cada copia del bloque está `anchoBloque` tablas más adelante que la
    // anterior (se insertaron en orden, en el mismo documento) — no hace
    // falta volver a leer el documento para saber dónde quedó cada una.
    for (let i = 0; i < totalSecuencias; i++) {
      for (const c of conSecuencias) {
        const texto = c.texto[i]
        if (!texto) continue
        const tablaDestino = (c.tablaIndex ?? 0) + i * anchoBloque
        escribirEnCelda(doc, tablaDestino, c.fila, c.columna, texto)
      }
    }
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
