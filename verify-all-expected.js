// verify-all-expected.js — READ ONLY. For ALL invoices, confirms per voucher that
// CGST+SGST (or IGST) we send == Tally Expected = ROUND(base × fullRate, 2),
// and the voucher is balanced.
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';

const r2 = n => +(+n).toFixed(2);

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const invs = await Invoice.find({ status: { $nin: ['Cancelled'] } }).lean();

  let ok = 0; const fail = [], imbalance = [];
  for (const inv of invs) {
    const tv = normalizeToTallyVoucher(inv, {});
    let bad = false;
    // Per inventory line, check CGST+SGST (or IGST) == ROUND(base*fullRate)
    for (const ie of (tv.allInventoryEntries||[])) {
      const base = r2(+ie.amount||0);
      const rd = (ie.rateDetails||[]);
      const cg = rd.find(x=>x.gstRateDutyHead==='CGST')?.gstRate||0;
      const sg = rd.find(x=>x.gstRateDutyHead==='SGST/UTGST')?.gstRate||0;
      const ig = rd.find(x=>x.gstRateDutyHead==='IGST')?.gstRate||0;
      // Note: these are rates; actual sent amounts are at voucher level, so we
      // just confirm the rounding rule holds at the voucher total below.
    }
    // Voucher-level: compare sent totals to single-round expected per rate group.
    // Rebuild expected from inventory bases grouped by full rate.
    const groups = new Map(); // fullRate -> base sum
    (tv.allInventoryEntries||[]).forEach(ie => {
      const base = +ie.amount||0;
      const rd = ie.rateDetails||[];
      const cg = rd.find(x=>x.gstRateDutyHead==='CGST')?.gstRate||0;
      const sg = rd.find(x=>x.gstRateDutyHead==='SGST/UTGST')?.gstRate||0;
      const ig = rd.find(x=>x.gstRateDutyHead==='IGST')?.gstRate||0;
      const full = ig>0 ? ig : (cg+sg);
      if (full>0) groups.set(full, (groups.get(full)||0)+base);
    });
    let expectedTax = 0;
    for (const [full, base] of groups) expectedTax = r2(expectedTax + r2(base*full/100));
    const sentTax = r2((tv._totalCGST||0)+(tv._totalSGST||0)+(tv._totalIGST||0));
    if (Math.abs(expectedTax - sentTax) > 0.005) { bad = true; fail.push(`${inv.invoiceNo}: expected=${expectedTax} sent=${sentTax}`); }

    // Balance
    const invBase = (tv.allInventoryEntries||[]).reduce((s,ie)=>s+(+ie.amount||0),0);
    const party = Math.abs(+(tv.allLedgerEntries.find(e=>e.isDeemedPositive)?.amount||0));
    if (Math.abs(party - r2(invBase+sentTax)) > 0.01) imbalance.push(inv.invoiceNo);

    if (!bad) ok++;
  }

  console.log('═══ ALL invoices: sent tax == Tally Expected (single round) ═══');
  console.log(`  Total: ${invs.length}`);
  console.log(`  Tax matches Expected: ${ok}`);
  console.log(`  Tax MISMATCH: ${fail.length}`);
  console.log(`  Imbalanced: ${imbalance.length}`);
  if (fail.length) { console.log('\nMISMATCHES:'); fail.slice(0,30).forEach(f=>console.log('  • '+f)); }
  if (imbalance.length) console.log('\nIMBALANCED: ' + imbalance.join(', '));
  if (!fail.length && !imbalance.length) console.log('\n✓ Every invoice: Modified == Expected, voucher balanced. No 0.01/0.02 difference.');

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
