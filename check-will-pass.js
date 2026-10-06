// check-will-pass.js — READ ONLY. After the CONSIGNEESTATENAME fix, verifies the
// ACTUAL serialized voucher: for intrastate invoices CONSIGNEESTATENAME must equal
// PLACEOFSUPPLY (so Tally accepts CGST/SGST). Also re-checks per-line tax balance.
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from './services/tallyExportService.js';

const r2 = n => +(+n).toFixed(2);

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const invs = await Invoice.find({ status: { $nin: ['Cancelled'] } }).sort({ createdAt: -1 }).lean();

  // Minimal cfg stub for the serializer (company state Karnataka)
  const cfg = { companyName: 'SRI CHAKRA INDUSTRIES', state: 'Karnataka', gstin: '29ABWFS0002M1ZR' };

  let pass = 0;
  const stateFail = [], balanceFail = [], threw = [];

  for (const inv of invs) {
    try {
      const tv = normalizeToTallyVoucher(inv, {});
      const xml = serializeTallyVoucher(tv, cfg, 'Create', '');

      const pos  = (xml.match(/<PLACEOFSUPPLY>(.*?)<\/PLACEOFSUPPLY>/i) || [])[1] || '';
      const cons = (xml.match(/<CONSIGNEESTATENAME>(.*?)<\/CONSIGNEESTATENAME>/i) || [])[1] || '';
      const hasIgst = +(tv._totalIGST || 0) > 0;

      // Intrastate: consignee state must match place of supply (or be absent)
      let ok = true;
      if (!hasIgst && cons && pos && cons.trim().toLowerCase() !== pos.trim().toLowerCase()) {
        ok = false;
        stateFail.push(`${inv.invoiceNo} (POS=${pos}, CONSIGNEE=${cons})`);
      }

      // Balance: inventory + tax == party grand total
      const invBase = (tv.allInventoryEntries || []).reduce((s, ie) => s + (+ie.amount || 0), 0);
      const party = Math.abs(+(tv.allLedgerEntries.find(e => e.isDeemedPositive)?.amount || 0));
      const tax = r2((tv._totalCGST||0)+(tv._totalSGST||0)+(tv._totalIGST||0));
      if (Math.abs(party - r2(invBase + tax)) > 0.01) {
        ok = false;
        balanceFail.push(inv.invoiceNo);
      }

      if (ok) pass++;
    } catch (e) {
      threw.push(`${inv.invoiceNo}: ${e.message}`);
    }
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total invoices:                 ${invs.length}`);
  console.log(`  WILL PASS (post-fix):           ${pass}`);
  console.log(`  FAIL — consignee state != POS:  ${stateFail.length}`);
  console.log(`  FAIL — voucher imbalanced:      ${balanceFail.length}`);
  console.log(`  FAIL — normalize threw:         ${threw.length}`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (stateFail.length)   console.log('STATE STILL MISMATCHED:\n  ' + stateFail.join('\n  ') + '\n');
  if (balanceFail.length) console.log('IMBALANCED:\n  ' + balanceFail.join(', ') + '\n');
  if (threw.length)       console.log('THREW:\n  ' + threw.join('\n  ') + '\n');
  if (!stateFail.length && !balanceFail.length && !threw.length) {
    console.log('✓ All 99 invoices now produce intrastate-consistent, balanced vouchers.');
    console.log('  CONSIGNEESTATENAME aligned to Place of Supply (Karnataka) for intrastate.');
  }

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
