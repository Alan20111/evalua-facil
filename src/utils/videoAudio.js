// Video interactivo · audio del video (experimento). Lógica PURA, sin React ni YouTube.
//
// Contexto: YouTube ofrece doblajes automáticos y el reproductor incrustado
// arranca con la pista ORIGINAL. La API pública NO permite elegir la pista de
// audio; lo único disponible es el menú nativo del reproductor («Configuración →
// Pista de audio»), que solo aparece con los controles nativos (`controls: 1`).
// Por eso los controles nativos se encienden SOLO cuando el video no está en
// español, y nada de esto promete que el español esté disponible.
//
// No confundir: idioma de la interfaz (`hl`), subtítulos (`cc_*`) y pista de audio
// son tres cosas distintas; nada de aquí toca las dos primeras.

export const IDIOMA_AUDIO = { ESPANOL: 'es', OTRO: 'otro', DESCONOCIDO: 'desconocido' }

// Códigos de «sin dato» que Gemini puede devolver: NO son un idioma.
const SIN_DATO = new Set(['', 'ninguno', 'ninguna', 'none', 'null', 'und', 'unknown', 'desconocido', 'zxx', 'mul', 'n/a'])
// «es», «spa», «es-mx», «es_419»… (ISO 639-1/639-2 con región opcional).
const RE_CODIGO = /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})?$/

// Idioma hablado que Gemini detectó (`videoInteractivo.idioma`) → clase.
//   · español identificado → 'es'
//   · otro código válido   → 'otro'
//   · ausente, vacío, «ninguno» o algo que no es un código → 'desconocido'
// Un video 'desconocido' NUNCA se trata como si estuviera en inglés ni en otro idioma.
export function clasificarIdioma(idioma) {
  if (typeof idioma !== 'string') return IDIOMA_AUDIO.DESCONOCIDO
  const c = idioma.trim().toLowerCase()
  if (SIN_DATO.has(c) || !RE_CODIGO.test(c)) return IDIOMA_AUDIO.DESCONOCIDO
  const base = c.split(/[-_]/)[0]
  return base === 'es' || base === 'spa' ? IDIOMA_AUDIO.ESPANOL : IDIOMA_AUDIO.OTRO
}

// ¿Se muestran los controles nativos (menú de pista de audio)? Solo con un idioma
// identificado y distinto del español.
export function requiereControlesAudio(idioma) {
  return clasificarIdioma(idioma) === IDIOMA_AUDIO.OTRO
}

// Con los controles nativos el estudiante puede cambiar la velocidad. El avance
// solo cuenta como «visto» hasta cierto ritmo (videoProgreso.tick) y la regla de
// Firestore acepta como máximo 1.5× el tiempo real; a 2× el video se devolvería
// a cada rato y el progreso dejaría de guardarse. Hasta 1.25× no hay problema.
export const VELOCIDAD_MAX_CON_CONTROLES = 1.25

// Velocidad a la que debe quedar el reproductor: la pedida si no pasa del tope,
// el tope si lo rebasa. Una lectura inválida se trata como velocidad normal.
export function velocidadPermitida(pedida) {
  const v = Number(pedida)
  if (!Number.isFinite(v) || v <= 0) return 1
  return Math.min(v, VELOCIDAD_MAX_CON_CONTROLES)
}

// Una línea breve; no promete que el español esté disponible.
export const TEXTO_AYUDA_AUDIO = 'Si no escuchas el video en tu idioma, toca ⚙ → «Pista de audio» y elige otra, si está disponible.'

// Idioma a guardar en la actividad al terminar la generación: lo que devolvió
// Gemini, o `undefined` si no hay un valor útil (así no se pisa uno ya guardado).
export function idiomaParaGuardar(resultado) {
  const i = resultado?.generacion?.fuenteContenido?.idioma
  return typeof i === 'string' && i.trim() ? i.trim().toLowerCase().slice(0, 12) : undefined
}

// ── Saltos hechos con la barra nativa ─────────────────────────────────────────────────────
// Con los controles nativos el usuario puede arrastrar la barra de YouTube: un salto que la
// pantalla NO hizo y del que no se entera por sus propios botones. Esta función pura lo
// detecta comparando dónde está el reproductor con dónde estaba la lectura anterior:
// reproduciendo, la posición solo puede avanzar un poco (como en videoProgreso.tick) y nunca
// retroceder; en pausa no debería moverse. Lo que se salga de eso es un salto.
// Quien la usa ignora además los saltos que la propia pantalla acaba de pedir (ver
// `saltoPropioReciente` del hook), así que aquí no hace falta distinguirlos.
//   lectura  { pos, ultimaPos, ultimoT (ms; null la primera vez), ahora (ms), jugando, tasa? }
export const SALTO_ATRAS_SEG = 1
export const SALTO_PAUSA_SEG = 0.5
export function esSaltoExterno({ pos, ultimaPos, ultimoT, ahora, jugando, tasa = 1 }) {
  const p = Number(pos)
  const u = Number(ultimaPos)
  if (!Number.isFinite(p) || !Number.isFinite(u)) return false
  const dt = ultimoT == null ? 0 : Math.min(Math.max((Number(ahora) - Number(ultimoT)) / 1000, 0), 5)
  const avance = p - u
  if (avance < -SALTO_ATRAS_SEG) return true
  const ritmo = Number.isFinite(Number(tasa)) && Number(tasa) > 0 ? Number(tasa) : 1
  const maxAvance = jugando ? dt * ritmo * 1.5 + 0.6 : SALTO_PAUSA_SEG
  return avance > maxAvance
}
