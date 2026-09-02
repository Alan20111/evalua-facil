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
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { logger } = require('firebase-functions')
const { normalizarPalabra } = require('./_shared/normalizarPalabra.js')
const { construirSopaDeLetras, construirCrucigrama } = require('./juegoGenerator')
const ledger = require('./creditosLedger')

const MIN_PALABRAS = 5
const MAX_PALABRAS = 20
const ESTADOS_PERMITIDOS = ['contenido_generado', 'contenido_editado']

// A25 - La respuesta del juego no viaja en el documento publico.
//
// Mismo problema y mismo arreglo que A08 hizo con las evaluaciones. Las
// reglas de Firestore no filtran CAMPOS, solo DOCUMENTOS, asi que mientras
// `palabra`, `normalizada` y el `grid` resuelto vivieran dentro de
// `activities/{id}`, cualquier cuenta con sesion los leia - y no hacia falta
// un cliente modificado: la pantalla del alumno YA descarga el documento
// entero (JuegoRunner.jsx y su ActivityPage). Con el crucigrama eso no es
// solo una fuga: `calificarCrucigrama` compara celda por celda contra ese
// mismo grid, asi que quien lo leyera podia transcribirlo y sacar 10.
//
// El reparto es el arreglo de fondo, calcado de A08:
//
//   activities/{id}.juego.estructura   -> PUBLICA: geometria + pistas
//   activities/{id}/clave/juego        -> PRIVADA: letras, palabra, normalizada
//   activities/{id}/clave/contenido    -> PRIVADA: el juego.contenido de hoy
//
// `clave/{docId}` ya existe en firestore.rules desde A08 y solo la abre el
// docente dueno, asi que este reparto NO necesita tocar las reglas. El
// servidor vuelve a juntar las dos mitades con el Admin SDK, que no pasa por
// ellas (ver estructuraEfectiva mas abajo y onJuegoFinalizado en index.js).
//
// Por que existe la bandera de compatibilidad
// -------------------------------------------
// La app de Android empaqueta su propia copia de `dist` (capacitor.config.json
// no tiene `server.url`) y no hay candado de version minima: un APK instalado
// ejecuta para siempre el frontend con el que se compilo. No existe un momento
// en que se pueda dar por hecho que ya no queda frontend viejo.
//
// Por eso la transicion tiene DOS puntos, no uno:
//
//   compatibilidadLegacy: true  -> se escribe en los dos sitios. Nada se rompe
//                                  y nada se arregla todavia. Es esta fase.
//   compatibilidadLegacy: false -> se deja de escribir en el publico. AHI
//                                  aterriza la seguridad, y ahi es donde el APK
//                                  viejo empieza a mostrar mal la revision y la
//                                  solucion. Lo decide el PO, no un despliegue.
//
// El corte es un campo en Firestore justamente para que volver atras sea
// instantaneo y no haya que redesplegar functions.
const CONFIG_JUEGOS = 'config/juegos'

// Ausente o ilegible => COMPATIBLE. Un dato que falta no debe romperle el
// trabajo a nadie (mismo criterio que `docenteActivo` con `suscripcionHasta`,
// ver CLAUDE.md), y durante esta fase el modo compatible no empeora nada:
// la seguridad todavia no habia aterrizado de todos modos.
async function compatibilidadLegacy(db) {
  try {
    const snap = await db.doc(CONFIG_JUEGOS).get()
    if (!snap.exists) return true
    return snap.data()?.compatibilidadLegacy !== false
  } catch (e) {
    logger.error('compatibilidadLegacy: no se pudo leer config/juegos, se asume compatible:', e)
    return true
  }
}

// De donde sale la lista de palabras del docente.
//
// La precedencia SE INVIERTE en el corte, y no es un capricho:
//   - Compatible: un frontend viejo solo sabe escribir `juego.contenido`, asi
//     que ese campo es siempre el mas fresco y tiene que ganar.
//   - Cortado: el frontend nuevo ya solo escribe `clave/contenido`, y el que
//     puede haber quedado rancio es el viejo - gana la clave.
async function leerContenidoJuego(actRef, act, compat) {
  const embebido = Array.isArray(act.juego?.contenido) ? act.juego.contenido : null
  const snap = await actRef.collection('clave').doc('contenido').get()
  const privado = Array.isArray(snap.data()?.contenido) ? snap.data().contenido : null
  const [primero, segundo] = compat ? [embebido, privado] : [privado, embebido]
  return (primero && primero.length ? primero : segundo) || []
}

// Parte el resultado del generador en la mitad que puede ver el alumno y la
// que no.
//
// SOPA DE LETRAS: su estructura publica NO se toca nunca, ni con la bandera
// apagada. Encontrar palabras dentro de una marana de letras ES el juego -
// enmascarar su `grid` lo destruiria. Su clave privada si se escribe (es
// aditivo y no cambia nada), pero cerrar de verdad la sopa exige rediseniar
// su bucle de juego y su calificacion, y eso es una auditoria aparte (A25).
function partirEstructuraJuego({ tipo, size, gridBruto, palabras, contenido, normalizadas, compat }) {
  const esCrucigrama = tipo === 'crucigrama'
  const gridCompleto = gridBruto.map((fila) => ({ row: fila }))

  // La privada SIEMPRE va completa, en las dos fases: es la fuente de verdad
  // con la que califica el servidor y la que el docente lee para revisar.
  const clave = {
    tipo,
    size,
    grid: gridCompleto,
    palabras: palabras.map((p) => ({
      index: p.index,
      palabra: contenido[p.index]?.palabra ?? null,
      normalizada: normalizadas[p.index],
    })),
  }

  // La publica lleva SIEMPRE lo que el tablero del alumno necesita de verdad:
  // geometria (fila/col/longitud/horizontal, que es lo que decide que casilla
  // es blanca) y la pista. `palabra`/`normalizada` no los usa ni una vez
  // durante la resolucion.
  //
  // El `grid` enmascarado no le quita informacion al alumno: las casillas
  // blancas ya estan implicitas en fila+col+longitud+direccion. Solo le quita
  // las LETRAS. Y como CrucigramaBoard unicamente evalua `if (!letra)`, un
  // booleano pasa por ahi exactamente igual que una letra.
  const publica = {
    tipo,
    size,
    grid: (esCrucigrama && !compat)
      ? gridBruto.map((fila) => ({ row: fila.map((celda) => !!celda) }))
      : gridCompleto,
    palabras: palabras.map((p) => ({
      ...p,
      // Modalidad "por descripcion": la pista debe llegar hasta el tablero
      // del estudiante para que pueda leerla - sin esto, CrucigramaBoard.jsx
      // y SopaDeLetrasBoard.jsx no tienen forma de mostrarla (encontrado en
      // E2E real: la sopa de letras mostraba las palabras en vez de las
      // pistas porque `descripcion` nunca llegaba a `estructura.palabras`).
      descripcion: contenido[p.index]?.descripcion ?? null,
      // Solo mientras haya frontends viejos que las esperen aqui.
      ...((compat || !esCrucigrama) ? {
        palabra: contenido[p.index]?.palabra ?? null,
        normalizada: normalizadas[p.index],
      } : {}),
    })),
  }

  return { publica, clave }
}

// Vuelve a juntar las dos mitades. Devuelve un objeto con la MISMA forma que
// tenia `juego.estructura` antes del reparto, para que `calificarCrucigrama` y
// `calificarSopaDeLetras` (functions/index.js) sigan funcionando sin cambiar
// una sola linea de su algoritmo.
//
// Sin clave (juego heredado todavia sin migrar) devuelve la publica tal cual:
// ahi las letras siguen dentro, que es justo el caso que el fallback cubre.
function estructuraEfectiva(publica, clave) {
  if (!publica) return null
  if (!clave) return publica
  const porIndice = new Map((clave.palabras || []).map((p) => [p.index, p]))
  return {
    ...publica,
    grid: clave.grid || publica.grid,
    palabras: (publica.palabras || []).map((p) => ({ ...p, ...(porIndice.get(p.index) || {}) })),
  }
}

async function construirJuegoImpl(request) {
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

  const compat = await compatibilidadLegacy(db)
  const contenido = await leerContenidoJuego(actSnap.ref, act, compat)
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

  const tamanoSopa = act.tipoJuego === 'sopa_letras' ? (act.juego?.tamanoSopa || null) : null

  // Sopa de letras: rechazar antes del backtracking toda palabra que físicamente
  // no pueda caber en el tablero elegido por el docente (longitud > tamano).
  // El generador usa el tamaño exacto y sin expandir (ver juegoGenerator.js),
  // así que si se intentara colocar una palabra más larga que el grid se
  // fallaría silenciosamente tras MAX_INTENTOS_POR_TAMANO pasadas.
  if (tamanoSopa) {
    const demasiada = normalizadas.findIndex((n) => n.length > tamanoSopa)
    if (demasiada !== -1) {
      throw new HttpsError('failed-precondition',
        `La palabra "${contenido[demasiada]?.palabra || ''}" (${normalizadas[demasiada].length} letras) no cabe en un tablero ${tamanoSopa} × ${tamanoSopa}. Edítala, quítala o elige un tablero más grande.`)
    }
  }

  let resultado
  try {
    resultado = act.tipoJuego === 'sopa_letras'
      ? construirSopaDeLetras(normalizadas, tamanoSopa)
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

  // Cada entrada de estructura.palabras referencia el índice del contenido
  // (palabra ORIGINAL, con acentos, para mostrar) y trae además la versión
  // normalizada (para el motor de calificación).
  // Firestore NO admite arrays anidados (un array cuyo elemento es otro
  // array) — 'Property juego contains an invalid nested entity' al
  // intentar guardar `grid` como array de arrays tal cual lo arma
  // juegoGenerator.js. Se envuelve cada fila en un objeto `{ row: [...] }`
  // (array DENTRO de un objeto sí es válido) — mismo dato, forma que
  // Firestore acepta. Lectores: functions/index.js (calificarCrucigrama) y
  // los tableros en src/components/juego/ deben leer `fila.row[c]`, no
  // `fila[c]`.
  const gridBruto = act.tipoJuego === 'sopa_letras' ? resultado.grid : resultado.celdas
  const { publica, clave } = partirEstructuraJuego({
    tipo: act.tipoJuego,
    size: resultado.size,
    gridBruto,
    palabras: resultado.palabras,
    contenido,
    normalizadas,
    compat,
  })

  // La clave PRIMERO: si fallara a mitad, más vale una clave sin estructura
  // pública (el juego no avanza a 'juego_generado' y el docente reintenta)
  // que una estructura pública enmascarada cuya clave no existe — eso sí
  // dejaría un juego imposible de calificar.
  await actSnap.ref.collection('clave').doc('juego').set(clave)
  await actSnap.ref.collection('clave').doc('contenido').set({ contenido })

  await actSnap.ref.update({
    'juego.estructura': publica,
    'juego.estado': 'juego_generado',
  })

  return { ok: true, estructura: publica }
}
exports.construirJuego = onCall({ timeoutSeconds: 300 }, construirJuegoImpl)

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

  // Completa el registro que `ejecutarOperacionIA` dejó con `creditosReales:
  // null, liquidacionDiferida: true` (functions/ia.js) — aquí, y solo aquí,
  // se sabe el cobro definitivo de `generar_contenido_juego`. Best-effort:
  // si esto falla, el crédito ya se cobró correctamente (arriba); solo se
  // pierde la métrica de margen, no el dinero.
  if (!liquidacion.repetida) {
    db.doc(`iaConsumosInterno/${idempotencyKey}`)
      .set({ creditosReales: consumo.creditosReservados, liquidacionDiferida: false, liquidadoEn: FieldValue.serverTimestamp() }, { merge: true })
      .catch((err) => logger.error(`confirmarJuego: no se pudo completar iaConsumosInterno(${idempotencyKey}):`, err))
  }

  await ref.update({ 'juego.estado': 'juego_confirmado' })
  return { ok: true, creditosReales: liquidacion.repetida ? liquidacion.consumo.creditosReales : liquidacion.creditosReales, saldo: liquidacion.repetida ? null : liquidacion.saldo }
}
exports.confirmarJuego = onCall({ timeoutSeconds: 60 }, confirmarJuegoImpl)

// Eliminar un borrador de Crucigrama/Sopa de letras ANTES de confirmarlo:
// cierra de inmediato el apartado de créditos (si sigue vivo) y elimina la
// actividad para que no pueda confirmarse después — no hace falta esperar a la
// limpieza automática de 2 horas.
//
// Devuelve `reserva` para que el cliente diga la VERDAD de lo que pasó en vez
// de afirmar siempre lo mismo (corrección 1-sep-2026: el mensaje anterior
// aseguraba un movimiento de créditos incluso cuando no había ninguno que
// cerrar). Valores:
//   'cancelada'   — había un apartado vivo y se cerró: ese cobro no se aplica
//                   (`creditos` trae cuántos eran, leídos del propio apartado,
//                   nunca de una constante del cliente).
//   'sin_reserva' — nunca hubo apartado (p. ej. la IA falló tras crear el
//                   cascarón y ahí mismo se cerró). No se afirma nada.
//   'expirada'    — la limpieza automática ya lo había cerrado por tiempo.
//   'ya_cerrada'  — ya estaba cerrado por otra vía (otra pestaña).
//   'ya_cobrada'  — el cobro YA se aplicó (liquidado). Hay que decirlo.
async function cancelarBorradorJuegoImpl(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para usar esta función')

  const actividadId = String(request.data?.actividadId || '')
  if (!actividadId) throw new HttpsError('invalid-argument', 'Falta la actividad')

  const db = getFirestore()
  const { ref, act } = await verificarDuenoJuego(db, uid, actividadId)
  if (!act) return { ok: true, reserva: 'sin_reserva', creditos: null } // ya no existe (idempotente)

  if (act.juego?.estado === 'juego_confirmado') {
    throw new HttpsError('failed-precondition', 'Esta actividad ya fue confirmada, no se puede eliminar como borrador')
  }

  const idempotencyKey = act.juego?.idempotencyKeyReserva
  let reserva = 'sin_reserva'
  let creditos = null

  if (idempotencyKey) {
    const consumoSnap = await db.doc(`iaConsumos/${idempotencyKey}`).get()
    const consumo = consumoSnap.exists ? consumoSnap.data() : null

    if (!consumo) {
      reserva = 'sin_reserva'
    } else if (consumo.estado === 'reservado') {
      let r
      try {
        r = await ledger.reembolsar({ uid, idempotencyKey, motivo: 'borrador cancelado por el docente', estadoFinal: 'cancelado' })
      } catch (e) {
        // ANTES esto se tragaba con un `.catch` y la actividad se borraba de
        // todos modos: el apartado se quedaba vivo comiendo saldo hasta la
        // limpieza diaria, y el docente veía un mensaje de éxito que mentía.
        // Ahora se aborta ANTES del delete — es preferible un borrador que
        // sigue ahí a un borrador perdido con el saldo apartado a ciegas.
        logger.error(`cancelarBorradorJuego: reembolsar(${idempotencyKey}) falló:`, e)
        throw new HttpsError('internal',
          'No se pudo cerrar el apartado de créditos de este borrador, así que la actividad NO se eliminó. Vuelve a intentarlo.')
      }
      if (r.hecho) {
        reserva = 'cancelada'
        creditos = consumo.creditosReservados ?? null
      } else {
        // Carrera: cambió de estado entre la lectura de arriba y la
        // transacción del ledger. Se reporta lo que quedó, nunca un cierre
        // que no ocurrió.
        reserva = r.estado === 'ejecutado' ? 'ya_cobrada' : r.estado === 'expirado' ? 'expirada' : 'ya_cerrada'
      }
    } else if (consumo.estado === 'ejecutado') {
      reserva = 'ya_cobrada'
    } else if (consumo.estado === 'expirado') {
      reserva = 'expirada'
    } else {
      reserva = 'ya_cerrada'
    }

    // Completa el registro que quedó con `creditosReales: null,
    // liquidacionDiferida: true` (ver ejecutarOperacionIA en functions/ia.js):
    // no se cobró nada, así que el cobro real es 0 — aunque el contenido SÍ se
    // generó con IA y sí costó tokens reales (interno ya está escrito). Es
    // justo el caso que `rentabilidad_creditos` necesita distinguir: costo
    // real con ingreso cero, no un registro a medias. Best-effort: lo que de
    // verdad protege el saldo del docente es el cierre del apartado de
    // arriba; esto es solo la métrica.
    //
    // 'ya_cobrada' queda fuera a propósito: ahí el cobro SÍ se aplicó, y
    // escribir `creditosReales: 0` falsearía el margen.
    if (reserva !== 'ya_cobrada') {
      db.doc(`iaConsumosInterno/${idempotencyKey}`)
        .set({ creditosReales: 0, liquidacionDiferida: false, canceladoEn: FieldValue.serverTimestamp() }, { merge: true })
        .catch((e) => logger.error(`cancelarBorradorJuego: no se pudo completar iaConsumosInterno(${idempotencyKey}):`, e))
    }
  }

  // Borrar el documento padre NO arrastra sus subcolecciones en Firestore: la
  // clave se quedaría huérfana, con las respuestas dentro, colgando de una
  // actividad que ya no existe. Se borran POR ID, no la colección entera, para
  // no tocar nunca la clave de reactivos que A08 guarda en este mismo sitio.
  //
  // Best-effort y DESPUÉS del cierre del apartado de créditos: lo que de
  // verdad hay que proteger es el saldo del docente, y esto solo deja basura
  // si falla, no dinero.
  await Promise.all([
    ref.collection('clave').doc('juego').delete()
      .catch((e) => logger.error(`cancelarBorradorJuego: no se pudo borrar clave/juego de ${actividadId}:`, e)),
    ref.collection('clave').doc('contenido').delete()
      .catch((e) => logger.error(`cancelarBorradorJuego: no se pudo borrar clave/contenido de ${actividadId}:`, e)),
  ])

  await ref.delete()
  return { ok: true, reserva, creditos }
}
exports.cancelarBorradorJuego = onCall({ timeoutSeconds: 60 }, cancelarBorradorJuegoImpl)


// A25 — La solución del juego se pide, no se descarga.
//
// Antes de esto la solución la armaba el navegador del alumno desde
// `estructura.grid` (solucionCrucigrama en src/utils/correccionesJuego.js), y
// las dos condiciones que la protegían —intentos agotados y "Publicar
// solución"— vivían SOLO en el cliente (student/ActivityPage.jsx). Una
// restricción que solo vive en el navegador no existe: el grid resuelto ya
// estaba descargado desde el primer render.
//
// Aquí las dos condiciones se comprueban en el servidor, y la solución sale de
// la clave privada, que el alumno no puede leer por reglas.
//
// Es un callable y no una copia dentro de la entrega A PROPÓSITO.
// `publicarSolucion: 'fecha'` se cumple en el FUTURO, y nada re-escribe una
// entrega ya calificada cuando llega ese día (no hay disparador sobre
// `activities` que lo haga, y revisarProgramados solo manda push). Preguntando
// en el momento, la respuesta siempre es la correcta.
async function obtenerSolucionJuegoImpl(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para usar esta función')

  const actividadId = String(request.data?.actividadId || '')
  if (!actividadId) throw new HttpsError('invalid-argument', 'Falta la actividad')

  const db = getFirestore()
  const actRef = db.doc(`activities/${actividadId}`)
  const actSnap = await actRef.get()
  if (!actSnap.exists) throw new HttpsError('not-found', 'La actividad no existe')
  const act = actSnap.data()
  if (act.categoria !== 'juego') {
    throw new HttpsError('failed-precondition', 'Esta actividad no es un juego')
  }

  // Inscripción: hay un `students` por alumno y por asignatura. Se consulta por
  // `uid` con UNA sola igualdad y se filtra la asignatura en memoria, para no
  // necesitar un índice compuesto nuevo (mismo criterio que el resto de la
  // app, ver CLAUDE.md).
  const inscSnap = await db.collection('students').where('uid', '==', uid).get()
  const inscripcion = inscSnap.docs.find((d) => d.data().asignaturaId === act.asignaturaId)
  if (!inscripcion) {
    throw new HttpsError('permission-denied', 'No estás inscrito en esta asignatura')
  }

  // El id de la entrega no es libre desde A12: es `{actividadId}_{alumnoId}`.
  const subSnap = await db.doc(`submissions/${actividadId}_${inscripcion.id}`).get()
  const sub = subSnap.exists ? subSnap.data() : null
  if (!sub || sub.estadoEvaluacion !== 'finalizado') {
    throw new HttpsError('failed-precondition', 'Todavía no has terminado este juego')
  }

  // Las MISMAS dos condiciones que hasta hoy decidía el navegador, ahora aquí:
  //   1. no le queda ninguna oportunidad;
  //   2. el docente ya autorizó publicar la solución.
  // Que la calificación esté publicada NO libera la solución, ni al revés.
  const ev = act.evaluacion || {}
  const intentosUsados = Array.isArray(sub.intentos) ? sub.intentos.length : 0
  const sinIntentosRestantes = ev.intentosPermitidos != null && intentosUsados >= ev.intentosPermitidos
  if (!sinIntentosRestantes) {
    throw new HttpsError('failed-precondition', 'Todavía te quedan intentos de este juego')
  }
  if (!publicacionVisible(ev.publicarSolucion || 'inmediato', ev.publicarSolucionFecha, ev.solucionPublicada)) {
    throw new HttpsError('failed-precondition', 'El docente todavía no publica la solución de este juego')
  }

  const claveSnap = await actRef.collection('clave').doc('juego').get()
  const estructura = estructuraEfectiva(act.juego?.estructura || null, claveSnap.exists ? claveSnap.data() : null)
  if (!estructura) throw new HttpsError('not-found', 'Este juego no tiene tablero')

  // Se devuelve YA RESUELTO en la forma que espera el tablero (`celdas`), no la
  // estructura cruda: menos superficie y nada que el cliente deba recomponer.
  // El filtro `typeof letra === 'string'` es el que impide que una máscara
  // booleana se cuele como si fuera una letra ("true" en cada casilla).
  const celdas = {}
  const size = estructura.size || 0
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const letra = estructura.grid?.[r]?.row?.[c]
      if (letra && typeof letra === 'string') celdas[`${r}-${c}`] = letra.toUpperCase()
    }
  }
  return {
    ok: true,
    tipo: estructura.tipo,
    celdas,
    palabras: (estructura.palabras || []).map((p) => ({ index: p.index, palabra: p.palabra ?? null })),
  }
}
exports.obtenerSolucionJuego = onCall({ timeoutSeconds: 60 }, obtenerSolucionJuegoImpl)

// Copia deliberada de `publicacionVisible` (src/utils/evaluacionGrading.js),
// igual que la que ya vive en functions/index.js: `functions/` es otro paquete
// y no puede importar de `src/`. Si cambia una, cambian las tres; hay casos de
// prueba en todas.
function publicacionVisible(modo, fecha, flag) {
  if (modo === 'nunca') return false
  if (modo === 'inmediato') return true
  if (modo === 'fecha') return !!fecha && new Date().toISOString() >= fecha
  return !!flag
}

// Compartidas con functions/index.js (calificación) y functions/ia.js
// (generación de contenido). Exportadas como API normal del módulo, no a
// través de `_pruebas`: son parte del contrato, no un atajo de test.
exports.compatibilidadLegacy = compatibilidadLegacy
exports.estructuraEfectiva = estructuraEfectiva

exports._pruebas = {
  construirJuegoImpl,
  confirmarJuegoImpl,
  cancelarBorradorJuegoImpl,
  obtenerSolucionJuegoImpl,
  verificarDuenoJuego,
  compatibilidadLegacy,
  leerContenidoJuego,
  partirEstructuraJuego,
  estructuraEfectiva,
  publicacionVisible,
}
