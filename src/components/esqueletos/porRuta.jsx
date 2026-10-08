// Qué esqueleto corresponde a cada ruta. Lo usan AuthContext (mientras se
// resuelve la sesión) y App.jsx (mientras llega el código de la página).
import { ContenidoDocente, EsqueletoAsignaturaAlumno, EsqueletoSesion, EsqueletoTableroAlumno } from '.'

const RUTAS_DOCENTE = ['/dashboard', '/subject/', '/activity/', '/profile', '/perfil-ia', '/calendario', '/notificaciones', '/ayuda']

const contenidoDocente = (pathname) =>
  pathname.startsWith('/subject/') ? 'asignatura' : pathname.startsWith('/activity/') ? 'actividad' : 'tablero'

// Pantalla completa (con barras). En las rutas públicas no se pinta nada.
export function esqueletoDeSesion(pathname) {
  if (pathname.startsWith('/alumno/')) {
    return <EsqueletoSesion rol="alumno" contenido={pathname.startsWith('/alumno/materia/') ? 'asignatura' : 'tablero'} />
  }
  if (!RUTAS_DOCENTE.some((r) => pathname === r || pathname.startsWith(r))) return null
  return <EsqueletoSesion contenido={contenidoDocente(pathname)} />
}

// Solo el contenido, para dentro del TeacherLayout (las barras ya están).
export function esqueletoDeContenidoDocente(pathname) {
  return <ContenidoDocente contenido={contenidoDocente(pathname)} />
}

// Alumno: sus páginas no comparten layout, así que va la pantalla completa.
export function esqueletoDeAlumno(pathname) {
  return pathname.startsWith('/alumno/materia/') ? <EsqueletoAsignaturaAlumno /> : <EsqueletoTableroAlumno />
}
