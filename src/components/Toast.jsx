import { useState, useCallback, useRef, createContext, useContext } from 'react'
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
  // Contador propio en vez de Date.now(): dos avisos disparados en el mismo
  // milisegundo (p. ej. "Cambios guardados" + "avisa a tus estudiantes" al
  // guardar una evaluación ya publicada) compartían id — React se quejaba de
  // la key repetida y el primer temporizador borraba los dos, así que el
  // segundo aviso desaparecía antes de leerse.
  const nextId = useRef(0)

  const show = useCallback((msg, type = 'success') => {
    const id = ++nextId.current
    setToasts((t) => [...t, { id, msg, type }])
    // Errors and warnings also SOUND — the visual alone is easy to miss
    if (type === 'error' || type === 'warning') playAlertSound()
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* aria-live="polite" en el contenedor + role específico por toast
          (docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 2, B4): antes un
          toast era puramente visual, invisible para un lector de pantalla.
          role="status" (success/warning) tiene aria-live="polite" implícito;
          role="alert" (error) tiene aria-live="assertive" implícito y
          interrumpe lo que el lector esté anunciando — apropiado para un
          error, no para una confirmación de "Cambios guardados". El
          aria-live del contenedor es redundante a propósito, como respaldo
          para lectores que no reconocen bien el rol en un nodo recién
          insertado. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed top-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100%-2rem)]"
        style={{ left: 'calc(var(--layout-w) - 20rem - 1rem)' }}
      >
        {toasts.map((t) => {
          const { bg, Icon } = STYLES[t.type] || STYLES.success
          // error: role="alert" en un <div> (no hay etiqueta nativa para ese
          // rol). success/warning: <output>, que ya trae role="status"
          // implícito — jsx-a11y/prefer-tag-over-role exige la etiqueta
          // nativa cuando existe, y aquí sí existe.
          const Tag = t.type === 'error' ? 'div' : 'output'
          return (
            <Tag
              key={t.id}
              role={t.type === 'error' ? 'alert' : undefined}
              className={`flex items-center gap-3 rounded px-4 py-2.5 shadow-lg text-white text-sm ${bg}`}
            >
              <Icon size={20} />
              <span className="flex-1">{t.msg}</span>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}
                className="p-2 -m-2 rounded transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <X size={16} />
              </button>
            </Tag>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
