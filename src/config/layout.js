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
// UN SOLO ANCHO para el contenido de todas las pantallas del docente
// (oct-2026, elegido por el usuario entre 896, 1024, 1280 px y todo el
// ancho): tope de 1024px, centrado, con `px-4` en la página. Es el ancho que
// tenía la lista de Actividades, la que se veía bien. Los encabezados de
// pantalla (p. ej. el de la asignatura) sí van a todo lo ancho, como antes.
// En el teléfono no cambia nada: la pantalla es más angosta que el tope.
export const TEACHER_CONTAINER = 'w-full max-w-[1024px] mx-auto'

// El alumno sigue la MISMA regla que el docente (oct-2026, pedido explícito:
// «estandarizado en TODO el sitio»): el mismo tope de 1024px, con `px-4` en
// la página. Antes había cuatro (normal, lista, angosta y la de
// la Agenda, que además cambiaba por vista).
export const STUDENT_CONTAINER = 'w-full max-w-[1024px] mx-auto'

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
