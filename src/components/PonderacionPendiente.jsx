// "—" que ocupa el lugar de un resultado ponderado que el docente todavía no
// publica (ver resultadoPublicadoAlumno en utils/ponderacion.js). Un solo
// componente para que el texto de ayuda sea el mismo en todas las pantallas.
const TEXTO_PONDERACION_PENDIENTE = 'Ponderación pendiente'

export default function PonderacionPendiente({ className = '' }) {
  return (
    <span className={className} data-tooltip={TEXTO_PONDERACION_PENDIENTE} aria-label={TEXTO_PONDERACION_PENDIENTE}>
      —
    </span>
  )
}
