// failed-report.js — READ ONLY. Clean report: which invoices did NOT upload and why.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

const r2 = n => +(+n).toFixed(2);
const SLABS=[0,2.5,5,6,9,12,14,18,28];
const snap=r=>r<=0?0:SLABS.reduce((b,s)=>Math.abs(s-r)<Math.abs(b-r)?s:b,0);
const ledgerRate = name => { const m=(name||'').match(/(\d+(?:\.\d+)?)\s*%/); return m?parseFloat(m[1]):null; };

async function main() {
  await connectDB();

  const pending = await Invoice.find({ status: { $nin: ['Cancelled'] }, tallySync: { $ne: true } })
    .sort({ invoiceNo: 1 }).lean();

  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log(`║  INVOICES NOT UPLOADED TO TALLY: ${pending.length}`);
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Categorize
  const noLedger = [], wrongRate = [], maybeMissingRate = [];

  for (const inv of pending) {
    for (const it of (inv.items || [])) {
      const item = (it.description || it.name || '').trim();
      const base = r2(+(it.basic||it.amount||0) || (+(it.qty||1)*+(it.rate||0)));
      const tax  = (+(it.cgst||0))+(+(it.sgst||0))+(+(it.igst||0));
      const itemRate = base>0 ? snap(+(tax/base*100).toFixed(4)) : 0;
      const led = (it.tallySalesLedger || '').trim();
      const lr = ledgerRate(led);

      if (!led) noLedger.push({ no: inv.invoiceNo, item });
      else if (lr !== null && Math.abs(lr - itemRate) > 0.01) wrongRate.push({ no: inv.invoiceNo, item, led, lr, itemRate });
      else maybeMissingRate.push({ no: inv.invoiceNo, item, led });
    }
  }

  console.log(`─── REASON 1: No sales ledger set (item uses generic "Sales", no GST rate) ─── [${noLedger.length}]`);
  noLedger.forEach(x => console.log(`   ${x.no}   ${x.item}`));

  console.log(`\n─── REASON 2: Ledger GST rate wrong for the item ─── [${wrongRate.length}]`);
  wrongRate.forEach(x => console.log(`   ${x.no}   ${x.item}  → ledger "${x.led}" is ${x.lr}% but item is ${x.itemRate}%`));

  console.log(`\n─── REASON 3: Ledger name ok, but GST rate likely missing on that ledger in Tally ─── [${maybeMissingRate.length}]`);
  maybeMissingRate.forEach(x => console.log(`   ${x.no}   ${x.item}  → "${x.led}"`));

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('All not-uploaded invoice numbers:');
  console.log('  ' + pending.map(p => p.invoiceNo).join(', '));

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
