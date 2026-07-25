import {
  addDoc as _addDoc,
  setDoc as _setDoc,
  updateDoc as _updateDoc,
  deleteDoc as _deleteDoc,
  writeBatch as _writeBatch,
} from 'firebase/firestore'

// Punto ÚNICO de control para el trabajo del docente cuando su suscripción
// venció.
//
// Las pantallas del docente escriben en Firestore en más de cien lugares
// (actividades, calificaciones, asistencias, alumnos, recursos, rúbricas…).
// Poner el candado en cada uno sería un diff enorme y, sobre todo, frágil:
// bastaría olvidar uno para dejar un hueco. En vez de eso, esas pantallas
// importan las funciones de escritura DESDE AQUÍ en lugar de 'firebase/firestore'
// —mismos nombres, misma firma, cero cambios en las llamadas— y este módulo
// las deja pasar o no.
//
// Solo se importa desde las pantallas del docente: lo del estudiante, lo del
// admin y el propio Perfil (donde se paga) escriben directo, sin candado.
//
// Leer NUNCA pasa por aquí: consultar y exportar siguen libres siempre.

// Lo pone TeacherLayout con el estado real de la suscripción. Mientras nadie
// lo defina, no se bloquea nada — el candado tiene que ser algo que se
// enciende a propósito, no el estado por omisión.
let estaVencida = () => false
let avisar = null

export function configurarBloqueoEscritura({ vencida, onIntento }) {
  estaVencida = vencida || (() => false)
  avisar = onIntento || null
}

export class SuscripcionVencidaError extends Error {
  constructor() {
    super('Tu suscripción venció. Actívala para seguir trabajando; mientras tanto puedes consultar y descargar toda tu información.')
    this.name = 'SuscripcionVencidaError'
    this.code = 'suscripcion/vencida'
  }
}

// Además de cortar la escritura, avisa hacia arriba para que la ventana de
// pago vuelva a aparecer: el docente acaba de intentar trabajar, ese es el
// momento exacto de mostrarle cómo seguir.
function revisar() {
  if (!estaVencida()) return
  avisar?.()
  throw new SuscripcionVencidaError()
}

export function addDoc(...args) { revisar(); return _addDoc(...args) }
export function setDoc(...args) { revisar(); return _setDoc(...args) }
export function updateDoc(...args) { revisar(); return _updateDoc(...args) }
export function deleteDoc(...args) { revisar(); return _deleteDoc(...args) }

// El lote se arma sin problema; lo que se revisa es el commit, que es cuando
// de verdad se escribe. Así el candado no depende de dónde se creó el batch.
export function writeBatch(db) {
  const batch = _writeBatch(db)
  const commitOriginal = batch.commit.bind(batch)
  batch.commit = (...args) => {
    revisar()
    return commitOriginal(...args)
  }
  return batch
}
