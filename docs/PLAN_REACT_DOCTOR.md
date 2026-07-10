# Plan: eliminar TODOS los hallazgos de React Doctor

> Baseline: **React Doctor v0.6.0 → 643 hallazgos, score 34/100** (tras limpiar el worktree abandonado y el caché).
> Objetivo: llegar a **0 hallazgos accionables** — arreglando los reales y suprimiendo con justificación los falsos positivos / decisiones de diseño.

## Realidad del baseline (sé honesto con el número)

De los 643, **no todos son "errores"**. Se reparten así:

| Origen | Hallazgos | Naturaleza |
|--------|-----------|------------|
| `src/` | ~562 | Código real de la app React — el trabajo de verdad |
| `seeds-db/` | ~32 | Scripts CLI con Firebase **Admin SDK** (privilegiado, servidor) — mayormente falsos positivos |
| `api/` | ~11 | Serverless — no es la app React |
| `dist/` + `firestore.rules` | ~2 | Build minificado / reglas |

**Meta realista:** ~15-20% se resuelven por *configuración/supresión documentada* (falsos positivos y diseño intencional), el resto por *cambios de código reales*.

---

## Clasificación de las 35 reglas en 6 buckets

### 🟥 Bucket A — Falsos positivos → SUPRIMIR por config (no tocar código)
| Regla | × | Por qué es falso positivo |
|-------|---|---------------------------|
| Accessibility: Invalid ARIA role | 4 | `<PortalBadge role="docente">` es una **prop de componente**, no el atributo ARIA `role`. |
| Security: Client writes authorization field | 2-3 | `seeds-db/create-admin.js`, `setup-admin-data.js` usan **Admin SDK** — escribir `role` es su función. |
| Security: Firestore query filter as auth | 1 | `seeds-db/migrate-usernames.js` — script admin, no runtime cliente. |
| Security: BaaS authority map in browser artifact | 1 | Apunta a `dist/assets/*.js` — **build minificado**, no fuente. |

**Acción:** crear config de React Doctor que (a) limite el scope a `src/` y (b) suprima estas reglas con comentario justificado.

### 🟦 Bucket B — Diseño intencional → DOCUMENTAR + suprimir con justificación
| Regla | × | Justificación (ya en CLAUDE.md) |
|-------|---|---------------------------------|
| Security: Permissive Firebase rule | 2 | `students`/`subjects` necesitan `read: true` para activación por **QR**. **Excepción:** revisar `users read: if true` (expone docs de docentes) — ver Fase 6. |
| Bugs: Data fetching inside an effect | 2 | La app no usa react-query; fetch en `useEffect` es el patrón establecido. |

### 🟩 Bucket C — Reales, seguros, mecánicos → ARREGLO EN LOTE
| Regla | × | Fix |
|-------|---|-----|
| Bugs: Button missing explicit type | 130 | `type="button"` (respetando los submit reales). |
| Bugs: Array index used as key | 14 | `key` estable por id. Incluye 2 en `EFDateTimePicker.jsx`. |
| Security: iframe missing sandbox | 2 | `sandbox` en los iframes de Google Docs viewer (`AttachmentList.jsx`). |
| Accessibility: iframe missing title | 2 | `title` descriptivo en esos iframes. |
| Accessibility: outline:none removes focus ring | ~ | Reemplazar por `focus-visible` ring. |
| Maintainability: unused-file | 28 | Borrar archivos muertos (incl. `DateTimePicker.jsx` viejo). |
| Maintainability: unused-export | 19 | Borrar exports sin uso. |

### 🟨 Bucket D — Reales, requieren criterio por caso → REVISAR CADA UNO
| Regla | × | Nota |
|-------|---|------|
| Bugs: Missing effect dependencies | 17 | Leer cada callback; usar updater funcional o estabilizar. **Tip:** oxlint no silencia con `react-hooks/exhaustive-deps`; usar `react-doctor/exhaustive-deps` en el disable. |
| Bugs: Event logic handled in an effect | 6 | Mover a handler del evento. |
| Bugs: Derived value copied into state | 4 | Calcular en render, no en state. |
| Bugs: State updates chained through effects | 3 | Colapsar cadenas de efectos. |
| Bugs: Prop derived into useState | 2 | Derivar en render o `key`-reset. |
| Bugs: Many related useState calls | 7 | Considerar `useReducer` (opcional). |

### 🟧 Bucket E — Accesibilidad de fondo → BARRIDO POR SUB-LOTES (~290)
| Regla | × |
|-------|---|
| Label missing associated control | 100 |
| Control missing accessible label | 91 |
| Click handler missing keyboard handler | 36 |
| Interaction on static element | 35 |
| Autofocus on an element | 21 |
| Text is too small | 5 |
| Role used instead of HTML tag | ~ |
| Mouse handler missing focus handler | ~ |

### 🟪 Bucket F — Rendimiento + Mantenibilidad → OPTIMIZAR / REFACTOR
| Regla | × | Riesgo |
|-------|---|--------|
| Performance: Chained array iterations | 17 | Bajo |
| Performance: await inside a loop | 15 | Medio (revisar orden) |
| Performance: .map().filter(Boolean) loops twice | 8 | Bajo |
| Performance: Spread copy before sort() | 8 | Bajo |
| Performance: State initializer runs every render | 2 | Bajo (`useState(() => …)`) |
| Maintainability: Large component | 13 | **Alto** — `SubjectPage.jsx` (~2200 líneas) |
| Maintainability: Large inline style object | 8 | Bajo (hoist fuera del render) |
| Maintainability: Pure function rebuilt | 7 | Bajo (hoist a módulo) |
| Maintainability: React 19 API migration | 2 | Medio (puede romper callers) |

---

## Plan de ejecución por fases

> Cada fase = **rama + PR propio**, con `npm run build` + verificación en preview, y `npx react-doctor@latest` antes/después para medir la caída del conteo. Nunca mezclar fases en un PR.

### Fase 0 — Config, baseline limpio y código muerto  ·  riesgo: 🟢 bajo
1. Crear config de React Doctor con scope a `src/` + supresión justificada del **Bucket A**.
2. Borrar `DateTimePicker.jsx` (confirmado sin referencias) y demás **unused-file (×28)** / **unused-export (×19)** — verificando uno por uno con grep + build.
3. Re-medir. **Caída esperada: ~90-100 hallazgos** sin tocar lógica.

### Fase 1 — Fixes mecánicos de bugs  ·  riesgo: 🟢 bajo
- `type="button"` en los 130 botones (script + revisión de submits reales).
- `key` estable en los 14 casos de índice.
- `sandbox` + `title` en los iframes de `AttachmentList.jsx`.
- **Caída esperada: ~146.** Es el mayor golpe de conteo con cero cambio de comportamiento.

### Fase 2 — Corrección de efectos (Bucket D)  ·  riesgo: 🟡 medio
- Los 17 `useEffect` con deps faltantes, uno por uno (updater funcional / estabilizar).
- Familia derived-state / event-in-effect / chained-effects.
- Requiere leer la lógica de cada hook — aquí están los bugs sutiles reales.

### Fase 3 — Barrido de accesibilidad (Bucket E)  ·  riesgo: 🟡 medio
- Sub-lote 3a: `htmlFor`/wrap de labels (×100) + nombres accesibles (×91).
- Sub-lote 3b: handlers de teclado (×36) + elementos interactivos estáticos (×35) → convertir a `<button>` real.
- Sub-lote 3c: autofocus (×21), texto pequeño (×5), focus rings.
- ~290 hallazgos; semi-mecánico pero con cuidado de no romper UX.

### Fase 4 — Rendimiento (Bucket E-perf)  ·  riesgo: 🟢 bajo
- Fusionar iteraciones encadenadas, `Promise.all` en awaits independientes, hoist de formatters `Intl`, `useState(() => …)`.

### Fase 5 — Mantenibilidad / refactors  ·  riesgo: 🔴 alto
- Hoist de objetos de estilo y funciones puras (fácil).
- **Partir `SubjectPage.jsx`** (~2200 líneas) y demás componentes grandes — su propio PR, con cuidado.
- Migraciones de API React 19 (revisar callers).

### Fase 6 — Seguridad  ·  riesgo: 🟡 medio
- Documentar formalmente las reglas de lectura pública (QR) como excepción aceptada.
- **DECIDIDO: endurecer `users read: if true`** → restringir la lectura de `users` a `isAdmin()` o al propio dueño (`request.auth.uid == userId`).
  - **Paso previo obligatorio:** auditar qué flujos de la app leen `users` de otros uids (login, migración de usernames, listados admin) para no romperlos. Ajustar reglas + código donde haga falta.
  - Desplegar con `firebase deploy --only firestore` (no es automático en Vercel).
- Verificar cada flujo `Client writes authorization field` real de `src/` (`teacherAccount.js` — ya mitigado por la regla `create`).

### Fase 7 — Puerta en CI  ·  riesgo: 🟢 bajo
- Añadir `npx react-doctor@latest --scope changed` al pipeline para que el score no vuelva a bajar.

---

## Definición de "terminado"

- [ ] `npx react-doctor@latest` reporta **0 errores** y solo warnings suprimidos con justificación escrita.
- [ ] Cada supresión tiene un comentario que explica *por qué* (no un silencio ciego).
- [ ] `npm run build` limpio y app verificada en preview tras cada fase.
- [ ] Decisiones de seguridad de Fase 6 tomadas por el dueño (tú), no asumidas.

## Decisiones ya tomadas

- ✅ **Estrategia de PR:** un PR por fase (fácil de revisar y revertir).
- ✅ **Fase 6 — `users read`:** endurecer (restringir a admin/dueño), previa auditoría de flujos.
- ⏸️ **Estado:** plan aprobado, ejecución **en pausa** — retomar cuando el dueño dé luz verde a arrancar por Fase 0.
