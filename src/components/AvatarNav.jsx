// Foto de perfil como botón de la barra inferior: círculo más grande que los
// iconos de los otros botones (36 px, sin texto debajo), con la inicial si aún no hay foto.
// Activo = anillo de acento. Es decorativo (alt vacío): el botón ya se llama
// «Perfil» por su etiqueta.
export default function AvatarNav({ foto, nombre, activo }) {
  return (
    <span
      className={`w-10 h-10 rounded-full overflow-hidden flex items-center justify-center bg-accent-light text-accent text-base font-bold ${
        activo ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface-card' : ''
      }`}
    >
      {foto
        ? <img src={foto} alt="" className="w-full h-full object-cover" />
        : (nombre || '?').charAt(0).toUpperCase()}
    </span>
  )
}
