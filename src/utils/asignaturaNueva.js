// Valores con que llega el formulario «Nueva asignatura»
// (PLAN_NORMALIZACION_UI §5.2: lo obvio ya viene puesto). Salen de las
// asignaturas que el docente ya tiene, nunca de una suposición: si no hay de
// dónde tomarlos, el campo se queda como estaba.
import { PALETTES } from './subjectPalette'

function creadaMs(asignatura) {
  const c = asignatura?.createdAt
  return c?.toMillis?.() ?? (c?.seconds != null ? c.seconds * 1000 : 0)
}

// Hoy en hora local, 'YYYY-MM-DD'. No sale de toISOString(), que va en UTC:
// en México, de noche, ya sería mañana.
function hoyLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// El ciclo vigente es la asignatura activa, con fechas, cuyo curso aún no
// termina; si hay varias, la creada más recientemente. La segunda, la tercera…
// asignatura del semestre casi siempre llevan las mismas fechas y parciales,
// que son los de la escuela. Si ninguna sirve devuelve null: las fechas son
// obligatorias, y una inventada generaría mal los días de asistencia.
export function cicloVigente(asignaturas, hoy = hoyLocal()) {
  let elegida = null
  for (const s of asignaturas || []) {
    if (s.archived || !s.fechaInicio || !s.fechaFin || s.fechaFin < hoy) continue
    if (!elegida || creadaMs(s) > creadaMs(elegida)) elegida = s
  }
  return elegida
}

// Solo se PRESELECCIONAN colores cuyo acento se lee como texto chico sobre
// blanco (contraste ≥ 4.5:1, WCAG AA): azul 5.2, morado 5.4, rosa 4.7 y
// grafito 7.6. Naranja (2.8), verde (3.3) y turquesa (2.5) siguen a un toque,
// pero no se ofrecen solos.
const LEGIBLES = new Set(['default', 'purple', 'rose', 'slate'])

// El primer color legible que todavía no usa ninguna asignatura activa, para
// que la nueva se distinga en la barra lateral. Si ya están todos ocupados, el
// azul de siempre.
export function paletaLibre(asignaturas) {
  const usadas = new Set((asignaturas || []).filter((s) => !s.archived).map((s) => s.colorPalette || 'default'))
  return PALETTES.find((p) => LEGIBLES.has(p.key) && !usadas.has(p.key))?.key || 'default'
}
