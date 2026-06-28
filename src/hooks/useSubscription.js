import { useState, useEffect, useCallback } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'

export function useSubscription() {
  const { currentUser } = useAuth()
  const [subscription, setSubscription] = useState(null)
  const [recentPayments, setRecentPayments] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!currentUser) {
      setSubscription(null)
      setRecentPayments([])
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

  return {
    subscription,
    recentPayments,
    loading,
    refresh: load,
  }
}
