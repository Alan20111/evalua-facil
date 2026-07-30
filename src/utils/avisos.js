// Avisos: comunicados de solo-informar del docente a todo el grupo. A
// propósito NO es un chat — sin respuestas, comentarios ni adjuntos — así
// que el modelo de datos es el más simple posible: un doc por aviso, sin
// hilos ni relaciones entre ellos. Compartido entre AvisosTab.jsx (docente,
// lee y escribe) y SubjectPage.jsx del alumno (solo lee) para no acoplar el
// bundle del alumno al componente de edición del docente.
//
// Emoji y título se guardan DENTRO de cada aviso al publicarlo (no una
// referencia viva a la plantilla) — si el docente después edita, reordena o
// borra su plantilla, los avisos ya publicados con ella no deben cambiar de
// ícono ni de título retroactivamente. `tipo` se conserva solo por
// compatibilidad con avisos viejos (antes de que existieran las plantillas
// personalizables) y para el enum pedido en el modelo de datos original.
export const AVISO_TIPOS = [
  { key: 'NO_CLASE', emoji: '🚫', label: 'No habrá clase', titulo: 'No habrá clase' },
  { key: 'CAMBIO_HORARIO', emoji: '🕒', label: 'Cambio de horario', titulo: 'Cambio de horario' },
  { key: 'CAMBIO_SALON', emoji: '🚪', label: 'Cambio de salón', titulo: 'Cambio de salón' },
  { key: 'CAMBIO_FECHA', emoji: '📅', label: 'Cambio de fecha de entrega', titulo: 'Cambio de fecha de entrega' },
  { key: 'ACTIVIDAD_PUBLICADA', emoji: '📄', label: 'Actividad publicada', titulo: 'Actividad publicada' },
  { key: 'MATERIAL_APOYO', emoji: '📚', label: 'Material de apoyo disponible', titulo: 'Material de apoyo disponible' },
  { key: 'CALIFICACIONES', emoji: '📊', label: 'Calificaciones publicadas', titulo: 'Calificaciones publicadas' },
  { key: 'EXAMEN', emoji: '📝', label: 'Examen próximo', titulo: 'Examen próximo' },
  { key: 'RECORDATORIO', emoji: '🔔', label: 'Recordatorio', titulo: 'Recordatorio' },
  { key: 'BIENVENIDA', emoji: '👋', label: 'Bienvenida al curso', titulo: 'Bienvenida al curso' },
  { key: 'FIN_CURSO', emoji: '🎓', label: 'Fin del curso', titulo: 'Fin del curso' },
  { key: 'OTRO', emoji: '✏️', label: 'Otro', titulo: 'Aviso' },
]

// Semilla de plantillas de un docente nuevo — se copian una sola vez a su
// banco personal (`avisoPlantillas`) la primera vez que abre "Nuevo aviso",
// para que desde el día uno pueda editarlas/reordenarlas/borrarlas en vez de
// partir de una lista fija sin dueño. Ver ensurePlantillasSeed en AvisosTab.jsx.
export const PLANTILLAS_SEED = AVISO_TIPOS.map((t, i) => ({
  emoji: t.emoji,
  label: t.label,
  mensaje: '',
  orden: i,
}))

// Paleta corta para elegir ícono de una plantilla — no es un picker de emoji
// completo (libraría externa, miles de opciones); son los que de verdad se
// usan en un salón de clases, curados a mano.
export const EMOJI_PALETTE = [
  '🚫', '🕒', '🚪', '📅', '📄', '📚', '📊', '📝', '🔔', '👋', '🎓', '✏️',
  '⚠️', '✅', '❌', '📌', '📢', '🎉', '🏫', '🧪', '💻', '🏃', '🩺', '🌡️',
]

export function avisoTipoInfo(tipo) {
  return AVISO_TIPOS.find((t) => t.key === tipo) || AVISO_TIPOS[AVISO_TIPOS.length - 1]
}

// `a.emoji`/`a.titulo` viven en el propio aviso desde que existen plantillas
// personalizables — este helper es el fallback para avisos publicados ANTES
// de ese cambio, que solo guardaban `tipo`.
export function avisoEmoji(a) {
  return a?.emoji || avisoTipoInfo(a?.tipo).emoji
}

export function formatAvisoFecha(ts) {
  if (!ts?.toDate) return ''
  return ts.toDate().toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Id determinístico de `avisoLecturas` — un doc por (aviso, estudiante), para
// que confirmar "Entendido" dos veces (doble tap, reintento de red) actualice
// el mismo registro en vez de crear duplicados.
export function lecturaDocId(avisoId, studentId) {
  return `${avisoId}_${studentId}`
}
