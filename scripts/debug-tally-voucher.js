/**
 * debug-tally-voucher.js
 * 
 * Yeh script ek simple sales voucher aur purchase voucher Tally mein push karta hai
 * aur exact error reason batata hai (LINEERROR).
 * 
 * Run: node scripts/debug-tally-voucher.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import TallyConfig from '../models/TallyConfig.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';

await mongoose.connect(process.env.MONGO_URI);
console.log('✅ MongoDB connected\n');

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
if (!cfg) { console.error('❌ No TallyConfig found'); process.exit(1); }

console.log('📋 TallyConfig:');
console.log(`   Company    : ${cfg.companyName}`);
console.log(`   Connector  : ${cfg.useConnector ? cfg.connectorId : 'DIRECT'}`);
console.log(`   LocalUrl   : ${cfg.tallyLocalUrl || '(none)'}`);
console.log('');

// ─── STEP 1: Check what ledgers exist in Tally ────────────────────────────────
console.log('🔍 Fetching ledger list from Tally to check what exists...');

const company = (cfg.companyName || '').trim().toUpperCase();
const coTag = company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : '';

const ledgerXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>DebugLedgers</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="DebugLedgers"><TYPE>Ledger</TYPE><FETCH>Name,Parent</FETCH></COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;

try {
  const ledgerResp = await postXmlWithRetry(cfg, ledgerXml, 30000, 1);
  const ledgerNames = [...ledgerResp.matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m => m[1].trim());
  console.log(`   Found ${ledgerNames.length} ledgers in Tally`);
  
  // Check for critical ledgers
  const criticalLedgers = ['Sales Accounts', 'CGST', 'SGST', 'IGST', 'Purchase Accounts'];
  for (const name of criticalLedgers) {
    const found = ledgerNames.some(l => l.toLowerCase() === name.toLowerCase());
    console.log(`   ${found ? '✅' : '❌'} ${name}`);
  }
  console.log('');

  // Show first invoice's party name and check if ledger exists
  const invoice = await Invoice.findOne({ status: { $nin: ['Cancelled'] }, source: { $nin: ['Tally','tally'] } }).lean();
  if (invoice) {
    const partyExists = ledgerNames.some(l => l.toLowerCase() === (invoice.partyName||'').toLowerCase());
    console.log(`📦 First invoice to push: ${invoice.invoiceNo}`);
    console.log(`   Party name : "${invoice.partyName}"`);
    console.log(`   Party in Tally? ${partyExists ? '✅ YES' : '❌ NO — this is why EXCEPTIONS happen!'}`);
    
    if (!partyExists) {
      // Show closest matches
      const close = ledgerNames.filter(l => l.toLowerCase().includes((invoice.partyName||'').toLowerCase().slice(0,5)));
      if (close.length) console.log(`   Closest matches in Tally: ${close.slice(0,5).join(', ')}`);
    }
    console.log('');
  }
} catch(e) {
  console.log(`   ⚠️  Could not fetch ledgers: ${e.message}\n`);
}

// ─── STEP 2: Push ONE test sales voucher and show raw Tally response ──────────
console.log('🧪 Pushing a SINGLE test sales voucher to Tally (with SVSHOWERRORLIST=Yes)...');

const invoice = await Invoice.findOne({ status: { $nin: ['Cancelled'] }, source: { $nin: ['Tally','tally'] } }).lean();

if (!invoice) {
  console.log('   No invoices to push — create an invoice in ERP first');
} else {
  const grandTotal = +((invoice.grandTotal || invoice.totalAmount || 0)).toFixed(2);
  let cgst = +((invoice.cgstTotal ?? (invoice.items||[]).reduce((s,i)=>s+(i.cgst||0),0))).toFixed(2);
  let sgst = +((invoice.sgstTotal ?? (invoice.items||[]).reduce((s,i)=>s+(i.sgst||0),0))).toFixed(2);
  let igst = +((invoice.igstTotal ?? (invoice.items||[]).reduce((s,i)=>s+(i.igst||0),0))).toFixed(2);
  const salesBase = +(grandTotal - cgst - sgst - igst).toFixed(2);

  const date = invoice.invoiceDate 
    ? new Date(invoice.invoiceDate).toISOString().slice(0,10).replace(/-/g,'')
    : new Date().toISOString().slice(0,10).replace(/-/g,'');

  const itemsXml = (invoice.items||[]).map(item => {
    const qty = +(item.qty||item.quantity||1);
    const rate = +(item.rate||item.unitPrice||item.basePrice||0);
    const amt = +(item.amount||item.total||(qty*rate)).toFixed(2);
    return `<ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME>${(item.description||item.name||'Test Item').replace(/&/g,'&amp;')}</STOCKITEMNAME>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
  <RATE>${rate}/Nos</RATE>
  <AMOUNT>-${amt}</AMOUNT>
  <ACTUALQTY>${qty} Nos</ACTUALQTY>
  <BILLEDQTY>${qty} Nos</BILLEDQTY>
  <ACCOUNTINGALLOCATIONS.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${amt}</AMOUNT>
  </ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>`;
  }).join('');

  const voucherXml = `<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${date}</DATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${invoice.invoiceNo}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${(invoice.partyName||'').replace(/&/g,'&amp;')}</PARTYLEDGERNAME>
  <NARRATION>ERP Invoice: ${invoice.invoiceNo}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${(invoice.partyName||'').replace(/&/g,'&amp;')}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${grandTotal}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${cgst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${cgst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${sgst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>SGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${sgst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${igst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>IGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${igst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${salesBase}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${itemsXml}
</VOUCHER>`;

  console.log(`\n   Invoice    : ${invoice.invoiceNo}`);
  console.log(`   Party      : ${invoice.partyName}`);
  console.log(`   Total      : ${grandTotal}  CGST:${cgst}  SGST:${sgst}  IGST:${igst}  Base:${salesBase}`);
  console.log(`   Balance OK : ${(grandTotal - cgst - sgst - igst - salesBase).toFixed(4) === '0.0000' ? '✅' : '❌ IMBALANCED!'}`);

  const importXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
<STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
${voucherXml}
</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

  try {
    const resp = await postXmlWithRetry(cfg, importXml, 30000, 1);
    console.log('\n📥 RAW TALLY RESPONSE:');
    console.log(resp);

    const created    = resp.match(/<CREATED>(\d+)/i)?.[1];
    const exceptions = resp.match(/<EXCEPTIONS>(\d+)/i)?.[1];
    const lineErrors = [...resp.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());

    console.log('\n📊 RESULT:');
    console.log(`   CREATED    : ${created}`);
    console.log(`   EXCEPTIONS : ${exceptions}`);
    if (lineErrors.length) {
      console.log('   LINEERRORS:');
      lineErrors.forEach(e => console.log(`     ❌ ${e}`));
    } else if (exceptions > 0) {
      console.log('   ⚠️  Tally gave EXCEPTIONS but no LINEERROR detail.');
      console.log('   This usually means party ledger does not exist in Tally.');
      console.log('   SOLUTION: Run "Masters Sync" first from ERP → Tally page, then retry.');
    } else if (created == '1') {
      console.log('   ✅ VOUCHER CREATED IN TALLY SUCCESSFULLY!');
    }
  } catch(e) {
    console.log(`   ❌ Failed: ${e.message}`);
  }
}

// ─── STEP 3: Quick summary ────────────────────────────────────────────────────
const totalInvoices = await Invoice.countDocuments({ status:{$nin:['Cancelled']}, source:{$nin:['Tally','tally']} });
const totalPOs = await PurchaseOrder.countDocuments({ status:{$in:['Approved','Received']}, dataSource:{$ne:'Tally'} });
console.log(`\n📊 ERP Data:`);
console.log(`   Invoices to push : ${totalInvoices}`);
console.log(`   POs to push      : ${totalPOs}`);

await mongoose.disconnect();
process.exit(0);
