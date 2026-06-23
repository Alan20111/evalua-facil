// Lazy-loads jsPDF + autotable + qrcode only when the teacher actually exports,
// so these heavy libs stay out of the main bundle.
import { subjectDisplayName } from './subjectName'
import { subjectPeriodLabel } from './dateRange'

function fullName(s) {
  return [s.apellidoPaterno, s.apellidoMaterno, s.nombre].filter(Boolean).join(' ').trim()
}

export async function exportStudentListPDF({ subject, students, activationUrl }) {
  const [{ jsPDF }, autoTableMod, QRCodeMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('qrcode'),
  ])
  const autoTable = autoTableMod.default
  const QRCode = QRCodeMod.default

  const doc = new jsPDF()
  const pageW = doc.internal.pageSize.getWidth()

  const qrDataUrl = await QRCode.toDataURL(activationUrl, { width: 240, margin: 1 })

  // ── Header ──
  doc.setFontSize(16)
  doc.setFont(undefined, 'bold')
  doc.text(subjectDisplayName(subject) || 'Asignatura', 14, 20)

  doc.setFont(undefined, 'normal')
  doc.setFontSize(10)
  doc.setTextColor(110)
  const periodo = subjectPeriodLabel(subject)
  if (periodo) doc.text(`Periodo: ${periodo}`, 14, 27)

  doc.setFontSize(13)
  doc.setTextColor(20)
  doc.setFont(undefined, 'bold')
  doc.text(`Código de clase: ${subject.accessCode || '—'}`, 14, 37)

  // QR top-right
  doc.addImage(qrDataUrl, 'PNG', pageW - 52, 12, 38, 38)
  doc.setFont(undefined, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(130)
  doc.text('Escanea para activar', pageW - 52, 54)

  // ── Table: full name | username ──
  const body = students.map((s) => [fullName(s), s.username || ''])
  autoTable(doc, {
    startY: 62,
    head: [['Nombre completo', 'Usuario']],
    body,
    styles: { fontSize: 10, cellPadding: 3, textColor: 30 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: { 1: { font: 'courier', fontStyle: 'bold' } },
  })

  const safe = (subjectDisplayName(subject) || 'asignatura')
    .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
  doc.save(`lista_${safe}.pdf`)
}
