// La clave de respuestas de una evaluación vive APARTE del reactivo.
//
// Por qué (A08, 6-ago-2026): las reglas de Firestore no pueden filtrar campos.
// Mientras `respuestaCorrecta` estuvo dentro de `activities/{id}/preguntas/{pid}`,
// cualquiera con sesión la leía — y no hacía falta un cliente modificado: el
// runner del alumno YA descargaba los documentos completos y luego no usaba ese
// campo ni una vez. Bastaba con abrir las herramientas del navegador.
//
// El reparto es el arreglo de fondo: el reactivo se queda con lo que el alumno
// necesita para contestar (enunciado, opciones, imagen) y la clave se va a
// `activities/{id}/clave/{pid}`, que las reglas solo le abren al docente dueño.
// El servidor califica leyendo de ahí con el Admin SDK, y al alumno le llega el
// veredicto —si acertó, y la correcta solo si el docente publicó las
// respuestas— dentro de su propia respuesta. Ver `onEvaluacionFinalizada`.
//
// Este módulo existe para que ese reparto se haga en UN solo lugar: hay nueve
// sitios que crean o editan reactivos entre EvaluacionEditor y
// EvaluacionManager, y con la lógica repetida nueve veces basta olvidarla una
// para reabrir el agujero.
// Las escrituras entran por `firestoreGuard`, NO por 'firebase/firestore': es
// el candado de suscripción de las pantallas del docente, y saltárselo aquí
// habría dejado un hueco por el que un docente con la suscripción vencida
// seguiría editando reactivos. Leer no pasa por el candado nunca (consultar y
// exportar siguen libres), así que `getDocs` sí viene de Firestore.
import { collection, doc, getDocs } from 'firebase/firestore'
import { setDoc, deleteDoc, writeBatch } from './firestoreGuard'
import { db } from '../firebase'

const preguntasRef = (activityId) => collection(db, 'activities', activityId, 'preguntas')
const claveRef = (activityId, preguntaId) => doc(db, 'activities', activityId, 'clave', preguntaId)

/**
 * Separa un reactivo en lo que el alumno puede ver y lo que no.
 * Devuelve `{ publico, clave }` — `clave` trae `respuestaCorrecta` (null si
 * la pregunta no tiene una, como las abiertas que revisa el docente a mano) y
 * `respuestaEsperada` (solo respuesta_corta generada por OP-09: una guía de
 * calificación para el docente — el alumno nunca la ve, así que vive aquí,
 * igual que respuestaCorrecta, y no en el documento público).
 */
export function partirPregunta(data) {
  const { respuestaCorrecta = null, respuestaEsperada = null, ...publico } = data
  return { publico, clave: { respuestaCorrecta: respuestaCorrecta ?? null, respuestaEsperada: respuestaEsperada ?? null } }
}

/** Crea un reactivo. Devuelve su id. */
export async function crearPregunta(activityId, data) {
  const { publico, clave } = partirPregunta(data)
  const ref = doc(preguntasRef(activityId))
  await setDoc(ref, publico)
  // La clave se escribe SIEMPRE, incluso en null: así el documento existe y
  // el docente ve el reactivo completo aunque después le quiten la respuesta.
  await setDoc(claveRef(activityId, ref.id), clave)
  return ref.id
}

/** Edita un reactivo existente, respetando el reparto. */
export async function actualizarPregunta(activityId, preguntaId, data) {
  const { publico, clave } = partirPregunta(data)
  await setDoc(doc(db, 'activities', activityId, 'preguntas', preguntaId), publico, { merge: true })
  if ('respuestaCorrecta' in data || 'respuestaEsperada' in data) {
    await setDoc(claveRef(activityId, preguntaId), clave, { merge: true })
  }
}

/** Borra un reactivo y su clave: si la clave se quedara, sería un huérfano. */
export async function borrarPregunta(activityId, preguntaId) {
  await deleteDoc(doc(db, 'activities', activityId, 'preguntas', preguntaId))
  await deleteDoc(claveRef(activityId, preguntaId)).catch(() => {})
}

/** Crea varios reactivos de un golpe (importar del banco / generar con IA). Devuelve sus ids. */
export async function crearPreguntasEnLote(activityId, lista) {
  const batch = writeBatch(db)
  const ids = []
  for (const data of lista) {
    const { publico, clave } = partirPregunta(data)
    const ref = doc(preguntasRef(activityId))
    batch.set(ref, publico)
    batch.set(claveRef(activityId, ref.id), clave)
    ids.push(ref.id)
  }
  await batch.commit()
  return ids
}

/**
 * Carga los reactivos CON su clave. Solo funciona para el docente dueño — a
 * cualquier otro las reglas le niegan la subcolección `clave`, que es
 * justamente el punto.
 */
export async function cargarPreguntasConClave(activityId) {
  const [pregSnap, claveSnap] = await Promise.all([
    getDocs(preguntasRef(activityId)),
    getDocs(collection(db, 'activities', activityId, 'clave')),
  ])
  const claves = {}
  claveSnap.docs.forEach((d) => { claves[d.id] = d.data() || {} })
  return pregSnap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    respuestaCorrecta: claves[d.id]?.respuestaCorrecta ?? null,
    respuestaEsperada: claves[d.id]?.respuestaEsperada ?? null,
  }))
}
