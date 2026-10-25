// «Sugerencia a Evalúa Fácil» (24-oct-2026): la ventana con la que docentes y
// estudiantes le cuentan a Evalúa Fácil un error, algo que no funciona, algo
// que se ve mal, algo difícil de hacer o una idea. Va APARTE del «Reportar» de
// las respuestas de la IA (ReportarIA.jsx): aquí no hay respuesta de la IA de
// por medio. La sugerencia queda en `sugerencias`, el admin la ve en su panel
// y le llega un correo (functions/avisosReportes.js).
//
// La pantalla en la que está la persona se registra sola: no tiene que saber
// cómo se llama.
//
// Uso:
//   <SugerenciaEF className="…">Sugerencia a Evalúa Fácil</SugerenciaEF>
//     → un botón con el ícono y el texto que se le pase.
//   <SugerenciaEF render={(abrir) => <ListRow onClick={abrir} … />} />
//     → cuando el lugar ya tiene su propio tipo de fila o botón.
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { MessageSquarePlus } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import { ICONO } from '../config/iconos'
import { Button, Modal, MotivoApagado, RadioGroup, Textarea } from './ui'
import {
  CATEGORIAS_SUGERENCIA, LARGO_MAX_DESCRIPCION_SUGERENCIA, enviarSugerencia, rolParaRegistro, ubicacionDeRuta,
} from '../utils/sugerencias'

export const ICONO_SUGERENCIA = MessageSquarePlus

export default function SugerenciaEF({ className = '', iconSize = ICONO.sm, children, render }) {
  const { currentUser, userProfile } = useAuth()
  const { pathname } = useLocation()
  const toast = useToast()
  const [abierto, setAbierto] = useState(false)
  const [categoria, setCategoria] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [enviando, setEnviando] = useState(false)

  const faltan = [!categoria && 'la categoría', !descripcion.trim() && 'la descripción'].filter(Boolean)
  const { pantalla } = ubicacionDeRuta(pathname)

  // El formulario se limpia al ABRIR, no al enviar: así no se ve vaciarse
  // mientras la ventana se cierra.
  function abrir() {
    setCategoria('')
    setDescripcion('')
    setAbierto(true)
  }

  function cerrar() {
    if (enviando) return
    setAbierto(false)
  }

  async function enviar() {
    if (faltan.length || !currentUser) return
    setEnviando(true)
    try {
      await enviarSugerencia({
        uid: currentUser.uid,
        rol: rolParaRegistro(userProfile),
        categoria,
        descripcion,
        pathname,
      })
      setAbierto(false)
      toast('Gracias. Recibimos tu sugerencia; la revisará el equipo de Evalúa Fácil.')
    } catch {
      toast('No se pudo enviar tu sugerencia. Inténtalo de nuevo.', 'error')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      {render ? render(abrir) : (
        <button type="button" onClick={abrir} className={className}>
          <MessageSquarePlus size={iconSize} className="flex-shrink-0" />
          {children}
        </button>
      )}
      <Modal
        open={abierto}
        onClose={cerrar}
        title="Sugerencia a Evalúa Fácil"
        variant="centered"
        size="sm"
        busy={enviando}
        footer={(
          <div className="w-full">
            <div className="flex justify-end gap-2">
              <Button variant="quiet" onClick={cerrar} disabled={enviando}>
                Cancelar
              </Button>
              <Button onClick={enviar} disabled={faltan.length > 0} busy={enviando}>
                Enviar sugerencia
              </Button>
            </div>
            <MotivoApagado faltan={faltan} />
          </div>
        )}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Cuéntanos un error, algo que no funciona, algo difícil de hacer o una idea para mejorar. La revisa el equipo de Evalúa Fácil.
          </p>
          <RadioGroup
            label="¿De qué se trata?"
            options={CATEGORIAS_SUGERENCIA}
            value={categoria}
            onChange={setCategoria}
          />
          <Textarea
            label="Descripción"
            required
            rows={4}
            showCount
            maxLength={LARGO_MAX_DESCRIPCION_SUGERENCIA}
            hint={pantalla ? `Se registra que estabas en: ${pantalla}.` : undefined}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </div>
      </Modal>
    </>
  )
}
