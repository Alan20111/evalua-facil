# Plan de componentización — librería reutilizable + monolitos divididos

> Objetivo: reorganizar `src/` en componentes aislados y reutilizables para que (a) el patrón de diseño y accesibilidad de `docs/DESIGN_SYSTEM.md` viva en un solo lugar en vez de repetirse copy-pasted, y (b) el trabajo futuro (mío, de subagentes, o del equipo) toque diffs chicos y aislados en vez de archivos de miles de líneas — menos contexto/tokens por tarea, menos riesgo de romper algo al tocarlo.
> Auditoría base: 2026-07-14 · Rama de trabajo: `main`
> **§7 (orquestación con subagentes) añadida tras validar el plan con un panel de 3 diseños de orquestación independientes + juicio adversarial.** Ese ejercicio corrigió un bug de gate en Etapa 1 y ajustó la línea base de lint (ver §7.6).

---

## 0. Diagnóstico (estado real, medido)

`src/**/*.jsx,js` = 29,330 líneas totales.

### 0.1 Monolitos (candidatos a dividir)

| Archivo | Líneas | % del total |
|---|---|---|
| `pages/teacher/SubjectPage.jsx` | 4464 | 15% |
| `pages/teacher/CalendarPage.jsx` | 2270 | 8% |
| `pages/teacher/ActivityPage.jsx` | 1679 | 6% |
| `components/EvaluacionManager.jsx` | 1562 | 5% |
| `components/EvaluacionEditor.jsx` | 1189 | 4% |
| `components/EFDateTimePicker.jsx` | 1172 | 4% |

Estos 6 archivos son **~42% del código de la app**. Los 3 primeros (todos en `pages/teacher/`) son los peores: un solo archivo mezcla layout de página, lógica de datos, y 5-10 modales/paneles que podrían vivir aislados.

### 0.2 Duplicación confirmada (no hay componentes compartidos, aunque `components/ui/` ya existe **vacía**)

| Patrón | Estado actual | Evidencia |
|---|---|---|
| Modal / backdrop | **Sin componente.** Patrón canónico documentado en DESIGN_SYSTEM §6.7 pero reimplementado a mano | 28 archivos con `fixed inset-0` desde cero; el wrapper `relative bg-surface-card w-full max-w-sm rounded-t-card...` está copy-pasteado literal en 8 lugares |
| Input / Select de texto | **Sin componente genérico** (solo selects de propósito único: IconSelect, PaletteSelect, etc.) | `<input>` crudo en 35 archivos, `<select>` crudo en 10; una misma cadena de clases Tailwind repetida 21 y 17 veces |
| Botón primario/secundario | **Sin componente**, pese a que DESIGN_SYSTEM §6.1 documenta 7 variantes canónicas | Combo `bg-accent hover:bg-accent-hover ... disabled:opacity-60` repetido en 15 archivos |
| Tabla | **Sin componente** | 7 archivos con `<table>` hecho a mano (rúbricas ×3, admin ×3, SubjectPage) |
| Toast | ✅ Ya centralizado (`Toast.jsx`, usado en 33 archivos) | — |
| Spinner | ✅ Ya centralizado (`Spinner.jsx`, usado en 36 archivos) | — |

**Lectura clave:** cada vez que alguien (yo, un subagente, o tú) toca un modal o un botón, tiene que releer y reproducir el patrón entero en vez de importar una pieza ya correcta — eso es tokens gastados de más y una superficie de regresión más grande (ya nos pasó: 3 soluciones distintas de backdrop convergieron en paralelo antes de normalizarse a mano).

### 0.3 Buenos ejemplos ya existentes (usar como plantilla)

`components/calendar/`, `components/rubrica/` y `components/agenda/` ya siguen el patrón "carpeta por feature, subcomponentes por responsabilidad". La división de los 3 monolitos (§3) debe imitar esta forma, no inventar una nueva.

---

## 1. Estructura objetivo

```
src/
  components/
    ui/                    ← NUEVO: librería compartida, sin lógica de negocio
      Button.jsx
      Input.jsx
      Select.jsx
      Modal.jsx             (envuelve el patrón canónico §6.7 — backdrop-button real, sin role="presentation")
      Table.jsx
      index.js               (barrel export opcional, evaluar si conviene)
    calendar/               ← ya existe, sin cambios de fondo
    rubrica/                ← ya existe, sin cambios de fondo
    agenda/                 ← ya existe, sin cambios de fondo
    subject/                ← NUEVO: lo que hoy vive todo en pages/teacher/SubjectPage.jsx
    activity/               ← NUEVO: lo que hoy vive todo en pages/teacher/ActivityPage.jsx
    ... (resto de components/ sueltos, sin tocar salvo que Etapas 2-3 los migren a ui/)
  hooks/
    usePlanteles.js         ← movido desde data/ (es un hook, no debería vivir en data/)
    ... (resto sin cambios)
  utils/
    date/                   ← NUEVO: agrupar utils de fecha/calendario
    export/                 ← NUEVO: agrupar pdf/excel/export
    firebase/                ← NUEVO: agrupar cloudinary/notifications/etc. si aplica
    ... (evaluar caso por caso en Etapa 5, no mover todo a ciegas)
```

No se crea una carpeta `data/` residual: su único archivo (`usePlanteles.js`) es un hook y se mueve a `hooks/`.

---

## 2. Principio rector (para no romper el patrón de diseño al reorganizar)

Cada componente nuevo en `ui/` se construye **extrayendo exactamente lo que ya está auditado y documentado en `docs/DESIGN_SYSTEM.md`** — no se inventa un estilo nuevo, no se "mejora" nada de paso. La forma de verificar cada extracción:

1. Tomar la implementación *mayoritaria* actual (la variante que más se repite) como base literal.
2. Confirmar contra `docs/DESIGN_SYSTEM.md` §6 que coincide con el patrón canónico documentado (si no coincide, ese es justo el hueco que el componente cierra).
3. El componente nuevo debe soportar, vía props, TODAS las variantes que hoy existen dispersas (ej. `Button` con `variant="primary"|"secondary"|"danger"|"icon"`, no solo el caso más común) — si una variante legítima queda fuera, un archivo migrado se ve distinto y eso es exactamente la regresión que este plan busca evitar.
4. `scripts/check-ui-standards.sh` se extiende (Etapa 6) para detectar cuando código nuevo reintroduce un patrón ad hoc en vez de usar el componente — así el candado cubre esto igual que ya cubre azul-duro/focus-visible/etc.

---

## 3. Etapas

Cada etapa es su propio PR contra `main`, con el mismo gate de siempre: `npm run build` limpio, `npm run lint` sin subir el conteo (203 hoy), `npm run check:design` en 0, y para cambios visuales, verificación en navegador antes de pedir merge.

### Etapa 0 — Fundar `components/ui/` (Button, Input, Select, Modal, Table)

Construir los 5 componentes base descritos en §1-§2, **sin migrar ningún uso todavía** — solo que existan, documentados con un comentario corto de sus props, y probados en aislamiento (una página de prueba o Storybook-lite no es necesario; basta con usarlos en 1 sitio real de bajo riesgo para confirmar que se ven idénticos al patrón actual).

Candidato de bajo riesgo para la primera migración real: `Login.jsx`/`Register.jsx`/`ResetPassword.jsx` (páginas de auth, pequeñas, ya reconocidas como "reasonably sized" en la auditoría) — sirven de prueba de fuego para `Input`/`Button` antes de tocar nada grande.

**Por qué primero:** todo lo demás (Etapas 1-4) depende de que estos componentes existan y sean confiables. Hacerlo al final significaría reescribir código migrado dos veces.

### Etapa 1 — Migrar modales ad hoc → `<Modal>`

Los ~29 archivos con `fixed inset-0` identificados en §0.2, en lotes por carpeta.

**⚠ Corrección al gate (encontrada al validar el plan con subagentes — ver §7):** el gate NO puede ser "0 apariciones de `fixed inset-0` fuera de `ui/Modal.jsx`" — eso romperría con los overlays de pantalla completa que son legítimos y **no** se migran a `<Modal>`: `Layout`, `StudentLayout`, `AdminLayout` (drawers móviles), `Fireworks` y `ZoomableImage` (overlays no-modal), `EvaluacionEditor`, `EvaluacionManager`, `EntregableEditor`, `EvaluacionRunner` (editores/runner a pantalla completa, §6.7/§6.11), y `ProgramarZonaSemanal`/`ProgramarBloquesModal`/`BloqueEditor` (§6.13 — prohibido reintroducir backdrop en el shell; **pero sus popovers internos sí usan el backdrop canónico y sí migran**). El gate correcto es una **allowlist**: `fixed inset-0` permitido solo en `ui/Modal.jsx` **más** esa lista explícita de fullscreen; el grep de cierre resta la allowlist y debe dar 0. La clasificación migrar-vs-saltar la hace el orquestador **antes** de repartir, escrita en el manifiesto — nunca al criterio del subagente (es justo el modo de fallo que causó las 3 soluciones divergentes).

### Etapa 2 — Migrar inputs/selects/botones ad hoc → `<Input>`/`<Select>`/`<Button>`

Mismo enfoque por lotes. Alto volumen (35+10+15 archivos) pero cada cambio es mecánico y de bajo riesgo visual si Etapa 0 se hizo bien.

### Etapa 3 — Migrar tablas ad hoc → `<Table>`

Los 7 archivos de §0.2. Menor volumen, pero las tablas de rúbricas y admin tienen comportamiento propio (edición inline, ordenamiento) — validar que `<Table>` soporte slots/render-props para eso en vez de forzar una API demasiado rígida.

### Etapa 4 — Dividir los 3 monolitos de `pages/teacher/`

Con `ui/` ya poblada (Etapas 0-3), dividir `SubjectPage.jsx`, `CalendarPage.jsx`, `ActivityPage.jsx` sale más barato: cada modal/tabla/input que se extrae a su propio archivo YA usa los componentes compartidos, así que el archivo resultante es más corto de lo que sería si se dividiera antes de tener `ui/`.

Patrón de división (igual que `components/calendar/`): el archivo de página queda como orquestador delgado (data fetching + routing de estado), y cada bloque grande de UI se mueve a `components/subject/` o `components/activity/` como componente propio con sus props explícitas.

Este es el paso de mayor riesgo del plan (archivos de 1600-4500 líneas con lógica de negocio entrelazada) — ejecutar con subagentes en **aislamiento de worktree** (cada archivo grande a un agente distinto, sin pisarse), y verificación manual en navegador del flujo completo de esa página antes de dar por cerrada la sub-etapa.

### Etapa 5 — Reorganizar `utils/` (33 archivos) y mover `data/usePlanteles.js` → `hooks/`

Agrupar por dominio (fecha/calendario, export pdf/excel, firebase/cloudinary, etc.) solo donde la agrupación sea obvia — no forzar subcarpetas de 1-2 archivos. Actualizar imports en consecuencia (mecánico, alto volumen de archivos tocados pero bajo riesgo).

### Etapa 6 — Candado anti-regresión ampliado + cierre

Extender `scripts/check-ui-standards.sh` con greps que detecten:
- `fixed inset-0` fuera de `ui/Modal.jsx` **y de la allowlist de fullscreen** (ver corrección en Etapa 1 y §7)
- Clases de botón/input repetidas fuera de `ui/`

Actualizar `docs/DESIGN_SYSTEM.md` para que cada patrón de §6 apunte al componente real (`ui/Button.jsx`, etc.) en vez de solo describir clases Tailwind sueltas.

---

## 4. Orden y dependencias

```
Etapa 0 (fundación, 1 agente serial) → OLA DE MIGRACIÓN (Etapas 1+2+3 COLAPSADAS por archivo, ~agentes en paralelo)
                                     → Etapa 4 (depende de 0-3, la más riesgosa, 3 agentes 1-por-monolito)
Etapa 5 (VENTANA EXCLUSIVA, 1 agente, NO concurrente con nada — reescritura de imports app-wide)
Etapa 6 (cierre, serial, último — depende de que 0-5 estén en main)
```

**⚠ Corrección importante (de §7):** la versión original de este bloque decía "Etapas 1, 2, 3 pueden correr en paralelo entre sí" y "Etapa 5 en cualquier momento". Ambas son **incorrectas** y se corrigen en §7:
- Las Etapas 1/2/3 **no** se paralelizan por tipo de patrón: `SubjectPage`, un montón de modales y varios archivos contienen modal + input + botón + tabla **a la vez**, así que 3 agentes por-tipo colisionarían sobre el mismo archivo (justo el modo de fallo de las 3 soluciones divergentes). Se colapsan en una sola **Ola de migración** particionada **por archivo** (§7.2).
- La Etapa 5 reescribe imports en todo el árbol (`subjectName` toca 17 archivos, etc.) → colisiona con **cualquier** rama en vuelo. Va en **ventana exclusiva**, no en paralelo.

## 5. Riesgos a vigilar

- **Migración mecánica que cambia el pixel:** cada migración a `ui/` debe verse *idéntica* al original — si no, es una regresión visual disfrazada de refactor. Verificar con captura de pantalla antes/después en los casos de mayor tráfico (dashboard, login).
- **Sobre-genericidad:** si `<Input>`/`<Button>` terminan con 15 props para cubrir cada caso, se volvieron tan complejos como no tenerlos. Preferir 2-3 componentes con variantes claras sobre 1 componente que lo hace todo.
- **Etapa 4 es la única que toca lógica de negocio real**, no solo presentación — ahí sí vale la pena ir más despacio, con revisión de diff más cuidadosa que en las demás etapas.

---

## 6. Qué NO cubre este plan

- No cambia ningún token de color/tipografía/espaciado — eso ya está resuelto en `docs/PLAN_UNIFICACION_MAIN.md` (Etapas 0-4, cerrado jul-2026).
- No es un rediseño visual. Cero cambios de UX/UI intencionales — es exclusivamente reorganización de código y extracción de componentes ya-auditados.
- No incluye tests automatizados (el proyecto no tiene suite de tests — fuera de alcance de este plan).

---

## 7. Orquestación con subagentes

> Esta sección define **cómo** ejecutar las etapas de §3 con subagentes. Se derivó comparando 3 diseños de orquestación independientes (seguridad-primero, throughput-primero, descomposición-por-riesgo), puntuándolos, y sometiendo al ganador a una revisión adversarial. El ganador fue **sharding por propiedad de archivo**; las debilidades que encontraron los jueces están incorporadas como blindajes en §7.5.

### 7.1 Tesis central: partición por archivo, no por tipo de patrón

La lectura ingenua de §3 ("Etapas 1/2/3 en paralelo") **falla**: los archivos grandes y muchos modales contienen modal + input + botón + tabla **a la vez**. Paralelizar *por tipo de patrón* mete 3 agentes distintos al mismo archivo → conflicto de merge y, peor, tres criterios distintos sobre el mismo código (el modo de fallo que ya produjo 3 soluciones de backdrop divergentes).

La inversión correcta: **cada agente es dueño de un conjunto DISJUNTO de archivos** y aplica dentro de ellos *todas* las migraciones aplicables (modal + input + botón + tabla), en su propio worktree/branch/PR. Cero solapamiento de archivos ⇒ cero conflicto entre agentes ⇒ paralelismo real y, de paso, más seguro. Consecuencia: las Etapas 1, 2 y 3 se **colapsan en una sola "Ola de migración"** particionada por archivo — cada archivo se abre **una vez**, no tres (ahorro directo de tokens).

### 7.2 El "recipe card" y el manifiesto (trabajo del orquestador ANTES de repartir)

El orquestador (yo, en el hilo principal) paga **una sola vez** el costo caro de escanear el árbol y produce dos artefactos que cada subagente recibe listos:

1. **Recipe card** — extraído una vez de `DESIGN_SYSTEM.md` §6.1/§6.2/§6.6/§6.7: los strings de clase canónicos y el mapeo literal *ad-hoc → prop* (ej. `bg-accent hover:bg-accent-hover … disabled:opacity-60` → `<Button variant="primary">`). Con esto **ningún agente re-deriva el patrón** — ataca directo el gasto de §0.2.
2. **Manifiesto** — la asignación `archivo → shard`, con la clasificación migrar-vs-saltar ya resuelta (incluida la allowlist de fullscreen de Etapa 1). Partición **exhaustiva y verificable**: la unión de las listas de todos los shards DEBE ser igual al conjunto objetivo (así se mata el bug de "5 archivos sin dueño"). Los conteos se **regeneran con grep en el momento de ejecutar**, no se copian del texto de este plan (los números envejecen — ver §7.6).

Cada subagente recibe SOLO: su lista de archivos (su shard) + el recipe card + el fragmento §6 relevante. Nunca el repo entero, ni el `DESIGN_SYSTEM` entero, ni este plan entero.

### 7.3 Reglas duras para TODO subagente (van literales en cada prompt)

1. **CERO `git stash` / `stash pop` / `git reset --hard` / `git checkout --` sobre archivos ajenos.** Es la causa raíz del borrado de 5 archivos que ya ocurrió. Los estados intermedios se guardan SOLO con commits en tu propia branch/worktree. Si necesitas limpiar, haz commit o descarta con `git checkout -- <archivo-tuyo>` explícito y nominal.
2. **Un agente = un worktree = una branch = un conjunto DISJUNTO de archivos.** NUNCA edites un archivo fuera de tu lista. Si crees que necesitas tocar uno ajeno, **PARA y reporta** al orquestador (casi siempre es un archivo mal clasificado).
3. **NO inventes variantes ni "mejoras".** Transcribe LITERAL los strings/props del recipe card. Si un caso real no encaja en ninguna receta, **PARA y reporta** — no improvises una tercera solución.
4. **Cero cambios de comportamiento, UX o pixeles.** Es refactor idéntico. Si el render o la lógica cambian, es una regresión disfrazada: revierte.
5. **Rebase sobre `origin/main` fresco JUSTO antes de abrir el PR** (el usuario fusiona sus propios PRs a main en paralelo). Conflictos se resuelven con rebase/merge normal dentro del worktree, jamás con stash.
6. **Nunca commit directo a main; siempre PR. No fusiones tu propio PR** — el orquestador fusiona tras pasar los gates.
7. **No toques `node_modules`, `dist`, `package-lock` ni agregues dependencias.** `ui/` usa solo lo ya instalado (si hace falta un helper `cn`, es un archivo local de 3 líneas, sin dep nueva).
8. **En el mensaje final:** reporta rutas absolutas de archivos tocados, la branch/PR, y la salida del grep de cierre de tu shard. No escribas archivos `.md` de reporte.

### 7.4 Orquestación etapa por etapa

| Etapa | Agentes | Aislamiento | Nota de orquestación |
|---|---|---|---|
| **0 — Fundar `ui/`** | **1 agente** (serial, bloquea todo) | worktree propio | Un solo autor para los 5 componentes: comparten vocabulario (`cn()`, escala size/variant, merge de className, `forwardRef`). Cinco agentes divergirían en el contrato sobre el que se construye TODO lo demás. Prueba de fuego: migrar las 3 páginas de auth (chicas). **Merge a main = el gate que abre la Ola.** |
| **Ola (1+2+3)** | **~8-10 agentes** concurrentes, 1 PR c/u | **worktree OBLIGATORIO** por agente | Shards cohesivos por carpeta/feature, disjuntos por archivo. Cada agente migra modal+input+botón+tabla de SUS archivos. Los 3 monolitos quedan **fuera** (van a Etapa 4). |
| **4 — Monolitos** | **3 agentes** (1 por monolito) | **worktree estricto** por monolito | `SubjectPage`/`CalendarPage`/`ActivityPage` son disjuntos entre sí ⇒ paralelo seguro a nivel de archivo. Pero **dentro** de cada monolito la extracción es **secuencial** (un sub-componente por commit, build tras cada uno) — todas las extracciones editan el mismo shell. La migración a `ui/` de estos archivos ocurre **aquí**, en un solo pase (no se pasa dos veces por los archivos de 2000-4500 líneas). |
| **5 — utils/** | **1 agente** | worktree propio, **ventana exclusiva** | Reescritura de imports app-wide → NO concurrente con nada. `npm run build` de Vite es su gate fuerte (un import roto revienta el build). Elegir un momento de baja actividad de PRs del usuario. |
| **6 — Candado** | **1 agente** (serial, último) | worktree propio | Los greps deben reflejar el estado FINAL de main. Prueba del candado: introducir una violación a propósito y confirmar que el script sale con código 1; revertir. |

### 7.5 Blindajes anti-race-condition (de la revisión adversarial)

Los jueces del panel encontraron estos huecos en el diseño ganador; van resueltos así:

- **Shards dimensionados por LÍNEAS, no por conteo de archivos.** `EvaluacionManager` (1568), `EvaluacionEditor` (1194) y `EFDateTimePicker` (1185) **no** son monolitos de Etapa 4 pero son enormes — migrar un modal dentro de 1568 líneas no equivale a 6 archivos de 150. Cada uno de estos 3 va como **shard de un solo archivo** para su propio agente; los shards "normales" agrupan archivos chicos hasta un presupuesto de líneas parecido, no "4-6 archivos" a ciegas.
- **La allowlist de fullscreen se regenera con grep en ejecución**, no se copia de memoria (la lista nombrada aquí y en Etapa 1 puede estar incompleta — el grep real dio 29 archivos). El orquestador clasifica los 29 uno por uno antes de repartir.
- **`check:design` se extiende ANTES de la Ola, no en Etapa 6.** Si el grep que enforcea la migración se agrega hasta el final, un PR de la Ola pasa `check:design` aunque deje un modal a medio migrar — el gate por-PR no gatearía el trabajo propio de la Ola. Se añade el grep de cierre (allowlist de modales + combos de botón/input) al arrancar, para que cada PR de la Ola lo respete. Etapa 6 solo lo formaliza y prueba.
- **Cache de Vite por worktree.** `node_modules` compartido por symlink entre worktrees comparte también `node_modules/.vite`; N builds concurrentes pueden corromperlo. Cada worktree usa su propio `cacheDir` (o build con cache deshabilitado).
- **Re-grep de main en CADA rebase, no solo al cortar el shard.** El usuario mergea PRs durante la ejecución que pueden introducir nuevos `fixed inset-0`/`<input>` fuera de todo manifiesto. Antes de cada merge, el orquestador re-corre el grep de cierre sobre main vivo, no solo al inicio.
- **Fusionar en lotes chicos y pronto**, a medida que cada PR queda verde — no acumular 10 PRs para el final. El cuello de botella real de throughput es la **serialización de merges** (cada merge deja stale a los demás y exige rebase), no el número de agentes. Por eso el tope práctico es ~8-10, no "cuantos más mejor".

### 7.6 Línea base de lint: medir en vivo, no hardcodear

El plan original arrastraba "lint ≤ 203" heredado de sesiones previas. **Medido hoy sobre `main` fresco: 190 problemas (181 errores + 9 warnings).** El "203" era de ramas de feature desactualizadas. Lección: el gate de lint se **re-mide en el HEAD de cada branch al empezar** y no debe subir respecto a ESE número — nunca contra una constante hardcodeada (que envejece en cuanto el usuario mergea un PR). Lo mismo aplica a todos los conteos de este plan (tamaños de archivo, número de `<input>`, etc.): son fotos del 2026-07-14, se regeneran con grep al ejecutar.

### 7.7 Qué hace el orquestador vs. qué hace cada subagente

- **Orquestador (hilo principal):** escanea el árbol una vez, produce recipe card + manifiesto + allowlist, despacha los agentes, corre los gates automáticos (`build`/`lint`/`check:design`/greps de cierre), hace la verificación en navegador de las superficies de alto tráfico y de TODA la Etapa 4, rebasa y fusiona los PRs uno por uno, y re-grepea main entre merges. **No** lee el diff completo de cada PR de la Ola — confía en los gates automáticos + spot-checks (excepto Etapa 4, donde sí revisa diff a fondo).
- **Subagente:** recibe su shard + recipe + §6 relevante; migra solo sus archivos; corre sus gates locales; rebasa; abre PR; reporta rutas absolutas + salida de grep. Nunca fusiona, nunca toca archivos ajenos, nunca usa stash.
