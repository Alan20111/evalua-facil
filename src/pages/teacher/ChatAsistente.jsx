// Chat con Asistente — por asignatura y Asistente General (17-ago-2026),
// más Chat con Acciones (17-ago-2026, segunda entrega): CONVERSAR →
// PROPONER → CONFIRMAR → EJECUTAR para crear Actividad Entregable, Actividad
// de Observación o Examen. El contexto lo arma el servidor en cada turno
// (precheckChatAsistente / precheckAsistenteGeneral en functions/ia.js) —
// este componente solo manda subjectId (o nada, para el General) + mensaje +
// historial reciente, nunca contenido pedagógico armado en el cliente. La
// IA nunca escribe Firestore: cuando el servidor decide incluir una
// `propuesta` en su respuesta, ya viene saneada (ver
// sanearPropuestaAccionChat) y este componente solo la muestra como tarjeta;
// la creación real la ejecuta ejecutarPropuestaAccion (utils/accionesChat.js)
// SOLO al hacer clic en "Crear actividad"/"Crear examen" — nunca al
// interpretar texto libre como "sí".
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
import { parcialForDate } from '../../utils/parciales'
import { formatDeadline } from '../../utils/activityVisibility'
import { ejecutarPropuestaAccion } from '../../utils/accionesChat'
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
function TarjetaPropuesta({ propuesta, contextoVigente, ejecutando, bloqueado, onConfirmar }) {
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
        </button>
      )}
    </div>
  )
}

export default function ChatAsistente() {
  const { currentUser } = useAuth()
  const toast = useToast()
  const creditosIA = useCreditosIA()

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
  // doble clic / doble ejecución).
  const [ejecutandoId, setEjecutandoId] = useState(null)
  const finRef = useRef(null)

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

  const costoPorMensaje = creditosIA.estimar('chat_asistente')
  const saldoAlcanza = costoPorMensaje == null || creditosIA.saldo >= costoPorMensaje

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
    if (!saldoAlcanza) {
      toast(`No tienes créditos suficientes — necesitas ${costoPorMensaje} y tienes ${creditosIA.saldo}.`, 'error')
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
      const data = await creditosIA.ejecutar('chat_asistente', {
        subjectId: seleccion === GENERAL ? null : seleccion, mensaje: texto, historial: historialParaEnviar,
      }, 1, { timeoutMs: 60000 })
      const respuesta = data?.resultado?.respuesta || ''
      const propuesta = data?.resultado?.propuesta || null
      // eslint-disable-next-line react-hooks/purity -- ídem, clave de orden local del turno de respuesta
      await guardarMensaje('assistant', respuesta || 'No obtuve una respuesta esta vez.', Date.now(), propuesta)
    } catch (err) {
      if (err.codigo === 'SALDO_INSUFICIENTE') {
        toast(`No tienes créditos suficientes — necesitas ${err.costo ?? costoPorMensaje} y tienes ${err.saldo ?? creditosIA.saldo}.`, 'error')
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
    if (!propuesta || propuesta.ejecutada || ejecutandoId) return
    const subjectIdActual = seleccion === GENERAL ? null : seleccion
    if (propuesta.subjectId !== subjectIdActual) {
      toast('Esta propuesta era de otra asignatura — cámbiate a esa asignatura para crearla.', 'error')
      return
    }
    const subject = subjects.find((s) => s.id === propuesta.subjectId)
    if (!subject) { toast('No se encontró la asignatura de esta propuesta.', 'error'); return }

    setEjecutandoId(msg.id)
    try {
      const hoy = new Date().toISOString().slice(0, 10)
      const parcial = parcialForDate(subject.parcialesFechas, hoy) || Math.max(1, Number(subject.parciales) || 1)
      const resultado = await ejecutarPropuestaAccion(propuesta, { subjectId: propuesta.subjectId, docenteId: currentUser.uid, parcial })
      // Marca la propuesta como ejecutada ANTES que nada más — es lo que
      // evita que un reintento (doble clic, reintento de red) pueda volver a
      // crear otra actividad: una vez marcada, el botón deja de existir.
      await updateDoc(doc(db, 'chatMensajes', msg.id), {
        'propuesta.ejecutada': true, 'propuesta.activityId': resultado.id,
      })
      // eslint-disable-next-line react-hooks/purity -- clave de orden local del mensaje de confirmación
      await guardarMensaje('assistant', TEXTO_CREADA_ACCION[propuesta.accion] || 'Listo, se creó correctamente.', Date.now())
    } catch (err) {
      toast('No se pudo crear: ' + (err.message || 'intenta de nuevo'), 'error')
      // No se marca ejecutada: el botón sigue disponible para reintentar.
    } finally {
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
    <div className={`px-4 sm:px-5 lg:px-6 py-4 ${TEACHER_CONTAINER_NARROW} flex flex-col overflow-hidden`} style={{ height: 'calc(100dvh - 2rem)' }}>
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

      {/* Transparencia de créditos (pedido explícito, 17-ago-2026): el costo
          y el saldo se ven ANTES de mandar, no se descubren después. */}
      {creditosIA.listo && costoPorMensaje != null && (
        <p className={`text-xs mb-2 ${saldoAlcanza ? 'text-muted' : 'text-error font-medium'}`}>
          Cada mensaje cuesta {costoPorMensaje} {costoPorMensaje === 1 ? 'crédito' : 'créditos'} de IA · Saldo disponible: {creditosIA.saldo}
          {!saldoAlcanza && ' — no alcanza para enviar otro mensaje'}
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
                  disabled={enviando || !saldoAlcanza}
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
          disabled={enviando || !mensaje.trim() || !saldoAlcanza}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white font-semibold text-sm rounded transition-colors disabled:opacity-45"
        >
          {enviando ? <Spinner size="sm" /> : <Send size={16} />}
          Enviar
        </button>
      </form>
    </div>
  )
}
