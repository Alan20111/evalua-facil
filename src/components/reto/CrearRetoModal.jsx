// Reto Exprés · crear el reto (etapa 2). Solo los datos básicos: el reto nace en borrador y sus preguntas se arman
// después en su pantalla (/reto/:id). La modalidad se elige AQUÍ y ya no cambia (E10).
import { useState } from 'react'
import { useToast } from '../Toast'
import { Button, Input, Modal, RadioGroup, Switch } from '../ui'
import { crearReto } from '../../utils/retoExpresDb'
import { MODALIDADES_RETO, RETO_CFG } from '../../utils/retoExpres'

const OPCIONES_MODALIDAD = [
  { value: 'inscritos', label: MODALIDADES_RETO.inscritos, hint: RETO_CFG.CALIFICABLE_DISPONIBLE
    ? 'Participan tus estudiantes con su cuenta. Puede contar como calificación si tú lo decides.'
    : 'Participan tus estudiantes con su cuenta. Por ahora es solo práctica: no cuenta como calificación.' },
  { value: 'externo', label: MODALIDADES_RETO.externo, hint: 'Cualquiera entra con un código QR, sin cuenta. Solo para practicar: nunca cuenta como calificación.' },
]
const OPCIONES_IDENTIDAD = [
  { value: 'nombre', label: 'Nombre real', hint: 'El grupo ve el nombre de cada estudiante.' },
  { value: 'alias', label: 'Alias', hint: 'Cada estudiante elige un alias; solo tú sabes quién es quién.' },
]

export default function CrearRetoModal({ open, asignaturaId, docenteId, parcial, existingActivitiesCountInParcial = 0, onClose, onCreated }) {
  const toast = useToast()
  const [nombre, setNombre] = useState('Reto Exprés')
  const [modalidad, setModalidad] = useState('inscritos')
  const [modoIdentidad, setModoIdentidad] = useState('nombre')
  const [calificable, setCalificable] = useState(false) // S6: apagado por omisión
  const [guardando, setGuardando] = useState(false)
  const externo = modalidad === 'externo'

  async function crear() {
    setGuardando(true)
    try {
      const id = await crearReto({
        nombre, modalidad, modoIdentidad: externo ? 'alias' : modoIdentidad, calificable: !externo && RETO_CFG.CALIFICABLE_DISPONIBLE && calificable,
        parcial, orden: existingActivitiesCountInParcial + 1, asignaturaId, docenteId,
      })
      toast('Reto creado: ahora agrega sus 10 preguntas')
      onCreated?.(id)
    } catch (e) {
      toast(e.message || 'No se pudo crear el reto', 'error')
      setGuardando(false)
    }
  }

  return (
    <Modal open={open} onClose={guardando ? undefined : onClose} title="Nuevo Reto Exprés" size="md" busy={guardando}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>Cancelar</Button>
          <Button onClick={crear} busy={guardando} disabled={!nombre.trim()}>Crear reto</Button>
        </div>
      )}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Competencia en vivo de 10 preguntas, 20 segundos cada una. Tú la proyectas y los participantes responden desde su celular.
        </p>
        <Input label="Nombre del reto" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} required />
        <RadioGroup label="¿Quién participa?" name="reto-modalidad" options={OPCIONES_MODALIDAD} value={modalidad} onChange={setModalidad} />
        <p className="text-xs text-hint">La modalidad no se puede cambiar después. Para usar la otra, crea otro reto.</p>
        {externo ? (
          <p role="note" className="text-sm text-muted bg-surface-container rounded-card p-3">
            En un reto externo los participantes siempre usan alias, el reto no se muestra a tus estudiantes inscritos y no cuenta en promedios ni calificaciones.
          </p>
        ) : (
          <>
            <RadioGroup label="¿Cómo se identifican?" name="reto-identidad" options={OPCIONES_IDENTIDAD} value={modoIdentidad} onChange={setModoIdentidad} />
            {RETO_CFG.CALIFICABLE_DISPONIBLE && (
              <Switch label="Calificable" checked={calificable} onChange={setCalificable}
                hint={calificable
                  ? 'Al terminar podrás aplicar el resultado como calificación. Nada se registra sin tu confirmación.'
                  : 'Solo práctica: sin número ni promedio. Puedes activarlo después.'} />
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
