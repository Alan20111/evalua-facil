# PLAN — Íconos de la fila de actividad en Android (docente)

> **Documento de orquestación para Sonnet.** Ejecutar **una fase a la vez**, una rama/PR por fase. Cada fase debe poder ejecutarse leyendo **solo este documento** — un Sonnet fresco no necesita el resto de la conversación.

## Alcance confirmado con el usuario (no volver a preguntar)

Este cambio es **exclusivo de la app nativa de Android** (`Capacitor.isNativePlatform()` vía `IS_NATIVE_APP` en `src/utils/platform.js`). **La web no se toca en absoluto** — sigue exactamente igual que hoy.

1. **Quitar los 3 íconos con contador** ("Entregados"/"Calificados"/"Por calificar") de la fila de actividad, **solo en Android**, para las **4 categorías** de actividad (entregable, examen, cuestionario, observación) — todas comparten la misma fila.
2. **Reactivar en Android** (hoy ocultos ahí) los dos íconos de editar (lápiz):
   - El de la lista de actividades, a la derecha del ojito.
   - El del encabezado de "Evaluar"/"Evaluación" (`ActivityPage.jsx`), a la derecha del nombre de la actividad.
3. El **menú ⋮** (Duplicar/Eliminar) se queda **oculto en Android como ya está** — no se toca. Solo se separa del lápiz (hoy comparten un mismo `{!IS_NATIVE_APP && ...}`) para poder mostrar uno sin el otro.
4. El cálculo de los contadores (`submissionCounts`/`totalStudents`) **se deja intacto** — solo se oculta el JSX, no se toca el state ni el fetch. Es código que ya se calcula de datos que de todos modos se cargan; quitarlo no aporta rendimiento notable y sí agrega riesgo.
5. El toast "Edita este borrador desde la versión web" (al tocar la fila completa de un borrador en Android) **se deja intacto** — no fue pedido. El lápiz reactivado le da al docente un camino alterno que sí funciona en Android para ese caso, sin necesidad de tocar ese toast.

## Por qué esto es más que "ocultar 3 íconos": contexto importante

El commit `f445034` ("feat(docente): restringe la app nativa, sin afectar la web", del día anterior a este plan) **ya había ocultado deliberadamente** ambos lápices de editar en Android, junto con otras restricciones (ZIP, buscador, lista de alumnos, fechas de publicación, etc.) que **no se tocan en este plan** — solo se revierte la parte de "ocultar el lápiz" en los 2 lugares mencionados arriba. El resto de esa restricción de ayer queda como está.

---

## Estado real del código (verificado — reconfirmar líneas si se movieron)

### `src/pages/teacher/SubjectPage.jsx` — fila de actividad (dentro de `acts.map((a) => …)`, ~líneas 2245–2364)

```
Línea 2255        <div ...>                                    ← contenedor de toda la fila
Línea 2258-2266   <button onClick={...}>                       ← botón principal: ícono tipo + nombre + fechas
Línea 2261        if (!IS_NATIVE_APP) openEdit(...)             ← borrador: en Android muestra toast en vez de abrir editor (NO TOCAR — punto 5)
Línea 2306-2322   <div className="flex items-center gap-1 flex-shrink-0">   ← LOS 3 BADGES — este <div> completo se oculta en Android
Línea 2307-2311     Badge "Entregados" (FileCheck2)
Línea 2312-2316     Badge "Calificados" (CheckCircle)
Línea 2317-2321     Badge "Por calificar" (Timer)
Línea 2323        </button>                                     ← cierra el botón principal
Línea 2326-2344   Ícono ojito (Eye/EyeOff) — SIN TOCAR, ya se muestra igual en web y Android
Línea 2345        {/* Editar y el menú ⋮ (Duplicar/Eliminar): solo en la web */}
Línea 2346        {!IS_NATIVE_APP && (                           ← HOY: pencil Y ⋮ comparten este único gate
Línea 2348-2351     <button onClick={() => openEdit(...)}><Pencil/></button>   ← SEPARAR: debe mostrarse SIEMPRE (quitar el gate)
Línea 2353-2359     <button onClick={... setActivityMenu ...}><MoreVertical/></button>  ← SEPARAR: debe seguir con {!IS_NATIVE_APP && ...}
Línea 2361        )}
```

Import de íconos en la línea 22: `import { IS_NATIVE_APP } from '../../utils/platform'` — ya existe, no hay que agregarlo.

### `src/pages/teacher/ActivityPage.jsx` — encabezado de "Evaluar"/"Evaluación" (~líneas 745–768)

```
Línea 751   <p ...>Evaluar</p>                                  ← o "Evaluación" según tipo (ver línea 770 para el patrón de categoría)
Línea 753-756   <h1>{activityLabel} {activity?.nombre}</h1>
Línea 757-767   {!IS_NATIVE_APP && (                             ← QUITAR este gate (el botón debe mostrarse siempre)
Línea 758-766     <button onClick={() => setEditingActivity(true)}><Pencil/></button>
Línea 767   )}
```

---

## Reglas globales (iguales a los planes anteriores de este repo)

1. **Git:** una rama `feat/`/`fix/` **por fase** (nunca commit directo a `main`). Al cerrar: `npm run build` limpio → commit → push inmediato → `gh pr create` → merge → `git checkout main && git pull` → poll de deploy (`gh api repos/Alan20111/evalua-facil/commits/<HEAD>/status --jq '.state'` hasta `success`).
2. **Sin dependencias nuevas.** Son cambios de JSX puro (agregar/quitar/mover un `{condición && (...)}`).
3. **Gate por fase:** `npm run build` sin errores y `npx eslint <archivos tocados>` sin errores **nuevos** (filtrar baseline preexistente: `jsx-a11y/no-autofocus`, `react/no-unescaped-entities`, hoisting de `loadAll`, etc. — no "arreglarlos" aquí).
4. **Verificación — limitación importante:** `IS_NATIVE_APP` es `Capacitor.isNativePlatform()`, que **siempre es `false`** en cualquier navegador (dev server, Vercel, DevTools en modo móvil) — nunca se puede simular "Android nativo" desde el panel Browser. La verificación en navegador solo puede confirmar que **la web NO cambió** (los 3 badges y ambos lápices se siguen viendo igual que antes en cualquier viewport). El comportamiento en Android (badges ocultos, lápices visibles) **solo se puede confirmar en el dispositivo real o un emulador de Android Studio** — igual que con el botón físico de atrás en el plan anterior.
5. **Al final de cada fase:** `npm run build && npx cap sync android` para reflejar el cambio en la app Android compilable.

---

## FASE 1 — Quitar los 3 badges de conteo en Android

**Rama:** `feat/android-ocultar-badges-actividad`

**Alcance:** solo `src/pages/teacher/SubjectPage.jsx`.

**Cambio concreto:** envolver el `<div>` de los 3 badges (líneas 2306–2322) en `{!IS_NATIVE_APP && (...)}`, siguiendo el mismo patrón ya usado en el resto del archivo (ver línea 2278, 2281, etc.):

```jsx
{!IS_NATIVE_APP && (
  <div className="flex items-center gap-1 flex-shrink-0">
    <span data-tooltip="Entregados" ...>
      <FileCheck2 size={11} /> {counts.delivered}/{totalStudents}
    </span>
    <span data-tooltip="Calificados" ...>
      <CheckCircle size={11} /> {counts.graded}/{counts.delivered}
    </span>
    <span data-tooltip="Por calificar" ...>
      <Timer size={11} /> {counts.delivered - counts.graded}/{counts.delivered}
    </span>
  </div>
)}
```

No cambiar nada del contenido interno de los 3 `<span>` — solo agregar el gate alrededor del `<div>` padre. No tocar `submissionCounts`, `totalStudents`, ni el cálculo que los llena (~líneas 446–457). No tocar los imports de `FileCheck2`/`Timer`/`CheckCircle` (se siguen usando dentro del bloque, solo que ahora condicional).

**Verificación (navegador, obligatoria pero limitada — ver regla global 4):**
- Cargar `/subject/:id` como docente de prueba en el panel Browser (web) y confirmar que los 3 badges se siguen viendo exactamente igual que antes, en las 4 categorías de actividad presentes en la materia de prueba.
- Confirmar con `read_page`/`get_page_text` que el texto de los badges ("Entregados", tooltips) sigue presente en el DOM en web.

**Gate:** `npm run build` limpio, `npx eslint src/pages/teacher/SubjectPage.jsx` sin errores nuevos (comparar contra baseline con `git stash` si hay dudas). Commit → push → PR → merge → poll deploy → `npx cap sync android`.

---

## FASE 2 — Reactivar el ícono de editar en Android (2 archivos)

**Rama:** `feat/android-reactivar-editar-actividad`

**Alcance:** `src/pages/teacher/SubjectPage.jsx` y `src/pages/teacher/ActivityPage.jsx`.

### Cambio 1 — `SubjectPage.jsx` (líneas 2345–2361): separar el lápiz del menú ⋮

Hoy:
```jsx
{!IS_NATIVE_APP && (
  <>
    <button type="button" onClick={() => openEdit(a, activityLabelById[a.id])} aria-label="Editar" data-tooltip="Editar"
      className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0 mr-0.5">
      <Pencil size={16} />
    </button>
    {/* Less-used actions (Duplicar / Eliminar) tucked into a ⋮ menu */}
    <button type="button" onClick={(e) => {...}} aria-label="Más acciones" data-tooltip="Más acciones"
      className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0 mr-1">
      <MoreVertical size={16} />
    </button>
  </>
)}
```

Cambiar a — el lápiz **sin** gate (se muestra siempre), el ⋮ **mantiene** su gate:
```jsx
<button type="button" onClick={() => openEdit(a, activityLabelById[a.id])} aria-label="Editar" data-tooltip="Editar"
  className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0 mr-0.5">
  <Pencil size={16} />
</button>
{!IS_NATIVE_APP && (
  <button type="button" onClick={(e) => {...}} aria-label="Más acciones" data-tooltip="Más acciones"
    className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0 mr-1">
    <MoreVertical size={16} />
  </button>
)}
```

(El `{/* Editar y el menú ⋮ (Duplicar/Eliminar): solo en la web */}` de la línea 2345 debe actualizarse — ya no es preciso; cambiar el comentario a algo como `{/* El menú ⋮ (Duplicar/Eliminar) sigue solo en la web; el lápiz de editar ya se muestra también en Android */}`.)

### Cambio 2 — `ActivityPage.jsx` (líneas 757–767): quitar el gate del lápiz junto al nombre

Hoy:
```jsx
{!IS_NATIVE_APP && (
  <button type="button" onClick={() => setEditingActivity(true)} data-tooltip="Editar actividad" aria-label="Editar actividad"
    className="p-1 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
    <Pencil size={18} />
  </button>
)}
```

Cambiar a — sin gate, se muestra siempre:
```jsx
<button type="button" onClick={() => setEditingActivity(true)} data-tooltip="Editar actividad" aria-label="Editar actividad"
  className="p-1 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
  <Pencil size={18} />
</button>
```

Si tras este cambio `IS_NATIVE_APP` queda sin ningún otro uso en `ActivityPage.jsx`, **no** quitar el import — confirmar primero con `grep -n IS_NATIVE_APP` en el archivo, porque probablemente se siga usando en otros puntos de esa misma restricción de ayer (ZIP, buscador, lista de alumnos, etc., que no se tocan en este plan).

**Verificación (navegador, obligatoria pero limitada — ver regla global 4):**
- Confirmar en web que ambos lápices se siguen viendo y funcionando igual que antes (abren el editor correspondiente).
- Confirmar que el menú ⋮ se sigue viendo igual en web (no se rompió al separarlo del lápiz).
- No hay forma de confirmar en este entorno que el lápiz aparece en Android — dejar constancia explícita de esto en el mensaje final al usuario.

**Gate:** `npm run build` limpio, `npx eslint src/pages/teacher/SubjectPage.jsx src/pages/teacher/ActivityPage.jsx` sin errores nuevos. Commit → push → PR → merge → poll deploy → `npx cap sync android`.

---

## Criterios de aceptación globales

- [ ] En Android: la fila de actividad muestra ícono de tipo + nombre (con más espacio) + ojito + lápiz — sin los 3 badges de conteo, para las 4 categorías.
- [ ] En Android: el menú ⋮ (Duplicar/Eliminar) sigue oculto, sin cambios.
- [ ] En Android: el lápiz junto al nombre en "Evaluar"/"Evaluación" (ActivityPage) vuelve a aparecer y abre el editor.
- [ ] En web: absolutamente nada cambia — badges, lápices y menú ⋮ se ven y funcionan exactamente igual que hoy.
- [ ] Sin dependencias nuevas; build y lint limpios por fase; Android sincronizado (`npx cap sync android`) al cerrar cada fase.
- [ ] **QA manual del usuario en dispositivo Android real** (obligatorio, no simulable desde este entorno): confirmar los 4 puntos de arriba directamente en la app instalada.
