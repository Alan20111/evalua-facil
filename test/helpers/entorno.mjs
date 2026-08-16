// Andamio mínimo para probar endpoints y la lógica de las Cloud Functions
// contra el emulador. Es la "rebanada delgada" que autorizó el PO el
// 6-ago-2026 (niveles 0, 1 y 2; el 3 —emulador de Functions— queda fuera).
//
// Por qué esto es barato: los endpoints ya tienen la forma correcta. Son
// `handler(req, res)`, así que se importan y se llaman — no hace falta
// servidor HTTP, ni `vercel dev`, ni supertest. Y su único acoplamiento al
// exterior es `api/_lib/firebaseAdmin.js`, que el Admin SDK redirige solo al
// ver FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST. Cero refactor.
//
// ORDEN IMPORTANTE: las variables de entorno se ponen ANTES de que nada
// importe firebase-admin.
//
// Y un detalle que cuesta media hora si no se sabe: **hay DOS copias de
// firebase-admin en el árbol**, la de la raíz (que usan `api/` y estas
// pruebas) y la de `functions/node_modules` (que usa `functions/index.js`).
// Son módulos distintos con registros de apps distintos, así que cada uno
// inicializa el suyo: `functions/index.js` lo hace solo al cargarse, y aquí se
// inicializa el de la raíz. No chocan, y como los dos miran al emulador ven
// exactamente los mismos datos.

import { createRequire } from 'node:module'
import assert from 'node:assert'

export const PROYECTO = 'demo-test'

process.env.GCLOUD_PROJECT = PROYECTO
process.env.GOOGLE_CLOUD_PROJECT = PROYECTO
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
// `api/_lib/firebaseAdmin.js` exige esta variable y hace `JSON.parse`. Solo
// necesita parsear: como la app por defecto ya existirá, nunca llega a usarse
// para construir credenciales (y contra el emulador no hay nada que firmar).
process.env.FIREBASE_SERVICE_ACCOUNT ||= JSON.stringify({ project_id: PROYECTO })

const require = createRequire(import.meta.url)

// `functions/index.js` inicializa su propia copia de firebase-admin al cargarse.
export const funciones = require('../../functions/index.js')
// `functions/ia.js` (OP-10) reutiliza esa MISMA app por defecto — se importa
// después de `funciones` a propósito, para no inicializarla dos veces.
export const iaFn = require('../../functions/ia.js')
// Un `DocumentReference`/`DocumentSnapshot` de la copia RAÍZ de firebase-admin
// (ver `db` más abajo) no sirve como `event.data.after` al invocar
// `onEvaluacionFinalizada.run(event)` directamente — por dentro usa
// `tx.get(after.ref)`, y una transacción solo acepta referencias de SU PROPIA
// instancia de Firestore. `dbFn` es la instancia de la copia de
// `functions/node_modules` (la que usan `funciones` e `iaFn`), para construir
// snapshots sintéticos que esa transacción sí pueda usar.
//
// `firebase-admin` declara "exports" en su package.json, así que un require
// por RUTA (en vez de por nombre) no resuelve sus subpaths (p.ej. "/firestore")
// — hay que pedirlo como especificador desnudo, pero resuelto COMO SI se
// pidiera desde dentro de `functions/`, para que encuentre la copia de ahí y
// no la de la raíz del repo.
const requireDesdeFunctions = createRequire(new URL('../../functions/index.js', import.meta.url))
const { getFirestore: getFirestoreFn } = requireDesdeFunctions('firebase-admin/firestore')
export const dbFn = getFirestoreFn()

// Y aquí, la de la raíz — la misma que usa `api/_lib/firebaseAdmin.js`.
const admin = require('firebase-admin')
if (!admin.apps.length) admin.initializeApp({ projectId: PROYECTO })
export const db = admin.firestore()
export const auth = admin.auth()

// ── Llamar a un endpoint ────────────────────────────────────────────────────

// `res` de mentira: captura lo que el handler responde en vez de mandarlo por
// la red. Devuelve `this` en los encadenables para que `res.status(x).json(y)`
// funcione igual que en Vercel.
export function respuestaFalsa() {
  const r = {
    statusCode: null, cuerpo: null, cabeceras: {}, terminada: false,
    status(c) { r.statusCode = c; return r },
    json(o) { r.cuerpo = o; r.terminada = true; return r },
    send(o) { r.cuerpo = o; r.terminada = true; return r },
    end() { r.terminada = true; return r },
    setHeader(k, v) { r.cabeceras[k.toLowerCase()] = v; return r },
    getHeader(k) { return r.cabeceras[k.toLowerCase()] },
  }
  return r
}

export async function llamar(handler, { metodo = 'POST', cuerpo, token, origen, cabeceras = {} } = {}) {
  const headers = { 'content-type': 'application/json', ...cabeceras }
  if (token) headers.authorization = `Bearer ${token}`
  if (origen) headers.origin = origen
  const req = { method: metodo, headers, body: cuerpo }
  const res = respuestaFalsa()
  await handler(req, res)
  return res
}

// ── Sesiones ────────────────────────────────────────────────────────────────

// Token de sesión real contra el emulador de Auth. Con el emulador levantado,
// `createCustomToken` no firma (no hay llave) y el emulador tampoco verifica:
// se canjea igual que en producción.
export async function sesion(uid, extra = {}) {
  try { await auth.getUser(uid) } catch { await auth.createUser({ uid, ...extra }) }
  const custom = await auth.createCustomToken(uid)
  const r = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }) }
  )
  const d = await r.json()
  if (!d.idToken) throw new Error('el emulador de Auth no devolvió idToken: ' + JSON.stringify(d))
  return d.idToken
}

// ── Cloudinary de mentira ───────────────────────────────────────────────────
//
// Cloudinary NO se emula, así que se intercepta `fetch`. Esto no es una
// concesión: es lo que permite AFIRMAR qué se le pidió borrar y con qué
// parámetros — que es justo donde estuvo el defecto de A17 (`invalidate`).
// Todo lo que no vaya a api.cloudinary.com pasa de largo.
// El `fetch` de verdad se guarda UNA vez, al cargar el módulo, y siempre se
// vuelve a él. Antes cada pinchazo guardaba «el fetch que hubiera en ese
// momento», y eso se anida: si una prueba pincha y falla antes de restaurar, la
// siguiente pincha encima, y al restaurarse deja puesto el stub de la primera
// **para el resto de la corrida**. Comprobado que pasaba. Un banco de pruebas
// que se contamina a sí mismo es peor que no tenerlo: sigue en verde.
const FETCH_ORIGINAL = globalThis.fetch

export function restaurarFetch() { globalThis.fetch = FETCH_ORIGINAL }

export function pincharCloudinary({ resultado = 'ok' } = {}) {
  const llamadas = []
  globalThis.fetch = async (url, opciones = {}) => {
    const u = String(url)
    if (!u.includes('api.cloudinary.com')) return FETCH_ORIGINAL(url, opciones)
    const cuerpo = opciones.body ? JSON.parse(opciones.body) : {}
    llamadas.push({ url: u, cuerpo })
    const r = typeof resultado === 'function' ? resultado(cuerpo) : resultado
    return new Response(JSON.stringify({ result: r }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  return {
    llamadas,
    // public_ids que se pidió destruir, en orden
    destruidos: () => llamadas.map((l) => l.cuerpo.public_id),
    restaurar: restaurarFetch,
  }
}

// ── Datos ───────────────────────────────────────────────────────────────────

export function urlCloudinary(tipo, publicId) {
  const ext = tipo === 'raw' ? '' : '.png'
  return `https://res.cloudinary.com/demo-cloud/${tipo}/upload/v1/${publicId}${ext}`
}

// Borra TODO lo del emulador (Firestore y Auth) entre bloques de prueba, para
// que ninguno herede el estado del anterior.
export async function limpiar() {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`,
    { method: 'DELETE' }
  )
  await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/accounts`,
    { method: 'DELETE' }
  )
}

// ── Marcador ────────────────────────────────────────────────────────────────

let pasadas = 0
const fallos = []

export async function caso(nombre, fn) {
  try {
    await fn()
    console.log('  ✓', nombre)
    pasadas++
  } catch (e) {
    console.log('  ✗', nombre)
    console.log('     ', e.message.split('\n')[0])
    fallos.push({ nombre, error: e })
  } finally {
    // Pase lo que pase, el caso siguiente arranca con el `fetch` de verdad.
    // Sin esto, una prueba que falla a media faena deja su stub puesto y
    // contamina todas las demás sin que nadie se entere.
    restaurarFetch()
  }
}

export function grupo(titulo) {
  console.log(`\n── ${titulo}`)
}

export function resumen(etiqueta) {
  console.log(`\n${'─'.repeat(60)}`)
  if (fallos.length) {
    console.log(`${etiqueta}: ${pasadas} pasaron, ${fallos.length} FALLARON\n`)
    fallos.forEach((f) => {
      console.log(`  ✗ ${f.nombre}`)
      console.log(`    ${f.error.stack?.split('\n').slice(0, 3).join('\n    ')}`)
    })
    process.exitCode = 1
  } else {
    console.log(`ALL ${pasadas} ${etiqueta} PASSED`)
  }
  return { pasadas, fallos: fallos.length }
}

export { assert }
