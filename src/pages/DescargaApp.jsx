import { useEffect } from 'react'
import { Download, Smartphone } from 'lucide-react'
import EFLogo from '../components/EFLogo'

// Página de descarga directa del APK de Android — ruta NO listada.
// Solo se llega con el link exacto (ver la ruta /descarga/... en App.jsx);
// no aparece en ningún menú ni nav, y va con noindex para que no la indexen.
//
// ⚠️ Al publicar una versión nueva hay que actualizar DOS cosas:
//   1. el archivo public/descargas/evalua-facil.apk
//   2. las constantes VERSION / FECHA de aquí abajo
const VERSION = '1.0.2'
const FECHA = '19 de agosto de 2026'
const ARCHIVO = '/descargas/evalua-facil.apk'

export default function DescargaApp() {
  // noindex: esta página no debe salir en Google.
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => { document.head.removeChild(meta) }
  }, [])

  return (
    <div className="min-h-dvh bg-surface flex items-center justify-center px-4 py-12">
      {/* Halo de acento detrás de la tarjeta — puro adorno, no interactivo */}
      <div className="relative w-full max-w-sm">
        <div
          aria-hidden="true"
          className="absolute -inset-6 rounded-card opacity-60 blur-2xl"
          style={{ background: 'var(--accent-tint)' }}
        />

        <div className="relative bg-surface-card rounded-card shadow-card px-7 py-9 text-center">
          <EFLogo className="w-52 h-auto mx-auto" />

          <div className="mt-8">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-accent-light text-accent text-xs font-bold uppercase tracking-wide px-3 py-1">
              <Smartphone className="w-3.5 h-3.5" />
              Android · Versión {VERSION}
            </span>
            <p className="mt-4 text-3xl font-bold text-on-surface leading-tight">
              {FECHA}
            </p>
          </div>

          <a
            href={ARCHIVO}
            download="evalua-facil.apk"
            className="mt-8 w-full flex items-center justify-center gap-2 py-3.5 px-4 bg-accent hover:bg-accent-hover text-white font-semibold rounded shadow-card transition-colors"
          >
            <Download className="w-5 h-5" />
            Descargar la app
          </a>

          <p className="mt-4 text-xs text-slate-400">
            Ábrelo desde tu celular Android
          </p>
        </div>
      </div>
    </div>
  )
}
