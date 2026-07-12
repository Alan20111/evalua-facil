# PLAN MAESTRO — Estandarización UI + Dinámica móvil + Notificaciones push

> **Documento de orquestación para Sonnet.** Ejecutar por etapas, con subagentes en paralelo donde se indica, en una o varias iteraciones. En los puntos marcados **⛔ PREGUNTA** hay que detenerse y preguntar al usuario antes de continuar — no asumir. El objetivo final: un solo patrón de diseño respetado en todas las pantallas, medidas/anchos consistentes, experiencia móvil de primera para alumno Y docente, y alertas push funcionando.

## Documentos fuente (leer antes de ejecutar cada etapa)

| Documento | Qué aporta |
|---|---|
| [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) | La especificación completa del patrón (tokens, tipografía, componentes §6, iconografía §7, inventario de 24 pantallas §9, deuda §10) — es la **fuente de verdad** de cómo debe verse todo |
| [`PLAN_ESTANDARIZACION_UI.md`](PLAN_ESTANDARIZACION_UI.md) | Las 5 fases de estandarización con evidencia dura (greps, 181 violaciones jsx-a11y, desglose por archivo) — la Etapa A de este plan lo ejecuta tal cual |
| [`PLAN_DISENO.md`](PLAN_DISENO.md) | El plan token-first ya ejecutado (contexto histórico de por qué el sistema es como es) |
| `CLAUDE.md` (raíz) | Convenciones duras: feature branch + PR (nunca commit directo a main), `npm run build` por fase, sin range-queries en Firestore, azul (nunca índigo) |

## Reglas de orquestación (aplican a TODO el plan)

1. **Git:** una rama `feat/` o `fix/` por etapa (no por subagente). Los subagentes trabajan sobre la misma rama, en archivos disjuntos — nunca dos agentes en el mismo archivo a la vez. Al cerrar cada etapa: build + lint + commit + push + PR.
2. **Gate de cada fase:** `npm run build` sin errores y `npm run lint` con conteo total **menor o igual** al de la fase anterior (los ~171 errores preexistentes de `api/`/`seeds-db/` no cuentan ni se tocan). Anotar el conteo en el mensaje de commit.
3. **Subagentes:** cada uno recibe (a) la lista exacta de archivos que puede tocar, (b) la sección relevante de `DESIGN_SYSTEM.md`, (c) la instrucción "solo clases/estilos/atributos — cero cambios de lógica" cuando aplique. El orquestador verifica el diff de cada agente antes de integrar.
4. **QA visual:** al cerrar cada etapa, recorrer las pantallas tocadas en 375 / 768 / 1440 px con `npm run dev` (el orquestador puede usar su navegador integrado). Para la Etapa B también 320px (móviles chicos) y modo landscape.
5. **No inventar diseño:** si un caso no está cubierto por `DESIGN_SYSTEM.md`, es una **⛔ PREGUNTA**, no una improvisación.

---

# ETAPA A — Estandarización del patrón (base de todo lo demás)

Ejecutar las **5 fases de [`PLAN_ESTANDARIZACION_UI.md`](PLAN_ESTANDARIZACION_UI.md) en su orden**, con el reparto de subagentes que ese documento ya especifica en su sección "Nota para ejecución con subagentes". Resumen del reparto:

| Fase | Contenido | Subagentes |
|---|---|---|
| A1 | `EFDateTimePicker.jsx` — 15 fontSize en px crudos → escala del sistema | 1 agente |
| A2 | Anchos: CalendarPage → `TEACHER_CONTAINER`; crear `STUDENT_CONTAINER`/`_NARROW` en `config/layout.js` y aplicar en las 5 pantallas de alumno | 1 agente |
| A3 | Color: `bg-blue-600` (15 archivos) → tokens accent; Spinner; VerifyEmail SVG→lucide+emerald; orange→amber en ActivityPage alumno | 4-5 agentes (3-4 archivos c/u, disjuntos) |
| A4 | Tabs (4 variantes→2), `disabled:opacity` (→60/40), `focus:`→`focus-visible:` (74), hover-tint (tint=superficies/medium=controles), inline styles→clases | 5 agentes (uno por sub-punto — son ortogonales) |
| A5 | jsx-a11y: 50 labels (repartible), 100 clicables sin teclado (**SubjectPage.jsx = agente dedicado exclusivo, 80 casos**), 25 autofocus (caso por caso), contraste slate-400→muted, touch targets | 4-6 agentes |

**⛔ PREGUNTA antes de A3:** `PortalBadge.jsx` usa verde neón `#39FF14`/naranja `#FF6600` — ¿es decisión de marca deliberada o se alinea a los tokens del rol? (No tocar sin respuesta.)

**⛔ PREGUNTA antes de A4 (tabs):** confirmar las 2 variantes finales (segmented docente / underline alumno) con captura de cómo quedarían los casos de Checkout/NuevaFecha convertidos a botones Outline Accent.

**Criterio de cierre de la Etapa A:** todos los greps de cierre del plan de estandarización en 0, conteo jsx-a11y de las reglas atacadas en 0, QA visual de las pantallas clave (Login/Dashboard/SubjectPage en ambos roles, CalendarPage, un modal con picker abierto), y navegación completa por teclado en SubjectPage.

---

# ETAPA B — Dinámica móvil de primera (alumno Y docente)

El módulo alumno ya es mobile-first; el docente tiene topbar+bottom-nav pero se pensó desktop-first. Esta etapa nivela ambos a calidad "app nativa". **Requiere Etapa A terminada** (no tiene sentido pulir móvil sobre clases inconsistentes).

### B1 — Auditoría móvil dirigida (1 agente Explore, solo lectura)
Producir una lista archivo:línea de: (a) touch targets <44px restantes tras A5, (b) elementos que se desbordan a 320px, (c) modales que NO usan el patrón bottom-sheet (`items-end sm:items-center`), (d) pantallas sin `safe-bottom` que tengan UI fija inferior, (e) tablas sin `overflow-x-auto` funcional en móvil, (f) inputs que disparan zoom en iOS (font-size < 16px real en el input al hacer focus). Entregar como tabla priorizada.

### B2 — Correcciones estructurales (2-3 agentes sobre la lista de B1)
- **Safe areas:** `EvaluacionRunner` (modo examen fullscreen) hoy no reserva `safe-bottom` — su navegación inferior puede quedar bajo el home-indicator. Corregir ahí y en cualquier otro caso que B1 encuentre.
- **Bottom-sheets:** todo modal debe seguir el patrón único documentado (`DESIGN_SYSTEM.md` §6.7). Los que abren centrados en móvil se convierten.
- **Tabla de captura (SubjectPage docente) en móvil:** verificar que el sticky de columnas funciona en táctil y que la fila/celda activa es alcanzable con el teclado virtual abierto (el viewport se reduce ~40%). Si hay que elegir entre soluciones, **⛔ PREGUNTA** con propuesta.
- **Gestos y estados táctiles:** unificar el workaround anti-doble-tap (`touchAction: manipulation`) que hoy está aplicado a medias (documentado en `DESIGN_SYSTEM.md` §10-#23) — aplicarlo vía clase/util compartida, no copy-paste.

### B3 — Tableta (768–1024px, el breakpoint huérfano)
Hoy todo conmuta en `md` (768px): la tableta vertical recibe el layout desktop con sidebar de 280px, dejando poco espacio al contenido. Decidir y aplicar UN criterio:
- **⛔ PREGUNTA (con mockup/captura):** ¿sidebar colapsable a iconos en 768-1024px, o mantener bottom-nav hasta `lg` (1024px)? Recomendación por defecto: subir el corte del sidebar a `lg` y dejar tablet vertical con la experiencia móvil (más segura, cero código nuevo de sidebar).

### B4 — QA móvil real
Recorrido completo alumno y docente en: iPhone SE (375×667), iPhone moderno (390×844 + safe areas), Android chico (360×800), iPad vertical (768×1024), iPad horizontal (1024×768). Flujos completos: login → dashboard → materia → actividad → entregar/calificar → examen (Runner). Documentar con capturas antes/después.

---

# ETAPA C — PWA completa + Notificaciones push

**Estado real verificado (2026-07-11):** ya existe `public/manifest.json` con iconos 192/512 y `display: standalone`, **pero no hay service worker** (la app no es instalable-offline ni puede recibir push todavía). `messagingSenderId` ya está en la config de Firebase, y `api/_lib/firebaseAdmin.js` da Admin SDK en Vercel serverless → **el envío de push es viable sin infraestructura nueva** (FCM + endpoints `api/`). No hay crons en `vercel.json` (se agregan si se aprueban recordatorios programados).

### C0 — Decisiones ⛔ PREGUNTA (todas antes de escribir código)
1. **Alcance de eventos push v1** — propuesta mínima de alto valor:
   - Alumno: "nueva actividad publicada", "te calificaron", "recordatorio: entrega mañana/cierra hoy".
   - Docente: "alumno entregó" (con agrupación: "3 entregas nuevas en Matemáticas 3A"), "recordatorio: actividades por calificar".
   ¿Se aprueban estos 5? ¿Se quita/agrega alguno?
2. **Recordatorios programados** requieren Vercel Cron (plan Hobby: máx 2 crons/día — suficiente para un job diario de recordatorios). ¿OK agregar el cron, o v1 solo eventos instantáneos?
3. **iOS:** web push en iOS requiere que el usuario **instale la PWA** (Añadir a pantalla de inicio, iOS 16.4+). ¿Se agrega un banner in-app "Instala la app para recibir avisos" para usuarios iOS? (Recomendado: sí, discreto y descartable.)
4. Límite de Firestore: los tokens FCM se guardan por usuario — confirmar colección nueva `fcmTokens` (docId = token, campos: `uid`, `rol`, `escuelaId`, `createdAt`, `lastSeenAt`) + reglas de seguridad (cada quien escribe solo su token; solo server lee).

### C1 — Base PWA (1 agente)
- `firebase-messaging-sw.js` en `public/` (service worker de FCM, maneja push en background + click → deep-link a la pantalla correcta).
- Registro del SW en `main.jsx` (solo producción, no interferir con HMR de Vite en dev).
- Corregir `manifest.json`: `theme_color` sigue en índigo `#4f46e5` → `#2563eb` (violación directa de la regla "azul, nunca índigo" de CLAUDE.md); revisar `background_color` contra `--surface` (#FAF9FA).
- Verificar instalabilidad en Chrome (criterios PWA) y en iOS Safari.

### C2 — Cliente: permisos y tokens (1 agente)
- Módulo `src/utils/pushNotifications.js`: `getMessaging` + `getToken` (VAPID key → nueva env `VITE_FIREBASE_VAPID_KEY`), guardar/refrescar token en `fcmTokens`, manejar `onMessage` (push en foreground → mostrar como toast del sistema existente, no notificación duplicada).
- **UX del permiso (importante):** NUNCA pedir permiso de notificaciones al cargar la página. Pedirlo en un momento con contexto: tras la primera acción relevante (docente publica su primera actividad / alumno entra a su primera materia), con un pre-prompt in-app propio ("¿Quieres que te avisemos cuando te califiquen?" → botón → recién ahí el prompt nativo). Respetar el rechazo: no volver a preguntar; dejar un toggle en Profile.
- Toggle de notificaciones en Profile (ambos roles) siguiendo el patrón de toggle documentado en `DESIGN_SYSTEM.md` §6.2 (migrado a tokens en Etapa A).

### C3 — Servidor: envío (1 agente)
- `api/notifications/send.js` (helper interno con Admin SDK `messaging().sendEachForMulticast`), limpieza de tokens inválidos (`messaging/registration-token-not-registered` → borrar de `fcmTokens`).
- Disparadores v1 **desde el cliente que origina el evento** vía llamada al endpoint (no hay Cloud Functions): al calificar → notificar alumno; al publicar actividad → notificar alumnos de la materia; al entregar → notificar docente. El endpoint valida con Admin SDK que quien llama tiene permiso sobre esa materia (no confiar en el payload).
- Si C0-2 aprobado: `api/cron/reminders.js` + entrada `crons` en `vercel.json` (1 ejecución diaria, ~7am hora CDMX) para "entrega cierra hoy/mañana" y "tienes N por calificar".
- **Seguridad:** multi-tenant estricto (solo destinatarios de la misma escuela/materia), sin datos sensibles en el cuerpo de la notificación (título de actividad y materia: sí; calificación exacta: **⛔ PREGUNTA** — recomendado NO incluir la nota en el push, solo "Ya tienes calificación en X").

### C4 — Reglas Firestore + pruebas
- Reglas para `fcmTokens` con el emulador (`npm run test:rules` ya existe como patrón).
- Prueba end-to-end real: dispositivo Android (Chrome) + iOS instalado como PWA; verificar deep-links (tocar la notificación abre la pantalla correcta con la app cerrada, en background y en foreground).
- Recordar: `firebase deploy --only firestore` es manual (CLAUDE.md).

---

# ETAPA D — Cierre: verificación integral y candado del patrón

1. **Matriz de QA final** (una sesión, con capturas): 24 pantallas del inventario × {375, 768, 1440} × {docente, alumno donde aplique} + flujo push completo en Android e iOS.
2. **Candado anti-regresión barato:** agregar a `docs/DESIGN_SYSTEM.md` una sección "Cambios cerrados" con los greps de cierre de la Etapa A, y (opcional, **⛔ PREGUNTA**) un script `scripts/check-ui-standards.sh` que corra esos greps y falle si reaparecen `bg-blue-600`, `fontSize:` inline en componentes, `focus:ring-2` sin visible, etc. — 20 líneas de bash, cero dependencias nuevas.
3. **Actualizar documentación:** marcar en `DESIGN_SYSTEM.md` §10 cada punto resuelto, actualizar §9 si cambió algún layout (tableta), documentar la escala de iconos decidida en §7 y el sistema de notificaciones (nuevo §13).
4. PR final por etapa mergeado a `main` → Vercel despliega. Firestore rules desplegadas a mano.

---

## Resumen de puntos ⛔ PREGUNTA (para no perderlos)

| # | Etapa | Pregunta |
|---|---|---|
| 1 | A3 | PortalBadge neón: ¿marca deliberada o alinear a tokens? |
| 2 | A4 | Confirmar consolidación de tabs con captura previa |
| 3 | B2 | Solución elegida para tabla de captura en móvil (si hay trade-off) |
| 4 | B3 | Tableta: ¿sidebar colapsable o experiencia móvil hasta `lg`? |
| 5 | C0 | Lista final de eventos push v1 |
| 6 | C0 | ¿Cron de recordatorios sí/no? |
| 7 | C0 | ¿Banner "instala la app" para iOS? |
| 8 | C0 | Confirmar colección `fcmTokens` y sus reglas |
| 9 | C3 | ¿Incluir la calificación en el cuerpo del push? (recomendado: no) |
| 10 | D | ¿Script de candado anti-regresión sí/no? |

## Orden y dependencias

```
ETAPA A (fases 1→5, secuenciales; subagentes en paralelo DENTRO de cada fase)
   ↓  (A es prerequisito de B — no pulir móvil sobre clases inconsistentes)
ETAPA B (B1 auditoría → B2/B3 en paralelo → B4 QA)
   ↓  (B es prerequisito parcial de C — el pre-prompt de permisos y el toggle usan los patrones ya limpios)
ETAPA C (C0 decisiones → C1/C2 en paralelo → C3 → C4)
   ↓
ETAPA D (cierre)
```

Cada etapa es un PR independiente y desplegable por sí mismo — si el proyecto se pausa después de cualquier etapa, lo entregado hasta ahí queda en producción sin cabos sueltos.
