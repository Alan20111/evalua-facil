// «Enviar comentario» junto a una respuesta de la IA (docs/PLAN_GOOGLE_PLAY.md, B2).
//
// Texto visible (25-oct-2026, decisión de Kike): en la interfaz NO se usa
// «Reporte» ni «Reportar»; el botón dice «Enviar comentario». Los nombres
// internos (este componente, la colección `reportesIA`, las funciones) se
// quedan como estaban: no los ve nadie y cambiarlos obligaría a migrar datos.
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
//   ubicacion   clave fija de la pantalla (UBICACIONES_REPORTE_IA en
//               src/utils/catalogoReportes.js), p. ej. 'revision_entrega'
//   asignaturaId / actividadId / entregaId  los ids que la pantalla tiene a
//               mano, opcionales; sin ellos se usan los de la URL. El servidor
//               comprueba que sean de quien reporta antes de nombrarlos.
//   onAbiertoChange(bool)  para el modal que lo contiene: con la hoja abierta,
//               el de abajo debe ponerse `busy` y no cerrarse con Escape
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Flag } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import { Button, Modal, MotivoApagado, RadioGroup, Textarea } from './ui'
import { MOTIVOS_REPORTE_IA, LARGO_MAX_COMENTARIO_REPORTE, enviarReporteIA } from '../utils/reportesIA'
import { rolParaRegistro } from '../utils/sugerencias'

export default function ReportarIA({
  operacion, contenido, contextoId, ubicacion, asignaturaId, actividadId, entregaId, onAbiertoChange, className = '',
}) {
  const { currentUser, userProfile } = useAuth()
  const { pathname } = useLocation()
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
        rol: rolParaRegistro(userProfile),
        operacion,
        contextoId,
        contenido,
        motivo,
        comentario,
        ubicacion,
        asignaturaId,
        actividadId,
        entregaId,
        pathname,
      })
      setEnviado(true)
      cambiarAbierto(false)
      toast('Gracias. Revisaremos esta respuesta de la IA.')
    } catch {
      toast('No se pudo enviar tu comentario. Inténtalo de nuevo.', 'error')
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
        {enviado ? 'Comentario enviado' : 'Enviar comentario'}
      </Button>
      <Modal
        open={abierto}
        onClose={() => cambiarAbierto(false)}
        title="Comentario sobre la respuesta de la IA"
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
                Enviar comentario
              </Button>
            </div>
            <MotivoApagado faltan={motivo ? [] : ['el motivo']} />
          </div>
        )}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            La IA puede equivocarse. Tu comentario nos ayuda a corregirla; lo revisa una persona del equipo de Evalúa Fácil.
          </p>
          <RadioGroup
            label="¿Qué problema tiene?"
            options={MOTIVOS_REPORTE_IA}
            value={motivo}
            onChange={setMotivo}
          />
          <Textarea
            label="Detalles"
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
