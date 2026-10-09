import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChevronRight, Pause, Play, RotateCcw, RotateCw, AlertTriangle } from 'lucide-react'
import Spinner from '../Spinner'
import { useToast } from '../Toast'
import { EsqueletoVideoInteractivo } from '../esqueletos'
import useYouTubePlayer, { ESTADO_YT, mensajeErrorYouTube } from '../../hooks/useYouTubePlayer'
import useProgresoVideo from '../../hooks/useProgresoVideo'
import {
  ordenarPreguntasVideo, tick, reanudar, antesDeReproducir, alTerminar, siguientePregunta, acotarSalto,
  videoCompletado, porcentajeVisto, formatearTiempo, resumenRespuestas,
} from '../../utils/videoProgreso'
import LineaTiempoVideo from './LineaTiempoVideo'
import PreguntaRespuesta from './PreguntaRespuesta'

// Video interactivo · pantalla del estudiante (fase 1).
//
// Se monta DENTRO de EvaluacionRunner (que ya hizo la carga del intento, de las
// respuestas guardadas, el cronómetro, la cabecera y el aviso de salir) y solo
// se encarga de lo propio del video. Todo lo que cuenta como respuesta, su
// guardado y la entrega usan los manejadores del runner, sin cambios:
// la calificación sigue siendo la de siempre, en el servidor.
//
// Diseño (móvil primero): el video arriba, la línea de tiempo y los botones
// debajo, y la pregunta SIEMPRE en un panel aparte debajo del video — nunca
// encima: YouTube prohíbe poner elementos sobre su reproductor. En pantallas
// anchas (y en teléfono horizontal) el panel pasa a la derecha.
//
// Fases: listo → reproduciendo ⇄ pausado → pregunta → … → final.

const TIEMPO_AVISO_MS = 4000

export default function VideoInteractivoRunner(props) {
  const { submission } = props
  const intento = submission.intentoActual || 1
  const toast = useToast()
  const { cargando, inicial, guardar } = useProgresoVideo({
    submissionId: submission.id,
    intento,
    onFalla: () => toast('No pudimos guardar tu avance en el video. Revisa tu conexión.', 'warning'),
  })
  if (cargando) return <EsqueletoVideoInteractivo />
  return <VideoInteractivoPantalla {...props} progresoInicial={inicial} guardarProgreso={guardar} />
}

function VideoInteractivoPantalla({
  activity, preguntas, respuestas, otraTextos, estaRespondida,
  onSelectOpcion, onTextoChange, onOtraTextoChange, onFinalizar, finishing,
  progresoInicial, guardarProgreso,
}) {
  const toast = useToast()
  const vi = activity.videoInteractivo || {}
  const libre = activity.evaluacion?.navegacion !== 'secuencial'
  const [duracion, setDuracion] = useState(Math.max(0, Number(vi.duracionSeg) || 0))
  const ordenadas = useMemo(() => ordenarPreguntasVideo(preguntas, duracion), [preguntas, duracion])

  // Lo último, para el sondeo y los eventos del reproductor (que viven más que un render).
  const ordenadasRef = useRef(ordenadas)
  const respondidaRef = useRef(estaRespondida)
  const duracionRef = useRef(duracion)
  useEffect(() => { ordenadasRef.current = ordenadas; respondidaRef.current = estaRespondida; duracionRef.current = duracion })
  const respondida = useCallback((p) => respondidaRef.current(p), [])

  // Dónde se quedó (se calcula UNA vez al entrar).
  const [reanud] = useState(() => reanudar({ progreso: progresoInicial, ordenadas, respondida: estaRespondida, duracion }))
  const yaEmpezo = Number(progresoInicial?.maxVistoSeg) > 0 || Number(progresoInicial?.posicionSeg) > 0 // ya había visto algo en este intento
  const tickRef = useRef({ maxVisto: reanud.maxVisto, ultimaPos: reanud.posicion, ultimoT: null })

  const [fase, setFase] = useState(reanud.completado ? 'final' : 'listo')
  const faseRef = useRef(fase)
  const cambiarFase = (f) => { faseRef.current = f; setFase(f) }
  const [posUI, setPosUI] = useState(reanud.posicion)
  const [maxUI, setMaxUI] = useState(reanud.maxVisto)
  const [activaId, setActivaId] = useState(null)
  const [aviso, setAviso] = useState('')
  const avisoT = useRef(null)
  const contenedorRef = useRef(null)
  const infoRef = useRef(null)
  const tituloPanelRef = useRef(null)

  function avisar(texto) {
    setAviso(texto)
    clearTimeout(avisoT.current)
    avisoT.current = setTimeout(() => setAviso(''), TIEMPO_AVISO_MS)
  }
  useEffect(() => () => clearTimeout(avisoT.current), [])

  // La fase «reproduciendo» la pone el propio reproductor (evento de estado), no
  // este botón: si el navegador bloquea el arranque (política de reproducción
  // automática), la pantalla no finge que el video corre — avisa y deja volver a tocar.
  const arranqueT = useRef(null)
  function iniciarReproduccion() {
    yt.reproducir()
    clearTimeout(arranqueT.current)
    arranqueT.current = setTimeout(() => {
      const e = yt.estado()
      if (e !== ESTADO_YT.REPRODUCIENDO && e !== ESTADO_YT.CARGANDO && faseRef.current !== 'pregunta') {
        avisar('El video no arrancó. Toca ▶ otra vez.')
      }
    }, 2500)
  }
  useEffect(() => () => clearTimeout(arranqueT.current), [])

  function abrirPregunta(p) {
    setActivaId(p.id)
    cambiarFase('pregunta')
    guardarProgreso(tickRef.current.maxVisto, tickRef.current.ultimaPos, { forzar: true })
    // Que la pregunta quede a la vista, justo debajo del video.
    requestAnimationFrame(() => {
      infoRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      tituloPanelRef.current?.focus?.({ preventScroll: true })
    })
  }

  function alTerminarVideo() {
    const t = tickRef.current
    const d = duracionRef.current
    // Llegar al final solo cuenta si se vio hasta ahí: nada de saltar al último segundo.
    if (t.maxVisto < d - 4) {
      yt.saltarA(t.maxVisto)
      yt.pausar()
      cambiarFase('pausado')
      avisar('Solo puedes ver hasta donde llegaste.')
      return
    }
    tickRef.current = { ...t, maxVisto: Math.max(t.maxVisto, d), ultimaPos: d }
    setMaxUI(Math.max(t.maxVisto, d))
    setPosUI(d)
    const pend = alTerminar(ordenadasRef.current, respondida)
    if (pend) { yt.saltarA(pend.timestampSeg); abrirPregunta(pend); return }
    cambiarFase('final')
    guardarProgreso(d, d, { forzar: true })
  }

  const yt = useYouTubePlayer({
    videoId: vi.videoId,
    contenedorRef,
    inicioSeg: reanud.posicion,
    onEstado: (codigo) => {
      if (codigo === ESTADO_YT.REPRODUCIENDO) {
        // Con una pregunta abierta no se reanuda por tocar el video: primero se contesta.
        if (faseRef.current === 'pregunta') { yt.pausar(); return }
        cambiarFase('reproduciendo')
      } else if (codigo === ESTADO_YT.PAUSADO) {
        if (faseRef.current === 'reproduciendo') {
          cambiarFase('pausado')
          guardarProgreso(tickRef.current.maxVisto, tickRef.current.ultimaPos, { forzar: true })
        }
      } else if (codigo === ESTADO_YT.TERMINADO) {
        alTerminarVideo()
      }
    },
  })

  // Sondeo del reproductor (4 veces por segundo): avance, saltos y preguntas.
  // La pantalla solo se actualiza cuando hay un cambio visible.
  useEffect(() => {
    if (!yt.listo) return undefined
    const id = setInterval(() => {
      const est = yt.estado()
      if (est === ESTADO_YT.SIN_INICIAR || est === ESTADO_YT.LISTO) return
      const d = yt.duracion()
      if (duracionRef.current <= 0 && d > 0) { duracionRef.current = d; setDuracion(d) }
      const pos = yt.tiempo()
      const r = tick(tickRef.current, {
        pos,
        ahora: Date.now(),
        jugando: est === ESTADO_YT.REPRODUCIENDO,
        visible: typeof document === 'undefined' ? true : !document.hidden,
        duracion: duracionRef.current,
        ordenadas: ordenadasRef.current,
        respondida,
      })
      tickRef.current = { maxVisto: r.maxVisto, ultimaPos: r.ultimaPos, ultimoT: r.ultimoT }
      if (r.accion === 'salto') {
        yt.saltarA(r.irA)
        avisar('Solo puedes ver hasta donde llegaste.')
      } else if (r.accion === 'pregunta' && faseRef.current !== 'pregunta') {
        yt.pausar()
        yt.saltarA(r.irA)
        tickRef.current = { ...tickRef.current, ultimaPos: r.irA }
        abrirPregunta(r.pregunta)
      }
      setPosUI((p) => (Math.abs(p - r.ultimaPos) >= 0.5 ? r.ultimaPos : p))
      setMaxUI((m) => (Math.abs(m - r.maxVisto) >= 0.5 ? r.maxVisto : m))
      if (est === ESTADO_YT.REPRODUCIENDO) guardarProgreso(r.maxVisto, r.ultimaPos)
    }, 250)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- un solo sondeo por reproductor
  }, [yt.listo])

  // Guardar al ocultar la página y al salir de la pantalla.
  useEffect(() => {
    const guardarYa = () => guardarProgreso(tickRef.current.maxVisto, tickRef.current.ultimaPos, { forzar: true })
    const alOcultar = () => { if (document.hidden) guardarYa() }
    document.addEventListener('visibilitychange', alOcultar)
    window.addEventListener('pagehide', guardarYa)
    return () => {
      document.removeEventListener('visibilitychange', alOcultar)
      window.removeEventListener('pagehide', guardarYa)
      guardarYa()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar/desmontar
  }, [])

  // ── Acciones del estudiante ──────────────────────────────────────────────
  function alternarReproduccion() {
    const f = faseRef.current
    if (f === 'pregunta') return
    if (f === 'reproduciendo') { yt.pausar(); return }
    const pos = f === 'listo' ? reanud.posicion : yt.tiempo()
    const pre = antesDeReproducir(ordenadasRef.current, respondida, pos)
    if (pre) { yt.saltarA(pre.timestampSeg); abrirPregunta(pre); return }
    if (f === 'final' || pos >= duracionRef.current - 1) { yt.saltarA(0); tickRef.current = { ...tickRef.current, ultimaPos: 0, ultimoT: null } }
    iniciarReproduccion()
  }

  // Salto pedido por el estudiante: nunca más allá de lo visto.
  function saltar(destino) {
    if (faseRef.current === 'pregunta') return
    const d = acotarSalto(destino, tickRef.current.maxVisto)
    if (destino > tickRef.current.maxVisto + 1) avisar('Solo puedes ver hasta donde llegaste.')
    const estaba = faseRef.current === 'reproduciendo'
    yt.saltarA(d)
    if (!estaba) yt.pausar()
    tickRef.current = { ...tickRef.current, ultimaPos: d, ultimoT: null }
    setPosUI(d)
    if (faseRef.current === 'listo') cambiarFase('pausado')
  }

  function tocarMarca(p) {
    if (faseRef.current === 'pregunta') return
    if (p.timestampSeg > tickRef.current.maxVisto + 0.3) { avisar('Aún no llegas a esa pregunta.'); return }
    const contestada = respondida(p)
    yt.pausar()
    yt.saltarA(p.timestampSeg)
    tickRef.current = { ...tickRef.current, ultimaPos: p.timestampSeg, ultimoT: null }
    setPosUI(p.timestampSeg)
    // Una pregunta pendiente siempre se abre. Una ya contestada solo en navegación
    // libre (para cambiar la respuesta); en secuencial solo se repasa el video.
    if (!contestada || libre) { abrirPregunta(p); return }
    cambiarFase('pausado')
  }

  function continuar() {
    const p = ordenadasRef.current.find((q) => q.id === activaId)
    if (!p) return
    if (!estaRespondida(p)) { toast('Responde esta pregunta para continuar.', 'warning'); return }
    setActivaId(null)
    // Sale de «pregunta» ya: si no, el evento de «reproduciendo» se tomaría por un
    // intento de seguir sin contestar y volvería a pausar el video.
    cambiarFase('pausado')
    guardarProgreso(tickRef.current.maxVisto, tickRef.current.ultimaPos, { forzar: true })
    const pos = tickRef.current.ultimaPos
    // ¿Otra pregunta en el mismo punto (o pendiente al terminar)?
    const siguiente = antesDeReproducir(ordenadasRef.current, respondida, pos)
    if (siguiente) { abrirPregunta(siguiente); return }
    if (pos >= duracionRef.current - 0.5) { alTerminarVideo(); return }
    iniciarReproduccion()
  }

  function entregar() {
    if (!videoCompletado(tickRef.current.maxVisto, duracionRef.current)) {
      toast('Termina de ver el video para entregar.', 'warning')
      return
    }
    onFinalizar()
  }

  // ── Lo que se pinta ─────────────────────────────────────────────────────
  const resumen = resumenRespuestas(ordenadas, estaRespondida)
  const activa = ordenadas.find((p) => p.id === activaId) || null
  const indiceActiva = activa ? ordenadas.findIndex((p) => p.id === activa.id) + 1 : 0
  const numeroActual = activa ? indiceActiva : Math.min(resumen.contestadas + 1, resumen.total)
  const visto = porcentajeVisto(maxUI, duracion)
  const proxima = siguientePregunta(ordenadas, estaRespondida, posUI)
  const puedeEntregar = resumen.pendientes === 0 && videoCompletado(maxUI, duracion)
  const jugando = fase === 'reproduciendo'
  const bloqueado = !yt.listo || fase === 'pregunta'

  return (
    <div style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div data-esq="video-contenedor" className="px-4 py-4 w-full max-w-xl lg:max-w-6xl [@media(orientation:landscape)_and_(max-height:500px)]:max-w-none mx-auto">
        <div data-esq="video-rejilla" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start [@media(orientation:landscape)_and_(max-height:500px)]:grid-cols-[minmax(0,1fr)_320px]">
          {/* ── Columna del video ── */}
          <div className="min-w-0 space-y-3">
            <div ref={infoRef} className="flex items-center justify-between gap-2 scroll-mt-24">
              <span className="inline-flex items-center gap-1.5 bg-accent-light text-accent text-sm font-bold px-3 py-1 rounded-full">
                Pregunta {numeroActual} <span className="font-medium opacity-70">de {resumen.total}</span>
              </span>
              <span className="text-sm text-muted tabular-nums">Video visto {visto} %</span>
            </div>

            {/* Nada va encima de este recuadro: lo llena el reproductor de YouTube. */}
            <div data-esq="video-reproductor" ref={contenedorRef} className="w-full aspect-video min-h-[14rem] bg-black rounded-card overflow-hidden" />

            <div className={fase === 'pregunta' ? 'max-lg:hidden' : ''}>
              <LineaTiempoVideo
                duracion={duracion} posicion={posUI} maxVisto={maxUI} preguntas={ordenadas}
                respondida={estaRespondida} activaId={activaId} onSaltar={saltar} onMarca={tocarMarca} />
              <div className="flex items-center justify-center gap-4 mt-1">
                <button type="button" disabled={bloqueado} onClick={() => saltar(posUI - 10)} aria-label="Retroceder 10 segundos"
                  className="w-14 h-14 rounded-full border border-outline-variant text-muted flex items-center justify-center disabled:opacity-60">
                  <RotateCcw size={20} />
                </button>
                <button type="button" disabled={bloqueado} onClick={alternarReproduccion}
                  aria-label={jugando ? 'Pausar' : 'Reproducir'}
                  className="w-16 h-16 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-60">
                  {jugando ? <Pause size={26} /> : <Play size={26} className="ml-0.5" />}
                </button>
                <button type="button" disabled={bloqueado || posUI >= maxUI - 0.5} onClick={() => saltar(posUI + 10)} aria-label="Adelantar 10 segundos"
                  className="w-14 h-14 rounded-full border border-outline-variant text-muted flex items-center justify-center disabled:opacity-60">
                  <RotateCw size={20} />
                </button>
              </div>
            </div>
            <p className="min-h-[1.25rem] text-xs text-amber-700 text-center" aria-live="polite">{aviso}</p>
          </div>

          {/* ── Panel: instrucciones / pregunta / entrega ── */}
          <div data-esq="video-panel" className="bg-surface-card rounded-card p-4 shadow-card" aria-live="polite">
            {yt.error != null ? (
              <div className="space-y-3 text-center">
                <AlertTriangle size={28} className="mx-auto text-amber-600" />
                <p className="text-sm text-on-surface">{mensajeErrorYouTube(yt.error)}</p>
                <p className="text-xs text-muted">Tu avance está guardado. Puedes intentar de nuevo o avisarle a tu maestro.</p>
                <button type="button" onClick={yt.reintentar} className="w-full min-h-[3.25rem] bg-accent text-white font-semibold rounded-full">Intentar de nuevo</button>
              </div>
            ) : fase === 'pregunta' && activa ? (
              <div className="space-y-3">
                <h2 ref={tituloPanelRef} tabIndex={-1} className="text-xs font-bold uppercase tracking-wide text-accent focus:outline-none">
                  Pregunta {indiceActiva} de {resumen.total} · minuto {formatearTiempo(activa.timestampSeg)}
                </h2>
                {activa.imagenUrl && (
                  <img src={activa.imagenUrl} alt="" className="w-full max-h-56 object-contain rounded border border-outline-variant" />
                )}
                <p className="text-base font-medium text-on-surface break-words">{activa.enunciado}</p>
                <PreguntaRespuesta
                  pregunta={activa} respuesta={respuestas[activa.id]} otraTexto={otraTextos[activa.id]}
                  onSelectOpcion={onSelectOpcion} onTextoChange={onTextoChange} onOtraTextoChange={onOtraTextoChange} />
                <button type="button" onClick={continuar}
                  className="w-full min-h-[3.25rem] flex items-center justify-center gap-1 bg-accent text-white font-semibold rounded-full">
                  Continuar <ChevronRight size={18} />
                </button>
                <p className="text-xs text-hint text-center">Responde para seguir viendo el video.</p>
              </div>
            ) : fase === 'final' ? (
              <div className="space-y-3">
                <h2 className="text-base font-bold text-on-surface">¡Terminaste el video!</h2>
                <ul className="space-y-1.5 text-sm">
                  <li className="flex items-center gap-2 text-on-surface">
                    <CheckCircle2 size={18} className={resumen.pendientes === 0 ? 'text-emerald-600' : 'text-hint'} />
                    {resumen.contestadas}/{resumen.total} preguntas respondidas
                  </li>
                  <li className="flex items-center gap-2 text-on-surface">
                    <CheckCircle2 size={18} className={videoCompletado(maxUI, duracion) ? 'text-emerald-600' : 'text-hint'} />
                    Video visto {visto} %
                  </li>
                </ul>
                <button type="button" onClick={entregar} disabled={finishing || !puedeEntregar}
                  className="w-full min-h-[3.25rem] flex items-center justify-center gap-2 bg-accent text-white font-semibold rounded-full disabled:opacity-60">
                  {finishing ? <Spinner size="sm" /> : <CheckCircle2 size={18} />}
                  {finishing ? 'Entregando…' : 'Entregar'}
                </button>
                <button type="button" onClick={alternarReproduccion} className="w-full min-h-[2.75rem] text-sm text-accent font-medium">
                  Repasar el video
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <h2 className="text-base font-bold text-on-surface">
                  {fase === 'listo' ? (yaEmpezo ? 'Continúa tu video' : 'Video interactivo') : 'Sigue viendo el video'}
                </h2>
                {fase === 'listo' ? (
                  <p className="text-sm text-muted">
                    El video se detendrá en {resumen.total} {resumen.total === 1 ? 'pregunta' : 'preguntas'}. Respóndelas para seguir.
                    Puedes regresar a lo que ya viste, pero no adelantarte.
                  </p>
                ) : proxima ? (
                  <p className="text-sm text-on-surface">
                    Siguiente pregunta en <span className="font-bold tabular-nums">{formatearTiempo(proxima.enSeg)}</span>
                  </p>
                ) : (
                  <p className="text-sm text-on-surface">No hay más preguntas. Termina el video para entregar.</p>
                )}
                {fase === 'listo' && (
                  <button type="button" onClick={alternarReproduccion} disabled={!yt.listo}
                    className="w-full min-h-[3.25rem] flex items-center justify-center gap-2 bg-accent text-white font-semibold rounded-full disabled:opacity-60">
                    {yt.listo ? <Play size={20} /> : <Spinner size="sm" />}
                    {!yt.listo ? 'Cargando video…'
                      : yaEmpezo && reanud.pendiente ? 'Responder la pregunta pendiente'
                        : reanud.posicion > 0 ? `Continuar desde ${formatearTiempo(reanud.posicion)}` : 'Comenzar'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
