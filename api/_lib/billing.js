import { admin, getDb } from './firebaseAdmin.js'

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

// Marks a payment as completed and activates its subscription.
// Idempotent: if the payment is already completed, it does nothing (webhooks
// and capture calls can both fire for the same payment).
export async function completePayment(paymentId, gatewayData = {}) {
  const db = getDb()
  const payRef = db.collection('payments').doc(paymentId)
  const paySnap = await payRef.get()
  if (!paySnap.exists) {
    const err = new Error('Pago no encontrado')
    err.status = 404
    throw err
  }
  const payment = paySnap.data()
  if (payment.status === 'completado') return { alreadyDone: true }

  const plan = await getPlan(payment.planId)
  const inicio = new Date()
  const vencimiento = addPeriod(inicio, plan.periodicidad || 'mensual')

  await payRef.update({
    status: 'completado',
    gateway: gatewayData,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  if (payment.subscriptionId) {
    await db.collection('subscriptions').doc(payment.subscriptionId).update({
      status: 'activa',
      planId: payment.planId,
      fechaInicio: admin.firestore.Timestamp.fromDate(inicio),
      fechaVencimiento: admin.firestore.Timestamp.fromDate(vencimiento),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  return { alreadyDone: false }
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

  const plan = await getPlan(subscription.planId)
  const inicio = new Date()
  const vencimiento = addPeriod(inicio, plan.periodicidad || 'mensual')

  await db.collection('payments').add({
    docenteId: subscription.docenteId,
    subscriptionId: subDoc.id,
    planId: subscription.planId,
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
    fechaInicio: admin.firestore.Timestamp.fromDate(inicio),
    fechaVencimiento: admin.firestore.Timestamp.fromDate(vencimiento),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  return { alreadyDone: false }
}

// Reuses the teacher's most recent subscription if present, else creates one,
// moving it to 'pendiente_pago'. Shared by startPayment() and
// startSubscription() below.
async function upsertPendingSubscription(db, { uid, planId, escuelaId, schoolName }) {
  const subsSnap = await db
    .collection('subscriptions')
    .where('docenteId', '==', uid)
    .get()
  if (!subsSnap.empty) {
    const docs = subsSnap.docs.sort((a, b) => {
      const ta = a.data().updatedAt?.toMillis?.() || 0
      const tb = b.data().updatedAt?.toMillis?.() || 0
      return tb - ta
    })
    const subscriptionId = docs[0].id
    await db.collection('subscriptions').doc(subscriptionId).update({
      planId,
      status: 'pendiente_pago',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    return subscriptionId
  }
  const ref = await db.collection('subscriptions').add({
    docenteId: uid,
    planId,
    escuelaId: escuelaId || '',
    schoolName: schoolName || '',
    status: 'pendiente_pago',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return ref.id
}

// Creates (or reuses) a pending subscription + a pending payment for a teacher.
// Used by one-time payment flows (Checkout Pro, PayPal, transferencia) where
// the webhook/approval completes THIS SAME payment doc.
// Returns { subscriptionId, paymentId, plan }.
export async function startPayment({ uid, planId, escuelaId, schoolName, metodo }) {
  const db = getDb()
  const plan = await getPlan(planId)
  const subscriptionId = await upsertPendingSubscription(db, { uid, planId, escuelaId, schoolName })

  const payRef = await db.collection('payments').add({
    docenteId: uid,
    subscriptionId,
    planId,
    escuelaId: escuelaId || '',
    monto: plan.precio || 0,
    metodo,
    status: 'pendiente',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  return { subscriptionId, paymentId: payRef.id, plan }
}

// Creates (or reuses) a pending subscription for a recurring Mercado Pago
// preapproval. Unlike startPayment(), it does NOT create a `payments` doc —
// every charge (first authorization and every renewal) arrives later via
// recordRecurringCharge(), which creates its own payment record. Creating a
// stub payment here would leave it stuck in 'pendiente' forever, since
// nothing ever completes that specific doc.
// Returns { subscriptionId, plan }.
export async function startSubscription({ uid, planId, escuelaId, schoolName }) {
  const db = getDb()
  const plan = await getPlan(planId)
  const subscriptionId = await upsertPendingSubscription(db, { uid, planId, escuelaId, schoolName })
  return { subscriptionId, plan }
}
