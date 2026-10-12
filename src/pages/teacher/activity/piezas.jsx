// Piezas de ActivityPage.jsx que viven fuera del componente principal.
// Salieron tal cual en la fase 5 de PLAN_NORMALIZACION_UI (sin cambio visual).
import { ExternalLink } from 'lucide-react'
import { ICONO } from '../../../config/iconos'
import Spinner from '../../../components/Spinner'
import { abrirArchivoNativo } from '../../../utils/nativeSave'
import { useState } from 'react'
import { useToast } from '../../../components/Toast'

// Botón para archivos sin vista previa en la App (Excel, ZIP, y cualquier
// otro formato que canPreviewFile no cubra): en vez de mandar a la web sin
// más, descarga el archivo y abre el panel "Compartir" de Android, que
// también ofrece las apps que pueden ABRIRLO (Sheets, Excel, WPS…) — el
// docente ve el archivo real, con lo que ya tenga instalado. Ver
// abrirArchivoNativo en utils/nativeSave.js.
export function AbrirConNativoButton({ url, nombre, className }) {
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  async function handleClick() {
    setLoading(true)
    try {
      await abrirArchivoNativo(url, nombre)
    } catch (err) {
      toast('No se pudo abrir el archivo: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={loading} className={className}>
      {loading ? <Spinner size="sm" /> : <ExternalLink size={ICONO.md} className="text-accent flex-shrink-0" />}
      <span className="truncate">{nombre}</span>
    </button>
  )
}
