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
function intentarSopaEnTamano(palabras, size) {
  const orden = palabras.map((p, i) => i).sort((a, b) => palabras[b].length - palabras[a].length)
  const grid = Array.from({ length: size }, () => Array(size).fill(null))
  const posiciones = new Array(palabras.length)

  function colocarDesde(idx) {
    if (idx >= orden.length) return true
    const i = orden[idx]
    const palabra = palabras[i]
    const candidatos = []
    for (let fila = 0; fila < size; fila++) {
      for (let col = 0; col < size; col++) {
        for (const [dr, dc] of DIRECCIONES) {
          if (cabeEn(grid, size, palabra, fila, col, dr, dc)) candidatos.push([fila, col, dr, dc])
        }
      }
    }
    // Aleatoriza para que reintentos sucesivos exploren rutas distintas.
    for (let k = candidatos.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [candidatos[k], candidatos[j]] = [candidatos[j], candidatos[k]]
    }
    for (const [fila, col, dr, dc] of candidatos) {
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
// Devuelve { size, grid, palabras: [{ index, fila, col, dirFila, dirCol, longitud }] }
function construirSopaDeLetras(palabrasNormalizadas) {
  const maxLongitud = Math.max(...palabrasNormalizadas.map((p) => p.length))
  let size = Math.max(maxLongitud, Math.ceil(Math.sqrt(palabrasNormalizadas.reduce((s, p) => s + p.length, 0) * 1.8)))
  size = Math.max(size, 8)
  const TOPE_SIZE = 20

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
// Coloca palabras cruzándose por letras compartidas. La primera palabra
// (la más larga) se coloca horizontal al centro; el resto se intenta cruzar
// con alguna ya colocada, y si no hay cruce posible se intenta como
// arranque independiente en una zona libre.
// Tope de pasos de backtracking por intento — sin esto, un intento con
// palabras que casi no comparten letras puede explorar un árbol
// combinatorio enorme y colgarse varios minutos (reproducido con 20
// palabras cortas sin cruces: un solo intento no terminaba en 40s). Al
// agotar el tope se abandona ESTE intento (return false) y el llamador
// (intentarSopaEnTamano/construirCrucigrama) reintenta con otra
// distribución aleatoria o un tamaño mayor — igual que un intento que
// simplemente no encontró acomodo.
const TOPE_PASOS_POR_INTENTO = 300

function intentarCrucigramaEnTamano(palabras, size) {
  const orden = palabras.map((p, i) => i).sort((a, b) => palabras[b].length - palabras[a].length)
  const grid = Array.from({ length: size }, () => Array(size).fill(null))
  const posiciones = new Array(palabras.length)
  let pasos = 0

  function cabeCrucigrama(palabra, fila, col, horizontal) {
    const filaFinal = horizontal ? fila : fila + palabra.length - 1
    const colFinal = horizontal ? col + palabra.length - 1 : col
    if (fila < 0 || col < 0 || filaFinal >= size || colFinal >= size) return false
    // Celda inmediatamente antes/después de la palabra debe estar vacía
    // (para no pegar dos palabras paralelas sin separación).
    if (horizontal) {
      if (col > 0 && grid[fila][col - 1]) return false
      if (colFinal + 1 < size && grid[fila][colFinal + 1]) return false
    } else {
      if (fila > 0 && grid[fila - 1][col]) return false
      if (filaFinal + 1 < size && grid[filaFinal + 1][col]) return false
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
        // Celda vacía: las perpendiculares inmediatas deben estar libres
        // también, para no crear palabras accidentales pegadas.
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
      const r = horizontal ? fila : fila + i
      const c = horizontal ? col + i : col
      grid[r][c] = palabra[i]
    }
  }

  function quitar(palabra, fila, col, horizontal, letrasPrevias) {
    for (let i = 0; i < palabra.length; i++) {
      const r = horizontal ? fila : fila + i
      const c = horizontal ? col + i : col
      grid[r][c] = letrasPrevias[i]
    }
  }

  function candidatosPara(idx, palabra) {
    const candidatos = []
    if (idx === 0) {
      const fila = Math.floor(size / 2)
      const col = Math.max(0, Math.floor((size - palabra.length) / 2))
      candidatos.push([fila, col, true])
      return candidatos
    }
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const letra = grid[r][c]
        if (!letra) continue
        for (let i = 0; i < palabra.length; i++) {
          if (palabra[i] !== letra) continue
          candidatos.push([r - i, c, true])
          candidatos.push([r, c - i, false])
        }
      }
    }
    // Respaldo: si no hay (o no alcanzan) cruces reales con lo ya colocado,
    // se permite un arranque independiente en una zona libre de la
    // cuadrícula — sin esto, un grupo de palabras sin letras en común entre
    // sí nunca lograba construir el crucigrama (backtracking agotaba TODAS
    // las combinaciones y siempre fallaba). Se agregan DESPUÉS de los
    // candidatos con cruce, para que el backtracking los prefiera primero.
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        candidatos.push([r, c, true])
        candidatos.push([r, c, false])
      }
    }
    return candidatos
  }

  function colocarDesde(idx) {
    if (idx >= orden.length) return true
    if (++pasos > TOPE_PASOS_POR_INTENTO) return false
    const i = orden[idx]
    const palabra = palabras[i]
    let candidatos = candidatosPara(idx, palabra)
    for (let k = candidatos.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [candidatos[k], candidatos[j]] = [candidatos[j], candidatos[k]]
    }
    for (const [fila, col, horizontal] of candidatos) {
      const chk = cabeCrucigrama(palabra, fila, col, horizontal)
      if (!chk) continue
      const letrasPrevias = []
      for (let n = 0; n < palabra.length; n++) {
        const r = horizontal ? fila : fila + n
        const c = horizontal ? col + n : col
        letrasPrevias.push(grid[r][c])
      }
      colocar(palabra, fila, col, horizontal)
      posiciones[i] = { fila, col, horizontal, longitud: palabra.length }
      if (colocarDesde(idx + 1)) return true
      quitar(palabra, fila, col, horizontal, letrasPrevias)
      posiciones[i] = null
    }
    return false
  }

  if (!colocarDesde(0)) return { ok: false }
  return { ok: true, grid, posiciones }
}

// Numeración estándar de crucigrama: recorre la cuadrícula fila por fila,
// columna por columna; una celda ocupada obtiene número nuevo si empieza una
// palabra horizontal y/o vertical (celda anterior en esa dirección vacía).
function numerarCrucigrama(grid, size, posiciones, palabras) {
  let siguienteNumero = 1
  const numeroPorCelda = {}
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!grid[r][c]) continue
      const iniciaH = (c === 0 || !grid[r][c - 1]) && c + 1 < size && grid[r][c + 1]
      const iniciaV = (r === 0 || !grid[r - 1][c]) && r + 1 < size && grid[r + 1][c]
      if (iniciaH || iniciaV) {
        numeroPorCelda[`${r}-${c}`] = siguienteNumero++
      }
    }
  }
  return posiciones.map((pos, index) => ({
    index,
    ...pos,
    numero: numeroPorCelda[`${pos.fila}-${pos.col}`] ?? null,
  }))
}

// palabrasNormalizadas: string[] ya normalizados. Devuelve
// { size, celdas (grid con letra o null), palabras: [{ index, fila, col, horizontal, longitud, numero }] }
function construirCrucigrama(palabrasNormalizadas) {
  const maxLongitud = Math.max(...palabrasNormalizadas.map((p) => p.length))
  let size = Math.max(maxLongitud + 3, 10)
  const TOPE_SIZE = 22

  while (size <= TOPE_SIZE) {
    for (let intento = 0; intento < MAX_INTENTOS_POR_TAMANO; intento++) {
      const r = intentarCrucigramaEnTamano(palabrasNormalizadas, size)
      if (r.ok) {
        return {
          size,
          celdas: r.grid,
          palabras: numerarCrucigrama(r.grid, size, r.posiciones, palabrasNormalizadas),
        }
      }
    }
    size++
  }
  return null
}

module.exports = { construirSopaDeLetras, construirCrucigrama, normalizarInterno: { letraAleatoria } }
