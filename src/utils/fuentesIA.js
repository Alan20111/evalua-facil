// Fuentes de referencia compartidas (11-ago-2026) — hasta 3 archivos PDF/Word
// que el docente puede adjuntar a varias operaciones de IA (OP-03/OP-04,
// OP-09, OP-05) para que el modelo los use como base de contenido. Antes
// vivía duplicado dentro de CrearEvaluacionIAModal.jsx; este util y
// FuentesIAInput.jsx son el único lugar donde se sube y valida.

import { uploadToCloudinary } from './cloudinary'

export const MAX_FUENTES = 3
export const MAX_FUENTE_BYTES = 15 * 1024 * 1024 // mismo criterio que MAX_ATTACH en EntregableEditor.jsx
export const FUENTES_ACCEPT = '.pdf,.doc,.docx'

/** Sube en paralelo y devuelve [{url, nombre, tamano}] — mismo folder que la Fase 1. */
export async function subirFuentes(files) {
  return Promise.all((files || []).map(async (f) => ({
    url: await uploadToCloudinary(f, 'evalua-facil/ia-fuentes'),
    nombre: f.name,
    tamano: f.size,
  })))
}
