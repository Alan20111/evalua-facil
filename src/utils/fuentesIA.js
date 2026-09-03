// Fuentes de referencia compartidas (11-ago-2026) — hasta 3 archivos PDF/Word
// que el docente puede adjuntar a varias operaciones de IA (OP-03/OP-04,
// OP-09, OP-05) para que el modelo los use como base de contenido. Antes
// vivía duplicado dentro de CrearEvaluacionIAModal.jsx; este util y
// FuentesIAInput.jsx son el único lugar donde se sube y valida.

import { uploadToCloudinary } from './cloudinary'

export const MAX_FUENTES = 3
export const MAX_FUENTE_BYTES = 15 * 1024 * 1024 // mismo criterio que MAX_ATTACH en EntregableEditor.jsx
// `.doc` (Word anterior a 2007) NO está: es un binario que mammoth no lee, así
// que el servidor lo rechazaba SIEMPRE — ofrecerlo en el selector solo servía
// para que el docente perdiera el viaje. Se le pide convertir a .docx o PDF.
export const FUENTES_ACCEPT = '.pdf,.docx'

/** Sube en paralelo y devuelve [{url, nombre, tamano}] — mismo folder que la Fase 1. */
export async function subirFuentes(files) {
  return Promise.all((files || []).map(async (f) => ({
    url: await uploadToCloudinary(f, 'evalua-facil/ia-fuentes'),
    nombre: f.name,
    tamano: f.size,
  })))
}

/**
 * Igual que subirFuentes, pero acepta la lista mixta que arma FuentesIAInput:
 * File (hay que subirlo) u objetos { storedUrl } (ya reutiliza una fuente
 * guardada en Fuentes de la Asignatura, ver useFuentesAsignatura — no se
 * vuelve a subir una copia a Cloudinary). Devuelve las URLs en el mismo orden.
 */
/**
 * Muestra como ADVERTENCIA (no error) los documentos que el servidor no pudo
 * usar, cuando la operación sí salió adelante con el resto del material.
 * Antes esto no existía: o se abortaba todo, o el documento se descartaba en
 * silencio — y ese silencio es lo que mantuvo escondido durante semanas que
 * un PDF escaneado nunca llegaba al modelo.
 */
export function avisarFuentesOmitidas(toast, avisos) {
  const lista = Array.isArray(avisos) ? avisos : []
  if (!lista.length) return
  const cabeza = lista.length === 1
    ? 'Un documento no se pudo usar'
    : `${lista.length} documentos no se pudieron usar`
  toast(`${cabeza}: ${lista[0].motivo}`, 'warning')
}

export async function resolverFuentes(archivos) {
  const items = archivos || []
  const paraSubir = items.filter((a) => a instanceof File)
  const subidas = await subirFuentes(paraSubir)
  let i = 0
  return items.map((a) => (a instanceof File ? subidas[i++].url : a.storedUrl))
}
