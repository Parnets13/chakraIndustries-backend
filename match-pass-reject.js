// match-pass-reject.js — READ ONLY. For the invoices visible in the screenshot,
// computes Tally's Expected (one ROUND on full rate) vs what the CURRENT code
// (uncommitted base×rate) would send as Modified, and checks difference == 0.
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';

const r2 = n => +(+n).toFixed(2);

// Invoices seen rejected in the screenshot
const WATCH = ['BIW2445','BIW2446','BIW2447','BIW2448','BIW2449','BIW2451','BIW2452','BIW2453','BIW2459','BIW2461','BIW2462','BIW2434','BIW2433'];

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const invs = await Invoice.find({ invoiceNo: { $in: WATCH } }).lean();

  for (const inv of invs) {
    const tv = normalizeToTallyVoucher(inv, {});
    // Per voucher: sum base of intrastate items, derive full rate
    let base = 0, fullRate = 0;
    (tv.allInventoryEntries||[]).forEach(ie => {
      base += (+ie.amount||0);
      const rd = (ie.rateDetails||[]).filter(x=>['CGST','SGST/UTGST'].includes(x.gstRateDutyHead));
      const full = rd.reduce((s,x)=>s+(+x.gstRate||0),0);
      if (full > fullRate) fullRate = full;
    });
    base = r2(base);

    // Tally Expected: single ROUND on full rate, then split
    const expectedFull = r2(base * fullRate / 100);
    const expectedHalf = r2(expectedFull / 2); // Tally shows this per CGST/SGST line

    // What CURRENT code sends (its _totalCGST / _totalSGST)
    const sentCGST = r2(tv._totalCGST||0);
    const sentSGST = r2(tv._totalSGST||0);
    const sentFull = r2(sentCGST + sentSGST);

    const diff = r2(expectedFull - sentFull);
    const flag = Math.abs(diff) < 0.005 ? 'MATCH ✓' : `MISMATCH diff=${diff} ✗`;
    console.log(`${inv.invoiceNo}: base=${base} rate=${fullRate}%  Expected(full)=${expectedFull}  Sent(C+S)=${sentFull} (c=${sentCGST},s=${sentSGST})  → ${flag}`);
  }

  console.log('\nNOTE: Tally Expected = ROUND(base × fullRate, 2) as ONE number.');
  console.log('To match, CGST+SGST we send must equal that single rounded number.');

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
