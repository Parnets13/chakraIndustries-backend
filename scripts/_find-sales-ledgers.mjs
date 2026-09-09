/**
 * READ-ONLY. Searches every collection that could hold Tally-imported ledger
 * names, and prints any that look like SALES ledgers or contain 'water'/'liv'.
 * Also checks what "AVR SWARNA MAHAL" is classified as. Changes nothing.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
const db = mongoose.connection.db;
console.log('DB:', mongoose.connection.name, '\n');

const collections = await db.listCollections().toArray();
const names = collections.map(c => c.name);
console.log('Collections:', names.join(', '), '\n');

// Fields that might hold a ledger/group name
const NAME_FIELDS = ['ledgerName', 'name', 'tallySalesLedger', 'parent', 'ledgerGroup', 'group'];

const salesHits = new Set();
const waterHits = new Set();
let avrInfo = [];

for (const coll of names) {
  let docs = [];
  try { docs = await db.collection(coll).find({}).limit(20000).toArray(); } catch { continue; }
  for (const d of docs) {
    for (const f of NAME_FIELDS) {
      const v = d[f];
      if (typeof v !== 'string' || !v.trim()) continue;
      const low = v.toLowerCase();
      if (low.includes('sales') || low.includes('sale ')) salesHits.add(`${v}   [${coll}.${f}]`);
      if (low.includes('water') || low.includes('liv') || low.includes('purifier')) waterHits.add(`${v}   [${coll}.${f}]`);
      if (low.includes('avr swarna')) {
        avrInfo.push(`${coll}: ledgerName/name="${d.ledgerName||d.name||''}" group="${d.ledgerGroup||d.parent||d.group||''}" type="${d.ledgerType||''}"`);
      }
    }
  }
}

console.log('════════ Names containing "SALES" ════════');
[...salesHits].sort().forEach(x => console.log('  ' + x));
console.log(`(${salesHits.size})\n`);

console.log('════════ Names containing water / liv / purifier ════════');
[...waterHits].sort().forEach(x => console.log('  ' + x));
console.log(`(${waterHits.size})\n`);

console.log('════════ "AVR SWARNA MAHAL" classified as ════════');
if (avrInfo.length) avrInfo.forEach(x => console.log('  ' + x));
else console.log('  (not found as a stored ledger/customer record)');

await mongoose.disconnect();
process.exit(0);
