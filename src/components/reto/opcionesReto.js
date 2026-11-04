// Reto Exprés · cómo se ve cada opción, igual en el proyector y en el celular: una letra y un color fijos por posición,
// para que el grupo diga «la B» y todos miren la misma. El color nunca es la única pista: siempre va con la letra.
import { DURACIONES_RETO_SEG, textoDuracion } from '../../utils/retoExpres'

export const COLORES_OPCION = ['#2563eb', '#16a34a', '#b45309', '#9333ea', '#dc2626', '#0f766e']

export const letraOpcion = (i) => String.fromCharCode(65 + i)

/** Texto de la opción tal como se lee en voz alta («Verdadero» / «Falso» para V/F). */
export const textoOpcion = (o) => o?.texto || (o?.id === 'v' ? 'Verdadero' : o?.id === 'f' ? 'Falso' : '')

/** Segundos que se muestran en un contador (redondeo hacia arriba: «1» hasta que de verdad llega a cero). */
export const segundosRestantes = (ms) => (Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : null)

/** Cómo se lee el contador: «45» por debajo de un minuto y «2:30» desde un minuto (4-nov-2026). */
export function textoContador(segundos) {
  if (!Number.isFinite(segundos)) return ''
  if (segundos < 60) return String(segundos)
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`
}

/** Opciones del selector de tiempo (las mismas duraciones que valida el servidor). */
export const OPCIONES_TIEMPO_RETO = DURACIONES_RETO_SEG.map((s) => ({ value: s, label: textoDuracion(s) }))
