import admin from 'firebase-admin'

let initialized = false

function init() {
  if (initialized) return
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT no está configurado en Vercel')

  // Accept either raw JSON or base64-encoded JSON.
  let json
  try {
    json = JSON.parse(raw)
  } catch {
    json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  }

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(json) })
  }
  initialized = true
}

export function getDb() {
  init()
  return admin.firestore()
}

export function getAuth() {
  init()
  return admin.auth()
}

export { admin }

// Verify the Firebase ID token sent by the client in the Authorization header.
// Returns the decoded token (with uid) or throws.
export async function verifyRequest(req) {
  const header = req.headers.authorization || req.headers.Authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    const err = new Error('No autenticado')
    err.status = 401
    throw err
  }
  return getAuth().verifyIdToken(token)
}
