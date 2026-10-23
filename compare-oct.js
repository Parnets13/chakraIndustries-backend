// compare-oct.js — READ ONLY. Shows the sales-ledger / GSTLEDGERSOURCE that the
// CURRENT code resolves for a sample of items, and whether matchCategoryLedger
// (added after Oct-9) is overriding the stored ItemMaster ledger.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import ItemMaster from './models/ItemMaster.js';
import { matchCategoryLedger } from './services/tallyExportService.js';

const num = s => parseInt((String(s).match(/(\d+)\s*$/) || [])[1] || '0', 10);

async function main() {
  await connectDB();
  const invs = await Invoice.find({ invoiceNo: /^BIW/i, status: { $ne: 'Cancelled' } }, 'invoiceNo items').lean();
  invs.sort((a, b) => num(a.invoiceNo) - num(b.invoiceNo));
  const names = [...new Set(invs.flatMap(i => (i.items||[]).map(it => (it.description||it.name||'').trim())).filter(Boolean))];
  const masters = await ItemMaster.find({ name: { $in: names } }, 'name hsn tallySalesLedger').lean();
  const mMap = new Map(masters.map(m => [m.name, m]));

  // Fake Tally ledger list ~ what live fetch would return (we don't have live here);
  // instead just show stored-ledger vs category-match to see if they DIFFER.
  console.log('item | STORED ledger (ItemMaster) | CATEGORY-match would pick (if in Tally list)\n');
  let shown = 0;
  const seen = new Set();
  for (const inv of invs) {
    for (const it of (inv.items||[])) {
      const n = (it.description||it.name||'').trim();
      if (!n || seen.has(n)) continue; seen.add(n);
      const m = mMap.get(n);
      const stored = (m?.tallySalesLedger||'(none)');
      // We can't fetch live Tally here; show what category keyword would target.
      const cat = matchCategoryLedger([stored, 'Water Purifier Sales Local','Induction Stove Sales Local','Air Cooler Sales Local','Ceiling Fan Sales Local','Water Heater Sales Local','Dry Iron Sales Local'], n, +(it.igst||0)>0);
      const flag = (cat && cat !== stored) ? '   <-- CATEGORY OVERRIDES STORED' : '';
      console.log(`${n.slice(0,32).padEnd(33)} | ${stored.padEnd(32)} | ${cat||'(no match)'}${flag}`);
      if (++shown >= 30) break;
    }
    if (shown >= 30) break;
  }
  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
