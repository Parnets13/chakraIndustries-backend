/**
 * debug-tally-voucher-types.js
 * ────────────────────────────
 * Fetches all Voucher Types from Tally and prints them.
 * Also tries to create a minimal test voucher to see the EXACT error.
 *
 * Usage:
 *   node scripts/debug-tally-voucher-types.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';

await mongoose.connect(process.env.MONGO_URI);
console.log('✅ DB connected\n');

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
if (!cfg) { console.error('❌ No TallyConfig found'); process.exit(1); }

const company = (cfg.companyName || '').trim().toUpperCase();
const esc = (s) => s == null ? '' : String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const coTag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';

console.log('Config:', {
  useConnector: cfg.useConnector,
  connectorId: cfg.connectorId,
  companyName: cfg.companyName,
  tallyLocalUrl: cfg.tallyLocalUrl,
});

// ── Step 1: Get all voucher types ─────────────────────────────────────────────
console.log('\n📋 Step 1: Fetching voucher types from Tally...\n');
const voucherTypesXml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>AllVoucherTypes</ID>
</HEADER>
<BODY>
  <DESC>
    <STATICVARIABLES>
      ${coTag}
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="AllVoucherTypes">
        <TYPE>VoucherType</TYPE>
        <FETCH>Name</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC>
</BODY>
</ENVELOPE>`;

try {
  const raw = await postXmlWithRetry(cfg, voucherTypesXml, 30000);
  const names = [...raw.matchAll(/<VOUCHERTYPE[^>]*>[\s\S]*?<NAME>(.*?)<\/NAME>/gi)].map(m => m[1].trim());
  if (names.length) {
    console.log(`✅ Found ${names.length} voucher types:`);
    names.forEach(n => console.log(`   • ${n}`));
  } else {
    // Try alternate parsing
    const allNames = [...raw.matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m => m[1].trim());
    console.log(`Response names found: ${allNames.join(', ') || '(none)'}`);
    console.log('Raw response (first 2000 chars):\n', raw.slice(0, 2000));
  }
} catch (err) {
  console.error('❌ Failed to fetch voucher types:', err.message);
}

// ── Step 2: Get company financial years ──────────────────────────────────────
console.log('\n📅 Step 2: Checking company financial years...\n');
const companyXml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>CompanyInfo</ID>
</HEADER>
<BODY>
  <DESC>
    <STATICVARIABLES>
      ${coTag}
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="CompanyInfo">
        <TYPE>Company</TYPE>
        <FETCH>Name, StartingFrom, BooksFrom, EndingAt</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC>
</BODY>
</ENVELOPE>`;

try {
  const raw = await postXmlWithRetry(cfg, companyXml, 30000);
  console.log('Company info response:\n', raw.slice(0, 3000));
} catch (err) {
  console.error('❌ Failed to fetch company info:', err.message);
}

// ── Step 3: Try a minimal hardcoded voucher ───────────────────────────────────
console.log('\n🧪 Step 3: Sending minimal test voucher (using period end date)...\n');

const today = (() => {
  const n = new Date();
  return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;
})();
console.log('Today (YYYYMMDD):', today);

// Parse period end from the company info response
const periodEndMatch = (await (async () => {
  const r2 = await postXmlWithRetry(cfg, companyXml, 30000);
  return r2.match(/<ENDINGAT[^>]*>(\d{8})<\/ENDINGAT>/i);
})());
const periodEnd = periodEndMatch ? periodEndMatch[1] : null;
console.log('Tally period ends:', periodEnd || '(unknown — using today)');

// Use period end if today is beyond it, otherwise use today
const testDate = (periodEnd && today > periodEnd) ? periodEnd : today;
console.log('Using test date:', testDate);

const minimalVoucherXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${testDate}</DATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>TEST-DEBUG-001</VOUCHERNUMBER>
  <PARTYLEDGERNAME>Cash</PARTYLEDGERNAME>
  <NARRATION>Debug test voucher</NARRATION>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Cash</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>-1000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>1000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

console.log('XML sent:\n', minimalVoucherXml);

try {
  const raw = await postXmlWithRetry(cfg, minimalVoucherXml, 30000);
  console.log('\n━━━ FULL RAW RESPONSE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(raw);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const created    = raw.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1];
  const exceptions = raw.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1];
  const lineErrors = [...raw.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());

  console.log('\n📊 Result:', { created, exceptions, lineErrors });

  if (created === '1') {
    console.log('\n✅ SUCCESS! Minimal voucher created. The issue is with data in BIW invoices.');
    console.log('   → Party ledger, amounts, or stock items are the problem.');
  } else if (lineErrors.some(e => e.includes('date is missing'))) {
    console.log('\n❌ "Date missing" even with minimal test voucher!');
    console.log('   → The Sales voucher TYPE itself may not exist in this Tally company.');
    console.log('   → Or the company financial year does not include', today);
    console.log('   → Check if Tally has FY 2026-27 created (April 2026 - March 2027)');
  } else if (lineErrors.length) {
    console.log('\n⚠️  Got LINEERROR(s):', lineErrors);
  } else if (exceptions > 0) {
    console.log('\n⚠️  EXCEPTIONS but no LINEERROR. Likely ledger issue (Cash or Sales Accounts missing).');
  }
} catch (err) {
  console.error('❌ Request failed:', err.message);
}

await mongoose.disconnect();
console.log('\n✅ Done');
