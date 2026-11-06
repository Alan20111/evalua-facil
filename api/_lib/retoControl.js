// Reto Exprés — acciones del DOCENTE (etapa 3). Se registran como acciones de /api/subject/[action] (`reto-crear`,
// `reto-control`) para no gastar funciones del plan Hobby, igual que Participación en vivo.
//
// Ningún cliente escribe en las colecciones reto* (firestore.rules): el docente actúa aquí y el servidor decide con
// su propio reloj, dentro de transacciones. Las reglas de cada transición viven en src/utils/retoExpres.js.
import crypto from 'crypto'
import { aplicarCors } from './cors.js'
import {
  getDb, verifyRequest, FieldValue, ErrorReto, leerBody, leerCodigo, refs, ahoraReto, esOfensivo, nombresProtegidos,
  finalizarSiToca, responderError, resumenTiempo,
} from './retoComun.js'
import { generarCodigoVivo } from '../../src/utils/participacionVivo.js'
import {
  RETO_CFG, ESTADOS_RETO, TIEMPO_POR_OMISION_SEG, duracionValida, modalidadValida, modoIdentidadDe, estadoPreguntasReto, faseReto, iniciarReto, pausarReto,
  reanudarReto, terminarReto, abrirAcceso, cerrarAcceso, expulsarParticipante, validarAlias,
  cerrarPreguntaReto, mostrarClasificacionReto, cancelarClasificacionReto, continuarReto, revelarDe, duracionesIguales,
} from '../../src/utils/retoExpres.js'

const azar = () => crypto.randomBytes(4).readUInt32BE(0) / 2 ** 32
const INTENTOS_CODIGO = 5

async function docenteDeLaPeticion(req) {
  try { return (await verifyRequest(req)).uid } catch (e) { throw new ErrorReto(e.status || 401, 'Inicia sesión.') }
}

// Preguntas del reto con su clave, en el orden del reto.
async function preguntasDelReto(db, actividadId) {
  const [pSnap, cSnap] = await Promise.all([
    db.collection(`activities/${actividadId}/preguntas`).get(),
    db.collection(`activities/${actividadId}/clave`).get(),
  ])
  const claves = {}
  cSnap.docs.forEach((d) => { claves[d.id] = d.data()?.respuestaCorrecta ?? null })
  return pSnap.docs
    .map((d) => ({ id: d.id, ...d.data(), respuestaCorrecta: claves[d.id] ?? null }))
    .sort((a, b) => ((a.orden ?? 0) - (b.orden ?? 0)) || a.id.localeCompare(b.id))
}

/**
 * Crea una sesión del reto: copia pública de las 10 preguntas (sin clave) en `retoSesiones/{código}` y la clave
 * congelada en `retoClaves/{código}`. Una sola sesión sin finalizar por reto (T6). Devuelve { codigo }.
 */
export async function crearSesionReto(db, uid, actividadId) {
  if (typeof actividadId !== 'string' || !actividadId || actividadId.includes('/')) throw new ErrorReto(400, 'Falta el reto.')
  const actRef = db.doc(`activities/${actividadId}`)
  const act = (await actRef.get()).data()
  if (!act || act.categoria !== RETO_CFG.CATEGORIA) throw new ErrorReto(404, 'No encontramos ese reto.')
  if (act.docenteId !== uid) throw new ErrorReto(403, 'Este reto no es tuyo.')
  const modalidad = act.reto?.modalidad
  if (!modalidadValida(modalidad)) throw new ErrorReto(409, 'Este reto no está bien configurado.')

  const lista = await preguntasDelReto(db, actividadId)
  if (!estadoPreguntasReto(lista).completo) {
    throw new ErrorReto(409, `El reto necesita exactamente ${RETO_CFG.TOTAL_PREGUNTAS} preguntas de opción múltiple o verdadero/falso, todas con respuesta correcta.`, 'PREGUNTAS_INCOMPLETAS')
  }
  // Tiempo de cada pregunta (4-nov-2026): se CONGELA aquí, en la copia pública de la sesión. Editarlo después no
  // cambia una competencia ya creada. Sin `tiempoSeg` (preguntas anteriores a esta opción) = 20 s; uno que no esté en
  // la lista se rechaza: no se inventa una duración.
  if (lista.some((p) => p.tiempoSeg != null && !duracionValida(p.tiempoSeg))) {
    throw new ErrorReto(409, 'Una pregunta tiene un tiempo que no es de la lista. Edítala y elige uno.', 'TIEMPO_INVALIDO')
  }
  const preguntas = lista.map((p) => ({
    id: p.id, tipo: p.tipo, enunciado: p.enunciado,
    opciones: (p.opciones || []).map((o) => ({ id: String(o.id), texto: String(o.texto ?? '') })),
    tiempoSeg: duracionValida(p.tiempoSeg) ? p.tiempoSeg : TIEMPO_POR_OMISION_SEG,
  }))
  const claves = Object.fromEntries(lista.map((p) => [p.id, { respuestaCorrecta: p.respuestaCorrecta }]))
  const externo = modalidad === 'externo'
  // Orden aleatorio por participante (6-nov-2026): solo si el docente lo pidió Y las 10 preguntas duran exactamente lo
  // mismo (se comprueba aquí, con los tiempos ya congelados; con duraciones distintas todos reciben el orden del docente).
  const aleatorizar = act.reto?.aleatorizar === true && duracionesIguales(preguntas)

  for (let intento = 0; intento < INTENTOS_CODIGO; intento++) {
    const codigo = generarCodigoVivo(azar)
    const r = refs(db, codigo)
    try {
      await db.runTransaction(async (tx) => {
        // T6: no se crea otra mientras una siga sin finalizar (la consulta va dentro de la transacción).
        const abiertas = await tx.get(db.collection('retoSesiones').where('actividadId', '==', actividadId))
        const abierta = abiertas.docs.find((d) => d.data().estado !== ESTADOS_RETO.finalizada)
        if (abierta) throw new ErrorReto(409, 'Este reto ya tiene una competencia sin finalizar. Termínala antes de crear otra.', 'SESION_ABIERTA')
        const ahora = ahoraReto()
        tx.create(r.sesion, {
          actividadId, asignaturaId: act.asignaturaId, docenteId: uid, titulo: act.nombre || '',
          modalidad, modoIdentidad: modoIdentidadDe({ modalidad, modoIdentidad: act.reto?.modoIdentidad }),
          calificable: externo ? false : act.reto?.calificable === true,
          estado: ESTADOS_RETO.espera, accesoAbierto: false, totalPreguntas: RETO_CFG.TOTAL_PREGUNTAS, preguntas,
          pausas: [], inicioMs: null, terminadaMs: null, finalizadaMs: null, creadaMs: ahora, creadaEn: FieldValue.serverTimestamp(),
          // Versión 2 (5-nov-2026): cierres anticipados, clasificación a pedido y desempate por tiempo. `revelar` congela
          // «Mostrar respuesta correcta al estudiante» de la actividad (la decide solo el docente; nada del participante).
          version: RETO_CFG.VERSION_RITMO, cortes: [], clasificacionPendiente: null, revelar: revelarDe(act.reto),
          ...(aleatorizar ? { aleatorizar: true } : {}),
        })
        tx.create(r.claves, { sesionId: codigo, actividadId, docenteId: uid, claves })
      })
      return { codigo }
    } catch (e) {
      if (e instanceof ErrorReto) throw e
      if (e?.code === 6 || /ALREADY_EXISTS/.test(String(e?.message))) continue // código repetido: se elige otro
      throw e
    }
  }
  throw new Error('reto-crear: no se encontró un código libre')
}

// Transiciones del reloj y del acceso: { accion: (sesion, ahora, body) => { ok, patch } }.
const TRANSICIONES = {
  iniciar: (s, t) => iniciarReto(s, t),
  pausar: (s, t) => pausarReto(s, t),
  reanudar: (s, t) => reanudarReto(s, t),
  terminar: (s, t, b) => terminarReto(s, t, { confirmado: b.confirmado === true }),
  'abrir-acceso': (s, t) => abrirAcceso(s, t),
  'cerrar-acceso': (s) => cerrarAcceso(s),
  // Versión 2 (5-nov-2026): el docente marca el ritmo. `indice` = la pregunta que ve abierta (un doble clic no salta dos).
  'cerrar-pregunta': (s, t, b) => cerrarPreguntaReto(s, t, { indice: Number.isInteger(b.indice) ? b.indice : Number(b.indice), mostrarClasificacion: b.mostrarClasificacion === true }),
  'mostrar-clasificacion': (s, t) => mostrarClasificacionReto(s, t),
  'cancelar-clasificacion': (s, t) => cancelarClasificacionReto(s, t),
  continuar: (s, t) => continuarReto(s, t),
}

// La sesión leída DENTRO de la transacción: pudo borrarse entre la primera lectura y esta.
async function sesionEnTransaccion(tx, r) {
  const s = (await tx.get(r.sesion)).data()
  if (!s) throw new ErrorReto(404, 'La competencia no existe.')
  return s
}

async function participanteDeLaSesion(tx, db, codigo, participanteId) {
  if (typeof participanteId !== 'string' || !participanteId.startsWith(`${codigo}_`) || participanteId.includes('/')) {
    throw new ErrorReto(404, 'Ese participante no existe.')
  }
  const ref = db.doc(`retoParticipantes/${participanteId}`)
  const snap = await tx.get(ref)
  if (!snap.exists || snap.data().sesionId !== codigo) throw new ErrorReto(404, 'Ese participante no existe.')
  return { ref, p: { id: snap.id, ...snap.data() } }
}

/**
 * Ejecuta una acción del docente sobre la sesión `codigo`. Acciones: iniciar, pausar, reanudar, terminar {confirmado},
 * abrir-acceso, cerrar-acceso, expulsar {participanteId}, renombrar {participanteId, alias}, finalizar y, en la versión 2,
 * cerrar-pregunta {indice, mostrarClasificacion}, mostrar-clasificacion, cancelar-clasificacion y continuar.
 */
export async function ejecutarControlReto(db, codigo, uid, accion, body = {}) {
  const r = refs(db, codigo)
  const previa = (await r.sesion.get()).data()
  if (!previa) throw new ErrorReto(404, 'La competencia no existe.')
  if (previa.docenteId !== uid) throw new ErrorReto(403, 'Esta competencia no es tuya.')

  if (TRANSICIONES[accion]) {
    const ses = await db.runTransaction(async (tx) => {
      const s = await sesionEnTransaccion(tx, r)
      const ahora = ahoraReto()
      if (s.estado === ESTADOS_RETO.finalizada) throw new ErrorReto(409, 'Esta competencia ya terminó.', 'FINALIZADA')
      const t = TRANSICIONES[accion](s, ahora, body)
      if (!t.ok) throw new ErrorReto(409, t.error, t.codigo)
      if (t.patch) tx.update(r.sesion, t.patch)
      return { ...s, ...(t.patch || {}) }
    })
    // Al terminar (por el docente) se genera de una vez el registro definitivo (T7).
    if (accion === 'terminar') await finalizarSiToca(db, codigo)
    const actual = (await r.sesion.get()).data() || ses
    return resumenTiempo(actual, ahoraReto(), faseReto)
  }

  if (accion === 'finalizar') {
    const estado = await finalizarSiToca(db, codigo)
    if (estado === 'en_curso') throw new ErrorReto(409, 'La competencia sigue en curso.', 'EN_CURSO')
    return { ...resumenTiempo((await r.sesion.get()).data() || previa, ahoraReto(), faseReto), resultados: estado }
  }

  if (accion === 'expulsar') {
    await db.runTransaction(async (tx) => {
      const s = await sesionEnTransaccion(tx, r)
      const { ref, p } = await participanteDeLaSesion(tx, db, codigo, body.participanteId)
      if (s.estado === ESTADOS_RETO.finalizada) throw new ErrorReto(409, 'Esta competencia ya terminó.', 'FINALIZADA')
      const e = expulsarParticipante(p, ahoraReto())
      if (!e.ok) throw new ErrorReto(404, e.error, e.codigo)
      if (e.patch) tx.update(ref, e.patch)
    })
    return resumenTiempo((await r.sesion.get()).data() || previa, ahoraReto(), faseReto)
  }

  if (accion === 'renombrar') {
    if (modoIdentidadDe(previa) !== 'alias') throw new ErrorReto(409, 'Esta competencia usa el nombre real.', 'SIN_ALIAS')
    const protegidos = await nombresProtegidos(db, previa)
    await db.runTransaction(async (tx) => {
      const s = await sesionEnTransaccion(tx, r)
      const { ref, p } = await participanteDeLaSesion(tx, db, codigo, body.participanteId)
      if (s.estado === ESTADOS_RETO.finalizada) throw new ErrorReto(409, 'Esta competencia ya terminó.', 'FINALIZADA')
      const v = validarAlias(body.alias, { ocupados: [], esOfensivo, nombresProtegidos: protegidos })
      if (!v.ok) throw new ErrorReto(400, v.error, v.codigo)
      if (v.clave === p.aliasClave) { tx.update(ref, { alias: v.alias }); return } // mismo alias con otra escritura
      const nueva = await tx.get(r.alias(v.clave))
      if (nueva.exists) throw new ErrorReto(409, 'Ese alias ya lo usa otro participante. Elige otro.', 'OCUPADO')
      if (p.aliasClave) tx.delete(r.alias(p.aliasClave))
      tx.create(r.alias(v.clave), { sesionId: codigo, actividadId: s.actividadId, docenteId: s.docenteId, participanteId: p.id })
      tx.update(ref, { alias: v.alias, aliasClave: v.clave, renombradoMs: ahoraReto() })
    })
    return resumenTiempo((await r.sesion.get()).data() || previa, ahoraReto(), faseReto)
  }

  throw new ErrorReto(400, 'Acción no válida.')
}

// ── /api/subject/reto-crear ────────────────────────────────────────────────
export async function handleRetoCrear(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const body = leerBody(req)
  if (!body) return res.status(400).json({ error: 'Body inválido.' })
  try {
    const uid = await docenteDeLaPeticion(req)
    const r = await crearSesionReto(getDb(), uid, body.actividadId)
    return res.status(200).json({ ok: true, ...r })
  } catch (e) { return responderError(res, e) }
}

// ── /api/subject/reto-control ──────────────────────────────────────────────
export async function handleRetoControl(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const body = leerBody(req)
  if (!body) return res.status(400).json({ error: 'Body inválido.' })
  const codigo = leerCodigo(body.codigo)
  if (!codigo) return res.status(404).json({ error: 'El código no es válido.' })
  try {
    const uid = await docenteDeLaPeticion(req)
    const r = await ejecutarControlReto(getDb(), codigo, uid, String(body.accion || ''), body)
    return res.status(200).json({ ok: true, ...r })
  } catch (e) { return responderError(res, e) }
}
