# PLAN — Selector de fecha/hora, bloqueo de scroll de fondo y restricción de rúbricas en Android

> **Documento de orquestación para Sonnet.** Ejecutar **una fase a la vez**, una rama/PR por fase. Cada fase debe poder ejecutarse leyendo **solo este documento** — un Sonnet fresco no necesita el resto de la conversación.

## Decisiones ya confirmadas con el usuario (no volver a preguntar)

1. **Rúbricas:** se restringe **solo en Android** (la web queda exactamente igual). Se ocultan **crear, editar y borrar** — en Android solo queda disponible **usar una rúbrica ya existente** del banco (seleccionarla para una actividad).
2. **"Ventana de calendario" con esquinas/borde:** el usuario se refería al **popover de fecha/hora** (`EFDateTimePicker.jsx`), NO a la pantalla de "Horario" — esa ya se corrigió en una fase anterior y el código ya está bien (verificado, ver abajo); no se vuelve a tocar en este plan.
3. **Scroll de fondo:** se corrige en **todos los modales del repo** (~24-30 ventanas flotantes, docente y alumno), no solo en los 2 reportados — es un problema sistémico (ningún modal del repo bloquea hoy el scroll de fondo).
4. El popover `EFDateTimePicker.jsx` es un componente **compartido** entre la app del docente y la del alumno (no hay forma de diferenciarlo por rol sin duplicar el componente) — el ajuste de esquinas/borde y el `useScrollLock` que reciba aplican a **ambos roles**. Mismo criterio ya usado antes en este repo para este mismo componente (ancho del popover / tamaño de botones).

---

## Estado real del código (verificado — reconfirmar líneas si se movieron)

### 1. Rúbricas — dos botones de "crear", ambos comparten código web/app

- `src/components/rubrica/RubricaPicker.jsx:86-89` — botón **"Crear nueva rúbrica"** dentro de "Mi banco de rúbricas". `onClick={() => setEditing('new')}` → monta `RubricaEditor` con `initial={null}`.
- `src/components/rubrica/RubricaPicker.jsx` (~línea 124) — ícono de **lápiz "Editar"** sobre cada rúbrica del banco → monta `RubricaEditor` con esa rúbrica.
- `src/components/rubrica/RubricaPicker.jsx` (~línea 128) — ícono de **basura "Eliminar"** sobre cada rúbrica del banco.
- `src/components/EntregableEditor.jsx:344-347` — botón **"Crear rúbrica"** (atajo directo dentro del editor de un entregable, sin pasar por el picker). `onClick={() => setRubricaEditorOpen(true)}` → monta `RubricaEditor` con `initial={null}`; al guardar la asigna de inmediato a la actividad.
- `src/components/EntregableEditor.jsx:348` (aprox.) — botón **"Usar una rúbrica de mi banco"** → abre `RubricaPicker`. **Este se queda igual, no se toca** — es la única acción de rúbricas que debe seguir funcionando en Android.
- Ninguno de estos tres archivos (`RubricaPicker.jsx`, `RubricaEditor.jsx`, `EntregableEditor.jsx`) importa hoy `IS_NATIVE_APP` — hay que agregarlo.

### 2. Selector de fecha/hora — `EFDateTimePicker.jsx`

- `popoverStyle` (~línea 796-812): `borderRadius: 'var(--radius-card, 0.875rem)'` (≈12.6px reales con el 90% de zoom global) y `border: '1px solid var(--outline-variant)'` (`#c0c6d5`, gris muy pálido). Mismo problema que tenía "Horario" antes de corregirlo: esquinas muy redondeadas y borde casi imperceptible.
- Nota: `--radius-card`/`--outline-variant` son los tokens **compartidos** (no los `[data-role='docente']` que ya se usaron en "Horario" — ese contenedor no tiene `data-role` propio, hereda el que esté activo en la ruta). El ajuste aquí es directo en el `style` inline del componente, no vía clase Tailwind.

### 3. Scroll de fondo — problema sistémico confirmado

- **No existe ningún mecanismo de bloqueo de scroll del body/página en todo el repo** (confirmado por grep exhaustivo: cero referencias a `body.style.overflow`, `overscroll-behavior: contain`, o librerías de scroll-lock).
- `src/components/EFDateTimePicker.jsx`: se monta con `createPortal(..., document.body)` (línea ~852), **sin ningún backdrop** — el popover flota solo sobre la pantalla. Su body interno es `overflow-y-auto` (línea ~878) sin `overscroll-behavior`, así que al llegar al límite del scroll interno, el gesto se "encadena" y mueve la página de fondo.
- `src/components/calendar/EventEditor.jsx`: SÍ tiene backdrop (`<button className="absolute inset-0 bg-black/40 ..." onClick={onClose}>`, línea ~116), pero ese backdrop solo tiene `onClick` — nada evita que un `touchmove` sobre él (o sobre el propio modal) llegue al `body` de atrás.
- **Ningún modal del repo bloquea correctamente el scroll de fondo hoy** — no hay un patrón existente que copiar; hay que construir uno nuevo.
- Candidato de solución (técnica estándar de "body scroll lock", más confiable en WebView Android que `overflow: hidden` a secas): al abrir cualquier overlay, poner `document.body` en `position: fixed` (guardando el `scrollY` actual) y restaurarlo al cerrar. Como el body queda con `position: fixed`, físicamente no puede hacer scroll sin importar dónde ocurra el gesto — no hace falta agregarle backdrop con captura de touch a `EFDateTimePicker.jsx`, y el scroll **interno** de cada overlay (sus propios `overflow-y-auto`) sigue funcionando normal, sin tocarlo.
- Hay que soportar **overlays anidados** (por ejemplo: el date-picker se abre DESDE DENTRO de "Nuevo evento" — dos overlays abiertos a la vez) con un contador de referencias, para no restaurar el scroll de fondo de golpe cuando se cierra solo el de más arriba.

---

## Reglas globales (iguales a los planes anteriores de este repo)

1. **Git:** una rama `feat/`/`fix/` **por fase** (nunca commit directo a `main`). Al cerrar: `npm run build` limpio → commit → push inmediato → `gh pr create` → merge → `git checkout main && git pull` → poll de deploy (`gh api repos/Alan20111/evalua-facil/commits/<HEAD>/status --jq '.state'` hasta `success`).
2. **Sin dependencias nuevas.** El bloqueo de scroll se implementa con un hook propio (`position: fixed` + `window.scrollTo`), no con una librería externa.
3. **Gate por fase:** `npm run build` sin errores y `npx eslint <archivos tocados>` sin errores **nuevos** (comparar contra baseline con `git stash` si hay dudas — hay errores preexistentes conocidos: `jsx-a11y/no-autofocus`, `react/no-unescaped-entities`, hoisting de `loadAll`, etc. — no "arreglarlos" aquí).
4. **Verificación — limitaciones conocidas de este entorno:**
   - El ajuste de esquinas/borde del popover de fecha/hora **sí se puede verificar visualmente** en el panel Browser (no depende de `IS_NATIVE_APP` ni de safe-area).
   - El bloqueo de scroll de fondo **sí se puede verificar en el panel Browser** simulando touch/scroll — es lógica JS pura, no depende de Android nativo.
   - La restricción de rúbricas (`IS_NATIVE_APP`) **no se puede verificar visualmente** en este entorno (`IS_NATIVE_APP` siempre es `false` en navegador) — verificar por revisión de código + confirmar que la web no cambió.
5. **Datos de prueba:** prefijo `zztest-`/`ZZTEST`; borrar todo al terminar. No hacer wipes globales.
6. **Al final de cada fase:** `npm run build && npx cap sync android`.

---

## Estrategia de subagentes

- **Fase 3 (auditoría de modales):** 1 subagente `Explore` de solo lectura, que **debe escribir el archivo él mismo** (`docs/AUDITORIA_SCROLL_LOCK.md`) — si el subagente asignado no tiene herramienta `Write` disponible (ya pasó una vez en este repo), el orquestador debe pedirle el contenido completo en su respuesta y escribirlo él mismo, no perder el trabajo.
- **Fase 5 (rollout a todos los modales):** varios subagentes **en paralelo**, cada uno con un grupo de **archivos disjuntos** (nunca dos agentes tocando el mismo archivo a la vez) — mismo patrón ya usado en este repo para el rollout del botón atrás físico de Android.
- **Fases 1, 2 y 4:** sin subagentes — son cambios quirúrgicos en pocos archivos, mejor en el hilo principal.

---

## FASE 1 — Rúbricas: restringir crear/editar/borrar en Android

**Rama:** `fix/rubricas-restringir-android`

**Alcance:** `src/components/rubrica/RubricaPicker.jsx`, `src/components/EntregableEditor.jsx`.

**Cambios concretos:**
1. En ambos archivos, importar `IS_NATIVE_APP` desde `../utils/platform` (o `../../utils/platform` según la profundidad — confirmar el path relativo real al editar).
2. `EntregableEditor.jsx`: envolver el botón **"Crear rúbrica"** (línea ~344-347) con `{!IS_NATIVE_APP && (...)}`. **No tocar** el botón "Usar una rúbrica de mi banco" (línea ~348).
3. `RubricaPicker.jsx`:
   - Envolver el botón **"Crear nueva rúbrica"** (línea ~86-89) con `{!IS_NATIVE_APP && (...)}`.
   - Envolver el ícono de **lápiz "Editar"** de cada rúbrica del banco con `{!IS_NATIVE_APP && (...)}`.
   - Envolver el ícono de **basura "Eliminar"** de cada rúbrica del banco con `{!IS_NATIVE_APP && (...)}`.
   - **No tocar** la lista de rúbricas en sí ni el poder tocarlas/seleccionarlas para asignarlas a la actividad — eso debe seguir funcionando igual en Android.
4. Revisar visualmente (lectura de código) que al ocultar lápiz+basura no quede un hueco vacío raro en el layout de cada fila del banco — ajustar spacing si hace falta, sin cambiar el diseño en web.

**Verificación:**
- Confirmar por revisión de código que en web (donde `IS_NATIVE_APP` es `false`) nada cambia — los 4 elementos siguen visibles.
- No se puede verificar visualmente el estado `IS_NATIVE_APP === true` desde este entorno — dejarlo documentado en el PR.

**Gate:** `npm run build` limpio, eslint sin errores nuevos. Commit → push → PR → merge → poll deploy → `npx cap sync android`.

---

## FASE 2 — Selector de fecha/hora: esquinas menos redondeadas + borde visible

**Rama:** `fix/datetimepicker-esquinas-borde`

**Alcance:** `src/components/EFDateTimePicker.jsx` (solo el objeto `popoverStyle`).

**Cambio concreto:** en `popoverStyle` (~línea 796-812):
- `borderRadius: 'var(--radius-card, 0.875rem)'` → bajarlo a algo claramente menos redondeado. Sugerencia: `'0.5rem'` (mismo valor final que se usó para "Horario") o incluso menos si se quiere más marcado — **usar un valor fijo en rem, no la variable `--radius-card`** (esa variable está pensada para tarjetas grandes tipo dashboard, no para este popover).
- `border: '1px solid var(--outline-variant)'` → cambiar a un borde más visible. Sugerencia: `'1.5px solid var(--outline, #717785)'` (mismo color ya usado en "Horario", con un poco más de grosor ya que aquí no hay clase Tailwind de por medio, solo `style` inline).

**No tocar** ningún otro valor de `popoverStyle` (posición, `zIndex`, `maxHeight`, etc.) ni la lógica de `computePos`.

**Verificación (navegador, obligatoria):**
- Montar el picker en una ruta de prueba temporal (patrón ya usado varias veces en este repo: agregar un componente + ruta en `App.jsx`, revertir todo antes de commitear — `git diff --stat App.jsx` debe quedar vacío).
- Abrirlo en viewport móvil (375×812), tomar screenshot, y confirmar con `getComputedStyle` sobre el elemento del popover que `borderRadius` y `borderWidth`/`borderColor` cambiaron a los nuevos valores.
- Comparar visualmente contra el estado anterior (esquinas notablemente menos curvas, borde claramente visible, no un hilo casi invisible).

**Gate:** `npm run build` limpio, eslint sin errores nuevos, evidencia de la verificación visual. Commit → push → PR → merge → poll deploy → `npx cap sync android`.

---

## FASE 3 — Auditoría de TODAS las ventanas flotantes del repo (subagente Explore, solo lectura) → `docs/AUDITORIA_SCROLL_LOCK.md`

**Meta:** inventario completo para poder repartir la Fase 5 en subagentes con archivos disjuntos, sin dejar ningún modal fuera.

**Acción (Sonnet orquestador):** lanzar 1 subagente `Explore` con este encargo:
- Enumerar **todos** los componentes/pantallas que renderizan un overlay flotante sobre el resto de la app — busca los patrones `fixed inset-0` combinado con `flex items-end`/`flex items-center` (backdrop + tarjeta), y también los que usan `createPortal` (como `EFDateTimePicker.jsx`). Cubre **ambos roles** (docente y alumno) y también `src/pages/admin/**`.
- Para cada uno, anotar: archivo, línea del contenedor `fixed inset-0` (o del `createPortal`), nombre del componente/función, y si su contenido interno tiene su propio scroll (`overflow-y-auto`) que deba seguir funcionando tras el arreglo.
- Marcar cuáles de estos **ya se van a corregir en la Fase 4** de este mismo plan (`EFDateTimePicker.jsx` y `EventEditor.jsx`) para no duplicarlos en la Fase 5.
- Agrupar el resto en **lotes de 3-6 archivos disjuntos** (nunca el mismo archivo en dos lotes), pensados para repartirse entre varios subagentes en paralelo en la Fase 5.
- **Escribir el resultado en `docs/AUDITORIA_SCROLL_LOCK.md`** (tabla: Archivo:línea | Rol | Nombre del overlay | ¿Tiene scroll interno propio? | Lote asignado). Si la herramienta `Write` no está disponible para el subagente, debe entregar el contenido completo en su respuesta para que el orquestador lo guarde.
- Devolver al orquestador solo un resumen de 8-10 líneas (conteo total, cuántos lotes, cualquier caso raro).

**Criterio de cierre:** existe `docs/AUDITORIA_SCROLL_LOCK.md` con el inventario completo y los lotes definidos. Sin cambios de código en esta etapa.

---

## FASE 4 — Construir el hook compartido `useScrollLock` + aplicarlo a los 2 reportados

**Rama:** `feat/scroll-lock-infra`

**Alcance:** nuevo `src/hooks/useScrollLock.js`, aplicado en `src/components/EFDateTimePicker.jsx` y `src/components/calendar/EventEditor.jsx`.

**Diseño del hook** (contador de referencias para soportar overlays anidados — ej. el date-picker abierto DESDE DENTRO de "Nuevo evento"):

```js
import { useEffect } from 'react'

// Contador a nivel de módulo — si hay dos overlays abiertos a la vez
// (uno anidado dentro del otro), solo se restaura el scroll cuando
// se cierra el ÚLTIMO.
let lockCount = 0
let savedScrollY = 0

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return
    if (lockCount === 0) {
      savedScrollY = window.scrollY
      document.body.style.position = 'fixed'
      document.body.style.top = `-${savedScrollY}px`
      document.body.style.left = '0'
      document.body.style.right = '0'
      document.body.style.width = '100%'
    }
    lockCount++
    return () => {
      lockCount--
      if (lockCount === 0) {
        document.body.style.position = ''
        document.body.style.top = ''
        document.body.style.left = ''
        document.body.style.right = ''
        document.body.style.width = ''
        window.scrollTo(0, savedScrollY)
      }
    }
  }, [active])
}
```

- Con el `body` en `position: fixed`, **no hace falta** agregar ningún backdrop nuevo ni manejar `touchmove`/`preventDefault` — el body físicamente no puede hacer scroll así esté fijado, sin importar en qué parte de la pantalla ocurra el gesto. El scroll **interno** de cada overlay (sus propios `overflow-y-auto`) sigue funcionando exactamente igual, no se toca.
- Mismo patrón de invocación que `useBackHandler` (ya establecido en este repo): en un modal que solo se monta mientras está abierto, `useScrollLock(true)` sin condición; en un componente que se renderiza siempre pero controla visibilidad con una prop `open`, `useScrollLock(open)`.
- Aplicar en:
  - `EFDateTimePicker.jsx`: dentro del `useEffect`/bloque que ya maneja `open` (revisar el patrón exacto del componente — es un popover que se abre/cierra con estado interno, no siempre montado) — `useScrollLock(open)`.
  - `EventEditor.jsx`: se monta solo mientras está abierto (mismo patrón que `NuevaFechaEntregaModal.jsx`) → `useScrollLock(true)`.

**Verificación (navegador, obligatoria):**
- Montar cada componente en una ruta de prueba temporal (revertida antes de commitear).
- Con viewport móvil, simular un gesto de arrastre/scroll sobre el popover/modal (`javascript_tool` disparando eventos `touchstart`/`touchmove`, o usando `computer` con `scroll`) y confirmar con `window.scrollY` (o el `scrollTop` del contenedor de fondo) que **no cambia** mientras el overlay está abierto.
- Confirmar que el scroll **interno** del overlay (por ejemplo, la lista de estudiantes en modo "Para algunos" de `NuevaFechaEntregaModal`, si se prueba ahí también; o el body scrolleable del date-picker) sigue funcionando normal.
- Cerrar el overlay y confirmar que la página de fondo vuelve exactamente a la posición de scroll donde estaba antes de abrirlo.
- Probar el caso anidado: abrir "Nuevo evento", dentro de él abrir el date-picker, cerrar el date-picker (el evento debe seguir bloqueando el scroll de fondo), cerrar el evento (recién ahí se restaura el scroll).

**Gate:** `npm run build` limpio, eslint sin errores nuevos, evidencia de los 4 puntos de verificación de arriba. Commit → push → PR → merge → poll deploy → `npx cap sync android`.

---

## FASE 5 — Rollout de `useScrollLock` al resto de modales del repo (subagentes en paralelo, archivos disjuntos)

**Rama compartida:** `feat/scroll-lock-rollout`

Con los lotes definidos en `docs/AUDITORIA_SCROLL_LOCK.md` (Fase 3):
- Lanzar un subagente por lote, cada uno con instrucciones claras: agregar `import { useScrollLock } from '.../hooks/useScrollLock'` y la llamada correspondiente (`useScrollLock(true)` si el componente solo se monta mientras está abierto, o `useScrollLock(<variable de estado que controla si está abierto>)` si se renderiza siempre) — **sin tocar ninguna otra lógica**, sin cambiar el diseño visual, sin renombrar nada.
- Cada subagente reporta qué archivos tocó y qué patrón usó en cada uno.
- El orquestador revisa el diff de cada subagente antes de integrar a la rama compartida (mismo criterio ya usado en el rollout del botón atrás: ningún cambio de lógica de negocio, solo la línea del hook).
- Build + lint al cerrar cada lote integrado.

**Verificación:** al menos 2-3 modales del rollout se prueban en el panel Browser con el mismo método de la Fase 4 (arrastre sobre el overlay, confirmar que `window.scrollY` de fondo no cambia) — no hace falta probar los ~20+ uno por uno si el patrón es idéntico y ya se probó a fondo en la Fase 4, pero sí una muestra representativa de cada "familia" (un modal `items-end` con backdrop, uno `items-center`, uno con `createPortal`).

**Gate:** build/lint limpios sobre la rama completa. Commit → push → PR → merge → poll deploy.

---

## FASE 6 — Sync final a Android + QA

1. `npm run build && npx cap sync android`, verificar que los bundles sincronizados coinciden en nombre/fecha con `dist/`.
2. Checklist para que el usuario pruebe en su Android real:
   - Abrir el selector de fecha/hora en cualquier pantalla → esquinas menos redondeadas, borde visible.
   - Arrastrar el dedo sobre el selector de fecha/hora y sobre "Nuevo evento" → la pantalla de atrás ya NO se mueve.
   - Probar lo mismo en 2-3 modales más al azar (por ejemplo "Editar alumno", el banco de rúbricas, "Programar bloques") → tampoco se debe mover el fondo.
   - Como docente, entrar a crear/editar una actividad entregable → el botón "Crear rúbrica" y el acceso a "Mi banco de rúbricas" para crear/editar/borrar ya no aparecen; "Usar una rúbrica de mi banco" (para elegir una ya existente) sigue ahí y funciona.
3. Si algo falla, documentar el caso específico (pantalla + qué pasó) para una fase de corrección dirigida — no reabrir todo el plan.

---

## Criterios de aceptación globales

- [ ] Rúbricas: en Android no se pueden crear, editar ni borrar — solo usar una existente. En web, todo sigue exactamente igual que antes.
- [ ] Selector de fecha/hora: esquinas claramente menos redondeadas y borde claramente visible, en ambos roles.
- [ ] Ningún modal/popover del repo permite que un arrastre sobre él mueva la pantalla de fondo — verificado en al menos el date-picker, "Nuevo evento", y una muestra representativa del resto.
- [ ] El scroll **interno** de cada overlay (listas largas, formularios largos) sigue funcionando exactamente igual que antes.
- [ ] Overlays anidados (date-picker dentro de un modal) no rompen la restauración del scroll de fondo al cerrar.
- [ ] Sin dependencias nuevas; build y lint limpios por fase; Android sincronizado al cerrar cada fase.

## Riesgos / decisiones abiertas

- **`position: fixed` en `document.body` puede interactuar raro con otros estilos globales** (por ejemplo si algo más ya toca `body.style` en algún lado) — no se encontró ningún otro código que lo haga (grep confirmado), pero si aparece un conflicto visual al probar, documentarlo antes de seguir a la fase siguiente.
- **El date-picker (`EFDateTimePicker.jsx`) es compartido entre roles** — cualquier ajuste ahí (Fase 2 y Fase 4) afecta también la app del alumno, aunque el pedido original fue "en la app del docente". Ya se confirmó con el usuario que esto es aceptable (mismo criterio usado antes para este componente).
- **Fase 5 es la de mayor volumen** (~20+ archivos) — si en la Fase 3 el conteo real resulta mucho mayor a lo estimado, contemplar dividir la Fase 5 en dos rondas de subagentes en vez de una sola tanda gigante.
