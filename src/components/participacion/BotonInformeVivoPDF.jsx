// «Informe en PDF» de una sesión en vivo: el informe final ya guardado + las notas del docente. Solo LEE (la asignatura para el
// encabezado); no llama a la IA ni escribe nada, así que no consume créditos ni cambia el informe.
import { useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { FileDown } from 'lucide-react'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { membreteDe } from '../../utils/membrete'
import { exportInformeVivoPDF } from '../../utils/pdf' // jsPDF se carga solo al exportar
import { Button } from '../ui'

export default function BotonInformeVivoPDF({ sesion, informe = null, respuestas = [], notas = '', disabled = false }) {
  const { userProfile } = useAuth()
  const [exportando, setExportando] = useState(false)
  const [error, setError] = useState('')
  async function exportar() {
    setExportando(true); setError('')
    try {
      const snap = await getDoc(doc(db, 'subjects', sesion.asignaturaId))
      const subject = snap.exists() ? { id: snap.id, ...snap.data() } : null
      await exportInformeVivoPDF({ sesion, informe, respuestas, notas, subject, membrete: membreteDe(userProfile) })
    } catch {
      setError('No se pudo generar el PDF. Intenta de nuevo.')
    } finally {
      setExportando(false)
    }
  }
  return (
    <>
      <Button variant="secondary" size="sm" icon={FileDown} busy={exportando} disabled={disabled} onClick={exportar}>Informe en PDF</Button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </>
  )
}
