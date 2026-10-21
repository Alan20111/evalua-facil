// Muro de ideas: respuestas abiertas LEGIBLES desde el fondo del salón. Se muestran pocas a la vez, en letra grande,
// con el texto ORIGINAL completo (nunca truncado):
//   · mosaico   → hasta 4 respuestas por página (2×2) en tarjetas amplias;
//   · destacada → una sola respuesta a tamaño mayor (la que el docente fija, o la más reciente).
// Las páginas siguen a la más reciente mientras nadie las recorra; con los botones grandes o PageUp/PageDown se
// recorren todas. Si una respuesta no cabe en una tarjeta, ocupa la página sola: nunca se reduce la letra.
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, Grid2x2 } from 'lucide-react'
import { paginarMuro, tamanosProyeccion } from '../../utils/proyeccionVivo'

const COLORES = ['#4C1D95', '#9F1239', '#115E59', '#92400E', '#86198F', '#1E40AF']

export default function MuroIdeas({ respuestas, area, tam = null, fijada = null }) {
  const t = tam || tamanosProyeccion(area.ancho, area.alto)
  const [modo, setModo] = useState('mosaico')
  const [pagina, setPagina] = useState(null) // null = sigue a la más reciente
  const ordenadas = useMemo(() => [...respuestas].sort((a, b) => (a.creadaEn?.toMillis?.() ?? 0) - (b.creadaEn?.toMillis?.() ?? 0)), [respuestas])
  const paginas = useMemo(() => paginarMuro(ordenadas, area, t.respuesta), [ordenadas, area, t.respuesta])
  const indice = pagina == null ? Math.max(0, paginas.length - 1) : Math.min(pagina, Math.max(0, paginas.length - 1))
  useEffect(() => {
    const tecla = (e) => {
      if (e.key === 'PageDown') setPagina(Math.min(paginas.length - 1, indice + 1))
      if (e.key === 'PageUp') setPagina(Math.max(0, indice - 1))
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [indice, paginas.length])

  if (!respuestas.length) {
    return <p className="h-full flex items-center justify-center text-center text-slate-600 font-medium px-[6vmin]" style={{ fontSize: t.opcion }}>Las ideas del grupo aparecerán aquí conforme lleguen</p>
  }
  const destacada = fijada ? ordenadas.find((r) => r.id === fijada) : ordenadas[ordenadas.length - 1]
  const barra = Math.round(t.resto * 2.6)
  const boton = 'rounded-full border-2 border-slate-900 text-slate-900 flex items-center justify-center disabled:opacity-40'
  return (
    <div className="h-full w-full flex flex-col text-slate-900">
      <div className="flex-1 min-h-0 overflow-hidden">
        {modo === 'destacada' && destacada ? (
          <div className="h-full flex items-center justify-center px-[4vmin]">
            <p className="font-semibold leading-snug text-center max-w-[92%]" style={{ fontSize: Math.round(t.respuesta * 1.25), color: COLORES[ordenadas.indexOf(destacada) % COLORES.length] }}>«{destacada.texto}»</p>
          </div>
        ) : (
          <ul className="h-full grid grid-cols-2 gap-[2.4vmin] content-start" aria-label="Ideas del grupo">
            {(paginas[indice] || []).map((r) => (
              <li key={r.id} className={`rounded-card border-l-[1.2vmin] bg-slate-50 px-[2.4vmin] py-[1.8vmin] font-medium leading-snug ${(paginas[indice] || []).length === 1 ? 'col-span-2' : ''}`}
                style={{ fontSize: t.respuesta, borderColor: COLORES[ordenadas.indexOf(r) % COLORES.length] }}>
                {r.texto}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-center gap-[3vmin]" style={{ height: barra }}>
        <button type="button" aria-label="Ideas anteriores" className={boton} style={{ width: t.resto * 2, height: t.resto * 2 }} disabled={modo === 'destacada' || indice === 0} onClick={() => setPagina(Math.max(0, indice - 1))}><ChevronLeft size={40} aria-hidden="true" /></button>
        <span className="font-semibold tabular-nums" style={{ fontSize: t.resto }}>{modo === 'destacada' ? 'Idea destacada' : `Ideas ${indice + 1}/${paginas.length}`} · {respuestas.length} {respuestas.length === 1 ? 'respuesta' : 'respuestas'}</span>
        <button type="button" aria-label="Ideas siguientes" className={boton} style={{ width: t.resto * 2, height: t.resto * 2 }} disabled={modo === 'destacada' || indice >= paginas.length - 1} onClick={() => setPagina(Math.min(paginas.length - 1, indice + 1))}><ChevronRight size={40} aria-hidden="true" /></button>
        <button type="button" className={`${boton} px-[3vmin] gap-3 font-semibold`} style={{ height: t.resto * 2, fontSize: t.resto }} onClick={() => setModo(modo === 'mosaico' ? 'destacada' : 'mosaico')}>
          {modo === 'mosaico' ? <><Maximize2 size={24} aria-hidden="true" />Destacar una</> : <><Grid2x2 size={24} aria-hidden="true" />Ver todas</>}
        </button>
      </div>
    </div>
  )
}
