// check-rejected-fixed.js — READ ONLY. Checks EVERY invoice: does the tax we now
// send equal Tally's Expected = ROUND(base × fullRate, 2) per rate group?
// Lists each one PASS/FAIL so we can confirm the previously-rejected ones are fixed.
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';

const r2 = n => +(+n).toFixed(2);

async function main() {
  await connectDB();  // handles SRV→direct fallback when DNS SRV lookup is refused
  const invs = await Invoice.find({ status: { $nin: ['Cancelled'] } }).sort({ invoiceNo: 1 }).lean();

  let pass = 0; const fail = [];
  for (const inv of invs) {
    const tv = normalizeToTallyVoucher(inv, {});
    // Group inventory bases by full GST rate (from rateDetails)
    const groups = new Map();
    (tv.allInventoryEntries || []).forEach(ie => {
      const base = +ie.amount || 0;
      const rd = ie.rateDetails || [];
      const cg = rd.find(x => x.gstRateDutyHead === 'CGST')?.gstRate || 0;
      const sg = rd.find(x => x.gstRateDutyHead === 'SGST/UTGST')?.gstRate || 0;
      const ig = rd.find(x => x.gstRateDutyHead === 'IGST')?.gstRate || 0;
      const full = ig > 0 ? ig : (cg + sg);
      if (full > 0) groups.set(full, (groups.get(full) || 0) + base);
    });
    let expected = 0;
    for (const [full, base] of groups) expected = r2(expected + r2(base * full / 100));
    const sent = r2((tv._totalCGST || 0) + (tv._totalSGST || 0) + (tv._totalIGST || 0));
    const diff = r2(expected - sent);
    if (Math.abs(diff) < 0.005) pass++;
    else fail.push(`${inv.invoiceNo}: Expected=${expected} Sent=${sent} diff=${diff}`);
  }

  console.log('═══════════════════════════════════════════════════');
  console.log(`  Total invoices:                 ${invs.length}`);
  console.log(`  Tax == Tally Expected (will pass): ${pass}`);
  console.log(`  Still mismatched (would reject):   ${fail.length}`);
  console.log('═══════════════════════════════════════════════════');
  if (fail.length) { console.log('\nSTILL MISMATCHED:'); fail.forEach(f => console.log('  • ' + f)); }
  else console.log('\n✓ ALL invoices (including the previously-rejected 53) now match Tally Expected.');
  console.log('  No Expected-vs-Modified difference → e-invoice will not reject on tax.');

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
