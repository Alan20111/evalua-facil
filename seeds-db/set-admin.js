#!/usr/bin/env node
/**
 * Promote alannicanor62@gmail.com to admin.
 * Requires temp Firestore rules (allow write if auth != null).
 */
const https = require('https')

const API_KEY = 'AIzaSyBn-gcF3PioP5Z3C4pN42fzh8Vlrjrggug'
const PROJECT_ID = 'evalua-facil-app'
const ADMIN_EMAIL = 'alannicanor62@gmail.com'
const ADMIN_UID = 'Z16jetZX0PMAijVBCYS64rVSprd2'
const TEMP_EMAIL = `setup.adm.${Date.now()}@evalua-setup.local`
const TEMP_PASS = `SetupP4ss${Date.now()}`

function idtPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body)
    const req = https.request(
      {
        hostname: 'identitytoolkit.googleapis.com',
        path: `/v1/${endpoint}?key=${API_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }) } catch { resolve({ status: res.statusCode, body: data }) } })
      }
    )
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

function fsPatch(idToken, collection, docId, fields) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify({ fields })
    const path = `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`
    const req = https.request(
      {
        hostname: 'firestore.googleapis.com',
        path, method: 'PATCH',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }) } catch { resolve({ status: res.statusCode, body: data }) } })
      }
    )
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

async function main() {
  console.log(`\n👤 Promoviendo ${ADMIN_EMAIL} (uid: ${ADMIN_UID}) a admin…\n`)

  // Create temp user
  const signUpRes = await idtPost('accounts:signUp', { email: TEMP_EMAIL, password: TEMP_PASS, returnSecureToken: true })
  if (signUpRes.status !== 200) throw new Error(`signUp falló: ${JSON.stringify(signUpRes.body)}`)
  const { idToken, localId: tempUid } = signUpRes.body
  console.log(`  ✅ Cuenta temporal creada (uid: ${tempUid})`)

  try {
    // Write admin doc
    const res = await fsPatch(idToken, 'users', ADMIN_UID, {
      role: { stringValue: 'admin' },
      email: { stringValue: ADMIN_EMAIL.toLowerCase() },
      username: { stringValue: 'admin' },
    })
    if (res.status >= 300) throw new Error(`Firestore write falló (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`)
    console.log(`  ✅ users/${ADMIN_UID} → role: admin`)
  } finally {
    // Delete temp user
    const delRes = await idtPost('accounts:delete', { idToken })
    console.log(delRes.status === 200 ? '  ✅ Cuenta temporal eliminada' : `  ⚠ No se eliminó la cuenta temporal`)
  }

  console.log('\n✅ Admin listo.')
}

main().catch((err) => { console.error('\n❌', err.message); process.exit(1) })
