import { TIPO_CORTO, formatearMinuto } from './revisionVideo'

const VF = [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }]

// La siguiente pregunta de la revisión, para que el docente la anticipe sin tener que ir a ella: número, momento, tipo, enunciado
// completo, todas las opciones con la correcta marcada y la retroalimentación si existe. SOLO INFORMA: no tiene campos ni botones
// (para avanzar está «Siguiente»), así que nada de aquí puede cambiar la pregunta. Muestra lo que está en la propuesta (con su
// borrador, igual que la abriría «Siguiente») y nada más: lo que no existe no se muestra ni se inventa.
//   siguiente  elemento de revisión de la pregunta siguiente, o null si la actual es la última
//   posicion   su número en la lista visible; total = cuántas hay
export default function TarjetaSiguientePregunta({ siguiente, posicion, total }) {
  if (!siguiente) {
    return (
      <section aria-label="Siguiente pregunta" data-testid="tarjeta-siguiente"
        className="rounded-card border border-dashed border-outline-variant bg-surface-container px-3 py-2">
        <p className="text-sm font-semibold text-muted" data-testid="ultima-pregunta">Es la última pregunta</p>
      </section>
    )
  }
  const momento = Number.isInteger(siguiente.timestampSeg) ? formatearMinuto(siguiente.timestampSeg) : 'sin momento'
  const abierta = siguiente.tipo === 'respuesta_corta'
  const opciones = siguiente.tipo === 'verdadero_falso' ? VF : siguiente.tipo === 'opcion_multiple' && Array.isArray(siguiente.opciones) ? siguiente.opciones : []
  const hayCorrecta = opciones.some((o) => o.id === siguiente.respuestaCorrecta)
  const retro = String(siguiente.retroalimentacion || '').trim()
  return (
    <section aria-label="Siguiente pregunta" data-testid="tarjeta-siguiente"
      className="rounded-card border border-dashed border-outline-variant bg-surface-container px-3 py-2 space-y-1.5">
      <p className="text-xs font-semibold text-muted" data-testid="siguiente-encabezado">
        Siguiente pregunta · Pregunta {posicion} de {total} · {momento} · {TIPO_CORTO[siguiente.tipo] || 'Pregunta'}
      </p>
      <p className="text-sm lg:text-base leading-snug text-on-surface whitespace-pre-wrap" data-testid="siguiente-enunciado">
        {siguiente.enunciado.trim() || 'Pregunta sin texto'}
      </p>
      {opciones.length > 0 && (
        <ul className="space-y-0.5 text-xs lg:text-sm" data-testid="siguiente-opciones">
          {opciones.map((o) => (o.id === siguiente.respuestaCorrecta ? (
            <li key={o.id} className="font-semibold text-green-800 whitespace-pre-wrap" data-testid="siguiente-correcta">✓ {o.texto} · Correcta</li>
          ) : (
            <li key={o.id} className="text-muted whitespace-pre-wrap">• {o.texto}</li>
          )))}
        </ul>
      )}
      {opciones.length > 0 && !hayCorrecta && <p className="text-xs text-muted">Respuesta correcta: no disponible.</p>}
      {abierta && <p className="text-xs text-hint">Respuesta abierta: la califica el docente.</p>}
      {retro && (
        <p className="text-xs text-muted whitespace-pre-wrap" data-testid="siguiente-retroalimentacion">
          {abierta ? 'Guía de respuesta (retroalimentación)' : 'Retroalimentación'}: {retro}
        </p>
      )}
    </section>
  )
}
