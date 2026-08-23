// Ledger de créditos IA — la única fuente de verdad del saldo.
//
// Modelo de créditos puros sin caducidad (20-ago-2026, migración — ver
// docs/ia/PLAN_TECNICO_CREDITOS_PUROS.md). Todo lo que toca saldo pasa por
// transacciones de Firestore en este módulo: el cliente JAMÁS escribe
// iaCreditos/iaConsumos (las reglas lo prohíben), y la IA jamás decide
// cuánto se descuenta — los costos vienen de `config/iaTarifas` y las
// cuentas las hace este código.
//
// Modelo de datos:
//   iaCreditos/{uid}    — { saldo, consumidoTotal, consumoPorCategoria }.
//                         Sin capacidad, sin plan, sin ciclo mensual, sin
//                         reseteo: el saldo solo se mueve por acreditación
//                         (compra aprobada / regalo de bienvenida) o consumo
//                         de IA. Lo lee el docente (su barra), lo escribe
//                         solo el servidor.
//   iaConsumos/{clave}  — un documento por operación confirmada. Su ID es la
//                         CLAVE DE IDEMPOTENCIA: un reintento encuentra el
//                         documento y no vuelve a cobrar. Sin tokens ni costos
//                         monetarios (eso va en iaConsumosInterno, que el
//                         cliente no puede leer).
//
// Invariantes que las pruebas afirman:
//   · el saldo nunca baja de cero;
//   · el saldo nunca baja por el paso del tiempo (sin reseteo, sin ciclo);
//   · una clave de idempotencia cobra a lo más una vez;
//   · dos reservas simultáneas no pueden gastar los mismos créditos;
//   · una reserva sin liquidar se reembolsa (fallo explícito o limpieza);
//   · el regalo de bienvenida se otorga a lo más una vez por cuenta.
//
// Separado de ia.js a propósito: aquí no hay nada de Anthropic ni de red —
// es lógica pura sobre Firestore y se prueba directo contra el emulador
// (mismo criterio del PO del 6-ago-2026 que en test/servidor.test.mjs).

const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore')

// Perezoso: para que `require` de este módulo no exija tener la app
// inicializada (index.js la inicializa al cargarse; las pruebas también).
let _db = null
function db() {
  if (!_db) _db = getFirestore()
  return _db
}

// Créditos de bienvenida, una sola vez por cuenta, sin caducidad (decisión
// del PO — plan §7-8). No vive en config/iaTarifas porque no es un precio
// pagado por el docente, es un regalo fijo del producto.
const CREDITOS_BIENVENIDA = 50

// Fracciones de crédito (21-ago-2026, decisión de Kike: calificar_entregable_ia
// cuesta 0.5 — UN SOLO tipo de crédito de IA, sin moneda especial). Firestore
// guarda `saldo` como number (IEEE 754 double) sin ninguna restricción a
// enteros — ni aquí, ni en firestore.rules (`saldoIAPositivo` solo compara
// `> 0`), ni en el cliente. Fracciones "limpias" en binario (0.5, 0.25, 0.125)
// no arrastran error de redondeo, pero cualquier tarifa futura que NO lo sea
// (p. ej. 0.3) sí podría acumular deriva tras miles de operaciones — por eso
// TODO cálculo de saldo en este archivo pasa por round2 antes de escribirse,
// sin excepción, para que el sistema quede seguro para cualquier fracción
// futura y no solo para 0.5. Precisión de centavos de crédito (2 decimales)
// es más que suficiente: al valor comercial de $0.50 MXN/crédito, 0.01
// crédito equivale a medio centavo.
const round2 = (n) => Math.round(n * 100) / 100

// ── Errores con código, para que el callable los traduzca a HttpsError ──────
class ErrorCreditos extends Error {
  constructor(codigo, mensaje, datos = {}) {
    super(mensaje)
    this.codigo = codigo
    this.datos = datos
  }
}

// ── Cargar tarifas (fuera de transacción: el doc cambia rara vez) ───────────
async function cargarTarifas() {
  const snap = await db().doc('config/iaTarifas').get()
  if (!snap.exists) throw new ErrorCreditos('SIN_TARIFAS', 'config/iaTarifas no existe — corre seeds-db/seed-ia-tarifas.js')
  return snap.data()
}

// ── RESERVA ─────────────────────────────────────────────────────────────────
// Transacción: idempotencia → (crear el doc de créditos si falta) → validar
// saldo → crear consumo 'reservado' → descontar la reserva.
//
// La reserva descuenta la ESTIMACIÓN MÁXIMA; la liquidación devuelve la
// diferencia. Así, dos operaciones simultáneas jamás gastan los mismos
// créditos y el saldo no puede cruzar cero ni con operaciones variables.
//
// Sin chequeo de suscripción/plan: cualquier docente autenticado con saldo
// suficiente puede usar IA, sin importar su estado de suscripción.
async function reservar({ uid, operacion, idempotencyKey, unidades = 1, asignaturaId = null, tarifas, ahora = new Date() }) {
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
    throw new ErrorCreditos('CLAVE_INVALIDA', 'Falta la clave de idempotencia')
  }
  const porUso = tarifas.tarifas?.[operacion]
  // `porUso == null` (no `!porUso`): una tarifa de 0 es válida — el Chat con
  // Asistente no cobra por mensaje, y `!0` sería `true`, rechazando la
  // operación como si no tuviera tarifa configurada.
  if (porUso == null) throw new ErrorCreditos('OPERACION_DESCONOCIDA', `Sin tarifa para "${operacion}"`)
  const costo = round2(porUso * unidades)
  const categoria = tarifas.categorias?.[operacion] || 'Otros'

  const refCreditos = db().doc(`iaCreditos/${uid}`)
  const refConsumo = db().doc(`iaConsumos/${idempotencyKey}`)

  return db().runTransaction(async (tx) => {
    // Lecturas primero (regla del Admin SDK).
    const consumoSnap = await tx.get(refConsumo)
    if (consumoSnap.exists) {
      // Reintento (doble clic, red móvil, función reejecutada): no se cobra
      // de nuevo. El que llama decide qué hacer según el estado.
      return { repetida: true, consumo: consumoSnap.data() }
    }

    const creditosSnap = await tx.get(refCreditos)

    let creditos
    let camposNuevos = {}
    if (!creditosSnap.exists) {
      // No debería pasar en condiciones normales (onDocenteCreado otorga el
      // regalo de bienvenida al crear la cuenta), pero si por lo que sea no
      // existe el doc todavía, nace en 0 — nunca se inventa saldo aquí.
      creditos = { saldo: 0, consumidoTotal: 0, consumoPorCategoria: {} }
      camposNuevos = { ...creditos, creadoEn: FieldValue.serverTimestamp() }
    } else {
      creditos = creditosSnap.data()
    }

    if ((creditos.saldo || 0) < costo) {
      throw new ErrorCreditos('SALDO_INSUFICIENTE', 'No tienes suficientes créditos para realizar esta acción', {
        saldo: creditos.saldo || 0,
        costo,
      })
    }

    // Escrituras: consumo reservado + saldo descontado, atómicos.
    tx.set(refConsumo, {
      uid,
      operacion,
      categoria,
      asignaturaId,
      unidades,
      creditosReservados: costo,
      estado: 'reservado',
      createdAt: Timestamp.fromDate(ahora),
    })
    const saldoTrasReserva = round2((creditos.saldo || 0) - costo)
    tx.set(refCreditos, {
      ...camposNuevos,
      saldo: saldoTrasReserva,
      actualizadoEn: FieldValue.serverTimestamp(),
    }, { merge: true })

    return {
      repetida: false,
      costo,
      categoria,
      saldoTrasReserva,
    }
  })
}

// ── LIQUIDACIÓN ─────────────────────────────────────────────────────────────
// El consumo REAL es la fuente de verdad: se ajusta el saldo (devolviendo lo
// reservado de más), se acumula al histórico total (sin reseteo — nunca se
// pierde) y el resultado queda en el documento para que un reintento
// posterior lo reciba sin cobrar.
async function liquidar({ uid, idempotencyKey, creditosReales, resultado = null }) {
  const refCreditos = db().doc(`iaCreditos/${uid}`)
  const refConsumo = db().doc(`iaConsumos/${idempotencyKey}`)

  return db().runTransaction(async (tx) => {
    const consumoSnap = await tx.get(refConsumo)
    if (!consumoSnap.exists) throw new ErrorCreditos('CONSUMO_INEXISTENTE', 'No hay reserva que liquidar')
    const consumo = consumoSnap.data()
    if (consumo.estado === 'ejecutado') return { repetida: true, consumo } // liquidación idempotente
    if (consumo.estado !== 'reservado') {
      throw new ErrorCreditos('ESTADO_INVALIDO', `No se puede liquidar un consumo "${consumo.estado}"`)
    }

    const creditosSnap = await tx.get(refCreditos)
    const creditos = creditosSnap.data() || { saldo: 0, consumidoTotal: 0, consumoPorCategoria: {} }

    // Lo real nunca excede lo reservado (se reservó la estimación máxima);
    // si por un defecto llegara más alto, se recorta: el saldo no baja de lo
    // ya descontado y el defecto queda a la vista en el registro.
    const reales = round2(Math.min(Math.max(creditosReales, 0), consumo.creditosReservados))
    const devolucion = round2(consumo.creditosReservados - reales)

    const categorias = { ...(creditos.consumoPorCategoria || {}) }
    categorias[consumo.categoria] = round2((categorias[consumo.categoria] || 0) + reales)

    tx.update(refConsumo, {
      estado: 'ejecutado',
      creditosReales: reales,
      resultado,
      liquidadoEn: FieldValue.serverTimestamp(),
    })
    const saldoFinal = round2((creditos.saldo || 0) + devolucion)
    tx.update(refCreditos, {
      saldo: saldoFinal,
      // Histórico total, sin reseteo — solo crece, sirve para reportes.
      consumidoTotal: round2((creditos.consumidoTotal || 0) + reales),
      consumoPorCategoria: categorias,
      actualizadoEn: FieldValue.serverTimestamp(),
    })

    return { repetida: false, creditosReales: reales, saldo: saldoFinal }
  })
}

// ── REEMBOLSO (fallo de la IA o expiración) ─────────────────────────────────
async function reembolsar({ uid, idempotencyKey, motivo = 'fallo', estadoFinal = 'fallido' }) {
  const refCreditos = db().doc(`iaCreditos/${uid}`)
  const refConsumo = db().doc(`iaConsumos/${idempotencyKey}`)

  return db().runTransaction(async (tx) => {
    const consumoSnap = await tx.get(refConsumo)
    if (!consumoSnap.exists) return { hecho: false }
    const consumo = consumoSnap.data()
    if (consumo.estado !== 'reservado') return { hecho: false, estado: consumo.estado }

    const creditosSnap = await tx.get(refCreditos)
    const saldo = round2((creditosSnap.data()?.saldo || 0) + consumo.creditosReservados)

    tx.update(refConsumo, {
      estado: estadoFinal,
      creditosReales: 0,
      motivo,
      liquidadoEn: FieldValue.serverTimestamp(),
    })
    tx.update(refCreditos, { saldo, actualizadoEn: FieldValue.serverTimestamp() })
    return { hecho: true, saldo }
  })
}

// ── LIMPIEZA DE RESERVAS HUÉRFANAS ──────────────────────────────────────────
// Si el proceso murió entre reserva y liquidación, la reserva no puede
// quedarse comiendo saldo para siempre. Cualquier 'reservado' más viejo que
// el límite se reembolsa como 'expirado'. La transacción por documento
// re-verifica el estado: si mientras tanto se liquidó, no toca nada.
//
// `minutosPorOperacion` (23-ago-2026, Crucigrama/Sopa de letras): la mayoría
// de las reservas viven segundos (reservar→ejecutar→liquidar en el mismo
// request) y 15 min ya es generoso. `generar_contenido_juego` es distinta a
// propósito — la reserva queda abierta mientras el docente edita/reconstruye
// el tablero, un ciclo que puede tomarle minutos u horas reales — así que
// esa operación usa su propio umbral, más largo, sin tocar el de las demás.
async function limpiarReservasHuerfanas({ minutos = 15, minutosPorOperacion = {}, ahora = new Date() } = {}) {
  const snap = await db().collection('iaConsumos').where('estado', '==', 'reservado').get()
  let recuperadas = 0
  for (const d of snap.docs) {
    const c = d.data()
    const umbral = minutosPorOperacion[c.operacion] ?? minutos
    const limite = new Date(ahora.getTime() - umbral * 60 * 1000)
    const creada = c.createdAt?.toDate?.()
    if (!creada || creada > limite) continue
    const r = await reembolsar({ uid: c.uid, idempotencyKey: d.id, motivo: 'reserva expirada', estadoFinal: 'expirado' })
    if (r.hecho) recuperadas++
  }
  return { recuperadas }
}

// ── AJUSTE MANUAL DE SALDO (panel de admin) ─────────────────────────────────
// Reemplaza a resetearAhora(): sin capacidad/ciclo que reponer, el ajuste
// manual del admin es un delta explícito sobre el saldo (positivo o
// negativo), con motivo — para cortesías, correcciones o pruebas del equipo.
// El saldo nunca queda negativo: un delta que lo cruzaría se recorta a 0.
async function ajustarSaldoManual({ uid, delta, motivo, adminUid }) {
  if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0) {
    throw new ErrorCreditos('DELTA_INVALIDO', 'El ajuste debe ser un número distinto de cero')
  }
  const ref = db().doc(`iaCreditos/${uid}`)
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const actual = snap.exists ? (snap.data().saldo || 0) : 0
    const saldo = round2(Math.max(0, actual + delta))
    tx.set(ref, {
      saldo,
      consumidoTotal: snap.exists ? (snap.data().consumidoTotal || 0) : 0,
      consumoPorCategoria: snap.exists ? (snap.data().consumoPorCategoria || {}) : {},
      actualizadoEn: FieldValue.serverTimestamp(),
      ultimoAjusteManual: {
        delta,
        motivo: motivo || null,
        adminUid,
        en: FieldValue.serverTimestamp(),
      },
    }, { merge: true })
    return { saldo }
  })
}

// ── BIENVENIDA VOLUNTARIA (20-ago-2026, decisión del PO) ───────────────────
// Los 50 créditos de bienvenida ya NO se acreditan automáticamente al crear
// la cuenta — el docente los activa cuando quiere. Dos pasos separados:
//
//   1. marcarBienvenidaDisponible(uid) — se dispara desde onDocenteCreado,
//      síncrono con la creación de la cuenta. NO toca `saldo` en absoluto:
//      solo dice "este docente tiene 50 créditos esperando". Idempotente
//      (no reescribe si ya existe el registro).
//   2. activarCreditosBienvenida(uid) — la llama el propio docente (callable
//      autenticado) al confirmar "Activar mis 50 créditos". Solo entonces
//      se acreditan. Idempotente vía `bienvenidaActivada`: una segunda
//      llamada (doble clic, dos pestañas) no vuelve a sumar.
//
// Ambas reutilizan `iaTrialRegistro/{uid}` (sin colección nueva):
//   { bienvenidaDisponible, bienvenidaActivada, activadaEn, creditosBienvenida }

async function marcarBienvenidaDisponible({ uid }) {
  const refRegistro = db().doc(`iaTrialRegistro/${uid}`)
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(refRegistro)
    if (snap.exists) return { repetida: true }
    tx.set(refRegistro, {
      uid,
      bienvenidaDisponible: true,
      bienvenidaActivada: false,
      activadaEn: null,
      creditosBienvenida: CREDITOS_BIENVENIDA,
    })
    return { repetida: false }
  })
}

async function activarCreditosBienvenida({ uid, ahora = new Date() }) {
  const refCreditos = db().doc(`iaCreditos/${uid}`)
  const refRegistro = db().doc(`iaTrialRegistro/${uid}`)

  return db().runTransaction(async (tx) => {
    const registroSnap = await tx.get(refRegistro)
    if (!registroSnap.exists || !registroSnap.data().bienvenidaDisponible) {
      throw new ErrorCreditos('BIENVENIDA_NO_DISPONIBLE', 'Esta cuenta no tiene créditos de bienvenida por activar')
    }
    if (registroSnap.data().bienvenidaActivada) {
      return { repetida: true, saldo: undefined }
    }
    const creditosSnap = await tx.get(refCreditos)
    const saldoActual = creditosSnap.exists ? (creditosSnap.data().saldo || 0) : 0

    tx.set(refCreditos, {
      saldo: saldoActual + CREDITOS_BIENVENIDA,
      consumidoTotal: creditosSnap.exists ? (creditosSnap.data().consumidoTotal || 0) : 0,
      consumoPorCategoria: creditosSnap.exists ? (creditosSnap.data().consumoPorCategoria || {}) : {},
      actualizadoEn: FieldValue.serverTimestamp(),
      ...(creditosSnap.exists ? {} : { creadoEn: FieldValue.serverTimestamp() }),
    }, { merge: true })
    tx.set(refRegistro, {
      bienvenidaActivada: true,
      activadaEn: Timestamp.fromDate(ahora),
    }, { merge: true })

    return { repetida: false, saldo: saldoActual + CREDITOS_BIENVENIDA }
  })
}

// ── ACREDITAR UNA COMPRA DE CRÉDITOS (paquetes de config/iaTarifas) ─────────
// Aprobación manual del admin (única vía de pago, transferencia — ver
// [[project_solo_transferencia_v101]]), pero la acreditación en sí SIEMPRE
// pasa por aquí, nunca por una escritura directa a `iaCreditos` (que las
// reglas de Firestore ya bloquean por completo al cliente). La transacción
// relee `creditPurchases/{purchaseId}` primero: si ya está "completado", no
// vuelve a sumar nada — así una doble aprobación (doble clic del admin, o un
// reintento) nunca acredita dos veces.
async function acreditarCompraCreditos({ purchaseId, adminUid }) {
  const refCompra = db().doc(`creditPurchases/${purchaseId}`)

  return db().runTransaction(async (tx) => {
    const compraSnap = await tx.get(refCompra)
    if (!compraSnap.exists) throw new ErrorCreditos('COMPRA_INEXISTENTE', 'Esta compra ya no existe')
    const compra = compraSnap.data()
    if (compra.status === 'completado') return { repetida: true, creditos: compra.creditos }
    if (compra.status !== 'pendiente') {
      throw new ErrorCreditos('ESTADO_INVALIDO', `No se puede aprobar una compra "${compra.status}"`)
    }

    const refCreditos = db().doc(`iaCreditos/${compra.docenteId}`)
    const creditosSnap = await tx.get(refCreditos)
    const saldoActual = creditosSnap.exists ? (creditosSnap.data().saldo || 0) : 0
    const nuevoSaldo = saldoActual + compra.creditos

    tx.set(refCreditos, {
      saldo: nuevoSaldo,
      consumidoTotal: creditosSnap.exists ? (creditosSnap.data().consumidoTotal || 0) : 0,
      consumoPorCategoria: creditosSnap.exists ? (creditosSnap.data().consumoPorCategoria || {}) : {},
      actualizadoEn: FieldValue.serverTimestamp(),
      ...(creditosSnap.exists ? {} : { creadoEn: FieldValue.serverTimestamp() }),
    }, { merge: true })

    tx.update(refCompra, {
      status: 'completado',
      resueltoEn: FieldValue.serverTimestamp(),
      resueltoPor: adminUid,
    })
    return { repetida: false, creditos: compra.creditos, saldo: nuevoSaldo }
  })
}

module.exports = {
  ErrorCreditos,
  CREDITOS_BIENVENIDA,
  cargarTarifas,
  acreditarCompraCreditos,
  marcarBienvenidaDisponible,
  activarCreditosBienvenida,
  reservar,
  liquidar,
  reembolsar,
  limpiarReservasHuerfanas,
  ajustarSaldoManual,
}
