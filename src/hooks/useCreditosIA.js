// Créditos IA del docente — lectura en tiempo real y ejecución de operaciones.
//
// El cliente NUNCA calcula ni escribe el saldo: lee `iaCreditos/{uid}` por
// snapshot (el servidor es la única fuente de verdad) y ejecuta operaciones a
// través del callable `ejecutarOperacionIA`, que reserva, ejecuta la IA,
// liquida con el consumo real y actualiza el saldo — la barra se refresca
// sola por el snapshot.
//
// La ESTIMACIÓN de aquí es solo informativa (regla del PO: nunca descuenta):
// sale de `config/iaTarifas`, el mismo documento que usa el servidor, así que
// no hay tarifas duplicadas en el código.

import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useAuth } from '../context/AuthContext'

// Tarifas cacheadas a nivel módulo: cambian rara vez y las usan la barra, el
// panel y cada diálogo de confirmación — una sola lectura por sesión.
let _tarifasPromise = null
function cargarTarifas() {
  if (!_tarifasPromise) {
    _tarifasPromise = getDoc(doc(db, 'config', 'iaTarifas'))
      .then((s) => (s.exists() ? s.data() : null))
      .catch(() => null)
  }
  return _tarifasPromise
}

const ETIQUETAS_PLAN = {
  trial: 'Periodo de prueba',
  pro: 'Plan Docente',
  anual: 'Plan Docente (anual)',
  mayor: 'Plan Mayor',
}

export function useCreditosIA() {
  const { currentUser, userProfile } = useAuth()
  const esDocente = userProfile?.role === 'docente'
  const [creditos, setCreditos] = useState(null)
  const [cargado, setCargado] = useState(false)
  const [tarifas, setTarifas] = useState(null)

  useEffect(() => {
    cargarTarifas().then(setTarifas)
  }, [])

  useEffect(() => {
    if (!currentUser || !esDocente) return undefined
    const unsub = onSnapshot(
      doc(db, 'iaCreditos', currentUser.uid),
      (snap) => {
        setCreditos(snap.exists() ? snap.data() : null)
        setCargado(true)
      },
      () => setCargado(true) // sin permiso/offline: la barra muestra el estado por omisión
    )
    return unsub
  }, [currentUser, esDocente])

  return useMemo(() => {
    // Antes del primer uso de IA el documento no existe: se muestra la bolsa
    // completa del nivel base (solo visual — el doc real nace en el servidor
    // con el plan correcto en la primera operación).
    const capacidadBase = tarifas?.capacidadPorPlan?.pro ?? 350
    const capacidad = creditos?.capacidad ?? capacidadBase
    const saldo = creditos?.saldo ?? capacidad
    const plan = creditos?.plan ?? null
    const pct = capacidad > 0 ? Math.max(0, Math.min(100, (saldo / capacidad) * 100)) : 0

    return {
      listo: cargado && !!tarifas,
      esDocente,
      tarifas,
      creditos,
      capacidad,
      saldo,
      pct,
      plan,
      etiquetaPlan: ETIQUETAS_PLAN[plan] || ETIQUETAS_PLAN.pro,
      esTrial: plan === 'trial',
      cicloFin: creditos?.cicloFin?.toDate?.() || null,
      consumidoCiclo: creditos?.consumidoCiclo ?? 0,
      consumoPorCategoria: creditos?.consumoPorCategoria || {},

      // Estimación informativa (jamás descuenta): costo en créditos de una
      // operación según las tarifas centrales.
      estimar(operacion, unidades = 1) {
        const porUso = tarifas?.tarifas?.[operacion]
        if (!porUso) return null
        return porUso * unidades
      },

      // Ejecuta una operación de IA. Genera la clave de idempotencia AQUÍ,
      // una por confirmación del docente: un doble clic o un reintento de red
      // reutilizan la misma clave y el servidor no cobra dos veces.
      // `timeoutMs` (opcional): los lotes de C-02 pueden tardar minutos; el
      // timeout por omisión del SDK (70 s) los cortaría a la mitad. Las
      // operaciones unitarias no lo necesitan.
      async ejecutar(operacion, params = {}, unidades = 1, { timeoutMs } = {}) {
        const idempotencyKey = crypto.randomUUID()
        const llamar = httpsCallable(functions, 'ejecutarOperacionIA', timeoutMs ? { timeout: timeoutMs } : undefined)
        try {
          const { data } = await llamar({ operacion, idempotencyKey, params, unidades })
          return data
        } catch (e) {
          // El SDK entrega code tipo "functions/failed-precondition" y
          // details con el código del ledger — se normaliza para la UI.
          const codigo = e?.details?.codigo || null
          const err = new Error(e?.message || 'No se pudo completar la operación')
          err.codigo = codigo
          err.saldo = e?.details?.saldo
          err.costo = e?.details?.costo
          throw err
        }
      },
    }
  }, [cargado, tarifas, creditos, esDocente])
}

export default useCreditosIA
