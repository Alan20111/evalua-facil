// Operaciones de IA — el ÚNICO lugar donde Evalúa Fácil llama a un modelo.
//
// La clave del proveedor vive en un secret de Functions (jamás en el
// cliente). El flujo completo por operación:
//
//   estimación (cliente, informativa) → confirmación del docente →
//   RESERVA (transacción, ledger) → ejecución IA → consumo real →
//   LIQUIDACIÓN (transacción, ledger) → la barra se actualiza por snapshot.
//
// Reglas que este archivo hace cumplir (aprobadas por el PO, 9-ago-2026):
//   · la IA nunca decide cuánto se descuenta: los costos salen de
//     config/iaTarifas y las cuentas las hace creditosLedger.js;
//   · una operación fallida reembolsa su reserva;
//   · un reintento con la misma clave de idempotencia no cobra dos veces y
//     entrega el resultado ya generado;
//   · piloto: SOLO la operación 'aviso' (C-03). Las demás operaciones del
//     inventario se conectarán por fases con autorización del PO.
//
// Los tokens reales y el modelo usado se guardan en iaConsumosInterno (sin
// acceso del cliente): el docente piensa en créditos, no en nuestro costo.

const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { defineSecret } = require('firebase-functions/params')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { logger } = require('firebase-functions')
const ledger = require('./creditosLedger')

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY')

// Operaciones conectadas. Piloto: únicamente C-03 · Redactar aviso.
const OPERACIONES = { aviso: ejecutarAviso }

// ── Piloto C-03 · Redactar aviso ────────────────────────────────────────────
// Entrada: tipo de aviso (los 12 del producto) + datos del docente + nombre
// de la asignatura. Salida: { titulo, mensaje } que el cliente coloca en el
// editor de avisos — el docente edita y publica como siempre; la IA nunca
// publica.
async function ejecutarAviso({ params, modelo, apiKey }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })

  const tipo = String(params?.tipo || 'OTRO').slice(0, 40)
  const datos = String(params?.datos || '').slice(0, 1500)
  const asignatura = String(params?.asignaturaNombre || '').slice(0, 120)
  // El cliente manda datos = tipo cuando el docente no escribió nada: ambos
  // casos cuentan como "sin detalles" y producen un borrador genérico.
  const sinDetalles = !datos.trim() || datos.trim().toLowerCase() === tipo.trim().toLowerCase()

  const inicio = Date.now()
  const msg = await client.messages.create({
    model: modelo,
    max_tokens: 400,
    system:
      'Eres el asistente pedagógico de Evalúa Fácil dentro de la asignatura de un docente de ' +
      'bachillerato mexicano. Tu papel es PROPONER: el docente siempre revisa y decide. ' +
      'SIEMPRE entregas un borrador; nunca pides información, nunca dices que no puedes y nunca ' +
      'explicas qué te faltó. Si no hay detalles, redacta en términos generales ("próximamente", ' +
      '"en la fecha indicada en clase") sin inventar datos concretos (fechas, horas, lugares, nombres) ' +
      'y sin huecos por rellenar tipo [fecha]. ' +
      'Escribe en español, claro y breve. Responde únicamente con el JSON pedido, sin texto adicional.',
    messages: [{
      role: 'user',
      content:
        `Redacta un aviso de tipo ${tipo} para el grupo` +
        (asignatura ? ` de la asignatura "${asignatura}"` : '') +
        (sinDetalles
          ? '. El docente no dio detalles: redacta un borrador genérico y útil de este tipo de aviso, listo para que él lo edite.\n\n'
          : ` con estos datos del docente:\n"""${datos}"""\n\n`) +
        'Claro y completo (qué, cuándo y qué deben hacer), tono cercano y respetuoso, breve. ' +
        'Responde SOLO con este JSON: {"titulo": "<máx 60 caracteres>", "mensaje": "<2-5 frases>"}',
    }],
  })

  let texto = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
  if (texto.startsWith('```')) texto = texto.replace(/^```(json)?\n?/, '').replace(/```$/, '').trim()
  let salida
  try {
    salida = JSON.parse(texto)
  } catch {
    // Respuesta no-JSON: se aprovecha como mensaje plano antes que fallar.
    salida = { titulo: '', mensaje: texto.slice(0, 1000) }
  }
  return {
    resultado: {
      titulo: String(salida.titulo || '').slice(0, 120),
      mensaje: String(salida.mensaje || '').slice(0, 2000),
    },
    unidadesReales: 1, // un aviso redactado = una unidad cobrada
    interno: {
      modelo,
      tokensEntrada: msg.usage?.input_tokens ?? null,
      tokensSalida: msg.usage?.output_tokens ?? null,
      ms: Date.now() - inicio,
    },
  }
}

// ── Traducción de errores del ledger a HttpsError ───────────────────────────
function comoHttpsError(e) {
  if (e instanceof HttpsError) return e
  if (e instanceof ledger.ErrorCreditos) {
    const codigos = {
      SALDO_INSUFICIENTE: 'failed-precondition',
      CORTESIA_PENDIENTE: 'failed-precondition',
      SUSCRIPCION_VENCIDA: 'permission-denied',
      OPERACION_DESCONOCIDA: 'invalid-argument',
      CLAVE_INVALIDA: 'invalid-argument',
      SIN_TARIFAS: 'failed-precondition',
    }
    return new HttpsError(codigos[e.codigo] || 'failed-precondition', e.message, { codigo: e.codigo, ...e.datos })
  }
  logger.error('ejecutarOperacionIA: error inesperado', e)
  return new HttpsError('internal', 'No se pudo completar la operación. No se descontaron créditos.')
}

exports.ejecutarOperacionIA = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para usar la IA')

    const db = getFirestore()
    const perfil = await db.doc(`users/${uid}`).get()
    if (!perfil.exists || perfil.data().role !== 'docente') {
      throw new HttpsError('permission-denied', 'La IA de Evalúa Fácil es para docentes')
    }

    const { operacion, idempotencyKey, params = {}, unidades = 1 } = request.data || {}
    const ejecutor = OPERACIONES[operacion]
    if (!ejecutor) {
      throw new HttpsError('unimplemented', 'Esta operación de IA aún no está disponible')
    }
    const n = Number.isInteger(unidades) && unidades > 0 && unidades <= 500 ? unidades : 1

    let tarifas
    let reserva
    try {
      tarifas = await ledger.cargarTarifas()
      reserva = await ledger.reservar({ uid, operacion, idempotencyKey, unidades: n, asignaturaId: params.asignaturaId || null, tarifas })
    } catch (e) {
      throw comoHttpsError(e)
    }

    // Reintento de una clave ya vista: no se cobra de nuevo.
    if (reserva.repetida) {
      const c = reserva.consumo
      if (c.estado === 'ejecutado') {
        const creditos = await db.doc(`iaCreditos/${uid}`).get()
        return { repetida: true, resultado: c.resultado, creditosReales: c.creditosReales, saldo: creditos.data()?.saldo ?? null }
      }
      if (c.estado === 'reservado') {
        throw new HttpsError('aborted', 'Esta operación ya está en proceso. Espera un momento.')
      }
      throw new HttpsError('failed-precondition', 'Esta operación falló antes. Intenta de nuevo.', { estadoPrevio: c.estado })
    }

    // Ejecución de la IA. Cualquier fallo → reembolso íntegro de la reserva.
    let salida
    try {
      const modelo = tarifas.modeloPorOperacion?.[operacion]
      if (!modelo) throw new HttpsError('failed-precondition', 'La operación no tiene modelo configurado')
      salida = await ejecutor({ params, modelo, apiKey: ANTHROPIC_API_KEY.value() })
    } catch (e) {
      await ledger.reembolsar({ uid, idempotencyKey, motivo: String(e.message || e).slice(0, 300) })
        .catch((err) => logger.error(`reembolso(${idempotencyKey}) falló:`, err))
      if (e instanceof HttpsError) throw e
      logger.error(`IA(${operacion}) falló:`, e)
      throw new HttpsError('unavailable', 'El asistente de IA no está disponible en este momento. No se descontaron créditos.')
    }

    // Métricas internas (tokens, modelo): fuera del alcance del cliente.
    db.doc(`iaConsumosInterno/${idempotencyKey}`)
      .set({ uid, operacion, ...salida.interno, createdAt: FieldValue.serverTimestamp() })
      .catch((err) => logger.error('iaConsumosInterno:', err))

    // Consumo REAL: unidades procesadas × tarifa — lo calcula el código,
    // jamás la IA.
    const porUso = tarifas.tarifas[operacion]
    const creditosReales = Math.min(salida.unidadesReales, n) * porUso

    let liquidacion
    try {
      liquidacion = await ledger.liquidar({ uid, idempotencyKey, creditosReales, resultado: salida.resultado })
    } catch (e) {
      // El resultado existe pero la liquidación falló: NO se reembolsa (el
      // trabajo se hizo). La reserva quedará 'reservada' y con el resultado
      // en mano del cliente; la limpieza la expira y devuelve la diferencia.
      logger.error(`liquidar(${idempotencyKey}) falló:`, e)
      return { resultado: salida.resultado, creditosReales, saldo: null, advertencia: 'liquidacion-pendiente' }
    }

    return {
      resultado: salida.resultado,
      creditosReales: liquidacion.repetida ? liquidacion.consumo.creditosReales : liquidacion.creditosReales,
      saldo: liquidacion.repetida ? null : liquidacion.saldo,
    }
  }
)

// Mantenimiento diario: renueva ciclos vencidos de quienes no usaron la IA
// (la renovación perezosa cubre a quienes sí) y recupera reservas huérfanas.
exports.mantenimientoCreditosIA = onSchedule('every 24 hours', async () => {
  try {
    const tarifas = await ledger.cargarTarifas()
    const ren = await ledger.renovarCiclosVencidos({ tarifas })
    const lim = await ledger.limpiarReservasHuerfanas({ minutos: 15 })
    const tri = await ledger.cerrarTrialsVencidos({})
    logger.info(`mantenimientoCreditosIA: ${ren.renovados} renovado(s), ${lim.recuperadas} reserva(s) recuperada(s), ${tri.cerrados} trial(es) cerrados por tiempo`)
  } catch (e) {
    logger.error('mantenimientoCreditosIA:', e)
  }
})
