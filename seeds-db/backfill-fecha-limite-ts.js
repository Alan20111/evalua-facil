#!/usr/bin/env node

/**
 * Respaldo inicial del candado de fecha límite (A12 H3).
 *
 * Copia `activities.fechaLimite` (string) y cada `activities.extensiones.{id}`
 * (también string) a `fechaLimiteTS` / `extensionesTS.{id}` — el mismo
 * Timestamp que ahora escribe el cliente al crear/editar una actividad (ver
 * src/utils/deadline.js) y que firestore.rules usa para decidir si el plazo
 * ya cerró.
 *
 * Las reglas dejan pasar a quien NO tenga `fechaLimiteTS` (un dato faltante
 * no debe cerrarle el trabajo a nadie), así que hasta que esto corra, el
 * candado del servidor no le aplica a ninguna actividad creada antes de H3.
 *
 * Uso:
 *   cd seeds-db && npm install
 *   node backfill-fecha-limite-ts.js --dry-run   # solo dice qué haría
 *   node backfill-fecha-limite-ts.js             # escribe
 *
 * Requiere credenciales del Admin SDK (GOOGLE_APPLICATION_CREDENTIALS o
 * `firebase login` con firebase-cli), igual que el resto de scripts de esta
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

// MISMO cálculo que src/utils/deadline.js (fechaLimiteTimestamp) — fechas
// legadas sin hora cierran al final del día.
function aTimestamp(fechaStr) {
  if (!fechaStr) return null
  const iso = fechaStr.includes('T') ? fechaStr : `${fechaStr}T23:59:59`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return admin.firestore.Timestamp.fromDate(d)
}

async function main() {
  const snap = await db.collection('activities').get()
  console.log(`${snap.size} actividades${SOLO_SIMULAR ? ' (simulación, no se escribe nada)' : ''}\n`)

  let escritas = 0
  let sinFechaLimite = 0
  let yaTenian = 0

  for (const d of snap.docs) {
    const act = d.data()
    const necesitaFecha = !!act.fechaLimite && act.fechaLimiteTS == null
    const extensionesFaltantes = Object.entries(act.extensiones || {})
      .filter(([id]) => act.extensionesTS?.[id] == null)

    if (!necesitaFecha && extensionesFaltantes.length === 0) {
      if (act.fechaLimiteTS != null || act.extensionesTS != null) yaTenian++
      else sinFechaLimite++
      continue
    }

    const patch = {}
    if (necesitaFecha) {
      const ts = aTimestamp(act.fechaLimite)
      if (ts) patch.fechaLimiteTS = ts
    }
    extensionesFaltantes.forEach(([id, fecha]) => {
      const ts = aTimestamp(fecha)
      if (ts) patch[`extensionesTS.${id}`] = ts
    })

    if (Object.keys(patch).length === 0) continue
    console.log(`  · ${d.id} (${act.nombre || 'sin nombre'}): ${Object.keys(patch).join(', ')}`)
    if (!SOLO_SIMULAR) {
      await d.ref.update(patch)
    }
    escritas++
  }

  console.log(`\n${escritas} actividad(es) ${SOLO_SIMULAR ? 'se actualizarían' : 'actualizadas'}`)
  if (sinFechaLimite) console.log(`${sinFechaLimite} sin fecha límite (nunca cierran, sin candado por diseño)`)
  if (yaTenian) console.log(`${yaTenian} ya tenían su Timestamp (creadas/editadas después de H3)`)
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Falló:', err.message)
  process.exit(1)
})
