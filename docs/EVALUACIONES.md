# Cuestionarios y exámenes — cómo funcionan hoy

Documento de referencia del subsistema de **evaluaciones** de Evalúa Fácil.
Escrito para que alguien (o algo) que no ha visto el repo entienda el modelo
completo sin tener que leerlo.

Actualizado: 5-ago-2026.

**Contexto de la plataforma:** SPA React 19 + Vite, Firebase Auth + Firestore,
Cloud Functions para lo que debe decidir el servidor, y unos pocos endpoints en
Vercel. No hay backend propio. Se usa en web y en una app Android (Capacitor)
que empaqueta el mismo `dist`.

---

## 1. Qué es una evaluación

Un cuestionario o un examen es una **actividad** (`activities/{id}`) con
`tipo: 'evaluacion'` y `categoria: 'cuestionario' | 'examen'`. Convive con los
otros dos tipos de actividad:

| Tipo | `tipo` | Qué hace el alumno |
|---|---|---|
| Entregable | `archivo` | Sube uno o más archivos |
| Observación | `observacion` | Nada — el docente solo registra una nota |
| **Evaluación** | `evaluacion` | Contesta reactivos dentro de la app |

Cuestionario y examen comparten **todo** el motor. Solo cambian sus valores por
omisión al crearse:

| | Cuestionario | Examen |
|---|---|---|
| Navegación | Libre | Secuencial |
| Tiempo límite | Sin límite | 30 min |
| Intentos | Ilimitados | 1 |
| Con varios intentos, conservar | La mejor | El último |

Definidos en `EVALUACION_DEFAULTS` (`src/components/EvaluacionEditor.jsx`).

---

## 2. Modelo de datos

```
activities/{id}
  tipo: 'evaluacion'
  categoria: 'cuestionario' | 'examen'
  nombre, instrucciones (HTML saneado), archivosAdjuntos[]
  parcial, orden, asignaturaId, docenteId
  maxCalif: 10                          // escala de la nota
  fechaLimite, recibirTarde
  extensiones: { [alumnoId]: fecha }    // prórrogas individuales
  extensionesMotivo: { [alumnoId]: texto }
  oculta, publishAt, publishedAt        // visibilidad de la ACTIVIDAD
  pesoCalificacion                      // su peso dentro del parcial
  notificarDocente                      // avisarle cuando alguien entregue
  evaluacion: { ...configuración... }   // ver §3

activities/{id}/preguntas/{preguntaId}
  tipo: 'opcion_multiple' | 'verdadero_falso' | 'respuesta_corta' | 'subir_archivo'
  enunciado, imagen?, retroalimentacion
  ponderacion                           // puntos que vale (deben sumar 10)
  opciones: [{ id, texto, esOtra }]     // esOtra deja escribir texto libre
  respuestaCorrecta: opcionId | null

submissions/{id}                        // una por (alumno, actividad)
  alumnoId                              // ⚠ id del doc de INSCRIPCIÓN en `students`,
                                        //   NO el uid de Auth
  actividadId
  estadoEvaluacion: 'en_progreso' | 'finalizado'
  estado: 'entregado' | 'calificado'
  calificacion, pendienteRevision
  intentoActual, intentos: [{ numero, calificacion }]
  tiempoInicio, fechaEntrega
  ordenSeed                             // semilla del barajado, fija por intento

submissions/{id}/respuestas/{preguntaId}
  opcionSeleccionada, otraTexto         // cerradas
  textoRespuesta                        // respuesta corta
  archivoURL, nombreArchivo             // subir documento
  puntosObtenidos                       // lo escribe el servidor o el docente
  comentarioDocente

bancoReactivos/{id}                     // banco personal del docente,
                                        // reutilizable entre asignaturas
```

---

## 3. Configuración (`activity.evaluacion`)

| Campo | Valores | Efecto |
|---|---|---|
| `ordenPreguntas` | `creacion` \| `aleatorio` | Orden distinto por alumno; la semilla se fija por intento (`ordenSeed`) para que no cambie al recargar |
| `barajarRespuestas` | bool | Baraja las opciones dentro de cada reactivo |
| `navegacion` | `libre` \| `secuencial` | Secuencial impide regresar a un reactivo ya contestado |
| `tiempoLimiteMin` | número \| null | **El cronómetro sigue corriendo aunque el alumno salga de la app** |
| `intentosPermitidos` | número \| null | `null` = ilimitados |
| `conservar` | `primero` \| `ultimo` \| `mejor` \| `promedio` | Qué nota queda cuando hay varios intentos |
| `publicarResultados` | `inmediato` \| `ahora` \| `fecha` \| `nunca` | Cuándo ve su calificación |
| `publicarResultadosFecha` | ISO \| null | Solo con `fecha` |
| `resultadosPublicados` | bool | Bandera que enciende `ahora` al guardar |
| `publicarRespuestas` + sus dos campos | igual | Cuándo ve sus respuestas. **Independiente de la calificación** |
| `mostrarRespuestasCorrectas` | bool | La revisión marca cuál era la correcta |
| `mostrarRetroalimentacion` | bool | La revisión muestra el comentario del reactivo |
| `mostrarPorcentaje` | bool | Muestra el % junto a la nota |
| `sinCalificacion` | bool | La actividad no vale para la boleta (§7) |
| `ponderarReactivos` | bool | Solo aplica con `sinCalificacion` (§7) |

`nunca` gana sobre cualquier fecha o bandera que hubiera quedado de una
configuración anterior (`publicacionVisible`, `src/utils/evaluacionGrading.js`).

---

## 4. Cómo se califica

**Los puntos los pone el servidor, nunca el cliente.**

La Cloud Function `onEvaluacionFinalizada` (`functions/index.js`) se dispara
cuando una submission queda en `estadoEvaluacion: 'finalizado'`:

1. Lee los reactivos y las respuestas guardadas.
2. `calcularPuntosPregunta` por reactivo:
   - Tipos **objetivos** (opción múltiple, verdadero/falso): acierto = su
     `ponderacion`, error = 0.
   - Tipos de **revisión manual** (respuesta corta, subir documento):
     `null` = pendiente del docente.
3. `calificacion = (puntos obtenidos / suma de ponderaciones) × maxCalif`,
   redondeada a un decimal (`calcularCalificacion`).
4. `resolverCalificacionFinal` aplica la política `conservar` contra los
   intentos previos.
5. Escribe `calificacion`, `pendienteRevision`, `estado` y agrega el intento a
   `intentos[]`, todo en una transacción.

Es **idempotente**: si ese número de intento ya está en `intentos[]`, se sale
sin hacer nada.

La lógica pura vive en `src/utils/evaluacionGrading.js` y está duplicada en
`functions/index.js` (no se puede importar entre paquetes). Si cambia una,
cambia la otra.

### Por qué el servidor y no el cliente

Las reglas de Firestore impiden que el alumno se ponga nota:

- Al **crear** su submission, `calificacion` debe ser `null` y `estado` no
  puede ser `'calificado'`.
- Al **actualizar**, un diff que toque `calificacion`, `intentos` o
  `pendienteRevision` se rechaza (`studentNoTocaCalificacion`).
- En `respuestas/`, el alumno no puede escribir `puntosObtenidos`.
- Solo el docente dueño de la actividad puede **borrar** una submission
  (borrarla borraría su calificación).

---

## 5. Flujo del estudiante

1. **Ve la actividad** si está publicada (`isActivityPublished`) y su parcial no
   está oculto.
2. **Entra a `EvaluacionRunner`** (`src/pages/student/EvaluacionRunner.jsx`),
   pantalla completa: autoguarda cada respuesta conforme avanza, respeta la
   navegación y el cronómetro.
3. **Al terminar**, la submission pasa a `finalizado` y el servidor califica.
4. **Ve su calificación** solo si `publicarResultados` lo permite; **sus
   respuestas**, solo si `publicarRespuestas` lo permite
   (`EvaluacionRevision.jsx`).

Si hay reactivos de revisión manual, su nota puede subir cuando el docente los
califique.

---

## 6. Flujo del docente

Dos pantallas, mismo motor:

- **`EvaluacionEditor`** — pantalla completa, para armar la evaluación.
- **`EvaluacionManager`** — dentro de la página de la actividad, con pestañas
  Preguntas · Configuración · Resultados.

En **Resultados**:

- Panel de análisis: promedio, calificación máxima y mínima, % de aprobación,
  total de estudiantes, entregas y pendientes.
- Lista por estudiante → revisión de su intento, con calificación manual de los
  reactivos abiertos (puntos + comentario).
- **Gráficas**: un pastel por reactivo con su leyenda (opción, respuestas, %).
- **Descargas** (solo desde la web):
  - **Excel**, cuatro hojas: Resumen · Calificaciones (una fila por estudiante:
    estado, nota, aciertos, hora de entrega, duración, intento) · Respuestas
    (matriz alumno × reactivo) · Por reactivo.
  - **PDF de tablas**: por reactivo, con opción / respuestas / porcentaje.
  - **PDF de gráficas**: los pasteles tal como se ven en pantalla.

Todos los documentos llevan membrete (escuela + docente) y marca de agua si la
suscripción no está pagada.

---

## 7. "Sin calificación"

Para un diagnóstico, una encuesta o un repaso: se contesta y se revisa, pero no
vale para la boleta.

Con `sinCalificacion` activo, la actividad:

| Sí sigue | Ya no |
|---|---|
| Visible en Actividades, calendario y agenda | Lleva número (`1.1`, `1.2`… solo numeran lo que cuenta) |
| Contestable por el estudiante | Aparece en la tabla de calificaciones |
| Con todas sus respuestas y gráficas para el docente | Entra al promedio del parcial ni a su ponderación |
| Exportable por reactivo | Sale en las exportaciones de calificaciones |

Al marcarla se pregunta **si los reactivos tendrán ponderación**
(`ponderarReactivos`):

- **Con puntos** — arroja un resultado (8 de 10) para medir al grupo, sin
  afectar la calificación.
- **Sin puntos** — encuesta pura: al alumno **no se le muestra ningún
  resultado**, porque un "0" sin aciertos que contar no significaría nada.

### El predicado

```js
// src/utils/activityVisibility.js
cuentaParaCalificacion(a) === !isDraftActivity(a) && !sinCalificacion(a)
```

Separa dos cosas que antes eran la misma: *"aparece en Actividades"* (cualquier
cosa publicada) y *"cuenta para la calificación"*. Está aplicado **solo** en
contextos de calificación y numeración — tabla de calificaciones, promedios,
cierre y reapertura de parcial, tope de ponderación, numeración (docente y
alumno) y exportaciones. El calendario, la agenda y la lista del alumno usan los
predicados de visibilidad, que no cambiaron.

---

## 8. Publicación: dos cosas distintas

No confundir:

1. **Publicación de la ACTIVIDAD** (`oculta` / `publishAt` / `publishedAt`):
   si el estudiante la ve o no. Se decide en el editor, bloque "Visibilidad",
   y se puede programar. Guardarla como borrador la despublica por completo.
2. **Publicación de RESULTADOS y RESPUESTAS**
   (`publicarResultados` / `publicarRespuestas`): si ve su calificación y si ve
   qué contestó. Solo aplica a evaluaciones y son independientes entre sí.

---

## 9. Notificaciones asociadas

Todas en `functions/index.js`, todas respetan los interruptores de
`notificationSettings/{uid}` (criterio **opt-out**: ausente = sí notifica):

| Función | Cuándo | A quién |
|---|---|---|
| `onActividadEscrita` | La evaluación se hace visible | Alumnos de la asignatura |
| `onSubmissionActualizada` | Se publica una calificación | Al alumno |
| `onSubmissionEntregada` | Alguien entrega, si la actividad tiene "Notificarme" | Al docente |
| `revisarProgramados` (cada 30 min) | Publica lo programado y avisa fechas límite próximas | Según corresponda |

Todo push realmente enviado queda en `notificationLog`, que alimenta la
**Bitácora de notificaciones** de docente y alumno.

---

## 10. Reglas del entorno (leer antes de modificar)

- **Firestore solo admite igualdades**: nada de `<`, `>`, `!=` ni `orderBy` en
  las consultas. Todo se ordena en memoria. Los índices compuestos desplegados
  están en `firestore.indexes.json`.
- El **alumno no tiene documento en `users`**: su identidad vive en `students`
  y su correo de Auth es falso (`usuario.escuela@evalua.local`).
- Un alumno tiene **un doc de inscripción por asignatura**, todos con el mismo
  `uid`. Por eso `submissions.alumnoId` es el id de la inscripción, no el uid.
- Un **docente sin suscripción vigente no puede escribir nada**: lo aplican las
  reglas de Firestore contra `users/{uid}.suscripcionHasta`, que espeja una
  Cloud Function. Leer y exportar siguen libres siempre.
- **Vercel (plan Hobby) admite 12 funciones serverless**; hoy hay 9. Pasarse
  hace fallar TODOS los despliegues.
- Las descargas (Excel/PDF) **solo existen en la web**: en la app los botones
  se quedan a la vista y explican dónde hacerlas.

---

## 11. Archivos principales

| Archivo | Qué contiene |
|---|---|
| `src/components/EvaluacionEditor.jsx` | Editor de pantalla completa (info, reactivos, configuración) |
| `src/components/EvaluacionManager.jsx` | Pestañas dentro de la actividad + Resultados + revisión |
| `src/components/EvaluacionGraficas.jsx` | Pasteles por reactivo + PDF de gráficas |
| `src/components/EvaluacionStatsPanel.jsx` | Panel de análisis |
| `src/components/SinCalificacionConfig.jsx` | Casilla "Sin calificación" + ponderación de reactivos |
| `src/components/PublicacionScheduler.jsx` | Selector de publicación (incluye "No publicar") |
| `src/pages/student/EvaluacionRunner.jsx` | El alumno contestando |
| `src/pages/student/EvaluacionRevision.jsx` | El alumno revisando sus respuestas |
| `src/utils/evaluacionGrading.js` | Cálculo puro de puntos, nota y publicación |
| `src/utils/evaluacionRespuestas.js` | Lectura de respuestas + conteos por opción (gráficas, PDF, Excel) |
| `src/utils/activityVisibility.js` | Visibilidad, borradores y `cuentaParaCalificacion` |
| `functions/index.js` | `onEvaluacionFinalizada` y las notificaciones |
