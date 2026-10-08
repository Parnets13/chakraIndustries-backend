// dump-xml.js — READ ONLY. Dumps the ACTUAL voucher XML the current code generates
// for a few specific invoices, so we can inspect every tax-related tag line by line.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from './services/tallyExportService.js';

const cfg = { companyName: 'SRI CHAKRA INDUSTRIES', state: 'Karnataka', gstin: '29ABWFS0002M1ZR' };
const TARGETS = (process.argv[2] || 'BIW2446').split(',');

async function main() {
  await connectDB();
  for (const no of TARGETS) {
    const inv = await Invoice.findOne({ invoiceNo: no.trim() }).lean();
    if (!inv) { console.log(`\n### ${no}: NOT FOUND`); continue; }
    const tv = normalizeToTallyVoucher(inv, {});
    const xml = serializeTallyVoucher(tv, cfg, 'Create', '');
    console.log(`\n═══════════ ${no} ═══════════`);
    // Print only the tax-relevant tags
    const keep = /<(LEDGERNAME|AMOUNT|VATEXPAMOUNT|RATEOFINVOICETAX|GSTRATEDUTYHEAD|GSTRATE|GSTLEDGERSOURCE|STOCKITEMNAME|RATE|ACTUALQTY)>/i;
    xml.split('\n').forEach(line => {
      const t = line.trim();
      if (keep.test(t) || /LEDGERENTRIES\.LIST|RATEDETAILS\.LIST|ALLINVENTORYENTRIES\.LIST/i.test(t)) {
        console.log('  ' + t);
      }
    });
  }
  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
