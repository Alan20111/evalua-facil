import { useState, useEffect, useMemo, useCallback } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from '../components/Toast'
import { buildAsuetoMap, esAsuetoPara } from '../utils/asuetos'

// Carga los días de asueto del docente y expone un chequeo con aviso (toast)
// para impedir fijar fechas de actividad (fechaLimite / publishAt) en un día
// marcado como asueto para "actividades". Reutiliza el patrón `bloqueadoPorAsueto`
// de CalendarPage. Los asuetos son opcionales: si la carga falla, seguimos sin
// bloquear nada.
export function useAsuetoActividades(docenteId) {
  const toast = useToast()
  const [asuetos, setAsuetos] = useState([])

  useEffect(() => {
    if (!docenteId) return
    let active = true
    getDocs(query(collection(db, 'asuetos'), where('docenteId', '==', docenteId)))
      .then((snap) => { if (active) setAsuetos(snap.docs.map((d) => ({ id: d.id, ...d.data() }))) })
      .catch(() => { /* asuetos son opcionales: si fallan, seguimos sin ellos */ })
    return () => { active = false }
  }, [docenteId])

  const asuetoMap = useMemo(() => buildAsuetoMap(asuetos), [asuetos])

  // Devuelve true (y avisa con toast) si `fecha` — 'YYYY-MM-DD' o ISO datetime —
  // cae en un día de asueto para actividades. Úsalo para bloquear el guardado.
  const bloqueadoPorAsuetoActividad = useCallback((fecha) => {
    if (!fecha) return false
    const dia = String(fecha).substring(0, 10)
    if (esAsuetoPara(asuetoMap, dia, 'actividades')) {
      const d = new Date(dia + 'T12:00:00')
      toast(`${d.getDate()}/${d.getMonth() + 1} es día de asueto (sin actividades). Quítalo en "Días de asueto" para permitirlo.`, 'error')
      return true
    }
    return false
  }, [asuetoMap, toast])

  return { asuetoMap, bloqueadoPorAsuetoActividad }
}
