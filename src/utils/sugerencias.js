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
//
// Límite de frecuencia (PR 3): cada sugerencia se escribe en la MISMA
// transacción que el avance de `sugerenciasCuota/{uid}`. Quien manda es la
// regla de firestore.rules, con la hora del servidor; aquí solo se calcula el
// siguiente estado y se avisa antes de intentar si ya se sabe que no toca.
import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

export { CATEGORIAS_SUGERENCIA } from './catalogoReportes'

export const LARGO_MAX_DESCRIPCION_SUGERENCIA = 2000
export const SEGUNDOS_ENTRE_SUGERENCIAS = 30
export const MAX_SUGERENCIAS_POR_DIA = 10
const VENTANA_MS = 24 * 60 * 60 * 1000

// Error con código para la ventana: 'espera' (menos de 30 s desde la última)
// o 'tope' (ya van 10 en 24 h).
export class LimiteSugerencias extends Error {
  constructor(codigo) {
    super(codigo)
    this.codigo = codigo
  }
}

function millis(t) {
  return t?.toMillis?.() ?? 0
}

// Siguiente estado de la cuota a partir del que hay (o de ninguno). `ahora`
// es la hora del dispositivo: si va desfasada, la regla del servidor tiene la
// última palabra y el envío se rechaza sin daño.
export function siguienteCuota(previa, idSugerencia, ahora = Date.now()) {
  const nueva = { ultimoEnvio: serverTimestamp(), ultimaSugerencia: idSugerencia }
  if (!previa) return { ...nueva, ventanaInicio: serverTimestamp(), enviadas: 1 }
  if (ahora - millis(previa.ultimoEnvio) <= SEGUNDOS_ENTRE_SUGERENCIAS * 1000) throw new LimiteSugerencias('espera')
  if (ahora - millis(previa.ventanaInicio) >= VENTANA_MS) return { ...nueva, ventanaInicio: serverTimestamp(), enviadas: 1 }
  if ((previa.enviadas || 0) >= MAX_SUGERENCIAS_POR_DIA) throw new LimiteSugerencias('tope')
  return { ...nueva, ventanaInicio: previa.ventanaInicio, enviadas: (previa.enviadas || 0) + 1 }
}

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
  const sugerenciaRef = doc(collection(db, 'sugerencias'))
  const cuotaRef = doc(db, 'sugerenciasCuota', uid)
  await runTransaction(db, async (tx) => {
    const previa = await tx.get(cuotaRef)
    const cuota = siguienteCuota(previa.exists() ? previa.data() : null, sugerenciaRef.id)
    tx.set(sugerenciaRef, {
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
    tx.set(cuotaRef, cuota)
  })
}
