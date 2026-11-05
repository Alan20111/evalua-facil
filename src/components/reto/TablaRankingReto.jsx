// Reto Exprés · tabla del ranking (etapa B, 5-nov-2026). La usan el ranking en vivo del docente (su ventana aparte), el
// ranking en vivo del estudiante («Ver ranking en vivo») y el ranking final. Solo muestra lo que ya trae cada fila:
// puesto, nombre visible, aciertos, tiempo de cada pregunta, tiempo acumulado en respuestas correctas y si ya respondió
// la pregunta abierta. Nunca muestra opciones ni respuestas: las filas no las traen.
//
// Casillas de tiempo: un número = tiempo en responder (aunque haya fallado); «—» = sin respuesta en una pregunta ya
// cerrada (no se inventa un tiempo); «…» = todavía no responde la pregunta abierta; vacía = pregunta que aún no se hace.
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

function CasillaTiempo({ valor, estado }) {
  if (estado === 'futura') return <span aria-hidden="true" />
  if (Number.isInteger(valor)) return <span className="tabular-nums">{textoTiempoReto(valor)}</span>
  if (estado === 'abierta') return <span className="text-hint" title="Todavía no responde">…<span className="sr-only">todavía no responde</span></span>
  return <span className="text-hint" title="Sin respuesta">—<span className="sr-only">sin respuesta</span></span>
}

/**
 * `filas`: [{ posicion, nombreVisible, aciertos, tiempoDecimas, tiempos, respondioActual, esPropia? }].
 * `preguntas`: cuántas columnas P1…Pn. `cerradas`: cuántas ya se cerraron. `abierta`: índice de la que se responde
 * (o null). `clave(fila)`: identifica la fila para los cambios de posición. `extra(fila)`: segunda línea opcional
 * bajo el nombre (el docente ve ahí el nombre real detrás de un alias).
 */
export default function TablaRankingReto({ filas = [], preguntas = 10, cerradas = 0, abierta = null, diferidas = 0, clave = (f) => f.nombreVisible, extra = null, vacio = 'Todavía no hay participantes.' }) {
  const cambios = useCambiosPosicion(filas, clave)
  const hayAbierta = Number.isInteger(abierta)
  const estadoDe = (i) => (hayAbierta && i === abierta ? 'abierta' : i < cerradas ? 'cerrada' : 'futura')
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
    ...Array.from({ length: preguntas }, (_, i) => ({
      key: `p${i}`, header: `P${i + 1}`, align: 'right', className: 'whitespace-nowrap',
      headerClassName: hayAbierta && i === abierta ? 'text-accent' : '',
      render: (f) => <CasillaTiempo valor={f.tiempos?.[i]} estado={estadoDe(i)} />,
    })),
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
      <Table columns={columnas} data={filas} rowKey={(f, i) => `${clave(f)}-${i}`} emptyMessage={vacio} minWidth={560 + preguntas * 56} />
      <p className="text-xs text-muted">
        Ordenado por aciertos; a iguales aciertos, por menos tiempo en las respuestas correctas. «—» sin respuesta
        {hayAbierta ? ' · «…» todavía no responde' : ''}.
        {diferidas > 0 ? ' Las preguntas de verdadero/falso o de dos opciones se suman al terminar el reto.' : ''}
      </p>
    </div>
  )
}
