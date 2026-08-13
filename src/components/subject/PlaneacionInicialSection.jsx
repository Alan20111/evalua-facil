// Apartado 3 de "Asistente IA": Planeación Didáctica Inicial (FASE 2-BIS del
// Plan Maestro de IA). Se habilita solo cuando ya existen fuentes generales
// y AMBOS diagnósticos (contexto y conocimientos) — la secuencia completa.
// Genera una PROPUESTA en Excel para los parciales reales de la asignatura;
// el docente la revisa, puede regenerarla y descargarla — nunca se aplica
// sola a ningún otro módulo de Evalúa Fácil.
import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { addDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import useCreditosIA from '../../hooks/useCreditosIA'
import { descargarPlaneacionExcel } from '../../utils/planeacionExcel'
import { CheckCircle2, Circle, Sparkles, RotateCcw, Download, ChevronDown, ChevronUp } from 'lucide-react'

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

export default function PlaneacionInicialSection({ subjectId, docenteId, subject, asignaturaNombre, hayFuentesGenerales, watermark = false }) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const [hayContexto, setHayContexto] = useState(false)
  const [hayConocimientos, setHayConocimientos] = useState(false)
  const [diagLoaded, setDiagLoaded] = useState(false)
  const [historial, setHistorial] = useState([])
  const [histLoaded, setHistLoaded] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [descargandoId, setDescargandoId] = useState(null)
  const [verHistorial, setVerHistorial] = useState(false)

  // El diagnóstico "real" (Tandas 1 y 2) vive en `activities` — no en la
  // vieja `subjects/{id}/diagnosticosIA` (reporte simulado, descartado). Se
  // considera cumplido cuando existe al menos una actividad de ese tipo con
  // un análisis de IA ya generado (activities/{id}/analisisIA), igual que
  // valida el servidor en analisisDiagnosticoMasReciente.
  useEffect(() => {
    let cancelado = false
    const loadedTipos = new Set()
    const unsubsPorTipo = { contexto: [], conocimientos: [] }

    function escucharTipo(tipo, setHay) {
      const q = query(
        collection(db, 'activities'),
        where('asignaturaId', '==', subjectId),
        where('diagnosticoTipo', '==', tipo),
      )
      const analisisUnsubs = new Map() // actividadId -> unsub
      const analisisConDatos = new Set()

      const unsubActividades = onSnapshot(q, (snap) => {
        if (cancelado) return
        const idsActuales = new Set(snap.docs.map((d) => d.id))

        for (const [id, unsub] of analisisUnsubs) {
          if (!idsActuales.has(id)) {
            unsub()
            analisisUnsubs.delete(id)
            analisisConDatos.delete(id)
          }
        }

        snap.docs.forEach((d) => {
          if (analisisUnsubs.has(d.id)) return
          const unsub = onSnapshot(collection(db, 'activities', d.id, 'analisisIA'), (analisisSnap) => {
            if (cancelado) return
            if (analisisSnap.empty) analisisConDatos.delete(d.id)
            else analisisConDatos.add(d.id)
            setHay(analisisConDatos.size > 0)
          })
          analisisUnsubs.set(d.id, unsub)
        })

        setHay(analisisConDatos.size > 0)
        loadedTipos.add(tipo)
        if (loadedTipos.size === 2) setDiagLoaded(true)
      }, () => {
        loadedTipos.add(tipo)
        if (loadedTipos.size === 2) setDiagLoaded(true)
      })

      unsubsPorTipo[tipo].push(unsubActividades, () => analisisUnsubs.forEach((unsub) => unsub()))
    }

    escucharTipo('contexto', setHayContexto)
    escucharTipo('conocimientos', setHayConocimientos)

    return () => {
      cancelado = true
      unsubsPorTipo.contexto.forEach((unsub) => unsub())
      unsubsPorTipo.conocimientos.forEach((unsub) => unsub())
    }
  }, [subjectId])

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
      const data = await creditosIA.ejecutar('planeacion_didactica_inicial', { subjectId, asignaturaId: subjectId, asignaturaNombre })
      setConfirmando(false)
      if (data?.resultado) {
        await addDoc(collection(db, 'subjects', subjectId, 'planeacionesIA'), {
          resultado: data.resultado,
          docenteId,
          generadoEn: serverTimestamp(),
        })
        toast(data.repetida ? 'Se recuperó la generación ya hecha (sin costo adicional)' : 'Planeación generada')
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

  if (!diagLoaded || !histLoaded) {
    return (
      <div className="bg-surface-card rounded-card shadow-card p-3 flex justify-center py-6">
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <h2 className="font-bold text-on-surface">Planeación Didáctica Inicial</h2>
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
          ) : (
            <p className="text-xs text-muted mb-2">
              Estado: <span className="font-medium text-green-700">Generada</span>
              {actual.generadoEn?.toDate && ` · ${actual.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              disabled={generando}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
            >
              {generando ? <Spinner size="sm" /> : actual ? <RotateCcw size={14} /> : <Sparkles size={14} />}
              {actual ? 'Generar de nuevo' : 'Generar planeación'}
            </button>
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
        />
      )}
    </div>
  )
}
