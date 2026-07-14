# Plan de componentización — librería reutilizable + monolitos divididos

> Objetivo: reorganizar `src/` en componentes aislados y reutilizables para que (a) el patrón de diseño y accesibilidad de `docs/DESIGN_SYSTEM.md` viva en un solo lugar en vez de repetirse copy-pasted, y (b) el trabajo futuro (mío, de subagentes, o del equipo) toque diffs chicos y aislados en vez de archivos de miles de líneas — menos contexto/tokens por tarea, menos riesgo de romper algo al tocarlo.
> Auditoría base: 2026-07-14 · Rama de trabajo: `main`

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

Los 28 archivos identificados en §0.2, en lotes por carpeta (primero `components/` sueltos, luego `components/calendar/`, luego `components/rubrica/`, luego los de `pages/`). Cada lote es un sub-PR o un commit aislado dentro del mismo PR — decidir según tamaño real al ejecutar.

Gate específico: 0 apariciones de `fixed inset-0` fuera de `ui/Modal.jsx` al cerrar la etapa (grep de cierre, mismo estilo que los candados ya existentes).

### Etapa 2 — Migrar inputs/selects/botones ad hoc → `<Input>`/`<Select>`/`<Button>`

Mismo enfoque por lotes. Alto volumen (35+10+15 archivos) pero cada cambio es mecánico y de bajo riesgo visual si Etapa 0 se hizo bien.

### Etapa 3 — Migrar tablas ad hoc → `<Table>`

Los 7 archivos de §0.2. Menor volumen, pero las tablas de rúbricas y admin tienen comportamiento propio (edición inline, ordenamiento) — validar que `<Table>` soporte slots/render-props para eso en vez de forzar una API demasiado rígida.

### Etapa 4 — Dividir los 3 monolitos de `pages/teacher/`

Con `ui/` ya poblada (Etapas 0-3), dividir `SubjectPage.jsx`, `CalendarPage.jsx`, `ActivityPage.jsx` seyor barato: cada modal/tabla/input que se extrae a su propio archivo YA usa los componentes compartidos, así que el archivo resultante es más corto de lo que sería si se dividiera antes de tener `ui/`.

Patrón de división (igual que `components/calendar/`): el archivo de página queda como orquestador delgado (data fetching + routing de estado), y cada bloque grande de UI se mueve a `components/subject/` o `components/activity/` como componente propio con sus props explícitas.

Este es el paso de mayor riesgo del plan (archivos de 1600-4500 líneas con lógica de negocio entrelazada) — ejecutar con subagentes en **aislamiento de worktree** (cada archivo grande a un agente distinto, sin pisarse), y verificación manual en navegador del flujo completo de esa página antes de dar por cerrada la sub-etapa.

### Etapa 5 — Reorganizar `utils/` (33 archivos) y mover `data/usePlanteles.js` → `hooks/`

Agrupar por dominio (fecha/calendario, export pdf/excel, firebase/cloudinary, etc.) solo donde la agrupación sea obvia — no forzar subcarpetas de 1-2 archivos. Actualizar imports en consecuencia (mecánico, alto volumen de archivos tocados pero bajo riesgo).

### Etapa 6 — Candado anti-regresión ampliado + cierre

Extender `scripts/check-ui-standards.sh` con greps que detecten:
- `fixed inset-0` fuera de `ui/Modal.jsx`
- Clases de botón/input repetidas fuera de `ui/`

Actualizar `docs/DESIGN_SYSTEM.md` para que cada patrón de §6 apunte al componente real (`ui/Button.jsx`, etc.) en vez de solo describir clases Tailwind sueltas.

---

## 4. Orden y dependencias

```
Etapa 0 (fundación) → Etapa 1, 2, 3 (migraciones, pueden correr en paralelo entre sí una vez que 0 cierra)
                    → Etapa 4 (depende de 0-3 completas, es la más riesgosa)
Etapa 5 (independiente, puede correr en cualquier momento en paralelo con 1-4)
Etapa 6 (cierre, depende de todo lo anterior)
```

## 5. Riesgos a vigilar

- **Migración mecánica que cambia el pixel:** cada migración a `ui/` debe verse *idéntica* al original — si no, es una regresión visual disfrazada de refactor. Verificar con captura de pantalla antes/después en los casos de mayor tráfico (dashboard, login).
- **Sobre-genericidad:** si `<Input>`/`<Button>` terminan con 15 props para cubrir cada caso, se volvieron tan complejos como no tenerlos. Preferir 2-3 componentes con variantes claras sobre 1 componente que lo hace todo.
- **Etapa 4 es la única que toca lógica de negocio real**, no solo presentación — ahí sí vale la pena ir más despacio, con revisión de diff más cuidadosa que en las demás etapas.

---

## 6. Qué NO cubre este plan

- No cambia ningún token de color/tipografía/espaciado — eso ya está resuelto en `docs/PLAN_UNIFICACION_MAIN.md` (Etapas 0-4, cerrado jul-2026).
- No es un rediseño visual. Cero cambios de UX/UI intencionales — es exclusivamente reorganización de código y extracción de componentes ya-auditados.
- No incluye tests automatizados (el proyecto no tiene suite de tests — fuera de alcance de este plan).
