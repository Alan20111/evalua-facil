// Lazy-loads jsPDF + autotable + qrcode only when the teacher actually exports,
// so these heavy libs stay out of the main bundle.
import { subjectDisplayName } from './subjectName'
import { promedioParcial, ponderacionActivaEnParcial } from './ponderacion'
import { subjectPeriodLabel } from './dateRange'

function fullName(s) {
  return [s.apellidoPaterno, s.apellidoMaterno, s.nombre].filter(Boolean).join(' ').trim()
}

function safeFile(subject) {
  return (subjectDisplayName(subject) || 'asignatura')
    .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
}

// Grades report: one row per student with per-parcial average + final.
export async function exportSubjectGradesPDF({ subject, activities, students, submissions }) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableMod.default

  const doc = new jsPDF({ orientation: 'landscape' })
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
        return sub?.calificacion != null ? (sub.calificacion / (a.maxCalif || 10)) * 10 : null
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

  doc.save(`calificaciones_${safeFile(subject)}.pdf`)
}

// Detailed grades report for a SINGLE parcial: one column per activity
// (1.1., 1.2.…) plus the parcial average. Mirrors exportParcialGrades (Excel).
export async function exportParcialGradesPDF({ subject, activities, students, submissions, parcial }) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableMod.default

  const isDraft = (a) => a.oculta && !a.publishedAt && !a.publishAt
  const acts = activities
    .filter((a) => a.parcial === parcial && !isDraft(a))
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))

  const doc = new jsPDF({ orientation: acts.length > 6 ? 'landscape' : 'portrait' })

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

  doc.save(`calificaciones_parcial${parcial}_${safeFile(subject)}.pdf`)
}

// Just the activation QR, large, with the subject name and group — nothing
// else (no link, no code, no student list). For projecting/printing on its own.
export async function exportQRPDF({ subject, activationUrl }) {
  const [{ jsPDF }, QRCodeMod] = await Promise.all([
    import('jspdf'),
    import('qrcode'),
  ])
  const QRCode = QRCodeMod.default

  const doc = new jsPDF()
  const pageW = doc.internal.pageSize.getWidth()
  const centerX = pageW / 2

  doc.setFont(undefined, 'bold')
  doc.setFontSize(20)
  doc.setTextColor(20)
  doc.text(subject.nombre || 'Asignatura', centerX, 30, { align: 'center' })

  if (subject.grupo) {
    doc.setFont(undefined, 'normal')
    doc.setFontSize(14)
    doc.setTextColor(90)
    doc.text(`Grupo: ${subject.grupo}`, centerX, 39, { align: 'center' })
  }

  const qrDataUrl = await QRCode.toDataURL(activationUrl, { width: 600, margin: 1 })
  const qrSize = 130
  doc.addImage(qrDataUrl, 'PNG', centerX - qrSize / 2, 55, qrSize, qrSize)

  if (subject.accessCode) {
    doc.setFont(undefined, 'bold')
    doc.setFontSize(40)
    doc.setTextColor(20)
    doc.text(subject.accessCode, centerX, 215, { align: 'center' })
  }

  doc.save(`qr_${safeFile(subject)}.pdf`)
}

// Cuestionario/examen results: one enunciado + options table per reactivo de
// opción múltiple. `counts`/`preguntas` mirror EvaluacionGraficas.jsx exactly
// (counts computed there, passed straight through — no recomputation here).
export async function exportEvaluacionResultadosPDF({ activity, subject, preguntas, counts }) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableMod.default

  const doc = new jsPDF()
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
    doc.text('Este cuestionario/examen no tiene reactivos de opción múltiple.', 14, y)
  }

  preguntas.forEach((p, i) => {
    if (y > pageH - 30) { doc.addPage(); y = 20 }
    doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20)
    const enunciadoLines = doc.splitTextToSize(`${i + 1}. ${p.enunciado}`, pageW - 28)
    doc.text(enunciadoLines, 14, y)
    y += enunciadoLines.length * 5 + 3

    const preguntaCounts = counts[p.id] || {}
    const total = Object.values(preguntaCounts).reduce((sum, n) => sum + n, 0)
    const body = (p.opciones || []).map((o) => {
      const count = preguntaCounts[o.id] || 0
      const pct = total ? Math.round((count / total) * 100) : 0
      return [o.texto, String(count), `${pct}%`]
    })

    autoTable(doc, {
      startY: y,
      head: [['Opción', 'Respuestas', '%']],
      body,
      styles: { fontSize: 9, cellPadding: 2.5, textColor: 30 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      columnStyles: { 1: { halign: 'center', cellWidth: 30 }, 2: { halign: 'center', cellWidth: 20 } },
      margin: { left: 14, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 10
  })

  doc.save(`resultados_${safeFile(subject)}.pdf`)
}

// Credentials list: one row per student with username + temp password (1st login).
export async function exportCredentialsPDF({ subject, students, activationUrl, docenteNombre }) {
  const [{ jsPDF }, autoTableMod, QRCodeMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('qrcode'),
  ])
  const autoTable = autoTableMod.default
  const QRCode = QRCodeMod.default

  const doc = new jsPDF()
  const pageW = doc.internal.pageSize.getWidth()

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

  if (activationUrl) {
    const qrDataUrl = await QRCode.toDataURL(activationUrl, { width: 240, margin: 1 })
    doc.addImage(qrDataUrl, 'PNG', pageW - 52, 12, 38, 38)
    doc.setFont(undefined, 'normal'); doc.setFontSize(8); doc.setTextColor(130)
    doc.text('Escanea para activar', pageW - 52, 54)
  }

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

  doc.save(`lista_acceso_${safeFile(subject)}.pdf`)
}
