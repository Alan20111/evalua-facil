import { useCallback, useEffect, useRef } from 'react'
import { fetchMisEntregas } from '../utils/apiContent'
import { entregaMasReciente, esperandoNota } from '../utils/entregasCliente'

// Mantiene al día la entrega del estudiante en ActivityPage. Sustituye al
// `onSnapshot` directo a Firestore: ahora la entrega llega por el servidor, que
// le quita lo que el docente ocultó, y por eso se pregunta en lugar de escuchar.
//
// Cuándo pregunta:
//   · cada 3 s durante el primer minuto en que ESPERA LA NOTA (el examen o juego
//     ya terminó y la Cloud Function todavía no escribe la calificación);
//   · después, cada 60 s (cubre al docente que califica una entrega más tarde);
//   · y al volver a la pestaña (visibilitychange).
//
// Nunca pisa un estado más nuevo: la respuesta pasa por `entregaMasReciente`, y
// lo que estaba en vuelo cuando la pantalla escribió o recargó (`invalidar()`) se
// descarta. Solo lee; ninguna escritura del estudiante pasa por aquí.
const RAPIDO_MS = 3000
const VENTANA_RAPIDA_MS = 60000
const LENTO_MS = 60000

export default function useSondeoEntrega({ activityId, activo, submission, setSubmission }) {
  const ultima = useRef(submission)
  const generacion = useRef(0)
  const esperandoDesde = useRef(null)

  useEffect(() => { ultima.current = submission })

  // Llamar justo antes de escribir o de recargar por completo: lo que esté en
  // vuelo ya es viejo y no debe aplicarse.
  const invalidar = useCallback(() => { generacion.current += 1 }, [])

  useEffect(() => {
    if (!activo || !activityId) return undefined
    let vivo = true
    let timer = null

    const preguntar = async () => {
      const mia = generacion.current
      try {
        const { entregas } = await fetchMisEntregas({ actividadId: activityId })
        if (!vivo || mia !== generacion.current) return
        const nueva = entregas.find((e) => e.actividadId === activityId)
        // Sin entrega en el servidor no se borra nada local: anular lo decide la pantalla.
        if (nueva) setSubmission((actual) => entregaMasReciente(actual, nueva))
      } catch { /* un sondeo que falla no es un error: se reintenta en el siguiente */ }
    }

    const programar = () => {
      if (!vivo) return
      const espera = esperandoNota(ultima.current)
      if (espera && esperandoDesde.current === null) esperandoDesde.current = Date.now()
      if (!espera) esperandoDesde.current = null
      const rapido = espera && Date.now() - esperandoDesde.current < VENTANA_RAPIDA_MS
      timer = setTimeout(async () => {
        if (!document.hidden) await preguntar()
        programar()
      }, rapido ? RAPIDO_MS : LENTO_MS)
    }

    const alVolver = () => { if (!document.hidden) preguntar() }
    document.addEventListener('visibilitychange', alVolver)
    programar()
    return () => {
      vivo = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [activityId, activo, setSubmission])

  return { invalidar }
}
