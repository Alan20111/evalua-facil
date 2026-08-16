# Plan de Accesibilidad y Adaptabilidad — catálogo de herramientas + ejecución

> Objetivo: llevar Evalúa Fácil a **WCAG 2.2 nivel AA**, con una UI que se alinee sola,
> se recomponga en piezas reutilizables y funcione bien desde un teléfono de gama baja
> hasta un monitor de 27".
> Auditoría base: **2026-08-15** · Rama: `main` · Medido sobre 51,125 líneas en `src/`
> Complementa (no reemplaza) a `docs/DESIGN_SYSTEM.md`, `docs/PLAN_COMPONENTIZACION.md`
> y `docs/PLAN_MAESTRO_UI_MOVIL_PUSH.md`.

---

## 0. Diagnóstico medido (agosto 2026)

Todo lo de esta sección son números reales del repo, no estimaciones. Los comandos que
los producen están en §9 para poder re-medir después de cada fase.

### 0.1 Lo que YA está bien (no tocar, es la base sobre la que se construye)

| Señal | Medición | Lectura |
|---|---|---|
| ESLint total | **87 problemas** en 51k líneas | Muy limpio. La disciplina existe. |
| `jsx-a11y` | **22** (17 = `no-autofocus` ya justificados caso por caso) | El linter estático ya no encuentra casi nada. |
| `<button>` reales | **808** | Cero `<div onClick>`. Semántica de controles correcta. |
| `<html lang="es">` | ✅ presente | |
| `focus-visible:` | Migrado en todo el sistema (§10-#19 del DS) | |
| Tokens de color | CSS vars + `data-role` + paletas por materia | Sistema de theming maduro. |
| Contenedores | `src/config/layout.js` centraliza 5 anchos | El patrón correcto ya existe. |
| Toast / Spinner | Centralizados (33 y 36 archivos) | Prueba de que la componentización SÍ funciona aquí. |

### 0.2 Los cinco bloqueadores duros

| # | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| **B1** | `user-scalable=no, maximum-scale=1.0` en el `<meta viewport>` | `index.html:5` | **Falla WCAG 1.4.4 (AA).** Bloquea el pinch-zoom. En una app para docentes de 40–60 años, y para alumnos con baja visión, es el problema #1. |
| **B2** | `html { font-size: 90% }` | `src/index.css:11` | Encoge **todo** el sizing rem un 10%. Combinado con B1, un usuario con vista cansada no tiene ninguna salida. |
| **B3** | **0** `role="dialog"`, **0** `aria-modal` en todo `src/` | grep | Los **38** archivos con `fixed inset-0` no anuncian ningún modal a un lector de pantalla. Sin foco atrapado ni devuelto. |
| **B4** | **1** `sr-only` y **2** `aria-live` en 51k líneas | grep | Toasts, errores de formulario y estados de carga son **silenciosos** para lector de pantalla. |
| **B5** | Adopción de `components/ui/`: **8 archivos** | grep | Contra 38 modales, 44 `<input>` y 11 `<table>` hechos a mano. La librería existe pero no se está usando. |

### 0.3 Deuda estructural

| Señal | Medición | Meta |
|---|---|---|
| Clases responsive (`sm:`/`md:`/`lg:`/`xl:`/`2xl:`) | **198** en 51k líneas (~1.5 por archivo) | Debería estar en 3–5× eso para "adaptable a todo tipo de pantallas". |
| `<main>` | **4** para ~30 pantallas | 1 por pantalla. |
| `<footer>` / `aria-current` / skip-link | **0 / 0 / 0** | ≥1 cada uno. |
| Anchos en px duros (`w-[NNNpx]`) | **46** | ~0 fuera de casos justificados. |
| Archivos con `p-1`/`p-1.5` en controles | **33** | Con `font-size:90%`, `p-1` sobre icono de 16px = **~21.6 px CSS** → **falla WCAG 2.5.8 (24×24 AA)**. |
| `prefers-reduced-motion` | **2** | Global, en `index.css`. |
| Modo oscuro | **0** `prefers-color-scheme`, **1** `dark:` | Decisión pendiente (ver F-07). |
| Monolitos | `SubjectPage.jsx` = **7,153 líneas** (era 4,464 en jul-2026) | El plan de componentización se escribió y el archivo **creció 60%**. |
| `check:design` | Existe, **no está enganchado a nada** | Debe correr en pre-commit + CI. |

> **La conclusión que importa:** el problema no es falta de criterio — el criterio está
> escrito y es bueno. El problema es que **nada lo hace cumplir automáticamente**. Todo
> este plan es, en el fondo, convertir documentación en candados ejecutables.

---

## 1. Catálogo de herramientas

**141 herramientas** (+6 que ya tienes, §K = **147**), agrupadas por función. Cada una lleva:
`ID` · qué es · **por qué aquí** · costo de adopción (🟢 bajo / 🟡 medio / 🔴 alto).

---

### A. Estándares y normas de referencia (12)

Documentos, no software. Son la vara con la que se mide todo lo demás.

| ID | Herramienta | Por qué aquí | Costo |
|---|---|---|---|
| A-01 | **WCAG 2.2 nivel AA** ([w3.org/TR/WCAG22](https://www.w3.org/TR/WCAG22/)) | El objetivo formal. 56 criterios en AA. | 🟢 |
| A-02 | **SC 2.5.8 Target Size (Minimum)** — 24×24 px CSS | Nuevo en 2.2. Es el criterio que hoy fallan los `p-1`. | 🟢 |
| A-03 | **SC 2.5.5 Target Size (Enhanced)** — 44×44 px | AAA, pero es **la meta real** para una app de teléfono. | 🟢 |
| A-04 | **SC 1.4.4 Resize Text** — zoom 200% sin pérdida | El criterio que rompe B1. | 🟢 |
| A-05 | **SC 1.4.10 Reflow** — 320px sin scroll horizontal | La prueba de fuego de "adaptable a celular". | 🟢 |
| A-06 | **SC 1.4.3 / 1.4.11 Contraste** — 4.5:1 texto, 3:1 UI | Hay que auditar `text-slate-400` sobre blanco (≈2.8:1 → **falla**). | 🟢 |
| A-07 | **ARIA Authoring Practices Guide (APG)** ([w3.org/WAI/ARIA/apg](https://www.w3.org/WAI/ARIA/apg/)) | Patrones canónicos de diálogo, tabs, combobox, disclosure. Es la fuente para arreglar B3. | 🟢 |
| A-08 | **EN 301 549** | Norma europea; útil como checklist más operativa que WCAG crudo. | 🟢 |
| A-09 | **gob.mx — lineamientos de accesibilidad** ([gob.mx/accesibilidad](https://www.gob.mx/accesibilidad)) | Contexto institucional mexicano (gob.mx declara WCAG 2.0 AA). Relevante para venderle a SEP. | 🟢 |
| A-10 | **Inclusive Components** (Heydon Pickering) | Recetario de componentes accesibles. La referencia práctica para `ui/`. | 🟢 |
| A-11 | **GOV.UK Design System** | El mejor ejemplo público de UI de servicio público accesible y probada con usuarios reales. | 🟢 |
| A-12 | **Material Design 3 — Accessibility** | Origen del sistema de tokens que ya usa el proyecto (`surface`, `on-surface`, `outline`). Cierra el círculo. | 🟢 |

---

### B. Linting estático — la primera línea de defensa (18)

> **Medido, no estimado.** Se probó la configuración B-01…B-05 contra el código real:
> pasa de **22 a 59** violaciones `jsx-a11y` (+37 problemas reales que hoy nadie ve).
> Desglose exacto en la tabla siguiente.

| ID | Herramienta | Comando / config | Por qué aquí | Costo |
|---|---|---|---|---|
| B-01 | `eslint-plugin-jsx-a11y` → **`flatConfigs.strict`** | cambiar `recommended` → `strict` en `eslint.config.js` | ⚠️ **Ojo con la creencia común:** `strict` **no añade reglas** — tiene 33 contra las 34 de `recommended` (le quita `anchor-ambiguous-text`). Lo que hace es **quitar las escapatorias**: `no-static-element-interactions`, `no-noninteractive-tabindex` y `no-noninteractive-element-to-interactive-role` pierden sus `allowExpressionValues` y allowlists. Efecto medido aquí: **+4 violaciones**. Sigue valiendo la pena (1 línea), pero el verdadero valor está en B-02…B-05. | 🟢 |
| B-02 | Regla `jsx-a11y/control-has-associated-label` | activar (está en `'off'` **en ambas** configs) | **La joya escondida.** Icon-buttons sin nombre accesible: hay 808 `<button>` y solo 50 `aria-label`. Efecto medido: **27 violaciones** — la mayor fuente de hallazgos nuevos del plan entero. | 🟢 |
| B-03 | Regla `jsx-a11y/prefer-tag-over-role` | activar (no está en ninguna config) | Fuerza `<button>` sobre `role="button"`. Medido: **6 violaciones**. | 🟢 |
| B-04 | Regla `jsx-a11y/no-aria-hidden-on-focusable` | activar (no está en ninguna config) | Un elemento enfocable con `aria-hidden` es una trampa de foco silenciosa. Medido: **1 violación**. | 🟢 |
| B-05 | Reglas `jsx-a11y/anchor-ambiguous-text` y `jsx-a11y/lang` | activar explícitamente | `anchor-ambiguous-text` ("click aquí") **se pierde** al pasar a `strict` — hay que reactivarla a mano. Medido: 0 hoy, pero es prevención barata. | 🟢 |
| B-06 | `eslint-plugin-better-tailwindcss` | `npm i -D eslint-plugin-better-tailwindcss` | Sucesor mantenido de `eslint-plugin-tailwindcss`. Detecta clases inexistentes, conflictos (`p-2 p-4`), y **ordena**. Compatible con Tailwind v3 y v4. | 🟡 |
| B-07 | `prettier-plugin-tailwindcss` | `npm i -D prettier prettier-plugin-tailwindcss` | Ordena clases de forma determinista → diffs limpios y conflictos visibles. | 🟡 |
| B-08 | `eslint-plugin-react-hooks` (ya instalado) | subir a `recommended-latest` | Ya detecta 20 `set-state-in-effect`. | 🟢 |
| B-09 | `eslint-plugin-import` / `eslint-plugin-import-x` | `npm i -D eslint-plugin-import-x` | Orden de imports, ciclos, imports rotos. | 🟢 |
| B-10 | `eslint-plugin-boundaries` | `npm i -D eslint-plugin-boundaries` | **Regla arquitectónica ejecutable:** prohíbe que `pages/` reimplemente lo que existe en `components/ui/`. Es el candado directo contra B5. | 🟡 |
| B-11 | `eslint-plugin-no-restricted-syntax` (nativo) | regla `no-restricted-syntax` | Prohibir `fixed inset-0` fuera de `ui/Modal.jsx`. Candado directo contra B3. | 🟢 |
| B-12 | `stylelint` + `stylelint-config-standard` | `npm i -D stylelint stylelint-config-standard` | `index.css` tiene ~500 líneas de tokens sin lintear. | 🟡 |
| B-13 | `stylelint-a11y` | plugin | Detecta `outline: none` sin reemplazo, `font-size` en px. | 🟡 |
| B-14 | `knip` | `npx knip` | Encuentra exports/archivos/deps muertos. Con 196 archivos hay basura garantizada. | 🟢 |
| B-15 | `depcheck` | `npx depcheck` | Dependencias declaradas sin usar (`xlsx` **y** `exceljs` conviven — sospechoso). | 🟢 |
| B-16 | `jscpd` (copy-paste detector) | `npx jscpd src/` | **Cuantifica** la duplicación que motiva la componentización. Da la métrica objetivo de la fase 3. | 🟢 |
| B-17 | `madge` | `npx madge --circular src/` | Dependencias circulares — riesgo real al partir monolitos de 7k líneas. | 🟢 |
| B-18 | `dependency-cruiser` | `npx depcruise src --validate` | Versión con reglas declarativas de B-17 + B-10. | 🟡 |

---

### C. Testing de accesibilidad en runtime (16)

ESLint solo ve JSX estático. Esto ve el DOM real.

| ID | Herramienta | Comando | Por qué aquí | Costo |
|---|---|---|---|---|
| C-01 | **`axe-core`** | `npm i -D axe-core` | El motor. Base de casi todo lo demás. Cubre ~57% de los problemas WCAG automáticamente. | 🟢 |
| C-02 | **`@axe-core/react`** | `npm i -D @axe-core/react` | Reporta violaciones **en la consola durante `npm run dev`**. Feedback inmediato, cero ceremonia. **Empezar por aquí.** | 🟢 |
| C-03 | `@axe-core/playwright` | `npm i -D @playwright/test @axe-core/playwright` | Auditoría por ruta en CI. | 🟡 |
| C-04 | `axe-playwright` | alternativa a C-03 con comandos de conveniencia | | 🟡 |
| C-05 | `vitest-axe` / `jest-axe` | `npm i -D vitest vitest-axe` | Assert `expect(await axe(container)).toHaveNoViolations()` **por componente** de `ui/`. | 🟡 |
| C-06 | `pa11y` | `npx pa11y http://localhost:5173` | Smoke test de una URL en un comando. Cero setup. | 🟢 |
| C-07 | `pa11y-ci` | `npx pa11y-ci --sitemap ...` | Barrido multi-ruta con umbral de fallos. | 🟡 |
| C-08 | **Lighthouse** (Chrome DevTools) | `npx lighthouse http://localhost:5173 --view` | Score de accesibilidad + performance + PWA en un reporte. | 🟢 |
| C-09 | `@lhci/cli` (Lighthouse CI) | `npm i -D @lhci/cli` | Convierte el score de C-08 en un **gate**: falla el build si baja de 95. | 🟡 |
| C-10 | `unlighthouse` | `npx unlighthouse --site localhost:5173` | Lighthouse sobre **todas** las rutas de golpe, con UI. Ideal para el barrido inicial. | 🟢 |
| C-11 | IBM `accessibility-checker` | `npm i -D accessibility-checker` | Segundo motor. Encuentra cosas que axe no. Vale la pena una pasada. | 🟡 |
| C-12 | `@testing-library/react` | `npm i -D @testing-library/react` | Sus queries son `getByRole`/`getByLabelText` — **testear obliga a que la semántica exista**. | 🟡 |
| C-13 | `@testing-library/user-event` | idem | Simula teclado real (Tab, Escape, Enter) → prueba el foco atrapado de los modales. | 🟡 |
| C-14 | `playwright` — proyecto `Mobile Chrome` | `devices['Pixel 7']` | Corre la suite en viewport y user-agent de teléfono real. | 🟡 |
| C-15 | Playwright `toHaveScreenshot()` | nativo | Regresión visual sin servicio externo. | 🟡 |
| C-16 | `axe-core` reglas `wcag22aa` + `best-practice` | config de tags | Activar explícitamente el tag 2.2 — no viene por defecto. | 🟢 |

---

### D. Componentización y primitivas accesibles (17)

El corazón de "alta tasa de recomponentización".

| ID | Herramienta | Por qué aquí | Costo |
|---|---|---|---|
| D-01 | **`class-variance-authority` (cva)** | Define variantes de componente de forma declarativa. Reemplaza los objetos `VARIANTS`/`SIZES` a mano de `ui/Button.jsx` por una API tipada y componible. | 🟡 |
| D-02 | **`tailwind-variants`** | Alternativa a D-01 con **slots** (un componente, varias partes: `panel`, `backdrop`, `header`). Encaja mejor con `Modal`/`Table`. Elegir **uno** de D-01/D-02, no ambos. | 🟡 |
| D-03 | **`tailwind-merge`** | Resuelve conflictos al mezclar clases (`p-2` + `p-4` → `p-4`). El `cn()` actual **no lo hace** y lo documenta como limitación — deja de ser cierto en cuanto los consumidores pasen `className`. | 🟢 |
| D-04 | `clsx` | Versión canónica del `cn()` casero. Sustituir o mantener el propio (es equivalente). | 🟢 |
| D-05 | **`react-focus-lock`** | Atrapa el foco dentro del modal. **Arregla la mitad de B3.** | 🟢 |
| D-06 | `focus-trap-react` | Alternativa a D-05, con `returnFocusOnDeactivate`. | 🟢 |
| D-07 | **`Base UI`** (`@base-ui-components/react`) | v1.0 estable desde dic-2025, mantenido por MUI; shadcn/ui lo toma por defecto desde jul-2026. Dialog, Popover, Select, Tabs **ya accesibles**. La opción recomendada si se adopta una librería. | 🔴 |
| D-08 | `Radix UI` primitives | El incumbente, mayor ecosistema, pero mantenimiento más lento tras la adquisición por WorkOS. | 🔴 |
| D-09 | `React Aria` (`react-aria-components`) | La accesibilidad más profunda del ecosistema (Adobe), con i18n. Más código por componente. | 🔴 |
| D-10 | `Ark UI` | Solo si algún día hay que salir de React. | 🔴 |
| D-11 | `@headlessui/react` | El más ligero. Menos componentes. | 🟡 |
| D-12 | **`vaul`** | Bottom-sheet de calidad nativa con arrastre. El `variant='sheet'` del `Modal` actual es una aproximación estática; esto lo hace sentir app. | 🟡 |
| D-13 | `sonner` | Toasts con `aria-live` correcto, cola y animación. Arregla B4 + la deuda #24 del DS (toast sin animación). | 🟡 |
| D-14 | `react-hotkeys-hook` | Atajos de teclado declarativos — Escape, Ctrl+S en captura de calificaciones. | 🟢 |
| D-15 | `@radix-ui/react-visually-hidden` o `.sr-only` de Tailwind | Texto solo para lector de pantalla. Hoy hay **1** en todo el repo. | 🟢 |
| D-16 | `react-error-boundary` | Un fallo en un subcomponente no debe dejar la pantalla en blanco sin explicación. | 🟢 |
| D-17 | `@tanstack/react-virtual` | Listas de 500 alumnos sin matar un teléfono de gama baja. | 🟡 |

---

### E. Responsive y móvil (17)

| ID | Herramienta | Por qué aquí | Costo |
|---|---|---|---|
| E-01 | **Corregir el `<meta viewport>`** | Quitar `maximum-scale=1.0, user-scalable=no`. **Arregla B1.** Una línea. | 🟢 |
| E-02 | `@tailwindcss/container-queries` | Tailwind v3.4 necesita el plugin (en v4 es nativo). Permite que una card responda a **su contenedor**, no al viewport — requisito para que un componente sea reutilizable en sidebar y en página. | 🟡 |
| E-03 | **Unidades `dvh`/`svh`/`lvh`** | `h-screen` en móvil se rompe con la barra de URL de Chrome Android. `h-[100dvh]` no. Hay varios `max-h-[92vh]` (p. ej. `ui/Modal.jsx`) con este bug. | 🟢 |
| E-04 | `fluid.tw` (Fluid for Tailwind) | Tipografía y espaciado fluidos con `clamp()` en sintaxis Tailwind (`~text-base/lg`). Alternativa **superior** al `font-size: 90%` global de B2. | 🟡 |
| E-05 | `tailwindcss-fluid-type` | Alternativa más simple a E-04. | 🟢 |
| E-06 | `tailwindcss-safe-area` | Utilidades `pb-safe`, `pt-safe`. Resuelve la deuda #22 del DS (Runner sin `safe-bottom`). Complementa `@capacitor-community/safe-area` que ya está instalado. | 🟢 |
| E-07 | `@tailwindcss/forms` | Normaliza `<input>`/`<select>` entre navegadores. Los 44 inputs crudos hoy dependen del default del navegador. | 🟢 |
| E-08 | `@tailwindcss/typography` | `prose` para el contenido de TipTap (avisos, descripciones) — hoy sin estilos de lectura consistentes. | 🟢 |
| E-09 | `tailwind-scrollbar` | Scrollbars visibles y estilizadas en las 11 tablas con `overflow-x-auto`. En desktop la gente no descubre que puede hacer scroll lateral. | 🟢 |
| E-10 | **Chrome DevTools — Device Toolbar** | Ctrl+Shift+M. Gratis, ya instalado. Matriz mínima: 320 / 360 / 390 / 768 / 1024 / 1440. | 🟢 |
| E-11 | **DevTools → Rendering → Emulate `prefers-reduced-motion`** | Prueba la deuda de animación. | 🟢 |
| E-12 | **DevTools → Rendering → Emulate vision deficiencies** | Protanopia, deuteranopia, visión borrosa. Directo al punto de "accesibilidad general". | 🟢 |
| E-13 | `Responsively App` | Muchos viewports lado a lado con scroll y click espejados. | 🟢 |
| E-14 | `Polypane` (comercial) | Lo mismo que E-13 + overlays de contraste, foco y jerarquía de headings en vivo. | 🟡 |
| E-15 | **Android Accessibility Scanner** (Play Store) | Escanea la app **Capacitor real en el teléfono** y marca targets chicos y bajo contraste. Único que prueba el WebView real. | 🟢 |
| E-16 | Chrome `chrome://inspect` (remote debugging) | DevTools completo contra el WebView de Capacitor en un dispositivo físico. | 🟢 |
| E-17 | `@vitejs/plugin-legacy` | Teléfonos SEP de gama baja con Android 8/9 y WebView viejo. | 🟡 |

---

### F. Design tokens, color y contraste (12)

| ID | Herramienta | Por qué aquí | Costo |
|---|---|---|---|
| F-01 | **`Colour Contrast Analyser` (TPGi)** | App de escritorio con cuentagotas. La forma más rápida de auditar los pares del DS §2. | 🟢 |
| F-02 | `culori` o `colorjs.io` | Calcula contraste **en un script** → convierte la auditoría de color en un test automatizable. | 🟡 |
| F-03 | **APCA** (`apca-w3`) | El modelo de contraste de WCAG 3. Más fiel a la percepción real, útil para el texto `slate-400`. | 🟡 |
| F-04 | `Who Can Use` (whocanuse.com) | Muestra un par de colores bajo 8 tipos de daltonismo y catarata. Excelente para decidir. | 🟢 |
| F-05 | `Leonardo` (Adobe) | Genera escalas de color **garantizando** ratios de contraste. Para rehacer las 6 paletas de materia sobre base accesible. | 🟡 |
| F-06 | `Radix Colors` | Escalas de 12 pasos con contraste garantizado y modo oscuro pareado. Referencia para F-05. | 🟡 |
| F-07 | `tailwindcss` `darkMode: ['class', '[data-theme="dark"]']` | El proyecto **ya** conmuta con `data-role` — la misma técnica da modo oscuro. Alto valor percibido, bajo riesgo arquitectónico. | 🟡 |
| F-08 | `Style Dictionary` | Fuente única de tokens → exporta a CSS vars, Tailwind config, Figma y Android. Resuelve la deuda #7 del DS (3 catálogos de paleta casi iguales). | 🔴 |
| F-09 | `Tokens Studio for Figma` | El puente Figma ↔ código para F-08. | 🔴 |
| F-10 | `Open Props` | Set de tokens listo (sombras, easings, escalas) para lo que no está tokenizado: z-index (deuda #21), duraciones. | 🟢 |
| F-11 | `Utopia` (utopia.fyi) | Calculadora de escalas fluidas de tipo y espacio. Genera el `clamp()` para E-04/E-05. | 🟢 |
| F-12 | `Stark` (plugin Figma/navegador) | Contraste, simulación de visión y orden de foco sobre el diseño. | 🟡 |

---

### G. Documentación viva y regresión visual (10)

| ID | Herramienta | Por qué aquí | Costo |
|---|---|---|---|
| G-01 | **Storybook 9** | Cada componente de `ui/` aislado en todos sus estados y viewports. **Es el multiplicador de la componentización**: si no se ve fácil reutilizar, nadie reutiliza. | 🔴 |
| G-02 | **`@storybook/addon-a11y`** | Panel de axe **por story**. Con `parameters.a11y.test = 'error'` **falla el build**. | 🟡 |
| G-03 | `@storybook/addon-vitest` | Corre las stories como tests, incluido el gate de a11y de G-02. | 🟡 |
| G-04 | Storybook viewports | Cada story se ve a 320/390/768/1440 sin salir del navegador. | 🟢 |
| G-05 | `Chromatic` | Regresión visual gestionada + revisión de UI en el PR. Gratis para OSS/proyectos chicos. | 🟡 |
| G-06 | `Ladle` | Alternativa mucho más ligera a G-01, nativa de Vite. **Buena opción si Storybook se siente pesado.** | 🟡 |
| G-07 | `Histoire` | Otra alternativa Vite-native. | 🟡 |
| G-08 | `BackstopJS` | Regresión visual autoalojada, sin servicio externo. | 🟡 |
| G-09 | `Percy` | Alternativa comercial a G-05. | 🟡 |
| G-10 | `react-docgen` | Extrae props de los comentarios que **ya** están en `ui/Button.jsx` → documentación automática. | 🟢 |

---

### H. CI/CD y candados anti-regresión (14)

Sin esto, todo lo anterior se degrada en tres meses. Es la sección más importante del catálogo.

| ID | Herramienta | Por qué aquí | Costo |
|---|---|---|---|
| H-01 | **`husky`** | Hooks de git. | 🟢 |
| H-02 | **`lint-staged`** | Corre lint/prettier solo sobre lo tocado — rápido. | 🟢 |
| H-03 | **Enganchar `npm run check:design` a pre-commit** | El script ya existe y no lo corre nadie. **Costo ~0, valor alto.** | 🟢 |
| H-04 | **GitHub Actions — workflow `ci.yml`** | `lint` + `build` + `check:design` en cada PR. El repo usa PRs a `main`; hoy nada los verifica. | 🟡 |
| H-05 | `treosh/lighthouse-ci-action` | Gate de score de accesibilidad en el PR. | 🟡 |
| H-06 | Job de `axe` sobre el preview de Vercel | Audita el deploy real, no un mock. | 🟡 |
| H-07 | `danger.js` | Reglas sociales: "tocaste un `<input>` y no usaste `ui/Input`" → comentario automático en el PR. | 🟡 |
| H-08 | `size-limit` | Presupuesto de bundle. Con TipTap + pdfjs + exceljs + xlsx + firebase, el bundle en 4G mexicana importa. | 🟡 |
| H-09 | `rollup-plugin-visualizer` | Mapa de qué pesa. Probablemente revele que `xlsx` y `exceljs` están duplicando función. | 🟢 |
| H-10 | `commitlint` + `@commitlint/config-conventional` | El repo **ya** usa `feat(scope):` — solo falta hacerlo obligatorio. | 🟢 |
| H-11 | `.github/PULL_REQUEST_TEMPLATE.md` | Checklist: ¿probado a 320px? ¿navegable con Tab? ¿target ≥44px? | 🟢 |
| H-12 | `codecov` / `vitest --coverage` | Solo cuando existan tests (fase 4+). | 🟡 |
| H-13 | `renovate` o `dependabot` | 60+ dependencias, varias en major reciente (React 19, Vite 8, ESLint 10). | 🟢 |
| H-14 | Ampliar `scripts/check-ui-standards.sh` | Añadir greps: `user-scalable`, `fixed inset-0` fuera de `ui/`, `p-1` en botones, `h-screen` sin `dvh`. | 🟢 |

---

### I. Auditoría manual y tecnología asistiva (13)

Lo automático cubre ~57%. Esto es el otro 43%.

| ID | Herramienta | Por qué aquí | Costo |
|---|---|---|---|
| I-01 | **NVDA** (Windows, gratis) | El lector de pantalla más usado. Estás en Windows: **instalable hoy**. | 🟢 |
| I-02 | **TalkBack** (Android) | El lector real de tus alumnos. Prueba obligatoria de la app Capacitor. | 🟢 |
| I-03 | VoiceOver (macOS/iOS) | Cuando haya build de iOS. | 🟢 |
| I-04 | **axe DevTools** (extensión Chrome) | El mejor reporte interactivo, con "cómo arreglarlo". | 🟢 |
| I-05 | **WAVE** (extensión) | Overlay visual sobre la página. Muy bueno para mostrarle el problema a alguien no técnico. | 🟢 |
| I-06 | **Chrome DevTools → panel Accessibility** | Árbol de accesibilidad + contraste + orden de foco. Ya lo tienes. | 🟢 |
| I-07 | **Firefox Accessibility Inspector** | Tiene "Check for issues → Text labels / Contrast / Keyboard" que Chrome no. | 🟢 |
| I-08 | `tota11y` (bookmarklet, Khan Academy) | Overlays de headings, contraste, labels sin instalar nada. | 🟢 |
| I-09 | `headingsMap` (extensión) | Verifica la jerarquía h1→h6. Hay 34 `<h1>` — hay que revisar si alguna pantalla tiene dos. | 🟢 |
| I-10 | `Landmarks` (extensión) | Navega por landmarks. Con solo 4 `<main>` va a quedar clarísimo el hueco. | 🟢 |
| I-11 | **Prueba de solo teclado** | Desconecta el mouse. Recorre una pantalla completa con Tab/Shift+Tab/Enter/Escape. Ninguna herramienta sustituye esto. | 🟢 |
| I-12 | **Prueba de zoom 200%** + reflow a 320px | Los dos criterios que hoy fallan. Manual, 10 minutos. | 🟢 |
| I-13 | `Silktide Accessibility Checker` (extensión) | Simula lector, daltonismo y dislexia. Muy didáctico. | 🟢 |

---

### J. React, rendimiento y calidad de código (12)

Un teléfono lento es una barrera de accesibilidad.

| ID | Herramienta | Por qué aquí | Costo |
|---|---|---|---|
| J-01 | **`react-scan`** | Visualiza re-renders en vivo. En un `SubjectPage` de 7,153 líneas hay renders de más garantizados. | 🟢 |
| J-02 | React DevTools Profiler | El análisis a fondo tras J-01. | 🟢 |
| J-03 | `why-did-you-render` | Alternativa por consola. | 🟢 |
| J-04 | `eslint-plugin-react-compiler` / React Compiler | React 19 ya lo soporta. Memoización automática. | 🟡 |
| J-05 | `vite-plugin-pwa` | Service worker, offline, actualización. Ya hay `UpdateChecker.jsx` a mano — esto lo formaliza. | 🟡 |
| J-06 | `workbox` | El motor detrás de J-05, para estrategias de caché finas. | 🔴 |
| J-07 | `vite-bundle-visualizer` | Variante rápida de H-09. | 🟢 |
| J-08 | `web-vitals` | Mide LCP/INP/CLS de usuarios reales. **INP** es directamente "se siente lenta al tocar". | 🟢 |
| J-09 | `Vercel Speed Insights` | Ya estás en Vercel — es activar una casilla. | 🟢 |
| J-10 | `@vitejs/plugin-react` + `React.lazy` por ruta | El bundle carga TipTap y pdfjs aunque el alumno solo vea calificaciones. | 🟡 |
| J-11 | `sharp` / `squoosh` | `hero.png` y avatares. Servir WebP/AVIF. | 🟢 |
| J-12 | `@capacitor/preferences` + `IndexedDB` | Caché offline: escuelas SEP con conectividad mala. | 🔴 |

---

### K. Comandos y skills ya disponibles en esta sesión (6)

Herramientas que **ya tienes** y no cuestan instalación.

| ID | Herramienta | Cómo se usa | Por qué aquí |
|---|---|---|---|
| K-01 | **`/code-review`** | `/code-review high` | Revisión de correctitud sobre el diff. Correr al cierre de cada fase. |
| K-02 | **`/simplify`** | `/simplify` | Reuso y simplificación — exactamente el objetivo de la fase 3. |
| K-03 | **`/security-review`** | `/security-review` | Las reglas de Firestore son 37,896 bytes. |
| K-04 | **`npm run check:design`** | ya existe | El candado del DS. Solo falta engancharlo (H-03). |
| K-05 | **`npm run test:rules`** | ya existe | Requiere JDK 21 (`JAVA_HOME` de Android Studio, ver `CLAUDE.md`). |
| K-06 | **`skill: dataviz`** | al construir gráficas | `EvaluacionGraficas.jsx` — paletas accesibles y legibles en claro/oscuro. |

---

### Resumen del catálogo

| Sección | Herramientas |
|---|---|
| A · Estándares | 12 |
| B · Linting estático | 18 |
| C · Testing runtime a11y | 16 |
| D · Componentización | 17 |
| E · Responsive y móvil | 17 |
| F · Tokens, color y contraste | 12 |
| G · Documentación viva | 10 |
| H · CI/CD y candados | 14 |
| I · Auditoría manual | 13 |
| J · React y rendimiento | 12 |
| **Total** | **141** |
| K · Ya disponibles (bonus) | 6 |
| **Total con K** | **147** |

---

## 2. Principio rector de la ejecución

> **No se adopta una herramienta sin un candado que la haga cumplir.**

Este repo ya demostró que la documentación sola no basta: `docs/PLAN_COMPONENTIZACION.md`
se escribió en julio, `components/ui/` se creó… y `SubjectPage.jsx` **creció de 4,464 a
7,153 líneas** mientras la adopción de `ui/` se quedó en 8 archivos. La diferencia entre
este plan y ese no es mejor criterio: es que **cada fase termina con un check ejecutable**
que impide volver atrás.

Corolario: las fases de candado (0, 1, 6) van **antes** que las de refactor grande.
Poner el candado primero es lo que hace que el refactor no se deshaga.

---

## 3. Plan de ejecución por fases

Ocho fases. Cada una es **una rama y un PR**. Cada una tiene una **puerta de salida**
medible — si el comando no pasa en verde, la fase no cierra.

---

### FASE 0 — Quick wins (1 sesión) 🔴 EMPEZAR AQUÍ

Máximo impacto, mínimo riesgo. Nada de esto puede romper una pantalla.

| Paso | Herramientas | Acción |
|---|---|---|
| 0.1 | E-01 | En `index.html`, quitar `maximum-scale=1.0, user-scalable=no`. Dejar `width=device-width, initial-scale=1.0, viewport-fit=cover`. **Arregla B1 / WCAG 1.4.4.** |
| 0.2 | B-01…B-05 | `eslint.config.js`: `.recommended` → `.strict` **y** activar a mano las 5 reglas opt-in (bloque de abajo). **Ya está medido: 22 → 59 violaciones**, de las cuales 27 son icon-buttons sin nombre accesible. Ninguna sorpresa. |
| 0.3 | C-02 | Instalar `@axe-core/react`, activarlo solo en `import.meta.env.DEV` desde `main.jsx`. Consola con violaciones reales desde el primer `npm run dev`. |
| 0.4 | H-01, H-02, H-03 | `husky` + `lint-staged` + enganchar `check:design` y `eslint` a pre-commit. |
| 0.5 | C-08, C-10 | Correr `npx unlighthouse --site localhost:5173` y guardar el reporte como **línea base**. |
| 0.6 | I-01, I-04, I-05, I-09, I-10 | Instalar NVDA + extensiones. Costo: 20 minutos, cero código. |
| 0.7 | B-14, B-15, B-16, B-17 | Correr `knip`, `depcheck`, `jscpd`, `madge`. Guardar métricas base. |

El bloque exacto del paso 0.2 (verificado contra `eslint-plugin-jsx-a11y` 6.10.2 instalado):

```js
// eslint.config.js — dentro del bloque de files: ['**/*.{js,jsx}']
extends: [
  // ...
  jsxA11y.flatConfigs.strict,   // era .recommended
],
rules: {
  'react/prop-types': 'off',
  // Las 5 opt-in: NO vienen activas ni en recommended ni en strict.
  'jsx-a11y/control-has-associated-label': 'error',  // 27 hallazgos hoy
  'jsx-a11y/prefer-tag-over-role': 'error',          //  6 hallazgos hoy
  'jsx-a11y/no-aria-hidden-on-focusable': 'error',   //  1 hallazgo hoy
  'jsx-a11y/anchor-ambiguous-text': 'error',         //  strict la QUITA — reactivar
  'jsx-a11y/lang': 'error',
},
```

**Desglose medido de las 59 violaciones que esto destapa:**

| Regla | Hoy | Naturaleza |
|---|---|---|
| `control-has-associated-label` | 27 | Icon-buttons sin nombre accesible. **Arreglo mecánico** (`aria-label`). |
| `no-autofocus` | 17 | Ya revisadas y justificadas caso por caso (§10-#27 del DS). Dejar como están. |
| `prefer-tag-over-role` | 6 | `role="button"` → `<button>`. Mecánico. |
| `no-noninteractive-element-interactions` | 3 | Requiere criterio. |
| `label-has-associated-control` | 3 | Se cierran solas al migrar a `ui/Input` (paso 3.5). |
| `no-aria-hidden-on-focusable` | 1 | Trampa de foco. Arreglo puntual. |
| `click-events-have-key-events` | 1 | Requiere criterio. |
| `no-static-element-interactions` | 1 | Requiere criterio. |

Es decir: **de 59, unas 34 son mecánicas, 17 ya están justificadas y solo 8 piden pensar.**
Perfectamente abordable en una sesión — no hay que dejarlo en `warn`.

**Puerta de salida:** `npm run lint` pasa (o su nuevo total está anotado y justificado);
pre-commit bloquea una violación de prueba; existe `docs/BASELINE_A11Y.md` con los números
de 0.5 y 0.7.

---

### FASE 1 — Candados de arquitectura (1 sesión)

Poner las paredes **antes** de mover los muebles.

> **Ejecutada 2026-08-16** (rama `fix/a11y-fase-1`, apilada sobre `fix/a11y-fase-0`).
> Notas de lo que salió distinto a lo planeado en cada paso están inline abajo;
> desglose completo en `docs/BASELINE_A11Y.md` §8.

| Paso | Herramientas | Acción |
|---|---|---|
| 1.1 | H-14 | Ampliar `check-ui-standards.sh`: prohibir `user-scalable=no`; `fixed inset-0` fuera de `ui/Modal.jsx`; `h-screen`/`vh` sin variante `dvh`; `w-[NNNpx]` nuevos. **Ejecutado con presupuesto/ratchet** (37/28/59/52 casos, congelados — cero tolerancia habría roto el script contra deuda ya existente, igual que pasó con `disabled:opacity` en Fase 0), no cero-tolerancia. |
| 1.2 | B-11 | Regla `no-restricted-syntax` en ESLint para el mismo conjunto. **`no-restricted-syntax` no tiene concepto de presupuesto nativo** (a diferencia del script bash) — se implementó como allowlist de archivos (56 con deuda ya existente, la misma técnica de B-10 aplicada aquí también), no como severidad `warn` global. |
| 1.3 | B-10 | ~~`eslint-plugin-boundaries`: `pages/` no puede declarar `<input>`/`<select>`/`<table>` crudos~~ — **corregido al ejecutar**: `boundaries` gobierna el grafo de *imports* entre carpetas, no puede ver una etiqueta JSX nativa como `<input>` (no hay ningún `import` que interceptar). Esa parte se implementó con `no-restricted-syntax` (igual que 1.2, allowlist de 20 archivos con deuda real — más que los ~5 que un grep de línea encontraba, porque muchos `<input>`/`<table>` tienen atributos en varias líneas). `eslint-plugin-boundaries` sí se usó, pero para lo que de verdad sirve: `components/ui/` no puede importar de `pages/` (frontera de imports real). |
| 1.4 | H-04, H-10, H-11 | `ci.yml`, `commitlint`, plantilla de PR. **`npm run lint` crudo no se usó como gate de CI** — con jsx-a11y strict (Fase 0) tiene 128 problemas reales hoy; ponerlo en CI tal cual nace en rojo. Se creó `scripts/lint-budget.mjs` (mismo patrón de presupuesto que 1.1, aplicado al conteo total de ESLint) como paso de CI en su lugar. `subject-case` de commitlint se desactivó: el default habría rechazado commits reales del propio historial ("Fase 0 del plan...", "A17 ejecutada..."). |
| 1.5 | B-06, B-07 | `eslint-plugin-better-tailwindcss` + `prettier-plugin-tailwindcss` instalados y configurados. **No se ejecutó el reformateo de todo el repo.** Ninguna de las dos herramientas tiene un modo "solo reordena clases" — Prettier reformatea el archivo completo (colapsa/expande objetos, trailing commas, wrapping de destructuring, no solo Tailwind) y las reglas de estilo de `better-tailwindcss` (orden + wrapping de clases) destaparon **6,659 hallazgos autofixeables** de golpe al medirlas. Aplicar cualquiera de las dos a todo `src/` es un diff de alto riesgo (~190 archivos, choca con cualquier PR abierto en paralelo) — no es un "candado de arquitectura, cero riesgo", es su propia fase con aprobación explícita. Quedaron configuradas y enganchadas a `lint-staged` (solo tocan archivos que alguien ya está editando), y `better-tailwindcss` activa solo su regla de corrección (`no-unknown-classes`, 102 hallazgos — mezcla de falsos positivos y algunos sospechosos genuinos, ver `docs/BASELINE_A11Y.md`) en `warn`, sin las reglas de estilo. |

**Puerta de salida:** un PR de prueba que añade un `<input>` crudo en `pages/` es
rechazado por CI. **Verificado** con un archivo de prueba fuera del allowlist:
`no-restricted-syntax` lo bloquea con el mensaje "Usa \<Input\> de components/ui...".

---

### FASE 2 — Accesibilidad estructural (2 sesiones)

Los arreglos que no dependen de refactorizar nada.

> **Ejecutada 2026-08-16** (rama `fix/a11y-fase-2`, apilada sobre `fix/a11y-fase-1`).
> Desglose completo, incluidos los hallazgos que ampliaron o recortaron el alcance
> original, en `docs/BASELINE_A11Y.md` §11.

| Paso | Herramientas | Acción |
|---|---|---|
| 2.1 | A-07, D-15 | **Arreglar B3 en `ui/Modal.jsx`**: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` apuntando al `<h3>` del título (o `aria-label` cuando no hay título — 2 de los 4 consumidores actuales no lo tenían). `jsx-a11y/prefer-tag-over-role` (propio de Fase 1) sugiere `<dialog>` nativo — no se migró, es un cambio de arquitectura (backdrop/apertura/focus-trap), documentado como excepción con comentario inline. |
| 2.2 | D-05 | `react-focus-lock` en `ui/Modal.jsx` + `returnFocus`. |
| 2.3 | — | `useScrollLock` movido dentro de `ui/Modal.jsx`; quitado de los 3 consumidores que lo llamaban aparte (uno, `ConfirmModal`, ni siquiera lo tenía — hueco real que se cerró solo). |
| 2.4 | D-13 o manual | `aria-live="polite"` + `role="status"`/`role="alert"` según tipo en `Toast.jsx` (el rol reemplaza al `<div>` genérico — `jsx-a11y/prefer-tag-over-role` exige `<output>` nativo para "status", que sí tiene ese rol implícito). De paso, el botón de cerrar del toast no tenía padding (16px, bajo el mínimo de 24px) ni foco visible — corregido. `role="alert"` también en los 6 banners de error de formulario reales encontrados (`Activation.jsx`, `Login.jsx` alumno, `Profile.jsx` docente) — la mayoría de los `bg-red-50` del resto del código eran `hover:` de botones de eliminar, no banners. |
| 2.5 | I-10, A-01 | Los 3 layouts **ya tenían** `<main>` (deuda de Fase 0 ya cerrada antes de esta fase). Lo que faltaba: el skip-link (nuevo componente `SkipLink.jsx`, reusado en los 3) + `id`/`tabIndex={-1}` en cada `<main>` para que el salto realmente mueva el foco. De paso: un 4º `<main>` en `EvaluacionManager.jsx` estaba **anidado** dentro de un panel (landmark duplicado, inválido) — corregido a `<div>`. |
| 2.6 | — | **Ya estaba resuelto por el framework**: `NavLink` de React Router pone `aria-current="page"` automáticamente cuando la ruta coincide (confirmado en el código fuente de la librería). Los 3 layouts + `StudentBottomNav.jsx` usan `NavLink` al 100% de su navegación — cero código nuevo necesario. |
| 2.7 | I-09 | De los 27 archivos con `<h1>`, 4 tenían más de uno; 3 eran ramas `if/return` mutuamente excluyentes (no es un problema real). El cuarto (`EvaluacionManager.jsx`) sí era un problema genuino: una superposición `fixed inset-0` de pantalla completa no desmonta el header de atrás, así que su propio `<h1>` convivía con el de la superposición — degradado a `<h2>` (es, de hecho, una sub-vista). |
| 2.8 | A-02, A-03 | El grep de línea original (`<(input\|select\|table)[\s>]`) para el conteo de la Fase 1 no aplica aquí, pero el mismo problema de fondo sí: **30 archivos** (no 33) con `p-1`/`p-1.5` en controles reales, **84 instancias** arregladas a `p-2` (clarea WCAG AA 24×24 para todos los tamaños de ícono presentes, 13–24px) vía script de reemplazo por contenido exacto — 16 casos quedaron sin tocar por ser contenedores de pestañas/toolbar o filas cuyo alto ya lo da el contenido (logo/ícono ≥44px), no el padding. `ui/Button` variante `icon`: `min-h-[44px] min-w-[44px]` en corchetes (no en la escala rem de Tailwind, que con `font-size:90%` global daría 39.6px reales, no 44) — sin consumidores todavía, deja el componente listo para Fase 3. |
| 2.9 | F-01, F-04, A-06 | Contraste calculado con la fórmula real de WCAG (luminancia relativa), no estimado. **Confirmado, no solo sospechado**: `text-slate-400` en reposo (2.56:1, bajo el 3:1 mínimo de UI) y 3 de los 4 estados de `gradeColor` (`text-slate-300` 1.48:1, `text-amber-600` 3.19:1, `text-red-500` 3.76:1, los 3 bajo el 4.5:1 de texto) — arreglado (`gradeColor` a slate-500/amber-700/red-600, los 3 ahora ≥4.5:1). Los badges `-100/-700` (emerald/amber/red/blue) **sí pasan** (4.5–5.5:1) — el DS ya acertó ahí. **No arreglado, solo documentado**: `text-slate-400` fuera de `gradeColor` aparece **349 veces** como texto real (no decorativo) fuera de estados `hover:`/`disabled:`, y `text-amber-600`/`text-red-500` **51/23 veces** más — mismo problema de escala que el reformateo de Prettier en Fase 1: cambiar esto a ciegas en 400+ instancias sin poder verificar visualmente cada contexto (algunas podrían estar sobre fondos de color donde el contraste ya es correcto) es un diff de alto riesgo, no un "arreglo puntual". Decisión explícita, no ejecutada. |
| 2.10 | I-11 | **Bloqueado por el entorno, no por el código**: `.env` tiene las credenciales de Firebase vacías (preexistente — `mtime` de antes de esta sesión), y `getAuth()` truena de forma síncrona al importar `firebase.js`, lo que tumba toda la app antes de que React monte nada — ninguna pantalla renderiza en este `npm run dev` local, protegida o pública. Sustituido por verificación estática: 0 `<div onClick>` crudos confirmado, `FocusLock` revisado por código + build, y los 9 hallazgos de interacción por teclado que sí aparecen en el lint son preexistentes (ya contados en el presupuesto de 230). |

**Puerta de salida:** `@axe-core/react` reporta **0 violaciones críticas** en las 5 pantallas
principales; el skip-link funciona; NVDA anuncia "diálogo" al abrir un modal.
**Parcialmente verificado** — ver 2.10: el bloqueo de entorno impidió la corrida en vivo de
axe-core sobre las 5 pantallas y la prueba de NVDA en esta sesión; sí se verificó cada
candado nuevo con lint + build + revisión de código. Pendiente: repetir la verificación en
vivo en cuanto `.env` tenga credenciales de Firebase reales.

---

### FASE 3 — Componentización (3–5 sesiones) — la fase larga

Aquí se cobra todo lo anterior. **`docs/PLAN_COMPONENTIZACION.md` ya define la estrategia
— esta fase la ejecuta, no la reinventa.**

| Paso | Herramientas | Acción |
|---|---|---|
| 3.1 | D-03, D-04 | Cambiar `ui/cn.js` por `clsx` + `tailwind-merge`. En cuanto los consumidores pasen `className`, la limitación que el archivo documenta se vuelve un bug real. |
| 3.2 | D-01 **o** D-02 | Reescribir `ui/Button.jsx` con `cva` (elementos simples) o `tailwind-variants` (si se quiere slots para `Modal`/`Table`). **Elegir uno solo.** |
| 3.3 | B-16 | Correr `jscpd` → lista priorizada de bloques duplicados. Es la hoja de ruta objetiva de esta fase. |
| 3.4 | — | **Migrar los 38 modales** a `ui/Modal`. Por lotes de 5–8, un PR cada uno. El candado 1.3 impide que aparezcan nuevos. |
| 3.5 | E-07 | **Migrar los 44 `<input>`** a `ui/Input` + `@tailwindcss/forms`. Cada `ui/Input` trae `<label>` asociado por construcción → cierra las 3 violaciones de `label-has-associated-control`. |
| 3.6 | — | Migrar los 11 `<table>` a `ui/Table` con `<caption>`, `scope="col"` y contenedor `overflow-x-auto` con `tabIndex={0}` (una región con scroll debe ser alcanzable por teclado). |
| 3.7 | B-17, B-18 | Partir los monolitos siguiendo el patrón `components/{feature}/` que ya funciona en `calendar/`, `rubrica/` y `agenda/`. Orden por dolor: `SubjectPage` (7,153) → `CalendarPage` (2,650) → `ActivityPage` (2,406) → `EvaluacionManager` (2,163). Verificar ciclos con `madge` tras cada corte. |
| 3.8 | D-16 | `react-error-boundary` por ruta. |
| 3.9 | K-02 | `/simplify` sobre el diff acumulado al final de cada lote. |

**Puerta de salida:** `fixed inset-0` solo aparece en `ui/Modal.jsx`; adopción de `ui/` ≥ 60
archivos; `jscpd` baja ≥40% respecto a la base de 0.7; ningún archivo > 1,500 líneas.

---

### FASE 4 — Documentación viva (1–2 sesiones)

| Paso | Herramientas | Acción |
|---|---|---|
| 4.1 | G-01 **o** G-06 | Storybook 9, o **Ladle** si se prefiere ligero y nativo de Vite. Para este repo, **Ladle es la recomendación**: menos configuración, mismo beneficio para una librería `ui/` de ~8 componentes. |
| 4.2 | G-02, G-03 | `addon-a11y` con `a11y.test = 'error'`. Un componente con violación **no compila**. |
| 4.3 | G-04 | Viewports 320/390/768/1440 por defecto en cada story. |
| 4.4 | G-10 | Documentación de props desde los comentarios existentes. |
| 4.5 | C-05, C-12, C-13 | `vitest` + `testing-library` + `vitest-axe`: un test por primitivo de `ui/` (render, teclado, axe). |
| 4.6 | G-05 o G-08 | Regresión visual (`Chromatic` gestionado / `BackstopJS` autoalojado). |

**Puerta de salida:** los 8 primitivos de `ui/` tienen story + test de axe en verde.

---

### FASE 5 — Adaptabilidad total (2 sesiones)

| Paso | Herramientas | Acción |
|---|---|---|
| 5.1 | A-05, E-10 | Auditar **todas** las pantallas a 320px. Documentar cada scroll horizontal. |
| 5.2 | E-03 | Sustituir `vh`/`h-screen` por `dvh` (incluye `max-h-[92vh]` de `ui/Modal.jsx`). |
| 5.3 | E-02 | `@tailwindcss/container-queries`. Aplicar a las cards que aparecen en sidebar **y** en página — es lo que hace un componente verdaderamente recomponible. |
| 5.4 | E-04/E-05, F-11 | **Reemplazar `html { font-size: 90% }` por tipografía fluida con `clamp()`.** Esto arregla B2 sin perder la densidad que se buscaba: el tamaño se adapta al viewport en vez de encogerse siempre. Es el cambio más delicado del plan — hacerlo en su propia rama, con capturas antes/después. |
| 5.5 | E-06 | `tailwindcss-safe-area` → cierra la deuda #22 del DS (Runner sin `safe-bottom`). |
| 5.6 | E-09, E-08 | Scrollbars visibles en tablas; `@tailwindcss/typography` para el contenido de TipTap. |
| 5.7 | E-15, E-16 | Accessibility Scanner de Android + `chrome://inspect` sobre el APK real. **Este paso encuentra cosas que ningún emulador ve.** |
| 5.8 | F-10 | Escala de z-index formal (deuda #21 del DS). El `Modal` ya tiene un mapa `Z` improvisado de 5 niveles. |

**Puerta de salida:** cero scroll horizontal a 320px en todas las rutas; zoom al 200% usable;
Accessibility Scanner sin hallazgos de "touch target" en las pantallas de alumno.

---

### FASE 6 — CI y observabilidad (1 sesión)

| Paso | Herramientas | Acción |
|---|---|---|
| 6.1 | C-03, C-14 | Playwright + `@axe-core/playwright`, proyectos `Desktop Chrome` y `Pixel 7`. |
| 6.2 | C-16 | Activar tags `wcag22aa` explícitamente. |
| 6.3 | H-05, C-09 | Lighthouse CI con umbral de accesibilidad ≥ 95, bloqueante. |
| 6.4 | H-06 | Job de axe contra el preview de Vercel de cada PR. |
| 6.5 | H-08, H-09, J-07 | Presupuesto de bundle. Resolver `xlsx` vs `exceljs`. |
| 6.6 | J-08, J-09 | `web-vitals` + Speed Insights. Vigilar **INP** (respuesta al tacto). |
| 6.7 | H-13 | Renovate/Dependabot. |
| 6.8 | H-07 | `danger.js` para las reglas sociales que ESLint no expresa. |

**Puerta de salida:** un PR con una regresión de accesibilidad deliberada es bloqueado por CI.

---

### FASE 7 — Refinamiento (continuo)

| Paso | Herramientas | Acción |
|---|---|---|
| 7.1 | F-07, F-05, F-06 | Modo oscuro sobre el mismo mecanismo `data-*` que ya existe. |
| 7.2 | F-08, F-09 | `Style Dictionary` → una sola fuente para las 3 paletas duplicadas (deuda #7 del DS). |
| 7.3 | J-01, J-02, J-04 | `react-scan` → React Compiler donde valga la pena. |
| 7.4 | D-17 | Virtualización de listas largas de alumnos. |
| 7.5 | J-05, J-10, J-11 | PWA formal, code-splitting por ruta, imágenes optimizadas. |
| 7.6 | D-07 | **Solo si hace falta**: migrar primitivas a Base UI. Evaluar al terminar la fase 4 — quizá `ui/` propio ya alcance. |
| 7.7 | I-02, I-01 | Ronda de prueba con TalkBack y NVDA por pantalla. |
| 7.8 | A-01 | Declaración de accesibilidad pública. Diferenciador comercial ante SEP. |

---

## 4. Orden recomendado y esfuerzo

| Fase | Sesiones | Riesgo | Valor |
|---|---|---|---|
| **0 · Quick wins** | 1 | 🟢 Muy bajo | 🔥 Máximo |
| **1 · Candados** | 1 | 🟢 Bajo | 🔥 Máximo (protege todo lo demás) |
| **2 · A11y estructural** | 2 | 🟡 Medio | 🔥 Máximo |
| **3 · Componentización** | 3–5 | 🔴 Alto | 🔥 Máximo |
| **4 · Documentación viva** | 1–2 | 🟢 Bajo | 🟡 Medio-alto |
| **5 · Adaptabilidad** | 2 | 🟡 Medio (5.4 es delicado) | 🔥 Alto |
| **6 · CI** | 1 | 🟢 Bajo | 🔥 Alto |
| **7 · Refinamiento** | continuo | variable | 🟡 Medio |

**Si solo hubiera tiempo para una cosa: la fase 0.** Son ~2 horas y arregla el bloqueador
de accesibilidad más grave del producto (B1) más el candado que evita que todo se degrade.

**Si solo hubiera tiempo para dos: fase 0 + fase 1.**

---

## 5. Decisiones que hay que tomar (no las tomo por ti)

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| D1 | Variantes de componente | `cva` (D-01) vs `tailwind-variants` (D-02) | **`cva`** — más simple, y `ui/Button` ya tiene esa forma mental. |
| D2 | Documentación viva | Storybook (G-01) vs Ladle (G-06) | **Ladle** — nativo de Vite, para 8 componentes Storybook es sobreingeniería. |
| D3 | Librería headless | Construir `ui/` propio vs adoptar Base UI (D-07) | **Propio por ahora.** Reevaluar tras la fase 4. Adoptar Base UI a mitad del refactor duplicaría el trabajo. |
| D4 | El `font-size: 90%` (paso 5.4) | Mantener / quitar / sustituir por fluido | **Sustituir por fluido.** Es el cambio con más riesgo visual del plan — merece su propia rama y aprobación tuya con capturas. |
| D5 | Modo oscuro (7.1) | Sí / no | Alto valor percibido, pero **después** de la fase 3: hacerlo con 38 modales sueltos es multiplicar el trabajo por 38. |

---

## 6. Los tres candados que sostienen todo

Si de este documento solo sobrevivieran tres cosas, que sean estas:

1. **`jsx-a11y` en `strict` + las 5 reglas opt-in** (B-01…B-05) — seis líneas, destapa 37
   problemas reales hoy y atrapa las regresiones futuras en el editor, antes del commit.
2. **`check-ui-standards.sh` enganchado a pre-commit y CI** (H-03, H-04) — el script ya
   existe y hoy no lo corre nadie.
3. **`eslint-plugin-boundaries` con allowlist** (B-10) — permite lo viejo, prohíbe lo nuevo.
   Es lo que hace que un refactor de 5 sesiones no se deshaga en 3 meses.

---

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El paso 5.4 (tipografía fluida) cambia visualmente **toda** la app. | Rama propia, capturas antes/después de 10 pantallas, aprobación explícita. |
| Migrar 38 modales toca 38 archivos → alta probabilidad de regresión. | Lotes de 5–8 por PR, con `check:design` + revisión visual en cada uno. |
| ~~`jsx-a11y` en `strict` puede destapar >100 problemas nuevos.~~ | **Riesgo descartado por medición:** son 59 en total (22 actuales + 37 nuevos), y 34 de ellos son mecánicos. Cabe en una sesión. |
| Partir `SubjectPage.jsx` (7,153 líneas) puede romper flujos sin tests. | Hacerlo **después** de la fase 4 (que crea los tests), o extraer con cortes puramente mecánicos. |
| `prettier-plugin-tailwindcss` genera un diff gigante. | Commit aislado, solo formato, con mensaje que lo declare. Añadir a `.git-blame-ignore-revs`. |
| Adoptar demasiadas herramientas de golpe. | Las fases están ordenadas por dependencia real; **ninguna fase adopta más de 6 herramientas nuevas**. |

---

## 8. Lo que este plan NO hace

- No rediseña. Todo sale de `docs/DESIGN_SYSTEM.md`, igual que el principio rector de
  `PLAN_COMPONENTIZACION.md` §2.
- No toca Firestore, reglas ni Cloud Functions.
- No cambia la identidad de marca (el `PortalBadge` verde lima es decisión deliberada, §10-#5).
- No promete WCAG AAA. La meta es **AA**, con targets de 44px (AAA) como excepción por ser
  una app de teléfono.

---

## 9. Comandos de re-medición

Correr al cerrar cada fase y anotar en `docs/BASELINE_A11Y.md`.

```bash
# Lint total y desglose por regla
npx eslint . -f json > /tmp/lint.json && node -e "const r=require('/tmp/lint.json');const m={};let t=0;for(const f of r)for(const g of f.messages){m[g.ruleId||'parse']=(m[g.ruleId||'parse']||0)+1;t++};console.log('TOTAL',t);Object.entries(m).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(String(v).padStart(5),k))"
```

```bash
# Componentización: modales, inputs, tablas a mano vs adopción de ui/
echo "modales a mano: $(grep -rl 'fixed inset-0' --include='*.jsx' src/ | wc -l)"; echo "inputs crudos: $(grep -rl '<input' --include='*.jsx' src/ | wc -l)"; echo "tablas crudas: $(grep -rl '<table' --include='*.jsx' src/ | wc -l)"; echo "adopcion ui/: $(grep -rl "from '.*components/ui" --include='*.jsx' src/ | wc -l)"
```

```bash
# Densidad responsive y semántica
echo "clases responsive: $(grep -rEo '\b(sm|md|lg|xl|2xl):[a-z-]' --include='*.jsx' src/ | wc -l)"; echo "main: $(grep -ro '<main' --include='*.jsx' src/ | wc -l)"; echo "aria-live: $(grep -ro 'aria-live' --include='*.jsx' src/ | wc -l)"; echo "role=dialog: $(grep -ro 'role="dialog"' --include='*.jsx' src/ | wc -l)"; echo "sr-only: $(grep -ro 'sr-only' --include='*.jsx' src/ | wc -l)"
```

```bash
# Monolitos
find src -name '*.jsx' | xargs wc -l | sort -rn | head -12
```

```bash
# Duplicación, código muerto, ciclos
npx jscpd src/ --min-lines 10 --reporters console
```

```bash
# Auditoría completa de todas las rutas (con el dev server corriendo)
npx unlighthouse --site http://localhost:5173
```

---

## 10. Fuentes

- [WCAG 2.2 — W3C](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/) · [2.5.8 Target Size](https://www.wcag.com/developers/2-5-8-target-size-minimum-level-aa/)
- [eslint-plugin-jsx-a11y](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y) · [Automated Tools — a11y-automation.dev](https://a11y-automation.dev/automated-tools/)
- [Storybook — Accessibility tests](https://storybook.js.org/docs/writing-tests/accessibility-testing) · [@storybook/addon-a11y](https://storybook.js.org/addons/@storybook/addon-a11y)
- [axe-playwright](https://www.npmjs.com/package/axe-playwright) · [Pa11y y axe-core — Ramotion](https://www.ramotion.com/blog/practical-accessibility-testing-with-pa11y-and-axe-core/)
- [Headless UI alternatives — LogRocket](https://blog.logrocket.com/headless-ui-alternatives/) · [Radix vs Base UI 2026](https://www.shadcndeck.com/blog/radix-vs-base-ui) · [Top Headless UI libraries 2026](https://www.greatfrontend.com/blog/top-headless-ui-libraries-for-react-in-2026)
- [Tailwind Variants](https://www.tailwind-variants.org/) · [Comparación cva vs tailwind-variants](https://www.tailwind-variants.org/docs/comparison)
- [Container queries en Tailwind](https://kickstage.com/blog/component-first-responsive-design-container-queries-tailwind-v4) · [Fluid for Tailwind](https://fluid.tw/) · [Utopia](https://utopia.fyi/)
- [Accesibilidad gob.mx](https://www.gob.mx/accesibilidad) · [WCAG mobile requirements 2026](https://www.accessitool.com/blog/wcag-mobile-requirements-complete-guide-app-web-developers-2026)
