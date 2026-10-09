// why-20-failed.js — READ ONLY. For each of the 20 failed invoices, states the
// likely reason: ledger missing/generic, ledger rate != item rate, or looks fine.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

const FAILED = ['BIW2552','BIW2553','BIW2554','BIW2555','BIW2556','BIW2557','BIW2558','BIW2559','BIW2560','BIW2561','BIW2562','BIW2563','BIW2564','BIW2565','BIW2566','BIW2567','BIW2568','BIW2569','BIW2570','BIW2571'];
const r2 = n => +(+n).toFixed(2);
const SLABS=[0,2.5,5,6,9,12,14,18,28];
const snap=r=>r<=0?0:SLABS.reduce((b,s)=>Math.abs(s-r)<Math.abs(b-r)?s:b,0);

// extract a rate like "5%" from a ledger name, else null
function ledgerRate(name){ const m=(name||'').match(/(\d+(?:\.\d+)?)\s*%/); return m?parseFloat(m[1]):null; }

async function main() {
  await connectDB();
  const invs = await Invoice.find({ invoiceNo: { $in: FAILED } }).lean();
  const map = new Map(invs.map(i=>[i.invoiceNo,i]));

  console.log('Invoice   Item                              ItemRate  Ledger                               Reason');
  console.log('─'.repeat(130));
  for (const no of FAILED) {
    const inv = map.get(no);
    if (!inv) { console.log(`${no}  (not found)`); continue; }
    (inv.items||[]).forEach(it=>{
      const item=(it.description||it.name||'').trim();
      const base=r2(+(it.basic||it.amount||0)||(+(it.qty||1)*+(it.rate||0)));
      const tax=(+(it.cgst||0))+(+(it.sgst||0))+(+(it.igst||0));
      const itemRate = base>0 ? snap(+(tax/base*100).toFixed(4)) : 0;
      const led=(it.tallySalesLedger||'').trim();
      const lr = ledgerRate(led);

      let reason;
      if (!led) reason = 'NO LEDGER SET → uses generic "Sales" (no GST rate in Tally) → rate mismatch';
      else if (lr !== null && Math.abs(lr - itemRate) > 0.01) reason = `LEDGER RATE ${lr}% != ITEM RATE ${itemRate}% → tax-rate mismatch`;
      else reason = `ledger "${led}" — rate ok on name; may be missing GST rate in Tally master`;

      console.log(`${no}  ${item.slice(0,32).padEnd(32)}  ${String(itemRate+'%').padEnd(8)}  ${(led||'(empty)').slice(0,34).padEnd(34)}  ${reason}`);
    });
  }

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
