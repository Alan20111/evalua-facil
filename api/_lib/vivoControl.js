// Participación en vivo — CONTROL de la pregunta en curso (lo único que mueve el reloj de la sesión).
//
// Se registra como acciones de /api/subject/[action] (`vivo-control`, `vivo-reloj`): no gasta funciones del plan Hobby.
//
// La apertura, el límite de tiempo y el cierre de cada pregunta los fija SIEMPRE el servidor, con su propio reloj:
//   · abreMs   → cuándo empieza a poder responderse (ahora + PREPARACION_MS: todos reciben la pregunta antes de que abra);
//   · cierraMs → límite (null = modo manual, sin límite);
//   · cerradaMs → cierre anticipado (manual, o al pasar a otra pregunta).
// Ningún cliente escribe esos campos: las reglas de Firestore niegan toda escritura del docente sobre la sesión y el
// docente actúa aquí. El tiempo de exhibición y el de respuesta son el mismo intervalo [abreMs, cierraMs).
import { getDb, admin, verifyRequest } from './firebaseAdmin.js'
import { aplicarCors } from './cors.js'
import { VIVO_CFG, codigoVivoValido, estadoPreguntaVivo } from '../../src/utils/participacionVivo.js'
import { sellarVentana, sellarVentanasVencidas } from '../../src/utils/vivoSellado.js'

const { FieldValue } = admin.firestore

function leerBody(req) {
  try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch { return null }
}

class ErrorControl extends Error {
  constructor(status, mensaje) { super(mensaje); this.status = status }
}

// Lo que el docente (y el proyector) necesitan saber tras cada acción.
const resumen = (ses, ahora) => ({
  estadoPregunta: estadoPreguntaVivo(ses, ahora), ahora,
  abreMs: ses.abreMs ?? null, cierraMs: ses.cierraMs ?? null, cerradaMs: ses.cerradaMs ?? null, preguntaIndex: ses.preguntaIndex,
})

// El sellado (quiénes no respondieron, apagar «aceptando») vive en src/utils/vivoSellado.js: lo comparte el barrido programado.
async function sellarTodas(db, codigo, ahora) {
  try {
    await sellarVentanasVencidas(db, codigo, ahora)
  } catch (e) {
    console.error('vivo-control: no se pudo sellar', e?.message)
  }
}

/**
 * Ejecuta una acción del docente sobre la sesión. `ahora` se inyecta solo en pruebas; en producción es el reloj del servidor.
 * Acciones: abrir {indice}, cerrar, ampliar {segundos}, sellar, finalizar.
 */
export async function ejecutarControl(db, codigo, uid, accion, body = {}, ahoraFijo = null) {
  // Reloj del servidor. Dentro de cada transacción se vuelve a leer (justo al decidir, y de nuevo si Firestore la reintenta), para
  // que el cierre no quede fechado ANTES de lo que ya se aceptó mientras la acción esperaba su turno.
  const reloj = () => (ahoraFijo ?? Date.now())
  let ahora = reloj()
  const ref = db.doc(`vivoSesiones/${codigo}`)
  const previa = await ref.get()
  if (!previa.exists) throw new ErrorControl(404, 'La sesión no existe.')
  if (previa.data().docenteId !== uid) throw new ErrorControl(403, 'Esta sesión no es tuya.')

  let resultado
  if (accion === 'abrir') {
    resultado = await db.runTransaction(async (tx) => {
      const ses = (await tx.get(ref)).data()
      ahora = reloj()
      if (ses.estado !== 'activa') throw new ErrorControl(409, 'La sesión ya terminó.')
      const preguntas = ses.preguntas || []
      const idx = Number(body.indice)
      if (!Number.isInteger(idx) || idx < 0 || idx >= preguntas.length) throw new ErrorControl(400, 'La pregunta no existe.')
      const destino = preguntas[idx]
      const actual = ses.preguntaIndex >= 0 ? preguntas[ses.preguntaIndex] : null
      if (actual && actual.id === destino.id) return resumen(ses, ahora) // ya es la pregunta en curso: no se reinicia nada
      const ventanas = { ...(ses.ventanas || {}) }
      // Al dejar una pregunta se cierra: no se puede seguir respondiendo una pregunta que ya no se está mostrando.
      if (actual && ses.abreMs != null) {
        const est = estadoPreguntaVivo(ses, ahora)
        if (est === 'abierta' || est === 'preparando') ventanas[actual.id] = { ...(ventanas[actual.id] || {}), cerradaMs: ahora, motivo: 'avance' }
      }
      // Volver a una pregunta que ya tuvo su turno solo muestra sus resultados: NO se reabre.
      let v = ventanas[destino.id]
      if (!v) {
        const abreMs = ahora + VIVO_CFG.PREPARACION_MS
        const tiempo = Number.isInteger(destino.tiempo) && destino.tiempo > 0 ? destino.tiempo : null
        v = { abreMs, cierraMs: tiempo ? abreMs + tiempo * 1000 : null, cerradaMs: null }
        ventanas[destino.id] = v
      }
      const siguiente = { ...ses, preguntaIndex: idx, abreMs: v.abreMs, cierraMs: v.cierraMs ?? null, cerradaMs: v.cerradaMs ?? null }
      const est = estadoPreguntaVivo(siguiente, ahora)
      tx.update(ref, {
        preguntaIndex: idx, ventanas, abreMs: siguiente.abreMs, cierraMs: siguiente.cierraMs, cerradaMs: siguiente.cerradaMs,
        aceptando: est === 'abierta' || est === 'preparando',
      })
      return resumen(siguiente, ahora)
    })
  } else if (accion === 'cerrar') {
    resultado = await db.runTransaction(async (tx) => {
      const ses = (await tx.get(ref)).data()
      ahora = reloj()
      if (ses.estado !== 'activa') throw new ErrorControl(409, 'La sesión ya terminó.')
      if (!(ses.preguntaIndex >= 0)) throw new ErrorControl(409, 'Todavía no hay una pregunta en curso.')
      if (ses.abreMs == null) { tx.update(ref, { aceptando: false }); return { ...resumen({ ...ses, aceptando: false }, ahora) } } // sesión anterior
      if (estadoPreguntaVivo(ses, ahora) === 'cerrada') return resumen(ses, ahora)
      const id = ses.preguntas[ses.preguntaIndex].id
      const ventanas = { ...(ses.ventanas || {}) }
      ventanas[id] = { ...(ventanas[id] || {}), cerradaMs: ahora, motivo: 'manual' }
      tx.update(ref, { ventanas, cerradaMs: ahora, aceptando: false })
      return resumen({ ...ses, cerradaMs: ahora }, ahora)
    })
  } else if (accion === 'ampliar') {
    const seg = Number(body.segundos)
    if (!Number.isInteger(seg) || seg < VIVO_CFG.TIEMPO_MIN || seg > VIVO_CFG.AMPLIAR_MAX_SEG) throw new ErrorControl(400, 'Elige entre ' + VIVO_CFG.TIEMPO_MIN + ' y ' + VIVO_CFG.AMPLIAR_MAX_SEG + ' segundos.')
    resultado = await db.runTransaction(async (tx) => {
      const ses = (await tx.get(ref)).data()
      ahora = reloj()
      if (ses.estado !== 'activa') throw new ErrorControl(409, 'La sesión ya terminó.')
      const est = estadoPreguntaVivo(ses, ahora)
      if (ses.abreMs == null || ses.cierraMs == null) throw new ErrorControl(409, 'Esta pregunta es manual: no tiene un tiempo que ampliar.')
      if (est !== 'abierta' && est !== 'preparando') throw new ErrorControl(409, 'El tiempo ya terminó: solo se puede ampliar antes del cierre.')
      const id = ses.preguntas[ses.preguntaIndex].id
      const cierraMs = Math.min(ses.cierraMs + seg * 1000, ahora + VIVO_CFG.TIEMPO_MAX * 1000)
      tx.update(ref, { cierraMs, [`ventanas.${id}.cierraMs`]: cierraMs })
      return resumen({ ...ses, cierraMs }, ahora)
    })
  } else if (accion === 'sellar') {
    const ses = (await ref.get()).data()
    const est = estadoPreguntaVivo(ses, ahora)
    if (est !== 'cerrada') throw new ErrorControl(409, 'La pregunta sigue abierta.')
    await sellarVentana(db, codigo, ses, ses.preguntas[ses.preguntaIndex].id, ahora)
    resultado = resumen((await ref.get()).data(), ahora)
  } else if (accion === 'finalizar') {
    resultado = await db.runTransaction(async (tx) => {
      const ses = (await tx.get(ref)).data()
      ahora = reloj()
      if (ses.estado !== 'activa') return resumen(ses, ahora)
      const patch = { estado: 'finalizada', aceptando: false, finalizadaEn: FieldValue.serverTimestamp() }
      if (ses.abreMs != null && ses.preguntaIndex >= 0) {
        const est = estadoPreguntaVivo(ses, ahora)
        if (est === 'abierta' || est === 'preparando') {
          const id = ses.preguntas[ses.preguntaIndex].id
          patch.cerradaMs = ahora
          patch[`ventanas.${id}.cerradaMs`] = ahora
          patch[`ventanas.${id}.motivo`] = 'finalizar'
        }
      }
      tx.update(ref, patch)
      return resumen({ ...ses, estado: 'finalizada' }, ahora)
    })
  } else {
    throw new ErrorControl(400, 'Acción no válida.')
  }

  // Lo que ya cerró se sella (quiénes no respondieron). Un fallo aquí no deshace la acción: se reintenta en la siguiente.
  if (accion === 'abrir' || accion === 'cerrar' || accion === 'finalizar') await sellarTodas(db, codigo, ahora)
  return resultado
}

// ── /api/subject/vivo-control ──────────────────────────────────────────────
export async function handleVivoControl(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const body = leerBody(req)
  if (!body) return res.status(400).json({ error: 'Body inválido.' })
  let decoded
  try { decoded = await verifyRequest(req) } catch (e) { return res.status(e.status || 401).json({ error: 'Inicia sesión.' }) }
  const codigo = String(body.codigo || '').trim().toUpperCase()
  if (!codigoVivoValido(codigo)) return res.status(404).json({ error: 'El código no es válido.' })
  try {
    const r = await ejecutarControl(getDb(), codigo, decoded.uid, String(body.accion || ''), body)
    return res.status(200).json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof ErrorControl) return res.status(e.status).json({ error: e.message })
    throw e
  }
}

// ── /api/subject/vivo-reloj ────────────────────────────────────────────────
// Hora del servidor, para que el proyector corrija su reloj local (los celulares la reciben con cada consulta de estado).
export async function handleVivoReloj(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' })
  res.setHeader?.('Cache-Control', 'no-store')
  return res.status(200).json({ ok: true, ahora: Date.now() })
}
