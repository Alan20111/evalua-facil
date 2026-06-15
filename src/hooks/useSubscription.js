import { useState, useEffect, useCallback } from 'react'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'

export function useSubscription() {
  const { currentUser } = useAuth()
  const [subscription, setSubscription] = useState(null)
  const [plans, setPlans] = useState([])
  const [recentPayments, setRecentPayments] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!currentUser) {
      setSubscription(null)
      setPlans([])
      setRecentPayments([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [plansSnap, subsSnap, paymentsSnap] = await Promise.all([
        getDocs(query(collection(db, 'plans'), where('activo', '==', true))),
        getDocs(
          query(
            collection(db, 'subscriptions'),
            where('docenteId', '==', currentUser.uid),
            orderBy('updatedAt', 'desc'),
            limit(1)
          )
        ).catch(() =>
          getDocs(query(collection(db, 'subscriptions'), where('docenteId', '==', currentUser.uid)))
        ),
        getDocs(
          query(
            collection(db, 'payments'),
            where('docenteId', '==', currentUser.uid),
            orderBy('createdAt', 'desc'),
            limit(3)
          )
        ).catch(() =>
          getDocs(query(collection(db, 'payments'), where('docenteId', '==', currentUser.uid)))
        ),
      ])

      const plansList = plansSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.orden || 0) - (b.orden || 0))
      setPlans(plansList)

      const subs = subsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      subs.sort((a, b) => {
        const ta = a.updatedAt?.toMillis?.() || 0
        const tb = b.updatedAt?.toMillis?.() || 0
        return tb - ta
      })
      setSubscription(subs[0] || null)

      const payments = paymentsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() || 0
          const tb = b.createdAt?.toMillis?.() || 0
          return tb - ta
        })
        .slice(0, 3)
      setRecentPayments(payments)
    } finally {
      setLoading(false)
    }
  }, [currentUser])

  useEffect(() => {
    load()
  }, [load])

  const currentPlan = subscription
    ? plans.find((p) => p.id === subscription.planId) ||
      (subscription.planId ? { id: subscription.planId, nombre: subscription.planId } : null)
    : null

  return {
    subscription,
    currentPlan,
    plans,
    recentPayments,
    loading,
    refresh: load,
  }
}
