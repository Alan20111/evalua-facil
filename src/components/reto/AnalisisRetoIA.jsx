// Reto Exprés · «Analizar resultados con IA» de UNA competencia terminada (6-nov-2026), en sus Resultados del historial.
//
// Reutiliza todo lo que ya existe: la operación `analizar_resultados` (su tarifa vigente, el libro de créditos, el
// reembolso ante un fallo y el modelo de la plataforma), la confirmación de costo y saldo (ConfirmacionCreditosModal) y
// el visor del análisis de evaluaciones (AnalisisResultadosIA). El servidor (functions/analisisReto.js) calcula todos los
// números del registro definitivo y guarda el análisis; aquí solo se pide y se muestra.
//
// Sin duplicados: el registro de la sesión (`retoResultados`, que la pantalla ya escucha) dice si ya hay análisis
// (`analisisId`) o uno generándose (`analisisEnCurso`); el servidor rechaza sin cobrar un segundo pedido. Si el
// navegador deja de esperar pero el servidor terminó, el registro lo refleja solo y aparece «Ver análisis con IA».
//
// El visor es de pantalla completa: dentro de la ventana de «Resultados» quedaría encerrado en ella (el panel del Modal
// lleva transform). Por eso se entrega a `onVer` (HistorialRetoSesiones lo muestra fuera y reabre Resultados al volver).
import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { Button } from '../ui'
import { useToast } from '../Toast'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import AnalisisResultadosIA from '../evaluacion/AnalisisResultadosIA'
import useCreditosIA from '../../hooks/useCreditosIA'

const MIN_PARTICIPANTES = 3 // el mismo mínimo del servidor (functions/analisisReto.js)

const msDe = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : Number.isFinite(t) ? t : null)

export default function AnalisisRetoIA({ actividad, asignatura = null, sesion, resultados, participantes = [], onVer = null }) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const [confirmando, setConfirmando] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [abriendo, setAbriendo] = useState(false)
  const [visto, setVisto] = useState(null) // { resultado, generadoEn }
  // Un análisis «en curso» que nunca terminó deja de bloquear al vencer su candado (10 min): se revisa cada 5 s.
  const hastaMs = resultados?.analisisEnCurso?.hastaMs
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    if (!Number.isFinite(hastaMs)) return undefined
    const id = setInterval(() => setAhora(Date.now()), 5000)
    return () => clearInterval(id)
  }, [hastaMs])

  const enCurso = Number.isFinite(hastaMs) && hastaMs > ahora
  const nParticipantes = (resultados?.clasificacion || []).length
  const sinDatos = !resultados || resultados.sinResultados || !(resultados.realizadas >= 1)
  const pocos = !sinDatos && nParticipantes < MIN_PARTICIPANTES
  // Nombre que ve el docente: el visible del grupo y, detrás de un alias, el nombre real (solo para él).
  const etiquetas = participantes.map((p) => {
    const alias = sesion?.modoIdentidad === 'alias' || sesion?.modalidad === 'externo'
    const visible = (alias ? p.alias : p.nombre) || 'Participante'
    return { id: p.id, nombre: alias && p.nombre ? `${visible} (${p.nombre})` : visible }
  })
  const mostrar = (v) => (onVer ? onVer({ ...v, students: etiquetas }) : setVisto(v))

  async function verAnalisis(id) {
    setAbriendo(true)
    try {
      const snap = await getDoc(doc(db, 'activities', actividad.id, 'analisisIA', id))
      if (!snap.exists()) throw new Error('No encontramos el análisis guardado.')
      const d = snap.data()
      mostrar({ resultado: d.resultado, generadoEn: msDe(d.generadoEn) })
    } catch (e) {
      toast(e.message || 'No se pudo abrir el análisis', 'error')
    } finally {
      setAbriendo(false)
    }
  }

  async function generar() {
    if (trabajando) return
    setTrabajando(true)
    try {
      const data = await creditosIA.ejecutar('analizar_resultados', {
        actividadId: actividad.id, asignaturaId: actividad.asignaturaId, sesionId: sesion.codigo,
      })
      setConfirmando(false)
      if (data?.resultado) mostrar({ resultado: data.resultado, generadoEn: Date.now() })
    } catch (e) {
      setConfirmando(false)
      toast(e.message || 'No se pudo generar el análisis', 'error')
    } finally {
      setTrabajando(false)
    }
  }

  let contenido
  if (resultados?.analisisId) {
    contenido = (
      <Button variant="secondary" icon={Sparkles} busy={abriendo} onClick={() => verAnalisis(resultados.analisisId)}>Ver análisis con IA</Button>
    )
  } else if (enCurso || trabajando) {
    contenido = (
      <Button variant="secondary" icon={Sparkles} busy disabled>Generando el análisis…</Button>
    )
  } else {
    contenido = (
      <Button variant="secondary" icon={Sparkles} disabled={sinDatos || pocos} onClick={() => setConfirmando(true)}>Analizar resultados con IA</Button>
    )
  }

  return (
    <section aria-labelledby="reto-analisis" className="border-t border-outline-variant pt-4 space-y-2">
      <h3 id="reto-analisis" className="text-base font-semibold text-on-surface">Análisis con IA</h3>
      <p className="text-sm text-muted">
        {resultados?.analisisId
          ? 'Esta competencia ya tiene su análisis. Consultarlo no cuesta créditos.'
          : sinDatos ? 'La competencia terminó antes de la primera pregunta: no hay resultados que analizar.'
            : pocos ? `Se necesitan al menos ${MIN_PARTICIPANTES} participantes en la clasificación para un análisis significativo (hay ${nParticipantes}).`
              : 'Un análisis pedagógico de los resultados reales de esta competencia: aciertos por pregunta, errores frecuentes, diferencias de desempeño y qué repasar.'}
      </p>
      {contenido}
      {(enCurso || trabajando) && <p className="text-xs text-muted">Puede tardar hasta un minuto. Si cierras esta ventana, el análisis se guarda igual.</p>}

      {confirmando && (
        <ConfirmacionCreditosModal
          titulo="Analizar resultados con IA"
          descripcion="El asistente analiza los resultados reales de esta competencia (aciertos por pregunta, respuestas incorrectas más elegidas y desempeño de cada participante con identificadores anónimos) y propone conclusiones y recomendaciones. Es una propuesta: tú decides qué hacer con ella."
          costoMin={creditosIA.estimar('analizar_resultados') ?? 5}
          ejecutando={trabajando}
          onCancelar={() => { if (!trabajando) setConfirmando(false) }}
          onContinuar={generar}
        />
      )}
      {visto && (
        <AnalisisResultadosIA resultado={visto.resultado} students={etiquetas} generadoEn={visto.generadoEn ? new Date(visto.generadoEn).toISOString() : null}
          activity={actividad} subject={asignatura || { nombre: '' }} onClose={() => setVisto(null)} />
      )}
    </section>
  )
}
