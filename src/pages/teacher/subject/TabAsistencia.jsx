// Parte del render de SubjectPage.jsx (fase 5 de PLAN_NORMALIZACION_UI:
// dividir sin cambio visual). Recibe lo que usa del componente principal por
// el contexto Asignatura.
import { Button, SkeletonList, SkeletonTable } from '../../../components/ui'
import { CalendarPlus, FileSpreadsheet, MoreVertical, X } from 'lucide-react'
import { ICONO } from '../../../config/iconos'
import { IS_NATIVE_APP, PUEDE_AUTOFOCUS } from '../../../utils/platform'
import SearchInput from '../../../components/SearchInput'
import { useAsignatura } from './contexto'

export default function TabAsistencia() {
  const {
    activeTab,
    addDayLabel,
    attExportMenu,
    attSortOn,
    attSortParcial,
    attendanceLegend,
    attendanceLegendObservaciones,
    attendanceNoClaseDias,
    attendanceParciales,
    attendanceParcialesAll,
    attendanceRecords,
    attendanceStudentsRosterJsx,
    attendanceTableJsx,
    doExportParcialAttendance,
    exportingAttendance,
    filteredAttendanceStudents,
    handleAddDayClick,
    handleExportAttendance,
    loadingAttendance,
    nativeAttBar,
    searchAttendance,
    setAttExportMenu,
    setAttSortOn,
    setAttSortParcial,
    setSearchAttendance,
    setShowAllParciales,
    showAllParciales,
    subject,
    telefonoWeb,
    toggleMostrarAsistenciasEstudiantes,
    tomarListaMovil,
    tomarListaMovilBar,
    tomarListaScrollRef,
    totalStudents,
  } = useAsignatura()
  return (
    <>
      {activeTab === 'asistencia' && (IS_NATIVE_APP ? (
        /* ── Vista HORIZONTAL de pantalla completa (solo app) ──────────────
           Overlay que tapa la nav y el chrome. Con datos, los controles
           (Regresar/ASISTENCIAS/Agregar día) van en la esquina superior
           izquierda de la tabla para no gastar un renglón propio; los estados
           vacíos usan una barra simple. Sin Buscar y sin Totales; encabezado y
           nombre inmovilizados, solo scrollean los datos. */
        <div className="fixed inset-0 z-menu bg-surface flex flex-col safe-top">
          {loadingAttendance ? (
            <>{nativeAttBar}<SkeletonList rows={8} className="flex-1 p-4" /></>
          ) : totalStudents === 0 ? (
            <>{nativeAttBar}<p className="flex-1 grid place-items-center text-hint text-sm px-6 text-center">Necesitas al menos un estudiante inscrito para poder acceder a este apartado</p></>
          ) : attendanceRecords.length === 0 ? (
            <>
              {nativeAttBar}
              <div className="flex-1 overflow-auto p-3 space-y-2">
                <p className="text-hint text-sm text-center py-4">Aún no hay días de asistencia. Configura primero el horario de esta asignatura.</p>
                {attendanceStudentsRosterJsx}
              </div>
            </>
          ) : attendanceParciales.length === 0 ? (
            <>{nativeAttBar}<p className="flex-1 grid place-items-center text-hint text-sm px-6 text-center">Sin días de asistencia en el parcial actual.</p></>
          ) : (
            <div className="flex-1 overflow-auto bg-surface-card">
              {attendanceTableJsx}
            </div>
          )}
        </div>
      ) : tomarListaMovil ? (
        /* ── Tomar lista en el TELÉFONO, desde el navegador ────────────────
           Mismo enfoque que la vista de la app: pantalla completa, solo tomar
           y modificar asistencia (sin buscador, Excel, "Todo el curso" ni
           ordenar por riesgo). Un navegador no puede bloquear la orientación
           como la app, así que se adapta: en vertical los controles van en la
           barra de arriba; en horizontal, en la esquina de la tabla. Girar NO
           saca de aquí, y la barra y el contenedor ocupan el mismo lugar en
           ambas orientaciones para que React conserve el scroll.
           Safe-area a los lados (muesca/cámara en horizontal) y abajo
           (indicador de inicio del iPhone). */
        <div className="fixed inset-0 z-menu bg-surface flex flex-col safe-top"
          style={{ paddingLeft: 'env(safe-area-inset-left, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {loadingAttendance ? (
            <>{tomarListaMovilBar}<SkeletonList rows={8} className="flex-1 p-4" /></>
          ) : totalStudents === 0 ? (
            <>{tomarListaMovilBar}<p className="flex-1 grid place-items-center text-hint text-sm px-6 text-center">Necesitas al menos un estudiante inscrito para poder acceder a este apartado</p></>
          ) : attendanceRecords.length === 0 ? (
            <>
              {tomarListaMovilBar}
              <div className="flex-1 overflow-auto overscroll-contain p-3 space-y-2">
                <p className="text-hint text-sm text-center py-4">Aún no hay días de asistencia. Configura primero el horario de esta asignatura.</p>
                {attendanceStudentsRosterJsx}
              </div>
            </>
          ) : attendanceParciales.length === 0 ? (
            <>{tomarListaMovilBar}<p className="flex-1 grid place-items-center text-hint text-sm px-6 text-center">Sin días de asistencia en el parcial actual.</p></>
          ) : (
            <>
              {!telefonoWeb.horizontal && tomarListaMovilBar}
              <div ref={tomarListaScrollRef} className="flex-1 overflow-auto overscroll-contain bg-surface-card">
                {attendanceTableJsx}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="px-4 py-2 space-y-2">
        {totalStudents === 0 ? (
          <p className="text-center text-hint text-sm py-12">Necesitas al menos un estudiante inscrito para poder acceder a este apartado</p>
        ) : (
          <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">Asistencias</p>
            {addDayLabel && (
              <Button icon={CalendarPlus} onClick={handleAddDayClick}>
                 {addDayLabel}
              </Button>
            )}
          </div>

          {/* Por defecto solo se pinta el parcial actual — pedido explícito,
              antes se armaba TODA la tabla del curso completo de una sola
              vez, la causa real de que la pestaña se sintiera pesada con un
              semestre entero de días. Este interruptor solo existe en la
              web; en la App siempre es el parcial actual, sin opción. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex bg-surface-container p-1 rounded-full w-fit">
            <button type="button" onClick={() => setShowAllParciales(false)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors min-h-control-sm ${!showAllParciales ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'}`}>
              Parcial actual
            </button>
            <button type="button" onClick={() => setShowAllParciales(true)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors min-h-control-sm ${showAllParciales ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'}`}>
              Todo el curso
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-on-surface cursor-pointer select-none">
            <input
              type="checkbox"
              checked={subject?.mostrarAsistenciasEstudiantes !== false}
              onChange={toggleMostrarAsistenciasEstudiantes}
            />
            Mostrar asistencias a estudiantes
          </label>
          </div>

          {attendanceNoClaseDias.length > 0 && (
            <div className="text-xs text-muted bg-surface-container border border-outline-variant rounded px-3 py-2">
              <span className="font-semibold">Sin clase por asueto/vacaciones dentro del curso:</span>{' '}
              {attendanceNoClaseDias.map((d, i) => {
                const [, m, dd] = d.fecha.split('-')
                return (
                  <span key={d.fecha}>
                    {i > 0 && ', '}
                    <span className={d.tipo === 'vacaciones' ? 'text-purple-600 font-medium' : 'text-amber-600 font-medium'}>
                      {dd}/{m} ({d.tipo})
                    </span>
                  </span>
                )
              })}
            </div>
          )}

          {/* Excel split-button — mismo patrón que Calificaciones. Sin PDF:
              con una columna angosta por cada día de asistencia no tiene
              caso imprimirlo. */}
          {attendanceParcialesAll.length > 0 && (
            <div className="relative flex">
              <Button variant="outline-accent" icon={FileSpreadsheet} busy={exportingAttendance} className="flex-1"
                onClick={handleExportAttendance}
                disabled={exportingAttendance}
                data-tooltip="Descarga TODA la asistencia en una hoja de Excel">
                 Excel
              </Button>
              <Button variant="outline-accent" icon={MoreVertical} className="ml-1 !px-0 aspect-square"
                onClick={() => setAttExportMenu((m) => !m)}
                aria-label="Excel por parcial"
                data-tooltip="Excel por parcial"></Button>
              {attExportMenu && (
                <>
                  <button type="button" className="fixed inset-0 z-30 border-none cursor-default bg-transparent" onClick={() => setAttExportMenu(false)} aria-label="Cerrar menú" />
                  <div className="absolute z-40 top-full mt-1 right-0 w-52 bg-surface-card border border-outline-variant rounded-card shadow-2xl overflow-hidden animate-menu origin-top-right motion-reduce:animate-none">
                    <div className="px-3 py-2 text-xs font-semibold text-muted border-b border-outline-variant">Excel de un parcial</div>
                    {attendanceParcialesAll.map((g) => (
                      <button key={g.parcial} type="button"
                        onClick={() => { setAttExportMenu(false); doExportParcialAttendance(g.parcial) }}
                        className="w-full text-left px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors">
                        Parcial {g.parcial}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <SearchInput
            value={searchAttendance}
            onChange={setSearchAttendance}
            etiqueta="Buscar por nombre o por número de lista…"
            autoFocus={PUEDE_AUTOFOCUS}
          />

          {!IS_NATIVE_APP && (
            <div className="flex items-center gap-2">
              <button type="button"
                onClick={() => setAttSortOn((v) => !v)}
                data-tooltip={attSortOn ? 'Ordenado por mayor riesgo de inasistencia' : 'Ordenar por mayor riesgo de inasistencia'}
                className={`px-3 py-2 rounded-full text-xs font-bold uppercase tracking-wide transition-colors min-h-control-sm ${attSortOn ? 'bg-accent text-white hover:bg-accent-hover' : 'bg-surface-container text-muted hover:text-accent'}`}>
                Ordenar por riesgo{attSortOn ? ` · ${attSortParcial == null ? 'General' : `P${attSortParcial}`}` : ''}
              </button>
              <button type="button"
                onClick={() => {
                  const parcials = (subject?.parcialesFechas || []).map((_, i) => i + 1)
                  const idx = attSortParcial == null ? 0 : parcials.indexOf(attSortParcial) + 1
                  setAttSortParcial(idx < parcials.length ? parcials[idx] : null)
                  setAttSortOn(true)
                }}
                aria-label="Elegir parcial para ordenar asistencias"
                data-tooltip="Elegir parcial (o general)"
                className={`px-1.5 py-1.5 ml-1 rounded-full transition-colors min-h-control-sm ${attSortOn ? 'bg-accent text-white hover:bg-accent-hover' : 'bg-surface-container text-muted hover:text-accent'}`}>
                <MoreVertical size={ICONO.sm} />
              </button>
              {attSortOn && (
                <button type="button" onClick={() => { setAttSortOn(false); setAttSortParcial(null) }}
                  aria-label="Volver al orden normal" data-tooltip="Volver al orden normal"
                  className="size-control inline-flex items-center justify-center text-hint hover:text-red-500 rounded-full">
                  <X size={ICONO.sm} />
                </button>
              )}
            </div>
          )}

          {loadingAttendance ? (
            <SkeletonTable rows={8} cols={5} className="py-6" />
          ) : attendanceRecords.length === 0 ? (
            <>
              <p className="text-center text-hint text-sm py-4">Aún no hay días de asistencia. Configura primero el horario de esta asignatura.</p>
              {attendanceStudentsRosterJsx}
            </>
          ) : attendanceParciales.length === 0 ? (
            <p className="text-center text-hint text-sm py-12">Sin días de asistencia en el parcial actual — toca &quot;Todo el curso&quot; para ver los demás.</p>
          ) : (
            <>
              <div className="overflow-auto max-h-[65vh] rounded-card shadow-card bg-surface-card -mx-4 sm:mx-0">
                {attendanceTableJsx}
              </div>
              {attendanceLegend}
              {attendanceLegendObservaciones}
              {filteredAttendanceStudents.length === 0 && searchAttendance && (
                <p className="text-center text-sm text-hint">Sin resultados para &quot;{searchAttendance}&quot;</p>
              )}
            </>
          )}
          </>
        )}
        </div>
      ))}
    </>
  )
}
