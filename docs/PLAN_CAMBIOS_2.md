# Plan de cambios — Lote 2 (refinamientos UI docente/alumno + plantilla Excel)

> Documento de ejecución (para Sonnet). Mismas convenciones que `PLAN_CAMBIOS.md`: "Asignatura" nunca "Materia"; azul docente / naranja alumno vía `accent`; sin rangos en Firestore; `npm run build` + lint al final de cada fase; líneas son guía (verificar al editar).

## DECISIONES ABIERTAS (confirmar)
1. **R3 "Sección perfil docente (Vista Web)"** — el requerimiento llegó **incompleto** (solo dice "En la parte donde el docente edita su perfil (Vista Web)"). **Falta el detalle de qué cambiar.** No se incluye en el alcance hasta tener la instrucción.
2. **R6 Plantilla Excel — CONFIRMADO:** escritura natural; el nombre completo es un solo string y se separa por **espacios**: **1ª palabra = apellido paterno, 2ª = apellido materno, resto = nombre(s)**. Son solo strings; sin comas ni formato especial. (Limitación conocida: apellidos compuestos como "De la Cruz" se interpretan como paterno+materno+nombre; aceptado por el usuario.)
3. **R5 Banco de iconos** — recomendado reusar **lucide-react** (ya es dependencia, ~1500 iconos, tree-shakeable) con un **set curado** de ~36 iconos educativos para el selector (no exponer los 1500). Sin nuevas dependencias. Confirmar el enfoque.

---

## R1 — Orden y nombre de pestañas en la asignatura (docente)
**Objetivo:** en la asignatura, las pestañas de izquierda a derecha: **Actividades · Alumnos · Calificaciones** (palabra completa, no "Calif.").
**Archivo:** `src/pages/teacher/SubjectPage.jsx` (~líneas 790-795).
**Pasos:**
- Cambiar el arreglo `['actividades', 'calificaciones', 'alumnos']` → `['actividades', 'alumnos', 'calificaciones']`.
- Cambiar el label: `t === 'calificaciones' ? 'Calif.'` → `'Calificaciones'` (texto completo). Verificar que el contenedor de tabs no se desborde en móvil (si aprieta, reducir padding/usar `text-xs`).
**Aceptación:** orden Actividades, Alumnos, Calificaciones; la tercera dice "Calificaciones" completo.

## R2 — Sección izquierda del docente (sidebar) + FAB + banner de prueba
**Objetivo:**
- El encabezado **"Asignaturas"** del sidebar debe ser un **botón** que lleve a la pestaña con TODAS las asignaturas (`/dashboard`).
- En **web** quitar el botón flotante **"+"** (FAB) y dejar la creación por el botón existente **"+ Nueva asignatura…"** (solo cambiar comportamientos, no crear botón nuevo).
- Quitar el ítem inferior del sidebar **(icono + "Asignaturas")** que también lleva a todas; la zona bajo la lista queda limpia.
- El aviso de días de prueba: **menos llamativo**, en el **azul de la app**, **sin color de fondo**.

**Archivos:** `src/components/Layout.jsx`, `src/pages/teacher/Dashboard.jsx`.

**Pasos:**
1. **Encabezado "Asignaturas" → botón/NavLink** (Layout, ~143): convertir el `<p>ASIGNATURAS</p>` en un `NavLink to="/dashboard"` (manteniendo el estilo de subtítulo, con hover sutil). Es el acceso a "todas las asignaturas".
2. **Quitar el nav inferior** "Asignaturas" del sidebar desktop (Layout, el bloque `LayoutDashboard` ~228-231 dentro de "Dashboard link"). Eliminar ese bloque; el `import LayoutDashboard` queda solo para el nav móvil (no quitarlo si el móvil lo usa).
3. **FAB "+" solo móvil** (Dashboard, ~227-232): añadir `md:hidden` al botón flotante para que en web no aparezca (en web se crea desde el sidebar). Mantenerlo en móvil (donde no hay sidebar).
4. **Banner de prueba sutil** (Layout, ~125-138): quitar fondo (`bg-amber-50`/`bg-red-50` + bordes) → sin fondo; texto en `text-accent` (azul de la app), icono `Timer` en `text-accent`; quitar la variante roja `<=7` o dejarla también en azul. Tamaño discreto (`text-xs`).
**Aceptación:** "Asignaturas" del sidebar es clickeable y va a /dashboard; en web no hay FAB "+"; no hay nav inferior duplicado; el banner de prueba es azul, sin fondo, discreto.

## R4 — Saludo del docente al entrar
**Objetivo:** el saludo dice "Buenas tardes, CBT-01" (usa el username). Debe decir **"Bienvenido, {nombre que el docente puso}"** y si no puso nombre, el username.
**Archivo:** `src/pages/teacher/Dashboard.jsx` (~143, 149-157).
**Causa raíz:** el saludo usa `userProfile?.nombrePropio` (campo que **no existe** — Perfil guarda en `nombreMostrar`), por eso cae a `username`.
**Pasos:**
- Reemplazar el saludo por hora (`Buenos días/tardes/noches`) por **"Bienvenido,"** (o conservar la hora si se prefiere, pero el requerimiento pide "Bienvenido").
- Mostrar `userProfile?.nombreMostrar || userProfile?.username || 'Docente'` (quitar `nombrePropio`). Usar el nombre completo que puso (no solo el primer token) o el primer token — recomendado: el nombre tal cual lo escribió.
**Aceptación:** "Bienvenido, Fenis" (o el nombre configurado); si no hay nombre, el username.

## R5 — Vista del alumno: color de la asignatura + banco de iconos
**Objetivo:**
- Al **entrar** a una asignatura, el alumno debe ver el **color de la asignatura** (paleta elegida por el docente), no siempre naranja.
- El docente puede **elegir un icono** de un banco y se refleja al alumno (y al docente).

**Archivos:** `src/pages/student/SubjectPage.jsx`, `src/pages/student/Dashboard.jsx`, `src/pages/student/ActivityPage.jsx`, `src/pages/teacher/Dashboard.jsx` (crear), `src/pages/teacher/SubjectPage.jsx` (editar/copiar/restaurar), `src/utils/copySubject.js`, nuevo `src/components/IconSelect.jsx` + `src/utils/subjectIcons.js`.

**Pasos (color):**
1. Verificar que el wrapper `data-subject-palette={subject?.colorPalette || 'default'}` ya esté aplicado en `student/SubjectPage.jsx` y `student/ActivityPage.jsx` (se hizo en F5). Si el alumno aún ve naranja al entrar a una asignatura "verde", revisar que `subject.colorPalette` se esté leyendo y que el wrapper exista; corregir.
2. **Dashboard del alumno:** la tarjeta de cada asignatura debe insinuar su color: envolver cada tarjeta con `data-subject-palette={s.colorPalette || 'default'}` y usar `bg-accent-light`/`text-accent` en el ícono/acento de esa tarjeta (el resto del dashboard sigue naranja del rol). Así "se ve el color de la asignatura" desde la lista.

**Pasos (icono):**
3. **Banco de iconos** (`src/utils/subjectIcons.js`): exportar un mapa curado de ~36 iconos de `lucide-react` con clave estable, p.ej. `{ book: BookOpen, calc: Calculator, flask: FlaskConical, globe: Globe, music: Music, palette: Palette, dumbbell: Dumbbell, code: Code2, atom: Atom, languages: Languages, ... }`. Helper `getSubjectIcon(key)` con fallback a `BookOpen`.
4. **IconSelect** (`src/components/IconSelect.jsx`): grid de iconos (similar a `PaletteSelect`), `value`+`onChange`. Mostrar el icono seleccionado resaltado con el `accent`.
5. **Esquema:** campo `icon` (string key) en el doc subject; default `'book'`. Persistir en crear (Dashboard), editar/copiar/restaurar (SubjectPage) y `copySubject.js`.
6. **Render:** donde hoy se muestra `BookOpen` para una asignatura (sidebar docente, dashboard docente, dashboard alumno, headers de SubjectPage docente/alumno) usar `getSubjectIcon(subject.icon)`.
**Seguridad/eficiencia:** `icon` es cosmético; validar como clave del mapa (enum). lucide es tree-shakeable: importar solo los ~36 iconos del banco (no `import * as`). Sin dependencias nuevas.
**Aceptación:** el docente elige color e icono al crear/editar; el alumno ve ese color al entrar a la asignatura y ese icono en su lista y dentro de la asignatura.

## R6 — Plantilla Excel: número de lista + nombre completo (una columna)
**Objetivo:** la plantilla de descarga debe tener **columna 1 = número de lista**, **columna 2 = nombre completo en una sola columna**, indicando el orden: **Apellido Paterno, Apellido Materno, Nombre(s)**.
**Archivo:** `src/utils/excel.js` (`downloadStudentTemplate` ~4-13 y `parseStudentExcel` ~15-38).
**Pasos:**
1. **downloadStudentTemplate:** encabezados `['#', 'Nombre completo (Apellido Paterno Apellido Materno Nombre)']`; fila de ejemplo `[1, 'García López Juan Carlos']`. Ajustar `!cols` a 2 columnas (p.ej. `{wch:6}`, `{wch:40}`).
2. **parseStudentExcel:** leer 2 columnas. Columna 0 = `orden` (número de lista, opcional). Columna 1 = nombre completo → `trim().split(/\s+/)`: `[0]`=apellidoPaterno, `[1]`=apellidoMaterno, `resto.join(' ')`=nombre. Si solo hay 1 palabra, tratarla como nombre; si hay 2, paterno+materno sin nombre. Escritura natural por espacios (decisión #2).
3. (Opcional) Compatibilidad hacia atrás: si la fila trae ≥3 columnas con datos, asumir el formato viejo (Paterno/Materno/Nombre) para no romper plantillas ya descargadas. Bajo costo; recomendado pero no bloqueante.
**Aceptación:** la plantilla descargada tiene `#` + `Nombre completo`; al importarla, los alumnos se crean con paterno/materno/nombre correctos.

---

## ORDEN DE EJECUCIÓN
| Fase | Req | Riesgo |
|------|-----|--------|
| G1 | R1 (tabs), R4 (saludo) | Bajo |
| G2 | R2 (sidebar + FAB + banner) | Bajo-medio |
| G3 | R6 (plantilla Excel + parser) | Bajo-medio |
| G4 | R5 color (verificar/fijar paleta alumno) | Bajo |
| G5 | R5 iconos (banco + selector + esquema + render) | Medio |
| — | R3 (perfil docente) | **Bloqueado: falta detalle** |

## VERIFICACIÓN FINAL
- `npm run build` + lint limpios.
- QA visual: tabs en orden; saludo con nombre; sidebar sin FAB en web ni nav duplicado; banner azul sin fondo; alumno ve color+icono de la asignatura; importar plantilla nueva crea alumnos bien.
