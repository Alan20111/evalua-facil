// Catálogo de los Reportes de IA y de las Sugerencias a Evalúa Fácil.
//
// Lógica PURA (sin Firebase ni React): la usan la app (ventanas de envío y
// panel del admin) y la Cloud Function que avisa por correo
// (functions/avisosReportes.js, vía scripts/sync-functions-shared.mjs). Así
// la etiqueta que ve el admin en el panel y la del correo son la misma.
//
// Los VALORES (`value`, claves de ubicación) son los que validan las reglas
// de `reportesIA` y `sugerencias` en firestore.rules: si cambian, cambian en
// los dos lados.

import { NOMBRES_OPERACIONES } from './movimientosCreditos.js'

// ── Reportes de IA ──────────────────────────────────────────────────────────

export const MOTIVOS_REPORTE_IA = [
  { value: 'inapropiado', label: 'Ofensivo o inapropiado', hint: 'Lenguaje, temas o imágenes que no van en un salón de clases.' },
  { value: 'incorrecto', label: 'Incorrecto o inventado', hint: 'Datos falsos, errores de contenido o una calificación sin sentido.' },
  { value: 'otro', label: 'Otro problema' },
]

// Operaciones que se pueden reportar pero no cobran créditos, así que no
// están en el catálogo de movimientos.
const OPERACIONES_SOLO_REPORTE = {
  chat_asistente: 'Chat asistente con IA',
  catalogo: 'Catálogo de componentes (prueba interna)',
}

// Dónde está cada botón «Reportar». La clave la manda la pantalla; el
// módulo y la pantalla son lo que lee el admin. Una clave que no esté aquí
// (un cliente más nuevo, o uno viejo) se muestra tal cual: no se adivina.
export const UBICACIONES_REPORTE_IA = {
  revision_entrega: { modulo: 'Evaluación de actividades', pantalla: 'Revisión de una entrega · Calificar con IA' },
  calificar_respuesta_abierta: { modulo: 'Exámenes y cuestionarios', pantalla: 'Calificación de una respuesta abierta' },
  rubrica_editor: { modulo: 'Instrumentos de evaluación', pantalla: 'Editor de rúbrica' },
  cotejo_editor: { modulo: 'Instrumentos de evaluación', pantalla: 'Editor de lista de cotejo' },
  reactivos_revision: { modulo: 'Exámenes y cuestionarios', pantalla: 'Revisión de reactivos generados' },
  juego_contenido: { modulo: 'Juegos', pantalla: 'Crucigrama o sopa de letras' },
  video_preguntas: { modulo: 'Video interactivo', pantalla: 'Preguntas propuestas para el video' },
  planeacion_inicial: { modulo: 'Planeación didáctica', pantalla: 'Planeación de la asignatura' },
  analisis_resultados: { modulo: 'Análisis con IA', pantalla: 'Análisis de resultados de una actividad' },
  informe_asignatura: { modulo: 'Análisis con IA', pantalla: 'Informe de la asignatura' },
  chat_asistente: { modulo: 'Asistente', pantalla: 'Chat asistente' },
  catalogo: { modulo: 'Desarrollo', pantalla: 'Catálogo de componentes' },
}

export function nombreOperacionIA(operacion) {
  const clave = String(operacion || '')
  return OPERACIONES_SOLO_REPORTE[clave] || NOMBRES_OPERACIONES[clave] || clave || 'Operación sin nombre'
}

// null cuando el reporte no trae ubicación (los anteriores al 24-oct-2026).
export function describirUbicacionIA(clave) {
  if (!clave) return null
  return UBICACIONES_REPORTE_IA[clave] || { modulo: '', pantalla: String(clave) }
}

export function etiquetaMotivoIA(motivo) {
  return MOTIVOS_REPORTE_IA.find((m) => m.value === motivo)?.label || String(motivo || '')
}

// ── Sugerencias a Evalúa Fácil ──────────────────────────────────────────────

export const CATEGORIAS_SUGERENCIA = [
  { value: 'error_tecnico', label: 'Error técnico', hint: 'Un mensaje de error, una pantalla en blanco o algo que se trabó.' },
  { value: 'funcionamiento', label: 'Problema de funcionamiento', hint: 'Un botón que no responde o un resultado distinto al esperado.' },
  { value: 'visualizacion', label: 'Problema de visualización o navegación', hint: 'Textos cortados, elementos encimados o no encuentras a dónde ir.' },
  { value: 'dificultad', label: 'Dificultad para realizar una operación', hint: 'Sabes lo que quieres hacer, pero no cómo hacerlo.' },
  { value: 'mejora', label: 'Sugerencia de mejora', hint: 'Algo que te gustaría que Evalúa Fácil hiciera o hiciera mejor.' },
  { value: 'otro', label: 'Otro' },
]

export function etiquetaCategoriaSugerencia(categoria) {
  return CATEGORIAS_SUGERENCIA.find((c) => c.value === categoria)?.label || String(categoria || '')
}

// Moderación automática (functions/moderacionSugerencias.js). «Posible»: el
// detector solo sugiere; quien decide es una persona.
const MOTIVOS_MODERACION = {
  amenaza: 'posible amenaza',
  acoso: 'posible acoso',
  insulto: 'posible insulto',
  groseria: 'posible grosería',
}

// La sugerencia necesita revisión humana antes de leerse como cualquier otra:
// la retuvo el detector o el detector no pudo revisarla. Las que nunca pasaron
// por el detector (anteriores a él) no se tratan como retenidas.
export function sugerenciaRetenida(s) {
  const estado = s?.moderacion?.estado
  return estado === 'retenida' || estado === 'sin_revisar'
}

export function textoMotivosModeracion(moderacion) {
  if (moderacion?.estado === 'sin_revisar') return 'sin revisión automática'
  const motivos = (moderacion?.motivos || []).map((m) => MOTIVOS_MODERACION[m] || m)
  return motivos.join(', ') || 'posible lenguaje ofensivo'
}

// ── Los dos ─────────────────────────────────────────────────────────────────

// revisado = alguien lo leyó · resuelto = se corrigió o se atendió.
export const ESTADOS_REPORTE = [
  { value: 'nuevo', label: 'Nuevo' },
  { value: 'revisado', label: 'Revisado' },
  { value: 'resuelto', label: 'Resuelto' },
  { value: 'descartado', label: 'Descartado' },
]

export function etiquetaEstadoReporte(estado) {
  return ESTADOS_REPORTE.find((e) => e.value === estado)?.label || String(estado || '')
}

// Pestañas del panel del admin. El correo enlaza a `/Admin?tab=<tab>&caso=<id>`.
export const TAB_REPORTES_IA = 'reportesIA'
export const TAB_SUGERENCIAS = 'sugerencias'
