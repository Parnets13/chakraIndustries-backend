/**
 * test-minimal-sales.js
 * 
 * Sends progressively more complex Sales vouchers to Tally until we find
 * exactly what structure this Tally instance accepts.
 * 
 * Run: node scripts/test-minimal-sales.js
 */

import mongoose from 'mongoose';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/chakra-industries';

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

async function send(cfg, xml, label) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${label}`);
  console.log(`XML (${xml.length} bytes):\n${xml}`);
  try {
    const resp = await postXmlWithRetry(cfg, xml, cfg.useConnector ? 90000 : 30000);
    console.log(`RESPONSE: ${resp}`);
    const created    = resp.match(/<CREATED>(\d+)/i)?.[1] || '0';
    const exceptions = resp.match(/<EXCEPTIONS>(\d+)/i)?.[1] || '0';
    const errors     = resp.match(/<ERRORS>(\d+)/i)?.[1] || '0';
    const lineerror  = resp.match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/i)?.[1] || '';
    const lasterror  = resp.match(/<LASTERROR>([\s\S]*?)<\/LASTERROR>/i)?.[1] || '';
    console.log(`RESULT: created=${created} exceptions=${exceptions} errors=${errors}`);
    if (lineerror) console.log(`LINEERROR: ${lineerror}`);
    if (lasterror) console.log(`LASTERROR: ${lasterror}`);
    return parseInt(exceptions) === 0;
  } catch(e) {
    console.log(`ERROR: ${e.message}`);
    return false;
  }
}

async function main() {
  await mongoose.connect(MONGO_URI);
  const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
  if (!cfg) { console.log('No TallyConfig found'); process.exit(1); }

  const company = (cfg.companyName || '').trim().toUpperCase();
  console.log(`Company: "${company}"`);
  console.log(`Connector: ${cfg.useConnector} / ${cfg.connectorId}`);

  const sv = (xml) => `<STATICVARIABLES>${company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : ''}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>`;
  
  const today = (() => {
    const n = new Date();
    return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;
  })();

  // Use period end date (July 2) to avoid date issues
  const tallyDate = '20260702';

  // ── TEST 1: Absolute minimum - no inventory, no GST, just party + sales ──
  const test1 = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv()}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${tallyDate}</DATE>
  <EFFECTIVEDATE>${tallyDate}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>TEST-MINIMAL-001</VOUCHERNUMBER>
  <PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <NARRATION>Test minimal</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-1000.00</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>TEST-MINIMAL-001</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-1000.00</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>1000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

  const ok1 = await send(cfg, test1, 'Minimal: party + Sales Accounts, no inventory, ALLLEDGERENTRIES');
  if (!ok1) {
    // Try with LEDGERENTRIES instead
    const test1b = test1.replace(/ALLLEDGERENTRIES/g, 'LEDGERENTRIES');
    await send(cfg, test1b, 'Minimal: party + Sales Accounts, LEDGERENTRIES (old tag)');
  }

  // ── TEST 2: Add one inventory entry ──────────────────────────────────────
  const test2 = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv()}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${tallyDate}</DATE>
  <EFFECTIVEDATE>${tallyDate}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>TEST-INV-001</VOUCHERNUMBER>
  <PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <NARRATION>Test with inventory</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-1000.00</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>TEST-INV-001</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-1000.00</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>1000.00/Nos</RATE>
    <AMOUNT>1000.00</AMOUNT>
    <ACTUALQTY>1 Nos</ACTUALQTY>
    <BILLEDQTY>1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales Accounts</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>1000.00</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

  await send(cfg, test2, 'With inventory entry (no GST, Sales Accounts as accounting alloc)');

  // ── TEST 3: With GST ──────────────────────────────────────────────────────
  const test3 = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv()}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${tallyDate}</DATE>
  <EFFECTIVEDATE>${tallyDate}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>TEST-GST-001</VOUCHERNUMBER>
  <PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <NARRATION>Test with GST</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-1180.00</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>TEST-GST-001</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-1180.00</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>CGST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>90.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>SGST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>90.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>1000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>1000.00/Nos</RATE>
    <AMOUNT>1000.00</AMOUNT>
    <ACTUALQTY>1 Nos</ACTUALQTY>
    <BILLEDQTY>1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales Accounts</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>1000.00</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

  await send(cfg, test3, 'With GST (CGST+SGST) and inventory');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
