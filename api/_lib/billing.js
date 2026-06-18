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

// Creates (or reuses) a pending subscription + a pending payment for a teacher.
// Returns { subscriptionId, paymentId, plan }.
export async function startPayment({ uid, planId, escuelaId, schoolName, metodo }) {
  const db = getDb()
  const plan = await getPlan(planId)

  // Reuse the teacher's most recent subscription if present, else create one.
  const subsSnap = await db
    .collection('subscriptions')
    .where('docenteId', '==', uid)
    .get()
  let subscriptionId
  if (!subsSnap.empty) {
    const docs = subsSnap.docs.sort((a, b) => {
      const ta = a.data().updatedAt?.toMillis?.() || 0
      const tb = b.data().updatedAt?.toMillis?.() || 0
      return tb - ta
    })
    subscriptionId = docs[0].id
    await db.collection('subscriptions').doc(subscriptionId).update({
      planId,
      status: 'pendiente_pago',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  } else {
    const ref = await db.collection('subscriptions').add({
      docenteId: uid,
      planId,
      escuelaId: escuelaId || '',
      schoolName: schoolName || '',
      status: 'pendiente_pago',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    subscriptionId = ref.id
  }

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
