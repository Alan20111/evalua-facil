// Apartado 3 de "Asistente IA": Planeación Didáctica Inicial (FASE 2-BIS del
// Plan Maestro de IA). Se habilita solo cuando ya existen fuentes generales
// y AMBOS diagnósticos (contexto y conocimientos) — la secuencia completa.
// Genera una PROPUESTA en Excel para los parciales reales de la asignatura;
// el docente la revisa, puede regenerarla y descargarla — nunca se aplica
// sola a ningún otro módulo de Evalúa Fácil.
import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { addDoc, updateDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import ConfirmModal from '../ConfirmModal'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import useCreditosIA from '../../hooks/useCreditosIA'
import useDiagnosticoEstado from '../../hooks/useDiagnosticoEstado'
import { descargarPlaneacionExcel } from '../../utils/planeacionExcel'
import { CheckCircle2, Circle, Sparkles, RotateCcw, Download, ChevronDown, ChevronUp, ThumbsUp } from 'lucide-react'

function millisDe(ts) {
  return ts?.toMillis?.() || 0
}

function RequisitoItem({ ok, texto }) {
  return (
    <li className={`flex items-center gap-1.5 text-xs ${ok ? 'text-green-700' : 'text-muted'}`}>
      {ok ? <CheckCircle2 size={14} /> : <Circle size={14} />}
      {texto}
    </li>
  )
}

// Señal visual del estado real de Planeación — discreta, junto al título.
// "Lista" exige los dos diagnósticos con análisis real (mismo criterio que
// habilita el botón, sin contar fuentes — ver spec de Kike, 13-ago-2026).
function EstadoPlaneacionBadge({ lista }) {
  const className = lista
    ? 'bg-green-50 text-green-700 border-green-200'
    : 'bg-amber-50 text-amber-700 border-amber-200'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>
      {lista ? 'Lista para generar' : 'Pendiente de diagnósticos'}
    </span>
  )
}

export default function PlaneacionInicialSection({ subjectId, docenteId, subject, asignaturaNombre, hayFuentesGenerales, watermark = false }) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const [historial, setHistorial] = useState([])
  const [histLoaded, setHistLoaded] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [formato, setFormato] = useState('simple')
  const [generando, setGenerando] = useState(false)
  const [descargandoId, setDescargandoId] = useState(null)
  const [verHistorial, setVerHistorial] = useState(false)
  const [aceptando, setAceptando] = useState(false)
  const [confirmarAceptar, setConfirmarAceptar] = useState(false)

  // El diagnóstico "real" (Tandas 1 y 2) vive en `activities` — no en la
  // vieja `subjects/{id}/diagnosticosIA` (reporte simulado, descartado).
  // Mismo hook que usa DiagnosticoGrupoSection para su propia señal visual —
  // 'completado' es exactamente lo que ya validaba este componente (existe
  // un análisis real en activities/{id}/analisisIA), igual que el servidor
  // en analisisDiagnosticoMasReciente.
  const { estado: estadoContexto, cargado: contextoCargado } = useDiagnosticoEstado(subjectId, 'contexto')
  const { estado: estadoConocimientos, cargado: conocimientosCargado } = useDiagnosticoEstado(subjectId, 'conocimientos')
  const hayContexto = estadoContexto === 'completado'
  const hayConocimientos = estadoConocimientos === 'completado'
  const diagLoaded = contextoCargado && conocimientosCargado

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'subjects', subjectId, 'planeacionesIA'), (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      // Sin orderBy en la consulta (restricción del proyecto) — se ordena en
      // memoria, más recientes primero.
      items.sort((a, b) => millisDe(b.generadoEn) - millisDe(a.generadoEn))
      setHistorial(items)
      setHistLoaded(true)
    }, () => setHistLoaded(true))
    return unsub
  }, [subjectId])

  const habilitado = hayFuentesGenerales && hayContexto && hayConocimientos

  async function generar() {
    setGenerando(true)
    try {
      const data = await creditosIA.ejecutar('planeacion_didactica_inicial', { subjectId, asignaturaId: subjectId, asignaturaNombre, formato })
      setConfirmando(false)
      if (data?.resultado) {
        await addDoc(collection(db, 'subjects', subjectId, 'planeacionesIA'), {
          resultado: data.resultado,
          docenteId,
          formato,
          generadoEn: serverTimestamp(),
        })
        toast(data.repetida ? 'Se recuperó la generación ya hecha (sin costo adicional)' : 'Planeación generada — revísala y acéptala cuando estés conforme')
      }
    } catch (err) {
      setConfirmando(false)
      if (err.codigo === 'SALDO_INSUFICIENTE') toast('No tienes suficientes créditos de IA para esta acción', 'error')
      else if (err.codigo === 'PERFIL_IA_INCOMPLETO') toast('Completa primero tu Perfil para IA del docente', 'error')
      else if (err.codigo === 'SIN_FUENTES_GENERALES') toast('Agrega primero un documento en Fuentes para todo el curso', 'error')
      else if (err.codigo === 'SIN_DIAGNOSTICO_CONTEXTO') toast('Genera primero el Diagnóstico de contexto', 'error')
      else if (err.codigo === 'SIN_DIAGNOSTICO_CONOCIMIENTOS') toast('Genera primero el Diagnóstico de conocimientos', 'error')
      else toast(err.message || 'El asistente de IA no está disponible en este momento', 'error')
    } finally {
      setGenerando(false)
    }
  }

  // Fija la Planeación PARA SIEMPRE (decisión de Kike, 13-ago-2026): a
  // partir de aquí ya no se ofrece "Generar de nuevo" — la IA usa esta
  // versión para todo lo que genere después. Se guarda en `subjects/{id}`
  // (no en el doc de planeacionesIA, que es una bitácora inmutable/
  // append-only — ver firestore.rules) para no necesitar tocar esa regla.
  async function aceptar() {
    setAceptando(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionAceptada: { planeacionId: actual.id, aceptadaEn: serverTimestamp() },
      })
      toast('Planeación aceptada — a partir de aquí la usa la IA para todo lo demás')
    } catch (err) {
      toast('No se pudo aceptar: ' + err.message, 'error')
    } finally {
      setAceptando(false)
      setConfirmarAceptar(false)
    }
  }

  // La descarga NUNCA pasa por el servidor ni por créditos: el .xlsx se
  // arma en el navegador a partir del `resultado` ya guardado.
  async function descargar(entry) {
    setDescargandoId(entry.id)
    try {
      await descargarPlaneacionExcel({ subject, resultado: entry.resultado, watermark })
    } catch (err) {
      toast('No se pudo generar el Excel: ' + err.message, 'error')
    } finally {
      setDescargandoId(null)
    }
  }

  const actual = historial[0] || null
  const anteriores = historial.slice(1)
  // Aceptada = fija para siempre — ya no se ofrece "Generar de nuevo". Se
  // guarda en subjects/{id}.planeacionAceptada (no en el doc de
  // planeacionesIA, inmutable/append-only). Si el docente generó otra
  // versión sin aceptar la anterior, esa aceptación queda "huérfana"
  // apuntando a un id que ya no es `actual` — se trata como no aceptada,
  // nunca se hereda a una generación distinta de la que de verdad se aceptó.
  const aceptada = !!actual && subject?.planeacionAceptada?.planeacionId === actual.id
  const fechaAceptada = aceptada ? subject.planeacionAceptada.aceptadaEn : null

  if (!diagLoaded || !histLoaded) {
    return (
      <div className="bg-surface-card rounded-card shadow-card p-3 flex justify-center py-6">
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-bold text-on-surface">Planeación Didáctica Inicial</h2>
        <EstadoPlaneacionBadge lista={hayContexto && hayConocimientos} />
      </div>
      <p className="text-sm text-muted mt-0.5 mb-2">
        Una guía de trabajo sencilla, con una hoja de Excel por parcial, para que copies lo que te
        sirva a tu formato institucional. No sustituye el formato oficial de tu escuela.
      </p>

      {!habilitado && (
        <ul className="space-y-1 mb-1">
          <RequisitoItem ok={hayFuentesGenerales} texto="Fuentes para todo el curso" />
          <RequisitoItem ok={hayContexto} texto="Diagnóstico de contexto generado" />
          <RequisitoItem ok={hayConocimientos} texto="Diagnóstico de conocimientos generado" />
        </ul>
      )}

      {habilitado && (
        <>
          {!actual ? (
            <p className="text-xs text-muted mb-2">Estado: <span className="font-medium">No generada</span></p>
          ) : aceptada ? (
            <p className="text-xs text-muted mb-2">
              Estado: <span className="font-medium text-green-700">Aceptada — la usa la IA para todo lo demás</span>
              {fechaAceptada?.toDate && ` · ${fechaAceptada.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
            </p>
          ) : (
            <p className="text-xs text-muted mb-2">
              Estado: <span className="font-medium text-amber-700">Generada, sin aceptar todavía</span>
              {actual.generadoEn?.toDate && ` · ${actual.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
              . Si no te convence, edita los Comentarios generales del grupo (arriba) y genera de nuevo — solo cuando
              la aceptes queda fija.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!aceptada && (
              <button
                type="button"
                onClick={() => setConfirmando(true)}
                disabled={generando}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
              >
                {generando ? <Spinner size="sm" /> : actual ? <RotateCcw size={14} /> : <Sparkles size={14} />}
                {actual ? 'Generar de nuevo' : 'Generar planeación'}
              </button>
            )}
            {actual && (
              <button
                type="button"
                onClick={() => descargar(actual)}
                disabled={descargandoId === actual.id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-sm hover:bg-accent-hover disabled:opacity-60"
              >
                {descargandoId === actual.id ? <Spinner size="sm" /> : <Download size={14} />}
                Descargar Excel
              </button>
            )}
            {actual && !aceptada && (
              <button
                type="button"
                onClick={() => setConfirmarAceptar(true)}
                disabled={aceptando}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-green-600 text-green-700 text-sm hover:bg-green-50 disabled:opacity-60"
              >
                {aceptando ? <Spinner size="sm" /> : <ThumbsUp size={14} />}
                Aceptar planeación
              </button>
            )}
          </div>

          {anteriores.length > 0 && (
            <div className="mt-3 pt-2 border-t border-outline-variant">
              <button
                type="button"
                onClick={() => setVerHistorial((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted hover:text-on-surface"
              >
                {verHistorial ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {anteriores.length} generación{anteriores.length > 1 ? 'es' : ''} anterior{anteriores.length > 1 ? 'es' : ''}
              </button>
              {verHistorial && (
                <div className="mt-2 space-y-1.5">
                  {anteriores.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted">
                        {h.generadoEn?.toDate && h.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                      <button
                        type="button"
                        onClick={() => descargar(h)}
                        disabled={descargandoId === h.id}
                        className="flex items-center gap-1 text-accent hover:underline disabled:opacity-60"
                      >
                        {descargandoId === h.id ? <Spinner size="sm" /> : <Download size={12} />} Descargar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {confirmando && (
        <ConfirmacionCreditosModal
          titulo="Generar Planeación Didáctica Inicial"
          descripcion="La IA usa tu Perfil IA, tus fuentes ya guardadas y los diagnósticos del grupo — genera todos los parciales en una sola operación."
          costoMin={creditosIA.estimar('planeacion_didactica_inicial') ?? 20}
          ejecutando={generando}
          onCancelar={() => { if (!generando) setConfirmando(false) }}
          onContinuar={generar}
        >
          <fieldset className="mb-2">
            <legend className="text-sm text-on-surface mb-1">Formato</legend>
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input
                type="radio"
                name="planeacion-formato"
                aria-label="Simple"
                checked={formato === 'simple'}
                disabled={generando}
                onChange={() => setFormato('simple')}
                className="mt-0.5"
              />
              <span className="text-sm text-on-surface">
                <strong>Simple</strong>
                <span className="block text-xs text-muted">Hasta 8 bloques agrupados por parcial — vista rápida.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input
                type="radio"
                name="planeacion-formato"
                aria-label="Completo por tema"
                checked={formato === 'completo'}
                disabled={generando}
                onChange={() => setFormato('completo')}
                className="mt-0.5"
              />
              <span className="text-sm text-on-surface">
                <strong>Completo por tema</strong>
                <span className="block text-xs text-muted">Una fila por cada tema real de tus fuentes — más detallado, más filas.</span>
              </span>
            </label>
          </fieldset>
        </ConfirmacionCreditosModal>
      )}

      {confirmarAceptar && (
        <ConfirmModal
          title="¿Aceptar esta Planeación Didáctica Inicial?"
          message="A partir de aquí queda fija, con la fecha de hoy, y es la que usará el Asistente IA para todo lo demás. Ya no podrás generar otra versión desde aquí."
          confirmLabel="Aceptar"
          confirmingLabel="Aceptando…"
          busy={aceptando}
          onConfirm={aceptar}
          onCancel={() => { if (!aceptando) setConfirmarAceptar(false) }}
        />
      )}
    </div>
  )
}
