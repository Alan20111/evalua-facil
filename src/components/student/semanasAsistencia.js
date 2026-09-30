// ─── Semanas visibles en Asistencias del estudiante — lógica pura ────────────
//
// Antes, una semana solo aparecía si tenía al menos un registro de asistencia,
// así que una semana sin columnas (el docente aún no pasa lista, asueto, alta
// tardía) desaparecía de la vista — incluida la semana ACTUAL (caso real:
// "Mtto impresoras y multif — 3D", 30-sep-2026).
//
// Regla (autorizada 30-sep-2026): las semanas salen del CALENDARIO del
// parcial, no de los registros:
//   · desde la semana en que empieza el parcial
//   · hasta la semana actual (o la del fin del parcial, si ya terminó)
//   · un parcial que aún no empieza no genera semanas
//   · nunca una semana posterior a la actual
// Además se conserva cualquier semana que ya tenga datos (hasta hoy), para que
// nada de lo que hoy se ve deje de verse.
//
// Solo decide QUÉ semanas se dibujan. No crea registros ni toca conteos.
// Fechas 'YYYY-MM-DD'; las cuentas se hacen en UTC para que la zona horaria
// del dispositivo no corra ningún día.
//
// Vive junto a AsistenciaSemanal.jsx (y no en src/utils) porque solo la usa
// esta vista: src/utils/** dispara el redespliegue de todas las Cloud
// Functions (deploy-functions.yml) y aquí no cambia nada del servidor.

const DIA_MS = 86400000

function aFecha(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function aISO(fecha) {
  return fecha.toISOString().slice(0, 10)
}

// Lunes (ISO) de la semana lunes→domingo que contiene `iso`.
export function lunesDe(iso) {
  const f = aFecha(iso)
  return aISO(new Date(f.getTime() - ((f.getUTCDay() + 6) % 7) * DIA_MS))
}

function rangoDelParcial(parcialesFechas, parcial) {
  const r = Array.isArray(parcialesFechas) ? parcialesFechas[parcial - 1] : null
  return r?.inicio && r?.fin ? r : null
}

// ¿El parcial ya empezó? Sin fechas configuradas no se puede saber: false.
export function parcialIniciado(parcialesFechas, parcial, hoyISO) {
  const r = rangoDelParcial(parcialesFechas, parcial)
  return !!r && r.inicio <= hoyISO
}

// Lunes de las semanas a dibujar para un parcial, de la más reciente a la más
// antigua. `fechasConDatos`: fechas de registros y de sesiones sin registro de
// ESE parcial (las futuras se ignoran).
export function semanasVisiblesParcial({ parcialesFechas, parcial, hoyISO, fechasConDatos = [] }) {
  const lunesHoy = lunesDe(hoyISO)
  const semanas = new Set()
  const r = rangoDelParcial(parcialesFechas, parcial)
  if (r && r.inicio <= hoyISO) {
    const tope = lunesDe(r.fin) < lunesHoy ? lunesDe(r.fin) : lunesHoy
    for (let l = lunesDe(r.inicio); l <= tope; l = aISO(new Date(aFecha(l).getTime() + 7 * DIA_MS))) semanas.add(l)
  }
  for (const f of fechasConDatos) {
    if (f && f <= hoyISO) semanas.add(lunesDe(f))
  }
  return [...semanas].filter((l) => l <= lunesHoy).sort((a, b) => b.localeCompare(a))
}
