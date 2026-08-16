// Estimación previa a CADA uso de IA — regla central del PO (9-ago-2026):
// antes de ejecutar, informar cuánto consumirá aproximadamente; la
// estimación NO descuenta nada, solo informa; el docente decide.
//
// Dos variantes en un solo componente:
//   · saldo suficiente  → "usará ~X créditos / tienes Y / te quedarán ~Z"
//     con [Cancelar] [Continuar];
//   · saldo insuficiente → la operación NO se ejecuta (jamás saldo negativo)
//     y se ofrece el camino correcto: Asistente IA Pro (pago) o Asistente IA (trial).
//
// Con la tarifa de enteros la estimación casi siempre es EXACTA; costoMax
// solo difiere en lotes (rango sin falsa precisión).

import { Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import useCreditosIA from '../hooks/useCreditosIA'

export default function ConfirmacionCreditosModal({
  titulo = 'Usar el asistente de IA',
  descripcion = null,
  children = null,   // controles extra (p.ej. cuántos criterios/niveles) — se muestran ANTES de reservar créditos
  costoMin,
  costoMax = null,
  ejecutando = false,
  onCancelar,
  onContinuar,
}) {
  const c = useCreditosIA()
  const navigate = useNavigate()
  const max = costoMax ?? costoMin
  const rango = max !== costoMin ? `${costoMin}–${max}` : `${costoMin}`
  const restanteMin = c.saldo - max
  const restanteMax = c.saldo - costoMin
  const restante = restanteMin !== restanteMax ? `${restanteMin}–${restanteMax}` : `${restanteMin}`
  const alcanza = c.saldo >= max
  const infoMayor = c.tarifas?.planes?.mayor
  const infoDocente = c.tarifas?.planes?.pro

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={onCancelar} aria-label="Cerrar" />
      <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 drop-shadow-2xl">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={18} className="text-accent flex-shrink-0" />
          <h3 className="text-base font-semibold flex-1">{titulo}</h3>
        </div>

        {alcanza ? (
          <>
            {descripcion && <p className="text-sm text-muted mb-2">{descripcion}</p>}
            {children && <div className="mb-3">{children}</div>}
            <p className="text-sm text-on-surface mb-1">
              Esta acción utilizará aproximadamente <span className="font-semibold">{rango} {max === 1 ? 'crédito' : 'créditos'}</span> de IA.
            </p>
            <p className="text-sm text-on-surface mb-1">
              Tienes <span className="font-semibold tabular-nums">{c.saldo}</span> créditos disponibles.
            </p>
            <p className="text-sm text-muted mb-4">
              Después de realizarla tendrás aproximadamente {restante}.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onCancelar} disabled={ejecutando}
                className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={onContinuar} disabled={ejecutando}
                className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors disabled:opacity-60">
                {ejecutando ? 'Trabajando…' : 'Continuar'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-on-surface mb-1">
              No tienes suficientes créditos para realizar esta acción.
            </p>
            <p className="text-sm text-muted mb-4">
              Esta acción requiere aproximadamente {rango} {max === 1 ? 'crédito' : 'créditos'} y tienes {c.saldo} disponibles.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onCancelar}
                className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
                Cerrar
              </button>
              {c.esTrial && infoDocente ? (
                <button type="button" onClick={() => navigate('/profile')}
                  className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors">
                  Contratar {infoDocente.nombre} · ${infoDocente.precioMXN}
                </button>
              ) : infoMayor ? (
                <button type="button" onClick={onCancelar} data-tooltip="Próximamente disponible"
                  className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors">
                  Ver {infoMayor.nombre}
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
