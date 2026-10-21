// Vista del DOCENTE (misma ventana, con un interruptor): lo que el grupo ve + lo que solo el docente necesita —estado
// de las respuestas, la clave de la pregunta y el diagnóstico pedagógico—. Aquí sí puede haber desplazamiento: es su
// pantalla, no la del salón.
import { useMemo } from 'react'
import { Check } from 'lucide-react'
import VistaPregunta from './VistaPregunta'
import DiagnosticoDocente, { InformeFinalDocente } from './DiagnosticoDocente'
import { resumenAbiertas } from '../../utils/participacionVivo'
import { useAreaMedida } from '../../hooks/useProyeccion'

const letra = (i) => String.fromCharCode(65 + i)

function Estado({ pregunta, respuestas, sesion }) {
  const r = useMemo(() => resumenAbiertas(respuestas, pregunta), [respuestas, pregunta])
  if (pregunta.tipo === 'opcion_unica') return <p className="text-sm text-muted">{r.recibidas} {r.recibidas === 1 ? 'respuesta' : 'respuestas'}</p>
  if (!sesion.analisisActivo) return <p className="text-sm text-muted">{r.recibidas} {r.recibidas === 1 ? 'respuesta' : 'respuestas'} · el análisis con IA no está activo</p>
  const pendientes = r.pendientes + r.analizando
  return (
    <p className="text-sm text-muted">
      {r.recibidas} recibidas · {r.analizadas} evaluadas · {pendientes} pendientes
      {r.omitidas > 0 && ` · ${r.omitidas} fuera del tope de la sesión`}{r.fallidas > 0 && ` · ${r.fallidas} sin poder evaluar`}
    </p>
  )
}

function Clave({ pregunta, clave }) {
  if (!clave) return null
  if (pregunta.tipo === 'opcion_unica') {
    const i = pregunta.opciones.findIndex((o) => o.id === clave.correcta)
    return i < 0 ? null : <p className="text-sm text-on-surface flex items-center gap-1"><Check size={16} className="text-emerald-700" aria-hidden="true" />Correcta: <strong>{letra(i)}</strong> · {pregunta.opciones[i].texto}</p>
  }
  return clave.esperada ? <p className="text-sm text-on-surface"><strong>Respuesta esperada:</strong> {clave.esperada}</p> : null
}

export default function VistaDocente({ sesion, respuestas, informes, claves, indice, verCorrecta, momento }) {
  const [ref, area] = useAreaMedida()
  if (sesion.estado === 'finalizada') {
    return (
      <div className="h-full overflow-y-auto px-[4%] py-4 space-y-4 bg-surface">
        <InformeFinalDocente sesion={sesion} informes={informes} />
        {sesion.preguntas.map((p, i) => (
          <div key={p.id} className="space-y-1">
            <h3 className="text-base font-semibold text-on-surface">Pregunta {i + 1}. {p.enunciado}</h3>
            <DiagnosticoDocente sesion={sesion} pregunta={p} respuestas={respuestas} informes={informes} claves={claves} />
          </div>
        ))}
      </div>
    )
  }
  if (indice < 0) return <div className="h-full flex items-center justify-center text-on-surface text-lg px-6 text-center">Cuando el grupo esté listo, pulsa «Comenzar». Aquí verás el estado de cada pregunta y su diagnóstico.</div>
  const pregunta = sesion.preguntas[Math.min(indice, sesion.preguntas.length - 1)]
  const clave = claves?.[pregunta.id]
  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 p-4 min-h-0 bg-surface">
      <div ref={ref} className="min-h-[60dvh] lg:min-h-0 rounded-card border border-outline-variant bg-white overflow-hidden">
        {area.ancho > 0 && (
          <VistaPregunta pregunta={pregunta} respuestas={respuestas} area={area} correcta={clave?.correcta ?? null} revelar={verCorrecta}
            momento={momento} autoPaginar={false} encabezado={`Pregunta ${indice + 1} de ${sesion.preguntas.length}`} />
        )}
      </div>
      <aside className="overflow-y-auto space-y-3 min-h-0">
        <Estado pregunta={pregunta} respuestas={respuestas} sesion={sesion} />
        <Clave pregunta={pregunta} clave={clave} />
        <DiagnosticoDocente sesion={sesion} pregunta={pregunta} respuestas={respuestas} informes={informes} claves={claves} />
      </aside>
    </div>
  )
}
