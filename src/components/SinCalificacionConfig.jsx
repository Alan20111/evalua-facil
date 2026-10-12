import { Scale } from 'lucide-react'
import { ICONO } from '../config/iconos'
import { Checkbox, Radio } from './ui'

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
    <div className="rounded-card border border-outline-variant p-3 space-y-2">
      {/* La casilla de ui/ envuelve el texto en su propio <label>: así lo
          reconoce el lector de pantalla. La explicación va debajo, alineada
          con el texto. */}
      <Checkbox
        id="config-sin-calificacion"
        checked={!!sinCalificacion}
        onChange={(e) => onChange({ sinCalificacion: e.target.checked })}
        label="Sin calificación"
        wrapperClassName="items-center"
      />
      <p className="text-sm text-muted ml-8">
        No cuenta para el promedio ni aparece en la tabla de calificaciones, y no lleva número.
        Se sigue viendo en Actividades y tú ves todas las respuestas.
      </p>

      {sinCalificacion && (
        <div className="ml-6 pl-3 border-l-2 border-outline-variant space-y-2">
          <p className="text-xs font-medium text-muted flex items-center gap-1.5">
            <Scale size={ICONO.xs} className="text-accent" /> ¿Los reactivos tendrán ponderación?
          </p>
          <div>
            <Radio
              id="ponderar-si"
              name="ponderar-reactivos"
              checked={ponderarReactivos !== false}
              onChange={() => onChange({ ponderarReactivos: true })}
              label="Sí, con puntos"
              wrapperClassName="items-center"
            />
            <p className="text-sm text-muted ml-8">Arroja un resultado (por ejemplo 8 de 10) para medir al grupo, sin afectar su calificación.</p>
          </div>
          <div>
            <Radio
              id="ponderar-no"
              name="ponderar-reactivos"
              checked={ponderarReactivos === false}
              onChange={() => onChange({ ponderarReactivos: false })}
              label="No, sin puntos"
              wrapperClassName="items-center"
            />
            <p className="text-sm text-muted ml-8">Una encuesta: no se cuentan aciertos, solo se registra lo que cada quien contestó.</p>
          </div>
        </div>
      )}
    </div>
  )
}
