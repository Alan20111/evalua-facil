// Apartado 2 de "Asistente IA": Diagnóstico del grupo (FASE 2-BIS del Plan
// Maestro de IA). Dos diagnósticos independientes — de contexto y de
// conocimientos — que se habilitan solo cuando ya existen fuentes iniciales
// generales (ver hayFuentesGenerales en utils/fuentesAsignatura.js).
//
// Cada "Generar diagnóstico" es una operación de IA con el mecanismo de
// créditos ya existente (useCreditosIA + ConfirmacionCreditosModal, mismo
// patrón que AvisosTab/EvaluacionManager). El resultado se guarda como una
// entrada NUEVA en subjects/{id}/diagnosticosIA — nunca se sobrescribe una
// generación anterior (mismo patrón de bitácora que activities/analisisIA).
import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { addDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import useCreditosIA from '../../hooks/useCreditosIA'
import { Sparkles, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'

const DEFS = {
  contexto: {
    operacion: 'diagnostico_contexto',
    titulo: 'Diagnóstico de contexto',
    descripcion: 'Qué características del grupo son relevantes para tu trabajo docente — a partir de tu Perfil IA y tus fuentes iniciales.',
  },
  conocimientos: {
    operacion: 'diagnostico_conocimientos',
    titulo: 'Diagnóstico de conocimientos',
    descripcion: 'Un instrumento breve que puedes aplicar al grupo para saber qué conocimientos previos ya tienen.',
  },
}

function ListaTexto({ items, vacioTexto }) {
  if (!items?.length) return <p className="text-xs text-muted italic">{vacioTexto}</p>
  return (
    <ul className="text-sm space-y-1 list-disc pl-4">
      {items.map((t, i) => <li key={i}>{t}</li>)}
    </ul>
  )
}

function ResultadoContexto({ resultado }) {
  return (
    <div className="space-y-3 mt-2">
      <div>
        <h4 className="text-xs font-semibold text-muted uppercase mb-1">Datos encontrados</h4>
        <ListaTexto items={resultado.datosEncontrados} vacioTexto="Información no disponible en las fuentes proporcionadas." />
      </div>
      <div>
        <h4 className="text-xs font-semibold text-muted uppercase mb-1">Interpretación</h4>
        <ListaTexto items={resultado.interpretacion} vacioTexto="Sin interpretación adicional." />
      </div>
      <div>
        <h4 className="text-xs font-semibold text-muted uppercase mb-1">Aspectos que requieren atención</h4>
        <ListaTexto items={resultado.aspectosAtencion} vacioTexto="Nada que destacar." />
      </div>
      <div>
        <h4 className="text-xs font-semibold text-muted uppercase mb-1">Información faltante</h4>
        <ListaTexto items={resultado.informacionFaltante} vacioTexto="Sin información faltante detectada." />
      </div>
    </div>
  )
}

function ResultadoConocimientos({ resultado }) {
  return (
    <div className="space-y-3 mt-2">
      <div>
        <h4 className="text-xs font-semibold text-muted uppercase mb-1">Temas a diagnosticar</h4>
        <ListaTexto items={resultado.temas} vacioTexto="Información no disponible en las fuentes proporcionadas." />
      </div>
      <div>
        <h4 className="text-xs font-semibold text-muted uppercase mb-1">Reactivos ({resultado.reactivos?.length || 0})</h4>
        <div className="space-y-2">
          {(resultado.reactivos || []).map((r, i) => (
            <div key={i} className="text-sm border border-outline-variant rounded p-2">
              <p className="font-medium">{i + 1}. {r.enunciado}</p>
              {r.tipo === 'opcion_multiple' ? (
                <ul className="mt-1 pl-4 list-disc text-xs">
                  {r.opciones.map((o, j) => (
                    <li key={j} className={j === r.correcta ? 'font-semibold text-green-700' : ''}>{o}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs mt-1">Verdadero/Falso — correcta: <span className="font-semibold">{r.correcta === 'f' ? 'Falso' : 'Verdadero'}</span></p>
              )}
            </div>
          ))}
        </div>
      </div>
      {resultado.comoInterpretar && (
        <div>
          <h4 className="text-xs font-semibold text-muted uppercase mb-1">Cómo interpretar los resultados</h4>
          <p className="text-sm">{resultado.comoInterpretar}</p>
        </div>
      )}
    </div>
  )
}

function millisDe(ts) {
  return ts?.toMillis?.() || 0
}

function DiagnosticoBloque({ tipo, subjectId, docenteId, asignaturaNombre }) {
  const def = DEFS[tipo]
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const [historial, setHistorial] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [verHistorial, setVerHistorial] = useState(false)

  useEffect(() => {
    const q = query(
      collection(db, 'subjects', subjectId, 'diagnosticosIA'),
      where('tipo', '==', tipo)
    )
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      items.sort((a, b) => millisDe(b.generadoEn) - millisDe(a.generadoEn))
      setHistorial(items)
      setLoaded(true)
    }, () => setLoaded(true))
    return unsub
  }, [subjectId, tipo])

  async function generar() {
    setGenerando(true)
    try {
      const data = await creditosIA.ejecutar(def.operacion, { subjectId, asignaturaId: subjectId, asignaturaNombre })
      setConfirmando(false)
      if (data?.resultado) {
        await addDoc(collection(db, 'subjects', subjectId, 'diagnosticosIA'), {
          tipo,
          resultado: data.resultado,
          docenteId,
          generadoEn: serverTimestamp(),
        })
        toast(data.repetida ? 'Se recuperó la generación ya hecha (sin costo adicional)' : 'Diagnóstico generado')
      }
    } catch (err) {
      setConfirmando(false)
      if (err.codigo === 'SALDO_INSUFICIENTE') {
        toast('No tienes suficientes créditos de IA para esta acción', 'error')
      } else if (err.codigo === 'PERFIL_IA_INCOMPLETO') {
        toast('Completa primero tu Perfil para IA del docente', 'error')
      } else if (err.codigo === 'SIN_FUENTES_GENERALES') {
        toast('Agrega primero un documento en Fuentes para todo el curso', 'error')
      } else {
        toast(err.message || 'El asistente de IA no está disponible en este momento', 'error')
      }
    } finally {
      setGenerando(false)
    }
  }

  const actual = historial[0] || null
  const anteriores = historial.slice(1)

  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-on-surface text-sm">{def.titulo}</h3>
          <p className="text-xs text-muted mt-0.5">{def.descripcion}</p>
        </div>
      </div>

      {!loaded ? (
        <div className="flex justify-center py-4"><Spinner size="sm" /></div>
      ) : (
        <div className="mt-3">
          {!actual ? (
            <p className="text-xs text-muted mb-2">Estado: <span className="font-medium">No generado</span></p>
          ) : (
            <p className="text-xs text-muted mb-2">
              Estado: <span className="font-medium text-green-700">Generado</span>
              {actual.generadoEn?.toDate && ` · ${actual.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
            </p>
          )}

          <button
            type="button"
            onClick={() => setConfirmando(true)}
            disabled={generando}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
          >
            {generando ? <Spinner size="sm" /> : actual ? <RotateCcw size={14} /> : <Sparkles size={14} />}
            {actual ? 'Generar de nuevo' : 'Generar diagnóstico'}
          </button>

          {actual && (
            tipo === 'contexto'
              ? <ResultadoContexto resultado={actual.resultado} />
              : <ResultadoConocimientos resultado={actual.resultado} />
          )}

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
                <div className="mt-2 space-y-3">
                  {anteriores.map((h) => (
                    <div key={h.id} className="opacity-70 border-t border-outline-variant pt-2">
                      <p className="text-xs text-muted mb-1">
                        {h.generadoEn?.toDate && h.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                      {tipo === 'contexto'
                        ? <ResultadoContexto resultado={h.resultado} />
                        : <ResultadoConocimientos resultado={h.resultado} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {confirmando && (
        <ConfirmacionCreditosModal
          titulo={def.titulo}
          descripcion="La IA usa tu Perfil para IA y tus fuentes iniciales generales ya guardadas — no necesitas subir nada de nuevo."
          costoMin={creditosIA.estimar(def.operacion) ?? (tipo === 'contexto' ? 5 : 10)}
          ejecutando={generando}
          onCancelar={() => { if (!generando) setConfirmando(false) }}
          onContinuar={generar}
        />
      )}
    </div>
  )
}

export default function DiagnosticoGrupoSection({ subjectId, docenteId, asignaturaNombre, habilitado }) {
  if (!habilitado) {
    return (
      <div className="bg-surface-card rounded-card shadow-card p-3">
        <h2 className="font-bold text-on-surface">Diagnóstico del grupo</h2>
        <p className="text-sm text-muted mt-1">
          Agrega primero al menos un documento (arriba, en &ldquo;Fuentes para todo el curso&rdquo;)
          para poder generar los diagnósticos de este grupo.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-on-surface">Diagnóstico del grupo</h2>
        <p className="text-sm text-muted mt-0.5">
          Genera cada diagnóstico cuando quieras; puedes volver a generarlo si el resultado no
          te parece adecuado — las generaciones anteriores no se pierden.
        </p>
      </div>
      <DiagnosticoBloque tipo="contexto" subjectId={subjectId} docenteId={docenteId} asignaturaNombre={asignaturaNombre} />
      <DiagnosticoBloque tipo="conocimientos" subjectId={subjectId} docenteId={docenteId} asignaturaNombre={asignaturaNombre} />
    </div>
  )
}
