/**
 * clear-cached-ledgers.js — ONE-TIME migration.
 *
 * Clears the cached tallySalesLedger on every ItemMaster so the corrected
 * resolveSalesLedger() logic (product-type mapping + state-based Local/Interstate)
 * re-resolves each item on the next export.
 *
 * Run ONCE after deploying the ledger-mapping fix:
 *     node clear-cached-ledgers.js
 *
 * Safe to re-run: it only unsets the field; the next export repopulates it.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ItemMaster from './models/ItemMaster.js';

dotenv.config();

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('No MONGODB_URI / MONGO_URI found in environment. Aborting.');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB.');

  const res = await ItemMaster.updateMany({}, { $unset: { tallySalesLedger: 1 } });
  console.log(`Cleared tallySalesLedger on ${res.modifiedCount} ItemMaster document(s).`);

  await mongoose.disconnect();
  console.log('Done. The next export will re-resolve each item\'s sales ledger.');
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
