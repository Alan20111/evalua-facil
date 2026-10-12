// Constantes y funciones de SubjectPage.jsx (fase 5 de PLAN_NORMALIZACION_UI).
import { DEFAULT_FILE_TYPE } from '../../../config/fileTypes'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../../firebase'
import { studentFullName } from '../../../utils/studentSearch'

// ── Materiales de apoyo: ordenamiento robusto ─────────────────────────────
// Builds a unified ordered list of activities + positioned materials for one
// parcial. Activities occupy integer `orden` slots (1, 2, 3…); positioned
// materials (ordenManual:true) occupy fractional slots between them.
// Unpositioned materials (ordenManual absent/false) are appended at the end
// in their existing relative order, same as the current pre-drag behavior.
export function buildUnifiedParcial(acts, mats) {
  const positioned = mats.filter((m) => m.ordenManual)
  const unpositioned = mats
    .filter((m) => !m.ordenManual)
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))

  const items = [
    ...acts.map((a) => ({ type: 'activity', item: a })),
    ...positioned.map((m) => ({ type: 'material', item: m })),
  ].sort((a, b) => {
    const ka = a.item.orden ?? 0, kb = b.item.orden ?? 0
    if (ka !== kb) return ka - kb
    return a.type === 'activity' ? -1 : 1 // activity always before material on tie
  })

  return [...items, ...unpositioned.map((m) => ({ type: 'material', item: m }))]
}

// Computes fresh, clean fractional `orden` values for every material in the
// unified list. Values are always strictly between the surrounding activities'
// integer ordenes and are recomputed from scratch on every drop — no
// accumulation of floating-point errors across repeated moves.
//
// Formula: for k materials in a slot [prevActOrden, nextActOrden):
//   ordenⱼ = prevActOrden + (j+1) * (limit − prevActOrden) / (k+1)
// where limit = nextActOrden if it exists, or prevActOrden+1 (virtual boundary
// that keeps values strictly < prevActOrden+1, so they always precede any
// future activity that gets orden = prevActOrden+1).
export function computeMaterialOrdenes(unified) {
  const ordenByMatId = new Map()
  let slotMats = []
  let prevActOrden = 0

  function flushSlot(nextActOrden) {
    const k = slotMats.length
    if (k === 0) return
    const limit = nextActOrden ?? (prevActOrden + 1)
    slotMats.forEach((mat, j) => {
      ordenByMatId.set(mat.id, prevActOrden + (j + 1) * (limit - prevActOrden) / (k + 1))
    })
    slotMats = []
  }

  for (const item of unified) {
    if (item.type === 'activity') {
      flushSlot(item.item.orden)
      prevActOrden = item.item.orden
    } else {
      slotMats.push(item.item)
    }
  }
  flushSlot(null) // materials after the last activity use virtualNext = prevActOrden+1

  return ordenByMatId
}

// F-06: queries '==' individuales en lugar de 'in'. Ver el comentario en
// deleteSubjectCascade.js/fetchSubmissionsForActivities para la justificación.
export async function fetchSubmissionsForActivities(actIds) {
  if (actIds.length === 0) return []
  const snaps = await Promise.all(
    actIds.map((id) =>
      getDocs(query(collection(db, 'submissions'), where('actividadId', '==', id)))
    )
  )
  return snaps.flatMap((s) => s.docs)
}

// "Ana López, Beto Ruiz, Carla Díaz y 4 más" — para decir a quién se omitió.
export function nombresBreves(ids, students) {
  const nombres = ids.map((id) => studentFullName(students.find((s) => s.id === id)) || 'Un estudiante')
  return nombres.length <= 3 ? nombres.join(', ') : `${nombres.slice(0, 3).join(', ')} y ${nombres.length - 3} más`
}

export const EMPTY_FORM = { nombre: '', categoria: 'entregable', instrucciones: '', fechaLimite: '', recibirTarde: false, tiposArchivo: [DEFAULT_FILE_TYPE], extensionesCustom: '', oculta: false, publishAt: '', publishedAt: '', visibilidadMode: 'show', esEvaluacion: false }

// Defaults for a new evaluación's config — Cuestionario favors repeated
// practice (unlimited attempts, keep best); Examen favors a single formal
// attempt (1 try, keep last). The teacher can change all of this afterward.
export const EVALUACION_DEFAULTS = {
  cuestionario: {
    numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'libre',
    tiempoLimiteMin: null, intentosPermitidos: null, conservar: 'mejor',
    publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
    mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
  },
  examen: {
    numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'secuencial',
    tiempoLimiteMin: 30, intentosPermitidos: 1, conservar: 'ultimo',
    publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
    mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
  },
}

export function formatResourceDate(ts) {
  if (!ts?.toDate) return ''
  return ts.toDate().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Resources are course material (PDFs, decks, spreadsheets), typically
// heavier than a single submission file — a higher cap than the 5 MB used
// for student deliveries (src/pages/student/ActivityPage.jsx).
export const MAX_RESOURCE_SIZE = 15 * 1024 * 1024

// Shared by "Material de apoyo" files AND activity-instruction attachments:
// both allow any file type (no extension whitelist, unlike the Recursos tab)
// and any number of files — only the per-file size is capped, same ceiling
// already proven for the Recursos tab's Cloudinary preset.
export const MAX_ATTACHMENT_FILE_SIZE = 15 * 1024 * 1024

export const EMPTY_MATERIAL_FORM = { nombre: '', descripcion: '', oculta: false, publishAt: '', visibilidadMode: 'show' }

// Contraste medido contra blanco (fondo real de la tabla de calificaciones,
// docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 2, paso 2.9): con los tonos
// anteriores, "vacío" (slate-300, 1.48:1), "media" (amber-600, 3.19:1) y
// "baja" (red-500, 3.76:1) fallaban el mínimo de texto de WCAG AA (4.5:1).
// Un tono más oscuro en cada familia (slate-500 4.76:1, amber-700 5.02:1,
// red-600 4.83:1) resuelve los tres sin cambiar de familia de color.
export function gradeColor(norm) {
  if (norm === null) return 'text-muted'
  if (norm >= 8) return 'text-emerald-700'
  if (norm >= 6) return 'text-amber-700'
  return 'text-red-600'
}

// Tabla de asistencias compartida por la vista web y la vista horizontal de la
// app. En la app se ocultan las columnas de Totales (esos se ven en la web) y
// el encabezado queda fijo (sticky) para que solo scrolleen los datos.
//
// Extraída a un componente propio (con React.memo) a propósito: envolver el
// JSX en useMemo() DENTRO de SubjectPage NO bastaba — medido con datos reales
// (52 alumnos × 36 columnas), abrir/cerrar el modal de Justificación seguía
// tardando 500-950ms porque React igual reconciliaba el árbol completo de la
// tabla en cada cambio de estado no relacionado (reasonModal, reasonText).
// Solo un componente separado envuelto en memo() logra que React se salte
// por completo esa reconciliación cuando sus props no cambian. Para que el
// memo funcione de verdad, los callbacks que recibe deben tener identidad
// ESTABLE entre renders (ver useCallback en SubjectPage) — si no, memo()
// vería "props nuevas" en cada render y el problema seguiría igual.
// Teléfono horizontal (web): ancho de la columna del nombre = el nombre más
// largo del grupo, medido con la fuente real de la celda (Outfit 13px, peso
// 500), para que TODOS quepan en una sola línea y sin "…". Mínimo 210px.
// Se suma el relleno px-2 de ambos lados (1rem), el borde derecho y 2px de
// margen. Con la fuente todavía sin cargar, el canvas mide con la de respaldo;
// por eso quien llama vuelve a medir cuando la fuente termina de cargar.
export let ctxAnchoNombreH = null

export function anchoColumnaNombreH(estudiantes) {
  if (typeof document === 'undefined') return 210
  ctxAnchoNombreH = ctxAnchoNombreH || document.createElement('canvas').getContext('2d')
  const ctx = ctxAnchoNombreH
  if (!ctx) return 210
  ctx.font = `500 13px ${getComputedStyle(document.body).fontFamily}`
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  let max = 0
  estudiantes.forEach((s) => { max = Math.max(max, ctx.measureText(studentFullName(s)).width) })
  return Math.max(210, Math.ceil(max + rem + 1 + 2))
}

// iPhone: sin la burbuja nativa (copiar/buscar) al mantener presionado.
export const SIN_CALLOUT_IOS = { WebkitTouchCallout: 'none' }

// Hora actual para los manejadores de la pulsación larga (nunca en el render).
export const marcaDeTiempo = () => Date.now()

// Filtro de estado de activación en el encabezado de la lista de estudiantes
// — reemplaza el texto fijo "Estado". Mismo patrón de menú que
// ExportSplitButton de arriba (absolute + click-afuera + botón atrás de
// Android), pero encogido al ancho de la columna (w-14 en App, w-24 en web).
export const ESTADO_FILTRO_OPCIONES = [
  { value: 'todos', label: 'Todos' },
  { value: 'activo', label: 'Activos' },
  { value: 'sin_activar', label: 'Sin activar' },
]

// Construye el mapa de denominadores reales por parcial para los Excel de asistencia.
// Parcial cerrado → totalOficialPorParcial (oficial confirmado por el docente).
// Parcial abierto → sesionesPorParcialCliente (calculado en tiempo real en el cliente).
export function buildDenominadoresPorParcial(subject, sesionesPorParcialCliente = {}) {
  const den = {}
  const parciales = subject?.parcialesFechas || []
  parciales.forEach((_, i) => {
    const p = String(i + 1)
    const cerrado = subject?.parcialesCerrados?.[p]
    den[p] = cerrado
      ? (subject?.totalOficialPorParcial?.[p] ?? null)
      : (sesionesPorParcialCliente[p] ?? null)
  })
  return den
}

// Tres cabeceras de la asignatura y su submenú (ver gruposVisibles).
export const GRUPOS_SECCIONES = [
  { id: 'actividades', label: 'Actividades', tabs: ['actividades'] },
  { id: 'estudiantes', label: 'Estudiantes', tabs: ['alumnos', 'asistencia', 'calificaciones'] },
  { id: 'clase', label: 'Clase', tabs: ['recursos', 'avisos', 'asistente-ia'] },
]

export const ETIQUETA_SECCION = {
  actividades: 'Actividades', alumnos: 'Lista', asistencia: 'Asistencias', calificaciones: 'Calificaciones',
  recursos: 'Recursos', avisos: 'Avisos', 'asistente-ia': 'Planeación',
}
