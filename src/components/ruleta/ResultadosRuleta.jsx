// La Ruleta del Destino · RESULTADOS para el docente (paso 2, individual e interna).
// Quién jugó, si terminó o va en curso, sus aciertos, su calificación, qué pasó con la nota y el detalle de cada
// pregunta. Todo se lee de `ruletaParticipantes` (lo escribe solo el servidor; las reglas dejan leerlo solo al docente
// dueño). La nota oficial vive en `submissions` y el docente la corrige por el camino de siempre (R4).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RotateCw, Users } from 'lucide-react'
import { Badge, Button, EmptyState, Modal, Skeleton, Table } from '../ui'
import { studentFullName } from '../../utils/studentSearch'
import { MOTIVOS_RESPUESTA, RULETA_CFG } from '../../utils/ruletaDestino'
import { cargarResultadosRuleta } from '../../utils/ruletaDestinoDb'

const LETRAS = ['A', 'B', 'C', 'D']
const nombreDe = (fila) => (fila.alumno ? studentFullName(fila.alumno) : 'Estudiante dado de baja')

function EstadoNota({ fila }) {
  if (!fila.terminada) return <span className="text-muted">—</span>
  if (fila.nota?.estado === 'conservada') return <Badge tone="warning">Se conservó tu nota</Badge>
  if (fila.nota?.estado === 'registrada') return <Badge tone="success">Registrada</Badge>
  return <Badge>Sin registrar</Badge>
}

function textoOpcion(r) {
  if (r.motivo === MOTIVOS_RESPUESTA.sin_respuesta) return 'Sin respuesta'
  if (r.motivo === MOTIVOS_RESPUESTA.fuera_de_tiempo) return 'Respondió fuera de tiempo'
  return `${LETRAS[r.opcion] || '?'}. ${r.opciones[r.opcion] ?? ''}`
}

function DetalleParticipante({ fila, onClose }) {
  return (
    <Modal open onClose={onClose} title={nombreDe(fila)} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {fila.terminada
            ? `Terminó: ${fila.resultado?.correctas ?? 0} de ${fila.total} correctas · calificación ${fila.resultado?.calificacion ?? '—'} / ${RULETA_CFG.CALIFICACION_MAXIMA}`
            : `En curso: lleva ${fila.respondidas} de ${fila.total} preguntas`}
        </p>
        {fila.detalle.length === 0 && <p className="text-base text-muted">Todavía no responde ninguna pregunta.</p>}
        <ol className="space-y-3">
          {fila.detalle.map((r) => (
            <li key={r.indice} className="rounded-card border border-outline-variant p-3 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-on-surface break-words">{r.indice + 1}. {r.enunciado}</p>
                <Badge tone={r.acierto ? 'success' : 'danger'}>{r.acierto ? 'Correcta' : 'Incorrecta'}</Badge>
              </div>
              <p className="text-sm text-on-surface break-words">Eligió: {textoOpcion(r)}</p>
              {!r.acierto && Number.isInteger(r.correcta) && (
                <p className="text-sm text-muted break-words">Correcta: {LETRAS[r.correcta]}. {r.opciones[r.correcta]}</p>
              )}
              {Number.isFinite(r.tiempoMs) && <p className="text-xs text-hint">Tiempo: {(r.tiempoMs / 1000).toFixed(1)} s</p>}
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  )
}

export default function ResultadosRuleta({ actividad, uid }) {
  const [filas, setFilas] = useState(null) // null = cargando
  const [error, setError] = useState(null)
  const [detalle, setDetalle] = useState(null)

  const leer = useCallback(() => cargarResultadosRuleta(actividad, uid), [actividad, uid])

  useEffect(() => {
    let vigente = true
    leer()
      .then((r) => { if (vigente) { setFilas(r); setError(null) } })
      .catch((e) => { if (vigente) { setError(e.message || 'No se pudieron cargar los resultados'); setFilas([]) } })
    return () => { vigente = false }
  }, [leer])

  async function actualizar() {
    setFilas(null)
    try { setFilas(await leer()); setError(null) } catch (e) { setError(e.message || 'No se pudieron cargar los resultados'); setFilas([]) }
  }

  const ordenadas = useMemo(() => (filas || []).slice().sort((a, b) => nombreDe(a).localeCompare(nombreDe(b), 'es')), [filas])
  const terminadas = ordenadas.filter((f) => f.terminada).length

  const columnas = [
    { key: 'nombre', header: 'Estudiante', render: (f) => <span className="font-medium text-on-surface">{nombreDe(f)}</span> },
    {
      key: 'estado', header: 'Estado',
      render: (f) => (f.terminada ? <Badge tone="success">Terminada</Badge> : <Badge tone="warning">En curso · {f.respondidas} de {f.total}</Badge>),
    },
    { key: 'aciertos', header: 'Aciertos', align: 'center', render: (f) => (f.terminada ? `${f.resultado?.correctas ?? 0} de ${f.total}` : '—') },
    { key: 'calificacion', header: 'Calificación', align: 'center', render: (f) => (f.terminada ? (f.resultado?.calificacion ?? '—') : '—') },
    { key: 'nota', header: 'Nota', render: (f) => <EstadoNota fila={f} /> },
    { key: 'detalle', header: '', align: 'right', render: (f) => <Button variant="quiet" size="sm" onClick={() => setDetalle(f)}>Ver detalle</Button> },
  ]

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ruleta-resultados-titulo" className="text-lg font-semibold text-on-surface">Resultados</h2>
        <Button variant="quiet" size="sm" icon={RotateCw} onClick={actualizar} disabled={filas === null}>Actualizar</Button>
      </div>
      {filas === null ? (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando resultados">
          <Skeleton className="h-5 w-48 rounded-full" />
          <Skeleton className="h-24 w-full rounded-card" />
        </div>
      ) : error ? (
        <p className="text-base text-red-700">{error}</p>
      ) : ordenadas.length === 0 ? (
        <EmptyState icon={Users} tone="neutral" title="Todavía nadie juega esta ruleta">
          Cuando tus estudiantes jueguen, aquí verás su avance y su calificación.
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-muted">
            {ordenadas.length} {ordenadas.length === 1 ? 'participante' : 'participantes'} · {terminadas} {terminadas === 1 ? 'terminó' : 'terminaron'} · {ordenadas.length - terminadas} en curso.
            {' '}La calificación se registra sola al terminar; si ya habías calificado a alguien, se conserva tu nota.
          </p>
          <Table columns={columnas} data={ordenadas} rowKey={(f) => f.id} minWidth={640} className="shadow-none border border-outline-variant" />
        </>
      )}
      {detalle && <DetalleParticipante fila={detalle} onClose={() => setDetalle(null)} />}
    </>
  )
}
