# Formulario de Seguridad de los datos — respuestas recomendadas

Google Play te hace un cuestionario sobre qué datos recopila tu app. Estas son las
respuestas correctas para Evalúa Fácil (basadas en lo que la app realmente hace:
autenticación con Firebase, fotos con Cloudinary, correos con EmailJS, cobros con
Mercado Pago/PayPal). Ajusta si cambias algo en el futuro.

## Preguntas generales
- **¿Tu app recopila o comparte datos de usuario?** → **Sí**.
- **¿Los datos se cifran en tránsito?** → **Sí** (HTTPS/TLS en toda la app).
- **¿Los usuarios pueden solicitar que se eliminen sus datos?** → **Sí** (pueden
  eliminar su cuenta en la app y/o escribir al correo de contacto).
- **¿Tienes una forma de que los usuarios soliciten la eliminación?** → Sí — el correo
  de contacto de la política de privacidad y la opción de eliminar cuenta.

## Tipos de datos que se RECOPILAN
Para cada uno, marca **Recopilado = Sí**. Casi todos son **Obligatorios** (la app no
funciona sin ellos) y NINGUNO se procesa solo de forma efímera. Marca **Compartido con
terceros = No** (Firebase/Cloudinary/EmailJS/pagos son *proveedores de servicio* que
procesan por tu cuenta; eso cuenta como "recopilado", no como "compartido").

| Categoría → Tipo de dato | ¿Recopilado? | Propósito(s) |
|---|---|---|
| **Información personal → Nombre** | Sí | Funcionalidad de la app; gestión de la cuenta |
| **Información personal → Dirección de correo** (docentes) | Sí | Funcionalidad de la app; gestión de la cuenta |
| **Información personal → Identificadores de usuario** (nombre de usuario del alumno) | Sí | Funcionalidad de la app |
| **Fotos y videos → Fotos** (foto de perfil, opcional) | Sí | Funcionalidad de la app |
| **Actividad en la app → Otras acciones** (calificaciones, actividades, evaluaciones, asistencia) | Sí | Funcionalidad de la app |
| **ID del dispositivo u otros → Token de mensajería (FCM)** | Sí | Notificaciones / Funcionalidad de la app |

### Datos que NO se recopilan (responde "No" a estos)
- Ubicación (precisa o aproximada) → **No**.
- Información financiera / número de tarjeta → **No** (los pagos los maneja el
  proveedor externo; la app no ve ni guarda datos de tarjeta).
- Contactos, mensajes SMS, historial de navegación, salud, audio → **No**.

## Purpose (propósito) recomendado por dato
Para todos, el propósito principal es **"Funcionalidad de la app"**. El token de FCM
además marca **"Comunicaciones / notificaciones"** si el formulario lo permite. **No**
marques "Publicidad o marketing" ni "Analíticas de terceros" (la app no las usa para
esos fines).

## Resumen en una frase (por si pide justificación)
> Evalúa Fácil recopila el nombre y correo del docente, el nombre/usuario y foto
> opcional del alumno, y el contenido académico (calificaciones, actividades,
> evaluaciones, asistencia), con el único fin de prestar el servicio educativo. Los
> datos se cifran en tránsito, no se venden ni se comparten con fines publicitarios, y
> el usuario puede solicitar su eliminación.
