/**
 * reset-tally-sync-for-reexport.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Clears tallySync=true on ERP invoices so they re-export to Tally with the
 * fixed XML (items, PO number, ship-to now included correctly).
 *
 * Invoices that already exist in Tally will be sent as ACTION="Alter" so Tally
 * updates the existing voucher — no duplicates created.
 *
 * Run once after deploying the fix:
 *   node scripts/reset-tally-sync-for-reexport.js
 *
 * Optional: pass --invoiceNo=BIW55 to reset a single invoice for testing.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

const targetNo = process.argv.find(a => a.startsWith('--invoiceNo='))?.split('=')[1];

await mongoose.connect(process.env.MONGO_URI);
console.log('Connected to MongoDB');

const filter = {
  source:    { $nin: ['Tally', 'tally'] },
  status:    { $nin: ['Cancelled'] },
  tallySync: true,
  ...(targetNo ? { invoiceNo: targetNo } : {}),
};

// Show what will be reset before doing it
const toReset = await Invoice.find(filter, { invoiceNo: 1, partyName: 1, grandTotal: 1, tallySync: 1 }).lean();
console.log(`\nInvoices to reset (${toReset.length}):`);
toReset.forEach(inv =>
  console.log(`  ${inv.invoiceNo} | ${inv.partyName} | ₹${inv.grandTotal}`)
);

if (!toReset.length) {
  console.log('Nothing to reset — all ERP invoices are either already pending or from Tally.');
  await mongoose.disconnect();
  process.exit(0);
}

const result = await Invoice.updateMany(filter, {
  $unset: { tallySync: 1, tallySyncAt: 1 },
});
console.log(`\nReset ${result.modifiedCount} invoices → tallySync cleared.`);
console.log('These invoices will be re-exported on the next scheduler cycle (15 min)');
console.log('or trigger manually from Tally Settings → Export to Tally.');

await mongoose.disconnect();
