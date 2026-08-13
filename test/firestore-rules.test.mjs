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
import { doc, collection, addDoc, getDoc, getDocs, query, where, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore'

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
  // Inscripción dada de alta por Excel: sin el campo `uid` siquiera.
  await setDoc(doc(db, 'students', 'ST_SIN_UID'), {
    asignaturaId: 'S1', escuelaId: 'E1', username: 'SINUID', activado: false,
  })
  // Already-activated enrollment owned by U_JUAN — for submission tests.
  await setDoc(doc(db, 'students', 'ST_JUAN'), {
    asignaturaId: 'S1', escuelaId: 'E1', username: 'JUAN', uid: U_JUAN, activado: true,
  })
  await setDoc(doc(db, 'submissions', 'SUB1'), { alumnoId: 'ST_JUAN', actividadId: 'A1' })

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

  // ── A13 · fixtures de asistencia ────────────────────────────────────────────
  await setDoc(doc(db, 'attendance', 'AT_T1_OWN'), {
    asignaturaId: 'S1', docenteId: T1, fecha: '2026-07-01', slot: 1, parcial: 1,
    presentes: { ST_JUAN: true },
  })
  await setDoc(doc(db, 'attendanceSummaries', 'ST_JUAN'), {
    asignaturaId: 'S1', total: { asist: 5, inasist: 1, justif: 0, total: 6 }, registros: [],
  })
  await setDoc(doc(db, 'asuetos', 'AS_T2_OWN'), {
    docenteId: T2, fecha: '2026-08-01', clases: true,
  })
  await setDoc(doc(db, 'vacaciones', 'VAC_T2_OWN'), {
    docenteId: T2, fechaInicio: '2026-07-15', fechaFin: '2026-07-31', clases: true,
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
// Id determinista (A12 · H5 · R22): {actividadId}_{alumnoId}, exigido por la
// regla — ver 'A12 · H5' más abajo para los casos que prueban ESE candado.
await assertSucceeds(setDoc(doc(asJuan, 'submissions', 'A1_ST_JUAN'), {
  alumnoId: 'ST_JUAN', actividadId: 'A1', archivoURL: 'x',
})); ok('student submits their OWN work')

await assertFails(setDoc(doc(asMallory, 'submissions', 'A1_ST_JUAN'), {
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

// Esta prueba esperaba lo contrario y llevaba tiempo fallando: la regla se
// endureció a propósito (borrar una entrega borra su calificación, y eso es
// manipulación de notas si lo hace el alumno), pero la prueba se quedó con el
// comportamiento viejo. Manda la regla, ver el comentario en firestore.rules.
await assertFails(deleteDoc(doc(asJuan, 'submissions', 'SUB1')))
ok('student CANNOT delete their own submission (it would erase the grade)')

await assertSucceeds(deleteDoc(doc(asT1, 'submissions', 'SUB1')))
ok('owning teacher deletes a submission')

// ── A12 · H3 · el servidor cierra el plazo, no solo la pantalla ────────────
await assertFails(setDoc(doc(asJuan, 'submissions', 'A_VENCIDA_ST_JUAN'), {
  alumnoId: 'ST_JUAN', actividadId: 'A_VENCIDA', archivoURL: 'x',
})); ok('student CANNOT create a submission after fechaLimite')

await assertSucceeds(setDoc(doc(asJuan, 'submissions', 'A_TARDE_OK_ST_JUAN'), {
  alumnoId: 'ST_JUAN', actividadId: 'A_TARDE_OK', archivoURL: 'x',
})); ok('student CAN submit late when recibirTarde is enabled')

await assertSucceeds(setDoc(doc(asJuan, 'submissions', 'A_FUTURA_ST_JUAN'), {
  alumnoId: 'ST_JUAN', actividadId: 'A_FUTURA', archivoURL: 'x',
})); ok('student CAN submit before fechaLimite')

await assertFails(setDoc(doc(asJuan, 'submissions', 'A_CERRADA_MANUAL_ST_JUAN'), {
  alumnoId: 'ST_JUAN', actividadId: 'A_CERRADA_MANUAL', archivoURL: 'x',
})); ok('student CANNOT submit once the teacher closed it manually')

await assertSucceeds(setDoc(doc(asJuan, 'submissions', 'A_SIN_TS_ST_JUAN'), {
  alumnoId: 'ST_JUAN', actividadId: 'A_SIN_TS', archivoURL: 'x',
})); ok('student CAN still submit to a legacy activity with no fechaLimiteTS yet (absent field never blocks)')

await assertSucceeds(setDoc(doc(asJuan, 'submissions', 'A_EXTENSION_ST_JUAN'), {
  alumnoId: 'ST_JUAN', actividadId: 'A_EXTENSION', archivoURL: 'x',
})); ok('student WITH a personal extension CAN submit past the group fechaLimite')

// El docente dueño sigue pudiendo marcar/crear entregas de una actividad
// vencida — el candado es solo para el alumno, no para su propio trabajo.
// Mismo id que usaría el alumno para esa pareja (arriba, denegado): el
// docente SÍ puede crearlo, confirmando que el candado de vencimiento es
// solo del lado del alumno, no del formato del id.
await assertSucceeds(setDoc(doc(asT1, 'submissions', 'A_VENCIDA_ST_JUAN'), {
  alumnoId: 'ST_JUAN', actividadId: 'A_VENCIDA', docenteId: T1, completadoSinArchivo: true,
})); ok('owning teacher CAN still create a submission on an expired activity')

// ── A12 · H5 · R22 · id determinista — nada más se puede crear ─────────────
await assertFails(setDoc(doc(asJuan, 'submissions', 'SUB_ID_LIBRE'), {
  alumnoId: 'ST_JUAN', actividadId: 'A_FUTURA', archivoURL: 'x',
})); ok('student CANNOT create a submission with a random id — must be {actividadId}_{alumnoId}')

await assertFails(setDoc(doc(asT1, 'submissions', 'SUB_ID_LIBRE_DOCENTE'), {
  alumnoId: 'ST_JUAN', actividadId: 'A_FUTURA', docenteId: T1, sinEntrega: true,
})); ok('teacher CANNOT create a submission with a random id either')

// Segundo intento sobre la MISMA pareja (doble clic, dos pestañas): con el id
// determinista cae en el mismo path que la entrega que ya existe — para
// Firestore eso es un UPDATE, no una fila nueva, así que lo bloquea
// studentNoTocaCalificacion() en vez de crear un duplicado.
await assertFails(setDoc(doc(asJuan, 'submissions', 'A_FUTURA_ST_JUAN'), {
  alumnoId: 'ST_JUAN', actividadId: 'A_FUTURA', archivoURL: 'y', estado: 'calificado',
})); ok('a second "create" attempt on the SAME pair lands on update rules, not a duplicate row')

// ── respuestas subcollection ─────────────────────────────────────────────────
await assertSucceeds(setDoc(doc(asJuan, 'submissions', 'A1_ST_JUAN', 'respuestas', 'Q1'), { valor: 'a' }))
ok('student writes an answer to their OWN attempt')

await assertFails(setDoc(doc(asMallory, 'submissions', 'A1_ST_JUAN', 'respuestas', 'Q1'), { valor: 'x' }))
ok('attacker CANNOT write answers to another student’s attempt')

await assertSucceeds(setDoc(doc(asT1, 'submissions', 'A1_ST_JUAN', 'respuestas', 'Q1'), { puntosObtenidos: 5 }))
ok('owning teacher writes revision points on an answer')

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
await assertSucceeds(setDoc(doc(asJuan, 'submissions', 'A_VENC_ST_JUAN_VENC'), {
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

// Bloque 4 (13-ago-2026): 'mayor' (Asistente IA Pro, $199) ya es un plan
// aceptado por la regla — CheckoutModal todavía no lo ofrece
// (`plans/mayor.activo` sigue en false), pero el servidor ya sabe cobrarlo
// correctamente el día que se active.
await assertSucceeds(setDoc(doc(asT1, 'payments', 'PAY_MAYOR'), pagoValido({ planId: 'mayor', monto: 199, mesesPagados: 1 })))
ok('teacher CAN declare a transfer payment on the mayor plan (1 month, $199)')

// 'mayor' no tiene política de varios meses todavía (decisión comercial
// pendiente) — la regla lo rechaza en vez de aceptar un monto que nadie
// definió.
await assertFails(setDoc(doc(asT1, 'payments', 'PAY_MAYOR_6M'), pagoValido({ planId: 'mayor', monto: 1000, mesesPagados: 6 })))
ok('teacher CANNOT claim multiple months on the mayor plan (no discount policy exists yet)')

// Cualquier `planId` que no sea 'pro' ni 'mayor' se rechaza — el mismo
// candado que ya protegía contra 'anual' cierra la puerta a cualquier valor
// inventado (Bloque 4: revisión de seguridad, 13-ago-2026).
await assertFails(setDoc(doc(asT1, 'payments', 'PAY_PLAN_INVENTADO'), pagoValido({ planId: 'super' })))
ok('teacher CANNOT declare a payment on a made-up planId')

await assertFails(setDoc(doc(asT1, 'payments', 'PAY_PLAN_TRIAL'), pagoValido({ planId: 'trial' })))
ok('teacher CANNOT declare a payment on planId "trial" (not a payable plan)')

// ── Bloque 7 (13-ago-2026): el MONTO ahora SÍ se valida contra la tarifa ──
// exacta vía montoOficialPago — cierra el hueco que el Bloque 4 solo había
// documentado (antes cualquier monto en (0, 5000] pasaba). Una tabla
// completa: cada tarifa oficial de `pro` (1-6 meses) permitida, y cualquier
// desviación de un peso rechazada — tanto para `pro` como para `mayor`.
const TARIFAS_PRO = [
  [1, 99], [2, 190], [3, 273], [4, 348], [5, 415], [6, 474],
]
for (const [meses, monto] of TARIFAS_PRO) {
  await assertSucceeds(setDoc(doc(asT1, 'payments', `PAY_PRO_${meses}M_OK`), pagoValido({ planId: 'pro', mesesPagados: meses, monto })))
  ok(`teacher CAN declare pro + ${meses} month(s) at the exact tariff ($${monto})`)
}

await assertSucceeds(setDoc(doc(asT1, 'payments', 'PAY_MAYOR_OK'), pagoValido({ planId: 'mayor', mesesPagados: 1, monto: 199 })))
ok('teacher CAN declare mayor + 1 month at the exact tariff ($199)')

// Declarar mayor por debajo de la tarifa ($198, un peso menos) — el hallazgo
// exacto que pidió la revisión: ahora el servidor lo rechaza, ya no depende
// solo de que el admin lo note a mano.
await assertFails(setDoc(doc(asT1, 'payments', 'PAY_MAYOR_BARATO'), pagoValido({ planId: 'mayor', monto: 198, mesesPagados: 1 })))
ok('teacher CANNOT declare mayor at $198 (one peso below the $199 tariff) — server now rejects it')

await assertFails(setDoc(doc(asT1, 'payments', 'PAY_MAYOR_CARO'), pagoValido({ planId: 'mayor', monto: 200, mesesPagados: 1 })))
ok('teacher CANNOT declare mayor at $200 (one peso above the $199 tariff either)')

// Bloque 8 (revisión crítica, 13-ago-2026): casos exactos pedidos — intentar
// pagar 'mayor' con el precio o los precios de descuento de 'pro'.
await assertFails(setDoc(doc(asT1, 'payments', 'PAY_MAYOR_PRECIO_PRO_1M'), pagoValido({ planId: 'mayor', monto: 99, mesesPagados: 1 })))
ok('teacher CANNOT declare mayor at $99 (the pro 1-month price)')

await assertFails(setDoc(doc(asT1, 'payments', 'PAY_MAYOR_PRECIO_PRO_2M'), pagoValido({ planId: 'mayor', monto: 190, mesesPagados: 1 })))
ok('teacher CANNOT declare mayor at $190 (the pro 2-month discounted price)')

await assertFails(setDoc(doc(asT1, 'payments', 'PAY_PRO_BARATO'), pagoValido({ planId: 'pro', monto: 1, mesesPagados: 1 })))
ok('teacher CANNOT declare pro at $1 — must match the exact tariff for the declared months')

await assertFails(setDoc(doc(asT1, 'payments', 'PAY_PRO_1M_MAL'), pagoValido({ planId: 'pro', mesesPagados: 1, monto: 100 })))
ok('teacher CANNOT declare pro + 1 month at $100 (off by one peso from the $99 tariff)')

// mayor a 2-6 meses sigue sin tarifa oficial — se rechaza igual, ahora
// también aunque alguien intente adivinar un monto "razonable" para ellos.
for (const meses of [2, 3, 4, 5, 6]) {
  await assertFails(setDoc(doc(asT1, 'payments', `PAY_MAYOR_MULTI_${meses}M`), pagoValido({ planId: 'mayor', mesesPagados: meses, monto: 199 * meses })))
  ok(`teacher CANNOT declare mayor + ${meses} months at any price — no prepay discount policy exists for mayor`)
}

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

await assertSucceeds(setDoc(doc(asT1, 'submissions', 'A_LEGADO09_ST_JUAN'), {
  alumnoId: 'ST_JUAN', actividadId: 'A_LEGADO09', calificacion: 9, estado: 'calificado', sinEntrega: true,
})); ok('A09 · activity with NO maxCalif uses scale 10 and accepts 9')

// Misma pareja que arriba: ya existe, así que esto es un update — sigue
// probando lo mismo (rechaza 50 fuera de escala), ahora por
// calificacionEnRangoSiCambia() en vez de calificacionEnRango().
await assertFails(setDoc(doc(asT1, 'submissions', 'A_LEGADO09_ST_JUAN'), {
  alumnoId: 'ST_JUAN', actividadId: 'A_LEGADO09', calificacion: 50, estado: 'calificado', sinEntrega: true,
})); ok('A09 · activity with NO maxCalif still rejects 50')

await assertSucceeds(updateDoc(doc(asT1, 'submissions', 'SUB_LEGADO09'), { comentario: 'revisado' }))
ok('A09 · a LEGACY out-of-range grade can still be edited without touching the grade itself')

await assertFails(updateDoc(doc(asT1, 'submissions', 'SUB_LEGADO09'), { calificacion: 60 }))
ok('A09 · …but correcting its grade requires landing back in range')

await assertSucceeds(updateDoc(doc(asT1, 'submissions', 'SUB_LEGADO09'), { calificacion: 9.5 }))
ok('A09 · …and bringing it down into range works')

// ── A13 · Asistencia, resumen y días no laborables ───────────────────────────
// Reglas: attendance (isDocente/isAdmin lee; docenteActivo+ownsSubject crea;
// docenteActivo+propio docente actualiza/borra) · attendanceSummaries (solo el
// propio alumno lee vía ownsStudentDoc; nadie escribe desde el cliente, solo el
// Admin SDK) · asuetos/vacaciones (dueño lee y escribe).

await assertSucceeds(setDoc(doc(asT1, 'attendance', 'AT_NEW'), {
  asignaturaId: 'S1', docenteId: T1, fecha: '2026-08-07', slot: 1, parcial: 2, presentes: {},
})); ok('A13 · teacher CAN create attendance for own subject')

await assertFails(setDoc(doc(asT2, 'attendance', 'AT_INTRUSO'), {
  asignaturaId: 'S1', docenteId: T2, fecha: '2026-08-07', slot: 1, parcial: 2, presentes: {},
})); ok('A13 · foreign teacher CANNOT create attendance for another subject')

await assertFails(updateDoc(doc(asT2, 'attendance', 'AT_T1_OWN'), {
  'presentes.ST_JUAN': false,
})); ok('A13 · foreign teacher CANNOT update attendance owned by another teacher')

await assertFails(deleteDoc(doc(asT2, 'attendance', 'AT_T1_OWN')))
ok('A13 · foreign teacher CANNOT delete attendance owned by another teacher')

await assertFails(getDoc(doc(asJuan, 'attendance', 'AT_T1_OWN')))
ok('A13 · student CANNOT read attendance (teacher/admin only)')

await assertSucceeds(getDoc(doc(asJuan, 'attendanceSummaries', 'ST_JUAN')))
ok('A13 · student CAN read own attendanceSummaries')

await assertFails(getDoc(doc(asT2, 'attendanceSummaries', 'ST_JUAN')))
ok('A13 · teacher CANNOT read a student\'s attendanceSummaries')

await assertFails(setDoc(doc(asJuan, 'attendanceSummaries', 'ST_JUAN'), {
  asignaturaId: 'S1', total: { asist: 99 },
})); ok('A13 · student CANNOT write to attendanceSummaries (Admin SDK only)')

await assertFails(setDoc(doc(asT1, 'attendanceSummaries', 'ST_JUAN'), {
  asignaturaId: 'S1', total: { asist: 99 },
})); ok('A13 · teacher CANNOT write to attendanceSummaries (Admin SDK only)')

await assertSucceeds(setDoc(doc(asT1, 'asuetos', 'AS_T1_NEW'), {
  docenteId: T1, fecha: '2026-09-01', clases: true,
})); ok('A13 · teacher CAN create own asueto')

await assertFails(setDoc(doc(asT1, 'asuetos', 'AS_EVIL'), {
  docenteId: T2, fecha: '2026-09-01', clases: true,
})); ok('A13 · teacher CANNOT create asueto attributed to another teacher')

await assertFails(getDoc(doc(asT1, 'asuetos', 'AS_T2_OWN')))
ok('A13 · teacher CANNOT read another teacher\'s asueto')

await assertSucceeds(setDoc(doc(asT1, 'vacaciones', 'VAC_T1_NEW'), {
  docenteId: T1, fechaInicio: '2026-09-15', fechaFin: '2026-09-30', clases: true,
})); ok('A13 · teacher CAN create own vacaciones')

await assertFails(setDoc(doc(asT1, 'vacaciones', 'VAC_EVIL'), {
  docenteId: T2, fechaInicio: '2026-09-15', fechaFin: '2026-09-30', clases: true,
})); ok('A13 · teacher CANNOT create vacaciones attributed to another teacher')

await assertFails(getDoc(doc(asT1, 'vacaciones', 'VAC_T2_OWN')))
ok('A13 · teacher CANNOT read another teacher\'s vacaciones')

// ── A18 · Calendario y agenda ────────────────────────────────────────────────
// Reglas: events/horario (dueño-privado) · academicEvents/horarioBloques
// (lectura amplia a cualquier autenticado, escritura solo al dueño activo) ·
// studentEvents (lectura/escritura solo al alumno dueño por uid de Auth).

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'events', 'EV_T1'), { docenteId: T1, titulo: 'Reunión', fecha: '2026-09-01' })
  await setDoc(doc(db, 'events', 'EV_T2'), { docenteId: T2, titulo: 'Reunión ajena', fecha: '2026-09-02' })
  await setDoc(doc(db, 'academicEvents', 'AEV_T1'), { docenteId: T1, asignaturaId: 'S1', titulo: 'Examen parcial', fecha: '2026-09-10' })
  await setDoc(doc(db, 'studentEvents', 'SEV_JUAN'), { alumnoId: U_JUAN, titulo: 'Estudiar', fecha: '2026-09-05' })
  await setDoc(doc(db, 'horarioBloques', 'HB_T1'), { docenteId: T1, asignaturaId: 'S1', dia: 'lunes', hora: '08:00' })
  await setDoc(doc(db, 'horarioBloques', 'HB_T2'), { docenteId: T2, asignaturaId: 'S2', dia: 'martes', hora: '10:00' })
  await setDoc(doc(db, 'horario', 'HOR_T1'), { docenteId: T1, titulo: 'Matemáticas', dia: 'lunes' })
  await setDoc(doc(db, 'horario', 'HOR_T2'), { docenteId: T2, titulo: 'Física', dia: 'miércoles' })
})

// events — eventos personales del docente (solo el dueño los ve)
await assertSucceeds(getDoc(doc(asT1, 'events', 'EV_T1')))
ok('A18 · teacher CAN read own event')

await assertFails(getDoc(doc(asT2, 'events', 'EV_T1')))
ok('A18 · foreign teacher CANNOT read another teacher\'s event')

await assertFails(getDoc(doc(asJuan, 'events', 'EV_T1')))
ok('A18 · student CANNOT read a teacher\'s event')

await assertSucceeds(setDoc(doc(asT1, 'events', 'EV_NEW'), { docenteId: T1, titulo: 'Nuevo', fecha: '2026-10-01' }))
ok('A18 · teacher CAN create own event')

await assertFails(setDoc(doc(asT1, 'events', 'EV_EVIL'), { docenteId: T2, titulo: 'Usurpado', fecha: '2026-10-01' }))
ok('A18 · teacher CANNOT create event attributed to another teacher')

await assertFails(updateDoc(doc(asT2, 'events', 'EV_T1'), { titulo: 'Hackeado' }))
ok('A18 · foreign teacher CANNOT update another teacher\'s event')

await assertFails(deleteDoc(doc(asT2, 'events', 'EV_T1')))
ok('A18 · foreign teacher CANNOT delete another teacher\'s event')

// academicEvents — compartidos con alumnos de la asignatura (lectura amplia)
await assertSucceeds(getDoc(doc(asT1, 'academicEvents', 'AEV_T1')))
ok('A18 · teacher CAN read academicEvent (any authenticated)')

await assertSucceeds(getDoc(doc(asJuan, 'academicEvents', 'AEV_T1')))
ok('A18 · student CAN read academicEvent (public for enrolled students)')

await assertSucceeds(setDoc(doc(asT1, 'academicEvents', 'AEV_NEW'), {
  docenteId: T1, asignaturaId: 'S1', titulo: 'Nuevo académico', fecha: '2026-10-05',
}))
ok('A18 · teacher CAN create academicEvent for own subject')

await assertFails(setDoc(doc(asT1, 'academicEvents', 'AEV_EVIL'), {
  docenteId: T1, asignaturaId: 'S2', titulo: 'Invasión', fecha: '2026-10-05',
}))
ok('A18 · teacher CANNOT create academicEvent for a subject they do not own')

await assertFails(updateDoc(doc(asT2, 'academicEvents', 'AEV_T1'), { titulo: 'Alterado' }))
ok('A18 · foreign teacher CANNOT update another teacher\'s academicEvent')

await assertFails(deleteDoc(doc(asT2, 'academicEvents', 'AEV_T1')))
ok('A18 · foreign teacher CANNOT delete another teacher\'s academicEvent')

// studentEvents — agenda personal del alumno (solo el dueño por uid de Auth)
await assertSucceeds(getDoc(doc(asJuan, 'studentEvents', 'SEV_JUAN')))
ok('A18 · student CAN read own studentEvent')

await assertFails(getDoc(doc(asT1, 'studentEvents', 'SEV_JUAN')))
ok('A18 · teacher CANNOT read a student\'s personal event')

await assertSucceeds(setDoc(doc(asJuan, 'studentEvents', 'SEV_NEW'), { alumnoId: U_JUAN, titulo: 'Tarea', fecha: '2026-10-10' }))
ok('A18 · student CAN create own studentEvent')

await assertFails(setDoc(doc(asJuan, 'studentEvents', 'SEV_EVIL'), { alumnoId: T1, titulo: 'Usurpado', fecha: '2026-10-10' }))
ok('A18 · student CANNOT create studentEvent attributed to another user')

await assertFails(updateDoc(doc(asT1, 'studentEvents', 'SEV_JUAN'), { titulo: 'Alterado por docente' }))
ok('A18 · teacher CANNOT update a student\'s personal event')

// horarioBloques — lectura amplia (alumno necesita "Próxima clase"), escritura del dueño
await assertSucceeds(getDoc(doc(asJuan, 'horarioBloques', 'HB_T1')))
ok('A18 · student CAN read horarioBloque (needed for "Próxima clase" in agenda)')

await assertSucceeds(getDoc(doc(asT1, 'horarioBloques', 'HB_T1')))
ok('A18 · teacher CAN read any horarioBloque (any authenticated)')

await assertSucceeds(setDoc(doc(asT1, 'horarioBloques', 'HB_NEW'), { docenteId: T1, asignaturaId: 'S1', dia: 'viernes', hora: '09:00' }))
ok('A18 · teacher CAN create own horarioBloque')

await assertFails(setDoc(doc(asT1, 'horarioBloques', 'HB_EVIL'), { docenteId: T2, asignaturaId: 'S2', dia: 'viernes', hora: '09:00' }))
ok('A18 · teacher CANNOT create horarioBloque attributed to another teacher')

await assertFails(updateDoc(doc(asT2, 'horarioBloques', 'HB_T1'), { dia: 'jueves' }))
ok('A18 · foreign teacher CANNOT update another teacher\'s horarioBloque')

await assertFails(deleteDoc(doc(asT2, 'horarioBloques', 'HB_T1')))
ok('A18 · foreign teacher CANNOT delete another teacher\'s horarioBloque')

// horario — bloques recurrentes legacy (mismo patrón privado que events)
await assertSucceeds(getDoc(doc(asT1, 'horario', 'HOR_T1')))
ok('A18 · teacher CAN read own horario block')

await assertFails(getDoc(doc(asT2, 'horario', 'HOR_T1')))
ok('A18 · foreign teacher CANNOT read another teacher\'s horario block')

await assertFails(getDoc(doc(asJuan, 'horario', 'HOR_T1')))
ok('A18 · student CANNOT read a teacher\'s horario block (legacy, owner-private)')

await assertSucceeds(setDoc(doc(asT1, 'horario', 'HOR_NEW'), { docenteId: T1, titulo: 'Quím', dia: 'jueves' }))
ok('A18 · teacher CAN create own horario block')

await assertFails(setDoc(doc(asT1, 'horario', 'HOR_EVIL'), { docenteId: T2, titulo: 'Usurpado', dia: 'jueves' }))
ok('A18 · teacher CANNOT create horario block attributed to another teacher')

await assertFails(updateDoc(doc(asT2, 'horario', 'HOR_T1'), { titulo: 'Alterado' }))
ok('A18 · foreign teacher CANNOT update another teacher\'s horario block')

// ── A14 · Avisos ─────────────────────────────────────────────────────────────
// Reglas: avisos (lectura amplia, escritura del dueño activo con ownsSubject) ·
// avisoLecturas (docente o alumno dueño lee; alumno crea; nadie edita/borra) ·
// avisoGuardados/avisoOcultos (solo el alumno dueño por ownsStudentDoc) ·
// avisoPlantillas (solo el docente dueño).

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'avisos', 'AV_T1'), { docenteId: T1, asignaturaId: 'S1', titulo: 'Examen', activo: true })
  await setDoc(doc(db, 'avisos', 'AV_T2'), { docenteId: T2, asignaturaId: 'S2', titulo: 'Proyecto', activo: true })
  await setDoc(doc(db, 'avisoLecturas', 'AL_JUAN'), { estudianteId: 'ST_JUAN', avisoId: 'AV_T1', asignaturaId: 'S1' })
  await setDoc(doc(db, 'avisoGuardados', 'AG_JUAN'), { estudianteId: 'ST_JUAN', avisoId: 'AV_T1' })
  await setDoc(doc(db, 'avisoOcultos', 'AO_JUAN'), { estudianteId: 'ST_JUAN', avisoId: 'AV_T1' })
  await setDoc(doc(db, 'avisoPlantillas', 'AP_T1'), { docenteId: T1, emoji: '📢', label: 'Aviso rápido' })
  await setDoc(doc(db, 'avisoPlantillas', 'AP_T2'), { docenteId: T2, emoji: '📢', label: 'Aviso ajena' })
})

// avisos — lectura amplia; escritura solo al dueño activo con ownsSubject
await assertSucceeds(getDoc(doc(asT1, 'avisos', 'AV_T1')))
ok('A14 · teacher CAN read own aviso')

await assertSucceeds(getDoc(doc(asJuan, 'avisos', 'AV_T1')))
ok('A14 · student CAN read aviso (public for enrolled students)')

await assertSucceeds(setDoc(doc(asT1, 'avisos', 'AV_NEW'), { docenteId: T1, asignaturaId: 'S1', titulo: 'Nuevo', activo: true }))
ok('A14 · teacher CAN create aviso for own subject')

await assertFails(setDoc(doc(asT1, 'avisos', 'AV_EVIL1'), { docenteId: T1, asignaturaId: 'S2', titulo: 'Invasión', activo: true }))
ok('A14 · teacher CANNOT create aviso for a subject they do not own')

await assertFails(setDoc(doc(asT1, 'avisos', 'AV_EVIL2'), { docenteId: T2, asignaturaId: 'S2', titulo: 'Usurpado', activo: true }))
ok('A14 · teacher CANNOT create aviso attributed to another teacher')

await assertFails(updateDoc(doc(asT2, 'avisos', 'AV_T1'), { titulo: 'Hackeado' }))
ok('A14 · foreign teacher CANNOT update another teacher\'s aviso')

await assertFails(deleteDoc(doc(asT2, 'avisos', 'AV_T1')))
ok('A14 · foreign teacher CANNOT delete another teacher\'s aviso')

// avisoLecturas — docente o alumno-dueño lee; alumno-dueño crea; nadie edita/borra
await assertSucceeds(getDoc(doc(asT1, 'avisoLecturas', 'AL_JUAN')))
ok('A14 · teacher CAN read avisoLectura (needed for progress bar)')

await assertSucceeds(getDoc(doc(asJuan, 'avisoLecturas', 'AL_JUAN')))
ok('A14 · student CAN read own avisoLectura')

await assertFails(getDoc(doc(asIntruso, 'avisoLecturas', 'AL_JUAN')))
ok('A14 · stranger CANNOT read another student\'s avisoLectura')

await assertSucceeds(setDoc(doc(asJuan, 'avisoLecturas', 'AL_NEW'), { estudianteId: 'ST_JUAN', avisoId: 'AV_T1', asignaturaId: 'S1' }))
ok('A14 · student CAN create own avisoLectura ("Entendido")')

await assertFails(setDoc(doc(asIntruso, 'avisoLecturas', 'AL_EVIL'), { estudianteId: 'ST_JUAN', avisoId: 'AV_T1', asignaturaId: 'S1' }))
ok('A14 · stranger CANNOT create avisoLectura for another student')

await assertFails(updateDoc(doc(asJuan, 'avisoLecturas', 'AL_JUAN'), { notas: 'modificado' }))
ok('A14 · student CANNOT update avisoLectura (immutable audit record)')

await assertFails(deleteDoc(doc(asJuan, 'avisoLecturas', 'AL_JUAN')))
ok('A14 · student CANNOT delete avisoLectura (immutable audit record)')

// avisoGuardados — solo el alumno dueño por ownsStudentDoc
await assertSucceeds(getDoc(doc(asJuan, 'avisoGuardados', 'AG_JUAN')))
ok('A14 · student CAN read own avisoGuardado')

await assertFails(getDoc(doc(asT1, 'avisoGuardados', 'AG_JUAN')))
ok('A14 · teacher CANNOT read a student\'s avisoGuardado (personal bookmark)')

await assertSucceeds(setDoc(doc(asJuan, 'avisoGuardados', 'AG_NEW'), { estudianteId: 'ST_JUAN', avisoId: 'AV_T1' }))
ok('A14 · student CAN save own aviso')

await assertFails(setDoc(doc(asIntruso, 'avisoGuardados', 'AG_EVIL'), { estudianteId: 'ST_JUAN', avisoId: 'AV_T1' }))
ok('A14 · stranger CANNOT save aviso attributed to another student')

await assertFails(updateDoc(doc(asJuan, 'avisoGuardados', 'AG_JUAN'), { extra: true }))
ok('A14 · student CANNOT update avisoGuardado (create/delete only)')

await assertSucceeds(deleteDoc(doc(asJuan, 'avisoGuardados', 'AG_JUAN')))
ok('A14 · student CAN unsave own aviso')

await assertFails(deleteDoc(doc(asIntruso, 'avisoGuardados', 'AG_NEW')))
ok('A14 · stranger CANNOT delete another student\'s avisoGuardado')

// avisoOcultos — mismo patrón que avisoGuardados
await assertSucceeds(getDoc(doc(asJuan, 'avisoOcultos', 'AO_JUAN')))
ok('A14 · student CAN read own avisoOculto')

await assertFails(getDoc(doc(asT1, 'avisoOcultos', 'AO_JUAN')))
ok('A14 · teacher CANNOT read a student\'s avisoOculto')

await assertSucceeds(setDoc(doc(asJuan, 'avisoOcultos', 'AO_NEW'), { estudianteId: 'ST_JUAN', avisoId: 'AV_T1' }))
ok('A14 · student CAN hide own aviso')

await assertFails(setDoc(doc(asIntruso, 'avisoOcultos', 'AO_EVIL'), { estudianteId: 'ST_JUAN', avisoId: 'AV_T1' }))
ok('A14 · stranger CANNOT hide aviso attributed to another student')

await assertFails(deleteDoc(doc(asT1, 'avisoOcultos', 'AO_JUAN')))
ok('A14 · teacher CANNOT delete a student\'s avisoOculto')

// avisoPlantillas — solo el docente dueño (no lectura pública)
await assertSucceeds(getDoc(doc(asT1, 'avisoPlantillas', 'AP_T1')))
ok('A14 · teacher CAN read own avisoPlantilla')

await assertFails(getDoc(doc(asT2, 'avisoPlantillas', 'AP_T1')))
ok('A14 · foreign teacher CANNOT read another teacher\'s avisoPlantilla')

await assertFails(getDoc(doc(asJuan, 'avisoPlantillas', 'AP_T1')))
ok('A14 · student CANNOT read any avisoPlantilla')

await assertSucceeds(setDoc(doc(asT1, 'avisoPlantillas', 'AP_NEW'), { docenteId: T1, emoji: '🔔', label: 'Nueva plantilla' }))
ok('A14 · teacher CAN create own avisoPlantilla')

await assertFails(setDoc(doc(asT1, 'avisoPlantillas', 'AP_EVIL'), { docenteId: T2, emoji: '🔔', label: 'Usurpada' }))
ok('A14 · teacher CANNOT create avisoPlantilla attributed to another teacher')

await assertFails(updateDoc(doc(asT2, 'avisoPlantillas', 'AP_T1'), { label: 'Alterada' }))
ok('A14 · foreign teacher CANNOT update another teacher\'s avisoPlantilla')

await assertFails(deleteDoc(doc(asT2, 'avisoPlantillas', 'AP_T1')))
ok('A14 · foreign teacher CANNOT delete another teacher\'s avisoPlantilla')

// ── A15 · Notificaciones push ─────────────────────────────────────────────────
// Reglas: notificationSettings (owner-only read+write por uid de Auth) ·
// notificationLog (owner-only read+delete por resource.data.uid; create
// requiere que request.resource.data.uid coincida con el uid de Auth).

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'notificationSettings', T1), { fcmTokens: ['tok_t1'], avisos: { habilitado: true } })
  await setDoc(doc(db, 'notificationSettings', T2), { fcmTokens: ['tok_t2'], avisos: { habilitado: true } })
  await setDoc(doc(db, 'notificationLog', 'NL_T1'), { uid: T1, titulo: 'Aviso', categoria: 'avisos' })
  await setDoc(doc(db, 'notificationLog', 'NL_T2'), { uid: T2, titulo: 'Entrega', categoria: 'nuevasEntregas' })
})

// notificationSettings — owner-only: solo el propio uid puede leer y escribir
await assertSucceeds(getDoc(doc(asT1, 'notificationSettings', T1)))
ok('A15 · user CAN read own notificationSettings')

await assertSucceeds(setDoc(doc(asT1, 'notificationSettings', T1), { avisos: { habilitado: false } }, { merge: true }))
ok('A15 · user CAN write own notificationSettings (toggle preference)')

await assertFails(getDoc(doc(asT2, 'notificationSettings', T1)))
ok('A15 · foreign user CANNOT read another user\'s notificationSettings')

await assertFails(setDoc(doc(asT2, 'notificationSettings', T1), { fcmTokens: ['evil_token'] }))
ok('A15 · foreign user CANNOT write another user\'s notificationSettings (no token injection)')

await assertFails(setDoc(doc(asJuan, 'notificationSettings', T1), { fcmTokens: ['evil_token'] }))
ok('A15 · student CANNOT inject a token into a teacher\'s notificationSettings')

// notificationLog — owner-only: solo el uid del campo uid puede leer/borrar; al crear, uid debe coincidir
await assertSucceeds(getDoc(doc(asT1, 'notificationLog', 'NL_T1')))
ok('A15 · user CAN read own notificationLog entry')

await assertFails(getDoc(doc(asT2, 'notificationLog', 'NL_T1')))
ok('A15 · foreign user CANNOT read another user\'s notificationLog entry')

await assertSucceeds(setDoc(doc(asT1, 'notificationLog', 'NL_T1_NEW'), { uid: T1, titulo: 'local', categoria: 'recordatorios' }))
ok('A15 · user CAN create own notificationLog entry (local reminders)')

await assertFails(setDoc(doc(asT1, 'notificationLog', 'NL_EVIL'), { uid: T2, titulo: 'Hack', categoria: 'avisos' }))
ok('A15 · user CANNOT create notificationLog entry attributed to another user')

await assertSucceeds(deleteDoc(doc(asT1, 'notificationLog', 'NL_T1')))
ok('A15 · user CAN delete own notificationLog entry')

await assertFails(deleteDoc(doc(asT2, 'notificationLog', 'NL_T1_NEW')))
ok('A15 · foreign user CANNOT delete another user\'s notificationLog entry')

// ── Créditos IA — el cliente JAMÁS escribe su saldo ─────────────────────────
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'iaCreditos', T1), { plan: 'pro', capacidad: 350, saldo: 120, consumidoCiclo: 230 })
  await setDoc(doc(db, 'iaConsumos', 'CONS_T1'), { uid: T1, operacion: 'aviso', estado: 'ejecutado', creditosReales: 1 })
  await setDoc(doc(db, 'iaConsumosInterno', 'CONS_T1'), { uid: T1, tokensEntrada: 700, tokensSalida: 150 })
  await setDoc(doc(db, 'iaTrialRegistro', T1), { uid: T1, creditosAsignados: 350 })
})

await assertSucceeds(getDoc(doc(asT1, 'iaCreditos', T1)))
ok('IA · docente CAN read own credit balance (the bar lives on this)')

await assertFails(getDoc(doc(asT2, 'iaCreditos', T1)))
ok('IA · foreign user CANNOT read another teacher\'s credit balance')

await assertFails(setDoc(doc(asT1, 'iaCreditos', T1), { saldo: 999999 }, { merge: true }))
ok('IA · owner CANNOT inflate own balance (no client writes, ever)')

await assertFails(updateDoc(doc(asT1, 'iaCreditos', T1), { saldo: 350 }))
ok('IA · owner CANNOT reset own balance via update')

await assertFails(deleteDoc(doc(asT1, 'iaCreditos', T1)))
ok('IA · owner CANNOT delete own credit doc (would re-mint a full bag)')

await assertSucceeds(getDoc(doc(asT1, 'iaConsumos', 'CONS_T1')))
ok('IA · docente CAN read own consumption history (panel detail)')

await assertFails(getDoc(doc(asT2, 'iaConsumos', 'CONS_T1')))
ok('IA · foreign user CANNOT read another teacher\'s consumption')

await assertFails(setDoc(doc(asT1, 'iaConsumos', 'CONS_FAKE'), { uid: T1, estado: 'ejecutado', creditosReales: 0 }))
ok('IA · client CANNOT forge consumption records')

await assertFails(getDoc(doc(asT1, 'iaConsumosInterno', 'CONS_T1')))
ok('IA · NOBODY (client-side) can read internal token metrics')

await assertFails(getDoc(doc(asT1, 'iaTrialRegistro', T1)))
ok('IA · NOBODY (client-side) can read the trial measurement registry')

await assertSucceeds(getDoc(doc(asT1, 'config', 'iaTarifas')))
ok('IA · authenticated client CAN read the public tariff config (estimations)')

await assertFails(setDoc(doc(asT1, 'config', 'iaTarifas'), { tarifas: { aviso: 0 } }, { merge: true }))
ok('IA · docente CANNOT rewrite tariffs (admin/server only)')

// ── Sugerencias C-02 persistidas (candado + recuperación) ───────────────────
// Las crea SOLO el servidor tras cobrar; el docente dueño las lee para
// recuperarlas (gratis) y las marca aplicadas; el alumno jamás las ve.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'activities', 'A1', 'iaSugerencias', 'SUB1_P1'), {
    estado: 'pendiente', actividadId: 'A1', sub: 'SUB1', preg: 'P1',
    sugerencia: { puntos: 1.5, retroalimentacion: 'borrador' },
  })
})

await assertSucceeds(getDoc(doc(asT1, 'activities', 'A1', 'iaSugerencias', 'SUB1_P1')))
ok('IA · owner teacher CAN read a persisted C-02 suggestion (recovery is free)')

await assertFails(getDoc(doc(asT2, 'activities', 'A1', 'iaSugerencias', 'SUB1_P1')))
ok('IA · foreign teacher CANNOT read another teacher\'s suggestions')

await assertFails(getDoc(doc(asJuan, 'activities', 'A1', 'iaSugerencias', 'SUB1_P1')))
ok('IA · student CANNOT read an unconfirmed suggested grade')

await assertSucceeds(updateDoc(doc(asT1, 'activities', 'A1', 'iaSugerencias', 'SUB1_P1'), { estado: 'aplicada' }))
ok('IA · owner teacher CAN mark own suggestion as applied')

await assertFails(updateDoc(doc(asT2, 'activities', 'A1', 'iaSugerencias', 'SUB1_P1'), { estado: 'aplicada' }))
ok('IA · foreign teacher CANNOT touch another teacher\'s suggestion')

await assertFails(setDoc(doc(asT1, 'activities', 'A1', 'iaSugerencias', 'SUB_FAKE'), { estado: 'pendiente' }))
ok('IA · client CANNOT forge a suggestion/lock doc (server-only create)')

await assertSucceeds(deleteDoc(doc(asT1, 'activities', 'A1', 'iaSugerencias', 'SUB1_P1')))
ok('IA · owner teacher CAN discard own suggestion')

// ── Bitácora de OP-10 (análisis de resultados con IA) ───────────────────────
// Un documento NUEVO por generación, creado por el CLIENTE (el docente ya
// pagó el crédito antes de llegar aquí) vía addDoc — nunca se sobrescribe:
// no hay update ni delete. Mismo patrón de lectura que iaSugerencias: leerla
// no exige suscripción vigente.
const analisis1Ref = await assertSucceeds(addDoc(collection(asT1, 'activities', 'A1', 'analisisIA'), {
  resultado: { totalEstudiantes: 8, totalReactivos: 3, porcentajeAciertosGeneral: 60 },
  generadoEn: serverTimestamp(),
  docenteId: T1,
  entregasConsideradas: 8,
}))
ok('IA · owner teacher CAN create a new bitácora entry (1st generation)')

const analisis2Ref = await assertSucceeds(addDoc(collection(asT1, 'activities', 'A1', 'analisisIA'), {
  resultado: { totalEstudiantes: 15, totalReactivos: 3, porcentajeAciertosGeneral: 70 },
  generadoEn: serverTimestamp(),
  docenteId: T1,
  entregasConsideradas: 15,
}))
ok('IA · a second generation CREATES A NEW document, does not touch the first')

assert.notStrictEqual(analisis1Ref.id, analisis2Ref.id)
ok('IA · the two bitácora entries are distinct documents (never overwritten)')

const analisis1Leido = await assertSucceeds(getDoc(doc(asT1, 'activities', 'A1', 'analisisIA', analisis1Ref.id)))
assert.strictEqual(analisis1Leido.data().resultado.totalEstudiantes, 8)
assert.strictEqual(analisis1Leido.data().entregasConsideradas, 8)
ok('IA · the historical entry keeps its OWN snapshot (8), unaffected by the later 15-entrega run')

const analisis2Leido = await assertSucceeds(getDoc(doc(asT1, 'activities', 'A1', 'analisisIA', analisis2Ref.id)))
assert.strictEqual(analisis2Leido.data().resultado.totalEstudiantes, 15)
ok('IA · the most recent entry has its own snapshot (15)')

await assertFails(addDoc(collection(asT2, 'activities', 'A1', 'analisisIA'), {
  resultado: { totalEstudiantes: 1 }, generadoEn: serverTimestamp(), docenteId: T2, entregasConsideradas: 1,
}))
ok('IA · foreign teacher CANNOT create a bitácora entry on another teacher\'s activity')

await assertFails(addDoc(collection(asT1, 'activities', 'A1', 'analisisIA'), {
  resultado: { totalEstudiantes: 1 }, generadoEn: serverTimestamp(), docenteId: T2, entregasConsideradas: 1,
}))
ok('IA · owner teacher CANNOT forge docenteId to someone else on create')

await assertFails(addDoc(collection(asJuan, 'activities', 'A1', 'analisisIA'), {
  resultado: { totalEstudiantes: 1 }, generadoEn: serverTimestamp(), docenteId: U_JUAN, entregasConsideradas: 1,
}))
ok('IA · student CANNOT create a bitácora entry')

await assertSucceeds(getDoc(doc(asT1, 'activities', 'A1', 'analisisIA', analisis1Ref.id)))
ok('IA · owner teacher CAN read a bitácora entry for FREE (viewing history costs 0 credits)')

await assertFails(getDoc(doc(asT2, 'activities', 'A1', 'analisisIA', analisis1Ref.id)))
ok('IA · foreign teacher CANNOT read another teacher\'s bitácora')

await assertFails(getDoc(doc(asJuan, 'activities', 'A1', 'analisisIA', analisis1Ref.id)))
ok('IA · student CANNOT read the bitácora at all')

await assertFails(updateDoc(doc(asT1, 'activities', 'A1', 'analisisIA', analisis1Ref.id), { entregasConsideradas: 999 }))
ok('IA · NOBODY, not even the owner, can update a bitácora entry (immutable snapshot)')

await assertFails(deleteDoc(doc(asT1, 'activities', 'A1', 'analisisIA', analisis1Ref.id)))
ok('IA · NOBODY, not even the owner, can delete a bitácora entry')

// ── Capa 2 de OP-10 — snapshot de respuestas por intento ────────────────────
// Solo el Admin SDK (Cloud Function onEvaluacionFinalizada) escribe aquí —
// ni el docente ni el alumno, nunca desde el cliente. `submissions/SUB1` se
// borró en la prueba de "docente CAN delete own submission" más arriba —
// se recrea aquí (mismo dueño: actividadId A1, A1.docenteId T1).
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'submissions', 'SUB1'), { alumnoId: 'ST_JUAN', actividadId: 'A1' })
  await setDoc(doc(db, 'submissions', 'SUB1', 'intentosRespuestas', '1'), {
    numero: 1, calificacion: 8, respuestas: { P1: { opcionSeleccionada: 'a', correcta: true, puntosObtenidos: 1 } },
  })
})

await assertSucceeds(getDoc(doc(asT1, 'submissions', 'SUB1', 'intentosRespuestas', '1')))
ok('Capa 2 · owner teacher CAN read a snapshot de intento')

await assertFails(getDoc(doc(asT2, 'submissions', 'SUB1', 'intentosRespuestas', '1')))
ok('Capa 2 · foreign teacher CANNOT read another teacher\'s snapshot de intento')

await assertFails(getDoc(doc(asJuan, 'submissions', 'SUB1', 'intentosRespuestas', '1')))
ok('Capa 2 · student CANNOT read their own snapshot de intento (no es pantalla de revisión)')

await assertFails(setDoc(doc(asT1, 'submissions', 'SUB1', 'intentosRespuestas', '2'), { numero: 2, calificacion: 5, respuestas: {} }))
ok('Capa 2 · owner teacher CANNOT create a snapshot (server-only)')

await assertFails(setDoc(doc(asJuan, 'submissions', 'SUB1', 'intentosRespuestas', '2'), { numero: 2, calificacion: 5, respuestas: {} }))
ok('Capa 2 · student CANNOT create a snapshot')

await assertFails(updateDoc(doc(asT1, 'submissions', 'SUB1', 'intentosRespuestas', '1'), { calificacion: 10 }))
ok('Capa 2 · owner teacher CANNOT modify an existing snapshot (immutable)')

await assertFails(deleteDoc(doc(asT1, 'submissions', 'SUB1', 'intentosRespuestas', '1')))
ok('Capa 2 · owner teacher CANNOT delete a snapshot')

// ── Perfil para IA del docente (FASE 2-BIS del Plan Maestro de IA) ─────────
// Vive como campo `perfilIA` dentro de users/{uid} — mismo doc, sin colección
// nueva. Se rige por las reglas de `users` ya existentes: el dueño puede
// escribir cualquier campo propio salvo `role`/`suscripcionHasta`; nadie más
// puede leer ni escribir el doc de otro docente para este propósito.
await assertSucceeds(updateDoc(doc(asT1, 'users', T1), {
  perfilIA: {
    estiloClase: 'Muy participativo',
    habilidades: 'Trabajo por proyectos',
    experiencia: '8 años en bachillerato',
    contextoEscuela: '',
    contextoGeneral: '',
    actualizadoEn: '2026-08-12T00:00:00.000Z',
  },
}))
ok('Perfil IA · owner teacher CAN save their own perfilIA')

await assertFails(updateDoc(doc(asT2, 'users', T1), {
  perfilIA: { estiloClase: 'Intruso', habilidades: '', experiencia: '', contextoEscuela: '', contextoGeneral: '' },
}))
ok('Perfil IA · foreign teacher CANNOT write another teacher\'s perfilIA')

const snapPerfilIA = await getDoc(doc(asT1, 'users', T1))
assert.strictEqual(snapPerfilIA.data().perfilIA.estiloClase, 'Muy participativo')
ok('Perfil IA · el valor guardado persiste tal cual se envió')

// ── Fuentes del Asistente IA (apartado "Fuentes", FASE 2-BIS) ──────────────
// Colección propia `fuentesAsignatura` — a diferencia de `resources`/
// `materials`, son PRIVADAS del docente dueño: ni otro docente ni un
// estudiante inscrito puede leerlas.
const fuenteGeneralRef = await assertSucceeds(addDoc(collection(asT1, 'fuentesAsignatura'), {
  asignaturaId: 'S1', docenteId: T1, nombre: 'programa.pdf', tipo: 'pdf',
  ubicacion: 'general', parcial: null, url: 'https://example.com/programa.pdf', tamano: 1024,
}))
ok('Fuentes IA · owner teacher CAN create a fuente for their own subject')

await assertFails(addDoc(collection(asT2, 'fuentesAsignatura'), {
  asignaturaId: 'S1', docenteId: T2, nombre: 'intruso.pdf', tipo: 'pdf',
  ubicacion: 'general', parcial: null, url: 'https://example.com/intruso.pdf', tamano: 1024,
}))
ok('Fuentes IA · foreign teacher CANNOT create a fuente on another teacher\'s subject')

await assertFails(addDoc(collection(asT1, 'fuentesAsignatura'), {
  asignaturaId: 'S1', docenteId: T2, nombre: 'suplantado.pdf', tipo: 'pdf',
  ubicacion: 'general', parcial: null, url: 'https://example.com/x.pdf', tamano: 1024,
}))
ok('Fuentes IA · teacher CANNOT forge docenteId to someone else on create')

await assertFails(addDoc(collection(asT1, 'fuentesAsignatura'), {
  asignaturaId: 'S2', docenteId: T1, nombre: 'ajena.pdf', tipo: 'pdf',
  ubicacion: 'general', parcial: null, url: 'https://example.com/x.pdf', tamano: 1024,
}))
ok('Fuentes IA · teacher CANNOT attach a fuente to a subject they don\'t own')

await assertSucceeds(getDoc(doc(asT1, 'fuentesAsignatura', fuenteGeneralRef.id)))
ok('Fuentes IA · owner teacher CAN read their own fuente')

// Bug real de producción (12-ago-2026): la pantalla lista fuentesAsignatura
// con una CONSULTA (onSnapshot + where), no con getDoc. Firestore valida un
// `list` distinto a un `get`: si la regla usa un campo (docenteId) que no
// está en el where() de la consulta, rechaza TODA la lista con
// "Property docenteId is undefined", aunque el getDoc individual de arriba
// sí funcione. La fuente se guardaba pero nunca aparecía — este es el caso
// que hay que probar con getDocs(query(...)), no solo con getDoc().
await assertSucceeds(getDocs(query(
  collection(asT1, 'fuentesAsignatura'),
  where('asignaturaId', '==', 'S1'),
  where('docenteId', '==', T1)
)))
ok('Fuentes IA · owner teacher CAN list their own fuentes with the exact query the app uses (asignaturaId + docenteId)')

await assertFails(getDocs(query(
  collection(asT1, 'fuentesAsignatura'),
  where('asignaturaId', '==', 'S1')
)))
ok('Fuentes IA · REGRESIÓN: listing by asignaturaId ALONE (without docenteId in the query) fails — this was the actual production bug')

await assertFails(getDoc(doc(asT2, 'fuentesAsignatura', fuenteGeneralRef.id)))
ok('Fuentes IA · foreign teacher CANNOT read another teacher\'s fuente')

await assertFails(getDoc(doc(asJuan, 'fuentesAsignatura', fuenteGeneralRef.id)))
ok('Fuentes IA · enrolled student CANNOT read a fuente (privada del docente)')

await assertFails(updateDoc(doc(asT1, 'fuentesAsignatura', fuenteGeneralRef.id), { nombre: 'renombrado.pdf' }))
ok('Fuentes IA · fuentes are immutable — even the owner CANNOT update one')

await assertFails(deleteDoc(doc(asT2, 'fuentesAsignatura', fuenteGeneralRef.id)))
ok('Fuentes IA · foreign teacher CANNOT delete another teacher\'s fuente')

await assertSucceeds(deleteDoc(doc(asT1, 'fuentesAsignatura', fuenteGeneralRef.id)))
ok('Fuentes IA · owner teacher CAN delete their own fuente')

// ── Diagnóstico del grupo (apartado 2 de Asistente IA, FASE 2-BIS) ─────────
// subjects/{id}/diagnosticosIA/{entryId} — mismo patrón de bitácora que
// activities/analisisIA: append-only e inmutable, pero PRIVADA del docente
// dueño (ni otro docente ni un estudiante inscrito puede leerla).
const diagContextoRef = await assertSucceeds(addDoc(collection(asT1, 'subjects', 'S1', 'diagnosticosIA'), {
  tipo: 'contexto', docenteId: T1,
  resultado: { datosEncontrados: ['Grupo de 30 alumnos'], interpretacion: [], aspectosAtencion: [], informacionFaltante: [] },
}))
ok('Diagnóstico IA · owner teacher CAN create a diagnóstico entry (1st generation)')

const diagContextoRef2 = await assertSucceeds(addDoc(collection(asT1, 'subjects', 'S1', 'diagnosticosIA'), {
  tipo: 'contexto', docenteId: T1,
  resultado: { datosEncontrados: ['Segunda generación'], interpretacion: [], aspectosAtencion: [], informacionFaltante: [] },
}))
ok('Diagnóstico IA · a second generation CREATES A NEW document, does not touch the first')
assert.notStrictEqual(diagContextoRef.id, diagContextoRef2.id)
ok('Diagnóstico IA · the two generations are distinct documents (never overwritten)')

await assertFails(addDoc(collection(asT2, 'subjects', 'S1', 'diagnosticosIA'), {
  tipo: 'contexto', docenteId: T2, resultado: {},
}))
ok('Diagnóstico IA · foreign teacher CANNOT create a diagnóstico entry on another teacher\'s subject')

await assertFails(addDoc(collection(asT1, 'subjects', 'S1', 'diagnosticosIA'), {
  tipo: 'contexto', docenteId: T2, resultado: {},
}))
ok('Diagnóstico IA · owner teacher CANNOT forge docenteId to someone else on create')

await assertSucceeds(getDoc(doc(asT1, 'subjects', 'S1', 'diagnosticosIA', diagContextoRef.id)))
ok('Diagnóstico IA · owner teacher CAN read their own diagnóstico entry')

await assertFails(getDoc(doc(asT2, 'subjects', 'S1', 'diagnosticosIA', diagContextoRef.id)))
ok('Diagnóstico IA · foreign teacher CANNOT read another teacher\'s diagnóstico')

await assertFails(getDoc(doc(asJuan, 'subjects', 'S1', 'diagnosticosIA', diagContextoRef.id)))
ok('Diagnóstico IA · enrolled student CANNOT read a diagnóstico (privado del docente)')

await assertFails(updateDoc(doc(asT1, 'subjects', 'S1', 'diagnosticosIA', diagContextoRef.id), {
  resultado: { datosEncontrados: ['editado'] },
}))
ok('Diagnóstico IA · NOBODY, not even the owner, can update a diagnóstico entry (immutable snapshot)')

// Delete SÍ permitido (12-ago-2026, pedido de Kike): el docente debe poder
// descartar de inmediato una generación mal hecha de la IA.
await assertFails(deleteDoc(doc(asT2, 'subjects', 'S1', 'diagnosticosIA', diagContextoRef2.id)))
ok('Diagnóstico IA · foreign teacher CANNOT delete another teacher\'s diagnóstico entry')

await assertSucceeds(deleteDoc(doc(asT1, 'subjects', 'S1', 'diagnosticosIA', diagContextoRef2.id)))
ok('Diagnóstico IA · owner teacher CAN delete a diagnóstico entry (discard a bad generation)')

// ── Planeación Didáctica Inicial (apartado 3 de Asistente IA, FASE 2-BIS) ──
// subjects/{id}/planeacionesIA/{entryId} — misma forma exacta que
// diagnosticosIA: append-only, inmutable, privada del docente dueño.
const planRef = await assertSucceeds(addDoc(collection(asT1, 'subjects', 'S1', 'planeacionesIA'), {
  docenteId: T1, resultado: { asignaturaNombre: 'Cultura Digital I', parciales: [{ numero: 1, filas: [] }] },
}))
ok('Planeación IA · owner teacher CAN create a planeación entry (1st generation)')

const planRef2 = await assertSucceeds(addDoc(collection(asT1, 'subjects', 'S1', 'planeacionesIA'), {
  docenteId: T1, resultado: { asignaturaNombre: 'Cultura Digital I', parciales: [{ numero: 1, filas: [] }] },
}))
ok('Planeación IA · a second generation CREATES A NEW document, does not touch the first')
assert.notStrictEqual(planRef.id, planRef2.id)
ok('Planeación IA · the two generations are distinct documents (never overwritten)')

await assertFails(addDoc(collection(asT2, 'subjects', 'S1', 'planeacionesIA'), {
  docenteId: T2, resultado: {},
}))
ok('Planeación IA · foreign teacher CANNOT create a planeación entry on another teacher\'s subject')

await assertFails(addDoc(collection(asT1, 'subjects', 'S1', 'planeacionesIA'), {
  docenteId: T2, resultado: {},
}))
ok('Planeación IA · owner teacher CANNOT forge docenteId to someone else on create')

await assertSucceeds(getDoc(doc(asT1, 'subjects', 'S1', 'planeacionesIA', planRef.id)))
ok('Planeación IA · owner teacher CAN read their own planeación entry')

await assertFails(getDoc(doc(asT2, 'subjects', 'S1', 'planeacionesIA', planRef.id)))
ok('Planeación IA · foreign teacher CANNOT read another teacher\'s planeación')

await assertFails(getDoc(doc(asJuan, 'subjects', 'S1', 'planeacionesIA', planRef.id)))
ok('Planeación IA · enrolled student CANNOT read a planeación (privada del docente)')

await assertFails(updateDoc(doc(asT1, 'subjects', 'S1', 'planeacionesIA', planRef.id), {
  resultado: { parciales: [] },
}))
ok('Planeación IA · NOBODY, not even the owner, can update a planeación entry (immutable snapshot)')

await assertFails(deleteDoc(doc(asT1, 'subjects', 'S1', 'planeacionesIA', planRef.id)))
ok('Planeación IA · NOBODY, not even the owner, can delete a planeación entry')

// ── Config del Asistente IA — "Comentarios generales del grupo" ────────────
// subjects/{id}/asistenteIA/config — a diferencia de diagnosticosIA/
// planeacionesIA, este SÍ se puede actualizar (es un campo editable, no una
// bitácora), pero sigue siendo privado del docente dueño.
await assertSucceeds(setDoc(doc(asT1, 'subjects', 'S1', 'asistenteIA', 'config'), {
  docenteId: T1, comentariosGrupo: 'Apenas saben sumar.',
}))
ok('Config Asistente IA · owner teacher CAN create/save the comentarios doc')

await assertSucceeds(setDoc(doc(asT1, 'subjects', 'S1', 'asistenteIA', 'config'), {
  docenteId: T1, comentariosGrupo: 'Editado: el grupo mejoró mucho.',
}))
ok('Config Asistente IA · owner teacher CAN edit/overwrite the comentarios doc (not a bitácora)')

await assertFails(setDoc(doc(asT2, 'subjects', 'S1', 'asistenteIA', 'config'), {
  docenteId: T2, comentariosGrupo: 'Intruso',
}))
ok('Config Asistente IA · foreign teacher CANNOT write another teacher\'s comentarios')

await assertSucceeds(getDoc(doc(asT1, 'subjects', 'S1', 'asistenteIA', 'config')))
ok('Config Asistente IA · owner teacher CAN read their own comentarios')

await assertFails(getDoc(doc(asT2, 'subjects', 'S1', 'asistenteIA', 'config')))
ok('Config Asistente IA · foreign teacher CANNOT read another teacher\'s comentarios')

await assertFails(getDoc(doc(asJuan, 'subjects', 'S1', 'asistenteIA', 'config')))
ok('Config Asistente IA · enrolled student CANNOT read the comentarios (privado del docente)')

await assertFails(deleteDoc(doc(asT1, 'subjects', 'S1', 'asistenteIA', 'config')))
ok('Config Asistente IA · NOBODY, not even the owner, can delete the comentarios doc')

await testEnv.cleanup()
console.log(`\nALL ${pass} FIRESTORE-RULES CHECKS PASSED`)
