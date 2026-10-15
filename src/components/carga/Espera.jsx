// Espera con salida: el esqueleto de la pantalla y, si tarda demasiado, un
// aviso flotante con «Reintentar». Un esqueleto solo muestra la forma de la
// pantalla; no hace que los datos lleguen antes. Si la red se cae a medio
// camino, sin esta salida la persona veía huesos para siempre y tenía que
// cerrar la app (reporte oct-2026).
import { Component, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '../ui'
import { ICONO } from '../../config/iconos'
import { reportarError } from '../../utils/registroErrores'

const LIMITE_MS = 12000

function Reintentar({ texto }) {
  return (
    <output className="fixed inset-x-0 bottom-24 md:bottom-8 z-50 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 bg-surface-card rounded-full shadow-card pl-5 pr-2 py-2 animate-aviso">
        <span className="text-sm text-on-surface">{texto}</span>
        <Button
          onClick={() => window.location.reload()}>
          <RefreshCw size={ICONO.xs} aria-hidden="true" />
          Reintentar
        </Button>
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

// Límite de errores de las pantallas. Dos casos:
//  · el código de la página no llega (sin red, o un deploy nuevo cambió los
//    archivos y la recarga automática de main.jsx ya se usó);
//  · la pantalla truena al dibujarse (un error del código).
// En los dos, en vez de dejar la pantalla en blanco se ofrece reintentar, y el
// error queda en el registro (utils/registroErrores.js, O3 del plan de Play).
const ARCHIVO_NO_LLEGO = /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i

export class CargaFallida extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    reportarError(error, { tipo: 'render', pilaComponentes: info?.componentStack || '' })
  }
  render() {
    if (!this.state.error) return this.props.children
    const deRed = ARCHIVO_NO_LLEGO.test(String(this.state.error?.message || ''))
    return (
      <div className="min-h-[60dvh] flex items-center justify-center px-4">
        <div className="bg-surface-card rounded-card shadow-card p-8 max-w-sm w-full text-center">
          <p className="text-on-surface font-semibold mb-2">{deRed ? 'No se pudo cargar esta pantalla' : 'Algo salió mal en esta pantalla'}</p>
          <p className="text-muted text-sm mb-4">{deRed ? 'Revisa tu conexión e intenta de nuevo.' : 'El error quedó registrado. Intenta de nuevo.'}</p>
          <Button onClick={() => window.location.reload()}>Reintentar</Button>
        </div>
      </div>
    )
  }
}
