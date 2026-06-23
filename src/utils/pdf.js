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
      const grades = []
      acts.forEach((a) => {
        const sub = submissions.find((x) => x.alumnoId === s.id && x.actividadId === a.id)
        if (sub?.calificacion != null) {
          grades.push((sub.calificacion / (a.maxCalif || 10)) * 10)
        }
      })
      const avg = grades.length ? grades.reduce((x, y) => x + y, 0) / grades.length : null
      row.push(avg != null ? avg.toFixed(1) : '—')
      if (avg != null) finals.push(avg)
    })
    const final = finals.length ? finals.reduce((x, y) => x + y, 0) / finals.length : null
    row.push(final != null ? final.toFixed(1) : '—')
    return row
  })

  autoTable(doc, {
    startY: periodo ? 28 : 24,
    head: [['#', 'Alumno', ...PARCIALES.map((p) => `Prom. P${p}`), 'Final']],
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

// Credentials list: one row per student with username + temp password (1st login).
export async function exportCredentialsPDF({ subject, students, activationUrl }) {
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
  doc.text('Credenciales de acceso de los alumnos', 14, 27)
  doc.setFontSize(13); doc.setTextColor(20); doc.setFont(undefined, 'bold')
  doc.text(`Código de clase: ${subject.accessCode || '—'}`, 14, 37)

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
    s.resetPassword || (s.activado ? '(ya activó)' : '—'),
  ])

  autoTable(doc, {
    startY: 62,
    head: [['#', 'Nombre completo', 'Usuario', 'Clave temporal']],
    body,
    styles: { fontSize: 10, cellPadding: 3, textColor: 30 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      2: { font: 'courier', fontStyle: 'bold' },
      3: { font: 'courier', fontStyle: 'bold', textColor: [180, 83, 9] },
    },
  })

  const y = doc.lastAutoTable.finalY + 8
  doc.setFont(undefined, 'normal'); doc.setFontSize(8); doc.setTextColor(130)
  doc.text('La clave temporal se usa solo en el primer ingreso; el alumno define su contraseña al entrar.', 14, y)

  doc.save(`credenciales_${safeFile(subject)}.pdf`)
}
