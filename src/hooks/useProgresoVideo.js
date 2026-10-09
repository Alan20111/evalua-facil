import { useCallback, useEffect, useRef, useState } from 'react'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

// Progreso del Video interactivo, UNO por intento:
//   submissions/{submissionId}/progresoVideo/{intento}
//     { intento, maxVistoSeg, posicionSeg, actualizadoEn }
//
// Vive en su propia subcolección y no en el documento de la entrega: así sus
// reglas (que limitan cuánto puede avanzar `maxVistoSeg` por unidad de tiempo
// real — ver firestore.rules) no se mezclan con las de la entrega, y un intento
// nuevo parte de cero sin borrar nada (otro `{intento}`).
//
// Guardar NUNCA interrumpe la reproducción: se dispara sin esperar y un fallo
// solo avisa una vez.
const CADA_MS = 5000

export function refProgreso(submissionId, intento) {
  return doc(db, 'submissions', submissionId, 'progresoVideo', String(intento))
}

export default function useProgresoVideo({ submissionId, intento, onFalla }) {
  const [cargando, setCargando] = useState(true)
  const [inicial, setInicial] = useState(null)
  const ultimo = useRef({ t: 0, max: -1, pos: -1 })
  const fallaAvisada = useRef(false)
  const onFallaRef = useRef(onFalla)
  useEffect(() => { onFallaRef.current = onFalla })

  useEffect(() => {
    let vivo = true
    getDoc(refProgreso(submissionId, intento))
      .then((s) => { if (vivo) setInicial(s.exists() ? s.data() : null) })
      .catch(() => { if (vivo) setInicial(null) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [submissionId, intento])

  // `forzar` = pausa, pregunta, salida: se guarda ya aunque no hayan pasado 5 s.
  const guardar = useCallback((maxVistoSeg, posicionSeg, { forzar = false } = {}) => {
    if (maxVistoSeg <= 0 && posicionSeg <= 0) return // nada que guardar: aún no ha visto nada
    const u = ultimo.current
    const ahora = Date.now()
    const cambio = Math.abs(maxVistoSeg - u.max) > 0.01 || Math.abs(posicionSeg - u.pos) > 0.5
    if (!cambio || (!forzar && ahora - u.t < CADA_MS)) return
    ultimo.current = { t: ahora, max: maxVistoSeg, pos: posicionSeg }
    setDoc(refProgreso(submissionId, intento), {
      intento: Number(intento),
      maxVistoSeg: Math.round(maxVistoSeg * 10) / 10,
      posicionSeg: Math.round(Math.min(posicionSeg, maxVistoSeg) * 10) / 10,
      actualizadoEn: serverTimestamp(),
    }, { merge: true }).catch(() => {
      // Se reintenta en el siguiente ciclo; solo se avisa la primera vez.
      ultimo.current = { ...ultimo.current, t: 0 }
      if (!fallaAvisada.current) { fallaAvisada.current = true; onFallaRef.current?.() }
    })
  }, [submissionId, intento])

  return { cargando, inicial, guardar }
}
