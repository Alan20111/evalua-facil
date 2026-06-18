import { useState, useEffect, useCallback } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'

// Default shape used when no config doc exists yet (first run).
// Only PUBLIC, displayable data lives here and in Firestore.
// Secrets (MP access token, PayPal secret) live in Vercel env vars.
export const DEFAULT_PAYMENT_CONFIG = {
  moneda: 'MXN',
  mercadoPago: { enabled: false, publicKey: '' },
  paypal: { enabled: false, clientId: '' },
  transferencia: {
    enabled: false,
    banco: '',
    titular: '',
    cuenta: '',
    clabe: '',
    nota: 'Indica tu usuario o correo en el concepto de la transferencia.',
  },
}

const CONFIG_REF = ['config', 'payments']

export function usePaymentConfig() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await getDoc(doc(db, ...CONFIG_REF))
      if (snap.exists()) {
        const data = snap.data()
        setConfig({
          ...DEFAULT_PAYMENT_CONFIG,
          ...data,
          mercadoPago: { ...DEFAULT_PAYMENT_CONFIG.mercadoPago, ...(data.mercadoPago || {}) },
          paypal: { ...DEFAULT_PAYMENT_CONFIG.paypal, ...(data.paypal || {}) },
          transferencia: { ...DEFAULT_PAYMENT_CONFIG.transferencia, ...(data.transferencia || {}) },
        })
      } else {
        setConfig(DEFAULT_PAYMENT_CONFIG)
      }
    } catch {
      setConfig(DEFAULT_PAYMENT_CONFIG)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { config, loading, refresh: load }
}
