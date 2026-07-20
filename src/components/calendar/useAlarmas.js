import { useEffect, useRef } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { reproducirSonido } from '../../utils/horarioBloques'
import { subjectDisplayName } from '../../utils/subjectName'

// Dispara las alarmas de los bloques cuya hora de aviso llega mientras la app
// está abierta: reproduce el sonido elegido y muestra una notificación del
// navegador (si el docente concedió el permiso), y deja constancia en
// `notificationLog` (misma colección que usa el "Registro de notificaciones"
// de Notificaciones — ver localReminders.js y NotificationSettings.jsx). Sin
// esto sonaba pero no quedaba ningún rastro, en app y en web.
//
// Limitación conocida: sólo suena con la pestaña abierta (no hay backend ni
// push). Un bloque suena una única vez PARA CADA fecha/hora — se recuerda en
// localStorage (clave = id + fecha + horaInicio, no solo el id) para no
// repetir la alarma al recargar dentro de la ventana de disparo, PERO sí
// volver a sonar si el docente mueve el bloque a una fecha/hora distinta,
// aunque ya hubiera sonado antes en su posición original (pedido explícito).

const STORAGE_KEY = 'ef_alarmas_disparadas'
const VENTANA_MS = 2 * 60 * 1000 // sólo dispara si el aviso ocurrió en los últimos 2 min

function loadFired() {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')) } catch { return new Set() }
}
function saveFired(set) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set].slice(-500))) } catch { /* almacenamiento lleno */ }
}

export default function useAlarmas(bloques, subjects, uid) {
  const firedRef = useRef(loadFired())

  // Pide permiso de notificaciones si hay al menos una alarma activa.
  useEffect(() => {
    const hayActivas = bloques.some(b => b.alarma?.activa)
    if (hayActivas && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [bloques])

  useEffect(() => {
    function tick() {
      const now = Date.now()
      for (const b of bloques) {
        const a = b.alarma
        const key = `${b.id}:${b.fecha}:${b.horaInicio}`
        if (!a?.activa || firedRef.current.has(key)) continue
        const triggerMs = new Date(`${b.fecha}T${b.horaInicio}:00`).getTime() - (a.minutosAntes || 0) * 60000
        if (Number.isNaN(triggerMs)) continue
        if (now >= triggerMs && now < triggerMs + VENTANA_MS) {
          firedRef.current.add(key)
          saveFired(firedRef.current)
          reproducirSonido(a.sonido)
          const subj = subjects[b.asignaturaId]
          const min = a.minutosAntes || 0
          const lugar = b.lugar ? ` · ${b.lugar}` : ''
          const body = min > 0
            ? `Empieza en ${min} min (${b.horaInicio})${lugar}`
            : `Empieza ahora (${b.horaInicio})${lugar}`
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try { new Notification(subjectDisplayName(subj) || 'Clase', { body, tag: b.id }) } catch { /* ignore */ }
          }
          if (uid) {
            addDoc(collection(db, 'notificationLog'), {
              uid,
              categoria: 'recordatorioClase',
              titulo: 'Tu clase está por comenzar',
              descripcion: `${subjectDisplayName(subj) || 'Clase'} — ${body}`,
              asignatura: subj?.nombre || '',
              grupo: subj?.grupo || '',
              lugar: b.lugar || '',
              fecha: b.fecha,
              hora: b.horaInicio,
              anticipacionMinutos: min,
              createdAt: serverTimestamp(),
            }).catch(() => { /* best-effort — no bloquea el aviso si falla */ })
          }
        }
      }
    }
    tick()
    const iv = setInterval(tick, 20000)
    return () => clearInterval(iv)
  }, [bloques, subjects])
}
