// Selector de "Fuentes para la IA" — componente controlado compartido entre
// CrearEvaluacionIAModal (OP-03/04), el modal "Generar reactivos con IA"
// (OP-09, EvaluacionEditor.jsx) y CrearActividadIAModal (OP-05). Antes vivía
// duplicado dentro de CrearEvaluacionIAModal.jsx; se extrajo tal cual para
// no repetir el JSX en cada modal nuevo.
//
// `files` son File aún NO subidos — quien use este componente sube con
// subirFuentes() (utils/fuentesIA.js) justo antes de llamar a la IA.

import { Paperclip, Trash2, RefreshCw } from 'lucide-react'
import { useToast } from '../Toast'
import { MAX_FUENTES, MAX_FUENTE_BYTES, FUENTES_ACCEPT } from '../../utils/fuentesIA'
import { esMismaFuente } from '../../utils/fuentesAsignatura'

// Un elemento de `files` es un File nuevo por subir, o una referencia
// { nombre, storedUrl, stored: true } que reutiliza una fuente ya guardada en
// Fuentes de la Asignatura (ver fuentesGuardadas) — nunca se sube dos veces.
function nombreDe(f) { return f instanceof File ? f.name : f.nombre }

export default function FuentesIAInput({ files, onChange, disabled = false, fuentesGuardadas = [] }) {
  const toast = useToast()

  function addArchivos(nuevos) {
    if (files.length + nuevos.length > MAX_FUENTES) {
      toast(`Puedes adjuntar máximo ${MAX_FUENTES} documentos`, 'error'); return
    }
    const tooBig = nuevos.find((f) => f.size > MAX_FUENTE_BYTES)
    if (tooBig) { toast(`"${tooBig.name}" supera el máximo de 15 MB`, 'error'); return }

    // Si el archivo ya está guardado en Fuentes de la Asignatura (mismo
    // nombre + tamaño + tipo, ver esMismaFuente), se reutiliza esa fuente en
    // vez de subir una copia duplicada.
    let reusados = 0
    const resueltos = nuevos.map((f) => {
      const guardada = fuentesGuardadas.find((g) => esMismaFuente(f, g))
      if (guardada) { reusados++; return { nombre: guardada.nombre, storedUrl: guardada.url, stored: true } }
      return f
    })
    if (reusados > 0) {
      toast(
        reusados === 1
          ? 'Ese archivo ya está en Fuentes de la Asignatura — se reutiliza sin subir una copia'
          : `${reusados} archivos ya estaban en Fuentes de la Asignatura — se reutilizan sin subir copias`
      )
    }
    onChange([...files, ...resueltos])
  }
  function removeArchivo(i) {
    onChange(files.filter((_, idx) => idx !== i))
  }

  return (
    <div>
      <p className="block text-sm text-on-surface mb-1">Fuentes para la IA (opcional)</p>
      <p className="text-xs text-muted mb-1.5">
        Puedes subir hasta 3 archivos PDF o Word para que la IA utilice su contenido como referencia.
      </p>
      <div className="space-y-1.5">
        {files.map((f, i) => (
          <div key={`${nombreDe(f)}-${i}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-outline-variant bg-surface text-sm">
            {f.stored
              ? <RefreshCw size={14} className="text-accent flex-shrink-0" aria-label="Fuente reutilizada" />
              : <Paperclip size={14} className="text-muted flex-shrink-0" />}
            <span className="flex-1 truncate">{nombreDe(f)}</span>
            {f.stored && <span className="text-xs text-accent flex-shrink-0">Ya guardada</span>}
            <button type="button" onClick={() => removeArchivo(i)} disabled={disabled}
              className="p-0.5 text-muted hover:text-red-500" aria-label={`Quitar ${nombreDe(f)}`}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {files.length < MAX_FUENTES && (
          <label className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent cursor-pointer hover:bg-[var(--accent-tint)]">
            <Paperclip size={14} /> Agregar archivo
            <input type="file" accept={FUENTES_ACCEPT} className="hidden" disabled={disabled}
              onChange={(e) => { if (e.target.files.length) addArchivos(Array.from(e.target.files)); e.target.value = '' }} />
          </label>
        )}
      </div>
    </div>
  )
}
