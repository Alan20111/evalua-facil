// Barra de créditos IA — permanentemente visible en la interfaz del docente.
//
// "IA · 284 créditos" (sin "de X": créditos puros sin capacidad, 20-ago-2026
// — ver docs/ia/PLAN_TECNICO_CREDITOS_PUROS.md). El docente sabe cuánto
// tiene sin entrar a ninguna sección especial (regla del PO). Clic → panel
// de detalle. El saldo llega por snapshot desde iaCreditos/{uid}: aquí no se
// calcula ni se descuenta nada.
//
// Avisos por UMBRAL ABSOLUTO (no por %, que perdió sentido sin capacidad):
// 10 / 3 / 0 créditos restantes. Cada umbral se anuncia UNA vez por saldo
// (marca en localStorage por uid+saldo) — discreto y sin repetirse.

import { useEffect, useState } from 'react'
import { Sparkles, Gift } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import useCreditosIA from '../hooks/useCreditosIA'
import CreditosPanel from './CreditosPanel'
import ActivarCreditosModal from './ActivarCreditosModal'

const UMBRALES = [10, 3, 0] // créditos restantes

function umbralAlcanzado(saldo) {
  let alcanzado = null
  for (const u of UMBRALES) if (saldo <= u) alcanzado = u
  return alcanzado
}

export default function CreditosBar({ variant = 'sidebar' }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const c = useCreditosIA()
  const [panelAbierto, setPanelAbierto] = useState(false)
  const [activarAbierto, setActivarAbierto] = useState(false)

  // Aviso de umbral: una sola vez por saldo (aunque recargue o cambie de
  // dispositivo se tolera repetir — el candado fuerte es por navegador).
  useEffect(() => {
    // Saldo 0 antes de activar la bienvenida no es "te quedaste sin
    // créditos" — es "todavía no activaste los tuyos". El aviso de umbral
    // solo aplica una vez que ya hay bienvenida activada (o nunca hubo
    // bienvenida que ofrecer, cuentas viejas).
    if (!c.listo || !currentUser || c.mostrarCTAActivarBienvenida) return
    const u = umbralAlcanzado(c.saldo)
    if (u === null) return
    const llave = `ia-aviso-${currentUser.uid}-${u}`
    if (localStorage.getItem(llave)) return
    localStorage.setItem(llave, '1')
    if (u === 0) {
      // El mensaje completo de agotamiento vive en el panel; el toast solo avisa.
      toast('Te quedaste sin créditos de IA. El resto de Evalúa Fácil sigue disponible; compra más créditos para seguir usando la IA.')
    } else if (u === 3) {
      toast(`Te quedan ${c.saldo} créditos de IA. Considera comprar más para no quedarte sin ellos.`)
    } else {
      toast(`Te quedan ${c.saldo} créditos de IA.`)
    }
  }, [c.listo, c.saldo, c.mostrarCTAActivarBienvenida, currentUser, toast])

  if (!c.esDocente || !c.listo) return null

  const critico = c.saldo <= 3
  const bajo = c.saldo <= 10

  if (variant === 'movil') {
    // Chip compacto en la cabecera móvil: "IA 284", o el regalo por activar.
    return (
      <>
        <button
          type="button"
          onClick={() => (c.mostrarCTAActivarBienvenida ? setActivarAbierto(true) : setPanelAbierto(true))}
          aria-label={c.mostrarCTAActivarBienvenida ? 'Activa tus 30 créditos IA de regalo' : `Créditos de IA: ${c.saldo} disponibles`}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-surface-container transition-colors"
        >
          {c.mostrarCTAActivarBienvenida ? (
            <Gift size={16} className="text-accent" />
          ) : (
            <>
              <Sparkles size={16} className={critico ? 'text-error' : 'text-accent'} />
              <span className={`text-xs font-semibold tabular-nums ${critico ? 'text-error' : 'text-on-surface'}`}>{c.saldo}</span>
            </>
          )}
        </button>
        {panelAbierto && <CreditosPanel onCerrar={() => setPanelAbierto(false)} />}
        <ActivarCreditosModal open={activarAbierto} onClose={() => setActivarAbierto(false)} />
      </>
    )
  }

  // Variante sidebar (fondo azul del plano del docente).
  return (
    <>
      <div className="px-2 py-2 border-t border-white/15">
        <button
          type="button"
          onClick={() => (c.mostrarCTAActivarBienvenida ? setActivarAbierto(true) : setPanelAbierto(true))}
          aria-label={c.mostrarCTAActivarBienvenida ? 'Activa tus 30 créditos IA de regalo' : `Créditos de IA: ${c.saldo} disponibles. Ver detalle`}
          className={
            c.mostrarCTAActivarBienvenida
              ? 'w-full px-3 py-2 rounded-lg text-left bg-white text-accent font-semibold shadow-md hover:bg-white/90 transition-colors'
              : 'w-full px-3 py-2 rounded text-left hover:bg-white/10 transition-colors'
          }
        >
          {c.mostrarCTAActivarBienvenida ? (
            <div className="flex items-center gap-2 text-body-sm">
              <Gift size={16} className="flex-shrink-0" />
              <span className="flex-1">Activa tus 30 créditos IA de regalo</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-body-sm text-white/90">
              <Sparkles size={15} className={`flex-shrink-0 ${critico ? 'text-red-300' : bajo ? 'text-amber-300' : ''}`} />
              <span className="flex-1">IA · <span className="font-semibold tabular-nums">{c.saldo}</span> créditos</span>
            </div>
          )}
        </button>
      </div>
      {panelAbierto && <CreditosPanel onCerrar={() => setPanelAbierto(false)} />}
      <ActivarCreditosModal open={activarAbierto} onClose={() => setActivarAbierto(false)} />
    </>
  )
}
