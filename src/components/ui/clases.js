// Clases compartidas de la librería para elementos que no pueden ser el
// componente mismo (un NavLink o un <a> con forma de botón de ícono).
// Viven aparte para que los archivos de componentes solo exporten componentes.
export const BOTON_ICONO =
  'group inline-flex items-center justify-center flex-shrink-0 size-control rounded-full text-muted hover:text-accent hover:bg-[var(--accent-tint)] transition active:scale-[0.94] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'

// Tarjeta-fila: tarjeta blanca que entera es un enlace o botón (ícono en
// círculo + título + flecha). La usan las tarjetas de enlace del tablero.
export const TARJETA_FILA =
  'group w-full flex items-center gap-3 p-1.5 pr-4 bg-surface-card rounded-card shadow-card text-left transition hover:shadow-card-hover hover:bg-[var(--accent-tint)] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'
