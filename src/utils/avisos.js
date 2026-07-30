// Avisos: comunicados de solo-informar del docente a todo el grupo. A
// propósito NO es un chat — sin respuestas, comentarios ni adjuntos — así
// que el modelo de datos es el más simple posible: un doc por aviso, sin
// hilos ni relaciones entre ellos. Compartido entre AvisosTab.jsx (docente,
// lee y escribe) y SubjectPage.jsx del alumno (solo lee) para no acoplar el
// bundle del alumno al componente de edición del docente.
export const AVISO_TIPOS = [
  { key: 'NO_CLASE', emoji: '🚫', label: 'No habrá clase', titulo: 'No habrá clase' },
  { key: 'CAMBIO_HORARIO', emoji: '🕒', label: 'Cambio de horario', titulo: 'Cambio de horario' },
  { key: 'CAMBIO_SALON', emoji: '🚪', label: 'Cambio de salón', titulo: 'Cambio de salón' },
  { key: 'CAMBIO_FECHA', emoji: '📅', label: 'Cambio de fecha de entrega', titulo: 'Cambio de fecha de entrega' },
  { key: 'ACTIVIDAD_PUBLICADA', emoji: '📄', label: 'Actividad publicada', titulo: 'Actividad publicada' },
  { key: 'MATERIAL_APOYO', emoji: '📚', label: 'Material de apoyo disponible', titulo: 'Material de apoyo disponible' },
  { key: 'CALIFICACIONES', emoji: '📊', label: 'Calificaciones publicadas', titulo: 'Calificaciones publicadas' },
  { key: 'EXAMEN', emoji: '📝', label: 'Examen próximo', titulo: 'Examen próximo' },
  { key: 'RECORDATORIO', emoji: '🔔', label: 'Recordatorio', titulo: '' },
  { key: 'BIENVENIDA', emoji: '👋', label: 'Bienvenida al curso', titulo: 'Bienvenida al curso' },
  { key: 'FIN_CURSO', emoji: '🎓', label: 'Fin del curso', titulo: 'Fin del curso' },
  { key: 'OTRO', emoji: '✏️', label: 'Otro', titulo: '' },
]

export function avisoTipoInfo(tipo) {
  return AVISO_TIPOS.find((t) => t.key === tipo) || AVISO_TIPOS[AVISO_TIPOS.length - 1]
}

export function formatAvisoFecha(ts) {
  if (!ts?.toDate) return ''
  return ts.toDate().toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
