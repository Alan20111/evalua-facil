// Fuentes del Asistente IA — apartado "Fuentes" de la pestaña Asistente IA
// (FASE 2-BIS del Plan Maestro de IA). A diferencia de utils/fuentesIA.js
// (fuentes efímeras adjuntas a UNA operación puntual), estas se guardan una
// sola vez por Asignatura y se reutilizan después. Reusa la misma subida a
// Cloudinary y los mismos límites de tipo/tamaño que utils/fuentesIA.js — no
// se crea una segunda infraestructura de archivos.

export function extensionDeArchivo(nombre) {
  const m = /\.([a-z0-9]+)$/i.exec(nombre || '')
  return m ? m[1].toLowerCase() : ''
}

export function tipoFuentePermitido(nombre) {
  return ['pdf', 'doc', 'docx'].includes(extensionDeArchivo(nombre))
}

// El apartado "Diagnóstico del grupo" se habilita únicamente cuando existen
// fuentes iniciales GENERALES (nunca por fuentes de un parcial en particular)
// — regla explícita del Plan Maestro (FASE 2-BIS, apartado 2).
export function hayFuentesGenerales(fuentes) {
  return (Array.isArray(fuentes) ? fuentes : []).some((f) => f?.ubicacion === 'general')
}
