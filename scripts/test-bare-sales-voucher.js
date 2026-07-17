#!/usr/bin/env node
/**
 * test-bare-sales-voucher.js
 * Sends the absolute minimal Sales voucher to Tally — no items, no GST, 
 * just party + sales ledger — to isolate whether ANY Sales voucher is accepted.
 * 
 * If this fails: the problem is voucher type name, company, or date.
 * If this succeeds: the problem is in the item/GST fields we're adding.
 * 
 * Usage: node scripts/test-bare-sales-voucher.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';

dotenv.config();

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('✓ MongoDB connected');

  const cfg = await TallyConfig.findOne().lean();
  const co  = (cfg.companyName || '').trim().toUpperCase();
  console.log(`Company: "${co}"  Connector: ${cfg.useConnector ? cfg.connectorId : 'direct'}`);

  // Step 1: Get the actual voucher type names from Tally
  const coTag = co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : '';
  const vtXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>VT</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE><COLLECTION NAME="VT"><TYPE>VoucherType</TYPE><FETCH>Name</FETCH></COLLECTION></TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
  const vtResp = await postXmlWithRetry(cfg, vtXml, cfg.useConnector ? 90000 : 30000);
  const allVTypes = [...(vtResp||'').matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m=>m[1].trim()).filter(Boolean);
  console.log('Voucher types in Tally:', allVTypes);
  const salesVT = allVTypes.find(n => n.toLowerCase().startsWith('sale')) || 'Sales';
  console.log('Using voucher type:', salesVT);

  // Step 2: Get the period end
  const periodXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CP</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE><COLLECTION NAME="CP"><TYPE>Company</TYPE><FETCH>Name,StartingFrom,EndingAt</FETCH></COLLECTION></TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
  const pResp = await postXmlWithRetry(cfg, periodXml, cfg.useConnector ? 90000 : 30000);
  const periodEnd = (pResp.match(/<ENDINGAT[^>]*>(\d{8})<\/ENDINGAT>/i)?.[1]) || '20260702';
  const periodStart = (pResp.match(/<STARTINGFROM[^>]*>(\d{8})<\/STARTINGFROM>/i)?.[1]) || '20260401';
  console.log(`Tally period: ${periodStart} → ${periodEnd}`);

  // Step 3: Get all ledger names to find a valid party and sales ledger
  const ledXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LD</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE><COLLECTION NAME="LD"><TYPE>Ledger</TYPE><FETCH>Name,Parent</FETCH></COLLECTION></TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
  const lResp = await postXmlWithRetry(cfg, ledXml, cfg.useConnector ? 90000 : 30000);
  const debtors = [], salesLedgers = [];
  for (const m of lResp.matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
    const block  = m[1];
    const name   = (block.match(/<NAME>(.*?)<\/NAME>/i)?.[1]||'').trim();
    const parent = (block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1]||'').trim().toLowerCase();
    if (!name) continue;
    if (parent.includes('sundry debtor')) debtors.push(name);
    if (parent.includes('sales')) salesLedgers.push(name);
  }
  console.log(`Debtors (${debtors.length}): ${debtors.slice(0,5).join(', ')}`);
  console.log(`Sales ledgers (${salesLedgers.length}): ${salesLedgers.slice(0,5).join(', ')}`);

  const partyLedger  = debtors[0] || 'BI Worldwide India PVT LTD';
  const salesLedger  = salesLedgers.find(l => !l.toLowerCase().includes('accounts')) || salesLedgers[0] || 'Sales';
  const voucherDate  = periodEnd; // use period end date — always valid
  const amount       = 100.00;
  const testVoucherNo = `TEST-${Date.now()}`;

  console.log(`\nTest voucher: party="${partyLedger}" salesLedger="${salesLedger}" date=${voucherDate} amount=${amount}`);

  // Step 4: Send bare-minimum voucher (pure accounting, no items, no GST)
  const voucherXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="${esc(salesVT)}" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${voucherDate}</DATE>
  <EFFECTIVEDATE>${voucherDate}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>${esc(salesVT)}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(testVoucherNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(partyLedger)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <NARRATION>Test from ERP ${testVoucherNo}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(partyLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-${amount.toFixed(2)}</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(testVoucherNo)}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-${amount.toFixed(2)}</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(salesLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${amount.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

  console.log('\n--- Sending bare-minimum Sales voucher ---');
  console.log('XML length:', voucherXml.length);
  const resp = await postXmlWithRetry(cfg, voucherXml, cfg.useConnector ? 180000 : 30000);
  console.log('RAW RESPONSE:', resp);

  const created    = resp.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1];
  const exceptions = resp.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1];
  const lineError  = resp.match(/<LINEERROR>(.*?)<\/LINEERROR>/i)?.[1];
  console.log(`\nResult: CREATED=${created} EXCEPTIONS=${exceptions}`);
  if (lineError) console.log('LINEERROR:', lineError);

  if (created === '1') {
    console.log('\n✓ SUCCESS — bare Sales voucher accepted by Tally');
    console.log('→ The problem was in the item/GST fields. Items are working now.');
    // Clean up — delete the test voucher
    const deleteXml = voucherXml.replace('ACTION="Create"', 'ACTION="Delete"');
    await postXmlWithRetry(cfg, deleteXml, cfg.useConnector ? 90000 : 30000);
    console.log('→ Test voucher deleted');
  } else {
    console.log('\n✗ FAILED — even bare Sales voucher rejected');
    console.log('→ The problem is voucher type name, date, or company — NOT item fields');
    console.log(`→ voucherType used: "${salesVT}"  date: ${voucherDate}  company: "${co}"`);
  }

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
