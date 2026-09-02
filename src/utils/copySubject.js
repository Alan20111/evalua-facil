import {
  collection, query, where, getDocs, doc,
  serverTimestamp,
} from 'firebase/firestore'
// Escrituras a través del candado de suscripción vencida (ver ./firestoreGuard.js).
import { addDoc, setDoc, writeBatch } from './firestoreGuard'
import { db } from '../firebase'
import { nowIsoLocal } from './nowIso'
import { camposComunesCopia, nombreParaCopia, esCopiable, esJuego } from './copiaActividad'
import { copiarClaveJuego } from './juegoClave'

function generateAccessCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

// Copies a subject with its activities to a new document.
// If keepStudents=true, copies student list with new activation state.
// Activities are copied as visible (oculta:false), without submissions/grades.
// Evaluaciones (examen/cuestionario) carry their `evaluacion` config and their
// `preguntas` subcollection too — sin eso la copia queda como examen vacío.
// Crucigrama/Sopa de letras llevan `tipoJuego` y su objeto `juego` (ver
// ./copiaActividad.js); los que aún no están confirmados no se copian.
// Returns the new subject's Firestore ID.
export async function copySubject({ sourceSubjectId, nombre, grupo = '', fechaInicio = '', fechaFin = '', parciales, colorPalette = 'default', icon = 'book', keepStudents, docenteId, escuelaId }) {
  // 1. Create new subject doc
  const newSubRef = await addDoc(collection(db, 'subjects'), {
    nombre,
    grupo,
    docenteId,
    escuelaId,
    parciales: Number(parciales) || 3,
    fechaInicio,
    fechaFin,
    colorPalette,
    icon,
    accessCode: generateAccessCode(),
    archived: false,
    createdAt: serverTimestamp(),
  })
  const newSubjectId = newSubRef.id

  // 2. Fetch source activities
  const actsSnap = await getDocs(
    query(collection(db, 'activities'), where('asignaturaId', '==', sourceSubjectId))
  )

  // El orden de las actividades ES parte de la asignatura: la copia tiene que
  // quedar en la MISMA secuencia que el original (el número 1.2., 1.3.… se
  // deriva de la posición). Firestore no garantiza ningún orden al leer, y
  // todas las copias se escriben con el mismo serverTimestamp, así que sin
  // copiar `orden` explícitamente la asignatura duplicada se reacomodaba sola.
  const sourceActs = actsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (
      (a.parcial ?? 0) - (b.parcial ?? 0)
      || (a.orden ?? 0) - (b.orden ?? 0)
      || (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0)
      || a.id.localeCompare(b.id)
    ))
  const ordenPorParcial = {}

  const LIMIT = 490
  let batch = writeBatch(db)
  let ops = 0

  async function flush() {
    if (ops === 0) return
    await batch.commit()
    batch = writeBatch(db)
    ops = 0
  }

  // 3. Copy activities (visible, no extensions, no submissions)
  for (const a of sourceActs) {
    // Un juego sin confirmar no se duplica: sin la reserva de créditos del
    // original (que jamás se copia) la copia no podría confirmarse ni, por
    // tanto, publicarse. Ver esCopiable en ./copiaActividad.js.
    if (!esCopiable(a)) continue
    const ref = doc(collection(db, 'activities'))
    ordenPorParcial[a.parcial] = (ordenPorParcial[a.parcial] || 0) + 1
    const esEvaluacion = a.tipo === 'evaluacion'
    const data = {
      nombre: nombreParaCopia(a),
      // Qué campos viajan (incluidos `tipoJuego` y `juego` de Crucigrama/Sopa
      // de letras, y el reinicio de resultados/respuestas/solución
      // publicadas): ./copiaActividad.js, compartido con los otros dos
      // caminos de copia. La fecha límite se pierde a propósito —
      // `fechaLimite: null` ahí— porque la asignatura nueva tiene su propio
      // fechaInicio/fechaFin y la del ciclo anterior ya pasó.
      ...camposComunesCopia(a),
      parcial: a.parcial,
      orden: ordenPorParcial[a.parcial],
      asignaturaId: newSubjectId,
      docenteId,
      oculta: false,
      publishAt: null,
      // Se crea ya visible (oculta: false) para el grupo nuevo, así que su
      // publicación "real" es este mismo momento — sin esto, `publishedAt`
      // se quedaba en null para siempre (resolveVisibilidad solo lo llena
      // al pasar por el modo 'show', y una actividad copiada nunca pasa por
      // ahí), y el calendario no tenía de dónde sacar su fecha de "Publicada".
      publishedAt: nowIsoLocal(),
      createdAt: serverTimestamp(),
    }

    // A25 — Un juego también tiene subcolección (`clave`, con sus respuestas),
    // así que necesita el mismo trato que una evaluación: crear la actividad y
    // CONFIRMARLA antes de escribir debajo. Por el lote no puede irse, porque
    // la regla de `clave` hace un get() del padre que una escritura del mismo
    // lote todavía no ve.
    const esJuegoDeVerdad = esJuego(a)
    if (!esEvaluacion && !esJuegoDeVerdad) {
      batch.set(ref, data)
      ops++
      if (ops >= LIMIT) await flush()
      continue
    }

    if (esJuegoDeVerdad) {
      await setDoc(ref, data)
      await copiarClaveJuego(a.id, ref.id)
      continue
    }

    // Evaluaciones: la actividad padre se crea y se CONFIRMA antes de escribir
    // sus `preguntas` — la regla de seguridad de la subcolección hace un get()
    // del activity padre, y una escritura del mismo batch todavía no es visible
    // para ese get(). Mismo orden que importActivitiesToSubject.
    await setDoc(ref, data)
    const preSnap = await getDocs(collection(db, 'activities', a.id, 'preguntas'))
    if (!preSnap.empty) {
      const preBatch = writeBatch(db)
      preSnap.docs.forEach((pd) => {
        preBatch.set(doc(collection(db, 'activities', ref.id, 'preguntas')), { ...pd.data() })
      })
      await preBatch.commit()
    }
  }

  // 4. Optionally copy students. Duplicating a subject = the SAME people in a new subject,
  //    so we PRESERVE their identity (username + uid + activado). That keeps the multi-subject
  //    model intact: an already-activated student gets the copied subject in their dashboard
  //    instantly, and others keep the same username they already know. No new credentials.
  if (keepStudents) {
    const studsSnap = await getDocs(
      query(collection(db, 'students'), where('asignaturaId', '==', sourceSubjectId))
    )

    const sorted = studsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))

    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i]
      const ref = doc(collection(db, 'students'))
      batch.set(ref, {
        // Se copia tal cual: duplicar una asignatura no es momento de
        // reescribir cómo el docente capturó los nombres.
        apellidoPaterno: s.apellidoPaterno || '',
        apellidoMaterno: s.apellidoMaterno || '',
        nombre: s.nombre || '',
        username: s.username, // keep the same identity (same Auth account / email)
        resetPassword: null,
        uid: s.uid || null, // inherit the account if the student already activated
        // Su MISMA escuela, no la del parámetro (la escuela ACTUAL del
        // docente) — un alumno dado de alta antes de que el docente
        // eligiera su escuela puede tener un escuelaId distinto al de hoy;
        // copiarlo con el de hoy fracturaba el campo entre inscripciones
        // del mismo alumno (mismo uid, escuelaId inconsistente).
        escuelaId: s.escuelaId || escuelaId,
        asignaturaId: newSubjectId,
        activado: !!s.activado,
        orden: i + 1,
        createdAt: serverTimestamp(),
      })
      ops++
      if (ops >= LIMIT) await flush()
    }
  }

  await flush()
  return newSubjectId
}
