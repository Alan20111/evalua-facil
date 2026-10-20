// Movimientos de créditos IA del docente en un mes (bitácora).
//
// Lee `iaMovimientos` con DOS igualdades (uid + periodo): es la consulta que
// permiten las reglas, no necesita índice compuesto ni orderBy (el orden se
// hace en memoria, utils/movimientosCreditos.js). Solo lectura: el cliente
// jamás escribe movimientos.

import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'

export function useMovimientosCreditos(periodo) {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid
  const [estado, setEstado] = useState({ clave: null, movimientos: [], error: false })

  useEffect(() => {
    if (!uid || !periodo) return undefined
    const clave = `${uid}|${periodo}`
    const q = query(collection(db, 'iaMovimientos'), where('uid', '==', uid), where('periodo', '==', periodo))
    return onSnapshot(
      q,
      (snap) => setEstado({ clave, movimientos: snap.docs.map((d) => ({ id: d.id, ...d.data() })), error: false }),
      () => setEstado({ clave, movimientos: [], error: true })
    )
  }, [uid, periodo])

  const cargando = estado.clave !== `${uid}|${periodo}`
  return { movimientos: cargando ? [] : estado.movimientos, cargando, error: !cargando && estado.error }
}

export default useMovimientosCreditos
