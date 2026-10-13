import admin from 'firebase-admin'
import { nombreBucket } from '../../src/config/miEspacio.js'

let initialized = false
let projectId = null

function init() {
  if (initialized) return
  // Desarrollo local contra los EMULADORES (vite.config.js → plugin apiLocal):
  // sin cuenta de servicio, con los hosts del emulador y un proyecto «demo-».
  // En Vercel nunca existen esas variables, así que producción no pasa por aquí;
  // y el prefijo demo- impide que una configuración local apunte a un proyecto real.
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    projectId = process.env.GCLOUD_PROJECT || 'demo-esqueletos'
    if (!projectId.startsWith('demo-')) throw new Error('El modo emulador solo acepta proyectos demo-*')
    if (!admin.apps.length) admin.initializeApp({ projectId })
    initialized = true
    return
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT no está configurado en Vercel')

  // Accept either raw JSON or base64-encoded JSON.
  let json
  try {
    json = JSON.parse(raw)
  } catch {
    json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  }

  projectId = json.project_id

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

// Bucket de Firebase Storage del proyecto. Hoy solo lo usa Mi espacio (ver
// api/_lib/miEspacio.js); las evidencias y demás archivos viven en Cloudinary.
export function getBucket() {
  init()
  return admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET || nombreBucket(projectId))
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
  // Un token corrupto, caducado o de otro proyecto es exactamente lo mismo que
  // no traer token: 401. Sin este catch, el error de Firebase salía tal cual
  // con status 500 — que además de ser el código equivocado, le devolvía a
  // quien lo intentara el mensaje interno de la librería.
  // checkRevoked: true hace un roundtrip a Firebase Auth para verificar que los
  // refresh tokens del usuario siguen vigentes y que la cuenta no fue eliminada.
  // Sin esto, un ID token emitido antes de revokeRefreshTokens/deleteUser sigue
  // pasando la validación hasta que expira (hasta 1 h) — cualquier cuenta
  // eliminada podría seguir llegando a los endpoints durante esa ventana.
  try {
    return await getAuth().verifyIdToken(token, true)
  } catch {
    const err = new Error('Sesión no válida')
    err.status = 401
    throw err
  }
}
