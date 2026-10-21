// Resultado de una pregunta de opción única para proyectar: una barra grande de color por opción, con
// cantidad y porcentaje reales. Sin respuestas todas las barras están vacías (no se simula nada).
import { Check } from 'lucide-react'
import { COLORES_VIVO, contarOpciones } from '../../utils/participacionVivo'

export default function ResultadoOpciones({ pregunta, respuestas, correcta = null }) {
  const { cuentas, total } = contarOpciones(respuestas, pregunta)
  const max = Math.max(1, ...Object.values(cuentas))
  return (
    <ul className="w-full space-y-4" aria-label="Resultados por opción">
      {pregunta.opciones.map((o, i) => {
        const n = cuentas[o.id] || 0
        const pct = total ? Math.round((n / total) * 100) : 0
        const esCorrecta = correcta != null && o.id === correcta
        return (
          <li key={o.id} className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-4 mb-1">
                <p className="text-2xl font-semibold text-white truncate flex items-center gap-2">
                  {o.texto}
                  {esCorrecta && <Check size={24} className="text-emerald-300 flex-shrink-0" aria-label="Respuesta correcta" />}
                </p>
                <p className="text-2xl font-bold tabular-nums text-white flex-shrink-0">{n} <span className="text-lg font-medium text-white/80">({pct}%)</span></p>
              </div>
              <div className="h-10 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full transition-[width] duration-lenta ease-out motion-reduce:transition-none"
                  style={{ width: `${(n / max) * 100}%`, backgroundColor: COLORES_VIVO[i % COLORES_VIVO.length], minWidth: n ? '2.5rem' : 0, outline: esCorrecta ? '3px solid #6ee7b7' : 'none', outlineOffset: 2 }} />
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
