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
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'

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

// Esta prueba esperaba lo contrario y llevaba tiempo fallando: la regla se
// endureció a propósito (borrar una entrega borra su calificación, y eso es
// manipulación de notas si lo hace el alumno), pero la prueba se quedó con el
// comportamiento viejo. Manda la regla, ver el comentario en firestore.rules.
await assertFails(deleteDoc(doc(asJuan, 'submissions', 'SUB1')))
ok('student CANNOT delete their own submission (it would erase the grade)')

await assertSucceeds(deleteDoc(doc(asT1, 'submissions', 'SUB1')))
ok('owning teacher deletes a submission')

// ── respuestas subcollection ─────────────────────────────────────────────────
await assertSucceeds(setDoc(doc(asJuan, 'submissions', 'SUB_JUAN', 'respuestas', 'Q1'), { valor: 'a' }))
ok('student writes an answer to their OWN attempt')

await assertFails(setDoc(doc(asMallory, 'submissions', 'SUB_JUAN', 'respuestas', 'Q1'), { valor: 'x' }))
ok('attacker CANNOT write answers to another student’s attempt')

await assertSucceeds(setDoc(doc(asT1, 'submissions', 'SUB_JUAN', 'respuestas', 'Q1'), { puntosObtenidos: 5 }))
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

await testEnv.cleanup()
console.log(`\nALL ${pass} FIRESTORE-RULES CHECKS PASSED`)
