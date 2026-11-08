// La Ruleta del Destino — fase 2: el DOCENTE administra el banco de su ruleta (docs/RULETA_DESTINO.md).
// Acción `ruleta-banco` de /api/subject/[action] (no gasta funciones del plan de Vercel), con una operación por petición:
//   · guardar  → reactivo nuevo           · editar → cambia uno existente      · borrar → quita uno
//   · aprobar  → aprueba el banco completo · config → cambia las preguntas por partida (R6, F2-6)
//
// Ningún cliente escribe en ruletaReactivos ni en ruletaBancos (firestore.rules, R1 y F2-1): el docente actúa aquí y el
// servidor decide. Cada operación comprueba la sesión, que la actividad sea una ruleta y que sea del docente, y corre
// en una transacción sobre el estado del banco (`ruletaBancos/{actividadId}`): así dos pestañas no pueden meter el
// mismo enunciado ni pasar el máximo, y la aprobación nunca queda desfasada. Las reglas de cada transición viven en
// src/utils/ruletaDestino.js (las mismas que usa la pantalla).
import crypto from 'crypto'
import { aplicarCors } from './cors.js'
import { getDb, verifyRequest, admin } from './firebaseAdmin.js'
import {
  RULETA_CFG, MOTIVOS_REACTIVO, TEXTO_PREGUNTAS_VALIDAS, preguntasPorPartidaValida, minimoBanco, maximoBanco, origenBanco, normalizarTexto, normalizarReactivo,
  validarReactivo, bancoVacio, guardarEnBanco, quitarDeBanco, evaluarAprobacion, puedeCambiarPreguntas,
} from '../../src/utils/ruletaDestino.js'

const { FieldValue } = admin.firestore

export class ErrorRuleta extends Error {
  constructor(status, mensaje, codigo = null, extra = null) { super(mensaje); this.status = status; this.codigo = codigo; this.extra = extra }
}

const idValido = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s)

/** Huella del enunciado normalizado (sin mayúsculas, acentos ni espacios de más): dos enunciados iguales, una huella. */
export function huellaEnunciado(enunciado) {
  return crypto.createHash('sha256').update(normalizarTexto(enunciado)).digest('hex').slice(0, 32)
}

function leerBody(req) {
  try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch { return null }
}

const refsDe = (db, actividadId) => ({
  actividad: db.doc(`activities/${actividadId}`),
  banco: db.doc(`ruletaBancos/${actividadId}`),
})

/** La ruleta, leída dentro de la transacción: existe, es ruleta, es del docente y está bien configurada. */
async function ruletaDelDocente(tx, ref, uid) {
  const snap = await tx.get(ref)
  const act = snap.exists ? snap.data() : null
  if (!act || act.categoria !== RULETA_CFG.CATEGORIA) throw new ErrorRuleta(404, 'No encontramos esa ruleta.', 'NO_EXISTE')
  if (act.docenteId !== uid) throw new ErrorRuleta(403, 'Esta ruleta no es tuya.', 'AJENA')
  if (!act.ruleta || !preguntasPorPartidaValida(act.ruleta.preguntasPorPartida)) {
    throw new ErrorRuleta(409, 'Esta ruleta no está bien configurada.', 'MAL_CONFIGURADA')
  }
  return act
}

async function bancoDe(tx, ref) {
  const snap = await tx.get(ref)
  return snap.exists ? { ...bancoVacio(), ...snap.data() } : bancoVacio()
}

// Lo que se guarda del estado del banco (sin campos de más). El origen sale SIEMPRE del estado leído en la
// transacción (nunca del cuerpo de la petición): un banco nace 'manual' (bancoVacio) y editar, agregar o borrar lo
// conserva, salvo borrar el último reactivo, que lo deja en 'manual' (quitarDeBanco, en la misma transacción que el
// borrado); solo la generación con IA (fase 3) podrá dejarlo en 'ia'.
function datosBanco(banco, { uid, actividadId }) {
  return {
    docenteId: uid, actividadId, origen: origenBanco(banco), total: banco.total, huellas: banco.huellas, aprobado: banco.aprobado === true,
    aprobadoEn: banco.aprobado === true ? (banco.aprobadoEn ?? FieldValue.serverTimestamp()) : null,
    version: banco.version ?? 0, actualizadoEn: FieldValue.serverTimestamp(),
  }
}

// Valida y normaliza el reactivo que manda el navegador; lanza 400 con el mensaje para el docente.
function reactivoDelCuerpo(body, id) {
  const r = normalizarReactivo(body?.reactivo || {})
  const v = validarReactivo({ id, ...r })
  if (!v.ok) {
    const codigo = v.errores[0]
    throw new ErrorRuleta(400, MOTIVOS_REACTIVO[codigo] || 'Revisa el reactivo.', 'REACTIVO_INVALIDO', { errores: v.errores })
  }
  return r
}

function errorDeBanco(codigo, n) {
  if (codigo === 'duplicado') return new ErrorRuleta(409, 'Ya hay un reactivo con ese enunciado.', 'DUPLICADO')
  if (codigo === 'banco_lleno') return new ErrorRuleta(409, `El banco ya tiene el máximo de ${maximoBanco(n)} reactivos.`, 'BANCO_LLENO')
  return new ErrorRuleta(409, 'No se pudo actualizar el banco. Recarga la página.', String(codigo || 'BANCO').toUpperCase())
}

const resumenBanco = (banco, n) => ({
  total: banco.total, aprobado: banco.aprobado === true, version: banco.version ?? 0, origen: origenBanco(banco),
  minimo: minimoBanco(n, origenBanco(banco)), maximo: maximoBanco(n),
})

async function guardarNuevo(db, uid, body) {
  const actividadId = body.actividadId
  const id = `${actividadId}_${crypto.randomBytes(8).toString('hex')}`
  const reactivo = reactivoDelCuerpo(body, id)
  const huella = huellaEnunciado(reactivo.enunciado)
  const refs = refsDe(db, actividadId)
  return db.runTransaction(async (tx) => {
    const act = await ruletaDelDocente(tx, refs.actividad, uid)
    const n = act.ruleta.preguntasPorPartida
    const banco = await bancoDe(tx, refs.banco)
    const g = guardarEnBanco(banco, { id, huella, nuevo: true }, n)
    if (!g.ok) throw errorDeBanco(g.codigo, n)
    tx.create(db.doc(`ruletaReactivos/${id}`), {
      docenteId: uid, actividadId, ...reactivo, huella, creadoEn: FieldValue.serverTimestamp(), actualizadoEn: FieldValue.serverTimestamp(),
    })
    tx.set(refs.banco, datosBanco(g.banco, { uid, actividadId }))
    return { reactivo: { id, ...reactivo }, banco: resumenBanco(g.banco, n) }
  })
}

// El reactivo existente, de ESTA ruleta y de ESTE docente (leído dentro de la transacción).
async function reactivoExistente(tx, db, { reactivoId, actividadId, uid }) {
  if (!idValido(reactivoId)) throw new ErrorRuleta(400, 'Falta el reactivo.', 'SIN_REACTIVO')
  const ref = db.doc(`ruletaReactivos/${reactivoId}`)
  const snap = await tx.get(ref)
  const r = snap.exists ? snap.data() : null
  if (!r || r.actividadId !== actividadId || r.docenteId !== uid) throw new ErrorRuleta(404, 'Ese reactivo ya no existe. Recarga la página.', 'REACTIVO_NO_EXISTE')
  return { ref, r }
}

async function editar(db, uid, body) {
  const { actividadId, reactivoId } = body
  const reactivo = reactivoDelCuerpo(body, String(reactivoId || 'x'))
  const huella = huellaEnunciado(reactivo.enunciado)
  const refs = refsDe(db, actividadId)
  return db.runTransaction(async (tx) => {
    const act = await ruletaDelDocente(tx, refs.actividad, uid)
    const n = act.ruleta.preguntasPorPartida
    const { ref, r } = await reactivoExistente(tx, db, { reactivoId, actividadId, uid })
    const banco = await bancoDe(tx, refs.banco)
    const g = guardarEnBanco(banco, { id: reactivoId, huella, huellaAnterior: r.huella || null, nuevo: false }, n)
    if (!g.ok) throw errorDeBanco(g.codigo, n)
    tx.update(ref, { ...reactivo, huella, actualizadoEn: FieldValue.serverTimestamp() })
    tx.set(refs.banco, datosBanco(g.banco, { uid, actividadId }))
    return { reactivo: { id: reactivoId, ...reactivo }, banco: resumenBanco(g.banco, n) }
  })
}

async function borrar(db, uid, body) {
  const { actividadId, reactivoId } = body
  const refs = refsDe(db, actividadId)
  return db.runTransaction(async (tx) => {
    const act = await ruletaDelDocente(tx, refs.actividad, uid)
    const n = act.ruleta.preguntasPorPartida
    const { ref, r } = await reactivoExistente(tx, db, { reactivoId, actividadId, uid })
    const banco = await bancoDe(tx, refs.banco)
    const q = quitarDeBanco(banco, { id: reactivoId, huella: r.huella || null })
    if (!q.ok) throw errorDeBanco(q.codigo, n)
    tx.delete(ref)
    tx.set(refs.banco, datosBanco(q.banco, { uid, actividadId }))
    return { banco: resumenBanco(q.banco, n) }
  })
}

async function aprobar(db, uid, body) {
  const { actividadId } = body
  const refs = refsDe(db, actividadId)
  return db.runTransaction(async (tx) => {
    const act = await ruletaDelDocente(tx, refs.actividad, uid)
    const n = act.ruleta.preguntasPorPartida
    const banco = await bancoDe(tx, refs.banco)
    const snap = await tx.get(db.collection('ruletaReactivos').where('actividadId', '==', actividadId).where('docenteId', '==', uid))
    const reactivos = snap.docs.map((d) => ({ id: d.id, enunciado: d.data().enunciado, opciones: d.data().opciones, correcta: d.data().correcta }))
    const e = evaluarAprobacion(banco, reactivos, n)
    if (!e.ok) {
      const mensajes = {
        banco_incompleto: `Faltan reactivos: necesitas al menos ${minimoBanco(n, origenBanco(banco))}.`,
        banco_excedido: `Hay más de ${maximoBanco(n)} reactivos: quita los que sobran.`,
        banco_con_errores: 'Hay reactivos repetidos o incompletos. Revísalos antes de aprobar.',
        banco_desfasado: 'El banco cambió mientras lo revisabas. Recarga la página.',
      }
      throw new ErrorRuleta(409, mensajes[e.codigo] || 'No se puede aprobar el banco.', e.codigo.toUpperCase(), { errores: e.errores })
    }
    const aprobado = { ...e.banco, aprobadoEn: FieldValue.serverTimestamp() }
    tx.set(refs.banco, datosBanco(aprobado, { uid, actividadId }))
    return { banco: resumenBanco(aprobado, n) }
  })
}

async function config(db, uid, body) {
  const { actividadId } = body
  const nuevo = body.preguntasPorPartida
  const refs = refsDe(db, actividadId)
  return db.runTransaction(async (tx) => {
    const act = await ruletaDelDocente(tx, refs.actividad, uid)
    const banco = await bancoDe(tx, refs.banco)
    // Defensa adicional: la bandera la pone el servidor al crear la primera sesión (fase 4); además se comprueba que
    // no exista ninguna sesión de esta ruleta.
    const sesiones = await tx.get(db.collection('ruletaSesiones').where('actividadId', '==', actividadId).limit(1))
    if (!sesiones.empty) throw new ErrorRuleta(409, 'Esta ruleta ya tiene partidas: sus preguntas no cambian.', 'CONGELADAS')
    const origen = origenBanco(banco)
    const p = puedeCambiarPreguntas({ ruleta: act.ruleta, total: banco.total, nuevo, origen })
    if (!p.ok) {
      const mensajes = {
        congeladas: 'Esta ruleta ya tiene partidas: sus preguntas no cambian.',
        preguntas_por_partida: `Elige ${TEXTO_PREGUNTAS_VALIDAS} preguntas por partida.`,
        sin_cambio: 'Ya tiene ese número de preguntas.',
        banco_incompleto: preguntasPorPartidaValida(nuevo) ? `Para ${nuevo} preguntas el banco necesita al menos ${minimoBanco(nuevo, origen)} reactivos.` : `Elige ${TEXTO_PREGUNTAS_VALIDAS}.`,
        banco_excedido: preguntasPorPartidaValida(nuevo) ? `Para ${nuevo} preguntas el banco puede tener como máximo ${maximoBanco(nuevo)} reactivos.` : `Elige ${TEXTO_PREGUNTAS_VALIDAS}.`,
      }
      throw new ErrorRuleta(409, mensajes[p.codigo] || 'No se puede cambiar.', p.codigo.toUpperCase())
    }
    tx.update(refs.actividad, { 'ruleta.preguntasPorPartida': nuevo })
    return { preguntasPorPartida: nuevo, banco: resumenBanco(banco, nuevo) }
  })
}

const OPERACIONES = { guardar: guardarNuevo, editar, borrar, aprobar, config }

/** Ejecuta una operación del banco para el docente `uid`. Lanza ErrorRuleta con el estado HTTP y el mensaje. */
export async function ejecutarOperacionBanco(db, uid, operacion, body) {
  const fn = OPERACIONES[operacion]
  if (!fn) throw new ErrorRuleta(400, 'Operación desconocida.', 'OPERACION')
  if (!idValido(body?.actividadId)) throw new ErrorRuleta(400, 'Falta la ruleta.', 'SIN_ACTIVIDAD')
  return fn(db, uid, body)
}

export async function handleRuletaBanco(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const body = leerBody(req)
  if (!body) return res.status(400).json({ error: 'Body inválido.' })
  try {
    let uid
    try { uid = (await verifyRequest(req)).uid } catch (e) { throw new ErrorRuleta(e.status || 401, 'Inicia sesión.') }
    const r = await ejecutarOperacionBanco(getDb(), uid, String(body.operacion || ''), body)
    return res.status(200).json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof ErrorRuleta) {
      return res.status(e.status).json({ error: e.message, ...(e.codigo ? { codigo: e.codigo } : {}), ...(e.extra || {}) })
    }
    throw e
  }
}
