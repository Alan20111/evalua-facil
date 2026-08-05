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

// Desde cuándo le tocan los avisos a una inscripción (en segundos epoch, o
// null si no se puede saber). Un aviso publicado antes de este momento NO le
// corresponde a ese estudiante: no lo ve en la pestaña Avisos ni se le exige
// confirmarlo en el modal de lectura obligatoria (AvisosGate).
//
// Es el MÁXIMO de las dos marcas de tiempo porque cada camino de alta deja una
// distinta, y la buena siempre es la más tardía:
//   · `createdAt`  — cuándo el docente lo dio de alta en la lista.
//   · `activadoAt` — cuándo el estudiante activó su cuenta (Activation.jsx).
// Un alumno dado de alta en agosto que activa en octubre NO debe recibir de
// golpe los avisos de esos dos meses: hasta que activó, la asignatura no
// existía para él. Y al revés, un alumno que YA tenía cuenta y el docente
// agrega a una materia nueva no trae `activadoAt` en esa inscripción (entra ya
// activada, ver studentIdentity.js) — ahí manda `createdAt`, que es justo el
// momento en que la materia apareció en su cuenta.
export function avisosDesde(enrollment) {
  const alta = enrollment?.createdAt?.seconds
  const activacion = enrollment?.activadoAt?.seconds
  if (alta == null && activacion == null) return null
  return Math.max(alta ?? 0, activacion ?? 0)
}

// Id determinístico de `avisoLecturas` — un doc por (aviso, estudiante), para
// que confirmar "Entendido" dos veces (doble tap, reintento de red) actualice
// el mismo registro en vez de crear duplicados.
export function lecturaDocId(avisoId, studentId) {
  return `${avisoId}_${studentId}`
}

// Mismo esquema de id para `avisoGuardados` — el "guardar" del alumno es
// personal (varios alumnos comparten el mismo doc de aviso, a diferencia del
// docente donde `guardado` vive directo en el aviso porque hay un solo
// dueño), así que es su propia colección con un doc por (aviso, estudiante).
export function guardadoDocId(avisoId, studentId) {
  return `${avisoId}_${studentId}`
}

// Mismo esquema de id para `avisoOcultos` — "eliminar" un aviso del lado del
// alumno no puede borrar el doc real (es del docente, y lo comparten todos
// sus compañeros): es una marca personal de "ya no lo quiero ver", el mismo
// patrón que avisoGuardados pero en sentido contrario.
export function ocultoDocId(avisoId, studentId) {
  return `${avisoId}_${studentId}`
}
