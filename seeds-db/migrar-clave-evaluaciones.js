#!/usr/bin/env node

/**
 * A08 — Saca la clave de respuestas de donde el alumno podía leerla.
 *
 * Hasta el 6-ago-2026, `respuestaCorrecta` vivía dentro de
 * `activities/{id}/preguntas/{pid}`, que cualquiera con sesión puede leer. Las
 * reglas de Firestore no filtran campos, así que la única forma de cerrarlo era
 * mover el dato: ahora vive en `activities/{id}/clave/{pid}`, que solo abre el
 * docente dueño.
 *
 * Este script hace las dos mitades de esa mudanza:
 *
 *   1. Por cada reactivo con `respuestaCorrecta`, escribe la clave en su sitio
 *      nuevo y BORRA el campo del reactivo. Mientras el campo siga ahí, el
 *      agujero sigue abierto.
 *   2. Rellena las entregas ya calificadas para que docente y alumno conserven
 *      la misma experiencia al revisar evaluaciones anteriores: `correcta` en
 *      cada respuesta, y `respuestaCorrecta` solo si esa evaluación tiene
 *      publicadas las respuestas — la misma regla que aplica el servidor al
 *      calificar de ahora en adelante.
 *
 * Uso:
 *   cd seeds-db && npm install
 *   node migrar-clave-evaluaciones.js --dry-run   # solo dice qué haría
 *   node migrar-clave-evaluaciones.js             # migra de verdad
 *
 * Requiere credenciales del Admin SDK (GOOGLE_APPLICATION_CREDENTIALS), igual
 * que el resto de scripts de esta carpeta. Es seguro correrlo varias veces:
 * lo ya migrado se salta.
 */

const admin = require('firebase-admin')

const SECO = process.argv.includes('--dry-run')

if (!admin.apps.length) admin.initializeApp()
const db = admin.firestore()

// Misma regla que `publicacionVisible` en el cliente y en las Cloud Functions.
function respuestasPublicadas(ev = {}) {
  const modo = ev.publicarRespuestas || 'inmediato'
  if (modo === 'nunca') return false
  if (modo === 'inmediato') return true
  if (modo === 'fecha') return !!ev.publicarRespuestasFecha && new Date().toISOString() >= ev.publicarRespuestasFecha
  return !!ev.respuestasPublicadas
}

const TIPOS_OBJETIVOS = ['opcion_multiple', 'verdadero_falso']

async function main() {
  const acts = await db.collection('activities').where('tipo', '==', 'evaluacion').get()
  console.log(`${acts.size} evaluaciones${SECO ? ' (simulacro)' : ''}\n`)

  let movidas = 0, yaMovidas = 0, sinClave = 0
  let entregasTocadas = 0, respuestasTocadas = 0, reveladas = 0

  for (const act of acts.docs) {
    const ev = act.data().evaluacion || {}
    const revelar = respuestasPublicadas(ev)

    // ── 1. Mudar la clave ────────────────────────────────────────────────
    const preg = await act.ref.collection('preguntas').get()
    const claves = {}
    const tipos = {}
    for (const p of preg.docs) {
      const d = p.data()
      tipos[p.id] = d.tipo
      const yaEnSitio = await act.ref.collection('clave').doc(p.id).get()
      if (yaEnSitio.exists) {
        claves[p.id] = yaEnSitio.data().respuestaCorrecta ?? null
        yaMovidas++
        // Puede quedar el campo viejo aunque la clave ya esté mudada.
        if (d.respuestaCorrecta !== undefined && !SECO) {
          await p.ref.update({ respuestaCorrecta: admin.firestore.FieldValue.delete() })
        }
        continue
      }
      if (d.respuestaCorrecta === undefined) { sinClave++; continue }
      claves[p.id] = d.respuestaCorrecta ?? null
      if (!SECO) {
        await act.ref.collection('clave').doc(p.id).set({ respuestaCorrecta: d.respuestaCorrecta ?? null })
        await p.ref.update({ respuestaCorrecta: admin.firestore.FieldValue.delete() })
      }
      movidas++
    }

    // ── 2. Rellenar las entregas ya calificadas ──────────────────────────
    const subs = await db.collection('submissions').where('actividadId', '==', act.id).get()
    for (const sub of subs.docs) {
      const resp = await sub.ref.collection('respuestas').get()
      if (resp.empty) continue
      let tocada = false
      for (const r of resp.docs) {
        const d = r.data()
        const esObjetiva = TIPOS_OBJETIVOS.includes(tipos[r.id])
        const marcas = {}
        // `correcta` solo tiene sentido donde el servidor pudo calificar.
        if (esObjetiva && d.puntosObtenidos != null && d.correcta === undefined) {
          marcas.correcta = d.puntosObtenidos > 0
        }
        if (revelar && d.respuestaCorrecta === undefined && claves[r.id] !== undefined) {
          marcas.respuestaCorrecta = claves[r.id]
          reveladas++
        }
        if (!Object.keys(marcas).length) continue
        if (!SECO) await r.ref.set(marcas, { merge: true })
        respuestasTocadas++
        tocada = true
      }
      if (tocada) entregasTocadas++
    }

    console.log(`· ${act.id} — ${preg.size} reactivos · respuestas ${revelar ? 'publicadas' : 'no publicadas'}`)
  }

  console.log(`\nCLAVES`)
  console.log(`  mudadas ................ ${movidas}`)
  console.log(`  ya estaban en su sitio . ${yaMovidas}`)
  console.log(`  reactivos sin clave .... ${sinClave}`)
  console.log(`ENTREGAS HISTÓRICAS`)
  console.log(`  entregas rellenadas .... ${entregasTocadas}`)
  console.log(`  respuestas actualizadas  ${respuestasTocadas}`)
  console.log(`  con la correcta visible  ${reveladas}`)

  if (!SECO) {
    // Comprobación: que no quede NI UN reactivo con la clave dentro.
    let quedan = 0
    for (const act of acts.docs) {
      const preg = await act.ref.collection('preguntas').get()
      preg.docs.forEach((p) => { if (p.data().respuestaCorrecta !== undefined) quedan++ })
    }
    console.log(`\n${quedan === 0
      ? '✔ Ningún reactivo conserva la clave dentro.'
      : `✗ QUEDAN ${quedan} reactivos con la clave dentro — la migración NO terminó.`}`)
    if (quedan > 0) process.exitCode = 1
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(e); process.exit(1) })
