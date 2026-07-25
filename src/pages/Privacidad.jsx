import { Link } from 'react-router-dom'
import EFLogo from '../components/EFLogo'

// Aviso de privacidad — página pública (ruta /privacidad y /privacy).
// Requisito de Google Play y de la Ley Federal de Protección de Datos
// Personales en Posesión de los Particulares (México). Contenido estático.
//
// ⚠️ El correo de contacto (soporte@evaluafacil.mx) debe existir y recibir
// correo. Mientras el correo de dominio no esté activo, cámbialo aquí por uno
// que funcione (una sola línea, marcada abajo con CONTACTO).
const CONTACTO = 'soporte@evaluafacil.mx'
const ACTUALIZADO = '25 de julio de 2026'

function Seccion({ titulo, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-on-surface mb-2">{titulo}</h2>
      <div className="text-sm text-muted leading-relaxed space-y-3">{children}</div>
    </section>
  )
}

export default function Privacidad() {
  return (
    <div className="min-h-screen bg-surface py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to="/" className="inline-block mb-6">
          <EFLogo className="w-44 h-auto" />
        </Link>

        <h1 className="text-2xl font-bold text-on-surface">Aviso de privacidad</h1>
        <p className="text-xs text-slate-400 mt-1">Última actualización: {ACTUALIZADO}</p>

        <p className="text-sm text-muted leading-relaxed mt-6">
          Evalúa Fácil es una plataforma educativa que permite a docentes gestionar
          calificaciones, actividades, evaluaciones y asistencia de sus alumnos. Este
          aviso describe qué datos personales tratamos, con qué fines y cómo puedes
          ejercer tus derechos. Al usar la aplicación (web o Android) aceptas lo aquí
          descrito.
        </p>

        <Seccion titulo="1. Responsable del tratamiento">
          <p>
            El responsable del tratamiento de tus datos personales es el equipo de
            Evalúa Fácil. Para cualquier asunto relacionado con este aviso puedes
            escribirnos a <span className="font-semibold text-on-surface">{CONTACTO}</span>.
          </p>
        </Seccion>

        <Seccion titulo="2. Datos que recopilamos">
          <p>Según tu rol, tratamos los siguientes datos:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <span className="font-semibold text-on-surface">Docentes:</span> nombre,
              correo electrónico, escuela/plantel, foto de perfil (opcional) y credenciales
              de acceso.
            </li>
            <li>
              <span className="font-semibold text-on-surface">Alumnos:</span> nombre,
              nombre de usuario, foto de perfil (opcional) y la asignatura en la que el
              docente los inscribe. Las cuentas de alumno las crea y administra el docente.
            </li>
            <li>
              <span className="font-semibold text-on-surface">Contenido académico:</span>{' '}
              calificaciones, actividades, entregas, evaluaciones, rúbricas y asistencia.
            </li>
            <li>
              <span className="font-semibold text-on-surface">Datos técnicos:</span> token
              de dispositivo para notificaciones y datos básicos de uso necesarios para el
              funcionamiento del servicio.
            </li>
            <li>
              <span className="font-semibold text-on-surface">Datos de suscripción:</span>{' '}
              estado de la suscripción. Los pagos se procesan directamente por proveedores
              externos (ver sección 5); nosotros no almacenamos números de tarjeta.
            </li>
          </ul>
        </Seccion>

        <Seccion titulo="3. Para qué usamos tus datos">
          <ul className="list-disc pl-5 space-y-1">
            <li>Crear y administrar tu cuenta y autenticar tu acceso.</li>
            <li>Prestar el servicio: registrar calificaciones, actividades, evaluaciones y asistencia.</li>
            <li>Enviarte avisos y notificaciones relacionados con tus clases y entregas.</li>
            <li>Enviar correos operativos (por ejemplo, bienvenida o restablecimiento de contraseña).</li>
            <li>Gestionar tu suscripción y el acceso a las funciones de pago.</li>
            <li>Mantener la seguridad del servicio y cumplir obligaciones legales.</li>
          </ul>
        </Seccion>

        <Seccion titulo="4. Notificaciones">
          <p>
            Si autorizas las notificaciones, usamos un token de tu dispositivo para
            enviarte avisos. Puedes desactivarlas en cualquier momento desde la
            configuración de tu dispositivo o de la aplicación.
          </p>
        </Seccion>

        <Seccion titulo="5. Terceros con los que compartimos datos">
          <p>
            Para operar utilizamos servicios de terceros que tratan datos por nuestra
            cuenta, bajo sus propias políticas de privacidad:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <span className="font-semibold text-on-surface">Google Firebase</span>{' '}
              (autenticación, base de datos y notificaciones push).
            </li>
            <li>
              <span className="font-semibold text-on-surface">Cloudinary</span>{' '}
              (almacenamiento de fotos y archivos que se suben a la plataforma).
            </li>
            <li>
              <span className="font-semibold text-on-surface">EmailJS</span>{' '}
              (envío de correos operativos).
            </li>
            <li>
              <span className="font-semibold text-on-surface">Procesadores de pago</span>{' '}
              (Mercado Pago y PayPal) para cobrar la suscripción de forma segura.
            </li>
          </ul>
          <p>No vendemos ni rentamos tus datos personales a terceros.</p>
        </Seccion>

        <Seccion titulo="6. Datos de menores de edad">
          <p>
            Evalúa Fácil es una herramienta para uso escolar, administrada por el docente
            y la institución educativa. Las cuentas de alumno las crea el docente en el
            contexto de su clase. Corresponde al docente y a la escuela obtener, cuando
            aplique, el consentimiento de padres o tutores conforme a la normativa
            aplicable. Si eres padre, madre o tutor y deseas que se eliminen los datos de
            un alumno, contáctanos o solicítalo al docente responsable.
          </p>
        </Seccion>

        <Seccion titulo="7. Conservación de los datos">
          <p>
            Conservamos tus datos mientras tu cuenta esté activa y durante el tiempo
            necesario para cumplir con los fines descritos y con obligaciones legales.
            Cuando dejan de ser necesarios, se eliminan o anonimizan.
          </p>
        </Seccion>

        <Seccion titulo="8. Seguridad">
          <p>
            Aplicamos medidas técnicas y administrativas razonables para proteger tus
            datos, incluyendo autenticación, reglas de acceso y cifrado en tránsito.
            Ningún sistema es infalible, pero trabajamos para reducir los riesgos.
          </p>
        </Seccion>

        <Seccion titulo="9. Tus derechos (ARCO)">
          <p>
            Tienes derecho a acceder, rectificar, cancelar u oponerte al tratamiento de
            tus datos personales, así como a revocar tu consentimiento. Para ejercer
            cualquiera de estos derechos, escríbenos a{' '}
            <span className="font-semibold text-on-surface">{CONTACTO}</span>. También
            puedes eliminar tu cuenta desde la aplicación; al hacerlo se eliminan los datos
            asociados que no debamos conservar por ley.
          </p>
        </Seccion>

        <Seccion titulo="10. Cambios a este aviso">
          <p>
            Podemos actualizar este aviso de privacidad. Cuando haya cambios relevantes,
            actualizaremos la fecha del encabezado y, cuando corresponda, te lo
            notificaremos dentro de la aplicación.
          </p>
        </Seccion>

        <Seccion titulo="11. Contacto">
          <p>
            Si tienes dudas sobre este aviso o sobre el tratamiento de tus datos,
            escríbenos a <span className="font-semibold text-on-surface">{CONTACTO}</span>.
          </p>
        </Seccion>

        <div className="mt-10 pt-6 border-t border-outline-variant">
          <Link to="/" className="text-sm text-accent font-semibold hover:underline">
            ← Volver a Evalúa Fácil
          </Link>
        </div>
      </div>
    </div>
  )
}
