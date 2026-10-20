// Registro de movimientos de créditos IA — lista de movimientos del mes dentro del panel de
// créditos. Solo lectura: lo que se muestra lo escribió el servidor en la misma
// transacción que movió el saldo. Un mes por vez (sin índices ni orderBy).
//
// «Sin cobro» = la operación falló, expiró o se canceló y NO se descontó nada.
// El saldo posterior solo se enseña cuando existe (registros del historial
// anterior no lo tienen y no se inventa).

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import useMovimientosCreditos from '../hooks/useMovimientosCreditos'
import {
  FILTROS, desplazarPeriodo, detalleMovimiento, etiquetaPeriodo, formatoFechaMovimiento,
  periodoDe, prepararMovimientos, tituloMovimiento,
} from '../utils/movimientosCreditos'
import { formatCreditos } from '../utils/creditosHelpers'
import { Chip, Checkbox, IconButton } from './ui'

function Importe({ delta }) {
  if (!delta) return <span className="text-sm font-semibold tabular-nums text-muted">0</span>
  const abono = delta > 0
  return (
    <span className={`text-sm font-semibold tabular-nums ${abono ? 'text-emerald-700' : 'text-on-surface'}`}>
      {abono ? '+' : '−'}{formatCreditos(Math.abs(delta))}
    </span>
  )
}

export default function CreditosMovimientos() {
  const actual = useMemo(() => periodoDe(), [])
  const [periodo, setPeriodo] = useState(actual)
  const [filtro, setFiltro] = useState('todos')
  const [mostrarChat, setMostrarChat] = useState(false)
  const { movimientos, cargando, error } = useMovimientosCreditos(periodo)

  const lista = useMemo(
    () => prepararMovimientos(movimientos, { filtro, mostrarChatSinCosto: mostrarChat }),
    [movimientos, filtro, mostrarChat]
  )

  return (
    <section aria-label="Registro de movimientos de créditos" className="mt-6 pb-24 md:pb-0">
      <h4 className="text-sm font-semibold text-on-surface mb-2">Registro de movimientos</h4>

      <div className="flex items-center justify-between gap-2 mb-2">
        <IconButton icon={ChevronLeft} label="Mes anterior" tooltip={false} onClick={() => setPeriodo((p) => desplazarPeriodo(p, -1))} />
        <span className="text-sm font-medium text-on-surface" data-testid="movimientos-periodo">{etiquetaPeriodo(periodo)}</span>
        <IconButton icon={ChevronRight} label="Mes siguiente" tooltip={false} disabled={periodo >= actual} onClick={() => setPeriodo((p) => desplazarPeriodo(p, 1))} />
      </div>

      <div className="flex flex-wrap gap-2 mb-2">
        {FILTROS.map((f) => (
          <Chip key={f.id} selected={filtro === f.id} onClick={() => setFiltro(f.id)}>{f.etiqueta}</Chip>
        ))}
      </div>

      <Checkbox
        label="Mostrar Chat con Asistente sin costo"
        checked={mostrarChat}
        onChange={(e) => setMostrarChat(e.target.checked)}
        wrapperClassName="mb-3"
      />

      {cargando ? (
        <p className="text-sm text-muted">Cargando movimientos…</p>
      ) : error ? (
        <p className="text-sm text-muted">No se pudieron cargar tus movimientos. Intenta de nuevo más tarde.</p>
      ) : lista.length === 0 ? (
        <p className="text-sm text-muted">No hay movimientos en este mes.</p>
      ) : (
        <ul className="divide-y divide-outline-variant">
          {lista.map((m) => {
            const detalle = detalleMovimiento(m)
            return (
              <li key={m.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-on-surface break-words">{tituloMovimiento(m)}</p>
                  <p className="text-xs text-muted">
                    {formatoFechaMovimiento(m.fecha)}
                    {m.origen === 'historico' && ' · Registro anterior'}
                  </p>
                  {detalle && <p className="text-xs text-muted">{detalle}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <Importe delta={m.delta} />
                  {typeof m.saldoDespues === 'number' && (
                    <p className="text-xs text-muted tabular-nums">Saldo: {formatCreditos(m.saldoDespues)}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
