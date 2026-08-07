#!/usr/bin/env node

/**
 * Migración de IDs de submissions a formato determinista (A12 R22-C).
 *
 * Antes de R22, cada entrega se creaba con addDoc (ID aleatorio). La regla
 * nueva exige que el ID sea `{actividadId}_{alumnoId}` — sin ese patrón,
 * Firestore rechaza cualquier create.
 *
 * Este script renombra cada submission existente al ID canónico:
 *   1. Lee todos los documentos de la colección `submissions`.
 *   2. Para cada par (actividadId, alumnoId) determina el canónico:
 *        - Si hay exactamente uno: lo renombra.
 *        - Si hay varios (duplicados): elige el graded o el más reciente,
 *          lo renombra, y elimina los sobrantes.
 *   3. Copia también la subcollección `respuestas/{preguntaId}` al nuevo doc
 *      y la elimina del viejo.
 *   4. Elimina el documento original (distinto del canónico).
 *
 * Los documentos que ya tienen el ID correcto se omiten sin escribir nada.
 *
 * Uso:
 *   cd seeds-db && npm install
 *   node backfill-submission-ids.js --dry-run   # solo describe qué haría
 *   node backfill-submission-ids.js             # migra
 *
 * Requiere credenciales del Admin SDK (GOOGLE_APPLICATION_CREDENTIALS o
 * FIREBASE_TOKEN via firebase-cli), igual que el resto de scripts de esta
 * carpeta.
 */

const admin = require('firebase-admin')

try {
  admin.initializeApp({ projectId: 'evalua-facil-app' })
} catch {
  // ya inicializado
}

const db = admin.firestore()
const SOLO_SIMULAR = process.argv.includes('--dry-run')

// Elige el documento canónico entre varios con el mismo par (actividadId, alumnoId).
// Prioridad: calificado > más reciente por fechaEntrega.
function elegirCanonico(docs) {
  const graded = docs.filter((d) => d.data().estado === 'calificado')
  if (graded.length > 0) {
    return graded.sort((a, b) => {
      const ta = a.data().fechaEntrega?.toMillis?.() ?? 0
      const tb = b.data().fechaEntrega?.toMillis?.() ?? 0
      return tb - ta
    })[0]
  }
  return docs.sort((a, b) => {
    const ta = a.data().fechaEntrega?.toMillis?.() ?? 0
    const tb = b.data().fechaEntrega?.toMillis?.() ?? 0
    return tb - ta
  })[0]
}

// Copia todos los docs de la subcollección respuestas al nuevo submission.
async function copiarRespuestas(origenRef, destinoRef) {
  const snap = await origenRef.collection('respuestas').get()
  if (snap.empty) return 0
  const batch = db.batch()
  for (const r of snap.docs) {
    batch.set(destinoRef.collection('respuestas').doc(r.id), r.data())
  }
  await batch.commit()
  // Eliminar los originales
  const batchDel = db.batch()
  for (const r of snap.docs) {
    batchDel.delete(origenRef.collection('respuestas').doc(r.id))
  }
  await batchDel.commit()
  return snap.size
}

async function main() {
  const snap = await db.collection('submissions').get()
  console.log(`${snap.size} submissions${SOLO_SIMULAR ? ' (simulación, no se escribe nada)' : ''}\n`)

  // Agrupar por par canónico
  const grupos = new Map()
  for (const d of snap.docs) {
    const { actividadId, alumnoId } = d.data()
    if (!actividadId || !alumnoId) {
      console.warn(`  ⚠ ${d.id}: faltan actividadId o alumnoId — se omite`)
      continue
    }
    const key = `${actividadId}_${alumnoId}`
    if (!grupos.has(key)) grupos.set(key, [])
    grupos.get(key).push(d)
  }

  let yaCorrectos = 0
  let renombrados = 0
  let eliminadosDuplicados = 0
  let respuestasMigradas = 0

  for (const [idCanónico, docs] of grupos) {
    // Si el único doc ya tiene el ID correcto, nada que hacer
    if (docs.length === 1 && docs[0].id === idCanónico) {
      yaCorrectos++
      continue
    }

    const canonico = elegirCanonico(docs)
    const sobrantes = docs.filter((d) => d.id !== idCanónico && d.id !== canonico.id)

    if (canonico.id === idCanónico) {
      // El canónico ya está bien; solo eliminar duplicados con ID distinto
      console.log(`  · ${idCanónico}: ID ya correcto, eliminando ${sobrantes.length} duplicado(s)`)
      if (!SOLO_SIMULAR) {
        for (const s of sobrantes) {
          await copiarRespuestas(s.ref, db.collection('submissions').doc(idCanónico))
          await s.ref.delete()
        }
        eliminadosDuplicados += sobrantes.length
      }
      yaCorrectos++
      continue
    }

    // Necesita renombrado
    const etiqueta = sobrantes.length > 0
      ? `renombrar ${canonico.id} → ${idCanónico}, eliminar ${sobrantes.length + 1} fuentes`
      : `renombrar ${canonico.id} → ${idCanónico}`
    console.log(`  · ${etiqueta}`)

    if (!SOLO_SIMULAR) {
      const destRef = db.collection('submissions').doc(idCanónico)
      // Copiar datos del canónico al nuevo ID
      await destRef.set(canonico.data())
      // Migrar subcollección respuestas
      const nResp = await copiarRespuestas(canonico.ref, destRef)
      respuestasMigradas += nResp
      // Eliminar el original del canónico
      await canonico.ref.delete()
      // Eliminar sobrantes (también sus respuestas, si tienen)
      for (const s of sobrantes) {
        await copiarRespuestas(s.ref, destRef)
        await s.ref.delete()
      }
      renombrados++
      eliminadosDuplicados += sobrantes.length
    } else {
      renombrados++
      eliminadosDuplicados += sobrantes.length
    }
  }

  console.log(`\n${yaCorrectos} ya tenían ID correcto`)
  console.log(`${renombrados} ${SOLO_SIMULAR ? 'se renombrarían' : 'renombrados'} al ID determinista`)
  console.log(`${eliminadosDuplicados} duplicado(s) ${SOLO_SIMULAR ? 'se eliminarían' : 'eliminados'}`)
  if (respuestasMigradas) console.log(`${respuestasMigradas} doc(s) de subcollección respuestas migrados`)
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Falló:', err.message)
  process.exit(1)
})
