// OP-03/OP-04 · Crear examen o cuestionario completo con IA.
//
// A diferencia de OP-09 (el docente arma preguntas dentro de una evaluación
// ya existente y revisa cada reactivo antes de guardarlo), aquí la IA crea la
// actividad Y llena directo sus reactivos — el docente revisa el resultado ya
// dentro del editor normal (EvaluacionEditor), no en un paso intermedio.
//
// Flujo: nombre + "¿qué quieres evaluar?" + cantidad (topada por el plan) +
// hasta 3 documentos de referencia opcionales → crea la actividad (igual que
// EvaluacionEditor.handleSaveInfo en modo nuevo) → sube los documentos a
// Cloudinary → llama a la operación de IA, que escribe los reactivos directo
// en el servidor → el padre navega al editor de la evaluación ya creada.

import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from './Toast'
import useCreditosIA from '../hooks/useCreditosIA'
import { subirFuentes } from '../utils/fuentesIA'
import FuentesIAInput from './ia/FuentesIAInput'
import { MIN_REACTIVOS, MAX_REACTIVOS_EVALUACION_TRIAL, MAX_REACTIVOS_EVALUACION_PAGO } from '../utils/reactivosIA'

const MIN_QUIERE_EVALUAR = 40

// Mismo shape que EVALUACION_DEFAULTS de EvaluacionEditor.jsx/SubjectPage.jsx
// — se repite aquí a propósito (ver CLAUDE.md/plan: no tocar esos archivos).
const EVALUACION_DEFAULTS = {
  cuestionario: {
    numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'libre',
    tiempoLimiteMin: null, intentosPermitidos: null, conservar: 'mejor',
    publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
    publicarRespuestas: 'inmediato', publicarRespuestasFecha: null, respuestasPublicadas: false,
    mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
  },
  examen: {
    numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'secuencial',
    tiempoLimiteMin: 30, intentosPermitidos: 1, conservar: 'ultimo',
    publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
    publicarRespuestas: 'inmediato', publicarRespuestasFecha: null, respuestasPublicadas: false,
    mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
  },
}

export default function CrearEvaluacionIAModal({
  open, onClose, categoria, asignaturaId, asignaturaNombre, parcial, docenteId,
  existingActivitiesCountInParcial = 0, onCreated,
}) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const [nombre, setNombre] = useState('')
  const [quiereEvaluar, setQuiereEvaluar] = useState('')
  const tope = creditosIA.plan === 'trial' ? MAX_REACTIVOS_EVALUACION_TRIAL : MAX_REACTIVOS_EVALUACION_PAGO
  const [cantidad, setCantidad] = useState(10)
  const [archivos, setArchivos] = useState([])
  const [trabajando, setTrabajando] = useState(false)

  if (!open) return null

  const tipoLabel = categoria === 'examen' ? 'Examen' : 'Cuestionario'

  async function handleGenerar() {
    if (!nombre.trim()) { toast('Escribe el nombre de la evaluación', 'error'); return }
    if (quiereEvaluar.trim().length < MIN_QUIERE_EVALUAR) {
      toast(`Describe con más detalle qué quieres evaluar (mínimo ${MIN_QUIERE_EVALUAR} caracteres)`, 'error'); return
    }
    setTrabajando(true)
    let ref = null
    try {
      const urls = (await subirFuentes(archivos)).map((f) => f.url)

      const orden = existingActivitiesCountInParcial + 1
      ref = await addDoc(collection(db, 'activities'), {
        nombre: nombre.trim(),
        categoria,
        tipo: 'evaluacion',
        instrucciones: '',
        archivosAdjuntos: [],
        fechaLimite: null,
        recibirTarde: false,
        oculta: true, // nace oculta: el docente la revisa y publica desde el editor, igual que un borrador manual
        publishAt: null,
        publishedAt: null,
        maxCalif: 10,
        notificarDocente: false,
        evaluacion: EVALUACION_DEFAULTS[categoria],
        parcial, orden, asignaturaId, docenteId,
        createdAt: serverTimestamp(),
      })

      await creditosIA.ejecutar('crear_evaluacion_ia', {
        actividadId: ref.id,
        categoria,
        asignaturaId,
        asignaturaNombre: asignaturaNombre || '',
        quiereEvaluar,
        cantidad,
        fuentes: urls,
      }, cantidad, { timeoutMs: 240000 })

      toast(`${tipoLabel} generado con IA`)
      onCreated?.(ref.id)
    } catch (err) {
      toast(err.message || 'No se pudo generar la evaluación', 'error')
      // La actividad ya se creó (vacía) aunque la IA falle — se deja: el
      // docente la ve como borrador oculto y puede llenarla a mano o
      // reintentar la IA desde ahí, en vez de perder el nombre que escribió.
      if (ref) onCreated?.(ref.id)
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default"
        onClick={() => { if (!trabajando) onClose?.() }} aria-label="Cerrar" />
      <div className="relative bg-surface-card w-full max-w-md rounded-t-card sm:rounded-card p-5 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={18} className="text-accent flex-shrink-0" />
          <h3 className="text-base font-semibold flex-1">{tipoLabel} con IA</h3>
          <button type="button" onClick={() => { if (!trabajando) onClose?.() }} aria-label="Cerrar"
            className="p-1 text-slate-400 rounded"><X size={18} /></button>
        </div>
        <p className="text-sm text-muted mb-3">
          El asistente crea el {tipoLabel.toLowerCase()} completo con sus reactivos a partir de lo que describas. Lo revisas y ajustas después, como cualquier otra evaluación.
        </p>

        <div className="space-y-2.5">
          <div>
            <label htmlFor="ia-eval-nombre" className="block text-sm text-on-surface mb-1">Nombre de la evaluación</label>
            <input id="ia-eval-nombre" type="text" value={nombre} disabled={trabajando}
              onChange={(e) => setNombre(e.target.value)}
              placeholder={`Ej: ${tipoLabel} — Unidad 2`}
              className="w-full px-2.5 py-1.5 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
          </div>
          <div>
            <label htmlFor="ia-eval-quiere" className="block text-sm text-on-surface mb-1">¿Qué quieres evaluar?</label>
            <textarea id="ia-eval-quiere" value={quiereEvaluar} disabled={trabajando} rows={4}
              onChange={(e) => setQuiereEvaluar(e.target.value)}
              placeholder="Describe con el mayor detalle posible el tema, contenidos, conceptos, procedimientos, habilidades o aspectos que quieres evaluar."
              className="w-full px-2.5 py-1.5 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="ia-eval-cantidad" className="text-sm text-on-surface">¿Cuántos reactivos quieres generar?</label>
            <select id="ia-eval-cantidad" value={cantidad} disabled={trabajando}
              onChange={(e) => setCantidad(Number(e.target.value))}
              className="px-2 py-1 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {Array.from({ length: tope - MIN_REACTIVOS + 1 }, (_, i) => MIN_REACTIVOS + i).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          <FuentesIAInput files={archivos} onChange={setArchivos} disabled={trabajando} />
        </div>

        <p className="text-sm text-on-surface mt-3 mb-1">
          Esta acción utilizará aproximadamente <span className="font-semibold">{cantidad}</span> {cantidad === 1 ? 'crédito' : 'créditos'} de IA.
        </p>
        <p className="text-sm text-muted mb-4">
          Tienes <span className="font-semibold tabular-nums">{creditosIA.saldo}</span> créditos disponibles.
        </p>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { if (!trabajando) onClose?.() }} disabled={trabajando}
            className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
            Cancelar
          </button>
          <button type="button" onClick={handleGenerar} disabled={trabajando}
            className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors disabled:opacity-60">
            {trabajando ? 'Generando…' : 'Generar con IA'}
          </button>
        </div>
      </div>
    </div>
  )
}
