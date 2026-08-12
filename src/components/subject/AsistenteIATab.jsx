// Pestaña "Asistente IA" de la Asignatura (FASE 2-BIS del Plan Maestro de
// IA). Apartados implementados: Fuentes y Diagnóstico del grupo —
// Planeación Didáctica Inicial se agrega después.
import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { addDoc } from '../../utils/firestoreGuard'
import { auth, db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import { Paperclip, Trash2, FileText } from 'lucide-react'
import { MAX_FUENTES, MAX_FUENTE_BYTES, FUENTES_ACCEPT, subirFuentes } from '../../utils/fuentesIA'
import { tipoFuentePermitido, extensionDeArchivo, hayFuentesGenerales } from '../../utils/fuentesAsignatura'
import { apiUrl } from '../../utils/apiBase'
import DiagnosticoGrupoSection from './DiagnosticoGrupoSection'
import PlaneacionInicialSection from './PlaneacionInicialSection'

// Un grupo de fuentes (generales o de un parcial): lista + botón para subir
// hasta MAX_FUENTES a la vez. La subida es inmediata al elegir el archivo —
// no hay un paso de "guardar" aparte, igual que "Recursos".
function GrupoFuentes({ titulo, fuentes, onAgregar, onEliminar, subiendo, eliminandoId }) {
  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="font-semibold text-on-surface text-sm">{titulo}</h3>
        {fuentes.length < MAX_FUENTES ? (
          <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-dashed border-outline-variant text-xs sm:text-sm text-accent cursor-pointer hover:bg-[var(--accent-tint)] flex-shrink-0">
            {subiendo ? <Spinner size="sm" /> : <Paperclip size={14} />}
            Agregar fuentes
            <input
              type="file"
              accept={FUENTES_ACCEPT}
              multiple
              className="hidden"
              disabled={subiendo}
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                e.target.value = ''
                if (files.length) onAgregar(files)
              }}
            />
          </label>
        ) : (
          <span className="text-xs text-muted flex-shrink-0">Máximo {MAX_FUENTES} por carga</span>
        )}
      </div>

      {fuentes.length === 0 ? (
        <p className="text-xs text-muted">Sin fuentes todavía.</p>
      ) : (
        <div className="space-y-1.5">
          {fuentes.map((f) => (
            <div key={f.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-outline-variant bg-surface text-sm">
              <FileText size={14} className="text-muted flex-shrink-0" />
              <a href={f.url} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate hover:underline">
                {f.nombre}
              </a>
              <span className="text-xs text-muted uppercase flex-shrink-0">{f.tipo}</span>
              <button
                type="button"
                onClick={() => onEliminar(f.id)}
                disabled={eliminandoId === f.id}
                className="p-0.5 text-muted hover:text-red-500 flex-shrink-0"
                aria-label={`Eliminar ${f.nombre}`}
              >
                {eliminandoId === f.id ? <Spinner size="sm" /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AsistenteIATab({ subjectId, docenteId, parciales = 3, asignaturaNombre = '', subject = null, watermark = false }) {
  const toast = useToast()
  const [fuentes, setFuentes] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [subiendoGrupo, setSubiendoGrupo] = useState(null) // 'general' | numero de parcial | null
  const [eliminandoId, setEliminandoId] = useState(null)

  useEffect(() => {
    // Las reglas de fuentesAsignatura filtran por `docenteId` (privada del
    // dueño) — para un LIST/onSnapshot, Firestore exige que ese mismo campo
    // esté en un where() de la consulta para poder validar la regla contra
    // el resultado; sin él, la lectura entera se rechaza con
    // "Property docenteId is undefined" (bug real encontrado en producción
    // el 12-ago-2026: la fuente sí se guardaba, pero nunca aparecía en la
    // lista). Con `asignaturaId` + `docenteId`, ambos igualdad, no hace
    // falta un índice compuesto (restricción del proyecto: solo igualdades).
    const q = query(
      collection(db, 'fuentesAsignatura'),
      where('asignaturaId', '==', subjectId),
      where('docenteId', '==', docenteId)
    )
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      // Sin orderBy en la consulta (restricción del proyecto) — se ordena en
      // memoria, más recientes primero.
      items.sort((a, b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0))
      setFuentes(items)
      setLoaded(true)
    }, () => setLoaded(true))
    return unsub
  }, [subjectId, docenteId])

  async function agregarFuentes(grupo, ubicacion, parcial, files) {
    // El límite de MAX_FUENTES es POR CARGA (ver utils/fuentesIA.js), no un
    // tope total de la asignatura — la biblioteca puede seguir creciendo.
    if (files.length > MAX_FUENTES) {
      toast(`Puedes subir máximo ${MAX_FUENTES} archivos por carga`, 'error')
      return
    }
    const noPermitido = files.find((f) => !tipoFuentePermitido(f.name))
    if (noPermitido) {
      toast(`"${noPermitido.name}" no es PDF ni Word — solo se aceptan .pdf, .doc, .docx`, 'error')
      return
    }
    const muyGrande = files.find((f) => f.size > MAX_FUENTE_BYTES)
    if (muyGrande) {
      toast(`"${muyGrande.name}" supera el máximo de 15 MB`, 'error')
      return
    }

    setSubiendoGrupo(grupo)
    try {
      const subidas = await subirFuentes(files)
      await Promise.all(subidas.map((s) =>
        addDoc(collection(db, 'fuentesAsignatura'), {
          asignaturaId: subjectId,
          docenteId,
          nombre: s.nombre,
          tipo: extensionDeArchivo(s.nombre),
          ubicacion,
          parcial: ubicacion === 'parcial' ? parcial : null,
          url: s.url,
          tamano: s.tamano,
          creadoEn: serverTimestamp(),
        })
      ))
      toast(files.length > 1 ? 'Fuentes agregadas' : 'Fuente agregada')
    } catch (err) {
      toast('No se pudieron subir las fuentes: ' + err.message, 'error')
    } finally {
      setSubiendoGrupo(null)
    }
  }

  async function eliminarFuente(id) {
    setEliminandoId(id)
    try {
      // Pasa por el servidor (no deleteDoc directo): borrar en Cloudinary
      // exige CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET, que nunca viven en
      // el cliente — mismo patrón que api/subject/delete-resources.js. Sin
      // esto, el documento desaparecía de Firestore pero el PDF/Word se
      // quedaba huérfano en Cloudinary para siempre.
      const token = await auth.currentUser.getIdToken()
      const res = await fetch(apiUrl('/api/subject/delete-fuente'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fuenteId: id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo eliminar la fuente')
    } catch (err) {
      toast('No se pudo eliminar la fuente: ' + err.message, 'error')
    } finally {
      setEliminandoId(null)
    }
  }

  const generales = fuentes.filter((f) => f.ubicacion === 'general')
  const numerosParciales = Array.from({ length: parciales || 3 }, (_, i) => i + 1)

  if (!loaded) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-on-surface">Fuentes</h2>
        <p className="text-sm text-muted mt-0.5">
          Sube aquí el programa, materiales y documentos de la asignatura. Se
          guardan una sola vez y podrás reutilizarlos después al crear
          exámenes, cuestionarios, actividades y otras funciones de IA — no
          hace falta volver a subirlos cada vez. Formatos permitidos: PDF y
          Word, hasta {MAX_FUENTES} archivos por carga.
        </p>
      </div>

      <GrupoFuentes
        titulo="Fuentes iniciales generales"
        fuentes={generales}
        subiendo={subiendoGrupo === 'general'}
        eliminandoId={eliminandoId}
        onAgregar={(files) => agregarFuentes('general', 'general', null, files)}
        onEliminar={eliminarFuente}
      />

      {numerosParciales.map((p) => (
        <GrupoFuentes
          key={p}
          titulo={`Fuentes del Parcial ${p}`}
          fuentes={fuentes.filter((f) => f.ubicacion === 'parcial' && f.parcial === p)}
          subiendo={subiendoGrupo === p}
          eliminandoId={eliminandoId}
          onAgregar={(files) => agregarFuentes(p, 'parcial', p, files)}
          onEliminar={eliminarFuente}
        />
      ))}

      <div className="pt-2 border-t border-outline-variant">
        <DiagnosticoGrupoSection
          subjectId={subjectId}
          docenteId={docenteId}
          asignaturaNombre={asignaturaNombre}
          habilitado={hayFuentesGenerales(fuentes)}
        />
      </div>

      <div className="pt-2 border-t border-outline-variant">
        <PlaneacionInicialSection
          subjectId={subjectId}
          docenteId={docenteId}
          subject={subject}
          asignaturaNombre={asignaturaNombre}
          hayFuentesGenerales={hayFuentesGenerales(fuentes)}
          watermark={watermark}
        />
      </div>
    </div>
  )
}
