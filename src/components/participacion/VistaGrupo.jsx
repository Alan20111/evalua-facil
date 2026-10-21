// Vista del GRUPO: lo único que ve el salón. Tema claro y limpio, sin controles, sin análisis de la IA ni datos de
// calificación. Sala de espera → (modalidad externa) QR protagonista; pregunta → resultados en vivo; el QR se vuelve a
// desplegar con un control. Es de solo lectura: el docente la maneja desde su vista o desde la carcasa.
import SalaQr, { QrSuperpuesto } from './QrAcceso'
import VistaPregunta from './VistaPregunta'
import { tamanosProyeccion } from '../../utils/proyeccionVivo'

export default function VistaGrupo({ sesion, respuestas, claves, area, verCorrecta = false, mostrarQr = false, onOcultarQr, momento = 'resultados', incluirVacias = false, fijada = null }) {
  const t = tamanosProyeccion(area.ancho, area.alto)
  if (sesion.preguntaIndex < 0) {
    return sesion.acceso === 'externo'
      ? <SalaQr sesion={sesion} area={area} />
      : (
        <div className="h-full flex flex-col items-center justify-center text-center gap-[3vmin] px-[6vmin] text-slate-900">
          <h1 className="font-bold" style={{ fontSize: Math.round(t.pregunta * 1.2) }}>{sesion.titulo || 'Participación en vivo'}</h1>
          <p className="font-medium text-slate-700" style={{ fontSize: t.opcion }}>Abre esta actividad en tu asignatura de Evalúa Fácil y responde desde tu celular</p>
        </div>
      )
  }
  const pregunta = sesion.preguntas[Math.min(sesion.preguntaIndex, sesion.preguntas.length - 1)]
  const total = respuestas.filter((r) => r.preguntaId === pregunta.id).length
  const correcta = claves?.[pregunta.id]?.correcta ?? null
  return (
    <div className="relative h-full w-full">
      <VistaPregunta pregunta={pregunta} respuestas={respuestas} area={area} correcta={correcta} revelar={verCorrecta} momento={momento}
        incluirVacias={incluirVacias} fijada={fijada} autoPaginar
        encabezado={`Pregunta ${sesion.preguntaIndex + 1} de ${sesion.preguntas.length} · ${total} ${total === 1 ? 'respuesta' : 'respuestas'}`} />
      {mostrarQr && sesion.acceso === 'externo' && <QrSuperpuesto sesion={sesion} area={area} onCerrar={onOcultarQr} />}
    </div>
  )
}
