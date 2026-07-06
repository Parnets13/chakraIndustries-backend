/**
 * check-tally-dupes.js
 * Fetches existing Sales voucher numbers from Tally via connector
 * and cross-checks with pending ERP invoices.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import TallyConfig from '../models/TallyConfig.js';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGO_URI);

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const co  = (cfg.companyName || '').trim().toUpperCase();
console.log(`Company: "${co}" | Connector: ${cfg.useConnector ? cfg.connectorId : 'DIRECT'}\n`);

const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';

// Fetch existing Sales voucher numbers
console.log('Fetching Sales voucher numbers from Tally...');
const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE><ID>ERPSalesVoucherNumbers</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="ERPSalesVoucherNumbers">
      <TYPE>Voucher</TYPE>
      <FILTERS>IsSales</FILTERS>
      <FETCH>VoucherNumber</FETCH>
    </COLLECTION>
    <SYSTEM:FORMULA NAME="IsSales">$VoucherTypeName = "Sales"</SYSTEM:FORMULA>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

const resp = await postXmlWithRetry(cfg, xml, (cfg.useConnector && cfg.connectorId) ? 180000 : 30000);
const existingNos = new Set();
for (const m of resp.matchAll(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/gi)) {
  existingNos.add((m[1] || '').trim().toUpperCase());
}
console.log(`Tally has ${existingNos.size} existing Sales vouchers\n`);

// Cross-check with pending invoices
const pending = await Invoice.find({
  status:    { $nin: ['Cancelled'] },
  source:    { $nin: ['Tally', 'tally'] },
  tallySync: { $ne: true },
}).lean();

const dupes   = pending.filter(inv => existingNos.has(String(inv.invoiceNo||'').trim().toUpperCase()));
const fresh   = pending.filter(inv => !existingNos.has(String(inv.invoiceNo||'').trim().toUpperCase()));

console.log(`Total pending : ${pending.length}`);
console.log(`Already in Tally (DUPLICATES) : ${dupes.length}`);
console.log(`Genuinely new (safe to send)  : ${fresh.length}`);

if (dupes.length > 0) {
  console.log('\n⚠️  DUPLICATE invoice numbers (already in Tally, will get EXCEPTIONS=1 if sent):');
  dupes.forEach(inv => console.log(`   ${inv.invoiceNo} | ${inv.partyName} | ₹${inv.grandTotal}`));
  console.log('\nFIX: Mark these as tallySync=true in MongoDB so they are skipped on next export.');
  console.log('     Run: node scripts/mark-synced-dupes.js');
}

if (fresh.length > 0 && fresh.length < 10) {
  console.log('\nFresh invoices (not yet in Tally):');
  fresh.forEach(inv => console.log(`   ${inv.invoiceNo} | ${inv.partyName} | ₹${inv.grandTotal}`));
}

await mongoose.disconnect();
