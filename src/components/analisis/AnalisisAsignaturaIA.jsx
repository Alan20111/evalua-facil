import { useCallback, useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../../firebase'
import { useToast } from '../Toast'
import Modal from '../ui/Modal'
import Spinner from '../Spinner'
import useCreditosIA from '../../hooks/useCreditosIA'
import { useBackHandler } from '../../hooks/useBackHandler'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import ConfigAnalisisAsignatura from './ConfigAnalisisAsignatura'
import InformeAsignatura from './InformeAsignatura'
import { exportAnalisisAsignaturaPDF } from '../../utils/pdf'
import { descargaSoloWeb } from '../../utils/descargaSoloWeb'
import { fechaAnalisis, textoParciales, textoFuentes } from '../../utils/analisisAsignaturaInforme'

// Análisis integral de asignatura con IA — todo lo que vive en Calificaciones
// salvo el botón que lo abre: el diálogo de configuración, la confirmación del
// costo, el informe y el historial.
//
// El cliente no manda ningún dato académico: solo la asignatura, los
// parciales y las fuentes elegidas. El servidor relee todo, calcula, cobra y
// GUARDA el informe (subjects/{id}/analisisIA); aquí solo se lee. Abrir un
// análisis del historial o descargar su PDF no llama a la IA ni cuesta nada.
const millis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : 0)

const llamarPreparacion = (subjectId) =>
  httpsCallable(functions, 'prepararAnalisisAsignatura')({ asignaturaId: subjectId }).then((r) => r.data)

// El flujo de un análisis NUEVO: revisar datos → configurar → confirmar costo
// → ejecutar. Solo existe mientras el diálogo está abierto, así cada apertura
// vuelve a revisar los datos ACTUALES de la asignatura.
function FlujoAnalisis({ subjectId, onCerrar, onGenerado }) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  // { cargando } | { error } | { datos, version }
  const [preparacion, setPreparacion] = useState({ cargando: true })
  const [seleccion, setSeleccion] = useState(null) // { parciales, fuentes, costo } ya revisada, esperando confirmación
  const [ejecutando, setEjecutando] = useState(false)

  const recibir = useCallback((promesa) => {
    promesa
      .then((datos) => setPreparacion((prev) => ({ datos, version: (prev.version || 0) + 1 })))
      .catch((e) => setPreparacion({ error: e?.message || 'No se pudieron revisar los datos de la asignatura.' }))
  }, [])

  useEffect(() => { recibir(llamarPreparacion(subjectId)) }, [subjectId, recibir])

  function reintentar() {
    setPreparacion({ cargando: true })
    recibir(llamarPreparacion(subjectId))
  }

  const cerrar = () => { if (!ejecutando) onCerrar() }
  useBackHandler(cerrar, true)

  async function generar() {
    if (!seleccion || ejecutando) return
    setEjecutando(true)
    try {
      const data = await creditosIA.ejecutar('analizar_asignatura', {
        asignaturaId: subjectId,
        parciales: seleccion.parciales,
        fuentes: seleccion.fuentes,
        costoConfirmado: seleccion.costo,
      }, seleccion.costo, { timeoutMs: 280000 })
      const analisisId = data?.resultado?.analisisId
      if (!analisisId) throw new Error('El análisis no devolvió un informe.')
      await onGenerado(analisisId)
    } catch (err) {
      toast(err.message, 'error')
      setEjecutando(false)
      // Los datos cambiaron entre la pantalla y la confirmación: no se cobró
      // nada; se vuelve a la configuración con los datos actuales.
      if (err.codigo === 'COSTO_CAMBIO' || err.codigo === 'CONTEXTO_INSUFICIENTE') {
        setSeleccion(null)
        reintentar()
      }
    }
  }

  if (seleccion) {
    return (
      <ConfirmacionCreditosModal
        titulo="Analizar asignatura con IA"
        descripcion={`Se analizará: ${textoParciales(seleccion.parciales)} · ${textoFuentes(seleccion.fuentes)}. El informe se guardará en el historial de esta asignatura.`}
        textoCosto={`Costo del análisis: ${seleccion.costo} ${seleccion.costo === 1 ? 'crédito' : 'créditos'}`}
        costoMin={seleccion.costo}
        ejecutando={ejecutando}
        onCancelar={() => { if (!ejecutando) setSeleccion(null) }}
        onContinuar={generar}
      />
    )
  }

  return (
    <Modal open onClose={cerrar} title="Analizar asignatura con IA" size="lg">
      <p className="text-sm text-muted mb-4">
        Elige qué quieres analizar. El asistente interpreta los datos de tu asignatura y prepara un informe; no modifica calificaciones ni ningún otro dato.
      </p>
      {preparacion.cargando ? (
        <div className="flex flex-col items-center gap-2 py-10">
          <Spinner size="lg" />
          <p className="text-sm text-muted">Revisando los datos de la asignatura…</p>
        </div>
      ) : preparacion.error ? (
        <div className="py-6 text-center space-y-3">
          <p className="text-sm text-on-surface">{preparacion.error}</p>
          <button type="button" onClick={reintentar}
            className="px-4 py-2.5 border border-accent text-accent text-sm font-medium rounded hover:bg-[var(--accent-tint)] transition-colors">
            Volver a intentar
          </button>
        </div>
      ) : (
        <ConfigAnalisisAsignatura
          key={preparacion.version}
          preparacion={preparacion.datos}
          onCancelar={cerrar}
          onContinuar={setSeleccion}
        />
      )}
    </Modal>
  )
}

export default function AnalisisAsignaturaIA({ subject, subjectId, membrete = null, abierto, onCerrar }) {
  const toast = useToast()
  const [historial, setHistorial] = useState([])
  const [viendo, setViendo] = useState(null)
  const [descargandoId, setDescargandoId] = useState(null)

  const leerHistorial = useCallback(async () => {
    const snap = await getDocs(collection(db, 'subjects', subjectId, 'analisisIA'))
    // Más reciente primero — en memoria (sin orderBy, regla del proyecto).
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => millis(b.generadoEn) - millis(a.generadoEn))
  }, [subjectId])

  useEffect(() => {
    let vivo = true
    // Sin historial visible no se bloquea nada: el botón sigue funcionando.
    leerHistorial().then((lista) => { if (vivo) setHistorial(lista) }).catch(() => {})
    return () => { vivo = false }
  }, [leerHistorial])

  // El informe ya está cobrado y guardado cuando esto corre: un tropiezo al
  // leerlo de vuelta no debe verse como un fallo del análisis.
  async function alGenerar(analisisId) {
    onCerrar()
    const [nuevo, lista] = await Promise.all([
      getDoc(doc(db, 'subjects', subjectId, 'analisisIA', analisisId))
        .then((snap) => (snap.exists() ? { id: snap.id, ...snap.data() } : null))
        .catch(() => null),
      leerHistorial().catch(() => null),
    ])
    if (lista) setHistorial(lista)
    if (nuevo) setViendo(nuevo)
    else toast('El análisis quedó guardado en el historial de esta asignatura.')
  }

  async function descargarPDF(analisis) {
    if (descargaSoloWeb(toast)) return
    setDescargandoId(analisis.id)
    try {
      await exportAnalisisAsignaturaPDF({ analisis, subject, membrete })
    } catch (err) {
      toast('Error al generar el PDF: ' + err.message, 'error')
    } finally {
      setDescargandoId(null)
    }
  }

  return (
    <>
      {historial.length > 0 && (
        <div className="bg-surface-card rounded-card shadow-card p-3 space-y-1">
          <p className="text-xs font-bold uppercase tracking-wide text-muted px-1">Historial de análisis</p>
          <ul className="divide-y divide-outline-variant">
            {historial.map((h) => (
              <li key={h.id} className="py-2 px-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-on-surface font-medium">{fechaAnalisis(h.generadoEn)}</p>
                  <p className="text-xs text-muted">{textoParciales(h.parciales)} · {textoFuentes(h.fuentes)}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button type="button" onClick={() => setViendo(h)}
                    className="px-2.5 py-1 text-xs font-semibold border border-outline-variant rounded hover:bg-surface-container transition-colors">
                    Ver análisis
                  </button>
                  <button type="button" onClick={() => descargarPDF(h)} disabled={descargandoId === h.id}
                    className="px-2.5 py-1 text-xs font-semibold border border-outline-variant rounded hover:bg-surface-container transition-colors disabled:opacity-60">
                    {descargandoId === h.id ? 'Generando…' : 'Descargar PDF'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {abierto && <FlujoAnalisis subjectId={subjectId} onCerrar={onCerrar} onGenerado={alGenerar} />}

      {viendo && (
        <InformeAsignatura
          analisis={viendo}
          onClose={() => setViendo(null)}
          onDescargarPDF={() => descargarPDF(viendo)}
          descargando={descargandoId === viendo.id}
        />
      )}
    </>
  )
}
