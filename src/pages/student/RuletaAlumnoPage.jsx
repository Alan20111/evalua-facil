// La Ruleta del Destino · ESTUDIANTE INSCRITO (fases 4 y 5, individual). Entra desde la lista de actividades de su
// asignatura; el servidor comprueba su sesión, su inscripción y que la ruleta esté disponible (api/_lib/ruletaPartida.js).
//
// Presentación de la actividad (decisión 22, 14-nov-2026): antes de jugar, el estudiante ve qué actividad es, sus
// instrucciones, cuánto vale y su fecha límite. La partida se inicia al oprimir «Comenzar», no al abrir la página.
// Quien ya tiene una partida (en curso o terminada) entra directo a ella, como siempre. Si la presentación no se
// puede cargar, se pasa a la partida: el servidor decide ahí, igual que antes de esta pantalla.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, CircleHelp, GraduationCap, LoaderPinwheel, Repeat, Timer } from 'lucide-react'
import { Button } from '../../components/ui'
import PartidaRuleta from '../../components/ruleta/PartidaRuleta'
import { EsqueletoRuletaAlumno } from '../../components/esqueletos'
import { ICONO } from '../../config/iconos'
import { fetchActivity } from '../../utils/apiContent'
import { estadosRuletaAlumno } from '../../utils/ruletaDestinoDb'
import { RULETA_CFG, fechaLimiteVencida, textoDeInstrucciones } from '../../utils/ruletaDestino'
import { formatDeadline, sinCalificacion } from '../../utils/activityVisibility'
import { sanitizeHtml, richTextContentClass, toRichHtml } from '../../utils/sanitizeHtml'

function Dato({ icono: Icono, children }) {
  return (
    <li className="flex items-start gap-3 text-base text-on-surface">
      <Icono size={ICONO.md} className="flex-shrink-0 text-accent mt-0.5" aria-hidden="true" />
      <span>{children}</span>
    </li>
  )
}

function PresentacionRuleta({ actividad, onComenzar }) {
  const n = actividad.ruleta?.preguntasPorPartida
  const [alAbrir] = useState(() => Date.now()) // el servidor es quien decide; esto solo evita ofrecer un botón que fallaría
  const vencida = fechaLimiteVencida(actividad, alAbrir)
  return (
    <div data-esq="ruleta-alumno" className="px-4 py-8 max-w-md mx-auto space-y-6">
      <div className="space-y-2 text-center">
        <div className="mx-auto size-16 rounded-full bg-accent-light text-accent flex items-center justify-center">
          <LoaderPinwheel size={ICONO.lg} aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold text-on-surface break-words">{actividad.nombre || 'La Ruleta del Destino'}</h1>
        <p className="text-sm text-muted">La Ruleta del Destino · Parcial {actividad.parcial}</p>
      </div>

      {textoDeInstrucciones(actividad.instrucciones) && (
        <div className="bg-surface-card rounded-card p-4 shadow-card">
          <h2 className="font-semibold text-on-surface mb-2">Instrucciones</h2>
          <div className={`text-sm text-on-surface leading-relaxed break-words [overflow-wrap:anywhere] ${richTextContentClass}`}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(toRichHtml(actividad.instrucciones)) }} />
        </div>
      )}

      <div className="bg-surface-card rounded-card p-4 shadow-card">
        <h2 className="font-semibold text-on-surface mb-3">Cómo funciona</h2>
        <ul className="space-y-3">
          <Dato icono={CircleHelp}>{n} preguntas de opción múltiple, elegidas al azar al girar la ruleta.</Dato>
          <Dato icono={Timer}>{RULETA_CFG.TIEMPO_RESPUESTA_MS / 1000} segundos por pregunta. Solo cuenta tu primera respuesta.</Dato>
          <Dato icono={Repeat}>Una sola partida. Si sales, continúas donde te quedaste.</Dato>
          <Dato icono={GraduationCap}>
            {sinCalificacion(actividad)
              ? 'No cuenta como calificación.'
              : `Se califica sobre ${actividad.maxCalif ?? RULETA_CFG.CALIFICACION_MAXIMA} y cuenta para el Parcial ${actividad.parcial}.`}
          </Dato>
          {actividad.fechaLimite && (
            <Dato icono={CalendarDays}>Fecha límite para comenzar: <span className="font-medium">{formatDeadline(actividad.fechaLimite)}</span>.</Dato>
          )}
        </ul>
      </div>

      {vencida ? (
        <output className="block text-base text-amber-700 text-center">
          La fecha límite de esta ruleta ya pasó. Habla con tu docente si necesitas más tiempo.
        </output>
      ) : (
        <Button fullWidth icon={LoaderPinwheel} onClick={onComenzar}>Comenzar</Button>
      )}
    </div>
  )
}

export default function RuletaAlumnoPage() {
  const { activityId } = useParams()
  const navigate = useNavigate()
  const [fase, setFase] = useState('cargando') // cargando | presentacion | partida
  const [actividad, setActividad] = useState(null)

  useEffect(() => {
    let vigente = true
    ;(async () => {
      try {
        const act = await fetchActivity(activityId)
        if (!vigente) return
        if (!act || act.categoria !== RULETA_CFG.CATEGORIA) { setFase('partida'); return }
        const estados = await estadosRuletaAlumno(act.asignaturaId)
        if (!vigente) return
        setActividad(act)
        setFase(estados[activityId] ? 'partida' : 'presentacion')
      } catch {
        if (vigente) setFase('partida')
      }
    })()
    return () => { vigente = false }
  }, [activityId])

  return (
    <div className="min-h-dvh bg-surface">
      <div className="px-3 pt-3">
        <Button variant="quiet" size="sm" icon={ArrowLeft} onClick={() => navigate(-1)}>Volver</Button>
      </div>
      {fase === 'cargando' && <EsqueletoRuletaAlumno />}
      {fase === 'presentacion' && <PresentacionRuleta actividad={actividad} onComenzar={() => setFase('partida')} />}
      {fase === 'partida' && <PartidaRuleta actividadId={activityId} />}
    </div>
  )
}
