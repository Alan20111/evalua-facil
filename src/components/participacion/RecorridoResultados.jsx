// Resultados finales PREGUNTA POR PREGUNTA, sin desplazamiento: una pregunta por pantalla, a tamaño de proyección,
// con «Anterior/Siguiente» grandes (o las flechas del teclado). Muestra los resultados de la clase; el diagnóstico
// pedagógico es de la vista del docente.
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import VistaPregunta from './VistaPregunta'
import { tamanosProyeccion } from '../../utils/proyeccionVivo'

export default function RecorridoResultados({ sesion, respuestas, claves, area, tamBase = null, indiceInicial = 0 }) {
  const [i, setI] = useState(indiceInicial)
  const n = sesion.preguntas.length
  const t = tamBase || tamanosProyeccion(area.ancho, area.alto)
  useEffect(() => {
    const tecla = (e) => {
      if (e.key === 'ArrowRight') setI((v) => Math.min(n - 1, v + 1))
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [n])
  const barra = Math.round(t.resto * 2.8)
  const pregunta = sesion.preguntas[Math.min(i, n - 1)]
  const total = respuestas.filter((r) => r.preguntaId === pregunta.id).length
  const boton = 'rounded-full border-2 border-slate-900 text-slate-900 flex items-center justify-center disabled:opacity-40'
  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 min-h-0">
        <VistaPregunta pregunta={pregunta} respuestas={respuestas} area={{ ancho: area.ancho, alto: area.alto - barra }} tamBase={t}
          correcta={sesion.calificable ? claves?.[pregunta.id]?.correcta ?? null : null} revelar={sesion.calificable}
          encabezado={`Resultados · pregunta ${i + 1} de ${n} · ${total} ${total === 1 ? 'respuesta' : 'respuestas'}`} />
      </div>
      <div className="flex items-center justify-center gap-[3vmin] text-slate-900" style={{ height: barra }}>
        <button type="button" aria-label="Pregunta anterior" className={boton} style={{ width: t.resto * 2, height: t.resto * 2 }} disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft size={40} aria-hidden="true" /></button>
        <span className="font-semibold tabular-nums" style={{ fontSize: t.resto }}>{i + 1} / {n}</span>
        <button type="button" aria-label="Pregunta siguiente" className={boton} style={{ width: t.resto * 2, height: t.resto * 2 }} disabled={i >= n - 1} onClick={() => setI(i + 1)}><ChevronRight size={40} aria-hidden="true" /></button>
      </div>
    </div>
  )
}
