// Muestra en pantalla el QR de descarga de la app (permanente: codifica
// siempre la misma URL — config/appDownload.js — así que la imagen generada
// es idéntica cada vez que se abre, sin ningún dato variable). Descargar el
// PDF sigue siendo opcional, desde el botón de aquí adentro.
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import Spinner from './Spinner'
import Modal from './ui/Modal'
import { useToast } from './Toast'
import { exportAppQRPDF } from '../utils/pdf'

export default function AppQRModal({ open, url, onClose }) {
  const toast = useToast()
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [descargando, setDescargando] = useState(false)

  // El QR es permanente (misma URL siempre) — una vez generado se conserva
  // en este estado y no se vuelve a pedir si el docente cierra y reabre el
  // modal en la misma sesión.
  useEffect(() => {
    if (!open || qrDataUrl) return undefined
    let cancelado = false
    import('qrcode').then((mod) => {
      const QRCode = mod.default
      return QRCode.toDataURL(url, { width: 600, margin: 1 })
    }).then((dataUrl) => {
      if (!cancelado) setQrDataUrl(dataUrl)
    }).catch(() => {
      if (!cancelado) toast('No se pudo generar el código QR', 'error')
    })
    return () => { cancelado = true }
  }, [open, url, qrDataUrl, toast])

  async function handleDescargarPDF() {
    setDescargando(true)
    try {
      await exportAppQRPDF({ url })
    } catch (err) {
      toast('No se pudo generar el PDF: ' + err.message, 'error')
    } finally {
      setDescargando(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Descarga la app de Evalúa Fácil" variant="centered" size="sm">
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted">Escanea este código con la cámara de tu teléfono</p>
        <div className="flex justify-center">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="Código QR para descargar la app de Evalúa Fácil" className="w-56 h-56" />
          ) : (
            <div className="w-56 h-56 flex items-center justify-center"><Spinner /></div>
          )}
        </div>
        <p className="text-sm text-accent font-semibold break-all">{url}</p>
        <button
          type="button"
          onClick={handleDescargarPDF}
          disabled={descargando}
          className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {descargando ? <Spinner size="sm" /> : <Download size={16} />}
          {descargando ? 'Generando…' : 'Descargar PDF'}
        </button>
      </div>
    </Modal>
  )
}
