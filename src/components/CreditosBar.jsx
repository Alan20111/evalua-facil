// Barra de créditos IA — permanentemente visible en la interfaz del docente.
//
// "IA · 284 / 350 créditos" con barra visual. El docente sabe cuánto tiene
// sin entrar a ninguna sección especial (regla del PO). Clic → panel de
// detalle. El saldo llega por snapshot desde iaCreditos/{uid}: aquí no se
// calcula ni se descuenta nada.
//
// Avisos de consumo (50% / 25% / 10% / 0%): discretos y sin repetirse — cada
// umbral se anuncia UNA vez por ciclo (marca en localStorage por uid+ciclo).
// La regla de experiencia manda: la barra informa, no asusta.

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import useCreditosIA from '../hooks/useCreditosIA'
import CreditosPanel from './CreditosPanel'

const UMBRALES = [50, 25, 10, 0] // % disponible

function umbralAlcanzado(pct) {
  // El umbral más exigente que ya se cruzó (pct disponible <= umbral).
  let alcanzado = null
  for (const u of UMBRALES) if (pct <= u) alcanzado = u
  return alcanzado
}

export default function CreditosBar({ variant = 'sidebar' }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const c = useCreditosIA()
  const [panelAbierto, setPanelAbierto] = useState(false)

  // Aviso de umbral: una sola vez por ciclo (aunque recargue o cambie de
  // dispositivo se tolera repetir — el candado fuerte es por navegador).
  useEffect(() => {
    if (!c.listo || !c.creditos || !currentUser) return
    const u = umbralAlcanzado(c.pct)
    if (u === null) return
    const ciclo = c.cicloFin ? c.cicloFin.getTime() : 'x'
    const llave = `ia-aviso-${currentUser.uid}-${ciclo}-${u}`
    if (localStorage.getItem(llave)) return
    localStorage.setItem(llave, '1')
    if (u === 0) {
      // El mensaje completo de agotamiento vive en el panel; el toast solo avisa.
      toast(c.esTrial
        ? 'Terminó tu capacidad de IA de prueba. El resto de Evalúa Fácil sigue disponible.'
        : 'Has utilizado tus créditos de IA de este mes. El resto de Evalúa Fácil sigue disponible.')
    } else if (u === 10) {
      toast(`Te quedan ${c.saldo} créditos de IA. Considera reservarlos para lo que más los necesite.`)
    } else if (u === 25) {
      toast(`Te quedan ${c.saldo} créditos de IA este mes.`)
    } else {
      toast('Has utilizado aproximadamente la mitad de tus créditos de IA.')
    }
  }, [c.listo, c.pct, c.saldo, c.creditos, c.cicloFin, c.esTrial, currentUser, toast])

  if (!c.esDocente || !c.listo) return null

  const critico = c.pct <= 10
  const bajo = c.pct <= 25

  if (variant === 'movil') {
    // Chip compacto en la cabecera móvil: "IA 284" + mini barra.
    return (
      <>
        <button
          type="button"
          onClick={() => setPanelAbierto(true)}
          aria-label={`Créditos de IA: ${c.saldo} de ${c.capacidad} disponibles`}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-surface-container transition-colors"
        >
          <Sparkles size={16} className={critico ? 'text-error' : 'text-accent'} />
          <span className={`text-xs font-semibold tabular-nums ${critico ? 'text-error' : 'text-on-surface'}`}>{c.saldo}</span>
        </button>
        {panelAbierto && <CreditosPanel onCerrar={() => setPanelAbierto(false)} />}
      </>
    )
  }

  // Variante sidebar (fondo azul del plano del docente).
  return (
    <>
      <div className="px-2 py-2 border-t border-white/15">
        <button
          type="button"
          onClick={() => setPanelAbierto(true)}
          aria-label={`Créditos de IA: ${c.saldo} de ${c.capacidad} disponibles. Ver detalle`}
          className="w-full px-3 py-2 rounded text-left hover:bg-white/10 transition-colors"
        >
          <div className="flex items-center gap-2 text-body-sm text-white/90">
            <Sparkles size={15} className="flex-shrink-0" />
            <span className="flex-1">IA · <span className="font-semibold tabular-nums">{c.saldo}</span> / {c.capacidad} créditos</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-white/20 overflow-hidden" aria-hidden="true">
            <div
              className={`h-full rounded-full transition-all ${critico ? 'bg-red-300' : bajo ? 'bg-amber-300' : 'bg-white'}`}
              style={{ width: `${c.pct}%` }}
            />
          </div>
        </button>
      </div>
      {panelAbierto && <CreditosPanel onCerrar={() => setPanelAbierto(false)} />}
    </>
  )
}
