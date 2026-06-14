#!/usr/bin/env node
/**
 * Migrate teacher usernames from CCT-based format (e.g. "110020-01")
 * to school-short-name format (e.g. "CBTIS255-01").
 *
 * Usage: node migrate-usernames.js
 */

const admin = require('firebase-admin')
const os = require('os')
const path = require('path')

// Use Firebase CLI's stored OAuth credentials (same as clear-db.js does)
let credential
try {
  const firebaseCfg = require(path.join(os.homedir(), '.config/configstore/firebase-tools.json'))
  if (firebaseCfg.tokens) credential = admin.credential.refreshToken(firebaseCfg.tokens)
} catch (_) {}

try {
  admin.initializeApp({ projectId: 'evalua-facil-app', ...(credential ? { credential } : {}) })
} catch (_) {}

const db = admin.firestore()

function buildPrefix(shortName, nombre) {
  const name = (shortName || nombre || '').toUpperCase().replace(/\s+/g, '')
  return name
}

async function main() {
  // 1. Load all schools
  const schoolSnaps = await db.collection('schools').get()
  const schools = {}
  schoolSnaps.forEach((d) => { schools[d.id] = d.data() })

  console.log(`Found ${Object.keys(schools).length} school(s)\n`)

  // 2. For each school, load its teachers sorted by current username
  const batch = db.batch()
  let updateCount = 0

  for (const [schoolId, school] of Object.entries(schools)) {
    const prefix = buildPrefix(school.shortName, school.nombre)
    if (!prefix) {
      console.log(`  SKIP school ${schoolId} — no name available`)
      continue
    }

    const snap = await db.collection('users')
      .where('escuelaId', '==', schoolId)
      .where('role', '==', 'docente')
      .get()

    if (snap.empty) continue

    // Sort by existing username to keep the same relative order
    const teachers = snap.docs
      .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
      .sort((a, b) => (a.username || '').localeCompare(b.username || ''))

    console.log(`School: ${prefix} (${schoolId}) — ${teachers.length} teacher(s)`)

    teachers.forEach((teacher, i) => {
      const newUsername = `${prefix}-${String(i + 1).padStart(2, '0')}`
      console.log(`  ${teacher.username || '(no username)'} → ${newUsername}`)
      if (teacher.username !== newUsername) {
        batch.update(teacher.ref, { username: newUsername })
        updateCount++
      }
    })
  }

  if (updateCount === 0) {
    console.log('\nAll usernames already up to date.')
    process.exit(0)
  }

  console.log(`\nCommitting ${updateCount} update(s)…`)
  await batch.commit()
  console.log('Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
