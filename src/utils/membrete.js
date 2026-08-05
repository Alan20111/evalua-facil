// Membrete de los documentos que genera el docente (PDF y Excel): la escuela y
// su nombre. Un reporte que sale de aquí termina impreso, enviado por correo o
// entregado en dirección, y ahí "Cultura Digital I — 1A" solo no dice de qué
// escuela ni de qué maestro es.
//
// La escuela sale del perfil del docente (`schoolName`, que AuthContext resuelve
// desde `schools/{escuelaId}`), no de la asignatura: es la misma para todas sus
// materias. `'Sin escuela'` es el valor que AuthContext deja cuando el docente
// todavía no eligió plantel — no es el nombre de ninguna escuela, así que no se
// imprime (queda el documento con el nombre del docente y nada más).
import { teacherDisplayName } from './studentSearch'

const SIN_ESCUELA = 'Sin escuela'

export function membreteDe(userProfile) {
  const escuela = userProfile?.schoolName && userProfile.schoolName !== SIN_ESCUELA
    ? userProfile.schoolName
    : ''
  return { escuela, docente: teacherDisplayName(userProfile) }
}

// Una sola línea con lo que haya: "CBTIS 255 · Docente: Ing. Ana Ruiz". Para el
// Excel, donde no hay dos tamaños de letra que jerarquicen como en el PDF.
export function membreteLinea(membrete) {
  return [membrete?.escuela, membrete?.docente ? `Docente: ${membrete.docente}` : '']
    .filter(Boolean)
    .join(' · ')
}
