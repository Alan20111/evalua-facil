# Evalúa Fácil — cómo funciona todo el proyecto

Mapa completo de la plataforma, escrito para que alguien (o algo) que no ha
visto el repo pueda razonar sobre él y revisar cambios con criterio.

Actualizado: 5-ago-2026.

Documentos hermanos, más específicos:
- [`EVALUACIONES.md`](EVALUACIONES.md) — el subsistema de cuestionarios y exámenes a detalle.
- [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) — colores, tipografía, componentes.

---

## 1. Qué es

Plataforma web para que docentes de bachillerato mexicano (SEP) lleven
calificaciones, actividades, asistencia y comunicación con sus estudiantes, y
para que los estudiantes entreguen trabajos y consulten sus notas.

**Es una plataforma, no una app**: la web es el producto completo; la app
Android es un complemento que empaqueta el mismo build.

| | |
|---|---|
| Front | React 19 + Vite 8, SPA sin SSR |
| Estilos | Tailwind v3, solo utilidades |
| Datos | Firebase Auth + Firestore |
| Servidor | Cloud Functions (notificaciones, calificación, candados) + endpoints en Vercel |
| App | Capacitor (Android), empaqueta `dist/` |
| Correo | EmailJS desde el cliente + un endpoint propio |
| Archivos | Cloudinary (no se usa Firebase Storage) |
| Hosting | Vercel, `evalua-facil.vercel.app` |

---

## 2. Los tres roles

Comparten Firebase Auth pero **no** el modelo de datos.

| Rol | Correo | Documento | Cómo se reconoce |
|---|---|---|---|
| Docente | real | `users/{uid}` | `role: 'docente'` |
| Admin | real | `users/{uid}` | `role: 'admin'` |
| Estudiante | **falso**: `usuario.escuelaId@evalua.local` | `students/{id}` | NO tiene doc en `users` |

**El estudiante no tiene documento en `users`.** Es la trampa que más
confunde: cualquier regla o consulta que asuma lo contrario falla. Su identidad
vive en `students`, y **tiene un documento por asignatura**, todos con el mismo
`uid`. Por eso `submissions.alumnoId` es el id de la *inscripción*, no el uid.

`AuthContext` (`src/context/AuthContext.jsx`) resuelve el perfil, lo enriquece
con el nombre de la escuela y migra usuarios legados.

### Alta de estudiantes

El docente los captura (a mano o por Excel) y el estudiante **se activa** con
el código de la asignatura: `/activate/:code` crea su cuenta de Auth y marca
`activado: true` + `uid` en todas sus inscripciones. Si el docente le reinicia
la contraseña, vuelve a pasar por ahí con una temporal.

---

## 3. Colecciones de Firestore

```
users                 docentes y admins            role, username, escuelaId, email,
                                                   schoolName, suscripcionHasta ⚠
schools               una por plantel              claveSEP, shortName, nombre
students              UNA POR INSCRIPCIÓN          username, escuelaId, asignaturaId,
                                                   uid, activado, createdAt, activadoAt
subjects              asignaturas del docente      docenteId, accessCode, parciales,
                                                   parcialesFechas, parcialesOcultos,
                                                   parcialesCerrados, ponderacionParciales,
                                                   archived, colorPalette, icon
activities            actividades                  tipo, categoria, parcial, orden,
                                                   oculta/publishAt/publishedAt,
                                                   fechaLimite, pesoCalificacion,
                                                   rubrica (copia), evaluacion {…}
  └ preguntas         reactivos de evaluación      tipo, enunciado, opciones, ponderacion,
                                                   seccionId, seccionNombre
submissions           entregas y calificaciones    alumnoId, actividadId, calificacion,
                                                   estado, estadoEvaluacion, intentos
  └ respuestas        respuestas por reactivo      opcionSeleccionada, textoRespuesta,
                                                   archivoURL, puntosObtenidos
attendance            UNA COLUMNA = fecha + hora   presentes{}, justificadas{}, motivos{}
attendanceSummaries   resumen por alumno           lo escribe SOLO una Cloud Function
avisos                comunicados del docente      asignaturaId, titulo, mensaje, emoji
avisoLecturas         "Entendido" del alumno       inmutable (auditoría)
avisoGuardados        marcador personal del alumno
avisoOcultos          "eliminar" del lado del alumno
avisoPlantillas       banco de mensajes rápidos
bancoRubricas         rúbricas y listas de cotejo reutilizables
bancoReactivos        banco personal de preguntas
resources / materials material del curso / por parcial
events                calendario privado del docente
academicEvents        eventos compartidos con alumnos
studentEvents         calendario propio del alumno
horario / horarioBloques  clases (legado / materializadas por fecha)
asuetos / vacaciones  días y periodos sin clase
subscriptions         una por docente
payments              pagos declarados
plans                 catálogo de planes
config                datos públicos de pago
notificationSettings  preferencias por uid
notificationLog       bitácora de lo que se envió
```

### Restricción que define el diseño

**Firestore aquí solo admite igualdades.** Nada de `<`, `>`, `!=` ni `orderBy`
en las consultas: todo se ordena y filtra en memoria. Los índices compuestos
desplegados están en `firestore.indexes.json` — agregar uno nuevo exige
desplegarlo antes de usarlo.

---

## 4. Actividades: el corazón

Tres tipos, un solo modelo:

| Categoría | `tipo` | El alumno |
|---|---|---|
| Entregable | `archivo` | Sube archivos |
| Observación | `observacion` | Nada; solo recibe nota |
| Cuestionario / Examen | `evaluacion` | Contesta reactivos ([detalle](EVALUACIONES.md)) |

### Visibilidad — tres estados, no dos

`src/utils/activityVisibility.js` es la única fuente:

- **Borrador** — `oculta: true`, sin `publishedAt` ni `publishAt`. Nunca se
  publicó. No lleva número ni entra a calificaciones.
- **Programada** — `publishAt` en el futuro. Se publica sola (una Cloud
  Function cada 30 min).
- **Publicada** — visible. `publishedAt` es permanente… salvo que el docente la
  **regrese a borrador**, la única acción que lo borra.

Ojo con la distinción entre *ocultar con el ojito* (temporal, conserva
`publishedAt`) y *guardar como borrador* (la despublica de verdad).

### Numeración y calificación

El número (`1.1`, `1.2`…) **no se guarda**: se calcula por posición dentro del
parcial, y solo cuentan las actividades que van a la boleta. El predicado
`cuentaParaCalificacion(a)` = no es borrador **y** no está marcada "sin
calificación". Se usa en tabla de calificaciones, promedios, cierre de parcial,
tope de ponderación, numeración y exportaciones — **no** en el calendario ni en
la lista del alumno.

### Ponderación y cierre de parcial

Sin ponderación, el promedio del parcial es la media simple de lo calificado.
Con `ponderacionParciales[p]` activa, cada actividad lleva `pesoCalificacion`
(los pesos deben sumar 10 para poder exportar) y el promedio es la media
ponderada. **Cerrar un parcial** (`parcialesCerrados`) congela sus
calificaciones y pone 0 a quien no entregó; se puede revertir.

---

## 5. Asistencia

Un documento de `attendance` es **una columna compartida por todo el grupo**:
una fecha + una hora de clase, con `presentes{alumnoId: bool}`,
`justificadas{}` y `motivos{}`.

Por eso **solo el docente puede leer esa colección**: el motivo de una
justificación es texto libre que puede contener información sensible. El alumno
ve únicamente su resumen, en `attendanceSummaries`, que **escribe una Cloud
Function** (`onAttendanceEscrita`) — ningún cliente escribe ahí.

Las columnas pueden generarse solas desde el horario del docente
(`attendanceAuto.js`), respetando asuetos y vacaciones.

---

## 6. Calendario y horario

- `horarioBloques` — cada clase **materializada por fecha**, para poder mover o
  cancelar una sola sin tocar el patrón.
- `asuetos` (un día) y `vacaciones` (un periodo), cada uno con su alcance:
  clases, eventos, actividades, asistencias.
- `events` (privados del docente), `academicEvents` (compartidos con sus
  alumnos) y `studentEvents` (del propio alumno).

El calendario del docente y la Agenda del alumno comparten los componentes de
vista (Día / 3 días / Semana / Mes) y los helpers de `calendarEvents.js`.

---

## 7. Avisos

Comunicados del docente a todo el grupo. **No es un chat**: sin respuestas,
comentarios ni reacciones.

Lo distintivo: el alumno recibe un **modal de lectura obligatoria** que no se
puede cerrar hasta tocar "Entendido" en cada aviso pendiente (`AvisosGate`,
montado en el layout del alumno, así que bloquea en cualquier pantalla). Cada
confirmación queda en `avisoLecturas`, que es **inmutable**: es auditoría de
que sí se mostró.

Un aviso solo le toca a quien ya estaba en la asignatura cuando se publicó: el
corte es el más tardío entre su alta y su activación (`avisosDesde`).

---

## 8. Notificaciones

Push por FCM, con la app instalada. Todo lo enviado queda en `notificationLog`,
que alimenta la **Bitácora** de docente y alumno (misma tabla, distinto
`describeEntry`).

| Función | Cuándo |
|---|---|
| `onActividadEscrita` | Una actividad se hace visible |
| `onSubmissionActualizada` | Se publica una calificación |
| `onSubmissionEntregada` | Alguien entrega (si la actividad tiene "Notificarme") |
| `onEstudianteActivado` | Un estudiante se activa |
| `onAvisoEscrito` | Se publica un aviso |
| `onEvaluacionFinalizada` | Califica el intento |
| `onAttendanceEscrita` | Recalcula el resumen del alumno |
| `revisarProgramados` (30 min) | Publica lo programado y avisa fechas límite |
| `onSuscripcionEscrita` / `sincronizarCandadoSuscripcion` (1 h) | Espejan el candado de suscripción |

**Criterio opt-out en todas**: ausente o `true` = notifica; solo se salta si el
usuario lo apagó a propósito. Invertirlo dejó a casi todos sin notificaciones
una vez — no volver a cambiarlo sin cambiar también el default de la pantalla.

---

## 9. Suscripciones y el candado

Un solo plan mensual. En la versión 1.0.1 el único método es **transferencia**
(Mercado Pago y PayPal están pausados; su código vive en `api/_pausado/`).

Estados: `trial` (30 días) · `activa` · `pendiente_pago` · `cancelada` ·
`vencida`. Cancelar **no corta de inmediato**: conserva el acceso hasta la
fecha ya cubierta.

### Qué puede y qué no un docente vencido

- **Sí**: entrar, consultar todo, exportar Excel y PDF, descargar entregas,
  pagar, cancelar, editar su perfil.
- **No**: cualquier escritura de contenido — crear, editar, calificar, pasar
  lista, publicar.

### El candado tiene dos capas y hay que moverlas juntas

1. **Cliente** — `src/utils/firestoreGuard.js`. Las pantallas del docente
   importan `addDoc/setDoc/updateDoc/deleteDoc/writeBatch` **de ahí** en vez de
   `firebase/firestore`; el módulo las deja pasar o lanza. Es lo que abre la
   ventana de pago.
2. **Servidor** — `firestore.rules`: `docenteActivo()` compara `request.time`
   contra `users/{uid}.suscripcionHasta`, un Timestamp que espeja una Cloud
   Function. Es la capa que no se puede rodear.

Campo **ausente = se deja pasar**, a propósito: un dato faltante no debe dejar
a nadie fuera de su trabajo.

Los estudiantes **no se ven afectados** en nada si su maestro no paga.

### Documentos con marca de agua

Sin marca solo quien **ya pagó y sigue dentro de lo pagado** (`planId` +
no vencida). La prueba lleva marca; una transferencia declarada pero sin
aprobar, también.

---

## 10. Exportaciones

Todo con membrete (escuela + docente + periodo) y marca de agua si aplica.
**Solo desde la web**: en la app los botones se quedan a la vista y explican
dónde hacerlas (`descargaSoloWeb`).

| Documento | Archivo |
|---|---|
| Calificaciones (curso / parcial), ranking, asistencia | `src/utils/excel.js` |
| Los mismos + lista de acceso + resultados de evaluación + gráficas | `src/utils/pdf.js` |
| Entregas de los alumnos en ZIP | `downloadSubmissions.js` |

En jsPDF **no existe el carácter `✓`** (las fuentes son WinAnsi): se dibuja con
dos trazos. Ya pasó una vez que salía impreso como una comilla suelta.

---

## 11. Panel de administración

`/admin`, solo para `role: 'admin'`. Pestañas: **Resumen** (tarjetas y
gráficas), **Suscripciones** (una fila por docente, con plan, vencimiento,
días, último pago y días sin accesar), **Pagos** (verificación manual de
transferencias, que es lo que activa una suscripción), **Estudiantes** y
**Cobros** (configuración de métodos).

"Días sin accesar" sale del último inicio de sesión que ya guarda Firebase Auth
(`api/admin/last-access`), no de un campo propio.

---

## 12. La app Android

Capacitor empaqueta `dist/`. **No descarga nada del servidor**: para ver un
cambio hay que `npm run build && npx cap sync android` y volver a instalar.

Diferencias deliberadas con la web: sin descargas, calificaciones solo en web,
tablas de asistencia en horizontal, tamaños y espaciados propios. Se decide con
`IS_NATIVE_APP` (`src/utils/platform.js`).

`env(safe-area-inset-top)` **no se consume**: vale lo mismo en cualquier
elemento. Ponerlo dos veces abre dos huecos — ya pasó.

---

## 13. Seguridad — invariantes que no se negocian

1. Un docente solo escribe lo suyo (`ownsSubject`, `ownsActivity`).
2. Un alumno solo escribe lo suyo (`ownsStudentDoc`), y **nunca** su
   calificación: ni al crear, ni por diff, ni marcándose "calificado".
3. Borrar una entrega la borra con su nota: solo el docente dueño.
4. `attendance` no lo lee ningún alumno.
5. `avisoLecturas` es inmutable.
6. Un docente sin suscripción vigente no escribe nada.
7. `users/{uid}.suscripcionHasta` está congelado para el propio docente.

Hay una suite real contra el emulador:

```bash
npm run test:rules      # 37 casos; requiere JDK 21+
```

---

## 14. Convenciones del proyecto

- **Azul** para docente y alumno; **guinda** en admin; **naranja** en las
  pantallas de autenticación. Cada asignatura puede reteñir su zona con
  `--accent` (siete paletas). Nunca índigo.
- Todo el texto de interfaz, en **español de México**, tuteando.
- Los comentarios explican **por qué**, no qué — y suelen citar el error real
  que motivó la línea. Conservar ese estilo.
- Ramas + PR; nunca commits directos a `main`. Merge = squash.
- **Vercel plan Hobby: 12 funciones serverless.** Hoy hay 9. Pasarse hace
  fallar *todos* los despliegues, sin que nada del código esté mal.

---

## 15. Lógica duplicada a propósito (y peligrosa)

No se puede importar entre paquetes, así que estos cálculos viven en dos o tres
lugares. **Si cambias uno, cambia los otros:**

| Cálculo | Dónde |
|---|---|
| Calificación de una evaluación | `src/utils/evaluacionGrading.js` · `functions/index.js` |
| Vigencia de la suscripción | `src/utils/subscriptionHelpers.js` · `functions/index.js` · `seeds-db/backfill-suscripcion.js` |
| Días de retención (90) | `src/utils/subscriptionHelpers.js` · `api/cron/reminders.js` |
| Canales de notificación de Android | `src/utils/pushNotifications.js` · `functions/index.js` |

Discrepar significa, según el caso, calificar distinto de lo que se muestra o
dejar trabajar a quien no pagó.

---

## 16. Despliegue

| Qué | Cómo | Automático |
|---|---|---|
| Web | push a `main` | sí (Vercel) |
| Reglas de Firestore | `firebase deploy --only firestore:rules` | **no** |
| Índices | `firebase deploy --only firestore:indexes` | **no** |
| Cloud Functions | `firebase deploy --only functions` | **no** |
| App Android | `npm run build && npx cap sync android` + Run | **no** |

Después de cada merge conviene verificar que el despliegue **pasó**, no solo
que salió: `curl -s https://evalua-facil.vercel.app/version.json` responde el
commit desplegado.

---

## 17. Por dónde empezar a leer

| Si te toca… | Empieza por |
|---|---|
| Actividades y visibilidad | `src/utils/activityVisibility.js` |
| Calificaciones | `src/utils/ponderacion.js` + pestaña Calificaciones de `teacher/SubjectPage.jsx` |
| Evaluaciones | [`EVALUACIONES.md`](EVALUACIONES.md) |
| Asistencia | `src/utils/attendance.js`, `attendanceAuto.js` |
| Avisos | `src/utils/avisos.js`, `src/components/AvisosGate.jsx` |
| Notificaciones | `functions/index.js`, `src/utils/pushNotifications.js` |
| Suscripciones | `src/utils/subscriptionHelpers.js`, `firestoreGuard.js`, `firestore.rules` |
| Exportaciones | `src/utils/excel.js`, `pdf.js`, `membrete.js` |
| Estilos | [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) |

Los archivos grandes (`teacher/SubjectPage.jsx` ~7 000 líneas,
`EvaluacionManager.jsx`, `EvaluacionEditor.jsx`) concentran mucho: conviene
buscar por el nombre de la función antes que leerlos de corrido.
