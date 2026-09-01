// Estado REAL de un diagnóstico (contexto|conocimientos) de una asignatura —
// para las señales visuales de la pestaña Planeación Didáctica (DiagnosticoGrupoSection,
// PlaneacionInicialSection). Reutiliza exactamente los mismos datos que el
// servidor: `activities` (asignaturaId + diagnosticoTipo) y su subcolección
// `analisisIA` (ver analisisDiagnosticoMasReciente en functions/ia.js), más
// `submissions` (actividadId + estadoEvaluacion) y el mismo umbral
// MIN_ENTREGAS_ANALISIS que ya habilita "Analizar resultados con IA" en
// EvaluacionManager. No crea ninguna colección ni estado nuevo.
//
// 'pendiente'  — sin actividad, o sin entregas finalizadas suficientes.
// 'analizable' — ya hay entregas suficientes; falta ejecutar el análisis.
// 'completado' — ya existe un análisis real (activities/{id}/analisisIA).
//
// Si hay varias actividades del mismo tipo (el docente puede generar más de
// una antes de quedarse con una sola para Planeación), se toma el mejor
// estado entre todas: basta que UNA tenga análisis para marcar 'completado'.
import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { MIN_ENTREGAS_ANALISIS } from '../utils/analisisResultados'

export default function useDiagnosticoEstado(subjectId, tipo) {
  const [estado, setEstado] = useState('pendiente')
  const [cargado, setCargado] = useState(false)

  useEffect(() => {
    if (!subjectId || !tipo) return undefined
    let cancelado = false
    const subUnsubs = new Map() // actividadId -> unsub de submissions
    const analisisUnsubs = new Map() // actividadId -> unsub de analisisIA
    const finalizadasPorActividad = new Map() // actividadId -> count de entregas finalizado
    const analisisPorActividad = new Set() // actividadId con al menos un análisis

    function recalcular() {
      if (analisisPorActividad.size > 0) { setEstado('completado'); return }
      const hayAnalizable = [...finalizadasPorActividad.values()].some((n) => n >= MIN_ENTREGAS_ANALISIS)
      setEstado(hayAnalizable ? 'analizable' : 'pendiente')
    }

    const q = query(
      collection(db, 'activities'),
      where('asignaturaId', '==', subjectId),
      where('diagnosticoTipo', '==', tipo),
    )
    const unsubActividades = onSnapshot(q, (snap) => {
      if (cancelado) return
      const idsActuales = new Set(snap.docs.map((d) => d.id))

      for (const [id, unsub] of subUnsubs) {
        if (!idsActuales.has(id)) { unsub(); subUnsubs.delete(id); finalizadasPorActividad.delete(id) }
      }
      for (const [id, unsub] of analisisUnsubs) {
        if (!idsActuales.has(id)) { unsub(); analisisUnsubs.delete(id); analisisPorActividad.delete(id) }
      }

      snap.docs.forEach((d) => {
        if (!subUnsubs.has(d.id)) {
          const unsubSub = onSnapshot(
            query(collection(db, 'submissions'), where('actividadId', '==', d.id)),
            (subSnap) => {
              if (cancelado) return
              const n = subSnap.docs.filter((x) => x.data().estadoEvaluacion === 'finalizado').length
              finalizadasPorActividad.set(d.id, n)
              recalcular()
            },
          )
          subUnsubs.set(d.id, unsubSub)
        }
        if (!analisisUnsubs.has(d.id)) {
          const unsubAn = onSnapshot(collection(db, 'activities', d.id, 'analisisIA'), (anSnap) => {
            if (cancelado) return
            if (anSnap.empty) analisisPorActividad.delete(d.id)
            else analisisPorActividad.add(d.id)
            recalcular()
          })
          analisisUnsubs.set(d.id, unsubAn)
        }
      })

      recalcular()
      setCargado(true)
    }, () => setCargado(true))

    return () => {
      cancelado = true
      unsubActividades()
      subUnsubs.forEach((unsub) => unsub())
      analisisUnsubs.forEach((unsub) => unsub())
    }
  }, [subjectId, tipo])

  return { estado, cargado }
}
