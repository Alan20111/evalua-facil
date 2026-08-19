import { useEffect } from 'react'
import { Download } from 'lucide-react'

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
    <div className="min-h-screen bg-surface flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">
          Versión {VERSION}
        </p>
        <p className="mt-2 text-4xl font-bold text-on-surface leading-tight">
          {FECHA}
        </p>

        <a
          href={ARCHIVO}
          download="evalua-facil.apk"
          className="mt-10 w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-xl py-4 transition-colors"
        >
          <Download className="w-5 h-5" />
          Descargar la app
        </a>
      </div>
    </div>
  )
}
