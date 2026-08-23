// Crucigrama / Sopa de letras — revisión del borrador construido (22-ago-2026).
//
// Preview de solo-lectura de `juego.estructura` (ya construida por
// construirJuego). "Confirmar juego" llama al callable `confirmarJuego`
// (23-ago-2026, flujo de vista previa/edición/regeneración) — ahí es donde
// se liquida la reserva de créditos que ya se hizo al generar el contenido
// con IA (nunca antes: editar y reconstruir el tablero siguen gratis y sin
// límite). Desde 'juego_confirmado' el docente ya puede publicar la
// actividad (firestore.rules bloquea oculta:false antes de ese estado).
// "Regresar a editar contenido" vuelve a ContenidoJuegoEditor sin perder lo
// ya generado.

import { useState } from 'react'
import { CheckCircle2, ArrowLeft } from 'lucide-react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase'
import { useToast } from '../Toast'
import CrucigramaBoard from './CrucigramaBoard'
import SopaDeLetrasBoard from './SopaDeLetrasBoard'

export default function RevisionJuegoBorrador({ activity, onConfirmado, onRegresar }) {
  const toast = useToast()
  const [confirmando, setConfirmando] = useState(false)
  const estructura = activity.juego?.estructura
  const confirmado = activity.juego?.estado === 'juego_confirmado'

  if (!estructura) return null

  async function handleConfirmar() {
    setConfirmando(true)
    try {
      const confirmarJuego = httpsCallable(functions, 'confirmarJuego')
      await confirmarJuego({ actividadId: activity.id })
      toast('Juego confirmado — ya puedes publicar la actividad')
      onConfirmado?.()
    } catch (err) {
      toast(err.message || 'No se pudo confirmar el juego', 'error')
    } finally {
      setConfirmando(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Así se verá el juego para tus estudiantes. Si quieres cambiar las palabras, regresa a editar el
        contenido; volver a construir el juego no consume créditos.
      </p>

      {estructura.tipo === 'sopa_letras'
        ? <SopaDeLetrasBoard estructura={estructura} readOnly />
        : <CrucigramaBoard estructura={estructura} readOnly />}

      <div className="flex flex-col sm:flex-row justify-between gap-2 pt-2">
        <button type="button" onClick={onRegresar} disabled={confirmando}
          className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors disabled:opacity-60">
          <ArrowLeft size={16} /> Regresar a editar contenido
        </button>
        {!confirmado && (
          <button type="button" onClick={handleConfirmar} disabled={confirmando}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors disabled:opacity-60">
            <CheckCircle2 size={16} /> {confirmando ? 'Confirmando…' : 'Confirmar juego'}
          </button>
        )}
        {confirmado && (
          <p className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
            <CheckCircle2 size={16} /> Juego confirmado
          </p>
        )}
      </div>
      <p className="text-xs text-muted text-right">
        Editar y volver a construir el tablero no tiene costo adicional — el crédito ya reservado al generar
        el contenido se cobra hasta que confirmes.
      </p>
    </div>
  )
}
