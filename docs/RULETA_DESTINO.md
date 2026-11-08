# La Ruleta del Destino — especificación

Actividad educativa interactiva de Evalúa Fácil. El docente prepara con IA un banco de preguntas de opción múltiple a
partir de sus documentos; cada participante gira una ruleta que **solo selecciona una pregunta** del banco (sin
premios, puntos extra, multiplicadores, penalizaciones ni segundas oportunidades).

> Estado (7-nov-2026): fases 0, 1 y 2 en el commit local `e52565e0` de la rama `feat/ruleta-destino-fase0` (worktree
> `evalua-facil-ruleta`); partida individual interna (paso 1) en `37ad199e`; resultados y calificaciones (paso 2) en
> `37db5c9e`; solo modalidad individual en `b7d59b7f`; borrado seguro (paso 3) terminado **sin commit**. Sin PR y sin
> despliegue. Cada fase se autoriza por separado (`AGENTS.md`); la autorización de una fase no autoriza la siguiente
> ni el despliegue.

- Lógica pura: `src/utils/ruletaDestino.js` · pruebas: `test/ruleta-destino.test.mjs` (`node test/ruleta-destino.test.mjs`)
- Reglas: bloque «La Ruleta del Destino» de `firestore.rules` (helpers `esRuleta`, `esRuletaExterna`,
  `ruletaFormaValida`, `ruletaBienFormada`, `ruletaIntacta` y las colecciones `ruleta*`) · pruebas: sección
  `RULETA ·` de `test/firestore-rules.test.mjs` (`npm run test:rules`, necesita JDK 21)

La Ruleta es **independiente de Reto Exprés**: categoría propia (`ruleta`), colecciones propias (`ruleta*`), helpers de
reglas propios. No modifica Reto Exprés ni reutiliza su código con estado.

---

## 1. Especificación funcional

### Modalidad: solo individual (7-nov-2026)
Cada estudiante entra cuando quiere, gira su ruleta y contesta 5 o 10 preguntas por su cuenta; puede salir y volver, y
se conserva su progreso. **No hay concurso en vivo, proyección, ranking ni desempate**: la participación y la
competencia en tiempo real son de Reto Exprés. La actividad guarda `ruleta.modalidad: 'individual'` (las reglas y el
servidor rechazan cualquier otro valor) y nunca lleva `ranking`.

### Formas de acceso
- **Interno** (`interno`): estudiantes de la asignatura con su cuenta habitual; resultados ligados a su inscripción.
- **Externo** (`externo`): enlace y QR, sin cuenta; resultados ligados a la partida y al identificador que defina el
  docente. Siempre oculta, sin calificación académica y sin entregas (R5).

### Banco de preguntas
Solo dos tamaños de partida: 5 y 10 preguntas (las de 20 se eliminaron el 7-nov-2026). Hay **dos configuraciones
distintas que no deben mezclarse** (decisión del PO, 7-nov-2026):

**Generación con IA** (`reactivosGeneracionIA(n)`, `RULETA_CFG.REACTIVOS_IA_POR_PREGUNTA = 5`): cantidad EXACTA que
pide y verifica una generación.

| Preguntas por partida | Reactivos que genera la IA | Precio |
|---:|---:|---:|
| 5 | 25 | 5 créditos |
| 10 | 50 | 10 créditos |

**Banco manual** (`tamanoBanco(n)` = mínimo, `RULETA_CFG.REACTIVOS_POR_PREGUNTA = 10`; `maximoBanco(n)` = máximo,
`RULETA_CFG.REACTIVOS_MAXIMOS_POR_PREGUNTA = 20`):

| Preguntas por partida | Mínimo | Máximo |
|---:|---:|---:|
| 5 | 50 | 100 |
| 10 | 100 | 200 |

**Aprobación según el origen del banco** (`minimoBanco(n, origen)`; el máximo es el mismo para los dos orígenes):

| Origen | Mínimo con 5 preguntas | Mínimo con 10 preguntas | Máximo (5 / 10) |
|---|---:|---:|---:|
| `ia` | 25 | 50 | 100 / 200 |
| `manual` | 50 | 100 | 100 / 200 |

- Opción múltiple: 4 opciones, 1 correcta, 3 distractores plausibles; sin duplicados ni paráfrasis triviales;
  sustentados en el documento del docente: **exactamente un documento por generación, un PDF con texto o un DOCX**
  (nunca varios ni combinados; el .doc antiguo no se convierte: el docente lo convierte a PDF o DOCX; un PDF escaneado
  sin texto verificable se rechaza antes de cobrar).
- Si el documento no alcanza: se **cancela** la generación y se **reembolsan** los créditos reservados.
- **Generación con IA solo con el banco vacío** (6-nov-2026): genera exactamente `reactivosGeneracionIA(n)` (25 o 50,
  7-nov-2026), nunca los faltantes ni una cantidad parcial, y nunca `tamanoBanco(n)`. Si el banco ya tiene reactivos,
  se informa al docente y no se cobra: los conserva y lo completa a mano, o los elimina para generar con IA. El banco
  generado queda con origen `ia` y sin aprobar.
- El docente revisa, edita, elimina, sustituye y aprueba el banco (siempre mediante acciones del servidor, R1).
- **Mínimo para iniciar y aprobar**: el de su origen (tabla de arriba); con más también se inicia y no se recorta nada.
  Con menos: `banco_incompleto` (`validarBanco` / `evaluarAprobacion`).
- **Máximo** (F2-4): 100 o 200 para los dos orígenes. Un reactivo más se rechaza con `banco_lleno`; un banco por encima
  del máximo no se aprueba (`banco_excedido`).
- **Origen del banco** (7-nov-2026), campo `origen` de `ruletaBancos/{actividadId}`:
  - Lo escribe SOLO el servidor (`api/_lib/ruletaBanco.js`, `datosBanco`), tomado del estado leído en la transacción;
    nunca del cuerpo de la petición. Las reglas no dejan escribir `ruletaBancos` a ningún cliente (ni al dueño ni al
    admin), así que el navegador no puede crear un banco `ia` ni cambiar uno manual a `ia`.
  - Un banco nace `manual` (`bancoVacio`). Solo la generación con IA de la fase 3 lo dejará en `ia`.
  - Editar, agregar o borrar reactivos **no** cambia el origen (`guardarEnBanco` y `quitarDeBanco` lo conservan). Un
    banco IA al que se le borran reactivos por debajo de su mínimo queda incompleto: no se aprueba ni se juega. No hay
    sustitución automática ni generación parcial (fase 3).
  - **Excepción** (7-nov-2026): borrar el último reactivo (total exactamente 0) deja el banco en `manual`. Lo que el
    docente capture después cumple los mínimos manuales (50 o 100); un banco vaciado nunca vuelve a aprobarse con los
    de IA. El cambio ocurre en la misma transacción que el borrado (`quitarDeBanco`), así que dos borrados simultáneos
    se serializan y solo el que deja el banco en 0 cambia el origen.
  - Solo el valor exacto `ia` cuenta como IA (`origenBanco`); ausente o cualquier otro valor se trata como `manual`, el
    mínimo mayor: un dato extraño nunca baja el mínimo.
  - Cambiar las preguntas por partida (`config`) usa el mínimo del origen para el nuevo tamaño.
- **Tarifa** (6-nov-2026): el precio depende de las preguntas por partida (5 o 10 créditos, tabla de generación), no de
  los reactivos generados. El servidor calcula el precio (operación y tarifa propias, modelo Claude Haiku 4.5); nunca confía en el importe del
  navegador. Si la generación falla o no se completa, se reembolsa todo. Girar, responder y jugar no consumen créditos.
  Nunca se llama a la IA en un giro.

### Sustento documental (6-nov-2026)
Cada reactivo trae una **cita** literal y un **contexto**: una o dos oraciones contiguas y literales del documento que
contienen la cita. El contexto es siempre obligatorio. Cita y contexto se comparan con el documento normalizado
(minúsculas, sin acentos, espacios unidos y cortes de línea con guion unidos).

- **Se acepta** solo si la cita y el contexto aparecen **completos en una sola página**; se registra esa página. En un
  DOCX (sin páginas) deben aparecer una sola vez en el documento y la página queda vacía.
- Una cita repetida en varias páginas se acepta solo si su contexto aparece en una sola página.
- **Nunca** se asigna la primera página por defecto ni se guardan varias páginas.
- Una cita corta no se acepta solo porque aparezca una vez: la cita y el contexto deben aportar evidencia suficiente.

Motivos de rechazo, contados por separado:

| Motivo | Cuándo |
|---|---|
| `reactivo_invalido` | Falla la forma (4 opciones, 1 correcta, largos) |
| `duplicado` | Repite o parafrasea otro reactivo |
| `cita_inexistente` | La cita no aparece en el documento |
| `cita_ambigua` | La cita y su contexto aparecen en varias páginas |
| `cita_no_verificable` | La cita o el contexto cruzan dos páginas; el contexto no contiene la cita, no es literal o no son 1–2 oraciones; falta la cita o el contexto |

### Mecánica
1. Girar → la ruleta (decorativa) revela la siguiente pregunta del orden que el **servidor** sorteó al entrar (sin
   repetición dentro de la partida; cada participante con su combinación).
2. 15 segundos **exactos** por pregunta, medidos con el reloj del servidor; **sin margen adicional**. A los 15 000 ms
   todavía cuenta; después, incorrecta.
3. Sin respuesta = incorrecta. Solo cuenta la primera respuesta; no hay giros fuera de las rondas autorizadas.
4. La respuesta correcta nunca viaja al navegador antes de responder.

**Partida individual interna** (paso 1, 7-nov-2026; `api/_lib/ruletaPartida.js`, acción `ruleta-partida`, pantalla
`/alumno/ruleta/:id`). Decisiones del PO:
- **Una sola partida por estudiante** (`ruletaParticipantes/{actividadId}_{alumnoId}`); al volver continúa donde se
  quedó. Si la pregunta abierta venció mientras estaba fuera, queda registrada como sin respuesta.
- Durante la partida solo se muestra «Respuesta registrada» o «Se acabó el tiempo»; al final, la calificación sobre 10
  y cuántas acertó. **La respuesta correcta nunca sale del servidor**, ni durante ni al final.
- **Las opciones no se mezclan** por participante (se muestran en el orden del banco).
- Solo se juega con la ruleta individual e interna, visible para el estudiante y con el banco aprobado y completo.
- Al iniciar, el servidor sortea con azar criptográfico y **guarda una copia** de las preguntas sorteadas en la partida:
  editar el banco después no la cambia. La primera partida pone `preguntasCongeladas` (R8).
- Cada respuesta se guarda también en `ruletaRespuestas/{participante}_{i}`.

**Resultados y calificaciones** (paso 2, 7-nov-2026). Decisiones del PO:
- **Publicación automática:** al terminar la partida (última respuesta o última pregunta vencida), en la MISMA
  transacción el servidor escribe `submissions/{actividadId}_{alumnoId}` con `estado: 'calificado'`,
  `ultimaCalificacionPor: 'servidor'`, `sinEntrega: true` y `ruleta: { participanteId, correctas, total }`. No puede
  quedar una partida terminada sin su intento de nota ni una nota registrada dos veces. El historial de notas y el aviso
  al estudiante salen de los triggers de siempre (`onCalificacionCambiada`, `onSubmissionActualizada`).
- **Parcial cerrado definitivamente:** no se inicia, no se gira ni se responde (`PARCIAL_CERRADO`) y no se escribe nada;
  quien ya terminó sigue viendo su resultado. Al reabrirlo continúa donde iba (la pregunta que estaba abierta vence).
- **Nota previa del docente:** si la entrega ya trae una calificación, se conserva; el participante guarda
  `nota: { estado: 'conservada', motivo: 'nota_previa' }` y la pantalla final lo dice. La nota automática de cierre
  (`esNotaAutomaticaDeCierre`) sí se reemplaza, sin su marca `cierreParcial`.
- **Nota oculta** (`calificacionesOcultas`): la nota se registra, pero la pantalla final no muestra ni la nota ni los
  aciertos («Tu docente publicará tu calificación más adelante»).
- **Docente:** sección «Resultados» en la pantalla de la ruleta (`ResultadosRuleta.jsx`): estado, aciertos,
  calificación, qué pasó con la nota y el detalle por pregunta (opción elegida, la correcta y el tiempo). Lee
  `ruletaParticipantes` filtrando por su `docenteId`. La corrección sigue por el camino de siempre de las entregas (R4).
- **Estudiante:** en su lista, Pendiente / En curso / Terminada con la calificación. «En curso» sale de la operación
  `estados` (solo lectura, nunca crea partidas); la nota, de su entrega, que ya respeta la visibilidad.
- Una partida que se queda con la última pregunta abierta se termina (y registra la nota) cuando el estudiante vuelve a
  entrar; mientras tanto aparece «En curso».

### Calificación
- **Calificación = (correctas ÷ total de preguntas) × 10**, con el redondeo de las evaluaciones
  (`calcularCalificacion`). La rapidez nunca cambia la calificación. Las preguntas no jugadas cuentan como incorrectas.
- Cálculo y **publicación automáticos** para el acceso interno, respetando los mecanismos de calificación existentes.
- Sin ranking (7-nov-2026). El resultado de la partida conserva `tiempoCorrectasMs` como dato, sin uso en la nota.

---

## 2. Decisiones del Product Owner

### Funcionales (6-nov-2026)
1. Tarifa por preguntas de la partida: 5 → 5 créditos, 10 → 10 créditos (reemplaza «1 crédito por reactivo»). Sin
   cobro proporcional. (La partida de 20 → 20 créditos se eliminó el 7-nov-2026.)
2. Documento insuficiente: cancelar y reembolsar la reserva.
3. Archivos .doc antiguos: sin conversión.
4. ~~Desempate: tiempo acumulado solo en respuestas correctas.~~ Sin efecto: ya no hay ranking (decisión 16).
5. Calificación: cálculo y publicación automáticos, respetando los mecanismos actuales.
6. Banco manual mínimo de 10 reactivos por pregunta (50 o 100) y máximo de 20 (100 o 200); con más del mínimo
   también inicia. Un banco generado con IA se aprueba con 5 por pregunta (25 o 50) (7-nov-2026, decisión 15).
7. Exactamente 15 s, sin margen.
8. ~~Empate exacto: comparten puesto; orden por id solo visual.~~ Sin efecto: ya no hay ranking (decisión 16).
9. Un solo documento por generación: un PDF con texto o un DOCX.
10. La IA genera solo con el banco vacío y siempre exactamente 25 reactivos para 5 preguntas o 50 para 10.
11. Cita y contexto obligatorios y verificables en una sola página (en DOCX, una sola aparición); citas ambiguas,
    inexistentes y no verificables se rechazan con su motivo.
12. Una cita que cruza dos páginas es `cita_no_verificable`: no se usa la página de inicio ni dos páginas.
13. La longitud mínima de la cita no se fija todavía: se propondrá con los datos de la calibración y requerirá
    autorización.
14. (7-nov-2026) Se eliminan definitivamente las partidas de 20 preguntas: solo 5 y 10. Se aplica en la lógica
    (`RULETA_CFG.PREGUNTAS_POR_PARTIDA`), en el servidor (`api/_lib/ruletaBanco.js`) y en las reglas
    (`ruletaFormaValida`).
15. (7-nov-2026) La generación con IA y el banco manual son configuraciones separadas: la IA genera 25 o 50
    (`reactivosGeneracionIA`); el banco manual va de 50 a 100 o de 100 a 200 (`tamanoBanco`, `maximoBanco`). El
    mínimo para aprobar depende del origen del banco (`ia`: 25 o 50; `manual`: 50 o 100), que guarda y protege el
    servidor en `ruletaBancos.origen`.
16. (7-nov-2026) **Se elimina definitivamente la modalidad en vivo**: la Ruleta es solo individual. Fuera el concurso,
    la proyección, el ranking, el desempate y las colecciones `ruletaSesiones`, `ruletaClaves` y `ruletaResultados`
    (sin reglas: nadie las lee ni las escribe desde un cliente). La competencia en tiempo real es de Reto Exprés.
17. (7-nov-2026, paso 3) **Borrado seguro, como en Reto Exprés**: el docente dueño borra su ruleta aunque ya tenga
    partidas, y el trigger `onRuletaBorrada` limpia en el servidor el banco, las partidas, las respuestas y las
    entregas que quedaran (con su historial). El borrado de cuenta elimina directamente partidas y respuestas. Las
    partidas de un estudiante dado de baja (o de «empezar de cero») se quedan con la ruleta y se ven como «Estudiante
    dado de baja» hasta que se borre la ruleta o la cuenta.

### Seguridad (R1–R8, 6-nov-2026)
- **R1** Solo el servidor escribe `ruletaReactivos`; el docente administra el banco con acciones del API. Ningún cliente
  escribe en las colecciones protegidas.
- **R2** El docente no borra sus partidas directamente: al borrar la ruleta, las limpia el trigger `onRuletaBorrada`.
- **R3** Las claves congeladas las leen el docente dueño y el admin; nunca estudiantes, externos ni otros docentes.
- **R4** El docente corrige una nota por el camino existente de `submissions` (guardián de entregas, bloqueo de parciales
  cerrados y auditoría en `calificacionHistorial`). El estudiante nunca modifica su nota.
- **R5** Una ruleta externa es siempre oculta, sin calificación académica, sin entregas en `submissions` y sin
  incorporación automática al historial académico.
- **R6** Categoría, modalidad y acceso no cambian después de crear. `preguntasPorPartida` lo fija el cliente solo al
  crear; después, cambiarlo es una acción del servidor (sin partidas y con el banco mínimo del nuevo tamaño). Después
  de crear, el cliente no cambia nada del mapa `ruleta` (desde el 7-nov-2026 ya no existe `ranking`).
- **R7** El admin lee todas las colecciones `ruleta*` salvo `ruletaCupos` y `ruletaIdentificadores`, que no lee nadie.
- **R8** Al iniciar la primera partida, el servidor pone `ruleta.preguntasCongeladas = true` en la misma transacción:
  desde ahí las preguntas por partida ya no cambian. El cliente nunca crea, cambia ni quita la bandera. **Cambiado en
  el paso 3 (decisión 17):** el docente dueño sí borra una ruleta con partidas (con las reglas de cualquier actividad,
  incluido el parcial cerrado) y el trigger `onRuletaBorrada` la limpia por completo, sin huérfanos.

### Dependencias de borrado (C1–C3, 6-nov-2026)
- **C1** Eliminar asignatura: `src/utils/deleteSubjectCascade.js` borra recursos y materiales y después las
  actividades, en lotes desde el cliente. Antes del paso 3, una ruleta jugada hacía fallar ese lote y dejaba la
  asignatura sin notas pero a medias. **Resuelto en el paso 3:** las reglas ya dejan borrarla y el trigger limpia el
  resto; `deleteSubjectCascade.js` no cambió.
- **C2** Borradores sin partidas: desde la fase 2 ya tienen banco (`ruletaReactivos` y `ruletaBancos`). El trigger
  de limpieza al borrar la actividad (`onRuletaBorrada` en `functions/index.js`, `functions/ruletaLimpieza.js`) se
  adelantó y quedó **implementado en la fase 2** (F2-2); el paso 3 le agregó partidas, respuestas y entregas, y la
  fase 3 (IA) le agregará `ruletaGeneraciones`. Seguro, idempotente y sin tocar otras actividades.
- **C3** Eliminar cuenta: `api/account/delete.js` (Admin SDK) borra el banco, su estado, las partidas y las respuestas
  del docente (paso 3), sin depender del trigger; sus entregas ya se borraban por actividad.

---

## 3. Modelo de seguridad

Dos capas, cada una con su responsabilidad:

- **Reglas de Firestore** (`firestore.rules`): impiden que un cliente (navegador, consola o app modificada) lea o
  escriba directamente el banco, los participantes, las respuestas o la configuración
  protegida de la actividad, o escriba una nota en una entrega de ruleta. Rechazan consultas sin filtro de dueño.
- **Servidor** (Admin SDK en `api/` y Cloud Functions; **no pasa por las reglas**): identidad (sesión de estudiante
  inscrito o token de externo), selección de preguntas, reloj de 15 s, primera respuesta, calificación, publicación de
  notas (comprobando él mismo el parcial cerrado con `parcialCerrado` de `functions/_shared/ponderacion.js` y sin pisar
  una corrección del docente), bandera `preguntasCongeladas` y lo que ve cada participante. Lo que el servidor
  garantiza se prueba en las fases de servidor, no en las reglas.

Los estudiantes y los participantes externos **nunca leen Firestore** directamente: lo que les toca (su pregunta sin
clave, su resultado) lo reciben del servidor. Las reglas no pueden filtrar campos de un documento; por eso «cada quien
ve solo lo suyo» lo garantiza el servidor.

### Permisos por colección y rol
| Colección | Docente dueño | Otro docente | Admin | Estudiante | Externo / sin sesión | Servidor |
|---|---|---|---|---|---|---|
| `ruletaReactivos` | Lee | ✗ | Lee | ✗ | ✗ | Escribe |
| `ruletaGeneraciones` | Lee | ✗ | Lee | ✗ | ✗ | Escribe |
| `ruletaParticipantes` | Lee | ✗ | Lee | ✗ | ✗ | Escribe |
| `ruletaRespuestas` | Lee | ✗ | Lee | ✗ | ✗ | Escribe |
| `ruletaCupos` | ✗ | ✗ | ✗ | ✗ | ✗ | Escribe |
| `ruletaIdentificadores` | ✗ | ✗ | ✗ | ✗ | ✗ | Escribe |
| `activities` (`categoria: 'ruleta'`) | Crea y edita con candado; borra (también con partidas) | ✗ | Lee | ✗ | ✗ | Pone la bandera |
| `submissions` de ruleta interna | Lee y corrige (R4) | ✗ | Lee | Lee la suya; nunca escribe | ✗ | Publica la nota |
| `submissions` de ruleta externa | Nadie crea ni modifica (sí borra una que existiera por error) | ✗ | — | ✗ | ✗ | No escribe |

Lectura del dueño = `resource.data.docenteId == request.auth.uid` (campo que escribe el servidor). Toda consulta del
docente debe filtrar por `docenteId`. `ruletaSesiones`, `ruletaClaves` y `ruletaResultados` (del concurso en vivo,
eliminado el 7-nov-2026) ya no tienen reglas: nadie los lee ni los escribe desde un cliente.

### Candados de la actividad (`activities`)
- **Crear** (`ruletaBienFormada`): mapa `ruleta` con `modalidad` (solo `individual`), `acceso` (`interno` |
  `externo`) y `preguntasPorPartida` (5 | 10); ninguna otra clave (tampoco `ranking`) y **nunca**
  `preguntasCongeladas` (ni en `false`). Externa: `oculta: true`, `sinCalificacion: true`, sin `publishAt` ni
  `publishedAt`.
- **Actualizar** (`ruletaIntacta`): nada entra ni sale de la categoría; el mapa `ruleta` no cambia
  (modalidad, acceso, preguntas y bandera quedan exactamente igual, también si se reemplaza el mapa completo); la forma
  sigue siendo válida (externa sigue oculta y sin calificación). Los demás campos (nombre, parcial, publicar en
  internas) siguen las reglas de cualquier actividad.
- **Borrar**: las reglas de cualquier actividad (dueño; no en un parcial cerrado si cuenta), también con partidas
  (paso 3). La limpieza la hace el trigger `onRuletaBorrada`.

### Candados de las entregas (`submissions`)
- Crear y actualizar: en una ruleta solo pasa el camino del docente dueño
  (`!esRuleta(...) || (isDocente() && ownsActivity(...))`): el estudiante nunca escribe su entrega ni su nota.
- Crear y actualizar: nunca en una ruleta externa (`!esRuletaExterna(...)`), ni del docente.
- `submissions/{id}/respuestas`: ningún cliente escribe en una entrega de ruleta.
- Sin cambios: lectura del estudiante de su propia entrega, camino del docente (escala, guardián, parcial cerrado) y
  borrado de entregas; `calificacionHistorial` sigue cerrada a cualquier cliente.

### Cambios en reglas existentes
Solo adiciones, salvo cinco líneas existentes en las que únicamente el `;` final pasó a `&&` para sumar la condición
de la Ruleta (autorizado el 6-nov-2026): `activities` crear, `activities` actualizar o borrar, `submissions` crear,
`submissions` actualizar y `submissions/{id}/respuestas` escribir. Los helpers y bloques de Reto Exprés no cambiaron.
Cada condición nueva devuelve «sin efecto» en cuanto la categoría no es `ruleta`.

---

## 4. Colecciones (todas las escribe solo el servidor)

| Colección | Contenido previsto | Lectura |
|---|---|---|
| `ruletaReactivos/{id}` | Enunciado, 4 opciones, correcta, fuente (documento y página si es viable), estado | Dueño, admin |
| `ruletaGeneraciones/{clave}` | Trabajo de generación por lotes: pedidos, entregados, estado | Dueño, admin |
| `ruletaParticipantes/{actividadId}_{alumnoId}` | La partida: orden sorteado, copia de las preguntas, avance, resultado y qué pasó con la nota | Dueño, admin |
| `ruletaRespuestas/{participante}_{i}` | Reactivo, opción, correcta, tiempo, motivo | Dueño, admin |
| `ruletaCupos/{código}_{n}` | Cupo de externos | Nadie |
| `ruletaIdentificadores/{…}` | Unicidad del identificador externo | Nadie |

Todos los documentos llevan `docenteId` y `actividadId`. Las colecciones no existen todavía en producción. Las del
concurso en vivo (`ruletaSesiones`, `ruletaClaves`, `ruletaResultados`) se eliminaron del diseño el 7-nov-2026.

---

## 5. Riesgos y dependencias

| Riesgo | Medida |
|---|---|
| El Admin SDK no pasa por las reglas | Cada acción del servidor verifica identidad, propiedad y estado; pruebas de servidor contra el emulador |
| Publicar notas desde el servidor saltaría el bloqueo de parcial cerrado | El servidor usa `parcialCerrado` y no pisa una corrección del docente (`ultimaCalificacionPor`) |
| Borrar asignatura con una ruleta jugada (C1) | Resuelto en el paso 3: se borra y el trigger limpia |
| La limpieza es asíncrona y depende del despliegue de Functions | Idempotente; si fallara, los restos no los lee ningún cliente y repetirla es seguro |
| Borradores con banco (C2) | Trigger de limpieza implementado en la fase 2; la fase 3 lo amplía a `ruletaGeneraciones` |
| Residuos al eliminar la cuenta (C3) | Resuelto en el paso 3 en `api/account/delete.js` |
| Límite de lecturas de las reglas en lotes | Probado: lote de 10 notas mezcladas (ruleta y entregable) pasa |
| Desplegar reglas | El CI las despliega al fusionar en `main`: fusionar es desplegar; requiere autorización aparte |

---

## 6. Fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Lógica pura: banco, sorteo, partida, tiempo, calificación (el ranking se retiró el 7-nov-2026) | Hecha |
| 1 | Reglas de seguridad y su documentación | Hecha (sin commit) |
| 2 | Crear la actividad y editor del banco (acciones del API), lista de actividades, copias excluidas, trigger de limpieza de borradores (C2) y borrado de cuenta | Hecha (autorizada; sin commit) |
| 3 | IA del banco (lotes, reembolso total, sustento documental); la sustitución de reactivos queda pendiente hasta definir su tarifa | Sin autorizar (implementación) |
| 4 | Servidor individual: unirse, girar, responder, estado, recuperación; bandera `preguntasCongeladas` | Hecha para acceso interno (paso 1, commit `37ad199e`) |
| 5 | Pantallas individuales (celular y docente) | Pantalla del estudiante (paso 1) y resultados del docente (paso 2, sin commit) |
| 6 | ~~Concurso en vivo y ranking~~ | **Eliminada** (7-nov-2026, decisión 16): la competencia en vivo es de Reto Exprés |
| 7 | Publicación automática de calificaciones | Hecha para acceso interno (paso 2, sin commit) |
| 8 | Borrado definitivo con limpieza, borrado de asignatura (C1) y de cuenta (C3) | Hecha (paso 3, sin commit) |
| 9 | Prueba real y de carga | Sin autorizar |

## 7. Condiciones de despliegue

- Ninguna fase se despliega sin autorización expresa y separada.
- Las reglas de la fase 1 pueden desplegarse solas sin riesgo (colecciones vacías, ninguna pantalla crea ruletas),
  pero se recomienda desplegarlas junto con el servidor.
- La fase 8 (borrado seguro, C1 y C3) quedó hecha en el paso 3: se despliega junto con la partida. Fusionar en `main`
  despliega web, reglas y Functions a la vez; requiere autorización aparte.
- El trigger de limpieza de borradores (C2) debe estar en producción antes o junto con la generación del banco.

## 8. Pendientes de definición

- Identificación de externos, prevención de duplicados y recuperación al cambiar de dispositivo.
- Límite de participantes externos (referencia: Reto Exprés usa 40, decisión E7, medido solo en el emulador).
- El costo de sustituir un reactivo.
- Conservación de datos de externos.
- **Longitud mínima de la cita**: se medirá en la calibración (longitud de citas aceptadas y rechazadas, ambigüedad
  según la longitud, capacidad del contexto para identificar una sola página) y se propondrá con esos datos; requiere
  autorización antes de ser regla.
- **Evidencia suficiente**: cómo comprobar que la cita y el contexto sustentan de verdad el reactivo (medida automática
  aproximada más revisión humana de una muestra en la calibración); pendiente de validación.
- **Criterio de separación de oraciones**: cómo se cuentan «una o dos oraciones» del contexto (abreviaturas, listas sin
  punto, renglones partidos); debe ser determinista y se medirá en la calibración.
