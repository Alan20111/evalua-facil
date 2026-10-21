// Tendencias colectivas de una pregunta abierta, armadas SOLO con lo que la IA ya evaluó de las
// respuestas reales (conteo de niveles, conceptos y errores). Distingue recibidas, analizadas y
// pendientes, y rotula todo como interpretación de la IA: las respuestas originales siguen aparte.
import { Sparkles } from 'lucide-react'
import { resumenAbiertas } from '../../utils/participacionVivo'

const NIVELES = [
  { clave: 'logrado', texto: 'Logrado', color: '#34d399' },
  { clave: 'parcial', texto: 'Parcial', color: '#fbbf24' },
  { clave: 'no_logrado', texto: 'Por reforzar', color: '#f87171' },
]

export default function PanelAnalisisIA({ pregunta, respuestas, analisisActivo }) {
  const r = resumenAbiertas(respuestas, pregunta)
  const pendientes = r.pendientes + r.analizando
  return (
    <aside aria-label="Análisis de la IA" className="rounded-card bg-white/10 border border-white/10 p-4 text-white">
      <p className="flex items-center gap-2 text-sm font-semibold text-white/80 mb-3">
        <Sparkles size={16} aria-hidden="true" /> Interpretación de la IA
        <span className="font-normal text-white/80">(a partir de las respuestas de arriba)</span>
      </p>

      <dl className="grid grid-cols-3 gap-2 text-center mb-4">
        <div><dt className="text-xs text-white/80">Recibidas</dt><dd className="text-2xl font-bold tabular-nums">{r.recibidas}</dd></div>
        <div><dt className="text-xs text-white/80">Analizadas</dt><dd className="text-2xl font-bold tabular-nums">{r.analizadas}</dd></div>
        <div><dt className="text-xs text-white/80">Pendientes</dt><dd className="text-2xl font-bold tabular-nums">{pendientes}</dd></div>
      </dl>
      {(r.fallidas > 0 || r.omitidas > 0) && (
        <p className="text-xs text-white/80 mb-3">
          {r.fallidas > 0 && `${r.fallidas} no se pudieron analizar. `}
          {r.omitidas > 0 && `${r.omitidas} quedaron fuera del tope de análisis de la sesión.`}
        </p>
      )}

      {!analisisActivo ? (
        <p className="text-sm text-white/80">Activa el análisis en vivo para que la IA evalúe cada respuesta conforme llega.</p>
      ) : r.analizadas === 0 ? (
        <p className="text-sm text-white/80">Aún no hay respuestas analizadas.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex h-4 rounded-full overflow-hidden bg-white/10" aria-hidden="true">
              {NIVELES.map((n) => r.niveles[n.clave] > 0 && (
                <div key={n.clave} className="transition-[width] duration-lenta motion-reduce:transition-none" style={{ width: `${(r.niveles[n.clave] / r.analizadas) * 100}%`, backgroundColor: n.color }} />
              ))}
            </div>
            <p className="flex flex-wrap gap-x-4 text-xs text-white/80 mt-1">
              {NIVELES.map((n) => <span key={n.clave}><span aria-hidden="true" style={{ color: n.color }}>●</span> {n.texto}: {r.niveles[n.clave]}</span>)}
            </p>
          </div>
          {r.conceptos.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-white/80 mb-1">Conceptos que se comprenden</p>
              <ul className="flex flex-wrap gap-1.5">
                {r.conceptos.map((c) => <li key={c.texto} className="text-sm px-2.5 py-1 rounded-full bg-emerald-400/20 text-emerald-100">{c.texto} · {c.n}</li>)}
              </ul>
            </div>
          )}
          {r.errores.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-white/80 mb-1">Errores o dudas frecuentes</p>
              <ul className="flex flex-wrap gap-1.5">
                {r.errores.map((c) => <li key={c.texto} className="text-sm px-2.5 py-1 rounded-full bg-rose-400/20 text-rose-100">{c.texto} · {c.n}</li>)}
              </ul>
            </div>
          )}
          <p className="text-xs text-white/80">Basado en {r.analizadas} {r.analizadas === 1 ? 'respuesta analizada' : 'respuestas analizadas'} de {r.recibidas} recibidas.</p>
        </div>
      )}
    </aside>
  )
}
