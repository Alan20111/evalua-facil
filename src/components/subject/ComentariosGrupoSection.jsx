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
  'Escribe información real sobre tu grupo y su entorno que quieras que la IA tome en cuenta ' +
  'al adaptar diagnósticos, actividades y planeación. Ej. Les cuesta trabajar en equipo. Casi no ' +
  'usan calculadora ni computadora en casa. Responden mejor con ejemplos de la vida diaria que ' +
  'con teoría. Algunos faltan seguido por trabajar con la familia...'

export default function ComentariosGrupoSection({ subjectId, docenteId }) {
  const toast = useToast()
  const [comentarios, setComentarios] = useState('')
  const [guardado, setGuardado] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [guardando, setGuardando] = useState(false)
  // Palomeado por el docente (Kike, 14-ago-2026): además de opcional para
  // generar, cada insumo se marca desde SU PROPIA tarjeta — no en un modal
  // aparte — para que quede claro ahí mismo que es opcional y si se va a usar.
  // Por omisión true (si el campo no existe todavía, se incluye).
  const [incluir, setIncluir] = useState(true)
  const [guardandoIncluir, setGuardandoIncluir] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), (snap) => {
      const texto = snap.exists() ? (snap.data().comentariosGrupo || '') : ''
      setComentarios(texto)
      setGuardado(texto)
      setIncluir(snap.data()?.incluirEnPlaneacion?.comentarios !== false)
      setLoaded(true)
    }, () => setLoaded(true))
    return unsub
  }, [subjectId])

  async function toggleIncluir(checked) {
    setIncluir(checked)
    setGuardandoIncluir(true)
    try {
      await setDoc(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), {
        docenteId,
        incluirEnPlaneacion: { comentarios: checked },
      }, { merge: true })
    } catch (err) {
      setIncluir(!checked)
      toast('No se pudo guardar: ' + err.message, 'error')
    } finally {
      setGuardandoIncluir(false)
    }
  }

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
        Pesan mucho al diseñar la Planeación con IA — junto con los diagnósticos.
      </p>
      <textarea
        className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-y"
        rows={4}
        placeholder={PLACEHOLDER}
        value={comentarios}
        onChange={(e) => setComentarios(e.target.value)}
        maxLength={2000}
      />
      <div className="flex items-center justify-between gap-2 mt-2">
        <button
          type="button"
          onClick={guardar}
          disabled={guardando || comentarios.trim() === guardado}
          className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded transition-colors disabled:opacity-60 flex items-center gap-2"
        >
          {guardando && <Spinner size="sm" />}
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-on-surface cursor-pointer select-none flex-shrink-0">
          <input
            type="checkbox"
            checked={incluir}
            disabled={guardandoIncluir}
            onChange={(e) => toggleIncluir(e.target.checked)}
          />
          Incluir en la Planeación
        </label>
      </div>
    </div>
  )
}
