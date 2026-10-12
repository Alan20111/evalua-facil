// Parte del render de ActivityPage.jsx (fase 5 de PLAN_NORMALIZACION_UI:
// dividir sin cambio visual). Recibe lo que usa del componente principal por
// el contexto Actividad.
import AnalisisEntregableIA from '../../../components/analisis/AnalisisEntregableIA'
import { ArrowLeft, CalendarDays, CheckCheck, Clock, FolderDown, Pencil, Sparkles, Star } from 'lucide-react'
import AttachmentList from '../../../components/AttachmentList'
import { Button, IconButton } from '../../../components/ui'
import { CUSTOM_FILE_TYPE, normalizeFileTypeKeys, parseCustomExts } from '../../../config/fileTypes'
import EvaluacionManager from '../../../components/EvaluacionManager'
import { FILE_TYPE_SHORT_LABELS, FILTER_LABELS, STATUS_COLORS, STATUS_LABELS } from './utilidades'
import { ICONO } from '../../../config/iconos'
import { IS_NATIVE_APP, PUEDE_AUTOFOCUS } from '../../../utils/platform'
import JuegoManager from '../../../components/juego/JuegoManager'
import SearchInput from '../../../components/SearchInput'
import { TEACHER_CONTAINER_NARROW } from '../../../config/layout'
import { cuentaParaCalificacion, formatDeadline, formatPublishAt } from '../../../utils/activityVisibility'
import { richTextContentClass, sanitizeHtml, toRichHtml } from '../../../utils/sanitizeHtml'
import { rubricaFirma } from '../../../utils/rubrica'
import { studentFullName } from '../../../utils/studentSearch'
import { subjectDisplayName } from '../../../utils/subjectName'
import { useActividad } from './contexto'
import { desplazamiento } from '../../../utils/movimiento'

export default function ListaEntregas() {
  const {
    activity,
    activityId,
    activityLabel,
    contarAplicarTodasIA,
    contarEntregasIA,
    contarRecalificarIA,
    counts,
    deleteActivityModal,
    esJuego,
    filter,
    filtered,
    getStatus,
    goBack,
    handleZipDownload,
    hasRubrica,
    isObservacion,
    location,
    openGradeFromList,
    parcialCerrado,
    returnToGrades,
    searchStudents,
    setActivity,
    setDeleteConfirm,
    setEditingActivity,
    setFilter,
    setSearchStudents,
    setSubmissions,
    students,
    subject,
    submissions,
    sugerenciasLoteIA,
    telefonoWeb,
    zipDownloading,
    zipProgress,
  } = useActividad()
  return (
    <>
      {esJuego ? (
        <>
        <JuegoManager
          activity={activity}
          subject={subject}
          activityId={activityId}
          activityLabel={activityLabel}
          students={students}
          submissions={submissions}
          onActivityChange={setActivity}
          // Mismo candado que el resto de la página: con el parcial cerrado no
          // se anula una entrega (borrarla borraría su calificación).
          parcialCerrado={parcialCerrado}
          onSubmissionRemoved={(studentId) => setSubmissions((prev) => {
            const next = { ...prev }
            delete next[studentId]
            return next
          })}
          // Anular detenido porque la entrega cambió (submissionGuard.js):
          // se muestra la versión actual de ESE estudiante.
          onSubmissionUpdated={(studentId, sub) => setSubmissions((prev) => ({ ...prev, [studentId]: sub }))}
          onDeleteActivity={() => setDeleteConfirm(true)}
          goBack={goBack}
          openStudentId={location.state?.openStudentId || null}
        />
        {deleteActivityModal}
        </>
      ) : activity?.tipo === 'evaluacion' ? (
        <>
        <EvaluacionManager
          activity={activity}
          subject={subject}
          activityId={activityId}
          activityLabel={activityLabel}
          contextLine={subjectDisplayName(subject)}
          students={students}
          submissions={submissions}
          onActivityChange={setActivity}
          onSubmissionRemoved={(studentId) => setSubmissions((prev) => {
            const next = { ...prev }
            delete next[studentId]
            return next
          })}
          onSubmissionUpdated={(studentId, sub) => setSubmissions((prev) => ({ ...prev, [studentId]: sub }))}
          parcialCerrado={parcialCerrado}
          resultadosOnly
          backState={returnToGrades ? { tab: 'calificaciones' } : null}
          openStudentId={location.state?.openStudentId || null}
          onDeleteActivity={() => setDeleteConfirm(true)}
        />
        {deleteActivityModal}
        </>
      ) : (
      <div className={IS_NATIVE_APP ? '' : TEACHER_CONTAINER_NARROW}>
        {/* Header */}
        {/* Header on the page background — the Instrucciones card floats like Entregas below.
            overflow-hidden: el botón "Editar actividad" (con su tooltip CSS absolute,
            más ancho que el ícono) queda pegado al borde derecho en la app — sin esto,
            el tooltip hace crecer el scrollWidth de toda la página unos px de más
            aunque nada se vea cortado (mismo "scrollWidth fantasma" ya visto en
            SubjectPage.jsx). */}
        <div data-esq="act-doc-encabezado" className="px-4 py-2 overflow-hidden">
          <div className="flex items-center gap-2">
            <IconButton icon={ArrowLeft} label="Volver" tooltip={false} className="-ml-2" onClick={goBack} />
            <div className="flex-1 min-w-0">
              {IS_NATIVE_APP ? (
                <>
                  <p className="text-sm font-medium text-muted truncate">
                    {subjectDisplayName(subject)}
                  </p>
                  <p className="text-[1.75rem] leading-tight font-bold uppercase tracking-wide text-accent">Evaluar</p>
                </>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-[1.75rem] leading-tight font-bold uppercase tracking-wide text-accent flex-shrink-0">Evaluar</p>
                  <p className="text-[1.75rem] leading-tight font-medium text-muted truncate">{subjectDisplayName(subject)}</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-on-surface truncate">
                  {activityLabel && <span className="text-accent">{activityLabel} </span>}
                  {activity?.nombre}
                </h1>
                <IconButton icon={Pencil} label="Editar actividad" tooltip={false} onClick={() => setEditingActivity(true)}
                  data-tooltip="Editar actividad" />
              </div>
              {/* text-base y no text-sm: es la línea que dice DE QUÉ va esto
                  (parcial y tipo) y quedaba con el mismo tamaño que la letra
                  chica de las fechas, cuando pesa bastante más. */}
              <p className="text-base font-medium text-muted">
                Parcial {activity?.parcial} · {activity?.categoria === 'examen' ? 'Examen' : activity?.categoria === 'cuestionario' ? 'Cuestionario' : activity?.categoria === 'observacion' ? 'Observación' : 'Entregable'}
              </p>
            </div>
          </div>
          {/* Fechas — con aire: gap-3 y text-sm en vez de gap-2/text-xs. Iban
              tan juntas y tan chicas que la fecha de cierre, que es el dato que
              el docente busca de un vistazo, se leía como una nota al pie. */}
          {(activity?.publishedAt || activity?.publishAt || activity?.fechaLimite) && (
            <div className="flex items-center gap-3 mt-2 flex-wrap">
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
          {activity?.instrucciones && (
            <div data-esq="act-doc-instrucciones" className="mt-2 rounded-card overflow-hidden bg-surface-card shadow-card border border-accent-soft">
              <div className="px-4 py-2 bg-accent-light border-b border-accent-soft">
                <h2 className="font-semibold text-sm text-accent-hover">Instrucciones</h2>
              </div>
              <div
                className={`text-sm text-on-surface p-4 ${richTextContentClass}`}
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(toRichHtml(activity.instrucciones)) }}
              />
            </div>
          )}
          {/* Accepted file types for this entregable (observación has no delivery) */}
          {!isObservacion && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap text-xs text-muted">
            <span className="font-medium">Archivos aceptados:</span>
            {normalizeFileTypeKeys(activity?.tiposArchivo).map((k) => (
              <span key={k} className="bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full">
                {k === CUSTOM_FILE_TYPE
                  ? (parseCustomExts(activity?.extensionesCustom).map((e) => `.${e}`).join(', ') || 'Personalizado')
                  : (FILE_TYPE_SHORT_LABELS[k] || k)}
              </span>
            ))}
          </div>
          )}

          <AttachmentList files={activity?.archivosAdjuntos} />

        </div>

        {/* ── Entregas — same accent container as Preguntas/Configuración ── */}
        <div data-esq="act-doc-entregas" id="entregas-container" className="mx-4 my-4 rounded-card overflow-hidden bg-surface-card shadow-card border border-accent-soft">
          <div data-esq="act-doc-entregas-cabecera" className="px-4 py-3 bg-accent-light border-b border-accent-soft">
            <h2 className="font-semibold text-accent-hover">Entregas</h2>
          </div>

        {/* ZIP download — solo en la web. Primero en el contenedor. */}
        {!IS_NATIVE_APP && !telefonoWeb.telefono && Object.values(submissions).some((s) => s.archivoURL && !s.completadoSinArchivo) && (
          <div className="px-4 pt-3">
            <Button variant="outline-accent" fullWidth icon={FolderDown} busy={zipDownloading}
              onClick={handleZipDownload}
              disabled={zipDownloading}
              data-tooltip="Descarga todas las evidencias entregadas en un archivo ZIP.">
              
              {zipDownloading
                ? `Comprimiendo ${zipProgress.done}/${zipProgress.total}…`
                : 'Descargar entregas como ZIP'}
            </Button>
          </div>
        )}

        {/* Análisis con IA de esta actividad («solo resultados»): web de
            escritorio y teléfono, solo entregables publicados. Solo lee, así
            que no depende de la rúbrica ni de que el parcial esté abierto. */}
        {!IS_NATIVE_APP && !isObservacion && activity && cuentaParaCalificacion(activity) && (
          <div className="px-4 pt-3">
            <AnalisisEntregableIA activity={activity} subject={subject} />
          </div>
        )}

        {/* Las 3 acciones de IA sobre el lote de entregas, agrupadas en una
            sola tarjeta compacta (23-ago-2026, pedido de Kike: la barra se
            sentía saturada con 3 botones largos sueltos) — mismas funciones
            de siempre (contarEntregasIA/contarRecalificarIA/
            contarAplicarTodasIA), solo reorganización visual. "Aplicar
            propuestas" solo aparece si hay algo pendiente que aplicar. */}
        {hasRubrica && !IS_NATIVE_APP && !parcialCerrado && (() => {
          const pendientesIA = Object.values(sugerenciasLoteIA).filter((s) => s._estado === 'pendiente').length
          // "Recalificar con IA" solo se muestra cuando podemos CONFIRMAR que
          // el instrumento actual ya no es el que se usó para generar alguna
          // evaluación existente (25-ago-2026, pedido de Kike: evitar que el
          // docente vea — y use — una opción de recalificar que cobraría de
          // nuevo sin que exista ningún cambio real). Evaluaciones de antes de
          // este cambio no traen `_rubricaFirma` (huella desconocida): se
          // ignoran para esta comparación en vez de forzar el botón a
          // aparecer o desaparecer a ciegas — se resuelven solas en cuanto el
          // docente vuelva a usar "Calificar/Recalificar todas con IA".
          const firmaActual = rubricaFirma(activity.rubrica)
          const hayVersionDistinta = Object.values(sugerenciasLoteIA)
            .some((s) => s._rubricaFirma && s._rubricaFirma !== firmaActual)
          return (
            <div className="mx-4 mt-3 rounded-card border border-outline-variant">
              <p className="px-3 pt-2 text-[11px] text-muted">La IA propone; tú decides.</p>
              <div className="p-2 pt-1.5 space-y-1.5">
                <Button variant="outline-accent" fullWidth icon={Sparkles} iconEffect="destello"
                  onClick={contarEntregasIA}
                  data-tooltip="Genera propuestas de calificación con IA para las entregas pendientes.">
                  
                  Calificar
                </Button>
                {hayVersionDistinta && (
                  <Button variant="secondary" fullWidth icon={Sparkles} iconEffect="destello"
                    onClick={contarRecalificarIA}
                    data-tooltip="La rúbrica o lista de cotejo cambió desde la última evaluación con IA. Genera una nueva propuesta con la versión actual y consume créditos.">
                    
                    Recalificar
                  </Button>
                )}
                {pendientesIA > 0 && (
                  <button
                    type="button"
                    onClick={contarAplicarTodasIA}
                    data-tooltip="Aplica las propuestas de IA pendientes como calificación definitiva. No consume créditos."
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-full border border-emerald-300 text-emerald-700 text-sm font-medium hover:bg-emerald-50 transition-colors disabled:opacity-60 min-h-control"
                  >
                    <CheckCheck size={ICONO.sm} />
                    Aplicar propuestas ({pendientesIA})
                  </button>
                )}
              </div>
            </div>
          )
        })()}

          {/* Filter tabs — they belong to the Entregas list, so they live inside
              its container; clicking one scrolls the list into full view */}
          <div className={IS_NATIVE_APP ? 'grid grid-cols-2 gap-1 mx-4 mt-3 bg-surface-container p-1 rounded-card' : 'flex gap-1 mx-4 mt-3 bg-surface-container p-1 rounded-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'}>
            {['todos', 'pendiente', 'calificado', 'entregado'].map((f) => (
              <button
                type="button"
                key={f}
                onClick={() => {
                  setFilter(f)
                  setTimeout(() => document.getElementById('entregas-container')?.scrollIntoView({ behavior: desplazamiento(), block: 'start' }), 50)
                }}
                aria-pressed={filter === f}
                className={`${IS_NATIVE_APP ? '' : 'flex-1 whitespace-nowrap'} min-h-control-sm px-3 text-xs font-medium rounded-full transition-colors ${
                  filter === f ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'
                }`}
              >
                {FILTER_LABELS[f]} ({f === 'todos' ? students.length : counts[f]})
              </button>
            ))}
          </div>

        {/* Search — misma barra en web y en Android */}
        <div data-esq="act-doc-ayuda" className="px-4 pt-4 pb-2">
          <SearchInput
            value={searchStudents}
            onChange={setSearchStudents}
            etiqueta="Buscar por nombre o por número de lista…"
            autoFocus={PUEDE_AUTOFOCUS}
          />
          <p className="text-xs text-red-600 text-center mt-1.5">Presiona un nombre para evaluar</p>
        </div>

        {/* Student list — nombre a la izquierda, estatus a la derecha. Altura
            acotada con scroll propio (rueda del mouse) para que la búsqueda
            y los filtros de arriba no se muevan de lugar al recorrer la lista. */}
        <div data-esq="act-doc-lista-contenedor" className="px-4 pb-4">
          {filtered.length === 0 ? (
            <p className="text-center text-hint text-sm py-8">Sin estudiantes en esta categoría</p>
          ) : (
            <div data-esq="act-doc-lista" className="bg-surface-card rounded-card overflow-y-auto max-h-[60vh] shadow-card">
              {filtered.map((s, i) => {
                const status = getStatus(s.id)
                const sub = submissions[s.id]
                const hasExtension = !!activity?.extensiones?.[s.id]
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => openGradeFromList(s)}
                    className={`w-full flex items-center ${IS_NATIVE_APP ? 'gap-1 pl-1 pr-2' : 'gap-2 px-2'} py-1 min-h-control-sm text-left hover:bg-[var(--accent-tint)] transition-colors cursor-pointer ${
                      i > 0 ? 'border-t border-outline-variant' : ''
                    }`}
                  >
                    <span className={`${IS_NATIVE_APP ? 'text-[0.7rem]' : 'text-sm'} text-accent flex-shrink-0 whitespace-nowrap`}>{s.orden}.&nbsp;</span>
                    {/* Sin tooltip en el nombre: el aviso "Presiona un nombre para
                        evaluar", justo arriba de la lista, ya lo dice una vez para
                        toda la lista — repetirlo en cada renglón solo estorbaba. */}
                    <div className="flex-1 min-w-0">
                      <p className={`${IS_NATIVE_APP ? 'text-[0.7rem]' : 'text-sm'} font-medium text-on-surface truncate`}>
                        {studentFullName(s)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {hasExtension && <CalendarDays size={ICONO.sm} className="text-orange-400" />}
                      {sub?.tarde && (
                        <span data-tooltip="Entregó después de la fecha límite" className="text-[11px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                          Tarde
                        </span>
                      )}
                      {sub?.calificacion != null && (
                        <span className="text-xs font-bold text-emerald-600 flex items-center gap-0.5">
                          <Star size={ICONO.xs} /> {sub.calificacion}/{activity?.maxCalif}
                        </span>
                      )}
                      {!IS_NATIVE_APP && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[status]}`}>
                          {STATUS_LABELS[status]}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        </div>{/* end Entregas container */}
      </div>
      )}
    </>
  )
}
