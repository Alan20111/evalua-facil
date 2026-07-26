// Curated bank of subject icons from lucide-react (already a dependency, so no
// extra weight — only these ~32 icons are imported, tree-shaken).
// Keys are stable strings stored on the subject doc as `icon`.
import {
  BookOpen, Calculator, FlaskConical, Atom, Globe2, Languages, Music, Palette,
  Dumbbell, Code2, PenTool, Microscope, Landmark, Map, Leaf, Brain, Camera,
  Film, Hammer, Wrench, Cpu, Database, Sigma, Ruler, Compass, Rocket, Lightbulb,
  GraduationCap, Library, Pencil, Trophy,
} from 'lucide-react'
import { PALETTES } from './subjectPalette'

export const SUBJECT_ICONS = {
  book: BookOpen, calculator: Calculator, flask: FlaskConical, atom: Atom,
  globe: Globe2, languages: Languages, music: Music, palette: Palette,
  dumbbell: Dumbbell, code: Code2, pen: PenTool, microscope: Microscope,
  landmark: Landmark, map: Map, leaf: Leaf, brain: Brain, camera: Camera,
  film: Film, hammer: Hammer, wrench: Wrench, cpu: Cpu, database: Database,
  sigma: Sigma, ruler: Ruler, compass: Compass, rocket: Rocket,
  lightbulb: Lightbulb, graduation: GraduationCap, library: Library,
  pencil: Pencil, trophy: Trophy,
}

export const SUBJECT_ICON_KEYS = Object.keys(SUBJECT_ICONS)
export const DEFAULT_SUBJECT_ICON = 'book'

export function getSubjectIcon(key) {
  return SUBJECT_ICONS[key] || SUBJECT_ICONS[DEFAULT_SUBJECT_ICON]
}

// ── Bolitas de color ──────────────────────────────────────────────────
// Un círculo liso, en los mismos 7 colores que los cuadros del selector de
// color. Es la opción más simple del banco y a propósito: para reconocer una
// asignatura de un vistazo —en la barra lateral, en la lista del alumno— un
// punto de color pega más rápido que distinguir un matraz de un microscopio.
//
// Se dibujan como SVG, no como archivos PNG: el fondo transparente es el mismo,
// pero así se ven nítidas en cualquier tamaño y pantalla (la barra lateral las
// pide a 17 px y las tarjetas a 22), no pesan nada en el bundle y no hay que
// versionar imágenes. El color va fijo en la clave, no hereda el acento: la
// gracia es que el docente elija ESE color y siempre se vea igual.
export const SUBJECT_DOT_COLORS = Object.fromEntries(
  PALETTES.map((p) => [`dot-${p.key}`, p.color])
)
export const SUBJECT_DOT_KEYS = Object.keys(SUBJECT_DOT_COLORS)
export const SUBJECT_DOT_LABELS = Object.fromEntries(
  PALETTES.map((p) => [`dot-${p.key}`, `Bolita ${p.label.toLowerCase()}`])
)

// hasOwnProperty.call y no `!!SUBJECT_DOT_COLORS[key]`: el objeto hereda de
// Object.prototype, así que una clave como "toString" daría truthy por accidente.
export function isDotIcon(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(SUBJECT_DOT_COLORS, key)
}

export function dotIconColor(key) {
  return SUBJECT_DOT_COLORS[key] || null
}
