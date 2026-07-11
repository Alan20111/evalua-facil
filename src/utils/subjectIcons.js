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
