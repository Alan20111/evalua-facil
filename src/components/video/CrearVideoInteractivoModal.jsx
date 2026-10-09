// Video interactivo con IA · crear la actividad y generar sus preguntas.
//
// El docente pega la URL de un video de YouTube, elige cuántas preguntas quiere de cada
// tipo y CONFIRMA el costo; la IA lee el video y PROPONE las preguntas, que se guardan en
// `activities/{id}/propuestasVideo` para que el docente las revise (PropuestasVideoPanel,
// dentro del editor) antes de que lleguen a sus alumnos.
//
// Abrir, configurar y revisar no cuestan nada: solo se cobra al confirmar, 2 créditos por
// pregunta ENTREGADA. Toda la lógica (orden de pasos, reintentos, recuperación) vive en
// utils/videoGeneracion.js; aquí solo la pantalla y la conexión con Firebase.

import { useState } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import Modal from '../ui/Modal'
import useCreditosIA from '../../hooks/useCreditosIA'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import useVideoGeneracionDeps from '../../hooks/useVideoGeneracionDeps'
import { VIDEO_CFG } from '../../utils/videoInteractivo'
import {
  CLASE_ERROR, ErrorGeneracionVideo, MAX_NOMBRE, crearYGenerar, generarEnActividad, reintentarConClaveNueva,
  textoCostoGeneracion, validarConfiguracion,
} from '../../utils/videoGeneracion'

const TIPOS = [
  { clave: 'vf', etiqueta: 'Verdadero / Falso' },
  { clave: 'om', etiqueta: 'Opción múltiple' },
  { clave: 'abiertas', etiqueta: 'Respuesta abierta' },
]
const DIST_INICIAL = { vf: 2, om: 2, abiertas: 1 }
const BOTON_PASO = 'w-11 h-11 flex items-center justify-center rounded-full border border-outline-variant text-on-surface hover:bg-surface-container transition-colors'

export default function CrearVideoInteractivoModal({
  open, onClose, asignaturaId, asignaturaNombre, parcial, docenteId, existingActivitiesCountInParcial = 0, onCreated, onBorrador,
}) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const deps = useVideoGeneracionDeps()
  const [nombre, setNombre] = useState('')
  const [url, setUrl] = useState('')
  const [dist, setDist] = useState(DIST_INICIAL)
  const [tocado, setTocado] = useState(false) // no se regaña por campos que aún no se han tocado
  const [confirmando, setConfirmando] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [fallo, setFallo] = useState(null) // ErrorGeneracionVideo
  const [actividadId, setActividadId] = useState(null)

  if (!open) return null

  const costoPorPregunta = creditosIA.estimar('generar_preguntas_video', 1) ?? VIDEO_CFG.CREDITOS_POR_PREGUNTA
  const cfg = { nombre, url, distribucion: dist, asignaturaId, parcial, docenteId, orden: existingActivitiesCountInParcial + 1 }
  const v = validarConfiguracion(cfg, costoPorPregunta)
  const total = Object.values(dist).reduce((a, b) => a + b, 0)

  function cambiarCantidad(clave, delta) {
    setDist((d) => {
      const siguiente = Math.max(0, d[clave] + delta)
      const nuevoTotal = total - d[clave] + siguiente
      return nuevoTotal > VIDEO_CFG.MAX_PREGUNTAS ? d : { ...d, [clave]: siguiente }
    })
  }

  function pedirConfirmacion() {
    setTocado(true)
    if (!v.ok) { toast(Object.values(v.errores)[0], 'error'); return }
    setFallo(null)
    setConfirmando(true)
  }

  async function ejecutarFlujo(accion) {
    setTrabajando(true)
    try {
      const r = await accion()
      const aviso = r.estado === 'incompleta' ? `La IA entregó ${r.entregadas} de ${r.pedidas} preguntas; solo se cobraron las entregadas.` : `${r.entregadas} ${r.entregadas === 1 ? 'pregunta propuesta' : 'preguntas propuestas'}: revísalas y apruébalas.`
      toast(r.recuperada ? `Recuperamos tu generación sin volver a cobrar. ${aviso}` : aviso)
      onCreated?.(r.actividadId)
    } catch (e) {
      const err = e instanceof ErrorGeneracionVideo ? e : new ErrorGeneracionVideo(CLASE_ERROR.SIN_COBRO, e?.message || 'No se pudo completar la generación.')
      if (err.actividadId) setActividadId(err.actividadId)
      setFallo(err)
    } finally {
      setTrabajando(false)
    }
  }

  function confirmar() {
    setConfirmando(false)
    ejecutarFlujo(() => (actividadId ? reintentarConClaveNueva(deps, actividadId, cfg) : crearYGenerar(deps, cfg)))
  }
  const reintentarMismaClave = () => ejecutarFlujo(() => generarEnActividad(deps, fallo.actividadId, fallo.intento))
  // Si la generación falló, la actividad ya existe como borrador: se avisa a la página para que
  // aparezca en su lista sin recargar (sin abrir el editor: no hay preguntas que revisar).
  const cerrar = () => {
    if (trabajando) return
    if (actividadId) onBorrador?.(actividadId)
    onClose?.()
  }

  const sinCobro = fallo?.clase === CLASE_ERROR.SIN_COBRO

  // La confirmación del costo es SU PROPIO diálogo (el de siempre, con la ruta de compra si no
  // alcanza el saldo). Mientras está abierto no se muestra el formulario: así el bloqueo de foco
  // del modal no le roba el teclado, y al cancelar el docente vuelve a lo que había escrito.
  if (confirmando) {
    return (
      <ConfirmacionCreditosModal
        titulo="Generar preguntas del video"
        descripcion="La IA leerá el video y propondrá las preguntas. Tú decides cuáles llegan a tus estudiantes."
        costoMin={v.creditos}
        textoCosto={textoCostoGeneracion(v.total, costoPorPregunta)}
        ejecutando={false}
        onCancelar={() => setConfirmando(false)}
        onContinuar={confirmar}
      />
    )
  }

  return (
    <Modal
      open={open}
      onClose={cerrar}
      busy={trabajando}
      title="Video interactivo con IA"
      size="md"
      className="max-h-[90dvh] overflow-y-auto"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={cerrar} disabled={trabajando}
            className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
            {fallo?.actividadId ? 'Cerrar' : 'Cancelar'}
          </button>
          {!(fallo && fallo.reintentable) && (
            <button type="button" onClick={pedirConfirmacion} disabled={trabajando || total === 0}
              className="px-4 py-2.5 bg-accent text-white text-sm font-medium rounded-full hover:bg-accent-hover transition-colors disabled:opacity-60 inline-flex items-center gap-2">
              {trabajando ? <><Spinner size="sm" /> Generando…</> : 'Continuar'}
            </button>
          )}
        </div>
      )}
    >
      <p className="text-sm text-muted mb-3">
        Pega un video de YouTube. La IA lee su contenido y propone preguntas que se hacen en el momento justo del video; tú las
        revisas, las editas y apruebas las que quieras antes de publicarlas. {asignaturaNombre ? `Asignatura: ${asignaturaNombre}.` : ''}
      </p>

      <div className="space-y-3" aria-busy={trabajando}>
        <div>
          <label htmlFor="vid-nombre" className="block text-sm text-on-surface mb-1">Nombre de la actividad</label>
          <input id="vid-nombre" type="text" value={nombre} disabled={trabajando} maxLength={MAX_NOMBRE} autoComplete="off"
            onChange={(e) => setNombre(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-outline-variant rounded-full bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
          {tocado && v.errores.nombre && <p className="text-xs text-error mt-1">{v.errores.nombre}</p>}
        </div>

        <div>
          <label htmlFor="vid-url" className="block text-sm text-on-surface mb-1">Enlace del video de YouTube</label>
          <input id="vid-url" type="url" inputMode="url" value={url} disabled={trabajando} autoComplete="off" spellCheck={false}
            onChange={(e) => setUrl(e.target.value)} onBlur={() => setTocado(true)}
            className="w-full px-3 py-2 text-sm border border-outline-variant rounded-full bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
          {url && v.videoId && <p className="text-xs text-hint mt-1">Video detectado. Debe ser público o no listado.</p>}
          {url.trim() && v.errores.url && <p className="text-xs text-error mt-1">{v.errores.url}</p>}
        </div>

        <fieldset disabled={trabajando}>
          <legend className="text-sm text-on-surface mb-1">¿Cuántas preguntas de cada tipo?</legend>
          <div className="space-y-1">
            {TIPOS.map((t) => (
              <div key={t.clave} className="flex items-center justify-between gap-3">
                <span className="text-sm">{t.etiqueta}</span>
                <div className="flex items-center gap-2">
                  <button type="button" className={BOTON_PASO} onClick={() => cambiarCantidad(t.clave, -1)} disabled={dist[t.clave] <= 0} aria-label={`Una ${t.etiqueta} menos`}><Minus size={16} /></button>
                  <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">{dist[t.clave]}</span>
                  <button type="button" className={BOTON_PASO} onClick={() => cambiarCantidad(t.clave, 1)} disabled={total >= VIDEO_CFG.MAX_PREGUNTAS} aria-label={`Una ${t.etiqueta} más`}><Plus size={16} /></button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-hint mt-1">De {VIDEO_CFG.MIN_PREGUNTAS} a {VIDEO_CFG.MAX_PREGUNTAS} preguntas en total. La respuesta abierta la calificas tú.</p>
          {tocado && v.errores.distribucion && <p className="text-xs text-error mt-1">{v.errores.distribucion}</p>}
        </fieldset>

        <p className="text-sm text-on-surface" data-testid="costo-estimado">
          {v.total > 0
            ? <>Total: <span className="font-semibold">{v.total}</span> {v.total === 1 ? 'pregunta' : 'preguntas'} · hasta <span className="font-semibold">{v.creditos}</span> {v.creditos === 1 ? 'crédito' : 'créditos'}</>
            : 'Elige al menos una pregunta.'}
        </p>
        <p className="text-xs text-muted">Todavía no se cobra nada: te pediremos confirmar el costo antes de generar. Revisar, editar y aprobar tampoco cuestan.</p>

        {fallo && (
          <div role="alert" className="p-3 rounded-card border border-amber-200 bg-amber-50 space-y-2">
            <p className="text-sm text-amber-900">{fallo.message}</p>
            {fallo.reintentable && (
              <button type="button" onClick={reintentarMismaClave} disabled={trabajando}
                className="inline-flex items-center gap-1.5 min-h-[2.75rem] px-4 rounded-full border border-accent text-accent text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors">
                <RotateCcw size={16} /> Reintentar sin volver a cobrar
              </button>
            )}
            {sinCobro && fallo.actividadId && <p className="text-xs text-amber-900">Puedes corregir lo que haga falta y generar de nuevo; la actividad quedó guardada como borrador.</p>}
          </div>
        )}
        {trabajando && <p className="text-xs text-muted">La IA está viendo el video; puede tardar un par de minutos. No cierres esta ventana.</p>}
      </div>
    </Modal>
  )
}
