// La Ruleta del Destino · pantalla de la PARTIDA del estudiante (fases 4 y 5, individual e interna).
// Todo lo decide el servidor (/api/subject/ruleta-partida, api/_lib/ruletaPartida.js): el sorteo, la hora de cada
// pregunta, los 15 s y la calificación. Esta pantalla solo muestra lo que recibe y nunca conoce la respuesta correcta.
// Decisiones del PO (7-nov-2026): una sola partida por estudiante; durante el juego solo «Respuesta registrada» o
// «Se acabó el tiempo»; al final, la calificación sobre 10 y cuántas acertó, sin revelar las opciones correctas.
// Al volver a entrar continúa donde se quedó (el servidor recupera la partida).
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Hourglass, LoaderPinwheel, RotateCw, Trophy, TriangleAlert } from 'lucide-react'
import { Button, Progress } from '../ui'
import { EsqueletoRuletaAlumno } from '../esqueletos'
import { ICONO } from '../../config/iconos'
import { RULETA_CFG } from '../../utils/ruletaDestino'
import { operacionPartida } from '../../utils/ruletaDestinoDb'

const LETRAS = ['A', 'B', 'C', 'D']
const GIRO_MS = 1400 // duración de la animación del giro (decorativa)
const SEGMENTOS = ['var(--accent)', 'var(--accent-light)', 'var(--accent-soft)']

function Aviso({ icono: Icono, titulo, texto, children }) {
  return (
    <div data-esq="ruleta-alumno" className="px-4 py-8 max-w-md mx-auto space-y-6 text-center">
      <div className="mx-auto size-16 rounded-full bg-accent-light text-accent flex items-center justify-center">
        <Icono size={ICONO.lg} aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-on-surface">{titulo}</h1>
        {texto && <p className="text-base text-muted">{texto}</p>}
      </div>
      {children}
    </div>
  )
}

// Ruleta decorativa: N segmentos con los colores del tema y un indicador arriba. Solo selecciona visualmente; la
// pregunta la eligió el servidor al iniciar la partida.
function Rueda({ grados, segmentos }) {
  const paso = 360 / segmentos
  const fondo = `conic-gradient(${Array.from({ length: segmentos }, (_, i) => `${SEGMENTOS[i % SEGMENTOS.length]} ${i * paso}deg ${(i + 1) * paso}deg`).join(', ')})`
  return (
    <div className="relative mx-auto size-56" aria-hidden="true">
      <span className="absolute left-1/2 -top-1 z-10 -translate-x-1/2 border-x-[10px] border-t-[16px] border-x-transparent border-t-on-surface" />
      <div className="size-56 rounded-full border-4 border-surface-card shadow-card transition-transform ease-out motion-reduce:transition-none"
        style={{ background: fondo, transform: `rotate(${grados}deg)`, transitionDuration: `${GIRO_MS}ms` }} />
      <span className="absolute inset-0 m-auto size-14 rounded-full bg-surface-card shadow-card flex items-center justify-center text-accent">
        <LoaderPinwheel size={ICONO.lg} />
      </span>
    </div>
  )
}

export default function PartidaRuleta({ actividadId }) {
  const [vista, setVista] = useState(null) // última respuesta del servidor
  const [error, setError] = useState(null)
  const [fase, setFase] = useState('cargando') // cargando | lista | girando | pregunta | registrada | terminada | error
  const [grados, setGrados] = useState(0)
  const [enviando, setEnviando] = useState(false)
  const [fueraDeTiempo, setFueraDeTiempo] = useState(false)
  const [restanteMs, setRestanteMs] = useState(0)
  const limite = useRef(null) // instante local en que vence la pregunta abierta (a partir del restante del servidor)
  const venciendo = useRef(false)

  const aplicar = useCallback((v) => {
    setVista(v)
    if (v.estado === 'pregunta') {
      limite.current = Date.now() + v.pregunta.restanteMs
      setRestanteMs(v.pregunta.restanteMs)
      venciendo.current = false
      setFase('pregunta')
    } else if (v.estado === 'terminada') {
      setFase('terminada')
    } else {
      setFase('lista')
    }
  }, [])

  const fallar = useCallback((e) => {
    setError(e?.message || 'No se pudo conectar. Intenta de nuevo.')
    setFase('error')
  }, [])

  const cargar = useCallback(async () => {
    try { aplicar(await operacionPartida('estado', { actividadId })) } catch (e) { fallar(e) }
  }, [actividadId, aplicar, fallar])

  // Al abrir: el servidor inicia la partida o la recupera donde se quedó.
  useEffect(() => {
    let vigente = true
    operacionPartida('estado', { actividadId })
      .then((v) => { if (vigente) aplicar(v) })
      .catch((e) => { if (vigente) fallar(e) })
    return () => { vigente = false }
  }, [actividadId, aplicar, fallar])

  // Cuenta regresiva local (solo se muestra; el servidor es quien decide). Al llegar a 0 se le pregunta al servidor,
  // que registra la pregunta como sin respuesta.
  useEffect(() => {
    if (fase !== 'pregunta') return undefined
    const id = setInterval(() => {
      const r = Math.max(0, limite.current - Date.now())
      setRestanteMs(r)
      if (r === 0 && !venciendo.current) {
        venciendo.current = true
        operacionPartida('estado', { actividadId })
          .then((v) => { if (v.estado === 'pregunta') { aplicar(v); return } setVista(v); setFueraDeTiempo(true); setFase('registrada') })
          .catch(fallar)
      }
    }, 200)
    return () => clearInterval(id)
  }, [fase, actividadId, aplicar, fallar])

  async function girarRuleta() {
    setFase('girando')
    setFueraDeTiempo(false)
    setGrados((g) => g + 1080 + Math.floor(Math.random() * 360))
    const espera = new Promise((ok) => setTimeout(ok, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : GIRO_MS))
    try {
      const [v] = await Promise.all([operacionPartida('girar', { actividadId }), espera])
      aplicar(v)
    } catch (e) { fallar(e) }
  }

  async function elegir(opcion) {
    if (enviando || fase !== 'pregunta') return
    setEnviando(true)
    try {
      const v = await operacionPartida('responder', { actividadId, indice: vista.pregunta.indice, opcion })
      setVista(v)
      setFueraDeTiempo(v.fueraDeTiempo === true)
      setFase('registrada')
    } catch (e) {
      if (e?.codigo === 'PREGUNTA_NO_ABIERTA') await cargar() // otra pestaña o un reintento: se pide el estado real
      else fallar(e)
    } finally {
      setEnviando(false)
    }
  }

  if (fase === 'cargando') return <EsqueletoRuletaAlumno />
  if (fase === 'error') {
    return (
      <Aviso icono={TriangleAlert} titulo="No se puede jugar ahora" texto={error}>
        <Button variant="secondary" icon={RotateCw} onClick={() => { setFase('cargando'); cargar() }}>Intentar de nuevo</Button>
      </Aviso>
    )
  }

  const total = vista.total
  const respondidas = vista.respondidas

  if (fase === 'terminada') {
    const r = vista.resultado
    return (
      <Aviso icono={Trophy} titulo="¡Terminaste tu partida!">
        <div className="rounded-card bg-surface-card shadow-card p-6 space-y-2" aria-live="polite">
          <p className="text-sm text-muted">Tu calificación</p>
          <p className="text-4xl font-bold text-accent">{r.calificacion} <span className="text-xl font-semibold text-muted">/ {RULETA_CFG.CALIFICACION_MAXIMA}</span></p>
          <p className="text-base text-on-surface">Acertaste {r.correctas} de {r.total} preguntas.</p>
        </div>
      </Aviso>
    )
  }

  const encabezado = (
    <div className="space-y-2">
      <p className="text-sm text-muted text-center">
        {fase === 'pregunta' || fase === 'girando' ? `Pregunta ${Math.min(respondidas + 1, total)} de ${total}` : `Llevas ${respondidas} de ${total} preguntas`}
      </p>
      <Progress value={respondidas / total} label="Avance de la partida" />
    </div>
  )

  if (fase === 'pregunta') {
    const q = vista.pregunta
    const segundos = Math.ceil(restanteMs / 1000)
    return (
      <div data-esq="ruleta-alumno" className="px-4 py-8 max-w-md mx-auto space-y-6">
        {encabezado}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted flex items-center gap-1"><Hourglass size={ICONO.sm} aria-hidden="true" /> Tiempo</span>
            <span className={`font-semibold ${segundos <= 5 ? 'text-red-600' : 'text-on-surface'}`} aria-live="off">{segundos} s</span>
          </div>
          <Progress value={restanteMs / RULETA_CFG.TIEMPO_RESPUESTA_MS} label="Tiempo restante" />
        </div>
        <h1 className="text-lg font-semibold text-on-surface break-words">{q.enunciado}</h1>
        <div className="space-y-2">
          {q.opciones.map((o, i) => (
            <Button key={LETRAS[i]} variant="secondary" fullWidth className="text-left justify-start" disabled={enviando}
              onClick={() => elegir(i)}>
              <span className="size-8 flex-shrink-0 rounded-full bg-accent-light text-accent font-bold flex items-center justify-center" aria-hidden="true">{LETRAS[i]}</span>
              <span className="flex-1 min-w-0 break-words">{o}</span>
            </Button>
          ))}
        </div>
      </div>
    )
  }

  // lista, girando o registrada: la ruleta y el botón para girar.
  const terminoTodo = vista.estado === 'terminada'
  const primera = respondidas === 0 && fase === 'lista'
  return (
    <div data-esq="ruleta-alumno" className="px-4 py-8 max-w-md mx-auto space-y-6">
      {encabezado}
      {fase === 'registrada' && (
        <output className={`text-center text-base font-medium flex items-center justify-center gap-2 ${fueraDeTiempo ? 'text-amber-700' : 'text-emerald-700'}`}>
          {fueraDeTiempo ? <Hourglass size={ICONO.md} aria-hidden="true" /> : <CheckCircle2 size={ICONO.md} aria-hidden="true" />}
          {fueraDeTiempo ? 'Se acabó el tiempo' : 'Respuesta registrada'}
        </output>
      )}
      <Rueda grados={grados} segmentos={Math.max(total, 5)} />
      {primera && (
        <p className="text-base text-muted text-center">
          Son {total} preguntas de opción múltiple. Cada una tiene {RULETA_CFG.TIEMPO_RESPUESTA_MS / 1000} segundos y solo cuenta tu primera respuesta.
          Tienes una sola partida: si sales, continúas donde te quedaste.
        </p>
      )}
      {terminoTodo ? (
        <Button fullWidth icon={Trophy} onClick={() => setFase('terminada')}>Ver mi resultado</Button>
      ) : (
        <Button fullWidth icon={LoaderPinwheel} onClick={girarRuleta} busy={fase === 'girando'} disabled={fase === 'girando'}>
          {primera ? 'Girar la ruleta' : 'Girar otra vez'}
        </Button>
      )}
    </div>
  )
}
