// Reto Exprés · traer reactivos existentes (D10, S3): del banco del docente y de los cuestionarios y exámenes de
// la misma asignatura. Solo se pueden marcar los compatibles (opción múltiple o verdadero/falso, sin imagen, con
// respuesta correcta); los demás se muestran apagados con su motivo. Se COPIAN al reto: el original no cambia.
import { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Modal } from '../ui'
import Spinner from '../Spinner'
import { fuentesDeReactivos } from '../../utils/retoExpresDb'
import { MOTIVOS_INCOMPATIBLE } from '../../utils/retoExpres'

const TIPO = { opcion_multiple: 'Opción múltiple', verdadero_falso: 'Verdadero / Falso', respuesta_corta: 'Respuesta corta', subir_archivo: 'Subir documento' }

function Grupo({ titulo, reactivos, marcados, alternar, lleno }) {
  if (!reactivos.length) return null
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-on-surface">{titulo}</h3>
      {reactivos.map((r) => {
        const clave = `${titulo}::${r.id}`
        const marcado = marcados.has(clave)
        return (
          <div key={r.id} className="rounded-card border border-outline-variant p-3">
            <Checkbox checked={marcado} disabled={!r.compatible || (lleno && !marcado)} onChange={() => alternar(clave, r)}
              label={r.enunciado || 'Sin enunciado'}
              hint={r.compatible ? TIPO[r.tipo] : `${TIPO[r.tipo] || 'Reactivo'} · ${MOTIVOS_INCOMPATIBLE[r.motivo] || 'No compatible'}`} />
          </div>
        )
      })}
    </section>
  )
}

export default function ImportarReactivosReto({ open, asignaturaId, docenteId, faltan, onClose, onImportar }) {
  const [fuentes, setFuentes] = useState(null)
  const [error, setError] = useState(null)
  const [marcados, setMarcados] = useState(() => new Map())
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vivo = true
    fuentesDeReactivos({ asignaturaId, docenteId })
      .then((f) => { if (vivo) setFuentes(f) })
      .catch((e) => { if (vivo) setError(e.message || 'No se pudieron cargar los reactivos') })
    return () => { vivo = false }
  }, [asignaturaId, docenteId])

  const lleno = marcados.size >= faltan
  const alternar = (clave, r) => setMarcados((m) => {
    const c = new Map(m)
    if (c.has(clave)) c.delete(clave)
    else if (c.size < faltan) c.set(clave, r)
    return c
  })
  const total = useMemo(() => (fuentes ? fuentes.banco.length + fuentes.evaluaciones.reduce((s, e) => s + e.reactivos.length, 0) : 0), [fuentes])

  async function importar() {
    setGuardando(true)
    try {
      await onImportar([...marcados.entries()].map(([clave, r]) => ({ reactivo: r, deBanco: clave.startsWith('Banco') })))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open={open} onClose={guardando ? undefined : onClose} title="Agregar reactivos existentes" size="lg" busy={guardando}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-muted mr-auto">{marcados.size} de {faltan} {faltan === 1 ? 'lugar' : 'lugares'}</span>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>Cancelar</Button>
          <Button onClick={importar} busy={guardando} disabled={!marcados.size}>Agregar al reto</Button>
        </div>
      )}>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p>
        : !fuentes ? <div className="py-10 flex justify-center"><Spinner /></div>
          : !total ? <p className="text-sm text-muted">No tienes reactivos en tu banco ni cuestionarios o exámenes con reactivos en esta asignatura.</p>
            : (
              <div className="space-y-4">
                <p className="text-sm text-muted">Se copian al reto; los originales no cambian. Solo opción múltiple y verdadero/falso, sin imagen.</p>
                <Grupo titulo="Banco de reactivos" reactivos={fuentes.banco} marcados={marcados} alternar={alternar} lleno={lleno} />
                {fuentes.evaluaciones.map((e) => (
                  <Grupo key={e.id} titulo={`${e.categoria === 'examen' ? 'Examen' : 'Cuestionario'} · ${e.nombre || 'Sin nombre'}`}
                    reactivos={e.reactivos} marcados={marcados} alternar={alternar} lleno={lleno} />
                ))}
              </div>
            )}
    </Modal>
  )
}
