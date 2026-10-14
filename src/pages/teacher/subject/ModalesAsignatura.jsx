// Parte del render de SubjectPage.jsx (fase 5 de PLAN_NORMALIZACION_UI:
// dividir sin cambio visual). Recibe lo que usa del componente principal por
// el contexto Asignatura.
import { useId } from 'react'
import { AlertTriangle, Archive, ArrowDown, ArrowLeft, ArrowRightLeft, ArrowUp, ArrowUpDown, Check as CheckIcon, ChevronRight, ClipboardCheck, Copy, Download, Eye, FileText, Gamepad2, GraduationCap, KeyRound, ListChecks, Lock, LogIn, MessageCircleQuestion, Paperclip, Pencil, Plus, RotateCcw, Sparkles, Trash2, Upload, UserPlus, X } from 'lucide-react'
import { Button, Checkbox, IconButton, IconTile, Input, Modal, MotivoApagado, PanelFlotante, Radio, SkeletonList } from '../../../components/ui'
import EFDateTimePicker from '../../../components/EFDateTimePicker'
import FileDropzone from '../../../components/FileDropzone'
import FileTypeSelect from '../../../components/FileTypeSelect'
import { ICONO } from '../../../config/iconos'
import { IS_NATIVE_APP, PUEDE_AUTOFOCUS } from '../../../utils/platform'
import IconSelect from '../../../components/IconSelect'
import PaletteSelect from '../../../components/PaletteSelect'
import ParcialesFechas, { addOneDay } from '../../../components/ParcialesFechas'
import { RESOURCE_ACCEPT } from '../../../utils/resourceTypes'
import RichTextEditor from '../../../components/RichTextEditor'
import Select from '../../../components/ui/Select'
import Spinner from '../../../components/Spinner'
import SubjectIcon from '../../../components/SubjectIcon'
import VisibilitySelect from '../../../components/VisibilitySelect'
import { cuentaParaCalificacion, isDraftActivity } from '../../../utils/activityVisibility'
import { esCopiable } from '../../../utils/copiaActividad'
import { motivoNoSePuedeMover, parcialesDestino, planMoverActividad } from '../../../utils/moverActividadParcial'
import { estadoParcial, ponderacionActivaEnParcial } from '../../../utils/ponderacion'
import { formatFileSize } from '../../../utils/formatBytes'
import { minDeadline } from '../../../utils/nowIso'
import { studentFullName } from '../../../utils/studentSearch'
import { subjectDisplayName } from '../../../utils/subjectName'
import { subjectPaletteProps } from '../../../utils/subjectPalette'
import { useAsignatura } from './contexto'

// Opción del menú «Nueva actividad»: tarjeta con fondo de ícono, título y
// descripción. Una sola pieza para todas las opciones (antes eran doce copias
// a mano con fondos de ícono de 2.5rem fuera de la escala y la descripción a
// veces en text-xs y a veces en text-sm). El nombre accesible es el título;
// la descripción se anuncia aparte.
function OpcionCreacion({ icon, tone = 'accent', label, desc, onClick }) {
  const idDesc = useId()
  return (
    <button type="button" aria-label={label} aria-describedby={idDesc} onClick={onClick}
      className="w-full flex items-start gap-3 p-4 rounded-card border border-outline-variant hover:border-accent hover:bg-[var(--accent-tint)] transition-colors text-left">
      <IconTile icon={icon} tone={tone} />
      <div>
        <p className="font-semibold text-on-surface">{label}</p>
        <p id={idDesc} className="text-sm text-muted mt-0.5">{desc}</p>
      </div>
    </button>
  )
}

// «Volver» dentro del menú por pasos: el botón discreto de la librería
// (variante quiet, la de «Atrás»), no un enlace de texto chico.
function BotonVolverMenu({ onClick }) {
  return (
    <Button variant="quiet" size="sm" icon={ArrowLeft} className="-ml-3 mb-2" onClick={onClick}>
      Volver
    </Button>
  )
}

// Diálogo de «Mover a otro parcial»: elegir destino y confirmar en una sola pantalla.
// La actividad conserva todo (entregas, calificaciones, peso, fechas) y queda como
// BORRADOR en el parcial elegido; aquí se le dice al docente qué cambia por eso.
function ModalMoverParcial() {
  const { activities, applyMoverParcial, moverParcial, moving, setMoverParcial, subject } = useAsignatura()
  const a = activities.find((x) => x.id === moverParcial.a.id) || moverParcial.a
  const destinos = parcialesDestino(subject, a)
  const destino = moverParcial.destino
  const plan = destino ? planMoverActividad({ subject, activities, actividad: a, destino }) : null
  const cerrar = () => { if (!moving) setMoverParcial(null) }
  return (
    <Modal open onClose={cerrar} variant="centered" padding="p-4" busy={moving} ariaLabel="Mover a otro parcial">
      <h3 className="text-base font-semibold text-on-surface mb-1">Mover a otro parcial</h3>
      <p className="text-sm text-muted mb-3">
        &quot;<strong>{a.nombre || 'Sin nombre'}</strong>&quot; está en el Parcial {a.parcial}. ¿A qué parcial la quieres mover?
      </p>
      <div className="space-y-3 mb-3" role="radiogroup" aria-label="Parcial de destino">
        {destinos.map((d) => (
          <Radio key={d.parcial} name="parcialDestino" value={d.parcial} checked={destino === d.parcial}
            onChange={() => setMoverParcial({ ...moverParcial, destino: d.parcial })} disabled={moving}
            label={`Parcial ${d.parcial}`} hint={d.estado === 'atencion' ? 'En atención de inquietudes' : undefined} />
        ))}
      </div>
      {plan && (
        <div className="space-y-2 mb-3">
          <p className="text-sm text-on-surface bg-surface-container rounded px-3 py-2">
            {plan.yaEraBorrador
              ? <>Ya es un borrador: seguirá siendo borrador en el Parcial {destino}.</>
              : <>Quedará como <strong>borrador</strong> en el Parcial {destino}: tus estudiantes dejarán de verla y no contará en ningún promedio hasta que la publiques.</>}
            {' '}Sus entregas y calificaciones se conservan, y reaparecen cuando la publiques.
          </p>
          {plan.renumeradas.length > 0 && (
            <>
              <p className="text-sm text-muted">En el Parcial {a.parcial}, estas actividades quedarán con otro número:</p>
              <ul className="text-sm text-on-surface bg-surface-container rounded px-3 py-2 space-y-1">
                {plan.renumeradas.map((c) => (
                  <li key={c.id} className="flex items-center gap-1.5 min-w-0">
                    <span className="text-muted tabular-nums flex-shrink-0">{c.de}</span>
                    <ChevronRight size={ICONO.xs} className="text-hint flex-shrink-0" />
                    <span className="text-accent font-semibold tabular-nums flex-shrink-0">{c.hacia}</span>
                    <span className="truncate">{c.nombre}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {plan.avisos.atencionOrigen && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded px-2 py-1.5 flex gap-1.5">
              <AlertTriangle size={ICONO.xs} className="flex-shrink-0 mt-0.5" />
              <span>El Parcial {a.parcial} está en atención de inquietudes: tus estudiantes ya ven sus resultados y cambiarán al quitar esta actividad.</span>
            </p>
          )}
          {plan.avisos.peso != null && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded px-2 py-1.5 flex gap-1.5">
              <AlertTriangle size={ICONO.xs} className="flex-shrink-0 mt-0.5" />
              <span>
                Tiene un peso de {plan.avisos.peso} en la ponderación y se conserva.
                {plan.avisos.pesoEnOrigen && !plan.yaEraBorrador && ` En el Parcial ${a.parcial} dejará de sumar.`}
                {plan.avisos.pesoEnDestino
                  ? ` Sumará en el Parcial ${destino} cuando la publiques.`
                  : ` El Parcial ${destino} no usa ponderación: ahí no tendrá efecto.`}
                {' '}Revisa que los pesos de cada parcial ponderado sigan sumando 10.
              </span>
            </p>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={cerrar} disabled={moving} className="flex-1">Cancelar</Button>
        <Button icon={ArrowRightLeft} busy={moving} className="flex-1" onClick={applyMoverParcial} disabled={moving || !destino}>
          {moving ? 'Moviendo…' : 'Mover'}
        </Button>
      </div>
    </Modal>
  )
}

export default function ModalesAsignatura() {
  const {
    actTip,
    activities,
    activityContextMenu,
    activityExistingFiles,
    activityLabelById,
    activityMenu,
    activityMenuIdx,
    activityMenuSiblings,
    activityNewFiles,
    addInstructionFiles,
    addMaterialFiles,
    addStudent,
    applyMoveActivities,
    applyParcialPonderacion,
    applyPonderacion,
    archiveConZip,
    archiving,
    atencionParcialConfirm,
    bulkGradeModal,
    bulkGradeValue,
    clearGradeQuickEdit,
    closeParcialConfirm,
    closeParcialGrade,
    closeParcialSesiones,
    closingParcial,
    confirmBulkGradeNoEntregadas,
    confirmCloseParcial,
    confirmDeleteStudent,
    confirmExcelImport,
    confirmImport,
    confirmIniciarAtencion,
    confirmResetStudentPassword,
    confirmRevertParcial,
    confirmRevertPonderacion,
    copyFechas,
    copyForm,
    copyingSubject,
    deleteConfirm,
    deleteMaterialConfirm,
    deleteResourceConfirm,
    deleteSubjectConfirmText,
    deleting,
    deletingMaterial,
    deletingResource,
    deletingSubject,
    duplicateConfirm,
    duplicating,
    editStudentChanged,
    editStudentForm,
    editSubjectChanged,
    editSubjectForm,
    editingMaterial,
    editingSubject,
    elegirCreacion,
    excelPreview,
    form,
    generatingCredentials,
    gradeQuickEdit,
    handleAllowRejoin,
    handleArchiveConfirm,
    handleCopySubject,
    handleDeleteActivity,
    handleDeleteMaterial,
    handleDeleteResource,
    handleDeleteStudentPhoto,
    handleDeleteSubject,
    handleDuplicateActivity,
    handleEditSubject,
    handleGenerateCredentials,
    handleSaveActivity,
    handleSaveMaterial,
    handleSaveResource,
    handleUnarchiveConfirm,
    importFor,
    importLoading,
    importSel,
    importSrc,
    importSrcActs,
    importSubjects,
    importing,
    importingExcel,
    iniciandoAtencion,
    linkCandidate,
    materialChanged,
    materialExistingFiles,
    materialForm,
    materialModalMode,
    materialNewFiles,
    materialParcial,
    menuPaso,
    modalMode,
    modalParcial,
    moveConfirm,
    moverParcial,
    moving,
    newStudent,
    openEdit,
    parcialMenu,
    pesoTotalVivo,
    pickImportSubject,
    previewActividad,
    publishDraftConfirm,
    publishDraftNow,
    removeInstructionFile,
    requestCloseParcial,
    requestDeleteFromEdit,
    requestMoveActivity,
    requestMoverParcial,
    requestResetFromEdit,
    resetPwdResult,
    resolveLinkCandidate,
    resourceChanged,
    resourceForm,
    resourceModalMode,
    revertCloseParcial,
    revertParcialConfirm,
    revertingParcial,
    saveEditStudent,
    saveGradeQuickEdit,
    saving,
    savingBulkGrade,
    savingMaterial,
    savingQuickGrade,
    savingResource,
    savingStudent,
    setActivityContextMenu,
    setActivityMenu,
    setArchiveConZip,
    setAtencionParcialConfirm,
    setBulkGradeModal,
    setBulkGradeValue,
    setCloseParcialConfirm,
    setCloseParcialGrade,
    setCloseParcialSesiones,
    setConfirmRevertParcial,
    setConfirmRevertPonderacion,
    setCopyFechas,
    setCopyForm,
    setCrearJuegoIA,
    setCrearVideoIA,
    setDeleteConfirm,
    setDeleteMaterialConfirm,
    setDeleteResourceConfirm,
    setDeleteSubjectConfirmText,
    setDuplicateConfirm,
    setEditStudentForm,
    setEditSubjectForm,
    setExcelPreview,
    setForm,
    setGradeQuickEdit,
    setImportFor,
    setImportSel,
    setImportSrc,
    setImportSrcActs,
    setLinkCandidate,
    setMaterialExistingFiles,
    setMaterialForm,
    setMaterialNewFiles,
    setMenuPaso,
    setMoveConfirm,
    setNewStudent,
    setParcialMenu,
    setPublishDraftConfirm,
    setResetPwdResult,
    setResourceFile,
    setResourceForm,
    setRevertParcialConfirm,
    setShowAddStudent,
    setShowArchiveModal,
    setShowCopyModal,
    setShowCredentialsModal,
    setShowDeleteSubjectConfirm,
    setShowEditSubjectModal,
    setShowMaterialModal,
    setShowModal,
    setShowResourceModal,
    setShowUnarchiveModal,
    setStudentToDelete,
    setStudentToEdit,
    setStudentToReset,
    setTipoActividad,
    setUnarchiveActivities,
    setUnarchiveEdits,
    setUnarchiveStudents,
    showAddStudent,
    showArchiveModal,
    showCopyModal,
    showCredentialsModal,
    showDeleteSubjectConfirm,
    showEditSubjectModal,
    showMaterialModal,
    showModal,
    showResourceModal,
    showUnarchiveModal,
    studentLastAccess,
    studentToDelete,
    studentToEdit,
    studentToReset,
    subject,
    tipoActividad,
    toggleImportLinkDecision,
    toggleImportSel,
    unarchiveActivities,
    unarchiveEdits,
    unarchiveStudents,
    unarchivedSaving,
    zipDownloading,
    zipProgress,
  } = useAsignatura()
  // Lo que falta para poder guardar (el botón se apaga y lo dice). Las fechas
  // aquí son recomendadas, no obligatorias: hay asignaturas viejas sin ellas.
  const faltanEditar = [
    !editSubjectForm.nombre.trim() && 'el nombre de la asignatura',
    !editSubjectForm.grupo.trim() && 'el grupo',
  ].filter(Boolean)
  const faltanDuplicar = [
    !copyForm.nombre.trim() && 'el nombre de la asignatura',
    !copyForm.grupo.trim() && 'el grupo',
  ].filter(Boolean)
  const faltanDesarchivar = [
    !unarchiveEdits.nombre.trim() && 'el nombre de la asignatura',
    !unarchiveEdits.grupo.trim() && 'el grupo',
  ].filter(Boolean)
  return (
    <>
      {/* ── Activity create/edit modal ── */}
      {showModal && (
        <Modal open onClose={() => setShowModal(false)} variant="sheet" size="3xl" z={40} padding="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">
                {modalMode === 'create' && !tipoActividad
                  ? `Nueva actividad — Parcial ${modalParcial}`
                  : modalMode === 'create'
                    ? `${tipoActividad === 'entregable' ? 'Entregable' : tipoActividad === 'cuestionario' ? 'Cuestionario' : 'Examen'} — Parcial ${modalParcial}`
                    : 'Editar actividad'}
              </h3>
              <IconButton icon={X} label="Cerrar" tooltip={false} className="-mr-2" onClick={() => setShowModal(false)} />
            </div>

            {/* ── Tipo picker (only on create, before choosing type) ──
                Reorganización 23-ago-2026: 4 categorías de primer nivel
                (Entregable / Evaluación / Observación / Actividad
                interactiva); "con IA" ya no es una opción independiente,
                es un método de creación dentro de cada tipo. Navegación
                pura vía `menuPaso` — las hojas llaman los mismos setters
                que ya existían (ver elegirCreacion / setCrearJuegoIA). ── */}
            {modalMode === 'create' && !tipoActividad ? (
              <div className="space-y-2 py-2">
                {menuPaso === null && (
                  <>
                    <p className="text-sm text-muted mb-3">¿Qué quieres que haga tu estudiante?</p>
                    {[
                      { key: 'entregable', label: 'Entregable', desc: 'El estudiante entrega uno o varios archivos.', icon: FileText, tone: 'neutral' },
                      { key: 'evaluacion', label: 'Evaluación', desc: 'Cuestionarios y exámenes con reactivos y calificación.', icon: ListChecks, tone: 'success' },
                      { key: 'observacion', label: 'Observación', desc: 'Tú observas y calificas el desempeño del estudiante.', icon: ClipboardCheck, tone: 'warning' },
                      { key: 'interactiva', label: 'Actividad interactiva', desc: 'El estudiante realiza una actividad directamente en Evalúa Fácil, generada con IA.', icon: Gamepad2, tone: 'accent' },
                    ].map(({ key, ...opt }) => (
                      <OpcionCreacion key={key} {...opt} onClick={() => setMenuPaso(key)} />
                    ))}
                  </>
                )}

                {(menuPaso === 'entregable' || menuPaso === 'observacion') && (
                  <>
                    <BotonVolverMenu onClick={() => setMenuPaso(null)} />
                    <p className="text-sm text-muted mb-3">
                      {menuPaso === 'entregable' ? 'El estudiante entrega uno o varios archivos.' : 'Tú observas y calificas el desempeño del estudiante.'}
                    </p>
                    <OpcionCreacion icon={Pencil} tone="neutral" label="Crear manualmente" desc="Tú defines instrucciones y configuración."
                      onClick={() => elegirCreacion(menuPaso, 'manual')} />
                    <OpcionCreacion icon={Sparkles} label="Generar con IA" desc="Describe qué quieres y el asistente genera la actividad completa."
                      onClick={() => elegirCreacion(menuPaso, 'ia')} />
                  </>
                )}

                {menuPaso === 'evaluacion' && (
                  <>
                    <BotonVolverMenu onClick={() => setMenuPaso(null)} />
                    <p className="text-sm text-muted mb-3">Cuestionarios y exámenes con reactivos y calificación.</p>
                    {[
                      { key: 'cuestionario', label: 'Cuestionario', desc: 'Preguntas con calificación automática, abiertas o con archivo. Ideal para práctica o aprendizaje.', icon: ListChecks, tone: 'success' },
                      { key: 'examen', label: 'Examen', desc: 'Preguntas con calificación automática, abiertas o con archivo. Para evaluación formal.', icon: GraduationCap, tone: 'accent' },
                    ].map(({ key, ...opt }) => (
                      <OpcionCreacion key={key} {...opt} onClick={() => setMenuPaso(key)} />
                    ))}
                  </>
                )}

                {(menuPaso === 'cuestionario' || menuPaso === 'examen') && (
                  <>
                    <BotonVolverMenu onClick={() => setMenuPaso('evaluacion')} />
                    <p className="text-sm text-muted mb-3">{menuPaso === 'cuestionario' ? 'Cuestionario' : 'Examen'}: reactivos con calificación automática.</p>
                    <OpcionCreacion icon={Pencil} tone="neutral" label="Crear manualmente" desc="Tú agregas los reactivos uno por uno."
                      onClick={() => elegirCreacion(menuPaso, 'manual')} />
                    <OpcionCreacion icon={Sparkles} label="Generar con IA" desc="Describe qué quieres evaluar y el asistente genera los reactivos."
                      onClick={() => elegirCreacion(menuPaso, 'ia')} />
                  </>
                )}

                {menuPaso === 'interactiva' && (
                  <>
                    <BotonVolverMenu onClick={() => setMenuPaso(null)} />
                    <p className="text-sm text-muted mb-3">El estudiante resuelve el juego directamente en Evalúa Fácil.</p>
                    {[
                      { key: 'crucigrama', label: 'Crucigrama', desc: 'Describe el tema y el asistente propone las palabras para armar un crucigrama.', tone: 'accent' },
                      { key: 'sopa_letras', label: 'Sopa de letras', desc: 'Describe el tema y el asistente propone las palabras para armar una sopa de letras.', tone: 'success' },
                    ].map(({ key, ...opt }) => (
                      <OpcionCreacion key={key} icon={Sparkles} {...opt}
                        onClick={() => { setShowModal(false); setCrearJuegoIA({ tipoJuego: key }) }} />
                    ))}
                    <OpcionCreacion icon={Sparkles} label="Video interactivo"
                      desc="Pega un video de YouTube y el asistente propone preguntas que se hacen en el momento justo del video."
                      onClick={() => { setShowModal(false); setCrearVideoIA(true) }} />
                    <p className="text-xs text-muted text-center pt-2">Próximamente más actividades interactivas</p>
                  </>
                )}
              </div>
            ) : (
              <>
                {modalMode === 'create' && (
                  <div className="flex items-center gap-2 -mt-2 mb-3">
                    <button type="button" onClick={() => setTipoActividad(null)}
                      className="text-xs text-accent hover:underline">← Cambiar tipo</button>
                  </div>
                )}
                <p className="text-base text-on-surface mb-2">
                  Actividad <strong className="text-accent">{previewActividad}</strong>
                </p>
            <form onSubmit={handleSaveActivity} className="space-y-2">
              <Input
                label="Nombre de la actividad" id="act-nombre" type="text" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                required />
              <div>
                <p className="block text-sm font-medium text-muted mb-1">Instrucciones</p>
                <RichTextEditor
                  value={form.instrucciones}
                  onChange={(html) => setForm((f) => ({ ...f, instrucciones: html }))}
                  etiqueta="Describe la tarea para tus estudiantes…"
                  attachments={[
                    ...activityExistingFiles,
                    ...activityNewFiles.map((f) => ({ nombre: f.name, tamano: f.size })),
                  ]}
                  onAttachFiles={addInstructionFiles}
                  onRemoveAttachment={removeInstructionFile}
                  simple={IS_NATIVE_APP}
                />
              </div>
              {form.categoria !== 'cuestionario' && form.categoria !== 'examen' && (
                <div className="pt-1">
                  <FileTypeSelect
                    value={form.tiposArchivo}
                    onChange={(v) => setForm((f) => ({ ...f, tiposArchivo: v }))}
                    customExts={form.extensionesCustom}
                    onCustomChange={(v) => setForm((f) => ({ ...f, extensionesCustom: v }))}
                  />
                </div>
              )}

              {/* Visibilidad */}
              <div>
                <p className="block text-sm font-medium text-muted mb-2">Visibilidad</p>
                <VisibilitySelect
                  mode={form.visibilidadMode}
                  publishAt={form.publishAt}
                  onModeChange={(mode) => setForm((f) => ({
                    ...f, visibilidadMode: mode,
                    oculta: mode !== 'show',
                    publishAt: mode === 'schedule' ? f.publishAt : '',
                    fechaLimite: mode === 'hide' ? '' : f.fechaLimite,
                  }))}
                  onPublishAtChange={(v) => setForm((f) => ({ ...f, publishAt: v }))}
                />
              </div>

              {/* Fecha límite — solo visible si no está oculta */}
              {form.visibilidadMode !== 'hide' && (
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">
                    {form.fechaLimite ? 'Modificar fecha límite' : <>Fecha límite <span className="text-hint font-normal">(opcional)</span></>}
                  </label>
                  {form.visibilidadMode === 'schedule' && !form.publishAt ? (
                    <p className="text-sm text-hint px-1">Primero elige la fecha de publicación arriba.</p>
                  ) : (
                    <>
                      <EFDateTimePicker
                        mode="datetime"
                        headerLabel="Fecha y hora límite"
                        value={form.fechaLimite}
                        onChange={v => setForm(f => ({ ...f, fechaLimite: v }))}
                        valorVacio="Sin fecha límite"
                        clearable
                        minDateTime={minDeadline(
                          form.visibilidadMode === 'schedule' ? form.publishAt : form.publishedAt
                        )}
                      />
                      {form.fechaLimite ? (
                        <Checkbox
                          checked={!!form.recibirTarde}
                          onChange={e => setForm(f => ({ ...f, recibirTarde: e.target.checked }))}
                          wrapperClassName="mt-2"
                          label={
                            <span className="font-normal text-muted leading-snug">
                              Seguir recibiendo entregas después de la fecha límite
                              <span className="text-hint"> (se marcarán como <strong>entrega tarde</strong>). Si no la marcas, al pasar la fecha ya no se reciben.</span>
                            </span>
                          }
                        />
                      ) : (
                        <p className="text-sm text-hint mt-1">
                          Luego de esta fecha y hora ya no se reciben entregas.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <Button fullWidth type="submit" disabled={saving}>
                {saving ? <Spinner size="sm" /> : modalMode === 'create' ? <Plus size={ICONO.md} /> : <Pencil size={ICONO.md} />}
                {saving ? 'Guardando…' : modalMode === 'create'
                  ? (tipoActividad === 'cuestionario' || tipoActividad === 'examen') ? 'Crear y agregar preguntas' : 'Crear actividad'
                  : 'Guardar cambios'}
              </Button>
              {/* Este modal solo CREA (openEdit manda al editor de pantalla
                  completa, que es donde vive "regresar a borrador" de algo ya
                  publicado), así que aquí nunca hay publishedAt. */}
              {!form.publishedAt && (
                <Button variant="outline-accent" fullWidth disabled={saving} onClick={(e) => handleSaveActivity(e, true)}
                  className="mt-2">
                  Guardar como borrador
                </Button>
              )}
            </form>
              </>
            )}
          </Modal>
      )}

      {/* ── Duplicate activity confirmation ── */}
      {duplicateConfirm && (
        <Modal open onClose={() => setDuplicateConfirm(null)} variant="centered" padding="p-4" ariaLabel="Duplicar actividad">
            <h3 className="text-base font-semibold text-on-surface mb-1">Duplicar actividad</h3>
            <p className="text-sm text-muted mb-4">
              Se creará una copia de &ldquo;<strong>{duplicateConfirm.nombre}</strong>&rdquo; como <strong>borrador</strong>, con el nombre &ldquo;{duplicateConfirm.nombre} (copia)&rdquo;.
              Quedará oculta para estudiantes y sin número hasta que la publiques. Edítala para cambiarle el nombre.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDuplicateConfirm(null)} className="flex-1">Cancelar</Button>
              <Button icon={Copy} busy={duplicating} className="flex-1" onClick={handleDuplicateActivity} disabled={duplicating}>
                
                {duplicating ? 'Duplicando…' : 'Duplicar'}
              </Button>
            </div>
          </Modal>
      )}

      {/* ── Move activity confirmation (renumbering + aviso al grupo) ── */}
      {moveConfirm && (
        <Modal open onClose={() => setMoveConfirm(null)} variant="centered" padding="p-4" busy={moving} ariaLabel="¿Cambiar de lugar la actividad?">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Cambiar de lugar la actividad?</h3>
            <p className="text-sm text-muted mb-3">
              &quot;<strong>{moveConfirm.a.nombre}</strong>&quot; cambiará de lugar dentro del Parcial {moveConfirm.a.parcial}.
              El número de una actividad depende de su lugar, así que estas quedarán con otro número:
            </p>
            <ul className="text-sm text-on-surface bg-surface-container rounded px-3 py-2 mb-3 space-y-1">
              {moveConfirm.changes.map((c) => (
                <li key={c.id} className="flex items-center gap-1.5 min-w-0">
                  <span className="text-muted tabular-nums flex-shrink-0">{c.de}</span>
                  <ChevronRight size={ICONO.xs} className="text-hint flex-shrink-0" />
                  <span className="text-accent font-semibold tabular-nums flex-shrink-0">{c.hacia}</span>
                  <span className="truncate">{c.nombre}</span>
                </li>
              ))}
            </ul>
            {moveConfirm.changes.some((c) => c.publicada) && (
              <p className="text-sm text-amber-700 bg-amber-50 rounded px-2 py-1.5 mb-3 flex gap-1.5">
                <AlertTriangle size={ICONO.xs} className="flex-shrink-0 mt-0.5" />
                <span>
                  Ya están publicadas: tus estudiantes las conocen con el número que tienen hoy.
                  Avísale al grupo del cambio para que no entreguen en la actividad equivocada.
                </span>
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setMoveConfirm(null)} disabled={moving} className="flex-1">Cancelar</Button>
              <Button icon={ArrowUpDown} busy={moving} className="flex-1" onClick={() => applyMoveActivities(moveConfirm.a.parcial, moveConfirm.newList)} disabled={moving}>
                
                {moving ? 'Moviendo…' : 'Mover'}
              </Button>
            </div>
          </Modal>
      )}

      {/* ── Mover a otro parcial (la actividad queda como borrador allá) ── */}
      {moverParcial && <ModalMoverParcial />}

      {/* ── Publish draft confirmation ── */}
      {publishDraftConfirm && (
        <Modal open onClose={() => setPublishDraftConfirm(null)} variant="centered" padding="p-4" ariaLabel="¿Publicar actividad?">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Publicar actividad?</h3>
            <p className="text-sm text-muted mb-2">
              &ldquo;<strong>{publishDraftConfirm.nombre}</strong>&rdquo; es un borrador. Al publicarla, los estudiantes podrán verla y se registrará la fecha y hora de publicación.
            </p>
            {/(\(copia\))\s*$/i.test(publishDraftConfirm.nombre || '') && (
              <p className="text-sm text-amber-700 bg-amber-50 rounded px-2 py-1.5 mb-3">
                Aún tiene el nombre de copia — conviene editarla antes de publicar.
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setPublishDraftConfirm(null)} className="flex-1">Cancelar</Button>
              {/* Editar is the primary path — a draft usually still needs changes
                  (esp. duplicates); Publicar stays available as secondary */}
              <Button variant="outline-accent" icon={Eye} className="flex-1 min-h-control" onClick={publishDraftNow}>
                 Publicar
              </Button>
              <Button icon={Pencil} className="flex-1"
                onClick={() => { const a = publishDraftConfirm; setPublishDraftConfirm(null); openEdit(a, activityLabelById[a.id]) }}>
                 Editar
              </Button>
            </div>
          </Modal>
      )}

      {/* ── Delete activity confirmation ── */}
      {/* z-aviso: puede abrirse desde dentro del editor de borradores (z-50),
          igual que NuevaFechaEntregaModal — sin esto quedaba tapado detrás. */}
      {deleteConfirm && (
        <Modal open onClose={() => setDeleteConfirm(null)} variant="centered" z={60} padding="p-4" ariaLabel="¿Eliminar actividad?">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Eliminar actividad?</h3>
            <p className="text-sm text-muted mb-4">
              &ldquo;<strong>{deleteConfirm.nombre}</strong>&rdquo; se eliminará permanentemente.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDeleteConfirm(null)} className="flex-1">Cancelar</Button>
              <Button variant="danger" icon={Trash2} iconEffect="balanceo" busy={deleting} className="flex-1" onClick={handleDeleteActivity} disabled={deleting}>
                
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </div>
          </Modal>
      )}

      {/* ── Material de apoyo create/edit modal ── */}
      {showMaterialModal && (
        <Modal open onClose={() => setShowMaterialModal(false)} variant="sheet" size="3xl" z={40} padding="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">
                {materialModalMode === 'create' ? `Nuevo material de apoyo — Parcial ${materialParcial}` : 'Editar material de apoyo'}
              </h3>
              <IconButton icon={X} label="Cerrar" tooltip={false} className="-mr-2" onClick={() => setShowMaterialModal(false)} />
            </div>
            <p className="text-sm text-hint -mt-2 mb-3">Este material queda solo en el Parcial {materialParcial} y no genera entrega ni número de actividad. Para materiales de toda la asignatura usa la pestaña Recursos.</p>
            <form onSubmit={handleSaveMaterial} className="space-y-2">
              <Input
                label="Nombre del material" id="material-nombre" type="text" value={materialForm.nombre} onChange={(e) => setMaterialForm((f) => ({ ...f, nombre: e.target.value }))}
                required />
              <div>
                <p className="block text-sm font-medium text-muted mb-1">Descripción <span className="text-hint font-normal">(opcional)</span></p>
                <RichTextEditor
                  value={materialForm.descripcion}
                  onChange={(html) => setMaterialForm((f) => ({ ...f, descripcion: html }))}
                  etiqueta="Explica brevemente este material para tus estudiantes…"
                />
              </div>

              <div>
                <p className="block text-sm font-medium text-muted mb-1">Recursos</p>
                <FileDropzone
                  onFilesSelected={addMaterialFiles}
                  hint="Cualquier tipo de archivo (PDF, Word, Excel, PowerPoint, imágenes, audio, video, ZIP, RAR…) · máximo 15 MB por archivo"
                />
                {(materialExistingFiles.length > 0 || materialNewFiles.length > 0) && (
                  <div className="space-y-1 mt-2">
                    {materialExistingFiles.map((f, i) => (
                      <div key={f.url || `existing-${f.nombre}-${i}`} className="flex items-center gap-2 px-2 py-1.5 rounded-full border border-outline-variant">
                        <Paperclip size={ICONO.sm} className="text-hint flex-shrink-0" />
                        <span className="text-sm text-on-surface truncate flex-1">{f.nombre}</span>
                        <span className="text-xs text-hint flex-shrink-0">{formatFileSize(f.tamano)}</span>
                        <button type="button" onClick={() => setMaterialExistingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          aria-label="Quitar archivo"
                          className="size-control inline-flex items-center justify-center text-hint hover:text-red-500 rounded-full flex-shrink-0">
                          <X size={ICONO.sm} />
                        </button>
                      </div>
                    ))}
                    {materialNewFiles.map((f, i) => (
                      <div key={`new-${f.name}-${f.size}-${i}`} className="flex items-center gap-2 px-2 py-1.5 rounded-full border border-accent bg-[var(--accent-tint)]">
                        <Paperclip size={ICONO.sm} className="text-accent flex-shrink-0" />
                        <span className="text-sm text-on-surface truncate flex-1">{f.name}</span>
                        <span className="text-xs text-hint flex-shrink-0">{formatFileSize(f.size)}</span>
                        <button type="button" onClick={() => setMaterialNewFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          aria-label="Quitar archivo"
                          className="size-control inline-flex items-center justify-center text-hint hover:text-red-500 rounded-full flex-shrink-0">
                          <X size={ICONO.sm} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Visibilidad */}
              <div>
                <p className="block text-sm font-medium text-muted mb-2">Visibilidad</p>
                <VisibilitySelect
                  // Si el material YA es visible para los estudiantes, se
                  // bloquea a la vista "Publicada" (igual que las
                  // actividades) — sin esto, reabrir "Editar" y tocar de más
                  // en "Programar publicación"/"Ocultar" apagaba en
                  // silencio un material que ya estaban viendo. Mostrar/
                  // ocultar sigue siendo trabajo del ojito en la tarjeta,
                  // nunca de este formulario.
                  mode={(editingMaterial && !editingMaterial.oculta) ? 'published' : materialForm.visibilidadMode}
                  publishAt={materialForm.publishAt}
                  onModeChange={(mode) => setMaterialForm((f) => ({
                    ...f, visibilidadMode: mode,
                    oculta: mode !== 'show',
                    publishAt: mode === 'schedule' ? f.publishAt : '',
                  }))}
                  onPublishAtChange={(v) => setMaterialForm((f) => ({ ...f, publishAt: v }))}
                />
              </div>

              <Button fullWidth type="submit" disabled={savingMaterial || !materialChanged}>
                {savingMaterial ? <Spinner size="sm" /> : materialModalMode === 'create' ? <Plus size={ICONO.md} /> : <Pencil size={ICONO.md} />}
                {savingMaterial ? 'Guardando…' : materialModalMode === 'create' ? 'Crear material' : 'Guardar cambios'}
              </Button>
            </form>
          </Modal>
      )}

      {/* ── Delete material confirmation ── */}
      {deleteMaterialConfirm && (
        <Modal open onClose={() => setDeleteMaterialConfirm(null)} variant="centered" padding="p-4" ariaLabel="¿Eliminar material de apoyo?">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Eliminar material de apoyo?</h3>
            <p className="text-sm text-muted mb-4">
              &ldquo;<strong>{deleteMaterialConfirm.nombre}</strong>&rdquo; se eliminará permanentemente.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDeleteMaterialConfirm(null)} className="flex-1">Cancelar</Button>
              <Button variant="danger" icon={Trash2} iconEffect="balanceo" busy={deletingMaterial} className="flex-1" onClick={handleDeleteMaterial} disabled={deletingMaterial}>
                
                {deletingMaterial ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </div>
          </Modal>
      )}

      {/* ── Add student modal ── */}
      {showAddStudent && (
        <Modal open onClose={() => setShowAddStudent(false)} variant="sheet" z={40} padding="p-4" ariaLabel="Agregar estudiante">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Agregar estudiante</h3>
              <IconButton icon={X} label="Cerrar" tooltip={false} className="-mr-2" onClick={() => setShowAddStudent(false)} />
            </div>
            <form onSubmit={addStudent} className="space-y-3">
              {/* Antes solo tenían placeholder ("Prueba", "No tengo", "Pepito"
                  en los ejemplos que se ven en pantalla) — en cuanto se
                  escribía algo, no quedaba ninguna pista de a cuál apellido o
                  nombre correspondía cada campo. Con label fijo arriba, el
                  campo se sigue identificando aunque ya tenga texto. */}
              {[
                { field: 'apellidoPaterno', label: 'Apellido paterno' },
                // No todos los estudiantes tienen segundo apellido — pedir que
                // escriban "No tengo" o algo así sería innecesariamente
                // incómodo, así que este campo no es obligatorio.
                { field: 'apellidoMaterno', label: 'Apellido materno', optional: true },
                { field: 'nombre', label: 'Nombre(s)' },
              ].map(({ field, label, optional }) => (
                <div key={field}>
                  <label htmlFor={`add-student-${field}`} className="block text-sm font-medium text-muted mb-1">
                    {label} {optional && <span className="text-hint font-normal">(opcional)</span>}
                  </label>
                  <Input
                    id={`add-student-${field}`}
                    type="text"
                    value={newStudent[field]}
                    onChange={(e) => setNewStudent((f) => ({ ...f, [field]: e.target.value }))}
                    required={!optional}
                    // autoFocus intencional (solo en escritorio): primer campo del modal, se abre
                    // una sola vez por apertura — no hay nada más que esperar.
                    autoFocus={PUEDE_AUTOFOCUS && field === 'apellidoPaterno'}
                  />
                </div>
              ))}
              {IS_NATIVE_APP && (
                <p className="text-sm text-muted text-center">Para subir a todo el grupo usa la plantilla de excel en la web</p>
              )}
              <Button fullWidth icon={Plus} iconEffect="gira90" busy={savingStudent}
                type="submit"
                disabled={savingStudent}>
                
                Agregar estudiante
              </Button>
            </form>
          </Modal>
      )}

      {/* ── Edit student modal ── */}
      {studentToEdit && (
        <Modal open onClose={() => setStudentToEdit(null)} variant="sheet" z={40} padding="p-4" ariaLabel="Editar estudiante">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Editar estudiante</h3>
              <IconButton icon={X} label="Cerrar" tooltip={false} className="-mr-2" onClick={() => setStudentToEdit(null)} />
            </div>
            {studentToEdit.uid && (
              <p className="text-xs text-muted mb-3">
                {studentLastAccess
                  ? (() => {
                      const d = new Date(studentLastAccess)
                      const fecha = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
                      const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
                      return `Último acceso: ${fecha}, ${hora}`
                    })()
                  : 'Último acceso: consultando…'}
              </p>
            )}
            {/* Foto de perfil del estudiante — la sube el propio estudiante desde su cuenta;
                el docente solo puede eliminarla (por si sube algo inapropiado), no reemplazarla */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-16 h-16 rounded-full bg-accent-light overflow-hidden flex items-center justify-center flex-shrink-0">
                {studentToEdit.photoURL ? (
                  <img src={studentToEdit.photoURL} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl font-bold text-accent">{(studentToEdit.nombre || '?').charAt(0).toUpperCase()}</span>
                )}
              </div>
              {studentToEdit.photoURL ? (
                <div className="flex flex-col items-start gap-1">
                  <p className="text-xs text-muted">Foto de perfil que subió el estudiante.</p>
                  <button type="button" onClick={handleDeleteStudentPhoto}
                    className="text-xs font-semibold text-red-500 hover:text-red-600 hover:underline">
                    Eliminar foto
                  </button>
                </div>
              ) : (
                <p className="text-sm text-muted">El estudiante aún no ha subido una foto de perfil.</p>
              )}
            </div>
            <form onSubmit={saveEditStudent} className="space-y-2">
              {['apellidoPaterno', 'apellidoMaterno', 'nombre'].map((field) => (
                <Input
                  key={field}
                  type="text"
                  value={editStudentForm[field]}
                  onChange={(e) => setEditStudentForm((f) => ({ ...f, [field]: e.target.value }))}
                  required={field !== 'apellidoMaterno'}
                  aria-label={
                    field === 'apellidoPaterno' ? 'Apellido paterno'
                      : field === 'apellidoMaterno' ? 'Apellido materno'
                      : 'Nombre(s)'
                  }
                />
              ))}
              <div>
                <label htmlFor="edit-student-comentarios" className="block text-xs font-medium text-muted mb-1">Comentarios (solo para ti, el estudiante no los ve)</label>
                <textarea
                  id="edit-student-comentarios"
                  value={editStudentForm.comentarios}
                  onChange={(e) => setEditStudentForm((f) => ({ ...f, comentarios: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-card border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none"
                />
              </div>
              <Button fullWidth icon={Pencil} busy={savingStudent}
                type="submit"
                disabled={savingStudent || !editStudentChanged}>
                
                Guardar cambios
              </Button>
              <button
                type="button"
                onClick={requestResetFromEdit}
                disabled={savingStudent}
                className="w-full py-2.5 rounded-full border border-amber-300 text-amber-700 text-sm font-semibold hover:bg-amber-50 transition-colors disabled:opacity-60 flex items-center justify-center gap-2 min-h-control"
              >
                <RotateCcw size={ICONO.sm} />
                Restablecer contraseña
              </button>
              {studentToEdit?.ocultaPorAlumno && (
                // Salió por su cuenta de la asignatura — no se reactiva sola
                // con el código, requiere este permiso explícito del docente.
                <button
                  type="button"
                  onClick={() => { handleAllowRejoin(studentToEdit); setStudentToEdit(null) }}
                  disabled={savingStudent}
                  className="w-full py-2.5 rounded-full border border-accent-soft text-accent text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60 flex items-center justify-center gap-2 min-h-control"
                >
                  <LogIn size={ICONO.sm} />
                  Permitir reingreso — salió de la asignatura
                </button>
              )}
              <Button variant="danger-outline" fullWidth
                onClick={requestDeleteFromEdit}
                disabled={savingStudent}
              >
                <Trash2 size={ICONO.sm} />
                Eliminar estudiante
              </Button>
            </form>
          </Modal>
      )}

      {/* ── Reset password confirmation ── */}
      {studentToReset && (
        <Modal open onClose={() => setStudentToReset(null)} variant="sheet" z={40} padding="p-4" ariaLabel="¿Restablecer contraseña?">
            <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-2">
              <KeyRound size={ICONO.lg} className="text-amber-500" />
            </div>
            <h3 className="text-lg font-bold text-center text-on-surface">¿Restablecer contraseña?</h3>
            <p className="text-sm text-muted text-center mt-2">
              Se autorizará el restablecimiento de contraseña de{' '}
              <strong>{studentFullName(studentToReset)}</strong>{' '}
              ({studentToReset.username}).
              El alumno podrá crear una nueva contraseña desde la pantalla de acceso.
            </p>
            <div className="flex gap-2 mt-4">
              <Button variant="secondary" className="flex-1"
                onClick={() => setStudentToReset(null)}
              >
                Cancelar
              </Button>
              <button type="button"
                onClick={confirmResetStudentPassword}
                className="flex-1 min-h-control py-2 bg-amber-700 hover:bg-amber-800 text-white font-semibold rounded-full transition-colors flex items-center justify-center gap-2"
              >
                <KeyRound size={ICONO.md} />
                Restablecer
              </button>
            </div>
          </Modal>
      )}

      {/* ── Generate credentials modal (R16) ── */}
      {showCredentialsModal && (
        <Modal open onClose={() => setShowCredentialsModal(false)} variant="sheet" z={40} padding="p-4" busy={generatingCredentials} ariaLabel="Descargar lista de acceso">
            <div className="w-12 h-12 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-2">
              <KeyRound size={ICONO.lg} className="text-accent" />
            </div>
            <h3 className="text-lg font-bold text-center text-on-surface">Descargar lista de acceso</h3>
            <p className="text-sm text-muted text-center mt-2">
              Se descargará un PDF con el <strong>usuario</strong> de cada estudiante y el
              <strong> código de la clase</strong> para que puedan entrar por primera vez.
            </p>
            <p className="text-sm text-muted text-center mt-2">
              Cada estudiante elige su propia contraseña la primera vez que entra. No se generan claves temporales.
            </p>
            <div className="flex gap-2 mt-4">
              <Button variant="secondary" className="flex-1"
                onClick={() => setShowCredentialsModal(false)}
                disabled={generatingCredentials}
              >
                Cancelar
              </Button>
              <Button icon={Download} iconEffect="empujaAbajo" busy={generatingCredentials} className="flex-1"
                onClick={handleGenerateCredentials}
                disabled={generatingCredentials}>
                
                {generatingCredentials ? 'Descargando…' : 'Descargar lista'}
              </Button>
            </div>
          </Modal>
      )}

      {/* ── Activity-name tooltip ABOVE the number header (fixed → never clipped) ── */}
      {actTip && (
        <div
          className="fixed z-sistema -translate-x-1/2 -translate-y-full px-2 py-1 rounded-card border border-[#c0c0c0] bg-[#f5f5f5] text-[#111] text-[11px] max-w-xs shadow-lg pointer-events-none"
          style={{ left: actTip.x, top: actTip.y - 6 }}
        >
          <div className="font-medium">{actTip.text}</div>
          <div className="text-[10px] text-[#555] mt-0.5">{actTip.hint}</div>
        </div>
      )}

      {/* ── Per-activity ⋮ menu: Subir / Bajar / Duplicar / Eliminar (fixed → never clipped) ── */}
      {activityMenu && (
          <PanelFlotante punto={{ x: activityMenu.x, y: activityMenu.y }} align="end" onCerrar={() => setActivityMenu(null)} label="Opciones de la actividad" className="w-52">
            {/* Cambiar de lugar dentro del parcial. El número (1.2., 1.3.…) va
                con la posición, así que mover renumera — de ahí la confirmación. */}
            <button type="button"
              disabled={activityMenuIdx <= 0}
              onClick={() => { const a = activityMenu.a; setActivityMenu(null); requestMoveActivity(a, -1) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors text-left disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default">
              <ArrowUp size={ICONO.sm} className="text-hint flex-shrink-0" /> Subir un lugar
            </button>
            <button type="button"
              disabled={activityMenuIdx < 0 || activityMenuIdx >= activityMenuSiblings.length - 1}
              onClick={() => { const a = activityMenu.a; setActivityMenu(null); requestMoveActivity(a, 1) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors text-left border-b border-outline-variant disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default">
              <ArrowDown size={ICONO.sm} className="text-hint flex-shrink-0" /> Bajar un lugar
            </button>
            {/* Un juego sin confirmar no se puede duplicar: la copia nacería
                sin la reserva de créditos del original (que nunca se copia) y
                quedaría imposible de confirmar y de publicar. */}
            <button type="button"
              disabled={!esCopiable(activityMenu.a)}
              data-tooltip={!esCopiable(activityMenu.a) ? 'Termina y confirma el juego para poder duplicarlo' : undefined}
              onClick={() => { const a = activityMenu.a; setActivityMenu(null); setDuplicateConfirm(a) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors text-left disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default">
              <Copy size={ICONO.sm} className="text-hint flex-shrink-0" /> Duplicar como borrador
            </button>
            {/* Mover a otro parcial: la actividad queda como borrador allá (ver
                utils/moverActividadParcial.js). Sin destino válido, apagada con su motivo. */}
            <button type="button"
              disabled={!!motivoNoSePuedeMover(subject, activityMenu.a)}
              data-tooltip={motivoNoSePuedeMover(subject, activityMenu.a) || undefined}
              onClick={() => { const a = activityMenu.a; setActivityMenu(null); requestMoverParcial(a) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors text-left disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default">
              <ArrowRightLeft size={ICONO.sm} className="text-hint flex-shrink-0" /> Mover a otro parcial
            </button>
            <button type="button"
              onClick={() => { const a = activityMenu.a; setActivityMenu(null); setDeleteConfirm(a) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left border-t border-outline-variant">
              <Trash2 size={ICONO.sm} className="flex-shrink-0" /> Eliminar
            </button>
          </PanelFlotante>
      )}

      {/* ── Corrección rápida de calificación (clic derecho en la celda) ──
          Mismo patrón que el menú ⋮ de arriba: backdrop invisible + tarjeta
          fija pegada al punto donde se hizo clic. */}
      {gradeQuickEdit && (
          <PanelFlotante punto={{ x: gradeQuickEdit.x, y: gradeQuickEdit.y - 4 }} align="start" onCerrar={() => setGradeQuickEdit(null)} label={gradeQuickEdit.subId ? 'Corregir calificación' : 'Calificar (sin entrega)'} className="w-52 p-3 space-y-2">
            <p className="text-xs font-medium text-muted">{gradeQuickEdit.subId ? 'Corregir calificación' : 'Calificar (sin entrega)'}</p>
            <div className="flex items-center gap-1.5">
              <input
                type="number" min={0} max={gradeQuickEdit.maxCalif} step="0.1"
                ref={(el) => el?.focus()}
                value={gradeQuickEdit.value}
                onChange={(e) => setGradeQuickEdit((g) => ({ ...g, value: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') saveGradeQuickEdit(); if (e.key === 'Escape') setGradeQuickEdit(null) }}
                className="w-16 px-2 py-1.5 text-center text-sm font-bold border border-outline-variant rounded-full bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <span className="text-xs text-muted">/ {gradeQuickEdit.maxCalif}</span>
            </div>
            <div className="flex gap-1.5">
              <Button variant="secondary" onClick={() => setGradeQuickEdit(null)} disabled={savingQuickGrade} className="flex-1">
                Cancelar
              </Button>
              <Button icon={CheckIcon} busy={savingQuickGrade} className="flex-1" onClick={saveGradeQuickEdit} disabled={savingQuickGrade}>
                 Guardar
              </Button>
            </div>
            {gradeQuickEdit.subId && gradeQuickEdit.value !== '' && (
              <Button variant="secondary" fullWidth icon={Trash2} iconEffect="balanceo" className="min-h-control-sm"
                onClick={clearGradeQuickEdit}
                disabled={savingQuickGrade}>
                
                Quitar calificación
              </Button>
            )}
          </PanelFlotante>
      )}

      {/* ── Menú contextual: clic derecho en encabezado de actividad ─────────
          Mismo patrón que el menú ⋮ de actividades: backdrop invisible que
          cierra al hacer clic fuera + tarjeta fija pegada al cursor.         */}
      {activityContextMenu && (
          <PanelFlotante punto={{ x: activityContextMenu.x, y: activityContextMenu.y - 4 }} align="start" onCerrar={() => setActivityContextMenu(null)} label="Opciones de la columna">
            {activityContextMenu.missingCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setBulkGradeModal({
                    activity: activityContextMenu.activity,
                    missingCount: activityContextMenu.missingCount,
                  })
                  setBulkGradeValue('')
                  setActivityContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors text-left"
              >
                <ClipboardCheck size={ICONO.sm} className="text-hint flex-shrink-0" />
                Asignar calificación a no entregadas ({activityContextMenu.missingCount})
              </button>
            ) : (
              <p className="px-3 py-2.5 text-sm text-muted">
                Todos tienen entrega o calificación
              </p>
            )}
          </PanelFlotante>
      )}

      {/* ── Modal: asignar calificación masiva a no entregadas ───────────────
          Se abre desde el menú contextual del encabezado de actividad.
          NO incluye cierreParcial:true — es una calificación manual autónoma
          que el "Revertir parcial" no toca.                                  */}
      {bulkGradeModal && (
        <Modal open onClose={() => { if (!savingBulkGrade) { setBulkGradeModal(null); setBulkGradeValue('') } }} variant="sheet" z={40} padding="p-4" ariaLabel="Asignar calificación a no entregadas">
            <h3 className="text-base font-semibold text-on-surface">Asignar calificación a no entregadas</h3>
            <p className="text-sm text-muted mt-1 truncate">
              Actividad: <strong>{bulkGradeModal.activity.nombre}</strong>
            </p>
            <p className="text-sm text-muted mt-1">
              <strong>{bulkGradeModal.missingCount}</strong> estudiante{bulkGradeModal.missingCount !== 1 ? 's' : ''} no {bulkGradeModal.missingCount !== 1 ? 'han' : 'ha'} entregado esta actividad.
            </p>
            <p className="text-sm text-muted mt-2">
              Solo se afectarán los que sigan sin entrega al confirmar. Los que ya entregaron o ya tienen calificación <strong>no se tocan</strong>.
            </p>

            <div className="mt-4">
              <label htmlFor="bulk-grade-input" className="block text-sm font-medium text-muted mb-1">
                Calificación a asignar
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="bulk-grade-input"
                  type="number"
                  min="0"
                  max={bulkGradeModal.activity.maxCalif ?? 10}
                  step="0.5"
                  value={bulkGradeValue}
                  onChange={(e) => setBulkGradeValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') confirmBulkGradeNoEntregadas() }}
                  disabled={savingBulkGrade}
                  ref={(el) => el?.focus()}
                  className="w-24 py-1.5 text-center font-semibold text-on-surface"
                />
                <span className="text-sm text-muted">/ {bulkGradeModal.activity.maxCalif ?? 10}</span>
              </div>
              <p className="text-xs text-muted mt-1">Incrementos de 0.5 (ej. 0, 0.5, 1, 1.5…)</p>
            </div>

            <div className="flex gap-2 mt-4">
              <Button variant="secondary"
                onClick={() => { setBulkGradeModal(null); setBulkGradeValue('') }}
                disabled={savingBulkGrade} className="flex-1">
                Cancelar
              </Button>
              <Button className="flex-1"
                onClick={confirmBulkGradeNoEntregadas}
                disabled={savingBulkGrade || bulkGradeValue === ''}>
                {savingBulkGrade
                  ? <><Spinner size="sm" /> Guardando…</>
                  : `Asignar a ${bulkGradeModal.missingCount} estudiante${bulkGradeModal.missingCount !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </Modal>
      )}

      {/* ── Traer actividad de otra asignatura ── */}
      {importFor != null && (
        <Modal open onClose={() => setImportFor(null)} variant="sheet" size="md" z={40} padding="" className="flex flex-col" busy={importing}>
            <div className="px-4 py-3 border-b border-outline-variant flex items-center gap-2">
              {importSrc && (
                <button type="button" onClick={() => { setImportSrc(null); setImportSrcActs([]); setImportSel(new Set()) }}
                  aria-label="Volver"
                  className="size-control inline-flex items-center justify-center -ml-1 text-hint hover:text-accent rounded-full flex-shrink-0"><ArrowLeft size={ICONO.md} /></button>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-on-surface truncate">Traer al Parcial {importFor}</h3>
                <p className="text-xs text-muted truncate">
                  {importSrc ? `De: ${subjectDisplayName(importSrc)}` : 'Elige de cuál de tus asignaturas'}
                </p>
              </div>
              <button type="button" onClick={() => !importing && setImportFor(null)} aria-label="Cerrar" className="size-control inline-flex items-center justify-center text-hint rounded-full flex-shrink-0"><X size={ICONO.md} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {importLoading ? (
                <SkeletonList rows={5} className="py-4" />
              ) : !importSrc ? (
                importSubjects.length === 0 ? (
                  <p className="text-center text-sm text-hint py-8">No tienes otras asignaturas de dónde traer.</p>
                ) : (
                  <div className="space-y-1.5">
                    {importSubjects.map((s) => (
                      <button key={s.id} type="button" onClick={() => pickImportSubject(s)}
                        className="w-full flex items-center gap-3 p-3 rounded-card border border-outline-variant hover:border-accent hover:bg-[var(--accent-tint)] transition-colors text-left">
                        <div className="w-8 h-8 rounded-full bg-accent-light flex items-center justify-center flex-shrink-0">
                          <SubjectIcon iconKey={s.icon} size={ICONO.md} className="text-accent" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-on-surface truncate">{subjectDisplayName(s)}</p>
                          {s.archived && <p className="text-xs text-amber-600">Archivada</p>}
                        </div>
                        <ChevronRight size={ICONO.md} className="text-hint flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )
              ) : (
                importSrcActs.length === 0 ? (
                  <p className="text-center text-sm text-hint py-8">Esta asignatura no tiene actividades publicadas para traer.</p>
                ) : (
                  <div className="space-y-3">
                    {[...new Set(importSrcActs.map((a) => a.parcial))].sort((a, b) => a - b).map((pp) => (
                      <div key={pp}>
                        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">Parcial {pp}</p>
                        <div className="space-y-1">
                          {importSrcActs.filter((a) => a.parcial === pp).map((a) => {
                            const tipoLbl = a.categoria === 'examen' ? 'Examen' : a.categoria === 'cuestionario' ? 'Cuestionario' : a.categoria === 'observacion' ? 'Observación' : 'Entregable'
                            const checked = importSel.has(a.id)
                            return (
                              <Checkbox key={a.id} checked={checked} onChange={() => toggleImportSel(a.id)}
                                wrapperClassName={`items-center gap-2 px-3 py-2 rounded-card border transition-colors [&>span:last-child]:flex-1 [&>span:last-child]:min-w-0 ${checked ? 'border-accent bg-[var(--accent-tint)]' : 'border-outline-variant hover:border-accent'}`}
                                label={
                                  <span className="flex items-center gap-2 min-w-0 font-normal">
                                    <span className="flex-1 min-w-0 text-sm text-on-surface truncate">{a.nombre}</span>
                                    <span className="text-xs text-hint flex-shrink-0">{tipoLbl}</span>
                                  </span>
                                } />
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

            {importSrc && importSrcActs.length > 0 && (
              <div className="px-4 py-3 border-t border-outline-variant flex items-center gap-2">
                <span className="text-xs text-muted flex-1">{importSel.size} seleccionada{importSel.size !== 1 ? 's' : ''}</span>
                <Button icon={Copy} busy={importing} onClick={confirmImport} disabled={!importSel.size || importing}>
                  
                  {importing ? 'Trayendo…' : 'Traer como borrador'}
                </Button>
              </div>
            )}
          </Modal>
      )}

      {/* ── Kebab menu per parcial (Exportar / Cerrar) — fixed-positioned so the
          table's overflow container can't clip it ── */}
      {parcialMenu && (
          <PanelFlotante punto={{ x: parcialMenu.x, y: parcialMenu.y }} align="end" onCerrar={() => setParcialMenu(null)} label={`Opciones del Parcial ${parcialMenu.p}`} className="w-52">
            <div className="px-3 py-2 text-xs font-semibold text-muted border-b border-outline-variant">Parcial {parcialMenu.p}</div>
            {/* Acciones según el estado del parcial (estadoParcial en utils/ponderacion.js):
                abierto  → Iniciar atención de inquietudes · Cerrar definitivamente
                atención → Cerrar definitivamente
                cerrado  → Reabrir para atención de inquietudes */}
            {estadoParcial(subject, parcialMenu.p) === 'cerrado' ? (
              <button type="button"
                onClick={() => { const p = parcialMenu.p; setParcialMenu(null); setRevertParcialConfirm(p) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors text-left rounded-card">
                <RotateCcw size={ICONO.sm} className="text-amber-600 flex-shrink-0" /> Reabrir para atención de inquietudes
              </button>
            ) : (() => {
              const p = parcialMenu.p
              const pondOn = ponderacionActivaEnParcial(subject, p)
              const total = pondOn ? pesoTotalVivo(activities.filter((a) => a.parcial === p && !isDraftActivity(a))) : 10
              const sumOk = !pondOn || Math.abs(total - 10) <= 0.001
              // Mismo conjunto que usa la publicación al estudiante: solo lo que
              // cuenta para calificación (actividadesQueCuentan).
              const totalAtencion = pondOn ? pesoTotalVivo(activities.filter((a) => a.parcial === p && cuentaParaCalificacion(a))) : 10
              const atencionOk = !pondOn || Math.abs(totalAtencion - 10) <= 0.001
              return (
                <>
                  {estadoParcial(subject, p) === 'abierto' && (
                    <button type="button"
                      aria-disabled={!atencionOk}
                      onClick={() => { if (!atencionOk) return; setParcialMenu(null); setAtencionParcialConfirm(p) }}
                      data-tooltip={!atencionOk ? `La ponderación del Parcial ${p} suma ${totalAtencion} de 10 — debe sumar exactamente 10 para iniciar la atención de inquietudes` : undefined}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm transition-colors text-left rounded-card ${atencionOk ? 'text-on-surface hover:bg-[var(--accent-tint)]' : 'text-hint cursor-not-allowed'}`}>
                      <MessageCircleQuestion size={ICONO.sm} className={`flex-shrink-0 ${atencionOk ? 'text-accent' : 'text-hint'}`} />
                      <span className="flex-1">Iniciar atención de inquietudes</span>
                      {!atencionOk && <span className="text-[10px] font-semibold text-amber-600">{totalAtencion}/10</span>}
                    </button>
                  )}
                  <button type="button"
                    onClick={() => { setParcialMenu(null); requestCloseParcial(p) }}
                    data-tooltip={!sumOk ? `La ponderación del Parcial ${p} suma ${total} de 10 — ajústala hasta llegar a 10 para poder cerrar` : undefined}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors text-left rounded-card">
                    <Lock size={ICONO.sm} className="text-hint flex-shrink-0" />
                    <span className="flex-1">Cerrar definitivamente</span>
                    {!sumOk && <span className="text-[10px] font-semibold text-amber-600">{total}/10</span>}
                  </button>
                </>
              )
            })()}
          </PanelFlotante>
      )}

      {/* ── Revertir ponderación (todos los parciales) ── */}
      {confirmRevertPonderacion && (
        <Modal open onClose={() => setConfirmRevertPonderacion(false)} variant="sheet" z={40} padding="p-4" ariaLabel="¿Volver a promedio simple?">
            <h3 className="text-lg font-bold text-center text-on-surface">¿Volver a promedio simple?</h3>
            <p className="text-sm text-muted text-center mt-2">
              Al menos una actividad ya tiene ponderación. Los pesos capturados se borrarán y todas las actividades valdrán lo mismo.
            </p>
            <div className="flex gap-2 mt-4">
              <Button variant="secondary" onClick={() => setConfirmRevertPonderacion(false)} className="flex-1">
                Cancelar
              </Button>
              <button type="button" onClick={() => applyPonderacion(false)}
                className="flex-1 py-2 rounded bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800 transition-colors">
                Sí, promedio simple
              </button>
            </div>
          </Modal>
      )}

      {/* ── Revertir ponderación de UN parcial ── */}
      {confirmRevertParcial != null && (
        <Modal open onClose={() => setConfirmRevertParcial(null)} variant="sheet" z={40} padding="p-4">
            <h3 className="text-lg font-bold text-center text-on-surface">¿Parcial {confirmRevertParcial} con promedio simple?</h3>
            <p className="text-sm text-muted text-center mt-2">
              El Parcial {confirmRevertParcial} ya tiene pesos capturados. Se borrarán y ese parcial usará promedio simple.
            </p>
            <div className="flex gap-2 mt-4">
              <Button variant="secondary" onClick={() => setConfirmRevertParcial(null)} className="flex-1">
                Cancelar
              </Button>
              <button type="button" onClick={() => applyParcialPonderacion(confirmRevertParcial, false)}
                className="flex-1 py-2 rounded bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800 transition-colors">
                Sí, promedio simple
              </button>
            </div>
          </Modal>
      )}

      {/* ── Cerrar parcial: requires everything graded; no-entregas → 0 on proceed ── */}
      {closeParcialConfirm && (
        <Modal open onClose={() => setCloseParcialConfirm(null)} variant="sheet" z={40} padding="p-4" busy={closingParcial}>
            <h3 className="text-lg font-bold text-center text-on-surface">Cerrar definitivamente el Parcial {closeParcialConfirm.p}</h3>
            <p className="text-sm text-muted text-center mt-2">
              Para cerrar el parcial, <strong>todas las calificaciones deben estar puestas</strong>.
            </p>
            {closeParcialConfirm.pondError ? (
              <>
                {/* Blocker: ponderación must sum exactly 10 */}
                <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2 mt-3 leading-relaxed">
                  La ponderación del Parcial {closeParcialConfirm.p} suma <strong>{closeParcialConfirm.pondError.total} de 10</strong>.
                  Ajusta los pesos hasta que sumen 10 y vuelve a cerrar.
                </p>
                <Button fullWidth className="mt-4" onClick={() => setCloseParcialConfirm(null)}>
                  Entendido
                </Button>
              </>
            ) : closeParcialConfirm.ungraded > 0 ? (
              <>
                {/* Blocker: real deliveries need a manual grade, can't be auto-zeroed.
                    Se menciona también el total sin entrega (aunque esas SÍ se
                    autocalifican en 0 al cerrar, y no son las que bloquean) — pedido
                    explícito: antes, con ungraded>0, esta pantalla ocultaba por
                    completo el conteo de "sin entrega" (solo aparecía en la
                    siguiente, una vez resuelto lo de arriba), y "solo 3 sin
                    calificar" confundía a quien veía muchas más celdas en blanco
                    en la tabla — la mayoría de esas son "sin entrega", no entregas
                    reales pendientes de nota. */}
                <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 mt-3 leading-relaxed">
                  Hay <strong>{closeParcialConfirm.ungraded} entrega{closeParcialConfirm.ungraded !== 1 ? 's' : ''} sin calificar</strong>.
                  Como son entregas reales, califícalas tú antes de cerrar. Cancela, ponles calificación y vuelve a cerrar.
                  {closeParcialConfirm.missing.length > 0 && (
                    <> (Las {closeParcialConfirm.missing.length} celdas sin entrega no cuentan aquí — esas se ponen en 0 solas al cerrar.)</>
                  )}
                </p>
                <Button fullWidth className="mt-4" onClick={() => setCloseParcialConfirm(null)}>
                  Entendido
                </Button>
              </>
            ) : (
              <>
                {closeParcialConfirm.missing.length > 0 ? (
                  <>
                    <p className="text-sm text-muted text-center mt-2">
                      Faltan <strong>{closeParcialConfirm.missing.length} entrega{closeParcialConfirm.missing.length !== 1 ? 's' : ''}</strong> o
                      asigna desde aquí una misma calificación a todas juntas.
                    </p>
                    <div className="flex items-center justify-center gap-2 mt-3">
                      <label htmlFor="close-parcial-grade" className="text-sm text-muted">Calificación para todas:</label>
                      <Input
                        id="close-parcial-grade"
                        type="number"
                        min="0"
                        max={closeParcialConfirm.topeCalif ?? 10}
                        step="0.1"
                        value={closeParcialGrade}
                        onChange={(e) => setCloseParcialGrade(e.target.value)}
                        disabled={closingParcial}
                        className="w-20 py-1.5 text-center font-semibold text-on-surface"
                      />
                      <span className="text-sm text-muted">/ {closeParcialConfirm.topeCalif ?? 10}</span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted text-center mt-2">Todo está calificado. Puedes cerrar el parcial.</p>
                )}
                {/* Sesiones del parcial — se propone la estimación del servidor; el docente confirma o ajusta */}
                <div className="flex items-center justify-center gap-2 mt-3">
                  <label htmlFor="close-parcial-sesiones" className="text-sm text-muted">Sesiones del parcial:</label>
                  <Input
                    id="close-parcial-sesiones"
                    type="number"
                    min="1"
                    value={closeParcialSesiones}
                    onChange={(e) => setCloseParcialSesiones(e.target.value)}
                    disabled={closingParcial}
                    className="w-20 py-1.5 text-center font-semibold text-on-surface"
                  />
                </div>
                <div className="flex gap-2 mt-4">
                  <Button variant="secondary" onClick={() => setCloseParcialConfirm(null)} disabled={closingParcial} className="flex-1">
                    Cancelar
                  </Button>
                  <Button className="flex-1" onClick={confirmCloseParcial} disabled={closingParcial}>
                    {closingParcial ? 'Cerrando…' : (closeParcialConfirm.missing.length > 0 ? `Cerrar y poner ${Math.min(Math.max(0, parseFloat(closeParcialGrade) || 0), closeParcialConfirm.topeCalif ?? 10)}` : 'Cerrar parcial')}
                  </Button>
                </div>
              </>
            )}
          </Modal>
      )}

      {/* ── Reabrir el parcial: vuelve a atención de inquietudes y borra las calificaciones del cierre ── */}
      {revertParcialConfirm != null && (
        <Modal open onClose={() => setRevertParcialConfirm(null)} variant="sheet" z={40} padding="p-4" busy={revertingParcial}>
            <h3 className="text-lg font-bold text-center text-on-surface">¿Reabrir el Parcial {revertParcialConfirm} para atención de inquietudes?</h3>
            <p className="text-sm text-muted text-center mt-2">
              Tus estudiantes siguen viendo su resultado y podrás corregir calificaciones. Las calificaciones que se pusieron al cerrar se eliminarán: esas no entregas volverán a quedar <strong>solo sin entrega</strong>, como antes de cerrar. Las calificaciones que pusiste a mano no se tocan.
            </p>
            <div className="flex gap-2 mt-4">
              <Button variant="secondary" onClick={() => setRevertParcialConfirm(null)} disabled={revertingParcial} className="flex-1">
                Cancelar
              </Button>
              <Button className="flex-1" onClick={revertCloseParcial} disabled={revertingParcial}>
                {revertingParcial ? 'Reabriendo…' : 'Reabrir'}
              </Button>
            </div>
          </Modal>
      )}

      {/* ── Iniciar atención de inquietudes: publica el resultado del parcial ── */}
      {atencionParcialConfirm != null && (
        <Modal open onClose={() => setAtencionParcialConfirm(null)} variant="sheet" z={40} padding="p-4" busy={iniciandoAtencion}>
            <h3 className="text-lg font-bold text-center text-on-surface">¿Iniciar la atención de inquietudes del Parcial {atencionParcialConfirm}?</h3>
            <p className="text-sm text-muted text-center mt-2">
              {ponderacionActivaEnParcial(subject, atencionParcialConfirm)
                ? <>Tus estudiantes podrán ver <strong>los pesos de las actividades y su calificación ponderada</strong> del parcial para revisarla. Una vez publicada ya no vuelve a ocultarse.</>
                : <>El parcial pasa a atención de inquietudes.</>}
              {' '}Podrás seguir corrigiendo calificaciones y después cerrarlo definitivamente.
            </p>
            <div className="flex gap-2 mt-4">
              <Button variant="secondary" onClick={() => setAtencionParcialConfirm(null)} disabled={iniciandoAtencion} className="flex-1">
                Cancelar
              </Button>
              <Button className="flex-1" onClick={confirmIniciarAtencion} disabled={iniciandoAtencion}>
                {iniciandoAtencion ? 'Iniciando…' : 'Iniciar atención'}
              </Button>
            </div>
          </Modal>
      )}

      {/* ── Same-name found: link to existing account or create new ── */}
      {linkCandidate && (
        <Modal open onClose={() => setLinkCandidate(null)} variant="sheet" z={40} padding="p-4" busy={savingStudent} ariaLabel="¿Es el mismo estudiante?">
            <div className="w-12 h-12 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-2">
              <UserPlus size={ICONO.lg} className="text-accent" />
            </div>
            <h3 className="text-lg font-bold text-center text-on-surface">¿Es el mismo estudiante?</h3>
            {linkCandidate.identity.parecido ? (
              // Nombre PARECIDO: aquí la diferencia entre los dos nombres ES
              // la pregunta, así que se enseñan los dos, uno debajo del otro.
              // Con un solo nombre en pantalla el docente no puede decidir.
              <>
                <p className="text-sm text-muted text-center mt-2">
                  Ya hay un estudiante con un nombre <strong>muy parecido</strong> en esta escuela
                  {(() => {
                    const n = new Set(linkCandidate.identity.matches.map((m) => m.asignaturaId)).size
                    return n ? ` (inscrito en ${n} asignatura${n !== 1 ? 's' : ''})` : ''
                  })()}:
                </p>
                <div className="mt-2 rounded bg-surface-container px-3 py-2 text-sm">
                  <p className="text-muted text-xs">Ya existe</p>
                  <p className="text-on-surface font-semibold">{studentFullName(linkCandidate.identity.matches[0])}</p>
                  <p className="text-muted font-mono text-xs">{linkCandidate.identity.username}</p>
                  <p className="text-muted text-xs mt-2">Estás agregando</p>
                  <p className="text-on-surface font-semibold">{studentFullName(linkCandidate.person)}</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted text-center mt-2">
                Ya hay un estudiante llamado{' '}
                <strong>{studentFullName(linkCandidate.person)}</strong>{' '}
                en esta escuela
                {(() => {
                  const n = new Set(linkCandidate.identity.matches.map((m) => m.asignaturaId)).size
                  return n ? ` (inscrito en ${n} asignatura${n !== 1 ? 's' : ''})` : ''
                })()}.
              </p>
            )}
            <p className="text-sm text-muted text-center mt-2">
              Si es la <strong>misma persona</strong>, se agrega esta asignatura a su cuenta (mismo usuario
              <span className="font-mono"> {linkCandidate.identity.username}</span>). Si es <strong>otra persona</strong>{linkCandidate.identity.parecido ? '' : ' con el mismo nombre'}, se crea una cuenta nueva.
            </p>
            {linkCandidate.identity.parecido && (
              <p className="text-sm text-muted text-center mt-2">
                Si es la misma y su nombre está mal escrito en algún lado, corrígelo después desde su
                ficha — su usuario no cambia.
              </p>
            )}
            <div className="flex flex-col gap-2 mt-4">
              <Button fullWidth icon={CheckIcon} busy={savingStudent}
                onClick={() => resolveLinkCandidate(true)}
                disabled={savingStudent}>
                
                Sí, es el mismo estudiante
              </Button>
              <Button variant="secondary" fullWidth
                onClick={() => resolveLinkCandidate(false)}
                disabled={savingStudent}
              >
                No, es otro estudiante (cuenta nueva)
              </Button>
              <button type="button"
                onClick={() => setLinkCandidate(null)}
                disabled={savingStudent}
                className="w-full py-2 text-sm text-muted hover:text-on-surface transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </Modal>
      )}

      {/* ── Vista previa antes de importar el Excel de estudiantes ── pedido
          explícito: revisar y confirmar antes de escribir en Firestore, y
          avisar de filas que no se pudieron leer en vez de que
          desaparezcan en silencio. */}
      {excelPreview && (
        <Modal open onClose={() => setExcelPreview(null)} variant="sheet" size="lg" z={40} padding="" className="flex flex-col" busy={importingExcel} ariaLabel="Revisa antes de importar">
            <div className="p-4 border-b border-outline-variant flex-shrink-0 flex items-center justify-between">
              <h3 className="text-base font-semibold text-on-surface">Revisa antes de importar</h3>
              <button type="button" onClick={() => !importingExcel && setExcelPreview(null)} aria-label="Cerrar" className="size-control inline-flex items-center justify-center text-hint hover:text-muted rounded-full"><X size={ICONO.md} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {excelPreview.invalid.length > 0 && (
                <div className="rounded-card border border-amber-300 bg-amber-50 p-3">
                  <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                    <AlertTriangle size={ICONO.sm} className="flex-shrink-0" /> {excelPreview.invalid.length} fila{excelPreview.invalid.length !== 1 ? 's' : ''} no se {excelPreview.invalid.length !== 1 ? 'pudieron' : 'pudo'} leer
                  </p>
                  <ul className="mt-1.5 space-y-0.5 text-xs text-amber-800">
                    {excelPreview.invalid.map((inv) => (
                      <li key={inv.fila}>Fila {inv.fila} del Excel: “{inv.texto || '(vacía)'}”</li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-sm text-amber-700">Estas filas se van a omitir. Corrígelas en el archivo y vuelve a subirlo si quieres incluirlas.</p>
                </div>
              )}
              {excelPreview.rows.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                    {excelPreview.rows.filter((r) => r.status !== 'skip' && r.status !== 'duplicate').length} estudiante{excelPreview.rows.filter((r) => r.status !== 'skip' && r.status !== 'duplicate').length !== 1 ? 's' : ''} se van a agregar
                  </p>
                  {/* Aviso UNA sola vez, no por fila: antes una coincidencia de
                      nombre se vinculaba a la cuenta existente sin preguntar —
                      distinto al alta manual, que siempre pregunta "¿es el
                      mismo estudiante?". Con nombres comunes eso fusionaba en
                      silencio a dos personas reales en una sola cuenta. Ahora
                      "Cuenta existente" es el badge por default (la propuesta
                      más probable), pero se puede voltear por fila. */}
                  {excelPreview.rows.some((r) => r.status === 'link' && !r.parecido) && (
                    <p className="text-sm text-muted bg-surface-container rounded px-2.5 py-1.5 mb-1.5">
                      Los marcados <strong>Cuenta existente</strong> coinciden con un nombre que ya está en la
                      escuela y se van a unir a esa cuenta. Si alguno es <strong>otra persona</strong> que solo
                      comparte el nombre, tócalo para darle una cuenta nueva.
                    </p>
                  )}
                  {/* Nombre PARECIDO, no idéntico. La propuesta por default es
                      cuenta nueva —un parecido no une a dos personas sin que
                      nadie lo mire— pero la fila va en ámbar para que no pase
                      desapercibida: es el caso que partió en dos a una alumna
                      real. */}
                  {excelPreview.rows.some((r) => r.parecido) && (
                    <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-card px-2.5 py-1.5 mb-1.5">
                      Los marcados en <strong>ámbar</strong> se parecen mucho a alguien que ya está en la escuela
                      (una letra de diferencia, un nombre de más). Por si acaso se les da una{' '}
                      <strong>cuenta nueva</strong>. Si en realidad es la misma persona, tócalos: así conserva
                      su usuario y sus otras materias.
                    </p>
                  )}
                  {/* 'duplicate': mismo nombre repetido dos veces en ESTE
                      archivo (fila copiada de más) — solo la primera se
                      procesa, las demás se omiten para no crear dos cuentas
                      de la misma persona. */}
                  {excelPreview.rows.some((r) => r.status === 'duplicate') && (
                    <p className="text-sm text-muted bg-surface-container rounded px-2.5 py-1.5 mb-1.5">
                      Los marcados <strong>Repetido</strong> tienen el mismo nombre que otra fila de este mismo
                      archivo — solo se agrega la primera, el resto se omite.
                    </p>
                  )}
                  <ul className="space-y-1">
                    {excelPreview.rows.map((item, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-sm px-2.5 py-1.5 rounded-card bg-surface border border-outline-variant">
                        <span className="text-on-surface truncate">{studentFullName(item.row)}</span>
                        {item.status === 'new' && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded flex-shrink-0">Nuevo</span>}
                        {item.status === 'link' && (
                          <button
                            type="button"
                            onClick={() => toggleImportLinkDecision(i)}
                            data-tooltip={item.parecido
                              ? (item.decision === 'link'
                                ? `Se unirá a ${studentFullName(item.identity.matches[0])} (${item.identity.username}). Toca si es otra persona.`
                                : `Se parece a ${studentFullName(item.identity.matches[0])} (${item.identity.username}). Toca si es la misma persona.`)
                              : (item.decision === 'link'
                                ? 'Toca si es otra persona que solo comparte el nombre'
                                : 'Toca si en realidad es la misma persona')}
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 transition-colors ${
                              item.decision === 'link'
                                ? 'text-accent bg-accent-light hover:bg-[var(--accent-tint)]'
                                : item.parecido
                                  ? 'text-amber-800 bg-amber-50 hover:bg-amber-100'
                                  : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                            }`}
                          >
                            {item.decision === 'link'
                              ? 'Cuenta existente ✎'
                              : item.parecido ? 'Cuenta nueva — ¿es la misma? ✎' : 'Cuenta nueva ✎'}
                          </button>
                        )}
                        {item.status === 'skip' && <span className="text-[10px] font-semibold text-muted bg-surface-container px-1.5 py-0.5 rounded flex-shrink-0">Ya inscrito — se omite</span>}
                        {item.status === 'duplicate' && <span className="text-[10px] font-semibold text-muted bg-surface-container px-1.5 py-0.5 rounded flex-shrink-0">Repetido — se omite</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted text-center py-6">No hay estudiantes válidos para importar.</p>
              )}
            </div>
            <div className="p-3 border-t border-outline-variant flex-shrink-0 flex gap-2">
              <Button variant="secondary" onClick={() => setExcelPreview(null)} disabled={importingExcel} className="flex-1">
                Cancelar
              </Button>
              <Button icon={CheckIcon} busy={importingExcel} className="flex-1" onClick={confirmExcelImport}
                disabled={importingExcel || excelPreview.rows.every((r) => r.status === 'skip' || r.status === 'duplicate')}>
                
                {importingExcel ? 'Importando…' : 'Confirmar e importar'}
              </Button>
            </div>
          </Modal>
      )}

      {/* ── Reset password result ── */}
      {resetPwdResult && (
        <Modal open onClose={() => setResetPwdResult(null)} variant="sheet" z={40} padding="p-4" ariaLabel="Contraseña restablecida">
            <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-2">
              <KeyRound size={ICONO.lg} className="text-green-600" />
            </div>
            <h3 className="text-lg font-bold text-center text-on-surface">Contraseña restablecida</h3>
            <p className="text-sm text-muted text-center mt-2">
              <strong>{studentFullName(resetPwdResult.student)}</strong>{' '}
              ya puede establecer una nueva contraseña desde la pantalla de acceso.
            </p>
            <Button fullWidth className="mt-4"
              onClick={() => setResetPwdResult(null)}>
              Entendido
            </Button>
          </Modal>
      )}

      {/* ── Delete student confirmation ── */}
      {studentToDelete && (
        <Modal open onClose={() => setStudentToDelete(null)} variant="sheet" z={40} padding="p-4" ariaLabel="¿Eliminar estudiante?">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-2">
              <Trash2 size={ICONO.lg} className="text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-center text-on-surface">¿Eliminar estudiante?</h3>
            <p className="text-sm text-muted text-center mt-2">
              Se eliminará a{' '}
              <strong>{studentFullName(studentToDelete)}</strong>{' '}
              ({studentToDelete.username}). Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2 mt-4">
              <Button variant="secondary" className="flex-1"
                onClick={() => setStudentToDelete(null)}
              >
                Cancelar
              </Button>
              <Button variant="danger" icon={Trash2} iconEffect="balanceo" busy={savingStudent} className="flex-1"
                onClick={confirmDeleteStudent}
                disabled={savingStudent}>
                
                Eliminar
              </Button>
            </div>
          </Modal>
      )}
      {/* ── Edit subject modal ── */}
      {showEditSubjectModal && (
        <Modal open onClose={() => setShowEditSubjectModal(false)} variant="sheet" size="md" padding="p-4" className="overflow-x-hidden" ariaLabel="Editar asignatura">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Editar asignatura</h3>
              <IconButton icon={X} label="Cerrar" tooltip={false} className="-mr-2" onClick={() => setShowEditSubjectModal(false)} />
            </div>
            <form onSubmit={handleEditSubject} className="space-y-2">
              <Input
                label="Asignatura" id="edit-subject-nombre" type="text" value={editSubjectForm.nombre} onChange={(e) => setEditSubjectForm((f) => ({ ...f, nombre: e.target.value }))}
                required />
              <Input
                label="Grupo" id="edit-subject-grupo" type="text" value={editSubjectForm.grupo} onChange={(e) => setEditSubjectForm((f) => ({ ...f, grupo: e.target.value }))}
                required />
              <div>
                <p className="block text-sm font-medium text-muted mb-1">
                  Fechas <span className="text-accent font-normal text-xs">(recomendado)</span>
                </p>
                <p className="text-sm text-muted mb-1.5">Con fechas de inicio y fin, los días para marcar asistencia se generan de forma automática y cada parcial queda organizado por periodo. Si tu escuela aún no define calendario, puedes dejarlo así y elegirlas después.</p>
                <div className="space-y-2">
                  <div>
                    <span className="block text-sm text-muted mb-1">Inicio</span>
                    <EFDateTimePicker mode="date" etiqueta="Inicio del curso" value={editSubjectForm.fechaInicio} onChange={v => setEditSubjectForm(f => ({ ...f, fechaInicio: v }))} />
                  </div>
                  <div>
                    <span className="block text-sm text-muted mb-1">Fin</span>
                    <EFDateTimePicker mode="date" etiqueta="Fin del curso" value={editSubjectForm.fechaFin} onChange={v => setEditSubjectForm(f => ({ ...f, fechaFin: v }))}
                      minDateTime={editSubjectForm.fechaInicio ? addOneDay(editSubjectForm.fechaInicio) : undefined}
                      disabled={!editSubjectForm.fechaInicio} />
                  </div>
                </div>
              </div>
              <div>
                <Select
                  id="edit-subject-parciales"
                  label="Número de parciales"
                  value={editSubjectForm.parciales}
                  onChange={(v) => setEditSubjectForm((f) => ({ ...f, parciales: v }))}
                  options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} ${n === 1 ? 'parcial' : 'parciales'}` }))}
                />
              </div>
              {editSubjectForm.fechaInicio && editSubjectForm.fechaFin && (
                <ParcialesFechas
                  fechaInicio={editSubjectForm.fechaInicio}
                  fechaFin={editSubjectForm.fechaFin}
                  numParciales={parseInt(editSubjectForm.parciales) || 3}
                  value={editSubjectForm.parcialesFechas}
                  onChange={(v) => setEditSubjectForm((f) => ({ ...f, parcialesFechas: v }))}
                />
              )}
              <div>
                <p className="block text-sm font-medium text-muted mb-2">Color de la asignatura <span className="text-hint font-normal text-xs">(elige el color base que identificará a la asignatura)</span></p>
                <PaletteSelect value={editSubjectForm.colorPalette} onChange={(p) => setEditSubjectForm((f) => ({ ...f, colorPalette: p }))} />
              </div>
              <div {...subjectPaletteProps(editSubjectForm.colorPalette)}>
                <p className="block text-sm font-medium text-muted mb-2">Icono de la asignatura</p>
                <IconSelect value={editSubjectForm.icon} onChange={(ic) => setEditSubjectForm((f) => ({ ...f, icon: ic }))} />
              </div>
              {/* pie-hoja: el botón se queda fijo abajo, igual que en «Nueva
                  asignatura» (crear y editar se ven y se usan igual). */}
              <div className="pie-hoja">
                <Button type="submit" size="lg" fullWidth icon={Pencil} busy={editingSubject}
                  disabled={editingSubject || faltanEditar.length > 0 || !editSubjectChanged}>
                  {editingSubject ? 'Guardando…' : 'Guardar cambios'}
                </Button>
                <MotivoApagado faltan={faltanEditar} sinCambios={!editSubjectChanged} />
              </div>
            </form>
          </Modal>
      )}

      {/* ── Copy subject modal ── */}
      {showCopyModal && (
        <Modal open onClose={() => setShowCopyModal(false)} variant="sheet" size="md" padding="p-4" className="overflow-x-hidden" ariaLabel="Duplicar asignatura">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Duplicar asignatura</h3>
              <IconButton icon={X} label="Cerrar" tooltip={false} className="-mr-2" onClick={() => setShowCopyModal(false)} />
            </div>
            <form onSubmit={handleCopySubject} className="space-y-2">
              <Input
                label="Asignatura" id="copy-subject-nombre" type="text" value={copyForm.nombre} onChange={(e) => setCopyForm((f) => ({ ...f, nombre: e.target.value }))}
                required />
              <Input
                label="Grupo" id="copy-subject-grupo" type="text" value={copyForm.grupo} onChange={(e) => setCopyForm((f) => ({ ...f, grupo: e.target.value }))}
                required />
              <div>
                <p className="block text-sm font-medium text-muted mb-1">
                  Fechas <span className="text-accent font-normal text-xs">(recomendado)</span>
                </p>
                <p className="text-sm text-muted mb-1.5">Con fechas de inicio y fin, los días para marcar asistencia se generan de forma automática y cada parcial queda organizado por periodo. Si tu escuela aún no define calendario, puedes dejarlo así y elegirlas después.</p>
                <div className="space-y-2">
                  <div>
                    <span className="block text-sm text-muted mb-1">Inicio</span>
                    <EFDateTimePicker mode="date" etiqueta="Inicio del curso" value={copyFechas.fechaInicio} onChange={v => setCopyFechas(f => ({ ...f, fechaInicio: v }))} />
                  </div>
                  <div>
                    <span className="block text-sm text-muted mb-1">Fin</span>
                    <EFDateTimePicker mode="date" etiqueta="Fin del curso" value={copyFechas.fechaFin} onChange={v => setCopyFechas(f => ({ ...f, fechaFin: v }))}
                      minDateTime={copyFechas.fechaInicio ? addOneDay(copyFechas.fechaInicio) : undefined}
                      disabled={!copyFechas.fechaInicio} />
                  </div>
                </div>
              </div>
              <div>
                <p className="block text-sm font-medium text-muted mb-2">Color de la asignatura <span className="text-hint font-normal text-xs">(elige el color base que identificará a la asignatura)</span></p>
                <PaletteSelect value={copyForm.colorPalette} onChange={(p) => setCopyForm((f) => ({ ...f, colorPalette: p }))} />
              </div>
              <div {...subjectPaletteProps(copyForm.colorPalette)}>
                <p className="block text-sm font-medium text-muted mb-2">Icono de la asignatura</p>
                <IconSelect value={copyForm.icon} onChange={(ic) => setCopyForm((f) => ({ ...f, icon: ic }))} />
              </div>
              <Checkbox
                checked={copyForm.keepStudents}
                onChange={(e) => setCopyForm((f) => ({ ...f, keepStudents: e.target.checked }))}
                label="Copiar lista de estudiantes"
                hint="Conservan su mismo usuario y cuenta; quienes ya activaron verán esta asignatura al instante"
                wrapperClassName="p-3 rounded-card border border-outline-variant hover:bg-[var(--accent-tint)] transition-colors"
              />
              <p className="text-sm text-muted">Se duplicarán todas las actividades. Las calificaciones y entregas no se copian.</p>
              <div className="pie-hoja">
                <Button type="submit" size="lg" fullWidth icon={Copy} busy={copyingSubject}
                  disabled={copyingSubject || faltanDuplicar.length > 0}>
                  {copyingSubject ? 'Duplicando…' : 'Duplicar asignatura'}
                </Button>
                <MotivoApagado faltan={faltanDuplicar} />
              </div>
            </form>
          </Modal>
      )}

      {/* ── Delete subject confirm modal ── */}
      {showDeleteSubjectConfirm && (
        <Modal open onClose={() => { setShowDeleteSubjectConfirm(false); setDeleteSubjectConfirmText('') }} variant="centered" padding="p-4" ariaLabel="¿Eliminar asignatura?">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-2">
              <Trash2 size={ICONO.lg} className="text-red-500" />
            </div>
            <h3 className="text-base font-semibold text-on-surface text-center mb-1">¿Eliminar asignatura?</h3>
            <p className="text-sm text-muted text-center mb-2">
              Se borrarán permanentemente todas las actividades, entregas, asistencias y estudiantes de{' '}
              <strong>{subject?.nombre}</strong>. Esta acción <strong>no se puede deshacer</strong>.
            </p>
            <p className="text-xs text-muted mb-2">Escribe <strong>{subject?.nombre}</strong> para confirmar:</p>
            <Input
              type="text"
              value={deleteSubjectConfirmText}
              onChange={(e) => setDeleteSubjectConfirmText(e.target.value)}
              className="focus-visible:ring-red-400 mb-2"
              aria-label={subject?.nombre}
            />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { setShowDeleteSubjectConfirm(false); setDeleteSubjectConfirmText('') }} className="flex-1">Cancelar</Button>
              <Button variant="danger" icon={Trash2} iconEffect="balanceo" busy={deletingSubject} className="flex-1" onClick={handleDeleteSubject}
                disabled={deletingSubject || deleteSubjectConfirmText !== subject?.nombre}>
                
                {deletingSubject ? 'Eliminando…' : 'Eliminar todo'}
              </Button>
            </div>
          </Modal>
      )}

      {/* ── Unarchive modal ── */}
      {/* ── Archive modal ── */}
      {showArchiveModal && (
        <Modal open onClose={() => setShowArchiveModal(false)} variant="sheet" padding="p-4" busy={archiving} ariaLabel="Archivar asignatura">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold">Archivar asignatura</h3>
              <IconButton icon={X} label="Cerrar" tooltip={false} className="-mr-2" onClick={() => !archiving && setShowArchiveModal(false)} />
            </div>
            <p className="text-sm text-muted mb-3">
              Archivar solo la saca de tus asignaturas activas. <strong>No se borra nada</strong>:
              actividades, estudiantes, entregas y calificaciones se quedan completas, y puedes
              desarchivarla cuando quieras.
            </p>
            {/* Lo que pasa del lado del ESTUDIANTE — el modal antes solo hablaba
                de lo que veía el docente. Es literal lo que hace el código: su
                dashboard filtra por `archived` y la manda a la sección
                "Asignaturas archivadas", desde donde la puede seguir abriendo. */}
            <div className="rounded-card border border-outline-variant bg-surface p-3 mb-3">
              <p className="text-sm font-semibold text-on-surface mb-1">Qué van a ver tus estudiantes</p>
              <ul className="text-sm text-muted space-y-0.5">
                <li>• <strong>{subject?.nombre}</strong> sale de sus asignaturas y se va a «Asignaturas archivadas».</li>
                <li>• Ahí la pueden seguir abriendo, con sus entregas y calificaciones completas.</li>
              </ul>
            </div>
            {/* El respaldo ZIP es solo de la web: bajar un paquete con TODAS
                las entregas es trabajo de computadora, y ahí el archivo queda
                donde el docente lo va a encontrar. Archivar sí se puede desde
                la app; en vez de esconder la opción sin explicación, se le
                dice dónde está — si la necesita, todavía está a tiempo de ir
                por ella antes de archivar. */}
            {IS_NATIVE_APP ? (
              <div className="flex items-start gap-2 p-3 mb-4 rounded-card border border-amber-200 bg-amber-50">
                <AlertTriangle size={ICONO.sm} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-900">¿Quieres el respaldo ZIP de las entregas?</p>
                  <p className="text-sm text-amber-800">Archiva desde la versión web para descargarlo. Aquí puedes archivar, pero el ZIP solo se guarda desde la computadora.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                <Checkbox checked={archiveConZip} onChange={(e) => setArchiveConZip(e.target.checked)}
                  wrapperClassName="p-3 rounded-card border border-outline-variant hover:bg-[var(--accent-tint)] transition-colors"
                  label={
                    <span className="block">
                      <span className="block text-sm font-medium text-on-surface">Descargar también un respaldo ZIP</span>
                      <span className="block text-sm font-normal text-muted">Opcional — las entregas no se van a borrar</span>
                    </span>
                  } />
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowArchiveModal(false)} disabled={archiving}
                className="flex-1">Cancelar</Button>
              <Button icon={Archive} busy={archiving} className="flex-1" onClick={handleArchiveConfirm} disabled={archiving}>
                
                {archiving
                  ? (zipDownloading
                      ? `Descargando ${zipProgress.done}/${zipProgress.total}…`
                      : 'Archivando…')
                  : 'Archivar'}
              </Button>
            </div>
          </Modal>
      )}

      {/* ── Unarchive (restore) modal ── */}
      {showUnarchiveModal && (
        <Modal open onClose={() => setShowUnarchiveModal(false)} variant="sheet" size="md" padding="p-4" className="overflow-x-hidden" ariaLabel="Desarchivar asignatura">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Desarchivar asignatura</h3>
              <IconButton icon={X} label="Cerrar" tooltip={false} className="-mr-2" onClick={() => setShowUnarchiveModal(false)} />
            </div>
            <p className="text-sm text-muted mb-2">Puedes editar los datos y elegir cómo restaurar:</p>

            <div className="space-y-2 mb-4">
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Datos</p>
                <div className="space-y-2">
                  {/* Mismos campos, con su etiqueta, que Nueva y Editar asignatura. */}
                  <Input label="Asignatura" id="unarchive-subject-nombre" type="text" value={unarchiveEdits.nombre} onChange={(e) => setUnarchiveEdits((f) => ({ ...f, nombre: e.target.value }))} required />
                  <Input label="Grupo" id="unarchive-subject-grupo" type="text" value={unarchiveEdits.grupo} onChange={(e) => setUnarchiveEdits((f) => ({ ...f, grupo: e.target.value }))} required />
                  <div className="space-y-2">
                    <div>
                      <span className="block text-sm text-muted mb-1">Inicio</span>
                      <EFDateTimePicker mode="date" etiqueta="Inicio del curso" value={unarchiveEdits.fechaInicio} onChange={v => setUnarchiveEdits(f => ({ ...f, fechaInicio: v }))} />
                    </div>
                    <div>
                      <span className="block text-sm text-muted mb-1">Fin</span>
                      <EFDateTimePicker mode="date" etiqueta="Fin del curso" value={unarchiveEdits.fechaFin} onChange={v => setUnarchiveEdits(f => ({ ...f, fechaFin: v }))}
                        minDateTime={unarchiveEdits.fechaInicio ? addOneDay(unarchiveEdits.fechaInicio) : undefined}
                        disabled={!unarchiveEdits.fechaInicio} />
                    </div>
                  </div>
                  <Select
                    id="unarchive-subject-parciales"
                    label="Número de parciales"
                    value={unarchiveEdits.parciales}
                    onChange={(v) => setUnarchiveEdits((f) => ({ ...f, parciales: v }))}
                    options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} ${n === 1 ? 'parcial' : 'parciales'}` }))}
                  />
                  {unarchiveEdits.fechaInicio && unarchiveEdits.fechaFin && (
                    <ParcialesFechas
                      fechaInicio={unarchiveEdits.fechaInicio}
                      fechaFin={unarchiveEdits.fechaFin}
                      numParciales={parseInt(unarchiveEdits.parciales) || 3}
                      value={unarchiveEdits.parcialesFechas}
                      onChange={(v) => setUnarchiveEdits((f) => ({ ...f, parcialesFechas: v }))}
                    />
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Color de la asignatura <span className="normal-case font-normal text-hint">(el color base que la identificará)</span></p>
                <PaletteSelect value={unarchiveEdits.colorPalette} onChange={(p) => setUnarchiveEdits((f) => ({ ...f, colorPalette: p }))} />
              </div>

              <div {...subjectPaletteProps(unarchiveEdits.colorPalette)}>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Icono de la asignatura</p>
                <IconSelect value={unarchiveEdits.icon} onChange={(ic) => setUnarchiveEdits((f) => ({ ...f, icon: ic }))} />
              </div>

              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Lista de estudiantes</p>
                <div className="space-y-1.5">
                  {[
                    { val: 'keep', label: 'Conservar lista', desc: 'Estudiantes y calificaciones se mantienen' },
                    { val: 'reset', label: 'Borrar y empezar de cero', desc: 'Se eliminan estudiantes y sus entregas' },
                  ].map(({ val, label, desc }) => (
                    <Radio key={val} name="unarchiveStudents" value={val} checked={unarchiveStudents === val} onChange={() => setUnarchiveStudents(val)}
                      label={label} hint={desc}
                      wrapperClassName={`p-3 rounded-card border transition-colors ${unarchiveStudents === val ? 'border-accent bg-accent-light' : 'border-outline-variant hover:bg-[var(--accent-tint)]'}`} />
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Actividades</p>
                <div className="space-y-1.5">
                  {[
                    { val: 'keep', label: 'Conservar visibilidad actual' },
                    { val: 'show', label: 'Mostrar todas' },
                    { val: 'hide', label: 'Ocultar todas' },
                  ].map(({ val, label }) => (
                    <Radio key={val} name="unarchiveActivities" value={val} checked={unarchiveActivities === val} onChange={() => setUnarchiveActivities(val)}
                      label={label}
                      wrapperClassName={`p-3 rounded-card border transition-colors ${unarchiveActivities === val ? 'border-accent bg-accent-light' : 'border-outline-variant hover:bg-[var(--accent-tint)]'}`} />
                  ))}
                </div>
              </div>
            </div>

            <div className="pie-hoja">
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" className="flex-1" onClick={() => setShowUnarchiveModal(false)}>Cancelar</Button>
                <Button size="lg" className="flex-1" busy={unarchivedSaving} onClick={handleUnarchiveConfirm} disabled={unarchivedSaving || faltanDesarchivar.length > 0}>
                  {unarchivedSaving ? 'Guardando…' : 'Desarchivar'}
                </Button>
              </div>
              <MotivoApagado faltan={faltanDesarchivar} />
            </div>
          </Modal>
      )}

      {/* ── Add/Edit resource modal ── */}
      {showResourceModal && (
        <Modal open onClose={() => setShowResourceModal(false)} variant="sheet" z={40} padding="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{resourceModalMode === 'create' ? 'Agregar recurso' : 'Editar recurso'}</h3>
              <IconButton icon={X} label="Cerrar" tooltip={false} className="-mr-2" onClick={() => setShowResourceModal(false)} />
            </div>
            <form onSubmit={handleSaveResource} className="space-y-2">
              <Input
                label="Nombre del recurso"
                id="resource-nombre"
                type="text"
                value={resourceForm.nombre}
                onChange={(e) => setResourceForm((f) => ({ ...f, nombre: e.target.value }))}
                required
              />
              <div>
                <label htmlFor="resource-descripcion" className="block text-xs font-medium text-muted mb-1">Descripción (opcional)</label>
                <textarea
                  id="resource-descripcion"
                  value={resourceForm.descripcion}
                  onChange={(e) => setResourceForm((f) => ({ ...f, descripcion: e.target.value }))}
                  rows={2}
                  className="w-full px-4 py-2.5 rounded-card border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none"
                />
              </div>
              <div>
                <p className="block text-xs font-medium text-muted mb-1">Tipo de recurso</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setResourceForm((f) => ({ ...f, tipo: 'archivo' }))}
                    className={`flex-1 py-2.5 rounded-full border text-sm font-medium transition-colors ${resourceForm.tipo === 'archivo' ? 'border-accent bg-[var(--accent-tint)] text-accent' : 'border-outline-variant text-muted'}`}>
                    Archivo
                  </button>
                  <button type="button" onClick={() => setResourceForm((f) => ({ ...f, tipo: 'link' }))}
                    className={`flex-1 py-2.5 rounded-full border text-sm font-medium transition-colors ${resourceForm.tipo === 'link' ? 'border-accent bg-[var(--accent-tint)] text-accent' : 'border-outline-variant text-muted'}`}>
                    Enlace o video
                  </button>
                </div>
              </div>
              {resourceForm.tipo === 'archivo' ? (
                <div>
                  <label htmlFor="resource-archivo" className="block text-xs font-medium text-muted mb-1">
                    Archivo {resourceModalMode === 'edit' && resourceForm.origTipo === 'archivo' && '(déjalo vacío para conservar el actual)'}
                  </label>
                  <input
                    id="resource-archivo"
                    type="file"
                    accept={RESOURCE_ACCEPT}
                    onChange={(e) => setResourceFile(e.target.files?.[0] || null)}
                    className="w-full text-sm text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-accent-light file:text-accent file:text-sm file:font-medium"
                  />
                  <p className="text-sm text-hint mt-1">PDF, Word, Excel, Power Point, JPG o PNG · máximo 15 MB</p>
                </div>
              ) : (
                <div>
                  <label htmlFor="resource-enlace" className="block text-xs font-medium text-muted mb-1">Enlace</label>
                  <Input
                    id="resource-enlace"
                    type="text"
                    value={resourceForm.enlace}
                    onChange={(e) => setResourceForm((f) => ({ ...f, enlace: e.target.value }))}
                  />
                  <p className="text-sm text-hint mt-1">Video de YouTube, documento de Google Drive, sitio externo, etc.</p>
                </div>
              )}
              <Button fullWidth icon={Upload} iconEffect="empujaArriba" busy={savingResource}
                type="submit"
                disabled={savingResource || !resourceChanged}>
                
                {savingResource ? 'Guardando…' : 'Guardar recurso'}
              </Button>
            </form>
          </Modal>
      )}

      {/* ── Delete resource confirm ── */}
      {deleteResourceConfirm && (
        <Modal open onClose={() => setDeleteResourceConfirm(null)} variant="centered" padding="p-4" ariaLabel="¿Eliminar recurso?">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Eliminar recurso?</h3>
            <p className="text-sm text-muted mb-4">
              &ldquo;<strong>{deleteResourceConfirm.nombre}</strong>&rdquo; se eliminará permanentemente.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDeleteResourceConfirm(null)} className="flex-1">Cancelar</Button>
              <Button variant="danger" icon={Trash2} iconEffect="balanceo" busy={deletingResource} className="flex-1" onClick={handleDeleteResource} disabled={deletingResource}>
                
                {deletingResource ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </div>
          </Modal>
      )}
    </>
  )
}
