import crypto from 'node:crypto'
import { getDb, admin } from './_lib/firebaseAdmin.js'

// Receptor de errores de la app (docs/PLAN_GOOGLE_PLAY.md, O3).
//
// Android vitals solo ve los fallos NATIVOS; si React o un evento truena, la
// persona ve la pantalla en blanco o un aviso y nadie se entera. El cliente
// (src/utils/registroErrores.js) manda aquí cada error con navigator.sendBeacon.
//
// Mismo criterio que api/csp-report.js: cada error DISTINTO (tipo + mensaje +
// primer renglón de la pila, sin números ni ids) es UN documento de
// `erroresCliente` con un contador, así la colección crece con los problemas
// distintos, no con las visitas. No se guarda nada de la persona: ni uid, ni
// correo, ni la URL completa; solo la ruta con los ids reemplazados.
//
// Sin autenticación a propósito: un error puede pasar antes de iniciar sesión
// (o justo por no poder iniciarla). Por eso todo se recorta y la respuesta es
// siempre 204.

const TIPOS = new Set(['render', 'error', 'promesa'])
const PLATAFORMAS = new Set(['web', 'android', 'ios'])

function corto(valor, max) {
  return String(valor || '').slice(0, max)
}

async function leerCuerpo(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
  let texto = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : ''
  if (!texto) {
    const partes = []
    let total = 0
    for await (const parte of req) {
      total += parte.length
      if (total > 32 * 1024) break
      partes.push(parte)
    }
    texto = Buffer.concat(partes).toString('utf8')
  }
  return JSON.parse(texto || '{}')
}

// Lo que identifica a un error sin importar en qué asignatura o con qué
// números pasó: así «No se encontró la actividad abc123» y «… def456» cuentan
// como el mismo problema.
export function firmaDeError({ tipo, mensaje, pila }) {
  const limpiar = (t) => String(t || '')
    .replace(/https?:\/\/[^\s)]+\/assets\/([\w-]+?)-[\w-]{8}\.js/g, '$1.js')
    .replace(/[A-Za-z0-9]{20,}/g, '<id>')
    .replace(/\d+/g, '0')
  const primerMarco = String(pila || '').split('\n').find((l) => /\bat\b|@/.test(l)) || ''
  return crypto.createHash('sha1').update(`${tipo}|${limpiar(mensaje)}|${limpiar(primerMarco)}`).digest('hex').slice(0, 24)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const c = await leerCuerpo(req)
    const tipo = TIPOS.has(c.tipo) ? c.tipo : 'error'
    const mensaje = corto(c.mensaje, 300).trim()
    if (!mensaje) return res.status(204).end()
    const datos = {
      tipo,
      mensaje,
      pila: corto(c.pila, 2000),
      ruta: corto(c.ruta, 120),
      version: corto(c.version, 12),
      plataforma: PLATAFORMAS.has(c.plataforma) ? c.plataforma : 'web',
      navegador: corto(c.navegador, 40),
      rol: ['docente', 'alumno', 'admin', 'sin sesión'].includes(c.rol) ? c.rol : 'sin sesión',
    }
    const ref = getDb().collection('erroresCliente').doc(firmaDeError(datos))
    const ahora = admin.firestore.FieldValue.serverTimestamp()
    // create() solo la primera vez (así «primero» no se pisa); después, update.
    await ref.create({ ...datos, cuenta: 1, primero: ahora, ultimo: ahora }).catch(() => ref.update({
      cuenta: admin.firestore.FieldValue.increment(1),
      ultimo: ahora,
      ruta: datos.ruta,
      version: datos.version,
      plataforma: datos.plataforma,
      navegador: datos.navegador,
      rol: datos.rol,
    }))
  } catch {
    // Un reporte mal formado no le importa a nadie: el cliente no reintenta.
  }
  return res.status(204).end()
}
