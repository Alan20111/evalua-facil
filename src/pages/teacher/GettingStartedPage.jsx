import { GraduationCap, Users, ClipboardList, UserCheck, ArrowRight } from 'lucide-react'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'

// Ayuda para comenzar: NO es el manual completo (eso quedó archivado en
// docs/manual-anterior/). Son 4 ejemplos concretos elegidos para que, al
// hacerlos, el docente descubra cómo se organiza toda la plataforma —
// dónde vive cada cosa, cómo se crea, cómo se guarda, cómo se comprueba —
// y pueda deducir el resto por su cuenta. Por eso los pasos nombran
// explícitamente la sección/lugar (no solo "haz clic aquí") y cada guía
// cierra con una frase de transferencia. Ver feedback_writing_style_manuals.
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
        text: 'Se abre un formulario. Nombre (por ejemplo "Matemáticas"), grupo (por ejemplo "1A") y las fechas de inicio y fin del curso son obligatorios — con las fechas se arman tus bloques de horario, tu horario y agenda, las asistencias y la Planeación Inicial. Todo lo demás lo puedes dejar para después.',
        image: '/ayuda-comenzar/02-modal-crear-asignatura.png',
      },
      {
        text: 'Toca "Guardar". La asignatura aparece de inmediato en tu Dashboard, con su propio código de acceso — así sabes que quedó creada, y ahí la vuelves a encontrar cada vez que quieras entrar a trabajar en ella.',
      },
    ],
    transfer: 'Con esta misma lógica: para crear cualquier otra cosa en Evalúa Fácil, busca dónde se administra ese tipo de elemento y usa su botón de crear.',
  },
  {
    id: 'estudiantes',
    title: '2. Agregar estudiantes',
    icon: Users,
    steps: [
      {
        text: 'Entra a la asignatura tocándola desde el Dashboard. Cada asignatura tiene sus propias pestañas: Estudiantes, Actividades, Asistencia, etc.',
        image: '/ayuda-comenzar/03b-tabs-asignatura.png',
      },
      {
        text: 'Abre la pestaña "Estudiantes" y toca el ícono verde de agregar.',
        image: '/ayuda-comenzar/03-tab-estudiantes.png',
      },
      {
        text: 'Escribe apellido paterno, apellido materno (opcional) y nombre(s), y toca "Agregar estudiante".',
        image: '/ayuda-comenzar/04-modal-agregar-estudiante.png',
      },
      {
        text: 'Si es todo un grupo de una vez, usa "Plantilla Excel" en la misma pestaña. Verás tres pasos: descarga la plantilla, súbela ya llena y genera el PDF con los códigos de acceso para tus estudiantes.',
        image: '/ayuda-comenzar/04b-plantilla-excel-ui.png',
      },
      {
        text: 'La plantilla tiene una sola columna: el nombre completo en formato "Apellido Paterno  Apellido Materno  Nombre(s)". Llena una fila por estudiante y guarda el archivo — así se importan de golpe.',
        image: '/ayuda-comenzar/04c-plantilla-excel-archivo.png',
      },
      {
        text: 'El estudiante agregado aparece en la lista de esa pestaña con su usuario ya generado — ahí compruebas quién quedó dado de alta y ahí mismo lo editas después.',
      },
    ],
    transfer: 'La idea es la misma: lo que le pertenece a una asignatura (estudiantes, actividades, asistencia) se administra en su propia pestaña, dentro de esa asignatura.',
  },
  {
    id: 'actividad',
    title: '3. Crear tu primera actividad entregable',
    icon: ClipboardList,
    description: 'Ejemplo: pedir fotos del cuaderno.',
    steps: [
      {
        text: 'Dentro de la asignatura, en la pestaña "Actividades", toca "Nueva actividad".',
        image: '/ayuda-comenzar/05b-boton-nueva-actividad.png',
      },
      {
        text: 'Elige el tipo "Entregable" — es el que le pide algo al estudiante — y ponle nombre, por ejemplo "Fotos del cuaderno — tema 1".',
        image: '/ayuda-comenzar/05-tipo-actividad.png',
      },
      {
        text: 'En "Tipos de archivo permitidos" selecciona "Imágenes". Esa es la única configuración que necesitas para este ejemplo: le dice a la plataforma qué puede subir el estudiante.',
        image: '/ayuda-comenzar/06-tipo-archivo-imagenes.png',
      },
      {
        text: 'Deja la visibilidad en "Publicar ahora" y toca "Guardar". La actividad ya es visible para tus estudiantes, quienes pueden entrar y subir sus fotos.',
      },
      {
        text: 'Cuando entreguen, sus fotos aparecen dentro de esa misma actividad — ahí las revisas y calificas, en el mismo lugar donde la creaste.',
      },
    ],
    transfer: 'El patrón se repite en cualquier actividad: crear, configurar lo indispensable, guardar/publicar, y luego revisar lo que entregan en ese mismo lugar.',
  },
  {
    id: 'asistencia',
    title: '4. Pasar lista con tu móvil',
    icon: UserCheck,
    description: 'Este flujo es para cuando estás en el aula con tu teléfono.',
    steps: [
      {
        text: 'Entra a Evalúa Fácil desde tu celular y toca la asignatura de la clase que vas a dar — igual que en la computadora, cada asignatura es su propio espacio.',
      },
      {
        text: 'Abre la pestaña "Asistencia" y selecciona el día de hoy.',
        image: '/ayuda-comenzar/07-asistencia-movil.png',
      },
      {
        text: 'Todos tus estudiantes empiezan marcados como "presente". Toca la celda de quien faltó — va rotando entre presente, falta y justificada.',
      },
      {
        text: 'No hay botón de guardar aparte: cada toque se registra solo.',
      },
      {
        text: 'Vuelve a esa fecha cuando quieras y verás las mismas faltas que marcaste — así compruebas que quedó registrada.',
      },
    ],
    transfer: 'La plataforma es la misma en el celular que en la computadora: las mismas asignaturas, las mismas pestañas, solo adaptadas a la pantalla que estás usando.',
  },
]

export default function GettingStartedPage() {
  return (
    <div className={`px-4 py-4 ${TEACHER_CONTAINER_NARROW}`}>
      <div className="mb-4">
        <h1 className="text-[21px] font-bold text-on-surface">Ayuda para comenzar</h1>
        <p className="text-[15px] text-slate-500 mt-0.5">
          Las 4 acciones para empezar a usar Evalúa Fácil. Para todo lo demás, explora la plataforma —
          está pensada para no necesitar manual.
        </p>
      </div>

      <div className="space-y-4">
        {GUIDES.map((guide) => {
          const Icon = guide.icon
          return (
            <section key={guide.id} className="bg-surface-card rounded-card shadow-card p-5">
              <div className="flex items-center gap-2 mb-1">
                <Icon size={18} className="text-accent flex-shrink-0" />
                <h2 className="text-[17px] font-bold text-on-surface">{guide.title}</h2>
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
    </div>
  )
}
