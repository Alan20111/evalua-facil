# PLAN MAESTRO DE INTEGRACIÓN DE IA — EVALÚA FÁCIL

**Documento único y vivo.** Toda la hoja de ruta de la integración de IA vive aquí.
No se crean documentos paralelos; cada fase actualiza este mismo archivo.

- **Creado:** 9 de agosto de 2026
- **Última actualización:** 9 de agosto de 2026 — Dudas D1–D4 resueltas por
  Kike. Fase 1 aprobada. Fase 2 autorizada, en espera de los tres PDF
  oficiales de Planeación Didáctica.
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
| 2 | Planeación didáctica | **Autorizada — bloqueada** en espera de los tres PDF oficiales |
| 3 | Operaciones de IA | No iniciada |
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
Fase 6.

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
evaluaciones con ponderaciones. La referencia institucional serán los **tres
PDF oficiales de Planeación Didáctica** que Kike va a proporcionar (D1
resuelta): se usan solo como referencia de requisitos, sin copiar su
complejidad a la experiencia del docente. **En espera de esos tres archivos
para poder iniciar.**

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
precio base del análisis es $99 MXN mensuales (no usar $116).

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
