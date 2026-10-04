// Fila estándar de la barra lateral del docente (escritorio). TODA fila —
// Horario y Agenda, cada asignatura, Nueva asignatura, los enlaces
// secundarios, Archivadas, créditos y Cerrar sesión— usa esta misma medida,
// así que miden igual de ancho y de alto y el icono y el texto arrancan en la
// misma vertical:
//   · ancho: el de la barra menos el margen de px-2 (el contenedor lo pone)
//   · alto: py-2.5 + el interlineado de text-body-sm (≈ 38 px)
//   · px-4 · gap-3 · icono de 20 px · rounded-full (control que se toca)
// Entre filas de un mismo grupo: space-y-1. Entre grupos: divisoria
// border-t border-white/15 con py-2 en el grupo.
export const SB_ICONO = 20
export const SB_FILA =
  'flex items-center gap-3 w-full px-4 py-2.5 rounded-full text-body-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white'
export const SB_INACTIVA = 'text-white/80 hover:bg-white/10 hover:text-white'
export const SB_ACTIVA = 'bg-white text-accent font-semibold shadow-card'
export const SB_ACTIVA_SUAVE = 'bg-white/15 text-white'
export const SB_GRUPO = 'px-2 py-2 space-y-1'

// Botón de la barra inferior (móvil): columna icono + etiqueta. Mismo padding
// y gap para los cuatro botones; foco visible por teclado con anillo redondo.
export const NAV_ITEM = ({ isActive }) =>
  `flex-1 min-w-0 flex flex-col items-center px-1 py-2 gap-1 rounded-full text-metadata transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
    isActive ? 'text-accent' : 'text-muted'
  }`
