// Parte del render de ActivityPage.jsx (fase 5 de PLAN_NORMALIZACION_UI:
// dividir sin cambio visual). Recibe lo que usa del componente principal por
// el contexto Actividad.
import { AbrirConNativoButton } from './piezas'
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Download, WandSparkles, Star, Trash2 } from 'lucide-react'
import { Button } from '../../../components/ui'
import EnlaceEntregado from '../../../components/EnlaceEntregado'
import { FilePreview, canPreviewFile } from '../../../components/AttachmentList'
import { ICONO } from '../../../config/iconos'
import { IS_NATIVE_APP } from '../../../utils/platform'
import { MENSAJE_PRORROGA_CON_ENTREGA } from '../../../utils/extensiones'
import { NativeEvalBgFix, formatLateness, isImageFile } from './utilidades'
import { RUBRICA_TOTAL, totalRubrica } from '../../../utils/rubrica'
import Spinner from '../../../components/Spinner'
import ZoomableImage from '../../../components/ZoomableImage'
import { createPortal } from 'react-dom'
import { downloadUrl } from '../../../utils/cloudinary'
import { formatHora12FromDate } from '../../../utils/formatHora'
import { studentFullName } from '../../../utils/studentSearch'
import { useActividad } from './contexto'

export default function PanelCalificarMovil() {
  const {
    abrirCalificarIA,
    activity,
    activityLabel,
    canCreate,
    changeFilterInView,
    closeModal,
    counts,
    filter,
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
    prorrogaBloqueada,
    puedeCalificarConIA,
    rubricEval,
    rubricaBtnRef,
    rubricaViewOpen,
    saveGrade,
    saving,
    selFiles,
    selected,
    setAnnulMode,
    setExtendMode,
    setRubricaViewOpen,
    setRubricaWinBottom,
    stepCalif,
    students,
  } = useActividad()
  return (
    <>
      {selected && IS_NATIVE_APP && createPortal(
        <>
          <NativeEvalBgFix />
          {/* Anclado arriba/abajo/izquierda y con el ancho REAL de la pantalla
              (--layout-w, ver src/utils/viewportWidth.js). NO se usa 100vw:
              vw resuelve contra el layout viewport, que en el WebView de
              Samsung puede ser más ancho que la pantalla — el overlay se salía
              y dejaba la franja vacía a la derecha. */}
          <div className="fixed top-0 bottom-0 left-0 z-40 flex flex-col bg-white overflow-hidden"
            style={{ width: 'var(--layout-w, 100%)' }}>
          <div className="flex items-center gap-2 px-3 py-2 bg-surface-card border-b border-outline-variant flex-shrink-0 safe-top">
            <button
              type="button"
              onClick={closeModal}
              aria-label="Regresar"
              data-tooltip="Regresar"
              className="size-control inline-flex items-center justify-center -ml-1 text-muted hover:text-accent rounded-full flex-shrink-0 transition-colors"
            >
              <ArrowLeft size={ICONO.md} />
            </button>
            <h3 className="text-sm font-semibold text-on-surface truncate flex-1 min-w-0">
              {activityLabel && <span className="text-accent">{activityLabel} </span>}
              {activity?.nombre}
            </h3>
          </div>

          {/* Columna flex: la entrega es flex-1 (toma todo el espacio que
              sobra), el resto de secciones reserva su alto natural — así la
              entrega queda lo más alta posible sin dejar nada fuera de
              pantalla. overflow-y-auto es solo un respaldo por si algo no
              cupiera en una pantalla muy pequeña. */}
          {/* Sin padding horizontal: la imagen va edge-to-edge dentro del overlay
              para no dejar franja azul a los lados. El px-3 va en cada hijo
              que lo necesite (texto, nombre, botones, formulario). */}
          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden py-2 gap-2">

            {selFiles.some((f) => isImageFile(f.nombre, f.url)) && (
              <p className="text-xs text-muted text-center flex-shrink-0 px-3">
                Presiona la imagen para luego hacer zoom
              </p>
            )}

            <div className="flex-1 min-h-0 overflow-hidden bg-surface-container">
              {selFiles.length > 0 ? (
                <div className="h-full overflow-y-auto overflow-x-hidden py-2 space-y-2">
                  {selFiles.map((f, i) => (
                    <div key={`${f.url}-${i}`}>
                      {isImageFile(f.nombre, f.url) ? (
                        <ZoomableImage src={f.url} alt={f.nombre} />
                      ) : canPreviewFile(f.nombre) ? (
                        <div className="rounded overflow-hidden bg-surface-card" style={{ height: '55vh' }}>
                          <FilePreview url={f.url} nombre={f.nombre} fill />
                        </div>
                      ) : IS_NATIVE_APP ? (
                        <AbrirConNativoButton url={f.url} nombre={f.nombre}
                          className="flex items-center gap-2 px-4 py-3 bg-surface-card rounded-card border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors w-full" />
                      ) : (
                        <a
                          href={downloadUrl(f.url, f.nombre)}
                          download={f.nombre}
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-4 py-3 bg-surface-card rounded-card border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors"
                        >
                          <Download size={ICONO.md} className="text-accent flex-shrink-0" />
                          <span className="truncate">{f.nombre}</span>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : selected.sub && !selected.sub.completadoSinArchivo && selected.sub.enlaceURL ? (
                <div className="h-full flex items-center justify-center p-3">
                  <EnlaceEntregado url={selected.sub.enlaceURL} className="w-full" />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-hint text-sm p-3 text-center">
                  {isObservacion
                    ? 'Observación — no requiere entrega.'
                    : isEvaluacion
                      ? 'Evaluación — calificación del intento del alumno.'
                      : selected.sub?.completadoSinArchivo
                        ? 'Completada sin archivo.'
                        : 'Aún no ha entregado esta tarea.'}
                </div>
              )}
            </div>

            <div className="flex-shrink-0 px-3">
              <h4 className="text-[0.9rem] font-semibold text-on-surface truncate">
                {selected.student.orden != null && <span className="text-on-surface">{selected.student.orden}. </span>}
                {studentFullName(selected.student)}
              </h4>
              {selected.sub?.tarde && (
                <p className="text-xs text-amber-600 font-medium mt-0.5 truncate">
                  {formatLateness(selected.sub, selected.student, activity)}
                </p>
              )}
              {selected.sub?.motivoSinEntrega && (
                <p className="text-xs text-muted mt-0.5 italic truncate">
                  Motivo: {selected.sub.motivoSinEntrega}
                </p>
              )}
            </div>

            {/* Anterior/Siguiente. SIEMPRE montado — se deshabilitan cuando no
                hay a dónde navegar. */}
            <div className="space-y-1.5 flex-shrink-0 px-3">
              <div className="flex items-center justify-center gap-2">
                <Button variant="outline-accent" icon={ChevronLeft} className="flex-1"
                  onClick={() => goToOffset(-1)}
                  disabled={navList.length < 2}>
                   Anterior
                </Button>
                <Button className="flex-1"
                  onClick={() => goToOffset(1)}
                  disabled={navList.length < 2}>
                  Siguiente <ChevronRight size={ICONO.md} />
                </Button>
              </div>
            </div>

            {/* En Android la calificación siempre está disponible para
                cualquier entregable, tenga o no entrega y tenga o no
                rúbrica — es el estándar de esta vista (antes solo se
                mostraba con entrega, observación o rúbrica, como en la
                web). */}
            {(selected.sub || isObservacion || hasRubrica || !isEvaluacion) ? (
              <form onSubmit={saveGrade} className="space-y-2 flex-shrink-0 px-3">
                {parcialCerrado && !IS_NATIVE_APP && (
                  <div className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 leading-relaxed">
                    <strong>El Parcial {activity?.parcial} está cerrado.</strong> No se pueden cambiar calificaciones.
                    Para modificarlas, primero <strong>reabre el parcial</strong> desde Calificaciones.
                    Al reabrirlo, las calificaciones asignadas automáticamente volverán a como estaban antes de cerrar.
                  </div>
                )}

                {/* Rúbrica — se abre hacia ARRIBA del botón (ver ventana flotante más abajo).
                    Sin rúbrica, pedido explícito: ya NO se reserva este
                    espacio (antes quedaba invisible para que la calificación
                    no cambiara de posición) — se omite del todo para que la
                    entrega (arriba, flex-1) gane ese alto.
                    En la app nativa el overlay es solo de consulta: se ocultan
                    rúbrica, IA y controles de calificación. */}
                {hasRubrica && !IS_NATIVE_APP && (() => {
                  const totalR = totalRubrica(activity.rubrica, rubricEval)
                  const faltan = activity.rubrica.criterios.filter((_, i) => rubricEval?.[i] == null).length
                  return (
                    <button
                      type="button"
                      ref={rubricaBtnRef}
                      onClick={() => {
                        const rect = rubricaBtnRef.current?.getBoundingClientRect()
                        if (rect) setRubricaWinBottom(Math.round(window.innerHeight - rect.top + 6))
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
                {puedeCalificarConIA && !IS_NATIVE_APP && (
                  <Button variant="outline-accent" fullWidth icon={WandSparkles} iconEffect="varita"
                    onClick={() => abrirCalificarIA()}>
                    
                    {labelCalificarConIA}
                  </Button>
                )}

                {/* Calificación grande — sin la etiqueta de arriba (le cede
                    ese espacio a la entrega). Vacía ("—") mientras no hay
                    calificación; +/- desde vacío saltan a máximo/mitad (ver
                    stepCalif), luego suben/bajan de 0.5 en 0.5. Anular/
                    Modificar fecha son íconos bien separados (divisor +
                    espacio) que abren ventanas flotantes — nunca empujan
                    este contenido. Todos/Por calificar van a la izquierda
                    de todo esto (ya no en medio de Anterior/Siguiente),
                    aprovechando el espacio que sobraba ahí. */}
                <div>
                  {/* Fila de 3 zonas (izquierda fija / centro flexible /
                      derecha fija) en vez de un solo flex centrado — así
                      las columnas de los extremos pueden "sangrar" hasta el
                      borde real de la pantalla (-ml-3/-mr-3 cancelan el
                      padding del contenedor) sin que el cálculo de centrado
                      del medio los jale de vuelta hacia adentro. */}
                  <div className="flex items-center gap-2">
                    {/* Todos/Por calificar "abrazan" el borde izquierdo de
                        la pantalla como etiquetas — sin curva del lado
                        izquierdo, texto alineado a la izquierda. Mismo alto
                        (h-9) y mismo gap-2 que la columna de Nueva fecha/
                        Anular para que Todos quede a la misma altura que
                        Nueva fecha, y Por calificar a la misma altura que
                        Anular entrega. */}
                    <div className="flex flex-col gap-2 flex-shrink-0 -ml-3">
                      <button
                        type="button"
                        onClick={() => changeFilterInView('todos')}
                        className={`h-9 min-w-[104px] pl-3 pr-2 ml-1 rounded-full border text-left text-[11px] font-semibold whitespace-nowrap transition-colors flex items-center ${
                          filter === 'todos' ? 'border-accent bg-accent-light text-accent' : 'border-outline-variant text-muted hover:bg-[var(--accent-medium)]'
                        }`}
                      >
                        Todos ({students.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => changeFilterInView('entregado')}
                        className={`h-9 min-w-[104px] pl-3 pr-2 ml-1 rounded-full border text-left text-[11px] font-semibold whitespace-nowrap transition-colors flex items-center ${
                          filter === 'entregado' ? 'border-accent bg-accent-light text-accent' : 'border-outline-variant text-muted hover:bg-[var(--accent-medium)]'
                        }`}
                      >
                        Por calificar ({counts.entregado})
                      </button>
                    </div>

                    {!IS_NATIVE_APP && (
                    <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => stepCalif(-0.5)}
                        disabled={parcialCerrado}
                        aria-label="Restar medio punto"
                        className="w-11 h-11 flex-shrink-0 rounded-full border border-accent text-accent text-2xl font-bold flex items-center justify-center hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-40"
                      >
                        −
                      </button>
                      <input
                        id="act-calificacion-native"
                        type="number"
                        value={gradeForm.calificacion}
                        onChange={onCalifChange}
                        required
                        min="0"
                        max={activity?.maxCalif}
                        step="0.5"
                        disabled={parcialCerrado}
                        className="w-24 py-1 text-[2.7rem] font-bold bg-transparent border-b-2 border-accent focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      <button
                        type="button"
                        onClick={() => stepCalif(0.5)}
                        disabled={parcialCerrado}
                        aria-label="Sumar medio punto"
                        className="w-11 h-11 flex-shrink-0 rounded-full bg-accent text-white text-2xl font-bold flex items-center justify-center hover:bg-accent-hover transition-colors disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                    )}

                    {!isObservacion && !isEvaluacion && (
                      <>
                        <div className="w-px h-9 bg-outline-variant flex-shrink-0" />
                        {/* Nueva fecha/Anular hacen lo mismo pero del lado
                            derecho — sin curva a la derecha, hasta el borde
                            real de la pantalla. */}
                        <div className="flex flex-col gap-2 flex-shrink-0 -mr-3">
                          <button
                            type="button"
                            onClick={() => setExtendMode(true)}
                            disabled={parcialCerrado || prorrogaBloqueada}
                            aria-label="Modificar fecha de entrega"
                            data-tooltip={prorrogaBloqueada ? MENSAJE_PRORROGA_CON_ENTREGA : 'Modificar fecha de entrega'}
                            className="h-9 pl-2 pr-3 rounded-full border border-outline-variant text-muted hover:text-accent hover:border-accent flex items-center justify-center transition-colors disabled:opacity-40"
                          >
                            <CalendarDays size={ICONO.sm} />
                          </button>
                          {selected.sub && (
                            <button
                              type="button"
                              onClick={() => setAnnulMode(true)}
                              disabled={parcialCerrado}
                              aria-label="Anular la entrega"
                              data-tooltip="Anular la entrega"
                              className="h-9 pl-2 pr-3 rounded-full border border-outline-variant text-muted hover:text-red-600 hover:border-red-300 flex items-center justify-center transition-colors disabled:opacity-40"
                            >
                              <Trash2 size={ICONO.sm} />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {!canCreate && !IS_NATIVE_APP && (
                  <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2 leading-relaxed">
                    Necesitas Créditos IA para registrar calificaciones nuevas — toda la información de este estudiante sigue disponible.
                  </p>
                )}

                {!IS_NATIVE_APP && !parcialCerrado && (
                  <button
                    type="submit"
                    disabled={saving || !canCreate || !isDirty()}
                    className="h-10 w-full bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {saving ? <Spinner size="sm" /> : <Star size={ICONO.md} />}
                    {saving ? 'Guardando…' : 'Guardar calificación'}
                  </button>
                )}
              </form>
            ) : (
              <p className="text-sm text-hint text-center py-2 flex-shrink-0 px-3">
                El estudiante aún no ha entregado esta tarea.
              </p>
            )}

            {selected.sub?.historial?.length > 0 && (
              <div className="flex-shrink-0 px-3">
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
                          ? IS_NATIVE_APP
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

            <div className="h-1 safe-bottom flex-shrink-0" />
          </div>
        </div>
        </>,
        document.body,
      )}
    </>
  )
}
