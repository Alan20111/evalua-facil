// Secciones de una evaluación — agrupar los reactivos por tema, competencia o
// aprendizaje. Es OPCIONAL: un instrumento sin secciones se comporta
// exactamente igual que antes de que esto existiera.
//
// ── Dónde viven ─────────────────────────────────────────────────────────────
// En `activity.evaluacion.secciones`, un arreglo dentro del documento de la
// actividad:
//
//   secciones: [{ id, nombre, descripcion }]   // el orden del arreglo manda
//
// NO son una colección aparte, a propósito:
//   · Son pocas (un puñado por instrumento) y SIEMPRE se necesitan junto con la
//     configuración que ya se lee en el mismo documento — cero lecturas extra.
//   · Reordenarlas o renombrarlas es una sola escritura atómica sobre un
//     arreglo, no N escrituras coordinadas.
//   · No necesitan reglas de Firestore propias: heredan las de `activities`,
//     que ya resuelven quién puede escribirlas.
// Una subcolección solo se justificaría si tuvieran contenido propio o si
// pudieran ser cientos. No es el caso.
//
// ── Cómo se relacionan con los reactivos ────────────────────────────────────
// Cada pregunta guarda DOS campos (ver `datosDeSeccion`):
//
//   seccionId      → a qué sección pertenece (null = fuera de toda sección)
//   seccionNombre  → copia del nombre en el momento de asignarla
//
// El id es la verdad para agrupar; el nombre es una copia deliberada, para que
// las estadísticas por sección (una versión futura) y las exportaciones puedan
// leer "de qué sección era esta pregunta" sin cruzar con la configuración de la
// actividad — y para que un instrumento respondido conserve el nombre que tenía
// cuando se aplicó. Renombrar una sección sí actualiza el nombre de sus
// reactivos (ver `renombrarEnPreguntas` en los editores): mientras el
// instrumento se está armando, lo que se espera es que se actualice.

// Id corto y único para una sección nueva. Mismo patrón que los ids de opción
// de un reactivo (ver makeOption en los editores): basta con que no choque
// dentro del mismo instrumento.
export function nuevaSeccionId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

// Las secciones de una actividad, siempre como arreglo (nunca undefined) y sin
// entradas corruptas — un instrumento viejo no tiene el campo.
export function seccionesDe(evaluacion) {
  const lista = evaluacion?.secciones
  if (!Array.isArray(lista)) return []
  return lista.filter((s) => s && s.id)
}

// Lo que se guarda EN LA PREGUNTA para dejarla ligada a una sección. `null`
// deja el reactivo fuera de toda sección (el comportamiento de siempre).
export function datosDeSeccion(seccion) {
  return {
    seccionId: seccion?.id || null,
    seccionNombre: seccion?.nombre || null,
  }
}

// Agrupa los reactivos para mostrarlos: primero los que están FUERA de toda
// sección (así un instrumento simple se ve exactamente igual que siempre) y
// después cada sección en su orden, con los suyos.
//
// Un reactivo cuya sección ya no existe (se borró) cae al grupo suelto en vez
// de desaparecer: perder de vista una pregunta sería mucho peor que verla
// fuera de su sección.
//
// Devuelve [{ seccion: null | {...}, preguntas: [...] }], omitiendo el grupo
// suelto cuando está vacío pero CONSERVANDO las secciones vacías (el docente
// acaba de crearlas y necesita verlas para llenarlas).
export function agruparPreguntas(preguntas, secciones) {
  const lista = preguntas || []
  const secs = secciones || []
  const idsValidos = new Set(secs.map((s) => s.id))
  const porOrden = (a, b) => (a.orden ?? 0) - (b.orden ?? 0)

  const sueltas = lista.filter((p) => !p.seccionId || !idsValidos.has(p.seccionId)).sort(porOrden)
  const grupos = []
  if (sueltas.length) grupos.push({ seccion: null, preguntas: sueltas })
  secs.forEach((s) => {
    grupos.push({ seccion: s, preguntas: lista.filter((p) => p.seccionId === s.id).sort(porOrden) })
  })
  return grupos
}

// La lista aplanada en el orden en que se presenta, respetando las secciones.
// Es lo que ve el estudiante y lo que numera al docente.
export function preguntasEnOrden(preguntas, secciones) {
  return agruparPreguntas(preguntas, secciones).flatMap((g) => g.preguntas)
}

// El orden del estudiante. Con orden aleatorio, se baraja DENTRO de cada
// sección y las secciones conservan su lugar: así el reactivo nunca se sale de
// su sección (requisito), que es justo lo que permitirá medir por sección.
//
// `barajar(lista, semilla)` se recibe como parámetro para no atar esta lógica a
// una implementación concreta de aleatorio (la del alumno es determinista por
// intento, ver EvaluacionRunner).
export function ordenParaEstudiante(preguntas, secciones, { aleatorio, semilla, barajar, hashId }) {
  const grupos = agruparPreguntas(preguntas, secciones)
  if (!aleatorio) return grupos.flatMap((g) => g.preguntas)
  return grupos.flatMap((g) => {
    // Semilla distinta por sección: si todas compartieran una, dos secciones
    // con el mismo número de reactivos saldrían barajadas igual.
    const s = semilla + (hashId ? hashId(g.seccion?.id || 'sueltas') : 0)
    return barajar(g.preguntas, s)
  })
}

// Siguiente `orden` dentro de una sección (o entre las sueltas). Se calcula por
// grupo y no global para que reordenar en una sección no dependa de lo que haya
// en las demás.
export function siguienteOrden(preguntas, seccionId) {
  const delGrupo = (preguntas || []).filter((p) => (p.seccionId || null) === (seccionId || null))
  if (delGrupo.length === 0) return 0
  return Math.max(...delGrupo.map((p) => p.orden ?? 0)) + 1
}

// ¿Este instrumento usa secciones? Sirve para no mostrar nada de secciones en
// los que no las usan.
export function usaSecciones(evaluacion) {
  return seccionesDe(evaluacion).length > 0
}

// ¿Se le muestran al estudiante los nombres de sección? Ausente = sí (una vez
// que el docente se tomó el trabajo de crearlas, lo natural es que se vean);
// apagarlo las oculta por completo y el instrumento se ve como una lista
// continua, conservando el agrupamiento por dentro.
export function mostrarSeccionesAlEstudiante(evaluacion) {
  return usaSecciones(evaluacion) && evaluacion?.mostrarSecciones !== false
}
