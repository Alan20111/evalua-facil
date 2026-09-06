import { doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

// Fields the student UI is allowed to read from a teacher's public profile.
// Any field NOT listed here stays private in users/{uid}.
const PUBLIC_FIELDS = ['nombreMostrar', 'prefijo', 'nombre', 'photoURL', 'mostrarFotoAlumnos']

function pickPublicFields(data) {
  const out = {}
  PUBLIC_FIELDS.forEach((f) => { if (f in data) out[f] = data[f] })
  return out
}

// Writes (or merges) the public display fields of a teacher's profile into
// publicProfiles/{uid}. Called from every code path that updates those fields
// in users/{uid}, so both collections stay in sync without a separate listener.
// Uses setDoc+merge instead of updateDoc so it also works for the first write
// (new teacher registration) without requiring the doc to exist first.
export async function syncPublicProfile(uid, data) {
  const fields = pickPublicFields(data)
  if (Object.keys(fields).length === 0) return
  await setDoc(doc(db, 'publicProfiles', uid), fields, { merge: true })
}
