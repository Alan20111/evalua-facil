import { useEffect } from 'react'
import { Download, ShieldCheck, Smartphone, TriangleAlert } from 'lucide-react'
import EFLogo from '../components/EFLogo'

// Página de descarga directa del APK de Android — ruta NO listada.
// Solo se llega con el link exacto (ver la constante RUTA_DESCARGA_APK en App.jsx);
// no aparece en ningún menú, nav ni sitemap, y se marca noindex para que no la
// indexen los buscadores.
//
// ⚠️ Al publicar una versión nueva hay que actualizar DOS cosas:
//   1. el archivo public/descargas/evalua-facil.apk
//   2. las constantes VERSION / FECHA de aquí abajo
const VERSION = '1.0.2'
const FECHA = '19 de agosto de 2026'
const ARCHIVO = '/descargas/evalua-facil.apk'
const PESO = '8.8 MB'

function Paso({ numero, titulo, children }) {
  return (
    <li className="flex gap-3">
      <span className="flex-none w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold grid place-items-center">
        {numero}
      </span>
      <div className="flex-1 -mt-0.5">
        <p className="text-sm font-semibold text-on-surface">{titulo}</p>
        {children && <p className="text-sm text-muted leading-relaxed mt-1">{children}</p>}
      </div>
    </li>
  )
}

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
    <div className="min-h-screen bg-surface py-10 px-4">
      <div className="max-w-lg mx-auto">
        <EFLogo className="w-44 h-auto mb-8" />

        <h1 className="text-2xl font-bold text-on-surface">Descargar Evalúa Fácil para Android</h1>
        <p className="text-sm text-muted leading-relaxed mt-2">
          Versión de prueba {VERSION} · {FECHA} · {PESO}
        </p>

        <a
          href={ARCHIVO}
          download="evalua-facil.apk"
          className="mt-6 w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-xl py-3.5 transition-colors"
        >
          <Download className="w-5 h-5" />
          Descargar la app
        </a>

        <p className="text-xs text-muted text-center mt-3">
          Ábrelo desde tu celular Android. No funciona en iPhone ni en computadora.
        </p>

        <div className="mt-8 bg-surface-card rounded-2xl p-5">
          <h2 className="flex items-center gap-2 text-base font-bold text-on-surface">
            <Smartphone className="w-4 h-4 text-blue-600" />
            Cómo instalarla
          </h2>
          <ol className="mt-4 space-y-4">
            <Paso numero="1" titulo="Toca “Descargar la app”">
              El archivo se guarda en tus descargas. Si el navegador te pregunta si
              quieres conservarlo, di que sí.
            </Paso>
            <Paso numero="2" titulo="Abre el archivo descargado">
              Baja la barra de notificaciones y tócalo, o búscalo en la app de Archivos,
              en la carpeta Descargas.
            </Paso>
            <Paso numero="3" titulo="Permite la instalación">
              Android te va a preguntar si permites instalar apps desde esta fuente.
              Acepta y regresa. Es una sola vez.
            </Paso>
            <Paso numero="4" titulo="Toca Instalar y listo">
              Al terminar te aparece Evalúa Fácil junto a tus demás apps.
            </Paso>
          </ol>
        </div>

        <div className="mt-4 bg-surface-container rounded-2xl p-5">
          <h2 className="flex items-center gap-2 text-base font-bold text-on-surface">
            <ShieldCheck className="w-4 h-4 text-blue-600" />
            ¿Es seguro?
          </h2>
          <p className="text-sm text-muted leading-relaxed mt-2">
            Sí. Es la app oficial de Evalúa Fácil, firmada con nuestro certificado. El
            aviso de Android aparece solo porque la estás instalando directo desde aquí y
            no desde la Play Store, que es lo normal en una versión de prueba.
          </p>
        </div>

        <div className="mt-4 flex gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <TriangleAlert className="w-4 h-4 text-amber-600 flex-none mt-0.5" />
          <p className="text-sm text-amber-900 leading-relaxed">
            Cuando Evalúa Fácil salga en la Play Store, vas a tener que desinstalar esta
            versión de prueba antes de instalar la de la tienda. Solo tendrás que volver a
            iniciar sesión; no se pierde nada de tu información.
          </p>
        </div>

        <p className="text-xs text-muted text-center mt-8">
          ¿Algún problema? Escríbenos a soporte@evaluafacil.mx
        </p>
      </div>
    </div>
  )
}
