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
  // CCT (`claveSEP`): la clave oficial del plantel; AuthContext la carga junto
  // con el nombre. Solo se imprime si hay escuela — sin plantel no hay CCT.
  const cct = escuela ? (userProfile?.claveSEP || '') : ''
  return { escuela, cct, docente: teacherDisplayName(userProfile) }
}

// "CBTIS 255 · CCT: 19DCT0255X" — la escuela con su clave, como la pide una
// dirección para aceptar el documento como oficial.
export function escuelaConCct(membrete) {
  if (!membrete?.escuela) return ''
  return membrete.cct ? `${membrete.escuela} · CCT: ${membrete.cct}` : membrete.escuela
}

// Una sola línea con lo que haya: "CBTIS 255 · CCT: 19DCT0255X · Docente: Ing.
// Ana Ruiz · Ciclo Escolar 2025-2026". Para el Excel, donde no hay dos tamaños
// de letra que jerarquicen como en el PDF. `ciclo` sale de cicloEscolarDe().
export function membreteLinea(membrete, ciclo = '') {
  return [
    escuelaConCct(membrete),
    membrete?.docente ? `Docente: ${membrete.docente}` : '',
    ciclo ? `Ciclo Escolar ${ciclo}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}
