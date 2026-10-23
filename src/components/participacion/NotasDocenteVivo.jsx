// «Notas del docente» de una sesión en vivo: observaciones, acuerdos y seguimiento escritos por el docente. Aparte del informe de
// IA (otro documento, vivoNotas/{codigo}): «Actualizar informe» no las toca. El estado lo lleva useNotasVivo (en VistaDocente).
import { Save } from 'lucide-react'
import { Button, Textarea } from '../ui'
import { MAX_NOTAS_VIVO } from '../../utils/informeVivoPDF'

export default function NotasDocenteVivo({ notas, pdf = null }) {
  const { cargando, texto, setTexto, sucio, guardando, guardadoEn, error, conflicto, recuperado, guardar, usarGuardadas, conservarMias } = notas
  return (
    <section aria-label="Notas del docente" className="rounded-card border border-outline-variant bg-white p-4 space-y-2">
      <h3 className="text-base font-semibold text-on-surface">Notas del docente</h3>
      <p className="text-xs text-muted">Anota lo que observaste, los acuerdos con el grupo, las acciones de seguimiento o ideas para la próxima vez. Solo tú las ves; no las cambia la IA ni «Actualizar informe», y se incluyen en el «Informe en PDF».</p>
      <Textarea aria-label="Notas del docente" rows={5} autoResize maxLength={MAX_NOTAS_VIVO} showCount disabled={cargando}
        value={texto} onChange={(e) => setTexto(e.target.value)} />
      {recuperado && sucio && <p className="text-xs text-amber-800">Recuperamos lo que escribiste y no guardaste.</p>}
      {conflicto && (
        <div role="alert" className="rounded-card bg-amber-50 p-3 space-y-2 text-sm text-amber-900">
          <p>Otra pestaña o dispositivo guardó notas distintas mientras escribías. Tus cambios siguen aquí.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={usarGuardadas}>Usar las guardadas</Button>
            <Button size="sm" busy={guardando} onClick={conservarMias}>Guardar las mías</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" icon={Save} busy={guardando} disabled={cargando || !sucio || !!conflicto} onClick={guardar}>Guardar notas</Button>
        {pdf}
        <span className="text-xs text-muted" aria-live="polite">
          {sucio ? 'Cambios sin guardar' : guardadoEn ? `Guardadas a las ${guardadoEn.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
      </div>
    </section>
  )
}
