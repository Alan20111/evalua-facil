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

// Criterio para saber si un File que el docente va a adjuntar en una
// operación puntual (OP-03/04/05/09, FuentesIAInput) YA es una fuente
// guardada en Config Asistente IA — nombre + tamaño en bytes no bastan por
// separado (dos archivos distintos pueden compartir nombre, o el mismo
// nombre puede reeditarse con otro contenido), así que exige los tres:
// nombre + tamaño exacto + tipo. No hay hash de contenido disponible: ni
// fuentesAsignatura ni uploadToCloudinary (utils/cloudinary.js) guardan uno.
export function esMismaFuente(file, guardada) {
  return !!guardada
    && guardada.nombre?.trim().toLowerCase() === file.name.trim().toLowerCase()
    && guardada.tamano === file.size
    && guardada.tipo === extensionDeArchivo(file.name)
}

// Tope de la BIBLIOTECA de cada grupo (Fuentes para todo el curso, o cada
// parcial) — decisión de Kike, 12-ago-2026: de 1 a 10 documentos por grupo.
// Distinto del límite por carga (utils/fuentesIA.js MAX_FUENTES = 3, cuántos
// archivos se pueden elegir en una sola subida).
export const MAX_FUENTES_POR_GRUPO = 10

// El apartado "Diagnóstico del grupo" se habilita únicamente cuando existen
// fuentes iniciales GENERALES (nunca por fuentes de un parcial en particular)
// — regla explícita del Plan Maestro (FASE 2-BIS, apartado 2).
export function hayFuentesGenerales(fuentes) {
  return (Array.isArray(fuentes) ? fuentes : []).some((f) => f?.ubicacion === 'general')
}
