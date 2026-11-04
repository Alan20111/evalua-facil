// Reto Exprés · cómo se ve cada opción, igual en el proyector y en el celular: una letra y un color fijos por posición,
// para que el grupo diga «la B» y todos miren la misma. El color nunca es la única pista: siempre va con la letra.
export const COLORES_OPCION = ['#2563eb', '#16a34a', '#b45309', '#9333ea', '#dc2626', '#0f766e']

export const letraOpcion = (i) => String.fromCharCode(65 + i)

/** Texto de la opción tal como se lee en voz alta («Verdadero» / «Falso» para V/F). */
export const textoOpcion = (o) => o?.texto || (o?.id === 'v' ? 'Verdadero' : o?.id === 'f' ? 'Falso' : '')

/** Segundos que se muestran en un contador (redondeo hacia arriba: «1» hasta que de verdad llega a cero). */
export const segundosRestantes = (ms) => (Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : null)
