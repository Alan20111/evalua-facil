// Panel de detalle de créditos IA — se abre al tocar la barra.
//
// Muestra: disponibles / utilizados / totales, fecha de renovación, plan
// actual, resumen del consumo por categorías y la referencia informativa del
// Plan Mayor. NUNCA muestra tokens ni el costo monetario que Evalúa Fácil
// paga por la IA: el docente piensa en créditos (regla del PO).
//
// A 0 créditos SOLO se suspende la IA: el mensaje lo dice explícitamente y
// el resto del producto sigue funcionando (asignaturas, evidencias,
// calificaciones, reportes…). En trial, el llamado a la acción es contratar
// el Plan Docente de $99; en planes de pago, consultar el Plan Mayor.

import { X, Sparkles, CalendarClock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import useCreditosIA from '../hooks/useCreditosIA'

function fechaCorta(d) {
  if (!d) return '—'
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })
}

export default function CreditosPanel({ onCerrar }) {
  const c = useCreditosIA()
  const navigate = useNavigate()
  if (!c.listo) return null

  const usados = c.consumidoCiclo
  const agotado = c.saldo === 0 && !!c.creditos
  const infoMayor = c.tarifas?.planes?.mayor
  const infoDocente = c.tarifas?.planes?.pro

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
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-surface rounded-card p-3 text-center">
            <div className="text-2xl font-bold text-accent tabular-nums">{c.saldo}</div>
            <div className="text-xs text-muted">Disponibles</div>
          </div>
          <div className="bg-surface rounded-card p-3 text-center">
            <div className="text-2xl font-bold text-on-surface tabular-nums">{usados}</div>
            <div className="text-xs text-muted">Utilizados</div>
          </div>
          <div className="bg-surface rounded-card p-3 text-center">
            <div className="text-2xl font-bold text-on-surface tabular-nums">{c.capacidad}</div>
            <div className="text-xs text-muted">Totales</div>
          </div>
        </div>

        <div className="h-2 rounded-full bg-surface-container overflow-hidden mb-3" aria-hidden="true">
          <div className={`h-full rounded-full ${c.pct <= 10 ? 'bg-error' : 'bg-accent'}`} style={{ width: `${c.pct}%` }} />
        </div>

        {/* Renovación y plan */}
        <div className="flex items-center gap-2 text-sm text-on-surface mb-1">
          <CalendarClock size={16} className="text-muted flex-shrink-0" />
          {c.esTrial
            ? <span>Tu periodo de prueba incluye {c.capacidad} créditos (no se renuevan durante la prueba).</span>
            : <span>Tus créditos se renuevan el <span className="font-medium">{fechaCorta(c.cicloFin)}</span>. Los no utilizados no se acumulan.</span>}
        </div>
        <p className="text-sm text-muted mb-4">
          Plan actual: <span className="font-medium text-on-surface">{c.etiquetaPlan}</span>
          {!c.esTrial && c.plan !== 'mayor' && infoDocente ? ` · $${infoDocente.precioMXN}/mes` : ''}
          {c.plan === 'mayor' && infoMayor ? ` · $${infoMayor.precioMXN}/mes` : ''}
        </p>

        {/* Agotamiento: SOLO se suspende la IA, el resto sigue */}
        {agotado && (
          <div className="bg-surface rounded-card border border-outline-variant p-3 mb-4 text-sm">
            <p className="font-medium text-on-surface mb-1">
              {c.esTrial ? 'Terminó tu capacidad de IA de prueba.' : 'Has utilizado tus créditos de IA de este mes.'}
            </p>
            <p className="text-muted">
              Tus asignaturas, estudiantes, evidencias y calificaciones siguen disponibles.
              {c.esTrial
                ? ' Para seguir usando la IA, activa el Plan Docente.'
                : ` Tus créditos se renovarán el ${fechaCorta(c.cicloFin)}.`}
            </p>
            {c.esTrial && infoDocente && (
              <button type="button" onClick={() => { onCerrar(); navigate('/profile') }}
                className="mt-2 px-3 py-1.5 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors">
                Contratar {infoDocente.nombre} · ${infoDocente.precioMXN}/mes
              </button>
            )}
          </div>
        )}

        {/* Consumo por categorías */}
        <h4 className="text-sm font-semibold text-on-surface mb-2">Consumo de este ciclo</h4>
        {categorias.length === 0 ? (
          <p className="text-sm text-muted mb-4">Todavía no has utilizado créditos en este ciclo.</p>
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

        {/* Referencia del Plan Mayor (informativa; contratación aún no disponible) */}
        {infoMayor && c.plan !== 'mayor' && (
          <div className="bg-surface rounded-card p-3 text-sm">
            <p className="font-medium text-on-surface">
              {infoMayor.nombre} · ${infoMayor.precioMXN}/mes · {infoMayor.creditos.toLocaleString('es-MX')} créditos
            </p>
            <p className="text-muted">Para quien utiliza intensivamente la IA. Próximamente disponible.</p>
          </div>
        )}
      </div>
    </div>
  )
}
