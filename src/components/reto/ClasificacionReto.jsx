// Reto Exprés · clasificación en el celular del participante (4-nov-2026). Todo lo calcula el servidor: aquí solo se
// muestra lo que llega de /api/subject/reto-estado (posición, puntos, cuántos compiten, qué falta para subir y la lista).
//   · TarjetaPosicion: la tarjeta grande («TU POSICIÓN: 4.º LUGAR»), entre preguntas y al esperar.
//   · FranjaPosicion: una línea fija mientras se responde, para que la posición siga a la vista.
//   · ListaClasificacion: la lista (10 primeros durante el juego; todos al final), con los 3 primeros destacados y la
//     fila propia resaltada. Los empatados comparten lugar.
import { Medal, Trophy } from 'lucide-react'
import { ICONO } from '../../config/iconos'
import { ordinal, textoPuntos, textoSiguiente } from './opcionesReto'
import { textoTiempoReto } from '../../utils/retoExpres'

export function TarjetaPosicion({ parcial }) {
  const { propia, totalParticipantes, siguiente, cerradas } = parcial || {}
  if (!propia) return null
  return (
    <section aria-labelledby="reto-posicion" className="bg-surface-card rounded-card shadow-card p-4 text-center">
      <p id="reto-posicion" className="text-sm font-semibold uppercase tracking-wide text-muted">Tu posición</p>
      <p className="text-4xl font-bold text-accent tabular-nums mt-1">{ordinal(propia.posicion)} lugar</p>
      <p className="text-base text-on-surface mt-1">
        <strong>{textoPuntos(propia.aciertos)}</strong>
        <span className="text-muted"> · {totalParticipantes} {totalParticipantes === 1 ? 'participante' : 'participantes'}</span>
      </p>
      {textoSiguiente(siguiente) && <p className="text-base font-semibold text-on-surface mt-2">{textoSiguiente(siguiente)}</p>}
      <p className="text-sm text-muted mt-2">Clasificación provisional tras {cerradas} {cerradas === 1 ? 'pregunta' : 'preguntas'}.</p>
    </section>
  )
}

export function FranjaPosicion({ parcial, nota }) {
  const { propia, totalParticipantes } = parcial || {}
  if (!propia) return null
  return (
    <p className="text-sm text-center text-muted">
      <Trophy size={ICONO.sm} className="inline-block align-text-bottom text-accent mr-1" aria-hidden="true" />
      <strong className="text-on-surface">{ordinal(propia.posicion)} de {totalParticipantes}</strong> · {textoPuntos(propia.aciertos)}
      {nota ? ` · ${nota}` : ''}
    </p>
  )
}

const ESTILO_PODIO = ['text-amber-700', 'text-slate-500', 'text-orange-800']

export function ListaClasificacion({ filas = [], propia = null, realizadas = null, titulo = 'Clasificación', limite = null }) {
  if (!filas.length) return null
  const fueraDeLista = propia && !filas.some((f) => f.esPropia)
  return (
    <section aria-labelledby="reto-lista" className="bg-surface-card rounded-card shadow-card p-4">
      <h2 id="reto-lista" className="text-lg font-semibold text-on-surface mb-2">{titulo}</h2>
      <ol className="space-y-1">
        {filas.map((f, i) => {
          const podio = f.posicion <= 3
          return (
            <li key={i} aria-current={f.esPropia ? 'true' : undefined}
              className={`flex items-center gap-3 rounded-card px-2 py-1 ${f.esPropia ? 'bg-accent-light ring-1 ring-accent' : ''} ${podio ? 'text-lg' : 'text-base'}`}>
              <span className={`w-14 flex-shrink-0 inline-flex items-center justify-end gap-1 font-semibold tabular-nums ${podio ? ESTILO_PODIO[f.posicion - 1] : 'text-accent'}`}>
                {podio && <Medal size={ICONO.md} aria-hidden="true" />}{ordinal(f.posicion)}
              </span>
              <span className={`flex-1 min-w-0 truncate text-on-surface ${podio ? 'font-semibold' : ''}`}>
                {f.nombreVisible}{f.esPropia ? ' (tú)' : ''}
              </span>
              <span className="tabular-nums text-on-surface font-medium">{textoPuntos(f.aciertos)}</span>
              {/* Versión 2: tiempo acumulado en respuestas correctas (desempata a iguales aciertos). */}
              {Number.isInteger(f.tiempoDecimas) && <span className="w-16 text-right tabular-nums text-sm text-muted">{textoTiempoReto(f.tiempoDecimas)}</span>}
              {Number.isInteger(realizadas) && <span className="w-12 text-right tabular-nums text-sm text-muted">{f.aciertos}/{realizadas}</span>}
            </li>
          )
        })}
      </ol>
      {fueraDeLista && (
        <p className="text-sm text-muted mt-2">Tú: {ordinal(propia.posicion)} lugar · {textoPuntos(propia.aciertos)}</p>
      )}
      {limite && <p className="text-sm text-muted mt-2">{limite}</p>}
    </section>
  )
}
