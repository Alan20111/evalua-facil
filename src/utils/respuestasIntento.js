import { writeBatch } from 'firebase/firestore'

// A26 · A qué intento pertenece cada respuesta.
//
// Una submission tiene UN documento por pregunta en `respuestas/`, y ese
// documento lo comparten todos los intentos: el historial de intentos vive en
// `submission.intentos` (lo escribe solo el servidor) y aquí no se replica.
// Por eso, al abrir un intento nuevo, las respuestas del anterior se limpian
// — poner los campos en null es lo que las convierte en "sin responder".
//
// Esa limpieza puede fallar (la red, la pestaña que se cierra a media
// operación) y entonces el intento nuevo arrancaría con las respuestas del
// anterior puestas: el estudiante vería su examen pre-llenado y, peor, el
// servidor calificaría esas respuestas viejas como si fueran las de este
// intento.
//
// No hace falta un campo nuevo ni cambiar el modelo para distinguirlas: cada
// respuesta ya guarda `respondidaEn`, y la submission ya guarda `tiempoInicio`,
// que se reinicia en CADA intento. Lo guardado antes de que arrancara el
// intento en curso es, por definición, del intento anterior.

function aMillis(valor) {
  if (!valor) return null
  if (typeof valor.toMillis === 'function') return valor.toMillis()
  if (typeof valor.seconds === 'number') {
    return valor.seconds * 1000 + Math.floor((valor.nanoseconds || 0) / 1e6)
  }
  if (valor instanceof Date) return valor.getTime()
  return null
}

// Regla 1.2 en las dos salidas: un dato que falta NO deja a nadie fuera. Sin
// `tiempoInicio` no hay con qué comparar, y sin `respondidaEn` la respuesta es
// de origen desconocido — en ambos casos se respeta lo que el estudiante
// escribió antes que descartarlo por una sospecha.
export function esDeIntentoAnterior(data, tiempoInicio) {
  const inicio = aMillis(tiempoInicio)
  if (inicio == null) return false
  const respondida = aMillis(data?.respondidaEn)
  if (respondida == null) return false
  return respondida < inicio
}

const conValor = (v) => v !== null && v !== undefined && v !== ''

// Si todos los campos de respuesta están vacíos, el documento ya está limpio:
// no hay nada que ocultar ni nada que volver a limpiar.
export function tieneRespuestaGuardada(data) {
  return conValor(data?.opcionSeleccionada) ||
    conValor(data?.textoRespuesta) ||
    conValor(data?.archivoURL) ||
    conValor(data?.otraTexto)
}

// Lo que deja un documento de respuesta en "sin responder". No toca
// `puntosObtenidos` ni `correcta` — esos los escribe solo el servidor (las
// reglas se lo prohíben al estudiante) y los reescribe entero en cada entrega.
export const CAMPOS_SIN_RESPONDER = {
  opcionSeleccionada: null,
  textoRespuesta: null,
  otraTexto: null,
  archivoURL: null,
  nombreArchivo: null,
  tamanoArchivo: null,
}

// Deja "sin responder" las respuestas de los documentos indicados. Con
// reintento: la limpieza es el paso del que depende que el intento nuevo
// empiece en blanco, y un tropiezo de red no debería costarle el intento al
// estudiante. Es idempotente — volver a limpiar algo ya limpio no hace daño.
//
// OJO con el orden de quien la llame: escribir en `respuestas` exige estar
// DENTRO del plazo (`dentroDelPlazo` en firestore.rules), y el plazo se mide
// contra el `tiempoInicio` de la submission. Hay que reiniciar el intento
// —y con él el reloj— ANTES de limpiar, o el servidor rechaza la limpieza con
// permission-denied por un cronómetro que ya no es el que corre.
export async function limpiarRespuestas(db, refs, { reintentos = 2, esperaMs = 400 } = {}) {
  if (!refs.length) return
  let ultimoError = null
  for (let intento = 0; intento <= reintentos; intento++) {
    try {
      const batch = writeBatch(db)
      refs.forEach((ref) => batch.set(ref, CAMPOS_SIN_RESPONDER, { merge: true }))
      await batch.commit()
      return
    } catch (err) {
      ultimoError = err
      if (intento < reintentos) {
        await new Promise((r) => setTimeout(r, esperaMs * (intento + 1)))
      }
    }
  }
  throw ultimoError
}
