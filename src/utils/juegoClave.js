// A25 — La respuesta de un juego vive APARTE del documento de la actividad.
//
// Por qué (ver DOCUMENTACION/INVENTARIO_DEL_SISTEMA.md § A25): las reglas de
// Firestore no filtran CAMPOS, solo DOCUMENTOS. Mientras `palabra`,
// `normalizada` y el `grid` resuelto vivieran dentro de `activities/{id}` —que
// cualquier cuenta con sesión puede leer— el alumno los tenía descargados antes
// de empezar a jugar. Es el mismo agujero que A08 cerró en las evaluaciones, y
// se cierra con el mismo reparto:
//
//   activities/{id}.juego.estructura   → PÚBLICA: geometría + pistas
//   activities/{id}/clave/juego        → PRIVADA: letras, palabra, normalizada
//   activities/{id}/clave/contenido    → PRIVADA: el juego.contenido de antes
//
// `clave/{docId}` solo la abre el docente dueño (regla ya existente desde A08),
// así que el alumno recibe un 'permission-denied' si intenta leerla. El
// servidor las vuelve a juntar con el Admin SDK para calificar.
//
// ── Este módulo existe para que el reparto se haga en UN solo lugar ─────────
// Lo mismo que src/utils/evaluacionClave.js hace con los reactivos: hay cuatro
// pantallas del docente, tres caminos de copia y una pantalla del alumno que
// tocan estos datos, y con la lógica repetida basta olvidarla una vez para
// reabrir el agujero.
//
// ── Compatibilidad durante la transición ───────────────────────────────────
// La app de Android empaqueta su propia copia de `dist` y no hay candado de
// versión mínima: un APK instalado ejecuta para siempre el frontend con el que
// se compiló. Por eso este módulo trabaja con TRES formas a la vez y ninguna
// función suya pregunta en qué fase estamos:
//
//   A) Heredado — respuestas dentro de la estructura pública, sin clave.
//   B) Migrado  — estructura pública sin respuestas + clave privada.
//   C) Nuevo con `compatibilidadLegacy: true` — las dos cosas a la vez.
//
// Las escrituras van por `firestoreGuard`, el punto único de paso de las
// escrituras del docente. Leer nunca pasa por ahí.
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { debeEscribirContenidoEmbebido } from './juegoReparto'
import { setDoc, updateDoc } from './firestoreGuard'
import { db } from '../firebase'

const claveRef = (activityId, docId) => doc(db, 'activities', activityId, 'clave', docId)

// Las decisiones puras viven en ./juegoReparto.js (sin red ni DOM, probadas en
// test/unidad.test.mjs) y se reexportan aquí para que quien use este módulo
// tenga todo el reparto a mano en un solo import.
export { esEstructuraHeredada, estructuraConClave, debeEscribirContenidoEmbebido } from './juegoReparto'

// ─── Lectura ───────────────────────────────────────────────────────────────

/** La clave del tablero, o null si este juego todavía no la tiene (heredado). */
export async function cargarClaveJuego(activityId) {
  const snap = await getDoc(claveRef(activityId, 'juego'))
  return snap.exists() ? snap.data() : null
}

/**
 * La lista de palabras del docente.
 *
 * Precedencia: el embebido gana cuando existe. Un frontend viejo solo sabe
 * escribir ahí, así que mientras ese campo exista es el más fresco de los dos.
 * Cuando desaparece (juego migrado o nacido limpio) la única fuente es la
 * clave.
 */
export async function cargarContenidoJuego(activityId, activity) {
  if (debeEscribirContenidoEmbebido(activity)) return activity.juego.contenido
  const snap = await getDoc(claveRef(activityId, 'contenido'))
  const contenido = snap.exists() ? snap.data()?.contenido : null
  return Array.isArray(contenido) ? contenido : []
}

// ─── Escritura ─────────────────────────────────────────────────────────────

/**
 * Guarda la lista de palabras respetando el reparto.
 *
 * `clave/contenido` SIEMPRE — es la fuente de verdad nueva. `juego.contenido`
 * solo si ya existía (ver `debeEscribirContenidoEmbebido`).
 */
export async function guardarContenidoJuego(activityId, activity, contenido) {
  await setDoc(claveRef(activityId, 'contenido'), { contenido })
  await updateDoc(doc(db, 'activities', activityId), {
    ...(debeEscribirContenidoEmbebido(activity) ? { 'juego.contenido': contenido } : {}),
    'juego.estado': 'contenido_editado',
  })
}

/**
 * Copia la clave de un juego a la actividad copiada.
 *
 * Sin esto, una copia de un juego ya migrado nacería con la estructura pública
 * enmascarada y SIN respuestas: imposible de calificar. Los tres caminos de
 * copia (duplicar dentro de la asignatura, traer de otra, duplicar la
 * asignatura entera) llaman aquí.
 *
 * La actividad destino tiene que EXISTIR ya: la regla de `clave` hace un get()
 * del padre, y una escritura del mismo lote todavía no es visible para ese
 * get(). Mismo orden que ya usan las tres con `preguntas`.
 *
 * Un juego heredado no tiene clave: no hay nada que copiar y no es un error.
 */
export async function copiarClaveJuego(origenId, destinoId) {
  const snap = await getDocs(collection(db, 'activities', origenId, 'clave'))
  if (snap.empty) return 0
  await Promise.all(snap.docs.map((d) => setDoc(claveRef(destinoId, d.id), d.data())))
  return snap.size
}
