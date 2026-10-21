// Participación en vivo · vista de PRESENTACIÓN del docente (pantalla grande / proyector).
//
// La pregunta es lo principal. Los resultados se dibujan en tiempo real a partir de las respuestas que
// llegan por Firestore (onSnapshot): barras de color para opción única, nube de palabras para respuestas
// breves, tarjetas para respuestas extensas. Los controles son discretos y están abajo.
//
// Etapas de una sesión: sala de espera (código/QR) → preguntas → finalizada (resultados + calificación).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Lock, LockOpen, Maximize2, Play, QrCode, Sparkles, Square, X } from 'lucide-react'
import { useToast } from '../Toast'
import { Button, Modal } from '../ui'
import Spinner from '../Spinner'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import useCreditosIA from '../../hooks/useCreditosIA'
import {
  alternarRespuestasVivo, escucharRespuestasVivo, escucharSesionVivo, finalizarSesionVivo, irAPreguntaVivo, urlParticipacion,
} from '../../utils/participacionVivoDb'
import { VIVO_CFG, esTipoAbierto } from '../../utils/participacionVivo'
import NubePalabras from './NubePalabras'
import ResultadoOpciones from './ResultadoOpciones'
import TarjetasRespuestas from './TarjetasRespuestas'
import PanelAnalisisIA from './PanelAnalisisIA'
import PanelCalificacionVivo from './PanelCalificacionVivo'

// Pantalla de proyección: el diálogo de la app (ui/Modal) estirado a toda la ventana. Hereda el foco atrapado,
// Escape y el botón Atrás de Android (todos solo SALEN de la presentación: la sesión sigue activa).
function Pantalla({ children, onCerrar }) {
  return (
    <Modal open onClose={onCerrar} ariaLabel="Participación en vivo" size="full" padding="p-0" closeOnBackdrop={false}
      className="!w-full !max-w-none h-dvh !max-h-dvh !rounded-none !bg-slate-950 text-white flex flex-col !overflow-hidden">
      {children}
    </Modal>
  )
}

function useQR(url) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let cancelado = false
    import('qrcode').then((m) => m.default.toDataURL(url, { width: 520, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } }))
      .then((d) => { if (!cancelado) setSrc(d) }).catch(() => {})
    return () => { cancelado = true }
  }, [url])
  return src
}

function SalaDeEspera({ sesion }) {
  const externo = sesion.acceso === 'externo'
  const url = urlParticipacion(sesion.codigo)
  const qr = useQR(url)
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-6">
      <h1 className="text-4xl md:text-5xl font-bold">{sesion.titulo || 'Participación en vivo'}</h1>
      {externo ? (
        <div className="flex flex-col md:flex-row items-center gap-8">
          {qr ? <img src={qr} alt={`Código QR para participar: ${url}`} className="size-56 md:size-72 rounded-card bg-white p-2" /> : <Spinner />}
          <div className="text-left">
            <p className="text-xl text-white/80">Escanea el código o entra a</p>
            <p className="text-2xl md:text-3xl font-semibold break-all">{url.replace(/^https?:\/\//, '')}</p>
            <p className="text-lg text-white/80 mt-4">Código</p>
            <p className="text-5xl font-bold tracking-widest tabular-nums">{sesion.codigo}</p>
          </div>
        </div>
      ) : (
        <p className="text-2xl text-white/80 max-w-2xl">
          Tus estudiantes participan desde su asignatura en Evalúa Fácil: abren esta actividad en su lista y responden desde su celular.
        </p>
      )}
      <p className="text-lg text-white/80">Cuando estén listos, pulsa «Comenzar».</p>
    </div>
  )
}

function Escenario({ sesion, pregunta, respuestas, claves, verCorrecta, vistaAbierta, setVistaAbierta }) {
  const propias = useMemo(() => respuestas.filter((r) => r.preguntaId === pregunta.id), [respuestas, pregunta.id])
  const abierta = esTipoAbierto(pregunta.tipo)
  const breve = pregunta.tipo === 'abierta_breve'
  const mostrarNube = breve && vistaAbierta === 'nube'
  return (
    <div className="flex-1 min-h-0 flex flex-col px-6 md:px-12 pb-4 overflow-y-auto">
      <p className="text-lg text-white/80 mt-2">Pregunta {sesion.preguntaIndex + 1} de {sesion.total ?? sesion.preguntas.length}</p>
      <h1 className="text-4xl md:text-6xl font-bold leading-tight my-4">{pregunta.enunciado}</h1>
      <div className="flex-1">
        {pregunta.tipo === 'opcion_unica' && (
          <ResultadoOpciones pregunta={pregunta} respuestas={propias} correcta={verCorrecta ? claves?.[pregunta.id]?.correcta : null} />
        )}
        {breve && (
          <div className="flex flex-col h-full">
            <div className="flex justify-end mb-2">
              <Button variant="quiet" size="sm" className="!text-white/80 hover:!text-white" onClick={() => setVistaAbierta(mostrarNube ? 'tarjetas' : 'nube')}>
                {mostrarNube ? 'Ver respuestas una por una' : 'Ver nube de palabras'}
              </Button>
            </div>
            {mostrarNube ? <div className="flex-1 min-h-80"><NubePalabras textos={propias.map((r) => r.texto)} /></div> : <TarjetasRespuestas respuestas={propias} grande />}
          </div>
        )}
        {abierta && !breve && <TarjetasRespuestas respuestas={propias} grande />}
      </div>
      {abierta && sesion.analisisActivo && (
        <div className="mt-4"><PanelAnalisisIA pregunta={pregunta} respuestas={propias} analisisActivo /></div>
      )}
    </div>
  )
}

function ResumenFinal({ sesion, respuestas, claves }) {
  return (
    <div className="flex-1 overflow-y-auto px-6 md:px-12 pb-6 space-y-8">
      <h1 className="text-4xl font-bold mt-2">Resultados: {sesion.titulo || 'Participación en vivo'}</h1>
      {sesion.preguntas.map((p, i) => {
        const propias = respuestas.filter((r) => r.preguntaId === p.id)
        return (
          <section key={p.id} aria-label={`Pregunta ${i + 1}`}>
            <p className="text-sm text-white/80">Pregunta {i + 1} · {propias.length} {propias.length === 1 ? 'respuesta' : 'respuestas'}</p>
            <h2 className="text-2xl font-semibold mb-3">{p.enunciado}</h2>
            {p.tipo === 'opcion_unica' && <ResultadoOpciones pregunta={p} respuestas={propias} correcta={sesion.calificable ? claves?.[p.id]?.correcta : null} />}
            {p.tipo === 'abierta_breve' && <div className="h-72"><NubePalabras textos={propias.map((r) => r.texto)} alturaMin={240} /></div>}
            {esTipoAbierto(p.tipo) && <div className="mt-3"><TarjetasRespuestas respuestas={propias} /></div>}
            {esTipoAbierto(p.tipo) && sesion.analisisActivo && <div className="mt-3"><PanelAnalisisIA pregunta={p} respuestas={propias} analisisActivo /></div>}
          </section>
        )
      })}
    </div>
  )
}

export default function PresentacionVivo({ codigo, actividad, claves, docenteId, asignaturaNombre = '', onCerrar }) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const [sesion, setSesion] = useState(undefined) // undefined = cargando, null = no existe
  const [respuestas, setRespuestas] = useState([])
  const [verCorrecta, setVerCorrecta] = useState(false)
  const [vistaAbierta, setVistaAbierta] = useState('nube')
  const [confirmandoAnalisis, setConfirmandoAnalisis] = useState(false)
  const [activandoAnalisis, setActivandoAnalisis] = useState(false)
  const [confirmandoFin, setConfirmandoFin] = useState(false)
  const [conQR, setConQR] = useState(false)

  useEffect(() => escucharSesionVivo(codigo, setSesion, () => setSesion(null)), [codigo])
  useEffect(() => escucharRespuestasVivo(codigo, docenteId, setRespuestas, () => toast('Se perdió la conexión con las respuestas; reintentando', 'error')), [codigo, docenteId, toast])

  const costoAnalisis = creditosIA.estimar(VIVO_CFG.OP_ANALISIS)
  const tieneAbiertas = (sesion?.preguntas || []).some((p) => esTipoAbierto(p.tipo))

  const ir = useCallback((i) => irAPreguntaVivo(codigo, i).catch(() => toast('No se pudo cambiar de pregunta', 'error')), [codigo, toast])

  async function activarAnalisis() {
    setActivandoAnalisis(true)
    try {
      await creditosIA.ejecutar(VIVO_CFG.OP_ANALISIS, { sesionId: codigo, asignaturaId: sesion.asignaturaId })
      toast('Análisis en vivo activado: las respuestas abiertas se evaluarán conforme lleguen')
      setConfirmandoAnalisis(false)
    } catch (e) {
      toast(e.message || 'No se pudo activar el análisis', 'error')
      setConfirmandoAnalisis(false)
    } finally {
      setActivandoAnalisis(false)
    }
  }

  if (sesion === undefined) {
    return <Pantalla onCerrar={onCerrar}><div className="flex-1 flex items-center justify-center"><Spinner /></div></Pantalla>
  }
  if (sesion === null) {
    return (
      <Pantalla onCerrar={onCerrar}>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-xl">No se encontró esta sesión.</p>
          <Button variant="secondary" onClick={onCerrar}>Volver</Button>
        </div>
      </Pantalla>
    )
  }

  const finalizada = sesion.estado === 'finalizada'
  const enEspera = !finalizada && sesion.preguntaIndex < 0
  const pregunta = !finalizada && !enEspera ? sesion.preguntas[sesion.preguntaIndex] : null
  const ultima = sesion.preguntaIndex >= sesion.preguntas.length - 1
  const propiasActual = pregunta ? respuestas.filter((r) => r.preguntaId === pregunta.id).length : 0

  const barra = 'text-white hover:!bg-white/15 hover:!text-white'
  return (
    <>
      <Pantalla onCerrar={onCerrar}>
        {/* Barra superior discreta */}
        <div className="flex items-center gap-3 px-4 py-2 text-sm text-white/80">
          <Button variant="quiet" size="sm" icon={X} className={barra} onClick={onCerrar} aria-label="Salir de la presentación (la sesión sigue activa)">Salir</Button>
          <span className="truncate">{asignaturaNombre}</span>
          <span className="ml-auto flex items-center gap-3">
            {sesion.analisisActivo && <span className="flex items-center gap-1"><Sparkles size={14} aria-hidden="true" /> Análisis en vivo activo</span>}
            {pregunta && <span aria-live="polite" className="tabular-nums">{propiasActual} {propiasActual === 1 ? 'respuesta' : 'respuestas'}</span>}
            {finalizada && <span className="font-semibold text-white">Sesión finalizada</span>}
          </span>
        </div>

        {enEspera && <SalaDeEspera sesion={sesion} />}
        {pregunta && (
          <Escenario sesion={sesion} pregunta={pregunta} respuestas={respuestas} claves={claves} verCorrecta={verCorrecta}
            vistaAbierta={vistaAbierta} setVistaAbierta={setVistaAbierta} />
        )}
        {finalizada && (
          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
            <ResumenFinal sesion={sesion} respuestas={respuestas} claves={claves} />
            {sesion.calificable && (
              <div className="px-6 md:px-12 pb-8">
                <PanelCalificacionVivo sesion={sesion} actividad={actividad} claves={claves} respuestas={respuestas} asignaturaId={sesion.asignaturaId} />
              </div>
            )}
          </div>
        )}

        {/* Controles */}
        {!finalizada && (
          <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-3 border-t border-white/10 bg-black/30">
            {enEspera ? (
              <Button icon={Play} onClick={() => ir(0)}>Comenzar</Button>
            ) : (
              <>
                <Button variant="quiet" icon={ArrowLeft} className={barra} disabled={sesion.preguntaIndex <= 0} onClick={() => ir(sesion.preguntaIndex - 1)}>Anterior</Button>
                <Button variant="quiet" icon={sesion.aceptando ? Lock : LockOpen} className={barra}
                  onClick={() => alternarRespuestasVivo(codigo, !sesion.aceptando).catch(() => toast('No se pudo cambiar', 'error'))}>
                  {sesion.aceptando ? 'Cerrar respuestas' : 'Abrir respuestas'}
                </Button>
                {pregunta?.tipo === 'opcion_unica' && claves?.[pregunta.id]?.correcta && (
                  <Button variant="quiet" icon={Check} className={barra} onClick={() => setVerCorrecta((v) => !v)}>
                    {verCorrecta ? 'Ocultar la correcta' : 'Mostrar la correcta'}
                  </Button>
                )}
                {!ultima && <Button iconRight={ArrowRight} onClick={() => ir(sesion.preguntaIndex + 1)}>Siguiente</Button>}
              </>
            )}
            {tieneAbiertas && !sesion.analisisActivo && (
              <Button variant="quiet" icon={Sparkles} className={barra} disabled={costoAnalisis == null}
                onClick={() => setConfirmandoAnalisis(true)}
                title={costoAnalisis == null ? 'El análisis en vivo aún no está disponible' : undefined}>
                Analizar con IA
              </Button>
            )}
            {sesion.acceso === 'externo' && (
              <Button variant="quiet" icon={QrCode} className={barra} onClick={() => setConQR((v) => !v)}>{conQR ? 'Ocultar QR' : 'Mostrar QR'}</Button>
            )}
            <Button variant="quiet" icon={Maximize2} className={barra} onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()}>Pantalla completa</Button>
            <Button variant="danger-outline" icon={Square} onClick={() => setConfirmandoFin(true)}>{ultima || enEspera ? 'Finalizar' : 'Finalizar sesión'}</Button>
          </div>
        )}
        {finalizada && (
          <div className="flex justify-center px-4 py-3 border-t border-white/10 bg-black/30">
            <Button variant="secondary" onClick={onCerrar}>Cerrar resultados</Button>
          </div>
        )}

        {conQR && !finalizada && sesion.acceso === 'externo' && <QRFlotante sesion={sesion} onCerrar={() => setConQR(false)} />}
      </Pantalla>

      {confirmandoAnalisis && costoAnalisis != null && (
        <ConfirmacionCreditosModal
          titulo="Analizar respuestas con IA en vivo"
          descripcion={`La IA evaluará cada respuesta abierta conforme llega y resumirá las tendencias. Cubre hasta ${VIVO_CFG.TOPE_ANALISIS} respuestas abiertas de esta sesión; las siguientes se conservan sin analizar y no tienen cargo.`}
          costoMin={costoAnalisis}
          ejecutando={activandoAnalisis}
          onCancelar={() => setConfirmandoAnalisis(false)}
          onContinuar={activarAnalisis}
        />
      )}
      {confirmandoFin && (
        <ConfirmFin onCancelar={() => setConfirmandoFin(false)} onConfirmar={async () => {
          setConfirmandoFin(false)
          try { await finalizarSesionVivo(codigo) } catch { toast('No se pudo finalizar la sesión', 'error') }
        }} />
      )}
    </>
  )
}

function QRFlotante({ sesion, onCerrar }) {
  const url = urlParticipacion(sesion.codigo)
  const qr = useQR(url)
  return (
    <div className="absolute bottom-20 right-4 rounded-card bg-white text-slate-900 p-3 shadow-2xl text-center">
      {qr ? <img src={qr} alt={`QR: ${url}`} className="size-44" /> : <Spinner />}
      <p className="text-lg font-bold tracking-widest tabular-nums">{sesion.codigo}</p>
      <button type="button" onClick={onCerrar} className="text-xs text-slate-600 underline mt-1">Ocultar</button>
    </div>
  )
}

// Confirmación propia: este componente vive sobre la pantalla oscura.
function ConfirmFin({ onCancelar, onConfirmar }) {
  return (
    <Modal open onClose={onCancelar} title="¿Finalizar la sesión?" size="sm" z={60}
      footer={<div className="flex justify-end gap-2"><Button variant="quiet" onClick={onCancelar}>Seguir</Button><Button variant="danger" onClick={onConfirmar}>Finalizar</Button></div>}>
      <p className="text-sm text-muted">Los participantes ya no podrán responder. Podrás consultar los resultados completos.</p>
    </Modal>
  )
}
