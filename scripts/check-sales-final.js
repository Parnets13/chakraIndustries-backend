/**
 * check-sales-final.js — find what makes inventory entries fail
 */
import mongoose from 'mongoose';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import dotenv from 'dotenv';
dotenv.config();

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

await mongoose.connect(process.env.MONGO_URI);
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const company = (cfg.companyName || '').trim().toUpperCase();
const coTag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
const sv = `<STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>`;
const date = '20260702';
let n = 0;
const vno = () => `TSF-${Date.now()}-${++n}`;

async function send(xml, label) {
  console.log(`\n${'='.repeat(50)}\nTEST: ${label}`);
  const resp = await postXmlWithRetry(cfg, xml, 30000);
  const created = resp.match(/<CREATED>(\d+)/i)?.[1] || '0';
  const exceptions = resp.match(/<EXCEPTIONS>(\d+)/i)?.[1] || '0';
  const lineerror = resp.match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/i)?.[1] || '';
  const lasterror = resp.match(/<LASTERROR>([\s\S]*?)<\/LASTERROR>/i)?.[1] || '';
  console.log(`created=${created} exceptions=${exceptions}`);
  if (lineerror) console.log('LINEERROR:', lineerror);
  if (lasterror) console.log('LASTERROR:', lasterror);
  return created !== '0';
}

// Confirmed working base (from previous test)
const base = (vn, extra='') => `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${date}</DATE><EFFECTIVEDATE>${date}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${vn}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE><NARRATION>Test</NARRATION>
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-500.00</AMOUNT>
    <BILLALLOCATIONS.LIST><NAME>${vn}</NAME><BILLTYPE>New Ref</BILLTYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE><AMOUNT>-500.00</AMOUNT></BILLALLOCATIONS.LIST>
  </LEDGERENTRIES.LIST>
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>500.00</AMOUNT>
  </LEDGERENTRIES.LIST>
  ${extra}
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

// Re-confirm base works
await send(base(vno()), 'Base (no inventory) — should be CREATED=1');

// Add inventory — does it break?
await send(base(vno(), `
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>500.00/Nos</RATE><AMOUNT>500.00</AMOUNT>
    <ACTUALQTY>1 Nos</ACTUALQTY><BILLEDQTY>1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales Accounts</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>500.00</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>`), 'With inventory + Sales Accounts alloc');

// Remove Sales Accounts from ledger entries (only party), rely on accounting alloc
const vn3 = vno();
await send(`<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${sv}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${date}</DATE><EFFECTIVEDATE>${date}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>${vn3}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE><NARRATION>Test</NARRATION>
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-500.00</AMOUNT>
    <BILLALLOCATIONS.LIST><NAME>${vn3}</NAME><BILLTYPE>New Ref</BILLTYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE><AMOUNT>-500.00</AMOUNT></BILLALLOCATIONS.LIST>
  </LEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>HYDRA STEEL WATER BOTTLE 1000ML</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>500.00/Nos</RATE><AMOUNT>500.00</AMOUNT>
    <ACTUALQTY>1 Nos</ACTUALQTY><BILLEDQTY>1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales Accounts</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>500.00</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`, 'Party only in LEDGERENTRIES, Sales Accounts only in ACCOUNTINGALLOCATIONS');

await mongoose.disconnect();
