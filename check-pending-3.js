// check-pending-3.js — READ ONLY. Finds the still-pending invoices and dumps their
// full item/tax detail + generated XML tax tags, so we can see why these 3 differ.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from './services/tallyExportService.js';

const cfg = { companyName: 'SRI CHAKRA INDUSTRIES', state: 'Karnataka', gstin: '29ABWFS0002M1ZR' };
const r2 = n => +(+n).toFixed(2);

async function main() {
  await connectDB();

  const pending = await Invoice.find({ status: { $nin: ['Cancelled'] }, tallySync: { $ne: true } }).lean();
  console.log(`Pending (not synced): ${pending.length}`);
  console.log('  ' + pending.map(p => p.invoiceNo).join(', ') + '\n');

  for (const inv of pending) {
    console.log(`═══════════ ${inv.invoiceNo} ═══════════`);
    console.log(`  party=${inv.partyName}  grandTotal=${inv.grandTotal || inv.totalAmount}`);
    console.log(`  items: ${(inv.items||[]).length}`);
    (inv.items || []).forEach((it, i) => {
      const base = r2(+(it.basic||it.amount||0) || (+(it.qty||1)*+(it.rate||0)));
      console.log(`    [${i+1}] "${(it.description||it.name||'').slice(0,30)}" base=${base} qty=${it.qty} rate=${it.rate} cgst=${it.cgst} sgst=${it.sgst} igst=${it.igst} hsn=${it.hsn} ledger="${it.tallySalesLedger||''}"`);
    });
    try {
      const tv = normalizeToTallyVoucher(inv, {});
      console.log(`  → normalized: cgst=${tv._totalCGST} sgst=${tv._totalSGST} igst=${tv._totalIGST} grand=${tv._grandTotal}`);
      const xml = serializeTallyVoucher(tv, cfg, 'Create', '');
      // print tax tags
      xml.split('\n').forEach(l => {
        const t = l.trim();
        if (/<(LEDGERNAME|AMOUNT|VATEXPAMOUNT|GSTRATE|GSTRATEDUTYHEAD|CONSIGNEESTATENAME|PLACEOFSUPPLY|CONSIGNEEGSTIN)>/i.test(t))
          console.log('      ' + t);
      });
    } catch (e) {
      console.log(`  !! normalize threw: ${e.message}`);
    }
    console.log('');
  }

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
