import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FocusLock from 'react-focus-lock'
import { ChevronDown, ChevronUp, Eye, EyeOff, Play, X } from 'lucide-react'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import useMediaQuery from '../../hooks/useMediaQuery'
import { estaRespondida as estaRespondidaPura } from '../../utils/evaluacionRespondida'
import { formatearTiempo } from '../../utils/videoProgreso'
import VideoInteractivoPantalla from './VideoInteractivoPantalla'
import RecomendacionesVideo from './RecomendacionesVideo'
import { compararConPropuesta, inicioDePrueba, limpiarRespuestasDesde, preguntasVistaPrevia } from './revisionVideo'

// VISTA PREVIA DOCENTE del video interactivo.
//
// Monta el MISMO reproductor del estudiante (VideoInteractivoPantalla) con `modoRevision`: misma lógica
// temporal, mismo reproductor de YouTube, mismos componentes de pregunta. Lo que cambia es solo para el docente:
// navega libremente y no tiene que responder para seguir.
//
// AISLAMIENTO — este archivo no tiene por dónde escribir: no importa Firebase, ni fetch, ni propuestasVideoDb /
// evaluacionClave / useProgresoVideo / ejecutarOperacionIA. Recibe las preguntas como datos (ya en pantalla, guardadas o
// no) y sus respuestas de prueba viven solo en este estado, que se pierde al cerrar. No crea entregas, no guarda
// respuestas ni progreso, no califica, no toca créditos y no vuelve a llamar a la IA. Cerrar solo desmonta. Lo
// comprueba una prueba que recorre las importaciones de estos módulos (test/unidad.test.mjs).
//
//   items         elementos de revisión (revisionVideo.construirItems), con los cambios aún sin guardar aplicados;
//                 las descartadas no se reproducen y las pendientes van rotuladas como no publicadas
//   inicioSeg     segundo desde el que arranca (0 = el principio)
//   reproducirAlAbrir  arranca solo (viene de «probar desde aquí», un clic del docente)
const guardarProgresoNulo = () => {}

export default function VistaPreviaDocenteVideo({ videoId, duracionSeg, nombre, items, inicioSeg = 0, reproducirAlAbrir = false, onCerrar }) {
  const pantallaRef = useRef(null)
  const areaRef = useRef(null)
  const [alto, setAlto] = useState(null)
  const [respuestas, setRespuestas] = useState({})
  const [otraTextos, setOtraTextos] = useState({})
  const [activaId, setActivaId] = useState(null)
  const [verRespuestaIA, setVerRespuestaIA] = useState(false)
  // La botonera de pruebas ocupa alto: en un teléfono horizontal arranca plegada para que el video no quede diminuto.
  const corto = useMediaQuery('(max-height: 500px)')
  const [barraElegida, setBarraElegida] = useState(null)
  const mostrarBarra = barraElegida ?? !corto

  useScrollLock(true)
  useBackHandler(onCerrar, true)

  const preguntas = useMemo(() => preguntasVistaPrevia(items), [items])
  const porId = useMemo(() => new Map((items || []).map((it) => [it.id, it])), [items])
  const activity = useMemo(
    () => ({ videoInteractivo: { videoId, duracionSeg: duracionSeg || null }, evaluacion: { navegacion: 'libre' } }),
    [videoId, duracionSeg],
  )
  const estaRespondida = useCallback((p) => estaRespondidaPura(p, respuestas[p?.id], otraTextos[p?.id]), [respuestas, otraTextos])

  // Escape cierra la vista previa, salvo que lo esté usando la pantalla completa (nativa o simulada).
  useEffect(() => {
    const alTeclear = (e) => {
      if (e.key !== 'Escape') return
      if (document.fullscreenElement || document.webkitFullscreenElement || document.querySelector('[data-pantalla="completa"]')) return
      onCerrar()
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [onCerrar])

  // Alto que queda para el reproductor bajo la barra y la botonera.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return undefined
    const medir = () => setAlto(Math.max(0, Math.round(el.clientHeight)))
    medir()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null
    ro?.observe(el)
    window.addEventListener('resize', medir)
    return () => { ro?.disconnect(); window.removeEventListener('resize', medir) }
  }, [])

  // Al saltar a un punto, las preguntas de ahí en adelante se vuelven a probar (sus respuestas de prueba se borran).
  const alReubicar = (seg) => {
    setRespuestas((r) => limpiarRespuestasDesde(r, {}, preguntas, seg).respuestas)
    setOtraTextos((o) => limpiarRespuestasDesde({}, o, preguntas, seg).otraTextos)
  }

  const item = activaId ? porId.get(activaId) : null
  const cmp = item ? compararConPropuesta(item, respuestas[item.id]) : null
  const textoOpcion = (it, id) => (it.tipo === 'verdadero_falso' ? (id === 'v' ? 'Verdadero' : id === 'f' ? 'Falso' : '—') : (it.opciones || []).find((o) => o.id === id)?.texto || '—')

  return (
    <FocusLock returnFocus>
      {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role --
          role="dialog" + aria-modal es el patrón de la guía WAI-ARIA para diálogos propios, el mismo de ui/Modal.jsx; esta capa
          ocupa toda la pantalla (la del reproductor) y por eso no puede ser el Modal de max-w-3xl. */}
      <div role="dialog" aria-modal="true" aria-label="Vista previa docente del video interactivo" data-testid="vista-previa-docente"
        className="fixed top-0 left-0 w-full h-dvh z-[75] bg-surface flex flex-col">
        <header className="bg-amber-100 text-amber-950 px-3 py-1.5 flex items-center gap-2 border-b border-amber-300">
          <span className="text-xs font-extrabold uppercase tracking-wide bg-amber-900 text-white rounded-full px-2.5 py-1 flex-shrink-0">Vista previa docente</span>
          <p className="text-xs truncate flex-1 min-w-0">
            {nombre ? `${nombre} · ` : ''}No se guarda nada: ni respuestas, ni progreso, ni entregas, ni créditos.
          </p>
          <button type="button" onClick={() => setBarraElegida(!mostrarBarra)} aria-expanded={mostrarBarra} data-testid="alternar-herramientas"
            className="flex items-center gap-1 min-h-[2.75rem] px-3 rounded-full border border-amber-400 text-xs font-semibold hover:bg-white flex-shrink-0">
            {mostrarBarra ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Herramientas
          </button>
          <button type="button" onClick={onCerrar} data-testid="cerrar-vista-previa"
            className="flex items-center gap-1.5 min-h-[2.75rem] px-3 rounded-full bg-white/70 border border-amber-400 text-sm font-semibold hover:bg-white flex-shrink-0">
            <X size={16} /> Volver a la configuración
          </button>
        </header>

        {mostrarBarra && (
        <div className="px-3 py-2 space-y-1.5 border-b border-outline-variant bg-surface-card">
          <RecomendacionesVideo compacto />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted mr-1">Probar desde unos segundos antes de:</span>
            {preguntas.length === 0 && <span className="text-xs text-muted">No hay preguntas para probar (las descartadas no se reproducen).</span>}
            {preguntas.map((p, i) => (
              <button key={p.id} type="button" onClick={() => pantallaRef.current?.probarDesde(inicioDePrueba(p.timestampSeg, duracionSeg))}
                className={`inline-flex items-center gap-1 min-h-[2.25rem] px-2.5 rounded-full border text-xs font-semibold ${p.revision === 'pendiente' ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-outline-variant text-on-surface hover:bg-surface-container'}`}
                aria-label={`Probar la pregunta ${i + 1} desde unos segundos antes, minuto ${formatearTiempo(p.timestampSeg)}${p.revision === 'pendiente' ? ' (pendiente, no publicada)' : ''}`}>
                <Play size={12} /> {i + 1} · {formatearTiempo(p.timestampSeg)}{p.revision === 'pendiente' ? ' · pendiente' : ''}
              </button>
            ))}
            <button type="button" onClick={() => setVerRespuestaIA((v) => !v)} aria-pressed={verRespuestaIA} data-testid="alternar-respuesta-ia"
              className="ml-auto inline-flex items-center gap-1.5 min-h-[2.25rem] px-3 rounded-full border border-outline-variant text-xs font-semibold text-muted hover:bg-surface-container">
              {verRespuestaIA ? <EyeOff size={14} /> : <Eye size={14} />} {verRespuestaIA ? 'Ocultar' : 'Mostrar'} la respuesta propuesta por la IA
            </button>
          </div>
          {verRespuestaIA && (
            <div className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="panel-respuesta-ia" aria-live="polite">
              {!item && <p>Abre una pregunta en el video para ver aquí la respuesta que la IA propone.</p>}
              {item && item.tipo === 'respuesta_corta' && <p>Pregunta abierta: no tiene respuesta correcta automática; la calificas tú.</p>}
              {item && item.tipo !== 'respuesta_corta' && (
                <>
                  <p><span className="font-semibold">Respuesta que la IA considera correcta (propuesta, no verificada):</span> {textoOpcion(item, item.respuestaCorrecta)}</p>
                  {cmp?.respondida && (
                    <p className="text-xs mt-0.5">Tu respuesta de prueba: {textoOpcion(item, respuestas[item.id])} — {cmp.coincide ? 'coincide con la propuesta de la IA.' : 'NO coincide con la propuesta de la IA: revisa cuál es la correcta según el video.'}</p>
                  )}
                  <p className="text-xs mt-0.5">Esta ayuda es solo para ti: el estudiante nunca la ve.</p>
                </>
              )}
            </div>
          )}
        </div>
        )}

        <div ref={areaRef} className="flex-1 min-h-0 overflow-y-auto">
          {alto !== null && (
            <VideoInteractivoPantalla
              ref={pantallaRef}
              modoRevision
              inicioSeg={inicioSeg}
              activity={activity}
              preguntas={preguntas}
              respuestas={respuestas}
              otraTextos={otraTextos}
              estaRespondida={estaRespondida}
              onSelectOpcion={(preguntaId, opcionId) => setRespuestas((r) => ({ ...r, [preguntaId]: opcionId }))}
              onTextoChange={(preguntaId, texto) => setRespuestas((r) => ({ ...r, [preguntaId]: texto }))}
              onOtraTextoChange={(preguntaId, texto) => setOtraTextos((o) => ({ ...o, [preguntaId]: texto }))}
              onFinalizar={onCerrar}
              finishing={false}
              progresoInicial={null}
              guardarProgreso={guardarProgresoNulo}
              altoDisponiblePx={alto}
              onReubicar={alReubicar}
              onPreguntaActiva={setActivaId}
              autoReproducir={reproducirAlAbrir}
            />
          )}
        </div>
      </div>
    </FocusLock>
  )
}
