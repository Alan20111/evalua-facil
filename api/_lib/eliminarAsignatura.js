// Borrado completo de UNA asignatura en el servidor (F-09, nov-2026). Acción `eliminar-asignatura` de
// /api/subject/[action] (no gasta funciones del plan de Vercel).
//
// Por qué en el servidor: desde F-09 (#1416) el navegador ya no puede listar las actividades de una asignatura sin
// filtrar por docenteId, y nunca pudo borrar las subcolecciones de actividades y entregas (preguntas, clave,
// respuestas, historial de notas…) ni los registros que solo escribe el servidor. La cascada del navegador
// (deleteSubjectCascade) se detenía a la mitad y dejaba la asignatura incompleta. Aquí se hace con Admin SDK, igual
// que el borrado de cuenta (api/account/delete.js), pero limitado a una asignatura del docente que lo pide.
//
// Reanudable: cada llamada trabaja unos segundos (presupuesto) y guarda su avance en
// `eliminacionesAsignatura/{subjectId}` (sin `match` en firestore.rules: ningún cliente lo lee ni lo escribe). La
// siguiente llamada sigue donde se quedó; el navegador llama hasta recibir `completa`. Un candado con vencimiento
// (lease) impide que dos llamadas trabajen a la vez. La asignatura se borra AL FINAL, cuando ya no queda nada suyo;
// al terminar se borra también el registro de avance (no deja residuo).
//
// Orden (fases):
//   inicio      → recoge los archivos de la asignatura y de sus subcolecciones (planeaciones, diagnósticos…)
//   actividades → cada actividad con todo lo que cuelga de ella (recursiveDelete: preguntas, clave, historiales…).
//                 Sus ids quedan guardados antes de borrarla, para encontrar después sus entregas. Al borrarlas se
//                 disparan los triggers de siempre (Reto Exprés, Participación en vivo, La Ruleta, análisis), que
//                 limpian lo suyo; aquí no se duplica esa limpieza.
//   entregas    → entregas por actividad y por estudiante, con sus subcolecciones (respuestas, historial de notas,
//                 intentos, progreso de video), y las entregas anuladas
//   estudiantes → inscripciones (antes que la asistencia: así el trigger de asistencia borra su resumen en vez de
//                 recrearlo), con su resumen de asistencia y su token de restablecimiento
//   registros   → asistencia, resúmenes, horario, observaciones, avisos y su estado por estudiante, eventos
//                 académicos, fuentes, recursos, materiales y conversaciones del asistente
//   archivos    → los archivos de Cloudinary recogidos en las fases anteriores (lo que no se pueda borrar queda en
//                 `archivosPendientes`, como en el borrado de cuenta)
//   barrido     → pasado un minuto desde lo último que se borró (actividades o entregas), vuelve a limpiar sus rutas
//                 (los triggers de historial de reactivos y de notas pueden escribir bajo ellas después del borrado)
//                 y verifica que no quede nada
//   asignatura  → la asignatura con sus subcolecciones y, por último, el registro de avance
//
// No se tocan: cuentas de Auth de los estudiantes (decisión del 8-nov-2026), datos del docente que no son de la
// asignatura (banco de reactivos y rúbricas, eventos personales, asuetos y vacaciones, créditos de IA y su historial),
// la agenda personal de los estudiantes ni registros administrativos (reportes, sugerencias).
import crypto from 'crypto'
import { getDb, admin, verifyRequest } from './firebaseAdmin.js'
import { extraerAssets, borrarAssets } from './cloudinary.js'

const { FieldValue } = admin.firestore

export class ErrorEliminacion extends Error {
  constructor(status, message, codigo) { super(message); this.status = status; this.codigo = codigo }
}

export const CONTROL = 'eliminacionesAsignatura'
export const FASES = ['inicio', 'actividades', 'entregas', 'estudiantes', 'registros', 'archivos', 'barrido', 'asignatura']
export const ETIQUETAS_FASE = {
  inicio: 'Preparando', actividades: 'Eliminando actividades', entregas: 'Eliminando entregas y calificaciones',
  estudiantes: 'Eliminando estudiantes', registros: 'Eliminando asistencias, avisos y recursos', archivos: 'Eliminando archivos',
  barrido: 'Verificando que no quede nada', asignatura: 'Eliminando la asignatura',
}
const PRESUPUESTO_MS = 7000 // por llamada: holgado frente al límite de ejecución de Vercel
const LEASE_MS = 60_000 // vencimiento del candado (una llamada nunca dura tanto)
export const ESPERA_BARRIDO_MS = 60_000 // tras borrar actividades, tiempo para que terminen sus triggers
const LOTE_ACTIVIDADES = 10
const LOTE_ENTREGAS = 40
const LOTE_REGISTROS = 300
const LOTE_ARCHIVOS = 40
const MAX_VUELTAS = 3 // si el barrido encuentra algo, se repite el ciclo como máximo esta cantidad de veces

// Colecciones de la asignatura que se borran por campo (fase `registros`). `docente` = el documento lleva docenteId
// y solo se borra si es del docente. `archivos` = puede guardar URLs de Cloudinary.
const REGISTROS = [
  { col: 'attendance', campo: 'asignaturaId', docente: true },
  { col: 'attendanceSummaries', campo: 'asignaturaId' },
  { col: 'horarioBloques', campo: 'asignaturaId', docente: true },
  { col: 'observacionesAsistencia', campo: 'asignaturaId', docente: true },
  { col: 'avisoLecturas', campo: 'asignaturaId' },
  { col: 'avisoGuardados', campo: 'asignaturaId' },
  { col: 'avisoOcultos', campo: 'asignaturaId' },
  { col: 'avisoLecturas', campo: 'avisoId', porAviso: true }, // formato viejo sin asignaturaId
  { col: 'avisoGuardados', campo: 'avisoId', porAviso: true },
  { col: 'avisoOcultos', campo: 'avisoId', porAviso: true },
  { col: 'avisos', campo: 'asignaturaId', docente: true, archivos: true },
  { col: 'academicEvents', campo: 'asignaturaId', docente: true },
  { col: 'fuentesAsignatura', campo: 'asignaturaId', docente: true, archivos: true },
  { col: 'resources', campo: 'asignaturaId', docente: true, archivos: true },
  { col: 'materials', campo: 'asignaturaId', docente: true, archivos: true },
  { col: 'chatMensajes', campo: 'subjectId', docente: true, conDocente: true },
]

// ── Pruebas: reloj y una falla simulada entre lotes ─────────────────────────
let reloj = () => Date.now()
let fallaPrueba = null
export function fijarPruebasEliminacion({ ahora, fallar } = {}) {
  reloj = typeof ahora === 'function' ? ahora : () => Date.now()
  fallaPrueba = typeof fallar === 'function' ? fallar : null
}

const idValido = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s)
const claveArchivo = (a) => crypto.createHash('sha1').update(`${a.cloud}|${a.tipo}|${a.publicId}`).digest('hex')
const esPropio = (data, uid) => !data?.docenteId || data.docenteId === uid

// Lee un documento y todas sus subcolecciones (un nivel, que es lo que usa la app) para sacar sus archivos.
async function archivosDe(ref, data, acumulador) {
  extraerAssets(data, acumulador)
  const subs = await ref.listCollections()
  for (const c of subs) {
    const snap = await c.get()
    snap.docs.forEach((d) => extraerAssets(d.data(), acumulador))
  }
}

// Guarda los archivos por borrar ANTES de borrar los documentos que los nombran: si la llamada se corta, siguen
// anotados y la fase `archivos` los encuentra.
async function anotarArchivos(db, ctrlRef, acumulador) {
  const lista = [...acumulador.values()]
  for (let i = 0; i < lista.length; i += 400) {
    const lote = db.batch()
    lista.slice(i, i + 400).forEach((a) => lote.set(ctrlRef.collection('archivos').doc(claveArchivo(a)), a))
    await lote.commit()
  }
  return lista.length
}

async function borrarRefs(db, refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const lote = db.batch()
    refs.slice(i, i + 400).forEach((r) => lote.delete(r))
    await lote.commit()
  }
}

// ── Fases: cada una hace UNA ronda acotada y dice si terminó ─────────────────

async function faseInicio(c) {
  const acumulador = new Map()
  await archivosDe(c.subRef, c.subject, acumulador)
  for (const col of await c.subRef.listCollections()) { // planeaciones, diagnósticos, asistente, análisis…
    const snap = await col.get()
    for (const d of snap.docs) await archivosDe(d.ref, d.data(), acumulador)
  }
  c.avance.archivos += await anotarArchivos(c.db, c.ctrlRef, acumulador)
  return true
}

async function faseActividades(c) {
  const snap = await c.db.collection('activities').where('asignaturaId', '==', c.subjectId).limit(500).get()
  const propias = snap.docs.filter((d) => esPropio(d.data(), c.uid))
  c.omitidas = snap.size - propias.length
  if (!propias.length) return true
  const ronda = propias.slice(0, LOTE_ACTIVIDADES)
  const acumulador = new Map()
  for (const d of ronda) await archivosDe(d.ref, d.data(), acumulador)
  await anotarArchivos(c.db, c.ctrlRef, acumulador)
  // Los ids se guardan antes de borrar: con ellos se encuentran después sus entregas y se barren sus rutas.
  await c.ctrlRef.update({ actividadIds: FieldValue.arrayUnion(...ronda.map((d) => d.id)) })
  ronda.forEach((d) => { if (!c.estado.actividadIds.includes(d.id)) c.estado.actividadIds.push(d.id) })
  for (const d of ronda) {
    await c.db.recursiveDelete(d.ref)
    c.avance.actividades += 1
  }
  // Sus triggers (historial de reactivos, Reto, Participación en vivo…) corren después: el barrido espera.
  c.estado.barridoTras = reloj() + ESPERA_BARRIDO_MS
  return false
}

// Claves por las que se buscan entregas: cada actividad borrada y cada estudiante de la asignatura.
async function clavesEntregas(c) {
  if (!c.estado.alumnoIds) {
    const snap = await c.db.collection('students').where('asignaturaId', '==', c.subjectId).get()
    c.estado.alumnoIds = snap.docs.map((d) => d.id)
    await c.ctrlRef.update({ alumnoIds: c.estado.alumnoIds })
  }
  return [
    ...c.estado.actividadIds.map((id) => ['submissions', 'actividadId', id]),
    ...c.estado.actividadIds.map((id) => ['entregasAnuladas', 'actividadId', id]),
    ...c.estado.alumnoIds.map((id) => ['submissions', 'alumnoId', id]),
  ]
}

async function faseEntregas(c) {
  const claves = await clavesEntregas(c)
  while (c.estado.cursor < claves.length) {
    const [col, campo, valor] = claves[c.estado.cursor]
    const snap = await c.db.collection(col).where(campo, '==', valor).limit(LOTE_ENTREGAS).get()
    if (snap.empty) { c.estado.cursor += 1; continue }
    const acumulador = new Map()
    for (const d of snap.docs) await archivosDe(d.ref, d.data(), acumulador)
    await anotarArchivos(c.db, c.ctrlRef, acumulador)
    // Su ruta queda anotada para el barrido: el trigger del historial de notas puede escribir bajo ella después.
    const marcas = c.db.batch()
    snap.docs.forEach((d) => marcas.set(c.ctrlRef.collection('rutas').doc(`${col}__${d.id}`), { ruta: d.ref.path }))
    await marcas.commit()
    await Promise.all(snap.docs.map((d) => c.db.recursiveDelete(d.ref)))
    c.avance.entregas += snap.size
    c.estado.barridoTras = reloj() + ESPERA_BARRIDO_MS
    return false
  }
  c.estado.cursor = 0
  return true
}

async function faseEstudiantes(c) {
  const snap = await c.db.collection('students').where('asignaturaId', '==', c.subjectId).limit(LOTE_REGISTROS).get()
  if (snap.empty) return true
  const acumulador = new Map()
  snap.docs.forEach((d) => extraerAssets(d.data(), acumulador))
  await anotarArchivos(c.db, c.ctrlRef, acumulador)
  const refs = []
  for (const d of snap.docs) {
    refs.push(d.ref, c.db.doc(`studentResetTokens/${d.id}`))
    const resumen = await c.db.doc(`attendanceSummaries/${d.id}`).get()
    if (resumen.exists && (!resumen.data().asignaturaId || resumen.data().asignaturaId === c.subjectId)) refs.push(resumen.ref)
  }
  await borrarRefs(c.db, refs)
  c.avance.estudiantes += snap.size
  return false
}

async function faseRegistros(c) {
  if (!c.estado.avisoIds) {
    const snap = await c.db.collection('avisos').where('asignaturaId', '==', c.subjectId).get()
    c.estado.avisoIds = snap.docs.filter((d) => esPropio(d.data(), c.uid)).map((d) => d.id)
    await c.ctrlRef.update({ avisoIds: c.estado.avisoIds })
  }
  // Una entrada por colección; las de «por aviso», una por cada aviso de la asignatura.
  const pasos = REGISTROS.flatMap((r) => (r.porAviso ? c.estado.avisoIds.map((id) => ({ ...r, valor: id })) : [{ ...r, valor: c.subjectId }]))
  while (c.estado.cursor < pasos.length) {
    const p = pasos[c.estado.cursor]
    let q = c.db.collection(p.col).where(p.campo, '==', p.valor)
    if (p.conDocente) q = q.where('docenteId', '==', c.uid)
    const snap = await q.limit(LOTE_REGISTROS).get()
    const propios = p.docente ? snap.docs.filter((d) => esPropio(d.data(), c.uid)) : snap.docs
    if (!propios.length) { c.estado.cursor += 1; continue }
    if (p.archivos) {
      const acumulador = new Map()
      propios.forEach((d) => extraerAssets(d.data(), acumulador))
      await anotarArchivos(c.db, c.ctrlRef, acumulador)
    }
    await borrarRefs(c.db, propios.map((d) => d.ref))
    c.avance.registros += propios.length
    return false // la siguiente ronda vuelve a consultar; cuando solo queden ajenos (no se tocan), avanza
  }
  c.estado.cursor = 0
  return true
}

async function faseArchivos(c) {
  const snap = await c.ctrlRef.collection('archivos').limit(LOTE_ARCHIVOS).get()
  if (snap.empty) return true
  const mapa = new Map(snap.docs.map((d) => [d.id, d.data()]))
  const r = await borrarAssets(mapa, { origen: 'subject/eliminar-asignatura', uid: c.uid, subjectId: c.subjectId })
  c.avance.archivosBorrados += r.borrados || 0
  c.avance.archivosPendientes += r.pendientes?.length || 0
  await borrarRefs(c.db, snap.docs.map((d) => d.ref)) // lo que no se pudo borrar ya quedó en archivosPendientes
  return false
}

// ¿Queda algo de la asignatura? Las mismas consultas de las fases (también documentos viejos sin docenteId), más las
// entregas de cada actividad y de cada estudiante.
async function quedaAlgo(c) {
  const consultas = [
    { q: c.db.collection('activities').where('asignaturaId', '==', c.subjectId), docente: true },
    { q: c.db.collection('students').where('asignaturaId', '==', c.subjectId) },
    ...REGISTROS.filter((r) => !r.porAviso).map((r) => {
      let q = c.db.collection(r.col).where(r.campo, '==', c.subjectId)
      if (r.conDocente) q = q.where('docenteId', '==', c.uid)
      return { q, docente: r.docente }
    }),
    ...c.estado.actividadIds.map((id) => ({ q: c.db.collection('submissions').where('actividadId', '==', id) })),
    ...(c.estado.alumnoIds || []).map((id) => ({ q: c.db.collection('submissions').where('alumnoId', '==', id) })),
  ]
  for (const { q, docente } of consultas) {
    const snap = await q.limit(docente ? 50 : 1).get()
    if (docente ? snap.docs.some((d) => esPropio(d.data(), c.uid)) : !snap.empty) return true
  }
  return false
}

async function faseBarrido(c) {
  const falta = (c.estado.barridoTras || 0) - reloj()
  if (falta > 0) { c.esperaMs = falta; return 'esperar' }
  // Rutas de las actividades borradas: un trigger (historial de reactivos) pudo escribir después del borrado.
  while (c.estado.cursor < c.estado.actividadIds.length) {
    const ids = c.estado.actividadIds.slice(c.estado.cursor, c.estado.cursor + 20)
    await Promise.all(ids.map((id) => c.db.recursiveDelete(c.db.doc(`activities/${id}`))))
    c.estado.cursor += ids.length
    if (reloj() - c.inicio > c.presupuestoMs) return false
  }
  // Rutas de las entregas borradas (historial de notas escrito por su trigger después del borrado). Se procesan por
  // páginas; cada marca se quita al barrer su ruta, así que una llamada cortada continúa con las que faltan.
  for (;;) {
    const marcas = await c.ctrlRef.collection('rutas').limit(100).get()
    if (marcas.empty) break
    await Promise.all(marcas.docs.map((m) => c.db.recursiveDelete(c.db.doc(m.data().ruta))))
    await borrarRefs(c.db, marcas.docs.map((m) => m.ref))
    if (reloj() - c.inicio > c.presupuestoMs) return false
  }
  c.estado.cursor = 0
  if (await quedaAlgo(c)) {
    if (c.estado.vueltas + 1 >= MAX_VUELTAS) throw new ErrorEliminacion(500, 'No se pudo terminar de eliminar la asignatura. Vuelve a intentarlo.', 'NO_TERMINA')
    c.estado.vueltas += 1
    c.estado.fase = 'actividades' // algo apareció mientras se borraba: se repite el ciclo
    c.estado.alumnoIds = null // se vuelven a leer (pudo inscribirse alguien mientras tanto)
    c.estado.avisoIds = null
    await c.ctrlRef.update({ alumnoIds: FieldValue.delete(), avisoIds: FieldValue.delete() })
    return 'reiniciar'
  }
  return true
}

const FUNCIONES = {
  inicio: faseInicio, actividades: faseActividades, entregas: faseEntregas, estudiantes: faseEstudiantes,
  registros: faseRegistros, archivos: faseArchivos, barrido: faseBarrido,
}

// Toma el candado (o lo crea junto con el registro de avance). Rechaza si otra llamada lo tiene vigente.
async function tomarCandado(db, ctrlRef, uid, subjectId, nombre) {
  const token = crypto.randomUUID()
  const estado = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ctrlRef)
    const ahora = reloj()
    if (snap.exists) {
      const d = snap.data()
      if (d.docenteId !== uid) throw new ErrorEliminacion(403, 'Esta asignatura no es tuya.', 'NO_ES_TUYA')
      if (d.lease?.hasta > ahora && d.lease.token !== token) {
        throw new ErrorEliminacion(409, 'La eliminación ya está en curso en otra ventana. Espera un momento.', 'EN_CURSO')
      }
      tx.update(ctrlRef, { lease: { token, hasta: ahora + LEASE_MS }, rondas: FieldValue.increment(1), actualizadaEn: FieldValue.serverTimestamp() })
      return d
    }
    const nuevo = {
      subjectId, docenteId: uid, nombre: nombre || '', fase: FASES[0], cursor: 0, vueltas: 0, actividadIds: [], barridoTras: 0,
      avance: { actividades: 0, entregas: 0, estudiantes: 0, registros: 0, archivos: 0, archivosBorrados: 0, archivosPendientes: 0 },
      lease: { token, hasta: ahora + LEASE_MS }, rondas: 1,
      iniciadaEn: FieldValue.serverTimestamp(), actualizadaEn: FieldValue.serverTimestamp(),
    }
    tx.create(ctrlRef, nuevo)
    return nuevo
  })
  return { token, estado }
}

/**
 * Una llamada del borrado. Devuelve { estado: 'en_curso' | 'completa', fase, etiqueta, avance, esperaMs? }.
 * Lanza ErrorEliminacion con el estado HTTP. `uid` sale SIEMPRE de la sesión verificada.
 */
export async function ejecutarEliminacionAsignatura(db, uid, subjectId, { confirmacion, presupuestoMs = PRESUPUESTO_MS } = {}) {
  if (!idValido(subjectId)) throw new ErrorEliminacion(400, 'Falta la asignatura.', 'SIN_ASIGNATURA')
  const subRef = db.doc(`subjects/${subjectId}`)
  const ctrlRef = db.doc(`${CONTROL}/${subjectId}`)
  const [subSnap, ctrlSnap] = await Promise.all([subRef.get(), ctrlRef.get()])
  if (ctrlSnap.exists && ctrlSnap.data().docenteId !== uid) throw new ErrorEliminacion(403, 'Esta asignatura no es tuya.', 'NO_ES_TUYA')
  if (!subSnap.exists) {
    // Ya no existe: o nunca existió, o un corte dejó solo el registro de avance (se termina de limpiar).
    if (ctrlSnap.exists) await db.recursiveDelete(ctrlRef)
    return { estado: 'completa', fase: 'asignatura', etiqueta: 'Asignatura eliminada', avance: ctrlSnap.exists ? ctrlSnap.data().avance : null }
  }
  const subject = subSnap.data()
  if (subject.docenteId !== uid) throw new ErrorEliminacion(403, 'Esta asignatura no es tuya.', 'NO_ES_TUYA')
  // Segundo cerrojo (como la palabra ELIMINAR del borrado de cuenta): el nombre exacto de la asignatura.
  if (String(confirmacion ?? '').trim() !== String(subject.nombre ?? '').trim()) {
    throw new ErrorEliminacion(400, 'El nombre no coincide.', 'CONFIRMACION')
  }

  const { token, estado } = await tomarCandado(db, ctrlRef, uid, subjectId, subject.nombre)
  const c = {
    db, uid, subjectId, subRef, ctrlRef, subject, inicio: reloj(), presupuestoMs,
    estado: { fase: estado.fase, cursor: estado.cursor || 0, vueltas: estado.vueltas || 0, actividadIds: [...(estado.actividadIds || [])], alumnoIds: estado.alumnoIds || null, avisoIds: estado.avisoIds || null, barridoTras: estado.barridoTras || 0 },
    avance: { actividades: 0, entregas: 0, estudiantes: 0, registros: 0, archivos: 0, archivosBorrados: 0, archivosPendientes: 0, ...(estado.avance || {}) },
  }
  const guardar = (extra = {}) => ctrlRef.update({
    fase: c.estado.fase, cursor: c.estado.cursor, vueltas: c.estado.vueltas, barridoTras: c.estado.barridoTras, avance: c.avance,
    lease: { token, hasta: reloj() + LEASE_MS }, actualizadaEn: FieldValue.serverTimestamp(), ...extra,
  })

  const soltarCandado = () => ctrlRef.update({ lease: { token: null, hasta: 0 } }).catch(() => {})
  try {
    while (c.estado.fase !== 'asignatura') {
      if (fallaPrueba) fallaPrueba(c.estado.fase, c.avance)
      const r = await FUNCIONES[c.estado.fase](c)
      if (r === true) { c.estado.fase = FASES[FASES.indexOf(c.estado.fase) + 1]; c.estado.cursor = 0 }
      if (r === 'reiniciar') c.estado.cursor = 0
      await guardar()
      if (r === 'esperar' || reloj() - c.inicio > presupuestoMs) {
        // Se suelta el candado al salir: la siguiente llamada lo toma sin esperar a que venza.
        await soltarCandado()
        return { estado: 'en_curso', fase: c.estado.fase, etiqueta: ETIQUETAS_FASE[c.estado.fase], avance: c.avance, ...(r === 'esperar' ? { esperaMs: c.esperaMs } : {}), ...(c.omitidas ? { omitidas: c.omitidas } : {}) }
      }
    }
    // Ya no queda nada suyo: la asignatura (con sus subcolecciones) y, al final, el registro de avance.
    if (fallaPrueba) fallaPrueba('asignatura', c.avance)
    await db.recursiveDelete(subRef)
  } catch (e) {
    // Lo que se alcanzó a borrar ya quedó registrado; la siguiente llamada sigue desde ahí.
    await soltarCandado()
    throw e
  }
  await db.recursiveDelete(ctrlRef)
  return { estado: 'completa', fase: 'asignatura', etiqueta: 'Asignatura eliminada', avance: c.avance }
}

export async function handleEliminarAsignatura(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  let body
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch { return res.status(400).json({ error: 'Body inválido.' }) }
  try {
    let uid
    try { ({ uid } = await verifyRequest(req)) } catch (e) { throw new ErrorEliminacion(e.status || 401, 'Inicia sesión para continuar.', 'SIN_SESION') }
    const r = await ejecutarEliminacionAsignatura(getDb(), uid, String(body.subjectId || '').trim(), { confirmacion: body.confirmacion })
    return res.status(200).json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof ErrorEliminacion) return res.status(e.status).json({ error: e.message, codigo: e.codigo })
    console.error('[eliminar-asignatura]', e)
    return res.status(500).json({ error: 'No se pudo completar. Vuelve a intentarlo: continuará donde se quedó.', codigo: 'ERROR' })
  }
}
