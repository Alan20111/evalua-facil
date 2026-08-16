// Programa de estudios oficial de la asignatura — la BASE de todo el
// Asistente IA (decisión de Kike, 15-ago-2026: "un programa de estudios es
// la base de todo, de la planeación, de los temas, de los tiempos, de
// todo"). Por eso es un requisito aparte de "Fuentes del curso" (manuales,
// guías, material de apoyo — sigue siendo opcional/complementario) y un
// candado duro: sin programa subido, AsistenteIATab.jsx oculta el resto de
// la pestaña (Comentarios, Autoanálisis, Consideraciones, Diagnóstico del
// grupo, Planeación Inicial).
import { useEffect, useRef, useState } from 'react'
import { doc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { setDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import ConfirmModal from '../ConfirmModal'
import { uploadToCloudinary } from '../../utils/cloudinary'
import { Upload, Trash2, FileText, CheckCircle2 } from 'lucide-react'

const MAX_BYTES = 15 * 1024 * 1024

export default function ProgramaEstudiosSection({ subjectId, docenteId, onEstadoCargado }) {
  const toast = useToast()
  const [programaEstudios, setProgramaEstudios] = useState(null)
  const [cargado, setCargado] = useState(false)
  const inputRef = useRef(null)
  const [subiendo, setSubiendo] = useState(false)
  const [confirmarQuitar, setConfirmarQuitar] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), (snap) => {
      setProgramaEstudios(snap.exists() ? (snap.data().programaEstudios || null) : null)
      setCargado(true)
    }, () => { setProgramaEstudios(null); setCargado(true) })
    return unsub
  }, [subjectId])

  // Avisa al padre (AsistenteIATab) en cuanto se sabe si hay programa o no —
  // es lo que decide si se muestra el resto de la pestaña.
  useEffect(() => {
    if (cargado) onEstadoCargado?.(!!programaEstudios)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onEstadoCargado se redefine cada render, no es una dependencia real
  }, [cargado, programaEstudios])

  async function onArchivoSeleccionado(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    if (!esPdf) {
      toast('El programa de estudios debe ser un PDF', 'error')
      return
    }
    if (file.size > MAX_BYTES) {
      toast('El archivo pesa más de 15 MB', 'error')
      return
    }
    setSubiendo(true)
    try {
      const url = await uploadToCloudinary(file, 'evalua-facil/programas-estudio')
      await setDoc(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), {
        docenteId,
        programaEstudios: { nombre: file.name, tipo: 'pdf', url, subidoEn: serverTimestamp() },
      }, { merge: true })
      toast('Programa de estudios guardado — ya puedes usar el resto del Asistente IA')
    } catch (err) {
      toast('No se pudo subir el programa: ' + err.message, 'error')
    } finally {
      setSubiendo(false)
    }
  }

  async function quitarPrograma() {
    setSubiendo(true)
    try {
      await setDoc(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), { docenteId, programaEstudios: null }, { merge: true })
      toast('Programa de estudios quitado')
    } catch (err) {
      toast('No se pudo quitar: ' + err.message, 'error')
    } finally {
      setSubiendo(false)
      setConfirmarQuitar(false)
    }
  }

  if (!cargado) {
    return (
      <div className="bg-surface-card rounded-card shadow-card p-3 flex justify-center py-6">
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <h2 className="font-bold text-on-surface">Fuente Principal (programa de estudios)</h2>
      <p className="text-sm text-muted mt-0.5 mb-2">
        Sube el programa de estudios oficial de esta asignatura, en PDF — es la Fuente Principal: nada pesa
        más que ella al diseñar con el Asistente IA los temas, los tiempos, el diagnóstico del grupo y la
        Planeación. Sin ella, el resto de esta pestaña queda bloqueado.
      </p>

      {programaEstudios ? (
        <div className="flex items-center justify-between gap-2 p-2 rounded border border-green-200 bg-green-50 text-sm">
          <span className="flex items-center gap-1.5 text-on-surface min-w-0">
            <CheckCircle2 size={14} className="text-green-600 flex-shrink-0" />
            <FileText size={14} className="text-muted flex-shrink-0" />
            <strong className="truncate">{programaEstudios.nombre}</strong>
          </span>
          <button
            type="button"
            onClick={() => setConfirmarQuitar(true)}
            className="flex items-center gap-1 text-xs text-red-600 hover:underline flex-shrink-0"
          >
            <Trash2 size={12} /> Quitar
          </button>
        </div>
      ) : (
        <>
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={onArchivoSeleccionado} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={subiendo}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
          >
            {subiendo ? <Spinner size="sm" /> : <Upload size={14} />}
            Subir Fuente Principal (PDF)
          </button>
        </>
      )}

      {confirmarQuitar && (
        <ConfirmModal
          title="¿Quitar la Fuente Principal?"
          message="El resto de esta pestaña (Fuentes, Diagnóstico, Planeación...) se oculta hasta que subas uno de nuevo. Puedes volver a subirlo cuando quieras."
          confirmLabel="Quitar"
          confirmingLabel="Quitando…"
          busy={subiendo}
          onConfirm={quitarPrograma}
          onCancel={() => { if (!subiendo) setConfirmarQuitar(false) }}
        />
      )}
    </div>
  )
}
