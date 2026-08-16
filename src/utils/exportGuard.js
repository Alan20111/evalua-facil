import { saveWorkbook as _saveWorkbook, savePdfDoc as _savePdfDoc, saveBlob as _saveBlob } from './nativeSave'

// Punto ÚNICO de control para bloquear la descarga de archivos GENERADOS por
// la plataforma (calificaciones, asistencias, Planeación Inicial, análisis
// con IA…) mientras el docente esté en período de prueba — decisión de
// Kike, 13-ago-2026: a propósito, para que nadie se registre solo a
// descargar su Planeación Didáctica Inicial y se vaya sin usar la
// plataforma. Un docente que YA pagó alguna vez conserva la descarga
// aunque se le venza después (mismo principio de "no se le quita nada de
// lo ya ganado" que usa hasCleanExports en subscriptionHelpers.js) —
// distinto del candado de ESCRITURA (firestoreGuard.js), que bloquea por
// venCIDA, no por trial.
//
// Mismo patrón que firestoreGuard.js: las pantallas del docente importan
// saveWorkbook/savePdfDoc/saveBlob DESDE AQUÍ (mismos nombres, misma firma)
// en vez de desde utils/nativeSave.js, y este módulo las deja pasar o no.
//
// A propósito quedan FUERA de este candado (siguen usando nativeSave.js
// directo, sin pasar por aquí):
//   · abrirArchivoNativo (nativeSave.js) — abre un archivo que un ALUMNO
//     subió (una entrega), no algo que genera la plataforma; bloquearlo
//     le impediría al docente revisar el trabajo de su propio estudiante.
//   · downloadStudentTemplate (excel.js) — plantilla EN BLANCO para
//     importar alumnos, sin ningún dato real que "llevarse".
//   · exportAppQRPDF (pdf.js, botón en AppQRButton.jsx) — el PDF del QR
//     para instalar la app, no es contenido de valor del docente.

let esTrialSinPagar = () => false
let avisar = null

export function configurarBloqueoExportacion({ bloqueado, onIntento }) {
  esTrialSinPagar = bloqueado || (() => false)
  avisar = onIntento || null
}

export class DescargaBloqueadaTrialError extends Error {
  constructor() {
    super('Activa tu suscripción mensual para descargar archivos — mientras tanto puedes seguir usando la plataforma con normalidad.')
    this.name = 'DescargaBloqueadaTrialError'
    this.code = 'trial/sin-descargas'
  }
}

function revisar() {
  if (!esTrialSinPagar()) return
  avisar?.()
  throw new DescargaBloqueadaTrialError()
}

export function saveWorkbook(...args) { revisar(); return _saveWorkbook(...args) }
export function savePdfDoc(...args) { revisar(); return _savePdfDoc(...args) }
export function saveBlob(...args) { revisar(); return _saveBlob(...args) }
