// Rúbricas de evaluación para actividades entregables.
//
// Modelo (guardado en bancoRubricas/{id} y como COPIA en activities/{id}.rubrica):
//   {
//     titulo: string,
//     descripcion: string,                       // descripción de la tarea (opcional)
//     niveles: [{ nombre, porcentaje }],         // 3–5, el primero siempre 100%
//     criterios: [{                              // 2–6, los pesos suman exactamente 10
//       nombre: string,
//       peso: number,                            // puntos del total de 10 que vale este criterio
//       puntos: [number],                        // puntos por nivel — derivados de peso×porcentaje, editables
//       descriptores: [string],                  // un descriptor por nivel
//     }],
//   }
//
// La actividad guarda una copia (snapshot): editar la rúbrica en el banco NUNCA
// cambia actividades ya creadas ni calificaciones ya dadas.
//
// La evaluación de un alumno se guarda en submissions/{id}.rubricaEval como un
// arreglo de índices de nivel (uno por criterio, null = sin elegir).

export const RUBRICA_TOTAL = 10
export const MIN_CRITERIOS = 2
export const MAX_CRITERIOS = 6
export const MIN_NIVELES = 3
export const MAX_NIVELES = 5

export const round1 = (n) => Math.round(n * 10) / 10

// Lista de cotejo: variante de rúbrica con UN solo nivel. Cada criterio vale
// unos puntos; al calificar, el docente marca (cumple → suma sus puntos) o deja
// vacío (no cumple → 0). Se guarda como una rúbrica con `tipo: 'cotejo'`,
// `niveles: [{ nombre, porcentaje: 100 }]` y un valor de puntos por criterio.
export const COTEJO_NIVEL = 'Nivel de desempeño'
export const esCotejo = (r) => r?.tipo === 'cotejo'

// Color FIJO por tipo de instrumento: azul = rúbrica, violeta = lista de cotejo.
// Deliberadamente NO usa `--accent`: el acento cambia con la paleta de la
// asignatura (azul, teal, morado…), así que la etiqueta de rúbrica se confundía
// con la de lista de cotejo. La etiqueta identifica el TIPO, no la asignatura,
// y por eso conserva siempre el mismo par de colores.
export const instrumentoColors = (r) => (esCotejo(r)
  ? { badge: 'bg-violet-100 text-violet-700', border: 'border-violet-500', bg: 'bg-violet-50', icon: 'text-violet-600', text: 'text-violet-700' }
  : { badge: 'bg-blue-100 text-blue-700', border: 'border-blue-500', bg: 'bg-blue-50', icon: 'text-blue-600', text: 'text-blue-700' })

// Reparte `total` puntos en partes iguales entre `n` casillas; la última
// absorbe el residuo de redondeo para que la suma sea exactamente `total`.
export function repartirPuntos(total, n) {
  const base = round1(total / n)
  const partes = Array.from({ length: n }, () => base)
  partes[n - 1] = round1(total - base * (n - 1))
  return partes
}

// Reparte los 10 puntos en partes iguales entre los criterios; el último
// absorbe el residuo de redondeo para que la suma sea exactamente 10.
export function pesosEquitativos(numCriterios) {
  return repartirPuntos(RUBRICA_TOTAL, numCriterios)
}

// Total de una evaluación con rúbrica. Devuelve null mientras falte algún
// criterio por elegir (la calificación solo existe con la rúbrica completa).
export function totalRubrica(rubrica, seleccion) {
  if (!rubrica?.criterios?.length || !Array.isArray(seleccion)) return null
  // Lista de cotejo: cada criterio marcado (seleccion[i] === 0) suma sus puntos;
  // vacío (null) suma 0. Siempre hay total (aunque sea 0).
  if (esCotejo(rubrica)) {
    let total = 0
    for (let i = 0; i < rubrica.criterios.length; i++) {
      if (seleccion[i] === 0) total += rubrica.criterios[i].puntos?.[0] ?? 0
    }
    return round1(total)
  }
  let total = 0
  for (let i = 0; i < rubrica.criterios.length; i++) {
    const nivel = seleccion[i]
    if (nivel == null) return null
    total += rubrica.criterios[i].puntos?.[nivel] ?? 0
  }
  return round1(total)
}

// Puntos máximos de una lista de cotejo (suma de los puntos de todos los
// criterios) — el "sobre cuánto" real (≤ 10).
export function totalCotejoMax(rubrica) {
  if (!rubrica?.criterios?.length) return 0
  return round1(rubrica.criterios.reduce((s, c) => s + (c.puntos?.[0] || 0), 0))
}

// Valor en PUNTOS de un nivel (sobre 10): 100% → 10, 80% → 8… El porcentaje
// sigue siendo el campo almacenado (compatibilidad con rúbricas ya guardadas);
// toda la UI habla en puntos.
export function valorNivel(nivel) {
  return round1((parseFloat(nivel?.porcentaje) || 0) / 10)
}

// Valida una rúbrica NORMALIZADA (números, no strings de inputs). Devuelve el
// primer error encontrado como texto para el docente, o null si todo está bien.
//
// Modelo de puntos (espejo de la tabla del editor):
//  - El primer nivel vale 10 puntos, fijo. Los demás son editables, siempre
//    menores que el nivel anterior y mayores que 0.
//  - Cada celda criterio×nivel tiene puntos editables, sin subir de izquierda
//    a derecha dentro del renglón.
//  - Cada COLUMNA debe sumar exactamente los puntos de su nivel (la primera
//    suma 10 forzosamente — así todo-en-el-máximo da calificación de 10).
// Valida una lista de cotejo NORMALIZADA. Cada criterio vale unos puntos; la
// suma debe dar EXACTAMENTE 10 — mismo criterio que la rúbrica (A09, decisión
// del PO): antes se aceptaba una suma menor (p.ej. 8), y como la interfaz
// rotula el total fijo como "/ 10" (RubricaGradeTable.jsx), un alumno que
// cumplía TODOS los criterios de un cotejo de 8 sacaba 8 sobre una actividad
// de 10 sin que nadie se lo dijera. Dos instrumentos que persiguen el mismo
// objetivo no deben tener dos comportamientos distintos.
export function validarCotejo(r) {
  if (!r.titulo) return 'Escribe el nombre de la lista de cotejo'
  const cr = r.criterios || []
  if (cr.length < MIN_CRITERIOS || cr.length > MAX_CRITERIOS) {
    return `La lista de cotejo debe tener entre ${MIN_CRITERIOS} y ${MAX_CRITERIOS} criterios`
  }
  for (let ci = 0; ci < cr.length; ci++) {
    const c = cr[ci]
    if (!c.nombre) return `Escribe el nombre del criterio ${ci + 1}`
    if (!(c.puntos?.[0] > 0)) return `Los puntos del criterio "${c.nombre || ci + 1}" deben ser mayores a 0`
  }
  const suma = round1(cr.reduce((s, c) => s + (c.puntos[0] || 0), 0))
  if (suma !== RUBRICA_TOTAL) return `Los puntos suman ${suma} — deben sumar exactamente ${RUBRICA_TOTAL}`
  return null
}

export function validarRubrica(r) {
  if (esCotejo(r)) return validarCotejo(r)
  if (!r.titulo) return 'Escribe el nombre de la rúbrica'
  const nv = r.niveles || []
  if (nv.length < MIN_NIVELES || nv.length > MAX_NIVELES) {
    return `La rúbrica debe tener entre ${MIN_NIVELES} y ${MAX_NIVELES} niveles de desempeño`
  }
  if (nv.some((n) => !n.nombre)) return 'Todos los niveles necesitan un nombre'
  const valores = nv.map(valorNivel)
  if (valores[0] !== RUBRICA_TOTAL) return `El primer nivel siempre vale ${RUBRICA_TOTAL} puntos`
  for (let j = 1; j < nv.length; j++) {
    // Solo el nivel MÁS BAJO puede valer 0 — para evaluar en cero a quien no
    // entrega nada. Los intermedios deben ser mayores a 0.
    if (valores[j] < 0) return `Los puntos del nivel "${nv[j].nombre}" no pueden ser negativos`
    if (valores[j] === 0 && j !== nv.length - 1) {
      return `Solo el nivel más bajo puede valer 0 — "${nv[j].nombre}" debe ser mayor a 0`
    }
    if (valores[j] >= valores[j - 1]) {
      return `Los puntos del nivel "${nv[j].nombre}" (${valores[j]}) deben ser menores que los de "${nv[j - 1].nombre}" (${valores[j - 1]})`
    }
  }
  const cr = r.criterios || []
  if (cr.length < MIN_CRITERIOS || cr.length > MAX_CRITERIOS) {
    return `La rúbrica debe tener entre ${MIN_CRITERIOS} y ${MAX_CRITERIOS} criterios`
  }
  for (let ci = 0; ci < cr.length; ci++) {
    const c = cr[ci]
    if (!c.nombre) return `Escribe el nombre del criterio ${ci + 1}`
    if (c.puntos.length !== nv.length) return `Los puntos del criterio "${c.nombre}" no coinciden con los niveles`
    if (c.puntos[0] <= 0) return `Los puntos de "${c.nombre}" en "${nv[0].nombre}" deben ser mayores a 0`
    for (let ni = 1; ni < c.puntos.length; ni++) {
      if (c.puntos[ni] < 0) return `Los puntos de "${c.nombre}" no pueden ser negativos`
      if (c.puntos[ni] > c.puntos[ni - 1]) {
        return `En "${c.nombre}", los puntos de "${nv[ni].nombre}" no pueden ser mayores que los de "${nv[ni - 1].nombre}"`
      }
    }
  }
  for (let j = 0; j < nv.length; j++) {
    const suma = round1(cr.reduce((s, c) => s + (c.puntos[j] || 0), 0))
    if (Math.abs(suma - valores[j]) > 0.01) {
      return j === 0
        ? `La columna "${nv[0].nombre}" suma ${suma} — debe sumar exactamente ${RUBRICA_TOTAL}`
        : `La columna "${nv[j].nombre}" suma ${suma} — debe sumar ${valores[j]} (los puntos de ese nivel)`
    }
  }
  return null
}

// ── Propuesta de IA → instrumento válido ────────────────────────────────────
// La IA propone SOLO contenido pedagógico (títulos, nombres de criterios,
// nombres de niveles y descriptores). Los NÚMEROS los pone Evalúa Fácil aquí,
// con el mismo reparto que hace el botón "Repartir en partes iguales" del
// editor: la IA nunca es fuente de verdad de pesos, totales ni estructura.
//
// El resultado entra al editor como cualquier borrador: el docente lo revisa,
// lo edita y lo guarda. `validarRubrica` se sigue corriendo ahí en cada tecla
// —nada de esto se salta la validación existente.

// Puntos de cada nivel según cuántos niveles proponga la IA. El primero
// siempre vale 10 (regla del modelo) y de ahí bajan. La escala de 4 es la
// misma que trae una rúbrica nueva en el editor (Excelente 10 / Bueno 8 /
// Suficiente 6 / Insuficiente 5), para que lo generado y lo hecho a mano se
// vean igual.
const VALORES_POR_NIVELES = {
  3: [10, 7, 5],
  4: [10, 8, 6, 5],
  5: [10, 8, 6, 4, 2],
}

const limpiar = (v, max) => String(v ?? '').trim().slice(0, max)

// Acota una lista de textos al rango permitido por el modelo.
function acotar(lista, min, max) {
  const items = (Array.isArray(lista) ? lista : []).slice(0, max)
  while (items.length < min) items.push('')
  return items
}

// `propuesta` = { titulo, descripcion, niveles: [nombre], criterios: [{ nombre, descriptores: [texto] }] }
export function rubricaDesdePropuesta(propuesta) {
  const nombresNivel = acotar(propuesta?.niveles, MIN_NIVELES, MAX_NIVELES).map((n) => limpiar(n, 40))
  const valores = VALORES_POR_NIVELES[nombresNivel.length]
  const criteriosIA = acotar(propuesta?.criterios, MIN_CRITERIOS, MAX_CRITERIOS)
  const n = criteriosIA.length

  // Una repartición por COLUMNA: cada nivel reparte sus propios puntos entre
  // los criterios, así cada columna suma exactamente lo que debe (que es lo
  // que exige validarRubrica) sin depender del redondeo de otra.
  const columnas = valores.map((valor) => repartirPuntos(valor, n))

  return {
    tipo: 'rubrica',
    titulo: limpiar(propuesta?.titulo, 120),
    descripcion: limpiar(propuesta?.descripcion, 300),
    niveles: nombresNivel.map((nombre, j) => ({ nombre, porcentaje: round1(valores[j] * 10) })),
    criterios: criteriosIA.map((c, i) => {
      const puntos = columnas.map((col) => col[i])
      return {
        nombre: limpiar(c?.nombre, 200),
        peso: puntos[0],
        puntos,
        descriptores: acotar(c?.descriptores, nombresNivel.length, nombresNivel.length)
          .map((d) => limpiar(d, 300)),
      }
    }),
  }
}

// `propuesta` = { titulo, descripcion, criterios: [{ nombre }] }
export function cotejoDesdePropuesta(propuesta) {
  const criteriosIA = acotar(propuesta?.criterios, MIN_CRITERIOS, MAX_CRITERIOS)
  const pesos = pesosEquitativos(criteriosIA.length)
  return {
    tipo: 'cotejo',
    titulo: limpiar(propuesta?.titulo, 120),
    descripcion: limpiar(propuesta?.descripcion, 300),
    niveles: [{ nombre: COTEJO_NIVEL, porcentaje: 100 }],
    criterios: criteriosIA.map((c, i) => ({
      nombre: limpiar(c?.nombre, 200),
      peso: pesos[i],
      puntos: [pesos[i]],
      descriptores: [''],
    })),
  }
}

// ── Trazabilidad de lo generado con IA (regla transversal T.8) ──────────────
// Vive SOLO en la copia que guarda la actividad. `bancoRubricas` no se toca:
// una rúbrica del banco es reutilizable en otras actividades, y la traza es de
// ESTA generación concreta — meterla ahí la volvería mentira en cuanto alguien
// reutilizara la rúbrica.
//
// Qué conserva y por qué:
//   · actividadPadreId — la fuente inmediata. Es lo que permite auditar la
//     regla de no aislamiento: toda rúbrica generada tuvo un padre real.
//   · clase — si el padre fue un entregable o una observación.
//   · procedenciaCriterios — de dónde salieron. Hoy siempre 'actividad_padre':
//     no existe Universo Curricular, así que ningún criterio puede alegar
//     origen curricular (decisión de producto del 10-ago-2026).
//   · marcoCurricular — null mientras no exista el Universo. El campo nace
//     desde ahora para que el día que exista no haya rúbricas viejas mudas.
//   · editadaPorDocente — si el docente cambió la propuesta antes de
//     guardarla. Es la única medida real de si la IA propone bien.

// Compara la propuesta con lo que el docente terminó guardando. Solo mira lo
// que la IA propuso (textos y estructura); los puntos los pone EF, así que un
// cambio de puntos también cuenta como edición del docente.
export function propuestaFueEditada(propuesta, guardada) {
  if (!propuesta || !guardada) return false
  const huella = (r) => JSON.stringify({
    titulo: (r.titulo || '').trim(),
    descripcion: (r.descripcion || '').trim(),
    niveles: (r.niveles || []).map((n) => (n.nombre || '').trim()),
    criterios: (r.criterios || []).map((c) => ({
      nombre: (c.nombre || '').trim(),
      puntos: (c.puntos || []).map((p) => round1(parseFloat(p) || 0)),
      descriptores: (c.descriptores || []).map((d) => (d || '').trim()),
    })),
  })
  return huella(propuesta) !== huella(guardada)
}

export function trazaIA({ operacion, actividadPadreId, clase, propuesta, guardada, generadoEn }) {
  return {
    operacion,                                  // 'rubrica' | 'cotejo'
    actividadPadreId,                           // la fuente inmediata
    clase,                                      // 'entregable' | 'observacion'
    procedenciaCriterios: 'actividad_padre',
    marcoCurricular: null,                      // no existe Universo Curricular todavía
    editadaPorDocente: propuestaFueEditada(propuesta, guardada),
    generadoEn: generadoEn || null,
  }
}

// Copia limpia para guardar dentro de la actividad (sin campos del banco).
export function snapshotRubrica(r) {
  return {
    tipo: r.tipo || 'rubrica',
    titulo: r.titulo,
    descripcion: r.descripcion || '',
    niveles: r.niveles.map((n) => ({ nombre: n.nombre, porcentaje: n.porcentaje })),
    criterios: r.criterios.map((c) => ({
      nombre: c.nombre,
      peso: c.peso,
      puntos: [...c.puntos],
      descriptores: [...c.descriptores],
    })),
  }
}
