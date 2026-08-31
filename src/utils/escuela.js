// Regla de negocio (30-ago-2026): TODO DOCENTE PERTENECE A UNA ESCUELA.
//
// Antes la escuela era opcional: quien no la elegía caía en un documento
// centinela compartido, `schools/sin-escuela`. Ese centinela resultó ser un
// bote común — 17 docentes distintos "en la misma escuela" — y con él se
// rompía todo lo que se apoya en la escuela: la identidad del alumno (su
// cuenta ES `usuario.escuela@evalua.local`), el que dos docentes del mismo
// plantel se encuentren al mismo estudiante, y el aislamiento entre escuelas.
//
// Hacia adelante ya no se puede crear: el registro exige elegir una escuela
// real (o darla de alta si no está en el catálogo, sin necesidad de saberse la
// Clave del Centro de Trabajo). Las cuentas viejas que quedaron en el
// centinela NO se tocan: el guard de rutas las manda a completarlo ellas
// mismas, con la escuela que solo el docente conoce.
export const CENTINELA_SIN_ESCUELA = 'sin-escuela'

// ¿Este escuelaId apunta a una escuela DE VERDAD? Falso para ausente, vacío y
// para el centinela histórico. Es la única prueba que debe usarse antes de
// dejar a un docente operar.
export function escuelaValida(escuelaId) {
  return typeof escuelaId === 'string'
    && escuelaId.trim() !== ''
    && escuelaId !== CENTINELA_SIN_ESCUELA
}

// ¿A este perfil de docente le falta la escuela? (Solo aplica a docentes: los
// admins no tienen plantel, y los alumnos ni siquiera viven en `users`.)
export function docenteSinEscuela(userProfile) {
  return userProfile?.role === 'docente' && !escuelaValida(userProfile?.escuelaId)
}
