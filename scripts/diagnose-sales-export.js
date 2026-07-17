/**
 * diagnose-sales-export.js  v3
 * Fresh party + unique voucher number + stock item — all created fresh
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import TallyConfig from '../models/TallyConfig.js';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGO_URI);
const cfg      = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const tallyUrl = cfg.tallyLocalUrl || 'http://localhost:9000';
const company  = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').trim().toUpperCase();
console.log(`Tally: ${tallyUrl}  Company: ${company}`);

function esc(s) { return s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function td(d) { const dt=d?new Date(d):null; if(!dt||isNaN(dt))return null; return `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`; }
const now = Date.now();
const uniqueNo = `DIAGV3-${now}`;

const post = async (xml, label) => {
  process.stdout.write(`\n[${label}] ${xml.length}b → `);
  const r = await axios.post(tallyUrl, xml, { headers:{'Content-Type':'text/xml'}, timeout:25000 });
  const b = String(r.data||'');
  const le = [...b.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());
  const c  = parseInt(b.match(/<CREATED>(\d+)/i)?.[1]||'0');
  const e  = parseInt(b.match(/<EXCEPTIONS>(\d+)/i)?.[1]||'0');
  console.log(`created=${c} exceptions=${e}${le.length?' LINEERR:'+le.join('|'):''}`);
  if (e>0 && !le.length) console.log('  RAW:', b.slice(0,400));
  return { c, e, le };
};

const coTag = `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>`;
const sv    = `<STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>`;

const masterWrap = (inner) => `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${sv}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${inner}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

const voucherWrap = (inner) => `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${inner}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

const DATE     = td(new Date());
const PARTY    = `DIAG-PARTY-${now}`;   // guaranteed fresh party ledger
const ITEM     = `DIAG-ITEM-${now}`;    // guaranteed fresh stock item
const TOTAL    = '500.00';
const RATE     = '500.00';

// ── Step 1: Create fresh party ledger ────────────────────────────────────────
console.log('\n═══ STEP 1: Create fresh test party ledger ═══');
await post(masterWrap(`
<LEDGER NAME="${PARTY}" ACTION="Create">
  <NAME>${PARTY}</NAME>
  <PARENT>Sundry Debtors</PARENT>
</LEDGER>`), 'Create party');

// ── Step 2: Create fresh stock item ──────────────────────────────────────────
console.log('\n═══ STEP 2: Create fresh stock item ═══');
await post(masterWrap(`
<STOCKITEM NAME="${ITEM}" ACTION="Create">
  <NAME>${ITEM}</NAME>
  <UNITS>Nos</UNITS>
  <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>
  <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
</STOCKITEM>`), 'Create stock item');

// ── Step 3: Sales voucher with inventory — unique party + item + vch no ──────
console.log('\n═══ STEP 3: Sales voucher with fresh party + fresh item ═══');
await post(voucherWrap(`
<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${DATE}</DATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${uniqueNo}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${PARTY}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${PARTY}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>-${TOTAL}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>${TOTAL}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${ITEM}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <RATE>${RATE}/Nos</RATE>
    <AMOUNT>-${TOTAL}</AMOUNT>
    <ACTUALQTY> 1 Nos</ACTUALQTY>
    <BILLEDQTY> 1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales Accounts</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>-${TOTAL}</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>`), 'Voucher: fresh party + fresh item');

// ── Step 4: Same but with existing party (BI Worldwide) ──────────────────────
console.log('\n═══ STEP 4: Same structure with BI Worldwide + existing item ═══');
const inv = await Invoice.findOne({ source: { $nin:['Tally','tally'] } }).lean();
const existingParty = inv?.partyName || 'BI Worldwide India PVT LTD';
const existingItem  = inv?.items?.[0]?.description || 'HYDRA STEEL WATER BOTTLE 1000ML';
const existingTotal = +(inv?.grandTotal || 200).toFixed(2);
const existingRate  = +(inv?.items?.[0]?.rate || 200).toFixed(2);

// First ensure the party ledger exists
await post(masterWrap(`
<LEDGER NAME="${esc(existingParty)}" ACTION="Create">
  <NAME>${esc(existingParty)}</NAME><PARENT>Sundry Debtors</PARENT>
</LEDGER>
<STOCKITEM NAME="${esc(existingItem)}" ACTION="Create">
  <NAME>${esc(existingItem)}</NAME><UNITS>Nos</UNITS>
  <GSTAPPLICABLE>Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
</STOCKITEM>`), 'Ensure existing party+item');

await post(voucherWrap(`
<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${DATE}</DATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${uniqueNo}-B</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(existingParty)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(existingParty)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>-${existingTotal}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>${existingTotal}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(existingItem)}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <RATE>${existingRate}/Nos</RATE>
    <AMOUNT>-${existingTotal}</AMOUNT>
    <ACTUALQTY> 1 Nos</ACTUALQTY>
    <BILLEDQTY> 1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales Accounts</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>-${existingTotal}</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>`), 'Voucher: existing party+item');

// ── Step 5: Check if duplicate vch number causes DIAG-MINIMAL-001 to exist ───
console.log('\n═══ STEP 5: Check if DIAG-MINIMAL-001 already in Tally ═══');
const checkXml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Collection</TYPE><ID>CheckVch</ID></HEADER>
<BODY><DESC>
<STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="CheckVch"><TYPE>Voucher</TYPE>
<FETCH>VoucherNumber,GUID</FETCH>
<FILTER>FilterVch</FILTER></COLLECTION>
<FUNCTION NAME="FilterVch">$$IsEqual:$VoucherNumber:"DIAG-MINIMAL-001"</FUNCTION>
</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
const checkResp = await axios.post(tallyUrl, checkXml, { headers:{'Content-Type':'text/xml'}, timeout:20000 });
const checkBody = String(checkResp.data||'');
const vchNums = [...checkBody.matchAll(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/gi)].map(m=>m[1]);
console.log('DIAG-MINIMAL-001 exists in Tally?', vchNums.length > 0 ? 'YES — '+JSON.stringify(vchNums) : 'NO');

await mongoose.disconnect();
console.log('\nDone.');
