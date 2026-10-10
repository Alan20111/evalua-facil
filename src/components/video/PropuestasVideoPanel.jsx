import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, Lightbulb, ListChecks, Sparkles } from 'lucide-react'
import Spinner from '../Spinner'
import { useToast } from '../Toast'
import {
  ESTADO_PROPUESTA, cabeOtraPregunta, validarPropuesta,
} from '../../utils/propuestasVideo'
import {
  aprobarPropuesta, cargarPropuestas, editarPropuesta, rechazarPropuesta, restaurarPropuesta,
} from '../../utils/propuestasVideoDb'
import { actualizarPregunta } from '../../utils/evaluacionClave'
import RevisionVideoModal from './RevisionVideoModal'
import VistaPreviaDocenteVideo from './VistaPreviaDocenteVideo'
import { ESTADO_REVISION, construirItems, contarPorEstadoRevision, validarTiempo } from './revisionVideo'

const BOTON = 'inline-flex items-center justify-center gap-1.5 min-h-[2.75rem] px-4 rounded-full text-sm font-semibold transition-colors disabled:opacity-60'

// Revisión de las preguntas de un Video interactivo: las que PROPUSO la IA (pendientes, descartadas) y las que ya están
// aprobadas en la evaluación. LA IA PROPONE; EL DOCENTE REVISA, CORRIGE, PRUEBA, APRUEBA O DESCARTA. Aprobar es una decisión
// del docente, no una verificación del sistema.
//
// En la página del editor solo vive esta tarjeta-resumen: la revisión se hace en UNA ventana (RevisionVideoModal), una pregunta a
// la vez. Este componente es el dueño del estado y de TODA la lógica de guardado, y se la presta a la ventana:
//   · los cambios (texto, opciones, respuesta, momento de aparición) son un BORRADOR en memoria (`borradores`); se ven al
//     instante en la ventana y en la vista previa, y no se escribe nada hasta guardar o aprobar;
//   · una propuesta pasa a las preguntas de la evaluación solo al aprobarla (propuestasVideoDb.aprobarPropuesta); las descartadas y
//     las pendientes nunca se publican.
//
//   activas      preguntas que YA están en la evaluación, con su clave (también reparten los puntos)
//   activasListas  el editor ya terminó de leerlas (sin eso no se sabe si una aprobada sigue en la evaluación)
//   duracionSeg  duración del video, si se conoce
//   bloqueado    parcial cerrado: se puede leer y probar, no aprobar ni cambiar preguntas ya aprobadas
//   version      al cambiar (p. ej. tras recuperar una generación) se vuelve a leer la lista
//   videoId / nombreActividad   para la ventana y la vista previa docente
//   onAprobada   (plan) → el editor suma la pregunta a la lista (no toca las demás)
//   onPreguntaActualizada  (id, campos) → el editor refleja el cambio guardado en una pregunta ya aprobada
export default function PropuestasVideoPanel({
  activityId, activas, activasListas = true, duracionSeg = null, bloqueado = false, version = 0, onAprobada, onPreguntaActualizada, videoId = null, nombreActividad = '',
}) {
  const toast = useToast()
  const [propuestas, setPropuestas] = useState(null)
  const [borradores, setBorradores] = useState({})
  const [ocupada, setOcupada] = useState(null)
  const [confirmados, setConfirmados] = useState({})
  const [revisando, setRevisando] = useState(false)
  const [vistaPrevia, setVistaPrevia] = useState(null) // { inicioSeg, reproducir }

  const recargar = useCallback(() => cargarPropuestas(activityId).then(setPropuestas), [activityId])
  useEffect(() => {
    let vivo = true
    cargarPropuestas(activityId)
      .then((lista) => { if (vivo) setPropuestas(lista) })
      .catch((err) => { if (vivo) { toast('No se pudieron cargar las preguntas propuestas: ' + err.message, 'error'); setPropuestas([]) } })
    return () => { vivo = false }
  }, [activityId, toast, version])

  const items = useMemo(() => construirItems({ propuestas: propuestas || [], activas: activas || [], borradores, activasListas }), [propuestas, activas, borradores, activasListas])
  const cuenta = useMemo(() => contarPorEstadoRevision(items), [items])
  const itemsRef = useRef(items) // lo último que se ve en pantalla, para guardar al soltar la bolita sin depender de un cierre viejo
  useEffect(() => { itemsRef.current = items })

  if (propuestas === null || !activasListas) return <div className="flex justify-center py-6"><Spinner /></div>
  if (items.length === 0) return null

  const persistida = (id) => (propuestas || []).find((p) => p.id === id)
  const reemplazar = (id, cambios) => setPropuestas((prev) => prev.map((p) => (p.id === id ? { ...p, ...cambios } : p)))
  const setCampos = (id, campos) => setBorradores((b) => ({ ...b, [id]: { ...b[id], ...campos } }))
  const quitarBorrador = (id) => setBorradores((b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== id)))

  // Ejecuta una operación sobre una pregunta con aviso de éxito o de error. Devuelve true si salió bien.
  async function ejecutar(it, accion, exito) {
    if (ocupada) return false
    setOcupada(it.id)
    try {
      await accion()
      if (exito) toast(exito)
      return true
    } catch (err) {
      toast(err.message?.includes('permission') ? 'Esta pregunta ya cambió en otra pantalla. Recarga la lista.' : (err.message || 'No se pudo completar la acción'), 'error')
      recargar().catch(() => {})
      return false
    } finally { setOcupada(null) }
  }

  // Lo que el docente cambió y no ha guardado, solo los campos que difieren de lo guardado.
  function camposCambiados(it) {
    const c = {}
    for (const k of ['enunciado', 'opciones', 'respuestaCorrecta', 'retroalimentacion', 'timestampSeg']) {
      if (JSON.stringify(it[k]) !== JSON.stringify(it.guardado[k])) c[k] = it[k]
    }
    return c
  }

  function problema(it) {
    const t = validarTiempo(it.timestampSeg, duracionSeg)
    if (!t.ok) return t.error
    const v = validarPropuesta({ tipo: it.tipo, enunciado: it.enunciado, opciones: it.opciones, respuestaCorrecta: it.respuestaCorrecta, retroalimentacion: it.retroalimentacion, timestampSeg: it.timestampSeg }, duracionSeg)
    return v.ok ? null : v.errores[0]
  }

  // Guarda el borrador de una pregunta. Devuelve la propuesta guardada (para aprobar con lo último).
  async function guardarBorrador(it) {
    const campos = camposCambiados(it)
    const err = problema(it)
    if (err) throw new Error(err)
    if (!Object.keys(campos).length) return persistida(it.id)
    if (it.estado === ESTADO_REVISION.APROBADA) {
      if (bloqueado) throw new Error('El parcial está cerrado: ya no se pueden cambiar preguntas aprobadas.')
      const publicos = { ...campos }
      if ('retroalimentacion' in publicos) publicos.retroalimentacion = String(publicos.retroalimentacion || '').trim() || null
      await actualizarPregunta(activityId, it.id, publicos)
      onPreguntaActualizada?.(it.id, publicos)
      quitarBorrador(it.id)
      return null
    }
    const escrito = await editarPropuesta(activityId, persistida(it.id), campos)
    if (escrito) reemplazar(it.id, escrito)
    quitarBorrador(it.id)
    return { ...persistida(it.id), ...(escrito || {}) }
  }

  const guardar = (it) => ejecutar(it, async () => { await guardarBorrador(it) }, 'Cambios guardados')
  // La bolita blanca de la línea se soltó en `seg`: el tiempo se guarda solo por la ruta de siempre (guardarBorrador), junto con
  // cualquier otra edición pendiente de esa pregunta (así no se pierde nada).
  const guardarTiempo = (id, seg) => {
    const it = itemsRef.current.find((x) => x.id === id)
    if (it) guardar({ ...it, timestampSeg: seg })
  }

  // Guarda todas las preguntas con cambios. Las que tengan un error de validación se saltan y se avisa cuál; devuelve true solo si
  // todas se guardaron.
  async function guardarTodos() {
    const sucias = items.filter((it) => it.sinGuardar)
    let todas = true
    let guardadas = 0
    for (const it of sucias) {
      const err = problema(it)
      if (err) { toast(`No se guardó «${it.enunciado.slice(0, 40)}»: ${err}`, 'error'); todas = false; continue }
      if (await ejecutar(it, async () => { await guardarBorrador(it) })) guardadas += 1
      else todas = false
    }
    if (guardadas > 0 && todas) toast(guardadas === 1 ? 'Cambios guardados' : `${guardadas} preguntas guardadas`)
    return todas
  }

  async function aprobar(it) {
    if (bloqueado) { toast('El parcial está cerrado: ya no se pueden agregar preguntas.', 'error'); return false }
    if (!cabeOtraPregunta(activas)) { toast('El video ya tiene el máximo de preguntas.', 'error'); return false }
    return ejecutar(it, async () => {
      // Con cambios sin guardar: primero se guardan y después se aprueba (la pregunta publicada lleva lo que el docente ve).
      const propuesta = (await guardarBorrador(it)) || persistida(it.id)
      const plan = await aprobarPropuesta({ activityId, propuesta, activas, pendientes: cuenta.pendiente, duracionSeg })
      reemplazar(it.id, { estado: ESTADO_PROPUESTA.APROBADA, preguntaId: it.id })
      if (!plan.yaAprobada) onAprobada?.(plan)
    }, 'Pregunta aprobada: ya forma parte de la evaluación')
  }
  const descartar = (it) => ejecutar(it, async () => { await rechazarPropuesta(activityId, persistida(it.id)); reemplazar(it.id, { estado: ESTADO_PROPUESTA.RECHAZADA }); quitarBorrador(it.id) }, 'Pregunta descartada: no se publicará')
  const restaurar = (it) => ejecutar(it, async () => { await restaurarPropuesta(activityId, persistida(it.id)); reemplazar(it.id, { estado: ESTADO_PROPUESTA.PENDIENTE }) })

  const abrirVista = (inicioSeg = 0, reproducir = false) => {
    if (!videoId) { toast('Esta actividad no tiene un video para reproducir.', 'error'); return }
    setVistaPrevia({ inicioSeg, reproducir })
  }
  const hayPreguntasParaProbar = items.some((it) => it.estado !== ESTADO_REVISION.DESCARTADA)
  const sucias = items.filter((it) => it.sinGuardar).length

  return (
    <section className="bg-surface-card rounded-card shadow-card p-4 space-y-3" aria-label="Revisión de las preguntas del video" data-testid="panel-revision-video">
      <div className="flex items-start gap-2">
        <Sparkles size={18} className="text-accent flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold">Revisión de las preguntas del video</h3>
          <p className="text-sm text-muted">Revisa cada pregunta en el video y aprueba solo las que sean correctas y pertinentes.</p>
        </div>
      </div>

      <section className="rounded-card border border-amber-200 bg-amber-50 px-3 py-2 space-y-1" aria-label="Antes de aprobar" data-testid="recomendaciones-video">
        <div className="flex items-center gap-2">
          <Lightbulb size={16} className="text-amber-700 flex-shrink-0" />
          <h4 className="text-sm font-semibold text-amber-900">Antes de aprobar</h4>
        </div>
        <ul className="grid gap-x-4 gap-y-0.5 text-sm text-amber-900 list-disc pl-6 sm:grid-cols-3">
          <li><span className="font-semibold">Momento:</span> verifica que la pregunta aparezca cuando corresponde.</li>
          <li><span className="font-semibold">Contenido:</span> comprueba que coincida con el video y que las respuestas sean correctas.</li>
          <li><span className="font-semibold">Calidad:</span> corrige o descarta preguntas confusas, repetidas o inadecuadas.</li>
        </ul>
        <p className="text-xs font-semibold text-amber-900">La IA propone; tú revisas y decides. Aprobar una pregunta no garantiza que sea correcta.</p>
      </section>

      <div className="rounded-card bg-surface px-3 py-2 space-y-2" data-testid="resumen-antes-de-publicar">
        <p className="text-sm text-on-surface">
          <span className="font-semibold text-green-800">{cuenta.aprobada}</span> {cuenta.aprobada === 1 ? 'aprobada (se publica)' : 'aprobadas (se publican)'} ·{' '}
          <span className="font-semibold text-amber-800">{cuenta.pendiente}</span> {cuenta.pendiente === 1 ? 'pendiente (NO se publica hasta que la apruebes)' : 'pendientes (NO se publican hasta que las apruebes)'} ·{' '}
          <span className="font-semibold text-red-800">{cuenta.descartada}</span> {cuenta.descartada === 1 ? 'descartada' : 'descartadas'}
        </p>
        {sucias > 0 && <p className="text-xs font-semibold text-amber-900">Tienes cambios sin guardar. Guárdalos para que cuenten al publicar.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setRevisando(true)} data-testid="abrir-revision" className={`${BOTON} bg-accent text-white`}>
            <ListChecks size={16} /> Revisar preguntas{cuenta.pendiente > 0 ? ` (${cuenta.pendiente} pendientes)` : ''}
          </button>
          <button type="button" onClick={() => abrirVista(0, false)} disabled={!hayPreguntasParaProbar || !videoId} data-testid="abrir-vista-previa"
            className={`${BOTON} border border-accent text-accent hover:bg-[var(--accent-tint)]`}>
            <Eye size={16} /> Vista previa docente
          </button>
        </div>
      </div>

      {revisando && (
        <RevisionVideoModal
          items={items} duracionSeg={duracionSeg} videoId={videoId} bloqueado={bloqueado} ocupada={ocupada}
          confirmados={confirmados} onConfirmar={(id, v) => setConfirmados((c) => ({ ...c, [id]: v }))}
          setCampos={setCampos} quitarBorrador={quitarBorrador} problema={problema}
          onGuardar={guardar} onGuardarTiempo={guardarTiempo} onGuardarTodos={guardarTodos} onDeshacerTodo={() => setBorradores({})}
          onAprobar={aprobar} onDescartar={descartar} onRestaurar={restaurar}
          onVistaPrevia={abrirVista} pausarVideo={!!vistaPrevia}
          onCerrar={() => setRevisando(false)}
        />
      )}

      {vistaPrevia && (
        <VistaPreviaDocenteVideo
          videoId={videoId} duracionSeg={duracionSeg} nombre={nombreActividad} items={items}
          inicioSeg={vistaPrevia.inicioSeg} reproducirAlAbrir={vistaPrevia.reproducir}
          onCerrar={() => setVistaPrevia(null)}
        />
      )}
    </section>
  )
}
