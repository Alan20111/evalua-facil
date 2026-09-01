// Fuente de verdad ÚNICA de la Planeación Didáctica de una asignatura
// (1-sep-2026, autorizado por Kike).
//
// REGLA DE NEGOCIO ABSOLUTA: cada asignatura tiene UNA SOLA planeación
// vigente, y esa planeación tiene exactamente UN origen:
//
//   · 'ia'      → la generó Evalúa Fácil (contenido estructurado por parcial)
//   · 'archivo' → la subió el docente en PDF o Word (.docx)
//
// Las dos viven en el MISMO campo (`subjects/{id}.planeacionAceptada`), no en
// campos paralelos: por construcción no existe ningún estado en el que una
// asignatura tenga las dos vigentes a la vez. No es la interfaz la que oculta
// una — es que no caben dos.
//
// DOS CONCEPTOS DISTINTOS, que antes de hoy estaban mezclados:
//
//   · PLANEACIÓN VIGENTE          → esto, `planeacionAceptada`. Lo único que
//                                   consulta cualquier flujo que necesite
//                                   "la planeación de esta asignatura".
//   · GENERACIÓN IA PENDIENTE     → el último documento de la subcolección
//                                   `planeacionesIA`, cuando todavía no se ha
//                                   aceptado. Es un borrador de la IA, NO una
//                                   planeación vigente.
//
// Hasta hoy la vigencia se derivaba comparando `planeacionAceptada.planeacionId`
// contra la generación más reciente (`historial[0].id`), lo que ataba la
// existencia de una planeación al hecho de venir de la IA. Con la planeación
// propia del docente eso ya no se sostiene: no hay generación con la cual
// comparar. Nadie debe volver a decidir vigencia mirando `planeacionesIA`.
//
// `planeacionesIA` sigue siendo la bitácora inmutable de generaciones de IA y
// conserva esa semántica: el archivo del docente NUNCA se guarda ahí.

// Solo PDF y Word moderno. El .doc binario antiguo queda fuera a propósito:
// tampoco lo puede leer functions/docExtract.js, así que aceptarlo aquí sería
// prometer algo que el resto del sistema no puede cumplir después.
export const PLANEACION_EXTS = ['pdf', 'docx']
export const PLANEACION_ACCEPT = '.pdf,.docx'
// Mismo criterio que la Fuente Principal (ProgramaEstudiosSection) y las
// Fuentes del curso (utils/fuentesIA) — un solo número para todo el módulo.
export const PLANEACION_MAX_BYTES = 15 * 1024 * 1024
export const PLANEACION_CARPETA = 'evalua-facil/planeaciones-docente'

export function extensionPlaneacion(nombre) {
  const limpio = String(nombre || '').split('?')[0]
  const partes = limpio.split('.')
  return partes.length > 1 ? partes.pop().toLowerCase() : ''
}

/**
 * Valida el archivo que el docente eligió como su planeación. Devuelve el
 * mensaje de error para el docente, o null si el archivo es válido.
 */
export function validarArchivoPlaneacion(file) {
  if (!file) return 'Elige un archivo.'
  const ext = extensionPlaneacion(file.name)
  if (ext === 'doc') {
    return 'No podemos leer los archivos .doc antiguos. Guárdalo como .docx o PDF y vuelve a subirlo.'
  }
  if (!PLANEACION_EXTS.includes(ext)) {
    return 'La planeación debe ser PDF o Word (.docx).'
  }
  if (!file.size) return 'El archivo está vacío (0 bytes).'
  if (file.size > PLANEACION_MAX_BYTES) return 'El archivo pesa más de 15 MB.'
  return null
}

/**
 * La ÚNICA puerta para saber cuál es la planeación vigente de una asignatura.
 * Recibe los datos del documento `subjects/{id}` y devuelve:
 *
 *   null                                        → no hay planeación vigente
 *   { origen: 'ia', ...contenido estructurado } → la generó Evalúa Fácil
 *   { origen: 'archivo', archivo: {...} }       → la subió el docente
 *
 * RETROCOMPATIBILIDAD: los registros escritos antes de hoy no traen `origen`.
 * Todos ellos vienen del flujo de IA (era el único que existía), así que la
 * ausencia del campo se interpreta como 'ia'. No hace falta ninguna migración.
 * Cualquier valor que no sea exactamente 'archivo' se trata como 'ia', para
 * que un dato inesperado nunca deje al docente sin su planeación.
 */
export function planeacionVigente(subjectData) {
  const guardada = subjectData?.planeacionAceptada
  if (!guardada) return null

  if (guardada.origen === 'archivo') {
    // Sin URL no hay nada que mostrar ni que descargar: se trata como si no
    // hubiera planeación, en vez de dejar una tarjeta rota que el docente no
    // puede quitar.
    if (!guardada.archivo?.url) return null
    return {
      origen: 'archivo',
      aceptadaEn: guardada.aceptadaEn || null,
      archivo: guardada.archivo,
    }
  }

  return {
    origen: 'ia',
    aceptadaEn: guardada.aceptadaEn || null,
    planeacionId: guardada.planeacionId || null,
    datosIdentificacion: guardada.datosIdentificacion || null,
    fuentesInformacion: guardada.fuentesInformacion || null,
    validacion: guardada.validacion || null,
    // Los registros más viejos guardaban solo el puntero, sin el contenido:
    // ahí `porParcial` viene vacío y quien lo consuma debe caer al documento
    // de `planeacionesIA` con ese `planeacionId` (ver PlaneacionInicialSection).
    porParcial: Array.isArray(guardada.porParcial) ? guardada.porParcial : [],
  }
}
