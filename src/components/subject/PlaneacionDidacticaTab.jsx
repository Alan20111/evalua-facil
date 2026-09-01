// Pestaña "Planeación Didáctica" de la Asignatura.
//
// Se llamaba "Config Asistente IA" hasta el 1-sep-2026. Cambió de nombre y de
// orden porque el nombre viejo mentía: desde que el docente puede subir su
// propia planeación en PDF/Word, la IA es UNO de los dos caminos, no el
// único. Un docente que ya trae su planeación hecha no tiene por qué entrar a
// "configurar un asistente de IA" ni recorrer sus insumos.
//
// El orden es la regla de negocio hecha pantalla:
//
//   1. "Documentos de la Asignatura" — el programa de estudios (OBLIGATORIO,
//      sin él no se muestra nada más) y el material complementario del curso.
//      Los dos son documentos GLOBALES de la asignatura, privados del docente
//      y solo para la IA: por eso viven juntos. El material complementario
//      estaba hasta el 1-sep-2026 dentro de los insumos de IA, donde se leía
//      como una tarea de la planeación cuando en realidad no lo es.
//   2. Planeación Didáctica — la bifurcación: generarla con IA o subir la
//      propia. Va aquí, inmediatamente después de lo obligatorio, para que
//      quien solo quiere subir su archivo no tenga que atravesar nada más.
//   3. "Información adicional para generar con IA" — Comentarios,
//      Autoanálisis, Consideraciones y Diagnóstico del grupo. Son INSUMOS del
//      camino de IA, nunca requisitos del docente.
//
// El material complementario NO se movió de colección ni cambió de forma:
// sigue siendo `fuentesAsignatura` con `ubicacion:'general'`, y las cinco
// operaciones que lo consumen (crear actividad, crear examen/cuestionario,
// reactivos, planeación y diagnósticos) lo siguen leyendo EN VIVO en cada
// ejecución — no hay copia ni caché en ningún lado, así que agregar o quitar
// un documento hoy cambia lo que la IA usará mañana, sin regenerar nada.
// Los materiales de un parcial concreto siguen siendo otra cosa: `materials`
// con su `parcial`, en Actividades.
//
// El Perfil IA ya no hace falta para entrar aquí (ver SubjectPage): es
// requisito solo de las operaciones que de verdad usan IA, que lo avisan en
// su propio botón y que el servidor revalida.
import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { addDoc } from '../../utils/firestoreGuard'
import { auth, db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import { Paperclip, Trash2, FileText, Eye } from 'lucide-react'
import { FilePreviewModal } from '../AttachmentList'
import BotonDescargarArchivo from '../BotonDescargarArchivo'
import { MAX_FUENTES, MAX_FUENTE_BYTES, FUENTES_ACCEPT, subirFuentes } from '../../utils/fuentesIA'
import { tipoFuentePermitido, extensionDeArchivo, hayFuentesGenerales, MAX_FUENTES_POR_GRUPO } from '../../utils/fuentesAsignatura'
import { apiUrl } from '../../utils/apiBase'
import ComentariosGrupoSection from './ComentariosGrupoSection'
import AutoanalisisDocenteSection from './AutoanalisisDocenteSection'
import ConsideracionesSection from './ConsideracionesSection'
import DiagnosticoGrupoSection from './DiagnosticoGrupoSection'
import PlaneacionInicialSection from './PlaneacionInicialSection'
import ProgramaEstudiosSection from './ProgramaEstudiosSection'

// Las fuentes generales del curso: lista + botón para subir hasta
// MAX_FUENTES a la vez, con un tope de MAX_FUENTES_POR_GRUPO documentos
// guardados en total (decisión de Kike, 12-ago-2026: 1 a 10). La subida es
// inmediata al elegir el archivo — no hay un paso de "guardar" aparte,
// igual que "Recursos". No hay grupo "por parcial" aquí (13-ago-2026,
// corregido el mismo día): sería redundante con "Material de apoyo" (tab
// Actividades → por parcial, `materials` en Firestore), que ya es donde el
// docente sube documentos específicos de cada parcial — la IA lee de ahí
// (ver bloqueFuentesPermanentes en functions/ia.js), sin duplicar el lugar.
function GrupoFuentes({ titulo, descripcion, fuentes, onAgregar, onEliminar, onVer, subiendo, eliminandoId }) {
  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h2 className="font-bold text-on-surface">{titulo}</h2>
          {descripcion && <p className="text-sm text-muted mt-0.5">{descripcion}</p>}
        </div>
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
              <span className="flex-1 min-w-0 truncate">{f.nombre}</span>
              <span className="text-xs text-muted uppercase flex-shrink-0">{f.tipo}</span>
              {/* Ver y Descargar (1-sep-2026): hasta hoy el nombre era un
                  enlace crudo a Cloudinary — en la app abría el navegador del
                  sistema y en la web no forzaba la descarga. Ahora usa el
                  mismo visor (FilePreviewModal, PDF y Word) y el mismo botón
                  de descarga (web + panel Compartir de Android) que el
                  programa de estudios y la planeación propia. */}
              <button
                type="button"
                onClick={() => onVer(f)}
                data-tooltip="Ver"
                aria-label={`Ver ${f.nombre}`}
                className="p-0.5 text-muted hover:text-accent flex-shrink-0"
              >
                <Eye size={14} />
              </button>
              <BotonDescargarArchivo
                url={f.url}
                nombre={f.nombre}
                etiqueta=""
                title="Descargar"
                className="p-0.5 text-muted hover:text-accent flex-shrink-0 disabled:opacity-60"
              />
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

export default function PlaneacionDidacticaTab({ subjectId, docenteId, asignaturaNombre = '', subject = null, watermark = false, perfilIACompleto = false, existingActivitiesCountP1 = 0 }) {
  const toast = useToast()
  const [fuentes, setFuentes] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [eliminandoId, setEliminandoId] = useState(null)
  // El programa de estudios es la BASE de todo el Asistente IA (decisión de
  // Kike, 15-ago-2026) — sin él, el resto de la pestaña queda oculto. Null
  // = todavía sin saber (ProgramaEstudiosSection no ha reportado su
  // estado); true/false = ya se sabe.
  const [programaListo, setProgramaListo] = useState(null)
  // Camino de trabajo que reporta PlaneacionInicialSection (ver la derivación
  // ahí): 'ia' | 'propio' | null (no ha elegido) | undefined (todavía no se
  // sabe). Decide si los insumos de IA se montan — no hay ningún dato nuevo
  // en Firestore detrás de esto.
  const [camino, setCamino] = useState(undefined)
  // Material complementario que el docente está viendo en el visor compartido
  // (null = ninguno). Mismo FilePreviewModal que usan materiales, recursos,
  // entregas, el programa de estudios y la planeación propia.
  const [fuenteVista, setFuenteVista] = useState(null)

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
      {/* 1. DOCUMENTOS DE LA ASIGNATURA — el programa (obligatorio) y el
          material complementario del curso. Los dos son documentos globales
          de la asignatura, privados del docente y solo para la IA. */}
      <div className="px-1">
        <h2 className="font-bold text-on-surface">Documentos de la Asignatura</h2>
      </div>

      <ProgramaEstudiosSection subjectId={subjectId} docenteId={docenteId} onEstadoCargado={setProgramaListo} />

      {programaListo === null ? (
        <div className="flex justify-center py-6"><Spinner size="sm" /></div>
      ) : !programaListo ? (
        <p className="text-sm text-muted px-1">
          Sube primero el programa de estudios (arriba). Con él podrás continuar con tu
          Planeación Didáctica: generarla con Evalúa Fácil o subir la que ya tienes.
        </p>
      ) : (
        <>
          {/* El material complementario vive AQUÍ, no entre los insumos de
              IA: es un documento de la asignatura, no una tarea de la
              planeación. La colección y su forma no cambiaron. */}
          <GrupoFuentes
            titulo="Material complementario del curso"
            descripcion={`Material complementario del curso (manuales, guías) — opcional, aparte del programa de estudios. La IA lo usa al proponerte actividades, exámenes y reactivos, y al generar tu planeación y tus diagnósticos. Para material de un parcial concreto, súbelo en Actividades → ese parcial → Material de apoyo. PDF o Word, hasta ${MAX_FUENTES} por carga y ${MAX_FUENTES_POR_GRUPO} en total.`}
            fuentes={generales}
            subiendo={subiendo}
            eliminandoId={eliminandoId}
            onAgregar={agregarFuentes}
            onEliminar={eliminarFuente}
            onVer={setFuenteVista}
          />

          {/* 2. La Planeación Didáctica, justo después de lo obligatorio: es
              a lo que el docente viene, y desde aquí elige su camino sin
              tener que recorrer antes ningún insumo de IA. */}
          <div>
            <PlaneacionInicialSection
              subjectId={subjectId}
              docenteId={docenteId}
              subject={subject}
              asignaturaNombre={asignaturaNombre}
              hayFuentesGenerales
              perfilIACompleto={perfilIACompleto}
              onCaminoCambiado={setCamino}
              watermark={watermark}
            />
          </div>

          {/* 3. Insumos del CAMINO DE IA. No se renderizan en ningún otro
              camino — y es montaje real, no `hidden` por CSS: en el camino de
              la planeación propia estos componentes ni se montan, así que sus
              onSnapshot sobre asistenteIA/config, fuentesAsignatura y los
              diagnósticos tampoco se abren.

              `camino === undefined` significa "todavía no se sabe" (la
              Planeación aún está cargando su historial): tratarlo como
              "ninguno" haría parpadear estos bloques ante el docente que va
              por su propia planeación. Por eso la comparación es estricta
              contra 'ia' y no una negación.

              Ninguno de estos componentes cambió por dentro: siguen guardando
              donde siempre. El material complementario ya NO está aquí: subió
              a "Documentos de la Asignatura", porque es un documento del curso
              y no un insumo exclusivo de la generación con IA. */}
          {camino === 'ia' && (
            <>
              <div className="pt-3 border-t border-outline-variant">
                <h2 className="font-bold text-on-surface">Información adicional para generar con IA</h2>
                <p className="text-sm text-muted mt-0.5">
                  Entre más le des, mejor será la planeación que genere Evalúa Fácil.
                </p>
              </div>

              <div>
                <ComentariosGrupoSection subjectId={subjectId} docenteId={docenteId} />
              </div>

              <div>
                <AutoanalisisDocenteSection subjectId={subjectId} docenteId={docenteId} />
              </div>

              <div>
                <ConsideracionesSection subjectId={subjectId} docenteId={docenteId} />
              </div>

              <div>
                <DiagnosticoGrupoSection
                  subjectId={subjectId}
                  docenteId={docenteId}
                  asignaturaNombre={asignaturaNombre}
                  habilitado
                  perfilIACompleto={perfilIACompleto}
                  existingActivitiesCountP1={existingActivitiesCountP1}
                />
              </div>
            </>
          )}
        </>
      )}

      {fuenteVista && (
        <FilePreviewModal
          url={fuenteVista.url}
          nombre={fuenteVista.nombre}
          onClose={() => setFuenteVista(null)}
        />
      )}
    </div>
  )
}
