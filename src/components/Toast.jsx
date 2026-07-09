import { useState, useCallback, createContext, useContext } from 'react'
import { CheckCircle, XCircle, AlertTriangle, X } from 'lucide-react'
import { playAlertSound } from '../utils/notify'

const ToastContext = createContext(null)

const STYLES = {
  success: { bg: 'bg-emerald-500', Icon: CheckCircle },
  warning: { bg: 'bg-amber-500', Icon: AlertTriangle },
  error: { bg: 'bg-red-500', Icon: XCircle },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const show = useCallback((msg, type = 'success') => {
    const id = Date.now()
    setToasts((t) => [...t, { id, msg, type }])
    // Errors and warnings also SOUND — the visual alone is easy to miss
    if (type === 'error' || type === 'warning') playAlertSound()
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => {
          const { bg, Icon } = STYLES[t.type] || STYLES.success
          return (
            <div
              key={t.id}
              className={`flex items-center gap-3 rounded px-4 py-2.5 shadow-lg text-white text-sm ${bg}`}
            >
              <Icon size={20} />
              <span className="flex-1">{t.msg}</span>
              <button type="button" aria-label="Cerrar" onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>
                <X size={16} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
