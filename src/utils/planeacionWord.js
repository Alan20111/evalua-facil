// Word de la Planeación Didáctica Inicial (Asistente IA → Planeación
// Didáctica Inicial, FASE 2-BIS del Plan Maestro de IA). Reemplaza al Excel
// genérico (decisión de Kike, 15-ago-2026: la vista previa de Word es mejor
// — ver PlaneacionInicialSection.jsx, que ahora usa docx-preview tanto para
// esta genérica como para el formato oficial de la escuela). Es una GUÍA
// para que el docente copie/pegue lo útil a su propio formato institucional
// — no lo sustituye. Mismas reglas que tenía el Excel:
//   · NO usa membrete (nombre de escuela/docente);
//   · NO agrega logo/imagen de marca de agua — "sin logos, sin imágenes
//     decorativas" es un requisito explícito del documento;
//   · SÍ conserva el aviso de texto plano de "Versión de evaluación" en
//     trial (política existente de la app).
// El .docx se arma aquí, en el cliente, a partir del `resultado` ya
// guardado en Firestore — nunca se sube a Cloudinary ni a ningún storage,
// así que descargar (o volver a descargar) nunca cuesta créditos ni
// depende de red.

import { subjectDisplayName } from './subjectName'
import { saveBlob } from './exportGuard'

// Mismo orden y etiquetas que CAMPOS_VISTA_PREVIA en
// PlaneacionInicialSection.jsx — la tabla en pantalla y el Word deben verse
// igual (etiqueta a la izquierda, contenido a lo ancho).
const CAMPOS = [
  ['contenidosTemas', 'Contenidos / temas'],
  ['proposito', 'Propósito / aprendizaje esperado'],
  ['actividades', 'Actividades de aprendizaje'],
  ['estrategia', 'Estrategia / metodología'],
  ['recursos', 'Recursos'],
  ['evidencias', 'Evidencias'],
  ['evaluacion', 'Evaluación'],
  ['observaciones', 'Observaciones / ajustes'],
]
const CAMPO_FECHA = ['fechaEstimada', 'Fecha estimada']

const AVISO_TRIAL = 'Este archivo fue generado con Evalúa Fácil (Versión de evaluación) · evaluafacil.mx'

const ANCHO_ETIQUETA_TWIPS = 2600 // ~1.8", deja el resto para el contenido

// Arma el Document (sin empaquetarlo) — separado de descargarPlaneacionWord
// para poder probar la estructura sin depender de APIs de navegador.
export async function construirPlaneacionDocumento({ subject, resultado, watermark = false, formato = 'simple' }) {
  const {
    Document, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
    WidthType, BorderStyle, VerticalAlign, ShadingType,
  } = await import('docx')

  const conFecha = formato === 'extendida'
  const campos = conFecha ? [...CAMPOS, CAMPO_FECHA] : CAMPOS

  const bordeFino = { style: BorderStyle.SINGLE, size: 4, color: 'B0B0B0' }
  const bordes = { top: bordeFino, bottom: bordeFino, left: bordeFino, right: bordeFino }

  const children = []

  resultado.parciales.forEach((parcial, pIdx) => {
    if (pIdx > 0) children.push(new Paragraph({ text: '', spacing: { after: 200 } }))

    const titulo = `Parcial ${parcial.numero}` + (parcial.periodo ? ` — ${parcial.periodo}` : '')
    children.push(new Paragraph({ text: titulo, heading: HeadingLevel.HEADING_2, spacing: { after: 150 } }))

    if (!parcial.filas?.length) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'La IA no generó una propuesta para este parcial con las fuentes disponibles.', italics: true })],
      }))
      return
    }

    parcial.filas.forEach((fila, fIdx) => {
      children.push(new Paragraph({ text: `Tema ${fIdx + 1}`, heading: HeadingLevel.HEADING_3, spacing: { before: 150, after: 80 } }))
      const filas = campos.map(([campo, etiqueta]) => new TableRow({
        children: [
          new TableCell({
            width: { size: ANCHO_ETIQUETA_TWIPS, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: 'D9E8F5' },
            verticalAlign: VerticalAlign.TOP,
            borders: bordes,
            children: [new Paragraph({ children: [new TextRun({ text: etiqueta, bold: true })] })],
          }),
          new TableCell({
            verticalAlign: VerticalAlign.TOP,
            borders: bordes,
            children: [new Paragraph({ text: fila[campo] || '' })],
          }),
        ],
      }))
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: filas }))
    })
  })

  if (watermark) {
    children.push(new Paragraph({
      spacing: { before: 300 },
      children: [new TextRun({ text: AVISO_TRIAL, italics: true, size: 16, color: '888888' })],
    }))
  }

  const tituloDoc = subjectDisplayName(subject) + ' — Planeación Didáctica Inicial'

  return new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({ text: tituloDoc, heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }),
        ...children,
      ],
    }],
  })
}

export async function descargarPlaneacionWord({ subject, resultado, watermark = false, formato = 'simple' }) {
  const { Packer } = await import('docx')
  const documento = await construirPlaneacionDocumento({ subject, resultado, watermark, formato })
  const blob = await Packer.toBlob(documento)
  const safeName = subjectDisplayName(subject).replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim().replace(/\s+/g, '_')
  await saveBlob(blob, `planeacion_inicial_${safeName}.docx`)
  return blob
}
