/**
 * regenerate-tally-vouchers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Re-runs normalizeToTallyVoucher on all existing invoices so they pick up
 * the new inventory logic (items show as ALLINVENTORYENTRIES instead of narration).
 *
 * Run once after deploying the inventory fix:
 *   node scripts/regenerate-tally-vouchers.js
 *
 * Optional: pass --invoiceNo=BIW55 to regenerate a single invoice for testing.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';

const targetNo = process.argv.find(a => a.startsWith('--invoiceNo='))?.split('=')[1];

await mongoose.connect(process.env.MONGO_URI);
console.log('Connected to MongoDB');

const filter = {
  source: { $nin: ['Tally', 'tally'] },
  status: { $nin: ['Cancelled'] },
  ...(targetNo ? { invoiceNo: targetNo } : {}),
};

const invoices = await Invoice.find(filter).lean();
console.log(`\nFound ${invoices.length} invoices to regenerate`);

if (!invoices.length) {
  console.log('No invoices found.');
  await mongoose.disconnect();
  process.exit(0);
}

let success = 0, failed = 0;

for (const inv of invoices) {
  try {
    const normalized = normalizeToTallyVoucher(inv, {});
    await Invoice.updateOne(
      { _id: inv._id },
      { $set: { tallyVoucher: normalized } }
    );
    console.log(`✓ ${inv.invoiceNo} — inventoryEntries: ${normalized.allInventoryEntries.length}`);
    success++;
  } catch (err) {
    console.log(`✗ ${inv.invoiceNo} — ERROR: ${err.message}`);
    failed++;
  }
}

console.log(`\nDone: ${success} success, ${failed} failed`);
console.log('Invoices are now ready to export with inventory entries.');

await mongoose.disconnect();
