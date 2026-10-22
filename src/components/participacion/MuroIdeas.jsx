// Muro de ideas: respuestas abiertas LEGIBLES desde el fondo del salón. Se muestran pocas a la vez, en letra grande,
// con el texto ORIGINAL completo (nunca truncado):
//   · mosaico   → hasta 4 respuestas por página (2×2) en tarjetas amplias;
//   · destacada → una sola respuesta a tamaño mayor (la que el docente fija, o la más reciente).
// Las páginas siguen a la más reciente mientras nadie las recorra; con los botones grandes o PageUp/PageDown se
// recorren todas. Si una respuesta no cabe en una tarjeta, ocupa la página sola: nunca se reduce la letra.
//
// `manual` (consulta del docente: su vista y los resultados finales): nada se mueve solo. Empieza en la primera página,
// lo que el docente mira queda ANCLADO a una respuesta (su id) y las que llegan después no lo desplazan; «Destacar una»
// muestra una respuesta a la vez y se recorre con Anterior/Siguiente.
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, Grid2x2 } from 'lucide-react'
import { paginaAnclada, paginarMuro, tamanosProyeccion } from '../../utils/proyeccionVivo'

const COLORES = ['#4C1D95', '#9F1239', '#115E59', '#92400E', '#86198F', '#1E40AF']

export default function MuroIdeas({ respuestas, area, tam = null, fijada = null, manual = false }) {
  const t = tam || tamanosProyeccion(area.ancho, area.alto)
  const [modo, setModo] = useState('mosaico')
  const [pagina, setPagina] = useState(null) // null = sigue a la más reciente
  // Modo manual: { id de la respuesta que ancla la vista, índice de respaldo si esa respuesta desaparece }.
  const [ancla, setAncla] = useState({ id: null, indice: 0 })
  const [anclaUna, setAnclaUna] = useState({ id: null, indice: 0 })
  const ordenadas = useMemo(() => [...respuestas].sort((a, b) => (a.creadaEn?.toMillis?.() ?? 0) - (b.creadaEn?.toMillis?.() ?? 0)), [respuestas])
  const paginas = useMemo(() => paginarMuro(ordenadas, area, t.respuesta), [ordenadas, area, t.respuesta])
  const unaPorPagina = useMemo(() => ordenadas.map((r) => [r]), [ordenadas])
  const indice = manual
    ? paginaAnclada(paginas, ancla.id, ancla.indice)
    : pagina == null ? Math.max(0, paginas.length - 1) : Math.min(pagina, Math.max(0, paginas.length - 1))
  const indiceUna = manual ? paginaAnclada(unaPorPagina, anclaUna.id, anclaUna.indice) : 0
  const uno = manual && modo === 'destacada' // recorrido de una en una

  const irPagina = (k) => {
    const c = Math.max(0, Math.min(k, paginas.length - 1))
    if (manual) setAncla({ id: paginas[c]?.[0]?.id ?? null, indice: c })
    else setPagina(c)
  }
  const irUna = (k) => {
    const c = Math.max(0, Math.min(k, ordenadas.length - 1))
    setAnclaUna({ id: ordenadas[c]?.id ?? null, indice: c })
  }
  const anterior = () => (uno ? irUna(indiceUna - 1) : irPagina(indice - 1))
  const siguiente = () => (uno ? irUna(indiceUna + 1) : irPagina(indice + 1))

  useEffect(() => {
    const tecla = (e) => {
      if (e.key === 'PageDown') siguiente()
      if (e.key === 'PageUp') anterior()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  if (!respuestas.length) {
    return <p className="h-full flex items-center justify-center text-center text-slate-600 font-medium px-[6vmin]" style={{ fontSize: t.opcion }}>Las ideas del grupo aparecerán aquí conforme lleguen</p>
  }
  const destacada = fijada ? ordenadas.find((r) => r.id === fijada) : manual ? ordenadas[indiceUna] : ordenadas[ordenadas.length - 1]
  // Botones de al menos 44 px (táctiles). En proyección t.resto ≥ 28, así que miden lo mismo que siempre.
  const lado = Math.max(44, t.resto * 2)
  const icono = lado >= 56 ? 40 : 24
  const barra = Math.max(Math.round(t.resto * 2.6), lado + 8)
  const boton = 'rounded-full border-2 border-slate-900 text-slate-900 flex items-center justify-center disabled:opacity-40'
  const sinAnterior = uno ? indiceUna === 0 : modo === 'destacada' || indice === 0
  const sinSiguiente = uno ? indiceUna >= ordenadas.length - 1 : modo === 'destacada' || indice >= paginas.length - 1
  const etiqueta = uno
    ? `Respuesta ${indiceUna + 1} de ${ordenadas.length}`
    : `${modo === 'destacada' ? 'Idea destacada' : `Ideas ${indice + 1}/${paginas.length}`} · ${respuestas.length} ${respuestas.length === 1 ? 'respuesta' : 'respuestas'}`

  function cambiarModo() {
    if (manual && modo === 'mosaico') {
      // Se destaca la primera respuesta de la página que el docente estaba viendo.
      const r = paginas[indice]?.[0]
      if (r) setAnclaUna({ id: r.id, indice: ordenadas.indexOf(r) })
    }
    if (manual && modo === 'destacada' && destacada) {
      // De vuelta al mosaico, en la página que contiene la respuesta destacada.
      const k = paginaAnclada(paginas, destacada.id, indice)
      setAncla({ id: paginas[k]?.[0]?.id ?? null, indice: k })
    }
    setModo(modo === 'mosaico' ? 'destacada' : 'mosaico')
  }

  return (
    <div className="h-full w-full flex flex-col text-slate-900">
      <div className={`flex-1 min-h-0 ${manual ? 'overflow-y-auto' : 'overflow-hidden'}`}>
        {modo === 'destacada' && destacada ? (
          <div className="min-h-full flex items-center justify-center px-[4vmin]">
            <p className="font-semibold leading-snug text-center max-w-[92%] break-words" style={{ fontSize: Math.round(t.respuesta * 1.25), color: COLORES[ordenadas.indexOf(destacada) % COLORES.length] }}>«{destacada.texto}»</p>
          </div>
        ) : (
          <ul className={`${manual ? 'min-h-full' : 'h-full'} grid grid-cols-2 gap-[2.4vmin] content-start`} aria-label="Ideas del grupo">
            {(paginas[indice] || []).map((r) => (
              <li key={r.id} className={`rounded-card border-l-[1.2vmin] bg-slate-50 px-[2.4vmin] py-[1.8vmin] font-medium leading-snug break-words ${(paginas[indice] || []).length === 1 ? 'col-span-2' : ''}`}
                style={{ fontSize: t.respuesta, borderColor: COLORES[ordenadas.indexOf(r) % COLORES.length] }}>
                {r.texto}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center justify-center gap-[3vmin]" style={{ minHeight: barra }}>
        <button type="button" aria-label={uno ? 'Respuesta anterior' : 'Ideas anteriores'} className={boton} style={{ width: lado, height: lado }} disabled={sinAnterior} onClick={anterior}><ChevronLeft size={icono} aria-hidden="true" /></button>
        <span className="font-semibold tabular-nums text-center" style={{ fontSize: t.resto }}>{etiqueta}</span>
        <button type="button" aria-label={uno ? 'Respuesta siguiente' : 'Ideas siguientes'} className={boton} style={{ width: lado, height: lado }} disabled={sinSiguiente} onClick={siguiente}><ChevronRight size={icono} aria-hidden="true" /></button>
        <button type="button" className={`${boton} px-[3vmin] gap-3 font-semibold`} style={{ height: lado, fontSize: t.resto }} onClick={cambiarModo}>
          {modo === 'mosaico' ? <><Maximize2 size={24} aria-hidden="true" />Destacar una</> : <><Grid2x2 size={24} aria-hidden="true" />Ver todas</>}
        </button>
      </div>
    </div>
  )
}
