// Plantilla oficial de la escuela: el docente sube el formato real de su
// plantel (Word o Excel, vacío, con su logo) — nada más. La IA analiza sola
// la estructura de la plantilla al generar (ver PlaneacionInicialSection.jsx
// → generarFormatoOficial) y decide qué casillas llenar, sin que el docente
// tenga que marcar nada aquí.
import { useEffect, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { setDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import ConfirmModal from '../ConfirmModal'
import { uploadToCloudinary } from '../../utils/cloudinary'
import { tipoDePlantilla } from '../../utils/plantillaOficial'
import { Upload, Trash2, FileText } from 'lucide-react'

const MAX_BYTES = 8 * 1024 * 1024

export default function PlantillaOficialSection({ subjectId, docenteId }) {
  const toast = useToast()
  const [plantillaOficial, setPlantillaOficial] = useState(null)
  const [cargado, setCargado] = useState(false)
  const inputRef = useRef(null)
  const [subiendo, setSubiendo] = useState(false)
  const [confirmarQuitar, setConfirmarQuitar] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), (snap) => {
      setPlantillaOficial(snap.exists() ? (snap.data().plantillaOficial || null) : null)
      setCargado(true)
    }, () => { setPlantillaOficial(null); setCargado(true) })
    return unsub
  }, [subjectId])

  async function onArchivoSeleccionado(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const tipo = tipoDePlantilla(file.name)
    if (!tipo) {
      toast('Sube un archivo de Word (.docx) o Excel (.xlsx) — no un documento escaneado ni un PDF', 'error')
      return
    }
    if (file.size > MAX_BYTES) {
      toast('El archivo pesa más de 8 MB', 'error')
      return
    }
    setSubiendo(true)
    try {
      const url = await uploadToCloudinary(file, 'evalua-facil/plantillas-oficiales')
      await setDoc(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), {
        docenteId,
        plantillaOficial: { nombre: file.name, tipo, url },
      }, { merge: true })
      toast('Plantilla guardada — ya puedes generar la Planeación en este formato')
    } catch (err) {
      toast('No se pudo subir la plantilla: ' + err.message, 'error')
    } finally {
      setSubiendo(false)
    }
  }

  async function quitarPlantilla() {
    setSubiendo(true)
    try {
      await setDoc(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), { docenteId, plantillaOficial: null }, { merge: true })
      toast('Plantilla oficial quitada')
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
      <h2 className="font-bold text-on-surface">Formato oficial de mi escuela</h2>
      <p className="text-sm text-muted mt-0.5 mb-2">
        Sube la plantilla real de tu plantel — Word o Excel, vacía, con su logo. Nunca un PDF ni un documento
        escaneado. La IA la analiza y la llena sola, en el mismo formato, cada vez que generes la Planeación.
        Recomendado: si tu plantel te da a elegir, súbela en Word — su vista previa se ve mucho mejor.
      </p>

      {plantillaOficial ? (
        <div className="flex items-center justify-between gap-2 p-2 rounded border border-outline-variant text-sm">
          <span className="flex items-center gap-1.5 text-on-surface">
            <FileText size={14} className="text-muted flex-shrink-0" />
            <strong>{plantillaOficial.nombre}</strong>
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
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.docx,.doc" className="hidden" onChange={onArchivoSeleccionado} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={subiendo}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
          >
            {subiendo ? <Spinner size="sm" /> : <Upload size={14} />}
            Subir plantilla de mi escuela
          </button>
        </>
      )}

      {confirmarQuitar && (
        <ConfirmModal
          title="¿Quitar la plantilla oficial?"
          message="Ya no vas a poder generar la Planeación en el formato de tu escuela — vuelve al Word genérico. Puedes volver a subirla cuando quieras."
          confirmLabel="Quitar"
          confirmingLabel="Quitando…"
          busy={subiendo}
          onConfirm={quitarPlantilla}
          onCancel={() => { if (!subiendo) setConfirmarQuitar(false) }}
        />
      )}
    </div>
  )
}
