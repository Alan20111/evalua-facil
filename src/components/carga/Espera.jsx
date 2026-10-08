// Espera con salida: el esqueleto de la pantalla y, si tarda demasiado, un
// aviso flotante con «Reintentar». Un esqueleto solo muestra la forma de la
// pantalla; no hace que los datos lleguen antes. Si la red se cae a medio
// camino, sin esta salida la persona veía huesos para siempre y tenía que
// cerrar la app (reporte oct-2026).
import { Component, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

const LIMITE_MS = 12000

function Reintentar({ texto }) {
  return (
    <output className="fixed inset-x-0 bottom-24 md:bottom-8 z-50 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 bg-surface-card rounded-full shadow-card pl-5 pr-2 py-2 animate-aviso">
        <span className="text-sm text-on-surface">{texto}</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-colors"
        >
          <RefreshCw size={14} aria-hidden="true" />
          Reintentar
        </button>
      </div>
    </output>
  )
}

export function Espera({ children }) {
  const [tarde, setTarde] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setTarde(true), LIMITE_MS)
    return () => clearTimeout(t)
  }, [])
  return (
    <>
      {children}
      {tarde && <Reintentar texto="Esto está tardando más de lo normal." />}
    </>
  )
}

// Si el código de una página no llega (sin red, o un deploy nuevo cambió los
// archivos y la recarga automática de main.jsx ya se usó), en vez de dejar la
// pantalla en blanco se ofrece reintentar.
export class CargaFallida extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-[60dvh] flex items-center justify-center px-4">
        <div className="bg-surface-card rounded-card shadow-card p-8 max-w-sm w-full text-center">
          <p className="text-on-surface font-semibold mb-2">No se pudo cargar esta pantalla</p>
          <p className="text-muted text-sm mb-4">Revisa tu conexión e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 bg-accent text-white text-sm font-semibold rounded-full hover:bg-accent-hover transition-colors"
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }
}
