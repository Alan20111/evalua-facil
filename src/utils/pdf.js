// Lazy-loads jsPDF + autotable + qrcode only when the teacher actually exports,
// so these heavy libs stay out of the main bundle.
import { subjectDisplayName } from './subjectName'
import { promedioParcial, ponderacionActivaEnParcial, normalizeGrade } from './ponderacion'
import { isDraftActivity } from './activityVisibility'
import { subjectPeriodLabel } from './dateRange'
import { studentFullName as fullName } from './studentSearch'
import { savePdfDoc } from './nativeSave'
import { applyPdfWatermarkIfNeeded, addPdfFooter, getLogoDataUrl, drawPdfWatermarkOnPage } from './exportWatermark'
import { filasDeReactivo, totalRespuestas } from './evaluacionRespuestas'

// Palomita verde de "respuesta correcta", dibujada con dos trazos y centrada
// en (cx, cy). Ver el comentario en didDrawCell: las fuentes estándar de jsPDF
// no tienen el carácter '✓'.
function drawCheckMark(doc, cx, cy, scale = 1) {
  doc.setDrawColor(16, 128, 80)
  doc.setLineWidth(0.6 * scale)
  doc.setLineCap('round')
  doc.setLineJoin('round')
  doc.lines([[1.1 * scale, 1.3 * scale], [2.4 * scale, -2.9 * scale]], cx - 1.7 * scale, cy - 0.1 * scale)
}

// #rrggbb → [r, g, b] para las APIs de color de jsPDF.
function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

// Dibuja la gráfica de pastel de un reactivo en un canvas y la devuelve como
// PNG (data URL) para insertarla en el PDF. Se dibuja a mano —los mismos
// colores, el mismo separador blanco entre rebanadas y el mismo círculo gris
// de "Sin respuestas" que la gráfica de pantalla— en vez de capturar el DOM:
// una captura depende de fuentes y variables CSS ya resueltas, y aquí basta
// con la geometría. `px` alto (3x el tamaño impreso) para que no se pixelee.
function pieDataUrl(filas, px = 540) {
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  const cx = px / 2
  const cy = px / 2
  const r = px / 2 - 2
  const conVotos = filas.filter((f) => f.count > 0)
  const total = conVotos.reduce((sum, f) => sum + f.count, 0)

  if (total === 0) {
    ctx.fillStyle = '#eef1f5'
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#8a94a6'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${Math.round(px * 0.09)}px sans-serif`
    ctx.fillText('Sin respuestas', cx, cy)
    return canvas.toDataURL('image/png')
  }

  let angle = -Math.PI / 2
  conVotos.forEach((f) => {
    const sweep = (f.count / total) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, r, angle, angle + sweep)
    ctx.closePath()
    ctx.fillStyle = f.color
    ctx.fill()
    // Separador del color del papel — el mismo recurso que en pantalla, donde
    // el trazo va del color de la tarjeta.
    if (conVotos.length > 1) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = px * 0.015
      ctx.lineJoin = 'round'
      ctx.stroke()
    }
    angle += sweep
  })
  return canvas.toDataURL('image/png')
}

function safeFile(subject) {
  return (subjectDisplayName(subject) || 'asignatura')
    .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
}

// QR de descarga de la app, para proyectar o imprimir. NO lleva datos de
// ninguna asignatura: es el MISMO para todas, porque la app es una sola y el
// perfil (docente o estudiante) se elige al abrirla. Por eso vive fuera de la
// asignatura y no dentro, como vivia el viejo QR de activacion.
//
// La direccion va tambien escrita debajo del codigo: si la camara del telefono
// no lo lee (impresion pobre, proyector con poco contraste), se puede teclear.
export async function exportAppQRPDF({ url }) {
  const [{ jsPDF }, QRCodeMod] = await Promise.all([
    import('jspdf'),
    import('qrcode'),
  ])
  const QRCode = QRCodeMod.default

  const doc = new jsPDF()
  const centerX = doc.internal.pageSize.getWidth() / 2

  doc.setFont(undefined, 'bold')
  doc.setFontSize(22)
  doc.setTextColor(20)
  doc.text('Descarga la app de Evalua Facil', centerX, 30, { align: 'center' })

  doc.setFont(undefined, 'normal')
  doc.setFontSize(13)
  doc.setTextColor(90)
  doc.text('Escanea este codigo con la camara de tu telefono', centerX, 41, { align: 'center' })

  const qrDataUrl = await QRCode.toDataURL(url, { width: 600, margin: 1 })
  const qrSize = 120
  doc.addImage(qrDataUrl, 'PNG', centerX - qrSize / 2, 55, qrSize, qrSize)

  doc.setFont(undefined, 'normal')
  doc.setFontSize(11)
  doc.setTextColor(120)
  doc.text('O escribe esta direccion en tu navegador:', centerX, 190, { align: 'center' })

  doc.setFont(undefined, 'bold')
  doc.setFontSize(14)
  doc.setTextColor(37, 99, 235)
  doc.text(url, centerX, 199, { align: 'center' })

  await savePdfDoc(doc, 'descarga_app_evalua_facil.pdf')
}

// Ranking report: estudiantes ordenados por promedio (mayor a menor).
// Columnas: Lugar, No., Estudiante, Promedio. `rows` = [{ lugar, orden, nombre,
// promedio }] YA ordenado; `label` = "Parcial N" o "Promedio final".
export async function exportRankingPDF({ subject, rows, label, watermark = false }) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableMod.default

  const doc = new jsPDF({ orientation: 'portrait' })
  await applyPdfWatermarkIfNeeded(doc, watermark)
  doc.setFontSize(15); doc.setFont(undefined, 'bold'); doc.setTextColor(20)
  doc.text(`${subjectDisplayName(subject) || 'Asignatura'} — Ranking · ${label}`, 14, 16)
  const periodo = subjectPeriodLabel(subject)
  if (periodo) {
    doc.setFont(undefined, 'normal'); doc.setFontSize(10); doc.setTextColor(110)
    doc.text(periodo, 14, 22)
  }

  const body = rows.map((r) => [r.lugar, r.nombre, r.promedio != null ? r.promedio.toFixed(1) : '—'])
  autoTable(doc, {
    startY: periodo ? 28 : 24,
    head: [['Lugar', 'Estudiante', label]],
    body,
    styles: { fontSize: 9, cellPadding: 2.5, textColor: 30 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 16, fontStyle: 'bold' },
      2: { halign: 'center', cellWidth: 26, fontStyle: 'bold' },
    },
  })
  if (watermark) addPdfFooter(doc)
  const safeLabel = label.toLowerCase().replace(/\s+/g, '')
  await savePdfDoc(doc, `ranking_${safeLabel}_${safeFile(subject)}.pdf`)
}

// Grades report: one row per student with per-parcial average + final.
export async function exportSubjectGradesPDF({ subject, activities, students, submissions, watermark = false }) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableMod.default

  const doc = new jsPDF({ orientation: 'landscape' })
  await applyPdfWatermarkIfNeeded(doc, watermark)
  const PARCIALES = Array.from({ length: subject.parciales || 3 }, (_, i) => i + 1)

  // ── Header ──
  doc.setFontSize(15)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(20)
  doc.text(subjectDisplayName(subject) || 'Asignatura', 14, 16)
  const periodo = subjectPeriodLabel(subject)
  if (periodo) {
    doc.setFont(undefined, 'normal'); doc.setFontSize(10); doc.setTextColor(110)
    doc.text(periodo, 14, 22)
  }

  const sorted = [...students].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  const body = sorted.map((s) => {
    const row = [s.orden ?? '', fullName(s)]
    const finals = []
    PARCIALES.forEach((p) => {
      const acts = activities.filter((a) => a.parcial === p)
      const grades = acts.map((a) => {
        const sub = submissions.find((x) => x.alumnoId === s.id && x.actividadId === a.id)
        return normalizeGrade(sub?.calificacion, a.maxCalif)
      })
      const avg = promedioParcial(acts, grades, ponderacionActivaEnParcial(subject, p))
      row.push(avg != null ? avg.toFixed(1) : '—')
      if (avg != null) finals.push(avg)
    })
    const final = finals.length ? finals.reduce((x, y) => x + y, 0) / finals.length : null
    row.push(final != null ? final.toFixed(1) : '—')
    return row
  })

  autoTable(doc, {
    startY: periodo ? 28 : 24,
    head: [['#', 'Estudiante', ...PARCIALES.map((p) => `Prom. P${p}`), 'Final']],
    body,
    styles: { fontSize: 9, cellPadding: 2.5, textColor: 30 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      ...Object.fromEntries(PARCIALES.map((_, i) => [i + 2, { halign: 'center' }])),
      [PARCIALES.length + 2]: { halign: 'center', fontStyle: 'bold' },
    },
  })

  if (watermark) addPdfFooter(doc)
  await savePdfDoc(doc, `calificaciones_${safeFile(subject)}.pdf`)
}

// Detailed grades report for a SINGLE parcial: one column per activity
// (1.1., 1.2.…) plus the parcial average. Mirrors exportParcialGrades (Excel).
export async function exportParcialGradesPDF({ subject, activities, students, submissions, parcial, watermark = false }) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableMod.default

  const acts = activities
    .filter((a) => a.parcial === parcial && !isDraftActivity(a))
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))

  const doc = new jsPDF({ orientation: acts.length > 6 ? 'landscape' : 'portrait' })
  await applyPdfWatermarkIfNeeded(doc, watermark)

  doc.setFontSize(15); doc.setFont(undefined, 'bold'); doc.setTextColor(20)
  doc.text(`${subjectDisplayName(subject) || 'Asignatura'} — Parcial ${parcial}`, 14, 16)
  const periodo = subjectPeriodLabel(subject)
  if (periodo) {
    doc.setFont(undefined, 'normal'); doc.setFontSize(10); doc.setTextColor(110)
    doc.text(periodo, 14, 22)
  }

  const pondOn = ponderacionActivaEnParcial(subject, parcial)
  const sorted = [...students].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  const body = sorted.map((s) => {
    const row = [s.orden ?? '', fullName(s)]
    const grades = acts.map((a) => {
      const sub = submissions.find((x) => x.alumnoId === s.id && x.actividadId === a.id)
      return sub?.calificacion != null ? (sub.calificacion / (a.maxCalif || 10)) * 10 : null
    })
    grades.forEach((g) => row.push(g != null ? g.toFixed(1) : '—'))
    const avg = promedioParcial(acts, grades, pondOn)
    row.push(avg != null ? avg.toFixed(1) : '—')
    return row
  })

  autoTable(doc, {
    startY: periodo ? 28 : 24,
    head: [['#', 'Estudiante', ...acts.map((a, ai) => `${parcial}.${ai + 1}.`), 'Prom.']],
    body,
    styles: { fontSize: 9, cellPadding: 2, textColor: 30 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      ...Object.fromEntries(acts.map((_, i) => [i + 2, { halign: 'center' }])),
      [acts.length + 2]: { halign: 'center', fontStyle: 'bold' },
    },
  })

  if (watermark) addPdfFooter(doc)
  await savePdfDoc(doc, `calificaciones_parcial${parcial}_${safeFile(subject)}.pdf`)
}

// Cuestionario/examen results: one enunciado + options table per reactivo
// graficable (opción múltiple y verdadero/falso — ver `graficables` en
// EvaluacionGraficas.jsx, mismo filtro). `counts`/`preguntas` mirror ese
// componente exactamente (counts computed there, passed straight through —
// no recomputation here).
export async function exportEvaluacionResultadosPDF({ activity, subject, preguntas, counts, watermark = false }) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableMod.default

  const doc = new jsPDF()
  // Logo cacheado una sola vez aquí — este es el único export que llama
  // doc.addPage() (líneas de abajo), y cada página nueva necesita su propia
  // marca de agua repintada, no solo la primera.
  const logoDataUrl = watermark ? await getLogoDataUrl() : null
  if (watermark) drawPdfWatermarkOnPage(doc, logoDataUrl)
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  doc.setFontSize(15); doc.setFont(undefined, 'bold'); doc.setTextColor(20)
  doc.text(subjectDisplayName(subject) || 'Asignatura', 14, 16)
  doc.setFont(undefined, 'normal'); doc.setFontSize(10); doc.setTextColor(110)
  doc.text(`Resultados — ${activity.categoria === 'examen' ? 'Examen' : 'Cuestionario'}`, 14, 22)
  doc.setFont(undefined, 'bold'); doc.setFontSize(13); doc.setTextColor(20)
  doc.text(activity.nombre || '', 14, 30)

  let y = 40
  if (!preguntas.length) {
    doc.setFont(undefined, 'normal'); doc.setFontSize(10); doc.setTextColor(110)
    doc.text('Este cuestionario/examen no tiene reactivos de opción múltiple ni de verdadero/falso.', 14, y)
  }

  preguntas.forEach((p, i) => {
    if (y > pageH - 30) { doc.addPage(); if (watermark) drawPdfWatermarkOnPage(doc, logoDataUrl); y = 20 }
    doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20)
    const enunciadoLines = doc.splitTextToSize(`${i + 1}. ${p.enunciado}`, pageW - 28)
    doc.text(enunciadoLines, 14, y)
    y += enunciadoLines.length * 5

    const preguntaCounts = counts[p.id] || {}
    const total = totalRespuestas(preguntaCounts)
    // Total explícito arriba de la tabla — antes había que sumar la columna
    // "Respuestas" a mano para saber cuántos alumnos contestaron esta
    // pregunta en particular (no siempre son todos los inscritos: alguien
    // pudo dejarla en blanco).
    doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.setTextColor(110)
    doc.text(`${total} ${total === 1 ? 'respuesta' : 'respuestas'} en total`, 14, y + 4)
    y += 8

    const filas = filasDeReactivo(p, preguntaCounts)
    const body = filas.map((f) => ['', f.texto, String(f.count), `${f.pct}%`])

    autoTable(doc, {
      startY: y,
      head: [['', 'Opción', 'Respuestas', 'Porcentaje']],
      body,
      styles: { fontSize: 9, cellPadding: 2.5, textColor: 30 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
        2: { halign: 'center', cellWidth: 28 },
        3: { halign: 'center', cellWidth: 28 },
      },
      margin: { left: 14, right: 14 },
      // La palomita de la respuesta correcta se DIBUJA (dos trazos), no se
      // escribe: las fuentes estándar de jsPDF son WinAnsi y no traen el
      // carácter '✓', que salía impreso como una comilla suelta — se veía como
      // un error de captura en vez de como la marca de la respuesta buena.
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 0) return
        if (!filas[data.row.index]?.correcta) return
        drawCheckMark(doc, data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2)
      },
    })
    y = doc.lastAutoTable.finalY + 10
  })

  if (watermark) addPdfFooter(doc)
  await savePdfDoc(doc, `resultados_${safeFile(subject)}.pdf`)
}

// El MISMO reporte de arriba pero con las gráficas de pastel que el docente
// tiene en pantalla, no con las tablas — se genera desde la pantalla de
// Gráficas. Cada reactivo lleva su pastel y, a un lado, su leyenda con el
// color, la opción, cuántos la eligieron y su porcentaje.
export async function exportEvaluacionGraficasPDF({ activity, subject, preguntas, counts, watermark = false }) {
  const { jsPDF } = await import('jspdf')

  const doc = new jsPDF()
  const logoDataUrl = watermark ? await getLogoDataUrl() : null
  if (watermark) drawPdfWatermarkOnPage(doc, logoDataUrl)
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  doc.setFontSize(15); doc.setFont(undefined, 'bold'); doc.setTextColor(20)
  doc.text(subjectDisplayName(subject) || 'Asignatura', 14, 16)
  doc.setFont(undefined, 'normal'); doc.setFontSize(10); doc.setTextColor(110)
  doc.text(`Gráficas de resultados — ${activity.categoria === 'examen' ? 'Examen' : 'Cuestionario'}`, 14, 22)
  doc.setFont(undefined, 'bold'); doc.setFontSize(13); doc.setTextColor(20)
  doc.text(activity.nombre || '', 14, 30)

  let y = 40
  if (!preguntas.length) {
    doc.setFont(undefined, 'normal'); doc.setFontSize(10); doc.setTextColor(110)
    doc.text('Este cuestionario/examen no tiene reactivos de opción múltiple ni de verdadero/falso.', 14, y)
  }

  const PIE = 46            // lado de la gráfica, en mm
  const LEGEND_X = 70       // donde empieza el texto de la leyenda
  const VALUE_X = pageW - 14 // "n resp. (p%)", alineado a la derecha
  const LINE_H = 4.6

  preguntas.forEach((p, i) => {
    const preguntaCounts = counts[p.id] || {}
    const total = totalRespuestas(preguntaCounts)
    const filas = filasDeReactivo(p, preguntaCounts)

    // Se mide el bloque completo ANTES de dibujar nada: enunciado + gráfica +
    // leyenda no se pueden partir a la mitad entre dos páginas sin que el
    // pastel quede huérfano de su leyenda.
    doc.setFont(undefined, 'bold'); doc.setFontSize(11)
    const enunciadoLines = doc.splitTextToSize(`${i + 1}. ${p.enunciado}`, pageW - 28)
    doc.setFont(undefined, 'normal'); doc.setFontSize(9)
    const filasLines = filas.map((f) => doc.splitTextToSize(f.texto || '—', VALUE_X - LEGEND_X - 34))
    const legendH = filasLines.reduce((sum, lines) => sum + lines.length * LINE_H + 2.4, 0)
    const bloqueH = enunciadoLines.length * 5 + 6 + Math.max(PIE, legendH) + 10

    if (y + bloqueH > pageH - 16) {
      doc.addPage()
      if (watermark) drawPdfWatermarkOnPage(doc, logoDataUrl)
      y = 20
    }

    doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20)
    doc.text(enunciadoLines, 14, y)
    y += enunciadoLines.length * 5
    doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.setTextColor(110)
    doc.text(`${total} ${total === 1 ? 'respuesta' : 'respuestas'} en total`, 14, y + 4)
    y += 8

    const top = y
    try {
      doc.addImage(pieDataUrl(filas), 'PNG', 14, top, PIE, PIE)
    } catch {
      // best-effort: sin la imagen, la leyenda de abajo sigue diciendo todo
    }

    // La leyenda va centrada contra el pastel (como en pantalla), no pegada
    // arriba: con dos o tres opciones, alineada al tope quedaba flotando
    // sobre la mitad vacía de la gráfica.
    let ly = top + 3 + Math.max(0, (PIE - legendH) / 2)
    filas.forEach((f, idx) => {
      const lines = filasLines[idx]
      doc.setFillColor(...hexToRgb(f.color))
      doc.circle(LEGEND_X - 4, ly - 1.1, 1.4, 'F')
      doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.setTextColor(30)
      doc.text(lines, LEGEND_X, ly)
      if (f.correcta) {
        drawCheckMark(doc, LEGEND_X + doc.getTextWidth(lines[lines.length - 1]) + 3, ly + (lines.length - 1) * LINE_H - 1.2, 0.85)
      }
      doc.setTextColor(110)
      doc.text(`${f.count} resp. (${f.pct}%)`, VALUE_X, ly, { align: 'right' })
      ly += lines.length * LINE_H + 2.4
    })

    y = Math.max(top + PIE, ly) + 10
  })

  if (watermark) addPdfFooter(doc)
  await savePdfDoc(doc, `graficas_resultados_${safeFile(subject)}.pdf`)
}

// Credentials list: one row per student with username + temp password (1st login).
export async function exportCredentialsPDF({ subject, students, docenteNombre, watermark = false }) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableMod.default

  const doc = new jsPDF()
  await applyPdfWatermarkIfNeeded(doc, watermark)

  // ── Header ──
  doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(20)
  doc.text(subjectDisplayName(subject) || 'Asignatura', 14, 20)
  doc.setFont(undefined, 'normal'); doc.setFontSize(10); doc.setTextColor(110)
  doc.text('Lista de acceso de los estudiantes', 14, 27)
  let y37 = 37
  if (docenteNombre) {
    doc.setFont(undefined, 'normal'); doc.setFontSize(10); doc.setTextColor(110)
    doc.text(`Docente: ${docenteNombre}`, 14, 34)
    y37 = 44
  }
  doc.setFontSize(13); doc.setTextColor(20); doc.setFont(undefined, 'bold')
  doc.text(`Código de la clase: ${subject.accessCode || '—'}`, 14, y37)

  const sorted = [...students].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  const body = sorted.map((s) => [
    s.orden ?? '',
    fullName(s),
    s.username || '',
  ])

  autoTable(doc, {
    startY: y37 + 25,
    head: [['#', 'Nombre completo', 'Usuario']],
    body,
    styles: { fontSize: 10, cellPadding: 3, textColor: 30 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      2: { font: 'courier', fontStyle: 'bold' },
    },
  })

  const y = doc.lastAutoTable.finalY + 8
  doc.setFont(undefined, 'normal'); doc.setFontSize(8); doc.setTextColor(130)
  doc.text('Cada estudiante entra con su usuario y el código de la clase, y elige su propia contraseña la primera vez.', 14, y)

  if (watermark) addPdfFooter(doc)
  await savePdfDoc(doc, `lista_acceso_${safeFile(subject)}.pdf`)
}
