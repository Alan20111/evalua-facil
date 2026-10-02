// Análisis académico con IA — módulo propio (no engordar functions/ia.js).
//
// PR 1: ANÁLISIS INTEGRAL DE ASIGNATURA ('analizar_asignatura'). El docente
// elige parciales y fuentes de datos; Evalúa Fácil hace TODA la aritmética y
// decide qué estudiantes requieren atención con umbrales de configuración; la
// IA solo redacta la interpretación sobre esos números.
//
// Reglas que este archivo hace cumplir:
//   · Solo LEE datos académicos. Lo único que escribe es el informe, en
//     subjects/{id}/analisisIA/{clave} — nunca submissions, activities,
//     attendance ni nada más.
//   · Una fuente desmarcada no se consulta, no se calcula y no entra al
//     prompt: ni siquiera como contexto.
//   · Al modelo no viajan nombres de estudiantes ("Alumno N"), comentarios
//     del docente, archivos, motivos ni textos de asistencia, ni el contenido
//     de los juegos. El nombre se agrega aquí, al guardar el informe.
//   · Ningún precio ni umbral vive en el código: salen de
//     config/iaTarifas.analisisAsignatura.
//   · El cobro pasa por el flujo de siempre (functions/ia.js →
//     creditosLedger.js); aquí no hay nada de créditos más que decir cuántos
//     corresponden a la selección.
//
// functions/ia.js registra la operación e inyecta `pedirJSON`/`textoPlano`,
// así este módulo no lo requiere de vuelta (sin ciclo).

const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentDeleted } = require('firebase-functions/v2/firestore')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { logger } = require('firebase-functions')
const ledger = require('./creditosLedger')
const {
  promedioParcial, normalizeGrade, ponderacionActivaEnParcial, estadoParcial, esNotaAutomaticaDeCierre, pesoDe,
} = require('./_shared/ponderacion.js')
const { cuentaParaCalificacion, isActivityPublished } = require('./_shared/activityVisibility.js')
const { resumenAsistencia, estadoAsistencia, fechaHoyMexico } = require('./_shared/asistenciaResumen.js')
const { parcialForDate } = require('./_shared/parciales.js')
const {
  CLAVES_FUENTES, FUENTES_CON_ENTREGA, fuenteDeActividad, etiquetaFuente,
  fuentesEfectivas, costoAnalisis, parcialesValidos,
} = require('./_shared/analisisAsignatura.js')
const { capitalizarNombre } = require('./_shared/nombres.js')

const FUENTES_DE_ACTIVIDADES = ['entregables', 'observacion', 'evaluaciones', 'interactivas']
const CLAVES_UMBRALES = [
  'promedioMinimo', 'minActividadesCalificadas', 'faltantesPorcentaje', 'minFaltantes',
  'asistenciaMinimaPorcentaje', 'minSesiones', 'proporcionPatronGrupal', 'cambioRelevante',
]

const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10)
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : null)
const esNumero = (v) => typeof v === 'number' && Number.isFinite(v)

// ── Configuración (config/iaTarifas.analisisAsignatura) ─────────────────────
// Sin valores por omisión a propósito: si la configuración falta o está
// incompleta, la operación se detiene ANTES de cualquier cobro en vez de
// trabajar con números que nadie aprobó.
function configAnalisis(tarifas) {
  const c = tarifas?.analisisAsignatura
  const costos = c?.costoPorFuente
  const umbrales = c?.umbrales
  const ok = costos && umbrales &&
    CLAVES_FUENTES.every((k) => esNumero(costos[k]) && costos[k] >= 0) &&
    CLAVES_UMBRALES.every((k) => esNumero(umbrales[k]))
  if (!ok) {
    throw new HttpsError('failed-precondition',
      'El análisis de asignatura todavía no está configurado en el servidor. Avisa al administrador. No se descontaron créditos.',
      { codigo: 'ANALISIS_SIN_CONFIGURAR' })
  }
  return { costoPorFuente: costos, umbrales }
}

// ── Fechas y plazos ─────────────────────────────────────────────────────────
const millisDe = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : null)

// `fechaLimite`/`extensiones` son textos en hora de México ('YYYY-MM-DD' o
// 'YYYY-MM-DDTHH:MM'). El servidor corre en UTC, así que se les fija el
// desfase de México (sin horario de verano desde 2022) en vez de dejar que
// `new Date` los lea como UTC. Sin hora = fin del día, igual que el cliente.
function fechaMexicoAMillis(texto) {
  if (!texto || typeof texto !== 'string') return null
  const iso = texto.includes('T') ? texto : `${texto}T23:59:59`
  const conZona = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}-06:00`
  const ms = new Date(conZona).getTime()
  return Number.isNaN(ms) ? null : ms
}

// Instante en que cierra la actividad para ESE estudiante: su prórroga gana
// sobre la fecha general; el Timestamp ya resuelto por el cliente gana sobre
// el texto. null = la actividad no tiene fecha límite.
function instanteLimite(act, alumnoId) {
  return millisDe(act.extensionesTS?.[alumnoId]) ??
    fechaMexicoAMillis(act.extensiones?.[alumnoId]) ??
    millisDe(act.fechaLimiteTS) ??
    fechaMexicoAMillis(act.fechaLimite)
}

// 'vencida' | 'en_plazo' | 'sin_fecha_limite' | 'no_aplica'. Nunca se inventa
// una fecha: sin fecha límite solo se considera vencida si el docente cerró
// la actividad a mano, o si su parcial ya terminó (parcial fuera de "abierto",
// o la fecha de fin del parcial ya pasó). 'no_aplica' = el estudiante se dio
// de alta después de que la actividad cerró: no es un incumplimiento suyo.
function estadoPlazo(act, alumno, subject, ahoraMs, hoyISO) {
  const prorroga = millisDe(act.extensionesTS?.[alumno.id]) ?? fechaMexicoAMillis(act.extensiones?.[alumno.id])
  const altaMs = millisDe(alumno.createdAt)
  if (prorroga != null && prorroga >= ahoraMs) return 'en_plazo'
  const limite = instanteLimite(act, alumno.id)
  if (limite != null) {
    if (limite >= ahoraMs && !act.cerradaManual) return 'en_plazo'
    const cierre = Math.min(limite, ahoraMs)
    return altaMs != null && altaMs > cierre ? 'no_aplica' : 'vencida'
  }
  const finParcial = subject.parcialesFechas?.[act.parcial - 1]?.fin || null
  const parcialTerminado = estadoParcial(subject, act.parcial) !== 'abierto' || (!!finParcial && finParcial < hoyISO)
  if (act.cerradaManual || parcialTerminado) {
    if (finParcial && finParcial < hoyISO && altaMs != null && altaMs > fechaMexicoAMillis(finParcial)) return 'no_aplica'
    return 'vencida'
  }
  return 'sin_fecha_limite'
}

// Qué hizo el estudiante en la actividad, según lo que Firestore sí guarda:
//   'sin_registro'           no hay entrega, o solo la nota automática que el
//                            cierre del parcial le puso por no entregar
//   'calificada_sin_archivo' sinEntrega:true — el docente calificó sin archivo
//                            en la plataforma. NO es incumplimiento.
//   'incompleta'             empezó un cuestionario/examen/juego y no terminó
//   'realizada'
function estadoRealizacion(fuente, sub) {
  if (!sub || esNotaAutomaticaDeCierre(sub)) return 'sin_registro'
  if (sub.sinEntrega === true) return 'calificada_sin_archivo'
  if (fuente === 'evaluaciones' || fuente === 'interactivas') {
    if (sub.estadoEvaluacion === 'finalizado' || sub.intentos?.length || sub.calificacion != null) return 'realizada'
    return 'incompleta'
  }
  return 'realizada'
}

// ── Qué actividades entran ──────────────────────────────────────────────────
// Lo mismo que cuenta en la tabla de Calificaciones (sin borradores ni
// actividades sin calificación) y, en los juegos, solo los confirmados.
function actividadElegible(a) {
  if (!fuenteDeActividad(a) || !cuentaParaCalificacion(a)) return false
  if (a.categoria === 'juego' && a.juego?.estado !== 'juego_confirmado') return false
  return Number.isInteger(a.parcial)
}

const visibleParaEstudiantes = (a, subject) =>
  isActivityPublished(a, (subject.parcialesOcultos || []).includes(a.parcial))

function etiquetaTipo(a) {
  if (a.categoria === 'examen') return 'Examen'
  if (a.categoria === 'cuestionario') return 'Cuestionario'
  if (a.categoria === 'observacion') return 'Observación'
  if (a.categoria === 'juego') return a.tipoJuego === 'crucigrama' ? 'Crucigrama' : a.tipoJuego === 'sopa_letras' ? 'Sopa de letras' : 'Actividad interactiva'
  return 'Entregable'
}

const nombreActividad = (a) => String(a.nombre || a.titulo || '(sin nombre)').trim().slice(0, 120)

// ── Disponibilidad por parcial (para "Sin datos" y para el costo) ───────────
// Función PURA. `entregas` = Map(actividadId → Map(alumnoId → submission)).
// Una fuente de actividades tiene datos en un parcial si alguna de sus
// actividades tiene al menos una entrega o calificación; asistencias, si hay
// alguna sesión con marcas; "sin entrega", si hay actividades con entrega que
// los estudiantes pueden ver.
function calcularDisponibilidad({ subject, activities, students, entregas, attendance, hoyISO }) {
  const total = Math.max(1, Number(subject.parciales) || 3)
  const res = {}
  for (let p = 1; p <= total; p++) {
    res[String(p)] = { entregables: 0, observacion: 0, evaluaciones: 0, interactivas: 0, asistencias: 0, conEntrega: { entregables: 0, evaluaciones: 0, interactivas: 0 } }
  }
  if (!students.length) return res
  const ids = new Set(students.map((s) => s.id))
  for (const a of activities) {
    if (!actividadElegible(a) || !res[String(a.parcial)]) continue
    const fuente = fuenteDeActividad(a)
    const subs = entregas.get(a.id)
    const conRegistro = !!subs && [...subs.keys()].some((id) => ids.has(id))
    if (conRegistro) res[String(a.parcial)][fuente]++
    if (FUENTES_CON_ENTREGA.includes(fuente) && visibleParaEstudiantes(a, subject)) res[String(a.parcial)].conEntrega[fuente]++
  }
  for (const r of attendance || []) {
    if (!r.fecha || r.fecha > hoyISO) continue
    const p = parcialForDate(subject.parcialesFechas, r.fecha) ?? r.parcial ?? 1
    if (!res[String(p)]) continue
    if (students.some((s) => estadoAsistencia(r, s.id))) res[String(p)].asistencias++
  }
  return res
}

// ── Agregación ──────────────────────────────────────────────────────────────
// Función PURA (sin Firestore) para poder probarla sin emulador. Recibe SOLO
// lo de las fuentes que entran: el llamador ya no cargó lo desmarcado, y aquí
// tampoco se usa nada que no esté en `fuentes`.
//
//   subject     documento de la asignatura
//   students    [{ id, nombre, apellidoPaterno, apellidoMaterno, createdAt }]
//   activities  todas las de la asignatura (aquí se filtran)
//   entregas    Map(actividadId → Map(alumnoId → submission))
//   attendance  columnas de asistencia (solo si 'asistencias' entra)
//   analisisExamenes  Map(actividadId → { resumen, pctAciertos, generadoEnMs })
//   parciales   [1, 2…] elegidos · fuentes ['entregables', …] que entran
//   umbrales    config/iaTarifas.analisisAsignatura.umbrales
function agregarAsignatura({ subject, students, activities, entregas, attendance = [], analisisExamenes = new Map(), parciales, fuentes, umbrales, ahora = new Date(), textoPlano = (t) => String(t || '') }) {
  const usa = new Set(fuentes)
  const ahoraMs = ahora.getTime()
  const hoyISO = fechaHoyMexico(ahora)
  const fuentesActividad = FUENTES_DE_ACTIVIDADES.filter((f) => usa.has(f))
  const alumnos = students.map((s, i) => ({ ...s, anonId: `Alumno ${i + 1}` }))
  const subDe = (a, alumnoId) => entregas.get(a.id)?.get(alumnoId) || null

  const actsEnAlcance = activities
    .filter((a) => actividadElegible(a) && parciales.includes(a.parcial))
    .sort((a, b) => (a.parcial - b.parcial) || ((a.orden ?? 0) - (b.orden ?? 0)))
  // Las que aportan CALIFICACIONES: solo de los tipos marcados.
  const acts = actsEnAlcance.filter((a) => usa.has(fuenteDeActividad(a)))

  // ── Promedios por estudiante y parcial (misma aritmética que la tabla de
  // Calificaciones: nota normalizada a 10 con 1 decimal, promedio simple o
  // ponderado según el parcial, y final = promedio de los parciales con nota).
  const porAlumno = new Map(alumnos.map((al) => [al.id, { promedios: {}, calificadas: {} }]))
  const resumenParciales = parciales.map((p) => {
    const actsP = acts.filter((a) => a.parcial === p)
    const ponderacion = ponderacionActivaEnParcial(subject, p) && actsP.some((a) => pesoDe(a) > 0)
    const promedios = []
    for (const al of alumnos) {
      const grades = actsP.map((a) => normalizeGrade(subDe(a, al.id)?.calificacion, a.maxCalif, { decimals: 1 }))
      const crudo = actsP.length ? promedioParcial(actsP, grades, ponderacionActivaEnParcial(subject, p)) : null
      const prom = crudo == null ? null : parseFloat(crudo.toFixed(1))
      const info = porAlumno.get(al.id)
      info.promedios[p] = prom
      info.calificadas[p] = grades.filter((g) => g != null).length
      if (prom != null) promedios.push(prom)
    }
    return {
      parcial: p,
      estado: estadoParcial(subject, p),
      actividades: actsP.length,
      ponderacion,
      promedioGrupo: promedios.length ? r1(promedios.reduce((s, x) => s + x, 0) / promedios.length) : null,
      aprobados: promedios.filter((x) => x >= umbrales.promedioMinimo).length,
      reprobados: promedios.filter((x) => x < umbrales.promedioMinimo).length,
      sinCalificaciones: alumnos.length - promedios.length,
    }
  })
  for (const al of alumnos) {
    const info = porAlumno.get(al.id)
    const validos = parciales.map((p) => info.promedios[p]).filter((x) => x != null)
    info.final = validos.length ? parseFloat((validos.reduce((s, x) => s + x, 0) / validos.length).toFixed(1)) : null
  }
  const finales = alumnos.map((al) => porAlumno.get(al.id).final).filter((x) => x != null)
  const promedioGeneral = finales.length ? r1(finales.reduce((s, x) => s + x, 0) / finales.length) : null

  // ── Resultado por actividad ───────────────────────────────────────────────
  const actividades = acts.map((a) => {
    const fuente = fuenteDeActividad(a)
    const subs = alumnos.map((al) => subDe(a, al.id)).filter(Boolean)
    const notas = subs.map((s) => normalizeGrade(s.calificacion, a.maxCalif)).filter((x) => x != null)
    const fila = {
      nombre: nombreActividad(a), fuente, tipo: etiquetaTipo(a), parcial: a.parcial,
      maxCalif: a.maxCalif || 10,
      peso: ponderacionActivaEnParcial(subject, a.parcial) && pesoDe(a) > 0 ? pesoDe(a) : null,
      calificados: notas.length,
      promedio: notas.length ? r1(notas.reduce((s, x) => s + x, 0) / notas.length) : null,
      aprobadosPct: pct(notas.filter((x) => x >= umbrales.promedioMinimo).length, notas.length),
    }
    if (fuente === 'entregables') {
      const reales = subs.filter((s) => estadoRealizacion(fuente, s) === 'realizada')
      fila.entregaron = reales.length
      fila.calificadasSinArchivo = subs.filter((s) => estadoRealizacion(fuente, s) === 'calificada_sin_archivo').length
      fila.sinCalificar = reales.filter((s) => s.calificacion == null).length
      fila.tardias = reales.filter((s) => s.tarde === true).length
    }
    if (fuente === 'evaluaciones' || fuente === 'interactivas') {
      fila.finalizaron = subs.filter((s) => estadoRealizacion(fuente, s) === 'realizada').length
      fila.enProgreso = subs.filter((s) => estadoRealizacion(fuente, s) === 'incompleta').length
    }
    if (fuente === 'observacion') {
      // Contexto de la actividad: solo en Observación, donde no hay nada más.
      const instr = textoPlano(a.instrucciones).slice(0, 300)
      if (instr) fila.instrucciones = instr
    }
    // Criterios de rúbrica / lista de cotejo, si la actividad los tiene y hay
    // evaluaciones por criterio guardadas. Nunca se inventan criterios.
    if ((fuente === 'entregables' || fuente === 'observacion') && a.rubrica?.criterios?.length) {
      const evals = subs.map((s) => s.rubricaEval).filter((e) => Array.isArray(e))
      if (evals.length) {
        const cotejo = a.rubrica.tipo === 'cotejo'
        fila.instrumento = cotejo ? 'Lista de cotejo' : 'Rúbrica'
        fila.criterios = a.rubrica.criterios.map((c, i) => {
          if (cotejo) {
            return { nombre: String(c.nombre || `Criterio ${i + 1}`).slice(0, 120), cumplen: evals.filter((e) => e[i] === 0).length, evaluados: evals.length }
          }
          const niveles = (a.rubrica.niveles || []).map((n, j) => ({
            nivel: String(n?.nombre || `Nivel ${j + 1}`).slice(0, 40),
            estudiantes: evals.filter((e) => e[i] === j).length,
          }))
          return { nombre: String(c.nombre || `Criterio ${i + 1}`).slice(0, 120), niveles }
        })
      }
    }
    if (fuente === 'evaluaciones') {
      // Análisis de examen ya guardado y vigente (lo decide el llamador): se
      // cita con su fecha; nunca se vuelve a ejecutar aquí.
      const previo = analisisExamenes.get(a.id)
      if (previo) fila.analisisPrevio = previo
    }
    return fila
  })

  // Mejores y más bajas, por promedio — dato, no opinión de la IA.
  const conPromedio = actividades.filter((x) => x.promedio != null).sort((x, y) => y.promedio - x.promedio)
  const corto = (x) => ({ nombre: x.nombre, tipo: x.tipo, parcial: x.parcial, promedio: x.promedio })
  // Con pocas actividades la lista se reparte: ninguna aparece en las dos.
  const mejores = conPromedio.slice(0, Math.min(3, Math.ceil(conPromedio.length / 2))).map(corto)
  const criticas = conPromedio.slice().reverse().slice(0, Math.min(3, Math.floor(conPromedio.length / 2))).map(corto)

  // ── Evolución (solo con dos o más parciales con datos) ────────────────────
  let evolucion = null
  const parcialesConDatos = resumenParciales.filter((p) => p.promedioGrupo != null)
  if (parciales.length >= 2 && parcialesConDatos.length >= 2) {
    let mejoraron = 0, bajaron = 0, estables = 0
    for (const al of alumnos) {
      const serie = parciales.map((p) => porAlumno.get(al.id).promedios[p]).filter((x) => x != null)
      if (serie.length < 2) continue
      const delta = serie[serie.length - 1] - serie[0]
      if (delta >= umbrales.cambioRelevante) mejoraron++
      else if (delta <= -umbrales.cambioRelevante) bajaron++
      else estables++
    }
    evolucion = {
      porParcial: parcialesConDatos.map((p) => ({ parcial: p.parcial, promedioGrupo: p.promedioGrupo })),
      comparables: mejoraron + bajaron + estables, mejoraron, bajaron, estables,
      cambioRelevante: umbrales.cambioRelevante,
    }
  }

  // ── Asistencias (solo conteos; nunca motivos ni textos) ───────────────────
  let asistencia = null
  const asistenciaAlumno = new Map()
  if (usa.has('asistencias')) {
    const totParcial = Object.fromEntries(parciales.map((p) => [p, { asist: 0, inasist: 0, justif: 0, total: 0 }]))
    for (const al of alumnos) {
      const { porParcial } = resumenAsistencia(attendance, al.id, subject.parcialesFechas ?? [], hoyISO)
      const acc = { asist: 0, inasist: 0, justif: 0, total: 0 }
      for (const p of parciales) {
        const d = porParcial[String(p)]
        if (!d) continue
        for (const k of ['asist', 'inasist', 'justif', 'total']) { acc[k] += d[k]; totParcial[p][k] += d[k] }
      }
      asistenciaAlumno.set(al.id, { ...acc, pct: pct(acc.asist, acc.total) })
    }
    const conRegistro = alumnos.filter((al) => asistenciaAlumno.get(al.id).total > 0)
    const suma = (k) => conRegistro.reduce((s, al) => s + asistenciaAlumno.get(al.id)[k], 0)
    const bajos = conRegistro.filter((al) => {
      const d = asistenciaAlumno.get(al.id)
      return d.total >= umbrales.minSesiones && d.pct < umbrales.asistenciaMinimaPorcentaje
    })
    asistencia = {
      minimo: umbrales.asistenciaMinimaPorcentaje,
      estudiantesConRegistro: conRegistro.length,
      asistencias: suma('asist'), faltas: suma('inasist'), justificadas: suma('justif'), total: suma('total'),
      pctGrupo: pct(suma('asist'), suma('total')),
      debajoDelMinimo: bajos.length,
      porParcial: parciales.filter((p) => totParcial[p].total > 0).map((p) => ({
        parcial: p, asistencias: totParcial[p].asist, faltas: totParcial[p].inasist, justificadas: totParcial[p].justif,
        total: totParcial[p].total, pct: pct(totParcial[p].asist, totParcial[p].total),
      })),
      relacion: null,
    }
    // Relación con el desempeño: solo si también entran actividades, y como
    // dos promedios calculados aquí — la IA no deduce nada por su cuenta.
    if (fuentesActividad.length) {
      const prom = (lista) => {
        const v = lista.map((al) => porAlumno.get(al.id).final).filter((x) => x != null)
        return v.length ? r1(v.reduce((s, x) => s + x, 0) / v.length) : null
      }
      const resto = conRegistro.filter((al) => !bajos.includes(al))
      const a = prom(bajos), b = prom(resto)
      if (a != null && b != null) asistencia.relacion = { promedioDebajoDelMinimo: a, promedioResto: b }
    }
  }

  // ── Sin entrega (solo de los tipos con entrega que están marcados) ────────
  let sinEntrega = null
  const faltantesAlumno = new Map()
  if (usa.has('sinEntrega')) {
    const actsEntrega = actsEnAlcance.filter((a) => {
      const f = fuenteDeActividad(a)
      return FUENTES_CON_ENTREGA.includes(f) && usa.has(f) && visibleParaEstudiantes(a, subject)
    })
    alumnos.forEach((al) => faltantesAlumno.set(al.id, { vencidas: 0, faltantes: 0 }))
    const filas = actsEntrega.map((a) => {
      const fuente = fuenteDeActividad(a)
      const cuenta = { noRealizadas: 0, incompletas: 0, enPlazo: 0, sinFechaLimite: 0 }
      for (const al of alumnos) {
        const hecho = estadoRealizacion(fuente, subDe(a, al.id))
        const plazo = estadoPlazo(a, al, subject, ahoraMs, hoyISO)
        const acc = faltantesAlumno.get(al.id)
        if (plazo === 'no_aplica') continue
        if (hecho === 'realizada' || hecho === 'calificada_sin_archivo') {
          if (plazo === 'vencida') acc.vencidas++
          continue
        }
        if (plazo === 'vencida') {
          acc.vencidas++; acc.faltantes++
          if (hecho === 'incompleta') cuenta.incompletas++; else cuenta.noRealizadas++
        } else if (plazo === 'en_plazo') cuenta.enPlazo++
        else cuenta.sinFechaLimite++
      }
      const tieneFecha = instanteLimite(a, '') != null
      return { nombre: nombreActividad(a), tipo: etiquetaTipo(a), parcial: a.parcial, conFechaLimite: tieneFecha, ...cuenta }
    })
    sinEntrega = {
      actividades: filas,
      totalNoRealizadas: filas.reduce((s, f) => s + f.noRealizadas, 0),
      totalIncompletas: filas.reduce((s, f) => s + f.incompletas, 0),
      totalEnPlazo: filas.reduce((s, f) => s + f.enPlazo, 0),
      actividadesSinFechaLimite: filas.filter((f) => f.sinFechaLimite > 0).length,
      estudiantesConFaltantes: [...faltantesAlumno.values()].filter((f) => f.faltantes > 0).length,
    }
  }

  // ── Estudiantes que requieren atención ────────────────────────────────────
  // Los decide el código con los umbrales de configuración y SOLO con las
  // fuentes marcadas. Una señal basta. La IA no agrega ni quita a nadie.
  const candidatos = []
  for (const al of alumnos) {
    const senales = []
    if (fuentesActividad.length) {
      const info = porAlumno.get(al.id)
      for (const p of parciales) {
        const prom = info.promedios[p]
        if (prom != null && prom < umbrales.promedioMinimo && info.calificadas[p] >= umbrales.minActividadesCalificadas) {
          senales.push({ tipo: 'desempeno', texto: `Promedio de ${prom.toFixed(1)} en el Parcial ${p} (${info.calificadas[p]} actividades calificadas)` })
        }
      }
    }
    if (usa.has('sinEntrega')) {
      const f = faltantesAlumno.get(al.id)
      const p100 = pct(f.faltantes, f.vencidas)
      if (f.faltantes >= umbrales.minFaltantes && p100 != null && p100 >= umbrales.faltantesPorcentaje) {
        senales.push({ tipo: 'faltantes', texto: `${f.faltantes} de ${f.vencidas} actividades vencidas sin realizar (${p100} %)` })
      }
    }
    if (usa.has('asistencias')) {
      const d = asistenciaAlumno.get(al.id)
      if (d && d.total >= umbrales.minSesiones && d.pct < umbrales.asistenciaMinimaPorcentaje) {
        senales.push({ tipo: 'asistencia', texto: `${d.pct} % de asistencia (${d.inasist} faltas en ${d.total} sesiones registradas)` })
      }
    }
    if (senales.length) candidatos.push({ alumnoId: al.id, anonId: al.anonId, senales })
  }
  const patronGrupal = alumnos.length > 0 && candidatos.length / alumnos.length > umbrales.proporcionPatronGrupal

  const rotuloPromedio = fuentesActividad.length && fuentesActividad.length < FUENTES_DE_ACTIVIDADES.length
    ? `Promedios calculados solo con: ${fuentesActividad.map(etiquetaFuente).join(', ')}. Pueden diferir de la tabla de Calificaciones.`
    : null

  return {
    datos: {
      totalEstudiantes: alumnos.length,
      promedioMinimo: umbrales.promedioMinimo,
      promedioGeneral, rotuloPromedio,
      parciales: fuentesActividad.length ? resumenParciales : [],
      actividades, mejores, criticas, evolucion, asistencia, sinEntrega,
      patronGrupal,
    },
    candidatos,
  }
}

// ── Prompt ──────────────────────────────────────────────────────────────────
const ASIGNATURA_SISTEMA =
  'Eres el asistente pedagógico de Evalúa Fácil y trabajas dentro de la asignatura de un docente de bachillerato ' +
  'mexicano. Vas a redactar un informe integral del grupo a partir de datos YA CALCULADOS por la plataforma. ' +
  'Analizas EXCLUSIVAMENTE lo que se te entrega: no inventes ni recalcules números, actividades, estudiantes, ' +
  'criterios ni causas. Cuando cites una cifra debe ser una de las que aparecen en los datos. Si los datos no ' +
  'alcanzan para una conclusión, dilo en vez de inferir. Solo existen las fuentes que aparecen: si no hay bloque de ' +
  'asistencia, de entregas faltantes o de algún tipo de actividad, no hables de ello ni lo supongas. ' +
  'Sobre los estudiantes: SOLO puedes referirte a los identificadores de la lista "ESTUDIANTES QUE REQUIEREN ' +
  'ATENCIÓN", nunca a otro, y siempre como señales a revisar. No hagas diagnósticos, no uses etiquetas clínicas ni ' +
  'psicológicas y no especules sobre causas personales, familiares, emocionales o de salud. Si mencionas a un ' +
  'estudiante, escribe su identificador EXACTAMENTE como aparece (por ejemplo "Alumno 3"), sin abreviarlo ni ' +
  'cambiarlo. Las recomendaciones ' +
  'deben ser acciones concretas que el docente puede realizar y deben derivarse únicamente de las señales dadas. ' +
  'Escribe en español claro y breve, sin tecnicismos. Responde únicamente con el JSON del esquema indicado, sin ' +
  'texto adicional.'

function lineaActividad(a) {
  let t = `- [P${a.parcial}] ${a.tipo} "${a.nombre}": `
  t += a.promedio != null
    ? `promedio ${a.promedio} sobre 10 (${a.calificados} calificados, ${a.aprobadosPct} % con calificación aprobatoria)`
    : 'sin calificaciones todavía'
  if (a.peso != null) t += `; peso ${a.peso}`
  if (a.entregaron != null) t += `; ${a.entregaron} entregaron en la plataforma, ${a.calificadasSinArchivo} calificadas sin archivo en la plataforma, ${a.sinCalificar} entregas sin calificar, ${a.tardias} entregas tardías`
  if (a.finalizaron != null) t += `; ${a.finalizaron} la terminaron, ${a.enProgreso} la dejaron sin terminar`
  if (a.instrucciones) t += `\n  Instrucciones: """${a.instrucciones}"""`
  if (a.criterios) {
    t += `\n  ${a.instrumento}:` + a.criterios.map((c) => (
      c.niveles
        ? `\n    · ${c.nombre}: ${c.niveles.map((n) => `${n.nivel} ${n.estudiantes}`).join(', ')}`
        : `\n    · ${c.nombre}: cumplen ${c.cumplen} de ${c.evaluados}`
    )).join('')
  }
  if (a.analisisPrevio) {
    t += `\n  Análisis de resultados previo (generado el ${a.analisisPrevio.fecha}` +
      (a.analisisPrevio.pctAciertos != null ? `, ${a.analisisPrevio.pctAciertos} % de aciertos` : '') +
      `): """${a.analisisPrevio.resumen}"""`
  }
  return t
}

function promptAsignatura({ asignaturaNombre, parciales, fuentes, datos, candidatos }) {
  const usa = new Set(fuentes)
  const bloques = []
  bloques.push(
    `ASIGNATURA: "${asignaturaNombre || 'sin nombre'}". ${datos.totalEstudiantes} estudiantes inscritos.\n` +
    `PARCIALES ANALIZADOS: ${parciales.join(', ')}.\n` +
    `FUENTES INCLUIDAS (solo estas existen para este informe): ${fuentes.map(etiquetaFuente).join(', ')}.` +
    (datos.rotuloPromedio ? `\nNOTA: ${datos.rotuloPromedio}` : '')
  )
  if (datos.parciales.length) {
    bloques.push('RESULTADOS POR PARCIAL (escala de 10; mínimo aprobatorio ' + datos.promedioMinimo + '):\n' +
      datos.parciales.map((p) => (
        p.promedioGrupo != null
          ? `- Parcial ${p.parcial} (${p.estado}): promedio del grupo ${p.promedioGrupo}; ${p.aprobados} con promedio aprobatorio, ${p.reprobados} por debajo, ${p.sinCalificaciones} sin calificaciones; ${p.actividades} actividades${p.ponderacion ? '; promedio ponderado' : ''}`
          : `- Parcial ${p.parcial} (${p.estado}): sin calificaciones todavía`
      )).join('\n') +
      (datos.promedioGeneral != null ? `\nPromedio general del grupo en lo analizado: ${datos.promedioGeneral}.` : ''))
    for (const f of FUENTES_DE_ACTIVIDADES) {
      if (!usa.has(f)) continue
      const lista = datos.actividades.filter((a) => a.fuente === f)
      if (lista.length) bloques.push(`${etiquetaFuente(f).toUpperCase()}:\n${lista.map(lineaActividad).join('\n')}`)
    }
    if (datos.mejores.length) bloques.push('ACTIVIDADES CON MEJOR RESULTADO (dato): ' + datos.mejores.map((a) => `"${a.nombre}" (${a.tipo}, P${a.parcial}, ${a.promedio})`).join('; '))
    if (datos.criticas.length) bloques.push('ACTIVIDADES CON RESULTADO MÁS BAJO (dato): ' + datos.criticas.map((a) => `"${a.nombre}" (${a.tipo}, P${a.parcial}, ${a.promedio})`).join('; '))
  }
  if (datos.evolucion) {
    const e = datos.evolucion
    bloques.push('EVOLUCIÓN ENTRE PARCIALES:\n' +
      e.porParcial.map((p) => `- Parcial ${p.parcial}: promedio del grupo ${p.promedioGrupo}`).join('\n') +
      `\nDe ${e.comparables} estudiantes con calificaciones en más de un parcial: ${e.mejoraron} con mejora de ${e.cambioRelevante} punto(s) o más, ${e.bajaron} con baja de ${e.cambioRelevante} punto(s) o más y ${e.estables} sin cambio relevante.`)
  }
  if (usa.has('asistencias') && datos.asistencia) {
    const a = datos.asistencia
    bloques.push('ASISTENCIA (sesiones con registro; las justificadas cuentan como asistencia):\n' +
      `Grupo: ${a.pctGrupo} % de asistencia (${a.asistencias} asistencias, de ellas ${a.justificadas} justificadas, y ${a.faltas} faltas en ${a.total} registros). ` +
      `${a.debajoDelMinimo} de ${a.estudiantesConRegistro} estudiantes están por debajo de ${a.minimo} %.\n` +
      a.porParcial.map((p) => `- Parcial ${p.parcial}: ${p.pct} % de asistencia (${p.faltas} faltas en ${p.total} registros)`).join('\n') +
      (a.relacion ? `\nPromedio de calificaciones de quienes están por debajo de ${a.minimo} % de asistencia: ${a.relacion.promedioDebajoDelMinimo}; del resto: ${a.relacion.promedioResto}.` : ''))
  }
  if (usa.has('sinEntrega') && datos.sinEntrega) {
    const s = datos.sinEntrega
    bloques.push('ENTREGAS NO REALIZADAS (solo actividades ya vencidas cuentan como no realizadas; "calificada sin archivo en la plataforma" NO es incumplimiento):\n' +
      `Total: ${s.totalNoRealizadas} no realizadas y ${s.totalIncompletas} iniciadas sin terminar; ${s.estudiantesConFaltantes} estudiantes con al menos una. ` +
      `${s.totalEnPlazo} siguen en plazo. ${s.actividadesSinFechaLimite} actividad(es) no tienen fecha límite y no se cuentan como incumplimiento.\n` +
      s.actividades.map((f) => `- [P${f.parcial}] ${f.tipo} "${f.nombre}": ${f.noRealizadas} no realizadas, ${f.incompletas} sin terminar, ${f.enPlazo} en plazo${f.sinFechaLimite ? `, ${f.sinFechaLimite} pendientes sin fecha límite` : ''}`).join('\n'))
  }
  bloques.push('ESTUDIANTES QUE REQUIEREN ATENCIÓN (ya identificados por la plataforma con criterios fijos — SOLO puedes hablar de estos):\n' +
    (candidatos.length
      ? candidatos.map((c) => `- ${c.anonId}: ${c.senales.map((s) => s.texto).join('; ')}`).join('\n')
      : '(ninguno con las fuentes analizadas — no propongas ninguno)') +
    (datos.patronGrupal ? `\nIMPORTANTE: son ${candidatos.length} de ${datos.totalEstudiantes} estudiantes, más de la mitad del grupo. Trátalo como un PATRÓN DEL GRUPO, no como casos individuales aislados, y dilo así en el resumen, las dificultades y la conclusión.` : ''))

  return bloques.join('\n\n') + '\n\n' +
    'Responde SOLO con este JSON (usa arreglos vacíos cuando no haya nada que decir con los datos):\n' +
    '{\n' +
    '  "resumenEjecutivo": "<3-5 frases: situación general del grupo, para leerse antes que el detalle>",\n' +
    '  "fortalezas": ["<fortaleza del grupo sustentada en un dato de arriba>"],\n' +
    '  "dificultades": ["<dificultad principal sustentada en un dato de arriba>"],\n' +
    (datos.evolucion
      ? '  "evolucion": "<2-4 frases sobre mejoras, retrocesos y cambios entre los parciales analizados>",\n'
      : '  "evolucion": null,\n') +
    '  "areasCriticas": ["<actividad o área donde se concentran las dificultades y por qué, según los datos>"],\n' +
    '  "recomendacionesGenerales": ["<acción concreta para todo el grupo>"],\n' +
    '  "recomendacionesEstudiantes": [{"anonId": "<EXACTAMENTE uno de la lista de arriba>", "recomendacion": "<una acción concreta derivada de SUS señales, máx 40 palabras>"}],\n' +
    '  "conclusion": "<2-4 frases: situación académica general y principales aspectos que requieren atención>"\n' +
    '}\n' +
    (candidatos.length ? 'Incluye una recomendación para CADA estudiante de la lista.' : 'No hay estudiantes en la lista: "recomendacionesEstudiantes" debe ser [].')
}

const listaTexto = (arr, max, largo) => (Array.isArray(arr) ? arr : [])
  .map((x) => String(x || '').trim().slice(0, largo)).filter(Boolean).slice(0, max)

// La IA propone SOLO texto. Un identificador fuera de la lista de candidatos
// se descarta, y la evolución se anula si no hubo datos para compararla.
function normalizarInforme(datosIA, { datos, candidatos }) {
  const validos = new Set(candidatos.map((c) => c.anonId))
  const recs = new Map()
  for (const r of Array.isArray(datosIA?.recomendacionesEstudiantes) ? datosIA.recomendacionesEstudiantes : []) {
    const texto = String(r?.recomendacion || '').trim().slice(0, 400)
    if (validos.has(r?.anonId) && texto && !recs.has(r.anonId)) recs.set(r.anonId, texto)
  }
  return {
    informe: {
      resumenEjecutivo: String(datosIA?.resumenEjecutivo || '').trim().slice(0, 1500),
      fortalezas: listaTexto(datosIA?.fortalezas, 8, 400),
      dificultades: listaTexto(datosIA?.dificultades, 8, 400),
      evolucion: datos.evolucion ? String(datosIA?.evolucion || '').trim().slice(0, 1200) : '',
      areasCriticas: listaTexto(datosIA?.areasCriticas, 8, 400),
      recomendacionesGenerales: listaTexto(datosIA?.recomendacionesGenerales, 10, 400),
      conclusion: String(datosIA?.conclusion || '').trim().slice(0, 1200),
    },
    recomendacionPorAnonId: recs,
  }
}

// ── Lectura de datos (Admin SDK) ────────────────────────────────────────────
async function cargarAsignaturaDelDocente(db, uid, asignaturaId) {
  if (!asignaturaId) throw new HttpsError('invalid-argument', 'Falta la asignatura a analizar')
  const snap = await db.doc(`subjects/${asignaturaId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'La asignatura no existe')
  const subject = snap.data()
  if (subject.docenteId !== uid) throw new HttpsError('permission-denied', 'Esta asignatura no es tuya')
  return subject
}

async function cargarEstudiantes(db, asignaturaId) {
  const snap = await db.collection('students').where('asignaturaId', '==', asignaturaId).get()
  return snap.docs
    .map((d) => {
      const s = d.data()
      // Solo lo necesario: identidad para el informe final y fecha de alta.
      return { id: d.id, nombre: s.nombre || '', apellidoPaterno: s.apellidoPaterno || '', apellidoMaterno: s.apellidoMaterno || '', orden: s.orden ?? 0, createdAt: s.createdAt || null }
    })
    .sort((a, b) => (a.orden - b.orden) || a.id.localeCompare(b.id))
}

async function cargarActividades(db, asignaturaId) {
  const snap = await db.collection('activities').where('asignaturaId', '==', asignaturaId).get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

async function cargarEntregas(db, actividadIds) {
  const mapa = new Map()
  for (let i = 0; i < actividadIds.length; i += 30) {
    const chunk = actividadIds.slice(i, i + 30)
    const snap = await db.collection('submissions').where('actividadId', 'in', chunk).get()
    for (const d of snap.docs) {
      const s = d.data()
      if (!mapa.has(s.actividadId)) mapa.set(s.actividadId, new Map())
      const previo = mapa.get(s.actividadId).get(s.alumnoId)
      // Si hubiera dos documentos para la misma pareja, manda el calificado.
      if (!previo || (previo.calificacion == null && s.calificacion != null)) mapa.get(s.actividadId).set(s.alumnoId, s)
    }
  }
  return mapa
}

async function cargarAsistencia(db, asignaturaId) {
  const snap = await db.collection('attendance').where('asignaturaId', '==', asignaturaId).get()
  // Solo lo que cuenta asistencias: ni motivos ni textos salen de aquí.
  return snap.docs.map((d) => {
    const r = d.data()
    return { fecha: r.fecha, slot: r.slot, parcial: r.parcial, presentes: r.presentes || {}, justificadas: r.justificadas || {} }
  })
}

// Análisis de resultados ya guardado de un cuestionario/examen (OP-10). Solo
// se reutiliza si sigue VIGENTE: se generó con el mismo número de entregas
// finalizadas que hay hoy. Las encuestas (sin aciertos) no entran.
async function cargarAnalisisExamenes(db, actividades, entregas) {
  const mapa = new Map()
  await Promise.all(actividades.map(async (a) => {
    const snap = await db.collection(`activities/${a.id}/analisisIA`).get()
    if (snap.empty) return
    const ultimo = snap.docs.map((d) => d.data())
      .sort((x, y) => (millisDe(y.generadoEn) || 0) - (millisDe(x.generadoEn) || 0))[0]
    const r = ultimo?.resultado
    if (!r || r.tipo === 'encuesta_contexto' || !r.resumenGeneral) return
    const finalizadas = [...(entregas.get(a.id)?.values() || [])].filter((s) => s.estadoEvaluacion === 'finalizado').length
    if (ultimo.entregasConsideradas !== finalizadas) return
    const ms = millisDe(ultimo.generadoEn)
    mapa.set(a.id, {
      resumen: String(r.resumenGeneral).slice(0, 600),
      pctAciertos: esNumero(r.porcentajeAciertosGeneral) ? r.porcentajeAciertosGeneral : null,
      fecha: ms ? fechaHoyMexico(new Date(ms)) : 'fecha no registrada',
    })
  }))
  return mapa
}

// ── Preparación gratuita ────────────────────────────────────────────────────
// No llama a la IA ni toca créditos. Devuelve qué fuentes tienen datos en cada
// parcial y cuánto cuesta cada una, para que el diálogo marque "Sin datos" y
// muestre el costo de la selección al instante.
async function prepararDatos({ uid, asignaturaId, tarifas }) {
  const db = getFirestore()
  const { costoPorFuente } = configAnalisis(tarifas)
  const subject = await cargarAsignaturaDelDocente(db, uid, asignaturaId)
  const [students, activities, attendance] = await Promise.all([
    cargarEstudiantes(db, asignaturaId), cargarActividades(db, asignaturaId), cargarAsistencia(db, asignaturaId),
  ])
  const entregas = await cargarEntregas(db, activities.filter(actividadElegible).map((a) => a.id))
  const disponibilidadPorParcial = calcularDisponibilidad({ subject, activities, students, entregas, attendance, hoyISO: fechaHoyMexico() })
  const total = Math.max(1, Number(subject.parciales) || 3)
  return {
    parciales: Array.from({ length: total }, (_, i) => ({ numero: i + 1, estado: estadoParcial(subject, i + 1) })),
    disponibilidadPorParcial,
    costoPorFuente,
    totalEstudiantes: students.length,
  }
}

const prepararAnalisisAsignatura = onCall(async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para continuar')
  const perfil = await getFirestore().doc(`users/${uid}`).get()
  if (!perfil.exists || perfil.data().role !== 'docente') {
    throw new HttpsError('permission-denied', 'El análisis de asignatura es para docentes')
  }
  let tarifas
  try {
    tarifas = await ledger.cargarTarifas()
  } catch {
    throw new HttpsError('failed-precondition', 'El análisis de asignatura todavía no está configurado en el servidor.')
  }
  return prepararDatos({ uid, asignaturaId: String(request.data?.asignaturaId || ''), tarifas })
})

// ── Comprobación previa (antes de reservar créditos) ────────────────────────
async function precheckAnalizarAsignatura({ uid, params, tarifas, textoPlano }) {
  const db = getFirestore()
  const { costoPorFuente, umbrales } = configAnalisis(tarifas)
  const asignaturaId = String(params?.asignaturaId || '')
  const subject = await cargarAsignaturaDelDocente(db, uid, asignaturaId)

  const parciales = parcialesValidos(params?.parciales, Math.max(1, Number(subject.parciales) || 3))
  if (!parciales.length) throw new HttpsError('invalid-argument', 'Elige al menos un parcial para analizar.')
  const pedidas = CLAVES_FUENTES.filter((c) => Array.isArray(params?.fuentes) && params.fuentes.includes(c))
  if (!pedidas.length) throw new HttpsError('invalid-argument', 'Elige al menos una fuente de datos para analizar.')
  const usa = new Set(pedidas)

  const [students, todas] = await Promise.all([cargarEstudiantes(db, asignaturaId), cargarActividades(db, asignaturaId)])
  if (!students.length) {
    throw new HttpsError('failed-precondition', 'Esta asignatura todavía no tiene estudiantes. No se descontaron créditos.', { codigo: 'CONTEXTO_INSUFICIENTE' })
  }
  // Una fuente desmarcada no se consulta: solo se leen las actividades de los
  // tipos marcados (y de sus parciales), y la asistencia solo si entra.
  const activities = todas.filter((a) => actividadElegible(a) && parciales.includes(a.parcial) && usa.has(fuenteDeActividad(a)))
  const [entregas, attendance] = await Promise.all([
    cargarEntregas(db, activities.map((a) => a.id)),
    usa.has('asistencias') ? cargarAsistencia(db, asignaturaId) : [],
  ])
  const ahora = new Date()
  const disponibilidad = calcularDisponibilidad({ subject, activities, students, entregas, attendance, hoyISO: fechaHoyMexico(ahora) })
  const fuentes = fuentesEfectivas(disponibilidad, parciales, pedidas)
  if (!fuentes.length) {
    throw new HttpsError('failed-precondition',
      'No hay datos suficientes en los parciales y fuentes elegidos. No se descontaron créditos.', { codigo: 'CONTEXTO_INSUFICIENTE' })
  }
  const costo = costoAnalisis(costoPorFuente, fuentes)
  if (!Number.isInteger(costo) || costo < 1) {
    throw new HttpsError('failed-precondition', 'El costo del análisis no está bien configurado en el servidor. No se descontaron créditos.', { codigo: 'ANALISIS_SIN_CONFIGURAR' })
  }
  // Nunca se cobra distinto de lo que el docente confirmó: si los datos
  // cambiaron entre la pantalla y la confirmación (o alguna fuente pedida ya
  // no tiene datos), se rechaza antes de reservar y se pide actualizar.
  if (fuentes.length !== pedidas.length || Number(params?.costoConfirmado) !== costo) {
    throw new HttpsError('failed-precondition',
      'Los datos de la asignatura cambiaron y el costo del análisis ya no es el que confirmaste. Revisa la configuración e inténtalo de nuevo. No se descontaron créditos.',
      { codigo: 'COSTO_CAMBIO', costo })
  }

  const evaluaciones = usa.has('evaluaciones') ? activities.filter((a) => fuenteDeActividad(a) === 'evaluaciones') : []
  const analisisExamenes = evaluaciones.length ? await cargarAnalisisExamenes(db, evaluaciones, entregas) : new Map()

  const { datos, candidatos } = agregarAsignatura({
    subject, students, activities, entregas, attendance, analisisExamenes, parciales, fuentes, umbrales, ahora, textoPlano,
  })
  return {
    asignaturaId,
    asignaturaNombre: String(subject.nombre || '').trim().slice(0, 120),
    parciales, fuentes, datos, candidatos,
    // Solo para armar el informe final en el servidor: NUNCA entra al prompt.
    nombres: Object.fromEntries(students.map((s) => [s.id, { nombre: s.nombre, apellidoPaterno: s.apellidoPaterno, apellidoMaterno: s.apellidoMaterno }])),
    unidadesMinimas: costo,
  }
}

const nombreCompleto = (n) => [n?.apellidoPaterno, n?.apellidoMaterno, n?.nombre].map(capitalizarNombre).filter(Boolean).join(' ')

// El modelo solo conoce a los estudiantes como "Alumno N". Si los menciona en
// un texto, aquí —ya fuera del modelo— se cambia el identificador por el
// nombre completo, para que el docente lea nombres y no claves. Solo se
// traducen los identificadores que el modelo recibió (los candidatos).
function ponerNombres(texto, nombrePorAnonId) {
  return String(texto || '').replace(/\bAlumno (\d+)\b/g, (m) => nombrePorAnonId.get(m) || m)
}

// Lo que se guarda: la fotografía del análisis. Los nombres quedan como eran
// ese día; el informe no vuelve a leer `students`.
function documentoAnalisis(ctx, informe, recomendacionPorAnonId, uid) {
  const nombrePorAnonId = new Map(ctx.candidatos.map((c) => [c.anonId, nombreCompleto(ctx.nombres[c.alumnoId])]).filter(([, n]) => n))
  const conNombres = (v) => (Array.isArray(v) ? v.map((x) => ponerNombres(x, nombrePorAnonId)) : ponerNombres(v, nombrePorAnonId))
  const informeConNombres = Object.fromEntries(Object.entries(informe).map(([k, v]) => [k, conNombres(v)]))
  // `instrucciones` solo sirvió de contexto para el prompt: no se guarda.
  const actividades = ctx.datos.actividades.map((a) => {
    const copia = { ...a }
    delete copia.instrucciones
    return copia
  })
  return {
    version: 1,
    docenteId: uid,
    asignaturaId: ctx.asignaturaId,
    parciales: ctx.parciales,
    fuentes: ctx.fuentes,
    datos: { ...ctx.datos, actividades },
    informe: informeConNombres,
    estudiantesAtencion: ctx.candidatos.map((c) => ({
      ...(ctx.nombres[c.alumnoId] || { nombre: '', apellidoPaterno: '', apellidoMaterno: '' }),
      senales: c.senales,
      recomendacion: ponerNombres(recomendacionPorAnonId.get(c.anonId) || '', nombrePorAnonId),
    })),
  }
}

// `pedirJSON` lo inyecta functions/ia.js (la misma llamada al modelo que usan
// las demás operaciones).
async function ejecutarAnalizarAsignatura({ params, modelo, apiKey, pedirJSON }) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const ctx = params.__contexto // lo puso el precheck; el cliente no puede tocarlo

  const { datos: datosIA, interno } = await pedirJSON({
    client, modelo, maxTokens: 8000, system: ASIGNATURA_SISTEMA, prompt: promptAsignatura(ctx),
  })
  const { informe, recomendacionPorAnonId } = normalizarInforme(datosIA, ctx)
  // Sin resumen ni conclusión no hay informe aprovechable: no se guarda ni se
  // cobra — cae al catch del callable y reembolsa.
  if (!informe.resumenEjecutivo || !informe.conclusion) {
    throw new Error('El asistente de IA no generó un informe utilizable')
  }

  // Se guarda ANTES de liquidar: si esta escritura falla, la operación cae al
  // reembolso y el docente no paga por un informe que no quedó guardado. El
  // id es la clave de idempotencia: un reintento no crea un segundo informe.
  const analisisId = params.__idempotencyKey
  await getFirestore().doc(`subjects/${ctx.asignaturaId}/analisisIA/${analisisId}`).set({
    ...documentoAnalisis(ctx, informe, recomendacionPorAnonId, params.__uid),
    generadoEn: FieldValue.serverTimestamp(),
  })

  return {
    // Solo la referencia: el informe (con nombres) vive en un solo lugar.
    resultado: { analisisId, asignaturaId: ctx.asignaturaId },
    unidadesReales: ctx.unidadesMinimas,
    interno: { ...interno, estudiantes: ctx.datos.totalEstudiantes, actividades: ctx.datos.actividades.length, fuentes: ctx.fuentes.length },
  }
}

// ── Sin huérfanos: el historial se va con su asignatura ─────────────────────
// Firestore no borra subcolecciones al borrar el documento padre, y las reglas
// no dejan que ningún cliente borre un informe. Este disparador limpia el
// historial cuando la asignatura se elimina, por cualquier camino.
async function borrarAnalisisDeAsignatura(subjectId) {
  const db = getFirestore()
  await db.recursiveDelete(db.collection(`subjects/${subjectId}/analisisIA`))
}

const limpiarAnalisisAsignatura = onDocumentDeleted('subjects/{subjectId}', async (event) => {
  try {
    await borrarAnalisisDeAsignatura(event.params.subjectId)
  } catch (e) {
    logger.error(`limpiarAnalisisAsignatura(${event.params.subjectId}):`, e)
    throw e
  }
})

module.exports = {
  prepararAnalisisAsignatura,
  limpiarAnalisisAsignatura,
  precheckAnalizarAsignatura,
  ejecutarAnalizarAsignatura,
  _pruebas: {
    configAnalisis, CLAVES_UMBRALES, calcularDisponibilidad, agregarAsignatura, promptAsignatura, normalizarInforme,
    documentoAnalisis, ponerNombres, estadoPlazo, estadoRealizacion, instanteLimite, fechaMexicoAMillis, actividadElegible,
    prepararDatos, borrarAnalisisDeAsignatura, ASIGNATURA_SISTEMA,
  },
}
