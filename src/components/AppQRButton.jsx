import { useState } from 'react'
import { QrCode } from 'lucide-react'
import Spinner from './Spinner'
import { useToast } from './Toast'
import { exportAppQRPDF } from '../utils/pdf'
import { APP_DOWNLOAD_URL, APP_DOWNLOAD_READY } from '../config/appDownload'

// Botón que descarga el PDF con el QR para instalar la app.
//
// El QR es el MISMO en todos lados: la app es una sola y el perfil (docente o
// estudiante) se elige al abrirla. Por eso este botón vive en lugares
// generales —el menú lateral, el pie de la lista de asignaturas— y nunca
// dentro de una asignatura, donde daría a entender que es específico de ella.
//
// Mientras `APP_DOWNLOAD_URL` esté vacía el botón SÍ se ve, pero al tocarlo
// avisa que la descarga aún no se publica en vez de generar un PDF con un QR
// que no lleva a ningún lado. El día que se pegue la URL en
// config/appDownload.js, los tres botones empiezan a generar el PDF solos.
//
// `className` y `children` los pone cada lugar: el del menú lateral va en
// blanco sobre azul, los de las listas van como tarjeta. La lógica —estado de
// carga, aviso de pendiente, errores— vive aquí una sola vez.
export default function AppQRButton({ className = '', children, iconSize = 17 }) {
  const [generating, setGenerating] = useState(false)
  const toast = useToast()

  async function handleClick() {
    if (!APP_DOWNLOAD_READY) {
      toast('La app todavía no se publica. En cuanto esté disponible, aquí podrás descargar el código QR para compartirla.', 'warning')
      return
    }
    setGenerating(true)
    try {
      await exportAppQRPDF({ url: APP_DOWNLOAD_URL })
    } catch (err) {
      toast('No se pudo generar el PDF: ' + err.message, 'error')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={generating} className={className}>
      {generating ? <Spinner size="sm" /> : <QrCode size={iconSize} className="flex-shrink-0" />}
      {children}
    </button>
  )
}
