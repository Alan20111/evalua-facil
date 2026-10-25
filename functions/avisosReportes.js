// Aviso por correo al admin de cada Reporte de IA y de cada Sugerencia a
// Evalúa Fácil (24-oct-2026).
//
// Antes, un reporte quedaba en `reportesIA` y nadie se enteraba si no abría
// esa pestaña del panel. Ahora cada documento NUEVO de `reportesIA` o de
// `sugerencias` manda un correo a admin.evaluafacil@gmail.com por Brevo (el
// mismo proveedor y el mismo remitente que api/_lib/email.js).
//
// Reglas de este módulo:
//   · El documento ya está guardado cuando esto corre (es un disparador de
//     creación): un fallo del correo NUNCA lo pierde. Sigue en el panel.
//   · El estado del aviso vive en el propio documento, en `notificacion`:
//       enviando → enviado            (con el id que devuelve Brevo)
//       enviando → fallido → …        (lo reintenta el barrido programado)
//       agotado                        (se acabaron los intentos)
//       omitido                        (duplicado, límite por persona o tope
//                                       del día: el registro se guarda igual)
//     Nunca se guarda la clave ni la respuesta cruda del proveedor: solo un
//     código corto (`http_401`, `red`, `tiempo_agotado`, …).
//   · Un aviso se RECLAMA en una transacción antes de enviarse. Dos
//     ejecuciones a la vez (el disparador y el barrido, o un evento
//     repetido) no mandan dos correos: la segunda ve el reclamo y se va.
//     Lo que no se puede evitar: si Brevo acepta el correo y la función muere
//     antes de anotar «enviado», el barrido lo reintenta y sale un segundo
//     correo. No se garantiza exactamente uno.
//   · Los nombres (quién reportó, asignatura, actividad, alumno de la
//     entrega) los busca AQUÍ el servidor, con el Admin SDK. El cliente solo
//     manda ids, y solo se resuelven si son del propio docente que reporta.
//   · El correo no lleva el texto de la respuesta de la IA (puede traer
//     nombres y calificaciones de alumnos): ese se consulta en el panel.

const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const catalogo = require('./_shared/catalogoReportes.js')

const BREVO_API_KEY = defineSecret('BREVO_API_KEY')

const CONFIG = {
  destinatario: 'admin.evaluafacil@gmail.com',
  remitente: { email: 'soporte@evaluafacil.mx', name: 'Evalúa Fácil' },
  urlAdmin: 'https://www.evaluafacil.mx/Admin',
  // Correos por día (hora de la Ciudad de México), sumando los dos tipos. El
  // plan gratuito de Brevo da del orden de 300 diarios para TODA la cuenta,
  // que también manda bienvenidas y avisos de cuenta: esto deja margen.
  topeDiario: 50,
  // Correos por persona por hora, en cada tipo.
  topePorPersonaHora: 5,
  // El mismo contenido de la misma persona dentro de esta ventana no repite
  // correo.
  ventanaDuplicadoMs: 10 * 60 * 1000,
  maxIntentos: 5,
  // Un reclamo «enviando» más viejo que esto se da por muerto y se reintenta.
  arriendoMs: 10 * 60 * 1000,
  // El barrido también atiende lo que el disparador nunca tocó, pero solo de
  // este último día: lo de antes de existir este módulo no se avisa.
  ventanaSinAvisoMs: 24 * 60 * 60 * 1000,
  esperaSinAvisoMs: 10 * 60 * 1000,
  tiempoEnvioMs: 15 * 1000,
}

const ESTADOS_CERRADOS = new Set(['enviado', 'omitido', 'agotado'])
const COLECCIONES = ['reportesIA', 'sugerencias']

function db() {
  return getFirestore()
}

function millis(t) {
  if (!t) return 0
  if (typeof t.toMillis === 'function') return t.toMillis()
  if (t instanceof Date) return t.getTime()
  return Number(t) || 0
}

function diaMexico(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}

function fechaLegible(ms) {
  if (!ms) return ''
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'long', timeStyle: 'short' }).format(new Date(ms))
}

function nombreDePersona(d) {
  if (!d) return ''
  const completo = [d.nombre, d.apellidoPaterno, d.apellidoMaterno].filter(Boolean).join(' ').trim()
  return completo || String(d.nombreMostrar || '').trim()
}

function nombreDeAlumno(s) {
  if (!s) return ''
  return [s.nombre, s.apellidoPaterno, s.apellidoMaterno].filter(Boolean).join(' ').trim()
}

// ── Contexto: quién reportó y sobre qué ─────────────────────────────────────

async function leer(coleccion, id) {
  if (!id || typeof id !== 'string') return null
  const snap = await db().collection(coleccion).doc(id).get()
  return snap.exists ? { id: snap.id, ...snap.data() } : null
}

async function resolverReportante(uid) {
  const usuario = await leer('users', uid)
  if (usuario) {
    return {
      rol: usuario.role || '',
      nombre: nombreDePersona(usuario),
      correo: usuario.email || '',
      usuario: usuario.username || '',
    }
  }
  // Estudiante: no tiene users/{uid}; tiene una inscripción por asignatura.
  const inscripciones = await db().collection('students').where('uid', '==', uid).limit(1).get()
  if (!inscripciones.empty) {
    const s = inscripciones.docs[0].data()
    return { rol: 'alumno', nombre: nombreDeAlumno(s), correo: '', usuario: s.username || '' }
  }
  return { rol: '', nombre: '', correo: '', usuario: '' }
}

// Reportes hechos antes de que la pantalla mandara ids separados: su
// `contextoId` es, según la operación, el id de la entrega, de la actividad o
// de la asignatura (ver cada <ReportarIA> de la app). Solo para estas
// operaciones; en las demás no se adivina.
const CONTEXTO_LEGADO = {
  calificar_entregable_ia: 'entregaId',
  analizar_resultados: 'actividadId',
  generar_preguntas_video: 'actividadId',
  generar_contenido_juego: 'actividadId',
  planeacion_didactica_inicial: 'asignaturaId',
}

function idsDeReporte(datos) {
  const ids = { asignaturaId: datos.asignaturaId || '', actividadId: datos.actividadId || '', entregaId: datos.entregaId || '' }
  const campoLegado = CONTEXTO_LEGADO[datos.operacion]
  if (campoLegado && !ids.asignaturaId && !ids.actividadId && !ids.entregaId && datos.contextoId) {
    ids[campoLegado] = datos.contextoId
  }
  return ids
}

// Solo se nombran asignatura, actividad y entrega si son del docente que
// reporta (o si reporta el admin). Un id ajeno o inconsistente se queda como
// id, sin nombre: no se revela nada de otro docente.
async function resolverReferencias(datos, reportante) {
  const ids = idsDeReporte(datos)
  const esAdmin = reportante.rol === 'admin'
  const esPropio = (doc) => esAdmin || (doc && doc.docenteId === datos.uid)
  const ref = {}

  const entrega = await leer('submissions', ids.entregaId)
  let actividadId = ids.actividadId
  if (entrega) {
    if (actividadId && entrega.actividadId !== actividadId) {
      ref.aviso = 'La entrega no pertenece a la actividad indicada; se omitieron sus datos.'
    } else {
      actividadId = entrega.actividadId
    }
  }

  const actividad = await leer('activities', actividadId)
  const actividadPropia = actividad && esPropio(actividad)
  if (actividad && actividadPropia) {
    ref.actividad = { id: actividad.id, nombre: actividad.nombre || '' }
    if (entrega && entrega.actividadId === actividad.id) {
      const alumno = await leer('students', entrega.alumnoId)
      ref.entrega = { id: entrega.id, alumno: nombreDeAlumno(alumno) || alumno?.username || '' }
    }
  }

  let asignaturaId = ids.asignaturaId
  if (actividadPropia) {
    if (asignaturaId && actividad.asignaturaId !== asignaturaId) {
      ref.aviso = 'La actividad no pertenece a la asignatura indicada; se usó la de la actividad.'
    }
    asignaturaId = actividad.asignaturaId
  }
  const asignatura = await leer('subjects', asignaturaId)
  if (asignatura && esPropio(asignatura)) {
    ref.asignatura = { id: asignatura.id, nombre: asignatura.nombre || '', grupo: asignatura.grupo || '' }
  }

  const pedidos = [ids.entregaId, ids.actividadId, ids.asignaturaId].filter(Boolean).length
  const resueltos = ['entrega', 'actividad', 'asignatura'].filter((k) => ref[k]).length
  if (pedidos && !resueltos && !ref.aviso) ref.aviso = 'Los ids del reporte no corresponden a datos de quien reportó o ya no existen.'
  return ref
}

async function resolverContexto(coleccion, datos) {
  const reportante = await resolverReportante(datos.uid)
  const contexto = { reportante }
  if (coleccion === 'reportesIA') Object.assign(contexto, await resolverReferencias(datos, reportante))
  return contexto
}

// ── Correo ──────────────────────────────────────────────────────────────────

function esc(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function corto(texto, max) {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function enlaceAlCaso(coleccion, id) {
  const tab = coleccion === 'sugerencias' ? catalogo.TAB_SUGERENCIAS : catalogo.TAB_REPORTES_IA
  return `${CONFIG.urlAdmin}?tab=${encodeURIComponent(tab)}&caso=${encodeURIComponent(id)}`
}

function describirPersona(r, rolDeclarado) {
  const rol = { docente: 'Docente', alumno: 'Estudiante', admin: 'Administrador' }[r?.rol || rolDeclarado] || 'Rol desconocido'
  const partes = [r?.nombre || 'Sin nombre registrado', rol]
  if (r?.correo) partes.push(r.correo)
  else if (r?.usuario) partes.push(`usuario ${r.usuario}`)
  return partes.join(' · ')
}

// Filas [etiqueta, valor] del correo. Una fila sin valor no se pone: lo que
// no se sabe no se escribe.
function filasDelCorreo(coleccion, datos, contexto) {
  const filas = []
  if (coleccion === 'sugerencias') {
    filas.push(['Tipo', 'Sugerencia a Evalúa Fácil'])
    filas.push(['Categoría', catalogo.etiquetaCategoriaSugerencia(datos.categoria)])
    filas.push(['Módulo', datos.modulo])
    filas.push(['Pantalla', datos.pantalla])
    filas.push(['Ruta', datos.ruta])
  } else {
    const ubicacion = catalogo.describirUbicacionIA(datos.ubicacion)
    filas.push(['Tipo', 'Reporte de IA'])
    filas.push(['Motivo', catalogo.etiquetaMotivoIA(datos.motivo)])
    filas.push(['Operación de IA', catalogo.nombreOperacionIA(datos.operacion)])
    filas.push(['Módulo', ubicacion?.modulo])
    filas.push(['Pantalla', ubicacion?.pantalla])
    filas.push(['Ruta', datos.ruta])
    const a = contexto.asignatura
    filas.push(['Asignatura', a ? [a.nombre, a.grupo && `Grupo ${a.grupo}`].filter(Boolean).join(' · ') : ''])
    filas.push(['Actividad', contexto.actividad?.nombre])
    // Privacidad (opción B, 24-oct-2026): el correo sale de la plataforma, así
    // que no lleva el nombre del alumno de la entrega. Se dice que hay una y
    // el nombre se ve en el panel.
    filas.push(['Entrega', contexto.entrega ? 'Hay una entrega relacionada (consúltala en el panel)' : ''])
    filas.push(['Nota', contexto.aviso])
  }
  filas.push(['Fecha', fechaLegible(millis(datos.creadoEn))])
  filas.push(['Enviado por', describirPersona(contexto.reportante, datos.rol)])
  return filas.filter(([, v]) => v)
}

// Reportes de IA: el comentario libre puede traer nombres, calificaciones o
// cualquier otro dato personal, así que NO viaja en el correo. Se queda en el
// registro (solo lo lee el admin) y el correo solo avisa que existe.
const AVISO_COMENTARIO_IA = 'Hay un comentario de quien reportó. Por privacidad no se incluye en este correo: consúltalo en el panel de administración.'

function construirCorreo({ coleccion, id, datos, contexto }) {
  const esSugerencia = coleccion === 'sugerencias'
  const asunto = esSugerencia
    ? `[Sugerencia a Evalúa Fácil] ${catalogo.etiquetaCategoriaSugerencia(datos.categoria)}`
    : `[Reporte de IA] ${catalogo.etiquetaMotivoIA(datos.motivo)} · ${corto(catalogo.nombreOperacionIA(datos.operacion), 60)}`
  const filas = filasDelCorreo(coleccion, datos, contexto)
  const tituloTexto = esSugerencia ? 'Descripción' : 'Comentario'
  const comentarioIA = String(datos.comentario || '').trim()
  const texto = esSugerencia
    ? String(datos.descripcion || '').trim()
    : (comentarioIA ? AVISO_COMENTARIO_IA : '')
  const enlace = enlaceAlCaso(coleccion, id)
  const encabezado = esSugerencia ? 'Nueva Sugerencia a Evalúa Fácil' : 'Nuevo Reporte de IA'

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<h1 style="font-size:18px;margin:0 0 16px">${esc(encabezado)}</h1>
<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">
${filas.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;vertical-align:top">${esc(v)}</td></tr>`).join('\n')}
</table>
<h2 style="font-size:14px;margin:20px 0 6px;color:#6b7280">${esc(tituloTexto)}</h2>
<p style="font-size:14px;margin:0;white-space:pre-wrap">${texto ? esc(texto) : '<em style="color:#6b7280">Sin comentario.</em>'}</p>
${esSugerencia ? '' : '<p style="font-size:12px;color:#6b7280;margin:16px 0 0">La respuesta de la IA que se reportó no viaja en el correo: se consulta en el panel.</p>'}
<p style="margin:24px 0 0"><a href="${esc(enlace)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">Abrir en el panel de administración</a></p>
</div></body></html>`

  const textoPlano = [
    encabezado,
    '',
    ...filas.map(([k, v]) => `${k}: ${v}`),
    '',
    `${tituloTexto}:`,
    texto || '(sin comentario)',
    '',
    `Abrir en el panel: ${enlace}`,
  ].join('\n')

  return { asunto, html, texto: textoPlano }
}

// Llamada a Brevo. Devuelve { ok, messageId } o { ok: false, codigo }. No
// lanza: un fallo aquí es un estado del aviso, no un error de la función.
async function enviarConBrevo({ apiKey, asunto, html, texto, fetchImpl = fetch }) {
  const clave = String(apiKey || '').trim()
  if (!clave) return { ok: false, codigo: 'sin_clave' }
  if (!/^[\x21-\x7E]{20,}$/.test(clave)) return { ok: false, codigo: 'clave_mal_formada' }
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), CONFIG.tiempoEnvioMs)
  try {
    const resp = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': clave, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: CONFIG.remitente,
        to: [{ email: CONFIG.destinatario, name: 'Administración de Evalúa Fácil' }],
        subject: asunto,
        htmlContent: html,
        textContent: texto,
      }),
      signal: control.signal,
    })
    const cuerpo = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      // `code` de Brevo es un identificador corto (p. ej. "unauthorized"); el
      // mensaje libre no se guarda.
      const codigoBrevo = typeof cuerpo?.code === 'string' ? `_${cuerpo.code.slice(0, 40)}` : ''
      return { ok: false, codigo: `http_${resp.status}${codigoBrevo}` }
    }
    return { ok: true, messageId: typeof cuerpo?.messageId === 'string' ? cuerpo.messageId.slice(0, 200) : '' }
  } catch (e) {
    return { ok: false, codigo: e?.name === 'AbortError' ? 'tiempo_agotado' : 'red' }
  } finally {
    clearTimeout(reloj)
  }
}

// ── Reclamo, límites y envío ────────────────────────────────────────────────

function huella(coleccion, d) {
  if (coleccion === 'sugerencias') {
    return `${d.categoria}|${String(d.descripcion || '').trim().toLowerCase().replace(/\s+/g, ' ')}`
  }
  return [d.operacion, d.contextoId, d.actividadId, d.entregaId, String(d.texto || '').slice(0, 500)].map((x) => x || '').join('|')
}

// Decide, dentro de la transacción, si este aviso se manda. Devuelve
// { omitir: motivo, referencia? } o { mandar: true }.
function decidirPrimerEnvio({ coleccion, id, datos, propios, cuota, ahora }) {
  const creado = millis(datos.creadoEn) || ahora
  const otros = propios.filter((p) => p.id !== id && p.notificacion?.estado)
  const original = otros.find((p) =>
    p.notificacion.estado !== 'omitido' &&
    Math.abs(millis(p.creadoEn) - creado) <= CONFIG.ventanaDuplicadoMs &&
    huella(coleccion, p) === huella(coleccion, datos))
  if (original) return { omitir: 'duplicado', referencia: original.id }
  const enLaHora = otros.filter((p) => p.notificacion.estado !== 'omitido' && ahora - millis(p.creadoEn) <= 60 * 60 * 1000)
  if (enLaHora.length >= CONFIG.topePorPersonaHora) return { omitir: 'limite_por_persona' }
  if ((cuota?.enviados || 0) >= CONFIG.topeDiario) return { omitir: 'tope_diario' }
  return { mandar: true }
}

// Reclama el aviso. null = otro ya lo tiene, ya terminó o se omitió.
async function reclamar({ coleccion, ref, contexto, ahora }) {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    const datos = snap.data()
    const n = datos.notificacion || {}
    if (ESTADOS_CERRADOS.has(n.estado)) return null
    if (n.estado === 'enviando' && ahora - millis(n.reclamadoEn) < CONFIG.arriendoMs) return null
    const intentos = n.intentos || 0
    const cambios = {}
    if (contexto && !datos.contexto) cambios.contexto = contexto

    if (intentos >= CONFIG.maxIntentos) {
      tx.update(ref, { ...cambios, notificacion: { ...n, estado: 'agotado', actualizadoEn: Timestamp.fromMillis(ahora) } })
      return null
    }

    // Duplicados, límite por persona y tope diario: solo la primera vez.
    // Un reintento es el mismo aviso, no uno nuevo.
    if (!n.estado) {
      const diaRef = db().collection('avisosReportesCuota').doc(diaMexico(ahora))
      const [propiosSnap, cuotaSnap] = await Promise.all([
        tx.get(db().collection(coleccion).where('uid', '==', datos.uid)),
        tx.get(diaRef),
      ])
      const propios = propiosSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const decision = decidirPrimerEnvio({ coleccion, id: ref.id, datos, propios, cuota: cuotaSnap.data(), ahora })
      if (decision.omitir) {
        tx.update(ref, {
          ...cambios,
          notificacion: {
            estado: 'omitido', motivo: decision.omitir, intentos: 0,
            ...(decision.referencia ? { referencia: decision.referencia } : {}),
            actualizadoEn: Timestamp.fromMillis(ahora),
          },
        })
        return { omitido: decision.omitir }
      }
      tx.set(diaRef, { enviados: (cuotaSnap.data()?.enviados || 0) + 1, actualizadoEn: Timestamp.fromMillis(ahora) }, { merge: true })
    }

    tx.update(ref, {
      ...cambios,
      notificacion: {
        estado: 'enviando', intentos: intentos + 1,
        reclamadoEn: Timestamp.fromMillis(ahora), actualizadoEn: Timestamp.fromMillis(ahora),
        ...(n.ultimoError ? { ultimoError: n.ultimoError } : {}),
      },
    })
    return { datos: { ...datos, ...cambios }, intento: intentos + 1 }
  })
}

// Atiende un aviso de principio a fin. `enviar({ asunto, html, texto })` es
// la llamada al proveedor (inyectable para las pruebas).
async function procesarAviso({ coleccion, ref, enviar, ahora = Date.now() }) {
  const snap = await ref.get()
  if (!snap.exists) return { resultado: 'no_existe' }
  const actual = snap.data()
  if (ESTADOS_CERRADOS.has(actual.notificacion?.estado)) return { resultado: 'ya_atendido' }

  let contexto = actual.contexto || null
  if (!contexto) {
    try {
      contexto = { ...(await resolverContexto(coleccion, actual)), calculadoEn: Timestamp.fromMillis(ahora) }
    } catch (e) {
      // Sin nombres el aviso igual sale: el panel tiene los ids.
      logger.warn('avisosReportes: no se pudo resolver el contexto', { coleccion, id: ref.id, error: e?.message })
      contexto = null
    }
  }

  const reclamo = await reclamar({ coleccion, ref, contexto, ahora })
  if (!reclamo) return { resultado: 'sin_reclamo' }
  if (reclamo.omitido) {
    logger.info('avisosReportes: aviso omitido', { coleccion, id: ref.id, motivo: reclamo.omitido })
    return { resultado: 'omitido', motivo: reclamo.omitido }
  }

  const correo = construirCorreo({ coleccion, id: ref.id, datos: reclamo.datos, contexto: reclamo.datos.contexto || contexto || {} })
  let r
  try {
    r = await enviar(correo)
  } catch {
    r = { ok: false, codigo: 'error_inesperado' }
  }
  const momento = Timestamp.fromMillis(Date.now())
  if (r?.ok) {
    await ref.update({
      'notificacion.estado': 'enviado',
      'notificacion.enviadoEn': momento,
      'notificacion.actualizadoEn': momento,
      'notificacion.proveedorId': r.messageId || '',
    })
    logger.info('avisosReportes: aviso enviado', { coleccion, id: ref.id, intento: reclamo.intento })
    return { resultado: 'enviado', intento: reclamo.intento }
  }
  const agotado = reclamo.intento >= CONFIG.maxIntentos
  await ref.update({
    'notificacion.estado': agotado ? 'agotado' : 'fallido',
    'notificacion.ultimoError': String(r?.codigo || 'desconocido').slice(0, 80),
    'notificacion.actualizadoEn': momento,
  })
  logger.warn('avisosReportes: no se pudo enviar el aviso', { coleccion, id: ref.id, intento: reclamo.intento, codigo: r?.codigo })
  return { resultado: agotado ? 'agotado' : 'fallido', codigo: r?.codigo, intento: reclamo.intento }
}

// Lo que el barrido debe volver a intentar: fallidos, reclamos muertos y lo
// que el disparador nunca tocó (del último día).
async function pendientesDe(coleccion, ahora) {
  const col = db().collection(coleccion)
  const [fallidos, enviando, nuevos] = await Promise.all([
    col.where('notificacion.estado', '==', 'fallido').get(),
    col.where('notificacion.estado', '==', 'enviando').get(),
    col.where('estado', '==', 'nuevo').get(),
  ])
  const refs = new Map()
  fallidos.docs.forEach((d) => refs.set(d.id, d.ref))
  enviando.docs
    .filter((d) => ahora - millis(d.data().notificacion?.reclamadoEn) >= CONFIG.arriendoMs)
    .forEach((d) => refs.set(d.id, d.ref))
  nuevos.docs
    .filter((d) => {
      const x = d.data()
      const edad = ahora - millis(x.creadoEn)
      return !x.notificacion && edad >= CONFIG.esperaSinAvisoMs && edad <= CONFIG.ventanaSinAvisoMs
    })
    .forEach((d) => refs.set(d.id, d.ref))
  return [...refs.values()]
}

async function barrerPendientes({ enviar, ahora = Date.now() }) {
  const resumen = {}
  for (const coleccion of COLECCIONES) {
    const refs = await pendientesDe(coleccion, ahora)
    for (const ref of refs) {
      const r = await procesarAviso({ coleccion, ref, enviar, ahora })
      resumen[r.resultado] = (resumen[r.resultado] || 0) + 1
    }
  }
  return resumen
}

function enviarDeVerdad(correo) {
  return enviarConBrevo({ apiKey: BREVO_API_KEY.value(), ...correo })
}

const OPCIONES = { secrets: [BREVO_API_KEY], retry: false, timeoutSeconds: 60, memory: '256MiB', maxInstances: 5 }

function disparador(coleccion) {
  return onDocumentCreated({ ...OPCIONES, document: `${coleccion}/{id}` }, async (event) => {
    if (!event.data) return
    try {
      await procesarAviso({ coleccion, ref: event.data.ref, enviar: enviarDeVerdad })
    } catch (e) {
      // El documento sigue guardado; el barrido lo vuelve a intentar.
      logger.error('avisosReportes: error al procesar el aviso', { coleccion, id: event.params.id, error: e?.message })
    }
  })
}

exports.onReporteIACreado = disparador('reportesIA')
exports.onSugerenciaCreada = disparador('sugerencias')

exports.reintentarAvisosReportes = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'America/Mexico_City', secrets: [BREVO_API_KEY], timeoutSeconds: 300, memory: '256MiB' },
  async () => {
    const resumen = await barrerPendientes({ enviar: enviarDeVerdad })
    if (Object.keys(resumen).length) logger.info('avisosReportes: barrido', resumen)
  }
)

exports._pruebas = {
  CONFIG, procesarAviso, barrerPendientes, construirCorreo, enviarConBrevo,
  resolverContexto, decidirPrimerEnvio, enlaceAlCaso,
}
