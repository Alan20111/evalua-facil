// Nube EDITORIAL de OPCIONES para proyectar (opción única): cada opción es una unidad completa —nunca se separan sus
// palabras— y su tamaño sigue la cantidad de elecciones. Fondo claro, colores armoniosos, palabras horizontales y verticales,
// tamaño proporcional a la frecuencia real y composición que aprovecha todo el espacio (ver utils/nubeVivo.js).
// No es una lista ni una gráfica de barras. Nunca baja del tamaño mínimo de legibilidad: si no caben todas las
// palabras, se reparten en PÁGINAS por frecuencia y cada página se recompone a tamaño completo.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { componerNube, TAMANO_MIN_NUBE } from '../../utils/nubeVivo'
import { tamanosProyeccion } from '../../utils/proyeccionVivo'
import { useAmortiguado } from '../../hooks/useProyeccion'

// Medida real del texto con el canvas y la fuente de la página (no una estimación por número de letras).
function crearMedidor(familia) {
  const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  return (texto, tamano) => {
    if (!ctx) return texto.length * tamano * 0.56
    ctx.font = `600 ${tamano}px ${familia}`
    return ctx.measureText(texto).width
  }
}

export default function NubePalabras({ opciones, area, tam = null, correcta = null, revelar = false, autoPaginar = false }) {
  const t = tam || tamanosProyeccion(area.ancho, area.alto)
  const [pagina, setPagina] = useState(0)
  const ref = useRef(null)
  const [familia, setFamilia] = useState('sans-serif')
  useEffect(() => { if (ref.current) setFamilia(getComputedStyle(ref.current).fontFamily) }, [])
  const medir = useMemo(() => crearMedidor(familia), [familia])
  // La nube se recompone como máximo cada 1.5 s: cada respuesta nueva cambia las frecuencias, pero la pantalla no «baila».
  const items = useAmortiguado(opciones)
  const compuesta = useMemo(
    () => (area.ancho > 0 && area.alto > 0
      ? componerNube(items, area.ancho, Math.max(1, area.alto - Math.round(t.resto * 2.6)), { medir, tamanoMin: Math.max(TAMANO_MIN_NUBE, t.respuesta - 8) })
      : { paginas: [], total: 0 }),
    [items, area.ancho, area.alto, medir, t.resto, t.respuesta]
  )
  const paginas = compuesta.paginas
  const actual = Math.min(pagina, Math.max(0, paginas.length - 1))
  useEffect(() => {
    if (!autoPaginar || paginas.length < 2) return undefined
    const id = setInterval(() => setPagina((p) => (p + 1) % paginas.length), 12000)
    return () => clearInterval(id)
  }, [autoPaginar, paginas.length])
  useEffect(() => {
    const tecla = (e) => {
      if (e.key === 'PageDown') setPagina((p) => Math.min(paginas.length - 1, p + 1))
      if (e.key === 'PageUp') setPagina((p) => Math.max(0, p - 1))
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [paginas.length])

  const pag = paginas[actual]
  const correctaTexto = revelar && correcta != null ? items.find((o) => o.clave === correcta)?.texto ?? opciones.find((o) => o.clave === correcta)?.texto : null
  const alturaNube = Math.max(1, area.alto - Math.round(t.resto * 2.6))
  return (
    <div ref={ref} className="relative h-full w-full select-none">
      {!items.length && (
        <p className="absolute inset-0 flex items-center justify-center text-center text-slate-600 font-medium px-[6vmin]" style={{ fontSize: t.opcion }}>
          Las opciones aparecerán aquí conforme se elijan
        </p>
      )}
      {pag && (
        <div className="relative w-full" style={{ height: alturaNube }}>
          {pag.palabras.map((p) => (
            <span key={p.clave} data-nube-palabra data-n={p.n} data-vertical={p.vertical ? '1' : '0'}
              className="absolute flex items-center justify-center whitespace-nowrap font-semibold leading-none"
              style={{
                left: p.x, top: p.y, width: p.w, height: p.h, fontSize: p.tamano, color: revelar && correcta === p.clave ? '#065F46' : p.color,
                opacity: revelar && correcta != null && correcta !== p.clave ? 0.35 : 1,
                ...(p.vertical ? { writingMode: 'vertical-rl', transform: 'rotate(180deg)' } : null),
                transition: 'left 600ms ease, top 600ms ease, font-size 600ms ease',
              }}>
              {p.texto}
            </span>
          ))}
        </div>
      )}
      {(paginas.length > 1 || correctaTexto) && (
        <div className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-[3vmin] text-slate-900" style={{ height: Math.round(t.resto * 2.6) }}>
          {correctaTexto && <span className="font-bold text-emerald-800" style={{ fontSize: t.resto }}>✓ Correcta: {correctaTexto}</span>}
          {paginas.length > 1 && <>
          <button type="button" aria-label="Palabras anteriores" onClick={() => setPagina(Math.max(0, actual - 1))} disabled={actual === 0} className="rounded-full border-2 border-slate-900 disabled:opacity-40 flex items-center justify-center" style={{ width: t.resto * 2, height: t.resto * 2 }}><ChevronLeft size={40} aria-hidden="true" /></button>
          <span className="font-semibold tabular-nums" style={{ fontSize: t.resto }}>Más palabras · {actual + 1}/{paginas.length}</span>
          <button type="button" aria-label="Palabras siguientes" onClick={() => setPagina(Math.min(paginas.length - 1, actual + 1))} disabled={actual === paginas.length - 1} className="rounded-full border-2 border-slate-900 disabled:opacity-40 flex items-center justify-center" style={{ width: t.resto * 2, height: t.resto * 2 }}><ChevronRight size={40} aria-hidden="true" /></button>
          </>}
        </div>
      )}
      {/* Lectura para lector de pantalla: la nube visual no lo es. */}
      <ul className="sr-only">{items.map((p) => <li key={p.clave}>{p.texto}: {p.n}</li>)}</ul>
    </div>
  )
}
