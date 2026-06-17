#!/usr/bin/env node
/**
 * change-passwords.js
 * Changes all demo teacher/student passwords to 123456
 * and adds password auth to alannicanor62@gmail.com (admin).
 *
 * Teachers/students: sign in with old password → accounts:update → 123456
 * Admin (Google account): use firebase-tools OAuth token → admin accounts:update
 */
const https = require('https')

const API_KEY   = 'AIzaSyBn-gcF3PioP5Z3C4pN42fzh8Vlrjrggug'
const NEW_PASS  = '123456'
const ADMIN_UID = 'Z16jetZX0PMAijVBCYS64rVSprd2'
const ADMIN_EMAIL = 'alannicanor62@gmail.com'

// Activated students: username → escuelaId (to build fake email)
const ACTIVATED_STUDENTS = [
  { username: 'MLOP', escuelaId: '11DCT0020A' },
  { username: 'CLOR', escuelaId: '11DCT0020A' },
  { username: 'LUMA', escuelaId: '11DCT0115O' },
  { username: 'ROGU', escuelaId: '11DCT0009E' },
  { username: 'ALJA', escuelaId: '11DCT0009E' },
  { username: 'MAVE', escuelaId: '11DCT0020A' },
  { username: 'BEFE', escuelaId: '11DCT0115O' },
  { username: 'IVZA', escuelaId: '11DCT0009E' },
  { username: 'NIMO', escuelaId: '11DCT0009E' },
]

const TEACHERS = [
  { email: 'mgarcia.cbtis255@gmail.com' },
  { email: 'rsanchez.cetis115@gmail.com' },
  { email: 'amartinez.cbtis198@gmail.com' },
  { email: 'jlopez.cbtis255@gmail.com' },
  { email: 'sramirez.cetis115@gmail.com' },
  { email: 'cgomez.cbtis198@gmail.com' },
]

function post(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body)
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers },
    }, (res) => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try { resolve({ s: res.statusCode, b: JSON.parse(d) }) }
        catch { resolve({ s: res.statusCode, b: d }) }
      })
    })
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

const idt = (ep, body, extraHeaders = {}) =>
  post('identitytoolkit.googleapis.com', `/v1/${ep}?key=${API_KEY}`, extraHeaders, body)

async function changePasswordViaLogin(email, oldPwd, label) {
  const loginRes = await idt('accounts:signInWithPassword', {
    email, password: oldPwd, returnSecureToken: true,
  })
  if (loginRes.s !== 200) {
    console.log(`  ✗ ${label}: no pudo iniciar sesión (${loginRes.b?.error?.message || loginRes.s})`)
    return false
  }
  const { idToken } = loginRes.b
  const updateRes = await idt('accounts:update', { idToken, password: NEW_PASS, returnSecureToken: true })
  if (updateRes.s !== 200) {
    console.log(`  ✗ ${label}: no pudo cambiar contraseña (${updateRes.b?.error?.message || updateRes.s})`)
    return false
  }
  console.log(`  ✓ ${label}`)
  return true
}

async function changePasswordAdmin(uid, email, accessToken) {
  const res = await post('identitytoolkit.googleapis.com', `/v1/projects/evalua-facil-app/accounts:update`,
    { Authorization: `Bearer ${accessToken}`, 'X-Firebase-Client': 'fire-admin-node/12.0.0' },
    { localId: uid, password: NEW_PASS, emailVerified: true }
  )
  if (res.s === 200) {
    console.log(`  ✓ ${email} (admin, via OAuth token)`)
    return true
  }
  console.log(`  ✗ ${email}: admin update fallido (${res.b?.error?.message || res.s})`)
  return false
}

function getFirebaseAccessToken() {
  try {
    const { getGlobalDefaultAccount } = require('/opt/homebrew/lib/node_modules/firebase-tools/lib/auth.js')
    const acct = getGlobalDefaultAccount()
    return acct?.tokens?.access_token || null
  } catch {
    return null
  }
}

async function main() {
  console.log('\n🔑 Cambiando todas las contraseñas a 123456\n')

  console.log('Docentes:')
  for (const t of TEACHERS) {
    await changePasswordViaLogin(t.email, 'Evalua2024!', t.email)
  }

  console.log('\nAlumnos activados:')
  for (const s of ACTIVATED_STUDENTS) {
    const email = `${s.username.toLowerCase()}.${s.escuelaId}@evalua.local`
    await changePasswordViaLogin(email, 'Alumno2024!', `${s.username} (${s.escuelaId})`)
  }

  console.log('\nAdmin (alannicanor62@gmail.com):')
  const accessToken = getFirebaseAccessToken()
  if (accessToken) {
    await changePasswordAdmin(ADMIN_UID, ADMIN_EMAIL, accessToken)
  } else {
    console.log('  ⚠  No se encontró token OAuth. Cambia manualmente en Firebase Console:')
    console.log('     https://console.firebase.google.com/project/evalua-facil-app/authentication/users')
  }

  console.log('\n✅ Listo.\n')
}

main().catch(err => { console.error('❌', err.message); process.exit(1) })
