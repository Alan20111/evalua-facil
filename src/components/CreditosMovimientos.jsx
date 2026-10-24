// Registro de movimientos de créditos IA — tabla de movimientos del mes dentro
// del panel de créditos. Solo lectura: lo que se muestra lo escribió el servidor
// en la misma transacción que movió el saldo. Un mes por vez (sin índices ni
// orderBy). Cinco columnas: Fecha, Saldo anterior, Concepto, Créditos y Saldo
// nuevo — cada fila se lee sola: saldo anterior ± créditos = saldo nuevo, y el
// saldo nuevo de una fila es el saldo anterior de la siguiente. Los saldos son
// los que guardó el ledger (nunca se inventan; «—» si no se conocen).
//
// «Sin cobro» = la operación falló, expiró o se canceló y NO se descontó nada.
// El Chat con Asistente (función retirada) nunca se muestra: ver
// utils/movimientosCreditos.js.

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import useMovimientosCreditos from '../hooks/useMovimientosCreditos'
import useConsumosHistoricos from '../hooks/useConsumosHistoricos'
import useCortesHistoricos from '../hooks/useCortesHistoricos'
import {
  FILTROS, INICIO_MODELO_CREDITOS, avisosMovimientos, desgloseMovimiento, desplazarPeriodo, detalleMovimiento,
  esModeloAnterior, etiquetaPeriodo, importeMovimiento, insertarCortes, partesFechaMovimiento, periodoDe,
  prepararMovimientos, saldoAnteriorMovimiento, saldoMovimiento, textoCorte, tituloMovimiento,
} from '../utils/movimientosCreditos'
import { Chip, IconButton, Table } from './ui'

// Abono en verde, cargo en rojo (token `error`), sin cobro en gris.
const TONO = { abono: 'text-emerald-700', cargo: 'text-error', neutro: 'text-muted' }

// En teléfono las cinco columnas caben sin desplazamiento horizontal: menos
// relleno lateral por celda (la tabla base usa px-4) y cifras un punto más
// chicas, para darle ancho al Concepto.
const CELDA_MOVIL = 'max-sm:!px-1.5'
const CIFRA = 'tabular-nums max-sm:text-xs'

// Saldo en el color de texto principal (casi negro), sea cargo o abono.
const columnaSaldo = (key, header, valor) => ({
  key,
  header,
  align: 'right',
  className: `align-top whitespace-nowrap ${CELDA_MOVIL}`,
  headerClassName: `${CELDA_MOVIL} max-sm:whitespace-normal max-sm:w-14`,
  render: (m) => <span className={`${CIFRA} text-on-surface`}>{valor(m)}</span>,
})

const COLUMNAS = [
  {
    key: 'fecha',
    header: 'Fecha',
    className: `align-top w-14 sm:w-24 ${CELDA_MOVIL}`,
    headerClassName: `w-14 sm:w-24 ${CELDA_MOVIL}`,
    render: (m) => {
      // Un corte no tiene fecha exacta: solo se sabe entre qué saldos ocurrió.
      if (m.tipo === 'corte') return <span className="block text-xs text-muted">Sin fecha</span>
      const { dia, hora } = partesFechaMovimiento(m.fecha)
      return (
        <>
          <span className="block text-on-surface max-sm:text-xs">{dia}</span>
          <span className="block text-xs text-muted">{hora}</span>
        </>
      )
    },
  },
  columnaSaldo('saldoAnterior', 'Saldo anterior', saldoAnteriorMovimiento),
  {
    key: 'concepto',
    header: 'Concepto',
    className: `align-top ${CELDA_MOVIL}`,
    headerClassName: CELDA_MOVIL,
    render: (m) => {
      if (m.tipo === 'corte') {
        const t = textoCorte(m)
        return (
          <span data-testid="movimiento-corte">
            <span className="block text-on-surface">{t.titulo}</span>
            <span className="block text-xs text-muted">{t.periodo}</span>
            <span className="block text-xs text-muted">{t.nota}</span>
          </span>
        )
      }
      const detalle = detalleMovimiento(m)
      return (
        <>
          <span className="block text-on-surface break-words">{tituloMovimiento(m)}</span>
          {m._desglose && <span className="block text-xs text-muted break-words" data-testid="movimiento-desglose">{m._desglose}</span>}
          {detalle && <span className="block text-xs text-muted">{detalle}</span>}
          {esModeloAnterior(m)
            ? <span className="block text-xs text-muted" data-testid="movimiento-modelo-anterior">Modelo anterior (antes del <span className="whitespace-nowrap">{INICIO_MODELO_CREDITOS}</span>)</span>
            : m.origen === 'historico' && <span className="block text-xs text-muted">Registro anterior</span>}
        </>
      )
    },
  },
  {
    key: 'creditos',
    header: 'Créditos',
    align: 'right',
    className: `align-top whitespace-nowrap ${CELDA_MOVIL}`,
    headerClassName: CELDA_MOVIL,
    render: (m) => {
      const { texto, tono } = importeMovimiento(m.delta)
      return <span className={`font-semibold ${CIFRA} ${TONO[tono]}`}>{texto}</span>
    },
  },
  columnaSaldo('saldo', 'Saldo nuevo', saldoMovimiento),
]

export default function CreditosMovimientos() {
  const actual = useMemo(() => periodoDe(), [])
  const [periodo, setPeriodo] = useState(actual)
  const [filtro, setFiltro] = useState('todos')
  const { movimientos, cargando, error } = useMovimientosCreditos(periodo)

  const ordenados = useMemo(() => prepararMovimientos(movimientos, { filtro }), [movimientos, filtro])
  // Desglose de "Calificación de evidencias": el `detalle` del movimiento o,
  // en los anteriores, lo comprobable de su consumo.
  const consumos = useConsumosHistoricos(ordenados)
  const lista = useMemo(
    () => ordenados.map((m) => ({ ...m, _desglose: desgloseMovimiento(m, consumos[m.id] || null) })),
    [ordenados, consumos],
  )
  const avisos = useMemo(() => avisosMovimientos(lista), [lista])
  // Créditos sin registro (cortes de la cadena): solo meses con historial importado.
  const cortes = useCortesHistoricos(movimientos.some((m) => m.origen === 'historico'))
  const filas = useMemo(() => (filtro === 'consumos' ? lista : insertarCortes(lista, cortes)), [lista, cortes, filtro])

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
        <>
        {avisos.sinSaldo && (
          <p className="text-xs text-muted mb-2" data-testid="aviso-sin-saldo">
            Algunos movimientos no tienen un saldo comprobable: en ellos la columna Saldo muestra «—» y solo se indica su importe.
          </p>
        )}
        {avisos.modeloAnterior && (
          <p className="text-xs text-muted mb-2" data-testid="aviso-modelo-anterior">
            Los movimientos marcados «Modelo anterior» son de antes del <span className="whitespace-nowrap">{INICIO_MODELO_CREDITOS}</span> y no cuentan en «Utilizados desde el <span className="whitespace-nowrap">{INICIO_MODELO_CREDITOS}</span>».
          </p>
        )}
        <Table
          columns={COLUMNAS}
          data={filas}
          rowKey={(m) => m.id}
          emptyMessage="No hay movimientos en este mes."
          minWidth={0}
        />
        </>
      )}
    </section>
  )
}
