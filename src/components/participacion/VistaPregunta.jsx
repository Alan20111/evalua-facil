// Una pregunta con sus resultados, dibujada para PROYECTAR (tema claro, letra grande, sin desplazamiento).
// La usan la vista del grupo, la ventana de proyección y el recorrido de resultados finales.
import { useMemo } from 'react'
import { altoEnunciado, planOpciones, tamanosProyeccion } from '../../utils/proyeccionVivo'
import { contarOpciones, visualizacionDe } from '../../utils/participacionVivo'
import ColumnasOpciones from './ColumnasOpciones'
import NubePalabras from './NubePalabras'
import MuroIdeas from './MuroIdeas'

export default function VistaPregunta({ pregunta, respuestas, area, correcta = null, revelar = false, momento = 'resultados', autoPaginar = false, fijada = null, encabezado = null, tamBase = null }) {
  const t = tamBase || tamanosProyeccion(area.ancho, area.alto)
  const propias = useMemo(() => respuestas.filter((r) => r.preguntaId === pregunta.id), [respuestas, pregunta.id])
  // Nube de OPCIONES (opción única): cada opción completa y su cantidad de elecciones; nunca palabras sueltas de respuestas.
  const opcionesNube = useMemo(() => {
    if (pregunta.tipo !== 'opcion_unica') return []
    const { cuentas } = contarOpciones(propias, pregunta)
    return pregunta.opciones.filter((o) => cuentas[o.id] > 0).map((o) => ({ clave: o.id, texto: o.texto, n: cuentas[o.id] })).sort((a, b) => b.n - a.n)
  }, [propias, pregunta])
  const plan = useMemo(() => (pregunta.tipo === 'opcion_unica' ? planOpciones(pregunta.enunciado, pregunta.opciones, area.ancho, area.alto) : null), [pregunta, area.ancho, area.alto])
  const altoTitulo = altoEnunciado(pregunta.enunciado, area.ancho, area.alto)
  const altoEncabezado = encabezado ? Math.round(t.resto * 1.8) : 0
  const areaCuerpo = { ancho: Math.round(area.ancho * 0.92), alto: Math.max(120, area.alto - altoTitulo - altoEncabezado) }
  const nubeCabe = visualizacionDe(pregunta) === 'nube' // ya validada: solo con opciones de una o dos palabras
  return (
    <div className="h-full w-full flex flex-col text-slate-900 px-[4%]">
      {encabezado && <p className="font-semibold text-slate-700 tabular-nums" style={{ fontSize: t.resto, height: altoEncabezado }}>{encabezado}</p>}
      <h1 className="font-bold leading-tight" style={{ fontSize: t.pregunta, minHeight: altoTitulo - Math.round(t.pregunta * 0.4) }}>{pregunta.enunciado}</h1>
      <div className="flex-1 min-h-0 mt-[1.5vmin] overflow-hidden" data-vivo-cuerpo>
        {pregunta.tipo === 'opcion_unica' && nubeCabe && (
          <NubePalabras opciones={opcionesNube} area={areaCuerpo} tam={t} correcta={correcta} revelar={revelar} autoPaginar={autoPaginar} />
        )}
        {pregunta.tipo === 'opcion_unica' && !nubeCabe && (
          <ColumnasOpciones pregunta={pregunta} respuestas={propias} area={areaCuerpo} tam={t} plan={plan} momento={momento} correcta={correcta} revelar={revelar} />
        )}
        {/* Respuestas escritas (breves o extensas): SIEMPRE tarjetas con el texto original; nunca nube ni barras. */}
        {pregunta.tipo !== 'opcion_unica' && <MuroIdeas respuestas={propias} area={areaCuerpo} tam={t} fijada={fijada} />}
      </div>
    </div>
  )
}
