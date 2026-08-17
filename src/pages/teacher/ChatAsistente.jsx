// Chat con Asistente — por asignatura (17-ago-2026). Primera versión:
// SOLO por asignatura, sin Asistente General, sin memoria permanente entre
// conversaciones (se pierde al cambiar de asignatura o recargar). El
// contexto lo arma el servidor en cada turno (precheckChatAsistente en
// functions/ia.js) — este componente solo manda subjectId + mensaje +
// historial reciente, nunca contenido pedagógico armado en el cliente.
import { useEffect, useRef, useState } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import { useCreditosIA } from '../../hooks/useCreditosIA'
import Spinner from '../../components/Spinner'
import Select from '../../components/ui/Select'
import Input from '../../components/ui/Input'
import { subjectDisplayName } from '../../utils/subjectName'
import { MessageCircle, Send, Sparkles } from 'lucide-react'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'

const SUGERENCIAS = [
  '¿Qué tema me sugieres trabajar en mi próxima clase?',
  '¿Qué puedo hacer para reforzar lo que estamos viendo?',
  '¿Cómo puedo mejorar mi próxima actividad?',
  '¿Qué me recomiendas para mi próxima sesión?',
  '¿Qué aspectos debería reforzar con este grupo?',
]

export default function ChatAsistente() {
  const { currentUser } = useAuth()
  const toast = useToast()
  const creditosIA = useCreditosIA()

  const [subjects, setSubjects] = useState([])
  const [subjectsLoaded, setSubjectsLoaded] = useState(false)
  const [subjectId, setSubjectId] = useState('')

  // Historial de la conversación ACTIVA — solo en memoria, se reinicia al
  // cambiar de asignatura (pedido explícito: nada de memoria permanente
  // todavía). Cada entrada: { role: 'user'|'assistant', content }.
  const [historial, setHistorial] = useState([])
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)
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
      // Selección inicial: la primera asignatura, si todavía no hay ninguna elegida.
      setSubjectId((actual) => actual || lista[0]?.id || '')
    })
    return unsub
  }, [currentUser])

  // Cambiar de asignatura = conversación nueva (pedido explícito).
  function cambiarAsignatura(id) {
    setSubjectId(id)
    setHistorial([])
    setMensaje('')
  }

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [historial, enviando])

  const costoPorMensaje = creditosIA.estimar('chat_asistente')
  const saldoAlcanza = costoPorMensaje == null || creditosIA.saldo >= costoPorMensaje

  async function enviar(textoForzado) {
    const texto = (textoForzado ?? mensaje).trim()
    if (!texto || !subjectId || enviando) return
    if (!saldoAlcanza) {
      toast(`No tienes créditos suficientes — necesitas ${costoPorMensaje} y tienes ${creditosIA.saldo}.`, 'error')
      return
    }
    const historialParaEnviar = historial.slice(-10) // el servidor igual lo vuelve a acotar; se evita mandar de más
    setHistorial((prev) => [...prev, { role: 'user', content: texto }])
    setMensaje('')
    setEnviando(true)
    try {
      const data = await creditosIA.ejecutar('chat_asistente', {
        subjectId, mensaje: texto, historial: historialParaEnviar,
      }, 1, { timeoutMs: 60000 })
      const respuesta = data?.resultado?.respuesta || ''
      setHistorial((prev) => [...prev, { role: 'assistant', content: respuesta || 'No obtuve una respuesta esta vez.' }])
    } catch (err) {
      if (err.codigo === 'SALDO_INSUFICIENTE') {
        toast(`No tienes créditos suficientes — necesitas ${err.costo ?? costoPorMensaje} y tienes ${err.saldo ?? creditosIA.saldo}.`, 'error')
      } else if (err.codigo === 'PERFIL_IA_INCOMPLETO') {
        toast('Completa primero tu Perfil para IA del docente para usar el Chat con Asistente.', 'error')
      } else {
        toast(err.message || 'El asistente de IA no está disponible en este momento', 'error')
      }
      // La pregunta del docente se queda visible en el historial (no se
      // pierde lo que escribió), pero sin respuesta — puede reintentar.
    } finally {
      setEnviando(false)
    }
  }

  const asignaturaActual = subjects.find((s) => s.id === subjectId)

  return (
    <div className={`px-4 sm:px-5 lg:px-6 py-4 ${TEACHER_CONTAINER_NARROW} flex flex-col`} style={{ minHeight: 'calc(100dvh - 2rem)' }}>
      <div className="flex items-center gap-2 mb-3">
        <MessageCircle size={22} className="text-accent flex-shrink-0" />
        <h1 className="text-lg font-bold text-on-surface">Chat con Asistente</h1>
      </div>

      {/* Selector de asignatura — cambiarla reinicia la conversación. */}
      <div className="mb-3">
        {!subjectsLoaded ? (
          <div className="flex items-center gap-2 text-sm text-muted"><Spinner size="sm" /> Cargando asignaturas…</div>
        ) : subjects.length === 0 ? (
          <p className="text-sm text-muted">Aún no tienes asignaturas — crea una primero para poder conversar sobre ella.</p>
        ) : (
          <Select
            id="chat-asignatura"
            label="Asignatura"
            value={subjectId}
            onChange={cambiarAsignatura}
            options={subjects.map((s) => ({ value: s.id, label: subjectDisplayName(s) }))}
          />
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

      {subjectId && (
        <>
          {/* Conversación */}
          <div className="flex-1 bg-surface-card rounded-card shadow-card p-3 mb-3 overflow-y-auto space-y-3">
            {historial.length === 0 && !enviando && (
              <div className="h-full flex flex-col items-center justify-center text-center py-6 gap-3">
                <Sparkles size={28} className="text-accent" />
                <p className="text-sm text-muted max-w-sm">
                  Pregúntame sobre <strong className="text-on-surface">{asignaturaActual ? subjectDisplayName(asignaturaActual) : 'esta asignatura'}</strong> — uso su planeación, fechas, diagnósticos y resultados que ya tienes registrados.
                </p>
                <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                  {SUGERENCIAS.map((s) => (
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
            )}
            {historial.map((h, i) => (
              <div key={i} className={`flex ${h.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-card px-3 py-2 text-sm whitespace-pre-wrap ${
                  h.role === 'user' ? 'bg-accent text-white' : 'bg-surface-container text-on-surface'
                }`}>
                  {h.content}
                </div>
              </div>
            ))}
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
        </>
      )}
    </div>
  )
}
