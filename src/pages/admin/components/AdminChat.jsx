// Chat de Administración — "Inteligencia de Evalúa Fácil" (19-ago-2026).
//
// Distinto del Chat con Asistente del docente (src/pages/teacher/ChatAsistente.jsx):
// no hay asignaturas, no hay créditos, no hay propuestas de acción, no hay
// límite de interacciones — es un solo hilo de conversación por admin,
// respaldado por el callable `chatAdmin` (functions/adminChat.js), que
// consulta datos reales de la plataforma con herramientas acotadas y NUNCA
// inventa cifras. Primera versión: SOLO LECTURA.
//
// Reutiliza el PATRÓN de persistencia de chatMensajes (un doc por mensaje,
// se conserva hasta que el usuario borra la conversación) pero con su propia
// colección `adminChatMensajes` — no comparte datos con el chat del docente.
import { useEffect, useRef, useState } from 'react'
import { collection, query, where, onSnapshot, addDoc, writeBatch, doc, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../../../firebase'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import AdminChatMensaje from '../../../components/AdminChatMensaje'
import { BrainCircuit, Send, Trash2 } from 'lucide-react'

const SUGERENCIAS = [
  '¿Cómo va Evalúa Fácil?',
  '¿Cuántos usuarios tenemos?',
  '¿Cuánto hemos facturado este mes?',
  '¿Cómo está el consumo de IA?',
  '¿Qué plan está funcionando mejor?',
]

export default function AdminChat() {
  const { currentUser } = useAuth()
  const toast = useToast()
  const [historial, setHistorial] = useState([])
  const [historialCargado, setHistorialCargado] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [confirmarBorrar, setConfirmarBorrar] = useState(false)
  const finRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    if (!currentUser) return undefined
    const q = query(collection(db, 'adminChatMensajes'), where('adminUid', '==', currentUser.uid))
    const unsub = onSnapshot(q, (snap) => {
      const lista = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.creadoEnMillis || 0) - (b.creadoEnMillis || 0))
      setHistorial(lista)
      setHistorialCargado(true)
    }, () => setHistorialCargado(true))
    return unsub
  }, [currentUser])

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [historial, enviando])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [mensaje])

  async function guardarMensaje(role, content, creadoEnMillis) {
    await addDoc(collection(db, 'adminChatMensajes'), {
      adminUid: currentUser.uid, role, content, creadoEnMillis, creadoEn: serverTimestamp(),
    })
  }

  async function enviar(textoForzado) {
    const texto = (textoForzado ?? mensaje).trim()
    if (!texto || enviando) return
    const historialParaEnviar = historial.slice(-10).map((h) => ({ role: h.role, content: h.content }))
    setMensaje('')
    setEnviando(true)
    try {
      // eslint-disable-next-line react-hooks/purity -- Date.now() solo corre dentro de este handler async, disparado por el submit del docente/admin, nunca durante el render (mismo patrón que ChatAsistente.jsx)
      await guardarMensaje('user', texto, Date.now())
      const chatAdmin = httpsCallable(functions, 'chatAdmin', { timeout: 60000 })
      const { data } = await chatAdmin({ mensaje: texto, historial: historialParaEnviar })
      // eslint-disable-next-line react-hooks/purity -- ver comentario arriba
      await guardarMensaje('assistant', data?.respuesta || 'No obtuve una respuesta esta vez.', Date.now())
    } catch (err) {
      const msg = err?.message || 'No se pudo completar la consulta'
      // eslint-disable-next-line react-hooks/purity -- ver comentario arriba
      await guardarMensaje('assistant', `No pude completar esa consulta: ${msg}`, Date.now())
      toast(msg, 'error')
    } finally {
      setEnviando(false)
    }
  }

  async function borrarConversacion() {
    setConfirmarBorrar(false)
    try {
      const batch = writeBatch(db)
      historial.forEach((h) => batch.delete(doc(db, 'adminChatMensajes', h.id)))
      await batch.commit()
      toast('Conversación borrada')
    } catch (err) {
      toast('No se pudo borrar la conversación: ' + err.message, 'error')
    }
  }

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: 'calc(100dvh - 11rem)' }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <BrainCircuit size={22} className="text-accent flex-shrink-0" />
          <div>
            <h2 className="text-lg font-bold text-on-surface leading-tight">Inteligencia de Evalúa Fácil</h2>
            <p className="text-xs text-muted">Solo consulta — no modifica datos. Distinto del Chat del docente.</p>
          </div>
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
              title="Nueva conversación"
              className="flex-shrink-0 p-2.5 rounded border border-outline-variant text-muted hover:text-error hover:border-error/40 transition-colors"
            >
              <Trash2 size={16} />
            </button>
          )
        )}
      </div>

      <div className="flex-1 min-h-0 bg-surface-card rounded-card shadow-card p-3 mb-3 overflow-y-auto space-y-3">
        {!historialCargado ? (
          <div className="h-full flex items-center justify-center"><Spinner size="sm" /></div>
        ) : historial.length === 0 && !enviando ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-6 gap-3">
            <BrainCircuit size={28} className="text-accent" />
            <p className="text-sm text-muted max-w-sm">
              Pregunta sobre usuarios, planes, ingresos, consumo de IA o uso del Chat — respondo con datos reales de la plataforma, nunca inventados.
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center max-w-md">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => enviar(s)}
                  className="text-xs px-2.5 py-1.5 rounded-full border border-outline-variant text-muted hover:border-accent hover:text-accent transition-colors"
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
                <div className={`max-w-[85%] rounded-card px-3 py-2 text-sm ${
                  h.role === 'user' ? 'bg-accent text-white whitespace-pre-wrap' : 'bg-surface-container text-on-surface'
                }`}>
                  {h.role === 'user' ? h.content : <AdminChatMensaje texto={h.content} />}
                </div>
              </div>
            </div>
          ))
        )}
        {enviando && (
          <div className="flex justify-start">
            <div className="bg-surface-container text-on-surface rounded-card px-3 py-2 text-base flex items-center gap-2">
              <Spinner size="sm" /> Consultando…
            </div>
          </div>
        )}
        <div ref={finRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); enviar() }} className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (!enviando && mensaje.trim()) enviar()
            }
          }}
          placeholder="Pregunta sobre el negocio…"
          disabled={enviando}
          maxLength={2000}
          rows={1}
          className="flex-1 w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none max-h-32 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={enviando || !mensaje.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white font-semibold text-sm rounded transition-colors disabled:opacity-45"
        >
          {enviando ? <Spinner size="sm" /> : <Send size={16} />}
          Enviar
        </button>
      </form>
    </div>
  )
}
