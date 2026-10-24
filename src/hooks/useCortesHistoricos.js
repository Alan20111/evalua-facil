// Cortes de la cadena de saldos (créditos sin registro) de la cuenta.
//
// Un corte solo se puede ver con TODOS los movimientos de la cuenta (cruza
// meses), así que se leen una vez, y solo si el mes mostrado trae registros
// importados del historial anterior: una cuenta que nació con el registro
// actual no tiene cortes y no paga esta lectura. Una igualdad (uid), la misma
// que permiten las reglas. Solo lectura; si falla, no se muestran cortes.
import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { cortesDeCadena } from '../utils/movimientosCreditos'

const cache = new Map()

export default function useCortesHistoricos(activo) {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid
  const [estado, setEstado] = useState({ uid: null, cortes: [] })

  useEffect(() => {
    if (!activo || !uid) return undefined
    let vigente = true
    if (!cache.has(uid)) {
      cache.set(uid, getDocs(query(collection(db, 'iaMovimientos'), where('uid', '==', uid)))
        .then((snap) => cortesDeCadena(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
        .catch(() => { cache.delete(uid); return [] }))
    }
    cache.get(uid).then((cortes) => { if (vigente) setEstado({ uid, cortes }) })
    return () => { vigente = false }
  }, [activo, uid])

  return estado.uid === uid ? estado.cortes : []
}
