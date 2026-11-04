// Reto Exprés · administrar participantes durante la competencia (etapa 4): expulsar y, con alias, renombrar. Se abre
// a propósito y avisa que se ve en la pantalla proyectada: con alias muestra también el nombre real (D5: identidad real
// solo para el docente). Las decisiones las toma el servidor (reto-control: expulsar / renombrar).
import { useState } from 'react'
import { Pencil, UserX } from 'lucide-react'
import { Badge, Button, IconButton, Input, Modal } from '../ui'
import ConfirmModal from '../ConfirmModal'
import { useToast } from '../Toast'
import { RETO_CFG } from '../../utils/retoExpres'
import { controlarReto } from '../../utils/retoExpresDb'

export default function ParticipantesReto({ open, onClose, sesion, participantes }) {
  const toast = useToast()
  const [renombrando, setRenombrando] = useState(null) // { participante, alias }
  const [expulsando, setExpulsando] = useState(null)
  const [trabajando, setTrabajando] = useState(false)
  const [errorAlias, setErrorAlias] = useState(null)
  const conAlias = sesion?.modoIdentidad === 'alias'
  const finalizada = sesion?.estado === 'finalizada'
  const lista = [...participantes].sort((a, b) => (a.unidoMs ?? 0) - (b.unidoMs ?? 0))

  async function expulsar() {
    setTrabajando(true)
    try {
      await controlarReto(sesion.codigo, 'expulsar', { participanteId: expulsando.id })
      toast(`${expulsando.alias || expulsando.nombre || 'El participante'} ya no participa`)
      setExpulsando(null)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setTrabajando(false)
    }
  }

  async function renombrar() {
    setTrabajando(true)
    setErrorAlias(null)
    try {
      await controlarReto(sesion.codigo, 'renombrar', { participanteId: renombrando.participante.id, alias: renombrando.alias })
      toast('Alias cambiado')
      setRenombrando(null)
    } catch (e) {
      setErrorAlias(e.message)
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title={`Participantes (${lista.length})`} size="lg">
        <p role="note" className="text-sm text-muted mb-3">
          Si estás proyectando esta pantalla, el grupo verá esta lista{conAlias && sesion?.modalidad === 'inscritos' ? ', incluidos los nombres reales' : ''}.
        </p>
        {lista.length === 0 ? (
          <p className="text-base text-muted">Todavía no entra nadie.</p>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {lista.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-base text-on-surface truncate">{conAlias ? p.alias : p.nombre}</p>
                  {conAlias && p.nombre && <p className="text-xs text-hint truncate">{p.nombre}</p>}
                </div>
                {p.expulsado && <Badge tone="danger">Retirado</Badge>}
                {conAlias && !finalizada && (
                  <IconButton icon={Pencil} label={`Cambiar el alias de ${p.alias}`} onClick={() => { setErrorAlias(null); setRenombrando({ participante: p, alias: p.alias || '' }) }} />
                )}
                {!p.expulsado && !finalizada && (
                  <IconButton icon={UserX} label={`Retirar a ${conAlias ? p.alias : p.nombre}`} onClick={() => setExpulsando(p)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>
      {renombrando && (
        <Modal open onClose={trabajando ? undefined : () => setRenombrando(null)} title="Cambiar alias" busy={trabajando} z={60}
          footer={(
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRenombrando(null)} disabled={trabajando}>Cancelar</Button>
              <Button onClick={renombrar} busy={trabajando} disabled={renombrando.alias.trim().length < RETO_CFG.ALIAS_MIN}>Guardar</Button>
            </div>
          )}>
          <Input label="Nuevo alias" value={renombrando.alias} maxLength={RETO_CFG.ALIAS_MAX} autoComplete="off"
            onChange={(e) => setRenombrando((r) => ({ ...r, alias: e.target.value }))} error={errorAlias || undefined} />
        </Modal>
      )}
      {expulsando && (
        <ConfirmModal z={60} danger busy={trabajando} title="Retirar participante" confirmLabel="Retirar" onConfirm={expulsar} onCancel={() => setExpulsando(null)}
          message={sesion?.modalidad === 'externo'
            ? 'Ya no podrá responder ni volver a entrar desde este navegador. Su lugar no se libera. Cierra el acceso para que no entre desde otro dispositivo.'
            : 'Ya no podrá responder ni volver a entrar a esta competencia. Sus respuestas se conservan.'} />
      )}
    </>
  )
}
