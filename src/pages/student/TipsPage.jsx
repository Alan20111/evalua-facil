import { Lightbulb, FileDown } from 'lucide-react'
import StudentLayout from '../../components/StudentLayout'
import { STUDENT_CONTAINER_NARROW } from '../../config/layout'

// Cada Tip nuevo se agrega aquí como un objeto más — no requiere tocar
// TipCard ni el resto del archivo. `icon` es opcional (cae a Lightbulb).
// `body` es un arreglo de partes: strings de texto plano, o
// `{ text, href }` para un tramo que debe salir como enlace externo — así
// cada Tip controla su propia redacción alrededor del enlace.
const TIPS = [
  {
    id: 'pdf-muy-grande',
    icon: FileDown,
    title: '¿El tamaño de tu archivo PDF es muy grande?',
    body: [
      'Usa ',
      { text: 'iLovePDF', href: 'https://www.ilovepdf.com/compress_pdf' },
      ' para reducirlo y poderlo subir.',
    ],
  },
]

function TipBody({ parts }) {
  return parts.map((part, i) =>
    typeof part === 'string' ? (
      <span key={i}>{part}</span>
    ) : (
      <a
        key={i}
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-accent hover:underline"
      >
        {part.text}
      </a>
    )
  )
}

function TipCard({ tip }) {
  const Icon = tip.icon || Lightbulb
  return (
    <section className="bg-surface-card rounded-card shadow-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={18} className="text-accent flex-shrink-0" />
        <h2 className="text-[15px] font-bold text-on-surface">{tip.title}</h2>
      </div>
      <p className="text-[14px] text-muted leading-relaxed">
        <TipBody parts={tip.body} />
      </p>
    </section>
  )
}

export default function TipsPage() {
  return (
    <StudentLayout>
      <div className={`px-4 py-4 ${STUDENT_CONTAINER_NARROW}`}>
        <div className="mb-6">
          <h1 className="text-[21px] font-bold text-on-surface">Tips</h1>
          <p className="text-[15px] text-slate-500 mt-0.5">
            Consejos rápidos para sacarle más provecho a Evalúa Fácil.
          </p>
        </div>

        <div className="space-y-4">
          {TIPS.map((tip) => (
            <TipCard key={tip.id} tip={tip} />
          ))}
        </div>
      </div>
    </StudentLayout>
  )
}
