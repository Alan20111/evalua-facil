// Crucigrama / Sopa de letras — callable SEPARADO de ejecutarOperacionIA a
// propósito (decisión de producto #1, aprobada): la construcción de la
// cuadrícula es un algoritmo determinista (backtracking, functions/juegoGenerator.js),
// NO usa IA/Anthropic y NO consume créditos del ledger — por eso este onCall
// no declara `secrets` ni toca functions/creditosLedger.js para nada.
//
// Recibe SOLO { actividadId } — nunca la lista de palabras desde el cliente:
// la fuente única de verdad es `activities/{id}.juego.contenido`, ya guardada
// por generar_contenido_juego (IA) o editada a mano por el docente
// (ContenidoJuegoEditor.jsx, estado 'contenido_editado').

const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getFirestore } = require('firebase-admin/firestore')
const { logger } = require('firebase-functions')
const { normalizarPalabra } = require('./_shared/normalizarPalabra.js')
const { construirSopaDeLetras, construirCrucigrama } = require('./juegoGenerator')
const ledger = require('./creditosLedger')

const MIN_PALABRAS = 5
const MAX_PALABRAS = 20
const ESTADOS_PERMITIDOS = ['contenido_generado', 'contenido_editado']

exports.construirJuego = onCall({ timeoutSeconds: 300 }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para usar esta función')

  const actividadId = String(request.data?.actividadId || '')
  if (!actividadId) throw new HttpsError('invalid-argument', 'Falta la actividad')

  const db = getFirestore()
  const actSnap = await db.doc(`activities/${actividadId}`).get()
  if (!actSnap.exists) throw new HttpsError('not-found', 'La actividad no existe')
  const act = actSnap.data()

  // Ownership vía la asignatura de la actividad (misma actividad guarda
  // docenteId al crearse — ver CrearJuegoIAModal.jsx — pero se revalida
  // contra la asignatura por si esa copia quedara desactualizada).
  if (act.docenteId !== uid) {
    const subSnap = await db.doc(`subjects/${act.asignaturaId}`).get()
    if (!subSnap.exists || subSnap.data().docenteId !== uid) {
      throw new HttpsError('permission-denied', 'Esta actividad no es tuya')
    }
  }

  if (act.categoria !== 'juego' || !['crucigrama', 'sopa_letras'].includes(act.tipoJuego)) {
    throw new HttpsError('failed-precondition', 'Esta actividad no es un Crucigrama ni una Sopa de letras')
  }

  const estado = act.juego?.estado
  if (!ESTADOS_PERMITIDOS.includes(estado)) {
    throw new HttpsError('failed-precondition',
      'El contenido debe generarse (o editarse) antes de construir el juego.')
  }

  const contenido = Array.isArray(act.juego?.contenido) ? act.juego.contenido : []
  if (contenido.length < MIN_PALABRAS || contenido.length > MAX_PALABRAS) {
    throw new HttpsError('failed-precondition',
      `El contenido debe tener entre ${MIN_PALABRAS} y ${MAX_PALABRAS} palabras (tiene ${contenido.length}).`)
  }

  const normalizadas = contenido.map((it) => normalizarPalabra(it?.palabra))
  const invalida = normalizadas.findIndex((n) => n.length < 2)
  if (invalida !== -1) {
    throw new HttpsError('failed-precondition',
      `La palabra "${contenido[invalida]?.palabra || ''}" no tiene letras suficientes para construir el juego.`)
  }
  // Palabras duplicadas tras normalizar (p. ej. "café" y "Café") rompen la
  // colocación en la cuadrícula (dos palabras iguales no tienen sentido en
  // ninguno de los dos juegos) — se detecta aquí, ANTES de gastar tiempo de
  // backtracking, y no se guarda estructura parcial.
  const vistos = new Set()
  for (const n of normalizadas) {
    if (vistos.has(n)) {
      throw new HttpsError('failed-precondition',
        'Hay dos palabras repetidas (una vez normalizadas, sin acentos): revisa el contenido antes de construir el juego.')
    }
    vistos.add(n)
  }

  let resultado
  try {
    resultado = act.tipoJuego === 'sopa_letras'
      ? construirSopaDeLetras(normalizadas)
      : construirCrucigrama(normalizadas)
  } catch (e) {
    logger.error(`construirJuego(${actividadId}) reventó:`, e)
    resultado = null
  }

  if (!resultado) {
    // No se guarda estructura parcial ni se toca juego.contenido — el
    // docente puede reintentar tal cual, o editar el contenido y reintentar.
    throw new HttpsError('resource-exhausted',
      'No se pudo construir el juego con estas palabras (demasiado largas o muchas para acomodarlas). ' +
      'Intenta de nuevo, quita alguna palabra larga o reduce la cantidad.')
  }

  // Cada entrada de estructura.palabras referencia el índice de
  // juego.contenido (palabra ORIGINAL, con acentos, para mostrar) y trae
  // además la versión normalizada (para el motor de calificación).
  // Firestore NO admite arrays anidados (un array cuyo elemento es otro
  // array) — 'Property juego contains an invalid nested entity' al
  // intentar guardar `grid` como array de arrays tal cual lo arma
  // juegoGenerator.js. Se envuelve cada fila en un objeto `{ row: [...] }`
  // (array DENTRO de un objeto sí es válido) — mismo dato, forma que
  // Firestore acepta. Lectores: functions/index.js (calificarCrucigrama) y
  // los tableros en src/components/juego/ deben leer `fila.row[c]`, no
  // `fila[c]`.
  const gridBruto = act.tipoJuego === 'sopa_letras' ? resultado.grid : resultado.celdas
  const estructura = {
    tipo: act.tipoJuego,
    size: resultado.size,
    grid: gridBruto.map((fila) => ({ row: fila })),
    palabras: resultado.palabras.map((p) => ({
      ...p,
      palabra: contenido[p.index]?.palabra ?? null,
      // Modalidad "por descripción": la pista debe llegar hasta el tablero
      // del estudiante para que pueda leerla — sin esto, CrucigramaBoard.jsx
      // y SopaDeLetrasBoard.jsx no tienen forma de mostrarla (encontrado en
      // E2E real: la sopa de letras mostraba las palabras en vez de las
      // pistas porque `descripcion` nunca llegaba a `estructura.palabras`).
      descripcion: contenido[p.index]?.descripcion ?? null,
      normalizada: normalizadas[p.index],
    })),
  }

  await actSnap.ref.update({
    'juego.estructura': estructura,
    'juego.estado': 'juego_generado',
  })

  return { ok: true, estructura }
})

// Ownership compartido por confirmarJuego/cancelarBorradorJuego — mismo
// criterio que construirJuego arriba (docenteId de la actividad, con
// fallback a subjects/{id}.docenteId por si esa copia quedara desactualizada).
async function verificarDuenoJuego(db, uid, actividadId) {
  const ref = db.doc(`activities/${actividadId}`)
  const snap = await ref.get()
  if (!snap.exists) return { ref, act: null }
  const act = snap.data()
  if (act.docenteId !== uid) {
    const subSnap = await db.doc(`subjects/${act.asignaturaId}`).get()
    if (!subSnap.exists || subSnap.data().docenteId !== uid) {
      throw new HttpsError('permission-denied', 'Esta actividad no es tuya')
    }
  }
  if (act.categoria !== 'juego' || !['crucigrama', 'sopa_letras'].includes(act.tipoJuego)) {
    throw new HttpsError('failed-precondition', 'Esta actividad no es un Crucigrama ni una Sopa de letras')
  }
  return { ref, act }
}

// CORRECCIÓN 23-ago-2026 (flujo de vista previa/edición/regeneración,
// decisión de Kike): el crédito de generar_contenido_juego (functions/ia.js)
// se RESERVA pero ya no se liquida en esa misma llamada — se liquida aquí,
// hasta que el docente confirma el juego terminado. Editar contenido y
// reconstruir el tablero (construirJuego, arriba) siguen sin tocar el
// ledger en absoluto — nunca se cobra dos veces por el mismo borrador.
async function confirmarJuegoImpl(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para usar esta función')

  const actividadId = String(request.data?.actividadId || '')
  if (!actividadId) throw new HttpsError('invalid-argument', 'Falta la actividad')

  const db = getFirestore()
  const { ref, act } = await verificarDuenoJuego(db, uid, actividadId)
  if (!act) throw new HttpsError('not-found', 'La actividad no existe')

  if (act.juego?.estado === 'juego_confirmado') {
    // Confirmar dos veces (doble clic, reintento de red) no debe cobrar de
    // nuevo — ya está confirmado, no hay nada más que hacer.
    return { ok: true, repetida: true }
  }
  if (act.juego?.estado !== 'juego_generado') {
    throw new HttpsError('failed-precondition',
      'El juego debe tener un tablero construido antes de confirmarlo.')
  }

  const idempotencyKey = act.juego?.idempotencyKeyReserva
  if (!idempotencyKey) {
    throw new HttpsError('failed-precondition',
      'No hay una reserva de créditos asociada a este borrador. Genera el contenido de nuevo.')
  }

  const consumoSnap = await db.doc(`iaConsumos/${idempotencyKey}`).get()
  if (!consumoSnap.exists) {
    throw new HttpsError('failed-precondition',
      'La reserva de créditos de este borrador ya no existe. Genera el contenido de nuevo.')
  }
  const consumo = consumoSnap.data()
  // Uso cruzado: la reserva guardada en la actividad debe seguir siendo del
  // MISMO docente que confirma — nunca debería divergir (se escribe en el
  // mismo momento que se crea, por el propio servidor), pero se revalida
  // explícitamente en vez de confiar ciegamente en el dato ya leído.
  if (consumo.uid !== uid) {
    throw new HttpsError('permission-denied', 'Esta reserva de créditos no te pertenece')
  }
  if (consumo.estado === 'ejecutado') {
    // Ya liquidada (reintento/doble clic exacto sobre la misma reserva) —
    // solo falta asegurar que la actividad quede marcada como confirmada.
    await ref.update({ 'juego.estado': 'juego_confirmado' })
    return { ok: true, repetida: true }
  }
  if (consumo.estado !== 'reservado') {
    // 'expirado' (limpieza automática) o 'cancelado' (el docente canceló el
    // borrador desde otra pestaña) — no hay nada que liquidar.
    throw new HttpsError('failed-precondition',
      'La reserva de créditos de este borrador ya no es válida (expiró o fue cancelada). Genera el contenido de nuevo.')
  }

  let liquidacion
  try {
    // La tarifa es fija (sin importar cantidad de palabras/modalidad) — lo
    // real siempre es exactamente lo reservado, sin devolución parcial.
    liquidacion = await ledger.liquidar({
      uid, idempotencyKey, creditosReales: consumo.creditosReservados, resultado: { actividadId },
    })
  } catch (e) {
    logger.error(`confirmarJuego: liquidar(${idempotencyKey}) falló:`, e)
    throw new HttpsError('internal', 'No se pudo confirmar el cobro de créditos. Intenta de nuevo.')
  }

  await ref.update({ 'juego.estado': 'juego_confirmado' })
  return { ok: true, creditosReales: liquidacion.repetida ? liquidacion.consumo.creditosReales : liquidacion.creditosReales, saldo: liquidacion.repetida ? null : liquidacion.saldo }
}
exports.confirmarJuego = onCall({ timeoutSeconds: 60 }, confirmarJuegoImpl)

// Cancelar un borrador de Crucigrama/Sopa de letras ANTES de confirmarlo:
// libera de inmediato la reserva de créditos (si existe) y elimina el
// borrador para que no pueda confirmarse después — no hace falta esperar a
// la limpieza automática de 2 horas para recuperar el crédito.
async function cancelarBorradorJuegoImpl(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para usar esta función')

  const actividadId = String(request.data?.actividadId || '')
  if (!actividadId) throw new HttpsError('invalid-argument', 'Falta la actividad')

  const db = getFirestore()
  const { ref, act } = await verificarDuenoJuego(db, uid, actividadId)
  if (!act) return { ok: true } // ya no existe — nada que cancelar (idempotente)

  if (act.juego?.estado === 'juego_confirmado') {
    throw new HttpsError('failed-precondition', 'Esta actividad ya fue confirmada, no se puede cancelar como borrador')
  }

  const idempotencyKey = act.juego?.idempotencyKeyReserva
  if (idempotencyKey) {
    await ledger.reembolsar({ uid, idempotencyKey, motivo: 'borrador cancelado por el docente', estadoFinal: 'cancelado' })
      .catch((e) => logger.error(`cancelarBorradorJuego: reembolsar(${idempotencyKey}) falló:`, e))
  }

  await ref.delete()
  return { ok: true }
}
exports.cancelarBorradorJuego = onCall({ timeoutSeconds: 60 }, cancelarBorradorJuegoImpl)

exports._pruebas = { confirmarJuegoImpl, cancelarBorradorJuegoImpl, verificarDuenoJuego }
