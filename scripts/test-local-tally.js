/**
 * test-local-tally.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Directly tests your LOCAL Tally (localhost:9000) without connector or cloud.
 *
 * Usage:
 *   node scripts/test-local-tally.js                    → connection test only
 *   node scripts/test-local-tally.js sales              → export 1 sample sales invoice
 *   node scripts/test-local-tally.js purchase           → export 1 sample purchase voucher
 *   node scripts/test-local-tally.js masters            → export sample ledger + stock item
 *   node scripts/test-local-tally.js xml                → send raw XML (edit XML_PAYLOAD below)
 *
 * Requirements:
 *   • Tally Prime must be running on THIS machine
 *   • Tally HTTP Server must be enabled: F12 → Configure → Advanced → Enable ODBC/HTTP Server: Yes
 *   • Default port is 9000 (change TALLY_URL below if different)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import axios from 'axios';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

// ── CONFIG — change these if needed ──────────────────────────────────────────
const TALLY_URL    = 'http://localhost:9000';
const COMPANY_NAME = 'SRI CHAKRA INDUSTRIES'; // UPPERCASE — must match Tally exactly
const TIMEOUT_MS   = 30000;

// ── Optional: raw XML to send when you run with "xml" argument ──────────────
const XML_PAYLOAD = `<ENVELOPE>
<HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>List of Companies</REPORTNAME>
  <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
</REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

// ─────────────────────────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function staticVars(extra = '') {
  const co = COMPANY_NAME.trim().toUpperCase();
  return `<STATICVARIABLES>${co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : ''}${extra}</STATICVARIABLES>`;
}

async function post(xml, label = '') {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📤 SENDING: ${label || 'XML request'}`);
  console.log(`   URL    : ${TALLY_URL}`);
  console.log(`   Bytes  : ${xml.length}`);
  console.log(`${'─'.repeat(60)}`);
  console.log('XML SENT:\n', xml.slice(0, 800), xml.length > 800 ? '\n...(truncated)' : '');

  try {
    const resp = await axios({
      method: 'POST',
      url: TALLY_URL,
      data: xml,
      headers: { 'Content-Type': 'text/xml', Accept: '*/*' },
      timeout: TIMEOUT_MS,
      responseType: 'text',
      validateStatus: () => true,
    });

    const body = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
    console.log(`\n✅ HTTP ${resp.status} — ${body.length} bytes received`);
    console.log(`\nRESPONSE:\n${body.slice(0, 2000)}`);
    if (body.length > 2000) console.log(`...(${body.length - 2000} more bytes truncated)`);

    // Parse key tags
    const created    = body.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1];
    const altered    = body.match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1];
    const skipped    = body.match(/<SKIPPED>(\d+)<\/SKIPPED>/i)?.[1];
    const exceptions = body.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1];
    const errors     = body.match(/<ERRORS>(\d+)<\/ERRORS>/i)?.[1];
    const lineErrors = [...body.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m => m[1].trim());

    if (created || altered || skipped || exceptions || errors) {
      console.log('\n📊 RESULT SUMMARY:');
      if (created)    console.log(`   ✅ Created   : ${created}`);
      if (altered)    console.log(`   🔄 Altered   : ${altered}`);
      if (skipped)    console.log(`   ⏭️  Skipped   : ${skipped}`);
      if (exceptions) console.log(`   ❌ Exceptions: ${exceptions}  ← Tally rejected these records`);
      if (errors)     console.log(`   ⚠️  Errors    : ${errors}`);
    }

    if (lineErrors.length > 0) {
      console.log('\n🔴 LINE ERRORS FROM TALLY:');
      lineErrors.forEach((e, i) => console.log(`   [${i + 1}] ${e}`));
    }

    if (exceptions > 0 && lineErrors.length === 0) {
      console.log('\n💡 EXCEPTIONS present but no LINEERROR tags.');
      console.log('   Likely causes:');
      console.log('   • Party ledger name not found in Tally');
      console.log('   • Voucher amounts don\'t balance (debit ≠ credit)');
      console.log('   • Duplicate voucher number');
      console.log('   → Enable SVSHOWERRORLIST=Yes (already included in XML) to get details');
    }

    return body;
  } catch (err) {
    console.error(`\n❌ REQUEST FAILED: ${err.message}`);
    if (err.code === 'ECONNREFUSED') {
      console.error(`\n💡 Tally is not reachable at ${TALLY_URL}`);
      console.error('   Make sure:');
      console.error('   1. Tally Prime is open');
      console.error('   2. HTTP Server is enabled: F12 → Configure → Advanced Config');
      console.error('      → Enable ODBC/HTTP Server: Yes');
      console.error('      → Port: 9000');
    } else if (err.code === 'ETIMEDOUT') {
      console.error('   Tally is running but not responding — check HTTP server is enabled');
    }
    return null;
  }
}

// ─── TEST 1: Connection + List Companies ─────────────────────────────────────
async function testConnection() {
  console.log('\n🔌 TEST: Tally Connection');
  const xml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>List of Companies</REPORTNAME>
  <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
</REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;
  return post(xml, 'Connection Test — List of Companies');
}

// ─── TEST 2: Export 1 sample Sales Invoice ───────────────────────────────────
async function testSalesExport() {
  console.log('\n💰 TEST: Export 1 Sample Sales Invoice to Tally');

  // Step 1: Create party ledger
  const mastersXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
<REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${staticVars('<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST>')}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<LEDGER NAME="TEST CUSTOMER ERP" ACTION="Create">
  <NAME>TEST CUSTOMER ERP</NAME>
  <PARENT>Sundry Debtors</PARENT>
</LEDGER>
<LEDGER NAME="Sales Accounts" ACTION="Create">
  <NAME>Sales Accounts</NAME><PARENT>Sales Accounts</PARENT>
</LEDGER>
<LEDGER NAME="CGST" ACTION="Create">
  <NAME>CGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE>
</LEDGER>
<LEDGER NAME="SGST" ACTION="Create">
  <NAME>SGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE>
</LEDGER>
<STOCKITEM NAME="TEST ITEM ERP" ACTION="Create">
  <NAME>TEST ITEM ERP</NAME><UNITS>Nos</UNITS>
</STOCKITEM>
</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

  console.log('\n[Step 1] Creating test ledger + stock item...');
  await post(mastersXml, 'Sales Test — Auto Masters');

  // Step 2: Create sales voucher
  const voucherXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${staticVars('<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST>')}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>20260101</DATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>ERP-TEST-001</VOUCHERNUMBER>
  <PARTYLEDGERNAME>TEST CUSTOMER ERP</PARTYLEDGERNAME>
  <NARRATION>ERP Test Invoice — ERP-TEST-001</NARRATION>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>TEST CUSTOMER ERP</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>1180.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>CGST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>-90.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>SGST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>-90.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>TEST ITEM ERP</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <RATE>1000.00 /1 Nos</RATE>
    <AMOUNT>-1000.00</AMOUNT>
    <ACTUALQTY>1 Nos</ACTUALQTY>
    <BILLEDQTY>1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales Accounts</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>-1000.00</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

  console.log('\n[Step 2] Creating test sales voucher...');
  return post(voucherXml, 'Sales Test — Voucher');
}

// ─── TEST 3: Export 1 sample Purchase Voucher ────────────────────────────────
async function testPurchaseExport() {
  console.log('\n🛒 TEST: Export 1 Sample Purchase Voucher to Tally');

  const mastersXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
<REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${staticVars('<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST>')}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<LEDGER NAME="TEST VENDOR ERP" ACTION="Create">
  <NAME>TEST VENDOR ERP</NAME>
  <PARENT>Sundry Creditors</PARENT>
</LEDGER>
<LEDGER NAME="Purchase Accounts" ACTION="Create">
  <NAME>Purchase Accounts</NAME><PARENT>Purchase Accounts</PARENT>
</LEDGER>
<LEDGER NAME="CGST" ACTION="Create">
  <NAME>CGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE>
</LEDGER>
<LEDGER NAME="SGST" ACTION="Create">
  <NAME>SGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE>
</LEDGER>
<STOCKITEM NAME="TEST ITEM ERP" ACTION="Create">
  <NAME>TEST ITEM ERP</NAME><UNITS>Nos</UNITS>
</STOCKITEM>
</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

  console.log('\n[Step 1] Creating test vendor ledger + stock item...');
  await post(mastersXml, 'Purchase Test — Auto Masters');

  const voucherXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${staticVars('<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST>')}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Purchase" ACTION="Create">
  <DATE>20260101</DATE>
  <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
  <VOUCHERNUMBER>PO-TEST-001</VOUCHERNUMBER>
  <PARTYLEDGERNAME>TEST VENDOR ERP</PARTYLEDGERNAME>
  <BUYERSORDERNO>PO-TEST-001</BUYERSORDERNO>
  <NARRATION>ERP Test PO — PO-TEST-001</NARRATION>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>TEST VENDOR ERP</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>-1180.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>CGST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>90.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>SGST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>90.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>TEST ITEM ERP</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <RATE>1000.00 /1 Nos</RATE>
    <AMOUNT>1000.00</AMOUNT>
    <ACTUALQTY>1 Nos</ACTUALQTY>
    <BILLEDQTY>1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Purchase Accounts</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>1000.00</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

  console.log('\n[Step 2] Creating test purchase voucher...');
  return post(voucherXml, 'Purchase Test — Voucher');
}

// ─── TEST 4: Masters only ─────────────────────────────────────────────────────
async function testMastersExport() {
  console.log('\n🗂️  TEST: Export Sample Masters (Ledger + Stock Item)');
  const xml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
<REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${staticVars('<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST>')}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<LEDGER NAME="ERP TEST DEBTOR" ACTION="Create">
  <NAME>ERP TEST DEBTOR</NAME>
  <PARENT>Sundry Debtors</PARENT>
  <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>29AABCT1332L1Z3</PARTYGSTIN>
</LEDGER>
<LEDGER NAME="ERP TEST CREDITOR" ACTION="Create">
  <NAME>ERP TEST CREDITOR</NAME>
  <PARENT>Sundry Creditors</PARENT>
</LEDGER>
<STOCKITEM NAME="ERP TEST ITEM" ACTION="Create">
  <NAME>ERP TEST ITEM</NAME>
  <UNITS>Nos</UNITS>
  <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>
  <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
  <HSNCODE>8471</HSNCODE>
  <GSTRATE>18</GSTRATE>
</STOCKITEM>
</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;
  return post(xml, 'Masters Test');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const arg = process.argv[2] || 'connection';

console.log('═'.repeat(60));
console.log('  ERP → Local Tally Test Script');
console.log(`  Target : ${TALLY_URL}`);
console.log(`  Company: ${COMPANY_NAME}`);
console.log('═'.repeat(60));

switch (arg) {
  case 'sales':    await testSalesExport();    break;
  case 'purchase': await testPurchaseExport(); break;
  case 'masters':  await testMastersExport();  break;
  case 'xml':      await post(XML_PAYLOAD, 'Custom XML');  break;
  default:         await testConnection();     break;
}

console.log('\n✅ Done.');
