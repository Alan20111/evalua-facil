// Centralized responsive-width system for the teacher module.
//
// The teacher experience targets laptop/desktop productivity (tables, lists,
// forms used for daily work), so its main content area should grow with the
// viewport instead of sitting in a fixed, narrow column — but it still needs
// a sane upper bound on very wide monitors so long table rows/paragraphs
// don't become uncomfortable to scan. The student module is intentionally
// NOT covered here: it stays mobile-first with its own per-page max-width,
// since a phone screen never benefits from "growing" further.
//
// One shared token instead of repeating breakpoints on every teacher page —
// tune the ladder once here and every screen (Dashboard, SubjectPage,
// ActivityPage, Profile, future modules) picks it up.
// UN SOLO ANCHO para todas las pantallas del docente (oct-2026, pedido
// explícito): todo lo que se muestra —encabezados, tarjetas, tablas,
// formularios de Perfil y Notificaciones— ocupa el mismo ancho, el del área
// de contenido, con el mismo margen lateral (px-4 en la página). Antes había
// tres escalas (completa, «lista» y «angosta») y los bordes de una sección no
// coincidían con los del encabezado de arriba ni con los de otra pantalla.
// Las páginas lo combinan siempre con `px-4`.
export const TEACHER_CONTAINER = 'w-full'

// El alumno sigue la MISMA regla que el docente (oct-2026, pedido explícito:
// «estandarizado en TODO el sitio»): un solo ancho, el del área de contenido,
// con `px-4` en la página. Antes había cuatro (normal, lista, angosta y la de
// la Agenda, que además cambiaba por vista).
export const STUDENT_CONTAINER = 'w-full'

// Muestras de selección (colores, bolitas e íconos de la asignatura): celdas
// de TAMAÑO FIJO (2.5rem ≈ 36 px: caben las 8 de una fila en un teléfono de
// 375 px) en una rejilla que mete tantas columnas como quepan y las reparte
// a todo lo ancho (justify-between), sin hueco suelto a la derecha. Antes eran `aspect-square w-full` en 6/8
// columnas, así que crecían con el ancho de la ventana: al ensanchar los
// formularios (oct-2026) cada cuadro llegó a medir ~120 px, mucho más que los
// botones y campos de alrededor. Colores e íconos usan la MISMA rejilla, así
// que caen en las mismas columnas.
export const REJILLA_MUESTRAS = 'grid grid-cols-[repeat(auto-fill,2.5rem)] justify-between gap-1.5'
export const MUESTRA = 'size-10'
