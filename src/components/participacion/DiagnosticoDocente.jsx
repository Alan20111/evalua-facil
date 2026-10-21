// Diagnóstico pedagógico para el DOCENTE. No repite lo que ya muestra la proyección (columnas, nube, muro): INTERPRETA
// —qué confusión hay detrás, qué ideas aparecen, qué reforzar y cuál es el siguiente paso— y declara con cuántos datos
// se basa y con qué confianza. Si la muestra no alcanza lo dice; nunca inventa un diagnóstico.
import { useState } from 'react'
import { Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '../ui'
import { LIMITES_INFORME, coberturaConceptos, puedeDiagnosticar, respuestasDiagnosticables } from '../../utils/participacionVivo'
import { actualizarInformeVivo } from '../../utils/participacionVivoDb'

const PASO = { reexplicar: 'Volver a explicar', aclarar: 'Aclarar con un ejemplo', actividad: 'Hacer una actividad breve' }
const CONFIANZA = { alta: 'Confianza alta', media: 'Confianza media', baja: 'Confianza baja' }
const letra = (i) => String.fromCharCode(65 + i)

function Lista({ titulo, items }) {
  if (!items?.length) return null
  return (
    <div>
      <h4 className="text-sm font-semibold text-on-surface">{titulo}</h4>
      <ul className="mt-1 space-y-1 text-sm text-on-surface list-disc pl-5">{items}</ul>
    </div>
  )
}

function Cuerpo({ pregunta, informe, respuestas }) {
  const citas = (ids) => ids.slice(0, 2).map((id) => respuestas.find((r) => r.id === id)?.texto).filter(Boolean)
  return (
    <div className="space-y-3">
      <p className="text-base text-on-surface leading-snug">{informe.diagnostico}</p>
      {pregunta.tipo === 'opcion_unica' && informe.confusiones?.length > 0 && (
        <Lista titulo="Confusiones que aparecen" items={informe.confusiones.map((c) => {
          const i = pregunta.opciones.findIndex((o) => o.id === c.opcion)
          return <li key={c.opcion}><strong>{c.n}</strong> eligieron la opción <strong>{letra(i)}</strong>: {c.texto}</li>
        })} />
      )}
      {pregunta.tipo !== 'opcion_unica' && (
        <>
          <Lista titulo="Ideas que se repiten" items={(informe.ideas || []).map((x, k) => (
            <li key={k}>{x.texto} <span className="text-muted">({x.n})</span>{citas(x.ids).map((c, j) => <q key={j} className="block text-muted italic">{c}</q>)}</li>
          ))} />
          <Lista titulo="Confusiones o vacíos" items={(informe.confusiones || []).map((x, k) => (
            <li key={k}>{x.texto} <span className="text-muted">({x.n})</span>{citas(x.ids).map((c, j) => <q key={j} className="block text-muted italic">{c}</q>)}</li>
          ))} />
        </>
      )}
      {informe.cobertura?.length > 0 && (
        <Lista titulo="Conceptos esperados" items={informe.cobertura.map((c) => (
          <li key={c.concepto} className="list-none -ml-5">{c.aparece ? '✓' : '—'} {c.concepto}{c.aparece && <span className="text-muted"> ({c.n})</span>}</li>
        ))} />
      )}
      <Lista titulo="Qué reforzar" items={(informe.refuerzo || []).map((x, k) => <li key={k}>{x}</li>)} />
      <div className="rounded-card bg-surface p-3">
        <p className="text-sm font-semibold text-on-surface">{PASO[informe.siguientePaso?.tipo] || 'Siguiente paso'}</p>
        <p className="text-sm text-on-surface">{informe.siguientePaso?.texto}</p>
      </div>
      {informe.limitaciones && <p className="text-xs text-muted">Limitaciones: {informe.limitaciones}</p>}
    </div>
  )
}

export default function DiagnosticoDocente({ sesion, pregunta, respuestas, informes, claves, titulo = null }) {
  const [actualizando, setActualizando] = useState(false)
  const [error, setError] = useState('')
  const doc = informes.find((i) => i.preguntaId === pregunta.id)
  const chequeo = puedeDiagnosticar(pregunta, respuestas)
  const usables = respuestasDiagnosticables(pregunta, respuestas)
  const generaciones = doc?.generaciones ?? 0
  const sinCupo = generaciones >= LIMITES_INFORME.POR_PREGUNTA
  async function actualizar() {
    setActualizando(true); setError('')
    try { await actualizarInformeVivo({ sesionId: sesion.codigo, preguntaId: pregunta.id }) } catch (e) { setError(e.message || 'No se pudo actualizar') } finally { setActualizando(false) }
  }
  // Conceptos esperados: cálculo gratuito (sin IA); sirve incluso cuando la muestra no alcanza para un diagnóstico.
  const esperados = claves?.[pregunta.id]?.conceptos || []
  const cobertura = pregunta.tipo === 'abierta_breve' && esperados.length ? coberturaConceptos(usables.map((r) => r.texto), esperados) : []
  return (
    <section aria-label="Diagnóstico pedagógico" className="rounded-card border border-outline-variant bg-surface-card p-4">
      <header className="flex items-center gap-2 mb-3">
        <Sparkles size={16} className="text-accent" aria-hidden="true" />
        <h3 className="text-base font-semibold text-on-surface">{titulo || 'Diagnóstico pedagógico'}</h3>
        <span className="ml-auto text-xs text-muted">{CONFIANZA[chequeo.confianza]} · {chequeo.n} {chequeo.n === 1 ? 'respuesta' : 'respuestas'}</span>
      </header>
      {!sesion.analisisActivo && <p className="text-sm text-muted">Activa «Analizar con IA» para obtener el diagnóstico de esta pregunta.</p>}
      {sesion.analisisActivo && doc?.estado === 'generando' && <p className="text-sm text-muted flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Preparando el diagnóstico…</p>}
      {sesion.analisisActivo && doc?.estado === 'listo' && <Cuerpo pregunta={pregunta} informe={{ ...doc.informe, cobertura: doc.informe?.cobertura || cobertura }} respuestas={respuestas} />}
      {sesion.analisisActivo && doc?.estado === 'error' && <p className="text-sm text-red-700">No se pudo preparar el diagnóstico. Puedes intentarlo de nuevo.</p>}
      {sesion.analisisActivo && (!doc || doc.estado === 'insuficiente') && (
        <div className="space-y-2">
          <p className="text-sm text-on-surface">Muestra insuficiente: {doc?.motivo || chequeo.motivo || 'aún no hay respuestas suficientes.'}</p>
          {cobertura.length > 0 && <Lista titulo="Conceptos esperados" items={cobertura.map((c) => <li key={c.concepto} className="list-none -ml-5">{c.aparece ? '✓' : '—'} {c.concepto}{c.aparece && <span className="text-muted"> ({c.n})</span>}</li>)} />}
        </div>
      )}
      {sesion.analisisActivo && chequeo.ok && doc?.estado !== 'generando' && (
        <div className="mt-3 flex items-center gap-3">
          <Button variant="secondary" size="sm" icon={RefreshCw} busy={actualizando} disabled={sinCupo} onClick={actualizar}>Actualizar diagnóstico</Button>
          {sinCupo && <span className="text-xs text-muted">Llegaste al máximo de actualizaciones de esta pregunta.</span>}
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      )}
    </section>
  )
}

/** Informe FINAL de la sesión: síntesis de los diagnósticos por pregunta. */
export function InformeFinalDocente({ sesion, informes }) {
  const [actualizando, setActualizando] = useState(false)
  const [error, setError] = useState('')
  const doc = informes.find((i) => !i.preguntaId)
  if (!sesion.analisisActivo) return null
  async function actualizar() {
    setActualizando(true); setError('')
    try { await actualizarInformeVivo({ sesionId: sesion.codigo }) } catch (e) { setError(e.message || 'No se pudo actualizar') } finally { setActualizando(false) }
  }
  const inf = doc?.informe
  return (
    <section aria-label="Informe final de la sesión" className="rounded-card border border-outline-variant bg-surface-card p-4 space-y-3">
      <header className="flex items-center gap-2">
        <Sparkles size={16} className="text-accent" aria-hidden="true" />
        <h3 className="text-base font-semibold text-on-surface">Informe final de la sesión</h3>
      </header>
      {doc?.estado === 'generando' && <p className="text-sm text-muted flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Preparando el informe…</p>}
      {doc?.estado === 'listo' && inf && (
        <>
          <p className="text-base text-on-surface leading-snug">{inf.sintesis}</p>
          <Lista titulo="Lo que el grupo comprende" items={(inf.comprende || []).map((x, k) => <li key={k}>{x}</li>)} />
          <Lista titulo="Lo que aún no comprende" items={(inf.noComprende || []).map((x, k) => <li key={k}>{x}</li>)} />
          <div className="rounded-card bg-surface p-3">
            <p className="text-sm font-semibold text-on-surface">{PASO[inf.siguientePaso?.tipo] || 'Siguiente paso'}</p>
            <p className="text-sm text-on-surface">{inf.siguientePaso?.texto}</p>
            {inf.actividadBreve && <p className="text-sm text-on-surface mt-2"><strong>Actividad breve:</strong> {inf.actividadBreve}</p>}
          </div>
          {inf.limitaciones && <p className="text-xs text-muted">Limitaciones: {inf.limitaciones}</p>}
        </>
      )}
      {(!doc || doc.estado === 'insuficiente') && <p className="text-sm text-on-surface">Muestra insuficiente: {doc?.motivo || 'ninguna pregunta reunió datos suficientes para una síntesis.'}</p>}
      {doc?.estado === 'error' && <p className="text-sm text-red-700">No se pudo preparar el informe. Puedes intentarlo de nuevo.</p>}
      {doc?.estado !== 'generando' && (doc?.generaciones ?? 0) < LIMITES_INFORME.FINAL && (
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" icon={RefreshCw} busy={actualizando} onClick={actualizar}>Actualizar informe</Button>
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      )}
    </section>
  )
}
