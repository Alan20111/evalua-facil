// Parte del render de SubjectPage.jsx (fase 5 de PLAN_NORMALIZACION_UI:
// dividir sin cambio visual). Recibe lo que usa del componente principal por
// el contexto Asignatura.
import AttachmentList from '../../../components/AttachmentList'
import { BookOpen, CheckCircle, ChevronDown, ChevronUp, ClipboardCheck, Clock, Copy, Eye, EyeOff, FileCheck2, FileText, GraduationCap, GripVertical, ListChecks, MoreVertical, Paperclip, Pencil, Plus, Sparkles, Timer, Trash2 } from 'lucide-react'
import FiltroSoloCalificables from '../../../components/FiltroSoloCalificables'
import { Fragment } from 'react'
import { ICONO } from '../../../config/iconos'
import { IS_NATIVE_APP } from '../../../utils/platform'
import { IconButton } from '../../../components/ui'
import { activityVisibilityState, formatDeadline, formatPublishAt, isDraftActivity, sinCalificacion } from '../../../utils/activityVisibility'
import { buildUnifiedParcial } from './utilidades'
import { etiquetaJuego } from '../../../utils/copiaActividad'
import { filasVisiblesParcial } from '../../../utils/filtroCalificables'
import { formatShortDate } from '../../../utils/dateRange'
import { richTextContentClass, sanitizeHtml } from '../../../utils/sanitizeHtml'
import { useAsignatura } from './contexto'

export default function TabActividades() {
  const {
    PARCIALES,
    activeTab,
    activities,
    activityLabelById,
    canCreate,
    dragDraftId,
    dragMatId,
    dropZoneActive,
    expandedMaterialId,
    handleDraftDrop,
    handleMaterialDrop,
    hideActivity,
    hideMaterial,
    materials,
    navigate,
    openAdd,
    openAddMaterial,
    openEdit,
    openEditMaterial,
    openImport,
    openParcial,
    parcialesVistos,
    setActivityMenu,
    setDeleteMaterialConfirm,
    setDragDraftId,
    setDragMatId,
    setDropZoneActive,
    setExpandedMaterialId,
    setOpenParcial,
    setPublishDraftConfirm,
    setSoloCalificables,
    showActivityNow,
    showMaterialNow,
    soloCalificables,
    subject,
    submissionCounts,
    telefonoWeb,
    toggleParcialVisibility,
    totalStudents,
  } = useAsignatura()
  return (
    <>
      {activeTab === 'actividades' && (
          <div data-esq="subj-doc-parciales" className="px-4 py-2 space-y-2 cascada">
            {PARCIALES.map((p) => {
              const acts = activities.filter((a) => a.parcial === p)
              const numeradas = acts.filter((a) => activityLabelById[a.id]).length
              // Filtro "solo actividades que se califican": solo presentación (la
              // lista completa sigue siendo la base de numeración, orden y arrastre).
              // En la app nativa no existe. Para el docente un borrador SÍ cuenta
              // (se calificará al publicarse): basta con no ser sinCalificacion.
              const filtrando = !IS_NATIVE_APP && !!soloCalificables[p]
              const totalMostrado = filtrando ? acts.filter((a) => !sinCalificacion(a)).length : numeradas
              const mats = materials.filter((m) => m.parcial === p)
              const isOpen = openParcial === p
              const parcialOculto = (subject?.parcialesOcultos || []).includes(p)
              return (
                // Open parcial gets the same accent container treatment as the
                // Preguntas/Configuración sections — it's obvious you're inside it
                <div data-esq="subj-doc-parcial" key={p} className={`bg-surface-card rounded-card overflow-hidden shadow-card ${isOpen ? 'border border-accent-soft' : ''}`}>
                  <div data-esq="subj-doc-parcial-cabecera-fondo" className={isOpen ? 'bg-accent-light border-b border-accent-soft' : ''}>
                  <div className="w-full flex items-center gap-1">
                    <button data-esq="subj-doc-parcial-cabecera" type="button" onClick={() => setOpenParcial(isOpen ? 0 : p)}
                      className="flex-1 min-w-0 px-4 py-2 flex items-center gap-2 hover:bg-[var(--accent-medium)] transition-colors text-left">
                      <div data-esq="subj-doc-parcial-icono" className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${parcialOculto ? 'bg-surface-container' : 'bg-accent-light'}`}>
                        <span className={`font-bold text-sm ${parcialOculto ? 'text-hint' : 'text-accent'}`}>{p}</span>
                      </div>
                      <div className="text-left min-w-0">
                        <p className={`font-semibold text-base leading-tight truncate ${parcialOculto ? 'text-hint' : 'text-on-surface'}`}>
                          Parcial {p}{parcialOculto && <span className="text-xs font-normal text-hint"> · oculto a estudiantes</span>}
                          {/* Fechas del parcial solo en la web de escritorio. */}
                          {!IS_NATIVE_APP && !telefonoWeb.telefono && subject?.parcialesFechas?.[p - 1] && (
                            <span className="text-xs font-medium text-hint tabular-nums"> ({formatShortDate(subject.parcialesFechas[p - 1].inicio)} – {formatShortDate(subject.parcialesFechas[p - 1].fin)})</span>
                          )}
                        </p>
                        {/* Solo cuenta las que llevan número (1.1., 1.2.…): misma
                            regla que activityLabelById, para que nunca se desalineen.
                            Borradores y "sin calificación" siguen en la lista, no aquí. */}
                        <p className="text-sm text-muted leading-tight -mt-0.5">{totalMostrado} actividad{totalMostrado !== 1 ? 'es' : ''}</p>
                      </div>
                    </button>
                    <button type="button"
                      onClick={() => toggleParcialVisibility(p)}
                      aria-label={parcialOculto ? 'Mostrar este parcial a los estudiantes' : 'Ocultar este parcial a los estudiantes'}
                      data-tooltip={parcialOculto ? 'Mostrar este parcial a los estudiantes' : 'Ocultar este parcial a los estudiantes'}
                      data-tooltip-pos="left"
                      className="size-control inline-flex items-center justify-center text-hint hover:text-accent hover:bg-[var(--accent-medium)] rounded-full transition-colors flex-shrink-0"
                    >
                      {parcialOculto ? <EyeOff size={ICONO.md} /> : <Eye size={ICONO.md} />}
                    </button>
                    <button type="button" onClick={() => setOpenParcial(isOpen ? 0 : p)} className="size-control inline-flex items-center justify-center rounded-full mr-2 flex-shrink-0">
                      {isOpen ? <ChevronUp size={ICONO.md} className="text-hint" /> : <ChevronDown size={ICONO.md} className="text-hint" />}
                    </button>
                  </div>
                  {!IS_NATIVE_APP && (
                    <div data-esq="subj-doc-parcial-filtro" className="px-4 pb-2 pl-[4.5rem] -mt-1">
                      <FiltroSoloCalificables
                        id={`solo-calificables-${p}`}
                        checked={!!soloCalificables[p]}
                        onChange={(v) => setSoloCalificables((prev) => ({ ...prev, [p]: v }))}
                      />
                    </div>
                  )}
                  </div>

                  {/* Abrir/cerrar animado: la fila del grid pasa de 0fr a 1fr (la
                      altura real del contenido, sin medirla) en 350ms con la curva
                      firma, y el contenido se desvanece a la par. Cerrado queda
                      `inert` (ni foco ni lector de pantalla). Se monta la primera
                      vez que se abre y después solo se pliega. */}
                  {(isOpen || parcialesVistos.current.has(p)) && (
                  <div inert={!isOpen} className={`grid transition-[grid-template-rows] duration-lenta ease-firma motion-reduce:transition-none ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="min-h-0 overflow-hidden">
                    <div data-esq="subj-doc-parcial-cuerpo" className={`border-t border-outline-variant pr-4 py-2 transition-opacity duration-estandar ease-firma ${isOpen ? 'opacity-100' : 'opacity-0'}`}>
                      <div data-esq="subj-doc-parcial-lista" className="ml-3 pl-3 border-l-2 border-accent-soft space-y-1.5">
                      {(() => {
                        const unified = buildUnifiedParcial(acts, mats)
                        // Con el filtro solo se OMITEN filas al pintar; cada fila conserva su
                        // índice en la lista completa (`idx`) y la zona de soltar que le sigue
                        // usa ESE índice, así handleDraftDrop/handleMaterialDrop (que trabajan
                        // sobre la lista completa) guardan la posición correcta. Material y
                        // sinCalificacion se omiten; el borrador no.
                        const visibles = filasVisiblesParcial(unified, filtrando)
                        const isDraggingHere = !IS_NATIVE_APP && (
                          (!!dragMatId && mats.some((m) => m.id === dragMatId)) ||
                          (!!dragDraftId && acts.some((a) => a.id === dragDraftId))
                        )
                        // Drop zone: always in the DOM to avoid DOM mutations during dragstart
                        // (inserting nodes during onDragStart cancels the HTML5 drag operation).
                        // Visibility and interactivity are controlled via CSS classes only.
                        // isDragging=true → h-6 hitbox + events active; false → h-2 spacer, no events.
                        const dropZone = (vizIdx, isDragging) => {
                          const isActive = isDragging && dropZoneActive?.parcial === p && dropZoneActive?.idx === vizIdx
                          return (
                            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                            <div
                              key={`dz-${p}-${vizIdx}`}
                              className={`w-full rounded transition-[height,background-color] duration-rapida ${
                                !isDragging
                                  ? 'h-2 pointer-events-none'
                                  : isActive
                                    ? 'h-6 border-t-2 border-accent bg-[var(--accent-tint)] pointer-events-auto'
                                    : 'h-6 pointer-events-auto'
                              }`}
                              onDragOver={isDragging ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropZoneActive({ parcial: p, idx: vizIdx }) } : undefined}
                              onDragLeave={isDragging ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropZoneActive(null) } : undefined}
                              onDrop={isDragging ? (e) => {
                                e.preventDefault(); setDropZoneActive(null)
                                if (dragDraftId) handleDraftDrop(dragDraftId, p, vizIdx).catch(() => {})
                                else handleMaterialDrop(dragMatId, p, vizIdx).catch(() => {})
                              } : undefined}
                            />
                          )
                        }
                        return (
                          <>
                            {visibles.length === 0 && (
                              <p className="text-hint text-sm text-center py-2">{filtrando ? 'Sin actividades que se califiquen' : 'Sin actividades'}</p>
                            )}
                            {dropZone(0, isDraggingHere)}
                            {visibles.map(({ item, idx }) => {
                              const vizIdx = idx + 1
                              if (item.type === 'activity') {
                                const a = item.item
                                const counts = submissionCounts[a.id] || {}
                                const visState = activityVisibilityState(a, parcialOculto)
                                const isHidden = visState !== 'visible'
                                const ActIcon = a.categoria === 'examen' ? GraduationCap
                                  : a.categoria === 'cuestionario' ? ListChecks
                                  : a.categoria === 'observacion' ? ClipboardCheck
                                  : a.categoria === 'juego' ? Sparkles
                                  : FileText
                                const esJuego = a.categoria === 'juego'
                                // Solo los BORRADORES se arrastran (mismo arrastre HTML5 que los
                                // materiales, solo web). Las publicadas se mueven con Subir/Bajar.
                                const arrastrable = !IS_NATIVE_APP && isDraftActivity(a)
                                return (
                                  <Fragment key={a.id}>
                                    {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
                                    <div
                                      draggable={arrastrable || undefined}
                                      onDragStart={arrastrable ? (e) => { e.dataTransfer.effectAllowed = 'move'; setDragDraftId(a.id) } : undefined}
                                      onDragEnd={arrastrable ? () => { setDragDraftId(null); setDropZoneActive(null) } : undefined}
                                      className={`flex items-center gap-1 w-full rounded border bg-surface-card transition-colors duration-estandar ${isHidden ? 'border-outline-variant opacity-60' : 'border-outline-variant hover:border-accent hover:bg-[var(--accent-tint)]'}${dragDraftId === a.id ? ' opacity-40' : ''}`}>
                                      {arrastrable && (
                                        <div
                                          className="pl-2 py-2 text-hint hover:text-slate-500 cursor-grab active:cursor-grabbing flex-shrink-0"
                                          data-tooltip="Arrastrar para reordenar"
                                          data-tooltip-pos="right"
                                        >
                                          <GripVertical size={ICONO.sm} />
                                        </div>
                                      )}
                                      <button type="button"
                                        onClick={() => {
                                          if (isDraftActivity(a) && !esJuego) {
                                            openEdit(a, activityLabelById[a.id])
                                          } else {
                                            navigate(`/activity/${a.id}`)
                                          }
                                        }}
                                        data-tooltip-follow={isDraftActivity(a) && !esJuego ? 'Editar borrador' : a.tipo === 'evaluacion' ? 'Evaluación' : 'Evaluar'}
                                        className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 text-left">
                                        <ActIcon size={ICONO.md} className={`flex-shrink-0 ${isHidden ? 'text-hint' : a.categoria === 'examen' ? 'text-accent' : a.categoria === 'cuestionario' ? 'text-emerald-600' : a.categoria === 'observacion' ? 'text-amber-600' : a.categoria === 'juego' ? 'text-accent' : 'text-hint'}`} />
                                        <div className="flex-1 min-w-0">
                                          <p className={`text-base font-medium leading-tight truncate ${isHidden ? 'text-hint' : 'text-on-surface'}`}>
                                            {activityLabelById[a.id] && <span className="text-accent font-semibold">{activityLabelById[a.id]} </span>}
                                            {esJuego ? (a.nombre || etiquetaJuego(a)) : a.nombre}
                                            <span className={`text-xs font-normal ${isHidden ? 'text-hint' : 'text-hint'}`}>
                                              {' '}({a.categoria === 'examen' ? 'Examen' : a.categoria === 'cuestionario' ? 'Cuestionario' : a.categoria === 'observacion' ? 'Observación' : a.categoria === 'juego' ? etiquetaJuego(a) : 'Entregable'})
                                            </span>
                                            {sinCalificacion(a) && (
                                              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-surface-container text-muted text-[10px] font-semibold align-middle">
                                                Sin calificación
                                              </span>
                                            )}
                                          </p>
                                          {/* Teléfono (web): sin fechas ni contadores de entregas — tarjeta
                                              limpia como en la App (el estado Oculta/Borrador sí se ve). */}
                                          {((!IS_NATIVE_APP && !telefonoWeb.telefono && (a.publishedAt || a.fechaLimite || a.publishAt)) || visState === 'hidden') && (
                                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                              {!IS_NATIVE_APP && !telefonoWeb.telefono && a.publishedAt && (
                                                <span data-tooltip="Publicado" className="text-xs text-emerald-600 flex items-center gap-0.5">
                                                  <Clock size={ICONO.xs} /> {formatPublishAt(a.publishedAt)}
                                                </span>
                                              )}
                                              {!IS_NATIVE_APP && !telefonoWeb.telefono && a.publishAt && (
                                                <span data-tooltip="Publicación programada" className="text-xs text-accent flex items-center gap-0.5">
                                                  <Clock size={ICONO.xs} /> {formatPublishAt(a.publishAt)}
                                                </span>
                                              )}
                                              {!IS_NATIVE_APP && !telefonoWeb.telefono && a.fechaLimite && (
                                                <span data-tooltip="Cierre" className="text-xs text-amber-600 flex items-center gap-0.5">
                                                  <Clock size={ICONO.xs} /> {formatDeadline(a.fechaLimite)}
                                                </span>
                                              )}
                                              {visState === 'hidden' && (
                                                <span
                                                  data-tooltip={parcialOculto ? 'La actividad está publicada, pero el Parcial completo está oculto a estudiantes. Muéstralo con el ojo del encabezado del parcial.' : undefined}
                                                  className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${parcialOculto ? 'bg-amber-100 text-amber-700' : 'bg-surface-container text-muted'}`}>
                                                  <EyeOff size={ICONO.xs} /> {parcialOculto ? 'Parcial oculto' : (!a.publishedAt && a.oculta && !a.publishAt) ? 'Borrador' : 'Oculta'}
                                                </span>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                        {!IS_NATIVE_APP && !telefonoWeb.telefono && (
                                          <div className="flex items-center gap-1 flex-shrink-0">
                                            <span
                                              data-tooltip="Entregados"
                                              className="text-xs bg-slate-100 text-muted px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                              <FileCheck2 size={ICONO.xs} /> {counts.delivered}/{totalStudents}
                                            </span>
                                            <span
                                              data-tooltip="Calificados"
                                              className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                              <CheckCircle size={ICONO.xs} /> {counts.graded}/{counts.delivered}
                                            </span>
                                            <span
                                              data-tooltip="Por calificar"
                                              className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                              <Timer size={ICONO.xs} /> {counts.delivered - counts.graded}/{counts.delivered}
                                            </span>
                                          </div>
                                        )}
                                      </button>
                                      {esJuego && a.juego?.estado !== 'juego_confirmado' ? null : isHidden ? (
                                        <IconButton icon={EyeOff} label={a.publishedAt ? 'Mostrar a estudiantes' : 'Publicar para estudiantes'} tooltip={false} onClick={(e) => { e.stopPropagation(); a.publishedAt ? showActivityNow(a) : setPublishDraftConfirm(a) }}
                                         
                                          data-tooltip={a.publishedAt ? 'Mostrar a estudiantes' : 'Publicar para estudiantes'} />
                                      ) : (
                                        <IconButton icon={Eye} label="Ocultar para estudiantes" tooltip={false} onClick={(e) => { e.stopPropagation(); hideActivity(a) }}
                                         
                                          data-tooltip="Ocultar para estudiantes" />
                                      )}
                                      <IconButton icon={Pencil} label="Editar" tooltip={false} className="mr-0.5" onClick={() => esJuego ? navigate(`/activity/${a.id}`) : openEdit(a, activityLabelById[a.id])} data-tooltip="Editar" />
                                      {!IS_NATIVE_APP && (
                                        <button type="button"
                                          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setActivityMenu((m) => m?.a?.id === a.id ? null : { a, x: r.right, y: r.bottom }) }}
                                          aria-label="Más acciones"
                                          data-tooltip="Más acciones"
                                          className="size-control inline-flex items-center justify-center text-hint hover:text-accent hover:bg-[var(--accent-medium)] rounded-full transition-colors flex-shrink-0 mr-1">
                                          <MoreVertical size={ICONO.sm} />
                                        </button>
                                      )}
                                    </div>
                                    {dropZone(vizIdx, isDraggingHere)}
                                  </Fragment>
                                )
                              } else {
                                // Material de apoyo — arrastrable solo en web
                                const m = item.item
                                const visState = activityVisibilityState(m, parcialOculto)
                                const isHidden = visState !== 'visible'
                                const isExpanded = expandedMaterialId === m.id
                                const isBeingDragged = m.id === dragMatId
                                return (
                                  <Fragment key={m.id}>
                                    {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
                                    <div
                                      draggable={!IS_NATIVE_APP}
                                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragMatId(m.id) }}
                                      onDragEnd={() => { setDragMatId(null); setDropZoneActive(null) }}
                                      className={`w-full rounded border bg-surface-card transition-colors duration-estandar ${isHidden ? 'border-outline-variant opacity-60' : 'border-outline-variant hover:border-accent'} ${isBeingDragged ? 'opacity-40' : ''}`}
                                    >
                                      <div className="flex items-center gap-1">
                                        {!IS_NATIVE_APP && (
                                          <div
                                            className="pl-2 py-2 text-hint hover:text-slate-500 cursor-grab active:cursor-grabbing flex-shrink-0"
                                            data-tooltip="Arrastrar para reordenar"
                                            data-tooltip-pos="right"
                                          >
                                            <GripVertical size={ICONO.sm} />
                                          </div>
                                        )}
                                        <button type="button" onClick={() => setExpandedMaterialId(isExpanded ? null : m.id)}
                                          className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 text-left hover:bg-[var(--accent-tint)] rounded transition-colors">
                                          <BookOpen size={ICONO.md} className={`flex-shrink-0 ${isHidden ? 'text-hint' : 'text-amber-500'}`} />
                                          <div className="flex-1 min-w-0">
                                            <p className={`text-base font-medium leading-tight truncate ${isHidden ? 'text-hint' : 'text-on-surface'}`}>{m.nombre}</p>
                                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                              <span className="text-xs text-muted flex items-center gap-0.5">
                                                <Paperclip size={ICONO.xs} /> {(m.archivos || []).length} archivo{(m.archivos || []).length !== 1 ? 's' : ''}
                                              </span>
                                              {!telefonoWeb.telefono && m.publishAt && (
                                                <span data-tooltip="Fecha de publicación" className="text-xs text-accent flex items-center gap-0.5">
                                                  <Clock size={ICONO.xs} /> {formatPublishAt(m.publishAt)}
                                                </span>
                                              )}
                                              {visState === 'hidden' && (
                                                <span className="text-xs bg-surface-container text-muted px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                                  <EyeOff size={ICONO.xs} /> Oculto
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                          {isExpanded ? <ChevronUp size={ICONO.md} className="text-hint flex-shrink-0" /> : <ChevronDown size={ICONO.md} className="text-hint flex-shrink-0" />}
                                        </button>
                                        {isHidden ? (
                                          <IconButton icon={EyeOff} label="Mostrar a estudiantes" tooltip={false} onClick={(e) => { e.stopPropagation(); showMaterialNow(m) }} data-tooltip="Mostrar a estudiantes" />
                                        ) : (
                                          <IconButton icon={Eye} label="Ocultar a estudiantes" tooltip={false} onClick={(e) => { e.stopPropagation(); hideMaterial(m) }} data-tooltip="Ocultar a estudiantes" />
                                        )}
                                        <IconButton icon={Pencil} label="Editar" tooltip={false} className="mr-0.5" onClick={() => openEditMaterial(m)} data-tooltip="Editar" />
                                        <IconButton icon={Trash2} effect="balanceo" label="Eliminar" variant="danger" tooltip={false} className="mr-1" onClick={() => setDeleteMaterialConfirm(m)} data-tooltip="Eliminar" />
                                      </div>
                                      {isExpanded && (
                                        <div className="border-t border-outline-variant px-3 py-2 ml-9">
                                          {m.descripcion && (
                                            <div className={`text-sm text-on-surface mb-2 ${richTextContentClass}`}
                                              dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.descripcion) }} />
                                          )}
                                          <AttachmentList files={m.archivos} title={null} />
                                        </div>
                                      )}
                                    </div>
                                    {dropZone(vizIdx, isDraggingHere)}
                                  </Fragment>
                                )
                              }
                            })}
                          </>
                        )
                      })()}

                      {!IS_NATIVE_APP && (
                      <button data-esq="subj-doc-cta" type="button" onClick={() => openAdd(p)}
                        data-tooltip={canCreate ? undefined : 'Necesitas Créditos IA para crear nuevas actividades'}
                        className={`w-full h-control border border-dashed rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                          canCreate ? 'border-accent-soft text-accent hover:bg-[var(--accent-medium)]' : 'border-outline-variant text-hint hover:bg-[var(--accent-medium)]'
                        }`}>
                        <Plus size={ICONO.sm} /> Agregar actividad
                      </button>
                      )}
                      {!IS_NATIVE_APP && (
                      <button data-esq="subj-doc-cta" type="button" onClick={() => openAddMaterial(p)}
                        data-tooltip={canCreate ? undefined : 'Necesitas Créditos IA para crear nuevo material de apoyo'}
                        className={`w-full h-control border border-dashed rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                          canCreate ? 'border-accent-soft text-accent hover:bg-[var(--accent-medium)]' : 'border-outline-variant text-hint hover:bg-[var(--accent-medium)]'
                        }`}>
                        <BookOpen size={ICONO.sm} /> Agregar material de apoyo
                      </button>
                      )}
                      {!IS_NATIVE_APP && (
                      <button data-esq="subj-doc-cta" type="button" onClick={() => openImport(p)}
                        data-tooltip="Copia actividades de otra de tus asignaturas a este parcial"
                        className={`w-full h-control border border-dashed rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                          canCreate ? 'border-accent-soft text-accent hover:bg-[var(--accent-medium)]' : 'border-outline-variant text-hint hover:bg-[var(--accent-medium)]'
                        }`}>
                        <Copy size={ICONO.sm} /> Traer de otra asignatura
                      </button>
                      )}
                      </div>
                    </div>
                  </div>
                  </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
    </>
  )
}
