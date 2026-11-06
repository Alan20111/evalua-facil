// Reto Exprés · «Analizar resultados con IA» de UNA competencia terminada (6-nov-2026).
//
// No es una operación nueva: es la rama de Reto de `analizar_resultados` (OP-10) en functions/ia.js. Misma tarifa
// (config/iaTarifas), mismo libro de créditos, mismo modelo y misma regla de no invención (ANALISIS_SISTEMA):
//   · TODOS los números (porcentajes, preguntas fáciles y difíciles, distribución de opciones, desempeño de cada
//     participante) los calcula este módulo a partir del registro definitivo (`retoResultados/{código}`);
//   · la IA solo redacta texto y nombra participantes por su identificador anónimo («Participante 3»), y solo los de la
//     lista de candidatos; el nombre real o el alias nunca viajan a la IA (`mapaAlumnos` se guarda para el docente);
//   · vale para las dos modalidades (inscritos y externos), con todos los participantes que quedaron en la clasificación
//     (los retirados por el docente no cuentan, como en la clasificación).
//
// Sin duplicados: el precheck rechaza (sin cobrar) una sesión que ya tiene análisis o uno en curso, y el ejecutor toma
// un candado en `retoResultados/{código}.analisisEnCurso` (solo el servidor escribe ahí) antes de llamar a la IA. Dos
// pedidos que pasen el precheck a la vez: el segundo encuentra el candado, falla y el callable le devuelve sus créditos.
// Si la IA falla, se suelta el candado y el callable reembolsa (regla general de crearCallableIA).
const { HttpsError } = require('firebase-functions/v2/https')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')

const MIN_PARTICIPANTES = 3 // el mismo mínimo del análisis de evaluaciones (MIN_ENTREGAS_ANALISIS)
const UMBRAL_ATENCION = 0.6 // mismo umbral de código que agregarResultados: < 60 % de aciertos
const CANDADO_MS = 10 * 60 * 1000 // un análisis en curso que nunca terminó deja de bloquear a los 10 min
const CODIGO_VALIDO = /^[A-Z0-9]{6,16}$/

// Multiplicar antes de dividir: 23 / 40 × 100 da 57.4999… en coma flotante y redondearía a 57 en vez de 58.
const pct = (n, d) => (d ? Math.round((n * 100) / d) : null)

/**
 * Agregación pura del registro definitivo de UNA sesión. `preguntas` = las de la sesión (id, tipo, enunciado, opciones);
 * `resultados` = retoResultados (clasificacion, detalle, realizadas). Cada participante se mide SOLO con las preguntas
 * que recibió (con orden aleatorio y terminación anticipada no todos reciben las mismas): `detalle[pid]` trae una
 * entrada por pregunta recibida y realizada, con su `preguntaId`.
 */
function agregarResultadosReto({ nombre, preguntas, resultados }) {
  const porId = new Map((preguntas || []).map((p) => [p.id, p]))
  const clasificacion = Array.isArray(resultados?.clasificacion) ? resultados.clasificacion : []
  const realizadas = Number.isInteger(resultados?.realizadas) ? resultados.realizadas : 0
  const conteo = new Map() // preguntaId → { recibieron, respondieron, aciertos, opciones: Map(opcionId → n), tiempos: [] }
  const participantes = clasificacion.map((f, i) => {
    const items = Array.isArray(resultados?.detalle?.[f.participanteId]) ? resultados.detalle[f.participanteId] : []
    let aciertos = 0
    let sinResponder = 0
    for (const d of items) {
      if (!d?.preguntaId || !porId.has(d.preguntaId)) continue
      const c = conteo.get(d.preguntaId) || { recibieron: 0, respondieron: 0, aciertos: 0, opciones: new Map(), tiempos: [] }
      c.recibieron++
      if (d.opcionSeleccionada != null) {
        c.respondieron++
        c.opciones.set(d.opcionSeleccionada, (c.opciones.get(d.opcionSeleccionada) || 0) + 1)
        if (Number.isInteger(d.tiempoDecimas)) c.tiempos.push(d.tiempoDecimas)
      } else sinResponder++
      if (d.acerto === true) { c.aciertos++; aciertos++ }
      conteo.set(d.preguntaId, c)
    }
    const recibidas = items.filter((d) => d?.preguntaId && porId.has(d.preguntaId)).length
    return { anonId: `Participante ${i + 1}`, participanteId: f.participanteId, posicion: f.posicion, aciertos, recibidas, sinResponder }
  })

  const reactivos = []
  let numero = 0
  for (const p of preguntas || []) {
    const c = conteo.get(p.id)
    if (!c || !c.recibieron) continue // no se realizó (o nadie la recibió): no se analiza
    numero++
    const opciones = Array.isArray(p.opciones) ? p.opciones : []
    const textoDe = (id) => String(opciones.find((o) => String(o.id) === String(id))?.texto ?? id).trim().slice(0, 120)
    const correctaId = resultadosCorrecta(resultados, p.id)
    const distribucionErrores = [...c.opciones.entries()]
      .filter(([id]) => correctaId == null || String(id) !== String(correctaId))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, n]) => ({ texto: textoDe(id), pct: pct(n, c.recibieron) }))
    const tiempoPromedio = c.tiempos.length ? Math.round(c.tiempos.reduce((s, t) => s + t, 0) / c.tiempos.length) : null
    reactivos.push({
      numero, id: p.id, tipo: p.tipo, enunciado: String(p.enunciado || '').trim().slice(0, 300),
      opcionCorrecta: correctaId != null ? textoDe(correctaId) : null,
      recibieron: c.recibieron, respondieron: c.respondieron, sinResponder: c.recibieron - c.respondieron,
      pctAciertos: pct(c.aciertos, c.recibieron), distribucionErrores,
      tiempoPromedioSeg: tiempoPromedio != null ? Math.round(tiempoPromedio) / 10 : null,
    })
  }
  const totalItems = reactivos.reduce((s, r) => s + r.recibieron, 0)
  const totalAciertos = participantes.reduce((s, p) => s + p.aciertos, 0)
  const porcentajeAciertosGeneral = pct(totalAciertos, totalItems)
  const ranking = [...reactivos].sort((a, b) => a.pctAciertos - b.pctAciertos)
  const reactivosDificiles = ranking.slice(0, 3)
  const reactivosFuertes = ranking.slice(-3).reverse().filter((r) => !reactivosDificiles.includes(r))
  const candidatosAtencion = participantes
    .filter((p) => p.recibidas > 0 && p.aciertos / p.recibidas < UMBRAL_ATENCION)
    .map((p) => ({ anonId: p.anonId, aciertos: p.aciertos, recibidas: p.recibidas, sinResponder: p.sinResponder }))
  // Distribución de aciertos del grupo (cuántos sacaron cada puntaje): las diferencias de desempeño sin nombres.
  const distribucion = {}
  for (const p of participantes) distribucion[p.aciertos] = (distribucion[p.aciertos] || 0) + 1

  return {
    modoReto: true, nombre, categoria: 'reto', realizadas,
    totalEstudiantes: participantes.length, totalReactivos: reactivos.length,
    porcentajeAciertosGeneral, reactivos, reactivosDificiles, reactivosFuertes, candidatosAtencion,
    desempeno: participantes.map((p) => ({ anonId: p.anonId, aciertos: p.aciertos, recibidas: p.recibidas, sinResponder: p.sinResponder })),
    distribucion,
    mapaAlumnos: participantes.map((p) => ({ anonId: p.anonId, alumnoId: p.participanteId })),
    confiabilidad: null,
  }
}

function resultadosCorrecta(resultados, preguntaId) {
  for (const items of Object.values(resultados?.detalle || {})) {
    const d = (Array.isArray(items) ? items : []).find((x) => x?.preguntaId === preguntaId)
    if (d && d.respuestaCorrecta != null) return d.respuestaCorrecta
  }
  return null
}

function promptAnalisisReto(ctx, consideraciones = '') {
  const reactivosTxt = ctx.reactivos.map((r) =>
    `${r.numero}. [${r.tipo}] "${r.enunciado}" — correcta: "${r.opcionCorrecta ?? 's/d'}". ` +
    `${r.pctAciertos}% de acierto (la recibieron ${r.recibieron}, respondieron ${r.respondieron}, sin responder ${r.sinResponder})` +
    (r.tiempoPromedioSeg != null ? `, tiempo promedio de respuesta ${r.tiempoPromedioSeg} s` : '') +
    (r.distribucionErrores.length ? `. Respuestas incorrectas más elegidas: ${r.distribucionErrores.map((e) => `"${e.texto}" (${e.pct}%)`).join(', ')}` : '')
  ).join('\n')
  const desempenoTxt = ctx.desempeno.map((p) => `${p.anonId}: ${p.aciertos} de ${p.recibidas} aciertos${p.sinResponder ? `, ${p.sinResponder} sin responder` : ''}`).join('\n')
  const distribucionTxt = Object.entries(ctx.distribucion).sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([aciertos, n]) => `${n} con ${aciertos} aciertos`).join('; ')
  const candidatosTxt = ctx.candidatosAtencion.length
    ? ctx.candidatosAtencion.map((c) => `${c.anonId}: ${c.aciertos} de ${c.recibidas} aciertos${c.sinResponder ? `, ${c.sinResponder} sin responder` : ''}`).join('\n')
    : '(ningún participante con desempeño objetivamente bajo en esta competencia — no propongas ninguno)'
  const textoConsideraciones = String(consideraciones || '').trim().slice(0, 400)
  return (
    `RETO EXPRÉS (competencia en vivo de opción múltiple y verdadero/falso, 1 punto por acierto): "${ctx.nombre}".\n` +
    `${ctx.totalEstudiantes} participantes en la clasificación. ${ctx.realizadas} preguntas realizadas.\n` +
    `% de aciertos general: ${ctx.porcentajeAciertosGeneral}%.\n` +
    `Distribución de puntajes: ${distribucionTxt}.\n` +
    `\nPREGUNTAS:\n${reactivosTxt}\n\n` +
    `DESEMPEÑO INDIVIDUAL (identificadores anónimos):\n${desempenoTxt}\n\n` +
    `CANDIDATOS A "requiere atención" (ya filtrados por Evalúa Fácil por bajo desempeño objetivo — SOLO puedes hablar de estos):\n${candidatosTxt}\n\n` +
    (textoConsideraciones
      ? `CONSIDERACIONES DEL DOCENTE — qué quiere que priorices:\n"""${textoConsideraciones}"""\nOriéntate por ellas sin dejar de cumplir todas las reglas.\n\n`
      : '') +
    'Una competencia en vivo tiene poco tiempo por pregunta: no atribuyas un error a una causa que los datos no muestren. ' +
    'Con pocos participantes o pocas preguntas, dilo y sé prudente con las conclusiones.\n' +
    'Responde SOLO con este JSON:\n' +
    '{\n' +
    '  "resumenGeneral": "<3-5 frases apoyadas SOLO en los datos: resultado del grupo, qué aprendizajes parecen consolidados y cuáles requieren reforzarse>",\n' +
    '  "patrones": [{"observacion": "<dificultad, error frecuente o diferencia de desempeño observada, máx 20 palabras>", "interpretacion": "<posible explicación pedagógica, máx 30 palabras>"}],\n' +
    '  "estudiantesAtencion": [{"anonId": "<debe ser EXACTAMENTE uno de los candidatos de arriba>", "senal": "<por qué, como señal, no diagnóstico>"}],\n' +
    '  "recomendaciones": ["<qué contenido conviene repasar y cómo, concreto>"],\n' +
    '  "resumenEjecutivo": "<2-3 frases>"\n' +
    '}'
  )
}

/** Lo que queda del texto de la IA: solo campos conocidos, recortados; los números son SIEMPRE los de `ctx`. */
function normalizarAnalisisReto(datos, ctx) {
  const anonValidos = new Set(ctx.candidatosAtencion.map((c) => c.anonId))
  return {
    origen: 'reto',
    resumenGeneral: String(datos?.resumenGeneral || '').trim().slice(0, 1500),
    porcentajeAciertosGeneral: ctx.porcentajeAciertosGeneral,
    reactivosDificiles: ctx.reactivosDificiles.map((r) => ({ numero: r.numero, enunciado: r.enunciado, pctAciertos: r.pctAciertos })),
    reactivosFuertes: ctx.reactivosFuertes.map((r) => ({ numero: r.numero, enunciado: r.enunciado, pctAciertos: r.pctAciertos })),
    patrones: (Array.isArray(datos?.patrones) ? datos.patrones : []).slice(0, 6).map((p) => ({
      observacion: String(p?.observacion || '').trim().slice(0, 200),
      interpretacion: String(p?.interpretacion || '').trim().slice(0, 300),
    })),
    estudiantesAtencion: (Array.isArray(datos?.estudiantesAtencion) ? datos.estudiantesAtencion : [])
      .filter((e) => anonValidos.has(e?.anonId)).slice(0, 10)
      .map((e) => ({ anonId: e.anonId, senal: String(e.senal || '').trim().slice(0, 300) })),
    recomendaciones: (Array.isArray(datos?.recomendaciones) ? datos.recomendaciones : []).slice(0, 8).map((r) => String(r || '').trim().slice(0, 300)),
    resumenEjecutivo: String(datos?.resumenEjecutivo || '').trim().slice(0, 500),
    mapaAlumnos: ctx.mapaAlumnos, // participanteId: el cliente lo traduce a alias / nombre; la IA nunca lo vio
    totalEstudiantes: ctx.totalEstudiantes,
    totalReactivos: ctx.totalReactivos,
    confiabilidad: null,
  }
}

/** Una sesión ya analizada o con un análisis en curso vigente. */
function estadoAnalisis(res, ahora = Date.now()) {
  if (res?.analisisId) return 'hecho'
  const c = res?.analisisEnCurso
  if (c && Number.isFinite(c.hastaMs) && c.hastaMs > ahora) return 'en_curso'
  return 'libre'
}

/** Precheck (sin cobrar): dueño, sesión del reto terminada, datos suficientes, sin análisis previo ni en curso. */
async function precheckAnalisisReto({ uid, params, act, actividadId, db = getFirestore() }) {
  const sesionId = String(params?.sesionId || '').trim().toUpperCase()
  if (!CODIGO_VALIDO.test(sesionId)) throw new HttpsError('invalid-argument', 'Falta la competencia que quieres analizar.')
  if (act.docenteId !== uid) throw new HttpsError('permission-denied', 'Este reto no es tuyo')
  const [sSnap, rSnap] = await Promise.all([db.doc(`retoSesiones/${sesionId}`).get(), db.doc(`retoResultados/${sesionId}`).get()])
  const ses = sSnap.data()
  if (!ses || ses.actividadId !== actividadId || ses.docenteId !== uid) throw new HttpsError('not-found', 'No encontramos esa competencia.')
  if (ses.estado !== 'finalizada' || !rSnap.exists) {
    throw new HttpsError('failed-precondition', 'La competencia todavía no tiene resultados. No se descontaron créditos.', { codigo: 'SIN_RESULTADOS' })
  }
  const res = rSnap.data()
  const estado = estadoAnalisis(res)
  if (estado === 'hecho') throw new HttpsError('already-exists', 'Esta competencia ya tiene su análisis. No se descontaron créditos.', { codigo: 'YA_ANALIZADA' })
  if (estado === 'en_curso') throw new HttpsError('aborted', 'El análisis de esta competencia ya se está generando. Espera un momento.', { codigo: 'EN_CURSO' })
  if (res.sinResultados || !(res.realizadas >= 1)) {
    throw new HttpsError('failed-precondition', 'La competencia terminó antes de la primera pregunta: no hay resultados que analizar. No se descontaron créditos.', { codigo: 'CONTEXTO_INSUFICIENTE' })
  }
  const ctx = agregarResultadosReto({ nombre: act.nombre || ses.titulo || 'Reto Exprés', preguntas: ses.preguntas || [], resultados: res })
  if (ctx.totalEstudiantes < MIN_PARTICIPANTES) {
    throw new HttpsError('failed-precondition',
      `Se necesitan al menos ${MIN_PARTICIPANTES} participantes en la clasificación para un análisis significativo (hay ${ctx.totalEstudiantes}). No se descontaron créditos.`,
      { codigo: 'CONTEXTO_INSUFICIENTE' })
  }
  return { ...ctx, sesionId, actividadId }
}

/**
 * Ejecutor: candado → IA → análisis guardado en `activities/{id}/analisisIA` (con `sesionId`) y su id en el registro de
 * la sesión. Cualquier fallo suelta el candado y se relanza (el callable reembolsa). `deps`: { pedirJSON, sistema }.
 */
async function ejecutarAnalisisReto({ params, modelo, client, deps, db = getFirestore() }) {
  const ctx = params.__contexto
  const clave = String(params.__idempotencyKey || require('crypto').randomUUID())
  const ref = db.doc(`retoResultados/${ctx.sesionId}`)
  await db.runTransaction(async (tx) => {
    const res = (await tx.get(ref)).data()
    if (!res) throw new HttpsError('not-found', 'La competencia ya no existe. No se descontaron créditos.')
    const estado = estadoAnalisis(res)
    if (estado === 'hecho') throw new HttpsError('already-exists', 'Esta competencia ya tiene su análisis. No se descontaron créditos.', { codigo: 'YA_ANALIZADA' })
    if (estado === 'en_curso' && res.analisisEnCurso?.clave !== clave) {
      throw new HttpsError('aborted', 'El análisis de esta competencia ya se está generando. No se descontaron créditos.', { codigo: 'EN_CURSO' })
    }
    tx.update(ref, { analisisEnCurso: { clave, hastaMs: Date.now() + CANDADO_MS } })
  })
  const soltar = () => db.runTransaction(async (tx) => {
    const res = (await tx.get(ref)).data()
    if (res?.analisisEnCurso?.clave === clave) tx.update(ref, { analisisEnCurso: FieldValue.delete() })
  }).catch(() => {})

  try {
    const { datos, interno } = await deps.pedirJSON({
      client, modelo, maxTokens: 2500, system: deps.sistema, prompt: promptAnalisisReto(ctx, params.consideraciones),
    })
    const resultado = normalizarAnalisisReto(datos, ctx)
    if (!resultado.resumenGeneral && !resultado.resumenEjecutivo) throw new Error('El asistente de IA no generó un análisis utilizable')
    const docRef = db.collection(`activities/${ctx.actividadId}/analisisIA`).doc()
    const consideraciones = String(params.consideraciones || '').trim().slice(0, 400)
    await db.runTransaction(async (tx) => {
      const res = (await tx.get(ref)).data()
      if (!res || res.analisisEnCurso?.clave !== clave || res.analisisId) throw new Error('El candado del análisis se perdió')
      tx.set(docRef, {
        resultado, consideraciones, generadoEn: FieldValue.serverTimestamp(), docenteId: params.__uid,
        entregasConsideradas: resultado.totalEstudiantes, sesionId: ctx.sesionId, origen: 'reto',
      })
      tx.update(ref, { analisisId: docRef.id, analisisGeneradoMs: Date.now(), analisisEnCurso: FieldValue.delete() })
    })
    return { resultado: { ...resultado, analisisId: docRef.id }, unidadesReales: 1, interno }
  } catch (e) {
    await soltar()
    throw e
  }
}

module.exports = {
  MIN_PARTICIPANTES, agregarResultadosReto, promptAnalisisReto, normalizarAnalisisReto, estadoAnalisis,
  precheckAnalisisReto, ejecutarAnalisisReto,
}
