// Una pregunta con sus resultados, dibujada para PROYECTAR (tema claro, letra grande, sin desplazamiento).
// La usan la vista del grupo, la ventana de proyección, el recorrido de resultados finales y la vista del docente.
//
//   · densidad 'docente' → tamaños de pantalla de trabajo (tamanosDocente) en vez de los pisos de proyección; las
//     estimaciones de espacio (alto del enunciado, plan de opciones) se hacen con esos mismos tamaños.
//   · manual → consulta del docente: nada cambia de página por sí solo, y al cambiar de pregunta el cuerpo empieza de cero.
import { useMemo } from 'react'
import { altoEnunciado, planOpciones, tamanosDocente, tamanosProyeccion } from '../../utils/proyeccionVivo'
import { contarOpciones, visualizacionDe } from '../../utils/participacionVivo'
import ColumnasOpciones from './ColumnasOpciones'
import NubePalabras from './NubePalabras'
import MuroIdeas from './MuroIdeas'

export default function VistaPregunta({ pregunta, respuestas, area, correcta = null, revelar = false, momento = 'resultados', autoPaginar = false, fijada = null, encabezado = null, acento = null, tamBase = null, densidad = 'proyeccion', manual = false }) {
  const docente = densidad === 'docente'
  const t = tamBase || (docente ? tamanosDocente : tamanosProyeccion)(area.ancho, area.alto)
  const tEstimar = docente ? t : undefined // undefined: las estimaciones de proyección de siempre
  const propias = useMemo(() => respuestas.filter((r) => r.preguntaId === pregunta.id), [respuestas, pregunta.id])
  // Nube de OPCIONES (opción única): cada opción completa y su cantidad de elecciones; nunca palabras sueltas de respuestas.
  const opcionesNube = useMemo(() => {
    if (pregunta.tipo !== 'opcion_unica') return []
    const { cuentas } = contarOpciones(propias, pregunta)
    return pregunta.opciones.filter((o) => cuentas[o.id] > 0).map((o) => ({ clave: o.id, texto: o.texto, n: cuentas[o.id] })).sort((a, b) => b.n - a.n)
  }, [propias, pregunta])
  const plan = useMemo(() => (pregunta.tipo === 'opcion_unica' ? planOpciones(pregunta.enunciado, pregunta.opciones, area.ancho, area.alto, tEstimar) : null), [pregunta, area.ancho, area.alto, tEstimar])
  const altoTitulo = altoEnunciado(pregunta.enunciado, area.ancho, area.alto, tEstimar)
  const altoEncabezado = encabezado ? (acento ? Math.round(t.pregunta * 1.9) : Math.round(t.resto * 1.8)) : 0
  // El cuerpo se separa del enunciado con mt-[4vmin] (antes 1.5vmin): esos 2.5vmin extra se descuentan aquí para que la nube
  // (que usa este alto en px) y las estimaciones de páginas sigan cabiendo igual que antes. vmin = el de la ventana, como en CSS.
  const margenExtra = typeof window === 'undefined' ? 0 : Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.025)
  const areaCuerpo = { ancho: Math.round(area.ancho * 0.92), alto: Math.max(120, area.alto - altoTitulo - altoEncabezado - margenExtra) }
  const nubeCabe = visualizacionDe(pregunta) === 'nube' // ya validada: solo con opciones de una o dos palabras
  return (
    <div className="h-full w-full flex flex-col text-slate-900 px-[4%]">
      {encabezado && (
        // Alto MÍNIMO (no fijo): si el encabezado no cabe en una línea, pasa a dos en vez de salirse por arriba.
        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-x-4" style={{ minHeight: acento ? Math.round(t.pregunta * 1.9) : altoEncabezado }}>
          <p className="min-w-0 font-semibold text-slate-700 tabular-nums break-words" style={{ fontSize: t.resto }}>{encabezado}</p>
          {acento}
        </div>
      )}
      <h1 className="font-bold leading-tight break-words text-blue-700" style={{ fontSize: t.pregunta, minHeight: altoTitulo - Math.round(t.pregunta * 0.4) }}>{pregunta.enunciado}</h1>
      <div key={manual ? pregunta.id : undefined} className="flex-1 min-h-0 mt-[4vmin] overflow-hidden" data-vivo-cuerpo>
        {pregunta.tipo === 'opcion_unica' && nubeCabe && (
          <NubePalabras opciones={opcionesNube} area={areaCuerpo} tam={t} correcta={correcta} revelar={revelar} autoPaginar={autoPaginar} />
        )}
        {pregunta.tipo === 'opcion_unica' && !nubeCabe && (
          <ColumnasOpciones pregunta={pregunta} respuestas={propias} area={areaCuerpo} tam={t} plan={plan} momento={momento} correcta={correcta} revelar={revelar} manual={manual} docente={docente} />
        )}
        {/* Respuestas escritas (breves o extensas): SIEMPRE tarjetas con el texto original; nunca nube ni barras. */}
        {pregunta.tipo !== 'opcion_unica' && <MuroIdeas respuestas={propias} area={areaCuerpo} tam={t} fijada={fijada} manual={manual} />}
      </div>
    </div>
  )
}
