// Ayudas de la proyección de Participación en vivo: medir el área disponible, ocultar los controles tras 3 s sin
// actividad y no actualizar el dibujo más de una vez cada 1.5 s (para que la pantalla no «baile» frente al grupo).
import { useCallback, useEffect, useRef, useState } from 'react'

/** Ancho y alto reales (px) del elemento referenciado; se actualiza al cambiar la ventana. */
export function useAreaMedida() {
  const ref = useRef(null)
  const [area, setArea] = useState({ ancho: 0, alto: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const medir = () => setArea((a) => (a.ancho === el.clientWidth && a.alto === el.clientHeight ? a : { ancho: el.clientWidth, alto: el.clientHeight }))
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, area]
}

/** true mientras haya actividad (ratón, teclado, toque) y `ms` después; luego false. */
export function useAutoOcultar(ms = 3000) {
  const [visible, setVisible] = useState(true)
  const temporizador = useRef(null)
  const armar = useCallback(() => {
    clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => setVisible(false), ms)
  }, [ms])
  const mostrar = useCallback(() => { setVisible(true); armar() }, [armar])
  useEffect(() => {
    const eventos = ['mousemove', 'mousedown', 'keydown', 'touchstart']
    eventos.forEach((e) => window.addEventListener(e, mostrar))
    armar() // arranca visible y se oculta a los 3 s sin actividad
    return () => { eventos.forEach((e) => window.removeEventListener(e, mostrar)); clearTimeout(temporizador.current) }
  }, [mostrar, armar])
  return [visible, mostrar]
}

/** Valor «amortiguado»: refleja el último valor, pero cambia como máximo cada `ms` (el primero pasa de inmediato). */
export function useAmortiguado(valor, ms = 1500) {
  const [v, setV] = useState(valor)
  const ultimo = useRef(0)
  const pendiente = useRef(null)
  useEffect(() => {
    const ahora = Date.now()
    const espera = ms - (ahora - ultimo.current)
    clearTimeout(pendiente.current)
    if (espera <= 0) { ultimo.current = ahora; setV(valor) } else {
      pendiente.current = setTimeout(() => { ultimo.current = Date.now(); setV(valor) }, espera)
    }
    return () => clearTimeout(pendiente.current)
  }, [valor, ms])
  return v
}

const canal = (codigo) => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`ef-vivo-${codigo}`))

/**
 * Estado que el docente decide en su ventana (revelar la correcta, QR, momento) y que la ventana de
 * proyección solo REFLEJA, por BroadcastChannel del mismo origen (no pasa por Firestore ni escribe nada).
 */
export function useEstadoProyeccion(codigo, { emisor }) {
  const [estado, setEstado] = useState({ verCorrecta: false, mostrarQr: false, momento: 'opciones' })
  const ch = useRef(null)
  const ultimo = useRef(estado)
  useEffect(() => {
    ch.current = canal(codigo)
    const c = ch.current
    if (!c) return undefined
    if (emisor) c.onmessage = (e) => { if (e.data?.tipo === 'pedir') c.postMessage({ tipo: 'estado', estado: ultimo.current }) }
    else {
      c.onmessage = (e) => { if (e.data?.tipo === 'estado') setEstado((s) => ({ ...s, ...e.data.estado })) }
      c.postMessage({ tipo: 'pedir' })
    }
    return () => c.close()
  }, [codigo, emisor])
  const cambiar = useCallback((parche) => {
    setEstado((s) => {
      const nuevo = { ...s, ...parche }
      ultimo.current = nuevo
      return nuevo
    })
    ch.current?.postMessage({ tipo: 'estado', estado: { ...ultimo.current, ...parche } })
  }, [])
  return [estado, cambiar]
}
