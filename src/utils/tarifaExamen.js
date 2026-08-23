// Tarifa DEFINITIVA del examen creado desde el Chat con Asistente (Kike,
// 18-ago-2026) — escala fija por tramos de 10 reactivos, NO proporcional
// simple. Vive en su propio archivo (no en accionesChat.js/ia.js) para que
// el cliente (mostrar el costo antes de confirmar) y el servidor (cobrar de
// verdad) usen EXACTAMENTE la misma función — nunca dos números que puedan
// desincronizarse. El servidor siempre vuelve a calcularla desde el número
// real de reactivos de la propuesta ya saneada; el cliente solo la usa para
// mostrar el costo, nunca para decidir el cobro.
export function calcularTarifaExamen(numReactivos) {
  // Tabla comercial DEFINITIVA (corrección del PO, 23-ago-2026, sobre una
  // escala duplicada del mismo día que quedó descartada): 1–10→8,
  // 11–20→10, 21–30→12, 31–40→14, 41–50→16 créditos.
  const n = Math.max(1, Number(numReactivos) || 1)
  if (n <= 10) return 8
  if (n <= 20) return 10
  if (n <= 30) return 12
  if (n <= 40) return 14
  if (n <= 50) return 16
  // Más de 50 reactivos no es alcanzable hoy desde el chat (MAX_REACTIVOS
  // de sanearPropuestaAccionChat lo topa en 10) — se deja la MISMA
  // progresión (2 créditos cada 10 reactivos más) por si ese tope cambia
  // algún día.
  return 16 + 2 * Math.ceil((n - 50) / 10)
}
