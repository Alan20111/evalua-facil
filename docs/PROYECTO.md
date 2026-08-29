# Evalúa Fácil — cómo funciona todo el proyecto

Documento único de referencia. Escrito para que alguien (o algo) que no ha
visto el repo pueda razonar sobre él y revisar cambios con criterio.

Actualizado: 28-ago-2026.

Complemento: [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) para colores, tipografía y
componentes visuales.

---

## Índice

1. [Qué es](#1-qué-es)
2. [Los tres roles](#2-los-tres-roles)
3. [Colecciones de Firestore](#3-colecciones-de-firestore)
4. [Actividades: el corazón](#4-actividades-el-corazón)
5. [Evaluaciones: cuestionarios y exámenes](#5-evaluaciones-cuestionarios-y-exámenes)
6. [Actividades interactivas: crucigrama y sopa de letras](#6-actividades-interactivas-crucigrama-y-sopa-de-letras)
7. [Asistencia](#7-asistencia)
8. [Calendario y horario](#8-calendario-y-horario)
9. [Avisos](#9-avisos)
10. [Notificaciones](#10-notificaciones)
11. [Suscripciones y el candado](#11-suscripciones-y-el-candado)
12. [Exportaciones](#12-exportaciones)
13. [Panel de administración](#13-panel-de-administración)
14. [La app Android](#14-la-app-android)
15. [Seguridad: invariantes](#15-seguridad--invariantes-que-no-se-negocian)
16. [Convenciones](#16-convenciones-del-proyecto)
17. [Lógica duplicada a propósito](#17-lógica-duplicada-a-propósito-y-peligrosa)
18. [Despliegue](#18-despliegue)
19. [Por dónde empezar a leer](#19-por-dónde-empezar-a-leer)

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

`activadoAt` se sella **una sola vez** por inscripción: se usa como corte para
los avisos, y reescribirlo le borraría avisos que ya le tocaban.

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
| Cuestionario / Examen | `evaluacion` | Contesta reactivos (§5) |

### Visibilidad — tres estados, no dos

`src/utils/activityVisibility.js` es la única fuente:

- **Borrador** — `oculta: true`, sin `publishedAt` ni `publishAt`. Nunca se
  publicó. No lleva número ni entra a calificaciones.
- **Programada** — `publishAt` en el futuro. Se publica sola (una Cloud
  Function cada 30 min).
- **Publicada** — visible. `publishedAt` es permanente… salvo que el docente la
  **regrese a borrador**, la única acción que lo borra.

Ojo con la distinción entre *ocultar con el ojito* (temporal, conserva
`publishedAt`) y *guardar como borrador* (la despublica de verdad, le quita el
número y la saca de las exportaciones).

### Numeración y calificación

El número (`1.1`, `1.2`…) **no se guarda**: se calcula por posición dentro del
parcial, y solo cuentan las actividades que van a la boleta. El predicado
`cuentaParaCalificacion(a)` = no es borrador **y** no está marcada "sin
calificación". Se usa en tabla de calificaciones, promedios, cierre de parcial,
tope de ponderación, numeración y exportaciones — **no** en el calendario, la
agenda ni la lista del alumno.

### Rúbricas y listas de cotejo

Un entregable puede llevar rúbrica (varios niveles por criterio) o lista de
cotejo (cumple / no cumple). La actividad guarda una **copia** de la rúbrica:
editar la del banco nunca cambia actividades ya creadas ni notas ya puestas.

### Ponderación y cierre de parcial

Sin ponderación, el promedio del parcial es la media simple de lo calificado.
Con `ponderacionParciales[p]` activa, cada actividad lleva `pesoCalificacion`
(los pesos deben sumar 10 para poder exportar) y el promedio es la media
ponderada. **Cerrar un parcial** (`parcialesCerrados`) congela sus
calificaciones y pone 0 a quien no entregó; se puede revertir.

### Fechas límite y prórrogas

`fechaLimite` con hora; `recibirTarde` decide si se aceptan entregas después
(marcadas como tardías). `extensiones{alumnoId: fecha}` da prórroga individual,
con su motivo.

---

## 5. Evaluaciones: cuestionarios y exámenes

Un cuestionario o un examen es una actividad con `tipo: 'evaluacion'` y
`categoria: 'cuestionario' | 'examen'`. Comparten **todo** el motor; solo
cambian sus valores por omisión al crearse:

| | Cuestionario | Examen |
|---|---|---|
| Navegación | Libre | Secuencial |
| Tiempo límite | Sin límite | 30 min |
| Intentos | Ilimitados | 1 |
| Con varios intentos, conservar | La mejor | El último |

### 5.1 Datos

```
activities/{id}.evaluacion = { ...configuración..., secciones: [...] }

activities/{id}/preguntas/{preguntaId}
  tipo: 'opcion_multiple' | 'verdadero_falso' | 'respuesta_corta' | 'subir_archivo'
  enunciado, imagen?, retroalimentacion
  ponderacion                           // puntos que vale (deben sumar 10)
  opciones: [{ id, texto, esOtra }]     // esOtra deja escribir texto libre
  respuestaCorrecta: opcionId | null
  seccionId, seccionNombre              // §5.6

submissions/{id}
  alumnoId (id de INSCRIPCIÓN), actividadId
  estadoEvaluacion: 'en_progreso' | 'finalizado'
  estado: 'entregado' | 'calificado'
  calificacion, pendienteRevision
  intentoActual, intentos: [{ numero, calificacion }]
  tiempoInicio, fechaEntrega, ordenSeed

submissions/{id}/respuestas/{preguntaId}
  opcionSeleccionada, otraTexto, textoRespuesta, archivoURL, nombreArchivo
  puntosObtenidos, comentarioDocente
```

### 5.2 Configuración (`activity.evaluacion`)

| Campo | Valores | Efecto |
|---|---|---|
| `ordenPreguntas` | `creacion` \| `aleatorio` | Orden distinto por alumno; la semilla se fija por intento (`ordenSeed`) para que no cambie al recargar |
| `barajarRespuestas` | bool | Baraja las opciones dentro de cada reactivo; "Otra" siempre queda al final |
| `navegacion` | `libre` \| `secuencial` | Secuencial impide regresar |
| `tiempoLimiteMin` | número \| null | **El cronómetro sigue corriendo aunque el alumno salga de la app** |
| `intentosPermitidos` | número \| null | `null` = ilimitados |
| `conservar` | `primero` \| `ultimo` \| `mejor` \| `promedio` | Qué nota queda con varios intentos |
| `publicarResultados` | `inmediato` \| `ahora` \| `fecha` \| `nunca` | Cuándo ve su calificación |
| `publicarRespuestas` | igual | Cuándo ve sus respuestas. **Independiente de la calificación** |
| `mostrarRespuestasCorrectas` / `mostrarRetroalimentacion` / `mostrarPorcentaje` | bool | Qué incluye la revisión |
| `sinCalificacion` | bool | No vale para la boleta (§5.5) |
| `ponderarReactivos` | bool | Solo con `sinCalificacion` (§5.5) |
| `secciones` | array | §5.6 |
| `mostrarSecciones` | bool | Si el alumno ve los nombres de sección |

`nunca` gana sobre cualquier fecha o bandera que hubiera quedado de una
configuración anterior.

### 5.3 Cómo se califica

**Los puntos los pone el servidor, nunca el cliente.** `onEvaluacionFinalizada`
(`functions/index.js`) se dispara cuando una submission queda en `finalizado`:

1. Lee reactivos y respuestas.
2. Tipos **objetivos** (opción múltiple, verdadero/falso): acierto = su
   `ponderacion`, error = 0. Tipos de **revisión manual** (respuesta corta,
   subir documento): `null` = pendiente del docente.
3. `calificacion = (obtenidos / suma de ponderaciones) × maxCalif`, a un decimal.
4. `resolverCalificacionFinal` aplica la política `conservar`.
5. Escribe todo en una transacción. Es **idempotente**: si ese intento ya está
   en `intentos[]`, se sale.

Las reglas de Firestore impiden que el alumno se ponga nota: al crear,
`calificacion` debe ser `null` y `estado` no puede ser `'calificado'`; al
actualizar, un diff que toque `calificacion`, `intentos` o `pendienteRevision`
se rechaza; y no puede escribir `puntosObtenidos` en sus respuestas.

### 5.4 Los dos flujos

**Estudiante** — ve la actividad si está publicada → `EvaluacionRunner`
(pantalla completa, autoguarda cada respuesta, respeta navegación y cronómetro)
→ al terminar el servidor califica → ve su nota si `publicarResultados` lo
permite y sus respuestas si `publicarRespuestas` lo permite.

**Docente** — dos pantallas con el mismo motor: `EvaluacionEditor` (pantalla
completa, para armar) y `EvaluacionManager` (pestañas Preguntas ·
Configuración · Resultados dentro de la actividad). En Resultados: panel de
análisis (promedio, máxima, mínima, % de aprobación, entregas, pendientes),
revisión por estudiante con calificación manual de los reactivos abiertos,
gráficas de pastel por reactivo y descargas.

### 5.5 "Sin calificación"

Para un diagnóstico o una encuesta: se contesta y se revisa, pero no vale para
la boleta.

| Sí sigue | Ya no |
|---|---|
| Visible en Actividades, calendario y agenda | Lleva número |
| Contestable por el estudiante | Aparece en la tabla de calificaciones |
| Con todas sus respuestas y gráficas para el docente | Entra al promedio ni a la ponderación |
| Exportable por reactivo | Sale en las exportaciones de calificaciones |

Al marcarla se pregunta **si los reactivos tendrán ponderación**:
*con puntos* arroja un resultado (8 de 10) para medir al grupo sin afectar la
calificación; *sin puntos* es una encuesta y al alumno **no se le muestra
ningún resultado** (un "0" sin aciertos que contar no significaría nada).

### 5.6 Secciones (opcionales)

Agrupan los reactivos por tema, competencia o aprendizaje. Un instrumento que
no las usa se comporta exactamente igual que antes de que existieran.

**Dónde viven:** en `activity.evaluacion.secciones`, un arreglo
`[{ id, nombre, descripcion }]` dentro del documento de la actividad — **no**
una colección aparte. Son pocas, siempre se necesitan junto con la
configuración que ya se lee del mismo documento, reordenarlas es una sola
escritura atómica y heredan las reglas de `activities`.

**Cómo se ligan:** cada reactivo guarda `seccionId` (la verdad para agrupar) y
`seccionNombre` (copia deliberada, para estadísticas futuras y exportaciones
sin cruzar con la configuración, y para que una hoja de respuestas conserve el
nombre que la sección tenía al aplicarse). Renombrar actualiza el nombre en sus
reactivos.

**El orden:** `orden` es **relativo a su sección**. Por eso la lista plana
ordenada por ese campo ya no sirve para presentar — todo usa `preguntasEnOrden`
(sueltas primero, luego cada sección). Al mover un reactivo de sección se le
recalcula el orden para que entre al final del grupo destino.

**El aleatorio** baraja *dentro* de cada sección, con semilla distinta por
sección: un reactivo nunca se sale de la suya.

Se puede: crear, renombrar, reordenar y eliminar secciones (al eliminar, sus
reactivos **no** se borran: quedan sueltos); agregar reactivos dentro o fuera
de una sección; moverlos entre secciones desde su formulario de edición;
reordenarlos dentro de su grupo; y ocultar los nombres al estudiante dejando
una lista continua.

**Preparado, no construido:** las estadísticas por sección no existen todavía.
Lo que está listo es el dato en cada reactivo y su presencia en Excel y PDF.

### 5.7 Publicación: dos cosas distintas

No confundir:

1. **Publicación de la ACTIVIDAD** (`oculta` / `publishAt` / `publishedAt`): si
   el estudiante la ve o no.
2. **Publicación de RESULTADOS y RESPUESTAS**: si ve su calificación y qué
   contestó. Solo aplica a evaluaciones y son independientes entre sí.

---

## 6. Actividades interactivas: crucigrama y sopa de letras

Una actividad interactiva es una actividad con `tipo: 'juego'` y
`categoria: 'crucigrama' | 'sopa_letras'`. El contenido (palabras y pistas)
se genera con IA y el tablero se construye en el servidor mediante la Cloud
Function `construirJuego`. La calificación también ocurre en el servidor
(`onJuegoFinalizado`), nunca en el cliente.

### 6.1 Datos

```
activities/{id}.juego = {
  tipo:      'crucigrama' | 'sopa_letras',
  estado:    'generando' | 'borrador' | 'juego_confirmado',
  estructura: {
    tipo:     'crucigrama' | 'sopa_letras',
    size:     N,                        // lado del tablero (8 o 10)
    grid:     [{ row: string[] }, …],  // N filas; Firestore prohíbe arrays anidados
    palabras: [{ index, fila, col, horizontal, longitud, numero, palabra,
                 descripcion, normalizada }]
  }
}

submissions/{id}
  alumnoId, actividadId
  estado: 'entregado' | 'calificado'
  calificacion                         // 0–maxCalif, un decimal
  intentos: [{ numero, calificacion }]
  respuestasJuego:
    // crucigrama → { celdas: { "r-c": "LETRA" } }
    // sopa_letras → { encontradas: [índice, …] }
```

> **Nota de formato:** `grid` almacena cada fila como `{ row: string[] }` porque
> Firestore rechaza `Array<Array>`. El cliente y el servidor deben leer
> `grid[r].row[c]`, no `grid[r][c]`.

### 6.2 Criterios de calificación

#### Crucigrama — unidad: celda/letra

Cada celda con letra correcta aporta proporcionalmente al total de celdas con
letra del tablero. Las intersecciones (celdas compartidas por dos palabras) se
cuentan **una sola vez** porque representan una sola posición en el grid.

```
ratio        = celdas_correctas / total_celdas_con_letra
calificacion = parseFloat((ratio * maxCalif).toFixed(1))
```

- Se permite crédito parcial: una palabra parcialmente correcta recibe
  crédito proporcional según sus letras acertadas.
- Cada letra se normaliza antes de comparar (`normalizarPalabra`:
  mayúsculas, sin tildes, Ñ → N, solo A–Z).

Ejemplo: 90 de 100 celdas correctas → 90 % → **9.0 / 10**.

#### Sopa de letras — unidad: palabra encontrada

Solo cuenta si el estudiante marcó la trayectoria completa de la palabra. No
existe crédito parcial.

```
ratio        = palabras_encontradas / total_palabras
calificacion = parseFloat((ratio * maxCalif).toFixed(1))
```

- Una palabra encontrada en sentido inverso es válida (la mecánica del tablero
  la acepta).
- Las palabras no encontradas valen 0; no hay estado intermedio.

Ejemplo: 8 de 10 palabras encontradas → 80 % → **8.0 / 10**.

#### Pipeline de conversión (común a ambas actividades)

```js
// functions/_shared/ponderacion.js
normalizeGrade(ratio * 10, 10, { base: maxCalif, decimals: 1 })
// → parseFloat(((ratio * 10 / 10) * maxCalif).toFixed(1))
// → parseFloat((ratio * maxCalif).toFixed(1))
```

La escala máxima (`maxCalif`) la fija el docente al crear la actividad. El
redondeo es siempre a **un decimal**.

### 6.3 Principio de diseño — por qué los criterios difieren

**No es un error que Crucigrama y Sopa de letras usen unidades de evaluación
distintas.** El criterio de calificación sigue la mecánica de cada juego:

| Juego | Interacción atómica | Criterio correcto |
|---|---|---|
| Crucigrama | El estudiante escribe una letra por celda | Por celda/letra (crédito parcial) |
| Sopa de letras | El estudiante arrastra sobre una palabra completa | Por palabra (binario) |

Forzar criterio por-palabra en el Crucigrama penalizaría un error mínimo
(una sola letra incorrecta) igual que la ignorancia total, lo que no mide
aprendizaje. Forzar criterio por-letra en la Sopa de letras es técnicamente
imposible sin rediseñar la mecánica: no existe estado "encontré 3 de 4 letras
de una palabra".

Ambas actividades usan el mismo pipeline final de calificación y la misma
escala, pero la **unidad de evaluación difiere por diseño**.

### 6.4 Dónde vive el código

| Componente | Archivo |
|---|---|
| Grading server-side | `functions/index.js` → `calificarCrucigrama()`, `calificarSopaDeLetras()` |
| Normalización de letra | `functions/_shared/normalizarPalabra.js` |
| Conversión de escala | `functions/_shared/ponderacion.js` → `normalizeGrade()` |
| Política de reintentos | `functions/calificacionIntentos.js` → `resolverCalificacionFinal()` |
| Tablero interactivo (alumno) | `src/components/juego/CrucigramaBoard.jsx`, `SopaDeLetrasBoard.jsx` |
| Runner (alumno) | `src/pages/student/JuegoRunner.jsx` |
| Vista docente (revisión) | `src/components/juego/ResolucionJuegoModal.jsx` |

---

## 7. Asistencia

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

## 8. Calendario y horario

- `horarioBloques` — cada clase **materializada por fecha**, para poder mover o
  cancelar una sola sin tocar el patrón.
- `asuetos` (un día) y `vacaciones` (un periodo), cada uno con su alcance:
  clases, eventos, actividades, asistencias.
- `events` (privados del docente), `academicEvents` (compartidos con sus
  alumnos) y `studentEvents` (del propio alumno).

El calendario del docente y la Agenda del alumno comparten los componentes de
vista (Día / 3 días / Semana / Mes) y los helpers de `calendarEvents.js`.

---

## 9. Avisos

Comunicados del docente a todo el grupo. **No es un chat**: sin respuestas,
comentarios ni reacciones.

Lo distintivo: el alumno recibe un **modal de lectura obligatoria** que no se
puede cerrar hasta tocar "Entendido" en cada aviso pendiente (`AvisosGate`,
montado en el layout del alumno, así que bloquea en cualquier pantalla). Cada
confirmación queda en `avisoLecturas`, que es **inmutable**: es auditoría de
que sí se mostró.

Un aviso solo le toca a quien ya estaba en la asignatura cuando se publicó: el
corte es el más tardío entre su alta y su activación (`avisosDesde`). El
docente ve el avance de lectura contando solo a esos destinatarios reales.

---

## 10. Notificaciones

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
| `onPagoCreado` | Avisa al admin de un pago nuevo |

**Criterio opt-out en todas**: ausente o `true` = notifica; solo se salta si el
usuario lo apagó a propósito. Invertirlo dejó a casi todos sin notificaciones
una vez — no volver a cambiarlo sin cambiar también el default de la pantalla.

Los recordatorios de clase y evento del docente son **notificaciones locales**
del teléfono (`localReminders.js`), no push del servidor.

---

## 11. Suscripciones y el candado

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

Ve una ventana que **se puede cerrar** ("Solo consultar y descargar lo mío") y
un botón fijo para volver a abrirla; reaparece cada vez que intenta trabajar.

### El candado tiene dos capas y hay que moverlas juntas

1. **Cliente** — `src/utils/firestoreGuard.js`. Las pantallas del docente
   importan `addDoc/setDoc/updateDoc/deleteDoc/writeBatch` **de ahí** en vez de
   `firebase/firestore`; el módulo las deja pasar o lanza. Es lo que abre la
   ventana de pago.
2. **Servidor** — `firestore.rules`: `docenteActivo()` compara `request.time`
   contra `users/{uid}.suscripcionHasta`, un Timestamp que espeja una Cloud
   Function. Es la capa que no se puede rodear.

Campo **ausente = se deja pasar**, a propósito: un dato faltante no debe dejar
a nadie fuera de su trabajo. Una función programada cada hora vuelve a espejar
todo, así que el respaldo inicial y cualquier desfase se corrigen solos.

Los estudiantes **no se ven afectados** en nada si su maestro no paga.

### Documentos con marca de agua

Sin marca solo quien **ya pagó y sigue dentro de lo pagado** (`planId` +
no vencida). La prueba lleva marca; una transferencia declarada pero sin
aprobar, también.

### Correos automáticos

`api/cron/reminders.js`, una vez al día: prueba por terminar (6 días y el
último), suscripción por vencer (7 días y el día), y retención (a los 60 y 83
días de vencida). **El borrado automático a los 90 días no existe**: se elimina
a mano desde el panel, apoyándose en la columna "Días sin accesar".

---

## 12. Exportaciones

Todo con membrete (escuela + docente + periodo) y marca de agua si aplica.
**Solo desde la web**: en la app los botones se quedan a la vista y explican
dónde hacerlas (`descargaSoloWeb`).

| Documento | Archivo |
|---|---|
| Calificaciones (curso / parcial), ranking, asistencia, resultados de evaluación | `src/utils/excel.js` |
| Los mismos + lista de acceso + resultados por reactivo + gráficas | `src/utils/pdf.js` |
| Entregas de los alumnos en ZIP | `downloadSubmissions.js` |

El Excel de resultados de una evaluación trae cuatro hojas: Resumen ·
Calificaciones · Respuestas (matriz alumno × reactivo) · Por reactivo.

En jsPDF **no existe el carácter `✓`** (las fuentes son WinAnsi): se dibuja con
dos trazos. Ya pasó una vez que salía impreso como una comilla suelta.

---

## 13. Panel de administración

`/admin`, solo para `role: 'admin'`. Pestañas: **Resumen** (tarjetas y
gráficas), **Suscripciones** (una fila por docente, con plan, vencimiento,
días, último pago y días sin accesar), **Pagos** (verificación manual de
transferencias, que es lo que activa una suscripción), **Estudiantes** y
**Cobros** (configuración de métodos).

"Días sin accesar" sale del último inicio de sesión que ya guarda Firebase Auth
(`api/admin/last-access`), no de un campo propio: así no cuesta una escritura
por login y trae historia de todas las cuentas.

---

## 14. La app Android

Capacitor empaqueta `dist/`. **No descarga nada del servidor**: para ver un
cambio hay que `npm run build && npx cap sync android` y volver a instalar.

Diferencias deliberadas con la web: sin descargas, calificaciones solo en web,
tablas de asistencia en horizontal, tamaños y espaciados propios. Se decide con
`IS_NATIVE_APP` (`src/utils/platform.js`).

`env(safe-area-inset-top)` **no se consume**: vale lo mismo en cualquier
elemento. Ponerlo dos veces abre dos huecos — ya pasó.

---

## 15. Seguridad — invariantes que no se negocian

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

## 16. Convenciones del proyecto

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

## 17. Lógica duplicada a propósito (y peligrosa)

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

Aparte, los dos editores de evaluación (`EvaluacionEditor` y
`EvaluacionManager`) tienen **cada uno su copia del formulario de reactivos**.
Es deuda conocida: lo nuevo (secciones) se escribió una sola vez y se comparte;
lo viejo sigue duplicado. Un cambio al formulario hay que hacerlo en los dos.

---

## 18. Despliegue

| Qué | Cómo | Automático |
|---|---|---|
| Web | push a `main` | sí (Vercel) |
| Reglas de Firestore | `firebase deploy --only firestore:rules` | **no** |
| Índices | `firebase deploy --only firestore:indexes` | **no** |
| Cloud Functions | `firebase deploy --only functions` | **no** |
| App Android | `npm run build && npx cap sync android` + Run | **no** |

Después de cada merge conviene verificar que el despliegue **pasó**, no solo
que salió:

```bash
curl -s https://evalua-facil.vercel.app/version.json   # responde el commit desplegado
```

---

## 19. Por dónde empezar a leer

| Si te toca… | Empieza por |
|---|---|
| Actividades y visibilidad | `src/utils/activityVisibility.js` |
| Calificaciones | `src/utils/ponderacion.js` + pestaña Calificaciones de `teacher/SubjectPage.jsx` |
| Evaluaciones | `src/utils/evaluacionGrading.js`, `evaluacionRespuestas.js`, `secciones.js` |
| Juegos (crucigrama / sopa) | `functions/index.js` → `calificarCrucigrama()`, `calificarSopaDeLetras()`; §6 de este doc |
| Asistencia | `src/utils/attendance.js`, `attendanceAuto.js` |
| Avisos | `src/utils/avisos.js`, `src/components/AvisosGate.jsx` |
| Notificaciones | `functions/index.js`, `src/utils/pushNotifications.js` |
| Suscripciones | `src/utils/subscriptionHelpers.js`, `firestoreGuard.js`, `firestore.rules` |
| Exportaciones | `src/utils/excel.js`, `pdf.js`, `membrete.js` |
| Estilos | [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) |

Los archivos grandes (`teacher/SubjectPage.jsx` ~7 000 líneas,
`EvaluacionManager.jsx`, `EvaluacionEditor.jsx`) concentran mucho: conviene
buscar por el nombre de la función antes que leerlos de corrido.
