// Esqueletos de carga: la forma del contenido que viene, en gris, mientras
// llegan los datos.
//
// Reemplazan al spinner centrado en las cargas de CONTENIDO (listas, tablas,
// tarjetas, formularios). Un spinner dice "espera"; un esqueleto dice "esto
// es lo que va a aparecer aquí", y evita el salto de diseño cuando llegan los
// datos. Los spinners dentro de botones ("Guardando…") se quedan: ahí indican
// una acción en curso, no contenido por llegar.
//
// Accesibilidad: cada preset es un <output> (rol status) con aria-busy y un texto
// solo para lectores de pantalla; las barras grises son aria-hidden. La
// animación se apaga con prefers-reduced-motion.
//
// Los anchos son FIJOS, no aleatorios: cada render dibuja lo mismo, sin
// parpadeos entre renders.
import { cn } from './cn'

const PULSO = 'animate-pulse motion-reduce:animate-none'

// Barra suelta. El tamaño lo pone quien la usa (h-4 w-1/2, h-10 w-10…).
// `sobreColor`: para fondos de color sólido (la barra lateral azul o
// naranja), donde el gris oscuro no se distingue; ahí va blanco translúcido.
export function Skeleton({ className = '', sobreColor = false }) {
  return <span aria-hidden="true" className={cn('block rounded', sobreColor ? 'bg-white/20' : 'bg-skeleton', PULSO, className)} />
}

// Contenedor accesible común a todos los presets. Se exporta como
// SkeletonGroup para armar formas a medida con barras sueltas dentro.
export function SkeletonGroup({ etiqueta = 'Cargando…', className = '', children }) {
  return (
    // <output> ya tiene el rol "status" implícito (lo anuncia el lector de
    // pantalla); es inline de fábrica, por eso el `block`.
    <output aria-busy="true" aria-live="polite" className={cn('block', className)}>
      <span className="sr-only">{etiqueta}</span>
      {children}
    </output>
  )
}

const ANCHOS = ['w-full', 'w-11/12', 'w-4/5', 'w-2/3', 'w-3/4', 'w-5/6']

// Párrafo: n líneas de ancho variable, la última más corta.
export function SkeletonText({ lines = 3, className = '', etiqueta }) {
  return (
    <SkeletonGroup etiqueta={etiqueta} className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 && lines > 1 ? 'w-1/2' : ANCHOS.at(i % ANCHOS.length))} />
      ))}
    </SkeletonGroup>
  )
}

// Lista: filas con ícono cuadrado + título + línea secundaria. Para listas
// de actividades, avisos, materias, alumnos, historial…
export function SkeletonList({ rows = 4, icon = true, sobreColor = false, className = '', etiqueta }) {
  return (
    <SkeletonGroup etiqueta={etiqueta} className={cn('space-y-3', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          {icon && <Skeleton sobreColor={sobreColor} className="h-10 w-10 rounded flex-none" />}
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton sobreColor={sobreColor} className={cn('h-3.5', ['w-2/3', 'w-1/2', 'w-3/5', 'w-2/5'].at(i % 4))} />
            <Skeleton sobreColor={sobreColor} className={cn('h-3', ['w-1/3', 'w-1/4', 'w-2/5', 'w-1/3'].at(i % 4))} />
          </div>
        </div>
      ))}
    </SkeletonGroup>
  )
}

// Renglón de texto: ocupa EXACTAMENTE el alto de línea del texto que reemplaza
// (h-[1lh] con la misma clase de tamaño), así el esqueleto y la pantalla real
// miden lo mismo y nada salta al terminar de cargar. La barra visible es más
// delgada que el renglón, como la tinta de la letra.
//   texto   clases de tipografía del texto real (ej. 'text-xl font-bold')
//   className  ancho (w-…) y márgenes del renglón
export function SkeletonLine({ texto = 'text-base', className = '', sobreColor = false }) {
  return (
    <span aria-hidden="true" className={cn('flex items-center h-[1lh]', texto, className)}>
      <Skeleton sobreColor={sobreColor} className="h-[0.7em] w-full" />
    </span>
  )
}

// Tarjetas en rejilla: para tableros (materias del docente y del alumno).
export function SkeletonCards({ count = 6, className = '', etiqueta }) {
  return (
    <SkeletonGroup etiqueta={etiqueta} className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded flex-none" />
            <Skeleton className={cn('h-4', ['w-2/3', 'w-1/2', 'w-3/5'].at(i % 3))} />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </SkeletonGroup>
  )
}

// Tabla: encabezado + filas. Para tablas de admin y de calificaciones.
export function SkeletonTable({ rows = 6, cols = 4, className = '', etiqueta }) {
  return (
    <SkeletonGroup etiqueta={etiqueta} className={cn('space-y-3', className)}>
      <div className="flex gap-4 pb-2 border-b border-outline-variant">
        {Array.from({ length: cols }, (_, c) => <Skeleton key={c} className="h-3 flex-1" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cn('h-3.5 flex-1', c === 0 ? '' : ['opacity-80', 'opacity-60'].at((r + c) % 2))} />
          ))}
        </div>
      ))}
    </SkeletonGroup>
  )
}

// Formulario: etiqueta + campo. Para perfil, ajustes y notificaciones.
export function SkeletonForm({ fields = 4, className = '', etiqueta }) {
  return (
    <SkeletonGroup etiqueta={etiqueta} className={cn('space-y-4', className)}>
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className={cn('h-3', ['w-24', 'w-32', 'w-20', 'w-28'].at(i % 4))} />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </SkeletonGroup>
  )
}

// Pantalla completa: encabezado + rejilla de tarjetas. Para la espera de la
// sesión, antes de saber qué pantalla toca.
export function SkeletonPage({ className = '', etiqueta = 'Cargando tu espacio…' }) {
  return (
    <div className={cn('min-h-dvh bg-surface p-4 sm:p-6', className)}>
      <SkeletonGroup etiqueta={etiqueta} className="max-w-5xl mx-auto space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-3.5 w-72 max-w-full" />
        </div>
        <SkeletonCards count={6} />
      </SkeletonGroup>
    </div>
  )
}

// Comodín para bloques chicos (dentro de modales y secciones): unas líneas.
export function SkeletonBlock({ className = '', etiqueta }) {
  return <SkeletonText lines={3} className={cn('py-2', className)} etiqueta={etiqueta} />
}
