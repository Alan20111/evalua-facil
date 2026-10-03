// "Ver solo actividades que se califican" — filtro de PRESENTACIÓN del
// encabezado de cada Parcial, compartido por la vista del docente y la del
// estudiante para que digan exactamente lo mismo. No guarda nada: el estado
// vive en quien lo usa, en memoria, y qué actividad es calificable lo decide
// quien filtra con sinCalificacion/cuentaParaCalificacion
// (utils/activityVisibility.js), no este componente.
//
// Es un <label> hermano —nunca hijo— del botón que abre y cierra el parcial,
// así que tocarlo no despliega ni pliega nada (un control dentro de un
// <button> además es HTML inválido).
export default function FiltroSoloCalificables({ id, checked, onChange, className = '' }) {
  return (
    <label htmlFor={id} className={`inline-flex items-center gap-2 text-xs text-muted cursor-pointer select-none ${className}`}>
      <input
        id={id}
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--accent)]"
      />
      Ver solo actividades que se califican
    </label>
  )
}
