import { ArrowLeft, Sparkles, TrendingDown, TrendingUp, AlertTriangle, Lightbulb } from 'lucide-react'
import { useScrollLock } from '../../hooks/useScrollLock'
import { useBackHandler } from '../../hooks/useBackHandler'
import { studentFullName } from '../../utils/studentSearch'

// Pantalla de resultado de OP-10 (análisis de resultados con IA) — solo
// lectura, nada que editar ni guardar: es un reporte, no un borrador que se
// incorpore a la actividad. El aviso de IA va primero y cada sección deja
// claro si es dato observado (lo calculó Evalúa Fácil), interpretación de la
// IA, o recomendación — nunca se mezclan.
export default function AnalisisResultadosIA({ resultado, students, onClose }) {
  useScrollLock(true)
  useBackHandler(onClose, true)

  const nombrePorAnonId = new Map(
    (resultado.mapaAlumnos || []).map(({ anonId, alumnoId }) => {
      const st = students?.find((s) => s.id === alumnoId)
      return [anonId, st ? studentFullName(st) : anonId]
    })
  )

  return (
    <div className="fixed inset-0 z-[60] bg-surface overflow-y-auto">
      <header className="sticky top-0 z-10 bg-accent text-white shadow-lg safe-top">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={onClose} aria-label="Volver" className="p-2 -ml-2 rounded hover:bg-white/10 transition-colors flex-shrink-0">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white/70 uppercase tracking-wide">Resultados</p>
            <h1 className="text-xl font-extrabold text-white truncate">Análisis con IA</h1>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-card">
          <Sparkles size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">Asistente IA. </span>
            Este análisis fue generado con inteligencia artificial. Puede contener errores.
            Revísalo cuidadosamente antes de tomar decisiones pedagógicas.
          </p>
        </div>

        {resultado.resumenEjecutivo && (
          <div className="bg-surface-card rounded-card shadow-card p-4" style={{ border: '1px solid var(--accent)' }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--accent)' }}>Resumen ejecutivo</p>
            <p className="text-sm text-on-surface">{resultado.resumenEjecutivo}</p>
          </div>
        )}

        <div className="bg-surface-card rounded-card shadow-card p-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Dato observado — resumen general</p>
          <div className="flex items-center gap-3">
            {resultado.porcentajeAciertosGeneral != null && (
              <span className="flex-shrink-0 px-3 py-1.5 rounded-full text-lg font-extrabold bg-blue-100 text-blue-700">
                {resultado.porcentajeAciertosGeneral}%
              </span>
            )}
            <p className="text-sm text-on-surface flex-1">{resultado.resumenGeneral || 'No hay suficiente información para un resumen general.'}</p>
          </div>
          <p className="text-xs text-muted">{resultado.totalEstudiantes} estudiante{resultado.totalEstudiantes !== 1 ? 's' : ''} · {resultado.totalReactivos} reactivo{resultado.totalReactivos !== 1 ? 's' : ''}</p>
        </div>

        {(resultado.reactivosDificiles?.length > 0 || resultado.reactivosFuertes?.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {resultado.reactivosDificiles?.length > 0 && (
              <div className="bg-surface-card rounded-card shadow-card p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-red-700 mb-2 flex items-center gap-1.5">
                  <TrendingDown size={14} /> Dato — mayor dificultad
                </p>
                <ul className="space-y-2">
                  {resultado.reactivosDificiles.map((r) => (
                    <li key={r.numero} className="text-sm">
                      <span className="font-semibold text-red-700">{r.pctAciertos}%</span>{' '}
                      <span className="text-on-surface">Reactivo {r.numero} — {r.enunciado}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {resultado.reactivosFuertes?.length > 0 && (
              <div className="bg-surface-card rounded-card shadow-card p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 mb-2 flex items-center gap-1.5">
                  <TrendingUp size={14} /> Dato — mejor desempeño
                </p>
                <ul className="space-y-2">
                  {resultado.reactivosFuertes.map((r) => (
                    <li key={r.numero} className="text-sm">
                      <span className="font-semibold text-emerald-700">{r.pctAciertos}%</span>{' '}
                      <span className="text-on-surface">Reactivo {r.numero} — {r.enunciado}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {resultado.patrones?.length > 0 && (
          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Patrones encontrados</p>
            {resultado.patrones.map((p, i) => (
              <div key={i} className="border-l-2 pl-3" style={{ borderColor: 'var(--accent)' }}>
                <p className="text-sm text-on-surface"><span className="font-semibold">Observación (dato): </span>{p.observacion}</p>
                <p className="text-sm text-muted"><span className="font-semibold">Interpretación: </span>{p.interpretacion}</p>
              </div>
            ))}
          </div>
        )}

        <div className="bg-surface-card rounded-card shadow-card p-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-700 flex items-center gap-1.5">
            <AlertTriangle size={14} /> Estudiantes que podrían requerir atención — señal, no diagnóstico
          </p>
          {resultado.estudiantesAtencion?.length > 0 ? (
            <ul className="space-y-1.5">
              {resultado.estudiantesAtencion.map((e, i) => (
                <li key={i} className="text-sm">
                  <span className="font-semibold text-on-surface">{nombrePorAnonId.get(e.anonId) || e.anonId}: </span>
                  <span className="text-muted">{e.senal}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No se identificó ningún estudiante con desempeño objetivamente bajo en este análisis.</p>
          )}
        </div>

        {resultado.recomendaciones?.length > 0 && (
          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-accent flex items-center gap-1.5">
              <Lightbulb size={14} /> Recomendaciones
            </p>
            <ul className="list-disc pl-5 space-y-1">
              {resultado.recomendaciones.map((r, i) => (
                <li key={i} className="text-sm text-on-surface">{r}</li>
              ))}
            </ul>
          </div>
        )}

        <button type="button" onClick={onClose}
          className="w-full py-2.5 border border-outline-variant text-muted font-medium rounded-card hover:bg-surface-container transition-colors">
          Cerrar
        </button>
        <div className="h-6 safe-bottom" />
      </div>
    </div>
  )
}
