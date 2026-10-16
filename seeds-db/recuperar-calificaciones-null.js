// Recuperación de las 7 calificaciones «null/10» — SOLO DRY-RUN.
//
// Este script NO escribe nada: no tiene ninguna llamada de escritura (ni set,
// ni update, ni delete, ni batch). Solo lee y reporta. El modo de escritura se
// agrega aparte, después de que Kike revise este reporte y lo autorice.
//
// Causa que se está reparando (ver functions/index.js → onEvaluacionFinalizada):
// la entrega quedó 'finalizado' pero el servidor no pudo calificarla porque un
// snapshot huérfano de `intentosRespuestas/{n}` hacía abortar la transacción.
// Las respuestas SÍ quedaron marcadas, así que la nota se puede recalcular con
// la MISMA lógica del servidor (se importa de functions/index.js, no se copia).
//
// Uso (credenciales de la cuenta de servicio, nunca commiteadas):
//   GOOGLE_APPLICATION_CREDENTIALS="D:/Evalua Facil/secrets/firebase-adminsdk.json" \
//     node seeds-db/recuperar-calificaciones-null.js
//
// Salida: una ficha por entrega + una tabla resumen. Código de salida 2 si
// el conjunto actual NO coincide exactamente con las 7 entregas diagnosticadas.

const path = require('path')
// La misma instancia de firebase-admin que usa functions/index.js (así no se
// inicializan dos apps).
const adminPath = require.resolve('firebase-admin', { paths: [path.join(__dirname, '..', 'functions')] })
const admin = require(adminPath)
const funciones = require('../functions/index.js')
const {
  calcularPuntosPregunta, calcularCalificacion, resolverPendienteRevision, resolverCalificacionFinal,
  notaOcultaAlEstudiante,
} = funciones._pruebas

const db = admin.firestore()

// Las 7 entregas del diagnóstico del 16-oct-2026 (id = actividadId_alumnoId).
const ESPERADAS = {
  'Tww18pdRXctbYDEpCy0A_7WQRBN0I0uZLXp3g5iMp': 'Ana Gabriela · ¿Qué es una computadora?',
  'kZoA3KbIA9EmoGOvDHL9_QnxxJb2EpWUIJ15CdAre': 'Angelina Neftalí · Dominio de mouse',
  'kZoA3KbIA9EmoGOvDHL9_f1UL4v36l8kQKVD9GsXH': 'Andrea Montserrat · Dominio de mouse',
  'tHu07yR9FdiNqssZZy3F_zyGaED4VmRUWHyCNtSiD': 'Marco Antonio · Guardar como / recorte',
  'trNLXd70pYg4keGYa0hR_ZTUvllkmwYdlxk71gvKW': 'Cindy Anelyz · Consideraciones sobre actitud',
  'trNLXd70pYg4keGYa0hR_n1Okt3wafBWbrFjkOSXR': 'Alexis · Consideraciones sobre actitud',
  'trNLXd70pYg4keGYa0hR_nPT6gPAPJ8azw07oa9O2': 'Maria Guadalupe · Consideraciones sobre actitud',
}

const iso = (t) => (t?.toDate ? t.toDate().toISOString() : t ?? null)

async function analizar(id) {
  const ref = db.collection('submissions').doc(id)
  const snap = await ref.get()
  const ficha = { id, etiqueta: ESPERADAS[id] || '(no esperada)', avisos: [], existe: snap.exists }
  if (!snap.exists) { ficha.avisos.push('LA ENTREGA YA NO EXISTE'); return ficha }
  const sub = snap.data()
  Object.assign(ficha, {
    estadoEvaluacion: sub.estadoEvaluacion, estado: sub.estado, intentoActual: sub.intentoActual,
    intentos: sub.intentos || [], calificacionActual: sub.calificacion ?? null,
    pendienteRevision: sub.pendienteRevision ?? null,
    notificadoCalificacion: sub.notificadoCalificacion === true,
    notificadoEntregaDocente: sub.notificadoEntregaDocente === true,
    fechaEntrega: iso(sub.fechaEntrega), tiempoInicio: iso(sub.tiempoInicio),
  })

  // Re-verificación del estado: ¿sigue siendo una entrega sin calificar?
  if (sub.estadoEvaluacion !== 'finalizado') ficha.avisos.push(`estadoEvaluacion=${sub.estadoEvaluacion} (ya no está finalizado)`)
  if (sub.calificacion != null) ficha.avisos.push(`YA TIENE calificacion=${sub.calificacion}: no hay nada que recuperar`)
  const num = sub.intentoActual || ((sub.intentos?.length || 0) + 1)
  if ((sub.intentos || []).some((i) => i.numero === num)) ficha.avisos.push(`intentos[] ya registra el intento ${num}`)

  const actSnap = await db.collection('activities').doc(sub.actividadId).get()
  if (!actSnap.exists) { ficha.avisos.push('LA ACTIVIDAD YA NO EXISTE'); return ficha }
  const act = actSnap.data()
  const maxCalif = act.maxCalif || 10
  ficha.actividad = { nombre: act.nombre || act.titulo || null, parcial: act.parcial, maxCalif, conservar: act.evaluacion?.conservar || '(por omisión)' }
  if (act.sinCalificacion === true || act.evaluacion?.sinCalificacion === true) ficha.avisos.push('instrumento SIN calificación: no debe llevar nota')

  // Parcial cerrado: el servidor no calificaría (resultado congelado).
  const subj = act.asignaturaId ? await db.collection('subjects').doc(act.asignaturaId).get() : null
  const cerrado = !!(subj?.exists && subj.data().parcialesCerrados?.[String(act.parcial)])
  ficha.parcialCerrado = cerrado
  if (cerrado) ficha.avisos.push(`el Parcial ${act.parcial} está CERRADO: el servidor no calificaría; recuperarla requiere decisión aparte`)

  // Misma reunión de datos que el servidor: preguntas + clave + respuestas vivas.
  const [pregSnap, claveSnap, respSnap, irSnap] = await Promise.all([
    actSnap.ref.collection('preguntas').get(),
    actSnap.ref.collection('clave').get(),
    ref.collection('respuestas').get(),
    ref.collection('intentosRespuestas').get(),
  ])
  const claves = {}
  claveSnap.docs.forEach((d) => { claves[d.id] = d.data().respuestaCorrecta ?? null })
  const preguntas = pregSnap.docs.map((d) => ({ id: d.id, ...d.data(), respuestaCorrecta: claves[d.id] ?? null }))
  const vivas = {}
  respSnap.docs.forEach((d) => { vivas[d.id] = d.data() })

  const porPregunta = {}
  preguntas.forEach((p) => { porPregunta[p.id] = { puntosObtenidos: calcularPuntosPregunta(p, vivas[p.id] || {}) } })
  const calcIntento = calcularCalificacion(preguntas, porPregunta, maxCalif)
  const pendiente = resolverPendienteRevision(preguntas, porPregunta)
  const final = resolverCalificacionFinal(sub.intentos || [], calcIntento, act.evaluacion?.conservar)

  const totalPond = preguntas.reduce((s, p) => s + (p.ponderacion || 0), 0)
  const obtenida = preguntas.reduce((s, p) => s + (porPregunta[p.id].puntosObtenidos ?? 0), 0)
  Object.assign(ficha, {
    preguntas: preguntas.length, respuestasVivas: respSnap.size,
    puntosObtenidos: Math.round(obtenida * 1000) / 1000, puntosMaximos: Math.round(totalPond * 1000) / 1000,
    notaPropuesta: pendiente ? null : final, notaDelIntento: calcIntento, pendienteRevisionRecalculada: pendiente,
  })
  if (totalPond === 0) ficha.avisos.push('ponderación total = 0: la nota calculada sería 0 por la regla del servidor')
  if (pendiente) ficha.avisos.push('tiene reactivos de revisión manual sin puntos: NO se propone nota, queda «Por calificar» con el docente')
  if (preguntas.length && respSnap.size !== preguntas.length) ficha.avisos.push(`hay ${respSnap.size} respuestas para ${preguntas.length} preguntas`)

  // Consistencia: lo que el servidor dejó escrito en cada respuesta vs. lo recalculado.
  const dif = []
  const posteriores = []
  preguntas.forEach((p) => {
    const guardado = vivas[p.id]?.puntosObtenidos
    const nuevo = porPregunta[p.id].puntosObtenidos
    if (nuevo != null && guardado !== nuevo) dif.push(`${p.id}: guardado=${guardado ?? 'ausente'} recalculado=${nuevo}`)
    const r = vivas[p.id]?.respondidaEn
    if (r && sub.fechaEntrega && r.toMillis() > sub.fechaEntrega.toMillis()) posteriores.push(p.id)
  })
  if (dif.length) ficha.avisos.push(`puntos guardados ≠ recalculados en ${dif.length} reactivo(s): ${dif.join('; ')}`)
  if (posteriores.length) ficha.avisos.push(`respuestas editadas DESPUÉS de la fecha de entrega: ${posteriores.join(', ')}`)

  // Snapshots huérfanos y caso de varios números (p. ej. Marco Antonio: 1 y 2 con intentoActual 1).
  ficha.snapshots = irSnap.docs.map((d) => {
    const s = d.data()
    return { numero: d.id, calificacion: s.calificacion, creadoEn: iso(s.creadoEn), esDelIntentoActual: d.id === String(num) }
  })
  const fe = sub.fechaEntrega?.toMillis?.()
  ficha.snapshots.forEach((s) => {
    if (fe && s.creadoEn && Date.parse(s.creadoEn) < fe) s.nota = 'anterior a esta entrega → huérfano de un intento anulado'
    else if (fe && s.creadoEn) s.nota = 'POSTERIOR a esta entrega → verificar a qué intento pertenece'
  })
  if (ficha.snapshots.some((s) => Number(s.numero) !== num)) {
    ficha.avisos.push(`hay snapshots de número(s) distinto(s) del intento actual (${num}): ${ficha.snapshots.map((s) => s.numero).join(', ')} — INCONSISTENTE con intentoActual; revisar antes de escribir`)
  }

  // Efectos secundarios de escribir `calificacion` (null → número).
  const efectos = []
  let oculta = null
  try { oculta = await notaOcultaAlEstudiante(sub.actividadId) } catch { oculta = 'desconocido' }
  ficha.notaOcultaAlEstudiante = oculta
  if (sub.notificadoCalificacion === true) efectos.push('NO enviará push: notificadoCalificacion ya es true')
  else if (oculta === true) efectos.push('NO enviará push: la nota está oculta al estudiante')
  else efectos.push('ENVIARÍA el push «calificaciones» al estudiante (onSubmissionActualizada) y escribiría notificadoCalificacion:true')
  if (sub.notificadoEntregaDocente !== true) efectos.push('onSubmissionEntregada podría avisar al DOCENTE si la actividad tiene «Notificarme»')
  ficha.efectosAlEscribir = efectos
  return ficha
}

async function main() {
  console.log('DRY-RUN · recuperación de calificaciones null — NO se escribe nada\n')

  // 1) El conjunto actual del problema, buscado con el mismo criterio del diagnóstico.
  const acts = await db.collection('activities').where('tipo', '==', 'evaluacion').get()
  const sinNota = new Set(acts.docs.filter((a) => a.data().sinCalificacion === true || a.data().evaluacion?.sinCalificacion === true).map((a) => a.id))
  const finalizadas = await db.collection('submissions').where('estadoEvaluacion', '==', 'finalizado').get()
  const actuales = finalizadas.docs
    .filter((d) => acts.docs.some((a) => a.id === d.data().actividadId) && !sinNota.has(d.data().actividadId))
    .filter((d) => d.data().calificacion == null)
    .map((d) => d.id)

  const esperadas = Object.keys(ESPERADAS)
  const faltan = esperadas.filter((id) => !actuales.includes(id))
  const nuevas = actuales.filter((id) => !esperadas.includes(id))
  console.log(`Entregas finalizadas sin nota ahora: ${actuales.length} (diagnosticadas: ${esperadas.length})`)
  if (faltan.length) console.log(`  · diagnosticadas que YA NO están en ese estado: ${faltan.join(', ')}`)
  if (nuevas.length) console.log(`  · NUEVAS (no diagnosticadas, el bug sigue activo en producción): ${nuevas.join(', ')}`)

  // 2) Ficha de cada una de las diagnosticadas (y de las nuevas, para tenerlas a la vista).
  const fichas = []
  for (const id of [...esperadas, ...nuevas]) fichas.push(await analizar(id))
  fichas.forEach((f) => { console.log('\n' + '─'.repeat(72)); console.log(JSON.stringify(f, null, 2)) })

  console.log('\n' + '═'.repeat(72) + '\nRESUMEN')
  console.table(fichas.map((f) => ({
    entrega: f.etiqueta, id: f.id.slice(-6), obtenida: f.puntosObtenidos, maxima: f.puntosMaximos,
    propuesta: f.notaPropuesta == null ? '—' : `${f.notaPropuesta}/${f.actividad?.maxCalif ?? 10}`,
    avisos: f.avisos.length,
  })))
  const conAvisos = fichas.filter((f) => f.avisos.length)
  if (conAvisos.length) {
    console.log('\nAVISOS:')
    conAvisos.forEach((f) => f.avisos.forEach((a) => console.log(`  - ${f.etiqueta}: ${a}`)))
  }
  process.exitCode = faltan.length || nuevas.length ? 2 : 0
}

main().then(() => process.exit()).catch((e) => { console.error(e); process.exit(1) })
