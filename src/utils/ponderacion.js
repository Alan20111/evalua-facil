// Optional per-activity weighting (PONDERACIÓN) for parcial averages.
//
// Default behaviour (no weighting): every activity in the parcial is worth
// the same — the parcial average is the simple mean of the activities with a
// grade (activities that don't count yet stay out of it).
//
// When the subject has `ponderacionActivada` AND at least one activity of the
// parcial has a positive `pesoCalificacion` (assigned by the teacher so the
// parcial adds up to 10), the average becomes
//
//     Σ(nota · peso) / 10
//
// Los pesos de las actividades evaluables suman 10, haya 8, 10 o 12 actividades:
// con los pesos en 10 y todas las notas en 10, el promedio es 10. El divisor es
// SIEMPRE 10 (PESO_TOTAL_PARCIAL): no depende de cuántas actividades haya ni de
// cuántas tengan nota. Una actividad sin resultado todavía (vigente, pendiente de
// calificar, programada, oculta) aporta 0 al numerador, como la celda vacía del
// Excel del docente; las de peso cero tampoco aportan. Los pesos que no suman 10
// se ADVIERTEN al docente y bloquean exportar/cerrar/publicar; no se normalizan
// ni se compensan en la fórmula.
//
// `promedioParcial` solo ve notas (null = sin resultado que deba contar). Lo
// que ya no se puede entregar vale CERO: quien arma las notas pasa antes por
// `notasParaPromedio` (ver "Cero por falta de entrega").

import { cuentaParaCalificacion, isActivityPublished } from './activityVisibility.js'

// Per-parcial activation. The subject's `ponderacionParciales` map
// ({ '1': true, '2': false … }) wins when it has an entry for the parcial;
// otherwise the legacy subject-wide `ponderacionActivada` flag applies to all.
export function ponderacionActivaEnParcial(subject, parcial) {
  const map = subject?.ponderacionParciales
  if (map && map[String(parcial)] !== undefined) return !!map[String(parcial)]
  return !!subject?.ponderacionActivada
}

// Normaliza una calificación cruda (sobre `maxCalif`) a una escala base — 10
// por defecto — para que actividades con distinto máximo (un examen sobre
// 100, un cuestionario sobre 20…) puedan promediarse juntas. Antes esta
// misma división vivía copiada en 7 sitios distintos (excel.js x2, pdf.js
// x2, SubjectPage.jsx docente y alumno, Dashboard.jsx alumno), cada uno
// redondeando distinto (o sin redondear). Sin `decimals` regresa el número
// completo, para quien todavía va a promediar/agregar antes de mostrar; con
// `decimals` regresa ya redondeado a esos decimales.
export function normalizeGrade(calificacion, maxCalif, { base = 10, decimals } = {}) {
  if (calificacion == null) return null
  const value = (calificacion / (maxCalif || 10)) * base
  return decimals == null ? value : parseFloat(value.toFixed(decimals))
}

export const pesoDe = (a) => {
  const n = parseFloat(a?.pesoCalificacion)
  return isNaN(n) || n < 0 ? 0 : n
}

export const pesoTotal = (acts) =>
  parseFloat(acts.reduce((s, a) => s + pesoDe(a), 0).toFixed(2))

// Total que deben sumar los pesos de un parcial ponderado. Es el divisor del
// Total que DEBEN sumar los pesos de un parcial ponderado: se exige para exportar,
// cerrar y publicar (estadoSumaPesos advierte al docente) y es el divisor fijo del
// promedio ponderado (ver promedioParcial).
const PESO_TOTAL_PARCIAL = 10
export const pesoTotalParcial = () => PESO_TOTAL_PARCIAL

// ¿Los pesos del parcial suman 10? 'completa' | 'menor' | 'mayor'. Solo sirve
// para ADVERTIR al docente: nunca corrige ni cambia pesos.
export function estadoSumaPesos(acts) {
  const total = pesoTotal(acts || [])
  if (Math.abs(total - PESO_TOTAL_PARCIAL) <= 0.001) return 'completa'
  return total < PESO_TOTAL_PARCIAL ? 'menor' : 'mayor'
}

// acts and grades are parallel arrays; grades holds normalized 0–10 numbers
// or null when there is no result that must count (no grade, still open,
// pending, …). Returns a number or null.
//
//  · Ponderado: Σ(nota·peso) / 10. `acts` son las actividades que cuentan para la
//    calificación (el estudiante también incluye las ocultas); una sin resultado
//    aporta 0 y los pesos cero no aportan. null solo si NINGUNA actividad con peso
//    tiene resultado; si todos los resultados son cero, el promedio es 0. Nunca
//    pasa de 10 (si los pesos suman más de 10 el docente ve la advertencia).
//  · Simple: media de las notas que no son null (las entregas pendientes de
//    calificar ya llegan como 0 desde `notasParaPromedio`).
export function promedioParcial(acts, grades, ponderacionOn) {
  const usePesos = ponderacionOn && acts.some((a) => pesoDe(a) > 0)
  if (usePesos) {
    let sg = 0
    let hayResultado = false
    acts.forEach((a, i) => {
      const w = pesoDe(a)
      const g = grades[i]
      if (w > 0 && g !== null && g !== undefined) {
        sg += g * w
        hayResultado = true
      }
    })
    return hayResultado ? Math.min(10, sg / PESO_TOTAL_PARCIAL) : null
  }
  const valid = grades.filter((g) => g !== null && g !== undefined)
  return valid.length ? valid.reduce((x, y) => x + y, 0) / valid.length : null
}

// ── Cero por falta de entrega ─────────────────────────────────────────────
//
// `promedioParcial` solo promedia notas que NO son null, así que una actividad
// sin entrega desaparecía del promedio (y, ponderado, de su denominador). Esta
// es la regla que decide cuándo esa ausencia vale CERO. Es un cálculo derivado:
// nunca se escribe en `submissions` y la tabla sigue mostrando "—".
//
// Vale cero solo si TODO esto se cumple:
//   · NO hay documento del estudiante. Cualquier documento (entrega, intento
//     en curso, calificación manual, nota de cierre) se trata como siempre:
//     con `calificacion` cuenta, sin ella queda pendiente y no penaliza.
//   · La actividad cuenta para la calificación (no borrador, no "sin
//     calificación") y el estudiante puede verla (publicada, parcial no oculto;
//     un juego solo si está confirmado).
//   · Ya no puede entregarla: cierre manual, o plazo efectivo vencido (su
//     prórroga o la fecha del grupo) SIN recibir tarde, o el parcial cerrado.
//     Sin fecha límite solo el cierre del parcial o el manual la vuelven cero.
//   · Le aplicaba: no se dio de alta después de que se cerró para él.
//
// `ctx` = { subject, alumno, ahora }. `alumno` aporta el id (prórroga) y
// `createdAt` (alta tardía, el mismo criterio que estadoPlazo en
// functions/analisisAcademico.js).
const msDe = (t) => {
  if (t == null) return null
  if (typeof t.toMillis === 'function') return t.toMillis()
  if (typeof t.seconds === 'number') return t.seconds * 1000
  if (typeof t === 'string') { const n = Date.parse(t); return Number.isNaN(n) ? null : n }
  return null
}

// Plazo efectivo del estudiante en ms (null = sin fecha límite). Mismo orden
// que `instanteLimite` de functions/analisisAcademico.js: su prórroga gana
// sobre la fecha del grupo y el Timestamp (`*TS`) sobre el texto. Los textos
// ('YYYY-MM-DD' o 'YYYY-MM-DDTHH:MM') son hora de México y se leen con su
// desfase fijo (sin horario de verano desde 2022), no con la zona del
// dispositivo ni la del servidor: así cliente y servidor dan el mismo
// instante, también en las actividades anteriores a `fechaLimiteTS`. Una
// fecha sin hora cierra al final del día, igual que en todo el sistema.
const textoMexicoAMs = (t) => {
  if (!t || typeof t !== 'string') return null
  const iso = t.includes('T') ? t : `${t}T23:59:59`
  const n = new Date(/([zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}-06:00`).getTime()
  return Number.isNaN(n) ? null : n
}
function plazoEfectivoMs(a, alumnoId) {
  return msDe(a.extensionesTS?.[alumnoId]) ?? textoMexicoAMs(a.extensiones?.[alumnoId]) ??
    msDe(a.fechaLimiteTS) ?? textoMexicoAMs(a.fechaLimite)
}

export function ceroPorFaltaDeEntrega(a, sub, { subject, alumno, ahora = Date.now() } = {}) {
  if (sub || !a) return false
  if (!cuentaParaCalificacion(a)) return false
  if (!isActivityPublished(a, (subject?.parcialesOcultos || []).includes(a.parcial))) return false
  if (a.categoria === 'juego' && a.juego?.estado !== 'juego_confirmado') return false

  const limite = plazoEfectivoMs(a, alumno?.id)
  const parcialCierre = parcialCerrado(subject, a.parcial)
  const cierraPorFecha = limite != null && ahora >= limite && a.recibirTarde !== true
  if (!(a.cerradaManual === true || cierraPorFecha || parcialCierre)) return false

  // Alta tardía: si se incorporó después de que la actividad cerró para él,
  // no le aplica. Se compara contra el primer cierre que ocurrió.
  const altaMs = msDe(alumno?.createdAt)
  if (altaMs != null) {
    const cierres = [ahora]
    if (limite != null && a.recibirTarde !== true) cierres.push(limite)
    if (parcialCierre) { const c = msDe(subject?.parcialesCerrados?.[String(a.parcial)]); if (c != null) cierres.push(c) }
    if (altaMs > Math.min(...cierres)) return false
  }
  return true
}

// ¿Entra esta actividad al promedio DEL ESTUDIANTE? La MISMA cuenta que hace el
// docente: todo lo que cuenta para la calificación, publicada o no. Importa
// para el promedio ponderado (una actividad oculta o programada también cuenta,
// con 0 si no tiene nota) y para que una nota real cuente aunque la actividad se
// oculte después.
// La actividad NO se le muestra por eso: las listas siguen filtrando por
// publicación.
// No entran un parcial oculto por el docente (ni sus notas ni su efecto en el
// final), los borradores ni las actividades «sin calificación».
// `sub` no cambia la respuesta; se conserva por compatibilidad con quien llama.
export function cuentaEnPromedioDelAlumno(a, sub, subject) {
  if (!cuentaParaCalificacion(a)) return false
  return !(subject?.parcialesOcultos || []).includes(a.parcial)
}

// Entrega recibida que todavía no tiene calificación. Un intento en curso
// (`estadoEvaluacion: 'en_progreso'`) NO es una entrega: no entra aquí.
const entregaPendienteDeCalificar = (a, sub) =>
  !!sub && sub.calificacion == null && sub.estado === 'entregado' &&
  sub.estadoEvaluacion !== 'en_progreso' && cuentaParaCalificacion(a)

// Notas (normalizadas, null = sin nota) → notas para PROMEDIAR: igual que
// `grades`, salvo las actividades que valen cero por falta de entrega y, SOLO en
// el promedio simple, la entrega ya recibida pero pendiente de calificar (cuenta
// como 0 en el numerador y en el denominador). En el ponderado esa entrega ya
// aporta 0 con el divisor fijo de 10, así que aquí no se toca.
// `subs[i]` es el documento del estudiante en `acts[i]` (o undefined).
export function notasParaPromedio(acts, grades, subs, ctx) {
  const simple = !(ponderacionActivaEnParcial(ctx?.subject, acts[0]?.parcial) && acts.some((a) => pesoDe(a) > 0))
  return grades.map((g, i) => {
    if (g !== null && g !== undefined) return g
    if (ceroPorFaltaDeEntrega(acts[i], subs?.[i], ctx)) return 0
    return simple && entregaPendienteDeCalificar(acts[i], subs?.[i]) ? 0 : g
  })
}

// ── Estado del parcial y publicación del resultado ponderado ──────────────
//
// Fuente única de verdad. Calcular (promedioParcial, arriba) es una cosa;
// PUBLICAR el resultado al estudiante es otra, y vive solo aquí.
//
// Estados por parcial, derivados de dos mapas de `subjects` ({ '1': ISO }):
//   · cerrado  → parcialesCerrados[p]  (cierre definitivo, flujo de siempre)
//   · atencion → parcialesAtencion[p]  (atención de inquietudes: el docente
//                publicó el resultado; la llave nunca se borra)
//   · abierto  → ninguno de los dos
//
// Un parcial SIN ponderación publica siempre (comportamiento de siempre). Uno
// CON ponderación —activada, aunque los pesos todavía no sumen 10— publica
// solo fuera de "abierto" y con los pesos sumando exactamente 10: no hay
// ningún camino que muestre un resultado con la ponderación incompleta.
//
// `activities` es la lista COMPLETA de actividades de la asignatura (la misma
// que entrega /api/subject/content); aquí se filtra lo que cuenta.

export function estadoParcial(subject, parcial) {
  const p = String(parcial)
  if (subject?.parcialesCerrados?.[p]) return 'cerrado'
  if (subject?.parcialesAtencion?.[p]) return 'atencion'
  return 'abierto'
}

// Cerrado definitivamente = resultado académico congelado. SOLO este estado
// congela: abierto y atención de inquietudes permiten trabajar y corregir. Es
// el predicado que usan las pantallas (docente y estudiante) y las Cloud
// Functions (vía functions/_shared); firestore.rules repite la misma lectura de
// `parcialesCerrados` porque ahí no se puede importar.
export function parcialCerrado(subject, parcial) {
  return estadoParcial(subject, parcial) === 'cerrado'
}

export function mensajeParcialCerrado(parcial) {
  return `El Parcial ${parcial} está cerrado definitivamente — reábrelo para atención de inquietudes para cambiarlo`
}

// Una nota automática de cierre (la que confirmCloseParcial pone a quien no
// entregó) que SIGUE siendo solo eso: marcada, sin entrega y sin ningún rastro
// de trabajo real del estudiante. Si el documento ya trae un intento, archivos
// o progreso de juego, dejó de ser automática aunque conserve la marca — y
// reabrir el parcial nunca debe borrarla.
export function esNotaAutomaticaDeCierre(sub) {
  return sub?.cierreParcial === true && sub?.sinEntrega === true &&
    !(sub.intentos?.length) && !sub.estadoEvaluacion && !sub.intentoActual &&
    !(sub.archivos?.length) && !sub.archivoURL && !sub.enlaceURL && !sub.completadoSinArchivo &&
    !sub.respuestasJuego
}

export function actividadesQueCuentan(activities, parcial) {
  return (activities || []).filter((a) => a.parcial === parcial && cuentaParaCalificacion(a))
}

export function pesosSumanDiez(acts) {
  return Math.abs(pesoTotal(acts) - 10) <= 0.001
}

export function resultadoPublicadoAlumno(subject, parcial, activities) {
  if (!ponderacionActivaEnParcial(subject, parcial)) return true
  return estadoParcial(subject, parcial) !== 'abierto' &&
    pesosSumanDiez(actividadesQueCuentan(activities, parcial))
}

export function pesosVisiblesAlumno(subject, parcial, activities) {
  return ponderacionActivaEnParcial(subject, parcial) && resultadoPublicadoAlumno(subject, parcial, activities)
}

export function puedeIniciarAtencion(subject, parcial, activities) {
  if (estadoParcial(subject, parcial) !== 'abierto') return false
  return !ponderacionActivaEnParcial(subject, parcial) ||
    pesosSumanDiez(actividadesQueCuentan(activities, parcial))
}

// Lo que el servidor entrega al estudiante: `pesoCalificacion` se quita de
// toda actividad cuyo parcial no tiene los pesos publicados. Sin pesos, lo
// único que puede sacarse de sus notas es una media simple, nunca la
// ponderada. `activities` = todas las de UNA asignatura.
export function ocultarPesosNoPublicados(subject, activities) {
  const visiblePorParcial = new Map()
  return activities.map((a) => {
    if (!('pesoCalificacion' in a)) return a
    if (!visiblePorParcial.has(a.parcial)) {
      visiblePorParcial.set(a.parcial, pesosVisiblesAlumno(subject, a.parcial, activities))
    }
    if (visiblePorParcial.get(a.parcial)) return a
    const sinPeso = { ...a }
    delete sinPeso.pesoCalificacion
    return sinPeso
  })
}
