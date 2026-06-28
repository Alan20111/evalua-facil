// Read-only consistency scanner for the student multi-subject model.
// Reads the PUBLIC collections (students, subjects) with the Firebase client SDK and reports
// any data inconsistencies the lifecycle fixes are meant to prevent. No writes, no auth.
//
// Usage: node scripts/check-consistency.mjs
import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs } from 'firebase/firestore'

// --- load firebase web config from .env (public client keys) ---
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    })
)

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
})
const db = getFirestore(app)

function clean(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z]/g, '').toUpperCase()
}
const nameKey = (s) => `${clean(s.apellidoPaterno)}|${clean(s.apellidoMaterno)}|${clean(s.nombre)}`

const [studentsSnap, subjectsSnap] = await Promise.all([
  getDocs(collection(db, 'students')),
  getDocs(collection(db, 'subjects')),
])
const students = studentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
const subjectIds = new Set(subjectsSnap.docs.map((d) => d.id))

console.log(`\nEscaneando ${students.length} inscripciones (students) en ${subjectIds.size} asignaturas…\n`)

const problems = []
const add = (tipo, msg) => problems.push({ tipo, msg })

// group by school
const bySchool = {}
for (const s of students) (bySchool[s.escuelaId] ||= []).push(s)

for (const [escuelaId, docs] of Object.entries(bySchool)) {
  // 1) Same person (full name) with DIFFERENT usernames → identity split.
  const byName = {}
  for (const s of docs) (byName[nameKey(s)] ||= []).push(s)
  for (const [key, group] of Object.entries(byName)) {
    const usernames = [...new Set(group.map((g) => g.username))]
    if (usernames.length > 1) {
      add('identidad-dividida', `Escuela ${escuelaId}: "${key}" tiene usernames distintos: ${usernames.join(', ')} (deberían ser uno solo)`)
    }
  }
  // 2) Same username with DIVERGENT uid → two accounts for one identity.
  const byUser = {}
  for (const s of docs) (byUser[s.username] ||= []).push(s)
  for (const [uname, group] of Object.entries(byUser)) {
    const uids = [...new Set(group.filter((g) => g.uid).map((g) => g.uid))]
    if (uids.length > 1) {
      add('uid-divergente', `Escuela ${escuelaId}: username ${uname} tiene uids distintos: ${uids.join(', ')}`)
    }
    // 3) activated but missing uid
    for (const g of group) {
      if (g.activado && !g.uid) add('activado-sin-uid', `Escuela ${escuelaId}: ${uname} (doc ${g.id}) activado:true pero sin uid`)
    }
    // 4) duplicate enrollment in the same subject
    const perSubject = {}
    for (const g of group) (perSubject[g.asignaturaId] ||= []).push(g)
    for (const [asig, gg] of Object.entries(perSubject)) {
      if (gg.length > 1) add('inscripcion-duplicada', `Escuela ${escuelaId}: ${uname} aparece ${gg.length} veces en la asignatura ${asig}`)
    }
  }
}

// 5) enrollment pointing to a non-existent subject
for (const s of students) {
  if (s.asignaturaId && !subjectIds.has(s.asignaturaId)) {
    add('asignatura-huerfana', `Inscripción ${s.id} (${s.username}) apunta a asignatura inexistente ${s.asignaturaId}`)
  }
}

if (!problems.length) {
  console.log('✅ Sin inconsistencias en students/subjects. El modelo de identidad está limpio.')
} else {
  const byType = {}
  for (const p of problems) (byType[p.tipo] ||= []).push(p.msg)
  console.log(`⚠️  ${problems.length} inconsistencia(s):\n`)
  for (const [tipo, msgs] of Object.entries(byType)) {
    console.log(`— ${tipo} (${msgs.length}):`)
    msgs.slice(0, 20).forEach((m) => console.log(`    · ${m}`))
    if (msgs.length > 20) console.log(`    … y ${msgs.length - 20} más`)
  }
}
console.log('\n(Nota: submissions/activities requieren auth y no se escanean aquí.)')
process.exit(0)
