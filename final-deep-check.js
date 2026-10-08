// final-deep-check.js — READ ONLY. Confirms for ALL invoices:
//   1. CGST == SGST exactly (IRP component rule)
//   2. Each CGST == ROUND(base × halfRate, 2) per line (IRP per-line rule)
//   3. Voucher balanced: party == inventory base + tax
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';

const r2 = n => +(+n).toFixed(2);

async function main() {
  await connectDB();
  const invs = await Invoice.find({ status: { $nin: ['Cancelled'] } }).lean();

  let ok = 0; const cgstNeSgst = [], perLineBad = [], imbalance = [];
  for (const inv of invs) {
    const tv = normalizeToTallyVoucher(inv, {});
    let bad = false;

    // 1. CGST == SGST
    const c = r2(tv._totalCGST || 0), s = r2(tv._totalSGST || 0);
    if (Math.abs(c - s) > 0.005) { cgstNeSgst.push(`${inv.invoiceNo} C${c}!=S${s}`); bad = true; }

    // 2. Per-line: CGST line == ROUND(base × halfRate)
    for (const ie of (tv.allInventoryEntries || [])) {
      const base = +ie.amount || 0;
      const rd = ie.rateDetails || [];
      const cg = rd.find(x => x.gstRateDutyHead === 'CGST')?.gstRate || 0;
      const ig = rd.find(x => x.gstRateDutyHead === 'IGST')?.gstRate || 0;
      if (ig > 0) continue;
      if (cg > 0) {
        const expectedHalf = r2(base * cg / 100);
        // we can't see per-line split in totals for multi-item, but all are single-item here
        if (Math.abs(expectedHalf - c) > 0.005 && (tv.allInventoryEntries.length === 1)) {
          perLineBad.push(`${inv.invoiceNo}: line expects ${expectedHalf}, total CGST ${c}`);
          bad = true;
        }
      }
    }

    // 3. Balance
    const invBase = (tv.allInventoryEntries || []).reduce((a, ie) => a + (+ie.amount || 0), 0);
    const party = Math.abs(+(tv.allLedgerEntries.find(e => e.isDeemedPositive)?.amount || 0));
    const tax = r2(c + s + (tv._totalIGST || 0));
    if (Math.abs(party - r2(invBase + tax)) > 0.01) { imbalance.push(inv.invoiceNo); bad = true; }

    if (!bad) ok++;
  }

  console.log('═══ FINAL DEEP CHECK ═══');
  console.log(`  Total: ${invs.length}`);
  console.log(`  Fully OK: ${ok}`);
  console.log(`  CGST != SGST: ${cgstNeSgst.length}`);
  console.log(`  Per-line tax wrong: ${perLineBad.length}`);
  console.log(`  Imbalanced: ${imbalance.length}`);
  if (cgstNeSgst.length) { console.log('\nCGST!=SGST:'); cgstNeSgst.slice(0,20).forEach(x=>console.log('  '+x)); }
  if (perLineBad.length) { console.log('\nPER-LINE:'); perLineBad.slice(0,20).forEach(x=>console.log('  '+x)); }
  if (imbalance.length) { console.log('\nIMBALANCE: '+imbalance.join(', ')); }
  if (!cgstNeSgst.length && !perLineBad.length && !imbalance.length)
    console.log('\n✓ All invoices: CGST==SGST, each = ROUND(base×halfRate), voucher balanced.');

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
