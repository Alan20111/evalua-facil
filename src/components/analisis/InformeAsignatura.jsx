import { useState } from 'react'
import { Sparkles, FileText, AlertTriangle } from 'lucide-react'
import Modal from '../ui/Modal'
import { useBackHandler } from '../../hooks/useBackHandler'
import { planInformeAsignatura } from '../../utils/analisisAsignaturaInforme'
import { Button } from '../ui'
import { ICONO } from '../../config/iconos'
import ReportarIA from '../ReportarIA'

// Informe del análisis integral de asignatura con IA. SOLO LECTURA (decisión
// de Kike, 1-oct-2026): a diferencia del análisis de un examen, este informe
// no se edita — se consulta, se guarda solo y se descarga en PDF. Las reglas
// de Firestore tampoco dejan modificarlo.
//
// Lo que se muestra sale tal cual del documento guardado: los números los
// calculó el servidor, los nombres son los de ese día. La pantalla y el PDF
// recorren el mismo plan (utils/analisisAsignaturaInforme.js).
export function Bloque({ bloque }) {
  if (bloque.tipo === 'parrafo') {
    return bloque.texto ? <p className="text-sm text-on-surface whitespace-pre-line">{bloque.texto}</p> : null
  }
  if (bloque.tipo === 'nota') return <p className="text-xs text-muted">{bloque.texto}</p>
  if (bloque.tipo === 'lista') {
    return (
      <ul className="list-disc pl-5 space-y-1">
        {bloque.items.map((it) => <li key={it} className="text-sm text-on-surface">{it}</li>)}
      </ul>
    )
  }
  return (
    <div>
      {bloque.titulo && <p className="text-xs font-bold uppercase tracking-wide text-muted mb-1">{bloque.titulo}</p>}
      <div className="overflow-x-auto rounded-card border border-outline-variant">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-surface-container text-left">
              {bloque.head.map((h) => <th key={h} scope="col" className="px-2.5 py-1.5 text-xs font-semibold text-muted whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {bloque.body.map((fila) => (
              <tr key={fila.join('|')} className="border-t border-outline-variant align-top">
                {fila.map((celda, j) => (
                  <td key={j} className={`px-2.5 py-1.5 text-on-surface whitespace-pre-line ${j === 0 ? 'font-medium' : ''}`}>{celda}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function InformeAsignatura({ analisis, onClose, onDescargarPDF, descargando = false }) {
  useBackHandler(onClose, true)
  const plan = planInformeAsignatura(analisis)
  const [reportando, setReportando] = useState(false)

  return (
    <Modal open onClose={onClose} title="Análisis de la asignatura" size="3xl" z={60} busy={reportando}>
      <div className="space-y-3">
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-card">
          <Sparkles size={ICONO.sm} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">Asistente IA. </span>
            {plan.aviso}
          </p>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-outline-variant p-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-on-surface"><span className="font-semibold">Parciales: </span>{plan.parciales}</p>
            <p className="text-sm text-on-surface"><span className="font-semibold">Fuentes: </span>{plan.fuentes}</p>
            {plan.generadoEn && <p className="text-sm text-muted">Generado el {plan.generadoEn} — es una fotografía de ese momento: no cambia aunque después cambien los datos.</p>}
          </div>
          <Button variant="outline-accent" icon={FileText} busy={descargando} className="flex-shrink-0" onClick={onDescargarPDF} disabled={descargando}>
            
            {descargando ? 'Generando…' : 'Descargar PDF'}
          </Button>
        </div>

        {plan.secciones.map((s, i) => (
          <section key={s.titulo} className="rounded-card border border-outline-variant p-3 space-y-2">
            <h4 className={`text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 ${s.tono === 'atencion' ? 'text-amber-700' : 'text-accent'}`}>
              {s.tono === 'atencion' && <AlertTriangle size={ICONO.xs} />}
              {i + 1}. {s.titulo}
            </h4>
            {s.bloques.map((b) => <Bloque key={`${b.tipo}-${b.titulo || b.texto || (b.items || []).join('|')}`} bloque={b} />)}
          </section>
        ))}

        {/* Reportar el informe de la IA (docs/PLAN_GOOGLE_PLAY.md, B2). */}
        <div className="flex justify-end">
          <ReportarIA operacion="analizar_asignatura" ubicacion="informe_asignatura" contenido={analisis} contextoId={analisis?.id} onAbiertoChange={setReportando} />
        </div>

        <Button variant="secondary" fullWidth onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </Modal>
  )
}
