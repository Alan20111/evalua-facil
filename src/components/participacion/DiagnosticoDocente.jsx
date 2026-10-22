// Informe FINAL de la sesión para el DOCENTE: síntesis de los diagnósticos por pregunta (qué comprende o opina el grupo y cuál
// es el siguiente paso). Los resultados de cada pregunta ya los muestran las gráficas, la nube y las tarjetas; el diagnóstico
// automático por pregunta se sigue generando en el servidor y alimenta este informe.
import { useState } from 'react'
import { Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '../ui'
import { LIMITES_INFORME, esEncuesta } from '../../utils/participacionVivo'
import { actualizarInformeVivo } from '../../utils/participacionVivoDb'

const PASO = { reexplicar: 'Volver a explicar', aclarar: 'Aclarar con un ejemplo', actividad: 'Hacer una actividad breve' }
// Encuesta: no hay aciertos ni errores; se habla de opiniones.
const PASO_ENCUESTA = { reexplicar: 'Retomar el tema', aclarar: 'Conversar con el grupo', actividad: 'Hacer una actividad breve' }

function Lista({ titulo, items }) {
  if (!items?.length) return null
  return (
    <div>
      <h4 className="text-sm font-semibold text-on-surface">{titulo}</h4>
      <ul className="mt-1 space-y-1 text-sm text-on-surface list-disc pl-5">{items}</ul>
    </div>
  )
}

/** Informe FINAL de la sesión: síntesis de los diagnósticos por pregunta. */
export function InformeFinalDocente({ sesion, informes }) {
  const encuesta = esEncuesta(sesion.proposito)
  const [actualizando, setActualizando] = useState(false)
  const [error, setError] = useState('')
  // El informe final (gratuito). El análisis global de pago (tipo 'global') es otro documento y se muestra aparte.
  const doc = informes.find((i) => !i.preguntaId && i.tipo !== 'global')
  if (!sesion.analisisActivo) return null
  async function actualizar() {
    setActualizando(true); setError('')
    try { await actualizarInformeVivo({ sesionId: sesion.codigo }) } catch (e) { setError(e.message || 'No se pudo actualizar') } finally { setActualizando(false) }
  }
  const inf = doc?.informe
  return (
    <section aria-label="Informe final de la sesión" className="rounded-card border border-outline-variant bg-surface-card p-4 space-y-3">
      <header className="flex items-center gap-2">
        <Sparkles size={16} className="text-accent" aria-hidden="true" />
        <h3 className="text-base font-semibold text-on-surface">Informe final de la sesión</h3>
      </header>
      {doc?.estado === 'generando' && <p className="text-sm text-muted flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Preparando el informe…</p>}
      {doc?.estado === 'listo' && inf && (
        <>
          <p className="text-base text-on-surface leading-snug">{inf.sintesis}</p>
          <Lista titulo={encuesta ? 'Opiniones en las que coinciden' : 'Lo que el grupo comprende'} items={(inf.comprende || []).map((x, k) => <li key={k}>{x}</li>)} />
          <Lista titulo={encuesta ? 'Temas con división o sin consenso' : 'Lo que aún no comprende'} items={(inf.noComprende || []).map((x, k) => <li key={k}>{x}</li>)} />
          <div className="rounded-card bg-surface p-3">
            <p className="text-sm font-semibold text-on-surface">{(encuesta ? PASO_ENCUESTA : PASO)[inf.siguientePaso?.tipo] || 'Siguiente paso'}</p>
            <p className="text-sm text-on-surface">{inf.siguientePaso?.texto}</p>
            {inf.actividadBreve && <p className="text-sm text-on-surface mt-2"><strong>Actividad breve:</strong> {inf.actividadBreve}</p>}
          </div>
          {inf.limitaciones && <p className="text-xs text-muted">Limitaciones: {inf.limitaciones}</p>}
        </>
      )}
      {(!doc || doc.estado === 'insuficiente') && <p className="text-sm text-on-surface">Muestra insuficiente: {doc?.motivo || 'ninguna pregunta reunió datos suficientes para una síntesis.'}</p>}
      {doc?.estado === 'error' && <p className="text-sm text-red-700">No se pudo preparar el informe. Puedes intentarlo de nuevo.</p>}
      {doc?.estado !== 'generando' && (doc?.generaciones ?? 0) < LIMITES_INFORME.FINAL && (
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" icon={RefreshCw} busy={actualizando} onClick={actualizar}>Actualizar informe</Button>
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      )}
    </section>
  )
}
