import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Pause, Play } from 'lucide-react'
import useYouTubePlayer, { ESTADO_YT, mensajeErrorYouTube } from '../../hooks/useYouTubePlayer'
import ControlTiempoVideo from './ControlTiempoVideo'
import LineaTiempoRevision from './LineaTiempoRevision'
import { GLOBO_DESDE_IZQ, etiquetaPregunta, formatearMinuto, paradaDePregunta, preguntasSinMinuto } from './revisionVideo'
import { requiereControlesAudio, esSaltoExterno, TEXTO_AYUDA_AUDIO } from '../../utils/videoAudio'
import { ICONO } from '../../config/iconos'

// Lado del VIDEO de la ventana de revisión: el reproductor, la única línea de tiempo y el control del momento.
// Al reproducir, el video SE DETIENE en el segundo guardado de cada pregunta y la muestra (como el estudiante: paradaDePregunta usa
// su misma regla); al reanudar, sigue hasta la siguiente.
// Dos acciones distintas: RECORRER el video (triángulo, tocar la línea: `saltar`, solo mueve el video) y ELEGIR el segundo de la
// pregunta (bolita blanca, botones ±, campo m:ss: `alCambiar`, cambia el borrador y lleva el video ahí, en pausa). Nada de esto
// escribe aquí: el borrador lo guarda el panel (la bolita avisa con `onSoltar` al soltarse).
//
// No importa Firebase ni nada que escriba (lo comprueba una prueba que recorre las importaciones de la ventana).
//   item         pregunta actual (con el borrador aplicado)
//   items        todas, para los puntos de la línea de tiempo (tocar uno lleva a esa pregunta: `onIr(id)`)
//   duracionSeg  largo guardado del video; si falta se toma del reproductor (solo como tope visual, no se guarda)
const ESPERA_SALTO_MS = 1500

export default function ColumnaVideoRevision({ videoId, duracionSeg, idioma = null, sinSaltarA = null, item, items, disabled = false, onCambiar, onSoltar, onIr }) {
  const contenedorRef = useRef(null)
  const sostenidoRef = useRef(null) // {seg, hasta}: el marcador se queda en lo que eligió el docente mientras el video llega ahí
  const baseRef = useRef(0) // desde dónde se reproduce: las preguntas anteriores ya cuentan como pasadas
  const pasadasRef = useRef(new Set()) // preguntas en las que el video ya se detuvo (o en cuyo segundo se está parado)
  const vivoRef = useRef({}) // lo último que se ve (el sondeo vive todo el tiempo y no debe leer valores viejos)
  const [durReproductor, setDurReproductor] = useState(0)
  const [reproduciendo, setReproduciendo] = useState(false)
  const [posicion, setPosicion] = useState(0) // tiempo REAL del reproductor, con decimales
  const dur = duracionSeg > 0 ? duracionSeg : durReproductor
  const seg = item.timestampSeg
  useEffect(() => { vivoRef.current = { items, item, onIr, dur } })
  // Un salto (a otra pregunta, al soltar un punto, tocar la línea): lo anterior a ese segundo cuenta como pasado; la pregunta en la
  // que se queda parado (`idActual`) también, para que al reproducir siga a la siguiente.
  const marcarSalto = (segundo, idActual = null) => { baseRef.current = segundo; pasadasRef.current = new Set(idActual ? [idActual] : []) }

  // Experimento de audio: con un idioma identificado y distinto del español se enciende la barra nativa de YouTube (menú «Pista de
  // audio»). Aquí no se guarda progreso, así que la velocidad no se limita. Sin dato o en español, el reproductor queda como siempre.
  const controlesNativos = requiereControlesAudio(idioma)
  const lecturaRef = useRef({ pos: null, t: null }) // lectura anterior del sondeo, para detectar saltos hechos con la barra nativa

  const yt = useYouTubePlayer({ videoId, contenedorRef, inicioSeg: Number.isInteger(seg) ? seg : 0, controlesNativos })

  // Al cambiar de pregunta el video va a su momento (en pausa). Es un efecto sobre el reproductor, no estado de la pantalla.
  // Excepción: si se llegó a esta pregunta APROBANDO la anterior (`sinSaltarA`), el video no se toca: sigue reproduciendo o en pausa donde estaba.
  useEffect(() => {
    if (!yt.listo || !Number.isInteger(item.timestampSeg)) return
    if (item.id === sinSaltarA) return
    sostenidoRef.current = { seg: item.timestampSeg, hasta: Date.now() + ESPERA_SALTO_MS }
    marcarSalto(item.timestampSeg, item.id)
    yt.saltarA(item.timestampSeg)
    yt.pausar()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar de pregunta o cuando el reproductor queda listo
  }, [item.id, yt.listo])

  // Sondeo: estado de reproducción, tiempo real y duración del reproductor. Solo LEE el reproductor: el
  // tiempo de la pregunta (borrador) lo cambia únicamente el docente (alCambiar), nunca la reproducción.
  useEffect(() => {
    if (!yt.listo) return undefined
    const id = setInterval(() => {
      const est = yt.estado()
      const jugando = est === ESTADO_YT.REPRODUCIENDO
      setReproduciendo(jugando)
      // Tras un salto, el reproductor tarda un instante en informar el tiempo nuevo: hasta entonces (tope ESPERA_SALTO_MS) el
      // marcador se queda en el destino y no vuelve atrás.
      const real = yt.tiempo()
      // Un salto hecho con la barra NATIVA no pasa por `saltar`/`alCambiar`, así que `baseRef`/`pasadasRef` seguirían viejos y, al
      // reproducir, la parada automática devolvería al docente a una pregunta anterior. Se trata igual que un salto propio: lo
      // anterior a ese punto cuenta como pasado. El segundo elegido de la pregunta (borrador) no se toca.
      if (controlesNativos) {
        const prev = lecturaRef.current
        if (prev.pos != null && !yt.saltoPropioReciente()
          && esSaltoExterno({ pos: real, ultimaPos: prev.pos, ultimoT: prev.t, ahora: Date.now(), jugando, tasa: yt.tasa() })) {
          marcarSalto(real)
        }
        lecturaRef.current = { pos: real, t: Date.now() }
      }
      const h = sostenidoRef.current
      if (h && Date.now() < h.hasta && Math.abs(real - h.seg) > 1.2) setPosicion(h.seg)
      else { sostenidoRef.current = null; setPosicion(real) }
      if (!(duracionSeg > 0)) {
        const d = Math.floor(yt.duracion() || 0)
        if (d > 0) setDurReproductor((p) => (p === d ? p : d))
      }
      // La parada de la pregunta: la regla del estudiante (pausar y volver a su segundo exacto) y se muestra esa pregunta.
      if (jugando) {
        const v = vivoRef.current
        const parada = paradaDePregunta({ items: v.items, duracionSeg: v.dur, pos: real, base: baseRef.current, pasadas: pasadasRef.current })
        if (parada) {
          yt.pausar()
          yt.saltarA(parada.timestampSeg)
          pasadasRef.current.add(parada.id)
          sostenidoRef.current = { seg: parada.timestampSeg, hasta: Date.now() + ESPERA_SALTO_MS }
          setPosicion(parada.timestampSeg)
          if (parada.id !== v.item?.id) v.onIr?.(parada.id)
        }
      }
    }, 100)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- un solo sondeo por reproductor
  }, [yt.listo])

  // Recorrer el video (triángulo, tocar la línea): solo mueve el video; el tiempo de la pregunta no cambia.
  function saltar(nuevo) {
    marcarSalto(nuevo)
    sostenidoRef.current = { seg: nuevo, hasta: Date.now() + ESPERA_SALTO_MS }
    setPosicion(nuevo)
    if (yt.listo) yt.saltarA(nuevo)
  }
  // Elegir el segundo de la pregunta (bolita blanca, botones ±, campo m:ss): borrador + video en ese segundo, en pausa.
  // `info.arrastre`: el cambio viene de arrastrar el punto (todo el arrastre cuenta como un solo paso para Deshacer).
  function alCambiar(nuevo, info) {
    marcarSalto(nuevo, item.id)
    sostenidoRef.current = { seg: nuevo, hasta: Date.now() + ESPERA_SALTO_MS }
    setPosicion(nuevo)
    onCambiar(nuevo, info)
    if (yt.listo) { yt.saltarA(nuevo); if (reproduciendo) yt.pausar() }
  }
  const alternar = () => { if (reproduciendo) yt.pausar(); else yt.reproducir() }
  // Propuestas de la versión anterior sin momento (pendientes de ubicación): la línea no las dibuja, así que se avisan aquí con un
  // acceso a cada una. Las nuevas siempre llegan con su momento.
  const sinMinuto = preguntasSinMinuto(items)

  return (
    <div className="space-y-2 min-w-0" data-testid="columna-video-revision">
      {/* Nada va encima de este recuadro: lo llena el reproductor de YouTube. */}
      <div className="mx-auto w-[min(100%,calc(42dvh*16/9))] lg:w-[min(100%,calc(56dvh*16/9))] [@media(orientation:landscape)_and_(max-height:500px)]:w-[min(100%,calc(62dvh*16/9))]">
        <div ref={contenedorRef} data-testid="video-revision" className="w-full aspect-video bg-black rounded-card overflow-hidden" />
      </div>
      {controlesNativos && yt.error == null && (
        <p data-testid="ayuda-audio" className="text-xs text-muted text-center">{TEXTO_AYUDA_AUDIO}</p>
      )}
      {yt.error != null && (
        <div role="alert" className="flex items-start gap-2 rounded-card bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle size={ICONO.sm} className="flex-shrink-0 mt-0.5" />
          <span className="flex-1">{mensajeErrorYouTube(yt.error)} Puedes seguir ajustando el momento con los botones −5 a +5.</span>
          <button type="button" onClick={yt.reintentar} className="font-semibold underline">Reintentar</button>
        </div>
      )}
      {/* items-start + mt-1.5: el botón queda centrado con la línea (h-14) aunque debajo se abra la lista de un punto agrupado. */}
      <div className="flex items-start gap-2">
        <button type="button" onClick={alternar} disabled={!yt.listo} aria-label={reproduciendo ? 'Pausar' : 'Reproducir'}
          data-tooltip={reproduciendo ? 'Pausar el video' : 'Reproducir el video'} data-tooltip-pos="bottom"
          className={`mt-1.5 w-11 h-11 flex-shrink-0 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-60 ${GLOBO_DESDE_IZQ}`}>
          {reproduciendo ? <Pause size={ICONO.md} /> : <Play size={ICONO.md} className="ml-0.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <LineaTiempoRevision duracionSeg={dur} posicion={yt.listo ? posicion : null} valor={seg} onCambiar={alCambiar} onSoltar={onSoltar} onSaltar={saltar} items={items} onIr={onIr} itemId={item.id} disabled={disabled} />
        </div>
      </div>
      {sinMinuto.length > 0 && (
        <div data-testid="aviso-sin-minuto" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 space-y-1.5 text-amber-950">
          <p className="text-xs">
            <span className="font-semibold">{sinMinuto.length === 1 ? '1 pregunta sin momento' : `${sinMinuto.length} preguntas sin momento`}</span>{' '}
            ({sinMinuto.length === 1 ? 'generada antes de esta mejora): arrástrala a la línea de tiempo o descártala.' : 'generadas antes de esta mejora): arrástralas a la línea de tiempo o descártalas.'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sinMinuto.map((o) => (
              <button key={o.id} type="button" onClick={() => onIr?.(o.id)} disabled={o.id === item.id} aria-current={o.id === item.id ? 'true' : undefined}
                data-testid="acceso-sin-minuto"
                className="inline-flex items-center min-h-[2.75rem] max-w-full px-3 rounded-full border border-amber-400 bg-white/70 text-xs font-semibold text-amber-950 text-left hover:bg-white disabled:opacity-70 disabled:hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <span className="truncate">{o.id === item.id ? 'Abierta ahora · ' : ''}{etiquetaPregunta(o)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted tabular-nums" aria-live="polite">
        Video en {formatearMinuto(Math.floor(posicion))}
      </p>
      <ControlTiempoVideo item={item} duracionSeg={dur || null} disabled={disabled} onCambiar={alCambiar} />
    </div>
  )
}
