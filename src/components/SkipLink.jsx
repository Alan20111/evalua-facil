// "Saltar al contenido" — docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 2,
// paso 2.5. Debe ser el primer elemento enfocable del layout (antes del
// header/sidebar) para que sea el primer Tab stop de la página. Invisible
// hasta que recibe foco por teclado (sr-only / focus:not-sr-only, ambas
// utilidades nativas de Tailwind — no hace falta CSS aparte).
export default function SkipLink({ targetId = 'main-content' }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:rounded focus:bg-accent focus:px-4 focus:py-2 focus:font-semibold focus:text-white focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      Saltar al contenido
    </a>
  )
}
