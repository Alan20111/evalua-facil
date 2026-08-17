// Chat con Asistente — por asignatura y Asistente General (17-ago-2026).
// El contexto lo arma el servidor en cada turno (precheckChatAsistente /
// precheckAsistenteGeneral en functions/ia.js) — este componente solo manda
// subjectId (o nada, para el General) + mensaje + historial reciente, nunca
// contenido pedagógico armado en el cliente.
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
import { collection, query, where, onSnapshot, addDoc, writeBatch, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import { useCreditosIA } from '../../hooks/useCreditosIA'
import Spinner from '../../components/Spinner'
import Select from '../../components/ui/Select'
import Input from '../../components/ui/Input'
import { subjectDisplayName } from '../../utils/subjectName'
import { MessageCircle, Send, Sparkles, Trash2, Globe } from 'lucide-react'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'

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

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [historial, enviando])

  const costoPorMensaje = creditosIA.estimar('chat_asistente')
  const saldoAlcanza = costoPorMensaje == null || creditosIA.saldo >= costoPorMensaje

  // `creadoEnMillis` es un número local además del serverTimestamp real —
  // sirve para ordenar de inmediato en la propia sesión, sin esperar a que
  // el servidor resuelva el timestamp. Se calcula en el event handler (no
  // aquí) para no llamar a Date.now() dentro del cuerpo del componente.
  async function guardarMensaje(role, content, creadoEnMillis) {
    const subjectIdGuardado = seleccion === GENERAL ? null : seleccion
    await addDoc(collection(db, 'chatMensajes'), {
      docenteId: currentUser.uid, subjectId: subjectIdGuardado, role, content,
      creadoEnMillis, creadoEn: serverTimestamp(),
    })
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
      // eslint-disable-next-line react-hooks/purity -- ídem, clave de orden local del turno de respuesta
      await guardarMensaje('assistant', respuesta || 'No obtuve una respuesta esta vez.', Date.now())
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
    <div className={`px-4 sm:px-5 lg:px-6 py-4 ${TEACHER_CONTAINER_NARROW} flex flex-col`} style={{ minHeight: 'calc(100dvh - 2rem)' }}>
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
      <div className="flex-1 bg-surface-card rounded-card shadow-card p-3 mb-3 overflow-y-auto space-y-3">
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
            <div key={h.id} className={`flex ${h.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-card px-3 py-2 text-sm whitespace-pre-wrap ${
                h.role === 'user' ? 'bg-accent text-white' : 'bg-surface-container text-on-surface'
              }`}>
                {h.content}
              </div>
            </div>
          ))
        )}
        {enviando && (
          <div className="flex justify-start">
            <div className="bg-surface-container text-on-surface rounded-card px-3 py-2 text-sm flex items-center gap-2">
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
