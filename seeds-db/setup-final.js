#!/usr/bin/env node
/**
 * Setup final: Plan Pro $100 + admin alannicanor62@gmail.com
 *
 * Strategy:
 *   1. Create a temporary Firebase Auth account (email+password)
 *   2. Use its ID token to PATCH Firestore via REST (temp rules: allow write if auth != null)
 *   3. Delete the temporary account
 *
 * Requires: temporary firestore.rules deployed first
 */

const https = require('https')

const API_KEY = 'AIzaSyBn-gcF3PioP5Z3C4pN42fzh8Vlrjrggug'
const PROJECT_ID = 'evalua-facil-app'
const ADMIN_EMAIL = 'alannicanor62@gmail.com'
const TEMP_EMAIL = `setup.temp.${Date.now()}@evalua-setup.local`
const TEMP_PASS = `SetupP4ss${Date.now()}`

function idtPost(endpoint, body, authHeader) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body)
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
    }
    if (authHeader) headers['Authorization'] = authHeader
    const req = https.request(
      {
        hostname: 'identitytoolkit.googleapis.com',
        path: `/v1/${endpoint}?key=${API_KEY}`,
        method: 'POST',
        headers,
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
          catch { resolve({ status: res.statusCode, body: data }) }
        })
      }
    )
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

function fsPatch(urlPath, idToken, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body)
    const req = https.request(
      {
        hostname: 'firestore.googleapis.com',
        path: urlPath,
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
          catch { resolve({ status: res.statusCode, body: data }) }
        })
      }
    )
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

function fsFields(obj) {
  const fields = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') fields[k] = { stringValue: v }
    else if (typeof v === 'number') fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v }
  }
  return fields
}

async function fsSet(idToken, collection, docId, data) {
  const urlPath = `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`
  const res = await fsPatch(urlPath, idToken, { fields: fsFields(data) })
  if (res.status < 200 || res.status >= 300) {
    const detail = JSON.stringify(res.body).slice(0, 300)
    throw new Error(`Firestore ${collection}/${docId} (${res.status}): ${detail}`)
  }
  return res.body
}

async function getUidByEmail(idToken, email) {
  const res = await idtPost('projects/' + PROJECT_ID + '/accounts:lookup', { email: [email] }, `Bearer ${idToken}`)
  if (res.status !== 200) throw new Error(`Lookup failed (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`)
  return (res.body.users || [])[0]?.localId || null
}

async function main() {
  console.log('\n🚀 Evalúa Fácil — Setup Final')
  console.log('='.repeat(45))

  // 1. Create temp Firebase user
  console.log('\n🔧 Creando cuenta temporal para autenticación…')
  const signUpRes = await idtPost('accounts:signUp', {
    email: TEMP_EMAIL,
    password: TEMP_PASS,
    returnSecureToken: true,
  })
  if (signUpRes.status !== 200) {
    const err = signUpRes.body?.error?.message || JSON.stringify(signUpRes.body)
    throw new Error(`signUp falló (${signUpRes.status}): ${err}`)
  }
  const idToken = signUpRes.body.idToken
  const tempUid = signUpRes.body.localId
  console.log(`  ✅ Cuenta temporal creada (uid: ${tempUid})`)

  try {
    // 2. Write Plan Pro
    console.log('\n📦 Actualizando Plan Pro → $100/mes…')
    await fsSet(idToken, 'plans', 'pro', {
      nombre: 'Plan Pro',
      descripcion: 'Acceso completo a Evalúa Fácil sin límites.',
      precio: 100,
      periodicidad: 'mensual',
      maxAsignaturas: -1,
      maxAlumnos: -1,
      activo: true,
      orden: 1,
    })
    console.log('  ✅ Plan Pro — $100/mes creado en Firestore')

    // 3. Find or promote admin
    console.log(`\n👤 Buscando cuenta de ${ADMIN_EMAIL}…`)
    const adminUid = await getUidByEmail(idToken, ADMIN_EMAIL)
    if (!adminUid) {
      console.log(`  ⚠ No existe cuenta Firebase Auth para ${ADMIN_EMAIL}.`)
      console.log(`    Inicia sesión con Google en evalua-facil.vercel.app primero,`)
      console.log(`    luego corre este script de nuevo.\n`)
    } else {
      console.log(`  UID encontrado: ${adminUid}`)
      await fsSet(idToken, 'users', adminUid, {
        role: 'admin',
        email: ADMIN_EMAIL.toLowerCase(),
        username: 'admin',
      })
      console.log(`  ✅ ${ADMIN_EMAIL} → role: admin en Firestore`)
    }
  } finally {
    // 4. Delete temp account
    console.log('\n🧹 Eliminando cuenta temporal…')
    const delRes = await idtPost('accounts:delete', { idToken })
    if (delRes.status === 200) {
      console.log('  ✅ Cuenta temporal eliminada')
    } else {
      console.log(`  ⚠ No se pudo eliminar cuenta temporal: ${JSON.stringify(delRes.body).slice(0, 100)}`)
    }
  }

  console.log('\n✅ Setup completado.')
  console.log('   Próximo paso: restaurar firestore.rules y redeploy.\n')
}

main().catch((err) => {
  console.error('\n❌', err.message)
  process.exit(1)
})
