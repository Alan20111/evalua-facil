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
//   trial → capacidad de trial (50, decisión de Kike del 13-ago-2026 — ver
//           capacidadTrialPara para los trials creados ANTES de este cambio)
//   pro y anual → nivel Asistente IA (mismo producto, distinta periodicidad)
//   mayor → nivel Asistente IA Pro
//   cortesia → el administrador elige el monto por docente al otorgarla
//              (subscriptions/{id}.cortesiaCreditos, tope 1750 = el máximo del
//              plan mayor); sin ese campo, la IA se rechaza con mensaje claro
//              (decisión de Kike, 15-ago-2026 — reemplaza el "pendiente" del
//              9-ago-2026, que dejaba cortesía sin créditos siempre).
function nivelDeSuscripcion(sub) {
  if (!sub) return 'trial' // sin suscripción: mismo criterio que el candado (se repone la prueba)
  if (sub.planId === 'cortesia') return 'cortesia'
  if (sub.planId === 'mayor') return 'mayor'
  if (sub.planId === 'pro' || sub.planId === 'anual') return 'pro'
  return 'trial'
}

// Capacidad de trial que le toca a ESTA suscripción — nunca la reduce
// retroactivamente (decisión de Kike, 13-ago-2026: el trial que ya bajó de
// 350 a 50 en config/iaTarifas.capacidadPorPlan.trial no debe recortarle
// nada a quien YA estaba en trial cuando se hizo el cambio).
//
// `tarifas.trialLegado` (si existe) trae `{ capacidad, corte }`: cualquier
// suscripción cuyo `fechaInicio` sea ANTERIOR a `corte` conserva `capacidad`
// (el valor de antes del cambio); las posteriores usan el valor nuevo de
// `capacidadPorPlan.trial`. Sin `trialLegado` (proyectos que nunca bajaron el
// valor), el comportamiento es idéntico al de siempre.
//
// Solo importa en la creación del doc de iaCreditos (el trial NUNCA renueva,
// ver camposRenovados) — una vez creado, su `capacidad` ya quedó fija.
function capacidadTrialPara(sub, tarifas) {
  const legado = tarifas.trialLegado
  const inicio = sub?.fechaInicio
  if (legado && inicio && legado.corte) {
    const inicioMs = inicio.toMillis ? inicio.toMillis() : null
    const corteMs = legado.corte.toMillis ? legado.corte.toMillis() : null
    if (inicioMs != null && corteMs != null && inicioMs < corteMs) {
      return legado.capacidad
    }
  }
  return (tarifas.capacidadPorPlan || {}).trial
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
  // Cortesía no tiene un nivel global en config/iaTarifas: conserva la
  // capacidad que el administrador le eligió a ESTE docente al otorgarla.
  const capacidad = plan === 'cortesia' ? creditos.capacidad : capacidadPorPlan[plan]
  if (capacidad == null) throw new ErrorCreditos('PLAN_SIN_CAPACIDAD', `El plan "${plan}" no tiene capacidad definida`)
  return {
    plan,
    planSiguiente: FieldValue.delete(),
    capacidad,
    // `creditosAdicionalesVigentes` (compra de créditos, 18-ago-2026) NO se
    // pierde en la renovación — es la ÚNICA excepción a "los créditos no
    // usados no se acumulan", que sigue aplicando tal cual a la bolsa de la
    // suscripción (`capacidad`). Se lee del doc actual (nunca se toca en
    // otro lado del objeto que se retorna) y se vuelve a sumar aquí.
    saldo: capacidad + (creditos.creditosAdicionalesVigentes || 0),
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
  // `porUso == null` (no `!porUso`): una tarifa de 0 es válida — el Chat con
  // Asistente (18-ago-2026) no cobra por mensaje, y `!0` sería `true`,
  // rechazando la operación como si no tuviera tarifa configurada.
  if (porUso == null) throw new ErrorCreditos('OPERACION_DESCONOCIDA', `Sin tarifa para "${operacion}"`)
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
      const capacidad = plan === 'trial'
        ? capacidadTrialPara(sub, tarifas)
        : plan === 'cortesia'
          ? (sub?.cortesiaCreditos ?? null)
          : capacidadPorPlan[plan]
      if (capacidad == null) {
        throw plan === 'cortesia'
          ? new ErrorCreditos('CORTESIA_PENDIENTE', 'El administrador aún no asignó créditos de IA a esta cortesía')
          : new ErrorCreditos('PLAN_SIN_CAPACIDAD', `El plan "${plan}" no tiene capacidad definida`)
      }
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
    // El gasto real (`reales`) se descuenta también de la bolsa de
    // "adicionales vigentes" (compra de créditos, 18-ago-2026) — nunca baja
    // de 0. No se distingue de qué bolsa salió cada crédito exactamente
    // (saldo es un solo número); esto es una aproximación deliberadamente
    // simple que SIEMPRE es correcta en un sentido: jamás protege de la
    // renovación más créditos de los que en verdad quedan sin usar.
    const adicionalesVigentes = Math.max(0, (creditos.creditosAdicionalesVigentes || 0) - reales)
    tx.update(refCreditos, {
      saldo: saldoFinal,
      consumidoCiclo: (creditos.consumidoCiclo || 0) + reales,
      consumoPorCategoria: categorias,
      creditosAdicionalesVigentes: adicionalesVigentes,
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
async function sincronizarPlan({ uid, nivelNuevo, tarifas, capacidadCortesia }) {
  tarifas = tarifas || await cargarTarifas()
  const capacidadPorPlan = tarifas.capacidadPorPlan || {}
  const capacidadNueva = nivelNuevo === 'cortesia' ? (capacidadCortesia ?? null) : capacidadPorPlan[nivelNuevo]
  if (capacidadNueva == null) return { hecho: false, motivo: nivelNuevo === 'cortesia' ? 'cortesia sin créditos elegidos' : 'plan sin capacidad' }

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

// ── RESETEO MANUAL (panel de admin) ─────────────────────────────────────────
// Llena el saldo a la capacidad actual EN EL ACTO, sin esperar a que venza el
// ciclo — para las cuentas de prueba del propio equipo. No toca cicloInicio
// ni cicloFin (el ciclo mensual real de esa cuenta sigue su curso normal;
// esto solo repone lo consumido) ni la capacidad — si el admin quiere
// cambiarla, es sincronizarPlan()/editar la suscripción, no esto.
async function resetearAhora({ uid }) {
  const ref = db().doc(`iaCreditos/${uid}`)
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) {
      throw new ErrorCreditos('SIN_CREDITOS_AUN', 'Este docente todavía no ha usado la IA — no hay nada que resetear')
    }
    const c = snap.data()
    tx.update(ref, {
      saldo: c.capacidad,
      consumidoCiclo: 0,
      consumoPorCategoria: {},
      actualizadoEn: FieldValue.serverTimestamp(),
    })
    return { saldo: c.capacidad, capacidad: c.capacidad }
  })
}

// ── ACREDITAR UNA COMPRA DE CRÉDITOS ADICIONALES (18-ago-2026) ─────────────
// Aprobación manual del admin (única vía de pago hoy, transferencia — ver
// [[project_solo_transferencia_v101]]), pero la acreditación en sí SIEMPRE
// pasa por aquí, nunca por una escritura directa a `iaCreditos` (que las
// reglas de Firestore ya bloquean por completo al cliente). La transacción
// relee `creditPurchases/{purchaseId}` primero: si ya está "completado", no
// vuelve a sumar nada — así una doble aprobación (doble clic del admin, o un
// reintento) nunca acredita dos veces.
//
// El docente debe tener YA un doc `iaCreditos` (haber usado la IA al menos
// una vez) — no se le crea uno aquí desde cero, porque eso duplicaría la
// lógica de "primer uso" (plan/capacidad/ciclo) que ya vive en `reservar()`.
// Si todavía no existe, se rechaza con un mensaje claro — pendiente conocido,
// ver el reporte de entrega.
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
    if (!creditosSnap.exists) {
      throw new ErrorCreditos('SIN_CREDITOS_AUN',
        'Este docente todavía no ha usado la IA — no tiene una bolsa de créditos activa donde abonar la compra.')
    }
    const creditos = creditosSnap.data()
    const nuevoSaldo = (creditos.saldo || 0) + compra.creditos
    const nuevoAdicionalesVigentes = (creditos.creditosAdicionalesVigentes || 0) + compra.creditos
    const nuevoAdicionalesComprados = (creditos.creditosAdicionalesComprados || 0) + compra.creditos

    tx.update(refCreditos, {
      saldo: nuevoSaldo,
      creditosAdicionalesVigentes: nuevoAdicionalesVigentes,
      creditosAdicionalesComprados: nuevoAdicionalesComprados,
      actualizadoEn: FieldValue.serverTimestamp(),
    })
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
  nivelDeSuscripcion,
  capacidadTrialPara,
  camposRenovados,
  cargarTarifas,
  acreditarCompraCreditos,
  reservar,
  liquidar,
  reembolsar,
  limpiarReservasHuerfanas,
  renovarCiclosVencidos,
  cerrarTrialsVencidos,
  sincronizarPlan,
  resetearAhora,
  _unMesDespues: unMesDespues,
}
