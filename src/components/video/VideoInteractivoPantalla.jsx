import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChevronRight, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, AlertTriangle } from 'lucide-react'
import Spinner from '../Spinner'
import { useToast } from '../Toast'
import useYouTubePlayer, { ESTADO_YT, mensajeErrorYouTube } from '../../hooks/useYouTubePlayer'
import usePantallaCompleta from '../../hooks/usePantallaCompleta'
import useMediaQuery from '../../hooks/useMediaQuery'
import { panelVisibleEnPantallaCompleta, altoDisponibleVideo } from './pantallaCompletaVideo'
import {
  ordenarPreguntasVideo, tick, reanudar, antesDeReproducir, alTerminar, siguientePregunta, acotarSalto,
  videoCompletado, porcentajeVisto, formatearTiempo, resumenRespuestas,
} from '../../utils/videoProgreso'
import LineaTiempoVideo from './LineaTiempoVideo'
import PreguntaRespuesta from './PreguntaRespuesta'
import { LIBRE_SEG, PRE_SEG, clampSeg } from './revisionVideo'

// Video interactivo · pantalla del reproductor (la del estudiante y, con `modoRevision`, la vista previa del docente).
//
// AISLAMIENTO: este archivo NO importa Firebase, fetch ni ningún servicio de escritura. Todo lo que se guarda (respuestas,
// progreso, entrega) sale por los manejadores que recibe como props; quien lo monta decide si escriben (el estudiante:
// VideoInteractivoRunner) o no (la vista previa: VistaPreviaDocenteVideo, que pasa manejadores que solo cambian estado local).
//
// MODO REVISIÓN (`modoRevision`, solo el docente): el MISMO reproductor y la MISMA lógica temporal, pero sin el límite de
// «lo visto» — el docente navega libremente — y sin pedir responder para seguir. Al saltar a un punto no se abren las
// preguntas anteriores a él (se consideran ya pasadas); las de ahí en adelante se vuelven a probar. Con `modoRevision`
// apagado (el estudiante) todo funciona exactamente como antes.
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
// Escritorio: el video usa todo el ancho útil (menos el panel) y su alto se limita al de la
// ventana, para que controles e indicaciones queden siempre a la vista.
//
// Pantalla completa (botón en la fila de arriba): el MISMO contenedor —video + controles +
// pregunta— ocupa toda la pantalla. La pregunta no se pone encima del video (lo prohíbe YouTube,
// ver pantallaCompletaVideo.js): el panel aparece AL LADO en horizontal o ABAJO en vertical
// y el reproductor se encoge; el video queda a la vista, en pausa. Entrar, salir y girar el
// teléfono solo cambian clases CSS: no se remonta nada, así el progreso, la posición y la
// respuesta en curso se conservan.
//
// Fases: listo → reproduciendo ⇄ pausado → pregunta → … → final.

const TIEMPO_AVISO_MS = 4000
// Pantallas donde el video y el panel van lado a lado (escritorio y teléfono horizontal). Es la misma condición que
// usan las clases `lg:` y `[@media(orientation:landscape)_and_(max-height:500px)]:` de abajo.
const Q_LADO_A_LADO = '(min-width: 1024px), (orientation: landscape) and (max-height: 500px)'

const VideoInteractivoPantalla = forwardRef(function VideoInteractivoPantalla({
  activity, preguntas, respuestas, otraTextos, estaRespondida,
  onSelectOpcion, onTextoChange, onOtraTextoChange, onFinalizar, finishing,
  progresoInicial, guardarProgreso,
  altoDisponiblePx, // opcional: alto en px que el reproductor puede usar. Sin él se mide desde la ventana y la cabecera.
  modoRevision = false, // vista previa del docente
  inicioSeg = 0, // revisión: segundo desde el que arranca
  onReubicar, // revisión: (seg) → el docente saltó a `seg` (para borrar las respuestas de prueba de ahí en adelante)
  onPreguntaActiva, // revisión: (id | null) → pregunta abierta en pantalla
  autoReproducir = false, // revisión: arranca solo en cuanto el reproductor está listo («probar desde aquí»)
}, ref) {
  const toast = useToast()
  const revision = !!modoRevision
  const revisionRef = useRef(revision)
  const vi = activity.videoInteractivo || {}
  const libre = activity.evaluacion?.navegacion !== 'secuencial'
  const [duracion, setDuracion] = useState(Math.max(0, Number(vi.duracionSeg) || 0))
  const ordenadas = useMemo(() => ordenarPreguntasVideo(preguntas, duracion), [preguntas, duracion])

  // Lo último, para el sondeo y los eventos del reproductor (que viven más que un render).
  const ordenadasRef = useRef(ordenadas)
  const respondidaRef = useRef(estaRespondida)
  const duracionRef = useRef(duracion)
  useEffect(() => { ordenadasRef.current = ordenadas; respondidaRef.current = estaRespondida; duracionRef.current = duracion })
  // En revisión, las preguntas anteriores al punto desde el que se prueba cuentan como ya pasadas: así saltar no las abre.
  const pasoRef = useRef(revision ? clampSeg(inicioSeg, duracion) : 0)
  const respondida = useCallback((p) => respondidaRef.current(p) || (revisionRef.current && p.timestampSeg < pasoRef.current - 0.05), [])

  // Dónde se quedó (se calcula UNA vez al entrar).
  const [reanud] = useState(() => (revision
    ? { maxVisto: LIBRE_SEG, posicion: clampSeg(inicioSeg, duracion), pendiente: null, completado: false }
    : reanudar({ progreso: progresoInicial, ordenadas, respondida: estaRespondida, duracion })))
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
  const onPreguntaActivaRef = useRef(onPreguntaActiva)
  useEffect(() => { onPreguntaActivaRef.current = onPreguntaActiva })
  useEffect(() => { onPreguntaActivaRef.current?.(activaId) }, [activaId])
  const onReubicarRef = useRef(onReubicar)
  useEffect(() => { onReubicarRef.current = onReubicar })
  const contenedorRef = useRef(null)
  const infoRef = useRef(null)
  const tituloPanelRef = useRef(null)
  const pantallaRef = useRef(null)
  const pc = usePantallaCompleta(pantallaRef)
  const enPC = pc.activa
  // Lado a lado (escritorio y teléfono horizontal) la fila «Pregunta N de M · Video visto» y los avisos se muestran en el
  // panel y no debajo del video: la columna del video queda solo con video + controles, y el video no se encoge ni crece
  // cuando sale un mensaje. Con una pregunta abierta la fila sobra (el panel ya dice «Pregunta N de M»). En pantalla
  // completa se conserva su propia distribución.
  const lado = useMediaQuery(Q_LADO_A_LADO)
  const ladoALado = lado && !enPC

  // Alto que queda libre bajo la cabecera del estudiante: en escritorio (y en teléfono horizontal) la
  // pantalla del video mide justo eso, así el video crece hasta el borde y no sobra espacio vacío abajo.
  // Se escribe como variable CSS directamente en el elemento (sin estado: no hay que volver a pintar).
  useLayoutEffect(() => {
    const el = pantallaRef.current
    const cabecera = el?.parentElement?.closest('.fixed')?.querySelector('header')
    const medir = () => el?.style.setProperty('--vi-alto', `${altoDisponiblePx ?? altoDisponibleVideo({ ventana: window.innerHeight, cabecera: cabecera?.offsetHeight || 0 })}px`)
    medir()
    window.addEventListener('resize', medir)
    window.addEventListener('orientationchange', medir)
    const ro = typeof ResizeObserver === 'function' && cabecera ? new ResizeObserver(medir) : null
    ro?.observe(cabecera)
    return () => { window.removeEventListener('resize', medir); window.removeEventListener('orientationchange', medir); ro?.disconnect() }
  }, [altoDisponiblePx])

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

  // «Probar desde aquí»: la vista previa se abre ya en el punto elegido y arranca sola (viene de un clic del docente).
  const autoHecho = useRef(false)
  useEffect(() => {
    if (!revision || !autoReproducir || !yt.listo || autoHecho.current) return
    autoHecho.current = true
    alternarReproduccion()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una sola vez, cuando el reproductor está listo
  }, [yt.listo])

  // Solo la vista previa usa esto: «probar desde aquí» (empieza a reproducir) e ir a un punto sin reproducir.
  useImperativeHandle(ref, () => ({
    probarDesde: (seg) => { if (revisionRef.current) irRevision(seg, { reproducir: true }) },
    irA: (seg) => { if (revisionRef.current) irRevision(seg) },
  }))

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
    if (f === 'final' || pos >= duracionRef.current - 1) {
      yt.saltarA(0); tickRef.current = { ...tickRef.current, ultimaPos: 0, ultimoT: null }
      if (revision) { pasoRef.current = 0; onReubicarRef.current?.(0) }
    }
    iniciarReproduccion()
  }

  // REVISIÓN · el docente va a `destino` (sin límite de lo visto). Si hay una pregunta abierta, se cierra. Lo anterior a
  // `destino` cuenta como ya pasado; lo de ahí en adelante se vuelve a probar (onReubicar borra esas respuestas de prueba).
  function irRevision(destino, { reproducir = false } = {}) {
    const d = clampSeg(destino, duracionRef.current)
    const estaba = faseRef.current === 'reproduciendo'
    if (faseRef.current === 'pregunta') setActivaId(null)
    yt.saltarA(d)
    tickRef.current = { ...tickRef.current, ultimaPos: d, ultimoT: null }
    setPosUI(d)
    pasoRef.current = d
    onReubicarRef.current?.(d)
    if (reproducir) { cambiarFase('pausado'); iniciarReproduccion() } else if (!estaba) { yt.pausar(); cambiarFase('pausado') }
  }

  // Salto pedido por el estudiante: nunca más allá de lo visto.
  function saltar(destino) {
    if (revision) { irRevision(destino); return }
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
    if (revision) { irRevision(p.timestampSeg - PRE_SEG, { reproducir: true }); return }
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
    // En pantalla completa los avisos del toast quedan fuera del contenedor: se usa el aviso propio.
    if (!revision && !estaRespondida(p)) { avisar('Responde esta pregunta para continuar.'); if (!enPC) toast('Responde esta pregunta para continuar.', 'warning'); return }
    // Revisión: se puede seguir sin responder; la pregunta ya no vuelve a abrirse en esta pasada.
    if (revision) pasoRef.current = Math.max(pasoRef.current, p.timestampSeg + 0.1)
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
      avisar('Termina de ver el video para entregar.')
      if (!enPC) toast('Termina de ver el video para entregar.', 'warning')
      return
    }
    onFinalizar()
  }

  // ── Lo que se pinta ─────────────────────────────────────────────────────
  const resumen = resumenRespuestas(ordenadas, respondida)
  const activa = ordenadas.find((p) => p.id === activaId) || null
  const indiceActiva = activa ? ordenadas.findIndex((p) => p.id === activa.id) + 1 : 0
  const numeroActual = activa ? indiceActiva : Math.min(resumen.contestadas + 1, resumen.total)
  const visto = porcentajeVisto(maxUI, duracion)
  const proxima = siguientePregunta(ordenadas, respondida, posUI)
  const puedeEntregar = resumen.pendientes === 0 && videoCompletado(maxUI, duracion)
  const jugando = fase === 'reproduciendo'
  const bloqueado = !yt.listo || fase === 'pregunta'
  // Retroceder/adelantar: el estudiante no puede con una pregunta abierta; el docente sí.
  const bloqueadoNav = !yt.listo || (!revision && fase === 'pregunta')
  // En pantalla completa el panel solo se ve cuando hay algo que decirle al estudiante
  // (comenzar, responder, entregar); si no, el video ocupa todo.
  const panelOculto = enPC && yt.error == null && !panelVisibleEnPantallaCompleta(fase)

  // Fila «Pregunta N de M · Video visto · pantalla completa». Se pinta debajo/encima del video o arriba del panel.
  const filaInfo = (extra) => (
    <div ref={infoRef} className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 scroll-mt-24 ${extra}`}>
      <span className="inline-flex items-center gap-1.5 bg-accent-light text-accent text-sm font-bold px-3 py-1 rounded-full">
        Pregunta {numeroActual} <span className="font-medium opacity-70">de {resumen.total}</span>
      </span>
      <span className="flex items-center gap-2">
        {revision
          ? <span className="text-xs font-bold uppercase tracking-wide text-amber-800 bg-amber-100 rounded-full px-2.5 py-1">Vista previa docente · navegación libre</span>
          : <span className="text-sm text-muted tabular-nums">Video visto {visto} %</span>}
        <button type="button" onClick={pc.alternar} aria-pressed={enPC} data-testid="pantalla-completa"
          aria-label={enPC ? 'Salir de pantalla completa' : 'Ver en pantalla completa'}
          className="w-11 h-11 shrink-0 rounded-full border border-outline-variant text-muted flex items-center justify-center hover:bg-surface-container">
          {enPC ? <Minimize size={20} /> : <Maximize size={20} />}
        </button>
      </span>
    </div>
  )

  return (
    <div ref={pantallaRef} data-pantalla={enPC ? 'completa' : 'normal'}
      className={enPC ? 'fixed top-0 left-0 w-full h-dvh z-[80] bg-surface overflow-hidden' : ''}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div data-esq="video-contenedor" className={enPC ? 'w-full h-full' : 'px-3 py-2 w-full max-w-xl md:max-w-3xl mx-auto lg:max-w-none [@media(orientation:landscape)_and_(max-height:500px)]:max-w-none lg:h-[var(--vi-alto,auto)] [@media(orientation:landscape)_and_(max-height:500px)]:h-[var(--vi-alto,auto)] lg:px-4 [@media(orientation:landscape)_and_(max-height:500px)]:px-4 lg:py-2 [@media(orientation:landscape)_and_(max-height:500px)]:py-2'}>
        <div data-esq="video-rejilla" className={enPC ? 'h-full flex flex-col [@media(orientation:landscape)]:flex-row' : 'grid gap-3 lg:h-full [@media(orientation:landscape)_and_(max-height:500px)]:h-full lg:gap-4 [@media(orientation:landscape)_and_(max-height:500px)]:gap-4 lg:grid-cols-[minmax(0,72fr)_minmax(16rem,28fr)] [@media(orientation:landscape)_and_(max-height:500px)]:grid-cols-[minmax(0,1fr)_minmax(16rem,19rem)]'}>
          {/* ── Columna del video ── */}
          <div className={enPC ? `min-w-0 min-h-0 flex flex-col gap-1 p-2 ${panelOculto ? 'flex-1' : 'flex-none [@media(orientation:landscape)]:flex-1'} [@media(orientation:landscape)]:grid [@media(orientation:landscape)]:grid-cols-[minmax(0,1fr)_auto] [@media(orientation:landscape)]:grid-rows-[minmax(0,1fr)_auto] [@media(orientation:landscape)]:gap-x-3` : 'min-w-0 space-y-3 lg:space-y-0 [@media(orientation:landscape)_and_(max-height:500px)]:space-y-0 lg:h-full [@media(orientation:landscape)_and_(max-height:500px)]:h-full lg:flex [@media(orientation:landscape)_and_(max-height:500px)]:flex lg:flex-col [@media(orientation:landscape)_and_(max-height:500px)]:flex-col lg:gap-2 [@media(orientation:landscape)_and_(max-height:500px)]:gap-2 lg:min-h-0 [@media(orientation:landscape)_and_(max-height:500px)]:min-h-0'}>
            {!ladoALado && filaInfo(enPC ? '[@media(orientation:landscape)]:col-start-2 [@media(orientation:landscape)]:row-start-2' : '')}

            {/* Nada va encima de este recuadro: lo llena el reproductor de YouTube. */}
            <div className={enPC ? 'flex-1 min-h-0 flex flex-col justify-center [@media(orientation:landscape)]:col-span-2 [@media(orientation:landscape)]:row-start-1 [@media(orientation:landscape)]:flex-row [@media(orientation:landscape)]:items-center [@media(orientation:landscape)]:justify-center [@media(orientation:landscape)]:[container-type:size]' : 'lg:flex-1 [@media(orientation:landscape)_and_(max-height:500px)]:flex-1 lg:min-h-0 [@media(orientation:landscape)_and_(max-height:500px)]:min-h-0 lg:[container-type:size] [@media(orientation:landscape)_and_(max-height:500px)]:[container-type:size] lg:flex [@media(orientation:landscape)_and_(max-height:500px)]:flex lg:items-center [@media(orientation:landscape)_and_(max-height:500px)]:items-center lg:justify-center [@media(orientation:landscape)_and_(max-height:500px)]:justify-center'}>
              <div data-esq="video-reproductor" ref={contenedorRef}
                className={enPC ? 'w-full aspect-video bg-black overflow-hidden [@media(orientation:landscape)]:w-[min(100cqw,calc(100cqh*16/9))] [@media(orientation:landscape)]:shrink-0' : 'w-full aspect-video min-h-[14rem] bg-black rounded-card overflow-hidden mx-auto portrait:max-md:-mx-3 portrait:max-md:w-[calc(100%+1.5rem)] portrait:max-md:rounded-none lg:w-[min(100cqw,calc(100cqh*16/9))] [@media(orientation:landscape)_and_(max-height:500px)]:w-[min(100cqw,calc(100cqh*16/9))] lg:min-h-0 [@media(orientation:landscape)_and_(max-height:500px)]:min-h-0 lg:shrink-0 [@media(orientation:landscape)_and_(max-height:500px)]:shrink-0'} />
            </div>

            {/* En pantalla completa y horizontal, botones y línea de tiempo van en UNA fila (botones primero)
                para dejarle al video todo el alto posible. */}
            <div className={`${fase === 'pregunta' ? (enPC ? 'max-lg:hidden' : lado ? '' : 'hidden') : ''} ${enPC ? '[@media(orientation:landscape)]:flex [@media(orientation:landscape)]:flex-row-reverse [@media(orientation:landscape)]:items-center [@media(orientation:landscape)]:gap-3 [@media(orientation:landscape)]:col-start-1 [@media(orientation:landscape)]:row-start-2' : 'lg:flex [@media(orientation:landscape)_and_(max-height:500px)]:flex lg:flex-row-reverse [@media(orientation:landscape)_and_(max-height:500px)]:flex-row-reverse lg:items-center [@media(orientation:landscape)_and_(max-height:500px)]:items-center lg:gap-3 [@media(orientation:landscape)_and_(max-height:500px)]:gap-3'}`}>
              <div className={enPC ? '[@media(orientation:landscape)]:flex-1 [@media(orientation:landscape)]:min-w-0' : 'lg:flex-1 [@media(orientation:landscape)_and_(max-height:500px)]:flex-1 lg:min-w-0 [@media(orientation:landscape)_and_(max-height:500px)]:min-w-0'}>
                <LineaTiempoVideo
                  duracion={duracion} posicion={posUI} maxVisto={maxUI} preguntas={ordenadas} sinLimite={revision}
                  respondida={respondida} activaId={activaId} onSaltar={saltar} onMarca={tocarMarca} />
              </div>
              <div className={`flex items-center justify-center gap-4 ${enPC ? '[@media(orientation:landscape)]:mt-0 [@media(orientation:landscape)]:flex-none' : 'mt-1 lg:mt-0 [@media(orientation:landscape)_and_(max-height:500px)]:mt-0 lg:flex-none [@media(orientation:landscape)_and_(max-height:500px)]:flex-none'}`}>
                <button type="button" disabled={bloqueadoNav} onClick={() => saltar(posUI - 10)} aria-label="Retroceder 10 segundos"
                  className={`${enPC ? 'w-11 h-11' : 'w-14 h-14 lg:w-11 [@media(orientation:landscape)_and_(max-height:500px)]:w-11 lg:h-11 [@media(orientation:landscape)_and_(max-height:500px)]:h-11'} rounded-full border border-outline-variant text-muted flex items-center justify-center disabled:opacity-60`}>
                  <RotateCcw size={20} />
                </button>
                <button type="button" disabled={bloqueado} onClick={alternarReproduccion}
                  aria-label={jugando ? 'Pausar' : 'Reproducir'}
                  className={`${enPC ? 'w-12 h-12' : 'w-16 h-16 lg:w-12 [@media(orientation:landscape)_and_(max-height:500px)]:w-12 lg:h-12 [@media(orientation:landscape)_and_(max-height:500px)]:h-12'} rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-60`}>
                  {jugando ? <Pause size={26} /> : <Play size={26} className="ml-0.5" />}
                </button>
                <button type="button" disabled={bloqueadoNav || posUI >= (revision ? duracion : maxUI) - 0.5} onClick={() => saltar(posUI + 10)} aria-label="Adelantar 10 segundos"
                  className={`${enPC ? 'w-11 h-11' : 'w-14 h-14 lg:w-11 [@media(orientation:landscape)_and_(max-height:500px)]:w-11 lg:h-11 [@media(orientation:landscape)_and_(max-height:500px)]:h-11'} rounded-full border border-outline-variant text-muted flex items-center justify-center disabled:opacity-60`}>
                  <RotateCw size={20} />
                </button>
              </div>
            </div>
            {/* Lado a lado el aviso va en el panel: si ocupara lugar bajo el video, el video se encogería (y volvería a crecer) cada vez que sale un mensaje. */}
            {!ladoALado && <p className={`text-xs text-amber-700 text-center ${enPC ? '[@media(orientation:landscape)]:col-span-2 [@media(orientation:landscape)]:row-start-3' : 'min-h-[1.25rem] lg:min-h-0 [@media(orientation:landscape)_and_(max-height:500px)]:min-h-0'}`} aria-live="polite">{aviso}</p>}
          </div>

          {/* ── Panel: instrucciones / pregunta / entrega ── */}
          <div data-esq="video-panel" aria-live="polite"
            className={enPC ? `bg-surface-card p-4 overflow-y-auto min-h-0 flex-1 [@media(orientation:landscape)]:flex-none [@media(orientation:landscape)]:w-[min(46vw,28rem)] ${panelOculto ? 'hidden' : ''}` : 'bg-surface-card rounded-card p-4 shadow-card lg:h-full [@media(orientation:landscape)_and_(max-height:500px)]:h-full lg:overflow-y-auto [@media(orientation:landscape)_and_(max-height:500px)]:overflow-y-auto lg:min-h-0 [@media(orientation:landscape)_and_(max-height:500px)]:min-h-0'}>
            {ladoALado && aviso && <p className="text-xs text-amber-700 text-center pb-2">{aviso}</p>}
            {ladoALado && fase !== 'pregunta' && filaInfo('pb-3 mb-3 border-b border-outline-variant')}
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
                {revision && activa.revision === 'pendiente' && (
                  <p className="text-xs font-semibold text-amber-900 bg-amber-100 rounded-card px-3 py-2">PENDIENTE · todavía no está aprobada ni publicada. Los alumnos no la verán hasta que la apruebes.</p>
                )}
                {activa.imagenUrl && (
                  <img src={activa.imagenUrl} alt="" className="w-full max-h-56 object-contain rounded border border-outline-variant" />
                )}
                <p className={`${enPC ? 'text-lg' : 'text-base'} font-medium text-on-surface break-words`}>{activa.enunciado}</p>
                <PreguntaRespuesta
                  pregunta={activa} respuesta={respuestas[activa.id]} otraTexto={otraTextos[activa.id]}
                  onSelectOpcion={onSelectOpcion} onTextoChange={onTextoChange} onOtraTextoChange={onOtraTextoChange} />
                <button type="button" onClick={continuar}
                  className="w-full min-h-[3.25rem] flex items-center justify-center gap-1 bg-accent text-white font-semibold rounded-full">
                  Continuar <ChevronRight size={18} />
                </button>
                <p className="text-xs text-hint text-center">
                  {revision ? 'Vista previa: puedes continuar sin responder. Lo que contestes aquí no se guarda.' : 'Responde para seguir viendo el video.'}
                </p>
              </div>
            ) : fase === 'final' && revision ? (
              <div className="space-y-3">
                <h2 className="text-base font-bold text-on-surface">Fin de la vista previa</h2>
                <p className="text-sm text-muted">Así termina la actividad para el estudiante. Aquí no se entrega nada ni se guarda ninguna respuesta.</p>
                <button type="button" onClick={alternarReproduccion} className="w-full min-h-[3.25rem] flex items-center justify-center gap-2 bg-accent text-white font-semibold rounded-full">
                  <RotateCcw size={18} /> Repetir desde el inicio
                </button>
                <button type="button" onClick={onFinalizar} className="w-full min-h-[2.75rem] text-sm text-accent font-medium">Volver a la configuración</button>
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
                  {revision ? 'Vista previa del video interactivo' : fase === 'listo' ? (yaEmpezo ? 'Continúa tu video' : 'Video interactivo') : 'Sigue viendo el video'}
                </h2>
                {fase === 'listo' ? (
                  <p className="text-sm text-muted">
                    {revision
                      ? `El video se detendrá en ${resumen.total} ${resumen.total === 1 ? 'pregunta' : 'preguntas'}. Como docente puedes adelantar y retroceder libremente; el estudiante no puede adelantarse a lo que ya vio.`
                      : <>El video se detendrá en {resumen.total} {resumen.total === 1 ? 'pregunta' : 'preguntas'}. Respóndelas para seguir.
                        Puedes regresar a lo que ya viste, pero no adelantarte.</>}
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
})

export default VideoInteractivoPantalla
