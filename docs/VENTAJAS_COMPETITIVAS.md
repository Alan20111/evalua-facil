# Ventajas competitivas — inventario verificado

> Lista de lo que la plataforma **realmente hace**, verificado contra el código.
> Sin recomendaciones de cómo venderlo — eso lo decide el autor.

---

## Las 10 elegidas para material publicitario

Definidas el 2026-07-29.

1. Tus alumnos entran sin cuenta de correo electrónico
2. Alta masiva de estudiantes por grupo, desde una plantilla de Excel
3. Pasa lista desde tu móvil
4. Programa tus clases y crea tu horario — de ahí se definen los días de lista
5. Cuestionarios y exámenes con gráficas por reactivo
6. Banco de reactivos
7. Rúbricas y listas de cotejo
8. Cierra el parcial completo en una acción, y puedes revertirlo
9. Copia tu asignatura completa para el siguiente ciclo
10. Excel y PDF listos para entregar

**Quedaron fuera de las 10, pero siguen sirviendo para la página de precios y para cuando alguien ya está decidiendo:** que Google sea opción y no requisito, app y versión web con la misma cuenta, orden correcto de la lista de estudiantes, ranking de calificaciones, recuperación de contraseña del estudiante, e importar actividades sueltas de otra asignatura.

El resto de este documento es el inventario completo de funciones verificadas, del que salieron estas 10.

---

## Acceso

**El alumno no necesita correo electrónico.**
- El usuario se genera solo del apellido paterno y el primer nombre: `mendez.enrique`. Sin acentos ni ñ.
- Duplicados llevan sufijo: `garcia.juan`, `garcia.juan01`.
- El alumno elige su propia contraseña la primera vez. El docente nunca la ve ni la reparte.
- Entra por QR, link o código de 6 caracteres.

**Un alumno, una cuenta para todas tus asignaturas.**
- Si aparece en otra de tus materias, la plataforma pregunta si es la misma persona y reutiliza su cuenta.
- Al copiar una asignatura con estudiantes, conservan usuario y contraseña.

**Recuperación de contraseña sin correos.**
- El docente habilita la recuperación desde "Editar estudiante"; el alumno elige la nueva.
- El docente no recibe ninguna clave temporal.

**Cuenta del docente.**
- Correo y contraseña propios, o Google. Google es opción, no requisito.

## Asistencia

**Los días se generan solos desde el horario.**
- Programas el horario una vez y las columnas de asistencia aparecen, cada una en su parcial.
- Dos horas seguidas ese día generan dos columnas independientes.
- Días de asueto y vacaciones no generan lista.
- Si alargas las fechas del curso, el horario se extiende solo al tramo nuevo.
- Sin fechas de curso, los días se agregan a mano.

**Tres estados:** presente, falta, justificada.
- Todos empiezan presentes; se marca solo la excepción.
- La justificada cuenta como asistencia y guarda motivo, editable después.

**Alumnos inscritos a media marcha** no cargan con los días anteriores a su alta.

**Borrar un día** no lo regenera solo; queda como "Restaurar día".

## Evaluación

**Cuatro tipos de actividad:** entregable, observación, cuestionario, examen.
- Observación se califica sin entrega del alumno.
- Cuestionario y examen son la misma herramienta con distintos valores de arranque.

**Gráficas por reactivo.**
- Gráfica de pastel por pregunta: muestra qué opción eligió el grupo.
- Estadísticas de grupo: promedio, máxima, mínima, % aprobados y reprobados.

**Banco de reactivos.**
- Colección propia del docente, organizada por materia y tema. No atada a parcial ni ciclo.
- Cuatro tipos de pregunta: opción múltiple, verdadero/falso, respuesta corta, subir documento.
- Con imagen y retroalimentación por pregunta.
- Se seleccionan varias y se agregan al examen de un jalón.

**Rúbricas y listas de cotejo.**
- Rúbrica: 2 a 6 criterios, 3 a 5 niveles. El nivel más alto vale 10.
- Lista de cotejo: una sola columna, cada criterio se cumple o no.
- Banco propio reutilizable en cualquier actividad.
- Al asignarla, la actividad guarda su propia copia: editar la del banco no altera calificaciones ya puestas.
- Se califica marcando niveles; el 10 se calcula solo.
- Funcionan en entregables y observaciones, no en exámenes.
- Crear y editar es de la web; desde la app se puede elegir una del banco y calificar.

**Ponderación por parcial.**
- Se activa parcial por parcial, no para toda la asignatura.
- Sin ponderación, el promedio es simple sobre lo ya calificado.
- Los pesos deben sumar 10 para exportar o cerrar el parcial.
- Un interruptor decide si los alumnos ven cuánto vale cada actividad.

**Cierre de parcial reversible.**
- Rellena a quien no entregó con la calificación que elijas.
- Revertir borra solo lo que puso el cierre; lo capturado a mano queda intacto.
- Alumnos dados de alta después del cierre reciben el mismo relleno.

**Promedio final:** media simple de los promedios de parcial.

## Planeación

**Copiar asignatura completa.**
- Copia actividades, instrucciones, adjuntos, tipos de archivo y preguntas de exámenes.
- No copia entregas ni calificaciones.
- Opcionalmente copia la lista de estudiantes, conservando sus credenciales.

**Importar actividades de otra asignatura tuya.**
- Llegan como borrador, para ajustar fechas antes de publicar.

**Horario y calendario.**
- Bloques de clase por asignatura, colocados en una zona semanal.
- Cuatro vistas: día, 3 días, semana, mes.
- Eventos personales, además de fechas límite y publicaciones que aparecen solas.
- Asuetos (un día) y vacaciones (periodo), con control independiente sobre qué se suspende: clases, eventos, actividades o asistencias.
- Alarmas por bloque, con cinco sonidos.

**Publicación programada de actividades:** eliges día y hora y aparecen solas.

**Prórrogas:** fecha nueva para todo el grupo o para estudiantes específicos, con motivo.

## Salidas

- **Calificaciones:** Excel y PDF, completas o por parcial.
- **Asistencia:** Excel, completa o por parcial.
- **Ranking:** Excel y PDF, con lugar y promedio. En pantalla resalta el 20% superior e inferior.
- **Acceso de estudiantes:** PDF del QR en grande y PDF de lista de acceso con usuarios.
- **Entregas:** descarga en ZIP de los archivos subidos.

## Orden de la lista de estudiantes

- Respeta el número de lista con que se dieron de alta.
- Se puede ordenar alfabéticamente por apellido paterno.

---

## Sobre las redundancias en la lista original

Dos pares se traslapan:

1. **"Acceso con cuenta propia" y "recuperación de contraseña"** — ambas son sobre que nadie se quede fuera por no tener correo.
2. **"Cuestionarios y exámenes" y "banco de reactivos"** — el banco es parte del sistema de exámenes.

Y dos puntos separados que técnicamente son uno solo: **"pasa lista desde el móvil"** y **"programa tus clases"** — el horario es lo que genera los días de asistencia.

## Nota sobre la IA

No está construida. Va como complemento aparte en 2027, no dentro del plan de $116.
