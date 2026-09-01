// Descargar un archivo de Cloudinary — en la web y en la app, desde un solo
// lugar (1-sep-2026).
//
// Las dos plataformas necesitan mecanismos distintos y eso ya había empezado
// a duplicarse:
//
//   · WEB — un <a download> hacia la URL con `fl_attachment` (ver downloadUrl
//     en utils/cloudinary.js), que es lo que hace que Cloudinary responda con
//     Content-Disposition: attachment en vez de abrir el archivo.
//   · APP — un WebView de Capacitor NO descarga por su cuenta: un <a download>
//     ahí es inerte, no falla ni avisa, simplemente no pasa nada. Se baja el
//     archivo y se entrega por el panel Compartir de Android, que además de
//     compartir es su "abrir con" (Word, Drive, WPS…). Ver abrirArchivoNativo
//     en utils/nativeSave.js, el mismo camino que ya usan las entregas de los
//     alumnos en ActivityPage.
//
// En los dos casos se entrega el archivo ORIGINAL tal como lo subió el
// docente: no se convierte ni se reconstruye nada.
import { useState } from 'react'
import { Download } from 'lucide-react'
import { downloadUrl } from '../utils/cloudinary'
import { IS_NATIVE_APP } from '../utils/platform'
import { abrirArchivoNativo } from '../utils/nativeSave'
import Spinner from './Spinner'

export default function BotonDescargarArchivo({
  url, nombre, etiqueta = 'Descargar', className, iconSize = 14, onError, title,
}) {
  const [descargando, setDescargando] = useState(false)
  if (!url) return null

  async function descargarEnApp() {
    setDescargando(true)
    try {
      await abrirArchivoNativo(url, nombre)
    } catch (err) {
      onError?.('No se pudo descargar el archivo: ' + err.message)
    } finally {
      setDescargando(false)
    }
  }

  if (IS_NATIVE_APP) {
    return (
      <button
        type="button"
        onClick={descargarEnApp}
        disabled={descargando}
        className={className}
        title={title}
        aria-label={etiqueta || 'Descargar'}
      >
        {descargando ? <Spinner size="sm" /> : <Download size={iconSize} />}
        {etiqueta}
      </button>
    )
  }

  return (
    <a
      href={downloadUrl(url, nombre)}
      download={nombre}
      rel="noreferrer"
      className={className}
      title={title}
      aria-label={etiqueta || 'Descargar'}
    >
      <Download size={iconSize} />
      {etiqueta}
    </a>
  )
}
