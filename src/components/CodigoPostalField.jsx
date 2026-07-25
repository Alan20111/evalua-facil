import { useUbicacionCP } from '../data/useCodigoPostal'
import { estadoPorCodigoPostal, soloDigitosCP, ubicacionTexto } from '../utils/codigoPostal'

// Campo de código postal: el docente escribe 5 dígitos y debajo aparece su
// estado y ciudad (o municipio, si el catálogo no trae ciudad) — no se le
// pide que los escriba ni que los elija de una lista.
//
// Llama al hook por su cuenta en vez de recibir la ubicación por props: los
// fragmentos del catálogo están cacheados en memoria, así que resolver el
// mismo CP dos veces (aquí y en la pantalla que guarda) no cuesta ninguna
// descarga extra y evita bajar props por toda la pantalla.
export default function CodigoPostalField({ id, value, onChange, inputClassName, labelClassName }) {
  const { ubicacion, buscando, noEncontrado } = useUbicacionCP(value)
  // Los rangos por estado viven en el bundle, así que el estado se puede
  // mostrar en cuanto se escribe el quinto dígito; la ciudad llega un
  // instante después, cuando termina de bajar el fragmento del catálogo.
  const estadoInmediato = estadoPorCodigoPostal(value)

  return (
    <div>
      <label htmlFor={id} className={labelClassName}>Código postal</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        maxLength={5}
        value={value}
        onChange={(e) => onChange(soloDigitosCP(e.target.value))}
        className={inputClassName}
        placeholder="Ej. 38000"
        aria-describedby={`${id}-ubicacion`}
      />
      {/* aria-live: quien usa lector de pantalla también se entera de que el
          CP se resolvió, sin tener que volver a recorrer el formulario. */}
      <p id={`${id}-ubicacion`} aria-live="polite" className="text-sm mt-1 min-h-[1.25rem]">
        {buscando && <span className="text-slate-400">{estadoInmediato || 'Buscando…'}</span>}
        {ubicacion && <span className="text-muted">{ubicacionTexto(ubicacion)}</span>}
        {noEncontrado && <span className="text-red-600">No encontramos ese código postal — revísalo</span>}
      </p>
    </div>
  )
}
