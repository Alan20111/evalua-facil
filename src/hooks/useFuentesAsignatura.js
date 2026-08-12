// Lee las fuentes guardadas de la asignatura (subject/AsistenteIATab.jsx) para
// que los modales de fuentes efímeras (OP-03/04/05/09, FuentesIAInput) puedan
// detectar cuando un archivo que el docente va a subir ya está guardado ahí y
// evitar duplicarlo en Cloudinary.
import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

export default function useFuentesAsignatura(subjectId, docenteId) {
  const [fuentes, setFuentes] = useState([])

  useEffect(() => {
    if (!subjectId || !docenteId) return
    // Mismo motivo que AsistenteIATab.jsx: docenteId debe ir en un where()
    // para que la regla de fuentesAsignatura pueda validar un LIST.
    const q = query(
      collection(db, 'fuentesAsignatura'),
      where('asignaturaId', '==', subjectId),
      where('docenteId', '==', docenteId)
    )
    const unsub = onSnapshot(q, (snap) => {
      setFuentes(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    }, () => setFuentes([]))
    return unsub
  }, [subjectId, docenteId])

  return fuentes
}
