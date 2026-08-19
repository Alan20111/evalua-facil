import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, Smartphone, Link2Off } from 'lucide-react'
import EFLogo from '../components/EFLogo'
import Spinner from '../components/Spinner'
import { obtenerLink } from '../utils/descargaLinks'
import { downloadUrl } from '../utils/cloudinary'

// Página pública de descarga del APK de Android — ruta NO listada.
// El slug viene de la URL y se resuelve contra `downloadLinks`; los links se
// generan desde el panel de admin → pestaña Descargas. No aparece en ningún
// menú ni nav, y va con noindex para que no la indexen los buscadores.

function Marco({ children }) {
  return (
    <div className="min-h-dvh bg-surface flex items-center justify-center px-4 py-12">
      <div className="relative w-full max-w-sm">
        {/* Halo de acento detrás de la tarjeta — puro adorno, no interactivo */}
        <div
          aria-hidden="true"
          className="absolute -inset-6 rounded-card opacity-60 blur-2xl"
          style={{ background: 'var(--accent-tint)' }}
        />
        <div className="relative bg-surface-card rounded-card shadow-card px-7 py-9 text-center">
          {children}
        </div>
      </div>
    </div>
  )
}

export default function DescargaApp() {
  const { slug } = useParams()
  const [link, setLink] = useState(null)
  const [cargando, setCargando] = useState(true)

  // noindex: esta página no debe salir en Google.
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => { document.head.removeChild(meta) }
  }, [])

  useEffect(() => {
    let vivo = true
    obtenerLink(slug)
      .then((res) => { if (vivo) setLink(res) })
      .catch(() => { if (vivo) setLink(null) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [slug])

  if (cargando) {
    return (
      <Marco>
        <div className="py-6 flex justify-center"><Spinner /></div>
      </Marco>
    )
  }

  // Mismo mensaje para "no existe" y "desactivado": quien tenga un link viejo
  // no gana nada con saber cuál de los dos casos es.
  if (!link || link.activo === false) {
    return (
      <Marco>
        <EFLogo className="w-52 h-auto mx-auto" />
        <Link2Off className="w-9 h-9 text-slate-300 mx-auto mt-8" />
        <p className="mt-4 text-lg font-bold text-on-surface">
          Este enlace ya no está disponible
        </p>
        <p className="mt-2 text-sm text-muted leading-relaxed">
          Pídele a quien te lo compartió que te mande el más reciente.
        </p>
      </Marco>
    )
  }

  // Cloudinary necesita fl_attachment para que el navegador baje el archivo en
  // vez de intentar abrirlo; los del repo (/descargas/…) pasan derecho porque
  // downloadUrl solo reescribe URLs de Cloudinary.
  const href = downloadUrl(link.url, 'evalua-facil')

  return (
    <Marco>
      <EFLogo className="w-52 h-auto mx-auto" />

      <div className="mt-8">
        <span className="inline-flex items-center gap-1.5 rounded-pill bg-accent-light text-accent text-xs font-bold uppercase tracking-wide px-3 py-1">
          <Smartphone className="w-3.5 h-3.5" />
          Android · Versión {link.version}
        </span>
        <p className="mt-4 text-3xl font-bold text-on-surface leading-tight">
          {link.fecha}
        </p>
      </div>

      <a
        href={href}
        download="evalua-facil.apk"
        className="mt-8 w-full flex items-center justify-center gap-2 py-3.5 px-4 bg-accent hover:bg-accent-hover text-white font-semibold rounded shadow-card transition-colors"
      >
        <Download className="w-5 h-5" />
        Descargar la app
      </a>

      <p className="mt-4 text-xs text-slate-400">
        Ábrelo desde tu celular Android
      </p>
    </Marco>
  )
}
