import { useState } from 'react'
import { BookOpen, GraduationCap, Users, ClipboardList, ClipboardCheck, Database, Percent, UserCheck, CalendarDays, FileDown, UserCog, Check } from 'lucide-react'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'

// Cada sección solo tiene `content` si ya fue escrita y revisada — el resto
// se muestra como "muy pronto" en vez de simularse con relleno. Ver
// feedback_writing_style_manuals en memoria: bullets, no prosa; nada
// inventado que no esté verificado contra el código real.
const SECTIONS = [
  {
    id: 'primeros-pasos',
    title: 'Primeros pasos',
    icon: BookOpen,
    content: [
      'Te registras con tu correo y una contraseña, o con tu cuenta de Google — no se te pide nada de tu escuela todavía.',
      'En "Un último paso" pones tu nombre real y cómo quieres que te vean tus estudiantes (por ejemplo "Profa. Laura García") — ese es el nombre que aparece en tus asignaturas y actividades, no tu nombre real.',
      'Desde tu Perfil puedes elegir tu escuela del catálogo (o darla de alta si no aparece) — no es un paso obligatorio antes de trabajar, lo puedes hacer cuando quieras.',
      'Tienes 30 días de prueba con acceso a todo, sin límite de asignaturas, grupos ni estudiantes. Al terminar, se activa la suscripción mensual.',
    ],
  },
  { id: 'asignaturas-grupos', title: 'Asignaturas y grupos', icon: GraduationCap },
  { id: 'estudiantes', title: 'Estudiantes', icon: Users },
  { id: 'actividades', title: 'Actividades', icon: ClipboardList },
  { id: 'rubricas-cotejo', title: 'Rúbricas y listas de cotejo', icon: ClipboardCheck },
  { id: 'banco-reactivos', title: 'Banco de reactivos', icon: Database },
  { id: 'calificaciones', title: 'Calificaciones', icon: Percent },
  { id: 'asistencia', title: 'Asistencia', icon: UserCheck },
  { id: 'agenda', title: 'Agenda y calendario', icon: CalendarDays },
  { id: 'reportes', title: 'Reportes y exportación', icon: FileDown },
  { id: 'perfil-suscripcion', title: 'Perfil y suscripción', icon: UserCog },
]

export default function ManualPage() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id)
  const active = SECTIONS.find((s) => s.id === activeId)

  return (
    <div className={`px-4 py-4 ${TEACHER_CONTAINER_NARROW}`}>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-on-surface">Manual</h1>
        <p className="text-sm text-slate-500 mt-0.5">Cómo funciona cada parte de Evalúa Fácil.</p>
      </div>

      {/* Índice — scroll horizontal en móvil, columna fija en desktop. */}
      <div className="md:grid md:grid-cols-[220px_1fr] md:gap-6">
        <nav className="flex md:flex-col gap-1.5 overflow-x-auto pb-2 md:pb-0 mb-4 md:mb-0 -mx-1 px-1">
          {SECTIONS.map((s) => {
            const Icon = s.icon
            const isActive = s.id === activeId
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-card text-sm font-medium text-left whitespace-nowrap md:whitespace-normal flex-shrink-0 md:flex-shrink transition-colors ${
                  isActive
                    ? 'bg-accent text-white shadow-card'
                    : 'bg-surface-card text-muted hover:bg-[var(--accent-tint)]'
                }`}
              >
                <Icon size={16} className="flex-shrink-0" />
                {s.title}
              </button>
            )
          })}
        </nav>

        <div className="bg-surface-card rounded-card shadow-card p-5 min-w-0">
          <h2 className="text-lg font-bold text-on-surface mb-3">{active.title}</h2>
          {active.content ? (
            <ul className="space-y-2.5">
              {active.content.map((line, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-on-surface leading-relaxed">
                  <Check size={16} className="text-accent flex-shrink-0 mt-0.5" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Esta sección está en preparación — muy pronto.</p>
          )}
        </div>
      </div>
    </div>
  )
}
