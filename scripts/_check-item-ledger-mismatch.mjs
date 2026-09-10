/**
 * READ-ONLY. For pending (non-Tally) invoices, lists each item with its current
 * tallySalesLedger, and flags items whose ledger category does NOT match the
 * item name (e.g. a "Water Heater" item pointing at a "Fan Heater" sales ledger).
 * Changes nothing.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
console.log('DB:', mongoose.connection.name, '\n');

const invoices = await Invoice.find({
  source: { $nin: ['Tally', 'tally'] },
  status: { $nin: ['Cancelled'] },
}).lean();

// Simple keyword → expected-ledger-keyword hints (informational only)
const rules = [
  { itemKw: /water heater|storage water|geyser|aquator|maveric/i, wantKw: /water heater/i, label: 'Water Heater' },
  { itemKw: /water purifier|\bRO\b|RO\+UV|purifier|liv-|livpure.*(RO|purifier)/i, wantKw: /water purifier/i, label: 'Water Purifier' },
  { itemKw: /air cooler|cooler|coolmist|evercool|icewave/i, wantKw: /air cooler/i, label: 'Air Cooler' },
  { itemKw: /fan heater|fan-heater/i, wantKw: /fan heater/i, label: 'Fan Heater' },
  { itemKw: /comforter/i, wantKw: /comforter/i, label: 'Comforter' },
];

const perItem = new Map(); // "item || ledger" → count
const mismatches = new Map();

for (const inv of invoices) {
  for (const it of (inv.items || [])) {
    const name = (it.description || it.name || '').trim();
    const ledger = (it.tallySalesLedger || '').trim();
    if (!name) continue;
    const key = `${name}  ⇒  ${ledger || '(empty)'}`;
    perItem.set(key, (perItem.get(key) || 0) + 1);

    for (const r of rules) {
      if (r.itemKw.test(name)) {
        if (ledger && !r.wantKw.test(ledger)) {
          const mk = `[${r.label}] "${name}"  has ledger "${ledger}"  (expected a ${r.label} sales ledger)`;
          mismatches.set(mk, (mismatches.get(mk) || 0) + 1);
        }
        break;
      }
    }
  }
}

console.log('════════ DISTINCT item → sales-ledger pairs (pending invoices) ════════');
[...perItem.keys()].sort().forEach(k => console.log(`  ${k}   ×${perItem.get(k)}`));

console.log('\n════════ ⚠️ LIKELY MISMATCHES (item category ≠ ledger category) ════════');
if (mismatches.size === 0) console.log('  none detected by keyword rules');
else [...mismatches.keys()].sort().forEach(k => console.log(`  ${k}   (${mismatches.get(k)} item-line[s])`));

await mongoose.disconnect();
process.exit(0);
