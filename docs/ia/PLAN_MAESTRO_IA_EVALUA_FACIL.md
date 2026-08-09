# PLAN MAESTRO DE INTEGRACIÓN DE IA — EVALÚA FÁCIL

**Documento único y vivo.** Toda la hoja de ruta de la integración de IA vive aquí.
No se crean documentos paralelos; cada fase actualiza este mismo archivo.

- **Creado:** 9 de agosto de 2026
- **Última actualización:** 9 de agosto de 2026 — **Fase 2 aprobada y
  cerrada** (Q1–Q2 confirmadas). Registradas la herramienta interna de costos
  (simulador en Google Sheets) y la separación de responsabilidades. Fase 3
  en espera de autorización de Kike.
- **Dirige:** Kike. Este documento registra sus decisiones; no las sustituye.

---

## Reglas de trabajo de este proyecto

Definidas por Kike el 9-ago-2026. Rigen todo el trabajo de IA:

1. No se agregan requisitos que Kike no haya definido.
2. No se cambian decisiones ya tomadas.
3. No se inventan funcionalidades.
4. No se simplifica ni se sustituye información existente.
5. Ante una contradicción, duda o decisión pendiente: **detenerse y consultar**.
6. No se avanza automáticamente de una fase a otra. Al terminar cada fase:
   detenerse y esperar autorización.
7. No se programa nada hasta que Kike lo autorice (la programación es la
   Fase 11, y solo tras aprobar todo lo anterior).

**Regla fundamental del producto:** Evalúa Fácil facilita el trabajo del
docente, no lo sobrecarga. Entre dos alternativas funcionalmente equivalentes,
siempre gana la de menos pasos, menos pantallas, menos captura y menor carga
cognitiva para el docente. No se agrega por agregar.

---

## Estado de las fases

| Fase | Nombre | Estado |
|------|--------|--------|
| 1 | Auditoría y contexto | **Aprobada** (dudas D1–D4 resueltas el 9-ago-2026) |
| 2 | Planeación didáctica | **Aprobada y cerrada** (9-ago-2026) — diseño conceptual en §2.11; Q1–Q2 confirmadas |
| 3 | Operaciones de IA | No iniciada — **en espera de autorización de Kike** |
| 4 | Prompts y modelos | No iniciada |
| 5 | Créditos IA | No iniciada |
| 6 | Rentabilidad | No iniciada |
| 7 | Trial y continuidad | Decisiones tomadas y completas (D4 resuelta) — pendiente integrarlas al diseño |
| 8 | Datos y continuidad | Decisiones tomadas y completas (D3 resuelta) — pendiente integrarlas al diseño |
| 9 | Respaldo y recuperación | No iniciada |
| 10 | Exportaciones | Decisiones tomadas y completas (D4 resuelta) — pendiente integrarlas al diseño |
| 11 | Arquitectura e implementación | No iniciada — programar solo con autorización expresa |

---

# FASE 1 — AUDITORÍA Y CONTEXTO

Resultado de la auditoría completa del proyecto (código, documentación y
archivos existentes) realizada el 9-ago-2026. Todo lo que sigue está verificado
contra el repositorio, no contra documentos de memoria.

## 1.1 Qué es Evalúa Fácil hoy (arquitectura real)

- **Web (SPA):** React 19 + Vite, Tailwind, React Router. Desplegada en Vercel
  (`evalua-facil.vercel.app`). También PWA y **app Android** (Capacitor) que
  empaca el mismo build.
- **Datos:** Firestore con **30 colecciones raíz + 3 subcolecciones**
  (`activities/{id}/preguntas`, `activities/{id}/clave`,
  `submissions/{id}/respuestas`). Reglas en `firestore.rules` (~900 líneas).
- **Backend real (aunque CLAUDE.md diga lo contrario):**
  - `functions/index.js` — **14 Cloud Functions** desplegadas: push
    (`onActividadEscrita`, `onAvisoEscrito`, `onSubmissionEntregada`,
    `onEstudianteActivado`, `onPagoCreado`, `onPagoResuelto`,
    `onTokenPushEscrito`), cálculo (`onEvaluacionFinalizada`,
    `onSubmissionActualizada`, `onAttendanceEscrita`) y tiempo
    (`revisarProgramados`, `sincronizarCandadoSuscripcion`,
    `onSuscripcionEscrita`, `onDocenteCreado`). **La calificación automática de
    evaluaciones vive aquí, en servidor.**
  - `api/` — **11 endpoints serverless en Vercel** (de un tope de 12 del plan
    Hobby) + 4 pausados en `api/_pausado/` (Mercado Pago / PayPal).
- **Archivos:** Cloudinary (nunca Firebase Storage). Cuenta de Alan.
- **Correo:** Brevo desde servidor (EmailJS fue eliminado).
- **Notificaciones:** FCM push + bitácora (`notificationLog`).
- **Roles:** docente, alumno (correo sintético `@evalua.local`, sin correo
  real), admin (panel en `/Admin`).
- **Pruebas:** 245 casos en tres bancos (`test:unit`, `test:rules`,
  `test:server`).

## 1.2 Lo que Evalúa Fácil YA conoce (inventario de contexto para la IA)

Este es el insumo central de todo el proyecto: **la IA nunca debe preguntar al
docente lo que la plataforma ya sabe.** Por entidad:

### Docente (`users/{uid}`)
Nombre completo (`nombre`, `apellidoPaterno`, `apellidoMaterno`), nombre a
mostrar ante alumnos, prefijo/título (Ing., Lic., Mtro., …), correo, escuela
(`escuelaId` → `schools`, con `schoolName` denormalizado), ubicación resuelta
(`codigoPostal`, `estado`, `municipio`, `ciudad`), foto, proveedor de acceso,
estado de suscripción (`suscripcionHasta`, espejo escrito por Cloud Function).

### Escuela (`schools/{id}`)
Nombre oficial, nombre corto, **CCT** (`claveSEP`), subsistema, municipio,
estado. Catálogo de ~1,700 planteles CBTIS/CETIS/CBT en `public/planteles.json`
y catálogo nacional de códigos postales en `public/cp/`.

### Asignaturas (`subjects/{id}`)
Nombre, **grupo** (campo de texto de la asignatura — no existe entidad "grupo"
separada), número de parciales (default 3), **fechas por parcial**
(`parcialesFechas`), fechas de inicio/fin del curso, parciales
ocultos/cerrados, **ponderación activada por parcial**
(`ponderacionParciales`), paleta de color e icono, código de acceso, archivada
o no, orden del docente.

### Estudiantes (`students/{id}`)
Un documento = **una inscripción** (mismo alumno en 2 materias = 2 docs con el
mismo `uid`). Nombre completo, usuario (`apellido.nombre`), número de lista
(`orden`), foto, asignatura y escuela, activado o no y cuándo. Alta manual o
masiva por plantilla Excel.

### Actividades (`activities/{id}`)
Cuatro categorías: **entregable, observación, cuestionario, examen**. Nombre,
parcial, instrucciones en HTML enriquecido, archivos adjuntos, fecha límite
(con Timestamp que las reglas hacen valer), prórrogas individuales con motivo,
recibir tarde, tipos de archivo permitidos, calificación máxima, **peso en la
ponderación** (los pesos de un parcial suman 10), estado de publicación
(borrador / programada / publicada), rúbrica en copia snapshot, configuración
de evaluación (ver abajo), "sin calificación" para diagnósticos/encuestas.

### Evaluaciones (cuestionarios y exámenes)
Configuración completa en `activities/{id}.evaluacion`: número de preguntas,
orden (creación/aleatorio), navegación (libre/secuencial), tiempo límite,
intentos permitidos y política de conservación (primero/último/mejor/promedio),
publicación de resultados y de respuestas (manual o programada),
retroalimentación, barajar respuestas, **secciones** con nombre y descripción,
ponderación por reactivo.

**Reactivos** (`activities/{id}/preguntas/{id}`): 4 tipos — opción múltiple,
verdadero/falso, respuesta corta, subir archivo. Cada uno con enunciado,
imagen opcional, **retroalimentación por pregunta**, ponderación, opciones
(con "otra"), sección a la que pertenece. La respuesta correcta vive en la
subcolección protegida `clave/`, solo legible por el docente dueño.

**Banco de reactivos** (`bancoReactivos`): personal del docente, clasificado
por materia y tema, reutilizable entre asignaturas.

### Diagnósticos
**No existen como entidad propia.** Hoy un diagnóstico o encuesta es una
evaluación con `sinCalificacion: true` (con opción de arrojar resultado sin
contar para la calificación).

### Calificaciones y entregas / evidencias (`submissions`)
Por alumno y actividad (id determinista `{actividadId}_{alumnoId}`): archivos
entregados, fecha, entregado tarde o no, calificación, comentario del docente,
estado (pendiente/entregado/calificado), historial de versiones, evaluación de
rúbrica por criterio, y para evaluaciones: intentos con calificación de cada
uno (escritos solo por el servidor), respuestas por reactivo con puntos y
comentario del docente. **La plataforma conoce el desempeño completo de cada
alumno**: qué entregó, cuándo, con qué calificación, qué contestó en cada
reactivo, su asistencia y su promedio.

### Rúbricas y listas de cotejo (`bancoRubricas` + snapshot en actividad)
Modelo: niveles (3–5, el primero siempre 100%) × criterios (2–6, pesos que
suman exactamente 10) con descriptores por celda. La **lista de cotejo** es
una rúbrica de un solo nivel. Banco personal reutilizable. Funcionan en
entregables y observaciones (no en exámenes). **No existen "guías de
observación"** como instrumento; existe la categoría de actividad
"observación" (se califica sin entrega del alumno).

### Asistencia (`attendance` + `attendanceSummaries`)
Columnas generadas automáticamente desde el horario (dos horas seguidas = dos
columnas), tres estados (presente / falta / justificada, la justificada cuenta
como asistencia), motivos en texto libre, resúmenes por alumno calculados en
servidor. Respeta asuetos y vacaciones.

### Avisos (`avisos` + lecturas/guardados/ocultos/plantillas)
12 tipos, emoji, mensaje, acuse de lectura obligatorio e inmutable por alumno,
plantillas personales del docente.

### Calendario y horario
Horario por bloques materializado por fecha (`horarioBloques`: lugar, horas,
alarmas), eventos personales del docente (`events`), eventos académicos
compartidos con alumnos (`academicEvents`), eventos del alumno
(`studentEvents`), asuetos y vacaciones con alcance configurable. Cuatro
vistas compartidas docente/alumno.

### Recursos y materiales (los "documentos" de la plataforma)
- `resources`: links y archivos de apoyo por asignatura.
- `materials`: materiales con descripción enriquecida, archivos, parcial,
  publicación programada.
- **No existe una entidad "documentos" genérica**: los archivos viven en
  Cloudinary y se referencian por URL desde actividades, materiales, recursos,
  entregas y fotos.

### Negocio (`plans`, `subscriptions`, `payments`, `config/payments`)
Plan mensual único (`pro`), estados trial/activa/pendiente_pago/cancelada/
vencida, pagos por transferencia con aprobación manual del admin, cortesías
indefinidas desde el panel de admin. Detalle en §1.5.

### Qué significa esto para la IA
Para cualquier operación de IA, la plataforma puede armar **sin preguntar
nada** un contexto que incluye: quién es el docente y su escuela, qué materia
y grupo es, el calendario real del semestre con sus parciales y días hábiles,
qué actividades y evaluaciones existen (con instrucciones, reactivos y
ponderaciones), cómo va cada alumno (calificaciones, entregas, asistencia,
respuestas por reactivo), y qué instrumentos (rúbricas, listas de cotejo,
banco de reactivos) ya tiene el docente.

## 1.3 Lo que NO existe hoy (huecos que este plan llenará)

| Hueco | Estado actual verificado |
|-------|--------------------------|
| **Planeación didáctica** | Cero menciones en código y docs. Lo que hoy se llama "planeación" es logística: copiar asignatura al siguiente ciclo, importar actividades, horario, publicación programada, prórrogas. |
| **Formatos oficiales (SEP/DGETI)** | **No hay ningún formato oficial en el repositorio** (ver duda D1). Las exportaciones llevan membrete propio (escuela + docente + periodo), no un formato normado. |
| **Diagnóstico como entidad** | Solo existe como evaluación `sinCalificacion`. |
| **Integración de IA** | Ninguna en el producto. Lo único con IA en el repo son herramientas auxiliares fuera del despliegue (`Avatar/` con Gemini, `voice-pipeline.js` con ElevenLabs). |
| **Sistema de créditos** | Cero menciones. El modelo actual es suscripción por tiempo, sin medidores de consumo. |
| **Respaldo restaurable** | No existe. Lo único llamado "respaldo" hoy es el ZIP opcional de entregas al archivar una asignatura (solo descarga, no restaurable). |
| **Estadísticas por sección de examen** | Declarado "preparado, no construido": el dato (`seccionId`, `seccionNombre`) ya viaja en cada reactivo y en Excel/PDF, pero no se explota. |

## 1.4 Restricciones técnicas que condicionan la integración de IA

Verificadas en código; cualquier diseño de las fases 2–11 debe respetarlas:

1. **Tope de Vercel Hobby: 12 funciones serverless; hay 11.** Queda margen
   para **un** endpoint nuevo. Un backend de IA obliga a consolidar endpoints,
   cambiar de plan de Vercel, o usar otra vía (p. ej. Cloud Functions, donde
   no hay ese tope).
2. **Las reglas de Firestore no filtran campos, solo documentos** (riesgo R21,
   abierto). Todo dato generado por IA que el alumno no deba ver tendrá que
   vivir en documento aparte o servirse desde endpoint — nunca como campo
   dentro de un documento que el alumno lee.
3. **Consultas Firestore solo por igualdad** (sin rangos ni `orderBy`); se
   ordena en memoria. Los índices compuestos viven en `firestore.indexes.json`.
4. **Candado de suscripción de dos capas** (cliente `firestoreGuard.js` +
   servidor `docenteActivo()` en reglas). Las operaciones de IA tendrán que
   integrarse a este mismo candado; el campo ausente deja pasar a propósito.
5. **Lógica duplicada a propósito** entre `src/`, `api/` y `functions/`
   (no pueden importarse entre sí). Cada regla de negocio nueva de IA que
   viva en más de una capa se duplicará también.
6. **Migración pendiente a endpoints** (riesgos R7–R9: listados sin sesión).
   Las consultas del cliente van a migrar a servidor; el diseño de IA debe
   alinearse a esa dirección, no sumarse al patrón viejo.
7. **Cloudinary es de Alan** (no de Kike) y el preset actual permite subir sin
   sesión (R16). Si la IA analiza documentos subidos, tocará este flujo.
8. **Descargas solo desde la web** (`descargaSoloWeb.js`) — la app Android no
   descarga; abre en el navegador del sistema. Relevante para las fases 9–10.
9. **Precios en código**: `MONTHLY_PRICE_MXN = 99` ("Precio de lanzamiento";
   el normal de referencia es $116), descuento por transferencia de 1–6 meses
   (1 = $99 … 6 = $474), `ANNUAL_PRICE_MXN = 990` (plan anual **pausado** hasta
   v1.0.2, igual que tarjeta/MP/PayPal), plan `cortesia` indefinido,
   `TRIAL_DURATION_DAYS = 30`, `RETENTION_DAYS = 90`.

## 1.5 Estado actual del negocio y del trial (como referencia para fases 5–10)

- Trial de 30 días con avisos a 6 días y el último día.
- Docente vencido/cancelado hoy: **puede leer y exportar todo** (con marca de
  agua si no está en periodo pagado), no puede escribir contenido.
- Los estudiantes nunca se ven afectados si su maestro no paga.
- Único método de pago activo: transferencia con aprobación manual (v1.0.1).
- Correos de retención a los 60 y 83 días de vencida; el borrado a los 90 días
  **no se ejecuta automáticamente** (decisión pendiente registrada como R4).

## 1.6 Vigencia de la documentación interna (para no auditar sobre papel viejo)

| Documento | Veredicto |
|-----------|-----------|
| `DOCUMENTACION/INVENTARIO_DEL_SISTEMA.md` (7-ago) | Vigente. La mejor referencia del sistema. |
| `docs/PROYECTO.md` (5-ago) | Vigente (un dato mal: dice 9 funciones Vercel; son 11). |
| `docs/VENTAJAS_COMPETITIVAS.md` (29-jul) | Vigente, salvo su "Nota sobre la IA": esa postura quedó sustituida el 9-ago-2026 (ver D2). |
| `docs/CONTEXTO_PROYECTO.md` (28-jun) | **Obsoleto en bloque** (describe 10 colecciones, trial de 45 días, asistencia "eliminada"). No usar como fuente. |
| `CLAUDE.md` | Desactualizado en stack ("no Functions, no backend" es falso; EmailJS ya no existe; hoy hay 3 bancos de pruebas). |

---

# FASE 2 — PLANEACIÓN DIDÁCTICA · ANÁLISIS DE LOS FORMATOS OFICIALES

Análisis realizado el 9-ago-2026 sobre los tres PDF oficiales que Kike
proporcionó (§2.1–§2.9), decisiones P1–P5 resueltas (§2.10) y diseño
conceptual de la solución en §2.11. **Fase aprobada y cerrada por Kike el
9-ago-2026** (Q1–Q2 confirmadas en §2.11.11). Nada de esto está programado —
la implementación pertenece a la Fase 11.

## 2.1 Los formatos de referencia

Son impresiones del portal oficial **planeaciondidactica.sems.gob.mx**
(SEMS), tituladas **"Instrumento de registro de la Planeación Didáctica"**,
con encabezado de la Subsecretaría de Educación Media Superior / DGETI /
plantel. Cada documento tiene 6 páginas y cubre **UN parcial**; el semestre
completo son tres documentos de la misma asignatura:

| Documento | Parcial | Periodo de aplicación | Horas |
|-----------|---------|----------------------|-------|
| `…2961387.pdf` | 1 | 03/02/2026 – 17/03/2026 | 20 |
| `…2961388.pdf` | 2 | 18/03/2026 – 11/05/2026 | 30 |
| `…2961389.pdf` | 3 | 12/05/2026 – 16/06/2026 | 30 |

Los tres son de la misma asignatura de ejemplo: submódulo "M1S1. Construye
Algoritmos para la solución de problemas", semestre 2, carrera Técnico en
Programación, CBTIS 255 (DGETI). Archivos de referencia en el Drive de Kike:
`G:\Mi unidad\Nube mia\CBTis\3 Diseña software de sistemas informaticos\2026 Enero - Junio\Planeacion\`.

**Reglas de uso acordadas:** se conserva su estructura, campos, organización
y requisitos funcionales como referencia institucional. NO se reproducen
logotipos, escudos, encabezados gráficos ni identidad visual institucional.
Su complejidad NO se traslada al docente.

Dato revelador de los propios ejemplos: hay huellas típicas de la captura
manual repetida (el parcial 1 tiene fecha de elaboración "2025" donde los
otros dicen "2026", y hay erratas en textos que se repiten entre parciales).
Es exactamente la carga y el tipo de error que la generación automática debe
eliminar.

## 2.2 Estructura completa del formato (inventario de campos)

El formato se organiza en **seis secciones**. Para cada campo se indica su
**alcance** (Asignatura = común a todo el semestre / Parcial = propio de cada
periodo) y su **fuente**: `EF` = Evalúa Fácil ya lo sabe o lo deriva, `D` =
lo aporta el docente (captura única), `IA` = la IA puede proponerlo y el
docente valida, `CAT` = proviene de un catálogo oficial finito (en el portal
se selecciona, no se redacta).

### A. Identificación

| Campo | Alcance | Fuente |
|-------|---------|--------|
| Institución / subsistema (ej. DGETI) | Asignatura | EF (`schools.subsistema`) |
| Plantel (ej. CBTIS 255) | Asignatura | EF (`schools`, catálogo de planteles) |
| C.C.T. | Asignatura | EF (`schools.claveSEP`) |
| Docente(s) que elaboró el instrumento (con título, ej. "M.C.") | Asignatura | EF (`users`: prefijo + nombre completo) |
| Fecha de elaboración (día/mes/año) | Documento | EF (fecha de generación) |
| Asignatura o submódulo (nombre oficial largo, ej. "M1S1. …") | Asignatura | EF (`subjects.nombre`) — ver nota 1 |
| Semestre | Asignatura | D — **no existe hoy en Evalúa Fácil** |
| Carrera | Asignatura | D — **no existe hoy** |
| Periodo de la aplicación (fecha inicio–fin) | **Parcial** | EF (`subjects.parcialesFechas`) |
| Duración en horas | **Parcial** | EF — derivable de `horarioBloques` menos asuetos/vacaciones (hoy no se calcula, pero el dato existe) |
| Campo disciplinar (ej. "Componente Profesional") | Asignatura | CAT + D/IA |
| Propósito formativo del campo disciplinar | Asignatura | IA propone / D valida |
| Transversalidad con otras asignaturas | Asignatura | D (opcional — vacío en los tres ejemplos) |
| Ámbitos del perfil de egreso a los que contribuye | Asignatura (varió ligeramente entre parciales en el ejemplo) | CAT + IA propone |

Nota 1: el nombre que el docente usa a diario ("Algoritmos") puede diferir
del nombre oficial del submódulo ("M1S1. Construye Algoritmos para la
solución de problemas"). Puede requerirse un "nombre oficial" además del
nombre corto — decisión de diseño de esta fase.

### B. Intenciones formativas

| Campo | Alcance | Fuente |
|-------|---------|--------|
| Propósito formativo de la asignatura | Asignatura (idéntico en los 3) | IA propone desde el programa de estudios / D valida |
| Aprendizajes clave (NME) — Ejes disciplinarios | Asignatura | D/IA ("N/A" en los 3 ejemplos) |
| Aprendizajes clave — Componente | Asignatura | D/IA ("N/A" en los ejemplos) |
| Aprendizajes clave — Contenido central | Asignatura | D/IA ("N/A" en los ejemplos) |
| Aprendizajes clave — **Aprendizaje esperado** (ej. "Competencia: Realiza pseudocódigo") | **Parcial** | D/IA |
| Aprendizajes clave — Proceso de aprendizaje | Parcial | D/IA ("N/A" en los ejemplos) |
| Aprendizajes clave — **Productos esperados** | **Parcial** | D/IA (mapea con los productos de las actividades reales) |
| Aprendizajes clave — **Contenidos específicos** | **Parcial** | D/IA |
| Habilidades socioemocionales (HSE) (ej. "Elige T – Perseverancia") | **Parcial** | CAT (catálogo Construye T / Elige T) |
| Competencias genéricas y atributos (ej. G4/4.5, G5/5.6, G6/6.1, G8/8.1) | Asignatura (idénticas en los 3) | CAT + IA propone |
| Competencias disciplinares (ej. M4, M8, CO12, H4) | Asignatura (idénticas en los 3) | CAT + IA propone |
| Competencias de productividad y empleabilidad (ej. TE2, CE2, OL2, AD5, PO5, RI5) | **Parcial** (variaron entre parciales) | CAT + IA propone |

### C. Actividades de aprendizaje (el corazón del documento — POR PARCIAL)

Organizadas en **tres momentos: Apertura, Desarrollo y Cierre.** Cada momento
lleva uno o más bloques con esta estructura:

| Campo del bloque | Fuente |
|------------------|--------|
| Actividad del docente (narrativa de lo que el docente hace) | IA puede redactarla a partir de las actividades reales / D ajusta |
| Recursos utilizados (ej. "Plataforma X, proyector") | D + parcialmente EF (`resources`, adjuntos) |
| Duración en horas (del docente) | D/IA — **hoy no existe horas-por-actividad en EF** |
| Actividad del estudiante (narrativa) | IA desde las instrucciones reales de la actividad / D ajusta |
| Duración en horas (del estudiante) | D/IA — no existe hoy |
| Producto de aprendizaje esperado | EF (nombre/entregable de la actividad real) |
| Tipo de evaluación, formato `{Agente}/{Instrumento}` (ej. "Heteroevaluación/Examen", "Heteroevaluación/Rúbrica", "No Evaluada/Sin Instrumento") | Instrumento: EF (categoría de la actividad: examen, cuestionario, rúbrica, lista de cotejo, sin calificación). Agente (hetero/co/auto/no evaluada): no existe hoy — CAT |
| Ponderación (%) — los bloques del parcial suman 100% | EF (`pesoCalificacion`: los pesos que suman 10 mapean directo a %) |

En los tres ejemplos el patrón real fue: Apertura 0%, un bloque de Desarrollo
con el 100% y Cierre 0% ("entrega de calificaciones y aclaraciones antes de
subirlas al SISEEMS").

### D. Recursos por utilizar (Asignatura)

| Campo | Fuente |
|-------|--------|
| Materiales (ej. plataforma educativa) | D + parcialmente EF (`resources`/`materials`) |
| Equipo (ej. computadora con internet) | D |

### E. Referencias (Asignatura)

| Campo | Fuente |
|-------|--------|
| Bibliográficas (formato libre tipo APA) | D y/o IA sugiere / D valida |
| Internet; otras fuentes | D y/o IA |

### F. Validación (Asignatura / plantel)

| Campo | Fuente |
|-------|--------|
| Elaborado por (nombre del docente) | EF (`users`) |
| Recibido por (nombre — en el ejemplo, personal del plantel) | D (captura única) |
| Avalado por (nombre — en el ejemplo, personal directivo) | D (captura única) |
| Contribuciones y/o colaboraciones | D (opcional — solo aparece en uno de los tres) |

## 2.3 Qué se repite entre parciales (la carga burocrática a eliminar)

De ~30 campos del formato, **alrededor de 20 fueron idénticos en los tres
documentos**: toda la identificación (salvo periodo, horas y fecha de
elaboración), propósito del campo disciplinar, propósito de la asignatura,
ámbitos del perfil de egreso (con una variación menor), competencias
genéricas, competencias disciplinares, recursos, referencias y validación.
El portal oficial obliga hoy a capturar todo eso **tres veces por semestre y
por asignatura**. En Evalúa Fácil se captura **una sola vez a nivel
asignatura** y se hereda a los tres parciales.

## 2.4 Qué cambia por parcial

- Periodo de aplicación (EF ya lo sabe) y duración en horas (derivable).
- Aprendizaje esperado / competencia del parcial.
- Productos esperados y contenidos específicos.
- HSE seleccionada y competencias de productividad/empleabilidad.
- Los bloques de actividades (Apertura/Desarrollo/Cierre) con recursos,
  duraciones, productos, tipo de evaluación y ponderación.

## 2.5 Qué puede mantenerse vivo durante el semestre

Las **actividades reales** son la parte viva por naturaleza: el docente las
crea, mueve y repondera durante el semestre dentro de Evalúa Fácil, y la
plataforma ya las mantiene al día (con fechas, instrumentos y pesos). Los
contenidos/aprendizajes del parcial y las fechas de parcial también son
editables hoy. La Planeación Oficial se generará como **foto del estado
actual** de esa información viva al momento de exportar.

## 2.6 Lo que Evalúa Fácil ya puede llenar solo (sin preguntar al docente)

Plantel, CCT, subsistema, docente con título, fecha de generación, nombre de
la asignatura, periodo de cada parcial, horas por parcial (derivadas del
horario real menos asuetos/vacaciones), las actividades de cada parcial con
su producto, su instrumento de evaluación y su ponderación en %, y parte de
los recursos.

## 2.7 Lo que el docente tendría que aportar (captura única por asignatura)

Carrera y semestre; nombre oficial del submódulo si difiere del nombre corto;
los datos curriculares (o validar lo que la IA proponga): propósitos,
competencias, ámbitos, aprendizajes por parcial, HSE; nombres de "Recibido
por" / "Avalado por"; referencias; recursos/equipo generales.

## 2.8 Lo que la IA puede generar o proponer (siempre editable por el docente)

- Propósito formativo del campo y de la asignatura, a partir del programa de
  estudios oficial de la carrera/submódulo.
- Selección propuesta de competencias (genéricas, disciplinares,
  productividad) y ámbitos del perfil de egreso — son catálogos finitos.
- Aprendizajes esperados, contenidos específicos y productos por parcial.
- La **narrativa de Apertura/Desarrollo/Cierre** (actividad del docente y del
  estudiante) redactada a partir de las actividades reales que el docente ya
  creó en Evalúa Fácil — este es el mayor ahorro de trabajo.
- Referencias bibliográficas sugeridas.
- El detalle fino (contexto por operación, prompts, modelos) pertenece a las
  fases 3 y 4.

## 2.9 Lo que Evalúa Fácil debe conservar para generar la Planeación Oficial

El modelo completo de campos de §2.2 con su alcance: un bloque **por
asignatura** (identificación complementaria: carrera, semestre, nombre
oficial; datos curriculares comunes; recursos; referencias; validación) y un
bloque **por parcial** (aprendizaje esperado, contenidos, productos, HSE,
competencias de productividad, y los bloques de actividades con momentos,
duraciones, agente de evaluación y narrativas). Todo lo demás ya vive en las
colecciones existentes y se toma de ahí al momento de generar. El diseño
conceptual de la entidad (Planeación Viva) está en §2.11; el diseño técnico
de almacenamiento pertenece a la Fase 11.

## 2.10 Decisiones P1–P5 (RESUELTAS por Kike el 9-ago-2026)

- **P1 — Granularidad. Resuelta:** la Planeación Viva es UNA sola por
  asignatura para todo el periodo académico, con estructura interna de
  **número VARIABLE de parciales** — nunca limitada técnicamente a tres. En
  la 1.0, el formato SEMS/DGETI de referencia genera un documento oficial por
  parcial (tres en el ejemplo), pero eso es propiedad del formato, NO una
  limitación de Evalúa Fácil: con 4, 5 o más parciales la misma estructura
  debe generar el documento de cada uno sin rediseñar el sistema. No se
  implementan todavía variantes de otros subsistemas ni otros formatos.
- **P2 — Formato de salida. Resuelta:** la Planeación Oficial se genera en
  **Excel y PDF**; ambos necesarios. Excel es especialmente útil para que el
  docente traslade la información al sistema oficial cuando haga falta; PDF
  es el documento formal para guardar, imprimir o entregar.
- **P3 — Destino. Resuelta:** la Planeación Oficial cumple con la información
  y estructura del formato institucional de referencia, y sirve tanto de
  documento institucional como de apoyo para capturar en el portal oficial.
  **Nunca afirmar** que Evalúa Fácil garantiza que el documento será aceptado
  directamente por cualquier escuela o sistema externo — eso no depende de
  Evalúa Fácil.
- **P4 — Campos "N/A". Resuelta:** ejes disciplinarios, componente, contenido
  central y proceso de aprendizaje se establecen **"N/A" por defecto** cuando
  corresponda. No se convierten en preguntas obligatorias; el docente puede
  modificarlos si necesita proporcionar información específica.
- **P5 — Alcance 1.0. Resuelta:** la versión 1.0 se diseña específicamente
  para el formato SEMS/DGETI analizado. No se diseñan ahora variantes de
  otros subsistemas, pero se evita un diseño innecesariamente cerrado que
  haga imposible incorporar otros formatos en el futuro.

## 2.11 Diseño conceptual de la Planeación Didáctica (APROBADO el 9-ago-2026)

Elaborado el 9-ago-2026 con P1–P5 resueltas y aprobado por Kike ese mismo
día. Define el QUÉ y el CÓMO conceptual; nada está programado y la
arquitectura técnica (colecciones, endpoints, dónde se guarda exactamente)
pertenece a la Fase 11.

### 2.11.1 La Planeación Viva: qué es

**Una sola planeación por asignatura**, que abarca todo el periodo académico
con todos sus parciales. Es la **fuente de verdad** de la planeación del
docente y vive dentro de Evalúa Fácil. La Planeación Oficial no es una
entidad: es una **salida generada** desde la Planeación Viva (un documento
por parcial, en Excel y PDF).

Tiene dos niveles, espejo directo del análisis de §2.2:

**Nivel 1 — Tronco de la asignatura** (se captura o valida UNA sola vez):

| Grupo de datos | De dónde sale |
|----------------|---------------|
| Identidad: plantel, CCT, subsistema, docente con título, nombre de la asignatura, grupo, fechas del curso y de cada parcial, horario | Evalúa Fácil ya lo sabe — el docente no lo toca |
| Complemento de identificación: **carrera**, **semestre**, nombre oficial del submódulo (solo si difiere del nombre corto) | El docente, una sola vez |
| Currículo común: campo disciplinar, propósito formativo del campo, propósito formativo de la asignatura, ámbitos del perfil de egreso, competencias genéricas y disciplinares, transversalidad (opcional) | La IA lo propone; el docente valida o ajusta |
| Recursos generales (materiales y equipo) y referencias | La IA propone un arranque (con lo que hay en la asignatura); el docente ajusta |
| Validación: "Recibido por", "Avalado por", contribuciones (opcional) | El docente, una sola vez (nombres de su plantel) |

**Nivel 2 — Bloques por parcial** (lista dinámica: un bloque por parcial):

| Grupo de datos | De dónde sale |
|----------------|---------------|
| Periodo del parcial y horas totales | Evalúa Fácil (fechas del parcial + horario real menos asuetos/vacaciones) |
| Actividades reales del parcial (producto, instrumento, ponderación) | Evalúa Fácil — **referencia viva, no copia** |
| Contenido del parcial: aprendizaje esperado, contenidos específicos, productos esperados, HSE, competencias de productividad | La IA propone; el docente valida |
| Narrativas de Apertura / Desarrollo / Cierre (actividad del docente y del estudiante, recursos, duraciones) | La IA las redacta a partir de las actividades reales; el docente ajusta |
| Ejes disciplinarios, componente, contenido central, proceso de aprendizaje | **"N/A" por defecto** (P4) — editables, nunca obligatorios |

### 2.11.2 Estructura variable de parciales (P1)

El número de bloques sigue al número de parciales de la asignatura
(`subjects.parciales`, que **ya es variable en Evalúa Fácil** — 3 es solo el
valor por omisión). Nada en la Planeación Viva se define como "primer,
segundo y tercer parcial": los bloques son una lista. Si la asignatura tiene
4 o 5 parciales, hay 4 o 5 bloques y el generador de la Planeación Oficial
produce 4 o 5 documentos, sin cambiar nada del diseño. Si el docente cambia
el número de parciales a media marcha, la Planeación Viva agrega o retira
bloques siguiendo a la asignatura.

### 2.11.3 Los dos principios de captura

1. **Lo que Evalúa Fácil sabe, no se pregunta.** Identidad, fechas, horas,
   actividades, instrumentos y ponderaciones entran solos.
2. **Lo que la IA puede proponer, llega pre-llenado.** El docente nunca ve un
   formulario en blanco de 30 campos: ve una propuesta completa y editable, y
   su trabajo es validar y ajustar, no redactar desde cero.

La única captura genuinamente nueva del docente es mínima: carrera, semestre
(una pantalla, una vez por asignatura) y los nombres de validación de su
plantel.

### 2.11.4 Flujo del docente (concepto, 4 pasos)

1. En la **pestaña IA de la asignatura**, el docente pide su Planeación.
2. Evalúa Fácil arma solo el contexto y pregunta únicamente lo mínimo que no
   sabe (carrera y semestre, la primera vez).
3. La IA entrega la **Planeación Viva completa como propuesta editable**
   (operación "Planeación Didáctica 1.0" de la Fase 3).
4. El docente revisa, ajusta lo que quiera y listo: la planeación queda viva.

### 2.11.5 Qué la mantiene viva

- Las **actividades reales son referencia, no copia**: si el docente crea,
  mueve o repondera actividades durante el semestre, la parte de actividades
  de la planeación siempre está al día por sí sola.
- Las narrativas y contenidos se ajustan cuando el docente quiera, a mano o
  pidiéndole a la IA "ponlos al día" (la operación "modificar Planeación" de
  la Fase 3 — pensada como operación pequeña y frecuente).
- La Planeación Oficial se genera como **foto del estado vivo actual** en el
  momento de exportar. Sin banderas de "desactualizado" ni semáforos que
  presionen al docente: la planeación nunca "se vence".

### 2.11.6 La Planeación Viva como contexto de toda la IA

El contexto de cualquier operación de IA se arma **en capas**, sin preguntar
nada que ya exista:

1. **Perfil del docente para IA** — global, capturado en su Perfil (zona
   azul). Aplica a todas sus asignaturas.
2. **Asignatura** — sus datos + su Planeación Viva (propósitos, competencias,
   contenidos por parcial).
3. **Parcial en curso** — fechas, horas, actividades, avance real del grupo.
4. **La operación específica** — lo que el docente está pidiendo (crear un
   examen, una rúbrica, retroalimentación…).

Así, "crear examen" ya sabe qué contenidos específicos toca el parcial;
"crear actividad" ya sabe el aprendizaje esperado; "retroalimentación
personalizada" ya sabe qué se planeó y qué entregó cada alumno. La Planeación
Viva es la pieza que le da intención pedagógica a todas las demás operaciones
de la Fase 3 — por eso puede generarse desde el trial.

### 2.11.7 Generación de la Planeación Oficial (P1–P3)

- **Un documento por parcial**, generado desde el estado vivo actual.
- **Excel y PDF** (P2), con la estructura de secciones del formato de
  referencia (§2.2: Identificación, Intenciones formativas, Actividades de
  aprendizaje por momentos, Recursos, Referencias, Validación), los datos en
  texto y **sin logotipos ni identidad visual institucional**.
- Ponderaciones: los pesos reales de Evalúa Fácil (suman 10) se expresan como
  porcentajes (suman 100%).
- Sirve como documento institucional y como apoyo para capturar en el portal
  oficial; **no se promete aceptación garantizada** por ninguna escuela o
  sistema (P3).
- Candado comercial: en trial la Planeación Viva se genera y consulta dentro
  de la plataforma, pero la descarga de la Oficial (Excel/PDF) requiere
  suscripción activa — decisiones ya registradas.

### 2.11.8 Modelo neutro + plantilla de salida (P5: la puerta abierta)

Separación conceptual en dos piezas:

- **El modelo de planeación** (tronco + bloques por parcial) es neutro: no
  sabe nada de DGETI ni de ningún formato.
- **La plantilla de salida** SEMS/DGETI 1.0 es quien sabe cómo acomodar ese
  modelo en las seis secciones del formato de referencia.

Incorporar otro formato en el futuro significa agregar otra plantilla de
salida — no tocar el modelo, ni la captura, ni la IA. En 1.0 existe UNA sola
plantilla (SEMS/DGETI) y no se construye ninguna otra.

### 2.11.9 Lo que el docente NO tendrá que hacer

- Llenar el instrumento de ~30 campos, ni una vez ni tres.
- Capturar tres veces lo que es idéntico entre parciales.
- Redactar narrativas de Apertura/Desarrollo/Cierre desde cero.
- Buscar y transcribir competencias de los catálogos oficiales.
- Calcular periodos, horas ni ponderaciones.
- Volver a escribir lo que ya vive en Evalúa Fácil.

### 2.11.10 Notas para fases posteriores (no son decisiones nuevas)

- La Planeación es material del docente: el alumno no la lee. Por el riesgo
  R21 (las reglas no filtran campos), el diseño técnico de la Fase 11 deberá
  guardarla fuera del alcance de lectura del alumno.
- Defaults propuestos al generar: agente de evaluación "Heteroevaluación"
  (el caso normal, como en los tres ejemplos) y reparto de horas por
  actividad propuesto por la IA a partir de las horas reales del parcial —
  siempre editables.
- El contenido exacto del "perfil del docente para IA" se definirá en las
  fases 3–4, cuando cada operación declare qué contexto global necesita.

### 2.11.11 Puntos Q1–Q2 (CONFIRMADOS por Kike el 9-ago-2026)

- **Q1 — Casa de la Planeación Viva. Confirmado:** vive dentro de la
  **pestaña IA de cada asignatura**. Esa pestaña es el espacio donde el
  docente encuentra y trabaja con la IA relacionada con esa asignatura: ahí
  está la Planeación Viva y, a partir de ella, las demás operaciones de IA
  que correspondan. **No se crea una pestaña independiente de Planeación.**
- **Q2 — Perfil IA del docente. Confirmado:** sus campos exactos se definirán
  durante las fases de inventario de operaciones y diseño de prompts/contexto
  (fases 3–4); no se inventa ahora una lista definitiva. La razón: primero
  hay que identificar qué información necesita realmente cada operación de
  IA, y a partir de eso determinar qué debe ser global del docente. El Perfil
  IA es GLOBAL, se captura en la sección correspondiente del perfil del
  docente (zona azul de la interfaz) y queda disponible para todas sus
  asignaturas y operaciones de IA.
  **Regla fundamental:** no pedir al docente lo que Evalúa Fácil ya conoce, y
  tampoco pedir en el Perfil IA información que después resulte innecesaria —
  únicamente el contexto que realmente aporte valor a las operaciones de IA.

---

# DECISIONES YA TOMADAS (registro fiel — no se modifican)

Definidas por Kike el 9-ago-2026 al arrancar este proyecto. Son el marco fijo
de las fases 7, 8, 9 y 10:

## Trial y continuidad
- Trial de 30 días.
- **El trial NO es una versión limitada de Evalúa Fácil** (aclaración de Kike,
  9-ago-2026): durante los 30 días el docente debe poder utilizar
  prácticamente toda la funcionalidad de la plataforma, **incluyendo las
  funciones de IA disponibles según sus créditos**. La intención es que
  compruebe el valor real de Evalúa Fácil trabajando normalmente.
- La restricción comercial del trial es principalmente la **salida de
  información fuera de Evalúa Fácil** (detalle en "Alcance del bloqueo en
  trial", más abajo).
- La Planeación Didáctica puede generarse internamente durante el trial,
  porque sirve como contexto para las demás funciones de IA.
- Durante el trial NO se pueden descargar ni exportar archivos Excel o PDF.
- Durante el trial NO se ofrece respaldo.
- Si el docente paga durante el trial, conserva los días restantes de prueba.
- Al terminar el trial sin pago, la cuenta queda inactiva.
- La información permanece almacenada.
- El docente puede regresar después y reactivar su cuenta.
- No se elimina información por falta de pago o inactividad.

## Datos y continuidad
- La información del docente se conserva de forma indefinida mientras el
  usuario no solicite su eliminación.
- La única forma de eliminar definitivamente la información es una solicitud
  explícita del propio usuario.
- Debe existir un mecanismo seguro para solicitar la eliminación total.
- (D3, resuelto 9-ago-2026) Esta decisión **sustituye la política anterior de
  90 días**. La información NO se elimina por: terminar el trial, terminar la
  suscripción, cancelarla, permanecer inactivo, ni pasar meses o años sin
  usar Evalúa Fácil.
- En su momento deberán actualizarse textos, avisos, correos, políticas y
  cualquier referencia que hoy diga que los datos se conservan 90 días
  (incluida la declaración de seguridad de datos de Play Store).

## Respaldo y recuperación
- Solo durante un periodo pagado el docente puede generar un respaldo.
- El respaldo sirve únicamente para restaurar información dentro de Evalúa
  Fácil (misma cuenta u otra cuenta de Evalúa Fácil).
- El respaldo NO contiene: créditos, periodo de prueba, estado de suscripción,
  beneficios comerciales, la Planeación en Excel, ni documentos PDF de salida.
- El respaldo no sirve para reiniciar un trial.
- Debe existir un registro de continuidad que impida usar un respaldo para
  obtener de nuevo beneficios comerciales de una cuenta ya utilizada.

## Exportaciones
- Excel y PDF son documentos de salida de Evalúa Fácil.
- Durante el trial no pueden descargarse; con suscripción activa sí.
- El respaldo interno NO sustituye estas exportaciones.

## Alcance del bloqueo en trial (D4, resuelto y aclarado el 9-ago-2026)
Principio general: **durante el trial el docente trabaja con la plataforma
completa, pero no puede sacar su trabajo fuera de Evalúa Fácil. Con
suscripción activa puede exportar Excel y PDF y generar respaldos.**

Bloqueado durante el trial (salida de información / productos de trabajo):
- Excel.
- PDF de trabajo.
- Reportes.
- Planeación Oficial.
- ZIP de evidencias (extracción del trabajo realizado dentro de la
  plataforma).
- Respaldo.

NO bloqueado durante el trial:
- **PDF de credenciales de acceso de los estudiantes** — no es una
  exportación comercial; es necesario para que el docente pueda operar
  normalmente con su grupo durante el trial.
- El resto de la funcionalidad de la plataforma, incluidas las funciones de
  IA disponibles según sus créditos.

## Ubicación de la IA en la interfaz (definido por Kike, 9-ago-2026)
- El **perfil del docente para IA** es información global del docente; se
  captura en la sección correspondiente del **perfil del docente**, en la
  zona azul de la interfaz.
- **Cada asignatura tendrá su propia pestaña de IA.**
- La IA de una asignatura trabaja con el contexto disponible del docente y el
  contexto específico de esa asignatura: grupo, periodo, planeación,
  actividades, evaluaciones y demás información existente en Evalúa Fácil.
- El docente NO vuelve a proporcionar información que Evalúa Fácil ya conoce.
- La intención de todo esto es FACILITAR el trabajo docente, no crear otro
  formulario burocrático.

## Modelo comercial de la IA (D2, resuelto 9-ago-2026)
- Las instrucciones nuevas **sustituyen cualquier decisión anterior que las
  contradiga** (incluida la nota "complemento aparte en 2027, fuera del plan"
  de `VENTAJAS_COMPETITIVAS.md`).
- La IA SÍ forma parte del **Plan Docente de $99 MXN mensuales**.
- El objetivo es determinar cuánta IA se puede ofrecer dentro de esos $99
  mediante un sistema de créditos IA y comprobar su rentabilidad.
- El análisis económico se hace sobre el precio actual de lanzamiento:
  **$99 MXN mensuales. NO usar $116 como precio base del simulador.**
- Si después se definen planes para usuarios con mayor consumo de IA, se
  analizarán como planes adicionales.

## Herramienta interna de costos y rentabilidad de IA (registrada 9-ago-2026)

**`Simulador_Costos_IA_Evalua_Facil.xlsx`** — se utilizará en **Google
Sheets**. NO forma parte del producto Evalúa Fácil y NO será visible para los
docentes: es la herramienta exclusiva de gestión de Kike para tomar las
decisiones económicas sobre la IA de Evalúa Fácil. Su función es estimar y
analizar:

- precios vigentes de las APIs;
- modelos utilizados;
- tokens de entrada y tokens de salida;
- costo real por operación y costo en MXN;
- créditos IA;
- consumo estimado por docente y consumo mensual;
- escenarios de uso bajo, medio y alto;
- costo mensual de IA;
- ingreso por docente, margen y rentabilidad del plan de $99 MXN;
- y, posteriormente, la conveniencia de crear planes superiores para
  docentes que excedan de manera recurrente el límite de créditos del plan
  base.

La hoja de cálculo es la herramienta para determinar económicamente **cuánto
podemos ofrecer dentro del plan de $99**. Reglas:

- Los precios de las APIs **no se inventan**: al llegar a esa fase se
  utilizarán los precios oficiales vigentes de OpenAI y Anthropic para
  alimentar el simulador.
- El simulador **no se implementa dentro de Evalúa Fácil**.

## Separación de responsabilidades (definida 9-ago-2026)

| Pieza | Responsabilidad |
|-------|-----------------|
| **Claude Code** | Diseño, documentación, arquitectura e implementación de Evalúa Fácil |
| **Google Sheets** (simulador) | Simulación económica: costos de IA, créditos y rentabilidad, para la gestión interna de Kike |
| **Evalúa Fácil** | Aplicación de los créditos y límites definidos a los docentes |

El docente **nunca** verá tokens ni el costo real que Evalúa Fácil paga a los
proveedores. Solamente verá sus créditos IA disponibles y consumidos.

## Decisiones previas del proyecto que siguen vigentes (contexto)
- v1.0.1: solo transferencia; tarjeta/MP/PayPal/anual pausados hasta v1.0.2.
- Precio de lanzamiento $99 MXN/mes (normal de referencia: $116).
- El QR de autoservicio para unirse a clase fue decidido en contra (2-ago-2026).
- La recuperación de contraseña del alumno solo la habilita el maestro.

---

# DUDAS Y CONTRADICCIONES (TODAS RESUELTAS EL 9-AGO-2026)

Detectadas durante la auditoría y resueltas por Kike el 9-ago-2026. Se
conservan con su respuesta como registro de decisión.

### D1 — Los formatos oficiales de planeación NO están en el proyecto
La instrucción de la Fase 2 dice "toma como referencia los formatos oficiales
que ya existen en el proyecto", pero la búsqueda exhaustiva (código, docs y
archivos xlsx/docx/pdf del repo) no encontró ningún formato oficial de
planeación didáctica. **Bloquea la Fase 2.** Se necesita que Kike proporcione
los formatos institucionales de referencia (archivo, foto o enlace).

**Resuelta:** los formatos sí existen — son **tres PDF oficiales de Planeación
Didáctica** que Kike va a proporcionar. Se usarán únicamente como referencia
de los requisitos institucionales que Evalúa Fácil debe poder generar
posteriormente; su complejidad NO se traslada a la experiencia del docente
(Planeación Viva = sencilla para el docente; Planeación Oficial = salida
generada por Evalúa Fácil conservando el formato y la información que las
escuelas solicitan). **La Fase 2 no avanza hasta tener los tres archivos.**
*Actualización: los tres archivos fueron entregados y analizados el
9-ago-2026 — ver la sección Fase 2 (§2.1).*

### D2 — Modelo comercial de la IA: la decisión previa vs. las instrucciones nuevas
`docs/VENTAJAS_COMPETITIVAS.md` registra la postura previa: *"[la IA] va como
complemento aparte en 2027, no dentro del plan de $116"* (y el plan de precios
anterior la ubicaba como complemento de pago separado). Las instrucciones
nuevas hablan de créditos IA dentro de un "Plan Docente" y de medir la
sostenibilidad **del plan de $99**. Entiendo que las instrucciones nuevas
sustituyen a la postura anterior, pero es un cambio de modelo comercial que no
puedo asumir. **Bloquea las fases 5 y 6.** Preguntas concretas:
1. ¿Los créditos IA van incluidos en el plan actual ($99/mes) o la IA se
   mantiene como complemento/plan aparte?
2. Para el simulador de rentabilidad, ¿el precio base de análisis es el $99 de
   lanzamiento, el $116 normal, o ambos escenarios?

**Resuelta:** las instrucciones nuevas SUSTITUYEN cualquier decisión anterior
que contradiga este modelo. La IA forma parte del Plan Docente de $99 MXN; el
análisis se hace sobre $99 (no $116); planes para mayor consumo se analizarán
después como adicionales. Registrado en "Modelo comercial de la IA".

### D3 — Conservación indefinida vs. los "90 días" que hoy ve el usuario
La decisión nueva es conservar la información de forma indefinida. Pero hoy el
producto **le dice al docente lo contrario**: los avisos de vencimiento dicen
"tu información sigue segura — la guardamos 90 días", hay correos de retención
a los 60/83 días, `RETENTION_DAYS = 90` en código, y la declaración de
seguridad de datos de Play Store menciona esa retención. (El borrado nunca se
ha ejecutado en automático.) Entiendo que la decisión nueva rige y que habrá
que actualizar textos, correos y declaración de Play Store en su momento.
**Confirmar antes de la Fase 8.**

**Resuelta:** confirmado. La conservación indefinida sustituye la política de
90 días; la información no se elimina por fin de trial, fin o cancelación de
suscripción, ni por inactividad de meses o años. Solo la elimina una acción
explícita del propio usuario. Los textos, avisos, correos, políticas y la
declaración de Play Store se actualizarán en su momento. Registrado en
"Datos y continuidad".

### D4 — Alcance exacto del bloqueo de descargas en trial
Hoy el trial SÍ puede exportar (con marca de agua). La decisión nueva lo
prohíbe — registrado. Falta definir la frontera para dos casos que no son
"reportes":
1. El **PDF de credenciales de acceso de los alumnos** (la lista con usuario y
   código para que el grupo se active). Si el trial no puede descargarlo, el
   docente en prueba tendría que dictar los accesos de otra forma.
2. El **ZIP de entregas** (evidencias de los alumnos) al archivar.
¿Estos dos también quedan bloqueados durante el trial, o el bloqueo aplica
solo a los documentos de salida (calificaciones, asistencia, ranking,
resultados de evaluación, planeación oficial)? **Bloquea el detalle de la
Fase 10** (no bloquea las fases 2–4).

**Resuelta (y ampliada con la aclaración fundamental del trial):** el trial
NO es una versión limitada — el docente usa prácticamente toda la plataforma,
incluidas las funciones de IA según sus créditos. El bloqueo aplica a la
salida de información fuera de Evalúa Fácil: Excel, PDF de trabajo, reportes,
Planeación Oficial, ZIP de evidencias y respaldo. El PDF de credenciales de
acceso de los estudiantes SÍ está disponible en trial (función operativa, no
exportación comercial). Registrado en "Alcance del bloqueo en trial".

### Nota (no es duda): simulador externo
`Simulador_Costos_IA_Evalua_Facil.xlsx` no está en el repositorio; es la
herramienta de gestión interna de Kike para Google Sheets y **no forma parte
del producto**. Kike proporcionará el enlace o los datos al llegar a la
Fase 6. *(Registrada como decisión completa en "Herramienta interna de
costos y rentabilidad de IA", sección de decisiones.)*

---

# FASES SIGUIENTES (alcance definido por Kike — pendientes de iniciar)

Cada fase inicia solo con autorización expresa. Lo que sigue registra el
alcance que Kike definió, más las notas de auditoría que le sirven de insumo.
**Nada de esto está diseñado todavía.**

## Fase 2 — Planeación didáctica
Definición de Kike:
- La Planeación Didáctica será una **entidad viva** que abarca toda la
  asignatura y todo el semestre, incluyendo todos los parciales.
- Separación entre **Planeación Viva** (sencilla, para el trabajo cotidiano)
  y **Planeación Oficial** (documento generado por Evalúa Fácil para cumplir
  formatos institucionales).
- El docente no captura dos veces la misma información; lo común se reutiliza
  automáticamente.
- Conservar la información que las escuelas requieren sin trasladar al
  docente la carga burocrática de los formatos.

Insumos que la auditoría deja listos: la plataforma ya conoce asignatura,
grupo, escuela (con CCT), docente (con título), semestre con fechas por
parcial, días hábiles reales (horario + asuetos + vacaciones), actividades y
evaluaciones con ponderaciones.

**Cierre:** los tres PDF oficiales fueron analizados (§2.1–§2.9), P1–P5
resueltas (§2.10), el diseño conceptual entregado (§2.11) y Q1–Q2
confirmadas (§2.11.11). **Fase aprobada y cerrada por Kike el 9-ago-2026.**
La implementación de todo esto pertenece a la Fase 11.

## Fase 3 — Operaciones de IA
Inventario completo de operaciones donde la IA aporta valor, surgido del
análisis real del proyecto. Mínimo a analizar (lista de Kike): analizar
documentos, generar Planeación Didáctica 1.0, modificar Planeación, crear
actividades, crear exámenes, crear cuestionarios, crear rúbricas, crear
listas de cotejo, crear guías de observación, generar instrucciones, generar
reactivos, generar retroalimentación personalizada, generar planeaciones
sencillas.

Notas de auditoría para esta fase (hechos, no decisiones): los instrumentos
que la plataforma ya modela son actividades (4 categorías), reactivos (4
tipos con retroalimentación y secciones), rúbricas y listas de cotejo (modelo
niveles × criterios con pesos que suman 10) y banco de reactivos. Las "guías
de observación" no existen hoy como instrumento (solo la categoría de
actividad "observación"). La retroalimentación personalizada puede apoyarse
en datos que ya existen por alumno (respuestas por reactivo, historial de
entregas, asistencia).

## Fase 4 — Prompts y modelos
Para cada operación: contexto que recibirá, información específica que
necesita, resultado esperado, prompt y modelo recomendado. La Planeación
Didáctica 1.0 se analiza especialmente por compleja y extensa; **Claude se
evalúa para la generación inicial de la Planeación**; modificaciones pequeñas
y operaciones frecuentes pueden usar OpenAI u otro modelo si dan mejor
relación calidad/costo. Sin atadura conceptual a un solo proveedor.

## Fase 5 — Créditos IA
Sistema de créditos comprensible para el docente. El docente **nunca ve
tokens**; ve algo como "Plan Docente · 500 créditos IA mensuales · Te quedan
382". Cada operación tiene costo en créditos. El costo en créditos no tiene
que ser proporcional al costo en tokens: también pondera el valor recibido y
el ahorro de tiempo. D2 resuelta: los créditos van dentro del Plan Docente de
$99 MXN mensuales.

## Fase 6 — Rentabilidad
Modelo para un simulador que muestre: tokens consumidos, costo real en MXN,
costo por operación, créditos asignados, consumo mensual por docente,
escenarios bajo/medio/alto, margen disponible con el plan de $99, punto en el
que conviene un segundo plan y punto en el que conviene un tercero. Objetivo:
determinar si el plan de $99 MXN mensuales es sostenible. El simulador externo
(`Simulador_Costos_IA_Evalua_Facil.xlsx`, en Google Sheets) es de gestión
interna de Kike; él dará el enlace o los datos en esta fase. D2 resuelta: el
precio base del análisis es $99 MXN mensuales (no usar $116). El alcance
completo del simulador y sus reglas están registrados en la decisión
"Herramienta interna de costos y rentabilidad de IA" (los precios de las
APIs no se inventan: se usarán los oficiales vigentes de OpenAI y
Anthropic).

## Fases 7, 8 y 10 — Trial, datos y exportaciones
Las decisiones ya están tomadas y registradas arriba (D3 y D4 resueltas).
El trabajo pendiente de estas fases es integrarlas al diseño. Cambios
respecto al comportamiento actual que la auditoría deja identificados:
- Hoy el trial exporta con marca de agua → pasará al bloqueo definido en
  "Alcance del bloqueo en trial" (salida de información bloqueada; PDF de
  credenciales permitido).
- Hoy el copy y Play Store hablan de 90 días de retención → pasará a
  conservación indefinida; habrá que actualizar textos, avisos, correos,
  políticas y la declaración de Play Store.

## Fase 9 — Respaldo y recuperación
Respaldo restaurable dentro de Evalúa Fácil según las decisiones registradas
arriba (qué contiene, qué no, y el registro de continuidad anti-reinicio de
beneficios). Nota de auditoría: hoy no existe nada parecido (solo el ZIP de
entregas al archivar, que es descarga sin restauración); el registro de
continuidad es pieza nueva.

## Fase 11 — Arquitectura e implementación
Solo tras aprobar todo lo anterior. Diseño técnico y luego implementación paso
a paso; después de cada bloque: verificar, probar, informar qué cambió y qué
falta, y detenerse a esperar autorización. Restricciones ya conocidas que el
diseño deberá resolver: tope de funciones Vercel (11/12), dónde vive la clave
de API de IA (nunca en el cliente — todas las llamadas a modelos tendrán que
pasar por servidor), R21 (qué ve el alumno lo decide hoy el navegador), y el
candado de suscripción de dos capas.

---

# BITÁCORA

| Fecha | Evento |
|-------|--------|
| 9-ago-2026 | Se crea el documento. Fase 1 (auditoría) realizada y entregada para revisión. Dudas D1–D4 abiertas. |
| 9-ago-2026 | Kike resuelve D1–D4 y aprueba las decisiones. Aclaración fundamental del trial: plataforma completa (incluida IA según créditos), bloqueo solo a la salida de información. Fase 1 aprobada. Fase 2 autorizada, bloqueada en espera de los tres PDF oficiales de Planeación Didáctica. |
| 9-ago-2026 | Kike entrega los tres PDF oficiales (portal SEMS, uno por parcial). Se analizan a fondo y se documenta el inventario completo de campos en la sección Fase 2 (§2.1–§2.9). Quedan abiertas las decisiones P1–P5 (§2.10). El diseño de la solución NO inicia hasta resolverlas. |
| 9-ago-2026 | Kike resuelve P1–P5 y define la ubicación de la IA en la interfaz (perfil IA global en el Perfil del docente; pestaña IA por asignatura; contexto en capas sin re-preguntar). Se entrega el diseño conceptual de la Planeación Didáctica (§2.11) con puntos abiertos Q1–Q2. En revisión de Kike. |
| 9-ago-2026 | **Kike aprueba la Fase 2** y confirma Q1–Q2 (Planeación Viva en la pestaña IA de cada asignatura, sin pestaña independiente; los campos del Perfil IA se definen en fases 3–4). Se registran la herramienta interna de costos (`Simulador_Costos_IA_Evalua_Facil.xlsx` en Google Sheets) y la separación de responsabilidades Claude Code / Google Sheets / Evalúa Fácil. **Fase 2 CERRADA.** Fase 3 en espera de autorización. |
