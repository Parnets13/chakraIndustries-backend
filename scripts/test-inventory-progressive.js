#!/usr/bin/env node
/**
 * test-inventory-progressive.js
 * 
 * Test sequence to find exactly what tag in ALLINVENTORYENTRIES.LIST causes EXCEPTIONS=1
 * 
 * Usage: node scripts/test-inventory-progressive.js
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
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✓ MongoDB connected');

  const cfg = await TallyConfig.findOne().lean();
  const co  = (cfg.companyName || '').trim().toUpperCase();
  console.log(`Company: "${co}"  Connector: ${cfg.useConnector ? cfg.connectorId : 'direct'}`);

  // Step 1: Get required data from Tally first
  const coTag = co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : '';

  // Get voucher types
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

  // Get period end
  const periodXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CP</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE><COLLECTION NAME="CP"><TYPE>Company</TYPE><FETCH>Name,StartingFrom,EndingAt</FETCH></COLLECTION></TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
  const pResp = await postXmlWithRetry(cfg, periodXml, cfg.useConnector ? 90000 : 30000);
  const periodEnd = (pResp.match(/<ENDINGAT[^>]*>(\d{8})<\/ENDINGAT>/i)?.[1]) || '20260702';

  // Get ledgers
  const ledXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LD</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE><COLLECTION NAME="LD"><TYPE>Ledger</TYPE><FETCH>Name,Parent</FETCH></COLLECTION></TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
  const lResp = await postXmlWithRetry(cfg, ledXml, cfg.useConnector ? 90000 : 30000);
  const debtors = [], salesLedgers = [], gstLedgers = [];
  for (const m of lResp.matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
    const block = m[1];
    const name = (block.match(/<NAME>(.*?)<\/NAME>/i)?.[1]||'').trim();
    const parent = (block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1]||'').trim().toLowerCase();
    if (!name) continue;
    if (parent.includes('sundry debtor')) debtors.push(name);
    if (parent.includes('sales')) salesLedgers.push(name);
    if (parent.includes('duties')) gstLedgers.push(name);
  }
  console.log(`Debtors: ${debtors.slice(0,5).join(', ')}`);
  console.log(`Sales ledgers: ${salesLedgers.slice(0,5).join(', ')}`);
  console.log(`GST ledgers: ${gstLedgers.slice(0,5).join(', ')}`);

  const partyLedger = debtors[0] || 'BI Worldwide India PVT LTD';
  // Find SS Bottle Sales Local 5% or use first sales ledger
  const salesLedger = salesLedgers.find(l => l.toLowerCase().includes('ss bottle')) 
    || salesLedgers.find(l => !l.toLowerCase().includes('accounts')) 
    || 'Sales';
  const cgstLedger = gstLedgers.find(l => l.toLowerCase().includes('cgst')) || 'CGST';
  const sgstLedger = gstLedgers.find(l => l.toLowerCase().includes('sgst')) || 'SGST';

  console.log('\n--- Test configuration ---');
  console.log('Party ledger:', partyLedger);
  console.log('Sales ledger for items:', salesLedger);
  console.log('CGST:', cgstLedger);
  console.log('SGST:', sgstLedger);
  console.log('Sales type:', salesVT);

  // Let's do TEST 1 first!
  console.log('\n\n========================================');
  console.log('=== TEST 1: Bare minimum inventory ===');
  console.log('========================================');
  
  const test1VoucherNo = `TEST-1-${Date.now()}`;
  // Calculate balance: -200 (party) +4.76 (cgst)+4.76 (sgst) +190.48 (inv) = 0 ✔️
  console.log('Balance check: -200 +4.76 +4.76 +190.48 =', (-200 +4.76 +4.76 +190.48));

  const test1VoucherXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="${esc(salesVT)}" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${periodEnd}</DATE>
  <EFFECTIVEDATE>${periodEnd}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>${esc(salesVT)}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(test1VoucherNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(partyLedger)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <NARRATION>TEST 1: Bare inventory - ${test1VoucherNo}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(partyLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-200.00</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(test1VoucherNo)}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-200.00</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(cgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>4.76</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(sgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>4.76</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>190.48/Nos</RATE>
    <AMOUNT>190.48</AMOUNT>
    <ACTUALQTY>1 Nos</ACTUALQTY>
    <BILLEDQTY>1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>${esc(salesLedger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>190.48</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

  console.log('Sending TEST 1 voucher...');
  const test1Resp = await postXmlWithRetry(cfg, test1VoucherXml, cfg.useConnector ? 180000 : 30000);
  console.log('RAW RESPONSE:\n', test1Resp);

  const test1Created = test1Resp.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1];
  const test1Exceptions = test1Resp.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1];
  const test1LineError = test1Resp.match(/<LINEERROR>(.*?)<\/LINEERROR>/si)?.[1];
  
  console.log('\nTEST 1 Result: CREATED=', test1Created, 'EXCEPTIONS=', test1Exceptions);
  if (test1LineError) console.log('TEST1 LINEERROR:', test1LineError);

  if (test1Created !== '1') {
    console.log('\n✗ TEST 1 FAILED — stopping here as requested');
    await mongoose.disconnect();
    process.exit(1);
  }
  
  console.log('✓ TEST1 PASSED!');
  
  // If we made it here, TEST1 passed. Let's do TEST2!
  console.log('\n\n========================================');
  console.log('=== TEST 2: Add GST source tags ===');
  console.log('========================================');
  
  const test2VoucherNo = `TEST-2-${Date.now()}`;
  const test2VoucherXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="${esc(salesVT)}" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${periodEnd}</DATE>
  <EFFECTIVEDATE>${periodEnd}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>${esc(salesVT)}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(test2VoucherNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(partyLedger)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <NARRATION>TEST2: Add GST source tags - ${test2VoucherNo}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(partyLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-200.00</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(test2VoucherNo)}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-200.00</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(cgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>4.76</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(sgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>4.76</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>190.48/Nos</RATE>
    <AMOUNT>190.48</AMOUNT>
    <ACTUALQTY>1 Nos</ACTUALQTY>
    <BILLEDQTY>1 Nos</BILLEDQTY>
    <GSTSOURCETYPE>Ledger</GSTSOURCETYPE>
    <GSTLEDGERSOURCE>${esc(salesLedger)}</GSTLEDGERSOURCE>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>${esc(salesLedger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>190.48</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

  console.log('Sending TEST 2...');
  const test2Resp = await postXmlWithRetry(cfg, test2VoucherXml, cfg.useConnector ? 180000 :30000);
  console.log('RAW RESPONSE:\n', test2Resp);
  const test2Created = test2Resp.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1];
  const test2Exceptions = test2Resp.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1];
  const test2LineError = test2Resp.match(/<LINEERROR>(.*?)<\/LINEERROR>/si)?.[1];
  console.log('\nTEST 2 Result: CREATED=', test2Created, 'EXCEPTIONS=', test2Exceptions);
  if (test2LineError) console.log('TEST2 LINEERROR:', test2LineError);

  if (test2Created !== '1') {
    console.log('\n✗ TEST2 FAILED — GST source tags are the problem!');
    await mongoose.disconnect();
    process.exit(1);
  }
  
  console.log('✓ TEST2 PASSED!');
  
  // TEST 3: Add HSN source tags
  console.log('\n\n========================================');
  console.log('=== TEST3: Add HSN source tags ===');
  console.log('========================================');
  const test3VoucherNo = `TEST3-${Date.now()}`;
  const test3VoucherXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="${esc(salesVT)}" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${periodEnd}</DATE>
  <EFFECTIVEDATE>${periodEnd}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>${esc(salesVT)}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(test3VoucherNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(partyLedger)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <NARRATION>TEST3: Add HSN source tags - ${test3VoucherNo}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(partyLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-200.00</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(test3VoucherNo)}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-200.00</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(cgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>4.76</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(sgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>4.76</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>190.48/Nos</RATE>
    <AMOUNT>190.48</AMOUNT>
    <ACTUALQTY>1 Nos</ACTUALQTY>
    <BILLEDQTY>1 Nos</BILLEDQTY>
    <GSTSOURCETYPE>Ledger</GSTSOURCETYPE>
    <GSTLEDGERSOURCE>${esc(salesLedger)}</GSTLEDGERSOURCE>
    <HSNSOURCETYPE>Ledger</HSNSOURCETYPE>
    <HSNLEDGERSOURCE>${esc(salesLedger)}</HSNLEDGERSOURCE>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>${esc(salesLedger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>190.48</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;
  console.log('Sending TEST3...');
  const test3Resp = await postXmlWithRetry(cfg, test3VoucherXml, cfg.useConnector ? 180000 : 30000);
  console.log('RAW RESPONSE:\n', test3Resp);
  const test3Created = test3Resp.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1];
  const test3Exceptions = test3Resp.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1];
  const test3LineError = test3Resp.match(/<LINEERROR>(.*?)<\/LINEERROR>/si)?.[1];
  console.log('\nTEST3 Result: CREATED=', test3Created, 'EXCEPTIONS=', test3Exceptions);
  if (test3LineError) console.log('TEST3 LINEERROR:', test3LineError);
  if (test3Created !== '1') {
    console.log('\n✗ TEST3 FAILED — HSN source tags are the problem!');
    await mongoose.disconnect();
    process.exit(1);
  }
  
  console.log('✓ TEST3 PASSED!');
  
  // TEST4: Add GST override + HSN name tags
  console.log('\n\n========================================');
  console.log('=== TEST4: Add GST override + HSN name ===');
  console.log('========================================');
  const test4VoucherNo = `TEST4-${Date.now()}`;
  const test4VoucherXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="${esc(salesVT)}" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${periodEnd}</DATE>
  <EFFECTIVEDATE>${periodEnd}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>${esc(salesVT)}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(test4VoucherNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(partyLedger)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <NARRATION>TEST4: Add GST override + HSN name - ${test4VoucherNo}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(partyLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-200.00</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(test4VoucherNo)}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-200.00</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(cgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>4.76</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(sgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>4.76</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>190.48/Nos</RATE>
    <AMOUNT>190.48</AMOUNT>
    <ACTUALQTY>1 Nos</ACTUALQTY>
    <BILLEDQTY>1 Nos</BILLEDQTY>
    <GSTSOURCETYPE>Ledger</GSTSOURCETYPE>
    <GSTLEDGERSOURCE>${esc(salesLedger)}</GSTLEDGERSOURCE>
    <HSNSOURCETYPE>Ledger</HSNSOURCETYPE>
    <HSNLEDGERSOURCE>${esc(salesLedger)}</HSNLEDGERSOURCE>
    <GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
    <GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY>
    <GSTHSNNAME>732393</GSTHSNNAME>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>${esc(salesLedger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>190.48</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;
  console.log('Sending TEST4...');
  const test4Resp = await postXmlWithRetry(cfg, test4VoucherXml, cfg.useConnector ? 180000 : 30000);
  console.log('RAW RESPONSE:\n', test4Resp);
  const test4Created = test4Resp.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1];
  const test4Exceptions = test4Resp.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1];
  const test4LineError = test4Resp.match(/<LINEERROR>(.*?)<\/LINEERROR>/si)?.[1];
  console.log('\nTEST4 Result: CREATED=', test4Created, 'EXCEPTIONS=', test4Exceptions);
  if (test4LineError) console.log('TEST4 LINEERROR:', test4LineError);
  if (test4Created !== '1') {
    console.log('\n✗ TEST4 FAILED — GST override/HSN name tags are the problem!');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log('✓ TEST4 PASSED!');
  
  // TEST5: Add BATCHALLOCATIONS.LIST
  console.log('\n\n========================================');
  console.log('=== TEST5: Add Batch Allocations ===');
  console.log('========================================');
  const test5VoucherNo = `TEST5-${Date.now()}`;
  const test5VoucherXml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="${esc(salesVT)}" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${periodEnd}</DATE>
  <EFFECTIVEDATE>${periodEnd}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>${esc(salesVT)}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(test5VoucherNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(partyLedger)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <NARRATION>TEST5: Add Batch Allocations - ${test5VoucherNo}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(partyLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-200.00</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(test5VoucherNo)}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-200.00</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(cgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>4.76</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(sgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>4.76</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>190.48/Nos</RATE>
    <AMOUNT>190.48</AMOUNT>
    <ACTUALQTY>1 Nos</ACTUALQTY>
    <BILLEDQTY>1 Nos</BILLEDQTY>
    <GSTSOURCETYPE>Ledger</GSTSOURCETYPE>
    <GSTLEDGERSOURCE>${esc(salesLedger)}</GSTLEDGERSOURCE>
    <HSNSOURCETYPE>Ledger</HSNSOURCETYPE>
    <HSNLEDGERSOURCE>${esc(salesLedger)}</HSNLEDGERSOURCE>
    <GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
    <GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY>
    <GSTHSNNAME>732393</GSTHSNNAME>
    <BATCHALLOCATIONS.LIST>
      <GODOWNNAME>Srichakra Industries</GODOWNNAME>
      <BATCHNAME>Primary Batch</BATCHNAME>
      <AMOUNT>190.48</AMOUNT>
      <ACTUALQTY>1 Nos</ACTUALQTY>
      <BILLEDQTY>1 Nos</BILLEDQTY>
    </BATCHALLOCATIONS.LIST>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>${esc(salesLedger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>190.48</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;
  console.log('Sending TEST5...');
  const test5Resp = await postXmlWithRetry(cfg, test5VoucherXml, cfg.useConnector ? 180000 : 30000);
  console.log('RAW RESPONSE:\n', test5Resp);
  const test5Created = test5Resp.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1];
  const test5Exceptions = test5Resp.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1];
  const test5LineError = test5Resp.match(/<LINEERROR>(.*?)<\/LINEERROR>/si)?.[1];
  console.log('\nTEST5 Result: CREATED=', test5Created, 'EXCEPTIONS=', test5Exceptions);
  if (test5LineError) console.log('TEST5 LINEERROR:', test5LineError);
  if (test5Created !== '1') {
    console.log('\n✗ TEST5 FAILED — Batch allocations are the problem!');
  } else {
    console.log('✓ ALL TESTS PASSED!');
  }
  
  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
