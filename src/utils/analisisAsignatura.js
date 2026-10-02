// Análisis integral de asignatura con IA — fuentes y costo. Lógica PURA, sin
// Firebase: la usan el diálogo de configuración (cliente) y la comprobación
// previa del servidor (functions/analisisAcademico.js, vía functions/_shared),
// para que el costo que ve el docente y el que se cobra salgan de la MISMA
// función. Ningún precio vive aquí: llegan de config/iaTarifas
// (`analisisAsignatura.costoPorFuente`).

// Las seis fuentes de datos, en el orden en que se muestran. Las
// calificaciones no son una fuente: pertenecen a las actividades de cada tipo.
export const FUENTES_ANALISIS = [
  { clave: 'entregables', etiqueta: 'Entregables' },
  { clave: 'observacion', etiqueta: 'Observación' },
  { clave: 'evaluaciones', etiqueta: 'Cuestionarios / Exámenes' },
  { clave: 'interactivas', etiqueta: 'Actividades interactivas' },
  { clave: 'asistencias', etiqueta: 'Asistencias' },
  { clave: 'sinEntrega', etiqueta: 'Sin entrega' },
]

export const CLAVES_FUENTES = FUENTES_ANALISIS.map((f) => f.clave)

// Tipos de actividad en los que el estudiante entrega o responde algo. En
// Observación califica el docente: no existe "no entregó".
export const FUENTES_CON_ENTREGA = ['entregables', 'evaluaciones', 'interactivas']

// A qué fuente pertenece una actividad. `tarea`/`actividad` son categorías
// antiguas de entregable (mismo criterio que PADRES_VALIDOS en functions/ia.js).
export function fuenteDeActividad(a) {
  const c = a?.categoria
  if (c === 'observacion' || (!c && a?.tipo === 'observacion')) return 'observacion'
  if (c === 'cuestionario' || c === 'examen') return 'evaluaciones'
  if (c === 'juego') return 'interactivas'
  if (c === 'entregable' || c === 'tarea' || c === 'actividad' || (!c && a?.tipo === 'archivo')) return 'entregables'
  return null
}

export function etiquetaFuente(clave) {
  return FUENTES_ANALISIS.find((f) => f.clave === clave)?.etiqueta || clave
}

// `disponibilidadPorParcial` = { '1': { entregables: n, …, asistencias: n,
// conEntrega: { entregables: n, evaluaciones: n, interactivas: n } } } — lo
// calcula el servidor con los datos reales. Devuelve, para los parciales
// elegidos, qué fuentes tienen datos. "Sin entrega" depende además de qué
// tipos con entrega están marcados: solo puede hablar de ellos.
export function fuentesConDatos(disponibilidadPorParcial, parciales, fuentesMarcadas) {
  const marcadas = new Set(fuentesMarcadas || CLAVES_FUENTES)
  const suma = (lector) => (parciales || []).reduce((s, p) => s + (lector(disponibilidadPorParcial?.[String(p)] || {}) || 0), 0)
  const res = {}
  for (const clave of ['entregables', 'observacion', 'evaluaciones', 'interactivas', 'asistencias']) {
    res[clave] = suma((d) => d[clave]) > 0
  }
  res.sinEntrega = FUENTES_CON_ENTREGA.some((f) => marcadas.has(f) && suma((d) => d.conEntrega?.[f]) > 0)
  return res
}

// Fuentes que de verdad entran: marcadas Y con datos, en el orden canónico.
export function fuentesEfectivas(disponibilidadPorParcial, parciales, fuentesMarcadas) {
  const marcadas = new Set(fuentesMarcadas || [])
  const conDatos = fuentesConDatos(disponibilidadPorParcial, parciales, fuentesMarcadas)
  return CLAVES_FUENTES.filter((c) => marcadas.has(c) && conDatos[c])
}

// Suma de las fuentes que entran. null si falta el precio de alguna: sin
// configuración no hay costo que mostrar ni que cobrar (nunca se inventa).
export function costoAnalisis(costoPorFuente, fuentes) {
  let total = 0
  for (const f of fuentes || []) {
    const c = costoPorFuente?.[f]
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 0) return null
    total += c
  }
  return total
}

// Parciales válidos de la selección: enteros 1..total, sin repetir, en orden.
export function parcialesValidos(seleccion, totalParciales) {
  const total = Math.max(1, Number(totalParciales) || 1)
  const set = new Set((seleccion || []).map((p) => Number(p)).filter((p) => Number.isInteger(p) && p >= 1 && p <= total))
  return [...set].sort((a, b) => a - b)
}
