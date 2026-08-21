// Niveles 1 y 2 — endpoints y lógica de Cloud Functions, contra el emulador.
//
//   firebase emulators:exec --only firestore,auth --project demo-test \
//     "node test/servidor.test.mjs"
//
// El Nivel 3 (emulador de Functions, para probar el CABLEADO de los
// disparadores) queda fuera por decisión del PO del 6-ago-2026: es caro y
// lento, y el cableado es una línea por función. Lo que se prueba aquí es la
// LÓGICA, que es donde han estado todos los defectos.

import crypto from 'node:crypto'
import {
  db, dbFn, auth, funciones, iaFn, llamar, sesion, pincharCloudinary, urlCloudinary,
  limpiar, caso, grupo, resumen, assert,
} from './helpers/entorno.mjs'

// Llaves de mentira, pero con el mismo trato que las de verdad: sirven para
// AFIRMAR cómo se firma la petición de borrado.
process.env.CLOUDINARY_API_KEY = 'llave-de-prueba'
process.env.CLOUDINARY_API_SECRET = 'secreto-de-prueba'

const { default: borrarCuenta } = await import('../api/account/delete.js')
const { default: borrarAlumno } = await import('../api/student/delete.js')
const { default: quitarFoto } = await import('../api/student/remove-photo.js')
const { default: borrarRecursosAsignatura } = await import('../api/subject/delete-resources.js')

const F = funciones._pruebas
const FIA = iaFn._pruebas
const DOCENTE = 'docente_uno'
const OTRO = 'docente_dos'

// ═════════════════════════════════════════════════════════════════════════════
// NIVEL 1 · Endpoints
// ═════════════════════════════════════════════════════════════════════════════

grupo('account/delete — lo que NO debe funcionar')

await limpiar()
await db.doc(`users/${DOCENTE}`).set({ role: 'docente', nombre: 'Uno', escuelaId: 'E1' })
let token = await sesion(DOCENTE)

await caso('sin token → 401', async () => {
  const r = await llamar(borrarCuenta, { cuerpo: { confirmacion: 'ELIMINAR' } })
  assert.strictEqual(r.statusCode, 401)
})

await caso('con un token inventado → 401, no 500 con el error de la librería', async () => {
  const r = await llamar(borrarCuenta, { token: 'no.es.un.token', cuerpo: { confirmacion: 'ELIMINAR' } })
  assert.strictEqual(r.statusCode, 401)
  assert.ok(!JSON.stringify(r.cuerpo).includes('Firebase ID token'), 'no debe filtrar el mensaje interno')
})

await caso('sin la palabra de confirmación → 400', async () => {
  const r = await llamar(borrarCuenta, { token, cuerpo: {} })
  assert.strictEqual(r.statusCode, 400)
})

await caso('con la palabra equivocada → 400', async () => {
  const r = await llamar(borrarCuenta, { token, cuerpo: { confirmacion: 'BORRAR' } })
  assert.strictEqual(r.statusCode, 400)
})

await caso('GET → 405', async () => {
  const r = await llamar(borrarCuenta, { token, metodo: 'GET' })
  assert.strictEqual(r.statusCode, 405)
})

await caso('el docente sigue vivo después de todo lo anterior', async () => {
  assert.ok((await db.doc(`users/${DOCENTE}`).get()).exists)
})

await caso('una cuenta de administrador no se puede borrar desde aquí → 403', async () => {
  await db.doc('users/admin_uno').set({ role: 'admin', nombre: 'Admin' })
  const r = await llamar(borrarCuenta, {
    token: await sesion('admin_uno'), cuerpo: { confirmacion: 'ELIMINAR' },
  })
  assert.strictEqual(r.statusCode, 403)
  assert.ok((await db.doc('users/admin_uno').get()).exists)
})

await caso('preflight: un origen ajeno NO recibe Access-Control-Allow-Origin', async () => {
  const r = await llamar(borrarCuenta, { metodo: 'OPTIONS', origen: 'https://sitio-malicioso.example' })
  assert.strictEqual(r.statusCode, 204)
  assert.strictEqual(r.getHeader('access-control-allow-origin'), undefined)
})

await caso('preflight: el origen de la app Android sí la recibe', async () => {
  const r = await llamar(borrarCuenta, { metodo: 'OPTIONS', origen: 'https://localhost' })
  assert.strictEqual(r.getHeader('access-control-allow-origin'), 'https://localhost')
  assert.strictEqual(r.getHeader('vary'), 'Origin')
})

// ── La invariante que la Fase 2 falló dos veces ─────────────────────────────
grupo('account/delete — que la lista de colecciones esté COMPLETA')

// De dónde sale la lista: de `firestore.rules`, no de una copia a mano. Si
// alguien declara una colección nueva ahí y no la enlaza abajo, esta prueba
// falla y obliga a decidir — que es exactamente lo que faltó cuando `avisos`,
// `avisoPlantillas`, `academicEvents` y `horario` se quedaron sin borrar.
const { readFileSync } = await import('node:fs')
const REGLAS = readFileSync('firestore.rules', 'utf8')
const DECLARADAS = [...new Set([...REGLAS.matchAll(/match \/([a-zA-Z]+)\/\{/g)].map((m) => m[1]))]
  // El envoltorio `databases` y las subcolecciones, que no son raíz: todas
  // se las lleva `recursiveDelete` sobre su documento padre. `clave` se sumó
  // en A08 — y esta prueba fue la que avisó de que faltaba decidir sobre ella.
  // `iaSugerencias` (candado + sugerencia persistida de C-02) cuelga de
  // activities igual que `clave`: el borrado de la actividad o de la cuenta
  // la arrastra — y abajo se comprueba de verdad, no solo se declara.
  // `analisisIA` (bitácora de OP-10) cuelga de activities, mismo trato.
  // `intentosRespuestas` (Capa 2 de OP-10) cuelga de submissions: el borrado
  // de la entrega o de la cuenta del alumno/docente la arrastra igual que
  // `respuestas`.
  .filter((c) => !['databases', 'preguntas', 'clave', 'respuestas', 'iaSugerencias', 'analisisIA', 'intentosRespuestas'].includes(c))

const SUBJ = 'subject_uno'
const ALUMNO = 'student_uno'

// Cómo se enlaza al docente un documento de cada colección que SÍ es suya.
const ENLACE = {
  subjects: { id: SUBJ, datos: { docenteId: DOCENTE, nombre: 'A' } },
  activities: { datos: { docenteId: DOCENTE, asignaturaId: SUBJ } },
  attendance: { datos: { docenteId: DOCENTE, asignaturaId: SUBJ, fecha: '2026-03-01' } },
  events: { datos: { docenteId: DOCENTE } },
  horarioBloques: { datos: { docenteId: DOCENTE } },
  horario: { datos: { docenteId: DOCENTE } },
  asuetos: { datos: { docenteId: DOCENTE } },
  vacaciones: { datos: { docenteId: DOCENTE } },
  bancoReactivos: { datos: { docenteId: DOCENTE } },
  bancoRubricas: { datos: { docenteId: DOCENTE } },
  avisos: { datos: { docenteId: DOCENTE, asignaturaId: SUBJ } },
  avisoPlantillas: { datos: { docenteId: DOCENTE } },
  academicEvents: { datos: { docenteId: DOCENTE } },
  subscriptions: { datos: { docenteId: DOCENTE } },
  payments: { datos: { docenteId: DOCENTE } },
  students: { id: ALUMNO, datos: { asignaturaId: SUBJ, uid: 'alumno_uid', username: 'AL1', activado: true } },
  materials: { datos: { asignaturaId: SUBJ } },
  resources: { datos: { asignaturaId: SUBJ } },
  avisoLecturas: { datos: { asignaturaId: SUBJ, alumnoId: ALUMNO } },
  avisoGuardados: { datos: { asignaturaId: SUBJ, alumnoId: ALUMNO } },
  avisoOcultos: { datos: { asignaturaId: SUBJ, alumnoId: ALUMNO } },
  submissions: { datos: { actividadId: 'act_uno', alumnoId: ALUMNO } },
  notificationLog: { datos: { uid: DOCENTE } },
  notificationSettings: { id: DOCENTE, datos: { uid: DOCENTE, push: true } },
  users: { id: DOCENTE, datos: { role: 'docente', nombre: 'Uno', escuelaId: 'E1' } },
  // Créditos IA (9-ago-2026): todo lo del sistema de créditos es del docente
  // y se va con su cuenta — saldo, historial, métricas internas y registro de
  // trial. Mismo principio de borrado sin residuos.
  iaCreditos: { id: DOCENTE, datos: { plan: 'pro', capacidad: 350, saldo: 120 } },
  iaConsumos: { datos: { uid: DOCENTE, operacion: 'aviso', estado: 'ejecutado', creditosReales: 1 } },
  iaConsumosInterno: { datos: { uid: DOCENTE, operacion: 'aviso', tokensEntrada: 700 } },
  iaTrialRegistro: { id: DOCENTE, datos: { uid: DOCENTE, creditosAsignados: 350 } },
}

// Segunda siembra: los MISMOS documentos como los escribía una versión vieja
// del cliente, sin el campo por el que hoy se enlazan. §1.4 lo exige —"con
// datos viejos, documentos creados antes del cambio, sin los campos nuevos"— y
// la primera versión de este banco no lo hacía: sembraba solo formato actual,
// así que confirmaba que el endpoint encuentra lo que el endpoint ya sabe
// buscar. Comprobado contra producción el 6-ago-2026: hay 4 `avisoLecturas`
// reales sin `asignaturaId`.
const FORMATO_VIEJO = {
  attendance: { asignaturaId: SUBJ, fecha: '2026-02-01' }, // sin docenteId: la vía vieja
  // Las tres de avisos se borran SOLO por `asignaturaId`. Sin ese campo no hay
  // segunda vía, y el documento no vuelve a tener dueño nunca.
  avisoLecturas: { avisoId: 'aviso_uno', estudianteId: ALUMNO },
  avisoGuardados: { avisoId: 'aviso_uno', alumnoId: ALUMNO },
  avisoOcultos: { avisoId: 'aviso_uno', alumnoId: ALUMNO },
}

// Residuo que HOY se sabe que queda, con su riesgo anotado. No es una excusa:
// es un contrato en las dos direcciones — si el residuo crece, la prueba se
// pone roja; y si alguien lo arregla, también, y tiene que quitarlo de aquí.
// A14 H2 cerró R19: la segunda vía por `avisoId` recoge los tres. Residuo = [].
const RESIDUO_CONOCIDO = []

// Las que NO son del docente, cada una con su motivo. Añadir algo aquí es una
// decisión consciente, que es justo lo que se quiere.
const EXENTAS = {
  config: 'configuración global de la plataforma',
  plans: 'catálogo global de planes',
  schools: 'la escuela es compartida entre docentes — borrarla sería el defecto',
  bajas: 'la constancia de baja es intencional: sobrevive a propósito',
  studentEvents: 'agenda del propio estudiante — correctamente fuera del borrado de cuenta del docente; limpieza al dar de baja una inscripción pendiente (R13)',
  attendanceSummaries: 'la limpia la Cloud Function recalcularResumenAsistencia, no el endpoint — verificado contra producción en A17; aquí no corre porque el emulador de Functions queda fuera de alcance',
}

await caso('toda colección declarada en las reglas está enlazada o exenta, con motivo', () => {
  const huerfanas = DECLARADAS.filter((c) => !ENLACE[c] && !EXENTAS[c])
  assert.deepStrictEqual(huerfanas, [],
    `Colecciones nuevas sin decidir: ${huerfanas.join(', ')}. ` +
    'Enlázalas en ENLACE si son del docente, o ponlas en EXENTAS con su motivo.')
})

await caso('un docente con un documento en CADA una de sus colecciones no deja ni uno', async () => {
  await limpiar()
  const sembrados = []
  for (const [col, { id, datos }] of Object.entries(ENLACE)) {
    const ref = id ? db.doc(`${col}/${id}`) : db.collection(col).doc()
    await ref.set(datos)
    sembrados.push(ref)
  }
  // Subcolecciones: borrar el padre en Firestore no se las lleva.
  const act = (await db.collection('activities').where('docenteId', '==', DOCENTE).get()).docs[0]
  await act.ref.collection('preguntas').doc('p1').set({ texto: 'x' })
  await act.ref.collection('iaSugerencias').doc('s1_p1').set({ estado: 'pendiente', sub: 's1', preg: 'p1' })
  const sub = (await db.collection('submissions').get()).docs[0]
  await sub.ref.collection('respuestas').doc('r1').set({ valor: 'a' })
  await db.doc(`submissions/${sub.id}`).update({ actividadId: act.id })

  const cloud = pincharCloudinary()
  const r = await llamar(borrarCuenta, { token: await sesion(DOCENTE), cuerpo: { confirmacion: 'ELIMINAR' } })
  cloud.restaurar()
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))

  const quedan = []
  for (const ref of sembrados) if ((await ref.get()).exists) quedan.push(ref.path)
  if ((await act.ref.collection('preguntas').get()).size) quedan.push('activities/*/preguntas')
  if ((await act.ref.collection('iaSugerencias').get()).size) quedan.push('activities/*/iaSugerencias')
  if ((await sub.ref.collection('respuestas').get()).size) quedan.push('submissions/*/respuestas')
  assert.deepStrictEqual(quedan, [], `quedó residuo en: ${quedan.join(', ')}`)
})

await caso('tampoco deja residuo con documentos en FORMATO VIEJO (§1.4)', async () => {
  await limpiar()
  await db.doc(`users/${DOCENTE}`).set({ role: 'docente', escuelaId: 'E1' })
  await db.doc(`subjects/${SUBJ}`).set({ docenteId: DOCENTE })
  await db.doc(`students/${ALUMNO}`).set({ asignaturaId: SUBJ, uid: 'alumno_uid' })
  await db.doc('avisos/aviso_uno').set({ docenteId: DOCENTE, asignaturaId: SUBJ })

  const viejos = []
  for (const [col, datos] of Object.entries(FORMATO_VIEJO)) {
    const ref = db.collection(col).doc()
    await ref.set(datos)
    viejos.push(ref)
  }

  const cloud = pincharCloudinary()
  const r = await llamar(borrarCuenta, { token: await sesion(DOCENTE), cuerpo: { confirmacion: 'ELIMINAR' } })
  cloud.restaurar()
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))

  const quedan = []
  for (const ref of viejos) if ((await ref.get()).exists) quedan.push(ref.parent.id)
  assert.deepStrictEqual(quedan.sort(), RESIDUO_CONOCIDO,
    `el residuo con datos viejos cambió. Si CRECIÓ, hay una fuga nueva. Si se ` +
    `REDUJO, alguien lo arregló: quítalo de RESIDUO_CONOCIDO y cierra su riesgo. ` +
    `Ahora quedan: [${quedan.join(', ')}]`)
})

// ── Los archivos ────────────────────────────────────────────────────────────
grupo('account/delete — los archivos de Cloudinary')

await caso('recoge las URLs escondidas: HTML, arreglo anidado y subcolección', async () => {
  await limpiar()
  await db.doc(`users/${DOCENTE}`).set({
    role: 'docente', escuelaId: 'E1', photoURL: urlCloudinary('image', 'perfil/foto'),
  })
  await db.doc(`subjects/${SUBJ}`).set({ docenteId: DOCENTE, iconUrl: urlCloudinary('image', 'iconos/ic') })
  await db.doc('activities/act_uno').set({
    docenteId: DOCENTE, asignaturaId: SUBJ,
    instrucciones: `<img src="${urlCloudinary('image', 'html/dentro')}">`,
    adjuntos: [{ url: urlCloudinary('raw', 'adj/doc.pdf'), nombre: 'doc.pdf' }],
  })
  await db.doc('activities/act_uno/preguntas/p1').set({ imagenUrl: urlCloudinary('image', 'preg/img') })

  const cloud = pincharCloudinary()
  const r = await llamar(borrarCuenta, { token: await sesion(DOCENTE), cuerpo: { confirmacion: 'ELIMINAR' } })
  cloud.restaurar()

  assert.strictEqual(r.statusCode, 200)
  assert.deepStrictEqual(cloud.destruidos().sort(),
    ['adj/doc.pdf', 'html/dentro', 'iconos/ic', 'perfil/foto', 'preg/img'])
  assert.strictEqual(r.cuerpo.archivos.borrados, 5)
  assert.strictEqual(r.cuerpo.archivos.configurado, true)
})

await caso('manda `invalidate: true` — sin él el archivo sigue descargable un mes', async () => {
  // Es la corrección de A17 (PR #1007), y este caso existe para que no se
  // pueda perder sin que nadie se entere.
  await limpiar()
  await db.doc(`users/${DOCENTE}`).set({ role: 'docente', photoURL: urlCloudinary('image', 'x/y') })
  const cloud = pincharCloudinary()
  await llamar(borrarCuenta, { token: await sesion(DOCENTE), cuerpo: { confirmacion: 'ELIMINAR' } })
  cloud.restaurar()

  const { cuerpo } = cloud.llamadas[0]
  assert.strictEqual(cuerpo.invalidate, true, 'falta invalidate en la petición')
  // Y firmado: los parámetros van en orden alfabético, `invalidate` antes de
  // `public_id`. Si alguien agrega un parámetro fuera de orden, Cloudinary
  // rechaza por firma inválida y esto lo caza antes de producción.
  const esperada = crypto.createHash('sha1')
    .update(`invalidate=true&public_id=${cuerpo.public_id}&timestamp=${cuerpo.timestamp}${process.env.CLOUDINARY_API_SECRET}`)
    .digest('hex')
  assert.strictEqual(cuerpo.signature, esperada, 'la firma no cubre invalidate en orden alfabético')
})

await caso('lo que Cloudinary no borra queda anotado en archivosPendientes', async () => {
  await limpiar()
  await db.doc(`users/${DOCENTE}`).set({ role: 'docente', photoURL: urlCloudinary('image', 'x/falla') })
  const cloud = pincharCloudinary({ resultado: 'error' })
  const r = await llamar(borrarCuenta, { token: await sesion(DOCENTE), cuerpo: { confirmacion: 'ELIMINAR' } })
  cloud.restaurar()

  assert.strictEqual(r.cuerpo.archivos.borrados, 0)
  const apuntes = await db.collection('archivosPendientes').get()
  assert.strictEqual(apuntes.size, 1)
  assert.deepStrictEqual(apuntes.docs[0].data().pendientes, ['image/x/falla'])
  assert.strictEqual(apuntes.docs[0].data().purgado, false)
})

await caso('sin llaves configuradas NO finge que limpió', async () => {
  await limpiar()
  const key = process.env.CLOUDINARY_API_KEY
  delete process.env.CLOUDINARY_API_KEY
  try {
    await db.doc(`users/${DOCENTE}`).set({ role: 'docente', photoURL: urlCloudinary('image', 'x/sinllaves') })
    const r = await llamar(borrarCuenta, { token: await sesion(DOCENTE), cuerpo: { confirmacion: 'ELIMINAR' } })
    assert.strictEqual(r.cuerpo.archivos.configurado, false)
    assert.strictEqual(r.cuerpo.archivos.borrados, 0)
    assert.strictEqual((await db.collection('archivosPendientes').get()).size, 1)
  } finally {
    // En `finally` a propósito: si una aserción falla a medias, la llave tiene
    // que volver igual. Si no, todas las pruebas de archivos que vengan detrás
    // corren en modo "sin credenciales" y pasan o fallan por el motivo
    // equivocado.
    process.env.CLOUDINARY_API_KEY = key
  }
})

// ── RO-2 ────────────────────────────────────────────────────────────────────
grupo('account/delete — RO-2: el alumno que sigue con otro docente')

await caso('conserva su cuenta y su otra inscripción; el que se queda sin ninguna, no', async () => {
  await limpiar()
  await auth.createUser({ uid: 'alumno_compartido' })
  await auth.createUser({ uid: 'alumno_exclusivo' })
  await db.doc(`users/${DOCENTE}`).set({ role: 'docente', escuelaId: 'E1' })
  await db.doc(`users/${OTRO}`).set({ role: 'docente', escuelaId: 'E1' })
  await db.doc(`subjects/${SUBJ}`).set({ docenteId: DOCENTE })
  await db.doc('subjects/subject_otro').set({ docenteId: OTRO })
  await db.doc('students/insc_comp_a').set({ asignaturaId: SUBJ, uid: 'alumno_compartido' })
  await db.doc('students/insc_comp_b').set({ asignaturaId: 'subject_otro', uid: 'alumno_compartido' })
  await db.doc('students/insc_excl').set({ asignaturaId: SUBJ, uid: 'alumno_exclusivo' })

  const cloud = pincharCloudinary()
  await llamar(borrarCuenta, { token: await sesion(DOCENTE), cuerpo: { confirmacion: 'ELIMINAR' } })
  cloud.restaurar()

  assert.ok((await db.doc('students/insc_comp_b').get()).exists, 'la otra inscripción debía sobrevivir')
  assert.ok(await auth.getUser('alumno_compartido'), 'su cuenta debía sobrevivir')
  await assert.rejects(auth.getUser('alumno_exclusivo'), 'el que se quedó sin clases debía borrarse')
  assert.ok((await db.doc(`users/${OTRO}`).get()).exists, 'el otro docente debía sobrevivir')
})

await caso('deja constancia de baja con nombre y correo, y nada más', async () => {
  const baja = await db.doc(`bajas/${DOCENTE}`).get()
  assert.ok(baja.exists)
  assert.strictEqual(baja.data().cuentaEliminada, true)
  assert.deepStrictEqual(Object.keys(baja.data()).sort(),
    ['cuentaEliminada', 'docenteId', 'email', 'fechaBaja', 'nombre'])
})

// ── Endpoints del estudiante ────────────────────────────────────────────────
grupo('student/* — los dos endpoints del estudiante')

await caso('no puede borrarse mientras siga inscrito → 409', async () => {
  await limpiar()
  await db.doc('students/insc').set({ asignaturaId: SUBJ, uid: 'alu' })
  const r = await llamar(borrarAlumno, {
    token: await sesion('alu'), cuerpo: { confirmacion: 'ELIMINAR' },
  })
  assert.strictEqual(r.statusCode, 409)
  assert.strictEqual(r.cuerpo.inscripciones, 1)
})

await caso('sin ninguna inscripción sí se borra, y con su archivo', async () => {
  await limpiar()
  await auth.createUser({ uid: 'alu' })
  const cloud = pincharCloudinary()
  const r = await llamar(borrarAlumno, {
    token: await sesion('alu'),
    cuerpo: { confirmacion: 'ELIMINAR', photoURL: urlCloudinary('image', 'perfiles/suya') },
  })
  cloud.restaurar()
  assert.strictEqual(r.statusCode, 200)
  assert.deepStrictEqual(cloud.destruidos(), ['perfiles/suya'])
  await assert.rejects(auth.getUser('alu'))
})

await caso('quitar la foto la borra de Cloudinary y limpia el campo', async () => {
  await limpiar()
  const url = urlCloudinary('image', 'perfiles/quitar')
  await db.doc('students/i1').set({ asignaturaId: SUBJ, uid: 'alu2', photoURL: url })
  await db.doc('students/i2').set({ asignaturaId: 'otra', uid: 'alu2', photoURL: url })
  const cloud = pincharCloudinary()
  const r = await llamar(quitarFoto, { token: await sesion('alu2') })
  cloud.restaurar()

  assert.strictEqual(r.statusCode, 200)
  assert.strictEqual(r.cuerpo.inscripciones, 2)
  assert.deepStrictEqual(cloud.destruidos(), ['perfiles/quitar'], 'la misma foto, una sola vez')
  assert.strictEqual((await db.doc('students/i1').get()).data().photoURL, null)
  assert.strictEqual((await db.doc('students/i2').get()).data().photoURL, null)
})

// ── A12 · H1 · resources/materials huérfanos al borrar una asignatura ──────
grupo('subject/delete-resources — lo que le faltaba a la cascada de borrado')

await caso('sin subjectId → 400', async () => {
  await limpiar()
  const r = await llamar(borrarRecursosAsignatura, { token: await sesion(DOCENTE), cuerpo: {} })
  assert.strictEqual(r.statusCode, 400)
})

await caso('una asignatura ajena → 403, no borra nada', async () => {
  await limpiar()
  await db.doc(`subjects/${SUBJ}`).set({ docenteId: OTRO })
  await db.collection('resources').add({ asignaturaId: SUBJ, docenteId: OTRO, url: urlCloudinary('image', 'recursos/ajeno') })
  const r = await llamar(borrarRecursosAsignatura, {
    token: await sesion(DOCENTE), cuerpo: { subjectId: SUBJ },
  })
  assert.strictEqual(r.statusCode, 403)
  assert.strictEqual((await db.collection('resources').where('asignaturaId', '==', SUBJ).get()).size, 1)
})

await caso('borra resources y materials, y sus archivos de Cloudinary', async () => {
  await limpiar()
  await db.doc(`subjects/${SUBJ}`).set({ docenteId: DOCENTE })
  await db.collection('resources').add({
    asignaturaId: SUBJ, docenteId: DOCENTE, tipo: 'archivo', url: urlCloudinary('image', 'recursos/uno'),
  })
  await db.collection('materials').add({
    asignaturaId: SUBJ, docenteId: DOCENTE,
    archivos: [{ url: urlCloudinary('raw', 'materiales/dos'), nombre: 'x.pdf' }],
  })
  // Un recurso de OTRA asignatura del mismo docente no debe tocarse.
  await db.collection('resources').add({ asignaturaId: 'otra-asig', docenteId: DOCENTE, url: urlCloudinary('image', 'recursos/otra') })

  const cloud = pincharCloudinary()
  const r = await llamar(borrarRecursosAsignatura, {
    token: await sesion(DOCENTE), cuerpo: { subjectId: SUBJ },
  })
  cloud.restaurar()

  assert.strictEqual(r.statusCode, 200)
  assert.strictEqual(r.cuerpo.recursos, 1)
  assert.strictEqual(r.cuerpo.materiales, 1)
  assert.deepStrictEqual(cloud.destruidos().sort(), ['materiales/dos', 'recursos/uno'])
  assert.strictEqual((await db.collection('resources').where('asignaturaId', '==', SUBJ).get()).size, 0)
  assert.strictEqual((await db.collection('materials').where('asignaturaId', '==', SUBJ).get()).size, 0)
  assert.strictEqual((await db.collection('resources').where('asignaturaId', '==', 'otra-asig').get()).size, 1)
})

// ═════════════════════════════════════════════════════════════════════════════
// NIVEL 2 · Lógica de las Cloud Functions (sin emulador de Functions)
// ═════════════════════════════════════════════════════════════════════════════

grupo('Cloud Functions — lógica, llamada directamente')

await caso('el resumen de un alumno dado de baja se BORRA, no se recalcula', async () => {
  // Fue un defecto real (A07): el resumen resucitaba marcando al alumno
  // presente en todas las clases, visible para quien conservara su uid.
  await limpiar()
  await db.doc('attendanceSummaries/insc_fantasma').set({ asignaturaId: SUBJ, total: { asist: 99 } })
  await F.recalcularResumenAsistencia(SUBJ, 'insc_fantasma')
  assert.ok(!(await db.doc('attendanceSummaries/insc_fantasma').get()).exists)
})

await caso('cuenta la asistencia de un alumno inscrito', async () => {
  await limpiar()
  await db.doc('students/i1').set({ asignaturaId: SUBJ, uid: 'a1', createdAt: new Date('2026-01-01') })
  await db.collection('attendance').add({ asignaturaId: SUBJ, fecha: '2026-03-01', parcial: 1, presentes: { i1: true } })
  await db.collection('attendance').add({ asignaturaId: SUBJ, fecha: '2026-03-02', parcial: 1, presentes: { i1: false } })
  await F.recalcularResumenAsistencia(SUBJ, 'i1')

  const r = (await db.doc('attendanceSummaries/i1').get()).data()
  assert.strictEqual(r.total.asist, 1)
  assert.strictEqual(r.total.inasist, 1)
  assert.strictEqual(r.total.total, 2)
})

await caso('un alumno de alta tardía no arrastra las clases anteriores a su inscripción', async () => {
  await limpiar()
  await db.doc('students/i2').set({ asignaturaId: SUBJ, uid: 'a2', createdAt: new Date('2026-03-15') })
  await db.collection('attendance').add({ asignaturaId: SUBJ, fecha: '2026-03-01', parcial: 1, presentes: {} })
  await db.collection('attendance').add({ asignaturaId: SUBJ, fecha: '2026-03-20', parcial: 1, presentes: { i2: true } })
  await F.recalcularResumenAsistencia(SUBJ, 'i2')

  const r = (await db.doc('attendanceSummaries/i2').get()).data()
  assert.strictEqual(r.total.total, 1, 'solo debía contar la clase posterior a su alta')
})

await caso('A13 · H1 — registros viejos sin parcial cuentan en Parcial 1, igual que la vista del docente', async () => {
  // Antes se filtraban con `.filter(r => r.parcial != null)`, lo que excluía
  // estos registros del resumen del alumno aunque el cliente del docente SÍ
  // los incluye (usando `parcial ?? 1`). El desfase era real y silencioso.
  await limpiar()
  await db.doc('students/i3').set({ asignaturaId: SUBJ, uid: 'a3', createdAt: new Date('2026-01-01') })
  await db.collection('attendance').add({ asignaturaId: SUBJ, fecha: '2026-02-10', presentes: { i3: true } }) // sin parcial
  await db.collection('attendance').add({ asignaturaId: SUBJ, fecha: '2026-03-01', parcial: 1, presentes: { i3: false } })
  await F.recalcularResumenAsistencia(SUBJ, 'i3')

  const r = (await db.doc('attendanceSummaries/i3').get()).data()
  assert.strictEqual(r.total.total, 2, 'el registro sin parcial debe incluirse en el total')
  assert.strictEqual(r.total.asist, 1)
  assert.strictEqual(r.total.inasist, 1)
  assert.ok(r.porParcial['1'], 'debe quedar en Parcial 1, igual que en la tabla del docente')
  assert.strictEqual(r.porParcial['1'].total, 2)
})

await caso('A18 · H1 — fechaLimite sin hora → fin del día (23:59:59), igual que parseFechaLimite del cliente; con hora → se respeta intacta', () => {
  const tsSolo = F.parsearFechaLimiteMs('2026-09-15')
  assert.strictEqual(tsSolo, new Date('2026-09-15T23:59:59').getTime(),
    'fecha-solo debe quedar en 23:59:59, no en 00:00:00')

  const tsConHora = F.parsearFechaLimiteMs('2026-09-15T10:30')
  assert.strictEqual(tsConHora, new Date('2026-09-15T10:30').getTime(),
    'fecha con hora explícita debe respetarse intacta')
})

// `crearPruebaSiFalta` se eliminó con el modelo de créditos puros
// (20-ago-2026): ya no se crea una prueba de 30 días al registrarse. El
// regalo de bienvenida (20-ago-2026, activación voluntaria) es
// `creditosLedger.marcarBienvenidaDisponible` + `activarCreditosBienvenida`
// (ver test/ia-creditos.test.mjs), no una suscripción. Ver
// docs/ia/PLAN_TECNICO_CREDITOS_PUROS.md §4.

// ═════════════════════════════════════════════════════════════════════════════
// OP-10 · CAPA 2 — snapshot de respuestas por intento
// ═════════════════════════════════════════════════════════════════════════════
//
// `onEvaluacionFinalizada` es un disparador (onDocumentWritten); no se prueba
// el CABLEADO (eso es Nivel 3, fuera de alcance por decisión del PO), pero sí
// se invoca directamente su lógica con `.run(event)` — el mismo patrón de
// "probar la LÓGICA contra el emulador" que ya usa este archivo, solo que
// aquí el "endpoint" es la función que exporta `onDocumentWritten` en vez de
// un handler HTTP.

const ACT1 = 'ACT1'
const SUB1 = 'SUB1'

async function sembrarEvaluacion({ conservar = 'ultimo' } = {}) {
  await db.doc(`activities/${ACT1}`).set({
    docenteId: DOCENTE, asignaturaId: 'S1', tipo: 'evaluacion', categoria: 'cuestionario',
    maxCalif: 10, evaluacion: { conservar, publicarRespuestas: 'inmediato' },
  })
  await db.doc(`activities/${ACT1}/preguntas/p1`).set({ tipo: 'opcion_multiple', ponderacion: 1, enunciado: '¿1?', opciones: [{ id: 'a', texto: 'A' }, { id: 'b', texto: 'B' }] })
  await db.doc(`activities/${ACT1}/preguntas/p2`).set({ tipo: 'opcion_multiple', ponderacion: 1, enunciado: '¿2?', opciones: [{ id: 'a', texto: 'A' }, { id: 'b', texto: 'B' }] })
  await db.doc(`activities/${ACT1}/clave/p1`).set({ respuestaCorrecta: 'b' })
  await db.doc(`activities/${ACT1}/clave/p2`).set({ respuestaCorrecta: 'b' })
}

// Simula lo que hace el alumno al contestar: dos reactivos, con el patrón de
// aciertos que se le pida (`['b','b']` = ambos correctos, `['a','a']` = ambos
// incorrectos, etc). Limpia primero (mismo patrón que ActivityPage al iniciar
// un intento nuevo) para que nunca queden respuestas del intento anterior.
async function contestar(opciones) {
  const respRef = db.collection(`submissions/${SUB1}/respuestas`)
  await respRef.doc('p1').set({ opcionSeleccionada: opciones[0], textoRespuesta: null, otraTexto: null, archivoURL: null })
  await respRef.doc('p2').set({ opcionSeleccionada: opciones[1], textoRespuesta: null, otraTexto: null, archivoURL: null })
}

async function correrOnEvaluacionFinalizada() {
  const snap = await dbFn.doc(`submissions/${SUB1}`).get()
  return funciones.onEvaluacionFinalizada.run({ data: { after: snap }, params: { submissionId: SUB1 } })
}

grupo('OP-10 · Capa 2 — creación del snapshot por intento')

await caso('1-2. al finalizar el intento se crea intentosRespuestas/1 con las respuestas de ESE intento', async () => {
  await limpiar()
  await sembrarEvaluacion({ conservar: 'ultimo' })
  await db.doc(`submissions/${SUB1}`).set({
    actividadId: ACT1, alumnoId: 'AL1', alumnoUid: 'UAL1', estadoEvaluacion: 'finalizado',
    intentoActual: 1, intentos: [], calificacion: null,
  })
  await contestar(['b', 'a']) // p1 correcta, p2 incorrecta → 5/10
  await correrOnEvaluacionFinalizada()

  const sub = (await db.doc(`submissions/${SUB1}`).get()).data()
  assert.deepStrictEqual(sub.intentos, [{ numero: 1, calificacion: 5 }])
  assert.strictEqual(sub.calificacion, 5)

  const snap1 = await db.doc(`submissions/${SUB1}/intentosRespuestas/1`).get()
  assert.strictEqual(snap1.exists, true)
  const d = snap1.data()
  assert.strictEqual(d.numero, 1)
  assert.strictEqual(d.calificacion, 5)
  assert.strictEqual(d.respuestas.p1.opcionSeleccionada, 'b')
  assert.strictEqual(d.respuestas.p1.correcta, true)
  assert.strictEqual(d.respuestas.p2.opcionSeleccionada, 'a')
  assert.strictEqual(d.respuestas.p2.correcta, false)
  // Nada de identidad del alumno ni texto libre — solo lo que OP-10 necesita.
  assert.strictEqual(d.respuestas.p1.textoRespuesta, undefined)
  assert.strictEqual(d.alumnoId, undefined)
})

await caso('idempotencia: reprocesar el MISMO evento (mismo snapshot "after") no duplica ni el intento ni el snapshot', async () => {
  await limpiar()
  await sembrarEvaluacion({ conservar: 'ultimo' })
  await db.doc(`submissions/${SUB1}`).set({
    actividadId: ACT1, alumnoId: 'AL1', alumnoUid: 'UAL1', estadoEvaluacion: 'finalizado',
    intentoActual: 1, intentos: [], calificacion: null,
  })
  await contestar(['b', 'b'])
  const snapAntes = await dbFn.doc(`submissions/${SUB1}`).get()
  const event = { data: { after: snapAntes }, params: { submissionId: SUB1 } }

  await funciones.onEvaluacionFinalizada.run(event)
  await funciones.onEvaluacionFinalizada.run(event) // mismo evento, "reintentado"

  const sub = (await db.doc(`submissions/${SUB1}`).get()).data()
  assert.strictEqual(sub.intentos.length, 1, 'no debe duplicarse el registro del intento')
  const todos = await db.collection(`submissions/${SUB1}/intentosRespuestas`).get()
  assert.strictEqual(todos.size, 1, 'no debe duplicarse el snapshot')
})

await caso('3-4. dos intentos generan dos snapshots distintos; el del intento 1 no cambia tras el intento 2', async () => {
  await limpiar()
  await sembrarEvaluacion({ conservar: 'mejor' })
  await db.doc(`submissions/${SUB1}`).set({
    actividadId: ACT1, alumnoId: 'AL1', alumnoUid: 'UAL1', estadoEvaluacion: 'finalizado',
    intentoActual: 1, intentos: [], calificacion: null,
  })
  await contestar(['b', 'b']) // intento 1: 10/10
  await correrOnEvaluacionFinalizada()

  // Reintento: ActivityPage limpia `respuestas` y sube intentoActual — se
  // simula igual aquí.
  await contestar([null, null])
  await db.doc(`submissions/${SUB1}`).update({ estadoEvaluacion: 'en_progreso', intentoActual: 2 })
  await contestar(['a', 'a']) // intento 2: 0/10 (peor, no debería ganar con "mejor")
  await db.doc(`submissions/${SUB1}`).update({ estadoEvaluacion: 'finalizado' })
  await correrOnEvaluacionFinalizada()

  const sub = (await db.doc(`submissions/${SUB1}`).get()).data()
  assert.deepStrictEqual(sub.intentos, [{ numero: 1, calificacion: 10 }, { numero: 2, calificacion: 0 }])
  assert.strictEqual(sub.calificacion, 10, '"mejor" conserva el intento 1, no el más reciente')

  const s1 = (await db.doc(`submissions/${SUB1}/intentosRespuestas/1`).get()).data()
  const s2 = (await db.doc(`submissions/${SUB1}/intentosRespuestas/2`).get()).data()
  assert.strictEqual(s1.calificacion, 10)
  assert.strictEqual(s1.respuestas.p1.correcta, true)
  assert.strictEqual(s2.calificacion, 0)
  assert.strictEqual(s2.respuestas.p1.correcta, false)
  // El snapshot del intento 1 sigue intacto — el intento 2 no lo tocó.
  assert.strictEqual(s1.respuestas.p1.opcionSeleccionada, 'b')
})

await caso('5-6. un snapshot existente nunca se sobrescribe ni se borra (tx.create rechaza, no tx.set)', async () => {
  await limpiar()
  await sembrarEvaluacion({ conservar: 'ultimo' })
  // Estado deliberadamente inconsistente: el snapshot del intento 1 ya
  // existe, pero `intentos[]` todavía no lo sabe — no debería pasar nunca en
  // producción (se escriben juntos, en la misma transacción), pero si pasara,
  // `tx.create` debe abortar en vez de pisar el snapshot existente.
  await db.doc(`submissions/${SUB1}`).set({
    actividadId: ACT1, alumnoId: 'AL1', alumnoUid: 'UAL1', estadoEvaluacion: 'finalizado',
    intentoActual: 1, intentos: [], calificacion: null,
  })
  await db.doc(`submissions/${SUB1}/intentosRespuestas/1`).set({ numero: 1, calificacion: 999, respuestas: { yaExistia: true } })
  await contestar(['b', 'b'])

  await assert.rejects(() => correrOnEvaluacionFinalizada())

  const snap1 = (await db.doc(`submissions/${SUB1}/intentosRespuestas/1`).get()).data()
  assert.strictEqual(snap1.calificacion, 999, 'el snapshot preexistente no se modificó')
  assert.deepStrictEqual(snap1.respuestas, { yaExistia: true })
})

grupo('OP-10 · Capa 2 — selección del intento ganador (precheckAnalisisResultados)')

// `precheckAnalisisResultados` exige MIN_ENTREGAS_ANALISIS (3) entregas
// finalizadas — se rellenan con entregas simples de un solo intento, todas
// con el reactivo p1 y p2 correctos, para no distorsionar los % que se
// verifican en SUB1.
async function sembrarRelleno(n) {
  for (let i = 0; i < n; i++) {
    const id = `RELLENO${i}`
    await db.doc(`submissions/${id}`).set({
      actividadId: ACT1, alumnoId: `AL_R${i}`, alumnoUid: `UAL_R${i}`, estadoEvaluacion: 'finalizado',
      intentoActual: 1, intentos: [], calificacion: null,
    })
    await db.doc(`submissions/${id}/respuestas/p1`).set({ opcionSeleccionada: 'b', textoRespuesta: null, otraTexto: null, archivoURL: null })
    await db.doc(`submissions/${id}/respuestas/p2`).set({ opcionSeleccionada: 'b', textoRespuesta: null, otraTexto: null, archivoURL: null })
    const snap = await dbFn.doc(`submissions/${id}`).get()
    await funciones.onEvaluacionFinalizada.run({ data: { after: snap }, params: { submissionId: id } })
  }
}

await caso('10. usa el snapshot del intento ganador cuando existe (conservar: "mejor", ganador ≠ último)', async () => {
  await limpiar()
  await sembrarEvaluacion({ conservar: 'mejor' })
  await sembrarRelleno(2)
  await db.doc(`submissions/${SUB1}`).set({
    actividadId: ACT1, alumnoId: 'AL1', alumnoUid: 'UAL1', estadoEvaluacion: 'finalizado',
    intentoActual: 1, intentos: [], calificacion: null,
  })
  await contestar(['b', 'b']) // intento 1: 10/10 — será el ganador con "mejor"
  await correrOnEvaluacionFinalizada()
  await contestar([null, null])
  await db.doc(`submissions/${SUB1}`).update({ estadoEvaluacion: 'en_progreso', intentoActual: 2 })
  await contestar(['a', 'a']) // intento 2: 0/10 — queda vivo en `respuestas`
  await db.doc(`submissions/${SUB1}`).update({ estadoEvaluacion: 'finalizado' })
  await correrOnEvaluacionFinalizada()

  const r = await FIA.precheckAnalisisResultados({ uid: DOCENTE, params: { actividadId: ACT1 } })
  assert.strictEqual(r.confiabilidad.totalEntregas, 3)
  assert.strictEqual(r.confiabilidad.confiablesParaReactivo, 3)
  assert.strictEqual(r.confiabilidad.excluidas, 0)
  assert.strictEqual(r.reactivos[0].pctAciertos, 100, 'usa el snapshot del intento 1 (10/10), no las respuestas vivas del intento 2 (0/10)')
})

await caso('11-12. sin snapshot (evaluación histórica) cae a Capa 1, y no revienta', async () => {
  await limpiar()
  await sembrarEvaluacion({ conservar: 'ultimo' })
  await sembrarRelleno(2)
  // Se simula una entrega "de antes de Capa 2": intentos[] con datos, pero
  // SIN documentos en intentosRespuestas (nunca se crearon).
  await db.doc(`submissions/${SUB1}`).set({
    actividadId: ACT1, alumnoId: 'AL1', alumnoUid: 'UAL1', estadoEvaluacion: 'finalizado',
    intentoActual: 1, intentos: [{ numero: 1, calificacion: 5 }], calificacion: 5,
  })
  await contestar(['b', 'a'])
  const r = await FIA.precheckAnalisisResultados({ uid: DOCENTE, params: { actividadId: ACT1 } })
  // "ultimo" + 1 intento → Capa 1 la da por confiable (las vivas SON del ganador).
  assert.strictEqual(r.confiabilidad.confiablesParaReactivo, 3)
  assert.strictEqual(r.confiabilidad.excluidas, 0)
})

await caso('13-14. estadísticas generales y detalle por reactivo siguen funcionando con snapshots', async () => {
  await limpiar()
  await sembrarEvaluacion({ conservar: 'ultimo' })
  await sembrarRelleno(2)
  await db.doc(`submissions/${SUB1}`).set({
    actividadId: ACT1, alumnoId: 'AL1', alumnoUid: 'UAL1', estadoEvaluacion: 'finalizado',
    intentoActual: 1, intentos: [], calificacion: null,
  })
  await contestar(['b', 'b'])
  await correrOnEvaluacionFinalizada()

  const r = await FIA.precheckAnalisisResultados({ uid: DOCENTE, params: { actividadId: ACT1 } })
  assert.strictEqual(r.totalEstudiantes, 3)
  assert.strictEqual(r.porcentajeAciertosGeneral, 100)
  assert.strictEqual(r.confiabilidad.totalEntregas, 3)
  assert.strictEqual(r.confiabilidad.confiablesParaReactivo, 3)
  assert.strictEqual(r.confiabilidad.excluidas, 0)
})

await caso('15. un intento posterior con peor calificación (no ganador) no filtra sus respuestas al análisis', async () => {
  await limpiar()
  await sembrarEvaluacion({ conservar: 'primero' })
  await sembrarRelleno(2)
  await db.doc(`submissions/${SUB1}`).set({
    actividadId: ACT1, alumnoId: 'AL1', alumnoUid: 'UAL1', estadoEvaluacion: 'finalizado',
    intentoActual: 1, intentos: [], calificacion: null,
  })
  await contestar(['b', 'b']) // intento 1 (ganador con "primero"): 10/10
  await correrOnEvaluacionFinalizada()
  await contestar([null, null])
  await db.doc(`submissions/${SUB1}`).update({ estadoEvaluacion: 'en_progreso', intentoActual: 2 })
  await contestar(['a', 'a']) // intento 2 (no ganador): 0/10, vive en `respuestas`
  await db.doc(`submissions/${SUB1}`).update({ estadoEvaluacion: 'finalizado' })
  await correrOnEvaluacionFinalizada()

  const sub = (await db.doc(`submissions/${SUB1}`).get()).data()
  assert.strictEqual(sub.calificacion, 10, '"primero" conserva el intento 1')

  const r = await FIA.precheckAnalisisResultados({ uid: DOCENTE, params: { actividadId: ACT1 } })
  assert.strictEqual(r.reactivos[0].pctAciertos, 100, 'el intento 2 (0/10) nunca debió filtrarse al análisis')
})

await limpiar()
resumen('SERVER CHECKS')
