// Chat con Asistente — por asignatura y Asistente General (17-ago-2026),
// más Chat con Acciones (17-ago-2026) para crear Actividad Entregable,
// Actividad de Observación o Examen. El contexto lo arma el servidor en
// cada turno (precheckChatAsistente / precheckAsistenteGeneral en
// functions/ia.js) — este componente solo manda subjectId (o nada, para el
// General) + mensaje + historial reciente, nunca contenido pedagógico
// armado en el cliente. La IA nunca escribe Firestore: cuando el servidor
// decide incluir una `propuesta` en su respuesta, ya viene saneada (ver
// sanearPropuestaAccionChat) y este componente solo la muestra como
// tarjeta; la creación real la ejecuta el SERVIDOR (chat_crear_actividad /
// chat_crear_examen en functions/ia.js) SOLO al hacer clic en "Crear
// actividad"/"Crear examen" — nunca al interpretar texto libre como "sí".
//
// Modelo de cobro (18-ago-2026, decisión definitiva de Kike): la
// conversación NUNCA cobra créditos por mensaje — ni por asignatura ni en
// el Asistente General. Solo cobra confirmar una acción (una sola
// operación de crédito, nunca mensaje+propuesta+creación por separado). El
// único candado visible de "uso" es el límite de 100 interacciones/día por
// contexto que aplica el servidor — el chat NUNCA muestra créditos, "0
// créditos" ni un contador de mensajes/interacciones; ver TarjetaPropuesta
// para el único lugar donde SÍ se ve un costo (el de la acción, antes de
// confirmarla).
//
// Persistencia (pedido explícito, 17-ago-2026: "no se deben borrar los
// mensajes a menos de que el docente las borre, debe poder ver hacia
// atrás"): cada mensaje (docente o asistente) se guarda en `chatMensajes`,
// uno por asignatura (o uno para el General, subjectId ausente) y por
// docente — se carga entero al abrir esa conversación, y solo desaparece si
// el propio docente lo borra con el botón "Borrar conversación". Lo único
// que sigue acotado es cuánto historial se manda al MODELO en cada turno
// (últimos 10 turnos, por costo) — la vista hacia atrás no tiene ese límite.
import { useEffect, useRef, useState } from 'react'
import { collection, query, where, onSnapshot, addDoc, updateDoc, writeBatch, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import { useCreditosIA } from '../../hooks/useCreditosIA'
import Spinner from '../../components/Spinner'
import Select from '../../components/ui/Select'
import Input from '../../components/ui/Input'
import { subjectDisplayName } from '../../utils/subjectName'
import { formatDeadline } from '../../utils/activityVisibility'
import { calcularTarifaExamen } from '../../utils/tarifaExamen'
import { useScrollLock } from '../../hooks/useScrollLock'
import { MessageCircle, Send, Sparkles, Trash2, Globe, ClipboardList, CheckCircle2 } from 'lucide-react'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'

const ETIQUETA_ACCION = {
  CREAR_ACTIVIDAD_ENTREGABLE: 'Actividad entregable',
  CREAR_ACTIVIDAD_OBSERVACION: 'Actividad de observación',
  CREAR_EXAMEN: 'Examen',
}
const TEXTO_BOTON_ACCION = {
  CREAR_ACTIVIDAD_ENTREGABLE: 'Crear actividad',
  CREAR_ACTIVIDAD_OBSERVACION: 'Crear actividad',
  CREAR_EXAMEN: 'Crear examen',
}
// Operación de créditos (functions/ia.js) que cobra cada acción — entregable
// y observación comparten una sola operación (misma tarifa fija, 4
// créditos); el examen tiene la suya propia por su tarifa variable.
const OPERACION_PARA_ACCION = {
  CREAR_ACTIVIDAD_ENTREGABLE: 'chat_crear_actividad',
  CREAR_ACTIVIDAD_OBSERVACION: 'chat_crear_actividad',
  CREAR_EXAMEN: 'chat_crear_examen',
}
const TEXTO_CREADA_ACCION = {
  CREAR_ACTIVIDAD_ENTREGABLE: 'La actividad fue creada correctamente.',
  CREAR_ACTIVIDAD_OBSERVACION: 'La Actividad de Observación fue creada correctamente.',
  CREAR_EXAMEN: 'El examen fue creado correctamente.',
}
// Concordancia de género para la tarjeta ya ejecutada ("Actividad... creada" / "Examen creado").
const TEXTO_TARJETA_CREADA = {
  CREAR_ACTIVIDAD_ENTREGABLE: 'Actividad entregable creada',
  CREAR_ACTIVIDAD_OBSERVACION: 'Actividad de observación creada',
  CREAR_EXAMEN: 'Examen creado',
}

const GENERAL = '__general__'

const SUGERENCIAS_ASIGNATURA = [
  '¿Qué tema me sugieres trabajar en mi próxima clase?',
  '¿Qué puedo hacer para reforzar lo que estamos viendo?',
  '¿Cómo puedo mejorar mi próxima actividad?',
  '¿Qué me recomiendas para mi próxima sesión?',
  '¿Qué aspectos debería reforzar con este grupo?',
]
const SUGERENCIAS_GENERAL = [
  '¿Cómo van mis grupos?',
  '¿Qué debería atender primero?',
  '¿Qué tengo pendiente?',
  '¿Qué asignatura necesita más atención?',
  'Ayúdame a organizar mi semana.',
]

// Tarjeta de la propuesta — la representación ESTRUCTURADA que pide el
// pedido explícito ("no quiero que la propuesta sea solamente texto libre").
// Puramente presentacional: toda la decisión de qué se puede confirmar vive
// en confirmarPropuesta (arriba), no aquí.
function TarjetaPropuesta({ propuesta, contextoVigente, ejecutando, bloqueado, onConfirmar, costoAccion }) {
  const esExamen = propuesta.accion === 'CREAR_EXAMEN'
  return (
    <div className="max-w-[85%] w-full rounded-card border border-outline-variant bg-surface-card p-3 text-sm space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wide">
        <ClipboardList size={14} /> {ETIQUETA_ACCION[propuesta.accion] || 'Actividad propuesta'}
      </div>
      <p className="font-semibold text-on-surface">{propuesta.nombre}</p>
      {propuesta.instrucciones && <p className="text-muted whitespace-pre-wrap">{propuesta.instrucciones}</p>}
      {propuesta.fechaLimite && <p className="text-xs text-muted">Fecha límite: {formatDeadline(propuesta.fechaLimite)}</p>}
      {esExamen && <p className="text-xs text-muted">Reactivos: {propuesta.reactivos?.length ?? 0}</p>}

      {propuesta.ejecutada ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
          <CheckCircle2 size={16} /> {TEXTO_TARJETA_CREADA[propuesta.accion] || 'Creada'}
        </p>
      ) : !contextoVigente ? (
        <p className="text-xs text-error">Cambiaste de asignatura — vuelve a esta asignatura para crearla.</p>
      ) : (
        <button
          type="button"
          onClick={onConfirmar}
          disabled={ejecutando || bloqueado}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white font-semibold text-xs rounded transition-colors disabled:opacity-60"
        >
          {ejecutando && <Spinner size="sm" />}
          {TEXTO_BOTON_ACCION[propuesta.accion] || 'Crear'}
          {costoAccion != null && ` — ${costoAccion} ${costoAccion === 1 ? 'crédito' : 'créditos'}`}
        </button>
      )}
    </div>
  )
}

export default function ChatAsistente() {
  const { currentUser } = useAuth()
  const toast = useToast()
  const creditosIA = useCreditosIA()

  // La página entera está pensada para caber exacta en la pantalla (altura
  // fija + overflow-hidden, ver más abajo) — sin esto, un pixelaje de más
  // (p. ej. por el <main> del layout forzando una altura mínima de pantalla completa, o el teclado abriéndose)
  // dejaba a la PÁGINA con un poco de scroll residual, y ese scroll movía
  // el título/"Contexto" detrás del header sticky ("DOCENTE") — quejado
  // explícitamente. Bloquear el scroll de fondo mientras el chat está
  // montado lo elimina de raíz, sin depender de calcular la altura exacta
  // del header/teclado a cada momento. Mismo hook que ya usa el resto de la
  // app para overlays (Select, modales) — no es un mecanismo nuevo.
  useScrollLock(true)

  const [subjects, setSubjects] = useState([])
  const [subjectsLoaded, setSubjectsLoaded] = useState(false)
  const [seleccion, setSeleccion] = useState(GENERAL)

  // Historial CARGADO de Firestore para la conversación seleccionada — se
  // conserva hasta que el docente lo borra. { id, role, content }.
  const [historial, setHistorial] = useState([])
  const [historialCargado, setHistorialCargado] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [confirmarBorrar, setConfirmarBorrar] = useState(false)
  // id del mensaje cuya propuesta se está creando — deshabilita SU botón y,
  // por sencillez, cualquier otro botón de "Crear" mientras tanto (evita
  // doble clic / doble ejecución). El STATE (ejecutandoId) es solo para
  // pintar el botón — React agrupa sus actualizaciones, así que dos clics
  // casi simultáneos pueden leer el mismo valor viejo antes del primer
  // re-render y colarse los dos (bug real encontrado en pruebas: 3 clics
  // seguidos crearon 3 actividades y cobraron 3 veces). La guardia real que
  // SÍ bloquea de inmediato es `ejecutandoRef`, síncrona, verificada y
  // marcada en la primera línea de confirmarPropuesta, antes de cualquier
  // await.
  const [ejecutandoId, setEjecutandoId] = useState(null)
  const ejecutandoRef = useRef(null)
  const finRef = useRef(null)

  // Alto real del header sticky móvil ("DOCENTE") + la barra inferior de
  // navegación — SIN esto, la altura fija de abajo (100dvh - 2rem) no
  // descontaba ese espacio, así que el contenedor quedaba más alto que lo
  // visible y el título/"Contexto" terminaban escondiéndose detrás del
  // header con cualquier scroll residual. En escritorio ambos tienen
  // display:none (md:hidden), miden 0 y el cálculo no cambia. Se vuelven a
  // medir si cambian de tamaño (rotación, aparece un banner, etc.).
  const [altoChromeMovil, setAltoChromeMovil] = useState(0)
  useEffect(() => {
    const header = document.querySelector('header')
    const nav = document.querySelector('nav')
    if (!header || !nav) return undefined
    const medir = () => setAltoChromeMovil(header.getBoundingClientRect().height + nav.getBoundingClientRect().height)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(header)
    ro.observe(nav)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!currentUser) return undefined
    const q = query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid))
    const unsub = onSnapshot(q, (snap) => {
      const lista = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => !s.archived)
        .sort((a, b) => (a.orden || 0) - (b.orden || 0))
      setSubjects(lista)
      setSubjectsLoaded(true)
    })
    return unsub
  }, [currentUser])

  // Cargar el historial guardado de la conversación seleccionada — se
  // vuelve a cargar cada vez que cambia la selección (Asistente General o
  // una asignatura distinta).
  useEffect(() => {
    if (!currentUser) return undefined
    // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia el historial anterior antes de suscribirse a la conversación recién seleccionada
    setHistorial([])
    const subjectIdFiltro = seleccion === GENERAL ? null : seleccion
    const q = query(
      collection(db, 'chatMensajes'),
      where('docenteId', '==', currentUser.uid),
      where('subjectId', '==', subjectIdFiltro),
    )
    const unsub = onSnapshot(q, (snap) => {
      const lista = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.creadoEnMillis || 0) - (b.creadoEnMillis || 0))
      setHistorial(lista)
      setHistorialCargado(true)
    }, () => setHistorialCargado(true))
    return unsub
  }, [currentUser, seleccion])

  // 'auto' (instantáneo) — pedido explícito: al abrir/cambiar de
  // conversación debe dejarte directo al último mensaje, no animar el
  // scroll pasando por toda la conversación de arriba a abajo.
  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [historial, enviando])

  // Saldo = 0 → el chat entero queda bloqueado (regla definitiva, 18-ago-2026)
  // — no es un costo por mensaje, es una condición de ACCESO. Antes del
  // primer uso de IA (sin doc iaCreditos todavía) useCreditosIA ya devuelve
  // la bolsa completa del plan, nunca 0 — mismo criterio que el servidor.
  const sinCreditos = creditosIA.listo && creditosIA.saldo <= 0

  // `creadoEnMillis` es un número local además del serverTimestamp real —
  // sirve para ordenar de inmediato en la propia sesión, sin esperar a que
  // el servidor resuelva el timestamp. Se calcula en el event handler (no
  // aquí) para no llamar a Date.now() dentro del cuerpo del componente.
  // `propuesta`, cuando existe, ya viene saneada por el servidor
  // (sanearPropuestaAccionChat) — aquí solo se le agrega el subjectId de ESTA
  // conversación (nunca uno que la IA haya podido mencionar) y `ejecutada`,
  // para que la tarjeta sepa si ya se creó o sigue pendiente de confirmar.
  async function guardarMensaje(role, content, creadoEnMillis, propuesta = null) {
    const subjectIdGuardado = seleccion === GENERAL ? null : seleccion
    const data = {
      docenteId: currentUser.uid, subjectId: subjectIdGuardado, role, content,
      creadoEnMillis, creadoEn: serverTimestamp(),
    }
    if (propuesta) data.propuesta = { ...propuesta, subjectId: subjectIdGuardado, ejecutada: false }
    await addDoc(collection(db, 'chatMensajes'), data)
  }

  async function enviar(textoForzado) {
    const texto = (textoForzado ?? mensaje).trim()
    if (!texto || enviando) return
    if (sinCreditos) {
      toast('Necesitas créditos disponibles para seguir usando el Chat con Asistente.', 'error')
      return
    }
    // El servidor igual vuelve a acotar a los últimos 10 — se manda ya
    // acotado para no depender de eso.
    const historialParaEnviar = historial.slice(-10).map((h) => ({ role: h.role, content: h.content }))
    setMensaje('')
    setEnviando(true)
    try {
      // eslint-disable-next-line react-hooks/purity -- Date.now() aquí es solo una clave de orden local para un mensaje que se está enviando (event handler, no render)
      await guardarMensaje('user', texto, Date.now())
      // chat_asistente ya no cobra créditos (tarifa 0) — el único candado
      // del lado del servidor es el límite diario de 100 interacciones por
      // este mismo contexto (verificarLimiteChat en functions/ia.js) y el
      // saldo > 0 (verificarSaldoChat).
      const data = await creditosIA.ejecutar('chat_asistente', {
        subjectId: seleccion === GENERAL ? null : seleccion, mensaje: texto, historial: historialParaEnviar,
      }, 1, { timeoutMs: 60000 })
      const respuesta = data?.resultado?.respuesta || ''
      const propuesta = data?.resultado?.propuesta || null
      // eslint-disable-next-line react-hooks/purity -- ídem, clave de orden local del turno de respuesta
      await guardarMensaje('assistant', respuesta || 'No obtuve una respuesta esta vez.', Date.now(), propuesta)
    } catch (err) {
      if (err.codigo === 'LIMITE_DIARIO_CHAT') {
        // Se ve como una respuesta más del asistente, no como un error — es
        // un estado normal del chat, no una falla (pedido explícito: nunca
        // mostrar un contador, solo el mensaje sencillo cuando se alcanza).
        // eslint-disable-next-line react-hooks/purity -- clave de orden local del mensaje de límite
        await guardarMensaje('assistant', err.message || 'Has alcanzado el límite diario de este chat. Podrás continuar mañana.', Date.now())
      } else if (err.codigo === 'SIN_CREDITOS_CHAT') {
        toast(err.message || 'Necesitas créditos disponibles para seguir usando el Chat con Asistente.', 'error')
      } else if (err.codigo === 'PERFIL_IA_INCOMPLETO') {
        toast('Completa primero tu Perfil para IA del docente para usar el Chat con Asistente.', 'error')
      } else {
        toast(err.message || 'El asistente de IA no está disponible en este momento', 'error')
      }
      // La pregunta del docente ya se guardó (se ve en el historial) aunque
      // la respuesta haya fallado — puede reintentar sin perder lo escrito.
    } finally {
      setEnviando(false)
    }
  }

  // CONFIRMAR → EJECUTAR. Se dispara ÚNICA y EXCLUSIVAMENTE por el clic en
  // el botón de la tarjeta — nunca por interpretar "sí"/"créala" del texto
  // libre. `propuesta.subjectId` se comparó al guardar el mensaje contra la
  // asignatura seleccionada en ese momento; se vuelve a comparar aquí contra
  // la selección ACTUAL, para que un cambio de asignatura entre la
  // propuesta y el clic no pueda terminar creando algo en la asignatura
  // equivocada.
  async function confirmarPropuesta(msg) {
    const propuesta = msg.propuesta
    if (!propuesta || propuesta.ejecutada) return
    // Guardia SÍNCRONA — se revisa y se marca ANTES de cualquier `await` o
    // `setState`, así que dos clics (o tres) en el mismo tick no pueden
    // colarse los dos: el segundo ve `ejecutandoRef.current` ya puesto y
    // sale de inmediato, sin esperar a que React re-pinte el botón.
    if (ejecutandoRef.current) return
    ejecutandoRef.current = msg.id
    setEjecutandoId(msg.id)
    const subjectIdActual = seleccion === GENERAL ? null : seleccion
    if (propuesta.subjectId !== subjectIdActual) {
      toast('Esta propuesta era de otra asignatura — cámbiate a esa asignatura para crearla.', 'error')
      ejecutandoRef.current = null
      setEjecutandoId(null)
      return
    }
    const subject = subjects.find((s) => s.id === propuesta.subjectId)
    if (!subject) {
      toast('No se encontró la asignatura de esta propuesta.', 'error')
      ejecutandoRef.current = null
      setEjecutandoId(null)
      return
    }

    try {
      // Único punto de cobro real: el servidor vuelve a validar y a saneear
      // la propuesta (nunca confía en esta copia), calcula parcial/orden, y
      // hace la creación con el Admin SDK — cobro y creación quedan
      // atómicos (un fallo en la escritura reembolsa la reserva sola,
      // mismo mecanismo que ya usa el resto de operaciones de IA).
      const operacion = OPERACION_PARA_ACCION[propuesta.accion] || 'chat_crear_actividad'
      const data = await creditosIA.ejecutar(operacion, { subjectId: propuesta.subjectId, propuesta }, 1, { timeoutMs: 60000 })
      const resultado = data?.resultado
      // Marca la propuesta como ejecutada ANTES que nada más — es lo que
      // evita que un reintento (doble clic, reintento de red) pueda volver a
      // crear otra actividad: una vez marcada, el botón deja de existir.
      await updateDoc(doc(db, 'chatMensajes', msg.id), {
        'propuesta.ejecutada': true, 'propuesta.activityId': resultado?.activityId || null,
      })
      // eslint-disable-next-line react-hooks/purity -- clave de orden local del mensaje de confirmación
      await guardarMensaje('assistant', TEXTO_CREADA_ACCION[propuesta.accion] || 'Listo, se creó correctamente.', Date.now())
    } catch (err) {
      if (err.codigo === 'SALDO_INSUFICIENTE') {
        toast(`No tienes suficientes créditos para crear esto — necesitas ${err.costo} y tienes ${err.saldo}.`, 'error')
      } else {
        toast('No se pudo crear: ' + (err.message || 'intenta de nuevo'), 'error')
      }
      // No se marca ejecutada: el botón sigue disponible para reintentar.
    } finally {
      ejecutandoRef.current = null
      setEjecutandoId(null)
    }
  }

  async function borrarConversacion() {
    setConfirmarBorrar(false)
    try {
      const batch = writeBatch(db)
      historial.forEach((h) => batch.delete(doc(db, 'chatMensajes', h.id)))
      await batch.commit()
      toast('Conversación borrada')
    } catch (err) {
      toast('No se pudo borrar la conversación: ' + err.message, 'error')
    }
  }

  const asignaturaActual = subjects.find((s) => s.id === seleccion)
  const esGeneral = seleccion === GENERAL
  const sugerencias = esGeneral ? SUGERENCIAS_GENERAL : SUGERENCIAS_ASIGNATURA

  const opcionesSelector = [
    { value: GENERAL, label: 'Asistente General' },
    ...subjects.map((s) => ({ value: s.id, label: subjectDisplayName(s) })),
  ]

  return (
    <div className={`px-4 sm:px-5 lg:px-6 py-4 ${TEACHER_CONTAINER_NARROW} flex flex-col overflow-hidden`} style={{ height: `calc(100dvh - ${altoChromeMovil}px - 2rem)` }}>
      <div className="flex items-center gap-2 mb-3">
        <MessageCircle size={22} className="text-accent flex-shrink-0" />
        <h1 className="text-lg font-bold text-on-surface">Chat con Asistente</h1>
      </div>

      {/* Selector de contexto — Asistente General o una asignatura. Cambiarlo
          carga la conversación guardada de esa selección (o la deja vacía si
          nunca se ha conversado ahí). */}
      <div className="mb-3 flex items-end gap-2">
        <div className="flex-1">
          {!subjectsLoaded ? (
            <div className="flex items-center gap-2 text-sm text-muted"><Spinner size="sm" /> Cargando asignaturas…</div>
          ) : (
            <Select
              id="chat-contexto"
              label="Contexto"
              value={seleccion}
              onChange={setSeleccion}
              options={opcionesSelector}
              className="border-2 border-accent bg-[var(--accent-tint)] font-semibold"
            />
          )}
        </div>
        {historial.length > 0 && (
          confirmarBorrar ? (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button type="button" onClick={() => setConfirmarBorrar(false)} className="text-xs text-muted px-2 py-2">Cancelar</button>
              <button type="button" onClick={borrarConversacion} className="text-xs bg-error text-white rounded px-2.5 py-2 font-medium flex-shrink-0">Sí, borrar</button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmarBorrar(true)}
              title="Borrar esta conversación"
              className="flex-shrink-0 p-2.5 rounded border border-outline-variant text-muted hover:text-error hover:border-error/40 transition-colors"
            >
              <Trash2 size={16} />
            </button>
          )
        )}
      </div>

      {/* Nunca se muestra costo/saldo durante la conversación (regla
          definitiva, 18-ago-2026) — el chat es gratis por mensaje. Solo se
          avisa cuando de plano no hay saldo para usarlo (condición de
          acceso, no un costo por mensaje). */}
      {sinCreditos && (
        <p className="text-xs mb-2 text-error font-medium">
          Necesitas créditos disponibles para seguir usando el Chat con Asistente.
        </p>
      )}

      {/* Conversación */}
      <div className="flex-1 min-h-0 bg-surface-card rounded-card shadow-card p-3 mb-3 overflow-y-auto space-y-3">
        {!historialCargado ? (
          <div className="h-full flex items-center justify-center"><Spinner size="sm" /></div>
        ) : historial.length === 0 && !enviando ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-6 gap-3">
            {esGeneral ? <Globe size={28} className="text-accent" /> : <Sparkles size={28} className="text-accent" />}
            <p className="text-sm text-muted max-w-sm">
              {esGeneral
                ? 'Pregúntame sobre el conjunto de tus asignaturas — uso un resumen de cada una (pendientes, promedios, alumnos en riesgo).'
                : <>Pregúntame sobre <strong className="text-on-surface">{asignaturaActual ? subjectDisplayName(asignaturaActual) : 'esta asignatura'}</strong> — uso su planeación, fechas, diagnósticos y resultados que ya tienes registrados.</>}
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {sugerencias.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => enviar(s)}
                  disabled={enviando || sinCreditos}
                  className="px-3 py-1.5 rounded-full border border-outline-variant text-xs text-on-surface hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          historial.map((h) => (
            <div key={h.id} className={`flex flex-col ${h.role === 'user' ? 'items-end' : 'items-start'} gap-1.5`}>
              <div className={`flex ${h.role === 'user' ? 'justify-end' : 'justify-start'} w-full`}>
                <div className={`max-w-[85%] rounded-card px-3 py-2 text-base whitespace-pre-wrap ${
                  h.role === 'user' ? 'bg-accent text-white' : 'bg-surface-container text-on-surface'
                }`}>
                  {h.content}
                </div>
              </div>
              {h.propuesta && (
                <TarjetaPropuesta
                  propuesta={h.propuesta}
                  contextoVigente={h.propuesta.subjectId === (seleccion === GENERAL ? null : seleccion)}
                  ejecutando={ejecutandoId === h.id}
                  bloqueado={!!ejecutandoId && ejecutandoId !== h.id}
                  onConfirmar={() => confirmarPropuesta(h)}
                  // Solo informativo — el servidor vuelve a calcular y a
                  // cobrar esto por su cuenta, nunca confía en este número.
                  costoAccion={h.propuesta.accion === 'CREAR_EXAMEN'
                    ? calcularTarifaExamen(h.propuesta.reactivos?.length)
                    : creditosIA.estimar('chat_crear_actividad')}
                />
              )}
            </div>
          ))
        )}
        {enviando && (
          <div className="flex justify-start">
            <div className="bg-surface-container text-on-surface rounded-card px-3 py-2 text-base flex items-center gap-2">
              <Spinner size="sm" /> Pensando…
            </div>
          </div>
        )}
        <div ref={finRef} />
      </div>

      {/* Campo de escritura */}
      <form
        onSubmit={(e) => { e.preventDefault(); enviar() }}
        className="flex items-center gap-2"
      >
        <Input
          type="text"
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          placeholder="Escribe tu pregunta…"
          disabled={enviando}
          maxLength={2000}
          wrapperClassName="flex-1"
          className="disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={enviando || !mensaje.trim() || sinCreditos}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white font-semibold text-sm rounded transition-colors disabled:opacity-45"
        >
          {enviando ? <Spinner size="sm" /> : <Send size={16} />}
          Enviar
        </button>
      </form>
    </div>
  )
}
