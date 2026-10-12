// Escala de íconos (docs/PLAN_NORMALIZACION_UI.md §2.3). Cinco tamaños en lugar
// de los 19 que convivían (11, 12, 13, 15, 17, 18, 19, 21, 22…): un ícono de 13
// junto a uno de 15 en la misma barra se nota aunque nadie sepa decir por qué.
//
//   xs 14 — dentro de chips y controles chicos (h-control-sm)
//   sm 16 — dentro de botones y junto a texto
//   md 20 — navegación, fondos de ícono, botones de ícono
//   lg 24 — encabezados de sección, tarjetas grandes
//   xl 40 — estados vacíos e ilustración
//
// Uso: <Plus size={ICONO.sm} />. El candado de check-ui-standards.sh cuenta los
// size={N} fuera de la escala y solo deja que bajen.
export const ICONO = { xs: 14, sm: 16, md: 20, lg: 24, xl: 40 }

// Fondos de ícono (IconTile): SIEMPRE círculo (DESIGN_SYSTEM §4.1). Tres
// tamaños en lugar de w-8/w-9/w-10/w-11/w-12 según la pantalla.
//   sm 2rem — junto a texto chico, notificaciones
//   md 2.75rem — filas y tarjetas de lista (la estándar: mide lo mismo que
//                un control, así la fila no crece ni se encoge por el ícono)
//   lg 3.5rem — encabezados de tarjeta grande
export const FONDO_ICONO = { sm: 'size-8', md: 'size-11', lg: 'size-14' }
// Ícono que va dentro de cada fondo, para que la proporción sea siempre la misma.
export const ICONO_EN_FONDO = { sm: ICONO.sm, md: ICONO.md, lg: ICONO.lg }
