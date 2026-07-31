// Marca de agua de "Versión de evaluación" para exportaciones del docente en
// periodo de prueba (o sin suscripción activa) — pedido explícito: identificar
// el documento como generado por Evalúa Fácil, sin estorbar la lectura.
//
// El logo vive como PNG estático en /public (ver EFLogo.jsx) — no hay una
// versión base64 pre-generada en el repo, así que se descarga y convierte una
// sola vez por sesión (cacheada en este módulo) la primera vez que se exporta
// un documento en prueba.
let logoDataUrlPromise = null
export function getLogoDataUrl() {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = fetch('/logo-icon.png')
      .then((r) => r.blob())
      .then((blob) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      }))
      .catch(() => null) // best-effort: sin logo, el texto diagonal solo ya identifica el documento
  }
  return logoDataUrlPromise
}

// Dibuja la marca de agua en la página ACTUAL — el llamador debe invocarla
// justo después de crear cada página (antes de doc.text/autoTable), porque
// jsPDF apila el contenido en el orden en que se dibuja: para que quede
// "detrás" tiene que pintarse primero, no hay capas de verdad como en un
// editor de imágenes.
export function drawPdfWatermarkOnPage(doc, logoDataUrl) {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const cx = pageW / 2
  const cy = pageH / 2
  const size = Math.min(pageW, pageH) * 0.55

  doc.saveGraphicsState()
  doc.setGState(doc.GState({ opacity: 0.1 }))
  if (logoDataUrl) {
    try {
      // rotation: diagonal de esquina inferior izquierda a superior derecha.
      doc.addImage({
        imageData: logoDataUrl, x: cx - size / 2, y: cy - size / 2 - 16,
        width: size, height: size, rotation: 45,
      })
    } catch {
      // best-effort — un logo que no cargó no debe tumbar la exportación completa
    }
  }
  doc.setFont(undefined, 'bold')
  doc.setFontSize(20)
  doc.setTextColor(90)
  doc.text('Versión de evaluación', cx, cy + size / 2 - 4, { align: 'center', angle: 45 })
  doc.setFont(undefined, 'normal')
  doc.setFontSize(14)
  doc.text('evaluafacil.mx', cx, cy + size / 2 + 8, { align: 'center', angle: 45 })
  doc.restoreGraphicsState()
}

// Pie de página discreto en TODAS las páginas — se llama al final, una vez
// que el documento completo (con todas sus páginas) ya está armado.
export function addPdfFooter(doc) {
  const pageCount = doc.internal.getNumberOfPages()
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont(undefined, 'normal')
    doc.setFontSize(7)
    doc.setTextColor(160)
    doc.text('Generado con Evalúa Fácil · Versión de evaluación', pageW / 2, pageH - 6, { align: 'center' })
  }
}

// Punto único que usa cada función de pdf.js: si `watermark` es true, carga
// el logo (una sola vez, cacheado) y pinta la marca de agua en la página
// actual. Siempre segura de llamar aunque watermark sea false (no hace nada).
export async function applyPdfWatermarkIfNeeded(doc, watermark) {
  if (!watermark) return
  const logoDataUrl = await getLogoDataUrl()
  drawPdfWatermarkOnPage(doc, logoDataUrl)
}

// ── Marca de agua para Excel (exceljs) ──────────────────────────────────────
// `exceljs` sí puede insertar imágenes (a diferencia de la librería `xlsx`
// usada para el resto de excel.js), pero NO soporta opacidad nativa por
// imagen. Para lograr el mismo ~10% de opacidad diagonal que en el PDF, se
// "hornea" la rotación y la transparencia directamente en los píxeles del PNG
// usando un canvas, una sola vez por sesión (cacheado), y esa imagen ya
// rotada/transparente es la que se inserta en cada hoja.
let excelWatermarkDataUrlPromise = null
export function getExcelWatermarkImage() {
  if (!excelWatermarkDataUrlPromise) {
    excelWatermarkDataUrlPromise = getLogoDataUrl().then((logoDataUrl) => {
      if (!logoDataUrl) return null
      return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
          try {
            const size = 480
            const canvas = document.createElement('canvas')
            canvas.width = size
            canvas.height = size
            const ctx = canvas.getContext('2d')
            ctx.translate(size / 2, size / 2)
            ctx.rotate(-45 * (Math.PI / 180))
            const logoSize = size * 0.5
            ctx.globalAlpha = 0.1
            ctx.drawImage(img, -logoSize / 2, -logoSize / 2 - 30, logoSize, logoSize)
            ctx.globalAlpha = 0.16
            ctx.fillStyle = '#333333'
            ctx.textAlign = 'center'
            ctx.font = 'bold 26px sans-serif'
            ctx.fillText('Versión de evaluación', 0, logoSize / 2 + 8)
            ctx.font = '18px sans-serif'
            ctx.fillText('evaluafacil.mx', 0, logoSize / 2 + 34)
            resolve(canvas.toDataURL('image/png'))
          } catch {
            resolve(null) // best-effort — sin marca gráfica, la leyenda de texto sigue identificando el documento
          }
        }
        img.onerror = () => resolve(null)
        img.src = logoDataUrl
      })
    }).catch(() => null)
  }
  return excelWatermarkDataUrlPromise
}

// Inserta la marca de agua (ya horneada en un PNG) en TODAS las hojas del
// libro — se llama una sola vez, justo antes de escribir el archivo, después
// de que todas las hojas ya existen.
export async function addExcelWatermarkIfNeeded(workbook, watermark) {
  if (!watermark) return
  const dataUrl = await getExcelWatermarkImage()
  if (!dataUrl) return
  const base64 = dataUrl.split(',')[1]
  const imageId = workbook.addImage({ base64, extension: 'png' })
  workbook.eachSheet((worksheet) => {
    worksheet.addImage(imageId, { tl: { col: 0.5, row: 0.5 }, ext: { width: 380, height: 380 } })
  })
}
