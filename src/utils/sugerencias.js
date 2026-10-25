// «Sugerencia a Evalúa Fácil» (24-oct-2026): lo que docentes y estudiantes
// quieren decirle a la plataforma. Cada una es un documento de
// `sugerencias`, que solo crea su autor y solo lee el admin
// (firestore.rules). El correo al admin lo manda la Cloud Function
// avisosReportes. Los límites de aquí son los mismos que validan las reglas:
// si cambian, cambian en los dos lados.
//
// También vive aquí cómo se nombra la pantalla en la que está la persona
// (`ubicacionDeRuta`): la persona no tiene que saber cómo se llama, la app la
// registra sola. La usan las sugerencias y los Reportes de IA.
import { collection, serverTimestamp } from 'firebase/firestore'
import { addDoc } from './firestoreGuard'
import { db } from '../firebase'

export { CATEGORIAS_SUGERENCIA } from './catalogoReportes'

export const LARGO_MAX_DESCRIPCION_SUGERENCIA = 2000

// Pantallas con nombre. El orden importa: la primera que coincide gana.
const PANTALLAS = [
  [/^\/dashboard$/, 'Docente', 'Inicio'],
  [/^\/subject\/[^/]+$/, 'Docente', 'Asignatura'],
  [/^\/activity\/[^/]+$/, 'Docente', 'Actividad'],
  [/^\/participacion\/[^/]+$/, 'Docente', 'Participación en vivo'],
  [/^\/proyeccion-vivo\/[^/]+$/, 'Docente', 'Proyección de participación en vivo'],
  [/^\/calendario$/, 'Docente', 'Calendario'],
  [/^\/profile$/, 'Docente', 'Mi perfil'],
  [/^\/perfil-ia$/, 'Docente', 'Perfil para IA del docente'],
  [/^\/notificaciones$/, 'Docente', 'Notificaciones'],
  [/^\/ayuda$/, 'Docente', 'Ayuda para comenzar'],
  [/^\/alumno\/dashboard$/, 'Estudiante', 'Inicio'],
  [/^\/alumno\/materia\/[^/]+$/, 'Estudiante', 'Asignatura'],
  [/^\/alumno\/actividad\/[^/]+$/, 'Estudiante', 'Actividad'],
  [/^\/alumno\/evaluacion\/[^/]+\/revision$/, 'Estudiante', 'Revisión de examen o cuestionario'],
  [/^\/alumno\/evaluacion\/[^/]+$/, 'Estudiante', 'Examen o cuestionario'],
  [/^\/alumno\/juego\/[^/]+$/, 'Estudiante', 'Juego'],
  [/^\/alumno\/participacion\/[^/]+$/, 'Estudiante', 'Participación en vivo'],
  [/^\/alumno\/notificaciones$/, 'Estudiante', 'Notificaciones'],
  [/^\/alumno\/agenda$/, 'Estudiante', 'Agenda'],
  [/^\/alumno\/perfil$/, 'Estudiante', 'Mi perfil'],
  [/^\/alumno\/tips$/, 'Estudiante', 'Tips'],
  [/^\/alumno\/mi-espacio$/, 'Estudiante', 'Mi espacio'],
  [/^\/admin$/i, 'Administración', 'Panel de administración'],
]

// La ruta sin ids (mismo criterio que src/utils/registroErrores.js): el admin
// ve en qué pantalla pasó sin que viaje el id de nada.
export function rutaSinIds(pathname) {
  return String(pathname || '/')
    .split('/')
    .map((s) => (/^[A-Za-z0-9_-]{15,}$/.test(s) ? ':id' : s))
    .join('/')
    .slice(0, 120)
}

// { modulo, pantalla } de la ruta. Si la ruta no está en la lista, la
// pantalla queda vacía: no se adivina.
export function ubicacionDeRuta(pathname) {
  const ruta = String(pathname || '/')
  const hallada = PANTALLAS.find(([re]) => re.test(ruta))
  if (hallada) return { modulo: hallada[1], pantalla: hallada[2] }
  const modulo = ruta.startsWith('/alumno') ? 'Estudiante' : ''
  return { modulo, pantalla: '' }
}

// Los ids que la propia URL dice: la asignatura en /subject/:id y la
// actividad en /activity/:id (pantallas del docente). Sirven a los Reportes de
// IA cuando el componente no los tiene a mano; el servidor comprueba que sean
// del docente que reporta antes de nombrarlos.
export function idsDeRuta(pathname) {
  const ruta = String(pathname || '')
  const asignatura = ruta.match(/^\/subject\/([^/]+)$/)
  if (asignatura) return { asignaturaId: asignatura[1] }
  const actividad = ruta.match(/^\/activity\/([^/]+)$/)
  if (actividad) return { actividadId: actividad[1] }
  return {}
}

export function rolParaRegistro(userProfile) {
  return userProfile?.role === 'docente' || userProfile?.role === 'admin' ? userProfile.role : 'alumno'
}

export async function enviarSugerencia({ uid, rol, categoria, descripcion, pathname }) {
  const { modulo, pantalla } = ubicacionDeRuta(pathname)
  await addDoc(collection(db, 'sugerencias'), {
    uid,
    rol,
    categoria,
    descripcion: String(descripcion || '').trim().slice(0, LARGO_MAX_DESCRIPCION_SUGERENCIA),
    ruta: rutaSinIds(pathname),
    pantalla: pantalla.slice(0, 80),
    modulo: modulo.slice(0, 80),
    estado: 'nuevo',
    creadoEn: serverTimestamp(),
  })
}
