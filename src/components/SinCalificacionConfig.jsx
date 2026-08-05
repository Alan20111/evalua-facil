import { Scale } from 'lucide-react'

// "Sin calificación" — para un diagnóstico, una encuesta o un repaso: el
// estudiante lo contesta y el docente ve todo, pero no vale para la boleta.
// Se comparte entre los dos lugares donde se configura una evaluación
// (EvaluacionEditor de pantalla completa y la pestaña Configuración de
// EvaluacionManager) para que digan exactamente lo mismo.
//
// Al marcarlo se pregunta lo segundo, que no es obvio: aunque no valga para la
// calificación, los reactivos PUEDEN seguir teniendo puntos. Son dos cosas
// distintas y las dos se usan:
//   · Con puntos    → el diagnóstico arroja un resultado (8 de 10) que sirve
//                     para medir al grupo, sin afectar su calificación.
//   · Sin puntos    → una encuesta pura: no hay respuestas "correctas" que
//                     contar, solo lo que cada quien contestó.
export default function SinCalificacionConfig({ sinCalificacion, ponderarReactivos, onChange }) {
  return (
    <div className="rounded border border-outline-variant p-3 space-y-2">
      {/* El texto va DIRECTO dentro del label (no anidado en otro span): así lo
          reconoce el lector de pantalla y la regla de accesibilidad. La
          explicación va debajo, alineada con el texto. */}
      <label htmlFor="config-sin-calificacion" className="flex items-center gap-2 text-sm font-medium text-on-surface cursor-pointer">
        <input
          id="config-sin-calificacion"
          type="checkbox"
          checked={!!sinCalificacion}
          onChange={(e) => onChange({ sinCalificacion: e.target.checked })}
          className="accent-[var(--accent)]"
        />
        Sin calificación
      </label>
      <p className="text-xs text-muted ml-6">
        No cuenta para el promedio ni aparece en la tabla de calificaciones, y no lleva número.
        Se sigue viendo en Actividades y tú ves todas las respuestas.
      </p>

      {sinCalificacion && (
        <div className="ml-6 pl-3 border-l-2 border-outline-variant space-y-2">
          <p className="text-xs font-medium text-muted flex items-center gap-1.5">
            <Scale size={13} className="text-accent" /> ¿Los reactivos tendrán ponderación?
          </p>
          <div>
            <label htmlFor="ponderar-si" className="flex items-center gap-2 text-sm text-on-surface cursor-pointer">
              <input
                id="ponderar-si"
                type="radio"
                name="ponderar-reactivos"
                checked={ponderarReactivos !== false}
                onChange={() => onChange({ ponderarReactivos: true })}
                className="accent-[var(--accent)]"
              />
              Sí, con puntos
            </label>
            <p className="text-xs text-muted ml-6">Arroja un resultado (por ejemplo 8 de 10) para medir al grupo, sin afectar su calificación.</p>
          </div>
          <div>
            <label htmlFor="ponderar-no" className="flex items-center gap-2 text-sm text-on-surface cursor-pointer">
              <input
                id="ponderar-no"
                type="radio"
                name="ponderar-reactivos"
                checked={ponderarReactivos === false}
                onChange={() => onChange({ ponderarReactivos: false })}
                className="accent-[var(--accent)]"
              />
              No, sin puntos
            </label>
            <p className="text-xs text-muted ml-6">Una encuesta: no se cuentan aciertos, solo se registra lo que cada quien contestó.</p>
          </div>
        </div>
      )}
    </div>
  )
}
