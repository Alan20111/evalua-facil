// ─── Días de asueto ──────────────────────────────────────────────────────────
//
// Colección `asuetos`: cada doc marca una fecha en la que, según su alcance, no
// se permiten clases, eventos y/o actividades.
//
//   { docenteId, fecha: 'YYYY-MM-DD', clases: bool, eventos: bool,
//     actividades: bool, asistencias: bool, createdAt }
//
// Un flag en `true` significa "ese tipo NO se permite ese día".

export const TIPOS_ASUETO = [
  { id: 'clases', label: 'Clases' },
  { id: 'eventos', label: 'Eventos' },
  { id: 'actividades', label: 'Actividades' },
  { id: 'asistencias', label: 'Asistencias' },
]

// Alcance con todos los tipos activados — el estado inicial de los selectores.
// Se deriva de TIPOS_ASUETO para que agregar un tipo sea un solo cambio.
export function alcanceCompleto(valor = true) {
  return Object.fromEntries(TIPOS_ASUETO.map(t => [t.id, valor]))
}

// `asistencias` se agregó después de que ya había asuetos guardados. En esos
// docs el campo no existe, y antes marcar "clases" implicaba que tampoco se
// pasaba lista (la asistencia salía de los bloques de clase). Por eso, cuando
// falta, hereda el valor de `clases`: los asuetos viejos siguen comportándose
// igual y los nuevos pueden separar las dos cosas.
function leerAsistencias(a) {
  return a?.asistencias ?? !!a?.clases
}

// Índice por fecha para consultas O(1):
// { 'YYYY-MM-DD': {clases,eventos,actividades,asistencias} }.
export function buildAsuetoMap(asuetos = []) {
  const m = {}
  asuetos.forEach(a => {
    if (!a?.fecha) return
    const prev = m[a.fecha] || alcanceCompleto(false)
    m[a.fecha] = {
      clases: prev.clases || !!a.clases,
      eventos: prev.eventos || !!a.eventos,
      actividades: prev.actividades || !!a.actividades,
      asistencias: prev.asistencias || leerAsistencias(a),
    }
  })
  return m
}

// ¿La fecha es asueto para ese tipo
// ('clases' | 'eventos' | 'actividades' | 'asistencias')?
export function esAsuetoPara(map, fecha, tipo) {
  return !!(map && map[fecha] && map[fecha][tipo])
}

// ¿La fecha tiene algún tipo de asueto (para marcarla visualmente)?
export function esAsuetoAlguno(map, fecha) {
  const a = map && map[fecha]
  return !!(a && TIPOS_ASUETO.some(t => a[t.id]))
}

// Texto corto del alcance de un asueto para mostrar en chips/tooltips.
export function alcanceAsuetoTexto(a) {
  // Los asuetos guardados antes de que existiera `asistencias` la heredan de
  // `clases`, igual que en el mapa — si no, un asueto viejo de "Todo" se leería
  // como si dejara pasar lista.
  const activo = { ...a, asistencias: leerAsistencias(a) }
  const partes = TIPOS_ASUETO.filter(t => activo[t.id]).map(t => t.label.toLowerCase())
  if (partes.length === TIPOS_ASUETO.length) return 'Todo'
  if (partes.length === 0) return '—'
  return partes.join(', ')
}
