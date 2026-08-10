# PLAN MAESTRO DE INTEGRACIÓN DE IA — EVALÚA FÁCIL

**Documento único y vivo.** Toda la hoja de ruta de la integración de IA vive aquí.
No se crean documentos paralelos; cada fase actualiza este mismo archivo.

- **Creado:** 9 de agosto de 2026
- **Última actualización:** 9 de agosto de 2026 — Fases 1–4 cerradas.
  Arquitectura D aprobada y **tokens de OP-01/OP-02 actualizados** en las
  tablas (escenarios PLAN·5F y PLAN·10F separados). Modelos provisionales
  (M3 abierta), consumo ARRANQUE + RECURRENTE. Fase 5 bloqueada hasta el
  análisis económico.
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
| 2 | Planeación didáctica | **Aprobada y cerrada** (9-ago-2026) — diseño conceptual en §2.11; Q1–Q2 confirmadas. **Precisada el 10-ago-2026**: §2.11.6 aclara que sus capas son contexto, no fuente de origen |
| 3 | Operaciones de IA | **Aprobada y cerrada** (9-ago-2026) — 17 operaciones en alcance; O1–O4 resueltas. **Precisada el 10-ago-2026**: se agregan dos reglas transversales (fuente inmediata; una propuesta de IA no asciende a fuente curricular). Alcance sin cambios |
| 4 | Prompts y modelos | **Aprobada y cerrada** (9-ago-2026) — M1/M2/M4 aprobadas; M3 = candidatos de trabajo, decisión final tras el análisis económico. **Precisada el 10-ago-2026** por la regla transversal de fuente inmediata (§4.3, fichas OP-06/07/08/09 y tabla de tokens): no reabre la fase ni cambia valores |
| 5 | Créditos IA | **En curso** — prerequisito cumplido (análisis económico y pruebas reales hechos); propuesta inicial v1 entregada, **en revisión de Kike** |
| 6 | Rentabilidad | No iniciada — requiere el simulador externo con precios oficiales vigentes |
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

**Precisión obligatoria (aprobada el 10-ago-2026 — ver la sección "REGLA
TRANSVERSAL — FUENTE INMEDIATA VS. CONTEXTO CURRICULAR"):** estas capas son
**contexto**, no fuente de origen. Que una operación reciba la Planeación
Viva NO significa que la Planeación pueda originar los elementos que esa
operación genera. Cada operación declara además su **fuente inmediata** —la
única que determina qué elementos existen— y el contexto de estas capas solo
sirve para contextualizar, comprobar alineación, aportar terminología
curricular válida y detectar inconsistencias.

El caso que hace obvia la diferencia: una rúbrica de un entregable recibe la
Planeación como contexto, pero sus criterios salen **exclusivamente** de lo
que el entregable solicita. Un criterio que solo se justifique en la
planeación o en el programa, y no en la actividad, no entra en la rúbrica.

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

# REGLA TRANSVERSAL — FUENTE INMEDIATA VS. CONTEXTO CURRICULAR (APROBADA el 10-ago-2026)

Esta regla gobierna **todas** las operaciones de IA pedagógica del producto.
Precisa —sin derogar— el contexto en capas de §2.11.6 y las fichas de la
Fase 4: aquellas dicen QUÉ información acompaña a una operación; esta dice
CUÁL de esa información puede ORIGINAR contenido.

## T.1 Las dos clases de fuente

Toda operación de IA pedagógica distingue dos cosas que hasta ahora se
nombraban igual ("contexto"):

1. **FUENTE INMEDIATA** — la fuente que determina **qué elementos pueden
   generarse**. Es única por operación y es obligatoria.
2. **CONTEXTO CURRICULAR** — información que sirve para **contextualizar,
   comprobar alineación, identificar el aprendizaje relacionado, aportar
   terminología curricular válida y detectar inconsistencias**.

**El contexto curricular NO puede introducir elementos que la fuente
inmediata no origine.**

Invariante verificable que se desprende de lo anterior:

> Todo elemento generado debe poder rastrearse a la fuente inmediata. El
> contexto curricular puede cambiar **cómo se dice** un elemento; nunca **si
> existe**. Si se retirara el contexto curricular de una operación, la LISTA
> de elementos generados debería ser la misma; solo cambiarían su redacción
> y su información de alineación.

Corolario importante: cuando el contexto curricular detecta que la fuente
inmediata no da para cubrir el aprendizaje esperado, lo correcto es
**informarlo al docente**, no completar el elemento generado con lo que falta.
Una rúbrica no es el lugar para corregir una actividad desalineada; el lugar
es la actividad.

## T.2 Universo Curricular y Planeación Didáctica no son lo mismo

| Entidad | Qué representa |
|---------|----------------|
| **Fuentes curriculares** | Los documentos aportados y analizados (programa de estudios y apoyos — OP-01) |
| **Universo Curricular** | El **marco curricular validado** que resulta de esas fuentes |
| **Planeación Didáctica Inicial** | La **selección, organización y decisión pedagógica** del docente sobre lo que realmente trabajará |
| **Planeación Didáctica Viva** | Esa planeación mantenida al día contra la realidad del curso (§2.11) |

La cadena conceptual es:

```
FUENTES CURRICULARES → UNIVERSO CURRICULAR → PLANEACIÓN DIDÁCTICA INICIAL
                     → PLANEACIÓN DIDÁCTICA VIVA → ACTIVIDAD
```

El Universo Curricular **no sustituye** a la Planeación ni es una segunda
Planeación: el Universo es el marco disponible; la Planeación es lo que el
docente decidió hacer con él.

## T.3 Jerarquía de fuentes (A–E)

| Nivel | Qué es | Quién lo produce | Qué puede originar |
|-------|--------|------------------|--------------------|
| **A** | Fuente curricular validada | Documento oficial + validación del docente | Contenido curricular |
| **B** | Planeación del docente | Decisión del docente sobre A | Intención pedagógica |
| **C** | Actividad concreta | El docente | Lo que se solicita u observa |
| **D** | Elemento de evaluación | Derivado de C | Criterios, indicadores, reactivos |
| **E** | Propuesta de IA | El modelo | **Nada** mientras el docente no la acepte |

Reglas de dirección:

- **E nunca asciende automáticamente a A ni a B.** Un elemento propuesto por
  IA y aceptado por el docente es B (decisión del docente), **nunca A** — el
  nivel A solo nace de una fuente documental validada.
- **Una propuesta de IA no se convierte en fuente curricular por haber sido
  aceptada o guardada.** Sin esta regla el sistema termina alimentándose de
  sí mismo y deja de poder distinguir qué venía del programa oficial.
- **D se deriva de C. C se apoya en B. B selecciona de A.**
- **Un elemento de D no puede saltarse C para justificarse directamente en
  A**: si un criterio invoca una competencia, debe existir algo en la
  actividad que la ponga en juego.

## T.4 Relaciones de actividad

```
ENTREGABLE               → RÚBRICA / LISTA DE COTEJO → EVIDENCIA    → CALIFICACIÓN
ACTIVIDAD DE OBSERVACIÓN → RÚBRICA / LISTA DE COTEJO → OBSERVACIÓN  → CALIFICACIÓN
CUESTIONARIO / EXAMEN    → REACTIVOS                 → RESPUESTAS   → CALIFICACIÓN
```

## T.5 Regla para rúbricas y listas de cotejo

Una rúbrica o lista de cotejo generada con IA **requiere obligatoriamente**
una actividad padre, que solo puede ser:

- un **Entregable**, o
- una **Actividad de Observación**.

**La fuente inmediata es siempre la actividad padre.** No existe la
generación de una rúbrica como operación aislada: el banco de rúbricas
permite crear a mano y reutilizar, pero no generar con IA, porque ahí no hay
actividad de la cual derivar los criterios.

El Universo Curricular y la Planeación pueden aportar contexto y validación
de alineación, pero **no pueden agregar criterios que la actividad padre no
solicite**. Si un criterio no se justifica desde la actividad padre, no
aparece en el instrumento aunque exista en el currículo.

## T.6 Regla para reactivos

Los reactivos generados con IA pertenecen a un cuestionario o examen
concreto. **La evaluación padre es la fuente inmediata.** El contexto
curricular puede validar y contextualizar, pero no puede introducir
contenidos que el cuestionario o examen no pretenda evaluar.

## T.7 Regla de no invención

Cuando falte información:

- no inventar;
- no completar silenciosamente;
- no convertir conocimiento general del modelo en contenido curricular;
- **informar al docente qué falta**, para que él lo complete y reintente.

## T.8 Trazabilidad

Cuando exista generación con IA debe poder reconstruirse, según corresponda:

```
Fuente curricular → Universo Curricular → Planeación → Actividad
                  → Elemento generado → Operación de IA
```

Para **rúbricas y listas de cotejo** debe conservarse, como mínimo:

- la **actividad padre**;
- la **versión del marco curricular** utilizado, cuando corresponda;
- la **procedencia de los criterios**;
- si el **docente modificó la propuesta** antes de guardarla.

Esta trazabilidad vive junto al instrumento de la actividad. **El esquema de
`bancoRubricas` NO se modifica en esta fase.**

## T.9 Matriz de operaciones bajo esta regla

Registro de referencia; no modifica el alcance aprobado de la Fase 3.
"Contexto" = puede contextualizar y validar, nunca originar.

| Operación | Fuente inmediata | Universo Curricular | Planeación | Actividad padre |
|-----------|------------------|---------------------|------------|-----------------|
| Actividad Entregable (OP-05) | Petición del docente + parcial | Contexto | **Origina intención** | — (es la actividad) |
| Actividad de Observación (OP-05) | Petición del docente + parcial | Contexto | **Origina intención** | — (es la actividad) |
| Cuestionario (OP-04) | Petición + alcance a evaluar | Contexto | Contexto | — |
| Examen (OP-03) | Petición + alcance a evaluar | Contexto | Contexto | — |
| Reactivos (OP-09) | **Cuestionario / Examen** | Contexto | Contexto | Sí (la evaluación) |
| **Rúbrica (OP-06)** | **Entregable u Observación** | Contexto | Contexto | **Sí, obligatoria** |
| **Lista de cotejo (OP-07)** | **Entregable u Observación** | Contexto | Contexto | **Sí, obligatoria** |
| Guía de observación (OP-08) | Actividad de observación | Contexto | Contexto | Sí |
| Calificación de respuesta abierta (C-02) | Pregunta + criterios + respuesta del alumno | Opcional | Opcional | Sí (la evaluación) |
| Calificación de evidencia | Entregable + instrumento + evidencia | Opcional | Opcional | Sí |
| Planeación Didáctica Inicial (OP-02) | **Fuentes curriculares validadas** | **Es su fuente** | — (es ella) | — |
| Planeación Didáctica Viva (OP-11) | Planeación Inicial + realidad del curso | Marco | — (es ella) | — |

Qué debe validarse y trazarse en cada caso:

| Operación | Debe validarse | Debe trazarse |
|-----------|----------------|---------------|
| Entregable / Observación | Parcial válido; la asignatura es del docente | Planeación usada y su versión; si nació de IA |
| Cuestionario / Examen | Ídem | Ídem |
| Reactivos | La evaluación es del docente; tipo soportado; clave coherente | Evaluación padre; identificadores curriculares; si el docente editó |
| **Rúbrica / Lista de cotejo** | **Actividad padre existe, es del docente y es entregable u observación**; contexto suficiente; **cada criterio anclado a la actividad**; identificadores curriculares existentes; estructura válida del instrumento | **Actividad padre**; versión del marco curricular; procedencia por criterio; si el docente editó antes de guardar |
| Calificación de respuesta abierta | Actividad del docente; respuesta pendiente; candado por respuesta | Consumo, modelo, estado y sugerencia persistida |
| Calificación de evidencia | Instrumento presente; evidencia entregada | Instrumento usado y su versión |
| Planeación Inicial | **Fuentes validadas por el docente**; tope de fuentes por asignatura; ningún elemento de nivel A generado por IA | Fuentes que la originaron; qué validó el docente |
| Planeación Viva | Los cambios NO alteran calificaciones ya dadas | Historial de cambios; elementos derivados que quedaron desalineados |

### Entidades aún no definidas

**Diagnóstico académico** y **diagnóstico de contexto** no existen hoy ni
como entidad ni como operación aprobada (§1.2: un diagnóstico solo existe
como evaluación `sinCalificacion`). No se les asignan fuentes en esta matriz
porque definirlos es trabajo de producto, no de arquitectura.

**Calificación de evidencia** aparece en la matriz como relación, no como
operación aprobada: la operación más cercana del inventario es OP-12
(retroalimentación personalizada). Convertirla en operación propia sería
alcance nuevo.

## T.10 Efecto sobre lo ya aprobado

Esta regla **no deroga nada** de las fases 2, 3 y 4: precisa cómo leerlas.
Las secciones ajustadas en consecuencia el 10-ago-2026 son §2.11.6, las
reglas transversales de la Fase 3, §4.3, las fichas de OP-06/OP-07/OP-08/
OP-09 en §4.5 y la tabla de estimación de tokens. Ninguna decisión aprobada
se eliminó.

---

# FASE 3 — OPERACIONES DE IA · INVENTARIO (APROBADO Y CERRADO el 9-ago-2026)

Inventario elaborado el 9-ago-2026 a partir de: (1) la lista mínima definida
por Kike (13 operaciones), (2) el inventario real de datos y funciones de la
Fase 1, y (3) el diseño de la Planeación Viva de la Fase 2. Cada operación
está anclada a un módulo que ya existe en el producto. **Aprobado por Kike el
9-ago-2026 con O1–O4 resueltas (§3.5): el alcance queda en 17 operaciones
(OP-01 a OP-13 + C-01 a C-04).**

**Qué NO incluye esta fase** (por instrucción de Kike): prompts definitivos,
elección de modelos, costos y créditos — eso pertenece a las fases 4, 5 y 6.

**Reglas transversales de todas las operaciones:**
- La IA **propone**; el docente siempre revisa y decide. Nada se publica, se
  envía a alumnos ni se califica sin acción explícita del docente.
- Toda operación usa el contexto en capas de §2.11.6 (perfil IA → asignatura
  con su Planeación Viva → parcial → petición) y **jamás pregunta lo que
  Evalúa Fácil ya sabe**.
- **Toda operación declara además su FUENTE INMEDIATA** — la única fuente que
  puede originar los elementos que genera— y la distingue del contexto
  curricular, que solo contextualiza y valida (regla transversal aprobada el
  10-ago-2026). El contexto curricular nunca agrega elementos que la fuente
  inmediata no origine.
- **Una propuesta de IA no se convierte en fuente curricular** por haber sido
  aceptada o guardada por el docente.
- **La pestaña IA es la casa central; la IA también aparece donde el docente
  la necesita** (O4): las operaciones pueden invocarse desde su punto natural
  de uso (al calificar, al editar una actividad, en resultados, al redactar
  un aviso) sin obligar al docente a abandonar la pantalla donde trabaja.
- En trial, las operaciones están disponibles según los créditos del docente
  (decisión ya registrada).

## 3.1 Las tres familias (naturaleza y frecuencia, no costos)

| Familia | Naturaleza | Frecuencia esperada |
|---------|-----------|---------------------|
| **A — Generaciones mayores** | Resultado extenso y fundacional | Pocas veces por semestre |
| **B — Creaciones puntuales** | Un instrumento o pieza completa | Varias veces por parcial |
| **C — Asistencia continua** | Ajustes y redacciones pequeñas | El día a día |
| **Transversal** | Convierte documentos en contexto | Cuando el docente aporta material |

La familia describe la naturaleza de cada operación para las fases
siguientes; **no asigna costos ni créditos** (fases 5–6).

## 3.2 Tabla maestra

| Id | Operación | Familia | Ancla real en el producto |
|----|-----------|---------|---------------------------|
| OP-01 | Analizar documentos | Transversal | Subida de archivos (Cloudinary), recursos y materiales |
| OP-02 | Generar Planeación Didáctica 1.0 | A | Pestaña IA · diseño §2.11 |
| OP-03 | Crear examen completo | A | `EvaluacionEditor` + subcolecciones `preguntas`/`clave` |
| OP-04 | Crear cuestionario completo | A | Ídem, con configuración de cuestionario |
| OP-05 | Crear actividad | B | Creación de actividad en la asignatura |
| OP-06 | Crear rúbrica | B | Editor de rúbricas + `bancoRubricas` |
| OP-07 | Crear lista de cotejo | B | Ídem (rúbrica de un nivel) |
| OP-08 | Crear guía de observación | B | Contenido IA en la actividad de observación (O1) — sin instrumento nuevo |
| OP-09 | Generar reactivos | B | `bancoReactivos` + `EvaluacionEditor` |
| OP-10 | Generar instrucciones | B | Editor de instrucciones de la actividad |
| OP-11 | Modificar Planeación | C | Pestaña IA · §2.11.5 |
| OP-12 | Retroalimentación personalizada | C | Flujo de calificación (comentarios por entrega y por pregunta) |
| OP-13 | Generar planeaciones sencillas | C | Plan de clase/sesión ligero (O2) — preparar una clase concreta |

## 3.3 Fichas del inventario

### Transversal

**OP-01 · Analizar documentos.** El docente aporta un documento (programa de
estudios oficial, temario, material propio) y la IA extrae y entiende su
contenido para usarlo como contexto de otras operaciones: la Planeación 1.0
(OP-02), reactivos desde material (OP-09), actividades alineadas al programa
(OP-05). Aprovecha la subida de archivos que ya existe. Resultado: el
documento queda entendido y disponible como contexto de la asignatura.
*Nota:* analizar entregas de alumnos NO es esta operación — es la candidata
C-02.

### Familia A — Generaciones mayores

**OP-02 · Generar Planeación Didáctica 1.0.** La operación fundacional:
genera la Planeación Viva completa (tronco de asignatura + bloques por
parcial) conforme al diseño aprobado en §2.11, con el flujo de 4 pasos de
§2.11.4. Aprovecha todo el contexto disponible y, si existe, el programa de
estudios analizado (OP-01). Decisión ya tomada: Claude se evalúa para esta
generación (Fase 4 la analiza especialmente).

**OP-03 · Crear examen completo.** Genera una evaluación tipo examen lista
para revisar: reactivos (los 4 tipos que el producto modela), opciones,
clave de respuestas, retroalimentación por pregunta, secciones si aplica,
ponderación de reactivos (suma 10) y configuración sugerida (tiempo límite,
intentos). Aprovecha: contenidos y aprendizaje esperado del parcial (de la
Planeación Viva), el banco de reactivos del docente (para reutilizar y no
repetir), y las evaluaciones previas de la asignatura.

**OP-04 · Crear cuestionario completo.** Igual que OP-03 pero con la
naturaleza de cuestionario de práctica que el producto ya distingue
(navegación libre, varios intentos, retroalimentación inmediata).

### Familia B — Creaciones puntuales

**OP-05 · Crear actividad.** Propone una actividad alineada al parcial:
nombre, instrucciones en HTML, producto esperado, tipos de archivo
sugeridos y peso sugerido dentro de la ponderación del parcial (respetando
que los pesos suman 10). Aprovecha: la Planeación Viva del parcial, las
actividades ya existentes (para no duplicar) y el calendario real.

**OP-06 · Crear rúbrica.** Genera una rúbrica con el modelo exacto del
producto (niveles 3–5 con el primero al 100%, criterios 2–6 con pesos que
suman 10, descriptores por celda) a partir de las instrucciones de una
actividad o de una descripción breve. Se guarda en el banco de rúbricas y/o
como snapshot en la actividad, igual que hoy.

**OP-07 · Crear lista de cotejo.** Variante de un nivel del mismo modelo
(como ya lo modela el producto), con pesos que suman exactamente 10.

**OP-08 · Crear guía de observación.** Resuelto por O1: **NO se crea por
ahora un instrumento nuevo** en el producto (ni editor nuevo ni banco de
instrumentos nuevo). La IA genera la guía como **contenido asociado a una
actividad de observación**, utilizando la estructura y los datos que ya
existen (la categoría "observación" sigue calificándose con rúbrica o lista
de cotejo).

**OP-09 · Generar reactivos.** Reactivos sueltos (opción múltiple,
verdadero/falso, respuesta corta, subir archivo) con su clave y
retroalimentación, hacia el banco de reactivos o hacia una evaluación
existente. Puede partir de un tema, de los contenidos del parcial o de un
documento analizado (OP-01). Aprovecha la clasificación por materia y tema
del banco.

**OP-10 · Generar instrucciones.** Redacta o mejora las instrucciones de una
actividad: claridad, pasos, criterios de entrega, tono apropiado para el
grupo. Opera sobre el editor enriquecido que ya existe.

### Familia C — Asistencia continua

**OP-11 · Modificar Planeación.** Ajustes pequeños y frecuentes sobre la
Planeación Viva: "pon al día las narrativas del parcial 2 con mis
actividades reales", "cambia el producto esperado", "ajusta los contenidos".
Es la operación de mantenimiento definida en §2.11.5 — pensada como pequeña
para que mantener la planeación viva no cueste caro.

**OP-12 · Retroalimentación personalizada.** Redacta la retroalimentación
para un alumno concreto a partir de lo que la plataforma ya sabe de él: su
entrega, la rúbrica evaluada, sus respuestas por reactivo, su historial de
entregas y su asistencia. El resultado llega como borrador al comentario de
calificación (por entrega o por pregunta); el docente edita y decide.

**OP-13 · Generar planeaciones sencillas.** Alcance definido por O2: un
**plan de clase o sesión ligero y práctico**, cuyo propósito es ayudar al
docente a preparar una clase concreta. Utiliza el contexto que Evalúa Fácil
ya conoce, incluyendo cuando corresponda: asignatura, parcial, tema o
contenido, horario real, duración de la sesión, actividades existentes y
Planeación Viva. **NO se convierte en otra Planeación Didáctica oficial ni
en una versión reducida burocrática del formato institucional.**

## 3.4 Candidatas surgidas del análisis real del producto

Estas NO estaban en la lista mínima; surgen de módulos y datos que ya
existen. **Aprobadas por Kike el 9-ago-2026 (O3): las cuatro entran al
alcance del proyecto.**

**C-01 · Analizar resultados de una evaluación.** El producto ya calcula
estadísticas por reactivo, gráficas de pastel y panel de resumen; la IA las
interpreta para el docente: qué temas fallaron, qué reactivos parecen mal
planteados, qué conviene repasar. Explotaría también lo "preparado, no
construido": las estadísticas por sección.

**C-02 · Sugerir calificación de respuestas abiertas.** Para las respuestas
cortas y entregas de archivo pendientes de revisión manual: la IA sugiere
puntos y comentario contra la clave y los criterios; el docente confirma o
corrige. Se ancla al flujo `pendienteRevision` que ya existe.
**Regla especial (O3):** la IA únicamente puede **sugerir** una calificación
y justificarla — NUNCA asigna ni guarda automáticamente la calificación
definitiva. La decisión final siempre corresponde al docente.

**C-03 · Redactar avisos.** Redacta el mensaje de un aviso según su tipo (los
12 que ya existen) y el contexto del grupo; se integra con las plantillas
personales de avisos.

**C-04 · Resumen de desempeño (alumno o grupo).** Texto breve de cómo va un
alumno o el grupo en el parcial (calificaciones + asistencia + entregas ya
calculadas), útil para juntas, tutores o como base de la retroalimentación.

## 3.5 Decisiones O1–O4 (RESUELTAS por Kike el 9-ago-2026)

- **O1 — Guía de observación. Resuelta:** NO se crea por ahora un instrumento
  nuevo dentro del producto. La IA genera la guía como contenido asociado a
  una actividad de observación, utilizando la estructura y los datos que ya
  existen. Sin editor nuevo y sin banco de instrumentos nuevo en esta fase.
- **O2 — Planeaciones sencillas. Resuelta:** el alcance es un **plan de clase
  o sesión ligero y práctico** para preparar una clase concreta, usando el
  contexto que Evalúa Fácil ya conoce cuando corresponda (asignatura,
  parcial, tema o contenido, horario real, duración de la sesión,
  actividades existentes, Planeación Viva). NO debe convertirse en otra
  Planeación Didáctica oficial ni en una versión reducida burocrática del
  formato institucional.
- **O3 — Candidatas. Resuelta:** entran las cuatro (C-01, C-02, C-03 y
  C-04). Regla especial para C-02: la IA únicamente puede sugerir una
  calificación y justificarla; NUNCA asigna ni guarda automáticamente la
  calificación definitiva — la decisión final siempre corresponde al
  docente.
- **O4 — Invocación en el punto de uso. Resuelta:** sí. La pestaña IA de cada
  asignatura sigue siendo la casa central de las operaciones de IA de esa
  asignatura, pero las operaciones deben poder invocarse también desde el
  punto de uso cuando tenga sentido: al calificar → retroalimentación con
  IA; al editar una actividad → mejorar instrucciones con IA; en resultados
  → interpretar resultados con IA; al redactar un aviso → redactar con IA.
  No se obliga al docente a abandonar la pantalla donde trabaja cuando la
  operación puede ejecutarse contextualmente. **Regla: la pestaña IA es la
  casa central; la IA también aparece donde el docente la necesita.**

---

# FASE 4 — PROMPTS Y MODELOS (APROBADA Y CERRADA el 9-ago-2026)

Elaborado el 9-ago-2026 para las 17 operaciones aprobadas en la Fase 3.
**Cerrada por Kike el mismo día con M1, M2 y M4 aprobadas; M3 queda como
candidatos técnicos de trabajo — ver §4.7.**
**Qué NO incluye** (por instrucción de Kike): costos de tokens, créditos IA,
límites de planes, implementación de APIs, programación. Los precios de las
APIs se cargarán en el simulador (Fase 6) desde las fuentes oficiales
vigentes de OpenAI y Anthropic — aquí los modelos se recomiendan por
capacidad y naturaleza de la operación, no por precio.

## 4.1 Principios de diseño de los prompts

1. **La IA propone, el docente decide.** Todos los prompts generan
   propuestas; ninguno publica, envía ni guarda calificaciones definitivas.
2. **Contexto en capas serializado en bloques estándar** (§4.3): los mismos
   bloques se reutilizan en todas las operaciones. Nada que Evalúa Fácil ya
   sabe se le pregunta al docente — se inyecta en el contexto.
3. **Salida estructurada para todo lo que se convierte en entidad del
   producto** (bloques de planeación, actividades, reactivos, rúbricas,
   guías): la IA responde con JSON conforme a un esquema que espeja el
   modelo real de Firestore, y el producto lo valida (p. ej. que los pesos
   sumen exactamente 10) antes de crear el borrador. Las operaciones
   conversacionales (retroalimentación, avisos, interpretaciones) responden
   en texto. Los esquemas definitivos se afinan contra los modelos reales en
   la Fase 11.
4. **Los cálculos los hace Evalúa Fácil, la IA interpreta.** Promedios,
   porcentajes, estadísticas por reactivo y asistencia ya se calculan en la
   plataforma; a la IA se le entregan como datos, nunca se le pide
   calcularlos.
5. **Contexto estable primero, volátil al final.** Los bloques fijos de la
   asignatura van al inicio del prompt y la petición del docente al final —
   este orden permite aprovechar el caché de prompts de los proveedores
   (misma calidad, menor costo; la cuantificación es de la Fase 6).
6. **Prompts v1 en español.** Se afinarán con pruebas reales durante la
   implementación (Fase 11); cualquier cambio de fondo se consulta con Kike.
7. **La clave de API vive solo en el servidor** (restricción ya registrada
   en Fase 1): toda llamada a modelos pasa por backend, nunca por el
   cliente.

## 4.2 Los dos escalones de modelo

Cada operación declara **requisitos** (calidad, estructura, contexto), no un
proveedor — el modelo concreto se fija por configuración del servidor y puede
cambiarse sin tocar el producto (regla de no-atadura ya decidida por Kike).

**Resolución M3 (9-ago-2026): los modelos de esta tabla son ÚNICAMENTE
candidatos técnicos de trabajo — ningún proveedor ni modelo queda fijado como
definitivo.** La selección final se hará después de: (1) verificar modelos y
precios oficiales vigentes, (2) comparar calidad, (3) comparar consumo de
tokens, (4) comparar costo real por operación, (5) usar el simulador
económico externo, y (6) determinar la mejor relación calidad/costo POR
OPERACIÓN. OpenAI queda abierto cuando resulte técnica o económicamente
conveniente.

| Escalón | Para qué | Candidato primario | Alternativas |
|---------|----------|--------------------|--------------|
| **Mayor** | Generaciones extensas y estructuradas donde la calidad pedagógica y la fidelidad al esquema mandan (Familia A + análisis de documentos) | **Claude Sonnet 5** (`claude-sonnet-5`) | Claude Opus 5 como escalón superior a probar solo si las pruebas reales de la Planeación 1.0 lo exigieran |
| **Económico** | Operaciones frecuentes y acotadas del día a día (Familias B y C) | **Claude Haiku 4.5** (`claude-haiku-4-5`) | Equivalente económico de OpenAI, a evaluar en la Fase 6 con precios oficiales vigentes y en la Fase 11 con pruebas de calidad |

Por qué Claude Sonnet 5 como candidato del escalón Mayor: seguimiento
estricto de instrucciones y de esquemas de salida (crítico para estructuras
exactas como pesos que suman 10), redacción pedagógica de calidad en español,
lectura nativa de PDF (programas de estudio), salidas estructuradas
garantizadas por la API y ventana de contexto amplia. La validación
económica final de ambos escalones es de la Fase 6.

## 4.3 Bloques de contexto estándar

Definidos una sola vez; cada operación declara cuáles usa. Fuente: las
colecciones ya inventariadas en la Fase 1.

| Bloque | Contenido | Fuente |
|--------|-----------|--------|
| `[SISTEMA]` | Prompt base común (abajo) | Fijo |
| `[PERFIL_IA]` | Perfil IA global del docente (M1) | Perfil del docente |
| `[ASIGNATURA]` | Nombre, grupo, escuela, nivel, carrera/semestre, parciales con fechas, ponderación | `subjects`, `schools`, planeación |
| `[PLANEACION]` | Tronco de la Planeación Viva + bloque del parcial en curso (propósitos, aprendizaje esperado, contenidos, productos, competencias) | Planeación Viva |
| `[PARCIAL]` | Fechas, horas, actividades reales del parcial (nombre, tipo, instrumento, peso, estado) | `activities`, horario |
| `[ALUMNO]` | Solo cuando aplica: entrega, rúbrica evaluada, respuestas, historial, asistencia — del alumno concreto | `submissions`, `attendanceSummaries` |
| `[BANCO]` | Resumen del banco del docente (reactivos por tema / rúbricas), para reutilizar y no repetir | `bancoReactivos`, `bancoRubricas` |
| `[DOCUMENTO]` | Documento aportado por el docente (PDF/imagen) o su análisis previo (OP-01) | Cloudinary / análisis guardado |
| `[PETICION]` | Lo que el docente pide ahora, con sus opciones | El docente |
| `[FUENTE_INMEDIATA]` | **La fuente que ORIGINA lo generado** — declarada por cada operación (actividad padre, evaluación padre, fuentes validadas…). Ver la regla transversal | Según la operación |

**Cómo leer esta tabla (precisión del 10-ago-2026):** todos los bloques de
arriba, salvo `[FUENTE_INMEDIATA]`, son **contexto**. Sirven para
contextualizar, comprobar alineación, aportar terminología curricular válida
y detectar inconsistencias — **nunca para originar** elementos. El bloque
`[FUENTE_INMEDIATA]` es el único que determina qué elementos existen en la
salida, y toda operación pedagógica debe declararlo. Cuando `[PLANEACION]`
aparece en una operación cuya fuente inmediata es otra cosa (rúbricas,
cotejos, reactivos), entra **solo como contexto**.

**Prompt base `[SISTEMA]` (común a todas las operaciones), v1:**

> Eres el asistente pedagógico de Evalúa Fácil y trabajas dentro de la
> asignatura de un docente de bachillerato mexicano. Tu papel es PROPONER:
> el docente siempre revisa y decide. Usa exclusivamente la información del
> contexto; no inventes datos de la escuela, del grupo, de los alumnos ni
> del programa de estudios. Escribe en español, con lenguaje claro y
> profesional adecuado para bachillerato. Cuando la operación indique un
> esquema de salida, responde únicamente con el JSON válido de ese esquema,
> sin texto adicional.

## 4.4 Análisis especial: Planeación Didáctica 1.0 (OP-02)

**Por qué es la operación más exigente.** Es el resultado más extenso
(tronco + N bloques de parcial), con estructura estricta (el modelo de
§2.11), redacción pedagógica real (propósitos, narrativas de
Apertura/Desarrollo/Cierre), selección desde catálogos oficiales
(competencias, HSE) y, cuando existe, un programa de estudios en PDF como
insumo (OP-01). Además es la base de contexto de todas las demás
operaciones: si la Planeación sale mal, todo lo demás hereda el error.

**Estrategia de generación por etapas (M4 — APROBADA el 9-ago-2026):**

1. **Generación del tronco de la asignatura:** una llamada genera
   identificación complementaria, currículo común, recursos y referencias.
2. **Generación de cada bloque de parcial:** una llamada por parcial genera
   aprendizaje esperado, contenidos, productos, HSE, competencias del
   parcial y narrativas, usando el tronco ya validado como contexto.
3. **Validación de cada bloque:** el producto valida cada bloque contra el
   esquema y las reglas duras antes de aceptarlo; el docente puede revisarlo.
4. **Integración de la Planeación Viva:** los bloques validados se integran
   en la Planeación Viva completa.

Debe soportar **N parciales**, no solamente tres. La misma estructura de
bloque se reutiliza después para **modificar una parte específica de la
Planeación sin regenerarla completa** (OP-11).

Ventajas: soporta N parciales variable de forma natural (P1), cada etapa es
un resultado acotado y verificable, un reintento o corrección solo repite la
etapa afectada (no toda la planeación), y la etapa 2 es exactamente la misma
operación que "modificar Planeación" usará después — una sola pieza, dos
usos. El docente puede revisar el tronco antes de que se generen los
parciales.

**Evaluación de Claude para la generación inicial (mandato de Kike):** SÍ se
recomienda Claude — candidato primario **Claude Sonnet 5**. Razones: es el
perfil de tarea donde más pesan el apego a estructuras exactas, la calidad
de redacción pedagógica en español y la lectura de PDF del programa oficial;
las salidas estructuradas de la API garantizan JSON válido contra el esquema
de la planeación; y la ventana de contexto amplia permite incluir programa +
catálogos + contexto completo sin recortes. Claude Opus 5 queda como escalón
superior a probar únicamente si las pruebas reales mostraran calidad
insuficiente. La confirmación económica es de la Fase 6.

**Prompt v1 (etapa 1 — tronco):**

> Genera el tronco de la Planeación Didáctica de esta asignatura conforme al
> esquema TRONCO. Usa `[ASIGNATURA]` y, si existe, `[DOCUMENTO]` (programa
> de estudios). Propón: propósito formativo del campo y de la asignatura,
> ámbitos del perfil de egreso y competencias (elige de los catálogos
> incluidos en el contexto; no inventes claves), recursos generales y
> referencias. Los campos ejes disciplinarios, componente y contenido
> central van en "N/A" salvo que el programa indique otra cosa. Todo es una
> propuesta editable para el docente.

**Prompt v1 (etapa 2 — bloque de parcial):**

> Genera el bloque del parcial {n} conforme al esquema BLOQUE_PARCIAL. Usa
> el tronco validado, `[PARCIAL]` (fechas, horas reales y actividades que el
> docente ya creó) y los contenidos del programa que correspondan a este
> periodo. Propón: aprendizaje esperado, contenidos específicos, productos
> esperados, HSE y competencias de productividad (de catálogo), y las
> narrativas de Apertura, Desarrollo y Cierre redactadas a partir de las
> actividades reales — sin inventar actividades que no existen. Reparte las
> horas del parcial entre los momentos. La ponderación refleja los pesos
> reales de las actividades. Proceso de aprendizaje va en "N/A" salvo
> indicación del programa.

## 4.5 Fichas de las 17 operaciones

Formato: contexto (bloques de §4.3) · lo que aporta el docente · resultado ·
prompt v1 (instrucción específica; siempre precedida por `[SISTEMA]` y los
bloques de contexto) · escalón de modelo.

### Transversal

**OP-01 · Analizar documentos — Mayor.**
Contexto: `[ASIGNATURA]` + `[PLANEACION]` (si existe) + el archivo.
Aporta el docente: el archivo y un clic sobre su propósito (programa de
estudios / temario / material de apoyo). No se pregunta: nada más.
Resultado: JSON `DOCUMENTO_ANALIZADO` (tipo de documento, estructura de
unidades/temas, aprendizajes y competencias detectadas, contenido
aprovechable) que queda guardado como contexto de la asignatura.
Prompt v1: *"Analiza el documento adjunto. Identifica qué es, extrae su
estructura (unidades, temas, aprendizajes, competencias) y resume el
contenido aprovechable para planear y crear actividades y evaluaciones.
Devuelve solo el JSON del esquema DOCUMENTO_ANALIZADO."*
Modelo: Mayor (lectura de PDF y extracción fiel — es insumo de todo lo
demás).

### Familia A — Generaciones mayores

**OP-02 · Generar Planeación Didáctica 1.0 — Mayor.** Ver §4.4.

**OP-03 · Crear examen completo — Mayor.**
Contexto: `[ASIGNATURA]` + `[PLANEACION]` + `[PARCIAL]` + `[BANCO]` +
`[PETICION]`. Aporta: tema o alcance y, si quiere, número de preguntas y
tipos (por omisión la IA propone). No se pregunta: contenidos del parcial,
banco, evaluaciones previas. Resultado: JSON `EXAMEN` — configuración
sugerida (tiempo, 1 intento, navegación), secciones si aplica, y reactivos
de los 4 tipos con opciones, clave, retroalimentación y ponderación que suma
exactamente 10. El producto lo crea como evaluación en borrador (M2).
Prompt v1: *"Crea un examen del parcial indicado a partir del aprendizaje
esperado y los contenidos específicos del contexto. No repitas reactivos del
banco del docente. Genera {n} reactivos variados de los tipos permitidos:
enunciado claro, opciones plausibles (sin ambigüedad), respuesta correcta,
retroalimentación breve que enseñe, y ponderación; las ponderaciones suman
exactamente 10. Propón la configuración según dificultad y duración.
Devuelve solo el JSON del esquema EXAMEN."*

**OP-04 · Crear cuestionario completo — Mayor.**
Igual que OP-03 con la naturaleza de práctica: navegación libre, varios
intentos, retroalimentación inmediata visible. Mismo esquema con
configuración de cuestionario.

### Familia B — Creaciones puntuales

**OP-05 · Crear actividad — Económico.**
Contexto: `[ASIGNATURA]` + `[PLANEACION]` + `[PARCIAL]` + `[PETICION]`.
Aporta: qué quiere trabajar (una frase). Resultado: JSON `ACTIVIDAD` —
nombre, instrucciones en HTML sencillo, producto esperado, tipos de archivo
sugeridos y peso sugerido dentro de la ponderación restante del parcial.
Borrador oculto (M2).
Prompt v1: *"Propón una actividad alineada al aprendizaje esperado y los
contenidos del parcial. Instrucciones claras en pasos, producto esperado
concreto, tipos de archivo adecuados y un peso sugerido que respete que los
pesos del parcial suman 10 (pesos ya usados en el contexto). No dupliques
actividades existentes. Devuelve solo el JSON del esquema ACTIVIDAD."*

**OP-06 · Crear rúbrica — Mayor.**
**Fuente inmediata (obligatoria): la ACTIVIDAD PADRE** — un Entregable o una
Actividad de Observación. Sin actividad padre la operación no existe (regla
transversal T.5): no se genera desde el banco de rúbricas.
Contexto: `[ASIGNATURA]` + `[PETICION]`, y `[PLANEACION]` cuando exista —
**solo para contextualizar, comprobar alineación y aportar terminología
curricular válida; nunca para agregar criterios**.
Resultado: JSON `RUBRICA` con el modelo exacto del producto: niveles 3–5
(primero al 100%), criterios 2–6 con pesos que suman 10 y descriptores por
celda, observables y diferenciados. Se guarda en el banco y/o en la
actividad (M2).
Prompt v1: *"Crea una rúbrica para evaluar esta actividad. Los criterios
deben derivarse EXCLUSIVAMENTE de lo que la actividad solicita; no agregues
criterios que no puedan justificarse desde ella, aunque aparezcan en el
programa o en la planeación. Niveles {3–5} con nombres claros, criterios
{2–6} relevantes al producto esperado, pesos que suman exactamente 10 y un
descriptor observable por celda que distinga niveles sin ambigüedad.
Lenguaje que un alumno de bachillerato entiende. Devuelve solo el JSON del
esquema RUBRICA."*
(Escalón Mayor: la calidad de los descriptores es lo que hace útil una
rúbrica.)
Si la actividad padre no da información suficiente para fundamentar
criterios, la operación **se detiene e informa qué falta** (T.7): no inventa
ni completa con conocimiento general.

**OP-07 · Crear lista de cotejo — Económico.**
Igual que OP-06 —**misma fuente inmediata obligatoria y la misma prohibición
de agregar criterios curriculares**— con un solo nivel: criterios con pesos
que suman 10, cada uno como indicador verificable sí/no. Esquema `COTEJO`.

**OP-08 · Crear guía de observación — Económico.**
**Fuente inmediata: la actividad de observación.**
Contexto: `[ASIGNATURA]` + la actividad de observación + `[PETICION]`.
Resultado (O1: contenido, sin instrumento nuevo): texto/HTML con la guía —
qué observar, indicadores concretos, escala sugerida y espacio de notas —
asociado a la actividad de observación.
Prompt v1: *"Redacta una guía de observación para esta actividad: aspectos a
observar alineados al aprendizaje esperado, indicadores concretos y
observables, y sugerencia de registro. Breve y usable en el aula."*

**OP-09 · Generar reactivos — Económico (Mayor si parte de un documento).**
**Fuente inmediata: el CUESTIONARIO o EXAMEN** al que pertenecerán —o, cuando
se generan sueltos hacia el banco, el tema o `[DOCUMENTO]` indicado. El
contexto curricular puede validar y contextualizar, pero **no puede
introducir contenidos que la evaluación padre no pretenda evaluar** (T.6).
Contexto: `[ASIGNATURA]` + `[PLANEACION]` + `[BANCO]` + tema o
`[DOCUMENTO]`. Resultado: JSON `REACTIVOS` — lista de reactivos con clave,
retroalimentación y clasificación por materia/tema para el banco, o para una
evaluación existente.
Prompt v1: *"Genera {n} reactivos de tipo {tipos} sobre {tema/contenido}.
Sin repetir los del banco (lista en contexto). Cada uno con enunciado,
opciones plausibles, respuesta correcta, retroalimentación breve y tema.
Devuelve solo el JSON del esquema REACTIVOS."*

**OP-10 · Generar instrucciones — Económico.**
Contexto: `[ASIGNATURA]` + la actividad (nombre, instrucciones actuales si
hay) + `[PERFIL_IA]` + `[PETICION]`. Resultado: HTML sencillo con las
instrucciones nuevas o mejoradas. Se inserta en el editor para que el
docente ajuste.
Prompt v1: *"Redacta (o mejora) las instrucciones de esta actividad: qué se
hará, pasos claros, criterios de entrega y formato. Tono {perfil IA}.
Concreto y sin relleno."*

### Familia C — Asistencia continua

**OP-11 · Modificar Planeación — Económico.**
Contexto: `[PLANEACION]` (el bloque afectado) + `[PARCIAL]` + `[PETICION]`.
Resultado: JSON con SOLO los campos modificados del bloque (propuesta de
cambio que el docente confirma). Si la petición implica regenerar un bloque
completo, se usa la etapa 2 de OP-02 (escalón Mayor).
Prompt v1: *"Aplica este ajuste a la planeación: {petición}. Modifica
únicamente los campos necesarios del bloque indicado y mantén la coherencia
con las actividades reales del parcial. Devuelve solo el JSON del esquema
CAMBIO_PLANEACION con los campos modificados."*

**OP-12 · Retroalimentación personalizada — Económico.**
Contexto: `[ASIGNATURA]` + `[ALUMNO]` (entrega, rúbrica evaluada, respuestas,
historial, asistencia) + `[PERFIL_IA]` + `[PETICION]`. Resultado: borrador de
texto para el comentario de calificación (por entrega o por pregunta). El
docente edita y decide.
Prompt v1: *"Redacta retroalimentación para este alumno sobre esta entrega:
reconoce lo logrado con base en la evidencia, señala 1–3 mejoras concretas
ligadas a los criterios, y cierra con orientación accionable. Tono {perfil
IA}, dirigido al alumno por su nombre, breve. No inventes nada que no esté
en la evidencia."*

**OP-13 · Generar plan de clase ligero — Económico.**
Contexto: `[ASIGNATURA]` + `[PLANEACION]` + `[PARCIAL]` + horario de la
sesión + `[PETICION]` (tema y, si quiere, duración). Resultado: texto breve
y práctico — inicio, desarrollo, cierre de LA CLASE, con tiempos según la
duración real del bloque, materiales y un producto/checkpoint. NO es un
formato institucional (O2).
Prompt v1: *"Prepara un plan de clase ligero para la sesión de {fecha,
duración} sobre {tema}: inicio, desarrollo y cierre con tiempos realistas,
qué hace el docente y qué hacen los alumnos, materiales y un producto o
señal de logro. Práctico y directo, sin formato burocrático."*

**C-01 · Interpretar resultados de una evaluación — Económico.**
Contexto: `[ASIGNATURA]` + estadísticas YA calculadas por EF (promedios, %
por reactivo, por sección si existe) + los reactivos. Resultado: texto breve
— temas dominados y débiles, reactivos posiblemente mal planteados (con
razón), y 2–3 sugerencias de repaso.
Prompt v1: *"Interpreta estos resultados para el docente: qué dominó el
grupo, qué falló y por qué podría ser (contenido no logrado vs. reactivo
confuso), y qué conviene repasar. Basa todo en los datos incluidos; no
calcules nada nuevo."*

**C-02 · Sugerir calificación de respuestas abiertas — Económico.**
Contexto: la pregunta + la clave/criterios del docente + la respuesta del
alumno + puntos posibles. Resultado: JSON `SUGERENCIA_CALIFICACION` —
puntos sugeridos, justificación breve y comentario propuesto. **Regla O3 en
el producto y en el prompt: es una sugerencia; jamás se guarda sola.**
Prompt v1: *"Compara la respuesta del alumno con la clave y los criterios.
Sugiere puntos (0 a {máx}) y justifícalo citando la evidencia de la
respuesta. Propón un comentario breve para el alumno. Es una sugerencia para
el docente: sé justo, y ante la duda favorece la revisión humana señalando
qué revisar."*
(El escalón se confirmará con pruebas reales de calidad en Fase 11.)

**C-03 · Redactar avisos — Económico.**
Contexto: `[ASIGNATURA]` + tipo de aviso (los 12 del producto) + datos del
caso + `[PERFIL_IA]`. Resultado: título + mensaje listos para el editor de
avisos.
Prompt v1: *"Redacta un aviso de tipo {tipo} para el grupo con estos datos:
{datos}. Claro, completo (qué, cuándo, qué deben hacer), tono {perfil IA},
breve. Devuelve título y mensaje."*

**C-04 · Resumen de desempeño (alumno o grupo) — Económico.**
Contexto: `[ASIGNATURA]` + datos YA calculados (calificaciones, entregas,
asistencia) del alumno o del grupo en el parcial. Resultado: texto breve
para junta, tutor o preparación de retroalimentación.
Prompt v1: *"Resume el desempeño de {alumno|el grupo} en el parcial con los
datos incluidos: dónde va bien, dónde necesita apoyo y una recomendación
concreta. Lenguaje claro para compartir con un tutor o padre de familia. No
calcules nada nuevo ni especules más allá de los datos."*

## 4.6 El Perfil IA del docente (M1 — APROBADO el 9-ago-2026)

Recorridas las 17 operaciones, la única información global que las
operaciones realmente necesitan y que Evalúa Fácil no conoce es **cómo
quiere sonar el docente** cuando la IA redacta textos dirigidos a sus
alumnos (OP-10, OP-12, C-03, y los textos de actividades). Propuesta de
Perfil IA **mínimo** (regla de Kike: solo lo que aporta valor):

1. **Tono con tus alumnos** — selección simple (cercano / neutral / formal),
   con valor por omisión "cercano y respetuoso".
2. **Indicaciones personales para la IA** — texto libre OPCIONAL (p. ej.
   "siempre tutéalos", "evita tecnicismos").

Nada más. Carrera y semestre son por asignatura (viven en la Planeación,
§2.11); el resto ya lo sabe la plataforma. Ambos campos con valor por
omisión: el docente que nunca abra su Perfil IA recibe resultados correctos.

## 4.7 Decisiones M1–M4 (RESUELTAS por Kike el 9-ago-2026)

- **M1 — Perfil IA mínimo. APROBADO:** el Perfil IA del docente tendrá
  inicialmente ÚNICAMENTE los dos campos de §4.6 (tono + indicaciones
  libres), ambos opcionales y con valores por omisión. **No se agregan más
  campos al Perfil IA en esta etapa.**
- **M2 — Borradores reales. APROBADO:** las generaciones de IA que
  correspondan a entidades del producto se convierten en borradores reales
  dentro de Evalúa Fácil (actividad → borrador de actividad; evaluación →
  borrador de evaluación; rúbrica → borrador en el banco; bloques de
  Planeación → borrador editable de Planeación). El docente revisa y edita
  con los editores que ya conoce. **La IA nunca publica, activa, califica ni
  sustituye automáticamente la decisión del docente.**
- **M3 — Candidatos de modelo. NO aprobado como decisión definitiva:**
  Sonnet 5 y Haiku 4.5 quedan únicamente como **candidatos técnicos de
  trabajo**. No se fija ningún proveedor ni modelo definitivo. La selección
  final se hará tras: verificar modelos y precios oficiales vigentes,
  comparar calidad, comparar consumo de tokens, comparar costo real por
  operación, usar el simulador económico externo, y determinar la mejor
  relación calidad/costo para cada operación. OpenAI queda abierto cuando
  resulte técnica o económicamente conveniente.
- **M4 — Planeación por etapas. APROBADO:** generación en 4 etapas (tronco →
  cada bloque de parcial → validación de cada bloque → integración de la
  Planeación Viva), con soporte de N parciales y la misma estructura de
  bloque reutilizable para modificar una parte específica sin regenerar la
  Planeación completa. Detalle en §4.4.

**Regla registrada al cierre de la fase:** los créditos IA (Fase 5) NO se
definen sin haber realizado antes el análisis económico de modelos y
operaciones con el simulador externo (`Simulador_Costos_IA_Evalua_Facil.xlsx`
en Google Sheets). El costo real de las operaciones se determina primero;
los créditos se diseñan a partir de ahí.

---

# INSUMO PARA EL SIMULADOR — ESTIMACIÓN DE TOKENS POR OPERACIÓN

Elaborado el 9-ago-2026 a petición de Kike como insumo para
`Simulador_Costos_IA_Evalua_Facil.xlsx` (Google Sheets). **No incluye**
créditos, selección definitiva de modelos ni rentabilidad. No modifica nada
de la Fase 4.

## Método y advertencias

- Las cifras se derivan de los **bloques de contexto reales** (§4.3) y los
  **prompts v1** (§4.5), no de promedios genéricos. Regla usada: español ≈
  1.4–1.5 tokens por palabra; JSON estructurado ≈ 20–40% más tokens que el
  texto equivalente; PDF procesado ≈ ~2,000 tokens por página (texto +
  imagen de página).
- Son **estimaciones de planeación con incertidumbre de ±30–50%**. Se
  calibrarán con mediciones reales (`count_tokens` y consumos observados)
  durante las pruebas de la Fase 11; el simulador debe tratarlas como
  escenario de referencia sustituible.
- Costo aproximado de los bloques de contexto usados en las sumas:
  `[SISTEMA]`+instrucción ≈ 350–400 · `[PERFIL_IA]` ≈ 50 · `[ASIGNATURA]` ≈
  200 · `[PLANEACION]` (tronco+bloque del parcial) ≈ 1,200 · `[PARCIAL]` ≈
  300 · `[ALUMNO]` ≈ 700 · `[BANCO]` (50 reactivos) ≈ 800 · análisis de
  documento (salida de OP-01) ≈ 2,000 · catálogos oficiales completos ≈
  3,500.
- **Insight clave para el simulador:** OP-01 es la operación más cara de
  entrada pero se ejecuta **una sola vez por documento**; su resultado
  (~2,000 tokens) es lo que reutilizan todas las demás. Además, los bloques
  estables al inicio del prompt son cacheables por el proveedor — el costo
  efectivo de entrada de las operaciones repetidas será menor que el
  nominal (la cuantificación del caché es de la Fase 6).

## Tabla de estimaciones (tokens por uso)

**Nota del 10-ago-2026:** la columna "Contexto" mezcla dos cosas distintas
que la regla transversal separó — la **fuente inmediata** (la que origina lo
generado) y el **contexto** (el que solo contextualiza y valida). Las filas
de las operaciones pedagógicas se anotaron en consecuencia; los **valores de
tokens no cambiaron** y el simulador no se toca. Cuando una operación reciba
contexto curricular como bloque nuevo, su estimación deberá recalcularse.

| Op | Operación | Entrada | Salida | Qué incluye la entrada | Qué incluye la salida | Escenario de referencia |
|----|-----------|--------:|-------:|------------------------|----------------------|-------------------------|
| OP-01a | Analizar documentos — **programa de estudios** (análisis enriquecido) | 60,600 | 3,500 | Sistema/asignatura (~600) + **PDF completo** (~2,000 tokens/pág) | JSON `DOCUMENTO_ANALIZADO` enriquecido: unidades con contenidos, aprendizajes, competencias y mapeo a parciales | Programa de 30 páginas; **una vez por documento** |
| OP-01b | Analizar documentos — **fuente de apoyo** (análisis ligero) | 24,600 | 1,200 | Sistema/asignatura (~600) + documento de ~12 págs | JSON `DOCUMENTO_ANALIZADO` ligero | Apoyo de ~12 páginas; **una vez por documento** |
| OP-02·E1 | Planeación 1.0 — tronco | 12,400 | 1,500 | Base (600) + análisis del programa (3,500) + 4 análisis de apoyo (4,800) + catálogos oficiales (3,500) | JSON `TRONCO`: propósitos, competencias, ámbitos, recursos, referencias | Con 5 fuentes analizadas; con 10 fuentes: **18,400** |
| OP-02·E2 | Planeación 1.0 — bloque de parcial | 5,200 | 1,200 | Base (600) + tronco validado (1,500) + parcial real (300) + unidades del periodo (1,800) + catálogos parciales (1,000) | JSON `BLOQUE_PARCIAL`: aprendizaje esperado, contenidos, productos, HSE, competencias, narrativas A/D/C con horas | **Por parcial**; casi plano aunque haya más fuentes (selección estructural) |
| OP-02·GEN | Planeación — solo generación (E1 + 3×E2) | 28,000 | 5,100 | E1 + 3 × E2 | Planeación Viva completa | 3 parciales (N parciales: 12,400 + N×5,200 / 1,500 + N×1,200) |
| PLAN·5F | **Planeación 1.0 completa con 5 FUENTES** (análisis + generación) | **187,000** | **13,400** | 1 programa (OP-01a) + 4 apoyos (OP-01b) + E1 + 3×E2 | Asignatura con Planeación Viva construida | Escenario de arranque estándar |
| PLAN·10F | **Planeación 1.0 completa con 10 FUENTES** | **316,000** | **19,400** | 1 programa + 9 apoyos + E1 (18,400) + 3×E2 | Ídem | Escenario máximo — **tope de 10 fuentes por asignatura** |
| OP-03 | Crear examen completo | 3,000 | 2,000 | Sistema + asignatura + planeación + parcial + banco (800) + petición | JSON `EXAMEN`: config + secciones + 15 reactivos con clave, retro y ponderación | 15 reactivos; banco de 50 |
| OP-04 | Crear cuestionario completo | 3,000 | 2,000 | Igual que OP-03 | JSON con configuración de práctica | 15 reactivos |
| OP-05 | Crear actividad | 2,100 | 500 | Sistema + asignatura + planeación + parcial + petición | JSON `ACTIVIDAD`: nombre, instrucciones HTML, producto, tipos, peso | Una actividad |
| OP-06 | Crear rúbrica | 1,000 | 700 | **Fuente inmediata: actividad padre (entregable u observación)** + sistema + asignatura + petición | JSON `RUBRICA`: 4 niveles × 4 criterios con 16 descriptores y pesos | Rúbrica 4×4 |
| OP-07 | Crear lista de cotejo | 1,000 | 300 | Igual que OP-06 (**fuente inmediata: actividad padre**) | JSON `COTEJO`: 8 indicadores sí/no con pesos | 8 criterios |
| OP-08 | Crear guía de observación | 1,000 | 500 | **Fuente inmediata: actividad de observación** + sistema + asignatura | Texto/HTML: aspectos, indicadores, registro | Una guía |
| OP-09 | Generar reactivos | 2,600 | 600 | **Fuente inmediata: evaluación padre (o tema/documento)** + sistema + asignatura + planeación *(contexto)* + banco (800) | JSON `REACTIVOS`: 5 reactivos con clave y retro | 5 reactivos desde tema (+2,000 de entrada si parte de un documento analizado) |
| OP-10 | Generar instrucciones | 1,000 | 400 | Sistema + asignatura + actividad actual + perfil IA | HTML de instrucciones | Una actividad |
| OP-11 | Modificar Planeación | 2,000 | 300 | Sistema + bloque afectado (1,200) + parcial + petición | JSON `CAMBIO_PLANEACION`: solo campos modificados | Ajuste pequeño (regenerar un bloque completo = OP-02·E2) |
| OP-12 | Retroalimentación personalizada | 1,300 | 200 | Sistema + asignatura + `[ALUMNO]` (entrega, rúbrica evaluada, historial, asistencia ≈ 700) + perfil IA | Borrador de comentario para el alumno | 1 alumno, 1 entrega |
| OP-13 | Plan de clase ligero | 2,000 | 500 | Sistema + asignatura + planeación + sesión del horario + tema | Texto: inicio/desarrollo/cierre con tiempos, materiales, producto | Una sesión |
| C-01 | Interpretar resultados de evaluación | 2,400 | 500 | Sistema + asignatura + estadísticas precalculadas por reactivo (600) + los 15 reactivos (1,200) | Texto: temas débiles, reactivos dudosos, sugerencias de repaso | Examen de 15 reactivos, grupo de 35 |
| C-02 | Sugerir calificación de abierta | 900 | 200 | **Fuente inmediata: pregunta + clave/criterios + respuesta del alumno** (~150 palabras) + sistema | JSON: puntos sugeridos, justificación, comentario | **Por respuesta** (un examen con 5 abiertas × 35 alumnos = 175 usos) |
| C-03 | Redactar avisos | 700 | 150 | Sistema + asignatura + tipo y datos del aviso + perfil IA | Título + mensaje | Un aviso |
| C-04a | Resumen de desempeño — alumno | 1,000 | 250 | Sistema + asignatura + datos precalculados del alumno en el parcial (~450) | Texto breve sobre ese alumno, para junta/tutor | Un alumno = **una llamada**; resumir a cada alumno de un grupo de 35 serían 35 usos de esta fila |
| C-04b | Resumen de desempeño — grupo | 1,500 | 350 | Sistema + asignatura + estadísticas agregadas del grupo (~300) + una línea condensada por alumno (35 × ~15 ≈ 525) | Texto breve del grupo: fortalezas, focos de atención y alumnos que requieren apoyo | Grupo de 35 = **una sola llamada para todo el grupo** (no 35 llamadas) |

**Notas de la actualización del 9-ago-2026 (arquitectura D aplicada):**
OP-01 quedó dividido en OP-01a (programa) y OP-01b (apoyo); OP-02·E1/E2
actualizados; los escenarios de 5 y 10 fuentes quedan como filas separadas
(PLAN·5F / PLAN·10F). OP-02·E3 (validación) y OP-02·E4 (integración) siguen
**sin IA** (0 tokens). Para el arranque del perfil de referencia: **20
fuentes iniciales = 4 programas (OP-01a) + 16 apoyos (OP-01b)** — costo de
arranque de la asignatura, nunca consumo mensual recurrente. Las fuentes
adicionales se analizan **una sola vez** al incorporarse; tope de **10
fuentes por asignatura**. Ninguna otra operación cambió.

## Asignación PROVISIONAL de modelos (solo para alimentar el simulador)

Elaborada el 9-ago-2026 a petición de Kike. **NO es la decisión definitiva
de modelos — M3 sigue abierta.** Sirve únicamente para alimentar y probar el
simulador; la selección final saldrá de: calidad real, consumo de tokens,
costo por operación, costo mensual por docente, escenarios de uso, pruebas
reales de calidad y rentabilidad del plan de $99.

**Candidatos (los seis registrados en el simulador, sin agregar otros):**
OpenAI — GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna · Anthropic — Claude Opus
4.8, Claude Sonnet 5, Claude Haiku 4.5.

**Supuesto declarado sobre la familia OpenAI:** se les trata por su posición
en la familia (Sol = tope, Terra = medio, Luna = económico). Su calidad real
en español pedagógico, apego a esquemas JSON y lectura de PDF se comparará
en las pruebas reales — este documento no la afirma.

**Las etapas 3 y 4 de la Planeación no usan IA.** La validación de cada
bloque (etapa 3) y la integración final (etapa 4) las hace el código del
producto contra el esquema y las reglas duras (§4.1): consumo de tokens = 0.
Solo las etapas 1 y 2 llaman a un modelo — coherente con la tabla de tokens
(E1 + N×E2).

| Op | Operación | Escalón | Modelo provisional | Proveedor | Sensibilidad a calidad | Razón breve | Alternativas razonables |
|----|-----------|---------|--------------------|-----------|------------------------|-------------|--------------------------|
| OP-01 | Analizar documentos | Mayor | Claude Sonnet 5 | Anthropic | **Alta** — todo lo demás hereda de este análisis | Lectura nativa de PDF y extracción fiel a esquema | GPT-5.6 Sol/Terra (verificar manejo de PDF en pruebas) |
| OP-02·E1 | Planeación — tronco | Mayor | Claude Sonnet 5 | Anthropic | **Alta** — cimiento curricular de toda la asignatura | Apego a catálogos oficiales sin inventar claves; redacción pedagógica | Claude Opus 4.8 (escalón superior si las pruebas lo piden); GPT-5.6 Sol |
| OP-02·E2 | Planeación — bloque de parcial | Mayor | Claude Sonnet 5 | Anthropic | **Alta** — narrativas y estructura estricta | Misma pieza que E1; coherencia con el tronco | GPT-5.6 Terra |
| OP-02·E3 | Planeación — validación de bloques | — | **Sin IA** (código del producto) | — | — | Validación determinista contra esquema y reglas duras | — |
| OP-02·E4 | Planeación — integración final | — | **Sin IA** (código del producto) | — | — | Ensamble de bloques validados en la Planeación Viva | — |
| OP-03 | Crear examen completo | Mayor | Claude Sonnet 5 | Anthropic | **Alta** — clave correcta y opciones sin ambigüedad | Un reactivo malo daña la evaluación de todo el grupo | GPT-5.6 Terra |
| OP-04 | Crear cuestionario completo | Mayor | Claude Sonnet 5 | Anthropic | Media-alta — es práctica, tolera algo más | Mismo esquema que OP-03 | GPT-5.6 Terra; probar Claude Haiku 4.5 en cuestionarios cortos de práctica |
| OP-05 | Crear actividad | Económico | Claude Haiku 4.5 | Anthropic | Media — el docente edita el borrador | Pieza acotada con esquema estricto | GPT-5.6 Luna; escalar a Sonnet 5 si las instrucciones salen pobres |
| OP-06 | Crear rúbrica | Mayor | Claude Sonnet 5 | Anthropic | **Alta** — los descriptores diferenciados SON el instrumento | Calidad de descriptores por celda | GPT-5.6 Terra |
| OP-07 | Crear lista de cotejo | Económico | Claude Haiku 4.5 | Anthropic | Media — estructura simple sí/no | Un solo nivel, indicadores verificables | GPT-5.6 Luna |
| OP-08 | Crear guía de observación | Económico | Claude Haiku 4.5 | Anthropic | Media | Texto guía sin estructura compleja | GPT-5.6 Luna |
| OP-09 | Generar reactivos | Económico | Claude Haiku 4.5 | Anthropic | Media-alta — la clave debe ser correcta | Lotes chicos con esquema estricto | GPT-5.6 Luna; si parte de documento analizado → Sonnet 5 |
| OP-10 | Generar instrucciones | Económico | Claude Haiku 4.5 | Anthropic | Baja-media — el docente ajusta en el editor | Redacción corta y frecuente | GPT-5.6 Luna |
| OP-11 | Modificar Planeación | Económico | Claude Haiku 4.5 | Anthropic | Media — cambios acotados con esquema | Operación de mantenimiento frecuente | GPT-5.6 Luna; regenerar bloque completo → modelo de OP-02·E2 |
| OP-12 | Retroalimentación personalizada | Económico | Claude Haiku 4.5 | Anthropic | Media — borrador que el docente edita | Texto breve y empático desde evidencia dada | GPT-5.6 Luna |
| OP-13 | Plan de clase ligero | Económico | Claude Haiku 4.5 | Anthropic | Media | Texto práctico corto | GPT-5.6 Luna |
| C-01 | Interpretar resultados | Económico | Claude Haiku 4.5 | Anthropic | Media — interpreta datos ya calculados | Sin cálculos propios; texto breve | GPT-5.6 Luna; si el análisis de reactivos dudosos flojea → Sonnet 5 / Terra |
| C-02 | Sugerir calificación de abierta | Económico | Claude Haiku 4.5 | Anthropic | **Alta por naturaleza** (justicia con el alumno), mitigada porque el docente SIEMPRE confirma (regla O3) | Volumen alto (por respuesta); requiere **prueba de calidad obligatoria** antes de confirmar escalón | GPT-5.6 Luna; escalar a Sonnet 5 / Terra si las pruebas muestran sesgos o injusticia |
| C-03 | Redactar avisos | Económico | Claude Haiku 4.5 | Anthropic | Baja | Texto corto informativo | GPT-5.6 Luna |
| C-04a | Resumen de desempeño — alumno | Económico | Claude Haiku 4.5 | Anthropic | Media | Resumen desde datos dados | GPT-5.6 Luna |
| C-04b | Resumen de desempeño — grupo | Económico | Claude Haiku 4.5 | Anthropic | Media | Una llamada por grupo | GPT-5.6 Luna |

## Frecuencias mensuales de uso — escenario NORMAL (insumo del simulador)

> **SUSTITUIDA el 9-ago-2026** por el "Modelo de consumo: ARRANQUE +
> RECURRENTE" (sección siguiente), que corrige el error de modelar OP-01 y
> OP-02 como operaciones mensuales indefinidas. Se conserva como historial;
> las frecuencias de las operaciones recurrentes siguen vigentes y se
> retoman en el modelo corregido.

Elaborado el 9-ago-2026 a petición de Kike. Escenario **normal/realista** (ni
conservador ni extremo) para un docente de EMS que usa Evalúa Fácil con
regularidad. Sin costos, sin créditos, sin cambios a tokens ni a modelos
provisionales.

**Perfil de referencia del docente** (todas las frecuencias se derivan de
aquí; en el simulador basta cambiar estos parámetros para recalcular):

- **4 asignaturas/grupos** · **35 alumnos por grupo** (140 en total) ·
  **3 parciales por semestre** · semestre ≈ **4.5 meses efectivos**.
- Las cifras son el **promedio mensual sobre el semestre** (usos del
  semestre ÷ 4.5). Los eventos por parcial ocurren ~0.67 veces/mes por
  asignatura (3 parciales ÷ 4.5 meses).

**Dos observaciones importantes para el simulador (y para la futura Fase 5):**

1. **El consumo NO es plano: el mes 1 del semestre concentra la carga.** Las
   4 planeaciones completas (OP-01 + OP-02) se generan casi todas al inicio
   del semestre. El promedio mensual sirve para la rentabilidad; el diseño
   de créditos mensuales deberá considerar ese pico de arranque (nota para
   la Fase 5, no se diseña aquí).
2. **C-02 es el motor de volumen.** Su fórmula es: evaluaciones con abiertas
   al mes × respuestas abiertas por evaluación × alumnos. Pequeños cambios
   en esos tres factores mueven el consumo total más que cualquier otra
   operación.

| Op | Operación | Usos/mes | Qué es UN uso | Por qué es razonable | Depende de |
|----|-----------|---------:|----------------|----------------------|------------|
| OP-01 | Analizar documentos | 2 | Analizar UN documento nuevo | 1 programa por asignatura al semestre (4) + 2–3 materiales extra = ~7/semestre ÷ 4.5 | Nº de asignaturas y de materiales propios |
| OP-02·E1 | Planeación — tronco | 1 | Generar el tronco de UNA asignatura | 4 troncos por semestre (uno por asignatura) ÷ 4.5; concentrado al inicio | Nº de asignaturas |
| OP-02·E2 | Planeación — bloque de parcial | 3 | Generar UN bloque de parcial | 4 asignaturas × 3 parciales = 12 bloques/semestre ÷ 4.5 | Nº de asignaturas × nº de parciales |
| OP-03 | Crear examen | 3 | UN examen completo | 1 examen por asignatura por parcial: 4 × 3 ÷ 4.5 | Asignaturas × parciales |
| OP-04 | Crear cuestionario | 4 | UN cuestionario completo | ~1.5 prácticas por asignatura por parcial | Asignaturas × parciales |
| OP-05 | Crear actividad | 7 | UNA actividad propuesta | ~2.5 de las 4–6 actividades por parcial se crean con IA, por asignatura | Actividades por parcial × asignaturas |
| OP-06 | Crear rúbrica | 3 | UNA rúbrica | ~1 rúbrica nueva por asignatura por parcial (después se reutiliza el banco) | Asignaturas × parciales; decrece con el banco |
| OP-07 | Crear lista de cotejo | 2 | UNA lista de cotejo | Menos frecuente que la rúbrica | Ídem |
| OP-08 | Crear guía de observación | 1 | UNA guía | Uso ocasional en actividades de observación | Nº de actividades de observación |
| OP-09 | Generar reactivos | 4 | UN lote de ~5 reactivos | ~1 lote por asignatura al mes para alimentar el banco | Nº de asignaturas |
| OP-10 | Generar instrucciones | 8 | Redactar/mejorar instrucciones de UNA actividad | ~2 por asignatura al mes — operación cotidiana ligera | Nº de asignaturas y actividades |
| OP-11 | Modificar Planeación | 8 | UN ajuste pequeño a la Planeación Viva | ~2 ajustes por asignatura al mes (mantenerla viva es la intención del diseño) | Nº de asignaturas |
| OP-12 | Retroalimentación personalizada | 25 | Retroalimentación de UN alumno sobre UNA entrega | ~10 por asignatura por parcial: se usa en entregas destacadas o problemáticas, no en las 140 | Alumnos × actividades calificadas × hábito del docente |
| OP-13 | Plan de clase ligero | 6 | UN plan de sesión | ~1–2 clases preparadas con IA por semana | Hábito del docente |
| C-01 | Interpretar resultados | 4 | UNA evaluación interpretada | Tras cada examen (3) + algún cuestionario | Nº de evaluaciones aplicadas |
| C-02 | Sugerir calificación de abierta | **200** | UNA respuesta abierta individual | ~2 evaluaciones con abiertas al mes × ~3 abiertas × 35 alumnos ≈ 210 | **Evaluaciones con abiertas × abiertas por evaluación × alumnos** |
| C-03 | Redactar avisos | 12 | UN aviso | ~3 avisos por asignatura al mes | Nº de asignaturas |
| C-04a | Resumen de desempeño — alumno | 10 | Resumen de UN alumno | Alumnos en riesgo, juntas y tutores del mes | Alumnos que requieren seguimiento |
| C-04b | Resumen de desempeño — grupo | 4 | Resumen de UN grupo completo (una llamada) | ~1 por asignatura al cierre/avance del parcial | Nº de asignaturas |

**Total ≈ 307 usos/mes** para el docente de referencia (de los cuales ~200
son C-02, la micro-operación por respuesta).

## Modelo de consumo: ARRANQUE + RECURRENTE (corrección del 9-ago-2026)

Corrección definida por Kike antes de llevar el modelo al simulador. Perfil
de referencia sin cambios: **4 asignaturas × 35 alumnos × 3 parciales ×
4.5 meses efectivos**. Sin costos, sin créditos, sin cambios a tokens ni a
modelos provisionales.

### Reglas de las fuentes de conocimiento (decisión de Kike, 9-ago-2026)

- **Máximo de fuentes por asignatura: 10.** El límite es **por asignatura**,
  no por docente.
- **Fuentes iniciales recomendadas: ≈ 5** por asignatura, consideradas para
  la Planeación 1.0.
- **Las fuentes se acumulan** — no sustituyen a las anteriores. El docente
  puede agregar nuevas cuando las necesite, hasta el tope de 10.
- **Comportamiento de OP-01:** una fuente se analiza/incorpora **UNA sola
  vez**; después su conocimiento (el análisis de ~2,000 tokens) se
  **reutiliza** — no se vuelve a pagar el análisis completo cada vez que
  otra operación usa esa fuente. OP-01 NO es una operación mensual
  indefinida: son las fuentes iniciales del arranque + las adiciones
  ocasionales, con tope duro de 10 por asignatura.
- **Comportamiento de OP-02:** la Planeación 1.0 de cada asignatura se
  genera **UNA sola vez al inicio de la asignatura/semestre** (tronco + sus
  N bloques de parcial). NO se modela como una planeación completa mensual.
  Después del arranque, la Planeación solo consume por mantenimiento: los
  ajustes pequeños son OP-11, y la regeneración de un bloque completo por
  un cambio mayor consume como OP-02·E2 (ocasional).

### Tabla final de consumo (docente de referencia)

**Arranque** = usos una sola vez al inicio del semestre (las 4 asignaturas).
**Recurrente** = usos por mes una vez construidas las Planeaciones.

| Operación | Arranque | Recurrente mensual | Unidad de uso | Supuesto |
|-----------|---------:|-------------------:|----------------|----------|
| OP-01 · Fuentes iniciales | **20** | — | 1 documento analizado | 5 fuentes × 4 asignaturas, una sola vez |
| OP-01 · Fuentes adicionales | — | 1 | 1 documento analizado | ~1 fuente extra por asignatura durante el semestre; **tope 10/asignatura** (el docente de referencia llega a ~6–7 de 10) |
| OP-02·E1 · Tronco | **4** | 0 | 1 tronco | Una vez por asignatura por semestre — nunca recurrente |
| OP-02·E2 · Bloques de parcial | **12** | ~1 | 1 bloque | 4 × 3 parciales al arranque; recurrente solo la regeneración ocasional de un bloque por cambio mayor (vía OP-11 escalado) |
| OP-03 · Examen | 0 | 3 | 1 examen | 1 por asignatura por parcial |
| OP-04 · Cuestionario | 0 | 4 | 1 cuestionario | ~1.5 por asignatura por parcial |
| OP-05 · Actividad | 8 | 6 | 1 actividad | Arranque: ~2 actividades del parcial 1 por asignatura; después ritmo normal |
| OP-06 · Rúbrica | 4 | 2 | 1 rúbrica | Arranque: 1 rúbrica base por asignatura; después el banco reduce la necesidad |
| OP-07 · Lista de cotejo | 0 | 2 | 1 lista | — |
| OP-08 · Guía de observación | 0 | 1 | 1 guía | — |
| OP-09 · Reactivos | 0 | 4 | 1 lote de ~5 | Alimentar el banco |
| OP-10 · Instrucciones | 0 | 8 | 1 actividad | Cotidiana ligera |
| OP-11 · Modificar Planeación | 0 | 8 | 1 ajuste pequeño | Mantener viva la Planeación |
| OP-12 · Retroalimentación | 0 | 25 | 1 alumno × 1 entrega | Entregas destacadas o problemáticas |
| OP-13 · Plan de clase | 0 | 6 | 1 sesión | ~1–2 por semana |
| C-01 · Interpretar resultados | 0 | 4 | 1 evaluación | Tras exámenes y algunas prácticas |
| C-02 · Calificación de abiertas | 0 | **200** | **1 respuesta individual** | ~2 evaluaciones con abiertas × ~3 abiertas × 35 alumnos |
| C-03 · Avisos | 4 | 12 | 1 aviso | Arranque: bienvenida/encuadre por asignatura |
| C-04a · Resumen alumno | 0 | 10 | 1 alumno | Seguimiento y juntas |
| C-04b · Resumen grupo | 0 | 4 | 1 grupo (una llamada) | ~1 por asignatura por corte |
| **TOTALES** | **52 usos** | **≈ 301 usos/mes** | | |

### Nota de consistencia con la tabla de tokens (señalada, NO modificada)

La estimación de tokens de OP-02·E1 (6,000 de entrada) asumió **UN** análisis
de documento (~2,000 tokens) como insumo. Con la regla de ~5 fuentes
iniciales, si la generación del tronco incluye los análisis de las 5
fuentes, la entrada de E1 crecería ~+8,000 tokens (5 × 2,000 en lugar de
2,000). No modifico la tabla de tokens por instrucción de Kike; el simulador
puede modelarlo como "+2,000 de entrada por fuente adicional incluida en la
generación", y en la implementación (Fase 11) se decidirá si cada operación
recibe todas las fuentes o solo las relevantes. Queda como punto abierto
para cuando Kike lo indique. *(Análisis técnico entregado en la sección
siguiente — pendiente de aprobación de Kike.)*

## Análisis técnico: reutilización del conocimiento de las fuentes (OP-01 → E1 → E2)

Elaborado el 9-ago-2026 a petición de Kike. Objetivo: minimizar tokens SIN
sacrificar la calidad de la Planeación 1.0 — mejor equilibrio entre calidad,
costo y experiencia del docente. **Solo análisis: el simulador, los tokens y
los modelos no se modifican hasta que Kike apruebe.**

### Las cuatro arquitecturas evaluadas

**A) E1 recibe los 5 documentos completos otra vez. DESCARTADA.**
Costo explosivo (5 documentos ≈ 100,000–300,000 tokens de entrada por
tronco) y viola la regla ya decidida: la fuente se analiza UNA vez y no se
vuelve a pagar. La ganancia de calidad sobre un buen análisis estructurado
es marginal, porque el análisis de OP-01 se diseña precisamente para
capturar la estructura curricular. Solo tendría sentido como excepción
puntual, nunca como arquitectura.

**B) E1 recibe los análisis estructurados de OP-01 (los 5 completos).
VIABLE, pero mejorable.**
Simple (sin infraestructura nueva), coherente con "analizar una vez,
reutilizar siempre". Entrada de E1 ≈ 4,000 base + 5 × 2,000 = ~14,000.
Debilidad: trata igual a todas las fuentes — el programa de estudios (que
concentra la señal curricular) quedaría comprimido al mismo tamaño que una
presentación de apoyo. El riesgo de calidad no está en pasar análisis en
lugar de documentos: está en un análisis pobre del documento que más
importa.

**C) E1 recibe solo fragmentos relevantes recuperados (RAG con embeddings).
DESCARTADA para este problema.**
La recuperación semántica brilla cuando el corpus no cabe en el contexto.
Aquí el corpus está acotado por diseño: máximo 10 fuentes por asignatura =
~20,000 tokens de análisis en el peor caso — cabe entero. Montar chunking +
embeddings + índice vectorial agrega infraestructura, costos y un modo de
fallo silencioso (si la recuperación omite una unidad del programa, la
Planeación sale incompleta sin que nadie lo note). Va contra la regla del
proyecto de no agregar complejidad innecesaria, y su fallo típico daña
justamente la calidad que queremos proteger.

**D) RECOMENDADA — "B mejorada": análisis diferenciado por rol de fuente +
selección estructural por etapa.**
Dos refinamientos sobre B, ninguno requiere infraestructura nueva:

1. **Análisis diferenciado por rol (en OP-01).** El clic de propósito que el
   docente ya da al subir la fuente (programa de estudios / temario /
   material) determina la profundidad del análisis. El **programa de
   estudios** recibe un análisis enriquecido (~3,000–4,000 tokens: unidades
   con contenidos mapeados, aprendizajes, competencias, propuesta de mapeo a
   parciales); las fuentes de apoyo reciben análisis ligeros (~1,000–1,500).
   Como el análisis se paga UNA sola vez, enriquecer el del documento clave
   es un seguro de calidad barato.
2. **Selección estructural por etapa (sin búsqueda semántica).** El análisis
   es JSON estructurado por unidades/temas; la selección de qué recibe cada
   etapa la hace el producto **por estructura**, no por similitud:
   - **E1 (tronco)** recibe el análisis completo del programa + las
     secciones de identidad curricular de las fuentes de apoyo ≈ ~8,000
     tokens de conocimiento → entrada total de E1 ≈ **~12,000**.
   - **E2 (bloque del parcial n)** recibe SOLO las unidades/temas que el
     tronco mapeó a ese periodo, con sus fragmentos de contenido ≈
     1,500–2,500 tokens → entrada total de E2 ≈ **~5,000–5,500**.

### Por qué D es el mejor equilibrio

- **Calidad:** el documento que más pesa (programa) recibe el tratamiento
  más rico, y cada bloque de parcial recibe contexto ENFOCADO en su periodo
  — menos ruido en el contexto suele producir mejores narrativas, no
  peores. La selección por estructura no puede "fallar en silencio" como el
  RAG: las unidades del periodo están mapeadas explícitamente en el tronco.
- **Costo:** E1 ≈ 12,000 (vs. ~14,000 de B uniforme y ~300,000 de A); E2
  apenas sube (~5,000 vs. 4,200 registrados). Además los análisis son
  bloques estables al inicio del prompt: en la generación E1 → E2×N de una
  misma sesión se benefician del caché del proveedor (cuantificación en
  Fase 6).
- **Escala al tope de 10 fuentes:** con selección por etapa, E2 queda
  acotado sin importar cuántas fuentes tenga la asignatura — el costo por
  bloque NO crece linealmente con las fuentes. B uniforme sí crecería.
- **Experiencia del docente:** idéntica — sube sus fuentes y da un clic de
  propósito; todo lo demás es interno.

### Implicación en tokens (NO aplicada — pendiente de aprobación)

Si Kike aprueba D, los ajustes al simulador serían: OP-02·E1 entrada 6,000 →
**~12,000**; OP-02·E2 entrada 4,200 → **~5,200**; OP-01 salida 2,000 →
**~3,500** para el programa de estudios (análisis enriquecido; fuentes de
apoyo ~1,200). Nada de esto se aplica hasta la aprobación.

> **Arquitectura D APROBADA por Kike el 9-ago-2026** como arquitectura de
> trabajo para OP-01 → OP-02·E1 → OP-02·E2: análisis diferenciado por rol,
> programa enriquecido, apoyos ligeros, E1 con conocimiento estructurado (no
> documentos originales), E2 solo con las unidades de su parcial, sin
> RAG/embeddings, y cada fuente analizada una sola vez.

## Segunda revisión de tokens bajo la arquitectura D (APROBADA — valores aplicados a las tablas el 9-ago-2026)

Elaborada el 9-ago-2026 a petición de Kike tras aprobar la arquitectura D.
**Los números del simulador y de las tablas anteriores NO se modifican
todavía.** El costo se estima con el modelo provisional de estas cuatro
operaciones (Claude Sonnet 5) a sus precios oficiales de lista — solo para
la estimación, sin convertirlo en decisión (M3 sigue abierta).

### 1–2. Tokens de entrada y salida revisados (por uso)

| Operación | Entrada | Salida | Composición de la entrada |
|-----------|--------:|-------:|---------------------------|
| OP-01 · Programa de estudios (análisis enriquecido) | 60,600 | 3,500 | PDF de 30 págs (~60,000) + sistema/asignatura (~600) |
| OP-01 · Fuente de apoyo (análisis ligero) | 24,600 | 1,200 | Documento de ~12 págs (~24,000) + sistema/asignatura (~600) |
| OP-02·E1 · Tronco | 12,400 | 1,500 | Base (600) + análisis del programa (3,500) + 4 análisis de apoyo (4,800) + catálogos oficiales (3,500) |
| OP-02·E2 · Bloque de parcial | 5,200 | 1,200 | Base (600) + tronco validado (1,500) + parcial real (300) + unidades del periodo (1,800) + catálogos parciales (1,000) |

### 3. Qué crece al pasar de 5 a 10 fuentes

- **OP-01: lineal** — cada fuente nueva paga su propio análisis, una sola
  vez (+24,600 entrada / +1,200 salida por fuente de apoyo adicional).
- **E1: crece solo el bloque de análisis de apoyos** — con 10 fuentes desde
  el inicio: 12,400 + 5 × 1,200 = **~18,400** de entrada (salida sin
  cambio). Nota: agregar fuentes DESPUÉS del arranque no regenera el tronco;
  el conocimiento nuevo lo usan las operaciones siguientes.

### 4. Qué permanece prácticamente constante

- **E2 es casi plano** (~5,200 con 5 o con 10 fuentes): la selección
  estructural manda a cada bloque solo las unidades de su periodo, sin
  importar cuántas fuentes tenga la asignatura. **Este es el beneficio
  central de la arquitectura D.**
- Las **salidas** de E1 (1,500) y E2 (1,200): el tronco y los bloques tienen
  el tamaño del formato, no de las fuentes. También constantes: catálogos,
  sistema y asignatura.

### 5–6. Costo estimado de UNA Planeación 1.0 completa (una asignatura, 3 parciales)

Modelo provisional: Claude Sonnet 5 · precios oficiales de lista $3 entrada /
$15 salida por millón de tokens (hay precio introductorio $2/$10 vigente
hasta el 31-ago-2026 — se indica aparte) · tipo de cambio de **referencia**
18.50 MXN/USD (parámetro ajustable en el simulador).

| Concepto | Con 5 fuentes | Con 10 fuentes |
|----------|--------------:|---------------:|
| OP-01 entrada (1 programa + apoyos) | 60,600 + 4×24,600 = 159,000 | 60,600 + 9×24,600 = 282,000 |
| OP-01 salida | 3,500 + 4×1,200 = 8,300 | 3,500 + 9×1,200 = 14,300 |
| E1 entrada / salida | 12,400 / 1,500 | 18,400 / 1,500 |
| E2 × 3 entrada / salida | 15,600 / 3,600 | 15,600 / 3,600 |
| **Total tokens entrada** | **187,000** | **316,000** |
| **Total tokens salida** | **13,400** | **19,400** |
| Costo entrada (× $3/M) | $0.561 | $0.948 |
| Costo salida (× $15/M) | $0.201 | $0.291 |
| **Costo total USD** | **≈ $0.76** | **≈ $1.24** |
| **Costo total MXN (@18.50)** | **≈ $14.10** | **≈ $22.90** |
| Con precio introductorio ($2/$10, hasta 31-ago-2026) | ≈ $0.51 USD ≈ $9.40 MXN | ≈ $0.83 USD ≈ $15.30 MXN |

**Lecturas clave (sin entrar en rentabilidad, que es de la siguiente fase):**

- Duplicar las fuentes (5 → 10) sube el costo de la Planeación ~63%, y casi
  todo el aumento es el análisis único de las fuentes extra (OP-01) — la
  generación en sí (E1+E2) apenas cambia gracias a la selección estructural.
- **El análisis de fuentes (OP-01) domina el costo**: ~85–90% del total de
  la Planeación. Cualquier optimización futura rinde más ahí (p. ej. PDFs
  de texto sin imágenes de página cuestan una fracción de los ~2,000
  tokens/pág asumidos — dato a verificar con mediciones reales).
- El costo es **por asignatura y una vez por semestre** (arranque). Estas
  cifras alimentarán el análisis de rentabilidad del Plan Docente de $99
  cuando Kike lo indique.
- El caché de prompts del proveedor puede abaratar la sesión E1 → E2×3
  (bloques estables repetidos); se cuantificará en la Fase 6.

---

# DECISIONES YA TOMADAS (registro fiel — no se modifican)

## Universo Curricular (decisión de producto — Kike, 10-ago-2026)

Diseño conceptual **aprobado**; implementación **no autorizada todavía**. La
carga de catálogos oficiales queda pendiente de decidir sus fuentes.

- El Universo Curricular será una **capa de referencia curricular**.
- **No sustituye a la Planeación.**
- La **Planeación** selecciona qué trabajar.
- La **actividad** determina qué se solicita.
- La **Rúbrica / Lista de Cotejo** se deriva del **Entregable u Observación**.
- Los **Reactivos** se derivan del **Cuestionario / Examen**.
- **La IA no puede inventar información curricular.**
- El currículo sirve para **contextualizar y validar**, no para introducir
  elementos que la actividad no solicita.
- El Universo Curricular **NO será obligatorio** para utilizar las funciones
  de IA: sin él, las operaciones funcionan igual y lo hacen saber.
- Cuando exista, se utilizará como **contexto curricular verificable**.

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

**Cierre:** inventario completo entregado y aprobado el 9-ago-2026 (sección
"FASE 3 — OPERACIONES DE IA · INVENTARIO"): las 13 operaciones de la lista
mínima + las 4 candidatas aprobadas = **17 operaciones en alcance**, con
O1–O4 resueltas. **Fase aprobada y cerrada por Kike el 9-ago-2026.**

## Fase 4 — Prompts y modelos
Para cada operación: contexto que recibirá, información específica que
necesita, resultado esperado, prompt y modelo recomendado. La Planeación
Didáctica 1.0 se analiza especialmente por compleja y extensa; **Claude se
evalúa para la generación inicial de la Planeación**; modificaciones pequeñas
y operaciones frecuentes pueden usar OpenAI u otro modelo si dan mejor
relación calidad/costo. Sin atadura conceptual a un solo proveedor.

**Cierre:** análisis completo entregado y aprobado el 9-ago-2026 (sección
"FASE 4 — PROMPTS Y MODELOS"): principios de diseño, bloques de contexto,
análisis especial de la Planeación 1.0 con generación por etapas (M4
aprobada), fichas de las 17 operaciones con prompts v1, Perfil IA mínimo (M1
aprobada) y borradores reales (M2 aprobada). M3: modelos solo como
candidatos de trabajo — la selección definitiva se hará con el simulador
económico. **Fase aprobada y cerrada por Kike el 9-ago-2026.**

## Fase 5 — Créditos IA
Sistema de créditos comprensible para el docente. El docente **nunca ve
tokens**; ve algo como "Plan Docente · 500 créditos IA mensuales · Te quedan
382". Cada operación tiene costo en créditos. El costo en créditos no tiene
que ser proporcional al costo en tokens: también pondera el valor recibido y
el ahorro de tiempo. D2 resuelta: los créditos van dentro del Plan Docente de
$99 MXN mensuales.

**Regla de Kike (9-ago-2026):** esta fase NO inicia sin haber realizado antes
el análisis económico de modelos y operaciones con el simulador externo en
Google Sheets. Primero se determina el costo real de las operaciones; a
partir de ahí se diseñan los créditos.

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
| 9-ago-2026 | Kike autoriza la Fase 3. Se entrega el inventario de operaciones de IA: OP-01 a OP-13 (lista mínima anclada al producto real, en tres familias + una transversal) y candidatas C-01 a C-04. Sin prompts, sin modelos, sin costos ni créditos. Decisiones O1–O4 abiertas. En revisión de Kike. |
| 9-ago-2026 | **Kike resuelve O1–O4 y aprueba la Fase 3.** Guía de observación como contenido IA sin instrumento nuevo (O1); planeaciones sencillas = plan de clase ligero, no burocrático (O2); entran las 4 candidatas, con regla especial para C-02: la IA solo sugiere calificación, nunca la guarda (O3); pestaña IA como casa central + invocación en el punto de uso (O4). Alcance final: **17 operaciones**. **Fase 3 CERRADA.** Fase 4 en espera de autorización. |
| 9-ago-2026 | Kike autoriza la Fase 4. Se entrega el análisis de prompts y modelos: principios de diseño, bloques de contexto estándar, dos escalones de modelo (Mayor: Claude Sonnet 5; Económico: Claude Haiku 4.5, con alternativa OpenAI a validar en Fase 6), análisis especial de la Planeación 1.0 con generación por etapas, fichas de las 17 operaciones con prompts v1 y propuesta de Perfil IA mínimo (2 campos). Sin costos ni créditos. Decisiones M1–M4 abiertas. En revisión de Kike. |
| 9-ago-2026 | **Kike resuelve M1–M4 y cierra la Fase 4.** M1 aprobada (Perfil IA con solo 2 campos opcionales); M2 aprobada (borradores reales — la IA nunca publica, activa ni califica sola); M3 NO definitiva (Sonnet 5 / Haiku 4.5 solo candidatos de trabajo; selección final con precios oficiales, comparación de calidad/tokens/costo y el simulador; OpenAI abierto); M4 aprobada (4 etapas: tronco → bloques → validación → integración; N parciales; bloque reutilizable para modificaciones). Regla nueva: **los créditos IA no se diseñan sin el análisis económico previo con el simulador.** **Fase 4 CERRADA.** |
| 9-ago-2026 | A petición de Kike se entrega la **estimación de tokens por operación** (entrada/salida por uso, con escenarios de referencia explícitos y la Planeación 1.0 desglosada por etapas) como insumo para el simulador en Google Sheets. Estimaciones ±30–50%, a calibrar con mediciones reales en Fase 11. Sin créditos, sin modelos definitivos, sin rentabilidad. |
| 9-ago-2026 | Se aclara C-04 (dos variantes: C-04a alumno 1,000/250 por llamada; C-04b grupo 1,500/350 en una sola llamada) y se entrega la **asignación PROVISIONAL de modelos** con los 6 candidatos del simulador (GPT-5.6 Sol/Terra/Luna; Claude Opus 4.8/Sonnet 5/Haiku 4.5). Las etapas 3 y 4 de la Planeación quedan explícitas como SIN IA (código del producto, 0 tokens). **M3 sigue abierta** — es insumo para el análisis económico, no decisión. |
| 9-ago-2026 | Se entregan las **frecuencias mensuales de uso** (escenario normal) para el simulador: perfil de referencia de 4 asignaturas × 35 alumnos × 3 parciales (semestre ≈ 4.5 meses), ~307 usos/mes totales. Observaciones clave: el mes 1 del semestre concentra el consumo de planeación (nota para el diseño de créditos en Fase 5) y C-02 es el motor de volumen (~200 usos/mes con fórmula explícita). Sin costos ni créditos. |
| 9-ago-2026 | **Kike corrige el modelo de consumo:** se reestructura en ARRANQUE (52 usos una vez por semestre: 20 fuentes iniciales + 4 troncos + 12 bloques + arranque de actividades/rúbricas/avisos) + RECURRENTE (~301 usos/mes). Reglas de fuentes registradas: ~5 iniciales por asignatura, acumulables, máx. 10 por asignatura (límite por asignatura, no por docente); cada fuente se analiza UNA vez y su conocimiento se reutiliza. OP-01 y OP-02 dejan de modelarse como mensuales. Se señala (sin modificar) la interacción con la tabla de tokens de E1 (5 fuentes vs 1 análisis asumido). |
| 9-ago-2026 | Kike aprueba conceptualmente el modelo arranque/recurrente y pide el análisis técnico de reutilización del conocimiento de las fuentes. Se entrega el análisis de las 4 arquitecturas (documentos completos / análisis estructurados / RAG / diferenciada): **se recomienda la D — análisis diferenciado por rol de fuente + selección estructural por etapa**, sin infraestructura nueva. Implicación en tokens señalada (E1 ~12,000; E2 ~5,200; análisis del programa ~3,500) pero **NO aplicada** — simulador, tokens y modelos sin cambios hasta aprobación de Kike. |
| 9-ago-2026 | **Kike aprueba la arquitectura D** como arquitectura de trabajo. Se entrega la **segunda revisión de tokens** bajo D (pendiente de aplicar al simulador): OP-01 programa 60,600/3,500; OP-01 apoyo 24,600/1,200; E1 12,400/1,500 (18,400 con 10 fuentes); E2 5,200/1,200 casi plano ante más fuentes. Costo estimado de UNA Planeación completa (Sonnet 5 provisional, precios de lista, TC ref. 18.50): **~$0.76 USD ≈ $14.10 MXN con 5 fuentes; ~$1.24 USD ≈ $22.90 MXN con 10**. OP-01 domina el costo (~85–90%). Sin créditos, sin modelos definitivos, sin cambios a Google Sheets. |
| 9-ago-2026 | **Kike aprueba las estimaciones D como valores de trabajo y se APLICAN a las tablas:** OP-01 dividido en OP-01a (60,600/3,500) y OP-01b (24,600/1,200); E1 12,400/1,500; E2 5,200/1,200; nuevas filas OP-02·GEN (28,000/5,100), PLAN·5F (187,000/13,400) y PLAN·10F (316,000/19,400) con los escenarios de fuentes separados. E3/E4 siguen sin IA. Arranque de referencia: 20 fuentes = 4 OP-01a + 16 OP-01b (costo de arranque, no recurrente). Ninguna otra operación, modelo ni frecuencia cambió; la pestaña de Consumo docente no se toca. CSV del simulador regenerado. |
| 9-ago-2026 | **Se actualiza directamente el Excel del simulador** (`Simulador_Costos_IA_Evalua_Facil_v4_alineado.xlsx` en el Drive, con respaldo previo `..._RESPALDO_2026-08-09.xlsx`): en "Operaciones IA" la fila OP-01 pasa a OP-01a con los nuevos tokens, E1/E2 actualizados, y se agregan OP-01b, OP-02-GEN, PLAN-5F y PLAN-10F (filas 23–26) con las mismas fórmulas de costo; en "Consumo docente" la fila OP-01 pasa a OP-01b (solo fuentes adicionales), se agregan notas de arranque en H2:H6 y se extienden los rangos de búsqueda de $22 a $26; se crea la hoja **"Arranque Planeacion"** (costo único por semestre, separado del recurrente). Frecuencias, modelos, precios y el plan de $99 intactos. Se detectan sin tocar: D3 de "Modelos API" con fecha en vez de precio (Terra) y referencias `$E$20` (en vez de `$E$23` TOTAL) en "Planes" y "Simulador". |
| 9-ago-2026 | Por instrucción de Kike se corrigen tres puntos del Excel del simulador: "Modelos API" D3 = 2.5 (número, formato restablecido); "Planes" F2:F4 y "Simulador" C2:C6 ahora apuntan al TOTAL `'Consumo docente'!$E$23`; "Arranque Planeacion" pasa a **5 asignaturas** de referencia, con derivados visibles: 25 fuentes iniciales (5×5) y 50 máximas activas (5×10) del docente de referencia. Se mantienen 5 fuentes iniciales y 10 máximas por asignatura. Nada más cambió. |
| 9-ago-2026 | Se cargan las **frecuencias recurrentes del escenario normal** en "Consumo docente" (C2:C22), escaladas de 4 a 5 asignaturas (×1.25 en las filas dependientes de asignaturas; instrucciones repartidas 6/4 entre generar y mejorar; planeación sencilla sin escalar). **Costo IA recurrente del docente de referencia: ~$22.81 MXN/mes** (TC 18.0, modelos provisionales). **Desfase detectado y señalado a Kike:** el simulador no tiene fila para "Retroalimentación personalizada" (OP-12 del documento maestro, ~31 usos/mes ≈ +$1.29 MXN) — su numeración difiere del doc (separa generar/mejorar instrucciones y omite retroalimentación). Pendiente de decisión. |
| 9-ago-2026 | Kike ordena incorporar la operación faltante: se agrega **OP-14 · Retroalimentación personalizada** al simulador (Operaciones IA fila 27: 1,300/200, Haiku 4.5; Consumo docente fila 23: 31 usos/mes). El TOTAL pasa a la fila 24 y las referencias de "Planes" y "Simulador" se actualizan a `$E$24`. **Nuevo costo IA recurrente: ~$24.09 MXN/mes** por docente de referencia. Nada más cambió. |
| 9-ago-2026 | Se crea la hoja **"Consumo intensivo"** (simulación separada; el escenario normal intacto): 5 asignaturas × 35 alumnos, con las operaciones de alto consumo incrementadas (C-02 a 700, retroalimentación a 100, modificar planeación a 20, plan de clase a 16, actividades a 15, reactivos a 12, instrucciones 12+10) y las poco frecuentes sin inflar (exámenes, rúbricas, cotejo, guías sin cambio). **Resultado: costo IA ~$53.28 MXN/mes; con ingreso de $99 → margen ~$45.72 (46.2%), antes de otros costos y sin contar el arranque.** Sin créditos, sin cambios permanentes de fórmulas. |
| 9-ago-2026 | Se crea la hoja **"Consumo tope 70"** (simulación separada; normal e intensivo intactos): escalando ~×1.47 solo las operaciones que realmente escalan con el uso (C-02 a 1,000 respuestas, retroalimentación a 150, modificar planeación a 30, plan de clase a 24, actividades a 22, reactivos 18, instrucciones 18+15, resumen de alumno 38; las ocasionales sin inflar). **Resultado: costo IA ~$69.42 MXN/mes; margen ~$29.58 (29.9%) contra los $99**, antes de otros costos. Conclusión operativa: llegar a ~$70 exige un uso extremo (≈1,400 usos/mes, dominado por C-02). |
| 9-ago-2026 | **Primera prueba REAL de calidad: C-02 con Claude Haiku 4.5** (3 respuestas de ~5 páginas con verdad plantada, caso de M1S1 Algoritmos). Resultados: orden y rangos correctos (buena 9.5 / mediocre 6.5 / deficiente 1.5), ~90% de los 15 errores plantados detectados (incluidos los sutiles: confusión MIENTRAS/REPETIR-HASTA, variable sin inicializar, bucle sin actualización de estado), citas textuales como evidencia, comentarios al alumno de calidad y revisión humana solicitada en los 3 casos. **Veredicto: APTO CON RESERVAS.** Reservas: (1) inconsistencia aritmética desglose-vs-total en 2 de 3 casos → el producto debe calcular el total sumando el desglose por código (refuerza el principio "EF calcula, la IA interpreta"); (2) ligera generosidad en el rango medio; (3) **salida real ~1,400 tokens por respuesta (≈7× lo estimado)** por el desglose JSON completo → costo real ≈ $0.19 MXN por respuesta extensa (vs $0.097 estimado) — recalibración de C-02 en el simulador pendiente de autorización de Kike. Costo de la prueba: ~$0.60 MXN. Kit y resultados en el scratchpad de la sesión. |
| 9-ago-2026 | **Aclaración estratégica de Kike:** la salida compacta de C-02 se prueba para optimizar costo y AMPLIAR la capacidad incluida en el Plan Docente de $99; los consumos extraordinarios NO los absorbe el plan de $99 — se atienden con el plan superior de mayor capacidad. |
| 9-ago-2026 | **Segunda prueba REAL de C-02 (salida compacta) con Haiku 4.5** — mismos materiales, la IA no entrega total (EF suma los criterios). Resultados: salida real ~706 tokens (vs ~1,425) → **costo por respuesta extensa $0.105 MXN (−38%)**; mezcla realista ≈ **$0.10/respuesta**. Calidad SIN degradación: puntuaciones por criterio prácticamente idénticas entre ambas pruebas (estabilidad test-retest excelente), detección de errores plantados igual o mejor (cazó el relleno de la mediocre que la prueba 1 no señaló), evidencia citada y retroalimentación útil. Hallazgos: (1) la generosidad del rango medio se confirma a nivel criterio (mediocre suma 7.5 en AMBAS pruebas — es del juicio por criterio, no del formato); (2) en la respuesta buena devolvió `requiere_revision_humana: false` pese a la instrucción de fijarlo en true → EF debe forzar ese campo por código; (3) un tercer "error" en la buena fue un matiz menor no plantado. Con salida compacta: C-02 en el escenario de 20 trabajos × 50 alumnos ≈ **$105/mes** (vs $163) y el escenario normal completo queda en ≈ **$40/mes**. Sin cambios a Excel, precios, modelos ni producto. |
| 9-ago-2026 | **Se abre la Fase 5 (prerequisito cumplido) con la PROPUESTA INICIAL DE CRÉDITOS v1**, objetivo de Kike: bolsa del plan de $99 con costo máximo ≈ $29. Propuesta: **bolsa mensual de 350 créditos**; todo lo cotidiano = 1 crédito (incluida cada respuesta C-02 compacta); rúbrica 3; examen/cuestionario 10; fuente de apoyo 20; programa 45; tronco 12; bloque 8. Consumida completa con la mezcla normal cuesta ≈ **$28.96**; techo absoluto (todo C-02) ≈ $35. El patrón normal completo requeriría ~490 créditos ($40.5): la bolsa cubre cómodamente el trabajo cotidiano + ~170 respuestas C-02; la calificación masiva y el ARRANQUE semestral (5 planeaciones ≈ 805 créditos ≈ $70 una vez por semestre) quedan explícitamente FUERA de la bolsa mensual — pendientes de decisión de Kike (bolsa de arranque semestral y/o plan superior, conforme a su aclaración estratégica). En revisión. |
| 9-ago-2026 | Comparación de escalas visibles para la misma bolsa (~$29): 35, 100, 350 y 1,000 créditos. Hallazgo estructural: la operación cotidiana (1 respuesta C-02) es la unidad atómica y no puede costar menos de 1 crédito, así que las escalas de 35 y 100 obligan a fracciones, paquetes o a borrar la diferencia de precio entre operaciones; 1,000 obliga a tablas de multiplicar (cotidiana=3) o a redondeos que distorsionan hasta 10%. **Recomendación única: escala de 350** — cotidiana=1, enteros simples en todo (1/3/10/20/45/12/8), aritmética mental directa ("me quedan 214 = 214 acciones"). En revisión de Kike. |
| 9-ago-2026 | Análisis del **Plan Mayor** (Plan Docente de $99 con 350 créditos: cerrado). Los escenarios del simulador traducidos a créditos con la tarifa v1: **intensivo ≈ 1,165 créditos/mes** ($53.28 de costo) y **alto consumo (tope ~$70) ≈ 1,570 créditos/mes** ($69.42). **Recomendación única: Plan Mayor de 1,750 créditos mensuales (5× el Plan Docente)** — cubre al intensivo con 50% de holgura y al de alto consumo con ~11%; techo absoluto de costo $175 (todo C-02), costo esperado consumido completo en mezcla intensiva ~$70–78. Precio del Plan Mayor NO fijado (pendiente). Sin cambios al Excel ni a los 350 del Plan Docente. En revisión de Kike. |
| 9-ago-2026 | **Propuesta de precio del Plan Mayor: $199 MXN/mes** (1,750 créditos). Costo IA considerado: $70–78 (bolsa prácticamente completa en mezcla intensiva). Margen: **$121–129 (61–65%)**; incluso en el techo teórico absoluto ($175, todo C-02) no hay pérdida. Justificación comercial: el doble del precio por 5× los créditos (por crédito, 2.5× más barato que el plan base); ancla psicológica limpia contra los $99. En revisión de Kike. |
| 10-ago-2026 | **Kike aprueba la REGLA TRANSVERSAL "Fuente inmediata vs. contexto curricular"** y se registra como sección propia del documento (T.1–T.10), antes de la Fase 3 porque la gobierna. Establece: (1) la fuente inmediata es la única que puede ORIGINAR elementos, el contexto curricular solo contextualiza, comprueba alineación, aporta terminología válida y detecta inconsistencias; (2) **Universo Curricular ≠ Planeación Didáctica** — el Universo es el marco validado que sale de las fuentes, la Planeación es la decisión del docente sobre él (cadena: fuentes → universo → planeación inicial → planeación viva → actividad); (3) jerarquía A–E con la regla de que **una propuesta de IA nunca asciende a fuente curricular** por haber sido aceptada o guardada, y que un elemento de evaluación no puede saltarse la actividad para justificarse en el currículo; (4) **rúbricas y listas de cotejo exigen actividad padre (entregable u observación) como fuente inmediata**, y el currículo NO puede agregar criterios que la actividad no solicite; (5) reactivos pertenecen a su evaluación padre; (6) regla de no invención: si falta información se informa al docente, no se completa; (7) trazabilidad mínima del instrumento (actividad padre, versión del marco, procedencia de criterios, si el docente editó). Se corrigen las contradicciones detectadas: §2.11.6 (sus capas son contexto, no origen), reglas transversales de la Fase 3, §4.3 (nuevo bloque `[FUENTE_INMEDIATA]` y nota de lectura), fichas OP-06/OP-07/OP-08/OP-09 en §4.5 y las filas correspondientes de la tabla de tokens. **Ninguna decisión aprobada se eliminó; ningún valor de tokens, modelo, tarifa ni frecuencia cambió; el simulador no se tocó.** Se registra que `bancoRubricas` NO se modifica en esta fase, y que Universo Curricular y Planeación Viva siguen SIN implementar (Fase 11 no iniciada). Diagnóstico académico y diagnóstico de contexto quedan señalados como entidades aún no definidas. Solo documentación: sin código, sin despliegue. |
| 10-ago-2026 | **Kike registra la decisión de producto sobre el Universo Curricular** (diseño conceptual aprobado; implementación NO autorizada, sin carga de catálogos): capa de referencia curricular que no sustituye a la Planeación; la Planeación selecciona, la actividad determina lo que se solicita, la rúbrica/cotejo se deriva del entregable u observación y los reactivos del cuestionario/examen; la IA no inventa información curricular; el currículo contextualiza y valida, no introduce elementos que la actividad no pide; **el Universo NO es obligatorio para usar la IA** y, cuando exista, será contexto curricular verificable. Queda anotado que **no hay ninguna fuente curricular en el repositorio** (los PDF oficiales viven en el Drive de Kike) — la auditoría de fuentes queda pendiente. Se autoriza la implementación de OP-06 y OP-07 con las reglas ya aprobadas. |
