#!/usr/bin/env node
/**
 * Setup admin + seed data using Firestore/Identity REST APIs + firebase-tools OAuth token.
 * No service account needed.
 */
const https = require('https')
const os = require('os')
const path = require('path')

const PROJECT_ID = 'evalua-facil-app'
const ADMIN_EMAIL = 'alannicanor62@gmail.com'

// Firebase CLI OAuth client credentials (public)
const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
const CLIENT_SECRET = 'j9iVZfS8hhqkLNL0r1IOdia1'

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) })
        } catch {
          resolve({ status: res.statusCode, body: data })
        }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }).toString()

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        const json = JSON.parse(data)
        if (json.error) reject(new Error(json.error_description || json.error))
        else resolve(json.access_token)
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function getUidByEmail(token, email) {
  const res = await request({
    hostname: 'identitytoolkit.googleapis.com',
    path: `/v1/projects/${PROJECT_ID}/accounts:lookup`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }, { email: [email] })

  if (res.status !== 200) {
    throw new Error(`Identity lookup failed: ${JSON.stringify(res.body)}`)
  }
  const users = res.body.users || []
  return users[0]?.localId || null
}

function firestoreValue(val) {
  if (typeof val === 'string') return { stringValue: val }
  if (typeof val === 'number') return { integerValue: String(Math.round(val)) }
  if (typeof val === 'boolean') return { booleanValue: val }
  if (val === null) return { nullValue: null }
  return { stringValue: String(val) }
}

function buildFirestoreDoc(obj) {
  const fields = {}
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = firestoreValue(v)
  }
  return { fields }
}

async function firestoreSet(token, collection, docId, data) {
  const path = `projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`
  const url = `/v1/${path}`
  const res = await request({
    hostname: 'firestore.googleapis.com',
    path: url,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }, buildFirestoreDoc(data))

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Firestore PATCH ${collection}/${docId} failed (${res.status}): ${JSON.stringify(res.body)}`)
  }
  return res.body
}

async function main() {
  console.log('🚀 Evalúa Fácil — Setup via REST API')
  console.log('='.repeat(45))

  // Load firebase-tools tokens
  const cfg = require(path.join(os.homedir(), '.config/configstore/firebase-tools.json'))
  const refreshToken = cfg.tokens?.refresh_token
  if (!refreshToken) throw new Error('No firebase-tools refresh token found. Run: firebase login')

  console.log('\n🔑 Obteniendo access token…')
  const token = await refreshAccessToken(refreshToken)
  console.log('  ✅ Token obtenido')

  // 1) Seed plan
  console.log('\n📦 Actualizando Plan Pro → $100/mes…')
  await firestoreSet(token, 'plans', 'pro', {
    nombre: 'Plan Pro',
    descripcion: 'Acceso completo a Evalúa Fácil sin límites.',
    precio: 100,
    periodicidad: 'mensual',
    maxAsignaturas: -1,
    maxAlumnos: -1,
    activo: true,
    orden: 1,
  })
  console.log('  ✅ Plan Pro — $100/mes actualizado en Firestore')

  // 2) Make admin
  console.log(`\n👤 Buscando cuenta de ${ADMIN_EMAIL}…`)
  const uid = await getUidByEmail(token, ADMIN_EMAIL)

  if (!uid) {
    console.log(`  ⚠ No existe cuenta Firebase Auth para ${ADMIN_EMAIL}.`)
    console.log(`    Inicia sesión con Google en la app primero, luego corre este script.\n`)
  } else {
    console.log(`  UID encontrado: ${uid}`)
    await firestoreSet(token, 'users', uid, {
      role: 'admin',
      email: ADMIN_EMAIL.toLowerCase(),
      username: 'admin',
    })
    console.log(`  ✅ ${ADMIN_EMAIL} → role: admin en Firestore`)
  }

  console.log('\n✅ Listo.')
  console.log('   • Entra a evalua-facil.vercel.app con Google (alannicanor62@gmail.com)')
  console.log('   • Navega a /Admin para ver el dashboard\n')
}

main().catch((err) => {
  console.error('\n❌', err.message)
  process.exit(1)
})
