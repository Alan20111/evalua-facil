// Informe FINAL de la sesión para el DOCENTE: síntesis de los diagnósticos por pregunta (qué comprende o opina el grupo y cuál
// es el siguiente paso). Los resultados de cada pregunta ya los muestran las gráficas, la nube y las tarjetas; el diagnóstico
// automático por pregunta se genera en el servidor y alimenta este informe.
//
// El «Análisis de resultados con IA» es OPCIONAL y se cobra aparte (tarifa fija por sesión, `activar_analisis_vivo` en
// config/iaTarifas): se pide aquí, con la sesión finalizada, después de confirmar el costo. Sin él, los resultados, el PDF y las
// notas siguen disponibles. «Actualizar informe» queda incluido en ese pago, dentro de LIMITES_INFORME.
import { useState } from 'react'
import { Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '../ui'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import useCreditosIA from '../../hooks/useCreditosIA'
import { LIMITES_INFORME, UMBRALES_DIAGNOSTICO, VIVO_CFG, datosSuficientesAnalisisVivo, esEncuesta } from '../../utils/participacionVivo'
import { actualizarInformeVivo } from '../../utils/participacionVivoDb'
import { PASO_INFORME_VIVO as PASO, PASO_INFORME_VIVO_ENCUESTA as PASO_ENCUESTA, rotulosInformeVivo } from '../../utils/informeVivoPDF'
import BotonInformeVivoPDF from './BotonInformeVivoPDF'

function Lista({ titulo, items }) {
  if (!items?.length) return null
  return (
    <div>
      <h4 className="text-sm font-semibold text-on-surface">{titulo}</h4>
      <ul className="mt-1 space-y-1 text-sm text-on-surface list-disc pl-5">{items}</ul>
    </div>
  )
}

// Sesión finalizada SIN análisis: la opción de pedirlo, con su costo real. El servidor vuelve a comprobar todo antes de cobrar.
function SolicitarAnalisis({ sesion, respuestas, pdf }) {
  const creditosIA = useCreditosIA()
  const [confirmando, setConfirmando] = useState(false)
  const [analizando, setAnalizando] = useState(false)
  const [error, setError] = useState('')
  const costo = creditosIA.estimar(VIVO_CFG.OP_ANALISIS) // créditos por sesión, de config/iaTarifas
  const sinTarifa = creditosIA.listo && costo == null
  const suficientes = datosSuficientesAnalisisVivo(sesion, respuestas)
  async function analizar() {
    setAnalizando(true); setError('')
    try {
      // Una clave por confirmación (la genera el hook): un reintento de red no cobra dos veces. Puede tardar hasta un par de
      // minutos (evalúa las respuestas abiertas y prepara los informes).
      await creditosIA.ejecutar(VIVO_CFG.OP_ANALISIS, { sesionId: sesion.codigo }, 1, { timeoutMs: 290000 })
      setConfirmando(false)
    } catch (e) {
      setConfirmando(false)
      setError(e.codigoSDK === 'functions/deadline-exceeded'
        ? 'El análisis está tardando más de lo normal. Si termina, aparecerá aquí; si no, no se cobra.'
        : (e.message || 'No se pudo preparar el análisis. No se descontaron créditos.'))
    } finally {
      setAnalizando(false)
    }
  }
  return (
    <>
      <div className="rounded-card bg-surface p-3 space-y-2">
        <p className="text-sm font-semibold text-on-surface">Análisis de resultados con IA</p>
        <p className="text-sm text-on-surface">
          {costo != null
            ? <>Opcional · <strong>{costo} {costo === 1 ? 'crédito' : 'créditos'}</strong> por sesión, sin importar el número de preguntas.</>
            : sinTarifa ? 'El análisis de resultados con IA aún no está disponible.' : 'Calculando el costo…'}
        </p>
        <p className="text-xs text-muted">La IA evalúa las respuestas abiertas, interpreta cada pregunta y prepara este informe. No forma parte del costo de las preguntas, solo se cobra si lo solicitas e incluye «Actualizar informe» sin costo adicional. Los resultados, el PDF y tus notas están disponibles sin él.</p>
        {!suficientes && (
          <p className="text-xs text-amber-800">Todavía no hay respuestas suficientes para un diagnóstico del grupo (hacen falta {UMBRALES_DIAGNOSTICO.opcion_unica} de opción única u {UMBRALES_DIAGNOSTICO.abierta_extensa} abiertas en una pregunta).</p>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" icon={Sparkles} disabled={costo == null || !suficientes || analizando} busy={analizando} onClick={() => { setError(''); setConfirmando(true) }}>Analizar con IA</Button>
        {pdf}
      </div>
      {confirmando && (
        <ConfirmacionCreditosModal
          titulo="Análisis de resultados con IA"
          descripcion="La IA evaluará las respuestas abiertas de esta sesión e interpretará los resultados para preparar el informe final. Es opcional y aparte del costo de las preguntas."
          costoMin={costo ?? 0}
          ejecutando={analizando}
          avisoEjecutando="Analizando las respuestas… puede tardar hasta un par de minutos. No cierres esta ventana."
          onCancelar={() => { if (!analizando) setConfirmando(false) }}
          onContinuar={analizar}
          z={70}
        />
      )}
    </>
  )
}

/** Informe FINAL de la sesión: síntesis de los diagnósticos por pregunta. `respuestas` y `notas` solo alimentan el PDF. */
export function InformeFinalDocente({ sesion, informes, respuestas = [], notas = '' }) {
  const encuesta = esEncuesta(sesion.proposito)
  const [actualizando, setActualizando] = useState(false)
  const [error, setError] = useState('')
  const doc = informes.find((i) => !i.preguntaId)
  const pdf = <BotonInformeVivoPDF sesion={sesion} informe={doc || null} respuestas={respuestas} notas={notas} disabled={actualizando} />
  if (!sesion.analisisActivo) {
    return (
      <section aria-label="Informe final de la sesión" className="rounded-card border border-outline-variant bg-surface-card p-4 space-y-3">
        <header className="flex items-center gap-2">
          <Sparkles size={16} className="text-accent" aria-hidden="true" />
          <h3 className="text-base font-semibold text-on-surface">Informe final de la sesión</h3>
        </header>
        <SolicitarAnalisis sesion={sesion} respuestas={respuestas} pdf={pdf} />
      </section>
    )
  }
  // Pedido en curso (desde aquí o desde otra pestaña): el informe todavía no existe.
  const preparando = !doc && !!sesion.analisisCobroKey
  async function actualizar() {
    setActualizando(true); setError('')
    try { await actualizarInformeVivo({ sesionId: sesion.codigo }) } catch (e) { setError(e.message || 'No se pudo actualizar') } finally { setActualizando(false) }
  }
  const inf = doc?.informe
  const rot = rotulosInformeVivo(encuesta)
  return (
    <section aria-label="Informe final de la sesión" className="rounded-card border border-outline-variant bg-surface-card p-4 space-y-3">
      <header className="flex items-center gap-2">
        <Sparkles size={16} className="text-accent" aria-hidden="true" />
        <h3 className="text-base font-semibold text-on-surface">Informe final de la sesión</h3>
      </header>
      {(doc?.estado === 'generando' || preparando) && <p className="text-sm text-muted flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Preparando el informe…</p>}
      {doc?.estado === 'listo' && inf && (
        <>
          <p className="text-base text-on-surface leading-snug">{inf.sintesis}</p>
          <Lista titulo={rot.comprende} items={(inf.comprende || []).map((x, k) => <li key={k}>{x}</li>)} />
          <Lista titulo={rot.noComprende} items={(inf.noComprende || []).map((x, k) => <li key={k}>{x}</li>)} />
          <div className="rounded-card bg-surface p-3">
            <p className="text-sm font-semibold text-on-surface">{(encuesta ? PASO_ENCUESTA : PASO)[inf.siguientePaso?.tipo] || 'Siguiente paso'}</p>
            <p className="text-sm text-on-surface">{inf.siguientePaso?.texto}</p>
            {inf.actividadBreve && <p className="text-sm text-on-surface mt-2"><strong>Actividad breve:</strong> {inf.actividadBreve}</p>}
          </div>
          {inf.limitaciones && <p className="text-xs text-muted">Limitaciones: {inf.limitaciones}</p>}
        </>
      )}
      {((!doc && !preparando) || doc?.estado === 'insuficiente') && <p className="text-sm text-on-surface">Muestra insuficiente: {doc?.motivo || 'ninguna pregunta reunió datos suficientes para una síntesis.'}</p>}
      {doc?.estado === 'error' && <p className="text-sm text-red-700">No se pudo preparar el informe. Puedes intentarlo de nuevo.</p>}
      {/* El PDF no depende del límite de «Actualizar»: se puede exportar siempre que el informe no se esté preparando. */}
      {doc?.estado !== 'generando' && !preparando && (
        <div className="flex flex-wrap items-center gap-3">
          {(doc?.generaciones ?? 0) < LIMITES_INFORME.FINAL && (
            <Button variant="secondary" size="sm" icon={RefreshCw} busy={actualizando} onClick={actualizar}
              title="Incluido en el análisis de esta sesión: no tiene costo adicional">Actualizar informe</Button>
          )}
          {pdf}
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      )}
    </section>
  )
}
