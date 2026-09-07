import { useState } from 'react'
import {
  GraduationCap, Users, QrCode, ClipboardList, UserCheck, ArrowRight,
  BarChart2, CalendarCheck, Megaphone, Sparkles, FolderOpen, Coins,
  ChevronDown, UserCircle,
} from 'lucide-react'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'

// ─── Primeros pasos ──────────────────────────────────────────────────────────

const GUIDES = [
  {
    id: 'asignatura',
    title: '1. Crear una asignatura',
    icon: GraduationCap,
    steps: [
      {
        text: 'En tu Dashboard, donde ves todas tus asignaturas, toca "Nueva asignatura".',
        image: '/ayuda-comenzar/01-dashboard-nueva-asignatura.png',
      },
      {
        text: 'Se abre un formulario. Nombre (por ejemplo "Matemáticas"), grupo (por ejemplo "1A") y las fechas de inicio y fin son obligatorias — con ellas se arman los parciales, el horario y la Planeación Didáctica. Todo lo demás lo puedes dejar para después.',
        image: '/ayuda-comenzar/02-modal-crear-asignatura.png',
      },
      {
        text: 'Toca "Guardar". La asignatura aparece en tu Dashboard con su código de acceso.',
      },
    ],
    transfer: 'Para crear cualquier otra cosa: busca dónde se administra ese elemento y usa su botón de crear.',
  },
  {
    id: 'estudiantes',
    title: '2. Agregar a tus estudiantes',
    icon: Users,
    steps: [
      {
        text: 'Entra a la asignatura. Abre la pestaña "Estudiantes" y toca el ícono verde de agregar.',
        image: '/ayuda-comenzar/03-tab-estudiantes.png',
      },
      {
        text: 'Escribe apellido paterno, apellido materno (opcional) y nombre(s), y toca "Agregar estudiante".',
        image: '/ayuda-comenzar/04-modal-agregar-estudiante.png',
        highlight: {
          label: '¿Cuál será el usuario de tu estudiante?',
          formula: 'Apellido paterno + punto + primer nombre',
          input: 'Méndez   Enrique',
          output: 'mendez.enrique',
          nota: 'Con ese usuario entra a Evalúa Fácil.',
        },
      },
      {
        text: 'Si es todo un grupo a la vez, usa "Plantilla Excel": descarga la plantilla, llénala con un alumno por fila y súbela. La plataforma genera los códigos de acceso de todos de golpe.',
      },
    ],
    transfer: 'Lo que le pertenece a una asignatura (estudiantes, actividades, asistencias) se administra en su propia pestaña.',
  },
  {
    id: 'acceso',
    title: '3. Compartir el acceso a la clase',
    icon: QrCode,
    steps: [
      {
        text: 'Entra a tu asignatura. En la parte superior verás el código de acceso.',
        image: '/ayuda-comenzar/acceso-codigo.png',
      },
      {
        text: 'Comparte ese código con tus alumnos por el medio que prefieras (WhatsApp, en clase, etc.).',
      },
      {
        text: 'El alumno entra a la plataforma, escribe el código y elige su contraseña. Listo, queda activado.',
      },
    ],
    transfer: 'Una vez activados, tus alumnos ya pueden ver las actividades que publiques →',
  },
  {
    id: 'actividad',
    title: '4. Crear tu primera actividad',
    icon: ClipboardList,
    description: 'Ejemplo: pedir fotos del cuaderno.',
    steps: [
      {
        text: 'Dentro de la asignatura, en la pestaña "Actividades", toca "Nueva actividad".',
      },
      {
        text: 'Elige el tipo "Entregable" y ponle nombre, por ejemplo "Fotos del cuaderno — tema 1".',
        image: '/ayuda-comenzar/05-tipo-actividad.png',
      },
      {
        text: 'En "Tipos de archivo permitidos" selecciona "Imágenes". Deja la visibilidad en "Publicar ahora" y toca "Guardar".',
        image: '/ayuda-comenzar/06-tipo-archivo-imagenes.png',
      },
      {
        text: 'Cuando los alumnos entreguen, sus fotos aparecen dentro de esa misma actividad — ahí las revisas y calificas.',
      },
    ],
    transfer: 'El patrón se repite en cualquier actividad: crear, configurar lo indispensable, guardar, revisar lo que entregan en ese mismo lugar.',
  },
  {
    id: 'asistencia',
    title: '5. Pasar lista con tu móvil',
    icon: UserCheck,
    description: 'Para cuando estás en el aula con tu teléfono.',
    steps: [
      {
        text: 'Entra a la asignatura desde tu celular y abre la pestaña "Asistencias".',
        image: '/ayuda-comenzar/07-asistencia-movil.png',
      },
      {
        text: 'Selecciona el día de hoy. Todos empiezan marcados como presente — toca la celda de quien faltó para cambiarla a falta o justificada.',
      },
      {
        text: 'No hay botón de guardar: cada toque se registra al momento.',
      },
    ],
    transfer: 'La plataforma es la misma en el celular y en la computadora: mismas asignaturas, mismas pestañas, adaptadas a la pantalla.',
  },
]

// ─── Todo lo demás ───────────────────────────────────────────────────────────

const REFERENCE = [
  {
    id: 'calificaciones',
    title: 'Calificaciones',
    icon: BarChart2,
    bullets: [
      'Se calculan automáticamente al calificar actividades.',
      'Exporta la tabla en Excel o PDF.',
      'Ordena de mayor a menor para identificar quién necesita apoyo.',
      '"Activar ponderación" asigna diferente peso a cada actividad.',
    ],
  },
  {
    id: 'tipos-actividad',
    title: 'Tipos de actividad',
    icon: ClipboardList,
    bullets: null,
    tiposContent: [
      { tipo: 'Entregable', desc: 'El alumno sube uno o varios archivos (imagen, PDF, video…).' },
      {
        tipo: 'Evaluación',
        desc: null,
        sub: [
          { nombre: 'Cuestionario', desc: 'Reactivos para práctica o aprendizaje.' },
          { nombre: 'Examen', desc: 'Evaluación formal con calificación.' },
        ],
      },
      { tipo: 'Observación', desc: 'Tú la calificas directamente; el alumno no entrega nada.' },
      {
        tipo: 'Actividad interactiva',
        desc: null,
        sub: [
          { nombre: 'Crucigrama', desc: '' },
          { nombre: 'Sopa de letras', desc: '' },
        ],
      },
    ],
  },
  {
    id: 'asistencias',
    title: 'Asistencias',
    icon: CalendarCheck,
    bullets: [
      'Abre la pestaña "Asistencias" y selecciona la fecha.',
      'Todos empiezan como presente. Toca una celda para cambiarla a falta o justificada.',
      'Se guarda al momento — sin botón de guardar.',
      'Funciona igual en celular y en computadora.',
    ],
  },
  {
    id: 'avisos',
    title: 'Avisos',
    icon: Megaphone,
    bullets: [
      'Mensajes para todo el grupo desde la pestaña "Avisos".',
      'Los alumnos los ven al entrar a la asignatura.',
      'No pueden responder — es un canal de solo lectura para ellos.',
      'Puedes guardar borradores antes de publicar.',
    ],
  },
  {
    id: 'planeacion',
    title: 'Planeación Didáctica',
    icon: Sparkles,
    bullets: [
      'Genera tu planeación con IA o sube la tuya.',
      'Con IA: consume créditos y usa tu Perfil para IA del docente.',
      'Tu propia planeación: gratis, no la analiza la IA.',
      'Solo puede haber una planeación vigente por asignatura.',
    ],
  },
  {
    id: 'recursos',
    title: 'Recursos',
    icon: FolderOpen,
    bullets: [
      'Materiales siempre visibles para tus alumnos: videos, enlaces, documentos.',
      'No generan entrega ni calificación — son de referencia permanente.',
      'Son independientes del material de la Planeación Didáctica.',
    ],
  },
  {
    id: 'creditos-ia',
    title: 'Créditos de IA',
    icon: Coins,
    bullets: [
      '1 crédito = $1 MXN. No caducan.',
      'Se usan para generar planeaciones y analizar resultados.',
      'Cómpralos desde tu Perfil.',
    ],
  },
  {
    id: 'perfil-ia',
    title: 'Perfil para IA del docente',
    icon: UserCircle,
    bullets: [
      'Describe tu estilo de enseñanza, habilidades y contexto de tu escuela.',
      'La IA lo usa para personalizar las planeaciones que genera.',
      'Se aplica en todas tus asignaturas — llénalo una sola vez.',
    ],
  },
]

// ─── Componentes ─────────────────────────────────────────────────────────────

function TiposActividad({ tipos }) {
  return (
    <ul className="space-y-3">
      {tipos.map((t) => (
        <li key={t.tipo}>
          <span className="font-semibold text-on-surface text-[14px]">{t.tipo}</span>
          {t.desc && <span className="text-[14px] text-muted"> — {t.desc}</span>}
          {t.sub && (
            <ul className="mt-1 ml-4 space-y-1">
              {t.sub.map((s) => (
                <li key={s.nombre} className="text-[14px] text-muted">
                  <span className="font-medium text-on-surface">{s.nombre}</span>
                  {s.desc && <span> — {s.desc}</span>}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

function AccordionCard({ item }) {
  const [open, setOpen] = useState(false)
  const Icon = item.icon
  return (
    <section className="bg-surface-card rounded-card shadow-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-[var(--accent-tint)] transition-colors"
      >
        <Icon size={18} className="text-accent flex-shrink-0" />
        <span className="flex-1 text-[15px] font-semibold text-on-surface">{item.title}</span>
        <ChevronDown
          size={16}
          className={`text-muted flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-outline-variant">
          {item.tiposContent ? (
            <div className="pt-4">
              <TiposActividad tipos={item.tiposContent} />
            </div>
          ) : (
            <ul className="pt-4 space-y-2">
              {item.bullets.map((b) => (
                <li key={b} className="flex gap-2 text-[14px] text-muted leading-snug">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AyudaPage() {
  return (
    <div className={`px-4 py-4 ${TEACHER_CONTAINER_NARROW}`}>
      <div className="mb-6">
        <h1 className="text-[21px] font-bold text-on-surface">Centro de ayuda</h1>
        <p className="text-[15px] text-slate-500 mt-0.5">
          Los 5 pasos para empezar. Para todo lo demás, consulta la sección de abajo.
        </p>
      </div>

      {/* PRIMEROS PASOS */}
      <div className="flex items-center gap-2 mb-3">
        <span aria-hidden="true" className="text-lg">🚀</span>
        <h2 className="text-[13px] font-bold text-muted uppercase tracking-widest">Primeros pasos</h2>
      </div>
      <div className="space-y-4 mb-10">
        {GUIDES.map((guide) => {
          const Icon = guide.icon
          return (
            <section key={guide.id} className="bg-surface-card rounded-card shadow-card p-5">
              <div className="flex items-center gap-2 mb-1">
                <Icon size={18} className="text-accent flex-shrink-0" />
                <h3 className="text-[17px] font-bold text-on-surface">{guide.title}</h3>
              </div>
              {guide.description && (
                <p className="text-[14px] text-slate-500 mb-3 ml-6">{guide.description}</p>
              )}
              <ol className={`space-y-4 ${guide.description ? '' : 'mt-3'}`}>
                {guide.steps.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--accent-tint)] text-accent text-[13px] font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] text-on-surface leading-relaxed">{step.text}</p>
                      {step.image && (
                        <img
                          src={step.image}
                          alt=""
                          className="mt-2 rounded-card border border-outline-variant shadow-card max-w-full sm:max-w-md"
                        />
                      )}
                      {step.highlight && (
                        <div className="mt-3 rounded-card bg-[var(--accent-tint)] px-4 py-3 space-y-2">
                          <p className="text-[12px] font-bold uppercase tracking-wide text-accent">
                            {step.highlight.label}
                          </p>
                          <p className="text-[14px] font-semibold text-on-surface">
                            {step.highlight.formula}
                          </p>
                          <div className="rounded bg-surface px-3 py-2">
                            <p className="text-[13px] text-muted">{step.highlight.input}</p>
                            <p className="text-[15px] font-bold text-accent">→ {step.highlight.output}</p>
                          </div>
                          <p className="text-[13px] text-muted">{step.highlight.nota}</p>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {guide.transfer && (
                <p className="mt-4 pl-9 flex items-start gap-1.5 text-[14px] text-accent font-medium leading-relaxed">
                  <ArrowRight size={15} className="flex-shrink-0 mt-0.5" />
                  {guide.transfer}
                </p>
              )}
            </section>
          )
        })}
      </div>

      {/* TODO LO DEMÁS */}
      <div className="flex items-center gap-2 mb-3">
        <span aria-hidden="true" className="text-lg">📚</span>
        <h2 className="text-[13px] font-bold text-muted uppercase tracking-widest">Todo lo demás</h2>
      </div>
      <div className="space-y-2">
        {REFERENCE.map((item) => (
          <AccordionCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}
