import { saveWorkbook as _saveWorkbook, savePdfDoc as _savePdfDoc, saveBlob as _saveBlob } from './nativeSave'

// Punto ÚNICO de paso para la descarga de archivos GENERADOS por la
// plataforma (calificaciones, asistencias, Planeación Inicial, análisis con
// IA…).
//
// HOY NO BLOQUEA NADA (26-ago-2026). Las descargas son gratuitas: la
// plataforma es gratuita y los créditos cubren ÚNICAMENTE operaciones de IA
// — no descargas, no asistencias, no actividades interactivas. El candado
// anterior las trataba como un "bonus asociado a tener créditos IA activos"
// (21-ago-2026), que a su vez había reemplazado a uno por "trial sin pagar"
// (13-ago-2026); ninguno de los dos modelos existe ya.
//
// El módulo se conserva —igual que firestoreGuard.js, que quedó inerte
// cuando se retiró el candado de suscripción— porque decenas de pantallas
// importan saveWorkbook/savePdfDoc/saveBlob desde aquí (mismos nombres,
// misma firma). Layout.jsx lo cablea con `bloqueado: () => false`. Si algún
// día hace falta un candado de descargas, el cable ya está puesto.
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
//   · exportAppQRPDF (pdf.js, botón en AppQRButton.jsx) — el QR de la App
//     SIEMPRE se puede descargar, sin importar el saldo de créditos.
//   · exportCredentialsPDF (pdf.js, "Generar PDF con códigos" en la pestaña
//     Estudiantes) — es lo que le permite a sus estudiantes ENTRAR a la
//     plataforma; bloquearlo dejaría al docente sin poder dar de alta a su
//     grupo aunque se haya quedado sin créditos (decisión de Kike,
//     21-ago-2026).

let sinCreditos = () => false
let avisar = null

export function configurarBloqueoExportacion({ bloqueado, onIntento }) {
  sinCreditos = bloqueado || (() => false)
  avisar = onIntento || null
}

export class DescargaBloqueadaSinCreditosError extends Error {
  constructor() {
    super('El bonus de descargas está disponible mientras tengas créditos IA activos.')
    this.name = 'DescargaBloqueadaSinCreditosError'
    this.code = 'creditos/sin-descargas'
  }
}

function revisar() {
  if (!sinCreditos()) return
  avisar?.()
  throw new DescargaBloqueadaSinCreditosError()
}

export function saveWorkbook(...args) { revisar(); return _saveWorkbook(...args) }
export function savePdfDoc(...args) { revisar(); return _savePdfDoc(...args) }
export function saveBlob(...args) { revisar(); return _saveBlob(...args) }
