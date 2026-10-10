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
import { TEACHER_CONTAINER_NARROW, TEACHER_CONTAINER_LISTA, STUDENT_CONTAINER, STUDENT_CONTAINER_LISTA } from '../../config/layout'
import { IS_NATIVE_APP } from '../../utils/platform'
import { SB_FILA } from '../../config/sidebar'

const ANCHOS = ['w-2/3', 'w-1/2', 'w-3/5', 'w-2/5', 'w-1/3']
const ancho = (i, desfase = 0) => ANCHOS[(i + desfase) % ANCHOS.length]

// Columna de flechas Subir/Bajar (web) o asa de arrastre (App) de las filas
// reordenables. Los iconos de la pantalla real son de 16 px literales (no
// escalan con la raíz de 14.4 px): dos botones p-2 con icono 16 = 30.4×60.8.
function Reordenar() {
  return IS_NATIVE_APP
    ? <span className="p-2 -m-1 flex-shrink-0"><Skeleton className="w-[1.25rem] h-[1.25rem]" /></span>
    : (
      <span className="flex flex-col flex-shrink-0">
        {[0, 1].map((i) => <span key={i} className="p-2"><Skeleton className="w-[1.111rem] h-[1.111rem]" /></span>)}
      </span>
    )
}

// ── Docente · tablero: "Mis asignaturas (n)" + filas de materia ──
export function EsqueletoTableroDocente({ filas = 4 }) {
  return (
    <SkeletonGroup etiqueta="Cargando tus asignaturas…">
      <SkeletonLine data-esq="dash-doc-titulo" texto="text-lg font-semibold" className="w-44 mb-2" />
      <div data-esq="dash-doc-lista" className="space-y-2 mb-4">
        {Array.from({ length: filas }, (_, i) => (
          <div key={i} data-esq="dash-doc-fila" className="w-full bg-surface-card rounded-card p-1.5 shadow-card flex items-center gap-1">
            <Reordenar />
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <Skeleton data-esq="dash-doc-icono" className="w-11 h-11 rounded flex-shrink-0" />
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
        <div className="px-4 pt-2">
        <div data-esq="subj-doc-encabezado" className="bg-surface-card rounded-card">
          <div data-esq="subj-doc-encabezado-interior" className="px-4 py-2">
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
          <div data-esq="subj-doc-pestanas" className="flex gap-1 mt-2 bg-surface-container p-1 rounded-full overflow-x-auto">
            {['Actividades', 'Estudiantes', 'Clase'].map((t, i) => (
              <span key={t} data-esq="subj-doc-pestana" className={cn('flex-1 whitespace-nowrap px-3 py-2 text-sm font-medium rounded-full flex justify-center', i === 0 && 'bg-surface-card')}>
                <SkeletonLine texto="text-sm" className="w-20" />
              </span>
            ))}
          </div>
          </div>
        </div>
        </div>
        <div className={TEACHER_CONTAINER_LISTA}>
        <div data-esq="subj-doc-parciales" className="px-4 py-2 space-y-2">
          {Array.from({ length: parciales }, (_, i) => {
            // El Parcial 1 llega ABIERTO en la pantalla real (borde tenue, fondo
            // en la cabecera y la lista con sus tres botones punteados).
            const abierto = i === 0
            return (
              <div key={i} data-esq="subj-doc-parcial" className={cn('bg-surface-card rounded-card overflow-hidden shadow-card', abierto && 'border border-accent-soft')}>
                <div data-esq="subj-doc-parcial-cabecera-fondo" className={abierto ? 'bg-accent-light border-b border-accent-soft' : ''}>
                  <div className="flex items-center gap-1">
                    <div data-esq="subj-doc-parcial-cabecera" className="flex-1 min-w-0 px-4 py-2 flex items-center gap-2">
                      <Skeleton data-esq="subj-doc-parcial-icono" className="w-10 h-10 rounded flex-shrink-0" />
                      <div className="min-w-0 w-40">
                        <SkeletonLine texto="text-base font-semibold leading-tight" className="w-24" />
                        <SkeletonLine texto="text-sm leading-tight" className="w-20 -mt-0.5" />
                      </div>
                    </div>
                    <span className="p-2"><Skeleton className="w-[1.389rem] h-[1.389rem]" /></span>
                    <span className="p-2 mr-2"><Skeleton className="w-[1.389rem] h-[1.389rem]" /></span>
                  </div>
                  <div data-esq="subj-doc-parcial-filtro" className="px-4 pb-2 pl-[4.5rem] -mt-1">
                    <span className="inline-flex items-center gap-2 w-full">
                      <Skeleton className="w-[0.903rem] h-[0.903rem] m-[0.208rem] ml-1 rounded-sm flex-shrink-0" />
                      <SkeletonLine texto="text-xs" className="w-48 max-w-[70%]" />
                    </span>
                  </div>
                </div>
                {abierto && (
                  <div data-esq="subj-doc-parcial-cuerpo" className="border-t border-outline-variant pr-4 py-2">
                    <div data-esq="subj-doc-parcial-lista" className="ml-3 pl-3 border-l-2 border-accent-soft space-y-1.5">
                      {[0, 1, 2].map((k) => (
                        <div key={k} data-esq="subj-doc-cta" className="w-full py-2.5 border border-dashed border-accent-soft rounded-full text-sm font-medium flex items-center justify-center gap-2">
                          <SkeletonLine texto="text-sm" className="w-40" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
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
        <div data-esq="act-doc-encabezado" className="px-4 py-2">
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
          <div data-esq="act-doc-instrucciones" className="mt-2 rounded-card overflow-hidden bg-surface-card shadow-card border border-accent-soft">
            <div className="px-4 py-2 border-b border-outline-variant"><SkeletonLine texto="text-sm font-semibold" className="w-24" /></div>
            <div className="p-4 space-y-1">
              <SkeletonLine texto="text-sm" className="w-full" />
              <SkeletonLine texto="text-sm" className="w-3/4" />
            </div>
          </div>
        </div>
        <div data-esq="act-doc-entregas" className="mx-4 my-4 rounded-card overflow-hidden bg-surface-card shadow-card border border-accent-soft">
          <div data-esq="act-doc-entregas-cabecera" className="px-4 py-3 border-b border-accent-soft"><SkeletonLine texto="text-base font-semibold" className="w-20" /></div>
          <div className={IS_NATIVE_APP ? 'grid grid-cols-2 gap-1 mx-4 mt-3 bg-surface-container p-1 rounded-card' : 'flex gap-1 mx-4 mt-3 bg-surface-container p-1 rounded-full'}>
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className={cn(IS_NATIVE_APP ? '' : 'flex-1', 'py-1.5 rounded-full flex justify-center', i === 0 && 'bg-surface-card')}>
                <SkeletonLine texto="text-xs font-medium" className="w-16" />
              </span>
            ))}
          </div>
          <div data-esq="act-doc-ayuda" className="px-4 pt-4 pb-2">
            <Skeleton className="h-[2.528rem] w-full rounded-full" />
            <div className="flex justify-center"><SkeletonLine texto="text-xs" className="w-44 mt-1.5" /></div>
          </div>
          <div data-esq="act-doc-lista-contenedor" className="px-4 pb-4">
            <div data-esq="act-doc-lista" className="bg-surface-card rounded-card overflow-hidden shadow-card">
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
        <div data-esq="dash-alu-perfil" className={`${IS_NATIVE_APP ? '' : 'md:hidden'} bg-surface-card rounded-card shadow-card overflow-hidden mb-4`}>
          <div className="w-full flex items-center gap-3 px-4 py-4">
            <Skeleton className="w-20 h-20 rounded-full flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <SkeletonLine texto="text-base font-semibold" className="w-32" />
              <SkeletonLine texto="text-sm" className="w-40" />
            </div>
          </div>
        </div>
        <SkeletonLine data-esq="dash-alu-titulo" texto="text-xl font-bold" className="w-48 mb-1" />
        <SkeletonLine texto="text-sm" className="w-36 mb-4" />
        <div data-esq="dash-alu-lista" className="space-y-2">
          {Array.from({ length: filas }, (_, i) => (
            <div key={i} data-esq="dash-alu-fila" className="w-full bg-surface-card rounded-card p-1.5 shadow-card flex items-center gap-1">
              <Reordenar />
              <div data-esq="dash-alu-fila-boton" className="flex-1 min-w-0 flex items-center gap-3 p-1.5">
                <Skeleton data-esq="dash-alu-icono" className="w-12 h-12 rounded flex-shrink-0" />
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
      <div className="px-4 pt-2">
      <div data-esq="subj-alu-tarjeta" className="bg-surface-card rounded-card">
      <div data-esq="subj-alu-encabezado" className="px-4 py-3 flex items-center gap-3">
        <span className="md:hidden p-2 -ml-2 flex-shrink-0"><Skeleton className="w-[1.528rem] h-[1.528rem]" /></span>
        <Skeleton data-esq="subj-alu-icono" className="w-9 h-9 rounded flex-shrink-0" />
        <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
          <SkeletonLine texto="text-lg font-bold" className="w-48 max-w-full" />
          <SkeletonLine texto="text-sm font-medium" className="w-32" />
        </div>
        <span className="p-2"><Skeleton className="w-[1.319rem] h-[1.319rem]" /></span>
      </div>
      <div data-esq="subj-alu-pestanas-fondo" className="relative px-4 pb-3">
        <div data-esq="subj-alu-pestanas" className="flex gap-1 bg-surface-container p-1 rounded-full overflow-x-auto">
          {/* Con los textos REALES de las pestañas, en transparente: cada barra mide
              exactamente el ancho de su etiqueta, sin adivinar. */}
          {['Actividades y calificaciones', 'Asistencias', 'Recursos', 'Avisos'].map((t, i) => (
            <span key={t} data-esq="subj-alu-pestana" className={cn('flex-shrink-0 sm:flex-1 px-3 py-2 text-sm font-medium whitespace-nowrap rounded-full flex justify-center', i === 0 && 'bg-surface-card')}>
              <span className="rounded-full bg-skeleton animate-pulse motion-reduce:animate-none text-transparent select-none">{t}</span>
            </span>
          ))}
        </div>
      </div>
      </div>
      </div>
      <div data-esq="subj-alu-parciales" className={`px-4 py-5 space-y-3 ${STUDENT_CONTAINER_LISTA}`}>
        {Array.from({ length: parciales }, (_, i) => (
          <div key={i} data-esq="subj-alu-parcial" className="bg-surface-card rounded-card overflow-hidden shadow-card">
            <div className="w-full px-4 py-3 flex items-center gap-3">
              <Skeleton data-esq="subj-alu-parcial-icono" className="w-9 h-9 rounded flex-shrink-0" />
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
export function EsqueletoSesion({ rol = 'docente', contenido = 'tablero' }) {
  return (
    // data-role propio: mientras se resuelve la sesión este esqueleto vive FUERA
    // del RoleWrapper de App.jsx, y sin rol cae a la escala de letra por defecto
    // (medido: renglones 0.9 px más bajos y 5.8 px de salto al cargar).
    <div data-role={rol} className="min-h-dvh bg-surface">
      {/* Barra superior del móvil — mismas medidas que la real de Layout */}
      {!IS_NATIVE_APP && (
        <div aria-hidden="true" data-esq="sesion-encabezado-movil" className="md:hidden sticky barra-flotante-sup z-30 mx-2 rounded-full bg-surface-card px-4 h-[var(--barra-alto)] flex items-center justify-between shadow-barra">
          <Skeleton className="h-8 w-28" />
          <span className="flex items-center gap-1">
            <span className="p-2"><Skeleton className="w-[1.389rem] h-[1.389rem]" /></span>
            <span className="p-2"><Skeleton className="w-[1.389rem] h-[1.389rem]" /></span>
          </span>
        </div>
      )}
      <div className={IS_NATIVE_APP ? '' : 'flex'}>
        {!IS_NATIVE_APP && <div aria-hidden="true" data-esq="sesion-lateral" className="hidden md:block w-[20.833rem] h-dvh sticky top-0 flex-shrink-0 bg-skeleton" />}
        {rol === 'alumno' ? (
          <div className="flex-1 min-w-0">
            {contenido === 'asignatura' ? <EsqueletoAsignaturaAlumno /> : <EsqueletoTableroAlumno />}
          </div>
        ) : <ContenidoDocente contenido={contenido} />}
      </div>
      {/* Barra inferior del móvil: 100% de ancho, esquinas de arriba redondeadas */}
      {!IS_NATIVE_APP && (
        <div aria-hidden="true" data-esq="nav-inferior" className="md:hidden fixed barra-flotante-inf left-2 right-2 bg-surface-card rounded-full shadow-barra">
          <div data-esq="nav-inferior-fila" className="flex px-2 h-[var(--barra-alto)]">
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className="flex-1 min-w-0 flex flex-col items-center justify-center px-1 gap-1">
                <Skeleton className="w-6 h-6 rounded-full" />
                <Skeleton className="h-2 w-12" />
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Solo el contenido del docente (sin barras): es lo que se ve dentro del
// TeacherLayout mientras llega el código de una página (App.jsx, Suspense).
export function ContenidoDocente({ contenido = 'tablero' }) {
  if (contenido === 'asignatura') return <div className="flex-1 min-w-0"><EsqueletoAsignaturaDocente /></div>
  if (contenido === 'actividad') return <div className="flex-1 min-w-0"><EsqueletoActividadDocente /></div>
  return (
    <div data-esq="dash-doc-contenedor" className={`flex-1 min-w-0 px-4 sm:px-5 lg:px-6 py-4 ${TEACHER_CONTAINER_NARROW}`}>
      <div data-esq="dash-doc-saludo" className="mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <SkeletonLine data-esq="dash-doc-saludo-nombre" texto="text-lg font-bold" className="w-40 min-w-0" />
        </div>
        <SkeletonLine data-esq="dash-doc-saludo-escuela" texto="text-xs" className="w-52 mt-0.5" />
      </div>
      <EsqueletoTableroDocente />
    </div>
  )
}

// ── Barra lateral del docente: lista de asignaturas mientras carga ──
// Una fila = la fila estándar SB_FILA (config/sidebar.js), la MISMA constante
// que usa la barra real: si cambia su medida, cambia aquí sola.
export function EsqueletoFilasLateral({ filas = 3 }) {
  return (
    <SkeletonGroup etiqueta="Cargando tus asignaturas…" className="space-y-1">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} data-esq="sb-fila" className={SB_FILA}>
          <Skeleton sobreColor className="w-[1.389rem] h-[1.389rem] flex-shrink-0" />
          <SkeletonLine sobreColor texto="text-body-sm" className={`${ancho(i)} flex-1`} />
        </div>
      ))}
    </SkeletonGroup>
  )
}

// ── Barra lateral del alumno: lista de asignaturas mientras carga ──
export function EsqueletoFilasLateralAlumno({ filas = 3 }) {
  return (
    <SkeletonGroup etiqueta="Cargando tus asignaturas…">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} data-esq="sba-fila" className="flex items-center gap-2 px-3 py-1.5 rounded text-body-sm">
          <Skeleton sobreColor className="w-[1.181rem] h-[1.181rem] flex-shrink-0" />
          <SkeletonLine sobreColor texto="text-body-sm" className={`${ancho(i)} flex-1`} />
        </div>
      ))}
    </SkeletonGroup>
  )
}

// ── Alumno · Video interactivo (mientras se lee el progreso del intento) ──
// Mismas cajas que VideoInteractivoRunner: contenedor, rejilla, recuadro 16:9
// del video y panel. Lo de dentro son barras.
export function EsqueletoVideoInteractivo() {
  return (
    <SkeletonGroup etiqueta="Cargando el video…">
      <div data-esq="video-contenedor" className="px-3 py-2 w-full max-w-xl md:max-w-3xl mx-auto lg:max-w-none [@media(orientation:landscape)_and_(max-height:500px)]:max-w-none lg:h-[var(--vi-alto,auto)] [@media(orientation:landscape)_and_(max-height:500px)]:h-[var(--vi-alto,auto)] lg:px-4 [@media(orientation:landscape)_and_(max-height:500px)]:px-4 lg:py-2 [@media(orientation:landscape)_and_(max-height:500px)]:py-2">
        <div data-esq="video-rejilla" className="grid gap-3 lg:h-full [@media(orientation:landscape)_and_(max-height:500px)]:h-full lg:gap-4 [@media(orientation:landscape)_and_(max-height:500px)]:gap-4 lg:grid-cols-[minmax(0,72fr)_minmax(16rem,28fr)] [@media(orientation:landscape)_and_(max-height:500px)]:grid-cols-[minmax(0,1fr)_minmax(16rem,19rem)]">
          <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-2 lg:hidden [@media(orientation:landscape)_and_(max-height:500px)]:hidden">
              <Skeleton className="h-8 w-36 rounded-full" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="lg:flex-1 [@media(orientation:landscape)_and_(max-height:500px)]:flex-1 lg:min-h-0 [@media(orientation:landscape)_and_(max-height:500px)]:min-h-0 lg:[container-type:size] [@media(orientation:landscape)_and_(max-height:500px)]:[container-type:size] lg:flex [@media(orientation:landscape)_and_(max-height:500px)]:flex lg:items-center [@media(orientation:landscape)_and_(max-height:500px)]:items-center lg:justify-center [@media(orientation:landscape)_and_(max-height:500px)]:justify-center">
              <Skeleton data-esq="video-reproductor" className="w-full aspect-video min-h-[14rem] rounded-card mx-auto portrait:max-md:-mx-3 portrait:max-md:w-[calc(100%+1.5rem)] portrait:max-md:rounded-none lg:w-[min(100cqw,calc(100cqh*16/9))] [@media(orientation:landscape)_and_(max-height:500px)]:w-[min(100cqw,calc(100cqh*16/9))] lg:min-h-0 [@media(orientation:landscape)_and_(max-height:500px)]:min-h-0 lg:shrink-0 [@media(orientation:landscape)_and_(max-height:500px)]:shrink-0" />
            </div>
            <Skeleton className="h-3 w-full rounded-full mt-4" />
          </div>
          <div data-esq="video-panel" className="bg-surface-card rounded-card p-4 shadow-card">
            <div className="hidden lg:flex [@media(orientation:landscape)_and_(max-height:500px)]:flex items-center justify-between gap-2 pb-3 mb-3 border-b border-outline-variant">
              <Skeleton className="h-8 w-36 rounded-full" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-12 w-full rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </SkeletonGroup>
  )
}
