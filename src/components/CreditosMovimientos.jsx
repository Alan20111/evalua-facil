// Registro de movimientos de créditos IA — tabla de movimientos del mes dentro
// del panel de créditos. Solo lectura: lo que se muestra lo escribió el servidor
// en la misma transacción que movió el saldo. Un mes por vez (sin índices ni
// orderBy). Tres columnas: Fecha, Concepto y Créditos.
//
// «Sin cobro» = la operación falló, expiró o se canceló y NO se descontó nada.
// El Chat con Asistente (función retirada) nunca se muestra: ver
// utils/movimientosCreditos.js.

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import useMovimientosCreditos from '../hooks/useMovimientosCreditos'
import {
  FILTROS, desplazarPeriodo, detalleMovimiento, etiquetaPeriodo, importeMovimiento,
  partesFechaMovimiento, periodoDe, prepararMovimientos, tituloMovimiento,
} from '../utils/movimientosCreditos'
import { Chip, IconButton, Table } from './ui'

const TONO = { abono: 'text-emerald-700', cargo: 'text-on-surface', neutro: 'text-muted' }

const COLUMNAS = [
  {
    key: 'fecha',
    header: 'Fecha',
    className: 'align-top w-24',
    headerClassName: 'w-24',
    render: (m) => {
      const { dia, hora } = partesFechaMovimiento(m.fecha)
      return (
        <>
          <span className="block text-on-surface">{dia}</span>
          <span className="block text-xs text-muted">{hora}</span>
        </>
      )
    },
  },
  {
    key: 'concepto',
    header: 'Concepto',
    className: 'align-top',
    render: (m) => {
      const detalle = detalleMovimiento(m)
      return (
        <>
          <span className="block text-on-surface break-words">{tituloMovimiento(m)}</span>
          {detalle && <span className="block text-xs text-muted">{detalle}</span>}
          {m.origen === 'historico' && <span className="block text-xs text-muted">Registro anterior</span>}
        </>
      )
    },
  },
  {
    key: 'creditos',
    header: 'Créditos',
    align: 'right',
    className: 'align-top whitespace-nowrap',
    render: (m) => {
      const { texto, tono } = importeMovimiento(m.delta)
      return <span className={`font-semibold tabular-nums ${TONO[tono]}`}>{texto}</span>
    },
  },
]

export default function CreditosMovimientos() {
  const actual = useMemo(() => periodoDe(), [])
  const [periodo, setPeriodo] = useState(actual)
  const [filtro, setFiltro] = useState('todos')
  const { movimientos, cargando, error } = useMovimientosCreditos(periodo)

  const lista = useMemo(() => prepararMovimientos(movimientos, { filtro }), [movimientos, filtro])

  return (
    <section aria-label="Registro de movimientos de créditos" className="mt-6 pb-24 md:pb-0">
      <h4 className="text-sm font-semibold text-on-surface mb-2">Registro de movimientos</h4>

      <div className="flex items-center justify-between gap-2 mb-2">
        <IconButton icon={ChevronLeft} label="Mes anterior" tooltip={false} onClick={() => setPeriodo((p) => desplazarPeriodo(p, -1))} />
        <span className="text-sm font-medium text-on-surface" data-testid="movimientos-periodo">{etiquetaPeriodo(periodo)}</span>
        <IconButton icon={ChevronRight} label="Mes siguiente" tooltip={false} disabled={periodo >= actual} onClick={() => setPeriodo((p) => desplazarPeriodo(p, 1))} />
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {FILTROS.map((f) => (
          <Chip key={f.id} selected={filtro === f.id} onClick={() => setFiltro(f.id)}>{f.etiqueta}</Chip>
        ))}
      </div>

      {cargando ? (
        <p className="text-sm text-muted">Cargando movimientos…</p>
      ) : error ? (
        <p className="text-sm text-muted">No se pudieron cargar tus movimientos. Intenta de nuevo más tarde.</p>
      ) : (
        <Table
          columns={COLUMNAS}
          data={lista}
          rowKey={(m) => m.id}
          emptyMessage="No hay movimientos en este mes."
          minWidth={0}
        />
      )}
    </section>
  )
}
