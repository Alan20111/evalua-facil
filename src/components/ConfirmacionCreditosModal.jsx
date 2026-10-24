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

import { useState } from 'react'
import { WandSparkles } from 'lucide-react'
import useCreditosIA from '../hooks/useCreditosIA'
import ComprarCreditosModal from './ComprarCreditosModal'
import { PUEDE_COMPRAR } from '../utils/platform'
import ActivarCreditosModal from './ActivarCreditosModal'
import { Animado, Button, Modal } from './ui'
import { ICONO } from '../config/iconos'
import Spinner from './Spinner'

export default function ConfirmacionCreditosModal({
  titulo = 'Usar el asistente de IA',
  descripcion = null,
  children = null,   // controles extra (p.ej. cuántos criterios/niveles) — se muestran ANTES de reservar créditos
  costoMin,
  costoMax = null,
  ejecutando = false,
  continuarDeshabilitado = false,   // deshabilita "Continuar" mientras un control interno (children) esté inválido
  textoCosto = null,   // si se pasa, es la ÚNICA línea de costo que se muestra (p. ej. "Costo del análisis: 12 créditos")
  // Opcional: qué decirle al docente MIENTRAS `ejecutando` (operaciones que
  // tardan minutos, p. ej. Planeación Didáctica). Sustituye el cuerpo del
  // modal durante la espera — así tampoco salta a "No tienes suficientes
  // créditos" cuando el snapshot ya refleja la reserva. Sin esta prop el
  // modal se comporta exactamente igual que antes.
  avisoEjecutando = null,
  // `exacto` (oct-2026): el costo lo calculó el servidor y es el que se
  // cobrará (p. ej. "Calificar todas con IA"): sin «aproximadamente». Sin
  // esta prop el texto queda como siempre.
  exacto = false,
  // `costoPendiente` (oct-2026): el costo todavía no se conoce (se está
  // calculando o falló el cálculo). No se muestra NINGÚN importe —nunca «0
  // créditos»— ni se juzga el saldo, y "Continuar" queda deshabilitado; el
  // estado («Calculando el precio…» o el error) lo muestra `children`.
  costoPendiente = false,
  onCancelar,
  onContinuar,
  z = 50, // sobre una pantalla que ya está a z-60 (p. ej. la proyección de Participación en vivo)
}) {
  const c = useCreditosIA()
  const [comprarAbierto, setComprarAbierto] = useState(false)
  const [activarAbierto, setActivarAbierto] = useState(false)
  // Con costo exacto, todos los importes con dos decimales (3.50, 46.50).
  const fmt = (n) => (exacto ? (Math.round(Number(n) * 100) / 100).toFixed(2) : n)
  const max = costoMax ?? costoMin
  const rango = max !== costoMin ? `${fmt(costoMin)}–${fmt(max)}` : `${fmt(costoMin)}`
  const restanteMin = c.saldo - max
  const restanteMax = c.saldo - costoMin
  const restante = restanteMin !== restanteMax ? `${fmt(restanteMin)}–${fmt(restanteMax)}` : `${fmt(restanteMin)}`
  const alcanza = costoPendiente || c.saldo >= max

  return (
    <>
      {/* Con un sub-modal (comprar/activar) abierto, Escape y el fondo solo
          deben cerrar ese, no también esta confirmación. */}
      <Modal
        open
        onClose={onCancelar}
        busy={comprarAbierto || activarAbierto}
        ariaLabel={titulo}
        variant="sheet"
        size="sm"
        z={z}
        padding="p-5"
      >
        <div className="flex items-center gap-2 mb-3">
          <Animado efecto="varita" cuando="activo" activo={ejecutando} className="text-accent"><WandSparkles size={ICONO.md} /></Animado>
          <h3 className="text-base font-semibold flex-1">{titulo}</h3>
        </div>

        {ejecutando && avisoEjecutando ? (
          <output aria-live="polite" className="flex items-start gap-3">
            <div className="pt-0.5 flex-shrink-0"><Spinner size="sm" /></div>
            <div className="text-sm text-on-surface">{avisoEjecutando}</div>
          </output>
        ) : alcanza ? (
          <>
            {descripcion && <p className="text-sm text-muted mb-2">{descripcion}</p>}
            {children && <div className="mb-3">{children}</div>}
            {costoPendiente ? (
              <div className="mb-4" />
            ) : textoCosto ? (
              <p className="text-sm font-semibold text-on-surface mb-4">{textoCosto}</p>
            ) : (
              <>
                <p className="text-sm text-on-surface mb-1">
                  Esta acción utilizará {exacto ? '' : 'aproximadamente '}<span className="font-semibold">{rango} {max === 1 ? 'crédito' : 'créditos'}</span> de IA.
                </p>
                <p className="text-sm text-on-surface mb-1">
                  Tienes <span className="font-semibold tabular-nums">{fmt(c.saldo)}</span> créditos disponibles.
                </p>
                <p className="text-sm text-muted mb-4">
                  Después de realizarla tendrás {exacto ? '' : 'aproximadamente '}{restante}.
                </p>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="quiet" onClick={onCancelar} disabled={ejecutando}>
                Cancelar
              </Button>
              <Button onClick={onContinuar} disabled={ejecutando || continuarDeshabilitado || costoPendiente}>
                {ejecutando ? 'Trabajando…' : 'Continuar'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-on-surface mb-1">
              No tienes suficientes créditos para realizar esta acción.
            </p>
            {/* Con costo exacto, el desglose se sigue viendo: el docente sabe
                cuánto le falta y por qué. */}
            {exacto && children && <div className="mb-3">{children}</div>}
            <p className="text-sm text-muted mb-4">
              Esta acción requiere {exacto ? '' : 'aproximadamente '}{rango} {max === 1 ? 'crédito' : 'créditos'} y tienes {fmt(c.saldo)} disponibles.
              {c.mostrarCTAActivarBienvenida && (PUEDE_COMPRAR
                ? ' Puedes comprar créditos o activar tus créditos de regalo.'
                : ' Puedes activar tus créditos de regalo.')}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="quiet" onClick={onCancelar}>
                Cerrar
              </Button>
              {c.mostrarCTAActivarBienvenida && (
                <Button variant="outline-accent" onClick={() => setActivarAbierto(true)}>
                  Activar créditos de regalo
                </Button>
              )}
              {PUEDE_COMPRAR && (
                <Button onClick={() => setComprarAbierto(true)}>
                  Comprar créditos
                </Button>
              )}
            </div>
          </>
        )}
      </Modal>
      {PUEDE_COMPRAR && <ComprarCreditosModal open={comprarAbierto} onClose={() => setComprarAbierto(false)} />}
      <ActivarCreditosModal open={activarAbierto} onClose={() => setActivarAbierto(false)} onSuccess={onCancelar} />
    </>
  )
}
