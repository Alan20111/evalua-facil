// Marca de obligatorio / opcional que acompaña a la etiqueta de un campo.
//
// Convención de la app (pedida el 31-ago-2026):
//   · obligatorio → asterisco rojo
//   · opcional    → signo de más, en el acento del rol
//
// Va DENTRO del <label>, no en un texto aparte: así el margen del campo no
// cambia según lleve marca o no, que es lo que desalineaba las filas de dos
// columnas cuando el "(opcional)" vivía en su propio renglón.
//
// aria-hidden a propósito: el estado obligatorio ya lo anuncia el atributo
// `required` del control, y repetirlo como texto haría que un lector de
// pantalla leyera "asterisco" sin aportar nada. `title` deja la explicación
// disponible al pasar el cursor para quien ve la marca y no la reconoce.
export default function FieldMark({ tipo }) {
  if (tipo !== 'obligatorio' && tipo !== 'opcional') return null
  const obligatorio = tipo === 'obligatorio'
  return (
    <span
      aria-hidden="true"
      title={obligatorio ? 'Obligatorio' : 'Opcional'}
      // `relative` + `-top-1` NO ocupa espacio en el flujo, así que la marca
      // no puede alterar la altura de la etiqueta. Con `align-super` sí la
      // alteraba, y como el asterisco y el signo de más tenían tamaños
      // distintos, dos campos lado a lado quedaban desfasados 1.5 px: el de
      // "opcional" arrancaba más abajo que el de "obligatorio". Mismo
      // text-xs para los dos por la misma razón.
      className={`ml-1 relative -top-1 inline-block text-xs font-bold leading-none ${
        obligatorio ? 'text-red-500' : 'text-accent'
      }`}
    >
      {obligatorio ? '*' : '+'}
    </span>
  )
}
