// Chat con Acciones (17-ago-2026) — CONVERSAR → PROPONER → CONFIRMAR → EJECUTAR.
//
// La IA nunca escribe Firestore: solo devuelve una propuesta ya saneada por
// el servidor (sanearPropuestaAccionChat en functions/ia.js). Este archivo
// es la ÚNICA pieza que ejecuta la creación real, y lo hace reutilizando la
// MISMA infraestructura que ya usan los editores manuales — no un segundo
// sistema de creación:
//   - `resolveVisibilidad` (utils/activityVisibility.js) — igual que
//     EntregableEditor.jsx/EvaluacionEditor.jsx: por default una actividad
//     nueva queda PUBLICADA de inmediato, mismo comportamiento de siempre.
//   - `crearPreguntasEnLote` (utils/evaluacionClave.js) — el mismo camino
//     que usa "Agregar desde el Banco" y los reactivos generados con IA
//     dentro del editor de exámenes.
//   - `EVALUACION_DEFAULTS.examen` (components/EvaluacionEditor.jsx) — los
//     mismos defaults de configuración (tiempoLimiteMin, intentosPermitidos…)
//     que un examen creado a mano.
//
// El `subjectId`/`docenteId` SIEMPRE los pasa quien llama (ChatAsistente.jsx)
// usando el contexto que el servidor ya validó en el precheck de ese turno
// — nunca un valor que la IA haya podido mencionar en el texto de la
// propuesta (la propuesta ni siquiera trae subjectId).
import { collection, doc, query, where, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { addDoc } from './firestoreGuard'
import { db } from '../firebase'
import { resolveVisibilidad } from './activityVisibility'
import { sanitizeHtml } from './sanitizeHtml'
import { crearPreguntasEnLote } from './evaluacionClave'
import { EVALUACION_DEFAULTS } from './evaluacionDefaults'

function makeOptionId(texto) {
  return { id: `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, texto: String(texto || '').trim() }
}

// Mismo cálculo que EntregableEditor.jsx/EvaluacionEditor.jsx:
// `existingActivities.filter(a => a.parcial === parcial).length + 1` — aquí
// se consulta directo porque el chat no mantiene la lista completa cargada.
async function siguienteOrden(subjectId, parcial) {
  const snap = await getDocs(query(
    collection(db, 'activities'),
    where('asignaturaId', '==', subjectId),
    where('parcial', '==', parcial),
  ))
  return snap.size + 1
}

function visibilidadPorDefecto(fechaLimite) {
  const resolved = resolveVisibilidad({
    visibilidadMode: 'show', publishedAt: '', publishAt: '', fechaLimite, asDraft: false,
  })
  if (!resolved.ok) throw new Error(resolved.error)
  return resolved
}

// `propuesta.categoria` es 'entregable' u 'observacion' — mismo campo,
// mismo componente (EntregableEditor.jsx) que crea ambos en la app manual.
export async function crearActividadDesdeChatPropuesta({ propuesta, subjectId, docenteId, parcial }) {
  const isObservacion = propuesta.categoria === 'observacion'
  const resolved = visibilidadPorDefecto(isObservacion ? null : propuesta.fechaLimite)
  const orden = await siguienteOrden(subjectId, parcial)

  const payload = {
    nombre: propuesta.nombre,
    categoria: isObservacion ? 'observacion' : 'entregable',
    tipo: isObservacion ? 'observacion' : 'archivo',
    maxCalif: 10,
    instrucciones: sanitizeHtml(propuesta.instrucciones || ''),
    archivosAdjuntos: [],
    fechaLimite: isObservacion ? null : (propuesta.fechaLimite || null),
    tiposArchivo: [],
    extensionesCustom: '',
    oculta: resolved.oculta,
    publishAt: resolved.publishAt,
    publishedAt: resolved.publishedAt,
    recibirTarde: isObservacion ? null : false,
    rubrica: null,
    rubricaId: null,
    notificarDocente: false,
    parcial,
    orden,
    asignaturaId: subjectId,
    docenteId,
    createdAt: serverTimestamp(),
  }
  const ref = await addDoc(collection(db, 'activities'), payload)
  return { id: ref.id }
}

export async function crearExamenDesdeChatPropuesta({ propuesta, subjectId, docenteId, parcial }) {
  const resolved = visibilidadPorDefecto(propuesta.fechaLimite)
  const orden = await siguienteOrden(subjectId, parcial)

  const infoPayload = {
    nombre: propuesta.nombre,
    categoria: 'examen',
    instrucciones: sanitizeHtml(propuesta.instrucciones || ''),
    archivosAdjuntos: [],
    fechaLimite: propuesta.fechaLimite || null,
    recibirTarde: false,
    oculta: resolved.oculta,
    publishAt: resolved.publishAt,
    publishedAt: resolved.publishedAt,
    maxCalif: 10,
    notificarDocente: false,
    tipo: 'evaluacion',
    evaluacion: EVALUACION_DEFAULTS.examen,
    parcial,
    orden,
    asignaturaId: subjectId,
    docenteId,
    createdAt: serverTimestamp(),
  }
  const ref = await addDoc(collection(db, 'activities'), infoPayload)

  // Mismo reparto público/clave que crearPreguntasEnLote ya hace para
  // "Agregar desde el Banco" y reactivos generados con IA dentro del editor.
  const lista = propuesta.reactivos.map((r, i) => {
    const base = { tipo: r.tipo, enunciado: r.enunciado, ponderacion: 1, retroalimentacion: null, imagenUrl: null, orden: i }
    if (r.tipo === 'opcion_multiple') {
      const opciones = r.opciones.filter(Boolean).map(makeOptionId)
      const idx = Math.min(opciones.length - 1, Math.max(0, r.correcta ?? 0))
      return { ...base, opciones, respuestaCorrecta: opciones[idx]?.id ?? opciones[0]?.id }
    }
    if (r.tipo === 'verdadero_falso') {
      return { ...base, opciones: [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }], respuestaCorrecta: r.correcta === 'f' ? 'f' : 'v' }
    }
    if (r.tipo === 'respuesta_corta') {
      return { ...base, opciones: null, respuestaCorrecta: null, respuestaEsperada: r.respuestaEsperada || null }
    }
    return { ...base, opciones: null, respuestaCorrecta: null } // subir_archivo
  })
  await crearPreguntasEnLote(ref.id, lista)
  await updateDoc(doc(db, 'activities', ref.id), { 'evaluacion.numPreguntas': lista.length })
  return { id: ref.id, numReactivos: lista.length }
}

// Punto único de despacho — ChatAsistente.jsx no necesita saber el detalle
// de cada acción, solo la propuesta ya saneada por el servidor.
export async function ejecutarPropuestaAccion(propuesta, { subjectId, docenteId, parcial }) {
  if (propuesta.accion === 'CREAR_EXAMEN') {
    return crearExamenDesdeChatPropuesta({ propuesta, subjectId, docenteId, parcial })
  }
  return crearActividadDesdeChatPropuesta({ propuesta, subjectId, docenteId, parcial })
}
