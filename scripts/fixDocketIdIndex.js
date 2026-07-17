/**
 * fixDocketIdIndex.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-time migration to fix the stale non-sparse unique index on `docketId`
 * in the materialreturns collection.
 *
 * ROOT CAUSE:
 *   At some earlier point, `docketId` was defined as `unique: true` (without
 *   sparse: true). That index was written to MongoDB. When the schema was later
 *   updated to `sparse: true`, Mongoose did NOT drop the old index automatically.
 *   The live database still has a non-sparse unique index called `docketId_1`.
 *   A non-sparse unique index treats `null` as a real value, so the SECOND return
 *   request (which has no docketId at creation) fails with E11000.
 *
 * FIX:
 *   1. Drop the stale `docketId_1` index.
 *   2. Recreate it as a SPARSE + UNIQUE index so multiple null values are allowed.
 *      (docketId is only assigned when a return is approved — most documents will
 *       have null at creation time.)
 *
 * Run once:
 *   node scripts/fixDocketIdIndex.js
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

  // ── Step 1: List current indexes so we know what exists ─────────────────────
  const existingIndexes = await collection.indexes();
  console.log('📋  Current indexes on materialreturns:');
  existingIndexes.forEach(idx => {
    const flags = [];
    if (idx.unique) flags.push('unique');
    if (idx.sparse) flags.push('sparse');
    console.log(`   • ${idx.name}  key=${JSON.stringify(idx.key)}  ${flags.join(', ')}`);
  });
  console.log('');

  // ── Step 2: Drop the stale non-sparse unique docketId index if it exists ────
  const staleIndex = existingIndexes.find(
    idx => idx.name === 'docketId_1' && idx.unique && !idx.sparse
  );

  if (staleIndex) {
    console.log('🗑️   Found stale non-sparse unique index "docketId_1" — dropping it…');
    await collection.dropIndex('docketId_1');
    console.log('✅  Dropped "docketId_1".\n');
  } else {
    // Check if the index exists at all (might already be sparse, or different name)
    const anyDocketIdx = existingIndexes.find(idx => idx.name === 'docketId_1');
    if (anyDocketIdx) {
      if (anyDocketIdx.sparse) {
        console.log('ℹ️   "docketId_1" already exists and is sparse — no action needed.\n');
        await mongoose.disconnect();
        return;
      }
      // Exists but not named as expected — drop it anyway
      console.log(`⚠️   "docketId_1" found with unexpected flags — dropping it…`);
      await collection.dropIndex('docketId_1');
      console.log('✅  Dropped.\n');
    } else {
      console.log('ℹ️   No stale "docketId_1" index found — it may have been fixed already.\n');
    }
  }

  // ── Step 3: Create the correct sparse + unique index ─────────────────────────
  console.log('🔧  Creating correct sparse unique index on docketId…');
  await collection.createIndex(
    { docketId: 1 },
    { unique: true, sparse: true, name: 'docketId_1' }
  );
  console.log('✅  Created sparse unique index "docketId_1".\n');

  // ── Step 4: Verify ────────────────────────────────────────────────────────────
  const updatedIndexes = await collection.indexes();
  const newIdx = updatedIndexes.find(idx => idx.name === 'docketId_1');
  if (newIdx && newIdx.unique && newIdx.sparse) {
    console.log('🎉  Verification passed:');
    console.log(`   • docketId_1  unique=true  sparse=true  ← correct`);
    console.log('\n✅  Migration complete. Return requests will no longer fail with E11000.\n');
  } else {
    console.error('❌  Verification failed — please check the index manually.');
    console.error('   Found:', newIdx);
  }

  await mongoose.disconnect();
  console.log('🔌  Disconnected from MongoDB.');
}

run().catch(err => {
  console.error('❌  Migration failed:', err.message);
  mongoose.disconnect();
  process.exit(1);
});
