// Vista del DOCENTE (misma ventana, con un interruptor): lo que el grupo ve + lo que solo el docente necesita —estado
// de las respuestas, la clave de la pregunta y el diagnóstico pedagógico—. Aquí sí puede haber desplazamiento: es su
// pantalla, no la del salón.
import { useMemo } from 'react'
import { Check } from 'lucide-react'
import VistaPregunta from './VistaPregunta'
import { InformeFinalDocente } from './DiagnosticoDocente'
import { esEncuesta, resumenAbiertas } from '../../utils/participacionVivo'
import Temporizador from './Temporizador'
import { useCuentaRegresiva } from '../../hooks/useTemporizadorVivo'
import { useAreaMedida } from '../../hooks/useProyeccion'

const letra = (i) => String.fromCharCode(65 + i)

function Tiempo({ sesion, ahora, pregunta }) {
  const { estado, restanteMs, faltaMs } = useCuentaRegresiva(sesion, ahora)
  const v = sesion.ventanas?.[pregunta.id]
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {estado === 'preparando'
        ? <p className="text-sm font-semibold text-on-surface">Comienza en {Math.max(1, Math.ceil((faltaMs ?? 0) / 1000))} s</p>
        : <Temporizador estado={estado} restanteMs={restanteMs} sesion={sesion} tam={20} />}
      {v?.sellada && (
        <p className="text-sm text-on-surface">
          Respondieron {v.respondieron}{v.esperados != null ? ` de ${v.esperados}` : ''}
          {Array.isArray(v.sinRespuesta) && <> · <strong>Sin respuesta: {v.sinRespuesta.length}</strong> <span className="text-muted">(no se califican como incorrectas)</span></>}
        </p>
      )}
    </div>
  )
}

function Estado({ pregunta, respuestas, sesion }) {
  const r = useMemo(() => resumenAbiertas(respuestas, pregunta), [respuestas, pregunta])
  if (pregunta.tipo === 'opcion_unica') return <p className="text-sm text-muted">{r.recibidas} {r.recibidas === 1 ? 'respuesta' : 'respuestas'}</p>
  if (esEncuesta(sesion.proposito)) return <p className="text-sm text-muted">{r.recibidas} {r.recibidas === 1 ? 'respuesta' : 'respuestas'} (se conservan íntegras)</p>
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

export default function VistaDocente({ sesion, respuestas, informes, claves, indice, ahora, verCorrecta, momento }) {
  const [ref, area] = useAreaMedida()
  if (sesion.estado === 'finalizada') {
    return (
      <div className="h-full overflow-y-auto px-[4%] py-4 space-y-4 bg-surface">
        <InformeFinalDocente sesion={sesion} informes={informes} />
        {!sesion.analisisActivo && <p className="text-sm text-muted">Sesión finalizada. Los resultados de cada pregunta están en la vista del grupo.</p>}
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
        <Tiempo sesion={sesion} ahora={ahora} pregunta={pregunta} />
        <Estado pregunta={pregunta} respuestas={respuestas} sesion={sesion} />
        <Clave pregunta={pregunta} clave={clave} />
      </aside>
    </div>
  )
}
