import { useState, useEffect, useCallback } from 'react'
import { collection, query, where, getDocs, doc, setDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { calcTrialEnd, esTransferenciaEnRevision, PAYMENT_STATUS } from '../utils/subscriptionHelpers'

// Regla vigente: TODO docente tiene, como mínimo, una prueba de 30 días. La
// única excepción es la Cortesía, que el administrador otorga a mano.
//
// Hacía falta repararlo porque el esquema viejo daba acceso ILIMITADO a quien
// no tuviera ningún documento de suscripción: `isSubscriptionExpired(null)` es
// false, así que ese docente trabajaba sin vencimiento posible. La
// autorreparación que ya existía en AuthContext solo cubre el caso de que
// falte el PERFIL (users/{uid}), no la suscripción.
//
// El id es determinista para que dos pestañas abiertas a la vez no creen dos
// suscripciones para la misma persona.
//
// Consecuencia buscada: ELIMINAR una suscripción desde el panel la vuelve a
// crear como prueba en el siguiente inicio de sesión. Para dejar sin servicio
// a un docente hay que CANCELARLA, que sí persiste (una cancelada existe, así
// que no dispara esta reparación).
async function crearPruebaInicial(uid) {
  const inicio = new Date()
  const datos = {
    docenteId: uid,
    planId: '',
    status: 'trial',
    fechaInicio: Timestamp.fromDate(inicio),
    fechaVencimiento: Timestamp.fromDate(calcTrialEnd(inicio)),
    createdAt: Timestamp.fromDate(inicio),
    updatedAt: Timestamp.fromDate(inicio),
  }
  const id = `trial-${uid}`
  await setDoc(doc(db, 'subscriptions', id), datos)
  return { id, ...datos }
}

export function useSubscription() {
  const { currentUser, userProfile } = useAuth()
  // Extraído a una constante: con `userProfile?.role` dentro del arreglo de
  // dependencias, el compilador de React no puede conservar la memoización.
  const rol = userProfile?.role
  const [subscription, setSubscription] = useState(null)
  const [recentPayments, setRecentPayments] = useState([])
  // Una transferencia que el docente declaró y el admin sí está revisando.
  const [transferenciaEnRevision, setTransferenciaEnRevision] = useState(null)
  // Un cobro por pasarela que ya se autorizó pero todavía no se acredita.
  const [pagoLiquidando, setPagoLiquidando] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!currentUser) {
      setSubscription(null)
      setRecentPayments([])
      setTransferenciaEnRevision(null)
      setPagoLiquidando(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [subsSnap, paymentsSnap] = await Promise.all([
        getDocs(query(collection(db, 'subscriptions'), where('docenteId', '==', currentUser.uid))),
        getDocs(query(collection(db, 'payments'), where('docenteId', '==', currentUser.uid))),
      ])

      const subs = subsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.updatedAt?.toMillis?.() || 0
          const tb = b.updatedAt?.toMillis?.() || 0
          return tb - ta
        })
      // Solo se repara cuando la lectura FUNCIONÓ y de verdad no hay ninguna.
      // Si la consulta falla, el catch de abajo deja `null` a propósito y se
      // conserva el fallo hacia el lado seguro: un error de red no debe dejar
      // a un docente sin poder calificar ni pasar lista.
      let actual = subs[0] || null
      if (!actual && rol === 'docente') {
        actual = await crearPruebaInicial(currentUser.uid).catch(() => null)
      }
      setSubscription(actual)

      const payments = paymentsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() || 0
          const tb = b.createdAt?.toMillis?.() || 0
          return tb - ta
        })

      // Un checkout que se abrió y nunca se pagó no es parte del historial:
      // mostrarlo daría a entender que hubo un movimiento de dinero.
      const reales = payments.filter((p) => p.status !== PAYMENT_STATUS.INICIADO)
      setRecentPayments(reales.slice(0, 3))
      setTransferenciaEnRevision(reales.find(esTransferenciaEnRevision) || null)
      // Solo el intento más reciente puede estar "liquidándose". Un vale de
      // efectivo viejo que el docente abandonó no debe seguir anunciando que
      // hay un pago en camino.
      setPagoLiquidando(reales[0]?.status === PAYMENT_STATUS.EN_PROCESO ? reales[0] : null)
    } catch {
      // A failed/denied read must never crash the layout that wraps every teacher page.
      // Treat it as "no subscription info" rather than letting the error propagate.
      setSubscription(null)
      setRecentPayments([])
      setTransferenciaEnRevision(null)
      setPagoLiquidando(null)
    } finally {
      setLoading(false)
    }
  }, [currentUser, rol])

  useEffect(() => {
    load()
  }, [load])

  return {
    subscription,
    recentPayments,
    transferenciaEnRevision,
    pagoLiquidando,
    loading,
    refresh: load,
  }
}
