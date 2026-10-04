// Esqueletos con la FORMA de cada pantalla — no plantillas genéricas.
//
// Cada uno copia las cajas de la pantalla real que reemplaza: el mismo
// contenedor, el mismo padding, los mismos cuadros de icono y los renglones con
// el alto de línea de su texto (SkeletonLine). Así, cuando llegan los datos, el
// contenido aparece en el mismo lugar en que estaba su esqueleto y nada salta.
//
// Si cambias el layout de una de estas pantallas, cambia también su esqueleto:
// la regla es que se puedan encimar y coincidan.
import { Skeleton, SkeletonGroup, SkeletonLine } from '../ui'
import { cn } from '../ui/cn'
import { TEACHER_CONTAINER, TEACHER_CONTAINER_NARROW, STUDENT_CONTAINER } from '../../config/layout'
import { IS_NATIVE_APP } from '../../utils/platform'

const ANCHOS = ['w-2/3', 'w-1/2', 'w-3/5', 'w-2/5', 'w-1/3']
const ancho = (i, desfase = 0) => ANCHOS[(i + desfase) % ANCHOS.length]

// Columna de flechas Subir/Bajar (web) o asa de arrastre (App) de las filas
// reordenables: dos botones p-2 con icono 16 = 32×64.
function Reordenar() {
  return IS_NATIVE_APP
    ? <span className="w-[2.361rem] h-[2.361rem] -m-1 flex-shrink-0 flex items-center justify-center"><Skeleton className="w-3 h-4" /></span>
    : <span className="w-8 h-16 flex-shrink-0 flex flex-col items-center justify-around"><Skeleton className="w-3.5 h-3.5" /><Skeleton className="w-3.5 h-3.5" /></span>
}

// ── Docente · tablero: "Mis asignaturas (n)" + filas de materia ──
export function EsqueletoTableroDocente({ filas = 4 }) {
  return (
    <SkeletonGroup etiqueta="Cargando tus asignaturas…">
      <SkeletonLine texto="text-lg font-semibold" className="w-44 mb-2" />
      <div className="space-y-2 mb-4">
        {Array.from({ length: filas }, (_, i) => (
          <div key={i} className="w-full bg-surface-card rounded-card p-1.5 shadow-card flex items-center gap-1">
            <Reordenar />
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <Skeleton className="w-11 h-11 rounded flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <SkeletonLine texto="text-base font-semibold" className={ancho(i)} />
              </div>
              <Skeleton className="w-3 h-4 mr-1 flex-shrink-0" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonGroup>
  )
}

// ── Docente · asignatura: encabezado (título, código, pestañas) + parciales ──
export function EsqueletoAsignaturaDocente({ parciales = 3 }) {
  return (
    <div>
      <SkeletonGroup etiqueta="Cargando la asignatura…">
        <div className="bg-surface-card rounded-b-card">
          <div className={`${TEACHER_CONTAINER} px-4 py-2`}>
          <div className="flex items-center gap-2">
            <span className="p-2 -ml-2 flex-shrink-0"><Skeleton className="w-[1.528rem] h-[1.528rem]" /></span>
            <Skeleton className="w-9 h-9 rounded flex-shrink-0" />
            <SkeletonLine texto="text-xl font-bold" className="w-56 max-w-[60%]" />
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-2">
            <span className="px-2 py-1.5 flex-shrink-0"><SkeletonLine texto="text-2xl font-bold" className="w-28" /></span>
            <SkeletonLine texto="text-sm" className="w-72 max-w-[45%]" />
            <span className="ml-auto flex gap-1">
              {Array.from({ length: 4 }, (_, i) => <span key={i} className="p-2"><Skeleton className="w-[1.458rem] h-[1.458rem]" /></span>)}
            </span>
          </div>
          <div className="flex gap-1 mt-2 bg-surface-container p-1 rounded-full overflow-hidden">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} className={cn('flex-shrink-0 sm:flex-1 px-3 sm:px-0 py-2 rounded-full flex justify-center', i === 0 && 'bg-surface-card')}>
                <SkeletonLine texto="text-xs sm:text-sm" className="w-16 sm:w-20" />
              </span>
            ))}
          </div>
          </div>
        </div>
        <div className={TEACHER_CONTAINER}>
        <div className={`px-4 py-2 space-y-2 ${TEACHER_CONTAINER_NARROW}`}>
          {Array.from({ length: parciales }, (_, i) => (
            <div key={i} className="bg-surface-card rounded-card overflow-hidden shadow-card">
              <div className="flex items-center gap-1">
                <div className="flex-1 min-w-0 px-4 py-2 flex items-center gap-2">
                  <Skeleton className="w-10 h-10 rounded flex-shrink-0" />
                  <div className="min-w-0 w-40">
                    <SkeletonLine texto="text-base font-semibold leading-tight" className="w-24" />
                    <SkeletonLine texto="text-sm leading-tight" className="w-20 -mt-0.5" />
                  </div>
                </div>
                <span className="p-2"><Skeleton className="w-[1.389rem] h-[1.389rem]" /></span>
                <span className="p-2 mr-2"><Skeleton className="w-[1.389rem] h-[1.389rem]" /></span>
              </div>
              <div className="px-4 pb-2 pl-[4.5rem] -mt-1 flex items-center gap-2">
                <Skeleton className="w-[0.903rem] h-[0.903rem] m-[0.208rem] ml-1 rounded-sm flex-shrink-0" />
                <SkeletonLine texto="text-xs" className="w-48 max-w-[70%]" />
              </div>
            </div>
          ))}
        </div>
        </div>
      </SkeletonGroup>
    </div>
  )
}

// ── Docente · actividad (Evaluar): encabezado, instrucciones y Entregas ──
export function EsqueletoActividadDocente({ filas = 8 }) {
  return (
    <div className={IS_NATIVE_APP ? '' : TEACHER_CONTAINER_NARROW}>
      <SkeletonGroup etiqueta="Cargando la actividad…">
        <div className="px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="p-2 -ml-2 flex-shrink-0"><Skeleton className="w-[1.528rem] h-[1.528rem]" /></span>
            <div className="flex-1 min-w-0">
              <SkeletonLine texto="text-[1.75rem] leading-tight font-bold" className="w-72 max-w-full" />
              <SkeletonLine texto="text-xl font-bold" className="w-48 max-w-full" />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2">
            {['w-28', 'w-24', 'w-32'].map((w) => <SkeletonLine key={w} texto="text-sm" className={w} />)}
          </div>
          <div className="mt-2 rounded-card overflow-hidden bg-surface-card shadow-card border border-outline-variant">
            <div className="px-4 py-2 border-b border-outline-variant"><SkeletonLine texto="text-sm font-semibold" className="w-24" /></div>
            <div className="p-4 space-y-1">
              <SkeletonLine texto="text-sm" className="w-full" />
              <SkeletonLine texto="text-sm" className="w-3/4" />
            </div>
          </div>
        </div>
        <div className="mx-4 my-4 rounded-card overflow-hidden bg-surface-card shadow-card border border-outline-variant">
          <div className="px-4 py-3 border-b border-outline-variant"><SkeletonLine texto="text-base font-semibold" className="w-20" /></div>
          <div className={IS_NATIVE_APP ? 'grid grid-cols-2 gap-1 mx-4 mt-3 bg-surface-container p-1 rounded-card' : 'flex gap-1 mx-4 mt-3 bg-surface-container p-1 rounded-full'}>
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className={cn(IS_NATIVE_APP ? '' : 'flex-1', 'py-1.5 rounded-full flex justify-center', i === 0 && 'bg-surface-card')}>
                <SkeletonLine texto="text-xs font-medium" className="w-16" />
              </span>
            ))}
          </div>
          <div className="px-4 pt-4 pb-2 flex justify-center"><SkeletonLine texto="text-xs" className="w-44 mt-1.5" /></div>
          <div className="px-4 pb-4">
            <div className="rounded-card border border-outline-variant overflow-hidden">
              {Array.from({ length: filas }, (_, i) => (
                <div key={i} className={cn('w-full flex items-center py-1', IS_NATIVE_APP ? 'gap-1 pl-1 pr-2' : 'gap-2 px-2')}>
                  <SkeletonLine texto="text-sm" className="w-4 flex-shrink-0" />
                  <div className="flex-1 min-w-0"><SkeletonLine texto="text-sm font-medium" className={ancho(i, 1)} /></div>
                  <Skeleton className="w-20 h-5 rounded-full flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </SkeletonGroup>
    </div>
  )
}

// ── Alumno · tablero: tarjeta de perfil (móvil) + "Mis asignaturas" + filas ──
export function EsqueletoTableroAlumno({ filas = 3 }) {
  return (
    <div className={`px-4 py-6 ${STUDENT_CONTAINER}`}>
      <SkeletonGroup etiqueta="Cargando tus asignaturas…">
        <div className={`${IS_NATIVE_APP ? '' : 'md:hidden'} bg-surface-card rounded-card shadow-card overflow-hidden mb-4`}>
          <div className="w-full flex items-center gap-3 px-4 py-4">
            <Skeleton className="w-20 h-20 rounded-full flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <SkeletonLine texto="text-base font-semibold" className="w-32" />
              <SkeletonLine texto="text-sm" className="w-40" />
            </div>
          </div>
        </div>
        <SkeletonLine texto="text-xl font-bold" className="w-48 mb-1" />
        <SkeletonLine texto="text-sm" className="w-36 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: filas }, (_, i) => (
            <div key={i} className="w-full bg-surface-card rounded-card p-1.5 shadow-card flex items-center gap-1">
              <Reordenar />
              <div className="flex-1 min-w-0 flex items-center gap-3 p-1.5">
                <Skeleton className="w-12 h-12 rounded flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <SkeletonLine texto="text-base font-semibold" className={ancho(i)} />
                  <SkeletonLine texto="text-sm font-medium" className={cn('mt-0.5', ancho(i, 3))} />
                </div>
                <div className="flex flex-col items-end flex-shrink-0">
                  <SkeletonLine texto="text-lg font-bold" className="w-8" />
                  <SkeletonLine texto="text-sm" className="w-16" />
                </div>
                <Skeleton className="w-3 h-4 flex-shrink-0" />
              </div>
            </div>
          ))}
        </div>
      </SkeletonGroup>
    </div>
  )
}

// ── Alumno · asignatura: encabezado + pestañas subrayadas + parciales ──
export function EsqueletoAsignaturaAlumno({ parciales = 3 }) {
  return (
    <SkeletonGroup etiqueta="Cargando la asignatura…" className="bg-surface">
      <div className="bg-surface-card border-b border-outline-variant px-4 py-3 flex items-center gap-3 shadow-card">
        <Skeleton className="w-9 h-9 rounded flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <SkeletonLine texto="text-lg font-bold" className="w-48 max-w-full" />
          <SkeletonLine texto="text-sm font-medium" className="w-32" />
        </div>
        <span className="p-2"><Skeleton className="w-[1.389rem] h-[1.389rem]" /></span>
      </div>
      <div className="bg-surface-card border-b border-outline-variant px-4 flex gap-1 overflow-hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className={cn('px-3 py-2.5 border-b-2 flex-shrink-0', i === 0 ? 'border-skeleton' : 'border-transparent')}>
            <SkeletonLine texto="text-sm font-medium" className="w-20" />
          </span>
        ))}
      </div>
      <div className={`px-4 py-5 space-y-3 ${STUDENT_CONTAINER}`}>
        {Array.from({ length: parciales }, (_, i) => (
          <div key={i} className="bg-surface-card rounded-card overflow-hidden shadow-card">
            <div className="w-full px-4 py-3 flex items-center gap-3">
              <Skeleton className="w-9 h-9 rounded flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <SkeletonLine texto="text-base font-semibold" className="w-24" />
                <SkeletonLine texto="text-sm" className="w-20" />
              </div>
              <SkeletonLine texto="text-lg font-bold" className="w-8" />
              <Skeleton className="w-[1.389rem] h-[1.389rem] flex-shrink-0" />
            </div>
            {!IS_NATIVE_APP && (
              <div className="px-4 pb-2 pl-16 -mt-1 flex items-center gap-2">
                <Skeleton className="w-[0.903rem] h-[0.903rem] m-[0.208rem] ml-1 rounded-sm flex-shrink-0" />
                <SkeletonLine texto="text-xs" className="w-48 max-w-[70%]" />
              </div>
            )}
          </div>
        ))}
      </div>
    </SkeletonGroup>
  )
}

// ── Espera de la sesión (App.jsx), antes de saber el rol ──
// Misma geometría que el shell: barra lateral de 300 px en escritorio y el
// tablero en el contenedor angosto, que es a donde llega casi todo el mundo.
export function EsqueletoSesion() {
  return (
    <div className="min-h-dvh bg-surface flex">
      {!IS_NATIVE_APP && <div aria-hidden="true" className="hidden md:block w-[20.833rem] flex-shrink-0 bg-skeleton" />}
      <div className={`flex-1 min-w-0 px-4 sm:px-5 lg:px-6 py-4 ${TEACHER_CONTAINER_NARROW}`}>
        <div className="mb-4 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <SkeletonLine texto="text-lg font-bold" className="w-40" />
            <SkeletonLine texto="text-xs" className="w-52 mt-0.5" />
          </div>
          <Skeleton className="w-12 h-12 rounded-full flex-shrink-0" />
        </div>
        <EsqueletoTableroDocente />
      </div>
    </div>
  )
}
