// Parte del render de ActivityPage.jsx (fase 5 de PLAN_NORMALIZACION_UI:
// dividir sin cambio visual). Recibe lo que usa del componente principal por
// el contexto Actividad.
import { AbrirConNativoButton } from './piezas'
import { ArrowLeft, ChevronLeft, ChevronRight, ClipboardList, Clock, Download, Sparkles, Star } from 'lucide-react'
import { Button, Input } from '../../../components/ui'
import CalificarConIAModal from '../../../components/rubrica/CalificarConIAModal'
import EFDateTimePicker from '../../../components/EFDateTimePicker'
import EnlaceEntregado from '../../../components/EnlaceEntregado'
import { FILTER_LABELS, STATUS_COLORS, STATUS_LABELS, formatLateness, isImageFile } from './utilidades'
import { FilePreview, canPreviewFile } from '../../../components/AttachmentList'
import { ICONO } from '../../../config/iconos'
import { IS_NATIVE_APP, PUEDE_AUTOFOCUS } from '../../../utils/platform'
import { MENSAJE_PRORROGA_CON_ENTREGA } from '../../../utils/extensiones'
import { RUBRICA_TOTAL, totalRubrica } from '../../../utils/rubrica'
import Spinner from '../../../components/Spinner'
import ZoomableImage from '../../../components/ZoomableImage'
import { downloadUrl } from '../../../utils/cloudinary'
import { formatDeadline, formatPublishAt } from '../../../utils/activityVisibility'
import { formatHora12FromDate } from '../../../utils/formatHora'
import { mensajeParcialCerrado } from '../../../utils/ponderacion'
import { nowIsoLocal } from '../../../utils/nowIso'
import { studentFullName } from '../../../utils/studentSearch'
import { subjectDisplayName } from '../../../utils/subjectName'
import { useActividad } from './contexto'

export default function PanelCalificar() {
  const {
    abrirCalificarIA,
    activity,
    activityId,
    activityLabel,
    annulMode,
    annulSubmission,
    annulling,
    anuladasPorAlumno,
    aplicarPropuestaIA,
    califRowRef,
    calificarIAAbierto,
    canCreate,
    cerrarCalificarIA,
    changeFilterInView,
    closeModal,
    comentarioDirty,
    comentarioVisibleEsExcepcionRef,
    counts,
    curIdx,
    descartarPropuestaIA,
    downloadStudentZip,
    extendDate,
    extendMode,
    extendMotivo,
    extensionUnchanged,
    filter,
    getStatus,
    goToOffset,
    gradeForm,
    hasRubrica,
    instrumentoLabel,
    isDirty,
    isEvaluacion,
    isObservacion,
    labelCalificarConIA,
    navList,
    onCalifChange,
    parcialCerrado,
    pdfPageCount,
    previewHasImage,
    previewHasPdf,
    previewIdx,
    prorrogaBloqueada,
    puedeCalificarConIA,
    rubricEval,
    rubricaBtnRef,
    rubricaViewOpen,
    saveExtension,
    saveGrade,
    saveSinEntrega,
    saving,
    savingExtension,
    savingSinEntrega,
    selFiles,
    selected,
    setAnnulMode,
    setExtendDate,
    setExtendMode,
    setExtendMotivo,
    setGradeForm,
    setPdfPageCount,
    setPreviewIdx,
    setRubricaViewOpen,
    setRubricaWinTop,
    setSinEntregaGrade,
    setSinEntregaMode,
    setSinEntregaMotivo,
    sinEntregaGrade,
    sinEntregaMode,
    sinEntregaMotivo,
    studentZipDownloading,
    students,
    subject,
    sugerenciaPersistidaIA,
    telefonoWeb,
    toast,
  } = useActividad()
  return (
    <>
      {selected && !IS_NATIVE_APP && (
        <div className="fixed inset-0 z-40 flex flex-col bg-surface">

          {/* Top bar: back + subject being graded.
              md:pr-[380px] reserva el mismo ancho que el panel de calificación
              de la derecha (md:w-[380px] más abajo), así el grupo botón+título
              se centra en la MISMA franja que la vista previa de la izquierda
              — y el botón "Regresar" vive DENTRO de ese grupo centrado, pegado
              al título, en vez de quedar solo en el borde izquierdo de la
              pantalla. Mismo patrón en EvaluacionManager.jsx (md:pr-72, aside
              más angosto). */}
          <div className="flex items-center px-4 py-2.5 bg-surface-card border-b border-outline-variant flex-shrink-0 safe-top">
            <div className="flex-1 min-w-0 md:pr-[380px]">
              <div className="max-w-3xl mx-auto flex items-start gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex items-center gap-1 size-control inline-flex justify-center -ml-2 mt-0.5 text-muted hover:text-accent rounded-full text-sm font-medium flex-shrink-0 transition-colors"
                >
                  <ArrowLeft size={ICONO.md} /> Regresar
                </button>
                {/* Mismo patrón homogeneizado en las 4 variantes de este encabezado:
                    Asignatura — Docente / Evaluar(ción) / Número y nombre + lápiz /
                    Parcial N · Tipo — ver también EvaluacionManager.jsx. */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="text-[1.75rem] leading-tight font-bold uppercase tracking-wide text-accent flex-shrink-0">Evaluar</p>
                    <p className="text-[1.75rem] leading-tight font-medium text-muted truncate">{subjectDisplayName(subject)}</p>
                  </div>
                  <h3 className="text-xl font-bold text-on-surface truncate">
                    {activityLabel && <span className="text-accent">{activityLabel} </span>}
                    {activity?.nombre}
                  </h3>
                  {/* text-base, igual que en la página de la actividad: las
                      cuatro variantes de este encabezado (EVALUAR y EVALUACIÓN,
                      página y pantalla completa) llevan la misma escala. */}
                  <p className="text-base font-medium text-muted truncate">
                    Parcial {activity?.parcial} · {activity?.categoria === 'examen' ? 'Examen' : activity?.categoria === 'cuestionario' ? 'Cuestionario' : activity?.categoria === 'observacion' ? 'Observación' : 'Entregable'}
                  </p>
                  {/* Fechas, iguales que en la página. Van DENTRO de la columna
                      del título (no sueltas abajo) para que arranquen a la misma
                      altura que el nombre, en vez de meterse bajo el botón
                      Regresar. Aquí sirven de recordatorio mientras se califica:
                      si una entrega llegó tarde, la fecha de cierre es el dato
                      que lo explica y estaba a dos pantallas de distancia. */}
                  {(activity?.publishedAt || activity?.publishAt || activity?.fechaLimite) && (
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {activity?.publishedAt && (
                        <span data-tooltip="Publicado" className="text-sm text-emerald-600 flex items-center gap-1">
                          <Clock size={ICONO.sm} /> {formatPublishAt(activity.publishedAt)}
                        </span>
                      )}
                      {activity?.publishAt && (
                        <span data-tooltip="Publicación programada" className="text-sm text-accent flex items-center gap-1">
                          <Clock size={ICONO.sm} /> {formatPublishAt(activity.publishAt)}
                        </span>
                      )}
                      {activity?.fechaLimite && (
                        <span data-tooltip="Cierre" className="text-sm text-amber-600 flex items-center gap-1">
                          <Clock size={ICONO.sm} /> {formatDeadline(activity.fechaLimite)}
                        </span>
                      )}
                      {activity?.recibirTarde && !activity?.cerradaManual && (
                        <span data-tooltip="Se aceptan entregas tarde" className="text-sm text-muted flex items-center gap-1">
                          Recibe entregas tarde
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col md:flex-row">

            {/* Left: file preview, top to bottom — no en el teléfono (web):
                ahí el panel de calificación ocupa toda la pantalla. */}
            {!telefonoWeb.telefono && (
            <div className="h-[45vh] md:h-auto md:flex-1 min-w-0 bg-surface-container flex flex-col">
              {/* Aviso de cómo hacer zoom en la web — con mouse no hay pellizcar,
                  así que el gesto no es obvio: clic para las imágenes (abre un
                  visor ampliado), Ctrl + rueda o doble clic para el PDF (in-line,
                  para no robarle la rueda al scroll normal entre páginas). */}
              {(previewHasImage || previewHasPdf) && (
                <p className="text-xs text-muted text-center px-3 py-1.5 flex-shrink-0 border-b border-outline-variant">
                  {previewHasImage && previewHasPdf
                    ? 'Clic en la imagen para ampliar y hacer zoom · Ctrl + rueda del mouse (o doble clic) sobre el PDF para acercar'
                    : previewHasImage
                      ? 'Clic en la imagen para ampliar y hacer zoom'
                      : 'Ctrl + rueda del mouse (o doble clic) sobre el PDF para acercar'}
                </p>
              )}
              {selFiles.length > 1 && previewIdx === -1 ? (
                /* "Todas las imágenes": every file stacked, scrollable */
                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                  {selFiles.map((f, i) => (
                    isImageFile(f.nombre, f.url) ? (
                      <ZoomableImage key={`${f.url}-${i}`} src={f.url} alt={f.nombre} className="block" imgClassName="max-w-full rounded mx-auto" />
                    ) : IS_NATIVE_APP ? (
                      <AbrirConNativoButton key={`${f.url}-${i}`} url={f.url} nombre={f.nombre}
                        className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded-full border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors w-full" />
                    ) : (
                      <a key={`${f.url}-${i}`} href={downloadUrl(f.url, f.nombre)} download={f.nombre} rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded-full border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors">
                        <Download size={ICONO.md} className="text-accent flex-shrink-0" />
                        <span className="truncate">{f.nombre}</span>
                      </a>
                    )
                  ))}
                </div>
              ) : selFiles.length > 1 ? (
                /* Preview ONE image — the one picked from the file list */
                (() => {
                  const f = selFiles[Math.min(previewIdx, selFiles.length - 1)]
                  return isImageFile(f.nombre, f.url) ? (
                    <ZoomableImage
                      src={f.url}
                      alt={f.nombre}
                      className="flex-1 min-h-0 flex items-center justify-center p-3"
                      imgClassName="max-w-full max-h-full object-contain rounded"
                    />
                  ) : canPreviewFile(f.nombre) ? (
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      <FilePreview url={f.url} nombre={f.nombre} fill onCountKnown={setPdfPageCount} />
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-hint text-sm p-6 text-center">
                      <p>Sin vista previa disponible para este archivo.</p>
                      {IS_NATIVE_APP ? (
                        <AbrirConNativoButton url={f.url} nombre={f.nombre}
                          className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded-full border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors" />
                      ) : (
                        <a
                          href={downloadUrl(f.url, f.nombre)}
                          download={f.nombre}
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded-full border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors"
                        >
                          <Download size={ICONO.md} className="text-accent" />
                          Descargar archivo
                        </a>
                      )}
                    </div>
                  )
                })()
              ) : selected.sub && !selected.sub.completadoSinArchivo && selected.sub.enlaceURL ? (
                /* Entrega mediante "Enlace o URL": solo la dirección, clicable
                   en otra pestaña — sin vista previa ni descarga. */
                <div className="flex-1 flex items-center justify-center p-6">
                  <EnlaceEntregado url={selected.sub.enlaceURL} className="w-full max-w-xl" />
                </div>
              ) : selected.sub && !selected.sub.completadoSinArchivo && selected.sub.archivoURL ? (
                isImageFile(selected.sub.nombreArchivo, selected.sub.archivoURL) ? (
                  <ZoomableImage
                    src={selected.sub.archivoURL}
                    alt="Entrega del estudiante"
                    className="flex-1 min-h-0 flex items-center justify-center p-3"
                    imgClassName="max-w-full max-h-full object-contain rounded"
                  />
                ) : canPreviewFile(selected.sub.nombreArchivo) ? (
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <FilePreview url={selected.sub.archivoURL} nombre={selected.sub.nombreArchivo} fill onCountKnown={setPdfPageCount} />
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 text-hint text-sm p-6 text-center">
                    <p>Sin vista previa disponible para este tipo de archivo.</p>
                    {IS_NATIVE_APP ? (
                      <AbrirConNativoButton url={selected.sub.archivoURL} nombre={selected.sub.nombreArchivo}
                        className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded-full border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors" />
                    ) : (
                      <a
                        href={downloadUrl(selected.sub.archivoURL, selected.sub.nombreArchivo)}
                        download={selected.sub.nombreArchivo}
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded-full border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors"
                      >
                        <Download size={ICONO.md} className="text-accent" />
                        Descargar entrega
                      </a>
                    )}
                  </div>
                )
              ) : (
                <div className="flex-1 flex items-center justify-center text-hint text-sm p-6 text-center">
                  {isObservacion
                    ? 'Actividad de observación — no requiere entrega. Califica directamente en el panel.'
                    : isEvaluacion
                      ? 'Evaluación — la calificación proviene del intento del alumno; puedes ajustarla en el panel.'
                      : selected.sub?.completadoSinArchivo
                        ? 'Actividad completada sin archivo.'
                        : 'El estudiante aún no ha entregado esta tarea.'}
                </div>
              )}
            </div>
            )}

            {/* Right: grading panel — cuando "Calificar con IA" está abierto,
                esta MISMA columna (espacio real de layout, no un overlay)
                muestra la revisión de IA en vez del formulario normal de
                calificación (26-ago-2026, pedido explícito de Kike: "EVIDENCIA
                > PROPUESTA DE IA", dos columnas reales, nunca una superpuesta
                encima de la otra — la columna de evidencia de la izquierda
                queda intacta y visible en todo momento). */}
            <div className="flex-1 md:flex-none w-full md:w-[380px] bg-surface-card border-t md:border-t-0 md:border-l border-outline-variant overflow-y-auto">
              {calificarIAAbierto && selected?.sub && hasRubrica ? (
                <CalificarConIAModal
                  inline
                  open={calificarIAAbierto}
                  onClose={cerrarCalificarIA}
                  onDescartar={descartarPropuestaIA}
                  actividadId={activityId}
                  submissionId={selected.sub.id}
                  rubrica={activity.rubrica}
                  onAplicar={aplicarPropuestaIA}
                  resultadoPersistido={sugerenciaPersistidaIA}
                  tiposArchivo={activity?.tiposArchivo}
                />
              ) : (
              <div className="p-4 space-y-3">

                {/* Filter tabs — same sets as the list; switching re-freezes navigation */}
                <div className="grid grid-cols-2 gap-1.5 bg-surface-container p-1 rounded">
                  {['todos', 'pendiente', 'calificado', 'entregado'].map((f) => (
                    <button
                      type="button"
                      key={f}
                      onClick={() => changeFilterInView(f)}
                      aria-pressed={filter === f}
                      className={`min-h-control-sm px-2 text-sm font-semibold rounded-full transition-colors ${
                        filter === f
                          ? 'bg-surface-card text-on-surface shadow-card'
                          : 'text-muted hover:bg-[var(--accent-medium)]'
                      }`}
                    >
                      {FILTER_LABELS[f]} ({f === 'todos' ? students.length : counts[f]})
                    </button>
                  ))}
                </div>

                {/* Student */}
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-base font-semibold text-on-surface truncate">
                      {selected.student.orden != null && <span className="text-on-surface">{selected.student.orden}. </span>}
                      {studentFullName(selected.student)}
                    </h4>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_COLORS[getStatus(selected.student.id)]}`}>
                      {STATUS_LABELS[getStatus(selected.student.id)]}
                    </span>
                  </div>
                  {/* Always one line tall (min-h) so Anterior/Siguiente never move */}
                  <p className="text-sm text-muted mt-0.5 truncate min-h-5">
                    {isObservacion
                      ? 'Observación — se califica sin entrega'
                      : isEvaluacion
                        ? (selected.sub ? `Evaluación — intento ${selected.sub.intentoActual || 1}` : 'Evaluación — sin intento aún')
                        : selFiles.length > 1
                          ? `${selFiles.length} archivos entregados`
                          : selected.sub
                            ? selected.sub.completadoSinArchivo
                              ? 'Completada sin archivo'
                              : selected.sub.enlaceURL
                                ? 'Enlace o URL'
                                : (selected.sub.nombreArchivo
                                  ? (pdfPageCount != null
                                      ? `${selected.sub.nombreArchivo} (${pdfPageCount} ${pdfPageCount === 1 ? 'página' : 'páginas'})`
                                      : selected.sub.nombreArchivo)
                                  : (selected.sub.sinEntrega ? `Sin entrega — calificada en ${selected.sub.calificacion ?? 0}` : 'Sin archivo'))
                            : 'Sin entrega aún'}
                  </p>
                  {/* Always reserve one line so Anterior/Siguiente don't jump
                      between students with and without a motivo */}
                  {selected.sub?.tarde && (
                    <p className="text-xs text-amber-600 font-medium mt-0.5 truncate">
                      {formatLateness(selected.sub, selected.student, activity)}
                    </p>
                  )}
                  <p className={`text-xs text-muted mt-0.5 italic truncate min-h-4 ${selected.sub?.motivoSinEntrega ? '' : 'invisible'}`}>
                    {selected.sub?.motivoSinEntrega ? `Motivo: ${selected.sub.motivoSinEntrega}` : ' '}
                  </p>
                </div>

                {navList.length > 1 && (
                  <div className="space-y-1.5">
                  {/* Big, prominent prev/next — the most used controls here */}
                  <div className="flex items-center gap-2">
                    <Button variant="outline-accent" icon={ChevronLeft} className="flex-1"
                      onClick={() => goToOffset(-1)}>
                       Anterior
                    </Button>
                    <span className="text-sm text-muted flex-shrink-0 px-1 whitespace-nowrap">{curIdx + 1} / {navList.length}</span>
                    <Button className="flex-1"
                      onClick={() => goToOffset(1)}>
                      Siguiente <ChevronRight size={ICONO.md} />
                    </Button>
                  </div>
                  </div>
                )}

                {/* Grade form: cuando hay entrega, siempre para observación y
                    siempre con rúbrica (así un no-entregado se puede rubricar y
                    la sección mantiene posiciones fijas al navegar) */}
                {(selected.sub || isObservacion || hasRubrica) ? (
                  <form onSubmit={saveGrade} className="space-y-3">
                    {parcialCerrado && (
                      <div className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 leading-relaxed">
                        <strong>El Parcial {activity?.parcial} está cerrado.</strong> No se pueden cambiar calificaciones.
                        Para modificarlas, primero <strong>reabre el parcial</strong> desde Calificaciones.
                        Al reabrirlo, las calificaciones asignadas automáticamente volverán a como estaban antes de cerrar.
                      </div>
                    )}
                    {/* Rúbrica: abre la tabla en la zona izquierda (donde la vista
                        previa) para marcar una opción por renglón — el total se
                        escribe en la calificación y se guarda del modo conocido
                        (Guardar o autoguardado al navegar) */}
                    {hasRubrica && (() => {
                      const totalR = totalRubrica(activity.rubrica, rubricEval)
                      const faltan = activity.rubrica.criterios.filter((_, i) => rubricEval?.[i] == null).length
                      return (
                        <button
                          type="button"
                          ref={rubricaBtnRef}
                          onClick={() => {
                            // La ventana abre DEBAJO de la calificación oficial,
                            // que así queda siempre a la vista al rubricar
                            const anchor = califRowRef.current || rubricaBtnRef.current
                            const rect = anchor?.getBoundingClientRect()
                            if (rect) setRubricaWinTop(Math.round(rect.bottom + 6))
                            setRubricaViewOpen((v) => !v)
                          }}
                          className={`w-full py-2.5 text-sm font-semibold rounded-full transition-colors flex items-center justify-center gap-2 min-h-control ${
                            rubricaViewOpen
                              ? 'bg-accent text-white hover:bg-accent-hover'
                              : 'border border-accent text-accent hover:bg-[var(--accent-medium)]'
                          }`}
                        >
                          <ClipboardList size={ICONO.sm} />
                          {rubricaViewOpen ? `Ocultar ${instrumentoLabel}` : `Ver ${instrumentoLabel}`}
                          <span className="font-bold">
                            {totalR != null ? `— ${totalR} / ${RUBRICA_TOTAL}` : `— faltan ${faltan} criterio${faltan !== 1 ? 's' : ''}`}
                          </span>
                        </button>
                      )
                    })()}
                    {puedeCalificarConIA && (
                      <Button variant="outline-accent" fullWidth icon={Sparkles} iconEffect="destello"
                        onClick={() => abrirCalificarIA()}>
                        
                        {labelCalificarConIA}
                      </Button>
                    )}

                    {/* Download on the left, grade (with its own header) on the
                        right — narrow input keeps the spinner arrows by the number */}
                    {/* Grade on its own row; the file list (if several) goes below.
                        Con rúbrica, el hueco del botón Descargar se conserva
                        (invisible) cuando no hay archivo, para que la calificación
                        oficial NUNCA cambie de lugar al navegar entre alumnos. */}
                    <div ref={califRowRef} className="flex gap-2 items-end">
                      {/* En la app no hay botón de descarga; cae al hueco
                          invisible de abajo cuando hay rúbrica, para que la
                          calificación no cambie de lugar. */}
                      {selFiles.length === 1 && !IS_NATIVE_APP && !telefonoWeb.telefono ? (
                        <a
                          href={downloadUrl(selFiles[0].url, selFiles[0].nombre)}
                          download={selFiles[0].nombre}
                          rel="noopener noreferrer"
                          /* bg-surface-card (blanco) como los otros botones de
                             descarga de esta pantalla: con el lienzo azul,
                             `bg-surface` se pintaba de azul y este se perdía. */
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-card rounded-full border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors min-w-0"
                        >
                          <Download size={ICONO.md} className="text-accent flex-shrink-0" />
                          <span className="truncate">Descargar entrega</span>
                        </a>
                      ) : hasRubrica ? (
                        <div aria-hidden="true" className="flex-1 invisible flex items-center justify-center gap-2 px-3 py-2 rounded-full border text-sm min-w-0">
                          <span className="truncate">Descargar entrega</span>
                        </div>
                      ) : null}
                      <div className={(selFiles.length === 1 && !telefonoWeb.telefono) || hasRubrica ? 'flex-shrink-0' : 'flex-1'}>
                        <label htmlFor="act-calificacion" className="block text-sm font-medium text-muted mb-1 text-center">
                          Calificación <span className="text-hint">(máx. {activity?.maxCalif})</span>
                        </label>
                        <Input
                          id="act-calificacion"
                          type="number"
                          value={gradeForm.calificacion}
                          onChange={onCalifChange}
                          required
                          min="0"
                          max={activity?.maxCalif}
                          step="0.1"
                          // Primer campo del panel de calificación, abierto con intención de escribir.
                          autoFocus={PUEDE_AUTOFOCUS && !parcialCerrado}
                          disabled={parcialCerrado}
                          className="text-base font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                      </div>
                    </div>

                    {/* Several files: click the name to PREVIEW that image on the
                        left; only the download icon downloads it */}
                    {selFiles.length > 1 && !telefonoWeb.telefono && (
                      <div className="space-y-1">
                        {/* All images: icon downloads everything as a ZIP; the
                            name shows them all stacked in the preview */}
                        <div
                          className={`flex items-center gap-1 rounded border text-xs font-semibold transition-colors ${
                            previewIdx === -1
                              ? 'border-accent bg-[var(--accent-tint)] text-on-surface'
                              : 'border-outline-variant bg-surface text-muted hover:border-accent'
                          }`}
                        >
                          {/* Sin descargas en la app: solo se ven, no se bajan. */}
                          {!IS_NATIVE_APP && (
                            <button
                              type="button"
                              onClick={downloadStudentZip}
                              disabled={studentZipDownloading}
                              data-tooltip="Descargar todas en ZIP"
                              aria-label="Descargar todas en ZIP"
                              className="p-2 text-accent hover:bg-[var(--accent-medium)] rounded-full flex-shrink-0 disabled:opacity-40"
                            >
                              {studentZipDownloading ? <Spinner size="sm" /> : <Download size={ICONO.sm} />}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setPreviewIdx(-1)}
                            data-tooltip="Ver todas las imágenes"
                            className="flex-1 min-w-0 py-2 pr-2 text-left truncate"
                          >
                            Todas las imágenes entregadas ({selFiles.length})
                          </button>
                        </div>
                        {selFiles.map((f, i) => (
                          <div
                            key={`${f.url}-${i}`}
                            className={`flex items-center gap-1 rounded border text-xs transition-colors ${
                              i === previewIdx
                                ? 'border-accent bg-[var(--accent-tint)] text-on-surface'
                                : 'border-outline-variant bg-surface text-muted hover:border-accent'
                            }`}
                          >
                            {!IS_NATIVE_APP && (
                              <a
                                href={downloadUrl(f.url, f.nombre)}
                                download={f.nombre}
                                rel="noopener noreferrer"
                                data-tooltip="Descargar esta imagen"
                                aria-label="Descargar esta imagen"
                                className="p-2 text-accent hover:bg-[var(--accent-medium)] rounded flex-shrink-0"
                              >
                                <Download size={ICONO.sm} />
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => setPreviewIdx(i)}
                              data-tooltip="Ver esta imagen"
                              className="flex-1 min-w-0 py-2 pr-2 text-left truncate"
                            >
                              {i + 1}. {f.nombre}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div>
                      <label htmlFor="act-comentario" className="block text-sm font-medium text-muted mb-1">
                        Comentario <span className="text-hint">(opcional)</span>
                      </label>
                      <textarea
                        id="act-comentario"
                        value={gradeForm.comentario}
                        onChange={(e) => setGradeForm((f) => ({ ...f, comentario: e.target.value }))}
                        rows={6}
                        className="w-full px-4 py-2.5 rounded-card border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-y disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>
                    {/* Empieza mostrando el default/global de la actividad
                        (o la excepción propia, si esta entrega ya tiene una)
                        — tocarlo la convierte en excepción individual, que
                        gana sobre el global aunque este cambie después (ver
                        comentarioVisibleEsExcepcionRef y persistGrade). Se
                        guarda junto con "Guardar calificación", mismo
                        mecanismo de siempre. */}
                    <label className="flex items-center gap-2 text-sm text-on-surface cursor-pointer">
                      <input
                        type="checkbox"
                        checked={gradeForm.comentarioVisibleAlumno !== false}
                        onChange={(e) => {
                          comentarioVisibleEsExcepcionRef.current = true
                          setGradeForm((f) => ({ ...f, comentarioVisibleAlumno: e.target.checked }))
                        }}
                        className="w-4 h-4 rounded-card border-outline-variant text-accent focus:ring-accent"
                      />
                      Permitir que el estudiante vea este comentario
                    </label>
                    {!canCreate && (
                      <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2 leading-relaxed">
                        Necesitas Créditos IA para registrar calificaciones nuevas — toda la información de este estudiante sigue disponible.
                      </p>
                    )}
                    {parcialCerrado ? (
                      selected.sub && (
                        <Button fullWidth busy={saving}
                          type="submit"
                          disabled={saving || !canCreate || !comentarioDirty()}>
                          
                          {saving ? 'Guardando…' : 'Guardar comentario'}
                        </Button>
                      )
                    ) : (
                      <Button fullWidth icon={Star} busy={saving}
                        type="submit"
                        disabled={saving || !canCreate || !isDirty()}>
                        
                        {saving ? 'Guardando…' : 'Guardar calificación'}
                      </Button>
                    )}
                  </form>
                ) : (
                  <p className="text-sm text-hint text-center py-2">
                    El estudiante aún no ha entregado esta tarea.
                  </p>
                )}

                {/* Entregas que el propio estudiante anuló (quedan registradas) */}
                {anuladasPorAlumno[selected.student.id]?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-hint mb-2">Entregas anuladas por el estudiante</p>
                    <div className="space-y-1.5">
                      {[...anuladasPorAlumno[selected.student.id]]
                        .sort((a, b) => (a.fechaAnulacion?.seconds ?? 0) - (b.fechaAnulacion?.seconds ?? 0))
                        .map((a) => {
                          const fmt = (t) => t?.seconds
                            ? (d => `${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, ${formatHora12FromDate(d)}`)(new Date(t.seconds * 1000))
                            : '—'
                          return (
                            <div key={a.id} className="px-3 py-2 bg-surface rounded-card border border-outline-variant text-xs space-y-0.5">
                              <p className="text-muted truncate">{a.enlaceURL ? 'Enlace o URL' : (a.nombreArchivo || 'Archivo')}</p>
                              <p className="text-hint">Entregada: {fmt(a.fechaEntrega)} · Anulada: {fmt(a.fechaAnulacion)}</p>
                            </div>
                          )
                        })}
                    </div>
                  </div>
                )}

                {/* Submission history */}
                {selected.sub?.historial?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-hint mb-2">Versiones anteriores</p>
                    <div className="space-y-1.5">
                      {[...selected.sub.historial].reverse().map((v, i) => (
                        <div key={`${v.fechaEntrega?.seconds ?? 'v'}-${i}`} className="flex items-center gap-2 px-3 py-2 bg-surface rounded-full border border-outline-variant text-xs">
                          <span className="text-hint flex-shrink-0">
                            {v.fechaEntrega?.seconds
                              ? (d => `${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, ${formatHora12FromDate(d)}`)(new Date(v.fechaEntrega.seconds * 1000))
                              : '—'}
                          </span>
                          {v.completadoSinArchivo
                            ? <span className="text-hint italic">sin archivo</span>
                            : v.archivoURL
                              ? (IS_NATIVE_APP || telefonoWeb.telefono)
                                ? <span className="text-muted truncate flex items-center gap-1">{v.nombreArchivo}</span>
                                : <a href={downloadUrl(v.archivoURL, v.nombreArchivo)} download={v.nombreArchivo} rel="noopener noreferrer" className="text-accent hover:underline truncate flex items-center gap-1">
                                  <Download size={ICONO.xs} /> {v.nombreArchivo}
                                </a>
                              : <span className="text-hint italic">sin archivo</span>
                          }
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Extend deadline for this student (no deadline in observación;
                    evaluaciones manage attempts/deadlines in their own page) */}
                {!isObservacion && !isEvaluacion && (
                <div className="pt-3 border-t border-outline-variant space-y-2">
                  {/* Annul the current submission — above the extend-date action */}
                  {selected.sub && !parcialCerrado && (
                    !annulMode ? (
                      <button
                        type="button"
                        onClick={() => setAnnulMode(true)}
                        className="block mx-auto text-sm text-muted hover:text-red-600 transition-colors"
                      >
                        Anular la entrega actual para este estudiante
                      </button>
                    ) : (
                      <div className="rounded-card border border-red-200 bg-red-50 p-3 space-y-2">
                        <p className="text-sm text-red-700">
                          ¿Anular la entrega de <strong>{studentFullName(selected.student)}</strong>?
                          Volverá a quedar <strong>Pendiente</strong> y podrá entregar de nuevo.
                          {selected.sub.calificacion != null && ' La calificación actual se eliminará.'}
                        </p>
                        <div className="flex gap-2">
                          <Button variant="secondary" className="flex-1"
                            onClick={() => setAnnulMode(false)}
                            disabled={annulling}>
                            Cancelar
                          </Button>
                          <Button variant="danger" className="flex-1"
                            onClick={annulSubmission}
                            disabled={annulling}>
                            {annulling ? 'Anulando…' : 'Anular entrega'}
                          </Button>
                        </div>
                      </div>
                    )
                  )}
                  {prorrogaBloqueada ? (
                    <div className="text-center">
                      <button
                        type="button"
                        disabled
                        className="block mx-auto text-sm text-muted disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Modificar fecha de entrega para este estudiante
                      </button>
                      <p className="text-xs text-hint mt-1">{MENSAJE_PRORROGA_CON_ENTREGA}</p>
                    </div>
                  ) : !extendMode ? (
                    <button
                      type="button"
                      onClick={() => (parcialCerrado ? toast(mensajeParcialCerrado(activity.parcial), 'error') : setExtendMode(true))}
                      className="block mx-auto text-sm text-muted hover:text-muted transition-colors"
                    >
                      Modificar fecha de entrega para este estudiante
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-on-surface">Nueva fecha y hora límite para este estudiante</p>
                      <EFDateTimePicker
                        mode="datetime"
                        value={extendDate}
                        onChange={setExtendDate}
                        clearable={false}
                        minDateTime={nowIsoLocal()}
                      />
                      <div>
                        <label htmlFor="act-extend-motivo" className="block text-sm font-medium text-muted mb-1">Motivo</label>
                        <textarea
                          id="act-extend-motivo"
                          value={extendMotivo}
                          onChange={(e) => setExtendMotivo(e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 rounded-card border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button variant="secondary" className="flex-1"
                          onClick={() => setExtendMode(false)}>
                          Cancelar
                        </Button>
                        <Button className="flex-1"
                          onClick={saveExtension}
                          disabled={!extendDate || savingExtension || extensionUnchanged}>
                          {savingExtension ? 'Guardando…' : 'Guardar'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Grade a student who never submitted (e.g. handed it in on a USB) */}
                  {!selected.sub && !parcialCerrado && (
                    !sinEntregaMode ? (
                      <button
                        type="button"
                        onClick={() => setSinEntregaMode(true)}
                        className="block mx-auto text-sm text-muted hover:text-accent transition-colors"
                      >
                        Evaluar sin entrega
                      </button>
                    ) : (
                      <div className="space-y-2 rounded-card border border-outline-variant bg-surface p-3">
                        <p className="text-sm font-medium text-on-surface">Evaluar sin entrega</p>
                        <div>
                          <label htmlFor="act-sinentrega-calif" className="block text-sm font-medium text-muted mb-1">
                            Calificación <span className="text-hint">(máx. {activity?.maxCalif})</span>
                          </label>
                          <Input
                            id="act-sinentrega-calif"
                            type="number"
                            value={sinEntregaGrade}
                            onChange={(e) => setSinEntregaGrade(e.target.value)}
                            min="0"
                            max={activity?.maxCalif}
                            step="0.1"
                            // Primer campo del panel "Evaluar sin entrega", abierto con intención de escribir.
                            autoFocus={PUEDE_AUTOFOCUS}
                            className="text-base font-semibold"
                          />
                        </div>
                        <div>
                          <label htmlFor="act-sinentrega-motivo" className="block text-sm font-medium text-muted mb-1">Motivo</label>
                          <textarea
                            id="act-sinentrega-motivo"
                            value={sinEntregaMotivo}
                            onChange={(e) => setSinEntregaMotivo(e.target.value)}
                            rows={2}
                            className="w-full px-3 py-2 rounded-card border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button variant="secondary" className="flex-1"
                            onClick={() => setSinEntregaMode(false)}>
                            Cancelar
                          </Button>
                          <Button className="flex-1"
                            onClick={saveSinEntrega}
                            disabled={savingSinEntrega || sinEntregaGrade === ''}>
                            {savingSinEntrega ? 'Guardando…' : 'Guardar'}
                          </Button>
                        </div>
                      </div>
                    )
                  )}
                </div>
                )}

                <div className="h-2 safe-bottom" />
              </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
