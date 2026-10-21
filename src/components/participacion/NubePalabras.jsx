// Nube de palabras para proyectar. El tamaño de cada palabra depende de cuántas respuestas la
// contienen (frecuencia REAL, calculada en participacionVivo.frecuenciasNube); se distribuyen en
// espiral sin encimarse. Se recalcula con cada respuesta nueva y las palabras se deslizan a su sitio.
import { useEffect, useMemo, useRef, useState } from 'react'
import { COLORES_VIVO, disponerNube, frecuenciasNube } from '../../utils/participacionVivo'

export default function NubePalabras({ textos, alturaMin = 320 }) {
  const ref = useRef(null)
  const [caja, setCaja] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const medir = () => setCaja({ w: el.clientWidth, h: el.clientHeight })
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const items = useMemo(() => frecuenciasNube(textos), [textos])
  const { colocadas, omitidas } = useMemo(
    () => disponerNube(items, caja.w, caja.h, { tamanoMin: 20, tamanoMax: Math.max(40, Math.min(110, Math.floor(caja.h / 4))) }),
    [items, caja]
  )

  return (
    <div className="w-full h-full" style={{ minHeight: alturaMin }}>
      <div ref={ref} className="relative w-full h-full overflow-hidden" style={{ minHeight: alturaMin }}>
        {colocadas.map((p, i) => (
          <span key={p.clave}
            className="absolute whitespace-nowrap font-bold leading-none select-none transition-[left,top,width,height,font-size] duration-lenta ease-out motion-reduce:transition-none"
            style={{ left: p.x, top: p.y, width: p.w, height: p.h, fontSize: p.tamano, color: COLORES_VIVO[i % COLORES_VIVO.length], display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title={`${p.texto}: ${p.n} ${p.n === 1 ? 'respuesta' : 'respuestas'}`}>
            {p.texto}
          </span>
        ))}
        {!items.length && (
          <p className="absolute inset-0 flex items-center justify-center text-xl text-white/80">Las palabras aparecerán aquí conforme lleguen las respuestas</p>
        )}
      </div>
      {/* Lectura para lector de pantalla: la nube visual no lo es. */}
      <ul className="sr-only">
        {items.map((p) => <li key={p.clave}>{p.texto}: {p.n}</li>)}
      </ul>
      {omitidas > 0 && <p className="text-xs text-white/80 text-right mt-1">+{omitidas} palabras menos frecuentes no caben en pantalla</p>}
    </div>
  )
}
