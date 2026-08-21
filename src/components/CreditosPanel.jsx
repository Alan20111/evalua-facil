// Panel de detalle de créditos IA — se abre al tocar la barra.
//
// Modelo de créditos puros sin caducidad (20-ago-2026, migración — ver
// docs/ia/PLAN_TECNICO_CREDITOS_PUROS.md): sin capacidad, sin plan, sin
// ciclo — muestra disponibles / utilizados en total (histórico, nunca se
// resetea) y el resumen de consumo por categorías. NUNCA muestra tokens ni
// el costo monetario que Evalúa Fácil paga por la IA: el docente piensa en
// créditos (regla del PO).
//
// A 0 créditos SOLO se suspende la IA: el mensaje lo dice explícitamente y
// el resto del producto sigue funcionando (asignaturas, evidencias,
// calificaciones, reportes…) — la única excepción es Asistencia, que exige
// saldo>0 aunque no consuma créditos (ver AttendanceTab).

import { useState } from 'react'
import { X, Sparkles } from 'lucide-react'
import useCreditosIA from '../hooks/useCreditosIA'
import ComprarCreditosModal from './ComprarCreditosModal'

export default function CreditosPanel({ onCerrar }) {
  const c = useCreditosIA()
  const [comprarAbierto, setComprarAbierto] = useState(false)
  if (!c.listo) return null

  const usados = c.consumidoTotal
  const agotado = c.saldo === 0

  const categorias = Object.entries(c.consumoPorCategoria).sort((a, b) => b[1] - a[1])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={onCerrar} aria-label="Cerrar" />
      <div className="relative bg-surface-card w-full max-w-md rounded-t-card sm:rounded-card p-5 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={20} className="text-accent flex-shrink-0" />
          <h3 className="text-lg font-semibold flex-1">Créditos de IA</h3>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" data-tooltip="Cerrar"
            className="p-1.5 -mr-1 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Números principales */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-surface rounded-card p-3 text-center">
            <div className="text-2xl font-bold text-accent tabular-nums">{c.saldo}</div>
            <div className="text-xs text-muted">Disponibles</div>
          </div>
          <div className="bg-surface rounded-card p-3 text-center">
            <div className="text-2xl font-bold text-on-surface tabular-nums">{usados}</div>
            <div className="text-xs text-muted">Utilizados en total</div>
          </div>
        </div>

        <p className="text-sm text-muted mb-4">
          Tus créditos NUNCA caducan ni se resetean — el saldo solo cambia cuando compras más o usas una función de IA.
        </p>

        {/* Agotamiento: se suspenden IA, Asistencia y el bonus de descarga de
            documentos (21-ago-2026) — todo lo demás de Evalúa Fácil sigue
            siendo 100% gratuito. */}
        {agotado && (
          <div className="bg-surface rounded-card border border-outline-variant p-3 mb-4 text-sm">
            <p className="font-medium text-on-surface mb-1">Te quedaste sin créditos de IA.</p>
            <p className="text-muted">
              Todas las funciones de Evalúa Fácil son totalmente gratuitas, excepto la IA, Asistencia y la descarga
              de documentos, que se pagan con créditos.
              {c.mostrarCTAActivarBienvenida
                ? ' Adquiere créditos para usarlas, o disfruta de tus 50 créditos de IA de regalo activándolos.'
                : ' Adquiere créditos para usarlas.'}
            </p>
            <button type="button" onClick={() => setComprarAbierto(true)}
              className="mt-2 px-3 py-1.5 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors">
              Comprar créditos
            </button>
          </div>
        )}

        {/* Comprar créditos — siempre disponible, no solo agotado */}
        {!agotado && (
          <button type="button" onClick={() => setComprarAbierto(true)}
            className="w-full mb-4 px-3 py-2 border border-outline-variant text-on-surface text-sm font-medium rounded-card hover:bg-[var(--accent-tint)] transition-colors">
            Comprar más créditos
          </button>
        )}

        {/* Consumo por categorías (histórico total, no por ciclo) */}
        <h4 className="text-sm font-semibold text-on-surface mb-2">Consumo por categoría (histórico)</h4>
        {categorias.length === 0 ? (
          <p className="text-sm text-muted mb-4">Todavía no has utilizado créditos.</p>
        ) : (
          <ul className="mb-4 space-y-1">
            {categorias.map(([nombre, cant]) => (
              <li key={nombre} className="flex justify-between text-sm">
                <span className="text-on-surface">{nombre}</span>
                <span className="font-medium tabular-nums text-on-surface">{cant}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ComprarCreditosModal open={comprarAbierto} onClose={() => setComprarAbierto(false)} />
    </div>
  )
}
