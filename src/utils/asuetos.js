// ─── Días de asueto ──────────────────────────────────────────────────────────
//
// Colección `asuetos`: cada doc marca una fecha en la que, según su alcance, no
// se permiten clases, eventos y/o actividades.
//
//   { docenteId, fecha: 'YYYY-MM-DD', clases: bool, eventos: bool, actividades: bool, createdAt }
//
// Un flag en `true` significa "ese tipo NO se permite ese día".

export const TIPOS_ASUETO = [
  { id: 'clases', label: 'Clases' },
  { id: 'eventos', label: 'Eventos' },
  { id: 'actividades', label: 'Actividades' },
]

// Índice por fecha para consultas O(1): { 'YYYY-MM-DD': {clases,eventos,actividades} }.
export function buildAsuetoMap(asuetos = []) {
  const m = {}
  asuetos.forEach(a => {
    if (!a?.fecha) return
    const prev = m[a.fecha] || { clases: false, eventos: false, actividades: false }
    m[a.fecha] = {
      clases: prev.clases || !!a.clases,
      eventos: prev.eventos || !!a.eventos,
      actividades: prev.actividades || !!a.actividades,
    }
  })
  return m
}

// ¿La fecha es asueto para ese tipo ('clases' | 'eventos' | 'actividades')?
export function esAsuetoPara(map, fecha, tipo) {
  return !!(map && map[fecha] && map[fecha][tipo])
}

// ¿La fecha tiene algún tipo de asueto (para marcarla visualmente)?
export function esAsuetoAlguno(map, fecha) {
  const a = map && map[fecha]
  return !!(a && (a.clases || a.eventos || a.actividades))
}

// Texto corto del alcance de un asueto para mostrar en chips/tooltips.
export function alcanceAsuetoTexto(a) {
  const partes = []
  if (a.clases) partes.push('clases')
  if (a.eventos) partes.push('eventos')
  if (a.actividades) partes.push('actividades')
  if (partes.length === 3) return 'Todo'
  if (partes.length === 0) return '—'
  return partes.join(', ')
}
