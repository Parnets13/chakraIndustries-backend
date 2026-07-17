/**
 * test-sales-voucher.js  v5
 * Test INVENTORYENTRIES.LIST vs ALLINVENTORYENTRIES.LIST
 * Also test without stock item tracking (just accounting voucher with item description)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import TallyConfig from '../models/TallyConfig.js';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGO_URI);
const cfg   = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const TALLY = cfg.tallyLocalUrl || 'http://localhost:9000';
const CO    = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').trim().toUpperCase();

function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }
function td(d) { const dt = d ? new Date(d) : new Date(); return `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`; }

async function post(xml, label, ms=45000) {
  process.stdout.write(`\n[${label}] `);
  try {
    const r  = await axios.post(TALLY, xml, { headers:{'Content-Type':'text/xml'}, timeout: ms });
    const b  = String(r.data||'');
    const le = [...b.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());
    const c  = parseInt(b.match(/<CREATED>(\d+)/i)?.[1]||'0');
    const a  = parseInt(b.match(/<ALTERED>(\d+)/i)?.[1]||'0');
    const e  = parseInt(b.match(/<EXCEPTIONS>(\d+)/i)?.[1]||'0');
    const st = c>0 ? '✅ created='+c : a>0 ? '✅ altered='+a : e>0 ? '❌ exceptions='+e : '⚠️ 0';
    console.log(st + (le.length ? '  ERR: '+le.join(' | ') : ''));
    return { c, a, e, le, body: b };
  } catch(err) { console.log('TIMEOUT:', err.message.slice(0,60)); return {c:0,a:0,e:-1,le:[],body:''}; }
}

const coTag = `<SVCURRENTCOMPANY>${esc(CO)}</SVCURRENTCOMPANY>`;
const sv    = `<STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>`;
const V     = i => `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv}</REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${i}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
const M     = i => `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${sv}</REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${i}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

const inv  = await Invoice.findOne({ source:{$nin:['Tally','tally']} }).lean();
const DATE = td(inv.invoiceDate);
const PARTY= inv.partyName;
const GRAND= +(inv.grandTotal||0).toFixed(2);
const i0   = inv.items?.[0]||{};
const ITEM = i0.description||i0.name||'TestItem';
const QTY  = +(i0.qty||1);
const RATE = +(i0.rate||GRAND).toFixed(2);
const SBASE= +(i0.amount||i0.basic||(QTY*+RATE)).toFixed(2);
const CGST = +(i0.cgst||0).toFixed(2);
const SGST = +(i0.sgst||0).toFixed(2);
const N    = `ERP-${Date.now().toString().slice(-5)}`;

console.log(`Party="${PARTY}" Grand=${GRAND} SBase=${SBASE} CGST=${CGST} SGST=${SGST} N=${N}`);

// Ensure masters
await post(M(`
<LEDGER NAME="${esc(PARTY)}" ACTION="Create"><NAME>${esc(PARTY)}</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>
<LEDGER NAME="Sales Accounts" ACTION="Create"><NAME>Sales Accounts</NAME><PARENT>Sales Accounts</PARENT></LEDGER>
<LEDGER NAME="Output CGST @ 2.5%" ACTION="Create"><NAME>Output CGST @ 2.5%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>
<LEDGER NAME="Output SGST @ 2.5%" ACTION="Create"><NAME>Output SGST @ 2.5%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>
<STOCKITEM NAME="${esc(ITEM)}" ACTION="Create"><NAME>${esc(ITEM)}</NAME><UNITS>Nos</UNITS></STOCKITEM>
`), 'Masters');

const party = `
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>${esc(PARTY)}</LEDGERNAME>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
  <AMOUNT>-${GRAND}</AMOUNT>
</ALLLEDGERENTRIES.LIST>`;

const gst = CGST > 0 ? `
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>Output CGST @ 2.5%</LEDGERNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
  <AMOUNT>${CGST}</AMOUNT>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>Output SGST @ 2.5%</LEDGERNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
  <AMOUNT>${SGST}</AMOUNT>
</ALLLEDGERENTRIES.LIST>` : `
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>Sales Accounts</LEDGERNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
  <AMOUNT>${GRAND}</AMOUNT>
</ALLLEDGERENTRIES.LIST>`;

// ── T-A: ALLINVENTORYENTRIES.LIST (standard tag) ─────────────────────────────
console.log('\n── T-A: ALLINVENTORYENTRIES.LIST');
await post(V(`<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${DATE}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${N}-TA</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(PARTY)}</PARTYLEDGERNAME><ISINVOICE>Yes</ISINVOICE>
  ${party}${gst}
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(ITEM)}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <RATE>${RATE}/Nos</RATE><AMOUNT>-${SBASE}</AMOUNT>
    <ACTUALQTY> ${QTY} Nos</ACTUALQTY><BILLEDQTY> ${QTY} Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales Accounts</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${SBASE}</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>`), 'T-A: ALLINVENTORYENTRIES.LIST');

// ── T-B: INVENTORYENTRIES.LIST (alternate tag used in some Tally versions) ────
console.log('\n── T-B: INVENTORYENTRIES.LIST');
await post(V(`<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${DATE}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${N}-TB</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(PARTY)}</PARTYLEDGERNAME><ISINVOICE>Yes</ISINVOICE>
  ${party}${gst}
  <INVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(ITEM)}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <RATE>${RATE}/Nos</RATE><AMOUNT>-${SBASE}</AMOUNT>
    <ACTUALQTY> ${QTY} Nos</ACTUALQTY><BILLEDQTY> ${QTY} Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales Accounts</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${SBASE}</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </INVENTORYENTRIES.LIST>
</VOUCHER>`), 'T-B: INVENTORYENTRIES.LIST');

// ── T-C: No inventory tag at all — just ALLLEDGERENTRIES with Sales Accounts ──
// This is what actually works (T1). Use this as production fallback.
console.log('\n── T-C: Pure accounting (no inventory) — PRODUCTION FALLBACK');
const salesOnly = CGST > 0 ? gst : gst; // already has Sales Accounts when no tax
const pureLedgers = CGST > 0 ? `${party}${gst}
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>Sales Accounts</LEDGERNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
  <AMOUNT>${SBASE}</AMOUNT>
</ALLLEDGERENTRIES.LIST>` : `${party}${gst}`;

await post(V(`<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${DATE}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${N}-TC</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(PARTY)}</PARTYLEDGERNAME><ISINVOICE>Yes</ISINVOICE>
  ${pureLedgers}
</VOUCHER>`), 'T-C: Pure accounting (no inventory lines)');

// ── Check if this Tally company has inventory enabled ─────────────────────────
console.log('\n── T-D: Check company inventory setting');
try {
  const r = await axios.post(TALLY, `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CompInfo</ID></HEADER><BODY><DESC>
<STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="CompInfo"><TYPE>Company</TYPE><FETCH>Name,IsInventoryValued,BookDateForVouchers</FETCH></COLLECTION></TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`, { headers:{'Content-Type':'text/xml'}, timeout:15000 });
  const b = String(r.data||'');
  const inv_val = b.match(/<ISINVENTORYVALUED>(.*?)<\/ISINVENTORYVALUED>/i)?.[1] || 'not found';
  console.log(`  IsInventoryValued="${inv_val}"`);
  if (b.includes('Not found') || inv_val === 'not found') {
    console.log('  Raw:', b.slice(0,400));
  }
} catch(e) { console.log('  Check failed:', e.message.slice(0,60)); }

// ── T-A2: ALLINVENTORYENTRIES with NUMBERINGSTYLE=Manual ─────────────────────
console.log('\n── T-A2: ALLINVENTORYENTRIES + NUMBERINGSTYLE Manual');
const UNIT2 = 'Nos';
await post(V(`<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${DATE}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <NUMBERINGSTYLE>Manual</NUMBERINGSTYLE>
  <VOUCHERNUMBER>${N}-TA2</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(PARTY)}</PARTYLEDGERNAME><ISINVOICE>Yes</ISINVOICE>
  ${party}${gst}
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(ITEM)}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <RATE>${RATE}/${UNIT2}</RATE>
    <AMOUNT>-${SBASE}</AMOUNT>
    <ACTUALQTY> ${QTY} ${UNIT2}</ACTUALQTY><BILLEDQTY> ${QTY} ${UNIT2}</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales Accounts</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>-${SBASE}</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>`), 'T-A2: inventory + NUMBERINGSTYLE Manual');

// ── T-A3: Invoice Voucher View ────────────────────────────────────────────────
console.log('\n── T-A3: ALLINVENTORYENTRIES + OBJVIEW Invoice Voucher View');
await post(V(`<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${DATE}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <NUMBERINGSTYLE>Manual</NUMBERINGSTYLE>
  <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
  <VCHENTRYMODE>Item Invoice</VCHENTRYMODE>
  <VOUCHERNUMBER>${N}-TA3</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(PARTY)}</PARTYLEDGERNAME><ISINVOICE>Yes</ISINVOICE>
  ${party}${gst}
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(ITEM)}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <RATE>${RATE}/${UNIT2}</RATE>
    <AMOUNT>-${SBASE}</AMOUNT>
    <ACTUALQTY> ${QTY} ${UNIT2}</ACTUALQTY><BILLEDQTY> ${QTY} ${UNIT2}</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales Accounts</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>-${SBASE}</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>`), 'T-A3: inventory + Invoice Voucher View');

await mongoose.disconnect();
console.log('\nDone.');
