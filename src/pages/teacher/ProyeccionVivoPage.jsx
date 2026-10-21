// Ventana de proyección de Participación en vivo: solo la vista del grupo, en pantalla completa y de solo lectura.
// Se abre desde «Proyectar en otra ventana» y sigue a la ventana del docente (pregunta actual por Firestore; revelar la
// correcta, QR y momentos por BroadcastChannel). No escribe nada.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import Spinner from '../../components/Spinner'
import { ProyeccionSolaVista } from '../../components/participacion/PresentacionVivo'
import { escucharSesionVivo } from '../../utils/participacionVivoDb'

export default function ProyeccionVivoPage() {
  const { codigo } = useParams()
  const { currentUser } = useAuth()
  const [claves, setClaves] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let vivo = true
    // Las claves (respuesta correcta) viven en la actividad de la sesión; solo se usan para «Mostrar la correcta».
    const baja = escucharSesionVivo(codigo, (s) => {
      baja?.()
      if (!s) { if (vivo) setError(true); return }
      getDocs(collection(db, 'activities', s.actividadId, 'clave'))
        .then((snap) => { if (vivo) setClaves(Object.fromEntries(snap.docs.filter((d) => d.id !== 'contexto').map((d) => [d.id, d.data()]))) })
        .catch(() => { if (vivo) setClaves({}) })
    }, () => { if (vivo) setError(true) })
    return () => { vivo = false; baja?.() }
  }, [codigo])

  if (error) return <div className="min-h-dvh flex items-center justify-center bg-white text-slate-900 text-xl">No se encontró esta sesión.</div>
  if (!claves || !currentUser) return <div className="min-h-dvh flex items-center justify-center bg-white"><Spinner /></div>
  return <ProyeccionSolaVista codigo={codigo} claves={claves} docenteId={currentUser.uid} />
}
