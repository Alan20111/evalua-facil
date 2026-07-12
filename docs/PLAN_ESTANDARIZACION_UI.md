# Plan — Estandarización del patrón de diseño en pantallas reales

> **Documento de ejecución, no ejecutable por sí solo.** Escrito para correrse con un modelo de mayor capacidad de razonamiento (Opus) dado el volumen (~25 archivos, cientos de clases, riesgo de regresión visual). No tocar lógica de negocio en ningún paso — solo clases/estilos.

## Qué NO es este documento

No es un rediseño. El sistema de diseño (fuente Outfit, tokens de color/superficie, radios por rol, escala tipográfica) **ya existe y ya está implementado** — ver [`docs/DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) (la especificación completa, extraída del código real) y [`docs/PLAN_DISENO.md`](PLAN_DISENO.md) (el plan que lo instaló, fases 0-1 ya ejecutadas — confirmado contra `tailwind.config.js`/`src/index.css` actuales).

El problema no es que falten tokens. Es que **partes del código no los usan** — hay clases hardcodeadas, valores arbitrarios en píxeles y contenedores con anchos inventados que conviven con el sistema real. Este plan es el barrido para cerrar esa brecha.

## Diagnóstico (evidencia, no suposición)

Grep directo contra `src/` el 2026-07-11:

| # | Hallazgo | Evidencia |
|---|---|---|
| 1 | **`EFDateTimePicker.jsx` ignora la escala tipográfica por completo** — ~15 `fontSize: N` en píxeles crudos (16, 15, 13, 12, 11, 10, 9) vía `style={{}}` en vez de clases `text-xs/sm/base` o las variables `--fs-*` que el resto de la app respeta | `grep -rn fontSize src/` |
| 2 | Ese componente se usa en **10 archivos distintos** (Dashboard, ActivityPage y SubjectPage docente, 3 editores de evaluación, EventEditor, NuevaFechaEntregaModal, tabla de suscripciones admin) — el bug tipográfico se propaga a cada flujo que involucra una fecha | `grep -rln EFDateTimePicker src/` |
| 3 | `CalendarPage.jsx` usa `max-w-5xl` propio en vez de `TEACHER_CONTAINER` — único módulo docente que no crece igual que el resto en pantallas anchas | `src/pages/teacher/CalendarPage.jsx:452` |
| 4 | Módulo alumno: `Dashboard.jsx`/`SubjectPage.jsx` usan `max-w-2xl`, pero `ActivityPage.jsx`/`EvaluacionRunner.jsx`/`EvaluacionRevision.jsx` usan `max-w-xl` — sin ninguna constante equivalente a `TEACHER_CONTAINER` que documente el criterio | `grep -rn "max-w-\(xl\|2xl\)" src/pages/student/` |
| 5 | **Dos dialectos de azul**: `bg-blue-600` hardcodeado en **15 archivos / 38 ocurrencias** conviviendo con el token `bg-accent` en el resto | `grep -rc bg-blue-600 src/` |
| 6 | **74 usos de `focus:ring-2`** y ninguno de `focus-visible:ring-2` — el anillo de foco aparece también al hacer click con mouse, no solo con teclado (ruido visual + no es el comportamiento WCAG recomendado) | `grep -rho "focus:ring-2" src/` |
| 7 | `disabled:opacity-*` con **5 valores distintos en uso** (20, 30, 40, 50, 60) sin criterio documentado — 89 casos en 60, pero 26 casos dispersos en los otros 4 | `grep -rhoE "disabled:opacity-[0-9]+" src/` |
| 8 | Iconografía lucide con **~19 tamaños distintos** en uso (9 a 40px) — parte es contextual y correcto, pero no hay una escala definida de cuántos pasos debería tener | `grep -rhoE "size=\{?[0-9]+" src/` |

A esto se suma todo lo ya catalogado en [`DESIGN_SYSTEM.md` §10](DESIGN_SYSTEM.md#10-deuda-de-diseño--inconsistencias-a-resolver) (26 puntos: verde `green-*` vs `emerald-*`, 4 estilos de tabs, 3 formas del mismo hover-tint, bordes acentuados por `style` inline, etc.) — ese inventario ya está hecho, este plan solo prioriza y ejecuta.

## Principio de ejecución

**Token-first, mecánico, sin tocar lógica.** Igual que documenta `PLAN_DISENO.md` §"RIESGOS": barrido por subagentes en paralelo (1 archivo cada uno cuando el volumen lo justifique), `npm run build` + `npm run lint` limpios después de cada fase, QA visual manual en navegador antes de dar una fase por cerrada (no hay Storybook/Playwright — se descartó esa vía; la verificación es directamente sobre la app corriendo con `npm run dev`).

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
  - Ojo: en el módulo alumno esto hace que esos elementos pasen de azul a naranja (correcto — hoy están "atascados" en azul aunque el rol sea alumno, que es probablemente parte de lo que se percibe como "no se respeta el patrón").
- `Spinner.jsx`: `border-blue-600` → `border-accent`.
- `VerifyEmail.jsx`: reemplazar el SVG a mano + `bg-green-100`/`#16a34a` por lucide (`CheckCircle2`/`AlertTriangle`/`XCircle`) + `emerald-*`, igual que ya hace `PagoResultado.jsx` con el mismo patrón de pantalla.
- `PortalBadge.jsx`: los colores neón `#39FF14`/`#FF6600` no corresponden a ningún token — evaluar si deben alinearse a `accent`/`accent-hover` del rol o si es una decisión de marca deliberada (preguntar antes de tocar, no asumir).
- `text-orange-600`/`text-orange-500` en `ActivityPage.jsx` (alumno, fechas de extensión) colisiona semánticamente con el accent naranja del propio rol alumno — mover a `amber-*` (la familia ya usada para "advertencia" en el resto de la app).

## FASE 4 — Componentes duplicados / sin criterio

- **Tabs:** hoy hay 4 variantes visuales distintas para el mismo concepto (segmented gris, underline, segmented sólido azul en el panel de evaluar, píldora en Checkout/NuevaFecha). Consolidar a las 2 documentadas en `DESIGN_SYSTEM.md` §6.4 (segmented para docente, underline para alumno) y usar el botón "Outline Accent" para los casos tipo-checkout en vez de inventar una tercera variante de tab.
- **`disabled:opacity`:** estandarizar a `60` como valor general y `40` solo para icon-buttons de toolbar (criterio ya sugerido en `DESIGN_SYSTEM.md` §10 P2-#20); revisar uno por uno los 26 casos que hoy usan 20/30/50 y decidir si son toolbar o control general.
- **`focus:` → `focus-visible:`** en las 74 ocurrencias — mejora real de accesibilidad (el anillo deja de aparecer en click de mouse, solo en navegación por teclado).
- **Hover-tint sin criterio:** unificar `bg-[var(--accent-tint)]` para superficies (filas, celdas, listas) y `bg-[var(--accent-medium)]` para controles (botones, tabs, icon-buttons) — hoy se mezclan sin regla clara dentro del mismo archivo en varios casos (ver `DESIGN_SYSTEM.md` §10 P1-#13).
- **Bordes/fondos acentuados por `style` inline** en `SubjectPage.jsx`/`ActivityPage.jsx` (`style={{ borderColor: 'var(--accent)' }}`) → clases utilitarias (`border-accent`, `bg-accent-light`) donde Tailwind ya lo resuelve sin inline style.

## FASE 5 — Pulido de accesibilidad/responsive

- Contraste: auditar `text-slate-400` sobre fondo blanco (~2.6:1, no cumple AA que exige 4.5:1 para texto normal) en los usos como texto informativo legible (no decorativo) — reemplazar por `text-muted` (`on-surface-variant`, sí cumple) donde el texto es contenido, no un elemento puramente decorativo.
- Touch targets: revisar los `p-1`/`p-1.5` de icon-buttons en tablas y `AttachmentList` — a 16-21px de icono más ese padding quedan por debajo de los 44×44px recomendados para touch (Android/WCAG).
- Definir explícitamente la escala de tamaños de icono permitida (propuesta basada en lo ya en uso: 14 / 16 / 18 / 20 / 22 / 24 / 32 — colapsar el resto de valores sueltos a estos pasos) y documentarla en `DESIGN_SYSTEM.md` §7 una vez decidida.

---

## Cómo verificar que una fase quedó cerrada

Sin Storybook/Axe/Playwright (se descartaron por sobrecarga para el tamaño de este proyecto), la verificación es directa sobre la app real:

1. `npm run build` y `npm run lint` sin errores nuevos (los ~171 preexistentes no relacionados con este plan no son responsabilidad de este barrido).
2. `npm run dev`, recorrer a mano las pantallas tocadas en esa fase en 3 anchos: 375px, 768px, 1440px (DevTools de Chrome/Safari, no hace falta tooling adicional).
3. Greps de cierre por fase (deben devolver 0 o solo los casos explícitamente justificados):
   ```bash
   grep -rn "fontSize" src/components/EFDateTimePicker.jsx        # Fase 1: 0
   grep -rn "max-w-5xl" src/pages/teacher/                        # Fase 2: 0
   grep -rc "bg-blue-600" src/                                    # Fase 3: 0
   grep -rho "focus:ring-2\b" src/ | wc -l                        # Fase 4: 0 (todo migrado a focus-visible)
   grep -rhoE "disabled:opacity-(20|30|50)" src/                  # Fase 4: 0
   ```
4. Comparación visual antes/después de al menos: Login (docente y alumno), Dashboard (docente y alumno), SubjectPage (docente y alumno), CalendarPage, un modal con `EFDateTimePicker` abierto.

## Orden sugerido y por qué

**Fase 1 → 2 → 3 → 4 → 5.** Cada fase es independiente (no hay dependencias entre ellas), pero este orden prioriza primero lo que se **ve** roto en más pantallas a la vez (picker de fecha, anchos), después lo que es **sistema** (color, sí pero mecánico y de bajo riesgo), y al final lo que es **pulido** fino (a11y, escalas). Si el tiempo es limitado, Fases 1-2 ya resuelven la mayoría de lo que el usuario reporta como "letras y anchos no respetados".
