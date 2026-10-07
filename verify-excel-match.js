// verify-excel-match.js — READ ONLY. Confirms the normalized voucher now sends
// the EXACT Excel CGST/SGST/IGST amounts (Sept-3 working behaviour), not recomputed.
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';

const r2 = n => +(+n).toFixed(2);

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const invs = await Invoice.find({ status: { $nin: ['Cancelled'] } }).lean();

  let match = 0, mismatch = [];
  for (const inv of invs) {
    // Sum Excel amounts across items
    const items = (inv.items || []).filter(i => (i.description || i.name || '').toString().trim());
    const exCGST = r2(items.reduce((s, i) => s + (+i.cgst || 0), 0));
    const exSGST = r2(items.reduce((s, i) => s + (+i.sgst || 0), 0));
    const exIGST = r2(items.reduce((s, i) => s + (+i.igst || 0), 0));

    const tv = normalizeToTallyVoucher(inv, {});
    const vCGST = r2(tv._totalCGST || 0);
    const vSGST = r2(tv._totalSGST || 0);
    const vIGST = r2(tv._totalIGST || 0);

    const ok = Math.abs(vCGST - exCGST) < 0.005
            && Math.abs(vSGST - exSGST) < 0.005
            && Math.abs(vIGST - exIGST) < 0.005;
    if (ok) match++;
    else mismatch.push(`${inv.invoiceNo}: voucher(c=${vCGST},s=${vSGST},i=${vIGST}) vs excel(c=${exCGST},s=${exSGST},i=${exIGST})`);
  }

  console.log('═══ Voucher tax == Excel tax? ═══');
  console.log(`  Total: ${invs.length}`);
  console.log(`  Match Excel exactly: ${match}`);
  console.log(`  Differ: ${mismatch.length}`);
  if (mismatch.length) { console.log('\nDIFFERENCES:'); mismatch.slice(0, 30).forEach(m => console.log('  • ' + m)); }
  else console.log('\n✓ Every invoice now sends the EXACT Excel CGST/SGST/IGST (Sept-3 behaviour restored).');

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
