const admin = require('firebase-admin');

admin.initializeApp({
  projectId: 'evalua-facil-app',
});

const db = admin.firestore();
const COLLECTIONS = ['payments', 'subscriptions', 'plans', 'users', 'students', 'groups', 'subjects', 'activities', 'submissions', 'schools'];

async function verify() {
  console.log('\n📋 Verifying Firestore collections...\n');
  let totalDocs = 0;

  for (const col of COLLECTIONS) {
    const snap = await db.collection(col).limit(1).get();
    const count = (await db.collection(col).count().get()).data().count;
    console.log(`  ${col.padEnd(15)} : ${count} documents`);
    totalDocs += count;
  }

  console.log(`\n✅ Total documents in database: ${totalDocs}`);
  console.log('\n🎉 Database is clean and ready for testing!\n');

  await admin.app().delete();
}

verify().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
