// «Reportar» junto a una respuesta de la IA (docs/PLAN_GOOGLE_PLAY.md, B2).
//
// Va pegado a cada resultado que la IA le muestra al usuario tal cual salió:
// el mensaje del asistente, la calificación sugerida, la rúbrica o las
// preguntas recién generadas, el análisis. Abre una hoja con el motivo y un
// comentario opcional; el reporte queda en `reportesIA` y el admin lo ve en
// su panel.
//
//   operacion   id de la operación de IA (el de functions/ia.js), p. ej. 'chat_asistente'
//   contenido   lo que se reporta: texto u objeto (se guarda recortado)
//   contextoId  dónde pasó (id de la asignatura, actividad o mensaje), opcional
//   onAbiertoChange(bool)  para el modal que lo contiene: con la hoja abierta,
//               el de abajo debe ponerse `busy` y no cerrarse con Escape
import { useState } from 'react'
import { Flag } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import { Button, Modal, MotivoApagado, RadioGroup, Textarea } from './ui'
import { MOTIVOS_REPORTE_IA, LARGO_MAX_COMENTARIO_REPORTE, enviarReporteIA } from '../utils/reportesIA'

export default function ReportarIA({ operacion, contenido, contextoId, onAbiertoChange, className = '' }) {
  const { currentUser, userProfile } = useAuth()
  const toast = useToast()
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)

  function cambiarAbierto(valor) {
    setAbierto(valor)
    onAbiertoChange?.(valor)
  }

  async function enviar() {
    if (!motivo || !currentUser) return
    setEnviando(true)
    try {
      await enviarReporteIA({
        uid: currentUser.uid,
        rol: userProfile?.role === 'docente' || userProfile?.role === 'admin' ? userProfile.role : 'alumno',
        operacion,
        contextoId,
        contenido,
        motivo,
        comentario,
      })
      setEnviado(true)
      cambiarAbierto(false)
      toast('Gracias. Revisaremos esta respuesta de la IA.')
    } catch {
      toast('No se pudo enviar el reporte. Inténtalo de nuevo.', 'error')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <Button
        variant="quiet"
        size="sm"
        icon={Flag}
        className={className}
        disabled={enviado}
        onClick={() => cambiarAbierto(true)}
      >
        {enviado ? 'Reportado' : 'Reportar'}
      </Button>
      <Modal
        open={abierto}
        onClose={() => cambiarAbierto(false)}
        title="Reportar respuesta de la IA"
        variant="centered"
        size="sm"
        busy={enviando}
        footer={(
          <div className="w-full">
            <div className="flex justify-end gap-2">
              <Button variant="quiet" onClick={() => cambiarAbierto(false)} disabled={enviando}>
                Cancelar
              </Button>
              <Button onClick={enviar} disabled={!motivo} busy={enviando}>
                Enviar reporte
              </Button>
            </div>
            <MotivoApagado faltan={motivo ? [] : ['el motivo']} />
          </div>
        )}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            La IA puede equivocarse. Tu reporte nos ayuda a corregirla; lo revisa una persona del equipo de Evalúa Fácil.
          </p>
          <RadioGroup
            label="¿Qué problema tiene?"
            options={MOTIVOS_REPORTE_IA}
            value={motivo}
            onChange={setMotivo}
          />
          <Textarea
            label="Comentario"
            optional
            rows={3}
            maxLength={LARGO_MAX_COMENTARIO_REPORTE}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
          />
        </div>
      </Modal>
    </>
  )
}
