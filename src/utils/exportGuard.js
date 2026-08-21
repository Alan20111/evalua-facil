import { saveWorkbook as _saveWorkbook, savePdfDoc as _savePdfDoc, saveBlob as _saveBlob } from './nativeSave'

// Punto ÚNICO de control para bloquear la descarga de archivos GENERADOS por
// la plataforma (calificaciones, asistencias, Planeación Inicial, análisis
// con IA…). Modelo de créditos puros (21-ago-2026, decisión de Kike): las
// descargas son un BONUS asociado a tener créditos IA activos, sin relación
// con suscripción/plan/pago histórico —
//   · saldo > 0  → descargas permitidas (descargar NO consume créditos)
//   · saldo = 0  → descargas bloqueadas, con CTA para activar la bienvenida
//     o comprar más créditos
// Reemplaza al candado anterior por "trial sin pagar" (13-ago-2026), que
// dependía de subscription.planId — ese modelo ya no existe (ver
// docs/ia/PLAN_TECNICO_CREDITOS_PUROS.md). Distinto del candado de
// ESCRITURA (firestoreGuard.js), que sigue siendo por vencida, no por
// créditos.
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
