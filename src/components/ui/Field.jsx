// Envoltorio de campo: etiqueta + marca de obligatorio/opcional + ayuda o error,
// enlazados con aria-describedby. Lo usan Input, Textarea y Select para que
// todos los campos de la app se lean y se anuncien igual. PLAN §3.
import { cn } from './cn'
import FieldMark from './FieldMark'
import { idAyuda } from './ids'

export default function Field({ id, label, hint, error, required = false, optional = false, className = '', children }) {
  return (
    <div className={className || undefined}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-muted mb-1">
          {label}
          <FieldMark tipo={required ? 'obligatorio' : optional ? 'opcional' : null} />
        </label>
      )}
      {children}
      {error ? (
        <p id={idAyuda(id)} role="alert" className={cn('text-red-600 text-xs mt-1 animate-aparece motion-reduce:animate-none')}>{error}</p>
      ) : hint ? (
        <p id={idAyuda(id)} className="text-xs text-hint mt-1">{hint}</p>
      ) : null}
    </div>
  )
}
