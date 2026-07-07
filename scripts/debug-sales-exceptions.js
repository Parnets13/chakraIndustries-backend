/**
 * debug-sales-exceptions.js
 * ──────────────────────────────────────────────────────────────────────────────
 * Diagnoses EXCEPTIONS=1 on sales invoice export by:
 *   1. Listing all pending invoices with their amounts and GST breakdown
 *   2. Fetching actual Duties & Taxes ledger names from Tally
 *   3. Testing ONE minimal sales voucher for each unique GST ledger name variant
 *   4. Checking if any invoice number already exists in Tally (duplicate guard)
 *
 * Run: node --experimental-vm-modules scripts/debug-sales-exceptions.js
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
console.log(`Company: "${co}"`);
console.log(`Connector: ${cfg.useConnector ? cfg.connectorId : 'DIRECT'}\n`);

const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';
const sv    = `<STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>`;

// ── 1. Fetch actual GST ledger names from Tally ───────────────────────────────
console.log('=== STEP 1: Fetching Duties & Taxes ledger names from Tally ===');
// Using <SYSTEM:FORMULA> with $Parent filter crashes Tally Prime EDU.
// Fetch all ledgers and filter client-side — works across all Tally editions.
const dutiesXml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE><ID>AllLedgers</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="AllLedgers">
      <TYPE>Ledger</TYPE>
      <FETCH>Name, Parent, TaxType</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

const dutiesResp = await postXmlWithRetry(cfg, dutiesXml, 60000, 1);
const cgstLedgers = [], sgstLedgers = [], igstLedgers = [], otherLedgers = [];
for (const m of dutiesResp.matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
  const block   = m[1];
  const name    = (block.match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '').trim();
  const parent  = (block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1] || '').trim().toLowerCase();
  const taxType = (block.match(/<TAXTYPE>(.*?)<\/TAXTYPE>/i)?.[1] || '').trim().toLowerCase();
  if (!name) continue;
  const nl = name.toLowerCase();
  // Include if: parent is Duties & Taxes, OR TaxType is set, OR name contains gst keyword.
  // Resilient to Tally not returning Parent tag in all collection responses.
  const isDutiesParent = parent.includes('duties') || parent.includes('tax');
  const hasTaxType     = !!taxType;
  const hasGstName     = nl.includes('cgst') || nl.includes('sgst') || nl.includes('igst');
  if (!isDutiesParent && !hasTaxType && !hasGstName) continue;
  if (taxType === 'central tax'    || nl.includes('cgst')) { cgstLedgers.push(name); continue; }
  if (taxType === 'state tax'      || nl.includes('sgst')) { sgstLedgers.push(name); continue; }
  if (taxType === 'integrated tax' || nl.includes('igst')) { igstLedgers.push(name); continue; }
  otherLedgers.push(name);
}
console.log(`CGST ledgers in Tally : [${cgstLedgers.join(', ')}]`);
console.log(`SGST ledgers in Tally : [${sgstLedgers.join(', ')}]`);
console.log(`IGST ledgers in Tally : [${igstLedgers.join(', ')}]`);
console.log(`Other duty ledgers    : [${otherLedgers.join(', ')}]\n`);

// ── 2. Fetch pending invoices and show GST breakdown ─────────────────────────
console.log('=== STEP 2: Pending invoices summary ===');
const invoices = await Invoice.find({
  status:    { $nin: ['Cancelled'] },
  source:    { $nin: ['Tally', 'tally'] },
  tallySync: { $ne: true },
}).lean();
console.log(`Total pending: ${invoices.length}`);

const gstRateCounts = {};
for (const inv of invoices) {
  const gt = +(inv.grandTotal || inv.totalAmount || 0);
  const cgst = +(inv.cgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.cgst||0),0));
  const sgst = +(inv.sgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.sgst||0),0));
  const igst = +(inv.igstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.igst||0),0));
  const base = +(gt - cgst - sgst - igst);
  const rate = base > 0 && cgst > 0 ? +((cgst / base) * 100).toFixed(1) : (base > 0 && igst > 0 ? +((igst / base) * 100).toFixed(1) : 0);
  const key = `CGST=${cgst.toFixed(2)}/SGST=${sgst.toFixed(2)}/IGST=${igst.toFixed(2)} rate≈${rate}% gt=${gt.toFixed(2)}`;
  gstRateCounts[key] = (gstRateCounts[key] || 0) + 1;
}
for (const [k, n] of Object.entries(gstRateCounts)) console.log(`  ${n}x  ${k}`);

// ── 3. Check for duplicate invoice numbers in Tally ──────────────────────────
console.log('\n=== STEP 3: Checking for duplicate voucher numbers in Tally ===');
const dedupeXml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE><ID>ERPSalesVoucherNumbers</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="ERPSalesVoucherNumbers">
      <TYPE>Voucher</TYPE>
      <FETCH>VoucherNumber, VoucherTypeName</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
const dedupeResp = await postXmlWithRetry(cfg, dedupeXml, 60000, 1);
const existingNos = new Set();
for (const m of dedupeResp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)) {
  const blk   = m[1];
  const vtype = (blk.match(/<VOUCHERTYPENAME>(.*?)<\/VOUCHERTYPENAME>/i)?.[1] || '').trim().toLowerCase();
  if (vtype !== 'sales') continue;
  const vno = (blk.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1] || '').trim().toUpperCase();
  if (vno) existingNos.add(vno);
}
console.log(`Existing Sales voucher numbers in Tally: ${existingNos.size}`);
const dupes = invoices.filter(inv => existingNos.has(String(inv.invoiceNo||'').trim().toUpperCase()));
if (dupes.length > 0) {
  console.log(`⚠️  DUPLICATES FOUND (${dupes.length}) — these will always get EXCEPTIONS=1:`);
  dupes.forEach(inv => console.log(`   - ${inv.invoiceNo} | ${inv.partyName} | ₹${inv.grandTotal}`));
} else {
  console.log('✅ No duplicate voucher numbers found');
}

// ── 4. Test one invoice with actual GST ledger names ─────────────────────────
console.log('\n=== STEP 4: Test send of first pending invoice ===');
const testInv = invoices.find(inv => !existingNos.has(String(inv.invoiceNo||'').trim().toUpperCase()));
if (!testInv) {
  console.log('No non-duplicate invoices to test — all are duplicates!');
} else {
  const gt   = +(testInv.grandTotal || testInv.totalAmount || 0);
  const cgst = +(testInv.cgstTotal ?? (testInv.items||[]).reduce((s,i)=>s+(i.cgst||0),0));
  const sgst = +(testInv.sgstTotal ?? (testInv.items||[]).reduce((s,i)=>s+(i.sgst||0),0));
  const igst = +(testInv.igstTotal ?? (testInv.items||[]).reduce((s,i)=>s+(i.igst||0),0));
  const base = +(gt - cgst - sgst - igst);
  const now  = new Date();
  const today = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;

  // Pick actual ledger names (first match from Tally)
  const cgstLed = cgstLedgers[0] || 'CGST';
  const sgstLed = sgstLedgers[0] || 'SGST';
  const igstLed = igstLedgers[0] || 'IGST';

  console.log(`Invoice: ${testInv.invoiceNo} | Party: ${testInv.partyName} | gt=${gt} cgst=${cgst}(${cgstLed}) sgst=${sgst}(${sgstLed}) igst=${igst}(${igstLed})`);
  console.log(`Balance check: debit=${gt.toFixed(2)} credits=${(cgst+sgst+igst+base).toFixed(2)}`);

  // Minimal balanced voucher using actual Tally ledger names
  const testXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv}</REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${today}</DATE><EFFECTIVEDATE>${today}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>DEBUG-${testInv.invoiceNo}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${testInv.partyName}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <NARRATION>DEBUG TEST — ${testInv.invoiceNo}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${testInv.partyName}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>-${gt.toFixed(2)}</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>DEBUG-${testInv.invoiceNo}</NAME><BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-${gt.toFixed(2)}</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  ${cgst > 0 ? `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${cgstLed}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>${cgst.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>` : ''}
  ${sgst > 0 ? `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${sgstLed}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>${sgst.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>` : ''}
  ${igst > 0 ? `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${igstLed}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>${igst.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>` : ''}
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>${base.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>
  </TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

  console.log('\nSending test voucher...');
  const testResp = await postXmlWithRetry(cfg, testXml, 60000, 1);
  const created  = parseInt(testResp.match(/<CREATED>(\d+)/i)?.[1] || '0');
  const excCount = parseInt(testResp.match(/<EXCEPTIONS>(\d+)/i)?.[1] || '0');
  const lineErrs = [...testResp.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m => m[1].trim());

  if (excCount === 0 && created > 0) {
    console.log(`✅ SUCCESS! Voucher created with ledger names: cgst="${cgstLed}" sgst="${sgstLed}"`);
    console.log('   → The issue is that the main export is using WRONG ledger names.');
    console.log('   → The fix (already applied) will use these actual Tally ledger names.\n');
    // Delete the test voucher we just created
    const delXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv}</REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Delete">
  <DATE>${today}</DATE><EFFECTIVEDATE>${today}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>DEBUG-${testInv.invoiceNo}</VOUCHERNUMBER>
</VOUCHER>
  </TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;
    try {
      await postXmlWithRetry(cfg, delXml, 30000, 1);
      console.log('   (Test voucher deleted from Tally)');
    } catch (_) {}
  } else {
    console.log(`❌ STILL FAILING! exceptions=${excCount} created=${created}`);
    if (lineErrs.length) console.log(`   LINEERROR: ${lineErrs.join(' | ')}`);
    else console.log('   No LINEERROR (Tally silent rejection)');
    console.log('\nRaw response (first 1000 chars):', testResp.slice(0, 1000));
    console.log('\n--- POSSIBLE CAUSES IF STILL FAILING WITH ACTUAL LEDGER NAMES ---');
    console.log('1. Party ledger does NOT exist in Tally: check if "' + testInv.partyName + '" is in Sundry Debtors');
    console.log('2. "Sales Accounts" ledger does not exist in Tally');
    console.log('3. Voucher type "Sales" is set to "Accounts Only" in Tally but BILLALLOCATIONS is wrong');
    console.log('4. Tally company period is closed (ENDINGAT before today)');
  }
}

await mongoose.disconnect();
process.exit(0);
