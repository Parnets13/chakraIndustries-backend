// check-will-pass.js — READ ONLY. Predicts which of the 99 invoices Tally will
// accept vs reject, based on the two real failure modes we observed:
//   (A) tax per line != ROUND(base * rate /100, 2)  → "amount does not match"
//   (B) ship-to state != bill-to state while tax is CGST/SGST (intrastate)
//        AND no IGST → Tally treats consignee as interstate → EXCEPTIONS
//   (C) missing tallySalesLedger on an item (GSTLEDGERSOURCE blank)
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

const r2 = n => +(+n).toFixed(2);
const GST_SLABS = [0, 2.5, 5, 6, 9, 12, 14, 18, 28];
const snap = r => r <= 0 ? 0 : GST_SLABS.reduce((b, s) => Math.abs(s - r) < Math.abs(b - r) ? s : b, 0);

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const invs = await Invoice.find({ status: { $nin: ['Cancelled'] } }).sort({ createdAt: -1 }).lean();

  let pass = 0;
  const taxFail = [], stateFail = [], ledgerFail = [];

  for (const inv of invs) {
    const billState = (inv.billToState || inv.partyState || '').trim().toLowerCase();
    const shipState = (inv.shipToState || '').trim().toLowerCase();
    const items = (inv.items || []).filter(i => (i.description || i.name || '').toString().trim());
    let hasTaxProblem = false, hasLedgerProblem = false;

    for (const it of items) {
      const base = r2(+(it.basic || it.amount || 0) || (+(it.qty||1) * +(it.rate||0)));
      const cg = +(it.cgst || 0), sg = +(it.sgst || 0), ig = +(it.igst || 0);
      if (base > 0) {
        if (ig > 0) {
          const rate = snap(+(ig / base * 100).toFixed(4));
          if (Math.abs(r2(base * rate / 100) - r2(ig)) > 0.00) hasTaxProblem = true;
        } else {
          const rate = snap(+(cg / base * 100).toFixed(4));
          if (Math.abs(r2(base * rate / 100) - r2(cg)) > 0.00) hasTaxProblem = true;
        }
      }
      if (!(it.tallySalesLedger || '').trim()) hasLedgerProblem = true;
    }

    // State mismatch: intrastate tax (no IGST) but ship state differs from bill state
    const anyIgst = items.some(it => +(it.igst || 0) > 0);
    const stateMismatch = !anyIgst && shipState && billState && shipState !== billState;

    if (hasTaxProblem) taxFail.push(inv.invoiceNo);
    else if (stateMismatch) stateFail.push(inv.invoiceNo);
    else if (hasLedgerProblem) ledgerFail.push(inv.invoiceNo);
    else pass++;
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total invoices checked: ${invs.length}`);
  console.log(`  WILL PASS:              ${pass}`);
  console.log(`  FAIL — tax mismatch:    ${taxFail.length}`);
  console.log(`  FAIL — ship state != bill state (intrastate): ${stateFail.length}`);
  console.log(`  FAIL — missing sales ledger: ${ledgerFail.length}`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (taxFail.length)   console.log('TAX MISMATCH:\n  ' + taxFail.join(', ') + '\n');
  if (stateFail.length) console.log('SHIP-STATE != BILL-STATE (Place of Supply issue):\n  ' + stateFail.join(', ') + '\n');
  if (ledgerFail.length)console.log('MISSING tallySalesLedger:\n  ' + ledgerFail.join(', ') + '\n');

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
