/**
 * mark-already-synced.js
 * ──────────────────────────────────────────────────────────────────────────────
 * Marks invoices as tallySync=true WITHOUT deleting anything.
 *
 * Use this when invoices already exist in Tally (from a previous export run)
 * but their tallySync flag in MongoDB was reset/cleared, causing EXCEPTIONS=1
 * on re-export (Tally rejects duplicate voucher numbers).
 *
 * This script:
 *   1. Fetches existing Sales voucher numbers from Tally via connector
 *   2. Finds matching ERP invoices that still have tallySync=false/null
 *   3. Marks them tallySync=true — no delete, no resend, nothing changes in Tally
 *
 * Run: node scripts/mark-already-synced.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import TallyConfig from '../models/TallyConfig.js';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGO_URI);
console.log('Connected to MongoDB\n');

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const co  = (cfg.companyName || '').trim().toUpperCase();
console.log(`Company: "${co}" | Connector: ${cfg.useConnector ? cfg.connectorId : 'DIRECT'}`);

const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';

// Step 1: Fetch all existing Sales voucher numbers from Tally
console.log('\nFetching Sales voucher numbers from Tally...');
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
const existingInTally = new Set();
for (const m of resp.matchAll(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/gi)) {
  const vno = (m[1] || '').trim().toUpperCase();
  if (vno) existingInTally.add(vno);
}
console.log(`Tally has ${existingInTally.size} existing Sales vouchers`);

// Step 2: Find ERP invoices that are already in Tally but still marked as unsynced
const unsynced = await Invoice.find({
  status:    { $nin: ['Cancelled'] },
  source:    { $nin: ['Tally', 'tally'] },
  tallySync: { $ne: true },
}).lean();

const alreadyInTally = unsynced.filter(inv =>
  existingInTally.has(String(inv.invoiceNo || '').trim().toUpperCase())
);
const genuinelyNew = unsynced.filter(inv =>
  !existingInTally.has(String(inv.invoiceNo || '').trim().toUpperCase())
);

console.log(`\nPending invoices in ERP : ${unsynced.length}`);
console.log(`Already in Tally        : ${alreadyInTally.length}  ← will be marked tallySync=true`);
console.log(`Genuinely new (to send) : ${genuinelyNew.length}  ← will be sent on next export`);

if (alreadyInTally.length === 0) {
  console.log('\nNothing to update — all pending invoices are genuinely new.');
  await mongoose.disconnect();
  process.exit(0);
}

console.log('\nInvoices being marked as synced (NO deletion, NO change in Tally):');
alreadyInTally.forEach(inv =>
  console.log(`  ✓ ${inv.invoiceNo} | ${inv.partyName} | ₹${inv.grandTotal}`)
);

// Step 3: Mark them — just set tallySync=true, nothing else
const ids = alreadyInTally.map(inv => inv._id);
const result = await Invoice.updateMany(
  { _id: { $in: ids } },
  { $set: { tallySync: true, tallySyncAt: new Date() } }
);

console.log(`\n✅ Done — marked ${result.modifiedCount} invoices as tallySync=true`);
if (genuinelyNew.length > 0) {
  console.log(`\n${genuinelyNew.length} invoice(s) are new and will export on next run:`);
  genuinelyNew.forEach(inv =>
    console.log(`  → ${inv.invoiceNo} | ${inv.partyName} | ₹${inv.grandTotal}`)
  );
}

await mongoose.disconnect();
