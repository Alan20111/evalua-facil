// Parte del render de SubjectPage.jsx (fase 5 de PLAN_NORMALIZACION_UI:
// dividir sin cambio visual). Recibe lo que usa del componente principal por
// el contexto Asignatura.
import CrearActividadIAModal from '../../../components/CrearActividadIAModal'
import CrearEvaluacionIAModal from '../../../components/CrearEvaluacionIAModal'
import CrearJuegoIAModal from '../../../components/juego/CrearJuegoIAModal'
import CrearVideoInteractivoModal from '../../../components/video/CrearVideoInteractivoModal'
import EntregableEditor from '../../../components/EntregableEditor'
import EvaluacionEditor from '../../../components/EvaluacionEditor'
import NuevaFechaEntregaModal from '../../../components/NuevaFechaEntregaModal'
import { db } from '../../../firebase'
import { doc, getDoc } from 'firebase/firestore'
import { normalizeFileTypeKeys } from '../../../config/fileTypes'
import { parcialCerrado } from '../../../utils/ponderacion'
import { subjectDisplayName } from '../../../utils/subjectName'
import { toRichHtml } from '../../../utils/sanitizeHtml'
import { withDefaultTime } from '../../../utils/activityVisibility'
import { useAsignatura } from './contexto'

export default function EditoresAsignatura() {
  const {
    activities,
    anexarActividadVideo,
    applyNewDateResult,
    crearActividadIA,
    crearEvalIA,
    crearJuegoIA,
    crearVideoIA,
    currentUser,
    editingActivityData,
    editorIsPublished,
    entregableEditor,
    evalEditor,
    groupStudents,
    modalParcial,
    navigate,
    newDateOpen,
    openNewDateForEditor,
    setActivities,
    setCrearActividadIA,
    setCrearEvalIA,
    setCrearJuegoIA,
    setCrearVideoIA,
    setDeleteConfirm,
    setEntregableEditor,
    setEvalEditor,
    setNewDateOpen,
    setSubmissionCounts,
    subject,
    subjectId,
  } = useAsignatura()
  return (
    <>
      {/* ── Full-screen entregable editor ── */}
      {entregableEditor && (
        <EntregableEditor
          activityId={entregableEditor.activityId}
          parcial={entregableEditor.parcial}
          parcialCerrado={parcialCerrado(subject, entregableEditor.parcial)}
          categoria={entregableEditor.categoria}
          subjectId={subjectId}
          docenteId={currentUser?.uid}
          existingActivities={activities}
          activityLabel={entregableEditor.activityLabel}
          contextLine={subjectDisplayName(subject)}
          initialForm={entregableEditor.initialForm}
          initialExistingFiles={entregableEditor.initialExistingFiles}
          onClose={() => setEntregableEditor(null)}
          onActivityCreated={(act) => {
            setActivities((prev) => [...prev, act])
            setSubmissionCounts((prev) => ({ ...prev, [act.id]: { delivered: 0, graded: 0 } }))
            // El editor puede crear la actividad SIN cerrarse (guardar borrador
            // para generar la rúbrica con IA). Si el editor sigue abierto, este
            // estado tiene que apuntar ya a la actividad creada: de ahí salen
            // el borrado y la "Nueva fecha de entrega" de esta pantalla.
            setEntregableEditor((prev) => (prev && !prev.activityId ? { ...prev, activityId: act.id } : prev))
          }}
          onActivityUpdated={(act) => {
            setActivities((prev) => prev.map((a) => a.id === act.id ? { ...a, ...act } : a))
          }}
          onNuevaFecha={editorIsPublished ? openNewDateForEditor : undefined}
          externalFechaLimite={entregableEditor.initialForm?.fechaLimite || ''}
          students={groupStudents}
          extensiones={editingActivityData?.extensiones || {}}
          extensionesMotivo={editingActivityData?.extensionesMotivo || {}}
          onDeleteActivity={editingActivityData ? () => setDeleteConfirm(editingActivityData) : undefined}
        />
      )}

      {/* "Nueva fecha de entrega" opened from within the entregable editor above —
          z-aviso so it renders on top of the editor's z-50. */}
      {entregableEditor && newDateOpen && (
        <NuevaFechaEntregaModal
          activityId={entregableEditor.activityId}
          students={groupStudents}
          onClose={() => setNewDateOpen(false)}
          onSaved={applyNewDateResult}
        />
      )}

      {/* ── OP-03/OP-04 · Examen/Cuestionario con IA ── */}
      {crearEvalIA && (
        <CrearEvaluacionIAModal
          open={!!crearEvalIA}
          categoria={crearEvalIA.categoria}
          asignaturaId={subjectId}
          asignaturaNombre={subjectDisplayName(subject)}
          parcial={modalParcial}
          docenteId={currentUser?.uid}
          existingActivitiesCountInParcial={activities.filter((a) => a.parcial === modalParcial).length}
          onClose={() => setCrearEvalIA(null)}
          onCreated={async (activityId) => {
            const label = `${modalParcial}.${activities.filter((a) => a.parcial === modalParcial).length + 1}.`
            const categoria = crearEvalIA.categoria
            setCrearEvalIA(null)
            // La actividad la creó el modal, no el editor: el editor la abre
            // como existente y al guardar solo ACTUALIZA `activities`. Sin
            // agregarla aquí, el borrador no aparecía en la lista hasta F5 (y
            // un segundo cuestionario con IA repetía el mismo `orden`). Se
            // relee fresca —trae el numPreguntas que escribió el servidor—,
            // igual que en CrearActividadIAModal más abajo.
            try {
              const snap = await getDoc(doc(db, 'activities', activityId))
              if (snap.exists()) {
                const activity = { id: snap.id, ...snap.data() }
                setActivities((prev) => prev.some((a) => a.id === activity.id) ? prev : [...prev, activity])
                setSubmissionCounts((prev) => ({ ...prev, [activity.id]: { delivered: 0, graded: 0 } }))
              }
            } catch { /* si falla, aparece al recargar, como antes */ }
            // Misma ruta que "Editar": abre el editor completo ya con los
            // reactivos que generó la IA, para que el docente los revise.
            setEvalEditor({ activityId, categoria, parcial: modalParcial, activityLabel: label })
          }}
        />
      )}

      {/* ── OP-05 · Entregable/Observación con IA ── */}
      {crearActividadIA && (
        <CrearActividadIAModal
          open={!!crearActividadIA}
          categoria={crearActividadIA.categoria}
          asignaturaId={subjectId}
          asignaturaNombre={subjectDisplayName(subject)}
          parcial={modalParcial}
          docenteId={currentUser?.uid}
          existingActivitiesCountInParcial={activities.filter((a) => a.parcial === modalParcial).length}
          onClose={() => setCrearActividadIA(null)}
          onCreated={async (activityId) => {
            const label = `${modalParcial}.${activities.filter((a) => a.parcial === modalParcial).length + 1}.`
            const categoria = crearActividadIA.categoria
            setCrearActividadIA(null)
            // A diferencia de CrearEvaluacionIAModal (donde EvaluacionEditor
            // se auto-carga por activityId), EntregableEditor necesita
            // `initialForm` ya armado — y lo que generó la IA vive en el
            // servidor, no en el `activities` local (creado vacío antes de
            // llamar a la IA). Se relee el documento fresco, mismo shape que
            // openEdit() de arriba.
            let activity = null
            try {
              const snap = await getDoc(doc(db, 'activities', activityId))
              if (snap.exists()) activity = { id: snap.id, ...snap.data() }
            } catch { /* si falla, se abre con el formulario en blanco */ }
            if (activity) {
              setActivities((prev) => [...prev, activity])
              setSubmissionCounts((prev) => ({ ...prev, [activity.id]: { delivered: 0, graded: 0 } }))
            }
            setEntregableEditor({
              activityId,
              parcial: modalParcial,
              categoria,
              activityLabel: label,
              initialExistingFiles: activity?.archivosAdjuntos || [],
              initialForm: activity ? {
                nombre: activity.nombre || '',
                instrucciones: toRichHtml(activity.instrucciones || ''),
                fechaLimite: activity.fechaLimite ? withDefaultTime(activity.fechaLimite, '00:00') : '',
                tiposArchivo: normalizeFileTypeKeys(activity.tiposArchivo),
                extensionesCustom: activity.extensionesCustom || '',
                oculta: activity.oculta ?? true,
                publishAt: activity.publishAt || '',
                publishedAt: activity.publishedAt || '',
                visibilidadMode: !activity.oculta ? 'published' : activity.publishAt ? 'schedule' : 'hide',
                cerrarEntregasEnFecha: !activity.recibirTarde,
                rubrica: activity.rubrica || null,
                rubricaId: activity.rubricaId || null,
                notificarDocente: activity.notificarDocente || false,
              } : null,
            })
          }}
        />
      )}

      {/* ── Crucigrama/Sopa de letras con IA ── */}
      {crearJuegoIA && (
        <CrearJuegoIAModal
          open={!!crearJuegoIA}
          tipoJuego={crearJuegoIA.tipoJuego}
          asignaturaId={subjectId}
          asignaturaNombre={subjectDisplayName(subject)}
          parcial={modalParcial}
          docenteId={currentUser?.uid}
          existingActivitiesCountInParcial={activities.filter((a) => a.parcial === modalParcial).length}
          onClose={() => setCrearJuegoIA(null)}
          onCreated={(activityId) => {
            setCrearJuegoIA(null)
            navigate(`/activity/${activityId}`)
          }}
        />
      )}

      {/* ── Video interactivo con IA: crea la actividad y genera las propuestas de preguntas ── */}
      {crearVideoIA && (
        <CrearVideoInteractivoModal
          open={crearVideoIA}
          asignaturaId={subjectId}
          asignaturaNombre={subjectDisplayName(subject)}
          parcial={modalParcial}
          docenteId={currentUser?.uid}
          existingActivitiesCountInParcial={activities.filter((a) => a.parcial === modalParcial).length}
          onClose={() => setCrearVideoIA(false)}
          onBorrador={anexarActividadVideo}
          onCreated={async (activityId) => {
            const label = `${modalParcial}.${activities.filter((a) => a.parcial === modalParcial).length + 1}.`
            setCrearVideoIA(false)
            // La actividad la creó el modal (oculta, con sus propuestas ya guardadas): se
            // relee fresca para que aparezca en la lista sin recargar y se abre el editor,
            // donde está el panel para revisar, editar y aprobar las preguntas.
            await anexarActividadVideo(activityId)
            setEvalEditor({ activityId, categoria: 'cuestionario', parcial: modalParcial, activityLabel: label })
          }}
        />
      )}

      {/* ── Full-screen evaluación editor (Cuestionario / Examen) ── */}
      {evalEditor && (
        <EvaluacionEditor
          activityId={evalEditor.activityId}
          parcial={evalEditor.parcial}
          categoria={evalEditor.categoria}
          activityLabel={evalEditor.activityLabel}
          contextLine={subjectDisplayName(subject)}
          subjectId={subjectId}
          docenteId={currentUser?.uid}
          subject={subject}
          existingActivities={activities}
          students={groupStudents}
          onClose={() => setEvalEditor(null)}
          onActivityCreated={(act) => {
            setActivities((prev) => [...prev, act])
            setSubmissionCounts((prev) => ({ ...prev, [act.id]: { delivered: 0, graded: 0 } }))
          }}
          onActivityUpdated={(act) => {
            setActivities((prev) => prev.map((a) => a.id === act.id ? { ...a, ...act } : a))
          }}
          onDeleteActivity={(() => {
            const a = activities.find((x) => x.id === evalEditor.activityId)
            return a ? () => setDeleteConfirm(a) : undefined
          })()}
        />
      )}
    </>
  )
}
