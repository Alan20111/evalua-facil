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
import { FilePreviewModal } from '../AttachmentList'
import BotonDescargarArchivo from '../BotonDescargarArchivo'
import { PLANEACION_ACCEPT, extensionPlaneacion, validarArchivoPlaneacion } from '../../utils/planeacionVigente'
import { Upload, Trash2, FileText, CheckCircle2, Eye } from 'lucide-react'

export default function ProgramaEstudiosSection({ subjectId, docenteId, onEstadoCargado }) {
  const toast = useToast()
  const [programaEstudios, setProgramaEstudios] = useState(null)
  const [cargado, setCargado] = useState(false)
  const inputRef = useRef(null)
  const [subiendo, setSubiendo] = useState(false)
  const [confirmarQuitar, setConfirmarQuitar] = useState(false)
  const [verArchivo, setVerArchivo] = useState(false)

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
    // Mismas reglas que la planeación propia — PDF o Word (.docx), 15 MB, sin
    // archivos vacíos ni .doc antiguo — validadas por la MISMA función, no por
    // una copia (ver utils/planeacionVigente.js). Word se aceptó el
    // 1-sep-2026: el servidor ya lo leía sin cambios, porque todos los
    // consumidores del programa pasan por docExtract, que soporta pdf y docx
    // y decide por la extensión de la URL, no por el `tipo` guardado.
    const error = validarArchivoPlaneacion(file, 'El programa de estudios')
    if (error) {
      toast(error, 'error')
      return
    }
    setSubiendo(true)
    try {
      const url = await uploadToCloudinary(file, 'evalua-facil/programas-estudio')
      await setDoc(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), {
        docenteId,
        // `tipo` deja de estar fijo en 'pdf' y guarda el formato REAL, para
        // que la vista previa y la descarga respeten el archivo original.
        programaEstudios: { nombre: file.name, tipo: extensionPlaneacion(file.name), url, subidoEn: serverTimestamp() },
      }, { merge: true })
      toast('Programa de estudios guardado — ya puedes continuar con tu Planeación Didáctica')
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
        Sube el programa de estudios oficial de esta asignatura, en PDF o Word — es la Fuente Principal, y es
        obligatoria tanto si quieres que Evalúa Fácil genere tu planeación como si vas a subir la tuya. Sin
        ella, el resto de esta pestaña queda bloqueado. Podrás verlo y descargarlo cuando quieras.
      </p>

      {programaEstudios ? (
        <>
          <div className="flex items-center gap-1.5 p-2 rounded border border-green-200 bg-green-50 text-sm">
            <CheckCircle2 size={14} className="text-green-600 flex-shrink-0" />
            <FileText size={14} className="text-muted flex-shrink-0" />
            <strong className="truncate min-w-0 flex-1">{programaEstudios.nombre}</strong>
            <span className="text-xs text-muted uppercase flex-shrink-0">{programaEstudios.tipo}</span>
          </div>
          {/* Ver y Descargar (1-sep-2026): con el tiempo el docente ya no
              recuerda cuál documento subió, y hasta hoy solo veía el nombre.
              Se reutiliza el mismo visor de materiales, recursos y entregas
              (FilePreviewModal elige solo entre PDF y Word) y el mismo botón
              de descarga que la planeación propia — nada nuevo, y así las dos
              secciones se comportan igual. */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button
              type="button"
              onClick={() => setVerArchivo(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-on-surface text-sm hover:bg-[var(--accent-tint)]"
            >
              <Eye size={14} />
              Ver
            </button>
            <BotonDescargarArchivo
              url={programaEstudios.url}
              nombre={programaEstudios.nombre}
              onError={(mensaje) => toast(mensaje, 'error')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-on-surface text-sm hover:bg-[var(--accent-tint)] disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setConfirmarQuitar(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-300 text-red-700 text-sm hover:bg-red-50"
            >
              <Trash2 size={14} /> Quitar
            </button>
          </div>
          {verArchivo && (
            <FilePreviewModal
              url={programaEstudios.url}
              nombre={programaEstudios.nombre}
              onClose={() => setVerArchivo(false)}
            />
          )}
        </>
      ) : (
        <>
          <input ref={inputRef} type="file" accept={PLANEACION_ACCEPT} className="hidden" onChange={onArchivoSeleccionado} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={subiendo}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
          >
            {subiendo ? <Spinner size="sm" /> : <Upload size={14} />}
            Subir Fuente Principal (PDF o Word)
          </button>
        </>
      )}

      {confirmarQuitar && (
        <ConfirmModal
          title="¿Quitar la Fuente Principal?"
          message="El resto de esta pestaña (tu Planeación Didáctica, las fuentes y el diagnóstico) se oculta hasta que subas uno de nuevo. Puedes volver a subirlo cuando quieras."
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
