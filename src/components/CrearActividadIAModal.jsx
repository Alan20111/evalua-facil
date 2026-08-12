// OP-05 · Crear entregable u observación completo con IA.
//
// Mismo patrón que CrearEvaluacionIAModal (OP-03/04): el docente describe qué
// quiere trabajar, opcionalmente adjunta hasta 3 documentos de referencia, y
// la IA propone nombre + instrucciones + producto esperado + tipos de
// archivo + peso — todo directo sobre la actividad, que nace oculta (borrador)
// y el docente revisa/publica desde el editor normal (EntregableEditor).
//
// `categoria` llega fija desde quien abre el modal ('entregable' u
// 'observacion'), igual que CrearEvaluacionIAModal recibe 'cuestionario'/
// 'examen'.

import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from './Toast'
import useCreditosIA from '../hooks/useCreditosIA'
import { resolverFuentes } from '../utils/fuentesIA'
import FuentesIAInput from './ia/FuentesIAInput'
import useFuentesAsignatura from '../hooks/useFuentesAsignatura'

const MIN_PETICION = 20

export default function CrearActividadIAModal({
  open, onClose, categoria, asignaturaId, asignaturaNombre, parcial, docenteId,
  existingActivitiesCountInParcial = 0, onCreated,
}) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const [peticion, setPeticion] = useState('')
  const [archivos, setArchivos] = useState([])
  const [trabajando, setTrabajando] = useState(false)
  const fuentesGuardadas = useFuentesAsignatura(asignaturaId, docenteId)

  if (!open) return null

  const isObservacion = categoria === 'observacion'
  const tipoLabel = isObservacion ? 'Actividad de observación' : 'Entregable'

  async function handleGenerar() {
    if (peticion.trim().length < MIN_PETICION) {
      toast(`Describe con más detalle qué quieres trabajar (mínimo ${MIN_PETICION} caracteres)`, 'error'); return
    }
    setTrabajando(true)
    let ref = null
    try {
      const urls = await resolverFuentes(archivos)

      const orden = existingActivitiesCountInParcial + 1
      ref = await addDoc(collection(db, 'activities'), {
        nombre: '',
        categoria,
        tipo: isObservacion ? 'observacion' : 'archivo',
        instrucciones: '',
        archivosAdjuntos: [],
        fechaLimite: null,
        recibirTarde: isObservacion ? null : false,
        oculta: true, // nace oculta: el docente la revisa y publica desde el editor, igual que OP-03/OP-04
        publishAt: null,
        publishedAt: null,
        maxCalif: 10,
        notificarDocente: false,
        parcial, orden, asignaturaId, docenteId,
        createdAt: serverTimestamp(),
      })

      await creditosIA.ejecutar('crear_actividad_ia', {
        actividadId: ref.id,
        categoria,
        asignaturaId,
        asignaturaNombre: asignaturaNombre || '',
        parcial,
        peticion,
        fuentes: urls,
      }, 1)

      toast(`${tipoLabel} generado con IA`)
      onCreated?.(ref.id)
    } catch (err) {
      toast(err.message || 'No se pudo generar la actividad', 'error')
      // La actividad ya se creó (vacía) aunque la IA falle — se deja como
      // borrador oculto, mismo criterio que CrearEvaluacionIAModal.
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
          El asistente propone {isObservacion ? 'la actividad completa (qué vas a observar y cómo se evaluará)' : 'la actividad completa (nombre, instrucciones y tipos de archivo)'} a partir de lo que describas. Lo revisas y ajustas después, como cualquier otra actividad.
        </p>

        <div className="space-y-2.5">
          <div>
            <label htmlFor="ia-act-peticion" className="block text-sm text-on-surface mb-1">¿Qué quieres trabajar?</label>
            <textarea id="ia-act-peticion" value={peticion} disabled={trabajando} rows={4}
              onChange={(e) => setPeticion(e.target.value)}
              placeholder={isObservacion
                ? 'Describe qué vas a observar en tus estudiantes: actitud, participación, exposición de un tema, realización de un ejercicio…'
                : 'Describe la tarea o producto que quieres que tus estudiantes entreguen.'}
              className="w-full px-2.5 py-1.5 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
          </div>

          <FuentesIAInput files={archivos} onChange={setArchivos} disabled={trabajando} fuentesGuardadas={fuentesGuardadas} />
        </div>

        <p className="text-sm text-on-surface mt-3 mb-1">
          Esta acción utilizará aproximadamente <span className="font-semibold">{creditosIA.estimar('crear_actividad_ia') ?? 1}</span> {(creditosIA.estimar('crear_actividad_ia') ?? 1) === 1 ? 'crédito' : 'créditos'} de IA.
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
