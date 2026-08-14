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
import { tipoFuentePermitido, extensionDeArchivo, hayFuentesGenerales, MAX_FUENTES_POR_GRUPO } from '../../utils/fuentesAsignatura'
import { apiUrl } from '../../utils/apiBase'
import ComentariosGrupoSection from './ComentariosGrupoSection'
import AutoanalisisDocenteSection from './AutoanalisisDocenteSection'
import DiagnosticoGrupoSection from './DiagnosticoGrupoSection'
import PlaneacionInicialSection from './PlaneacionInicialSection'

// Las fuentes generales del curso: lista + botón para subir hasta
// MAX_FUENTES a la vez, con un tope de MAX_FUENTES_POR_GRUPO documentos
// guardados en total (decisión de Kike, 12-ago-2026: 1 a 10). La subida es
// inmediata al elegir el archivo — no hay un paso de "guardar" aparte,
// igual que "Recursos". No hay grupo "por parcial" aquí (13-ago-2026,
// corregido el mismo día): sería redundante con "Material de apoyo" (tab
// Actividades → por parcial, `materials` en Firestore), que ya es donde el
// docente sube documentos específicos de cada parcial — la IA lee de ahí
// (ver bloqueFuentesPermanentes en functions/ia.js), sin duplicar el lugar.
function GrupoFuentes({ titulo, fuentes, onAgregar, onEliminar, subiendo, eliminandoId }) {
  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="font-semibold text-on-surface text-sm">{titulo}</h3>
        {fuentes.length < MAX_FUENTES_POR_GRUPO ? (
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
          <span className="text-xs text-muted flex-shrink-0">Máximo {MAX_FUENTES_POR_GRUPO} documentos en este grupo</span>
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

export default function AsistenteIATab({ subjectId, docenteId, asignaturaNombre = '', subject = null, watermark = false, existingActivitiesCountP1 = 0 }) {
  const toast = useToast()
  const [fuentes, setFuentes] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
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

  async function agregarFuentes(files) {
    // El límite de MAX_FUENTES es POR CARGA (ver utils/fuentesIA.js) — aparte
    // está el tope de la BIBLIOTECA del grupo, MAX_FUENTES_POR_GRUPO (1 a 10
    // documentos guardados en total, decisión de Kike 12-ago-2026).
    if (files.length > MAX_FUENTES) {
      toast(`Puedes subir máximo ${MAX_FUENTES} archivos por carga`, 'error')
      return
    }
    const existentesEnGrupo = fuentes.filter((f) => f.ubicacion === 'general').length
    if (existentesEnGrupo + files.length > MAX_FUENTES_POR_GRUPO) {
      toast(`Este grupo admite máximo ${MAX_FUENTES_POR_GRUPO} documentos en total (ya tiene ${existentesEnGrupo})`, 'error')
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

    setSubiendo(true)
    try {
      const subidas = await subirFuentes(files)
      await Promise.all(subidas.map((s) =>
        addDoc(collection(db, 'fuentesAsignatura'), {
          asignaturaId: subjectId,
          docenteId,
          nombre: s.nombre,
          tipo: extensionDeArchivo(s.nombre),
          ubicacion: 'general',
          parcial: null,
          url: s.url,
          tamano: s.tamano,
          creadoEn: serverTimestamp(),
        })
      ))
      toast(files.length > 1 ? 'Fuentes agregadas' : 'Fuente agregada')
    } catch (err) {
      toast('No se pudieron subir las fuentes: ' + err.message, 'error')
    } finally {
      setSubiendo(false)
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
          Word, hasta {MAX_FUENTES} archivos por carga y {MAX_FUENTES_POR_GRUPO} documentos en total por grupo.
        </p>
      </div>

      <GrupoFuentes
        titulo="Fuentes para todo el curso"
        fuentes={generales}
        subiendo={subiendo}
        eliminandoId={eliminandoId}
        onAgregar={agregarFuentes}
        onEliminar={eliminarFuente}
      />

      <div className="pt-2 border-t border-outline-variant">
        <ComentariosGrupoSection subjectId={subjectId} docenteId={docenteId} />
      </div>

      <div>
        <AutoanalisisDocenteSection subjectId={subjectId} docenteId={docenteId} />
      </div>

      <div>
        <DiagnosticoGrupoSection
          subjectId={subjectId}
          docenteId={docenteId}
          asignaturaNombre={asignaturaNombre}
          habilitado={hayFuentesGenerales(fuentes)}
          existingActivitiesCountP1={existingActivitiesCountP1}
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
