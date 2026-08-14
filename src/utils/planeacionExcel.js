// Excel de la Planeación Didáctica Inicial (Asistente IA → Planeación
// Didáctica Inicial, FASE 2-BIS del Plan Maestro de IA). Es una GUÍA para
// que el docente copie/pegue lo útil a su propio formato institucional — no
// lo sustituye. Por eso, a propósito, este archivo:
//   · NO usa membrete (nombre de escuela/docente) como los demás exports;
//   · NO agrega el logo/imagen de marca de agua de exportWatermark.js —
//     "sin logos, sin imágenes decorativas" es un requisito explícito del
//     documento, no solo cosmético;
//   · SÍ conserva el aviso de texto plano de "Versión de evaluación" en
//     trial (política existente de la app) — es una línea de texto, no una
//     imagen, así que no contradice lo anterior.
// El .xlsx se arma aquí, en el cliente, a partir del `resultado` ya guardado
// en Firestore — nunca se sube a Cloudinary ni a ningún storage, así que
// descargar (o volver a descargar) nunca cuesta créditos ni depende de red.

import { subjectDisplayName } from './subjectName'
import { saveBlob } from './nativeSave'

const COLUMNAS = [
  { header: 'Contenidos / temas', width: 30 },
  { header: 'Propósito / aprendizaje esperado', width: 30 },
  { header: 'Actividades de aprendizaje', width: 30 },
  { header: 'Estrategia / metodología', width: 26 },
  { header: 'Recursos', width: 22 },
  { header: 'Evidencias', width: 22 },
  { header: 'Evaluación', width: 22 },
  { header: 'Observaciones / ajustes', width: 26 },
]
const CAMPOS = ['contenidosTemas', 'proposito', 'actividades', 'estrategia', 'recursos', 'evidencias', 'evaluacion', 'observaciones']

// Formato 'extendida' (13-ago-2026): una fila por tema, con fecha estimada
// dentro del periodo real del parcial — columna extra, solo en ese formato.
const COLUMNA_FECHA = { header: 'Fecha estimada', width: 16 }
const CAMPO_FECHA = 'fechaEstimada'

const AVISO_TRIAL = 'Este archivo fue generado con Evalúa Fácil (Versión de evaluación) · evaluafacil.mx'

// Nombre de hoja válido en Excel: máx 31 caracteres, sin : \ / ? * [ ].
function nombreHoja(numero) {
  return `Parcial ${numero}`.slice(0, 31)
}

// Arma el workbook (sin guardarlo) — separado de descargarPlaneacionExcel
// para poder probar la estructura del Excel (hojas, columnas, ausencia de
// imágenes) sin depender de APIs de navegador.
export async function construirPlaneacionWorkbook({ subject, resultado, watermark = false, formato = 'simple' }) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()

  const conFecha = formato === 'extendida'
  const columnas = conFecha ? [...COLUMNAS, COLUMNA_FECHA] : COLUMNAS
  const campos = conFecha ? [...CAMPOS, CAMPO_FECHA] : CAMPOS

  resultado.parciales.forEach((parcial) => {
    const ws = workbook.addWorksheet(nombreHoja(parcial.numero))
    ws.columns = columnas.map((c) => ({ width: c.width }))

    const titulo = `${subjectDisplayName(subject)} — Parcial ${parcial.numero}` + (parcial.periodo ? `  (${parcial.periodo})` : '')
    ws.addRow([titulo])
    ws.mergeCells(1, 1, 1, columnas.length)
    ws.getRow(1).font = { bold: true, size: 12 }
    ws.getRow(1).height = 20

    ws.addRow(columnas.map((c) => c.header))
    ws.getRow(2).font = { bold: true }
    ws.getRow(2).alignment = { wrapText: true, vertical: 'top' }

    if (!parcial.filas?.length) {
      ws.addRow(['La IA no generó una propuesta para este parcial con las fuentes disponibles.'])
      ws.mergeCells(3, 1, 3, columnas.length)
    } else {
      parcial.filas.forEach((fila) => {
        const row = ws.addRow(campos.map((k) => fila[k] || ''))
        row.alignment = { wrapText: true, vertical: 'top' }
      })
    }

    if (watermark) {
      const avisoRow = ws.addRow([AVISO_TRIAL])
      avisoRow.font = { italic: true, size: 9, color: { argb: 'FF888888' } }
      ws.mergeCells(avisoRow.number, 1, avisoRow.number, columnas.length)
    }
  })

  return workbook
}

export async function descargarPlaneacionExcel({ subject, resultado, watermark = false, formato = 'simple' }) {
  const workbook = await construirPlaneacionWorkbook({ subject, resultado, watermark, formato })
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const safeName = subjectDisplayName(subject).replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim().replace(/\s+/g, '_')
  await saveBlob(blob, `planeacion_inicial_${safeName}.xlsx`)
}
