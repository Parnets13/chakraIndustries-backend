// compare-ledgers.js — READ ONLY. Lists sales ledgers + items used by the 20 FAILED
// invoices vs the 80 PASSED, to find which ledger/item is unique to the failures.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

const FAILED = new Set(['BIW2552','BIW2553','BIW2554','BIW2555','BIW2556','BIW2557','BIW2558','BIW2559','BIW2560','BIW2561','BIW2562','BIW2563','BIW2564','BIW2565','BIW2566','BIW2567','BIW2568','BIW2569','BIW2570','BIW2571']);

async function main() {
  await connectDB();
  const invs = await Invoice.find({ status: { $nin: ['Cancelled'] } }).lean();

  const failLedgers = new Map(); // ledger -> count
  const passLedgers = new Set();
  const failItems = new Map();
  const passItems = new Set();

  for (const inv of invs) {
    const isFail = FAILED.has(inv.invoiceNo);
    for (const it of (inv.items || [])) {
      const led = (it.tallySalesLedger || '(empty→Sales)').trim() || '(empty→Sales)';
      const item = (it.description || it.name || '').trim();
      if (isFail) {
        failLedgers.set(led, (failLedgers.get(led) || 0) + 1);
        failItems.set(item, led);
      } else {
        passLedgers.add(led);
        passItems.add(item);
      }
    }
  }

  console.log('═══ Sales ledgers in FAILED invoices ═══');
  for (const [led, cnt] of [...failLedgers.entries()].sort((a,b)=>b[1]-a[1])) {
    const alsoPass = passLedgers.has(led);
    console.log(`  "${led}"  (${cnt}×)  ${alsoPass ? 'also in PASSED' : '← ONLY in FAILED'}`);
  }

  console.log('\n═══ Items in FAILED not seen in PASSED ═══');
  let uniq = 0;
  for (const [item, led] of failItems) {
    if (!passItems.has(item)) { console.log(`  "${item}" → ledger "${led}"`); uniq++; }
  }
  if (!uniq) console.log('  (all failed items also appear in passed invoices)');

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
