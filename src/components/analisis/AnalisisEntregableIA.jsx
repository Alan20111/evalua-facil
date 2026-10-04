import { useCallback, useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { Sparkles } from 'lucide-react'
import { db, functions } from '../../firebase'
import { updateDoc } from '../../utils/firestoreGuard'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../Toast'
import Modal from '../ui/Modal'
import Spinner from '../Spinner'
import useCreditosIA from '../../hooks/useCreditosIA'
import useTelefonoWeb from '../../hooks/useTelefonoWeb'
import { useBackHandler } from '../../hooks/useBackHandler'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import InformeEntregable from './InformeEntregable'
import { exportAnalisisEntregablePDF } from '../../utils/pdf'
import { descargaSoloWeb } from '../../utils/descargaSoloWeb'
import { membreteDe } from '../../utils/membrete'
import { fuenteDeActividad } from '../../utils/analisisAsignatura'
import { fechaAnalisis } from '../../utils/analisisAsignaturaInforme'
import { MODALIDADES_ENTREGABLE, fueEditadoEntregable } from '../../utils/analisisEntregableInforme'

// «Analizar con IA» de UNA actividad entregable — modalidad «solo resultados»
// (Fase 1). Vive dentro del contenedor «Entregas» de la actividad: el botón,
// el flujo (revisar → costo → confirmar → generar), el historial y el informe.
//
// El cliente no manda ningún dato académico: solo el id de la actividad. El
// servidor relee todo, calcula, cobra y GUARDA el informe
// (activities/{id}/analisisActividadIA); aquí solo se lee. Abrir un análisis
// del historial o descargar su PDF no cuesta nada.
const cuenta = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`
const millis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : 0)

const llamarPreparacion = (actividadId) =>
  httpsCallable(functions, 'prepararAnalisisEntregable')({ actividadId }).then((r) => r.data)

function FlujoAnalisis({ activity, onCerrar, onGenerado }) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const [prep, setPrep] = useState({ cargando: true })
  const [confirmando, setConfirmando] = useState(false)
  const [ejecutando, setEjecutando] = useState(false)

  const recibir = useCallback((promesa) => {
    promesa
      .then((datos) => setPrep({ datos }))
      .catch((e) => setPrep({ error: e?.message || 'No se pudieron revisar los resultados de la actividad.' }))
  }, [])
  useEffect(() => { recibir(llamarPreparacion(activity.id)) }, [activity.id, recibir])

  const cerrar = () => { if (!ejecutando) onCerrar() }
  useBackHandler(cerrar, true)

  async function generar() {
    if (ejecutando) return
    setEjecutando(true)
    try {
      const data = await creditosIA.ejecutar('analizar_entregable', {
        actividadId: activity.id,
        asignaturaId: activity.asignaturaId,
        costoConfirmado: prep.datos.costo,
      }, 1, { timeoutMs: 120000 })
      const analisisId = data?.resultado?.analisisId
      if (!analisisId) throw new Error('El análisis no devolvió un informe.')
      await onGenerado(analisisId)
    } catch (err) {
      toast(err.message, 'error')
      setEjecutando(false)
      if (err.codigo === 'COSTO_CAMBIO') {
        setConfirmando(false)
        setPrep({ cargando: true })
        recibir(llamarPreparacion(activity.id))
      }
    }
  }

  if (confirmando && prep.datos) {
    return (
      <ConfirmacionCreditosModal
        titulo="Analizar con IA"
        descripcion={`Se analizarán los resultados de toda la actividad${prep.datos.actividad?.etiqueta ? ` ${prep.datos.actividad.etiqueta}` : ''}. El informe se guardará en el historial de esta actividad.`}
        textoCosto={`Costo del análisis: ${prep.datos.costo} ${prep.datos.costo === 1 ? 'crédito' : 'créditos'}`}
        costoMin={prep.datos.costo}
        ejecutando={ejecutando}
        onCancelar={() => { if (!ejecutando) setConfirmando(false) }}
        onContinuar={generar}
      />
    )
  }

  const r = prep.datos?.resultados
  return (
    <Modal open onClose={cerrar} title="Analizar con IA" size="md">
      {prep.cargando ? (
        <div className="flex flex-col items-center gap-2 py-10">
          <Spinner size="lg" />
          <p className="text-sm text-muted">Revisando los resultados de la actividad…</p>
        </div>
      ) : prep.error ? (
        <div className="py-6 text-center space-y-3">
          <p className="text-sm text-on-surface">{prep.error}</p>
          <button type="button" onClick={() => { setPrep({ cargando: true }); recibir(llamarPreparacion(activity.id)) }}
            className="px-4 py-2.5 border border-accent text-accent text-sm font-medium rounded-full hover:bg-[var(--accent-tint)] transition-colors">
            Volver a intentar
          </button>
        </div>
      ) : !r.estudiantes ? (
        <p className="text-sm text-on-surface py-6 text-center">Esta asignatura todavía no tiene estudiantes inscritos: no hay resultados que analizar.</p>
      ) : (
        <>
          <p className="text-sm text-on-surface mb-3">
            El asistente analizará los <span className="font-semibold">resultados de toda la actividad</span>: entregas, calificaciones
            {prep.datos.instrumento ? ` y ${prep.datos.instrumento.toLowerCase()}` : ''}. No lee los archivos entregados ni modifica ningún dato.
          </p>
          <div className="rounded border border-outline-variant bg-surface-container px-3 py-2.5 mb-4 space-y-1">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Se analizará</p>
            <p className="text-sm text-on-surface">{cuenta(r.estudiantes, 'estudiante', 'estudiantes')} · {cuenta(r.entregaron, 'entregó', 'entregaron')} · {cuenta(r.noEntregaron, 'no entregó', 'no entregaron')} (vencida) · {cuenta(r.entregasTardias, 'tarde', 'tarde')}</p>
            <p className="text-sm text-on-surface">{cuenta(prep.datos.calificados, 'calificado', 'calificados')} · {cuenta(r.sinCalificar, 'entrega sin calificar', 'entregas sin calificar')}{r.calificadasSinArchivo ? ` · ${cuenta(r.calificadasSinArchivo, 'calificado sin archivo', 'calificados sin archivo')}` : ''}</p>
            <p className="text-sm font-semibold text-on-surface pt-1">Costo del análisis: {prep.datos.costo} {prep.datos.costo === 1 ? 'crédito' : 'créditos'}</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={cerrar}
              className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
              Cancelar
            </button>
            <button type="button" onClick={() => setConfirmando(true)}
              className="px-4 py-2.5 bg-accent text-white text-sm font-medium rounded-full hover:bg-accent-hover transition-colors">
              Continuar
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

export default function AnalisisEntregableIA({ activity, subject }) {
  const toast = useToast()
  const { userProfile } = useAuth()
  const telefonoWeb = useTelefonoWeb()
  const [abierto, setAbierto] = useState(false)
  const [historial, setHistorial] = useState([])
  const [viendo, setViendo] = useState(null)
  const [descargandoId, setDescargandoId] = useState(null)
  const esEntregable = fuenteDeActividad(activity) === 'entregables'

  const leerHistorial = useCallback(async () => {
    const snap = await getDocs(collection(db, 'activities', activity.id, 'analisisActividadIA'))
    // Más reciente primero — en memoria (sin orderBy, regla del proyecto).
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => millis(b.generadoEn) - millis(a.generadoEn))
  }, [activity.id])

  useEffect(() => {
    if (!esEntregable) return undefined
    let vivo = true
    leerHistorial().then((lista) => { if (vivo) setHistorial(lista) }).catch(() => {})
    return () => { vivo = false }
  }, [esEntregable, leerHistorial])

  // El informe ya está cobrado y guardado cuando esto corre.
  async function alGenerar(analisisId) {
    setAbierto(false)
    const [nuevo, lista] = await Promise.all([
      getDoc(doc(db, 'activities', activity.id, 'analisisActividadIA', analisisId))
        .then((snap) => (snap.exists() ? { id: snap.id, ...snap.data() } : null)).catch(() => null),
      leerHistorial().catch(() => null),
    ])
    if (lista) setHistorial(lista)
    if (nuevo) setViendo(nuevo)
    else toast('El análisis quedó guardado en el historial de esta actividad.')
  }

  async function descargarPDF(analisis) {
    if (descargaSoloWeb(toast)) return
    setDescargandoId(analisis.id)
    try {
      await exportAnalisisEntregablePDF({ analisis, subject, membrete: membreteDe(userProfile) })
    } catch (err) {
      toast('Error al generar el PDF: ' + err.message, 'error')
    } finally {
      setDescargandoId(null)
    }
  }

  // Solo se escribe la copia editada; el original de la IA no se toca.
  async function guardarEdicion(edicion) {
    try {
      await updateDoc(doc(db, 'activities', activity.id, 'analisisActividadIA', viendo.id), { edicion, editadoEn: serverTimestamp() })
      const actualizado = { ...viendo, edicion }
      setViendo(actualizado)
      setHistorial((prev) => prev.map((h) => (h.id === viendo.id ? actualizado : h)))
      toast(edicion ? 'Cambios guardados' : 'Se restauró el texto original')
    } catch (err) {
      toast('No se pudo guardar: ' + err.message, 'error')
      throw err
    }
  }

  if (!esEntregable) return null

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setAbierto(true)}
        data-tooltip="Analiza los resultados de toda la actividad. No modifica calificaciones ni entregas."
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-full border border-accent text-accent text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors">
        <Sparkles size={17} /> Analizar con IA
      </button>

      {historial.length > 0 && (
        <div className="rounded-card border border-outline-variant p-2.5 space-y-1">
          <p className="text-xs font-bold uppercase tracking-wide text-muted px-1">Historial de análisis</p>
          <ul className="divide-y divide-outline-variant">
            {historial.map((h) => (
              <li key={h.id} className="py-2 px-1 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-on-surface font-medium">{fechaAnalisis(h.generadoEn)}</p>
                  <p className="text-xs text-muted">{MODALIDADES_ENTREGABLE[h.modalidad] || 'Solo resultados'}{fueEditadoEntregable(h) ? ' · editado' : ''}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button type="button" onClick={() => setViendo(h)}
                    className="px-2.5 py-1 text-xs font-semibold border border-outline-variant rounded hover:bg-surface-container transition-colors">
                    Ver análisis
                  </button>
                  {!telefonoWeb.telefono && (
                    <button type="button" onClick={() => descargarPDF(h)} disabled={descargandoId === h.id}
                      className="px-2.5 py-1 text-xs font-semibold border border-outline-variant rounded hover:bg-surface-container transition-colors disabled:opacity-60">
                      {descargandoId === h.id ? 'Generando…' : 'Descargar PDF'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {abierto && <FlujoAnalisis activity={activity} onCerrar={() => setAbierto(false)} onGenerado={alGenerar} />}

      {viendo && (
        <InformeEntregable
          analisis={viendo}
          onClose={() => setViendo(null)}
          onDescargarPDF={() => descargarPDF(viendo)}
          descargando={descargandoId === viendo.id}
          puedeDescargar={!telefonoWeb.telefono}
          onGuardarEdicion={guardarEdicion}
        />
      )}
    </div>
  )
}
