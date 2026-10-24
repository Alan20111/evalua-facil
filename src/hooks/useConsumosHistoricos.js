// Consumos (`iaConsumos/{id}`) de los movimientos de "Calificación de
// evidencias" ANTERIORES al desglose (sin `detalle`): de ahí sale, sin
// suponer nada, cuántas entregas se evaluaron y la tarifa que se cobró. El
// movimiento y su consumo comparten id (la clave de idempotencia). Cada
// docente lee solo los suyos (firestore.rules). Solo lectura; un fallo deja
// el movimiento sin desglose, nunca con uno inventado.
import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { necesitaConsumoHistorico } from '../utils/movimientosCreditos'

export default function useConsumosHistoricos(movimientos) {
  const ids = (movimientos || []).filter(necesitaConsumoHistorico).map((m) => m.id).sort()
  const clave = ids.join('|')
  const [consumos, setConsumos] = useState({})

  useEffect(() => {
    if (!clave) return undefined
    let vigente = true
    Promise.all(clave.split('|').map((id) =>
      getDoc(doc(db, 'iaConsumos', id)).then((s) => [id, s.exists() ? s.data() : null]).catch(() => [id, null]),
    )).then((pares) => {
      if (vigente) setConsumos((prev) => ({ ...prev, ...Object.fromEntries(pares) }))
    })
    return () => { vigente = false }
  }, [clave])

  return consumos
}
