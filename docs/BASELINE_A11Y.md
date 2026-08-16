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
| `husky` + `lint-staged` (`eslint --fix` sobre `.js`/`.jsx` staged) | ✅ activo |
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
