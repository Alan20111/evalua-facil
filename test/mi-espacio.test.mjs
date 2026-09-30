// Mi espacio — pruebas contra los emuladores de Firestore, Storage y Auth.
// Correr con:  npm run test:mi-espacio
//
// Cubre las tres capas: la regla de Storage (storage.rules), la lógica del
// servidor (api/_lib/miEspacio.js: cuota, transacciones, conciliación) y los
// endpoints /api/student/mi-espacio-* y /api/student/delete.

import { readFileSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import assert from 'node:assert'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage'

// Credencial falsa: el emulador no valida la firma, pero getSignedUrl necesita
// una llave privada para firmar.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: 'demo-test',
  client_email: 'pruebas@demo-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
})

const { getDb, getBucket, getAuth, admin } = await import('../api/_lib/firebaseAdmin.js')
const me = await import('../api/_lib/miEspacio.js')
const { default: handlerAlumno } = await import('../api/student/[action].js')
const {
  MI_ESPACIO_CUOTA_BYTES: CUOTA, MI_ESPACIO_MAX_ARCHIVO_BYTES: MAX, MI_ESPACIO_MENSAJES: MSJ, nombreBucket,
} = await import('../src/config/miEspacio.js')

const BUCKET = nombreBucket('demo-test')
const MB = 1024 * 1024
const [fsHost, fsPort] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
const [stHost, stPort] = process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':')

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: fsHost, port: Number(fsPort) },
  storage: { rules: readFileSync('storage.rules', 'utf8'), host: stHost, port: Number(stPort) },
})

const db = getDb()
const bucket = getBucket()
assert.equal(bucket.name, BUCKET)

let pass = 0
const ok = (n) => { console.log('  ✓', n); pass++ }

const A = 'uid_alumna_a'
const B = 'uid_alumno_b'
const stA = testEnv.authenticatedContext(A, { email: 'ana.e1@evalua.local' }).storage(`gs://${BUCKET}`)
const stB = testEnv.authenticatedContext(B, { email: 'beto.e1@evalua.local' }).storage(`gs://${BUCKET}`)
const stAnon = testEnv.unauthenticatedContext().storage(`gs://${BUCKET}`)

const bytes = (n, relleno = 7) => new Uint8Array(n).fill(relleno)

async function limpiar() {
  for (const c of ['miEspacio', 'miEspacioArchivos', 'students']) {
    const snap = await db.collection(c).get()
    await Promise.all(snap.docs.map((d) => d.ref.delete()))
  }
  await bucket.deleteFiles({ prefix: 'mi-espacio/' }).catch(() => {})
}

// Sube como lo hace la pantalla: reserva → Storage (con reglas) → confirma.
async function subir(uid, st, nombre, contenido, tipo = 'application/pdf') {
  const r = await me.reservar(db, uid, { nombre, tamano: contenido.length, tipo })
  await uploadBytes(ref(st, r.ruta), contenido, { contentType: r.tipo })
  await me.confirmar(db, bucket, uid, r.fileId)
  return r
}

// Documentos "listo" sembrados sin subir bytes — para las pruebas de cuota
// (la cuota se calcula con los documentos; subir 100 MB reales no aporta).
async function sembrarListos(uid, tamanos) {
  for (const [i, t] of tamanos.entries()) {
    const id = `${uid}_sem${i}`
    await db.collection('miEspacioArchivos').doc(id).set({
      uid, nombre: `s${i}.pdf`, tamano: t, tipo: 'application/pdf', ruta: `mi-espacio/${uid}/${id}`,
      estado: 'listo', creado: admin.firestore.Timestamp.now(), confirmado: admin.firestore.Timestamp.now(),
    })
  }
}

const usado = async (uid) => (await db.collection('miEspacio').doc(uid).get()).data()?.usadoBytes ?? 0
const existeObjeto = async (ruta) => (await bucket.file(ruta).exists())[0]

// ── 1. Reglas de Storage ────────────────────────────────────────────────────
await limpiar()
{
  const r = await me.reservar(db, A, { nombre: 'tarea.pdf', tamano: 100, tipo: 'application/pdf' })
  // Sin sesión, otra persona, otra ruta, otro tamaño, otro tipo: no.
  await assertFails(uploadBytes(ref(stAnon, r.ruta), bytes(100), { contentType: 'application/pdf' }))
  await assertFails(uploadBytes(ref(stB, r.ruta), bytes(100), { contentType: 'application/pdf' }))
  await assertFails(uploadBytes(ref(stB, `mi-espacio/${B}/${r.fileId}`), bytes(100), { contentType: 'application/pdf' }))
  await assertFails(uploadBytes(ref(stA, r.ruta), bytes(101), { contentType: 'application/pdf' }))
  await assertFails(uploadBytes(ref(stA, r.ruta), bytes(99), { contentType: 'application/pdf' }))
  await assertFails(uploadBytes(ref(stA, r.ruta), bytes(100), { contentType: 'image/png' }))
  await assertFails(uploadBytes(ref(stA, `mi-espacio/${A}/sin-reserva`), bytes(100), { contentType: 'application/pdf' }))
  ok('STORAGE · sin reserva, ajena, otro tamaño u otro tipo: no se sube')
  await assertSucceeds(uploadBytes(ref(stA, r.ruta), bytes(100), { contentType: 'application/pdf' }))
  ok('STORAGE · con su reserva, tamaño y tipo exactos: se sube')
  // Ni el dueño lee, reemplaza o borra desde el cliente; otro menos.
  await assertFails(getBytes(ref(stA, r.ruta)))
  await assertFails(getBytes(ref(stB, r.ruta)))
  await assertFails(getBytes(ref(stAnon, r.ruta)))
  await assertFails(uploadBytes(ref(stA, r.ruta), bytes(100), { contentType: 'application/pdf' }))
  await assertFails(deleteObject(ref(stA, r.ruta)))
  await assertFails(deleteObject(ref(stB, r.ruta)))
  ok('STORAGE · nadie lee, reemplaza ni borra desde el cliente (ni el dueño)')
  // Evidencias y cualquier otra ruta: cerradas.
  await assertFails(uploadBytes(ref(stA, 'submissions/A1/x/f.pdf'), bytes(10), { contentType: 'application/pdf' }))
  ok('STORAGE · la vieja ruta submissions/ y cualquier otra quedan cerradas')

  // Reserva vencida: ya no sirve.
  const v = await me.reservar(db, A, { nombre: 'b.pdf', tamano: 50, tipo: 'application/pdf' })
  await db.collection('miEspacioArchivos').doc(v.fileId).update({ venceEn: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) })
  await assertFails(uploadBytes(ref(stA, v.ruta), bytes(50), { contentType: 'application/pdf' }))
  ok('STORAGE · reserva vencida: no se sube')
}

// ── 2. Casos básicos ────────────────────────────────────────────────────────
await limpiar()
{
  let l = await me.listar(db, bucket, A)
  assert.deepEqual([l.archivos.length, l.usadoBytes, l.cuotaBytes], [0, 0, CUOTA])
  ok('0 archivos: lista vacía, 0 de 100 MB')

  await subir(A, stA, 'uno.pdf', bytes(1000))
  l = await me.listar(db, bucket, A)
  assert.equal(l.archivos.length, 1)
  assert.equal(l.usadoBytes, 1000)
  assert.equal(l.archivos[0].nombre, 'uno.pdf')
  ok('1 archivo: aparece con su nombre y tamaño; uso = 1000 B')

  await subir(A, stA, 'foto.jpg', bytes(2000), 'image/jpeg')
  await subir(A, stA, 'tabla.xlsx', bytes(3000), '') // navegador sin tipo → canónico por extensión
  l = await me.listar(db, bucket, A)
  assert.equal(l.archivos.length, 3)
  assert.equal(l.usadoBytes, 6000)
  assert.equal(await usado(A), 6000)
  assert.equal(l.archivos.find((a) => a.nombre === 'tabla.xlsx').tipo,
    'application/vnd.ms-excel')
  ok('varios archivos: 3 listados, uso 6000 B, resumen coincide; tipo vacío → canónico')

  // Descarga: el enlace firmado entrega exactamente los bytes.
  const foto = l.archivos.find((a) => a.nombre === 'foto.jpg')
  assert.ok(foto.url.includes(encodeURIComponent(`mi-espacio/${A}/`).replace(/%2F/g, '/')) || foto.url.includes(`mi-espacio%2F${A}`) || foto.url.includes(`mi-espacio/${A}`))
  const res = await fetch(foto.url)
  assert.equal(res.status, 200, `descarga: HTTP ${res.status}`)
  const recibido = new Uint8Array(await res.arrayBuffer())
  assert.equal(recibido.length, 2000)
  ok('descarga: el enlace firmado entrega el archivo (2000 B)')

  // Eliminación: objeto y documento fuera, cuota restada.
  await me.borrar(db, bucket, A, foto.id)
  l = await me.listar(db, bucket, A)
  assert.equal(l.archivos.length, 2)
  assert.equal(l.usadoBytes, 4000)
  assert.equal(await usado(A), 4000)
  assert.equal(await existeObjeto(`mi-espacio/${A}/${foto.id}`), false)
  ok('eliminación: objeto y documento borrados; uso baja a 4000 B')

  // Recarga / volver a entrar: el estado vive en el servidor, no en la pantalla.
  const otraVez = await me.listar(db, bucket, A)
  assert.deepEqual(otraVez.archivos.map((a) => a.id).sort(), l.archivos.map((a) => a.id).sort())
  ok('recarga: una lista nueva devuelve lo mismo')
}

// ── 3. Cuota ────────────────────────────────────────────────────────────────
await limpiar()
{
  await sembrarListos(A, [25 * MB, 25 * MB, 25 * MB, 20 * MB]) // 95 MB
  await assert.rejects(me.reservar(db, A, { nombre: 'x.pdf', tamano: 5 * MB + 1, tipo: 'application/pdf' }),
    (e) => e.status === 409 && e.message === MSJ.sinEspacio)
  ok('100 MB + 1 byte: rechazado con el mensaje para el estudiante')
  const r = await me.reservar(db, A, { nombre: 'x.pdf', tamano: 5 * MB, tipo: 'application/pdf' })
  await uploadBytes(ref(stA, r.ruta), bytes(5 * MB), { contentType: 'application/pdf' })
  await me.confirmar(db, bucket, A, r.fileId)
  assert.equal(await usado(A), CUOTA)
  ok('exactamente 100 MB: se permite (reservado, subido y confirmado)')
  await assert.rejects(me.reservar(db, A, { nombre: 'y.pdf', tamano: 1, tipo: 'application/pdf' }),
    (e) => e.status === 409)
  ok('lleno a 100 MB: ni 1 byte más')
}

await limpiar()
{
  const r = await me.reservar(db, A, { nombre: 'grande.pdf', tamano: MAX, tipo: 'application/pdf' })
  await uploadBytes(ref(stA, r.ruta), bytes(MAX), { contentType: 'application/pdf' })
  await me.confirmar(db, bucket, A, r.fileId)
  assert.equal(await usado(A), MAX)
  ok('archivo de 25 MB: se sube de verdad y cuenta 25 MB')
  await assert.rejects(me.reservar(db, A, { nombre: 'enorme.pdf', tamano: MAX + 1, tipo: 'application/pdf' }),
    (e) => e.status === 413 && e.message === MSJ.muyGrande)
  ok('archivo de 25 MB + 1 byte: rechazado')
  await assert.rejects(me.reservar(db, A, { nombre: 'cancion.mp3', tamano: 10, tipo: 'audio/mpeg' }), (e) => e.status === 415)
  await assert.rejects(me.reservar(db, A, { nombre: 'video.mp4', tamano: 10, tipo: 'video/mp4' }), (e) => e.status === 415)
  await assert.rejects(me.reservar(db, A, { nombre: 'virus.exe', tamano: 10, tipo: 'application/pdf' }), (e) => e.status === 415)
  await assert.rejects(me.reservar(db, A, { nombre: 'vacio.pdf', tamano: 0, tipo: 'application/pdf' }), (e) => e.status === 413)
  for (const [n, t] of [['a.png', 'image/png'], ['a.docx', ''], ['a.pptx', ''], ['a.zip', 'application/zip'], ['a.rar', 'application/octet-stream']]) {
    await me.reservar(db, A, { nombre: n, tamano: 10, tipo: t })
    await db.collection('miEspacioArchivos').where('nombre', '==', n).get().then((s) => Promise.all(s.docs.map((d) => d.ref.delete())))
  }
  ok('tipos: audio, video, .exe y vacío rechazados; PNG, Word, PPT, ZIP y RAR aceptados')
}

// Dos subidas simultáneas que juntas se pasan: solo una entra.
for (let ronda = 0; ronda < 5; ronda++) {
  await limpiar()
  await sembrarListos(A, [25 * MB, 25 * MB, 10 * MB]) // 60 MB
  const [x, y] = await Promise.allSettled([
    me.reservar(db, A, { nombre: 'x.pdf', tamano: 25 * MB, tipo: 'application/pdf' }),
    me.reservar(db, A, { nombre: 'y.pdf', tamano: 25 * MB, tipo: 'application/pdf' }),
  ])
  const aceptadas = [x, y].filter((p) => p.status === 'fulfilled').length
  assert.equal(aceptadas, 1, `ronda ${ronda}: entraron ${aceptadas}`)
  const rechazo = [x, y].find((p) => p.status === 'rejected').reason
  assert.equal(rechazo.status, 409)
  const docs = (await db.collection('miEspacioArchivos').where('uid', '==', A).get()).docs.map((d) => d.data())
  assert.ok(docs.reduce((s, d) => s + d.tamano, 0) <= CUOTA)
}
ok('dos subidas simultáneas (5 rondas): siempre entra una sola y nunca se pasa de 100 MB')

// ── 4. Aislamiento A / B ────────────────────────────────────────────────────
await limpiar()
{
  const rB = await subir(B, stB, 'privado.pdf', bytes(500))
  await assert.rejects(me.borrar(db, bucket, A, rB.fileId), (e) => e.status === 404)
  await assert.rejects(me.confirmar(db, bucket, A, rB.fileId), (e) => e.status === 404)
  assert.equal((await me.listar(db, bucket, A)).archivos.length, 0)
  assert.equal(await existeObjeto(rB.ruta), true)
  assert.equal((await me.listar(db, bucket, B)).archivos.length, 1)
  ok('A no ve, no confirma y no borra el archivo de B; el de B sigue intacto')
}

// ── 5. Conciliación ─────────────────────────────────────────────────────────
await limpiar()
{
  const HORAS = 3 * 60 * 60 * 1000
  // Metadata sin archivo (el objeto desapareció).
  await sembrarListos(A, [700])
  await db.collection('miEspacioArchivos').doc(`${A}_sem0`).update({ confirmado: admin.firestore.Timestamp.fromMillis(Date.now() - HORAS) })
  // Archivo sin metadata.
  await bucket.file(`mi-espacio/${A}/suelto`).save(Buffer.from('hola'))
  // Subida que terminó pero nunca se confirmó.
  const r = await me.reservar(db, A, { nombre: 'sin-confirmar.pdf', tamano: 300, tipo: 'application/pdf' })
  await uploadBytes(ref(stA, r.ruta), bytes(300), { contentType: 'application/pdf' })
  // Reserva abandonada (nunca se subió).
  const abandonada = await me.reservar(db, A, { nombre: 'nunca.pdf', tamano: 400, tipo: 'application/pdf' })

  // Recién pasado: nada se borra todavía (podría estar subiéndose).
  let l = await me.listar(db, bucket, A)
  assert.deepEqual(l.archivos.map((a) => a.nombre), ['sin-confirmar.pdf'])
  assert.equal(await existeObjeto(`mi-espacio/${A}/suelto`), true)
  assert.ok((await db.collection('miEspacioArchivos').doc(abandonada.fileId).get()).exists)
  ok('conciliación inmediata: la subida sin confirmar aparece; lo demás espera su margen')

  l = await me.listar(db, bucket, A, Date.now() + HORAS)
  assert.deepEqual(l.archivos.map((a) => a.nombre), ['sin-confirmar.pdf'])
  assert.equal(l.usadoBytes, 300)
  assert.equal(await usado(A), 300)
  assert.equal(await existeObjeto(`mi-espacio/${A}/suelto`), false)
  assert.equal((await db.collection('miEspacioArchivos').doc(abandonada.fileId).get()).exists, false)
  assert.equal((await db.collection('miEspacioArchivos').doc(`${A}_sem0`).get()).exists, false)
  ok('conciliación con margen: metadata sin archivo, archivo sin metadata y reserva abandonada se limpian; contador correcto')

  // Borrar un archivo cuyo objeto ya no existe: limpia el documento igual.
  await bucket.file(r.ruta).delete()
  await me.borrar(db, bucket, A, r.fileId)
  assert.equal(await usado(A), 0)
  assert.equal((await db.collection('miEspacioArchivos').where('uid', '==', A).get()).size, 0)
  ok('borrar con el objeto ya perdido: documento limpio y contador en 0')
}

// ── 6. Endpoints ────────────────────────────────────────────────────────────
async function idToken(uid, email) {
  await getAuth().createUser({ uid, email, password: 'secreta1' }).catch(() => {})
  const token = await getAuth().createCustomToken(uid)
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, returnSecureToken: true }) })
  return (await r.json()).idToken
}
async function llamar(action, token, body = {}) {
  let status = 200
  let json
  const res = {
    setHeader() {}, status(s) { status = s; return this }, json(j) { json = j; return this }, end() { return this },
  }
  await handlerAlumno({ method: 'POST', query: { action }, headers: { authorization: `Bearer ${token}` }, body }, res)
  return { status, json }
}

await limpiar()
{
  const tokA = await idToken(A, 'ana.e1@evalua.local')
  const tokDocente = await idToken('uid_docente', 'maestra@correo.com')

  let r = await llamar('mi-espacio-listar', tokDocente)
  assert.equal(r.status, 403)
  ok('endpoint · un docente no entra a Mi espacio (403)')
  r = await llamar('mi-espacio-listar', 'token-falso')
  assert.equal(r.status, 401)
  ok('endpoint · sin sesión válida: 401')

  r = await llamar('mi-espacio-reservar', tokA, { nombre: 'e.pdf', tamano: 10, tipo: 'application/pdf', uid: B })
  assert.equal(r.status, 200)
  assert.ok(r.json.ruta.startsWith(`mi-espacio/${A}/`), 'el dueño es el del token, no el del cuerpo')
  await uploadBytes(ref(stA, r.json.ruta), bytes(10), { contentType: 'application/pdf' })
  assert.equal((await llamar('mi-espacio-confirmar', tokA, { fileId: r.json.fileId })).status, 200)
  const lista = await llamar('mi-espacio-listar', tokA)
  assert.equal(lista.json.archivos.length, 1)
  assert.equal((await llamar('mi-espacio-reservar', tokA, { nombre: 'g.pdf', tamano: MAX + 1, tipo: 'application/pdf' })).status, 413)
  ok('endpoint · reservar/confirmar/listar con el uid del token (ignora un uid en el cuerpo); 413 si pesa de más')

  // Eliminación de la cuenta (sin inscripciones): se va Mi espacio entero.
  const rutaA = r.json.ruta
  const del = await llamar('delete', tokA, { confirmacion: 'ELIMINAR' })
  assert.equal(del.status, 200, JSON.stringify(del.json))
  assert.equal(await existeObjeto(rutaA), false)
  assert.equal((await db.collection('miEspacioArchivos').where('uid', '==', A).get()).size, 0)
  assert.equal((await db.collection('miEspacio').doc(A).get()).exists, false)
  await assert.rejects(getAuth().getUser(A))
  ok('eliminación de cuenta: archivos de Storage, metadatos y resumen borrados; Auth borrado')
}

// borrarTodo con el bucket todavía inexistente no rompe (Storage sin activar).
{
  const sinBucket = admin.storage().bucket('no-existe-este-bucket')
  await me.borrarTodo(db, sinBucket, 'uid_x').catch((e) => assert.fail(`borrarTodo lanzó: ${e.message}`))
  ok('borrarTodo con Storage sin activar: no lanza (el borrado de cuentas sigue funcionando)')
}

await limpiar()
await testEnv.cleanup()
console.log(`\nALL ${pass} MI-ESPACIO CHECKS PASSED`)
process.exit(0)
