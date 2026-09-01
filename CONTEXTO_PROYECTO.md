# CONTEXTO DEL PROYECTO: Evalúa Fácil

> **Para quién es este documento:** una instancia de Claude (u otro colaborador) sin acceso al repositorio.  
> **Qué es:** un mapa de razonamiento del producto, no un manual de API.  
> **Convenciones:** `[VERIFICADO]` = leído directamente del código o la base de datos. `[INTERPRETADO]` = inferencia razonada que conviene confirmar. Las cifras de negocio (precios, tarifas, márgenes) **no están** aquí; viven en el documento de modelo de negocio.

---

## 1. QUÉ ES

Evalúa Fácil es una plataforma web para **docentes de bachillerato técnico mexicano** (DGETI/SEP) que necesitan gestionar calificaciones, actividades y asistencia dentro del marco de la **Nueva Escuela Mexicana (NEM)**. El docente opera en un sistema donde cada asignatura tiene entre 2 y 4 parciales por ciclo escolar, cada parcial se cierra con una calificación numérica en escala 0–10 (o 0–100, según la configuración), y el sistema debe producir el acta de calificaciones en el formato que pide la institución.

Lo que lo distingue: integra IA para calificar entregables (análisis de documentos e imágenes), generar reactivos, redactar planeaciones didácticas y diagnosticar grupos, **todo bajo un modelo de créditos prepagados**. La plataforma no reemplaza el sistema institucional (SIGA, etc.): lo complementa con una experiencia amigable donde el docente trabaja y después exporta.

Opera como SPA React desplegada en Vercel. No hay backend propio: todo es Firebase (Auth + Firestore) + Cloud Functions de Google. Tiene una app Android (Capacitor) en paralelo que envuelve la misma web.

---

## 2. ESTRUCTURA ACADÉMICA

### 2.1 Ciclo escolar y parciales `[VERIFICADO]`

Una **asignatura** pertenece a un docente y a un ciclo escolar (campo `ciclo`, e.g. `"2026-2027"`). Cada asignatura define sus propios **parciales**: array de objetos con `nombre` y opcionalmente `fechaInicio`/`fechaFin` (fechas YYYY-MM-DD). El número de parciales es variable (típicamente 3 o 4). Los parciales se indexan desde 1.

El sistema calcula a qué parcial pertenece una fecha dada (`parcialForDate`) comparando con los rangos de fechas. Esta función se ejecuta tanto en cliente como en Cloud Functions (se sincroniza mediante un script de predeploy).

### 2.2 Tipos de actividad `[VERIFICADO]`

| `categoria` | `tipo` en Firestore | Descripción |
|-------------|---------------------|-------------|
| `entregable` | `archivo` | El alumno entrega uno o varios archivos (documentos, imágenes). La IA puede calificarlo. |
| `observacion` | `archivo` | El docente observa y califica directamente, sin entrega del alumno. |
| `cuestionario` | `evaluacion` | Reactivos con calificación automática. Defaults: intentos ilimitados, guarda la mejor nota. |
| `examen` | `evaluacion` | Evaluación formal. Defaults: 1 intento, guarda el último, 30 min de tiempo límite. |
| `juego` | — (campo `tipoJuego`) | El alumno resuelve un crucigrama (`crucigrama`) o sopa de letras (`sopa_letras`) dentro de la app. |

Los valores legacy `'actividad'` y `'tarea'` se normalizan a `'entregable'` en runtime. `[VERIFICADO]`

### 2.3 Ponderación y calificación final `[VERIFICADO]`

Cada asignatura puede tener ponderación activada por parcial (campo `ponderacionParciales: { '1': true, '2': false }`). Si está activada, cada actividad tiene un peso (`pesoCalificacion`); el promedio del parcial es una media ponderada sobre las actividades calificadas. Si no está activada, se usa media simple. Las actividades sin calificar no arrastran el promedio hacia abajo (no cuentan en el denominador).

Las calificaciones se normalizan a escala 10 o 100 según `maxCalif` de la actividad, usando `normalizeGrade()`.

Una actividad puede marcarse `sinCalificacion: true`, en cuyo caso aparece en la lista de actividades pero **no entra en el promedio, no aparece en el acta, no lleva número ordinal**. `[VERIFICADO]`

### 2.4 Visibilidad de actividades `[VERIFICADO]`

Una actividad puede estar en los estados:
- **Borrador**: `oculta == true` y nunca publicada. Solo la ve el docente.
- **Programada**: `oculta == true` pero tiene `publishAt` en el futuro. Se publica automáticamente.
- **Visible**: los alumnos la ven y pueden interactuar.
- **Oculta por parcial**: el docente ocultó todo el parcial; ninguna actividad del parcial es visible para alumnos.

La máquina de estados `resolveVisibilidad` controla las transiciones y valida invariantes (e.g., `fechaLimite > publishAt`). `publishedAt` es permanente mientras la actividad esté publicada; solo se borra si el docente la regresa a borrador.

### 2.5 Horario y sesiones `[VERIFICADO]`

El docente puede registrar un **horario de clases** con un patrón semanal (días y horas). El sistema materializa este patrón en documentos concretos por fecha (`horarioBloques`), respetando asuetos y vacaciones. La función `calcularSesionesReales()` proyecta cuántas sesiones efectivas tendrá cada parcial, y esa proyección alimenta la planeación didáctica generada por IA.

---

## 3. MODELO DE DATOS

### 3.1 Colecciones top-level `[VERIFICADO desde firestore.rules y functions/index.js]`

| Colección | Qué guarda | Notas clave |
|-----------|-----------|-------------|
| `schools` | Escuelas (plantel). Campos: `claveSEP`, `shortName`, `nombre`. | Se crea la primera vez que un docente de esa escuela se registra. |
| `users` | Docentes y admins. Campos: `role`, `username`, `escuelaId`, `email`, `suscripcionHasta` (histórico), `profileComplete`. | Alumnos **NO** tienen doc aquí. |
| `students` | Inscripciones de alumnos. Campos: `username`, `escuelaId`, `asignaturaId`, `activado`, `uid`, `nombre`, `resetPassword`. | Lectura pública (necesaria para activación por QR). Un alumno tiene UN doc por asignatura (no un doc global). |
| `subjects` | Asignaturas. Campos: `docenteId`, `accessCode`, `archived`, `parciales`, `ciclo`, `ponderacionParciales`, `orden`. | Lectura pública (necesaria para activación). |
| `activities` | Actividades de cualquier tipo. Campos: `asignaturaId`, `docenteId`, `categoria`, `tipo`, `parcial`, `maxCalif`, `oculta`, `publishAt`, `publishedAt`, `fechaLimite`, `sinCalificacion`, `rubrica`. | |
| `submissions` | Entregas de alumnos. ID determinista: `{actividadId}_{alumnoId}`. Campos: `actividadId`, `alumnoId`, `estado`, `calificacion`, `entregadoEn`. | |
| `attendance` | Registros de asistencia diarios por asignatura. | Escritura gratuita (no requiere créditos). |
| `attendanceSummaries` | Resúmenes de asistencia por alumno (calculados por Cloud Function). | Solo el alumno dueño puede leer; solo el servidor puede escribir. |
| `iaCreditos` | Saldo de créditos IA por docente. `{ saldo, consumidoTotal, consumoPorCategoria }`. | Solo el servidor puede escribir. El cliente solo lee. |
| `iaConsumos` | Log de consumos IA del usuario (visible al docente). | Solo el servidor puede escribir. |
| `iaConsumosInterno` | Log técnico interno de llamadas Anthropic (para análisis de rentabilidad). | No visible en UI. Solo el servidor escribe. |
| `iaTrialRegistro` | Registro de elegibilidad y estado de los 30 créditos de bienvenida. | Solo el servidor escribe. |
| `chatMensajes` | Mensajes del Chat con Asistente IA (actualmente deshabilitado). | |
| `fuentesAsignatura` | Fuentes de conocimiento que el docente sube para alimentar la IA (programa oficial, material del parcial, etc.). Campos: `ubicacion` (`'general'` \| `'parcial'`), `parcial`, URL Cloudinary. | |
| `bancoReactivos` | Banco personal de reactivos del docente para reutilizar en evaluaciones. | |
| `bancoRubricas` | Banco personal de rúbricas. | |
| `avisos` | Avisos del docente al grupo. | Push notification automática al crear. |
| `payments` | Declaraciones de pago (transferencia bancaria). Actualmente: único método de pago. | |
| `creditPurchases` | Solicitudes de compra de créditos por transferencia. | |
| `plans` | Catálogo de planes de suscripción (código muerto — ya no se usa). `[INTERPRETADO: deprecado]` | Solo admin puede escribir. |
| `subscriptions` | Historial de suscripciones (código muerto — ya no se usa). `[INTERPRETADO: deprecado]` | Se mantiene por historial. `suscripcionHasta` en `users` tampoco gatea ya nada en producción. |
| `horarioBloques` | Clases materializadas por fecha para la agenda del docente. | |
| `notificationSettings` | Tokens FCM y preferencias de notificaciones push por usuario. | |
| `downloadLinks` | Links de descarga del APK (slug → URL). | Lectura pública; solo admin escribe. |
| `config` | Documentos de configuración global. Doc `iaTarifas`: tarifas de créditos, modelo de IA, flag `chatAsistenteActivo`. | Solo admin escribe. |

### 3.2 Subcolecciones `[VERIFICADO]`

| Subcolección | Cuelga de | Qué guarda |
|---|---|---|
| `subjects/{id}/planeacionesIA` | `subjects` | Bitácora de generaciones de IA. Inmutables: `Update: false`. **No es la planeación vigente** (esa vive en `subjects/{id}.planeacionAceptada`) y nunca guarda el archivo propio del docente. |
| `subjects/{id}/diagnosticosIA` | `subjects` | Diagnósticos de contexto y conocimientos. Inmutables. |
| `subjects/{id}/asistenteIA` | `subjects` | Config de la pestaña Planeación Didáctica: programa de estudios, comentarios, autoanálisis, consideraciones. El nombre de la subcolección **no se renombró** con la pestaña: está en `firestore.rules` y en datos de producción. |
| `activities/{id}/preguntas` | `activities` | Reactivos de cuestionarios/exámenes. |
| `activities/{id}/clave` | `activities` | Clave de respuestas (solo lectura del docente dueño). |
| `activities/{id}/iaSugerencias` | `activities` | Sugerencias de calificación generadas por IA para entregas de entregables. Solo el servidor puede crear; el docente puede actualizar (aceptar/rechazar) y borrar. |
| `activities/{id}/iaSugerenciasEntregable` | `activities` | Sugerencias IA para calificación de entregables con rúbrica. Solo el servidor crea. `[VERIFICADO]` |
| `activities/{id}/analisisIA` | `activities` | Análisis de resultados de evaluaciones. Inmutables. |
| `submissions/{id}/respuestas` | `submissions` | Respuestas del alumno a reactivos de cuestionarios/exámenes. El alumno solo puede escribir sin `puntosObtenidos` y dentro del plazo del servidor. |

### 3.3 Restricciones críticas de Firestore `[VERIFICADO, en CLAUDE.md]`

**Solo se permiten filtros de igualdad (`==`) en queries.** No hay rangos (`<`, `>`, `!=`), no hay `orderBy` en queries del cliente. Los resultados se ordenan en memoria. Los índices compuestos necesarios están en `firestore.indexes.json`; agregar un índice nuevo requiere desplegarlo manualmente con `firebase deploy --only firestore:indexes`.

---

## 4. ROLES Y PERMISOS

### 4.1 Tres roles `[VERIFICADO]`

| Rol | Email en Firebase Auth | Doc en Firestore |
|-----|----------------------|-----------------|
| `docente` | Email real | `users/{uid}` con `role: 'docente'` |
| `alumno` | Sintético: `{username}.{escuelaId}@evalua.local` | `students/{inscripcionId}` (no en `users`) |
| `admin` | Email real | `users/{uid}` con `role: 'admin'` |

### 4.2 Qué puede hacer cada rol

**Docente:**
- CRUD completo de sus asignaturas, actividades, avisos, horario, banco de reactivos/rúbricas.
- Gestionar sus alumnos (agregar, quitar, resetear contraseña).
- Registrar asistencia (gratuito, sin créditos).
- Ver y exportar calificaciones.
- Usar operaciones de IA consumiendo sus créditos.
- Activar 30 créditos de bienvenida (una sola vez).
- Declarar una compra de créditos (solo transferencia; necesita aprobación del admin).
- No puede escribir en `iaCreditos`, `iaConsumos`, `subscriptions`, ni `plans`.

**Alumno:**
- Ver sus asignaturas y actividades publicadas.
- Entregar archivos, contestar cuestionarios/exámenes (con candado de plazo verificado en servidor).
- Ver sus calificaciones y su asistencia.
- Activar su cuenta una vez por código de acceso.
- No puede crear ni modificar actividades, ni ver actividades de otros alumnos.

**Admin:**
- Acceso de lectura y escritura casi universal.
- Aprobar/rechazar compras de créditos.
- Ajustar saldos de créditos manualmente.
- Gestionar `plans`, `downloadLinks`, `config`.
- Usar `chatAdmin` (Cloud Function exclusiva).

### 4.3 Cómo entra un alumno al sistema `[VERIFICADO]`

El docente crea la inscripción del alumno manualmente en la pantalla de la asignatura (pestaña Estudiantes). El alumno recibe un **código de acceso** (`accessCode` de la asignatura) o un QR que lo lleva a `/activar/{accessCode}`. Ahí escribe su nombre de usuario (generado por el docente a partir de sus iniciales), elige contraseña, y queda activado. Firebase Auth crea la cuenta con el email sintético. Si el alumno ya tiene cuenta en otra asignatura de la misma escuela, se vincula automáticamente.

El docente puede resetear la contraseña de un alumno: pone una temporal y marca `activado: false`. En el próximo login, el sistema detecta `resetPassword` y redirige al flujo de activación.

---

## 5. FLUJOS PRINCIPALES DEL DOCENTE

### 5.1 Alta de asignatura y grupo

1. Docente va a `/dashboard` → botón "Nueva asignatura".
2. Llena nombre, ciclo escolar, número de parciales y fechas (opcional pero importante para la IA y el calendario).
3. El sistema genera un `accessCode` único y un código QR.
4. El docente comparte el código o QR con sus alumnos.
5. Cada alumno entra por `/activar/{accessCode}` y crea su cuenta.

### 5.2 Crear una actividad

1. Dentro de `/subject/{id}`, pestaña Actividades → botón nuevo.
2. El docente elige tipo (entregable, observación, evaluación, juego) en un menú de dos niveles.
3. Llena: nombre, parcial, fecha límite (opcional), peso (si hay ponderación), instrucciones, rúbrica (opcional para entregables/observaciones), configuración de intentos y tiempo (para evaluaciones).
4. Al guardar, el sistema aplica `resolveVisibilidad`: si el docente guardó como "publicar ahora", la actividad queda visible inmediatamente. Si guardó como borrador, queda oculta. Si programó, se publicará automáticamente vía Cloud Function `revisarProgramados` (corre cada 30 min).
5. Los alumnos reciben una push notification cuando se publica.

### 5.3 Calificar una entregable con IA

1. Docente entra a `/activity/{id}` → selecciona un alumno en la lista → ve el archivo entregado.
2. Presiona "Calificar con IA".
3. El cliente llama a `ejecutarOperacionIA` con operación `calificar_entregable_ia`.
4. Cloud Function: reserva créditos en el ledger → descarga el archivo de Cloudinary → llama a Anthropic con el contenido y la rúbrica → guarda la sugerencia en `activities/{id}/iaSugerenciasEntregable/{submissionId}` → liquida créditos reales consumidos.
5. En la UI aparece la sugerencia: calificación propuesta + retroalimentación por criterio de rúbrica + evidencia textual.
6. El docente puede aceptarla tal cual, modificarla, o ignorarla. La IA nunca escribe la calificación final.
7. El docente confirma la calificación → se guarda en `submissions/{id}.calificacion`.

### 5.4 Crear y aplicar una evaluación

1. Docente crea actividad de tipo `examen` o `cuestionario`.
2. Puede agregar reactivos manualmente o usar IA ("Generar con IA") que llama a `ejecutarReactivos`.
3. Reactivos se guardan en `activities/{id}/preguntas`.
4. Al publicar, los alumnos entran desde su dashboard y contestan en el runner de evaluación.
5. La calificación es automática (Cloud Function `onEvaluacionFinalizada`) para reactivos de opción múltiple, verdadero/falso, etc.
6. Las preguntas de respuesta abierta (`respuesta_corta`) requieren que el docente use la operación `calificar_abierta` o califique manualmente.
7. El docente puede pedir un análisis de los resultados del grupo (`analizar_resultados`), que genera un informe pedagógico.

### 5.5 Planeación didáctica

Vive en la pestaña **"Planeación Didáctica"** de la asignatura (`PlaneacionDidacticaTab.jsx`; se llamó "Config Asistente IA" hasta el 1-sep-2026). Solo en la web: nunca en la app nativa, porque la revisión del documento Word necesita pantalla ancha.

**Regla de negocio (1-sep-2026):**

```
PROGRAMA DE ESTUDIOS  (obligatorio, común a los dos caminos)
            ↓
     PLANEACIÓN DIDÁCTICA
   ┌────────────┴────────────┐
Crear con IA          Subir mi propia
· pide Perfil IA      · sin Perfil IA
· consume créditos    · sin créditos
   └────────────┬────────────┘
                ↓
        PLANEACIÓN VIGENTE
    una sola · origen 'ia' | 'archivo'
```

1. **Fuente Principal (programa de estudios)**: PDF obligatorio, en `subjects/{id}/asistenteIA/config.programaEstudios`. Sin él, el resto de la pestaña se oculta. Es el único requisito común a los dos caminos.

2. **Planeación Didáctica** — la bifurcación, inmediatamente después de lo obligatorio:
   - **Camino IA** (`planeacion_didactica_inicial`): genera una planeación por parcial (Apertura–Desarrollo–Cierre por sesión, actividades en viñetas), editable sobre el Word real renderizado hasta que se acepta. Exige **Perfil para IA del docente** (`/perfil-ia`) y consume créditos.
   - **Camino archivo**: el docente sube su propia planeación en **PDF o DOCX** (≤ 15 MB) a Cloudinary. **No exige Perfil IA, no consume créditos, no se analiza con IA al subirla.**

3. **Información adicional para generar con IA** — insumos del camino de IA, nunca requisitos: Fuentes del curso (`fuentesAsignatura`, `ubicacion:'general'`), Comentarios del grupo, Autoanálisis docente, Consideraciones y Diagnóstico del grupo (`diagnostico_contexto` / `diagnostico_conocimientos`, inmutables una vez generados). **Ninguno es obligatorio** para obtener una planeación.

**Una sola planeación vigente por asignatura.** Vive en `subjects/{id}.planeacionAceptada`, con un discriminador `origen: 'ia' | 'archivo'` **dentro del mismo campo** — no hay estructura donde quepan dos. Un registro sin `origen` se interpreta como `'ia'` (retrocompatibilidad, sin migración). El resolver es `src/utils/planeacionVigente.js` en el cliente y `planeacionVigenteDe` en `functions/ia.js`: **nadie decide vigencia mirando `planeacionesIA`**, que es bitácora inmutable de generaciones de IA y nunca contiene el archivo del docente. Aceptar una planeación IA la bloquea para edición.

**Consumo posterior.** `crear_actividad_ia` usa **siempre** el contenido real de la planeación vigente: si `origen:'ia'`, el contenido guardado del parcial; si `origen:'archivo'`, el texto extraído del PDF/DOCX con `functions/docExtract.js`, dentro del precheck (antes de reservar créditos, así que un archivo ilegible detiene la operación sin cobrar).

### 5.6 Asistencia

El docente va a la pestaña Asistencias en la asignatura → registra presencia/ausencia por fecha. La Cloud Function `onAttendanceEscrita` actualiza automáticamente `attendanceSummaries` por alumno. El alumno puede ver su resumen de asistencia. La escritura de asistencia es gratuita (sin créditos).

---

## 6. OPERACIONES DE IA

Todas las operaciones pasan por la Cloud Function `ejecutarOperacionIA` con este flujo invariable:
**estimación cliente → confirmación docente → reserva de créditos (transacción atómica) → ejecución IA → liquidación real de créditos**

El docente ve el costo estimado antes de confirmar. Si cancela, no se cobra nada. Si la IA falla después de la reserva, los créditos reservados se liberan.

### 6.1 Catálogo completo `[VERIFICADO desde functions/ia.js]`

| Operación | Qué hace | Qué devuelve |
|-----------|---------|-------------|
| `calificar_entregable_ia` | Analiza un archivo entregado (imágenes o documentos) y lo evalúa contra la rúbrica o sin ella. | Calificación propuesta + retroalimentación por criterio + evidencia textual. Guarda sugerencia en subcolección. |
| `calificar_entregable_ia_lote` | Igual pero para múltiples entregas en paralelo. | Igual, una sugerencia por entrega. |
| `calificar_abierta` | Sugiere calificación de respuestas de texto libre (reactivos tipo `respuesta_corta`) de cuestionarios/exámenes. | Calificación numérica propuesta + justificación breve. La IA nunca escribe la calificación. |
| `rubrica` | Genera propuesta de rúbrica (criterios, niveles, descriptores) a partir de la descripción de la actividad. | Rúbrica estructurada para que el docente la revise y acepte. |
| `cotejo` | Genera propuesta de lista de cotejo. | Lista de indicadores Sí/No. |
| `reactivos` | Genera preguntas para una evaluación a partir de las fuentes del docente. | Array de reactivos con opciones y respuesta correcta. |
| `analizar_resultados` | Analiza los resultados de una evaluación ya contestada por el grupo. | Informe pedagógico: qué dominan, qué no, recomendaciones. |
| `crear_evaluacion_ia` | Crea una evaluación completa (cuestionario o examen) con los reactivos ya generados. | La actividad queda creada en Firestore lista para publicar. |
| `crear_actividad_ia` | Crea un entregable u observación con instrucciones y criterios generados por IA. | La actividad queda creada en Firestore. |
| `diagnostico_contexto` | Diagnóstico del grupo: quiénes son, situación socioeconómica inferida, contexto. | Documento de diagnóstico inmutable en `subjects/{id}/diagnosticosIA`. |
| `diagnostico_conocimientos` | Diagnóstico de conocimientos previos del grupo sobre la materia. | Idem. |
| `planeacion_didactica_inicial` | Planeación por sesiones del parcial: Apertura/Desarrollo/Cierre, actividades en viñetas, exportable a Word. | Documento inmutable en `subjects/{id}/planeacionesIA`. |
| `chat_asistente` | Chat conversacional con el asistente. Sin costo en sí. | Respuesta textual del asistente. **Actualmente deshabilitado** (`chatAsistenteActivo: false` en `config/iaTarifas`). |
| `chat_crear_actividad` | Desde el chat, crea un entregable u observación confirmado por el docente. | La actividad queda creada. |
| `chat_crear_examen` | Desde el chat, crea un examen con reactivos. | La evaluación queda creada. |
| `aviso` | Redacta borrador de aviso para el grupo. | Título + mensaje. El docente edita y publica. |
| `generar_contenido_juego` | Genera las palabras y descripciones para crucigrama o sopa de letras. La cuadrícula la arma el algoritmo determinístico `construirJuego` (sin IA). | Array de palabras con descripción. |

### 6.2 Extensiones de archivo que la IA puede leer `[VERIFICADO]`

`.pdf`, `.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, `.xlsx`. Las imágenes se procesan aparte (`.jpg`, `.jpeg`, `.png`), con tarifa diferenciada.

### 6.3 Modelo de créditos `[VERIFICADO]`

La plataforma es **gratuita** para todo lo que no es IA. Los créditos son la única forma de pagar. No caducan. El saldo solo lo puede modificar el servidor (el cliente solo lo lee). La unidad de cobro son créditos enteros o fraccionarios dependiendo de la operación. Los docentes nuevos reciben 30 créditos de bienvenida que activan voluntariamente una sola vez.

---

## 7. STACK Y ARQUITECTURA

### 7.1 Frontend `[VERIFICADO]`

- **React 19 + Vite 8** — SPA, sin SSR.
- **Tailwind CSS v3** — utilidades puras. Paleta de colores estricta: **azul únicamente** para la UI del docente/admin. Naranja para alumnos. Guinda para admin en algunos acentos.
- **React Router v7** — `<BrowserRouter>`. Vercel redirige todas las rutas a `index.html`.
- **Firebase JS SDK** — Auth + Firestore (listeners en tiempo real vía `onSnapshot`).
- **Capacitor** — envuelve la misma web en una app Android. La detección de entorno nativo usa `Capacitor.isNativePlatform()`.
- **lucide-react** — iconografía.
- **EmailJS** — correos transaccionales client-side (bienvenida al registrarse). Best-effort.

### 7.2 Backend `[VERIFICADO]`

- **Cloud Functions (Firebase)** — Node 20, CommonJS. No hay servidor propio. Todas las operaciones sensibles (IA, créditos, calificación automática) corren aquí.
- **Firestore** — base de datos principal. Sin Storage de Firebase (los archivos van a Cloudinary).
- **Anthropic API** — única IA usada. Las operaciones leen el modelo del config de Firestore; actualmente `claude-haiku-4-5-20251001`.
- **Cloudinary** — almacenamiento de archivos (documentos e imágenes que suben los alumnos). La cuenta pertenece a Alan (hijo de Kike), no a Firebase.

### 7.3 Infraestructura y deploys `[VERIFICADO]`

- **Vercel** — aloja el frontend. Auto-deploys en cada push a `main`. Plan Hobby (11 serverless functions disponibles, 1 margen libre).
- **Firebase Hosting** — no usado para el frontend actual (Vercel lo desplazó), pero el proyecto lo tiene configurado.
- **GitHub Actions** — dos workflows creados y mergeados a `main` el 25-ago-2026:
  - `deploy-functions.yml`: se dispara si cambian `functions/**`, `scripts/sync-functions-shared.mjs` o `src/utils/**`.
  - `deploy-rules.yml`: se dispara si cambia `firestore.rules`.
  - **⚠️ PENDIENTE:** los workflows existen pero no funcionarán hasta que Kike agregue el secret `FIREBASE_TOKEN` al repositorio en GitHub → Settings → Secrets and variables → Actions.
- **Despliegue manual necesario**: `firestore.indexes.json` — requiere `firebase deploy --only firestore:indexes` corrido por Kike.
- **Módulos compartidos** (`functions/_shared/`): generados automáticamente en predeploy desde `src/utils/` por `scripts/sync-functions-shared.mjs`. No se commitean (gitignore). Si este script falla, el deploy de functions se aborta.

### 7.4 Qué corre en Cloud Functions vs cliente `[VERIFICADO]`

| En Cloud Functions | En cliente |
|---|---|
| Toda la IA (llamadas Anthropic) | Lectura de Firestore en tiempo real |
| Cobro y ledger de créditos | UI de calificación (el docente decide) |
| Calificación automática de evaluaciones | Cálculo de promedios (en memoria) |
| Calificación automática de juegos | Activación de alumnos |
| Notificaciones push | Generación de usernames |
| Recalculación de asistencias | Exportación de actas (en el navegador) |
| Aprobación de compras de créditos | |
| Activación de créditos de bienvenida (idempotente) | |
| Publicación programada de actividades | |

---

## 8. DECISIONES DE DISEÑO PERMANENTES

Estas reglas no se negocian sin una decisión explícita de Kike.

### 8.1 Mobile-first, no mobile-only `[VERIFICADO]`

El docente puede usar la plataforma en el navegador del escritorio (la UI del docente tiene sidebar). Los alumnos usan principalmente el móvil. La app Android es un complemento, no el producto principal. Al redactar textos de UI, referirse siempre a "la plataforma", nunca a "la app".

### 8.2 El alumno entra solo por código de acceso `[VERIFICADO]`

El acceso de alumnos es siempre por código o QR. La auto-inscripción (que un alumno entre solo escaneando un QR de clase sin que el docente lo haya agregado) fue evaluada y **descartada definitivamente** el 2026-08-02. El flujo de código-docente-crea-inscripción es intencional.

### 8.3 Un solo docente, una sola pantalla por función `[VERIFICADO en CLAUDE.md memoria]`

Principio de Don't Make Me Think aplicado al producto: no se duplican funciones entre pantallas. Cada función tiene una sola "casa". Ejemplo: el perfil del docente vive en `/profile`, no en un modal dentro del dashboard.

### 8.4 Todo el contenido de IA es editable `[VERIFICADO en memoria, en reglas de Firestore]`

Regla general desde 16-ago-2026: todo lo que genera la IA puede ser editado por el docente antes de usarlo (reactivos, rúbricas, instrucciones de actividades, avisos, etc.). La única excepción documentada son los diagnósticos y la planeación inicial, que son **inmutables una vez aceptados** (`Update: false` en Firestore rules) porque sirven como línea base del ciclo.

### 8.5 Soft delete `[INTERPRETADO, consistente con el código]`

Las asignaturas se archivan (`archived: true`), no se borran. Los alumnos que "salen" de una asignatura quedan marcados (`ocultaPorAlumno: true`) pero no se eliminan. El borrado definitivo de una cuenta debe limpiar **todo**: subcolecciones, archivos en Cloudinary, alumnos huérfanos.

### 8.6 No hay candado de escritura de plataforma: todo no-IA es gratuito `[VERIFICADO — firestore.rules 20-ago-2026 y 26-ago-2026]`

El candado de suscripción (`docenteActivo()` / `suscripcionHasta`) se retiró de `firestore.rules` el **20-ago-2026** junto con el modelo de suscripciones. La función `docenteActivo()` **ya no existe** en las reglas. El 26-ago-2026 se retiró también `saldoIAPositivo`, que era el último vestigio: exigía saldo > 0 para escribir Asistencia; se eliminó porque pasar lista es gratuito por definición.

El resultado hoy: **cualquier docente autenticado puede escribir** en sus colecciones (asignaturas, actividades, asistencia, alumnos, etc.) sin ningún candado de créditos o suscripción. El único control de acceso que queda son los helpers de propiedad (`ownsSubject`, `ownsActivity`, etc.) y la autenticación básica.

`src/utils/firestoreGuard.js` todavía existe como punto único de paso de las escrituras del docente (más de cien importaciones en el codebase apuntan ahí), pero **no bloquea nada**: reexporta las funciones de Firebase directamente sin interceptación.

Las operaciones de IA sí tienen un candado real, pero no es de Firestore: viven **dentro de la Cloud Function** `ejecutarOperacionIA` (ledger de créditos vía transacción atómica). Un docente sin saldo no puede iniciar una operación de IA, pero sí puede hacer todo lo demás.

### 8.7 Las tarifas de IA viven en Firestore, no en el código `[VERIFICADO]`

El documento `config/iaTarifas` en Firestore es la fuente de verdad para tarifas, modelo de IA, paquetes de créditos y el flag `chatAsistenteActivo`. Las Cloud Functions leen de ahí en runtime. Las reglas de Firestore validan los montos de pago contra esa misma colección (función `montoOficialCredito`). Si se cambia un precio en el documento sin desplegar las reglas actualizadas, puede quedar un desfase que rompe las compras.

### 8.8 Un solo método de pago: transferencia + aprobación manual `[VERIFICADO]`

El modal de compra de créditos está pausado en UI. Cuando se reactive, el flujo es: docente declara una transferencia bancaria → crea un `creditPurchase` en Firestore con estado `pendiente_pago` → admin aprueba manualmente → Cloud Function `aprobarCompraCreditos` (idempotente) acredita el saldo.

---

## 9. ESTADO ACTUAL Y ROADMAP

> Última verificación: 25-ago-2026.

### 9.1 Terminado y en producción `[VERIFICADO]`

- Registro y onboarding de docentes.
- Alta de asignaturas, alumnos, actividades (todos los tipos).
- Entrega de archivos por alumnos.
- Evaluaciones (cuestionario/examen) con calificación automática.
- Juegos (crucigrama y sopa de letras).
- Calificación manual y con IA de entregables.
- Calificación con IA de respuestas abiertas.
- Exportación de actas (Word/Excel).
- Asistencia y resumenes de asistencia.
- Planeación didáctica, por sus dos caminos: generada con IA o subida por el docente en PDF/DOCX (ver §5.5).
- Avisos con notificaciones push.
- Horario y agenda (calendario de clases).
- Sistema de créditos con ledger, bienvenida y compra por transferencia.
- App Android (Capacitor).
- CI/CD: lint, build, deploy functions y rules automáticos.

### 9.2 En curso o a medias `[VERIFICADO/INTERPRETADO]`

- **Chat con Asistente IA**: implementado pero desactivado a nivel sistema (`chatAsistenteActivo: false`). El flag existe en `config/iaTarifas`; reactivarlo requiere análisis económico.
- **Panel admin**: existe (`/Admin`) pero con funcionalidad parcial (`[INTERPRETADO]`).
- **Compra de créditos en UI**: pausada; el modal existe pero está bloqueado. El flujo de aprobación en el admin existe y funciona. `[VERIFICADO]`
- **Análisis de rentabilidad**: hay una colección `iaConsumosInterno` que registra cada llamada Anthropic con tokens reales. El análisis visual de esa data está pendiente.

### 9.3 Planeado pero no iniciado `[VERIFICADO desde memoria]`

- Segmentación de ventas por zona postal (el CP del docente existe para esto).
- Respaldo y exportación de datos del docente (Fase 9 del Plan Maestro IA).
- Más operaciones IA del Plan Maestro (Fases 7, 8, 10, 11).

---

## 10. TRAMPAS CONOCIDAS

Estas son las lecciones operativas que ya costaron tiempo o dinero. Un colaborador nuevo las repetiría si nadie se las dijera.

### 10.1 Las reglas de Firestore no se despliegan solas `[VERIFICADO — incidente real]`

`firestore.rules` contiene la función `montoOficialCredito()` que valida los montos de los `creditPurchases`. Si se cambia la tabla de paquetes de créditos en el documento `config/iaTarifas` de Firestore **pero no se despliegan las reglas**, los clientes intentan crear documentos de compra que las reglas rechazan por monto no reconocido. Esto dejó las compras caídas sin que nadie lo notara. **Siempre desplegar rules después de cambiar precios de créditos.**

### 10.2 `undefined === undefined` hace pasar guardas `[VERIFICADO — trampa real]`

Si una condición del tipo `if (a.campo === b.campo)` involucra un campo que no existe en los datos, ambos lados son `undefined` y la condición pasa. Esto causó una pantalla en blanco sin ErrorBoundary visible porque el flujo tomó un camino que asumía datos que no existían todavía. **Siempre probar el caso "el usuario aún no tiene datos generados"**, no solo con datos de ejemplo.

### 10.3 SPA vieja abierta corre código del pasado `[VERIFICADO — incidente real]`

Un usuario con una pestaña del navegador abierta desde hace horas corre el JavaScript que se cargó al abrir la pestaña. Si se hace un deploy que elimina o cambia una función (e.g., "mover clase"), la pestaña vieja puede invocar código que ya no existe o que ya no es coherente con el nuevo estado de Firestore. Esto produjo un incidente de "bloque en cadena" que llevó a implementar `UpdateChecker` (compara `buildId` en Firestore con el del bundle cargado y muestra un banner de "Actualiza la página").

### 10.4 La service account de seeds-db no puede desplegar reglas `[VERIFICADO]`

El archivo `seeds-db/service-account.json` es una service account de Firebase Admin SDK. Tiene permisos para leer y escribir en Firestore, pero **no tiene el rol `Firebase Rules Admin`**, así que `firebase deploy --only firestore:rules` falla con 403 cuando se usa con esa SA. Los deploys de reglas requieren la cuenta personal de Kike (`firebase login:ci` o session interactiva). Desde agosto 2026, el deploy de rules está automatizado en GitHub Actions con un token personal.

### 10.5 La suite de tests de Firestore rules necesita JDK 21 específico en Windows `[VERIFICADO]`

`npm run test:rules` corre el emulador de Firestore, que requiere JDK 21+. En la máquina de Kike, el JDK que funciona es el de Android Studio. Antes de correr los tests hay que exportar:
```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export PATH="$JAVA_HOME/bin:$PATH"
```
Si se intenta con otro JDK instalado en el sistema, el emulador puede fallar silenciosamente.

### 10.6 El módulo `functions/_shared/` no se commitea, se genera en predeploy `[VERIFICADO]`

`functions/_shared/` está en `.gitignore`. Se regenera automáticamente por `scripts/sync-functions-shared.mjs` como parte del predeploy de Cloud Functions. Si alguien edita archivos en `_shared/` directamente, los cambios se pierden en el próximo deploy. La fuente de verdad es siempre `src/utils/`.

### 10.7 Sesiones concurrentes de Claude pueden pisarse `[VERIFICADO — incidente operativo]`

El proyecto a veces tiene dos conversaciones de Claude activas simultáneamente. Si las dos hacen commits y push en ramas distintas pero una hace merge antes que la otra, la segunda puede tener un `origin/main` desactualizado. Antes de hacer `git push` siempre verificar `git fetch` y revisar si hay commits nuevos en main que no están en la rama local.

### 10.8 Vercel puede tener el deploy estancado sin aviso `[VERIFICADO — incidente real, resuelto 2026-07-04]`

El plan Hobby de Vercel puede llegar al límite de deploys y dejar el último merge sin desplegar en producción, sin error visible en GitHub. Si se mergea algo urgente y la producción no cambia, verificar el estado del deploy directamente en el dashboard de Vercel antes de asumir que el bug no existe.

### 10.9 El contenido de IA siempre debe ser editable antes de publicar `[VERIFICADO — decisión de diseño]`

Hubo un momento en que algunas partes del output de IA (planeación aceptada, análisis de resultados) se mostraban en modo solo lectura. Eso se revirtió: la regla desde 16-ago-2026 es que todo lo que genera la IA puede editarse antes de usarse. Si se implementa una nueva operación de IA y el resultado se muestra en un panel aparte o en modo solo lectura, es un bug de diseño.

### 10.10 El modal de compra de créditos está intencionalmente pausado `[VERIFICADO]`

El botón de comprar créditos existe en la UI pero está bloqueado. No es un bug; es una decisión de producto mientras Kike configura los datos bancarios en `config/payments`. No "arreglar" esto sin consultarlo primero.

---

*Fin del documento. Versión generada: 25-ago-2026.*
