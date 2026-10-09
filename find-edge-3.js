// find-edge-3.js — READ ONLY. Finds invoices where CGST=SGST (round base×9% each)
// gives an invoice total that differs from Tally's full-rate single round
// (ROUND(base×18%)) — i.e. the 1-paisa Tally-internal "Expected vs Modified" cases.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';

const r2 = n => +(+n).toFixed(2);

async function main() {
  await connectDB();
  const invs = await Invoice.find({ status: { $nin: ['Cancelled'] } }).sort({ invoiceNo: 1 }).lean();

  const edge = [];
  for (const inv of invs) {
    const tv = normalizeToTallyVoucher(inv, {});
    for (const ie of (tv.allInventoryEntries || [])) {
      const base = r2(+ie.amount || 0);
      const rd = ie.rateDetails || [];
      const cg = rd.find(x => x.gstRateDutyHead === 'CGST')?.gstRate || 0;
      const sg = rd.find(x => x.gstRateDutyHead === 'SGST/UTGST')?.gstRate || 0;
      if (!cg) continue;
      const half = r2(base * cg / 100);            // each CGST/SGST
      const equalSum = r2(half * 2);               // what we send (CGST+SGST)
      const fullRound = r2(base * (cg + sg) / 100);// Tally full-rate expected
      if (Math.abs(equalSum - fullRound) > 0.005) {
        edge.push(`${inv.invoiceNo}: base=${base} half=${half} CGST+SGST=${equalSum} vs TallyFullRound=${fullRound} diff=${r2(equalSum - fullRound)}`);
      }
    }
  }

  console.log('═══ Invoices where equal-halves total != Tally full-rate round (1-paisa Tally-internal cases) ═══');
  console.log(`  Count: ${edge.length}\n`);
  edge.forEach(e => console.log('  • ' + e));
  if (!edge.length) console.log('  (none — equal halves always equal the full-rate round for these invoices)');

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
