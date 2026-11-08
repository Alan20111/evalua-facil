// La Ruleta del Destino · crear la actividad (fase 2). Nace oculta en la asignatura y el parcial abiertos; su banco se
// arma después en su pantalla (/ruleta/:id). La modalidad, el acceso y las preguntas por partida se eligen AQUÍ: las dos
// primeras ya no cambian (R6) y las preguntas solo cambian desde la pantalla de la ruleta, con validación del servidor.
import { useState } from 'react'
import { useToast } from '../Toast'
import { Button, Input, Modal, RadioGroup, Switch, Textarea } from '../ui'
import { crearRuleta } from '../../utils/ruletaDestinoDb'
import { RULETA_CFG, tamanoBanco, maximoBanco } from '../../utils/ruletaDestino'

const OPCIONES_MODALIDAD = [
  { value: 'vivo', label: 'Concurso en vivo', hint: 'Juegan a la vez; puedes proyectar y mostrar un ranking.' },
  { value: 'individual', label: 'Individual', hint: 'Cada quien juega por su cuenta y puede continuar después. Sin ranking.' },
]
const OPCIONES_ACCESO = [
  { value: 'interno', label: 'Mis estudiantes', hint: 'Entran con su cuenta de Evalúa Fácil.' },
  { value: 'externo', label: 'Con enlace o QR', hint: 'Sin cuenta. Siempre queda oculta y no cuenta como calificación.' },
]
const OPCIONES_PREGUNTAS = RULETA_CFG.PREGUNTAS_POR_PARTIDA.map((n) => ({
  value: String(n), label: `${n} preguntas`, hint: `Banco de ${tamanoBanco(n)} a ${maximoBanco(n)} reactivos`,
}))

export default function CrearRuletaModal({ open, asignaturaId, docenteId, parcial, existingActivitiesCountInParcial = 0, onClose, onCreated }) {
  const toast = useToast()
  const [nombre, setNombre] = useState('La Ruleta del Destino')
  const [tema, setTema] = useState('')
  const [modalidad, setModalidad] = useState('vivo')
  const [acceso, setAcceso] = useState('interno')
  const [preguntas, setPreguntas] = useState('10')
  const [ranking, setRanking] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const vivo = modalidad === 'vivo'

  async function crear() {
    setGuardando(true)
    try {
      const id = await crearRuleta({
        nombre, tema, modalidad, acceso, preguntasPorPartida: Number(preguntas), ranking: vivo && ranking,
        parcial, orden: existingActivitiesCountInParcial + 1, asignaturaId, docenteId,
      })
      toast('Ruleta creada: ahora arma su banco de reactivos')
      onCreated?.(id)
    } catch (e) {
      toast(e.message || 'No se pudo crear la ruleta', 'error')
      setGuardando(false)
    }
  }

  return (
    <Modal open={open} onClose={guardando ? undefined : onClose} title="Nueva Ruleta del Destino" size="md" busy={guardando}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>Cancelar</Button>
          <Button onClick={crear} busy={guardando} disabled={!nombre.trim() || !tema.trim()}>Crear ruleta</Button>
        </div>
      )}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Cada estudiante gira una ruleta que le elige preguntas al azar de tu banco. Tiene 15 segundos para responder cada una.
        </p>
        <Input label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={RULETA_CFG.MAX_NOMBRE} required />
        <Textarea label="Tema o contenido a evaluar" value={tema} rows={2} autoResize maxLength={RULETA_CFG.MAX_TEMA} required
          onChange={(e) => setTema(e.target.value)} hint="Por ejemplo: «La célula y sus organelos»." />
        <RadioGroup label="Modalidad" name="ruleta-modalidad" options={OPCIONES_MODALIDAD} value={modalidad} onChange={setModalidad} />
        <RadioGroup label="¿Quién participa?" name="ruleta-acceso" options={OPCIONES_ACCESO} value={acceso} onChange={setAcceso} />
        <p className="text-xs text-hint">La modalidad y quién participa no se pueden cambiar después. Para usar otra, crea otra ruleta.</p>
        <RadioGroup label="Preguntas por partida" name="ruleta-preguntas" options={OPCIONES_PREGUNTAS} value={preguntas} onChange={setPreguntas} />
        {vivo && (
          <Switch label="Mostrar ranking" checked={ranking} onChange={setRanking}
            hint={ranking ? 'Gana quien tenga más aciertos; si empatan, quien tardó menos en sus respuestas correctas.' : 'Sin ranking: cada quien ve solo su resultado.'} />
        )}
      </div>
    </Modal>
  )
}
