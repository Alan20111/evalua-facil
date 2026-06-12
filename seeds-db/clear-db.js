#!/usr/bin/env node

/**
 * Clear all user/student/group/subject/activity/submission data from Firestore
 * Usage: node clear-db.js
 *
 * This script DESTRUCTIVELY deletes all documents in the specified collections.
 * It will prompt for confirmation before deleting.
 */

const admin = require('firebase-admin');
const readline = require('readline');
const path = require('path');

// Initialize Firebase Admin SDK
// Expects GOOGLE_APPLICATION_CREDENTIALS env var or automatic authentication via firebase-cli
try {
  admin.initializeApp({
    projectId: 'evalua-facil-app',
  });
} catch (err) {
  // Already initialized
}

const db = admin.firestore();

const COLLECTIONS_TO_DELETE = [
  'users',
  'students',
  'groups',
  'subjects',
  'activities',
  'submissions',
  'schools',
];

async function deleteCollection(collectionName) {
  console.log(`  Deleting collection: ${collectionName}...`);
  let deletedCount = 0;
  try {
    // Get all docs in batches
    const docs = await db.collection(collectionName).limit(1000).get();

    if (docs.empty) {
      console.log(`    ✓ Collection "${collectionName}" was already empty`);
      return 0;
    }

    // Delete in batch
    const batch = db.batch();
    docs.forEach((doc) => {
      batch.delete(doc.ref);
      deletedCount++;
    });

    await batch.commit();
    console.log(`    ✓ Deleted ${deletedCount} documents from "${collectionName}"`);
    return deletedCount;
  } catch (err) {
    console.error(`    ✗ Error deleting "${collectionName}":`, err.message);
    return 0;
  }
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase());
    });
  });
}

async function main() {
  console.log('\n🔥 FIRESTORE DATABASE CLEAR SCRIPT');
  console.log('=' .repeat(50));
  console.log(`Project: evalua-facil-app`);
  console.log(`Collections to delete: ${COLLECTIONS_TO_DELETE.join(', ')}`);
  console.log('=' .repeat(50));
  console.log('\n⚠️  WARNING: This will PERMANENTLY DELETE all data in these collections.');
  console.log('   This action CANNOT be undone.\n');

  const confirm = await prompt('Are you sure? Type "yes" to confirm: ');

  if (confirm !== 'yes') {
    console.log('\n❌ Cancelled. No data was deleted.\n');
    process.exit(0);
  }

  console.log('\n🗑️  Starting deletion...\n');

  let totalDeleted = 0;
  for (const collection of COLLECTIONS_TO_DELETE) {
    const deleted = await deleteCollection(collection);
    totalDeleted += deleted;
  }

  console.log(`\n✅ Deletion complete!`);
  console.log(`   Total documents deleted: ${totalDeleted}\n`);

  await admin.app().delete();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
