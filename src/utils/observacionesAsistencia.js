import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
// Escrituras a través del candado (mismo patrón que ./attendance.js).
import { deleteDoc, setDoc, updateDoc } from './firestoreGuard'
import { db } from '../firebase'
import { observacionId, htmlBitacoraImprimible } from './observacionesBitacora'

// Observaciones del docente sobre celdas de asistencia. Colección propia a
// propósito (ver src/utils/observacionesBitacora.js):
//   observacionesAsistencia/{asignaturaId}_{fecha}_{slot}_{alumnoId}
//   { asignaturaId, docenteId, alumnoId, fecha, slot, texto, createdAt, updatedAt }
// `fecha` y `slot` se copian de la celda para que la bitácora se entienda sola
// aunque el día de asistencia se elimine después. Nombres de estudiante,
// asignatura y docente NO se copian: se leen de sus documentos al mostrar.
// Solo el docente dueño lee y escribe (firestore.rules).
const COLECCION = 'observacionesAsistencia'

// Todas las de una asignatura en una lectura. Dos igualdades: no necesita
// índice compuesto, y el filtro por docente es el que exige la regla.
export async function cargarObservacionesAsistencia(asignaturaId, docenteId) {
  const snap = await getDocs(query(collection(db, COLECCION),
    where('asignaturaId', '==', asignaturaId), where('docenteId', '==', docenteId)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// Crea la observación de una celda. Devuelve el objeto para el estado local.
export async function crearObservacionAsistencia({ asignaturaId, docenteId, alumnoId, record, texto }) {
  const id = observacionId(asignaturaId, record.fecha, record.slot, alumnoId)
  const data = {
    asignaturaId,
    docenteId,
    alumnoId,
    fecha: record.fecha,
    slot: record.slot,
    texto,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  await setDoc(doc(db, COLECCION, id), data)
  return { id, ...data }
}

export async function editarObservacionAsistencia(id, texto) {
  await updateDoc(doc(db, COLECCION, id), { texto, updatedAt: serverTimestamp() })
}

export async function eliminarObservacionAsistencia(id) {
  await deleteDoc(doc(db, COLECCION, id))
}

// Al eliminar a un estudiante de la asignatura no deben quedar residuos.
export async function eliminarObservacionesDeAlumno(asignaturaId, docenteId, alumnoId) {
  const snap = await getDocs(query(collection(db, COLECCION),
    where('asignaturaId', '==', asignaturaId), where('docenteId', '==', docenteId), where('alumnoId', '==', alumnoId)))
  await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, COLECCION, d.id))))
  return snap.docs.map((d) => d.id)
}

// iPhone/iPad (incluye iPadOS, que se presenta como Mac con pantalla táctil).
function esIOS() {
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

// Imprime SOLO la bitácora con el diálogo de impresión del sistema (no es una
// descarga): el documento es siempre el mismo (htmlBitacoraImprimible), se
// abra desde escritorio, tablet o teléfono.
//   · En general, un iframe oculto con su propio documento, así la interfaz de
//     Evalúa Fácil (barra lateral, botones, menús) nunca entra a la hoja y no
//     hace falta tocar el CSS global de impresión.
//   · En iPhone/iPad Safari imprimir desde un iframe no es confiable (puede
//     imprimir la página entera), así que el documento se abre en una pestaña
//     temporal y se imprime desde ella. Si el navegador bloquea la pestaña, se
//     usa el iframe.
export function imprimirBitacora(datos) {
  const html = htmlBitacoraImprimible(datos)
  if (esIOS()) {
    const w = window.open('', '_blank')
    if (w) {
      w.document.open()
      w.document.write(html)
      w.document.close()
      w.addEventListener('afterprint', () => w.close())
      setTimeout(() => { w.focus(); w.print() }, 300)
      return
    }
  }
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' })
  document.body.appendChild(iframe)
  const quitar = () => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe) }
  const win = iframe.contentWindow
  const d = win.document
  d.open()
  d.write(html)
  d.close()
  win.addEventListener('afterprint', () => setTimeout(quitar, 0))
  // Respaldo por si el navegador no dispara afterprint.
  setTimeout(quitar, 60000)
  win.focus()
  win.print()
}
