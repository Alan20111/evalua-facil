// La Ruleta del Destino · crear la actividad (fase 2). Nace oculta en la asignatura y el parcial abiertos; su banco se
// arma después en su pantalla (/ruleta/:id). Siempre es individual (7-nov-2026: la competencia en vivo es de Reto Exprés).
// El acceso y las preguntas por partida se eligen AQUÍ: el acceso ya no cambia (R6) y las preguntas solo cambian desde
// la pantalla de la ruleta, con validación del servidor.
import { useState } from 'react'
import { useToast } from '../Toast'
import { Button, Input, Modal, RadioGroup, Textarea } from '../ui'
import { crearRuleta } from '../../utils/ruletaDestinoDb'
import { RULETA_CFG, tamanoBanco, maximoBanco } from '../../utils/ruletaDestino'

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
  const [acceso, setAcceso] = useState('interno')
  const [preguntas, setPreguntas] = useState('10')
  const [guardando, setGuardando] = useState(false)

  async function crear() {
    setGuardando(true)
    try {
      const id = await crearRuleta({
        nombre, tema, acceso, preguntasPorPartida: Number(preguntas),
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
          Cada estudiante juega por su cuenta cuando quiera: gira una ruleta que le elige preguntas al azar de tu banco y
          tiene 15 segundos para responder cada una. Si sale, continúa donde se quedó.
        </p>
        <Input label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={RULETA_CFG.MAX_NOMBRE} required />
        <Textarea label="Tema o contenido a evaluar" value={tema} rows={2} autoResize maxLength={RULETA_CFG.MAX_TEMA} required
          onChange={(e) => setTema(e.target.value)} hint="Por ejemplo: «La célula y sus organelos»." />
        <RadioGroup label="¿Quién participa?" name="ruleta-acceso" options={OPCIONES_ACCESO} value={acceso} onChange={setAcceso} />
        <p className="text-xs text-hint">Quién participa no se puede cambiar después. Para usar otro, crea otra ruleta.</p>
        <RadioGroup label="Preguntas por partida" name="ruleta-preguntas" options={OPCIONES_PREGUNTAS} value={preguntas} onChange={setPreguntas} />
      </div>
    </Modal>
  )
}
