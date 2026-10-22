// Vista del DOCENTE (misma ventana, con un interruptor): lo que el grupo ve + lo que solo el docente necesita —estado
// de las respuestas, la clave de la pregunta y el diagnóstico pedagógico—. Es su pantalla de trabajo, no la del salón:
// tamaños de pantalla normal (tamanosDocente), fondo blanco y desplazamiento cuando no cabe.
//
// Composición: a la izquierda la pregunta con sus resultados; a la derecha (debajo en pantallas angostas) su estado.
//   · Sesión activa: la pregunta en curso (la cambian Anterior/Siguiente de la barra de la presentación).
//   · Sesión finalizada: los resultados pregunta por pregunta con sus propios controles; la pregunta que se consulta la
//     guarda la presentación (`indiceResultados`), así que no se pierde al alternar con la vista del grupo.
// Las respuestas se consultan en modo manual: las que llegan después no cambian lo que el docente está viendo.
import { useEffect, useMemo } from 'react'
import { Check, ChevronLeft, ChevronRight, CircleCheck, ClipboardCheck } from 'lucide-react'
import { Button } from '../ui'
import VistaPregunta from './VistaPregunta'
import { InformeFinalDocente } from './DiagnosticoDocente'
import PanelCalificacionVivo from './PanelCalificacionVivo'
import { esEncuesta, resumenAbiertas } from '../../utils/participacionVivo'
import Temporizador from './Temporizador'
import { useCuentaRegresiva } from '../../hooks/useTemporizadorVivo'
import { useAreaMedida } from '../../hooks/useProyeccion'
import { tamanosDocente } from '../../utils/proyeccionVivo'

const letra = (i) => String.fromCharCode(65 + i)

// Quiénes respondieron, cuando la pregunta ya se selló (registra a los que no respondieron).
function Participacion({ sesion, pregunta }) {
  const v = sesion.ventanas?.[pregunta.id]
  if (!v?.sellada) return null
  return (
    <p className="text-sm text-on-surface">
      Respondieron {v.respondieron}{v.esperados != null ? ` de ${v.esperados}` : ''}
      {Array.isArray(v.sinRespuesta) && <> · <strong>Sin respuesta: {v.sinRespuesta.length}</strong> <span className="text-muted">(no se califican como incorrectas)</span></>}
    </p>
  )
}

function Tiempo({ sesion, ahora, pregunta }) {
  const { estado, restanteMs, faltaMs } = useCuentaRegresiva(sesion, ahora)
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {estado === 'preparando'
        ? <p className="text-sm font-semibold text-on-surface">Comienza en {Math.max(1, Math.ceil((faltaMs ?? 0) / 1000))} s</p>
        : <Temporizador estado={estado} restanteMs={restanteMs} sesion={sesion} tam={20} />}
      <Participacion sesion={sesion} pregunta={pregunta} />
    </div>
  )
}

function Estado({ pregunta, respuestas, sesion }) {
  const r = useMemo(() => resumenAbiertas(respuestas, pregunta), [respuestas, pregunta])
  if (pregunta.tipo === 'opcion_unica') return <p className="text-sm text-muted">{r.recibidas} {r.recibidas === 1 ? 'respuesta' : 'respuestas'}</p>
  if (esEncuesta(sesion.proposito)) return <p className="text-sm text-muted">{r.recibidas} {r.recibidas === 1 ? 'respuesta' : 'respuestas'} (se conservan íntegras)</p>
  if (!sesion.analisisActivo) return <p className="text-sm text-muted">{r.recibidas} {r.recibidas === 1 ? 'respuesta' : 'respuestas'} · el diagnóstico por pregunta no está activo</p>
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
    return i < 0 ? null : <p className="text-sm text-on-surface flex items-start gap-1 break-words"><Check size={16} className="text-emerald-700 flex-shrink-0 mt-0.5" aria-hidden="true" /><span>Correcta: <strong>{letra(i)}</strong> · {pregunta.opciones[i].texto}</span></p>
  }
  return clave.esperada ? <p className="text-sm text-on-surface break-words"><strong>Respuesta esperada:</strong> {clave.esperada}</p> : null
}

const tarjetaLateral = 'rounded-card border border-outline-variant bg-white p-4 space-y-2'

// Pregunta + resultados a la izquierda, estado a la derecha; en pantallas angostas, uno debajo del otro y con desplazamiento.
function Distribucion({ pregunta, pie = null, lateral, debajo = null }) {
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 p-4 lg:h-full lg:min-h-0">
        <div className="flex flex-col gap-3 h-[78dvh] lg:h-auto lg:min-h-0">
          <div className="flex-1 min-h-0 rounded-card border border-outline-variant bg-white py-3 overflow-hidden">{pregunta}</div>
          {pie}
        </div>
        <aside className="space-y-3 lg:min-h-0 lg:overflow-y-auto" aria-label="Estado de la pregunta">{lateral}</aside>
      </div>
      {debajo && <div className="px-4 pb-4">{debajo}</div>}
    </div>
  )
}

// La pregunta medida en su tarjeta, con los tamaños del docente y en modo manual.
function PreguntaMedida(props) {
  const [ref, area] = useAreaMedida()
  return (
    <div ref={ref} className="h-full">
      {area.ancho > 0 && <VistaPregunta {...props} area={area} tamBase={tamanosDocente(area.ancho, area.alto)} densidad="docente" manual autoPaginar={false} />}
    </div>
  )
}

function ResultadosFinales({ sesion, respuestas, informes, claves, actividad, indice, onIndice }) {
  const n = sesion.preguntas.length
  const i = Math.max(0, Math.min(indice ?? 0, n - 1))
  const pregunta = sesion.preguntas[i]
  const clave = claves?.[pregunta.id]
  const total = respuestas.filter((r) => r.preguntaId === pregunta.id).length
  const encuesta = esEncuesta(sesion.proposito)
  // Flechas del teclado: misma navegación que la vista del grupo (salvo mientras se escribe en un campo).
  useEffect(() => {
    const tecla = (e) => {
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'ArrowRight') onIndice((v) => Math.min(n - 1, (v ?? 0) + 1))
      if (e.key === 'ArrowLeft') onIndice((v) => Math.max(0, (v ?? 0) - 1))
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [n, onIndice])
  return (
    <Distribucion
      pregunta={
        <PreguntaMedida pregunta={pregunta} respuestas={respuestas} momento="resultados"
          correcta={encuesta ? null : clave?.correcta ?? null} revelar={!encuesta && clave?.correcta != null}
          encabezado={`Resultados · pregunta ${i + 1} de ${n} · ${total} ${total === 1 ? 'respuesta' : 'respuestas'}`} />
      }
      pie={
        <nav aria-label="Preguntas de la sesión" className="flex flex-shrink-0 flex-wrap items-center justify-center gap-3">
          <Button variant="secondary" icon={ChevronLeft} disabled={i === 0} onClick={() => onIndice(i - 1)}>Pregunta anterior</Button>
          <span className="text-sm font-semibold tabular-nums text-on-surface">{i + 1} / {n}</span>
          <Button variant="secondary" iconRight={ChevronRight} disabled={i >= n - 1} onClick={() => onIndice(i + 1)}>Pregunta siguiente</Button>
        </nav>
      }
      lateral={
        <>
          <section className={tarjetaLateral}>
            <p className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-on-surface">
              <CircleCheck size={16} className="text-emerald-700" aria-hidden="true" />Sesión finalizada
            </p>
            <p className="text-sm text-muted">Consulta los resultados pregunta por pregunta. Las respuestas ya no cambian.</p>
            {sesion.calificable && (
              <Button variant="secondary" size="sm" icon={ClipboardCheck}
                onClick={() => document.getElementById('vivo-calificacion')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                Ir a la calificación propuesta
              </Button>
            )}
          </section>
          <section className={tarjetaLateral} aria-label={`Pregunta ${i + 1}`}>
            <h2 className="text-sm font-semibold text-on-surface">Pregunta {i + 1}</h2>
            <Participacion sesion={sesion} pregunta={pregunta} />
            <Estado pregunta={pregunta} respuestas={respuestas} sesion={sesion} />
            <Clave pregunta={pregunta} clave={clave} />
          </section>
          <InformeFinalDocente sesion={sesion} informes={informes} />
          {!sesion.analisisActivo && <p className="text-sm text-muted px-1">En esta sesión no se activó el diagnóstico por pregunta (incluido). El análisis global de la sesión con IA se pide aparte, desde la lista de sesiones.</p>}
        </>
      }
      debajo={sesion.calificable ? (
        <div id="vivo-calificacion" className="scroll-mt-4">
          <PanelCalificacionVivo sesion={sesion} actividad={actividad} claves={claves} respuestas={respuestas} asignaturaId={sesion.asignaturaId} />
        </div>
      ) : null}
    />
  )
}

export default function VistaDocente({ sesion, respuestas, informes, claves, indice, ahora, verCorrecta, actividad = null, indiceResultados = 0, onIndiceResultados }) {
  if (sesion.estado === 'finalizada') {
    return <ResultadosFinales sesion={sesion} respuestas={respuestas} informes={informes} claves={claves} actividad={actividad}
      indice={indiceResultados} onIndice={onIndiceResultados} />
  }
  if (indice < 0) return <div className="h-full flex items-center justify-center text-on-surface text-lg px-6 text-center bg-white">Cuando el grupo esté listo, pulsa «Comenzar». Aquí verás el estado de cada pregunta y su diagnóstico.</div>
  const pregunta = sesion.preguntas[Math.min(indice, sesion.preguntas.length - 1)]
  const clave = claves?.[pregunta.id]
  return (
    <Distribucion
      // El docente ve opciones y resultados juntos: el «primer momento» (solo opciones) es para el grupo.
      pregunta={
        <PreguntaMedida key={pregunta.id} pregunta={pregunta} respuestas={respuestas} correcta={clave?.correcta ?? null} revelar={verCorrecta}
          momento="resultados" encabezado={`Pregunta ${indice + 1} de ${sesion.preguntas.length}`} />
      }
      lateral={
        <section className={tarjetaLateral} aria-label={`Pregunta ${indice + 1}`}>
          <Tiempo sesion={sesion} ahora={ahora} pregunta={pregunta} />
          <Estado pregunta={pregunta} respuestas={respuestas} sesion={sesion} />
          <Clave pregunta={pregunta} clave={clave} />
        </section>
      }
    />
  )
}
