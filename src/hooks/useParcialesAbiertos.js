import { useState, useCallback } from 'react'
import { IS_NATIVE_APP } from '../utils/platform'

// Parciales desplegados de una asignatura.
//
// Web: se guardan SOLO las elecciones explícitas del usuario ({ [parcial]: bool })
// por rol, usuario y asignatura (localStorage, solo en este navegador). Lo que el
// usuario no ha tocado se calcula al dibujar con `estaAbierto`:
//   1. elección explícita  → se respeta, aunque el parcial esté cerrado;
//   2. parcial cerrado     → replegado;
//   3. cualquier otro      → solo el Parcial 1 desplegado.
// Así cerrar o reabrir un parcial recalcula su vista sin sobrescribir nada.
// Lo guardado por la versión anterior (mapa completo) se lee como elecciones.
//
// App nativa: acordeón de siempre (uno abierto a la vez), sin persistir.

function clave(rol, uid, subjectId) {
  return `ef-parciales-abiertos-${rol}-${uid}-${subjectId}`
}

function leer(rol, uid, subjectId) {
  if (IS_NATIVE_APP) return { 1: true }
  if (!uid || !subjectId) return {}
  try {
    const raw = localStorage.getItem(clave(rol, uid, subjectId))
    if (raw) {
      const v = JSON.parse(raw)
      if (v && typeof v === 'object' && !Array.isArray(v)) return v
    }
  } catch { /* sin almacenamiento: comportamiento inicial */ }
  return {}
}

export default function useParcialesAbiertos(rol, uid, subjectId) {
  const [elecciones, setElecciones] = useState(() => leer(rol, uid, subjectId))

  // Releer al cambiar de asignatura (el componente se reutiliza sin remontarse).
  const reiniciar = useCallback(() => setElecciones(leer(rol, uid, subjectId)), [rol, uid, subjectId])

  // `cerrado` = parcialCerrado(subject, p), lo decide quien llama.
  const estaAbierto = useCallback((p, cerrado) => {
    if (IS_NATIVE_APP) return !!elecciones[p]
    if (Object.prototype.hasOwnProperty.call(elecciones, p)) return !!elecciones[p]
    return !cerrado && Number(p) === 1
  }, [elecciones])

  const alternar = useCallback((p, cerrado) => {
    if (IS_NATIVE_APP) {
      setElecciones((prev) => (prev[p] ? {} : { [p]: true }))
      return
    }
    const nuevo = !estaAbierto(p, cerrado)
    setElecciones((prev) => {
      const next = { ...prev, [p]: nuevo }
      if (uid && subjectId) {
        try { localStorage.setItem(clave(rol, uid, subjectId), JSON.stringify(next)) } catch { /* lleno o bloqueado */ }
      }
      return next
    })
  }, [rol, uid, subjectId, estaAbierto])

  return { estaAbierto, alternar, reiniciar }
}
