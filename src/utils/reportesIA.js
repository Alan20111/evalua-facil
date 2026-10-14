// Reportes de contenido generado por IA (docs/PLAN_GOOGLE_PLAY.md, B2).
//
// La política de IA generativa de Google Play exige que quien ve una
// respuesta de la IA pueda reportarla sin salir de la app. Cada reporte es
// un documento de `reportesIA` que solo crea su autor y solo lee el admin
// (firestore.rules). Los límites de aquí son los mismos que validan las
// reglas: si cambian, cambian en los dos lados.
import { collection, serverTimestamp } from 'firebase/firestore'
import { addDoc } from './firestoreGuard'
import { db } from '../firebase'

export const MOTIVOS_REPORTE_IA = [
  { value: 'inapropiado', label: 'Ofensivo o inapropiado', hint: 'Lenguaje, temas o imágenes que no van en un salón de clases.' },
  { value: 'incorrecto', label: 'Incorrecto o inventado', hint: 'Datos falsos, errores de contenido o una calificación sin sentido.' },
  { value: 'otro', label: 'Otro problema' },
]

export const LARGO_MAX_TEXTO_REPORTE = 4000
export const LARGO_MAX_COMENTARIO_REPORTE = 1000
const LARGO_MAX_CAMPO_CORTO = 120

// Una respuesta de la IA puede ser un texto o un objeto (rúbrica, preguntas):
// se guarda como texto, recortado, para que el admin vea lo que vio el usuario.
export function textoParaReporte(contenido) {
  if (contenido == null) return ''
  const texto = typeof contenido === 'string' ? contenido : JSON.stringify(contenido, null, 1)
  return texto.slice(0, LARGO_MAX_TEXTO_REPORTE)
}

export async function enviarReporteIA({ uid, rol, operacion, contextoId, contenido, motivo, comentario }) {
  await addDoc(collection(db, 'reportesIA'), {
    uid,
    rol,
    operacion: String(operacion || 'desconocida').slice(0, LARGO_MAX_CAMPO_CORTO),
    contextoId: String(contextoId || '').slice(0, LARGO_MAX_CAMPO_CORTO),
    texto: textoParaReporte(contenido),
    motivo,
    comentario: String(comentario || '').trim().slice(0, LARGO_MAX_COMENTARIO_REPORTE),
    estado: 'nuevo',
    creadoEn: serverTimestamp(),
  })
}
