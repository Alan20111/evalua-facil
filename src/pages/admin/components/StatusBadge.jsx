// Etiqueta de estado, no botón. Lo que la hacía competir con el contenido de
// las celdas era la NEGRITA, no el tamaño: a 12 px de peso normal se lee bien
// sin gritar. El relleno acompaña al tamaño para que la píldora no quede
// apretada.
//
// Vive aparte porque la usan dos pantallas del panel: la tabla de Suscripciones
// (una por renglón, deducida de la suscripción) y el Resumen (una por
// indicador, pedida por su clave a INSIGNIAS).
export default function StatusBadge({ situacion }) {
  return (
    <span
      style={situacion.estilo}
      className="inline-block text-[12px] font-normal leading-tight px-2 py-[3px] rounded-full whitespace-nowrap"
    >
      {situacion.etiqueta}
    </span>
  )
}
