/**
 * test-single-invoice-gst.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Step 4 test script: exports ONE invoice to Tally and lets you verify:
 *   ✅ Item name displays correctly
 *   ✅ Item GST rate displays correctly
 *   ✅ E-invoice generates without "Tax amount does not match" warning
 *
 * HOW TO USE:
 *   1. Set TEST_INVOICE_NO below to the invoice number you want to test.
 *   2. Run: node --experimental-vm-modules scripts/test-single-invoice-gst.js
 *   3. Check the Tally voucher manually for item name, GST rate, and e-invoice.
 *   4. Delete the test voucher from Tally if needed (it will be created as a real voucher).
 *
 * This script DOES NOT touch tallySync or retryCount — the invoice remains
 * un-synced in the DB after the test, so regular bulk export still picks it up.
 *
 * SAFE: read-only DB access except for one Tally POST. No invoice fields are
 * written back to MongoDB by this script.
 */

import connectDB              from '../config/database.js';
import TallyConfig            from '../models/TallyConfig.js';
import Invoice                from '../models/Invoice.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher }   from '../services/tallyExportService.js';
import { postXmlWithRetry }        from '../services/tallyFetchEngine.js';
import mongoose from 'mongoose';

// ─── ▶ SET THIS TO THE INVOICE NUMBER YOU WANT TO TEST ───────────────────────
const TEST_INVOICE_NO = 'INV-XXXX';   // ← replace with your actual invoice number
// ─────────────────────────────────────────────────────────────────────────────

await connectDB();

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
if (!cfg) {
  console.error('❌ No TallyConfig found. Run "Test Connection" in Tally Settings first.');
  await mongoose.disconnect();
  process.exit(1);
}

const co    = (cfg.companyName || '').trim().toUpperCase();
const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';
console.log(`\nTally company: "${co || '(not set)'}"`);

// ── Fetch the invoice ─────────────────────────────────────────────────────────
const inv = await Invoice.findOne({ invoiceNo: TEST_INVOICE_NO }).lean();
if (!inv) {
  console.error(`❌ Invoice "${TEST_INVOICE_NO}" not found in MongoDB.`);
  await mongoose.disconnect();
  process.exit(1);
}

console.log(`\nInvoice found: ${inv.invoiceNo}`);
console.log(`  Party      : ${inv.partyName}`);
console.log(`  Grand Total: ${inv.grandTotal}`);
console.log(`  CGST Total : ${inv.cgstTotal ?? '(not set — will use item-level)'}`);
console.log(`  SGST Total : ${inv.sgstTotal ?? '(not set — will use item-level)'}`);
console.log(`  Items      : ${(inv.items || []).length}`);
(inv.items || []).forEach((it, i) => {
  console.log(`    [${i+1}] ${it.description || it.name} | qty=${it.qty} rate=${it.rate} cgst=${it.cgst ?? 0} sgst=${it.sgst ?? 0} gst=${it.gst ?? 0}`);
});

// ── Detect sales voucher type name ────────────────────────────────────────────
let salesVoucherTypeName = 'Sales';
try {
  const vtXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>VTProbe</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="VTProbe"><TYPE>VoucherType</TYPE><FETCH>Name</FETCH></COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
  const vtResp = await postXmlWithRetry(cfg, vtXml, 20000, 1);
  const allVTypes = [...(vtResp || '').matchAll(/<NAME>(.*?)<\/NAME>/gi)]
    .map(m => m[1].trim()).filter(Boolean);
  const salesType = allVTypes.find(n => n.toLowerCase().startsWith('sale'));
  if (salesType) {
    salesVoucherTypeName = salesType;
    console.log(`\nDetected sales voucher type: "${salesVoucherTypeName}"`);
  }
} catch (e) {
  console.log(`\n⚠ Could not detect voucher type (using "${salesVoucherTypeName}"): ${e.message}`);
}

// ── Fetch period end to cap date ──────────────────────────────────────────────
let periodEnd = cfg.tallyPeriodEnd || null;
try {
  const peXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CompanyPeriod</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="CompanyPeriod"><TYPE>Company</TYPE><FETCH>Name, StartingFrom, EndingAt</FETCH></COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
  const peResp = await postXmlWithRetry(cfg, peXml, 20000, 1);
  const pm = peResp.match(/<ENDINGAT[^>]*>(\d{8})<\/ENDINGAT>/i)
          || peResp.match(/<SVTODATE[^>]*>(\d{8})<\/SVTODATE>/i);
  if (pm) periodEnd = pm[1];
} catch (e) {
  console.log(`⚠ Could not fetch period end: ${e.message}`);
}
console.log(`Period end: ${periodEnd || '(unknown — actual invoice date will be used)'}`);

// ── Normalize the invoice → TallyVoucher ─────────────────────────────────────
let tv;
try {
  tv = normalizeToTallyVoucher(inv, {
    tallyGstLedgers:      null,         // let it use fallback names
    periodEnd:            periodEnd,
    companyName:          co,
    salesVoucherTypeName: salesVoucherTypeName,
  });
} catch (e) {
  console.error(`\n❌ normalizeToTallyVoucher failed: ${e.message}`);
  await mongoose.disconnect();
  process.exit(1);
}

console.log(`\n── Normalized voucher summary ──`);
console.log(`  Date        : ${tv.date}`);
console.log(`  Grand Total : ${tv._grandTotal}`);
console.log(`  CGST        : ${tv._totalCGST}`);
console.log(`  SGST        : ${tv._totalSGST}`);
console.log(`  Sales Base  : ${tv._salesBase}`);
console.log(`  Inventory entries: ${tv.allInventoryEntries.length}`);
tv.allInventoryEntries.forEach((ie, i) => {
  const rates = (ie.rateDetails || []).map(r => `${r.gstRateDutyHead}=${r.gstRate}%`).join(', ');
  console.log(`    [${i+1}] ${ie.stockItemName} | amount=${ie.amount} | rates: ${rates || '(none)'}`);
});
console.log(`  Ledger entries:`);
tv.allLedgerEntries.forEach(le => {
  console.log(`    ${le.ledgerName}: ${le.amount}`);
});

// ── Serialize to XML ──────────────────────────────────────────────────────────
// Use a modified invoice number so it doesn't collide with the real invoice in Tally
const testVoucherNo = `TEST-GST-${inv.invoiceNo}`;
const tvForTest = { ...tv, voucherNumber: testVoucherNo };

// Inject the resolved godown — use the same logic as exportSalesInvoices
tvForTest._godownName = 'Main Location';

const voucherXml = serializeTallyVoucher(tvForTest, cfg, 'Create', '');

// Override the voucher number in the serialized XML to the test number
// (serializeTallyVoucher uses tv.voucherNumber which we already set above)
const envelope = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
${voucherXml}
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

console.log(`\n── Sending test voucher to Tally ──`);
console.log(`  Voucher number: ${testVoucherNo} (prefixed TEST-GST- to avoid collision)`);
console.log(`  Voucher type  : ${salesVoucherTypeName}`);

let resp;
try {
  resp = await postXmlWithRetry(cfg, envelope, 40000, 1);
} catch (e) {
  console.error(`\n❌ Transport error: ${e.message}`);
  await mongoose.disconnect();
  process.exit(1);
}

// ── Parse response ────────────────────────────────────────────────────────────
const s = String(resp || '');
const created    = parseInt(s.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1]   || '0');
const altered    = parseInt(s.match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1]   || '0');
const exceptions = parseInt(s.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1] || '0');
const lineErrors = [...s.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m => m[1].trim());
const lastErrors = [...s.matchAll(/<LASTERROR>([\s\S]*?)<\/LASTERROR>/gi)].map(m => m[1].trim());
const allDiag    = [...lineErrors, ...lastErrors].filter(Boolean);

console.log(`\n── Tally response ──`);
if (created > 0) {
  console.log(`✅ CREATED — voucher accepted by Tally`);
  console.log(`\nNow verify in Tally:`);
  console.log(`  1. Open the voucher "${testVoucherNo}" in Day Book`);
  console.log(`  2. Check item names match the ERP invoice`);
  console.log(`  3. Check GST rate shown in Tax Analysis report`);
  console.log(`  4. Try printing e-invoice — confirm NO "Tax amount does not match" warning`);
  console.log(`  5. When done testing, DELETE this voucher from Tally (it has TEST-GST- prefix)`);
} else if (altered > 0) {
  console.log(`✅ ALTERED — voucher updated in Tally`);
} else if (exceptions > 0) {
  console.log(`❌ EXCEPTIONS=${exceptions}`);
  if (allDiag.length) {
    allDiag.forEach(d => console.log(`  → ${d}`));
  } else {
    console.log(`  (no LINEERROR/LASTERROR — check full XML in logs/tally-xml-responses/)`);
  }
} else {
  console.log(`⚠ SKIPPED — voucher number may already exist in Tally`);
  console.log(`  Try deleting "${testVoucherNo}" from Tally and re-running`);
}

if (allDiag.length && created > 0) {
  console.log(`\n⚠ Warnings from Tally (voucher was created but review these):`);
  allDiag.forEach(d => console.log(`  → ${d}`));
}

await mongoose.disconnect();
