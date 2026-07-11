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

// Reparte los 10 puntos en partes iguales entre los criterios; el último
// absorbe el residuo de redondeo para que la suma sea exactamente 10.
export function pesosEquitativos(numCriterios) {
  const base = round1(RUBRICA_TOTAL / numCriterios)
  const pesos = Array.from({ length: numCriterios }, () => base)
  pesos[numCriterios - 1] = round1(RUBRICA_TOTAL - base * (numCriterios - 1))
  return pesos
}

// Total de una evaluación con rúbrica. Devuelve null mientras falte algún
// criterio por elegir (la calificación solo existe con la rúbrica completa).
export function totalRubrica(rubrica, seleccion) {
  if (!rubrica?.criterios?.length || !Array.isArray(seleccion)) return null
  let total = 0
  for (let i = 0; i < rubrica.criterios.length; i++) {
    const nivel = seleccion[i]
    if (nivel == null) return null
    total += rubrica.criterios[i].puntos?.[nivel] ?? 0
  }
  return round1(total)
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
export function validarRubrica(r) {
  if (!r.titulo) return 'Escribe el nombre de la rúbrica'
  const nv = r.niveles || []
  if (nv.length < MIN_NIVELES || nv.length > MAX_NIVELES) {
    return `La rúbrica debe tener entre ${MIN_NIVELES} y ${MAX_NIVELES} niveles de desempeño`
  }
  if (nv.some((n) => !n.nombre)) return 'Todos los niveles necesitan un nombre'
  const valores = nv.map(valorNivel)
  if (valores[0] !== RUBRICA_TOTAL) return `El primer nivel siempre vale ${RUBRICA_TOTAL} puntos`
  for (let j = 1; j < nv.length; j++) {
    if (valores[j] <= 0) return `Los puntos del nivel "${nv[j].nombre}" deben ser mayores a 0`
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

// Copia limpia para guardar dentro de la actividad (sin campos del banco).
export function snapshotRubrica(r) {
  return {
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
