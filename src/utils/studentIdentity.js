// Student identity helpers for the multi-subject model.
//
// A real student can be enrolled in several subjects. Each enrollment is its own `students`
// doc, but they must all share ONE identity: the same `username` (hence the same fake email
// `username.escuelaId@evalua.local` and the same Firebase Auth `uid`). Otherwise the student
// ends up with several accounts and only ever sees one subject per session.
//
// To keep identity stable per (school + person) we match by normalized full name.

function clean(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
}

// A stable key for a person within a school (case/accents-insensitive full name).
export function studentNameKey(p) {
  return `${clean(p.apellidoPaterno)}|${clean(p.apellidoMaterno)}|${clean(p.nombre)}`
}

// ── Nombres "parecidos": el mismo nombre escrito distinto ────────────────
//
// studentNameKey compara EXACTO a propósito, y así debe seguir. Pero un
// carácter de diferencia en la captura basta para que el sistema crea que son
// dos personas y le fabrique a la misma alumna una segunda cuenta, con su
// propia contraseña y sin manera de restablecerla (el reset exige un uid que
// esa cuenta nunca tuvo). Pasó de verdad: "EVELYN GUADALUPE" en una asignatura
// y "Evelin Guadalupe" en otra — sus seis compañeros de grupo conservaron su
// usuario en las dos, solo ella se partió en dos.
//
// Esto NO fusiona a nadie: solo detecta la duda para que el docente la
// resuelva, igual que ya hace el caso de nombre idéntico. Por eso las reglas
// son estrechas — un falso positivo cuesta una pregunta, pero una regla laxa
// que uniera a dos hermanos costaría el expediente de los dos.
//
// La línea que separa "escrito distinto" de "otra persona" es dónde cae la
// diferencia. Los hermanos se distinguen por la ÚLTIMA letra (Mario/María,
// Roberto/Roberta, Daniel/Daniela, Luis/Luisa); las variantes de escritura de
// un mismo nombre caen en medio (Evelin/Evelyn, Jazmín/Yazmín, Vanesa/Vanessa,
// Cinthia/Cynthia). Todas las reglas de abajo excluyen el final.

function posicionesDistintas(a, b) {
  const out = []
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i)
  return out
}

function primeraDiferencia(corto, largo) {
  let i = 0
  while (i < corto.length && corto[i] === largo[i]) i++
  return i
}

// `a` y `b` ya vienen limpios (sin acentos, sin espacios, MAYÚSCULAS).
export function esNombreParecido(a, b) {
  if (!a || !b || a === b) return false
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a]
  const extra = largo.length - corto.length

  // (1) Un nombre de pila de más: "JUAN" vs "JUANCARLOS".
  //     Se exigen 3 caracteres extra para que "LUIS"/"LUISA" o "JUAN"/"JUANA"
  //     —hermanos, no variantes— no entren por aquí.
  if (extra >= 3 && corto.length >= 3 && largo.startsWith(corto)) return true

  // (2) Una letra CAMBIADA que no es la última: "EVELIN…" vs "EVELYN…".
  if (extra === 0 && corto.length >= 5) {
    const pos = posicionesDistintas(a, b)
    return pos.length === 1 && pos[0] !== a.length - 1
  }

  // (3) Una letra de MÁS que no va al final: "VANESA" vs "VANESSA".
  //     El corte del final es lo que deja fuera "DANIEL"/"DANIELA".
  if (extra === 1 && corto.length >= 5) {
    const i = primeraDiferencia(corto, largo)
    if (i === largo.length - 1) return false
    return corto.slice(i) === largo.slice(i + 1)
  }

  return false
}

// Una persona de la escuela que PODRÍA ser la misma que `person`, cuando
// findStudentIdentity no encontró coincidencia exacta. Devuelve null si no hay
// ninguna duda razonable.
//
// Dos caminos, los dos estrechos:
//   (a) Los DOS apellidos idénticos y el nombre "escrito distinto".
//   (b) Los DOS apellidos idénticos salvo que a uno le falta el materno, y el
//       nombre idéntico — la captura incompleta de una lista contra otra.
//       Con el nombre exacto no puede dispararse entre dos personas que sí
//       tienen los dos apellidos.
export function findSimilarIdentity(schoolDocs, person) {
  const exacta = studentNameKey(person)
  const apP = clean(person.apellidoPaterno)
  const apM = clean(person.apellidoMaterno)
  const nom = clean(person.nombre)
  if (!apP || !nom) return null

  const matches = (schoolDocs || []).filter((d) => {
    if (studentNameKey(d) === exacta) return false // eso ya lo cubre findStudentIdentity
    if (clean(d.apellidoPaterno) !== apP) return false
    const dApM = clean(d.apellidoMaterno)
    const dNom = clean(d.nombre)
    if (dApM === apM) return esNombreParecido(dNom, nom)
    // (b) a uno de los dos le falta el apellido materno
    if ((!dApM || !apM) && dNom === nom) return true
    return false
  })
  if (!matches.length) return null

  const canonical = matches.find((m) => m.uid) || matches[0]
  return {
    username: canonical.username,
    uid: canonical.uid || null,
    activado: !!canonical.activado,
    escuelaId: canonical.escuelaId,
    // Mismos campos que findStudentIdentity, ni uno más: las dos alimentan el
    // mismo createEnrollment y no deben comportarse distinto.
    // Lo que distingue esta coincidencia de la exacta: la pantalla tiene que
    // enseñar AMBOS nombres, porque la diferencia es justo el dato que el
    // docente necesita para decidir.
    parecido: true,
    matches,
  }
}

// Given all `students` docs of a school, find the canonical identity of a person (same full
// name), or null if this is a brand-new person. Prefers an already-activated enrollment so
// the new doc can inherit its uid and appear in the student's dashboard immediately.
export function findStudentIdentity(schoolDocs, person) {
  const key = studentNameKey(person)
  const matches = (schoolDocs || []).filter((d) => studentNameKey(d) === key)
  if (!matches.length) return null
  const canonical = matches.find((m) => m.uid) || matches[0]
  return {
    username: canonical.username,
    uid: canonical.uid || null,
    activado: !!canonical.activado,
    // La MISMA escuela que sus inscripciones hermanas — no la escuela actual
    // del docente (que puede haber cambiado desde que se creó `canonical`;
    // ver el comentario en fetchSchoolStudents). Sin esto, una reinscripción
    // volvía a fracturar la identidad: mismo uid, pero escuelaId distinto
    // entre inscripciones del mismo alumno.
    escuelaId: canonical.escuelaId,
    matches,
  }
}
