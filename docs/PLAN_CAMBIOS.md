# Plan maestro de cambios — Evalúa Fácil

> Documento de ejecución para **Sonnet**. Cada sección es autocontenida: objetivo, archivos, pasos técnicos a nivel de código, seguridad, eficiencia, riesgos y criterios de aceptación. Las líneas indicadas son una guía fuerte basada en auditoría del código actual; **verifica el número exacto al editar** (el archivo evoluciona). No agregues nada que no esté pedido ("no pongamos nada que sobre").

## Convenciones
- **Terminología:** SIEMPRE "Asignatura". NUNCA "Materia" en texto visible (labels, placeholders, títulos, toasts, botones).
- **Color docente = azul** (`#2563EB`). **Color alumno = naranja** (`#F97316`). Nunca indigo/violet/emerald como color de identidad.
- **Firestore:** solo filtros `==` o `in`. Sin rangos (`<`,`>`,`!=`) ni `orderBy`. Ordena/filtra en memoria.
- **Tras cada fase:** `npm run build` debe pasar. Al final: desplegar reglas con `firebase deploy --only firestore:rules` si `firestore.rules` cambió.
- **BD recién vaciada:** no hay migración de datos; solo limpieza de código.

---

## DECISIONES (CONFIRMADAS por el usuario 2026-06-20)

1. **Paleta por asignatura = override SOLO dentro de la asignatura.** ✅ El color por **rol** manda en landing, dashboards y navegación (docente azul / alumno naranja). La **paleta por asignatura** sobrescribe el acento SOLO dentro de `SubjectPage` y `ActivityPage`, para docente y alumno. El alumno ve su dashboard naranja, pero al entrar a una asignatura "morada" el acento interno es morado.
2. **6 presets de paleta** (`default`=azul, `orange`, `purple`, `green`, `rose`, `teal`). Sin hex libre.
3. **Escuela NO obligatoria + editable luego.** ✅ Permitir "Prefiero no elegir" → se toma como **"Sin escuela"** (no necesaria). Y la escuela **se puede cambiar después en el Perfil** del docente. **INVARIANTE CRÍTICA:** el `escuelaId` de un **doc de alumno ya activado NUNCA cambia** (su email de Auth `username.escuelaId@evalua.local` quedó fijo en la activación). Cambiar la escuela del docente solo afecta a las asignaturas/alumnos **nuevos**; los existentes conservan su `escuelaId` y siguen ingresando. Ver R16.
4. **Endurecer regla de borrado de entregas** a solo-dueño (docente de la actividad o alumno dueño). ✅ Ver R14.
5. **Rutas internas `/alumno/materia/:id` y `/subject/:id`** se dejan como están (no son texto visible).

---

## ORDEN DE EJECUCIÓN RECOMENDADO

Las fases están ordenadas por dependencia y riesgo. Hacer commit + `npm run build` al final de cada fase.

| Fase | Requerimientos | Riesgo | Por qué este orden |
|------|----------------|--------|--------------------|
| **F1** | R4 (email), R5 (cambiar correo), R6 (logout dup), R7 (legibilidad), R11 (terminología) | Bajo | Cambios locales, sin tocar modelo de datos. Limpieza rápida. |
| **F2** | R9 (eliminar grupos), R8 (mensaje grupo), R3-nav (sidebar Asignaturas), R10 (nombre docente) | Medio | Cambio estructural base; habilita el resto. |
| **F3** | R12 (quitar asistencia) | Medio | Eliminación grande y aislada en SubjectPage/excel/rules. |
| **F4** | R18 (theming por rol) + R2 (alumno naranja) | Medio | Fundamento visual; mejor antes de la paleta por asignatura. |
| **F5** | R3 (paleta por asignatura) + integración en crear/editar/restaurar | Medio | Depende de F4. |
| **F6** | R14 (archivar = esqueleto + ZIP) + R13 (sidebar muestra archivadas) | Medio-alto | Depende de utilidades ZIP (R15) y de cascade. |
| **F7** | R15 (ZIP solo por actividad) + R16 (escuela opcional) | Medio | R15 comparte util con R6/archivar; R16 según decisión #3. |
| **F8** | R17 (landing por rol) | Bajo | Cierra la experiencia; depende de naranja (F4). |
| **F9** | QA completo (ver `PLAN_QA.md`) | — | Verificación final por rol. |

---

# REQUERIMIENTOS DETALLADOS

## R4 — Quitar verificación de correo (solo enviar username)
**Objetivo:** No pedir verificación de correo. En registro, solo enviar al docente su **username** por correo. Reservar verificación para el futuro (usuario de paga).

**Archivos:** `src/pages/teacher/Register.jsx`, `src/pages/teacher/Dashboard.jsx`, `src/pages/teacher/Profile.jsx`, `src/utils/sendVerificationEmail.js`, `src/utils/welcomeEmail.js`, `src/App.jsx`, `src/pages/teacher/VerifyEmail.jsx`, `src/context/AuthContext.jsx`.

**Pasos:**
1. `Register.jsx`: quitar import y llamada a `sendVerificationEmail`; en su lugar `sendWelcomeEmail({ email, username, school }).catch(()=>{})` (importar de `welcomeEmail.js`). No escribir `verifyToken`/`cuentaActivada`.
2. `Dashboard.jsx`: eliminar el **banner ámbar** de "Revisa tu correo" (bloque JSX completo), el estado `emailBannerDismissed`, la función `handleResendVerification`, y `checkPendingVerify` (función + su llamada en `useEffect`). Quitar import de `sendVerificationEmail`.
3. `welcomeEmail.js`: confirmar que el template envía **solo username + escuela**; cambiar el CTA "Verificar correo" por texto informativo (o quitar el botón). Sin enlace de verificación.
4. `App.jsx`: `ProtectedTeacher` NO debe checar verificación (confirmar que ya no lo hace). Dejar la ruta `/verify-email` apuntando a `VerifyEmail.jsx` como fallback para correos viejos, mostrando "Enlace no válido".
5. `AuthContext.jsx`: no requerir `cuentaActivada` para nada. (La memoria que decía "verificación obligatoria" queda obsoleta; actualizarla.)

**Seguridad:** la verificación nunca fue control de acceso real; quitarla no baja seguridad. Se ahorra una escritura Firestore por registro.
**Riesgos:** correos viejos con enlace → caen en fallback "Enlace no válido". Campos `cuentaActivada`/`verifyToken` quedan sin uso (inofensivo).
**Aceptación:** registrarse no muestra banner de verificación; llega correo con username; la app es usable de inmediato.

## R5 — Quitar "cambiar correo"
**Objetivo:** No ofrecer cambiar el correo en ningún lado.
**Archivos:** `src/pages/teacher/Profile.jsx`.
**Pasos:** eliminar estado (`showEmailForm`, `newEmail`, `emailPwd`, `savingEmail`), `resetEmailForm`, `requestEmailChange`, `executeEmailChange`. Reemplazar la sección de correo por **solo lectura**:
```jsx
<div className="py-3 border-b border-slate-100">
  <p className="text-xs text-slate-400 mb-0.5">Correo electrónico</p>
  <p className="text-sm text-slate-900">{currentUser?.email}</p>
</div>
```
**Aceptación:** Perfil muestra el correo sin opción de editarlo.

## R6 — Quitar "Cerrar sesión" duplicado
**Objetivo:** Logout solo en la barra inferior izquierda; quitar el de dentro de los datos del docente.
**Archivos:** `src/pages/teacher/Profile.jsx` (botón ~líneas 468-471). Mantener el de `Layout.jsx` (sidebar).
**Aceptación:** solo existe un control de logout (sidebar).

## R7 — Legibilidad de textos tenues
**Objetivo:** "Así te verán tus alumnos" y labels similares: más grandes y con más contraste.
**Archivos:** `src/pages/teacher/Profile.jsx` (~línea 357) y barrido de clases `text-xs text-slate-400`/`text-slate-300` en textos informativos clave (no en metadatos secundarios).
**Pasos:** subir de `text-xs text-slate-400` → `text-sm text-slate-600` (o `text-slate-700`) en encabezados/labels de sección. No tocar timestamps ni contadores secundarios.
**Aceptación:** los labels de sección se leen cómodamente.

## R11 — Terminología: "Asignatura", nunca "Materia"
**Objetivo:** eliminar la palabra "Materia" del texto visible en toda la app.
**Archivos:** `teacher/Dashboard.jsx`, `teacher/SubjectPage.jsx`, `student/Dashboard.jsx`, `student/Activation.jsx`, `student/ActivityPage.jsx`, `components/Layout.jsx`, `teacher/Profile.jsx`.
**Pasos:** `grep -ri "materia" src/` y reemplazar en texto visible:
- Form de crear/editar/copiar: label "Materia" → "Asignatura".
- Student Dashboard: "Mis materias" → "Mis asignaturas"; "Aún no tienes materias" → "...asignaturas"; botón/modal "Unirme a otra materia" → "Unirme a otra asignatura"; ayuda "...de tu nueva materia" → "...asignatura".
- Activation: toasts/títulos "...materia..." → "...asignatura...".
- Layout modal: "Materia" → "Asignatura".
**Verificación:** `subjectDisplayName()` (en `utils/subjectName.js`) ya compone `nombre + grupo` sin la palabra "Materia" — confirmar. Rutas internas con `/materia/` NO son texto visible (decisión #4).
**Aceptación:** `grep -ri "materia" src/` no arroja texto visible (solo, si acaso, slugs de rutas internas).

---

## R9 — Eliminar el concepto de "Grupos" (solo asignaturas) + R8 (quitar mensaje)
**Objetivo:** No crear grupos. Solo asignaturas. El "grupo" es un campo de texto al crear la asignatura. Quitar el mensaje "Primero crea un grupo en el panel principal para poder añadir asignaturas".

**Archivos:** `src/components/Layout.jsx`, `src/pages/teacher/Dashboard.jsx`, `firestore.rules`, `firestore.indexes.json`, `seeds-db/clear-db.js`, `seeds-db/verify.js`. (Nuevo opcional: `src/utils/createSubject.js`.)

**Pasos:**
1. `Layout.jsx`:
   - Quitar estado `groups`, `selectedGroupId`. En `loadSidebarData()` cargar **solo** `subjects` (quitar el query a `groups` del `Promise.all`).
   - Reescribir `handleCreateSubject()`: quitar requisito de `selectedGroupId`, quitar `grupoId` del payload y del update local. `grupo` = `newSubjectGrupo.trim()` (sin fallback a nombre de grupo).
   - En el modal "Nueva asignatura": **eliminar** el bloque de error `groups.length === 0` (mensaje "Primero crea un grupo…") y el `<select>` "Clase"/grupo. Dejar campos: **Asignatura** (nombre) + **Grupo** (texto) + Período + Parciales (+ Paleta, ver R3).
2. **Unificar creación (recomendado):** crear `src/utils/createSubject.js` con `createSubject({ nombre, grupo, ciclo, parciales, colorPalette, docenteId, escuelaId })` que hace el `addDoc` y devuelve `{ id, data }`. Tanto `Layout.jsx` como `Dashboard.jsx` lo usan (elimina duplicación y divergencia).
3. `Dashboard.jsx`: su `handleCreateSubject` ya es el modelo correcto (nombre + grupo texto + ciclo + parciales). Migrar a `createSubject()`.
4. `firestore.rules`: no hay reglas basadas en `grupoId` (sin cambios de auth). Opcional: validar `grupo` string no vacío.
5. `firestore.indexes.json`: sin índices de `grupoId` (sin cambios).
6. `seeds-db/clear-db.js` y `verify.js`: quitar `'groups'` de los arreglos de colecciones.
7. **Extraer `getCicloInfo()`** (duplicado en `Dashboard.jsx` y `SubjectPage.jsx`) a `src/utils/cicloHelpers.js` e importarlo en ambos (+ Layout si el modal lo necesita).

**Eficiencia:** una query menos al cargar sidebar (~20-30ms). Modal abre sin esperar grupos.
**Riesgos:** verificar que el modal del sidebar abre siempre (antes bloqueaba con `groups.length===0`). Confirmar que ambos caminos (FAB de Dashboard y modal de sidebar) crean docs idénticos.
**Aceptación:** se crea una asignatura escribiendo nombre + grupo, sin pasar por "grupos"; no aparece el mensaje de "crea un grupo".

## R3-nav (parte navegación) — Sidebar "Asignaturas" muestra activas + archivadas
**Objetivo:** el item del menú izquierdo se llama **"Asignaturas"** y, al darle clic, lista activas **y** archivadas. Quitar el label "Grupos".
**Archivos:** `src/components/Layout.jsx` (label nav ~284 y nav móvil ~317; lista de subjects ~195-269).
**Pasos:**
- Cambiar texto "Grupos" → "Asignaturas" (desktop y móvil).
- Mostrar archivadas junto a activas: quitar el toggle "Archivadas" separado; renderizar las archivadas inline con estilo atenuado (`opacity-60`) y un pequeño badge "archivada". Recomendado: activas primero, luego archivadas con separación visual.
- El destino del nav sigue siendo `/dashboard` (panel de asignaturas).
**Aceptación:** el menú dice "Asignaturas"; se ven activas y archivadas.

## R10 — Mostrar nombre del docente (si lo cambió) o el username
**Objetivo:** en asignaturas (vista alumno) y donde se muestre identidad del docente, usar el nombre que el docente puso; si no, el username.
**Archivos:** `src/pages/student/Dashboard.jsx` (~línea 104, resolución `teachers[t.id]`); `Layout.jsx` ya usa la prioridad correcta `nombreMostrar → username → nombre`.
**Pasos:** en student Dashboard cambiar `teachers[t.id] = t.data().nombre` por:
```js
const td = t.data()
teachers[t.id] = td.nombreMostrar || td.username || td.nombre || '—'
```
**Aceptación:** el alumno ve el nombre real del docente si lo configuró, si no el username.

---

## R12 — Quitar asistencia por completo
**Objetivo:** eliminar el módulo de asistencia (UI + lógica + export + reglas + cascade), limpio, sin romper calificaciones.

**Archivos:** `src/pages/teacher/SubjectPage.jsx`, `src/utils/excel.js`, `src/utils/deleteSubjectCascade.js`, `firestore.rules`, `firestore.indexes.json`.

**Pasos (SubjectPage.jsx):**
1. Borrar estado de asistencia: `attendanceSessions, attendanceLoaded, loadingAttendance, attendanceView, showSummary, recordDate, recordParcial, recordPresence, editingSessionId, savingSession, deleteSessionConfirm, deletingSession, searchRecord`.
2. Borrar utilidades `fmtAttDate()`, `attendanceColor()`.
3. Borrar handlers: `loadAttendance, startNewSession, startEditSession, togglePresence, setAllPresent, saveSession, confirmDeleteSession`.
4. Quitar la pestaña "Asistencia" del header de tabs y su `case` en el switch de carga.
5. Borrar las dos vistas de asistencia (record + list) y el modal de confirmación de borrar sesión.
6. Borrar el cómputo `sessionCounts`/`attendanceSummary`.
7. En el texto de borrar asignatura, quitar "y asistencias": "...todas las actividades, entregas y alumnos de...".
8. En la llamada a `exportSubjectGrades`, quitar el parámetro `attendanceSessions`.

**Pasos (excel.js):** quitar parámetro `attendanceSessions`, `hasAttendance`, columnas/merges/anchos de asistencia; recalcular `totalCols` solo con `gradeCols`. Mantener calificaciones intactas. `gradeColor()` se queda (lo usan calificaciones).

**Pasos (deleteSubjectCascade.js):** quitar el query a `attendance` del `Promise.all` y `attSnap` del arreglo de refs; actualizar comentario de cascade.

**Pasos (firestore.rules):** borrar el bloque `match /attendance/{attendanceId} { ... }`. Desplegar reglas.

**Pasos (firestore.indexes.json):** sin índices de attendance (verificar).

**Riesgos:** recálculo de índices de columnas en `excel.js` (probar export de calificaciones tras el cambio). `gradeColor()` NO debe quedar huérfano (lo usa la tabla de calificaciones).
**Aceptación:** no hay pestaña ni referencias a asistencia; el export de calificaciones funciona; build pasa; reglas desplegadas.

---

## R18 — Sistema de theming por rol (azul docente / naranja alumno) + R2
**Objetivo:** una sola interfaz con acento por rol mediante variables CSS. Docente azul (igual), alumno naranja `#F97316`. Cambian solo elementos de identidad (logo, navbar activo, botones primarios, links activos, indicadores, iconos, encabezados, tarjetas seleccionadas). NO cambian formularios, tablas, inputs, fondos, contenedores.

**Archivos:** `tailwind.config.js`, `src/index.css`, `src/App.jsx`, `src/context/ThemeContext.jsx` (nuevo opcional), `Layout.jsx`, todas las `pages/teacher/*` y `pages/student/*`.

**Pasos:**
1. **tailwind.config.js** — extender colores con variables:
```js
theme: { extend: { colors: {
  accent: 'var(--accent)',
  'accent-hover': 'var(--accent-hover)',
  'accent-light': 'var(--accent-light)',
} } }
```
2. **index.css** — definir variables y overrides por rol:
```css
:root { --accent:#2563EB; --accent-hover:#1D4ED8; --accent-light:#DBEAFE; }
[data-role="alumno"] { --accent:#F97316; --accent-hover:#EA580C; --accent-light:#FED7AA; }
[data-role="docente"] { --accent:#2563EB; --accent-hover:#1D4ED8; --accent-light:#DBEAFE; }
```
3. **App.jsx** — envolver rutas con `<div data-role={role}>` donde `role = userProfile?.role === 'alumno' ? 'alumno' : 'docente'`. (Opcional `ThemeContext` para exponer rol/paleta.)
4. **Migración de clases** — reemplazar SOLO en elementos de identidad:
   - `bg-blue-600 hover:bg-blue-700` → `bg-accent hover:bg-accent-hover`
   - `bg-blue-100`/`bg-blue-50` (acento suave) → `bg-accent-light`
   - `text-blue-600` (link/acento) → `text-accent`
   - En páginas de alumno: además migrar `indigo-*` (promedios, badges de parcial, botones de descarga) → `accent`/`accent-light`. Los 2 usos de naranja para "deadline" pueden quedar (semántico) o pasar a `amber`.
   - **No** migrar `slate-*` neutros, ni colores semánticos de estado (emerald=ok, amber=alerta, rose=error) salvo donde sean identidad.
5. **Páginas de login/registro/activación:** logo y botones a `accent` para que tomen el color del rol (alumno naranja, docente azul). (Ver también R17.)

**Eficiencia:** migrar primero `Layout.jsx` (compartido), luego teacher, luego student; así se prueba el switch por rol temprano.
**Riesgos:** Tailwind JIT con `var()` funciona vía clases mapeadas en config (no usar arbitrary `bg-[var(--accent)]` masivo). Hacer barrido `grep` final para no dejar azules hardcodeados en páginas de alumno. Probar build de producción.
**Aceptación:** login como docente = azul; como alumno = naranja; formularios/tablas/fondos sin cambio; sin azules residuales en alumno (ver QA S-ALUM-026).

---

## R3 — Paleta de colores por asignatura (crear / editar / restaurar)
**Objetivo:** al crear o editar una asignatura (y al restaurar una archivada) el docente elige una paleta para esa asignatura. (Decisión #1 y #2.)

**Archivos:** `src/utils/createSubject.js` (de R9), `teacher/Dashboard.jsx` (modal crear), `teacher/SubjectPage.jsx` (modal editar, modal restaurar, wrappers), `student/SubjectPage.jsx` (wrapper), `student/ActivityPage.jsx` (wrapper), `index.css`.

**Pasos:**
1. **Esquema:** agregar campo `colorPalette: 'default'` al doc de subject (default `'default'` = azul). Valores: `'default'|'orange'|'purple'|'green'|'rose'|'teal'`.
2. **index.css** — definir overrides por paleta (acento dentro de la asignatura):
```css
[data-subject-palette="default"]{--accent:#2563EB;--accent-hover:#1D4ED8;--accent-light:#DBEAFE;}
[data-subject-palette="orange"]{--accent:#F97316;--accent-hover:#EA580C;--accent-light:#FED7AA;}
[data-subject-palette="purple"]{--accent:#9333EA;--accent-hover:#7E22CE;--accent-light:#E9D5FF;}
[data-subject-palette="green"]{--accent:#16A34A;--accent-hover:#15803D;--accent-light:#DCFCE7;}
[data-subject-palette="rose"]{--accent:#E11D48;--accent-hover:#BE123C;--accent-light:#FFE4E6;}
[data-subject-palette="teal"]{--accent:#14B8A6;--accent-hover:#0D9488;--accent-light:#CCFBF1;}
```
3. **Selector UI** (componente reutilizable, p.ej. `PaletteSelect`): grid de 6 swatches (radio). Insertarlo en: modal crear (Dashboard + Layout), modal editar asignatura (SubjectPage), modal restaurar (SubjectPage).
4. **Aplicar paleta** envolviendo el contenido de `SubjectPage` (docente y alumno) y `ActivityPage` (alumno) con `<div data-subject-palette={subject?.colorPalette || 'default'}>`. El acento interno usa la paleta; el dashboard/nav sigue el color por rol.
5. **createSubject/handleEditSubject/handleCopySubject/handleUnarchiveConfirm:** persistir `colorPalette`.

**Seguridad:** `colorPalette` es cosmético; validar como enum (lista cerrada). Sin reglas nuevas.
**Riesgos:** asignaturas sin el campo → default lazy (`|| 'default'`). Probar que el acento por paleta no rompe el color por rol fuera de la asignatura.
**Aceptación:** crear/editar/restaurar permite elegir paleta; dentro de la asignatura el acento cambia; el dashboard mantiene el color del rol.

---

## R14 — Archivar = solo esqueleto + ZIP de entregas; R13 — sidebar muestra archivadas
**Objetivo:** Al **archivar**, preguntar si guardar todas las entregas en ZIP; luego **borrar las entregas** (queda el esqueleto: asignatura + actividades + alumnos). Al **restaurar**, permitir mantener/cambiar datos (nombre/grupo/ciclo/parciales) + elegir paleta. El sidebar muestra archivadas (R3-nav/R13).

**Archivos:** `src/pages/teacher/SubjectPage.jsx`, `src/utils/deleteSubjectCascade.js`, `src/utils/downloadSubmissions.js`, `src/components/Layout.jsx`, `firestore.rules`.

**Pasos (archivar):**
1. Estado nuevo: `showArchiveModal`, `archiveExportChoice` ('save'|'skip'), `archiveExporting`.
2. `handleToggleArchive()`: si NO está archivada → abrir `showArchiveModal` (en vez de archivar directo). Si ya está archivada → abrir modal de restaurar (flujo existente).
3. **Modal Archivar:** título "¿Archivar {nombre}?"; dos opciones radio: (a) "Guardar entregas como ZIP" (default), (b) "Archivar sin guardar". Botones Cancelar / Archivar.
4. `handleArchiveConfirm()`: si `save` → cargar alumnos + submissions, `jobs = buildJobsForSubject({subject, activities, submissions, students})`, `await downloadSubmissionsZip({ zipName: subjectDisplayName(subject), jobs, onProgress })`. Luego `await deleteSubjectSubmissions(subjectId)` (nueva util). Luego `updateDoc(subject,{archived:true})`.
5. **Nueva util** en `deleteSubjectCascade.js`:
```js
export async function deleteSubjectSubmissions(subjectId){
  const acts = await getDocs(query(collection(db,'activities'),where('asignaturaId','==',subjectId)))
  const subs = await fetchSubmissionsForActivities(acts.docs.map(d=>d.id))
  await batchDeleteDocs(subs.map(d=>doc(db,'submissions',d.id)))
}
```
   (Mantiene actividades + alumnos = esqueleto.)

**Pasos (restaurar):** ampliar el modal de desarchivar con:
- Sección "Editar datos (opcional)": inputs pre-llenados nombre/grupo/ciclo + select parciales (reusar validación de `handleEditSubject`: no permitir reducir parciales por debajo de actividades existentes).
- Sección "Paleta de colores" (R3).
- En `handleUnarchiveConfirm()` aplicar solo los campos cambiados + `archived:false` (+ las opciones existentes de alumnos/visibilidad de actividades).

**Sidebar (R13):** mostrar archivadas (ver R3-nav).

**Seguridad (CONFIRMADO — endurecer):** la regla actual `submissions` permite `delete: if request.auth != null` (cualquiera borra cualquier entrega). Cambiar a solo-dueño:
```
allow delete: if request.auth != null && (
  request.auth.uid == get(/databases/$(database)/documents/activities/$(resource.data.actividadId)).data.docenteId
  || resource.data.alumnoId == request.auth.uid
);
```
> El `get()` cuesta una lectura por borrado (insignificante en uso normal). Desplegar reglas tras el cambio. Verificar que el cascade de archivar/eliminar (ejecutado por el docente dueño) sigue funcionando con la regla nueva.

**Eficiencia:** `downloadSubmissionsZip` ya hace fetch en lotes de 6; `deleteSubjectSubmissions` borra en lotes de 490. Para asignaturas grandes (miles de entregas) puede tardar 10-60s.
**Riesgos:** pérdida de datos si el docente elige "sin guardar" → default 'save' + confirmación explícita. No borrar alumnos al archivar (solo entregas).
**Aceptación:** archivar pide ZIP, descarga (si aplica), borra entregas, conserva esqueleto; restaurar permite editar datos + paleta; sidebar lista archivadas.

---

## R15 — ZIP solo por actividad (nombre = actividad, carpetas por alumno)
**Objetivo:** Quitar ZIP por parcial y por asignatura del módulo de calificaciones. Dejar **solo ZIP por actividad**. El ZIP se llama como la actividad; dentro, una carpeta por alumno (con su nombre) y dentro sus archivos con los nombres originales.

**Archivos:** `src/utils/downloadSubmissions.js`, `src/pages/teacher/ActivityPage.jsx`, `src/pages/teacher/SubjectPage.jsx`.

**Pasos:**
1. `downloadSubmissions.js` → `buildJobsForActivity`: cambiar a **carpeta por alumno** con archivo original:
   - `path: [ sanitize(fullName(student)) ]`
   - `fileBaseName`: usar el nombre original (`sub.nombreArchivo`) en vez del nombre del alumno (intercambiar la lógica actual). Mantener manejo de colisiones.
2. `ActivityPage.jsx` → `handleZipDownload`: `zipName: activity?.nombre` (solo el nombre de la actividad).
3. `SubjectPage.jsx`: **eliminar** los botones de ZIP por parcial y por asignatura de la vista de calificaciones, y la función `handleZip` si queda sin uso ahí.
4. `downloadSubmissions.js`: eliminar `buildJobsForParcial` (queda sin uso). **CONSERVAR `buildJobsForSubject`** (lo usa el flujo de archivar, R14). Verificar imports antes de borrar.

**Riesgos (cross-cluster):** no borrar `buildJobsForSubject` (dependencia de R14). Confirmar con `grep` los imports de cada util antes de eliminar.
**Aceptación:** en una actividad, el ZIP se llama como la actividad y contiene `Nombre Alumno/archivos-originales`; ya no hay botones de ZIP por parcial/asignatura en calificaciones.

## R16 — Escuela opcional ("Sin escuela") + editable en Perfil (Decisión #3, confirmada)
**Objetivo:** la escuela NO es obligatoria en el registro; al omitirla se toma como "Sin escuela". Además, el docente puede cambiar/asignar su escuela después en el Perfil.
**Archivos:** `src/pages/teacher/Register.jsx` / `RegisterSchool.jsx`, `src/pages/teacher/Profile.jsx`, `src/data/usePlanteles.js`, `AuthContext.jsx`, generación de username, `createSubject`.

**INVARIANTE CRÍTICA:** el `escuelaId` guardado en cada **doc de alumno** es inmutable una vez que el alumno activa (su email de Auth quedó fijo). Por eso:
- `studentEmail()` en login/activación SIEMPRE usa el `escuelaId` del **doc del alumno** (no el del docente). Confirmar que ya es así (lo es) y NO cambiarlo.
- Al crear una asignatura/alumno se "congela" el `escuelaId` **vigente del docente** en ese momento en el doc del alumno.
- Cambiar la escuela del docente afecta solo a asignaturas/alumnos **nuevos**.

**Pasos (registro):**
1. Radio "Prefiero no elegir en este momento" (`skipSchool`). Al activarlo, limpiar `selectedPlantel`.
2. Validación: `if (!skipSchool && !selectedPlantel) { toast('Selecciona tu escuela'); return }`.
3. Si `skipSchool`: usar un `escuelaId` sintético **estable** = `sin-escuela-${uid}` (string no vacío, para que los emails de alumno funcionen). `schoolName` (display) = "Sin escuela". No es obligatorio crear doc en `schools` (AuthContext tolera no encontrarlo → usar fallback "Sin escuela"). Username docente: prefijo genérico (p.ej. `EF-01`) cuando no hay `shortName`.

**Pasos (Perfil — cambiar escuela):**
4. En Perfil, agregar selector de escuela (reusar `usePlanteles`/picker) + opción "Sin escuela". Al guardar: actualizar `users/{uid}.escuelaId` + `schoolName`. **NO** reescribir docs de alumnos/asignaturas existentes. Mostrar aviso: "Solo aplicará a las asignaturas y alumnos nuevos".
5. (Opcional) regenerar el prefijo del username del docente NO se hace (mantener username estable).

**Seguridad/Riesgos:** `escuelaId` debe ser siempre string no vacío (nunca null) para no romper emails de alumno. El cambio de escuela del docente jamás debe tocar `escuelaId` de alumnos ya activados. Probar: docente "Sin escuela" crea asignatura + alumno → alumno activa y entra; luego docente fija escuela real → alumno viejo sigue entrando, alumno nuevo usa la nueva escuela.
**Aceptación:** registro sin escuela funciona; alumnos de un docente "Sin escuela" activan e ingresan; el docente puede fijar/cambiar escuela en Perfil sin romper accesos existentes.

---

## R17 — Landing por rol (docente azul / alumno naranja)
**Objetivo:** página de entrada que separa claramente docente (azul) y alumno (naranja); preferible: dos links claros por rol. No mezclar contenido/colores.

**Archivos:** `src/pages/Landing.jsx` (nuevo), `src/App.jsx`, `src/pages/student/Login.jsx`, `src/pages/student/Activation.jsx`, `src/pages/teacher/Login.jsx`.

**Pasos:**
1. Crear `Landing.jsx`: logo + título "Evalúa Fácil" + dos tarjetas/links:
   - "Para Docentes" → `/docente` (azul, icono `GraduationCap`).
   - "Para Alumnos" → `/alumno` (naranja, icono `BookOpen`).
   - Responsive: lado a lado en desktop, apiladas en móvil. Minimalista.
2. `App.jsx`: `/` → `Landing`. `RootRedirect` solo maneja usuarios ya logueados (docente→`/dashboard`, alumno→`/alumno/dashboard`). Mantener `/docente`, `/alumno`, `/register`.
3. `student/Login.jsx` y `student/Activation.jsx`: logo/botones/focus a naranja (cae solo con el theming por rol de R18 si esas páginas están bajo `data-role="alumno"`; si no hay sesión aún, forzar naranja en estas rutas de alumno).
4. `teacher/Login.jsx`/`Register.jsx`: azul (ya es el caso).
**Aceptación:** un visitante nuevo ve dos entradas claras por rol con sus colores; nada mezclado.

---

## VERIFICACIÓN FINAL
1. `npm run build` (sin errores) y `npm run lint` (sin errores nuevos; los de patrón `useEffect`→función declarada después son preexistentes).
2. `grep -ri "materia" src/` → sin texto visible.
3. `grep -rn "blue-" src/pages/student/` → sin azules de identidad (solo neutros/semánticos permitidos).
4. `grep -rn "attendance\|asistencia" src/` → sin referencias.
5. `grep -rn "grupoId\|collection(db, 'groups')" src/` → sin referencias.
6. `firebase deploy --only firestore:rules` (attendance eliminado, submissions endurecido).
7. Ejecutar `PLAN_QA.md` (QA por rol).
8. Actualizar memoria: la verificación de correo dejó de ser obligatoria.
