// check-rate-vs-master.js — READ ONLY. For each invoice item, compares:
//   (A) the GST rate the voucher sends in RATEDETAILS (derived from Excel cgst/sgst/igst)
//   (B) the GST rate stored on the ItemMaster (what Tally's stock master will have)
// A mismatch here = Tally's "Mismatch in Tax Rate between master and transaction".
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import ItemMaster from './models/ItemMaster.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

  const invs = await Invoice.find({ status: { $nin: ['Cancelled'] } }).sort({ createdAt: 1 }).lean();

  // Build item -> master GST rate map
  const names = [...new Set(invs.flatMap(i => (i.items||[]).map(it => (it.description||it.name||'').trim())).filter(Boolean))];
  const masters = await ItemMaster.find({ name: { $in: names } }, 'name gst hsn').lean();
  const masterGst = new Map(masters.map(m => [m.name, m.gst]));

  const mismatches = [];
  const seen = new Set();

  for (const inv of invs) {
    const tv = normalizeToTallyVoucher(inv, {});
    (tv.allInventoryEntries || []).forEach((ie, idx) => {
      const name = ie.stockItemName;
      // Rate the voucher asserts = sum of rateDetails CGST+SGST+IGST
      const txRate = (ie.rateDetails||[])
        .filter(r => ['CGST','SGST/UTGST','IGST'].includes(r.gstRateDutyHead))
        .reduce((s, r) => s + (+r.gstRate || 0), 0);
      const mRate = masterGst.has(name) ? +masterGst.get(name) : null;
      const key = `${name}|${txRate}|${mRate}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (mRate === null) {
        mismatches.push(`${name}: transaction=${txRate}%  MASTER=NOT IN ItemMaster (Tally master may be 0%)  [${inv.invoiceNo}]`);
      } else if (Math.abs(mRate - txRate) > 0.01) {
        mismatches.push(`${name}: transaction=${txRate}%  master(ItemMaster.gst)=${mRate}%  ← MISMATCH  [${inv.invoiceNo}]`);
      }
    });
  }

  console.log('═══ Tax RATE: transaction (voucher) vs ItemMaster.gst ═══\n');
  if (mismatches.length === 0) {
    console.log('✓ No rate mismatches between voucher and ItemMaster.gst.');
    console.log('  (If Tally still complains, the mismatch is between the voucher and the');
    console.log('   STOCK ITEM master actually in Tally — check GST rate on the item in Tally.)');
  } else {
    mismatches.forEach(m => console.log('  • ' + m));
    console.log(`\n  Total distinct mismatches: ${mismatches.length}`);
  }

  // Also show ItemMaster.gst distribution
  console.log('\n═══ ItemMaster.gst values present ═══');
  const dist = new Map();
  masters.forEach(m => { const k = String(m.gst); dist.set(k, (dist.get(k)||0)+1); });
  [...dist.entries()].forEach(([g,c]) => console.log(`  gst=${g}% : ${c} items`));

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
