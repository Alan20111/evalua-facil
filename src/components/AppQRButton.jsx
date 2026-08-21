import { useState } from 'react'
import { QrCode } from 'lucide-react'
import { useToast } from './Toast'
import AppQRModal from './AppQRModal'
import { APP_DOWNLOAD_URL, APP_DOWNLOAD_READY } from '../config/appDownload'

// Botón que abre el QR para instalar la app en pantalla (AppQRModal), con
// opción de descargarlo en PDF desde ahí adentro.
//
// El QR es el MISMO en todos lados: la app es una sola y el perfil (docente o
// estudiante) se elige al abrirla. Por eso este botón vive en lugares
// generales —el menú lateral, el pie de la lista de asignaturas— y nunca
// dentro de una asignatura, donde daría a entender que es específico de ella.
//
// Mientras `APP_DOWNLOAD_URL` esté vacía el botón SÍ se ve, pero al tocarlo
// avisa que la descarga aún no se publica en vez de abrir un QR que no lleva
// a ningún lado. El día que se pegue la URL en config/appDownload.js, los
// tres botones empiezan a abrir el modal solos.
//
// `className` y `children` los pone cada lugar: el del menú lateral va en
// blanco sobre azul, los de las listas van como tarjeta.
export default function AppQRButton({ className = '', children, iconSize = 17 }) {
  const [open, setOpen] = useState(false)
  const toast = useToast()

  function handleClick() {
    if (!APP_DOWNLOAD_READY) {
      toast('La app todavía no se publica. En cuanto esté disponible, aquí podrás ver y descargar el código QR para compartirla.', 'warning')
      return
    }
    setOpen(true)
  }

  return (
    <>
      <button type="button" onClick={handleClick} className={className}>
        <QrCode size={iconSize} className="flex-shrink-0" />
        {children}
      </button>
      <AppQRModal open={open} url={APP_DOWNLOAD_URL} onClose={() => setOpen(false)} />
    </>
  )
}
