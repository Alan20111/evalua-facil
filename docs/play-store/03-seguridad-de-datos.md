# Formulario de Seguridad de los datos — respuestas recomendadas

Google Play te hace un cuestionario sobre qué datos recopila tu app. Estas son las
respuestas para Evalúa Fácil según lo que la app hace hoy (revisado el 14-oct-2026,
`docs/PLAN_GOOGLE_PLAY.md` B3):
- autenticación y datos con Firebase;
- fotos y archivos con Cloudinary;
- correos con Brevo;
- IA con Anthropic (Claude) y Google Gemini (solo videos públicos de YouTube);
- compra de créditos por transferencia, **solo en la web**.

Si cambias algo de eso, actualiza este archivo y el aviso de privacidad
(`src/pages/Privacidad.jsx`) en el mismo PR.

## Preguntas generales
- **¿Tu app recopila o comparte datos de usuario?** → **Sí**.
- **¿Los datos se cifran en tránsito?** → **Sí** (HTTPS/TLS en toda la app).
- **¿Los usuarios pueden solicitar que se eliminen sus datos?** → **Sí**:
  - desde la app, en Perfil › Perfil › Cuenta › «Eliminar mi cuenta»;
  - o desde la web.
- **URL para solicitar la eliminación de la cuenta** → `https://evaluafacil.mx/eliminar-cuenta`.
  Es pública, no pide sesión y explica qué se borra.
- **¿También se pueden borrar algunos datos sin borrar la cuenta?** → **Sí**:
  asignaturas, alumnos, actividades, entregas y fotos se borran por separado
  dentro de la app.

## «Recopilado» y «compartido»
- Marca **Compartido con terceros = No** en todo.
- Firebase, Cloudinary, Brevo, Anthropic y Google Gemini son **proveedores de
  servicio** que procesan los datos por cuenta de Evalúa Fácil. Google lo cuenta
  como «recopilado», no como «compartido».
- No hay publicidad, ni venta de datos, ni analíticas de terceros.

## Tipos de datos que se RECOPILAN
Marca **Recopilado = Sí** en cada uno. Ninguno se procesa solo de forma efímera.

| Categoría → Tipo de dato | ¿Obligatorio? | Propósito(s) | Nota |
|---|---|---|---|
| **Información personal → Nombre** | Obligatorio | Funcionalidad de la app; Gestión de la cuenta | Docente y alumno. El nombre del alumno puede ir a la IA al calificar. |
| **Información personal → Dirección de correo** | Obligatorio | Funcionalidad de la app; Gestión de la cuenta | Solo docentes. Los alumnos no tienen correo real. |
| **Información personal → ID de usuario** | Obligatorio | Funcionalidad de la app; Gestión de la cuenta | Nombre de usuario del alumno y del docente. |
| **Información financiera → Historial de compras** | Opcional | Funcionalidad de la app | Compras de créditos hechas en la web (paquete, monto, fecha). La cuenta es la misma en la app, así que se declara. |
| **Información financiera → Otra información financiera** | Opcional | Funcionalidad de la app | Comprobante de transferencia que sube el docente en la web. **No** se recopilan números de tarjeta ni de cuenta. |
| **Fotos y videos → Fotos** | Opcional | Funcionalidad de la app | Foto de perfil y fotos que se entregan como evidencia. |
| **Archivos y documentos → Archivos y documentos** | Opcional | Funcionalidad de la app | Entregas de los alumnos (PDF, Word, imágenes) y materiales del docente. Pueden ir a la IA al calificar con IA. |
| **Mensajes → Otros mensajes en la app** | Opcional | Funcionalidad de la app | Avisos del docente, comentarios, mensajes al Asistente IA y reportes de IA. |
| **Actividad en la app → Otro contenido generado por el usuario** | Obligatorio | Funcionalidad de la app | Calificaciones, actividades, evaluaciones, respuestas de exámenes y asistencia. |
| **Actividad en la app → Interacciones con la app** | Obligatorio | Funcionalidad de la app | Avance del video interactivo y lecturas de avisos. |
| **ID del dispositivo u otros → ID del dispositivo u otros** | Opcional | Funcionalidad de la app | Token de notificaciones (FCM). Solo si se permiten las notificaciones. |
| **Información y rendimiento de la app → Registros de fallos** | Obligatorio | Análisis | Errores de la app (mensaje, pila, ruta sin ids, versión, plataforma, navegador y rol). Sin uid, correo ni URL completa (`api/error-report.js`, O3). |
| **Información y rendimiento de la app → Diagnóstico** | Obligatorio | Análisis | Lo mismo: se agrupan por error distinto con un contador. |

### Datos que NO se recopilan (responde «No»)
- Ubicación (precisa o aproximada).
- Números de tarjeta o de cuenta bancaria.
- Contactos, calendario del teléfono, SMS, historial de navegación, salud y
  actividad física, audio, música.

## Propósitos
- Para todos: **«Funcionalidad de la app»**.
- Para nombre, correo e ID de usuario, además: **«Gestión de la cuenta»**.
- Para registros de fallos y diagnóstico: **«Análisis»**, porque sirven para encontrar
  y corregir errores. Son propios: no van a un servicio de analíticas de terceros.
- **No** marques «Publicidad o marketing», «Personalización» ni «Prevención de fraude».

## Resumen en una frase (por si pide justificación)
> Evalúa Fácil recopila el nombre y correo del docente, el nombre de usuario y la
> foto opcional del alumno, y el contenido académico (calificaciones,
> actividades, entregas, evaluaciones, asistencia), con el único fin de prestar
> el servicio educativo.
>
> Cuando el docente usa una función de IA, el contenido necesario se procesa con
> Anthropic, que no entrena modelos con esos datos. Los datos se cifran en
> tránsito, no se venden ni se usan para publicidad, y el usuario puede eliminar
> su cuenta desde la app o en evaluafacil.mx/eliminar-cuenta.
