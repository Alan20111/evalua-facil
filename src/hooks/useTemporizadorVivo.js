// Reloj de Participación en vivo en el navegador. La apertura y el límite de cada pregunta son HORA DEL SERVIDOR
// (sesión.abreMs / cierraMs / cerradaMs); aquí solo se corrige el reloj local con el desfase medido contra el servidor
// y se calcula el tiempo restante cada 100 ms. El contador avanza solo: no depende de cuándo llegue la siguiente consulta.
import { useCallback, useEffect, useRef, useState } from 'react'
import { estadoPreguntaVivo, faltaParaAbrirVivoMs, mejorDesfase, restanteVivoMs } from '../utils/participacionVivo'

/**
 * Devuelve { ahora, registrar }: `ahora()` es la hora del servidor estimada; `registrar(muestra)` incorpora una medición
 * ({ desfase, rtt }). Con `muestrear` (async → muestra) mide por sí solo: al abrir y cada 30 s (el proyector). Los celulares
 * registran una muestra con cada consulta de estado, que ya trae la hora del servidor.
 */
export function useRelojServidor({ muestrear = null } = {}) {
  const muestras = useRef([])
  const desfase = useRef(0)
  const registrar = useCallback((m) => {
    muestras.current = [...muestras.current.slice(-9), m]
    desfase.current = mejorDesfase(muestras.current)
  }, [])
  const ahora = useCallback(() => Date.now() + desfase.current, [])
  useEffect(() => {
    if (!muestrear) return undefined
    let vivo = true
    const tomar = async () => {
      try { const m = await muestrear(); if (vivo) registrar(m) } catch { /* se reintenta en la siguiente */ }
    }
    tomar()
    const rapidas = [setTimeout(tomar, 400), setTimeout(tomar, 1500)] // varias muestras al inicio: se queda la de menor viaje
    const id = setInterval(tomar, 30000)
    return () => { vivo = false; rapidas.forEach(clearTimeout); clearInterval(id) }
  }, [muestrear, registrar])
  return { ahora, registrar }
}

/** Estado de la pregunta en curso y su cuenta regresiva, recalculados cada 100 ms con el reloj del servidor. */
export function useCuentaRegresiva(sesion, ahora) {
  const [t, setT] = useState(() => ahora())
  useEffect(() => {
    const id = setInterval(() => setT(ahora()), 100)
    return () => clearInterval(id)
  }, [ahora])
  return { ahoraMs: t, estado: estadoPreguntaVivo(sesion, t), restanteMs: restanteVivoMs(sesion, t), faltaMs: faltaParaAbrirVivoMs(sesion, t) }
}
