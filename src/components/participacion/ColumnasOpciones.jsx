// Opción única en la proyección del grupo: COLUMNAS verticales. Cada una lleva letra, cantidad y porcentaje en letra
// grande, un color propio (con la letra como segundo identificador, para quien no distingue colores) y su altura es
// proporcional a la cantidad real; la opción mayoritaria se destaca. Al «revelar», la correcta queda con ✓ y la palabra
// «Correcta» y las demás se atenúan.
//
// Presentación según el largo de las opciones (planOpciones), SIN tocar el texto:
//   · directo   → el texto va sobre cada columna;
//   · lista     → lista de opciones (letra + texto completo) a la izquierda y columnas con letras a la derecha;
//   · momentos  → 'opciones': pregunta + opciones completas; 'resultados': columnas con letras.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { contarOpciones } from '../../utils/participacionVivo'
import { PISOS_PROYECCION, paginarOpciones, tamanosProyeccion } from '../../utils/proyeccionVivo'

const COLORES_COLUMNAS = ['#4C1D95', '#9F1239', '#115E59', '#92400E', '#86198F']
const letra = (i) => String.fromCharCode(65 + i)

export function ListaOpciones({ pregunta, area, tam = null, correcta = null, desde = 0, hasta = Infinity }) {
  const t = tam || tamanosProyeccion(area.ancho, area.alto)
  return (
    <ol className="flex flex-col gap-[1.6vmin] text-slate-900" aria-label="Opciones">
      {pregunta.opciones.map((o, i) => (i < desde || i >= hasta ? null : (
        <li key={o.id} className="flex items-start gap-[2vmin]">
          <span className="flex-shrink-0 rounded-full text-white font-bold flex items-center justify-center" style={{ width: t.opcion * 1.5, height: t.opcion * 1.5, fontSize: t.opcion, backgroundColor: COLORES_COLUMNAS[i % COLORES_COLUMNAS.length] }}>{letra(i)}</span>
          <span className="font-medium leading-snug" style={{ fontSize: t.opcion }}>
            {o.texto}
            {correcta != null && o.id === correcta && <Check className="inline ml-2 text-emerald-700" size={40} aria-label="Correcta" />}
          </span>
        </li>
      )))}
    </ol>
  )
}

// Opciones largas: primer momento. Si ni siquiera solas caben en una pantalla se reparten en páginas (texto completo,
// letra del mismo tamaño) con botones grandes para pasar de una a otra.
function OpcionesPaginadas({ pregunta, area, tam, correcta }) {
  const [pagina, setPagina] = useState(0)
  // La estimación de líneas es aproximada: se MIDE la página real y, si no cabe, se baja el número de opciones por página
  // (nunca se encoge la letra ni se recorta el texto).
  const clave = `${pregunta.id}|${area.ancho}|${area.alto}`
  const [tope, setTope] = useState({ clave: '', n: Infinity })
  const maxPorPagina = tope.clave === clave ? tope.n : Infinity
  const lista = useRef(null)
  const paginas = useMemo(() => paginarOpciones(pregunta.opciones, area.ancho, area.alto).flatMap(([a, b]) => {
    const trozos = []
    for (let i = a; i < b; i += maxPorPagina) trozos.push([i, Math.min(b, i + maxPorPagina)])
    return trozos
  }), [pregunta.opciones, area.ancho, area.alto, maxPorPagina])
  const actual = Math.min(pagina, paginas.length - 1)
  const [desde, hasta] = paginas[actual] || [0, pregunta.opciones.length]
  useLayoutEffect(() => {
    const el = lista.current
    if (el && el.scrollHeight > el.clientHeight + 2 && hasta - desde > 1) setTope({ clave, n: hasta - desde - 1 })
  }, [clave, desde, hasta])
  const barra = Math.round(tam.resto * 2.8)
  const boton = 'rounded-full border-2 border-slate-900 text-slate-900 flex items-center justify-center disabled:opacity-40'
  return (
    <div className="h-full w-full flex flex-col">
      <div ref={lista} className="flex-1 min-h-0 overflow-hidden"><ListaOpciones pregunta={pregunta} area={area} tam={tam} correcta={correcta} desde={desde} hasta={hasta} /></div>
      {paginas.length > 1 && (
        <div className="flex items-center justify-center gap-[3vmin] text-slate-900" style={{ height: barra }}>
          <button type="button" aria-label="Opciones anteriores" className={boton} style={{ width: tam.resto * 2, height: tam.resto * 2 }} disabled={actual === 0} onClick={() => setPagina(actual - 1)}><ChevronLeft size={40} aria-hidden="true" /></button>
          <span className="font-semibold tabular-nums" style={{ fontSize: tam.resto }}>Opciones {actual + 1}/{paginas.length}</span>
          <button type="button" aria-label="Opciones siguientes" className={boton} style={{ width: tam.resto * 2, height: tam.resto * 2 }} disabled={actual >= paginas.length - 1} onClick={() => setPagina(actual + 1)}><ChevronRight size={40} aria-hidden="true" /></button>
        </div>
      )}
    </div>
  )
}

export default function ColumnasOpciones({ pregunta, respuestas, area, tam = null, plan, momento = 'resultados', correcta = null, revelar = false }) {
  const t = tam || tamanosProyeccion(area.ancho, area.alto)
  const { cuentas, total } = contarOpciones(respuestas, pregunta)
  const max = Math.max(1, ...Object.values(cuentas))
  const lider = Object.entries(cuentas).sort((a, b) => b[1] - a[1])[0]
  const hayLider = total > 0 && lider[1] > 0 && Object.values(cuentas).filter((n) => n === lider[1]).length === 1
  const conCorrecta = revelar && correcta != null

  if (plan === 'momentos' && momento === 'opciones') return <OpcionesPaginadas pregunta={pregunta} area={area} tam={t} correcta={conCorrecta ? correcta : null} />

  const columnas = (
    <figure className="flex items-end justify-center gap-[2.4vmin] h-full w-full m-0" aria-label={`Resultados: ${pregunta.opciones.map((o, i) => `${letra(i)} ${cuentas[o.id] || 0}`).join(', ')}`}>
      {pregunta.opciones.map((o, i) => {
        const n = cuentas[o.id] || 0
        const pct = total ? Math.round((n / total) * 100) : 0
        const esCorrecta = conCorrecta && o.id === correcta
        const atenuada = conCorrecta && !esCorrecta
        return (
          <div key={o.id} className="flex flex-col items-center justify-end h-full flex-1 min-w-0" style={{ opacity: atenuada ? 0.35 : 1, transition: 'opacity 500ms' }}>
            <p className="font-bold tabular-nums leading-none text-slate-900 text-center" style={{ fontSize: t.numero }}>
              {n}<span className="font-semibold text-slate-700" style={{ fontSize: Math.max(PISOS_PROYECCION.resto, Math.round(t.numero * 0.62)) }}> · {pct}%</span>
            </p>
            <div className="w-full flex-1 flex items-end mt-[1.2vmin]" style={{ minHeight: 0 }}>
              <div className="w-full rounded-card transition-[height] duration-lenta motion-reduce:transition-none"
                style={{ height: `${Math.max(n ? 6 : 1.5, (n / max) * 100)}%`, backgroundColor: COLORES_COLUMNAS[i % COLORES_COLUMNAS.length], boxShadow: esCorrecta ? '0 0 0 6px #047857' : hayLider && lider[0] === o.id ? '0 0 0 6px #0f172a' : 'none' }} />
            </div>
            <div className="mt-[1.4vmin] flex flex-col items-center text-center w-full">
              <span className="rounded-full text-white font-bold flex items-center justify-center" style={{ width: t.opcion * 1.5, height: t.opcion * 1.5, fontSize: t.opcion, backgroundColor: COLORES_COLUMNAS[i % COLORES_COLUMNAS.length] }}>{letra(i)}</span>
              {plan === 'directo' && <span className="font-semibold text-slate-900 leading-tight mt-[1vmin] break-words w-full" style={{ fontSize: t.opcion }}>{o.texto}</span>}
              {esCorrecta && <span className="mt-[1vmin] font-bold text-emerald-800 flex items-center gap-2" style={{ fontSize: t.opcion }}><Check size={40} aria-hidden="true" />Correcta</span>}
            </div>
          </div>
        )
      })}
    </figure>
  )

  if (plan === 'lista') {
    return (
      <div className="flex h-full w-full gap-[4vmin]">
        <div className="w-[46%] flex-shrink-0 overflow-hidden"><ListaOpciones pregunta={pregunta} area={area} tam={t} correcta={conCorrecta ? correcta : null} /></div>
        <div className="flex-1 min-w-0">{columnas}</div>
      </div>
    )
  }
  return columnas
}
