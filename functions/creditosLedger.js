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
const CREDITOS_BIENVENIDA = 30

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

// ── Registro de movimientos del docente (iaMovimientos) ─────────────────────
// Un documento por movimiento de créditos, escrito DENTRO de la misma
// transacción que mueve el saldo: o se aplican las dos cosas o ninguna, y
// `saldoDespues` es el saldo real que dejó esa transacción. El cliente solo
// lee lo suyo (firestore.rules); nunca escribe.
//
// IDs deterministas (un reintento reescribe el mismo documento, no duplica):
//   · consumo   → la clave de idempotencia (misma que iaConsumos/{clave});
//   · compra    → compra_{purchaseId};
//   · bienvenida→ bienvenida_{uid};
//   · ajuste    → ajuste_{id aleatorio} (cada ajuste del admin es un hecho nuevo).
//
// Lo que NUNCA se copia aquí: `motivo` de errores del proveedor, `resultado`
// de la IA, el `motivo`/`adminUid` de un ajuste. El docente solo ve códigos
// fijos (`motivoCodigo`) que la interfaz traduce a texto.
const ZONA_PERIODO = 'America/Mexico_City'

// 'AAAA-MM' en hora de México: es la llave de paginación mensual de la
// registro de movimientos (dos igualdades, uid + periodo, sin índice compuesto).
function periodoDe(fecha) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_PERIODO, year: 'numeric', month: '2-digit' }).formatToParts(fecha)
  const anio = partes.find((p) => p.type === 'year').value
  const mes = partes.find((p) => p.type === 'month').value
  return `${anio}-${mes}`
}

// merge: true — si el movimiento no existe (reserva anterior al registro de movimientos
// que se liquida después) se crea completo; si existe, solo se actualiza.
function escribirMovimiento(tx, id, datos) {
  tx.set(db().doc(`iaMovimientos/${id}`), { ...datos, origen: 'ledger' }, { merge: true })
}

// ── Cadena de saldos (nov-2026) ─────────────────────────────────────────────
// Regla: saldo nuevo = saldo anterior − gasto + abono, fila por fila, en el
// orden en que de verdad cambió el saldo. Para que eso se cumpla siempre:
//   · Cada movimiento lleva `saldoAntes` y `saldoDespues` de su transacción y
//     un número de orden por cuenta (`secuencia`, contador
//     iaCreditos.secuenciaMovimientos), asignado DENTRO de la transacción que
//     mueve el saldo — las transacciones sobre iaCreditos/{uid} se serializan,
//     así que el número es el orden real, aunque dos operaciones se crucen.
//   · Un movimiento que no cumple la regla no se escribe: la transacción
//     entera se cancela (MOVIMIENTO_INCONSISTENTE) y el saldo no cambia.
//   · Una reserva solo se reescribe en su lugar si nada movió el saldo desde
//     que se abrió. Si algo lo movió, la reserva se queda como se descontó y lo
//     no usado vuelve en su propia fila (tipo 'devolucion'), con su número.
function siguienteSecuencia(creditos) {
  return (Number(creditos?.secuenciaMovimientos) || 0) + 1
}

function validarMovimiento({ saldoAntes, delta, saldoDespues }) {
  const ok = [saldoAntes, delta, saldoDespues].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    round2(saldoAntes + delta) === round2(saldoDespues) && saldoDespues >= 0
  if (!ok) {
    throw new ErrorCreditos('MOVIMIENTO_INCONSISTENTE', `Movimiento inconsistente: ${saldoAntes} + ${delta} ≠ ${saldoDespues}`)
  }
}

// Movimiento de un consumo a partir de su documento de iaConsumos.
function baseConsumo(consumo) {
  const fecha = consumo.createdAt?.toDate?.() || new Date()
  return {
    uid: consumo.uid,
    tipo: 'consumo',
    operacion: consumo.operacion,
    categoria: consumo.categoria || 'Otros',
    fecha: consumo.createdAt || Timestamp.fromDate(fecha),
    periodo: periodoDe(fecha),
  }
}

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
// `costoCalculado` (opcional, oct-2026): importe exacto que calculó el
// SERVIDOR cuando una operación no es «tarifa × unidades» — hoy, un lote de
// "Calificar con IA" que mezcla entregas con imágenes (0.50) y solo documentos
// (0.25). Nunca viene del cliente: lo calcula functions/ia.js con
// config/iaTarifas. Sin él, todo sigue igual que antes.
// `detalle` (opcional): desglose verificable del cobro (entregas, tipos,
// tarifas). Se guarda en el consumo y en el movimiento del docente.
// `operacionCategoria` (opcional): operación base cuya categoría se usa si la
// clave efectiva no tiene una propia (las claves «…_imagenes» caían en «Otros»).
async function reservar({
  uid, operacion, idempotencyKey, unidades = 1, asignaturaId = null, tarifas, ahora = new Date(),
  costoCalculado = null, detalle = null, operacionCategoria = null,
}) {
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
    throw new ErrorCreditos('CLAVE_INVALIDA', 'Falta la clave de idempotencia')
  }
  const porUso = tarifas.tarifas?.[operacion]
  // `porUso == null` (no `!porUso`): una tarifa de 0 es válida — el Chat con
  // Asistente no cobra por mensaje, y `!0` sería `true`, rechazando la
  // operación como si no tuviera tarifa configurada.
  if (porUso == null) throw new ErrorCreditos('OPERACION_DESCONOCIDA', `Sin tarifa para "${operacion}"`)
  if (costoCalculado != null && (typeof costoCalculado !== 'number' || !Number.isFinite(costoCalculado) || costoCalculado < 0)) {
    throw new ErrorCreditos('COSTO_INVALIDO', 'El costo calculado no es válido')
  }
  const costo = costoCalculado != null ? round2(costoCalculado) : round2(porUso * unidades)
  const categoria = tarifas.categorias?.[operacion] ||
    (operacionCategoria ? tarifas.categorias?.[operacionCategoria] : null) ||
    'Otros'
  const detalleReserva = detalle ? { ...detalle, reservado: costo } : null

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
    const createdAt = Timestamp.fromDate(ahora)
    const saldoAntes = round2(creditos.saldo || 0)
    const saldoTrasReserva = round2(saldoAntes - costo)
    const secuencia = siguienteSecuencia(creditos)
    validarMovimiento({ saldoAntes, delta: -costo, saldoDespues: saldoTrasReserva })
    tx.set(refConsumo, {
      uid,
      operacion,
      categoria,
      asignaturaId,
      unidades,
      creditosReservados: costo,
      estado: 'reservado',
      createdAt,
      // Para saber al liquidar si algo movió el saldo mientras tanto.
      secuenciaReserva: secuencia,
      saldoAntesReserva: saldoAntes,
      ...(detalleReserva && { detalle: detalleReserva }),
    })
    // Registro: «en proceso» con la reserva ya descontada. Se cierra en
    // liquidar (cobro real) o reembolsar (sin cobro).
    escribirMovimiento(tx, idempotencyKey, {
      ...baseConsumo({ uid, operacion, categoria, createdAt }),
      delta: -costo,
      estado: 'en_proceso',
      saldoAntes,
      saldoDespues: saldoTrasReserva,
      secuencia,
      ...(detalleReserva && { detalle: detalleReserva }),
      actualizadoEn: FieldValue.serverTimestamp(),
    })
    tx.set(refCreditos, {
      ...camposNuevos,
      saldo: saldoTrasReserva,
      secuenciaMovimientos: secuencia,
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

// Cierra el movimiento de una reserva (al liquidar o reembolsar) sin romper la
// cadena. `cobrado` es lo que de verdad se descuenta al final; `devolucion` lo
// que vuelve al saldo ahora. Devuelve el nuevo contador de secuencia (o null si
// no cambia) para escribirlo en iaCreditos.
function cerrarMovimientoReserva(tx, { idempotencyKey, consumo, creditos, cobrado, devolucion, campos }) {
  const saldoActual = round2(creditos.saldo || 0)
  const saldoFinal = round2(saldoActual + devolucion)
  const contador = Number(creditos.secuenciaMovimientos) || 0
  const enSitio = Number.isFinite(consumo.secuenciaReserva) && consumo.secuenciaReserva === contador &&
    typeof consumo.saldoAntesReserva === 'number'
  if (enSitio) {
    // Nada movió el saldo desde la reserva: la fila pasa a decir lo real.
    const mov = { saldoAntes: round2(consumo.saldoAntesReserva), delta: cobrado ? -cobrado : 0, saldoDespues: saldoFinal }
    validarMovimiento(mov)
    escribirMovimiento(tx, idempotencyKey, { ...baseConsumo(consumo), ...campos, ...mov, secuencia: consumo.secuenciaReserva })
    return { saldoFinal, secuencia: null }
  }
  // Algo movió el saldo entretanto (otra operación, una compra, un ajuste) o la
  // reserva es anterior a la numeración: la fila de la reserva se queda como se
  // descontó y lo no usado vuelve en su propia fila.
  escribirMovimiento(tx, idempotencyKey, {
    ...baseConsumo(consumo),
    ...campos,
    delta: -consumo.creditosReservados,
    ...(devolucion > 0 && { devolucionAparte: true }),
  })
  if (devolucion <= 0) return { saldoFinal, secuencia: null }
  const secuencia = contador + 1
  const ahora = new Date()
  const mov = { saldoAntes: saldoActual, delta: devolucion, saldoDespues: saldoFinal }
  validarMovimiento(mov)
  escribirMovimiento(tx, `${idempotencyKey}_devolucion`, {
    uid: consumo.uid,
    tipo: 'devolucion',
    operacion: consumo.operacion,
    categoria: consumo.categoria || 'Otros',
    consumoId: idempotencyKey,
    estado: 'aplicado',
    ...mov,
    secuencia,
    fecha: Timestamp.fromDate(ahora),
    periodo: periodoDe(ahora),
    actualizadoEn: FieldValue.serverTimestamp(),
  })
  return { saldoFinal, secuencia }
}

// ── LIQUIDACIÓN ─────────────────────────────────────────────────────────────
// El consumo REAL es la fuente de verdad: se ajusta el saldo (devolviendo lo
// reservado de más), se acumula al histórico total (sin reseteo — nunca se
// pierde) y el resultado queda en el documento para que un reintento
// posterior lo reciba sin cobrar.
// `detalle` (opcional): lo que DE VERDAD se procesó (p. ej. entregas evaluadas
// por tipo). Se completa con lo reservado, lo cobrado y lo devuelto, para que
// el registro nunca diga que se procesó lo que falló.
async function liquidar({ uid, idempotencyKey, creditosReales, resultado = null, detalle = null }) {
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

    const detalleFinal = (detalle || consumo.detalle)
      ? { ...(consumo.detalle || {}), ...(detalle || {}), reservado: consumo.creditosReservados, cobrado: reales, devuelto: devolucion }
      : null

    tx.update(refConsumo, {
      estado: 'ejecutado',
      creditosReales: reales,
      resultado,
      liquidadoEn: FieldValue.serverTimestamp(),
      ...(detalleFinal && { detalle: detalleFinal }),
    })
    const { saldoFinal, secuencia } = cerrarMovimientoReserva(tx, {
      idempotencyKey, consumo, creditos, cobrado: reales, devolucion,
      campos: {
        estado: 'aplicado',
        ...(detalleFinal && { detalle: detalleFinal }),
        actualizadoEn: FieldValue.serverTimestamp(),
      },
    })
    tx.update(refCreditos, {
      saldo: saldoFinal,
      // Histórico total, sin reseteo — solo crece, sirve para reportes.
      consumidoTotal: round2((creditos.consumidoTotal || 0) + reales),
      consumoPorCategoria: categorias,
      ...(secuencia != null && { secuenciaMovimientos: secuencia }),
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
    const creditos = creditosSnap.data() || { saldo: 0 }
    // Con desglose: se deja constancia de que no se cobró nada y se devolvió todo.
    const detalleFinal = consumo.detalle
      ? { ...consumo.detalle, cobrado: 0, devuelto: consumo.creditosReservados }
      : null

    tx.update(refConsumo, {
      estado: estadoFinal,
      creditosReales: 0,
      motivo,
      liquidadoEn: FieldValue.serverTimestamp(),
      ...(detalleFinal && { detalle: detalleFinal }),
    })
    // Registro: sin cobro. `motivoCodigo` es el estado final ('fallido',
    // 'expirado', 'cancelado'): nunca el `motivo` técnico del proveedor.
    const { saldoFinal: saldo, secuencia } = cerrarMovimientoReserva(tx, {
      idempotencyKey, consumo, creditos, cobrado: 0, devolucion: round2(consumo.creditosReservados),
      campos: {
        estado: 'sin_cobro',
        motivoCodigo: estadoFinal,
        ...(detalleFinal && { detalle: detalleFinal }),
        actualizadoEn: FieldValue.serverTimestamp(),
      },
    })
    tx.update(refCreditos, {
      saldo,
      ...(secuencia != null && { secuenciaMovimientos: secuencia }),
      actualizadoEn: FieldValue.serverTimestamp(),
    })
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
    const actual = round2(snap.exists ? (snap.data().saldo || 0) : 0)
    const saldo = round2(Math.max(0, actual + delta))
    // Registro: se registra lo que de verdad cambió el saldo (un delta que
    // lo cruzaría por debajo de cero se recorta). Sin motivo ni adminUid: el
    // docente solo ve «Ajuste de Evalúa Fácil».
    const aplicado = round2(saldo - actual)
    let secuencia = null
    if (aplicado !== 0) {
      const ahora = new Date()
      secuencia = siguienteSecuencia(snap.data())
      const mov = { saldoAntes: actual, delta: aplicado, saldoDespues: saldo }
      validarMovimiento(mov)
      escribirMovimiento(tx, `ajuste_${db().collection('iaMovimientos').doc().id}`, {
        uid,
        tipo: 'ajuste',
        ...mov,
        estado: 'aplicado',
        secuencia,
        fecha: Timestamp.fromDate(ahora),
        periodo: periodoDe(ahora),
        actualizadoEn: FieldValue.serverTimestamp(),
      })
    }
    tx.set(ref, {
      saldo,
      ...(secuencia != null && { secuenciaMovimientos: secuencia }),
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
// Los 30 créditos de bienvenida ya NO se acreditan automáticamente al crear
// la cuenta — el docente los activa cuando quiere. Dos pasos separados:
//
//   1. marcarBienvenidaDisponible(uid) — se dispara desde onDocenteCreado,
//      síncrono con la creación de la cuenta. NO toca `saldo` en absoluto:
//      solo dice "este docente tiene 30 créditos esperando". Idempotente
//      (no reescribe si ya existe el registro).
//   2. activarCreditosBienvenida(uid) — la llama el propio docente (callable
//      autenticado) al confirmar "Activar mis 30 créditos". Solo entonces
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
    const saldoActual = round2(creditosSnap.exists ? (creditosSnap.data().saldo || 0) : 0)
    const saldoNuevo = round2(saldoActual + CREDITOS_BIENVENIDA)
    const secuencia = siguienteSecuencia(creditosSnap.data())
    const mov = { saldoAntes: saldoActual, delta: CREDITOS_BIENVENIDA, saldoDespues: saldoNuevo }
    validarMovimiento(mov)

    tx.set(refCreditos, {
      saldo: saldoNuevo,
      secuenciaMovimientos: secuencia,
      consumidoTotal: creditosSnap.exists ? (creditosSnap.data().consumidoTotal || 0) : 0,
      consumoPorCategoria: creditosSnap.exists ? (creditosSnap.data().consumoPorCategoria || {}) : {},
      actualizadoEn: FieldValue.serverTimestamp(),
      ...(creditosSnap.exists ? {} : { creadoEn: FieldValue.serverTimestamp() }),
    }, { merge: true })
    tx.set(refRegistro, {
      bienvenidaActivada: true,
      activadaEn: Timestamp.fromDate(ahora),
    }, { merge: true })
    escribirMovimiento(tx, `bienvenida_${uid}`, {
      uid,
      tipo: 'bienvenida',
      ...mov,
      estado: 'aplicado',
      secuencia,
      fecha: Timestamp.fromDate(ahora),
      periodo: periodoDe(ahora),
      actualizadoEn: FieldValue.serverTimestamp(),
    })

    return { repetida: false, saldo: saldoNuevo }
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
    const saldoActual = round2(creditosSnap.exists ? (creditosSnap.data().saldo || 0) : 0)
    const nuevoSaldo = round2(saldoActual + compra.creditos)
    const secuencia = siguienteSecuencia(creditosSnap.data())
    const mov = { saldoAntes: saldoActual, delta: compra.creditos, saldoDespues: nuevoSaldo }
    validarMovimiento(mov)

    tx.set(refCreditos, {
      saldo: nuevoSaldo,
      secuenciaMovimientos: secuencia,
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
    const ahora = new Date()
    escribirMovimiento(tx, `compra_${purchaseId}`, {
      uid: compra.docenteId,
      tipo: 'compra',
      ...mov,
      estado: 'aplicado',
      secuencia,
      ref: purchaseId,
      fecha: Timestamp.fromDate(ahora),
      periodo: periodoDe(ahora),
      actualizadoEn: FieldValue.serverTimestamp(),
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
  periodoDe,
  validarMovimiento,
}
