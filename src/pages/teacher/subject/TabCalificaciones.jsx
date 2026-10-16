// Parte del render de SubjectPage.jsx (fase 5 de PLAN_NORMALIZACION_UI:
// dividir sin cambio visual). Recibe lo que usa del componente principal por
// el contexto Asignatura.
import AnalisisAsignaturaIA from '../../../components/analisis/AnalisisAsignaturaIA'
import { Button, IconButton, SkeletonTable } from '../../../components/ui'
import { ExportSplitButton } from './piezas'
import { AlertTriangle, Eye, EyeOff, FileSpreadsheet, FileText, Lock, MessageCircleQuestion, MoreVertical, Sparkles, X } from 'lucide-react'
import { ICONO } from '../../../config/iconos'
import { IS_NATIVE_APP, PUEDE_AUTOFOCUS } from '../../../utils/platform'
import SearchInput from '../../../components/SearchInput'
import { estadoParcial, mensajeParcialCerrado, parcialCerrado } from '../../../utils/ponderacion'
import { formatShortDate } from '../../../utils/dateRange'
import {
  actividadOculta, promedioOculto, finalOculto, promedioDeduceOcultas, finalDeduceOcultas,
  AVISO_APP_ANTERIOR, AVISO_PROMEDIO_DEDUCE,
} from '../../../utils/visibilidadCalificaciones'
import { gradeColor } from './utilidades'
import { showNear } from '../../../utils/notify'
import { studentFullName } from '../../../utils/studentSearch'
import { useAsignatura } from './contexto'

export default function TabCalificaciones() {
  const {
    activeTab,
    activities,
    activityLabelById,
    analisisAsignaturaAbierto,
    anyPonderacionOn,
    cambiarVisibilidadAlumno,
    colIndexByKey,
    doExportParcialExcel,
    doExportParcialPDF,
    doExportRanking,
    exporting,
    exportingGradesPdf,
    filteredGradeStudents,
    goToActivityFromGrades,
    gradeBodyCellBg,
    gradeBottomIds,
    gradeHeaderColBg,
    gradeSortMenuOpen,
    gradeSortOn,
    gradeSortParcial,
    gradeSubMap,
    gradeTopIds,
    groupStudents,
    guardandoVisibilidad,
    handleExport,
    handleExportGradesPDF,
    handleGradeTableHover,
    handleGradeTableLeave,
    loadingGrades,
    membrete,
    openActivityContextMenu,
    openGradeQuickEdit,
    parcialesConActividades,
    pesoEdits,
    pesoRestante,
    pesoTotalVivo,
    pondParcial,
    rankingExportMenu,
    savePeso,
    searchGrade,
    setActTip,
    setAnalisisAsignaturaAbierto,
    setGradeSortMenuOpen,
    setGradeSortOn,
    setGradeSortParcial,
    setParcialMenu,
    setPesoEdits,
    setRankingExportMenu,
    setSearchGrade,
    showFinalCol,
    sortedGradeRows,
    subject,
    subjectId,
    tableParcials,
    telefonoWeb,
    toggleParcialPonderacion,
    togglePonderacion,
    totalStudents,
    visibleParcials,
  } = useAsignatura()
  // ¿Hay algo oculto al estudiante? Activa las notas al pie de la tabla.
  const hayOcultas = tableParcials.some(({ p, acts }) =>
    promedioOculto(subject, p) || acts.some((a) => actividadOculta(subject, a.id))) || finalOculto(subject)
  const hayAvisoDeduce = tableParcials.some(({ p, acts }) => promedioDeduceOcultas(subject, p, acts)) ||
    (showFinalCol && finalDeduceOcultas(subject, tableParcials))
  return (
    <>
      {activeTab === 'calificaciones' && (
          <div className="px-4 py-2 space-y-2">
          {totalStudents === 0 ? (
            <p className="text-center text-hint text-sm py-12">Necesitas al menos un estudiante inscrito para poder acceder a este apartado</p>
          ) : (
            <>
            {/* 1 — Descargar calificaciones. El botón grande baja TODO; el ⋮
                 ofrece una descarga por parcial (progreso, sin cerrar). */}
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Calificaciones</p>
              {/* min-w-0 en cada split-button, SIN overflow-hidden en la fila
                  (bug real reportado en producción: "los tres puntitos no
                  hacen nada" — el menú SÍ se abría, pero este overflow-hidden
                  lo recortaba por completo porque se despliega hacia abajo,
                  fuera de la caja de la fila; solo se notaba mirando la
                  pantalla, no leyendo el HTML, que seguía mostrando el menú
                  "presente" aunque invisible). min-w-0 por sí solo ya evita
                  que los dos flex-1 fuercen scroll horizontal, sin necesidad
                  de recortar overflow. */}
              <div className="flex gap-2">
                {/* Excel y PDF: relleno de tinte de acento + borde, no borde
                    solo (se perdían sobre la tarjeta blanca) ni acento sólido
                    (probado y descartado: quedaba demasiado gritón para un
                    botón secundario de una pantalla de trabajo). Es el mismo
                    tratamiento que usan los chips seleccionados en el resto de
                    la app. Los tres botones de descarga de la pantalla (Excel y
                    PDF aquí, Excel en Asistencias) lo comparten. */}
                <ExportSplitButton
                  label="Excel" Icon={FileSpreadsheet}
                  onMain={handleExport} mainDisabled={exporting}
                  mainTooltip="Descarga TODAS las calificaciones en una hoja de Excel"
                  menuTooltip="Excel por parcial" menuLabel="Excel de un parcial"
                  parciales={parcialesConActividades} onPickParcial={doExportParcialExcel}
                />
                <ExportSplitButton
                  label="PDF" Icon={FileText}
                  onMain={handleExportGradesPDF} mainDisabled={exportingGradesPdf}
                  mainTooltip="Descarga TODAS las calificaciones en un PDF imprimible"
                  menuTooltip="PDF por parcial" menuLabel="PDF de un parcial"
                  parciales={parcialesConActividades} onPickParcial={doExportParcialPDF}
                />
                {/* Análisis integral con IA: junto a Excel/PDF porque parte de
                    lo mismo que ellos — los resultados de toda la asignatura.
                    No ejecuta nada al pulsarlo: abre la configuración. */}
                <Button variant="outline-accent" icon={Sparkles} iconEffect="destello" className="flex-1 min-w-0" onClick={() => setAnalisisAsignaturaAbierto(true)}
                  data-tooltip="Elige parciales y fuentes; la IA prepara un informe del grupo. No modifica calificaciones.">
                   <span className="truncate">Analizar asignatura con IA</span>
                </Button>
              </div>
            </div>

            <AnalisisAsignaturaIA
              subject={subject}
              subjectId={subjectId}
              membrete={membrete}
              abierto={analisisAsignaturaAbierto}
              onCerrar={() => setAnalisisAsignaturaAbierto(false)}
            />

            <SearchInput
              value={searchGrade}
              onChange={setSearchGrade}
              etiqueta="Buscar por nombre o por número de lista…"
              autoFocus={PUEDE_AUTOFOCUS}
            />

            {loadingGrades ? (
              <SkeletonTable rows={8} cols={5} className="py-6" />
            ) : activities.length === 0 ? (
              <p className="text-center text-hint text-sm py-12">No hay actividades en esta asignatura</p>
            ) : groupStudents.length === 0 ? (
              <p className="text-center text-hint text-sm py-12">No hay estudiantes en este grupo</p>
            ) : (
              <>
                {/* Action bar above the table — ponderación toggle lives here now
                    (moved out of the crowded table header) */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={togglePonderacion}
                    data-tooltip={anyPonderacionOn ? 'Quitar la ponderación de todos los parciales' : 'Cada actividad vale un peso — se activa en todos los parciales; luego puedes apagarla por parcial'}
                    className={`px-3 py-2 rounded-full text-xs font-bold uppercase tracking-wide transition-colors min-h-control-sm ${anyPonderacionOn
                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                      : 'bg-accent text-white hover:bg-accent-hover'}`}>
                    {anyPonderacionOn ? 'Volver a promedio simple' : 'Activar ponderación'}
                  </button>
                  {anyPonderacionOn && (
                    <span className="text-sm text-muted">Asigna un peso a cada actividad (deben sumar 10 por parcial para exportar).</span>
                  )}
                  {/* Bloque derecho: (en modo ordenar) exportar Excel/PDF del
                      ranking, y el botón "Ordenar de mayor a menor". */}
                  <div className="ml-auto flex items-center gap-2 flex-wrap">
                    {/* Exportar el ranking — solo en modo ordenar. Clic directo =
                        Promedio final; los 3 puntitos eligen el parcial. */}
                    {gradeSortOn && ['excel', 'pdf'].map((kind) => (
                      <div key={kind} className="order-2 flex items-center relative">
                        <Button variant="outline-accent" onClick={() => doExportRanking(kind, null)}
                          data-tooltip={`${kind === 'excel' ? 'Excel' : 'PDF'} del ranking (Promedio final)`}>
                          {kind === 'excel' ? <FileSpreadsheet size={ICONO.xs} /> : <FileText size={ICONO.xs} />}
                          {kind === 'excel' ? 'Excel' : 'PDF'}
                        </Button>
                        <Button variant="outline-accent" icon={MoreVertical} className="ml-1 !px-0 aspect-square" onClick={() => setRankingExportMenu((m) => (m === kind ? null : kind))}
                          aria-label="Elegir parcial del documento" data-tooltip="Elegir parcial (o general)"></Button>
                        {rankingExportMenu === kind && (
                          <div className="absolute right-0 top-full mt-1 z-30 bg-surface-card border border-outline-variant rounded-card shadow-lg py-1 min-w-[180px] animate-menu origin-top-right motion-reduce:animate-none">
                            <button type="button" onClick={() => doExportRanking(kind, null)}
                              className="w-full text-left px-3 py-1.5 text-xs text-on-surface hover:bg-[var(--accent-tint)]">
                              General (promedio final)
                            </button>
                            {tableParcials.map(({ p }) => (
                              <button key={p} type="button" onClick={() => doExportRanking(kind, p)}
                                className="w-full text-left px-3 py-1.5 text-xs text-on-surface hover:bg-[var(--accent-tint)]">
                                Parcial {p}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {/* Ordenar de mayor a menor por promedio (con columna LUGAR).
                        Los 3 puntitos eligen el parcial; sin elegir, es el general. */}
                    <div className="order-1 flex items-center gap-1 relative">
                      <button type="button" onClick={() => setGradeSortOn((v) => !v)}
                        data-tooltip={gradeSortOn ? 'Ordenado de mayor a menor' : 'Ordenar por promedio, de mayor a menor'}
                        className={`px-3 py-2 rounded-full text-xs font-bold uppercase tracking-wide transition-colors min-h-control-sm ${gradeSortOn ? 'bg-accent text-white hover:bg-accent-hover' : 'bg-surface-container text-muted hover:text-accent'}`}>
                        Ordenar de mayor a menor{gradeSortOn ? ` · ${gradeSortParcial == null ? 'General' : `P${gradeSortParcial}`}` : ''}
                      </button>
                      <button type="button" onClick={() => setGradeSortMenuOpen((v) => !v)}
                        aria-label="Elegir parcial para ordenar" data-tooltip="Elegir parcial (o general)"
                        className={`px-1.5 py-1.5 ml-1 rounded-full transition-colors min-h-control-sm ${gradeSortOn ? 'bg-accent text-white hover:bg-accent-hover' : 'bg-surface-container text-muted hover:text-accent'}`}>
                        <MoreVertical size={ICONO.sm} />
                      </button>
                      {gradeSortOn && (
                        <IconButton icon={X} label="Volver al orden normal" variant="danger" tooltip={false} onClick={() => { setGradeSortOn(false); setGradeSortMenuOpen(false) }}
                          data-tooltip="Volver al orden normal" />
                      )}
                      {gradeSortMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 z-30 bg-surface-card border border-outline-variant rounded-card shadow-lg py-1 min-w-[170px] animate-menu origin-top-right motion-reduce:animate-none">
                          <button type="button" onClick={() => { setGradeSortParcial(null); setGradeSortOn(true); setGradeSortMenuOpen(false) }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--accent-tint)] ${gradeSortParcial == null ? 'font-bold text-accent' : 'text-on-surface'}`}>
                            General (promedio final)
                          </button>
                          {tableParcials.map(({ p }) => (
                            <button key={p} type="button" onClick={() => { setGradeSortParcial(p); setGradeSortOn(true); setGradeSortMenuOpen(false) }}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--accent-tint)] ${gradeSortParcial === p ? 'font-bold text-accent' : 'text-on-surface'}`}>
                              Parcial {p}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {gradeSortOn && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3.5 h-3.5 rounded bg-green-100 border border-green-300 flex-shrink-0" />
                      20% con mayor promedio — destacan (p. ej. concursos)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3.5 h-3.5 rounded bg-orange-100 border border-orange-300 flex-shrink-0" />
                      20% con menor promedio — requieren atención especial
                    </span>
                  </div>
                )}

                <div className="overflow-auto max-h-[65vh] rounded-card shadow-card bg-surface-card -mx-4 sm:mx-0">
                  {/* table-fixed + explicit narrow per-column widths (no forced
                      min-w on the table itself) — the table only takes the
                      width its columns actually need, so the wrapper's
                      overflow-x-auto only scrolls once real content overflows,
                      never just because of an arbitrary minimum.
                      overflow-auto + max-h = inmovilizadores estilo Excel: la
                      rueda del mouse baja/sube ~13-15 estudiantes por pantalla y
                      la barra horizontal muestra las columnas; encabezado (thead
                      sticky top) y columnas No./Nombre (sticky left) fijos. */}
                  <table
                    className="grades-table text-xs border-collapse table-fixed"
                    onMouseOver={handleGradeTableHover}
                    onMouseLeave={handleGradeTableLeave}
                    onFocus={handleGradeTableHover}
                    onBlur={handleGradeTableLeave}
                  >
                    {/* table-fixed reads column widths from the first row, but
                        that row has colSpan'd "Parcial" headers — an explicit
                        colgroup is the only reliable way to size each real
                        column regardless of the header's rowspan/colspan. */}
                    <colgroup>
                      <col className="w-8" />
                      <col className="w-[210px]" />
                      {visibleParcials.map(({ p, acts }) => [
                        ...acts.map((a) => <col key={a.id} className="w-9" />),
                        <col key={`avgcol-${p}`} className="w-14" />,
                      ])}
                      {showFinalCol && <col className="w-14" />}
                    </colgroup>
                    <thead className="sticky top-0 z-30">
                      <tr className="bg-accent-light border-b border-outline-variant">
                        <th className="sticky left-0 z-10 bg-accent-light w-8 px-1 py-1.5 border-r border-outline-variant" />
                        <th className="sticky left-8 z-20 bg-accent-light w-[210px] px-2 py-1.5 text-left text-[10px] font-bold text-muted uppercase tracking-wide border-r border-outline-variant" />
                        {visibleParcials.map(({ p, acts }) => (
                          <th key={p} colSpan={acts.length + 1}
                            className="px-1.5 py-1 font-semibold text-accent text-center border-l border-outline-variant whitespace-nowrap">
                            {/* Clean header: "Parcial N" + a ⋮ menu (Exportar / Cerrar),
                                so 2-3-activity parciales never crowd. A lock shows the
                                closed state at a glance. */}
                            <div className="flex items-center justify-center gap-1">
                              {subject?.parcialesCerrados?.[p] && (
                                <Lock size={ICONO.xs} className="text-emerald-600 flex-shrink-0" data-tooltip="Parcial cerrado" />
                              )}
                              {estadoParcial(subject, p) === 'atencion' && (
                                <MessageCircleQuestion size={ICONO.xs} className="text-accent flex-shrink-0" data-tooltip="Atención de inquietudes" />
                              )}
                              <span>
                                Parcial {p}
                                {/* Fechas del parcial solo en la web de escritorio. */}
                                {!IS_NATIVE_APP && !telefonoWeb.telefono && subject?.parcialesFechas?.[p - 1] && (
                                  <span className="block text-[9px] font-normal text-hint normal-case tabular-nums">
                                    ({formatShortDate(subject.parcialesFechas[p - 1].inicio)}–{formatShortDate(subject.parcialesFechas[p - 1].fin)})
                                  </span>
                                )}
                              </span>
                              <button type="button" id={`parcial-menu-${p}`}
                                onClick={(e) => {
                                  const r = e.currentTarget.getBoundingClientRect()
                                  setParcialMenu((m) => m?.p === p ? null : { p, x: r.right, y: r.bottom })
                                }}
                                aria-label="Acciones del parcial"
                                data-tooltip-follow="Acciones del parcial"
                                className="p-0.5 rounded text-hint hover:text-accent hover:bg-[var(--accent-medium)] transition-colors flex-shrink-0">
                                <MoreVertical size={ICONO.sm} />
                              </button>
                            </div>
                          </th>
                        ))}
                        {showFinalCol && (
                          <th className="w-14 px-1.5 py-1.5 font-semibold text-muted text-center border-l border-outline-variant whitespace-nowrap">
                            Final
                          </th>
                        )}
                      </tr>
                      {/* Fila VISIBLE AL ALUMNO — qué notas puede consultar el estudiante.
                          Siempre está (con o sin ponderación) y va justo arriba de
                          PONDERACIÓN; sin ponderación ocupa el mismo lugar entre el
                          encabezado del parcial y los nombres. Un control por
                          actividad, por promedio de parcial y por Final, todos
                          independientes. Solo regula lo que ve el estudiante: el
                          docente conserva todo, y no cambia ninguna nota ni promedio.
                          Se puede usar con el parcial cerrado. Mismas columnas y
                          anchos que las demás filas. */}
                      <tr data-fila="visibilidad" className="bg-accent-light border-b border-outline-variant">
                        <th className="sticky left-0 z-10 bg-accent-light w-8 px-1 py-1 border-r border-outline-variant"><span className="sr-only">Visibilidad para el estudiante</span></th>
                        <th aria-label="Visible al alumno" className="sticky left-8 z-10 bg-accent-light w-[210px] px-2 py-1 border-r border-outline-variant">
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="text-[10px] font-bold text-accent uppercase tracking-wide" data-tooltip={`Decide qué notas ve el estudiante. ${AVISO_APP_ANTERIOR}`}>Visible al alumno</span>
                          </div>
                        </th>
                        {visibleParcials.map(({ p, acts }) => [
                          ...acts.map((a) => (
                            <th key={a.id} className="w-9 px-0.5 py-1 border-l border-outline-variant bg-accent-light">
                              <BotonVisibilidad
                                oculto={actividadOculta(subject, a.id)}
                                guardando={!!guardandoVisibilidad[`actividad:${a.id}`]}
                                objeto={`la calificación de ${activityLabelById[a.id] || a.nombre}`}
                                onClick={() => cambiarVisibilidadAlumno('actividad', a.id)} />
                            </th>
                          )),
                          <th key={`vis-avg-${p}`} className="w-14 px-1 py-1 border-l border-outline-variant bg-accent-light">
                            <div className="flex items-center justify-center gap-0.5">
                              <BotonVisibilidad
                                oculto={promedioOculto(subject, p)}
                                guardando={!!guardandoVisibilidad[`promedio:${p}`]}
                                objeto={`el promedio del Parcial ${p}`}
                                onClick={() => cambiarVisibilidadAlumno('promedio', p)} />
                              {promedioDeduceOcultas(subject, p, acts) && <AvisoDeduce />}
                            </div>
                          </th>,
                        ])}
                        {showFinalCol && (
                          <th className="w-14 px-1 py-1 border-l border-outline-variant bg-accent-light">
                            <div className="flex items-center justify-center gap-0.5">
                              <BotonVisibilidad
                                oculto={finalOculto(subject)}
                                guardando={!!guardandoVisibilidad['final:']}
                                objeto="la calificación final"
                                onClick={() => cambiarVisibilidadAlumno('final')} />
                              {finalDeduceOcultas(subject, tableParcials) && <AvisoDeduce />}
                            </div>
                          </th>
                        )}
                      </tr>
                      {/* PONDERACIÓN row — weights per activity, per PARCIAL.
                          Active parciales show their weight inputs (with an ✕
                          to turn just that parcial off); inactive ones show an
                          "Activar" button instead. */}
                      {anyPonderacionOn && (
                        <tr className="bg-amber-50 border-b border-amber-200">
                          <th className="sticky left-0 z-10 bg-amber-50 w-8 px-1 py-1 border-r border-outline-variant" />
                          <th aria-label="Ponderación" className="sticky left-8 z-10 bg-amber-50 w-[210px] px-2 py-1 border-r border-outline-variant">
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">Ponderación</span>
                            </div>
                          </th>
                          {visibleParcials.map(({ p, acts }) => pondParcial(p) ? [
                            ...acts.map((a) => (
                              <th key={a.id} className="w-9 px-0.5 py-1 border-l border-outline-variant bg-amber-50">
                                {/* Typing only — no wheel, no auto-fill, no forced
                                    sum: the teacher writes the weights they want;
                                    "must sum 10" is asked only when exporting. */}
                                <input id={`peso-${a.id}`} type="text" inputMode="decimal" min="0" max="10"
                                  autoComplete="off"
                                  value={pesoEdits[a.id] ?? (a.pesoCalificacion ?? '')}
                                  onChange={(e) => {
                                    let raw = e.target.value
                                    const n = parseFloat(raw)
                                    if (!isNaN(n)) {
                                      // Cap to what's left so the parcial never passes 10;
                                      // show a message right on the box when they try more
                                      const maxAllowed = pesoRestante(acts, a.id)
                                      if (n > maxAllowed) {
                                        raw = String(maxAllowed)
                                        showNear(e.target, 'La suma del parcial debe ser 10 — no puedes poner más aquí')
                                      }
                                      else if (n < 0) raw = '0'
                                      else {
                                        const m = raw.match(/^(\d+\.\d)\d+$/)
                                        if (m) raw = m[1]
                                      }
                                    }
                                    setPesoEdits((f) => ({ ...f, [a.id]: raw }))
                                  }}
                                  onFocus={(e) => { try { e.target.select() } catch { /* algunos navegadores */ } }}
                                  onBlur={() => savePeso(a)}
                                  readOnly={parcialCerrado(subject, p)}
                                  data-tooltip={parcialCerrado(subject, p) ? mensajeParcialCerrado(p) : `Peso de la actividad ${activityLabelById[a.id] || ''}`}
                                  className="no-spinner w-full px-0 py-0.5 text-center text-[11px] font-semibold rounded-card border border-amber-300 bg-white text-amber-800 focus:outline-none focus:ring-1 focus:ring-amber-400 read-only:opacity-60 read-only:cursor-not-allowed" />
                              </th>
                            )),
                            <th key={`pw-${p}`} className={`w-14 px-1 py-1 text-center text-[11px] font-bold border-l border-outline-variant bg-amber-50 ${pesoTotalVivo(acts) === 10 ? 'text-emerald-600' : 'text-amber-700'}`}>
                              <div className="flex items-center justify-center gap-0.5">
                                <span data-tooltip={pesoTotalVivo(acts) === 10 ? 'Los pesos suman 10' : `Los pesos suman ${pesoTotalVivo(acts)}, no 10. El promedio se calcula siempre entre 10 y los pesos no se ajustan solos${pesoTotalVivo(acts) > 10 ? '; nunca pasa de 10' : ''}. Para exportar, cerrar o publicar este parcial deberá sumar 10`}>{pesoTotalVivo(acts)}</span>
                                {pesoTotalVivo(acts) !== 10 && <AlertTriangle size={ICONO.xs} aria-label="Los pesos de este parcial no suman 10" className="flex-shrink-0 text-amber-600" />}
                                <button type="button" onClick={() => toggleParcialPonderacion(p)}
                                  aria-label={`Quitar la ponderación solo del Parcial ${p}`}
                                  data-tooltip={parcialCerrado(subject, p) ? mensajeParcialCerrado(p) : `Quitar la ponderación solo del Parcial ${p}`}
                                  className="p-0.5 text-amber-400 hover:text-amber-800 rounded transition-colors">
                                  <X size={ICONO.xs} />
                                </button>
                              </div>
                            </th>,
                          ] : (
                            <th key={`pond-off-${p}`} colSpan={acts.length + 1} className="px-1 py-1 text-center border-l border-outline-variant bg-amber-50/50">
                              <button type="button" onClick={() => toggleParcialPonderacion(p)}
                                data-tooltip-follow={parcialCerrado(subject, p) ? mensajeParcialCerrado(p) : `Ponderar solo el Parcial ${p} — este parcial usa promedio simple`}
                                className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-white border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors whitespace-nowrap">
                                Activar en P{p}
                              </button>
                            </th>
                          ))}
                          {showFinalCol && <th className="w-14 bg-amber-50 border-l border-outline-variant" />}
                        </tr>
                      )}
                      <tr className="bg-accent-light border-b border-outline-variant">
                        <th className={`sticky left-0 z-10 bg-accent-light w-8 px-1 py-1.5 text-center border-r border-outline-variant whitespace-nowrap ${gradeSortOn ? 'font-bold text-accent' : 'font-medium text-muted'}`}>
                          {gradeSortOn ? 'LUGAR' : 'No.'}
                        </th>
                        <th className="sticky left-8 z-10 bg-accent-light w-[210px] px-2 py-1.5 text-left font-medium text-muted border-r border-outline-variant whitespace-nowrap">
                          Estudiante / Actividad
                        </th>
                        {visibleParcials.map(({ p, acts }) => [
                          ...acts.map((a) => (
                            <th
                              key={a.id}
                              data-col={colIndexByKey[`act-${a.id}`]}
                              onClick={() => goToActivityFromGrades(`/activity/${a.id}`, { state: { returnTo: 'calificaciones' } })}
                              onContextMenu={(e) => openActivityContextMenu(e, a)}
                              onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setActTip({ text: a.nombre, hint: 'Clic derecho para asignar calificación a quienes no entregaron', x: r.left + r.width / 2, y: r.top }) }}
                              onMouseLeave={() => setActTip(null)}
                              className={`w-9 px-0.5 py-1.5 font-semibold text-on-surface text-center border-l border-outline-variant transition-colors duration-estandar cursor-pointer hover:ring-2 hover:ring-inset hover:ring-[var(--accent)] ${gradeHeaderColBg(colIndexByKey[`act-${a.id}`])}`}>
                              {/* Tooltip is a fixed-positioned element (below), so the
                                  table's scroll container can't clip it — always ABOVE. */}
                              <span className="block truncate">{activityLabelById[a.id] || a.nombre}</span>
                            </th>
                          )),
                          <th key={`avg-${p}`} data-col={colIndexByKey[`avg-${p}`]} className={`w-14 px-1.5 py-1.5 font-semibold text-muted text-center border-l border-outline-variant whitespace-nowrap transition-colors duration-estandar ${gradeHeaderColBg(colIndexByKey[`avg-${p}`])}`}>
                            Prom.
                          </th>,
                        ])}
                        {showFinalCol && (
                          <th data-col={colIndexByKey.final} className={`w-14 px-1.5 py-1.5 font-semibold text-muted text-center border-l border-outline-variant whitespace-nowrap transition-colors duration-estandar ${gradeHeaderColBg(colIndexByKey.final)}`}>
                            Prom.
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedGradeRows.map(({ s, parcialData, finalAvg }, i) => {
                        // Fondo de resaltado del ranking (verde mejores / naranja peores).
                        const hl = gradeTopIds.has(s.id) ? 'bg-green-100' : gradeBottomIds.has(s.id) ? 'bg-orange-100' : ''
                        const stripeBg = i % 2 === 0 ? 'bg-surface-card' : 'bg-slate-50/50'
                        return (
                        <tr key={s.id} data-row={i} className={`group border-t border-outline-variant transition-colors duration-estandar hover:bg-[var(--accent-tint)] ${i % 2 === 0 ? '' : 'bg-slate-50/50'}`}>
                          <td className={`sticky left-0 z-10 w-8 px-1 py-1 text-center border-r border-outline-variant transition-colors duration-estandar group-hover:bg-[var(--accent-tint-solid)] ${gradeSortOn ? 'font-bold text-accent' : 'text-hint'} ${hl || stripeBg}`}>
                            {gradeSortOn ? i + 1 : s.orden}
                          </td>
                          {/* data-tooltip goes on an INNER span, never on this td:
                              [data-tooltip] forces position:relative, which would
                              override `sticky` and let left-8 shove the cell right */}
                          <td className={`sticky left-8 z-10 w-[210px] px-2 py-1 text-sm font-medium text-on-surface border-r border-outline-variant transition-colors duration-estandar group-hover:bg-[var(--accent-tint-solid)] ${hl || stripeBg}`}>
                            <span
                              className="block truncate"
                              data-tooltip={
                                !s.activado
                                  ? 'Este estudiante aún no ha activado su cuenta — no puede entrar ni entregar'
                                  : s.ocultaPorAlumno
                                    ? `Salió de la asignatura${s.ocultaPorAlumnoAt?.toDate ? ` el ${s.ocultaPorAlumnoAt.toDate().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''} — no la ve en su lista, pero sigue inscrito y sus entregas/calificaciones cuentan igual`
                                    : undefined
                              }
                            >
                              {studentFullName(s)}
                              {!s.activado && <span className="text-red-500 text-[10px] font-semibold"> (no se ha activado)</span>}
                              {s.activado && s.ocultaPorAlumno && <span className="text-hint text-[10px] font-semibold"> (salió)</span>}
                            </span>
                          </td>
                          {visibleParcials.map(({ p, acts }) => {
                            const pd = parcialData.find((x) => x.p === p)
                            const grades = pd?.grades || []
                            const gradesCierre = pd?.gradesCierre || []
                            return [
                              ...acts.map((a, ai) => (
                                <td
                                  key={a.id}
                                  data-col={colIndexByKey[`act-${a.id}`]}
                                  data-tooltip={
                                    gradesCierre[ai] ? 'Calificación asignada al cerrar el parcial (no entregó) — reabre el parcial para corregirla'
                                    : grades[ai] != null ? `${a.tipo === 'evaluacion' ? 'Ver resultado' : 'Ver entrega'} · clic derecho para corregir rápido`
                                    : `${a.tipo === 'evaluacion' ? 'Ver resultado' : 'Ver entrega'} · clic derecho para calificar rápido`
                                  }
                                  onClick={() => goToActivityFromGrades(`/activity/${a.id}`, { state: { openStudentId: s.id, returnTo: 'calificaciones' } })}
                                  onContextMenu={(e) => openGradeQuickEdit(e, gradeSubMap[`${s.id}-${a.id}`], a, s)}
                                  className={`w-9 px-0.5 py-1 text-center font-semibold border-l border-outline-variant transition-colors duration-estandar cursor-pointer hover:ring-2 hover:ring-inset hover:ring-[var(--accent)] ${gradesCierre[ai] ? 'text-red-500' : grades[ai] == null ? 'text-hint' : 'text-on-surface'} ${hl || gradeBodyCellBg(colIndexByKey[`act-${a.id}`], i)}`}
                                >
                                  {grades[ai] != null ? grades[ai] : '—'}
                                </td>
                              )),
                              <td key={`avg-${p}`} data-col={colIndexByKey[`avg-${p}`]} className={`w-14 px-1.5 py-1 text-center font-bold border-l border-outline-variant transition-colors duration-estandar ${gradeColor(pd?.avg ?? null)} ${hl || gradeBodyCellBg(colIndexByKey[`avg-${p}`], i)}`}>
                                {pd?.avg != null ? pd.avg : '—'}
                              </td>,
                            ]
                          })}
                          {showFinalCol && (
                            <td data-col={colIndexByKey.final} className={`w-14 px-1.5 py-1 text-center font-bold border-l border-outline-variant transition-colors duration-estandar ${gradeColor(finalAvg)} ${hl || gradeBodyCellBg(colIndexByKey.final, i)}`}>
                              {finalAvg !== null ? finalAvg : '—'}
                            </td>
                          )}
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {hayOcultas && (
                  <div data-nota="visibilidad" className="space-y-1 text-[11px] leading-snug text-hint">
                    <p>{AVISO_APP_ANTERIOR}</p>
                    {hayAvisoDeduce && <p>El triángulo junto a un promedio avisa que incluye notas que el estudiante no ve; podría deducirlas.</p>}
                  </div>
                )}

                {filteredGradeStudents.length === 0 && searchGrade && (
                  <p className="text-center text-sm text-hint">Sin resultados para &ldquo;{searchGrade}&rdquo;</p>
                )}
              </>
            )}
            </>
          )}
          </div>
        )}
    </>
  )
}

// Botón de ojo de la fila «Visible al alumno»: ojo abierto = el estudiante ve
// la nota; ojo tachado = oculta. Ocupa todo el ancho de su columna (la tabla
// usa colgroup fijo) y no agrega altura de más a la fila.
function BotonVisibilidad({ oculto, guardando, objeto, onClick }) {
  const Icono = oculto ? EyeOff : Eye
  const estado = oculto ? 'Oculta al estudiante' : 'Visible para el estudiante'
  const accion = oculto ? 'Mostrar' : 'Ocultar'
  return (
    <button type="button" onClick={onClick} disabled={guardando}
      aria-pressed={oculto}
      aria-label={`${accion} ${objeto} al estudiante. Ahora: ${estado.toLowerCase()}`}
      data-tooltip-follow={`${estado} — clic para ${accion.toLowerCase()}`}
      className={`flex w-full items-center justify-center rounded py-0.5 transition-colors disabled:cursor-wait disabled:opacity-60 ${oculto
        ? 'bg-surface-container text-hint hover:text-accent'
        : 'text-accent hover:bg-[var(--accent-medium)]'}`}>
      <Icono size={ICONO.xs} />
    </button>
  )
}

// Triángulo junto a un promedio visible que incluye notas ocultas.
function AvisoDeduce() {
  return (
    <span data-tooltip-follow={AVISO_PROMEDIO_DEDUCE} className="flex-shrink-0 text-amber-600">
      <AlertTriangle size={ICONO.xs} aria-hidden="true" />
      <span className="sr-only">{AVISO_PROMEDIO_DEDUCE}</span>
    </span>
  )
}
