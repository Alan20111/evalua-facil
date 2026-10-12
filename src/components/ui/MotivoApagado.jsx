// Por qué el botón principal de un formulario está apagado
// (PLAN_NORMALIZACION_UI §5.2, regla 6). Va justo debajo del botón, en el
// mismo pie fijo de la hoja. `faltan` son frases con artículo («el grupo»,
// «las fechas del curso»); si no falta nada pero tampoco hay cambios que
// guardar, `sinCambios` lo dice.
const LISTA = new Intl.ListFormat('es', { type: 'conjunction' })

export default function MotivoApagado({ faltan = [], sinCambios = false }) {
  if (!faltan.length && !sinCambios) return null
  const plural = faltan.length > 1 || /^(las|los) /.test(faltan[0] || '')
  const texto = faltan.length
    ? `${plural ? 'Faltan' : 'Falta'} ${LISTA.format(faltan)}.`
    : 'Aún no hay cambios que guardar.'
  return <p className="text-sm text-muted text-center mt-2">{texto}</p>
}
