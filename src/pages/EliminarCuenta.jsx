import { Link } from 'react-router-dom'
import EFLogo from '../components/EFLogo'

// Cómo eliminar una cuenta — página pública (ruta /eliminar-cuenta), sin
// sesión. Google Play pide, además del botón dentro de la app, una dirección
// web que funcione sin instalarla; es la que va en el formulario de
// Seguridad de los datos (docs/PLAN_GOOGLE_PLAY.md, B4). Contenido estático,
// con el mismo formato que Privacidad.jsx.
//
// Lo que se borra sale de EliminarCuentaModal.jsx (docente) y de
// EliminarCuentaAlumnoModal.jsx (alumno): si cambian, cambia esta página.
const CONTACTO = 'soporte@evaluafacil.mx'
const ASUNTO = encodeURIComponent('Eliminar mi cuenta de Evalúa Fácil')

function Seccion({ titulo, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-on-surface mb-2">{titulo}</h2>
      <div className="text-sm text-muted leading-relaxed space-y-3">{children}</div>
    </section>
  )
}

function Ruta({ children }) {
  return <span className="font-semibold text-on-surface">{children}</span>
}

export default function EliminarCuenta() {
  return (
    <div className="min-h-dvh bg-surface py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to="/" className="inline-block mb-6">
          <EFLogo className="w-44 h-auto" />
        </Link>

        <h1 className="text-2xl font-bold text-on-surface">Eliminar tu cuenta de Evalúa Fácil</h1>

        <p className="text-sm text-muted leading-relaxed mt-6">
          Puedes eliminar tu cuenta en cualquier momento desde la aplicación (web o
          Android) o pidiéndonoslo por correo. Eliminarla es definitivo: no se puede
          deshacer.
        </p>

        <Seccion titulo="Si eres docente">
          <ol className="list-decimal pl-5 space-y-1">
            <li>Inicia sesión en Evalúa Fácil.</li>
            <li>Entra a <Ruta>Perfil › Perfil › Cuenta</Ruta>.</li>
            <li>Toca <Ruta>Eliminar mi cuenta</Ruta>, escribe ELIMINAR y confirma con tu contraseña o con Google.</li>
          </ol>
          <p>Se borra para siempre:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>tus asignaturas y sus estudiantes;</li>
            <li>actividades, entregas y calificaciones;</li>
            <li>asistencias y tu horario;</li>
            <li>tus bancos de reactivos y rúbricas;</li>
            <li>tu saldo de créditos y tu historial de pagos;</li>
            <li>tu cuenta de acceso.</li>
          </ul>
          <p>Tus estudiantes pierden el acceso a las calificaciones de tus asignaturas.</p>
        </Seccion>

        <Seccion titulo="Si eres estudiante">
          <ol className="list-decimal pl-5 space-y-1">
            <li>Inicia sesión en Evalúa Fácil.</li>
            <li>Entra a <Ruta>Perfil › Perfil › Cuenta</Ruta>.</li>
            <li>Toca <Ruta>Eliminar mi cuenta</Ruta>, escribe ELIMINAR y confirma con tu contraseña.</li>
          </ol>
          <p>
            La opción aparece cuando ya no estás inscrito en ninguna asignatura. Mientras
            lo estés, tus calificaciones forman parte del registro de tu docente: pídele
            que te dé de baja, o escríbenos (abajo).
          </p>
          <p>Se borra tu usuario, tu foto de perfil y tus notificaciones.</p>
        </Seccion>

        <Seccion titulo="Si ya no puedes entrar a la aplicación">
          <p>
            Escríbenos desde el correo de tu cuenta (o, si eres estudiante, indica tu
            nombre de usuario, tu escuela y tu docente) a{' '}
            <a
              href={`mailto:${CONTACTO}?subject=${ASUNTO}`}
              className="font-semibold text-accent hover:underline"
            >
              {CONTACTO}
            </a>
            . Comprobamos que la cuenta es tuya y te respondemos en un plazo máximo de
            20 días hábiles, como marca la ley para los derechos ARCO. Padres, madres o tutores pueden pedir lo mismo para un estudiante.
          </p>
        </Seccion>

        <Seccion titulo="Qué se conserva y por cuánto tiempo">
          <p>
            Al eliminar la cuenta se borran sus datos de inmediato. Las copias de
            respaldo técnicas del servicio pueden conservarlos por un tiempo limitado,
            hasta que se sobrescriben. Solo conservamos lo que la ley nos obligue a guardar (por ejemplo, comprobantes
            fiscales de pagos) y únicamente por el plazo que la ley señale.
          </p>
        </Seccion>

        <p className="text-sm text-muted leading-relaxed mt-8">
          Más detalles en el{' '}
          <Link to="/privacidad" className="font-semibold text-accent hover:underline">
            aviso de privacidad
          </Link>
          .
        </p>

        <div className="mt-10 pt-6 border-t border-outline-variant">
          <Link to="/" className="text-sm text-accent font-semibold hover:underline">
            ← Volver a Evalúa Fácil
          </Link>
        </div>
      </div>
    </div>
  )
}
