// Ledger de créditos IA — la única fuente de verdad del saldo.
//
// Todo lo que toca saldo pasa por transacciones de Firestore en este módulo:
// el cliente JAMÁS escribe iaCreditos/iaConsumos (las reglas lo prohíben), y
// la IA jamás decide cuánto se descuenta — los costos vienen de
// `config/iaTarifas` y las cuentas las hace este código.
//
// Modelo de datos:
//   iaCreditos/{uid}    — saldo, capacidad, ciclo mensual (desde la fecha de
//                         activación), consumo agregado por categoría. Lo lee
//                         el docente (su barra), lo escribe solo el servidor.
//   iaConsumos/{clave}  — un documento por operación confirmada. Su ID es la
//                         CLAVE DE IDEMPOTENCIA: un reintento encuentra el
//                         documento y no vuelve a cobrar. Sin tokens ni costos
//                         monetarios (eso va en iaConsumosInterno, que el
//                         cliente no puede leer).
//
// Invariantes que las pruebas afirman:
//   · el saldo nunca baja de cero;
//   · una clave de idempotencia cobra a lo más una vez;
//   · dos reservas simultáneas no pueden gastar los mismos créditos;
//   · una reserva sin liquidar se reembolsa (fallo explícito o limpieza);
//   · la renovación avanza el ciclo exactamente una vez (compara-y-avanza);
//   · los créditos no usados NO se acumulan (saldo := capacidad).
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

// ── Errores con código, para que el callable los traduzca a HttpsError ──────
class ErrorCreditos extends Error {
  constructor(codigo, mensaje, datos = {}) {
    super(mensaje)
    this.codigo = codigo
    this.datos = datos
  }
}

// ── Planes ──────────────────────────────────────────────────────────────────
// La suscripción actual usa: status 'trial' (planId vacío), o planId
// 'pro' | 'anual' | 'mayor' | 'cortesia'. Para créditos:
//   trial → capacidad de trial (350, decisión de Kike del 9-ago-2026)
//   pro y anual → nivel Plan Docente (mismo producto, distinta periodicidad)
//   mayor → nivel Plan Mayor
//   cortesia → PENDIENTE por decisión explícita: se rechaza con mensaje claro.
function nivelDeSuscripcion(sub) {
  if (!sub) return 'trial' // sin suscripción: mismo criterio que el candado (se repone la prueba)
  if (sub.planId === 'cortesia') return 'cortesia'
  if (sub.planId === 'mayor') return 'mayor'
  if (sub.planId === 'pro' || sub.planId === 'anual') return 'pro'
  return 'trial'
}

// ── Ciclo mensual desde la fecha de activación ──────────────────────────────
function unMesDespues(fecha) {
  const d = new Date(fecha.getTime())
  d.setMonth(d.getMonth() + 1)
  return d
}

// Devuelve los campos renovados si el ciclo ya venció; null si sigue vigente.
// Avanza de mes en mes (por si pasaron varios sin uso) y aplica el cambio de
// plan diferido (bajada de plan: entra en vigor en la renovación).
function camposRenovados(creditos, ahora, capacidadPorPlan) {
  let fin = creditos.cicloFin.toDate()
  if (ahora < fin) return null
  // EL TRIAL NO RENUEVA (regla del PO, 9-ago-2026): son 350 créditos UNA sola
  // vez — el trial termina por días (candado de suscripción) o por créditos,
  // lo que ocurra primero. Sin esto, un mes corto (febrero) podría regalar
  // una segunda bolsa dentro de los 30 días. La conversión a pago no pasa por
  // aquí: la maneja sincronizarPlan cuando cambia la suscripción.
  if ((creditos.planSiguiente || creditos.plan) === 'trial') return null
  let inicio = creditos.cicloInicio.toDate()
  while (ahora >= fin) {
    inicio = fin
    fin = unMesDespues(fin)
  }
  const plan = creditos.planSiguiente || creditos.plan
  const capacidad = capacidadPorPlan[plan]
  if (capacidad == null) throw new ErrorCreditos('PLAN_SIN_CAPACIDAD', `El plan "${plan}" no tiene capacidad definida`)
  return {
    plan,
    planSiguiente: FieldValue.delete(),
    capacidad,
    saldo: capacidad, // asignación, no suma: los créditos no usados no se acumulan
    consumidoCiclo: 0,
    consumoPorCategoria: {},
    cicloInicio: Timestamp.fromDate(inicio),
    cicloFin: Timestamp.fromDate(fin),
  }
}

// ── Cargar tarifas (fuera de transacción: el doc cambia rara vez) ───────────
async function cargarTarifas() {
  const snap = await db().doc('config/iaTarifas').get()
  if (!snap.exists) throw new ErrorCreditos('SIN_TARIFAS', 'config/iaTarifas no existe — corre seeds-db/seed-ia-tarifas.js')
  return snap.data()
}

// ── RESERVA ─────────────────────────────────────────────────────────────────
// Transacción: idempotencia → (crear/renovar el doc de créditos) → validar
// vigencia y saldo → crear consumo 'reservado' → descontar la reserva.
//
// La reserva descuenta la ESTIMACIÓN MÁXIMA; la liquidación devuelve la
// diferencia. Así, dos operaciones simultáneas jamás gastan los mismos
// créditos y el saldo no puede cruzar cero ni con operaciones variables.
async function reservar({ uid, operacion, idempotencyKey, unidades = 1, asignaturaId = null, tarifas, ahora = new Date() }) {
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
    throw new ErrorCreditos('CLAVE_INVALIDA', 'Falta la clave de idempotencia')
  }
  const porUso = tarifas.tarifas?.[operacion]
  if (!porUso) throw new ErrorCreditos('OPERACION_DESCONOCIDA', `Sin tarifa para "${operacion}"`)
  const costo = porUso * unidades
  const categoria = tarifas.categorias?.[operacion] || 'Otros'
  const capacidadPorPlan = tarifas.capacidadPorPlan || {}

  const refCreditos = db().doc(`iaCreditos/${uid}`)
  const refConsumo = db().doc(`iaConsumos/${idempotencyKey}`)
  const refUsuario = db().doc(`users/${uid}`)

  return db().runTransaction(async (tx) => {
    // Lecturas primero (regla del Admin SDK).
    const consumoSnap = await tx.get(refConsumo)
    if (consumoSnap.exists) {
      // Reintento (doble clic, red móvil, función reejecutada): no se cobra
      // de nuevo. El que llama decide qué hacer según el estado.
      return { repetida: true, consumo: consumoSnap.data() }
    }

    const [creditosSnap, usuarioSnap] = await Promise.all([tx.get(refCreditos), tx.get(refUsuario)])

    // Vigencia de la suscripción: mismo criterio que el candado de escrituras
    // (campo ausente deja pasar; fecha vencida rechaza).
    const hasta = usuarioSnap.exists ? usuarioSnap.data().suscripcionHasta?.toDate?.() : null
    if (hasta && hasta < ahora) {
      throw new ErrorCreditos('SUSCRIPCION_VENCIDA', 'Tu suscripción no está vigente')
    }

    let creditos
    let camposNuevos = {}
    if (!creditosSnap.exists) {
      // Primer uso de IA de este docente: el doc nace aquí, con el plan que
      // diga su suscripción más reciente (mismo criterio que el candado).
      const subsSnap = await tx.get(
        db().collection('subscriptions').where('docenteId', '==', uid)
      )
      let sub = null
      const ms = (s) => s.updatedAt?.toMillis?.() || 0
      subsSnap.docs.forEach((d) => { if (!sub || ms(d.data()) > ms(sub)) sub = d.data() })
      const plan = nivelDeSuscripcion(sub)
      if (plan === 'cortesia') {
        throw new ErrorCreditos('CORTESIA_PENDIENTE', 'Los créditos del plan cortesía aún no están definidos')
      }
      const capacidad = capacidadPorPlan[plan]
      if (capacidad == null) throw new ErrorCreditos('PLAN_SIN_CAPACIDAD', `El plan "${plan}" no tiene capacidad definida`)
      creditos = {
        plan,
        capacidad,
        saldo: capacidad,
        consumidoCiclo: 0,
        consumoPorCategoria: {},
        activadoEn: Timestamp.fromDate(ahora), // ancla del ciclo: fecha de activación
        cicloInicio: Timestamp.fromDate(ahora),
        cicloFin: Timestamp.fromDate(unMesDespues(ahora)),
      }
      camposNuevos = { ...creditos, creadoEn: FieldValue.serverTimestamp() }
    } else {
      creditos = creditosSnap.data()
      if (creditos.plan === 'cortesia') {
        throw new ErrorCreditos('CORTESIA_PENDIENTE', 'Los créditos del plan cortesía aún no están definidos')
      }
      // Renovación perezosa: correcta aunque el cron no haya corrido.
      const renovados = camposRenovados(creditos, ahora, capacidadPorPlan)
      if (renovados) {
        creditos = { ...creditos, ...renovados, planSiguiente: null }
        camposNuevos = renovados
      }
    }

    if (creditos.saldo < costo) {
      throw new ErrorCreditos('SALDO_INSUFICIENTE', 'No tienes suficientes créditos para realizar esta acción', {
        saldo: creditos.saldo,
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
      plan: creditos.plan, // distingue consumo de trial vs de pago (medición)
      creditosReservados: costo,
      estado: 'reservado',
      createdAt: Timestamp.fromDate(ahora),
    })
    tx.set(refCreditos, {
      ...camposNuevos,
      saldo: creditos.saldo - costo,
      actualizadoEn: FieldValue.serverTimestamp(),
    }, { merge: true })
    // Registro interno del trial (sin acceso del cliente): nace junto con el
    // doc de créditos si el docente arranca en trial. Sirve para medir después
    // costo real, consumo promedio, agotamiento y conversión de los trials.
    if (!creditosSnap.exists && creditos.plan === 'trial') {
      tx.set(db().doc(`iaTrialRegistro/${uid}`), {
        uid,
        inicioTrial: creditos.cicloInicio,
        finTrial: creditos.cicloFin,
        creditosAsignados: creditos.capacidad,
        agotoCreditos: false,
        terminoPorTiempo: false,
        convertidoAPago: false,
        creadoEn: FieldValue.serverTimestamp(),
      })
    }

    return {
      repetida: false,
      costo,
      categoria,
      saldoTrasReserva: creditos.saldo - costo,
      capacidad: creditos.capacidad,
      plan: creditos.plan,
      cicloFin: creditos.cicloFin,
    }
  })
}

// ── LIQUIDACIÓN ─────────────────────────────────────────────────────────────
// El consumo REAL es la fuente de verdad: se ajusta el saldo (devolviendo lo
// reservado de más), se registra el consumo del ciclo y el resultado queda en
// el documento para que un reintento posterior lo reciba sin cobrar.
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
    const creditos = creditosSnap.data()

    // Lo real nunca excede lo reservado (se reservó la estimación máxima);
    // si por un defecto llegara más alto, se recorta: el saldo no baja de lo
    // ya descontado y el defecto queda a la vista en el registro.
    const reales = Math.min(Math.max(creditosReales, 0), consumo.creditosReservados)
    const devolucion = consumo.creditosReservados - reales

    const categorias = { ...(creditos.consumoPorCategoria || {}) }
    categorias[consumo.categoria] = (categorias[consumo.categoria] || 0) + reales

    tx.update(refConsumo, {
      estado: 'ejecutado',
      creditosReales: reales,
      resultado,
      liquidadoEn: FieldValue.serverTimestamp(),
    })
    const saldoFinal = creditos.saldo + devolucion
    tx.update(refCreditos, {
      saldo: saldoFinal,
      consumidoCiclo: (creditos.consumidoCiclo || 0) + reales,
      consumoPorCategoria: categorias,
      actualizadoEn: FieldValue.serverTimestamp(),
    })
    // Trial que llega a 0 créditos: se marca el agotamiento en el registro
    // interno (medición). La suspensión de la IA es automática — la próxima
    // reserva rechazará por SALDO_INSUFICIENTE; el resto del producto sigue.
    if (consumo.plan === 'trial' && saldoFinal === 0) {
      tx.set(db().doc(`iaTrialRegistro/${uid}`), {
        agotoCreditos: true,
        agotadoEn: FieldValue.serverTimestamp(),
        creditosConsumidos: (creditos.consumidoCiclo || 0) + reales,
      }, { merge: true })
    }

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
    const saldo = (creditosSnap.data()?.saldo || 0) + consumo.creditosReservados

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
async function limpiarReservasHuerfanas({ minutos = 15, ahora = new Date() } = {}) {
  const limite = new Date(ahora.getTime() - minutos * 60 * 1000)
  const snap = await db().collection('iaConsumos').where('estado', '==', 'reservado').get()
  let recuperadas = 0
  for (const d of snap.docs) {
    const c = d.data()
    const creada = c.createdAt?.toDate?.()
    if (!creada || creada > limite) continue
    const r = await reembolsar({ uid: c.uid, idempotencyKey: d.id, motivo: 'reserva expirada', estadoFinal: 'expirado' })
    if (r.hecho) recuperadas++
  }
  return { recuperadas }
}

// ── RENOVACIÓN POR CRON ─────────────────────────────────────────────────────
// La renovación perezosa (en reservar) cubre a quien usa la IA; esto cubre a
// quien no la usa, para que su barra amanezca con el ciclo correcto. La doble
// renovación es imposible: la transacción relee cicloFin (compara-y-avanza) y
// si otro camino ya renovó, no hace nada.
async function renovarCiclosVencidos({ tarifas, ahora = new Date() } = {}) {
  tarifas = tarifas || await cargarTarifas()
  const capacidadPorPlan = tarifas.capacidadPorPlan || {}
  const snap = await db().collection('iaCreditos')
    .where('cicloFin', '<=', Timestamp.fromDate(ahora)).get()
  let renovados = 0
  for (const d of snap.docs) {
    await db().runTransaction(async (tx) => {
      const fresco = await tx.get(d.ref)
      if (!fresco.exists) return
      const campos = camposRenovados(fresco.data(), ahora, capacidadPorPlan)
      if (!campos) return // otro camino renovó primero
      tx.update(d.ref, { ...campos, actualizadoEn: FieldValue.serverTimestamp() })
      renovados++
    })
  }
  return { renovados }
}

// ── CIERRE DE TRIALS VENCIDOS POR TIEMPO (solo medición) ────────────────────
// El bloqueo real por tiempo lo hace la vigencia de la suscripción (el trial
// vence a los 30 días y SUSCRIPCION_VENCIDA rechaza la IA). Esto solo deja
// constancia en el registro interno de que el trial terminó por tiempo, con
// su consumo final — para poder medir conversión y costo después.
async function cerrarTrialsVencidos({ ahora = new Date() } = {}) {
  const snap = await db().collection('iaCreditos').where('plan', '==', 'trial').get()
  let cerrados = 0
  for (const d of snap.docs) {
    const c = d.data()
    if (c.cicloFin.toDate() > ahora) continue
    const reg = await db().doc(`iaTrialRegistro/${d.id}`).get()
    if (reg.exists && (reg.data().terminoPorTiempo || reg.data().convertidoAPago)) continue
    await db().doc(`iaTrialRegistro/${d.id}`).set({
      terminoPorTiempo: true,
      terminadoEn: Timestamp.fromDate(ahora),
      creditosConsumidos: c.consumidoCiclo || 0,
      saldoFinal: c.saldo,
    }, { merge: true })
    cerrados++
  }
  return { cerrados }
}

// ── SINCRONIZAR PLAN ↔ CRÉDITOS ─────────────────────────────────────────────
// Llamado desde onSuscripcionEscrita cuando cambia el plan del docente.
//   · Subida: inmediata — capacidad nueva, SALDO CONSERVADO (decisión de
//     Kike; el ajuste/prorrateo adicional es un pendiente de facturación).
//   · Bajada: diferida — se anota planSiguiente y la renovación la aplica.
// Si el doc de créditos no existe todavía, no se crea aquí: nacerá con el
// plan correcto en el primer uso (reservar lee la suscripción más reciente).
async function sincronizarPlan({ uid, nivelNuevo, tarifas }) {
  if (nivelNuevo === 'cortesia') return { hecho: false, motivo: 'cortesia pendiente' }
  tarifas = tarifas || await cargarTarifas()
  const capacidadPorPlan = tarifas.capacidadPorPlan || {}
  const capacidadNueva = capacidadPorPlan[nivelNuevo]
  if (capacidadNueva == null) return { hecho: false, motivo: 'plan sin capacidad' }

  const ref = db().doc(`iaCreditos/${uid}`)
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { hecho: false, motivo: 'sin doc (nace en el primer uso)' }
    const c = snap.data()
    if (c.plan === nivelNuevo && !c.planSiguiente) return { hecho: false, motivo: 'sin cambio' }

    if (capacidadNueva >= c.capacidad) {
      // Subida (o regreso al mismo nivel): inmediata, conservando el saldo.
      tx.update(ref, {
        plan: nivelNuevo,
        capacidad: capacidadNueva,
        planSiguiente: FieldValue.delete(),
        actualizadoEn: FieldValue.serverTimestamp(),
      })
      // Conversión trial → pago: queda en el registro interno (medición).
      if (c.plan === 'trial' && nivelNuevo !== 'trial') {
        tx.set(db().doc(`iaTrialRegistro/${uid}`), {
          convertidoAPago: true,
          convertidoEn: FieldValue.serverTimestamp(),
          planDestino: nivelNuevo,
          saldoAlConvertir: c.saldo,
          creditosConsumidos: c.consumidoCiclo || 0,
        }, { merge: true })
      }
      return { hecho: true, modo: 'inmediato' }
    }
    // Bajada: en la siguiente renovación.
    tx.update(ref, { planSiguiente: nivelNuevo, actualizadoEn: FieldValue.serverTimestamp() })
    return { hecho: true, modo: 'diferido' }
  })
}

module.exports = {
  ErrorCreditos,
  nivelDeSuscripcion,
  camposRenovados,
  cargarTarifas,
  reservar,
  liquidar,
  reembolsar,
  limpiarReservasHuerfanas,
  renovarCiclosVencidos,
  cerrarTrialsVencidos,
  sincronizarPlan,
  _unMesDespues: unMesDespues,
}
