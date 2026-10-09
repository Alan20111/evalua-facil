import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import Spinner from '../Spinner'
import { useToast } from '../Toast'
import useVideoGeneracionDeps from '../../hooks/useVideoGeneracionDeps'
import { ErrorGeneracionVideo, generarEnActividad } from '../../utils/videoGeneracion'

// Aviso del editor cuando una generación de preguntas se quedó a medias (se cerró la
// pestaña, se cayó la red, falló el guardado). «Recuperar» repite la MISMA solicitud con
// la MISMA clave: si el servidor ya generó las preguntas las devuelve sin cobrar otra vez,
// y si no, avisa en qué quedó. Nunca crea un cobro nuevo (ver utils/videoGeneracion.js).
export default function GeneracionPendienteVideo({ actividadId, intento, onResuelta }) {
  const toast = useToast()
  const deps = useVideoGeneracionDeps()
  const [trabajando, setTrabajando] = useState(false)
  const [mensaje, setMensaje] = useState(null)

  async function recuperar() {
    setTrabajando(true)
    setMensaje(null)
    try {
      const r = await generarEnActividad(deps, actividadId, intento)
      toast(r.nuevas > 0 ? `Recuperamos ${r.entregadas} ${r.entregadas === 1 ? 'pregunta' : 'preguntas'} sin volver a cobrar.` : 'Tus preguntas ya estaban guardadas.')
      onResuelta?.()
    } catch (e) {
      const err = e instanceof ErrorGeneracionVideo ? e : null
      setMensaje(err?.message || 'No se pudo recuperar la generación. Intenta de nuevo.')
      // Fallo sin cobro: la clave quedó reembolsada y el intento se borró; el aviso ya no aplica.
      if (err && !err.reintentable) onResuelta?.()
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <output className="block bg-amber-50 border border-amber-200 rounded-card p-4 space-y-2">
      <p className="text-sm font-semibold text-amber-900">Una generación de preguntas no terminó de guardarse</p>
      <p className="text-sm text-amber-900">
        Si la IA ya la había generado, la recuperas aquí <span className="font-semibold">sin volver a cobrar</span>.
      </p>
      {mensaje && <p className="text-sm text-amber-900">{mensaje}</p>}
      <button type="button" onClick={recuperar} disabled={trabajando}
        className="inline-flex items-center justify-center gap-1.5 min-h-[2.75rem] px-4 rounded-full bg-accent text-white text-sm font-semibold transition-colors">
        {trabajando ? <Spinner size="sm" /> : <RotateCcw size={16} />} Recuperar preguntas
      </button>
    </output>
  )
}
