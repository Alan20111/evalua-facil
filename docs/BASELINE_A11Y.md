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
