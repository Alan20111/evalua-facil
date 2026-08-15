// "Consideraciones (opcional)" — Asistente IA (14-ago-2026, pedido de Kike:
// separar esta pregunta del Autoanálisis Docente, porque no es sobre el
// docente ni sobre el grupo, sino sobre cómo quiere que la Planeación
// Didáctica Inicial sea realmente utilizable durante el curso). Tiene su
// propio checkbox de "incluir en la Planeación", igual que las demás
// tarjetas de insumos.
import { useEffect, useState } from 'react'
import { doc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { setDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'

const PREGUNTA = '¿Qué quieres agregar que consideres relevante para que la planeación didáctica pueda ser realmente utilizada durante este curso?'
const MAX_LARGO = 500

export default function ConsideracionesSection({ subjectId, docenteId }) {
  const toast = useToast()
  const [texto, setTexto] = useState('')
  const [guardado, setGuardado] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [incluir, setIncluir] = useState(true)
  const [guardandoIncluir, setGuardandoIncluir] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), (snap) => {
      const valor = String(snap.data()?.consideraciones || '').trim()
      setTexto(valor)
      setGuardado(valor)
      setIncluir(snap.data()?.incluirEnPlaneacion?.consideraciones !== false)
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
        incluirEnPlaneacion: { consideraciones: checked },
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
      const limpio = texto.trim()
      await setDoc(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), {
        docenteId,
        consideraciones: limpio,
        actualizadoEn: serverTimestamp(),
      }, { merge: true })
      setTexto(limpio)
      setGuardado(limpio)
      toast('Consideraciones guardadas')
    } catch (err) {
      toast('No se pudo guardar: ' + err.message, 'error')
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
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-bold text-on-surface">Consideraciones</h2>
        <label className="flex items-center gap-1.5 text-xs text-on-surface cursor-pointer select-none flex-shrink-0 pt-0.5">
          <input
            type="checkbox"
            checked={incluir}
            disabled={guardandoIncluir}
            onChange={(e) => toggleIncluir(e.target.checked)}
          />
          Incluir en la Planeación
        </label>
      </div>
      <label htmlFor="consideraciones-texto" className="block text-sm text-on-surface mt-1.5 mb-1">{PREGUNTA}</label>
      <textarea
        id="consideraciones-texto"
        className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-y"
        rows={2}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={MAX_LARGO}
      />
      <button
        type="button"
        onClick={guardar}
        disabled={guardando || texto.trim() === guardado}
        className="mt-2 px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded transition-colors disabled:opacity-60 flex items-center gap-2"
      >
        {guardando && <Spinner size="sm" />}
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}
