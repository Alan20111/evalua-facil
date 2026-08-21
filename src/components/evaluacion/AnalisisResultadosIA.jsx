import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Sparkles, TrendingDown, TrendingUp, AlertTriangle, Lightbulb, FileText, Save } from 'lucide-react'
import { useScrollLock } from '../../hooks/useScrollLock'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import { exportAnalisisResultadosPDF } from '../../utils/pdf'
import { descargaSoloWeb } from '../../utils/descargaSoloWeb'
import { resolverNombresAnalisis } from '../../utils/resolverNombresAnalisis'
import { resumenConfiabilidad } from '../../utils/confiabilidadAnalisis'

// Pantalla de resultado de OP-10 (análisis de resultados con IA). El texto
// que redacta la IA (resumen, patrones, señales de atención, recomendaciones)
// es editable ahí mismo, en la misma vista donde se revisa (pedido de Kike,
// 16-ago-2026: todo lo generado por la IA debe poder corregirse) — lo que
// NO se edita es el dato observado que calculó Evalúa Fácil (porcentajes,
// enunciados de reactivos, número de estudiantes), porque no es texto de la
// IA sino aritmética sobre las entregas reales. El aviso de IA va primero y
// cada sección deja claro si es dato observado, interpretación de la IA, o
// recomendación — nunca se mezclan.
//
// El PDF se genera aquí (no en EvaluacionManager) porque es el único lugar
// donde ya existe `nombrePorAnonId`: el reporte descargable nunca debe volver
// a resolver esa traducción por su cuenta, ni mandarle nada nuevo a la IA
// (descargar el PDF no cuesta créditos — solo imprime lo que ya está en
// pantalla). `resolverNombresAnalisis` vive en utils/ (no aquí) para que este
// archivo exporte solo el componente.

// Textarea "en su lugar" que crece con el contenido, igual que las celdas
// editables de Planeación — para que el reporte se siga viendo como reporte
// y no como un formulario con cajas.
function TextoEditable({ value, onChange, className = '', placeholder }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value || ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full bg-transparent border border-dashed border-accent/50 rounded px-1.5 py-1 resize-none overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus:bg-[var(--accent-tint)] ${className}`}
      maxLength={2000}
    />
  )
}

// `onGuardar(resultadoEditado)` — si no se pasa (análisis todavía no
// persistido en la bitácora), el reporte se muestra editable pero sin botón
// de guardar; en la práctica siempre llega ya con un id (ver EvaluacionManager).
// `onPedirDescarga(ejecutar)` — hook opcional por si un llamador futuro
// necesita interceptar la descarga antes de correrla. Sin el prop, se
// descarga directo.
export default function AnalisisResultadosIA({ resultado, students, generadoEn = null, activity, subject, membrete = null, watermark = false, onClose, onGuardar = null, onPedirDescarga = null }) {
  const toast = useToast()
  const [descargando, setDescargando] = useState(false)
  const [editado, setEditado] = useState(resultado)
  const [guardando, setGuardando] = useState(false)
  useScrollLock(true)
  useBackHandler(onClose, true)

  useEffect(() => { setEditado(resultado) }, [resultado])

  const sinGuardar = JSON.stringify(editado) !== JSON.stringify(resultado)

  function set(campo, valor) {
    setEditado((prev) => ({ ...prev, [campo]: valor }))
  }
  function setPatron(i, campo, valor) {
    setEditado((prev) => ({ ...prev, patrones: prev.patrones.map((p, idx) => (idx === i ? { ...p, [campo]: valor } : p)) }))
  }
  function setSenalAtencion(i, valor) {
    setEditado((prev) => ({ ...prev, estudiantesAtencion: prev.estudiantesAtencion.map((e, idx) => (idx === i ? { ...e, senal: valor } : e)) }))
  }
  function setRecomendacion(i, valor) {
    setEditado((prev) => ({ ...prev, recomendaciones: prev.recomendaciones.map((r, idx) => (idx === i ? valor : r)) }))
  }

  async function guardarCambios() {
    setGuardando(true)
    try {
      await onGuardar(editado)
      toast('Cambios guardados')
    } catch (err) {
      toast('No se pudo guardar: ' + err.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  const { nombrePorAnonId } = resolverNombresAnalisis(resultado, students)
  const textoConfiabilidad = resumenConfiabilidad(resultado.confiabilidad)
  const hayExcluidas = (resultado.confiabilidad?.excluidas || 0) > 0

  async function ejecutarDescargaPDF() {
    setDescargando(true)
    try {
      const { resultado: resultadoConNombres } = resolverNombresAnalisis(editado, students)
      await exportAnalisisResultadosPDF({ activity, subject, generadoEn, membrete, watermark, resultado: resultadoConNombres })
    } catch (err) {
      toast('Error al generar el PDF: ' + err.message, 'error')
    } finally {
      setDescargando(false)
    }
  }

  function handleDescargarPDF() {
    if (descargaSoloWeb(toast)) return
    if (onPedirDescarga) onPedirDescarga(ejecutarDescargaPDF)
    else ejecutarDescargaPDF()
  }

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
          {onGuardar && (
            <button type="button" onClick={guardarCambios} disabled={!sinGuardar || guardando}
              data-tooltip="Guardar las correcciones que hiciste a este análisis"
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white text-xs font-semibold rounded transition-colors disabled:opacity-60">
              {guardando ? <Spinner size="sm" /> : <Save size={14} />}
              {guardando ? 'Guardando…' : sinGuardar ? 'Guardar' : 'Guardado'}
            </button>
          )}
          <button type="button" onClick={handleDescargarPDF} disabled={descargando}
            data-tooltip="Descargar este análisis en PDF"
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white text-xs font-semibold rounded transition-colors disabled:opacity-60">
            {descargando ? <Spinner size="sm" /> : <FileText size={14} />}
            {descargando ? 'Generando…' : 'PDF'}
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-card">
          <Sparkles size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">Asistente IA. </span>
            Este análisis fue generado con inteligencia artificial. Puede contener errores.
            Revísalo cuidadosamente antes de tomar decisiones pedagógicas.
            {generadoEn && <span className="block text-xs text-amber-700 mt-1">Generado el {new Date(generadoEn).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}.</span>}
          </p>
        </div>

        {editado.resumenEjecutivo != null && (
          <div className="bg-surface-card rounded-card shadow-card p-4" style={{ border: '1px solid var(--accent)' }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--accent)' }}>Resumen ejecutivo</p>
            <TextoEditable value={editado.resumenEjecutivo} onChange={(v) => set('resumenEjecutivo', v)} className="text-sm text-on-surface" />
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
            <TextoEditable
              value={editado.resumenGeneral}
              onChange={(v) => set('resumenGeneral', v)}
              placeholder="No hay suficiente información para un resumen general."
              className="text-sm text-on-surface flex-1"
            />
          </div>
          <p className="text-xs text-muted">{resultado.totalEstudiantes} estudiante{resultado.totalEstudiantes !== 1 ? 's' : ''} · {resultado.totalReactivos} reactivo{resultado.totalReactivos !== 1 ? 's' : ''}</p>
        </div>

        {/* Confiabilidad de los datos — solo aparece si `resultado` la trae
            (análisis generados antes de esta corrección no la tienen, y no
            se les inventa una retroactivamente). Sin exclusiones es una nota
            neutra, sin ícono de alerta; con exclusiones, un aviso claro pero
            no alarmante — es información esperable, no un error. */}
        {textoConfiabilidad && (
          <div className={`rounded-card p-4 space-y-1 ${hayExcluidas ? 'bg-blue-50 border border-blue-200' : 'bg-surface-card shadow-card'}`}>
            <p className={`text-xs font-bold uppercase tracking-wide ${hayExcluidas ? 'text-blue-700' : 'text-muted'}`}>Confiabilidad de los datos</p>
            <p className={`text-sm ${hayExcluidas ? 'text-blue-900' : 'text-on-surface'}`}>{textoConfiabilidad}</p>
          </div>
        )}

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

        {editado.patrones?.length > 0 && (
          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Patrones encontrados</p>
            {editado.patrones.map((p, i) => (
              <div key={i} className="border-l-2 pl-3" style={{ borderColor: 'var(--accent)' }}>
                <p className="text-sm text-on-surface flex items-start gap-1">
                  <span className="font-semibold flex-shrink-0">Observación (dato): </span>
                  <TextoEditable value={p.observacion} onChange={(v) => setPatron(i, 'observacion', v)} className="text-sm text-on-surface flex-1" />
                </p>
                <p className="text-sm text-muted flex items-start gap-1">
                  <span className="font-semibold flex-shrink-0">Interpretación: </span>
                  <TextoEditable value={p.interpretacion} onChange={(v) => setPatron(i, 'interpretacion', v)} className="text-sm text-muted flex-1" />
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="bg-surface-card rounded-card shadow-card p-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-700 flex items-center gap-1.5">
            <AlertTriangle size={14} /> Estudiantes que podrían requerir atención — señal, no diagnóstico
          </p>
          {editado.estudiantesAtencion?.length > 0 ? (
            <ul className="space-y-1.5">
              {editado.estudiantesAtencion.map((e, i) => (
                <li key={i} className="text-sm flex items-start gap-1">
                  <span className="font-semibold text-on-surface flex-shrink-0">{nombrePorAnonId.get(e.anonId) || e.anonId}: </span>
                  <TextoEditable value={e.senal} onChange={(v) => setSenalAtencion(i, v)} className="text-sm text-muted flex-1" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No se identificó ningún estudiante con desempeño objetivamente bajo en este análisis.</p>
          )}
        </div>

        {editado.recomendaciones?.length > 0 && (
          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-accent flex items-center gap-1.5">
              <Lightbulb size={14} /> Recomendaciones
            </p>
            <ul className="list-disc pl-5 space-y-1">
              {editado.recomendaciones.map((r, i) => (
                <li key={i} className="text-sm text-on-surface">
                  <TextoEditable value={r} onChange={(v) => setRecomendacion(i, v)} className="text-sm text-on-surface" />
                </li>
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
