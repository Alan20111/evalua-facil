import { admin, getDb } from './firebaseAdmin.js'

// Duplicado de TRIAL_DURATION_DAYS (src/utils/subscriptionHelpers.js) —
// api/ no puede importar de src/. Si cambia allá, cambiar aquí también.
const TRIAL_DURATION_DAYS = 30

// ── Ciclo de vida de un pago ───────────────────────────────────────────────
// La regla que sostiene este archivo: un pago solo se da por recibido cuando
// la pasarela confirma que el dinero llegó. ABRIR un checkout no es pagar y
// no debe parecerlo en ninguna pantalla del docente.
//
//   iniciado   → el docente abrió el checkout de la pasarela. No hay dinero.
//                No aparece en su historial de pagos.
//   en_proceso → la pasarela tomó la orden pero no la ha acreditado (efectivo
//                en OXXO, tarjeta en revisión del banco). Sigue sin haber pago.
//   pendiente  → una transferencia que el docente DICE haber hecho, esperando
//                que el admin la verifique. Solo el flujo de transferencia.
//   completado → confirmado. El ÚNICO estado que activa una suscripción.
//   rechazado  → la pasarela o el admin lo rechazaron/cancelaron.
export const PAYMENT_STATUS = {
  INICIADO: 'iniciado',
  EN_PROCESO: 'en_proceso',
  PENDIENTE: 'pendiente',
  COMPLETADO: 'completado',
  RECHAZADO: 'rechazado',
}

// Reads a plan from Firestore. The price ALWAYS comes from here, never from the
// client, so a user cannot pay less by tampering with the request.
export async function getPlan(planId) {
  const db = getDb()
  const snap = await db.collection('plans').doc(planId).get()
  if (!snap.exists) {
    const err = new Error('Plan no encontrado')
    err.status = 400
    throw err
  }
  return { id: snap.id, ...snap.data() }
}

function addPeriod(date, periodicidad) {
  const d = new Date(date)
  if (periodicidad === 'anual') {
    d.setFullYear(d.getFullYear() + 1)
  } else {
    d.setMonth(d.getMonth() + 1)
  }
  return d
}

// Hasta cuándo sigue vigente lo que el docente ya tenía ANTES de este pago
// (los días de prueba que le quedaban, o el vencimiento de un plan pagado
// previo) — o null si ya no le quedaba nada. Lo pagado nunca debe recortar
// días ya en curso: el nuevo periodo arranca ahí, no "ahora mismo".
function vigenciaPrevia(subscription) {
  if (!subscription) return null
  let fin
  if (subscription.status === 'trial') {
    const inicio = subscription.fechaInicio?.toDate?.() || null
    if (!inicio) return null
    fin = new Date(inicio)
    fin.setDate(fin.getDate() + TRIAL_DURATION_DAYS)
  } else {
    fin = subscription.fechaVencimiento?.toDate?.() || null
  }
  return fin && fin > new Date() ? fin : null
}

// Deja constancia de un estado NO final del pago sin activar nada: la pasarela
// sigue procesando, o rechazó/canceló. Sirve para que el registro guardado
// diga siempre lo que de verdad pasó y no lo que el docente quiso hacer.
// Nunca degrada un pago ya confirmado.
export async function markPaymentStatus(paymentId, status, gatewayData = {}) {
  const db = getDb()
  const payRef = db.collection('payments').doc(paymentId)
  const paySnap = await payRef.get()
  if (!paySnap.exists) return { updated: false, reason: 'not_found' }
  if (paySnap.data().status === PAYMENT_STATUS.COMPLETADO) {
    return { updated: false, reason: 'already_completed' }
  }

  await payRef.update({
    status,
    gateway: gatewayData,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return { updated: true }
}

// Marks a payment as completed and activates its subscription. Es el ÚNICO
// camino que puede poner una suscripción en 'activa', y solo debe llamarse
// cuando la pasarela YA confirmó los fondos — nunca desde un callback del
// cliente, una URL de retorno ni un clic en un botón.
//
// Idempotent: if the payment is already completed, it does nothing (webhooks
// and capture calls can both fire for the same payment).
//
// `paidAmount` (cuando la pasarela lo reporta) se coteja contra el precio del
// plan para que un pago incompleto no compre un periodo entero.
export async function completePayment(paymentId, gatewayData = {}, { paidAmount } = {}) {
  const db = getDb()
  const payRef = db.collection('payments').doc(paymentId)
  const paySnap = await payRef.get()
  if (!paySnap.exists) {
    const err = new Error('Pago no encontrado')
    err.status = 404
    throw err
  }
  const payment = paySnap.data()
  if (payment.status === PAYMENT_STATUS.COMPLETADO) {
    return { completed: true, alreadyDone: true }
  }

  const plan = await getPlan(payment.planId)
  const esperado = Number(plan.precio) || 0
  // La tolerancia cubre el redondeo de la pasarela, nada más.
  if (paidAmount != null && Number(paidAmount) < esperado - 0.01) {
    await payRef.update({
      status: PAYMENT_STATUS.EN_PROCESO,
      gateway: { ...gatewayData, montoRecibido: Number(paidAmount), montoEsperado: esperado },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    return { completed: false, reason: 'amount_mismatch' }
  }

  let subscription = null
  if (payment.subscriptionId) {
    const subSnap = await db.collection('subscriptions').doc(payment.subscriptionId).get()
    subscription = subSnap.exists ? subSnap.data() : null
  }
  const inicio = vigenciaPrevia(subscription) || new Date()
  const vencimiento = addPeriod(inicio, plan.periodicidad || 'mensual')

  await payRef.update({
    status: PAYMENT_STATUS.COMPLETADO,
    gateway: gatewayData,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  const datosSub = {
    status: 'activa',
    planId: payment.planId,
    fechaInicio: admin.firestore.Timestamp.fromDate(inicio),
    fechaVencimiento: admin.firestore.Timestamp.fromDate(vencimiento),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }

  if (payment.subscriptionId) {
    await db.collection('subscriptions').doc(payment.subscriptionId).update(datosSub)
  } else {
    // Abrir el checkout ya no crea suscripción (ver startPayment), así que un
    // docente que paga sin tener ninguna la estrena aquí, con el dinero ya
    // confirmado.
    const ref = await db.collection('subscriptions').add({
      ...datosSub,
      docenteId: payment.docenteId,
      escuelaId: payment.escuelaId || '',
      schoolName: payment.schoolName || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    await payRef.update({ subscriptionId: ref.id })
  }

  return { completed: true, alreadyDone: false }
}

// Records one automatic recurring charge for a Mercado Pago subscription
// (preapproval). Unlike completePayment(), there is no pre-created `payments`
// doc for this cycle — MP charges the card on its own schedule and just
// notifies us — so this creates the payment doc itself for the record.
// Idempotent on mpPaymentId so retried webhook deliveries don't double-extend.
export async function recordRecurringCharge(mpPreapprovalId, gatewayData = {}) {
  const db = getDb()
  const subsSnap = await db
    .collection('subscriptions')
    .where('mpPreapprovalId', '==', mpPreapprovalId)
    .limit(1)
    .get()
  if (subsSnap.empty) {
    const err = new Error('Suscripción no encontrada para ese preapproval')
    err.status = 404
    throw err
  }
  const subDoc = subsSnap.docs[0]
  const subscription = subDoc.data()

  const dupSnap = await db
    .collection('payments')
    .where('subscriptionId', '==', subDoc.id)
    .where('mpPaymentId', '==', gatewayData.mpPaymentId)
    .limit(1)
    .get()
  if (!dupSnap.empty) return { alreadyDone: true }

  // En el PRIMER cobro `subscription.planId` todavía está vacío — nunca lo
  // pone startSubscription/create-subscription.js a propósito, para no
  // adelantar el mismo "planId presente = pago YA aprobado" que se cuida en
  // el resto del proyecto (ver nuncaAprobado en Profile.jsx). El plan que se
  // está domiciliando vive mientras tanto en `mpPlanId` (lo guarda
  // create-subscription.js junto con el mpPreapprovalId). Sin este fallback,
  // getPlan('') truena ("Plan no encontrado") y el webhook le devuelve 500 a
  // Mercado Pago: la tarjeta ya se cobró pero la suscripción nunca se activa.
  const plan = await getPlan(subscription.planId || subscription.mpPlanId)
  // Solo aplica en el primer cobro de la preapproval (la suscripción todavía
  // podía estar en trial/pendiente_pago); en renovaciones posteriores ya está
  // 'activa' y su vencimiento previo es, en la práctica, "ahora".
  const inicio = vigenciaPrevia(subscription) || new Date()
  const vencimiento = addPeriod(inicio, plan.periodicidad || 'mensual')

  await db.collection('payments').add({
    docenteId: subscription.docenteId,
    subscriptionId: subDoc.id,
    planId: plan.id,
    escuelaId: subscription.escuelaId || '',
    monto: plan.precio || 0,
    metodo: 'mercadopago',
    origen: 'webhook_recurrente',
    status: 'completado',
    gateway: gatewayData,
    mpPaymentId: gatewayData.mpPaymentId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  await subDoc.ref.update({
    status: 'activa',
    // Recién aquí, con el dinero ya confirmado, se pone `planId` — es la
    // misma señal que usa completePayment() para el resto de la app.
    planId: plan.id,
    fechaInicio: admin.firestore.Timestamp.fromDate(inicio),
    fechaVencimiento: admin.firestore.Timestamp.fromDate(vencimiento),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  return { alreadyDone: false }
}

// Id de la suscripción más reciente del docente, o null si no tiene ninguna.
// Deliberadamente NO la modifica: abrir un checkout no es un evento de la
// suscripción.
async function subscripcionActualId(db, uid) {
  const subsSnap = await db.collection('subscriptions').where('docenteId', '==', uid).get()
  if (subsSnap.empty) return null
  const docs = subsSnap.docs.sort((a, b) => {
    const ta = a.data().updatedAt?.toMillis?.() || 0
    const tb = b.data().updatedAt?.toMillis?.() || 0
    return tb - ta
  })
  return docs[0].id
}

// Abre un checkout: deja constancia de la INTENCIÓN de pagar y nada más.
//
// A propósito NO escribe en `subscriptions`. Presionar "Pagar" tiene que dejar
// el plan vigente (prueba / activa / vencida) tal cual estaba: antes lo movía a
// 'pendiente_pago' y le ponía `planId`, así que con solo abrir la pasarela —sin
// pagar un peso— el perfil decía "Tu pago está en revisión, lo aprobamos en 12
// horas", desaparecía el botón de pagar (canRenew) y "Tu plan cubre del X al Y"
// se calculaba como si ya hubiera un plan comprado.
//
// Usado por los flujos de pago único (Checkout Pro, PayPal) donde el
// webhook/aprobación completa ESTE MISMO doc de payments.
// Returns { subscriptionId, paymentId, plan }.
export async function startPayment({ uid, planId, escuelaId, schoolName, metodo }) {
  const db = getDb()
  const plan = await getPlan(planId)
  // Puede ser null: completePayment crea la suscripción cuando el pago se
  // confirma de verdad.
  const subscriptionId = await subscripcionActualId(db, uid)

  const payRef = await db.collection('payments').add({
    docenteId: uid,
    subscriptionId,
    planId,
    escuelaId: escuelaId || '',
    schoolName: schoolName || '',
    monto: plan.precio || 0,
    metodo,
    status: PAYMENT_STATUS.INICIADO,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  return { subscriptionId, paymentId: payRef.id, plan }
}

// Creates (or reuses) a pending subscription for a recurring Mercado Pago
// preapproval. Unlike startPayment(), it does NOT create a `payments` doc —
// every charge (first authorization and every renewal) arrives later via
// recordRecurringCharge(), which creates its own payment record. Creating a
// stub payment here would leave it stuck in 'pendiente' forever, since
// nothing ever completes that specific doc.
// A diferencia de startPayment sí necesita que el doc de suscripción EXISTA:
// create-subscription.js le guarda encima el `mpPreapprovalId`, y el primer
// cobro (recordRecurringCharge) busca la suscripción justamente por ese campo.
// Pero tampoco toca `status` ni `planId` de una suscripción que ya existía:
// autorizar la domiciliación no es todavía un cobro.
// Returns { subscriptionId, plan }.
export async function startSubscription({ uid, planId, escuelaId, schoolName }) {
  const db = getDb()
  const plan = await getPlan(planId)
  const existente = await subscripcionActualId(db, uid)
  if (existente) return { subscriptionId: existente, plan }

  // Defensivo: todo docente estrena una prueba al registrarse (y useSubscription
  // la repara si falta), así que en la práctica no se llega aquí. Sin `planId`
  // a propósito — en todo el proyecto `planId` presente significa "pago YA
  // aprobado" (ver Profile.jsx `nuncaAprobado`).
  const ref = await db.collection('subscriptions').add({
    docenteId: uid,
    escuelaId: escuelaId || '',
    schoolName: schoolName || '',
    status: 'pendiente_pago',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return { subscriptionId: ref.id, plan }
}
