import { useState } from 'react'
import { BookOpen, GraduationCap, Users, ClipboardList, ClipboardCheck, Database, Percent, UserCheck, CalendarDays, FileDown, UserCog, Check, AlertTriangle, Compass } from 'lucide-react'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'

// Manual del docente. Todo el contenido está verificado contra el código real
// de la plataforma — si algo no existe o no es configurable, aquí no aparece.
//
// Formato de `content`: arreglo de bloques. Un bloque es
//   { subtitle, items: [...] }
// y cada item es un string (viñeta normal) o un string que empieza con '⚠ '
// (se pinta como advertencia). Ver feedback_writing_style_manuals: viñetas,
// no prosa; el "error común" va dentro de la lista, no en un bloque aparte.
const SECTIONS = [
  {
    id: 'que-puedes-hacer',
    title: 'Lo que puedes hacer aquí',
    // Compass y no Sparkles: las chispitas ya se leen como "IA" en todos lados,
    // y aquí no hay IA. La brújula dice "ubícate", que es justo lo que hace
    // esta sección.
    icon: Compass,
    content: [
      {
        subtitle: 'Lo que más te va a ahorrar tiempo',
        items: [
          'Tus alumnos entran sin cuenta de correo electrónico — tú das de alta la lista y cada quien elige su contraseña. Lo ves en Estudiantes.',
          'Alta masiva de estudiantes por grupo, desde una plantilla de Excel — la descargas, la llenas y la subes. Lo ves en Estudiantes.',
          'Pasa lista desde tu móvil — todos empiezan presentes, así que solo marcas a quien faltó. Lo ves en Asistencia.',
          'Programa tus clases y crea tu horario — de ahí se definen los días de lista. Lo ves en Agenda y calendario.',
          'Cuestionarios y exámenes con gráficas por reactivo — te dicen cuál pregunta falló el grupo, no solo quién reprobó. Lo ves en Actividades.',
          'Banco de reactivos — escribes una pregunta una vez y la reutilizas cuando quieras. Lo ves en Banco de reactivos.',
          'Rúbricas y listas de cotejo — marcas el nivel de cada criterio y la calificación se calcula sola. Lo ves en Rúbricas y listas de cotejo.',
          'Cierra el parcial completo en una acción, y puedes revertirlo. Lo ves en Calificaciones.',
          'Copia tu asignatura completa para el siguiente ciclo — tu planeación entera, lista otra vez. Lo ves en Asignaturas y grupos.',
          'Excel y PDF listos para entregar. Lo ves en Reportes y exportación.',
        ],
      },
      {
        subtitle: 'Cómo usar este manual',
        items: [
          'Cada sección del índice explica una parte de la plataforma por separado. No hace falta leerlas en orden.',
          'Si apenas estás empezando, sigue con Primeros pasos.',
        ],
      },
    ],
  },
  {
    id: 'primeros-pasos',
    title: 'Primeros pasos',
    icon: BookOpen,
    content: [
      {
        subtitle: 'Crear tu cuenta',
        items: [
          'Te registras con tu correo y una contraseña, o con tu cuenta de Google. No se te pide nada de tu escuela todavía.',
          'En "Un último paso" pones tu nombre real y eliges cómo quieres que te vean tus estudiantes (por ejemplo "Profa. Laura García"). Ese es el nombre que ven ellos; tu nombre real queda solo para ti.',
          'Desde tu Perfil eliges tu escuela del catálogo, y si no aparece la das de alta tú. Lo puedes hacer cuando quieras — no tienes que esperar a eso para empezar a trabajar.',
        ],
      },
      {
        subtitle: 'Tu periodo de prueba',
        items: [
          'Tienes 30 días con acceso a todo: sin límite de asignaturas, de grupos, de estudiantes ni de actividades.',
          'El contador de días siempre está visible en el menú lateral. Al tocarlo llegas a tu Perfil, que es donde activas la suscripción.',
          'Al terminar la prueba puedes seguir consultando y descargando todo lo tuyo. Lo que se pausa es capturar información nueva, hasta que actives la suscripción.',
        ],
      },
      {
        subtitle: 'Dónde trabajas',
        items: [
          'La versión web es la casa completa: ahí está todo, incluyendo lo que necesita teclado y pantalla grande (subir listas por Excel, crear rúbricas, exportar).',
          'La app de Android está pensada para el día a día en el aula: pasar lista, revisar entregas, capturar calificaciones.',
          '⚠ Algunas cosas viven solo en la web a propósito: la plantilla de Excel para subir a todo el grupo, el PDF de códigos de acceso, y crear o editar rúbricas. Si las buscas en el celular y no las encuentras, es por eso.',
        ],
      },
    ],
  },

  {
    id: 'asignaturas-grupos',
    title: 'Asignaturas y grupos',
    icon: GraduationCap,
    content: [
      {
        subtitle: 'Crear una asignatura',
        items: [
          'Nombre y grupo son los dos datos que sí necesitas (por ejemplo "Matemáticas" y "1A"). En toda la plataforma la verás como "Matemáticas — 1A".',
          'Eliges cuántos parciales tiene, de 1 a 6. Vienen 3 por defecto.',
          'Le pones color e ícono para reconocerla de un vistazo en tu lista y en el calendario.',
          'Las fechas de inicio y fin son opcionales, pero cambian mucho lo que la plataforma puede hacer por ti: con ellas, los días para pasar lista se generan solos y cada parcial queda ubicado en su periodo.',
          'Al crearla se genera su código de acceso de 6 caracteres — es con lo que tus estudiantes entran.',
        ],
      },
      {
        subtitle: 'Los parciales y sus fechas',
        items: [
          'El inicio del primer parcial es siempre la fecha de inicio del curso, y el fin del último es la fecha de fin. Esos dos no se tocan.',
          'Tú solo defines dónde termina cada parcial intermedio. El siguiente arranca solo, al día siguiente.',
          'El parcial 1 nace visible para tus estudiantes; del 2 en adelante nacen ocultos. Los vas mostrando conforme avanzas.',
          '⚠ Si quieres bajarle al número de parciales, primero mueve o elimina las actividades que estén en los parciales de más. Así no se te pierde nada por accidente.',
        ],
      },
      {
        subtitle: 'Archivar, copiar y eliminar',
        items: [
          'Archivar guarda la asignatura completa: actividades, estudiantes, entregas y calificaciones siguen ahí. Sale de tu lista principal y tus estudiantes la ven en sus "archivadas". Puedes descargar un respaldo ZIP de las entregas al archivar.',
          'Al desarchivar puedes reeditar nombre, grupo, fechas y parciales, y decides qué hacer con los estudiantes (conservarlos o empezar con lista limpia) y con las actividades (dejarlas como están, ocultarlas todas o mostrarlas todas).',
          'Copiar crea una asignatura nueva con todas tus actividades: nombres, instrucciones, adjuntos, tipos de archivo y preguntas de los exámenes. No se copian las entregas ni las calificaciones — es tu planeación lista para otro grupo o el siguiente ciclo.',
          'Si al copiar marcas "copiar lista de estudiantes", conservan su mismo usuario y contraseña. Quien ya activó su cuenta ve la asignatura nueva de inmediato, sin volver a activar nada.',
          '⚠ Eliminar sí borra todo de forma permanente: entregas, actividades, estudiantes, asistencias y bloques de horario. Por eso te pide escribir el nombre exacto de la asignatura — es la última oportunidad de detenerte.',
        ],
      },
      {
        subtitle: 'El orden de tu lista',
        items: [
          'En la web las ordenas con las flechas de cada tarjeta. En la app las mantienes presionadas y las arrastras.',
        ],
      },
    ],
  },

  {
    id: 'estudiantes',
    title: 'Estudiantes',
    icon: Users,
    content: [
      {
        subtitle: 'Darlos de alta',
        items: [
          'Uno por uno: apellido paterno, apellido materno y nombre(s). El materno es el único que puedes dejar vacío.',
          'Todo el grupo de una vez, desde la web: descargas la plantilla de Excel, escribes número de lista y nombre completo, y la subes. Antes de guardar nada te muestra una vista previa de lo que va a pasar con cada fila.',
          'En esa vista previa cada nombre queda marcado como nuevo, vinculado, ya inscrito o repetido dentro del mismo archivo. Tú puedes cambiar la decisión fila por fila.',
        ],
      },
      {
        subtitle: 'El usuario se genera solo',
        items: [
          'Se arma con el apellido paterno y el primer nombre: "Enrique Méndez García" queda como mendez.enrique. Sin acentos ni ñ.',
          'Si dos alumnos coinciden, el segundo recibe un número: garcia.juan, garcia.juan01, garcia.juan02.',
          'No tienes que inventar ni repartir usuarios, y tampoco repartes contraseñas: cada estudiante elige la suya la primera vez que entra.',
          '⚠ Cambiarle el nombre a un estudiante ya dado de alta no le cambia el usuario. Eso es a propósito: si ya activó su cuenta, seguiría entrando con el mismo.',
        ],
      },
      {
        subtitle: 'Cómo entran ellos la primera vez',
        items: [
          'Les das el código de acceso de tu asignatura, el de 6 caracteres. Lo dictas, lo escribes en el pizarrón o lo copias con el botón que está junto al nombre de la materia.',
          'El estudiante entra a su pantalla de acceso, toca "¿Primera vez? Activa tu cuenta" y escribe ese código.',
          'Luego escribe su usuario, la plataforma lo reconoce en tu lista, y él elige su contraseña (mínimo 6 caracteres). Listo.',
          'Si ya tenía cuenta contigo en otra asignatura, no crea una nueva: escribe la contraseña que ya usa y esa asignatura se suma a su cuenta.',
          'Puedes descargar el PDF de lista de acceso, con el código de la clase y el usuario de cada quien.',
          '⚠ Ese PDF no trae contraseñas, y no es un descuido: nadie más que el estudiante conoce la suya.',
          'El código es la única forma de entrar, en la web y en la app por igual. Así tu estudiante lo aprende desde el primer día y lo puede volver a usar solo.',
        ],
      },
      {
        subtitle: 'Si un estudiante olvida su contraseña',
        items: [
          'Desde "Editar estudiante" le habilitas la recuperación. Eso le abre la opción de elegir una nueva desde su propia pantalla de acceso.',
          'Tú no recibes ninguna clave temporal ni la tecleas por él. Solo le abres la puerta; la contraseña sigue siendo suya.',
        ],
      },
      {
        subtitle: 'Estudiantes que ya tienes en otra asignatura',
        items: [
          'Cuando das de alta a alguien cuyo nombre ya existe en otra de tus asignaturas, la plataforma te pregunta si es la misma persona.',
          'Si dices que sí, reutiliza su cuenta: mismo usuario, misma contraseña, y ve la asignatura nueva al instante.',
          'Si dices que no, crea una cuenta aparte. Tú decides — la plataforma no lo asume por ti.',
        ],
      },
      {
        subtitle: 'Lo que puedes editar después',
        items: [
          'Sus nombres y apellidos, y un campo de comentarios privados que solo tú ves.',
          'Puedes ordenar la lista alfabéticamente cuando quieras, o dejarla en el orden en que los diste de alta.',
          'Si un estudiante subió una foto de perfil que no corresponde, puedes eliminarla.',
        ],
      },
    ],
  },

  {
    id: 'actividades',
    title: 'Actividades',
    icon: ClipboardList,
    content: [
      {
        subtitle: 'Los cuatro tipos',
        items: [
          'Entregable — el alumno sube uno o varios archivos.',
          'Observación — sin entrega: tú observas y calificas. Por ejemplo una exposición o un ejercicio en clase.',
          'Cuestionario — preguntas que se califican solas. Viene con navegación libre, sin tiempo límite, intentos ilimitados y se conserva la mejor calificación.',
          'Examen — las mismas preguntas, pero viene con navegación secuencial, 30 minutos, un solo intento y se conserva el último.',
          'Cuestionario y examen son la misma herramienta con distintos valores de arranque. Todo lo puedes cambiar.',
        ],
      },
      {
        subtitle: 'Lo que capturas',
        items: [
          'Nombre e instrucciones. Las instrucciones aceptan formato y archivos adjuntos de hasta 15 MB cada uno.',
          'Los tipos de archivo que puede subir el alumno: imágenes (hasta 5), PDF, Word, PowerPoint, Excel, comprimido, cualquier archivo, o la lista de extensiones que tú escribas.',
          'La fecha límite es opcional, y es fecha y hora.',
          'Todas las actividades se califican sobre 10. No es un campo que tengas que decidir cada vez.',
        ],
      },
      {
        subtitle: 'Quién la ve y desde cuándo',
        items: [
          'Publicar ahora — tus estudiantes la ven de inmediato.',
          'Borrador — solo tú la ves, mientras la terminas.',
          'Programada — eliges día y hora, y aparece sola. Útil para dejar lista la semana.',
          'El ojito de cada actividad la muestra u oculta sin perder su fecha original de publicación.',
          '⚠ La fecha límite tiene que caer después de la fecha de publicación. Si programas una actividad para el viernes, su entrega no puede vencer el jueves.',
        ],
      },
      {
        subtitle: 'Cuando llega la fecha límite',
        items: [
          'Por defecto las entregas se cierran solas al llegar la hora.',
          'Si desactivas esa casilla, sigues recibiendo entregas y llegan marcadas como entregadas tarde. Tú decides qué hacer con ellas.',
          'Puedes dar prórroga con una fecha nueva, a todo el grupo o solo a ciertos estudiantes, y anotar el motivo.',
          'También puedes cerrar la actividad a mano en cualquier momento.',
        ],
      },
      {
        subtitle: 'Avisos de entrega',
        items: [
          'Cada actividad tiene la casilla "Notificarme cuando entreguen esta actividad". Viene apagada.',
          'El aviso llega al celular donde tengas instalada la app.',
          '⚠ Marcarla no basta: hay que guardar la actividad para que aplique. La propia pantalla te lo recuerda mientras no guardes.',
        ],
      },
      {
        subtitle: 'Opciones de cuestionarios y exámenes',
        items: [
          'Orden de las preguntas: como las creaste o aleatorio. Y por separado, barajar las opciones dentro de cada pregunta.',
          'Navegación libre (puede regresar) o secuencial (no puede regresar).',
          'Tiempo límite en minutos, o sin límite si lo dejas vacío.',
          'Intentos permitidos, o ilimitados si lo dejas vacío. Con más de un intento eliges qué conservar: el primero, el último, la más alta o el promedio.',
          'Publicar la calificación y publicar las respuestas son dos decisiones independientes: cada una puede ser al terminar, ahora, o en la fecha que elijas.',
        ],
      },
    ],
  },

  {
    id: 'rubricas-cotejo',
    title: 'Rúbricas y listas de cotejo',
    icon: ClipboardCheck,
    content: [
      {
        subtitle: 'Qué son aquí',
        items: [
          'Una rúbrica es una tabla de criterios por niveles de desempeño. Cada criterio tiene su peso y cada nivel su puntaje.',
          'Una lista de cotejo es la versión de una sola columna: cada criterio se cumple o no se cumple.',
          'Las dos se usan en entregables y observaciones. Los cuestionarios y exámenes no las usan porque se califican con los puntos de sus preguntas.',
        ],
      },
      {
        subtitle: 'Cómo se arma una rúbrica',
        items: [
          'Entre 2 y 6 criterios, y entre 3 y 5 niveles de desempeño.',
          'El nivel más alto vale 10 puntos. Los siguientes valen menos, en orden descendente, y solo el más bajo puede valer 0.',
          'El peso de los criterios se reparte parejo al empezar, y tú lo ajustas. Cada columna debe cuadrar con el puntaje de su nivel.',
          'Todo suma sobre 10, igual que el resto de la plataforma.',
        ],
      },
      {
        subtitle: 'Tu banco de rúbricas',
        items: [
          'Cada rúbrica que creas se guarda en tu banco y la reutilizas en cualquier otra actividad.',
          'Desde el banco puedes previsualizar, editar, duplicar y eliminar.',
          'Al asignarla a una actividad se guarda una copia dentro de esa actividad. Por eso puedes editar la del banco sin que se te muevan las calificaciones que ya pusiste con la versión anterior.',
        ],
      },
      {
        subtitle: 'Calificar con rúbrica',
        items: [
          'Marcas el nivel de cada criterio y la calificación sobre 10 se calcula sola.',
          'Mientras falte un criterio por marcar, no te da un total a medias.',
          'Con rúbrica puedes calificar aunque no haya entrega — útil justamente para las observaciones.',
          'Tu estudiante ve la rúbrica desde que abre la actividad, y una vez calificado ve en qué nivel quedó cada criterio.',
        ],
      },
      {
        subtitle: 'Dónde se crean',
        items: [
          '⚠ Crear y editar rúbricas es de la versión web. Desde la app puedes elegir una que ya tengas en tu banco y calificar con ella.',
        ],
      },
    ],
  },

  {
    id: 'banco-reactivos',
    title: 'Banco de reactivos',
    icon: Database,
    content: [
      {
        subtitle: 'Para qué existe',
        items: [
          'Es tu colección personal de preguntas. Las escribes una vez y las reutilizas en los exámenes y cuestionarios que quieras.',
          'Se organiza por materia (la toma del nombre de tu asignatura) y por el tema que tú le pongas.',
          'No está atado a un parcial ni a un ciclo: una pregunta de "funciones cuadráticas" sirve este semestre y el que viene.',
        ],
      },
      {
        subtitle: 'Los cuatro tipos de pregunta',
        items: [
          'Opción múltiple — arranca con cuatro opciones y tú agregas o quitas. Tiene una opción especial "Otra", donde el alumno escribe su propia respuesta.',
          'Verdadero o falso.',
          'Respuesta corta — el alumno responde con texto libre y tú asignas los puntos al revisar.',
          'Subir documento — el alumno adjunta un archivo dentro del examen y tú asignas los puntos al revisar.',
          'Cada pregunta puede llevar imagen y una retroalimentación que el alumno ve después.',
        ],
      },
      {
        subtitle: 'Cómo lo llenas y lo usas',
        items: [
          'Al escribir una pregunta marcas "guardar en banco". Si lo haces, ponerle tema es obligatorio — es lo que te va a permitir encontrarla después.',
          'También puedes mandar al banco una pregunta que ya escribiste dentro de un examen.',
          'Para usarlo: buscas por texto, tema o materia, seleccionas varias preguntas de una vez y se agregan al examen.',
          'Las preguntas que agregas desde el banco quedan como copias dentro de ese examen, con el rastro de dónde salieron.',
        ],
      },
      {
        subtitle: 'Los puntos de cada pregunta',
        items: [
          'Cada pregunta tiene su ponderación y el total del examen no pasa de 10.',
          'El botón "Repartir parejo" divide los 10 puntos entre todas tus preguntas.',
        ],
      },
    ],
  },

  {
    id: 'calificaciones',
    title: 'Calificaciones',
    icon: Percent,
    content: [
      {
        subtitle: 'Cómo se captura',
        items: [
          'Todas las actividades van sobre 10, con un decimal si lo necesitas.',
          'Puedes capturar desde la actividad, o rápido desde la tabla de calificaciones tocando la celda.',
          'En cuestionarios y exámenes, las preguntas de opción múltiple y verdadero/falso se califican solas. Las de respuesta corta y documento las revisas tú.',
        ],
      },
      {
        subtitle: 'Sin ponderación',
        items: [
          'Si no activas nada, el promedio del parcial es el promedio simple de las actividades que ya calificaste.',
          'Las que todavía no calificas no cuentan, así que el promedio que ves siempre refleja lo que llevas revisado.',
        ],
      },
      {
        subtitle: 'Con ponderación',
        items: [
          'La activas por parcial, no para toda la asignatura. Puedes ponderar el primer parcial y dejar el segundo en promedio simple.',
          'Le das a cada actividad cuánto vale del 10 total del parcial.',
          'Mientras capturas puedes ir sumando menos de 10 sin problema. Para exportar calificaciones o cerrar el parcial se te pide que cuadre en 10 exacto — así el promedio significa lo mismo para todos.',
          'El ojito decide si tus estudiantes ven cuánto vale cada actividad. El promedio ponderado siempre es el oficial, lo vean o no.',
          '⚠ Apagar la ponderación borra los pesos que capturaste. Te lo confirma antes, pero vale la pena saberlo.',
        ],
      },
      {
        subtitle: 'El promedio final',
        items: [
          'Es el promedio simple de los promedios de tus parciales.',
          'Todos los parciales pesan igual entre sí. La ponderación que configuras es de las actividades dentro de cada parcial.',
        ],
      },
      {
        subtitle: 'Cerrar un parcial',
        items: [
          'Cerrar deja el parcial completo: a cada estudiante sin entrega se le pone la calificación que tú elijas (viene sugerido 5) y esas calificaciones quedan marcadas como puestas por el cierre.',
          'Antes de cerrar se revisa que no queden entregas sin calificar y que la ponderación cuadre. Es la última pasada para que no se te escape nada.',
          'Un estudiante que llegue después del cierre recibe automáticamente esas mismas calificaciones.',
          'Revertir el cierre es seguro: quita solo lo que puso el cierre y respeta cada calificación que capturaste tú.',
        ],
      },
      {
        subtitle: 'Ranking',
        items: [
          'Puedes ordenar tu tabla por promedio, de un parcial o del general, y aparece la columna de lugar.',
          'Resalta el 20% de arriba y el 20% de abajo, para ubicar rápido a quién felicitar y a quién acercarte.',
          'Se exporta a Excel o PDF. El número de lista de cada estudiante no se altera al ordenar.',
        ],
      },
      {
        subtitle: 'Lo que ve tu estudiante',
        items: [
          'Solo lo suyo: su calificación de cada actividad, su promedio por parcial, y tus comentarios.',
          'Los parciales que tengas ocultos no le aparecen.',
        ],
      },
    ],
  },

  {
    id: 'asistencia',
    title: 'Asistencia',
    icon: UserCheck,
    content: [
      {
        subtitle: 'De dónde salen los días',
        items: [
          'Si tu asignatura tiene fechas de inicio y fin y ya programaste tu horario, los días se generan solos: la plataforma sabe qué días tienes clase y prepara la lista.',
          'Si tienes dos horas seguidas ese día, se preparan dos columnas — una por cada bloque. Cada una cuenta como una asistencia.',
          'Cada día queda ubicado en su parcial automáticamente.',
          'Si tu asignatura no tiene fechas, agregas los días a mano cuando los necesites.',
        ],
      },
      {
        subtitle: 'Los tres estados',
        items: [
          'Presente, falta y justificada. Tocas la celda y va rotando entre los tres.',
          'Todos empiezan presentes. Tú solo marcas a quien faltó — es lo que haces en el aula de todos modos.',
          'La falta justificada cuenta como asistencia en el porcentaje. La injustificada es la que resta.',
          'Al marcar justificada se te pide el motivo, y lo puedes releer o corregir después tocando esa misma celda.',
        ],
      },
      {
        subtitle: 'Días que no hay clase',
        items: [
          'Los días de asueto y los periodos de vacaciones que registres no generan lista.',
          'Puedes separar las dos cosas: suspender clases pero seguir pasando lista, o al revés. Cada día festivo lo configuras según lo que realmente pasó.',
          'Si pasas lista en un día marcado como asueto, la plataforma te avisa pero te deja hacerlo — a veces sí hubo actividad ese día y solo tú lo sabes.',
        ],
      },
      {
        subtitle: 'Borrar y recuperar un día',
        items: [
          'Al borrar un día, la plataforma recuerda que fuiste tú quien lo quitó y no lo vuelve a crear sola.',
          'Si te arrepientes, ese día aparece como "Restaurar día" y vuelve con sus columnas.',
        ],
      },
      {
        subtitle: 'Estudiantes que llegan tarde al curso',
        items: [
          'A quien das de alta a media marcha no se le cuentan los días anteriores a su alta.',
          'Su porcentaje refleja los días en que realmente ya estaba en tu grupo.',
        ],
      },
    ],
  },

  {
    id: 'agenda',
    title: 'Agenda y calendario',
    icon: CalendarDays,
    content: [
      {
        subtitle: 'Las cuatro vistas',
        items: [
          'Día, 3 días, Semana y Mes. La plataforma recuerda en cuál te quedaste.',
          'En la web creas eventos tocando directo el calendario, en cualquiera de las cuatro.',
          'En la app, Semana y Mes son para consultar. Día y 3 días sí permiten editar y mover.',
          'En la app los eventos se crean con el botón "+ Evento", para que no aparezcan por un toque accidental.',
        ],
      },
      {
        subtitle: 'Bloques de clase',
        items: [
          'Un bloque es una clase concreta en una fecha concreta. Los programas una vez por asignatura y se materializan en todo el rango del curso.',
          'Los armas en dos pasos: eliges asignatura, rango de fechas, duración, cuántos bloques por semana, color y alarma; luego los colocas en la zona semanal, en su día y su hora.',
          'Cada bloque que colocas es un rectángulo. Dos horas seguidas son dos bloques.',
          'Los bloques son la base de la asistencia automática: de ahí salen los días para pasar lista.',
          'Si arrastras un bloque, mueves esa clase nada más. Las demás semanas siguen igual.',
        ],
      },
      {
        subtitle: 'Eventos',
        items: [
          'Los eventos son tuyos y no pertenecen a ninguna asignatura: juntas, guardias, lo que necesites recordar.',
          'Además ves en el calendario, sin capturarlas, las fechas límite y las publicaciones programadas de tus actividades. Al tocarlas te llevan a la actividad.',
        ],
      },
      {
        subtitle: 'Asuetos y vacaciones',
        items: [
          'El asueto es un día suelto; las vacaciones son un periodo con fecha de inicio y fin.',
          'En los dos casos eliges qué se suspende: clases, eventos, actividades o asistencias. Puedes suspender clases y seguir pudiendo pasar lista, o cualquier combinación.',
        ],
      },
      {
        subtitle: 'Cuando algo no cuadra, te avisa',
        items: [
          '"Faltan clases" — alargaste las fechas del curso y hay un tramo sin clases. Al tocarlo extiende tu horario a ese tramo, sin tocar lo que ya tenías.',
          '"Fuera de rango" — recortaste las fechas y quedaron clases fuera del curso. Te ofrece quitarlas.',
          '"En asueto" — marcaste un día festivo después de haber programado. Te ofrece quitar las clases que quedaron ahí.',
          'Los tres avisos son de un solo toque. No tienes que rehacer tu horario por un ajuste de fechas.',
        ],
      },
      {
        subtitle: 'Alarmas',
        items: [
          'Cada bloque puede sonar antes de la clase, con los minutos de anticipación que elijas y uno de cinco sonidos.',
          'Si tienes dos horas seguidas, solo suena la primera. La segunda caería en plena clase.',
          '⚠ Estas alarmas suenan con la app o la pestaña abierta. Para los recordatorios que llegan al celular aunque esté cerrado, usa Notificaciones.',
        ],
      },
    ],
  },

  {
    id: 'reportes',
    title: 'Reportes y exportación',
    icon: FileDown,
    content: [
      {
        subtitle: 'Calificaciones',
        items: [
          'Excel y PDF, de toda la asignatura o de un parcial específico.',
          '⚠ Si tienes ponderación activa, para exportar se te pide que los pesos cuadren en 10. Es lo que hace que la columna de promedio signifique lo mismo para todos.',
        ],
      },
      {
        subtitle: 'Asistencia',
        items: [
          'Excel, completa o por parcial, con el concentrado de asistencias y faltas.',
          'Aquí no hay PDF, y es por comodidad tuya: una hoja de asistencia son muchas columnas angostas, y en Excel se lee y se maneja mucho mejor.',
        ],
      },
      {
        subtitle: 'Ranking',
        items: [
          'Excel y PDF con lugar, nombre y promedio, del parcial que elijas o del general.',
        ],
      },
      {
        subtitle: 'Acceso de estudiantes',
        items: [
          'PDF de lista de acceso, con el código de la clase y el usuario de cada estudiante.',
        ],
      },
      {
        subtitle: 'Entregas',
        items: [
          'Puedes descargar en un ZIP los archivos que subieron tus estudiantes.',
          'También lo puedes hacer al archivar la asignatura, para quedarte con el respaldo del ciclo.',
        ],
      },
    ],
  },

  {
    id: 'perfil-suscripcion',
    title: 'Perfil y suscripción',
    icon: UserCog,
    content: [
      {
        subtitle: 'Tu perfil',
        items: [
          'Tu nombre real y el nombre con que te ven tus estudiantes son dos campos distintos. El segundo es el que aparece en sus pantallas.',
          'Puedes subir tu foto y elegir tu escuela del catálogo, o darla de alta si no aparece.',
          'Ahí también está el aviso de privacidad.',
        ],
      },
      {
        subtitle: 'Tu suscripción',
        items: [
          'El contador de días de prueba vive en el menú lateral y te lleva a tu Perfil, que es donde activas.',
          'Puedes pagar con Mercado Pago o con PayPal.',
          'Al vencer sigues pudiendo consultar y descargar todo lo tuyo. Lo que se pausa es capturar información nueva.',
        ],
      },
      {
        subtitle: 'Notificaciones',
        items: [
          'Avisos de entregas nuevas y de estudiantes que activan su cuenta, en las actividades y asignaturas donde tú los actives.',
          'Recordatorios de clase y de evento, con los minutos de anticipación que elijas. Puedes pedir un aviso o varios seguidos.',
          'Tienes la bitácora de lo que se te envió.',
          'Los recordatorios llegan al celular donde tengas instalada la app, aunque la traigas cerrada. Los ajustes los puedes cambiar desde la web.',
        ],
      },
      {
        subtitle: 'Tu cuenta en varios dispositivos',
        items: [
          'La misma cuenta funciona en la web y en la app al mismo tiempo.',
          'Si entraste con Google y quieres además una contraseña propia, la agregas desde tu Perfil.',
        ],
      },
    ],
  },
]

export default function ManualPage() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id)
  const active = SECTIONS.find((s) => s.id === activeId)

  return (
    <div className={`px-4 py-4 ${TEACHER_CONTAINER_NARROW}`}>
      <div className="mb-4">
        <h1 className="text-[21px] font-bold text-on-surface">Manual</h1>
        <p className="text-[15px] text-slate-500 mt-0.5">Cómo funciona cada parte de Evalúa Fácil.</p>
      </div>

      {/* Índice — tira horizontal en móvil, columna fija en escritorio. */}
      <div className="md:grid md:grid-cols-[230px_1fr] md:gap-6 md:items-start">
        <nav className="flex md:flex-col gap-1.5 overflow-x-auto pb-2 md:pb-0 mb-4 md:mb-0 -mx-1 px-1 md:sticky md:top-4">
          {SECTIONS.map((s) => {
            const Icon = s.icon
            const isActive = s.id === activeId
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-card text-[15px] font-medium text-left whitespace-nowrap md:whitespace-normal flex-shrink-0 md:flex-shrink transition-colors ${
                  isActive
                    ? 'bg-accent text-white shadow-card'
                    : 'bg-surface-card text-muted hover:bg-[var(--accent-tint)]'
                }`}
              >
                <Icon size={16} className="flex-shrink-0" />
                {s.title}
              </button>
            )
          })}
        </nav>

        <div className="bg-surface-card rounded-card shadow-card p-5 min-w-0">
          <h2 className="text-[19px] font-bold text-on-surface mb-4">{active.title}</h2>
          <div className="space-y-5">
            {active.content.map((block) => (
              <section key={block.subtitle}>
                <h3 className="text-[15px] font-bold text-accent mb-2">{block.subtitle}</h3>
                <ul className="space-y-2">
                  {block.items.map((item, i) => {
                    const isWarning = item.startsWith('⚠ ')
                    const text = isWarning ? item.slice(2) : item
                    return (
                      <li key={i} className="flex items-start gap-2 text-[15px] text-on-surface leading-relaxed">
                        {isWarning ? (
                          <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
                        ) : (
                          <Check size={15} className="text-accent flex-shrink-0 mt-0.5" />
                        )}
                        <span className={isWarning ? 'text-amber-900' : undefined}>{text}</span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
