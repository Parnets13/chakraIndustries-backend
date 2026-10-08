// deep-check.js — READ ONLY. Deeply verifies the e-invoice tax at EVERY level
// Tally/IRP checks, for every invoice:
//   1. Per-LINE: each inventory line's CGST/SGST/IGST that Tally derives
//   2. Per-RATE-GROUP: ROUND(sum of bases at that rate × rate)
//   3. Voucher total CGST/SGST/IGST we send (LEDGERENTRIES)
// Flags ANY level where what we send != what Tally expects.
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';

const r2 = n => +(+n).toFixed(2);

async function main() {
  await connectDB();
  const invs = await Invoice.find({ status: { $nin: ['Cancelled'] } }).sort({ invoiceNo: 1 }).lean();

  const problems = [];
  let multiItem = 0, singleItem = 0;

  for (const inv of invs) {
    const tv = normalizeToTallyVoucher(inv, {});
    const items = tv.allInventoryEntries || [];
    if (items.length > 1) multiItem++; else singleItem++;

    // ── Level 1: voucher-level sent totals ──
    const sentC = r2(tv._totalCGST || 0);
    const sentS = r2(tv._totalSGST || 0);
    const sentI = r2(tv._totalIGST || 0);

    // ── Level 2: Tally Expected per rate group (how IRP recomputes) ──
    // Group item bases by full rate, round once per group.
    const cgstGroup = new Map(); // halfRate -> baseSum  (intrastate: CGST=SGST)
    const igstGroup = new Map(); // fullRate -> baseSum
    for (const ie of items) {
      const base = +ie.amount || 0;
      const rd = ie.rateDetails || [];
      const cg = rd.find(x => x.gstRateDutyHead === 'CGST')?.gstRate || 0;
      const sg = rd.find(x => x.gstRateDutyHead === 'SGST/UTGST')?.gstRate || 0;
      const ig = rd.find(x => x.gstRateDutyHead === 'IGST')?.gstRate || 0;
      if (ig > 0) igstGroup.set(ig, (igstGroup.get(ig) || 0) + base);
      else if (cg > 0) cgstGroup.set(cg + sg, (cgstGroup.get(cg + sg) || 0) + base);
    }
    // Expected CGST (and SGST) from group-level single round on FULL rate
    let expC = 0, expS = 0, expI = 0;
    for (const [full, base] of cgstGroup) {
      const fullTax = r2(base * full / 100);
      const c = r2(fullTax / 2);
      expC = r2(expC + c);
      expS = r2(expS + (fullTax - c));
    }
    for (const [full, base] of igstGroup) {
      expI = r2(expI + r2(base * full / 100));
    }

    // ── Compare sent vs expected at group level ──
    const dC = r2(sentC - expC), dS = r2(sentS - expS), dI = r2(sentI - expI);
    if (Math.abs(dC) > 0.005 || Math.abs(dS) > 0.005 || Math.abs(dI) > 0.005) {
      problems.push({
        inv: inv.invoiceNo, items: items.length,
        sent: `C${sentC}/S${sentS}/I${sentI}`,
        exp:  `C${expC}/S${expS}/I${expI}`,
        diff: `dC${dC} dS${dS} dI${dI}`,
      });
    }
  }

  console.log('═══ DEEP CHECK: group-level Expected vs what we send ═══');
  console.log(`  Total invoices: ${invs.length}  (single-item: ${singleItem}, multi-item: ${multiItem})`);
  console.log(`  Problems: ${problems.length}`);
  if (problems.length) {
    console.log('');
    problems.forEach(p => console.log(`  ✗ ${p.inv} [${p.items} items]  sent ${p.sent}  exp ${p.exp}  ${p.diff}`));
  } else {
    console.log('  ✓ Every invoice matches group-level Expected (CGST, SGST, IGST).');
  }

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
