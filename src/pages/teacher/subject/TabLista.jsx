// Parte del render de SubjectPage.jsx (fase 5 de PLAN_NORMALIZACION_UI:
// dividir sin cambio visual). Recibe lo que usa del componente principal por
// el contexto Asignatura.
import { ArrowUpDown, ChevronRight, Download, KeyRound, Pencil, Upload, UserPlus } from 'lucide-react'
import { Button, Checkbox, SkeletonList } from '../../../components/ui'
import { EstadoFiltroHeader } from './piezas'
import { ICONO } from '../../../config/iconos'
import { IS_NATIVE_APP, PUEDE_AUTOFOCUS } from '../../../utils/platform'
import InfoDisclosure from '../../../components/ui/InfoDisclosure'
import SearchInput from '../../../components/SearchInput'
import Spinner from '../../../components/Spinner'
import { downloadStudentTemplate } from '../../../utils/excel'
import { studentFullName } from '../../../utils/studentSearch'
import { useAsignatura } from './contexto'

export default function TabLista() {
  const {
    activeTab,
    atencionPestanas,
    estadoFiltroOpen,
    filteredAlumnos,
    filtroActivacion,
    groupStudents,
    groupStudentsLoaded,
    handleExcelFileSelected,
    openEditStudent,
    parsingExcel,
    searchAlumnos,
    setEstadoFiltroOpen,
    setFiltroActivacion,
    setSearchAlumnos,
    setShowAddStudent,
    setShowCredentialsModal,
    sortStudentsAlphabetically,
    subject,
    telefonoWeb,
    toggleNotificarActivacion,
  } = useAsignatura()
  return (
    <>
      {activeTab === 'alumnos' && (
        <div className="px-4 py-2 space-y-2">
          {/* En la App esta pestaña se simplifica a propósito (pedido
              explícito): solo buscar y ver/editar — sin plantilla de Excel,
              sin PDF de códigos, sin el interruptor de notificación, y sin
              poder agregar un estudiante nuevo. Todo eso sigue disponible en
              la web. */}
          {!IS_NATIVE_APP && <>
          {/* Agregar alumnos — compact 3-step strip: template → upload → activation codes.
              Each step shows just a number + icon + short label; the full instructions
              live in the title tooltip instead of wrapping across two lines like before.
              Teléfono (web): sin descargas, no hay paso 1 (plantilla), así que el
              flujo completo de la plantilla no se muestra. */}
          {!telefonoWeb.telefono && (
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Agregar estudiantes</p>
            {/* Prominent 3-step cards — everything starts here. No overflow-hidden
                wrapper so the tooltips render above without clipping. */}
            <div className="flex flex-col sm:flex-row sm:items-stretch gap-2">
              {/* Teléfono (web): sin la plantilla Excel ni el PDF de códigos
                  (descargas de archivos generados). */}
              {!telefonoWeb.telefono && (<>
              <button
                type="button"
                onClick={downloadStudentTemplate}
                data-tooltip="Descargar plantilla en Excel para pegar datos de estudiantes"
                data-tooltip-nowrap=""
                className="flex-1 min-w-0 flex items-center gap-3 py-3 px-4 rounded-card border border-accent-soft bg-surface-card shadow-card hover:bg-[var(--accent-light)] transition-colors text-left"
              >
                <span className="w-8 h-8 rounded-full bg-accent text-white text-sm font-bold flex items-center justify-center flex-shrink-0">1</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-accent flex items-center gap-1.5"><Download size={ICONO.sm} className="flex-shrink-0" /> Plantilla Excel</p>
                  <p className="text-xs text-muted truncate">Descárgala y pega los datos</p>
                </div>
              </button>
              <ChevronRight size={ICONO.md} className="hidden sm:block text-hint flex-shrink-0 self-center" />
              </>)}
              <label
                data-tooltip="Sube exactamente el archivo de nuestra plantilla de Excel del paso 1"
                data-tooltip-nowrap=""
                className="flex-1 min-w-0 flex items-center gap-3 py-3 px-4 rounded-card border border-accent-soft bg-surface-card shadow-card hover:bg-[var(--accent-light)] transition-colors cursor-pointer"
              >
                <span className="w-8 h-8 rounded-full bg-accent text-white text-sm font-bold flex items-center justify-center flex-shrink-0">2</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-accent flex items-center gap-1.5">{parsingExcel ? <Spinner size="sm" /> : <Upload size={ICONO.sm} className="flex-shrink-0" />} Subir plantilla</p>
                  <p className="text-xs text-muted truncate">El archivo del paso 1, ya llenado</p>
                </div>
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelFileSelected} disabled={parsingExcel} />
              </label>
              {!telefonoWeb.telefono && (<>
              <ChevronRight size={ICONO.md} className="hidden sm:block text-hint flex-shrink-0 self-center" />
              <button
                type="button"
                onClick={() => setShowCredentialsModal(true)}
                className="flex-1 min-w-0 flex items-center gap-3 py-3 px-4 rounded-card border border-accent-soft bg-surface-card shadow-card hover:bg-[var(--accent-light)] transition-colors text-left"
              >
                <span className="w-8 h-8 rounded-full bg-accent text-white text-sm font-bold flex items-center justify-center flex-shrink-0">3</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-accent flex items-center gap-1.5"><KeyRound size={ICONO.sm} className="flex-shrink-0" /> Generar PDF con códigos</p>
                  <p className="text-xs text-muted truncate">Accesos para tus estudiantes</p>
                </div>
              </button>
              </>)}
            </div>
          </div>
          )}

          {/* Por asignatura (no un ajuste global de Ajustes > Notificaciones):
              la Cloud Function lee este campo directo del documento de la
              asignatura. El push solo llega al celular donde esté instalada
              la app — se puede activar desde aquí o desde ahí. */}
          <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-card border border-outline-variant">
            <Checkbox
              id="notificar-activacion"
              checked={subject?.notificarActivacion !== false}
              onChange={toggleNotificarActivacion}
            />
            <div className="flex-1 min-w-0">
              <label htmlFor="notificar-activacion" className="text-sm font-medium text-on-surface cursor-pointer block">
                Notificarme cuando un estudiante se active a esta asignatura
              </label>
              {/* La explicación se pliega detrás de "¿Qué es esto?" — mismo
                  patrón que el resto de las pantallas: quien ya la leyó no
                  tiene que volver a pasar por ella. */}
              <InfoDisclosure className="mt-0.5">
                <span className="text-muted text-sm block">Aviso para el celular donde tengas instalada la app Evalúa Fácil, cada vez que un estudiante se active, según lo que tengas activado en Notificaciones</span>
              </InfoDisclosure>
            </div>
          </div>
          </>}

          {/* Ordenar alfabéticamente — visible en web y App.
              Botón con borde y color de acento, no el texto gris de 12 px de
              antes: era una acción real escondida detrás de la apariencia de
              una nota al pie, y nadie la encontraba. */}
          <div className="flex justify-end pt-1">
            <Button variant="outline-accent" icon={ArrowUpDown} className="h-control-sm"
              onClick={sortStudentsAlphabetically}
              disabled={groupStudents.length < 2}
              data-tooltip="Ordena la lista por apellido y nombre">
              
              Ordenar alfabéticamente
            </Button>
          </div>

          {/* 3 — Buscar alumno + agregar manualmente */}
          {/* overflow-hidden en la fila: min-w-0 (abajo) ya corrige el ancho
              VISUAL, pero el navegador seguía reportando un scrollWidth
              "fantasma" mayor al contenido realmente visible (quirk conocido
              de flex-basis con inputs) — eso solo, sin verse nada distinto,
              bastaba para forzar scroll horizontal en toda la página. */}
          {/* p-2 -m-2: el overflow-hidden recortaba el anillo de enfoque (2px) y el halo del botón rojo (4px) por
              fuera del campo); este relleno le deja sitio sin mover el diseño. */}
          <div className="flex gap-2 overflow-hidden p-2 -m-2">
            {/* min-w-0: sin esto, un flex item se niega a encoger por debajo
                del ancho mínimo intrínseco de su <input> hijo (el gotcha
                clásico de flexbox) — en móvil desbordaba esta fila y con
                ella toda la página, aunque el input ya tenía w-full. */}
            <div className="flex-1 min-w-0">
              <SearchInput
                value={searchAlumnos}
                onChange={setSearchAlumnos}
                etiqueta="Buscar por nombre o por número de lista…"
                autoFocus={PUEDE_AUTOFOCUS}
              />
            </div>
            {/* data-tooltip-follow, no data-tooltip: esta fila lleva overflow-hidden
                (arriba) para tapar un ancho fantasma del input, y ese overflow
                recortaba el tooltip normal — se dibuja ARRIBA del botón, fuera de
                la caja de la fila. El que sigue al cursor se pinta en el body,
                fuera de cualquier contenedor, así que nunca lo recorta nada. */}
            <button type="button"
              onClick={() => setShowAddStudent(true)}
              aria-label="Agregar manualmente"
              data-tooltip-follow={atencionPestanas.alumnos ? 'Agrega tu primer estudiante' : 'Agregar manualmente'}
              className={atencionPestanas.alumnos
                ? 'group size-control inline-flex items-center justify-center bg-red-600 text-white rounded-full animate-atencion motion-reduce:animate-none hover:bg-red-700 transition'
                : 'group size-control inline-flex items-center justify-center bg-accent text-white rounded-full hover:bg-accent-hover transition active:scale-[0.94]'}
            >
              <UserPlus size={ICONO.md} />
            </button>
          </div>
          {/* En la App no hay botón de editar por renglón — se toca el
              renglón completo (ver más abajo), así que se avisa aquí. */}
          {IS_NATIVE_APP && (
            <p className="text-xs text-muted text-center">Presiona para editar</p>
          )}

          {/* Student list */}
          {!groupStudentsLoaded ? (
            <SkeletonList rows={6} className="py-4" />
          ) : filteredAlumnos.length === 0 ? (
            <div className="text-center py-10 text-hint text-sm">
              {searchAlumnos || filtroActivacion !== 'todos' ? 'Sin resultados' : 'No hay estudiantes en esta asignatura'}
            </div>
          ) : (
            <div className="bg-surface-card rounded-card overflow-y-auto max-h-[65vh] shadow-card">
              {/* Teléfono (web): encabezado y renglón compactos — la versión de
                  escritorio tiene anchos fijos (foto 86px, código 158px,
                  estado 86px) que no caben en 310-362px: el nombre colapsaba a
                  0px y Editar quedaba fuera de la pantalla. Escritorio, tablet
                  y App siguen con su versión de siempre. */}
              {telefonoWeb.telefono ? (
                <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-surface-container">
                  <p className="flex-1 min-w-0 text-xs font-semibold text-muted uppercase tracking-wide truncate">Estudiante</p>
                  <EstadoFiltroHeader
                    value={filtroActivacion}
                    onChange={setFiltroActivacion}
                    open={estadoFiltroOpen}
                    setOpen={setEstadoFiltroOpen}
                    total={groupStudents.length}
                    activos={groupStudents.filter((s) => s.activado).length}
                  />
                </div>
              ) : (
              <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-surface-container">
                {!IS_NATIVE_APP && <span className="w-24 flex-shrink-0" />}
                {!IS_NATIVE_APP && <span className="w-5 flex-shrink-0" />}
                {!IS_NATIVE_APP && (
                  <p className="flex-1 min-w-0 text-xs font-semibold text-muted uppercase tracking-wide">Nombre del estudiante</p>
                )}
                {IS_NATIVE_APP && (
                  <p className="w-7 flex-shrink-0 text-[9px] font-semibold text-muted uppercase tracking-wide">No.</p>
                )}
                <p className={`font-semibold text-muted uppercase tracking-wide ${IS_NATIVE_APP ? 'flex-1 text-[9px]' : 'flex-shrink-0 w-44 text-xs'}`}>Código</p>
                <EstadoFiltroHeader
                  value={filtroActivacion}
                  onChange={setFiltroActivacion}
                  open={estadoFiltroOpen}
                  setOpen={setEstadoFiltroOpen}
                  total={groupStudents.length}
                  activos={groupStudents.filter((s) => s.activado).length}
                />
                {!IS_NATIVE_APP && <span className="w-9 flex-shrink-0" />}
              </div>
              )}
              {filteredAlumnos.map((s, i) => telefonoWeb.telefono ? (
                // Teléfono (web): [foto 32px] [No.] [nombre hasta 2 líneas /
                // código · salió · estado] [Editar 36px] — todo dentro del ancho.
                <div
                  key={s.id}
                  className={`flex items-center gap-2 px-3 py-1 leading-tight transition-colors duration-estandar hover:bg-[var(--accent-tint-strong)] ${i > 0 ? 'border-t border-outline-variant' : ''}`}
                >
                  <div className="w-9 h-9 rounded-full bg-accent-light overflow-hidden flex items-center justify-center flex-shrink-0">
                    {s.photoURL ? (
                      <img src={s.photoURL} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-bold text-accent">{(s.nombre || '?').charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <span className="text-sm text-accent flex-shrink-0 whitespace-nowrap">{s.orden}.</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-on-surface break-words">{studentFullName(s)}</p>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
                      <span className="font-mono text-accent font-semibold text-xs break-all">{s.username}</span>
                      {s.ocultaPorAlumno && (
                        <span
                          className="leading-none bg-slate-200 text-muted rounded-full text-[11px] px-1.5 py-0.5"
                          data-tooltip={`Salió de la asignatura${s.ocultaPorAlumnoAt?.toDate ? ` el ${s.ocultaPorAlumnoAt.toDate().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`}
                        >
                          salió
                        </span>
                      )}
                      {s.activado ? (
                        <span className="leading-none bg-emerald-100 text-emerald-700 rounded-full text-[11px] px-1.5 py-0.5">activo</span>
                      ) : (
                        <span className="leading-none bg-amber-100 text-amber-700 rounded-full text-[11px] px-1.5 py-0.5">sin activar</span>
                      )}
                    </div>
                  </div>
                  <button type="button"
                    onClick={() => openEditStudent(s)}
                    className="w-10 h-10 flex-shrink-0 flex items-center justify-center text-hint hover:text-accent hover:bg-[var(--accent-medium)] rounded-full transition-colors duration-estandar"
                    aria-label="Editar estudiante"
                  >
                    <Pencil size={ICONO.sm} />
                  </button>
                </div>
              ) : (
                <div
                  key={s.id}
                  onClick={IS_NATIVE_APP ? () => openEditStudent(s) : undefined}
                  className={`flex items-center gap-2 px-3 py-0.5 leading-tight transition-colors duration-estandar hover:bg-[var(--accent-tint-strong)] ${i > 0 ? 'border-t border-outline-variant' : ''} ${IS_NATIVE_APP ? 'cursor-pointer' : ''}`}
                >
                  {!IS_NATIVE_APP && (
                    <div className="w-24 h-24 rounded-full bg-accent-light overflow-hidden flex items-center justify-center flex-shrink-0">
                      {s.photoURL ? (
                        <img src={s.photoURL} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm font-bold text-accent">{(s.nombre || '?').charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                  )}
                  {!IS_NATIVE_APP && (
                    <span className="text-sm text-accent flex-shrink-0 whitespace-nowrap">{s.orden}.&nbsp;</span>
                  )}
                  {!IS_NATIVE_APP && (
                    <p className="flex-1 min-w-0 text-sm font-medium text-on-surface truncate">
                      {studentFullName(s)}
                    </p>
                  )}
                  {IS_NATIVE_APP && (
                    <span className="w-7 flex-shrink-0 text-[11px] text-accent font-semibold">{s.orden}</span>
                  )}
                  <span className={`font-mono text-accent font-semibold truncate ${IS_NATIVE_APP ? 'flex-1 text-[10px]' : 'flex-shrink-0 w-44 text-xs'}`}>{s.username}</span>
                  {s.ocultaPorAlumno && (
                    // El alumno "salió" (se lo ocultó de sus propias listas) —
                    // no está borrado ni afecta calificaciones/entregas, pero
                    // el docente debe poder notarlo de un vistazo. Pedido
                    // explícito, con la fecha en el tooltip.
                    <span
                      className={`leading-none bg-slate-200 text-muted rounded-full flex-shrink-0 ${IS_NATIVE_APP ? 'text-[9px] px-1 py-0.5' : 'text-[11px] px-1.5 py-0.5'}`}
                      data-tooltip={`Salió de la asignatura${s.ocultaPorAlumnoAt?.toDate ? ` el ${s.ocultaPorAlumnoAt.toDate().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`}
                    >
                      salió
                    </span>
                  )}
                  <span className={`flex-shrink-0 flex items-center ${IS_NATIVE_APP ? 'w-14' : 'w-24'}`}>
                    {s.activado ? (
                      <span className={`leading-none bg-emerald-100 text-emerald-700 rounded-full ${IS_NATIVE_APP ? 'text-[9px] px-1 py-0.5' : 'text-[11px] px-1.5 py-0.5'}`}>activo</span>
                    ) : (
                      <span className={`leading-none bg-amber-100 text-amber-700 rounded-full ${IS_NATIVE_APP ? 'text-[9px] px-1 py-0.5' : 'text-[11px] px-1.5 py-0.5'}`}>sin activar</span>
                    )}
                  </span>
                  {!IS_NATIVE_APP && (
                    <button type="button"
                      onClick={() => openEditStudent(s)}
                      className="size-control flex-shrink-0 flex items-center justify-center text-hint hover:text-accent hover:bg-[var(--accent-medium)] rounded-full transition-colors duration-estandar"
                      aria-label="Editar estudiante"
                      data-tooltip="Editar estudiante"
                    >
                      <Pencil size={ICONO.sm} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
