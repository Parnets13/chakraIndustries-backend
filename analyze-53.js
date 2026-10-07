// analyze-53.js — READ ONLY. For each item, shows:
//   Tally Expected = ROUND(base * rate/100, 2)
//   Excel value    = item.cgst
//   Difference
// to decide the correct universal rule.
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

const r2 = n => +(+n).toFixed(2);
const SLABS = [0,2.5,5,6,9,12,14,18,28];
const snap = r => r<=0?0:SLABS.reduce((b,s)=>Math.abs(s-r)<Math.abs(b-r)?s:b,0);

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const invs = await Invoice.find({ status: { $nin: ['Cancelled'] } }).sort({createdAt:1}).lean();

  let excelMatches = 0, baseRateMatches = 0, neither = 0, both = 0;
  const examples = [];

  for (const inv of invs) {
    for (const it of (inv.items||[])) {
      const name = (it.description||it.name||'').trim();
      if (!name) continue;
      const base = r2(+(it.basic||it.amount||0) || (+(it.qty||1)*+(it.rate||0)));
      const cg = +(it.cgst||0), ig = +(it.igst||0);
      if (base<=0) continue;
      if (ig > 0) continue; // focus on intrastate CGST case shown in screenshot

      // derive half rate from excel
      const halfRate = snap(+(cg/base*100).toFixed(4));
      const expected = r2(base * halfRate / 100);   // what Tally expects
      const excel    = r2(cg);                        // what Excel has

      const excelOk = Math.abs(expected - excel) < 0.005;
      if (excelOk) excelMatches++; else baseRateMatches++;

      if (!excelOk && examples.length < 15) {
        examples.push(`${inv.invoiceNo} ${name.slice(0,22)}: base=${base} rate=${halfRate}% Expected=${expected} Excel=${excel} diff=${r2(expected-excel)}`);
      }
    }
  }

  console.log('═══ Intrastate CGST lines: Excel vs Tally-Expected (base×rate) ═══');
  console.log(`  Excel already == Expected: ${excelMatches}`);
  console.log(`  Excel != Expected (would mismatch): ${baseRateMatches}`);
  console.log('');
  console.log('If we send base×rate (Tally Expected), ALL lines match Expected → difference 0.');
  console.log('');
  console.log('Examples where Excel differs from Expected:');
  examples.forEach(e => console.log('  • ' + e));

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
