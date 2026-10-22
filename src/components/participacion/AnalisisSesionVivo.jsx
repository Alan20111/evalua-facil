// Participación en vivo · ANÁLISIS GLOBAL de una sesión finalizada, desde la lista de sesiones.
//
// Dos análisis distintos, que nunca se mezclan:
//   · Informe final de la sesión → INCLUIDO (gratis). Lo genera el servidor al finalizar si el diagnóstico por pregunta
//     estuvo activo (vivoInformes/{sesión}_final).
//   · Análisis global con IA → DE PAGO, operación `analizar_resultados` (su tarifa la da config/iaTarifas; hoy 5
//     créditos). Se guarda aparte (vivoInformes/{sesión}_global).
// Botón: «Ver análisis» (sin costo) si existe cualquiera de los dos; si no, «Analizar con IA» (pide confirmar el costo).
// «Volver a analizar» genera uno nuevo y vuelve a cobrar, siempre tras confirmar el costo.
// Las cifras que se muestran salen de `datos` (calculados por código en el servidor), nunca del texto de la IA.
import { useState } from 'react'
import { Sparkles, RefreshCw } from 'lucide-react'
import { Button, Modal } from '../ui'
import { useToast } from '../Toast'
import useCreditosIA from '../../hooks/useCreditosIA'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import { InformeFinalDocente } from './DiagnosticoDocente'
import { OP_ANALISIS_GLOBAL } from '../../utils/participacionVivo'

const fecha = (v) => {
  const d = v?.toDate?.() || (v instanceof Date ? v : null)
  return d ? d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : ''
}

function Lista({ titulo, items }) {
  if (!items?.length) return null
  return (
    <div>
      <h4 className="text-sm font-semibold text-on-surface">{titulo}</h4>
      <ul className="mt-1 space-y-1 text-sm text-on-surface list-disc pl-5">{items.map((x, k) => <li key={k} className="break-words">{x}</li>)}</ul>
    </div>
  )
}

// Cifras de una pregunta, calculadas por código.
function cifrasDe(p, encuesta) {
  if (!p) return ''
  const base = `${p.respuestas} ${p.respuestas === 1 ? 'respuesta' : 'respuestas'}`
  if (p.tipo === 'opcion_unica') {
    if (!encuesta && p.porcentajeAcierto != null) return `${base} · ${p.porcentajeAcierto} % de acierto`
    const mayor = [...(p.opciones || [])].sort((a, b) => b.n - a.n)[0]
    return mayor && mayor.n > 0 ? `${base} · la más elegida: ${mayor.letra} (${mayor.porcentaje} %)` : base
  }
  if (p.niveles) return `${base} · ${p.niveles.logrado} logradas, ${p.niveles.parcial} parciales, ${p.niveles.no_logrado} no logradas`
  return base
}

function AnalisisGlobal({ analisis }) {
  const { informe, datos } = analisis
  const encuesta = datos?.encuesta
  const porId = new Map((datos?.preguntas || []).map((p) => [p.id, p]))
  return (
    <section aria-label="Análisis global con IA" className="rounded-card border border-outline-variant bg-surface-card p-4 space-y-3">
      <header className="space-y-1">
        <h3 className="text-base font-semibold text-on-surface flex items-center gap-2"><Sparkles size={16} className="text-accent" aria-hidden="true" />Análisis global de la sesión con IA</h3>
        <p className="text-xs text-muted">Operación de pago{analisis.generadoEn ? ` · generado el ${fecha(analisis.generadoEn)}` : ''}</p>
        <p className="text-xs text-muted">Las cifras las calcula Evalúa Fácil con las respuestas de esta sesión.</p>
      </header>
      {datos && (
        <p className="text-sm text-on-surface">
          <strong>{datos.totalPreguntas}</strong> {datos.totalPreguntas === 1 ? 'pregunta' : 'preguntas'} · <strong>{datos.totalRespuestas}</strong> {datos.totalRespuestas === 1 ? 'respuesta' : 'respuestas'}
          {datos.participantes ? <> · <strong>{datos.participantes}</strong> participantes</> : null}
        </p>
      )}
      <div>
        <h4 className="text-sm font-semibold text-on-surface">{encuesta ? 'Tendencia general' : 'Desempeño general'}</h4>
        <p className="text-sm text-on-surface leading-snug break-words">{informe.desempeno}</p>
      </div>
      <Lista titulo={encuesta ? 'Coincidencias y divisiones' : 'Patrones y tendencias'} items={informe.patrones} />
      {informe.preguntasDestacadas?.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-on-surface">Preguntas destacadas</h4>
          <ul className="mt-1 space-y-2">
            {informe.preguntasDestacadas.map((d) => {
              const p = porId.get(d.preguntaId)
              return (
                <li key={d.preguntaId} className="text-sm text-on-surface rounded-card bg-surface p-3 break-words">
                  <p className="font-semibold">Pregunta {p?.numero}: {p?.enunciado}</p>
                  <p className="text-xs text-muted">{cifrasDe(p, encuesta)}</p>
                  <p className="mt-1">{d.motivo}</p>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <Lista titulo={encuesta ? 'Temas sin consenso' : 'Dificultades de aprendizaje'} items={informe.dificultades} />
      <Lista titulo="Recomendaciones" items={informe.recomendaciones} />
      {datos?.preguntas?.length > 0 && (
        <details className="text-sm text-on-surface">
          <summary className="cursor-pointer font-semibold">Resultados por pregunta</summary>
          <ul className="mt-2 space-y-1">
            {datos.preguntas.map((p) => <li key={p.id} className="break-words"><span className="font-medium">Pregunta {p.numero}:</span> {cifrasDe(p, encuesta)}</li>)}
          </ul>
        </details>
      )}
      {informe.limitaciones && <p className="text-xs text-muted break-words">Limitaciones: {informe.limitaciones}</p>}
    </section>
  )
}

export default function AnalisisSesionVivo({ sesion, analisis = {} }) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const [viendo, setViendo] = useState(false)
  const [confirmando, setConfirmando] = useState(null) // 'nuevo' | 'regenerar'
  const [ejecutando, setEjecutando] = useState(false)
  const [recien, setRecien] = useState(null) // resultado recién devuelto, hasta que llegue por la suscripción
  const costo = creditosIA.estimar(OP_ANALISIS_GLOBAL)
  const guardado = analisis.global || null
  const global = recien && (recien.generaciones || 0) > (guardado?.generaciones || 0) ? recien : guardado
  const final = analisis.final || null
  const hay = !!(global || final)

  async function generar(regenerar) {
    if (ejecutando) return // un clic a la vez; el servidor además rechaza sin cobrar una solicitud simultánea
    setEjecutando(true)
    try {
      const data = await creditosIA.ejecutar(OP_ANALISIS_GLOBAL, {
        sesionVivoId: sesion.codigo, asignaturaId: sesion.asignaturaId || null, generacionVista: guardado?.generaciones || 0, regenerar,
      })
      if (data?.resultado) setRecien({ ...data.resultado, generadoEn: new Date() })
      setConfirmando(null)
      setViendo(true)
      toast(data?.repetida ? 'Este análisis ya se había generado: no se cobró de nuevo' : `Análisis listo · se descontaron ${data?.creditosReales ?? costo} créditos`)
    } catch (e) {
      setConfirmando(null)
      if (e.codigo === 'YA_EXISTE' || e.codigo === 'YA_ACTUALIZADO' || e.codigo === 'EN_CURSO') setViendo(hay)
      toast(e.message || 'No se pudo generar el análisis', 'error')
    } finally {
      setEjecutando(false)
    }
  }

  return (
    <>
      {hay ? (
        <Button size="sm" variant="secondary" icon={Sparkles} onClick={() => setViendo(true)}>Ver análisis</Button>
      ) : (
        <Button size="sm" variant="secondary" icon={Sparkles} disabled={costo == null || ejecutando} onClick={() => setConfirmando('nuevo')}
          title={costo == null ? 'Cargando la tarifa…' : `Análisis global de la sesión con IA: ${costo} créditos`}>
          Analizar con IA
        </Button>
      )}

      {viendo && !confirmando && (
        <Modal open onClose={() => setViendo(false)} title="Análisis de la sesión" size="2xl"
          footer={(
            <div className="flex flex-wrap items-center justify-end gap-2 w-full">
              <Button variant="quiet" onClick={() => setViendo(false)}>Cerrar</Button>
              <Button variant="secondary" icon={RefreshCw} disabled={costo == null || ejecutando} onClick={() => setConfirmando('regenerar')}>
                Volver a analizar{costo != null ? ` (${costo} créditos)` : ''}
              </Button>
            </div>
          )}>
          <div className="space-y-4">
            {global ? <AnalisisGlobal analisis={global} /> : (
              <p className="text-sm text-muted">Esta sesión aún no tiene análisis global con IA. Con «Volver a analizar» puedes generarlo{costo != null ? ` (${costo} créditos)` : ''}.</p>
            )}
            {final && (
              <div className="space-y-1">
                <p className="text-xs text-muted">Incluido sin costo: se generó al finalizar la sesión con el diagnóstico por pregunta activo.</p>
                <InformeFinalDocente sesion={{ ...sesion, analisisActivo: true }} informes={[final]} />
              </div>
            )}
          </div>
        </Modal>
      )}

      {confirmando && (
        <ConfirmacionCreditosModal
          titulo={confirmando === 'regenerar' ? 'Volver a analizar la sesión' : 'Analizar la sesión con IA'}
          descripcion={confirmando === 'regenerar'
            ? `Se generará un análisis global NUEVO de esta sesión y se cobrará otra vez (${costo} créditos). El análisis anterior se reemplaza cuando el nuevo esté listo.`
            : `Análisis global de esta sesión: desempeño del grupo, patrones, preguntas destacadas, dificultades y recomendaciones. Cuesta ${costo} créditos por sesión analizada; el diagnóstico por pregunta va incluido aparte. Las cifras las calcula Evalúa Fácil con las respuestas de esta sesión.`}
          costoMin={costo ?? 0}
          ejecutando={ejecutando}
          avisoEjecutando="Analizando la sesión… esto toma unos segundos. No cierres esta ventana."
          onCancelar={() => { if (!ejecutando) setConfirmando(null) }}
          onContinuar={() => generar(confirmando === 'regenerar')}
        />
      )}
    </>
  )
}
