// Bitácora de créditos IA del docente — lógica pura (sin Firebase ni React).
//
// Los movimientos (`iaMovimientos/{id}`) los escribe SOLO el ledger del
// servidor (functions/creditosLedger.js) dentro de la transacción que mueve el
// saldo. Aquí solo se interpretan para mostrarlos: texto, orden, filtros y
// paginación por mes. Nada de esto calcula ni toca saldos.
//
// Tipos: consumo · compra · bienvenida · ajuste.
// Estados: en_proceso · aplicado · sin_cobro (con `motivoCodigo`).
// `saldoDespues` puede faltar (registros importados del historial anterior,
// que nunca lo guardaron): entonces no se muestra, no se inventa.

const ZONA = 'America/Mexico_City'

// Nombre de cada operación para el docente. Si llega una operación nueva que
// aún no está aquí, se usa su categoría (ya pensada para el docente).
const OPERACIONES = {
  aviso: 'Aviso con IA',
  rubrica: 'Rúbrica con IA',
  cotejo: 'Lista de cotejo con IA',
  reactivos: 'Reactivos con IA',
  crear_evaluacion_ia: 'Evaluación creada con IA',
  calificar_abierta: 'Calificación de respuesta abierta',
  calificar_entregable_ia: 'Calificación de entregable con IA',
  calificar_entregable_ia_imagenes: 'Calificación de entregable (imágenes) con IA',
  calificar_entregable_ia_lote: 'Calificación de entregables en lote',
  calificar_entregable_ia_lote_imagenes: 'Calificación de entregables (imágenes) en lote',
  crear_actividad_ia: 'Actividad creada con IA',
  generar_preguntas_video: 'Preguntas de video con IA',
  generar_contenido_juego: 'Crucigrama o sopa de letras',
  planeacion_didactica_inicial: 'Planeación didáctica con IA',
  planeacion_formato_oficial: 'Planeación en formato oficial',
  analizar_resultados: 'Análisis de resultados',
  analizar_entregable: 'Análisis de entregable',
  analizar_asignatura: 'Análisis de asignatura',
  diagnostico_contexto: 'Diagnóstico de contexto',
  diagnostico_conocimientos: 'Diagnóstico de conocimientos',
  chat_asistente: 'Chat con Asistente',
  chat_crear_actividad: 'Actividad creada desde el chat',
  chat_crear_examen: 'Examen creado desde el chat',
}

const TIPOS = {
  compra: 'Compra de créditos',
  bienvenida: 'Créditos de bienvenida',
  ajuste: 'Ajuste de Evalúa Fácil',
}

const MOTIVOS_SIN_COBRO = {
  fallido: 'La operación no se completó',
  expirado: 'La operación expiró',
  cancelado: 'La operación se canceló',
}

export function tituloMovimiento(m) {
  if (m.tipo === 'consumo') return OPERACIONES[m.operacion] || m.categoria || 'Operación de IA'
  return TIPOS[m.tipo] || 'Movimiento de créditos'
}

// Línea secundaria: el estado cuando no es un cobro normal. «Sin cobro» deja
// claro que NO se descontó nada (la operación falló o expiró).
export function detalleMovimiento(m) {
  if (m.estado === 'en_proceso') return 'En proceso'
  if (m.estado === 'sin_cobro') return `${MOTIVOS_SIN_COBRO[m.motivoCodigo] || 'La operación no se completó'} · No se descontó nada`
  return null
}

// Chat con Asistente sin costo: ruido en el historial, se oculta por defecto.
export function esRuido(m) {
  return m.operacion === 'chat_asistente' && !m.delta
}

export const FILTROS = [
  { id: 'todos', etiqueta: 'Todos' },
  { id: 'consumos', etiqueta: 'Consumos' },
  { id: 'recargas', etiqueta: 'Recargas y ajustes' },
]

export function millisDe(t) {
  if (!t) return 0
  if (typeof t.toMillis === 'function') return t.toMillis()
  if (typeof t.seconds === 'number') return t.seconds * 1000
  return 0
}

// Más reciente primero. Sin orderBy en Firestore (regla del proyecto): se
// ordena aquí.
export function prepararMovimientos(movs, { filtro = 'todos', mostrarChatSinCosto = false } = {}) {
  return movs
    .filter((m) => (mostrarChatSinCosto ? true : !esRuido(m)))
    .filter((m) => (filtro === 'consumos' ? m.tipo === 'consumo' : filtro === 'recargas' ? m.tipo !== 'consumo' : true))
    .sort((a, b) => millisDe(b.fecha) - millisDe(a.fecha))
}

// ── Periodos «AAAA-MM» en hora de México (misma llave que escribe el ledger) ──
export function periodoDe(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit' }).formatToParts(fecha)
  return `${partes.find((p) => p.type === 'year').value}-${partes.find((p) => p.type === 'month').value}`
}

export function desplazarPeriodo(periodo, meses) {
  const [a, m] = periodo.split('-').map(Number)
  const total = a * 12 + (m - 1) + meses
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

export function etiquetaPeriodo(periodo) {
  const [a, m] = periodo.split('-').map(Number)
  const texto = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export function formatoFechaMovimiento(t) {
  const ms = millisDe(t)
  if (!ms) return ''
  return new Date(ms).toLocaleString('es-MX', { timeZone: ZONA, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
