// Participación en vivo · PRESENTACIÓN del docente (pantalla grande / proyector).
//
// Dos vistas en la misma ventana (interruptor «Vista del grupo / Vista del docente»):
//   · GRUPO: lo único que ve el salón; tema claro, letra grande, sin controles ni análisis. Los controles aparecen al
//     mover el ratón o tocar y se ocultan solos a los 3 s.
//   · DOCENTE: lo mismo + estado de las respuestas, clave y diagnóstico pedagógico.
// «Proyectar en otra ventana» abre una ventana de solo lectura con la vista del grupo (se sincroniza por
// BroadcastChannel; no escribe nada). Etapas: sala de espera (QR protagonista) → preguntas → resultados finales,
// pregunta por pregunta y sin desplazamiento.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Eye, Lock, Maximize2, MonitorUp, Play, QrCode, Square, Users, X } from 'lucide-react'
import { useToast } from '../Toast'
import { Button, Modal } from '../ui'
import Spinner from '../Spinner'
import { useAreaMedida, useAutoOcultar, useEstadoProyeccion } from '../../hooks/useProyeccion'
import {
  ampliarTiempoVivo, cerrarPreguntaVivo, escucharInformesVivo, escucharRespuestasVivo, escucharSesionVivo, finalizarSesionVivo, irAPreguntaVivo, medirRelojServidor,
  sellarPreguntaVivo,
} from '../../utils/participacionVivoDb'
import { useCuentaRegresiva, useRelojServidor } from '../../hooks/useTemporizadorVivo'
import { IS_NATIVE_APP } from '../../utils/platform'
import { planOpciones, rutaProyeccion, tamanosProyeccion } from '../../utils/proyeccionVivo'
import VistaGrupo from './VistaGrupo'
import VistaDocente from './VistaDocente'
import RecorridoResultados from './RecorridoResultados'


// Pantalla de proyección: el diálogo de la app (ui/Modal) estirado a toda la ventana. Hereda el foco atrapado,
// Escape y el botón Atrás de Android (todos solo SALEN de la presentación: la sesión sigue activa).
function Pantalla({ children, onCerrar, autonoma }) {
  if (autonoma) return <div className="h-dvh w-full bg-white text-slate-900 flex flex-col">{children}</div>
  return (
    <Modal open onClose={onCerrar} ariaLabel="Participación en vivo" size="full" padding="p-0" closeOnBackdrop={false} z={60}
      className="!w-full !max-w-none !h-full !max-h-full !rounded-none !bg-white text-slate-900 flex flex-col !overflow-hidden">
      {children}
    </Modal>
  )
}

// `indiceResultados`/`onIndiceResultados`: la pregunta que el docente consulta en los resultados finales, compartida por la vista
// del grupo y la suya (así no vuelve a la primera al alternar). La ventana de proyección no los pasa: lleva su propio recorrido.
function Escenario({ sesion, respuestas, informes, claves, vista, estado, ahora, reservaInferior = 0, onOcultarQr, actividad = null, indiceResultados = null, onIndiceResultados = null }) {
  const [ref, area] = useAreaMedida()
  const finalizada = sesion.estado === 'finalizada'
  // La barra de controles flota sobre el escenario: se RESERVA su altura al pie para que ni las flechas ni nada quede
  // debajo de ella. El tamaño de letra sale del escenario completo, así que reservar espacio no encoge la pregunta.
  const areaUtil = { ancho: area.ancho, alto: Math.max(0, area.alto - reservaInferior) }
  const tamBase = tamanosProyeccion(area.ancho, area.alto)
  return (
    <div ref={ref} className="flex-1 min-h-0 relative overflow-hidden bg-white" style={{ paddingBottom: reservaInferior }}>
      {area.ancho > 0 && vista === 'docente' && (
        <VistaDocente sesion={sesion} respuestas={respuestas} informes={informes} claves={claves} indice={sesion.preguntaIndex} ahora={ahora}
          verCorrecta={estado.verCorrecta} actividad={actividad} indiceResultados={indiceResultados ?? 0} onIndiceResultados={onIndiceResultados} />
      )}
      {area.ancho > 0 && vista === 'grupo' && (finalizada
        ? <RecorridoResultados sesion={sesion} respuestas={respuestas} claves={claves} area={areaUtil} tamBase={tamBase} indice={indiceResultados} onIndice={onIndiceResultados} />
        : <VistaGrupo sesion={sesion} respuestas={respuestas} claves={claves} area={areaUtil} tamBase={tamBase} ahora={ahora} verCorrecta={estado.verCorrecta} mostrarQr={estado.mostrarQr} onOcultarQr={onOcultarQr}
          momento={estado.momento} />)}
    </div>
  )
}

export default function PresentacionVivo({ codigo, actividad, claves, docenteId, asignaturaNombre = '', onCerrar }) {
  const toast = useToast()
  const [sesion, setSesion] = useState(undefined) // undefined = cargando, null = no existe
  const [respuestas, setRespuestas] = useState([])
  const [informes, setInformes] = useState([])
  const [vista, setVista] = useState('grupo')
  const [indiceResultados, setIndiceResultados] = useState(0) // pregunta consultada en los resultados finales
  const [estado, cambiar] = useEstadoProyeccion(codigo, { emisor: true })
  const [visibles] = useAutoOcultar(3000)
  const [confirmandoFin, setConfirmandoFin] = useState(false)
  const [accionando, setAccionando] = useState(false)
  const [reintentoSello, setReintentoSello] = useState(0)
  const sellado = useRef(null)
  // Reloj del servidor: el contador del proyector sale de la MISMA hora que valida las respuestas.
  const { ahora } = useRelojServidor({ muestrear: medirRelojServidor })
  // Altura real de la barra de controles (cambia si se parte en dos filas en una ventana estrecha).
  const [alturaBarra, setAlturaBarra] = useState(72)
  const observador = useRef(null)
  const barraRef = useCallback((nodo) => {
    observador.current?.disconnect()
    if (!nodo) return
    const medir = () => setAlturaBarra(Math.ceil(nodo.getBoundingClientRect().height))
    medir()
    observador.current = new ResizeObserver(medir)
    observador.current.observe(nodo)
  }, [])

  useEffect(() => escucharSesionVivo(codigo, setSesion, () => setSesion(null)), [codigo])
  useEffect(() => escucharRespuestasVivo(codigo, docenteId, setRespuestas, () => toast('Se perdió la conexión con las respuestas; reintentando', 'error')), [codigo, docenteId, toast])
  useEffect(() => escucharInformesVivo(codigo, docenteId, setInformes, () => {}), [codigo, docenteId])
  // Cada pregunta empieza mostrando sus opciones (si son largas) y sin revelar la correcta.
  const indice = sesion?.preguntaIndex
  useEffect(() => { cambiar({ momento: 'opciones', verCorrecta: false }) }, [indice, cambiar])
  // Al FINALIZAR (de activa a finalizada) la ventana pasa a la vista del grupo: ahí están los resultados pregunta por pregunta. El
  // informe final y la calificación siguen en «Vista del docente». Una sesión que ya se abre finalizada arranca en 'grupo' (estado inicial).
  const estadoSesion = sesion?.estado
  const estadoPrevio = useRef(estadoSesion)
  useEffect(() => {
    if (estadoPrevio.current === 'activa' && estadoSesion === 'finalizada') setVista('grupo')
    estadoPrevio.current = estadoSesion
  }, [estadoSesion])

  const cuenta = useCuentaRegresiva(sesion || null, ahora)
  const idVigente = sesion?.preguntas?.[sesion?.preguntaIndex]?.id
  // Al vencer el tiempo, esta ventana pide al servidor que «selle» la pregunta (registra quiénes no respondieron). Si el docente
  // estaba desconectado, se sella al volver o con la siguiente acción: el estado de la pregunta no depende de este paso.
  useEffect(() => {
    if (cuenta.estado !== 'cerrada' || !idVigente || sesion?.estado !== 'activa') return
    if (sesion.ventanas?.[idVigente]?.sellada || sellado.current === idVigente) return
    sellado.current = idVigente
    sellarPreguntaVivo(codigo).catch(() => {
      sellado.current = null
      setTimeout(() => setReintentoSello((n) => n + 1), 1500)
    })
  }, [cuenta.estado, idVigente, sesion, codigo, reintentoSello])

  const ir = useCallback((i) => irAPreguntaVivo(codigo, i).catch((e) => toast(e.message || 'No se pudo cambiar de pregunta', 'error')), [codigo, toast])
  async function accion(fn, falla) {
    setAccionando(true)
    try { await fn() } catch (e) { toast(e.message || falla, 'error') } finally { setAccionando(false) }
  }

  // El «Análisis de resultados con IA» ya no se activa aquí: es opcional, se cobra aparte y se pide desde «Informe final»
  // (Vista del docente) cuando la sesión terminó. La proyección solo conduce la sesión.

  function proyectarEnOtraVentana() {
    const w = window.open(rutaProyeccion(codigo), 'ef-proyeccion-vivo', 'popup=yes,width=1280,height=720')
    if (!w) toast('Tu navegador bloqueó la ventana. Permite las ventanas emergentes para este sitio.', 'error')
  }

  if (sesion === undefined) return <Pantalla onCerrar={onCerrar}><div className="flex-1 flex items-center justify-center"><Spinner /></div></Pantalla>
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
  const t = tamanosProyeccion(window.innerWidth, window.innerHeight)
  // En la vista del docente los controles no se ocultan: es su pantalla de trabajo.
  const controlesVisibles = visibles || vista === 'docente' || confirmandoFin
  const barra = 'hover:!bg-slate-100'
  // Opciones largas: se presentan en dos momentos (opciones completas → resultados); el docente alterna entre ellos.
  const enMomentos = pregunta?.tipo === 'opcion_unica' && planOpciones(pregunta.enunciado, pregunta.opciones, window.innerWidth, window.innerHeight) === 'momentos'
  return (
    <>
      <Pantalla onCerrar={onCerrar}>
        <Escenario sesion={sesion} respuestas={respuestas} informes={informes} claves={claves} vista={vista} estado={estado} ahora={ahora} reservaInferior={alturaBarra}
          onOcultarQr={() => cambiar({ mostrarQr: false })} actividad={actividad} indiceResultados={indiceResultados} onIndiceResultados={setIndiceResultados} />

        {/* Controles: se ocultan solos a los 3 s en la vista del grupo; el contenido nunca se encoge por ellos. */}
        <div ref={barraRef} role="toolbar" aria-label="Controles de la presentación"
          className={`absolute inset-x-0 bottom-0 z-barra flex flex-wrap items-center justify-center gap-2 px-4 py-3 border-t border-slate-300 bg-white/95 transition-opacity duration-estandar ${controlesVisibles ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          style={{ fontSize: Math.min(t.resto, 18) }}>
          <Button variant="quiet" size="sm" icon={X} className={barra} onClick={onCerrar} aria-label="Salir de la presentación (la sesión sigue activa)">Salir</Button>
          <span className="truncate text-slate-700 max-w-48">{asignaturaNombre}</span>
          <Button variant="quiet" size="sm" icon={vista === 'grupo' ? Eye : Users} className={barra} onClick={() => setVista(vista === 'grupo' ? 'docente' : 'grupo')}>
            {vista === 'grupo' ? 'Vista del docente' : 'Vista del grupo'}
          </Button>
          {!finalizada && (enEspera ? (
            <Button icon={Play} onClick={() => ir(0)}>Comenzar</Button>
          ) : (
            <>
              <Button variant="quiet" size="sm" icon={ArrowLeft} className={barra} disabled={sesion.preguntaIndex <= 0} onClick={() => ir(sesion.preguntaIndex - 1)}>Anterior</Button>
              {(cuenta.estado === 'abierta' || cuenta.estado === 'preparando') && (
                <>
                  <Button variant="quiet" size="sm" icon={Lock} className={barra} disabled={accionando}
                    onClick={() => accion(() => cerrarPreguntaVivo(codigo), 'No se pudo cerrar la pregunta')}>Cerrar pregunta</Button>
                  {sesion.cierraMs != null && [15, 30].map((seg) => (
                    <Button key={seg} variant="quiet" size="sm" className={barra} disabled={accionando}
                      onClick={() => accion(() => ampliarTiempoVivo(codigo, seg), 'No se pudo ampliar el tiempo')}>+{seg} s</Button>
                  ))}
                </>
              )}
              {pregunta?.tipo === 'opcion_unica' && claves?.[pregunta.id]?.correcta && (
                <Button variant="quiet" size="sm" icon={Check} className={barra} onClick={() => cambiar({ verCorrecta: !estado.verCorrecta })}>
                  {estado.verCorrecta ? 'Ocultar la correcta' : 'Mostrar la correcta'}
                </Button>
              )}
              {enMomentos && (
                <Button variant="quiet" size="sm" className={barra} onClick={() => cambiar({ momento: estado.momento === 'opciones' ? 'resultados' : 'opciones' })}>
                  {estado.momento === 'opciones' ? 'Ver resultados' : 'Ver opciones'}
                </Button>
              )}
              {!ultima && <Button size="sm" iconRight={ArrowRight} onClick={() => ir(sesion.preguntaIndex + 1)}>Siguiente</Button>}
            </>
          ))}
          {!finalizada && sesion.acceso === 'externo' && (
            <Button variant="quiet" size="sm" icon={QrCode} className={barra} onClick={() => cambiar({ mostrarQr: !estado.mostrarQr })}>{estado.mostrarQr ? 'Ocultar QR' : 'Mostrar QR'}</Button>
          )}
          {!IS_NATIVE_APP && <Button variant="quiet" size="sm" icon={MonitorUp} className={barra} onClick={proyectarEnOtraVentana}>Proyectar en otra ventana</Button>}
          <Button variant="quiet" size="sm" icon={Maximize2} className={barra} onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}>Pantalla completa</Button>
          {!finalizada && <Button variant="danger-outline" size="sm" icon={Square} onClick={() => setConfirmandoFin(true)}>{ultima || enEspera ? 'Finalizar' : 'Finalizar sesión'}</Button>}
        </div>

        {/* La calificación propuesta de una sesión calificable vive en la vista del docente, debajo de los resultados. */}
      </Pantalla>

      {confirmandoFin && (
        <ConfirmFin onCancelar={() => setConfirmandoFin(false)} onConfirmar={async () => {
          setConfirmandoFin(false)
          try { await finalizarSesionVivo(codigo) } catch (e) { toast(e.message || 'No se pudo finalizar la sesión', 'error') }
        }} />
      )}
    </>
  )
}

/** Ventana de proyección: solo la vista del grupo, de solo lectura, sincronizada con la ventana del docente. */
export function ProyeccionSolaVista({ codigo, claves, docenteId }) {
  const [sesion, setSesion] = useState(undefined)
  const [respuestas, setRespuestas] = useState([])
  const [estado] = useEstadoProyeccion(codigo, { emisor: false })
  const { ahora } = useRelojServidor({ muestrear: medirRelojServidor })
  useEffect(() => escucharSesionVivo(codigo, setSesion, () => setSesion(null)), [codigo])
  useEffect(() => escucharRespuestasVivo(codigo, docenteId, setRespuestas, () => {}), [codigo, docenteId])
  if (sesion === undefined) return <Pantalla autonoma><div className="flex-1 flex items-center justify-center"><Spinner /></div></Pantalla>
  if (sesion === null) return <Pantalla autonoma><div className="flex-1 flex items-center justify-center text-xl">No se encontró esta sesión.</div></Pantalla>
  return <Pantalla autonoma><Escenario sesion={sesion} respuestas={respuestas} informes={[]} claves={claves} vista="grupo" estado={estado} ahora={ahora} /></Pantalla>
}

// Confirmación propia: este componente vive sobre la pantalla de proyección.
function ConfirmFin({ onCancelar, onConfirmar }) {
  return (
    <Modal open onClose={onCancelar} title="¿Finalizar la sesión?" size="sm" z={70}
      footer={<div className="flex justify-end gap-2"><Button variant="quiet" onClick={onCancelar}>Seguir</Button><Button variant="danger" onClick={onConfirmar}>Finalizar</Button></div>}>
      <p className="text-sm text-muted">Los participantes ya no podrán responder. Podrás consultar los resultados completos.</p>
    </Modal>
  )
}
