// Optional per-activity weighting (PONDERACIÓN) for parcial averages.
//
// Default behaviour (no weighting): every activity in the parcial is worth
// the same — the parcial average is the simple mean of the graded ones.
//
// When the subject has `ponderacionActivada` AND at least one activity of the
// parcial has a positive `pesoCalificacion` (0–10, assigned by the teacher so
// the parcial adds up to 10), the average becomes the weighted mean
// Σ(nota·peso)/Σ(peso) over GRADED activities — ungraded ones don't drag the
// average down, mirroring the simple-mean behaviour.

// Per-parcial activation. The subject's `ponderacionParciales` map
// ({ '1': true, '2': false … }) wins when it has an entry for the parcial;
// otherwise the legacy subject-wide `ponderacionActivada` flag applies to all.
export function ponderacionActivaEnParcial(subject, parcial) {
  const map = subject?.ponderacionParciales
  if (map && map[String(parcial)] !== undefined) return !!map[String(parcial)]
  return !!subject?.ponderacionActivada
}

export const pesoDe = (a) => {
  const n = parseFloat(a?.pesoCalificacion)
  return isNaN(n) || n < 0 ? 0 : n
}

export const pesoTotal = (acts) =>
  parseFloat(acts.reduce((s, a) => s + pesoDe(a), 0).toFixed(2))

// acts and grades are parallel arrays; grades holds normalized 0–10 numbers
// or null for ungraded. Returns a number or null.
export function promedioParcial(acts, grades, ponderacionOn) {
  const usePesos = ponderacionOn && acts.some((a) => pesoDe(a) > 0)
  if (usePesos) {
    let sg = 0
    let sw = 0
    acts.forEach((a, i) => {
      const g = grades[i]
      const w = pesoDe(a)
      if (g !== null && g !== undefined && w > 0) {
        sg += g * w
        sw += w
      }
    })
    return sw > 0 ? sg / sw : null
  }
  const valid = grades.filter((g) => g !== null && g !== undefined)
  return valid.length ? valid.reduce((x, y) => x + y, 0) / valid.length : null
}
