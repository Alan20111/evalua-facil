// Motor determinista (backtracking) para construir Crucigrama y Sopa de
// letras — decisión de producto #1 (aprobada): NUNCA usa IA/Anthropic, no
// pasa por el ledger de créditos. Vive aparte de functions/ia.js a propósito
// (functions/construirJuego.js es su propio onCall, sin secrets ni ledger).
//
// Recibe siempre palabras ya NORMALIZADAS (ver functions/_shared/normalizarPalabra.js,
// fuente: src/utils/normalizarPalabra.js) — mayúsculas, sin acentos, sin Ñ.
// Este archivo no sabe nada del contenido "bonito" (con acentos) que ve el
// docente/estudiante; eso lo conserva quien llama construirSopaDeLetras/
// construirCrucigrama junto al resultado.

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const MAX_INTENTOS_POR_TAMANO = 300

function letraAleatoria() {
  return LETRAS[Math.floor(Math.random() * LETRAS.length)]
}

// ── Sopa de letras ──────────────────────────────────────────────────────
// 8 direcciones: horizontal, vertical, diagonales y sus reversos.
const DIRECCIONES = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]

function cabeEn(grid, size, palabra, fila, col, dr, dc) {
  const filaFinal = fila + dr * (palabra.length - 1)
  const colFinal = col + dc * (palabra.length - 1)
  if (filaFinal < 0 || filaFinal >= size || colFinal < 0 || colFinal >= size) return false
  for (let i = 0; i < palabra.length; i++) {
    const r = fila + dr * i
    const c = col + dc * i
    const existente = grid[r][c]
    if (existente && existente !== palabra[i]) return false
  }
  return true
}

function colocar(grid, palabra, fila, col, dr, dc) {
  for (let i = 0; i < palabra.length; i++) {
    grid[fila + dr * i][col + dc * i] = palabra[i]
  }
}

// Intenta colocar todas las `palabras` (strings normalizados) en una
// cuadrícula de `size`x`size`. Devuelve { ok, grid, posiciones } — posiciones
// en el mismo orden que `palabras`, o ok:false si no logró colocarlas todas
// tras agotar los intentos de backtracking.
//
// Estrategia de dirección: intercalado round-robin.
// El sesgo original era geométrico: H/V tienen N×(N-L+1) posiciones válidas
// por dirección y las diagonales solo (N-L+1)², que en grids cuadrados puede
// ser 3-5× menos. El shuffle plano sobre todos los candidatos convertía esa
// diferencia de posiciones en una diferencia de probabilidad de dirección.
//
// Solución: agrupar por dirección, mezclar posiciones dentro de cada una, y
// luego intercalar en round-robin (un slot por dirección, en orden de
// dirección aleatorio). Así el primer candidato de cada dirección compite en
// igualdad — las colas más largas de H/V solo persisten como fallback.
// El conjunto total de candidatos probados es el mismo de antes; nada se
// descarta. La aleatoriedad se mantiene (distinto shuffle cada intento).
function intentarSopaEnTamano(palabras, size) {
  const orden = palabras.map((p, i) => i).sort((a, b) => palabras[b].length - palabras[a].length)
  const grid = Array.from({ length: size }, () => Array(size).fill(null))
  const posiciones = new Array(palabras.length)

  function colocarDesde(idx) {
    if (idx >= orden.length) return true
    const i = orden[idx]
    const palabra = palabras[i]

    // Recopilar candidatos agrupados por dirección; mezclar dentro de cada una.
    const porDir = DIRECCIONES.map(() => [])
    for (let fila = 0; fila < size; fila++) {
      for (let col = 0; col < size; col++) {
        for (let d = 0; d < DIRECCIONES.length; d++) {
          const [dr, dc] = DIRECCIONES[d]
          if (cabeEn(grid, size, palabra, fila, col, dr, dc)) porDir[d].push([fila, col])
        }
      }
    }
    for (const cands of porDir) {
      for (let k = cands.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [cands[k], cands[j]] = [cands[j], cands[k]]
      }
    }

    // Orden de dirección aleatorio para este intento.
    const dirOrden = DIRECCIONES.map((_, d) => d)
    for (let k = dirOrden.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [dirOrden[k], dirOrden[j]] = [dirOrden[j], dirOrden[k]]
    }

    // Intercalar: round-robin — un candidato por dirección por vuelta.
    // Cada vuelta los candidatos de cada dirección compiten en igualdad;
    // H/V simplemente tienen más vueltas (porque tienen más candidatos).
    const maxSlots = Math.max(...porDir.map((c) => c.length), 0)
    for (let slot = 0; slot < maxSlots; slot++) {
      for (const d of dirOrden) {
        if (slot >= porDir[d].length) continue
        const [fila, col] = porDir[d][slot]
        const [dr, dc] = DIRECCIONES[d]
        const respaldo = []
        for (let n = 0; n < palabra.length; n++) {
          const r = fila + dr * n, c = col + dc * n
          respaldo.push(grid[r][c])
        }
        colocar(grid, palabra, fila, col, dr, dc)
        posiciones[i] = { fila, col, dirFila: dr, dirCol: dc, longitud: palabra.length }
        if (colocarDesde(idx + 1)) return true
        for (let n = 0; n < palabra.length; n++) {
          const r = fila + dr * n, c = col + dc * n
          grid[r][c] = respaldo[n]
        }
        posiciones[i] = null
      }
    }
    return false
  }

  if (!colocarDesde(0)) return { ok: false }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!grid[r][c]) grid[r][c] = letraAleatoria()
    }
  }
  return { ok: true, grid, posiciones }
}

// palabrasNormalizadas: string[] ya normalizados (sin duplicados esperados).
// tamano: tamaño preferido por el docente (8 o 10). Si no se pasa, el
// algoritmo elige automáticamente entre 8 y 20.
// Devuelve { size, grid, palabras: [{ index, fila, col, dirFila, dirCol, longitud }] }
function construirSopaDeLetras(palabrasNormalizadas, tamano) {
  const maxLongitud = Math.max(...palabrasNormalizadas.map((p) => p.length))
  let size
  let TOPE_SIZE
  if (tamano) {
    // Tamaño exacto del docente — autoridad absoluta, sin expandir nunca.
    // juego.js ya rechazó palabras más largas que tamano antes de llegar aquí.
    size = tamano
    TOPE_SIZE = tamano
  } else {
    size = Math.max(maxLongitud, Math.ceil(Math.sqrt(palabrasNormalizadas.reduce((s, p) => s + p.length, 0) * 1.8)))
    size = Math.max(size, 8)
    TOPE_SIZE = 20
  }

  while (size <= TOPE_SIZE) {
    for (let intento = 0; intento < MAX_INTENTOS_POR_TAMANO; intento++) {
      const r = intentarSopaEnTamano(palabrasNormalizadas, size)
      if (r.ok) {
        return {
          size,
          grid: r.grid,
          palabras: r.posiciones.map((pos, index) => ({ index, ...pos })),
        }
      }
    }
    size++
  }
  return null // no cupieron ni al tope de tamaño — el llamador reporta el error
}

// ── Crucigrama ───────────────────────────────────────────────────────────
// Estrategia: construcción GREEDY por densidad de intersecciones.
//
// Principio: construir una RED de palabras, no una cadena.
// En cada paso se elige la palabra no colocada con MÁS posiciones de cruce
// disponibles (la más integrable en la red existente), y se coloca donde
// genera más cruces simultáneos. Esto produce estructuras densas con muchas
// palabras cruzando múltiples vecinas, evitando el patrón en escalera.
//
// Flujo:
// 1. Ordenar por longitud; primera palabra (más larga) horizontal al centro
//    con offset vertical aleatorio para diversidad entre intentos.
// 2. Greedy: para cada paso se busca la palabra con más candidatos de cruce.
//    La posición elegida maximiza: cruces_simultáneos × 50 - dist_al_centro × 2.
// 3. Verificación BFS de componente único.
// 4. Se generan N_CANDIDATOS soluciones válidas; se elige la de mayor
//    puntuación (cruces + densidad + compacidad + proporción).
// 5. Compactación final: elimina filas/columnas vacías (margen de 1 celda).

function intentarCrucigramaEnTamano(palabras, size) {
  const n = palabras.length
  const grid = Array.from({ length: size }, () => Array(size).fill(null))
  const posiciones = new Array(n).fill(null)

  function cabeCrucigrama(palabra, fila, col, horizontal) {
    const filaFin = horizontal ? fila : fila + palabra.length - 1
    const colFin = horizontal ? col + palabra.length - 1 : col
    if (fila < 0 || col < 0 || filaFin >= size || colFin >= size) return false
    if (horizontal) {
      if (col > 0 && grid[fila][col - 1]) return false
      if (colFin + 1 < size && grid[fila][colFin + 1]) return false
    } else {
      if (fila > 0 && grid[fila - 1][col]) return false
      if (filaFin + 1 < size && grid[filaFin + 1][col]) return false
    }
    let algunCruce = false
    for (let i = 0; i < palabra.length; i++) {
      const r = horizontal ? fila : fila + i
      const c = horizontal ? col + i : col
      const existente = grid[r][c]
      if (existente) {
        if (existente !== palabra[i]) return false
        algunCruce = true
      } else {
        if (horizontal) {
          if ((r > 0 && grid[r - 1][c]) || (r + 1 < size && grid[r + 1][c])) return false
        } else {
          if ((c > 0 && grid[r][c - 1]) || (c + 1 < size && grid[r][c + 1])) return false
        }
      }
    }
    return { algunCruce }
  }

  function colocar(palabra, fila, col, horizontal) {
    for (let i = 0; i < palabra.length; i++) {
      grid[horizontal ? fila : fila + i][horizontal ? col + i : col] = palabra[i]
    }
  }

  // Primera palabra: la más larga, horizontal, con offset vertical aleatorio
  const porLongitud = Array.from({ length: n }, (_, k) => k).sort((a, b) => palabras[b].length - palabras[a].length)
  const i0 = porLongitud[0]
  const p0 = palabras[i0]
  const dF = Math.round((Math.random() - 0.5) * Math.floor(size / 4))
  const fila0 = Math.max(1, Math.min(size - 2, Math.floor(size / 2) + dF))
  const col0 = Math.max(1, Math.min(size - p0.length - 1, Math.floor((size - p0.length) / 2)))
  colocar(p0, fila0, col0, true)
  posiciones[i0] = { fila: fila0, col: col0, horizontal: true, longitud: p0.length }

  const placed = new Set([i0])
  const unplaced = new Set(porLongitud.slice(1))

  // Candidatos de cruce de la palabra i con todas las ya colocadas.
  // Puntuación: cruces_simultáneos × 50 − distancia_al_centro × 2 + ruido.
  const cx = size / 2, cy = size / 2
  function getCandidatos(i) {
    const palabra = palabras[i]
    const seen = new Set()
    const cands = []
    for (const j of placed) {
      const { fila: fj, col: cj, horizontal: hj } = posiciones[j]
      const pj = palabras[j]
      const nuevaH = !hj
      for (let lj = 0; lj < pj.length; lj++) {
        const gr = hj ? fj : fj + lj
        const gc = hj ? cj + lj : cj
        for (let li = 0; li < palabra.length; li++) {
          if (palabra[li] !== pj[lj]) continue
          const nf = nuevaH ? gr : gr - li
          const nc = nuevaH ? gc - li : gc
          const key = `${nf},${nc},${nuevaH ? 1 : 0}`
          if (seen.has(key)) continue
          seen.add(key)
          const res = cabeCrucigrama(palabra, nf, nc, nuevaH)
          if (!res || !res.algunCruce) continue
          let nCruces = 0
          for (let k = 0; k < palabra.length; k++) {
            const r = nuevaH ? nf : nf + k
            const c = nuevaH ? nc + k : nc
            if (grid[r][c] === palabra[k]) nCruces++
          }
          const midR = nuevaH ? nf : nf + (palabra.length - 1) / 2
          const midC = nuevaH ? nc + (palabra.length - 1) / 2 : nc
          const dist = Math.sqrt((midR - cx) ** 2 + (midC - cy) ** 2)
          cands.push({ fila: nf, col: nc, horizontal: nuevaH, nCruces, score: nCruces * 50 - dist * 2 + Math.random() * 3 })
        }
      }
    }
    cands.sort((a, b) => b.score - a.score)
    return cands
  }

  // Greedy: en cada paso colocar la palabra con más candidatos (más integrable)
  const MAX_PASOS = 2000
  let pasos = 0
  while (unplaced.size > 0 && pasos++ < MAX_PASOS) {
    let mejorPalabra = -1, mejoresCands = [], mejorScore = -1
    for (const i of unplaced) {
      const cands = getCandidatos(i)
      const ws = cands.length > 0 ? cands.length * 10 + (cands[0]?.nCruces ?? 0) * 5 : 0
      if (ws > mejorScore) { mejorScore = ws; mejorPalabra = i; mejoresCands = cands }
    }
    if (mejorPalabra === -1 || mejoresCands.length === 0) return { ok: false }
    const { fila, col, horizontal } = mejoresCands[0]
    colocar(palabras[mejorPalabra], fila, col, horizontal)
    posiciones[mejorPalabra] = { fila, col, horizontal, longitud: palabras[mejorPalabra].length }
    placed.add(mejorPalabra)
    unplaced.delete(mejorPalabra)
  }
  if (unplaced.size > 0) return { ok: false }

  // Verificar conectividad BFS sobre el grafo de cruces
  const adj = Array.from({ length: n }, () => [])
  for (let a = 0; a < n; a++) {
    if (!posiciones[a]) continue
    for (let b = a + 1; b < n; b++) {
      if (!posiciones[b]) continue
      const pa = posiciones[a], pb = posiciones[b]
      if (pa.horizontal === pb.horizontal) continue
      const h = pa.horizontal ? pa : pb
      const v = pa.horizontal ? pb : pa
      if (v.col >= h.col && v.col < h.col + h.longitud &&
          h.fila >= v.fila && h.fila < v.fila + v.longitud) {
        adj[a].push(b); adj[b].push(a)
      }
    }
  }
  const visited = new Set([i0])
  const queue = [i0]
  while (queue.length) {
    for (const nx of adj[queue.shift()]) if (!visited.has(nx)) { visited.add(nx); queue.push(nx) }
  }
  if (visited.size !== n) return { ok: false }
  return { ok: true, grid, posiciones, i0 }
}

// Calidad de una solución: intersecciones, densidad, compacidad, proporción.
function puntuarSolucion(grid, posiciones, n, size) {
  const cruces = new Array(n).fill(0)
  let totalX = 0
  for (let a = 0; a < n; a++) {
    if (!posiciones[a]) continue
    for (let b = a + 1; b < n; b++) {
      if (!posiciones[b]) continue
      const pa = posiciones[a], pb = posiciones[b]
      if (pa.horizontal === pb.horizontal) continue
      const h = pa.horizontal ? pa : pb
      const v = pa.horizontal ? pb : pa
      if (v.col >= h.col && v.col < h.col + h.longitud && h.fila >= v.fila && h.fila < v.fila + v.longitud) {
        totalX++; cruces[a]++; cruces[b]++
      }
    }
  }
  let minR = size, maxR = -1, minC = size, maxC = -1, occ = 0
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!grid[r][c]) continue
      occ++
      if (r < minR) minR = r; if (r > maxR) maxR = r
      if (c < minC) minC = c; if (c > maxC) maxC = c
    }
  }
  const bH = maxR - minR + 1, bW = maxC - minC + 1
  const bArea = bH * bW
  const density = bArea > 0 ? occ / bArea : 0
  const ratio = bH > 0 && bW > 0 ? Math.max(bH / bW, bW / bH) : 10
  const w2 = cruces.filter(x => x >= 2).length
  const w3 = cruces.filter(x => x >= 3).length
  const w1 = cruces.filter(x => x === 1).length
  return totalX * 15 + w2 * 12 + w3 * 8 - w1 * 5 + density * 120 - bArea * 0.2 - Math.max(0, ratio - 2.0) * 25
}

// Compactación: elimina filas/columnas vacías conservando 1 celda de margen.
function compactarSolucion(grid, posiciones, size) {
  let minR = size, maxR = -1, minC = size, maxC = -1
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!grid[r][c]) continue
      if (r < minR) minR = r; if (r > maxR) maxR = r
      if (c < minC) minC = c; if (c > maxC) maxC = c
    }
  }
  if (maxR === -1) return { grid, posiciones, size }
  minR = Math.max(0, minR - 1); maxR = Math.min(size - 1, maxR + 1)
  minC = Math.max(0, minC - 1); maxC = Math.min(size - 1, maxC + 1)
  const nS = Math.max(maxR - minR + 1, maxC - minC + 1)
  const nG = Array.from({ length: nS }, (_, r) =>
    Array.from({ length: nS }, (_, c) => {
      const or = r + minR, oc = c + minC
      return or <= maxR && oc <= maxC ? (grid[or][oc] || null) : null
    })
  )
  const nP = posiciones.map(p => p ? { ...p, fila: p.fila - minR, col: p.col - minC } : null)
  return { grid: nG, posiciones: nP, size: nS }
}

// Numeración estándar de crucigrama: fila por fila, columna por columna;
// una celda ocupada recibe número si inicia una palabra H o V.
function numerarCrucigrama(grid, size, posiciones) {
  let sig = 1
  const nums = {}
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!grid[r][c]) continue
      const iniciaH = (c === 0 || !grid[r][c - 1]) && c + 1 < size && grid[r][c + 1]
      const iniciaV = (r === 0 || !grid[r - 1][c]) && r + 1 < size && grid[r + 1][c]
      if (iniciaH || iniciaV) nums[`${r}-${c}`] = sig++
    }
  }
  return posiciones.map((pos, index) => ({ index, ...pos, numero: nums[`${pos.fila}-${pos.col}`] ?? null }))
}

// Genera N_CANDIDATOS soluciones válidas y devuelve la de mayor puntuación,
// compactada. Sube de tamaño de grid solo si no logra ninguna solución.
function construirCrucigrama(palabrasNormalizadas) {
  const maxLong = Math.max(...palabrasNormalizadas.map(p => p.length))
  let size = Math.max(maxLong + 4, 12)
  const TOPE_SIZE = 24
  const N_CANDIDATOS = 20
  const MAX_INTENTOS = 400

  while (size <= TOPE_SIZE) {
    let mejor = null, mejorScore = -Infinity, validos = 0
    for (let intento = 0; intento < MAX_INTENTOS && validos < N_CANDIDATOS; intento++) {
      const r = intentarCrucigramaEnTamano(palabrasNormalizadas, size)
      if (!r.ok) continue
      validos++
      const score = puntuarSolucion(r.grid, r.posiciones, palabrasNormalizadas.length, size)
      if (score > mejorScore) { mejorScore = score; mejor = r }
    }
    if (mejor) {
      const c = compactarSolucion(mejor.grid, mejor.posiciones, size)
      return {
        size: c.size,
        celdas: c.grid,
        palabras: numerarCrucigrama(c.grid, c.size, c.posiciones),
      }
    }
    size++
  }
  return null
}

module.exports = { construirSopaDeLetras, construirCrucigrama, normalizarInterno: { letraAleatoria } }
