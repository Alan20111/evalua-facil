# Plan — Estandarización del patrón de diseño en pantallas reales

> **Versión final de este documento** — cierre antes de hand-off. Escrito para ejecutarse fuera de esta conversación (otro modelo/flujo) y luego repartirse entre subagentes en paralelo. No tocar lógica de negocio en ningún paso — solo clases/estilos/atributos de accesibilidad.

## Qué NO es este documento

No es un rediseño. El sistema de diseño (fuente Outfit, tokens de color/superficie, radios por rol, escala tipográfica) **ya existe y ya está implementado** — ver [`docs/DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) (la especificación completa, extraída del código real) y [`docs/PLAN_DISENO.md`](PLAN_DISENO.md) (el plan que lo instaló, fases 0-1 ya ejecutadas — confirmado contra `tailwind.config.js`/`src/index.css` actuales).

El problema no es que falten tokens. Es que **partes del código no los usan** — hay clases hardcodeadas, valores arbitrarios en píxeles, contenedores con anchos inventados, y elementos interactivos sin soporte de teclado, que conviven con el sistema real. Este plan es el barrido para cerrar esa brecha.

## Guardrails permanentes ya instalados (2026-07-11)

Antes de ejecutar este plan, ya se agregó a `eslint.config.js` un piso mínimo que corre en cada `npm run lint`:

- **`eslint-plugin-jsx-a11y`** — linter de accesibilidad JSX. Sin infraestructura nueva, sin impacto en runtime (dev-only), ~6.8s sobre todo el repo.
- **`eslint-plugin-react`** — reglas base de React 19. `settings.react.version` está **fijado a mano** (`'19.2.6'`, no `'detect'`) porque el auto-detect llama a una API de ESLint que la v10 eliminó y crashea el lint completo — no revertir eso sin verificar primero. `react/prop-types` está apagada a propósito (proyecto JS puro, sin PropTypes en ningún lado).
- **Se evaluó y se descartó `eslint-plugin-tailwindcss`**: requiere Tailwind v4, el proyecto usa v3.4.19 — instalarlo daría linting incorrecto.

Esto significa que **la ejecución de este plan tiene un marcador de avance automático**: `npm run lint` hoy reporta 370 problemas totales, de los cuales ~199 son nuevos (jsx-a11y + react) y ~171 son preexistentes y fuera de alcance de este plan. Cada fase de accesibilidad de abajo debe hacer bajar ese número de forma verificable.

## Diagnóstico (evidencia, no suposición)

Grep + `eslint --format json` directo contra `src/` el 2026-07-11:

| # | Hallazgo | Evidencia |
|---|---|---|
| 1 | **`EFDateTimePicker.jsx` ignora la escala tipográfica por completo** — ~15 `fontSize: N` en píxeles crudos (16, 15, 13, 12, 11, 10, 9) vía `style={{}}` en vez de clases `text-xs/sm/base` o las variables `--fs-*` que el resto de la app respeta | `grep -rn fontSize src/` |
| 2 | Ese componente se usa en **10 archivos distintos** (Dashboard, ActivityPage y SubjectPage docente, 3 editores de evaluación, EventEditor, NuevaFechaEntregaModal, tabla de suscripciones admin) — el bug tipográfico se propaga a cada flujo que involucra una fecha | `grep -rln EFDateTimePicker src/` |
| 3 | `CalendarPage.jsx` usa `max-w-5xl` propio en vez de `TEACHER_CONTAINER` — único módulo docente que no crece igual que el resto en pantallas anchas | `src/pages/teacher/CalendarPage.jsx:452` |
| 4 | Módulo alumno: `Dashboard.jsx`/`SubjectPage.jsx` usan `max-w-2xl`, pero `ActivityPage.jsx`/`EvaluacionRunner.jsx`/`EvaluacionRevision.jsx` usan `max-w-xl` — sin ninguna constante equivalente a `TEACHER_CONTAINER` que documente el criterio | `grep -rn "max-w-\(xl\|2xl\)" src/pages/student/` |
| 5 | **Dos dialectos de azul**: `bg-blue-600` hardcodeado en **15 archivos / 38 ocurrencias** conviviendo con el token `bg-accent` en el resto | `grep -rc bg-blue-600 src/` |
| 6 | **74 usos de `focus:ring-2`** y ninguno de `focus-visible:ring-2` — el anillo de foco aparece también al hacer click con mouse | `grep -rho "focus:ring-2" src/` |
| 7 | `disabled:opacity-*` con **5 valores distintos en uso** (20, 30, 40, 50, 60) sin criterio documentado — 89 casos en 60, pero 26 casos dispersos en los otros 4 | `grep -rhoE "disabled:opacity-[0-9]+" src/` |
| 8 | Iconografía lucide con **~19 tamaños distintos** en uso (9 a 40px) — parte es contextual y correcto, pero no hay una escala definida de cuántos pasos debería tener | `grep -rhoE "size=\{?[0-9]+" src/` |
| 9 | **181 violaciones reales de `jsx-a11y`** (desglose abajo) — la más grande es 100 elementos clicables (`<div onClick>`/`<span onClick>`) sin soporte de teclado | `npx eslint . --format json` |

A esto se suma todo lo ya catalogado en [`DESIGN_SYSTEM.md` §10](DESIGN_SYSTEM.md#10-deuda-de-diseño--inconsistencias-a-resolver) (26 puntos: verde `green-*` vs `emerald-*`, 4 estilos de tabs, 3 formas del mismo hover-tint, bordes acentuados por `style` inline, etc.) — ese inventario ya está hecho, este plan solo prioriza y ejecuta.

### Desglose de `jsx-a11y` por regla (total 181)

| Regla | Casos | Qué significa |
|---|---|---|
| `click-events-have-key-events` | 51 | Elemento con `onClick` sin manejador de teclado equivalente (`onKeyDown`) |
| `label-has-associated-control` | 50 | `<label>` sin `htmlFor`/`id` que lo asocie a su input — mismo bug que se encontró y corrigió en el ejercicio de Storybook con `Input.jsx` |
| `no-static-element-interactions` | 49 | `<div>`/`<span>` usados como controles interactivos sin `role`+soporte de teclado/foco — en la mayoría de los casos coincide con los mismos elementos de `click-events-have-key-events` |
| `no-autofocus` | 25 | `autoFocus` — revisar caso por caso, no todos son errores (un input de login sí puede justificar autofocus; un modal que se abre repetidamente probablemente no) |
| `aria-role` | 4 | Rol ARIA inválido o mal escrito |
| `mouse-events-have-key-events` / `interactive-supports-focus` | 1 + 1 | Casos puntuales |

### Top archivos por concentración de `jsx-a11y`

| Archivo | Violaciones |
|---|---|
| `src/pages/teacher/SubjectPage.jsx` | **80** (44% del total — menús contextuales, tabs y filas construidas con `<div onClick>` en vez de `<button>`) |
| `src/pages/teacher/Dashboard.jsx` | 7 |
| `src/pages/student/Activation.jsx` | 7 |
| `src/components/calendar/EventEditor.jsx` | 7 |
| `src/pages/teacher/Profile.jsx` | 6 |
| `src/components/EvaluacionEditor.jsx` | 6 |
| `src/pages/admin/components/SubscriptionsTable.jsx` | 5 |
| `src/components/EvaluacionManager.jsx` | 5 |
| resto (14 archivos) | 1-4 cada uno |

`SubjectPage.jsx` concentra casi la mitad del problema de accesibilidad de toda la app — es candidato a agente dedicado propio, no a repartirse.

## Principio de ejecución

**Token-first, mecánico, sin tocar lógica.** Igual que documenta `PLAN_DISENO.md` §"RIESGOS": barrido por subagentes en paralelo, `npm run build` + `npm run lint` después de cada fase (el conteo de `npm run lint` es ahora el marcador objetivo de avance de las fases 5/6), QA visual manual en navegador antes de dar una fase por cerrada. No hay Storybook/Playwright — se evaluó y se descartó esa vía por sobrecarga para el tamaño de este proyecto; la verificación es directamente sobre la app corriendo con `npm run dev`.

---

## FASE 1 — El bug de mayor alcance: `EFDateTimePicker.jsx`

**Por qué primero:** un solo archivo, propagado a 10 pantallas. Es la corrección con mejor relación impacto/esfuerzo de todo el plan.

- Reemplazar cada `fontSize: N` inline por la clase Tailwind equivalente de la escala (`text-xs`, `text-sm`, etc.) o, donde el diseño necesite un tamaño que no es parte de la escala pública (ej. las ruedas de hora/minuto), usar las variables `--fs-*`/`--lh-*` ya definidas en `src/index.css` en vez de números sueltos.
- Revisar en el mismo archivo otros valores en píxeles crudos que deberían ser tokens: `border-radius: 14`/`7`, colores hex sueltos como `#c0c0c0`/`#f5f5f5`/`#111` (ya hay una excepción documentada y aceptada para tooltips en `index.css` — no confundir esa con esta).
- **Verificación:** abrir el picker desde Dashboard, ActivityPage, SubjectPage (docente) y desde al menos un editor de evaluación; comparar tamaño de letra del picker contra el resto del modal que lo contiene — deben verse de la misma familia tipográfica y escala relativa, no "más chico/grande sin razón".

## FASE 2 — Anchos de contenedor

**2.1 Docente — `CalendarPage.jsx`**
- Cambiar `max-w-5xl mx-auto px-4 py-4` por `TEACHER_CONTAINER` (importado de `src/config/layout.js`, igual que Dashboard/SubjectPage/ActivityPage/Profile).
- Verificación visual en 1280px y 1920px: el calendario debe crecer/limitarse igual que las demás pantallas docente, no quedar más angosto.

**2.2 Alumno — unificar criterio de ancho**
- Decisión a tomar (documentarla, no solo aplicarla): ¿el criterio es "listado = `max-w-2xl`, detalle = `max-w-xl`"? Si es así, crear en `src/config/layout.js` dos constantes explícitas (`STUDENT_CONTAINER` / `STUDENT_CONTAINER_NARROW`, o los nombres que ya sigan la convención del archivo) y reemplazar los `max-w-2xl`/`max-w-xl` sueltos de `Dashboard.jsx`, `SubjectPage.jsx`, `ActivityPage.jsx`, `EvaluacionRunner.jsx`, `EvaluacionRevision.jsx` por esas constantes.
- Esto no es solo estética: hoy el criterio no está escrito en ningún lado, así que cualquier pantalla nueva lo va a adivinar mal. La constante es lo que lo hace mantenible.

## FASE 3 — Sistema de color (unificar a tokens)

- `bg-blue-600`/`hover:bg-blue-700`/`focus:ring-blue-500` → `bg-accent`/`hover:bg-accent-hover`/`focus:ring-accent` en los 15 archivos listados en el diagnóstico (auth completo, Dashboard, Profile, Admin, `Spinner.jsx`, `Toast`/modales compartidos).
  - Ojo: en el módulo alumno esto hace que esos elementos pasen de azul a naranja (correcto — hoy están "atascados" en azul aunque el rol sea alumno).
- `Spinner.jsx`: `border-blue-600` → `border-accent`.
- `VerifyEmail.jsx`: reemplazar el SVG a mano + `bg-green-100`/`#16a34a` por lucide (`CheckCircle2`/`AlertTriangle`/`XCircle`) + `emerald-*`, igual que ya hace `PagoResultado.jsx` con el mismo patrón de pantalla.
- `PortalBadge.jsx`: los colores neón `#39FF14`/`#FF6600` no corresponden a ningún token — evaluar si deben alinearse a `accent`/`accent-hover` del rol o si es una decisión de marca deliberada (preguntar antes de tocar, no asumir).
- `text-orange-600`/`text-orange-500` en `ActivityPage.jsx` (alumno, fechas de extensión) colisiona semánticamente con el accent naranja del propio rol alumno — mover a `amber-*` (la familia ya usada para "advertencia" en el resto de la app).

## FASE 4 — Componentes duplicados / sin criterio

- **Tabs:** hoy hay 4 variantes visuales distintas para el mismo concepto (segmented gris, underline, segmented sólido azul en el panel de evaluar, píldora en Checkout/NuevaFecha). Consolidar a las 2 documentadas en `DESIGN_SYSTEM.md` §6.4 (segmented para docente, underline para alumno) y usar el botón "Outline Accent" para los casos tipo-checkout en vez de inventar una tercera variante de tab.
- **`disabled:opacity`:** estandarizar a `60` como valor general y `40` solo para icon-buttons de toolbar; revisar uno por uno los 26 casos que hoy usan 20/30/50 y decidir si son toolbar o control general.
- **`focus:` → `focus-visible:`** en las 74 ocurrencias — mejora real de accesibilidad (el anillo deja de aparecer en click de mouse, solo en navegación por teclado).
- **Hover-tint sin criterio:** unificar `bg-[var(--accent-tint)]` para superficies (filas, celdas, listas) y `bg-[var(--accent-medium)]` para controles (botones, tabs, icon-buttons).
- **Bordes/fondos acentuados por `style` inline** en `SubjectPage.jsx`/`ActivityPage.jsx` (`style={{ borderColor: 'var(--accent)' }}`) → clases utilitarias (`border-accent`, `bg-accent-light`).

## FASE 5 — Accesibilidad (ahora con datos duros de `jsx-a11y`)

Reemplaza a la fase de "pulido" genérica de la versión anterior de este plan — ahora hay 181 casos concretos, con archivo y línea exactos vía `npx eslint . --format json`.

**5.1 — `label-has-associated-control` (50 casos)**
- Cada `<label>` sin asociar necesita `htmlFor="algun-id"` + el input correspondiente `id="algun-id"`. Mecánico, bajo riesgo, alto volumen — buen candidato para 3-4 subagentes en paralelo repartiendo archivos (evitar que dos agentes toquen el mismo archivo a la vez).

**5.2 — `click-events-have-key-events` + `no-static-element-interactions` (100 casos combinados)**
- La corrección correcta depende del elemento: si es un control real (botón, item de menú, fila clicable), la solución de fondo es cambiar el `<div onClick>`/`<span onClick>` a `<button type="button">` (hereda foco/teclado gratis, no hace falta `role`+`tabIndex`+`onKeyDown` a mano). Si por razones de layout no puede ser un `<button>` real, entonces sí: `role="button"` + `tabIndex={0}` + `onKeyDown` que dispare la misma acción en Enter/Space.
- **No aplicar `eslint-disable` como atajo** — son 100 casos reales de navegación por teclado rota, no ruido.
- `SubjectPage.jsx` concentra 80 de estos — tratarlo como su propio bloque de trabajo, no repartirlo entre agentes que tocan otros archivos a la vez (evita conflictos de merge en el archivo más grande del repo).

**5.3 — `no-autofocus` (25 casos)**
- Revisar uno por uno, no es un "quitar todos": `autoFocus` en el primer input de un formulario de login es una decisión de UX válida; en un modal que se reabre repetidamente sin que el usuario lo pida puede ser molesto para lectores de pantalla. Decidir caso por caso y, donde se mantenga, documentar por qué con un comentario corto.

**5.4 — Contraste y touch targets (heredado de la versión anterior del plan, sin regla de ESLint que lo detecte)**
- Auditar `text-slate-400` sobre fondo blanco (~2.6:1, no cumple AA que exige 4.5:1) en usos de texto informativo legible — reemplazar por `text-muted` (`on-surface-variant`, sí cumple) donde el texto es contenido, no decorativo.
- Revisar `p-1`/`p-1.5` de icon-buttons en tablas y `AttachmentList` — a 16-21px de icono más ese padding quedan por debajo de los 44×44px recomendados para touch.
- Definir la escala de tamaños de icono permitida (propuesta: 14 / 16 / 18 / 20 / 22 / 24 / 32) y documentarla en `DESIGN_SYSTEM.md` §7 una vez decidida.

---

## Cómo verificar que una fase quedó cerrada

Sin Storybook/Axe/Playwright (se descartaron por sobrecarga para el tamaño de este proyecto), la verificación es directa sobre la app real:

1. `npm run build` sin errores nuevos.
2. `npm run lint` — el número total de problemas debe **bajar**, nunca subir, respecto al conteo de la fase anterior. Los ~171 preexistentes no relacionados con este plan (mayormente `no-undef` en `api/`/`seeds-db/` por falta de `globals.node`, y errores sueltos de `react-hooks`) no son responsabilidad de este barrido — no intentar bajarlos a 0 como parte de esto.
3. `npm run dev`, recorrer a mano las pantallas tocadas en esa fase en 3 anchos: 375px, 768px, 1440px.
4. Greps/conteos de cierre por fase (deben devolver 0, o el conteo de `jsx-a11y` correspondiente a 0):
   ```bash
   grep -rn "fontSize" src/components/EFDateTimePicker.jsx                         # Fase 1: 0
   grep -rn "max-w-5xl" src/pages/teacher/                                         # Fase 2: 0
   grep -rc "bg-blue-600" src/                                                     # Fase 3: 0
   grep -rho "focus:ring-2\b" src/ | wc -l                                         # Fase 4: 0
   grep -rhoE "disabled:opacity-(20|30|50)" src/                                   # Fase 4: 0
   npx eslint . --format json | jq '[.[].messages[] | select(.ruleId=="jsx-a11y/label-has-associated-control")] | length'          # Fase 5.1: 0
   npx eslint . --format json | jq '[.[].messages[] | select(.ruleId|test("click-events-have-key-events|no-static-element-interactions"))] | length'  # Fase 5.2: 0
   ```
5. Comparación visual antes/después de al menos: Login (docente y alumno), Dashboard (docente y alumno), SubjectPage (docente y alumno), CalendarPage, un modal con `EFDateTimePicker` abierto, y navegación 100% por teclado (Tab/Enter/Espacio, sin mouse) en `SubjectPage.jsx` después de la Fase 5.2.

## Orden sugerido y por qué

**Fase 1 → 2 → 3 → 4 → 5.** Cada fase es independiente (no hay dependencias entre ellas), pero este orden prioriza primero lo que se **ve** roto en más pantallas a la vez (picker de fecha, anchos), después lo que es **sistema** (color, mecánico y de bajo riesgo), y al final lo que es accesibilidad real de interacción (teclado, foco, contraste). Si el tiempo es limitado, Fases 1-2 ya resuelven la mayoría de lo reportado como "letras y anchos no respetados"; Fase 5 es la que corrige lo que un usuario de teclado/lector de pantalla no puede usar hoy.

## Nota para ejecución con subagentes

Cada fase de este documento es una unidad de trabajo independiente y se puede repartir así:
- **Fases 1 y 2**: un agente cada una (archivos acotados, bajo volumen).
- **Fase 3**: un agente por grupo de 3-4 archivos de los 15 listados (evita colisión de merge).
- **Fase 4**: un agente por sub-punto (tabs / disabled-opacity / focus-visible / hover-tint / inline styles) — son ortogonales entre sí.
- **Fase 5.1 y 5.3**: alto volumen pero mecánico, repartible por archivo entre varios agentes.
- **Fase 5.2**: `SubjectPage.jsx` como agente dedicado y exclusivo (80 casos, archivo más grande del repo); el resto de archivos (20 casos) repartido entre 1-2 agentes más.

Después de cada fase: `npm run build && npm run lint` antes de pasar a la siguiente — es la señal binaria de "no rompiste nada" sin depender de revisión visual exhaustiva en cada paso intermedio.
