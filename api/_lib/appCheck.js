import { admin, getDb } from './firebaseAdmin.js'

// App Check en las funciones de Vercel (docs/PLAN_GOOGLE_PLAY.md, S3).
//
// El cliente manda el token en X-Firebase-AppCheck (fetchApi en
// src/utils/apiBase.js). Aquí se verifica con el Admin SDK y se cuenta el
// resultado por día y por endpoint en `appCheckMetricas/{AAAA-MM-DD}`:
// así se ve, antes de exigirlo, cuántas llamadas legítimas llegarían sin
// token (WebView viejo, reCAPTCHA que no carga) y se rechazarían.
//
// Dos fases, con la variable de entorno APP_CHECK_OBLIGATORIO en Vercel:
//   ausente → solo mide; ninguna llamada se rechaza (hoy).
//   '1'     → la llamada sin token válido recibe 401.
//
// Uso, al principio del handler (después de CORS):
//   if (await exigirAppCheck(req, res, 'student')) return

const OBLIGATORIO = process.env.APP_CHECK_OBLIGATORIO === '1'

async function verificar(req) {
  const token = req.headers['x-firebase-appcheck']
  if (!token) return 'ausente'
  try {
    await admin.appCheck().verifyToken(token)
    return 'valido'
  } catch {
    return 'invalido'
  }
}

function contar(endpoint, estado) {
  const dia = new Date().toISOString().slice(0, 10)
  // Sin await: la métrica nunca debe frenar ni tumbar la llamada real.
  getDb().collection('appCheckMetricas').doc(dia).set({
    [`${endpoint}.${estado}`]: admin.firestore.FieldValue.increment(1),
  }, { merge: true }).catch(() => {})
}

// Devuelve true si ya respondió (rechazo) y el handler debe salir.
export async function exigirAppCheck(req, res, endpoint) {
  if (req.method === 'OPTIONS') return false
  const estado = await verificar(req)
  contar(endpoint, estado)
  if (OBLIGATORIO && estado !== 'valido') {
    res.status(401).json({ error: 'No se pudo verificar la aplicación. Actualiza la página e inténtalo de nuevo.' })
    return true
  }
  return false
}
