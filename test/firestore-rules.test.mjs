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
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore'

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
  // A2: second activity without deadline — used for student create tests (avoids conflict with
  // deadline-specific activities used in their own test cases).
  await setDoc(doc(db, 'activities', 'A2'), { docenteId: T1, asignaturaId: 'S1', tipo: 'archivo' })
  // Un-activated enrollment (uid null) in T1's subject — for activation tests.
  await setDoc(doc(db, 'students', 'ST_UNACT'), {
    asignaturaId: 'S1', escuelaId: 'E1', username: 'JUAN', uid: null, activado: false,
  })
  // Inscripción dada de alta por Excel: sin el campo `uid` siquiera.
  await setDoc(doc(db, 'students', 'ST_SIN_UID'), {
    asignaturaId: 'S1', escuelaId: 'E1', username: 'SINUID', activado: false,
  })
  // Already-activated enrollment owned by U_JUAN — for submission tests.
  await setDoc(doc(db, 'students', 'ST_JUAN'), {
    asignaturaId: 'S1', escuelaId: 'E1', username: 'JUAN', uid: U_JUAN, activado: true,
  })
  // R22: submission fixture uses deterministic ID {actividadId}_{alumnoId}.
  await setDoc(doc(db, 'submissions', 'A1_ST_JUAN'), { alumnoId: 'ST_JUAN', actividadId: 'A1' })

  // ── A12 · H3 · fixtures de plazo (fechaLimiteTS / extensionesTS) ──────────
  const HACE_1_DIA = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000))
  const EN_1_DIA = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
  await setDoc(doc(db, 'activities', 'A_VENCIDA'), {
    docenteId: T1, asignaturaId: 'S1', tipo: 'archivo', fechaLimiteTS: HACE_1_DIA,
  })
  await setDoc(doc(db, 'activities', 'A_TARDE_OK'), {
    docenteId: T1, asignaturaId: 'S1', tipo: 'archivo', fechaLimiteTS: HACE_1_DIA, recibirTarde: true,
  })
  await setDoc(doc(db, 'activities', 'A_FUTURA'), {
    docenteId: T1, asignaturaId: 'S1', tipo: 'archivo', fechaLimiteTS: EN_1_DIA,
  })
  await setDoc(doc(db, 'activities', 'A_CERRADA_MANUAL'), {
    docenteId: T1, asignaturaId: 'S1', tipo: 'archivo', cerradaManual: true,
  })
  await setDoc(doc(db, 'activities', 'A_SIN_TS'), {
    docenteId: T1, asignaturaId: 'S1', tipo: 'archivo', fechaLimite: '2020-01-01',
  })
  await setDoc(doc(db, 'activities', 'A_EXTENSION'), {
    docenteId: T1, asignaturaId: 'S1', tipo: 'archivo', fechaLimiteTS: HACE_1_DIA,
    extensionesTS: { ST_JUAN: EN_1_DIA },
  })
})

const asT1 = testEnv.authenticatedContext(T1).firestore()
const asT2 = testEnv.authenticatedContext(T2).firestore()
// El correo de Auth de un estudiante es determinista: usuario.escuela@evalua.local
// (ver studentEmail en src/utils/generate.js). Es lo que prueba que quien
// reclama una inscripción es de verdad esa persona, así que los contextos de
// prueba lo llevan.
const asJuan = testEnv.authenticatedContext(U_JUAN, { email: 'juan.E1@evalua.local' }).firestore()
const U_INTRUSO = 'authuid_intruso'
const asIntruso = testEnv.authenticatedContext(U_INTRUSO, { email: 'otro.E1@evalua.local' }).firestore()
const U_SIN_UID = 'authuid_sin_uid'
const asSinUid = testEnv.authenticatedContext(U_SIN_UID, { email: 'sinuid.E1@evalua.local' }).firestore()
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

// ── A04 · Reclamar una inscripción ajena ────────────────────────────────────
// La regla solo pedía "que nadie la haya reclamado antes" y "que estampes TU
// uid". No pedía que fueras esa persona. Con `students` de lectura pública,
// cualquiera con sesión podía listar las inscripciones sin activar y quedarse
// con la de otro: sus calificaciones, sus entregas, y entregar en su nombre.
await assertFails(updateDoc(doc(asIntruso, 'students', 'ST_UNACT'), {
  uid: U_INTRUSO, activado: true,
})); ok('outsider CANNOT claim an un-activated enrollment')

// student activation: claims an un-owned record with own uid, identity frozen
await assertSucceeds(updateDoc(doc(asJuan, 'students', 'ST_UNACT'), {
  uid: U_JUAN, activado: true, resetPassword: null,
})); ok('student activates (claims un-owned record with own uid)')

// Una inscripción SIN el campo `uid` (alta por Excel) también debe poder
// activarse: leer un campo ausente revienta la regla en vez de dar falso.
await assertSucceeds(updateDoc(doc(asSinUid, 'students', 'ST_SIN_UID'), {
  uid: U_SIN_UID, activado: true,
})); ok('student CAN activate an enrollment that has no uid field at all')

// mallory tries to hijack an already-claimed record
await assertFails(updateDoc(doc(asMallory, 'students', 'ST_JUAN'), {
  uid: U_MALLORY, activado: true,
})); ok('attacker CANNOT hijack an already-claimed student record')

// student tries to move their own enrollment to another subject (identity frozen)
await assertFails(updateDoc(doc(asJuan, 'students', 'ST_JUAN'), { asignaturaId: 'S2' }))
ok('student CANNOT move their enrollment to another subject')

// ── A07 · El padrón es del docente ──────────────────────────────────────────
// El estudiante solo toca los campos de su activación y su foto. Antes podía
// reescribir su propio nombre en la lista del maestro — y con él, el de las
// actas y las exportaciones.
await assertSucceeds(updateDoc(doc(asJuan, 'students', 'ST_JUAN'), { photoURL: 'https://x/f.jpg' }))
ok('student CAN set their own photo')

await assertFails(updateDoc(doc(asJuan, 'students', 'ST_JUAN'), { nombre: 'Otro Nombre' }))
ok('student CANNOT rename themselves in the teacher roster')

await assertFails(updateDoc(doc(asJuan, 'students', 'ST_JUAN'), { orden: 1 }))
ok('student CANNOT reorder themselves in the roster')

await assertFails(updateDoc(doc(asJuan, 'students', 'ST_JUAN'), { calificacionFinal: 10 }))
ok('student CANNOT inject fields no screen expects')

// El docente dueño sí puede todo lo anterior — es su padrón.
await assertSucceeds(updateDoc(doc(asT1, 'students', 'ST_JUAN'), { nombre: 'Juan Corregido', orden: 3 }))
ok('owning teacher CAN still edit any field of their roster')

// ── activities ───────────────────────────────────────────────────────────────
await assertSucceeds(setDoc(doc(asT1, 'activities', 'A_NEW'), {
  docenteId: T1, asignaturaId: 'S1', tipo: 'archivo',
})); ok('teacher creates activity in OWN subject')

await assertFails(setDoc(doc(asT2, 'activities', 'A_EVIL'), {
  docenteId: T2, asignaturaId: 'S1', tipo: 'archivo',
})); ok('foreign teacher CANNOT create activity in another subject')

// ── A12 · H2 · resources/materials deben comprobar dueño de la asignatura ──
// Antes solo pedían docenteId == auth.uid (que el docente se atribuya el
// documento a sí mismo), sin exigir ownsSubject(asignaturaId) — un docente
// activo cualquiera podía crear un recurso/material en la asignatura de otro.
await assertSucceeds(setDoc(doc(asT1, 'resources', 'R_NEW'), {
  docenteId: T1, asignaturaId: 'S1', tipo: 'link', nombre: 'x', url: 'https://x',
})); ok('teacher creates resource in OWN subject')

await assertFails(setDoc(doc(asT2, 'resources', 'R_EVIL'), {
  docenteId: T2, asignaturaId: 'S1', tipo: 'link', nombre: 'x', url: 'https://x',
})); ok('foreign teacher CANNOT create resource in another subject')

await assertSucceeds(setDoc(doc(asT1, 'materials', 'M_NEW'), {
  docenteId: T1, asignaturaId: 'S1', nombre: 'x', parcial: 1, orden: 0,
})); ok('teacher creates material in OWN subject')

await assertFails(setDoc(doc(asT2, 'materials', 'M_EVIL'), {
  docenteId: T2, asignaturaId: 'S1', nombre: 'x', parcial: 1, orden: 0,
})); ok('foreign teacher CANNOT create material in another subject')

// ── submissions ──────────────────────────────────────────────────────────────
// R22: todos los IDs siguen el patrón determinista {actividadId}_{alumnoId}.
// A2 se usa para los creates básicos (sin restricción de plazo) para no
// interferir con las actividades de plazo que tienen sus propios casos de prueba.

await assertSucceeds(setDoc(doc(asJuan, ‘submissions’, ‘A2_ST_JUAN’), {
  alumnoId: ‘ST_JUAN’, actividadId: ‘A2’, archivoURL: ‘x’,
})); ok(‘student submits their OWN work’)

// Mallory intenta crear una entrega para ST_JUAN (alumno que no le pertenece).
// ID correcto en formato pero ownership incorrecto → denegado.
await assertFails(setDoc(doc(asMallory, ‘submissions’, ‘A_SIN_TS_ST_JUAN’), {
  alumnoId: ‘ST_JUAN’, actividadId: ‘A_SIN_TS’, archivoURL: ‘x’,
})); ok(‘attacker CANNOT create a submission as another student’)

// ── A12 · R22 · el ID debe ser {actividadId}_{alumnoId} — sin esto, reglas rechazan ──
await assertFails(setDoc(doc(asJuan, ‘submissions’, ‘RANDOM_ID_ALEATORIO’), {
  alumnoId: ‘ST_JUAN’, actividadId: ‘A_FUTURA’, archivoURL: ‘x’,
})); ok(‘student CANNOT create a submission with a non-deterministic ID (R22)’)

await assertFails(setDoc(doc(asT1, ‘submissions’, ‘RANDOM_ID_DOCENTE’), {
  alumnoId: ‘ST_JUAN’, actividadId: ‘A1’, docenteId: T1, completadoSinArchivo: true,
})); ok(‘teacher CANNOT create a submission with a non-deterministic ID (R22)’)

await assertFails(updateDoc(doc(asMallory, ‘submissions’, ‘A1_ST_JUAN’), { calificacion: 10 }))
ok(‘attacker CANNOT alter another student’s submission/grade’)

await assertSucceeds(updateDoc(doc(asT1, ‘submissions’, ‘A1_ST_JUAN’), { calificacion: 9, comentario: ‘bien’ }))
ok(‘owning teacher grades a submission’)

await assertFails(updateDoc(doc(asT2, ‘submissions’, ‘A1_ST_JUAN’), { calificacion: 0 }))
ok(‘foreign teacher CANNOT grade a submission’)

await assertFails(deleteDoc(doc(asMallory, ‘submissions’, ‘A1_ST_JUAN’)))
ok(‘attacker CANNOT delete another student’s submission’)

// Esta prueba esperaba lo contrario y llevaba tiempo fallando: la regla se
// endureció a propósito (borrar una entrega borra su calificación, y eso es
// manipulación de notas si lo hace el alumno), pero la prueba se quedó con el
// comportamiento viejo. Manda la regla, ver el comentario en firestore.rules.
await assertFails(deleteDoc(doc(asJuan, ‘submissions’, ‘A1_ST_JUAN’)))
ok(‘student CANNOT delete their own submission (it would erase the grade)’)

await assertSucceeds(deleteDoc(doc(asT1, ‘submissions’, ‘A1_ST_JUAN’)))
ok(‘owning teacher deletes a submission’)

// ── A12 · H3 · el servidor cierra el plazo, no solo la pantalla ────────────
await assertFails(setDoc(doc(asJuan, ‘submissions’, ‘A_VENCIDA_ST_JUAN’), {
  alumnoId: ‘ST_JUAN’, actividadId: ‘A_VENCIDA’, archivoURL: ‘x’,
})); ok(‘student CANNOT create a submission after fechaLimite’)

await assertSucceeds(setDoc(doc(asJuan, ‘submissions’, ‘A_TARDE_OK_ST_JUAN’), {
  alumnoId: ‘ST_JUAN’, actividadId: ‘A_TARDE_OK’, archivoURL: ‘x’,
})); ok(‘student CAN submit late when recibirTarde is enabled’)

await assertSucceeds(setDoc(doc(asJuan, ‘submissions’, ‘A_FUTURA_ST_JUAN’), {
  alumnoId: ‘ST_JUAN’, actividadId: ‘A_FUTURA’, archivoURL: ‘x’,
})); ok(‘student CAN submit before fechaLimite’)

await assertFails(setDoc(doc(asJuan, ‘submissions’, ‘A_CERRADA_MANUAL_ST_JUAN’), {
  alumnoId: ‘ST_JUAN’, actividadId: ‘A_CERRADA_MANUAL’, archivoURL: ‘x’,
})); ok(‘student CANNOT submit once the teacher closed it manually’)

await assertSucceeds(setDoc(doc(asJuan, ‘submissions’, ‘A_SIN_TS_ST_JUAN’), {
  alumnoId: ‘ST_JUAN’, actividadId: ‘A_SIN_TS’, archivoURL: ‘x’,
})); ok(‘student CAN still submit to a legacy activity with no fechaLimiteTS yet (absent field never blocks)’)

await assertSucceeds(setDoc(doc(asJuan, ‘submissions’, ‘A_EXTENSION_ST_JUAN’), {
  alumnoId: ‘ST_JUAN’, actividadId: ‘A_EXTENSION’, archivoURL: ‘x’,
})); ok(‘student WITH a personal extension CAN submit past the group fechaLimite’)

// El docente dueño sigue pudiendo marcar/crear entregas de una actividad
// vencida — el candado es solo para el alumno, no para su propio trabajo.
// SUB_VENCIDA falló (alumno no puede crearla), así que A_VENCIDA_ST_JUAN no
// existe: el docente puede crearla aquí sin conflicto de IDs.
await assertSucceeds(setDoc(doc(asT1, ‘submissions’, ‘A_VENCIDA_ST_JUAN’), {
  alumnoId: ‘ST_JUAN’, actividadId: ‘A_VENCIDA’, docenteId: T1, completadoSinArchivo: true,
})); ok(‘owning teacher CAN still create a submission on an expired activity’)

// ── respuestas subcollection ─────────────────────────────────────────────────
// Se usa A2_ST_JUAN creado en el primer test del bloque (student submits own work).
await assertSucceeds(setDoc(doc(asJuan, ‘submissions’, ‘A2_ST_JUAN’, ‘respuestas’, ‘Q1’), { valor: ‘a’ }))
ok(‘student writes an answer to their OWN attempt’)

await assertFails(setDoc(doc(asMallory, ‘submissions’, ‘A2_ST_JUAN’, ‘respuestas’, ‘Q1’), { valor: ‘x’ }))
ok(‘attacker CANNOT write answers to another student’s attempt’)

await assertSucceeds(setDoc(doc(asT1, ‘submissions’, ‘A2_ST_JUAN’, ‘respuestas’, ‘Q1’), { puntosObtenidos: 5 }))
ok(‘owning teacher writes revision points on an answer’)

// ── Candado de suscripción ───────────────────────────────────────────────────
// Un docente sin suscripción vigente puede leer y exportar lo suyo, pero no
// escribir. La fecha vive en users/{uid}.suscripcionHasta, la espeja la Cloud
// Function onSuscripcionEscrita y la compara docenteActivo() en las reglas.
const T_VENCIDO = 'teacher_vencido'
const T_SIN_CAMPO = 'teacher_sin_campo'
const AYER = new Date(Date.now() - 86400000)
const EN_UN_MES = new Date(Date.now() + 30 * 86400000)

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users', T_VENCIDO), { role: 'docente', escuelaId: 'E3', suscripcionHasta: AYER })
  // Cuenta que todavía no pasó por seeds-db/backfill-suscripcion.js.
  await setDoc(doc(db, 'users', T_SIN_CAMPO), { role: 'docente', escuelaId: 'E4' })
  // T1 sí está al corriente — las pruebas de arriba corrieron sin el campo
  // (ausente = se deja pasar), aquí se le pone explícito.
  await setDoc(doc(db, 'users', T1), { role: 'docente', escuelaId: 'E1', suscripcionHasta: EN_UN_MES }, { merge: true })
  await setDoc(doc(db, 'subjects', 'S_VENC'), { docenteId: T_VENCIDO, escuelaId: 'E3', accessCode: 'ven' })
  await setDoc(doc(db, 'activities', 'A_VENC'), { docenteId: T_VENCIDO, asignaturaId: 'S_VENC', tipo: 'archivo' })
  await setDoc(doc(db, 'submissions', 'SUB_VENC'), { alumnoId: 'ST_JUAN', actividadId: 'A_VENC' })
  await setDoc(doc(db, 'subscriptions', 'SUB_DEL_VENCIDO'), { docenteId: T_VENCIDO, status: 'vencida' })
  await setDoc(doc(db, 'bancoRubricas', 'RUB_VENC'), { docenteId: T_VENCIDO, titulo: 'Suya' })
  // Inscripción de Juan en la materia del docente vencido: sin ella no podría
  // entregar ahí por una razón distinta a la que se quiere probar.
  await setDoc(doc(db, 'students', 'ST_JUAN_VENC'), {
    asignaturaId: 'S_VENC', escuelaId: 'E3', username: 'JUAN', uid: U_JUAN, activado: true,
  })
})

const asVencido = testEnv.authenticatedContext(T_VENCIDO).firestore()
const asSinCampo = testEnv.authenticatedContext(T_SIN_CAMPO).firestore()

// No puede TRABAJAR
await assertFails(setDoc(doc(asVencido, 'activities', 'A_NUEVA'), {
  docenteId: T_VENCIDO, asignaturaId: 'S_VENC', tipo: 'archivo',
})); ok('expired teacher CANNOT create an activity')

await assertFails(updateDoc(doc(asVencido, 'activities', 'A_VENC'), { nombre: 'Editada' }))
ok('expired teacher CANNOT edit their own activity')

await assertFails(updateDoc(doc(asVencido, 'submissions', 'SUB_VENC'), { calificacion: 10 }))
ok('expired teacher CANNOT grade')

await assertFails(setDoc(doc(asVencido, 'attendance', 'AT_1'), {
  docenteId: T_VENCIDO, asignaturaId: 'S_VENC', fecha: '2026-08-05',
})); ok('expired teacher CANNOT take attendance')

await assertFails(setDoc(doc(asVencido, 'avisos', 'AV_1'), {
  docenteId: T_VENCIDO, asignaturaId: 'S_VENC', titulo: 'Hola',
})); ok('expired teacher CANNOT publish an aviso')

await assertFails(setDoc(doc(asVencido, 'students', 'ST_NUEVO'), {
  asignaturaId: 'S_VENC', escuelaId: 'E3', username: 'NUE', uid: null,
})); ok('expired teacher CANNOT add a student')

await assertFails(setDoc(doc(asVencido, 'bancoRubricas', 'RUB_NUEVA'), { docenteId: T_VENCIDO, titulo: 'R' }))
ok('expired teacher CANNOT create a rubric')

// Y sobre todo: no puede abrirse el candado a sí mismo.
await assertFails(updateDoc(doc(asVencido, 'users', T_VENCIDO), { suscripcionHasta: EN_UN_MES }))
ok('expired teacher CANNOT lift their own lock from the client')

// Sí puede CONSULTAR y PAGAR
await assertSucceeds(getDoc(doc(asVencido, 'activities', 'A_VENC')))
ok('expired teacher CAN still read their activity')

await assertSucceeds(getDoc(doc(asVencido, 'bancoRubricas', 'RUB_VENC')))
ok('expired teacher CAN still read their rubric bank')

// Lo más importante de todo el candado: a quien se le venció la suscripción no
// se le puede impedir PAGARLA.
await assertSucceeds(setDoc(doc(asVencido, 'payments', 'PAY_1'), {
  docenteId: T_VENCIDO, subscriptionId: 'SUB_DEL_VENCIDO', planId: 'pro', escuelaId: 'E3',
  monto: 99, mesesPagados: 1, metodo: 'transferencia', referencia: '9001',
  status: 'pendiente', createdAt: serverTimestamp(),
})); ok('expired teacher CAN declare a payment')

await assertSucceeds(updateDoc(doc(asVencido, 'subscriptions', 'SUB_DEL_VENCIDO'), {
  docenteId: T_VENCIDO, status: 'pendiente_pago',
})); ok('expired teacher CAN mark their subscription as paying')

await assertSucceeds(updateDoc(doc(asVencido, 'users', T_VENCIDO), { nombre: 'Otro' }))
ok('expired teacher CAN still edit their own profile')

// Al corriente: todo normal
await assertSucceeds(setDoc(doc(asT1, 'activities', 'A_OK'), {
  docenteId: T1, asignaturaId: 'S1', tipo: 'archivo',
})); ok('paid teacher works normally')

// Sin el campo todavía (cuenta previa al respaldo): no se bloquea a nadie por
// un dato faltante.
await assertSucceeds(setDoc(doc(asSinCampo, 'bancoRubricas', 'RUB_SC'), { docenteId: T_SIN_CAMPO, titulo: 'R' }))
ok('teacher without the mirrored field is NOT locked out')

// El alumno no pierde nada porque su maestro no pagó.
await assertSucceeds(setDoc(doc(asJuan, 'submissions', 'SUB_ALU_VENC'), {
  alumnoId: 'ST_JUAN_VENC', actividadId: 'A_VENC', archivoURL: 'x',
})); ok('student of an expired teacher CAN still submit')

// ── Suscripciones: el candado no se puede abrir desde el cliente ─────────────
// Los dos ataques que la auditoría encontró abiertos: reescribir las fechas al
// declarar un pago, y crearse una suscripción a modo.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'subscriptions', 'SUB_T1'), {
    docenteId: T1, status: 'trial', planId: '', fechaInicio: AYER, fechaVencimiento: AYER,
  })
  await setDoc(doc(db, 'subscriptions', 'SUB_T2'), { docenteId: T2, status: 'activa', planId: 'pro' })
})

// Lo legítimo: declarar que va a pagar.
await assertSucceeds(updateDoc(doc(asT1, 'subscriptions', 'SUB_T1'), {
  status: 'pendiente_pago', updatedAt: new Date(),
})); ok('teacher CAN declare a payment on their own subscription')

// Ataque 1: colar fechas o plan en el mismo update que cambia el status.
await assertFails(updateDoc(doc(asT1, 'subscriptions', 'SUB_T1'), {
  status: 'pendiente_pago', fechaVencimiento: EN_UN_MES,
})); ok('teacher CANNOT extend their own vencimiento while declaring a payment')

await assertFails(updateDoc(doc(asT1, 'subscriptions', 'SUB_T1'), {
  status: 'pendiente_pago', planId: 'pro',
})); ok('teacher CANNOT grant themselves a planId')

await assertFails(updateDoc(doc(asT1, 'subscriptions', 'SUB_T1'), {
  status: 'pendiente_pago', fechaInicio: EN_UN_MES,
})); ok('teacher CANNOT move their own fechaInicio')

await assertFails(updateDoc(doc(asT1, 'subscriptions', 'SUB_T1'), { status: 'activa' }))
ok('teacher CANNOT set their subscription to activa')

// Ataque 2: crearse una suscripción, o una prueba nueva cada vez que vence.
await assertFails(setDoc(doc(asT1, 'subscriptions', 'SUB_FORJADA'), {
  docenteId: T1, status: 'pendiente_pago', planId: 'pro', fechaVencimiento: EN_UN_MES,
})); ok('teacher CANNOT forge a paid subscription')

await assertFails(setDoc(doc(asT1, 'subscriptions', 'SUB_TRIAL_NUEVO'), {
  docenteId: T1, status: 'trial', planId: '', fechaInicio: new Date(),
})); ok('teacher CANNOT mint a fresh trial')

// Ni tocar la de otro, ni borrar la suya para empezar de cero.
await assertFails(updateDoc(doc(asT1, 'subscriptions', 'SUB_T2'), { status: 'pendiente_pago' }))
ok('teacher CANNOT touch another teacher subscription')

await assertFails(deleteDoc(doc(asT1, 'subscriptions', 'SUB_T1')))
ok('teacher CANNOT delete their subscription to start over')

// ── Pagos: declarar una transferencia no puede convertirse en otra cosa ─────
// Un pago es la orden que el panel obedece al aprobar (ver handleApprove en
// PaymentsTable.jsx): de ahí salen el plan, la periodicidad, los meses y a qué
// suscripción se le acreditan. Todo eso tiene que quedar fijo desde el
// servidor, o "declarar una transferencia" se vuelve "escribir mi propia
// factura".
const pagoValido = (extra = {}) => ({
  docenteId: T1,
  subscriptionId: 'SUB_T1',
  planId: 'pro',
  escuelaId: 'E1',
  monto: 99,
  mesesPagados: 1,
  metodo: 'transferencia',
  referencia: '123456',
  status: 'pendiente',
  createdAt: serverTimestamp(),
  ...extra,
})

await assertSucceeds(setDoc(doc(asT1, 'payments', 'PAY_OK'), pagoValido()))
ok('teacher CAN declare a transfer payment')

await assertSucceeds(setDoc(doc(asT1, 'payments', 'PAY_6M'), pagoValido({ monto: 474, mesesPagados: 6 })))
ok('teacher CAN declare a 6-month transfer')

await assertFails(setDoc(doc(asT1, 'payments', 'PAY_FALSO'), pagoValido({ status: 'completado' })))
ok('teacher CANNOT mark their own payment as completed')

// El ataque grande: el plan anual multiplica por 12 al aprobar.
await assertFails(setDoc(doc(asT1, 'payments', 'PAY_ANUAL'), pagoValido({ planId: 'anual' })))
ok('teacher CANNOT declare a payment on the annual plan')

await assertFails(setDoc(doc(asT1, 'payments', 'PAY_120M'), pagoValido({ mesesPagados: 120 })))
ok('teacher CANNOT claim 120 months on one transfer')

await assertFails(setDoc(doc(asT1, 'payments', 'PAY_0M'), pagoValido({ mesesPagados: 0 })))
ok('teacher CANNOT claim zero months')

// La app instalada en el teléfono lleva su propio paquete: un pago suyo sin
// `mesesPagados` tiene que seguir entrando (vale por un mes).
const { mesesPagados: _sinMeses, ...pagoViejo } = pagoValido()
await assertSucceeds(setDoc(doc(asT1, 'payments', 'PAY_APP_VIEJA'), pagoViejo))
ok('older client CAN still declare a payment without mesesPagados')

// Pagar y acreditárselo a la cuenta de otro.
await assertFails(setDoc(doc(asT1, 'payments', 'PAY_AJENO'), pagoValido({ subscriptionId: 'SUB_T2' })))
ok('teacher CANNOT point a payment at another teacher subscription')

await assertFails(setDoc(doc(asT1, 'payments', 'PAY_HUERFANO'), pagoValido({ subscriptionId: 'NO_EXISTE' })))
ok('teacher CANNOT point a payment at a subscription that does not exist')

// Campos que no son suyos: nacer archivado lo escondía de la lista del admin,
// y `notasAdmin` es lo que el docente lee como motivo del rechazo.
await assertFails(setDoc(doc(asT1, 'payments', 'PAY_OCULTO'), pagoValido({ archivado: true })))
ok('teacher CANNOT create a payment already archived')

await assertFails(setDoc(doc(asT1, 'payments', 'PAY_NOTAS'), pagoValido({ notasAdmin: 'aprobado por el jefe' })))
ok('teacher CANNOT write the admin notes')

await assertFails(setDoc(doc(asT1, 'payments', 'PAY_CALLADO'), pagoValido({ notificadoAdmin: true })))
ok('teacher CANNOT pre-silence the admin notification')

// La fecha manda en el folio de transacción del panel.
await assertFails(setDoc(doc(asT1, 'payments', 'PAY_VIEJO'), pagoValido({ createdAt: AYER })))
ok('teacher CANNOT backdate a payment')

// Y una vez creado, se acabó: resolverlo es del administrador.
await assertFails(updateDoc(doc(asT1, 'payments', 'PAY_OK'), { status: 'completado' }))
ok('teacher CANNOT approve their own declared payment')

await assertFails(deleteDoc(doc(asT1, 'payments', 'PAY_OK')))
ok('teacher CANNOT delete a payment')

await assertFails(getDoc(doc(asT2, 'payments', 'PAY_OK')))
ok('teacher CANNOT read another teacher payment')

// ── A03 · El candado no se puede traer puesto de fábrica ────────────────────
// `users` congela `suscripcionHasta` en las ACTUALIZACIONES, pero el documento
// se crea una sola vez y ahí no se validaba nada: quien se registra escribe su
// propio perfil, y podía traer el candado ya abierto a diez años. La Cloud
// Function que espeja la vigencia lo corrige al crear la prueba, pero eso es
// una carrera, no una defensa: si la función falla o tarda, el docente trabaja
// sin vencimiento posible.
const T_NUEVO = 'teacher_recien_llegado'
const EN_DIEZ_ANIOS = new Date(Date.now() + 3650 * 86400000)
const asNuevo = testEnv.authenticatedContext(T_NUEVO).firestore()

await assertFails(setDoc(doc(asNuevo, 'users', T_NUEVO), {
  role: 'docente', email: 'nuevo@x.mx', suscripcionHasta: EN_DIEZ_ANIOS,
})); ok('new teacher CANNOT create their profile with the lock already open')

await assertFails(setDoc(doc(asNuevo, 'users', T_NUEVO), {
  role: 'admin', email: 'nuevo@x.mx',
})); ok('new teacher CANNOT create themselves as admin')

await assertSucceeds(setDoc(doc(asNuevo, 'users', T_NUEVO), {
  role: 'docente', email: 'nuevo@x.mx', profileComplete: false,
})); ok('new teacher CAN create their own normal profile')

// Y el candado tampoco se abre borrando el perfil para volver a crearlo.
await assertFails(deleteDoc(doc(asNuevo, 'users', T_NUEVO)))
ok('teacher CANNOT delete their own profile to re-create it')

// ── A10 · La constancia de baja se tiene que poder leer ─────────────────────
// `bajas` no tenía regla, así que Firestore la denegaba por omisión: el panel
// la lee con un .catch que se tragaba el error y la constancia se escribía sin
// que nadie pudiera leerla nunca. La escribe solo el Admin SDK.
const ADMIN = 'admin_1'
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users', ADMIN), { role: 'admin', email: 'admin@evaluafacil.mx' })
  await setDoc(doc(db, 'bajas', 'T_BAJA'), {
    docenteId: 'T_BAJA', nombre: 'Quien se fue', email: 'x@y.mx', cuentaEliminada: true,
  })
})
const asAdmin = testEnv.authenticatedContext(ADMIN).firestore()

// Lo que de verdad importa: que el panel SÍ pueda leerla. Una regla que niega
// a todos habría dejado el defecto igual de roto, solo que en verde.
await assertSucceeds(getDoc(doc(asAdmin, 'bajas', 'T_BAJA')))
ok('admin CAN read the deregistration record (the panel needs it)')

await assertFails(getDoc(doc(asT1, 'bajas', 'T_BAJA')))
ok('teacher CANNOT read the deregistration record of another')

await assertFails(setDoc(doc(asT1, 'bajas', 'T_FALSA'), { docenteId: 'T1' }))
ok('nobody can forge a deregistration record from the client')

// ── A04 · Las escuelas ajenas no se renombran (R1) ──────────────────────────
// El alta completa datos que le faltaban a una escuela que ya existía, y eso
// tiene que seguir funcionando; lo que no puede es cambiarle el nombre.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'schools', 'E1'), { nombre: 'Escuela de T1', shortName: 'CBTIS1' })
  await setDoc(doc(db, 'schools', 'E2'), { nombre: 'Escuela de T2', shortName: 'CBTIS2' })
})

await assertSucceeds(setDoc(doc(asT1, 'schools', 'E1'), { shortName: 'CBTIS255' }, { merge: true }))
ok('teacher CAN rename their OWN school')

await assertFails(setDoc(doc(asT1, 'schools', 'E2'), { nombre: 'Secuestrada' }, { merge: true }))
ok('teacher CANNOT rename another school')

await assertFails(setDoc(doc(asT1, 'schools', 'E2'), { shortName: 'MIA' }, { merge: true }))
ok('teacher CANNOT change another school short name')

await assertSucceeds(setDoc(doc(asT1, 'schools', 'E2'), { claveSEP: '29DCT0001X', estado: 'Tlaxcala' }, { merge: true }))
ok('teacher CAN still enrich another school while registering')

// ── A08 · La clave de respuestas no la ve el alumno ────────────────────────
//
// Las reglas no filtran campos, así que mientras `respuestaCorrecta` vivió
// dentro del reactivo, cualquiera con sesión la leía — y el runner del alumno
// ya descargaba los documentos enteros. La clave se mudó a una subcolección
// propia; esto fija que ahí no entra nadie más que su docente.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'activities', 'A_EVAL_CLAVE'), { docenteId: T1, asignaturaId: 'S1', tipo: 'evaluacion' })
  await setDoc(doc(db, 'activities', 'A_EVAL_CLAVE', 'preguntas', 'Q1'), { enunciado: '¿Capital?', tipo: 'opcion_multiple' })
  await setDoc(doc(db, 'activities', 'A_EVAL_CLAVE', 'clave', 'Q1'), { respuestaCorrecta: 'b' })
})

await assertSucceeds(getDoc(doc(asJuan, 'activities', 'A_EVAL_CLAVE', 'preguntas', 'Q1')))
ok('student CAN still read the question itself — they need it to answer')

await assertFails(getDoc(doc(asJuan, 'activities', 'A_EVAL_CLAVE', 'clave', 'Q1')))
ok('student CANNOT read the answer key of the exam they are taking')

await assertFails(getDoc(doc(asMallory, 'activities', 'A_EVAL_CLAVE', 'clave', 'Q1')))
ok('a student from another school CANNOT read the answer key either')

await assertFails(setDoc(doc(asJuan, 'activities', 'A_EVAL_CLAVE', 'clave', 'Q1'), { respuestaCorrecta: 'a' }))
ok('student CANNOT rewrite the answer key to match their answer')

await assertSucceeds(getDoc(doc(asT1, 'activities', 'A_EVAL_CLAVE', 'clave', 'Q1')))
ok('the owning teacher CAN read the answer key')

await assertSucceeds(setDoc(doc(asT1, 'activities', 'A_EVAL_CLAVE', 'clave', 'Q1'), { respuestaCorrecta: 'c' }))
ok('the owning teacher CAN write the answer key')

await assertFails(getDoc(doc(asT2, 'activities', 'A_EVAL_CLAVE', 'clave', 'Q1')))
ok('another teacher CANNOT read someone else’s answer key')

// ── A08 · El alumno no maneja la máquina de estados de su examen ────────────
//
// Blindar `calificacion` no bastaba: sin escribirla nunca, el alumno podía
// hacer que el servidor se la recalculara a su gusto moviendo tres campos que
// nadie vigilaba. Cada caso de aquí abajo PASABA antes de la corrección.
const A_EX = 'A_EXAMEN'
const SUB_EX = 'SUB_EXAMEN'

async function prepararExamen(sub) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'activities', A_EX), {
      docenteId: T1, asignaturaId: 'S1', tipo: 'evaluacion', maxCalif: 10,
      evaluacion: { tiempoLimiteMin: 30, intentosPermitidos: 2, conservar: 'mejor' },
    })
    await setDoc(doc(db, 'submissions', SUB_EX), { actividadId: A_EX, alumnoId: 'ST_JUAN', ...sub })
  })
}

// Empezado hace 45 minutos, con un límite de 30: el tiempo YA se acabó.
const HACE_45_MIN = new Date(Date.now() - 45 * 60 * 1000)
await prepararExamen({
  estadoEvaluacion: 'en_progreso', intentoActual: 1, intentos: [], tiempoInicio: HACE_45_MIN,
})

await assertFails(setDoc(doc(asJuan, 'submissions', SUB_EX, 'respuestas', 'Q1'), { opcionSeleccionada: 'b' }))
ok('student CANNOT answer after the time limit (server clock, not the phone’s)')

await assertFails(updateDoc(doc(asJuan, 'submissions', SUB_EX), { tiempoInicio: serverTimestamp() }))
ok('student CANNOT restart their own countdown')

await assertSucceeds(updateDoc(doc(asJuan, 'submissions', SUB_EX), { estadoEvaluacion: 'finalizado' }))
ok('student CAN finish the attempt in progress')

// Ya calificado el intento 1: el servidor lo anotó en intentos[].
await prepararExamen({
  estadoEvaluacion: 'finalizado', intentoActual: 1,
  intentos: [{ numero: 1, calificacion: 4 }], tiempoInicio: HACE_45_MIN, calificacion: 4,
})

await assertFails(updateDoc(doc(asJuan, 'submissions', SUB_EX), { estadoEvaluacion: 'en_progreso' }))
ok('student CANNOT reopen a graded attempt to change their answers')

await assertFails(updateDoc(doc(asJuan, 'submissions', SUB_EX), { intentoActual: 7 }))
ok('student CANNOT invent an attempt number to dodge the grading lock')

await assertFails(updateDoc(doc(asJuan, 'submissions', SUB_EX), {
  estadoEvaluacion: 'en_progreso', intentoActual: 1, tiempoInicio: serverTimestamp(),
})); ok('student CANNOT replay the SAME attempt number')

// El reintento legítimo: el número avanza al siguiente real y quedan intentos.
await assertSucceeds(updateDoc(doc(asJuan, 'submissions', SUB_EX), {
  estadoEvaluacion: 'en_progreso', intentoActual: 2, tiempoInicio: serverTimestamp(), ordenSeed: null,
})); ok('student CAN open a legitimate second attempt')

await assertSucceeds(setDoc(doc(asJuan, 'submissions', SUB_EX, 'respuestas', 'Q1'), { opcionSeleccionada: 'b' }))
ok('and CAN answer again — the clock restarted with the new attempt')

// Agotados los 2 intentos permitidos.
await prepararExamen({
  estadoEvaluacion: 'finalizado', intentoActual: 2,
  intentos: [{ numero: 1, calificacion: 4 }, { numero: 2, calificacion: 6 }], tiempoInicio: HACE_45_MIN,
})

await assertFails(updateDoc(doc(asJuan, 'submissions', SUB_EX), {
  estadoEvaluacion: 'en_progreso', intentoActual: 3, tiempoInicio: serverTimestamp(),
})); ok('student CANNOT open a third attempt when only two are allowed')

// Sin límite de tiempo configurado, un campo ausente no deja a nadie fuera.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'activities', 'A_SIN_LIMITE'), {
    docenteId: T1, asignaturaId: 'S1', tipo: 'evaluacion', evaluacion: { conservar: 'ultimo' },
  })
  await setDoc(doc(db, 'submissions', 'SUB_SIN_LIMITE'), {
    actividadId: 'A_SIN_LIMITE', alumnoId: 'ST_JUAN',
    estadoEvaluacion: 'en_progreso', intentoActual: 1, intentos: [], tiempoInicio: HACE_45_MIN,
  })
})
await assertSucceeds(setDoc(doc(asJuan, 'submissions', 'SUB_SIN_LIMITE', 'respuestas', 'Q1'), { opcionSeleccionada: 'a' }))
ok('an evaluation with NO time limit still accepts answers (absent field lets you through)')

// ── A09 · Calificaciones, ponderación y rúbricas ────────────────────────────
//
// H1 — El alumno reescribía la rúbrica con la que lo calificaron.
// `studentNoTocaCalificacion()` blindaba `calificacion`, `intentos` y
// `pendienteRevision`, pero no `rubricaEval` — el arreglo con la evaluación
// por criterio que justifica el número ante la escuela. Ningún flujo del
// alumno escribe ahí: solo lo lee. Y no se queda en la apariencia: el panel
// del docente se PRELLENA desde este campo (ActivityPage.jsx), así que si el
// alumno lo reescribe a "todo excelente" y el docente ajusta después un solo
// criterio, el total se recalcula sobre la base falsificada.
//
// H4 — Cerrar un parcial era el único camino que escribía calificaciones SIN
// tope por arriba, y en bloque a todo el que no entregó (SubjectPage.jsx,
// confirmCloseParcial). Los demás caminos —calificar uno por uno, el editor
// rápido de la tabla, el panel de la actividad— topan contra `maxCalif`.
//
// Antes de poner el candado se midió producción: 0 de 46 calificaciones
// reales están fuera de rango y 0 son huérfanas — un candado nuevo no deja a
// nadie fuera (§1.2).
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'activities', 'A_RUB09'), {
    docenteId: T1, asignaturaId: 'S1', tipo: 'archivo', maxCalif: 10,
    rubrica: {
      tipo: 'rubrica', titulo: 'R',
      niveles: [{ nombre: 'Excelente', porcentaje: 100 }, { nombre: 'Regular', porcentaje: 50 }],
      criterios: [
        { nombre: 'c1', puntos: [6, 3], descriptores: ['', ''] },
        { nombre: 'c2', puntos: [4, 2], descriptores: ['', ''] },
      ],
    },
  })
  // Actividad LEGADA sin `maxCalif`: campo ausente = escala 10 (§1.2).
  await setDoc(doc(db, 'activities', 'A_LEGADO09'), { docenteId: T1, asignaturaId: 'S1', tipo: 'archivo' })
  await setDoc(doc(db, 'submissions', 'SUB_RUB09'), {
    alumnoId: 'ST_JUAN', actividadId: 'A_RUB09',
    calificacion: 4.7, estado: 'calificado', rubricaEval: [1, 1],
  })
  await setDoc(doc(db, 'submissions', 'SUB_RUB09_SIN'), {
    alumnoId: 'ST_JUAN', actividadId: 'A_RUB09', estado: 'entregado',
  })
  // Documento LEGADO fuera de rango: no existe hoy en producción (medido:
  // 0 de 46), pero si existiera su dueño debe poder seguir editándolo sin
  // que el candado nuevo lo deje congelado para siempre (§1.2).
  await setDoc(doc(db, 'submissions', 'SUB_LEGADO09'), {
    alumnoId: 'ST_JUAN', actividadId: 'A_RUB09', calificacion: 50, estado: 'calificado',
  })
})

await assertFails(updateDoc(doc(asJuan, 'submissions', 'SUB_RUB09'), { rubricaEval: [0, 0] }))
ok('A09 · student CANNOT rewrite the rubricaEval they were graded with')

await assertFails(updateDoc(doc(asJuan, 'submissions', 'SUB_RUB09_SIN'), { rubricaEval: [0, 0] }))
ok('A09 · student CANNOT pre-fill rubricaEval before being graded (teacher panel reads it back)')

await assertSucceeds(updateDoc(doc(asT1, 'submissions', 'SUB_RUB09'), { rubricaEval: [1, 0], calificacion: 7 }))
ok('A09 · owning teacher CAN still grade with a rubric')

await assertSucceeds(updateDoc(doc(asT1, 'submissions', 'SUB_RUB09'), { calificacion: 10 }))
ok('A09 · teacher CAN grade at the exact top of the scale (10 of 10)')

await assertFails(updateDoc(doc(asT1, 'submissions', 'SUB_RUB09'), { calificacion: 50 }))
ok('A09 · teacher CANNOT write 50 on a scale of 10 (was the parcial-close hole)')

await assertFails(updateDoc(doc(asT1, 'submissions', 'SUB_RUB09'), { calificacion: -5 }))
ok('A09 · teacher CANNOT write a negative grade')

await assertSucceeds(updateDoc(doc(asT1, 'submissions', 'SUB_RUB09'), { comentario: 'sigue igual' }))
ok('A09 · unrelated field still saves without touching the grade')

await assertSucceeds(setDoc(doc(asT1, 'submissions', 'SUB_LEGADO09_B'), {
  alumnoId: 'ST_JUAN', actividadId: 'A_LEGADO09', calificacion: 9, estado: 'calificado', sinEntrega: true,
})); ok('A09 · activity with NO maxCalif uses scale 10 and accepts 9')

await assertFails(setDoc(doc(asT1, 'submissions', 'SUB_LEGADO09_C'), {
  alumnoId: 'ST_JUAN', actividadId: 'A_LEGADO09', calificacion: 50, estado: 'calificado', sinEntrega: true,
})); ok('A09 · activity with NO maxCalif still rejects 50')

await assertSucceeds(updateDoc(doc(asT1, 'submissions', 'SUB_LEGADO09'), { comentario: 'revisado' }))
ok('A09 · a LEGACY out-of-range grade can still be edited without touching the grade itself')

await assertFails(updateDoc(doc(asT1, 'submissions', 'SUB_LEGADO09'), { calificacion: 60 }))
ok('A09 · …but correcting its grade requires landing back in range')

await assertSucceeds(updateDoc(doc(asT1, 'submissions', 'SUB_LEGADO09'), { calificacion: 9.5 }))
ok('A09 · …and bringing it down into range works')

await testEnv.cleanup()
console.log(`\nALL ${pass} FIRESTORE-RULES CHECKS PASSED`)
