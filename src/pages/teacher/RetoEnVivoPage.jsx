// Reto Exprés · competencia EN VIVO del docente (etapa 4). Control y proyección en la MISMA ventana (D2): lo que se ve es
// lo que ve el salón (QR, pregunta, contador, cuántos respondieron, clasificación final) y los controles van abajo.
//
// El docente lee su sesión por Firestore (las reglas se lo permiten) y calcula la fase con la MISMA regla que el servidor
// (faseReto de src/utils/retoExpres.js) y con el reloj corregido contra el servidor. Toda acción va al servidor
// (reto-control); nada se escribe desde aquí. Cerrar esta pantalla no detiene ni reinicia la competencia: el tiempo
// lo lleva el servidor. Al terminar, esta pantalla pide el registro definitivo (T7).
//
// Nunca se proyecta la respuesta correcta (D9: la clave sale hasta el final y solo para inscritos; E11: nunca a externos)
// ni el nombre real detrás de un alias (D5): eso solo aparece en «Participantes», que el docente abre a propósito.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, DoorClosed, DoorOpen, Expand, Pause, Play, Shrink, Square, Users } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import { Badge, Button } from '../../components/ui'
import ConfirmModal from '../../components/ConfirmModal'
import { QrImagen } from '../../components/participacion/QrAcceso'
import ParticipantesReto from '../../components/reto/ParticipantesReto'
import ResultadosRetoDocente from '../../components/reto/ResultadosRetoDocente'
import { COLORES_OPCION, letraOpcion, segundosRestantes, textoContador, textoOpcion } from '../../components/reto/opcionesReto'
import { EsqueletoRetoEnVivo } from '../../components/esqueletos'
import { useRelojServidor } from '../../hooks/useTemporizadorVivo'
import usePantallaCompleta from '../../hooks/usePantallaCompleta'
import { medirRelojServidor } from '../../utils/participacionVivoDb'
import { FASES_RETO, MODALIDADES_RETO, RETO_CFG, faseReto } from '../../utils/retoExpres'
import {
  controlarReto, escucharParticipantesReto, escucharRespuestasReto, escucharResultadosReto, escucharSesionReto, urlReto,
} from '../../utils/retoExpresDb'

const ETIQUETA_FASE = {
  espera: 'Sala de espera', preparando: 'Prepárense', abierta: 'Respondiendo', pausada: 'En pausa',
  terminada: 'Terminó', finalizada: 'Resultados',
}

function useLadoQr() {
  const calcular = () => Math.round(Math.max(180, Math.min(window.innerWidth * 0.36, window.innerHeight * 0.55)))
  const [lado, setLado] = useState(calcular)
  useEffect(() => {
    const alCambiar = () => setLado(calcular())
    window.addEventListener('resize', alCambiar)
    return () => window.removeEventListener('resize', alCambiar)
  }, [])
  return lado
}

function Insignia({ i }) {
  return (
    <span aria-hidden="true" className="size-12 flex-shrink-0 rounded-full text-white font-bold text-2xl flex items-center justify-center"
      style={{ backgroundColor: COLORES_OPCION[i % COLORES_OPCION.length] }}>{letraOpcion(i)}</span>
  )
}

export default function RetoEnVivoPage() {
  const { activityId, codigo } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()
  const contenedor = useRef(null)
  const pc = usePantallaCompleta(contenedor)
  const ladoQr = useLadoQr()
  const { ahora } = useRelojServidor({ muestrear: medirRelojServidor })

  const [sesion, setSesion] = useState(undefined) // undefined = cargando; null = no existe
  const [participantes, setParticipantes] = useState([])
  const [respuestas, setRespuestas] = useState([])
  const [resultados, setResultados] = useState(null)
  const [t, setT] = useState(() => Date.now())
  const [ocupado, setOcupado] = useState(null) // acción en curso
  const [confirmarTerminar, setConfirmarTerminar] = useState(false)
  const [verParticipantes, setVerParticipantes] = useState(false)

  const uid = currentUser?.uid
  useEffect(() => escucharSesionReto(codigo, setSesion, () => setSesion(null)), [codigo])
  useEffect(() => {
    if (!uid) return undefined
    const a = escucharParticipantesReto(codigo, uid, setParticipantes, () => {})
    const b = escucharRespuestasReto(codigo, uid, setRespuestas, () => {})
    return () => { a(); b() }
  }, [codigo, uid])
  const finalizada = sesion?.estado === 'finalizada'
  useEffect(() => (finalizada ? escucharResultadosReto(codigo, setResultados, () => {}) : undefined), [codigo, finalizada])
  useEffect(() => {
    const id = setInterval(() => setT(ahora()), 200)
    return () => clearInterval(id)
  }, [ahora])

  const f = sesion ? faseReto(sesion, t) : null

  // T7: al terminar, esta pantalla pide el registro definitivo (si falla, lo reintenta; también lo hará cualquier celular).
  const faseActual = f?.fase
  useEffect(() => {
    if (faseActual !== FASES_RETO.terminada || finalizada) return undefined
    const pedir = () => controlarReto(codigo, 'finalizar').catch(() => {})
    const primero = setTimeout(pedir, 600)
    const reintento = setInterval(pedir, 5000)
    return () => { clearTimeout(primero); clearInterval(reintento) }
  }, [faseActual, finalizada, codigo])

  if (sesion === undefined) return <EsqueletoRetoEnVivo />
  if (!sesion || sesion.docenteId !== uid) {
    return (
      <div className="min-h-dvh bg-surface flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-xl text-on-surface">Esta competencia ya no existe.</p>
        <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate(`/reto/${activityId}`)}>Volver al reto</Button>
      </div>
    )
  }

  async function accion(nombre, extra = {}) {
    setOcupado(nombre)
    try {
      await controlarReto(codigo, nombre, extra)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setOcupado(null)
    }
  }

  const fase = f.fase
  const externo = sesion.modalidad === 'externo'
  const activos = participantes.filter((p) => !p.expulsado)
  const visible = (p) => (sesion.modoIdentidad === 'alias' ? p.alias : p.nombre) || 'Participante'
  const n = Number.isInteger(f.indice) ? f.indice + 1 : null
  const q = Number.isInteger(f.indice) ? sesion.preguntas[f.indice] : null
  const respondieron = Number.isInteger(f.indice) ? new Set(respuestas.filter((r) => r.indice === f.indice).map((r) => r.participanteId)).size : 0
  const url = urlReto(codigo)

  let principal
  if (fase === FASES_RETO.espera) {
    principal = (
      <div className="flex flex-wrap items-center justify-center gap-8 w-full">
        <div className="flex flex-col items-center gap-3">
          <QrImagen url={url} lado={ladoQr} className="rounded-card" />
          <p className="text-2xl text-on-surface">Código <strong className="font-mono tracking-widest">{codigo}</strong></p>
          <p className="text-base text-muted break-all text-center">{url}</p>
        </div>
        <div className="flex-1 min-w-0 max-w-xl space-y-3">
          <p className="text-3xl font-semibold text-on-surface">
            {activos.length} {activos.length === 1 ? 'participante' : 'participantes'}{externo ? ` de ${RETO_CFG.MAX_EXTERNOS} lugares` : ''}
          </p>
          {!sesion.accesoAbierto && (
            <p className="text-xl text-amber-800 bg-amber-50 rounded-card px-4 py-3">El acceso está cerrado: ábrelo para que puedan entrar.</p>
          )}
          <ul className="flex flex-wrap gap-2" aria-label="Participantes dentro">
            {activos.map((p) => <li key={p.id} className="px-4 py-2 rounded-full bg-surface-card shadow-card text-xl text-on-surface">{visible(p)}</li>)}
          </ul>
        </div>
      </div>
    )
  } else if (fase === FASES_RETO.preparando || (fase === FASES_RETO.pausada && f.faseAlPausar === FASES_RETO.preparando)) {
    principal = (
      <div className="text-center space-y-4">
        <p className="text-5xl font-bold text-on-surface">Pregunta {n} de {RETO_CFG.TOTAL_PREGUNTAS}</p>
        <p className="text-3xl text-muted">{fase === FASES_RETO.pausada ? 'En pausa' : 'Prepárense…'}</p>
        {fase !== FASES_RETO.pausada && <p className="text-6xl font-bold tabular-nums text-accent" aria-live="off">{segundosRestantes(f.faltaParaAbrirMs)}</p>}
      </div>
    )
  } else if (fase === FASES_RETO.abierta || fase === FASES_RETO.pausada) {
    const s = segundosRestantes(f.restanteMs)
    principal = (
      <div className="w-full max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-2xl font-semibold text-accent">Pregunta {n} de {RETO_CFG.TOTAL_PREGUNTAS}</p>
          {fase === FASES_RETO.pausada
            ? <Badge tone="warning" className="text-xl px-4 py-1">En pausa</Badge>
            : <p className={`text-6xl font-bold tabular-nums ${s <= 5 ? 'text-red-800' : 'text-on-surface'}`} aria-live="off">{textoContador(s)}</p>}
        </div>
        <h1 className="text-4xl font-semibold text-on-surface break-words leading-tight">{q?.enunciado}</h1>
        <ul className="grid gap-4 sm:grid-cols-2">
          {(q?.opciones || []).map((o, i) => (
            <li key={o.id} className="flex items-center gap-4 bg-surface-card rounded-card shadow-card px-5 py-4">
              <Insignia i={i} />
              <span className="flex-1 min-w-0 text-3xl text-on-surface break-words">{textoOpcion(o)}</span>
            </li>
          ))}
        </ul>
        <p className="text-2xl text-muted">{respondieron} de {activos.length} respondieron</p>
      </div>
    )
  } else if (fase === FASES_RETO.terminada || (finalizada && !resultados)) {
    principal = <p className="text-4xl text-on-surface">Calculando resultados…</p>
  } else {
    principal = (
      <div className="w-full space-y-6">
        <p className="text-4xl font-bold text-on-surface text-center">¡Terminó el reto!</p>
        <ResultadosRetoDocente resultados={resultados} sesion={{ ...sesion, codigo }} participantes={participantes} proyectable />
      </div>
    )
  }

  const enCurso = fase === FASES_RETO.preparando || fase === FASES_RETO.abierta
  return (
    <div ref={contenedor} data-esq="reto-vivo" className="min-h-dvh bg-surface flex flex-col">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Button variant="quiet" size="sm" icon={ArrowLeft} onClick={() => navigate(`/reto/${activityId}`)}>Salir</Button>
        <p className="flex-1 min-w-0 truncate text-lg font-semibold text-on-surface">{sesion.titulo || 'Reto Exprés'}</p>
        <Badge tone="accent">{ETIQUETA_FASE[fase]}</Badge>
        <Badge>{externo ? MODALIDADES_RETO.externo : MODALIDADES_RETO.inscritos}</Badge>
        <Button variant="secondary" size="sm" icon={Users} onClick={() => setVerParticipantes(true)}>Participantes</Button>
        <Button variant="secondary" size="sm" icon={pc.activa ? Shrink : Expand} onClick={pc.alternar}>{pc.activa ? 'Salir de pantalla completa' : 'Pantalla completa'}</Button>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-6">{principal}</main>

      {!finalizada && fase !== FASES_RETO.terminada && (
        <footer className="flex flex-wrap items-center justify-center gap-3 px-4 py-3 border-t border-outline-variant bg-surface-card">
          {sesion.accesoAbierto
            ? <Button variant="secondary" icon={DoorClosed} busy={ocupado === 'cerrar-acceso'} onClick={() => accion('cerrar-acceso')}>Cerrar acceso</Button>
            : <Button variant="secondary" icon={DoorOpen} busy={ocupado === 'abrir-acceso'} onClick={() => accion('abrir-acceso')}>Abrir acceso</Button>}
          {fase === FASES_RETO.espera && (
            <Button icon={Play} busy={ocupado === 'iniciar'} onClick={() => accion('iniciar')}>Iniciar</Button>
          )}
          {enCurso && <Button variant="secondary" icon={Pause} busy={ocupado === 'pausar'} onClick={() => accion('pausar')}>Pausar</Button>}
          {fase === FASES_RETO.pausada && <Button icon={Play} busy={ocupado === 'reanudar'} onClick={() => accion('reanudar')}>Reanudar</Button>}
          <Button variant="danger-outline" icon={Square} onClick={() => setConfirmarTerminar(true)}>Terminar</Button>
        </footer>
      )}
      {finalizada && (
        <footer className="flex justify-center px-4 py-3 border-t border-outline-variant bg-surface-card">
          <Button variant="secondary" onClick={() => navigate(`/reto/${activityId}`)}>Ver resultados completos</Button>
        </footer>
      )}

      <ParticipantesReto open={verParticipantes} onClose={() => setVerParticipantes(false)} sesion={{ ...sesion, codigo }} participantes={participantes} />
      {confirmarTerminar && (
        <ConfirmModal danger busy={ocupado === 'terminar'} title="Terminar el reto" confirmLabel="Terminar"
          message={fase === FASES_RETO.espera
            ? 'La competencia termina sin empezar: no habrá clasificación. Esto no se puede deshacer.'
            : 'Desde ahora no se acepta ninguna respuesta. La pregunta en curso no cuenta; las anteriores sí. Esto no se puede deshacer.'}
          onCancel={() => setConfirmarTerminar(false)}
          onConfirm={async () => { await accion('terminar', { confirmado: true }); setConfirmarTerminar(false) }} />
      )}
    </div>
  )
}
