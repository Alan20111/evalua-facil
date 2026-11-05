// Reto Exprés — pantalla del PARTICIPANTE en el celular (etapa 4). La usan las dos modalidades:
//   · externo  → /r/:codigo, sin cuenta. Al entrar, el servidor entrega un token que se guarda en este navegador.
//   · inscrito → /alumno/reto/:activityId (con su sesión; el servidor encuentra la competencia por la actividad) o
//                /r/:codigo si escaneó el QR con la sesión iniciada.
//
// El estado se consulta cada 2 s (los participantes no leen Firestore). Cada consulta trae la hora del servidor, con la
// que se corrige el reloj local; el contador avanza solo con la apertura y el cierre que fijó el servidor. Lo que llegue
// fuera de tiempo lo rechaza el servidor aunque el celular tenga el reloj mal. Nunca se muestra si se acertó durante la
// competencia: la clave no sale del servidor hasta el final, y a un externo nunca (D9, E11).
//
// Clasificación en vivo (4-nov-2026): al cerrar cada pregunta el servidor manda la clasificación provisional (posición,
// puntos, cuántos compiten y qué falta para subir). Se pide solo cuando hay una más nueva (`parcialVisto`) y se
// conserva entre consultas; nunca incluye la pregunta que está abierta.
//
// Ranking en vivo (etapa B, 5-nov-2026; competencias de la versión 2): «Ver ranking en vivo» abre la tabla de TODOS los
// participantes (puesto, nombre visible, aciertos, tiempo por pregunta, tiempo acumulado y si ya respondió). Mientras
// está abierta, cada consulta la pide (`ranking: true`) y el servidor la manda al día: el puesto cambia en cuanto se
// acepta cada respuesta. El servidor nunca manda en ella respuestas ni opciones. Cerrarla solo deja de pedirla.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Clock, DoorClosed, Hourglass, ListOrdered, LogIn, Pause, Trophy, UserX, X } from 'lucide-react'
import { Button, Input, Modal } from '../ui'
import TablaRankingReto from './TablaRankingReto'
import Spinner from '../Spinner'
import { EsqueletoRetoParticipante } from '../esqueletos'
import { useRelojServidor } from '../../hooks/useTemporizadorVivo'
import { muestraDeDesfase } from '../../utils/participacionVivo'
import { ICONO } from '../../config/iconos'
import { RETO_CFG } from '../../utils/retoExpres'
import { guardarTokenReto, leerTokenReto, llamarReto } from '../../utils/retoExpresDb'
import { COLORES_OPCION, letraOpcion, ordinal, segundosRestantes, textoContador, textoOpcion, textoPuntos } from './opcionesReto'
import { FranjaPosicion, ListaClasificacion, TarjetaPosicion } from './ClasificacionReto'
import { textoDuracion } from '../../utils/retoExpres'

// «20 s cada una» si todas duran lo mismo; «de 20 s a 3 min» si no. Sin datos (servidor anterior), nada.
function textoTiempos(tiempos) {
  const lista = Array.isArray(tiempos) ? tiempos.filter((s) => Number.isFinite(s) && s > 0) : []
  if (!lista.length) return ''
  const min = Math.min(...lista)
  const max = Math.max(...lista)
  return min === max ? `${textoDuracion(min)} cada una` : `de ${textoDuracion(min)} a ${textoDuracion(max)} por pregunta`
}

const INTERVALO_MS = 2000

function Aviso({ icono: Icono, titulo, texto, children }) {
  return (
    <div data-esq="reto-part" className="text-center px-6 py-12 max-w-md mx-auto">
      <div className="mx-auto mb-4 size-16 rounded-full bg-accent-light text-accent flex items-center justify-center">
        <Icono size={ICONO.lg} aria-hidden="true" />
      </div>
      <h1 className="text-xl font-semibold text-on-surface mb-2">{titulo}</h1>
      {texto && <p className="text-base text-muted">{texto}</p>}
      {children}
    </div>
  )
}

function Insignia({ letra, color }) {
  return (
    <span aria-hidden="true" className="size-8 flex-shrink-0 rounded-full text-white font-bold text-base flex items-center justify-center"
      style={{ backgroundColor: color }}>{letra}</span>
  )
}

// Reloj que se recalcula cada 250 ms con la hora del servidor estimada.
function useAhora(ahora, activo) {
  const [t, setT] = useState(() => ahora())
  useEffect(() => {
    if (!activo) return undefined
    const id = setInterval(() => setT(ahora()), 250)
    return () => clearInterval(id)
  }, [ahora, activo])
  return t
}

function Resultados({ resultados, preguntas, modalidad }) {
  const { propia, top = [], realizadas = 0, correccion, totalParticipantes } = resultados || {}
  const porId = new Map((preguntas || []).map((q) => [q.id, q]))
  return (
    <div className="px-4 py-6 max-w-md mx-auto space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-3 size-16 rounded-full bg-accent-light text-accent flex items-center justify-center">
          <Trophy size={ICONO.lg} aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold text-on-surface">¡Terminó el reto!</h1>
        {propia ? (
          <>
            <p className="text-3xl font-bold text-accent tabular-nums mt-2">{ordinal(propia.posicion)} lugar</p>
            <p className="text-base text-muted mt-1">
              {Number.isInteger(totalParticipantes) ? `de ${totalParticipantes} ${totalParticipantes === 1 ? 'participante' : 'participantes'} · ` : ''}
              <strong className="text-on-surface">{textoPuntos(propia.aciertos)}</strong> · {propia.aciertos} de {realizadas} {realizadas === 1 ? 'respuesta correcta' : 'respuestas correctas'}
            </p>
          </>
        ) : realizadas === 0 ? (
          <p className="text-base text-muted mt-1">La competencia terminó antes de la primera pregunta: no hay clasificación.</p>
        ) : null}
      </div>
      <ListaClasificacion filas={top} propia={propia} realizadas={realizadas} titulo="Clasificación final" />
      {modalidad === 'inscritos' && Array.isArray(correccion) && correccion.length > 0 && (
        <section aria-labelledby="reto-correccion" className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
          <h2 id="reto-correccion" className="text-lg font-semibold text-on-surface">Tus respuestas</h2>
          <ol className="space-y-3">
            {correccion.map((c, i) => {
              const q = porId.get(c.preguntaId)
              const op = (id) => {
                const k = (q?.opciones || []).findIndex((o) => o.id === id)
                return k >= 0 ? `${letraOpcion(k)}. ${textoOpcion(q.opciones[k])}` : null
              }
              return (
                <li key={c.preguntaId} className="text-base">
                  <p className="flex items-start gap-2 text-on-surface">
                    {c.acerto
                      ? <Check size={ICONO.md} className="text-emerald-700 flex-shrink-0 mt-0.5" aria-label="Acertaste" />
                      : <X size={ICONO.md} className="text-red-700 flex-shrink-0 mt-0.5" aria-label="No acertaste" />}
                    <span>{i + 1}. {q?.enunciado}</span>
                  </p>
                  <p className="text-sm text-muted pl-7">Tu respuesta: {c.opcionSeleccionada ? op(c.opcionSeleccionada) : 'sin responder'}</p>
                  {/* Con «Mostrar respuesta correcta» = No el servidor no la manda: no se muestra la línea. */}
                  {!c.acerto && c.respuestaCorrecta && <p className="text-sm text-emerald-700 pl-7">Correcta: {op(c.respuestaCorrecta)}</p>}
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}

export default function ParticipanteReto({ codigo: codigoUrl = null, actividadId = null, conSesion = false }) {
  const [estado, setEstado] = useState(null) // respuesta de reto-estado
  const [error, setError] = useState(null) // { mensaje, status }
  const [cargando, setCargando] = useState(true)
  const [alias, setAlias] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [errorEntrada, setErrorEntrada] = useState(null)
  const [enviando, setEnviando] = useState(null)
  const [elegidas, setElegidas] = useState({}) // índice → opción elegida desde aquí
  const [errorEnvio, setErrorEnvio] = useState(null)
  const [sinAlmacen, setSinAlmacen] = useState(false)
  const token = useRef(null)
  const codigoHallado = useRef(null) // inscrito: el código que encontró el servidor por la actividad
  const [parcial, setParcial] = useState(null) // clasificación provisional más reciente
  const parcialVisto = useRef(0) // cuántas preguntas cerradas incluye la que ya tenemos
  const parcialDe = useRef(null) // código de la competencia a la que pertenece
  const [rankingAbierto, setRankingAbierto] = useState(false) // «Ver ranking en vivo» (etapa B)
  const pedirRanking = useRef(false)
  const [ranking, setRanking] = useState(null)
  const { ahora, registrar } = useRelojServidor()

  const sesion = estado?.sesion || null
  const codigo = codigoUrl || sesion?.codigo || null
  const cerrado = !!estado && (estado.participante?.expulsado === true || sesion?.estado === 'finalizada')

  const consultar = useCallback(async () => {
    const t0 = Date.now()
    // Inscrito sin código: el servidor busca la competencia por la actividad SOLO la primera vez; después se consulta por
    // código (así no repite tres lecturas cada 2 s). Si esa competencia deja de existir, se vuelve a buscar.
    const cuerpo = codigoUrl ? { codigo: codigoUrl } : codigoHallado.current ? { codigo: codigoHallado.current } : { actividadId }
    if (codigoUrl) { // token del externo (en un reto de inscritos el servidor lo ignora)
      if (!token.current) token.current = leerTokenReto(codigoUrl)
      if (token.current) cuerpo.token = token.current
    }
    cuerpo.parcialVisto = parcialVisto.current
    if (pedirRanking.current) cuerpo.ranking = true
    try {
      const r = await llamarReto('reto-estado', cuerpo, { conSesion })
      // Otra competencia del mismo reto (el docente abrió una sesión nueva): su clasificación empieza de cero.
      if (r.sesion?.codigo && r.sesion.codigo !== parcialDe.current) {
        parcialDe.current = r.sesion.codigo
        parcialVisto.current = 0
        setParcial(null)
        setRanking(null)
      }
      if (r.ranking) setRanking(r.ranking)
      if (Number.isInteger(r.parcial?.cerradas) && r.parcial.cerradas > parcialVisto.current) {
        parcialVisto.current = r.parcial.cerradas
        setParcial(r.parcial)
      }
      if (Number.isFinite(r.sesion?.ahora)) registrar(muestraDeDesfase(t0, Date.now(), r.sesion.ahora))
      if (!codigoUrl) codigoHallado.current = r.sesion?.codigo || null
      setEstado(r)
      setError(null)
    } catch (e) {
      if (!codigoUrl && e.status === 404) codigoHallado.current = null
      setError({ mensaje: e.message, status: e.status })
    } finally {
      setCargando(false)
    }
  }, [codigoUrl, actividadId, conSesion, registrar])

  // Se consulta mientras haya algo que esperar; al terminar (con resultados) o al ser expulsado, se deja de consultar.
  useEffect(() => {
    const primera = setTimeout(consultar, 0)
    if (cerrado) return () => clearTimeout(primera)
    const id = setInterval(consultar, INTERVALO_MS)
    return () => { clearTimeout(primera); clearInterval(id) }
  }, [consultar, cerrado])

  const enTurno = sesion?.fase === 'preparando' || sesion?.fase === 'abierta'
  const t = useAhora(ahora, enTurno)

  // Al abrir el ranking se pide en ese momento (no hasta la siguiente consulta) y, mientras siga abierto, en cada una.
  function abrirRanking() {
    pedirRanking.current = true
    setRankingAbierto(true)
    consultar()
  }
  function cerrarRanking() {
    pedirRanking.current = false
    setRankingAbierto(false)
  }

  async function entrar() {
    setEntrando(true)
    setErrorEntrada(null)
    try {
      const cuerpo = { codigo }
      if (sesion?.modoIdentidad === 'alias') cuerpo.alias = alias
      if (token.current) cuerpo.token = token.current
      const r = await llamarReto('reto-unirse', cuerpo, { conSesion })
      if (r.token) {
        token.current = r.token
        if (!guardarTokenReto(codigo, r.token)) setSinAlmacen(true)
      }
      await consultar()
    } catch (e) {
      setErrorEntrada(e.message)
    } finally {
      setEntrando(false)
    }
  }

  async function responder(opcionId) {
    const p = estado?.pregunta
    if (!p) return
    setEnviando(opcionId)
    setErrorEnvio(null)
    try {
      await llamarReto('reto-responder', { codigo, indice: p.indice, opcion: opcionId, ...(token.current ? { token: token.current } : {}) }, { conSesion })
      setElegidas((e) => ({ ...e, [p.indice]: opcionId }))
    } catch (e) {
      setErrorEnvio(e.message)
    } finally {
      setEnviando(null)
      consultar()
    }
  }

  if (cargando && !estado) return <EsqueletoRetoParticipante />
  if (error && !estado) {
    if (error.status === 401) {
      return (
        <Aviso icono={LogIn} titulo="Inicia sesión para participar" texto="Este reto es para los estudiantes del grupo. Entra con tu cuenta de Evalúa Fácil y ábrelo desde tu asignatura.">
          <Button as="a" href="/alumno" className="mt-6">Iniciar sesión</Button>
        </Aviso>
      )
    }
    return <Aviso icono={X} titulo={error.status === 404 ? 'No encontramos este reto' : 'No se pudo abrir el reto'} texto={error.status === 404 ? 'Revisa el código o el QR con tu docente.' : error.mensaje} />
  }
  if (!sesion) return <Aviso icono={Hourglass} titulo="Todavía no empieza" texto="Tu docente aún no abre la competencia. Esta pantalla se actualiza sola." />

  const titulo = sesion.titulo || 'Reto Exprés'
  const p = estado.participante

  // ── Todavía no está dentro ──
  if (!p) {
    if (sesion.fase === 'terminada' || sesion.fase === 'finalizada') return <Aviso icono={Trophy} titulo="Este reto ya terminó" texto={titulo} />
    if (!sesion.accesoAbierto) return <Aviso icono={DoorClosed} titulo="El acceso está cerrado" texto="Tu docente todavía no abre la entrada. Esta pantalla se actualiza sola." />
    const conAlias = sesion.modoIdentidad === 'alias'
    return (
      <div className="px-4 py-8 max-w-md mx-auto space-y-4">
        <div className="text-center">
          <p className="text-sm font-semibold text-accent">Reto Exprés</p>
          <h1 className="text-xl font-semibold text-on-surface">{titulo}</h1>
          <p className="text-base text-muted mt-1">{RETO_CFG.TOTAL_PREGUNTAS} preguntas{textoTiempos(sesion.tiemposSeg) ? ` · ${textoTiempos(sesion.tiemposSeg)}` : ''}</p>
        </div>
        <form className="bg-surface-card rounded-card shadow-card p-4 space-y-4" onSubmit={(e) => { e.preventDefault(); entrar() }}>
          {conAlias && (
            <Input label="Tu alias" value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={RETO_CFG.ALIAS_MAX} autoComplete="off"
              hint={`De ${RETO_CFG.ALIAS_MIN} a ${RETO_CFG.ALIAS_MAX} caracteres. Es el nombre que verá el grupo.`} error={errorEntrada || undefined} required />
          )}
          {!conAlias && errorEntrada && <p role="alert" className="text-sm text-red-700">{errorEntrada}</p>}
          <Button type="submit" fullWidth busy={entrando} disabled={conAlias && alias.trim().length < RETO_CFG.ALIAS_MIN}>Entrar</Button>
          {sesion.modalidad === 'externo' && (
            <p className="text-sm text-muted">Tu lugar queda guardado en este navegador. Si cambias de navegador o usas una ventana privada, entrarás como participante nuevo.</p>
          )}
        </form>
      </div>
    )
  }

  if (p.expulsado) return <Aviso icono={UserX} titulo="Ya no participas en este reto" texto="El docente te retiró de esta competencia." />
  if (sesion.estado === 'finalizada' && estado.resultados) return <Resultados resultados={estado.resultados} preguntas={estado.preguntas} modalidad={sesion.modalidad} />

  const aviso = sinAlmacen && (
    <p role="alert" className="mx-4 mt-3 text-sm text-amber-800 bg-amber-50 rounded-card p-3">
      Este navegador no guarda tu lugar (¿ventana privada?). No cierres ni recargues esta página: entrarías como participante nuevo.
    </p>
  )
  const cabecera = (
    <div className="px-4 pt-4 text-center">
      <p className="text-sm text-muted truncate">{titulo} · <span className="text-on-surface font-medium">{p.nombreVisible}</span></p>
    </div>
  )
  const n = Number.isInteger(sesion.indice) ? sesion.indice + 1 : null
  // «Ver ranking en vivo»: disponible durante la competencia (versión 2), salvo mientras todavía responde la pregunta.
  const conRanking = Number.isInteger(sesion.version) && sesion.version >= 2 && sesion.estado === 'en_curso'
  const botonRanking = conRanking && (
    <div className="px-4 pb-4 max-w-md mx-auto">
      <Button variant="secondary" fullWidth icon={ListOrdered} onClick={abrirRanking}>Ver ranking en vivo</Button>
    </div>
  )
  const ventanaRanking = conRanking && (
    <Modal open={rankingAbierto} onClose={cerrarRanking} title="Ranking en vivo" size="4xl"
      footer={<Button variant="secondary" fullWidth onClick={cerrarRanking}>Cerrar ranking</Button>}>
      {ranking
        ? <TablaRankingReto filas={ranking.filas} preguntas={sesion.totalPreguntas || RETO_CFG.TOTAL_PREGUNTAS} cerradas={ranking.cerradas}
            abierta={ranking.abierta} diferidas={ranking.diferidas} />
        : <p className="text-base text-muted">Cargando el ranking…</p>}
      <p className="text-xs text-muted mt-2">Se actualiza solo mientras lo tengas abierto.</p>
    </Modal>
  )

  if (sesion.fase === 'espera') {
    return <>{aviso}{cabecera}<Aviso icono={Check} titulo="¡Ya estás dentro!" texto="Espera a que tu docente inicie el reto. Mira la pantalla del salón." /></>
  }
  // Entre preguntas, en pausa y al esperar el cierre: la tarjeta de posición y la lista provisional.
  const clasificacion = parcial?.propia ? (
    <div className="px-4 pb-6 max-w-md mx-auto space-y-4">
      <TarjetaPosicion parcial={parcial} />
      <ListaClasificacion filas={parcial.top} propia={parcial.propia} titulo="Clasificación provisional" />
    </div>
  ) : null
  if (sesion.fase === 'pausada') return <>{aviso}{cabecera}<Aviso icono={Pause} titulo="Reto en pausa" texto="Tu docente lo reanudará en un momento." />{botonRanking}{clasificacion}{ventanaRanking}</>
  if (sesion.fase === 'terminada' || sesion.fase === 'finalizada') return <>{aviso}{cabecera}<Aviso icono={Hourglass} titulo="Calculando resultados…" /></>
  if (sesion.fase === 'preparando') {
    const s = segundosRestantes(Number.isFinite(sesion.abreMs) ? sesion.abreMs - t : sesion.faltaParaAbrirMs)
    return (
      <>{aviso}{cabecera}
        <Aviso icono={Clock} titulo={`Pregunta ${n} de ${sesion.totalPreguntas}`} texto="Prepárate…">
          {s != null && <p className="mt-4 text-3xl font-bold tabular-nums text-on-surface" aria-live="off">{s}</p>}
        </Aviso>
        {botonRanking}
        {clasificacion}
        {ventanaRanking}
      </>
    )
  }

  // ── Pregunta abierta ──
  const q = estado.pregunta
  const restante = Number.isFinite(sesion.cierraMs) ? sesion.cierraMs - t : sesion.restanteMs
  const s = segundosRestantes(restante)
  const sinTiempo = s === 0
  const respondida = elegidas[q?.indice] || (estado.yaRespondio ? true : null)
  return (
    <>{aviso}{cabecera}
      <div className="px-4 py-4 max-w-md mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-accent">Pregunta {n} de {sesion.totalPreguntas}</p>
          <p className={`text-2xl font-bold tabular-nums ${s != null && s <= 5 ? 'text-red-800' : 'text-on-surface'}`} aria-live="off" aria-label={`Quedan ${s} segundos`}>{textoContador(s)}</p>
        </div>
        {!respondida && <FranjaPosicion parcial={parcial} />}
        <h1 className="text-xl font-semibold text-on-surface break-words">{q?.enunciado}</h1>
        {respondida ? (
          <>
            <Aviso icono={Check} titulo="Respuesta enviada" texto="Espera la siguiente pregunta." />
            {conRanking
              ? <Button variant="secondary" fullWidth icon={ListOrdered} onClick={abrirRanking}>Ver ranking en vivo</Button>
              : <FranjaPosicion parcial={parcial} nota="se actualiza al cerrar la pregunta" />}
          </>
        ) : (
          <fieldset className="grid gap-3">
            <legend className="sr-only">Opciones</legend>
            {(q?.opciones || []).map((o, i) => (
              // Botón propio (no <Button>): el texto de una opción puede ocupar varias líneas.
              <button key={o.id} type="button" disabled={sinTiempo || enviando !== null} aria-busy={enviando === o.id}
                onClick={() => responder(o.id)}
                className="w-full flex items-center gap-3 rounded-card border border-outline-variant bg-surface-card px-4 py-3 text-left text-base text-on-surface transition hover:bg-surface disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
                <Insignia letra={letraOpcion(i)} color={COLORES_OPCION[i % COLORES_OPCION.length]} />
                <span className="flex-1 min-w-0 break-words">{textoOpcion(o)}</span>
                {enviando === o.id && <Spinner />}
              </button>
            ))}
          </fieldset>
        )}
        {sinTiempo && !respondida && <p className="text-base text-muted text-center">Se acabó el tiempo de esta pregunta.</p>}
        {errorEnvio && <p role="alert" className="text-sm text-red-700">{errorEnvio}</p>}
      </div>
      {ventanaRanking}
    </>
  )
}
