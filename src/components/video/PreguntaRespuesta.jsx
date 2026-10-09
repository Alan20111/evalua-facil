// Tarjeta de una pregunta del Video interactivo: verdadero/falso, opción
// múltiple (con «Otra») y respuesta abierta. Es el MISMO aspecto y la MISMA
// semántica de guardado que la pantalla de cuestionario (EvaluacionRunner): los
// manejadores `onSelectOpcion` / `onTextoChange` / `onOtraTextoChange` son los
// del propio runner, que guardan en submissions/{id}/respuestas/{preguntaId}.
//
// Diferencias pensadas para el celular:
//   · áreas táctiles de al menos 52 px de alto,
//   · el texto de los campos mide 16 px en pantallas táctiles (regla global de
//     index.css), así que iOS no hace zoom al enfocar.
//
// No se reutiliza dentro de EvaluacionRunner a propósito: tocar la pantalla de
// los cuestionarios normales queda para después, con una comparación byte a
// byte del render (ver docs/ia/VIDEO_INTERACTIVO_TRANSCRIPCION.md).
export default function PreguntaRespuesta({
  pregunta, respuesta, otraTexto, onSelectOpcion, onTextoChange, onOtraTextoChange, bloqueada = false,
}) {
  if (pregunta.tipo === 'respuesta_corta') {
    return (
      <textarea
        value={respuesta || ''}
        onChange={(e) => onTextoChange(pregunta.id, e.target.value)}
        rows={5}
        disabled={bloqueada}
        aria-label="Escribe tu respuesta…"
        className="w-full px-3 py-3 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface disabled:opacity-60"
      />
    )
  }
  if (pregunta.tipo === 'subir_archivo' || !Array.isArray(pregunta.opciones)) {
    return <p className="text-sm text-hint italic">Este tipo de pregunta no está disponible en un video interactivo.</p>
  }
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Opciones de respuesta">
      {pregunta.opciones.map((o) => {
        const elegida = respuesta === o.id
        return (
          <div key={o.id}>
            <label
              className={`flex items-center gap-3 p-3.5 min-h-[3.25rem] rounded border transition-colors ${bloqueada ? 'opacity-60' : 'cursor-pointer hover:bg-[var(--accent-tint)]'}`}
              style={{ borderColor: elegida ? 'var(--accent)' : '#e2e8f0', background: elegida ? 'var(--accent-light)' : '' }}>
              <input type="radio" name={`pregunta-${pregunta.id}`} checked={elegida} disabled={bloqueada}
                onChange={() => onSelectOpcion(pregunta.id, o.id, o.esOtra)} className="accent-[var(--accent)] flex-shrink-0 w-5 h-5" />
              <span className="text-sm text-on-surface break-words">{o.esOtra ? 'Otra:' : o.texto}</span>
            </label>
            {o.esOtra && elegida && (
              <input type="text" value={otraTexto || ''} disabled={bloqueada}
                onChange={(e) => onOtraTextoChange(pregunta.id, e.target.value)}
                aria-label="Escribe tu respuesta…"
                className="mt-1.5 ml-9 w-[calc(100%-2.25rem)] px-3 py-2.5 rounded-full border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" />
            )}
          </div>
        )
      })}
    </div>
  )
}
