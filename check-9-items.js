// check-9-items.js — READ ONLY. For the 9 failing invoices, shows the item's
// ItemMaster.gst and hsn, and whether the auto-masters step would set a rate in Tally.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import ItemMaster from './models/ItemMaster.js';

const FAILED = ['BIW2560','BIW2565','BIW2567','BIW2568','BIW2569','BIW2570','BIW2571','BIW2629','BIW2630'];
const r2 = n => +(+n).toFixed(2);
const SLABS=[0,2.5,5,6,9,12,14,18,28];
const snap=r=>r<=0?0:SLABS.reduce((b,s)=>Math.abs(s-r)<Math.abs(b-r)?s:b,0);

async function main() {
  await connectDB();
  const invs = await Invoice.find({ invoiceNo: { $in: FAILED } }).lean();

  const names = [...new Set(invs.flatMap(i=>(i.items||[]).map(it=>(it.description||it.name||'').trim())).filter(Boolean))];
  const masters = await ItemMaster.find({ name: { $in: names } }, 'name gst hsn tallySalesLedger').lean();
  const mMap = new Map(masters.map(m=>[m.name,m]));

  console.log('Invoice   Item                                 ExcelRate  ItemMaster.gst  hsn(inv/master)  autoMasterRate');
  console.log('─'.repeat(115));
  for (const inv of invs) {
    for (const it of (inv.items||[])) {
      const name=(it.description||it.name||'').trim();
      const base=r2(+(it.basic||it.amount||0)||(+(it.qty||1)*+(it.rate||0)));
      const tax=(+(it.cgst||0))+(+(it.sgst||0))+(+(it.igst||0));
      const excelRate = base>0 ? snap(+(tax/base*100).toFixed(4)) : 0;
      const m = mMap.get(name);
      // auto-masters logic: rate from item taxRate, else back-calc from cgst+sgst+base, else ItemMaster.gst
      let autoRate = +(it.taxRate||0);
      if (!autoRate) { if (tax>0 && base>0) autoRate = Math.round((tax/base)*100*2)/2; }
      if (!autoRate && m?.gst>0) autoRate = m.gst;
      console.log(`${inv.invoiceNo}  ${name.slice(0,34).padEnd(34)}  ${(excelRate+'%').padEnd(9)}  ${String(m?.gst ?? 'N/A').padEnd(14)}  ${((it.hsn||'∅')+'/'+(m?.hsn||'∅')).padEnd(15)}  ${autoRate}%`);
    }
  }

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
