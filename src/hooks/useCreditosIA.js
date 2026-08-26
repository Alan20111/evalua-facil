// Créditos IA del docente — lectura en tiempo real y ejecución de operaciones.
//
// Modelo de créditos puros sin caducidad (20-ago-2026, migración — ver
// docs/ia/PLAN_TECNICO_CREDITOS_PUROS.md): un solo número, `saldo`, sin
// capacidad ni plan ni ciclo mensual — nunca se resetea, solo sube (compra
// aprobada, regalo de bienvenida) o baja (consumo de IA).
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

export function useCreditosIA() {
  const { currentUser, userProfile } = useAuth()
  const esDocente = userProfile?.role === 'docente'
  const [creditos, setCreditos] = useState(null)
  const [cargado, setCargado] = useState(false)
  const [tarifas, setTarifas] = useState(null)
  const [bienvenida, setBienvenida] = useState(null)

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

  // Bienvenida voluntaria (20-ago-2026): iaTrialRegistro/{uid} dice si hay
  // 30 créditos por activar. Doc ausente (cuenta creada antes de este
  // cambio, o carrera muy breve con onDocenteCreado) = sin bienvenida que
  // ofrecer, no se inventa un CTA de la nada.
  useEffect(() => {
    if (!currentUser || !esDocente) return undefined
    const unsub = onSnapshot(
      doc(db, 'iaTrialRegistro', currentUser.uid),
      (snap) => setBienvenida(snap.exists() ? snap.data() : null),
      () => {}
    )
    return unsub
  }, [currentUser, esDocente])

  return useMemo(() => {
    // Antes del primer uso/otorgamiento el documento puede no existir todavía
    // (carrera con onDocenteCreado, muy breve) — se asume 0, nunca se inventa
    // saldo en el cliente.
    const saldo = creditos?.saldo ?? 0

    return {
      listo: cargado && !!tarifas,
      esDocente,
      tarifas,
      // Paquetes de créditos — misma fuente que lee el servidor
      // (firestore.rules → montoOficialCredito, seed-ia-tarifas.js).
      paquetesCreditos: tarifas?.paquetesCreditos || [],
      creditos,
      saldo,
      // Saldo positivo: además de habilitar IA, es lo único que gatea
      // Asistencia (§9 del plan) — no consume créditos, solo exige saldo>0.
      saldoPositivo: saldo > 0,
      consumidoTotal: creditos?.consumidoTotal ?? 0,
      consumoPorCategoria: creditos?.consumoPorCategoria || {},

      // Bienvenida voluntaria: el CTA "Activa tus 30 créditos IA de regalo"
      // se muestra cuando hay bienvenida disponible y AÚN no se activó.
      bienvenidaDisponible: !!bienvenida?.bienvenidaDisponible,
      bienvenidaActivada: !!bienvenida?.bienvenidaActivada,
      mostrarCTAActivarBienvenida: !!bienvenida?.bienvenidaDisponible && !bienvenida?.bienvenidaActivada,

      // Activa los 30 créditos de bienvenida — una sola vez, server-side
      // (functions/index.js → activarCreditosBienvenida). El propio ledger
      // rechaza una segunda activación sin que el cliente tenga que evitarlo.
      async activarBienvenida() {
        const llamar = httpsCallable(functions, 'activarCreditosBienvenida')
        try {
          const { data } = await llamar()
          return data
        } catch (e) {
          const codigo = e?.details?.codigo || null
          const err = new Error(e?.message || 'No se pudo activar tus créditos de bienvenida')
          err.codigo = codigo
          throw err
        }
      },

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
  }, [cargado, tarifas, creditos, esDocente, bienvenida])
}

export default useCreditosIA
