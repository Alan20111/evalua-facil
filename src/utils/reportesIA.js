// Reportes de contenido generado por IA (docs/PLAN_GOOGLE_PLAY.md, B2).
//
// La política de IA generativa de Google Play exige que quien ve una
// respuesta de la IA pueda reportarla sin salir de la app. Cada reporte es
// un documento de `reportesIA` que solo crea su autor y solo lee el admin
// (firestore.rules). Los límites de aquí son los mismos que validan las
// reglas: si cambian, cambian en los dos lados.
//
// Desde el 24-oct-2026 el reporte también dice DÓNDE pasó: la clave fija de
// la pantalla (`ubicacion`, ver UBICACIONES_REPORTE_IA en catalogoReportes.js),
// la ruta sin ids y los ids que esa pantalla tenía a mano. Los nombres reales
// (asignatura, actividad, alumno) no los manda la app: los busca el servidor
// (functions/avisosReportes.js) y comprueba que sean de quien reporta.
import { collection, serverTimestamp } from 'firebase/firestore'
import { addDoc } from './firestoreGuard'
import { db } from '../firebase'
import { idsDeRuta, rutaSinIds } from './sugerencias'

export { MOTIVOS_REPORTE_IA } from './catalogoReportes'

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

function idCorto(valor) {
  return typeof valor === 'string' && valor ? valor.slice(0, LARGO_MAX_CAMPO_CORTO) : ''
}

// Campos de ubicación del reporte. Los ids que pasa la pantalla mandan; si no
// trae ninguno, se usan los que dice la URL (/subject/:id, /activity/:id).
// Un campo vacío no se manda: las reglas los aceptan ausentes.
export function camposDeUbicacion({ ubicacion, asignaturaId, actividadId, entregaId, pathname }) {
  const propios = { asignaturaId: idCorto(asignaturaId), actividadId: idCorto(actividadId), entregaId: idCorto(entregaId) }
  const ids = propios.asignaturaId || propios.actividadId || propios.entregaId ? propios : idsDeRuta(pathname)
  const campos = { ruta: rutaSinIds(pathname) }
  if (typeof ubicacion === 'string' && /^[a-z0-9_]{1,60}$/.test(ubicacion)) campos.ubicacion = ubicacion
  for (const [k, v] of Object.entries(ids)) if (idCorto(v)) campos[k] = idCorto(v)
  return campos
}

export async function enviarReporteIA({ uid, rol, operacion, contextoId, contenido, motivo, comentario, ubicacion, asignaturaId, actividadId, entregaId, pathname }) {
  await addDoc(collection(db, 'reportesIA'), {
    uid,
    rol,
    operacion: String(operacion || 'desconocida').slice(0, LARGO_MAX_CAMPO_CORTO),
    contextoId: String(contextoId || '').slice(0, LARGO_MAX_CAMPO_CORTO),
    texto: textoParaReporte(contenido),
    motivo,
    comentario: String(comentario || '').trim().slice(0, LARGO_MAX_COMENTARIO_REPORTE),
    ...camposDeUbicacion({ ubicacion, asignaturaId, actividadId, entregaId, pathname }),
    estado: 'nuevo',
    creadoEn: serverTimestamp(),
  })
}
