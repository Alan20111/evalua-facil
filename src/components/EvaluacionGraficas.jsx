import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { ArrowLeft, PieChart as PieChartIcon, Download, Check } from 'lucide-react'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'
import { useToast } from './Toast'
import { IS_NATIVE_APP } from '../utils/platform'
import { exportEvaluacionResultadosPDF } from '../utils/pdf'
import Spinner from './Spinner'

// Validated categorical palette (dataviz skill, references/palette.md) — fixed
// slot order, never reassigned/cycled. Up to 8 slices before an option would
// need to fold into "Otras" (opción múltiple here caps at 4 opciones anyway).
const SLICE_COLORS = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834']

function polarPoint(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

// Small pie — 2px surface-color gap between slices (the spacer, not a border)
// separates them; a single-answer question draws a full circle since an arc
// with identical start/end points degenerates to nothing.
function Pie({ slices, size = 140 }) {
  const cx = size / 2, cy = size / 2, r = size / 2
  const withVotes = slices.filter((s) => s.count > 0)
  const total = withVotes.reduce((sum, s) => sum + s.count, 0)
  if (total === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-full bg-surface-container text-muted text-xs text-center p-4 flex-shrink-0"
        style={{ width: size, height: size }}
      >
        Sin respuestas
      </div>
    )
  }
  if (withVotes.length === 1) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
        <circle cx={cx} cy={cy} r={r} fill={withVotes[0].color} />
      </svg>
    )
  }
  const { paths } = withVotes.reduce(
    (acc, s) => {
      const startAngle = acc.angle
      const sweep = (s.count / total) * 360
      const endAngle = startAngle + sweep
      const p1 = polarPoint(cx, cy, r, startAngle)
      const p2 = polarPoint(cx, cy, r, endAngle)
      const largeArc = sweep > 180 ? 1 : 0
      const d = `M ${cx} ${cy} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y} Z`
      return { angle: endAngle, paths: [...acc.paths, { id: s.id, color: s.color, d }] }
    },
    { angle: 0, paths: [] }
  )
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      {paths.map((p) => (
        <path key={p.id} d={p.d} fill={p.color} stroke="var(--surface-card)" strokeWidth="2" strokeLinejoin="round" />
      ))}
    </svg>
  )
}

// Full-screen results view: one pie chart per reactivo de opción múltiple,
// with each opción's votes and percentage as its legend. Leaves the sidebar
// visible on web (md:left-[300px], same pattern as ProgramarZonaSemanal.jsx);
// takes the entire screen on mobile, where the sidebar doesn't exist anyway.
export default function EvaluacionGraficas({ activity, activityLabel, subject, preguntas, submissions, onClose }) {
  useBackHandler(onClose, true)
  useScrollLock(true)
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState({}) // { [preguntaId]: { [opcionId]: number } }
  const [exportingPdf, setExportingPdf] = useState(false)

  // Opción múltiple Y verdadero/falso — las dos tienen respuesta cerrada
  // (mismo campo `opciones` + `opcionSeleccionada`, ver EvaluacionRunner.jsx),
  // así que las dos se pueden graficar. Antes solo entraba opción múltiple:
  // un examen todo en V/F se quedaba sin ninguna gráfica ni fila en el PDF.
  const graficables = preguntas.filter((p) => p.tipo === 'opcion_multiple' || p.tipo === 'verdadero_falso')

  async function handleExportPdf() {
    setExportingPdf(true)
    try {
      await exportEvaluacionResultadosPDF({ activity, subject, preguntas: graficables, counts })
    } catch (err) {
      toast('Error al generar el PDF: ' + err.message, 'error')
    } finally {
      setExportingPdf(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const preguntaIds = new Set(graficables.map((p) => p.id))
      const acc = {}
      graficables.forEach((p) => { acc[p.id] = {} })
      const subs = Object.values(submissions).filter((s) => s?.id)
      await Promise.all(subs.map(async (sub) => {
        const snap = await getDocs(collection(db, 'submissions', sub.id, 'respuestas'))
        snap.docs.forEach((d) => {
          if (!preguntaIds.has(d.id)) return
          const opcionId = d.data().opcionSeleccionada
          if (!opcionId) return
          acc[d.id][opcionId] = (acc[d.id][opcionId] || 0) + 1
        })
      }))
      if (!cancelled) { setCounts(acc); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-50 md:left-[300px] bg-surface flex flex-col">
      <div className="flex items-center px-4 py-2.5 bg-surface-card border-b border-outline-variant flex-shrink-0 safe-top">
        <div className="max-w-3xl mx-auto flex items-start gap-3 w-full">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 p-2 -ml-2 mt-0.5 text-muted hover:text-accent rounded text-sm font-medium flex-shrink-0 transition-colors"
          >
            <ArrowLeft size={20} /> Regresar
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold uppercase tracking-wide text-accent">Gráficas</p>
            <h1 className="text-xl font-bold text-on-surface truncate">
              {activityLabel && <span className="text-accent">{activityLabel} </span>}{activity.nombre}
            </h1>
          </div>
          {!IS_NATIVE_APP && (
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={exportingPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 mt-0.5 rounded border border-accent text-accent text-sm font-medium hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-60 flex-shrink-0"
            >
              {exportingPdf ? <Spinner size="sm" /> : <Download size={16} />}
              {exportingPdf ? 'Generando…' : 'Descargar PDF'}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : graficables.length === 0 ? (
            <div className="flex flex-col items-center gap-2 text-center text-muted py-16">
              <PieChartIcon size={28} className="text-slate-300" />
              <p className="text-sm">Este {activity.categoria === 'examen' ? 'examen' : 'cuestionario'} no tiene reactivos de opción múltiple ni de verdadero/falso.</p>
            </div>
          ) : (
            graficables.map((p, i) => {
              const preguntaCounts = counts[p.id] || {}
              const total = Object.values(preguntaCounts).reduce((sum, n) => sum + n, 0)
              const slices = (p.opciones || []).map((o, idx) => ({
                id: o.id,
                count: preguntaCounts[o.id] || 0,
                color: SLICE_COLORS[idx % SLICE_COLORS.length],
              }))
              return (
                <div key={p.id} className="rounded-card overflow-hidden bg-surface-card shadow-card border border-outline-variant">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <p className="text-sm font-semibold text-on-surface flex-1">{i + 1}. {p.enunciado}</p>
                      {/* Total explícito arriba de la gráfica — antes solo se
                          podía inferir sumando los conteos de cada opción. */}
                      <span className="text-xs text-muted flex-shrink-0 whitespace-nowrap">
                        {total} {total === 1 ? 'respuesta' : 'respuestas'}
                      </span>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                      <Pie slices={slices} />
                      <div className="flex-1 w-full min-w-0 space-y-2.5">
                        {(p.opciones || []).map((o, idx) => {
                          const count = preguntaCounts[o.id] || 0
                          const pct = total ? Math.round((count / total) * 100) : 0
                          const esCorrecta = p.respuestaCorrecta != null && o.id === p.respuestaCorrecta
                          return (
                            <div key={o.id}>
                              <div className="flex items-center gap-2 text-sm">
                                <span
                                  className="w-3 h-3 rounded-full flex-shrink-0"
                                  style={{ background: SLICE_COLORS[idx % SLICE_COLORS.length] }}
                                />
                                <span className="flex-1 min-w-0 truncate text-on-surface flex items-center gap-1">
                                  {o.texto}
                                  {esCorrecta && (
                                    <span data-tooltip="Respuesta correcta" className="inline-flex text-emerald-600 flex-shrink-0">
                                      <Check size={13} strokeWidth={3} />
                                    </span>
                                  )}
                                </span>
                                {/* Conteo y porcentaje ya no comparten una sola
                                    línea ambigua ("5 · 40%") — cada dato trae
                                    su propia etiqueta. */}
                                <span className="text-muted flex-shrink-0 tabular-nums">
                                  {count} resp. ({pct}%)
                                </span>
                              </div>
                              {/* Barra de porcentaje — mismo dato que la dona,
                                  en un formato que se lee de un vistazo y sin
                                  ambigüedad al compararlo entre opciones. */}
                              <div className="h-1.5 rounded-full bg-surface-container overflow-hidden mt-1 ml-5">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{ width: `${pct}%`, background: SLICE_COLORS[idx % SLICE_COLORS.length] }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
