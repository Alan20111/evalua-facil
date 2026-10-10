import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Pause, Play } from 'lucide-react'
import useYouTubePlayer, { ESTADO_YT, mensajeErrorYouTube } from '../../hooks/useYouTubePlayer'
import ControlTiempoVideo from './ControlTiempoVideo'
import LineaTiempoRevision from './LineaTiempoRevision'
import { PRE_SEG, formatearMinuto } from './revisionVideo'

// Lado del VIDEO de la ventana de revisión: el reproductor, la única línea de tiempo y el control del momento.
// Elegir el segundo y VERLO es lo mismo: mover el marcador (o los botones ±) lleva el video a ese segundo, en pausa, para ver
// y oír justo ese punto; «Comprobar» reproduce desde unos segundos antes y se detiene en el momento elegido («aquí aparecería
// la pregunta»). Nada de esto escribe: solo cambia el borrador de la pregunta actual (`onCambiar`).
//
// No importa Firebase ni nada que escriba (lo comprueba una prueba que recorre las importaciones de la ventana).
//   item         pregunta actual (con el borrador aplicado)
//   items        todas, para los puntos de referencia de la línea de tiempo
//   duracionSeg  largo guardado del video; si falta se toma del reproductor (solo como tope visual, no se guarda)
export default function ColumnaVideoRevision({ videoId, duracionSeg, item, items, disabled = false, onCambiar }) {
  const contenedorRef = useRef(null)
  const objetivoRef = useRef(null) // segundo en que se detiene «Comprobar»
  const avisoT = useRef(null)
  const [durReproductor, setDurReproductor] = useState(0)
  const [reproduciendo, setReproduciendo] = useState(false)
  const [posicion, setPosicion] = useState(0)
  const [comprobado, setComprobado] = useState(false)
  const [aviso, setAviso] = useState('')
  const dur = duracionSeg > 0 ? duracionSeg : durReproductor
  const seg = item.timestampSeg

  const yt = useYouTubePlayer({ videoId, contenedorRef, inicioSeg: Number.isInteger(seg) ? seg : 0 })

  // Al cambiar de pregunta el video va a su momento (en pausa). Es un efecto sobre el reproductor, no estado de la pantalla.
  useEffect(() => {
    if (!yt.listo || !Number.isInteger(item.timestampSeg)) return
    objetivoRef.current = null
    yt.saltarA(item.timestampSeg)
    yt.pausar()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar de pregunta o cuando el reproductor queda listo
  }, [item.id, yt.listo])

  // Sondeo: estado de reproducción, posición, duración del reproductor y parada de «Comprobar».
  useEffect(() => {
    if (!yt.listo) return undefined
    const id = setInterval(() => {
      const est = yt.estado()
      const jugando = est === ESTADO_YT.REPRODUCIENDO
      setReproduciendo(jugando)
      setPosicion(Math.floor(yt.tiempo()))
      if (!(duracionSeg > 0)) {
        const d = Math.floor(yt.duracion() || 0)
        if (d > 0) setDurReproductor((p) => (p === d ? p : d))
      }
      const obj = objetivoRef.current
      if (obj !== null && jugando && yt.tiempo() >= obj - 0.15) {
        yt.pausar()
        objetivoRef.current = null
        mostrarAviso('Aquí aparecería la pregunta.')
      }
    }, 200)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- un solo sondeo por reproductor
  }, [yt.listo])
  useEffect(() => () => clearTimeout(avisoT.current), [])

  function mostrarAviso(texto) {
    setAviso(texto)
    clearTimeout(avisoT.current)
    avisoT.current = setTimeout(() => setAviso(''), 3500)
  }

  // Mover el marcador (o los botones): borrador + video en ese segundo, en pausa.
  function alCambiar(nuevo) {
    objetivoRef.current = null
    onCambiar(nuevo)
    if (yt.listo) { yt.saltarA(nuevo); if (reproduciendo) yt.pausar() }
  }
  function comprobar() {
    if (!yt.listo || !Number.isInteger(seg)) return
    setComprobado(true)
    if (seg <= 0) { yt.saltarA(0); yt.pausar(); mostrarAviso('Aquí aparecería la pregunta.'); return }
    objetivoRef.current = seg
    yt.saltarA(Math.max(0, seg - PRE_SEG))
    yt.reproducir()
  }
  const alternar = () => { objetivoRef.current = null; if (reproduciendo) yt.pausar(); else yt.reproducir() }

  return (
    <div className="space-y-2 min-w-0" data-testid="columna-video-revision">
      {/* Nada va encima de este recuadro: lo llena el reproductor de YouTube. */}
      <div className="mx-auto w-[min(100%,calc(42dvh*16/9))] lg:w-[min(100%,calc(56dvh*16/9))] [@media(orientation:landscape)_and_(max-height:500px)]:w-[min(100%,calc(62dvh*16/9))]">
        <div ref={contenedorRef} data-testid="video-revision" className="w-full aspect-video bg-black rounded-card overflow-hidden" />
      </div>
      {yt.error != null && (
        <div role="alert" className="flex items-start gap-2 rounded-card bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span className="flex-1">{mensajeErrorYouTube(yt.error)} Puedes seguir ajustando el minuto con el campo.</span>
          <button type="button" onClick={yt.reintentar} className="font-semibold underline">Reintentar</button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="button" onClick={alternar} disabled={!yt.listo} aria-label={reproduciendo ? 'Pausar' : 'Reproducir'}
          className="w-11 h-11 flex-shrink-0 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-60">
          {reproduciendo ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <LineaTiempoRevision duracionSeg={dur} valor={seg} onCambiar={alCambiar} items={items} itemId={item.id} sugeridoSeg={item.sugeridoSeg} disabled={disabled} />
        </div>
      </div>
      <p className="text-xs text-muted tabular-nums" aria-live="polite">
        Video en {formatearMinuto(posicion)}{aviso && <span className="ml-2 font-semibold text-amber-800">{aviso}</span>}
      </p>
      <ControlTiempoVideo item={item} duracionSeg={dur || null} disabled={disabled} onCambiar={alCambiar} onComprobar={comprobar}
        comprobando={comprobado} puedeComprobar={yt.listo && Number.isInteger(seg)} />
    </div>
  )
}
