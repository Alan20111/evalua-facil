# Baseline de accesibilidad y calidad — Fase 0

> Medido el 2026-08-16, en la rama `fix/a11y-fase-0`, tras aplicar los pasos 0.1–0.7
> de `docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md`. Estos números son el punto de
> comparación para todas las fases siguientes — re-medir con los comandos de §9 de
> ese plan al cerrar cada fase.

---

## 1. ESLint (`npm run lint`)

Tras subir `jsx-a11y` a `strict` + activar las 5 reglas opt-in (B-01…B-05):

| | Antes (main) | Después (esta rama) |
|---|---|---|
| Total de problemas | 87 | **128** |
| `jsx-a11y` | 22 | **63** |
| No-`jsx-a11y` (sin cambios, control de sanidad) | 65 | 65 |

Desglose de los 63 `jsx-a11y` nuevos/existentes:

| Regla | Cantidad | Naturaleza |
|---|---|---|
| `control-has-associated-label` | 27 | Icon-buttons sin nombre accesible. Mecánico (`aria-label`). |
| `no-autofocus` | 17 | Ya revisadas y justificadas caso por caso (DESIGN_SYSTEM.md §10-#27). Dejar así. |
| `prefer-tag-over-role` | 6 | `role="button"` → `<button>`. Mecánico. |
| `no-static-element-interactions` | 5 | Requiere criterio (era 1 con `recommended`; `strict` quita el allowlist de handlers). |
| `no-noninteractive-element-interactions` | 3 | Requiere criterio. |
| `label-has-associated-control` | 3 | Se cierran solas al migrar a `ui/Input` (Fase 3, paso 3.5). |
| `no-aria-hidden-on-focusable` | 1 | Trampa de foco puntual. |
| `click-events-have-key-events` | 1 | Requiere criterio. |

**Decisión de esta fase:** no se arreglan aquí — Fase 0 es "cero riesgo de romper una
pantalla" y 63 hallazgos repartidos en ~20 archivos no lo es. Quedan documentados como
backlog de Fase 2 (§2.2–2.10 del plan maestro). El pre-commit los hará visibles en
cuanto alguien vuelva a tocar esos archivos.

---

## 2. Auditoría runtime con axe-core (vía Browser pane, no Lighthouse)

`npx lighthouse` con Chrome headless **no funcionó en este entorno** (`NO_FCP` — la
página no pinta contenido en modo headless dentro del sandbox de la sesión, probado
tanto con el Chrome que trae `lighthouse` como apuntando a
`C:\Program Files\Google\Chrome\Application\chrome.exe`). Es una limitación del
entorno de ejecución, no del código.

**Alternativa usada:** se inyectó `axe-core` 4.10.2 directamente en el DOM real vía
el Browser pane (`npm run dev` + navegación real), que sí corrió sin problema.

| Ruta | Violaciones | Detalle |
|---|---|---|
| `/` (login docente) | 2 moderadas | `landmark-one-main`, `page-has-heading-one` |
| `/alumno` (login alumno) | 2 moderadas | `landmark-one-main`, `page-has-heading-one` |

Confirma en runtime lo que el grep estático ya apuntaba (4 `<main>` para ~30
pantallas): **arreglo puntual de Fase 2, paso 2.5** (landmarks + `<h1>` por pantalla).
Ninguna violación crítica/seria en las dos pantallas públicas alcanzables sin login.

**Pendiente para quien tenga GUI disponible** (documentado, no bloqueante):
```bash
npm run dev
npx lighthouse http://localhost:5173 --view   # abre el reporte en el navegador real
npx unlighthouse --site http://localhost:5173  # barre TODAS las rutas
```

**Manual, requiere interacción humana (paso 0.6 del plan, no automatizable por CLI):**
- Instalar [NVDA](https://www.nvaccess.org/download/) (Windows, gratis) — recorrer el
  login docente y alumno con lector de pantalla real.
- Extensiones de Chrome: axe DevTools, WAVE, Landmarks, headingsMap.
- Los 2 hallazgos de axe de arriba ya dan una pista de por dónde va a doler: sin
  landmark, NVDA no puede saltar directo al contenido con "siguiente región".

---

## 3. Componentización — línea base (`jscpd`)

```
Total:  180 archivos · 51,338 líneas · 84 clones · 1,410 líneas duplicadas (2.75%)
  jsx:         105 archivos · 42,523 líneas · 81 clones · 3.21% duplicado
  javascript:   73 archivos ·  8,324 líneas ·  3 clones · 0.53% duplicado
  css:           2 archivos ·    491 líneas ·  0 clones
```

Meta de Fase 3 (§3.7 del plan maestro): bajar el % duplicado en `jsx` **≥40%** respecto
a este 3.21% → objetivo ≤ **1.93%**.

Concentración de clones ya visible en esta primera pasada: `Register.jsx` ↔
`Onboarding.jsx` (2 bloques), `SubjectPage.jsx` consigo mismo (3 bloques — señal de
que partirlo en piezas también mata duplicación interna, no solo entre archivos).

## 4. Dependencias circulares (`madge`)

```
Processed 192 files — No circular dependency found.
```

Buena noticia: los 6-5 sesiones de la Fase 3 (partir monolitos de miles de líneas)
parten de cero ciclos. Re-correr tras cada corte grande.

## 5. Código/deps muertos (`knip`, `depcheck`)

`knip`: 52 exports sin usar (lista completa en el log de esta rama, no reproducida
aquí por longitud), 2 devDependencies sin uso aparente (`@capacitor/assets`,
`@firebase/rules-unit-testing` — el segundo probablemente falso positivo, lo usa
`test:rules` de forma indirecta vía el emulador).

`depcheck` reporta varios falsos positivos esperables (no entiende que
`@capacitor/android`, `tailwindcss`, `postcss`, `autoprefixer` se consumen fuera del
grafo de imports JS) — **no accionar sin revisar caso por caso**. Único hallazgo con
señal real: `sharp` se usa en `scripts/generate-android-assets.cjs` y no está
declarado como dependencia (funciona hoy porque alguien lo tiene global o el script
nunca se corrió limpio en CI). Anotado para Fase 6 (H-13/dependencias).

---

## 6. Candados activados en esta fase

| Candado | Estado |
|---|---|
| `jsx-a11y/*.strict` + 5 reglas opt-in en `eslint.config.js` | ✅ activo |
| `@axe-core/react` en consola durante `npm run dev` (solo DEV) | ✅ activo |
| `husky` + `lint-staged` (`eslint --fix` sobre `.js`/`.jsx` staged) | ✅ activo — **retirado en Fase 2**, ver §11.9/11.10: resultó inseguro sobre un repo nunca formateado. |
| `npm run check:design` enganchado a pre-commit | ✅ activo — **tuvo que arreglarse primero**: tenía 12 violaciones reales de `disabled:opacity` fuera de la convención 40/60 del DESIGN_SYSTEM (creeping desde que se declaró "0 residuales" en jul-2026). Corregidas como parte de este PR. |
| Verificación: commit con violación deliberada (`fixed inset-0` + `role="presentation"`) | ✅ bloqueado correctamente por el hook, revertido sin dejar rastro |

**Nota de diseño del hook:** `eslint --fix` en `lint-staged` lint-ea el **archivo
completo** que se toca, no solo las líneas modificadas — es el comportamiento
estándar de ESLint/lint-staged. Efecto práctico: si en el futuro alguien edita una
línea de, por ejemplo, `EvaluacionEditor.jsx` (que hoy tiene violaciones `jsx-a11y`
preexistentes no arregladas en esta fase), el commit puede bloquearse por deuda vieja
del archivo, no solo por lo nuevo que se tocó. Es intencional — es el mecanismo que
fuerza la limpieza gradual (principio rector §2 del plan maestro) — pero puede
sorprender si nadie lo sabe. Documentado aquí para que no sea una sorpresa.

---

## 7. Qué falta de la Fase 0 y por qué no bloquea el PR

- **Lighthouse/unlighthouse con reporte HTML real**: bloqueado por el entorno
  headless de esta sesión (§2). No es un problema del código — cualquiera con Chrome
  de escritorio puede correr los dos comandos de §2 y obtener el reporte completo.
- **NVDA / TalkBack / extensiones de navegador**: requieren instalación e interacción
  humana, fuera del alcance de lo que un agente puede automatizar por CLI.

Ninguno de los dos bloquea la puerta de salida de la Fase 0 tal como está definida en
`docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md` §3 (Fase 0): el axe-core real vía
navegador cubre la verificación runtime que Lighthouse habría dado para accesibilidad.

---

# Fase 1 — Candados de arquitectura

> Medido el 2026-08-16, rama `fix/a11y-fase-1` (apilada sobre `fix/a11y-fase-0`,
> que seguía sin mergear a `main` al momento de esta fase).

## 8. Qué se implementó vs. lo que decía el plan original

Tres de los cinco pasos no salieron exactamente como estaban descritos en
`docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md` — corregido inline en ese documento,
detalle completo aquí.

### 8.1 `check-ui-standards.sh` — presupuesto, no cero-tolerancia (paso 1.1)

Los 4 patrones nuevos tenían deuda ya existente grande (37 archivos con modales a
mano, 28 `h-screen`, 59 `vh` crudos, 52 anchos en px duros). Exigir 0 de golpe habría
roto el script el mismo día que se activó — igual que pasó con `disabled:opacity` en
Fase 0. Se implementó un helper `ratchet()` en el script: congela el número de HOY,
bloquea que crezca. Bajar el número (arreglar casos reales) es progreso — para eso
hay que editar el `BASELINE` a mano en el script, así el candado se aprieta con el
tiempo en vez de acostumbrarse al número alto.

Verificado con un archivo de prueba (`w-[123px] h-screen`): el script lo bloqueó
correctamente, mostrando el conteo nuevo contra el presupuesto.

### 8.2 `no-restricted-syntax` — allowlist de archivos, no severidad global (paso 1.2)

A diferencia del script bash, la regla nativa de ESLint no tiene concepto de
"presupuesto numérico". Se resolvió con la misma técnica que ya proponía el paso 1.3
para `eslint-plugin-boundaries`: un bloque de `eslint.config.js` con la regla en
`'error'` para todo el árbol, y un segundo bloque (después, para ganar en la cascada
de flat config) que apaga la regla completa por archivo en los 56 que ya tenían
alguno de los 4 patrones. `components/ui/Modal.jsx` queda exceptuado de forma
permanente (no como deuda) del patrón `fixed inset-0`, porque es la implementación
canónica — no algo por migrar.

Verificado con un archivo de prueba fuera del allowlist
(`fixed inset-0 h-screen w-[80px] max-h-[92vh]`): los 4 selectores dispararon
correctamente, cada uno con su mensaje explicando qué usar en su lugar.

### 8.3 `eslint-plugin-boundaries` no puede ver `<input>` crudo (paso 1.3)

Hallazgo al ejecutar, no al planear: `eslint-plugin-boundaries` gobierna el grafo de
**imports** entre carpetas (qué tipo de módulo puede importar de qué otro tipo) — no
tiene forma de inspeccionar una etiqueta JSX nativa como `<input>`, porque ahí no hay
ningún `import` que interceptar. La regla original del plan ("`pages/` no puede
declarar `<input>`/`<select>`/`<table>` crudos") se implementó con
`no-restricted-syntax` (selectores `JSXOpeningElement[name.name='input']` etc.) sobre
`src/pages/**/*.jsx`, con el mismo patrón de allowlist del punto 8.2.

El allowlist real terminó siendo **20 archivos**, no los ~5 que encontraba un grep de
línea (`<(input|select|table)[\s>]`) — muchos elementos JSX tienen el nombre de la
etiqueta y sus atributos en líneas distintas (`<input\n  type=...`), invisibles para
un grep de una sola línea pero perfectamente visibles para el AST real de ESLint. La
lista final se generó desde la salida JSON de ESLint, no del grep.

`eslint-plugin-boundaries` sí se usó — para el problema que de verdad es un grafo de
imports: `components/ui/` (la librería de diseño compartida) no puede importar de
`pages/`. Se usó la sintaxis v7 (`boundaries/dependencies` + `policies`), no la v5/v6
(`boundaries/element-types` + `rules`) que el plugin instalado (7.2.0) marca como
deprecada con warnings. Solo se definieron los tipos `ui` y `pages` (no un tipo
genérico `components`) porque `src/components/**` incluiría a
`src/components/ui/**` por estar anidado — evita depender de un orden de resolución
de patrones no documentado por el plugin.

Verificado con un archivo de prueba en `components/ui/` importando una página:
`boundaries/dependencies` lo bloqueó con el mensaje de la política.

### 8.4 `npm run lint` crudo no es el gate de CI — se creó `scripts/lint-budget.mjs` (paso 1.4)

Con `jsx-a11y` en `strict` (Fase 0) más `better-tailwindcss` correctness (paso 1.5),
`eslint .` tiene **230 problemas reales hoy** (128 de Fase 0 + 102 nuevos de
`no-unknown-classes`, ver 8.5). Ponerlo como paso obligatorio de `ci.yml` habría
dejado el pipeline en rojo desde el primer commit — un CI perpetuamente rojo entrena
a la gente a ignorarlo, que es peor que no tener CI.

`scripts/lint-budget.mjs` aplica el mismo principio de presupuesto del punto 8.1 pero
al conteo TOTAL de `eslint . -f json` en vez de a un puñado de greps: lee
`.eslint-budget.json` (hoy: 128 → actualizado a 230 tras el paso 1.5), compara contra
el conteo real, falla solo si creció. `npm run lint:budget:write` graba un nuevo
presupuesto cuando de verdad se arregla algo. `npm run lint` (sin `:budget`) se deja
intacto para seguir viendo el detalle completo en desarrollo local.

No se enganchó a pre-commit (a diferencia de `check:design`): una corrida completa de
ESLint tarda **~30 segundos** en este repo — aceptable para CI, no para cada commit.
El pre-commit se queda con `lint-staged` (solo archivos tocados, rápido) +
`check:design` (grep, casi instantáneo).

`commitlint` se configuró con `subject-case: [0]` (desactivada): el default de
`@commitlint/config-conventional` habría rechazado commits reales ya en el historial
del repo — "fix(a11y): Fase 0 del plan de accesibilidad..." (el propio commit de esta
sesión) y "docs(calidad): A17 ejecutada y documentada" arrancan con sustantivo propio
en mayúscula. Formalizar el patrón que el equipo ya usa, no inventar uno más
estricto.

### 8.5 Prettier y `better-tailwindcss`: instalados, NO aplicados a todo el repo (paso 1.5)

Este fue el hallazgo más importante de la sesión. El plan original decía "un commit
separado solo de reordenamiento de clases (ruidoso pero mecánico)" — medido, eso
resultó ser una simplificación incorrecta:

- **Prettier no tiene un modo "solo ordena clases de Tailwind"**. Es un formateador
  de todo o nada. Una prueba en un solo archivo (`components/ui/Button.jsx`, que ya
  sigue una convención de estilo consistente) mostró que Prettier reescribe
  colapsado/expandido de objetos, agrega trailing commas y reenvuelve destructuring
  — cambios de estilo general, no reordenamiento de clases. El plugin de Tailwind
  solo se activa DENTRO de una corrida completa de Prettier.
- **`eslint-plugin-better-tailwindcss` en modo `recommended`/`stylistic`** (orden +
  wrapping de clases) destapó **6,659 hallazgos autofixeables** al medirlo contra el
  código real — confirma que es el mismo problema de escala que Prettier, no una
  regla puntual.

Aplicar cualquiera de las dos herramientas a los ~190 archivos de `src/` de golpe es
un diff de alto riesgo: masivo, ruidoso para revisar, y con alta probabilidad de
choque con cualquier trabajo concurrente en otras ramas (había al menos otro PR
abierto — #1169 — y otra rama activa al momento de esta sesión). Eso no es un
"candado de arquitectura, cero riesgo" — es su propia decisión, con su propio PR, que
necesita luz verde explícita antes de ejecutarse.

**Lo que sí se hizo:**
- Ambas herramientas instaladas y configuradas (`.prettierrc.json`, `.prettierignore`,
  bloque `better-tailwindcss` en `eslint.config.js`).
- `prettier --write` enganchado a `lint-staged` — solo aplica a archivos que alguien
  ya está editando en ese commit, no a todo el repo de golpe.
- De `better-tailwindcss` solo se activó la config `correctness-warn` (no
  `stylistic`): `no-unknown-classes` (102 hallazgos), `no-conflicting-classes` (0),
  `no-concatenated-classes` (0). Los 102 de `no-unknown-classes` son una mezcla:
  - Falsos positivos reales: `safe-top`/`safe-bottom` (utilidades del plugin
    `@capacitor-community/safe-area`, no generadas por Tailwind) y `ef-pop-in`/
    `ef-pop-in-up`/`ef-nodrag` (clases definidas a mano en `index.css`).
  - **Sospechosos genuinos, sin investigar todavía**: `bg-accent-tint`,
    `hover:bg-accent-tint`, `text-on-surface-variant`, `bg-surface-variant` no están
    registradas en `tailwind.config.js` bajo esos nombres literales — o son
    utilidades definidas aparte en `index.css` (como las de arriba) o son clases
    que hoy no generan ningún estilo real. Vale la pena revisar en Fase 2/3.
- `npm run format` / `npm run format:check` (Prettier sobre todo el repo) quedan
  disponibles como comandos explícitos que alguien corre a propósito — no se
  ejecutaron en esta sesión.

**Pendiente, requiere aprobación explícita antes de ejecutarse:** una pasada de
`npm run format` + activar las reglas de estilo de `better-tailwindcss`, en su propio
PR dedicado, coordinada para no chocar con ramas concurrentes.

## 9. Candados activados en esta fase

| Candado | Estado |
|---|---|
| `check-ui-standards.sh` — 4 patrones nuevos con presupuesto/ratchet | ✅ activo |
| `no-restricted-syntax` (ESLint) — mismos 4 patrones + `<input>/<select>/<table>` en `pages/` | ✅ activo, con allowlist de deuda existente |
| `eslint-plugin-boundaries` — `ui/` no puede importar de `pages/` | ✅ activo |
| `scripts/lint-budget.mjs` en CI — presupuesto sobre el total de ESLint | ✅ activo (`.eslint-budget.json`: 230) |
| `.github/workflows/ci.yml` — lint:budget + check:design + build en cada PR | ✅ activo |
| `commitlint` — formato `type(scope): subject` obligatorio vía `.husky/commit-msg` | ✅ activo |
| `.github/PULL_REQUEST_TEMPLATE.md` — checklist de accesibilidad | ✅ activo |
| Prettier + `better-tailwindcss` (correctness) | ✅ configurados, aplicados solo a archivos tocados vía `lint-staged` |
| Reformateo completo del repo (Prettier + reglas de estilo de `better-tailwindcss`) | ⏸ pendiente, decisión explícita del usuario |

## 10. Verificaciones hechas (todas con archivos de prueba, limpiados después)

- `check-ui-standards.sh`: violación de prueba → bloqueada, número mostrado contra presupuesto.
- `no-restricted-syntax` (patrones de diseño): violación de prueba fuera del allowlist → 4 errores, uno por patrón.
- `no-restricted-syntax` (`<input>` en `pages/`): la puerta de salida exacta de la Fase 1 → bloqueado.
- `boundaries/dependencies`: `components/ui/` importando una página → bloqueado.
- `scripts/lint-budget.mjs`: violación de prueba → conteo sube de 230, falla; limpiado → vuelve a 230, pasa.
- `lint-staged` con la cadena `eslint --fix` → `prettier --write`: probado en un archivo con formato inconsistente, ambas herramientas corrieron en orden y el resultado quedó correctamente formateado.
- `commitlint`: mensaje sin formato → rechazado; mensaje real del historial del repo ("Fase 0 del plan...") → aceptado.

---

# Fase 2 — Accesibilidad estructural

> Medido el 2026-08-16, rama `fix/a11y-fase-2` (apilada sobre `fix/a11y-fase-1`,
> que seguía sin mergear a `main` al momento de esta fase, igual que la Fase 0).

## 11. Qué se implementó vs. lo que decía el plan original

### 11.1 `ui/Modal.jsx` — diálogo accesible completo (pasos 2.1–2.3)

- `role="dialog"` + `aria-modal="true"` en el panel (no en el wrapper de centrado).
  `aria-labelledby` apunta al `<h3>` del título vía `useId()`. Cuando no hay título
  (2 de los 4 consumidores actuales — `ConfirmModal`, `LinkAccountModal` — construyen
  su propio encabezado en el `children`), un nuevo prop `ariaLabel` cubre el nombre
  accesible; `LinkAccountModal` lo pasa dinámico según el paso del flujo (email vs.
  confirmación enviada). Dev-only `console.warn` si un consumidor no pasa ninguno.
- `jsx-a11y/prefer-tag-over-role` (Fase 1) sugiere `<dialog>` nativo en vez de
  `role="dialog"`. **No se migró** — cambiaría el mecanismo de apertura (`showModal()`
  imperativo vs. el prop `open` declarativo actual), el backdrop (`::backdrop` vs. el
  `<button>` hermano de `DESIGN_SYSTEM.md` §6.7, ya migrado dos veces antes de
  converger) y el focus trap (nativo vs. `FocusLock`). Es una migración de
  arquitectura, no un arreglo de Fase 2 ("sin refactorizar nada") — documentado con
  `eslint-disable-next-line` explicado inline, no silencioso.
- `react-focus-lock` con `returnFocus` envuelve el panel.
- `useScrollLock` se movió DENTRO de `Modal.jsx`. Los 3 consumidores que lo llamaban
  aparte (`EliminarCuentaModal`, `EliminarCuentaAlumnoModal`, `LinkAccountModal`) se
  limpiaron; `ConfirmModal` **no lo llamaba** — un hueco real (el fondo podía
  scrollear detrás del modal de confirmación) que se cerró solo al centralizarlo.
- La X de cerrar (en `Modal.jsx` y en los encabezados propios de `ConfirmModal`/
  `LinkAccountModal`) pasó de `p-1`/`p-1.5` (target real ~24–28px) a `p-3` con
  margen negativo compensador (target real ~42px), ver §11.6.

Verificado: build limpio, lint limpio (con la excepción documentada), commit de
prueba con `<input>` crudo en `pages/` — sin relación pero confirma que el resto de
candados de Fase 1 siguen intactos.

### 11.2 Toast — `aria-live` + rol por tipo (paso 2.4)

- Contenedor: `aria-live="polite" aria-atomic="false"` (respaldo).
- Cada toast: `role="status"` (success/warning, `aria-live` implícito "polite") o
  `role="alert"` (error, implícito "assertive" — interrumpe al lector, apropiado
  solo para errores). `jsx-a11y/prefer-tag-over-role` exige `<output>` nativo para
  "status" (sí existe la etiqueta) — implementado con un `Tag` dinámico (`div` para
  alert, `output` para status), no con un disable.
- Hallazgo de paso, corregido: el botón de cerrar del toast **no tenía padding en
  absoluto** (16px, el tamaño crudo del ícono — bajo el mínimo de 24px de WCAG
  2.5.8) ni foco visible. Ahora `p-2 -m-2` + `focus-visible:ring-2`.
- `role="alert"` también en los banners de error de formulario reales: se buscó el
  patrón exacto (`text-red-600 bg-red-50 border border-red-200`) en todo `src/` en
  vez de confiar en un grep más laxo — dio solo **3 archivos, 6 apariciones**
  (`Activation.jsx` ×2, `Login.jsx` alumno ×3, `Profile.jsx` docente ×1). El resto
  de los 18 archivos con `bg-red-50` encontrados en un grep más amplio eran
  `hover:bg-red-50` de botones "Eliminar" (no banners) o un prompt de confirmación
  inline en `RubricaPicker.jsx` (no es un mensaje de error, es una interacción).

### 11.3 Landmarks y skip-link (paso 2.5)

- Los 3 layouts (`Layout.jsx`, `StudentLayout.jsx`, `AdminLayout.jsx`) **ya tenían**
  `<main>` — deuda que Fase 0 ya había medido y que, aparentemente, alguien cerró
  entre esa medición y esta fase (o la medición original contaba mal). Lo que
  faltaba de verdad:
  - Skip-link "Saltar al contenido" — componente nuevo `SkipLink.jsx`, reusado en
    los 3 (sigue el patrón de componentes de comportamiento aislado que ya usa el
    repo: `EscKeyHandler.jsx`, `AndroidBackButton.jsx`).
  - `id="main-content"` + `tabIndex={-1}` en cada `<main>` — sin esto, el link con
    `href="#main-content"` desplaza el scroll pero no mueve el foco real.
- Hallazgo de paso: un **4º `<main>`** (el que hacía que el conteo original de Fase 0
  diera "4 archivos" en vez de 3) vivía **anidado** dentro de un panel de
  `EvaluacionManager.jsx` — un landmark `<main>` duplicado es inválido (HTML/ARIA
  solo permiten uno por documento). Corregido a `<div>`.

### 11.4 `aria-current="page"` (paso 2.6) — ya resuelto por el framework

Verificado en el código fuente de `react-router` (`node_modules/react-router/dist/
development/chunk-PULC7NLK.js`): `NavLink` pone `aria-current` con default
`"page"` y lo aplica automáticamente cuando `isActive` es verdadero. Los 3 layouts
y `StudentBottomNav.jsx` usan `NavLink` en el 100% de su navegación entre rutas —
**cero código nuevo necesario**. El único uso de `isActive` fuera de `NavLink`
(`ManualPage.jsx`) es un selector de sección dentro de la misma página con
`<button>`, no navegación entre rutas — no le corresponde `aria-current="page"`
(sería, en todo caso, candidato a un patrón de tabs ARIA completo — fuera de
alcance de este paso).

### 11.5 Jerarquía de headings (paso 2.7)

De 27 archivos con `<h1>`, 4 tenían más de uno. 3 eran ramas `if (...) return (...)`
mutuamente excluyentes (`Activation.jsx` ×5, `Register.jsx` ×2, `ActivityPage.jsx`
alumno ×2) — nunca coexisten en el DOM, no es un problema real. El 4º
(`EvaluacionManager.jsx`) sí lo era: una superposición `fixed inset-0 z-50` de
pantalla completa (revisar la entrega de un alumno) **no desmonta** el header de la
lista de atrás — solo lo cubre visualmente. Su propio `<h1>` (con el mismo nombre de
actividad que el header de atrás) convivía en el DOM con el `<h1>` original. Un
lector de pantalla navegando por encabezados vería el nombre de la actividad dos
veces. Corregido: el de la superposición baja a `<h2>` (es, semánticamente,
correcto de todos modos — revisar una entrega es una sub-vista de la página de la
evaluación, no una página nueva).

No se tocó el patrón más profundo (contenido de fondo no `aria-hidden` detrás de un
overlay `fixed inset-0`) — eso es Fase 3 (el mismo patrón está en el presupuesto de
"modales a mano" de `check-ui-standards.sh`, 37 casos).

### 11.6 Targets táctiles (paso 2.8)

- `ui/Button.jsx`, variante `icon`: `min-h-[44px] min-w-[44px]` en corchetes (no
  `min-h-11` de la escala rem de Tailwind, que con `html{font-size:90%}` global
  daría 39.6px reales, no 44 — WCAG 2.5.8 pide el tamaño real, no el nominal). Sin
  consumidores hoy (`grep 'variant="icon"'` → 0), deja el componente listo para
  cuando Fase 3 empiece a migrar modales/toolbars.
- Barrido de `p-1`/`p-1.5` en controles: el grep de línea único (`<(input|select|
  table)[\s>]`) que se usó para medir "33 archivos" en el plan original no aplica
  aquí (patrón distinto), pero repitiendo el mismo tipo de medición para este
  patrón dio **30 archivos, 101 apariciones**. De esas, **16 eran falsos
  positivos** (contenedores de pestañas/toolbar donde el padding no es el target —
  el target es cada botón hijo — o filas cuyo alto ya lo da un ícono/logo ≥44px sin
  relación con el padding). Las **85 restantes** (84 vía un script de reemplazo por
  contenido exacto de línea + 1 duplicado que el script no cubrió, corregido a
  mano) pasaron de `p-1`/`p-1.5` a `p-2` uniforme — con el rango de tamaños de
  ícono presente en el código (13–24px), `p-2` clarea el mínimo WCAG 2.5.8 de 24px
  en todos los casos (el caso más chico, ícono 13px + `p-2`, da 27.4px reales).
- El candado de `check-ui-standards.sh` para anchos/altos en píxeles duros subió de
  52 a 54 (los 2 `min-h/min-w-[44px]` de `Button.jsx`) — presupuesto actualizado
  con la razón documentada inline en el script, no solo el número.

### 11.7 Contraste (paso 2.9) — calculado, no estimado

Se implementó la fórmula real de contraste de WCAG (luminancia relativa) en un
script, no una inspección visual. Resultados sobre los pares que el plan marcaba
como "sospechosos":

| Par | Ratio medido | Mínimo requerido | Resultado |
|---|---|---|---|
| `text-slate-400` (ícono, reposo) / blanco | 2.56:1 | 3:1 (UI) | ❌ Falla |
| `text-slate-300` (`gradeColor` vacío) / blanco | 1.48:1 | 4.5:1 (texto) | ❌ Falla |
| `text-amber-600` (`gradeColor` media) / blanco | 3.19:1 | 4.5:1 | ❌ Falla |
| `text-red-500` (`gradeColor` baja) / blanco | 3.76:1 | 4.5:1 | ❌ Falla |
| `text-emerald-700` (`gradeColor` alta) / blanco | 5.48:1 | 4.5:1 | ✅ Pasa |
| badge `emerald-700`/`emerald-100` | 4.84:1 | 4.5:1 | ✅ Pasa |
| badge `amber-700`/`amber-100` | 4.51:1 | 4.5:1 | ✅ Pasa (al límite) |
| badge `red-700`/`red-100` | 5.30:1 | 4.5:1 | ✅ Pasa |
| badge `blue-700`/`blue-100` | 5.49:1 | 4.5:1 | ✅ Pasa |
| `--on-surface-variant` (`text-muted`) / blanco | 9.33:1 | 4.5:1 | ✅ Pasa |
| `--accent` docente / blanco | 5.17:1 | 4.5:1 | ✅ Pasa |

**Arreglado**: `gradeColor()` en `SubjectPage.jsx` — `slate-300→500` (4.76:1),
`amber-600→700` (5.02:1), `red-500→600` (4.83:1). Los 3 estados que fallaban ahora
pasan, sin cambiar de familia de color (sigue siendo "gris/ámbar/rojo").

**Documentado, no arreglado**: `text-slate-400` fuera de `gradeColor` aparece
**349 veces** como texto real (no en `hover:`/`focus:`/`disabled:`) — helper text,
mensajes de estado vacío, metadata ("(opcional)", "Ponderación: X", "Sin
respuesta"), no decoración. `text-amber-600` y `text-red-500` aparecen **51 y 23
veces** más fuera de `gradeColor`. Mismo problema de escala que el reformateo de
Prettier en Fase 1: la matemática de contraste que se hizo es contra **blanco**
específicamente — varias de esas 423 apariciones podrían estar sobre fondos de
color (badges, chips) donde el par ya es válido, y confirmarlo caso por caso
requiere ver cada una renderizada, no solo el string de la clase. Cambiarlas a
ciegas es un diff de cientos de líneas sin verificación visual — la misma razón
por la que no se corrió `prettier --write .` en Fase 1. Queda como hallazgo medido
y accionable, no como fix silencioso ni como trabajo perdido.

No se tocó `--outline-variant` (bordes de input, 1.71:1 contra blanco, bajo el 3:1
de UI) — es un token compartido por toda la escala de inputs/cards/divisores;
cambiarlo es una decisión de sistema de diseño, no un fix de Fase 2.

### 11.8 Recorrido de teclado (paso 2.10) — bloqueado por el entorno

`.env` tiene las 5 variables de Firebase vacías (`VITE_FIREBASE_API_KEY` y las
demás) — confirmado por `mtime` que esto es anterior a esta sesión, no algo que se
rompió durante el trabajo de Fase 2. `src/firebase.js` llama `getAuth(app)` a nivel
de módulo, sin try/catch — con una API key vacía, Firebase lanza
`auth/invalid-api-key` de forma síncrona al importar el archivo, lo que impide que
React monte NINGUNA pantalla (protegida o pública) en `npm run dev` local. No es
algo arreglable dentro del alcance de este plan (necesita credenciales reales de un
proyecto de Firebase, y no es un problema de accesibilidad).

Sustituido por verificación estática:
- `grep "<div[^>]*onClick"` → **0** en todo `src/` (confirma el hallazgo de la
  Fase 0: cero divs-como-botón).
- Los 9 hallazgos de `jsx-a11y/click-events-have-key-events` /
  `no-static-element-interactions` / `no-noninteractive-element-interactions` que
  sí aparecen en el lint son preexistentes (ya estaban antes de Fase 2, incluidos
  en el presupuesto de 230) — casos puntuales (`FileDropzone`, `PinchZoomImage`,
  filas expandibles de tablas admin) que piden criterio caso por caso, no un patrón
  sistemático.
- `FocusLock` de `ui/Modal.jsx` (§11.1): revisado por código y probado con build,
  no con un Tab real — la librería (`react-focus-lock`, usada en producción por
  miles de proyectos) es la responsable de la mecánica del trap, no código propio.

**Pendiente real**: repetir el recorrido con Tab/Shift+Tab/Enter/Escape en vivo —
login docente, dashboard, `SubjectPage`, captura de calificaciones, login alumno —
en cuanto `.env` tenga credenciales de Firebase reales. Anotado para quien tenga
acceso a un proyecto de Firebase de desarrollo.

### 11.9 Hallazgo en vivo: `eslint --fix` en `lint-staged` bloqueó un commit seguro

Al intentar comitear los cambios de esta fase (40+ archivos tocados), el hook de
`eslint --fix` de `lint-staged` (Fase 0) bloqueó el commit — no por nada nuevo, sino
por deuda `jsx-a11y`/`react-hooks` **preexistente** en archivos que esta fase tocó
sin relación con esas líneas (`AdminLayout.jsx`, `AttachmentList.jsx`,
`AvatarCropModal.jsx`, `NotificationLog.jsx`, entre otros). `lint:budget` ya
confirmaba que el total no había crecido — el commit era seguro, y aun así quedó
bloqueado. Confirma en vivo la advertencia que la propia Fase 0 ya había documentado
como riesgo aceptado ("puede sorprender si nadie lo sabe") — resultó ser más
fricción de la que valía la pena.

**Primer intento de arreglo** (revertido, ver 11.10): cambiar `lint-staged` a solo
`prettier --write` (sin `eslint --fix`) y agregar `npm run lint:budget` al
pre-commit como gate real (presupuesto sobre el total, igual que CI).

### 11.10 Hallazgo en vivo, más grave: `prettier --write` reformateó ~19,000 líneas — commit descartado

El "arreglo" de 11.9 generó un commit de **47 archivos, 18,997 inserciones, 9,365
eliminaciones** — `SubjectPage.jsx` solo cambió 9,887 líneas, un archivo donde la
intención real era tocar ~15. Causa: **ningún archivo de este repo había pasado por
Prettier antes** (no existía `.prettierrc` hasta Fase 1). `prettier --write` no
tiene modo "solo reformatea lo nuevo" — reformatea el archivo COMPLETO a su propio
estilo canónico la primera vez que lo toca, sin importar cuántas líneas cambiaron
en el commit. Es exactamente el mismo riesgo que ya se había identificado y evitado
explícitamente en Fase 1 (§8.5, "no se ejecutó `prettier --write .` sobre todo el
repo") — solo que ahí se evitó a propósito, y aquí se disparó por accidente al
agregarlo a un hook automático.

El commit nunca se empujó (`fix/a11y-fase-2` no tenía remoto todavía) — se descartó
con `git reset --hard` al punto anterior (Fase 1) y se rehicieron a mano los
cambios semánticos reales de esta fase, sin dejar que Prettier tocara ningún
archivo preexistente.

**Corrección final**: `lint-staged` se **retiró por completo** de `package.json` y
del pre-commit (el paquete también se desinstaló) — ni `eslint --fix` ni
`prettier --write` son seguros para correr automáticamente sobre archivos que
nunca han pasado por esa herramienta. El pre-commit se queda con dos candados que
sí son seguros porque ya son ratchet/presupuesto, no "todo o nada" por archivo:
`npm run check:design` (patrones, ~instantáneo) y `npm run lint:budget` (total del
repo, ~30s). `npm run format`/`format:check` siguen disponibles como comandos
explícitos para quien quiera formatear algo a propósito — nunca automáticos hasta
que exista una pasada completa y aprobada de Prettier sobre el repo (la misma
decisión pendiente de Fase 1 §8.5).

## 12. Candados/arreglos de esta fase

| Cambio | Alcance | Estado |
|---|---|---|
| `ui/Modal.jsx`: `role="dialog"`, `aria-modal`, `aria-labelledby`/`ariaLabel`, `FocusLock`, `useScrollLock` interno | 1 archivo + 4 consumidores actuales | ✅ |
| `Toast.jsx`: `aria-live`, `role` por tipo, botón de cerrar con target/foco corregidos | 1 archivo, 33 consumidores se benefician | ✅ |
| `role="alert"` en banners de error de formulario reales | 3 archivos, 6 apariciones | ✅ |
| `SkipLink.jsx` + `id`/`tabIndex` en `<main>` de los 3 layouts | 4 archivos nuevos/tocados | ✅ |
| Landmark `<main>` duplicado corregido | 1 archivo | ✅ |
| `aria-current="page"` | 0 cambios — ya lo daba `NavLink` | ✅ (gratis) |
| `<h1>` duplicado en superposición de pantalla completa → `<h2>` | 1 archivo | ✅ |
| `ui/Button.jsx` variante `icon` a 44px reales | 1 archivo, 0 consumidores hoy | ✅ |
| 84 botones de ícono `p-1`/`p-1.5` → `p-2` | 30 archivos | ✅ |
| `gradeColor()` — 3 de 4 estados corregidos a ≥4.5:1 | 1 archivo | ✅ |
| `lint-staged` retirado (era inseguro sobre archivos sin formatear); `lint:budget` agregado al pre-commit | `.husky/pre-commit`, `package.json` | ✅ |
| `text-slate-400`/`amber-600`/`red-500` fuera de `gradeColor` (423 apariciones) | ~50+ archivos | ⏸ medido, documentado, no ejecutado — decisión explícita pendiente |
| `--outline-variant` (contraste de bordes, 1.71:1) | token compartido, todo el sistema | ⏸ documentado, decisión de sistema de diseño |
| Recorrido de teclado en vivo | 5 pantallas | ⏸ bloqueado por `.env` sin credenciales — pendiente de verificación real |

## 13. Verificaciones hechas

- `npm run lint:budget` — 230/230 en cada punto de control final, sin crecer.
- `npm run check:design` — limpio, incluido el presupuesto de píxeles duros subido de 52 a 54 con justificación.
- `npm run build` — limpio después de cada bloque de cambios.
- `git diff --stat` revisado antes de cada commit — la primera vez detectó el problema de 11.10 (47 archivos, ~19,000 líneas) antes de empujar nada; la segunda vez confirmó un diff del tamaño esperado (43 archivos, 358 inserciones/201 eliminaciones).
- Contraste: calculado con la fórmula real de WCAG, no aproximado.
