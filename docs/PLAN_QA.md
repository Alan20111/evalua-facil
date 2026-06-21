# Plan de QA / Pruebas — Evalúa Fácil

> Plan para identificar bugs recorriendo la app como **docente** y como **alumno**. Diseñado para ejecutarse con subagentes manejando un navegador sobre el dev server. Incluye: metodología de ejecución, datos de prueba, catálogo de escenarios por rol (con prioridad), áreas de alto riesgo, y el ajuste de escenarios tras aplicar `PLAN_CAMBIOS.md`.

## 1. Metodología de ejecución

### Entorno
1. Arrancar dev server: `npm run dev` (Vite, normalmente `http://localhost:5173`).
2. Conducción del navegador (elegir uno):
   - **Claude Preview MCP** (`mcp__Claude_Preview__*`): `preview_start` con la URL, luego `preview_click` / `preview_fill` / `preview_snapshot` / `preview_console_logs` / `preview_screenshot`.
   - **Claude in Chrome MCP** (`mcp__Claude_in_Chrome__*`): `navigate`, `read_page`, `form_input`, `find`, `read_console_messages`, `read_network_requests`.
3. Capturar en cada escenario: screenshot final, errores de consola, requests fallidos (4xx/5xx/permission-denied de Firestore).

### Datos de prueba (seed)
- BD vacía salvo admin. Para QA crear con scripts `seeds-db/` o manualmente:
  - 1 docente (registro nuevo) → asignatura "Matemáticas 1A" con 2 parciales.
  - 3 actividades: una visible, una oculta, una programada (publishAt futuro).
  - 3 alumnos (alta manual) → activar 1 vía código, dejar 2 sin activar.
  - 1 alumno inscrito en 2 asignaturas (probar multi-materia).
  - Subir 1-2 entregas y calificar 1 (para promedios y ZIP).

### Orquestación con subagentes
- Un subagente recorre el **flujo docente** (registro→asignatura→actividades→calificar→ZIP→archivar→perfil→logout) y otro el **flujo alumno** (activación→dashboard→entrega→calificación→multi-materia→visibilidad). Cada uno reporta: escenario, resultado (pass/fail), evidencia (screenshot/console), severidad.
- Verificación adversarial: un tercer subagente revisa los "pass" dudosos y los casos borde (doble-submit, URL directa a oculta, colisión de username).

### Criterio de severidad
- **Blocker:** rompe un flujo principal o pierde datos.
- **Major:** función no cumple el requisito o falla en caso común.
- **Minor:** cosmético / borde poco frecuente.

---

## 2. Áreas de alto riesgo (priorizar sondeo)

**Docente**
- Cascade archivar/eliminar sin transacción → estado inconsistente si falla a mitad.
- ZIP en memoria (JSZip) con asignaturas grandes → posible cuelgue del navegador.
- Colisión de username de alumno entre docentes de la misma escuela (carrera en importación).
- Límite 490 ops de `writeBatch` en copiar asignatura.
- Visibilidad programada (`publishAt`) depende del reloj del cliente / zona horaria.
- Sin paginación en listas grandes (alumnos/actividades).
- Inyección CSV en export Excel si un nombre empieza con `=`/`@`.

**Alumno**
- `Activation.jsx`: guard de doble-submit (`submitting.current`) — si una excepción no lo resetea, bloquea el segundo intento.
- `Activation.jsx`: lógica de 3 pasos ante `email-already-in-use` (password tecleada → temp del maestro → `link_existing`); excepción a mitad deja estado inconsistente.
- `studentLookup.js`: cadena de fallback (uid → studentId → email) podría resolver al alumno equivocado si hay colisión de username entre escuelas (mitigado: ahora filtra por escuelaId).
- `ActivityPage.jsx`: `onSnapshot` + `loadOther` en paralelo pueden competir.
- `isActivityPublished()`: comparación con `Date.now()` sin zona horaria.
- Subida de archivo: validación de tipo/tamaño solo en cliente.

---

## 3. Catálogo de escenarios — DOCENTE

> Prioridad: **P0** crítico, **P1** importante, **P2** borde. Mapa de rutas: `/` (landing) · `/register` · `/docente` · `/dashboard` · `/subject/:id` · `/activity/:id` · `/profile`.

### Registro / Login
- **[P0] D-REG-01** Registrar docente (correo + escuela + password) → cuenta creada, redirige a `/dashboard`, llega correo con **username** (ya **sin** banner de verificación), trial 60 días.
- **[P1] D-REG-02** Correo duplicado → "Este correo ya tiene cuenta. Inicia sesión."
- **[P1] D-REG-03** Password < 6 → "Mínimo 6 caracteres".
- **[P1] D-REG-04** Passwords no coinciden → error.
- **[P1] D-REG-05** Escuela: probar "**Prefiero no elegir en este momento**" → registro completa y puede crear asignaturas (R16).
- **[P0] D-LOGIN-01/02** Login con username y con email → `/dashboard`.
- **[P1] D-LOGIN-03/04** Password incorrecto / usuario inexistente → error claro.

### Dashboard / Crear asignatura
- **[P0] D-DASH-01** Empty state: "Aún no tienes asignaturas" + FAB.
- **[P0] D-DASH-02** Con asignaturas: lista ordenada; tarjetas muestran nombre+grupo; toggle de orden (Asignatura·Grupo ↔ Grupo·Asignatura) persiste en localStorage.
- **[P0] D-DASH-05** Crear asignatura por FAB: **Asignatura** (nombre) + **Grupo** (texto) + Período + Parciales + **Paleta** → creada, navega a `/subject/:id`. (Verificar: ya **no** pide grupo previo ni muestra "crea un grupo".)
- **[P1] D-DASH-06/07** Nombre/Grupo vacío → validación.
- **[P1] D-DASH-PALETTE** Elegir paleta naranja/morada al crear → dentro de la asignatura el acento usa esa paleta; el dashboard sigue azul (rol docente).
- **[P1] D-DOUBLE-01** Doble clic rápido en "Crear asignatura" → solo una creada (botón se deshabilita).

### Asignatura / Actividades
- **[P0] D-SUBJ-01** Ver asignatura: header nombre+grupo; actividades por parcial; botones Copiar/Editar/Archivar/Eliminar. (Verificar: **sin pestaña Asistencia**.)
- **[P0] D-SUBJ-02** Crear actividad (parcial, nombre, calif máx, instrucciones, fecha, tipos, visibilidad) → aparece visible.
- **[P1] D-SUBJ-03/04** Editar / eliminar actividad (con confirmación + cascade de entregas).
- **[P1] D-SUBJ-05** Ocultar actividad (icono ojo) → `oculta=true`; deja de verse para alumnos.
- **[P1] D-SUBJ-06** Programar actividad (modal "Activar": Ahora/Programar + fecha) → badge "se activa…".
- **[P1] D-SUBJ-07** Publicar ahora → visible inmediato.
- **[P1] D-SUBJ-11** Editar asignatura: nombre/grupo/ciclo/parciales + **paleta**.
- **[P1] D-SUBJ-12** Reducir parciales con actividades arriba → error "Hay actividades en parciales superiores…".
- **[P1] D-SUBJ-10** Copiar asignatura (nombre/grupo nuevos, período selector, copiar alumnos opcional, **paleta**) → copia con actividades, sin entregas.
- **[P1] D-SUBJ-13** Eliminar asignatura (escribir nombre para confirmar) → cascade (actividades, entregas, alumnos) y redirige.

### Archivar / Restaurar (R14)
- **[P0] D-ARCH-01** Archivar: aparece modal "¿Guardar entregas como ZIP?" (default guardar) → descarga ZIP → **borra entregas** → `archived:true`. Verificar que **quedan** actividades y alumnos (esqueleto) pero **no** entregas.
- **[P1] D-ARCH-02** Archivar "sin guardar" → borra entregas sin descargar (con confirmación).
- **[P1] D-ARCH-03** Restaurar: modal permite **editar** nombre/grupo/ciclo/parciales + elegir **paleta** + opciones de alumnos/visibilidad → restaura.
- **[P1] D-ARCH-04** Sidebar muestra asignaturas **archivadas** junto a activas (atenuadas + badge).

### Alumnos
- **[P1] D-STU-01** Agregar alumno manual → username autogenerado, `resetPassword` (campo correcto), `activado:false`. (Verificar que el campo es `resetPassword`, no `passwordReset`.)
- **[P1] D-STU-02** Importar alumnos por Excel → alta masiva con `resetPassword`.
- **[P2] D-STU-03** Reset password → muestra temporal, copiar al portapapeles.
- **[P1] D-STU-04** Eliminar alumno.
- **[P1] D-STU-05** QR / código de acceso para activación.

### Calificaciones / Export / ZIP
- **[P0] D-ACT-01** Página de actividad: contadores Pendientes/Entregados/Calificados; filtros; búsqueda.
- **[P0] D-ACT-02** Calificar entrega (nota + comentario) → estado "Calificado".
- **[P1] D-ZIP-01** **ZIP por actividad**: archivo se llama como **la actividad**; dentro **carpeta por alumno** con sus archivos de **nombre original**. (R15)
- **[P1] D-ZIP-02** Verificar que **ya NO** hay botón de ZIP por parcial ni por asignatura en calificaciones.
- **[P1] D-EXP-01** Export Excel de calificaciones funciona **sin columnas de asistencia**.

### Perfil
- **[P1] D-PROF-01** Editar nombre para mostrar → se refleja en saludo y en vista de alumno (R10).
- **[P1] D-PROF-02/03** Cambiar password (ok / password actual incorrecto).
- **[P1] D-PROF-04** Verificar que **NO** existe opción de cambiar correo (solo lectura) (R5).
- **[P0] D-PROF-05** Verificar que **solo hay un** "Cerrar sesión" (sidebar), **no** dentro de los datos del docente (R6).
- **[P1] D-PROF-06** Legibilidad: "Así te verán tus alumnos" y labels de sección se leen bien (R7).

### Theming (R18/R2)
- **[P0] D-THEME-01** Toda la UI docente en azul; formularios/tablas/fondos neutros sin cambio.

---

## 4. Catálogo de escenarios — ALUMNO

> Mapa: `/alumno` (login) → `/activate/:code` → `/alumno/dashboard` → `/alumno/materia/:id` → `/alumno/actividad/:id`. Email falso: `username.escuelaId@evalua.local`.

### Activación / Login
- **[P0] S-ALUM-001** Activación primera vez por **QR** → username → password → "¡Cuenta activada!" → dashboard.
- **[P0] S-ALUM-002** Activación por **código** manual (sección "¿Primera vez?").
- **[P1] S-ALUM-003** Código inválido → pantalla "Código no válido" + "Volver al inicio".
- **[P1] S-ALUM-004** Username no encontrado → toast claro, no avanza.
- **[P0] S-ALUM-005** **Regresión doble-submit:** doble tap en "Activar cuenta" → **una sola** cuenta, entra directo (sin pantalla "ya tienes cuenta" indebida).
- **[P1] S-ALUM-006** Re-activación: alumno existente entra a **otra** asignatura → pantalla "Ya tienes cuenta" → con su password → "¡Asignatura agregada!".
- **[P1] S-ALUM-007** Flujo password temporal del maestro (prefillUsername).
- **[P0] S-ALUM-008** Login correcto → dashboard con todas sus asignaturas.
- **[P1] S-ALUM-009/010** Password incorrecto / usuario inexistente → error claro.

### Dashboard
- **[P0] S-ALUM-011** Ver asignaturas inscritas con promedios y nombre del **docente** (R10).
- **[P1] S-ALUM-012** "**Unirme a otra asignatura**" → modal con código → activación → vuelve con la nueva asignatura.
- **[P2] S-ALUM-013** Empty state: "Aún no tienes asignaturas" + botón unirse.
- **[P1] S-ALUM-014** Logout → `/alumno`; guard impide volver a dashboard.

### Asignatura / Actividad / Entrega
- **[P0] S-ALUM-015/016** Actividades por parcial con iconos de estado correctos.
- **[P0] S-ALUM-017** Subir entrega (archivo permitido) → "entregado" → aparece su archivo.
- **[P1] S-ALUM-018** Validación tipo/tamaño (>5MB) → error.
- **[P1] S-ALUM-019** Marcar completada sin archivo.
- **[P0] S-ALUM-020** Ver actividad calificada con nota + comentario.
- **[P1] S-ALUM-021/022** Re-entrega con extensión / sin extensión (oculto si no hay).
- **[P0] S-ALUM-023** **Actividad oculta** NO aparece en lista NI por URL directa → "Esta actividad no está disponible" → redirige.
- **[P0] S-ALUM-024** **Actividad programada** no visible hasta `publishAt`; tras la hora, aparece.
- **[P1] S-ALUM-027** Aislamiento: entregas de una asignatura no se mezclan con otra (multi-materia).

### Theming (R2)
- **[P0] S-ALUM-026** **Ningún azul de identidad** en páginas de alumno: dashboard, login, activación, asignatura, actividad → todo en **naranja**/variable de tema. Formularios/tablas/fondos neutros sin cambio. (Inspeccionar DevTools por clases `blue-`/`indigo-` residuales.)
- **[P1] S-ALUM-029** Móvil: doble-tap no hace zoom ni doble envío.

---

## 5. Escenarios que CAMBIAN tras `PLAN_CAMBIOS.md` (no probar la versión vieja)

- **Eliminados:** todos los de **Asistencia** (D-SUBJ-23..26), **verificación de correo** (banner, reenviar, `/verify-email` como flujo activo, D-EMAIL-VERIFY-01..03), **cambiar correo** (D-PROF-04 pasa a "no existe"), **ZIP por parcial** y **ZIP por asignatura** en calificaciones (D-SUBJ-15/16), **selección de grupo** al crear asignatura.
- **Nuevos/ajustados:** D-DASH-PALETTE (paleta), D-ARCH-01..04 (archivar=esqueleto+ZIP+restaurar con datos/paleta), D-ZIP-01 (nombre=actividad, carpeta por alumno), D-REG-05 (escuela opcional), S-ALUM-026 (naranja), R17 landing por rol.
- **Regresiones a vigilar:** S-ALUM-005 (doble-submit), S-ALUM-023/024 (visibilidad), D-STU-01/02 (campo `resetPassword`), export Excel sin asistencia.

---

## 6. Reporte
Para cada escenario: `id | rol | prioridad | resultado(pass/fail) | severidad | evidencia(screenshot/console/network) | nota`. Agrupar fallos por severidad. Los blocker/major se convierten en tareas de corrección (idealmente vía workflow de fix + verificación adversarial).
