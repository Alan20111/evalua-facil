#!/usr/bin/env node

/**
 * A12 · H5 · R22 — migra submissions de id aleatorio a id determinista.
 *
 * El id correcto es `{actividadId}_{alumnoId}`. Antes cada entrega nacía con
 * `addDoc` (id aleatorio), lo que permitía duplicados por doble clic, dos
 * pestañas o reintentos de red. Este script:
 *
 *  1. Lee todos los documentos de `submissions` vía Firestore REST API.
 *  2. Calcula el id determinista a partir de sus campos `actividadId` y `alumnoId`.
 *  3. Si el id actual ya coincide, lo omite.
 *  4. Si varios IDs aleatorios apuntan a la misma pareja (duplicados reales),
 *     conserva el más reciente por `fechaEntrega` y descarta el resto.
 *  5. Copia la subcolección `respuestas` al nuevo documento.
 *  6. Escribe el nuevo documento y borra el viejo.
 *
 * Usa el refresh_token del firebase-cli para obtener un access_token fresco
 * con las credenciales OAuth que firebase-tools embute en su binario.
 *
 * Uso:
 *   cd seeds-db && npm install
 *   node backfill-submission-ids.js --dry-run   # solo dice qué haría
 *   node backfill-submission-ids.js             # escribe en producción
 */

const { readFileSync } = require('fs')
const { homedir } = require('os')
const { join } = require('path')

const PROJECT_ID = 'evalua-facil-app'
const SOLO_SIMULAR = process.argv.includes('--dry-run')

// Credenciales OAuth de firebase-tools (embebidas en el binario público).
const FBT_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
const FBT_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi'

// ── Credenciales ─────────────────────────────────────────────────────────────

async function obtenerAccessToken() {
  const ruta = join(homedir(), '.config', 'configstore', 'firebase-tools.json')
  let cfg
  try {
    cfg = JSON.parse(readFileSync(ruta, 'utf8'))
  } catch (e) {
    throw new Error(`No se pudo leer ${ruta}: ${e.message}`)
  }

  const refreshToken = cfg.tokens?.refresh_token
  if (!refreshToken) throw new Error('No se encontró refresh_token en firebase-tools.json — ejecuta: npx firebase-tools login')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: FBT_CLIENT_ID,
      client_secret: FBT_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`Token refresh falló: ${JSON.stringify(json)}`)
  return json.access_token
}

// ── Firestore REST helpers ───────────────────────────────────────────────────

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`
let TOKEN

function auth() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
}

function decodeValue(v) {
  if (!v) return null
  if ('nullValue' in v) return null
  if ('booleanValue' in v) return v.booleanValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('stringValue' in v) return v.stringValue
  if ('timestampValue' in v) return v.timestampValue
  if ('mapValue' in v) {
    const m = {}
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) m[k] = decodeValue(val)
    return m
  }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue)
  return null
}

function decodeDoc(resource) {
  const parts = resource.name.split('/')
  const id = parts[parts.length - 1]
  const fields = {}
  for (const [k, v] of Object.entries(resource.fields || {})) fields[k] = decodeValue(v)
  return { id, fields, name: resource.name }
}

// Preserva el Value original de la API REST (para no perder tipo Timestamp).
function copiarFields(resource) {
  return resource.fields || {}
}

async function listarColeccionRaw(colPath) {
  const docs = []
  let pageToken
  do {
    const url = new URL(`${BASE}/${colPath}`)
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res = await fetch(url.toString(), { headers: auth() })
    if (!res.ok) throw new Error(`GET ${colPath}: ${res.status} ${await res.text()}`)
    const json = await res.json()
    for (const d of json.documents || []) {
      const parts = d.name.split('/')
      docs.push({ id: parts[parts.length - 1], rawFields: d.fields || {}, name: d.name })
    }
    pageToken = json.nextPageToken
  } while (pageToken)
  return docs
}

async function escribirDocRaw(colPath, docId, rawFields) {
  const url = `${BASE}/${colPath}/${encodeURIComponent(docId)}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: auth(),
    body: JSON.stringify({ fields: rawFields }),
  })
  if (!res.ok) throw new Error(`PATCH ${colPath}/${docId}: ${res.status} ${await res.text()}`)
}

async function borrarDocPorNombre(nombreRecurso) {
  const res = await fetch(`https://firestore.googleapis.com/v1/${nombreRecurso}`,
    { method: 'DELETE', headers: auth() })
  if (!res.ok) throw new Error(`DELETE ${nombreRecurso}: ${res.status} ${await res.text()}`)
}

// ── Lógica principal ─────────────────────────────────────────────────────────

function submissionDocId(actividadId, alumnoId) {
  return `${actividadId}_${alumnoId}`
}

function fechaMs(rawFields) {
  const f = rawFields.fechaEntrega
  if (!f) return 0
  if (f.timestampValue) return new Date(f.timestampValue).getTime() || 0
  if (f.integerValue) return Number(f.integerValue)
  return 0
}

async function main() {
  TOKEN = await obtenerAccessToken()
  console.log(`\n── backfill-submission-ids ${SOLO_SIMULAR ? '(DRY RUN — no se escribe nada)' : '(MODO REAL)'}  ──\n`)

  const todos = await listarColeccionRaw('submissions')
  console.log(`${todos.length} submissions encontradas.\n`)

  const grupos = new Map()
  for (const doc of todos) {
    const actividadId = doc.rawFields.actividadId?.stringValue
    const alumnoId = doc.rawFields.alumnoId?.stringValue
    if (!actividadId || !alumnoId) {
      console.warn(`  ⚠ ${doc.id} — sin actividadId/alumnoId, se omite`)
      continue
    }
    const target = submissionDocId(actividadId, alumnoId)
    if (!grupos.has(target)) grupos.set(target, [])
    grupos.get(target).push(doc)
  }

  let migradas = 0
  let yaTenian = 0
  let duplicadosEliminados = 0
  let colisiones = 0

  for (const [targetId, docs] of grupos) {
    const yaCorrectos = docs.filter((d) => d.id === targetId)
    const incorrectos = docs.filter((d) => d.id !== targetId)

    if (incorrectos.length === 0) {
      yaTenian++
      continue
    }

    if (yaCorrectos.length > 0) {
      colisiones++
      console.log(`  ↩ ${targetId} — id correcto ya existe; borrando ${incorrectos.length} duplicado(s)`)
      if (!SOLO_SIMULAR) {
        for (const d of incorrectos) await borrarDocPorNombre(d.name)
      }
      duplicadosEliminados += incorrectos.length
      continue
    }

    const ordenados = incorrectos.slice().sort((a, b) => fechaMs(b.rawFields) - fechaMs(a.rawFields))
    const fuente = ordenados[0]
    const extras = ordenados.slice(1)
    if (extras.length) duplicadosEliminados += extras.length

    let respuestas = []
    try {
      respuestas = await listarColeccionRaw(`submissions/${fuente.id}/respuestas`)
    } catch {
      // subcolección no existe
    }

    const etiqueta = extras.length
      ? `  · ${fuente.id} → ${targetId}  (${extras.length} extra(s) descartado(s)${respuestas.length ? `, ${respuestas.length} respuesta(s)` : ''})`
      : `  · ${fuente.id} → ${targetId}${respuestas.length ? `  (${respuestas.length} respuesta(s))` : ''}`
    console.log(etiqueta)

    if (!SOLO_SIMULAR) {
      await escribirDocRaw('submissions', targetId, fuente.rawFields)
      for (const r of respuestas) {
        await escribirDocRaw(`submissions/${targetId}/respuestas`, r.id, r.rawFields)
      }
      await borrarDocPorNombre(fuente.name)
      for (const d of extras) await borrarDocPorNombre(d.name)
    }

    migradas++
  }

  console.log('\n── Resumen ──────────────────────────────────────────')
  console.log(`${todos.length} submissions encontradas`)
  console.log(`${migradas} ${SOLO_SIMULAR ? 'requieren migración' : 'migradas'}`)
  console.log(`${yaTenian} ya tienen ID determinista`)
  console.log(`${duplicadosEliminados} duplicados ${SOLO_SIMULAR ? 'que se descartarían' : 'eliminados'}`)
  console.log(`${colisiones} colisiones (id correcto ya existía + incorrectos borrados)`)
  if (SOLO_SIMULAR) console.log('\n⚠  Dry run — no se escribió nada. Quita --dry-run para ejecutar.')
  else console.log('\n✓  Migración completada.')
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nFalló:', err.message)
  process.exit(1)
})
