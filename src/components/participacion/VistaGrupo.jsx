// Vista del GRUPO: lo único que ve el salón. Tema claro y limpio, sin controles, sin análisis de la IA ni datos de
// calificación. Sala de espera → (modalidad externa) QR protagonista; pregunta → resultados en vivo con su contador; el QR se
// vuelve a desplegar con un control. Es de solo lectura: el docente la maneja desde su vista o desde la carcasa.
//
// Tiempo: la pregunta aparece cuando el SERVIDOR la abre (abreMs) y se cierra cuando vence su límite (cierraMs) o el docente
// la cierra: es el mismo intervalo en que los celulares pueden responder. Antes de abrir se muestra «La pregunta comienza en N».
import SalaQr, { QrSuperpuesto } from './QrAcceso'
import VistaPregunta from './VistaPregunta'
import Temporizador from './Temporizador'
import { tamanosProyeccion } from '../../utils/proyeccionVivo'
import { useCuentaRegresiva } from '../../hooks/useTemporizadorVivo'

export default function VistaGrupo({ sesion, respuestas, claves, area, ahora, verCorrecta = false, mostrarQr = false, onOcultarQr, momento = 'resultados', fijada = null, tamBase = null }) {
  const t = tamBase || tamanosProyeccion(area.ancho, area.alto)
  const { estado, restanteMs, faltaMs } = useCuentaRegresiva(sesion, ahora)
  if (sesion.preguntaIndex < 0) {
    return sesion.acceso === 'externo'
      ? <SalaQr sesion={sesion} area={area} tam={t} />
      : (
        <div className="h-full flex flex-col items-center justify-center text-center gap-[3vmin] px-[6vmin] text-slate-900">
          <h1 className="font-bold" style={{ fontSize: Math.round(t.pregunta * 1.2) }}>{sesion.titulo || 'Participación en vivo'}</h1>
          <p className="font-medium text-slate-700" style={{ fontSize: t.opcion }}>Abre esta actividad en tu asignatura de Evalúa Fácil y responde desde tu celular</p>
        </div>
      )
  }
  const pregunta = sesion.preguntas[Math.min(sesion.preguntaIndex, sesion.preguntas.length - 1)]
  if (estado === 'preparando') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-[2vmin] px-[6vmin] text-slate-900">
        <p className="font-semibold text-slate-700" style={{ fontSize: t.opcion }}>Pregunta {sesion.preguntaIndex + 1} de {sesion.preguntas.length}</p>
        <p className="font-bold" style={{ fontSize: Math.round(t.pregunta * 1.1) }}>La pregunta comienza en</p>
        <output aria-live="off" className="font-bold tabular-nums leading-none" style={{ fontSize: Math.round(t.pregunta * 3) }}>{Math.max(1, Math.ceil((faltaMs ?? 0) / 1000))}</output>
      </div>
    )
  }
  const total = respuestas.filter((r) => r.preguntaId === pregunta.id).length
  const correcta = claves?.[pregunta.id]?.correcta ?? null
  return (
    <div className="relative h-full w-full">
      <VistaPregunta pregunta={pregunta} respuestas={respuestas} area={area} correcta={correcta} revelar={verCorrecta} momento={momento}
        fijada={fijada} autoPaginar tamBase={t}
        encabezado={`Pregunta ${sesion.preguntaIndex + 1} de ${sesion.preguntas.length} · ${total} ${total === 1 ? 'respuesta' : 'respuestas'}`}
        acento={<Temporizador estado={estado} restanteMs={restanteMs} sesion={sesion} tam={t.pregunta} />} />
      {mostrarQr && sesion.acceso === 'externo' && <QrSuperpuesto sesion={sesion} area={area} tam={t} onCerrar={onOcultarQr} />}
    </div>
  )
}
