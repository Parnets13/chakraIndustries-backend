/**
 * debug-sales-voucher.js
 * ─────────────────────
 * Sends a SINGLE sales invoice to Tally and prints the FULL raw response.
 * This reveals the exact EXCEPTIONS reason — ledger missing, balance error, etc.
 *
 * Usage:
 *   node scripts/debug-sales-voucher.js
 *   node scripts/debug-sales-voucher.js BIW03     ← specific invoice number
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';

await mongoose.connect(process.env.MONGO_URI);
console.log('✅ DB connected\n');

const targetInvoiceNo = process.argv[2] || null;

// ── Load config ──────────────────────────────────────────────────────────────
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
if (!cfg) { console.error('❌ No TallyConfig found'); process.exit(1); }

console.log('TallyConfig:', {
  useConnector  : cfg.useConnector,
  connectorId   : cfg.connectorId,
  companyName   : cfg.companyName,
  tallyLocalUrl : cfg.tallyLocalUrl,
  connectionStatus: cfg.connectionStatus,
});

// ── Load one invoice ─────────────────────────────────────────────────────────
const query = targetInvoiceNo
  ? { invoiceNo: targetInvoiceNo }
  : { status: { $nin: ['Cancelled'] }, source: { $nin: ['Tally','tally'] } };

const inv = await Invoice.findOne(query).lean();
if (!inv) { console.error('❌ No invoice found'); process.exit(1); }

console.log('\n📄 Invoice to test:', {
  invoiceNo  : inv.invoiceNo,
  partyName  : inv.partyName,
  grandTotal : inv.grandTotal,
  itemCount  : (inv.items||[]).length,
  source     : inv.source,
  status     : inv.status,
  invoiceDate: inv.invoiceDate,
});

// ── Print item breakdown ─────────────────────────────────────────────────────
console.log('\n📦 Items:');
let itemsBaseTotal = 0;
for (const it of (inv.items||[])) {
  const amt = +(it.amount || it.total || 0);
  const cgst = +(it.cgst || 0);
  const sgst = +(it.sgst || 0);
  const igst = +(it.igst || 0);
  itemsBaseTotal += amt;
  console.log(`  - ${it.description||it.name}: qty=${it.qty||it.quantity} rate=${it.rate||it.unitPrice} amount=${amt} cgst=${cgst} sgst=${sgst} igst=${igst}`);
}

const cgst = +((inv.cgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.cgst||0),0))).toFixed(2);
const sgst = +((inv.sgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.sgst||0),0))).toFixed(2);
const igst = +((inv.igstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.igst||0),0))).toFixed(2);
const grandTotal = +((inv.grandTotal || inv.totalAmount || 0)).toFixed(2);
const salesBase  = +(grandTotal - cgst - sgst - igst).toFixed(2);

console.log('\n💰 Amount breakdown:');
console.log(`  grandTotal  = ${grandTotal}`);
console.log(`  cgst        = ${cgst}`);
console.log(`  sgst        = ${sgst}`);
console.log(`  igst        = ${igst}`);
console.log(`  salesBase   = ${salesBase}  (grandTotal - taxes)`);
console.log(`  balance check: grandTotal(${grandTotal}) - cgst(${cgst}) - sgst(${sgst}) - igst(${igst}) - salesBase(${salesBase}) = ${+(grandTotal - cgst - sgst - igst - salesBase).toFixed(4)}`);

// ── Build XML ────────────────────────────────────────────────────────────────
const esc = (s) => s == null ? '' : String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&apos;');

const tallyDate = (d) => {
  const dt = d ? new Date(d) : null;
  if (!dt || isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`;
};

const UNIT_MAP = { kg:'Kg', kgs:'Kg', liter:'Ltr', litre:'Ltr', ltr:'Ltr', meter:'Mtr', mtr:'Mtr',
  box:'Box', piece:'Pcs', pieces:'Pcs', pcs:'Pcs', pc:'Pcs', nos:'Nos', no:'Nos', number:'Nos',
  units:'Nos', unit:'Nos', pack:'Nos', dozen:'Nos' };
const tallyUnit = (u) => UNIT_MAP[(u||'').toLowerCase().trim()] || 'Nos';

const company = (cfg.companyName || '').trim().toUpperCase();
const coTag   = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';

const itemsXml = (inv.items||[]).map(item => {
  const qty    = +(item.qty || item.quantity || 1);
  const rate   = +(item.rate || item.unitPrice || item.basePrice || 0);
  const amount = +(item.amount || item.total || (qty * rate) || 0).toFixed(2);
  const unit   = tallyUnit(item.unit || 'Nos');
  return `
<ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME>${esc(item.description||item.name||'Item')}</STOCKITEMNAME>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
  <RATE>${rate}/${unit}</RATE>
  <AMOUNT>-${amount}</AMOUNT>
  <ACTUALQTY>${qty} ${unit}</ACTUALQTY>
  <BILLEDQTY>${qty} ${unit}</BILLEDQTY>
  <ACCOUNTINGALLOCATIONS.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-${amount}</AMOUNT>
  </ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>`;
}).join('');

const voucherXml = `
<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${tallyDate(inv.invoiceDate)||tallyDate(new Date())}</DATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(inv.invoiceNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(inv.partyName)}</PARTYLEDGERNAME>
  <BUYERSORDERNO>${esc(inv.buyersOrderNo||'')}</BUYERSORDERNO>
  <NARRATION>ERP Invoice: ${esc(inv.invoiceNo)}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(inv.partyName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>${grandTotal}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${cgst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${cgst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${sgst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>SGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${sgst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${igst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>IGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${igst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>-${salesBase}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${itemsXml}
</VOUCHER>`;

const fullXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>${coTag}</STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      ${voucherXml}
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

console.log('\n📤 XML being sent:\n');
console.log(fullXml);

// ── Send to Tally ────────────────────────────────────────────────────────────
console.log('\n⏳ Sending to Tally...\n');
try {
  const raw = await postXmlWithRetry(cfg, fullXml, 30000);
  console.log('✅ Got response from Tally\n');
  console.log('━━━ FULL RAW RESPONSE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(raw);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Parse key fields
  const created    = raw.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1];
  const altered    = raw.match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1];
  const exceptions = raw.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1];
  const errors     = raw.match(/<ERRORS>(\d+)<\/ERRORS>/i)?.[1];
  const lineErrors = [...raw.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());

  console.log('\n📊 Result summary:');
  console.log(`  CREATED    = ${created}`);
  console.log(`  ALTERED    = ${altered}`);
  console.log(`  EXCEPTIONS = ${exceptions}`);
  console.log(`  ERRORS     = ${errors}`);
  if (lineErrors.length) {
    console.log(`  LINEERRORS:`);
    lineErrors.forEach(e => console.log(`    → ${e}`));
  }

  if (exceptions > 0 && lineErrors.length === 0) {
    console.log('\n⚠️  Tally threw EXCEPTIONS but gave no LINEERROR message.');
    console.log('   Most common causes:');
    console.log('   1. Party ledger name mismatch (exact spelling matters in Tally)');
    console.log('   2. Stock item name not found in Tally');
    console.log('   3. GST ledger name (CGST/SGST/IGST) doesn\'t exist in Tally');
    console.log('   4. Voucher type "Sales" doesn\'t exist or is named differently');
    console.log('   5. Wrong company name in SVCURRENTCOMPANY');
    console.log(`\n   Your company tag: "${company || '(empty — no company set in TallyConfig)'}"`);
    console.log(`   Party name sent : "${inv.partyName}"`);
    console.log(`   Stock items     : ${(inv.items||[]).map(i=>i.description||i.name).join(', ')}`);
  }

} catch (err) {
  console.error('❌ Request failed:', err.message);
}

await mongoose.disconnect();
