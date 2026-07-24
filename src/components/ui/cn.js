// Une clases condicionales — versión mínima de clsx, sin dependencia nueva.
// No hace resolución de conflictos de Tailwind (no la necesitamos: las
// variantes de ui/ no chocan entre sí; el `className` que pasa el consumidor
// va al final y gana por orden en el CSS). Acepta strings, arrays y falsy.
export function cn(...parts) {
  return parts.flat(Infinity).filter(Boolean).join(' ')
}
