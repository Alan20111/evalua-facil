// Curated bank of subject icons from lucide-react (already a dependency, so no
// extra weight — only these ~32 icons are imported, tree-shaken).
// Keys are stable strings stored on the subject doc as `icon`.
import {
  BookOpen, Calculator, FlaskConical, Atom, Globe2, Languages, Music, Palette,
  Dumbbell, Code2, PenTool, Microscope, Landmark, Map, Leaf, Brain, Camera,
  Film, Hammer, Wrench, Cpu, Database, Sigma, Ruler, Compass, Rocket, Lightbulb,
  GraduationCap, Library, Pencil, Trophy,
} from 'lucide-react'

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
// Un círculo liso. Es la opción más simple del banco y a propósito: para
// reconocer una asignatura de un vistazo —en la barra lateral, en la lista del
// alumno— un punto de color pega más rápido que distinguir un matraz de un
// microscopio.
//
// Tienen su PROPIA lista de colores, ya no los de PALETTES, y son a propósito
// más eléctricos: aquellos nacieron para ser acento de la interfaz (botones,
// texto, bordes), donde un flúor sería insoportable; estas solo tienen que
// gritar su color sobre el lienzo azul cielo, y los tonos apagados —sobre todo
// los azules y verdosos— se le perdían encima.
//
// Son OCHO para que la fila cierre justo con la rejilla de íconos de abajo
// (grid-cols-8 en escritorio); con siete quedaba un hueco al final.
//
// Se dibujan como SVG, no como archivos PNG: el fondo transparente es el mismo,
// pero así se ven nítidas en cualquier tamaño y pantalla (la barra lateral las
// pide a 17 px y las tarjetas a 22), no pesan nada en el bundle y no hay que
// versionar imágenes. El color va fijo en la clave, no hereda el acento: la
// gracia es que el docente elija ESE color y siempre se vea igual.
export const SUBJECT_DOTS = [
  { key: 'dot-blue', label: 'Azul flúor', color: '#0066ff' },
  { key: 'dot-orange', label: 'Naranja', color: '#f97316' },
  { key: 'dot-pink', label: 'Rosa flúor', color: '#ff2d95' },
  { key: 'dot-green', label: 'Verde flúor', color: '#00e04a' },
  { key: 'dot-rose', label: 'Rosa', color: '#e11d48' },
  { key: 'dot-violet', label: 'Violeta flúor', color: '#8b00ff' },
  { key: 'dot-yellow', label: 'Amarillo flúor', color: '#ffe400' },
  { key: 'dot-slate', label: 'Blanco', color: '#ffffff' },
]

// Claves de la primera versión de las bolitas (nombradas por la paleta de la
// que salían). Se conservan apuntando al color equivalente para que a nadie
// que ya la haya elegido se le convierta la asignatura en un libro.
const LEGACY_DOT_COLORS = {
  'dot-default': '#0066ff', // era el azul de acento
  'dot-purple': '#ff2d95',  // el morado pasó a rosa flúor
  'dot-teal': '#8b00ff',    // el azul verde pasó a violeta flúor
}

export const SUBJECT_DOT_COLORS = {
  ...LEGACY_DOT_COLORS,
  ...Object.fromEntries(SUBJECT_DOTS.map((d) => [d.key, d.color])),
}

// hasOwnProperty.call y no `!!SUBJECT_DOT_COLORS[key]`: el objeto hereda de
// Object.prototype, así que una clave como "toString" daría truthy por accidente.
export function isDotIcon(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(SUBJECT_DOT_COLORS, key)
}

export function dotIconColor(key) {
  return SUBJECT_DOT_COLORS[key] || null
}

// Contornos propios, por COLOR y no por clave, para que las claves legadas
// (dot-purple, dot-teal…) hereden el mismo aro que la bolita a la que apuntan.
// Las tres oscuras llevan aro blanco para recortarse sobre cualquier fondo; la
// blanca lo lleva gris porque un aro blanco sobre blanco no existe.
const DOT_OUTLINES = {
  '#0066ff': '#ffffff', // azul
  '#e11d48': '#ffffff', // rojo
  '#8b00ff': '#ffffff', // violeta
  '#ffffff': '#94a3b8', // blanca
}

// null = sin contorno propio; quien dibuje usa el aro por defecto (mismo tono
// oscurecido), que es lo que siguen usando las bolitas flúor.
export function dotOutlineColor(key) {
  const color = dotIconColor(key)
  return color ? DOT_OUTLINES[color.toLowerCase()] || null : null
}
