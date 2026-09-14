import { useState } from 'react'
import { QrCode } from 'lucide-react'
import AppQRModal from './AppQRModal'
import { APP_WEB_URL } from '../config/appDownload'

// Botón que abre el QR de acceso general a Evalúa Fácil en la web.
// Al escanearlo el usuario llega a https://www.evaluafacil.mx/ y desde
// ahí puede entrar como docente o como estudiante.
//
// NO es el QR de grupo (que usa accessCode y lleva a /activate/:code).
export default function AppQRButton({ className = '', children, iconSize = 17 }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <QrCode size={iconSize} className="flex-shrink-0" />
        {children}
      </button>
      <AppQRModal open={open} url={APP_WEB_URL} onClose={() => setOpen(false)} />
    </>
  )
}
