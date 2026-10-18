// Clases de cada microanimación (las usa Animado). Archivo aparte para que
// Animado.jsx solo exporte componentes (fast refresh).
const EFECTOS = {
  gira90: { hover: 'transition-transform duration-estandar ease-firma group-hover:rotate-90 group-focus-visible:rotate-90' },
  sacude: { hover: 'group-hover:animate-sacude', una: 'animate-sacude' },
  gira: { hover: 'group-hover:animate-gira', una: 'animate-gira', activo: 'animate-gira-continuo' },
  empujaArriba: { hover: 'transition-transform duration-rapida ease-firma group-hover:-translate-y-0.5' },
  empujaAbajo: { hover: 'transition-transform duration-rapida ease-firma group-hover:translate-y-0.5' },
  // Varita de la IA: pulso periódico en reposo (solo si la función está
  // disponible), inclinación y estrellas al pasar/enfocar, y giro continuo
  // mientras trabaja. En hover/foco la regla del grupo gana al reposo.
  varita: {
    hover: 'group-hover:animate-destello group-focus-visible:animate-destello',
    reposo: 'animate-varita-reposo',
    activo: 'animate-destello-continuo',
  },
  destello: { hover: 'group-hover:animate-destello', una: 'animate-destello', activo: 'animate-destello-continuo' },
  balanceo: { hover: 'group-hover:animate-balanceo' },
  parpadeo: { una: 'animate-parpadeo' },
  despega: { una: 'animate-despega' },
  pop: { una: 'animate-pop' },
  late: { una: 'animate-late' },
}

export const clasesEfecto = (efecto, cuando = 'hover') => EFECTOS[efecto]?.[cuando] || ''

