// "Comentarios generales del grupo y su entorno" — Asistente IA (12-ago-2026).
// Texto libre del docente sobre el grupo (no generado por IA). Va ARRIBA del
// Diagnóstico del grupo porque, junto con los diagnósticos, es lo que MÁS
// debe pesar al diseñar la Planeación Didáctica Inicial (y, a futuro, otras
// funciones de IA de la asignatura) — el docente lo escribe una sola vez y
// puede editarlo cuando quiera, como el Perfil IA.
import { useEffect, useState } from 'react'
import { doc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { setDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'

const PLACEHOLDER =
  'Ej. A simple vista apenas saben sumar. Nunca han usado más tecnología que el celular. ' +
  'Traen un nivel de conocimientos muy bajo. El grupo es muy participativo pero se distrae fácil...'

export default function ComentariosGrupoSection({ subjectId, docenteId }) {
  const toast = useToast()
  const [comentarios, setComentarios] = useState('')
  const [guardado, setGuardado] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), (snap) => {
      const texto = snap.exists() ? (snap.data().comentariosGrupo || '') : ''
      setComentarios(texto)
      setGuardado(texto)
      setLoaded(true)
    }, () => setLoaded(true))
    return unsub
  }, [subjectId])

  async function guardar() {
    setGuardando(true)
    try {
      await setDoc(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), {
        docenteId,
        comentariosGrupo: comentarios.trim(),
        actualizadoEn: serverTimestamp(),
      })
      setGuardado(comentarios.trim())
      toast('Comentarios guardados')
    } catch (err) {
      toast('No se pudieron guardar los comentarios: ' + err.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  if (!loaded) {
    return (
      <div className="bg-surface-card rounded-card shadow-card p-3 flex justify-center py-6">
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <h2 className="font-bold text-on-surface">Comentarios generales del grupo y su entorno</h2>
      <p className="text-sm text-muted mt-0.5 mb-2">
        Estos comentarios son de los que más pesan al diseñar la Planeación con IA — junto con los
        diagnósticos, más que las fuentes. Por ejemplo: &ldquo;a simple vista apenas saben sumar&rdquo;,
        &ldquo;nunca han usado más tecnología que el celular&rdquo;, &ldquo;traen un nivel de
        conocimientos muy bajo&rdquo;.
      </p>
      <textarea
        className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-y"
        rows={4}
        placeholder={PLACEHOLDER}
        value={comentarios}
        onChange={(e) => setComentarios(e.target.value)}
        maxLength={2000}
      />
      <button
        type="button"
        onClick={guardar}
        disabled={guardando || comentarios.trim() === guardado}
        className="mt-2 px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded transition-colors disabled:opacity-60 flex items-center gap-2"
      >
        {guardando && <Spinner size="sm" />}
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}
