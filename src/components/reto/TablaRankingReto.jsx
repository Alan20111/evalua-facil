// Reto Exprés · tabla del ranking (etapa B, 5-nov-2026). La usan el ranking en vivo del docente (panel de la pantalla en
// vivo), el ranking en vivo del estudiante («Ver ranking en vivo») y el ranking final de Resultados. Solo muestra lo que
// ya trae cada fila: puesto, nombre visible, aciertos, tiempo total (acumulado en respuestas correctas) y, con una
// pregunta abierta, si ya la respondió. Nunca muestra opciones ni respuestas: las filas no las traen.
//
// Desde el 7-nov-2026 (decisión de Kike) no hay columnas por pregunta (P1…Pn): solo «Tiempo total». El orden, los
// aciertos y el desempate no cambian: los calcula retoExpres.js antes de llegar aquí, y el servidor sigue guardando el
// tiempo de cada respuesta.
import { useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Badge, Table } from '../ui'
import { ICONO } from '../../config/iconos'
import { textoTiempoReto } from '../../utils/retoExpres'

/**
 * Cambios de posición desde la última vez que cambió la tabla: Map clave → lugares que subió (+) o bajó (−). Se
 * conservan hasta el siguiente cambio de la tabla, para que la flecha se alcance a ver.
 */
function useCambiosPosicion(filas, clave) {
  const firma = (filas || []).map((f) => `${clave(f)}\u0000${f.posicion}`).join('\u0001')
  const [foto, setFoto] = useState({ firma: '', posiciones: new Map(), cambios: new Map() })
  if (foto.firma !== firma) {
    const posiciones = new Map((filas || []).map((f) => [clave(f), f.posicion]))
    const cambios = new Map()
    for (const [k, p] of posiciones) {
      const antes = foto.posiciones.get(k)
      if (Number.isInteger(antes) && antes !== p) cambios.set(k, antes - p)
    }
    setFoto({ firma, posiciones, cambios: cambios.size || !foto.firma ? cambios : foto.cambios })
  }
  return foto.cambios
}

function Cambio({ delta }) {
  if (!delta) return null
  const sube = delta > 0
  const Icono = sube ? ArrowUp : ArrowDown
  const n = Math.abs(delta)
  return (
    <span className={`inline-flex items-center text-xs font-semibold ${sube ? 'text-emerald-700' : 'text-red-700'}`}>
      <Icono size={ICONO.sm} aria-hidden="true" />{n}
      <span className="sr-only">{sube ? `subió ${n}` : `bajó ${n}`} {n === 1 ? 'lugar' : 'lugares'}</span>
    </span>
  )
}

/**
 * `filas`: [{ posicion, nombreVisible, aciertos, tiempoDecimas, respondioActual, esPropia? }].
 * `abierta`: índice de la pregunta que se responde (o null): con ella aparece la columna «Estado».
 * `clave(fila)`: identifica la fila para los cambios de posición. `extra(fila)`: segunda línea opcional bajo el nombre
 * (el docente ve ahí el nombre real detrás de un alias).
 */
export default function TablaRankingReto({ filas = [], abierta = null, diferidas = 0, clave = (f) => f.nombreVisible, extra = null, vacio = 'Todavía no hay participantes.' }) {
  const cambios = useCambiosPosicion(filas, clave)
  const hayAbierta = Number.isInteger(abierta)
  const columnas = [
    {
      key: 'puesto', header: 'Puesto', align: 'right', className: 'whitespace-nowrap',
      render: (f) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          <Cambio delta={cambios.get(clave(f))} />
          <span className="font-semibold text-accent tabular-nums">{f.posicion}</span>
        </span>
      ),
    },
    {
      key: 'nombre', header: 'Participante',
      render: (f) => (
        <span className="block min-w-0">
          <span className={`block truncate text-on-surface ${f.esPropia ? 'font-semibold' : ''}`}>{f.nombreVisible}{f.esPropia ? ' (tú)' : ''}</span>
          {extra && extra(f) && <span className="block truncate text-xs text-hint">{extra(f)}</span>}
        </span>
      ),
    },
    { key: 'aciertos', header: 'Aciertos', align: 'right', render: (f) => <span className="tabular-nums font-semibold text-on-surface">{f.aciertos}</span> },
    {
      key: 'total', header: 'Tiempo total', align: 'right', className: 'whitespace-nowrap',
      render: (f) => <span className="tabular-nums text-on-surface">{textoTiempoReto(Number.isInteger(f.tiempoDecimas) ? f.tiempoDecimas : 0)}</span>,
    },
    ...(hayAbierta ? [{
      key: 'estado', header: 'Estado', className: 'whitespace-nowrap',
      render: (f) => (f.respondioActual ? <Badge tone="success">Respondió</Badge> : <Badge>Pendiente</Badge>),
    }] : []),
  ]
  return (
    <div className="space-y-2">
      <Table columns={columnas} data={filas} rowKey={(f, i) => `${clave(f)}-${i}`} emptyMessage={vacio} minWidth={hayAbierta ? 520 : 420} />
      <p className="text-xs text-muted">
        Ordenado por aciertos; a iguales aciertos, por menos tiempo total en las respuestas correctas.
        {diferidas > 0 ? ' Las preguntas de verdadero/falso o de dos opciones se suman al terminar el reto.' : ''}
      </p>
    </div>
  )
}
