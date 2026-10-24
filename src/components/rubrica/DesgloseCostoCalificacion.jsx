// Desglose del costo de "Calificar con IA" ANTES de confirmar: cuántas
// entregas se cobrarán, cuántas llevan imágenes o texto escaneado y cuántas
// solo texto, la tarifa de cada tipo, el total y las entregas que quedan fuera
// por no poder clasificarse (no se califican ni se cobran). Los números vienen
// del servidor (useEstimacionCalificacionIA); aquí solo se muestran.
import Spinner from '../Spinner'
import { Button } from '../ui'

const f2 = (n) => (Number(n) || 0).toFixed(2)
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

// `nombreDe(alumnoId)`: nombre del estudiante para listar las entregas que
// quedan fuera (lo resuelve la pantalla con la lista del grupo).
export default function DesgloseCostoCalificacion({ estimacion, cargando, error, onReintentar, nombreDe = null }) {
  if (cargando) {
    return (
      <output aria-live="polite" className="flex items-center gap-2 text-sm text-muted" data-testid="desglose-calculando">
        <Spinner size="sm" /> Calculando el precio…
      </output>
    )
  }
  if (error) {
    return (
      <div className="text-sm text-on-surface" data-testid="desglose-error">
        <p className="mb-2">No se pudo calcular el precio: {error}</p>
        {onReintentar && <Button variant="quiet" size="sm" onClick={onReintentar}>Reintentar</Button>}
      </div>
    )
  }
  if (!estimacion) return null
  const filas = [
    { etiqueta: 'Con imágenes o texto escaneado', n: estimacion.conImagenes, tarifa: estimacion.tarifaImagenes },
    { etiqueta: 'Solo texto', n: estimacion.soloDocumentos, tarifa: estimacion.tarifaDocumentos },
  ]
  const fuera = estimacion.noClasificables || []
  return (
    <div className="text-sm text-on-surface" data-testid="desglose-costo-calificacion">
      <p className="mb-1">
        {estimacion.entregas === 1 ? 'Se cobrará' : 'Se cobrarán'}{' '}
        <span className="font-semibold tabular-nums">{plural(estimacion.entregas, 'entrega', 'entregas')}</span>:
      </p>
      <table className="w-full tabular-nums mb-1">
        <tbody>
          {filas.map((r) => (
            <tr key={r.etiqueta}>
              <td className="py-0.5 text-muted">{r.etiqueta}</td>
              <td className="py-0.5 text-right whitespace-nowrap">{r.n} × {f2(r.tarifa)}</td>
              <td className="py-0.5 text-right w-16">{f2(r.n * r.tarifa)}</td>
            </tr>
          ))}
          {fuera.length > 0 && (
            <tr>
              <td className="py-0.5 text-muted">No clasificables (sin cobro)</td>
              <td className="py-0.5 text-right">{fuera.length}</td>
              <td className="py-0.5 text-right w-16">{f2(0)}</td>
            </tr>
          )}
          <tr className="border-t border-outline-variant">
            <td className="pt-1 font-semibold" colSpan={2}>Total</td>
            <td className="pt-1 text-right font-semibold">{f2(estimacion.total)}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-muted">
        Imágenes o texto escaneado (fotos, PDF escaneado, PDF o Word con fotografías) {f2(estimacion.tarifaImagenes)} por entrega ·
        solo texto {f2(estimacion.tarifaDocumentos)} por entrega. Si alguna entrega no se puede procesar, no se cobra.
      </p>
      {fuera.length > 0 && (
        <div className="mt-2" data-testid="desglose-no-clasificables">
          <p className="text-sm font-medium text-on-surface">
            {fuera.length === 1
              ? 'Esta entrega no se calificará ni se cobrará, porque no se pudo clasificar:'
              : `Estas ${fuera.length} entregas no se calificarán ni se cobrarán, porque no se pudieron clasificar:`}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted list-disc pl-4">
            {fuera.map((f) => (
              <li key={f.submissionId}>
                <span className="text-on-surface">{(nombreDe && f.alumnoId && nombreDe(f.alumnoId)) || 'Estudiante'}</span>: {f.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
