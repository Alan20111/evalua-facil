# Reto Exprés — especificación

Competencia educativa en vivo, inspirada en Kahoot, dentro de Evalúa Fácil. El docente organiza y proyecta la
competencia desde su computadora; los participantes responden desde el celular.

> Estado (4-nov-2026): etapas 0 a 5 EN PRODUCCIÓN (PR #1694), con archivos de referencia en la IA (#1696). El tiempo
> configurable por pregunta (§2, «Tiempo») está en una rama aparte. Falta la etapa 6 (prueba con 40 teléfonos). Cada etapa se autoriza por separado
> (ver `AGENTS.md`), y las etapas 2, 3 y 4 se fusionan JUNTAS cuando estén terminadas y verificadas (S1).

- Lógica pura: `src/utils/retoExpres.js` · pruebas: `test/reto-expres.test.mjs` (`node test/reto-expres.test.mjs`)
- Reglas: bloque «Reto Exprés» de `firestore.rules` (colecciones) y funciones `retoBienFormado`, `retoIntacto`,
  `esRetoExterno` y `esReto` (candados) · pruebas: `test/firestore-rules.test.mjs` (`npm run test:rules`, checks
  `RETO ·`, `RETO 1-BIS ·` y `RETO 3 ·`)
- Servidor en vivo: `api/_lib/reto.js` (participantes), `api/_lib/retoControl.js` (docente), `api/_lib/retoComun.js`;
  limpieza al borrar: `functions/retoLimpieza.js` · pruebas: `test/reto-servidor.test.mjs` (`npm run test:reto`)

---

## 1. Dos modalidades

La modalidad se elige al **crear** el reto y **nunca cambia** (E10). Para cambiarla se crea otro reto.

| | **A. Estudiantes inscritos** (`inscritos`) | **B. Externo no calificable** (`externo`) |
|---|---|---|
| Quién participa | Estudiantes autenticados e inscritos en la asignatura (D8) | Cualquiera con el QR o el enlace, sin cuenta (E1) |
| Cómo entra | Con su sesión de estudiante | QR o enlace a la web móvil `/r/{código}`; no instala nada |
| Identidad | Nombre real **o** alias, según elija el docente (D5) | Siempre alias; no se pide ni se muestra identidad académica |
| Calificable | Opcional; solo si el docente lo decide y lo aplica (D7) | **Nunca** (E1, E2, E10) |
| Visible para los inscritos de la asignatura | Sí, en su lista de actividades | No: actividad oculta, sin número ni promedio (E1) |
| Reconexión | Desde cualquier dispositivo, con su cuenta | Solo con el mismo navegador (token) (E3) |
| Expulsión | Definitiva en la sesión | Definitiva para ese token; podría volver con otro dispositivo (E4) |
| Tope de participantes | El grupo inscrito | 40 por reto, validado en el servidor (E7) |
| Al finalizar ve | Puntaje, posición, top 10 y **corrección completa** (D9) | Puntaje, posición y top 10; **sin respuestas correctas** (E11) |
| Conservación de datos | Nada se borra solo: hasta que el docente borre el reto o la sesión | Igual: nada se borra solo (decisión del 3-nov-2026, reemplaza E8 y R2) |

---

## 2. Reglas comunes de la competencia

### Preguntas
- **Exactamente 10 preguntas** (D12). No se inicia con menos.
- Solo tipos que se califican solos: **opción múltiple** y **verdadero/falso** (`TIPOS_OBJETIVOS` de
  `src/utils/evaluacionGrading.js`). Respuesta corta y subir archivo no aplican.
- Origen: IA con la operación existente **`reactivos`**, sin archivos (D2), o reactivos del banco y de otras
  evaluaciones de la misma asignatura, **copiados** al reto sin tocar los originales (D10). Se mezclan si hace falta.
- El docente revisa y edita todo antes de iniciar.

### Créditos (D2, D11)
- Generar preguntas con IA: tarifa vigente de `reactivos` = **1 crédito por reactivo entregado** (leída de
  `config/iaTarifas`). Si la IA entrega menos, se cobra lo entregado; se completa sin cobro duplicado.
- No consumen créditos: entrar, responder, el temporizador, la clasificación ni consultar resultados.
- El movimiento se muestra como «Reto Exprés» sin alterar el ledger, importes, saldos ni otras etiquetas.

### Tiempo (D3, etapa 0; tiempo por pregunta desde el 4-nov-2026)
- Cada pregunta: **4 s de preparación** (no se muestra ni se responde) + **su tiempo para responder**, que elige el
  docente: **20 s, 30 s, 1 min, 2 min, 3 min o 5 min** (`DURACIONES_RETO_SEG`).
  - **Tiempo del reto** (`reto.tiempoSeg`, en «Datos del reto»): el de las preguntas nuevas, sean escritas, importadas o
    de la IA. El botón «Aplicar … a todas las preguntas» lo pone en las que ya existen.
  - **Tiempo de cada pregunta** (`tiempoSeg` en `activities/{id}/preguntas`): se cambia en su editor.
  - La sesión **congela** el tiempo de cada pregunta al crearse (`crearSesionReto`): editarlo después no cambia una
    competencia ya creada. Sin `tiempoSeg` (retos anteriores) = 20 s; un valor fuera de la lista impide crear la sesión.
  - `faseReto` suma los turnos (4 s + tiempo de cada pregunta): servidor, proyector y celulares siguen calculando
    lo mismo con la misma función. El contador se ve en segundos («45») y desde un minuto como «2:30».
  - La puntuación no cambia: no hay puntos por rapidez (D6).
- **Avance automático** calculado con el reloj del servidor: la sesión guarda `inicioMs` y la lista de `pausas`;
  la pregunta en curso se calcula. Cerrar el proyector, recargar o perder la conexión no reinicia ni detiene nada.
- **Pausar / reanudar**: congela el tiempo; nadie responde durante la pausa; al reanudar sigue con el tiempo que
  faltaba, **sin repetir** los 4 s. Una pausa **no tiene límite**: dura hasta que el docente reanude o termine.
- **La competencia solo termina** cuando el docente lo decide o cuando concluye normalmente la última pregunta.
  Nada la termina por inactividad: una desconexión del docente o el cierre del proyector no la finalizan ni la
  reinician.
- **Terminar antes** (con confirmación explícita): desde ese instante no se acepta nada.
  - La pregunta abierta o pausada al terminar **no cuenta** como realizada; sus respuestas se conservan (auditoría).
  - Las preguntas que nunca se abrieron no cuentan **ni se muestran** a los participantes.
  - Si se termina antes de abrir la primera pregunta: **sin clasificación ni calificación**; la sesión se conserva.

### Acceso (E5, E6)
- El docente **abre y cierra el acceso** en las dos modalidades. Ausente = cerrado.
- Cerrarlo impide **nuevos** participantes; quien ya está dentro sigue y puede reconectarse.
- Es independiente de pausar y terminar.
- **Ingreso tardío** permitido mientras el acceso esté abierto: las preguntas anteriores valen 0. No se responden
  preguntas cerradas ni se alteran resultados anteriores (D4).

### Puntuación y clasificación (D6, D7, E9)
- 1 punto por acierto, misma comparación que las evaluaciones. **Sin bono por rapidez.** Sin respuesta = 0.
- Una respuesta por persona y pregunta: vale la **primera** que llegó. Se descartan (y se cuentan) las duplicadas,
  fuera de tiempo, en pausa, anteriores al ingreso, de preguntas no realizadas o de desconocidos.
- Resultados calculados siempre **desde cero** a partir de las respuestas guardadas (sin contadores acumulados).
- **Empates**: comparten posición y la siguiente salta (**1, 1, 3**). Dentro del empate, orden alfabético; nunca la
  rapidez.
- **Durante la competencia** (4-nov-2026): el celular muestra la **clasificación provisional**: posición, puntos,
  cuántos compiten, qué le falta para alcanzar el lugar de arriba («Te falta 1 punto para alcanzar el 3.º lugar»;
  en 1.º, «¡Vas en primer lugar!» o «Compartes el 1.º lugar…») y los puestos 1 a 10 con su fila resaltada. Tarjeta
  grande en «Prepárate…», en pausa y en la lista; una franja de una línea mientras responde.
  - La calcula **el servidor** al cerrar cada pregunta con la misma `calcularResultadosReto` (sesión «terminada» justo
    en ese cierre): mismas reglas, empates, expulsados e ingresos tardíos. **Nunca incluye la pregunta abierta.**
  - Se guarda en `retoParcial/{código}`, una vez por pregunta, con el mismo «turno» que el registro definitivo, 1.5 s
    después del cierre (margen para respuestas aceptadas en el límite; cabe en los 4 s de preparación).
  - El celular manda `parcialVisto` (cuántas cerradas ya tiene) y solo recibe la clasificación cuando hay una más
    nueva: no se lee en cada consulta.
  - Ver los puntos le deja saber a cada uno, después del cierre, si acertó la pregunta que cerró. La opción correcta
    nunca viaja (tampoco a un externo: E11 sigue para la corrección). Aceptado por Kike el 4-nov-2026.
  - El proyector muestra los 5 primeros provisionales en «Prepárense…» (lee `retoParcial`; no la calcula).
- **Al final, en el celular**: la clasificación **completa** (todos los lugares), con los 3 primeros destacados, su
  fila resaltada, puntos y respuestas correctas (son el mismo número: 1 punto por acierto). Las filas no llevan ids.
  El proyector sigue mostrando los 10 primeros, con los 3 primeros destacados.
- Expulsados: fuera de la clasificación; sus respuestas se conservan (nada se borra solo).

### Calificación — solo inscritos (D7)
- Propuesta: **(aciertos ÷ preguntas realizadas) × calificación máxima**, con el redondeo de las evaluaciones
  (un decimal). Con 10 preguntas = aciertos ÷ 10 × máxima.
- Cada sesión conserva sus resultados. El docente decide explícitamente si aplica una sesión. **Nunca** se
  sobrescriben notas existentes ni se registra nada sin confirmación. Respeta parciales cerrados y sus protecciones.
- **Un reto externo nunca produce calificación** (`esCalificable`, `calificacionPropuestaReto`).

### Alias (D5, etapa 0)
- De 3 a 20 caracteres: letras (con acentos y ñ), números, espacio, punto, guion y guion bajo; al menos una letra.
- **Único por sesión**, sin distinguir mayúsculas, acentos, espacios ni signos («Ana-Luz» = «ana luz»).
- **Ofensivos**: detector existente `functions/moderacionSugerencias.js` (no se duplica su lista; no viaja al
  navegador). Se revisa también el alias separado en palabras («ElGrosero», «grosero123»). No garantiza detectar
  todo: el docente puede **renombrar** o **expulsar**.
- **Reservados** como palabra: docente, maestro/a, profesor/a, profe, admin, administrador/a, director/a,
  coordinador/a, moderador/a, soporte, sistema, evalúa; y «Evalúa Fácil» en cualquier parte. «Profeta» sí se permite.
- **Inscritos**: no puede ser el nombre real de ningún estudiante de la sesión, **incluido el propio**: nombre
  completo o nombre con cualquiera de los apellidos (también con números añadidos). El nombre de pila solo no se
  bloquea. El rechazo nunca dice a quién se parece.
- **Externos**: ofensivos, reservados y únicos (no hay lista de nombres).
- Lo valida el **servidor**; sin detector o sin lista (vacía en externo) se rechaza (falla cerrada).

---

## 3. Modalidad externa: seguridad

- **Código y QR**: código de 10 caracteres del alfabeto de Participación en vivo (≈ 8×10¹⁴ combinaciones) + límites
  por IP. El QR apunta a `/r/{código}`; solo funciona mientras el docente tenga el acceso abierto.
- **Token** (E3): al entrar, el servidor genera un secreto de 256 bits (64 hex), lo entrega una vez y el navegador
  lo guarda. El servidor guarda solo su huella SHA-256 (`tokenHash`); de ella sale el id del participante
  (`{código}_x{40 hex}`). Sin el token nadie actúa por él. Perder el navegador o navegar en privado = entrar como
  participante nuevo (se avisa en la pantalla).
- **Tope de 40** (E7, R3, R4): **40 lugares numerados** en la colección privada `retoCupos` (`{código}_1` a
  `{código}_40`). Entrar **crea** un lugar libre elegido al azar dentro de la misma transacción que crea al
  participante; si dos eligen el mismo, uno gana y el otro elige otro libre. Medido en el emulador: 45 entradas
  simultáneas → 40 dentro y 5 «cupo lleno» en 1.6 a 3 s, sin errores (con el contador: 20 a 117 s y entradas fallidas). No existen más números, así que nunca hay más de 40; un
  expulsado conserva su lugar. (Hasta el 4-nov-2026 era un contador único: con decenas de entradas a la vez las
  transacciones se bloqueaban entre sí.) **No es capacidad garantizada** hasta pasar la prueba de carga.
- **Expulsión** (E4): el token expulsado no vuelve a entrar ni a responder en esa sesión. Para reducir el regreso con
  otro dispositivo, cerrar el acceso al comenzar.
- **Sin datos académicos**: el registro de un externo solo lleva alias y huella del token; nunca inscripción ni
  nombre. La ruta externa nunca lee `students` ni escribe `submissions`, y las reglas lo impiden (etapa 1-bis, ver §6).
- **Claves**: nunca salen hacia un externo, ni al final (E11).

---

## 4. Conservación y borrado de datos (3-nov-2026, reemplaza E8, R1 y R2)

Mismo mecanismo que Participación en vivo, en las **dos** modalidades:

- Cada respuesta se guarda al recibirse. Pausar o desconectarse no pierde nada: el estado vive en `retoSesiones`.
- Al terminar, el servidor genera y guarda el **registro definitivo** (`retoResultados`) en la primera consulta que le
  llega (proyector, celular o el docente al volver a abrir el reto). Una marca de 15 s evita que varios lo calculen a
  la vez. **No hay tareas programadas.**
- **Nada se borra solo**: ni resultados, ni respuestas, ni alias, ni participantes, ni huellas de token. Sin caducidad.
- Solo se borra cuando el docente lo pide:
  - **borrar una sesión** (`retoSesiones/{código}`, lo permiten las reglas al docente dueño) → `onSesionRetoBorrada`
    limpia sus participantes, respuestas, alias, cupo, claves y resultados;
  - **borrar el reto** (o la asignatura) → `onRetoBorrado` limpia todas sus sesiones y sus preguntas y claves;
  - **borrar la cuenta** (docente o admin) → las siete colecciones `reto*` por `docenteId`.

---

## 5. Modelo de datos

| Colección | Contenido | Escribe | Lee |
|---|---|---|---|
| `activities/{id}` (`categoria: 'reto'`) | La actividad; `reto: { modalidad, modoIdentidad, calificable }` | Docente | Docente dueño |
| `activities/{id}/preguntas` + `/clave` | Las 10 preguntas y su clave (formato de evaluaciones) | Docente | Docente dueño |
| `retoSesiones/{código}` | Estado, inicio, pausas, terminación, acceso, preguntas públicas | Servidor (el dueño solo la borra) | Dueño, admin |
| `retoParticipantes/{id}` | Inscrito: inscripción, nombre, alias · Externo: alias, huella del token | Servidor | Dueño, admin |
| `retoRespuestas/{id}` | Opción elegida y hora del servidor | Servidor | Dueño, admin |
| `retoResultados/{código}` | Registro definitivo: clasificación, detalle y descartadas | Servidor | Dueño, admin |
| `retoParcial/{código}` | Clasificación provisional tras la última pregunta cerrada (4-nov-2026) | Servidor | Dueño (también ausente), admin |
| `retoClaves/{código}` | Copia congelada de la clave al iniciar | Servidor | Nadie desde un cliente |
| `retoAlias/{id}` | Reserva de alias únicos | Servidor | Nadie desde un cliente |
| `retoCupos/{código}_{n}` | Lugar n (1 a 40) del cupo de externos (R4) | Servidor | Nadie desde un cliente |

Ningún cliente crea ni modifica las colecciones `reto*` (el docente dueño solo puede borrar una sesión suya); los
participantes nunca leen Firestore directamente. `retoCupos` y el candado de `activities`/`submissions` están en las
reglas desde la etapa 1-bis. Ids: participante `{código}_{inscripción}` o `{código}_x{40 hex de la huella}`; respuesta
`{participanteId}_{índice}` (la primera gana); alias `{código}_{claveAlias}`. Todos los documentos llevan `docenteId`,
`actividadId` y (salvo la sesión) `sesionId`.

---

## 6. Plan de etapas

| Etapa | Contenido | Estado |
|---|---|---|
| 0 | Lógica pura: tiempo, pausas, puntuación, empates, alias | Hecha (sin publicar) |
| 0-bis | Modalidades, candado de calificación, acceso, cupos, tokens, vista final (la retención de 30 días se retiró el 3-nov-2026) | Hecha (sin publicar) |
| 1 | Reglas de las seis colecciones `reto*` | Hecha (sin publicar) |
| 1-bis | Candado en reglas: reto externo siempre oculto y no calificable, modalidad fija, sin `submissions`; `retoCupos` | Hecha (sin publicar) |
| 2 | Creación: modalidad, IA (`reactivos` con madre `reto`), banco y evaluaciones, etiqueta de créditos, excluir los retos al copiar o duplicar | Hecha (sin publicar) |
| 3 | Servidor en vivo: crear sesión, entrar, estado, responder, acceso, pausar, reanudar, terminar, renombrar, expulsar, registro definitivo; token; tope atómico; limpieza al borrar (sin barrido ni caducidad); límites por IP; cierre de la fuga de preguntas (T3) | Hecha (sin publicar) |
| 4 | Pantallas: docente en vivo (QR, control y proyección en la misma ventana), historial y resultados, celular del externo (`/r/{código}`) y del inscrito (desde su lista), esqueletos | Hecha (sin publicar) |
| 5 | Aplicar a calificaciones (solo inscritos calificables), con candado en reglas para los de práctica | Hecha (sin publicar) |
| 6 | Prueba de carga (40) y en teléfonos reales, ambas modalidades | Pendiente |

### Etapa 1-bis: qué garantizan las reglas

| Regla | Condición agregada (solo se suma con `&&`; nada existente se quitó) |
|---|---|
| `activities` · crear | `retoBienFormado`: un reto declara `reto.modalidad` (`inscritos` o `externo`); un externo nace con alias, no calificable, `sinCalificacion: true`, `oculta: true`, sin `publishAt` ni `publishedAt` |
| `activities` · actualizar | `retoIntacto`: nada entra ni sale de la categoría reto, la modalidad no cambia y el externo sigue bien formado. Borrar no cambia |
| `submissions` · crear y actualizar | `!esRetoExterno(actividadId)`, en los caminos del estudiante y del docente |
| `submissions/{id}/respuestas` · escribir | `!esRetoExterno(...)` (defensa adicional: la entrega no puede existir) |
| `retoCupos` | Ningún cliente lee ni escribe |

Las actividades que no son reto no pasan por estas condiciones. El Admin SDK (servidor) no pasa por las reglas.
Al instalarse no había ninguna actividad `categoria: 'reto'` en producción (lectura del 27-oct-2026).

**Pruebas** (`RETO 1-BIS ·`, 14 checks): creación válida e inválida (cada condición por separado), un externo no se
publica, programa, califica ni cambia de modalidad o categoría; sí se edita, se mueve de parcial y se borra; un
reto de inscritos conserva sus permisos y no se vuelve externo; las demás actividades no cambian y ninguna se
convierte en reto; ninguna entrega, calificación (ni con forma de nota de cierre) ni respuesta de un reto externo,
con la misma acción aceptada en un reto de inscritos como control; `retoCupos` cerrado. Suite completa: 794 → 808,
con los 794 anteriores idénticos. Control: debilitando cada candado (entrega, modalidad, respuestas) la suite falla.

### Etapa 2: crear y armar el reto

- **Menú** «Actividad interactiva» → «Reto Exprés» (`ModalesAsignatura.jsx`) abre `CrearRetoModal`: nombre,
  modalidad (fija), identidad y «Calificable» (solo inscritos; apagado por omisión). El reto nace en borrador en el
  parcial elegido, con la forma que exigen las reglas (`datosNuevoReto`).
- **Pantalla** `/reto/:activityId` (`RetoPage.jsx`, esqueleto `EsqueletoRetoDocente`): datos editables (la modalidad
  no), las preguntas con contador «N de 10», subir/bajar/editar/quitar, y tres formas de completar: **IA**, **banco o
  evaluaciones de la asignatura** (`ImportarReactivosReto`, solo compatibles: opción múltiple o verdadero/falso, sin
  imagen ni «Otra», con respuesta correcta; se COPIAN) y **a mano** (`EditorPreguntaReto`). «Iniciar» queda apagado.
- **IA** (`functions/ia.js`): `reactivos` acepta un reto como madre mediante un mapa APARTE (`REACTIVOS_PADRE_RETO`;
  `crear_evaluacion_ia` sigue sin aceptarlo). Con un reto: solo opción múltiple y verdadero/falso, nunca más de los que
  faltan para 10 (el servidor cuenta las preguntas), rechazos ANTES de cobrar, encabezado «RETO EXPRÉS» e instrucción de
  brevedad (S4). Las instrucciones de cuestionarios y exámenes no cambiaron (comparadas byte a byte: 144 combinaciones).
- **Créditos** (D11): la reserva lleva `detalle: { funcion: 'reto' }` (campo opcional que el ledger ya guarda) y
  `movimientosCreditos.js` muestra «Reto Exprés». Misma tarifa, mismo ledger, mismos importes.
- **Copias** (S2): `esCopiable` excluye los retos de las dos modalidades (copiar asignatura, traer de otra asignatura,
  duplicar actividad).
- **Lista de actividades** (`TabActividades.jsx`): ícono, etiqueta «Reto Exprés» / «Reto Exprés · externo», abre su
  pantalla; un reto externo no muestra Publicar/Ocultar. `ActivityPage` redirige un reto a `/reto/:id`.

**Pruebas:** `test/reto-expres.test.mjs` (107: grupos O y P nuevos) y `test/reto-ia.test.mjs` con el emulador e IA
falsa (15: cobro por entregado, etiqueta, reintento sin doble cobro, rechazos sin cobro, cuestionario/examen y
`crear_evaluacion_ia` sin cambios). Regresión: reglas 808 iguales; `test:ia` y `unidad` con los mismos fallos previos
de `main`; Participación en vivo 149; lint, diseño, esqueletos y build en verde. Navegador contra el emulador: crear
ambas modalidades, importar (filtros e incompatibles con su motivo), IA, editor, 10/10, publicar el de inscritos,
duplicar apagado, «Traer de otra asignatura» sin retos, celular sin desbordes.

### Etapa 3: servidor en vivo

Acciones de `/api/subject/[action]` (no se gasta ninguna función de Vercel; siguen 10 de 12). Toda regla de tiempo,
cupo, alias, expulsión y puntuación sale de `src/utils/retoExpres.js`, aplicada dentro de transacciones con el reloj
del servidor.

| Acción | Quién | Qué hace |
|---|---|---|
| `reto-crear` | Docente dueño | Comprueba 10/10 preguntas compatibles con clave; crea `retoSesiones/{código}` (preguntas públicas, sin clave) y `retoClaves/{código}` (clave congelada). Una sola sesión sin finalizar por reto (T6) |
| `reto-control` | Docente dueño | `iniciar`, `pausar`, `reanudar`, `terminar` (exige `confirmado`), `abrir-acceso`, `cerrar-acceso`, `expulsar`, `renombrar`, `finalizar` |
| `reto-unirse` | Inscrito (sesión) o externo | Entrar o reconectarse. Externo nuevo: el servidor genera el token y guarda su huella; cupo y alias en la misma transacción |
| `reto-estado` | Participante | Fase y tiempos con la hora del servidor; la pregunta solo abierta y sin clave; al final, top 10 y posición (corrección solo inscritos). Genera el registro definitivo si ya toca |
| `reto-responder` | Participante | `tx.create` con id fijo: la primera respuesta gana (T5); el doble toque devuelve `yaRespondio` |

- **Alias**: detector de `functions/moderacionSugerencias.js` importado tal cual en el servidor de Vercel (T8); en
  inscritos, nombres protegidos = **todos** los inscritos de la asignatura (T4).
- **T3**: un estudiante ya no crea ni modifica entregas de un reto (reglas, `esReto`) y `/api/exam/questions` niega las
  preguntas de un reto a quien no es su docente. Antes un inscrito podía abrir un intento «en progreso» y pedirlas.
- **Límites por IP** (`middleware.js`): `reto-estado` 2400/min, `reto-responder` 400/min, `reto-unirse` 120/min.

**Pruebas:** `test/reto-servidor.test.mjs` (27, contra el emulador): crear (dueño, ajenos, incompleto, T6 con dos pedidos
simultáneos), códigos inválidos, acceso abierto/cerrado, token falso o de otra competencia, **45 entradas simultáneas
→ 40**, alias simultáneo/ofensivo/reservado/suplantación, la pregunta solo abierta y sin clave, **20 respuestas
simultáneas → 1**, fuera de tiempo, pausa de 40 días y reanudar, ingreso tardío, expulsión (inscrito y externo, E4),
renombrar, fin natural con 15 consultas simultáneas, terminar con y sin confirmación, nada se borra solo, control solo
del dueño, `/api/exam/questions`, borrado de sesión y de reto. Control: con el cupo, T6 o el bloqueo de T3 quitados a
propósito, fallan 4 pruebas. Reglas: `RETO 3 ·` (4 checks; con las reglas anteriores la fuga T3 se reprodujo).

### Etapa 4: pantallas

- **Docente** (`/reto/:id`): «Iniciar competencia» (con las 10 preguntas; si hay una sin finalizar, «Continuar») y
  «Competencias»: cada sesión con su fecha, abrir, resultados (clasificación con el nombre real detrás del alias,
  aciertos por pregunta, retirados, respuestas que no contaron) y borrar (como en Participación en vivo).
- **En vivo** (`/reto/:id/en-vivo/:código`, D2): control y proyección en la misma ventana, con pantalla completa.
  Sala de espera con QR, código y quiénes entraron; «Prepárense»; la pregunta con sus opciones (letra y color fijos),
  el contador y «N de M respondieron»; pausa; clasificación final (10 primeros). Abajo: abrir/cerrar acceso, iniciar,
  pausar/reanudar y terminar (con confirmación). «Participantes» (expulsar, renombrar) se abre a propósito y avisa que
  se ve en lo proyectado. Nunca se proyecta la respuesta correcta ni el nombre real detrás de un alias. La fase se
  calcula con `faseReto` y el reloj corregido contra el servidor; al terminar, la pantalla pide el registro definitivo.
- **Celular** (`ParticipanteReto`): externo por `/r/{código}` (alias, token en el navegador y aviso de ventana
  privada); inscrito desde su lista (`/alumno/reto/:id`, D1: el servidor encuentra la sesión por la actividad tras
  comprobar la inscripción) o por el QR con la sesión iniciada. Estados: acceso cerrado, cupo lleno, espera,
  prepárate, pregunta, respuesta enviada, pausa, retirado y resultados (top 10 y lugar propio; el inscrito ve además su
  corrección con el texto de las preguntas realizadas, que el servidor envía solo al final y solo a inscritos).
- La lista del estudiante muestra el reto como «Reto Exprés · En vivo» cuando el docente lo publica.

**Pruebas del servidor** agregadas: entrada por actividad (con y sin sesión, otra asignatura, docente, reto externo) y
el texto de las preguntas realizadas solo para la corrección del inscrito.

### Etapa 5: aplicar a calificaciones

Mismo camino que Participación en vivo (`PanelCalificacionVivo`), sin servidor nuevo, sin Cloud Functions y sin créditos:

- **Dónde:** «Resultados» de una competencia terminada, en el historial del reto (`HistorialRetoSesiones` →
  `PanelCalificacionReto`). Solo aparece si la actividad es de inscritos y está marcada «Calificable» **al aplicar**
  (es lo que decide si cuenta en el promedio) y la sesión tiene clasificación.
- **Propuesta:** `propuestasCalificacionReto` (lógica pura): aciertos ÷ preguntas realizadas × `maxCalif`, una por
  inscrito que participó. Retirados y quien no participó no reciben nota (quedan sin nota, como en cualquier actividad).
- **Aplicar:** el docente revisa, puede corregir cada nota y confirma. Por omisión una nota existente no se toca
  (casilla «Reemplazar notas que ya existen»). Escribe `submissions/{actividad}_{inscripción}` con el guardián de
  entregas y los mismos campos que una Observación calificada sin entrega. Si una falla (parcial cerrado, permiso), se
  dice cuál y las demás siguen.
- **Reglas:** `retoSinNota(actividadId)` = reto que no está marcado calificable (práctica de inscritos y todo externo).
  Se suma con `&&` a `submissions` crear y actualizar: ni el docente ni el estudiante escriben una nota en un reto de
  práctica; una que existiera no se cambia, pero sí se borra. El parcial cerrado sigue rechazando como siempre.
- **El interruptor** «Calificable» vuelve a mostrarse (`RETO_CFG.CALIFICABLE_DISPONIBLE = true`).
- Borrar una competencia no toca las calificaciones ya aplicadas.

**Pruebas:** lógica `Q ·` (4 casos: proporción, terminación anticipada, retirados, nunca en externo / práctica / sin
clasificación); reglas `RETO 5 ·` (4 checks; quitar el candado hace fallar la de práctica). En el navegador: aplicar
con una nota existente protegida, «Reemplazar», pasar a práctica oculta el panel y el estudiante ve su nota.

---

## 7. Registro de decisiones

### D1–D12 (27-oct-2026)
- **D1** Categoría propia `reto` y colecciones independientes; no mezclar con Participación en vivo.
- **D2** IA con la operación `reactivos`, sin archivos; 1 crédito por reactivo entregado; sin tocar tarifas.
- **D3** Avance automático al agotarse el tiempo de la pregunta (20 s hasta el 4-nov-2026; desde entonces lo elige el docente por pregunta); pausar y reanudar; el tiempo depende del servidor.
- **D4** Ingreso tardío de inscritos; las anteriores valen 0; no se alteran resultados anteriores.
- **D5** Alias: el docente renombra y expulsa; longitud, unicidad y ofensivos; identidad real solo para el docente.
- **D6** Empates comparten posición; nunca rapidez.
- **D7** Calificación = (correctas ÷ 10) × máxima; el docente decide aplicar; nunca sobrescribir sin confirmar.
- **D8** Primera versión: solo inscritos autenticados (ampliada después por E1–E11 con la modalidad externa).
- **D9** Al finalizar, el inscrito ve puntaje, posición y corrección completa; antes, nada de la clave.
- **D10** Reactivos del banco y de otras evaluaciones de la asignatura, copiados sin tocar los originales.
- **D11** «Reto Exprés» en el movimiento de créditos, sin alterar el ledger.
- **D12** Exactamente 10 preguntas; no se inicia con menos; cobro solo de lo entregado.

### Etapa 0 (27-oct-2026)
- Pausa: al reanudar sigue el tiempo restante, sin repetir la preparación.
- Empates 1, 1, 3.
- Alias: bloquear suplantaciones, reservados («Docente») y nombres reales de estudiantes, en el servidor.
- Expulsados: no vuelven a entrar; respuestas conservadas; fuera de la clasificación; no se borra historial.
- Terminación anticipada con confirmación; calificación sobre las realizadas, proporcional.
- Moderación: detector existente como filtro inicial; el docente corrige o expulsa.
- La pregunta abierta o pausada al terminar no cuenta (respuestas conservadas).
- Terminar antes de la primera: sin clasificación ni calificación; se conserva la sesión.
- Preguntas no abiertas: no se muestran al participante.
- El propio nombre real se bloquea como alias.
- Coincidencia: nombre completo o nombre + cualquier apellido; no el nombre de pila solo.

### E1–E11 (27-oct-2026)
- **E1** El reto externo vive en una asignatura del docente, oculto para los inscritos, sin contar en promedios.
- **E2** Candado también en `firestore.rules` (activities y submissions), con pruebas y suite completa.
- **E3** Perder el navegador = participante nuevo; se explica en la interfaz; sin duplicados mientras haya token.
- **E4** No se garantiza que un expulsado externo no vuelva con otro dispositivo; cerrar el acceso lo reduce; un
  token expulsado nunca vuelve a responder.
- **E5** Abrir y cerrar el acceso en las dos modalidades; cerrar no interrumpe a quienes ya están.
- **E6** Ingreso tardío de externos mientras el acceso esté abierto; las anteriores valen 0.
- **E7** Máximo inicial 40 externos, atómico en el servidor; no se presenta como capacidad garantizada sin carga.
- **E8** ~~Alias y respuestas 30 días tras finalizar; luego borrado automático fiable y probado; solo agregados.~~
  *Reemplazada el 3-nov-2026: nada se borra solo (ver §4).*
- **E9** Celular: top 10 y posición propia; empates según lo definido; nunca identidad real. *Ampliada el
  4-nov-2026: clasificación provisional durante la competencia y lista completa al final.*
- **E10** Modalidad fija; un externo nunca se vuelve calificable ni de inscritos.
- **E11** Externos: sin respuestas correctas ni corrección; inscritos: corrección completa.

### R1–R4 (27-oct-2026)
- **R1** Abandonado y comenzado: el servidor lo cierra y la retención corre desde su finalización; nunca comenzó:
  datos temporales a los 30 días de creado; limpieza automática, idempotente y probada; nunca antes del plazo.
  *Revisada el 27-oct-2026 (ver «Pausas y fin de la competencia»): no hay cierre por abandono.*
  *Reemplazada el 3-nov-2026: no hay limpieza automática ni plazos (ver §4).*

### Pausas y fin de la competencia (27-oct-2026, revisa R1)
1. Una competencia pausada permanece pausada hasta que el docente la reanude o la finalice.
2. Una desconexión del docente o el cierre del proyector no finalizan ni reinician la sesión.
3. Cerrar el acceso impide nuevas incorporaciones, pero no expulsa a quienes ya están dentro.
4. La competencia termina cuando el docente lo decide o cuando concluye normalmente la última pregunta.
5. ~~Los 30 días de conservación de un reto externo empiezan al finalizar la competencia.~~
6. ~~Si un reto externo nunca comenzó, sus datos temporales se eliminan 30 días después de su creación.~~
7. ~~No se borra ni anonimiza nada antes de que venza el plazo correspondiente.~~
8. ~~No hay eliminación automática para los retos de inscritos, salvo una política independiente aprobada.~~

*Puntos 5–8 reemplazados el 3-nov-2026: no hay eliminación automática en ninguna modalidad (ver §4).*
Se eliminó la regla provisional de terminar una competencia tras 24 h en pausa (`PAUSA_ABANDONO_MS`).
- **R2** ~~Tras 30 días, solo resultados anónimos.~~ *Reemplazada el 3-nov-2026: se conservan los resultados
  completos y las estadísticas hasta que el docente borre (ver §4).*
- **R3** El lugar de un expulsado no se libera.
- **R4** Colección privada `retoCupos` para el tope atómico; ningún cliente la lee ni la escribe. *Mecanismo cambiado el
  4-nov-2026 (autorizado): 40 lugares numerados en vez de un contador (ver §3).*

---

### S1–S6 (27-oct-2026)
- **S1** Las etapas 2, 3 y 4 se fusionan juntas, terminadas y verificadas; no se publica una etapa 2 incompleta.
- **S2** Copiar asignatura y duplicar actividad excluyen los retos de las dos modalidades.
- **S3** Sin reactivos con imagen en la primera versión (filtrados al importar del banco y de evaluaciones).
- **S4** La IA pide enunciados de ~200 caracteres máximo y opciones concisas, solo para Reto Exprés.
- **S5** Todo reto pertenece a un parcial; los externos siguen sin calificación ni promedio.
- **S6** En inscritos, «Calificable» empieza apagado; en externos nunca se puede activar.
  *Del 3 al 4-nov-2026 el interruptor estuvo OCULTO (`RETO_CFG.CALIFICABLE_DISPONIBLE = false`): sin aplicar
  calificaciones, un reto calificable publicado contaba como 0 para todo el grupo. Con la etapa 5 vuelve a mostrarse.*

### T1–T9 y conservación (3-nov-2026)
- **T1** El tope de 40 aplica solo a externos (E7); en inscritos, el límite es el grupo.
- **T2** Se mantiene E4: el token expulsado nunca vuelve; con otro dispositivo un externo podría entrar como nuevo.
- **T3** Se cierra en la etapa 3 la fuga de preguntas: el estudiante no crea ni modifica entregas de un reto y
  `/api/exam/questions` niega las de un reto a quien no es su docente.
- **T4** Nombres protegidos del alias = todos los inscritos de la asignatura, incluido el propio.
- **T5** Solo se guarda la primera respuesta; las repetidas no se guardan.
- **T6** Una sola sesión sin finalizar por reto (varias en el tiempo, cada una con sus resultados).
- **T7** El registro definitivo lo genera la primera consulta al servidor tras terminar (sin respaldo programado).
- **T8** El detector de groserías se importa de `functions/` en el servidor de Vercel, sin copiar la lista.
- **T9 / conservación** Sin barrido periódico, sin borrado automático y sin caducidad; los datos se conservan hasta que
  el docente borre el reto o la sesión; se reutiliza el mecanismo de registro y eliminación de Participación en vivo.

## 8. Pendientes y límites conocidos

- **Duplicar asignatura falla en `main` (no es de Reto Exprés):** `copySubject.js` consulta `activities` solo por
  `asignaturaId`, y la regla de lectura de `activities` (F-09) exige filtrar también por `docenteId`. Reproducido en el
  emulador; ni el archivo ni la regla cambiaron en esta rama. Arreglo pendiente aparte.
- La revisión de la propuesta de IA reutiliza `ReactivosIAReview` sin cambios, y su botón dice «Agregar N reactivos a
  la evaluación» (no «al reto»).
- **Relojes del servidor**: cada petición puede caer en una instancia distinta de Vercel. Una diferencia de milisegundos
  justo en el cierre de una pregunta podría hacer que el cálculo final descarte una respuesta aceptada en el límite.
- **Límites por IP**: cuentan por isolate del middleware (limitación ya aceptada en F-07).
- **Detector importado de `functions/` en Vercel (T8)**: probado en local y con el emulador; solo un despliegue de prueba
  confirma que el empaquetado de Vercel lo incluye.
- La concurrencia se probó en el emulador; la prueba con 40 teléfonos reales y carga de producción es la etapa 6.
- Un nombre completo de más de 20 caracteres se rechaza por longitud antes que por suplantación.
- Los dos apellidos solos («Pérez López») no se bloquean como alias.
- **Etapa 5:** una calificación aplicada no se borra al volver el reto a práctica (deja de contar en el promedio porque
  la actividad queda «sin calificación», y el docente puede borrarla); cambiar «Calificable» no está bloqueado después
  de aplicar.
- Un rol pegado sin separación en minúsculas («profejuan») no se detecta; el docente puede renombrar.
- La pregunta interrumpida tampoco aparece en la corrección del inscrito (no contó); revisable en la etapa 4.
- El tope de 40 y la consulta periódica deben medirse con prueba de carga antes de prometer capacidad.
