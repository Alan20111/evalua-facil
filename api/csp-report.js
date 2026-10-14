import crypto from 'node:crypto'
import { getDb, admin } from './_lib/firebaseAdmin.js'

// Receptor de reportes de la Content-Security-Policy (docs/PLAN_GOOGLE_PLAY.md, S2).
//
// La política va primero en modo «solo reporte» (vercel.json,
// Content-Security-Policy-Report-Only): no bloquea nada, solo avisa aquí de
// lo que habría bloqueado. Con una o dos semanas de reportes se ajusta la
// lista de orígenes y se pasa a la cabecera que sí bloquea.
//
// Cada violación distinta (directiva + origen bloqueado) es UN documento de
// `cspReportes` con un contador. Así la colección no crece con las visitas,
// solo con los problemas distintos. No se guarda la URL completa ni nada del
// usuario: solo el origen bloqueado y la ruta de la página, sin consulta.
//
// Sin autenticación a propósito: el navegador manda el reporte solo, sin
// sesión. Por eso todo se recorta y se valida, y la respuesta es siempre 204.

const LARGO_MAX = 200

function corto(valor) {
  return String(valor || '').slice(0, LARGO_MAX)
}

// 'https://res.cloudinary.com/x/y.png' → 'https://res.cloudinary.com'.
// Las palabras clave del navegador ('inline', 'eval', 'data', 'blob') pasan tal cual.
function origen(uri) {
  const valor = corto(uri)
  try {
    const u = new URL(valor)
    return u.protocol.startsWith('http') || u.protocol.startsWith('ws') ? u.origin : u.protocol.replace(':', '')
  } catch {
    return valor
  }
}

function ruta(uri) {
  try {
    return corto(new URL(uri).pathname)
  } catch {
    return ''
  }
}

async function leerCuerpo(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
  let texto = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : ''
  if (!texto) {
    const partes = []
    let total = 0
    for await (const parte of req) {
      total += parte.length
      if (total > 64 * 1024) break
      partes.push(parte)
    }
    texto = Buffer.concat(partes).toString('utf8')
  }
  return JSON.parse(texto || '{}')
}

// Dos formatos: el viejo `report-uri` ({ "csp-report": {…} }) y el nuevo
// Reporting API (un arreglo de { type: 'csp-violation', body: {…} }).
function normalizar(cuerpo) {
  const crudos = Array.isArray(cuerpo)
    ? cuerpo.filter((r) => r?.type === 'csp-violation').map((r) => r.body || {})
    : [cuerpo?.['csp-report'] || {}]
  return crudos.slice(0, 20).map((r) => ({
    directiva: corto(r['effective-directive'] || r.effectiveDirective || r['violated-directive'] || r.violatedDirective).split(' ')[0],
    bloqueado: origen(r['blocked-uri'] || r.blockedURL),
    pagina: ruta(r['document-uri'] || r.documentURL),
  })).filter((v) => v.directiva)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const violaciones = normalizar(await leerCuerpo(req))
    const db = getDb()
    await Promise.all(violaciones.map((v) => {
      const id = crypto.createHash('sha1').update(`${v.directiva}|${v.bloqueado}`).digest('hex').slice(0, 24)
      return db.collection('cspReportes').doc(id).set({
        directiva: v.directiva,
        bloqueado: v.bloqueado,
        ultimaPagina: v.pagina,
        cuenta: admin.firestore.FieldValue.increment(1),
        ultimo: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
    }))
  } catch {
    // Un reporte mal formado no le importa a nadie: el navegador no reintenta.
  }
  return res.status(204).end()
}
