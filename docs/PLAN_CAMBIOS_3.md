# Plan de cambios — Lote 3 (ajustes finos docente + 2 bugs)

> SOLO PLAN (no ejecutar). Aterrizado en código real; líneas son guía. Convenciones vigentes: "Asignatura" nunca "Materia"; tokens Luminous; acento por rol/asignatura; sin rangos Firestore; build+lint por fase.

## ⚠️ CONTRADICCIÓN A CONFIRMAR
- **Orden de pestañas (R13):** en el Lote 2 pediste `Actividades · Alumnos · Calificaciones`; ahora pides `Actividades · Calificaciones · Alumnos` ("alumnos solo se usa casi al principio"). El plan asume **lo último: Actividades · Calificaciones · Alumnos**. Confirmar.

## DECISIONES ABIERTAS
1. **Trial 45 días (R1):** lo planteaste como pregunta ("¿le ponemos 45 días?"). El plan asume **sí, 45**. Confirmar.
2. **Excel/PDF de la pestaña Alumnos (R12):** pides que descarguen "las calificaciones de los alumnos". Hoy el botón "Excel" de esa pestaña baja la LISTA de alumnos y el "PDF" la lista con QR; las calificaciones se exportan en la pestaña Calificaciones. **Decisión:** ¿el Excel/PDF de Alumnos debe bajar CALIFICACIONES (requiere crear un PDF de calificaciones nuevo) o dejamos que bajen la lista y solo ajustamos textos? Recomendado: que bajen calificaciones (Excel ya existe vía `exportSubjectGrades`; el PDF de calificaciones es nuevo).
3. **Plan de paga (R9):** aún no tiene nombre ni lista de características definida ("no sé cómo le llamaremos"). Necesito el **nombre y las características** del plan gratuito y del de paga para llenar la comparación.
4. **Tipos de archivo múltiples + personalizado (R7):** hoy `FileTypeSelect` es de selección única. Permitir varios + extensión propia es una mejora mayor (cambia el componente y el guardado de `tiposArchivo` a lista). Confirmar alcance.

---

## R1 — Periodo de prueba 60 → 45 días
**Archivo:** `src/pages/teacher/Register.jsx:102` (`trialEnd.setDate(getDate() + 60)` → `+ 45`). Verificar si hay otra referencia a 60 (no la hay en lógica de trial).

## R2 — Escuela: opción "Agregar escuela" (escribir el nombre)
**Objetivo:** en el selector de escuela, además de "Sin escuela" (skip), permitir **escribir el nombre** de una escuela no listada (ej. Telesecundaria).
**Archivos:** `src/pages/teacher/Register.jsx` (picker + handleSubmit), y el picker del Perfil (`Profile.jsx`) por consistencia.
**Pasos:** en el overlay del picker, agregar un input "Agregar escuela (escribe el nombre)" + botón. Al usarlo: crear doc en `schools` con `{ nombre: <texto>, shortName: <derivado>, custom: true }` y usar su id como `escuelaId`; username docente con prefijo derivado del nombre. (Reusa la lógica de creación de escuela ya existente, pero con nombre manual en vez de `selectedPlantel`.)
**Riesgo:** evitar duplicados exactos (buscar por nombre antes de crear). `escuelaId` debe quedar estable (emails de alumno).

## R3 — Sección de acceso del alumno: etiquetas + nota explicativa
**Objetivo:** dejar claro que QR, link y código son **3 modos de acceso para los alumnos** (el docente usa el que prefiera; explicar la diferencia), no que deba aplicar los 3.
**Archivos:** `src/pages/teacher/SubjectPage.jsx` — tooltips del header (`:760` "Código QR de acceso" → "Código QR de acceso para alumnos"; `:765` "Copiar link de activación" → "Link de activación para alumnos"; `:770` "Copiar código de acceso" → "Código de acceso para alumnos") y el **modal QR** (`:1301+`).
**Pasos:** en el modal QR, encabezado/nota: "Comparte UNA de estas 3 formas con tus alumnos para que entren" + breve descripción de cada una (QR = escanear en clase; Link = enviar por chat; Código = dictarlo). Etiquetas de botones según lo pedido.

## R4 — "Copiar asignatura" → "Duplicar asignatura"
**Archivos:** `SubjectPage.jsx` — tooltip header (`:782`), título del modal de copiar (`Copiar asignatura` ~:1537), botón "Crear copia" → "Duplicar"/"Crear duplicado", toast "Asignatura copiada" → "Asignatura duplicada". Mantener la función `copySubject` (solo textos).

## R5 — "Archivar" → "Archivar asignatura"
**Archivo:** `SubjectPage.jsx:787` tooltip `archived ? 'Restaurar' : 'Archivar'` → `'Restaurar asignatura' : 'Archivar asignatura'`. (El título del modal ya dice "Archivar asignatura".)

## R6 — Sin "Periodo/Ciclo": fecha de inicio + fecha de fin (opcionales)
**Objetivo:** quitar el selector de período y el campo "Ciclo escolar"; usar **fecha de inicio** y **fecha de fin** opcionales.
**Archivos:** `Dashboard.jsx` (modal crear: quitar `inlineCicloMode`/`cicloInfo`/"Período escolar"), `SubjectPage.jsx` (modal editar `:1518` "Ciclo escolar", modal copiar `:1573` "Período escolar", modal restaurar campo ciclo), `utils/cicloHelpers`/`getCicloInfo` (queda sin uso → eliminar), y display del header (`SubjectPage.jsx:757` muestra `subject?.ciclo`).
**Modelo:** subject pasa de `ciclo: string` a `fechaInicio: 'YYYY-MM-DD'|null` + `fechaFin: 'YYYY-MM-DD'|null` (dos `<input type="date">`, ambos opcionales).
**Display:** donde se mostraba `ciclo`, mostrar un rango legible derivado de las fechas (ej. "feb 2026 – jul 2026") o nada si no hay fechas. **Compat:** subjects viejos con `ciclo` (string) — mostrarlo si no hay fechas. `copySubject` y restaurar deben copiar/editar las nuevas fechas.
**Riesgo:** medio (toca crear/editar/copiar/restaurar + display). No usa rangos en queries (solo se guardan/მuestran).

## R7 — Formulario de actividad: nuevo orden + tipos de archivo
**Objetivo (orden):** Nombre de la actividad → Instrucciones → Calificación Máxima → Tipos de archivos permitidos → Visibilidad → **Fecha límite (opcional, hasta abajo)**.
**Archivo:** `SubjectPage.jsx` modal de actividad (`:1153`–`:1230`). Hoy el orden es Nombre, Calif. máxima, Instrucciones, Fecha límite, Tipos, Visibilidad. Reordenar y renombrar label `Nombre` → **"Nombre de la actividad"** (`:1153`).
**Tipos de archivo (mejora):** permitir **varios** tipos y/o **extensión propia**. Hoy `tiposArchivo` es valor único (`FileTypeSelect`). Cambio: `FileTypeSelect` a multi-selección + campo "otra extensión"; guardar `tiposArchivo` como lista; ajustar validación en `student/ActivityPage` (`isFileAllowed`) y `config/fileTypes`. (Ver decisión #4 — alcance mayor.)

## R8 — Texto de "Ocultar"
**Archivo:** `SubjectPage.jsx` (~:1205) descripción de la opción "Ocultar" → **"Solo tú lo ves, hasta que lo muestres o programes"**.

## R9 — Banner de prueba → comparación de planes
**Objetivo:** al hacer clic en "Te quedan X días de prueba", mostrar características del **plan gratuito (izquierda)** vs **plan de paga (derecha)**.
**Archivos:** `src/components/Layout.jsx:122` (banner, hoy `NavLink to="/profile"`) → abrir un **modal de comparación** (nuevo componente, ej. `components/PlanCompareModal.jsx`). Datos de planes: `plans` (Firestore) / `useSubscription`.
**Pendiente:** nombre + características de cada plan (decisión #3).

## R10 — BUG: al editar la asignatura no se ve la parte de arriba
**Causa:** el modal "Editar asignatura" (`SubjectPage.jsx:1497`) NO tiene `max-h-[90vh] overflow-y-auto`; con los nuevos selectores de color/icono el contenido excede la pantalla y se corta arriba (no se puede hacer scroll al inicio).
**Fix:** añadir `max-h-[90vh] overflow-y-auto` al panel del modal (igual que el modal de copiar/restaurar). Revisar que TODOS los modales altos lo tengan.

## R11 — Descripción de los 4 iconos de acción (Editar/Duplicar/Archivar/Eliminar)
**Archivo:** `SubjectPage.jsx:776`–`:794`. Hoy tienen `title` corto. Mejorar a descripciones claras (tooltip): p.ej. "Editar los datos de la asignatura", "Duplicar esta asignatura (con o sin alumnos)", "Archivar (guarda el esqueleto; elimina entregas)", "Eliminar la asignatura permanentemente". (Opcional: mostrar también un pequeño label visible en hover.)

## R12 — Pestaña Alumnos: reorganizar barra de herramientas
**Archivo:** `SubjectPage.jsx:1020`–`:1068`.
**Nuevo layout (de arriba a abajo):**
1. Fila: **[Descargar plantilla en excel para pegar datos de alumnos]** (izq) + **[Subir la plantilla de excel con los datos de los alumnos]** (der). (Renombra "Descargar plantilla de importación" y "Importar Excel"; el orden enseña qué va primero.)
2. Fila: **Excel** (descarga calificaciones en excel) + **PDF** (descarga calificaciones en pdf), con tooltips/descripciones. (Ver decisión #2: el PDF de calificaciones es nuevo.)
3. **Buscar alumno** (debajo de Excel/PDF, antes del listado) + botón "+" agregar.
4. Listado de alumnos.

## R13 — Orden de pestañas
**Archivo:** `SubjectPage.jsx:790` → `['actividades', 'calificaciones', 'alumnos']` con labels Actividades / Calificaciones / Alumnos. (Revierte el Lote 2; ver contradicción arriba.)

## R14 — BUG / SINCRONIZACIÓN: los cambios de asignatura no se reflejan en el sidebar/dashboard
**Síntomas reportados (todos = misma causa raíz):**
- Desarchivar no la quita de "Archivadas" ni la pasa a Asignaturas (R14 original).
- Una asignatura **duplicada** aparece debajo de "Archivadas" en vez de en la lista activa (N1).
- Al **editar** una asignatura (nombre, ícono, color) no se refleja de inmediato en el sidebar/dashboard (N3).
- Observación del usuario (N4): el **nombre del docente** SÍ cambia de inmediato arriba a la izquierda (porque Perfil usa `setUserProfile` del `AuthContext`). Se quiere el mismo comportamiento en tiempo real para las asignaturas.

**Causa:** `Layout.jsx` carga `subjects` UNA vez al montar (`loadSidebarData`) y persiste entre páginas; el dashboard carga su propia lista. Crear/editar/archivar/desarchivar/duplicar/eliminar desde `SubjectPage`/`Dashboard` NO notifica al sidebar. No es bug de datos (la BD queda bien), es de refresco de UI.

**Fix recomendado (tiempo real, como el nombre del docente):** crear un **`SubjectsContext`** que se suscriba con `onSnapshot` a `query(collection('subjects'), where('docenteId','==',uid))` y exponga la lista a `Layout` (sidebar) y `Dashboard`. Así toda alta/edición/archivo/duplicado/borrado se refleja al instante en ambos, sin recargar. (Es la versión "tiempo real" análoga a `AuthContext`.)
**Alternativa mínima:** tras cada acción (archivar/desarchivar/duplicar/editar) refrescar la lista del sidebar (callback/evento que dispare `loadSidebarData`) y que el dashboard recargue al enfocar. Menos robusto que el contexto en tiempo real.
**Aceptación:** duplicar → aparece arriba en activas al instante; editar nombre/ícono/color → se ve al instante en sidebar y dashboard; desarchivar → sale de Archivadas y entra a activas al instante.

## R15 — Sidebar: "Archivadas" hasta abajo + activas (incl. duplicadas) arriba
**Objetivo:** la sección **"Archivadas" debe ir al fondo del sidebar, justo arriba de "Cerrar sesión"** (hoy va inline después de la lista activa, lo que provoca que una duplicada/activa aparezca "debajo de Archivadas").
**Archivo:** `src/components/Layout.jsx` — la lista de asignaturas activas + "Nueva asignatura…" quedan arriba (área scrollable); mover el bloque "Archivadas (n)" + su lista colapsable a una zona fija inferior, **antes** del bloque de "Cerrar sesión".
**Relación:** junto con R14 (tiempo real), las asignaturas **activas/duplicadas** se muestran en la lista de arriba y "Archivadas" siempre al fondo. Confirmar que `activeSubjects` (no archivadas) incluye la recién duplicada.

## R16 — Alumnos: GENERAR y descargar listado con código de acceso personal
**Objetivo:** debajo del bloque de Excel (pestaña Alumnos), una opción para **GENERAR** y luego **descargar el listado de alumnos con su código de acceso personal** (las credenciales que cada alumno usa para entrar: usuario + clave temporal).
**Archivos:** `src/pages/teacher/SubjectPage.jsx` (pestaña Alumnos, barra de R12), `src/utils/generate.js` (`generateResetPassword`/local), `src/utils/pdf.js` (nuevo export de credenciales) o `excel.js`.
**Flujo:** botón "Generar credenciales de acceso" → para cada alumno sin clave vigente, generar `resetPassword` (clave temporal de 1er ingreso) y `activado:false` (writeBatch ≤490); luego **descargar** un PDF/Excel con columnas: # · Nombre · Usuario · Clave temporal (+ opcional QR/código de la asignatura). 
**Notas/decisión:** hoy el "acceso personal" del alumno = su **usuario** (único) + la clave temporal que el docente genera al resetear. Esto es un **GENERAR masivo** de claves temporales para toda la lista. Confirmar: ¿una sola clave temporal por alumno (1er ingreso) y listado imprimible? (recomendado). Reusa `exportStudentListPDF` añadiendo la columna de clave temporal.

---

## ORDEN SUGERIDO
1. **Textos/labels (bajo riesgo):** R1, R3, R4, R5, R8, R11, R13, renombres de R12.
2. **Modal scroll:** R10.
3. **Sincronización + sidebar (núcleo):** R14 (SubjectsContext en tiempo real) + R15 (Archivadas al fondo). Resuelven desarchivar/duplicar/editar de un golpe.
4. **Formularios:** R6 (fechas inicio/fin), R7 (orden actividad).
5. **Pestaña Alumnos:** R12 (reorganizar + Excel/PDF) + R16 (generar y descargar credenciales).
6. **Mayores:** R2 (agregar escuela), R7 (tipos múltiples), R9 (comparación de planes — depende de definir el plan).

## VERIFICACIÓN
`npm run build` + lint por fase; QA visual: tabs en nuevo orden; modal editar con scroll; **editar nombre/ícono se ve al instante** en sidebar/dashboard; **desarchivar/duplicar** se reflejan al instante y "Archivadas" queda al fondo; barra de Alumnos reorganizada con generar-credenciales; banner abre comparación.
