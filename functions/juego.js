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
  const estructura = {
    tipo: act.tipoJuego,
    size: resultado.size,
    grid: act.tipoJuego === 'sopa_letras' ? resultado.grid : resultado.celdas,
    palabras: resultado.palabras.map((p) => ({
      ...p,
      palabra: contenido[p.index]?.palabra ?? null,
      normalizada: normalizadas[p.index],
    })),
  }

  await actSnap.ref.update({
    'juego.estructura': estructura,
    'juego.estado': 'juego_generado',
  })

  return { ok: true, estructura }
})
