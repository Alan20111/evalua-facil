# PLAN — Unificación del patrón de diseño sobre `main`

> **Documento de orquestación para Sonnet + subagentes.** La rama `test` ya ejecutó una estandarización completa (Etapa A, PR #188) pero `main` divergió antes con **60 commits propios** (rúbricas, evaluaciones, programación de bloques de calendario) que tocan los mismos archivos. **NO se hace merge de git `test→main`** — chocaría y pisaría trabajo. Se **re-aplica** la estandarización sobre el código real de `main`. De aquí en adelante todo el trabajo de diseño vive en `main` (vía feature branches + PR, nunca commit directo). La rama `test` queda congelada como referencia.

## Contexto — qué pasó y por qué este plan

- En `test` se ejecutaron las 5 fases de `PLAN_ESTANDARIZACION_UI.md` con subagentes (commits `61e8401`, `dd762bf`, `7c6e9a4`, `ca9d914`, `e15f887`, fusionados en PR #188). Resultado: lint 370→211, jsx-a11y 181→22 justificadas.
- `main` siguió su propio camino con features nuevas. **Diagnóstico real sobre `main` (2026-07-12):**

| Deuda | Estado en `main` | Equivalente que se corrigió en `test` |
|---|---|---|
| `bg-blue-600` hardcodeado | **15 archivos** (mismos que test: auth completo, Dashboard, Profile, Admin, modales) | Fase 3 |
| `focus:ring-2` sin `focus-visible` | **81 casos** (test tenía 74 — el código nuevo repitió el patrón) | Fase 4 |
| `disabled:opacity-{20,30,40,50}` | **37 casos** fuera del estándar 60/40 | Fase 4 |
| `fontSize:` inline en px | `EFDateTimePicker.jsx` intacto + `VisibilitySelect.jsx` | Fase 1 |
| Anchos alumno sin constante | `max-w-xl`/`2xl` sueltos (verificar — main pudo cambiarlos) | Fase 2 |
| jsx-a11y | **231 violaciones** (medido en Etapa 0, ver abajo) — test tenía 181 | Fase 5 + Etapa 0 |
| **Componentes nuevos sin estandarizar** | `rubrica/` (4 archivos), `calendar/ProgramarBloquesModal|ProgramarZonaSemanal|BloqueEditor`, `EvaluacionAnswerList`, `EvaluacionStatsPanel`, `PublicacionScheduler` | **Sin equivalente — trabajo nuevo** |

- Los documentos fuente (`DESIGN_SYSTEM.md`, `PLAN_ESTANDARIZACION_UI.md`, `PLAN_MAESTRO_UI_MOVIL_PUSH.md`) tampoco existían en `main` — portados en Etapa 0.

## ✅ Línea base de `main` — medida en Etapa 0 (2026-07-12)

Tras portar los guardrails de ESLint (`eslint-plugin-jsx-a11y` + `eslint-plugin-react`, mismo patch que `test` commit `9561f3d`, instalado con `--legacy-peer-deps`, `settings.react.version` fijado a mano):

- **`npm run lint` total: 411 problemas** (402 errores, 9 warnings). Este es el número que las Etapas 1-3 deben bajar, nunca subir, fase por fase.
- **`npm run build`: limpio.**

### jsx-a11y: 231 violaciones totales (desglose por regla)

| Regla | Casos |
|---|---|
| `click-events-have-key-events` | 75 |
| `no-static-element-interactions` | 73 |
| `label-has-associated-control` | 51 |
| `no-autofocus` | 26 |
| `aria-role` | 4 |
| `mouse-events-have-key-events` | 1 |
| `interactive-supports-focus` | 1 |

### jsx-a11y: por archivo (gobierna el reparto de subagentes en la Etapa 2)

| Archivo | Casos | Nota |
|---|---|---|
| `src/pages/teacher/SubjectPage.jsx` | 80 | Igual que en test — agente dedicado exclusivo |
| `src/pages/teacher/CalendarPage.jsx` | 25 | **Creció mucho vs test (tenía 2)** — el rediseño de calendario agregó interacciones nuevas sin cuidar teclado/labels; candidato a agente dedicado |
| `src/components/calendar/ProgramarZonaSemanal.jsx` | 18 | Componente nuevo (Etapa 3), pero su jsx-a11y se puede resolver junto con el resto de calendario en Etapa 2 si el tiempo lo permite — decidir al llegar |
| `src/components/calendar/EventEditor.jsx` | 8 |  |
| `src/pages/teacher/Dashboard.jsx` | 7 |  |
| `src/pages/student/Activation.jsx` | 7 |  |
| `src/components/EvaluacionManager.jsx` | 7 |  |
| `src/pages/teacher/Profile.jsx` | 6 |  |
| `src/components/EvaluacionEditor.jsx` | 6 |  |
| `src/pages/admin/components/SubscriptionsTable.jsx` | 5 |  |
| `src/pages/student/Login.jsx` | 4 |  |
| `src/components/calendar/ProgramarBloquesModal.jsx` | 4 | Componente nuevo |
| `src/components/calendar/BloqueEditor.jsx` | 4 | Componente nuevo |
| `src/components/NuevaFechaEntregaModal.jsx` | 4 |  |
| `src/components/LinkAccountModal.jsx` | 4 |  |
| `src/components/CheckoutModal.jsx` | 4 |  |
| `src/pages/teacher/ResetPassword.jsx` | 3 |  |
| `src/pages/teacher/Register.jsx` | 3 |  |
| `src/pages/student/Dashboard.jsx` | 3 |  |
| `src/components/VisibilitySelect.jsx` | 3 |  |
| `src/components/EFDateTimePicker.jsx` | 3 |  |
| `src/pages/teacher/ProtectAccount.jsx` | 2 |  |
| `src/pages/teacher/Onboarding.jsx` | 2 |  |
| `src/pages/teacher/Login.jsx` | 2 |  |
| `src/pages/teacher/ActivityPage.jsx` | 2 |  |
| `src/components/rubrica/RubricaEditor.jsx` | 2 | Componente nuevo |
| `src/components/StudentLayout.jsx` | 2 |  |
| `src/components/Layout.jsx` | 2 |  |
| `src/components/FileDropzone.jsx` | 2 |  |
| `src/components/EntregableEditor.jsx` | 2 |  |
| `src/components/AttachmentList.jsx` | 2 |  |
| `src/components/AdminLayout.jsx` | 2 |  |
| `src/components/FileTypeSelect.jsx` | 1 |  |

**Diferencia clave vs el diagnóstico de `test`:** `CalendarPage.jsx` pasó de 2 a 25 violaciones — el rediseño de la zona de programación de bloques agregó muchas celdas/controles clicables nuevos sin soporte de teclado. La Etapa 2 debe tratar `CalendarPage.jsx` con el mismo cuidado que `SubjectPage.jsx` (posible agente dedicado, a decidir según el desglose real de reglas cuando se ejecute esa etapa).

## Reglas de orquestación (idénticas a la Etapa A de test — funcionaron)

1. **Git:** una rama `fix/`|`chore/` por etapa desde `main`, PR a `main`. Nunca commit directo.
2. **Gate por fase:** `npm run build` limpio + conteo de `npm run lint` menor o igual al de la fase anterior (anotarlo en el commit). Los errores preexistentes de `api/`/`seeds-db/` no cuentan.
3. **Subagentes con archivos disjuntos** — nunca dos agentes en el mismo archivo. Los archivos gigantes (`SubjectPage.jsx`, `ActivityPage.jsx`, y ahora probablemente `RubricaEditor.jsx`/`ProgramarZonaSemanal.jsx`) reciben agente dedicado exclusivo que aplica TODOS los sub-puntos de su fase en ese archivo.
4. **Lecciones de la Etapa A (obligatorias):**
   - Prohibir a los subagentes usar `git stash` (en test un stash de un agente borró el trabajo de otro; se recuperó, pero fue el mayor riesgo de toda la ejecución). Los agentes solo hacen `git add` de SUS archivos.
   - Definir el patrón técnico ANTES de despachar, no después: en test, 8 agentes inventaron 3 soluciones distintas para el backdrop de modal y hubo que normalizar a mano. El patrón canónico ya está decidido — incluirlo en cada prompt (ver §Patrones).
   - El orquestador revisa el diff de cada agente antes de integrar; commit único por fase.
5. **⛔ PREGUNTA:** si algo no está cubierto por `DESIGN_SYSTEM.md`, preguntar al usuario, no improvisar.

## Patrones canónicos ya decididos (no re-deliberar, copiar a los prompts)

- **Backdrop de modal clicable-para-cerrar:** `<button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={...} aria-label="Cerrar" />` como hermano del panel (`relative`), nunca `<div onClick>`, nunca `aria-hidden`, nunca `role="presentation"`.
- **Falso positivo `jsx-a11y/aria-role` en `<PortalBadge role=...>`:** `eslint-disable-next-line` con comentario explicativo (la prop no es ARIA).
- **`disabled:opacity`:** 60 general / 40 solo icon-buttons de toolbar.
- **Hover:** `--accent-tint` superficies (filas/celdas/listas) / `--accent-medium` controles (botones/tabs/icon-buttons).
- **`focus:ring-2` → `focus-visible:ring-2`** (dejar `focus:outline-none` y `focus:border-transparent` intactos).
- **PortalBadge** = `bg-accent text-white` ambos roles (decisión del usuario). **Landing** conserva colores literales con comentario (sin data-role activo).
- **Tabs:** 2 variantes (segmented docente / underline alumno); selectores de opción tipo píldora = `border-accent bg-accent-light text-accent` activo.
- **autofocus:** caso por caso; mantener con comentario si es el primer campo de un form abierto con intención explícita; quitar si el modal se reabre repetidamente.
- **Labels sobre componentes compuestos sin `id`** (EFDateTimePicker, RichTextEditor, selects custom): convertir a `<p>`/`<span>`, o `<fieldset>/<legend>` para grupos de checkboxes.

---

## ETAPA 0 — Portar la infraestructura (1 agente, o el orquestador directo — es chico)

Rama: `chore/port-design-docs-lint`.

1. **Docs:** copiar desde `origin/test` → `docs/DESIGN_SYSTEM.md`, `docs/PLAN_ESTANDARIZACION_UI.md`, `docs/PLAN_MAESTRO_UI_MOVIL_PUSH.md` (`git checkout origin/test -- docs/DESIGN_SYSTEM.md ...`). Son archivos nuevos en main, sin conflicto posible.
2. **Guardrails ESLint:** portar el cambio de `eslint.config.js` + `package.json` del commit `9561f3d` de test (`eslint-plugin-jsx-a11y` + `eslint-plugin-react`). **Trampas conocidas:** instalar con `--legacy-peer-deps`; `settings.react.version: '19.2.6'` fijado A MANO (con `'detect'` crashea ESLint 10); `react/prop-types: 'off'`. Verificar que `eslint.config.js` de main no haya cambiado desde la divergencia antes de aplicar.
3. Correr `npx eslint . --format json` y **anotar la línea base de main** en este documento (total + desglose jsx-a11y por regla y archivo). Esa línea base gobierna los gates de las etapas siguientes.
4. Build + PR.

## ETAPA 1 — Re-aplicar Fases 1-4 sobre main (la parte mecánica)

Rama: `fix/estandarizacion-main-f1-f4`. Los hallazgos son casi idénticos a los de test, así que los prompts de agente de la Etapa A sirven casi textual — solo cambia que los diffs de test **sirven como referencia** (`git diff origin/test~N` de cada fase) pero NO se aplican con `git apply` a ciegas: cada agente edita el archivo real de main.

| Sub-lote | Contenido | Agentes |
|---|---|---|
| 1a | `EFDateTimePicker.jsx` fontSize→escala + `VisibilitySelect.jsx` (main tiene fontSize ahí también) | 1 |
| 1b | Anchos: verificar CalendarPage (main lo rediseñó — puede ya no usar `max-w-5xl`) y módulo alumno → constantes `STUDENT_CONTAINER(_NARROW)` en `config/layout.js` | 1 |
| 1c | Color blue→accent: mismos 15 archivos que test (auth ×7, Dashboard, Profile, Admin ×3, CheckoutModal, LinkAccountModal, Landing-comentario) + Spinner + PortalBadge + VerifyEmail SVG→lucide+emerald + orange→amber en ActivityPage alumno | 4 (grupos disjuntos) |
| 1d | `focus-visible` (81), `disabled:opacity` (37), hover-tint, inline styles, tabs | 4-5 (por archivo-exclusivo, NO por concepto — SubjectPage/ActivityPage dedicados) |

Gate: greps de cierre en 0 (`bg-blue-600`, `focus:ring-2\b`, `disabled:opacity-(20|30|50)`, `fontSize:` en picker) + build + lint no-creciente + PR.

## ETAPA 2 — Fase 5 (accesibilidad) sobre main

Rama: `fix/a11y-main`. Repartir según la línea base medida en Etapa 0 (los números cambiarán vs test porque hay código nuevo). Reglas de reparto de la Etapa A: `SubjectPage.jsx` dedicado; resto por módulo (~12-20 violaciones/agente); patrones canónicos en cada prompt; sin `eslint-disable` para click/static salvo el falso positivo documentado de PortalBadge.

Gate: jsx-a11y = 0 salvo `no-autofocus` justificados con comentario + navegación por teclado verificada en SubjectPage + PR.

## ETAPA 3 — Estandarizar los componentes NUEVOS de main (trabajo sin equivalente en test)

Rama: `fix/estandarizacion-modulos-nuevos`. Estos archivos nacieron después de la divergencia y nunca pasaron por ninguna fase:

- `src/components/rubrica/` — RubricaEditor, RubricaGradeTable, RubricaPicker, RubricaTable
- `src/components/calendar/` — ProgramarBloquesModal, ProgramarZonaSemanal, BloqueEditor, useAlarmas
- `src/components/` — EvaluacionAnswerList, EvaluacionStatsPanel, PublicacionScheduler

**3.1 — Auditoría dirigida (1 agente Explore, solo lectura):** producir tabla archivo:línea de TODA la deuda en estos ~11 archivos contra `DESIGN_SYSTEM.md`: colores hardcodeados fuera de tokens, fontSize/estilos inline, radios crudos, hover sin criterio, tabs no-estándar, modales que no siguen el patrón bottom-sheet/backdrop canónico, jsx-a11y (ya medido en Etapa 0), touch targets <44px, anchos inventados.

**3.2 — Corrección (2-3 agentes por grupos disjuntos):** aplicar los patrones canónicos según la tabla de 3.1. `RubricaEditor.jsx` y `ProgramarZonaSemanal.jsx` probablemente son grandes → candidatos a agente dedicado (verificar `wc -l` primero).

Gate: greps de cierre en 0 sobre estos archivos + build + lint + PR.

## ETAPA 4 — Cierre y verificación integral

1. QA visual con `npm run dev` (el orquestador tiene navegador integrado): Landing, Login ×2, y — con credenciales del usuario o preview de Vercel — Dashboard, SubjectPage, CalendarPage con la zona de programación de bloques abierta, editor de rúbricas, en 375/768/1440px.
2. Actualizar `DESIGN_SYSTEM.md`: marcar §10 resuelto para main + **documentar los componentes nuevos** (rúbricas, zona de bloques) como parte del inventario §6/§9.
3. Actualizar la memoria del proyecto: main es la rama de trabajo; test congelada.
4. Nota: como Vercel solo despliega `main` (`vercel.json` → `ignoreCommand`), **cada PR fusionado de este plan sale a producción de inmediato**. Por eso los gates por etapa no son opcionales — son la única red de seguridad. Si el usuario prefiere agrupar, se pueden acumular las etapas en una sola rama integradora y fusionar una vez, ⛔ PREGUNTA al llegar ahí.

## Presupuesto y secuencia

```
ETAPA 0 (chica, ~1 agente) → ETAPA 1 (la más grande, ~10 agentes en 2 tandas)
→ ETAPA 2 (~6-8 agentes) → ETAPA 3 (auditoría + 2-3 agentes) → ETAPA 4 (cierre)
```

Cada etapa es un PR independiente. Si el presupuesto de tokens se agota a mitad, lo entregado hasta esa etapa ya está en `main` completo y verificado, sin cabos sueltos. Prioridad si hay que recortar: Etapas 0+1 dan el 70% del valor visible (color, tipografía, foco); la 3 es la que evita que la deuda vuelva a crecer en el código nuevo.
