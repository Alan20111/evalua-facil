// Video interactivo · lógica PURA del reproductor del estudiante (fase 1).
//
// Aquí vive todo lo que decide qué puede hacer el estudiante con el video, sin
// React ni YouTube: qué pregunta toca, hasta dónde puede adelantar, qué pasa si
// salta, cómo se reanuda. Al ser funciones puras se prueban sin navegador
// (test/unidad.test.mjs). El componente solo les pasa lo que lee del reproductor.
//
// Vocabulario:
//   · posición (pos)   segundo en que está el reproductor ahora.
//   · maxVisto         el punto MÁS lejano que el estudiante alcanzó viendo el
//                      video de verdad. No se puede adelantar más allá de él.
//   · compuerta        una pregunta: el video se detiene al llegar a su `timestampSeg`
//                      y no sigue hasta que se responde.
//
// `respondida(p)` la inyecta quien llama (en la app es `estaRespondida` del
// runner, la MISMA regla de siempre: así no se duplica qué cuenta como respuesta).

// La pregunta sale al LLEGAR a su segundo, nunca antes (lo que el docente guardó es lo que el
// estudiante ve). El sondeo del reproductor (cada 100 ms) puede dejarla pasar hasta ~0,1 s; al
// detenerse, el video vuelve a su segundo exacto.
export const ADELANTO_PREGUNTA_SEG = 0
// Cuánto por encima de `maxVisto` se tolera antes de considerarlo un salto.
export const TOLERANCIA_SALTO_SEG = 1.5
// El avance entre dos lecturas no puede ser más de esto sobre el tiempo real
// transcurrido (velocidad 1× con holgura para el sondeo y el buffering).
export const FACTOR_AVANCE = 1.5
export const HOLGURA_AVANCE_SEG = 0.6
// Fracción del video que cuenta como «lo vio completo».
export const UMBRAL_VISTO = 0.95
// Tope del tiempo real que se acredita entre dos lecturas: si el navegador
// durmió la pestaña, no se regala ese rato.
export const MAX_DT_SEG = 5

const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def)
const acotar = (v, min, max) => Math.min(Math.max(v, min), max)

// Segundo de una pregunta, siempre dentro del video. Sin segundo válido, la
// pregunta va AL FINAL (se muestra al terminar), nunca se pierde.
export function segundoDePregunta(p, duracion) {
  const d = Math.max(0, num(duracion))
  const raw = p?.timestampSeg
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw)) || Number(raw) < 0) return d
  return Math.min(Number(raw), d)
}

// Preguntas en el orden del video. Con el mismo segundo, el orden original
// (`orden`) y luego el id: el resultado es estable y no depende del navegador.
export function ordenarPreguntasVideo(preguntas, duracion) {
  return (preguntas || [])
    .map((p, i) => ({ p, i, ts: segundoDePregunta(p, duracion) }))
    .sort((a, b) => (a.ts - b.ts)
      || (num(a.p.orden, a.i) - num(b.p.orden, b.i))
      || String(a.p.id).localeCompare(String(b.p.id)))
    .map(({ p, ts }) => ({ ...p, timestampSeg: ts }))
}

// Primera pregunta SIN responder cuyo segundo ya llegó (o está por llegar).
export function preguntaPendiente(ordenadas, respondida, pos) {
  const limite = num(pos) + ADELANTO_PREGUNTA_SEG
  return ordenadas.find((p) => !respondida(p) && p.timestampSeg <= limite) || null
}

// Antes de reproducir desde `pos`: ¿hay una pregunta que contestar primero?
// (caso típico: una pregunta en el segundo 0.)
export const antesDeReproducir = preguntaPendiente

// Primera pregunta sin responder que está MÁS ADELANTE, con los segundos que faltan.
export function siguientePregunta(ordenadas, respondida, pos) {
  const p = ordenadas.find((q) => !respondida(q) && q.timestampSeg > num(pos) + ADELANTO_PREGUNTA_SEG)
  return p ? { pregunta: p, enSeg: Math.max(0, p.timestampSeg - num(pos)) } : null
}

// Al terminar el video: la primera pregunta que siga sin responder (incluye las
// que están en el último segundo), o `null` si ya se puede entregar.
export function alTerminar(ordenadas, respondida) {
  return ordenadas.find((p) => !respondida(p)) || null
}

// Un salto solicitado por el estudiante (línea de tiempo, ±10 s): nunca pasa
// de lo que ya vio ni baja de 0.
export function acotarSalto(destino, maxVisto) {
  return acotar(num(destino), 0, Math.max(0, num(maxVisto)))
}

// Un tick del sondeo del reproductor. Decide si el avance cuenta, si hay un
// salto indebido o si toca una pregunta.
//
//   estado  { maxVisto, ultimaPos, ultimoT }      (ultimoT en ms; null la primera vez)
//   lectura { pos, ahora, jugando, visible, duracion, ordenadas, respondida, tasa? }
//
// Devuelve { accion, maxVisto, ultimaPos, ultimoT, irA?, pregunta? } con
// accion ∈ 'nada' | 'salto' | 'pregunta'.
export function tick(estado, lectura) {
  const { pos, ahora, jugando, visible, duracion, ordenadas, respondida, tasa = 1 } = lectura
  const p = acotar(num(pos), 0, Math.max(0, num(duracion)))
  const dt = estado.ultimoT == null ? 0 : acotar((ahora - estado.ultimoT) / 1000, 0, MAX_DT_SEG)
  let maxVisto = num(estado.maxVisto)
  const avance = p - num(estado.ultimaPos, p)
  const salida = (extra) => ({ accion: 'nada', maxVisto, ultimaPos: p, ultimoT: ahora, ...extra })

  // 1. Más allá de lo visto: es un salto, venga de donde venga (línea de tiempo,
  //    teclado, un clic en el propio video). Se corrige volviendo a `maxVisto`.
  const avanceNormal = avance > 0 && avance <= dt * tasa * FACTOR_AVANCE + HOLGURA_AVANCE_SEG
  const reproduciendoNormal = jugando && visible && avanceNormal
  if (p > maxVisto + TOLERANCIA_SALTO_SEG && !reproduciendoNormal) {
    return salida({ accion: 'salto', irA: maxVisto, ultimaPos: maxVisto })
  }

  // 2. Solo cuenta como «visto» lo que avanza reproduciéndose, con la pestaña
  //    visible y a un ritmo posible. Pausado, oculto o a saltos: no suma.
  if (reproduciendoNormal) maxVisto = Math.max(maxVisto, p)

  // 3. ¿Toca una pregunta? Solo mientras se reproduce: pausado no interrumpe.
  if (jugando) {
    const q = preguntaPendiente(ordenadas, respondida, p)
    if (q) return salida({ accion: 'pregunta', pregunta: q, irA: q.timestampSeg })
  }
  return salida({})
}

// Estado al volver a entrar a un intento ya empezado.
//   progreso  { maxVistoSeg, posicionSeg } | null
// Devuelve { maxVisto, posicion, pendiente, completado }:
//   · si hay una pregunta sin responder que el estudiante ya había alcanzado,
//     `pendiente` la trae y la posición vuelve a su segundo (no hay forma de
//     «saltársela» saliendo y entrando);
//   · `completado`: vio el video entero y no debe nada → va directo a entregar.
export function reanudar({ progreso, ordenadas, respondida, duracion }) {
  const d = Math.max(0, num(duracion))
  const maxVisto = acotar(num(progreso?.maxVistoSeg), 0, d)
  let posicion = acotar(num(progreso?.posicionSeg), 0, maxVisto)
  const pendiente = ordenadas.find((p) => !respondida(p) && p.timestampSeg <= maxVisto + ADELANTO_PREGUNTA_SEG) || null
  if (pendiente) posicion = Math.min(posicion, pendiente.timestampSeg)
  return {
    maxVisto,
    posicion,
    pendiente,
    completado: !pendiente && videoCompletado(maxVisto, d) && !alTerminar(ordenadas, respondida),
  }
}

export function videoCompletado(maxVisto, duracion, umbral = UMBRAL_VISTO) {
  const d = num(duracion)
  if (d <= 0) return false
  return num(maxVisto) >= d * umbral || d - num(maxVisto) <= 1
}

// 0–100 entero. Solo llega a 100 cuando de verdad se vio todo.
export function porcentajeVisto(maxVisto, duracion) {
  const d = num(duracion)
  if (d <= 0) return 0
  if (d - num(maxVisto) <= 1) return 100
  return Math.min(99, Math.floor((num(maxVisto) / d) * 100))
}

// 75 → «1:15»; 3725 → «1:02:05».
export function formatearTiempo(seg) {
  const s = Math.max(0, Math.round(num(seg)))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

// Cuántas preguntas faltan, para el contador y la pantalla final.
export function resumenRespuestas(ordenadas, respondida) {
  const total = ordenadas.length
  const contestadas = ordenadas.filter((p) => respondida(p)).length
  return { total, contestadas, pendientes: total - contestadas }
}
