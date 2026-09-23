/**
 * _check_pending.mjs — READ ONLY.
 * Lists, per PENDING invoice, the distinct item->ledger pairs actually stored
 * on the invoice items (this is what gets sent to Tally). Groups by ledger so
 * we can see which ledger the remaining failures use.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGO_URI);

const pending = await Invoice.find(
  { tallySync: { $ne: true }, source: { $nin: ['Tally', 'tally'] } },
  'invoiceNo items'
).lean();

console.log(`Pending invoices: ${pending.length}\n`);

const pairs = new Map(); // "item || ledger" -> count
const invByLedger = new Map();
for (const inv of pending) {
  for (const it of (inv.items || [])) {
    const name = (it.description || it.name || '').trim();
    const led = (it.tallySalesLedger || '').trim() || '(EMPTY -> auto)';
    const key = `${name}  ||  ${led}`;
    pairs.set(key, (pairs.get(key) || 0) + 1);
    if (!invByLedger.has(led)) invByLedger.set(led, new Set());
    invByLedger.get(led).add(inv.invoiceNo);
  }
}

console.log('=== Distinct item -> ledger pairs in pending invoices ===');
[...pairs.entries()].sort().forEach(([k, c]) => console.log(`  (${c}x) ${k}`));

console.log('\n=== Pending invoices grouped by ledger used ===');
for (const [led, set] of invByLedger) {
  console.log(`\n  LEDGER: ${led}  (${set.size} invoices)`);
  console.log('    ' + [...set].join(', '));
}

await mongoose.disconnect();
process.exit(0);
