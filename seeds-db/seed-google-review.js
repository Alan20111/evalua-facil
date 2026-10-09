#!/usr/bin/env node
/**
 * Cuentas de demostración para la revisión de Google Play.
 *
 * Google rechaza la app si la reseña topa con una pantalla de inicio de sesión
 * y no le diste credenciales (declaración "Acceso a la app" en Play Console).
 * Este script deja listas DOS cuentas permanentes, una por cada rol que el
 * revisor tiene que poder ver, con datos suficientes para que ninguna pantalla
 * salga vacía.
 *
 * Es IDEMPOTENTE: si las cuentas ya existen, no las duplica. Se puede volver a
 * correr sin miedo, por ejemplo para extender la suscripción antes de un nuevo
 * envío.
 *
 * No toca ningún dato existente: crea su propia escuela, su propio docente y
 * sus propios alumnos, aislados del resto.
 *
 *   node seed-google-review.js            # simula, no escribe
 *   node seed-google-review.js --aplicar  # escribe de verdad
 *
 * Requisitos: `firebase login` en esta máquina (usa esa sesión, no hace falta
 * service account).
 */
const https = require('https')
const fs = require('fs')
const os = require('os')
const path = require('path')

const PROJECT = 'evalua-facil-app'
const API_KEY = 'AIzaSyBn-gcF3PioP5Z3C4pN42fzh8Vlrjrggug'

// ─── Lo que verá el revisor ──────────────────────────────────────────────────
// La contraseña es larga pero se teclea sin ambigüedad: sin caracteres que se
// confundan (l/I/1, O/0) y sin símbolos raros de teclado. El revisor la escribe
// a mano en un teléfono.
const DOCENTE = {
  email: 'google.review@evaluafacil.mx',
  password: 'RevisionPlay2026',
  nombre: 'Profesora Demo',
  apellidoPaterno: 'Revisión',
  nombreMostrar: 'Profa. Demo',
}
const ALUMNO = {
  username: 'alumno.demo',
  password: 'AlumnoDemo2026',
  nombre: 'Alumno de Demostración',
}
const ESCUELA = {
  id: '15ECT0001H',
  shortName: 'CBT 1',
  nombre: 'CBT NO. 1 DR. GUSTAVO BAZ PRADA, LERMA',
  mun: 'LERMA',
  edo: 'MÉXICO',
}
// Lejos, para que la suscripción no se venza a media revisión y el revisor
// choque con la ventana de pago (eso se leería como app rota).
const VENCE = '2030-12-31T23:59:59.000Z'

const APLICAR = process.argv.includes('--aplicar')

// ─── HTTP ────────────────────────────────────────────────────────────────────
function call(hostname, path_, method, headers, body) {
  return new Promise((resolve, reject) => {
    const s = body ? JSON.stringify(body) : ''
    const req = https.request({ hostname, path: path_, method, headers: {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s), ...headers,
    } }, (res) => {
      let d = ''
      res.on('data', (c) => { d += c })
      res.on('end', () => { try { resolve({ s: res.statusCode, b: JSON.parse(d) }) } catch { resolve({ s: res.statusCode, b: d }) } })
    })
    req.on('error', reject)
    if (s) req.write(s)
    req.end()
  })
}

const idt = (ep, body) => call('identitytoolkit.googleapis.com', `/v1/${ep}?key=${API_KEY}`, 'POST', {}, body)

// Token OAuth de la CLI de Firebase: escribe en Firestore como administrador,
// así que no depende de las reglas (que a un docente le prohíben, con razón,
// crear su propia suscripción).
async function accessToken() {
  const cfg = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  const { tokens } = JSON.parse(fs.readFileSync(cfg, 'utf8'))
  if (!tokens?.refresh_token) throw new Error('Corre `firebase login` primero')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
      client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error('No se pudo renovar el token: ' + (await res.text()))
  return (await res.json()).access_token
}

// ─── Firestore ───────────────────────────────────────────────────────────────
function fsF(obj) {
  const f = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) f[k] = { nullValue: null }
    else if (Array.isArray(v)) f[k] = { arrayValue: { values: v.map((x) => ({ stringValue: String(x) })) } }
    else if (typeof v === 'string') f[k] = /^\d{4}-\d{2}-\d{2}T/.test(v) ? { timestampValue: v } : { stringValue: v }
    else if (typeof v === 'number') f[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
    else if (typeof v === 'boolean') f[k] = { booleanValue: v }
  }
  return f
}

let TOKEN = null
const base = (col, id) => `/v1/projects/${PROJECT}/databases/(default)/documents/${col}${id ? '/' + id : ''}`

async function escribir(col, id, data) {
  const auth = { Authorization: `Bearer ${TOKEN}` }
  const r = id
    ? await call('firestore.googleapis.com', base(col, id), 'PATCH', auth, { fields: fsF(data) })
    : await call('firestore.googleapis.com', base(col), 'POST', auth, { fields: fsF(data) })
  if (r.s >= 300) throw new Error(`${col}/${id || '?'} (${r.s}): ${JSON.stringify(r.b).slice(0, 250)}`)
  return r.b.name?.split('/').pop()
}

async function buscar(col, campo, valor) {
  const r = await call('firestore.googleapis.com', base('') + ':runQuery', 'POST',
    { Authorization: `Bearer ${TOKEN}` }, {
      structuredQuery: {
        from: [{ collectionId: col }],
        where: { fieldFilter: { field: { fieldPath: campo }, op: 'EQUAL', value: { stringValue: valor } } },
        limit: 1,
      },
    })
  const doc = (r.b || []).find((x) => x.document)?.document
  return doc ? { id: doc.name.split('/').pop(), fields: doc.fields } : null
}

// Crea la cuenta de Auth, o devuelve la existente si el correo ya está tomado.
// En ese caso le REESCRIBE la contraseña, para que la que sale impresa aquí
// siempre sea la que de verdad funciona.
async function cuenta(email, password) {
  const alta = await idt('accounts:signUp', { email, password, returnSecureToken: true })
  if (alta.s === 200) return { uid: alta.b.localId, idToken: alta.b.idToken, nueva: true }

  const msg = JSON.stringify(alta.b)
  if (!/EMAIL_EXISTS/.test(msg)) throw new Error(`signUp ${email}: ${msg.slice(0, 200)}`)

  const r = await call('identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT}/accounts:query`, 'POST',
    { Authorization: `Bearer ${TOKEN}` }, { expression: `email = '${email}'` })
  const uid = r.b?.userInfo?.[0]?.localId
  if (!uid) throw new Error(`No encontré el uid de ${email}`)

  await call('identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT}/accounts:update`, 'POST',
    { Authorization: `Bearer ${TOKEN}` },
    { localId: uid, password, emailVerified: true })
  return { uid, idToken: null, nueva: false }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🎬 Cuentas de demostración para la revisión de Google Play')
  console.log('='.repeat(58))
  if (!APLICAR) console.log('\n⚠️  SIMULACIÓN — no se escribe nada. Añade --aplicar para ejecutar.\n')

  TOKEN = await accessToken()

  console.log(`Docente : ${DOCENTE.email} / ${DOCENTE.password}`)
  console.log(`Alumno  : ${ALUMNO.username} / ${ALUMNO.password}`)
  console.log(`Escuela : ${ESCUELA.shortName} (${ESCUELA.id})`)
  console.log(`Suscripción vigente hasta: ${VENCE.slice(0, 10)}`)
  if (!APLICAR) { console.log('\nNada que hacer en simulación.'); return }

  const ahora = new Date().toISOString()

  console.log('\n🏫 Escuela…')
  await escribir('schools', ESCUELA.id, {
    claveSEP: ESCUELA.id, shortName: ESCUELA.shortName, nombre: ESCUELA.nombre,
    municipio: ESCUELA.mun, estado: ESCUELA.edo,
  })
  console.log('  ✅ ' + ESCUELA.shortName)

  console.log('\n👩‍🏫 Docente…')
  const doc_ = await cuenta(DOCENTE.email, DOCENTE.password)
  console.log(`  ✅ Auth ${doc_.nueva ? 'creada' : 'ya existía (contraseña restablecida)'} — uid ${doc_.uid}`)

  await escribir('users', doc_.uid, {
    role: 'docente',
    email: DOCENTE.email,
    username: `${ESCUELA.shortName.replace(/\s+/g, '')}-REV`,
    nombre: DOCENTE.nombre,
    apellidoPaterno: DOCENTE.apellidoPaterno,
    nombreMostrar: DOCENTE.nombreMostrar,
    escuelaId: ESCUELA.id,
    schoolName: ESCUELA.shortName,
    estado: ESCUELA.edo,
    municipio: ESCUELA.mun,
    provider: 'password',
    hasLocalPassword: true,
    // Sin esto la app manda al onboarding y el revisor no llega al tablero.
    profileComplete: true,
    // Espeja la suscripción: es lo que miran las reglas (docenteActivo()).
    suscripcionHasta: VENCE,
    createdAt: ahora,
  })
  console.log('  ✅ users/{uid} con profileComplete y suscripción vigente')

  const subPrevia = await buscar('subscriptions', 'docenteId', doc_.uid)
  await escribir('subscriptions', subPrevia?.id || null, {
    docenteId: doc_.uid, planId: 'pro', planName: 'Suscripción mensual',
    escuelaId: ESCUELA.id, schoolName: ESCUELA.shortName,
    status: 'activa', precio: 199,
    fechaInicio: ahora, fechaVencimiento: VENCE,
    createdAt: ahora, updatedAt: ahora,
  })
  console.log('  ✅ subscriptions activa hasta ' + VENCE.slice(0, 10))

  console.log('\n📚 Asignatura y actividades…')
  let asignaturaId = (await buscar('subjects', 'docenteId', doc_.uid))?.id
  if (!asignaturaId) {
    asignaturaId = await escribir('subjects', null, {
      nombre: 'Matemáticas I', docenteId: doc_.uid, escuelaId: ESCUELA.id,
      parciales: 3, ciclo: 'AGO 2026-ENE 2027',
      accessCode: 'DEMO26', archived: false, createdAt: ahora,
    })
    for (const [i, a] of [
      ['Ecuaciones de primer grado', 1],
      ['Sistemas de ecuaciones', 1],
      ['Productos notables', 2],
    ].entries()) {
      await escribir('activities', null, {
        nombre: a[0], categoria: 'tarea', tipo: 'archivo', instrucciones: 'Actividad de demostración.',
        fechaLimite: null, recibirTarde: false, oculta: false, publishAt: null, publishedAt: ahora,
        maxCalif: 10, notificarDocente: false, parcial: a[1], orden: i + 1,
        asignaturaId, docenteId: doc_.uid, createdAt: ahora,
      })
    }
    console.log('  ✅ Matemáticas I + 3 actividades')
  } else {
    console.log('  ↩︎ Ya tenía asignatura, no se duplica')
  }

  console.log('\n🎓 Alumno…')
  const correoAlumno = `${ALUMNO.username.toLowerCase()}.${ESCUELA.id.toLowerCase()}@evalua.local`
  const al = await cuenta(correoAlumno, ALUMNO.password)
  console.log(`  ✅ Auth ${al.nueva ? 'creada' : 'ya existía (contraseña restablecida)'} — uid ${al.uid}`)

  const alPrevio = await buscar('students', 'uid', al.uid)
  await escribir('students', alPrevio?.id || null, {
    username: ALUMNO.username, nombre: ALUMNO.nombre, email: correoAlumno,
    escuelaId: ESCUELA.id, asignaturaId, docenteId: doc_.uid,
    activado: true, uid: al.uid, resetPassword: null, createdAt: ahora,
  })
  console.log('  ✅ students inscrito y activado')

  console.log('\n' + '='.repeat(58))
  console.log('PEGA ESTO EN PLAY CONSOLE → Contenido de la app → Acceso a la app')
  console.log('='.repeat(58))
  console.log(`
Docente (pantalla principal de inicio de sesión):
  Usuario:     ${DOCENTE.email}
  Contraseña:  ${DOCENTE.password}

Alumno (toca "Soy alumno" en la pantalla de inicio):
  Usuario:     ${ALUMNO.username}
  Contraseña:  ${ALUMNO.password}
`)
}

main().catch((e) => { console.error('\n✗ ' + e.message); process.exit(1) })
