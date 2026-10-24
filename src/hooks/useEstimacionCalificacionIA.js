// Estimación del costo de "Calificar con IA" (individual o lote) — la pide al
// SERVIDOR, que corre la misma revisión que el cobro real (entregas
// candidatas, evidencias legibles y tarifa por entrega). Mientras no llega,
// la confirmación no se puede aceptar.
//
// `params`: { modo: 'individual' | 'lote', actividadId, submissionId?, recalificar? }
// o null para no pedir nada (diálogo cerrado). Se vuelve a pedir si cambian.
//
// `reemplazar(estimacion)`: cuando la ejecución responde «el costo cambió», el
// servidor manda la estimación nueva y el diálogo la muestra sin cerrarse.
import { useCallback, useEffect, useState } from 'react'
import useCreditosIA from './useCreditosIA'

export default function useEstimacionCalificacionIA(params) {
  const c = useCreditosIA()
  const [intento, setIntento] = useState(0)
  const clave = params ? `${JSON.stringify(params)}#${intento}` : null
  // La respuesta guarda para qué petición llegó: si `clave` ya cambió, todavía
  // se está cargando la nueva (mismo patrón que useMovimientosCreditos).
  const [respuesta, setRespuesta] = useState({ clave: null, estimacion: null, error: null })
  const estimarCalificacion = c.estimarCalificacion

  useEffect(() => {
    if (!clave) return undefined
    let vigente = true
    const pedido = JSON.parse(clave.slice(0, clave.lastIndexOf('#')))
    estimarCalificacion(pedido)
      .then((data) => {
        if (!vigente) return
        setRespuesta(data?.estimacion
          ? { clave, estimacion: data.estimacion, error: null }
          : { clave, estimacion: null, error: 'No se pudo calcular el costo.' })
      })
      .catch((err) => {
        if (vigente) setRespuesta({ clave, estimacion: null, error: err.message || 'No se pudo calcular el costo.' })
      })
    return () => { vigente = false }
    // estimarCalificacion es estable en la práctica (sale del hook de créditos);
    // la petición depende solo de los parámetros y de los reintentos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  const reintentar = useCallback(() => setIntento((n) => n + 1), [])
  const reemplazar = useCallback((estimacion) => {
    if (estimacion) setRespuesta({ clave, estimacion, error: null })
  }, [clave])

  const vigente = !!clave && respuesta.clave === clave
  return {
    estimacion: vigente ? respuesta.estimacion : null,
    error: vigente ? respuesta.error : null,
    cargando: !!clave && !vigente,
    reintentar,
    reemplazar,
  }
}
