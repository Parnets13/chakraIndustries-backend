/**
 * debug-tally-export.js
 * Run: node scripts/debug-tally-export.js
 *
 * Connects to MongoDB, fetches the first unsynced invoice,
 * builds the exact XML that exportSalesInvoices would send,
 * posts it to Tally at localhost:9000, and prints every detail.
 *
 * PURPOSE: Find exactly why Tally returns EXCEPTIONS=1 with no LINEERROR.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';

const MONGO_URI = process.env.MONGO_URI;
const TALLY_URL = process.env.TALLY_URL || 'http://localhost:9000';

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✓ Connected to MongoDB');

  const TallyConfig = (await import('../models/TallyConfig.js')).default;
  const Invoice     = (await import('../models/Invoice.js')).default;

  const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
  if (!cfg) { console.error('No TallyConfig found'); process.exit(1); }

  console.log('\n═══ TALLY CONFIG ═══');
  console.log('  companyName :', cfg.companyName);
  console.log('  useConnector:', cfg.useConnector);
  console.log('  connectorId :', cfg.connectorId);
  console.log('  tallyLocalUrl:', cfg.tallyLocalUrl);
  console.log('  port        :', cfg.port);

  // Step 1: Detect company name from Tally
  console.log('\n═══ STEP 1: DETECT TALLY COMPANY ═══');
  const pingXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>OpenCompanyList</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="OpenCompanyList" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name</FETCH></COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

  try {
    const pingResp = await axios.post(TALLY_URL, pingXml, {
      headers: { 'Content-Type': 'text/xml' }, timeout: 10000
    });
    const body = pingResp.data;
    console.log('  Tally response (first 500 chars):', String(body).slice(0, 500));
    const names = [...String(body).matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m => m[1].trim());
    console.log('  Open companies in Tally:', names);
    if (names[0]) {
      console.log(`\n  ✓ Using company: "${names[0]}"`);
      cfg.companyName = names[0]; // use actual detected name
    } else {
      console.log(`\n  ⚠ Could not detect company — using saved: "${cfg.companyName}"`);
    }
  } catch (e) {
    console.error('  ✗ Ping failed:', e.message);
  }

  const co = (cfg.companyName || '').trim().toUpperCase();
  const coTag = co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : '';

  // Step 2: Fetch ALL ledgers and show the ones relevant to GST + Sales
  console.log('\n═══ STEP 2: FETCH ALL TALLY LEDGER NAMES ═══');
  const allLedgersXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>AllLedgersForDebug</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="AllLedgersForDebug">
      <TYPE>Ledger</TYPE>
      <FETCH>Name, Parent</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

  try {
    const lr = await axios.post(TALLY_URL, allLedgersXml, {
      headers: { 'Content-Type': 'text/xml' }, timeout: 30000
    });
    const lbody = String(lr.data);
    // Extract Name+Parent pairs
    const ledgerMatches = [...lbody.matchAll(/<LEDGER[^>]*>\s*<NAME>(.*?)<\/NAME>\s*<PARENT>(.*?)<\/PARENT>/gi)];
    const allLedgers = ledgerMatches.map(m => ({ name: m[1].trim(), parent: m[2].trim() }));

    // If that format didn't work, just get all NAME tags
    const allNames = allLedgers.length
      ? allLedgers.map(l => `${l.name} (${l.parent})`)
      : [...lbody.matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m => m[1].trim());

    const gstLedgers = allNames.filter(n => /cgst|sgst|igst|gst|duties|tax/i.test(String(n)));
    const salesLedgers = allNames.filter(n => /sales/i.test(String(n)));

    console.log('  GST/Duties ledgers found:', gstLedgers.length ? gstLedgers : '(none found)');
    console.log('  Sales ledgers found:', salesLedgers.length ? salesLedgers : '(none found)');
    console.log('  Total ledgers in Tally:', allNames.length);
    if (!gstLedgers.length && !salesLedgers.length) {
      console.log('  First 30 ledger names:', allNames.slice(0, 30));
    }
  } catch (e) {
    console.error('  ✗ Ledger fetch failed:', e.message);
  }

  // Step 3: Check voucher types
  console.log('\n═══ STEP 3: CHECK VOUCHER TYPES IN TALLY ═══');
  const vTypeXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>VTypeDebug</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="VTypeDebug"><TYPE>VoucherType</TYPE><FETCH>Name</FETCH></COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

  try {
    const vtr = await axios.post(TALLY_URL, vTypeXml, {
      headers: { 'Content-Type': 'text/xml' }, timeout: 15000
    });
    const vtbody = String(vtr.data);
    const vtNames = [...vtbody.matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m => m[1].trim());
    console.log('  Voucher types in Tally:', vtNames);
    if (!vtNames.includes('Sales')) {
      console.log('  ⚠ "Sales" voucher type NOT found — this would cause EXCEPTIONS!');
    }
  } catch (e) {
    console.error('  ✗ Voucher type fetch failed:', e.message);
  }

  // Step 4: Fetch first unsynced invoice
  console.log('\n═══ STEP 4: FIRST UNSYNCED INVOICE ═══');
  const inv = await Invoice.findOne({
    status: { $nin: ['Cancelled'] },
    source: { $nin: ['Tally', 'tally'] },
    tallySync: { $ne: true }
  }).lean();

  if (!inv) {
    console.log('  No unsynced invoices found — all are tallySync=true or Cancelled');
    process.exit(0);
  }

  console.log('  invoiceNo   :', inv.invoiceNo);
  console.log('  partyName   :', inv.partyName);
  console.log('  grandTotal  :', inv.grandTotal);
  console.log('  cgstTotal   :', inv.cgstTotal);
  console.log('  sgstTotal   :', inv.sgstTotal);
  console.log('  igstTotal   :', inv.igstTotal);
  console.log('  items count :', (inv.items || []).length);
  console.log('  source      :', inv.source);
  console.log('  tallySync   :', inv.tallySync);

  // Step 5: Try to create the party ledger first
  console.log('\n═══ STEP 5: CREATE PARTY LEDGER ═══');
  const today = (() => {
    const n = new Date();
    return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;
  })();

  const staticVarsXml = `<STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>`;

  const masterXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${staticVarsXml}</REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
    <LEDGER NAME="Sales Accounts" ACTION="Create"><NAME>Sales Accounts</NAME><PARENT>Sales Accounts</PARENT></LEDGER>
    <LEDGER NAME="CGST" ACTION="Create"><NAME>CGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>
    <LEDGER NAME="SGST" ACTION="Create"><NAME>SGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>
    <LEDGER NAME="IGST" ACTION="Create"><NAME>IGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>
    <LEDGER NAME="${esc(inv.partyName)}" ACTION="Create"><NAME>${esc(inv.partyName)}</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>
  </TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

  console.log('\n  Master XML being sent:\n', masterXml);
  try {
    const mr = await axios.post(TALLY_URL, masterXml, {
      headers: { 'Content-Type': 'text/xml' }, timeout: 60000
    });
    console.log('\n  Master response:', String(mr.data));
  } catch (e) {
    console.error('  ✗ Master create failed:', e.message);
    console.log('  (continuing to voucher test anyway)');
  }

  // Step 6: Send a minimal Sales voucher — with period-end date capping
  console.log('\n═══ STEP 6: SEND MINIMAL SALES VOUCHER ═══');

  // Fetch period end and cap the date if needed
  let voucherDate = today;
  try {
    const periodXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CPeriod</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="CPeriod"><TYPE>Company</TYPE><FETCH>Name, StartingFrom, EndingAt</FETCH></COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
    const pr = await axios.post(TALLY_URL, periodXml, { headers: { 'Content-Type': 'text/xml' }, timeout: 15000 });
    const pm = String(pr.data).match(/<ENDINGAT[^>]*>(\d{8})<\/ENDINGAT>/i);
    if (pm) {
      console.log(`  Tally period ends: ${pm[1]}`);
      if (today > pm[1]) {
        voucherDate = pm[1];
        console.log(`  ✓ Capping date ${today} → ${voucherDate}`);
      } else {
        console.log(`  ✓ Today ${today} is within period`);
      }
    } else {
      console.log('  Could not detect period end — using today:', today);
    }
  } catch (e) {
    console.log('  Period end fetch failed:', e.message);
  }
  console.log(`  Using voucherDate: ${voucherDate}`);
  const grandTotal = +(inv.grandTotal || inv.totalAmount || 0).toFixed(2);
  const cgst = +(inv.cgstTotal || (inv.items||[]).reduce((s,i)=>s+(i.cgst||0),0) || 0).toFixed(2);
  const sgst = +(inv.sgstTotal || (inv.items||[]).reduce((s,i)=>s+(i.sgst||0),0) || 0).toFixed(2);
  const igst = +(inv.igstTotal || (inv.items||[]).reduce((s,i)=>s+(i.igst||0),0) || 0).toFixed(2);
  const totalTax = +(cgst + sgst + igst).toFixed(2);
  const salesBase = +(grandTotal - totalTax).toFixed(2);

  console.log(`  grandTotal=${grandTotal} cgst=${cgst} sgst=${sgst} igst=${igst} totalTax=${totalTax} salesBase=${salesBase}`);

  // Check balance
  const creditSum = +(cgst + sgst + igst + (totalTax > 0 ? salesBase : grandTotal)).toFixed(2);
  console.log(`  Balance check: debit=${grandTotal} credits=${creditSum} diff=${Math.abs(grandTotal - creditSum).toFixed(4)}`);
  if (Math.abs(grandTotal - creditSum) > 0.01) {
    console.error('  ✗ VOUCHER IS IMBALANCED — this is why Tally rejects it!');
  }

  const voucherXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${staticVarsXml}</REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${voucherDate}</DATE>
  <EFFECTIVEDATE>${voucherDate}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(inv.invoiceNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(inv.partyName)}</PARTYLEDGERNAME>
  <NARRATION>ERP test export: ${esc(inv.invoiceNo)}</NARRATION>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(inv.partyName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(inv.invoiceNo)}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  ${cgst > 0 ? `<ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>CGST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>${cgst.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>` : ''}
  ${sgst > 0 ? `<ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>SGST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>${sgst.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>` : ''}
  ${igst > 0 ? `<ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>IGST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>${igst.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>` : ''}
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>${(totalTax > 0 ? salesBase : grandTotal).toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>
  </TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

  console.log('\n  Voucher XML being sent:\n', voucherXml);

  try {
    const vr = await axios.post(TALLY_URL, voucherXml, {
      headers: { 'Content-Type': 'text/xml' }, timeout: 60000
    });
    const vbody = String(vr.data);
    console.log('\n  ══ TALLY RESPONSE ══');
    console.log(vbody);

    const exceptions = vbody.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1];
    const created    = vbody.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1];
    const lineErrors = [...vbody.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m => m[1]);

    console.log('\n  ── RESULT ──');
    console.log('  EXCEPTIONS:', exceptions);
    console.log('  CREATED   :', created);
    console.log('  LINEERROR :', lineErrors.length ? lineErrors : '(none)');

    if (exceptions > 0 && !lineErrors.length) {
      console.log('\n  ⚠ EXCEPTIONS with no LINEERROR — most likely causes:');
      console.log('    1. NO COMPANY IS OPEN IN TALLY — check <COMPANY> count in ping response');
      console.log('    2. SVCURRENTCOMPANY tag is wrong (company name mismatch)');
      console.log('    3. Voucher type "Sales" does not exist in this Tally company');
      console.log('    4. Duplicate voucher number already exists in Tally');
      console.log(`    5. Voucher date ${today} is outside the Tally company period`);
    }
  } catch (e) {
    console.error('  ✗ Voucher post failed:', e.message);
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
