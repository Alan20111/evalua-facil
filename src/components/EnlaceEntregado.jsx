import { ExternalLink } from 'lucide-react'
import { isValidDeliveryLink } from '../config/fileTypes'

// Entrega mediante "Enlace o URL" (`submissions.enlaceURL`). La dirección es
// contenido del estudiante, no confiable: se muestra tal cual la escribió y
// solo se vuelve clicable si pasa la misma validación que al entregar
// (http/https). Se abre en otra pestaña, como los Recursos tipo enlace — sin
// iframe, sin miniatura, sin descargar nada.
export default function EnlaceEntregado({ url, className = '' }) {
  const texto = String(url || '').trim()
  return (
    <div className={`bg-surface-card rounded border border-outline-variant px-3 py-2.5 text-sm ${className}`}>
      <p className="text-xs font-medium text-muted mb-1">Enlace o URL</p>
      {isValidDeliveryLink(texto) ? (
        <a
          href={texto}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-start gap-1.5 text-accent font-medium hover:underline break-all"
        >
          <ExternalLink size={15} className="flex-shrink-0 mt-0.5" />
          <span>{texto}</span>
        </a>
      ) : (
        <p className="text-on-surface break-all">{texto}</p>
      )}
    </div>
  )
}
