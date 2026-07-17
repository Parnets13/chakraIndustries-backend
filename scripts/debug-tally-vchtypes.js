/**
 * debug-tally-vchtypes.js
 * ───────────────────────────────────────────────────────────────────
 * Diagnoses why Sales/Purchase voucher exports are rejected (EXCEPTIONS).
 *
 * Run: node scripts/debug-tally-vchtypes.js
 *
 * Fetches from the live Tally (via connector if configured):
 *   1. All VoucherType names — confirms exact names to use in VCHTYPE=
 *   2. All Ledger names matching "Sales" or "Purchase" — confirms ledger names
 *   3. A minimal test Sales voucher sent to Tally — shows the raw Tally response
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { createRequire } from 'module';
dotenv.config();

const require = createRequire(import.meta.url);

// ── Bootstrap DB ──────────────────────────────────────────────────────────────
await mongoose.connect(process.env.MONGO_URI);
console.log('✓ Connected to MongoDB\n');

// ── Load config + postXmlWithRetry the same way the service does ──────────────
const { default: TallyConfig } = await import('../models/TallyConfig.js');
const { postXmlWithRetry }     = await import('../services/tallyFetchEngine.js');

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
if (!cfg) { console.error('No TallyConfig found in DB'); process.exit(1); }

const company = (cfg.companyName || '').trim().toUpperCase();
const coTag   = company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : '';

console.log('── TallyConfig ──────────────────────────────────────────────');
console.log(`  useConnector : ${cfg.useConnector}`);
console.log(`  connectorId  : ${cfg.connectorId || '(none)'}`);
console.log(`  companyName  : ${cfg.companyName || '(not set)'}`);
console.log(`  tallyLocalUrl: ${cfg.tallyLocalUrl || '(not set)'}`);
console.log('');

// ── Helper ────────────────────────────────────────────────────────────────────
async function post(xml, label, timeoutMs = 30000) {
  console.log(`── ${label} ──────────────────────────────────────────────────`);
  try {
    const resp = await postXmlWithRetry(cfg, xml, timeoutMs);
    console.log(`RAW RESPONSE (first 2000 chars):\n${resp.slice(0, 2000)}\n`);
    return resp;
  } catch (err) {
    console.error(`ERROR: ${err.message}\n`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. List all VoucherTypes defined in Tally
// ─────────────────────────────────────────────────────────────────────────────
const vchTypesXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>VoucherTypeList</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="VoucherTypeList" ISMODIFY="No">
      <TYPE>VoucherType</TYPE>
      <FETCH>Name, IsSales, IsPurchase, MasterID</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

const vchTypesResp = await post(vchTypesXml, 'STEP 1 — VoucherType list from Tally');

// Parse and print just the names
if (vchTypesResp) {
  const names = [...vchTypesResp.matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m => m[1].trim());
  if (names.length) {
    console.log(`Found ${names.length} VoucherType(s):`);
    names.forEach(n => console.log(`  • ${n}`));
  } else {
    console.log('(no <NAME> tags found — Tally may not support this collection)');
  }
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. List ledger names containing "Sales", "Purchase", "CGST", "SGST"
// ─────────────────────────────────────────────────────────────────────────────
const ledgerListXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerList</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="LedgerList">
      <TYPE>Ledger</TYPE>
      <FETCH>Name, Parent</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

const ledgerResp = await post(ledgerListXml, 'STEP 2 — Ledger list (Sales / Purchase / GST)');

if (ledgerResp) {
  // Print ledgers relevant to vouchers
  const keywords = ['sales', 'purchase', 'cgst', 'sgst', 'igst', 'debtor', 'creditor', 'bi worldwide'];
  const blocks = [...ledgerResp.matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)].map(m => m[1]);
  const matches = blocks.filter(b => {
    const lower = b.toLowerCase();
    return keywords.some(k => lower.includes(k));
  });
  console.log(`Relevant ledgers found (${matches.length}):`);
  matches.forEach(b => {
    const name   = (b.match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '?').trim();
    const parent = (b.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1] || '?').trim();
    console.log(`  • "${name}" (parent: ${parent})`);
  });
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Send a minimal test Sales voucher to see the exact Tally error
//    Uses the first invoice from the earlier log: BIW03, BI Worldwide India PVT LTD
// ─────────────────────────────────────────────────────────────────────────────
// First ensure party ledger exists
const ensureLedgerXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>
    <STATICVARIABLES>${coTag}</STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
    <LEDGER NAME="BI Worldwide India PVT LTD" ACTION="Create">
      <NAME>BI Worldwide India PVT LTD</NAME>
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
    <STOCKITEM NAME="HYDRA STEEL WATER BOTTLE 1000ML" ACTION="Create">
      <NAME>HYDRA STEEL WATER BOTTLE 1000ML</NAME><UNITS>Nos</UNITS>
    </STOCKITEM>
  </TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

await post(ensureLedgerXml, 'STEP 3a — Ensure ledger + stock item exist');

// Now send the actual minimal voucher (same values as BIW03 from logs)
// Enable SVSHOWERRORLIST so Tally includes detailed LINEERROR in the response
const testVoucherXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
    <VOUCHER VCHTYPE="Sales" ACTION="Create">
      <DATE>20260702</DATE>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
      <VOUCHERNUMBER>TEST-DIAG-001</VOUCHERNUMBER>
      <PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
      <ISINVOICE>Yes</ISINVOICE>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>200.00</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>CGST</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>-4.76</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>SGST</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>-4.76</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLINVENTORYENTRIES.LIST>
        <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <RATE>190.48 /1 Nos</RATE>
        <AMOUNT>-190.48</AMOUNT>
        <ACTUALQTY>1 Nos</ACTUALQTY>
        <BILLEDQTY>1 Nos</BILLEDQTY>
        <ACCOUNTINGALLOCATIONS.LIST>
          <LEDGERNAME>Sales Accounts</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-190.48</AMOUNT>
        </ACCOUNTINGALLOCATIONS.LIST>
      </ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
  </TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

await post(testVoucherXml, 'STEP 3b — Minimal test Sales voucher (with SVSHOWERRORLIST=Yes)');

// ─────────────────────────────────────────────────────────────────────────────
// 4. Try alternate voucher type name "Sales Invoice" (some Tally configs use this)
// ─────────────────────────────────────────────────────────────────────────────
const testVoucherAltXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
    <VOUCHER VCHTYPE="Sales Invoice" ACTION="Create">
      <DATE>20260702</DATE>
      <VOUCHERTYPENAME>Sales Invoice</VOUCHERTYPENAME>
      <VOUCHERNUMBER>TEST-DIAG-002</VOUCHERNUMBER>
      <PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
      <ISINVOICE>Yes</ISINVOICE>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>200.00</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>CGST</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>-4.76</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>SGST</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>-4.76</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLINVENTORYENTRIES.LIST>
        <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <RATE>190.48 /1 Nos</RATE>
        <AMOUNT>-190.48</AMOUNT>
        <ACTUALQTY>1 Nos</ACTUALQTY>
        <BILLEDQTY>1 Nos</BILLEDQTY>
        <ACCOUNTINGALLOCATIONS.LIST>
          <LEDGERNAME>Sales Accounts</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-190.48</AMOUNT>
        </ACCOUNTINGALLOCATIONS.LIST>
      </ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
  </TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

await post(testVoucherAltXml, 'STEP 4 — Test with VCHTYPE="Sales Invoice" (alternate name)');

await mongoose.disconnect();
console.log('Done.');
