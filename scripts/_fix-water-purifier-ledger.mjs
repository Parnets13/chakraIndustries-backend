/**
 * Fix wrongly-set sales ledger on water-purifier invoices.
 *
 * Problem: some invoice items have tallySalesLedger set to a CUSTOMER name
 * ("AVR SWARNA MAHAL JEWELRY LIMITED ...", group = Sundry Debtors), which Tally
 * rejects (silent EXCEPTIONS). The correct sales ledger for these Livpure water
 * purifiers is "Water Purifier Sales Local".
 *
 * This script:
 *   1. Finds invoice items whose tallySalesLedger looks like that customer name.
 *   2. Rewrites them to the correct sales ledger.
 *   3. Also fixes the matching ItemMaster records so future uploads are correct.
 *   4. Resets retryCount + tallySync on the affected invoices so they re-export.
 *
 * SAFE: runs in DRY-RUN by default (shows what it WOULD change, changes nothing).
 * To actually apply, pass  --apply
 *
 * Usage:
 *   node scripts/_fix-water-purifier-ledger.mjs            (dry run)
 *   node scripts/_fix-water-purifier-ledger.mjs --apply     (apply changes)
 *   $env:MONGO_URI="<prod uri>"; node scripts/_fix-water-purifier-ledger.mjs --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import ItemMaster from '../models/ItemMaster.js';

const APPLY = process.argv.includes('--apply');
const CORRECT_LEDGER = 'Water Purifier Sales Local';

// Matches the customer name mistakenly used as a sales ledger.
const isBadLedger = (l) => /avr\s*swarna\s*mahal/i.test(l || '');

await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
console.log(`DB: ${mongoose.connection.name}  |  MODE: ${APPLY ? 'APPLY (writing changes)' : 'DRY-RUN (no changes)'}\n`);

// ── 1. Find affected invoices (non-Tally, not cancelled) ─────────────────────
const invoices = await Invoice.find({
  source: { $nin: ['Tally', 'tally'] },
  status: { $nin: ['Cancelled'] },
  'items.tallySalesLedger': { $regex: /avr\s*swarna\s*mahal/i },
}).lean();

console.log(`Invoices with the bad sales ledger: ${invoices.length}\n`);

const affectedItemNames = new Set();
const invoiceIdsToReset = [];

for (const inv of invoices) {
  const changed = [];
  for (const it of (inv.items || [])) {
    if (isBadLedger(it.tallySalesLedger)) {
      changed.push(`${(it.description || it.name || '').trim()}  ("${it.tallySalesLedger}" → "${CORRECT_LEDGER}")`);
      affectedItemNames.add((it.description || it.name || '').trim());
    }
  }
  if (changed.length) {
    invoiceIdsToReset.push(inv._id);
    console.log(`  ${inv.invoiceNo}: ${changed.join(' | ')}`);
  }
}

console.log(`\nDistinct item names to fix in ItemMaster: ${affectedItemNames.size}`);
[...affectedItemNames].forEach(n => console.log(`   - ${n}`));

if (!APPLY) {
  console.log('\nDRY-RUN complete. Nothing was changed.');
  console.log('Re-run with  --apply  to write these changes.');
  await mongoose.disconnect();
  process.exit(0);
}

// ── 2. APPLY: update invoice items ───────────────────────────────────────────
let invItemsUpdated = 0;
for (const inv of invoices) {
  const items = (inv.items || []).map(it =>
    isBadLedger(it.tallySalesLedger) ? { ...it, tallySalesLedger: CORRECT_LEDGER } : it
  );
  const res = await Invoice.updateOne(
    { _id: inv._id },
    { $set: { items, tallySync: false, tallySyncAt: null, retryCount: 0 } }
  );
  if (res.modifiedCount) invItemsUpdated++;
}
console.log(`\n✓ Updated ${invItemsUpdated} invoice(s): fixed ledger + reset retryCount/tallySync so they re-export.`);

// ── 3. APPLY: update ItemMaster so future uploads are correct ────────────────
let masterUpdated = 0;
for (const name of affectedItemNames) {
  const res = await ItemMaster.updateOne(
    { name, tallySalesLedger: { $regex: /avr\s*swarna\s*mahal/i } },
    { $set: { tallySalesLedger: CORRECT_LEDGER } }
  );
  if (res.modifiedCount) masterUpdated++;
}
console.log(`✓ Updated ${masterUpdated} ItemMaster record(s) to "${CORRECT_LEDGER}".`);

console.log('\nDone. Now run the Sales export again — these invoices will export with the correct sales ledger.');

await mongoose.disconnect();
process.exit(0);
