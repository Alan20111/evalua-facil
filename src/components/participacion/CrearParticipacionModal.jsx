// Participación en vivo · crear la dinámica con IA.
//
// Mismo patrón que Crucigrama/Sopa de letras (CrearJuegoIAModal): la actividad nace como borrador oculto
// y la IA solo PROPONE las preguntas; el docente las revisa y edita en su pantalla antes de iniciar.
// No hay creación manual: la dinámica siempre se genera con IA (tarifa fija por ejecución).
//
// El contexto es obligatorio y específico: una descripción amplia o un archivo Word/PDF. El nombre de un
// tema no basta (se valida aquí y otra vez en el servidor, antes de cobrar).
import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { addDoc, collection, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import useCreditosIA from '../../hooks/useCreditosIA'
import { resolverFuentes } from '../../utils/fuentesIA'
import FuentesIAInput from '../ia/FuentesIAInput'
import useFuentesAsignatura from '../../hooks/useFuentesAsignatura'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import { Button, Modal, Radio, Select, Textarea } from '../ui'
import { VIVO_CFG, PROPOSITOS_VIVO, contextoSuficiente } from '../../utils/participacionVivo'

const OPCIONES_CANTIDAD = Array.from({ length: VIVO_CFG.MAX_PREGUNTAS - 1 }, (_, i) => ({ value: i + 2, label: `${i + 2} preguntas` }))
const DESCRIPCION_PROPOSITO = {
  previos: 'Explora qué saben tus estudiantes antes de empezar o desarrollar el tema: ideas iniciales, dudas y posibles ideas equivocadas.',
  comprension: 'Comprueba qué están entendiendo de lo que explicas: aciertos, errores frecuentes y lo que conviene reforzar.',
}

export default function CrearParticipacionModal({
  open, onClose, asignaturaId, asignaturaNombre, parcial, docenteId, existingActivitiesCountInParcial = 0, onCreated,
}) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const fuentesGuardadas = useFuentesAsignatura(asignaturaId, docenteId)
  const [proposito, setProposito] = useState('previos')
  const [contexto, setContexto] = useState('')
  const [archivos, setArchivos] = useState([])
  const [cantidad, setCantidad] = useState(4)
  const [tocado, setTocado] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [trabajando, setTrabajando] = useState(false)

  if (!open) return null

  const costo = creditosIA.estimar(VIVO_CFG.OP_GENERAR)
  const validacion = contextoSuficiente({ texto: contexto, cantidadArchivos: archivos.length })
  const sinTarifa = creditosIA.listo && costo == null

  function pedirConfirmacion() {
    setTocado(true)
    if (!validacion.ok) { toast(validacion.error, 'error'); return }
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
      }, 1)
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
              <Radio name="vivo-proposito" checked={proposito === clave} onChange={() => setProposito(clave)} label={etiqueta} hint={DESCRIPCION_PROPOSITO[clave]} />
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
        <Select label="Cantidad de preguntas" id="vivo-cantidad" options={OPCIONES_CANTIDAD} value={cantidad} onChange={setCantidad} />
      </div>

      <p className="text-sm text-on-surface mt-4">
        {costo != null
          ? <>Generar la dinámica usa <strong>{costo}</strong> {costo === 1 ? 'crédito' : 'créditos'} de IA, sin importar cuántas preguntas pidas. Los participantes no pagan nada.</>
          : sinTarifa ? 'La generación con IA de Participación en vivo aún no está disponible.' : 'Calculando el costo…'}
      </p>

      <div className="flex justify-end gap-2 mt-4 pie-hoja">
        <Button variant="quiet" onClick={onClose} disabled={trabajando}>Cancelar</Button>
        <Button icon={Sparkles} onClick={pedirConfirmacion} disabled={trabajando || sinTarifa || costo == null}>Generar con IA</Button>
      </div>
    </Modal>
  )
}
