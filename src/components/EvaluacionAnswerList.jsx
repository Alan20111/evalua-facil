import { CheckCircle2, XCircle, MessageSquare, FileText } from 'lucide-react'
import { TIPOS_REVISION_MANUAL } from '../utils/evaluacionGrading'

// Read-only per-question review shared by the student's post-evaluación review
// (src/pages/student/EvaluacionRevision.jsx) and the teacher's specialized
// review (EvaluacionManager). Single source of truth for how an evaluación
// answer sheet renders: each question, the student's answer, a correct/incorrect
// indicator, the correct option (when `mostrarCorrectas`) and feedback (when
// `mostrarRetro`).
//
// `renderGrading(pregunta, respuesta)` — optional. When provided, it replaces the
// static points/"pendiente" line for `respuesta_corta` questions, letting the
// teacher view inject inline grading inputs. When absent (student view), the
// stored points or "Pendiente de revisión" is shown instead.
export default function EvaluacionAnswerList({
  preguntas,
  respuestas,
  mostrarCorrectas = true,
  mostrarRetro = true,
  renderGrading = null,
}) {
  return (
    <div className="space-y-3">
      {preguntas.map((p, i) => {
        const respuesta = respuestas[p.id] || {}
        const esObjetiva = !TIPOS_REVISION_MANUAL.includes(p.tipo)
        // Whether the student's pick was right — drives the ✓/✗ on their choice.
        const acierto = esObjetiva && respuesta.opcionSeleccionada === p.respuestaCorrecta
        return (
          <div key={p.id} className="bg-surface-card rounded-card p-4 shadow-card border border-outline-variant">
            <p className="text-sm font-medium text-on-surface mb-2">{i + 1}. {p.enunciado}</p>
            {p.imagenUrl && <img src={p.imagenUrl} alt="" className="max-h-48 rounded border border-outline-variant mb-2" />}

            {esObjetiva ? (
              <div className="space-y-1.5">
                {(p.opciones || []).map((o) => {
                  const esSeleccion = respuesta.opcionSeleccionada === o.id
                  const esCorrecta = mostrarCorrectas && o.id === p.respuestaCorrecta
                  return (
                    <div key={o.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded border text-sm ${
                        esCorrecta ? 'border-emerald-300 bg-emerald-50 text-emerald-700' :
                        esSeleccion ? 'border-accent bg-accent-light' : 'border-outline-variant'
                      }`}>
                      {esSeleccion && (acierto
                        ? <CheckCircle2 size={15} className="text-emerald-600 flex-shrink-0" />
                        : <XCircle size={15} className="text-error flex-shrink-0" />)}
                      <span>{o.texto}</span>
                      {esCorrecta && !esSeleccion && <span className="ml-auto text-xs font-medium">Correcta</span>}
                    </div>
                  )
                })}
                {!respuesta.opcionSeleccionada && <p className="text-xs text-slate-400 italic">Sin respuesta</p>}
              </div>
            ) : (
              <div className="space-y-1.5">
                {p.tipo === 'subir_archivo' ? (
                  respuesta.archivoURL ? (
                    <a href={respuesta.archivoURL} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-accent bg-surface rounded p-2 hover:underline">
                      <FileText size={16} className="flex-shrink-0" />
                      <span className="truncate">{respuesta.nombreArchivo || 'Documento entregado'}</span>
                    </a>
                  ) : (
                    <p className="text-sm text-muted bg-surface rounded p-2 italic">(sin archivo)</p>
                  )
                ) : (
                  <p className="text-sm text-muted bg-surface rounded p-2 whitespace-pre-wrap">{respuesta.textoRespuesta || '(sin respuesta)'}</p>
                )}
                {renderGrading
                  ? renderGrading(p, respuesta)
                  : respuesta.puntosObtenidos != null
                    ? <p className="text-xs text-muted">Puntos: {respuesta.puntosObtenidos}/{p.ponderacion}</p>
                    : <p className="text-xs text-amber-600">Pendiente de revisión</p>}
              </div>
            )}

            {mostrarRetro && p.retroalimentacion && (
              <div className="mt-2 bg-surface rounded p-2.5 flex gap-2">
                <MessageSquare size={15} className="text-slate-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-muted">{p.retroalimentacion}</p>
              </div>
            )}
            {/* Teacher comment: shown in the student view (renderGrading absent). In the
                teacher view the comment is being edited inside renderGrading instead. */}
            {respuesta.comentarioDocente && !renderGrading && (
              <div className="mt-2 bg-surface rounded p-2.5 flex gap-2">
                <MessageSquare size={15} className="text-slate-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-muted italic">"{respuesta.comentarioDocente}"</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
