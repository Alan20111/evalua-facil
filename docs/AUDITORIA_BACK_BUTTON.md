# Auditoría — Botón físico "atrás" (Android/Capacitor)

> Generado 2026-07-14 por subagente Explore de solo lectura. Reconfirmar líneas si se movieron.

## 1. Rutas raíz (sin flecha "Volver", sesión activa)

| Rol | Ruta | Componente | Notas |
|---|---|---|---|
| Docente | `/dashboard` | `TeacherDashboard` (`src/pages/teacher/Dashboard.jsx`) | Accesible por sidebar/bottom-nav, sin flecha volver |
| Alumno | `/alumno/dashboard` | `StudentDashboard` (`src/pages/student/Dashboard.jsx`) | ídem |
| Admin | `/Admin` | `AdminDashboard` (`src/pages/admin/Dashboard.jsx`) | Ruta única; navegación interna por tabs (`activeTab` state), NO por router — no hay sub-rutas `/Admin/*` |

También son "raíz" de facto `/profile` (docente) y `/calendario` (docente) — confirmado que **NO tienen flecha "Volver"** (`src/pages/teacher/Profile.jsx:326`, `src/pages/teacher/CalendarPage.jsx:1630`, ambas envueltas en `<TeacherLayout>`), se llega a ellas por sidebar/bottom-nav igual que Dashboard, no por "push". El plan original las listaba como candidatas a flecha volver — **verificado que no aplica**.

Rutas pre-sesión (no cuentan como root de la pila, no hay sesión activa): `/`, `/docente`, `/register`, `/reset-password`, `/alumno`, `/activate/:accessCode`, `/verify-email`, `/pago-resultado`, `/onboarding`, `/protect-account`.

## 2. Todas las rutas (`src/App.jsx:130-161`)

| Path | Componente | Protección |
|---|---|---|
| `/` | `RootRedirect guest={Landing}` | pública |
| `/docente` | `RootRedirect` | pública |
| `/register` | `TeacherRegister` | pública |
| `/reset-password` | `ResetPassword` | pública |
| `/alumno` | `StudentLogin` | pública |
| `/activate/:accessCode` | `StudentActivation` | pública |
| `/verify-email` | `VerifyEmail` | pública |
| `/pago-resultado` | `PagoResultado` | pública |
| `/Admin` | `AdminDashboard` | `ProtectedAdmin` |
| `/onboarding` | `Onboarding` | `ProtectedTeacherOnboarding` |
| `/protect-account` | `ProtectAccount` | `ProtectedTeacherProtectAccount` |
| `/dashboard` | `TeacherDashboard` | `ProtectedTeacher` |
| `/subject/:subjectId` | `SubjectPage` (docente) | `ProtectedTeacher` |
| `/activity/:activityId` | `ActivityPage` (docente) | `ProtectedTeacher` |
| `/profile` | `Profile` (docente) | `ProtectedTeacher` |
| `/calendario` | `CalendarPage` | `ProtectedTeacher` |
| `/alumno/dashboard` | `StudentDashboard` | `ProtectedStudent` |
| `/alumno/materia/:subjectId` | `SubjectPage` (alumno) | `ProtectedStudent` |
| `/alumno/actividad/:activityId` | `ActivityPage` (alumno) | `ProtectedStudent` |
| `/alumno/evaluacion/:activityId` | `EvaluacionRunner` | `ProtectedStudent` |
| `/alumno/evaluacion/:activityId/revision` | `EvaluacionRevision` | `ProtectedStudent` |
| `/alumno/notificaciones` | `NotificationSettings` | `ProtectedStudent` |
| `/alumno/agenda` | `StudentAgenda` | `ProtectedStudent` |
| `*` | redirect a `/` | — |

## 3. Pantallas con flecha "Volver"

| Rol | Componente | Archivo:línea del onClick | Navega a |
|---|---|---|---|
| Docente | SubjectPage | `src/pages/teacher/SubjectPage.jsx:2065` | `navigate('/dashboard')` |
| Docente | ActivityPage | `src/pages/teacher/ActivityPage.jsx:726` | `navigate(\`/subject/${activity?.asignaturaId}\`, returnToGrades ? {state:{tab:'calificaciones'}} : undefined)` |
| Docente | Profile | — | **No tiene flecha volver** (root de nav, confirmado) |
| Docente | CalendarPage | — | **No tiene flecha volver** (root de nav, confirmado) |
| Docente | admin/* | — | No existen sub-rutas bajo `/Admin/*`; es una sola ruta con tabs internos |
| Alumno | SubjectPage | `src/pages/student/SubjectPage.jsx:224` | `navigate('/alumno/dashboard')` |
| Alumno | ActivityPage | `src/pages/student/ActivityPage.jsx:329` | `navigate(\`/alumno/materia/${activity?.asignaturaId}\`)` |
| Alumno | EvaluacionRunner | `src/pages/student/EvaluacionRunner.jsx:303` | **No es flecha simple** — botón "Salir" abre `showExitModal` (ver Caso especial 1) |
| Alumno | EvaluacionRevision | `src/pages/student/EvaluacionRevision.jsx:88` | `navigate(\`/alumno/actividad/${activityId}\`)` |
| Alumno | NotificationSettings | `src/pages/student/NotificationSettings.jsx:129` | `navigate('/alumno/dashboard')` |
| Alumno | Agenda | `src/pages/student/Agenda.jsx:130` | `navigate('/alumno/dashboard')` |

Extra (no es ruta, pero tiene flecha "Regresar" propia dentro de una pantalla-modal fullscreen):
- `EvaluacionManager.jsx:1350` (vista de revisión de entrega de un alumno, dentro de ActivityPage docente para actividades tipo evaluación): `onClick={() => backState ? navigate(\`/subject/${activity.asignaturaId}\`, {state: backState}) : setReviewing(null)}` — condicional según de dónde se abrió.
- Vista fullscreen de calificación en `ActivityPage.jsx` (docente), controlada por `selected` (línea 127) y cerrada con `closeModal` (línea 304-322, async: guarda antes de cerrar, y si `returnToGrades` navega a `/subject/:id`).
- `ProgramarZonaSemanal.jsx:272` botón `ArrowLeft` con `onClick={intentarSalir}` (línea 247) — no cierra directo, ver Caso especial 3.

## 4. Modales / drawers dismissibles

### Globales (en los layouts, afectan TODAS las pantallas de ese rol)

| Nombre | Archivo | Estado | Cierra con |
|---|---|---|---|
| Confirmar logout (docente) | `src/components/Layout.jsx:39,301-338` | `const [confirmLogout, setConfirmLogout] = useState(false)` | `setConfirmLogout(false)` |
| Confirmar logout (alumno) | `src/components/StudentLayout.jsx:24,238-269` | `const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)` | `setShowLogoutConfirm(false)` — **ya con `useBackHandler`, ver §6** |
| Logo completo (alumno) | `src/components/StudentLayout.jsx:25,272-282` | `const [showFullLogo, setShowFullLogo] = useState(false)` | `setShowFullLogo(false)` |

### `src/pages/teacher/SubjectPage.jsx` (docente) — ~28 estados de modal/menú propios

| Nombre | Estado (línea) | Cierra con |
|---|---|---|
| Menú exportar (excel/pdf) | `topExportMenu` (166) | `setTopExportMenu(null)` |
| Crear/editar actividad | `showModal` (133) | `setShowModal(false)` |
| Confirmar duplicar actividad | `duplicateConfirm` (149) | `setDuplicateConfirm(null)` |
| Confirmar publicar borrador | `publishDraftConfirm` (148) | `setPublishDraftConfirm(null)` |
| Confirmar eliminar actividad | `deleteConfirm` (147) | `setDeleteConfirm(null)` |
| Crear/editar material de apoyo | `showMaterialModal` (192) | `setShowMaterialModal(false)` |
| Confirmar eliminar material | `deleteMaterialConfirm` (200) | `setDeleteMaterialConfirm(null)` |
| Agregar alumno | `showAddStudent` (251) | `setShowAddStudent(false)` |
| Editar alumno | `studentToEdit` (254) | `setStudentToEdit(null)` |
| QR de activación | `showQR` (252) | `setShowQR(false)` |
| Confirmar reset password alumno | `studentToReset` (256) | `setStudentToReset(null)` |
| Generar credenciales | `showCredentialsModal` (209) | `setShowCredentialsModal(false)` |
| Menú ⋮ por actividad | `activityMenu` (170) | `setActivityMenu(null)` |
| Traer actividad de otra materia | `importFor` (172) | `setImportFor(null)` |
| Menú ⋮ por parcial | `parcialMenu` (164) | `setParcialMenu(null)` |
| Confirmar revertir ponderación (todos) | `confirmRevertPonderacion` (154) | `setConfirmRevertPonderacion(false)` |
| Confirmar revertir ponderación (uno) | `confirmRevertParcial` (155) | `setConfirmRevertParcial(null)` |
| Confirmar cerrar parcial | `closeParcialConfirm` (157) | `setCloseParcialConfirm(null)` |
| Confirmar revertir cierre parcial | `revertParcialConfirm` (161) | `setRevertParcialConfirm(null)` |
| Cuenta duplicada — vincular | `linkCandidate` (258) | `setLinkCandidate(null)` |
| Recuperación habilitada (confirm) | `resetPwdResult` (257) | `setResetPwdResult(null)` |
| Confirmar eliminar alumno | `studentToDelete` (253) | `setStudentToDelete(null)` |
| Editar asignatura | `showEditSubjectModal` (216) | `setShowEditSubjectModal(false)` |
| Copiar asignatura | `showCopyModal` (222) | `setShowCopyModal(false)` |
| Confirmar eliminar asignatura | `showDeleteSubjectConfirm` (219) | `setShowDeleteSubjectConfirm(false)` |
| Archivar asignatura | `showArchiveModal` (234) | `setShowArchiveModal(false)` |
| Desarchivar asignatura | `showUnarchiveModal` (228) | `setShowUnarchiveModal(false)` |
| Agregar/editar recurso | `showResourceModal` (269) | `setShowResourceModal(false)` |
| Confirmar eliminar recurso | `deleteResourceConfirm` (274) | `setDeleteResourceConfirm(null)` |
| Editor de entregable (full-page) | `entregableEditor` (143) | `onClose={() => setEntregableEditor(null)}` (línea 4365) |
| Editor de evaluación (full-page) | `evalEditor` (141) | via `<EvaluacionEditor onClose>` (línea 4394) |
| Nueva fecha de entrega | `newDateOpen` (145) | `setNewDateOpen(false)` |

### `src/pages/teacher/ActivityPage.jsx` (docente)

| Nombre | Estado (línea) | Cierra con |
|---|---|---|
| Editar actividad (EntregableEditor) | `editingActivity` (190) | `onClose={() => setEditingActivity(false)}` (1620) |
| Vista fullscreen de calificación de un alumno | `selected` (127) | `closeModal` (304, async — guarda cambios pendientes antes de cerrar; si `returnToGrades`, navega a `/subject/:id`) |
| Nueva fecha de entrega | `newDateOpen` (122) | `setNewDateOpen(false)` (1657) |
| Modo anular entrega / extender plazo | `annulMode` / `extendMode` | toggles inline dentro del panel de calificación, no son overlay `fixed inset-0` independiente |

### `src/components/EvaluacionManager.jsx` (usado dentro de ActivityPage docente cuando `activity.tipo === 'evaluacion'`)

| Nombre | Estado (línea) | Cierra con |
|---|---|---|
| Banco de preguntas | `showBanco` (86) | `setShowBanco(false)` |
| Vista de revisión de entrega de un alumno (fullscreen) | `reviewing` (109) | Ver flecha "Regresar" arriba (línea 1350) — condicional |
| Confirmar anular entrega | `cancelConfirm` (77) | `setCancelConfirm(null)` |
| Editor completo de evaluación | `showEvalEditor` (73) | `closeEvalEditor` (función async, línea 493) |

### `src/components/EvaluacionEditor.jsx` (full-page, abierto vía `evalEditor`/`showEvalEditor`)

| Nombre | Estado (línea) | Cierra con |
|---|---|---|
| Banco de preguntas | `showBanco` (114) | `setShowBanco(false)` |
| Nueva fecha de entrega | `newDateOpen` (81) | `setNewDateOpen(false)` (1166) |
| Propio botón "Volver" del editor | — | `onClick={onClose}` (línea 577) — llama al `onClose` que le pasó el padre |

### `src/components/EntregableEditor.jsx` (full-page, abierto vía `editingActivity`/`entregableEditor`)

| Nombre | Estado (línea) | Cierra con |
|---|---|---|
| Selector de rúbrica | `rubricaPickerOpen` (97) | `setRubricaPickerOpen(false)` (482) |
| Editor de rúbrica | `rubricaEditorOpen` (98) | `setRubricaEditorOpen(false)` (495) |
| Propio botón "Volver" | — | `onClick={onClose}` (línea 231) |

### `src/components/rubrica/RubricaPicker.jsx` / `RubricaEditor.jsx`

No tienen `onClose` propio en estado — reciben `onClose` como prop del padre (`EntregableEditor`). Internamente: `RubricaPicker` tiene `confirmDeleteId` (línea 19, confirmar borrar rúbrica del banco) cerrado con `setConfirmDeleteId(null)`.

### `src/pages/teacher/CalendarPage.jsx`

| Nombre | Estado (línea) | Cierra con |
|---|---|---|
| Editor de evento | `showEventEditor` (933) | `closeEventEditor` (función, línea 1119) |
| Programar bloques (paso 1) | `programar` | `onClose={() => setProgramar(null)}` (1828) |
| Programar zona semanal (paso 2, full-page) | `zona` (939) | `onCancel={() => setZona(null)}` (1845) — pero el botón interno de "Volver" no llama esto directo, ver Caso especial 3 |

### `src/components/calendar/EventEditor.jsx` / `ProgramarBloquesModal.jsx` / `ProgramarZonaSemanal.jsx`

Reciben `onClose`/`onCancel` como prop. Internos:
- `EventEditor`: `confirmDelete` (línea 34) — confirmar eliminar evento.
- `ProgramarBloquesModal`: `confirmDel` (línea 33) — confirmar borrar programación.
- `ProgramarZonaSemanal`: `placing` (70, popover colocar bloque), `editing`/`editP` (71, popover editar bloque colocado), `confirmSalir` (73, ver Caso especial 3).

⚠️ **`src/components/calendar/BloqueEditor.jsx` existe pero no está importado/usado en ningún lugar del código** (verificado con búsqueda global) — componente huérfano, no aplica para el back button porque es inalcanzable.

### `src/pages/teacher/Profile.jsx`

| Nombre | Estado (línea) | Cierra con |
|---|---|---|
| Checkout / activar suscripción | `showPaymentModal` (213) → `<CheckoutModal open={showPaymentModal}>` | `onClose` pasado a `CheckoutModal` |
| Selector de escuela (con sub-pasos `customSchoolStep`) | `showSchoolPicker` (71) | `setShowSchoolPicker(false)` |
| Confirmación genérica (varios usos) | `confirm` (210, `{title,message,onConfirm}` \| null) | `setConfirm(null)` |

### Otros

| Nombre | Archivo | Estado | Cierra con |
|---|---|---|---|
| CheckoutModal (raíz propia) | `src/components/CheckoutModal.jsx:32` | controlado por prop `open` del padre (Profile) | prop `onClose` |
| LinkAccountModal | `src/components/LinkAccountModal.jsx:24` | `showLinkAccount` en `src/pages/teacher/Login.jsx:171` | `setShowLinkAccount(false)` |
| Nueva fecha de entrega (genérico) | `src/components/NuevaFechaEntregaModal.jsx:14` | ver arriba (usado desde 3 padres distintos) | prop `onClose` |
| Nueva asignatura (docente) | `src/pages/teacher/Dashboard.jsx` | `showSubjectModal` | `setShowSubjectModal(false)` |
| Unirse a materia (alumno) | `src/pages/student/Dashboard.jsx` | `showJoin` | `setShowJoin(false)` |
| Nueva/editar suscripción (admin) | `src/pages/admin/components/SubscriptionsTable.jsx` | `modal` | cierra con setter equivalente (`setModal(null)`) |
| Rechazar pago (admin) | `src/pages/admin/components/PaymentsTable.jsx` | `rejectModal` | `setRejectModal(null)` |
| Lightbox de adjuntos | `src/components/AttachmentList.jsx:172-182` | controlado por estado del padre (ej. `previewIdx` en `ActivityPage.jsx` docente, línea 1290) | prop `onClose` |
| StudentMenu | — | **No existe en el repo** (verificado, sin coincidencias) |
| PlanCompareModal | — | **No existe en el repo** (verificado, sin coincidencias) |

## 5. Casos especiales

### 1. `EvaluacionRunner.jsx` (modo examen del alumno)
No tiene flecha "Volver" simple. Tiene botón "Salir" (`src/pages/student/EvaluacionRunner.jsx:303`) que abre `showExitModal` (línea 311-338): modal de confirmación "¿Salir de la evaluación?" con aviso de que el cronómetro sigue corriendo. Confirmar navega a `navigate(\`/alumno/actividad/${activityId}\`)` (línea 331). **Decisión de diseño para Fase 3:** el botón físico atrás debe disparar `setShowExitModal(true)` en vez de un pop directo de la pila (o, si `showExitModal` ya está abierto, cerrarlo).

### 2. `EvaluacionManager.jsx` — vista "reviewing" (revisión de entrega de un alumno)
Botón "Regresar" (línea 1350) con lógica condicional: si `backState` está presente (se abrió desde una celda de la tabla de Calificaciones), navega directo a `/subject/:id` con ese state; si no, hace `setReviewing(null)`. El manejador de atrás debe replicar exactamente esta condición, no un simple pop.

### 3. `ProgramarZonaSemanal.jsx` (calendario docente, programar bloques semanales)
Botón "Volver" (línea 272) llama a `intentarSalir()` (línea 247-250), NO cierra directo: si `patrones.length === 0` sale sin preguntar (`onCancel?.()`), si hay bloques colocados sin guardar muestra `confirmSalir` (modal "¿Salir sin guardar?"). El back físico debe invocar `intentarSalir`, no `onCancel` directo.

### 4. `ActivityPage.jsx` (docente) — `closeModal` de la vista de calificación
`closeModal` (línea 304) es `async`: si `autoSaveOnNav && isDirty()` intenta `persistGrade()` antes de cerrar, y si falla muestra un toast y **no cierra**. Un pop de pila ciego perdería el autoguardado o cerraría con error silencioso — debe invocar esta función, no `setSelected(null)` directo.

### 5. Wizards / flujos multi-paso con estado propio
- **`/activate/:accessCode`** (`StudentActivation`, `src/pages/student/Activation.jsx:27`): `step` = `'username' | 'password' | 'link_existing'`. Un atrás debería revertir al paso anterior del wizard mientras `step !== 'username'`, y solo salir de la pantalla (a `/alumno`) en el primer paso.
- **`/register`** (`TeacherRegister`): NO es wizard — un solo formulario, sin estado de pasos.
- **`/onboarding`** y **`/protect-account`**: formularios de un solo paso, sin estado de wizard interno.
- **`/alumno` (`StudentLogin`)**, aunque es pre-sesión: tiene `mode` (login/código/recuperar) y `recoverStep` (`'username' | 'password'`) — mismo patrón de wizard que Activation, con su propio botón "Volver al inicio de sesión" (línea 294). Vale la pena tenerlo en mente aunque sea pre-auth, por si el back físico debe respetar estos sub-pasos en vez de salir de la app (fuera del alcance inmediato: sin sesión, el listener nativo aplica igual, pero no hay pila de la app — decidir si se deja al comportamiento default del sistema o se cablea también).

## 6. Ya implementado (infraestructura + caso de prueba mínimo, previo a esta auditoría)

- `src/hooks/useBackHandler.js` — pila global + `popAndRunTop()`.
- `src/components/AndroidBackButton.jsx` — listener nativo `backButton`, montado en `App.jsx`, con "presiona de nuevo para salir" (toast + `exitApp()`).
- Caso de prueba mínimo ya aplicado: `StudentDashboard` (raíz, sin cambios — pila vacía correctamente), `SubjectPage` alumno (flecha refactorizada a `goBack` + `useBackHandler(goBack)`), modal de logout de `StudentLayout.jsx` (`useBackHandler(() => setShowLogoutConfirm(false), showLogoutConfirm)`).

## Resumen de conteos

- **3 rutas raíz** con sesión activa (`/dashboard` docente, `/alumno/dashboard` alumno, `/Admin` — sin sub-rutas, solo tabs internos); **8 rutas pre-sesión** que no cuentan.
- **8 pantallas de ruta con "back"**: 2 en docente (SubjectPage, ActivityPage — Profile y CalendarPage NO tienen flecha) y 6 en alumno (SubjectPage, ActivityPage, EvaluacionRevision, NotificationSettings, Agenda, más EvaluacionRunner con flujo "Salir" especial).
- **Modales/drawers: 45+ estados** dismissibles confirmados en todo el repo (SubjectPage docente concentra ~31 ella sola).
- `StudentMenu` y `PlanCompareModal` **no existen** en el código (mencionados en el plan original pero nunca se implementaron).
- `BloqueEditor.jsx` existe pero está **huérfano/sin uso** — no aplica.
- **4 casos especiales** que no deben usar un pop genérico: "Salir" con confirmación de EvaluacionRunner, back condicional de `reviewing` en EvaluacionManager, `intentarSalir` con guard de ProgramarZonaSemanal, `closeModal` async-con-autoguardado de ActivityPage docente.
- **2 wizards** con estado de pasos propio: `/activate/:code` (`step`) y, aunque pre-sesión, `/alumno` login (`mode`/`recoverStep`).
