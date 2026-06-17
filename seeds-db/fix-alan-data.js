#!/usr/bin/env node
/**
 * Fix Alan Daniel's profile: ITCELAYA → CBTIS 255 (cct: 11DCT0020A)
 * Uses temp Firebase account (rules allow write: if auth != null for users temporarily)
 */
const https = require('https')

const API_KEY = 'AIzaSyBn-gcF3PioP5Z3C4pN42fzh8Vlrjrggug'
const PROJECT_ID = 'evalua-facil-app'
const ALAN_UID = 'DV9X0bLR2YYtlhRFa5XCoITL5vv2'
const SCHOOL_CCT = '11DCT0020A'   // CBTIS 255, Tarimoro, Guanajuato
const SCHOOL_SHORT = 'CBTIS 255'
const TEMP_EMAIL = `fix.alan.${Date.now()}@evalua-setup.local`
const TEMP_PASS = `FixP4ss${Date.now()}`

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
    const urlPath = `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`
    const req = https.request(
      {
        hostname: 'firestore.googleapis.com',
        path: urlPath, method: 'PATCH',
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
  console.log('\n🔧 Corrigiendo datos de Alan Daniel: ITCELAYA → CBTIS 255\n')

  const signUpRes = await idtPost('accounts:signUp', { email: TEMP_EMAIL, password: TEMP_PASS, returnSecureToken: true })
  if (signUpRes.status !== 200) throw new Error(`signUp falló: ${JSON.stringify(signUpRes.body)}`)
  const { idToken, localId: tempUid } = signUpRes.body
  console.log(`  ✅ Cuenta temporal (${tempUid})`)

  try {
    // Update users doc
    const userRes = await fsPatch(idToken, 'users', ALAN_UID, {
      escuelaId: { stringValue: SCHOOL_CCT },
      schoolName: { stringValue: SCHOOL_SHORT },
    })
    if (userRes.status >= 300) throw new Error(`users PATCH (${userRes.status}): ${JSON.stringify(userRes.body).slice(0, 200)}`)
    console.log(`  ✅ users/${ALAN_UID}: escuelaId → ${SCHOOL_CCT}, schoolName → ${SCHOOL_SHORT}`)

    // Also create/update school doc
    const schoolRes = await fsPatch(idToken, 'schools', SCHOOL_CCT, {
      claveSEP: { stringValue: SCHOOL_CCT },
      shortName: { stringValue: SCHOOL_SHORT },
      nombre: { stringValue: 'CENTRO DE BACHILLERATO TECNOLOGICO INDUSTRIAL Y DE SERVICIOS NUM. 255' },
      municipio: { stringValue: 'TARIMORO' },
      estado: { stringValue: 'GUANAJUATO' },
    })
    if (schoolRes.status >= 300) throw new Error(`schools PATCH (${schoolRes.status}): ${JSON.stringify(schoolRes.body).slice(0, 200)}`)
    console.log(`  ✅ schools/${SCHOOL_CCT}: CBTIS 255 creado/actualizado`)

  } finally {
    await idtPost('accounts:delete', { idToken })
    console.log('  ✅ Cuenta temporal eliminada')
  }

  console.log('\n✅ Listo. Recuerda restaurar firestore.rules.\n')
}

main().catch((err) => { console.error('\n❌', err.message); process.exit(1) })
