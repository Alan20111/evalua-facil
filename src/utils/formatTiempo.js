// Formatea segundos enteros como MM:SS o HH:MM:SS.
// Devuelve null si el valor no es un número válido.
export function formatTiempo(segundos) {
  if (segundos == null || !Number.isFinite(segundos) || segundos < 0) return null
  const s = Math.round(segundos)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`
}
