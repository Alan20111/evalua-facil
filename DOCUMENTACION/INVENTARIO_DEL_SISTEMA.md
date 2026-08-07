# Plan Maestro de Validación — Evalúa Fácil

**Documento oficial de aseguramiento de calidad** · Última actualización:
6 de agosto de 2026 · Commit `6b7f026` · Rama `main`

---

# 0. Qué es este documento

Este es el **documento oficial que dirige todas las auditorías de Evalúa
Fácil**. No hay otro. Contiene seis cosas que se sostienen entre sí:

1. **Las evidencias** — qué prueba que una auditoría de verdad se ejecutó, y sin
   lo cual no puede darse por terminada (§3).
2. **El inventario** — qué existe en el sistema, agrupado en módulos, con sus
   dependencias y su nivel de riesgo (§5).
3. **Las fases** — en qué bloques se ejecuta el trabajo, qué hace falta para
   empezar cada uno y cuándo se puede dar por cerrado (§6).
4. **El plan** — qué auditoría se hace, qué debe revisar, qué debe intentar
   romper y cuándo se puede dar por terminada (§7).
5. **La bitácora** — en qué va cada una (§8).
6. **Los riesgos abiertos** — lo que se encontró y todavía no se cierra (§9).

**Cómo se usa.** Se abre en las fases, se toma la primera que no esté cerrada y
se ejecutan sus auditorías **en el orden en que están listadas, sin detenerse
entre una y otra**: la ficha de cada una está en §7, las reglas en §1, el
protocolo de cierre en §2 y el expediente que hay que dejar en §3. Al terminar
la fase se entrega su informe y se sigue con la siguiente. Las cuatro únicas
razones para detenerse antes están en §6, *Cuándo detenerse*.

**Cómo evoluciona.** Cada auditoría lo modifica: marca su estado, anota su
commit, agrega los riesgos residuales que no pudo cerrar y corrige el inventario
si encontró algo que aquí no estaba. Un módulo nuevo en el proyecto es un módulo
nuevo aquí, con su ficha y su lugar en una fase. Ver §10, *Vigencia y
re-auditoría*: esto no se ejecuta una vez y se archiva.

**Una sola verdad por dato.** El inventario dice qué existe; el plan dice qué
hacer con ello; la bitácora dice cómo va; los riesgos dicen qué falta. Ningún
dato se repite en dos lugares: si una ficha de auditoría necesita saber qué
archivos toca, remite al módulo (M-xx) en vez de volver a listarlos.

**Dónde vive el resto.** Este archivo es la única referencia de **calidad**.
`docs/PROYECTO.md` es la referencia **técnica** del producto (cómo funciona cada
cosa) y `CLAUDE.md` la guía de trabajo para agentes. Cuando algo cambie en el
sistema, los tres se actualizan; cuando cambie una auditoría, solo este.

---

# 1. Reglas generales de toda auditoría

Aplican a las veinticuatro. No se repiten en cada ficha.

## 1.1 Sobre qué es una restricción

- **Ocultar un botón no es una restricción.** Toda regla de negocio se prueba
  contra el servidor: reglas de Firestore, Cloud Functions o endpoint. Si solo
  vive en el navegador, no existe.
- **El cliente nunca es fuente de verdad** para nada que otorgue acceso,
  vigencia, dinero o calificación. Si un dato de esos viaja desde el navegador,
  o se valida en el servidor o se calcula ahí.
- **Toda vulnerabilidad se reproduce antes de corregirse.** Primero se prueba
  contra el emulador que el ataque funciona; después se corrige; después queda
  como caso permanente en `test/firestore-rules.test.mjs`. Un hallazgo sin
  reproducir es una sospecha, no un hallazgo.

## 1.2 Sobre no romper a quien ya trabaja

- **Leer y exportar nunca se bloquean.** Un docente sin suscripción vigente
  puede consultar y descargar todo lo suyo. El candado es sobre el trabajo
  nuevo, no sobre lo que ya hizo.
- **Un dato que falta nunca deja a nadie fuera.** Campo ausente = se deja pasar.
  Los documentos viejos no traen los campos nuevos y sus dueños no tienen la
  culpa.
- **La app de Android instalada lleva su propio paquete.** Una regla nueva tiene
  que aceptar lo que manda la versión publicada en Google Play, o esperar a que
  se publique la actualización. Verificarlo es obligatorio antes de desplegar
  reglas: se revisa qué manda esa versión, no la del árbol de trabajo.
- **Compatibilidad hacia atrás en los datos.** Si un campo cambia de forma, los
  documentos viejos siguen leyéndose. Si hace falta una migración, se escribe y
  se corre antes, no después.

## 1.3 Sobre Firestore

- Solo consultas de igualdad. **Sin rangos (`<`, `>`, `!=`), sin `orderBy`.** Se
  ordena en memoria.
- Todo índice compuesto va en `firestore.indexes.json` y se despliega antes de
  usarse.
- Las reglas no pueden consultar colecciones: solo `get()`/`exists()` por ruta
  exacta. Cuando haga falta un dato de otra colección, se espeja con una Cloud
  Function (como `users/{uid}.suscripcionHasta`).
- `exists()` antes de cada `get()`: leer un documento que no existe revienta la
  evaluación completa de la regla.
- **Las reglas de lectura se prueban también como consulta**, no solo documento
  por documento: una regla que permite leer un documento propio puede permitir,
  o no, listar la colección entera. Son dos permisos distintos.

## 1.4 Sobre las condiciones en que se prueba

Cinco condiciones que ninguna auditoría puede saltarse. Las tres primeras son
donde aparecieron los peores hallazgos hasta hoy.

- **Dos a la vez.** Dos pestañas del mismo usuario, dos personas sobre el mismo
  documento, la web y el teléfono al mismo tiempo. Toda operación que cambie
  algo importante se prueba concurrente, y la pregunta es siempre la misma: ¿qué
  pasa si el segundo llega con datos viejos?
- **Sin red y con red mala.** Cortar la conexión a media operación. Nada puede
  quedar aplicado a medias: o entra todo o no entra nada.
- **Con datos viejos.** Documentos creados antes del cambio, sin los campos
  nuevos. Y con la app de Android publicada, no con la del árbol de trabajo.
- **Con el reloj en contra.** Zonas horarias, cambio de día a medianoche, el
  reloj del dispositivo movido a mano. Todo lo que dependa de una fecha
  —vencimientos, límites de entrega, asistencia, tiempo de examen— se resuelve
  en el servidor o se prueba contra un reloj mentiroso.
- **Con volumen.** Un grupo de 50 estudiantes, un docente con 8 asignaturas, un
  examen de 60 reactivos, un ciclo completo de asistencias. Lo que funciona con
  tres registros puede no funcionar con los de verdad.

## 1.5 Sobre los datos de prueba

- Todo dato de prueba en producción lleva el prefijo **`zztest-`** y se borra al
  terminar. Nada de nombres reales.
- Lo destructivo se prueba **contra el emulador**, nunca contra producción.
- Si una prueba deja residuo, limpiarlo es parte de la auditoría, no una tarea
  aparte.

## 1.6 Sobre el trabajo

- **Una rama por auditoría**, nombrada `fix/auditoria-<módulo>`. Nunca se
  trabaja directo en `main`.
- **Estagear rutas explícitas** (`git add <archivos>`), nunca `git add .` ni
  `git stash`: puede haber otra sesión trabajando en el mismo árbol.
- **Orden de despliegue: Cloud Functions → reglas de Firestore → web.** Las
  funciones tienen que existir antes de que una regla dependa de ellas.
- **Sin `typecheck`.** El proyecto es JavaScript, sin TypeScript. Se reporta
  como "no aplica", no como omisión.
- **Azul para docente y administrador, nunca índigo.** Tailwind con clases de
  utilidad; sin CSS suelto.

## 1.7 Sobre el alcance de las decisiones

- **Corregir, no solo diagnosticar.** Una auditoría que entrega una lista de
  problemas sin arreglarlos no está terminada.
- **Lo que no se pueda corregir se documenta** en §9 con su causa y una
  propuesta concreta, no con un "queda pendiente".
- **Ninguna decisión de producto se inventa.** Precios, políticas, textos de
  cara al usuario, qué se cobra, qué se borra, qué se le muestra a quién: si la
  auditoría topa con una de esas, se marca **Bloqueada**, se explica la
  disyuntiva y se pregunta al Product Owner. Todo lo demás —lo técnico, lo
  mecánico, lo que solo tiene una respuesta correcta— se resuelve sin preguntar.
- **Si la corrección cambia lo que el usuario ve, paga o recibe, se pregunta
  antes.** Aunque técnicamente sea la respuesta correcta.
- **Se corrige lo que aparezca en el camino**, aunque sea de otro módulo, si no
  introduce regresiones y queda documentado por qué hizo falta.

## 1.8 Quién decide qué

| Papel | Quién | Decide sobre |
|---|---|---|
| Product Owner | Kike (docente-dueño) | Precio, políticas, textos, qué se cobra y qué se borra, prioridades |
| Firebase, Vercel, Brevo, Play | Kike | Credenciales, despliegues, cuentas |
| Cloudinary | Alan | Llaves de API, preset de subida, cuota (ver R3) |
| Técnico | La auditoría | Todo lo que tiene una sola respuesta correcta |

## 1.9 Reglas oficiales del proyecto

Decisiones del Product Owner que ya no se discuten en cada auditoría: son parte
del sistema. Toda auditoría que toque estos terrenos las da por dadas.

**RO-1 · La migración del alcance de lectura es un solo proyecto.**
`R7` (lectura pública de `students`), `R8` (lectura pública de `users`) y `R9`
(un docente lee entregas y asistencias de toda la plataforma) **no son tres
arreglos: son uno**. Comparten causa —reglas escritas para un documento mientras
el cliente consulta colecciones— y comparten remedio. Su **cierre definitivo
depende de que el cliente Web y el de Android migren por completo sus consultas
a endpoints del servidor**; hasta entonces ninguna auditoría intenta cerrarlos
por su cuenta, y quien los encuentre los documenta y sigue. *(PO, 5-ago-2026.)*

**RO-3 · Una dependencia de otra persona se registra y no detiene la auditoría.**
*(PO, 6-ago-2026.)* Cuando una auditoría topa con algo que solo puede resolver
un tercero —Alan con Cloudinary, o cualquier credencial, Vercel, Firebase, DNS o
cuenta externa—, se **anota como riesgo en §9 y se sigue con todo lo demás**.
Cuatro consecuencias, que no se discuten en cada auditoría:

- **Lo que un tercero ya entregó y marcó como resuelto está cerrado.** No se
  vuelve a pedir su comprobación administrativa. Si el trabajo tiene efecto sobre
  el sistema, se valida por su efecto —con una prueba técnica— no preguntando si
  lo hizo.
- **Una comprobación administrativa nunca es motivo para detenerse** si existe
  una forma objetiva de validar el resultado desde el sistema. Si se puede medir,
  se mide.
- **Solo se detiene la auditoría cuando la dependencia hace técnicamente
  imposible continuar**, no cuando la vuelve incómoda.
- La dependencia registrada **no impide cerrar** la auditoría ni la fase: vive en
  §9 con su dueño hasta que su dueño la resuelva.

**RO-2 · Eliminar un docente nunca borra la cuenta de un estudiante que sigue
con otro docente.**
Un estudiante tiene UNA cuenta que cubre todas sus inscripciones (ver
`finishActivation`), así que borrar a un docente no puede arrastrarla. Al
eliminar un docente se borra **solo lo exclusivamente suyo**: sus relaciones,
sus asignaturas y actividades, sus archivos y sus datos. Si a raíz de eso un
estudiante queda sin relación con ningún docente, podrá aplicársele después la
política de eliminación del sistema, pero **nunca como consecuencia inmediata**
de borrar al docente. *(PO, 5-ago-2026. La implementa y verifica A10.)*

---

# 2. Protocolo de cierre de una auditoría

Al terminar el trabajo, en este orden:

1. **Corregir todo lo encontrado.** Nada queda como reporte. Lo que
   genuinamente no se pueda cerrar, a §9 con propuesta concreta.
2. **Verificar.** `npm run lint`, `npm run build` y `npm run test:rules` (este
   último requiere JDK 21 — el de Android Studio sirve: `JAVA_HOME="/c/Program
   Files/Android/Android Studio/jbr"`). El `typecheck` se reporta como no
   aplicable.
3. **Respaldar antes de desplegar.** Copia de `firestore.rules` y de
   `functions/index.js` tal como están en producción, fuera del árbol de
   trabajo. Es lo que permite volver atrás en un minuto si algo sale mal.
4. **Commit con Conventional Commits**, en su rama, con el cuerpo explicando qué
   se cerró y por qué importaba. Push inmediato, PR, squash-merge.
5. **Desplegar** lo que lo necesite, en el orden de la regla 1.6.
6. **Verificar en producción.** Que `evalua-facil.vercel.app/version.json`
   responda el commit recién mergeado, y que las reglas desplegadas sean las del
   PR. Vercel llega a limitar despliegues y dejar producción atrasada sin avisar.
7. **Actualizar este documento**: estado en la bitácora, commit y PR, riesgos
   residuales nuevos, número de casos de prueba, y cualquier corrección al
   inventario.
8. **Continuar automáticamente con la siguiente auditoría de la fase**, sin
   esperar instrucción — salvo que esté Bloqueada por una decisión del Product
   Owner, en cuyo caso se salta a la que sigue y se avisa. Si era la última de
   la fase, se cierra la fase (§6).

## Definición de Terminado

Una auditoría está Completada cuando cumple **las seis**:

1. Todo hallazgo está corregido, o registrado en §9 con causa y propuesta.
2. Cada vulnerabilidad se reprodujo antes de corregirse, y quedó como caso
   permanente de prueba.
3. **El expediente de evidencias está completo** — las doce piezas de §3, con
   hechos reproducibles en las tres que no admiten palabra: el agujero, su
   cierre y la ausencia de regresiones.
4. `lint` y `build` limpios; la suite de reglas completa en verde.
5. Desplegado y verificado en producción.
6. Este documento actualizado.

**Cobertura mínima.** Toda auditoría de un módulo Crítico deja al menos un caso
legítimo en verde y un ataque en rojo por cada superficie que tocó. Si un módulo
no se puede cubrir con la suite de reglas, la ficha dice con qué evidencia se
sustituye — nunca se queda sin ninguna.

---

# 3. Evidencias de auditoría

Una auditoría que no se puede verificar después es indistinguible de una que
nunca se hizo. Esta sección define qué prueba que el trabajo fue real.

No es papeleo. Es lo que permite que otra persona —o uno mismo dentro de seis
meses— confirme tres cosas: que el agujero existía, que quedó cerrado, y que al
cerrarlo no se rompió nada más. Sin eso, "Completada" es solo una palabra que
alguien escribió en una tabla.

## 3.1 Qué cuenta y qué no

Una sola regla: **evidencia es lo que otra persona puede volver a producir, o lo
que quedó guardado.** Lo demás es narración.

| No es evidencia | Sí es evidencia |
|---|---|
| "Revisé las reglas y están bien" | El caso que falla con las reglas viejas y pasa con las nuevas |
| "El endpoint valida el token" | La llamada sin token y la respuesta exacta que devolvió |
| "El PDF sale correcto" | El PDF generado y abierto, con el dato concreto que se cotejó |
| "No hay regresiones" | La suite completa en verde, con el conteo antes y después |
| "Lo probé en móvil" | El ancho medido, la pantalla y lo que se vio |
| "Es seguro" | El ataque intentado y el error que devolvió |

Lo de la izquierda puede ser perfectamente cierto. El problema es que **no se
distingue de lo falso**, y una auditoría existe justamente para quitar esa duda.

## 3.2 El expediente

Doce piezas. Lo que no aplique se declara como no aplicable **con su motivo**;
nunca se omite en silencio.

| # | Evidencia | Qué debe contener | Qué la invalida |
|---|---|---|---|
| 1 | **La vulnerabilidad antes de corregirla** (cuando exista) | La prueba de que el agujero era real, obtenida **antes** de tocarlo: la salida del emulador, la respuesta del servidor, el dato que no debió aparecer | Describir el ataque sin haberlo corrido. O intentarlo después de la corrección: que hoy falle no demuestra que ayer funcionara |
| 2 | **Explicación técnica del problema** | Por qué era posible, en términos del código: qué regla faltaba, qué campo no se validaba, qué se dio por sentado. Quien no estuvo debe entender el mecanismo | "Había un problema de seguridad en el módulo X" |
| 3 | **Explicación de la solución** | Qué se cambió y **por qué así y no de otra forma**. Si se descartó una alternativa, por qué se descartó | Contar el diff en prosa |
| 4 | **Archivos modificados** | La lista, con una línea por archivo diciendo qué cambió en él y para qué | La lista sola — eso ya lo da `git` |
| 5 | **Pruebas ejecutadas** | Qué se corrió y con qué resultado: `lint`, `build`, la suite con su conteo, y cada verificación manual con sus pasos | "Todo pasó", sin números ni comandos |
| 6 | **Que la corrección funciona** | El mismo ataque de (1), ahora fallando. **Y el caso legítimo, todavía pasando**: una corrección que también bloquea a quien sí tenía derecho no está corregida | Probar solo que el ataque falla |
| 7 | **Que no hubo regresiones** | Suite completa en verde con el conteo antes y después, `build` limpio, y el recorrido del flujo principal del módulo tocado. Si el cambio alcanza a otros módulos, se nombran y se dice cómo se comprobaron | Correr únicamente los casos nuevos |
| 8 | **Commit asociado** | El mensaje completo, en Conventional Commits, explicando qué se cerró y por qué importaba | Un mensaje de una línea sin cuerpo |
| 9 | **Hash del commit** | El de la rama, el de `main` tras el squash y el número de PR. Los tres: el de la rama desaparece del historial | Solo uno de los tres |
| 10 | **Fecha** | La de ejecución, no la de redacción del informe | — |
| 11 | **Tiempo aproximado invertido** | En rangos: menos de una hora · unas horas · un día · varios días. Sirve para planear las fases que siguen y para saber lo que cuesta de verdad la calidad | Tomarlo como meta. Una auditoría que terminó rápido porque se saltó cosas es peor que una lenta |
| 12 | **Riesgos residuales** | Lo que quedó abierto, con causa y propuesta, ya registrado en §9. **Si no hay ninguno, se dice** — "no quedó nada abierto" es un hallazgo; el silencio no dice nada | Dejar el apartado vacío |

## 3.3 Dónde vive cada cosa

| Qué | Dónde | Cuánto dura |
|---|---|---|
| El informe completo | Cuerpo del PR | Permanente |
| El razonamiento de cada cambio | Mensaje del commit y comentarios en el código | Permanente |
| Los casos de prueba | `test/firestore-rules.test.mjs` | Permanente — **no se borran nunca** |
| Artefactos: PDF, Excel, capturas, mediciones | Scratchpad de la sesión | **Se pierde al cerrarla** |
| El resumen de una línea y el estado | Bitácora, §8 | Permanente |

El scratchpad desaparece. Por eso todo artefacto que sostenga una conclusión se
**transcribe al informe**: el dato exacto que se verificó y los pasos para
volver a generarlo. Un PDF que ya no existe y del que solo queda "se veía bien"
no prueba nada.

## 3.4 Cuando la evidencia no puede existir

Hay cosas que ninguna prueba automatizada alcanza: que un manual siga
describiendo lo que la plataforma hace, que un texto se entienda, que una
declaración ante Google Play sea cierta. Ahí la evidencia es la **comparación
documentada**: qué dice el documento, qué hace el sistema, y el cotejo lado a
lado de los dos.

Lo que **no** es una salida es bajar la exigencia sin decirlo. Si una
verificación no se pudo hacer —falta un acceso, una credencial, un dispositivo—
se nombra, se explica por qué, y ese punto se va a riesgos residuales (§9). Una
auditoría puede cerrar con partes sin verificar; lo que no puede es cerrar
fingiendo que las verificó.

## 3.5 La regla

> **Ninguna auditoría se marca «Completada» si no existe evidencia suficiente
> para demostrar que realmente fue ejecutada.**

*Suficiente* quiere decir: las doce piezas presentes o declaradas como no
aplicables, y las tres que no admiten palabra —**la 1, la 6 y la 7**: el
agujero, su cierre y la ausencia de regresiones— sostenidas con hechos
reproducibles.

Una auditoría sin esa evidencia no está Completada: está **En proceso**, y así
se queda en la bitácora hasta que la evidencia exista. No hay estado intermedio
para "la hice pero no puedo demostrarlo".

Vale también hacia atrás: si al revisar una auditoría vieja se ve que su
expediente no alcanza, vuelve a **Pendiente**. Repetirla cuesta menos que
confiar en que se hizo.

## 3.6 Plantilla del expediente

Se llena en el cuerpo del PR de cada auditoría.

```markdown
## Auditoría A-- · <nombre>            Fase F- · <fecha> · <tiempo aproximado>

### 1. El agujero, antes de tocarlo
<salida real: emulador, respuesta del servidor, dato que no debía aparecer>
<si no hubo vulnerabilidades: "Ninguna. Lo que se intentó romper y falló: ...">

### 2. Por qué era posible
<mecanismo, en términos del código>

### 3. Qué se cambió y por qué así
<solución, y las alternativas descartadas con su motivo>

### 4. Archivos modificados
- `ruta/archivo` — qué cambió y para qué

### 5. Pruebas ejecutadas
- `npm run lint` → <resultado>
- `npm run build` → <resultado>
- `npm run test:rules` → <n> casos (<antes> → <después>)
- Verificaciones manuales: <pasos y resultado>

### 6. Que la corrección funciona
- El ataque de (1), ahora: <resultado>
- El caso legítimo, todavía: <resultado>

### 7. Que no hay regresiones
<suite completa, build, recorrido del flujo principal, módulos vecinos>

### 8-9. Commit
<mensaje> · rama `<hash>` · main `<hash>` · PR #<n>

### 10-12. Cierre
Fecha: <fecha> · Tiempo: <rango> · Riesgos residuales: <R-- o "ninguno">
```

---

# 4. Cómo leer el inventario

| Campo | Qué significa |
|---|---|
| **Descripción** | Qué resuelve el módulo, en una frase que se entienda sin abrir el código |
| **Archivos** | Dónde vive. Rutas relativas a la raíz del proyecto |
| **Depende de** | Otros módulos (M-xx) y servicios externos que necesita |
| **Riesgo** | **Crítico**: dinero, acceso a cuentas ajenas, datos de menores o calificaciones · **Alto**: interrumpe el trabajo de un grupo o expone lo que debía quedarse en su lugar · **Medio**: molesta, pero tiene rodeo · **Bajo**: cosmético o fuera del producto |
| **Auditoría** | Cuál del plan lo cubre |

## El sistema en números

| | |
|---|---|
| Archivos de código en `src/` | 191 (33 páginas · 71 componentes · 66 utilidades · 9 hooks) |
| Rutas de navegación | 28 + comodín |
| Colecciones de Firestore | 30 raíz + 2 subcolecciones |
| Cloud Functions | 14 |
| Endpoints serverless (Vercel) | 9 activos de 12 permitidos + 4 pausados |
| Módulos funcionales | 33 — **11 Críticos**, 14 Altos, 5 Medios, 3 Bajos |
| Auditorías planeadas | 24 (2 completadas) |
| Fases de ejecución | 7 (una cerrada) |
| Casos de prueba automatizados | 62 (reglas de Firestore) |

## Cobertura

Los 33 módulos están cubiertos, salvo dos a propósito: **M29** (pruebas) es el
instrumento de todas las demás, y **M30** (documentación) no tiene
comportamiento que auditar. Ningún otro módulo queda huérfano.

## Las cuatro capas

```
PRODUCTO      Lo que el usuario usa: asignaturas, actividades, evaluaciones,
              calificaciones, asistencia, avisos, calendario, perfiles.
              M05 – M13, M19, M20, M31, M32

NEGOCIO       Lo que sostiene al producto como servicio: identidad,
              suscripción, pagos, panel de administración.
              M01 – M04

PLATAFORMA    Lo que hace que todo lo anterior funcione y llegue:
              navegación, diseño, notificaciones, correo, exportaciones,
              archivos, catálogos, Android, Firebase, Functions, API.
              M14 – M18, M21 – M27

SOPORTE       Lo que no se despliega pero sostiene el trabajo: semillas,
              scripts, pruebas, documentación, herramientas auxiliares.
              M28 – M30, M33
```

---

# 5. Inventario de módulos

## CAPA DE NEGOCIO

### M01 · Autenticación e identidad

**Descripción.** Quién es cada quien y cómo entra. Tres tipos de usuario sobre
una misma Firebase Auth: docente (correo real o Google), estudiante (correo
falso `usuario.escuela@evalua.local`) y administrador (docente con
`role: 'admin'`). Incluye alta de docentes, activación de estudiantes por
código/QR, recuperación y cambio de contraseña, vinculación de cuenta de Google
con contraseña, y la migración de nombres de usuario heredados.

**Archivos.** `src/context/AuthContext.jsx` · `src/pages/teacher/Login.jsx`,
`Register.jsx`, `ResetPassword.jsx`, `VerifyEmail.jsx`, `ProtectAccount.jsx`,
`Onboarding.jsx` · `src/pages/student/Login.jsx`, `Activation.jsx` ·
`src/components/LinkAccountModal.jsx`, `PasswordInput.jsx` ·
`src/utils/authLinking.js`, `googleAuth.js`, `generate.js`, `teacherAccount.js`,
`studentIdentity.js`, `studentLookup.js`, `accountEmails.js` ·
`api/student/recover-password.js` · reglas `users`, `students`, `schools`

**Depende de.** M24 · M26 · M15 · M18 · Firebase Auth · Google Sign-In nativo

**Riesgo.** **Crítico** — es la puerta de entrada de todo lo demás.

**Auditoría.** A04

### M02 · Suscripciones y candado de acceso

**Descripción.** Desde cuándo y hasta cuándo un docente puede trabajar. Prueba
de 30 días que crea el servidor, planes de 1 a 6 meses, cortesías, cancelación,
y el candado de dos capas: el cliente que abre la ventana de pago y las reglas
de Firestore que comparan `request.time` contra `users/{uid}.suscripcionHasta`.
Consultar y exportar nunca se bloquean; escribir sí.

**Archivos.** `src/hooks/useSubscription.js` ·
`src/utils/subscriptionHelpers.js`, `situacionSuscripcion.js`,
`firestoreGuard.js`, `exportWatermark.js` ·
`src/components/SuscripcionVencidaModal.jsx` ·
`functions/index.js` (`onSuscripcionEscrita`, `sincronizarCandadoSuscripcion`,
`onDocenteCreado`) · `firestore.rules` (`docenteActivo`, `suscripcionHasta`) ·
`seeds-db/backfill-suscripcion.js` · `api/account/cancel-subscription.js`

**Depende de.** M01 · M03 · M24 · M25 · M16

**Riesgo.** **Crítico** — decide quién trabaja y quién no, y de él cuelga el cobro.

**Auditoría.** A01 — Completada

### M03 · Pagos

**Descripción.** Cómo entra el dinero. En v1.0.1, solo transferencia bancaria
con aprobación manual: el docente declara folio y comprobante, el administrador
lo coteja contra el estado de cuenta y aprueba, y esa aprobación —dentro de una
transacción— activa la suscripción. Mercado Pago y PayPal quedaron pausados con
su código intacto.

**Archivos.** `src/components/CheckoutModal.jsx` ·
`src/pages/admin/components/PaymentsTable.jsx`, `PaymentConfig.jsx` ·
`src/hooks/usePaymentConfig.js` · `src/pages/teacher/PagoResultado.jsx` ·
`src/pages/teacher/Profile.jsx` (reenvío de un pago rechazado) ·
`src/utils/subscriptionHelpers.js` (tarifas, armador del pago, validaciones) ·
`api/mp/webhook.js`, `api/_lib/billing.js`, `api/_lib/paypal.js` ·
`api/_pausado/` (4 endpoints) · `functions/index.js` (`onPagoCreado`,
`onPagoResuelto`) · reglas `payments`, `plans`, `config/payments`

**Depende de.** M02 · M04 · M17 · M14 · Mercado Pago y PayPal (pausados)

**Riesgo.** **Crítico** — es dinero.

**Auditoría.** A02 — Completada

### M04 · Panel de administración

**Descripción.** La consola del dueño: resumen de altas y cobros, tabla de
suscripciones (con plan, vigencia, días sin accesar y acciones manuales), tabla
de pagos con aprobar/rechazar/archivar, tabla de estudiantes y la configuración
de los datos bancarios que ve el docente.

**Archivos.** `src/pages/admin/Dashboard.jsx` ·
`src/pages/admin/components/` (`StatsCards`, `SubscriptionsTable`,
`PaymentsTable`, `StudentsTable`, `StatusBadge`, `PaymentConfig`) ·
`src/hooks/useAdminStats.js`, `useColumnWidths.js` ·
`src/components/AdminLayout.jsx` · `api/admin/last-access.js`

**Depende de.** M01 · M02 · M03 · M06 · M24

**Riesgo.** **Crítico** — desde aquí se otorga y se quita el servicio a
cualquiera, y se ven los datos de todos.

**Auditoría.** A11 (sus tablas de pagos y suscripciones ya se revisaron en A01 y A02)

## CAPA DE PRODUCTO

### M05 · Asignaturas

**Descripción.** El contenedor de todo el trabajo del docente: grupo, ciclo,
parciales con sus fechas, código de acceso para que entren los estudiantes,
color e ícono, archivar, duplicar y eliminar en cascada.

**Archivos.** `src/pages/teacher/SubjectPage.jsx`, `Dashboard.jsx` ·
`src/components/Layout.jsx` (lista lateral y alta de asignatura),
`ParcialesFechas.jsx`, `SubjectIcon.jsx`, `IconSelect.jsx`, `PaletteSelect.jsx` ·
`src/utils/copySubject.js`, `deleteSubjectCascade.js`, `subjectIcons.js`,
`subjectName.js`, `subjectPalette.js` · reglas `subjects`

**Depende de.** M01 · M02 · M24

**Riesgo.** **Alto** — de una asignatura cuelga todo; borrarla mal se lleva
trabajo de un semestre.

**Auditoría.** A12 (junto con M07)

### M06 · Estudiantes e inscripciones

**Descripción.** El padrón de cada asignatura: alta manual, importación desde
Excel, código de 4 caracteres y QR de activación, contraseña temporal que
repone el docente, edición, baja y eliminación de cuenta.

**Archivos.** `src/pages/teacher/SubjectPage.jsx` (pestaña de estudiantes) ·
`src/pages/admin/components/StudentsTable.jsx` ·
`src/components/EliminarCuentaAlumnoModal.jsx` ·
`src/utils/studentLookup.js`, `studentSearch.js`, `studentIdentity.js`,
`generate.js`, `nombres.js` · `api/student/delete.js`,
`recover-password.js`, `remove-photo.js` · reglas `students`

**Depende de.** M01 · M05 · M17 · M26 · M18

**Riesgo.** **Crítico** — son datos personales de menores de edad, y la
colección se lee sin sesión iniciada para que funcione la activación por QR.

**Auditoría.** A07

### M07 · Actividades y entregas

**Descripción.** Lo que el docente encarga y lo que el estudiante entrega:
actividades con fecha límite, valor, parcial, visibilidad y publicación
programada; entregas con archivos, texto o liga; descarga masiva de entregas;
recursos y materiales de apoyo.

**Archivos.** `src/pages/teacher/ActivityPage.jsx` ·
`src/pages/student/ActivityPage.jsx`, `SubjectPage.jsx` ·
`src/components/EntregableEditor.jsx`, `AttachmentList.jsx`, `FileDropzone.jsx`,
`FileTypeSelect.jsx`, `PublicacionScheduler.jsx`, `NuevaFechaEntregaModal.jsx`,
`VisibilitySelect.jsx`, `PdfCanvasPreview.jsx`, `PinchZoomImage.jsx`,
`ZoomableImage.jsx` · `src/utils/activityVisibility.js`, `resourceTypes.js`,
`extensiones.js`, `importActivities.js`, `downloadSubmissions.js`,
`formatBytes.js` · `src/config/fileTypes.js` · reglas `activities`,
`submissions`, `resources`, `materials`

**Depende de.** M05 · M06 · M17 · M10 · M14 · M13

**Riesgo.** **Alto** — es el trabajo diario; una entrega perdida no se recupera.

**Auditoría.** A12

### M08 · Evaluaciones (cuestionarios y exámenes)

**Descripción.** Instrumentos con reactivos de varios tipos, agrupados en
secciones opcionales, con orden aleatorio, tiempo límite, intentos, banco de
reactivos, calificación automática en el servidor, revisión manual de abiertas,
publicación de resultados configurable, opción de no calificar, estadísticas y
gráficas.

**Archivos.** `src/components/EvaluacionEditor.jsx`, `EvaluacionManager.jsx`,
`EvaluacionAnswerList.jsx`, `EvaluacionStatsPanel.jsx`, `EvaluacionGraficas.jsx`,
`SeccionesEditor.jsx`, `SinCalificacionConfig.jsx` ·
`src/pages/student/EvaluacionRunner.jsx`, `EvaluacionRevision.jsx` ·
`src/hooks/useSecciones.js` · `src/utils/secciones.js`, `evaluacionGrading.js`,
`evaluacionRespuestas.js` · `functions/index.js` (`onEvaluacionFinalizada`) ·
reglas `activities/{id}/preguntas`, `submissions/{id}/respuestas`,
`bancoReactivos`

**Depende de.** M07 · M10 · M09 · M16 · M25

**Riesgo.** **Crítico** — califica solo. Un error cambia calificaciones sin que
nadie lo note, y el estudiante puede ver lo que no debe.

**Auditoría.** A08

### M09 · Rúbricas y listas de cotejo

**Descripción.** Instrumentos de evaluación cualitativa: rúbricas con niveles y
criterios ponderados, listas de cotejo, banco reutilizable entre asignaturas y
tabla de calificación por criterio.

**Archivos.** `src/components/rubrica/` (`RubricaEditor`, `ListaCotejoEditor`,
`RubricaPicker`, `RubricaTable`, `RubricaGradeTable`, `editorShared`) ·
`src/utils/rubrica.js` · reglas `bancoRubricas`

**Depende de.** M07 · M10 · M05

**Riesgo.** **Alto** — de la rúbrica sale una calificación.

**Auditoría.** A09 (junto con M10)

### M10 · Calificaciones y ponderación

**Descripción.** Cómo se convierte lo entregado en un número: valor por
actividad, ponderación por parcial, promedios, tabla de calificaciones de la
asignatura y las actividades que no cuentan para calificación.

**Archivos.** `src/utils/ponderacion.js` · `src/pages/teacher/SubjectPage.jsx`
(tabla de calificaciones) · `src/components/rubrica/RubricaGradeTable.jsx` ·
`src/components/SinCalificacionConfig.jsx` ·
`functions/index.js` (`onSubmissionActualizada`, `onEvaluacionFinalizada`)

**Depende de.** M07 · M08 · M09 · M16

**Riesgo.** **Crítico** — es el producto final del docente y lo que entrega a la
escuela.

**Auditoría.** A09

### M11 · Asistencia

**Descripción.** Pase de lista por fecha, con resumen acumulado por estudiante,
llenado automático, días no laborables (asuetos) y periodos vacacionales.

**Archivos.** `src/pages/teacher/SubjectPage.jsx` (pestaña de asistencias) ·
`src/utils/attendance.js`, `attendanceAuto.js`, `asuetos.js`, `vacaciones.js` ·
`functions/index.js` (`onAttendanceEscrita`) · reglas `attendance`,
`attendanceSummaries`, `asuetos`, `vacaciones`

**Depende de.** M05 · M06 · M13 · M25

**Riesgo.** **Alto** — es un registro oficial que se entrega a la escuela.

**Auditoría.** A13

### M12 · Avisos (comunicados)

**Descripción.** Mensajes del docente a un grupo o a toda la asignatura, con
acuse de lectura, plantillas reutilizables, guardados y ocultos por estudiante,
y programación de envío.

**Archivos.** `src/components/subject/AvisosTab.jsx`, `AvisoLecturaModal.jsx` ·
`src/components/AvisosGate.jsx` · `src/utils/avisos.js` ·
`functions/index.js` (`onAvisoEscrito`, `revisarProgramados`) · reglas `avisos`,
`avisoLecturas`, `avisoGuardados`, `avisoOcultos`, `avisoPlantillas`

**Depende de.** M05 · M06 · M14 · M25

**Riesgo.** **Alto** — un aviso mal dirigido llega a quien no debía.

**Auditoría.** A14

### M13 · Calendario y agenda

**Descripción.** El tiempo del curso: eventos del docente, eventos académicos,
eventos propios del estudiante, horario semanal por bloques, programación de
bloques, alarmas locales y la agenda del estudiante con sus entregas y
recordatorios.

**Archivos.** `src/pages/teacher/CalendarPage.jsx` ·
`src/pages/student/Agenda.jsx` · `src/components/calendar/` (`EventEditor`,
`MiniSelect`, `ProgramarBloquesModal`, `ProgramarZonaSemanal`, `useAlarmas`) ·
`src/components/agenda/StudentEventEditor.jsx` ·
`src/components/EFDateTimePicker.jsx` · `src/utils/calendarEvents.js`,
`calendarGrid.js`, `horarioBloques.js`, `dateRange.js`, `formatHora.js`,
`nowIso.js`, `localReminders.js`, `asuetos.js`, `vacaciones.js` · reglas
`events`, `academicEvents`, `studentEvents`, `horario`, `horarioBloques`

**Depende de.** M05 · M07 · M11 · M14 · M23

**Riesgo.** **Alto** — de aquí salen los recordatorios de entrega.

**Auditoría.** A18

### M19 · Perfil y cuenta del docente

**Descripción.** Sus datos, foto, escuela, código postal, contraseña, plan
contratado, historial de pagos, cancelación de suscripción y eliminación
definitiva de la cuenta con todo su contenido.

**Archivos.** `src/pages/teacher/Profile.jsx` ·
`src/components/EliminarCuentaModal.jsx`, `AvatarCropModal.jsx`,
`CodigoPostalField.jsx` · `src/utils/codigoPostal.js`, `schoolSelection.js` ·
`api/account/delete.js`, `cancel-subscription.js` · `src/data/useCodigoPostal.js`

**Depende de.** M01 · M02 · M03 · M17 · M18 · M26

**Riesgo.** **Crítico** — eliminar la cuenta no debe dejar residuos ni cuentas
de estudiantes huérfanas.

**Auditoría.** A10

### M20 · Perfil del estudiante

**Descripción.** Sus datos, foto y contraseña, y la baja de su propia cuenta.

**Archivos.** `src/pages/student/Profile.jsx`, `Dashboard.jsx` ·
`src/components/EliminarCuentaAlumnoModal.jsx` · `api/student/remove-photo.js`,
`delete.js`

**Depende de.** M01 · M06 · M17 · M26

**Riesgo.** **Alto** — datos personales de menores.

**Auditoría.** A07 (junto con M06)

### M31 · Páginas públicas y PWA

**Descripción.** Lo que se ve sin sesión: portada, aviso de privacidad,
instalación como aplicación web y los íconos y el manifiesto.

**Archivos.** `src/pages/Landing.jsx`, `Privacidad.jsx` ·
`src/components/PwaInstallPrompt.jsx`, `AppQRButton.jsx`, `EFLogo.jsx` ·
`src/config/appDownload.js` · `public/manifest.json`, íconos, `icons.svg`

**Depende de.** M21 · M23

**Riesgo.** **Medio** — es la primera impresión y la puerta de la descarga.

**Auditoría.** A19 (rutas y acceso) · A23 (presentación e instalación)

### M32 · Manual, ayuda y onboarding

**Descripción.** Lo que enseña a usar la plataforma: el manual del docente, las
explicaciones plegables de "¿Qué es esto?" repartidas por las pantallas, y el
alta guiada de la primera asignatura.

**Archivos.** `src/pages/teacher/ManualPage.jsx`, `Onboarding.jsx` ·
`src/components/ui/InfoDisclosure.jsx`

**Depende de.** M05 · M21

**Riesgo.** **Bajo** — si falla, molesta pero no rompe nada.

**Auditoría.** A23

## CAPA DE PLATAFORMA

### M14 · Notificaciones push y bitácora

**Descripción.** Los avisos que llegan al teléfono: registro y limpieza de
tokens, permisos, canales de Android, preferencias por categoría y por
asignatura, envío desde Cloud Functions, resolución del enlace profundo al
tocar la notificación, y la bitácora de lo enviado.

**Archivos.** `src/utils/pushNotifications.js`, `webPush.js`, `notify.js` ·
`src/pages/teacher/NotificationSettings.jsx` ·
`src/pages/student/NotificationSettings.jsx` ·
`src/components/NotificationLog.jsx`, `PushPermissionPrimer.jsx` ·
`public/firebase-messaging-sw.js` · `functions/index.js` (7 de las 14
funciones envían push) · reglas `notificationSettings`, `notificationLog`

**Depende de.** M23 · M25 · M07 · M08 · M12 · M13 · M03

**Riesgo.** **Alto** — un aviso al destinatario equivocado filtra información
de un grupo a otro.

**Auditoría.** A15

### M15 · Correo transaccional

**Descripción.** Los correos que salen del sistema: bienvenida al registrarse,
avisos de vencimiento y de retención de datos, y los recordatorios diarios.
Hoy conviven dos caminos: Brevo desde el servidor y EmailJS desde el cliente.

**Archivos.** `api/send-email.js`, `api/_lib/email.js`,
`api/_lib/emailTemplates.js`, `api/cron/reminders.js` ·
`src/utils/sendEmail.js`, `welcomeEmail.js`, `accountEmails.js`

**Depende de.** M01 · M02 · M26 · Brevo · EmailJS

**Riesgo.** **Alto** — es el único canal que alcanza a quien ya no entra a la
plataforma, y lleva datos personales.

**Auditoría.** A21

### M16 · Exportaciones (PDF y Excel)

**Descripción.** Lo que el docente entrega a la escuela: actas y listas en PDF
con membrete de escuela y docente, reportes en Excel, resultados de
evaluaciones, gráficas, y la marca de agua para quien todavía no ha pagado.

**Archivos.** `src/utils/pdf.js`, `excel.js`, `membrete.js`,
`exportWatermark.js`, `descargaSoloWeb.js`, `nativeSave.js`,
`downloadSubmissions.js` · jsPDF, jspdf-autotable, ExcelJS, JSZip

**Depende de.** M10 · M11 · M08 · M02 · M23

**Riesgo.** **Alto** — un acta con datos equivocados se entrega y se firma.

**Auditoría.** A16

### M17 · Archivos y multimedia (Cloudinary)

**Descripción.** Todo lo que se sube: entregas, comprobantes de pago, fotos de
perfil, imágenes del editor de texto enriquecido. Subida sin firma con preset,
entrega forzada como descarga, y borrado desde el servidor al eliminar cuentas.

**Archivos.** `src/utils/cloudinary.js` · `api/_lib/cloudinary.js` ·
`src/components/AvatarCropModal.jsx`, `RichTextEditor.jsx`,
`PdfCanvasPreview.jsx` · `src/utils/sanitizeHtml.js`

**Depende de.** M07 · M03 · M19 · M20 · Cloudinary

**Riesgo.** **Alto** — guarda documentos y comprobantes, su borrado depende de
llaves que todavía no están configuradas, y la cuota la paga Alan.

**Auditoría.** A17

### M18 · Catálogos de datos

**Descripción.** Los datos de referencia que no cambian: ~1,700 planteles
CBTIS/CETIS/CBT, el catálogo de códigos postales partido en 96 fragmentos, la
normalización de nombres propios y los prefijos telefónicos.

**Archivos.** `public/planteles.json` · `public/cp/` (97 archivos) ·
`src/data/usePlanteles.js`, `useCodigoPostal.js` ·
`src/utils/schoolSelection.js`, `codigoPostal.js`, `nombres.js`, `prefijos.js` ·
`scripts/extraer-cp.cjs`

**Depende de.** Nada (se cargan bajo demanda y se cachean)

**Riesgo.** **Medio** — un catálogo mal cargado impide completar el registro.

**Auditoría.** A04 (junto con M01)

### M21 · Navegación, rutas y layouts

**Descripción.** Cómo se mueve la gente por la plataforma y qué puede ver:
las 28 rutas, los guardianes por rol (`ProtectedTeacher`, `ProtectedStudent`,
`ProtectedAdmin`), los tres layouts, el botón físico de atrás en Android, el
bloqueo de desplazamiento con modales abiertos y la barra inferior del
estudiante.

**Archivos.** `src/App.jsx` · `src/components/Layout.jsx`, `StudentLayout.jsx`,
`AdminLayout.jsx`, `StudentBottomNav.jsx`, `AndroidBackButton.jsx`,
`EscKeyHandler.jsx` · `src/hooks/useBackHandler.js`, `useScrollLock.js`,
`useResizableSidebar.js` · `src/config/layout.js`

**Depende de.** M01 · M23

**Riesgo.** **Alto** — los guardianes de ruta son control de acceso.

**Auditoría.** A19

### M22 · Sistema de diseño y UI compartida

**Descripción.** Lo que hace que todo se vea igual: componentes base, avisos
emergentes, modales, buscadores, tabla redimensionable, íconos de rol, tema
claro y oscuro por variables CSS, y el verificador de estándares visuales.

**Archivos.** `src/components/ui/` (`Button`, `Input`, `Select`, `Modal`,
`Table`, `InfoDisclosure`, `cn`) · `Toast.jsx`, `Spinner.jsx`,
`ConfirmModal.jsx`, `SearchInput.jsx`, `EFLogo.jsx`, `RoleIcons.jsx`,
`PortalBadge.jsx`, `Fireworks.jsx`, `GoogleIcon.jsx` ·
`src/utils/followTooltip.js`, `draggableOverlays.js`, `wheelStep.js`,
`columnWidths.js` · `src/hooks/useColumnWidths.js`, `usePointerDrag.js` ·
`tailwind.config.js`, `src/index.css` · `docs/DESIGN_SYSTEM.md`,
`scripts/check-ui-standards.sh`

**Depende de.** Nada del negocio

**Riesgo.** **Medio** — un componente base roto se ve en todas las pantallas.

**Auditoría.** A23

### M23 · Aplicación Android (Capacitor)

**Descripción.** El envoltorio nativo: empaqueta el mismo `dist/` de la web y
le agrega lo que solo existe en el teléfono — push de FCM, notificaciones
locales, compartir, guardar archivos, orientación, barra de estado, área
segura, splash, Google Sign-In nativo y el aviso de actualización disponible.

**Archivos.** `capacitor.config.json` · `android/` (proyecto Gradle,
`MainActivity.java`, `AndroidManifest.xml`, `google-services.json`) ·
`src/utils/platform.js`, `nativeInit.js`, `nativeSave.js`, `statusBar.js`,
`orientation.js`, `checkAppVersion.js` · `src/components/UpdateChecker.jsx` ·
`resources/` · `scripts/generate-android-assets.cjs`

**Depende de.** Todo el producto (lo empaqueta) · M14 · M16 · Firebase · Google Play

**Riesgo.** **Alto** — publica una copia del código; una versión vieja
instalada puede correr reglas que ya no existen.

**Auditoría.** A20

### M24 · Infraestructura Firebase y Firestore

**Descripción.** El cimiento: inicialización del cliente, las 30 colecciones
con sus reglas de seguridad, los índices compuestos y la restricción de
consultas del proyecto (solo igualdades, sin rangos ni `orderBy`).

**Archivos.** `src/firebase.js` · `firestore.rules` · `firestore.indexes.json` ·
`firebase.json` · `.firebaserc` · `storage.rules` (presente pero **sin uso**:
el proyecto no importa Firebase Storage en ningún archivo)

**Depende de.** Todos los módulos escriben aquí

**Riesgo.** **Crítico** — es la última línea de defensa de todo el sistema.

**Auditoría.** A03

### M25 · Cloud Functions

**Descripción.** Lo que corre en el servidor sin que nadie lo pida. Catorce
funciones, en tres familias: **avisos push** (`onActividadEscrita`,
`onAvisoEscrito`, `onSubmissionEntregada`, `onEstudianteActivado`,
`onPagoCreado`, `onPagoResuelto`, `onTokenPushEscrito`), **cálculo**
(`onEvaluacionFinalizada`, `onSubmissionActualizada`, `onAttendanceEscrita`) y
**tiempo** (`revisarProgramados`, `sincronizarCandadoSuscripcion`,
`onSuscripcionEscrita`, `onDocenteCreado`).

**Archivos.** `functions/index.js`, `functions/package.json`

**Depende de.** M24 · Admin SDK (no pasa por las reglas) · FCM

**Riesgo.** **Crítico** — escribe saltándose las reglas de seguridad, y de ella
sale la calificación automática.

**Auditoría.** A05

### M26 · API serverless (Vercel)

**Descripción.** Lo que necesita credenciales de servidor: envío de correo,
cancelación de suscripción, borrado de cuentas de docente y estudiante,
recuperación de contraseña de estudiante, quitar foto, último acceso para el
panel, webhook de Mercado Pago y el cron diario de recordatorios. Comparte
utilidades en `_lib/` (que no cuentan para el tope de 12 funciones del plan
Hobby) y guarda 4 endpoints pausados en `_pausado/`.

**Archivos.** `api/` (9 endpoints activos + 6 utilidades + 4 pausados) ·
`vercel.json` · `src/utils/apiBase.js`

**Depende de.** M24 · M17 · M15 · Vercel · Brevo · Mercado Pago

**Riesgo.** **Crítico** — corre con permisos de administrador sobre toda la base.

**Auditoría.** A06

### M27 · Seguridad de datos y privacidad

**Descripción.** Lo transversal: saneado del HTML que escriben los usuarios, el
aviso de privacidad, la declaración de seguridad de datos de Google Play y la
política de retención de 90 días.

**Archivos.** `src/utils/sanitizeHtml.js` · `src/pages/Privacidad.jsx` ·
`docs/play-store/03-seguridad-de-datos.md` ·
`src/utils/subscriptionHelpers.js` (`RETENTION_DAYS`)

**Depende de.** M06 · M17 · M19 · M20

**Riesgo.** **Alto** — hay datos de menores de por medio y una declaración
formal ante Google Play que debe seguir siendo cierta.

**Auditoría.** A22

## CAPA DE SOPORTE

### M28 · Semillas y scripts de mantenimiento

**Descripción.** Las herramientas de administración fuera de la aplicación:
creación del administrador, semillas de demostración y de planes, **borrado
completo de la base**, migración de nombres de usuario, respaldo del candado de
suscripción y cambio de contraseñas.

**Archivos.** `seeds-db/` (16 scripts) · `scripts/check-consistency.mjs`,
`extraer-cp.cjs`, `generate-android-assets.cjs`, `check-ui-standards.sh`

**Depende de.** M24 · credenciales de cuenta de servicio

**Riesgo.** **Alto** (corregido desde Medio) — varios borran la base entera y
corren con credenciales de administrador. Que solo se ejecuten a mano no los
hace inofensivos: apuntan al proyecto que diga la configuración del momento.

**Auditoría.** A24

### M29 · Pruebas y control de calidad

**Descripción.** Lo que verifica que nada se rompa: la suite de reglas de
Firestore contra el emulador (62 casos), ESLint y los verificadores de
consistencia y de estándares visuales. **No hay pruebas de interfaz ni de
integración.**

**Archivos.** `test/firestore-rules.test.mjs` · `eslint.config.js` ·
`scripts/check-consistency.mjs`, `check-ui-standards.sh` · `package.json`
(`test:rules`, `lint`, `check:design`)

**Depende de.** M24 · emulador de Firestore · JDK 21

**Riesgo.** **Medio** — su ausencia no rompe producción, pero es lo único que
detiene una regresión antes de que llegue.

**Auditoría.** Ninguna: es el instrumento de todas las demás, y cada una lo deja
más grande. Su salud se mide en el contador de casos de §4.

### M30 · Documentación

**Descripción.** El contexto escrito del proyecto: la guía para agentes de IA,
la referencia técnica del producto, el sistema de diseño, los planes históricos,
la carpeta de Google Play y **este Plan Maestro**.

**Archivos.** `CLAUDE.md` · `README.md` · `SETUP.md` · `docs/` (18 documentos +
`play-store/`) · `DOCUMENTACION/INVENTARIO_DEL_SISTEMA.md`

**Depende de.** Nada

**Riesgo.** **Bajo**.

**Auditoría.** Ninguna: no tiene comportamiento que romper.

### M33 · Herramientas auxiliares fuera del producto

**Descripción.** Trabajo paralelo que vive en el repositorio pero **no forma
parte de lo que se despliega**: el generador del personaje ilustrado (Gemini),
la canalización de voz con ElevenLabs y sus audios, y archivos de prueba.
Incluye su propio `.env` con credenciales.

**Archivos.** `Avatar/` (con `.env`) · `voice-pipeline.js` · `output/` ·
`src-test/` · `resources/`

**Depende de.** ElevenLabs · Gemini

**Riesgo.** **Medio** (corregido desde Bajo) — no llega al usuario, pero guarda
credenciales dentro del repositorio.

**Auditoría.** A24

---

# 6. Fases de ejecución

Las veinticuatro auditorías se agrupan en **siete fases**, cada una con todo lo
que se puede cerrar sin depender de lo que viene después. Existen para que una
fase entera se pueda ejecutar de corrido, sin pedir instrucciones entre una
auditoría y la siguiente.

**El número identifica; la fase ordena.** `A07` se llama así para siempre —está
citado en commits, PR e informes—, y por eso las fases no siempre agrupan
números seguidos. Cuando haya duda sobre qué sigue, manda la fase.

## Cómo se ejecuta una fase

- Las auditorías de la fase se hacen **en el orden en que están listadas**, que
  es el de sus dependencias.
- **Cada auditoría cierra por su cuenta** con el protocolo de §2: su propia
  rama, su propio commit, su propio despliegue. No se acumula el trabajo de una
  fase en un solo commit — si algo sale mal, se revierte una auditoría, no
  cuatro.
- **Una auditoría bloqueada no detiene la fase.** Se marca Bloqueada con la
  pregunta que la detuvo, se sigue con la siguiente, y la pregunta se entrega al
  cerrar la fase. Lo único que sí detiene todo es que la parte bloqueada sea
  requisito de las demás; entonces se dice y se espera.
- Lo que una fase descubre y no le toca resolver se anota como riesgo (§9) con
  la auditoría que lo cerrará, y ahí se queda hasta que se cierre.

## Cierre de fase

Vale para las siete; no se repite en cada ficha. Una fase termina cuando:

1. Todas sus auditorías están **Completada** o **Bloqueada**. Ninguna a medias.
2. `lint`, `build` y la suite de reglas completa, en verde, con todo integrado
   en `main`.
3. La bitácora (§8) está al día: estado, fecha, commit y PR de cada una, y el
   contador de casos de prueba actualizado.
4. Los riesgos nuevos están en §9 con su propuesta y su auditoría asignada.
5. Un **commit de cierre de fase** sobre este documento:
   `docs(calidad): cierra la Fase N — <nombre>`, con el resumen de lo corregido,
   lo bloqueado y los casos de prueba ganados.
6. Un **informe de fase** al Product Owner: qué se cerró, qué quedó bloqueado y
   con qué pregunta exacta, y qué sigue.
7. **Se continúa con la siguiente fase automáticamente**, sin esperar respuesta,
   salvo que todas sus auditorías dependan de una decisión pendiente.

## Cuándo detenerse

Solo hay cuatro razones para dejar de trabajar:

- **Terminó una fase.** Se entrega el informe y se sigue con la siguiente.
- **Hace falta una decisión exclusiva del Product Owner** (§1.7). Se marca
  Bloqueada, se salta y se sigue; la pregunta va en el informe de fase. Si es
  urgente porque bloquea todo lo demás, se pregunta de inmediato.
- **Una corrección cambiaría lo que el usuario ve, paga o recibe.** Se pregunta
  antes de hacerla, aunque técnicamente sea la respuesta correcta.
- **Algo rompió producción.** Se revierte con el respaldo del paso 3 de §2, se
  avisa de inmediato y no se sigue hasta que producción esté sana.

Ninguna otra cosa justifica detenerse a preguntar.

---

## Fase 0 · Dinero y acceso comercial — COMPLETADA

**Objetivo general.** Que nadie pueda otorgarse vigencia ni pagar menos de lo
que debe. Se ejecutó primero, fuera de este orden, porque era lo único que
costaba dinero desde el día uno.

**Auditorías.** A01 (suscripciones) → A02 (pagos).

**Para iniciar.** —

**Para concluir.** Cumplida: dos vías críticas de fraude cerradas, cliente y
servidor alineados, 25 casos de prueba nuevos.

**Cerrada** el 5 de agosto de 2026. Detalle en §8.

## Fase 1 · Cimientos del servidor — CERRADA

**Cerrada** el 5 de agosto de 2026, aprobada por el Product Owner. Cuatro
auditorías, cuatro vulnerabilidades críticas cerradas, 62 → 72 casos de prueba.
Resultados en §8; los dos criterios que no se cumplieron al pie de la letra
están anotados ahí mismo.

**Objetivo general.** Cerrar las cuatro superficies donde se decide **quién
puede hacer qué**, antes de auditar una sola pantalla. Todo lo que viene después
se apoya en que estas cuatro estén bien: auditar una pantalla sobre un servidor
sin revisar obliga a repetir la pantalla.

**Auditorías.** A03 (reglas de Firestore) → A04 (autenticación e identidad) →
A05 (Cloud Functions) → A06 (API serverless).

**Para iniciar.** Fase 0 cerrada. ✔ Cumplido.

**Para concluir.**
- Las 30 colecciones con al menos un caso legítimo en verde y un ataque en rojo;
  las de lectura pública, además, con una prueba de consulta sin sesión.
- Las 14 Cloud Functions con su salida temprana documentada, su idempotencia
  verificada y su comportamiento probado ante un documento incompleto.
- Matriz completa de endpoints × cuatro identidades, con cada celda en el
  informe.
- **R1** (`schools` abierta) y **R2** (tarifa fuera de las reglas) cerrados.
- La entropía de usuarios y contraseñas de estudiante medida y documentada, con
  su corrección si resultó insuficiente.

## Fase 2 · Personas y su información — CERRADA

**Cerrada** el 6 de agosto de 2026, **ratificada por el Product Owner** tras una
revisión crítica de la fase completa. Cuatro auditorías, las cuatro Completadas.
El criterio que le daba nombre —*que dar de baja una cuenta no deje nada
atrás*— quedó demostrado de punta a punta contra producción, no por inspección.

**No se reabre.** R7, R8 y R9 siguen abiertos porque pertenecen al proyecto de
migración de **RO-1**, que es una línea de trabajo aparte y queda **fuera del
alcance de A17**; R16 es una dependencia de Alan y se rige por **RO-3**. Detalle
en §8.

**Objetivo general.** Que los datos de una persona —sobre todo los de menores de
edad— solo los vea quien debe, y que dar de baja una cuenta no deje nada atrás.
Incluye el almacenamiento porque ahí viven sus archivos, y porque cerrarlo aquí
permite auditar las entregas en la fase siguiente sin un hueco debajo.

**Auditorías.** A07 (estudiantes y perfil del estudiante) → A17 (archivos y
multimedia) → A10 (perfil y cuenta del docente) → A11 (panel de administración).

**Para iniciar.** Fase 1 cerrada. El borrado de cuentas depende de la API y de
las funciones, y no se puede juzgar antes que ellas.

**Para concluir.**
- La lectura pública de `students` acotada a lo mínimo que la activación
  necesita, demostrado con un caso de prueba.
- Un docente de prueba creado, poblado y eliminado, con verificación documento
  por documento y archivo por archivo de que no queda nada suyo. ✔ **Cumplido**
  (A17, 6-ago-2026).
- Los límites reales del preset de Cloudinary verificados contra el servicio, no
  contra el código que lo llama ✔, y una postura escrita sobre la cuota —
  **pendiente de Alan, R16**.
- Cada acción del panel denegada, en cliente y en servidor, con sesión de
  docente y de estudiante. ✔ **Cumplido** (A11).
- **R3** (llaves de Cloudinary) cerrado o formalmente Bloqueado con la pregunta
  al Product Owner. ✔ **Cerrado** (A17).

## Fase 3 · El trabajo académico

**Objetivo general.** Que el número que llega a la escuela sea el correcto, y
que ningún estudiante vea ni toque el trabajo de otro. Es el corazón del
producto: lo que el docente no puede rehacer si se pierde.

**Auditorías.** A08 (evaluaciones) → A09 (calificaciones, ponderación y
rúbricas) → A12 (actividades, entregas y asignaturas) → A13 (asistencia) →
A18 (calendario y agenda).

**Para iniciar.** Fase 1 cerrada — la calificación automática vive en una Cloud
Function y las respuestas viven en subcolecciones, así que sin A05 y A03 esto no
se puede juzgar. ✔ Cumplido. La Fase 2 también quedó cerrada (6-ago-2026), así
que esta arranca sin nada debajo sin revisar.

**Para concluir.**
- Ninguna respuesta correcta alcanzable desde el navegador antes de contestar, y
  ningún campo de calificación escribible por el estudiante, demostrado con
  casos de prueba desde las tres identidades.
- Una asignatura de prueba con casos límite y 50 estudiantes que dé **el mismo
  número** en pantalla, en PDF y en Excel.
- Una asignatura creada, duplicada y borrada sin dejar residuos.
- Un mes de asistencias con asuetos y vacaciones, cuadrando detalle, resumen y
  exportación.
- Todo cálculo de fecha resuelto en el servidor o probado contra un reloj
  mentiroso y otra zona horaria.

## Fase 4 · Lo que sale del sistema

**Objetivo general.** Que nada salga hacia el destinatario equivocado. Son los
cuatro canales por los que la información abandona la plataforma: un aviso, una
notificación, un archivo exportado y un correo.

**Auditorías.** A14 (avisos) → A15 (notificaciones push) → A16 (exportaciones) →
A21 (correo transaccional).

**Para iniciar.** Fase 3 cerrada. Una exportación no se puede validar antes que
los números que exporta.

**Para concluir.**
- Ningún aviso legible fuera de su asignatura y ningún acuse escribible por un
  tercero.
- Ningún token de push sobreviviendo al cierre de sesión, probado en el
  teléfono.
- Los reportes principales **generados y abiertos de verdad** en los cuatro
  estados de suscripción, en web y en Android.
- Ninguna inyección de fórmula posible en Excel con datos escritos por un
  estudiante.
- Ningún envío de correo a una dirección que no salga de la base.
- Decisión tomada sobre EmailJS (**es de producto**: si no hay respuesta, queda
  Bloqueada y la fase cierra igual).

## Fase 5 · Superficie y entorno

**Objetivo general.** Que la plataforma se pueda usar completa —todas sus
funciones, por cualquier persona, en cualquier pantalla y en los dos medios— y
que llegar a ella por una dirección escrita a mano no abra lo que no debe.

**Auditorías.** A19 (navegación y guardianes) → A20 (aplicación Android) →
A23 (interfaz, accesibilidad y consistencia).

**Para iniciar.** Fase 4 cerrada. La paridad entre app y web se juzga sobre
funciones ya validadas; si no, se estarían comparando dos cosas rotas.

**Para concluir.**
- Matriz completa de 28 rutas × 4 identidades, con el resultado de cada celda.
- Ningún dato en pantalla sobreviviendo al cierre de sesión, ni con el botón de
  atrás.
- Lista de diferencias entre app y web, justificada una por una, y la versión
  publicada en Google Play probada contra las reglas en producción.
- Las pantallas principales medidas a 320, 375, 768 y 1280 píxeles, en tema
  claro y oscuro, con evidencia.
- `npm run check:design` en verde.

## Fase 6 · Cumplimiento y operación

**Objetivo general.** Que lo que se declaró ante Google Play y en el aviso de
privacidad siga siendo verdad, y que nadie pueda borrar la base por accidente ni
filtrar una credencial. Va al final a propósito: solo después de las seis fases
anteriores se sabe **qué datos se recogen de verdad** y por dónde salen.

**Auditorías.** A22 (seguridad de datos y privacidad) → A24 (operación, secretos
y despliegue).

**Para iniciar.** Fase 5 cerrada.

**Para concluir.**
- Tabla de datos recogidos —para qué, a dónde salen, cuánto se conservan—
  coincidiendo con lo declarado en Play y en el aviso de privacidad.
- **R4** (retención de 90 días) resuelto en un sentido o en el otro, o Bloqueado
  con la pregunta hecha.
- Postura escrita sobre el consentimiento de menores.
- Inventario de scripts con su destino, inventario de secretos con dónde vive
  cada uno, y ninguna credencial versionada.
- Procedimiento de reversa escrito y probado una vez.
- **R5** (ausencia de pruebas de interfaz) evaluado con una recomendación
  concreta ahora que todo lo demás está cubierto.

---

# 7. Plan de ejecución de auditorías

Veinticuatro auditorías. El orden sigue dos criterios, en este orden: **primero
lo que sostiene a lo demás** (reglas, identidad, los dos servidores que se
saltan las reglas), **después lo que más cuesta que falle**. Auditar una
pantalla antes que el servidor que la respalda obliga a repetirla.

Cada ficha da por sabidas las reglas de §1 y el protocolo de §2, y remite al
inventario para saber qué archivos toca. El estado vive en §8 y el orden de
ejecución en §6, no aquí.

## A01 · Suscripciones y candado de acceso — COMPLETADA

**Módulos.** M02 · **Objetivo.** Que nadie pueda otorgarse vigencia.
Resultado en §8.

## A02 · Pagos — COMPLETADA

**Módulos.** M03 · **Objetivo.** Que un pago no pueda valer más de lo que se
transfirió. Resultado en §8.

## A03 · Reglas de Firestore y modelo de datos

**Módulos.** M24, y toda colección que escriban los demás.

**Objetivo.** Que ninguna de las 30 colecciones deje leer o escribir a quien no
le corresponde, y que el candado de suscripción cubra todo lo que es trabajo.

**Alcance.** `firestore.rules` completo, `firestore.indexes.json`, y las
consultas del cliente que dependen de ellos. No entra la lógica de pantalla de
cada módulo: eso es de su propia auditoría.

**Revisar.**
- Cada `match`, con `read`, `create`, `update` y `delete` por separado — un
  `allow write` global esconde tres permisos distintos, y un `allow read`
  esconde dos (documento y consulta).
- Que cada colección de contenido exija `docenteActivo()` para escribir y no
  para leer.
- Las dos colecciones de lectura pública (`students`, `subjects`): exactamente
  qué campos expone y si la activación por QR de verdad los necesita todos.
- Los campos congelados con `hasOnly` / `affectedKeys` y los que deberían estarlo
  (`role`, `escuelaId`, `uid`, `docenteId`, y todo campo que espeje una Cloud
  Function).
- `exists()` antes de cada `get()`, y qué pasa cuando un campo esperado no está
  (una propiedad ausente revienta la regla, no da falso).
- Coherencia entre las consultas del cliente y los índices desplegados.
- Colecciones que existan en el código pero no tengan `match` propio.
- `storage.rules`: declara una superficie que no se usa (ver §11-D.1).

**Intentar romper.**
- Escribir en cada colección con el `docenteId` de otro, y con el propio pero
  sobre un documento ajeno.
- **Listar una colección entera sin filtro**, y con el filtro de otra escuela:
  la fuga clásica de Firestore no es leer un documento, es consultar.
- Elevarse a `role: 'admin'` desde el propio documento de usuario.
- Cruzar escuelas: escribir con el propio `docenteId` pero un `escuelaId` ajeno.
- Leer el padrón o las asignaturas de otra escuela sin sesión iniciada.
- Escribir en las 20 colecciones de contenido con la suscripción vencida.
- Entrar a las subcolecciones (`preguntas`, `respuestas`) desde una cuenta de
  estudiante que no es dueña del intento.
- Borrar documentos ajenos, y borrar los propios para volver a empezar.
- Escribir un documento con campos que ninguna pantalla manda, para ver si algo
  río abajo los interpreta.

**Corregir obligatoriamente.** Toda colección sin dueño verificado · toda
escritura de contenido sin `docenteActivo()` · todo campo de privilegio
escribible por su propio titular · toda consulta que devuelva documentos ajenos ·
**R1** (`schools` abierta) y **R2** (tarifa fuera de las reglas).

**Cierre.** Cada una de las 30 colecciones tiene al menos un caso legítimo en
verde y un ataque en rojo · las de lectura pública tienen además una prueba de
consulta sin sesión · suite completa pasando · reglas desplegadas y verificadas.

## A04 · Autenticación e identidad

**Módulos.** M01, M18.

**Objetivo.** Que nadie pueda entrar como otro, ni darse un rol que no le toca.

**Alcance.** Alta de docente (correo y Google), activación de estudiante,
recuperación y cambio de contraseña, vinculación de cuentas, y los catálogos que
alimentan el registro.

**Revisar.** El flujo completo de `AuthContext` (incluida la autorreparación de
perfil y la migración de nombres) · **la entropía de lo que se genera**: el
usuario del estudiante es `apellido.nombre` (no un código corto, corregido en
A04) y hoy nadie dicta contraseñas temporales — el propio alumno elige la suya ·
qué pasa cuando el correo no está verificado · el estado intermedio de quien
entró con Google y todavía no tiene contraseña · que el `resetPassword` se borre
al usarse.

**Intentar romper.** Entrar con el correo falso de un estudiante ajeno ·
**probar contraseñas a fuerza bruta** contra una cuenta de estudiante y medir
cuántos intentos permite antes de frenar · activar un código de acceso que no es
suyo · reusar una contraseña temporal ya consumida · registrarse escribiendo
`role: 'admin'` · vincular Google a una cuenta que no es propia · recuperar la
contraseña de un estudiante de otra escuela · enumerar usuarios existentes desde
las pantallas públicas · dos activaciones simultáneas del mismo código.

**Corregir obligatoriamente.** Cualquier camino que permita tomar una cuenta
ajena · cualquier forma de auto-asignarse un rol · contraseñas temporales
predecibles o que sobrevivan a su uso · la ausencia de freno ante intentos
repetidos, si resulta que no lo hay.

**Cierre.** Casos de reglas para `users`, `students` y `schools` · recorrido
manual completo de alta, activación, reset y vinculación, en web y en Android ·
medición documentada del freno ante fuerza bruta.

## A05 · Cloud Functions

**Módulos.** M25.

**Objetivo.** Que lo que corre con Admin SDK —sin pasar por las reglas— no
escriba de más ni avise a quien no debe. **Va antes que evaluaciones y
calificaciones porque la calificación automática vive aquí.**

**Alcance.** Las 14 funciones.

**Revisar.** Idempotencia de cada una (todas se disparan con `onDocumentWritten`
y su propia escritura las vuelve a disparar) · cómo resuelve cada una a quién
avisar · qué pasa con un documento malformado o incompleto · las dos programadas
y su ventana de tiempo · los reintentos y qué ocurre si una falla a la mitad ·
el costo de las que recorren colecciones completas.

**Intentar romper.** Provocar un bucle de escrituras · disparar una función con
campos faltantes o de otro tipo · hacer que un push salga hacia un destinatario
de otro grupo · que una función escriba sobre un documento de otro docente ·
disparar dos escrituras casi simultáneas sobre el mismo documento y ver si la
función se ejecuta dos veces con efecto doble.

**Corregir obligatoriamente.** Toda función sin candado de idempotencia · todo
destinatario mal resuelto · toda escritura que no verifique a quién pertenece el
documento que va a tocar · toda función que reviente con un documento
incompleto en lugar de salirse sin hacer nada.

**Cierre.** Cada función con su condición de salida temprana documentada, su
marca de idempotencia verificada y su comportamiento ante un documento
incompleto probado en el emulador.

## A06 · API serverless

**Módulos.** M26.

**Objetivo.** Que ningún endpoint con credenciales de servidor haga algo por
quien no tiene derecho a pedirlo.

**Alcance.** Los 9 endpoints activos, las 6 utilidades de `_lib/` y los 4
pausados.

**Revisar.** Que cada endpoint verifique el token **y** la propiedad del
recurso · la configuración de CORS · el secreto del cron · la verificación de
firma del webhook · qué información devuelven los errores · si los 4 pausados
siguen siendo accesibles · el tamaño máximo del cuerpo aceptado.

**Intentar romper.** Llamar cada endpoint sin token, con un token de otro rol y
con el id de un recurso ajeno · disparar el cron desde fuera · falsificar el
webhook · pedir el borrado de una cuenta que no es propia · usar el envío de
correo como retransmisor abierto · **repetir la misma petición dos veces** y ver
si el efecto se duplica · mandar un cuerpo enorme · llamar cien veces seguidas y
ver si algo frena.

**Corregir obligatoriamente.** Todo endpoint sin verificación de identidad ·
todo endpoint que acepte un id sin comprobar propiedad · todo mensaje de error
que revele si una cuenta existe · toda operación destructiva que no sea
idempotente.

**Cierre.** Cada endpoint probado con las cuatro identidades (sin token, token
de estudiante, token de docente ajeno, token legítimo) y el resultado de cada
celda anotado en el informe.

## A07 · Estudiantes e inscripciones

**Módulos.** M06, M20.

**Objetivo.** Que los datos personales de menores no salgan de donde deben
estar, y que un estudiante no pueda tocar el expediente de otro.

**Alcance.** Padrón, importación desde Excel, QR y códigos de acceso, edición y
baja, y el perfil del propio estudiante.

**Revisar.** Qué campos de `students` viajan realmente al cliente sin sesión ·
la importación desde Excel (validación, duplicados, tamaño, celdas con fórmula) ·
el borrado de una inscripción y qué pasa con sus entregas y calificaciones · la
baja de cuenta desde el propio perfil del estudiante.

**Intentar romper.** Descargar el padrón completo de otra escuela sin sesión ·
activar a un estudiante ajeno · cambiar el `uid` de una inscripción ya activada ·
inscribirse a una asignatura ajena con un código de acceso adivinado · importar
un archivo que sobrescriba inscripciones existentes · importar 500 renglones ·
borrar la cuenta de otro estudiante.

**Corregir obligatoriamente.** Toda exposición de datos personales que la
activación no necesite · toda escritura de un estudiante sobre la inscripción de
otro · entregas y calificaciones huérfanas tras una baja.

**Cierre.** La lectura pública de `students` acotada a lo mínimo, con caso de
prueba que lo demuestre · recorrido de alta, importación, activación y baja, con
verificación de que no quedan residuos.

## A08 · Evaluaciones

**Módulos.** M08.

**Objetivo.** Que un estudiante no pueda ver lo que no debe ni influir en su
propia calificación.

**Alcance.** Editor y gestor de reactivos, secciones, el runner del estudiante,
la revisión, la calificación automática y la publicación de resultados.

**Revisar.** Qué se manda al cliente cuando se abre un intento (¿viaja la
respuesta correcta?) · dónde se controla el tiempo límite, en el cliente o en el
servidor · el conteo de intentos · la configuración de "no publicar resultados"
y de "sin calificación" · el orden aleatorio con secciones · qué puede escribir
el estudiante en `respuestas` y hasta cuándo.

**Intentar romper.** Leer las respuestas correctas desde el navegador antes de
contestar · escribir la calificación del propio intento · **mover el reloj del
dispositivo** para ganar tiempo · seguir contestando después del cierre · abrir
**dos intentos a la vez desde dos dispositivos** · abrir el intento de otro
estudiante · ver resultados cuando la configuración dice que no se publican ·
leer las preguntas de una evaluación que todavía no se publica · terminar un
intento dos veces y ver si se recalifica.

**Corregir obligatoriamente.** Cualquier filtración de la respuesta correcta ·
cualquier campo de calificación escribible por el estudiante · cualquier lectura
de un intento ajeno · todo control de tiempo que dependa del reloj del
dispositivo.

**Cierre.** Casos de reglas para `preguntas` y `respuestas` desde las tres
identidades (dueño, compañero, docente ajeno) · una evaluación completa recorrida
de punta a punta, incluidos los casos de tiempo agotado y doble intento.

## A09 · Calificaciones, ponderación y rúbricas

**Módulos.** M10, M09.

**Objetivo.** Que el número que ve la escuela sea el correcto, siempre.

**Alcance.** Valor por actividad, ponderación por parcial, promedios, tabla de
calificaciones, rúbricas y listas de cotejo.

**Revisar.** La aritmética completa (redondeo, actividades sin calificar, sin
valor, parciales vacíos) · qué pasa cuando las ponderaciones no suman 100 · el
máximo alcanzable de una rúbrica contra el `maxCalif` de la actividad · la
coherencia entre la tabla en pantalla, el PDF y el Excel.

**Intentar romper.** Escribir una calificación desde la cuenta del estudiante ·
ponderaciones que sumen más de 100 o menos · una rúbrica que dé más puntos que
el máximo · una actividad "sin calificación" que se cuele al promedio · **dos
docentes calificando la misma entrega a la vez** · **borrar una entrega ya
calificada** y ver si la calificación sobrevive · cambiar el valor de una
actividad después de calificada.

**Corregir obligatoriamente.** Toda diferencia entre lo que muestra la pantalla
y lo que sale exportado · toda escritura de calificación desde el estudiante ·
todo promedio que dependa del orden en que se calificó · toda calificación
huérfana.

**Cierre.** Una asignatura de prueba con casos límite (sin entregas, sin valor,
con rúbrica, sin calificación, 50 estudiantes) que dé el mismo número en
pantalla, PDF y Excel.

## A10 · Perfil y cuenta del docente

**Módulos.** M19.

**Objetivo.** Que eliminar una cuenta no deje nada atrás, y que nadie pueda
tocar la cuenta de otro.

**Alcance.** Perfil, cambio de contraseña, foto, cancelación de suscripción y
borrado definitivo.

**Revisar.** El inventario completo de lo que cuelga de un docente
(subcolecciones, archivos en Cloudinary, cuentas de estudiantes, entregas) · qué
borra hoy `api/account/delete.js` y qué no · la reautenticación antes de las
acciones sensibles · qué ve el estudiante cuando su docente desaparece.

**Intentar romper.** Borrar la cuenta de otro docente · cancelar la suscripción
de otro · cambiar la contraseña sin reautenticar · dejar estudiantes activos
apuntando a un docente que ya no existe · interrumpir el borrado a la mitad.

**Corregir obligatoriamente.** Todo residuo del borrado, y que un borrado
interrumpido se pueda reanudar en vez de quedar a medias. **El borrado debe
cumplir RO-2** (§1.9): nunca puede llevarse por delante la cuenta de un
estudiante que sigue con otro docente — solo lo exclusivamente suyo. ~~Si el
borrado de Cloudinary sigue sin llaves configuradas, esa parte se marca
**Bloqueada** y se escala (R3).~~ R3 cerrado el 6-ago-2026.

**Cierre.** Un docente de prueba creado, poblado y eliminado, con verificación
documento por documento y archivo por archivo de que no queda nada suyo.
✔ **Cumplido en A17** (6-ago-2026), que corrió esa prueba única de extremo a
extremo: los cinco puntos de R14, en verde.

## A11 · Panel de administración

**Módulos.** M04.

**Objetivo.** Que solo el administrador entre, y que ninguna acción manual deje
un estado imposible.

**Alcance.** Todo el panel salvo las tablas de pagos y suscripciones, ya
revisadas en A01 y A02.

**Revisar.** El guardián `ProtectedAdmin` y la regla `isAdmin()` · qué lee
`useAdminStats` y cuánto crece esa lectura con los años · las acciones manuales
sobre suscripciones (cortesías, fechas a mano) · el endpoint de último acceso.

**Intentar romper.** Entrar a `/Admin` con sesión de docente o de estudiante ·
leer las estadísticas sin el rol · dejar una suscripción con fechas
contradictorias desde el modal manual · actuar sobre un docente ya eliminado ·
cargar el panel con mil docentes y ver qué tarda.

**Corregir obligatoriamente.** Toda pantalla o consulta del panel accesible sin
rol de administrador · toda acción que no valide el estado previo · toda lectura
que traiga la base completa sin necesidad.

**Cierre.** Cada acción del panel probada con sesión de docente y de estudiante,
todas denegadas en cliente y servidor.

## A12 · Actividades, entregas y asignaturas

**Módulos.** M07, M05.

**Objetivo.** Que una entrega llegue completa a su destino y solo su dueño y su
docente la vean.

**Alcance.** Ciclo de vida de una actividad y de una entrega, recursos y
materiales, publicación programada, y el borrado en cascada de una asignatura.

**Revisar.** La visibilidad de una actividad (parcial oculto, no publicada,
programada) · qué pasa al vencer la fecha límite · la descarga masiva · el
duplicado de asignatura · el borrado en cascada, colección por colección.

**Intentar romper.** Entregar en una actividad de otra asignatura · entregar
después del cierre · leer la entrega de un compañero · descargar el paquete de
entregas siendo estudiante · adelantar una publicación programada · borrar una
asignatura y dejar actividades, entregas o archivos huérfanos · **dos entregas
simultáneas del mismo estudiante** · duplicar una asignatura con 50 estudiantes
y 40 actividades.

**Corregir obligatoriamente.** Todo acceso a entregas ajenas · toda cascada
incompleta · toda actividad visible antes de su publicación.

**Cierre.** Una asignatura de prueba creada, duplicada y borrada sin dejar
residuos · casos de reglas para `submissions` desde las tres identidades.

## A13 · Asistencia

**Módulos.** M11.

**Objetivo.** Que el registro oficial de asistencia sea fiel y solo lo escriba
su docente.

**Alcance.** Pase de lista, resumen acumulado, llenado automático, asuetos y
vacaciones.

**Revisar.** La coherencia entre `attendance` y `attendanceSummaries` (los
calcula una Cloud Function) · el llenado automático y qué asume · el trato de
días no laborables · la zona horaria de las fechas.

**Intentar romper.** Pasar lista en una asignatura ajena · escribir el resumen
directamente · pasar lista en una fecha marcada como asueto · registrar dos veces
el mismo día · pasar lista desde dos dispositivos a la vez · un ciclo completo de
asistencias y ver si el resumen sigue cuadrando.

**Corregir obligatoriamente.** Todo desfase entre detalle y resumen · toda
escritura de asistencia por quien no es el docente de la asignatura · toda fecha
que cambie de día según el dispositivo.

**Cierre.** Un mes de asistencias de prueba con asuetos y vacaciones, con
resumen y exportación coincidiendo hasta el último número.

## A14 · Avisos

**Módulos.** M12.

**Objetivo.** Que un aviso llegue exactamente a quien iba dirigido, y a nadie
más.

**Alcance.** Publicación, programación, acuse de lectura, plantillas, guardados
y ocultos.

**Revisar.** Cómo se resuelve el destinatario (asignatura, grupo, estudiante) ·
el corte por fecha de activación del estudiante · la programación en
`revisarProgramados` · quién puede marcar una lectura.

**Intentar romper.** Leer avisos de otra asignatura · marcar la lectura de otro
estudiante · publicar un aviso en una asignatura ajena · recibir avisos
anteriores a la propia activación · adelantar un aviso programado · publicar HTML
con guion dentro de un aviso.

**Corregir obligatoriamente.** Todo aviso legible fuera de su asignatura · todo
acuse escribible por un tercero · todo HTML no saneado.

**Cierre.** Casos de reglas para las cinco colecciones de avisos · recorrido de
publicación inmediata y programada, con un estudiante activado después del
primer aviso.

## A15 · Notificaciones push

**Módulos.** M14.

**Objetivo.** Que ninguna notificación lleve información de un grupo a otro
teléfono.

**Alcance.** Tokens, permisos, canales, preferencias, envío y enlaces profundos.

**Revisar.** El ciclo de vida del token (alta, baja, limpieza de los inválidos, y
**qué pasa al cerrar sesión**) · las preferencias por categoría y por asignatura,
y si el servidor las respeta · qué datos viajan en el cuerpo de la notificación ·
a dónde lleva cada enlace profundo · la bitácora.

**Intentar romper.** Escribir un token en el documento de preferencias de otro ·
recibir una notificación de una asignatura en la que no se está inscrito ·
**cerrar sesión y seguir recibiendo** notificaciones de la cuenta anterior ·
prestar el teléfono, entrar con otra cuenta y ver qué llega · que un enlace
profundo abra contenido ajeno · que un opt-out sea ignorado.

**Corregir obligatoriamente.** Todo dato sensible en el cuerpo de la
notificación · todo envío que ignore la preferencia del destinatario · todo
enlace profundo que no verifique acceso al abrirse · todo token que sobreviva al
cierre de sesión.

**Cierre.** Cada categoría probada con destinatario correcto e incorrecto ·
reglas de `notificationSettings` verificadas · cierre de sesión probado en el
teléfono.

## A16 · Exportaciones

**Módulos.** M16.

**Objetivo.** Que lo que se entrega a la escuela sea correcto, y que solo salga
sin marca de agua para quien pagó.

**Alcance.** PDF, Excel, descarga de entregas, membrete y marca de agua.

**Revisar.** Que el membrete tome la escuela y el docente correctos · el
comportamiento de la marca de agua en los cuatro estados de suscripción · los
caracteres que las fuentes de jsPDF no tienen · el guardado en Android · los
nombres de archivo.

**Intentar romper.** Exportar sin marca de agua estando en prueba · exportar
datos de otra asignatura · un nombre con acentos o emoji que rompa el archivo ·
**una celda de Excel que empiece con `=` y se ejecute al abrirse** (inyección de
fórmula, con datos que escribió un estudiante) · una tabla tan larga que se
corte · exportar un grupo de 50 con 40 actividades y ver si el navegador
aguanta.

**Corregir obligatoriamente.** Toda exportación sin marca de agua que debiera
llevarla · toda inyección de fórmula en Excel · todo dato de un docente en el
documento de otro · todo reporte que se corte en silencio.

**Cierre.** Los reportes principales **generados y abiertos de verdad** (no solo
generados) en los cuatro estados de suscripción, en web y en Android.

## A17 · Archivos y multimedia — COMPLETADA

> **Cerrada el 6-ago-2026**, en tres ejecuciones contra producción. La última
> —la que vale— pasó **los cinco puntos**. Commits `fc13c4e`
> ([PR #1002](https://github.com/Alan20111/evalua-facil/pull/1002)) y `6b7f026`
> ([PR #1007](https://github.com/Alan20111/evalua-facil/pull/1007)).
>
> **La historia en tres actos, porque el segundo es el que enseña algo.**
>
> **Acto 1 — faltaba la credencial.** La primera ejecución dio
> `{"archivos":{"total":12,"borrados":0,"configurado":false}}`: las llaves no
> estaban en Vercel. Once de las doce URLs seguían entregando el archivo después
> de que la cuenta dejó de existir. Se pusieron esa misma tarde (`20ec1a4`,
> `034cf19`), marcadas *Sensitive* y sin prefijo `VITE_` — con ese prefijo el
> secreto viajaría dentro del bundle público.
>
> **Acto 2 — la credencial no bastaba, y ese fue el hallazgo de verdad.** Con
> las llaves puestas, el endpoint respondió `configurado:true, borrados:2` … **y
> las URLs seguían devolviendo HTTP 200 con el contenido íntegro**. No era que el
> borrado fallara: la misma URL con una transformación nueva (`a_0`), que obliga
> a Cloudinary a ir al original, ya respondía `404 Resource not found`, y una URL
> inventada respondía ese mismo 404. El archivo **estaba borrado y se seguía
> entregando igual**, porque la URL de entrega la sirve el CDN y Cloudinary la
> manda con `cache-control: public, immutable, max-age=2592000`: **treinta días**.
> Un parámetro anti-caché (`?_=…`) no lo esquiva.
>
> Para la foto de perfil de un menor, la entrega de un alumno o el comprobante de
> pago de un docente, eso es exactamente la diferencia entre borrar y aparentar
> que se borró — y es literalmente el punto 4 de R14. Sin las llaves este defecto
> era **invisible**: no se puede ver que un borrado deja rastro en el CDN cuando
> el borrado ni siquiera se intenta. Se corrigió con `invalidate: true` en la
> petición y en la firma, en los **dos** sitios que borran: `api/_lib/cloudinary.js`
> (del que cuelgan los tres endpoints) y la escoba `seeds-db/purgar-cloudinary-pendientes.js`.
>
> **Acto 3 — la prueba, ya con todo en su sitio.** 12 de 12 archivos borrados,
> 0 URLs entregando, 0 originales en el almacén, 0 apuntes de pendientes, RO-2
> cumplido. Detalle en la tabla de R14, más abajo.
>
> **Cuánto tarda en dejar de entregarse.** El borrado es efectivo pero **no
> instantáneo**, y el expediente no puede decir "desaparece" sin decir cuándo. Se
> midió a propósito, con la caché del CDN caliente (alguien ya había abierto el
> archivo, que es el caso realista): **~11 segundos** desde que el endpoint
> responde hasta que la URL deja de entregar — entre los 5,2 s (todavía 200) y
> los 10,8 s (ya 404). Antes de la corrección eran treinta días.
>
> **La escoba, corrida por la vía de producción.** `seeds-db/purgar-cloudinary-pendientes.js`
> pide las llaves **locales**, y en la máquina de trabajo **no están** —solo en
> Vercel; son de Alan (§1.8)—. Corregido de paso un dato equivocado del commit
> `6e50611`, que daba por hecho que sí estaban en `.env`: no lo están. Así que se
> barrió por donde sí hay llaves: un docente desechable cuyo perfil apunta a todos
> los archivos pendientes, borrado por el endpoint real. **52 archivos huérfanos
> distintos** en 9 apuntes; 50 seguían ocupando cuota; **los 50 borrados y
> comprobados uno por uno** con la vía que salta el CDN. Los 9 apuntes cerrados.
>
> **Lo único que la auditoría no pudo terminar de limpiar**, y se dice en vez de
> callarlo: pueden quedar **unos pocos archivos `zztest*`** de las pruebas al
> preset de la primera ronda que **nunca se anotaron** en `archivosPendientes` y
> que, por tanto, la escoba no alcanza. No se pueden encontrar sin **enumerar la
> cuenta**, y eso pide las llaves de la Admin API, que no están en esta máquina.
> Son unos kilobytes y no son datos de nadie —los subió la propia auditoría—,
> pero son residuo (§1.5). Se barren en una sesión que tenga las llaves, con
> `GET /v1_1/<cloud>/resources/search?expression=public_id:zztest*` y un
> `destroy` por cada resultado.
>
> **Lo que quedó demostrado en la primera ronda y no hubo que repetir:**
> - **Firestore no deja un solo residuo.** Un barrido *ciego* de las 31
>   colecciones raíz (1 824 documentos), buscando el uid, el prefijo y cada
>   `public_id` uno por uno, encontró **cero** huérfanos tras el borrado — solo
>   la constancia de baja, que es intencional. Las dos subcolecciones, vacías.
> - **La recolección de archivos es correcta y completa: 12 de 12**, incluidos
>   los tres casos que se rompen solos — una URL dentro del HTML de las
>   instrucciones, otra dentro de un arreglo anidado, y dos dentro de
>   subcolecciones. Lo que falla es el borrado, no el inventario.
> - **RO-2 se cumple.** De los dos alumnos, se eliminó la cuenta de uno: la del
>   que se quedó sin ninguna inscripción. El que seguía con otro docente
>   conservó la suya, y su inscripción con el otro docente quedó intacta.
> - **El editor de texto enriquecido no es una vía de XSS.** 18 payloads contra
>   la configuración real del saneador; **0 sobrevivieron**.
> - **El preset sin firmar está más acotado de lo que se temía**: tope real de
>   10 MB, los `.exe` rechazados, y Cloudinary no permite sobrescribir el
>   archivo de nadie sin firma. Un `.html` con `<script>` sí se sube, pero se
>   entrega con `Content-Disposition: attachment` y no ejecuta.
>
> **Foto de la cuenta el 6-ago-2026** (enumeración por la Admin API, hecha desde
> la sesión que puso las llaves): **344 archivos · 302 MB**. De esos, **57
> (~164 MB) son los `samples/`** que Cloudinary regala con cada cuenta y no los
> subió la app — la factura real de Evalúa Fácil es bastante menor de lo que
> sugiere el bruto. El grueso propio está en `submissions` (147), `profiles` (30)
> y `avatars` (24).
>
> **La limitación de evidencia que el PO aceptó el 6-ago-2026 dejó de ser un
> hueco.** Se temía no poder decir nada sobre los recursos que Cloudinary deriva
> de un PDF. Se resolvió por otro camino: las páginas rasterizadas se
> **materializaron a propósito antes del borrado** (`pg_1` → 4 606 bytes, `pg_2`
> → 4 787 bytes) y quedaron como URLs concretas que se interrogan una por una.
> Tras el borrado, **las dos responden 404**. La evidencia sigue siendo indirecta
> —se comprueba que la URL deja de entregar, no que el derivado salió del
> inventario— pero es un hecho reproducible, no una laguna. Dato del camino: el
> PDF **original** ya devolvía 401 antes de borrar nada, porque la cuenta tiene
> desactivada la entrega de PDF; el contenido del documento viaja al alumno por
> esas páginas derivadas, no por el `.pdf`. **Es decir que borrar el original sin
> purgar los derivados habría dejado el documento entero legible.**
>
> **Lo que sostiene el resto del expediente:**
> - `api/_lib/cloudinary.js` está escrito para no mentir: sin las llaves,
>   `borrarAssets` devuelve `configurado: false` y la lista de `pendientes` en
>   vez de fingir que limpió. Trata `not found` como éxito, que es lo correcto
>   para reintentos — pero eso tiene un costo, anotado en **R18**.
> - `extraerAssets` recorre el JSON completo del documento con una expresión
>   regular en vez de una lista de campos — a propósito, para que un campo nuevo
>   no se quede sin limpiar. Los `raw` conservan la extensión en el `public_id`;
>   imagen y vídeo no.
> - **CORS no es lo que protege este endpoint, y está bien que así sea.** Un POST
>   con `Origin` ajeno y un token válido **sí** borra (HTTP 200), y eso no es un
>   agujero: la autenticación es un Bearer token, no una cookie, así que no hay
>   autoridad ambiental que robar. Lo que protege al navegador es el *preflight*,
>   y se comprobó: `OPTIONS` desde `https://sitio-malicioso.example` responde 204
>   **sin** `Access-Control-Allow-Origin` —el navegador corta ahí— mientras que
>   desde `https://localhost` (la app Android) devuelve la cabecera correcta.
>
> **A17 cierra también R14 — es obligatorio.** Decisión del PO (5-ago-2026): la
> verificación del ciclo de vida de los archivos y la del borrado integral del
> docente **no son dos pruebas, son una sola de extremo a extremo**. Resultado de
> la ejecución definitiva, punto por punto:
>
> | # | Debe demostrar | Resultado |
> |---|---|---|
> | 1 | Que **todos los archivos** desaparecen de verdad | ✔ **12 de 12 borrados**, `configurado:true`, 0 anotados como pendientes |
> | 2 | Que **no quedan documentos huérfanos** | ✔ 0, por barrido ciego de las colecciones raíz |
> | 3 | Que **no quedan referencias rotas** desde lo que sobrevive | ✔ lo único que queda con su uid es su propia constancia de baja, que es intencional |
> | 4 | Que **no permanece ningún recurso accesible** por URL | ✔ **0 de 12** entregan, y 0 de 12 originales quedan en el almacén; los 2 derivados del PDF, también 404 |
> | 5 | Que **RO-2 sigue cumpliéndose** | ✔ el alumno compartido conservó cuenta e inscripción; se borró solo la cuenta del que se quedó sin ninguna clase |
>
> **Cinco de cinco. R14 queda cerrado.**
>
> **Cómo repetirlo.** El barrido es *ciego* a propósito: no le pregunta al
> endpoint qué colecciones cree tocar, recorre todas las raíz y busca el uid del
> docente, el prefijo `zztest-` y cada `public_id` uno por uno. Es la única forma
> de encontrar residuo en un lugar que nadie anticipó. Cada archivo se interroga
> por **dos vías**: la URL canónica (¿alguien se lo puede descargar todavía?) y
> la misma URL con una transformación nunca pedida (¿queda el original en el
> almacén?, pregunta que se salta el CDN por construcción). Las dos tienen que
> dar 404.
>
> **Números de la ejecución definitiva.** 34 documentos + 2 subdocumentos + 12
> archivos; el endpoint borró 32 documentos, 1 asignatura, 2 alumnos y 1 cuenta
> de alumno en 2,8 s. Base de 1 815 documentos en 32 colecciones raíz antes;
> 41 rastros del docente antes del borrado, 0 suyos después. Al terminar la
> auditoría: **0 rastros, 0 cuentas `zztest` en Auth, 0 apuntes en
> `archivosPendientes`**.

**Módulos.** M17.

**Objetivo.** Que el almacenamiento no se convierta en un depósito abierto, en
una fuga de documentos, ni en una factura sorpresa.

**Alcance.** Subida sin firma con preset, entrega, previsualización y borrado.

**Revisar.** Qué permite el preset de subida sin firma (tipos, tamaños,
carpetas) · si las URL de entrega son adivinables · el saneado del HTML del
editor · el borrado desde el servidor · la cuota contratada y quién la paga.

**Intentar romper.** Subir un archivo enorme o de un tipo no previsto · subir a
una carpeta que no corresponde · **usar el preset desde fuera de la aplicación**,
sin sesión, para llenar la cuenta de Alan · adivinar la URL del comprobante de
pago de otro docente · inyectar HTML o script por el editor de texto
enriquecido · subir un archivo con el nombre de otro para sobrescribirlo.

**Corregir obligatoriamente.** Toda subida sin límite de tipo y tamaño · todo
HTML no saneado que llegue a otra pantalla · los comprobantes de pago accesibles
por URL sin autenticación · la falta de tope de cuota si el preset resulta
utilizable desde fuera.

**Cierre.** Límites verificados contra el preset real (no contra el código que
lo llama) ✔ · una prueba de XSS por el editor que no pase ✔ (18 payloads, 0
sobrevivieron) · postura documentada sobre la cuota, acordada con Alan —
**pendiente de Alan**, ver R16: es lo único de esta ficha que no depende de la
auditoría, y por eso queda como riesgo abierto en vez de detener el cierre.

## A18 · Calendario y agenda

**Módulos.** M13.

**Objetivo.** Que las fechas que ve cada quien sean las suyas y estén bien
calculadas.

**Alcance.** Eventos del docente, académicos y del estudiante, horario por
bloques, alarmas locales y la agenda.

**Revisar.** Zonas horarias y cambios de día · el solapamiento de bloques · la
programación por zona semanal · las alarmas locales de Android · qué eventos ve
un estudiante inscrito en varias asignaturas.

**Intentar romper.** Leer o editar eventos de otro docente · crear un evento en
una asignatura ajena · un evento a caballo entre dos días · una entrega que vence
a las 23:59 vista desde otra zona horaria · alarmas duplicadas · un bloque de
horario que pise a otro · un ciclo entero de eventos y ver qué tarda la agenda.

**Corregir obligatoriamente.** Todo evento visible o editable fuera de su dueño ·
todo cálculo de fecha que dependa de la zona horaria del dispositivo.

**Cierre.** Casos de reglas para las cinco colecciones de calendario · una
semana de prueba con eventos, bloques y asuetos, coherente en web y Android, con
el dispositivo en otra zona horaria.

## A19 · Navegación y guardianes de ruta

**Módulos.** M21, M31 (acceso).

**Objetivo.** Que escribir una dirección a mano no lleve a donde no se debe.

**Alcance.** Las 28 rutas, los tres guardianes, los layouts y el botón de atrás.

**Revisar.** Cada ruta contra los tres roles y contra la sesión cerrada · el
estado intermedio mientras carga el perfil · las redirecciones · el botón físico
de atrás con modales abiertos · el bloqueo de desplazamiento.

**Intentar romper.** Entrar a cada ruta protegida con el rol equivocado y sin
sesión · quedarse dentro después de cerrar sesión · **volver atrás con el botón
del navegador tras cerrar sesión** y ver si la pantalla anterior sigue con datos ·
atrapar la aplicación entre dos redirecciones · salir de un modal con el botón de
atrás dejando el fondo bloqueado.

**Corregir obligatoriamente.** Toda ruta accesible con el rol equivocado · toda
pantalla que muestre datos mientras decide si puede mostrarlos · todo dato que
sobreviva en pantalla al cierre de sesión.

**Cierre.** Matriz completa de 28 rutas × 4 identidades, con el resultado de
cada celda en el informe.

## A20 · Aplicación Android

**Módulos.** M23.

**Objetivo.** Que la app haga exactamente lo mismo que la web, y que una versión
vieja instalada no se vuelva un problema.

**Alcance.** Empaquetado, permisos, plugins nativos, actualización y paridad.

**Revisar.** Qué diferencias intencionales hay hoy entre app y web, y si siguen
teniendo sentido · los permisos del manifiesto · el aviso de actualización · qué
queda dentro del paquete (¿secretos?) · los enlaces profundos · qué versión está
publicada en Google Play y qué manda al servidor.

**Intentar romper.** Usar la versión publicada contra las reglas actuales · un
enlace profundo hacia contenido ajeno · quedarse sin la actualización y con una
pantalla que ya no existe · abrir la app sin red y ver qué queda a medias.

**Corregir obligatoriamente.** Toda diferencia no intencional entre app y web ·
todo permiso que la app no use · todo secreto dentro del paquete.

**Cierre.** Lista de diferencias app/web documentada y justificada una por una ·
compilación e instalación verificadas · la versión publicada probada contra las
reglas en producción.

## A21 · Correo transaccional

**Módulos.** M15.

**Objetivo.** Que el correo llegue a quien debe, con lo que debe, y que nadie
pueda usarlo para mandar lo suyo.

**Alcance.** Los dos caminos vivos (Brevo desde el servidor, EmailJS desde el
cliente), las plantillas y el cron diario.

**Revisar.** Quién puede disparar cada envío · qué datos personales llevan las
plantillas · el escapado del HTML · el destinatario del cron · si EmailJS sigue
haciendo falta.

**Intentar romper.** Enviar un correo a una dirección arbitraria desde el
endpoint · inyectar HTML por el nombre del docente o de la escuela · disparar el
cron desde fuera · provocar un envío masivo · mandar mil peticiones y ver si
algo frena.

**Corregir obligatoriamente.** Todo envío a una dirección que no salga de la
base · toda inyección en la plantilla · el endpoint abierto si lo está.

**Cierre.** Cada plantilla revisada con datos hostiles · decisión tomada sobre
mantener o retirar EmailJS (**es decisión de producto: escalar**).

## A22 · Seguridad de datos y privacidad

**Módulos.** M27.

**Objetivo.** Que lo que se declaró ante Google Play y en el aviso de privacidad
siga siendo verdad.

**Alcance.** Saneado de HTML, aviso de privacidad, declaración de seguridad de
datos, política de retención y consentimiento.

**Revisar.** Qué datos se recogen de verdad hoy contra lo declarado · la
retención de 90 días (declarada pero **sin borrado automático**) · el saneado del
editor · dónde salen datos hacia terceros (Cloudinary, Brevo, FCM) · **el
tratamiento de menores de edad**: quién consiente, qué se les pide y qué exige
Google Play para una app dirigida a estudiantes.

**Intentar romper.** Un guion en el HTML del editor que sobreviva al saneado ·
recuperar datos de una cuenta ya eliminada · encontrar un dato recogido que no
esté declarado · encontrar un dato que sale hacia un tercero sin estar declarado.

**Corregir obligatoriamente.** Toda diferencia entre lo declarado y lo real ·
todo XSS que sobreviva · **R4** (o se implementa el borrado a los 90 días o se
corrige la declaración: **decisión de producto**) · la postura sobre
consentimiento de menores, si resulta que falta (**decisión de producto**).

**Cierre.** Tabla de datos recogidos, para qué, a dónde salen y cuánto se
conservan, coincidiendo con lo declarado en Play y en el aviso de privacidad.

## A23 · Interfaz, accesibilidad y consistencia

**Módulos.** M22, M32, M31 (presentación).

**Objetivo.** Que la plataforma se pueda usar completa, en cualquier pantalla y
por cualquiera, sin que ninguna función quede fuera de alcance.

**Alcance.** Componentes base, tema claro y oscuro, comportamiento responsivo,
accesibilidad, el manual y el onboarding.

**Revisar.** Las pantallas principales a 320, 375, 768 y 1280 píxeles · tema
claro y oscuro · contraste de texto · navegación con teclado y foco visible ·
etiquetas de los campos y de los botones de solo ícono · tamaño mínimo de las
zonas tocables · qué se ve mientras algo carga y qué se ve cuando algo falla ·
que el manual siga describiendo lo que la plataforma hace hoy.

**Intentar romper.** Una pantalla de 320 píxeles donde un botón quede fuera o no
se pueda tocar · un modal que no se cierre con teclado · un texto ilegible en
tema oscuro · un formulario que no diga qué salió mal · un nombre larguísimo o un
grupo de 50 que descuadre una tabla.

**Corregir obligatoriamente.** Toda función inalcanzable en alguna pantalla ·
todo control sin nombre accesible · todo estado de error mudo · toda
instrucción del manual que ya no corresponda.

**Cierre.** Las pantallas principales medidas en los cuatro anchos, en ambos
temas, con evidencia · `npm run check:design` en verde.

## A24 · Operación, secretos y despliegue

**Módulos.** M28, M33, y la configuración de despliegue.

**Objetivo.** Que nadie pueda borrar la base por accidente, que ninguna
credencial viaje donde no debe, y que un despliegue se pueda deshacer.

**Alcance.** Los 16 scripts de `seeds-db/`, los de `scripts/`, la configuración
(`vercel.json`, `firebase.json`, `.firebaserc`, `capacitor.config.json`), las
variables de entorno y las herramientas fuera del producto.

**Revisar.** Qué scripts siguen sirviendo y cuáles son basura · a qué proyecto
apunta cada uno y si eso se ve antes de correrlo · qué hay en `.gitignore` y qué
se coló al repositorio (`Avatar/.env`, `google-services.json`, `.env`) · qué
variables son públicas (`VITE_`) y cuáles no deberían serlo · el tope de 12
funciones de Vercel y cuánto margen queda · cómo se vuelve atrás de un
despliegue de reglas o de funciones.

**Intentar romper.** Correr un script destructivo creyendo que apunta al
emulador · encontrar una credencial en el historial de git · encontrar un secreto
servido al navegador · agregar un endpoint y pasarse del tope de Vercel sin
enterarse (ya pasó: producción se quedó cuatro commits atrás).

**Corregir obligatoriamente.** Todo script destructivo sin confirmación explícita
del proyecto al que apunta · toda credencial versionada · todo secreto expuesto
al cliente · la ausencia de un procedimiento escrito de reversa.

**Cierre.** Inventario de scripts con su destino (conservar, mover, borrar) ·
inventario de secretos con dónde vive cada uno · procedimiento de reversa escrito
y probado una vez.

---

# 8. Bitácora de ejecución

**Estados.** `Pendiente` · `En proceso` · `Completada` · `Bloqueada` (esperando
una decisión del Product Owner; se anota qué se preguntó).

**`Completada` no se escribe sin expediente.** Una auditoría hecha pero no
demostrable se queda en `En proceso` hasta que la evidencia de §3 exista. Marcar
lo contrario convierte esta tabla en una lista de buenas intenciones.

## Por fase

| Fase | Auditorías (en orden) | Estado |
|---|---|---|
| **F0** · Dinero y acceso comercial | A01 → A02 | **Cerrada** · 5-ago-2026 |
| **F1** · Cimientos del servidor | A03 → A04 → A05 → A06 | **Cerrada** · 5-ago-2026 — aprobada por el PO |
| **F2** · Personas y su información | A07 → A10 → A11 → *A17* | **Cerrada** · 6-ago-2026 — las cuatro Completadas; A17 pasó sus cinco puntos. Dos criterios de cierre dependen de terceros y quedan a la vista como riesgos (R7 por RO-1, R16 por Alan) |
| **F3** · El trabajo académico | A08 → A09 → A12 → A13 → A18 | Pendiente |
| **F4** · Lo que sale del sistema | A14 → A15 → A16 → A21 | Pendiente |
| **F5** · Superficie y entorno | A19 → A20 → A23 | Pendiente |
| **F6** · Cumplimiento y operación | A22 → A24 | Pendiente |

## Por auditoría

Ordenada por número para poder buscarla; el orden de ejecución es el de arriba.

| # | Auditoría | Fase | Módulos | Riesgo | Estado | Fecha | Commit / PR |
|---|---|---|---|---|---|---|---|
| A01 | Suscripciones y candado | F0 | M02 | Crítico | **Completada** | 5-ago-2026 | `bad52d8` · [#983](https://github.com/Alan20111/evalua-facil/pull/983) |
| A02 | Pagos | F0 | M03 | Crítico | **Completada** | 5-ago-2026 | `c95d293` · [#984](https://github.com/Alan20111/evalua-facil/pull/984) |
| A03 | Reglas de Firestore y modelo de datos | F1 | M24 | Crítico | **Completada** | 5-ago-2026 | `a4fa5fc` · [#987](https://github.com/Alan20111/evalua-facil/pull/987) |
| A04 | Autenticación e identidad | F1 | M01, M18 | Crítico | **Completada** | 5-ago-2026 | `631f7ec` · [#989](https://github.com/Alan20111/evalua-facil/pull/989) |
| A05 | Cloud Functions | F1 | M25 | Crítico | **Completada** | 5-ago-2026 | `8b01f06` · [#991](https://github.com/Alan20111/evalua-facil/pull/991) |
| A06 | API serverless | F1 | M26 | Crítico | **Completada** | 5-ago-2026 | `ccbb0bb` · [#993](https://github.com/Alan20111/evalua-facil/pull/993) |
| A07 | Estudiantes e inscripciones | F2 | M06, M20 | Crítico | **Completada** | 5-ago-2026 | `e3e7fd9` · [#995](https://github.com/Alan20111/evalua-facil/pull/995) |
| A08 | Evaluaciones | F3 | M08 | Crítico | Pendiente | — | — |
| A09 | Calificaciones, ponderación y rúbricas | F3 | M10, M09 | Crítico | Pendiente | — | — |
| A10 | Perfil y cuenta del docente | F2 | M19 | Crítico | **Completada** | 5-ago-2026 | `229da17` · [#997](https://github.com/Alan20111/evalua-facil/pull/997) |
| A11 | Panel de administración | F2 | M04 | Crítico | **Completada** | 5-ago-2026 | `832b492` · [#999](https://github.com/Alan20111/evalua-facil/pull/999) |
| A12 | Actividades, entregas y asignaturas | F3 | M07, M05 | Alto | Pendiente | — | — |
| A13 | Asistencia | F3 | M11 | Alto | Pendiente | — | — |
| A14 | Avisos | F4 | M12 | Alto | Pendiente | — | — |
| A15 | Notificaciones push | F4 | M14 | Alto | Pendiente | — | — |
| A16 | Exportaciones | F4 | M16 | Alto | Pendiente | — | — |
| A17 | Archivos y multimedia | F2 | M17 | Alto | **Completada** | 6-ago-2026 | `6b7f026` · [#1007](https://github.com/Alan20111/evalua-facil/pull/1007) — cierra R3 y R14; antes `fc13c4e` · [#1002](https://github.com/Alan20111/evalua-facil/pull/1002) |
| A18 | Calendario y agenda | F3 | M13 | Alto | Pendiente | — | — |
| A19 | Navegación y guardianes de ruta | F5 | M21, M31 | Alto | Pendiente | — | — |
| A20 | Aplicación Android | F5 | M23 | Alto | Pendiente | — | — |
| A21 | Correo transaccional | F4 | M15 | Alto | Pendiente | — | — |
| A22 | Seguridad de datos y privacidad | F6 | M27 | Alto | Pendiente | — | — |
| A23 | Interfaz, accesibilidad y consistencia | F5 | M22, M32, M31 | Medio | Pendiente | — | — |
| A24 | Operación, secretos y despliegue | F6 | M28, M33 | Alto | Pendiente | — | — |

**Avance: 10 de 24 auditorías (42%) · 3 de 7 fases cerradas (F0, F1 y F2).**
Casos de prueba automatizados: **80** (37 antes de la primera auditoría).
Siguiente: **Fase 3 · El trabajo académico** — A08 (evaluaciones) → A09
(calificaciones, ponderación y rúbricas) → A12 (actividades, entregas y
asignaturas) → A13 (asistencia) → A18 (calendario y agenda).

**La Fase 2 cierra con dos asuntos abiertos que no son suyos.** Decisión del
Product Owner, 6-ago-2026, tras revisión crítica de la fase completa:

- **R7 (y con él R8 y R9) no es un criterio incumplido de la Fase 2**: pertenece
  al **proyecto de migración del alcance de lectura** aprobado en **RO-1**, que
  es una línea de trabajo propia y explícitamente **fuera del alcance de A17**.
  Sigue abierto en §9, con su dueño y su orden de despliegue.
- **R16** (el preset sin firmar) es una dependencia de Alan y se rige por
  **RO-3**: queda registrada y no detiene nada.

Lo que la fase sí cumplió, entero: el docente de prueba creado, poblado y
eliminado con verificación documento por documento y archivo por archivo; los
límites del preset medidos contra el servicio real; cada acción del panel
denegada en cliente y en servidor; y **R3 cerrado**.

**Lo que la revisión crítica de la fase sí dejó como deuda propia** —y no cambia
el cierre, pero manda sobre las fases que vienen— es que **la suite no cubre
endpoints ni Cloud Functions**. De las cuatro auditorías, las dos cuyos defectos
vivían solo en un endpoint o en la interfaz (A11 y A17) **no dejaron un solo caso
permanente**. Ver la nota de estrategia al final de §8.

**Dos criterios de cierre de la Fase 1 no se cumplieron al pie de la letra** y
se cierran igual, a la vista, en vez de darlos por buenos:

- La cobertura pedida era *"cada una de las 30 colecciones con un caso legítimo
  y un ataque"*. Las 30 se recorrieron y se corrigió lo que apareció, pero la
  suite cubre las de mayor riesgo, no las 30 una por una. Lo que falta es
  cobertura de prueba, no revisión.
- **R2 seguía asignado a esta fase y no se cerró.** Las reglas acotan el monto a
  un rango sano, pero la tarifa exacta sigue sin validarse en el servidor. Se
  reasigna a A11 (panel de administración), que es donde vive la pantalla que
  tendría que administrar esa tarifa.

## Resultados de las auditorías completadas

**A17 · Archivos y multimedia** (6-ago-2026, un día). Ejecutada tres veces
contra producción con un docente de prueba real. **Cerrada**, y con ella **R3**
y **R14**.

El primer hallazgo fue el que nadie quería: **las llaves de Cloudinary no
estaban puestas en Vercel**. Se venía trabajando sobre el supuesto contrario. No
hubo que deducirlo — el endpoint lo dijo con todas sus letras
(`"configurado":false`, 12 archivos sin borrar). Se pusieron esa misma tarde
(`20ec1a4`, `034cf19`).

**Y ahí apareció el hallazgo de verdad, que la falta de credencial estaba
tapando.** Con las llaves puestas, el endpoint respondió `borrados:2` y **las
URLs seguían devolviendo HTTP 200 con el contenido íntegro**. El borrado sí
había ocurrido: la misma URL con una transformación nueva —que obliga a ir al
original— respondía 404. Lo que pasaba es que **la entrega la sirve el CDN**, y
Cloudinary la marca `immutable, max-age=2592000`: **treinta días** durante los
cuales cualquiera con la URL se sigue descargando la foto de un menor, la
entrega de un alumno o el comprobante de pago de un docente. Borrado y
descargable a la vez.

Ese defecto **era invisible sin las llaves**: no se puede ver que un borrado
deja rastro en el CDN cuando el borrado ni siquiera se intenta. La corrección es
`invalidate: true` en la petición y en la firma, en los dos sitios que borran.
Medido después: **~11 segundos** con la caché caliente, contra treinta días.

Con eso, la prueba de extremo a extremo pasó **los cinco puntos**: 12 de 12
archivos borrados, 0 URLs entregando, 0 originales en el almacén, los 2
derivados del PDF también 404, 0 documentos huérfanos por barrido ciego y RO-2
cumplido. Se barrieron además **52 archivos huérfanos** que esperaban escoba
(50 seguían vivos, los 50 borrados y comprobados uno por uno), y la auditoría no
dejó residuo propio: 0 rastros, 0 cuentas `zztest`, 0 apuntes pendientes.

De paso se cerró el hueco de A07 que quedaba sin ejercitar: **los dos endpoints
del estudiante**. `remove-photo` borra el archivo y limpia el campo; `delete`
devuelve **409** si todavía queda una inscripción —que es la regla de fondo, no
un tecnicismo— y borra archivo y cuenta cuando ya no queda ninguna.

La corrección de la primera ronda sigue siendo la más valiosa, porque
convertía un problema temporal en uno permanente: **la lista de archivos que no
se pudieron borrar solo se escribía en el log de Vercel**. Ese log se rota en
horas, y los documentos de Firestore que guardaban esas URLs ya no existen —son
justamente los que se acaban de borrar—. Pasado ese rato, un archivo huérfano
se vuelve *imposible de encontrar*: nadie puede saber que existe, de quién era,
ni cuál es su `public_id` para borrarlo. Ocupa cuota, que paga Alan, para
siempre y sin que nadie sepa cuánta. Ahora la constancia se escribe en
`archivosPendientes` **antes** de que esa información deje de existir, y
`seeds-db/purgar-cloudinary-pendientes.js` es la escoba que la vacía. La fuga
tenía la misma forma en los tres endpoints que borran archivos, no solo en el
de la cuenta del docente.

Lo que quedó demostrado y no hay que repetir: **Firestore no deja un solo
residuo**. Un barrido *ciego* de las 31 colecciones raíz —sin preguntarle al
endpoint qué colecciones creía tocar, que es la única forma de encontrar lo que
nadie anticipó— no halló ningún huérfano. La recolección de archivos fue de
**12 de 12**, incluidas una URL dentro de HTML, otra dentro de un arreglo
anidado y dos dentro de subcolecciones. **RO-2 se cumple**: de dos alumnos se
eliminó la cuenta de uno, la del que se quedó sin ninguna inscripción. Y el
editor de texto enriquecido resistió **18 payloads de XSS sin que sobreviviera
ninguno**.

De paso, dos cosas menores: un token corrupto devolvía HTTP 500 con el mensaje
interno de la librería de Firebase (ahora 401), y los enlaces del editor con
`target="_blank"` salían sin `rel="noopener"`.

Tres riesgos nuevos. Dos no son corregibles desde el código sin decisión ajena:
**R16** (el preset sin firmar deja subir a cualquiera, sin sesión y a la carpeta
que quiera — es de Alan) y **R17** (el atributo `style` permite un pixel de
rastreo; quitarlo cambiaría lo que ya escribieron los docentes, así que se
pregunta antes). El tercero sí lo es y se deja anotado a propósito: **R18**, que
`not found` cuente como éxito hace que `borrados` pueda contar de más si algún
día un `public_id` se calcula mal. Suite: 80 casos, sin cambios — la corrección
vive en un endpoint, no en las reglas, y su evidencia es la ejecución en
producción.

**Nota de método, que vale para las auditorías que vienen.** En la ronda 2, el
caso negativo *"POST desde un origen ajeno"* llevaba token válido y la palabra
de confirmación, así que **borró la cuenta de verdad** — y el borrado real acabó
ocurriendo dentro de una prueba etiquetada como negativa. Los números eran
correctos; la procedencia, no. Se repitió entera con cada caso destructivo
apuntando a su propio docente desechable. Un expediente donde la evidencia sale
de donde no dice es tan malo como uno sin evidencia.

**A11 · Panel de administración** (5-ago-2026, unas horas). Última auditoría
ejecutable de la Fase 2.

Un defecto corregido: **el modal manual de suscripciones guardaba rangos de
fechas invertidos sin decir nada**. Un vencimiento anterior al inicio no es un
dato raro, es un candado mal puesto: `onSuscripcionEscrita` espeja
`fechaVencimiento` a `users/{uid}.suscripcionHasta` y las reglas lo comparan
contra `request.time`, así que **un año mal tecleado deja al docente sin poder
calificar ni pasar lista** — en silencio, y desde el propio panel.

El control de acceso quedó en verde, y lo importante es *por qué*: el guardián
`ProtectedAdmin` es del navegador y por sí solo no protege nada, pero las
colecciones que de verdad importan —`subscriptions`, `payments` y `bajas`— son
admin-only en el servidor. Un docente que forzara el panel abierto no vería
esos datos: la carga entera falla. Lo que sí alcanzaría —`users`, `students`,
`subjects`— es exactamente lo que ya está registrado en R7 y R8.

**R2 sigue sin cerrarse, y ya van dos auditorías.** Ver su renglón. Suite: 80
casos, sin cambios — la corrección es de interfaz y su evidencia es la
verificación de la comparación de fechas, no un caso de reglas.

**A10 · Perfil y cuenta del docente** (5-ago-2026, unas horas).

**RO-2 sí se puede cumplir, y el diseño ya la cumplía.** Se verificó el orden
real: el endpoint borra primero las inscripciones de las asignaturas del
docente y **después** pregunta, por cada alumno, si le queda alguna otra. Solo
borra la cuenta de Auth de quien se quedó sin ninguna. Un alumno compartido con
otro maestro conserva su cuenta — que es una sola para todas sus materias.

Dos defectos corregidos:

*Cuatro colecciones del docente no se borraban nunca*: `avisos`,
`avisoPlantillas`, `academicEvents` y `horario`. Los avisos eran lo grave —
quedaban legibles para cualquier cuenta autenticada y **sin nadie que pudiera
borrarlos jamás**, porque su regla de borrado exige ser el docente dueño, un uid
que ya no existe. Comunicados de un maestro que se fue, huérfanos y permanentes.
Se agregan, junto con el estado por-estudiante de los avisos.

*La constancia de baja se escribía sin que nadie pudiera leerla.* `bajas` no
tenía regla, así que Firestore la denegaba por omisión, y el panel la lee con un
`.catch` que se tragaba el error. Todo el trabajo de dejar rastro no servía de
nada, y en silencio.

**Lo que no se pudo verificar** quedó en R14: el borrado completo no se había
ejecutado de punta a punta. Se revisó por inspección y con casos de reglas, pero
la prueba que pide su ficha —crear un docente, poblarlo, borrarlo y comprobar
documento por documento— necesitaba lo mismo que A17: poder ejecutar un borrado
real. Suite: 77 → 80 casos.

> **Actualización del 6-ago-2026 (A17). El criterio "sin residuos" queda
> verificado ENTERO, y no por inspección.** Un barrido ciego de las colecciones
> raíz, tras borrar un docente de prueba poblado, encontró **cero** documentos
> huérfanos y cero referencias rotas, y RO-2 se cumplió. Y la mitad que faltaba
> —la de los archivos— también: **12 de 12 borrados de Cloudinary, 0 URLs
> entregando y 0 originales en el almacén**, incluidos los derivados del PDF.
> **R14 cerrado.**
>
> **Lo mismo vale para A07**, con un añadido suyo: sus dos endpoints de
> estudiante, que nunca se habían ejercitado contra producción, se corrieron
> aquí. `student/remove-photo` borra el archivo y limpia el campo;
> `student/delete` devuelve **409** mientras quede una inscripción y borra
> archivo y cuenta cuando ya no queda ninguna.

**A07 · Estudiantes e inscripciones** (5-ago-2026, unas horas). Dos defectos
corregidos, uno de ellos con datos que **volvían solos**.

*El resumen de asistencia de un alumno dado de baja resucitaba, y resucitaba
mal.* La baja no limpia la llave del alumno de los mapas `presentes` de cada
columna de asistencia, así que `idsAfectados` lo seguía incluyendo en cada
edición del pase de lista y la Cloud Function volvía a escribirle el resumen. Y
como `presentes?.[id] !== false` da verdadero para una llave ausente, el resumen
resucitado lo marcaba **presente en todas las clases**. Ahora, si la inscripción
ya no existe, el resumen se borra en vez de recalcularse — y eso limpia solo los
que ya estaban regados.

*El padrón es del docente.* La regla dejaba al estudiante escribir cualquier
campo de su propia inscripción mientras no tocara su identidad. Podía
reescribir su nombre en la lista del maestro —y con él, el de las actas y las
exportaciones—, cambiar su orden o agregar campos que ninguna pantalla espera.
Ahora solo toca los cuatro campos de su activación y su foto.

Lo que quedó en verde: `api/student/delete.js` verifica identidad, exige
confirmación y **se niega si el alumno sigue inscrito** —el registro académico
es del maestro, no del alumno—, y la baja que hace el docente sí limpia entregas
y prórrogas. Por RO-1, la lectura pública de `students` (R7) no se intentó
cerrar. Suite: 72 → 77 casos.

**A06 · API serverless** (5-ago-2026, unas horas). Los 9 endpoints activos
revisados con las cuatro identidades. Una vulnerabilidad **crítica**:
`/api/send-email` era un **retransmisor de correo abierto**. Sin autenticación
de ninguna clase, aceptaba destinatario, asunto y HTML libres, y los mandaba
desde `soporte@evaluafacil.mx` — un dominio autenticado con DKIM/DMARC. O sea:
phishing que pasa todas las comprobaciones de autenticidad, con la reputación
del dominio de por medio y, detrás, el bloqueo de todo el correo legítimo.

El CORS no protegía nada: es cosa del navegador y un script lo ignora.

Ahora exige sesión **y** que el destinatario sea el correo del propio titular,
que es la invariante real de sus dos únicos usos. El cron de recordatorios no
pasa por ahí (usa la librería del servidor), así que no le afecta.

El resto quedó en verde: `admin/last-access` comprueba el rol contra Firestore
—no basta con traer un token—, los endpoints de cuenta y de estudiante
verifican propiedad además de identidad, y el webhook de Mercado Pago
revalida contra la API de MP. R12 recoge lo único que quedó pendiente.

**A05 · Cloud Functions** (5-ago-2026, unas horas). Las 14 funciones revisadas
una por una: idempotencia, resolución de destinatario, documentos incompletos y
las dos programadas.

Un defecto real corregido en la que califica: **`onEvaluacionFinalizada` no
sabía que existen los instrumentos "Sin calificación"**. A un diagnóstico le
escribía nota igual, y si además el docente eligió que los reactivos no se
ponderen, la ponderación total da cero y la nota calculada es **0** — un cero de
aspecto reprobatorio donde se había dicho que no habría nota. Peor: escribir
`calificacion` dispara `onSubmissionActualizada`, así que al estudiante le
llegaba un push *"Ya tienes una calificación nueva"*. Ahora el intento se sigue
registrando (idempotencia y estadísticas del diagnóstico intactas) pero el campo
`calificacion` no se escribe y el estado queda en `entregado`.

Lo demás quedó en verde: las 14 tienen salida temprana ante documento borrado o
incompleto, las que pueden dispararse en ráfaga (`onSubmissionEntregada`,
`onEvaluacionFinalizada`) reclaman su turno dentro de una transacción que relee
el documento en vivo, y la programada que publica actividades se autorrepara
sola porque vuelve a barrer todo en cada corrida.

Dos hallazgos que **no** se corrigieron por decisión de alcance: R10 (los
recordatorios sí se pierden si una corrida falla) y R11 (no hay forma
automatizada de probar estas funciones).

**A04 · Autenticación e identidad** (5-ago-2026, unas horas). Una vulnerabilidad
crítica: **cualquiera con sesión podía quedarse con la inscripción de otro
estudiante**. La regla pedía que nadie la hubiera reclamado antes y que
estamparas tu propio uid, pero no que fueras esa persona — y con `students` de
lectura pública, listar las inscripciones sin activar era trivial. Se cierra
comprobando el correo de Auth, que para un estudiante es determinista.

De paso apareció un **error de funcionamiento**: leer un campo ausente revienta
la evaluación de una regla en vez de dar falso, así que las inscripciones dadas
de alta por Excel —que no traen `uid`— no podían activarse nunca. Corregido con
`get('uid', null)`.

**R1 cerrado** (escuelas ajenas) y retirado código muerto de la superficie de
credenciales: un generador de contraseñas con `Math.random()` y una máscara de
correo, ninguno con uso. Suite: 66 → 72 casos.

**Corrección al propio Plan.** La ficha de A04 decía que los usuarios de
estudiante eran "de 4 caracteres". No lo son desde hace tiempo: son
`apellido.nombre` (ver `generateUsername`). La entropía del usuario ya no es el
riesgo; el riesgo era la regla de reclamo, que ya se cerró.

**A03 · Reglas de Firestore y modelo de datos** (5-ago-2026, unas horas). Una
vulnerabilidad crítica cerrada: `users` congelaba `suscripcionHasta` en las
actualizaciones, pero **no en la creación**, y el perfil lo escribe su propio
dueño. Un docente recién registrado podía crearse el perfil con el candado
abierto a diez años y trabajar sin vencimiento posible; que la Cloud Function
del espejo lo corrigiera al crear la prueba no es una defensa, es una carrera.
Reproducida contra el emulador antes de corregirla. Suite: 62 → 66 casos.

Las 30 colecciones quedaron recorridas una por una. Lo que **no** se pudo
cerrar, con su causa y su plan, en R1 y R7-R9: la lectura pública de `students`
y `users`, las lecturas entre docentes, y `schools`, que colisiona con el flujo
de registro y se pasa a A04.

*Nota de honestidad.* A01 y A02 se ejecutaron antes de que existiera §3. Su
expediente cumple con once de las doce piezas —incluida la salida del emulador
que probó cada agujero antes de cerrarlo, en los cuerpos de sus PR— y le falta
solo la 11, el tiempo invertido, que entonces no se registraba. Como el tiempo
no demuestra ejecución sino que sirve para planear, las dos siguen válidas como
Completadas. De A03 en adelante se registran las doce.

**A01 · Suscripciones** (5-ago-2026). Dos vías críticas cerradas: el docente
podía reescribir las fechas y el plan de su propia suscripción en el mismo
cambio que declaraba un pago, y podía crearse una suscripción a modo —incluida
una prueba nueva cada vez que la anterior venciera—. La prueba inicial pasó a
crearla el servidor (`onDocenteCreado`), y la barrida horaria repone la que
falte. Suite: 37 → 48 casos.

**A02 · Pagos** (5-ago-2026). Una vía de fraude crítica: un pago fabricado con
`planId: 'anual'` y 6 meses convertía una transferencia de un mes en seis años.
Además, acreditar un pago a la suscripción de otro y crear pagos con campos que
no le tocan al docente. Aprobar y rechazar pasaron a ser transaccionales, lo que
cerró cuatro formas de dejar pago y suscripción en desacuerdo. Se corrigió que
el reenvío de un pago rechazado perdiera los meses pagados, y el comprobante
ahora se puede adjuntar desde el primer intento. Suite: 48 → 62 casos.

## Nota de estrategia — lo que enseñó la revisión de la Fase 2

Revisión crítica del 6-ago-2026, hecha sobre el código y midiendo, no sobre esta
bitácora. El hallazgo que manda sobre las fases que vienen:

**La suite protege reglas de Firestore y nada más.** 489 líneas, 80 casos, todos
de reglas. Pero los defectos de la Fase 2 no vivían ahí:

| Auditoría | Dónde estaba el defecto | Casos permanentes que dejó |
|---|---|---|
| A07 | Cloud Function + reglas | 20 líneas (lado reglas) |
| A10 | **endpoint** + reglas | 25 líneas (lado reglas) |
| A11 | **interfaz** | **0** |
| A17 | **endpoint** | **0** |

Y ningún caso comprueba lo que la Fase 2 falló dos veces: **que la lista
`POR_DOCENTE` de `api/account/delete.js` esté completa**. Se corrigió añadiendo
cuatro nombres a un arreglo literal; nada impide la quinta omisión.

Esto ya está en la tabla de riesgos —**R5** (sin pruebas de integración, asignado
a A24) y **R11** (Cloud Functions sin forma automatizada de probarse, asignada a
la v1.1)—, pero **con el orden al revés**: la Fase 3 es entera Cloud Functions y
endpoints (la calificación automática es `onEvaluacionFinalizada`), o sea la capa
sin cobertura. Pendiente de decisión del PO si se adelanta.

Dos mediciones más de esa revisión, que ninguna auditoría había hecho:

- **Volumen** (§1.4 lo exige y A17 lo saltó): el borrado de un docente de
  **3 225 documentos** completa en **47,1 s**, con 0 huérfanos y 0 subdocumentos
  sueltos. Contra 2,8 s de los 34 documentos de A17. Escala aproximadamente
  lineal. `vercel.json` **no fija `maxDuration`**, así que el techo de una
  operación destructiva y no reanudable es el valor por defecto del proveedor.
- **El punto ciego de `archivosPendientes`**: el orden del endpoint es recolectar
  archivos en memoria → borrar documentos → borrar archivos. Si el proceso muere
  entre el segundo paso y el tercero, la constancia **no se escribe**, porque
  quien la escribe es el paso que no llegó a correr.

---

# 9. Riesgos residuales abiertos

Lo que una auditoría encontró y no pudo cerrar, con su causa y la propuesta
concreta. Cada uno se cierra en la auditoría que le corresponde. **Un riesgo
solo sale de esta tabla cuando está cerrado, no cuando se explica.**

**R7, R8 y R9 son un solo proyecto de migración** y su cierre depende de que el
cliente Web y el de Android dejen de consultar directo — ver **RO-1** en §1.9.
Ninguna auditoría intenta cerrarlos por su cuenta.

| # | Riesgo | Causa | Propuesta | Cierra en |
|---|---|---|---|---|
| ~~R1~~ | ~~Cualquier docente puede editar cualquier escuela~~ | — | **CERRADO en A04**: se congelaron `nombre` y `shortName` para quien no pertenece a esa escuela; completar los datos que faltan, que es lo que el alta necesita, sigue permitido | ✔ |
| ~~R2~~ | ~~El **monto** de un pago lo elige el cliente~~ · **MITIGADO Y ACEPTADO PARA LA v1.0 — decisión del PO, 5-ago-2026.** La tarifa **no se mueve a Firestore**: se queda definida en el código. La verificación manual del administrador contra el estado de cuenta, antes de aprobar cada pago, **se considera control suficiente** para la v1.0 — es un control humano real sobre cada peso que entra. Sale de la lista de pendientes. **Reabrir únicamente si la aprobación de pagos pasa a ser automática**, porque ahí desaparece el humano que hoy lo sostiene | ✔ |
| ~~R3~~ | ~~El borrado de cuenta **no borraba los archivos de Cloudinary**~~ | — | **CERRADO en A17 (6-ago-2026).** Eran dos cosas, no una: faltaban las llaves en Vercel (puestas ese día, *Sensitive*, sin prefijo `VITE_`) **y**, una vez puestas, el borrado dejaba el archivo descargable treinta días desde el CDN — corregido con `invalidate`. Verificado: **12 de 12 borrados, 0 URLs entregando, 0 originales en el almacén**, y **52 huérfanos previos barridos** y comprobados uno por uno | ✔ |
| R4 | La **retención de 90 días está declarada pero no se ejecuta** | Solo existe el aviso por correo; el borrado se hace a mano | Implementar el borrado automático, o corregir la declaración para que diga lo que de verdad pasa | A22 — **decisión del PO** |
| R5 | **No hay pruebas de interfaz ni de integración** | Nunca se construyeron | Cada auditoría deja casos de reglas; evaluar una suite de interfaz cuando el resto esté cubierto | Al cerrar A24 |
| R6 | **Producción puede quedarse atrasada sin avisar** | Vercel limita despliegues en el plan gratuito; ya dejó producción cuatro commits atrás | Verificar `version.json` después de cada merge (ya es el paso 6 del protocolo); evaluar plan de pago si se repite | A24 |
| R7 | **`students` se puede listar sin sesión**: nombres completos, escuela y grupo de todos los estudiantes de la plataforma — datos personales de menores. Además vuelve enumerable la recuperación de contraseña: un atacante puede buscar a quién le habilitaron el rescate y tomarle la cuenta | La activación por QR necesita leer inscripciones antes de que exista la cuenta, y las tres consultas sin sesión (login, recuperación, activación) van directas a Firestore | Mover esas tres consultas a un endpoint que resuelva con Admin SDK y devuelva solo lo indispensable; después cerrar la lectura pública. **No se puede desplegar de golpe**: la app publicada en Google Play consulta directo, y cerrar las reglas antes de que se actualice deja a los estudiantes sin poder entrar | A07 — **decisión del PO** (requiere escalonar la publicación) |
| R8 | **`users` se puede listar sin sesión**: correo, teléfono y código postal de todos los docentes | La pantalla de recuperar contraseña consulta `users` por correo **antes** de iniciar sesión, así que es un `list` sin sesión | **CIERRE CONDICIONADO — aprobado por el PO el 5-ago-2026.** Se mantiene abierto a propósito y **no debe cerrarse antes** de que exista una versión del cliente —Web **y** Android— que ya no consulte `users` directamente para la recuperación de contraseña. Cerrar la regla antes rompe a todo cliente ya publicado: la app de Google Play trae esa pantalla y consulta directo. Orden obligatorio: (1) endpoint que resuelva la búsqueda por correo con Admin SDK; (2) cliente Web y Android publicados usándolo; (3) adopción confirmada; (4) recién entonces separar `get` de `list` en las reglas — el `get` lo necesita el alumno para ver a su docente, el `list` solo el panel | Cuando (1)-(3) estén hechos |
| R10 | **Un recordatorio de entrega que cae en una corrida fallida se pierde para siempre** | `revisarProgramados` solo avisa dentro de una ventana de 35 min alrededor de la anticipación elegida; pasada esa ventana, no vuelve a intentarlo. La otra mitad de la misma función (publicar actividades) sí se autorrepara porque vuelve a barrer todo | **ACEPTADO PARA LA v1.0 — decisión del PO, 5-ago-2026.** El comportamiento actual **no se modifica**. Cualquier cambio en esta lógica es una **decisión funcional del Product Owner** —altera qué avisos recibe la gente, incluidos los de actividades creadas ya dentro de la ventana, que hoy no avisan— y **se evalúa después de liberar la v1.0**, no antes. La corrección técnica, cuando se autorice, es quitar el límite inferior de la ventana: `recordatoriosEnviados` ya impide duplicados | Después de la v1.0 — **decisión funcional del PO** |
| R15 | **El panel lee ocho colecciones completas en cada carga** | `useAdminStats` trae `users`, `students`, `subscriptions`, `payments`, `plans`, `schools`, `subjects` y `bajas` enteras. Hoy funciona; crece linealmente con la plataforma y `students` es la que más crece. No es un problema de seguridad sino de costo y de tiempo de carga | Contadores agregados que una Cloud Function mantenga, y traer el detalle solo de la tabla que se está mirando. Descubierto en A11 | A24 |
| ~~R14~~ | ~~**El borrado de cuenta de un docente nunca se ha ejecutado de punta a punta**~~ | — | **CERRADO en A17 (6-ago-2026): los cinco puntos, en verde.** 12 de 12 archivos borrados · 0 documentos huérfanos por barrido ciego de las colecciones raíz · 0 referencias rotas · 0 recursos accesibles por URL, derivados del PDF incluidos · RO-2 cumplido. Las 15 colecciones que toca el endpoint ya no están respaldadas por lectura de código sino por una ejecución real contra producción | ✔ |
| R13 | **La baja de un estudiante deja rastros que ya nadie puede borrar** · **Se corrige en el módulo dueño de cada dato, no en la baja.** Decisión del PO (5-ago-2026): A07 **no** debe parchearlo desde su lado. Un remiendo en la baja del estudiante trataría el síntoma —limpiar de paso datos de avisos y de calendario— y dejaría intacta la causa: colecciones cuya regla de borrado depende de un documento que ya no existe. Se arregla donde viven esos datos, con su modelo de propiedad revisado | Al eliminar la inscripción, `avisoGuardados` y `avisoOcultos` quedan huérfanos y **sin dueño posible**: su regla exige `ownsStudentDoc`, que falla en cuanto el documento desaparece. `avisoLecturas` es inmutable a propósito (registro de auditoría). Y los mapas `presentes` de cada columna de asistencia conservan la llave del alumno, igual que pasaba con `activities.extensiones` antes de corregirse. Además, la baja de cuenta del propio estudiante no borra sus `studentEvents` | Limpiar en la baja lo que todavía tiene dueño (mapas de asistencia y `studentEvents`), y para los avisos huérfanos decidir entre darle al docente permiso de borrarlos o una limpieza programada. Descubierto en A07; toca colecciones de avisos y calendario | A14 (avisos) y A18 (calendario) |
| R12 | **El cron diario de recordatorios solo se protege si `CRON_SECRET` está configurado** | `api/cron/reminders.js` comprueba la cabecera **solo si** la variable existe; si no está puesta en Vercel, cualquiera puede dispararlo y provocar un envío masivo de correo | Verificar en Vercel que `CRON_SECRET` esté configurada (Vercel la manda sola en sus crons cuando existe). No se puede comprobar desde el código, y ponerlo a fallar en cerrado rompería el cron si resulta que falta: es una **acción de operación** | A24 |
| R11 | **Las Cloud Functions no tienen forma automatizada de probarse** | La suite del proyecto solo cubre reglas de Firestore; las 14 funciones se verifican leyendo el código | **ABIERTO — mejora prioritaria para la v1.1, decisión del PO, 5-ago-2026.** No se construye todavía: levantar el emulador de Functions es trabajo de infraestructura que no cabe en la v1.0. Cuando se haga, empezar por las tres críticas —la que califica (`onEvaluacionFinalizada`), la que espeja la vigencia (`onSuscripcionEscrita`) y la que repone la prueba (`onDocenteCreado`) | **v1.1 — prioritaria** |
| R9 | **Un docente puede leer entregas, asistencias y actividades de toda la plataforma**, no solo las suyas | Firestore solo autoriza un `list` si la regla se prueba con los filtros de la consulta, y las consultas actuales no filtran por docente | Agregar el filtro de dueño a cada consulta y sus índices, y luego ajustar la regla. Es un cambio amplio en pantallas ya auditadas por otras fases | A12 |
| R16 | **Cualquiera puede subir archivos a la cuenta de Cloudinary de Alan, sin sesión y a la carpeta que quiera** | El preset sin firmar es, por definición, público: su nombre viaja en el bundle del navegador. Comprobado desde fuera de la aplicación el 6-ago-2026 — se subió sin ninguna sesión, y eligiendo carpeta libremente, incluida `evalua-facil/comprobantes`, donde viven los comprobantes de pago. Lo que **sí** está acotado: tope de 10 MB, extensiones peligrosas rechazadas (`.exe`), y no se puede sobrescribir el archivo de nadie | Cloudinary no permite cerrar esto sin pasar a subida firmada, que es un cambio de arquitectura (un endpoint que firme cada subida). Alternativas más baratas: acotar el preset a las carpetas reales y poner alerta de cuota. **Decisión de Alan** (§1.8), que es quien paga la cuota y controla el preset | **Alan** (RO-3: registrado, no detiene ninguna auditoría). Se revisa en A24 |
| R18 | **`borrados` puede contar de más: un archivo que nunca se encontró se apunta como borrado** | `destruir()` trata `not found` como éxito, y eso es **correcto** para reintentos —la escoba tiene que poder cerrar un apunte ya barrido—. El costo es que si algún día `publicIdDesdeRuta` calcula mal un `public_id` (una forma de URL no prevista), Cloudinary responderá `not found`, el endpoint lo contará como borrado y **no** quedará anotado en `archivosPendientes` — que es justo el caso que esa colección existe para atrapar. Hoy no ocurre: A17 comprobó las 12 URLs una por una, por fuera del endpoint, y las 12 dejaron de existir de verdad | Devolver `noEncontrados` aparte de `borrados` en la respuesta de `borrarAssets` y anotarlo en la constancia. Es informativo y no cambia el comportamiento: **son unas diez líneas**. Se dejó fuera de A17 a propósito, por no tocar al cierre un código recién verificado en verde en producción; cabe en un PR suelto o en A24 | A24, o antes si el PO lo prefiere |
| R17 | **El editor de texto enriquecido permite un pixel de rastreo** | El atributo `style` está en la lista blanca del saneador, y `background:url(https://…)` sobrevive. No ejecuta código —18 payloads de XSS, 0 sobrevivieron— pero hace que el navegador de cada alumno llame a un servidor externo al abrir la actividad, revelando su IP y el momento en que la leyó | Quitar `style` de `ALLOWED_ATTR`, o filtrar las `url()` dentro del estilo. **Se dejó sin corregir a propósito**: quitar `style` cambia cómo se ve lo que los docentes ya escribieron (color, tamaño, resaltados), y eso es visible para el usuario — regla 1.7, se pregunta antes | **Decisión del PO** |

---

# 10. Vigencia y re-auditoría

Esto no se ejecuta una vez y se archiva. Una auditoría **caduca** cuando pasa
cualquiera de estas cosas, y su módulo vuelve a Pendiente:

- **Cambia el módulo.** Un PR que toca un módulo Crítico obliga a revisar sus
  casos de prueba en el mismo PR. Si el cambio altera quién puede hacer qué, la
  auditoría se repite.
- **Cambia el modelo comercial.** Precios, planes, métodos de pago o reglas de
  vigencia devuelven A01 y A02 a la fila.
- **Se reactiva algo pausado.** Mercado Pago o PayPal devuelven A02 y A06.
- **Cambia la plataforma.** Una versión mayor de Firebase, React o Capacitor
  devuelve A03, A05 y A20.
- **Pasa un año** desde la última ejecución de una auditoría Crítica.

**Una auditoría que caduca no reabre su fase entera.** Vuelve a Pendiente ella
sola y se ejecuta suelta, con su propio cierre. La fase solo se reabre completa
cuando caducan todas sus auditorías a la vez — por ejemplo, un cambio de versión
mayor de Firebase que devuelva la Fase 1.

**Regla permanente.** Ningún PR que toque un módulo Crítico se mergea sin al
menos un caso de prueba nuevo o actualizado, o sin una línea que explique por
qué no hacía falta.

---

# 11. Anexos

## A. Colecciones de Firestore

| Colección | Contenido | Módulo |
|---|---|---|
| `schools` | Planteles registrados | M01 |
| `users` | Docentes y administradores (+ `suscripcionHasta`) | M01, M02 |
| `students` | Inscripciones — **lectura pública** por el QR de activación | M06 |
| `subjects` | Asignaturas — **lectura pública** por el QR | M05 |
| `activities` | Actividades y evaluaciones | M07, M08 |
| `activities/{id}/preguntas` | Reactivos de una evaluación | M08 |
| `submissions` | Entregas e intentos | M07, M08 |
| `submissions/{id}/respuestas` | Respuestas de un intento | M08 |
| `attendance` | Pase de lista por fecha | M11 |
| `attendanceSummaries` | Resumen acumulado por estudiante | M11 |
| `bancoReactivos` | Reactivos reutilizables | M08 |
| `bancoRubricas` | Rúbricas y listas de cotejo reutilizables | M09 |
| `resources` / `materials` | Recursos y materiales de apoyo | M07 |
| `avisos` | Comunicados | M12 |
| `avisoLecturas` / `avisoGuardados` / `avisoOcultos` / `avisoPlantillas` | Estado por estudiante y plantillas | M12 |
| `plans` | Catálogo de planes (precio real del lado del servidor) | M03 |
| `subscriptions` | Estado y vigencia de cada docente | M02 |
| `payments` | Pagos declarados y resueltos | M03 |
| `config` | Configuración global (datos bancarios) | M03 |
| `events` / `academicEvents` / `studentEvents` | Calendario | M13 |
| `horario` / `horarioBloques` | Horario semanal | M13 |
| `asuetos` / `vacaciones` | Días no laborables | M11, M13 |
| `notificationSettings` | Tokens de push y preferencias | M14 |
| `notificationLog` | Bitácora de envíos | M14 |

**Índices compuestos desplegados:** `activities`, `payments`, `students`,
`submissions`, `subscriptions`.

## B. Rutas

| Ruta | Acceso | Módulo |
|---|---|---|
| `/`, `/docente` | Público / redirige según sesión | M31, M21 |
| `/register`, `/reset-password`, `/verify-email` | Público | M01 |
| `/alumno`, `/activate/:accessCode` | Público | M01, M06 |
| `/privacidad`, `/privacy` | Público | M27 |
| `/pago-resultado` | Público (retorno de pasarela) | M03 |
| `/onboarding`, `/protect-account` | Docente autenticado | M01, M05 |
| `/dashboard`, `/subject/:id`, `/activity/:id`, `/profile`, `/calendario`, `/notificaciones`, `/manual` | Docente (`ProtectedTeacher`) | M05–M19 |
| `/alumno/dashboard`, `/materia/:id`, `/actividad/:id`, `/evaluacion/:id`, `/evaluacion/:id/revision`, `/notificaciones`, `/agenda`, `/perfil` | Estudiante (`ProtectedStudent`) | M07, M08, M13, M20 |
| `/Admin` | Administrador (`ProtectedAdmin`) | M04 |
| `*` | Redirige a `/` | M21 |

## C. Servicios externos

| Servicio | Para qué | Módulos | Dueño |
|---|---|---|---|
| Firebase (Auth, Firestore, Functions, FCM) | Cimiento completo | M24, M25, M14 | Kike |
| Cloudinary | Todos los archivos subidos | M17 | Alan |
| Vercel | Web y endpoints serverless (plan Hobby: tope de 12) | M26 | Kike |
| Brevo | Correo transaccional desde el servidor | M15 | Kike |
| EmailJS | Correo desde el cliente (camino heredado) | M15 | Kike |
| Google Play | Distribución de la app Android | M23 | Kike |
| Mercado Pago / PayPal | Pasarelas **pausadas** en v1.0.1 | M03 | Kike |
| ElevenLabs / Gemini | Herramientas auxiliares, fuera del producto | M33 | Kike |

## D. Observaciones del inventario

Hechos anotados al levantar el censo. No son hallazgos; son cosas que conviene
tener presentes, cada una con la auditoría que la resuelve:

1. **`storage.rules` existe pero Firebase Storage no se usa** — ningún archivo
   lo importa; todo vive en Cloudinary → **A03**.
2. **Dos caminos vivos para el correo**, Brevo y EmailJS → **A21**.
3. **`api/_pausado/` guarda cuatro endpoints** completos y no desplegados →
   **A06**.
4. **`Avatar/`, `voice-pipeline.js` y `output/` no son parte del producto** pero
   viven en el repositorio, y `Avatar/` trae su propio `.env` → **A24**.
5. **`docs/` acumula 18 documentos**, varios de planes ya cumplidos → **A24**.
