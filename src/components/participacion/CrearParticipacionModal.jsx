// Participación en vivo · crear la dinámica con IA.
//
// Mismo patrón que Crucigrama/Sopa de letras (CrearJuegoIAModal): la actividad nace como borrador oculto
// y la IA solo PROPONE las preguntas; el docente las revisa y edita en su pantalla antes de iniciar.
// No hay creación manual: la dinámica siempre se genera con IA (tarifa fija por ejecución).
//
// El contexto es obligatorio y específico: una descripción amplia o un archivo Word/PDF. El nombre de un
// tema no basta (se valida aquí y otra vez en el servidor, antes de cobrar).
import { useState } from 'react'
import { Minus, Plus, Sparkles } from 'lucide-react'
import { addDoc, collection, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import useCreditosIA from '../../hooks/useCreditosIA'
import { resolverFuentes } from '../../utils/fuentesIA'
import FuentesIAInput from '../ia/FuentesIAInput'
import useFuentesAsignatura from '../../hooks/useFuentesAsignatura'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import { Button, IconButton, Input, Modal, Radio, Select, Switch, Textarea } from '../ui'
import {
  FORMATOS_VIVO, TIEMPOS_PREDETERMINADOS, VIVO_CFG, PROPOSITOS_VIVO, VISUALIZACIONES_OPCION, contextoSuficiente, distribucionEquilibrada, distribucionInicial,
  validarDistribucion, validarTiempos,
} from '../../utils/participacionVivo'

const OPCIONES_CANTIDAD = Array.from({ length: VIVO_CFG.MAX_PREGUNTAS - 1 }, (_, i) => ({ value: i + 2, label: `${i + 2} preguntas` }))
const AYUDA_FORMATO = {
  opcion: 'Opciones que pueden ser frases o textos más extensos. Resultados en barras.',
  opcion_breve: 'Opciones de una o dos palabras. Resultados en barras o en nube de palabras.',
  cierto_falso: 'Una afirmación con dos opciones: Cierto o Falso. Resultados en barras.',
  abierta: 'Cada estudiante escribe su respuesta. Se muestran en tarjetas con el texto completo.',
}
const DESCRIPCION_PROPOSITO = {
  diagnostico: 'Identifica lo que saben tus estudiantes y las dificultades que conviene reforzar, sin exigir una calificación.',
  evaluacion: 'Evalúa respuestas correctas y muestra los resultados de desempeño de tu grupo.',
  encuesta: 'Recoge opiniones, preferencias y percepciones. No hay respuestas correctas ni calificaciones.',
}
// Una encuesta no tiene respuestas correctas: Cierto/Falso no aplica y esas preguntas pasan a opción múltiple.
const sinCiertoFalso = (d) => ({ ...d, opcion: (d.opcion ?? 0) + (d.cierto_falso ?? 0), cierto_falso: 0 })

export default function CrearParticipacionModal({
  open, onClose, asignaturaId, asignaturaNombre, parcial, docenteId, existingActivitiesCountInParcial = 0, onCreated,
}) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const fuentesGuardadas = useFuentesAsignatura(asignaturaId, docenteId)
  const [proposito, setProposito] = useState('diagnostico')
  const [contexto, setContexto] = useState('')
  const [archivos, setArchivos] = useState([])
  const [cantidad, setCantidad] = useState(4)
  const [distribucion, setDistribucion] = useState(() => distribucionInicial(4))
  const [visualizacionBreve, setVisualizacionBreve] = useState('barras')
  const [tiempos, setTiempos] = useState(() => ({ ...TIEMPOS_PREDETERMINADOS })) // segundos por formato; null = manual
  const [tocado, setTocado] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [trabajando, setTrabajando] = useState(false)

  if (!open) return null

  const tarifa = creditosIA.estimar(VIVO_CFG.OP_GENERAR) // créditos POR PREGUNTA entregada
  const costo = tarifa == null ? null : tarifa * cantidad
  const tarifaAnalisis = creditosIA.estimar(VIVO_CFG.OP_ANALISIS) // aparte y opcional: por sesión, solo si el docente lo pide
  const validacion = contextoSuficiente({ texto: contexto, cantidadArchivos: archivos.length })
  const sinTarifa = creditosIA.listo && costo == null
  const validacionDistribucion = validarDistribucion(distribucion, cantidad)
  const esEncuesta = proposito === 'encuesta'
  // Solo cuentan los tiempos de los formatos que se van a generar (los demás no se piden).
  const tiemposPedidos = Object.fromEntries(Object.keys(FORMATOS_VIVO).map((k) => [k, (distribucion[k] ?? 0) > 0 ? (tiempos[k] === '' ? Number.NaN : tiempos[k]) : null]))
  const validacionTiempos = validarTiempos(tiemposPedidos)
  const conReparto = (d) => (esEncuesta ? sinCiertoFalso(d) : d)

  function cambiarCantidad(n) {
    setCantidad(n)
    setDistribucion(conReparto(distribucionInicial(n))) // al cambiar el total se propone un reparto nuevo que el docente ajusta
  }
  const ajustar = (formato, delta) => setDistribucion((d) => ({ ...d, [formato]: Math.max(0, Math.min(cantidad, (d[formato] ?? 0) + delta)) }))

  function pedirConfirmacion() {
    setTocado(true)
    if (!validacion.ok) { toast(validacion.error, 'error'); return }
    if (!validacionDistribucion.ok) { toast(validacionDistribucion.error, 'error'); return }
    if (!validacionTiempos.ok) { toast(validacionTiempos.error, 'error'); return }
    setConfirmando(true)
  }

  async function generar() {
    setTrabajando(true)
    let ref = null
    try {
      const urls = await resolverFuentes(archivos)
      ref = await addDoc(collection(db, 'activities'), {
        nombre: 'Participación en vivo',
        categoria: VIVO_CFG.CATEGORIA,
        instrucciones: '',
        oculta: true, // borrador: se publica cuando el docente lo decide
        publishAt: null,
        publishedAt: null,
        maxCalif: 10,
        notificarDocente: false,
        // NO calificable por defecto: no lleva número ni entra al promedio hasta que el docente lo active.
        sinCalificacion: true,
        parcial, orden: existingActivitiesCountInParcial + 1, asignaturaId, docenteId,
        participacion: { proposito, acceso: 'grupo', calificable: false, preguntas: [], generadaConIA: false },
        createdAt: serverTimestamp(),
      })
      await creditosIA.ejecutar(VIVO_CFG.OP_GENERAR, {
        actividadId: ref.id, asignaturaId, asignaturaNombre: asignaturaNombre || '', proposito, contexto, fuentes: urls, cantidadPreguntas: cantidad,
        distribucion, tiempos: tiemposPedidos, visualizacionBreve: distribucion.opcion_breve > 0 ? visualizacionBreve : 'barras',
      }, cantidad)
      toast('Dinámica generada: revísala antes de iniciarla')
      onCreated?.(ref.id)
    } catch (err) {
      toast(err.message || 'No se pudo generar la dinámica', 'error')
      // El servidor rechazó con un motivo conocido (contexto insuficiente, material ilegible…): no hubo cobro y
      // el borrador vacío no sirve, se quita. Ante un fallo de red sin motivo NO se borra: la generación pudo
      // haber terminado y cobrado, y el docente la encontrará en su lista.
      if (ref && err.codigo) deleteDoc(ref).catch(() => {})
      setConfirmando(false)
    } finally {
      setTrabajando(false)
    }
  }

  if (confirmando) {
    return (
      <ConfirmacionCreditosModal
        titulo="Generar la dinámica con IA"
        descripcion="La IA propondrá las preguntas a partir de tu contenido. Tú las revisas y editas antes de iniciar; abrir y editar no cuesta nada."
        costoMin={costo ?? 0}
        ejecutando={trabajando}
        avisoEjecutando="Generando tu dinámica… esto toma unos segundos. No cierres esta ventana."
        onCancelar={() => { if (!trabajando) setConfirmando(false) }}
        onContinuar={generar}
      />
    )
  }

  return (
    <Modal open onClose={() => { if (!trabajando) onClose?.() }} busy={trabajando} size="lg"
      title={<span className="flex items-center gap-2"><Sparkles size={20} className="text-accent flex-shrink-0" />Participación en vivo con IA</span>}>
      <p className="text-sm text-muted mb-4">
        Tus estudiantes responden desde su celular y tú proyectas los resultados en tiempo real. La IA propone las preguntas con base en tu contenido.
      </p>

      <fieldset className="mb-4">
        <legend className="text-sm font-medium text-on-surface mb-2">¿Para qué la vas a usar?</legend>
        <div className="space-y-2">
          {Object.entries(PROPOSITOS_VIVO).map(([clave, etiqueta]) => (
            <div key={clave} className={`rounded-card border p-3 ${proposito === clave ? 'border-accent bg-accent-light' : 'border-outline-variant'}`}>
              <Radio name="vivo-proposito" checked={proposito === clave} onChange={() => { setProposito(clave); if (clave === 'encuesta') setDistribucion(sinCiertoFalso) }} label={etiqueta} hint={DESCRIPCION_PROPOSITO[clave]} />
            </div>
          ))}
        </div>
      </fieldset>

      <Textarea label="Contenido de la clase" id="vivo-contexto" rows={5} value={contexto} showCount maxLength={6000}
        onChange={(e) => setContexto(e.target.value)} disabled={trabajando}
        hint={`Describe con detalle el tema (mínimo ${VIVO_CFG.MIN_CONTEXTO_CARACTERES} caracteres) o adjunta un archivo. No basta con el nombre del tema.`}
        error={tocado && !validacion.ok ? validacion.error : undefined} />

      <div className="mt-3">
        <FuentesIAInput files={archivos} onChange={setArchivos} disabled={trabajando} fuentesGuardadas={fuentesGuardadas} />
      </div>

      <div className="mt-3 max-w-xs">
        <Select label="Cantidad de preguntas" id="vivo-cantidad" options={OPCIONES_CANTIDAD} value={cantidad} onChange={cambiarCantidad} />
      </div>

      <fieldset className="mt-3">
        <legend className="text-sm font-medium text-on-surface mb-2">¿Cuántas de cada tipo?</legend>
        <ul className="space-y-2">
          {Object.entries(FORMATOS_VIVO).filter(([formato]) => !(esEncuesta && formato === 'cierto_falso')).map(([formato, etiqueta]) => (
            <li key={formato} className="flex flex-wrap items-center gap-3 rounded-card border border-outline-variant p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-on-surface" id={`vivo-fmt-${formato}`}>{etiqueta}</p>
                <p className="text-xs text-muted">{AYUDA_FORMATO[formato]}</p>
              </div>
              <div className="flex items-center gap-2">
                <IconButton icon={Minus} label={`Una pregunta menos de ${etiqueta}`} size="sm" disabled={trabajando || !(distribucion[formato] > 0)} onClick={() => ajustar(formato, -1)} />
                <output className="w-8 text-center text-base font-semibold text-on-surface tabular-nums" aria-live="polite">{distribucion[formato] ?? 0}</output>
                <IconButton icon={Plus} label={`Una pregunta más de ${etiqueta}`} size="sm" disabled={trabajando || validacionDistribucion.suma >= cantidad} onClick={() => ajustar(formato, 1)} />
              </div>
              {(distribucion[formato] ?? 0) > 0 && (
                <div className="basis-full flex flex-wrap items-end gap-x-4 gap-y-2 pt-2 border-t border-outline-variant">
                  <Switch label="Manual (sin límite de tiempo)" checked={tiempos[formato] == null} disabled={trabajando}
                    onChange={(v) => setTiempos((t) => ({ ...t, [formato]: v ? null : TIEMPOS_PREDETERMINADOS[formato] }))} />
                  {tiempos[formato] != null && (
                    <Input label="Segundos para responder" type="number" inputMode="numeric" min={VIVO_CFG.TIEMPO_MIN} max={VIVO_CFG.TIEMPO_MAX} step="1" wrapperClassName="w-44"
                      disabled={trabajando} value={tiempos[formato]}
                      onChange={(e) => setTiempos((t) => ({ ...t, [formato]: e.target.value === '' ? '' : Number(e.target.value) }))} />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <output className={`text-sm font-medium ${validacionDistribucion.ok ? 'text-emerald-800' : 'text-red-700'}`}>
            {validacionDistribucion.ok ? `Asignadas ${cantidad} de ${cantidad} preguntas` : validacionDistribucion.error}
          </output>
          <Button variant="quiet" size="sm" className="ml-auto" disabled={trabajando} onClick={() => setDistribucion(conReparto(distribucionEquilibrada(cantidad)))}>Repartir parejo</Button>
        </div>
      </fieldset>

      {distribucion.opcion_breve > 0 && (
        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-on-surface mb-2">Resultados de las preguntas de opción múltiple breve</legend>
          <div className="space-y-2">
            {Object.entries(VISUALIZACIONES_OPCION).map(([valor, etiqueta]) => (
              <div key={valor} className={`rounded-card border p-3 ${visualizacionBreve === valor ? 'border-accent bg-accent-light' : 'border-outline-variant'}`}>
                <Radio name="vivo-visualizacion-breve" checked={visualizacionBreve === valor} onChange={() => setVisualizacionBreve(valor)} label={etiqueta} disabled={trabajando}
                  hint={valor === 'nube' ? 'Cada opción aparece completa como una sola unidad («parte atrás» no se separa) y su tamaño crece con las veces que se elige.' : 'Compara las opciones con barras, cantidades y porcentajes.'} />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-1">Esta elección se hace aquí y ya no se cambia después en el editor.</p>
        </fieldset>
      )}

      {!validacionTiempos.ok && <p role="alert" className="text-sm font-medium text-red-700 mt-2">{validacionTiempos.error}</p>}
      <p className="text-xs text-muted mt-3">El tiempo de cada pregunta corre igual en el proyector y en los celulares, y podrás ajustarlo después, pregunta por pregunta. No se puede pausar; sí puedes ampliarlo o cerrar la pregunta cuando quieras.</p>

      <p className="text-sm text-on-surface mt-4">
        {costo != null
          ? <>Cada pregunta cuesta {tarifa} {tarifa === 1 ? 'crédito' : 'créditos'}: esta dinámica usa <strong>{costo}</strong> {costo === 1 ? 'crédito' : 'créditos'} ({tarifa} × {cantidad} preguntas). Solo se cobran las preguntas que se entreguen. {tarifaAnalisis != null && <>El análisis de resultados con IA es opcional y se cobra aparte ({tarifaAnalisis} {tarifaAnalisis === 1 ? 'crédito' : 'créditos'} por sesión), solo si lo solicitas al terminar. </>}Los participantes no pagan nada.</>
          : sinTarifa ? 'La generación con IA de Participación en vivo aún no está disponible.' : 'Calculando el costo…'}
      </p>

      <div className="flex justify-end gap-2 mt-4 pie-hoja">
        <Button variant="quiet" onClick={onClose} disabled={trabajando}>Cancelar</Button>
        <Button icon={Sparkles} onClick={pedirConfirmacion} disabled={trabajando || sinTarifa || costo == null || !validacionDistribucion.ok || !validacionTiempos.ok}>Generar con IA</Button>
      </div>
    </Modal>
  )
}
