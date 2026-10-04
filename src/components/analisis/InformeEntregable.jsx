import { useState } from 'react'
import { Sparkles, FileText, AlertTriangle, Pencil } from 'lucide-react'
import Modal from '../ui/Modal'
import Spinner from '../Spinner'
import { useBackHandler } from '../../hooks/useBackHandler'
import { Bloque } from './InformeAsignatura'
import { planInformeEntregable, textoVigenteEntregable } from '../../utils/analisisEntregableInforme'

// Informe del análisis con IA de UNA actividad entregable («solo resultados»).
//
// A diferencia del informe de asignatura, el TEXTO de este sí se puede
// corregir: resumen, fortalezas, dificultades y recomendaciones. Lo editado
// se guarda aparte (`edicion`); el original de la IA y los números calculados
// no se tocan nunca — las reglas de Firestore solo dejan escribir `edicion`.
const aLineas = (lista) => (lista || []).join('\n')
const deLineas = (texto) => String(texto || '').split('\n').map((x) => x.trim()).filter(Boolean)

function EditorTexto({ vigente, guardando, onGuardar, onCancelar, puedeRestaurar, onRestaurar }) {
  const [resumen, setResumen] = useState(vigente.resumenEjecutivo)
  const [fortalezas, setFortalezas] = useState(aLineas(vigente.fortalezas))
  const [dificultades, setDificultades] = useState(aLineas(vigente.dificultades))
  const [recomendaciones, setRecomendaciones] = useState(aLineas(vigente.recomendaciones))
  const campo = (id, etiqueta, valor, set, filas, ayuda) => (
    <div>
      <label htmlFor={id} className="block text-xs font-bold uppercase tracking-wide text-accent mb-1">{etiqueta}</label>
      <textarea id={id} value={valor} onChange={(e) => set(e.target.value)} rows={filas} disabled={guardando}
        className="w-full px-2 py-1.5 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
      {ayuda && <p className="text-xs text-muted mt-0.5">{ayuda}</p>}
    </div>
  )
  const unaPorRenglon = 'Una idea por renglón.'
  return (
    <div className="rounded-card border border-accent-soft p-3 space-y-3">
      <p className="text-sm text-muted">Corrige o completa el texto. Los datos calculados no se editan y el texto original de la IA se conserva.</p>
      {campo('ent-resumen', 'Resumen ejecutivo', resumen, setResumen, 4)}
      {campo('ent-fortalezas', 'Fortalezas', fortalezas, setFortalezas, 4, unaPorRenglon)}
      {campo('ent-dificultades', 'Dificultades', dificultades, setDificultades, 4, unaPorRenglon)}
      {campo('ent-recomendaciones', 'Recomendaciones', recomendaciones, setRecomendaciones, 4, unaPorRenglon)}
      <div className="flex flex-wrap justify-end gap-2">
        {puedeRestaurar && (
          <button type="button" onClick={onRestaurar} disabled={guardando}
            className="mr-auto px-3 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors disabled:opacity-60">
            Volver al texto original
          </button>
        )}
        <button type="button" onClick={onCancelar} disabled={guardando}
          className="px-3 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors disabled:opacity-60">
          Cancelar
        </button>
        <button type="button" disabled={guardando}
          onClick={() => onGuardar({
            resumenEjecutivo: resumen.trim().slice(0, 4000),
            fortalezas: deLineas(fortalezas).slice(0, 30).map((x) => x.slice(0, 1000)),
            dificultades: deLineas(dificultades).slice(0, 30).map((x) => x.slice(0, 1000)),
            recomendaciones: deLineas(recomendaciones).slice(0, 30).map((x) => x.slice(0, 1000)),
          })}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-accent text-white text-sm font-medium rounded-full hover:bg-accent-hover transition-colors disabled:opacity-60">
          {guardando && <Spinner size="sm" />} {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}

export default function InformeEntregable({ analisis, onClose, onDescargarPDF, descargando = false, puedeDescargar = true, onGuardarEdicion }) {
  useBackHandler(onClose, true)
  const [editando, setEditando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const plan = planInformeEntregable(analisis)

  async function guardar(edicion) {
    setGuardando(true)
    try {
      await onGuardarEdicion(edicion)
      setEditando(false)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Análisis de la actividad" size="3xl" z={60} busy={guardando}>
      <div className="space-y-3">
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-card">
          <Sparkles size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800"><span className="font-semibold">Asistente IA. </span>{plan.aviso}</p>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-outline-variant p-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-on-surface"><span className="font-semibold">Actividad: </span>{plan.actividad}</p>
            <p className="text-sm text-on-surface"><span className="font-semibold">Modalidad: </span>{plan.modalidad} — no se leyeron los archivos entregados</p>
            {plan.generadoEn && <p className="text-xs text-muted">Generado el {plan.generadoEn} — es una fotografía de ese momento: no cambia aunque después cambien los datos.</p>}
            {plan.editado && <p className="text-xs font-semibold text-accent">El texto fue editado por el docente.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {!editando && (
              <button type="button" onClick={() => setEditando(true)}
                className="flex items-center gap-1.5 px-3 py-2 border border-outline-variant rounded-full text-sm font-semibold text-on-surface hover:bg-surface-container transition-colors">
                <Pencil size={15} /> Editar texto
              </button>
            )}
            {puedeDescargar && (
              <button type="button" onClick={onDescargarPDF} disabled={descargando}
                className="flex items-center gap-1.5 px-3 py-2 bg-[var(--accent-light)] border border-accent rounded-full text-sm font-semibold text-accent hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-60">
                {descargando ? <Spinner size="sm" /> : <FileText size={16} />}
                {descargando ? 'Generando…' : 'Descargar PDF'}
              </button>
            )}
          </div>
        </div>

        {editando && (
          <EditorTexto
            vigente={textoVigenteEntregable(analisis)}
            guardando={guardando}
            onGuardar={guardar}
            onCancelar={() => setEditando(false)}
            puedeRestaurar={plan.editado}
            onRestaurar={() => guardar(null)}
          />
        )}

        {plan.secciones.map((s, i) => (
          <section key={s.titulo} className="rounded-card border border-outline-variant p-3 space-y-2">
            <h4 className={`text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 ${s.tono === 'atencion' ? 'text-amber-700' : 'text-accent'}`}>
              {s.tono === 'atencion' && <AlertTriangle size={14} />}
              {i + 1}. {s.titulo}
            </h4>
            {s.bloques.map((b) => <Bloque key={`${b.tipo}-${b.titulo || b.texto || (b.items || []).join('|') || (b.head || []).join('|')}`} bloque={b} />)}
          </section>
        ))}

        <button type="button" onClick={onClose}
          className="w-full py-2.5 border border-outline-variant text-muted font-medium rounded-full hover:bg-surface-container transition-colors">
          Cerrar
        </button>
      </div>
    </Modal>
  )
}
