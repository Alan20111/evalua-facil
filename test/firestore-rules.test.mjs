// Firestore Security Rules — behavioral tests against the emulator.
// Run with:  firebase emulators:exec --only firestore --project demo-test \
//              'node test/firestore-rules.test.mjs'
//
// Verifies the P0 multi-tenant isolation fix: legitimate flows (teacher CRUD on
// own data, student activation, student submit, teacher grading) still pass, and
// the holes (cross-teacher / cross-student writes) are now denied.

import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':')

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-test',
  firestore: {
    rules: readFileSync('firestore.rules', 'utf8'),
    host,
    port: Number(port),
  },
})

let pass = 0
const ok = (name) => { console.log('  ✓', name); pass++ }

// ── Seed baseline data with rules disabled ──────────────────────────────────
const T1 = 'teacher_1'        // owns subject S1 + activity A1
const T2 = 'teacher_2'        // owns subject S2 (a foreign teacher)
const U_JUAN = 'authuid_juan' // an activated student's auth uid
const U_MALLORY = 'authuid_mallory' // another student, attacker

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users', T1), { role: 'docente', escuelaId: 'E1' })
  await setDoc(doc(db, 'users', T2), { role: 'docente', escuelaId: 'E2' })
  await setDoc(doc(db, 'users', U_MALLORY), { role: 'docente', escuelaId: 'E1' }) // even a docente can't cross tenants
  await setDoc(doc(db, 'subjects', 'S1'), { docenteId: T1, escuelaId: 'E1', accessCode: 'abc' })
  await setDoc(doc(db, 'subjects', 'S2'), { docenteId: T2, escuelaId: 'E2', accessCode: 'xyz' })
  await setDoc(doc(db, 'activities', 'A1'), { docenteId: T1, asignaturaId: 'S1', tipo: 'archivo' })
  // Un-activated enrollment (uid null) in T1's subject — for activation tests.
  await setDoc(doc(db, 'students', 'ST_UNACT'), {
    asignaturaId: 'S1', escuelaId: 'E1', username: 'JUAN', uid: null, activado: false,
  })
  // Already-activated enrollment owned by U_JUAN — for submission tests.
  await setDoc(doc(db, 'students', 'ST_JUAN'), {
    asignaturaId: 'S1', escuelaId: 'E1', username: 'JUAN', uid: U_JUAN, activado: true,
  })
  await setDoc(doc(db, 'submissions', 'SUB1'), { alumnoId: 'ST_JUAN', actividadId: 'A1' })
})

const asT1 = testEnv.authenticatedContext(T1).firestore()
const asT2 = testEnv.authenticatedContext(T2).firestore()
const asJuan = testEnv.authenticatedContext(U_JUAN).firestore()
const asMallory = testEnv.authenticatedContext(U_MALLORY).firestore()

// ── students ────────────────────────────────────────────────────────────────
await assertSucceeds(setDoc(doc(asT1, 'students', 'ST_NEW'), {
  asignaturaId: 'S1', escuelaId: 'E1', username: 'ANA', uid: null, activado: false,
})); ok('teacher creates student in OWN subject')

await assertFails(setDoc(doc(asT2, 'students', 'ST_EVIL'), {
  asignaturaId: 'S1', escuelaId: 'E1', username: 'EVIL', uid: null, activado: false,
})); ok('foreign teacher CANNOT create student in another subject')

await assertSucceeds(updateDoc(doc(asT1, 'students', 'ST_UNACT'), { nombre: 'Juan Editado' }))
ok('owning teacher updates their student')

await assertFails(updateDoc(doc(asT2, 'students', 'ST_UNACT'), { nombre: 'hijack' }))
ok('foreign teacher CANNOT update another teacher’s student')

await assertFails(deleteDoc(doc(asMallory, 'students', 'ST_UNACT')))
ok('non-owner CANNOT delete a student')

// student activation: claims an un-owned record with own uid, identity frozen
await assertSucceeds(updateDoc(doc(asJuan, 'students', 'ST_UNACT'), {
  uid: U_JUAN, activado: true, resetPassword: null,
})); ok('student activates (claims un-owned record with own uid)')

// mallory tries to hijack an already-claimed record
await assertFails(updateDoc(doc(asMallory, 'students', 'ST_JUAN'), {
  uid: U_MALLORY, activado: true,
})); ok('attacker CANNOT hijack an already-claimed student record')

// student tries to move their own enrollment to another subject (identity frozen)
await assertFails(updateDoc(doc(asJuan, 'students', 'ST_JUAN'), { asignaturaId: 'S2' }))
ok('student CANNOT move their enrollment to another subject')

// ── activities ───────────────────────────────────────────────────────────────
await assertSucceeds(setDoc(doc(asT1, 'activities', 'A_NEW'), {
  docenteId: T1, asignaturaId: 'S1', tipo: 'archivo',
})); ok('teacher creates activity in OWN subject')

await assertFails(setDoc(doc(asT2, 'activities', 'A_EVIL'), {
  docenteId: T2, asignaturaId: 'S1', tipo: 'archivo',
})); ok('foreign teacher CANNOT create activity in another subject')

// ── submissions ──────────────────────────────────────────────────────────────
await assertSucceeds(setDoc(doc(asJuan, 'submissions', 'SUB_JUAN'), {
  alumnoId: 'ST_JUAN', actividadId: 'A1', archivoURL: 'x',
})); ok('student submits their OWN work')

await assertFails(setDoc(doc(asMallory, 'submissions', 'SUB_EVIL'), {
  alumnoId: 'ST_JUAN', actividadId: 'A1', archivoURL: 'x',
})); ok('attacker CANNOT create a submission as another student')

await assertFails(updateDoc(doc(asMallory, 'submissions', 'SUB1'), { calificacion: 10 }))
ok('attacker CANNOT alter another student’s submission/grade')

await assertSucceeds(updateDoc(doc(asT1, 'submissions', 'SUB1'), { calificacion: 9, comentario: 'bien' }))
ok('owning teacher grades a submission')

await assertFails(updateDoc(doc(asT2, 'submissions', 'SUB1'), { calificacion: 0 }))
ok('foreign teacher CANNOT grade a submission')

await assertFails(deleteDoc(doc(asMallory, 'submissions', 'SUB1')))
ok('attacker CANNOT delete another student’s submission')

await assertSucceeds(deleteDoc(doc(asJuan, 'submissions', 'SUB1')))
ok('student deletes their OWN submission (delete-rule bug fixed)')

// ── respuestas subcollection ─────────────────────────────────────────────────
await assertSucceeds(setDoc(doc(asJuan, 'submissions', 'SUB_JUAN', 'respuestas', 'Q1'), { valor: 'a' }))
ok('student writes an answer to their OWN attempt')

await assertFails(setDoc(doc(asMallory, 'submissions', 'SUB_JUAN', 'respuestas', 'Q1'), { valor: 'x' }))
ok('attacker CANNOT write answers to another student’s attempt')

await assertSucceeds(setDoc(doc(asT1, 'submissions', 'SUB_JUAN', 'respuestas', 'Q1'), { puntosObtenidos: 5 }))
ok('owning teacher writes revision points on an answer')

await testEnv.cleanup()
console.log(`\nALL ${pass} FIRESTORE-RULES CHECKS PASSED`)
