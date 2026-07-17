/**
 * fixIdempotencyIndex.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-time migration to fix the compound idempotency index on materialreturns.
 *
 * ROOT CAUSE:
 *   The schema had `idempotencyKey: { type: String, default: null, sparse: true }`.
 *   The `default: null` meant every document without a key got `null` stored
 *   explicitly. MongoDB's sparse index only skips documents where the field is
 *   ABSENT — a field set to `null` is still "present". So the sparse unique
 *   compound index { dealerId, idempotencyKey } still enforced uniqueness on null,
 *   meaning the second return from the same dealer failed with E11000.
 *
 * FIX:
 *   1. Drop the stale compound index `dealer_idempotency_key`.
 *   2. Also set idempotencyKey = undefined on all existing documents that have
 *      null (so future queries don't clash).
 *   3. Recreate the compound index as sparse + unique — now it only triggers
 *      when a real key is present.
 *
 * Run once:
 *   node scripts/fixIdempotencyIndex.js
 * ─────────────────────────────────────────────────────────────────────────────
 */
import mongoose from 'mongoose';
import dotenv   from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌  MONGO_URI not found in .env — aborting.');
  process.exit(1);
}

async function run() {
  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(MONGO_URI);
  console.log('✅  Connected.\n');

  const collection = mongoose.connection.collection('materialreturns');

  // ── Step 1: List current indexes ─────────────────────────────────────────────
  const existingIndexes = await collection.indexes();
  console.log('📋  Current indexes on materialreturns:');
  existingIndexes.forEach(idx => {
    const flags = [];
    if (idx.unique) flags.push('unique');
    if (idx.sparse) flags.push('sparse');
    console.log(`   • ${idx.name}  key=${JSON.stringify(idx.key)}  [${flags.join(', ')}]`);
  });
  console.log('');

  // ── Step 2: Drop the stale compound index if it exists ───────────────────────
  const staleIdx = existingIndexes.find(idx => idx.name === 'dealer_idempotency_key');
  if (staleIdx) {
    console.log('🗑️   Dropping stale compound index "dealer_idempotency_key"…');
    await collection.dropIndex('dealer_idempotency_key');
    console.log('✅  Dropped.\n');
  } else {
    console.log('ℹ️   "dealer_idempotency_key" index not found — may already be fixed.\n');
  }

  // ── Step 3: Clear null idempotencyKey from all existing documents ────────────
  // Documents with null were created before the fix. We use $unset so the field
  // is absent rather than null — the new sparse index will then correctly skip them.
  console.log('🧹  Unsetting idempotencyKey: null on existing documents…');
  const result = await collection.updateMany(
    { idempotencyKey: null },
    { $unset: { idempotencyKey: '' } }
  );
  console.log(`✅  Updated ${result.modifiedCount} document(s).\n`);

  // ── Step 4: Recreate the compound sparse unique index ────────────────────────
  console.log('🔧  Creating correct sparse unique compound index…');
  await collection.createIndex(
    { dealerId: 1, idempotencyKey: 1 },
    { unique: true, sparse: true, name: 'dealer_idempotency_key' }
  );
  console.log('✅  Created.\n');

  // ── Step 5: Verify ────────────────────────────────────────────────────────────
  const updatedIndexes = await collection.indexes();
  const newIdx = updatedIndexes.find(idx => idx.name === 'dealer_idempotency_key');
  if (newIdx && newIdx.unique && newIdx.sparse) {
    console.log('🎉  Verification passed:');
    console.log(`   • dealer_idempotency_key  unique=true  sparse=true  ← correct`);
    console.log('\n✅  Migration complete. Every new return request will now create successfully.\n');
  } else {
    console.error('❌  Verification failed — please check the index manually.');
    console.error('   Found:', newIdx);
  }

  await mongoose.disconnect();
  console.log('🔌  Disconnected.');
}

run().catch(err => {
  console.error('❌  Migration failed:', err.message);
  mongoose.disconnect();
  process.exit(1);
});
