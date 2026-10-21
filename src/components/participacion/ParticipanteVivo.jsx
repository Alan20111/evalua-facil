// Participación en vivo — pantalla del PARTICIPANTE (celular).
//
// La usan las dos modalidades con el mismo diseño:
//   · inscrito → /alumno/participacion/:activityId  (props: actividadId, conSesion)
//   · externo  → /p/:codigo                         (props: codigo; sin cuenta ni token)
//
// El estado se consulta cada pocos segundos (no hay conexión permanente: el participante no tiene
// acceso a Firestore). Lo que se proyecta al aula sí se actualiza en tiempo real en la pantalla del docente.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Hourglass, Send } from 'lucide-react'
import { Button } from '../ui'
import Spinner from '../Spinner'
import { claveParticipanteLocal, llamarVivo } from '../../utils/participacionVivoDb'
import { VIVO_CFG } from '../../utils/participacionVivo'

const INTERVALO_MS = 3000
const COLORES = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626']

function Aviso({ icono: Icono, titulo, texto, children }) {
  return (
    <div className="text-center px-6 py-12 max-w-md mx-auto">
      <div className="mx-auto mb-4 size-16 rounded-full bg-accent-light text-accent flex items-center justify-center">
        <Icono size={24} aria-hidden="true" />
      </div>
      <h1 className="text-xl font-semibold text-on-surface mb-2">{titulo}</h1>
      {texto && <p className="text-base text-muted">{texto}</p>}
      {children}
    </div>
  )
}

export default function ParticipanteVivo({ codigo = null, actividadId = null, conSesion = false }) {
  const [estado, setEstado] = useState(null) // respuesta de vivo-estado
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [opcion, setOpcion] = useState(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState(null)
  const [enviadas, setEnviadas] = useState(() => new Set()) // `${codigo}:${preguntaId}` ya enviadas desde aquí
  const participanteKey = useRef(conSesion ? null : claveParticipanteLocal())
  const preguntaActual = useRef(null)

  const consultar = useCallback(async () => {
    try {
      const r = await llamarVivo('vivo-estado', { codigo, actividadId, participanteKey: participanteKey.current }, { conSesion })
      setEstado(r)
      setError(null)
    } catch (e) {
      // 404/403: no hay nada que seguir intentando; el resto (red) se reintenta solo.
      setError({ mensaje: e.message, definitivo: e.status === 404 || e.status === 403 || e.status === 401 })
    } finally {
      setCargando(false)
    }
  }, [codigo, actividadId, conSesion])

  useEffect(() => {
    let vivo = true
    let timer
    const ciclo = async () => {
      if (!vivo) return
      if (!document.hidden) await consultar()
      if (vivo) timer = setTimeout(ciclo, INTERVALO_MS)
    }
    ciclo()
    return () => { vivo = false; clearTimeout(timer) }
  }, [consultar])

  // Al cambiar de pregunta se limpia lo que se estaba escribiendo.
  const idPregunta = estado?.pregunta?.id ?? null
  useEffect(() => {
    if (preguntaActual.current !== idPregunta) {
      preguntaActual.current = idPregunta
      setOpcion(null); setTexto(''); setErrorEnvio(null)
    }
  }, [idPregunta])

  const sesion = estado?.sesion
  const pregunta = estado?.pregunta
  const clave = sesion && pregunta ? `${sesion.codigo}:${pregunta.id}` : null
  const yaRespondio = !!estado?.yaRespondio || (clave && enviadas.has(clave))

  async function enviar() {
    if (!sesion || !pregunta || enviando) return
    setEnviando(true); setErrorEnvio(null)
    try {
      await llamarVivo('vivo-responder', {
        codigo: sesion.codigo, preguntaId: pregunta.id, participanteKey: participanteKey.current,
        ...(pregunta.tipo === 'opcion_unica' ? { opcion } : { texto }),
      }, { conSesion })
      setEnviadas((prev) => new Set(prev).add(clave))
    } catch (e) {
      setErrorEnvio(e.message)
      if (e.status === 409) consultar() // la pregunta cambió o se cerró: refrescar
    } finally {
      setEnviando(false)
    }
  }

  if (cargando) return <div className="min-h-dvh flex items-center justify-center"><Spinner /></div>
  if (error?.definitivo) {
    return <div className="min-h-dvh bg-surface"><Aviso icono={Hourglass} titulo="No pudimos abrir esta participación" texto={error.mensaje} /></div>
  }

  let cuerpo
  if (!sesion) {
    cuerpo = <Aviso icono={Hourglass} titulo="Aún no hay una participación activa" texto="Cuando tu docente la inicie, aparecerá aquí sola." />
  } else if (sesion.estado === 'finalizada') {
    cuerpo = <Aviso icono={Check} titulo="La participación terminó" texto="¡Gracias por participar!" />
  } else if (!pregunta) {
    cuerpo = <Aviso icono={Hourglass} titulo="Listo, ya estás dentro" texto="Espera: tu docente mostrará la primera pregunta en un momento." />
  } else if (yaRespondio) {
    cuerpo = <Aviso icono={Check} titulo="¡Respuesta enviada!" texto="Espera la siguiente pregunta; aparecerá sola." />
  } else if (!sesion.aceptando) {
    cuerpo = <Aviso icono={Hourglass} titulo="Respuestas cerradas" texto="Tu docente cerró las respuestas de esta pregunta. Espera la siguiente." />
  } else {
    const abierta = pregunta.tipo !== 'opcion_unica'
    const max = pregunta.tipo === 'abierta_breve' ? VIVO_CFG.MAX_RESPUESTA_BREVE : VIVO_CFG.MAX_RESPUESTA_EXTENSA
    const puedeEnviar = abierta ? texto.trim().length > 0 : opcion != null
    cuerpo = (
      <div className="max-w-xl mx-auto px-4 py-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent mb-2">
          Pregunta {sesion.preguntaIndex + 1} de {sesion.total}
        </p>
        <h1 className="text-2xl font-semibold text-on-surface leading-snug mb-4">{pregunta.enunciado}</h1>

        {!abierta ? (
          <fieldset className="space-y-3">
            <legend className="sr-only">Opciones</legend>
            {pregunta.opciones.map((o, i) => {
              const activa = opcion === o.id
              return (
                <button key={o.id} type="button" aria-pressed={activa} onClick={() => setOpcion(o.id)}
                  className={`block w-full min-h-16 text-left rounded-card border-2 px-4 py-3 text-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${activa ? 'text-white border-transparent' : 'bg-surface-card text-on-surface border-outline-variant'}`}
                  style={activa ? { backgroundColor: COLORES[i % COLORES.length] } : { borderLeftColor: COLORES[i % COLORES.length], borderLeftWidth: 8 }}>
                  {o.texto}
                </button>
              )
            })}
          </fieldset>
        ) : (
          <div>
            <label htmlFor="vivo-respuesta" className="block text-sm text-muted mb-1">{pregunta.tipo === 'abierta_breve' ? 'Tu respuesta (una a tres palabras)' : 'Tu respuesta'}</label>
            <textarea id="vivo-respuesta" value={texto} maxLength={max} rows={pregunta.tipo === 'abierta_breve' ? 2 : 5}
              onChange={(e) => setTexto(e.target.value)}
              className="w-full rounded-card border-2 border-outline-variant bg-surface-card px-4 py-3 text-lg text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
            <p className="text-xs text-hint text-right mt-1 tabular-nums">{texto.length}/{max}</p>
          </div>
        )}

        {errorEnvio && <p role="alert" className="text-sm text-red-600 mt-3">{errorEnvio}</p>}
        <Button size="lg" fullWidth className="mt-4" icon={Send} busy={enviando} disabled={!puedeEnviar || enviando} onClick={enviar}>
          {enviando ? 'Enviando…' : 'Enviar respuesta'}
        </Button>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-surface" data-vivo-participante>
      {error && !error.definitivo && (
        <output className="block text-center text-xs text-hint py-1 bg-surface-container">Sin conexión; reintentando…</output>
      )}
      {cuerpo}
    </div>
  )
}
