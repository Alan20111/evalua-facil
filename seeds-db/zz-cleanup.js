const admin = require('firebase-admin')
const sa = require('./service-account.json')
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()
const auth = admin.auth()

const TEST_UIDS = ['zztest-docente-chat-uid', 'zztest-docente-ajeno-uid']
const SCHOOL_ID = 'zztest-chat-escuela'
const SUBJECT_ID = 'zztest-chat-subject'
const ACTIVITY_ID = 'zztest-chat-activity'
const STUDENT_IDS = ['zztest-chat-student-1', 'zztest-chat-student-2', 'zztest-chat-student-3']
const SUB_IDS = ['zztest-chat-sub-1', 'zztest-chat-sub-2', 'zztest-chat-sub-3']

async function deleteCollection(colPath, field, value) {
  const snap = await db.collection(colPath).where(field, '==', value).get()
  for (const doc of snap.docs) {
    await doc.ref.delete()
    console.log(`  deleted ${colPath}/${doc.id}`)
  }
}

async function main() {
  // 1. Delete Auth users
  for (const uid of TEST_UIDS) {
    try {
      await auth.deleteUser(uid)
      console.log(`Auth: deleted ${uid}`)
    } catch (e) {
      if (e.code === 'auth/user-not-found') console.log(`Auth: ${uid} not found (ok)`)
      else console.error(`Auth error for ${uid}:`, e.message)
    }
  }

  // 2. iaSugerenciasEntregable subcollection
  for (const subId of SUB_IDS) {
    try {
      await db.doc(`activities/${ACTIVITY_ID}/iaSugerenciasEntregable/${subId}`).delete()
      console.log(`  deleted activities/${ACTIVITY_ID}/iaSugerenciasEntregable/${subId}`)
    } catch (e) { console.log(`  iaSugerencias/${subId}: ${e.message}`) }
  }

  // 3. Known docs by path
  const paths = [
    `schools/${SCHOOL_ID}`,
    `subjects/${SUBJECT_ID}`,
    `activities/${ACTIVITY_ID}`,
    ...TEST_UIDS.map(uid => `users/${uid}`),
    ...TEST_UIDS.map(uid => `iaCreditos/${uid}`),
    ...STUDENT_IDS.map(id => `students/${id}`),
    ...SUB_IDS.map(id => `submissions/${id}`),
  ]
  for (const path of paths) {
    try {
      await db.doc(path).delete()
      console.log(`  deleted ${path}`)
    } catch (e) { console.log(`  ${path}: ${e.message}`) }
  }

  // 4. iaConsumos: any docs belonging to zztest UIDs
  for (const uid of TEST_UIDS) {
    await deleteCollection('iaConsumos', 'uid', uid)
    await deleteCollection('iaConsumosInterno', 'uid', uid)
  }

  // 5. Catch-all: any Firestore doc whose ID starts with zztest- in top-level collections
  const topCollections = ['schools', 'users', 'students', 'subjects', 'activities', 'submissions', 'iaCreditos', 'iaConsumos', 'iaConsumosInterno']
  for (const col of topCollections) {
    const snap = await db.collection(col).get()
    for (const doc of snap.docs) {
      if (doc.id.startsWith('zztest-')) {
        await doc.ref.delete()
        console.log(`  catch-all deleted ${col}/${doc.id}`)
      }
    }
  }

  console.log('\nDone.')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
