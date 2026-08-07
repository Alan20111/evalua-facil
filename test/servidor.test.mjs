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
  db, auth, funciones, llamar, sesion, pincharCloudinary, urlCloudinary,
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
  // El envoltorio `databases` y las subcolecciones, que no son raíz: las tres
  // se las lleva `recursiveDelete` sobre su documento padre. `clave` se sumó
  // en A08 — y esta prueba fue la que avisó de que faltaba decidir sobre ella.
  .filter((c) => !['databases', 'preguntas', 'clave', 'respuestas'].includes(c))

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
const RESIDUO_CONOCIDO = ['avisoGuardados', 'avisoLecturas', 'avisoOcultos'] // R19

// Las que NO son del docente, cada una con su motivo. Añadir algo aquí es una
// decisión consciente, que es justo lo que se quiere.
const EXENTAS = {
  config: 'configuración global de la plataforma',
  plans: 'catálogo global de planes',
  schools: 'la escuela es compartida entre docentes — borrarla sería el defecto',
  bajas: 'la constancia de baja es intencional: sobrevive a propósito',
  studentEvents: 'agenda del propio estudiante (R13, se resuelve en A18)',
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

await caso('la prueba gratuita se crea una vez y no se duplica', async () => {
  await limpiar()
  assert.strictEqual(await F.crearPruebaSiFalta(DOCENTE), true)
  assert.strictEqual(await F.crearPruebaSiFalta(DOCENTE), false, 'no debe crear una segunda')
  const subs = await db.collection('subscriptions').where('docenteId', '==', DOCENTE).get()
  assert.strictEqual(subs.size, 1)
  assert.strictEqual(subs.docs[0].data().status, 'trial')
})

await caso('quien ya tiene suscripción de pago no recibe una prueba encima', async () => {
  await limpiar()
  await db.collection('subscriptions').add({ docenteId: DOCENTE, status: 'activa', planId: 'mensual' })
  assert.strictEqual(await F.crearPruebaSiFalta(DOCENTE), false)
  assert.strictEqual((await db.collection('subscriptions').where('docenteId', '==', DOCENTE).get()).size, 1)
})

await limpiar()
resumen('SERVER CHECKS')
