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
 *
 * NOTE: uses the app's connectDB() helper (config/database.js) so it gets the
 * same DNS override that lets the mongodb+srv SRV record resolve. Using the raw
 * URI directly fails with "querySrv ECONNREFUSED" on networks with bad DNS.
 */
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import ItemMaster from './models/ItemMaster.js';

async function run() {
  await connectDB();
  console.log('Connected to MongoDB.');

  // Count how many actually have a value before clearing (for a clear report).
  const before = await ItemMaster.countDocuments({
    tallySalesLedger: { $exists: true, $nin: ['', null] },
  });
  console.log(`ItemMaster docs with a cached tallySalesLedger: ${before}`);

  const res = await ItemMaster.updateMany({}, { $unset: { tallySalesLedger: 1 } });
  console.log(`Cleared tallySalesLedger on ${res.modifiedCount} ItemMaster document(s).`);

  await mongoose.disconnect();
  console.log('Done. The next export will re-resolve each item\'s sales ledger.');
  process.exit(0);
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
