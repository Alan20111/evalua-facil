// Tarifa DEFINITIVA del examen creado desde el Chat con Asistente (Kike,
// 18-ago-2026) — escala fija por tramos de 10 reactivos, NO proporcional
// simple. Vive en su propio archivo (no en accionesChat.js/ia.js) para que
// el cliente (mostrar el costo antes de confirmar) y el servidor (cobrar de
// verdad) usen EXACTAMENTE la misma función — nunca dos números que puedan
// desincronizarse. El servidor siempre vuelve a calcularla desde el número
// real de reactivos de la propuesta ya saneada; el cliente solo la usa para
// mostrar el costo, nunca para decidir el cobro.
export function calcularTarifaExamen(numReactivos) {
  // Escala duplicada 23-ago-2026 (decisión PO): conversión de unidad de
  // créditos (1 crédito = $1 MXN, antes ~$2 MXN/crédito) — el valor
  // monetario de cada tramo se conserva exacto, solo cambia el número
  // nominal de créditos (8→16, 10→20, 12→24, 14→28, 16→32).
  const n = Math.max(1, Number(numReactivos) || 1)
  if (n <= 10) return 16
  if (n <= 20) return 20
  if (n <= 30) return 24
  if (n <= 40) return 28
  if (n <= 50) return 32
  // Más de 50 reactivos no es alcanzable hoy desde el chat (MAX_REACTIVOS
  // de sanearPropuestaAccionChat lo topa en 10) — se deja la MISMA
  // progresión (4 créditos cada 10 reactivos más, el doble de los 2
  // anteriores a la conversión) por si ese tope cambia algún día.
  return 32 + 4 * Math.ceil((n - 50) / 10)
}
