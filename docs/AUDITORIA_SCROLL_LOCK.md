# Auditoría de ventanas flotantes para `useScrollLock`

> Generado 2026-07-14 por subagente Explore de solo lectura. Reconfirmar líneas si se movieron.

Ya confirmado y **excluido de los lotes** (se aplican en la Fase 4 del plan):
- `src/components/EFDateTimePicker.jsx:855` — `createPortal`, popover del selector de fecha/hora.
- `src/components/calendar/EventEditor.jsx:113` — `fixed inset-0 z-50 flex items-center justify-center p-4`.

## Tabla completa

| Archivo:línea | Rol | Overlay | ¿Scroll interno propio? | Montaje | Lote |
|---|---|---|---|---|---|
| `src/pages/teacher/SubjectPage.jsx:3023` | Docente | Crear/editar actividad (`showModal`) | Sí, `overflow-y-auto` en la tarjeta | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3191` | Docente | Confirmar duplicar actividad (`duplicateConfirm`) | No | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3214` | Docente | Confirmar publicar borrador (`publishDraftConfirm`) | No | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3247` | Docente | Confirmar eliminar actividad (`deleteConfirm`) | No | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3269` | Docente | Crear/editar material de apoyo (`showMaterialModal`) | Sí, `overflow-y-auto` | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3358` | Docente | Confirmar eliminar material (`deleteMaterialConfirm`) | No | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3380` | Docente | Agregar estudiante (`showAddStudent`) | Sí, `overflow-y-auto` | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3418` | Docente | Editar estudiante (`studentToEdit`) | Sí, `overflow-y-auto` | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3500` | Docente | QR / código de acceso (`showQR`) | Sí, `overflow-y-auto` | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3538` | Docente | Confirmar habilitar recuperación de contraseña (`studentToReset`) | Sí, `overflow-y-auto` | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3571` | Docente | Descargar lista de acceso (`showCredentialsModal`) | Sí, `overflow-y-auto` | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3640` | Docente | Traer actividad de otra asignatura (`importFor`) | Sí, `overflow-y-auto` en el body interno | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3773` | Docente | Revertir ponderación general (`confirmRevertPonderacion`) | No | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3796` | Docente | Revertir ponderación de un parcial (`confirmRevertParcial`) | No | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3819` | Docente | Cerrar parcial (`closeParcialConfirm`) | No (contenido corto) | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3893` | Docente | Revertir cierre de parcial (`revertParcialConfirm`) | No | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3916` | Docente | ¿Mismo estudiante? — vincular cuenta (`linkCandidate`) | No | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3966` | Docente | Confirmación recuperación habilitada (`resetPwdResult`) | Sí, `overflow-y-auto` | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:3990` | Docente | Confirmar eliminar estudiante (`studentToDelete`) | Sí, `overflow-y-auto` | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:4023` | Docente | Editar asignatura (`showEditSubjectModal`) | Sí, `overflow-y-auto` | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:4087` | Docente | Duplicar asignatura (`showCopyModal`) | Sí, `overflow-y-auto` | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:4153` | Docente | Confirmar eliminar asignatura (`showDeleteSubjectConfirm`) | Sí, `overflow-y-auto` | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:4189` | Docente | Archivar asignatura (`showArchiveModal`) | Sí, `overflow-y-auto` | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:4232` | Docente | Desarchivar asignatura (`showUnarchiveModal`) | Sí, `overflow-y-auto` | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:4326` | Docente | Agregar/editar recurso (`showResourceModal`) | Sí, `overflow-y-auto` | Condicional | 1 |
| `src/pages/teacher/SubjectPage.jsx:4385` | Docente | Confirmar eliminar recurso (`deleteResourceConfirm`) | No | Condicional | 1 |
| `src/components/EvaluacionManager.jsx:725` | Docente | Spinner de transición (`openingFromGrades`) — sin tarjeta, solo spinner centrado | No | Condicional | 2 |
| `src/components/EvaluacionManager.jsx:992` | Docente | Banco de reactivos (`showBanco`) | Sí, `overflow-y-auto` | Condicional | 2 |
| `src/components/EvaluacionManager.jsx:1347` | Docente | Revisión de respuestas de un alumno (`reviewing`) — pantalla completa | Sí (áreas internas con scroll) | Condicional | 2 |
| `src/components/EvaluacionManager.jsx:1543` | Docente | Confirmar anular entrega (`cancelConfirm`) | No | Condicional | 2 |
| `src/components/EvaluacionEditor.jsx:579` | Docente | Editor completo de cuestionario/examen (raíz del componente) | Sí, `overflow-y-auto` en toda la pantalla | Condicional (padre monta el componente solo cuando aplica) | 2 |
| `src/components/EvaluacionEditor.jsx:1041` | Docente | Banco de reactivos (`showBanco`) | Sí, contenedor con `height: min(90vh,700px)` y scroll interno | Condicional | 2 |
| `src/pages/teacher/CalendarPage.jsx:1868` | Docente | Elegir asignatura para "Modificar bloques" (`showModificarPicker`) | Sí, lista con `max-h-[60vh] overflow-y-auto` | Condicional | 3 |
| `src/pages/teacher/CalendarPage.jsx:1946` | Docente | Mover/borrar una clase puntual (`pendingMove`) | No | Condicional | 3 |
| `src/pages/teacher/CalendarPage.jsx:2060` (función `AsuetoManager`) | Docente | Administrar días de asueto (`showAsuetos`) | Sí, `overflow-y-auto flex-1` | Condicional | 3 |
| `src/pages/teacher/CalendarPage.jsx:2179` (función `VacacionManager`) | Docente | Administrar vacaciones (`showVacaciones`) | Sí, `overflow-y-auto flex-1` | Condicional | 3 |
| `src/components/calendar/ProgramarZonaSemanal.jsx:279` | Docente | Pantalla completa "Programar/Reacomodar bloques" (raíz) | Sí — lienzo interactivo de arrastrar/soltar, no un simple scroll; **cuidado especial** | Condicional (`zona &&` en CalendarPage) | 3 |
| `src/components/calendar/ProgramarZonaSemanal.jsx:487` | Docente | Popover "Colocar bloque" (`placing`) | No | Condicional | 3 |
| `src/components/calendar/ProgramarZonaSemanal.jsx:566` | Docente | Popover "Editar bloque" (`editP`) | No | Condicional | 3 |
| `src/components/calendar/ProgramarZonaSemanal.jsx:696` | Docente | Confirmar salir sin guardar (`confirmSalir`) | No | Condicional | 3 |
| `src/pages/teacher/ActivityPage.jsx:952` | Docente | Vista completa de calificación (`selected`) | Sí, múltiples paneles internos con scroll | Condicional | 4 |
| `src/components/EntregableEditor.jsx:236` | Docente | Editor completo de entregable/observación (raíz) | Sí, `overflow-y-auto` en toda la pantalla | Condicional | 4 |
| `src/components/NuevaFechaEntregaModal.jsx:69` | Docente | Nueva fecha de entrega (grupo o alumnos) | Verificar scroll normal de página | Siempre montado mientras el padre lo renderiza (`useBackHandler(onClose, true)`) | 4 |
| `src/components/AttachmentList.jsx:182` (`createPortal`) | Compartido | `FilePreviewModal` — vista previa de archivo adjunto | Sí, `overflow-auto` en el área de preview | Condicional | 4 |
| `src/components/rubrica/RubricaEditor.jsx:409` | Docente | Editor de rúbrica | Sí, `overflow-y-auto` en toda la pantalla | Condicional (`editing &&`) | 5 |
| `src/components/rubrica/RubricaPicker.jsx:73` | Docente | Banco de rúbricas (selector) | Sí, `overflow-y-auto` | Condicional (`rubricaPickerOpen &&`) | 5 |
| `src/components/calendar/BloqueEditor.jsx:155` | Docente | Editar un bloque de horario colocado | Probable, verificar | Condicional — **archivo huérfano, sin ningún `import` en todo el repo (confirmado por grep)** | 5 |
| `src/components/calendar/ProgramarBloquesModal.jsx:65` | Docente | Configurar programación de bloques (paso 1/2) | Sí, `max-h-[92vh] flex flex-col` con áreas internas scrollables | Condicional (`programar &&`) | 5 |
| `src/pages/teacher/Profile.jsx:572` | Docente | Confirmación genérica (`confirm`) | No | Condicional | 6 |
| `src/pages/teacher/Profile.jsx:598` | Docente | Selector de escuela (`showSchoolPicker`) | Sí, `overflow-y-auto` en variantes internas | Condicional | 6 |
| `src/components/CheckoutModal.jsx:192` | Docente | Checkout de suscripción | Sí, `overflow-y-auto` | **Prop `open`** — siempre renderizado, retorna `null` si `!open` | 6 |
| `src/components/Layout.jsx:308` | Docente | Confirmar cierre de sesión | No | Condicional | 6 |
| `src/pages/teacher/Dashboard.jsx:309` | Docente | Nueva asignatura (`showSubjectModal`) | Sí, `overflow-y-auto overflow-x-hidden` | Condicional | 6 |
| `src/components/LinkAccountModal.jsx:78` | Docente | "Acceso desde otra computadora" | Verificar | Condicional (`showLinkAccount &&`) | 6 |
| `src/components/StudentLayout.jsx:242` | Alumno | Confirmar cierre de sesión | No | Condicional | 7 |
| `src/components/StudentLayout.jsx:276` | Alumno | Logo completo ampliado (`showFullLogo`) | No (imagen) | Condicional | 7 |
| `src/pages/student/Dashboard.jsx:352` | Alumno | Unirse a asignatura (`showJoin`) | Verificar | Condicional | 7 |
| `src/pages/student/EvaluacionRunner.jsx:268` | Alumno | Pantalla de carga (`loading \|\| !activity`) | No | Ruta (React Router) | 7 |
| `src/pages/student/EvaluacionRunner.jsx:275` | Alumno | Estado "sin preguntas" | No | Ruta | 7 |
| `src/pages/student/EvaluacionRunner.jsx:288` | Alumno | Pantalla completa de la evaluación (raíz) | Sí, `overflow-y-auto` | Ruta (`/alumno/evaluacion/:activityId`) | 7 |
| `src/pages/student/EvaluacionRunner.jsx:320` | Alumno | Confirmar salir de la evaluación (`showExitModal`) | No | Condicional | 7 |
| `src/pages/student/Agenda.jsx:128` | Alumno | Pantalla completa de Agenda (raíz) | Sí, `overflow-y-auto` | Ruta (`/alumno/agenda`) | 7 |
| `src/pages/student/NotificationSettings.jsx:128` | Alumno | Pantalla completa de notificaciones (raíz) | Sí, `overflow-y-auto` | Ruta (`/alumno/notificaciones`) | 7 |
| `src/pages/admin/components/PaymentsTable.jsx:176` | Admin | Rechazar pago (`rejectModal`) | Sí, `max-h-[90vh] overflow-y-auto` | Condicional | 8 |
| `src/pages/admin/components/SubscriptionsTable.jsx:243` | Admin | Crear/editar suscripción (`modal`) | Sí, `max-h-[90vh] overflow-y-auto` | Condicional | 8 |
| `src/components/AdminLayout.jsx:111` | Admin | Backdrop del drawer móvil (`mobileOpen`) — caso raro, sin tarjeta | N/A | Condicional | 8 |

## Lotes (archivos disjuntos)

- **Lote 1** — `src/pages/teacher/SubjectPage.jsx` (26 overlays; archivo enorme, se deja solo por volumen).
- **Lote 2** — `src/components/EvaluacionManager.jsx`, `src/components/EvaluacionEditor.jsx`.
- **Lote 3** — `src/pages/teacher/CalendarPage.jsx`, `src/components/calendar/ProgramarZonaSemanal.jsx`.
- **Lote 4** — `src/pages/teacher/ActivityPage.jsx`, `src/components/EntregableEditor.jsx`, `src/components/NuevaFechaEntregaModal.jsx`, `src/components/AttachmentList.jsx`.
- **Lote 5** — `src/components/rubrica/RubricaEditor.jsx`, `src/components/rubrica/RubricaPicker.jsx`, `src/components/calendar/BloqueEditor.jsx`, `src/components/calendar/ProgramarBloquesModal.jsx`.
- **Lote 6** — `src/pages/teacher/Profile.jsx`, `src/components/CheckoutModal.jsx`, `src/components/Layout.jsx`, `src/pages/teacher/Dashboard.jsx`, `src/components/LinkAccountModal.jsx`.
- **Lote 7** — `src/components/StudentLayout.jsx`, `src/pages/student/Dashboard.jsx`, `src/pages/student/EvaluacionRunner.jsx`, `src/pages/student/Agenda.jsx`, `src/pages/student/NotificationSettings.jsx`.
- **Lote 8** — `src/pages/admin/components/PaymentsTable.jsx`, `src/pages/admin/components/SubscriptionsTable.jsx`, `src/components/AdminLayout.jsx`.

## Resumen

- Total de overlays encontrados (sin contar `EFDateTimePicker.jsx` ni `EventEditor.jsx`): **66 bloques JSX** repartidos en **25 archivos** (67/26 si se incluye el caso raro de `AdminLayout.jsx`).
- 2 usos de `createPortal` en todo el repo: `EFDateTimePicker.jsx` (excluido, Fase 4) y `AttachmentList.jsx:181` (`FilePreviewModal`, Lote 4).
- 8 lotes, todos disjuntos por archivo. `SubjectPage.jsx` concentra el 39% de los overlays (26 de 66) y va solo.
- Patrón de montaje: todos condicionales excepto `CheckoutModal.jsx` (prop `open`). Las 3 pantallas del alumno montadas por ruta (`EvaluacionRunner`, `Agenda`, `NotificationSettings`) equivalen en la práctica a montaje condicional — `useScrollLock(true)` aplica igual.

### Casos raros / atención especial

1. `src/components/calendar/BloqueEditor.jsx` — **sin ningún `import` en todo el repo** (confirmado). Código huérfano/muerto probable; aplicar el hook no hace daño, pero señalar antes de invertir tiempo si se confirma que no está en uso.
2. `src/components/AdminLayout.jsx:111` — backdrop del drawer lateral móvil, sin tarjeta centrada; no sigue el patrón dominante `items-center/items-end` pero el drawer (`<aside>` hermano) podría beneficiarse igual.
3. Varios backdrops `fixed inset-0` **sin tarjeta** (solo cierran menús/dropdowns pequeños: selector de fecha, selector de horas, menús "⋮"), en `CalendarPage.jsx:1499,1596` y `SubjectPage.jsx:2505,2538,3619,3727` — quedaron **fuera de los lotes** por no calzar con el patrón backdrop+tarjeta pedido; señalados por si se quiere ampliar el alcance más adelante.
4. `src/components/Fireworks.jsx:296` — tiene `fixed inset-0` pero es un `<canvas>` con `pointer-events-none`, no es una ventana flotante interactiva. Excluido, no aplica.
5. `src/pages/teacher/ActivityPage.jsx` tiene una "ventana flotante de rúbrica" (`rubricaViewOpen`, ~línea 1575) con `fixed left-2 right-2 md:left-1/2` (sin backdrop ni `inset-0`) — no calza con los patrones pedidos, señalada por si se quiere evaluar aparte.
6. `EvaluacionManager.jsx:725` es solo un spinner centrado (pantalla de transición), sin tarjeta ni contenido arrastrable — bajo impacto, incluido para inventario completo.
7. Varios overlays "pantalla completa" con su propio `overflow-y-auto` cubriendo toda la pantalla (`EntregableEditor`, `EvaluacionEditor`, `RubricaEditor`, `RubricaPicker`, `Agenda`, `NotificationSettings`, `EvaluacionRunner`, la revisión de `EvaluacionManager`) son los que más justifican verificación manual tras aplicar el hook — ahí el fix debe evitar que el overscroll del propio scroll se filtre al body de fondo, sin romper el scroll normal del contenido.
