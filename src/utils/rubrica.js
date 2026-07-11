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

export const NIVELES_DEFAULT = [
  { nombre: 'Excelente', porcentaje: 100 },
  { nombre: 'Bueno', porcentaje: 80 },
  { nombre: 'Suficiente', porcentaje: 60 },
  { nombre: 'Insuficiente', porcentaje: 50 },
]

export const round1 = (n) => Math.round(n * 10) / 10

// Puntos automáticos de un criterio: peso × porcentaje del nivel. El primer
// nivel (máximo) siempre vale el peso completo, para que una rúbrica toda en
// el nivel máximo sume exactamente 10.
export function puntosDerivados(peso, niveles) {
  const p = parseFloat(peso) || 0
  return niveles.map((nv, i) => (i === 0 ? round1(p) : round1((p * (parseFloat(nv.porcentaje) || 0)) / 100)))
}

export function nuevoCriterio(niveles, peso = 0) {
  return {
    nombre: '',
    peso,
    puntos: puntosDerivados(peso, niveles),
    descriptores: niveles.map(() => ''),
  }
}

export function rubricaNueva() {
  const niveles = NIVELES_DEFAULT.map((n) => ({ ...n }))
  return {
    titulo: '',
    descripcion: '',
    niveles,
    criterios: [nuevoCriterio(niveles, 5), nuevoCriterio(niveles, 5)],
  }
}

export function sumaPesos(criterios) {
  return round1((criterios || []).reduce((s, c) => s + (parseFloat(c.peso) || 0), 0))
}

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

// Normaliza una rúbrica en edición (strings de inputs) a números listos para
// guardar. No valida — eso lo hace validarRubrica sobre el resultado.
export function normalizarRubrica(r) {
  const niveles = (r.niveles || []).map((nv) => ({
    nombre: (nv.nombre || '').trim(),
    porcentaje: parseFloat(nv.porcentaje) || 0,
  }))
  return {
    titulo: (r.titulo || '').trim(),
    descripcion: (r.descripcion || '').trim(),
    niveles,
    criterios: (r.criterios || []).map((c) => ({
      nombre: (c.nombre || '').trim(),
      peso: parseFloat(c.peso) || 0,
      puntos: (c.puntos || []).map((p, i) => (i === 0 ? round1(parseFloat(c.peso) || 0) : round1(parseFloat(p) || 0))),
      descriptores: (c.descriptores || []).map((d) => (d || '').trim()),
    })),
  }
}

// Valida una rúbrica NORMALIZADA. Devuelve el primer error encontrado como
// texto para el docente, o null si todo está bien.
export function validarRubrica(r) {
  if (!r.titulo) return 'Escribe el título de la rúbrica'
  const nv = r.niveles || []
  if (nv.length < MIN_NIVELES || nv.length > MAX_NIVELES) {
    return `La rúbrica debe tener entre ${MIN_NIVELES} y ${MAX_NIVELES} niveles de desempeño`
  }
  if (nv.some((n) => !n.nombre)) return 'Todos los niveles necesitan un nombre'
  if (nv[0].porcentaje !== 100) return 'El primer nivel siempre vale el 100%'
  for (let i = 1; i < nv.length; i++) {
    if (nv[i].porcentaje <= 0 || nv[i].porcentaje >= 100) return `El porcentaje de "${nv[i].nombre}" debe estar entre 1 y 99`
    if (nv[i].porcentaje >= nv[i - 1].porcentaje) return 'Los porcentajes de los niveles deben ir de mayor a menor'
  }
  const cr = r.criterios || []
  if (cr.length < MIN_CRITERIOS || cr.length > MAX_CRITERIOS) {
    return `La rúbrica debe tener entre ${MIN_CRITERIOS} y ${MAX_CRITERIOS} criterios`
  }
  for (let ci = 0; ci < cr.length; ci++) {
    const c = cr[ci]
    if (!c.nombre) return `Escribe el nombre del criterio ${ci + 1}`
    if (c.peso <= 0) return `El criterio "${c.nombre}" necesita un peso mayor a 0`
    if (c.puntos.length !== nv.length) return `Los puntos del criterio "${c.nombre}" no coinciden con los niveles`
    for (let ni = 1; ni < c.puntos.length; ni++) {
      if (c.puntos[ni] < 0) return `Los puntos de "${c.nombre}" no pueden ser negativos`
      if (c.puntos[ni] > c.puntos[ni - 1]) {
        return `En "${c.nombre}", los puntos de "${nv[ni].nombre}" no pueden ser mayores que los de "${nv[ni - 1].nombre}"`
      }
    }
  }
  const suma = sumaPesos(cr)
  if (Math.abs(suma - RUBRICA_TOTAL) > 0.01) {
    return `Los pesos de los criterios suman ${suma} — deben sumar exactamente ${RUBRICA_TOTAL}`
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
